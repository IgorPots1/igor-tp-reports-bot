/**
 * РАСКИДАТЬ / ПУБЛИКУЙ / СНЕСТИ — рабочий процесс Игоря (15.10). ПО УМОЛЧАНИЮ СУХОЙ ПРОГОН.
 *
 *   raskidat  — собрать неделю «повтор + дельта» и (в реальном режиме) записать её СКРЫТОЙ от ученика;
 *   publikuy  — перечитать из TP, что тренер поменял, записать правки в coach_plan_edits и открыть
 *               ученику ЕГО версию (удалённое не возвращается, наш черновик не восстанавливается);
 *   snesti    — удалить всё, что поставил прогон, по манифесту.
 *
 * РАЗВЕДКА (15.10) — честно, что умеет наш путь записи:
 *   - скрытие = поле isHidden у тренировки TP. Тренер им пользуется сам (14 скрытых плановых у 9 атлетов
 *     с 01.10), TP его хранит и отдаёт. Наш create_workout его НЕ передаёт; скрыть можно только PUT-ом
 *     после создания — так написан tp-probe-workout-hidden-field.ts, но он НИ РАЗУ не запускался вживую
 *     (единственный отчёт — сухой, 03.06). То есть скрытие нашим путём НЕ ДОКАЗАНО.
 *   - удаление и проверка чтением после записи (GET) — доказаны вживую.
 * Поэтому реальная запись ОТКАЗЫВАЕТ, пока нет отчёта пробника с hidden_verify_pass: true и
 * unhidden_verify_pass: true. Без этого неделя остаётся черновиком у нас (манифест) — запасной путь.
 *
 * Реальный режим требует ВСЕГО сразу: --execute-real, точную фразу --confirm, TP_ACTIONS_REAL_EXECUTION=true,
 * все атлеты из списка группы 12, доказанное скрытие. После каждой записи — GET-проверка; провал проверки
 * — немедленное удаление созданного и остановка. Манифест пишется после КАЖДОЙ записи (snesti знает, что убирать).
 *
 * Запуск:
 *   npx tsx tools/trainingpeaks-export/scripts/precedent/week-ops.ts raskidat [--week 2026-10-19] [--athletes id,id]
 *   npx tsx tools/trainingpeaks-export/scripts/precedent/week-ops.ts publikuy --run <runId> [--athletes id,id]
 *   npx tsx tools/trainingpeaks-export/scripts/precedent/week-ops.ts snesti --run <runId>
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { loadAthleteContexts } from "../lib/autoplanner-context.ts";
import { DAY_RU } from "../lib/autoplanner-week.ts";
import { buildDrafts } from "../lib/cycle-drafts.ts";
import { forecast } from "../lib/training-cycle.ts";
import { addDays, buildCorpus, iso, mondayOf, type RawRow } from "./corpus.ts";
import { sbc } from "./dump-corpus.ts";
import { DATA_DIR, OUT_DIR, load } from "./load.ts";
import { indexCorpus, type Weights } from "./precedent.ts";
import { buildRepeatWeek, stateFor } from "./build-week.ts";
import { addedByCoach, diffPlaced, toPublish, type Current, type EditRow, type Placed } from "./plan-edits.ts";
import { createHiddenVerified, deleteVerified, emptyFlow, setHiddenVerified } from "./hidden-flow.ts";
import { liveClient } from "./tp-live-client.ts";

/** Первый прогон — ТОЛЬКО группа 12 (решение Игоря). Атлет вне списка не пишется ни в каком режиме. */
export const GROUP12 = [5733446, 5475652, 5476215, 6009851, 5931798, 5905779, 5748681, 5475750, 5475968, 5461678, 5807145, 6290336];
export const CONFIRM = { raskidat: "РАСКИДАТЬ СКРЫТО ГРУППЕ 12", publikuy: "ПУБЛИКУЙ", snesti: "СНЕСТИ ПРОГОН" } as const;
const RUNS = path.join(OUT_DIR, "runs");
const PROOF_DIR = "/Users/igor/igor-tp-reports-bot/reports/hidden-workout-proof";

