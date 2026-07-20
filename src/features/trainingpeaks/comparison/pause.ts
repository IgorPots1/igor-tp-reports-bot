// Praise pause (наряд 2, изменение 5). One praise per student per two weeks —
// a CEILING, not a schedule — so praise doesn't become background noise.
//
// Weight-aware, to fix Igor's problem: a weak mechanism-B on Tuesday must not
// swallow a strong COMPOSITE on Friday. Rule:
//
//   fire iff  candidateWeight > last.weight   (stronger breaks through at once)
//        OR   daysSince(last) >= pauseDays     (equal/weaker waits out the pause)
//
// On firing, `last` becomes {candidateWeight, date}. Consequences:
//   - composite breaks a B's pause; two composites within the window — the 2nd waits;
//   - a B after a composite waits; an A after >=14 days fires (pause expired).
//
// Chosen over "full reset on any strong praise" (would let composites spam) and
// "shortened pause for strong" (arbitrary numbers): weight-breaks-through is the
// minimal rule that encodes composite > A > B directly.

import { daysBetween } from "./resolve-window.ts";
import type { LastPraise, PraiseWeight } from "./types.ts";

export const PRAISE_PAUSE_DAYS = 14;

export function shouldEmitPraise(input: {
  candidateWeight: PraiseWeight;
  last: LastPraise | null;
  workoutDate: string;
  pauseDays?: number;
}): boolean {
  if (!input.last) return true;
  if (input.candidateWeight > input.last.weight) return true; // stronger breaks through
  return daysBetween(input.last.date, input.workoutDate) >= (input.pauseDays ?? PRAISE_PAUSE_DAYS);
}
