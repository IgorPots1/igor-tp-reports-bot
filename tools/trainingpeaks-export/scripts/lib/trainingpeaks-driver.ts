export type TrainingPeaksMoveStatus = "ready_to_save" | "needs_manual" | "unsafe" | "failed";

export type RecommendedNextDriver = "playwright" | "stagehand" | "browser_use" | "manual";

export interface PrepareMoveWorkoutResult {
  status: TrainingPeaksMoveStatus;
  athleteIdentityOk: boolean;
  candidateFingerprintOk: boolean;
  sourceDate: string | null;
  targetDate: string | null;
  dateHeaderText: string | null;
  datePickerOpened: boolean;
  targetDateVisible: boolean;
  saveButtonVisible: boolean;
  screenshots: Record<string, string | null>;
  stepHistory: string[];
  failureReason: string | null;
  recommendedNextDriver: RecommendedNextDriver;
}

export interface ExecuteMoveWorkoutResult {
  status: TrainingPeaksMoveStatus;
  blocked?: boolean;
  message?: string;
  failureReason: string | null;
  recommendedNextDriver: RecommendedNextDriver;
}

export interface ValidateMoveWorkoutResult {
  status: TrainingPeaksMoveStatus;
  failureReason: string | null;
  recommendedNextDriver: RecommendedNextDriver;
}

export interface TrainingPeaksAutomationDriver {
  prepareMoveWorkout(actionId: string): Promise<PrepareMoveWorkoutResult>;
  executePreparedMove(actionId: string): Promise<ExecuteMoveWorkoutResult>;
  validateMoveWorkout(actionId: string): Promise<ValidateMoveWorkoutResult>;
}
