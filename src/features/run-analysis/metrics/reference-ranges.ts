import type { FootStrikeType, MetricSeverity } from "@/features/run-analysis/types";

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

// Steps per minute — recreational to sub-elite
const CADENCE: Range = { lowImportant: 150, lowAttention: 160, okLow: 170, okHigh: 190, highAttention: 200 };

// Knee flexion at ground contact (degrees)
const KNEE_ANGLE: Range = { lowImportant: 10, lowAttention: 15, okLow: 20, okHigh: 35, highAttention: 45, highImportant: 55 };

// Forward lean from vertical (degrees)
const TRUNK_LEAN: Range = { lowAttention: 3, okLow: 5, okHigh: 12, highAttention: 18, highImportant: 25 };

// Vertical oscillation as % of body height
const VERT_OSC: Range = { okLow: 0, okHigh: 4, highAttention: 7, highImportant: 10 };

export function classifyCadence(spm: number): MetricSeverity {
  return classifyRange(spm, CADENCE);
}

export function classifyKneeAngle(deg: number): MetricSeverity {
  return classifyRange(deg, KNEE_ANGLE);
}

export function classifyTrunkLean(deg: number): MetricSeverity {
  return classifyRange(deg, TRUNK_LEAN);
}

export function classifyVerticalOscillation(pct: number): MetricSeverity {
  return classifyRange(pct, VERT_OSC);
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

export const NORM_DESCRIPTIONS = {
  cadence: "170–190 шаг/мин",
  kneeAngle: "20–35° при опоре",
  trunkLean: "5–12° вперёд",
  verticalOscillation: "< 4% роста",
  overstride: "стопа под бедром",
  footStrike: "передняя/средняя часть",
} as const;
