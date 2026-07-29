// First-half vs second-half pace/HR split for a single run, computed from its
// laps. Feeds two slots: C2's "разгон во 2й половине" (easy/long-tempo
// correction) and C3's negative-split praise / negative-split.ts's pulse gate.
// No stored field for this exists (comparison's steady-matcher only compares
// WHOLE-run avgPaceSecPerKm across workouts) — it is derived fresh from laps
// every time, which is fine: laps are already in the packet.
//
// Split by CUMULATIVE DISTANCE at the 50% mark (the standard "negative split"
// definition), assigning each lap WHOLE to the half its own midpoint falls in
// — simpler and more robust than splitting a lap that straddles the midpoint,
// and matches how a coach reads laps (lap-by-lap, not to the metre).

import type { PlannerLap } from "./types.ts";

export type SplitHalfResult = {
  firstHalfPaceSecPerKm: number;
  secondHalfPaceSecPerKm: number;
  firstHalfAvgHr: number | null;
  secondHalfAvgHr: number | null;
  totalDistanceM: number;
  secondHalfDistanceM: number; // for the degenerate-split guard (a tiny final lap ≠ a real "second half")
  firstHalfLapCount: number;
  secondHalfLapCount: number;
  validLapCount: number; // laps that survived the validity filter — the split rests on these
};

function validLaps(laps: PlannerLap[]): PlannerLap[] {
  return laps
    .filter((l) => l.isWork !== false && l.distanceM !== null && l.distanceM > 0 && l.timerTimeS !== null && l.timerTimeS > 0)
    .sort((a, b) => a.lapIndex - b.lapIndex);
}

function summarizeHalf(laps: PlannerLap[]): { paceSecPerKm: number; avgHr: number | null; distanceM: number } {
  const distanceM = laps.reduce((sum, l) => sum + (l.distanceM ?? 0), 0);
  const timeS = laps.reduce((sum, l) => sum + (l.timerTimeS ?? 0), 0);
  const hrLaps = laps.filter((l) => l.avgHr !== null);
  const hrWeightedSum = hrLaps.reduce((sum, l) => sum + l.avgHr! * (l.distanceM ?? 0), 0);
  const hrWeightDistance = hrLaps.reduce((sum, l) => sum + (l.distanceM ?? 0), 0);
  return {
    paceSecPerKm: timeS / (distanceM / 1000),
    avgHr: hrWeightDistance > 0 ? hrWeightedSum / hrWeightDistance : null,
    distanceM,
  };
}

export function computeSplitHalf(laps: PlannerLap[]): SplitHalfResult | null {
  const valid = validLaps(laps);
  if (valid.length < 2) return null;

  const totalDistanceM = valid.reduce((sum, l) => sum + (l.distanceM ?? 0), 0);
  const halfDistanceM = totalDistanceM / 2;

  const firstHalf: PlannerLap[] = [];
  const secondHalf: PlannerLap[] = [];
  let cumulativeM = 0;
  for (const lap of valid) {
    const lapDistanceM = lap.distanceM ?? 0;
    const midpointM = cumulativeM + lapDistanceM / 2;
    if (midpointM < halfDistanceM) {
      firstHalf.push(lap);
    } else {
      secondHalf.push(lap);
    }
    cumulativeM += lapDistanceM;
  }

  if (firstHalf.length === 0 || secondHalf.length === 0) return null;

  const first = summarizeHalf(firstHalf);
  const second = summarizeHalf(secondHalf);

  return {
    firstHalfPaceSecPerKm: first.paceSecPerKm,
    secondHalfPaceSecPerKm: second.paceSecPerKm,
    firstHalfAvgHr: first.avgHr,
    secondHalfAvgHr: second.avgHr,
    totalDistanceM,
    secondHalfDistanceM: second.distanceM,
    firstHalfLapCount: firstHalf.length,
    secondHalfLapCount: secondHalf.length,
    validLapCount: valid.length,
  };
}
