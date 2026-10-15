/**
 * Шаг 6 — ЧЕСТНЫЕ ГРАНИЦЫ прецедента. READ-ONLY.
 * Сколько атлетов имеют достаточно своих недель; где состояния пусты; застой; редкие дистанции.
 * Запуск: npx tsx tools/trainingpeaks-export/scripts/precedent/step6-limits.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { load, DATA_DIR, OUT_DIR } from "./load.ts";
import { addDays, type CWeek } from "./corpus.ts";
import { adapt, adaptTransition, findPrecedent, indexCorpus, needsWholePrecedent, type Weights } from "./precedent.ts";
import { aggregate, err, summarise, type Err, type Side } from "./metrics.ts";

const L = load();
const ix = indexCorpus(L.corpus);
const TUNED = JSON.parse(readFileSync(path.join(DATA_DIR, "tuned-weights.json"), "utf8")) as Weights;
const roster = [...new Set(L.rosterActive)];
const out: string[] = []; const p = (s = ""): void => { out.push(s); };
const side = (w: CWeek): Side => summarise(w.sessions.map((s) => ({ minutes: s.minutes, kind: s.kind, dayIdx: s.dayIdx, work: s.work })));
const yearAgo = addDays(L.thisMonday, -364);
const halfYear = addDays(L.thisMonday, -182);

p(`# Шаг 6 · где прецедент не работает`);
p();
p(`## Хватает ли своих недель`);
p(`Действующий ростер: ${roster.length}. (В наряде названо 113 — в данных этого числа нет: ростер по is_active/archived_at даёт ${roster.length}, сборщик строит контекст для ${roster.length - 1}, неделя Игоря на последний понедельник есть у 102.)`);
const own = roster.map((a) => ({ a, all: (ix.byAid.get(a) ?? []).length, y: (ix.byAid.get(a) ?? []).filter((w) => w.weekStart >= yearAgo).length, h: (ix.byAid.get(a) ?? []).filter((w) => w.weekStart >= halfYear).length }));
for (const th of [8, 16, 26]) p(`- ≥${th} своих недель за последний год: ${own.filter((x) => x.y >= th).length} из ${roster.length}`);
p(`- своих недель за полгода ≥12 (хватает на «переход» и на свой прецедент в обычной фазе): ${own.filter((x) => x.h >= 12).length}`);
p(`- своих недель нет совсем: ${own.filter((x) => x.all === 0).length}; меньше 4 (переходу не от чего отталкиваться): ${own.filter((x) => x.all > 0 && x.all < 4).length}`);
p();

// по фазам: у скольких есть хотя бы одна СВОЯ неделя этой фазы за год
p(`## Своя неделя нужной фазы за последний год (иначе берём чужую)`);
for (const ph of ["race", "post", "taper", "build", "return"]) {
  const n = roster.filter((a) => (ix.byAid.get(a) ?? []).some((w) => w.weekStart >= yearAgo && w.phase === ph)).length;
  p(`- ${ph}: своя есть у ${n} из ${roster.length}, чужую придётся брать ${roster.length - n}`);
}
p();

// точность по корзинам своей истории (гибрид, тест с 2026-03-02)
const test = ix.all.filter((w) => w.weekStart >= "2026-03-02" && roster.includes(w.aid) && w.avg4 > 0);
const pred = (t: CWeek): Side | null => {
  const f = findPrecedent(ix, t, TUNED, "any"); if (!f) return null;
  const a = needsWholePrecedent(t) ? adapt(ix, t, f) : adaptTransition(ix, t, f); if (!a) return null;
  return summarise(a.sessions.map((s) => ({ minutes: s.minutes, kind: s.kind, dayIdx: s.dayIdx, work: s.work })));
};
p(`## Точность гибрида по длине своей истории (тест с 2026-03-02)`);
p(`| своих недель до целевой | недель | сумма MAPE | дни точно | кач-х точно | прецедент чужой |`);
p(`|---|---:|---:|---:|---:|---:|`);
for (const [lo, hi] of [[0, 7], [8, 15], [16, 25], [26, 999]] as const) {
  const es: Err[] = []; let foreign = 0;
  for (const t of test) {
    const n = (ix.byAid.get(t.aid) ?? []).filter((w) => w.weekStart < t.weekStart).length;
    if (n < lo || n > hi) continue;
    const pr = pred(t); if (!pr) continue; es.push(err(side(t), pr));
    if (findPrecedent(ix, t, TUNED, "any")!.p.aid !== t.aid) foreign++;
  }
  const a = aggregate(es);
  p(`| ${lo}–${hi === 999 ? "…" : hi} | ${a.n} | ${a.totalMape}% | ${a.daysExact}% | ${a.qExact}% | ${Math.round(100 * foreign / Math.max(1, a.n))}% |`);
}
p();

// редкие дистанции и неделя старта
p(`## Неделя старта и подводка по дистанциям (гибрид, тест с 2026-03-02)`);
p(`| дистанция | недель старта/подводки | сумма MAPE | кач-х точно | прецедент той же дистанции |`);
p(`|---|---:|---:|---:|---:|`);
for (const d of ["5к", "10к", "21к", "42к", "ультра"]) {
  const s = test.filter((t) => t.distBucket === d && (t.phase === "race" || t.phase === "taper"));
  const es: Err[] = []; let same = 0;
  for (const t of s) { const pr = pred(t); if (!pr) continue; es.push(err(side(t), pr)); if (findPrecedent(ix, t, TUNED, "any")!.p.distBucket === d) same++; }
  const a = aggregate(es);
  p(`| ${d} | ${a.n} | ${a.totalMape}% | ${a.qExact}% | ${a.n ? Math.round(100 * same / a.n) : 0}% |`);
}
p();

// застой: у кого последние 12 недель почти не меняются
p(`## Застой в истории`);
let flat = 0; const flatList: string[] = [];
for (const a of roster) {
  const ws = (ix.byAid.get(a) ?? []).slice(-12); if (ws.length < 8) continue;
  const t = ws.map((w) => w.total); const m = t.reduce((x, y) => x + y, 0) / t.length;
  const cv = Math.sqrt(t.reduce((x, y) => x + (y - m) ** 2, 0) / t.length) / Math.max(1, m);
  const growth = (t.slice(-4).reduce((x, y) => x + y, 0) / 4) / Math.max(1, t.slice(0, 4).reduce((x, y) => x + y, 0) / 4);
  if (cv < 0.1 && growth < 1.05) { flat++; flatList.push(`${L.names.get(a) ?? a} (~${Math.round(m)} мин, CV ${Math.round(100 * cv)}%)`); }
}
p(`Атлетов, у кого 12 последних недель плоские (разброс <10%, роста <5%): ${flat}.${flat === 0 ? " Застоя по объёму в истории нет: недели тренера всё время шевелятся. Но прецедент по построению знает только то, что тренер уже делал, — объём выше своей истории он не предложит (смещение суммы см. в шаге 3)." : " Для них свой прецедент воспроизводит плато."}`);
for (const s of flatList) p(`- ${s}`);
p();
const igorRepeat = L.corpus.filter((w) => w.repeatOfPrev).length;
p(`Сам тренер повторяет прошлую неделю один в один в ${igorRepeat} случаях из ${L.corpus.length} (${Math.round(1000 * igorRepeat / L.corpus.length) / 10}%) — копировать неделю целиком он почти никогда не стал бы.`);

writeFileSync(path.join(OUT_DIR, "step6-limits.md"), out.join("\n") + "\n");
console.log(out.join("\n"));