type Item = { aid: number; date: string; dayIdx: number; title: string; minutes: number; description: string; warnings: string[]; source: string; why: string; workoutId: number | null; verified: boolean };
type Manifest = { runId: string; createdAt: string; mode: "dry_run" | "real"; week: string; items: Item[]; refused: Array<{ aid: number; why: string }>; published: number[]; deleted: number[] };

function arg(name: string): string | null { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] ?? null : null; }
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

/** Доказано ли скрытие нашим путём: живой отчёт пробника с обоими PASS. */
export function hiddenProven(dir = PROOF_DIR): { ok: boolean; why: string } {
  if (!existsSync(dir)) return { ok: false, why: `нет каталога ${dir}` };
  for (const d of readdirSync(dir).sort().reverse()) {
    const f = path.join(dir, d, "summary.md"); if (!existsSync(f)) continue;
    const t = readFileSync(f, "utf8");
    // формат пробника: «- hidden_verify_pass: `true`». Якорь на начало строки обязателен: без него
    // «hidden_verify_pass» находится и внутри «unhidden_verify_pass» (поймано проверкой 15.10).
    // Доказательство засчитывается ТОЛЬКО от пробника на tp-api-client (тот же путь, что у «раскидать»), с тремя PASS:
    // скрыто, открыто, удалено. Старый Playwright-пробник путь «раскидать» не доказывает.
    const pass = (k: string): boolean => new RegExp(`^\\s*-?\\s*${k}:\\s*\`?true\`?\\s*$`, "m").test(t);
    if (/^\s*-\s*path:\s*`tp-api-client`\s*$/m.test(t) && pass("hidden_verify_pass") && pass("unhidden_verify_pass") && pass("deleted_verify_pass")) return { ok: true, why: f };
  }
  return { ok: false, why: "ни одного живого прогона probe-hidden-via-client.ts (path tp-api-client) с hidden/unhidden/deleted_verify_pass = true" };
}

export type GateInput = { executeReal: boolean; confirm: string | null; realEnv: string | undefined; proof: { ok: boolean; why: string }; corpusAgeMin: number };
/** Ворота реального режима: null — можно писать; иначе почему нельзя. Чистая функция. */
export function realGate(cmd: keyof typeof CONFIRM, aids: number[], g: GateInput): string | null {
  if (!g.executeReal) return "сухой прогон (нет --execute-real)";
  if (g.confirm !== CONFIRM[cmd]) return `нет точной фразы --confirm "${CONFIRM[cmd]}"`;
  if (g.realEnv !== "true") return "TP_ACTIONS_REAL_EXECUTION != true";
  const out = aids.filter((a) => !GROUP12.includes(a)); if (out.length) return `атлеты вне группы 12: ${out.join(", ")}`;
  if (cmd === "raskidat") {
    if (!g.proof.ok) return `скрытие не доказано: ${g.proof.why}`;
    // «неделя уже написана тренером» проверяется по выгрузке кэша — она обязана быть свежей
    if (g.corpusAgeMin > 60) return `выгрузка кэша старше часа (${Math.round(g.corpusAgeMin)} мин) — сначала dump-corpus.ts`;
  }
  return null;
}
const gateFromCli = (cmd: keyof typeof CONFIRM, aids: number[]): string | null => realGate(cmd, aids, {
  executeReal: flag("execute-real"), confirm: arg("confirm"), realEnv: process.env.TP_ACTIONS_REAL_EXECUTION,
  proof: cmd === "raskidat" ? hiddenProven() : { ok: true, why: "" },
  corpusAgeMin: (Date.now() - statSync(path.join(DATA_DIR, "corpus.json")).mtimeMs) / 60000,
});

const saveManifest = (m: Manifest): void => { mkdirSync(RUNS, { recursive: true }); writeFileSync(path.join(RUNS, `${m.runId}.json`), JSON.stringify(m, null, 2)); };
const readManifest = (id: string): Manifest => JSON.parse(readFileSync(path.join(RUNS, `${id}.json`), "utf8")) as Manifest;

