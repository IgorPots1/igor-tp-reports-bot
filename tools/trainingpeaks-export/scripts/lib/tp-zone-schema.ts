// Anchor-based zone schema — SINGLE source (used by tp-rebuild-zones + the roster plan sweep).
// Z1/Z2/Z3 built around the measured easy anchor; Z4+ from the covered Friel/method scheme × threshold.
// Zone count + labels + sentinel cap preserved. See docs / ops-log 2026-08-05 for the derivation.
import type { CoveredScheme, ZoneBoundary } from "./tp-zone-formulas.ts";

export const ZONE_HALF = 20; // Z2 = anchor ± 20с (полоса 40с)
export const MED_RATIO = 1.257; // измеренная медиана отношения якорь/порог по ростеру
export const RATIO_LO = 1.20, RATIO_HI = 1.38; // FIT-якорю доверяем в этой полосе; вне → медиана

/** Choose the anchor: STORE is always trusted (personal); a FIT anchor is trusted only inside the
 *  ratio band, else replaced by the median-ratio anchor. Returns the anchor (sec/km) + which mode. */
export function chooseAnchor(fromStore: boolean, rawAnchorSec: number, thrSec: number): { anchorSec: number; mode: "store" | "personal" | "median"; ratio: number } {
  const ratio = rawAnchorSec / thrSec;
  if (fromStore) return { anchorSec: rawAnchorSec, mode: "store", ratio };
  if (ratio >= RATIO_LO && ratio <= RATIO_HI) return { anchorSec: rawAnchorSec, mode: "personal", ratio };
  return { anchorSec: MED_RATIO * thrSec, mode: "median", ratio };
}

/** Build anchor-based zones for one set. Z1.max = anchor+ZONE_HALF (slow edge, lower speed), Z2.max =
 *  anchor−ZONE_HALF (fast edge). Z3+ maxima = scheme.ratios × thrSpeed; last zone preserved when it is a
 *  sentinel cap. Z1.min = scheme.firstZoneMinRatio × thrSpeed. Returns ok:false (non-monotonic) so the
 *  caller can fail-closed — never write a garbled grid. */
export function buildAnchorZones(scheme: CoveredScheme, thrSpeed: number, anchorSec: number, cur: ZoneBoundary[]): { ok: boolean; zones: ZoneBoundary[]; why?: string } {
  const z2min = 1000 / (anchorSec + ZONE_HALF); // speed at Z2 slow edge
  const z2max = 1000 / (anchorSec - ZONE_HALF); // speed at Z2 fast edge
  const N = scheme.zoneCount; const round = (v: number) => (scheme.rounding === "integer" ? Math.round(v) : v);
  const maxima: number[] = [];
  for (let i = 0; i < N; i++) {
    if (i === 0) maxima.push(z2min);
    else if (i === 1) maxima.push(z2max);
    else if (i === N - 1 && scheme.lastZoneIsCap) maxima.push(cur[i]?.maximum ?? scheme.ratios[i] * thrSpeed);
    else maxima.push(round(scheme.ratios[i] * thrSpeed));
  }
  const z1min = round(scheme.firstZoneMinRatio * thrSpeed);
  const seq = [z1min, ...maxima];
  for (let i = 1; i < seq.length; i++) if (!(seq[i] > seq[i - 1])) return { ok: false, zones: [], why: `неупорядочено на границе ${i} (${seq[i - 1].toFixed(3)}→${seq[i].toFixed(3)}) — якорь слишком быстрый для сетки` };
  if (maxima.length !== cur.length) return { ok: false, zones: [], why: `число зон ${cur.length}→${maxima.length}` };
  const zones = maxima.map((mx, i) => ({ label: cur[i]?.label, minimum: i === 0 ? z1min : maxima[i - 1], maximum: mx }));
  return { ok: true, zones };
}
