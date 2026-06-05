import { createHash } from "node:crypto";

import { createSupabaseServerClient } from "@/features/supabase/server";
import {
  extractMoveSourceExecutionContextFromDryRunLog,
  INFERRED_MOVE_SOURCE_EXECUTION_BLOCK_MESSAGE_RU,
  INFERRED_MOVE_SOURCE_EXECUTION_BLOCK_REASON,
  isEligibleForCoachSourceDateConfirmation,
  isExecutableMoveSourcePolicy,
  validateDryRunLogReadiness,
} from "@/features/trainingpeaks/move-source-policy";

export type TrainingPeaksTelegramFormality = "ty" | "vy" | "unknown";

export type TrainingPeaksStudent = {
  id: string;
  studentId: string;
  studentName: string;
  trainingPeaksAthleteUrl: string;
  isActive: boolean;
  weeklyReportEnabled: boolean;
  archivedAt: string | null;
  telegramChatId: string | null;
  telegramUsername: string | null;
  telegramProfileUrl: string | null;
  telegramDeliveryEnabled: boolean;
  telegramFormality: TrainingPeaksTelegramFormality;
  telegramContextNotes: string | null;
  dataQualityStatus: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TrainingPeaksStudentThread = {
  id: string;
  studentId: string;
  telegramChatId: string;
  telegramMessageThreadId: number;
  chatTitle: string | null;
  threadTitle: string | null;
  linkedByUserId: string;
  createdAt: string;
  updatedAt: string;
};

type TrainingPeaksStudentRow = {
  id: string;
  student_id: string;
  student_name: string;
  trainingpeaks_athlete_url: string;
  is_active: boolean;
  weekly_report_enabled: boolean;
  archived_at: string | null;
  telegram_chat_id: string | null;
  telegram_username: string | null;
  telegram_profile_url: string | null;
  telegram_delivery_enabled: boolean;
  telegram_formality: string;
  telegram_context_notes: string | null;
  data_quality_status: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type TrainingPeaksStudentThreadRow = {
  id: string;
  student_id: string;
  telegram_chat_id: string;
  telegram_message_thread_id: number;
  chat_title: string | null;
  thread_title: string | null;
  linked_by_user_id: string;
  created_at: string;
  updated_at: string;
};

export type InsertTrainingPeaksStudentInput = {
  studentId: string;
  studentName: string;
  trainingPeaksAthleteUrl: string;
  isActive?: boolean;
  weeklyReportEnabled?: boolean;
  telegramChatId?: string | null;
  telegramUsername?: string | null;
  telegramProfileUrl?: string | null;
  telegramDeliveryEnabled?: boolean;
  dataQualityStatus?: string | null;
  notes?: string | null;
};

export type UpdateTrainingPeaksStudentTelegramContactInput = {
  telegramChatId?: string | null;
  telegramUsername?: string | null;
  telegramProfileUrl?: string | null;
  telegramDeliveryEnabled?: boolean;
};

export type UpdateTrainingPeaksStudentTelegramContextInput = {
  telegramFormality?: TrainingPeaksTelegramFormality;
  telegramContextNotes?: string | null;
};

export type UpdateTrainingPeaksStudentTelegramContactParams = {
  telegram_chat_id?: string | null;
  telegram_username?: string | null;
  telegram_profile_url?: string | null;
  telegram_delivery_enabled?: boolean;
};

export class TrainingPeaksStudentConflictError extends Error {
  readonly reason: "student_id" | "trainingpeaks_athlete_url";

  constructor(reason: "student_id" | "trainingpeaks_athlete_url") {
    super(`TrainingPeaks student already exists for ${reason}`);
    this.name = "TrainingPeaksStudentConflictError";
    this.reason = reason;
  }
}

export class TrainingPeaksStudentThreadConflictError extends Error {
  constructor() {
    super("TrainingPeaks student thread already exists");
    this.name = "TrainingPeaksStudentThreadConflictError";
  }
}

export type TrainingPeaksWeeklyReport = {
  id: string;
  studentId: string;
  studentName: string;
  weekFrom: string;
  weekTo: string;
  status: string;
  reportMarkdown: string | null;
  editedReportMarkdown: string | null;
  editedAt: string | null;
  summaryJson: unknown | null;
  warnings: unknown | null;
  coachNotesJson: unknown | null;
  syncedAt: string;
  reviewStatus: string;
  approvedAt: string | null;
  sentAt: string | null;
  sentToChatId: string | null;
  deliveryError: string | null;
  createdAt: string;
  updatedAt: string;
};

type TrainingPeaksWeeklyReportRow = {
  id: string;
  student_id: string;
  student_name: string;
  week_from: string;
  week_to: string;
  status: string;
  report_markdown: string | null;
  edited_report_markdown: string | null;
  edited_at: string | null;
  summary_json: unknown | null;
  warnings: unknown | null;
  coach_notes_json: unknown | null;
  synced_at: string;
  review_status: string;
  approved_at: string | null;
  sent_at: string | null;
  sent_to_chat_id: string | null;
  delivery_error: string | null;
  created_at: string;
  updated_at: string;
};

type TrainingPeaksWeeklyReportLookupRow = Pick<TrainingPeaksWeeklyReportRow, "id" | "student_id">;
type TrainingPeaksStudentIdRow = Pick<TrainingPeaksStudentRow, "student_id">;

export type UpdateTrainingPeaksWeeklyReportStateInput = {
  reviewStatus?: string;
  approvedAt?: string | null;
  sentAt?: string | null;
  sentToChatId?: string | null;
  deliveryError?: string | null;
};

export type UpdateTrainingPeaksWeeklyReportContentInput = {
  editedReportMarkdown?: string | null;
  editedAt?: string | null;
};

export type UpdateTrainingPeaksWeeklyReportReviewStateInput = {
  review_status: string;
  approved_at?: string | null;
  sent_at?: string | null;
  sent_to_chat_id?: string | null;
  delivery_error?: string | null;
};

export type TrainingPeaksWeek = {
  weekFrom: string;
  weekTo: string;
};

type TrainingPeaksWeekRow = {
  week_from: string;
  week_to: string;
};

export type TrainingPeaksJobType = "weekly_reports" | "race_scan_events" | "race_results_probe";
export type TrainingPeaksJobScope = "all_enabled" | "single_student";
export type TrainingPeaksJobStatus = "queued" | "running" | "completed" | "failed";
export type TrainingPeaksActionType = "move_workout";
export type TrainingPeaksActionStatus = "pending_coach" | "approved" | "rejected";
export type TrainingPeaksActionExecutionStatus =
  | "not_started"
  | "dry_run_running"
  | "dry_run_completed"
  | "execute_pending"
  | "running_local"
  | "completed"
  | "failed";
export type TrainingPeaksActionExecutionMode = "dry_run" | "real";
export type TrainingPeaksActionRunType = "dry_run" | "real";
export type TrainingPeaksActionRunStatus = "running" | "completed" | "failed";

export type TrainingPeaksStudentContactEventType =
  | "athlete_message"
  | "coach_message"
  | "report_sent"
  | "coach_action_decision";
export type TrainingPeaksStudentContactEventSource =
  | "telegram_business_dm"
  | "telegram_private_dm"
  | "telegram_group_topic"
  | "telegram_group_general"
  | "admin_report_send"
  | "admin_action";
export type TrainingPeaksStudentContextCacheStatus = "ok" | "empty" | "stale";
export type TrainingPeaksRecoveryAlertKind =
  | "short_sleep_streak"
  | "short_sleep_plus_low_body_battery";
export type TrainingPeaksCoachCaseKind =
  | "move_workout_requested"
  | "move_workout_needs_review"
  | "question_to_coach"
  | "pain_or_health_signal"
  | "unrecognized_intent"
  | "observation_only";
export type TrainingPeaksCoachCaseStatus =
  | "logged"
  | "open"
  | "needs_review"
  | "resolved"
  | "dismissed";
export type TrainingPeaksOperationalSignalStatus =
  | "active"
  | "consumed"
  | "expired"
  | "cancelled"
  | "dismissed";
export type TrainingPeaksOperationalSignalType =
  | "schedule_availability_window"
  | "schedule_unavailability_window"
  | "resume_training"
  | "pause_training"
  | "health_issue_started"
  | "health_issue_resolved"
  | "health_issue_improving"
  | "move_workout_candidate"
  | "plan_generation_constraint"
  | "pain_injury"
  | "external_training_context"
  | "race_load_context";
export type TrainingPeaksCoachActionKind =
  | "case_resolved"
  | "case_dismissed"
  | "reply_draft_used"
  | "reply_draft_edited"
  | "reply_draft_ignored";
export type TrainingPeaksCoachActionSource = "telegram_command" | "admin_ui" | "system_backfill";

export type TrainingPeaksRaceResultsProbeRequestJson = {
  distance: string;
  preset: string;
  from: string;
  to: string;
  athleteId: number;
  studentSlug?: string;
};

export type TrainingPeaksJob = {
  id: string;
  jobType: TrainingPeaksJobType;
  scope: TrainingPeaksJobScope;
  studentId: string | null;
  status: TrainingPeaksJobStatus;
  weekFrom: string;
  weekTo: string;
  requestJson: TrainingPeaksRaceResultsProbeRequestJson | null;
  requestedByChatId: string | null;
  requestedByUserId: string | null;
  resultJson: unknown | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
};

type TrainingPeaksJobRow = {
  id: string;
  job_type: TrainingPeaksJobType;
  scope: TrainingPeaksJobScope;
  student_id: string | null;
  status: TrainingPeaksJobStatus;
  week_from: string;
  week_to: string;
  request_json: TrainingPeaksRaceResultsProbeRequestJson | null;
  requested_by_chat_id: string | null;
  requested_by_user_id: string | null;
  result_json: unknown | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
};

export type TrainingPeaksAction = {
  id: string;
  studentId: string | null;
  actionType: TrainingPeaksActionType;
  status: TrainingPeaksActionStatus;
  sourceChatId: string;
  sourceMessageId: string;
  sourceUserId: string | null;
  rawText: string;
  parsedPayload: unknown;
  confidence: string | null;
  coachChatId: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  decidedByChatId: string | null;
  decidedByUserId: string | null;
  decisionMessageId: string | null;
  executionStatus: TrainingPeaksActionExecutionStatus;
  executionMode: TrainingPeaksActionExecutionMode | null;
  claimedBy: string | null;
  claimedAt: string | null;
  lastRunId: string | null;
  executionRequestedAt: string | null;
  executionRequestedByChatId: string | null;
  executionRequestedByUserId: string | null;
  executionRequestMessageId: string | null;
  cancelledAt: string | null;
  cancelledByChatId: string | null;
  cancelledByUserId: string | null;
  cancelMessageId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TrainingPeaksActionWithStudent = TrainingPeaksAction & {
  studentName: string | null;
};

type TrainingPeaksActionRow = {
  id: string;
  student_id: string | null;
  action_type: TrainingPeaksActionType;
  status: TrainingPeaksActionStatus;
  source_chat_id: string;
  source_message_id: string;
  source_user_id: string | null;
  raw_text: string;
  parsed_payload: unknown;
  confidence: string | null;
  coach_chat_id: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  decided_by_chat_id: string | null;
  decided_by_user_id: string | null;
  decision_message_id: string | null;
  execution_status: TrainingPeaksActionExecutionStatus;
  execution_mode: TrainingPeaksActionExecutionMode | null;
  claimed_by: string | null;
  claimed_at: string | null;
  last_run_id: string | null;
  execution_requested_at: string | null;
  execution_requested_by_chat_id: string | null;
  execution_requested_by_user_id: string | null;
  execution_request_message_id: string | null;
  cancelled_at: string | null;
  cancelled_by_chat_id: string | null;
  cancelled_by_user_id: string | null;
  cancel_message_id: string | null;
  created_at: string;
  updated_at: string;
};

export type TrainingPeaksActionRun = {
  id: string;
  actionId: string;
  runType: TrainingPeaksActionRunType;
  status: TrainingPeaksActionRunStatus;
  dryRun: boolean;
  runnerId: string | null;
  startedAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
  logJson: unknown;
  screenshotBeforePath: string | null;
  screenshotAfterPath: string | null;
  createdAt: string;
};

export type TrainingPeaksStudentContactEvent = {
  id: string;
  studentId: string;
  eventType: TrainingPeaksStudentContactEventType;
  source: TrainingPeaksStudentContactEventSource;
  occurredAt: string;
  referenceId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type TrainingPeaksStudentContactEventRow = {
  id: string;
  student_id: string;
  event_type: string;
  source: string;
  occurred_at: string;
  reference_id: string | null;
  metadata: unknown;
  created_at: string;
};

export type InsertTrainingPeaksStudentContactEventInput = {
  studentId: string;
  eventType: TrainingPeaksStudentContactEventType;
  source: TrainingPeaksStudentContactEventSource;
  occurredAt?: string;
  referenceId?: string | null;
  metadata?: Record<string, unknown>;
};

export type TrainingPeaksStudentContactStatus = {
  studentId: string;
  lastAthleteMessageAt: string | null;
  lastCoachTouchAt: string | null;
  lastContactEventAt: string | null;
  silenceDays: number | null;
  unansweredSince: string | null;
  unansweredSeconds: number | null;
};

type TrainingPeaksStudentContactStatusRow = {
  student_id: string;
  last_athlete_message_at: string | null;
  last_coach_touch_at: string | null;
  last_contact_event_at: string | null;
  silence_days: number | null;
  unanswered_since: string | null;
  unanswered_seconds: number | null;
};

type TrainingPeaksActionRunRow = {
  id: string;
  action_id: string;
  run_type: TrainingPeaksActionRunType;
  status: TrainingPeaksActionRunStatus;
  dry_run: boolean;
  runner_id: string | null;
  started_at: string;
  finished_at: string | null;
  error_message: string | null;
  log_json: unknown;
  screenshot_before_path: string | null;
  screenshot_after_path: string | null;
  created_at: string;
};

export type ClaimedTrainingPeaksDryRunAction = {
  action: TrainingPeaksAction;
  student: TrainingPeaksStudent | null;
};

export type CreateTrainingPeaksActionRunInput = {
  actionId: string;
  runType: TrainingPeaksActionRunType;
  dryRun?: boolean;
  runnerId?: string | null;
};

export type CompleteTrainingPeaksActionDryRunInput = {
  runId: string;
  logJson?: unknown;
  screenshotBeforePath?: string | null;
  screenshotAfterPath?: string | null;
};

export type FailTrainingPeaksActionDryRunInput = {
  runId: string;
  errorMessage: string;
  logJson?: unknown;
};

export type CreateTrainingPeaksWeeklyJobInput = {
  scope?: TrainingPeaksJobScope;
  studentId?: string | null;
  weekFrom: string;
  weekTo: string;
  requestedByChatId?: string | null;
  requestedByUserId?: string | null;
};

export type CreateTrainingPeaksRaceScanJobInput = {
  fromDate: string;
  toDate: string;
  requestedByChatId?: string | null;
  requestedByUserId?: string | null;
};

export type CreateTrainingPeaksRaceResultsProbeJobInput = {
  studentInternalId: string;
  fromDate: string;
  toDate: string;
  requestJson: TrainingPeaksRaceResultsProbeRequestJson;
  requestedByChatId: string;
  requestedByUserId?: string | null;
};

export type CreateTrainingPeaksActionInput = {
  studentId?: string | null;
  actionType?: TrainingPeaksActionType;
  status?: TrainingPeaksActionStatus;
  executionStatus?: TrainingPeaksActionExecutionStatus;
  approvedAt?: string | null;
  sourceChatId: string;
  sourceMessageId: string;
  sourceUserId?: string | null;
  rawText: string;
  parsedPayload: unknown;
  confidence?: string | null;
  coachChatId?: string | null;
};

type DecideTrainingPeaksActionInput = {
  actionId: string;
  decidedByChatId: string;
  decidedByUserId?: string | null;
  decisionMessageId?: string | null;
};

export type DecideTrainingPeaksActionResult =
  | {
      kind: "updated";
      action: TrainingPeaksAction;
    }
  | {
      kind: "already_decided";
      action: TrainingPeaksAction;
    }
  | {
      kind: "not_found";
    };

export type RequestTrainingPeaksActionExecutionInput = {
  actionId: string;
  requestedByChatId: string;
  requestedByUserId?: string | null;
  requestMessageId?: string | null;
};

export type RequestTrainingPeaksActionDryRunRecheckInput = {
  actionId: string;
  requestedByChatId: string;
};

export type ConfirmTrainingPeaksActionSourceDateInput = {
  actionId: string;
  confirmedByChatId: string;
  confirmedByUserId?: string | null;
  confirmationMessageId?: string | null;
};

export type ConfirmTrainingPeaksActionSourceDateResult =
  | {
      kind: "confirmed";
      action: TrainingPeaksAction;
      confirmedSourceDate: string;
      latestDryRun: TrainingPeaksActionRunContextSummary;
      dryRunRequeueRequested: boolean;
    }
  | {
      kind: "not_found";
    }
  | {
      kind: "blocked";
      action: TrainingPeaksAction;
      reason: string;
      latestDryRun: TrainingPeaksActionRunContextSummary | null;
    };

export type TrainingPeaksActionExecutionQueuedDisplayContext = {
  studentName: string | null;
  trustedSourceDate: string;
  trustedTargetDate: string;
};

export type TrainingPeaksActionRunContextSummary = {
  runId: string;
  runType: TrainingPeaksActionRunType;
  status: TrainingPeaksActionRunStatus;
  startedAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
  dryRunResult: string | null;
  canExecute: boolean | null;
  selectedSourceDate: string | null;
  selectedSourceDatePolicy: string | null;
  failureReason: string | null;
  blockedReason: string | null;
  logJson: unknown;
};

export type TrainingPeaksActionLatestRunContext = {
  action: TrainingPeaksAction;
  latestDryRun: TrainingPeaksActionRunContextSummary | null;
  latestExecute: TrainingPeaksActionRunContextSummary | null;
  latestRelevant: TrainingPeaksActionRunContextSummary | null;
};

export type RequestTrainingPeaksActionExecutionResult =
  | {
      kind: "queued";
      action: TrainingPeaksAction;
      queuedDisplay: TrainingPeaksActionExecutionQueuedDisplayContext;
    }
  | {
      kind: "already_queued";
      action: TrainingPeaksAction;
    }
  | {
      kind: "final_state";
      action: TrainingPeaksAction;
    }
  | {
      kind: "blocked";
      action: TrainingPeaksAction;
      reason: string;
      latestRunContext: TrainingPeaksActionLatestRunContext | null;
    }
  | {
      kind: "not_found";
    };

export type RequestTrainingPeaksActionDryRunRecheckResult =
  | {
      kind: "requeued";
      action: TrainingPeaksAction;
      message: string;
    }
  | {
      kind: "blocked";
      action: TrainingPeaksAction;
      reason: string;
      message: string;
      latestRunContext: TrainingPeaksActionLatestRunContext | null;
    }
  | {
      kind: "not_found";
      message: string;
    };

export type CancelTrainingPeaksActionExecutionInput = {
  actionId: string;
  cancelledByChatId: string;
  cancelledByUserId?: string | null;
  cancelMessageId?: string | null;
};

export type CancelTrainingPeaksActionExecutionResult =
  | {
      kind: "cancelled";
      action: TrainingPeaksAction;
    }
  | {
      kind: "already_cancelled";
      action: TrainingPeaksAction;
    }
  | {
      kind: "final_state";
      action: TrainingPeaksAction;
    }
  | {
      kind: "not_found";
    };

export type TrainingPeaksBusinessChat = {
  id: string;
  businessConnectionId: string;
  chatId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  lastText: string | null;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
};

type TrainingPeaksBusinessChatRow = {
  id: string;
  business_connection_id: string;
  chat_id: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  last_text: string | null;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
};

export type UpsertTrainingPeaksBusinessChatInput = {
  businessConnectionId: string;
  chatId: string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  lastText?: string | null;
  lastSeenAt?: string;
};

export type TrainingPeaksWorkoutCacheRow = {
  id: string;
  studentId: string;
  studentName: string;
  trainingPeaksAthleteId: number;
  trainingPeaksWorkoutId: number;
  workoutDate: string;
  title: string | null;
  sportOrTypeCode: string | null;
  workoutTypeValueId: number | null;
  workoutSubTypeId: number | null;
  isPlanned: boolean;
  isCompleted: boolean;
  plannedTimeRaw: number | string | null;
  completedTimeRaw: number | string | null;
  plannedDistanceRaw: number | string | null;
  completedDistanceRaw: number | string | null;
  complianceDurationPercent: number | string | null;
  complianceDistancePercent: number | string | null;
  startTimePlanned: string | null;
  startTime: string | null;
  sourceUpdatedAt: string | null;
  orderOnDay: number | string | null;
  scannedAt: string;
  scanJobId: string | null;
  normalizationWarnings: string[];
  sourceSnapshot: unknown;
  createdAt: string;
  updatedAt: string;
};

type TrainingPeaksWorkoutCacheDbRow = {
  id: string;
  student_id: string;
  student_name: string;
  trainingpeaks_athlete_id: number;
  trainingpeaks_workout_id: number;
  workout_date: string;
  title: string | null;
  sport_or_type_code: string | null;
  workout_type_value_id: number | null;
  workout_sub_type_id: number | null;
  is_planned: boolean;
  is_completed: boolean;
  planned_time_raw: number | string | null;
  completed_time_raw: number | string | null;
  planned_distance_raw: number | string | null;
  completed_distance_raw: number | string | null;
  compliance_duration_percent: number | string | null;
  compliance_distance_percent: number | string | null;
  start_time_planned: string | null;
  start_time: string | null;
  source_updated_at: string | null;
  order_on_day: number | string | null;
  scanned_at: string;
  scan_job_id: string | null;
  normalization_warnings: string[];
  source_snapshot: unknown;
  created_at: string;
  updated_at: string;
};

export type TrainingPeaksWorkoutCacheUpsertRow = {
  student_id: string;
  student_name: string;
  trainingpeaks_athlete_id: number;
  trainingpeaks_workout_id: number;
  workout_date: string;
  title?: string | null;
  sport_or_type_code?: string | null;
  workout_type_value_id?: number | null;
  workout_sub_type_id?: number | null;
  is_planned: boolean;
  is_completed: boolean;
  planned_time_raw?: number | string | null;
  completed_time_raw?: number | string | null;
  planned_distance_raw?: number | string | null;
  completed_distance_raw?: number | string | null;
  compliance_duration_percent?: number | string | null;
  compliance_distance_percent?: number | string | null;
  start_time_planned?: string | null;
  start_time?: string | null;
  source_updated_at?: string | null;
  order_on_day?: number | string | null;
  scanned_at?: string;
  scan_job_id?: string | null;
  normalization_warnings?: string[];
  source_snapshot?: unknown;
};

export type TrainingPeaksWorkoutCacheScanStatus = {
  id: string;
  studentId: string;
  studentName: string;
  trainingPeaksAthleteId: number | null;
  scanFrom: string;
  scanTo: string;
  status: "ok" | "failed" | "skipped";
  rawItemsCount: number;
  normalizedItemsCount: number;
  upsertedRowsCount: number;
  plannedCount: number;
  completedCount: number;
  plannedNotCompletedCount: number;
  warningsCount: number;
  errorMessage: string | null;
  scannedAt: string;
  createdAt: string;
  updatedAt: string;
};

type TrainingPeaksWorkoutCacheScanStatusDbRow = {
  id: string;
  student_id: string;
  student_name: string;
  trainingpeaks_athlete_id: number | null;
  scan_from: string;
  scan_to: string;
  status: "ok" | "failed" | "skipped";
  raw_items_count: number;
  normalized_items_count: number;
  upserted_rows_count: number;
  planned_count: number;
  completed_count: number;
  planned_not_completed_count: number;
  warnings_count: number;
  error_message: string | null;
  scanned_at: string;
  created_at: string;
  updated_at: string;
};

export type TrainingPeaksWorkoutCacheScanStatusUpsertRow = {
  student_id: string;
  student_name: string;
  trainingpeaks_athlete_id: number | null;
  scan_from: string;
  scan_to: string;
  status: "ok" | "failed" | "skipped";
  raw_items_count?: number;
  normalized_items_count?: number;
  upserted_rows_count?: number;
  planned_count?: number;
  completed_count?: number;
  planned_not_completed_count?: number;
  warnings_count?: number;
  error_message?: string | null;
  scanned_at?: string;
};

export type TrainingPeaksHealthMetricCacheRow = {
  id: string;
  studentId: string;
  studentName: string;
  trainingPeaksAthleteId: number;
  metricTimestamp: string;
  metricDate: string;
  metricTypeId: number;
  metricKey: string;
  metricLabel: string | null;
  rawValueText: string | null;
  valueNumeric: number | null;
  valueMinNumeric: number | null;
  valueMaxNumeric: number | null;
  valueAvgNumeric: number | null;
  unit: string | null;
  uploadClient: string | null;
  sourceSnapshot: unknown;
  normalizationWarnings: string[];
  scannedAt: string;
  scanJobId: string | null;
  createdAt: string;
  updatedAt: string;
};

type TrainingPeaksHealthMetricCacheDbRow = {
  id: string;
  student_id: string;
  student_name: string;
  trainingpeaks_athlete_id: number;
  metric_timestamp: string;
  metric_date: string;
  metric_type_id: number;
  metric_key: string;
  metric_label: string | null;
  raw_value_text: string | null;
  value_numeric: number | null;
  value_min_numeric: number | null;
  value_max_numeric: number | null;
  value_avg_numeric: number | null;
  unit: string | null;
  upload_client: string | null;
  source_snapshot: unknown;
  normalization_warnings: string[];
  scanned_at: string;
  scan_job_id: string | null;
  created_at: string;
  updated_at: string;
};

export type TrainingPeaksHealthMetricCacheUpsertRow = {
  student_id: string;
  student_name: string;
  trainingpeaks_athlete_id: number;
  metric_timestamp: string;
  metric_date: string;
  metric_type_id: number;
  metric_key: string;
  metric_label?: string | null;
  raw_value_text?: string | null;
  value_numeric?: number | null;
  value_min_numeric?: number | null;
  value_max_numeric?: number | null;
  value_avg_numeric?: number | null;
  unit?: string | null;
  upload_client?: string | null;
  source_snapshot?: unknown;
  normalization_warnings?: string[];
  scanned_at?: string;
  scan_job_id?: string | null;
};

export type TrainingPeaksHealthMetricsScanStatusUpsertRow = {
  student_id: string;
  student_name: string;
  trainingpeaks_athlete_id: number | null;
  scan_from: string;
  scan_to: string;
  status: "ok" | "failed" | "skipped";
  raw_items_count?: number;
  normalized_items_count?: number;
  upserted_rows_count?: number;
  metric_types_found?: string[];
  warnings_count?: number;
  error_message?: string | null;
  scanned_at?: string;
};

export type TrainingPeaksStudentHealthMetricProfileStatus =
  | "ready"
  | "partial"
  | "no_metrics"
  | "failed"
  | "skipped_no_athlete_id"
  | "unknown";

export type TrainingPeaksStudentHealthMetricProfile = {
  studentId: string;
  studentName: string;
  trainingPeaksAthleteId: number | null;
  status: TrainingPeaksStudentHealthMetricProfileStatus;
  recoveryMetricsEnabled: boolean;
  hasHrv: boolean;
  hasSleepHours: boolean;
  hasPulse: boolean;
  hasBodyBattery: boolean;
  hasStressLevel: boolean;
  hasWeight: boolean;
  coverage7d: unknown;
  coverage30d: unknown;
  lastCheckedAt: string;
  nextFullCheckAt: string | null;
  warnings: string[];
  sourceSnapshot: unknown;
  createdAt: string;
  updatedAt: string;
};

type TrainingPeaksStudentHealthMetricProfileDbRow = {
  student_id: string;
  student_name: string;
  trainingpeaks_athlete_id: number | null;
  status: TrainingPeaksStudentHealthMetricProfileStatus;
  recovery_metrics_enabled: boolean;
  has_hrv: boolean;
  has_sleep_hours: boolean;
  has_pulse: boolean;
  has_body_battery: boolean;
  has_stress_level: boolean;
  has_weight: boolean;
  coverage_7d: unknown;
  coverage_30d: unknown;
  last_checked_at: string;
  next_full_check_at: string | null;
  warnings: string[];
  source_snapshot: unknown;
  created_at: string;
  updated_at: string;
};

export type TrainingPeaksStudentHealthMetricProfileUpsertRow = {
  student_id: string;
  student_name: string;
  trainingpeaks_athlete_id?: number | null;
  status: TrainingPeaksStudentHealthMetricProfileStatus;
  recovery_metrics_enabled: boolean;
  has_hrv?: boolean;
  has_sleep_hours?: boolean;
  has_pulse?: boolean;
  has_body_battery?: boolean;
  has_stress_level?: boolean;
  has_weight?: boolean;
  coverage_7d?: unknown;
  coverage_30d?: unknown;
  last_checked_at?: string;
  next_full_check_at?: string | null;
  warnings?: string[];
  source_snapshot?: unknown;
};

export type ListTrainingPeaksStudentHealthMetricProfilesInput = {
  studentId?: string;
  statuses?: TrainingPeaksStudentHealthMetricProfileStatus[];
  recoveryMetricsEnabled?: boolean;
  dueForFullCheckBeforeOrAt?: string;
  limit?: number;
};

export type TrainingPeaksStudentTelegramLinkCodeStatus = "active" | "used" | "expired";

export type TrainingPeaksStudentTelegramLinkCode = {
  id: string;
  studentId: string;
  code: string;
  status: TrainingPeaksStudentTelegramLinkCodeStatus;
  expiresAt: string;
  usedAt: string | null;
  businessConnectionId: string | null;
  chatId: string | null;
  createdAt: string;
};

type TrainingPeaksStudentTelegramLinkCodeRow = {
  id: string;
  student_id: string;
  code: string;
  status: TrainingPeaksStudentTelegramLinkCodeStatus;
  expires_at: string;
  used_at: string | null;
  business_connection_id: string | null;
  chat_id: string | null;
  created_at: string;
};

export type InsertTrainingPeaksStudentTelegramLinkCodeInput = {
  studentId: string;
  code: string;
  status?: TrainingPeaksStudentTelegramLinkCodeStatus;
  expiresAt: string;
};

export class TrainingPeaksTelegramLinkCodeConflictError extends Error {
  readonly codeValue: string;

  constructor(codeValue: string) {
    super(`TrainingPeaks Telegram link code already exists: ${codeValue}`);
    this.name = "TrainingPeaksTelegramLinkCodeConflictError";
    this.codeValue = codeValue;
  }
}

export const TRAININGPEAKS_JOB_CANCELLED_ERROR_MESSAGE =
  "Cancelled from Telegram before Mac runner start";

export class TrainingPeaksJobConflictError extends Error {
  constructor() {
    super("TrainingPeaks weekly job already queued or running for this week");
    this.name = "TrainingPeaksJobConflictError";
  }
}

function mapTrainingPeaksStudentRow(row: TrainingPeaksStudentRow): TrainingPeaksStudent {
  return {
    id: row.id,
    studentId: row.student_id,
    studentName: row.student_name,
    trainingPeaksAthleteUrl: row.trainingpeaks_athlete_url,
    isActive: row.is_active,
    weeklyReportEnabled: row.weekly_report_enabled,
    archivedAt: row.archived_at,
    telegramChatId: row.telegram_chat_id,
    telegramUsername: row.telegram_username,
    telegramProfileUrl: row.telegram_profile_url,
    telegramDeliveryEnabled: row.telegram_delivery_enabled,
    telegramFormality: normalizeTrainingPeaksTelegramFormality(row.telegram_formality),
    telegramContextNotes: row.telegram_context_notes,
    dataQualityStatus: row.data_quality_status,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeTrainingPeaksTelegramFormality(
  value: string | null | undefined
): TrainingPeaksTelegramFormality {
  if (value === "ty" || value === "vy") {
    return value;
  }

  return "unknown";
}

function mapTrainingPeaksStudentThreadRow(
  row: TrainingPeaksStudentThreadRow
): TrainingPeaksStudentThread {
  return {
    id: row.id,
    studentId: row.student_id,
    telegramChatId: row.telegram_chat_id,
    telegramMessageThreadId: row.telegram_message_thread_id,
    chatTitle: row.chat_title,
    threadTitle: row.thread_title,
    linkedByUserId: row.linked_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTrainingPeaksWeeklyReportRow(
  row: TrainingPeaksWeeklyReportRow
): TrainingPeaksWeeklyReport {
  return {
    id: row.id,
    studentId: row.student_id,
    studentName: row.student_name,
    weekFrom: row.week_from,
    weekTo: row.week_to,
    status: row.status,
    reportMarkdown: row.report_markdown,
    editedReportMarkdown: row.edited_report_markdown,
    editedAt: row.edited_at,
    summaryJson: row.summary_json,
    warnings: row.warnings,
    coachNotesJson: row.coach_notes_json,
    syncedAt: row.synced_at,
    reviewStatus: row.review_status,
    approvedAt: row.approved_at,
    sentAt: row.sent_at,
    sentToChatId: row.sent_to_chat_id,
    deliveryError: row.delivery_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTrainingPeaksWeekRow(row: TrainingPeaksWeekRow): TrainingPeaksWeek {
  return {
    weekFrom: row.week_from,
    weekTo: row.week_to,
  };
}

function mapTrainingPeaksJobRow(row: TrainingPeaksJobRow): TrainingPeaksJob {
  return {
    id: row.id,
    jobType: row.job_type,
    scope: row.scope ?? "all_enabled",
    studentId: row.student_id,
    status: row.status,
    weekFrom: row.week_from,
    weekTo: row.week_to,
    requestJson: row.request_json ?? null,
    requestedByChatId: row.requested_by_chat_id,
    requestedByUserId: row.requested_by_user_id,
    resultJson: row.result_json,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    updatedAt: row.updated_at,
  };
}

function mapTrainingPeaksStudentContactEventRow(
  row: TrainingPeaksStudentContactEventRow
): TrainingPeaksStudentContactEvent {
  return {
    id: row.id,
    studentId: row.student_id,
    eventType: row.event_type as TrainingPeaksStudentContactEventType,
    source: row.source as TrainingPeaksStudentContactEventSource,
    occurredAt: row.occurred_at,
    referenceId: row.reference_id,
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {},
    createdAt: row.created_at,
  };
}

function mapTrainingPeaksStudentContactStatusRow(
  row: TrainingPeaksStudentContactStatusRow
): TrainingPeaksStudentContactStatus {
  return {
    studentId: row.student_id,
    lastAthleteMessageAt: row.last_athlete_message_at,
    lastCoachTouchAt: row.last_coach_touch_at,
    lastContactEventAt: row.last_contact_event_at,
    silenceDays: row.silence_days,
    unansweredSince: row.unanswered_since,
    unansweredSeconds: row.unanswered_seconds,
  };
}

function mapTrainingPeaksActionRow(row: TrainingPeaksActionRow): TrainingPeaksAction {
  return {
    id: row.id,
    studentId: row.student_id,
    actionType: row.action_type,
    status: row.status,
    sourceChatId: row.source_chat_id,
    sourceMessageId: row.source_message_id,
    sourceUserId: row.source_user_id,
    rawText: row.raw_text,
    parsedPayload: row.parsed_payload,
    confidence: row.confidence,
    coachChatId: row.coach_chat_id,
    approvedAt: row.approved_at,
    rejectedAt: row.rejected_at,
    decidedByChatId: row.decided_by_chat_id,
    decidedByUserId: row.decided_by_user_id,
    decisionMessageId: row.decision_message_id,
    executionStatus: row.execution_status,
    executionMode: row.execution_mode,
    claimedBy: row.claimed_by,
    claimedAt: row.claimed_at,
    lastRunId: row.last_run_id,
    executionRequestedAt: row.execution_requested_at,
    executionRequestedByChatId: row.execution_requested_by_chat_id,
    executionRequestedByUserId: row.execution_requested_by_user_id,
    executionRequestMessageId: row.execution_request_message_id,
    cancelledAt: row.cancelled_at,
    cancelledByChatId: row.cancelled_by_chat_id,
    cancelledByUserId: row.cancelled_by_user_id,
    cancelMessageId: row.cancel_message_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getTrainingPeaksActionById(actionId: string): Promise<TrainingPeaksAction | null> {
  return getTrainingPeaksActionByIdInternal(actionId);
}

async function getTrainingPeaksActionByIdInternal(actionId: string): Promise<TrainingPeaksAction | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_actions")
    .select("*")
    .eq("id", actionId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get TrainingPeaks action ${actionId}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksActionRow(data as TrainingPeaksActionRow);
}

function mapTrainingPeaksActionRunRow(row: TrainingPeaksActionRunRow): TrainingPeaksActionRun {
  return {
    id: row.id,
    actionId: row.action_id,
    runType: row.run_type,
    status: row.status,
    dryRun: row.dry_run,
    runnerId: row.runner_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorMessage: row.error_message,
    logJson: row.log_json,
    screenshotBeforePath: row.screenshot_before_path,
    screenshotAfterPath: row.screenshot_after_path,
    createdAt: row.created_at,
  };
}

function trimOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function toBooleanOrNull(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  return null;
}

function extractFirstReason(logJson: unknown): string | null {
  if (!logJson || typeof logJson !== "object") {
    return null;
  }
  const payload = logJson as {
    error?: unknown;
    note?: unknown;
    failureReason?: unknown;
    blockedReason?: unknown;
    reason?: unknown;
    canExecuteReasons?: unknown;
    mismatchReasons?: unknown;
    revalidationComparison?: { mismatchReasons?: unknown } | null;
  };
  const direct =
    trimOrNull(payload.failureReason) ??
    trimOrNull(payload.blockedReason) ??
    trimOrNull(payload.error) ??
    trimOrNull(payload.reason);
  if (direct) {
    return direct;
  }
  if (Array.isArray(payload.canExecuteReasons)) {
    for (const item of payload.canExecuteReasons) {
      const candidate = trimOrNull(item);
      if (candidate) {
        return candidate;
      }
    }
  }
  if (Array.isArray(payload.mismatchReasons)) {
    for (const item of payload.mismatchReasons) {
      const candidate = trimOrNull(item);
      if (candidate) {
        return candidate;
      }
    }
  }
  if (Array.isArray(payload.revalidationComparison?.mismatchReasons)) {
    for (const item of payload.revalidationComparison?.mismatchReasons ?? []) {
      const candidate = trimOrNull(item);
      if (candidate) {
        return candidate;
      }
    }
  }
  const note = trimOrNull(payload.note);
  if (note && !/not changed|не изменен|не изменён/i.test(note)) {
    return note;
  }
  return null;
}

function mapActionRunContextSummary(row: TrainingPeaksActionRunRow): TrainingPeaksActionRunContextSummary {
  const log = row.log_json;
  const payload = (log && typeof log === "object" ? log : null) as
    | {
        dryRunResult?: unknown;
        canExecute?: unknown;
        selectedSourceDate?: unknown;
        selectedSourceDatePolicy?: unknown;
        canExecuteReasons?: unknown;
        resolvedDates?: { sourceDate?: unknown } | null;
      }
    | null;
  const selectedSourceDate = trimOrNull(payload?.selectedSourceDate) ?? trimOrNull(payload?.resolvedDates?.sourceDate);
  const selectedSourceDatePolicy = trimOrNull(payload?.selectedSourceDatePolicy);
  const canExecute = toBooleanOrNull(payload?.canExecute);
  const failureReason = extractFirstReason(log) ?? row.error_message;
  const hasInferenceBlockReason =
    Array.isArray(payload?.canExecuteReasons) &&
    (payload!.canExecuteReasons as unknown[]).some((item) => trimOrNull(item) === INFERRED_MOVE_SOURCE_EXECUTION_BLOCK_REASON);
  const blockedReason =
    hasInferenceBlockReason || failureReason === INFERRED_MOVE_SOURCE_EXECUTION_BLOCK_REASON
      ? INFERRED_MOVE_SOURCE_EXECUTION_BLOCK_MESSAGE_RU
      : canExecute === false
        ? failureReason
        : null;
  return {
    runId: row.id,
    runType: row.run_type,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorMessage: row.error_message,
    dryRunResult: trimOrNull(payload?.dryRunResult),
    canExecute,
    selectedSourceDate,
    selectedSourceDatePolicy,
    failureReason,
    blockedReason,
    logJson: row.log_json,
  };
}

function mapTrainingPeaksBusinessChatRow(
  row: TrainingPeaksBusinessChatRow
): TrainingPeaksBusinessChat {
  return {
    id: row.id,
    businessConnectionId: row.business_connection_id,
    chatId: row.chat_id,
    username: row.username,
    firstName: row.first_name,
    lastName: row.last_name,
    lastText: row.last_text,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTrainingPeaksStudentTelegramLinkCodeRow(
  row: TrainingPeaksStudentTelegramLinkCodeRow
): TrainingPeaksStudentTelegramLinkCode {
  return {
    id: row.id,
    studentId: row.student_id,
    code: row.code,
    status: row.status,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    businessConnectionId: row.business_connection_id,
    chatId: row.chat_id,
    createdAt: row.created_at,
  };
}

function mapTrainingPeaksWorkoutCacheRow(
  row: TrainingPeaksWorkoutCacheDbRow
): TrainingPeaksWorkoutCacheRow {
  return {
    id: row.id,
    studentId: row.student_id,
    studentName: row.student_name,
    trainingPeaksAthleteId: row.trainingpeaks_athlete_id,
    trainingPeaksWorkoutId: row.trainingpeaks_workout_id,
    workoutDate: row.workout_date,
    title: row.title,
    sportOrTypeCode: row.sport_or_type_code,
    workoutTypeValueId: row.workout_type_value_id,
    workoutSubTypeId: row.workout_sub_type_id,
    isPlanned: row.is_planned,
    isCompleted: row.is_completed,
    plannedTimeRaw: row.planned_time_raw,
    completedTimeRaw: row.completed_time_raw,
    plannedDistanceRaw: row.planned_distance_raw,
    completedDistanceRaw: row.completed_distance_raw,
    complianceDurationPercent: row.compliance_duration_percent,
    complianceDistancePercent: row.compliance_distance_percent,
    startTimePlanned: row.start_time_planned,
    startTime: row.start_time,
    sourceUpdatedAt: row.source_updated_at,
    orderOnDay: row.order_on_day,
    scannedAt: row.scanned_at,
    scanJobId: row.scan_job_id,
    normalizationWarnings: row.normalization_warnings,
    sourceSnapshot: row.source_snapshot,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTrainingPeaksWorkoutCacheScanStatusRow(
  row: TrainingPeaksWorkoutCacheScanStatusDbRow
): TrainingPeaksWorkoutCacheScanStatus {
  return {
    id: row.id,
    studentId: row.student_id,
    studentName: row.student_name,
    trainingPeaksAthleteId: row.trainingpeaks_athlete_id,
    scanFrom: row.scan_from,
    scanTo: row.scan_to,
    status: row.status,
    rawItemsCount: row.raw_items_count,
    normalizedItemsCount: row.normalized_items_count,
    upsertedRowsCount: row.upserted_rows_count,
    plannedCount: row.planned_count,
    completedCount: row.completed_count,
    plannedNotCompletedCount: row.planned_not_completed_count,
    warningsCount: row.warnings_count,
    errorMessage: row.error_message,
    scannedAt: row.scanned_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTrainingPeaksHealthMetricCacheRow(
  row: TrainingPeaksHealthMetricCacheDbRow
): TrainingPeaksHealthMetricCacheRow {
  return {
    id: row.id,
    studentId: row.student_id,
    studentName: row.student_name,
    trainingPeaksAthleteId: row.trainingpeaks_athlete_id,
    metricTimestamp: row.metric_timestamp,
    metricDate: row.metric_date,
    metricTypeId: row.metric_type_id,
    metricKey: row.metric_key,
    metricLabel: row.metric_label,
    rawValueText: row.raw_value_text,
    valueNumeric: row.value_numeric,
    valueMinNumeric: row.value_min_numeric,
    valueMaxNumeric: row.value_max_numeric,
    valueAvgNumeric: row.value_avg_numeric,
    unit: row.unit,
    uploadClient: row.upload_client,
    sourceSnapshot: row.source_snapshot,
    normalizationWarnings: row.normalization_warnings,
    scannedAt: row.scanned_at,
    scanJobId: row.scan_job_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTrainingPeaksStudentHealthMetricProfileRow(
  row: TrainingPeaksStudentHealthMetricProfileDbRow
): TrainingPeaksStudentHealthMetricProfile {
  return {
    studentId: row.student_id,
    studentName: row.student_name,
    trainingPeaksAthleteId: row.trainingpeaks_athlete_id,
    status: row.status,
    recoveryMetricsEnabled: row.recovery_metrics_enabled,
    hasHrv: row.has_hrv,
    hasSleepHours: row.has_sleep_hours,
    hasPulse: row.has_pulse,
    hasBodyBattery: row.has_body_battery,
    hasStressLevel: row.has_stress_level,
    hasWeight: row.has_weight,
    coverage7d: row.coverage_7d,
    coverage30d: row.coverage_30d,
    lastCheckedAt: row.last_checked_at,
    nextFullCheckAt: row.next_full_check_at,
    warnings: row.warnings,
    sourceSnapshot: row.source_snapshot,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function pickDefinedValues<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  ) as Partial<T>;
}

function getTrainingPeaksStudentConflictReason(error: {
  code?: string | null;
  constraint?: string | null;
  message?: string | null;
  details?: string | null;
}): "student_id" | "trainingpeaks_athlete_url" | null {
  if (error.code !== "23505") {
    return null;
  }

  const haystack = `${error.constraint ?? ""} ${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();

  if (haystack.includes("trainingpeaks_athlete_url")) {
    return "trainingpeaks_athlete_url";
  }

  if (haystack.includes("student_id")) {
    return "student_id";
  }

  return "student_id";
}

function isTrainingPeaksJobConflict(error: {
  code?: string | null;
  constraint?: string | null;
  message?: string | null;
  details?: string | null;
}): boolean {
  if (error.code !== "23505") {
    return false;
  }

  const haystack = `${error.constraint ?? ""} ${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  return (
    haystack.includes("trainingpeaks_jobs_active_week_idx") ||
    haystack.includes("trainingpeaks_jobs_active_all_enabled_week_idx") ||
    haystack.includes("trainingpeaks_jobs_active_single_student_week_idx") ||
    haystack.includes("trainingpeaks_jobs_active_race_scan_range_idx") ||
    haystack.includes("trainingpeaks_jobs_active_race_results_probe_student_idx")
  );
}

function isTrainingPeaksTelegramLinkCodeConflict(error: {
  code?: string | null;
  constraint?: string | null;
  message?: string | null;
  details?: string | null;
}): boolean {
  if (error.code !== "23505") {
    return false;
  }

  const haystack = `${error.constraint ?? ""} ${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  return haystack.includes("trainingpeaks_student_telegram_link_codes_active_code_idx");
}

export async function insertTrainingPeaksStudent(
  input: InsertTrainingPeaksStudentInput
): Promise<TrainingPeaksStudent> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .insert({
      student_id: input.studentId,
      student_name: input.studentName,
      trainingpeaks_athlete_url: input.trainingPeaksAthleteUrl,
      is_active: input.isActive ?? true,
      weekly_report_enabled: input.weeklyReportEnabled ?? true,
      telegram_chat_id: input.telegramChatId ?? null,
      telegram_username: input.telegramUsername ?? null,
      telegram_profile_url: input.telegramProfileUrl ?? null,
      telegram_delivery_enabled: input.telegramDeliveryEnabled ?? false,
      data_quality_status: input.dataQualityStatus ?? null,
      notes: input.notes ?? null,
    })
    .select("*")
    .single();

  if (error) {
    const conflictReason = getTrainingPeaksStudentConflictReason(error);

    if (conflictReason) {
      throw new TrainingPeaksStudentConflictError(conflictReason);
    }

    throw new Error(`Failed to insert TrainingPeaks student: ${error.message}`);
  }

  return mapTrainingPeaksStudentRow(data as TrainingPeaksStudentRow);
}

export async function setTrainingPeaksStudentWeeklyReportsEnabledById(
  id: string,
  enabled: boolean
): Promise<TrainingPeaksStudent | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .update({
      weekly_report_enabled: enabled,
    })
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to update weekly reports flag for TrainingPeaks student ${id}: ${error.message}`
    );
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksStudentRow(data as TrainingPeaksStudentRow);
}

export async function upsertTrainingPeaksWorkoutCacheRows(
  rows: TrainingPeaksWorkoutCacheUpsertRow[]
): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const supabase = createSupabaseServerClient();
  const updatedAt = new Date().toISOString();
  const payload = rows.map((row) => ({
    ...row,
    updated_at: updatedAt,
  }));

  const { error } = await supabase.from("trainingpeaks_workout_cache").upsert(payload, {
    onConflict: "trainingpeaks_athlete_id,trainingpeaks_workout_id",
  });

  if (error) {
    throw new Error(`Failed to upsert TrainingPeaks workout cache rows: ${error.message}`);
  }
}

export async function upsertTrainingPeaksWorkoutCacheScanStatuses(
  rows: TrainingPeaksWorkoutCacheScanStatusUpsertRow[]
): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const supabase = createSupabaseServerClient();
  const updatedAt = new Date().toISOString();
  const payload = rows.map((row) => ({
    ...row,
    updated_at: updatedAt,
  }));

  const { error } = await supabase.from("trainingpeaks_workout_cache_scan_status").upsert(payload, {
    onConflict: "student_id,scan_from,scan_to",
  });

  if (error) {
    throw new Error(`Failed to upsert TrainingPeaks workout cache scan statuses: ${error.message}`);
  }
}

export async function upsertTrainingPeaksStudentHealthMetricProfiles(
  rows: TrainingPeaksStudentHealthMetricProfileUpsertRow[]
): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const supabase = createSupabaseServerClient();
  const nowIso = new Date().toISOString();
  const payload = rows.map((row) => ({
    ...row,
    updated_at: nowIso,
  }));

  const { error } = await supabase
    .from("trainingpeaks_student_health_metric_profiles")
    .upsert(payload, { onConflict: "student_id" });

  if (error) {
    throw new Error(`Failed to upsert TrainingPeaks health metric profiles: ${error.message}`);
  }
}

export async function upsertTrainingPeaksHealthMetricsCacheRows(
  rows: TrainingPeaksHealthMetricCacheUpsertRow[]
): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const supabase = createSupabaseServerClient();
  const updatedAt = new Date().toISOString();
  const payload = rows.map((row) => ({
    ...row,
    updated_at: updatedAt,
  }));

  const { error } = await supabase.from("trainingpeaks_health_metrics_cache").upsert(payload, {
    onConflict: "student_id,metric_timestamp,metric_type_id,metric_key",
  });

  if (error) {
    throw new Error(`Failed to upsert TrainingPeaks health metrics cache rows: ${error.message}`);
  }
}

export async function upsertTrainingPeaksHealthMetricsScanStatuses(
  rows: TrainingPeaksHealthMetricsScanStatusUpsertRow[]
): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const supabase = createSupabaseServerClient();
  const updatedAt = new Date().toISOString();
  const payload = rows.map((row) => ({
    ...row,
    updated_at: updatedAt,
  }));

  const { error } = await supabase.from("trainingpeaks_health_metrics_scan_status").upsert(payload, {
    onConflict: "student_id,scan_from,scan_to",
  });

  if (error) {
    throw new Error(`Failed to upsert TrainingPeaks health metrics scan statuses: ${error.message}`);
  }
}

export async function listTrainingPeaksWorkoutCacheForDate(
  date: string
): Promise<TrainingPeaksWorkoutCacheRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_workout_cache")
    .select("*")
    .eq("workout_date", date)
    .order("student_name", { ascending: true })
    .order("trainingpeaks_workout_id", { ascending: true });

  if (error) {
    throw new Error(`Failed to list TrainingPeaks workout cache for date ${date}: ${error.message}`);
  }

  return ((data as TrainingPeaksWorkoutCacheDbRow[]) ?? []).map(mapTrainingPeaksWorkoutCacheRow);
}

export async function listTrainingPeaksWorkoutCacheForDateRange(input: {
  from: string;
  to: string;
  studentId?: string;
}): Promise<TrainingPeaksWorkoutCacheRow[]> {
  const supabase = createSupabaseServerClient();
  let query = supabase
    .from("trainingpeaks_workout_cache")
    .select("*")
    .gte("workout_date", input.from)
    .lte("workout_date", input.to)
    .order("student_name", { ascending: true })
    .order("workout_date", { ascending: true })
    .order("trainingpeaks_workout_id", { ascending: true });

  if (input.studentId) {
    query = query.eq("student_id", input.studentId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(
      `Failed to list TrainingPeaks workout cache for range ${input.from}..${input.to}: ${error.message}`
    );
  }

  return ((data as TrainingPeaksWorkoutCacheDbRow[]) ?? []).map(mapTrainingPeaksWorkoutCacheRow);
}

export async function listTrainingPeaksWorkoutCacheScanStatusesForRange(input: {
  from: string;
  to: string;
}): Promise<TrainingPeaksWorkoutCacheScanStatus[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_workout_cache_scan_status")
    .select("*")
    .eq("scan_from", input.from)
    .eq("scan_to", input.to)
    .order("student_name", { ascending: true })
    .order("scanned_at", { ascending: false });

  if (error) {
    throw new Error(
      `Failed to list TrainingPeaks workout cache scan statuses for range ${input.from}..${input.to}: ${error.message}`
    );
  }

  return ((data as TrainingPeaksWorkoutCacheScanStatusDbRow[]) ?? []).map(
    mapTrainingPeaksWorkoutCacheScanStatusRow
  );
}

export async function listTrainingPeaksStudentHealthMetricProfiles(
  input: ListTrainingPeaksStudentHealthMetricProfilesInput = {}
): Promise<TrainingPeaksStudentHealthMetricProfile[]> {
  const supabase = createSupabaseServerClient();
  let query = supabase
    .from("trainingpeaks_student_health_metric_profiles")
    .select("*")
    .order("student_name", { ascending: true });

  if (input.studentId) {
    query = query.eq("student_id", input.studentId);
  }
  if (input.statuses && input.statuses.length > 0) {
    query = query.in("status", input.statuses);
  }
  if (input.recoveryMetricsEnabled !== undefined) {
    query = query.eq("recovery_metrics_enabled", input.recoveryMetricsEnabled);
  }
  if (input.dueForFullCheckBeforeOrAt) {
    query = query.or(
      `next_full_check_at.is.null,next_full_check_at.lte.${input.dueForFullCheckBeforeOrAt}`
    );
  }
  if (input.limit && input.limit > 0) {
    query = query.limit(input.limit);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to list TrainingPeaks health metric profiles: ${error.message}`);
  }

  return ((data as TrainingPeaksStudentHealthMetricProfileDbRow[]) ?? []).map(
    mapTrainingPeaksStudentHealthMetricProfileRow
  );
}

export async function listTrainingPeaksStudentsEligibleForHealthMetrics(input?: {
  dueForFullCheckBeforeOrAt?: string;
  limit?: number;
}): Promise<TrainingPeaksStudentHealthMetricProfile[]> {
  return listTrainingPeaksStudentHealthMetricProfiles({
    statuses: ["ready", "partial"],
    recoveryMetricsEnabled: true,
    dueForFullCheckBeforeOrAt: input?.dueForFullCheckBeforeOrAt,
    limit: input?.limit,
  });
}

export async function listTrainingPeaksWorkoutCacheForStudentDateRange(input: {
  studentId: string;
  from: string;
  to: string;
}): Promise<TrainingPeaksWorkoutCacheRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_workout_cache")
    .select("*")
    .eq("student_id", input.studentId)
    .gte("workout_date", input.from)
    .lte("workout_date", input.to)
    .order("workout_date", { ascending: true })
    .order("trainingpeaks_workout_id", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to list TrainingPeaks workout cache for student ${input.studentId} and range ${input.from}..${input.to}: ${error.message}`
    );
  }

  return ((data as TrainingPeaksWorkoutCacheDbRow[]) ?? []).map(mapTrainingPeaksWorkoutCacheRow);
}

export async function getTrainingPeaksWorkoutCacheFreshness(input?: {
  date?: string;
}): Promise<{ latestScannedAt: string | null; rowCount: number }> {
  const supabase = createSupabaseServerClient();

  const latestQuery = input?.date
    ? supabase
        .from("trainingpeaks_workout_cache")
        .select("scanned_at")
        .eq("workout_date", input.date)
        .order("scanned_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : supabase
        .from("trainingpeaks_workout_cache")
        .select("scanned_at")
        .order("scanned_at", { ascending: false })
        .limit(1)
        .maybeSingle();

  const countQuery = input?.date
    ? supabase
        .from("trainingpeaks_workout_cache")
        .select("id", { count: "exact", head: true })
        .eq("workout_date", input.date)
    : supabase.from("trainingpeaks_workout_cache").select("id", { count: "exact", head: true });

  const [{ data: latestRow, error: latestError }, { count, error: countError }] = await Promise.all([
    latestQuery,
    countQuery,
  ]);

  if (latestError) {
    throw new Error(`Failed to get TrainingPeaks workout cache freshness: ${latestError.message}`);
  }

  if (countError) {
    throw new Error(`Failed to count TrainingPeaks workout cache rows: ${countError.message}`);
  }

  return {
    latestScannedAt: (latestRow as { scanned_at: string } | null)?.scanned_at ?? null,
    rowCount: count ?? 0,
  };
}

export async function listTrainingPeaksHealthMetricsForStudentDateRange(input: {
  studentId: string;
  from: string;
  to: string;
  metricKey?: string;
}): Promise<TrainingPeaksHealthMetricCacheRow[]> {
  const supabase = createSupabaseServerClient();
  let query = supabase
    .from("trainingpeaks_health_metrics_cache")
    .select("*")
    .eq("student_id", input.studentId)
    .gte("metric_date", input.from)
    .lte("metric_date", input.to)
    .order("metric_date", { ascending: true })
    .order("metric_timestamp", { ascending: true })
    .order("metric_type_id", { ascending: true });

  if (input.metricKey) {
    query = query.eq("metric_key", input.metricKey);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(
      `Failed to list TrainingPeaks health metrics cache for student ${input.studentId} and range ${input.from}..${input.to}: ${error.message}`
    );
  }

  return ((data as TrainingPeaksHealthMetricCacheDbRow[]) ?? []).map(mapTrainingPeaksHealthMetricCacheRow);
}

export async function getTrainingPeaksHealthMetricsFreshness(input?: {
  date?: string;
  studentId?: string;
}): Promise<{ latestScannedAt: string | null; rowCount: number }> {
  const supabase = createSupabaseServerClient();
  let latestQuery;
  let countQuery;
  if (input?.date && input?.studentId) {
    latestQuery = supabase
      .from("trainingpeaks_health_metrics_cache")
      .select("scanned_at")
      .eq("metric_date", input.date)
      .eq("student_id", input.studentId)
      .order("scanned_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    countQuery = supabase
      .from("trainingpeaks_health_metrics_cache")
      .select("id", { count: "exact", head: true })
      .eq("metric_date", input.date)
      .eq("student_id", input.studentId);
  } else if (input?.date) {
    latestQuery = supabase
      .from("trainingpeaks_health_metrics_cache")
      .select("scanned_at")
      .eq("metric_date", input.date)
      .order("scanned_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    countQuery = supabase
      .from("trainingpeaks_health_metrics_cache")
      .select("id", { count: "exact", head: true })
      .eq("metric_date", input.date);
  } else if (input?.studentId) {
    latestQuery = supabase
      .from("trainingpeaks_health_metrics_cache")
      .select("scanned_at")
      .eq("student_id", input.studentId)
      .order("scanned_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    countQuery = supabase
      .from("trainingpeaks_health_metrics_cache")
      .select("id", { count: "exact", head: true })
      .eq("student_id", input.studentId);
  } else {
    latestQuery = supabase
      .from("trainingpeaks_health_metrics_cache")
      .select("scanned_at")
      .order("scanned_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    countQuery = supabase
      .from("trainingpeaks_health_metrics_cache")
      .select("id", { count: "exact", head: true });
  }

  const [{ data: latestRow, error: latestError }, { count, error: countError }] = await Promise.all([
    latestQuery,
    countQuery,
  ]);

  if (latestError) {
    throw new Error(`Failed to get TrainingPeaks health metrics cache freshness: ${latestError.message}`);
  }
  if (countError) {
    throw new Error(`Failed to count TrainingPeaks health metrics cache rows: ${countError.message}`);
  }

  return {
    latestScannedAt: (latestRow as { scanned_at: string } | null)?.scanned_at ?? null,
    rowCount: count ?? 0,
  };
}

export async function listTrainingPeaksStudents(): Promise<TrainingPeaksStudent[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .select("*")
    .eq("is_active", true)
    .order("student_name", { ascending: true })
    .order("student_id", { ascending: true });

  if (error) {
    throw new Error(`Failed to list TrainingPeaks students: ${error.message}`);
  }

  return ((data as TrainingPeaksStudentRow[]) ?? []).map(mapTrainingPeaksStudentRow);
}

/** Active students included in all_enabled weekly report jobs. */
export async function listTrainingPeaksWeeklyReportEligibleStudents(): Promise<TrainingPeaksStudent[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .select("*")
    .eq("is_active", true)
    .eq("weekly_report_enabled", true)
    .order("student_name", { ascending: true })
    .order("student_id", { ascending: true });

  if (error) {
    throw new Error(`Failed to list TrainingPeaks weekly-report eligible students: ${error.message}`);
  }

  return ((data as TrainingPeaksStudentRow[]) ?? []).map(mapTrainingPeaksStudentRow);
}

/** Active, non-archived students for race/event discovery (ignores weekly_report_enabled). */
export async function listTrainingPeaksActiveStudentsForEventScan(): Promise<TrainingPeaksStudent[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .select("*")
    .eq("is_active", true)
    .is("archived_at", null)
    .order("student_name", { ascending: true })
    .order("student_id", { ascending: true });

  if (error) {
    throw new Error(`Failed to list TrainingPeaks students for event scan: ${error.message}`);
  }

  return ((data as TrainingPeaksStudentRow[]) ?? []).map(mapTrainingPeaksStudentRow);
}

export async function listTrainingPeaksStudentsIncludingArchived(): Promise<TrainingPeaksStudent[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .select("*")
    .order("is_active", { ascending: false })
    .order("student_name", { ascending: true })
    .order("student_id", { ascending: true });

  if (error) {
    throw new Error(`Failed to list TrainingPeaks students: ${error.message}`);
  }

  return ((data as TrainingPeaksStudentRow[]) ?? []).map(mapTrainingPeaksStudentRow);
}

export async function getTrainingPeaksStudentById(id: string): Promise<TrainingPeaksStudent | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get TrainingPeaks student ${id}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksStudentRow(data as TrainingPeaksStudentRow);
}

export async function getTrainingPeaksStudentByStudentId(
  studentId: string
): Promise<TrainingPeaksStudent | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .select("*")
    .eq("student_id", studentId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get TrainingPeaks student by student_id ${studentId}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksStudentRow(data as TrainingPeaksStudentRow);
}

export async function getTrainingPeaksStudentByTelegramChatId(
  telegramChatId: string
): Promise<TrainingPeaksStudent | null> {
  const normalizedChatId = telegramChatId.trim();

  if (!normalizedChatId) {
    return null;
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .select("*")
    .eq("telegram_chat_id", normalizedChatId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to get TrainingPeaks student by telegram_chat_id ${normalizedChatId}: ${error.message}`
    );
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksStudentRow(data as TrainingPeaksStudentRow);
}

export async function listTrainingPeaksStudentsByTelegramChatId(
  telegramChatId: string
): Promise<TrainingPeaksStudent[]> {
  const normalizedChatId = telegramChatId.trim();

  if (!normalizedChatId) {
    return [];
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .select("*")
    .eq("telegram_chat_id", normalizedChatId)
    .eq("is_active", true)
    .order("student_name", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to list TrainingPeaks students by telegram_chat_id ${normalizedChatId}: ${error.message}`
    );
  }

  return ((data as TrainingPeaksStudentRow[]) ?? []).map(mapTrainingPeaksStudentRow);
}

export async function getTrainingPeaksStudentByTelegramUsername(
  username: string
): Promise<TrainingPeaksStudent | null> {
  const normalizedUsername = username.trim().replace(/^@+/, "");

  if (!normalizedUsername) {
    return null;
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .select("*")
    .ilike("telegram_username", normalizedUsername)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to get TrainingPeaks student by telegram_username ${normalizedUsername}: ${error.message}`
    );
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksStudentRow(data as TrainingPeaksStudentRow);
}

export async function listTrainingPeaksStudentsByTelegramUsername(
  username: string
): Promise<TrainingPeaksStudent[]> {
  const normalizedUsername = username.trim().replace(/^@+/, "");

  if (!normalizedUsername) {
    return [];
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .select("*")
    .ilike("telegram_username", normalizedUsername)
    .eq("is_active", true)
    .order("student_name", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to list TrainingPeaks students by telegram_username ${normalizedUsername}: ${error.message}`
    );
  }

  return ((data as TrainingPeaksStudentRow[]) ?? []).map(mapTrainingPeaksStudentRow);
}

export async function countTrainingPeaksStudentThreadsByStudentIds(
  studentIds: string[]
): Promise<Map<string, number>> {
  const normalizedIds = Array.from(new Set(studentIds.filter(Boolean)));
  const counts = new Map<string, number>();

  if (normalizedIds.length === 0) {
    return counts;
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_student_threads")
    .select("student_id")
    .in("student_id", normalizedIds);

  if (error) {
    throw new Error(`Failed to count TrainingPeaks student threads: ${error.message}`);
  }

  for (const row of (data as Array<{ student_id: string }> | null) ?? []) {
    counts.set(row.student_id, (counts.get(row.student_id) ?? 0) + 1);
  }

  return counts;
}

export async function listTrainingPeaksStudentThreads(
  studentId: string
): Promise<TrainingPeaksStudentThread[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_student_threads")
    .select("*")
    .eq("student_id", studentId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to list TrainingPeaks student threads for ${studentId}: ${error.message}`);
  }

  return ((data as TrainingPeaksStudentThreadRow[]) ?? []).map(mapTrainingPeaksStudentThreadRow);
}

export async function getTrainingPeaksStudentThreadByChatThread(
  telegramChatId: string,
  telegramMessageThreadId: number
): Promise<TrainingPeaksStudentThread | null> {
  const normalizedChatId = telegramChatId.trim();

  if (!normalizedChatId) {
    return null;
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_student_threads")
    .select("*")
    .eq("telegram_chat_id", normalizedChatId)
    .eq("telegram_message_thread_id", telegramMessageThreadId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to get TrainingPeaks student thread ${normalizedChatId}/${telegramMessageThreadId}: ${error.message}`
    );
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksStudentThreadRow(data as TrainingPeaksStudentThreadRow);
}

export async function insertTrainingPeaksStudentThread(input: {
  studentId: string;
  telegramChatId: string;
  telegramMessageThreadId: number;
  chatTitle?: string | null;
  threadTitle?: string | null;
  linkedByUserId: string;
}): Promise<TrainingPeaksStudentThread> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_student_threads")
    .insert({
      student_id: input.studentId,
      telegram_chat_id: input.telegramChatId,
      telegram_message_thread_id: input.telegramMessageThreadId,
      chat_title: input.chatTitle ?? null,
      thread_title: input.threadTitle ?? null,
      linked_by_user_id: input.linkedByUserId,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new TrainingPeaksStudentThreadConflictError();
    }
    throw new Error(`Failed to insert TrainingPeaks student thread: ${error.message}`);
  }

  return mapTrainingPeaksStudentThreadRow(data as TrainingPeaksStudentThreadRow);
}

export async function updateTrainingPeaksStudentThreadById(
  id: string,
  input: {
    chatTitle?: string | null;
    threadTitle?: string | null;
    linkedByUserId?: string;
  }
): Promise<TrainingPeaksStudentThread | null> {
  const updates = pickDefinedValues({
    chat_title: input.chatTitle,
    thread_title: input.threadTitle,
    linked_by_user_id: input.linkedByUserId,
  });

  if (Object.keys(updates).length === 0) {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("trainingpeaks_student_threads")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to get TrainingPeaks student thread ${id}: ${error.message}`);
    }

    return data ? mapTrainingPeaksStudentThreadRow(data as TrainingPeaksStudentThreadRow) : null;
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_student_threads")
    .update(updates)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update TrainingPeaks student thread ${id}: ${error.message}`);
  }

  return data ? mapTrainingPeaksStudentThreadRow(data as TrainingPeaksStudentThreadRow) : null;
}

export async function deleteTrainingPeaksStudentThreadById(
  id: string
): Promise<TrainingPeaksStudentThread | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_student_threads")
    .delete()
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to delete TrainingPeaks student thread ${id}: ${error.message}`);
  }

  return data ? mapTrainingPeaksStudentThreadRow(data as TrainingPeaksStudentThreadRow) : null;
}

export async function upsertTrainingPeaksBusinessChatFromMessage(
  input: UpsertTrainingPeaksBusinessChatInput
): Promise<TrainingPeaksBusinessChat> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_telegram_business_chats")
    .upsert(
      {
        business_connection_id: input.businessConnectionId,
        chat_id: input.chatId,
        username: input.username ?? null,
        first_name: input.firstName ?? null,
        last_name: input.lastName ?? null,
        last_text: input.lastText ?? null,
        last_seen_at: input.lastSeenAt ?? new Date().toISOString(),
      },
      {
        onConflict: "business_connection_id,chat_id",
      }
    )
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to upsert TrainingPeaks business chat: ${error.message}`);
  }

  return mapTrainingPeaksBusinessChatRow(data as TrainingPeaksBusinessChatRow);
}

export async function getTrainingPeaksBusinessChatById(
  id: string
): Promise<TrainingPeaksBusinessChat | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_telegram_business_chats")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get TrainingPeaks business chat ${id}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksBusinessChatRow(data as TrainingPeaksBusinessChatRow);
}

export async function getTrainingPeaksBusinessChatByConnectionAndChatId(
  businessConnectionId: string,
  chatId: string
): Promise<TrainingPeaksBusinessChat | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_telegram_business_chats")
    .select("*")
    .eq("business_connection_id", businessConnectionId)
    .eq("chat_id", chatId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to get TrainingPeaks business chat ${businessConnectionId}/${chatId}: ${error.message}`
    );
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksBusinessChatRow(data as TrainingPeaksBusinessChatRow);
}

export async function listRecentTrainingPeaksBusinessChats(
  limit = 10
): Promise<TrainingPeaksBusinessChat[]> {
  const supabase = createSupabaseServerClient();
  const safeLimit = Math.max(1, Math.min(limit, 50));
  const { data, error } = await supabase
    .from("trainingpeaks_telegram_business_chats")
    .select("*")
    .order("last_seen_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (error) {
    throw new Error(`Failed to list TrainingPeaks business chats: ${error.message}`);
  }

  return ((data as TrainingPeaksBusinessChatRow[]) ?? []).map(mapTrainingPeaksBusinessChatRow);
}

export async function getTrainingPeaksBusinessChatByChatId(
  chatId: string
): Promise<TrainingPeaksBusinessChat | null> {
  const normalizedChatId = chatId.trim();

  if (!normalizedChatId) {
    return null;
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_telegram_business_chats")
    .select("*")
    .eq("chat_id", normalizedChatId)
    .order("last_seen_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get TrainingPeaks business chat by chat_id ${normalizedChatId}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksBusinessChatRow(data as TrainingPeaksBusinessChatRow);
}

export async function listTrainingPeaksBusinessChatsForTelegramLinking(
  limit = 500
): Promise<TrainingPeaksBusinessChat[]> {
  const supabase = createSupabaseServerClient();
  const safeLimit = Math.max(1, Math.min(limit, 1000));
  const { data, error } = await supabase
    .from("trainingpeaks_telegram_business_chats")
    .select("*")
    .order("last_seen_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (error) {
    throw new Error(`Failed to list TrainingPeaks business chats for linking: ${error.message}`);
  }

  return ((data as TrainingPeaksBusinessChatRow[]) ?? []).map(mapTrainingPeaksBusinessChatRow);
}

export async function listTrainingPeaksBusinessChatsByUsername(
  username: string,
  limit = 10
): Promise<TrainingPeaksBusinessChat[]> {
  const normalizedUsername = username.trim().replace(/^@+/, "");

  if (!normalizedUsername) {
    return [];
  }

  const supabase = createSupabaseServerClient();
  const safeLimit = Math.max(1, Math.min(limit, 50));
  const { data, error } = await supabase
    .from("trainingpeaks_telegram_business_chats")
    .select("*")
    .ilike("username", normalizedUsername)
    .order("last_seen_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (error) {
    throw new Error(
      `Failed to list TrainingPeaks business chats by username ${normalizedUsername}: ${error.message}`
    );
  }

  return ((data as TrainingPeaksBusinessChatRow[]) ?? []).map(mapTrainingPeaksBusinessChatRow);
}

export async function expireActiveTrainingPeaksStudentTelegramLinkCodesForStudent(
  studentId: string
): Promise<number> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_student_telegram_link_codes")
    .update({
      status: "expired",
    })
    .eq("student_id", studentId)
    .eq("status", "active")
    .select("id");

  if (error) {
    throw new Error(
      `Failed to expire TrainingPeaks Telegram link codes for student ${studentId}: ${error.message}`
    );
  }

  return (data ?? []).length;
}

export async function insertTrainingPeaksStudentTelegramLinkCode(
  input: InsertTrainingPeaksStudentTelegramLinkCodeInput
): Promise<TrainingPeaksStudentTelegramLinkCode> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_student_telegram_link_codes")
    .insert({
      student_id: input.studentId,
      code: input.code,
      status: input.status ?? "active",
      expires_at: input.expiresAt,
    })
    .select("*")
    .single();

  if (error) {
    if (isTrainingPeaksTelegramLinkCodeConflict(error)) {
      throw new TrainingPeaksTelegramLinkCodeConflictError(input.code);
    }

    throw new Error(`Failed to insert TrainingPeaks Telegram link code: ${error.message}`);
  }

  return mapTrainingPeaksStudentTelegramLinkCodeRow(data as TrainingPeaksStudentTelegramLinkCodeRow);
}

export async function listTrainingPeaksStudentTelegramLinkCodesByCode(
  codes: string[]
): Promise<TrainingPeaksStudentTelegramLinkCode[]> {
  const normalizedCodes = Array.from(
    new Set(
      codes
        .map((code) => code.trim().toUpperCase())
        .filter(Boolean)
    )
  );

  if (normalizedCodes.length === 0) {
    return [];
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_student_telegram_link_codes")
    .select("*")
    .in("code", normalizedCodes)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list TrainingPeaks Telegram link codes: ${error.message}`);
  }

  return ((data as TrainingPeaksStudentTelegramLinkCodeRow[]) ?? []).map(
    mapTrainingPeaksStudentTelegramLinkCodeRow
  );
}

export async function expireTrainingPeaksStudentTelegramLinkCodesByIds(ids: string[]): Promise<number> {
  const normalizedIds = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));

  if (normalizedIds.length === 0) {
    return 0;
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_student_telegram_link_codes")
    .update({
      status: "expired",
    })
    .in("id", normalizedIds)
    .eq("status", "active")
    .select("id");

  if (error) {
    throw new Error(`Failed to expire TrainingPeaks Telegram link codes: ${error.message}`);
  }

  return (data ?? []).length;
}

export async function markTrainingPeaksStudentTelegramLinkCodeUsed(
  id: string,
  input: {
    usedAt?: string;
    businessConnectionId: string;
    chatId: string;
  }
): Promise<TrainingPeaksStudentTelegramLinkCode | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_student_telegram_link_codes")
    .update({
      status: "used",
      used_at: input.usedAt ?? new Date().toISOString(),
      business_connection_id: input.businessConnectionId,
      chat_id: input.chatId,
    })
    .eq("id", id)
    .eq("status", "active")
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to mark TrainingPeaks Telegram link code ${id} used: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksStudentTelegramLinkCodeRow(data as TrainingPeaksStudentTelegramLinkCodeRow);
}

export async function updateTrainingPeaksStudentTelegramContactById(
  id: string,
  input: UpdateTrainingPeaksStudentTelegramContactInput
): Promise<TrainingPeaksStudent> {
  const updates = pickDefinedValues({
    telegram_chat_id: input.telegramChatId,
    telegram_username: input.telegramUsername,
    telegram_profile_url: input.telegramProfileUrl,
    telegram_delivery_enabled: input.telegramDeliveryEnabled,
  });

  if (Object.keys(updates).length === 0) {
    const existingStudent = await getTrainingPeaksStudentById(id);

    if (!existingStudent) {
      throw new Error(`Failed to update TrainingPeaks student ${id}: student not found`);
    }

    return existingStudent;
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .update(updates)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update TrainingPeaks student ${id}: ${error.message}`);
  }

  if (!data) {
    throw new Error(`Failed to update TrainingPeaks student ${id}: student not found`);
  }

  return mapTrainingPeaksStudentRow(data as TrainingPeaksStudentRow);
}

export async function updateTrainingPeaksStudentTelegramContact(
  studentId: string,
  input: UpdateTrainingPeaksStudentTelegramContactParams
): Promise<TrainingPeaksStudent> {
  return updateTrainingPeaksStudentTelegramContactById(studentId, {
    telegramChatId: input.telegram_chat_id,
    telegramUsername: input.telegram_username,
    telegramProfileUrl: input.telegram_profile_url,
    telegramDeliveryEnabled: input.telegram_delivery_enabled,
  });
}

export async function unlinkTrainingPeaksStudentTelegramById(
  id: string
): Promise<TrainingPeaksStudent | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .update({
      telegram_chat_id: null,
      telegram_username: null,
      telegram_profile_url: null,
      telegram_delivery_enabled: false,
    })
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to unlink Telegram for TrainingPeaks student ${id}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksStudentRow(data as TrainingPeaksStudentRow);
}

export async function linkTrainingPeaksStudentToBusinessChat(
  studentId: string,
  chatId: string,
  businessConnectionId: string
): Promise<{ student: TrainingPeaksStudent; chat: TrainingPeaksBusinessChat } | null> {
  const [student, chat] = await Promise.all([
    getTrainingPeaksStudentById(studentId),
    getTrainingPeaksBusinessChatByConnectionAndChatId(businessConnectionId, chatId),
  ]);

  if (!student || !chat || !student.isActive) {
    return null;
  }

  const nextProfileUrl =
    chat.username?.trim()
      ? `https://t.me/${chat.username.trim()}`
      : student.telegramProfileUrl?.trim() || null;

  const updatedStudent = await updateTrainingPeaksStudentTelegramContact(studentId, {
    telegram_chat_id: chat.chatId,
    telegram_username: chat.username,
    telegram_profile_url: nextProfileUrl,
    telegram_delivery_enabled: true,
  });

  return {
    student: updatedStudent,
    chat,
  };
}

export async function disableTrainingPeaksStudentById(id: string): Promise<TrainingPeaksStudent> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .update({
      is_active: false,
      weekly_report_enabled: false,
      telegram_delivery_enabled: false,
      archived_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to disable TrainingPeaks student ${id}: ${error.message}`);
  }

  return mapTrainingPeaksStudentRow(data as TrainingPeaksStudentRow);
}

export async function enableTrainingPeaksStudentById(id: string): Promise<TrainingPeaksStudent> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .update({
      is_active: true,
      weekly_report_enabled: true,
      archived_at: null,
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to enable TrainingPeaks student ${id}: ${error.message}`);
  }

  return mapTrainingPeaksStudentRow(data as TrainingPeaksStudentRow);
}

export async function getLatestTrainingPeaksWeek(): Promise<TrainingPeaksWeek | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_weekly_reports")
    .select("week_from, week_to")
    .order("week_from", { ascending: false })
    .order("week_to", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get latest TrainingPeaks week: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksWeekRow(data as TrainingPeaksWeekRow);
}

export async function listTrainingPeaksReportsForWeek(
  weekFrom: string,
  weekTo: string
): Promise<TrainingPeaksWeeklyReport[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_weekly_reports")
    .select("*")
    .eq("week_from", weekFrom)
    .eq("week_to", weekTo)
    .order("student_name", { ascending: true })
    .order("student_id", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to list TrainingPeaks reports for ${weekFrom}..${weekTo}: ${error.message}`
    );
  }

  return ((data as TrainingPeaksWeeklyReportRow[]) ?? []).map(mapTrainingPeaksWeeklyReportRow);
}

export async function listAllTrainingPeaksReports(): Promise<TrainingPeaksWeeklyReport[]> {
  const supabase = createSupabaseServerClient();
  const pageSize = 1000;
  const reports: TrainingPeaksWeeklyReport[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("trainingpeaks_weekly_reports")
      .select("*")
      .order("week_from", { ascending: false })
      .order("week_to", { ascending: false })
      .order("synced_at", { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(`Failed to list TrainingPeaks reports: ${error.message}`);
    }

    const rows = (data as TrainingPeaksWeeklyReportRow[]) ?? [];
    reports.push(...rows.map(mapTrainingPeaksWeeklyReportRow));

    if (rows.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return reports;
}

export async function getTrainingPeaksWeeklyReportById(
  id: string
): Promise<TrainingPeaksWeeklyReport | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_weekly_reports")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get TrainingPeaks weekly report ${id}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksWeeklyReportRow(data as TrainingPeaksWeeklyReportRow);
}

export async function deleteTrainingPeaksWeeklyReportById(id: string): Promise<TrainingPeaksWeeklyReport | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_weekly_reports")
    .delete()
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to delete TrainingPeaks weekly report ${id}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksWeeklyReportRow(data as TrainingPeaksWeeklyReportRow);
}

export async function deleteTrainingPeaksOrphanReportsForWeek(
  weekFrom: string,
  weekTo: string
): Promise<number> {
  const supabase = createSupabaseServerClient();
  const [{ data: reports, error: reportsError }, { data: students, error: studentsError }] = await Promise.all([
    supabase
      .from("trainingpeaks_weekly_reports")
      .select("id, student_id")
      .eq("week_from", weekFrom)
      .eq("week_to", weekTo),
    supabase.from("trainingpeaks_students").select("student_id"),
  ]);

  if (reportsError) {
    throw new Error(
      `Failed to list TrainingPeaks reports for orphan cleanup ${weekFrom}..${weekTo}: ${reportsError.message}`
    );
  }

  if (studentsError) {
    throw new Error(`Failed to list TrainingPeaks students for orphan cleanup: ${studentsError.message}`);
  }

  const knownStudentIds = new Set(
    ((students as TrainingPeaksStudentIdRow[] | null) ?? []).map((student) => student.student_id)
  );
  const orphanReportIds = ((reports as TrainingPeaksWeeklyReportLookupRow[] | null) ?? [])
    .filter((report) => !knownStudentIds.has(report.student_id))
    .map((report) => report.id);

  if (orphanReportIds.length === 0) {
    return 0;
  }

  const { data: deletedReports, error: deleteError } = await supabase
    .from("trainingpeaks_weekly_reports")
    .delete()
    .in("id", orphanReportIds)
    .select("id");

  if (deleteError) {
    throw new Error(
      `Failed to delete orphan TrainingPeaks reports for ${weekFrom}..${weekTo}: ${deleteError.message}`
    );
  }

  return (deletedReports ?? []).length;
}

export async function updateTrainingPeaksWeeklyReportStateById(
  id: string,
  input: UpdateTrainingPeaksWeeklyReportStateInput
): Promise<TrainingPeaksWeeklyReport> {
  const updates = pickDefinedValues({
    review_status: input.reviewStatus,
    approved_at: input.approvedAt,
    sent_at: input.sentAt,
    sent_to_chat_id: input.sentToChatId,
    delivery_error: input.deliveryError,
  });

  if (Object.keys(updates).length === 0) {
    const existingReport = await getTrainingPeaksWeeklyReportById(id);

    if (!existingReport) {
      throw new Error(`Failed to update TrainingPeaks weekly report ${id}: report not found`);
    }

    return existingReport;
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_weekly_reports")
    .update(updates)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update TrainingPeaks weekly report ${id}: ${error.message}`);
  }

  if (!data) {
    throw new Error(`Failed to update TrainingPeaks weekly report ${id}: report not found`);
  }

  return mapTrainingPeaksWeeklyReportRow(data as TrainingPeaksWeeklyReportRow);
}

export async function updateTrainingPeaksWeeklyReportContentById(
  id: string,
  input: UpdateTrainingPeaksWeeklyReportContentInput
): Promise<TrainingPeaksWeeklyReport> {
  const updates = pickDefinedValues({
    edited_report_markdown: input.editedReportMarkdown,
    edited_at: input.editedAt,
  });

  if (Object.keys(updates).length === 0) {
    const existingReport = await getTrainingPeaksWeeklyReportById(id);

    if (!existingReport) {
      throw new Error(`Failed to update TrainingPeaks weekly report ${id}: report not found`);
    }

    return existingReport;
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_weekly_reports")
    .update(updates)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update TrainingPeaks weekly report ${id}: ${error.message}`);
  }

  if (!data) {
    throw new Error(`Failed to update TrainingPeaks weekly report ${id}: report not found`);
  }

  return mapTrainingPeaksWeeklyReportRow(data as TrainingPeaksWeeklyReportRow);
}

export async function updateTrainingPeaksWeeklyReportReviewState(
  reportId: string,
  input: UpdateTrainingPeaksWeeklyReportReviewStateInput
): Promise<TrainingPeaksWeeklyReport> {
  return updateTrainingPeaksWeeklyReportStateById(reportId, {
    reviewStatus: input.review_status,
    approvedAt: input.approved_at,
    sentAt: input.sent_at,
    sentToChatId: input.sent_to_chat_id,
    deliveryError: input.delivery_error,
  });
}

export async function approveTrainingPeaksWeeklyReportIfDraft(
  id: string
): Promise<TrainingPeaksWeeklyReport | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_weekly_reports")
    .update({
      review_status: "approved",
      approved_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("review_status", "draft")
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to approve TrainingPeaks weekly report ${id}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksWeeklyReportRow(data as TrainingPeaksWeeklyReportRow);
}

export async function claimTrainingPeaksWeeklyReportForSend(
  reportId: string
): Promise<TrainingPeaksWeeklyReport | null> {
  const supabase = createSupabaseServerClient();
  const nextApprovedAt = new Date().toISOString();

  for (const currentStatus of ["draft", "approved", "failed", "skipped"]) {
    const { data, error } = await supabase
      .from("trainingpeaks_weekly_reports")
      .update({
        review_status: "approved",
        approved_at: nextApprovedAt,
        delivery_error: null,
      })
      .eq("id", reportId)
      .eq("review_status", currentStatus)
      .select("*")
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to claim TrainingPeaks weekly report ${reportId}: ${error.message}`);
    }

    if (data) {
      return mapTrainingPeaksWeeklyReportRow(data as TrainingPeaksWeeklyReportRow);
    }
  }

  return null;
}

export async function createTrainingPeaksWeeklyJob(
  input: CreateTrainingPeaksWeeklyJobInput
): Promise<TrainingPeaksJob> {
  const scope = input.scope ?? "all_enabled";

  if (scope === "single_student" && !input.studentId?.trim()) {
    throw new Error("studentId is required for single_student weekly jobs.");
  }

  if (scope === "all_enabled" && input.studentId) {
    throw new Error("studentId must be omitted for all_enabled weekly jobs.");
  }

  return createTrainingPeaksJob({
    jobType: "weekly_reports",
    scope,
    studentId: scope === "single_student" ? input.studentId!.trim() : null,
    weekFrom: input.weekFrom,
    weekTo: input.weekTo,
    requestedByChatId: input.requestedByChatId ?? null,
    requestedByUserId: input.requestedByUserId ?? null,
  });
}

export async function createTrainingPeaksRaceScanJob(
  input: CreateTrainingPeaksRaceScanJobInput
): Promise<TrainingPeaksJob> {
  return createTrainingPeaksJob({
    jobType: "race_scan_events",
    weekFrom: input.fromDate,
    weekTo: input.toDate,
    requestedByChatId: input.requestedByChatId ?? null,
    requestedByUserId: input.requestedByUserId ?? null,
  });
}

export async function createTrainingPeaksRaceResultsProbeJob(
  input: CreateTrainingPeaksRaceResultsProbeJobInput
): Promise<TrainingPeaksJob> {
  return createTrainingPeaksJob({
    jobType: "race_results_probe",
    scope: "single_student",
    studentId: input.studentInternalId,
    weekFrom: input.fromDate,
    weekTo: input.toDate,
    requestJson: input.requestJson,
    requestedByChatId: input.requestedByChatId,
    requestedByUserId: input.requestedByUserId ?? null,
  });
}

async function createTrainingPeaksJob(input: {
  jobType: TrainingPeaksJobType;
  scope?: TrainingPeaksJobScope;
  studentId?: string | null;
  weekFrom: string;
  weekTo: string;
  requestJson?: TrainingPeaksRaceResultsProbeRequestJson | null;
  requestedByChatId: string | null;
  requestedByUserId: string | null;
}): Promise<TrainingPeaksJob> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_jobs")
    .insert({
      job_type: input.jobType,
      scope: input.scope ?? "all_enabled",
      student_id: input.studentId ?? null,
      status: "queued",
      week_from: input.weekFrom,
      week_to: input.weekTo,
      request_json: input.requestJson ?? null,
      requested_by_chat_id: input.requestedByChatId,
      requested_by_user_id: input.requestedByUserId,
    })
    .select("*")
    .single();

  if (error) {
    if (isTrainingPeaksJobConflict(error)) {
      throw new TrainingPeaksJobConflictError();
    }

    throw new Error(`Failed to create TrainingPeaks weekly job: ${error.message}`);
  }

  return mapTrainingPeaksJobRow(data as TrainingPeaksJobRow);
}

export async function createTrainingPeaksAction(
  input: CreateTrainingPeaksActionInput
): Promise<TrainingPeaksAction> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_actions")
    .insert({
      student_id: input.studentId ?? null,
      action_type: input.actionType ?? "move_workout",
      status: input.status ?? "pending_coach",
      execution_status: input.executionStatus ?? "not_started",
      approved_at: input.approvedAt ?? null,
      source_chat_id: input.sourceChatId,
      source_message_id: input.sourceMessageId,
      source_user_id: input.sourceUserId ?? null,
      raw_text: input.rawText,
      parsed_payload: input.parsedPayload,
      confidence: input.confidence ?? null,
      coach_chat_id: input.coachChatId ?? null,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create TrainingPeaks action: ${error.message}`);
  }

  return mapTrainingPeaksActionRow(data as TrainingPeaksActionRow);
}

export async function listRecentTrainingPeaksActions(limit = 15): Promise<TrainingPeaksActionWithStudent[]> {
  const supabase = createSupabaseServerClient();
  const safeLimit = Math.max(1, Math.min(limit, 30));
  const { data, error } = await supabase
    .from("trainingpeaks_actions")
    .select("*")
    .eq("action_type", "move_workout")
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (error) {
    throw new Error(`Failed to list recent TrainingPeaks actions: ${error.message}`);
  }

  const actions = ((data as TrainingPeaksActionRow[]) ?? []).map(mapTrainingPeaksActionRow);
  const studentIds = Array.from(new Set(actions.map((action) => action.studentId).filter((value): value is string => Boolean(value))));
  const studentNamesById = new Map<string, string>();

  if (studentIds.length > 0) {
    const { data: studentsData, error: studentsError } = await supabase
      .from("trainingpeaks_students")
      .select("id, student_name")
      .in("id", studentIds);
    if (studentsError) {
      throw new Error(`Failed to load TrainingPeaks students for actions list: ${studentsError.message}`);
    }

    for (const row of (studentsData as Array<{ id: string; student_name: string }> | null) ?? []) {
      studentNamesById.set(row.id, row.student_name);
    }
  }

  return actions.map((action) => ({
    ...action,
    studentName: action.studentId ? studentNamesById.get(action.studentId) ?? null : null,
  }));
}

export async function listActiveTrainingPeaksMoveActions(limit = 200): Promise<TrainingPeaksAction[]> {
  const supabase = createSupabaseServerClient();
  const safeLimit = Math.max(1, Math.min(limit, 500));
  const { data, error } = await supabase
    .from("trainingpeaks_actions")
    .select("*")
    .eq("action_type", "move_workout")
    .or(
      "status.eq.pending_coach,and(status.eq.approved,execution_status.in.(not_started,dry_run_running,dry_run_completed,execute_pending,running_local))"
    )
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (error) {
    throw new Error(`Failed to list active TrainingPeaks move actions: ${error.message}`);
  }

  return ((data as TrainingPeaksActionRow[]) ?? []).map(mapTrainingPeaksActionRow);
}

async function decideTrainingPeaksActionStatus(
  input: DecideTrainingPeaksActionInput,
  nextStatus: Extract<TrainingPeaksActionStatus, "approved" | "rejected">
): Promise<DecideTrainingPeaksActionResult> {
  const supabase = createSupabaseServerClient();
  const nowIso = new Date().toISOString();
  const updatePayload: Partial<TrainingPeaksActionRow> = {
    status: nextStatus,
    approved_at: nextStatus === "approved" ? nowIso : null,
    rejected_at: nextStatus === "rejected" ? nowIso : null,
    decided_by_chat_id: input.decidedByChatId,
    decided_by_user_id: input.decidedByUserId ?? null,
    decision_message_id: input.decisionMessageId ?? null,
  };

  if (nextStatus === "approved") {
    // Safety: approval only opens the action for dry-run. Real execution is queued
    // later by explicit execute request after trusted dry-run validation.
    updatePayload.execution_status = "not_started";
  }

  const { data, error } = await supabase
    .from("trainingpeaks_actions")
    .update(updatePayload)
    .eq("id", input.actionId)
    .eq("action_type", "move_workout")
    .eq("status", "pending_coach")
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to ${nextStatus} TrainingPeaks action ${input.actionId}: ${error.message}`);
  }

  if (data) {
    return {
      kind: "updated",
      action: mapTrainingPeaksActionRow(data as TrainingPeaksActionRow),
    };
  }

  const { data: existing, error: existingError } = await supabase
    .from("trainingpeaks_actions")
    .select("*")
    .eq("id", input.actionId)
    .maybeSingle();

  if (existingError) {
    throw new Error(
      `Failed to check decision state for TrainingPeaks action ${input.actionId}: ${existingError.message}`
    );
  }

  if (!existing) {
    return { kind: "not_found" };
  }

  return {
    kind: "already_decided",
    action: mapTrainingPeaksActionRow(existing as TrainingPeaksActionRow),
  };
}

export async function approveTrainingPeaksAction(
  input: DecideTrainingPeaksActionInput
): Promise<DecideTrainingPeaksActionResult> {
  return decideTrainingPeaksActionStatus(input, "approved");
}

export async function rejectTrainingPeaksAction(
  input: DecideTrainingPeaksActionInput
): Promise<DecideTrainingPeaksActionResult> {
  return decideTrainingPeaksActionStatus(input, "rejected");
}

async function resolveActionExecutionQueuedDisplayContext(
  action: TrainingPeaksAction,
  dryRunLogJson: unknown
): Promise<TrainingPeaksActionExecutionQueuedDisplayContext> {
  const dryRunContext = extractMoveSourceExecutionContextFromDryRunLog(dryRunLogJson);
  const trustedSourceDate = dryRunContext?.resolvedSourceDate ?? null;
  const trustedTargetDate = dryRunContext?.resolvedTargetDate ?? null;
  if (!trustedSourceDate || !trustedTargetDate) {
    throw new Error(`Trusted dry-run resolved dates missing for action ${action.id}`);
  }

  let studentName: string | null = null;
  if (action.studentId) {
    const student = await getTrainingPeaksStudentById(action.studentId);
    studentName = student?.studentName ?? null;
  }

  return {
    studentName,
    trustedSourceDate,
    trustedTargetDate,
  };
}

export async function requestTrainingPeaksActionExecution(
  input: RequestTrainingPeaksActionExecutionInput
): Promise<RequestTrainingPeaksActionExecutionResult> {
  const supabase = createSupabaseServerClient();
  const action = await getTrainingPeaksActionByIdInternal(input.actionId);
  if (!action) {
    return { kind: "not_found" };
  }

  if (action.executionStatus === "execute_pending" && action.status === "approved") {
    return { kind: "already_queued", action };
  }

  if (
    action.executionStatus === "completed" ||
    action.executionStatus === "running_local" ||
    action.executionStatus === "failed"
  ) {
    return { kind: "final_state", action };
  }

  if (action.status !== "approved") {
    return {
      kind: "blocked",
      action,
      reason: "Action is not approved.",
      latestRunContext: await getTrainingPeaksActionLatestRunContext(action.id),
    };
  }

  if (action.executionStatus !== "dry_run_completed") {
    return {
      kind: "blocked",
      action,
      reason: "Dry-run is not completed yet.",
      latestRunContext: await getTrainingPeaksActionLatestRunContext(action.id),
    };
  }

  const dryRunRunQuery = action.lastRunId
    ? supabase
        .from("trainingpeaks_action_runs")
        .select("id, log_json")
        .eq("id", action.lastRunId)
        .eq("action_id", action.id)
        .eq("run_type", "dry_run")
        .eq("status", "completed")
        .maybeSingle()
    : supabase
        .from("trainingpeaks_action_runs")
        .select("id, log_json")
        .eq("action_id", action.id)
        .eq("run_type", "dry_run")
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
  const { data: dryRunRun, error: dryRunError } = await dryRunRunQuery;

  if (dryRunError) {
    throw new Error(
      `Failed to load latest dry-run for TrainingPeaks action ${input.actionId}: ${dryRunError.message}`
    );
  }

  if (!dryRunRun) {
    return {
      kind: "blocked",
      action,
      reason: "Trusted dry-run run is missing.",
      latestRunContext: await getTrainingPeaksActionLatestRunContext(action.id),
    };
  }

  const dryRunValidation = validateDryRunLogReadiness(
    (dryRunRun as { log_json?: unknown }).log_json,
    action.parsedPayload
  );
  if (!dryRunValidation.ok) {
    return {
      kind: "blocked",
      action,
      reason: dryRunValidation.reason,
      latestRunContext: await getTrainingPeaksActionLatestRunContext(action.id),
    };
  }

  const nowIso = new Date().toISOString();
  const { data: queuedRow, error: updateError } = await supabase
    .from("trainingpeaks_actions")
    .update({
      execution_status: "execute_pending",
      last_run_id: (dryRunRun as { id: string }).id,
      execution_requested_at: nowIso,
      execution_requested_by_chat_id: input.requestedByChatId,
      execution_requested_by_user_id: input.requestedByUserId ?? null,
      execution_request_message_id: input.requestMessageId ?? null,
    })
    .eq("id", input.actionId)
    .eq("status", "approved")
    .eq("execution_status", "dry_run_completed")
    .select("*")
    .maybeSingle();

  if (updateError) {
    throw new Error(`Failed to queue TrainingPeaks action execution ${input.actionId}: ${updateError.message}`);
  }

  if (queuedRow) {
    const action = mapTrainingPeaksActionRow(queuedRow as TrainingPeaksActionRow);
    const queuedDisplay = await resolveActionExecutionQueuedDisplayContext(
      action,
      (dryRunRun as { log_json?: unknown }).log_json
    );
    return { kind: "queued", action, queuedDisplay };
  }

  const latest = await getTrainingPeaksActionByIdInternal(input.actionId);
  if (!latest) {
    return { kind: "not_found" };
  }
  if (latest.executionStatus === "execute_pending" && latest.status === "approved") {
    return { kind: "already_queued", action: latest };
  }
  if (
    latest.executionStatus === "completed" ||
    latest.executionStatus === "running_local" ||
    latest.executionStatus === "failed"
  ) {
    return { kind: "final_state", action: latest };
  }
  return {
    kind: "blocked",
    action: latest,
    reason: "Action state changed. Please refresh and try again.",
    latestRunContext: await getTrainingPeaksActionLatestRunContext(latest.id),
  };
}

const TRAININGPEAKS_DRY_RUN_RECHECK_SOURCE_EXECUTION_STATUSES = ["dry_run_completed", "failed"] as const;

function isTrainingPeaksActionDryRunRecheckEligible(
  action: TrainingPeaksAction,
  latestRunContext: TrainingPeaksActionLatestRunContext | null
): { ok: true } | { ok: false; reason: string } {
  if (action.actionType !== "move_workout") {
    return { ok: false, reason: "Поддерживается только для move-заявок." };
  }
  if (action.executionStatus === "running_local" || action.executionStatus === "dry_run_running") {
    return { ok: false, reason: "Заявка уже выполняется локальным runner." };
  }
  if (action.status === "rejected") {
    return { ok: false, reason: "Заявка отменена, повторная проверка недоступна." };
  }
  if (action.status !== "approved") {
    return { ok: false, reason: "Заявка не одобрена, повторная проверка недоступна." };
  }
  if (
    !TRAININGPEAKS_DRY_RUN_RECHECK_SOURCE_EXECUTION_STATUSES.includes(
      action.executionStatus as (typeof TRAININGPEAKS_DRY_RUN_RECHECK_SOURCE_EXECUTION_STATUSES)[number]
    )
  ) {
    return { ok: false, reason: "Заявка не в состоянии завершённого dry-run для повторной проверки." };
  }
  if (action.executionStatus === "completed") {
    return { ok: false, reason: "Заявка уже успешно выполнена." };
  }
  const latestDryRun = latestRunContext?.latestDryRun ?? null;
  if (!latestDryRun) {
    return { ok: false, reason: "Нет завершённого dry-run для повторной проверки." };
  }
  if (latestDryRun.status !== "completed") {
    return { ok: false, reason: "Последний dry-run ещё не завершён." };
  }
  if (latestDryRun.canExecute === true && latestDryRun.dryRunResult === "candidate_found") {
    return { ok: false, reason: "Последний dry-run успешный и готов к выполнению." };
  }
  if (
    latestDryRun.dryRunResult === "not_found" ||
    latestDryRun.dryRunResult === "failed" ||
    latestDryRun.dryRunResult === "ambiguous"
  ) {
    return { ok: true };
  }
  if (latestDryRun.canExecute === false || Boolean(latestDryRun.blockedReason) || Boolean(latestDryRun.failureReason)) {
    return { ok: true };
  }
  return { ok: false, reason: "Повторная проверка доступна только для blocked/not_found/failed dry-run." };
}

export async function requestTrainingPeaksActionDryRunRecheck(
  input: RequestTrainingPeaksActionDryRunRecheckInput
): Promise<RequestTrainingPeaksActionDryRunRecheckResult> {
  const action = await getTrainingPeaksActionByIdInternal(input.actionId);
  if (!action) {
    return { kind: "not_found", message: "Заявка не найдена или уже недоступна." };
  }

  const latestRunContext = await getTrainingPeaksActionLatestRunContext(action.id);
  const eligibility = isTrainingPeaksActionDryRunRecheckEligible(action, latestRunContext);
  if (!eligibility.ok) {
    return {
      kind: "blocked",
      action,
      reason: eligibility.reason,
      message: `⚠️ Повторная проверка недоступна: ${eligibility.reason}`,
      latestRunContext,
    };
  }

  const supabase = createSupabaseServerClient();
  const nowIso = new Date().toISOString();
  const { data: requeued, error } = await supabase
    .from("trainingpeaks_actions")
    .update({
      execution_status: "not_started",
      execution_mode: "dry_run",
      claimed_by: null,
      claimed_at: null,
      last_run_id: null,
      execution_requested_at: null,
      execution_requested_by_chat_id: null,
      execution_requested_by_user_id: null,
      execution_request_message_id: null,
      updated_at: nowIso,
    })
    .eq("id", action.id)
    .eq("action_type", "move_workout")
    .eq("status", "approved")
    .in("execution_status", [...TRAININGPEAKS_DRY_RUN_RECHECK_SOURCE_EXECUTION_STATUSES])
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to requeue TrainingPeaks action dry-run ${action.id}: ${error.message}`);
  }

  if (requeued) {
    return {
      kind: "requeued",
      action: mapTrainingPeaksActionRow(requeued as TrainingPeaksActionRow),
      message: "🔁 Проверка поставлена в очередь. Запусти локальный runner, чтобы обновить результат.",
    };
  }

  const latest = await getTrainingPeaksActionByIdInternal(action.id);
  if (!latest) {
    return { kind: "not_found", message: "Заявка не найдена или уже недоступна." };
  }
  return {
    kind: "blocked",
    action: latest,
    reason: "Состояние заявки изменилось. Обновите карточку и попробуйте снова.",
    message: "⚠️ Повторная проверка недоступна: состояние заявки изменилось. Обновите карточку и попробуйте снова.",
    latestRunContext: await getTrainingPeaksActionLatestRunContext(latest.id),
  };
}

function extractIsoDateFromLogJson(logJson: unknown, key: "sourceDate" | "targetDate"): string | null {
  if (!logJson || typeof logJson !== "object") {
    return null;
  }
  const resolvedDates = (logJson as { resolvedDates?: { sourceDate?: unknown; targetDate?: unknown } | null })
    .resolvedDates;
  return trimOrNull(key === "sourceDate" ? resolvedDates?.sourceDate : resolvedDates?.targetDate);
}

function isDryRunEligibleForCoachSourceDateConfirmation(
  dryRun: TrainingPeaksActionRunContextSummary | null
): dryRun is TrainingPeaksActionRunContextSummary {
  if (!dryRun) {
    return false;
  }
  if (dryRun.runType !== "dry_run" || dryRun.status !== "completed") {
    return false;
  }
  if (dryRun.dryRunResult !== "candidate_found" || dryRun.canExecute !== false) {
    return false;
  }
  if (!dryRun.selectedSourceDate) {
    return false;
  }
  if (!extractIsoDateFromLogJson(dryRun.logJson, "targetDate")) {
    return false;
  }
  if (!dryRun.selectedSourceDatePolicy || isExecutableMoveSourcePolicy(dryRun.selectedSourceDatePolicy)) {
    return false;
  }
  return isEligibleForCoachSourceDateConfirmation(dryRun.logJson);
}

function shouldShowCoachConfirmSourceDateAction(latestRunContext: TrainingPeaksActionLatestRunContext | null): boolean {
  return isDryRunEligibleForCoachSourceDateConfirmation(latestRunContext?.latestDryRun ?? null);
}

async function requestFreshDryRunAfterCoachSourceConfirmation(
  action: TrainingPeaksAction
): Promise<boolean> {
  if (action.status !== "approved") {
    return false;
  }
  if (action.executionStatus !== "dry_run_completed") {
    return false;
  }

  const supabase = createSupabaseServerClient();
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("trainingpeaks_actions")
    .update({
      execution_status: "not_started",
      execution_mode: "dry_run",
      claimed_by: null,
      claimed_at: null,
      last_run_id: null,
      execution_requested_at: null,
      execution_requested_by_chat_id: null,
      execution_requested_by_user_id: null,
      execution_request_message_id: null,
      updated_at: nowIso,
    })
    .eq("id", action.id)
    .eq("action_type", "move_workout")
    .eq("status", "approved")
    .eq("execution_status", "dry_run_completed")
    .select("id")
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to requeue dry-run after source date confirmation for action ${action.id}: ${error.message}`);
  }
  return Boolean(data);
}

function buildActionParsedPayloadWithCoachSourceConfirmation(input: {
  parsedPayload: unknown;
  confirmedSourceDate: string;
  confirmedAtIso: string;
  confirmedByUserId: string | null;
}): Record<string, unknown> {
  const basePayload =
    input.parsedPayload && typeof input.parsedPayload === "object" && !Array.isArray(input.parsedPayload)
      ? (input.parsedPayload as Record<string, unknown>)
      : {};
  return {
    ...basePayload,
    coach_confirmed_source_date: input.confirmedSourceDate,
    coach_confirmed_source_date_at: input.confirmedAtIso,
    coach_confirmed_source_date_by: input.confirmedByUserId,
    source_date_policy_override: "coach_confirmed_source_date",
  };
}

export async function confirmTrainingPeaksActionSourceDate(
  input: ConfirmTrainingPeaksActionSourceDateInput
): Promise<ConfirmTrainingPeaksActionSourceDateResult> {
  const context = await getTrainingPeaksActionLatestRunContext(input.actionId);
  if (!context) {
    return { kind: "not_found" };
  }

  const latestDryRun = context.latestDryRun;
  if (!latestDryRun || !shouldShowCoachConfirmSourceDateAction(context)) {
    const blockedReason =
      context.latestDryRun && typeof context.latestDryRun.blockedReason === "string"
        ? context.latestDryRun.blockedReason
        : "Latest dry-run is not eligible for source date confirmation.";
    return {
      kind: "blocked",
      action: context.action,
      reason: blockedReason,
      latestDryRun: context.latestDryRun,
    };
  }

  const confirmedSourceDate = latestDryRun.selectedSourceDate!;
  const nowIso = new Date().toISOString();
  const parsedPayload = buildActionParsedPayloadWithCoachSourceConfirmation({
    parsedPayload: context.action.parsedPayload,
    confirmedSourceDate,
    confirmedAtIso: nowIso,
    confirmedByUserId: input.confirmedByUserId ?? null,
  });

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_actions")
    .update({
      parsed_payload: parsedPayload,
      updated_at: nowIso,
    })
    .eq("id", input.actionId)
    .eq("action_type", "move_workout")
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to confirm source date for TrainingPeaks action ${input.actionId}: ${error.message}`);
  }
  if (!data) {
    return { kind: "not_found" };
  }

  const mappedAction = mapTrainingPeaksActionRow(data as TrainingPeaksActionRow);
  const dryRunRequeueRequested = await requestFreshDryRunAfterCoachSourceConfirmation(mappedAction);

  return {
    kind: "confirmed",
    action: mappedAction,
    confirmedSourceDate,
    latestDryRun,
    dryRunRequeueRequested,
  };
}

export type CancelTrainingPeaksActionExecutionResultExtended =
  | CancelTrainingPeaksActionExecutionResult
  | {
      kind: "not_cancellable";
      action: TrainingPeaksAction;
      reason: string;
    };

const CANCELLABLE_EXECUTION_STATUSES: TrainingPeaksActionExecutionStatus[] = [
  "not_started",
  "dry_run_running",
  "dry_run_completed",
  "execute_pending",
  "failed",
];

export async function cancelTrainingPeaksActionExecution(
  input: CancelTrainingPeaksActionExecutionInput
): Promise<CancelTrainingPeaksActionExecutionResultExtended> {
  const supabase = createSupabaseServerClient();
  const action = await getTrainingPeaksActionByIdInternal(input.actionId);
  if (!action) {
    return { kind: "not_found" };
  }

  if (action.status === "rejected") {
    return { kind: "already_cancelled", action };
  }

  if (action.executionStatus === "completed") {
    return { kind: "not_cancellable", action, reason: "Action already completed." };
  }

  if (action.executionStatus === "running_local") {
    return { kind: "not_cancellable", action, reason: "Action is currently executing on local runner." };
  }

  if (action.status !== "pending_coach" && action.status !== "approved") {
    return { kind: "not_cancellable", action, reason: `Unexpected action status: ${action.status}` };
  }

  if (!CANCELLABLE_EXECUTION_STATUSES.includes(action.executionStatus)) {
    return { kind: "not_cancellable", action, reason: `Execution status ${action.executionStatus} is not cancellable.` };
  }

  const nowIso = new Date().toISOString();
  const cancelPayload = {
    status: "rejected" as const,
    rejected_at: nowIso,
    decided_by_chat_id: input.cancelledByChatId,
    decided_by_user_id: input.cancelledByUserId ?? null,
    decision_message_id: input.cancelMessageId ?? null,
    cancelled_at: nowIso,
    cancelled_by_chat_id: input.cancelledByChatId,
    cancelled_by_user_id: input.cancelledByUserId ?? null,
    cancel_message_id: input.cancelMessageId ?? null,
  };

  // Try cancelling approved actions
  const { data: cancelledApproved, error: approvedError } = await supabase
    .from("trainingpeaks_actions")
    .update(cancelPayload)
    .eq("id", input.actionId)
    .eq("status", "approved")
    .in("execution_status", CANCELLABLE_EXECUTION_STATUSES)
    .select("*")
    .maybeSingle();

  if (approvedError) {
    throw new Error(`Failed to cancel TrainingPeaks action execution ${input.actionId}: ${approvedError.message}`);
  }

  if (cancelledApproved) {
    return { kind: "cancelled", action: mapTrainingPeaksActionRow(cancelledApproved as TrainingPeaksActionRow) };
  }

  // Try cancelling pending_coach actions
  const { data: cancelledPending, error: pendingError } = await supabase
    .from("trainingpeaks_actions")
    .update(cancelPayload)
    .eq("id", input.actionId)
    .eq("status", "pending_coach")
    .in("execution_status", CANCELLABLE_EXECUTION_STATUSES)
    .select("*")
    .maybeSingle();

  if (pendingError) {
    throw new Error(`Failed to cancel TrainingPeaks action execution ${input.actionId}: ${pendingError.message}`);
  }

  if (cancelledPending) {
    return { kind: "cancelled", action: mapTrainingPeaksActionRow(cancelledPending as TrainingPeaksActionRow) };
  }

  const latest = await getTrainingPeaksActionByIdInternal(input.actionId);
  if (!latest) {
    return { kind: "not_found" };
  }
  if (latest.status === "rejected") {
    return { kind: "already_cancelled", action: latest };
  }
  if (latest.executionStatus === "completed") {
    return { kind: "not_cancellable", action: latest, reason: "Action already completed." };
  }
  if (latest.executionStatus === "running_local") {
    return { kind: "not_cancellable", action: latest, reason: "Action is currently executing on local runner." };
  }
  return { kind: "not_cancellable", action: latest, reason: "Action state changed. Please refresh and try again." };
}

export async function claimOneApprovedTrainingPeaksActionForDryRun(
  claimedBy: string
): Promise<ClaimedTrainingPeaksDryRunAction | null> {
  const supabase = createSupabaseServerClient();
  const normalizedClaimedBy = claimedBy.trim();
  if (!normalizedClaimedBy) {
    throw new Error("Failed to claim dry-run TrainingPeaks action: claimedBy is empty");
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data: candidate, error: candidateError } = await supabase
      .from("trainingpeaks_actions")
      .select("*")
      .eq("action_type", "move_workout")
      .eq("status", "approved")
      .eq("execution_status", "not_started")
      .order("approved_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (candidateError) {
      throw new Error(
        `Failed to select approved TrainingPeaks action candidate for dry-run: ${candidateError.message}`
      );
    }

    if (!candidate) {
      return null;
    }

    const claimedAt = new Date().toISOString();
    const { data: claimedRow, error: claimError } = await supabase
      .from("trainingpeaks_actions")
      .update({
        execution_status: "dry_run_running",
        execution_mode: "dry_run",
        claimed_by: normalizedClaimedBy,
        claimed_at: claimedAt,
      })
      .eq("id", candidate.id)
      .eq("status", "approved")
      .eq("execution_status", "not_started")
      .select("*")
      .maybeSingle();

    if (claimError) {
      throw new Error(`Failed to claim TrainingPeaks action ${candidate.id} for dry-run: ${claimError.message}`);
    }

    if (!claimedRow) {
      continue;
    }

    const action = mapTrainingPeaksActionRow(claimedRow as TrainingPeaksActionRow);
    let student: TrainingPeaksStudent | null = null;
    if (action.studentId) {
      student = await getTrainingPeaksStudentById(action.studentId);
    }

    return { action, student };
  }

  return null;
}

export async function createTrainingPeaksActionRun(
  input: CreateTrainingPeaksActionRunInput
): Promise<TrainingPeaksActionRun> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_action_runs")
    .insert({
      action_id: input.actionId,
      run_type: input.runType,
      status: "running",
      dry_run: input.dryRun ?? input.runType === "dry_run",
      runner_id: input.runnerId ?? null,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create TrainingPeaks action run for action ${input.actionId}: ${error.message}`);
  }

  return mapTrainingPeaksActionRunRow(data as TrainingPeaksActionRunRow);
}

