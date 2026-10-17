/**
 * R13 — ГДЕ НАСТОЯЩАЯ ГРАНИЦА МЕЖДУ ОБЫЧНОЙ НЕДЕЛЕЙ И ПИКОМ. READ-ONLY.
 * Поводок: неделя Ярулиной 12.10 (239 мин) отсечена порогом 1.25 × медиана = 237.5 с запасом 0.8% — нормальная неделя признана пиком.
 *
 * Часть A — как ведёт себя неделя выше медианы: доля недель, после которых объём ДЕРЖИТСЯ (следующая ≥ 0.9 от неё),
 *           по корзинам отношения к медиане 8 недель. Пик — это всплеск, после которого объём падает; обычная неделя — нет.
 * Часть B — кандидаты правила пика на бэктесте повтора (обучение до SPLIT, проверка SPLIT..VALID_TO; выбор — по ПРОВЕРКЕ, как в r8).
 * Часть C — у скольких из 12 меняется образец (на ближайшую неделю и на последние 8 понедельников).
 * Запуск: npx tsx tools/trainingpeaks-export/scripts/precedent/r13-peak-gap.ts [--week 2026-10-19]
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { addDays, buildCorpus, type CWeek } from "./corpus.ts";
import { load, DATA_DIR, OUT_DIR } from "./load.ts";
import { indexCorpus, type Weights } from "./precedent.ts";
import { aggregate, err, summarise, type Side } from "./metrics.ts";
import { setRepeatParams, planRepeat, type PeakRule } from "./repeat.ts";
import { buildRepeatWeek, setDonorPeakFilter, stateFor, useExplicitParams } from "./build-week.ts";
import { setGuardParams } from "./recent-level.ts";
import { GROUP12 } from "./assemble.ts";

useExplicitParams();
const SPLIT = "2026-03-02"; const TRAIN_FROM = "2025-06-02"; const VALID_TO = "2026-08-17";
const arg = (n: string): string | null => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] ?? null : null; };
const L = load(); const ix = indexCorpus(L.corpus); const roster = new Set(L.rosterActive);
const W = JSON.parse(readFileSync(path.join(DATA_DIR, "tuned-weights.json"), "utf8")) as Weights;
const sorted = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);
const med = (xs: number[]): number => { const s = sorted(xs); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const q = (xs: number[], f: number): number => { const s = sorted(xs); return s.length ? s[Math.min(s.length - 1, Math.floor(f * (s.length - 1)))] : 0; };
const f2 = (x: number): string => x.toFixed(2);
const out: string[] = []; const p = (s = ""): void => { out.push(s); };

// ── Часть A ──
type Obs = { aid: number; ws: string; ratio: number; next: number | null; vsMax: number };
const obs: Obs[] = [];
for (const [aid, ws] of ix.byAid) {
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i]; if (w.phase === "race" || w.phase === "post" || w.phase === "taper" || w.ill) continue;
    const prior = ws.slice(0, i).filter((x) => x.weekStart < w.weekStart).slice(-8); if (prior.length < 3) continue;
    const m = med(prior.map((x) => x.total)); if (m <= 0) continue;
    const nx = ws.find((x) => x.weekStart === addDays(w.weekStart, 7));
    obs.push({ aid, ws: w.weekStart, ratio: w.total / m, next: nx ? nx.total / w.total : null, vsMax: w.total / Math.max(...prior.map((x) => x.total)) });
  }
}
const bins: Array<[number, number]> = [[0, 0.8], [0.8, 1.0], [1.0, 1.1], [1.1, 1.2], [1.2, 1.25], [1.25, 1.3], [1.3, 1.4], [1.4, 1.5], [1.5, 1.75], [1.75, 99]];
p(`# R13 · граница «обычная неделя / пик»`); p();
p(`## A. Держится ли объём после недели (обычные недели без старта/подводки/после старта/сигнала; обучение до ${SPLIT} и всё вместе)`);
p(`«держится» = следующая неделя ≥ 0.9 от этой. Если у корзины держится большинство — это новый уровень, а не пик.`); p();
p(`| отношение к медиане 8 нед | недель (всего) | с известной следующей | держится: обучение | держится: всё | медиана next/this: всё | доля недель в корзине |`); p(`|---|---:|---:|---:|---:|---:|---:|`);
for (const [lo, hi] of bins) {
  const a = obs.filter((o) => o.ratio >= lo && o.ratio < hi); const tr = a.filter((o) => o.ws < SPLIT && o.next != null); const al = a.filter((o) => o.next != null);
  const hold = (xs: Obs[]): string => (xs.length ? `${Math.round(100 * xs.filter((o) => o.next! >= 0.9).length / xs.length)}% (n=${xs.length})` : "—");
  p(`| ${lo}–${hi === 99 ? "∞" : hi} | ${a.length} | ${al.length} | ${hold(tr)} | ${hold(al)} | ${al.length ? f2(med(al.map((o) => o.next!))) : "—"} | ${(100 * a.length / obs.length).toFixed(1)}% |`);
}
p();
const near = obs.filter((o) => o.ratio >= 1.2 && o.ratio < 1.3).length;
p(`Плотность у текущей границы: в полосе 1.20–1.30 лежит ${near} из ${obs.length} недель (${(100 * near / obs.length).toFixed(1)}%) — граница режет не хвост, а тело распределения. Квантили отношения: p50 ${f2(q(obs.map((o) => o.ratio), 0.5))} · p75 ${f2(q(obs.map((o) => o.ratio), 0.75))} · p90 ${f2(q(obs.map((o) => o.ratio), 0.9))} · p95 ${f2(q(obs.map((o) => o.ratio), 0.95))} · p99 ${f2(q(obs.map((o) => o.ratio), 0.99))}.`);
p();

// ── Часть B ──
const iqrRule = (m: number, floor: number): PeakRule => (pr, t) => { const md = med(pr); const iqr = q(pr, 0.75) - q(pr, 0.25); return t > Math.max(floor * md, q(pr, 0.75) + m * iqr); };
const cands: Array<{ name: string; rule: PeakRule | null; peak?: number }> = [
  { name: "текущее: 1.25 × медиана", rule: null, peak: 1.25 },
  ...[1.3, 1.35, 1.4, 1.5, 1.6].map((k) => ({ name: `${k} × медиана`, rule: null, peak: k })),
  ...[0, 0.05, 0.1, 0.15].map((g) => ({ name: `выше максимума 8 нед на ${Math.round(g * 100)}%`, rule: ((pr: number[], t: number) => t > Math.max(...pr) * (1 + g)) as PeakRule })),
  ...[0.5, 1, 1.5].map((m) => ({ name: `q75 + ${m}·IQR (пол 1.15×мед)`, rule: iqrRule(m, 1.15) })),
  { name: "пик отключён", rule: null, peak: 0 },
];
const side = (w: CWeek): Side => summarise(w.sessions.filter((s) => !s.race).map((s) => ({ minutes: s.minutes, kind: s.kind, dayIdx: s.dayIdx, work: s.work })));
const train = ix.all.filter((w) => w.weekStart >= TRAIN_FROM && w.weekStart < SPLIT && w.avg4 > 0);
const valid = ix.all.filter((w) => w.weekStart >= SPLIT && w.weekStart < VALID_TO && roster.has(w.aid) && w.avg4 > 0);
const base = { skip: ["старт", "после старта", "подводка", "пик", "провал объёма"] as never, normal: 0.8, gap: 2, lookback: 10, recovery: true, recoveryTable: "train" as const };
function score(ts: CWeek[]): { score: number; n: number; under: number } {
  const es = []; for (const t of ts) { const b = buildRepeatWeek(ix, t, W, null, undefined, L.names); if (!b || b.refused) continue; es.push(err(side(t), summarise(b.sessions.map((s) => ({ minutes: s.minutes, kind: s.kind, dayIdx: s.dayIdx, work: s.work }))))); }
  const a = aggregate(es); return { score: a.score, n: a.n, under: a.under };
}
p(`## B. Кандидаты правила пика на бэктесте повтора`);
p(`Обучение ${TRAIN_FROM}..${SPLIT}, проверка ${SPLIT}..${VALID_TO}; балл ниже — лучше. Выбор по ПРОВЕРКЕ; разница меньше 0.01 — не различие (урок 15.10).`); p();
p(`| правило | балл: обучение | балл: проверка | выдано (пров.) | недодано >15% (пров.) |`); p(`|---|---:|---:|---:|---:|`);
const res: Array<{ name: string; tr: number; va: number }> = [];
setGuardParams({ gap: 4, ratio: 1.5 }); setDonorPeakFilter(true);
for (const c of process.argv.includes("--only-c") ? [] : cands) {
  setRepeatParams({ ...base, peak: c.peak ?? 1.25, peakRule: c.rule });
  const a = score(train), b = score(valid); res.push({ name: c.name, tr: a.score, va: b.score });
  p(`| ${c.name} | ${a.score} | ${b.score} | ${b.n} | ${b.under}% |`);
}
p();

// ── Часть C ──
const weeks = [arg("week") ?? "2026-10-19", ...Array.from({ length: 8 }, (_, i) => addDays(arg("week") ?? "2026-10-19", -7 * (i + 1)))];
const chosenName = arg("rule") ?? null;
const pick = cands.find((c) => c.name === chosenName) ?? cands[1];
p(`## C. У скольких из 12 меняется образец: «текущее 1.25» против «${pick.name}»`); p();
p(`| неделя | атлет | образец сейчас | образец новый | |`); p(`|---|---|---|---|---|`);
let changed = 0, total = 0;
for (const wk of weeks) {
  const ixw = indexCorpus(buildCorpus(L.rows, L.races, L.sig, L.students, wk));
  for (const aid of GROUP12) {
    const t = stateFor(ixw, aid, wk, L.races.filter((r) => r.trainingpeaks_athlete_id === aid), false);
    setRepeatParams({ ...base, peak: 1.25, peakRule: null }); const a = planRepeat(ixw, t, null);
    setRepeatParams({ ...base, peak: pick.peak ?? 1.25, peakRule: pick.rule }); const b = planRepeat(ixw, t, null);
    const d = (x: ReturnType<typeof planRepeat>): string => (x.kind === "repeat" ? `${x.base.weekStart} (${x.base.total} мин)` : x.kind);
    total++; const ch = d(a) !== d(b); if (ch) changed++;
    if (ch || wk === weeks[0]) p(`| ${wk} | ${L.names.get(aid) ?? aid} | ${d(a)} | ${d(b)} | ${ch ? "**изменился**" : ""} |`);
  }
}
p(); p(`Изменился образец: ${changed} из ${total} (атлето-недель); на ближайшую неделю — ${weeks.length ? "см. строки первой недели" : ""}.`);
if (!process.argv.includes("--only-c")) writeFileSync(path.join(OUT_DIR, "r13-peak-gap.md"), out.join("\n") + "\n");
console.log(out.join("\n"));
