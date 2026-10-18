/**
 * СБОРКА НЕДЕЛИ ПО СПИСКУ АТЛЕТОВ — общая для «раскидать» и отбора кандидата. READ-ONLY: ничего не пишет.
 * Возвращает по каждому атлету либо собранную неделю, либо отказ с причиной (вне группы 12, нет контекста, неделя уже написана
 * тренером, нет истории, жёсткое нарушение).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadAthleteContexts, type AthleteContext } from "../lib/autoplanner-context.ts";
import { buildDrafts } from "../lib/cycle-drafts.ts";
import { forecast } from "../lib/training-cycle.ts";
import { addDays, buildCorpus, type CWeek } from "./corpus.ts";
import { sbc } from "./dump-corpus.ts";
import { DATA_DIR, OUT_DIR, load, type Loaded } from "./load.ts";
import { indexCorpus, type Index, type Weights } from "./precedent.ts";
import { buildRepeatWeek, stateFor, type BuiltWeek } from "./build-week.ts";

/** Первый прогон — ТОЛЬКО группа 12 (решение Игоря). Атлет вне списка не пишется ни в каком режиме. */
export const GROUP12 = [5733446, 5475652, 5476215, 6009851, 5931798, 5905779, 5748681, 5475750, 5475968, 5461678, 5807145, 6290336];

/**
 * ТРЕНИРОВКИ, УДАЛЁННЫЕ НАМИ (deleted[] манифестов реальных прогонов). Кэш плановых строк отстаёт от TP: удалённая «снести» тренировка ещё несколько часов
 * лежит в кэше, и ворота «неделя уже написана тренером» принимали её за чужую (17–18.10: Ярулина, постановка отказала при пустом живом календаре).
 * Такие id не считаются работой тренера. Чужое это не скрывает: постановка отдельно требует, чтобы живой календарь недели был пуст.
 */
export function deletedByUs(runsDir: string = path.join(OUT_DIR, "runs")): Set<number> {
  const out = new Set<number>(); if (!existsSync(runsDir)) return out;
  for (const f of readdirSync(runsDir).filter((x) => x.endsWith(".json"))) {
    try { const m = JSON.parse(readFileSync(path.join(runsDir, f), "utf8")) as { mode?: string; deleted?: number[] }; if (m.mode === "real") for (const id of m.deleted ?? []) out.add(Number(id)); } catch { /* битый манифест не должен ронять постановку */ }
  }
  return out;
}

/** Плановые пробежки атлета на неделе в кэше, КРОМЕ удалённых нами: это то, что «написано тренером». */
export function trainerWritten<R extends { trainingpeaks_athlete_id: number; trainingpeaks_workout_id: number; workout_type_value_id: number | null; planned_time_raw: number | null; workout_date: string }>(rows: R[], aid: number, week: string, gone: Set<number>): R[] {
  return rows.filter((r) => !gone.has(Number(r.trainingpeaks_workout_id)) && r.trainingpeaks_athlete_id === aid && r.workout_type_value_id === 3 && (r.planned_time_raw ?? 0) > 0 && r.workout_date >= week && r.workout_date <= addDays(week, 6));
}

export type Assembled =
  | { aid: number; ok: true; built: BuiltWeek; t: CWeek; c: AthleteContext }
  | { aid: number; ok: false; why: string; built?: BuiltWeek; t?: CWeek; c?: AthleteContext };

/** Подлинный description образца из TP (GET, только чтение). Не получилось — нет записи в карте. */
export type DescFetcher = (aid: number, workoutId: number) => Promise<string | null>;
export const liveDescFetcher: DescFetcher = async (aid, id) => {
  try { const tp = await import("../../../../src/features/trainingpeaks/tp-api-client.ts"); const d = await tp.getWorkoutDetail(aid, id); return typeof d.description === "string" ? d.description : null; } catch { return null; }
};

export async function assemble(week: string, aids: number[], opts: { descFetcher?: DescFetcher | null } = {}): Promise<{ L: Loaded; ix: Index; results: Assembled[] }> {
  const fetchDesc = opts.descFetcher === undefined ? liveDescFetcher : opts.descFetcher;
  const L = load(); const sb = sbc();
  const ix = indexCorpus(buildCorpus(L.rows, L.races, L.sig, L.students, week)); // история — все недели ДО целевой
  const Wt = JSON.parse(readFileSync(path.join(DATA_DIR, "tuned-weights.json"), "utf8")) as Weights;
  const ctx = await loadAthleteContexts(sb, week);
  const drafts = await buildDrafts(sb, ctx, week);
  const results: Assembled[] = [];
  for (const aid of aids) {
    if (!GROUP12.includes(aid)) { results.push({ aid, ok: false, why: "вне группы 12 — в этом прогоне не пишем" }); continue; }
    const c = ctx.get(aid); if (!c) { results.push({ aid, ok: false, why: "не в действующем ростере / нет контекста" }); continue; }
    const gone = deletedByUs();
    const already = trainerWritten(L.rows, aid, week, gone);
    if (already.length) { results.push({ aid, ok: false, c, why: `неделя уже написана тренером: ${already.length} плановых пробежек в TP — не дублируем` }); continue; }
    const d = drafts.get(aid);
    let cyc = null;
    if (d) { const w2r = d.targetDate ? Math.round((Date.parse(d.targetDate) - Date.parse(week)) / (7 * 86400000)) + 1 : 8; const f = forecast(d, week, Math.max(1, w2r))[0]; if (f) cyc = { role: f.role, target: f.aerobicMin + f.qualityMin, base: d.baseAerobicMin + d.baseQualityMin }; }
    const t = stateFor(ix, aid, week, L.races.filter((r) => r.trainingpeaks_athlete_id === aid), c.hasActiveIllness);
    let b = buildRepeatWeek(ix, t, Wt, cyc, c, L.names);
    if (b && fetchDesc) { // второй проход: подлинные тексты образца (с переносами строк) вместо схлопнутых из кэша
      const over = new Map<number, string>();
      for (const s of b.sessions) { if (over.has(s.srcWorkoutId)) continue; const own = ix.byAid.get(aid)?.flatMap((w) => w.sessions).some((x) => x.wid === s.srcWorkoutId); const owner = own ? aid : (L.corpus.find((w) => w.sessions.some((x) => x.wid === s.srcWorkoutId))?.aid ?? aid); const txt = await fetchDesc(owner, s.srcWorkoutId); if (txt != null) over.set(s.srcWorkoutId, txt); }
      b = buildRepeatWeek(ix, t, Wt, cyc, c, L.names, over) ?? b;
    }
    if (!b) { results.push({ aid, ok: false, c, t, why: "не из чего собрать (нет своих недель и прецедента)" }); continue; }
    if (b.refused) { results.push({ aid, ok: false, c, t, built: b, why: b.sessions.length ? `жёсткое нарушение: ${b.refusedWhy} · собиралось как: ${b.source} (${b.why.slice(0, 160)}) · ${b.sessions.length} сесс., ${b.sessions.reduce((a, x) => a + x.minutes, 0)} мин` : (b.refusedWhy ?? "отказ") }); continue; }
    results.push({ aid, ok: true, built: b, t, c });
  }
  return { L, ix, results };
}
