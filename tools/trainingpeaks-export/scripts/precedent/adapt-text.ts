/**
 * АДАПТАЦИЯ ТЕКСТА: заголовок и описание берутся у тренера дословно, меняются только ЧИСЛА.
 *
 * ТЕМПЫ. Каждый диапазон в описании находится тем же парсером, что у ночного пересчёта
 * (ranges() из lib/tp-recompute.ts), и пересчитывается под целевого атлета:
 *  - лёгкая и длительная — resolvePace(якоря атлета, "easy" | "long"), тот же резолвер, что у сборщика;
 *  - качественная — по процентам от порога из СТРУКТУРЫ тренировки (percentOfThresholdPace):
 *    темп = порог атлета × 100 / %. Это ровно то, как TP сам считает темп шага, поэтому
 *    рисунок «разминка — работа — отдых» переносится без угадывания, чем он был.
 *  Нет порога/якоря → темпы заменяются на «по ощущениям», сессия помечается тренеру.
 * МИНУТЫ. Если лёгкая/длительная масштабирована, число минут в тексте и в заголовке меняется
 * вместе с сессией; не нашли, где оно в тексте, — пометка, а не молчаливое расхождение.
 * Стиль записи темпа (ведущий ноль, тире) сохраняется тренерский.
 */
import type { AthleteAnchors } from "../lib/pace-resolver.ts";
import { resolvePace } from "../lib/pace-resolver.ts";
import { flatSteps, ranges } from "../lib/tp-recompute.ts";
import type { Kind } from "./corpus.ts";

export type PaceOut = { fast: number; slow: number };
export type TextResult = { title: string; description: string; written: PaceOut[]; paceMode: string; flags: string[] };

const fmt = (sec: number, lead: boolean): string => {
  let m = Math.floor(sec / 60), s = Math.round(sec % 60); if (s === 60) { m++; s = 0; }
  return `${lead && m < 10 ? "0" : ""}${m}:${String(s).padStart(2, "0")}`;
};
/** Длительность «50 минут / 50 мин», но НЕ «на 120 минуте» (так тренер пишет время приёма геля). */
export const DUR = /(\d{1,3})\s*(?:мин\.?|минут[аы]?)(?![а-яё])/gi;
const DASH = /(\d{1,2}:\d{2})(\s*)([-–—−]|@|до)(\s*)(\d{1,2}:\d{2})/g;

/** Шаги структуры с процентами порога, по убыванию интенсивности, без повторов. */
function pctLevels(struct: unknown): Array<{ lo: number; hi: number }> {
  const fs = flatSteps(struct);
  if (!fs || fs.metric !== "percentOfThresholdPace") return [];
  const seen = new Set<string>(); const out: Array<{ lo: number; hi: number }> = [];
  for (const s of fs.steps) {
    if (!Number.isFinite(s.min)) continue;
    const hi = Number.isFinite(s.max) ? s.max : s.min; const k = `${s.min}|${hi}`;
    if (!seen.has(k)) { seen.add(k); out.push({ lo: s.min, hi }); }
  }
  return out.sort((a, b) => b.hi - a.hi);
}

export function adaptText(o: { title: string; desc: string; struct: unknown; kind: Kind; srcMinutes: number; minutes: number; a: AthleteAnchors | null }): TextResult {
  const flags: string[] = [];
  let title = o.title; let text = o.desc;
  // ── минуты ──
  if (o.minutes !== o.srcMinutes && o.kind !== "quality") {
    const tRe = new RegExp(`\\b${o.srcMinutes}(\\s*мин)`, "i");
    if (tRe.test(title)) title = title.replace(tRe, `${o.minutes}$1`);
    const durs = [...text.matchAll(DUR)].map((m) => ({ v: Number(m[1]), i: m.index ?? 0, len: m[1].length }));
    const exact = durs.find((d) => d.v === o.srcMinutes);
    const sum = durs.reduce((s, d) => s + d.v, 0);
    const swap = (d: { v: number; i: number; len: number }, nv: number): void => { text = text.slice(0, d.i) + String(nv) + text.slice(d.i + d.len); };
    if (exact) swap(exact, o.minutes);
    else if (durs.length > 1 && sum === o.srcMinutes) { const big = [...durs].sort((a, b) => b.v - a.v)[0]; swap(big, big.v + (o.minutes - o.srcMinutes)); }
    else if (durs.length > 0) flags.push(`минуты в тексте не сверены (${durs.map((d) => d.v).join("+")} против ${o.minutes})`);
  }
  // ── темпы ──
  const rs = ranges(text);
  if (rs.length === 0) return { title, description: text, written: [], paceMode: "без темпа в тексте", flags };
  const lead = /\b0\d:\d\d/.test(text);
  let plan: PaceOut[] | null = null; let paceMode = "";
  const distinct = [...new Map(rs.map((r) => [`${r.fast}|${r.slow}`, r])).values()].sort((a, b) => a.fast - b.fast);
  // Несколько РАЗНЫХ темпов = в сессии есть рисунок (длительная с блоком в целевом темпе,
  // качественная с разминкой/работой/отдыхом). Его переносим по процентам структуры: один
  // лёгкий якорь на всё стёр бы блок в целевом темпе (так было в первом прогоне — дефект).
  const lv = pctLevels(o.struct);
  if (o.a?.threshold && (o.kind === "quality" || distinct.length > 1) && lv.length > 0 && lv.length === distinct.length) {
    const thr = o.a.threshold.paceSec;
    const map = new Map(distinct.map((r, i) => [`${r.fast}|${r.slow}`, { fast: Math.round(thr * 100 / lv[i].hi), slow: Math.round(thr * 100 / lv[i].lo) }]));
    plan = rs.map((r) => map.get(`${r.fast}|${r.slow}`)!); paceMode = "% порога из структуры × порог атлета";
  }
  if (!plan && o.a && o.kind !== "quality") {
    const r = resolvePace(o.a, o.kind === "long" ? "long" : "easy", "maintenance");
    if (r.ok) {
      plan = rs.map(() => ({ fast: r.absPaceMinS, slow: r.absPaceMaxS })); paceMode = `якорь лёгкой (${r.anchorSource})`;
      if (new Set(rs.map((x) => `${x.fast}|${x.slow}`)).size > 1) flags.push("в лёгкой у тренера было несколько темпов — все сведены к одному якорю");
    }
  }
  if (!plan && o.kind === "quality") {
    flags.push(!o.a?.threshold ? "нет порога у атлета — темпы работы сняты"
      : `темпы работы не перенесены: в тексте ${distinct.length} разных темпов, в структуре ${lv.length} уровней`);
  }
  if (!plan) {
    if (!flags.length) flags.push("нет якоря темпа у атлета — темпы сняты, по ощущениям");
    let i = 0;
    text = text.replace(DASH, (m) => (rs[i++] ? "по ощущениям" : m));
    return { title, description: text, written: [], paceMode: "по ощущениям", flags };
  }
  // замена по порядку появления: ranges() отдаёт диапазоны в порядке idx, DASH идёт тем же порядком
  let i = 0;
  const byIdx = new Map(rs.map((r, k) => [r.idx, k]));
  text = text.replace(DASH, (m, _a, s1, d, s2, _b, off: number) => {
    const k = byIdx.get(off); if (k == null) return m; i++;
    const p = plan![k]; return `${fmt(p.fast, lead)}${s1}${d}${s2}${fmt(p.slow, lead)}`;
  });
  if (i !== rs.length) flags.push(`заменено ${i} из ${rs.length} темпов (односторонние «X и медленнее» не переписаны)`);
  return { title, description: text, written: plan, paceMode, flags };
}
