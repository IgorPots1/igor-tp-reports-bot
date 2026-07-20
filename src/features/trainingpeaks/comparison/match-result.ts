// Common result shape for both matchers (interval + steady) and the proof's
// silence taxonomy.

import type { DerivedRowForComparison, PraiseCandidate } from "./types.ts";

export type MatchOutcome = "fired" | "mad_killed" | "below_threshold" | "norm_not_met" | "no_comparable";

export type MatchResult = {
  evaluated: boolean; // a comparable-eligible run of this tier's shape
  tier: 1 | 2 | 3 | null;
  key: string | null;
  hadComparable: boolean; // at least one structurally-comparable history row
  candidates: PraiseCandidate[]; // all would-be praises (pre-focus, pre-pause)
  anyMetricEvaluated: boolean; // a norm formed for >=1 metric
  anyMadKilled: boolean; // >=1 metric cleared the flat threshold but not 2×MAD (n>=3)
  recentPool: DerivedRowForComparison[]; // for the pulse detector (intervals)
  oldPool: DerivedRowForComparison[];
  // steady-only diagnostics (0 for intervals)
  steadyComparableCount: number; // comparable steady runs after the HR-band gate
  steadyFalseAvoidedByHrBand: number; // extra "comparables" the HR-band gate rejected
};

export function classifyOutcome(m: MatchResult): MatchOutcome {
  if (m.candidates.length > 0) return "fired";
  if (m.anyMadKilled) return "mad_killed";
  if (m.anyMetricEvaluated) return "below_threshold";
  if (m.hadComparable) return "norm_not_met";
  return "no_comparable";
}
