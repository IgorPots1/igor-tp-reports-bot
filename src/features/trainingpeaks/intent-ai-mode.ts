export type TrainingPeaksIntentAiMode = "off" | "log_only" | "active";

export function getTrainingPeaksIntentAiMode(): TrainingPeaksIntentAiMode {
  const value = process.env.TRAININGPEAKS_INTENT_AI_MODE?.trim().toLowerCase();
  if (value === "log_only") {
    return "log_only";
  }

  if (value === "active") {
    return "active";
  }

  return "off";
}

export function isTrainingPeaksIntentAiLogOnlyEnabled(): boolean {
  return getTrainingPeaksIntentAiMode() === "log_only";
}

export function isTrainingPeaksIntentAiActive(): boolean {
  return getTrainingPeaksIntentAiMode() === "active";
}

// Minimum LLM confidence to promote a missed message to a move action.
// Env: MOVE_AI_RECALL_THRESHOLD (0–1, default 0.8).
export function getMoveAiRecallThreshold(): number {
  const raw = process.env.MOVE_AI_RECALL_THRESHOLD?.trim();
  const parsed = parseFloat(raw ?? "");
  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
    return parsed;
  }

  return 0.8;
}
