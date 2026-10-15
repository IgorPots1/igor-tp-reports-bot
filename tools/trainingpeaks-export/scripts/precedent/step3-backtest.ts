/**
 * Шаг 3 — МЕРА ПОХОЖЕСТИ И БЭКТЕСТ. READ-ONLY.
 *
 * Прячем неделю тренера, предсказываем её (1) прецедентом, (2) «повтором прошлой недели»
 * — наивный базис, который обязан быть побит, иначе прецедент ничего не добавляет, (3) нынешним
 * генератором по правилам (только последние 8 недель, см. rules-backtest.ts). Сравниваем по осям
 * tp-week-side-by-side.
 *
 * ПОДБОР ВЕСОВ — на неделях ДО SPLIT, оценка — на неделях ПОСЛЕ. Кандидаты в прецеденты всегда
 * строго раньше целевой недели, так что будущее не подсматривается ни там, ни там.
 *
 * Запуск: npx tsx tools/trainingpeaks-export/scripts/precedent/step3-backtest.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { load, DATA_DIR, OUT_DIR } from "./load.ts";
import type { CWeek } from "./corpus.ts";
import { adapt, adaptTransition, needsWholePrecedent, setTransitionBase, type TransitionBase, DEFAULT_WEIGHTS, findPrecedent, indexCorpus, type Mode, type Weights } from "./precedent.ts";
import { aggregate, err, summarise, type Agg, type Err, type Side } from "./metrics.ts";
import { workMinutesFromTitle } from "./corpus.ts";
import type { RulesWeek } from "./rules-backtest.ts";

const SPLIT = "2026-03-02";
const TRAIN_FROM = "2025-06-02";

const L = load();
const ix = indexCorpus(L.corpus);
const roster = new Set(L.rosterActive);
const actualSide = (w: CWeek): Side => summarise(w.sessions.filter((s) => !s.race).map((s) => ({ minutes: s.minutes, kind: s.kind, dayIdx: s.dayIdx, work: s.work })));

function predictPrecedent(t: CWeek, W: Weights, mode: Mode): Side | null {
  const f = findPrecedent(ix, t, W, mode); if (!f) return null;
  const a = adapt(ix, t, f);
  return summarise(a.sessions.map((s) => ({ minutes: s.minutes, kind: s.kind, dayIdx: s.dayIdx, work: s.work })));
}
function predictTransition(t: CWeek, W: Weights, hybrid: boolean): Side | null {
  const f = findPrecedent(ix, t, W, "any"); if (!f) return null;
  const a = hybrid && needsWholePrecedent(t) ? adapt(ix, t, f) : adaptTransition(ix, t, f);
  if (!a) return null;
  return summarise(a.sessions.map((s) => ({ minutes: s.minutes, kind: s.kind, dayIdx: s.dayIdx, work: s.work })));
}
function predictPersistence(t: CWeek): Side | null {
  const prev = (ix.byAid.get(t.aid) ?? []).filter((w) => w.weekStart < t.weekStart).pop();
  return prev ? actualSide(prev) : null;
}
function evalSet(ts: CWeek[], f: (t: CWeek) => Side | null): { agg: Agg; es: Err[]; miss: number } {
  const es: Err[] = []; let miss = 0;
  for (const t of ts) { const p = f(t); if (!p) { miss++; continue; } es.push(err(actualSide(t), p)); }
  return { agg: aggregate(es), es, miss };
}

// ── наборы ──
const hasHist = (w: CWeek): boolean => w.avg4 > 0;
const train = ix.all.filter((w) => w.weekStart >= TRAIN_FROM && w.weekStart < SPLIT && hasHist(w));
const test = ix.all.filter((w) => w.weekStart >= SPLIT && roster.has(w.aid) && hasHist(w));
// для подбора — детерминированная подвыборка (каждая 3-я), иначе перебор долгий
const trainSub = train.filter((_, i) => i % 3 === 0);

// ── подбор весов: детерминированный случайный поиск вокруг ручной стартовой точки ──
let seed = 42; const rnd = (): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const keys = Object.keys(DEFAULT_WEIGHTS) as Array<keyof Weights>;
const tried: Array<{ w: Weights; s: number }> = [];
let best = { w: DEFAULT_WEIGHTS, s: evalSet(trainSub, (t) => predictPrecedent(t, DEFAULT_WEIGHTS, "any")).agg.score };
tried.push(best);
for (let i = 0; i < 40; i++) {
  const w = { ...best.w };
  for (const k of keys) if (rnd() < 0.5) w[k] = Math.round(100 * Math.max(0, w[k] * (0.4 + 1.4 * rnd()) + (rnd() < 0.15 ? 0.3 : 0))) / 100;
  const s = evalSet(trainSub, (t) => predictPrecedent(t, w, "any")).agg.score;
  tried.push({ w, s });
  if (s < best.s) best = { w, s };
}
const TUNED = best.w;

// ── база перехода: от прошлой недели или от уровня 4 недель — по ОБУЧАЮЩЕМУ отрезку ──
const baseScore: Record<TransitionBase, number> = { prev: 0, level: 0, none: 0 };
for (const b of ["prev", "level", "none"] as const) {
  setTransitionBase(b);
  baseScore[b] = evalSet(trainSub, (t) => predictTransition(t, TUNED, true)).agg.score;
}
const BASE = (Object.entries(baseScore) as Array<[TransitionBase, number]>).sort((a, b) => a[1] - b[1])[0][0];
setTransitionBase(BASE);

const withBase = <T,>(b: TransitionBase, f: () => T): T => { setTransitionBase(b); try { return f(); } finally { setTransitionBase(BASE); } };

// ── оценка на тесте ──
const out: string[] = [];
const p = (s = ""): void => { out.push(s); };
const row = (name: string, a: Agg, miss = 0): string =>
  `| ${name} | ${a.n}${miss ? ` (−${miss})` : ""} | ${a.bias > 0 ? "+" : ""}${a.bias} | ${a.under}% | ${a.totalMae} | ${a.totalMape}% | ${a.within15}% | ${a.daysExact}% | ${a.qExact}% | ${a.longDayHit}% | ${a.qDayHit}% | ${a.longestMae} | ${a.longestEasyMae} | ${a.workMae} | ${a.shortestMae} | ${a.underMae} | ${a.score} |`;
const HDR = `| метод | недель | смещение суммы, мин | недодано >15% | сумма MAE, мин | сумма MAPE | сумма ±15% | дни точно | кач-х точно | день длит. | день кач. | длит. MAE | дл.лёгк MAE | работа MAE | кратч. MAE | <45 MAE | балл↓ |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|`;

p(`# Шаг 3 · мера похожести и бэктест`);
p();
p(`Подбор весов: ${trainSub.length} недель (${TRAIN_FROM} … ${SPLIT}, каждая 3-я), 41 конфигурация. Оценка: ${test.length} недель действующих атлетов с ${SPLIT}.`);
p(`Балл на подборе: стартовые веса ${tried[0].s}, лучшие ${best.s}.`);
p(`База перехода по обучающему отрезку: prev ${baseScore.prev}, level ${baseScore.level}, none (повтор) ${baseScore.none} → взята «${BASE}».`);
p(`Веса после подбора: ${keys.map((k) => `${k}=${TUNED[k]}`).join(", ")}`);
p();
p(`## A. Прецедент против «повтора прошлой недели» — ${test.length} недель (${SPLIT} … последняя завершённая)`);
p(HDR);
const A: Array<[string, ReturnType<typeof evalSet>]> = [
  ["повтор прошлой недели", evalSet(test, predictPersistence)],
  ["прецедент (свои+чужие, подобранные веса)", evalSet(test, (t) => predictPrecedent(t, TUNED, "any"))],
  ["прецедент (свои+чужие, стартовые веса)", evalSet(test, (t) => predictPrecedent(t, DEFAULT_WEIGHTS, "any"))],
  ["ПЕРЕХОД: прошлая неделя × шаг прецедента", withBase("prev", () => evalSet(test, (t) => predictTransition(t, TUNED, false)))],
  [`ГИБРИД (итог): ${BASE === "none" ? "повтор" : "переход " + BASE}, а в неделю старта — целая неделя прецедента`, evalSet(test, (t) => predictTransition(t, TUNED, true))],
  ["прецедент только свои", evalSet(test, (t) => predictPrecedent(t, TUNED, "own"))],
  ["прецедент только чужие", evalSet(test, (t) => predictPrecedent(t, TUNED, "others"))],
];
for (const [n, r] of A) p(row(n, r.agg, r.miss));
p();

// ── B: на тех же неделях, что и генератор по правилам ──
const rules = JSON.parse(readFileSync(path.join(DATA_DIR, "rules-weeks.json"), "utf8")) as RulesWeek[];
const rulesBy = new Map(rules.map((r) => [`${r.aid}|${r.weekStart}`, r]));
const rulesSide = (r: RulesWeek): Side => summarise(r.sessions.filter((s) => !s.deferred).map((s) => ({
  minutes: s.minutes, kind: s.role === "quality" ? "quality" : s.role === "long" ? "long" : "easy", dayIdx: s.dayIdx,
  work: s.role === "quality" ? workMinutesFromTitle(s.title) : 0,
})));
const bSet = ix.all.filter((w) => rulesBy.has(`${w.aid}|${w.weekStart}`));
const bHist = bSet.filter(hasHist);
p(`## B. Три подхода на ОДНИХ И ТЕХ ЖЕ неделях — последние 8 завершённых (${rules.map((r) => r.weekStart).sort()[0]} … ${rules.map((r) => r.weekStart).sort().pop()})`);
p(`Неделя тренера есть у ${bSet.length} из ${rules.length} атлето-недель сборщика; с историей (≥1 неделя в 4 предыдущих) — ${bHist.length}.`);
p(HDR);
const B: Array<[string, ReturnType<typeof evalSet>]> = [
  ["генератор по правилам (нынешний)", evalSet(bHist, (t) => { const r = rulesBy.get(`${t.aid}|${t.weekStart}`); return r ? rulesSide(r) : null; })],
  ["повтор прошлой недели", evalSet(bHist, predictPersistence)],
  ["прецедент (подобранные веса)", evalSet(bHist, (t) => predictPrecedent(t, TUNED, "any"))],
  ["ПЕРЕХОД: прошлая неделя × шаг прецедента", withBase("prev", () => evalSet(bHist, (t) => predictTransition(t, TUNED, false)))],
  ["ГИБРИД (итог)", evalSet(bHist, (t) => predictTransition(t, TUNED, true))],
  ["прецедент только свои", evalSet(bHist, (t) => predictPrecedent(t, TUNED, "own"))],
  ["прецедент только чужие", evalSet(bHist, (t) => predictPrecedent(t, TUNED, "others"))],
];
for (const [n, r] of B) p(row(n, r.agg, r.miss));
p();

// ── B по фазам ──
p(`### B по фазам: сумма MAPE / дни точно / качественных точно`);
p(`| фаза | недель | правила | повтор | прецедент | гибрид |`);
p(`|---|---:|---|---|---|---|`);
for (const ph of ["base", "build", "taper", "race", "post", "return"]) {
  const s = bHist.filter((w) => w.phase === ph); if (!s.length) continue;
  const f = (r: ReturnType<typeof evalSet>): string => `${r.agg.totalMape}% / ${r.agg.daysExact}% / ${r.agg.qExact}%`;
  p(`| ${ph} | ${s.length} | ${f(evalSet(s, (t) => { const r = rulesBy.get(`${t.aid}|${t.weekStart}`); return r ? rulesSide(r) : null; }))} | ${f(evalSet(s, predictPersistence))} | ${f(evalSet(s, (t) => predictPrecedent(t, TUNED, "any")))} | ${f(evalSet(s, (t) => predictTransition(t, TUNED, true)))} |`);
}
p();

// ── откуда берутся прецеденты ──
let own = 0, others = 0; const ownByCount: Record<string, [number, number]> = {};
for (const t of test) {
  const f = findPrecedent(ix, t, TUNED, "any"); if (!f) continue;
  const isOwn = f.p.aid === t.aid; if (isOwn) own++; else others++;
  const b = f.ownAvailable < 8 ? "<8" : f.ownAvailable < 16 ? "8-15" : f.ownAvailable < 26 ? "16-25" : "26+";
  ownByCount[b] ??= [0, 0]; ownByCount[b][isOwn ? 0 : 1]++;
}
p(`## Откуда прецедент (тест A)`);
p(`Своя неделя выбрана в ${own} случаях, чужая в ${others} (${Math.round(100 * others / Math.max(1, own + others))}%).`);
for (const [b, [o, x]] of Object.entries(ownByCount)) p(`- своих недель в истории ${b}: своя ${o}, чужая ${x}`);
p();
p(`## Подбор весов: 10 лучших конфигураций`);
for (const t of [...tried].sort((a, b) => a.s - b.s).slice(0, 10)) p(`- ${t.s} · ${keys.map((k) => `${k}=${t.w[k]}`).join(" ")}`);

writeFileSync(path.join(OUT_DIR, "step3-backtest.md"), out.join("\n") + "\n");
writeFileSync(path.join(DATA_DIR, "tuned-weights.json"), JSON.stringify(TUNED));
writeFileSync(path.join(DATA_DIR, "transition-base.json"), JSON.stringify(BASE));
console.log(out.join("\n"));
