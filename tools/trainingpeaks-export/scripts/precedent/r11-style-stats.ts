/**
 * R11 — У СКОЛЬКИХ ИЗМЕНИЛИСЬ НАЗВАНИЯ после подмены донорского стиля. READ-ONLY.
 * (а) 809 недель бэктеста: из недель ветки прецедента — у скольких чужой донор, у скольких подмена что-то поменяла;
 *     стиль «по пульсу / по темпу» противоположен стилю атлета: до и после подмены.
 * (б) группа 12, неделя 19.10 (сухой прогон): кому подменено, что именно.
 * Запуск: npx tsx tools/trainingpeaks-export/scripts/precedent/r11-style-stats.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { load, DATA_DIR, OUT_DIR } from "./load.ts";
import { adapt, indexCorpus, type PSess, type Weights } from "./precedent.ts";
import { planRepeat, setRepeatParams } from "./repeat.ts";
import { selectDonor, stateFor, resolveExplicitParams } from "./build-week.ts";
import { substituteDonorStyle } from "./donor-style.ts";
import { addDays } from "./corpus.ts";
import type { RulesWeek } from "./rules-backtest.ts";

resolveExplicitParams();
const L = load(); const ix = indexCorpus(L.corpus);
const W = JSON.parse(readFileSync(path.join(DATA_DIR, "tuned-weights.json"), "utf8")) as Weights;
setRepeatParams({ normal: 0.8, gap: 2, lookback: 10, peak: 1.25, recovery: true, recoveryTable: "train" });
const rules = new Map((JSON.parse(readFileSync(path.join(DATA_DIR, "rules-weeks.json"), "utf8")) as RulesWeek[]).map((r) => [`${r.aid}|${r.weekStart}`, r]));
const pulse = (titles: string[]): number => (titles.length ? titles.filter((t) => /пульс/i.test(t)).length / titles.length : NaN);
const opposite = (a: number, b: number): boolean => Number.isFinite(a) && Number.isFinite(b) && ((a > 0.5 && b < 0.2) || (a < 0.2 && b > 0.5));
const ownTitles = (aid: number, before: string): string[] => (ix.byAid.get(aid) ?? []).filter((w) => w.weekStart < before).slice(-8).flatMap((w) => w.sessions.filter((s) => !s.race).map((s) => s.title));
const out: string[] = []; const p = (s = ""): void => { out.push(s); };

// (а)
const bSet = ix.all.filter((w) => rules.has(`${w.aid}|${w.weekStart}`) && w.avg4 > 0);
let prec = 0, foreign = 0, changedWeeks = 0, sessChanged = 0, sessConsidered = 0, oppBefore = 0, oppAfter = 0, comparable = 0;
for (const t of bSet) {
  if (planRepeat(ix, t, null).kind !== "precedent") continue; prec++;
  const f = selectDonor(ix, t, W); if (!f || f.p.aid === t.aid) continue; foreign++;
  const base = adapt(ix, t, f, false).sessions; const st = substituteDonorStyle(ix, t, base, f.p.aid);
  const nonQ = (ss: PSess[]): string[] => ss.filter((s) => s.kind !== "quality").map((s) => s.title);
  const before = nonQ(base), after = nonQ(st.sessions); let ch = 0;
  base.forEach((s, i) => { if (s.kind !== "quality" && st.sessions[i].title !== s.title) ch++; });
  sessConsidered += st.considered; sessChanged += ch; if (ch > 0) changedWeeks++;
  const own = pulse(ownTitles(t.aid, t.weekStart)); const b = pulse(before), a = pulse(after);
  if (Number.isFinite(own) && Number.isFinite(b)) { comparable++; if (opposite(own, b)) oppBefore++; if (opposite(own, a)) oppAfter++; }
}
p(`# R11 · подмена названий чужого донора`);
p();
p(`## (а) 809 недель бэктеста (17.08–05.10)`);
p(`- недель по ветке прецедента: ${prec}; из них с ЧУЖИМ донором: ${foreign}`);
p(`- у скольких недель подмена хоть что-то изменила в названиях: **${changedWeeks} из ${foreign}**; сессий (лёгкие и длительная без качества) изменено: ${sessChanged} из ${sessConsidered}`);
p(`- стиль «по пульсу / по темпу» противоположен стилю атлета: до подмены ${oppBefore} из ${comparable} сравнимых, после — ${oppAfter}`);
p();

// (б)
p(`## (б) группа 12, неделя 19.10`);
const GROUP = [5733446, 5475652, 5476215, 6009851, 5931798, 5905779, 5748681, 5475750, 5475968, 5461678, 5807145, 6290336];
const week = addDays(L.thisMonday, 7);
for (const aid of GROUP) {
  const nm = L.names.get(aid) ?? String(aid);
  const t = stateFor(ix, aid, week, L.races.filter((r) => r.trainingpeaks_athlete_id === aid), false);
  const pl = planRepeat(ix, t, null);
  if (pl.kind !== "precedent") { p(`- ${nm}: ${pl.kind === "repeat" ? "повтор своей недели — названия свои, подмена не нужна" : "ОТКАЗ — недели нет"}`); continue; }
  const f = selectDonor(ix, t, W); if (!f) { p(`- ${nm}: донора нет`); continue; }
  if (f.p.aid === t.aid) { p(`- ${nm}: прецедент своей недели — подмены нет`); continue; }
  const base = adapt(ix, t, f, false).sessions; const st = substituteDonorStyle(ix, t, base, f.p.aid);
  const diffs = base.map((s, i) => (s.kind !== "quality" && st.sessions[i].title !== s.title ? `«${s.title}» → «${st.sessions[i].title}»` : null)).filter(Boolean);
  p(`- ${nm}: прецедент, чужой донор; подменено ${diffs.length} из ${st.considered}${diffs.length ? `: ${diffs.join("; ")}` : ""}`);
}
writeFileSync(path.join(OUT_DIR, "r11-style-stats.md"), out.join("\n") + "\n");
console.log(out.join("\n"));
