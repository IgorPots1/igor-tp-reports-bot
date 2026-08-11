/**
 * easy-pace-parse — the CANONICAL description→pace-range parser.
 *
 * Extracted VERBATIM from tp-threshold-restore.ts so there is exactly ONE parser:
 * both the threshold-restore recompute AND the easy-pace anchor (autoplanner sprint 1)
 * read prescribed paces the same way. Do NOT fork this logic — a second parser would
 * silently diverge and break both the %-recompute on threshold change and the anchor.
 *
 * Pure, no I/O, no external deps.
 */

/** mm:ss → seconds. */
export const S = (mm: string): number => {
  const [a, b] = mm.split(":");
  return Number(a) * 60 + Number(b);
};

export type Rng = { fast: number; slow: number; idx: number };

// NO dedup: a repeated range is TWO real segments run at the same pace (warm-up and a recovery
// can share a pace). Ranges are returned in APPEARANCE order for positional matching to steps.
export function ranges(desc: string): Rng[] {
  const out: Rng[] = [];
  const push = (a: number, b: number, idx: number): void => { const fast = Math.min(a, b), slow = Math.max(a, b); if (fast < 150 || slow > 600) return; out.push({ fast, slow, idx }); };
  let m: RegExpExecArray | null;
  // 1) explicit range via dash / @ / до: "6:05–6:32", "05:16-05:26"
  const dash = /(\d{1,2}:\d{2})\s*(?:[-–—−]|@|до)\s*(\d{1,2}:\d{2})/gi;
  while ((m = dash.exec(desc)) !== null) push(S(m[1]), S(m[2]), m.index);
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

export type Seg = { durSec: number; range: Rng | null; text: string };

/** Parse the description into ordered SEGMENTS: a duration ("3 минуты", "1,5 минуты", "90 секунд")
 *  with an OPTIONAL pace range appearing before the next duration. A segment with no range is
 *  "by feel" (по ощущениям / легко). */
export function parseSegments(desc: string): Seg[] {
  // NB: JS \w / \b do NOT cover Cyrillic — match the stems directly (минут covers минут/минуты/минуту).
  const durRe = /(\d+(?:[.,]\d+)?)\s*(секунд|сек|минут|мин)/gi;
  const durs: { pos: number; sec: number }[] = []; let m: RegExpExecArray | null;
  while ((m = durRe.exec(desc)) !== null) { const n = parseFloat(m[1].replace(",", ".")); if (!Number.isFinite(n) || n <= 0) continue; const sec = /сек/i.test(m[2]) ? n : n * 60; durs.push({ pos: m.index, sec }); }
  const rs = ranges(desc);
  const segs: Seg[] = [];
  for (let i = 0; i < durs.length; i++) { const start = durs[i].pos; const end = i + 1 < durs.length ? durs[i + 1].pos : desc.length; const r = rs.find((x) => x.idx >= start && x.idx < end); segs.push({ durSec: durs[i].sec, range: r ? { fast: r.fast, slow: r.slow, idx: r.idx } : null, text: desc.slice(start, end) }); }
  return segs;
}

/** The `isEasy` title test from recompute(): a continuous (non-repetition) run whose title marks it
 *  easy/long/recovery/free. Canonical here so the anchor and the restore agree on "what is easy". */
export const EASY_TITLE_RE = /лёгк|легк|длительн|восстанов|свободн/i;
export function isEasyRunTitle(title: string): boolean {
  return EASY_TITLE_RE.test(title);
}
