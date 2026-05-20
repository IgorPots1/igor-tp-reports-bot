import type { TrainingPeaksWorkoutRaw } from "../../scripts/lib/trainingpeaks-workout-normalization.ts";
import { collectWorkoutText, toFiniteNumber } from "./extract-summary.ts";

export const DISTANCE_KEYWORDS = {
  "5k": /\b(5k|5\s*km|5\s*км|5000)\b/i,
  "10k": /\b(10k|10\s*km|10\s*км|10000)\b/i,
  half: /\b(half|half\s*marathon|полумарафон|21\.1|21\s*km|21\s*км)\b/i,
  marathon: /\b(marathon|марафон|42\.2|42\s*km|42\s*км)\b/i,
} as const;

export const RACE_KEYWORDS_PATTERN = /\b(race|start|забег|соревнование|parkrun)\b/i;

export const RACE_TEXT_BY_DISTANCE = {
  "5k": /\b(race|start|забег|соревнование|parkrun|5k|5\s*km|5\s*км)\b/i,
  "10k": /\b(race|start|забег|соревнование|parkrun|10k|10\s*km|10\s*км)\b/i,
  half: /\b(race|start|забег|соревнование|parkrun|half|half\s*marathon|полумарафон)\b/i,
  marathon: /\b(race|start|забег|соревнование|parkrun|marathon|марафон)\b/i,
} as const;

export const STRONG_RACE_KEYWORDS = [
  "race",
  "забег",
  "соревнование",
  "старт",
  "parkrun",
  "марафон",
  "полумарафон",
  "5k",
  "10k",
  "5 km",
  "10 km",
  "5км",
  "10км",
  "5 км",
  "10 км",
] as const;

export function containsStrongRaceKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  if (/разминка\s+перед\s+(стартом|забегом)/i.test(lower)) {
    return false;
  }
  return STRONG_RACE_KEYWORDS.some((keyword) => lower.includes(keyword.toLowerCase()));
}

export function collectRaceSignals(
  raw: TrainingPeaksWorkoutRaw,
  distanceKey: keyof typeof RACE_TEXT_BY_DISTANCE,
): string[] {
  const signals: string[] = [];
  const text = collectWorkoutText(raw);
  if (RACE_TEXT_BY_DISTANCE[distanceKey].test(text)) signals.push("race_keywords_in_text");

  const prCount = toFiniteNumber(raw.personalRecordCount);
  if (prCount !== null && prCount > 0) signals.push(`personalRecordCount=${prCount}`);

  if (raw.raceTypeDuration !== null && raw.raceTypeDuration !== undefined) {
    signals.push("raceTypeDuration_present");
  }

  const intensityFactor = toFiniteNumber(raw.if);
  if (intensityFactor !== null && intensityFactor >= 0.95) {
    signals.push(`high_if=${intensityFactor.toFixed(2)}`);
  }

  const tss = toFiniteNumber(raw.tssActual);
  if (tss !== null && tss >= 50) signals.push(`high_tss=${tss.toFixed(1)}`);

  return signals;
}
