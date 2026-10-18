/**
 * ЯДРО «РАСКИДАТЬ / ПУБЛИКУЙ / СНЕСТИ» — клиент TP ВНЕДРЯЕТСЯ (TpLike), поэтому всю логику можно проверять на подставном клиенте
 * без единого вызова в TP. CLI (week-ops.ts) только собирает аргументы, ворота и живой клиент.
 *
 * ГАРАНТИИ (проверены check-repeat.ts на подставном клиенте, мутационно):
 *  - постановка: сначала проверка, что на неделе у атлета ПУСТО; после КАЖДОЙ сессии чтение (createHiddenVerified); после всех —
 *    отдельная проверка «все isHidden=true, день, название, длительность, атлет, в календаре ровно наши тренировки»;
 *    любое расхождение — откат ВСЕЙ постановки (все созданные тренировки удаляются и это проверяется), а не только последней;
 *  - сухие «публикуй» и «снести» — ТОЛЬКО ЧТЕНИЕ: ни записи, ни удаления, ни вставки в базу;
 *  - «публикуй» открывает ТЕКУЩУЮ версию из TP (правки тренера сохраняются), удалённое тренером не возвращает;
 *  - «снести» трогает только id из манифеста этого прогона, открытые ученику не удаляет без явного разрешения,
 *    и доказывает, что остальные тренировки недели не изменились.
 */
import type { TpLike } from "./hidden-flow.ts";
import { createHiddenVerified, deleteVerified, emptyFlow, FlowStop, setHiddenVerified } from "./hidden-flow.ts";
import { addDays } from "./corpus.ts";
import { addedByCoach, diffPlaced, toPublish, type Current, type EditRow, type Placed } from "./plan-edits.ts";

import { asString, compareStructures, parseSnap, plannedHours, type Snap } from "./structure-copy.ts";

export type Item = { structure?: Snap | null; aid: number; date: string; dayIdx: number; title: string; minutes: number; description: string; warnings: string[]; source: string; why: string; workoutId: number | null; verified: boolean };
export type Manifest = { runId: string; createdAt: string; mode: "dry_run" | "real"; week: string; items: Item[]; refused: Array<{ aid: number; why: string }>; published: number[]; deleted: number[] };

const norm = (s: string): string => s.replace(/\s+/g, " ").trim();
const days = (week: string): string[] => Array.from({ length: 7 }, (_, i) => addDays(week, i));

/** Всё, что лежит у атлета на неделе (по дням). */
async function weekList(tp: TpLike, aid: number, week: string): Promise<Array<{ workoutId: number; title: string; date: string; minutes: number }>> {
  const out: Array<{ workoutId: number; title: string; date: string; minutes: number }> = [];
  for (const d of days(week)) out.push(...(await tp.listDay(aid, d)));
  return out;
}

// ── ПОСТАНОВКА ──
export type Verify = { ok: boolean; problems: string[]; lines: string[] };