export async function listLatestTrainingPeaksActionRunsByActionIds(
  actionIds: string[]
): Promise<Map<string, TrainingPeaksActionRun>> {
  const normalizedActionIds = Array.from(new Set(actionIds.map((id) => id.trim()).filter(Boolean)));
  if (normalizedActionIds.length === 0) {
    return new Map();
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_action_runs")
    .select("*")
    .in("action_id", normalizedActionIds)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list latest TrainingPeaks action runs: ${error.message}`);
  }

  const latestByActionId = new Map<string, TrainingPeaksActionRun>();
  for (const row of (data as TrainingPeaksActionRunRow[] | null) ?? []) {
    if (!latestByActionId.has(row.action_id)) {
      latestByActionId.set(row.action_id, mapTrainingPeaksActionRunRow(row));
    }
  }

  return latestByActionId;
}

async function getLatestTrainingPeaksActionRunSummary(
  actionId: string,
  runType: TrainingPeaksActionRunType
): Promise<TrainingPeaksActionRunContextSummary | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_action_runs")
    .select("*")
    .eq("action_id", actionId)
    .eq("run_type", runType)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(
      `Failed to load latest ${runType} TrainingPeaks action run for action ${actionId}: ${error.message}`
    );
  }
  if (!data) {
    return null;
  }
  return mapActionRunContextSummary(data as TrainingPeaksActionRunRow);
}

export async function getTrainingPeaksActionLatestRunContext(
  actionId: string
): Promise<TrainingPeaksActionLatestRunContext | null> {
  const action = await getTrainingPeaksActionByIdInternal(actionId);
  if (!action) {
    return null;
  }
  const [latestDryRun, latestExecute] = await Promise.all([
    getLatestTrainingPeaksActionRunSummary(actionId, "dry_run"),
    getLatestTrainingPeaksActionRunSummary(actionId, "real"),
  ]);
  return {
    action,
    latestDryRun,
    latestExecute,
    latestRelevant: latestExecute ?? latestDryRun,
  };
}

export async function listTrainingPeaksActionLatestRunContexts(
  actionIds: string[]
): Promise<Map<string, TrainingPeaksActionLatestRunContext>> {
  const normalizedActionIds = Array.from(new Set(actionIds.map((id) => id.trim()).filter(Boolean)));
  if (normalizedActionIds.length === 0) {
    return new Map();
  }

  const supabase = createSupabaseServerClient();
  const [actionsRows, runsRows] = await Promise.all([
    supabase
      .from("trainingpeaks_actions")
      .select("*")
      .in("id", normalizedActionIds),
    supabase
      .from("trainingpeaks_action_runs")
      .select("*")
      .in("action_id", normalizedActionIds)
      .order("created_at", { ascending: false }),
  ]);

  if (actionsRows.error) {
    throw new Error(`Failed to load TrainingPeaks actions for run contexts: ${actionsRows.error.message}`);
  }
  if (runsRows.error) {
    throw new Error(`Failed to load TrainingPeaks action runs for run contexts: ${runsRows.error.message}`);
  }

  const actionsById = new Map<string, TrainingPeaksAction>();
  for (const row of (actionsRows.data as TrainingPeaksActionRow[] | null) ?? []) {
    actionsById.set(row.id, mapTrainingPeaksActionRow(row));
  }

  const latestDryRunByActionId = new Map<string, TrainingPeaksActionRunContextSummary>();
  const latestExecuteByActionId = new Map<string, TrainingPeaksActionRunContextSummary>();
  for (const row of (runsRows.data as TrainingPeaksActionRunRow[] | null) ?? []) {
    if (row.run_type === "dry_run" && !latestDryRunByActionId.has(row.action_id)) {
      latestDryRunByActionId.set(row.action_id, mapActionRunContextSummary(row));
      continue;
    }
    if (row.run_type === "real" && !latestExecuteByActionId.has(row.action_id)) {
      latestExecuteByActionId.set(row.action_id, mapActionRunContextSummary(row));
    }
  }

  const contexts = new Map<string, TrainingPeaksActionLatestRunContext>();
  for (const actionId of normalizedActionIds) {
    const action = actionsById.get(actionId);
    if (!action) {
      continue;
    }
    const latestDryRun = latestDryRunByActionId.get(actionId) ?? null;
    const latestExecute = latestExecuteByActionId.get(actionId) ?? null;
    contexts.set(actionId, {
      action,
      latestDryRun,
      latestExecute,
      latestRelevant: latestExecute ?? latestDryRun,
    });
  }
  return contexts;
}

export async function completeTrainingPeaksActionDryRun(
  actionId: string,
  input: CompleteTrainingPeaksActionDryRunInput
): Promise<void> {
  const supabase = createSupabaseServerClient();
  const finishedAt = new Date().toISOString();

  const { error: runError } = await supabase
    .from("trainingpeaks_action_runs")
    .update({
      status: "completed",
      finished_at: finishedAt,
      error_message: null,
      log_json: input.logJson ?? {},
      screenshot_before_path: input.screenshotBeforePath ?? null,
      screenshot_after_path: input.screenshotAfterPath ?? null,
    })
    .eq("id", input.runId)
    .eq("action_id", actionId)
    .eq("status", "running");

  if (runError) {
    throw new Error(`Failed to complete dry-run action run ${input.runId}: ${runError.message}`);
  }

  const { error: actionError } = await supabase
    .from("trainingpeaks_actions")
    .update({
      execution_status: "dry_run_completed",
      execution_mode: "dry_run",
      last_run_id: input.runId,
    })
    .eq("id", actionId);

  if (actionError) {
    throw new Error(`Failed to mark TrainingPeaks action ${actionId} as dry_run_completed: ${actionError.message}`);
  }
}

export async function failTrainingPeaksActionDryRun(
  actionId: string,
  input: FailTrainingPeaksActionDryRunInput & { runId: string }
): Promise<void> {
  const supabase = createSupabaseServerClient();
  const finishedAt = new Date().toISOString();

  const { error: runError } = await supabase
    .from("trainingpeaks_action_runs")
    .update({
      status: "failed",
      finished_at: finishedAt,
      error_message: input.errorMessage,
      log_json: input.logJson ?? {},
    })
    .eq("id", input.runId)
    .eq("action_id", actionId)
    .eq("status", "running");

  if (runError) {
    throw new Error(`Failed to mark dry-run action run ${input.runId} as failed: ${runError.message}`);
  }

  const { error: actionError } = await supabase
    .from("trainingpeaks_actions")
    .update({
      execution_status: "failed",
      execution_mode: "dry_run",
      last_run_id: input.runId,
    })
    .eq("id", actionId);

  if (actionError) {
    throw new Error(`Failed to mark TrainingPeaks action ${actionId} as failed: ${actionError.message}`);
  }
}

export async function getTrainingPeaksJobById(jobId: string): Promise<TrainingPeaksJob | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get TrainingPeaks job ${jobId}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksJobRow(data as TrainingPeaksJobRow);
}

export async function findActiveTrainingPeaksJobForWeek(
  jobType: TrainingPeaksJobType,
  weekFrom: string,
  weekTo: string
): Promise<TrainingPeaksJob | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_jobs")
    .select("*")
    .eq("job_type", jobType)
    .eq("scope", "all_enabled")
    .eq("week_from", weekFrom)
    .eq("week_to", weekTo)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to find active TrainingPeaks job for ${jobType} ${weekFrom}..${weekTo}: ${error.message}`
    );
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksJobRow(data as TrainingPeaksJobRow);
}

