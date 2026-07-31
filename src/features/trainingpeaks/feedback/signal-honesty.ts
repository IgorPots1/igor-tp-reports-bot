// Shared honesty gate for NEGATIVE effort narratives (interval fade / "к концу тяжелее" / a pulse
// claim). The failure class this closes: a "got harder / slower / higher" story asserted from a
// single-point, un-corroborated threshold — «темп просел» on a run that got FASTER (Olga),
// «пульс выше обычного» on a run whose HR was BELOW usual (Mariyet).
//
// A negative claim is honest only when it survives all three gates (coach-confirmed against 14 days
// of live drafts; the real first→last deltas were bimodal — false cases ≤5 s/km or negative, genuine
// fades ≥15 s/km — with a clean empty band at 5–8 s/km, so 8 is a safe floor):
//   (a) SIGN — the metric actually moved the claimed way (the back half is genuinely slower, not
//       faster). Rep 1 is dropped as a rolling-start / acceleration outlier before judging.
//   (b) ROBUST threshold — SECOND-half mean vs FIRST-half mean (not one rep vs the fastest rep),
//       and SUSTAINED (most of the back half slower), so a single blip that later recovers does not
//       trip it (Olga's rep 5 blip while rep 13 was her fastest).
//   (c) HR corroboration — peak HR actually rose across the series (effort went up). If pace eased
//       but HR did not rise, the honest read is "held effort even", not fatigue.

export const FADE_MIN_SEC_PER_KM = 8; // back half must be ≥8 s/km slower than the front half
export const HR_CLIMB_MIN_BPM = 6; // last rep peak-HR must exceed the first by ≥6 bpm to call it harder

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

function bodyPaces(repPaces: Array<number | null> | null | undefined): number[] {
  const paces = (repPaces ?? []).filter((p): p is number => p !== null && p > 0);
  // Need rep 1 + at least 3 body reps to split the body into two halves.
  return paces.length < 4 ? [] : paces.slice(1);
}

/**
 * Second-half mean pace minus first-half mean (sec/km), over the reps AFTER rep 1. Positive = the
 * back half is genuinely slower. Returns null when there are too few reps to judge.
 */
export function robustFadeSecPerKm(repPaces: Array<number | null> | null | undefined): number | null {
  const body = bodyPaces(repPaces);
  if (body.length < 3) return null;
  const midIdx = Math.floor(body.length / 2);
  const front = body.slice(0, midIdx);
  const back = body.slice(midIdx);
  if (!front.length || !back.length) return null;
  return mean(back) - mean(front);
}

/** Did the series actually END HARDER, or did it recover? A fade is «к концу тяжелее» only if the
 *  LAST rep is slower than the front-half pace AND the series' fastest rep is NOT in the back half
 *  (Olga's rep 13 — her fastest — came AFTER the alleged break, i.e. she recovered → not a fade). */
export function endedSlower(repPaces: Array<number | null> | null | undefined): boolean {
  const body = bodyPaces(repPaces);
  if (body.length < 3) return false;
  const midIdx = Math.floor(body.length / 2);
  const front = body.slice(0, midIdx);
  const back = body.slice(midIdx);
  if (!front.length || !back.length) return false;
  const frontMean = mean(front);
  const lastRep = body[body.length - 1]!;
  const backSurged = Math.min(...back) < Math.min(...front); // a late rep faster than any front rep = recovery
  return lastRep > frontMean && !backSurged;
}

/** Did effort actually rise across the series? Last rep peak-HR over the first by ≥ minBpm. Untrusted
 *  HR never corroborates. */
export function hrClimbed(
  repPeakHrs: Array<number | null> | null | undefined,
  hrTrusted: boolean | null | undefined,
  minBpm: number = HR_CLIMB_MIN_BPM
): boolean {
  if (hrTrusted === false) return false;
  const hrs = (repPeakHrs ?? []).filter((h): h is number => h !== null);
  if (hrs.length < 3) return false;
  return hrs[hrs.length - 1]! > hrs[0]! + minBpm;
}

/** Gate (a)+(b): a pace-decline claim is honest only when the back half is genuinely (sign),
 *  robustly (≥ threshold) and sustainably slower. HR corroboration (c) is checked separately by the
 *  caller so it can choose the wording ("тяжелее" vs "держал ровно"). */
export function isHonestFade(repPaces: Array<number | null> | null | undefined): boolean {
  const fade = robustFadeSecPerKm(repPaces);
  return fade !== null && fade >= FADE_MIN_SEC_PER_KM && endedSlower(repPaces);
}
