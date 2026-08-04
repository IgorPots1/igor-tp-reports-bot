// Shared recompute engine — the SINGLE source of truth for parsing a workout description into
// %-of-threshold targets. Previously duplicated in tp-threshold-restore.ts and tp-verify-plan-vs-text.ts;
// the two copies drifted (the 00:00 open-floor + walk-override fixes had to be applied twice), so both
// scripts AND the nightly recompute job now import from here. A third copy would guarantee divergence.
//
// Pure functions only (no I/O). Behavior is byte-for-byte the tp-threshold-restore.ts version at the
// time of extraction (verified via dry-run on Nazarov / Alex / Yarulina, before == after).
import { isRecord } from "./tp-athlete-helpers.ts";

export const S = (mm: string): number => { const [a, b] = mm.split(":"); return Number(a) * 60 + Number(b); };
export function median(xs: number[]): number | null { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
export function fp(sec: number | null): string { if (sec == null || !Number.isFinite(sec) || sec <= 0) return "—"; const m = Math.floor(sec / 60); const s = Math.round(sec % 60); return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, "0")}`; }

// ── description parse + role steps + recompute ────────────────────────────────
export type Rng = { fast: number; slow: number; idx: number };
// NO dedup: a repeated range is TWO real segments run at the same pace (warm-up and a recovery
// can share a pace). Ranges are returned in APPEARANCE order for positional matching to steps.
export function ranges(desc: string): Rng[] {
  const out: Rng[] = [];
  const push = (a: number, b: number, idx: number): void => { const fast = Math.min(a, b), slow = Math.max(a, b); if (fast < 150 || slow > 600) return; out.push({ fast, slow, idx }); };
  let m: RegExpExecArray | null;
  // 1) explicit range via dash / @ / до: "6:05–6:32", "05:16-05:26".
  //    OPEN FLOOR "X:XX–00:00": the 00:00 side means "no slow limit" — X is the fastest allowed
  //    (a ceiling with an open floor). Represent it as a one-sided ceiling POINT range (fast=slow=X),
  //    the same shape as "X и медленнее" below — recompute keeps the authored floor and sets the
  //    ceiling from X. Without this the pair collapses to fast=0 and is dropped, losing the segment
  //    (the Nazarov defer: 7 duration-steps but only 5 counted ranges).
  const dash = /(\d{1,2}:\d{2})\s*(?:[-–—−]|@|до)\s*(\d{1,2}:\d{2})/gi;
  while ((m = dash.exec(desc)) !== null) {
    const a = S(m[1]), b = S(m[2]);
    if (a > 0 && b === 0) { if (a >= 150 && a <= 600) out.push({ fast: a, slow: a, idx: m.index }); }       // "X–00:00" open floor → ceiling X
    else if (a === 0 && b > 0) { if (b >= 150 && b <= 600) out.push({ fast: b, slow: b, idx: m.index }); }   // "00:00–X" (rare) → ceiling X
    else push(a, b, m.index);
  }
  // 2) one-sided prose CEILING: "6:23 и медленнее" / "6:23 или тише" — the number is the fastest
  //    allowed, the floor is open. A POINT range (fast=slow); open-floor steps compare the ceiling.
  //    (JS \w/\b miss Cyrillic — match stems: медленн covers медленнее/медленней.)
  const slower = /(\d{1,2}:\d{2})\s*(?:и|или)\s+(?:медленн|тише|легче|спокойн)/gi;
  while ((m = slower.exec(desc)) !== null) { const t = S(m[1]); if (t >= 150 && t <= 600) out.push({ fast: t, slow: t, idx: m.index }); }
  // 3) narrative easy-run range "…держись ближе к 7:04 … двигайся ближе к 7:29" (paces in prose,
  //    no dash). Only when nothing structured was found, pair the extreme paces into one range.
  if (out.length === 0) {
    const near = /ближе\s+к\s+(\d{1,2}:\d{2})/gi; const ts: { t: number; idx: number }[] = [];
    while ((m = near.exec(desc)) !== null) { const t = S(m[1]); if (t >= 150 && t <= 600) ts.push({ t, idx: m.index }); }
    if (ts.length >= 2) { const lo = ts.reduce((a, b) => (b.t < a.t ? b : a)); const hi = ts.reduce((a, b) => (b.t > a.t ? b : a)); push(lo.t, hi.t, Math.min(lo.idx, hi.idx)); }
  }
  out.sort((a, b) => a.idx - b.idx); // appearance order for positional / segment matching
  return out;
}
export type Role = "разминка" | "заминка" | "отдых" | "работа";
export type FlatStep = { role: Role; min: number; max: number; block: number; step: number; durSec: number; distM: number };
/** flatten a structure OBJECT (structure.structure[].steps[]) into ordered steps with roles.
 *  durSec = the step's duration in seconds (0 for a distance-based step) — the key for matching
 *  a step to its description SEGMENT by duration. */
export function flatSteps(structObj: unknown): { metric: string; isRep: boolean; steps: FlatStep[] } | null {
  if (!isRecord(structObj) || !Array.isArray(structObj.structure)) return null;
  const metric = String(structObj.primaryIntensityMetric ?? "");
  const isRep = structObj.structure.some((b: unknown) => isRecord(b) && b.type === "repetition");
  const steps: FlatStep[] = [];
  structObj.structure.forEach((block: unknown, bi: number) => { if (!isRecord(block) || !Array.isArray(block.steps)) return; block.steps.forEach((st: unknown, si: number) => { if (!isRecord(st)) return; const tg = Array.isArray(st.targets) && st.targets.length ? st.targets[0] : null; const cls = String(st.intensityClass ?? ""); const nm = String(st.name ?? ""); const role: Role = /warm|размин/i.test(nm) || cls === "warmUp" ? "разминка" : /cool|замин/i.test(nm) || cls === "coolDown" ? "заминка" : cls === "rest" ? "отдых" : "работа"; const len = isRecord(st.length) ? st.length : null; const lu = len ? String(len.unit ?? "") : ""; const lv = len && typeof len.value === "number" ? len.value : 0; const durSec = lu === "second" ? lv : 0; const distM = lu === "meter" || lu === "metre" ? lv : (lu === "kilometer" || lu === "km") ? lv * 1000 : 0; steps.push({ role, min: isRecord(tg) && typeof tg.minValue === "number" ? tg.minValue : NaN, max: isRecord(tg) && typeof tg.maxValue === "number" ? tg.maxValue : NaN, block: bi, step: si, durSec, distM }); }); });
  return { metric, isRep, steps };
}
export type Seg = { durSec: number; distM: number; range: Rng | null; text: string };
/** One step's assignment: the description pace (Rng), or "anchor"/"keep" when the text gives no
 *  pace, plus `walk` = this step's description segment says шагом/пауза/стоя (leave it untouched). */
export type Assign = { ref: Rng | "anchor" | "keep"; walk: boolean };
/** Parse the description into ordered SEGMENTS: a duration ("3 минуты", "1,5 минуты", "90 секунд")
 *  with an OPTIONAL pace range appearing before the next duration. A segment with no range is
 *  "by feel" (по ощущениям / легко). This replaces "grab every range" — which lost the no-pace
 *  segments and could not reconcile the count. */
export function parseSegments(desc: string): Seg[] {
  // NB: JS \w / \b do NOT cover Cyrillic — match the stems directly (минут covers минут/минуты/минуту).
  // Маркер сегмента — ДЛИТЕЛЬНОСТЬ ("3 минуты", "90 секунд") ИЛИ ДИСТАНЦИЯ ("2000 м", "3 км",
  // "2000 метров"), вперемешку по позиции. Дистанционные репы привязываются к дистанционным шагам
  // параллельно длительности. Отрицательный lookahead (?![а-яё]) не даёт «м» съесть «минут»/«метро…».
  const durRe = /(\d+(?:[.,]\d+)?)\s*(секунд|сек|минут|мин)/gi;
  const distRe = /(\d+(?:[.,]\d+)?)\s*(км|метр(?:ов|а)?|м)(?![а-яё])/gi;
  const marks: { pos: number; durSec: number; distM: number }[] = []; let m: RegExpExecArray | null;
  while ((m = durRe.exec(desc)) !== null) { const n = parseFloat(m[1].replace(",", ".")); if (!Number.isFinite(n) || n <= 0) continue; marks.push({ pos: m.index, durSec: /сек/i.test(m[2]) ? n : n * 60, distM: 0 }); }
  while ((m = distRe.exec(desc)) !== null) { const n = parseFloat(m[1].replace(",", ".")); if (!Number.isFinite(n) || n <= 0) continue; marks.push({ pos: m.index, durSec: 0, distM: /км/i.test(m[2]) ? n * 1000 : n }); }
  marks.sort((a, b) => a.pos - b.pos);
  const rs = ranges(desc);
  const segs: Seg[] = [];
  for (let i = 0; i < marks.length; i++) { const start = marks[i].pos; const end = i + 1 < marks.length ? marks[i + 1].pos : desc.length; const r = rs.find((x) => x.idx >= start && x.idx < end); segs.push({ durSec: marks[i].durSec, distM: marks[i].distM, range: r ? { fast: r.fast, slow: r.slow, idx: r.idx } : null, text: desc.slice(start, end) }); }
  return segs;
}
/** Match each structure step to a description SEGMENT by DURATION, order-preserving (a later step
 *  never takes an earlier segment → position is the tiebreak on equal durations). Segments with no
 *  corresponding step (e.g. a "5 минут полный отдых" pause) are skipped. A matched segment with no
 *  pace → "anchor" for an easy/rest/warm/cool step, or "keep" (leave as-is) for a WORK step (an
 *  RPE / "по ощущениям" hard effort we must not turn into an easy anchor). Null if a step can't be
 *  matched at all → defer. */
export function matchByDuration(steps: FlatStep[], segs: Seg[]): Assign[] | null {
  const out: Assign[] = []; let ptr = 0;
  for (const st of steps) {
    // Ключ шага — ДЛИТЕЛЬНОСТЬ (durSec) или ДИСТАНЦИЯ (distM); ищем сегмент ТОГО ЖЕ рода в допуске,
    // порядок сохраняем (поздний шаг не берёт ранний сегмент). Допуск дистанции — 8% или 50 м.
    const kind: "dur" | "dist" | null = st.durSec > 0 ? "dur" : st.distM > 0 ? "dist" : null;
    const kv = kind === "dur" ? st.durSec : st.distM;
    let found = -1;
    if (kind) {
      const tol = kind === "dur" ? Math.max(10, kv * 0.08) : Math.max(50, kv * 0.08);
      for (let j = ptr; j < segs.length; j++) { const sk: "dur" | "dist" | null = segs[j].durSec > 0 ? "dur" : segs[j].distM > 0 ? "dist" : null; const sv = sk === "dur" ? segs[j].durSec : segs[j].distM; if (sk === kind && Math.abs(sv - kv) <= tol) { found = j; break; } }
    }
    if (found < 0) {
      // Нет подходящего сегмента. РАБОЧИЙ шаг без явного темпа привязать нельзя → дефер (null).
      // Шаг без темпа (разминка/заминка/отдых) и так берёт якорь — расхождение длительности/дистанции
      // на нём НЕ должно ронять всю тренировку: ставим якорь и идём дальше, сегмент не потребляя.
      if (st.role === "работа") return null;
      out.push({ ref: "anchor", walk: false });
      continue;
    }
    const seg = segs[found]; ptr = found + 1;
    const walk = /шагом|пауз|стоя/i.test(seg.text); // #4: walk / pause step — recompute leaves it untouched
    out.push({ ref: seg.range ? seg.range : st.role === "работа" ? "keep" : "anchor", walk });
  }
  return out;
}
/** Fallback for descriptions with NO durations (simple easy runs like "Лёгкий бег — темп 5:56-6:17"):
 *  match ranges to steps by position/count. null if it can't reconcile. */
export function positionalFallback(steps: FlatStep[], rs: Rng[]): Assign[] | null {
  const nonRest = steps.filter((s) => s.role !== "отдых");
  let mode: "positional" | "positionalAll" | "anchorAll";
  if (rs.length === 0) { if (nonRest.length > 1) return null; mode = "anchorAll"; }
  else if (rs.length === steps.length) mode = "positionalAll";
  else if (rs.length === nonRest.length) mode = "positional";
  else return null;
  const out: Assign[] = []; let pos = 0; // no per-segment text here → walk detected from structure (min=0)
  for (const st of steps) {
    if (mode === "anchorAll") out.push({ ref: "anchor", walk: false });
    else if (mode === "positionalAll") { out.push({ ref: rs[pos], walk: false }); pos++; }
    else if (st.role === "отдых") out.push({ ref: "anchor", walk: false });
    else { out.push({ ref: rs[pos], walk: false }); pos++; }
  }
  return out;
}
/** ONE wide physiological frame on every step — catches parser garbage / a clearly-wrong
 *  threshold, never argues with the coach's prescribed pace. No narrow per-role bands. */
export function band(): [number, number] { return [55, 140]; }
/** Deep structural diff (order-insensitive on objects; by-index on arrays). `polyline` is a
 *  TP-recomputed rendering artifact and is excluded at any level. Collects human-readable paths. */
export function deepDiff(a: unknown, b: unknown, p: string, out: string[]): void {
  if (a === b) return;
  if (Array.isArray(a) && Array.isArray(b)) { if (a.length !== b.length) { out.push(`${p}.length ${a.length}→${b.length}`); return; } for (let i = 0; i < a.length; i++) deepDiff(a[i], b[i], `${p}[${i}]`, out); return; }
  if (isRecord(a) && isRecord(b)) { const keys = new Set([...Object.keys(a), ...Object.keys(b)]); for (const k of keys) { if (k === "polyline") continue; deepDiff(a[k], b[k], p ? `${p}.${k}` : k, out); } return; }
  out.push(`${p}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
}
export type Plan = { block: number; step: number; role: Role; oldMin: number; oldMax: number; newMin: number; newMax: number; lo: number; hi: number; ok: boolean; src: string };
/** recompute new %-targets per step from description + real threshold.
 *  SEGMENT-based: parse the description into segments (duration + optional pace), then match each
 *  structure step to a segment by DURATION (order-preserving; position tiebreaks equal durations —
 *  see matchByDuration). A step's matched segment with a pace → that pace; a no-pace segment → the
 *  athlete anchor (easy/rest/warm/cool step) or "keep" (a WORK step that is by-feel/RPE, left
 *  unchanged — never turned into an easy anchor). Un-matchable steps → defer. null if not pace. */