export async function findActiveTrainingPeaksRaceResultsProbeJobForStudent(
  studentInternalId: string
): Promise<TrainingPeaksJob | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_jobs")
    .select("*")
    .eq("job_type", "race_results_probe")
    .eq("scope", "single_student")
    .eq("student_id", studentInternalId)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to find active TrainingPeaks race-results probe job for student ${studentInternalId}: ${error.message}`
    );
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksJobRow(data as TrainingPeaksJobRow);
}

export async function findActiveTrainingPeaksJobForStudentWeek(
  jobType: TrainingPeaksJobType,
  studentId: string,
  weekFrom: string,
  weekTo: string
): Promise<TrainingPeaksJob | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_jobs")
    .select("*")
    .eq("job_type", jobType)
    .eq("scope", "single_student")
    .eq("student_id", studentId)
    .eq("week_from", weekFrom)
    .eq("week_to", weekTo)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to find active TrainingPeaks job for ${jobType} student ${studentId} ${weekFrom}..${weekTo}: ${error.message}`
    );
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksJobRow(data as TrainingPeaksJobRow);
}

export async function getTrainingPeaksWeeklyReportForStudentWeek(
  studentId: string,
  weekFrom: string,
  weekTo: string
): Promise<TrainingPeaksWeeklyReport | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_weekly_reports")
    .select("*")
    .eq("student_id", studentId)
    .eq("week_from", weekFrom)
    .eq("week_to", weekTo)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to get TrainingPeaks weekly report for ${studentId} ${weekFrom}..${weekTo}: ${error.message}`
    );
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksWeeklyReportRow(data as TrainingPeaksWeeklyReportRow);
}

export async function listRecentTrainingPeaksJobs(limit = 10): Promise<TrainingPeaksJob[]> {
  const supabase = createSupabaseServerClient();
  const safeLimit = Math.max(1, Math.min(limit, 50));
  const { data, error } = await supabase
    .from("trainingpeaks_jobs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (error) {
    throw new Error(`Failed to list TrainingPeaks jobs: ${error.message}`);
  }

  return ((data as TrainingPeaksJobRow[]) ?? []).map(mapTrainingPeaksJobRow);
}

export async function countRunningTrainingPeaksJobsUpdatedBefore(cutoffIso: string): Promise<number> {
  const supabase = createSupabaseServerClient();
  const { count, error } = await supabase
    .from("trainingpeaks_jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "running")
    .lt("updated_at", cutoffIso);

  if (error) {
    throw new Error(`Failed to count stale running TrainingPeaks jobs: ${error.message}`);
  }

  return count ?? 0;
}

export async function claimNextQueuedTrainingPeaksJob(): Promise<TrainingPeaksJob | null> {
  return claimNextQueuedTrainingPeaksJobByType("weekly_reports");
}

export async function claimNextQueuedTrainingPeaksRaceScanJob(): Promise<TrainingPeaksJob | null> {
  return claimNextQueuedTrainingPeaksJobByType("race_scan_events");
}

export async function claimNextQueuedTrainingPeaksRaceResultsProbeJob(): Promise<TrainingPeaksJob | null> {
  return claimNextQueuedTrainingPeaksJobByType("race_results_probe");
}

async function claimNextQueuedTrainingPeaksJobByType(
  jobType: TrainingPeaksJobType
): Promise<TrainingPeaksJob | null> {
  const supabase = createSupabaseServerClient();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data: nextJob, error: selectError } = await supabase
      .from("trainingpeaks_jobs")
      .select("*")
      .eq("job_type", jobType)
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (selectError) {
      throw new Error(`Failed to select next TrainingPeaks job: ${selectError.message}`);
    }

    if (!nextJob) {
      return null;
    }

    const { data: claimedJob, error: claimError } = await supabase
      .from("trainingpeaks_jobs")
      .update({
        status: "running",
        started_at: new Date().toISOString(),
        finished_at: null,
        error_message: null,
      })
      .eq("id", nextJob.id)
      .eq("status", "queued")
      .select("*")
      .maybeSingle();

    if (claimError) {
      throw new Error(`Failed to claim TrainingPeaks job ${nextJob.id}: ${claimError.message}`);
    }

    if (claimedJob) {
      return mapTrainingPeaksJobRow(claimedJob as TrainingPeaksJobRow);
    }
  }

  return null;
}

export async function recoverStaleTrainingPeaksRunningJobs(timeoutMinutes: number): Promise<number> {
  return recoverStaleTrainingPeaksRunningJobsByTypes(timeoutMinutes, ["weekly_reports"]);
}

export async function recoverStaleTrainingPeaksRunningRaceScanJobs(
  timeoutMinutes: number
): Promise<number> {
  return recoverStaleTrainingPeaksRunningJobsByTypes(timeoutMinutes, ["race_scan_events"]);
}

export async function recoverStaleTrainingPeaksRunningRaceResultsProbeJobs(
  timeoutMinutes: number
): Promise<number> {
  return recoverStaleTrainingPeaksRunningJobsByTypes(timeoutMinutes, ["race_results_probe"]);
}

async function recoverStaleTrainingPeaksRunningJobsByTypes(
  timeoutMinutes: number,
  jobTypes: TrainingPeaksJobType[]
): Promise<number> {
  const supabase = createSupabaseServerClient();
  const safeTimeoutMinutes = Math.max(1, Math.floor(timeoutMinutes));
  const cutoff = new Date(Date.now() - safeTimeoutMinutes * 60 * 1000).toISOString();
  const finishedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("trainingpeaks_jobs")
    .update({
      status: "failed",
      error_message: "Job marked failed after stale running timeout",
      result_json: null,
      finished_at: finishedAt,
    })
    .in("job_type", jobTypes)
    .eq("status", "running")
    .not("started_at", "is", null)
    .lt("started_at", cutoff)
    .select("id");

  if (error) {
    throw new Error(`Failed to recover stale TrainingPeaks jobs: ${error.message}`);
  }

  return (data ?? []).length;
}

export async function completeTrainingPeaksJob(jobId: string, result: unknown): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("trainingpeaks_jobs")
    .update({
      status: "completed",
      result_json: result,
      error_message: null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to complete TrainingPeaks job ${jobId}: ${error.message}`);
  }
}

