import type { FootStrikeType, MetricSeverity, VerticalOscillationBand } from "@/features/run-analysis/types";

// TODO: validate thresholds with Igor after first real runs

type Range = {
  lowImportant?: number;
  lowAttention?: number;
  okLow: number;
  okHigh: number;
  highAttention?: number;
  highImportant?: number;
};

function classifyRange(value: number, r: Range): MetricSeverity {
  if (value >= r.okLow && value <= r.okHigh) return "ok";
  if (r.highImportant !== undefined && value > r.highImportant) return "important";
  if (r.lowImportant !== undefined && value < r.lowImportant) return "important";
  return "attention";
}

// Knee FLEXION at ground contact (degrees from straight; 0° = straight leg).
// Measured as 180 − interior(hip-knee-ankle) angle in compute-metrics.
const KNEE_FLEXION: Range = { lowImportant: 10, lowAttention: 15, okLow: 20, okHigh: 35, highAttention: 45, highImportant: 55 };

// Forward lean from vertical (degrees)
const TRUNK_LEAN: Range = { lowAttention: 3, okLow: 5, okHigh: 12, highAttention: 18, highImportant: 25 };

// Vertical oscillation as % of body height (severity, used when confidence is ok)
const VERT_OSC: Range = { okLow: 0, okHigh: 7, highAttention: 10, highImportant: 13 };

// Vertical oscillation qualitative band (% of body height).
// TODO: tune band edges on real static-camera footage.
const VERT_OSC_BAND = { lowMax: 6, mediumMax: 9 };

export function classifyKneeAngle(deg: number): MetricSeverity {
  return classifyRange(deg, KNEE_FLEXION);
}

export function classifyTrunkLean(deg: number): MetricSeverity {
  return classifyRange(deg, TRUNK_LEAN);
}

export function classifyVerticalOscillation(pct: number): MetricSeverity {
  return classifyRange(pct, VERT_OSC);
}

export function classifyVerticalOscillationBand(pct: number): VerticalOscillationBand {
  if (pct < VERT_OSC_BAND.lowMax) return "low";
  if (pct < VERT_OSC_BAND.mediumMax) return "medium";
  return "high";
}

// Negative or zero = foot under body (ok); positive = foot ahead of hip (overstride)
export function classifyOverstride(pct: number): MetricSeverity {
  if (pct <= 0) return "ok";
  if (pct <= 8) return "attention";
  return "important";
}

export function classifyFootStrike(type: FootStrikeType): MetricSeverity {
  if (type === "forefoot" || type === "midfoot") return "ok";
  return "attention";
}

// ── Confidence thresholds ────────────────────────────────────────────────
// Start values — TODO: tune with Igor on real footage (good + deliberately bad).
export const CONFIDENCE_CONFIG = {
  // clean ground contacts needed for contact-based metrics (knee/overstride/foot strike)
  minContactsOk: 3,
  minContactsLow: 1,
  // mean MediaPipe visibility of the landmarks a metric needs
  visibilityOk: 0.6,
  visibilityUnavailable: 0.4,
  // subject size: full body height as a fraction of frame height
  minSubjectHeightNorm: 0.3,
  // vertical oscillation: contact cycles + camera-motion tolerance
  oscMinCyclesOk: 3,
  oscMinCyclesLow: 1,
  // ratio of (linear hip.y drift over clip) / (per-cycle oscillation amplitude)
  oscCameraMotionLow: 0.6, // above → "low" (camera moved a bit)
  oscCameraMotionUnavailable: 1.5, // above → "unavailable" (camera clearly panned)
  // overall gate: minimum measured metrics that must be available to show a report
  minAvailableMetricsForReport: 2,
} as const;

// Calibration: shoulder→ankle span is ~0.75 of full standing height, so dividing
// by it directly underestimates height and inflates the oscillation %. TODO: tune.
export const SHOULDER_ANKLE_HEIGHT_FRACTION = 0.75;

export const NORM_DESCRIPTIONS = {
  kneeAngle: "20–35° сгиба при опоре",
  trunkLean: "5–12° вперёд",
  verticalOscillation: "низкая–средняя",
  overstride: "стопа под бедром",
  footStrike: "передняя/средняя часть",
} as const;
