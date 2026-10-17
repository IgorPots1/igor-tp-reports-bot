/**
 * R15 — БЭКТЕСТ «КАЧЕСТВО ПО ПРАКТИКЕ» (повтор + дельта, границы безопасности, порог пика 1.5). READ-ONLY.
 * Обучение до SPLIT, проверка SPLIT..VALID_TO. Показываем: балл, качественных сессий точно, смещение суммы, недодано >15%, и Ярулину на 19.10.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { addDays, buildCorpus, type CWeek } from "./corpus.ts";
import { load, DATA_DIR, OUT_DIR } from "./load.ts";
import { indexCorpus, type Weights } from "./precedent.ts";
import { aggregate, err, summarise, type Side } from "./metrics.ts";
import { setRepeatParams, planRepeat } from "./repeat.ts";
import { buildRepeatWeek, setDonorPeakFilter, stateFor, useExplicitParams } from "./build-week.ts";
import { setGuardParams } from "./recent-level.ts";
useExplicitParams();
const SPLIT = "2026-03-02", TRAIN_FROM = "2025-06-02", VALID_TO = "2026-08-17";
const L = load(); const ix = indexCorpus(L.corpus); const roster = new Set(L.rosterActive);
const W = JSON.parse(readFileSync(path.join(DATA_DIR, "tuned-weights.json"), "utf8")) as Weights;
const base = { skip: ["старт", "после старта", "подводка", "пик", "провал объёма"] as never, normal: 0.8, gap: 2, lookback: 10, recovery: true, recoveryTable: "train" as const, peak: 1.5, peakRule: null };
const side = (w: CWeek): Side => summarise(w.sessions.filter((s) => !s.race).map((s) => ({ minutes: s.minutes, kind: s.kind, dayIdx: s.dayIdx, work: s.work })));
const train = ix.all.filter((w) => w.weekStart >= TRAIN_FROM && w.weekStart < SPLIT && w.avg4 > 0);
const valid = ix.all.filter((w) => w.weekStart >= SPLIT && w.weekStart < VALID_TO && roster.has(w.aid) && w.avg4 > 0);
function run(ts: CWeek[]) {
  const es = []; let added = 0, addedHit = 0;
  for (const t of ts) { const b = buildRepeatWeek(ix, t, W, null, undefined, L.names); if (!b || b.refused) continue;
    es.push(err(side(t), summarise(b.sessions.map((s) => ({ minutes: s.minutes, kind: s.kind, dayIdx: s.dayIdx, work: s.work })))));
    if (/качество по практике/.test(b.why)) { added++; if (t.qCount > 0) addedHit++; } }
  return { a: aggregate(es), added, addedHit };
}
setGuardParams({ gap: 4, ratio: 1.5 }); setDonorPeakFilter(true);
const out: string[] = []; const p = (s = ""): void => { out.push(s); };
p(`# R15 · бэктест «качество по практике»`); p();
p(`| правило | балл: обучение | балл: проверка | кач-х точно: проверка | смещение суммы: проверка | недодано >15%: проверка | добавлено качество (пров.) | из них в настоящей неделе было качество |`); p(`|---|---:|---:|---:|---:|---:|---:|---:|`);
for (const [name, qs] of [["выключено (копируем образец как есть)", null], ["доля ≥ 0.5", 0.5], ["доля ≥ 0.625 (измерено r14)", 0.625], ["доля ≥ 0.75", 0.75], ["доля ≥ 0.875", 0.875]] as Array<[string, number | null]>) {
  setRepeatParams({ ...base, qualityShare: qs }); const a = run(train), b = run(valid);
  p(`| ${name} | ${a.a.score} | ${b.a.score} | ${b.a.qExact}% | ${b.a.bias > 0 ? "+" : ""}${b.a.bias} | ${b.a.under}% | ${b.added} | ${b.added ? Math.round(100 * b.addedHit / b.added) + "%" : "—"} |`);
}
p();
setRepeatParams({ ...base, qualityShare: 0.625 });
const wk = "2026-10-19"; const ixw = indexCorpus(buildCorpus(L.rows, L.races, L.sig, L.students, wk));
for (const [aid, label] of [[6009851, "Ярулина"]] as Array<[number, string]>) {
  const t = stateFor(ixw, aid, wk, L.races.filter((r) => r.trainingpeaks_athlete_id === aid), false);
  for (const [pk, qs] of [[1.5, null], [1.5, 0.625], [1.25, null], [1.25, 0.625], [1.25, 0.75], [1.25, 0.875]] as Array<[number, number | null]>) { setRepeatParams({ ...base, peak: pk, qualityShare: qs }); const r = planRepeat(ixw, t, null);
    p(`## ${label} · неделя ${wk} · пик ${pk} · качество по практике ${qs == null ? "выключено" : qs}`);
    if (r.kind === "repeat") { p(`образец ${r.base.weekStart} (${r.base.total} мин); ${r.deltaWhy}`); for (const s of r.sessions) p(`- день ${s.dayIdx} · ${s.kind} · ${s.title} · ${s.minutes} мин`); p(`итого ${r.sessions.reduce((x, s) => x + s.minutes, 0)} мин`); } else p(r.kind);
    p(); }
  const w = ixw.byAid.get(aid)!.slice(-9).map((x) => `${x.weekStart}: ${x.total} мин, качество ${x.qCount}`); p(`Её последние недели: ${w.join(" | ")}`);
}
writeFileSync(path.join(OUT_DIR, "r15-quality-backtest.md"), out.join("\n") + "\n");
console.log(out.join("\n"));