export async function failTrainingPeaksJob(
  jobId: string,
  errorMessage: string,
  result?: unknown
): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("trainingpeaks_jobs")
    .update({
      status: "failed",
      error_message: errorMessage,
      result_json: result ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw new Error(`Failed to fail TrainingPeaks job ${jobId}: ${error.message}`);
  }
}

export async function cancelQueuedTrainingPeaksJob(jobId: string): Promise<TrainingPeaksJob | null> {
  const supabase = createSupabaseServerClient();
  const finishedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("trainingpeaks_jobs")
    .update({
      status: "failed",
      error_message: TRAININGPEAKS_JOB_CANCELLED_ERROR_MESSAGE,
      result_json: null,
      finished_at: finishedAt,
    })
    .eq("id", jobId)
    .eq("status", "queued")
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to cancel queued TrainingPeaks job ${jobId}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksJobRow(data as TrainingPeaksJobRow);
}

export const TRAININGPEAKS_ATTENTION_DIGEST_CRON_JOB_NAME = "attention_digest";
export const TRAININGPEAKS_STALE_JOB_SWEEPER_CRON_JOB_NAME = "stale_job_sweeper";

export type TrainingPeaksCronRunLogSource = "vercel_cron" | "manual" | "unknown";
export type TrainingPeaksCronRunLogStatus =
  | "started"
  | "sent"
  | "failed"
  | "unauthorized"
  | "skipped";