/** Итоговая проверка после постановки. Только чтение. */
export async function verifyPlaced(tp: TpLike, m: Manifest): Promise<Verify> {
  const problems: string[] = []; const lines: string[] = [];
  for (const it of m.items.filter((x) => x.workoutId != null)) {
    const id = it.workoutId!; const tag = `${it.aid}/${id} ${it.date}`;
    let d: Record<string, unknown>;
    try { d = await tp.getWorkoutDetail(it.aid, id); } catch (e) { problems.push(`${tag}: не читается (${e instanceof Error ? e.message.slice(0, 80) : String(e)})`); continue; }
    const mins = Math.round(Number(d.totalTimePlanned ?? 0) * 60);
    const bad: string[] = [];
    if (Number(d.workoutId) !== id) bad.push(`workoutId ${String(d.workoutId)}`);
    if (Number(d.athleteId) !== it.aid) bad.push(`атлет ${String(d.athleteId)}`);
    if (d.isHidden !== true) bad.push(`isHidden=${String(d.isHidden)} (ждали true — ученику видна!)`);
    if (String(d.workoutDay).slice(0, 10) !== it.date) bad.push(`день ${String(d.workoutDay).slice(0, 10)} вместо ${it.date}`);
    if (String(d.title ?? "") !== it.title) bad.push(`название «${String(d.title)}»`);
    if (mins !== it.minutes) bad.push(`длительность ${mins} вместо ${it.minutes}`);
    if (norm(String(d.description ?? "")) !== norm(it.description)) bad.push("текст описания отличается");
    if (it.description !== String(d.description ?? "")) bad.push("текст описания не совпал БАЙТ В БАЙТ (переносы строк/пробелы)");
    if (it.structure) { const c = compareStructures(it.structure, d.structure); if (!c.ok) bad.push(`структура: ${c.diffs.join("; ")}`); }
    if (bad.length) problems.push(`${tag}: ${bad.join("; ")}`);
    lines.push(`${tag} · «${String(d.title)}» · ${mins} мин · isHidden=${String(d.isHidden)} · день ${String(d.workoutDay).slice(0, 10)}${bad.length ? " · РАСХОЖДЕНИЕ" : " · ok"}`);
  }
  // в календаре на каждый день ровно наши тренировки (ничего лишнего и ничего потерянного)
  for (const aid of new Set(m.items.map((i) => i.aid))) {
    const ours = new Set(m.items.filter((i) => i.aid === aid && i.workoutId != null).map((i) => i.workoutId!));
    const got = await weekList(tp, aid, m.week);
    const extra = got.filter((g) => !ours.has(g.workoutId)); const lost = [...ours].filter((id) => !got.some((g) => g.workoutId === id));
    if (extra.length) problems.push(`${aid}: в календаре недели есть чужое: ${extra.map((x) => `${x.workoutId} «${x.title}»`).join(", ")}`);
    if (lost.length) problems.push(`${aid}: в календаре недели нет наших: ${lost.join(", ")}`);
    lines.push(`${aid}: в календаре недели ${got.length} тренировок, наших ${ours.size}${extra.length || lost.length ? " · РАСХОЖДЕНИЕ" : " · ровно наши"}`);
  }
  return { ok: problems.length === 0, problems, lines };
}

export type PlaceResult = { ok: boolean; stopped: string | null; rolledBack: boolean | null; leftover: number[]; lines: string[]; verify: Verify | null };

/** Поставить неделю скрытой. Любое расхождение — откат ВСЕЙ постановки. */
export async function placeWeek(tp: TpLike, m: Manifest, save: (m: Manifest) => void): Promise<PlaceResult> {
  const lines: string[] = [];
  // 0. на неделе у каждого атлета должно быть пусто — иначе не пишем вообще (нечего откатывать)
  for (const aid of new Set(m.items.map((i) => i.aid))) {
    const exist = await weekList(tp, aid, m.week);
    if (exist.length) return { ok: false, stopped: `${aid}: на неделе ${m.week} уже есть ${exist.length} тренировок (${exist.map((x) => `${x.date} «${x.title}»`).join("; ")}) — не пишем`, rolledBack: null, leftover: [], lines, verify: null };
    lines.push(`${aid}: календарь недели ${m.week} пуст — можно писать`);
  }
  const rollback = async (): Promise<{ ok: boolean; leftover: number[] }> => {
    const leftover: number[] = [];
    for (const it of m.items.filter((x) => x.workoutId != null && !m.deleted.includes(x.workoutId!))) {
      try { await deleteVerified(tp, emptyFlow(), it.aid, it.workoutId!); m.deleted.push(it.workoutId!); save(m); lines.push(`откат: ${it.aid}/${it.workoutId} удалена и проверена`); }
      catch { leftover.push(it.workoutId!); lines.push(`откат: ${it.aid}/${it.workoutId} НЕ УДАЛОСЬ удалить — убрать вручную`); }
    }
    return { ok: leftover.length === 0, leftover };
  };
  try {
    for (const it of m.items) {
      const res = emptyFlow();
      const body = { athleteId: it.aid, workoutDay: `${it.date}T00:00:00`, title: it.title, workoutTypeValueId: 3, workoutSubTypeId: null, description: it.description, coachComments: null, distancePlanned: null, totalTimePlanned: it.structure ? plannedHours(it.structure) : it.minutes / 60, structure: it.structure ? asString(it.structure) : null };
      try { it.workoutId = await createHiddenVerified(tp, res, it.aid, body); it.verified = true; save(m); }
      catch (e) { if (res.workoutId != null) { it.workoutId = res.workoutId; save(m); } throw e; }
      if (res.discrepancies.length) it.warnings.push(...res.discrepancies);
      lines.push(`поставлена ${it.aid}/${it.workoutId} ${it.date} «${it.title}» ${it.minutes} мин · isHidden подтверждён чтением${res.discrepancies.length ? " · РАСХОЖДЕНИЕ: " + res.discrepancies.join(" ") : ""}`);
    }
    const v = await verifyPlaced(tp, m);
    lines.push(...v.lines);
    if (!v.ok) throw new FlowStop(`итоговая проверка: ${v.problems.join(" | ")}`);
    return { ok: true, stopped: null, rolledBack: null, leftover: [], lines, verify: v };
  } catch (e) {
    const stopped = e instanceof Error ? e.message : String(e);
    const rb = await rollback();
    return { ok: false, stopped, rolledBack: rb.ok, leftover: rb.leftover, lines, verify: null };
  }
}

