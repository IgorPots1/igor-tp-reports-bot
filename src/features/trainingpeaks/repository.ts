import { createSupabaseServerClient } from "@/features/supabase/server";

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

export type RequestTrainingPeaksActionExecutionResult =
  | {
      kind: "queued";
      action: TrainingPeaksAction;
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
    }
  | {
      kind: "not_found";
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

function toNumericConfidence(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function validateDryRunLogReadiness(logJson: unknown): { ok: true } | { ok: false; reason: string } {
  if (!logJson || typeof logJson !== "object") {
    return { ok: false, reason: "Dry-run log not found." };
  }

  const payload = logJson as {
    dryRunResult?: unknown;
    canExecute?: unknown;
    candidate?: { fingerprint?: unknown } | null;
    confidence?: unknown;
  };

  if (payload.dryRunResult !== "candidate_found") {
    return { ok: false, reason: "Dry-run did not find a unique candidate." };
  }
  if (payload.canExecute !== true) {
    return { ok: false, reason: "Dry-run marked action as unsafe for execution." };
  }

  const fingerprint = payload.candidate?.fingerprint;
  if (typeof fingerprint !== "string" || !fingerprint.trim()) {
    return { ok: false, reason: "Dry-run candidate fingerprint is missing." };
  }

  const confidence = toNumericConfidence(payload.confidence);
  if (confidence === null || confidence < 0.8) {
    return { ok: false, reason: "Dry-run confidence is below 0.8." };
  }

  return { ok: true };
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
    return { kind: "blocked", action, reason: "Action is not approved." };
  }

  if (action.executionStatus !== "dry_run_completed") {
    return { kind: "blocked", action, reason: "Dry-run is not completed yet." };
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
    return { kind: "blocked", action, reason: "Trusted dry-run run is missing." };
  }

  const dryRunValidation = validateDryRunLogReadiness((dryRunRun as { log_json?: unknown }).log_json);
  if (!dryRunValidation.ok) {
    return { kind: "blocked", action, reason: dryRunValidation.reason };
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
    return { kind: "queued", action: mapTrainingPeaksActionRow(queuedRow as TrainingPeaksActionRow) };
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
  return { kind: "blocked", action: latest, reason: "Action state changed. Please refresh and try again." };
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

export type TrainingPeaksTelegramContextSourceType = "business_dm" | "private_dm" | "group_topic";

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