export type TrainingPeaksCronRunLog = {
  id: string;
  jobName: string;
  source: TrainingPeaksCronRunLogSource;
  status: TrainingPeaksCronRunLogStatus;
  httpMethod: string | null;
  userAgent: string | null;
  requestPath: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  responseStatus: number | null;
  counts: Record<string, unknown>;
  errorMessage: string | null;
  createdAt: string;
};

type TrainingPeaksCronRunLogRow = {
  id: string;
  job_name: string;
  source: TrainingPeaksCronRunLogSource;
  status: TrainingPeaksCronRunLogStatus;
  http_method: string | null;
  user_agent: string | null;
  request_path: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  response_status: number | null;
  counts: Record<string, unknown> | null;
  error_message: string | null;
  created_at: string;
};

function mapTrainingPeaksCronRunLogRow(row: TrainingPeaksCronRunLogRow): TrainingPeaksCronRunLog {
  return {
    id: row.id,
    jobName: row.job_name,
    source: row.source,
    status: row.status,
    httpMethod: row.http_method,
    userAgent: row.user_agent,
    requestPath: row.request_path,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    responseStatus: row.response_status,
    counts: row.counts ?? {},
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}

export type CreateTrainingPeaksCronRunLogInput = {
  jobName: string;
  source?: TrainingPeaksCronRunLogSource;
  status: TrainingPeaksCronRunLogStatus;
  httpMethod?: string | null;
  userAgent?: string | null;
  requestPath?: string | null;
  counts?: Record<string, unknown>;
};

export async function createTrainingPeaksCronRunLog(
  input: CreateTrainingPeaksCronRunLogInput
): Promise<TrainingPeaksCronRunLog> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_cron_run_logs")
    .insert({
      job_name: input.jobName,
      source: input.source ?? "unknown",
      status: input.status,
      http_method: input.httpMethod ?? null,
      user_agent: input.userAgent ?? null,
      request_path: input.requestPath ?? null,
      counts: input.counts ?? {},
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create TrainingPeaks cron run log for ${input.jobName}: ${error.message}`);
  }

  return mapTrainingPeaksCronRunLogRow(data as TrainingPeaksCronRunLogRow);
}

export type FinishTrainingPeaksCronRunLogInput = {
  status: Exclude<TrainingPeaksCronRunLogStatus, "started">;
  responseStatus?: number | null;
  counts?: Record<string, unknown>;
  errorMessage?: string | null;
  finishedAt?: string;
  durationMs?: number | null;
};

export async function finishTrainingPeaksCronRunLog(
  runLogId: string,
  input: FinishTrainingPeaksCronRunLogInput
): Promise<void> {
  const supabase = createSupabaseServerClient();
  const finishedAt = input.finishedAt ?? new Date().toISOString();
  const { error } = await supabase
    .from("trainingpeaks_cron_run_logs")
    .update({
      status: input.status,
      finished_at: finishedAt,
      duration_ms: input.durationMs ?? null,
      response_status: input.responseStatus ?? null,
      counts: input.counts ?? {},
      error_message: input.errorMessage ?? null,
    })
    .eq("id", runLogId);

  if (error) {
    throw new Error(`Failed to finish TrainingPeaks cron run log ${runLogId}: ${error.message}`);
  }
}

export async function listTrainingPeaksCronRunLogs(input: {
  jobName: string;
  limit?: number;
}): Promise<TrainingPeaksCronRunLog[]> {
  const supabase = createSupabaseServerClient();
  const safeLimit = Math.max(1, Math.min(input.limit ?? 5, 20));
  const { data, error } = await supabase
    .from("trainingpeaks_cron_run_logs")
    .select("*")
    .eq("job_name", input.jobName)
    .order("started_at", { ascending: false })
    .limit(safeLimit);

  if (error) {
    throw new Error(`Failed to list TrainingPeaks cron run logs for ${input.jobName}: ${error.message}`);
  }

  return ((data as TrainingPeaksCronRunLogRow[] | null) ?? []).map(mapTrainingPeaksCronRunLogRow);
}

export async function getLatestTrainingPeaksCronRunLog(input: {
  jobName: string;
  status?: TrainingPeaksCronRunLogStatus;
}): Promise<TrainingPeaksCronRunLog | null> {
  const supabase = createSupabaseServerClient();
  let query = supabase
    .from("trainingpeaks_cron_run_logs")
    .select("*")
    .eq("job_name", input.jobName)
    .order("started_at", { ascending: false })
    .limit(1);

  if (input.status) {
    query = query.eq("status", input.status);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(
      `Failed to get latest TrainingPeaks cron run log for ${input.jobName}: ${error.message}`
    );
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksCronRunLogRow(data as TrainingPeaksCronRunLogRow);
}

export type TrainingPeaksTelegramContextSourceType =
  | "business_dm"
  | "private_dm"
  | "group_topic"
  | "group_general";

export type TrainingPeaksTelegramContextObservation = {
  id: string;
  studentId: string | null;
  sourceType: TrainingPeaksTelegramContextSourceType;
  chatId: string;
  messageThreadId: number | null;
  messageId: string | null;
  observedAt: string;
  labels: string[];
  textSha256: string | null;
  textPreview: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type TrainingPeaksTelegramContextObservationRow = {
  id: string;
  student_id: string | null;
  source_type: string;
  chat_id: string;
  message_thread_id: number | null;
  message_id: string | null;
  observed_at: string;
  labels: unknown;
  text_sha256: string | null;
  text_preview: string | null;
  metadata: unknown;
  created_at: string;
};

export type InsertTrainingPeaksTelegramContextObservationInput = {
  studentId: string | null;
  sourceType: TrainingPeaksTelegramContextSourceType;
  chatId: string;
  messageThreadId?: number | null;
  messageId?: string | null;
  observedAt?: string;
  labels: string[];
  textSha256?: string | null;
  textPreview?: string | null;
  metadata?: Record<string, unknown>;
};

function mapTrainingPeaksTelegramContextObservationRow(
  row: TrainingPeaksTelegramContextObservationRow
): TrainingPeaksTelegramContextObservation {
  return {
    id: row.id,
    studentId: row.student_id,
    sourceType: row.source_type as TrainingPeaksTelegramContextSourceType,
    chatId: row.chat_id,
    messageThreadId: row.message_thread_id,
    messageId: row.message_id,
    observedAt: row.observed_at,
    labels: Array.isArray(row.labels) ? row.labels.map(String) : [],
    textSha256: row.text_sha256,
    textPreview: row.text_preview,
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {},
    createdAt: row.created_at,
  };
}

export async function insertTrainingPeaksTelegramContextObservation(
  input: InsertTrainingPeaksTelegramContextObservationInput
): Promise<TrainingPeaksTelegramContextObservation> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_telegram_context_observations")
    .insert({
      student_id: input.studentId,
      source_type: input.sourceType,
      chat_id: input.chatId,
      message_thread_id: input.messageThreadId ?? null,
      message_id: input.messageId ?? null,
      observed_at: input.observedAt ?? new Date().toISOString(),
      labels: input.labels,
      text_sha256: input.textSha256 ?? null,
      text_preview: input.textPreview ?? null,
      metadata: input.metadata ?? {},
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to insert TrainingPeaks telegram context observation: ${error.message}`);
  }

  let contactSource: TrainingPeaksStudentContactEventSource | null = null;

  if (input.studentId && input.sourceType === "private_dm") {
    contactSource = "telegram_private_dm";
  } else if (input.studentId && input.sourceType === "group_topic") {
    contactSource = "telegram_group_topic";
  } else if (
    input.studentId &&
    input.sourceType === "group_general" &&
    input.metadata?.senderMatchMethod === "telegram_chat_id" &&
    input.metadata?.senderRole === "known_student"
  ) {
    contactSource = "telegram_group_general";
  }

  if (contactSource) {
    const contactStudentId = input.studentId;

    if (!contactStudentId) {
      return mapTrainingPeaksTelegramContextObservationRow(
        data as TrainingPeaksTelegramContextObservationRow
      );
    }

    try {
      await recordTrainingPeaksStudentContactEvent({
        studentId: contactStudentId,
        eventType: "athlete_message",
        source: contactSource,
        occurredAt: input.observedAt,
        referenceId: input.messageId ?? null,
        metadata: {
          chat_id: input.chatId,
          message_id: input.messageId ?? null,
          message_thread_id: input.messageThreadId ?? null,
        },
      });
    } catch (contactError) {
      console.warn("Failed to record TrainingPeaks contact event from context observation", {
        studentId: input.studentId,
        sourceType: input.sourceType,
        chatId: input.chatId,
        messageId: input.messageId ?? null,
        error: contactError,
      });
    }
  }

  return mapTrainingPeaksTelegramContextObservationRow(
    data as TrainingPeaksTelegramContextObservationRow
  );
}