async function raskidat(): Promise<void> {
  const week = arg("week") ?? addDays(mondayOf(iso(Date.now())), 7);
  const aids = (arg("athletes")?.split(",").map(Number) ?? GROUP12);
  const gate = gateFromCli("raskidat", aids);
  const L = load(); const sb = sbc();
  const corpus = buildCorpus(L.rows, L.races, L.sig, L.students, week); // история — все недели ДО целевой
  const ix = indexCorpus(corpus);
  const Wt = JSON.parse(readFileSync(path.join(DATA_DIR, "tuned-weights.json"), "utf8")) as Weights;
  const ctx = await loadAthleteContexts(sb, week);
  const drafts = await buildDrafts(sb, ctx, week);
  const m: Manifest = { runId: `raskidat-${week}-${Date.now()}`, createdAt: new Date().toISOString(), mode: gate ? "dry_run" : "real", week, items: [], refused: [], published: [], deleted: [] };
  for (const aid of aids) {
    if (!GROUP12.includes(aid)) { m.refused.push({ aid, why: "вне группы 12 — в этом прогоне не пишем" }); continue; }
    const c = ctx.get(aid); if (!c) { m.refused.push({ aid, why: "не в действующем ростере / нет контекста" }); continue; }
    const already = L.rows.filter((r) => r.trainingpeaks_athlete_id === aid && r.workout_type_value_id === 3 && (r.planned_time_raw ?? 0) > 0 && r.workout_date >= week && r.workout_date <= addDays(week, 6));
    if (already.length) { m.refused.push({ aid, why: `неделя уже написана тренером: ${already.length} плановых пробежек в TP — не дублируем` }); continue; }
    const d = drafts.get(aid);
    let cyc = null;
    if (d) { const w2r = d.targetDate ? Math.round((Date.parse(d.targetDate) - Date.parse(week)) / (7 * 86400000)) + 1 : 8; const f = forecast(d, week, Math.max(1, w2r))[0]; if (f) cyc = { role: f.role, target: f.aerobicMin + f.qualityMin, base: d.baseAerobicMin + d.baseQualityMin }; }
    const t = stateFor(ix, aid, week, L.races.filter((r) => r.trainingpeaks_athlete_id === aid), c.hasActiveIllness);
    const b = buildRepeatWeek(ix, t, Wt, cyc, c, L.names);
    if (!b) { m.refused.push({ aid, why: "не из чего собрать (нет своих недель и прецедента)" }); continue; }
    if (b.refused) { m.refused.push({ aid, why: b.sessions.length ? `жёсткое нарушение: ${b.refusedWhy} · собиралось как: ${b.source} (${b.why.slice(0, 160)}) · ${b.sessions.length} сесс., ${b.sessions.reduce((a, x) => a + x.minutes, 0)} мин` : (b.refusedWhy ?? "отказ") }); continue; }
    for (const s of b.sessions) m.items.push({ aid, date: addDays(week, s.dayIdx), dayIdx: s.dayIdx, title: s.title, minutes: s.minutes, description: s.description, warnings: b.warnings, source: b.source, why: b.why, workoutId: null, verified: false });
  }
  saveManifest(m);
  if (gate == null) await realCreate(m); // реальный путь — только если ворота открыты (сейчас закрыты: скрытие не доказано)
  report(m, gate, L.names);
}

/**
 * Реальная запись. Не вызывается, пока realGate не вернул null. Тот же поток, что в пробнике (hidden-flow.ts):
 * создать СКРЫТОЙ в POST, прочитать, при расхождении скрыть PUT-ом (расхождение уходит в манифест).
 * Манифест пишется ДО проверки; при провале созданное удаляется, прогон останавливается.
 */
