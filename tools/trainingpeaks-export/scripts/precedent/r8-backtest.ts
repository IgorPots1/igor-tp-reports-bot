/**
 * R8 — БЭКТЕСТ ПОСЛЕ ГРАНИЦ БЕЗОПАСНОСТИ. Заменяет r2-backtest.ts. READ-ONLY.
 *
 * Метод 5 теперь проходит весь путь выдачи (buildRepeatWeek): повтор нормальной недели + дельта цикла +
 * таблица восстановления + «пик» и подводка не образцы + жёсткие отказы (нет недавней истории, неделя выше
 * 1.5 × уровня, качество на 1–3-й неделе после марафона). Отказанная неделя в метрики не входит и считается
 * отдельно; чтобы сравнение было честным, есть вторая таблица — ВСЕ методы на тех неделях, что метод 5 выдал.
 *
 * ВЫБОР свободных параметров (порог провала, длина паузы для прецедента) — по непересекающейся ПРОВЕРКЕ
 * 02.03–16.08; тест — последние 8 недель. Решения Игоря (пик, подводка, таблица, отказ без истории) НЕ выбираются
 * по баллу — их цена показывается отдельными строками «(разбор)».
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { workMinutesFromTitle, type CWeek } from "./corpus.ts";
import { load, DATA_DIR, OUT_DIR } from "./load.ts";
import { adapt, findPrecedent, indexCorpus, type PSess, type Weights } from "./precedent.ts";
import { aggregate, err, summarise, type Agg, type Err, type Side } from "./metrics.ts";
import { setRepeatParams, NORMAL_MIN_RATIO, RETURN_GAP_WEEKS, LOOKBACK_WEEKS, type Abnormal, type CycleDelta } from "./repeat.ts";
import { buildRepeatWeek, setDonorPeakFilter, useExplicitParams, type BuiltWeek } from "./build-week.ts";
import { setGuardParams } from "./recent-level.ts";
import type { RulesWeek } from "./rules-backtest.ts";

useExplicitParams();
const SPLIT = "2026-03-02"; const TRAIN_FROM = "2025-06-02"; const VALID_TO = "2026-08-17";
const L = load(); const ix = indexCorpus(L.corpus);
const roster = new Set(L.rosterActive);
const W = JSON.parse(readFileSync(path.join(DATA_DIR, "tuned-weights.json"), "utf8")) as Weights;
const side = (w: CWeek): Side => summarise(w.sessions.filter((s) => !s.race).map((s) => ({ minutes: s.minutes, kind: s.kind, dayIdx: s.dayIdx, work: s.work })));
const sideP = (ss: Array<{ minutes: number; kind: string; dayIdx: number; work: number }>): Side => summarise(ss.map((s) => ({ minutes: s.minutes, kind: s.kind, dayIdx: s.dayIdx, work: s.work })));
const loadRules = (p: string): Map<string, RulesWeek> => existsSync(p) ? new Map((JSON.parse(readFileSync(p, "utf8")) as RulesWeek[]).map((r) => [`${r.aid}|${r.weekStart}`, r])) : new Map();
const rulesNow = loadRules(path.join(DATA_DIR, "rules-weeks.json"));
const rulesOrig = loadRules(path.join(OUT_DIR, "orig", "data", "rules-weeks.json"));
const rulesSide = (r: RulesWeek): Side => summarise(r.sessions.filter((s) => !s.deferred).map((s) => ({
  minutes: s.minutes, kind: s.role === "quality" ? "quality" : s.role === "long" ? "long" : "easy", dayIdx: s.dayIdx, work: s.role === "quality" ? workMinutesFromTitle(s.title) : 0 })));

// ── методы ──
const prevOwn = (t: CWeek): CWeek | undefined => (ix.byAid.get(t.aid) ?? []).filter((w) => w.weekStart < t.weekStart).pop();
const mPersist = (t: CWeek): Side | null => { const p = prevOwn(t); return p ? side(p) : null; };
const mWhole = (t: CWeek): Side | null => { const f = findPrecedent(ix, t, W, "any"); return f ? sideP(adapt(ix, t, f).sessions) : null; };
const mOldHybrid = (t: CWeek): Side | null => (t.phase === "race" ? mWhole(t) : mPersist(t));
const cycleOf = (t: CWeek): CycleDelta => { const c = rulesNow.get(`${t.aid}|${t.weekStart}`)?.cycle; return c ? { role: c.role, target: c.target, base: c.base } : null; };
const cache = new Map<string, BuiltWeek | null>();
let cacheTag = "";
function built(t: CWeek, useCycle: boolean): BuiltWeek | null {
  const k = `${cacheTag}|${t.aid}|${t.weekStart}|${useCycle}`;
  if (!cache.has(k)) cache.set(k, buildRepeatWeek(ix, t, W, useCycle ? cycleOf(t) : null, undefined, L.names));
  return cache.get(k)!;
}
const mNew = (useCycle: boolean) => (t: CWeek): Side | null => { const b = built(t, useCycle); return !b || b.refused ? null : sideP(b.sessions); };

function evalSet(ts: CWeek[], f: (t: CWeek) => Side | null): { agg: Agg; miss: number } {
  const es: Err[] = []; let miss = 0;
  for (const t of ts) { const p = f(t); if (!p) { miss++; continue; } es.push(err(side(t), p)); }
  return { agg: aggregate(es), miss };
}

// ── выбор свободных параметров по ПРОВЕРКЕ ──
const train = ix.all.filter((w) => w.weekStart >= TRAIN_FROM && w.weekStart < SPLIT && w.avg4 > 0);
const valid = ix.all.filter((w) => w.weekStart >= SPLIT && w.weekStart < VALID_TO && roster.has(w.aid) && w.avg4 > 0);
const CLASSES: Abnormal[] = ["старт", "после старта", "подводка", "пик", "провал объёма"]; // решение Игоря: фиксировано
const grid: Array<{ normal: number; gap: number; lookback: number; train: number; valid: number }> = [];
for (const normal of [0.6, 0.8]) for (const gap of [2, 3, 99]) for (const lookback of [6, 10, 14]) {
  cacheTag = `g${normal}-${gap}-${lookback}`; setRepeatParams({ skip: CLASSES, normal, gap, lookback });
  grid.push({ normal, gap, lookback, train: evalSet(train, mNew(false)).agg.score, valid: evalSet(valid, mNew(false)).agg.score });
}
grid.sort((a, b) => a.valid - b.valid || a.train - b.train);
const CHOSEN = grid[0];
cacheTag = "final"; setRepeatParams({ skip: CLASSES, normal: CHOSEN.normal, gap: CHOSEN.gap, lookback: CHOSEN.lookback, peak: 1.25, recovery: true, recoveryTable: "train" }); setGuardParams({ gap: 4, ratio: 1.5 }); setDonorPeakFilter(true);

// ── вывод ──
const out: string[] = []; const p = (s = ""): void => { out.push(s); };
const HDR = `| метод | недель | смещение суммы | недодано >15% | сумма MAE | сумма MAPE | ±15% | дни точно | кач-х точно | день длит. | день кач. | длит. MAE | работа MAE | балл↓ |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|`;
const row = (n: string, r: { agg: Agg; miss: number }): string => { const a = r.agg;
  return `| ${n} | ${a.n}${r.miss ? ` (отказ/нет: ${r.miss})` : ""} | ${a.bias > 0 ? "+" : ""}${a.bias} | ${a.under}% | ${a.totalMae} | ${a.totalMape}% | ${a.within15}% | ${a.daysExact}% | ${a.qExact}% | ${a.longDayHit}% | ${a.qDayHit}% | ${a.longestMae} | ${a.workMae} | **${a.score}** |`; };

p(`# R8 · бэктест после границ безопасности`);
p();
p(`Свободные параметры выбраны по ПРОВЕРКЕ 02.03–16.08 (${valid.length} недель), без пересечения с тестом: порог провала ${CHOSEN.normal}, прецедент при паузе ≥ ${CHOSEN.gap === 99 ? "∞ (не включается)" : CHOSEN.gap + " нед"}, окно поиска образца ${CHOSEN.lookback} нед.`);
p(`Перебор (балл на проверке): ${grid.slice(0, 6).map((g) => `порог ${g.normal}/пауза ${g.gap === 99 ? "∞" : g.gap}/окно ${g.lookback} → ${g.valid}`).join("; ")} … худший ${grid[grid.length - 1].valid}`);
p(`Решения Игоря (не выбирались по баллу): образцом не служат старт, неделя после старта (по таблице), подводка перед главным стартом, ПИК (>1.25 × медианы 8 недель), провал; восстановление по дистанции; отказ без недавней истории (пауза ≥4 нед или <3 своих недель за 8); отказ при неделе >1.5 × p75 недавнего плана; на 1–3-й неделе после марафона качества нет.`);
p();
const bSet = ix.all.filter((w) => rulesNow.has(`${w.aid}|${w.weekStart}`) && w.avg4 > 0);
p(`## Главное: все методы на тех же ${bSet.length} атлето-неделях (последние 8 завершённых)`);
p(HDR);
const methods: Array<[string, (t: CWeek) => Side | null]> = [
  ["1. генератор по правилам — как в main", (t) => { const r = rulesOrig.get(`${t.aid}|${t.weekStart}`); return r ? rulesSide(r) : null; }],
  ["2. повтор прошлой недели", mPersist],
  ["3. прецедент целиком", mWhole],
  ["4. прежний гибрид (повтор + прецедент в неделю старта)", mOldHybrid],
  ["5. ПОВТОР + ДЕЛЬТА + ГРАНИЦЫ БЕЗОПАСНОСТИ (метод 5 с отказами)", mNew(true)],
];
for (const [n, f] of methods) p(row(n, evalSet(bSet, f)));
p();
// ── вторая таблица: на неделях, которые метод 5 ВЫДАЛ ──
const issued = bSet.filter((t) => mNew(true)(t) != null);
p(`## Честное сравнение: те же методы только на ${issued.length} неделях, которые метод 5 выдал (${bSet.length - issued.length} отказов не входят ни в один метод)`);
p(HDR);
for (const [n, f] of methods) p(row(n, evalSet(issued, f)));
p();
// ── цена решений ──
p(`## Цена решений Игоря (метод 5, те же ${bSet.length} недель; отказы не входят в балл, число отказов в скобках)`);
p(HDR);
const diag = (name: string, fn: () => void): void => { cacheTag = `d-${name}`; fn(); const r = evalSet(bSet, mNew(true)); p(row(name, r)); cacheTag = "final"; setRepeatParams({ skip: CLASSES, normal: CHOSEN.normal, gap: CHOSEN.gap, lookback: CHOSEN.lookback, peak: 1.25, recovery: true, recoveryTable: "train" }); setGuardParams({ gap: 4, ratio: 1.5 }); setDonorPeakFilter(true); };
p(row("5. как выше (все решения включены)", evalSet(bSet, mNew(true))));
diag("(разбор) без класса «пик»", () => setRepeatParams({ skip: CLASSES.filter((c) => c !== "пик") }));
diag("(разбор) без подводки в не-образцах", () => setRepeatParams({ skip: CLASSES.filter((c) => c !== "подводка") }));
diag("(разбор) без таблицы восстановления", () => setRepeatParams({ recovery: false }));
diag("(разбор) таблица по ВСЕМУ корпусу (включая тест; прежняя, до +7)", () => setRepeatParams({ recoveryTable: "all" }));
diag("(разбор) без исключения доноров-пиков", () => setDonorPeakFilter(false));
diag("(разбор) без жёстких отказов (граница ослаблена)", () => setGuardParams({ gap: 99999, ratio: 1e9 }));
p();
// ── отказы по причинам и по фазам ──
const reasons = new Map<string, number>(); let refusedN = 0;
for (const t of bSet) { const b = built(t, true); if (b?.refused) { refusedN++; const k = (b.refusedWhy ?? "?").replace(/\d+/g, "N").slice(0, 110); reasons.set(k, (reasons.get(k) ?? 0) + 1); } }
p(`## Отказы метода 5: ${refusedN} из ${bSet.length} (${Math.round(1000 * refusedN / bSet.length) / 10}%)`);
for (const [k, n] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) p(`- ${n} · ${k}`);
p();
p(`### По фазам — сумма MAPE / дни точно / кач-х точно (на выданных)`);
p(`| фаза | недель | выдано | правила (main) | повтор | прежний гибрид | метод 5 |`);
p(`|---|---:|---:|---|---|---|---|`);
for (const ph of ["base", "build", "taper", "race", "post", "return"]) {
  const s = bSet.filter((w) => w.phase === ph); if (!s.length) continue; const is = s.filter((t) => mNew(true)(t) != null);
  const f = (fn: (t: CWeek) => Side | null): string => { const a = evalSet(is, fn).agg; return is.length ? `${a.totalMape}% / ${a.daysExact}% / ${a.qExact}%` : "—"; };
  p(`| ${ph} | ${s.length} | ${is.length} | ${f(methods[0][1])} | ${f(mPersist)} | ${f(mOldHybrid)} | ${f(mNew(true))} |`);
}
p();
const aSet = ix.all.filter((w) => w.weekStart >= SPLIT && roster.has(w.aid) && w.avg4 > 0);
p(`## Шире: ${aSet.length} недель с ${SPLIT} (без правил; цикла нет)`);
p(HDR);
for (const [n, f] of [["2. повтор прошлой недели", mPersist], ["3. прецедент целиком", mWhole], ["4. прежний гибрид", mOldHybrid], ["5′. метод 5 без цикла, с границами", mNew(false)]] as Array<[string, (t: CWeek) => Side | null]>) p(row(n, evalSet(aSet, f)));

writeFileSync(path.join(OUT_DIR, "r8-backtest.md"), out.join("\n") + "\n");
writeFileSync(path.join(DATA_DIR, "repeat-params.json"), JSON.stringify({ normal: NORMAL_MIN_RATIO, gap: RETURN_GAP_WEEKS, lookback: LOOKBACK_WEEKS }));
console.log(out.join("\n"));