export async function listTrainingPeaksTelegramContextObservationsForStudent(
  studentId: string,
  limit = 10
): Promise<TrainingPeaksTelegramContextObservation[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_telegram_context_observations")
    .select("*")
    .eq("student_id", studentId)
    .order("observed_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(
      `Failed to list TrainingPeaks telegram context observations for student ${studentId}: ${error.message}`
    );
  }

  return ((data as TrainingPeaksTelegramContextObservationRow[]) ?? []).map(
    mapTrainingPeaksTelegramContextObservationRow
  );
}

/**
 * Read-only helper used by the multi-message move-intent context assembly. Returns
 * only the minimal safe fields needed by the assembler so we never widen access
 * to raw athlete text or hashes from runtime code.
 *
 * NOTE: We do not filter by sender role at the SQL layer because the
 * observation rows do not reliably encode "incoming athlete" vs other sender
 * roles for every source type. For the runtime caller (Telegram Business DM
 * handler) the chat_id is the athlete's own chat, which is the desired scope.
 */
export async function listRecentTrainingPeaksTelegramContextObservationsForChat(input: {
  telegramChatId: string;
  sinceMinutes?: number;
  limit?: number;
}): Promise<
  Array<{
    messageId: string | null;
    textPreview: string | null;
    labels: string[];
    observedAt: string;
  }>
> {
  const safeLimit = Math.max(1, Math.min(input.limit ?? 5, 5));
  const sinceMinutes = Math.max(1, Math.min(input.sinceMinutes ?? 3, 5));
  const sinceIso = new Date(Date.now() - sinceMinutes * 60_000).toISOString();

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_telegram_context_observations")
    .select("message_id, text_preview, labels, observed_at")
    .eq("chat_id", input.telegramChatId)
    .gte("observed_at", sinceIso)
    .order("observed_at", { ascending: false })
    .limit(safeLimit);

  if (error) {
    throw new Error(
      `Failed to list recent TrainingPeaks telegram context observations for chat ${input.telegramChatId}: ${error.message}`
    );
  }

  const rows = (data as Array<{
    message_id: string | null;
    text_preview: string | null;
    labels: unknown;
    observed_at: string;
  }>) ?? [];

  return rows.map((row) => ({
    messageId: row.message_id,
    textPreview: row.text_preview,
    labels: Array.isArray(row.labels) ? row.labels.map(String) : [],
    observedAt: row.observed_at,
  }));
}

/**
 * Lookup helper used to dedupe pending coach-gated move actions that may
 * otherwise be created twice in the same multi-bubble burst.
 */
export async function listRecentPendingTrainingPeaksMoveActionsForStudentChat(input: {
  studentId: string;
  sourceChatId: string;
  sinceMinutes?: number;
}): Promise<TrainingPeaksAction[]> {
  const sinceMinutes = Math.max(1, Math.min(input.sinceMinutes ?? 10, 60));
  const sinceIso = new Date(Date.now() - sinceMinutes * 60_000).toISOString();

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_actions")
    .select("*")
    .eq("action_type", "move_workout")
    .eq("status", "pending_coach")
    .eq("student_id", input.studentId)
    .eq("source_chat_id", input.sourceChatId)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) {
    throw new Error(
      `Failed to list recent pending TrainingPeaks move actions for student ${input.studentId} chat ${input.sourceChatId}: ${error.message}`
    );
  }

  return ((data as TrainingPeaksActionRow[]) ?? []).map(mapTrainingPeaksActionRow);
}

export async function findTrainingPeaksMoveActionBySourceMessageAndDates(input: {
  studentId: string;
  sourceChatId: string;
  sourceMessageId: string;
  sourceDate: string;
  targetDate: string;
}): Promise<TrainingPeaksAction | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_actions")
    .select("*")
    .eq("action_type", "move_workout")
    .eq("student_id", input.studentId)
    .eq("source_chat_id", input.sourceChatId)
    .eq("source_message_id", input.sourceMessageId)
    .eq("parsed_payload->>sourceDate", input.sourceDate)
    .eq("parsed_payload->target->>value", input.targetDate)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to find TrainingPeaks move action by source message/date pair ${input.studentId}/${input.sourceChatId}/${input.sourceMessageId}: ${error.message}`
    );
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksActionRow(data as TrainingPeaksActionRow);
}

export async function hasTrainingPeaksTelegramContextObservationForChatTextHash(
  chatId: string,
  textSha256: string
): Promise<boolean> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_telegram_context_observations")
    .select("id")
    .eq("chat_id", chatId)
    .eq("text_sha256", textSha256)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to check TrainingPeaks telegram context observation dedupe: ${error.message}`
    );
  }

  return Boolean(data);
}

export async function getTrainingPeaksTelegramContextObservationByChatMessage(input: {
  chatId: string;
  messageId: string;
}): Promise<{ id: string } | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_telegram_context_observations")
    .select("id")
    .eq("chat_id", input.chatId)
    .eq("message_id", input.messageId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to get TrainingPeaks context observation by chat/message ${input.chatId}/${input.messageId}: ${error.message}`
    );
  }

  if (!data) {
    return null;
  }

  return { id: (data as { id: string }).id };
}

export async function updateTrainingPeaksStudentTelegramContextById(
  id: string,
  input: UpdateTrainingPeaksStudentTelegramContextInput
): Promise<TrainingPeaksStudent> {
  const updates = pickDefinedValues({
    telegram_formality: input.telegramFormality,
    telegram_context_notes: input.telegramContextNotes,
  });

  if (Object.keys(updates).length === 0) {
    const existingStudent = await getTrainingPeaksStudentById(id);

    if (!existingStudent) {
      throw new Error(`Failed to update TrainingPeaks student telegram context ${id}: student not found`);
    }

    return existingStudent;
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to update TrainingPeaks student telegram context ${id}: ${error.message}`);
  }

  return mapTrainingPeaksStudentRow(data as TrainingPeaksStudentRow);
}

export type TrainingPeaksMessageIntentLogStatus =
  | "action_created"
  | "unrecognized"
  | "ignored"
  | "student_not_found"
  | "parse_failed"
  | "needs_review";

export type TrainingPeaksMessageIntentLog = {
  id: string;
  createdAt: string;
  source: string;
  studentId: string | null;
  telegramChatId: string | null;
  telegramUserId: string | null;
  telegramMessageId: string | null;
  businessConnectionId: string | null;
  messageThreadId: number | null;
  rawText: string | null;
  textPreview: string | null;
  textSha256: string | null;
  normalizedText: string | null;
  ruleIntent: Record<string, unknown> | null;
  ruleConfidence: number | null;
  aiIntent: Record<string, unknown> | null;
  aiConfidence: number | null;
  finalIntent: Record<string, unknown> | null;
  status: TrainingPeaksMessageIntentLogStatus;
  actionId: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
};

type TrainingPeaksMessageIntentLogRow = {
  id: string;
  created_at: string;
  source: string;
  student_id: string | null;
  telegram_chat_id: string | null;
  telegram_user_id: string | null;
  telegram_message_id: string | null;
  business_connection_id: string | null;
  message_thread_id: number | null;
  raw_text: string | null;
  text_preview: string | null;
  text_sha256: string | null;
  normalized_text: string | null;
  rule_intent: unknown;
  rule_confidence: number | null;
  ai_intent: unknown;
  ai_confidence: number | null;
  final_intent: unknown;
  status: string;
  action_id: string | null;
  reason: string | null;
  metadata: unknown;
};

export type InsertTrainingPeaksMessageIntentLogInput = {
  source?: string;
  studentId?: string | null;
  telegramChatId?: string | null;
  telegramUserId?: string | null;
  telegramMessageId?: string | null;
  businessConnectionId?: string | null;
  messageThreadId?: number | null;
  rawText?: string | null;
  textPreview?: string | null;
  textSha256?: string | null;
  normalizedText?: string | null;
  ruleIntent?: Record<string, unknown> | null;
  ruleConfidence?: number | null;
  aiIntent?: Record<string, unknown> | null;
  aiConfidence?: number | null;
  finalIntent?: Record<string, unknown> | null;
  status: TrainingPeaksMessageIntentLogStatus;
  actionId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
};

export type TrainingPeaksStudentMemoryType =
  | "communication_style"
  | "schedule_constraint"
  | "availability_preference"
  | "pain_or_injury"
  | "health_status"
  | "emotional_state"
  | "load_tolerance"
  | "planning_preference"
  | "race_or_goal"
  | "travel_or_life_event"
  | "equipment_or_device_note";

export type TrainingPeaksStudentMemorySource =
  | "ai_extraction"
  | "coach_manual"
  | "system"
  | "observation_import"
  | "telegram_command";

