/**
 * Замеры R3 и R4 по корпусу недель тренера. READ-ONLY.
 *
 * R3 — ТЕМПОВЫЙ В ПРАКТИКЕ: доля темпового среди качественных за 26 недель (и в октябре),
 *      длительности сессии и работы, интенсивность работы в % порога из структуры, как часто
 *      две темповых в неделю.
 * R4 — НЕДЕЛЯ С СИГНАЛОМ ЗДОРОВЬЯ: что тренер реально ставит — объём относительно обычного
 *      (медиана 8 предыдущих недель без сигнала), качество, дни. По типам сигнала.
 *
 * Запуск: npx tsx tools/trainingpeaks-export/scripts/precedent/r34-measure.ts
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { flatSteps } from "../lib/tp-recompute.ts";
import { addDays, type CSess, type CWeek } from "./corpus.ts";
import { load, OUT_DIR } from "./load.ts";

const L = load();
const out: string[] = []; const p = (s = ""): void => { out.push(s); };
const q = (xs: number[], f: number): number => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(f * (s.length - 1)))] : NaN; };
const r1 = (x: number): number => Math.round(10 * x) / 10;
const since26 = addDays(L.thisMonday, -26 * 7);
const W26 = L.corpus.filter((w) => w.weekStart >= since26);

// ── R3 ──
/** Минуты работы темпового: «Темповый бег 40 мин», «40 мин темп», иначе из структуры (самый интенсивный шаг). */
export function tempoWorkMin(s: CSess): number | null {
  const m = /(\d{2,3})\s*(?:мин|минут)/i.exec(s.title);
  if (m) { const v = Number(m[1]); if (v >= 10 && v <= 120 && v < s.minutes) return v; }
  const fs = flatSteps(s.struct); if (!fs) return null;
  const top = Math.max(...fs.steps.map((x) => (Number.isFinite(x.max) ? x.max : x.min)).filter(Number.isFinite));
  const sec = fs.steps.filter((x) => (Number.isFinite(x.max) ? x.max : x.min) === top).reduce((a, x) => a + x.durSec, 0);
  return sec > 0 ? Math.round(sec / 60) : null;
}
export function tempoPct(s: CSess): { lo: number; hi: number } | null {
  const fs = flatSteps(s.struct); if (!fs || fs.metric !== "percentOfThresholdPace") return null;
  const st = fs.steps.filter((x) => Number.isFinite(x.min)).sort((a, b) => (b.max || b.min) - (a.max || a.min))[0];
  return st ? { lo: st.min, hi: Number.isFinite(st.max) ? st.max : st.min } : null;
}
const qual = (ws: CWeek[]): CSess[] => ws.flatMap((w) => w.sessions.filter((s) => s.kind === "quality" && !s.race));
const qs = qual(W26); const tempo = qs.filter((s) => s.tempo);
const oct = L.corpus.filter((w) => w.weekStart >= "2026-09-28");
const qo = qual(oct); const to = qo.filter((s) => s.tempo);
p(`# R3 · темповый в практике тренера`);
p();
p(`Качественных сессий за 26 недель: ${qs.length}; темповых ${tempo.length} (${Math.round(100 * tempo.length / qs.length)}%).`);
p(`С 28.09: качественных ${qo.length}, темповых ${to.length} (${Math.round(100 * to.length / Math.max(1, qo.length))}%).`);
const athQ = new Map<number, { q: number; t: number }>();
for (const w of W26) for (const s of w.sessions) if (s.kind === "quality" && !s.race) { const e = athQ.get(w.aid) ?? athQ.set(w.aid, { q: 0, t: 0 }).get(w.aid)!; e.q++; if (s.tempo) e.t++; }
const shares = [...athQ.values()].filter((e) => e.q >= 4).map((e) => e.t / e.q);
p(`Атлетов с ≥4 качественными: ${shares.length}. Темповый — основное качество (>50%) у ${shares.filter((x) => x > 0.5).length}, есть хоть раз у ${shares.filter((x) => x > 0).length}, нет совсем у ${shares.filter((x) => x === 0).length}.`);
const tw = tempo.map(tempoWorkMin).filter((x): x is number => x != null);
p(`Минуты РАБОТЫ темпового (n=${tw.length}): p10 ${q(tw, 0.1)}, p25 ${q(tw, 0.25)}, медиана ${q(tw, 0.5)}, p75 ${q(tw, 0.75)}, p90 ${q(tw, 0.9)}.`);
const tsMin = tempo.map((s) => s.minutes);
p(`Минуты СЕССИИ темпового: p25 ${q(tsMin, 0.25)}, медиана ${q(tsMin, 0.5)}, p75 ${q(tsMin, 0.75)}.`);
const hist = new Map<number, number>(); for (const x of tw) { const b = Math.round(x / 5) * 5; hist.set(b, (hist.get(b) ?? 0) + 1); }
p(`Работа по корзинам 5 мин: ${[...hist.entries()].sort((a, b) => a[0] - b[0]).filter(([, n]) => n >= 3).map(([b, n]) => `${b}:${n}`).join(", ")}`);
const pcts = tempo.map(tempoPct).filter((x): x is { lo: number; hi: number } => x != null);
p(`Интенсивность работы, % порога по скорости (n=${pcts.length}): нижний край медиана ${q(pcts.map((x) => x.lo), 0.5)} (p25 ${q(pcts.map((x) => x.lo), 0.25)}), верхний медиана ${q(pcts.map((x) => x.hi), 0.5)} (p75 ${q(pcts.map((x) => x.hi), 0.75)}).`);
const wkT = W26.map((w) => w.sessions.filter((s) => s.kind === "quality" && s.tempo && !s.race).length);
const withQ = W26.filter((w) => w.qCount > 0).length;
p(`Недель с качеством: ${withQ}; с одним темповым ${wkT.filter((x) => x === 1).length}, с двумя и более ${wkT.filter((x) => x >= 2).length}.`);
const twoT = W26.filter((w) => w.sessions.filter((s) => s.kind === "quality" && s.tempo).length >= 2);
p(`Недели с двумя темповыми: у ${new Set(twoT.map((w) => w.aid)).size} атлетов; суммарная работа в них медиана ${q(twoT.map((w) => w.sessions.filter((s) => s.tempo).reduce((a, s) => a + (tempoWorkMin(s) ?? 0), 0)), 0.5)} мин.`);
const titles = new Map<string, number>(); for (const s of tempo) { const k = s.title.replace(/\d+/g, "N"); titles.set(k, (titles.get(k) ?? 0) + 1); }
p(`Названия темповых (шаблон, топ-10): ${[...titles.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, n]) => `«${k}» ${n}`).join("; ")}`);
p();

