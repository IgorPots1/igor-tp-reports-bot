// C7 — молчание про пульс при hr_trusted=false; недостоверные данные → сигнал
// тренеру, НЕ черновик. Two independent trust flags exist on derived_metrics
// (hr_trusted, pace_trusted/distance_trusted) — gate each separately so a
// bad HR stream doesn't also silence a perfectly good pace-based observation,
// and vice versa. The orchestrator uses these flags to skip the relevant
// evaluators entirely, not to filter their output after the fact.

import type { PlannerDerivedMetrics } from "./types.ts";

export type TrustGate = {
  hrTrusted: boolean;
  paceDistanceTrusted: boolean;
  hrUntrustedSignal: { numbers: Record<string, number>; reason: string } | null;
  paceDistanceUntrustedSignal: { numbers: Record<string, number>; reason: string } | null;
};

export function evaluateTrustGate(current: PlannerDerivedMetrics): TrustGate {
  const hrTrusted = current.hrTrusted !== false;
  const paceDistanceTrusted = current.paceTrusted !== false && current.distanceTrusted !== false;

  return {
    hrTrusted,
    paceDistanceTrusted,
    hrUntrustedSignal: hrTrusted
      ? null
      : { numbers: {}, reason: `hr_trusted=false${current.hrQuality ? ` (hr_quality=${current.hrQuality})` : ""} — no HR conclusions drawn, coach-only` },
    paceDistanceUntrustedSignal: paceDistanceTrusted
      ? null
      : {
          numbers: {},
          reason: `${current.paceTrusted === false ? "pace_trusted=false " : ""}${current.distanceTrusted === false ? "distance_trusted=false" : ""}`.trim() + " — no pace/distance conclusions drawn, coach-only",
        },
  };
}