// ── СНЕСТИ ──
export type SnestiResult = { lines: string[]; wouldDelete: number[]; deleted: number[]; skippedPublished: number[]; changedByCoach: string[]; othersBefore: number[]; othersAfter: number[] | null; ok: boolean };

export async function runSnesti(tp: TpLike, m: Manifest, o: { dryRun: boolean; includePublished?: boolean; save?: (m: Manifest) => void }): Promise<SnestiResult> {
  const lines: string[] = []; const wouldDelete: number[] = []; const skippedPublished: number[] = []; const changedByCoach: string[] = [];
  const targets = m.items.filter((i) => i.workoutId != null && !m.deleted.includes(i.workoutId!));
  const aids = [...new Set(targets.map((i) => i.aid))];
  const ours = new Set(targets.map((i) => i.workoutId!));
  const before: number[] = [];
  for (const aid of aids) before.push(...(await weekList(tp, aid, m.week)).filter((w) => !ours.has(w.workoutId)).map((w) => w.workoutId));
  for (const it of targets) {
    const id = it.workoutId!; let d: Record<string, unknown> | null = null;
    try { d = await tp.getWorkoutDetail(it.aid, id); } catch (e) { if (!tp.isGone(e)) throw e; }
    if (!d) { lines.push(`${it.aid}/${id}: в TP уже нет — удалять нечего`); continue; }
    const diff: string[] = [];
    if (String(d.workoutDay).slice(0, 10) !== it.date) diff.push(`день ${String(d.workoutDay).slice(0, 10)}`);
    if (String(d.title ?? "") !== it.title) diff.push(`название «${String(d.title)}»`);
    if (Math.round(Number(d.totalTimePlanned ?? 0) * 60) !== it.minutes) diff.push(`длительность ${Math.round(Number(d.totalTimePlanned ?? 0) * 60)}`);
    if (diff.length) changedByCoach.push(`${it.aid}/${id}: тренер изменил — ${diff.join(", ")}`);
    const visible = d.isHidden === false || m.published.includes(id);
    if (visible && !o.includePublished) { skippedPublished.push(id); lines.push(`${it.aid}/${id}: уже ОТКРЫТА ученику — не удаляю без явного --include-published`); continue; }
    wouldDelete.push(id);
    lines.push(`${it.aid}/${id} ${it.date} «${it.title}» · isHidden=${String(d.isHidden)}${diff.length ? " · изменена тренером: " + diff.join(", ") : ""} · ${o.dryRun ? "БУДЕТ удалена" : "удаляю"}`);
  }
  lines.push(`не из этого прогона на неделе (останутся нетронутыми): ${before.length}${before.length ? " — id " + before.join(", ") : ""}`);
  if (o.dryRun) return { lines, wouldDelete, deleted: [], skippedPublished, changedByCoach, othersBefore: before, othersAfter: null, ok: true };
  const deleted: number[] = [];
  for (const it of targets.filter((x) => wouldDelete.includes(x.workoutId!))) {
    await deleteVerified(tp, emptyFlow(), it.aid, it.workoutId!);
    m.deleted.push(it.workoutId!); deleted.push(it.workoutId!); o.save?.(m);
  }
  const after: number[] = [];
  for (const aid of aids) after.push(...(await weekList(tp, aid, m.week)).filter((w) => !ours.has(w.workoutId)).map((w) => w.workoutId));
  const same = before.length === after.length && before.every((id) => after.includes(id));
  lines.push(`после: не из этого прогона на неделе ${after.length} — ${same ? "то же самое, ничего чужого не тронуто" : "ИЗМЕНИЛОСЬ! было " + before.join(",") + ", стало " + after.join(",")}`);
  return { lines, wouldDelete, deleted, skippedPublished, changedByCoach, othersBefore: before, othersAfter: after, ok: same };
}