// ── R4 ──
const sidByAid = new Map<number, string>();
for (const s of L.students) { const m = /athletes?\/(\d+)/.exec(s.trainingpeaks_athlete_url ?? ""); if (m) sidByAid.set(Number(m[1]), s.id); }
const ILL = ["health_issue_started", "health_issue_improving", "pain_injury", "pause_training"];
const winBy = new Map<string, Array<{ type: string; from: string; to: string }>>();
for (const s of L.sig) {
  if (!s.student_id || !ILL.includes(s.signal_type)) continue;
  const from = s.valid_from ?? s.source_date ?? s.target_date ?? s.created_at?.slice(0, 10) ?? null; if (!from) continue;
  let to = s.valid_until ?? s.resolved_at?.slice(0, 10) ?? null; if (!to || to < from) to = addDays(from, 7);
  (winBy.get(s.student_id) ?? winBy.set(s.student_id, []).get(s.student_id)!).push({ type: s.signal_type, from, to });
}
const byAid = new Map<number, CWeek[]>(); for (const w of L.corpus) (byAid.get(w.aid) ?? byAid.set(w.aid, []).get(w.aid)!).push(w);
for (const v of byAid.values()) v.sort((a, b) => a.weekStart.localeCompare(b.weekStart));
type Obs = { type: string; ratio: number; dq: number; dDays: number; keptQ: boolean; normalQ: number };
const obs: Obs[] = [];
for (const [aid, ws] of byAid) {
  const sid = sidByAid.get(aid); if (!sid) continue;
  const wins = winBy.get(sid) ?? [];
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i]; const end = addDays(w.weekStart, 6);
    const hit = wins.filter((x) => !(end < x.from || w.weekStart > x.to)); if (!hit.length) continue;
    const prior = ws.slice(Math.max(0, i - 8), i).filter((x) => !x.ill && x.weekStart >= addDays(w.weekStart, -70));
    if (prior.length < 3) continue;
    const norm = q(prior.map((x) => x.total), 0.5); const nq = q(prior.map((x) => x.qCount), 0.5); const nd = q(prior.map((x) => x.days), 0.5);
    // тип — самый «тяжёлый» из пересекающихся
    const type = ILL.find((t) => hit.some((h) => h.type === t && t === "pause_training")) ?? ILL.find((t) => hit.some((h) => h.type === t && t === "pain_injury")) ?? hit[0].type;
    obs.push({ type, ratio: w.total / Math.max(1, norm), dq: w.qCount - nq, dDays: w.days - nd, keptQ: nq > 0 ? w.qCount >= nq : true, normalQ: nq });
  }
}
p(`# R4 · неделя с активным сигналом здоровья: что делает тренер`);
p();
p(`Наблюдений (атлето-недель с сигналом, у которых есть ≥3 обычных недели за 10 недель до): ${obs.length}.`);
p(`Неделя БЕЗ плана вовсе в выборку не попадает: корпус — недели с хотя бы одной плановой пробежкой. Сколько недель с сигналом тренер оставил пустыми — ниже отдельно.`);
p();
p(`| тип сигнала | недель | объём/обычный: p25 · медиана · p75 | доля недель ≥0.9 обычного | качество сохранено (где было) | Δ дней медиана |`);
p(`|---|---:|---|---:|---:|---:|`);
for (const t of [...ILL, "все"]) {
  const s = t === "все" ? obs : obs.filter((o) => o.type === t); if (!s.length) continue;
  const rs = s.map((o) => o.ratio); const withQ = s.filter((o) => o.normalQ > 0);
  p(`| ${t} | ${s.length} | ${r1(q(rs, 0.25))} · ${r1(q(rs, 0.5))} · ${r1(q(rs, 0.75))} | ${Math.round(100 * rs.filter((x) => x >= 0.9).length / rs.length)}% | ${withQ.length ? Math.round(100 * withQ.filter((o) => o.keptQ).length / withQ.length) : "—"}% (n=${withQ.length}) | ${q(s.map((o) => o.dDays), 0.5)} |`);
}
// пустые недели под сигналом
let empty = 0, total = 0;
for (const [aid, ws] of byAid) {
  const sid = sidByAid.get(aid); if (!sid) continue; const wins = winBy.get(sid) ?? [];
  const have = new Set(ws.map((w) => w.weekStart)); const first = ws[0]?.weekStart; if (!first) continue;
  for (const x of wins) {
    for (let d = x.from; d <= x.to; d = addDays(d, 7)) {
      const wk = addDays(d, -((new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7)); if (wk < first || wk >= L.thisMonday) continue;
      total++; if (!have.has(wk)) empty++;
    }
  }
}
p();
p(`Недель под сигналом всего (с повторами окон): ${total}; из них без единой плановой пробежки: ${empty} (${Math.round(100 * empty / Math.max(1, total))}%).`);

writeFileSync(path.join(OUT_DIR, "r34-tempo-health.md"), out.join("\n") + "\n");
console.log(out.join("\n"));
