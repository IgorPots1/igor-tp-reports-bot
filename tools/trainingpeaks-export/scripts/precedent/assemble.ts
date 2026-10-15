/**
 * СБОРКА НЕДЕЛИ ПО СПИСКУ АТЛЕТОВ — общая для «раскидать» и отбора кандидата. READ-ONLY: ничего не пишет.
 * Возвращает по каждому атлету либо собранную неделю, либо отказ с причиной (вне группы 12, нет контекста, неделя уже написана
 * тренером, нет истории, жёсткое нарушение).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadAthleteContexts, type AthleteContext } from "../lib/autoplanner-context.ts";
import { buildDrafts } from "../lib/cycle-drafts.ts";
import { forecast } from "../lib/training-cycle.ts";
import { addDays, buildCorpus, type CWeek } from "./corpus.ts";
import { sbc } from "./dump-corpus.ts";
import { DATA_DIR, load, type Loaded } from "./load.ts";
import { indexCorpus, type Index, type Weights } from "./precedent.ts";
import { buildRepeatWeek, stateFor, type BuiltWeek } from "./build-week.ts";

/** Первый прогон — ТОЛЬКО группа 12 (решение Игоря). Атлет вне списка не пишется ни в каком режиме. */
export const GROUP12 = [5733446, 5475652, 5476215, 6009851, 5931798, 5905779, 5748681, 5475750, 5475968, 5461678, 5807145, 6290336];

export type Assembled =
  | { aid: number; ok: true; built: BuiltWeek; t: CWeek; c: AthleteContext }
  | { aid: number; ok: false; why: string; built?: BuiltWeek; t?: CWeek; c?: AthleteContext };

export async function assemble(week: string, aids: number[]): Promise<{ L: Loaded; ix: Index; results: Assembled[] }> {
  const L = load(); const sb = sbc();
  const ix = indexCorpus(buildCorpus(L.rows, L.races, L.sig, L.students, week)); // история — все недели ДО целевой
  const Wt = JSON.parse(readFileSync(path.join(DATA_DIR, "tuned-weights.json"), "utf8")) as Weights;
  const ctx = await loadAthleteContexts(sb, week);
  const drafts = await buildDrafts(sb, ctx, week);
  const results: Assembled[] = [];
  for (const aid of aids) {
    if (!GROUP12.includes(aid)) { results.push({ aid, ok: false, why: "вне группы 12 — в этом прогоне не пишем" }); continue; }
    const c = ctx.get(aid); if (!c) { results.push({ aid, ok: false, why: "не в действующем ростере / нет контекста" }); continue; }
    const already = L.rows.filter((r) => r.trainingpeaks_athlete_id === aid && r.workout_type_value_id === 3 && (r.planned_time_raw ?? 0) > 0 && r.workout_date >= week && r.workout_date <= addDays(week, 6));
    if (already.length) { results.push({ aid, ok: false, c, why: `неделя уже написана тренером: ${already.length} плановых пробежек в TP — не дублируем` }); continue; }
    const d = drafts.get(aid);
    let cyc = null;
    if (d) { const w2r = d.targetDate ? Math.round((Date.parse(d.targetDate) - Date.parse(week)) / (7 * 86400000)) + 1 : 8; const f = forecast(d, week, Math.max(1, w2r))[0]; if (f) cyc = { role: f.role, target: f.aerobicMin + f.qualityMin, base: d.baseAerobicMin + d.baseQualityMin }; }
    const t = stateFor(ix, aid, week, L.races.filter((r) => r.trainingpeaks_athlete_id === aid), c.hasActiveIllness);
    const b = buildRepeatWeek(ix, t, Wt, cyc, c, L.names);
    if (!b) { results.push({ aid, ok: false, c, t, why: "не из чего собрать (нет своих недель и прецедента)" }); continue; }
    if (b.refused) { results.push({ aid, ok: false, c, t, built: b, why: b.sessions.length ? `жёсткое нарушение: ${b.refusedWhy} · собиралось как: ${b.source} (${b.why.slice(0, 160)}) · ${b.sessions.length} сесс., ${b.sessions.reduce((a, x) => a + x.minutes, 0)} мин` : (b.refusedWhy ?? "отказ") }); continue; }
    results.push({ aid, ok: true, built: b, t, c });
  }
  return { L, ix, results };
}