async function realCreate(m: Manifest): Promise<void> {
  const tp = await liveClient();
  for (const it of m.items) {
    const res = emptyFlow();
    const body = { athleteId: it.aid, workoutDay: `${it.date}T00:00:00`, title: it.title, workoutTypeValueId: 3, workoutSubTypeId: null, description: it.description, coachComments: null, distancePlanned: null, totalTimePlanned: it.minutes / 60, structure: null };
    try {
      it.workoutId = await createHiddenVerified(tp, res, it.aid, body); it.verified = true; saveManifest(m);
    } catch (e) {
      if (res.workoutId != null) { it.workoutId = res.workoutId; saveManifest(m); try { await deleteVerified(tp, emptyFlow(), it.aid, res.workoutId); } catch { /* manifest знает id — «снести» добьёт */ } }
      throw new Error(`запись остановлена на ${it.aid} ${it.date}: ${e instanceof Error ? e.message : String(e)}${res.discrepancies.length ? ` | ${res.discrepancies.join(" ")}` : ""}`);
    }
    if (res.discrepancies.length) it.warnings.push(...res.discrepancies);
  }
}

async function publikuy(): Promise<void> {
  const m = readManifest(arg("run") ?? "");
  const only = arg("athletes")?.split(",").map(Number) ?? null;
  const placedAll: Placed[] = m.items.filter((i) => i.workoutId != null && (!only || only.includes(i.aid))).map((i) => ({ aid: i.aid, weekStart: m.week, workoutId: i.workoutId!, date: i.date, title: i.title, description: i.description, minutes: i.minutes }));
  const gate = gateFromCli("publikuy", [...new Set(placedAll.map((p) => p.aid))]);
  const out: string[] = [`# Публикация прогона ${m.runId} — ${gate ? `СУХОЙ ПРОГОН (${gate})` : "РЕАЛЬНО"}`];
  if (m.mode !== "real" || placedAll.length === 0) {
    out.push("", `Прогон «раскидать» был сухим: в TP ничего не ставилось, перечитывать нечего. Сессий в черновике: ${m.items.length}.`);
    out.push(`При реальном прогоне здесь будет: перечитать каждую поставленную тренировку GET-ом, сравнить с поставленным (день, длительность, формат, описание), найти удалённые и добавленные тренером, записать разницу в coach_plan_edits и снять isHidden у ТЕКУЩЕЙ версии из TP.`);
    console.log(out.join("\n")); return;
  }
  const tp = await import("../../../../src/features/trainingpeaks/tp-api-client.ts");
  const live = await liveClient();
  const cur = new Map<number, Current>(); const edits: EditRow[] = [];
  for (const p of placedAll) {
    try { const w = await tp.getWorkoutDetail(p.aid, p.workoutId); cur.set(p.workoutId, { workoutId: p.workoutId, date: String(w.workoutDay), title: String(w.title ?? ""), description: String(w.description ?? ""), minutes: Number(w.totalTimePlanned ?? 0) * 60, isHidden: (w.isHidden as boolean) ?? null }); }
    catch { cur.set(p.workoutId, null); }
    edits.push(...diffPlaced(p, cur.get(p.workoutId) ?? null));
  }
  for (const aid of new Set(placedAll.map((p) => p.aid))) {
    const inWeek = (await tp.getWorkoutsByDateRange(aid, m.week, addDays(m.week, 6))) as Array<Record<string, unknown>>;
    edits.push(...addedByCoach(aid, m.week, new Set(placedAll.map((p) => p.workoutId)), inWeek.map((w) => ({ workoutId: Number(w.workoutId), date: String(w.workoutDay), title: String(w.title ?? ""), minutes: Number(w.totalTimePlanned ?? 0) * 60 }))));
  }
  const sb = sbc();
  if (edits.length) { const { error } = await sb.from("coach_plan_edits").insert(edits.map((e) => ({ run_id: m.runId, trainingpeaks_athlete_id: e.aid, week_start: e.weekStart, workout_date: e.date, trainingpeaks_workout_id: e.workoutId, field: e.field, before_value: e.before, after_value: e.after }))); if (error) throw error; }
  for (const x of toPublish(placedAll, cur)) {
    // ЕГО текущая версия: setHiddenVerified читает тренировку из TP заново и пишет её же с isHidden:false
    await setHiddenVerified(live, emptyFlow(), x.aid, x.workoutId, false, `открытие ${x.aid}/${x.workoutId}`);
    m.published.push(x.workoutId); saveManifest(m);
  }
  out.push("", `Правок тренера: ${edits.length}`, "| атлет | день | что | было | стало |", "|---|---|---|---|---|", ...edits.map((e) => `| ${e.aid} | ${e.date} | ${e.field} | ${e.before ?? "—"} | ${e.after ?? "—"} |`));
  console.log(out.join("\n"));
}

