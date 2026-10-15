/**
 * R7 — ЗАМЕР ПОРОГОВ ЖЁСТКОЙ ГРАНИЦЫ: (а) во сколько раз неделя Игоря выше недавнего ФАКТИЧЕСКОГО уровня;
 * (б) что Игорь ставит после пауз разной длины. READ-ONLY.
 * Запуск: npx tsx tools/trainingpeaks-export/scripts/precedent/r7-guard.ts
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { addDays } from "./corpus.ts";
import { load, OUT_DIR } from "./load.ts";
import { indexCorpus } from "./precedent.ts";
import { recent } from "./recent-level.ts";

const L = load(); const ix = indexCorpus(L.corpus);
const out: string[] = []; const p = (s = ""): void => { out.push(s); };
const q = (xs: number[], f: number): number => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(f * (s.length - 1)))] : NaN; };
const r2 = (x: number): number => Math.round(100 * x) / 100;
const since = addDays(L.thisMonday, -26 * 7);

p(`# R7 · пороги жёсткой границы (замер по неделям Игоря за 26 недель)`);
p();
p(`## (а) Плановая неделя Игоря / недавний уровень. Пять определений уровня, окно 8 недель`);
const by0 = new Map<number, typeof L.corpus>(); for (const w of L.corpus) (by0.get(w.aid) ?? by0.set(w.aid, []).get(w.aid)!).push(w);
const qq = (xs: number[], f: number): number => q(xs, f);
const defs: Record<string, (o: typeof L.corpus) => number | null> = {
  "p75 ПЛАНА за 8 нед (ВЗЯТО)": (o) => (o.length >= 3 ? qq(o.map((w) => w.total), .75) : null),
  "медиана ПЛАНА за 8 нед": (o) => (o.length >= 3 ? qq(o.map((w) => w.total), .5) : null),
  "медиана ПЛАНА за 4 нед": (o) => { const r = o.slice(-4); return r.length >= 3 ? qq(r.map((w) => w.total), .5) : null; },
  "медиана ФАКТА за 8 нед (нули не считаем)": (o) => { const r = o.filter((w) => w.done > 0); return r.length >= 3 ? qq(r.map((w) => w.done), .5) : null; },
  "max(медиана плана, медиана факта)": (o) => { const a = o.length >= 3 ? qq(o.map((w) => w.total), .5) : null; const r = o.filter((w) => w.done > 0); const b2 = r.length >= 3 ? qq(r.map((w) => w.done), .5) : null; return a == null || b2 == null ? null : Math.max(a, b2); },
};
p(`| определение уровня | недель | p50 | p90 | p95 | p99 | его недель выше 1.5× | выше 1.75× | выше 2× |`);
p(`|---|---:|---:|---:|---:|---:|---:|---:|---:|`);
for (const [name, f] of Object.entries(defs)) {
  const rs: number[] = [];
  for (const w of L.corpus) { if (w.weekStart < since || w.total <= 0) continue; const own = (by0.get(w.aid) ?? []).filter((x) => x.weekStart < w.weekStart && Date.parse(w.weekStart) - Date.parse(x.weekStart) <= 8 * 7 * 86400000); const l = f(own); if (l && l > 0) rs.push(w.total / l); }
  const pc = (k: number): string => `${Math.round(1000 * rs.filter((x) => x > k).length / rs.length) / 10}%`;
  p(`| ${name} | ${rs.length} | ${r2(q(rs, .5))} | ${r2(q(rs, .9))} | ${r2(q(rs, .95))} | ${r2(q(rs, .99))} | ${pc(1.5)} | ${pc(1.75)} | ${pc(2)} |`);
}
p();
p(`Взято: уровень = p75 плана за 8 недель; порог ${"1.5"}× — выше его только ~2% собственных недель Игоря (то есть граница почти не задевает его практику).`);
const hist = L.corpus.filter((w) => w.weekStart >= since && w.total > 0).map((w) => recent(ix, w.aid, w.weekStart));
p(`Недель за 26 нед без недавней истории по определению (<3 своих недель за 8 или пауза ≥4): ${hist.filter((h) => !h.ok).length} из ${hist.length}.`);
p();
p(`## (б) Что Игорь ставит ПОСЛЕ ПАУЗЫ (пропущенных недель подряд перед неделей): неделя / медиана 8 недель до паузы`);
p(`| пауза, нед | случаев | p25 | медиана | p75 | выше 1.5 | атлетов |`);
p(`|---|---:|---:|---:|---:|---:|---:|`);
const by = new Map<number, typeof L.corpus>(); for (const w of L.corpus) (by.get(w.aid) ?? by.set(w.aid, []).get(w.aid)!).push(w);
const rows = new Map<string, { r: number[]; a: Set<number> }>();
for (const [aid, ws] of by) { ws.sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  for (let i = 1; i < ws.length; i++) { const gap = Math.round((Date.parse(ws[i].weekStart) - Date.parse(ws[i - 1].weekStart)) / (7 * 86400000)) - 1; if (gap < 1) continue;
    const prior = ws.slice(Math.max(0, i - 8), i).map((w) => w.total); if (prior.length < 3) continue;
    const m = [...prior].sort((a, b) => a - b)[Math.floor(prior.length / 2)]; const k = gap === 1 ? "1" : gap <= 3 ? "2–3" : gap <= 5 ? "4–5" : gap <= 9 ? "6–9" : "10+";
    const e = rows.get(k) ?? rows.set(k, { r: [], a: new Set() }).get(k)!; e.r.push(ws[i].total / m); e.a.add(aid); } }
for (const k of ["1", "2–3", "4–5", "6–9", "10+"]) { const e = rows.get(k); if (!e) continue; p(`| ${k} | ${e.r.length} | ${r2(q(e.r, .25))} | ${r2(q(e.r, .5))} | ${r2(q(e.r, .75))} | ${Math.round(100 * e.r.filter((x) => x > 1.5).length / e.r.length)}% | ${e.a.size} |`); }
writeFileSync(path.join(OUT_DIR, "r7-guard.md"), out.join("\n") + "\n");
console.log(out.join("\n"));
