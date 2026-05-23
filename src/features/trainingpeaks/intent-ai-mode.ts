export type TrainingPeaksIntentAiMode = "off" | "log_only";

export function getTrainingPeaksIntentAiMode(): TrainingPeaksIntentAiMode {
  const value = process.env.TRAININGPEAKS_INTENT_AI_MODE?.trim().toLowerCase();
  if (value === "log_only") {
    return "log_only";
  }

  return "off";
}

export function isTrainingPeaksIntentAiLogOnlyEnabled(): boolean {
  return getTrainingPeaksIntentAiMode() === "log_only";
}