async function snesti(): Promise<void> {
  const m = readManifest(arg("run") ?? "");
  const ids = m.items.filter((i) => i.workoutId != null && !m.deleted.includes(i.workoutId!));
  const gate = gateFromCli("snesti", [...new Set(ids.map((i) => i.aid))]);
  if (gate) { console.log(`СУХОЙ ПРОГОН (${gate}). Удалилось бы тренировок: ${ids.length}${ids.length ? `: ${ids.map((i) => `${i.aid}/${i.workoutId}`).join(", ")}` : " — прогон ничего не ставил"}.`); return; }
  const tp = await liveClient();
  for (const i of ids) {
    await deleteVerified(tp, emptyFlow(), i.aid, i.workoutId!);
    m.deleted.push(i.workoutId!); saveManifest(m);
  }
  console.log(`Снесено: ${m.deleted.length}`);
}

function report(m: Manifest, gate: string | null, names: Map<number, string>): void {
  const out: string[] = [`# «Раскидать» ${m.week} — ${gate ? `СУХОЙ ПРОГОН: ${gate}` : "РЕАЛЬНО, скрыто"}`, "", `Манифест: ${path.join(RUNS, `${m.runId}.json`)}`];
  const byAid = new Map<number, Item[]>(); for (const i of m.items) (byAid.get(i.aid) ?? byAid.set(i.aid, []).get(i.aid)!).push(i);
  const weeksWarned = [...byAid.values()].filter((its) => its[0].warnings.length).length;
  const sessFlagged = m.items.filter((i) => i.warnings.some((w) => w.startsWith(`⚑ ${i.title}:`))).length;
  out.push(`${gate ? "Поставлено бы" : "Поставлено"}: ${byAid.size} атлетам, сессий ${m.items.length}. Недель с пометками валидатора: ${weeksWarned} из ${byAid.size}; сессий с пометкой по тексту/темпу: ${sessFlagged}. Отказано: ${m.refused.length}.`, "");
  out.push("| атлет | итог | сессий | мин | пометок |", "|---|---|---:|---:|---:|");
  for (const [aid, its] of byAid) out.push(`| ${names.get(aid) ?? aid} | поставить | ${its.length} | ${its.reduce((s, x) => s + x.minutes, 0)} | ${its[0].warnings.length} |`);
  for (const r of m.refused) out.push(`| ${names.get(r.aid) ?? r.aid} | ОТКАЗ: ${r.why} | — | — | — |`);
  for (const [aid, its] of byAid) {
    out.push("", `## ${names.get(aid) ?? aid}`);
    out.push(`_Откуда:_ ${its[0].source}`, `_Почему:_ ${its[0].why}`);
    for (const i of its) out.push(`- ${DAY_RU[i.dayIdx]} ${i.date} · ${i.title} · ${i.minutes} мин`);
    for (const w of its[0].warnings) out.push(`  - ${w}`);
  }
  writeFileSync(path.join(OUT_DIR, `${m.runId}.md`), out.join("\n") + "\n");
  console.log(out.slice(0, 8 + byAid.size + m.refused.length).join("\n"));
}

if (process.argv[1]?.endsWith("week-ops.ts")) main();
function main(): void {
const cmd = process.argv[2];
const run = cmd === "raskidat" ? raskidat : cmd === "publikuy" ? publikuy : cmd === "snesti" ? snesti : null;
if (!run) { console.error("команда: raskidat | publikuy | snesti"); process.exit(2); }
run().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
}