export function recompute(structObj: unknown, desc: string, title: string, thrSec: number, anchor: number | null): { isEasy: boolean; plans: Plan[]; defer?: string } | null {
  const fx = flatSteps(structObj); if (!fx || !/pace/i.test(fx.metric)) return null;
  const isEasy = !fx.isRep && /лёгк|легк|длительн|восстанов|свободн/i.test(title);
  const segs = parseSegments(desc);
  let assigned: Assign[] | null = matchByDuration(fx.steps, segs);
  if (!assigned) assigned = positionalFallback(fx.steps, ranges(desc)); // no-duration descriptions (simple easy runs)
  if (!assigned) return { isEasy, plans: [], defer: `шаги (${fx.steps.length}) не привязать: сегментов по длительности ${segs.length}, диапазонов ${ranges(desc).length}` };
  // A step consumes the anchor only if it reaches the anchor branch: ref === "anchor" AND it is not
  // an open-floor step (min=0 stays open-floor untouched). If any such step exists but the athlete
  // has no reliable anchor (sample n<5 → anchor is null), DO NOT guess — defer to the manual list.
  const needsAnchor = fx.steps.some((st, i) => assigned![i].ref === "anchor" && st.min !== 0);
  if (needsAnchor && anchor == null) return { isEasy, plans: [], defer: `якорь недоступен (выборка лёгких бегов n<5) — ручной список` };
  const plans: Plan[] = [];
  fx.steps.forEach((st, i) => {
    const a = assigned[i].ref; const walk = assigned[i].walk;
    // #3 open floor (minValue=0 — deliberate walk / very-easy) and #4 «шагом»/«пауза» steps: leave
    // the %-targets EXACTLY as authored. Targets are threshold-relative, so the new threshold already
    // rescales the pace ceiling proportionally; rewriting to an anchor would speed a walk up.
    const openFloor = st.min === 0;
    // A segment's «шагом/пауза» keyword must NOT freeze a step that has its OWN explicit pace range.
    // parseSegments cuts a segment's text up to the NEXT duration token, so a following "⏸ Пауза 1–2
    // минуты шагом" bleeds its walk-word into the preceding paced segment (Alex «20 х 1 мин»: the
    // 3-мин «07:04–07:24» warm-up was frozen at old % → rendered 6:53–7:12 instead of 7:02–7:23).
    // Honor the range when there is one; walk-untouch applies only to no-range (anchor/keep) steps.
    const isRange = a !== "anchor" && a !== "keep";
    let nMin: number, nMax: number, src: string;
    if (openFloor || (walk && !isRange)) { nMin = st.min; nMax = st.max; src = openFloor ? "открытый пол — не трогаем (порог сам масштабирует потолок)" : "шагом/пауза — не трогаем"; }
    else if (a === "keep") { nMin = st.min; nMax = st.max; src = "без темпа (RPE/по ощущ.) — не трогаем"; }
    else if (a === "anchor" && st.role === "отдых") { const an = anchor!; nMax = Math.round((thrSec / an) * 100); nMin = 0; src = `восстановление: открытый пол ≤${fp(an)} (не быстрее лёгкого, дальше как пойдёт)`; } // rest between reps: deliberately no floor
    else if (a === "anchor") { const an = anchor!; nMax = Math.round((thrSec / (an - 8)) * 100); nMin = Math.round((thrSec / (an + 12)) * 100); src = `якорь ${fp(an)}`; } // whole easy run by-feel: tight anchor is apt
    else if (a.fast === a.slow) { nMax = Math.round((thrSec / a.fast) * 100); nMin = Number.isFinite(st.min) ? st.min : nMax; src = `≤${fp(a.fast)} (потолок; пол сохранён)`; } // one-sided "X и медленнее": set ceiling, keep floor
    else { nMax = Math.round((thrSec / a.fast) * 100); nMin = Math.round((thrSec / a.slow) * 100); src = `${fp(a.slow)}–${fp(a.fast)}`; }
    const [lo, hi] = band();
    const restOpenFloor = a === "anchor" && st.role === "отдых"; // set to 0..anchor% — floor 0 is intentional
    const untouched = openFloor || (walk && !isRange) || a === "keep";
    const ok = untouched ? true : restOpenFloor ? nMax <= hi : nMin >= lo && nMax <= hi; // band-gate the ceiling only for rest open-floor
    plans.push({ block: st.block, step: st.step, role: st.role, oldMin: st.min, oldMax: st.max, newMin: nMin, newMax: nMax, lo, hi, ok, src });
  });
  return { isEasy, plans };
}