export type TrainingPeaksStudentMemoryItem = {
  id: string;
  studentId: string;
  memoryType: TrainingPeaksStudentMemoryType;
  summaryText: string;
  structured: Record<string, unknown>;
  source: TrainingPeaksStudentMemorySource;
  confidence: number | null;
  validFrom: string | null;
  validUntil: string | null;
  isActive: boolean;
  supersededBy: string | null;
  sourceObservationId: string | null;
  sourceMessagePreview: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type TrainingPeaksStudentMemoryItemRow = {
  id: string;
  student_id: string;
  memory_type: string;
  summary_text: string;
  structured: unknown;
  source: string;
  confidence: number | null;
  valid_from: string | null;
  valid_until: string | null;
  is_active: boolean;
  superseded_by: string | null;
  source_observation_id: string | null;
  source_message_preview: string | null;
  first_seen_at: string;
  last_seen_at: string;
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

export type InsertTrainingPeaksStudentMemoryItemInput = {
  studentId: string;
  memoryType: TrainingPeaksStudentMemoryType;
  summaryText: string;
  structured?: Record<string, unknown>;
  source?: TrainingPeaksStudentMemorySource;
  confidence?: number | null;
  validFrom?: string | null;
  validUntil?: string | null;
  isActive?: boolean;
  supersededBy?: string | null;
  sourceObservationId?: string | null;
  sourceMessagePreview?: string | null;
  firstSeenAt?: string;
  lastSeenAt?: string;
  metadata?: Record<string, unknown>;
};

export type UpdateTrainingPeaksStudentMemoryItemInput = {
  summaryText?: string;
  structured?: Record<string, unknown>;
  source?: TrainingPeaksStudentMemorySource;
  confidence?: number | null;
  validFrom?: string | null;
  validUntil?: string | null;
  isActive?: boolean;
  supersededBy?: string | null;
  sourceObservationId?: string | null;
  sourceMessagePreview?: string | null;
  lastSeenAt?: string;
  metadata?: Record<string, unknown>;
};

export type ListTrainingPeaksStudentMemoryItemsOptions = {
  includeExpired?: boolean;
  memoryTypes?: readonly TrainingPeaksStudentMemoryType[];
  asOfDate?: string;
  limit?: number;
};

export type ListTrainingPeaksStudentMemoryItemsForStudentsOptions =
  ListTrainingPeaksStudentMemoryItemsOptions & {
    activeOnly?: boolean;
  };

export type InsertTrainingPeaksStudentContextSnapshotInput = {
  studentId: string | null;
  sourceIntentLogId?: string | null;
  cacheStatus: TrainingPeaksStudentContextCacheStatus;
  silenceDays?: number | null;
  lastCoachTouchAt?: string | null;
  unansweredSeconds?: number | null;
  recoveryAlertKind?: TrainingPeaksRecoveryAlertKind | null;
  missedPlannedDates?: string[] | null;
  labelSummary?: Record<string, boolean>;
};

export type InsertTrainingPeaksCoachCaseInput = {
  studentId: string;
  caseKind: TrainingPeaksCoachCaseKind;
  intentLogId?: string | null;
  actionId?: string | null;
  contextObsId?: string | null;
  snapshotId?: string | null;
  telegramChatId?: string | null;
  telegramMessageId?: number | null;
  status?: TrainingPeaksCoachCaseStatus;
  coachNotesJson?: Record<string, unknown> | null;
};

export type TrainingPeaksCoachCaseSummary = {
  id: string;
  studentId: string;
  caseKind: TrainingPeaksCoachCaseKind;
  status: TrainingPeaksCoachCaseStatus;
  createdAt: string;
  updatedAt: string;
};

export type TrainingPeaksCoachCase = TrainingPeaksCoachCaseSummary & {
  telegramChatId: string | null;
  telegramMessageId: number | null;
  actionId: string | null;
  coachNotesJson: Record<string, unknown>;
};

export type TrainingPeaksStudentOperationalSignal = {
  id: string;
  studentId: string;
  signalType: TrainingPeaksOperationalSignalType;
  status: TrainingPeaksOperationalSignalStatus;
  sourceType: string;
  sourceObservationId: string | null;
  telegramChatId: number | null;
  telegramMessageId: number | null;
  telegramMessageThreadId: number | null;
  structuredPayload: Record<string, unknown>;
  confidence: number | null;
  validFrom: string | null;
  validUntil: string | null;
  sourceDate: string | null;
  targetDate: string | null;
  sourceDay: string | null;
  targetDay: string | null;
  linkedMemoryItemId: string | null;
  linkedCaseId: string | null;
  linkedActionId: string | null;
  dedupeKey: string;
  consumedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type TrainingPeaksCoachCaseSummaryRow = {
  id: string;
  student_id: string;
  case_kind: TrainingPeaksCoachCaseKind;
  status: TrainingPeaksCoachCaseStatus;
  created_at: string;
  updated_at: string;
};

type TrainingPeaksCoachCaseRow = TrainingPeaksCoachCaseSummaryRow & {
  telegram_chat_id: string | null;
  telegram_message_id: number | null;
  action_id: string | null;
  coach_notes_json: unknown | null;
};

type TrainingPeaksStudentOperationalSignalRow = {
  id: string;
  student_id: string;
  signal_type: string;
  status: string;
  source_type: string;
  source_observation_id: string | null;
  telegram_chat_id: number | null;
  telegram_message_id: number | null;
  telegram_message_thread_id: number | null;
  structured_payload: unknown;
  confidence: number | null;
  valid_from: string | null;
  valid_until: string | null;
  source_date: string | null;
  target_date: string | null;
  source_day: string | null;
  target_day: string | null;
  linked_memory_item_id: string | null;
  linked_case_id: string | null;
  linked_action_id: string | null;
  dedupe_key: string;
  consumed_at: string | null;
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

export type ListTrainingPeaksOperationalSignalsInput = {
  limit?: number;
  offset?: number;
  status?: TrainingPeaksOperationalSignalStatus;
  studentQuery?: string | null;
  signalType?: TrainingPeaksOperationalSignalType;
};

export type UpsertTrainingPeaksOperationalSignalFromCandidateInput = {
  studentId: string;
  signalType: TrainingPeaksOperationalSignalType;
  sourceType: string;
  sourceObservationId?: string | null;
  telegramChatId?: number | null;
  telegramMessageId?: number | null;
  telegramMessageThreadId?: number | null;
  structuredPayload?: Record<string, unknown>;
  confidence?: number | null;
  validFrom?: string | null;
  validUntil?: string | null;
  sourceDate?: string | null;
  targetDate?: string | null;
  sourceDay?: string | null;
  targetDay?: string | null;
  linkedMemoryItemId?: string | null;
  linkedCaseId?: string | null;
  linkedActionId?: string | null;
  dedupeKey: string;
  metadata?: Record<string, unknown>;
};

export type UpsertTrainingPeaksOperationalSignalWriteStatus =
  | "inserted"
  | "existing"
  | "updated";

export type UpsertTrainingPeaksOperationalSignalFromCandidateResult = {
  writeStatus: UpsertTrainingPeaksOperationalSignalWriteStatus;
  signal: TrainingPeaksStudentOperationalSignal;
};

export type TrainingPeaksCoachCasePrefixLookupResult =
  | { kind: "found"; case: TrainingPeaksCoachCaseSummary }
  | { kind: "not_found" }
  | { kind: "ambiguous" }
  | { kind: "invalid_prefix" };

export type TrainingPeaksReplyDraftSource = "telegram_command" | "attention_digest" | "system";
export type TrainingPeaksReplyDraftOutcome = "generated" | "used" | "edited" | "ignored";

export type InsertTrainingPeaksReplyDraftInput = {
  studentId: string;
  caseId?: string | null;
  source?: TrainingPeaksReplyDraftSource;
  actorTelegramChatId?: string | null;
  aiModel: string;
  promptContextSha256: string;
  studentMessageSha256: string;
  studentMessagePreview?: string | null;
  draftSha256: string;
  draftText: string;
  draftPreview?: string | null;
  draftCharCount?: number;
  metadata?: Record<string, unknown>;
  createdAt?: string;
};

export type TrainingPeaksReplyDraft = {
  id: string;
  studentId: string;
  caseId: string | null;
  source: TrainingPeaksReplyDraftSource;
  actorTelegramChatId: string | null;
  aiModel: string;
  promptContextSha256: string;
  studentMessageSha256: string;
  studentMessagePreview: string | null;
  draftSha256: string;
  draftText: string | null;
  draftPreview: string | null;
  draftCharCount: number;
  outcome: TrainingPeaksReplyDraftOutcome;
  outcomeRecordedAt: string | null;
  coachNotePreview: string | null;
  coachNoteSha256: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type TrainingPeaksReplyDraftRow = {
  id: string;
  student_id: string;
  case_id: string | null;
  source: TrainingPeaksReplyDraftSource;
  actor_telegram_chat_id: string | null;
  ai_model: string;
  prompt_context_sha256: string;
  student_message_sha256: string;
  student_message_preview: string | null;
  draft_sha256: string;
  draft_text: string | null;
  draft_preview: string | null;
  draft_char_count: number;
  outcome: TrainingPeaksReplyDraftOutcome;
  outcome_recorded_at: string | null;
  coach_note_preview: string | null;
  coach_note_sha256: string | null;
  metadata: unknown;
  created_at: string;
};

export type UpdateTrainingPeaksReplyDraftOutcomeInput = {
  draftId: string;
  outcome: Extract<TrainingPeaksReplyDraftOutcome, "used" | "edited" | "ignored">;
  coachNote?: string | null;
  outcomeRecordedAt?: string;
};

export type MarkTrainingPeaksReplyDraftSendOutcomeInput = {
  draftId: string;
  sendStatus: "sent" | "failed";
  deliveredChunks?: number;
  errorClass?: string;
  errorPreview?: string;
  actorTelegramChatId?: string | null;
};

export type InsertTrainingPeaksCoachActionTakenInput = {
  caseId?: string | null;
  studentId?: string | null;
  actionKind: TrainingPeaksCoachActionKind;
  source: TrainingPeaksCoachActionSource;
  actorTelegramChatId?: string | null;
  note?: string | null;
  metadata?: Record<string, unknown>;
  createdAt?: string;
};

export type TrainingPeaksCoachActionTaken = {
  id: string;
  caseId: string | null;
  studentId: string | null;
  actionKind: TrainingPeaksCoachActionKind;
  source: TrainingPeaksCoachActionSource;
  actorTelegramChatId: string | null;
  notePreview: string | null;
  noteSha256: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type TrainingPeaksCoachActionTakenRow = {
  id: string;
  case_id: string | null;
  student_id: string | null;
  action_kind: TrainingPeaksCoachActionKind;
  source: TrainingPeaksCoachActionSource;
  actor_telegram_chat_id: string | null;
  note_preview: string | null;
  note_sha256: string | null;
  metadata: unknown;
  created_at: string;
};

function mapTrainingPeaksMessageIntentLogRow(
  row: TrainingPeaksMessageIntentLogRow
): TrainingPeaksMessageIntentLog {
  return {
    id: row.id,
    createdAt: row.created_at,
    source: row.source,
    studentId: row.student_id,
    telegramChatId: row.telegram_chat_id,
    telegramUserId: row.telegram_user_id,
    telegramMessageId: row.telegram_message_id,
    businessConnectionId: row.business_connection_id,
    messageThreadId: row.message_thread_id,
    rawText: row.raw_text,
    textPreview: row.text_preview,
    textSha256: row.text_sha256,
    normalizedText: row.normalized_text,
    ruleIntent:
      row.rule_intent && typeof row.rule_intent === "object" && !Array.isArray(row.rule_intent)
        ? (row.rule_intent as Record<string, unknown>)
        : null,
    ruleConfidence: row.rule_confidence,
    aiIntent:
      row.ai_intent && typeof row.ai_intent === "object" && !Array.isArray(row.ai_intent)
        ? (row.ai_intent as Record<string, unknown>)
        : null,
    aiConfidence: row.ai_confidence,
    finalIntent:
      row.final_intent && typeof row.final_intent === "object" && !Array.isArray(row.final_intent)
        ? (row.final_intent as Record<string, unknown>)
        : null,
    status: row.status as TrainingPeaksMessageIntentLogStatus,
    actionId: row.action_id,
    reason: row.reason,
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {},
  };
}

function mapTrainingPeaksStudentMemoryItemRow(
  row: TrainingPeaksStudentMemoryItemRow
): TrainingPeaksStudentMemoryItem {
  return {
    id: row.id,
    studentId: row.student_id,
    memoryType: row.memory_type as TrainingPeaksStudentMemoryType,
    summaryText: row.summary_text,
    structured:
      row.structured && typeof row.structured === "object" && !Array.isArray(row.structured)
        ? (row.structured as Record<string, unknown>)
        : {},
    source: row.source as TrainingPeaksStudentMemorySource,
    confidence: row.confidence,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    isActive: row.is_active,
    supersededBy: row.superseded_by,
    sourceObservationId: row.source_observation_id,
    sourceMessagePreview: row.source_message_preview,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeTrainingPeaksMemoryReferenceDate(referenceDate?: string): string {
  const normalized = referenceDate?.trim() ?? "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }
  return new Date().toISOString().slice(0, 10);
}

function normalizeTrainingPeaksCoachActionNote(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized ? normalized : null;
}

function buildTrainingPeaksCoachActionNotePreview(value: string | null | undefined): string | null {
  const normalized = normalizeTrainingPeaksCoachActionNote(value);
  if (!normalized) {
    return null;
  }

  if (normalized.length <= 120) {
    return normalized;
  }

  return `${normalized.slice(0, 119)}…`;
}

function sha256TrainingPeaksCoachActionNote(value: string | null | undefined): string | null {
  const normalized = normalizeTrainingPeaksCoachActionNote(value);
  if (!normalized) {
    return null;
  }

  return createHash("sha256").update(normalized).digest("hex");
}

function buildTrainingPeaksReplyDraftPreview(
  value: string | null | undefined,
  maxLength: number
): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function mapTrainingPeaksCoachCaseSummaryRow(
  row: TrainingPeaksCoachCaseSummaryRow
): TrainingPeaksCoachCaseSummary {
  return {
    id: row.id,
    studentId: row.student_id,
    caseKind: row.case_kind,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTrainingPeaksCoachCaseRow(row: TrainingPeaksCoachCaseRow): TrainingPeaksCoachCase {
  return {
    ...mapTrainingPeaksCoachCaseSummaryRow(row),
    telegramChatId: row.telegram_chat_id,
    telegramMessageId: row.telegram_message_id,
    actionId: row.action_id,
    coachNotesJson:
      row.coach_notes_json && typeof row.coach_notes_json === "object" && !Array.isArray(row.coach_notes_json)
        ? (row.coach_notes_json as Record<string, unknown>)
        : {},
  };
}

function mapTrainingPeaksStudentOperationalSignalRow(
  row: TrainingPeaksStudentOperationalSignalRow
): TrainingPeaksStudentOperationalSignal {
  return {
    id: row.id,
    studentId: row.student_id,
    signalType: row.signal_type as TrainingPeaksOperationalSignalType,
    status: row.status as TrainingPeaksOperationalSignalStatus,
    sourceType: row.source_type,
    sourceObservationId: row.source_observation_id,
    telegramChatId: row.telegram_chat_id,
    telegramMessageId: row.telegram_message_id,
    telegramMessageThreadId: row.telegram_message_thread_id,
    structuredPayload:
      row.structured_payload &&
      typeof row.structured_payload === "object" &&
      !Array.isArray(row.structured_payload)
        ? (row.structured_payload as Record<string, unknown>)
        : {},
    confidence: row.confidence,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    sourceDate: row.source_date,
    targetDate: row.target_date,
    sourceDay: row.source_day,
    targetDay: row.target_day,
    linkedMemoryItemId: row.linked_memory_item_id,
    linkedCaseId: row.linked_case_id,
    linkedActionId: row.linked_action_id,
    dedupeKey: row.dedupe_key,
    consumedAt: row.consumed_at,
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const TRAININGPEAKS_OPERATIONAL_SIGNAL_TYPE_SET: Set<TrainingPeaksOperationalSignalType> =
  new Set<TrainingPeaksOperationalSignalType>([
    "schedule_availability_window",
    "schedule_unavailability_window",
    "resume_training",
    "pause_training",
    "health_issue_started",
    "health_issue_resolved",
    "health_issue_improving",
    "move_workout_candidate",
    "plan_generation_constraint",
    "pain_injury",
    "external_training_context",
    "race_load_context",
  ]);

const TRAININGPEAKS_OPERATIONAL_SIGNAL_STATUS_SET: Set<TrainingPeaksOperationalSignalStatus> =
  new Set<TrainingPeaksOperationalSignalStatus>([
    "active",
    "consumed",
    "expired",
    "cancelled",
    "dismissed",
  ]);

function normalizeTrainingPeaksOperationalSignalType(
  value: string
): TrainingPeaksOperationalSignalType {
  const normalized = value.trim().toLowerCase() as TrainingPeaksOperationalSignalType;
  if (!TRAININGPEAKS_OPERATIONAL_SIGNAL_TYPE_SET.has(normalized)) {
    throw new Error(`Unsupported TrainingPeaks operational signal type: ${value}`);
  }
  return normalized;
}

function normalizeTrainingPeaksOperationalSignalStatus(
  value: string | null | undefined
): TrainingPeaksOperationalSignalStatus {
  const normalized = (value?.trim().toLowerCase() || "active") as TrainingPeaksOperationalSignalStatus;
  if (!TRAININGPEAKS_OPERATIONAL_SIGNAL_STATUS_SET.has(normalized)) {
    throw new Error(`Unsupported TrainingPeaks operational signal status: ${String(value)}`);
  }
  return normalized;
}

function normalizeTrainingPeaksOperationalSignalSourceType(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    throw new Error("TrainingPeaks operational signal source_type is required");
  }
  return normalized;
}

function normalizeTrainingPeaksOperationalSignalDedupeKey(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    throw new Error("TrainingPeaks operational signal dedupe_key is required");
  }
  return normalized;
}

function normalizeTrainingPeaksOperationalSignalDate(
  value: string | null | undefined
): string | null {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function normalizeTrainingPeaksOperationalSignalDay(
  value: string | null | undefined
): string | null {
  const normalized = value?.trim() ?? "";
  return normalized ? normalized : null;
}

function normalizeTrainingPeaksOperationalSignalConfidence(
  value: number | null | undefined
): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!Number.isFinite(value)) {
    return null;
  }
  const bounded = Math.max(0, Math.min(1, value));
  return Number(bounded.toFixed(3));
}

function isTrainingPeaksMissingRelationError(error: {
  code?: string | null;
  message?: string | null;
}): boolean {
  const code = (error.code ?? "").toUpperCase();
  const message = (error.message ?? "").toLowerCase();
  return (
    code === "PGRST205" ||
    code === "42P01" ||
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("could not find the table")
  );
}

function mapTrainingPeaksCoachActionTakenRow(
  row: TrainingPeaksCoachActionTakenRow
): TrainingPeaksCoachActionTaken {
  return {
    id: row.id,
    caseId: row.case_id,
    studentId: row.student_id,
    actionKind: row.action_kind,
    source: row.source,
    actorTelegramChatId: row.actor_telegram_chat_id,
    notePreview: row.note_preview,
    noteSha256: row.note_sha256,
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {},
    createdAt: row.created_at,
  };
}

function mapTrainingPeaksReplyDraftRow(row: TrainingPeaksReplyDraftRow): TrainingPeaksReplyDraft {
  return {
    id: row.id,
    studentId: row.student_id,
    caseId: row.case_id,
    source: row.source,
    actorTelegramChatId: row.actor_telegram_chat_id,
    aiModel: row.ai_model,
    promptContextSha256: row.prompt_context_sha256,
    studentMessageSha256: row.student_message_sha256,
    studentMessagePreview: row.student_message_preview,
    draftSha256: row.draft_sha256,
    draftText: row.draft_text,
    draftPreview: row.draft_preview,
    draftCharCount: row.draft_char_count,
    outcome: row.outcome,
    outcomeRecordedAt: row.outcome_recorded_at,
    coachNotePreview: row.coach_note_preview,
    coachNoteSha256: row.coach_note_sha256,
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {},
    createdAt: row.created_at,
  };
}

export async function insertTrainingPeaksMessageIntentLog(
  input: InsertTrainingPeaksMessageIntentLogInput
): Promise<TrainingPeaksMessageIntentLog | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_message_intent_logs")
    .insert({
      source: input.source ?? "telegram_business",
      student_id: input.studentId ?? null,
      telegram_chat_id: input.telegramChatId ?? null,
      telegram_user_id: input.telegramUserId ?? null,
      telegram_message_id: input.telegramMessageId ?? null,
      business_connection_id: input.businessConnectionId ?? null,
      message_thread_id: input.messageThreadId ?? null,
      raw_text: input.rawText ?? null,
      text_preview: input.textPreview ?? null,
      text_sha256: input.textSha256 ?? null,
      normalized_text: input.normalizedText ?? null,
      rule_intent: input.ruleIntent ?? null,
      rule_confidence: input.ruleConfidence ?? null,
      ai_intent: input.aiIntent ?? null,
      ai_confidence: input.aiConfidence ?? null,
      final_intent: input.finalIntent ?? null,
      status: input.status,
      action_id: input.actionId ?? null,
      reason: input.reason ?? null,
      metadata: input.metadata ?? {},
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      return null;
    }

    throw new Error(`Failed to insert TrainingPeaks message intent log: ${error.message}`);
  }

  return mapTrainingPeaksMessageIntentLogRow(data as TrainingPeaksMessageIntentLogRow);
}

export async function insertTrainingPeaksStudentContextSnapshot(
  input: InsertTrainingPeaksStudentContextSnapshotInput
): Promise<{ id: string }> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_student_context_snapshots")
    .insert({
      student_id: input.studentId,
      source_intent_log_id: input.sourceIntentLogId ?? null,
      cache_status: input.cacheStatus,
      silence_days: input.silenceDays ?? null,
      last_coach_touch_at: input.lastCoachTouchAt ?? null,
      unanswered_seconds: input.unansweredSeconds ?? null,
      recovery_alert_kind: input.recoveryAlertKind ?? null,
      missed_planned_dates: input.missedPlannedDates ?? null,
      label_summary: input.labelSummary ?? {},
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Failed to insert TrainingPeaks student context snapshot: ${error.message}`);
  }

  return data as { id: string };
}

export async function insertTrainingPeaksStudentMemoryItem(
  input: InsertTrainingPeaksStudentMemoryItemInput
): Promise<TrainingPeaksStudentMemoryItem> {
  const supabase = createSupabaseServerClient();
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("trainingpeaks_student_memory_items")
    .insert({
      student_id: input.studentId,
      memory_type: input.memoryType,
      summary_text: input.summaryText,
      structured: input.structured ?? {},
      source: input.source ?? "ai_extraction",
      confidence: input.confidence ?? null,
      valid_from: input.validFrom ?? null,
      valid_until: input.validUntil ?? null,
      is_active: input.isActive ?? true,
      superseded_by: input.supersededBy ?? null,
      source_observation_id: input.sourceObservationId ?? null,
      source_message_preview: input.sourceMessagePreview ?? null,
      first_seen_at: input.firstSeenAt ?? nowIso,
      last_seen_at: input.lastSeenAt ?? nowIso,
      metadata: input.metadata ?? {},
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to insert TrainingPeaks student memory item: ${error.message}`);
  }

  return mapTrainingPeaksStudentMemoryItemRow(data as TrainingPeaksStudentMemoryItemRow);
}

export async function listActiveTrainingPeaksStudentMemoryItems(
  studentId: string,
  options: ListTrainingPeaksStudentMemoryItemsOptions = {}
): Promise<TrainingPeaksStudentMemoryItem[]> {
  const supabase = createSupabaseServerClient();
  const safeLimit = Math.max(1, Math.min(options.limit ?? 200, 1000));
  const asOfDate = normalizeTrainingPeaksMemoryReferenceDate(options.asOfDate);

  let query = supabase
    .from("trainingpeaks_student_memory_items")
    .select("*")
    .eq("student_id", studentId)
    .eq("is_active", true)
    .order("memory_type", { ascending: true })
    .order("last_seen_at", { ascending: false })
    .limit(safeLimit);

  if (!options.includeExpired) {
    query = query.or(`valid_until.is.null,valid_until.gte.${asOfDate}`);
  }
  if (options.memoryTypes && options.memoryTypes.length > 0) {
    query = query.in("memory_type", [...options.memoryTypes]);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to list active TrainingPeaks student memory items: ${error.message}`);
  }

  return ((data as TrainingPeaksStudentMemoryItemRow[]) ?? []).map(mapTrainingPeaksStudentMemoryItemRow);
}

export async function listTrainingPeaksStudentMemoryItemsForStudents(
  studentIds: readonly string[],
  options: ListTrainingPeaksStudentMemoryItemsForStudentsOptions = {}
): Promise<TrainingPeaksStudentMemoryItem[]> {
  const normalizedStudentIds = [...new Set(studentIds.map((value) => value.trim()).filter(Boolean))];
  if (normalizedStudentIds.length === 0) {
    return [];
  }

  const supabase = createSupabaseServerClient();
  const safeLimit = Math.max(1, Math.min(options.limit ?? 2000, 5000));
  const asOfDate = normalizeTrainingPeaksMemoryReferenceDate(options.asOfDate);
  const activeOnly = options.activeOnly ?? true;

  let query = supabase
    .from("trainingpeaks_student_memory_items")
    .select("*")
    .in("student_id", normalizedStudentIds)
    .order("memory_type", { ascending: true })
    .order("last_seen_at", { ascending: false })
    .limit(safeLimit);

  if (activeOnly) {
    query = query.eq("is_active", true);
  }
  if (!options.includeExpired) {
    query = query.or(`valid_until.is.null,valid_until.gte.${asOfDate}`);
  }
  if (options.memoryTypes && options.memoryTypes.length > 0) {
    query = query.in("memory_type", [...options.memoryTypes]);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to list TrainingPeaks student memory items for students: ${error.message}`);
  }

  return ((data as TrainingPeaksStudentMemoryItemRow[]) ?? []).map(mapTrainingPeaksStudentMemoryItemRow);
}

export async function deactivateTrainingPeaksStudentMemoryItem(
  id: string,
  reason?: string
): Promise<TrainingPeaksStudentMemoryItem | null> {
  const normalizedReason = reason?.trim() ?? "";
  const supabase = createSupabaseServerClient();
  const nowIso = new Date().toISOString();
  let metadataToSave: Record<string, unknown> | undefined;

  if (normalizedReason.length > 0) {
    const existing = await supabase
      .from("trainingpeaks_student_memory_items")
      .select("metadata")
      .eq("id", id)
      .maybeSingle();

    if (existing.error) {
      throw new Error(`Failed to load TrainingPeaks student memory metadata ${id}: ${existing.error.message}`);
    }

    if (existing.data) {
      const existingMetadata =
        existing.data.metadata &&
        typeof existing.data.metadata === "object" &&
        !Array.isArray(existing.data.metadata)
          ? (existing.data.metadata as Record<string, unknown>)
          : {};
      metadataToSave = {
        ...existingMetadata,
        deactivated_reason: normalizedReason,
      };
    }
  }

  const updates = pickDefinedValues({
    is_active: false,
    updated_at: nowIso,
    metadata: metadataToSave,
  });

  const { data, error } = await supabase
    .from("trainingpeaks_student_memory_items")
    .update(updates)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to deactivate TrainingPeaks student memory item ${id}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksStudentMemoryItemRow(data as TrainingPeaksStudentMemoryItemRow);
}

export async function supersedeTrainingPeaksStudentMemoryItem(
  oldId: string,
  newId: string
): Promise<TrainingPeaksStudentMemoryItem | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_student_memory_items")
    .update({
      is_active: false,
      superseded_by: newId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", oldId)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to supersede TrainingPeaks student memory item ${oldId}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksStudentMemoryItemRow(data as TrainingPeaksStudentMemoryItemRow);
}

export async function touchTrainingPeaksStudentMemoryItem(
  id: string,
  options?: {
    validUntil?: string | null;
  }
): Promise<TrainingPeaksStudentMemoryItem | null> {
  const nowIso = new Date().toISOString();
  const supabase = createSupabaseServerClient();
  const updates: Record<string, unknown> = {
    last_seen_at: nowIso,
    updated_at: nowIso,
  };
  if (options && "validUntil" in options) {
    updates.valid_until = options.validUntil ?? null;
  }
  const { data, error } = await supabase
    .from("trainingpeaks_student_memory_items")
    .update(updates)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to touch TrainingPeaks student memory item ${id}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksStudentMemoryItemRow(data as TrainingPeaksStudentMemoryItemRow);
}

export async function expireTrainingPeaksStudentMemoryItems(referenceDate?: string): Promise<number> {
  const supabase = createSupabaseServerClient();
  const asOfDate = normalizeTrainingPeaksMemoryReferenceDate(referenceDate);
  const { data, error } = await supabase
    .from("trainingpeaks_student_memory_items")
    .update({
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq("is_active", true)
    .lt("valid_until", asOfDate)
    .select("id");

  if (error) {
    throw new Error(`Failed to expire TrainingPeaks student memory items: ${error.message}`);
  }

  return (data ?? []).length;
}

export async function expireTrainingPeaksOperationalSignals(referenceDate?: string): Promise<number> {
  const supabase = createSupabaseServerClient();
  const asOfDate = normalizeTrainingPeaksMemoryReferenceDate(referenceDate);
  const { data, error } = await supabase
    .from("trainingpeaks_student_operational_signals")
    .update({
      status: "expired",
      updated_at: new Date().toISOString(),
    })
    .neq("status", "expired")
    .not("valid_until", "is", null)
    .lt("valid_until", asOfDate)
    .select("id");

  if (error) {
    throw new Error(`Failed to expire TrainingPeaks operational signals: ${error.message}`);
  }

  return (data ?? []).length;
}

export async function insertTrainingPeaksCoachCase(
  input: InsertTrainingPeaksCoachCaseInput
): Promise<{ id: string } | null> {
  const insertPayload = pickDefinedValues({
    student_id: input.studentId,
    case_kind: input.caseKind,
    intent_log_id: input.intentLogId ?? null,
    action_id: input.actionId ?? null,
    context_obs_id: input.contextObsId ?? null,
    snapshot_id: input.snapshotId ?? null,
    telegram_chat_id: input.telegramChatId ?? null,
    telegram_message_id: input.telegramMessageId ?? null,
    status: input.status,
    coach_notes_json: input.coachNotesJson ?? null,
  });

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_coach_cases")
    .insert(insertPayload)
    .select("id, student_id, case_kind, status, created_at, updated_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return null;
    }

    throw new Error(`Failed to insert TrainingPeaks coach case: ${error.message}`);
  }

  return { id: (data as TrainingPeaksCoachCaseSummaryRow).id };
}

export async function getTrainingPeaksCoachCaseByTelegramMessageAndKind(input: {
  telegramChatId: string;
  telegramMessageId: number;
  caseKind: TrainingPeaksCoachCaseKind;
}): Promise<{ id: string; status: TrainingPeaksCoachCaseStatus } | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_coach_cases")
    .select("id, status")
    .eq("telegram_chat_id", input.telegramChatId)
    .eq("telegram_message_id", input.telegramMessageId)
    .eq("case_kind", input.caseKind)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to get TrainingPeaks coach case by message ${input.telegramChatId}/${input.telegramMessageId}: ${error.message}`
    );
  }

  if (!data) {
    return null;
  }

  const typedRow = data as { id: string; status: TrainingPeaksCoachCaseStatus };
  return {
    id: typedRow.id,
    status: typedRow.status,
  };
}

export async function getTrainingPeaksCoachCaseById(
  caseId: string
): Promise<TrainingPeaksCoachCaseSummary | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_coach_cases")
    .select("id, student_id, case_kind, status, created_at, updated_at")
    .eq("id", caseId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get TrainingPeaks coach case ${caseId}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksCoachCaseSummaryRow(data as TrainingPeaksCoachCaseSummaryRow);
}

export async function getTrainingPeaksCoachCaseDetailsById(
  caseId: string
): Promise<TrainingPeaksCoachCase | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_coach_cases")
    .select("id, student_id, case_kind, status, created_at, updated_at, telegram_chat_id, telegram_message_id, action_id, coach_notes_json")
    .eq("id", caseId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get TrainingPeaks coach case details ${caseId}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksCoachCaseRow(data as TrainingPeaksCoachCaseRow);
}

export async function insertTrainingPeaksReplyDraft(
  input: InsertTrainingPeaksReplyDraftInput
): Promise<TrainingPeaksReplyDraft> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_reply_drafts")
    .insert({
      student_id: input.studentId,
      case_id: input.caseId ?? null,
      source: input.source ?? "telegram_command",
      actor_telegram_chat_id: input.actorTelegramChatId ?? null,
      ai_model: input.aiModel,
      prompt_context_sha256: input.promptContextSha256,
      student_message_sha256: input.studentMessageSha256,
      student_message_preview: buildTrainingPeaksReplyDraftPreview(input.studentMessagePreview ?? null, 80),
      draft_sha256: input.draftSha256,
      draft_text: input.draftText,
      draft_preview: buildTrainingPeaksReplyDraftPreview(input.draftPreview ?? null, 120),
      draft_char_count: Math.max(0, Math.trunc(input.draftCharCount ?? 0)),
      metadata: input.metadata ?? {},
      created_at: input.createdAt ?? new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to insert TrainingPeaks reply draft: ${error.message}`);
  }

  return mapTrainingPeaksReplyDraftRow(data as TrainingPeaksReplyDraftRow);
}

export async function getTrainingPeaksReplyDraftByIdPrefix(
  draftIdPrefix: string
): Promise<TrainingPeaksReplyDraft | null> {
  const normalizedPrefix = normalizeTrainingPeaksReplyDraftIdPrefix(draftIdPrefix);
  if (!normalizedPrefix) {
    return null;
  }

  const minUuid = formatTrainingPeaksUuidFromHex32(normalizedPrefix.padEnd(32, "0"));
  const maxUuid = formatTrainingPeaksUuidFromHex32(normalizedPrefix.padEnd(32, "f"));

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_reply_drafts")
    .select("*")
    .gte("id", minUuid)
    .lte("id", maxUuid)
    .order("created_at", { ascending: false })
    .limit(2);

  if (error) {
    throw new Error(
      `Failed to get TrainingPeaks reply draft by prefix ${normalizedPrefix}: ${error.message}`
    );
  }

  const rows = (data as TrainingPeaksReplyDraftRow[] | null) ?? [];
  if (rows.length !== 1) {
    return null;
  }

  return mapTrainingPeaksReplyDraftRow(rows[0]);
}

export async function updateTrainingPeaksReplyDraftOutcome(
  input: UpdateTrainingPeaksReplyDraftOutcomeInput
): Promise<TrainingPeaksReplyDraft | null> {
  const normalizedNote = normalizeTrainingPeaksCoachActionNote(input.coachNote);
  const updates = pickDefinedValues({
    outcome: input.outcome,
    outcome_recorded_at: input.outcomeRecordedAt ?? new Date().toISOString(),
    coach_note_preview: buildTrainingPeaksCoachActionNotePreview(normalizedNote),
    coach_note_sha256: sha256TrainingPeaksCoachActionNote(normalizedNote),
  });

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_reply_drafts")
    .update(updates)
    .eq("id", input.draftId)
    .eq("outcome", "generated")
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update TrainingPeaks reply draft ${input.draftId}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksReplyDraftRow(data as TrainingPeaksReplyDraftRow);
}

const TRAININGPEAKS_CASE_ID_PREFIX_HEX_REGEX = /^[0-9a-f]{1,32}$/;

function normalizeTrainingPeaksCoachCaseIdPrefix(caseIdPrefix: string): string | null {
  const normalized = caseIdPrefix.trim().toLowerCase().replace(/-/g, "");
  if (!normalized) {
    return null;
  }

  if (!TRAININGPEAKS_CASE_ID_PREFIX_HEX_REGEX.test(normalized)) {
    return null;
  }

  return normalized;
}

const TRAININGPEAKS_REPLY_DRAFT_ID_PREFIX_HEX_REGEX = /^[0-9a-f]{1,32}$/;

function normalizeTrainingPeaksReplyDraftIdPrefix(draftIdPrefix: string): string | null {
  const normalized = draftIdPrefix.trim().toLowerCase().replace(/-/g, "");
  if (!normalized) {
    return null;
  }

  if (!TRAININGPEAKS_REPLY_DRAFT_ID_PREFIX_HEX_REGEX.test(normalized)) {
    return null;
  }

  return normalized;
}

function formatTrainingPeaksUuidFromHex32(hex32: string): string {
  return `${hex32.slice(0, 8)}-${hex32.slice(8, 12)}-${hex32.slice(12, 16)}-${hex32.slice(16, 20)}-${hex32.slice(20, 32)}`;
}

export async function getTrainingPeaksCoachCaseByIdPrefix(
  caseIdPrefix: string
): Promise<TrainingPeaksCoachCasePrefixLookupResult> {
  const normalizedPrefix = normalizeTrainingPeaksCoachCaseIdPrefix(caseIdPrefix);
  if (!normalizedPrefix) {
    return { kind: "invalid_prefix" };
  }

  const minUuid = formatTrainingPeaksUuidFromHex32(normalizedPrefix.padEnd(32, "0"));
  const maxUuid = formatTrainingPeaksUuidFromHex32(normalizedPrefix.padEnd(32, "f"));

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_coach_cases")
    .select("id, student_id, case_kind, status, created_at, updated_at")
    .gte("id", minUuid)
    .lte("id", maxUuid)
    .order("created_at", { ascending: false })
    .limit(2);

  if (error) {
    throw new Error(`Failed to get TrainingPeaks coach case by prefix ${normalizedPrefix}: ${error.message}`);
  }

  const rows = (data as TrainingPeaksCoachCaseSummaryRow[] | null) ?? [];
  if (rows.length === 0) {
    return { kind: "not_found" };
  }

  if (rows.length > 1) {
    return { kind: "ambiguous" };
  }

  return { kind: "found", case: mapTrainingPeaksCoachCaseSummaryRow(rows[0]) };
}

export async function updateTrainingPeaksCoachCaseStatus(
  caseId: string,
  status: TrainingPeaksCoachCaseStatus,
  actor: string | null
): Promise<TrainingPeaksCoachCaseSummary | null> {
  void actor;
  const updatePayload = pickDefinedValues({
    status,
  });

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_coach_cases")
    .update(updatePayload)
    .eq("id", caseId)
    .in("status", ["logged", "open", "needs_review"])
    .select("id, student_id, case_kind, status, created_at, updated_at")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update TrainingPeaks coach case ${caseId}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksCoachCaseSummaryRow(data as TrainingPeaksCoachCaseSummaryRow);
}

export async function updateTrainingPeaksCoachCaseMetadata(input: {
  caseId: string;
  coachNotesJson: Record<string, unknown>;
}): Promise<TrainingPeaksCoachCase | null> {
  const supabase = createSupabaseServerClient();
  const updatePayload = pickDefinedValues({
    coach_notes_json: input.coachNotesJson,
  });

  const { data, error } = await supabase
    .from("trainingpeaks_coach_cases")
    .update(updatePayload)
    .eq("id", input.caseId)
    .select("id, student_id, case_kind, status, created_at, updated_at, telegram_chat_id, telegram_message_id, action_id, coach_notes_json")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update TrainingPeaks coach case metadata ${input.caseId}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksCoachCaseRow(data as TrainingPeaksCoachCaseRow);
}

export async function insertTrainingPeaksCoachActionTaken(
  input: InsertTrainingPeaksCoachActionTakenInput
): Promise<TrainingPeaksCoachActionTaken> {
  const normalizedNote = normalizeTrainingPeaksCoachActionNote(input.note);
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_coach_actions_taken")
    .insert({
      case_id: input.caseId ?? null,
      student_id: input.studentId ?? null,
      action_kind: input.actionKind,
      source: input.source,
      actor_telegram_chat_id: input.actorTelegramChatId ?? null,
      note_preview: buildTrainingPeaksCoachActionNotePreview(normalizedNote),
      note_sha256: sha256TrainingPeaksCoachActionNote(normalizedNote),
      metadata: input.metadata ?? {},
      created_at: input.createdAt ?? new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to insert TrainingPeaks coach action taken: ${error.message}`);
  }

  return mapTrainingPeaksCoachActionTakenRow(data as TrainingPeaksCoachActionTakenRow);
}

export async function listTrainingPeaksOperationalSignals(
  input: ListTrainingPeaksOperationalSignalsInput = {}
): Promise<{ items: TrainingPeaksStudentOperationalSignal[]; total: number }> {
  const safeLimit = Math.max(1, Math.min(input.limit ?? 50, 200));
  const safeOffset = Math.max(0, Math.trunc(input.offset ?? 0));
  const normalizedStudentQuery = input.studentQuery?.trim() ?? "";
  const supabase = createSupabaseServerClient();

  let studentIdFilter: string[] | null = null;
  if (normalizedStudentQuery.length > 0) {
    const { data: matchedStudents, error: studentsError } = await supabase
      .from("trainingpeaks_students")
      .select("id")
      .or(
        `student_name.ilike.%${normalizedStudentQuery}%,student_id.ilike.%${normalizedStudentQuery}%`
      )
      .limit(200);
    if (studentsError) {
      throw new Error(
        `Failed to filter TrainingPeaks operational signals by student: ${studentsError.message}`
      );
    }
    studentIdFilter = ((matchedStudents as Array<{ id: string }> | null) ?? [])
      .map((row) => row.id)
      .filter(Boolean);
    if (studentIdFilter.length === 0) {
      return { items: [], total: 0 };
    }
  }

  let query = supabase
    .from("trainingpeaks_student_operational_signals")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(safeOffset, safeOffset + safeLimit - 1);

  if (input.status) {
    query = query.eq(
      "status",
      normalizeTrainingPeaksOperationalSignalStatus(input.status)
    );
  }
  if (input.signalType) {
    query = query.eq(
      "signal_type",
      normalizeTrainingPeaksOperationalSignalType(input.signalType)
    );
  }
  if (studentIdFilter && studentIdFilter.length > 0) {
    query = query.in("student_id", studentIdFilter);
  }

  const { data, error, count } = await query;
  if (error) {
    if (isTrainingPeaksMissingRelationError(error)) {
      return { items: [], total: 0 };
    }
    throw new Error(`Failed to list TrainingPeaks operational signals: ${error.message}`);
  }

  const rows = (data as TrainingPeaksStudentOperationalSignalRow[] | null) ?? [];
  return {
    items: rows.map(mapTrainingPeaksStudentOperationalSignalRow),
    total: count ?? rows.length,
  };
}

export async function upsertTrainingPeaksOperationalSignalFromCandidate(
  input: UpsertTrainingPeaksOperationalSignalFromCandidateInput
): Promise<UpsertTrainingPeaksOperationalSignalFromCandidateResult> {
  const normalizedSignalType = normalizeTrainingPeaksOperationalSignalType(input.signalType);

  const normalizedSourceType = normalizeTrainingPeaksOperationalSignalSourceType(input.sourceType);
  const normalizedDedupeKey = normalizeTrainingPeaksOperationalSignalDedupeKey(input.dedupeKey);
  const normalizedStatus: TrainingPeaksOperationalSignalStatus = "active";
  const payload = pickDefinedValues({
    student_id: input.studentId,
    signal_type: normalizedSignalType,
    status: normalizedStatus,
    source_type: normalizedSourceType,
    source_observation_id: input.sourceObservationId ?? null,
    telegram_chat_id: input.telegramChatId ?? null,
    telegram_message_id: input.telegramMessageId ?? null,
    telegram_message_thread_id: input.telegramMessageThreadId ?? null,
    structured_payload: input.structuredPayload ?? {},
    confidence: normalizeTrainingPeaksOperationalSignalConfidence(input.confidence),
    valid_from: normalizeTrainingPeaksOperationalSignalDate(input.validFrom),
    valid_until: normalizeTrainingPeaksOperationalSignalDate(input.validUntil),
    source_date: normalizeTrainingPeaksOperationalSignalDate(input.sourceDate),
    target_date: normalizeTrainingPeaksOperationalSignalDate(input.targetDate),
    source_day: normalizeTrainingPeaksOperationalSignalDay(input.sourceDay),
    target_day: normalizeTrainingPeaksOperationalSignalDay(input.targetDay),
    linked_memory_item_id: input.linkedMemoryItemId ?? null,
    linked_case_id: input.linkedCaseId ?? null,
    linked_action_id: input.linkedActionId ?? null,
    dedupe_key: normalizedDedupeKey,
    metadata: input.metadata ?? {},
  });

  const supabase = createSupabaseServerClient();
  const existingQuery = supabase
    .from("trainingpeaks_student_operational_signals")
    .select("*")
    .eq("student_id", input.studentId)
    .eq("signal_type", normalizedSignalType)
    .eq("dedupe_key", normalizedDedupeKey)
    .order("created_at", { ascending: false })
    .limit(1);
  const existingScoped =
    input.sourceObservationId && input.sourceObservationId.trim().length > 0
      ? existingQuery.eq("source_observation_id", input.sourceObservationId)
      : existingQuery.is("source_observation_id", null);

  const existingResult = await existingScoped.maybeSingle();
  if (existingResult.error) {
    if (isTrainingPeaksMissingRelationError(existingResult.error)) {
      throw new Error(
        "trainingpeaks_student_operational_signals table is missing; apply Supabase migration first"
      );
    }
    throw new Error(
      `Failed to lookup existing TrainingPeaks operational signal candidate: ${existingResult.error.message}`
    );
  }

  const existing = existingResult.data as TrainingPeaksStudentOperationalSignalRow | null;
  if (!existing) {
    const { data: insertedData, error: insertedError } = await supabase
      .from("trainingpeaks_student_operational_signals")
      .insert(payload)
      .select("*")
      .single();
    if (insertedError) {
      if (isTrainingPeaksMissingRelationError(insertedError)) {
        throw new Error(
          "trainingpeaks_student_operational_signals table is missing; apply Supabase migration first"
        );
      }
      if (insertedError.code === "23505") {
        const { data: conflictData, error: conflictError } = await existingScoped.maybeSingle();
        if (conflictError) {
          throw new Error(
            `Failed to load TrainingPeaks operational signal after conflict: ${conflictError.message}`
          );
        }
        if (!conflictData) {
          throw new Error(
            "Failed to resolve TrainingPeaks operational signal conflict: row not found"
          );
        }
        return {
          writeStatus: "existing",
          signal: mapTrainingPeaksStudentOperationalSignalRow(
            conflictData as TrainingPeaksStudentOperationalSignalRow
          ),
        };
      }
      throw new Error(
        `Failed to insert TrainingPeaks operational signal candidate: ${insertedError.message}`
      );
    }
    return {
      writeStatus: "inserted",
      signal: mapTrainingPeaksStudentOperationalSignalRow(
        insertedData as TrainingPeaksStudentOperationalSignalRow
      ),
    };
  }

  const structuredPayload =
    payload.structured_payload && typeof payload.structured_payload === "object"
      ? (payload.structured_payload as Record<string, unknown>)
      : {};
  const existingStructuredPayload =
    existing.structured_payload &&
    typeof existing.structured_payload === "object" &&
    !Array.isArray(existing.structured_payload)
      ? (existing.structured_payload as Record<string, unknown>)
      : {};
  const nextStructuredPayload = {
    ...existingStructuredPayload,
    ...structuredPayload,
  };
  const nextMetadata = {
    ...(existing.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata)
      ? (existing.metadata as Record<string, unknown>)
      : {}),
    ...((payload.metadata as Record<string, unknown> | undefined) ?? {}),
  };

  const shouldUpdate =
    existing.status !== normalizedStatus ||
    existing.source_type !== normalizedSourceType ||
    existing.telegram_chat_id !== (payload.telegram_chat_id ?? null) ||
    existing.telegram_message_id !== (payload.telegram_message_id ?? null) ||
    existing.telegram_message_thread_id !== (payload.telegram_message_thread_id ?? null) ||
    JSON.stringify(existingStructuredPayload) !== JSON.stringify(nextStructuredPayload) ||
    (existing.confidence ?? null) !== (payload.confidence ?? null) ||
    existing.valid_from !== (payload.valid_from ?? null) ||
    existing.valid_until !== (payload.valid_until ?? null) ||
    existing.source_date !== (payload.source_date ?? null) ||
    existing.target_date !== (payload.target_date ?? null) ||
    existing.source_day !== (payload.source_day ?? null) ||
    existing.target_day !== (payload.target_day ?? null) ||
    existing.linked_memory_item_id !== (payload.linked_memory_item_id ?? null) ||
    existing.linked_case_id !== (payload.linked_case_id ?? null) ||
    existing.linked_action_id !== (payload.linked_action_id ?? null) ||
    JSON.stringify(existing.metadata ?? {}) !== JSON.stringify(nextMetadata);

  if (!shouldUpdate) {
    return {
      writeStatus: "existing",
      signal: mapTrainingPeaksStudentOperationalSignalRow(existing),
    };
  }

  const { data: updatedData, error: updatedError } = await supabase
    .from("trainingpeaks_student_operational_signals")
    .update({
      status: normalizedStatus,
      source_type: normalizedSourceType,
      telegram_chat_id: payload.telegram_chat_id ?? null,
      telegram_message_id: payload.telegram_message_id ?? null,
      telegram_message_thread_id: payload.telegram_message_thread_id ?? null,
      structured_payload: nextStructuredPayload,
      confidence: payload.confidence ?? null,
      valid_from: payload.valid_from ?? null,
      valid_until: payload.valid_until ?? null,
      source_date: payload.source_date ?? null,
      target_date: payload.target_date ?? null,
      source_day: payload.source_day ?? null,
      target_day: payload.target_day ?? null,
      linked_memory_item_id: payload.linked_memory_item_id ?? null,
      linked_case_id: payload.linked_case_id ?? null,
      linked_action_id: payload.linked_action_id ?? null,
      metadata: nextMetadata,
    })
    .eq("id", existing.id)
    .select("*")
    .single();
  if (updatedError) {
    if (isTrainingPeaksMissingRelationError(updatedError)) {
      throw new Error(
        "trainingpeaks_student_operational_signals table is missing; apply Supabase migration first"
      );
    }
    throw new Error(`Failed to update TrainingPeaks operational signal: ${updatedError.message}`);
  }
  return {
    writeStatus: "updated",
    signal: mapTrainingPeaksStudentOperationalSignalRow(
      updatedData as TrainingPeaksStudentOperationalSignalRow
    ),
  };
}

export async function consumeActiveTrainingPeaksOperationalSignals(input: {
  studentId: string;
  signalTypes: TrainingPeaksOperationalSignalType[];
  excludeSignalId?: string | null;
  consumedAt?: string;
  metadataPatch?: Record<string, unknown>;
}): Promise<number> {
  if (!input.signalTypes.length) {
    return 0;
  }

  const normalizedSignalTypes = [...new Set(input.signalTypes.map(normalizeTrainingPeaksOperationalSignalType))];
  const supabase = createSupabaseServerClient();
  let query = supabase
    .from("trainingpeaks_student_operational_signals")
    .select("id, metadata")
    .eq("student_id", input.studentId)
    .eq("status", "active")
    .in("signal_type", normalizedSignalTypes);

  if (input.excludeSignalId) {
    query = query.neq("id", input.excludeSignalId);
  }

  const { data, error } = await query;
  if (error) {
    if (isTrainingPeaksMissingRelationError(error)) {
      throw new Error(
        "trainingpeaks_student_operational_signals table is missing; apply Supabase migration first"
      );
    }
    throw new Error(`Failed to list active TrainingPeaks operational signals to consume: ${error.message}`);
  }

  const rows =
    (data as Array<{ id: string; metadata: unknown }> | null)?.filter(
      (row): row is { id: string; metadata: unknown } =>
        Boolean(row && typeof row.id === "string" && row.id.trim())
    ) ?? [];
  if (!rows.length) {
    return 0;
  }

  const consumedAt = input.consumedAt ?? new Date().toISOString();
  let updated = 0;
  for (const row of rows) {
    const rowMetadata =
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {};
    const { error: updateError } = await supabase
      .from("trainingpeaks_student_operational_signals")
      .update({
        status: "consumed",
        consumed_at: consumedAt,
        metadata: {
          ...rowMetadata,
          ...(input.metadataPatch ?? {}),
        },
      })
      .eq("id", row.id)
      .eq("status", "active");
    if (updateError) {
      if (isTrainingPeaksMissingRelationError(updateError)) {
        throw new Error(
          "trainingpeaks_student_operational_signals table is missing; apply Supabase migration first"
        );
      }
      throw new Error(`Failed to consume TrainingPeaks operational signal ${row.id}: ${updateError.message}`);
    }
    updated += 1;
  }

  return updated;
}

export type UpdateTrainingPeaksMessageIntentLogAiInput = {
  aiIntent?: Record<string, unknown> | null;
  aiConfidence?: number | null;
  metadata?: Record<string, unknown>;
};

export async function getTrainingPeaksMessageIntentLogByTelegramMessage(
  telegramChatId: string,
  telegramMessageId: string
): Promise<TrainingPeaksMessageIntentLog | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_message_intent_logs")
    .select("*")
    .eq("telegram_chat_id", telegramChatId)
    .eq("telegram_message_id", telegramMessageId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get TrainingPeaks message intent log: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksMessageIntentLogRow(data as TrainingPeaksMessageIntentLogRow);
}

export async function updateTrainingPeaksMessageIntentLogAiFields(
  id: string,
  input: UpdateTrainingPeaksMessageIntentLogAiInput
): Promise<TrainingPeaksMessageIntentLog | null> {
  const supabase = createSupabaseServerClient();
  const existing = await supabase
    .from("trainingpeaks_message_intent_logs")
    .select("metadata")
    .eq("id", id)
    .maybeSingle();

  if (existing.error) {
    throw new Error(`Failed to load TrainingPeaks message intent log ${id}: ${existing.error.message}`);
  }

  if (!existing.data) {
    return null;
  }

  const previousMetadata =
    existing.data.metadata &&
    typeof existing.data.metadata === "object" &&
    !Array.isArray(existing.data.metadata)
      ? (existing.data.metadata as Record<string, unknown>)
      : {};

  const { data, error } = await supabase
    .from("trainingpeaks_message_intent_logs")
    .update({
      ai_intent: input.aiIntent ?? null,
      ai_confidence: input.aiConfidence ?? null,
      metadata: {
        ...previousMetadata,
        ...(input.metadata ?? {}),
      },
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to update TrainingPeaks message intent log ${id}: ${error.message}`);
  }

  return mapTrainingPeaksMessageIntentLogRow(data as TrainingPeaksMessageIntentLogRow);
}

export async function markTrainingPeaksReplyDraftSendOutcome(
  input: MarkTrainingPeaksReplyDraftSendOutcomeInput
): Promise<TrainingPeaksReplyDraft | null> {
  const supabase = createSupabaseServerClient();
  const existing = await supabase
    .from("trainingpeaks_reply_drafts")
    .select("metadata")
    .eq("id", input.draftId)
    .maybeSingle();

  if (existing.error) {
    throw new Error(
      `Failed to load TrainingPeaks reply draft metadata ${input.draftId}: ${existing.error.message}`
    );
  }

  if (!existing.data) {
    return null;
  }

  const previousMetadata =
    existing.data.metadata &&
    typeof existing.data.metadata === "object" &&
    !Array.isArray(existing.data.metadata)
      ? (existing.data.metadata as Record<string, unknown>)
      : {};
  const nowIso = new Date().toISOString();
  const nextSendMetadata: Record<string, unknown> = {
    status: input.sendStatus,
    at: nowIso,
  };

  if (typeof input.deliveredChunks === "number" && Number.isFinite(input.deliveredChunks)) {
    nextSendMetadata.deliveredChunks = Math.max(0, Math.trunc(input.deliveredChunks));
  }
  if (input.errorClass) {
    nextSendMetadata.errorClass = input.errorClass.trim();
  }
  if (input.errorPreview) {
    nextSendMetadata.errorPreview = input.errorPreview.trim();
  }
  if (input.actorTelegramChatId) {
    nextSendMetadata.actorTelegramChatId = input.actorTelegramChatId;
  }

  const previousSendMetadata =
    previousMetadata.send &&
    typeof previousMetadata.send === "object" &&
    !Array.isArray(previousMetadata.send)
      ? (previousMetadata.send as Record<string, unknown>)
      : {};

  const { data, error } = await supabase
    .from("trainingpeaks_reply_drafts")
    .update({
      metadata: {
        ...previousMetadata,
        send: {
          ...previousSendMetadata,
          ...nextSendMetadata,
        },
      },
    })
    .eq("id", input.draftId)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to update TrainingPeaks reply draft send metadata ${input.draftId}: ${error.message}`
    );
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksReplyDraftRow(data as TrainingPeaksReplyDraftRow);
}

export async function recordTrainingPeaksStudentContactEvent(
  input: InsertTrainingPeaksStudentContactEventInput
): Promise<TrainingPeaksStudentContactEvent> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_student_contact_events")
    .insert({
      student_id: input.studentId,
      event_type: input.eventType,
      source: input.source,
      occurred_at: input.occurredAt ?? new Date().toISOString(),
      reference_id: input.referenceId ?? null,
      metadata: input.metadata ?? {},
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to record TrainingPeaks student contact event: ${error.message}`);
  }

  return mapTrainingPeaksStudentContactEventRow(data as TrainingPeaksStudentContactEventRow);
}

export async function listTrainingPeaksStudentContactStatus(): Promise<TrainingPeaksStudentContactStatus[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_student_contact_status")
    .select("*")
    .order("silence_days", { ascending: false, nullsFirst: false })
    .order("student_id", { ascending: true });

  if (error) {
    throw new Error(`Failed to list TrainingPeaks student contact status: ${error.message}`);
  }

  return ((data as TrainingPeaksStudentContactStatusRow[]) ?? []).map(
    mapTrainingPeaksStudentContactStatusRow
  );
}

export async function getTrainingPeaksStudentContactStatus(
  studentId: string
): Promise<TrainingPeaksStudentContactStatus | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_student_contact_status")
    .select("*")
    .eq("student_id", studentId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get TrainingPeaks student contact status for ${studentId}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return mapTrainingPeaksStudentContactStatusRow(data as TrainingPeaksStudentContactStatusRow);
}

export async function listRecentTrainingPeaksStudentContactEvents(input: {
  studentId: string;
  limit?: number;
}): Promise<TrainingPeaksStudentContactEvent[]> {
  const supabase = createSupabaseServerClient();
  const safeLimit = Math.max(1, Math.min(input.limit ?? 5, 20));
  const { data, error } = await supabase
    .from("trainingpeaks_student_contact_events")
    .select("*")
    .eq("student_id", input.studentId)
    .order("occurred_at", { ascending: false })
    .limit(safeLimit);

  if (error) {
    throw new Error(
      `Failed to list recent TrainingPeaks student contact events for ${input.studentId}: ${error.message}`
    );
  }

  return ((data as TrainingPeaksStudentContactEventRow[]) ?? []).map(
    mapTrainingPeaksStudentContactEventRow
  );
}

export async function countTrainingPeaksSilentStudents(input: {
  minimumSilenceDays: number;
}): Promise<number> {
  const minimumSilenceDays = Math.max(0, Math.trunc(input.minimumSilenceDays));
  const supabase = createSupabaseServerClient();
  const { count, error } = await supabase
    .from("trainingpeaks_student_contact_status")
    .select("student_id", { count: "exact", head: true })
    .gte("silence_days", minimumSilenceDays);

  if (error) {
    throw new Error(`Failed to count TrainingPeaks silent students: ${error.message}`);
  }

  return count ?? 0;
}

export async function listRecentTrainingPeaksMessageIntentLogs(
  limit = 20
): Promise<TrainingPeaksMessageIntentLog[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_message_intent_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to list recent TrainingPeaks message intent logs: ${error.message}`);
  }

  return ((data as TrainingPeaksMessageIntentLogRow[]) ?? []).map(mapTrainingPeaksMessageIntentLogRow);
}

export async function listRecentTrainingPeaksCoachCasesForAttention(input: {
  sinceHours: number;
  caseKinds: readonly TrainingPeaksCoachCaseKind[];
  statuses: readonly TrainingPeaksCoachCaseStatus[];
  limit: number;
}): Promise<
  Array<{
    id: string;
    studentId: string;
    caseKind: TrainingPeaksCoachCaseKind;
    status: TrainingPeaksCoachCaseStatus;
    createdAt: string;
    coachNotesJson: Record<string, unknown>;
  }>
> {
  const cutoffIso = new Date(Date.now() - input.sinceHours * 3_600_000).toISOString();
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_coach_cases")
    .select("id, student_id, case_kind, status, created_at, coach_notes_json")
    .gte("created_at", cutoffIso)
    .in("case_kind", [...input.caseKinds])
    .in("status", [...input.statuses])
    .not("student_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(input.limit);

  if (error) {
    throw new Error(`Failed to list TrainingPeaks coach cases for attention: ${error.message}`);
  }

  return (
    (data as Array<{
      id: string;
      student_id: string;
      case_kind: TrainingPeaksCoachCaseKind;
      status: TrainingPeaksCoachCaseStatus;
      created_at: string;
      coach_notes_json: unknown | null;
    }>) ?? []
  ).map((row) => ({
    id: row.id,
    studentId: row.student_id,
    caseKind: row.case_kind,
    status: row.status,
    createdAt: row.created_at,
    coachNotesJson:
      row.coach_notes_json && typeof row.coach_notes_json === "object" && !Array.isArray(row.coach_notes_json)
        ? (row.coach_notes_json as Record<string, unknown>)
        : {},
  }));
}

export async function countActiveTrainingPeaksCoachCases(
  statuses: readonly TrainingPeaksCoachCaseStatus[]
): Promise<number> {
  const supabase = createSupabaseServerClient();
  const { count, error } = await supabase
    .from("trainingpeaks_coach_cases")
    .select("id", { count: "exact", head: true })
    .in("status", [...statuses])
    .not("student_id", "is", null);

  if (error) {
    throw new Error(`Failed to count active TrainingPeaks coach cases: ${error.message}`);
  }

  return count ?? 0;
}

type TrainingPeaksCoachCaseListItem = {
  id: string;
  studentId: string;
  studentName: string | null;
  caseKind: TrainingPeaksCoachCaseKind;
  status: TrainingPeaksCoachCaseStatus;
  createdAt: string;
  previewText: string | null;
  coachNotesJson: Record<string, unknown>;
};

export async function listTrainingPeaksCoachCases(input: {
  limit?: number;
  offset?: number;
  statusFilter?: readonly TrainingPeaksCoachCaseStatus[];
  caseKindFilter?: readonly TrainingPeaksCoachCaseKind[];
  studentQuery?: string | null;
}): Promise<{ items: TrainingPeaksCoachCaseListItem[]; total: number }> {
  const safeLimit = Math.max(1, Math.min(input.limit ?? 10, 50));
  const safeOffset = Math.max(0, Math.trunc(input.offset ?? 0));
  const normalizedStudentQuery = input.studentQuery?.trim() ?? "";
  const supabase = createSupabaseServerClient();

  let studentIdFilter: string[] | null = null;
  if (normalizedStudentQuery.length > 0) {
    const { data: matchedStudents, error: studentsError } = await supabase
      .from("trainingpeaks_students")
      .select("id")
      .ilike("student_name", `%${normalizedStudentQuery}%`)
      .limit(200);

    if (studentsError) {
      throw new Error(`Failed to filter TrainingPeaks coach cases by student name: ${studentsError.message}`);
    }

    studentIdFilter = ((matchedStudents as Array<{ id: string }> | null) ?? [])
      .map((row) => row.id)
      .filter((value) => typeof value === "string" && value.length > 0);
    if (studentIdFilter.length === 0) {
      return { items: [], total: 0 };
    }
  }

  let query = supabase
    .from("trainingpeaks_coach_cases")
    .select(
      "id, student_id, case_kind, status, created_at, coach_notes_json, trainingpeaks_students(student_name), trainingpeaks_telegram_context_observations(text_preview), trainingpeaks_message_intent_logs(text_preview)",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range(safeOffset, safeOffset + safeLimit - 1)
    .not("student_id", "is", null);

  if (input.statusFilter && input.statusFilter.length > 0) {
    query = query.in("status", [...input.statusFilter]);
  }

  if (input.caseKindFilter && input.caseKindFilter.length > 0) {
    query = query.in("case_kind", [...input.caseKindFilter]);
  }

  if (studentIdFilter && studentIdFilter.length > 0) {
    query = query.in("student_id", studentIdFilter);
  }

  const { data, error, count } = await query;
  if (error) {
    throw new Error(`Failed to list TrainingPeaks coach cases: ${error.message}`);
  }

  const items = (
    (data as Array<{
      id: string;
      student_id: string;
      case_kind: TrainingPeaksCoachCaseKind;
      status: TrainingPeaksCoachCaseStatus;
      created_at: string;
      coach_notes_json: unknown | null;
      trainingpeaks_students?: { student_name?: string | null } | Array<{ student_name?: string | null }> | null;
      trainingpeaks_telegram_context_observations?:
        | { text_preview?: string | null }
        | Array<{ text_preview?: string | null }>
        | null;
      trainingpeaks_message_intent_logs?:
        | { text_preview?: string | null }
        | Array<{ text_preview?: string | null }>
        | null;
    }>) ?? []
  ).map((row) => {
    const joinedStudent = Array.isArray(row.trainingpeaks_students)
      ? row.trainingpeaks_students[0]
      : row.trainingpeaks_students;
    const joinedContextObservation = Array.isArray(row.trainingpeaks_telegram_context_observations)
      ? row.trainingpeaks_telegram_context_observations[0]
      : row.trainingpeaks_telegram_context_observations;
    const joinedIntentLog = Array.isArray(row.trainingpeaks_message_intent_logs)
      ? row.trainingpeaks_message_intent_logs[0]
      : row.trainingpeaks_message_intent_logs;

    return {
      id: row.id,
      studentId: row.student_id,
      studentName: joinedStudent?.student_name?.trim() || null,
      caseKind: row.case_kind,
      status: row.status,
      createdAt: row.created_at,
      previewText: joinedContextObservation?.text_preview?.trim() || joinedIntentLog?.text_preview?.trim() || null,
      coachNotesJson:
        row.coach_notes_json && typeof row.coach_notes_json === "object" && !Array.isArray(row.coach_notes_json)
          ? (row.coach_notes_json as Record<string, unknown>)
          : {},
    };
  });
  return {
    items,
    total: count ?? items.length,
  };
}

export async function listRecentTrainingPeaksCoachCases(input: {
  limit?: number;
  statuses?: readonly TrainingPeaksCoachCaseStatus[];
}): Promise<TrainingPeaksCoachCaseListItem[]> {
  const result = await listTrainingPeaksCoachCases({
    limit: input.limit,
    statusFilter: input.statuses,
  });
  return result.items;
}

const TRAININGPEAKS_MESSAGE_INTENT_LOG_TRIAGE_STATUSES: TrainingPeaksMessageIntentLogStatus[] = [
  "unrecognized",
  "needs_review",
  "parse_failed",
  "student_not_found",
];

export type ListTrainingPeaksMessageIntentLogsForTriageInput = {
  limit?: number;
  status?: TrainingPeaksMessageIntentLogStatus;
  statuses?: TrainingPeaksMessageIntentLogStatus[];
  aiMoveOnly?: boolean;
  minAiConfidence?: number;
  studentId?: string;
  sinceHours?: number;
};

export async function listTrainingPeaksMessageIntentLogsForTriage(
  input: ListTrainingPeaksMessageIntentLogsForTriageInput = {}
): Promise<TrainingPeaksMessageIntentLog[]> {
  const supabase = createSupabaseServerClient();
  const safeLimit = Math.max(1, Math.min(input.limit ?? 30, 200));

  let query = supabase
    .from("trainingpeaks_message_intent_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (input.studentId) {
    query = query.eq("student_id", input.studentId);
  }

  if (input.sinceHours !== undefined && Number.isFinite(input.sinceHours) && input.sinceHours > 0) {
    const sinceIso = new Date(Date.now() - input.sinceHours * 60 * 60 * 1000).toISOString();
    query = query.gte("created_at", sinceIso);
  }

  if (input.minAiConfidence !== undefined && Number.isFinite(input.minAiConfidence)) {
    query = query.gte("ai_confidence", input.minAiConfidence);
  }

  if (input.aiMoveOnly) {
    query = query.filter("ai_intent->>intent", "eq", "move_workout");
  }

  if (input.statuses && input.statuses.length > 0) {
    query = query.in("status", input.statuses);
  } else if (input.status) {
    query = query.eq("status", input.status);
  } else {
    query = query.or(
      `status.in.(${TRAININGPEAKS_MESSAGE_INTENT_LOG_TRIAGE_STATUSES.join(",")}),ai_intent.not.is.null`
    );
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to list TrainingPeaks message intent logs for triage: ${error.message}`);
  }

  return ((data as TrainingPeaksMessageIntentLogRow[]) ?? []).map(mapTrainingPeaksMessageIntentLogRow);
}
