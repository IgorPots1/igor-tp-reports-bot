/**
 * R9 — ТАБЛИЦА ВОССТАНОВЛЕНИЯ ПОСЛЕ СТАРТА: весь корпус против ТОЛЬКО обучающего отрезка. READ-ONLY.
 * Неделя +k / обычная неделя до старта (медиана до 9 недель до недели старта без старта/подводки/после старта).
 * Старты, у которых следующий старт ближе трёх недель к неделе +k, не считаются (не чистое восстановление).
 * Обучающий отрезок: недели +k раньше SPLIT и старт раньше SPLIT. Запуск: npx tsx .../precedent/r9-recovery.ts
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { mondayOf } from "./corpus.ts";
import { load, OUT_DIR } from "./load.ts";

const SPLIT = "2026-03-02"; const K = 8;
const L = load();
const med = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const by = new Map<number, typeof L.corpus>(); for (const w of L.corpus) (by.get(w.aid) ?? by.set(w.aid, []).get(w.aid)!).push(w);
type Tab = Map<string, number[][]>;
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
const out: string[] = []; const p = (s = ""): void => { out.push(s); };
p(`# R9 · таблица восстановления: весь корпус против обучающего отрезка (до ${SPLIT})`);
p();
p(`| дистанция | неделя | весь корпус | n | только обучающий | n | расхождение |`);
p(`|---|---:|---:|---:|---:|---:|---:|`);
let maxDiff = 0, maxDiffMarathon = 0;
for (const b of ["марафон", "половинка", "до 15 км"]) for (let k = 1; k < K; k++) {
  const a = all.get(b)?.[k] ?? [], t = tr.get(b)?.[k] ?? []; if (!a.length) continue;
  const ma = med(a), mt = t.length ? med(t) : NaN; const d = Number.isFinite(mt) ? Math.abs(ma - mt) : NaN;
  if (Number.isFinite(d)) { maxDiff = Math.max(maxDiff, d); if (b === "марафон") maxDiffMarathon = Math.max(maxDiffMarathon, d); }
  p(`| ${b} | +${k} | ${ma.toFixed(2)} | ${a.length} | ${Number.isFinite(mt) ? mt.toFixed(2) : "—"} | ${t.length} | ${Number.isFinite(d) ? (mt - ma >= 0 ? "+" : "") + (mt - ma).toFixed(2) : "—"} |`);
}
p();
p(`Наибольшее расхождение: по марафону ${maxDiffMarathon.toFixed(2)}, по всем дистанциям ${maxDiff.toFixed(2)}.`);
writeFileSync(path.join(OUT_DIR, "r9-recovery.md"), out.join("\n") + "\n");
console.log(out.join("\n"));
