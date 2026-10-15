/**
 * R12 — РАЗБРОС ВНУТРИ СТРОК ТАБЛИЦЫ ВОССТАНОВЛЕНИЯ (а не только медиана). READ-ONLY.
 * Неделя +k / обычная неделя до старта (медиана до 9 недель до недели старта без старта/подводки/после старта).
 * Две базы: ОБУЧАЮЩАЯ (старт и неделя +k раньше 2026-03-02) и ВЕСЬ корпус. По каждой ячейке: n, min, p25, медиана, p75, max,
 * доля недель ниже 0.9 (то есть «реально снижено»).
 *
 * ПРАВИЛО «ПОНИЖАТЬ ИЛИ НЕТ» — записано ДО взгляда на числа: ячейка понижает нагрузку, только если на ОБУЧАЮЩЕЙ базе
 *   n ≥ 15  И  p75 < 1.0  (три четверти недель реально ниже обычной — значит, снижение типично, а не усреднение разнонаправленного).
 * Иначе надёжного числа нет, и лучше не понижать вовсе, чем понижать наугад (решение Игоря 15.10 для коротких дистанций).
 * Запуск: npx tsx tools/trainingpeaks-export/scripts/precedent/r12-spread.ts
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { mondayOf } from "./corpus.ts";
import { load, OUT_DIR } from "./load.ts";

export const SPLIT = "2026-03-02"; export const MIN_N = 15; export const P75_MAX = 1.0;
const K = 8;
const L = load();
/** Медиана — ТО ЖЕ определение, что в r9-recovery.ts (верхняя при чётном n): иначе числа таблицы и разброса не сопоставимы. */
const med = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const q = (xs: number[], f: number): number => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(f * (s.length - 1)))] : NaN; };
const by = new Map<number, typeof L.corpus>(); for (const w of L.corpus) (by.get(w.aid) ?? by.set(w.aid, []).get(w.aid)!).push(w);
type Cell = number[]; type Tab = Map<string, Cell[]>;
function measure(train: boolean): Tab {
  const res: Tab = new Map();
  for (const [aid, ws] of by) { ws.sort((a, b) => a.weekStart.localeCompare(b.weekStart));
    const rs = L.races.filter((x) => x.trainingpeaks_athlete_id === aid && x.distance_km != null);
    for (const r of rs) {
      if (train && r.event_date >= SPLIT) continue;
      const b = r.distance_km! >= 30 ? "марафон" : r.distance_km! >= 15 ? "половинка" : "до 15 км"; const rm = mondayOf(r.event_date);
      const prior = ws.filter((w) => w.weekStart < rm).slice(-9).filter((w) => w.phase !== "race" && w.phase !== "post" && w.phase !== "taper"); if (prior.length < 4) continue;
      const n = med(prior.map((w) => w.total)); const arr = res.get(b) ?? res.set(b, Array.from({ length: K }, () => [])).get(b)!;
      for (let k = 1; k < K; k++) { const wk = new Date(Date.parse(rm) + 7 * k * 86400000).toISOString().slice(0, 10); if (train && wk >= SPLIT) continue; const w = ws.find((x) => x.weekStart === wk); if (!w) continue;
        const nr = rs.find((x) => x.event_date > r.event_date); if (nr && Date.parse(nr.event_date) - Date.parse(wk) < 21 * 86400000) continue; arr[k].push(w.total / n); } } }
  return res;
}
const all = measure(false), tr = measure(true);
const f2 = (x: number): string => (Number.isFinite(x) ? x.toFixed(2) : "—");
const stat = (c: Cell): string => `n=${c.length}: min ${f2(q(c, 0))} · p25 ${f2(q(c, 0.25))} · **${f2(med(c))}** · p75 ${f2(q(c, 0.75))} · max ${f2(q(c, 1))} · ниже 0.9: ${c.length ? Math.round(100 * c.filter((x) => x < 0.9).length / c.length) : 0}%`;
export const reliable = (c: Cell): boolean => c.length >= MIN_N && q(c, 0.75) < P75_MAX;

const out: string[] = []; const p = (s = ""): void => { out.push(s); };
p(`# R12 · разброс внутри строк таблицы восстановления`);
p();
p(`Правило (записано до взгляда на числа) применяется к строке «до 15 км» (решение Игоря): ячейка понижает нагрузку, только если на ОБУЧАЮЩЕЙ базе n ≥ ${MIN_N} и p75 < ${P75_MAX}. Для половинки и марафона n на обучающей базе мало по природе (7–12 стартов) — они даны справкой.`);
p();
for (const b of ["до 15 км", "половинка", "марафон"]) {
  p(`## ${b}`);
  p(`| неделя | обучающая база | весь корпус | вердикт |`);
  p(`|---|---|---|---|`);
  const lim = b === "марафон" ? 7 : 3;
  for (let k = 1; k <= lim; k++) {
    const t = tr.get(b)?.[k] ?? [], a = all.get(b)?.[k] ?? [];
    const verdict = b === "до 15 км"
      ? (reliable(t) ? "понижать" : "**не понижать** (надёжного числа нет)")
      : `справка: p75 ${q(t, 0.75) < P75_MAX ? "<" : "≥"} ${P75_MAX}, на обучающей базе n=${t.length} (<${MIN_N}) — решение Игоря про «лучше не понижать» касается коротких`;
    p(`| +${k} | ${stat(t)} | ${stat(a)} | ${verdict} |`);
  }
  p();
}
writeFileSync(path.join(OUT_DIR, "r12-spread.md"), out.join("\n") + "\n");
if (process.argv[1]?.endsWith("r12-spread.ts")) console.log(out.join("\n"));
