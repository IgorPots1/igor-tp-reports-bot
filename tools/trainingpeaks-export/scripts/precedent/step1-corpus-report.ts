/**
 * Шаг 1 — КОРПУС НЕДЕЛЬ: сколько, у кого, какие состояния покрыты густо, какие пусто. READ-ONLY.
 * Запуск: npx tsx tools/trainingpeaks-export/scripts/precedent/step1-corpus-report.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { load, OUT_DIR } from "./load.ts";
import type { CWeek } from "./corpus.ts";

const L = load();
const W = L.corpus;
const out: string[] = [];
const p = (s = ""): void => { out.push(s); };
const count = <T>(xs: T[], f: (x: T) => string): Array<[string, number]> => {
  const m = new Map<string, number>(); for (const x of xs) m.set(f(x), (m.get(f(x)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};
const pct = (a: number, b: number): string => `${Math.round(1000 * a / Math.max(1, b)) / 10}%`;

const aids = [...new Set(W.map((w) => w.aid))];
const roster = new Set(L.rosterActive);
const dates = W.map((w) => w.weekStart).sort();
p(`# Шаг 1 · корпус плановых недель тренера`);
p();
p(`Недель (атлето-недель с ≥1 плановой пробежкой, завершённых до ${L.thisMonday}): **${W.length}**`);
p(`Атлетов в корпусе: **${aids.length}**, из них в действующем ростере: ${aids.filter((a) => roster.has(a)).length} (ростер ${roster.size})`);
p(`Окно: ${dates[0]} … ${dates[dates.length - 1]}`);
p();

// ── недель на атлета (только действующие) ──
const perAth = new Map<number, CWeek[]>();
for (const w of W) (perAth.get(w.aid) ?? perAth.set(w.aid, []).get(w.aid)!).push(w);
const activeCounts = [...roster].map((a) => perAth.get(a)?.length ?? 0).sort((a, b) => a - b);
const runningRoster = [...roster].filter((a) => (perAth.get(a)?.length ?? 0) > 0);
p(`## Своих недель у действующих атлетов`);
p(`Действующих с хотя бы одной плановой беговой неделей: ${runningRoster.length} из ${roster.size}`);
for (const [lo, hi] of [[0, 0], [1, 7], [8, 15], [16, 25], [26, 40], [41, 999]] as const) {
  p(`- ${lo === hi ? lo : `${lo}–${hi === 999 ? "…" : hi}`} недель: ${activeCounts.filter((c) => c >= lo && c <= hi).length} атлетов`);
}
const med = activeCounts[Math.floor(activeCounts.length / 2)];
p(`Медиана: ${med} недель на действующего атлета.`);
p();

// ── распределения признаков ──
const show = (title: string, rows: Array<[string, number]>): void => {
  p(`### ${title}`);
  for (const [k, v] of rows) p(`- ${k}: ${v} (${pct(v, W.length)})`);
  p();
};
p(`## Распределения признаков состояния`);
show("Фаза (по стартам из trainingpeaks_race_events и зазорам)", count(W, (w) => w.phase));
show("Объём недели, мин", count(W, (w) => w.volBand).sort((a, b) => a[0].localeCompare(b[0], "ru", { numeric: true })));
show("Беговых дней", count(W, (w) => String(w.days)).sort());
show("Качественных в неделе", count(W, (w) => String(w.qCount)).sort());
show("Тир (по 4-нед. плану, tierOf)", count(W, (w) => w.tier).sort());
show("Дистанция ближайшего старта (≤26 нед)", count(W, (w) => w.distBucket));
show("Активный health-сигнал в неделе", count(W, (w) => (w.ill ? "да" : "нет")));
show("Состав недели ПОВТОРЯЕТ прошлую (дни+роли+минуты)", count(W, (w) => (w.repeatOfPrev ? "повтор" : "новая")));

p(`### Самые частые раскладки ролей по дням (Пн..Вс, Q качество, L длительная, E лёгкая)`);
for (const [k, v] of count(W, (w) => w.roles).slice(0, 15)) p(`- \`${k}\` ${v} (${pct(v, W.length)})`);
p();

// ── покрытие: фаза × объём ──
const phases = ["base", "build", "taper", "race", "post", "return"];
const bands = ["<120", "120-179", "180-239", "240-299", "300-399", "400+"];
const grid = (rowsK: string[], colsK: string[], fr: (w: CWeek) => string, fc: (w: CWeek) => string, title: string): void => {
  p(`### ${title}`);
  p(`| | ${colsK.join(" | ")} |`);
  p(`|---|${colsK.map(() => "---:").join("|")}|`);
  for (const r of rowsK) {
    const cells = colsK.map((c) => { const n = W.filter((w) => fr(w) === r && fc(w) === c).length; return n === 0 ? "**0**" : n < 10 ? `*${n}*` : String(n); });
    p(`| ${r} | ${cells.join(" | ")} |`);
  }
  p(`(жирный 0 — пусто; курсив — меньше 10 недель, т.е. редкое состояние)`);
  p();
};
p(`## Покрытие состояний`);
grid(phases, bands, (w) => w.phase, (w) => w.volBand, "Фаза × объём");
grid(phases, ["1", "2", "3", "4", "5", "6", "7"], (w) => w.phase, (w) => String(w.days), "Фаза × беговых дней");
const w2r = (w: CWeek): string => w.weeksToRace == null ? "нет" : w.weeksToRace === 0 ? "0" : w.weeksToRace <= 2 ? "1-2" : w.weeksToRace <= 4 ? "3-4" : w.weeksToRace <= 8 ? "5-8" : w.weeksToRace <= 12 ? "9-12" : "13-26";
grid(["5к", "10к", "21к", "42к", "ультра"], ["0", "1-2", "3-4", "5-8", "9-12", "13-26"], (w) => w.distBucket, w2r, "Дистанция старта × недель до старта");

// ── у скольких действующих есть свои недели в нужной фазе ──
p(`## Свои недели по фазам у действующих атлетов`);
for (const ph of phases) {
  const n = runningRoster.filter((a) => (perAth.get(a) ?? []).filter((w) => w.phase === ph).length >= 3).length;
  p(`- ${ph}: ≥3 своих недели у ${n} из ${runningRoster.length}`);
}
p();

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(path.join(OUT_DIR, "step1-corpus.md"), out.join("\n") + "\n");
console.log(out.join("\n"));
