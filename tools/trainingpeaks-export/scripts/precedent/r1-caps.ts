/**
 * Шаг R1 — ПОТОЛКИ. READ-ONLY.
 *  (а) валидатор по ВСЕМ неделям тренера за 26 недель: какое правило он нарушает чаще всего;
 *  (б) окно расчёта потолков: замороженный baseline (11.03–03.06) против p90 за 26/12/8 недель
 *      и взвешенного окна — какое ближе к тому, что тренер ставит СЕЙЧАС;
 *  (в) пороги «абсурда» для жёстких защит — по практике тренера (куда он НЕ ходит).
 * Нужен DATA_DIR/env-weeks.json (env-cache.ts).
 * Запуск: npx tsx tools/trainingpeaks-export/scripts/precedent/r1-caps.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Envelope } from "../lib/autoplanner-context.ts";
import { addDays, type CWeek } from "./corpus.ts";
import { load, DATA_DIR, OUT_DIR } from "./load.ts";
import { validateWeek, type VSess } from "./validate.ts";

const L = load();
const envW = JSON.parse(readFileSync(path.join(DATA_DIR, "env-weeks.json"), "utf8")) as Record<string, { env: Envelope; ill: boolean }>;
const out: string[] = []; const p = (s = ""): void => { out.push(s); };
const q = (xs: number[], f: number): number => { const s = [...xs].filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(f * (s.length - 1)))] : NaN; };
const r2 = (x: number): number => Math.round(100 * x) / 100;
const since = addDays(L.thisMonday, -26 * 7);
const byAid = new Map<number, CWeek[]>(); for (const w of L.corpus) (byAid.get(w.aid) ?? byAid.set(w.aid, []).get(w.aid)!).push(w);
for (const v of byAid.values()) v.sort((a, b) => a.weekStart.localeCompare(b.weekStart));
const vs = (w: CWeek): VSess[] => w.sessions.filter((s) => !s.race).map((s) => ({ dayIdx: s.dayIdx, kind: s.kind, title: s.title, minutes: s.minutes, work: s.work, description: s.desc }));

// ── (а) ──
const tally = new Map<string, [number, number, Set<number>]>(); let weeks = 0;
for (const w of L.corpus) {
  if (w.weekStart < since) continue;
  const e = envW[`${w.aid}|${w.weekStart}`]; if (!e) continue;
  weeks++;
  const ws = byAid.get(w.aid) ?? []; const i = ws.indexOf(w);
  const prior = ws.slice(Math.max(0, i - 8), i).map((x) => x.total);
  const normalLevel = prior.length >= 4 ? q(prior, 0.5) : undefined;
  const rds = L.races.filter((r) => r.trainingpeaks_athlete_id === w.aid).map((r) => Math.round((Date.parse(r.event_date) - Date.parse(w.weekStart)) / 86400000)).filter((d) => d >= 0 && d <= 8).sort((a, b) => a - b);
  for (const r of validateWeek(vs(w), e.env, { hasActiveIllness: e.ill, checkText: false, normalLevel, raceDayIdx: rds[0] ?? null })) {
    const t = tally.get(r.name) ?? tally.set(r.name, [0, 0, new Set()]).get(r.name)!; t[1]++; if (!r.ok) { t[0]++; t[2].add(w.aid); }
  }
}
p(`# R1 · потолки и валидатор на всех неделях тренера`);
p();
p(`## (а) Какие правила тренер нарушает чаще всего — ${weeks} недель за 26 недель (${since} …), контекст «на понедельник» каждой недели`);
p(`| правило | нарушено | из применимых | доля | атлетов |`);
p(`|---|---:|---:|---:|---:|`);
for (const [n, [bad, all, a]] of [...tally.entries()].sort((x, y) => y[1][0] / Math.max(1, y[1][1]) - x[1][0] / Math.max(1, x[1][1]))) p(`| ${n} | ${bad} | ${all} | ${Math.round(100 * bad / Math.max(1, all))}% | ${a.size} |`);
p();

// ── (б) окна ──
p(`## (б) Окно потолков: что ближе к тому, что тренер ставит сейчас`);
p(`Для каждой недели W с 2026-09-07 по последнюю: потолок считается по неделям СТРОГО до W, покрытие = доля недель тренера, которые в потолок укладываются; «зазор» = медиана потолок/факт.`);
const tests = L.corpus.filter((w) => w.weekStart >= "2026-09-07");
type Win = { name: string; f: (hist: CWeek[], W: string, key: "total" | "longMin", e: Envelope | undefined) => number | null };
const pct = (xs: number[], f: number): number | null => (xs.length >= 4 ? q(xs, f) : null);
const wq = (hist: CWeek[], W: string, key: "total" | "longMin", hl: number): number | null => {
  const items = hist.filter((h) => h[key] > 0).map((h) => ({ v: h[key], w: Math.pow(0.5, ((Date.parse(W) - Date.parse(h.weekStart)) / 86400000 / 7) / hl) }));
  if (items.length < 4) return null; items.sort((a, b) => a.v - b.v);
  const tot = items.reduce((s, x) => s + x.w, 0); let acc = 0; for (const it of items) { acc += it.w; if (acc >= 0.9 * tot) return it.v; } return items[items.length - 1].v;
};
const wins: Win[] = [
  { name: "baseline (заморожен, 11.03–03.06)", f: (_h, _W, k, e) => (k === "total" ? e?.capWeeklyMin ?? null : e?.capLongRunMin ?? null) },
  { name: "p90 за 26 нед", f: (h, W, k) => pct(h.filter((x) => x.weekStart >= addDays(W, -182)).map((x) => x[k]).filter((v) => v > 0), 0.9) },
  { name: "p90 за 12 нед", f: (h, W, k) => pct(h.filter((x) => x.weekStart >= addDays(W, -84)).map((x) => x[k]).filter((v) => v > 0), 0.9) },
  { name: "p90 за 8 нед", f: (h, W, k) => pct(h.filter((x) => x.weekStart >= addDays(W, -56)).map((x) => x[k]).filter((v) => v > 0), 0.9) },
  { name: "максимум за 8 нед", f: (h, W, k) => pct(h.filter((x) => x.weekStart >= addDays(W, -56)).map((x) => x[k]).filter((v) => v > 0), 1) },
  { name: "взвешенный p90, полураспад 4 нед", f: (h, W, k) => wq(h.filter((x) => x.weekStart >= addDays(W, -182)), W, k, 4) },
];
for (const key of ["total", "longMin"] as const) {
  p(`\n### ${key === "total" ? "недельный объём" : "длительная"}`);
  p(`| окно | недель | покрытие | зазор потолок/факт (медиана) | недель, где факт выше потолка на >15% |`);
  p(`|---|---:|---:|---:|---:|`);
  for (const win of wins) {
    let n = 0, ok = 0, over15 = 0; const ratio: number[] = [];
    for (const t of tests) {
      if (t[key] <= 0) continue;
      const hist = (byAid.get(t.aid) ?? []).filter((x) => x.weekStart < t.weekStart);
      const cap = win.f(hist, t.weekStart, key, envW[`${t.aid}|${t.weekStart}`]?.env); if (cap == null || cap <= 0) continue;
      n++; if (t[key] <= cap) ok++; if (t[key] > cap * 1.15) over15++; ratio.push(cap / t[key]);
    }
    p(`| ${win.name} | ${n} | ${Math.round(100 * ok / Math.max(1, n))}% | ${r2(q(ratio, 0.5))} | ${over15} (${Math.round(100 * over15 / Math.max(1, n))}%) |`);
  }
}
p();

// ── (в) пороги абсурда ──
p(`## (в) Пороги «абсурда» по практике тренера (26 недель): жёсткая защита ставится ЗА краем его практики`);
const W26 = L.corpus.filter((w) => w.weekStart >= since);
const share = W26.filter((w) => w.qCount > 0 && w.total > 0).map((w) => w.work / w.total);
p(`Доля работы в неделе (недель с качеством ${share.length}): p50 ${r2(q(share, 0.5))}, p90 ${r2(q(share, 0.9))}, p99 ${r2(q(share, 0.99))}, максимум ${r2(q(share, 1))}.`);
const easyMin = W26.flatMap((w) => w.sessions.filter((s) => s.kind === "easy" && !s.race && !/разминк/i.test(s.title)).map((s) => s.minutes));
p(`Лёгкая сессия, мин (n=${easyMin.length}): минимум ${q(easyMin, 0)}, p1 ${q(easyMin, 0.01)}, p5 ${q(easyMin, 0.05)}, медиана ${q(easyMin, 0.5)}.`);
const grow: number[] = []; const growNorm: number[] = [];
for (const [, ws] of byAid) for (let i = 1; i < ws.length; i++) {
  const w = ws[i]; if (w.weekStart < since) continue;
  if (w.prevTotal > 0) grow.push(w.total / w.prevTotal);
  const prior = ws.slice(Math.max(0, i - 8), i).map((x) => x.total); if (prior.length >= 4) growNorm.push(w.total / q(prior, 0.5));
}
p(`Неделя / прошлая неделя (n=${grow.length}): p90 ${r2(q(grow, 0.9))}, p99 ${r2(q(grow, 0.99))}, максимум ${r2(q(grow, 1))}; выше ×1.22: ${Math.round(100 * grow.filter((x) => x > 1.22).length / grow.length)}%.`);
p(`Неделя / медиана 8 предыдущих (n=${growNorm.length}): p90 ${r2(q(growNorm, 0.9))}, p99 ${r2(q(growNorm, 0.99))}, максимум ${r2(q(growNorm, 1))}.`);
// перед стартом
const pre: Array<{ off: number; min: number; q: boolean; long: boolean; title: string }> = [];
const raceDates = new Map<number, string[]>(); for (const r of L.races) (raceDates.get(r.trainingpeaks_athlete_id) ?? raceDates.set(r.trainingpeaks_athlete_id, []).get(r.trainingpeaks_athlete_id)!).push(r.event_date);
for (const [aid, ws] of byAid) for (const w of ws) for (const s of w.sessions) {
  if (s.race) continue;
  for (const rd of raceDates.get(aid) ?? []) { const off = Math.round((Date.parse(rd) - Date.parse(s.date)) / 86400000); if (off === 1 || off === 2) pre.push({ off, min: s.minutes, q: s.kind === "quality", long: s.kind === "long", title: s.title }); }
}
for (const off of [1, 2]) {
  const s = pre.filter((x) => x.off === off);
  p(`За ${off} дн до старта (n=${s.length}): минуты p50 ${q(s.map((x) => x.min), 0.5)}, p90 ${q(s.map((x) => x.min), 0.9)}, максимум ${q(s.map((x) => x.min), 1)}; качественных ${s.filter((x) => x.q).length}, длительных ${s.filter((x) => x.long).length}. Самые тяжёлые: ${[...s].sort((a, b) => b.min - a.min).slice(0, 3).map((x) => `«${x.title}» ${x.min}`).join("; ")}`);
}
writeFileSync(path.join(OUT_DIR, "r1-caps.md"), out.join("\n") + "\n");
console.log(out.join("\n"));