// ── ПУБЛИКУЙ ──
export type PublikuyResult = { edits: EditRow[]; wouldPublish: number[]; published: number[]; goneByCoach: number[]; lines: string[] };

export async function runPublikuy(tp: TpLike, m: Manifest, o: { dryRun: boolean; only?: number[] | null; insertEdits?: (rows: EditRow[]) => Promise<void>; save?: (m: Manifest) => void }): Promise<PublikuyResult> {
  const placed: Placed[] = m.items.filter((i) => i.workoutId != null && !m.deleted.includes(i.workoutId!) && !m.published.includes(i.workoutId!) && (!o.only || o.only.includes(i.aid)))
    .map((i) => ({ aid: i.aid, weekStart: m.week, workoutId: i.workoutId!, date: i.date, title: i.title, description: i.description, minutes: i.minutes }));
  const cur = new Map<number, Current>(); const edits: EditRow[] = []; const lines: string[] = [];
  for (const p of placed) {
    let c: Current = null;
    try { const w = await tp.getWorkoutDetail(p.aid, p.workoutId); c = { workoutId: p.workoutId, date: String(w.workoutDay), title: String(w.title ?? ""), description: String(w.description ?? ""), minutes: Math.round(Number(w.totalTimePlanned ?? 0) * 60), isHidden: (w.isHidden as boolean) ?? null }; }
    catch (e) { if (!tp.isGone(e)) throw e; }
    cur.set(p.workoutId, c); edits.push(...diffPlaced(p, c));
  }
  for (const aid of new Set(placed.map((p) => p.aid))) {
    const got = await weekList(tp, aid, m.week);
    edits.push(...addedByCoach(aid, m.week, new Set(m.items.filter((i) => i.aid === aid && i.workoutId != null).map((i) => i.workoutId!)), got));
  }
  const pub = toPublish(placed, cur).filter((x) => cur.get(x.workoutId)?.isHidden !== false);
  const goneByCoach = placed.filter((p) => cur.get(p.workoutId) == null).map((p) => p.workoutId);
  for (const e of edits) lines.push(`${e.aid} · ${e.date} · ${e.field} · было: ${e.before ?? "—"} · стало: ${e.after ?? "—"}`);
  lines.push(`правок тренера: ${edits.length}; удалено тренером (назад не возвращаю): ${goneByCoach.length ? goneByCoach.join(", ") : "нет"}; ${o.dryRun ? "БУДЕТ открыто ученику" : "открываю"}: ${pub.length} (его текущие версии)`);
  if (o.dryRun) return { edits, wouldPublish: pub.map((x) => x.workoutId), published: [], goneByCoach, lines };
  if (edits.length && o.insertEdits) await o.insertEdits(edits);
  const published: number[] = [];
  for (const x of pub) {
    await setHiddenVerified(tp, emptyFlow(), x.aid, x.workoutId, false, `открытие ${x.aid}/${x.workoutId}`);
    m.published.push(x.workoutId); published.push(x.workoutId); o.save?.(m);
  }
  return { edits, wouldPublish: pub.map((x) => x.workoutId), published, goneByCoach, lines };
}
