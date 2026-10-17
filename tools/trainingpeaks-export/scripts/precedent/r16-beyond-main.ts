/**
 * R16 — «НЕДЕЛЯ ИЗ ЗАВЕРШЁННОГО ЦИКЛА НЕ ОБРАЗЕЦ»: три режима, честный балл, затронутые из группы 12. READ-ONLY.
 * Запуск: tsx r16-beyond-main.ts   (балл показывается, решение от балла не зависит — наряд Игоря 17.10)
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildCorpus, type CWeek } from "./corpus.ts";
import { load, DATA_DIR, OUT_DIR } from "./load.ts";
import { indexCorpus, type Weights } from "./precedent.ts";
import { aggregate, err, summarise, type Side } from "./metrics.ts";
import { setRepeatParams, planRepeat, setBeyondMain } from "./repeat.ts";
import { buildRepeatWeek, setDonorPeakFilter, stateFor, useExplicitParams } from "./build-week.ts";
import { setGuardParams } from "./recent-level.ts";
import { GROUP12 } from "./assemble.ts";
useExplicitParams();
const SPLIT = "2026-03-02", TRAIN_FROM = "2025-06-02", VALID_TO = "2026-08-17";
const L = load(); const ix = indexCorpus(L.corpus); const roster = new Set(L.rosterActive);
const W = JSON.parse(readFileSync(path.join(DATA_DIR, "tuned-weights.json"), "utf8")) as Weights;
const base = { skip: ["старт", "после старта", "подводка", "пик", "провал объёма"] as never, normal: 0.8, gap: 2, lookback: 10, recovery: true, recoveryTable: "train" as const, peak: 1.5, peakRule: null, qualityShare: 0.875 };
const side = (w: CWeek): Side => summarise(w.sessions.filter((s) => !s.race).map((s) => ({ minutes: s.minutes, kind: s.kind, dayIdx: s.dayIdx, work: s.work })));
const train = ix.all.filter((w) => w.weekStart >= TRAIN_FROM && w.weekStart < SPLIT && w.avg4 > 0);
const valid = ix.all.filter((w) => w.weekStart >= SPLIT && w.weekStart < VALID_TO && roster.has(w.aid) && w.avg4 > 0);
function run(ts: CWeek[]) { const es = []; let ref = 0; for (const t of ts) { const b = buildRepeatWeek(ix, t, W, null, undefined, L.names); if (!b || b.refused) { ref++; continue; } es.push(err(side(t), summarise(b.sessions.map((s) => ({ minutes: s.minutes, kind: s.kind, dayIdx: s.dayIdx, work: s.work }))))); } return { a: aggregate(es), ref }; }
setGuardParams({ gap: 4, ratio: 1.5 }); setDonorPeakFilter(true);
const out: string[] = []; const p = (s = ""): void => { out.push(s); };
p(`# R16 · неделя из завершённого цикла не образец`); p();
p(`| режим | балл: обучение | балл: проверка | выдано (пров.) | отказов/нет (пров.) | недодано >15% (пров.) |`); p(`|---|---:|---:|---:|---:|---:|`);
for (const m of ["off", "all"] as const) { setBeyondMain(m); setRepeatParams(base); const a = run(train), b = run(valid); p(`| ${m} | ${a.a.score} | ${b.a.score} | ${b.a.n} | ${b.ref} | ${b.a.under}% |`); }
p();
const wk = "2026-10-19"; const ixw = indexCorpus(buildCorpus(L.rows, L.races, L.sig, L.students, wk));
p(`## Группа 12 на ${wk}`); p(`| атлет | off | all |`); p(`|---|---|---|`);
for (const aid of GROUP12) { const t = stateFor(ixw, aid, wk, L.races.filter((r) => r.trainingpeaks_athlete_id === aid), false);
  const cell = (m: "off" | "all"): string => { setBeyondMain(m); setRepeatParams(base); const r = planRepeat(ixw, t, null); return r.kind === "repeat" ? `${r.base.weekStart} (${r.base.total}) → ${r.sessions.reduce((a, s) => a + s.minutes, 0)} мин` : r.kind; };
  p(`| ${L.names.get(aid) ?? aid} | ${cell("off")} | ${cell("all")} |`); }
writeFileSync(path.join(OUT_DIR, "r16-beyond-main.md"), out.join("\n") + "\n"); console.log(out.join("\n"));
