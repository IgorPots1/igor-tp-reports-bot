import {
  getTrainingPeaksCoachCaseById,
  getTrainingPeaksCoachCaseDetailsById,
  getTrainingPeaksCoachCaseByIdPrefix,
  getTrainingPeaksReplyDraftByIdPrefix as getTrainingPeaksReplyDraftByIdPrefixFromRepository,
  approveTrainingPeaksAction as approveTrainingPeaksActionInRepository,
  approveTrainingPeaksWeeklyReportIfDraft,
  cancelQueuedTrainingPeaksJob,
  countRunningTrainingPeaksJobsUpdatedBefore,
  countActiveTrainingPeaksCoachCases as countActiveTrainingPeaksCoachCasesInRepository,
  listTrainingPeaksStudentContactStatus as listTrainingPeaksStudentContactStatusInRepository,
  claimTrainingPeaksWeeklyReportForSend as claimTrainingPeaksWeeklyReportForSendInRepository,
  createTrainingPeaksAction as createTrainingPeaksActionInRepository,
  createTrainingPeaksActionRun as createTrainingPeaksActionRunInRepository,
  createTrainingPeaksRaceScanJob,
  createTrainingPeaksRaceResultsProbeJob,
  createTrainingPeaksWeeklyJob,
  deleteTrainingPeaksOrphanReportsForWeek as deleteTrainingPeaksOrphanReportsForWeekInRepository,
  deleteTrainingPeaksWeeklyReportById,
  disableTrainingPeaksStudentById,
  enableTrainingPeaksStudentById,
  expireActiveTrainingPeaksStudentTelegramLinkCodesForStudent,
  expireTrainingPeaksStudentTelegramLinkCodesByIds,
  findActiveTrainingPeaksJobForWeek,
  findActiveTrainingPeaksJobForStudentWeek,
  findActiveTrainingPeaksRaceResultsProbeJobForStudent,
  getTrainingPeaksWeeklyReportForStudentWeek,
  getTrainingPeaksJobById,
  getTrainingPeaksBusinessChatById,
  getTrainingPeaksBusinessChatByChatId as getTrainingPeaksBusinessChatByChatIdFromRepository,
  getTrainingPeaksStudentThreadByChatThread as getTrainingPeaksStudentThreadByChatThreadFromRepository,
  getTrainingPeaksStudentById as getTrainingPeaksStudentByIdFromRepository,
  getTrainingPeaksStudentByStudentId as getTrainingPeaksStudentByStudentIdFromRepository,
  getTrainingPeaksStudentByTelegramChatId as getTrainingPeaksStudentByTelegramChatIdFromRepository,
  getTrainingPeaksWeeklyReportById,
  recoverStaleTrainingPeaksRunningJobs,
  recoverStaleTrainingPeaksRunningRaceScanJobs,
  insertTrainingPeaksStudent,
  insertTrainingPeaksReplyDraft as insertTrainingPeaksReplyDraftInRepository,
  insertTrainingPeaksCoachActionTaken,
  insertTrainingPeaksCoachCase,
  insertTrainingPeaksStudentContextSnapshot,
  insertTrainingPeaksStudentThread,
  insertTrainingPeaksStudentTelegramLinkCode,
  linkTrainingPeaksStudentToBusinessChat as linkTrainingPeaksStudentToBusinessChatInRepository,
  listAllTrainingPeaksReports,
  listTrainingPeaksBusinessChatsByUsername as listTrainingPeaksBusinessChatsByUsernameFromRepository,
  listTrainingPeaksBusinessChatsForTelegramLinking as listTrainingPeaksBusinessChatsForTelegramLinkingFromRepository,
  listRecentTrainingPeaksBusinessChats as listRecentTrainingPeaksBusinessChatsFromRepository,
  listTrainingPeaksStudentContactStatus as listTrainingPeaksStudentContactStatusFromRepository,
  listTrainingPeaksStudentTelegramLinkCodesByCode,
  listRecentTrainingPeaksJobs,
  listRecentTrainingPeaksCoachCasesForAttention,
  listRecentTrainingPeaksCoachCases as listRecentTrainingPeaksCoachCasesFromRepository,
  listTrainingPeaksCoachCases as listTrainingPeaksCoachCasesFromRepository,
  listRecentTrainingPeaksActions as listRecentTrainingPeaksActionsFromRepository,
  listActiveTrainingPeaksMoveActions,
  listTrainingPeaksActionLatestRunContexts,
  getTrainingPeaksActionLatestRunContext,
  listLatestTrainingPeaksActionRunsByActionIds,
  listTrainingPeaksStudents,
  listTrainingPeaksStudentsIncludingArchived,
  countTrainingPeaksStudentThreadsByStudentIds as countTrainingPeaksStudentThreadsByStudentIdsFromRepository,
  listTrainingPeaksStudentThreads as listTrainingPeaksStudentThreadsFromRepository,
  listTrainingPeaksWeeklyReportEligibleStudents as listTrainingPeaksWeeklyReportEligibleStudentsFromRepository,
  listTrainingPeaksWorkoutCacheForDateRange,
  listTrainingPeaksWorkoutCacheForStudentDateRange,
  listTrainingPeaksWorkoutCacheScanStatusesCoveringDate,
  listTrainingPeaksStudentsEligibleForHealthMetrics,
  listTrainingPeaksHealthMetricsForStudentDateRange,
  listTrainingPeaksOperationalSignals,
  markTrainingPeaksStudentTelegramLinkCodeUsed,
  rejectTrainingPeaksAction as rejectTrainingPeaksActionInRepository,
  recordTrainingPeaksStudentContactEvent,
  requestTrainingPeaksActionExecution as requestTrainingPeaksActionExecutionInRepository,
  requestTrainingPeaksActionDryRunRecheck as requestTrainingPeaksActionDryRunRecheckInRepository,
  confirmTrainingPeaksActionSourceDate as confirmTrainingPeaksActionSourceDateInRepository,
  confirmTrainingPeaksActionSourceWorkout as confirmTrainingPeaksActionSourceWorkoutInRepository,
  pickTrainingPeaksActionSourceCandidate as pickTrainingPeaksActionSourceCandidateInRepository,
  extractMoveSourcePickerCandidates as extractMoveSourcePickerCandidatesInRepository,
  type PickTrainingPeaksActionSourceCandidateResult,
  cancelTrainingPeaksActionExecution as cancelTrainingPeaksActionExecutionInRepository,
  getTrainingPeaksActionById as getTrainingPeaksActionByIdInRepository,
  getLatestTrainingPeaksCronRunLog,
  getTrainingPeaksCoachCaseByTelegramMessageAndKind,
  getTrainingPeaksTelegramContextObservationByChatMessage,
  findTrainingPeaksMoveActionBySourceMessageAndDates,
  claimOneApprovedTrainingPeaksActionForDryRun as claimOneApprovedTrainingPeaksActionForDryRunInRepository,
  completeTrainingPeaksActionDryRun as completeTrainingPeaksActionDryRunInRepository,
  failTrainingPeaksActionDryRun as failTrainingPeaksActionDryRunInRepository,
  setTrainingPeaksStudentWeeklyReportsEnabledById,
  TRAININGPEAKS_ATTENTION_DIGEST_CRON_JOB_NAME,
  TRAININGPEAKS_JOB_CANCELLED_ERROR_MESSAGE,
  type DecideTrainingPeaksActionResult,
  type RequestTrainingPeaksActionExecutionResult,
  type RequestTrainingPeaksActionDryRunRecheckResult,
  type ConfirmTrainingPeaksActionSourceDateResult,
  type ConfirmTrainingPeaksActionSourceWorkoutResult,
  type CancelTrainingPeaksActionExecutionResultExtended,
  type TrainingPeaksBusinessChat,
  type TrainingPeaksAction,
  type TrainingPeaksCoachCase,
  type TrainingPeaksWorkoutCacheRow,
  type TrainingPeaksActionWithStudent,
  type TrainingPeaksActionLatestRunContext,
  type TrainingPeaksActionRun,
  type ClaimedTrainingPeaksDryRunAction,
  type TrainingPeaksStudentContactStatus,
  type TrainingPeaksStudentContextCacheStatus,
  type TrainingPeaksRecoveryAlertKind,
  type TrainingPeaksCoachCaseKind,
  type TrainingPeaksCoachCasePrefixLookupResult,
  type TrainingPeaksCoachCaseStatus,
  type InsertTrainingPeaksReplyDraftInput,
  type TrainingPeaksReplyDraft,
  type UpdateTrainingPeaksReplyDraftOutcomeInput,
  TrainingPeaksJobConflictError,
  type TrainingPeaksStudentTelegramLinkCode,
  TrainingPeaksTelegramLinkCodeConflictError,
  TrainingPeaksStudentConflictError,
  type TrainingPeaksJob,
  type TrainingPeaksRaceResultsProbeRequestJson,
  type TrainingPeaksStudent,
  type TrainingPeaksStudentOperationalSignal,
  type TrainingPeaksStudentThread,
  type TrainingPeaksTelegramContextObservation,
  type TrainingPeaksTelegramFormality,
  TrainingPeaksStudentThreadConflictError,
  type TrainingPeaksWeek,
  type TrainingPeaksWeeklyReport,
  deleteTrainingPeaksStudentThreadById,
  unlinkTrainingPeaksStudentTelegramById,
  upsertTrainingPeaksBusinessChatFromMessage as upsertTrainingPeaksBusinessChatFromMessageInRepository,
  type UpdateTrainingPeaksStudentTelegramContactInput,
  type UpdateTrainingPeaksStudentTelegramContactParams,
  type UpdateTrainingPeaksStudentTelegramContextInput,
  type UpdateTrainingPeaksWeeklyReportContentInput,
  type UpdateTrainingPeaksWeeklyReportStateInput,
  type UpdateTrainingPeaksWeeklyReportReviewStateInput,
  updateTrainingPeaksStudentTelegramContact as updateTrainingPeaksStudentTelegramContactInRepository,
  updateTrainingPeaksStudentTelegramContactById,
  updateTrainingPeaksStudentTelegramContextById,
  listTrainingPeaksTelegramContextObservationsForStudent,
  listRecentTrainingPeaksTelegramContextObservationsForChat,
  listRecentPendingTrainingPeaksMoveActionsForStudentChat,
  insertTrainingPeaksTelegramContextObservation,
  updateTrainingPeaksCoachCaseStatus,
  updateTrainingPeaksCoachCaseMetadata,
  updateTrainingPeaksReplyDraftOutcome as updateTrainingPeaksReplyDraftOutcomeInRepository,
  updateTrainingPeaksStudentThreadById,
  updateTrainingPeaksWeeklyReportContentById,
  updateTrainingPeaksWeeklyReportReviewState as updateTrainingPeaksWeeklyReportReviewStateInRepository,
  updateTrainingPeaksWeeklyReportStateById,
} from "@/features/trainingpeaks/repository";
import { evaluateTrainingPeaksRecoveryAlert } from "@/features/trainingpeaks/recovery-alerts";
import { classifyTrainingPeaksWorkoutActivity } from "@/features/trainingpeaks/workout-activity-classification";
import {
  parseMoveWorkoutWithAiFallback,
  selectMoveSourceWorkoutWithAi,
  type MoveSourceCalendarWorkout,
  type MoveSourceSituation,
} from "@/features/trainingpeaks/move-workout-parser-ai";
import {
  assembleTrainingPeaksMoveIntentContext,
  triggerHasStrictMoveVerb,
} from "@/features/trainingpeaks/move-multi-message-context";
import {
  buildMoveSourceInferencePreviewFromCacheCandidates,
  formatMoveSourceInferencePreviewRu,
  type TrainingPeaksMoveSourceInferencePreview,
} from "@/features/trainingpeaks/move-source-inference-preview";
import {
  hasIntervalDescriptorPattern,
  hasRecognizedWorkoutReference,
  normalizeWorkoutReference,
} from "@/features/trainingpeaks/workout-reference";
import { TRAININGPEAKS_TIME_ZONE, resolveTrainingPeaksWeekKeyword } from "@/features/trainingpeaks/week";
import {
  DEFAULT_COACH_TIMEZONE,
  getCoachTodayDateKey,
  normalizeOperationalSignalFollowUp,
} from "@/features/trainingpeaks/operational-follow-up";
import {
  buildCanonicalEpisodeScheduleDisplayText,
  buildEpisodeScheduleContextIndex,
  compactCoachFacingScheduleSignalText,
  formatScheduleOperationalSignalText,
  inferOneOffWeekdayConstraintValidUntil,
  summarizeLongScheduleConstraintText,
  type EpisodeScheduleContext,
} from "@/features/trainingpeaks/operational-schedule-display";
import type { TelegramMessage } from "@/features/telegram/types";
import { buildTelegramContextTextPreview, sha256TelegramContextText } from "@/features/trainingpeaks/telegram-context";
import { formatOperationalSignalTelegramLine } from "@/features/trainingpeaks/telegram-visual-ux";
import {
  classifyTpWorkoutEvidence,
  evaluateOperationalSignalLifecycle,
  hasReliableRunningCompletionAfterOpen,
  type EvidenceFreshness,
  type OperationalSignalClass,
  type OperationalSignalLifecycle,
  type OperationalSignalLifecycleInput,
  type PlannedVsCompletedDelta,
} from "@/features/trainingpeaks/operational-signal-lifecycle";
import {
  isCleanRunningCompletion,
  resolveBridgeRecommendedAction,
} from "@/features/trainingpeaks/tp-completion-lifecycle-bridge";
import { buildContinuedIllnessCoachDisplaySummary } from "@/features/trainingpeaks/coach-operational-signals";
import {
  buildTrainingPeaksContactDisplay,
  TRAININGPEAKS_NO_CONTACT_ALERT_DAYS,
} from "@/features/trainingpeaks/contact-display";
import {
  normalizeTrainingPeaksStudentId,
  validateTrainingPeaksStudentId,
} from "@/lib/trainingpeaks-student-id";

export type TrainingPeaksStatus = "ready" | "parsed_only" | "missing";
export type TrainingPeaksRegistryStatus = "no_data" | "ready" | "data_loaded" | "no_report";

export type TrainingPeaksStatusOverviewStudent = {
  studentId: string;
  studentName: string;
  status: TrainingPeaksStatus;
  hasReport: boolean;
};

export type TrainingPeaksStatusOverview = {
  week: TrainingPeaksWeek;
  students: TrainingPeaksStatusOverviewStudent[];
};

export type TrainingPeaksStudentSnapshot = {
  studentId: string;
  studentName: string;
  weekFrom: string;
  weekTo: string;
  status: Exclude<TrainingPeaksStatus, "missing">;
};

export type TrainingPeaksReportSnapshot = {
  studentId: string;
  studentName: string;
  weekFrom: string;
  weekTo: string;
  reportMarkdown: string;
};

export type TrainingPeaksRegistryStudentSnapshot = {
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
  latestWeekFrom: string | null;
  latestWeekTo: string | null;
  latestReportStatus: TrainingPeaksRegistryStatus;
  hasGroupTopic: boolean;
  groupTopicCount: number;
};

export type TrainingPeaksStudentCard =
  | { kind: "not_found" }
  | {
      kind: "ambiguous";
      matches: {
        studentId: string;
        studentName: string;
      }[];
    }
  | {
      kind: "student";
      student: TrainingPeaksRegistryStudentSnapshot;
    };

export type AddTrainingPeaksStudentResult =
  | { ok: true; student: TrainingPeaksStudent }
  | { ok: false; reason: "empty_name" | "invalid_url" | "duplicate_student" | "duplicate_url" | "unknown" };

export type CreateTrainingPeaksStudentInput = {
  studentId: string;
  studentName: string;
  trainingPeaksAthleteUrl: string;
  notes?: string | null;
  dataQualityStatus?: string | null;
};

export type CreateTrainingPeaksStudentResult =
  | { ok: true; student: TrainingPeaksStudent }
  | {
      ok: false;
      reason:
        | "empty_student_id"
        | "invalid_student_id"
        | "empty_student_name"
        | "empty_url"
        | "invalid_url"
        | "duplicate_student"
        | "duplicate_url"
        | "unknown";
      message: string;
    };

export type DisableTrainingPeaksStudentResult =
  | { kind: "not_found" }
  | {
      kind: "ambiguous";
      matches: {
        studentId: string;
        studentName: string;
      }[];
    }
  | {
      kind: "student";
      student: TrainingPeaksStudent;
    };

export type EnableTrainingPeaksStudentResult = DisableTrainingPeaksStudentResult;

export type SetTrainingPeaksStudentWeeklyReportsEnabledResult =
  | { ok: true; student: TrainingPeaksStudent }
  | { ok: false; reason: "not_found" | "student_archived"; message: string };

export type UnlinkTrainingPeaksStudentTelegramResult =
  | { ok: true; student: TrainingPeaksStudent }
  | { ok: false; reason: "not_found"; message: string };

export type TrainingPeaksJobRequester = {
  chatId: number | string;
  userId: number | string | null;
};

export type TrainingPeaksMoveWorkoutTimeRefKind = "date" | "weekday" | "relative_day";

export type TrainingPeaksMoveWorkoutTimeRef = {
  kind: TrainingPeaksMoveWorkoutTimeRefKind;
  value: string;
  sourceText: string;
};

export type TrainingPeaksMoveWorkoutWorkoutType =
  | "easy_run"
  | "interval"
  | "tempo"
  | "long_run"
  | "run"
  | "unknown";

export type TrainingPeaksMoveWorkoutDescriptor = {
  raw: string;
  type: TrainingPeaksMoveWorkoutWorkoutType;
  confidence: number;
};

export type ParsedTrainingPeaksMoveWorkoutPayload = {
  actionType: "move_workout";
  source: TrainingPeaksMoveWorkoutTimeRef | null;
  target: TrainingPeaksMoveWorkoutTimeRef;
  workoutDescriptor: TrainingPeaksMoveWorkoutDescriptor | null;
  confidence: number;
  needsClarification: boolean;
  clarificationReason: string | null;
  parser: "deterministic" | "ai_fallback" | "group_case_proposal";
  sourceDate?: string;
  source_date?: string;
  warnings?: string[];
  suggestedAdjustments?: string[];
  sourceInferencePreview?: TrainingPeaksMoveSourceInferencePreview;
  sourceInference?: {
    strategy: "future_workout_cache_preview";
    trusted: false;
    source: "trainingpeaks_workout_cache";
    candidateCount: number;
    selectedWorkoutId?: number;
    candidates?: Array<{
      workoutId: number;
      workoutDate: string;
      title: string | null;
      score: number;
    }>;
    reason?: string | null;
    warnings?: string[];
  };
  // What kind of request this is, judged against the plan (greedy-fix). Drives whether a move card
  // is created at all (no_such_workout → suppressed by the caller) or shown as keep-or-move.
  moveSituation?: MoveSourceSituation;
  // Set when Haiku chose the source workout from the student's calendar (calendar-aware selection).
  // Provenance only — the chosen date/source fields drive the runner; this records the why.
  aiSourceSelection?: {
    decision: "single" | "ambiguous";
    selectedWorkoutId?: number;
    selectedDate?: string;
    candidateWorkoutIds?: number[];
    confidence: number;
    reasoning: string;
    model: string;
  };
  parsingDiagnostics?: {
    parserBaseDateSource: "message_timestamp" | "env_override" | "server_now";
    parserBaseDateIso: string;
    messageTimestampAvailable: boolean;
    sourceDateInferredFromTargetMonth?: boolean;
    sourceDateInferencePattern?: "day_only_source_target_month";
    assemblyKind?: "single_message" | "multi_message";
    contextMessageIds?: Array<string | number>;
    contextPreviews?: string[];
    autoApprovedForDryRun?: boolean;
  };
};

export type ParseTrainingPeaksMoveWorkoutResult =
  | { ok: true; payload: ParsedTrainingPeaksMoveWorkoutPayload; confidence: number }
  | {
      ok: false;
      reason:
        | "not_move_request"
        | "no_target_day"
        | "ambiguous_target_day"
        | "not_explicit_move_request"
        | "needs_clarification"
        | "parse_rejected";
    };

export type CreateTrainingPeaksMoveWorkoutActionFromTelegramInput = {
  chatId: string;
  messageId: string;
  userId?: string | null;
  text: string;
  coachChatId?: string | null;
  messageDateUnix?: number | null;
  // Student's IANA timezone for AI date resolution. Pass student.timezone once the DB column exists.
  studentTimezone?: string | null;
  // When true, the LLM intent classifier already confirmed move_workout intent;
  // skip the strict keyword gate inside parseTrainingPeaksMoveWorkoutRequest.
  aiBypass?: boolean;
};

export type CreateTrainingPeaksMoveWorkoutActionFromTelegramResult =
  | {
      ok: true;
      action: TrainingPeaksAction;
      student: TrainingPeaksStudent;
      parsed: ParsedTrainingPeaksMoveWorkoutPayload;
    }
  | {
      ok: false;
      reason:
        | "student_not_found"
        | "not_move_request"
        | "no_target_day"
        | "ambiguous_target_day"
        | "empty_text"
        | "not_explicit_move_request"
        | "needs_clarification"
        | "no_such_workout_not_a_move"
        | "parse_rejected";
      student?: TrainingPeaksStudent;
    };

export type DecideTrainingPeaksActionInput = {
  actionId: string;
  decidedByChatId: string;
  decidedByUserId?: string | null;
  decisionMessageId?: string | null;
};

export type DecideTrainingPeaksActionResultSnapshot = DecideTrainingPeaksActionResult;
export type RequestTrainingPeaksActionExecutionResultSnapshot = RequestTrainingPeaksActionExecutionResult;
export type RequestTrainingPeaksActionDryRunRecheckResultSnapshot = RequestTrainingPeaksActionDryRunRecheckResult;
export type ConfirmTrainingPeaksActionSourceDateResultSnapshot = ConfirmTrainingPeaksActionSourceDateResult;
export type ConfirmTrainingPeaksActionSourceWorkoutResultSnapshot = ConfirmTrainingPeaksActionSourceWorkoutResult;
export type CancelTrainingPeaksActionExecutionResultSnapshot = CancelTrainingPeaksActionExecutionResultExtended;
export type TrainingPeaksActionRunSnapshot = TrainingPeaksActionRun;
export type ClaimedTrainingPeaksDryRunActionSnapshot = ClaimedTrainingPeaksDryRunAction;
export type TrainingPeaksActionWithStudentSnapshot = TrainingPeaksActionWithStudent;
export type TrainingPeaksActionLatestRunContextSnapshot = TrainingPeaksActionLatestRunContext;
export type CreateTrainingPeaksActionsFromGroupMoveCaseResultSnapshot = CreateTrainingPeaksActionsFromGroupMoveCaseResult;

export type TrainingPeaksBusinessChatSnapshot = TrainingPeaksBusinessChat;
export type TrainingPeaksStudentTelegramLinkCodeSnapshot = TrainingPeaksStudentTelegramLinkCode;
export type TrainingPeaksStudentThreadSnapshot = TrainingPeaksStudentThread;

export type LinkTrainingPeaksStudentThreadResult =
  | {
      ok: true;
      kind: "linked" | "already_linked";
      thread: TrainingPeaksStudentThreadSnapshot;
      student: TrainingPeaksRegistryStudentSnapshot;
    }
  | { ok: false; reason: "student_not_found" | "student_archived" | "student_inactive"; message: string }
  | {
      ok: false;
      reason: "student_ambiguous";
      message: string;
      matches: { studentId: string; studentName: string }[];
    }
  | {
      ok: false;
      reason: "linked_to_other_student";
      message: string;
      thread: TrainingPeaksStudentThreadSnapshot;
      existingStudent: TrainingPeaksRegistryStudentSnapshot | null;
    };

export type UnlinkTrainingPeaksStudentThreadResult =
  | {
      ok: true;
      thread: TrainingPeaksStudentThreadSnapshot;
      student: TrainingPeaksRegistryStudentSnapshot | null;
    }
  | { ok: false; reason: "not_linked"; message: string };

export type TrainingPeaksThreadInfo =
  | {
      linked: false;
      chatId: string;
      messageThreadId: number;
      chatTitle: string | null;
      threadTitle: string | null;
    }
  | {
      linked: true;
      chatId: string;
      messageThreadId: number;
      chatTitle: string | null;
      threadTitle: string | null;
      thread: TrainingPeaksStudentThreadSnapshot;
      student: TrainingPeaksRegistryStudentSnapshot | null;
    };

export type ConsumeTrainingPeaksStudentTelegramLinkCodeResult =
  | { kind: "no_candidate" }
  | { kind: "no_match"; code: string }
  | { kind: "expired"; code: string; studentName: string | null }
  | { kind: "used"; code: string; studentName: string | null }
  | { kind: "ambiguous"; code: string; matches: number }
  | { kind: "link_failed"; code: string; studentName: string | null }
  | {
      kind: "linked";
      code: string;
      student: TrainingPeaksStudent;
      chat: TrainingPeaksBusinessChatSnapshot;
    };

export type {
  UpdateTrainingPeaksStudentTelegramContactParams,
  UpdateTrainingPeaksWeeklyReportReviewStateInput,
};

export type RequestTrainingPeaksWeeklyRunResult =
  | { ok: true; job: TrainingPeaksJob }
  | {
      ok: false;
      reason: "invalid_format" | "invalid_date" | "invalid_range";
      message: string;
    }
  | {
      ok: false;
      reason: "duplicate";
      activeJob: Pick<TrainingPeaksJob, "id" | "status" | "weekFrom" | "weekTo" | "scope" | "studentId"> | null;
      message: string;
    }
  | {
      ok: false;
      reason: "unknown";
      activeJob: null;
      message: string;
    };

export type RequestTrainingPeaksWeeklyRunForStudentResult =
  | { ok: true; job: TrainingPeaksJob; student: TrainingPeaksRegistryStudentSnapshot }
  | {
      ok: false;
      reason:
        | "invalid_format"
        | "invalid_date"
        | "invalid_range"
        | "student_not_found"
        | "student_ambiguous"
        | "student_archived"
        | "student_inactive"
        | "missing_trainingpeaks_url";
      message: string;
      matches?: { studentId: string; studentName: string }[];
    }
  | {
      ok: false;
      reason: "duplicate";
      activeJob: Pick<TrainingPeaksJob, "id" | "status" | "weekFrom" | "weekTo" | "scope" | "studentId"> | null;
      message: string;
    }
  | {
      ok: false;
      reason: "unknown";
      activeJob: null;
      message: string;
    };

export type RequestTrainingPeaksRaceScanResult =
  | { ok: true; job: TrainingPeaksJob }
  | {
      ok: false;
      reason: "invalid_format" | "invalid_date" | "invalid_range";
      message: string;
    }
  | {
      ok: false;
      reason: "duplicate";
      activeJob: Pick<TrainingPeaksJob, "id" | "status" | "weekFrom" | "weekTo"> | null;
      message: string;
    }
  | {
      ok: false;
      reason: "unknown";
      activeJob: null;
      message: string;
    };

export type RequestTrainingPeaksRaceResultsProbeOptions = Partial<{
  distance: string;
  preset: string;
  from: string;
  to: string;
}>;

export type RequestTrainingPeaksRaceResultsProbeResult =
  | { ok: true; job: TrainingPeaksJob }
  | {
      ok: false;
      reason:
        | "missing_requester"
        | "student_not_found"
        | "missing_trainingpeaks_url"
        | "invalid_athlete_url"
        | "invalid_date"
        | "invalid_range";
      message: string;
    }
  | {
      ok: false;
      reason: "duplicate";
      activeJob: Pick<TrainingPeaksJob, "id" | "status" | "weekFrom" | "weekTo" | "studentId"> | null;
      message: string;
    }
  | {
      ok: false;
      reason: "unknown";
      activeJob: null;
      message: string;
    };

export type CancelTrainingPeaksWeeklyRunResult =
  | { ok: true; job: TrainingPeaksJob }
  | {
      ok: false;
      reason: "already_started" | "not_found" | "not_cancellable";
    };

export type TrainingPeaksAttentionLevel = "urgent" | "today" | "observe" | "fyi";

export type TrainingPeaksAttentionSignal = {
  level: TrainingPeaksAttentionLevel;
  studentName: string | null;
  reason: string;
  studentId?: string | null;
  caseId?: string | null;
  actionId?: string | null;
  signalKind?: string;
};

export type TrainingPeaksAttentionSnapshot = {
  urgent: TrainingPeaksAttentionSignal[];
  today: TrainingPeaksAttentionSignal[];
  observe: TrainingPeaksAttentionSignal[];
  fyi: TrainingPeaksAttentionSignal[];
  checkTodaySignals: TrainingPeaksAttentionSignal[];
  painDiscomfort: TrainingPeaksAttentionSignal[];
  missedWorkouts: TrainingPeaksAttentionSignal[];
  noContact5Days: TrainingPeaksAttentionSignal[];
  followUpToday: TrainingPeaksAttentionSignal[];
  followUpOverflowCount: number;
  planConstraintsToday: TrainingPeaksAttentionSignal[];
  planConstraintsOverflowCount: number;
  movesToday: TrainingPeaksAttentionSignal[];
  movesOverflowCount: number;
};

export type TrainingPeaksOperationalSignalsScope = "all" | "health" | "schedule" | "move";

export type TrainingPeaksOperationalSignalsSectionKey =
  | "health_pause"
  | "pain_injury"
  | "plan_constraints"
  | "moves"
  | "other";

export type TrainingPeaksOperationalSignalsFollowUpState = Extract<
  ReturnType<typeof normalizeOperationalSignalFollowUp>["state"],
  "pending_overdue" | "pending_due" | "pending_future" | "none" | "resolved_or_non_pending"
>;

export type TrainingPeaksOperationalSignalsItem = {
  signalId: string;
  studentId: string;
  studentName: string | null;
  section: TrainingPeaksOperationalSignalsSectionKey;
  priority: number;
  sortBucket: number;
  dueDate: string | null;
  episodeKey: string | null;
  signalType: string;
  isEpisodeSummary: boolean;
  followUpState: TrainingPeaksOperationalSignalsFollowUpState;
  lifecycleDisplayState: "active_problem" | "monitoring_after_return" | "ready_for_coach_close" | "stale_needs_review";
  text: string;
  requiresCoachReview?: boolean | null;
  hiddenReason?: string | null;
};

export type TrainingPeaksOperationalSignalCompletionEvidence = {
  latestCacheScannedAt: string | null;
  latestCompletionAfterOpen: OperationalSignalLifecycleInput["latestTpCompletionAfterOpen"];
  negativeMessageAfterCompletion?: OperationalSignalLifecycleInput["negativeMessageAfterCompletion"];
  recommendedAction: string;
  recommendationReason: string;
  applyDryRunCommand: string | null;
  cleanRunningCompletionCount: number;
  evidenceError?: string | null;
};

export type TrainingPeaksOperationalSignalSourceEvidence = {
  observationId?: string | null;
  observedAt: string | null;
  sourceType?: string | null;
  textPreview: string | null;
};

export type TrainingPeaksOperationalSignalDisplayEvidence = {
  source?: TrainingPeaksOperationalSignalSourceEvidence | null;
  latestRelevant?: TrainingPeaksOperationalSignalSourceEvidence | null;
  latestNegative?: TrainingPeaksOperationalSignalSourceEvidence | null;
  negativeAfterCompletion?: TrainingPeaksOperationalSignalSourceEvidence | null;
  latestPositive?: TrainingPeaksOperationalSignalSourceEvidence | null;
  latestAgreement?: TrainingPeaksOperationalSignalSourceEvidence | null;
  completion?: TrainingPeaksOperationalSignalCompletionEvidence | null;
};

export type TrainingPeaksOperationalSignalsSection = {
  key: TrainingPeaksOperationalSignalsSectionKey;
  title: string;
  items: TrainingPeaksOperationalSignalsItem[];
};

export type TrainingPeaksOperationalSignalsSnapshot = {
  scope: TrainingPeaksOperationalSignalsScope;
  sections: TrainingPeaksOperationalSignalsSection[];
  totalBeforeLimit: number;
  overflowCount: number;
};

export type TrainingPeaksHealthSnapshot = {
  lastAttentionDigestCronStatus: string | null;
  runningJobsOlderThanSixHours: number;
};

export type TrainingPeaksCoachCaseDecisionResult =
  | {
      kind: "resolved" | "dismissed";
      caseId: string;
      shortId: string;
      status: Extract<TrainingPeaksCoachCaseStatus, "resolved" | "dismissed">;
    }
  | { kind: "not_found" }
  | { kind: "ambiguous" }
  | { kind: "invalid_prefix" }
  | { kind: "error" };

export type RecordTrainingPeaksReplyDraftFeedbackResult =
  | { kind: "ok"; outcome: "used" | "edited" | "ignored"; draftId: string }
  | { kind: "not_found" }
  | { kind: "already_final"; outcome: TrainingPeaksReplyDraft["outcome"] }
  | { kind: "failed" };

export type RecordTrainingPeaksCoachCaseAndSnapshotInput = {
  studentId: string | null;
  intentLogId?: string | null;
  actionId?: string | null;
  contextObsId?: string | null;
  telegramChatId?: string | null;
  telegramMessageId?: number | null;
  intentStatus?: string | null;
  labels?: readonly string[] | null;
  cacheStatus?: TrainingPeaksStudentContextCacheStatus;
  silenceDays?: number | null;
  lastCoachTouchAt?: string | null;
  unansweredSeconds?: number | null;
  recoveryAlertKind?: TrainingPeaksRecoveryAlertKind | null;
  missedPlannedDates?: string[] | null;
};

export type RecordTrainingPeaksCoachCaseAndSnapshotResult = {
  snapshotId: string | null;
  caseIds: string[];
};

const TRAININGPEAKS_DEFAULT_VISIBLE_COACH_CASE_KINDS: readonly TrainingPeaksCoachCaseKind[] = [
  "pain_or_health_signal",
  "move_workout_needs_review",
];

function readStringRecordValue(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value.trim() : null;
}

function readBooleanRecordValue(record: Record<string, unknown>, key: string): boolean | null {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}

function isTrainingPeaksQuestionCaseMarkedVisibleByPriorityOrStaleness(
  coachNotesJson: Record<string, unknown> | null | undefined
): boolean {
  if (!coachNotesJson) {
    return false;
  }

  const priorityCandidates = [
    readStringRecordValue(coachNotesJson, "priority"),
    readStringRecordValue(coachNotesJson, "question_priority"),
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());
  if (priorityCandidates.some((value) => value === "urgent" || value === "high")) {
    return true;
  }

  const explicitFlags = [
    readBooleanRecordValue(coachNotesJson, "high_priority"),
    readBooleanRecordValue(coachNotesJson, "is_high_priority"),
    readBooleanRecordValue(coachNotesJson, "question_high_priority"),
    readBooleanRecordValue(coachNotesJson, "stale"),
    readBooleanRecordValue(coachNotesJson, "is_stale"),
    readBooleanRecordValue(coachNotesJson, "stale_unanswered"),
    readBooleanRecordValue(coachNotesJson, "is_stale_unanswered"),
  ];
  return explicitFlags.some((value) => value === true);
}

export function isTrainingPeaksCoachCaseVisibleByDefault(input: {
  caseKind: TrainingPeaksCoachCaseKind;
  coachNotesJson?: Record<string, unknown> | null;
}): boolean {
  if (TRAININGPEAKS_DEFAULT_VISIBLE_COACH_CASE_KINDS.includes(input.caseKind)) {
    return true;
  }
  if (input.caseKind !== "question_to_coach") {
    return false;
  }
  return isTrainingPeaksQuestionCaseMarkedVisibleByPriorityOrStaleness(input.coachNotesJson);
}

export function getTrainingPeaksDefaultVisibleCoachCaseKinds(): readonly TrainingPeaksCoachCaseKind[] {
  return TRAININGPEAKS_DEFAULT_VISIBLE_COACH_CASE_KINDS;
}

export type CreateTrainingPeaksGroupMoveRequestCaseInput = {
  message: TelegramMessage;
  student: TrainingPeaksStudent;
  sourceType: "group_topic" | "group_general";
  senderMatchMethod: "telegram_chat_id" | "telegram_username";
  parseGateResult: {
    strictMoveIntent: boolean;
    moveWorkoutCandidate: boolean;
    directMoveWording: boolean;
    coachMentioned: boolean;
    reason: string;
  };
  multiMove: {
    detected: boolean;
    possible: boolean;
    reason: string | null;
    movePairsPreview: Array<{ source: string; target: string }>;
  };
};

export type CreateTrainingPeaksGroupMoveRequestCaseResult =
  | {
      kind: "created";
      caseId: string;
      shortId: string;
      status: TrainingPeaksCoachCaseStatus;
      textPreview: string | null;
    }
  | {
      kind: "duplicate";
      caseId: string;
      shortId: string;
      status: TrainingPeaksCoachCaseStatus;
    }
  | { kind: "failed" };

function buildTrainingPeaksCoachCaseLabelSummary(
  labels: readonly string[] | null | undefined
): Record<string, boolean> {
  const summary: Record<string, boolean> = {};
  for (const label of labels ?? []) {
    if (typeof label !== "string") {
      continue;
    }
    const normalized = label.trim();
    if (!normalized) {
      continue;
    }
    summary[normalized] = true;
  }
  return summary;
}

function buildTrainingPeaksGroupMoveCaseNoteTextPreview(text: string | null): string | null {
  return buildTelegramContextTextPreview(text);
}

function buildTrainingPeaksGroupMoveCaseObservationMetadata(input: {
  message: TelegramMessage;
  sourceType: "group_topic" | "group_general";
  senderMatchMethod: "telegram_chat_id" | "telegram_username";
  parseGateResult: CreateTrainingPeaksGroupMoveRequestCaseInput["parseGateResult"];
  multiMove: CreateTrainingPeaksGroupMoveRequestCaseInput["multiMove"];
}): Record<string, unknown> {
  return {
    scores: {
      move_workout_candidate: 0.91,
    },
    fromId: input.message.from?.id != null ? String(input.message.from.id) : null,
    fromUsername: input.message.from?.username?.trim() || null,
    isTopicMessage: Boolean(input.message.is_topic_message),
    messageLength: (input.message.text ?? input.message.caption ?? "").trim().length,
    hasAttachment: false,
    senderRole: "known_student",
    senderMatchMethod: input.senderMatchMethod,
    parseGateResult: input.parseGateResult,
    multiMove: input.multiMove,
  };
}

function normalizeMovePairsForCaseStorage(
  rawPairs: CreateTrainingPeaksGroupMoveRequestCaseInput["multiMove"]["movePairsPreview"]
): {
  pairs: TrainingPeaksGroupMovePreviewPair[];
  isSafe: boolean;
} {
  return validateTrainingPeaksGroupMovePairsPreview(rawPairs);
}

export async function createTrainingPeaksGroupMoveRequestCase(
  input: CreateTrainingPeaksGroupMoveRequestCaseInput
): Promise<CreateTrainingPeaksGroupMoveRequestCaseResult> {
  const chatId = String(input.message.chat.id);
  const messageId = input.message.message_id;
  const rawText = (input.message.text ?? input.message.caption ?? "").trim();
  const textPreview = buildTrainingPeaksGroupMoveCaseNoteTextPreview(rawText || null);
  const normalizedMovePairs = normalizeMovePairsForCaseStorage(input.multiMove.movePairsPreview);

  try {
    const existingCase = await getTrainingPeaksCoachCaseByTelegramMessageAndKind({
      telegramChatId: chatId,
      telegramMessageId: messageId,
      caseKind: "move_workout_needs_review",
    });

    if (existingCase) {
      return {
        kind: "duplicate",
        caseId: existingCase.id,
        shortId: existingCase.id.slice(0, 8),
        status: existingCase.status,
      };
    }

    const existingObservation = await getTrainingPeaksTelegramContextObservationByChatMessage({
      chatId,
      messageId: String(messageId),
    });

    const contextObservationId =
      existingObservation?.id ??
      (
        await insertTrainingPeaksTelegramContextObservation({
          studentId: input.student.id,
          sourceType: input.sourceType,
          chatId,
          messageThreadId: input.message.message_thread_id ?? null,
          messageId: String(messageId),
          labels: ["move_workout_candidate"],
          textSha256: sha256TelegramContextText(rawText || null),
          textPreview,
          metadata: buildTrainingPeaksGroupMoveCaseObservationMetadata({
            message: input.message,
            sourceType: input.sourceType,
            senderMatchMethod: input.senderMatchMethod,
            parseGateResult: input.parseGateResult,
            multiMove: input.multiMove,
          }),
        })
      ).id;

    const snapshot = await insertTrainingPeaksStudentContextSnapshot({
      studentId: input.student.id,
      cacheStatus: "empty",
      labelSummary: {
        move_workout_candidate: true,
      },
    });

    const insertedCase = await insertTrainingPeaksCoachCase({
      studentId: input.student.id,
      caseKind: "move_workout_needs_review",
      contextObsId: contextObservationId,
      snapshotId: snapshot.id,
      telegramChatId: chatId,
      telegramMessageId: messageId,
      status: "needs_review",
      coachNotesJson: {
        source_type: input.sourceType,
        group_title: input.message.chat.title?.trim() || null,
        message_thread_id: input.message.message_thread_id ?? null,
        sender_user_id: input.message.from?.id ?? null,
        sender_username: input.message.from?.username?.trim() || null,
        text_preview: textPreview,
        parse_gate: input.parseGateResult,
        multi_move_detected: input.multiMove.detected,
        multi_move_possible: input.multiMove.possible,
        move_pairs_preview: normalizedMovePairs.pairs,
        move_pairs_preview_safe: normalizedMovePairs.isSafe,
        multi_move_reason: input.multiMove.reason,
      },
    });

    if (!insertedCase?.id) {
      const caseAfterConflict = await getTrainingPeaksCoachCaseByTelegramMessageAndKind({
        telegramChatId: chatId,
        telegramMessageId: messageId,
        caseKind: "move_workout_needs_review",
      });
      if (caseAfterConflict) {
        return {
          kind: "duplicate",
          caseId: caseAfterConflict.id,
          shortId: caseAfterConflict.id.slice(0, 8),
          status: caseAfterConflict.status,
        };
      }

      return { kind: "failed" };
    }

    return {
      kind: "created",
      caseId: insertedCase.id,
      shortId: insertedCase.id.slice(0, 8),
      status: "needs_review",
      textPreview,
    };
  } catch (error) {
    console.warn("Failed to create TrainingPeaks group move review case", {
      studentId: input.student.id,
      chatId,
      messageId,
      sourceType: input.sourceType,
      error,
    });
    return { kind: "failed" };
  }
}

function deriveTrainingPeaksCoachCaseKinds(input: {
  intentStatus?: string | null;
  actionId?: string | null;
  labels?: readonly string[] | null;
}): TrainingPeaksCoachCaseKind[] {
  const kinds = new Set<TrainingPeaksCoachCaseKind>();
  const labels = input.labels ?? [];

  if (input.intentStatus === "action_created" && input.actionId) {
    kinds.add("move_workout_requested");
  }
  if (input.intentStatus === "needs_review") {
    kinds.add("move_workout_needs_review");
  }
  if (input.intentStatus === "unrecognized") {
    kinds.add("unrecognized_intent");
  }
  if (labels.includes("pain_or_health")) {
    kinds.add("pain_or_health_signal");
  }
  if (labels.includes("question_to_coach")) {
    kinds.add("question_to_coach");
  }

  return [...kinds];
}

export async function recordTrainingPeaksCoachCaseAndSnapshot(
  input: RecordTrainingPeaksCoachCaseAndSnapshotInput
): Promise<RecordTrainingPeaksCoachCaseAndSnapshotResult | null> {
  try {
    if (!input.studentId) {
      return null;
    }

    const snapshot = await insertTrainingPeaksStudentContextSnapshot({
      studentId: input.studentId,
      sourceIntentLogId: input.intentLogId ?? null,
      cacheStatus: input.cacheStatus ?? "empty",
      silenceDays: input.silenceDays ?? null,
      lastCoachTouchAt: input.lastCoachTouchAt ?? null,
      unansweredSeconds: input.unansweredSeconds ?? null,
      recoveryAlertKind: input.recoveryAlertKind ?? null,
      missedPlannedDates: input.missedPlannedDates ?? null,
      labelSummary: buildTrainingPeaksCoachCaseLabelSummary(input.labels),
    });

    const caseIds: string[] = [];
    const caseKinds = deriveTrainingPeaksCoachCaseKinds({
      intentStatus: input.intentStatus,
      actionId: input.actionId ?? null,
      labels: input.labels ?? null,
    });

    for (const caseKind of caseKinds) {
      const inserted = await insertTrainingPeaksCoachCase({
        studentId: input.studentId,
        caseKind,
        intentLogId: input.intentLogId ?? null,
        actionId: input.actionId ?? null,
        contextObsId: input.contextObsId ?? null,
        snapshotId: snapshot.id,
        telegramChatId: input.telegramChatId ?? null,
        telegramMessageId: input.telegramMessageId ?? null,
      });
      if (inserted?.id) {
        caseIds.push(inserted.id);
      }
    }

    return {
      snapshotId: snapshot.id,
      caseIds,
    };
  } catch (error) {
    console.warn("[trainingpeaks-coach-cases] failed to record case ledger", {
      studentId: input.studentId,
      intentLogId: input.intentLogId ?? null,
      actionId: input.actionId ?? null,
      telegramChatId: input.telegramChatId ?? null,
      telegramMessageId: input.telegramMessageId ?? null,
      error,
    });
    return null;
  }
}

async function recordTrainingPeaksCoachActionDecisionContactEvent(
  result: DecideTrainingPeaksActionResult
): Promise<void> {
  if (result.kind === "not_found" || !result.action.studentId) {
    return;
  }

  try {
    await recordTrainingPeaksStudentContactEvent({
      studentId: result.action.studentId,
      eventType: "coach_action_decision",
      source: "admin_action",
      referenceId: result.action.id,
      metadata: {
        action_id: result.action.id,
        action_type: result.action.actionType,
        status: result.action.status,
        decided_by_chat_id: result.action.decidedByChatId,
        decision_message_id: result.action.decisionMessageId,
      },
    });
  } catch (error) {
    console.warn("Failed to record TrainingPeaks coach action decision contact event", {
      actionId: result.action.id,
      studentId: result.action.studentId,
      status: result.action.status,
      error,
    });
  }
}

async function finalizeTrainingPeaksCoachCase(input: {
  caseId: string;
  actorTelegramChatId?: string | null;
  note?: string | null;
  finalStatus: Extract<TrainingPeaksCoachCaseStatus, "resolved" | "dismissed">;
  actionKind: "case_resolved" | "case_dismissed";
}): Promise<TrainingPeaksCoachCaseDecisionResult> {
  try {
    const resolvedLookup: TrainingPeaksCoachCasePrefixLookupResult | { kind: "found"; case: NonNullable<Awaited<ReturnType<typeof getTrainingPeaksCoachCaseById>>> } | { kind: "not_found" } =
      input.caseId.length < 36
        ? await getTrainingPeaksCoachCaseByIdPrefix(input.caseId)
        : await (async () => {
            const coachCase = await getTrainingPeaksCoachCaseById(input.caseId);
            return coachCase ? { kind: "found" as const, case: coachCase } : { kind: "not_found" as const };
          })();

    if (resolvedLookup.kind === "invalid_prefix") {
      return { kind: "invalid_prefix" };
    }

    if (resolvedLookup.kind === "ambiguous") {
      return { kind: "ambiguous" };
    }

    if (resolvedLookup.kind === "not_found") {
      return { kind: "not_found" };
    }

    const coachCase = resolvedLookup.case;
    if (coachCase.status === "resolved" || coachCase.status === "dismissed") {
      return {
        kind: coachCase.status,
        caseId: coachCase.id,
        shortId: coachCase.id.slice(0, 8),
        status: coachCase.status,
      };
    }

    const updatedCase = await updateTrainingPeaksCoachCaseStatus(
      coachCase.id,
      input.finalStatus,
      input.actorTelegramChatId ?? null
    );
    if (!updatedCase) {
      const latestCase = await getTrainingPeaksCoachCaseById(coachCase.id);
      if (latestCase?.status === "resolved" || latestCase?.status === "dismissed") {
        return {
          kind: latestCase.status,
          caseId: latestCase.id,
          shortId: latestCase.id.slice(0, 8),
          status: latestCase.status,
        };
      }
      return { kind: "error" };
    }

    try {
      await insertTrainingPeaksCoachActionTaken({
        caseId: coachCase.id,
        studentId: coachCase.studentId,
        actionKind: input.actionKind,
        source: "telegram_command",
        actorTelegramChatId: input.actorTelegramChatId ?? null,
        note: input.note ?? null,
        metadata: {
          case_kind: coachCase.caseKind,
          previous_status: coachCase.status,
          new_status: input.finalStatus,
        },
      });
    } catch (actionError) {
      console.warn("Failed to insert TrainingPeaks coach action taken", {
        caseId: coachCase.id,
        studentId: coachCase.studentId,
        actionKind: input.actionKind,
        error: actionError,
      });
    }

    if (input.finalStatus === "resolved") {
      try {
        await recordTrainingPeaksStudentContactEvent({
          studentId: coachCase.studentId,
          eventType: "coach_action_decision",
          source: "admin_action",
          referenceId: coachCase.id,
          metadata: {
            case_id: coachCase.id,
            case_kind: coachCase.caseKind,
            action_kind: input.actionKind,
            status: input.finalStatus,
            actor_telegram_chat_id: input.actorTelegramChatId ?? null,
          },
        });
      } catch (contactError) {
        console.warn("Failed to record TrainingPeaks coach case decision contact event", {
          caseId: coachCase.id,
          studentId: coachCase.studentId,
          status: input.finalStatus,
          error: contactError,
        });
      }
    }

    return {
      kind: input.finalStatus,
      caseId: coachCase.id,
      shortId: coachCase.id.slice(0, 8),
      status: input.finalStatus,
    };
  } catch (error) {
    console.warn("Failed to finalize TrainingPeaks coach case", {
      finalStatus: input.finalStatus,
      error,
    });
    return { kind: "error" };
  }
}

export async function resolveTrainingPeaksCoachCase(input: {
  caseId: string;
  actorTelegramChatId?: string | null;
  note?: string | null;
}): Promise<TrainingPeaksCoachCaseDecisionResult> {
  return finalizeTrainingPeaksCoachCase({
    caseId: input.caseId,
    actorTelegramChatId: input.actorTelegramChatId ?? null,
    note: input.note ?? null,
    finalStatus: "resolved",
    actionKind: "case_resolved",
  });
}

export async function dismissTrainingPeaksCoachCase(input: {
  caseId: string;
  actorTelegramChatId?: string | null;
  note?: string | null;
}): Promise<TrainingPeaksCoachCaseDecisionResult> {
  return finalizeTrainingPeaksCoachCase({
    caseId: input.caseId,
    actorTelegramChatId: input.actorTelegramChatId ?? null,
    note: input.note ?? null,
    finalStatus: "dismissed",
    actionKind: "case_dismissed",
  });
}

export async function insertTrainingPeaksReplyDraft(
  input: InsertTrainingPeaksReplyDraftInput
): Promise<TrainingPeaksReplyDraft> {
  return insertTrainingPeaksReplyDraftInRepository(input);
}

export async function recordTrainingPeaksReplyDraftFeedback(input: {
  draftIdOrPrefix: string;
  outcome: "used" | "edited" | "ignored";
  actorTelegramChatId?: string | null;
  note?: string | null;
}): Promise<RecordTrainingPeaksReplyDraftFeedbackResult> {
  try {
    const draft = await getTrainingPeaksReplyDraftByIdPrefixFromRepository(input.draftIdOrPrefix);
    if (!draft) {
      return { kind: "not_found" };
    }

    if (draft.outcome !== "generated") {
      return { kind: "already_final", outcome: draft.outcome };
    }

    const updatedDraft = await updateTrainingPeaksReplyDraftOutcomeInRepository({
      draftId: draft.id,
      outcome: input.outcome,
      coachNote: input.note ?? null,
    } satisfies UpdateTrainingPeaksReplyDraftOutcomeInput);
    if (!updatedDraft) {
      const reloadedDraft = await getTrainingPeaksReplyDraftByIdPrefixFromRepository(draft.id);
      if (reloadedDraft && reloadedDraft.outcome !== "generated") {
        return { kind: "already_final", outcome: reloadedDraft.outcome };
      }
      return { kind: "failed" };
    }

    const actionKind =
      input.outcome === "used"
        ? "reply_draft_used"
        : input.outcome === "edited"
          ? "reply_draft_edited"
          : "reply_draft_ignored";

    try {
      await insertTrainingPeaksCoachActionTaken({
        caseId: updatedDraft.caseId,
        studentId: updatedDraft.studentId,
        actionKind,
        source: "telegram_command",
        actorTelegramChatId: input.actorTelegramChatId ?? null,
        note: input.note ?? null,
        metadata: {
          draft_id: updatedDraft.id,
          outcome: input.outcome,
        },
      });
    } catch (actionError) {
      console.warn("Failed to insert TrainingPeaks reply draft feedback action", {
        draftId: updatedDraft.id,
        studentId: updatedDraft.studentId,
        actionKind,
        error: actionError,
      });
    }

    if (input.outcome === "used" || input.outcome === "edited") {
      try {
        await recordTrainingPeaksStudentContactEvent({
          studentId: updatedDraft.studentId,
          eventType: "coach_action_decision",
          source: "admin_action",
          referenceId: updatedDraft.id,
          metadata: {
            kind: "reply_draft_feedback",
            outcome: input.outcome,
          },
        });
      } catch (contactError) {
        console.warn("Failed to record TrainingPeaks reply draft feedback contact event", {
          draftId: updatedDraft.id,
          studentId: updatedDraft.studentId,
          outcome: input.outcome,
          error: contactError,
        });
      }
    }

    return {
      kind: "ok",
      outcome: input.outcome,
      draftId: updatedDraft.id,
    };
  } catch (error) {
    console.warn("Failed to record TrainingPeaks reply draft feedback", {
      draftIdOrPrefix: input.draftIdOrPrefix,
      outcome: input.outcome,
      error,
    });
    return { kind: "failed" };
  }
}

export async function listRecentTrainingPeaksCoachCases(input?: {
  limit?: number;
  statuses?: readonly TrainingPeaksCoachCaseStatus[];
}): Promise<
  Array<{
    id: string;
    shortId: string;
    studentId: string;
    studentName: string | null;
    caseKind: TrainingPeaksCoachCaseKind;
    status: TrainingPeaksCoachCaseStatus;
    createdAt: string;
    previewText: string | null;
    coachNotesJson: Record<string, unknown>;
  }>
> {
  const rows = await listRecentTrainingPeaksCoachCasesFromRepository({
    limit: input?.limit ?? 5,
    statuses: input?.statuses,
  });

  return rows.map((row) => ({
    ...row,
    shortId: row.id.slice(0, 8),
  }));
}

export async function listTrainingPeaksCoachCases(input?: {
  limit?: number;
  offset?: number;
  statusFilter?: readonly TrainingPeaksCoachCaseStatus[];
  caseKindFilter?: readonly TrainingPeaksCoachCaseKind[];
  studentQuery?: string | null;
}): Promise<{
  items: Array<{
    id: string;
    shortId: string;
    studentId: string;
    studentName: string | null;
    caseKind: TrainingPeaksCoachCaseKind;
    status: TrainingPeaksCoachCaseStatus;
    createdAt: string;
    previewText: string | null;
    coachNotesJson: Record<string, unknown>;
  }>;
  total: number;
}> {
  const result = await listTrainingPeaksCoachCasesFromRepository({
    limit: input?.limit ?? 5,
    offset: input?.offset ?? 0,
    statusFilter: input?.statusFilter,
    caseKindFilter: input?.caseKindFilter,
    studentQuery: input?.studentQuery,
  });

  return {
    items: result.items.map((row) => ({
      ...row,
      shortId: row.id.slice(0, 8),
    })),
    total: result.total,
  };
}

export async function getTrainingPeaksCoachCaseByShortId(input: {
  prefix: string;
}): Promise<
  | { kind: "found"; case: TrainingPeaksCoachCase }
  | { kind: "not_found" }
  | { kind: "ambiguous" }
  | { kind: "invalid_prefix" }
> {
  const lookup = await getTrainingPeaksCoachCaseByIdPrefix(input.prefix);
  if (lookup.kind === "invalid_prefix") {
    return { kind: "invalid_prefix" };
  }
  if (lookup.kind === "not_found") {
    return { kind: "not_found" };
  }
  if (lookup.kind === "ambiguous") {
    return { kind: "ambiguous" };
  }

  const details = await getTrainingPeaksCoachCaseDetailsById(lookup.case.id);
  if (!details) {
    return { kind: "not_found" };
  }
  return { kind: "found", case: details };
}

export async function countActiveTrainingPeaksCoachCases(
  statuses: readonly TrainingPeaksCoachCaseStatus[]
): Promise<number> {
  return countActiveTrainingPeaksCoachCasesInRepository(statuses);
}

const TP_ADD_STUDENT_COMMAND_PATTERN = /^\/tp_add_student(?:@\w+)?(?:\s+|$)/;
const TP_RUN_WEEK_COMMAND_PATTERN = /^\/tp_run_week(?:@\w+)?(?:\s+|$)/;
const TP_TELEGRAM_LINK_CODE_PATTERN = /\b[A-Z0-9]{2,12}-\d{3,6}\b/gi;
const TP_TELEGRAM_LINK_CODE_DEFAULT_TTL_HOURS = 24;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** Explicit reschedule verbs — substring match on normalizeRussianText output. */
const TP_STRICT_MOVE_VERBS = [
  "перенеси",
  "перенести",
  "переставь",
  "переставить",
  "передвинь",
  "сдвинь",
  "перенесем",
  "сместим",
  "можно перенести",
  "перенесите",
  "поставьте",
  "поставить",
  "поставим",
  "сделаю",
  "отработаю",
  "поставь на",
];

/** Reschedule intent without an explicit verb — requires workout + date elsewhere in the gate. */
const TP_SOFT_MOVE_INTENT_PATTERNS: RegExp[] = [
  /(?:^|[\s,.])давай\s+.+\s+(?:на\s+)?завтра(?:[\s,.]|$)/u,
  /(?:^|[\s,.])(?:можно|лучше)\s+.+\s+(?:на\s+)?завтра(?:[\s,.]|$)/u,
  /(?:^|[\s,.])(?:можно|давайте|лучше)\s+интерв[\p{L}\p{N}_-]*(?:\s+.+)?\s+(?:на\s+)?завтра(?:[\s,.]|$)/u,
  /(?:^|[\s,.])интерв[\p{L}\p{N}_-]+(?:\s+.+)?\s+(?:на\s+)?завтра(?:[\s,.]|$)/u,
  /(?:^|[\s,.])(?:\d{1,2}\s*[xх×]\s*\d{1,2}|\d{1,2}\s+по\s+\d{1,2})(?:\s+.+)?\s+(?:на\s+)?завтра(?:[\s,.]|$)/u,
  /(?:^|[\s,.])интервальн[\p{L}\p{N}_-]+\s+(?:на\s+)?завтра(?:[\s,.]|$)/u,
  /(?:^|[\s,.])(?:лучше\s+)?(?:сделаю|отработаю)\s+.+\s+заранее(?:[\s,.]|$)/u,
  /(?:^|[\s,.])(?:сделаю|отработаю)\s+.+\s+(?:на\s+)?завтра(?:[\s,.]|$)/u,
  /(?:^|[\s,.])(?:можно|давайте)\s+(?:на\s+)?завтра\s+(?:сделаю|отработаю)?\s*.+(?:[\s,.]|$)/u,
  /(?:^|[\s,.])(?:лучше\s+)?(?:сделаю|отработаю)\s+интерв[\p{L}\p{N}_-]*(?:\s+заранее)?(?:[\s,.]|$)/u,
  /(?:^|[\s,.])поставь\s+.+\s+на\s+/u,
  /(?:^|[\s,.])поставьте\s+.+\s+(?:на\s+)?(?:завтра|[а-яa-z0-9./-]+)/u,
  /(?:^|[\s,.])[\p{L}\p{N}_-]+\s+давай\s+(?:на\s+)?завтра(?:[\s,.]|$)/u,
  /(?:^|[\s,.])давай\s+(?:на\s+)?завтра(?:[\s,.]|$)/u,
];

const MOVE_WORKOUT_MIN_ACCEPT_CONFIDENCE = 0.75;

const TP_MOVE_WORKOUT_BLOCKED_CASUAL_PATTERNS: RegExp[] = [
  /^ок(?:\s*[!.]*)?$/,
  /^спасибо\b/,
  /^завтра\s+сделаю(?:[\s!.?]*)$/u,
  /\bсегодня\s+не\s+успеваю\b/,
  /^можно\s+завтра\??$/,
  /\bя\s+сегодня\s+не\s+бегу\b/,
  /\bотчет\s+отправил\b/,
  /\bотчёт\s+отправил\b/,
  /^завтра\s+пробегу(?:[\s!.?]*)$/u,
  /^а\s+можно\s+завтра\??$/,
  /^давай\s+завтра$/,
  /\bсегодня\s+не\s+получится\b/,
  /\bу\s+меня\s+болит\s+ног/,
];
const TP_MOVE_WORKOUT_FUTURE_REPORT_PROMISE_PATTERNS: RegExp[] = [
  /(?:^|\s)как\s+(?:сделаю|пробегу)(?:\s|$).*?(?:^|\s)(?:отпишу(?:сь)?|напишу|сообщу)(?:\s|$)/u,
  /(?:^|\s)сделаю(?:\s|$).*?(?:^|\s)и\s+отпишусь(?:\s|$)/u,
  /(?:^|\s)сделаю(?:\s|$).*?(?:^|\s)(?:отпишу(?:сь)?|напишу|сообщу)(?:\s|$)/u,
  /(?:^|\s)после\s+(?:тренировки|пробежки)(?:\s|$).*?(?:^|\s)(?:отпишу(?:сь)?|напишу|сообщу)(?:\s|$)/u,
  /(?:^|\s)потом\s+(?:отпишу(?:сь)?|напишу|сообщу)(?:\s|$)/u,
  /(?:^|\s)буду\s+делать(?:\s|$).*?(?:^|\s)(?:отпишу(?:сь)?|напишу|сообщу)(?:\s|$)/u,
  /(?:^|\s)спасибо(?:\s|$).*?(?:^|\s)(?:отпишу(?:сь)?|напишу|сообщу)(?:\s|$)/u,
];
const TP_RUN_WEEK_USAGE_MESSAGE = [
  "Напиши так:",
  "/tp_run_week last",
  "или",
  "/tp_run_week 2026-04-27 2026-05-03",
].join("\n");

function normalizeStudentQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru");
}

function normalizeRussianText(value: string): string {
  return value
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/[.,!?;:()"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const TP_WEEKDAY_ALIASES: Record<string, string> = {
  пн: "monday",
  понедельник: "monday",
  понедельника: "monday",
  вт: "tuesday",
  вторник: "tuesday",
  вторника: "tuesday",
  ср: "wednesday",
  среда: "wednesday",
  среду: "wednesday",
  среды: "wednesday",
  чт: "thursday",
  четверг: "thursday",
  четверга: "thursday",
  пт: "friday",
  пятница: "friday",
  пятницу: "friday",
  пятницы: "friday",
  пятничную: "friday",
  сб: "saturday",
  суббота: "saturday",
  субботу: "saturday",
  субботы: "saturday",
  субботнюю: "saturday",
  вс: "sunday",
  воскресенье: "sunday",
  воскресенья: "sunday",
  воскресную: "sunday",
  воскресеньею: "sunday",
  воскресеньея: "sunday",
};

const TP_PARSER_TIMEZONE = "Europe/Belgrade";
const ISO_YMD_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function getBelgradeDateParts(value: Date): { year: number; month: number; day: number; weekday: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TP_PARSER_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = formatter.formatToParts(value);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? "");
  const month = Number(parts.find((part) => part.type === "month")?.value ?? "");
  const day = Number(parts.find((part) => part.type === "day")?.value ?? "");
  const weekdayRaw = (parts.find((part) => part.type === "weekday")?.value ?? "").toLowerCase();
  const weekdayMap: Record<string, number> = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
  };
  const weekday = weekdayMap[weekdayRaw];
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day) || weekday === undefined) {
    throw new Error(`Unable to derive parser date parts for ${value.toISOString()}`);
  }
  return { year, month, day, weekday };
}

function toIsoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addLocalDaysIso(isoDate: string, days: number): string {
  const match = isoDate.match(ISO_YMD_PATTERN);
  if (!match) {
    return isoDate;
  }
  const shifted = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days, 12, 0, 0));
  const parts = getBelgradeDateParts(shifted);
  return toIsoDate(parts.year, parts.month, parts.day);
}

function getParserBaseDate(context?: { messageDateUnix?: number | null }): Date {
  const messageUnix = context?.messageDateUnix;
  if (typeof messageUnix === "number" && Number.isFinite(messageUnix) && messageUnix > 0) {
    return new Date(messageUnix * 1000);
  }
  const envBaseDate = process.env.TP_MOVE_DATE_BASE_DATE?.trim();
  if (envBaseDate && ISO_DATE_PATTERN.test(envBaseDate)) {
    const match = envBaseDate.match(ISO_YMD_PATTERN);
    if (match) {
      return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0));
    }
  }
  return new Date();
}

function getParserBaseDateSource(
  context?: { messageDateUnix?: number | null }
): "message_timestamp" | "env_override" | "server_now" {
  const messageUnix = context?.messageDateUnix;
  if (typeof messageUnix === "number" && Number.isFinite(messageUnix) && messageUnix > 0) {
    return "message_timestamp";
  }
  const envBaseDate = process.env.TP_MOVE_DATE_BASE_DATE?.trim();
  if (envBaseDate && ISO_DATE_PATTERN.test(envBaseDate)) {
    return "env_override";
  }
  return "server_now";
}

function resolveRelativeDayIso(
  value: "today" | "tomorrow" | "day_after_tomorrow" | "yesterday",
  baseDate: Date
): string {
  const base = getBelgradeDateParts(baseDate);
  const baseIso = toIsoDate(base.year, base.month, base.day);
  if (value === "today") {
    return baseIso;
  }
  if (value === "tomorrow") {
    return addLocalDaysIso(baseIso, 1);
  }
  if (value === "day_after_tomorrow") {
    return addLocalDaysIso(baseIso, 2);
  }
  return addLocalDaysIso(baseIso, -1);
}

function resolveWeekdayIso(value: string, baseDate: Date, direction: "next" | "previous"): string | null {
  const weekdayMap: Record<string, number> = {
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
    sunday: 0,
  };
  const target = weekdayMap[value];
  if (target === undefined) {
    return null;
  }
  const base = getBelgradeDateParts(baseDate);
  const baseIso = toIsoDate(base.year, base.month, base.day);
  if (direction === "next") {
    let delta = (target - base.weekday + 7) % 7;
    if (delta === 0) {
      delta = 7;
    }
    return addLocalDaysIso(baseIso, delta);
  }
  const deltaBack = (base.weekday - target + 7) % 7;
  return addLocalDaysIso(baseIso, -deltaBack);
}

function resolveTimeRefToDateIso(
  ref: TrainingPeaksMoveWorkoutTimeRef | null | undefined,
  baseDate: Date,
  direction: "next" | "previous"
): string | null {
  if (!ref) {
    return null;
  }
  if (ref.kind === "date") {
    return ref.value;
  }
  if (ref.kind === "relative_day") {
    if (ref.value === "today" || ref.value === "tomorrow" || ref.value === "day_after_tomorrow" || ref.value === "yesterday") {
      return resolveRelativeDayIso(ref.value, baseDate);
    }
    return null;
  }
  return resolveWeekdayIso(ref.value, baseDate, direction);
}

const TP_RELATIVE_DAY_ALIASES: Record<string, string> = {
  сегодня: "today",
  сегодняшнюю: "today",
  сегодняшний: "today",
  сегодняшней: "today",
  "сегодняшнюю тренировку": "today",
  завтра: "tomorrow",
  завтрашнюю: "tomorrow",
  послезавтра: "day_after_tomorrow",
  вчера: "yesterday",
  вчерашнюю: "yesterday",
  вчерашний: "yesterday",
  вчерашней: "yesterday",
};

const TP_MONTH_ALIASES: Record<string, number> = {
  января: 1,
  февраля: 2,
  марта: 3,
  апреля: 4,
  мая: 5,
  июня: 6,
  июля: 7,
  августа: 8,
  сентября: 9,
  октября: 10,
  ноября: 11,
  декабря: 12,
};

type IndexedTimeRef = TrainingPeaksMoveWorkoutTimeRef & { index: number };
type IndexedWordToken = { token: string; index: number };

function clampMoveWorkoutConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return Number(value.toFixed(2));
}

function parseIsoDateParts(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    return null;
  }
  return dt.toISOString().slice(0, 10);
}

function normalizeTimeRef(ref: TrainingPeaksMoveWorkoutTimeRef): TrainingPeaksMoveWorkoutTimeRef {
  return ref;
}

function inferSharedMonthSourceRef(sourceSegment: string, targetRef: IndexedTimeRef): IndexedTimeRef | null {
  if (targetRef.kind !== "date") {
    return null;
  }
  const sourceDayMatch = sourceSegment.trim().match(/^(\d{1,2})$/);
  if (!sourceDayMatch) {
    return null;
  }
  const sourceDay = Number(sourceDayMatch[1]);
  const targetDateMatch = targetRef.value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!targetDateMatch) {
    return null;
  }
  const year = Number(targetDateMatch[1]);
  const month = Number(targetDateMatch[2]);
  const inferredIso = parseIsoDateParts(year, month, sourceDay);
  if (!inferredIso) {
    return null;
  }
  return {
    kind: "date",
    value: inferredIso,
    sourceText: sourceDayMatch[1] ?? sourceSegment.trim(),
    index: 0,
  };
}

function toTimeRefWithoutIndex(ref: IndexedTimeRef): TrainingPeaksMoveWorkoutTimeRef {
  return {
    kind: ref.kind,
    value: ref.value,
    sourceText: ref.sourceText,
  };
}

function uniqueTimeRefs(refs: IndexedTimeRef[]): IndexedTimeRef[] {
  const seen = new Set<string>();
  const deduped: IndexedTimeRef[] = [];
  for (const item of refs) {
    const key = `${item.kind}:${item.value}:${item.sourceText}:${item.index}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }
  return deduped.sort((a, b) => a.index - b.index);
}

function extractWordTokens(normalized: string): IndexedWordToken[] {
  const tokens: IndexedWordToken[] = [];
  const tokenPattern = /[а-яёa-z-]+/g;
  let match = tokenPattern.exec(normalized);
  while (match) {
    tokens.push({ token: match[0] ?? "", index: match.index });
    match = tokenPattern.exec(normalized);
  }
  return tokens;
}

function tokenLooksLikeWorkoutSourceAttachment(token: string | undefined): boolean {
  if (!token) {
    return false;
  }
  const workoutNeedles = ["бег", "пробеж", "трениров", "интервал", "темпов", "длительн", "легк", "заняти"];
  return workoutNeedles.some((needle) => token.includes(needle));
}

function isInsideExplicitSourceTargetPair(normalized: string, tokenIndex: number): boolean {
  const pairPattern = /с(?:о)?\s+(.+?)\s+на\s+(.+?)(?=$|[,.!?])/g;
  let pairMatch = pairPattern.exec(normalized);
  while (pairMatch) {
    const fullMatch = pairMatch[0] ?? "";
    const pairStart = pairMatch.index;
    const pairEnd = pairStart + fullMatch.length;
    if (tokenIndex >= pairStart && tokenIndex < pairEnd) {
      return true;
    }
    pairMatch = pairPattern.exec(normalized);
  }
  return false;
}

function isContextDateToken(normalized: string, tokenIndex: number): boolean {
  if (isInsideExplicitSourceTargetPair(normalized, tokenIndex)) {
    return false;
  }

  const tokens = extractWordTokens(normalized);
  const tokenPos = tokens.findIndex((item) => item.index === tokenIndex);
  if (tokenPos < 0) {
    return false;
  }

  const token = tokens[tokenPos]?.token ?? "";
  const prev = tokens[tokenPos - 1]?.token;
  const next = tokens[tokenPos + 1]?.token;
  const window = tokens.slice(Math.max(0, tokenPos - 3), Math.min(tokens.length, tokenPos + 4)).map((item) => item.token);

  const hasReasonMarker = prev === "после" || prev === "из-за" || prev === "изза";
  const hasMoveVerbNearby = window.some(
    (item) =>
      item.startsWith("перенес") || item.startsWith("перенести") || item.startsWith("перенош") || item.startsWith("сдвин")
  );
  const hasContextStateWord = window.some((item) =>
    [
      "был",
      "была",
      "было",
      "были",
      "делал",
      "делала",
      "делали",
      "ходил",
      "ходила",
      "ходили",
      "бегал",
      "бегала",
      "бегали",
      "устал",
      "устала",
      "устали",
      "плохо",
      "болит",
      "болел",
      "болела",
      "болели",
      "успеваю",
      "восстановился",
      "восстановилась",
      "восстановились",
      "спал",
      "спала",
      "спали",
      "выспался",
      "выспалась",
      "выспались",
    ].includes(item)
  );
  const hasContextActivity = window.some((item) =>
    ["хайкинг", "гонка", "гонки", "забег", "соревнования", "марафон"].includes(item)
  );
  const hasNegatedRecoveryState =
    window.includes("не") &&
    window.some((item) => item.includes("успева") || item.includes("спал") || item.includes("выспал") || item.includes("восстанов"));
  const hasWorkoutAttachment = tokenLooksLikeWorkoutSourceAttachment(next) || tokenLooksLikeWorkoutSourceAttachment(prev);
  const isAdjectivalSourceToken = token.startsWith("вчераш") || token.startsWith("сегодняш");

  if (hasWorkoutAttachment) {
    return false;
  }

  if (isAdjectivalSourceToken && hasMoveVerbNearby && !hasReasonMarker) {
    return false;
  }

  return hasReasonMarker || hasContextStateWord || hasContextActivity || hasNegatedRecoveryState;
}

function extractDateRefs(normalized: string): IndexedTimeRef[] {
  const result: IndexedTimeRef[] = [];
  const now = new Date();

  const isoInlinePattern = /\b(\d{4}-\d{2}-\d{2})\b/g;
  let isoMatch = isoInlinePattern.exec(normalized);
  while (isoMatch) {
    const isoValue = isoMatch[1];
    if (isoValue && ISO_DATE_PATTERN.test(isoValue) && typeof isoMatch.index === "number") {
      result.push({ kind: "date", value: isoValue, sourceText: isoMatch[0], index: isoMatch.index });
    }
    isoMatch = isoInlinePattern.exec(normalized);
  }

  const dottedPattern = /(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/g;
  let match = dottedPattern.exec(normalized);
  while (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const yearRaw = match[3] ? Number(match[3]) : now.getUTCFullYear();
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    const iso = parseIsoDateParts(year, month, day);
    if (iso && typeof match.index === "number") {
      result.push({ kind: "date", value: iso, sourceText: match[0], index: match.index });
    }
    match = dottedPattern.exec(normalized);
  }

  const monthNames = Object.keys(TP_MONTH_ALIASES).join("|");
  const monthPattern = new RegExp(`(\\d{1,2})\\s+(${monthNames})(?:\\s+(\\d{4}))?`, "g");
  let monthMatch = monthPattern.exec(normalized);
  while (monthMatch) {
    const day = Number(monthMatch[1]);
    const month = TP_MONTH_ALIASES[monthMatch[2] ?? ""] ?? 0;
    const year = monthMatch[3] ? Number(monthMatch[3]) : now.getUTCFullYear();
    const iso = parseIsoDateParts(year, month, day);
    if (iso && typeof monthMatch.index === "number") {
      result.push({ kind: "date", value: iso, sourceText: monthMatch[0], index: monthMatch.index });
    }
    monthMatch = monthPattern.exec(normalized);
  }

  return uniqueTimeRefs(result);
}

function extractWeekdayAndRelativeRefs(normalized: string): IndexedTimeRef[] {
  const refs: IndexedTimeRef[] = [];
  const tokenPattern = /[а-яa-z]+/g;
  let tokenMatch = tokenPattern.exec(normalized);
  while (tokenMatch) {
    const token = tokenMatch[0];
    const weekday = TP_WEEKDAY_ALIASES[token];
    if (weekday) {
      refs.push({ kind: "weekday", value: weekday, sourceText: token, index: tokenMatch.index });
      tokenMatch = tokenPattern.exec(normalized);
      continue;
    }
    const relative = TP_RELATIVE_DAY_ALIASES[token];
    if (relative) {
      refs.push({ kind: "relative_day", value: relative, sourceText: token, index: tokenMatch.index });
    }
    tokenMatch = tokenPattern.exec(normalized);
  }
  return uniqueTimeRefs(refs);
}

function extractWorkoutDescriptor(rawText: string, normalized: string): TrainingPeaksMoveWorkoutDescriptor | null {
  const reference = normalizeWorkoutReference(normalized);
  if (reference.kind === "unknown") {
    if (normalized.includes("заняти")) {
      return {
        raw: rawText.trim(),
        type: "unknown",
        confidence: 0.65,
      };
    }
    return null;
  }

  const confidenceByLevel = { high: 0.9, medium: 0.82, low: 0.75 } as const;
  const confidence = confidenceByLevel[reference.confidence];

  if (normalized.includes("легк")) {
    return { raw: rawText.trim(), type: "easy_run", confidence: 0.9 };
  }
  if (reference.kind === "long_run") {
    return { raw: rawText.trim(), type: "long_run", confidence };
  }
  if (reference.kind === "intervals") {
    return { raw: rawText.trim(), type: "interval", confidence };
  }
  if (reference.kind === "tempo") {
    return { raw: rawText.trim(), type: "tempo", confidence };
  }
  if (reference.matchedAlias === "бег" || reference.matchedAlias === "пробежк") {
    return { raw: rawText.trim(), type: "run", confidence };
  }

  return {
    raw: rawText.trim(),
    type: "unknown",
    confidence,
  };
}

function logIgnoredTrainingPeaksMoveParser(kind: string, rawText: string): void {
  if (process.env.TRAININGPEAKS_MOVE_PARSER_DEBUG?.trim() === "1") {
    console.debug(`[trainingpeaks-move-parser] ignored_non_action ${kind}: ${JSON.stringify(rawText)}`);
  }
}

function matchesCasualNonMoveTrainingChat(normalized: string): boolean {
  return (
    TP_MOVE_WORKOUT_BLOCKED_CASUAL_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    matchesFutureReportPromise(normalized)
  );
}

function matchesFutureReportPromise(normalized: string): boolean {
  return TP_MOVE_WORKOUT_FUTURE_REPORT_PROMISE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function hasStrictMoveVerb(normalized: string): boolean {
  if (TP_STRICT_MOVE_VERBS.some((verb) => normalized.includes(verb))) {
    return true;
  }
  return TP_SOFT_MOVE_INTENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

function hasStrictWorkoutObject(normalized: string): boolean {
  if (hasRecognizedWorkoutReference(normalized)) {
    return true;
  }
  if (normalized.includes("заняти")) {
    return true;
  }
  return false;
}

function hasExplicitMoveTargetReference(normalized: string): boolean {
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(normalized)) {
    return true;
  }
  if (/\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?/.test(normalized)) {
    return true;
  }
  const monthNames = Object.keys(TP_MONTH_ALIASES).join("|");
  if (new RegExp(`\\d{1,2}\\s+(${monthNames})`).test(normalized)) {
    return true;
  }
  for (const rel of Object.keys(TP_RELATIVE_DAY_ALIASES)) {
    if (normalized.includes(rel)) {
      return true;
    }
  }
  if (normalized.includes("заранее")) {
    return true;
  }
  const weekdayNeedles = [
    "понедельник",
    "понедельника",
    "вторник",
    "вторника",
    "среду",
    "среда",
    "среды",
    "четверг",
    "четверга",
    "пятницу",
    "пятница",
    "пятницы",
    "субботу",
    "суббота",
    "субботы",
    "воскресенье",
    "воскресенья",
  ];
  for (const w of weekdayNeedles) {
    if (normalized.includes(w)) {
      return true;
    }
  }
  const shortAliases = new Set(["пн", "вт", "ср", "чт", "пт", "сб", "вс"]);
  return normalized.split(/[\s,.!?;:]+/).some((token) => shortAliases.has(token));
}

function passesStrictMoveWorkoutIntentGate(normalized: string): boolean {
  if (!normalized || matchesCasualNonMoveTrainingChat(normalized)) {
    return false;
  }
  return hasStrictMoveVerb(normalized) && hasStrictWorkoutObject(normalized) && hasExplicitMoveTargetReference(normalized);
}

export function passesTrainingPeaksStrictMoveWorkoutIntentGate(rawText: string): boolean {
  const normalized = normalizeRussianText(rawText);
  return Boolean(normalized && passesStrictMoveWorkoutIntentGate(normalized));
}

function isParseableMoveWorkoutTimeRef(ref: TrainingPeaksMoveWorkoutTimeRef): boolean {
  if (!ref?.kind || typeof ref.value !== "string" || !ref.value.trim()) {
    return false;
  }
  if (ref.kind === "date") {
    return ISO_DATE_PATTERN.test(ref.value);
  }
  if (ref.kind === "relative_day") {
    return ["yesterday", "today", "tomorrow", "day_after_tomorrow"].includes(ref.value);
  }
  if (ref.kind === "weekday") {
    return ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].includes(ref.value);
  }
  return false;
}

function acceptsMoveWorkoutParseResult(
  payload: ParsedTrainingPeaksMoveWorkoutPayload,
  confidence: number,
  normalizedMessage: string
): boolean {
  if (payload.actionType !== "move_workout") {
    return false;
  }
  if (payload.needsClarification) {
    return false;
  }
  if (confidence < MOVE_WORKOUT_MIN_ACCEPT_CONFIDENCE) {
    return false;
  }
  if (!payload.target || !isParseableMoveWorkoutTimeRef(payload.target)) {
    return false;
  }
  if (!passesStrictMoveWorkoutIntentGate(normalizedMessage)) {
    return false;
  }
  return true;
}

function resolveDeterministicMoveWorkout(
  rawText: string,
  context?: { messageDateUnix?: number | null }
): ParseTrainingPeaksMoveWorkoutResult & { deterministicReason?: string } {
  const parserBaseDate = getParserBaseDate(context);
  const normalized = normalizeRussianText(rawText);
  if (!normalized || !passesStrictMoveWorkoutIntentGate(normalized)) {
    return { ok: false, reason: "not_move_request" };
  }

  const refs = uniqueTimeRefs([...extractDateRefs(normalized), ...extractWeekdayAndRelativeRefs(normalized)]);
  const pairPattern = /с(?:о)?\s+(.+?)\s+на\s+(.+?)(?=$|[,.!?])/g;
  const pairMatches: Array<{ source: IndexedTimeRef; target: IndexedTimeRef }> = [];
  let sourceDateInferredFromTargetMonth = false;
  let pairMatch = pairPattern.exec(normalized);
  while (pairMatch) {
    const sourceSegment = pairMatch[1] ?? "";
    const targetSegment = pairMatch[2] ?? "";
    const sourceInSegment = uniqueTimeRefs([
      ...extractDateRefs(sourceSegment),
      ...extractWeekdayAndRelativeRefs(sourceSegment),
    ]);
    const targetInSegment = uniqueTimeRefs([
      ...extractDateRefs(targetSegment),
      ...extractWeekdayAndRelativeRefs(targetSegment),
    ]);
    if (sourceInSegment.length === 1 && targetInSegment.length === 1) {
      pairMatches.push({ source: sourceInSegment[0]!, target: targetInSegment[0]! });
    } else if (
      sourceInSegment.length === 0 &&
      targetInSegment.length === 1 &&
      targetInSegment[0]!.kind === "date"
    ) {
      const inferredSource = inferSharedMonthSourceRef(sourceSegment, targetInSegment[0]!);
      if (inferredSource) {
        pairMatches.push({ source: inferredSource, target: targetInSegment[0]! });
        sourceDateInferredFromTargetMonth = true;
      }
    }
    pairMatch = pairPattern.exec(normalized);
  }

  let source: TrainingPeaksMoveWorkoutTimeRef | null = null;
  let target: TrainingPeaksMoveWorkoutTimeRef | null = null;
  let needsClarification = false;
  let clarificationReason: string | null = null;

  if (pairMatches.length > 1) {
    return { ok: false, reason: "ambiguous_target_day", deterministicReason: "multiple source-target pairs" };
  }

  if (pairMatches.length === 1) {
    source = normalizeTimeRef(pairMatches[0]!.source);
    target = normalizeTimeRef(pairMatches[0]!.target);
  } else {
    const targetCandidatePattern = /на\s+([а-яa-z0-9./-]+(?:\s+[а-яa-z0-9./-]+)?)/g;
    const targetCandidates: IndexedTimeRef[] = [];
    let targetMatch = targetCandidatePattern.exec(normalized);
    while (targetMatch) {
      const chunk = targetMatch[1] ?? "";
      const refsInChunk = uniqueTimeRefs([...extractDateRefs(chunk), ...extractWeekdayAndRelativeRefs(chunk)]).map((item) => ({
        ...item,
        index: targetMatch!.index + item.index,
      }));
      if (refsInChunk.length === 1) {
        targetCandidates.push(refsInChunk[0]!);
      }
      targetMatch = targetCandidatePattern.exec(normalized);
    }

    const uniqueTargets = uniqueTimeRefs(targetCandidates);
    if (uniqueTargets.length === 1) {
      target = normalizeTimeRef(uniqueTargets[0]!);
      const sourceCandidates = refs.filter((item) => {
        if (item.index === uniqueTargets[0]!.index) {
          return false;
        }
        if (item.kind === uniqueTargets[0]!.kind && item.value === uniqueTargets[0]!.value) {
          return false;
        }
        if (
          item.kind === "relative_day" &&
          (item.value === "yesterday" || item.value === "today") &&
          isContextDateToken(normalized, item.index)
        ) {
          return false;
        }
        return true;
      });
      if (sourceCandidates.length === 1) {
        source = normalizeTimeRef(sourceCandidates[0]!);
      } else if (sourceCandidates.length > 1) {
        needsClarification = true;
        clarificationReason = "source day is ambiguous";
      }
    } else if (uniqueTargets.length > 1) {
      return { ok: false, reason: "ambiguous_target_day", deterministicReason: "multiple explicit targets" };
    } else if (refs.length === 1) {
      target = normalizeTimeRef(refs[0]!);
    } else if (refs.length === 2) {
      const rel = refs.filter((item) => item.kind === "relative_day");
      if (rel.length === 2 && rel.some((item) => item.value === "today") && rel.some((item) => item.value === "tomorrow")) {
        source = normalizeTimeRef(rel.find((item) => item.value === "today")!);
        target = normalizeTimeRef(rel.find((item) => item.value === "tomorrow")!);
      } else {
        return { ok: false, reason: "ambiguous_target_day", deterministicReason: "multiple time references" };
      }
    } else if (refs.length > 1) {
      return { ok: false, reason: "ambiguous_target_day", deterministicReason: "multiple time references" };
    }
  }

  if (!target && normalized.includes("заранее")) {
    target = {
      kind: "relative_day",
      value: "tomorrow",
      sourceText: "заранее",
    };
  }

  if (!target) {
    return { ok: false, reason: "no_target_day" };
  }

  if (target.kind === "relative_day" && target.value === "today" && !source) {
    needsClarification = true;
    clarificationReason = clarificationReason ?? "target day equals today";
  }

  const workoutDescriptor = extractWorkoutDescriptor(rawText, normalized);
  const baseConfidence = source ? 0.92 : 0.8;
  const descriptorBonus = workoutDescriptor ? 0.04 : -0.08;
  const clarificationPenalty = needsClarification ? -0.2 : 0;
  const confidence = clampMoveWorkoutConfidence(baseConfidence + descriptorBonus + clarificationPenalty);
  const normalizedSource = source ? toTimeRefWithoutIndex(source as IndexedTimeRef) : null;
  const normalizedTarget = toTimeRefWithoutIndex(target as IndexedTimeRef);

  const payload: ParsedTrainingPeaksMoveWorkoutPayload = {
    actionType: "move_workout",
    source: normalizedSource,
    target: normalizedTarget,
    workoutDescriptor,
    confidence,
    needsClarification,
    clarificationReason,
    parser: "deterministic",
    parsingDiagnostics: {
      parserBaseDateSource: getParserBaseDateSource(context),
      parserBaseDateIso: toIsoDate(
        getBelgradeDateParts(parserBaseDate).year,
        getBelgradeDateParts(parserBaseDate).month,
        getBelgradeDateParts(parserBaseDate).day
      ),
      messageTimestampAvailable:
        typeof context?.messageDateUnix === "number" &&
        Number.isFinite(context.messageDateUnix) &&
        context.messageDateUnix > 0,
      ...(sourceDateInferredFromTargetMonth
        ? {
            sourceDateInferredFromTargetMonth: true,
            sourceDateInferencePattern: "day_only_source_target_month" as const,
          }
        : {}),
    },
    warnings: normalized.includes("заранее")
      ? ["Целевая дата выведена из формулировки «заранее». Проверь вручную."]
      : undefined,
  };

  const targetDateIso = resolveTimeRefToDateIso(normalizedTarget, parserBaseDate, "next");
  if (targetDateIso && normalizedTarget.kind !== "date") {
    payload.target = { ...normalizedTarget, kind: "date", value: targetDateIso };
  }

  const sourceDateIso = resolveTimeRefToDateIso(normalizedSource, parserBaseDate, "previous");
  if (sourceDateIso && normalizedSource) {
    payload.source = { ...normalizedSource, kind: "date", value: sourceDateIso };
    payload.sourceDate = sourceDateIso;
    payload.source_date = sourceDateIso;
  } else if (normalizedSource?.kind === "date") {
    payload.sourceDate = normalizedSource.value;
    payload.source_date = normalizedSource.value;
  }

  return {
    ok: true,
    payload,
    confidence,
  };
}

type ParseTrainingPeaksMoveWorkoutRequestContext = {
  messageDateUnix?: number | null;
  // Student's IANA timezone (e.g. "Europe/Moscow"). Used for AI date parsing ("сегодня/завтра").
  // When trainingpeaks_students.timezone column is added, pass it here.
  studentTimezone?: string | null;
  // When true, skip the strict keyword gate so the AI parser can attempt recovery.
  // Only set this after the LLM intent classifier has already confirmed move_workout intent.
  bypassStrictGate?: boolean;
};

export async function parseTrainingPeaksMoveWorkoutRequest(
  rawText: string,
  context?: ParseTrainingPeaksMoveWorkoutRequestContext
): Promise<ParseTrainingPeaksMoveWorkoutResult> {
  const normalized = normalizeRussianText(rawText);
  if (!normalized || (!context?.bypassStrictGate && !passesStrictMoveWorkoutIntentGate(normalized))) {
    logIgnoredTrainingPeaksMoveParser("intent_gate_failed", rawText);
    return { ok: false, reason: "not_explicit_move_request" };
  }

  const deterministic = resolveDeterministicMoveWorkout(rawText, context);

  if (
    deterministic.ok &&
    !deterministic.payload.needsClarification &&
    acceptsMoveWorkoutParseResult(deterministic.payload, deterministic.confidence, normalized)
  ) {
    return deterministic;
  }

  const aiFallback = await parseMoveWorkoutWithAiFallback(rawText, context?.studentTimezone ?? undefined);

  if (!aiFallback) {
    if (
      deterministic.ok &&
      acceptsMoveWorkoutParseResult(deterministic.payload, deterministic.confidence, normalized)
    ) {
      return deterministic;
    }
    return deterministic.ok ? { ok: false, reason: "parse_rejected" } : { ok: false, reason: deterministic.reason };
  }

  const aiConfidence = clampMoveWorkoutConfidence(aiFallback.confidence);
  const aiNeedsClarification = aiFallback.needsClarification;
  const parserBaseDate = getParserBaseDate(context);
  const aiPayload: ParsedTrainingPeaksMoveWorkoutPayload = {
    ...aiFallback,
    actionType: "move_workout",
    parser: "ai_fallback",
    sourceDate: aiFallback.source?.kind === "date" ? aiFallback.source.value : undefined,
    source_date: aiFallback.source?.kind === "date" ? aiFallback.source.value : undefined,
    parsingDiagnostics: {
      parserBaseDateSource: getParserBaseDateSource(context),
      parserBaseDateIso: toIsoDate(
        getBelgradeDateParts(parserBaseDate).year,
        getBelgradeDateParts(parserBaseDate).month,
        getBelgradeDateParts(parserBaseDate).day
      ),
      messageTimestampAvailable:
        typeof context?.messageDateUnix === "number" &&
        Number.isFinite(context.messageDateUnix) &&
        context.messageDateUnix > 0,
    },
  };
  const aiResolvedTargetDate = resolveTimeRefToDateIso(aiPayload.target, parserBaseDate, "next");
  if (aiResolvedTargetDate && aiPayload.target.kind !== "date") {
    aiPayload.target = { ...aiPayload.target, kind: "date", value: aiResolvedTargetDate };
  }
  if (aiPayload.source) {
    const aiResolvedSourceDate = resolveTimeRefToDateIso(aiPayload.source, parserBaseDate, "previous");
    if (aiResolvedSourceDate) {
      aiPayload.source = { ...aiPayload.source, kind: "date", value: aiResolvedSourceDate };
      aiPayload.sourceDate = aiResolvedSourceDate;
      aiPayload.source_date = aiResolvedSourceDate;
    }
  }

  if (aiNeedsClarification) {
    return {
      ok: true,
      payload: aiPayload,
      confidence: aiConfidence,
    };
  }

  if (!acceptsMoveWorkoutParseResult(aiPayload, aiConfidence, normalized)) {
    logIgnoredTrainingPeaksMoveParser("parse_acceptance_failed", rawText);
    if (deterministic.ok) {
      return deterministic;
    }
    return { ok: false, reason: "parse_rejected" };
  }

  return {
    ok: true,
    payload: aiPayload,
    confidence: aiConfidence,
  };
}

export type GroupMovePairProposal = {
  sourceText: string;
  targetText: string;
  source: TrainingPeaksMoveWorkoutTimeRef;
  target: TrainingPeaksMoveWorkoutTimeRef;
  sourceDate: string;
  targetDate: string;
  confidence: number;
};

export type TrainingPeaksGroupMovePreviewPair = {
  source: string;
  target: string;
};

export type CreateTrainingPeaksActionsFromGroupMoveCaseResult =
  | {
      kind: "created";
      actionIds: string[];
      createdCount: number;
      summaries: string[];
      caseStatus: TrainingPeaksCoachCaseStatus;
    }
  | {
      kind: "duplicate";
      actionIds: string[];
      createdCount: number;
      summaries: string[];
      caseStatus: TrainingPeaksCoachCaseStatus;
    }
  | {
      kind: "needs_manual_review";
      reason: string;
      actionIds: string[];
      caseStatus: TrainingPeaksCoachCaseStatus;
    }
  | { kind: "not_found" }
  | { kind: "ambiguous_case_id" }
  | { kind: "invalid_case_id" }
  | { kind: "invalid_case_kind"; caseKind: TrainingPeaksCoachCaseKind }
  | { kind: "missing_student" }
  | { kind: "case_closed"; status: TrainingPeaksCoachCaseStatus }
  | {
      kind: "failed";
      reasonCode: string;
      humanMessage: string;
      failedStage: string;
    };

export function shouldResolveTrainingPeaksCoachCaseByPrefix(caseId: string): boolean {
  return caseId.trim().length < 36;
}

export function buildCreateTrainingPeaksActionsFromGroupMoveCaseFailure(input: {
  reasonCode: string;
  humanMessage: string;
  failedStage: string;
}): Extract<CreateTrainingPeaksActionsFromGroupMoveCaseResult, { kind: "failed" }> {
  return {
    kind: "failed",
    reasonCode: input.reasonCode,
    humanMessage: input.humanMessage,
    failedStage: input.failedStage,
  };
}

type ResolveTrainingPeaksCoachCaseDetailsForGroupMoveResult =
  | { kind: "found"; case: TrainingPeaksCoachCase }
  | { kind: "not_found" }
  | { kind: "ambiguous_case_id" }
  | { kind: "invalid_case_id" };

async function resolveTrainingPeaksCoachCaseDetailsForGroupMove(
  caseId: string
): Promise<ResolveTrainingPeaksCoachCaseDetailsForGroupMoveResult> {
  if (shouldResolveTrainingPeaksCoachCaseByPrefix(caseId)) {
    const lookup = await getTrainingPeaksCoachCaseByIdPrefix(caseId);
    if (lookup.kind === "invalid_prefix") {
      return { kind: "invalid_case_id" };
    }
    if (lookup.kind === "ambiguous") {
      return { kind: "ambiguous_case_id" };
    }
    if (lookup.kind === "not_found") {
      return { kind: "not_found" };
    }
    const details = await getTrainingPeaksCoachCaseDetailsById(lookup.case.id);
    if (!details) {
      return { kind: "not_found" };
    }
    return { kind: "found", case: details };
  }

  const details = await getTrainingPeaksCoachCaseDetailsById(caseId);
  if (!details) {
    return { kind: "not_found" };
  }
  return { kind: "found", case: details };
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toFiniteNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toNonEmptyStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

const GROUP_MOVE_PAIR_TEXT_PATTERN = /^[a-zа-я0-9_-]+(?:\s+[a-zа-я0-9_-]+)?$/iu;
const GROUP_MOVE_PAIR_BLOCKED_WORDS = new Set([
  "можешь",
  "можно",
  "сдвинуть",
  "сдвинь",
  "перенести",
  "перенеси",
  "перенесите",
  "поставить",
  "поставь",
  "поставьте",
  "переставить",
  "переставь",
  "сместить",
  "тренировку",
  "тренировки",
]);

function isSafeGroupMovePairText(value: string): boolean {
  if (!GROUP_MOVE_PAIR_TEXT_PATTERN.test(value)) {
    return false;
  }
  const tokens = value
    .toLocaleLowerCase("ru")
    .split(/\s+/)
    .filter((token) => token.length > 0);
  if (tokens.length < 1 || tokens.length > 2) {
    return false;
  }
  return !tokens.some((token) => GROUP_MOVE_PAIR_BLOCKED_WORDS.has(token));
}

export function validateTrainingPeaksGroupMovePairsPreview(
  rawValue: unknown
): {
  pairs: TrainingPeaksGroupMovePreviewPair[];
  isSafe: boolean;
} {
  if (!Array.isArray(rawValue) || rawValue.length === 0) {
    return { pairs: [], isSafe: false };
  }

  const pairs: TrainingPeaksGroupMovePreviewPair[] = [];
  let isSafe = true;
  for (const item of rawValue) {
    if (!isRecordLike(item)) {
      isSafe = false;
      continue;
    }
    const source = toNonEmptyStringOrNull(item.source);
    const target = toNonEmptyStringOrNull(item.target);
    if (!source || !target || !isSafeGroupMovePairText(source) || !isSafeGroupMovePairText(target)) {
      isSafe = false;
      continue;
    }
    pairs.push({ source, target });
  }

  if (pairs.length === 0) {
    return { pairs: [], isSafe: false };
  }
  return { pairs, isSafe };
}

function extractGroupCaseMessageDateUnix(input: {
  coachNotesJson: Record<string, unknown>;
  createdAt: string;
}): number | null {
  const parseGate = isRecordLike(input.coachNotesJson.parse_gate) ? input.coachNotesJson.parse_gate : null;
  const metadataDate = toFiniteNumberOrNull(parseGate?.message_date_unix);
  if (metadataDate) {
    return metadataDate;
  }
  const createdAtDate = new Date(input.createdAt);
  if (Number.isNaN(createdAtDate.getTime())) {
    return null;
  }
  return Math.floor(createdAtDate.getTime() / 1000);
}

function extractMovePairsPreviewFromGroupCaseMetadata(
  coachNotesJson: Record<string, unknown>
): TrainingPeaksGroupMovePreviewPair[] {
  return validateTrainingPeaksGroupMovePairsPreview(coachNotesJson.move_pairs_preview).pairs;
}

function parseGroupCasePairRef(raw: string): TrainingPeaksMoveWorkoutTimeRef | null {
  const normalized = normalizeRussianText(raw);
  if (!normalized) {
    return null;
  }
  const refs = uniqueTimeRefs([...extractDateRefs(normalized), ...extractWeekdayAndRelativeRefs(normalized)]);
  if (refs.length !== 1) {
    return null;
  }
  return toTimeRefWithoutIndex(refs[0]!);
}

function shouldResolveGroupCaseSourceWeekdayForward(rawSourceText: string): boolean {
  const normalized = normalizeRussianText(rawSourceText);
  return normalized.endsWith("нюю") || normalized.endsWith("нюю тренировку");
}

export function buildGroupCaseMovePairProposal(input: {
  sourceText: string;
  targetText: string;
  messageDateUnix?: number | null;
}): GroupMovePairProposal | null {
  const source = parseGroupCasePairRef(input.sourceText);
  const target = parseGroupCasePairRef(input.targetText);
  if (!source || !target) {
    return null;
  }

  const parserBaseDate = getParserBaseDate({ messageDateUnix: input.messageDateUnix ?? null });
  const sourceDirection =
    source.kind === "weekday" && shouldResolveGroupCaseSourceWeekdayForward(input.sourceText) ? "next" : "previous";
  const sourceDate = resolveTimeRefToDateIso(source, parserBaseDate, sourceDirection);
  const targetDate = resolveTimeRefToDateIso(target, parserBaseDate, "next");
  if (!sourceDate || !targetDate) {
    return null;
  }

  if (!ISO_DATE_PATTERN.test(sourceDate) || !ISO_DATE_PATTERN.test(targetDate) || sourceDate === targetDate) {
    return null;
  }

  return {
    sourceText: input.sourceText,
    targetText: input.targetText,
    source: { ...source, kind: "date", value: sourceDate },
    target: { ...target, kind: "date", value: targetDate },
    sourceDate,
    targetDate,
    confidence: clampMoveWorkoutConfidence(0.84),
  };
}

function formatGroupCaseProposalSummary(pair: GroupMovePairProposal): string {
  return `${pair.sourceText} -> ${pair.targetText}`;
}

export async function createTrainingPeaksActionsFromGroupMoveCase(input: {
  caseId: string;
  coachChatId: string;
  coachUserId?: string | null;
}): Promise<CreateTrainingPeaksActionsFromGroupMoveCaseResult> {
  try {
    const resolvedCase = await resolveTrainingPeaksCoachCaseDetailsForGroupMove(input.caseId);
    if (resolvedCase.kind === "not_found") {
      return { kind: "not_found" };
    }
    if (resolvedCase.kind === "ambiguous_case_id") {
      return { kind: "ambiguous_case_id" };
    }
    if (resolvedCase.kind === "invalid_case_id") {
      return { kind: "invalid_case_id" };
    }
    const groupCase = resolvedCase.case;
    if (groupCase.caseKind !== "move_workout_needs_review") {
      return { kind: "invalid_case_kind", caseKind: groupCase.caseKind };
    }
    if (!groupCase.studentId) {
      return { kind: "missing_student" };
    }
    if (groupCase.status === "resolved" || groupCase.status === "dismissed") {
      return { kind: "case_closed", status: groupCase.status };
    }

    const metadata = isRecordLike(groupCase.coachNotesJson) ? groupCase.coachNotesJson : {};
    const existingActionIds = toStringArray(metadata.created_action_ids);
    const existingActionProposalsCreated = metadata.action_proposals_created === true;
    if (existingActionProposalsCreated && existingActionIds.length > 0) {
      const movePairsPreview = extractMovePairsPreviewFromGroupCaseMetadata(metadata);
      return {
        kind: "duplicate",
        actionIds: existingActionIds,
        createdCount: existingActionIds.length,
        summaries: movePairsPreview.map((pair) => `${pair.source} -> ${pair.target}`),
        caseStatus: groupCase.status,
      };
    }

    const validatedPairs = validateTrainingPeaksGroupMovePairsPreview(metadata.move_pairs_preview);
    const validatedMetadata: Record<string, unknown> = {
      ...metadata,
      move_pairs_preview: validatedPairs.pairs,
      move_pairs_preview_safe: validatedPairs.isSafe,
    };
    if (!validatedPairs.isSafe || validatedPairs.pairs.length === 0) {
      const nextMetadata = {
        ...validatedMetadata,
        proposal_creation_error: "No safe move pairs stored in case metadata.",
      };
      await updateTrainingPeaksCoachCaseMetadata({
        caseId: groupCase.id,
        coachNotesJson: nextMetadata,
      });
      return {
        kind: "needs_manual_review",
        reason: "no_safe_pairs",
        actionIds: existingActionIds,
        caseStatus: groupCase.status,
      };
    }

    const movePairsPreview = validatedPairs.pairs;
    const messageDateUnix = extractGroupCaseMessageDateUnix({
      coachNotesJson: validatedMetadata,
      createdAt: groupCase.createdAt,
    });
    const proposals = movePairsPreview
      .map((pair) =>
        buildGroupCaseMovePairProposal({
          sourceText: pair.source,
          targetText: pair.target,
          messageDateUnix,
        })
      )
      .filter((pair): pair is GroupMovePairProposal => Boolean(pair));

    if (proposals.length === 0 || proposals.length !== movePairsPreview.length) {
      const nextMetadata = {
        ...validatedMetadata,
        proposal_creation_error: "Could not deterministically resolve all stored group move pairs.",
      };
      await updateTrainingPeaksCoachCaseMetadata({
        caseId: groupCase.id,
        coachNotesJson: nextMetadata,
      });
      return {
        kind: "needs_manual_review",
        reason: "uncertain_pairs",
        actionIds: existingActionIds,
        caseStatus: groupCase.status,
      };
    }

    const sourceChatId = groupCase.telegramChatId;
    const sourceMessageId = groupCase.telegramMessageId != null ? String(groupCase.telegramMessageId) : null;
    if (!sourceChatId || !sourceMessageId) {
      const nextMetadata = {
        ...validatedMetadata,
        proposal_creation_error: "Case is missing original Telegram source pointers.",
      };
      await updateTrainingPeaksCoachCaseMetadata({
        caseId: groupCase.id,
        coachNotesJson: nextMetadata,
      });
      return {
        kind: "needs_manual_review",
        reason: "missing_source_message",
        actionIds: existingActionIds,
        caseStatus: groupCase.status,
      };
    }

    const rawTextPreview =
      buildTelegramContextTextPreview(toNonEmptyStringOrNull(validatedMetadata.text_preview)) ?? "group move case";
    const summaries = proposals.map(formatGroupCaseProposalSummary);
    const actionIds = [...existingActionIds];
    let createdCount = 0;

    for (const proposal of proposals) {
      const duplicate = await findTrainingPeaksMoveActionBySourceMessageAndDates({
        studentId: groupCase.studentId,
        sourceChatId,
        sourceMessageId,
        sourceDate: proposal.sourceDate,
        targetDate: proposal.targetDate,
      });

      if (duplicate) {
        if (!actionIds.includes(duplicate.id)) {
          actionIds.push(duplicate.id);
        }
        continue;
      }

      const parsedPayload: ParsedTrainingPeaksMoveWorkoutPayload = {
        actionType: "move_workout",
        source: proposal.source,
        target: proposal.target,
        workoutDescriptor: null,
        confidence: proposal.confidence,
        needsClarification: false,
        clarificationReason: null,
        parser: "group_case_proposal",
        sourceDate: proposal.sourceDate,
        source_date: proposal.sourceDate,
        parsingDiagnostics: {
          parserBaseDateSource:
            typeof messageDateUnix === "number" && Number.isFinite(messageDateUnix) && messageDateUnix > 0
              ? "message_timestamp"
              : "server_now",
          parserBaseDateIso:
            typeof messageDateUnix === "number" && Number.isFinite(messageDateUnix) && messageDateUnix > 0
              ? getBelgradeIsoDate(new Date(messageDateUnix * 1000))
              : getBelgradeIsoDate(new Date(groupCase.createdAt)),
          messageTimestampAvailable:
            typeof messageDateUnix === "number" && Number.isFinite(messageDateUnix) && messageDateUnix > 0,
          source: "group_case",
          groupCaseId: groupCase.id,
          sourceType:
            validatedMetadata.source_type === "group_topic" || validatedMetadata.source_type === "group_general"
              ? validatedMetadata.source_type
              : "group_general",
        } as ParsedTrainingPeaksMoveWorkoutPayload["parsingDiagnostics"] & Record<string, unknown>,
      };

      const action = await createTrainingPeaksActionInRepository({
        studentId: groupCase.studentId,
        actionType: "move_workout",
        status: "pending_coach",
        sourceChatId,
        sourceMessageId,
        sourceUserId: input.coachUserId ?? null,
        rawText: rawTextPreview,
        parsedPayload,
        confidence: String(proposal.confidence),
        coachChatId: input.coachChatId,
      });
      actionIds.push(action.id);
      createdCount += 1;
    }

    const nextMetadata: Record<string, unknown> = {
      ...validatedMetadata,
      action_proposals_created: actionIds.length > 0,
      created_action_ids: actionIds,
      proposal_creation_error: null,
    };
    if (!validatedMetadata.action_id && actionIds.length > 0) {
      nextMetadata.action_id = actionIds[0]!;
    }
    await updateTrainingPeaksCoachCaseMetadata({
      caseId: groupCase.id,
      coachNotesJson: nextMetadata,
    });

    if (createdCount > 0) {
      return {
        kind: "created",
        actionIds,
        createdCount,
        summaries,
        caseStatus: groupCase.status,
      };
    }

    return {
      kind: "duplicate",
      actionIds,
      createdCount: 0,
      summaries,
      caseStatus: groupCase.status,
    };
  } catch (error) {
    console.warn("Failed to create TrainingPeaks actions from group move case", {
      caseId: input.caseId,
      coachChatId: input.coachChatId,
      coachUserId: input.coachUserId ?? null,
      error,
    });
    return buildCreateTrainingPeaksActionsFromGroupMoveCaseFailure({
      reasonCode: "unexpected_error",
      humanMessage: "Внутренняя ошибка при создании заявок.",
      failedStage: "create_actions",
    });
  }
}

function normalizeForMatching(value: string | null | undefined): string {
  return (value ?? "")
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

function inferWorkoutKindFromText(text: string): "interval" | "tempo" | "long_run" | "run" | "unknown" {
  const normalizedRef = normalizeWorkoutReference(text);
  if (normalizedRef.kind === "intervals") {
    return "interval";
  }
  if (normalizedRef.kind === "tempo") {
    return "tempo";
  }
  if (normalizedRef.kind === "long_run") {
    return "long_run";
  }
  if (normalizedRef.kind === "workout") {
    return "run";
  }
  if (hasIntervalDescriptorPattern(text)) {
    return "interval";
  }
  return "unknown";
}

function scoreWorkoutCandidate(input: {
  row: TrainingPeaksWorkoutCacheRow;
  targetDateIso: string;
  inferredKind: "interval" | "tempo" | "long_run" | "run" | "unknown";
  rawText: string;
}): number {
  const { row, targetDateIso, inferredKind, rawText } = input;
  let score = 0;
  const titleNormalized = normalizeForMatching(row.title);

  if (row.workoutDate >= targetDateIso) {
    score += 0.2;
  }

  const activity = classifyTrainingPeaksWorkoutActivity({
    title: row.title,
    sportOrTypeCode: row.sportOrTypeCode,
    workoutTypeValueId: row.workoutTypeValueId,
    workoutSubTypeId: row.workoutSubTypeId,
    sourceSnapshot: row.sourceSnapshot,
  });
  if (activity.isRunning) {
    score += 0.1;
  } else {
    score -= 0.3;
  }

  if (inferredKind === "interval") {
    if (hasIntervalDescriptorPattern(row.title ?? "")) {
      score += 0.9;
    }
    if (hasIntervalDescriptorPattern(JSON.stringify(row.sourceSnapshot ?? {}))) {
      score += 0.5;
    }
  } else if (inferredKind === "tempo" && titleNormalized.includes("темп")) {
    score += 0.7;
  } else if (inferredKind === "long_run" && (titleNormalized.includes("длитель") || titleNormalized.includes("лонг"))) {
    score += 0.7;
  } else if (inferredKind === "run" && activity.isRunning) {
    score += 0.2;
  }

  const rawRef = normalizeWorkoutReference(rawText);
  const rowRef = normalizeWorkoutReference(row.title ?? "");
  if (rawRef.kind !== "unknown" && rowRef.kind !== "unknown") {
    if (rawRef.kind === rowRef.kind) {
      score += 0.4;
    }
  }

  return Number(score.toFixed(3));
}

function isLikelyHardOrIntervalWorkout(row: TrainingPeaksWorkoutCacheRow): boolean {
  const title = normalizeForMatching(row.title);
  if (hasIntervalDescriptorPattern(title)) {
    return true;
  }
  return title.includes("темп") || title.includes("порог") || title.includes("фартлек");
}

const MOVE_SOURCE_AI_MODEL_LABEL = process.env.MOVE_INTENT_MODEL?.trim() || "claude-haiku-4-5-20251001";

async function enrichParsedMovePayloadWithWorkoutInference(input: {
  studentId: string;
  rawText: string;
  parsedPayload: ParsedTrainingPeaksMoveWorkoutPayload;
  studentTimezone?: string | null;
}): Promise<ParsedTrainingPeaksMoveWorkoutPayload> {
  const payload: ParsedTrainingPeaksMoveWorkoutPayload = {
    ...input.parsedPayload,
    warnings: [...(input.parsedPayload.warnings ?? [])],
    suggestedAdjustments: [...(input.parsedPayload.suggestedAdjustments ?? [])],
  };

  const targetDateIso =
    payload.target.kind === "date" && ISO_DATE_PATTERN.test(payload.target.value) ? payload.target.value : null;

  // Window must include TODAY, not just target±. The previous window started at target-1 and the
  // candidate filter required workoutDate >= target, so today's planned workout was invisible —
  // the root cause of "moved the future long run instead of today's session" (Kasianenko audit).
  // When the target is fuzzy (e.g. «выходные» → no single ISO date), we still analyse the plan
  // from today forward so the situation check (already_planned / no_such_workout) can run.
  const timezone = input.studentTimezone?.trim() || "Europe/Moscow";
  const todayIso = new Intl.DateTimeFormat("sv-SE", { timeZone: timezone }).format(new Date());
  const searchTo = targetDateIso ? addLocalDaysIso(targetDateIso, 10) : addLocalDaysIso(todayIso, 14);
  const targetMinusOne = targetDateIso ? addLocalDaysIso(targetDateIso, -1) : todayIso;
  const searchFrom = todayIso < targetMinusOne ? todayIso : targetMinusOne;
  const rows = await listTrainingPeaksWorkoutCacheForStudentDateRange({
    studentId: input.studentId,
    from: searchFrom,
    to: searchTo,
  });

  if (!payload.sourceDate && !payload.source_date) {
    // ── Primary path: let Haiku read the calendar and decide which workout to move. ──
    // Candidate pool: planned, NOT completed, today onward, excluding the target day itself
    // (the target is the destination, never the source). Completed/past are excluded here and
    // also blocked absolutely by the runner's hard gate.
    const calendarRows = rows.filter(
      (row) =>
        row.isPlanned && !row.isCompleted && row.workoutDate >= todayIso && row.workoutDate !== targetDateIso
    );
    const aiCalendar: MoveSourceCalendarWorkout[] = calendarRows.map((row) => ({
      workoutId: row.trainingPeaksWorkoutId,
      date: row.workoutDate,
      type: row.sportOrTypeCode,
      title: row.title,
      isToday: row.workoutDate === todayIso,
    }));

    const aiSelection = await selectMoveSourceWorkoutWithAi({
      messageText: input.rawText,
      todayIso,
      targetDateIso,
      timezone,
      calendar: aiCalendar,
    });

    if (aiSelection && aiSelection.situation === "no_such_workout") {
      // The asked workout type is not in the plan → ADD request, not a move. Do NOT pull an
      // unrelated workout (the old greedy bug). Flag for the caller to skip the false move card.
      payload.moveSituation = "no_such_workout";
      payload.needsClarification = true;
      payload.clarificationReason = "no_such_workout_in_plan";
      if (aiSelection.reasoning) {
        payload.warnings?.push(aiSelection.reasoning);
      }
    } else if (aiSelection && aiSelection.situation === "already_planned") {
      // A workout of that type already stands on/around the asked day. Nothing to move blindly —
      // offer the coach keep-as-is vs move-to-an-alternative-day (carried in the reasoning).
      payload.moveSituation = "already_planned";
      payload.needsClarification = true;
      payload.clarificationReason = aiSelection.reasoning || "already_planned_keep_or_move";
    } else if (aiSelection && aiSelection.decision === "single" && aiSelection.selectedWorkoutId !== null) {
      const chosen = calendarRows.find(
        (row) => row.trainingPeaksWorkoutId === aiSelection.selectedWorkoutId
      );
      if (chosen) {
        // Trusted explicit source: the runner consumes payload.source/sourceDate and skips its
        // arithmetic guessing. We deliberately do NOT set an untrusted sourceInferencePreview here,
        // so the runner's extractExplicitSourceDate trusts these fields.
        payload.moveSituation = "move_existing";
        payload.source = { kind: "date", value: chosen.workoutDate, sourceText: chosen.title ?? "" };
        payload.sourceDate = chosen.workoutDate;
        payload.source_date = chosen.workoutDate;
        payload.aiSourceSelection = {
          decision: "single",
          selectedWorkoutId: chosen.trainingPeaksWorkoutId,
          selectedDate: chosen.workoutDate,
          confidence: aiSelection.confidence,
          reasoning: aiSelection.reasoning,
          model: MOVE_SOURCE_AI_MODEL_LABEL,
        };
      }
    } else if (aiSelection && aiSelection.decision === "ambiguous") {
      const chosenRows = aiSelection.candidateWorkoutIds
        .map((id) => calendarRows.find((row) => row.trainingPeaksWorkoutId === id))
        .filter((row): row is TrainingPeaksWorkoutCacheRow => Boolean(row));
      if (chosenRows.length >= 2) {
        // Genuine ambiguity even with calendar context → hand the coach a real picker (Этап 3),
        // never guess silently. Keep the source untrusted so the runner stays in "needs choice".
        const previewCandidates = chosenRows.map((row) => ({
          workoutId: row.trainingPeaksWorkoutId,
          workoutDate: row.workoutDate,
          title: row.title,
          score: aiSelection.confidence,
        }));
        const sourceInferencePreview = buildMoveSourceInferencePreviewFromCacheCandidates({
          candidates: previewCandidates,
        });
        payload.sourceInferencePreview = sourceInferencePreview;
        payload.sourceInference = {
          strategy: "future_workout_cache_preview",
          trusted: false,
          source: "trainingpeaks_workout_cache",
          candidateCount: sourceInferencePreview.candidateCount,
          selectedWorkoutId: sourceInferencePreview.selectedCandidate?.workoutId,
          candidates: sourceInferencePreview.candidates,
          reason: sourceInferencePreview.reason ?? null,
          warnings: sourceInferencePreview.warnings,
        };
        payload.moveSituation = "move_existing";
        payload.aiSourceSelection = {
          decision: "ambiguous",
          candidateWorkoutIds: chosenRows.map((row) => row.trainingPeaksWorkoutId),
          confidence: aiSelection.confidence,
          reasoning: aiSelection.reasoning,
          model: MOVE_SOURCE_AI_MODEL_LABEL,
        };
        payload.needsClarification = true;
        payload.clarificationReason = "multiple source workout candidates";
      }
    }

    // ── Degradation path: AI unavailable or no usable decision → legacy arithmetic cache scoring. ──
    // Skipped when a situation was decided (already_planned/no_such_workout) so we never fall back
    // to pulling an unrelated workout, and skipped when the target day is fuzzy (no ISO date).
    if (
      !payload.sourceDate &&
      !payload.source_date &&
      !payload.sourceInferencePreview &&
      !payload.moveSituation &&
      targetDateIso
    ) {
      const inferredKind = inferWorkoutKindFromText(input.rawText);
      const candidates = rows
        .filter((row) => row.isPlanned && !row.isCompleted && row.workoutDate >= targetDateIso)
        .map((row) => ({
          row,
          score: scoreWorkoutCandidate({
            row,
            targetDateIso,
            inferredKind,
            rawText: input.rawText,
          }),
        }))
        .filter((entry) => entry.score >= 0.8)
        .sort((a, b) => a.row.workoutDate.localeCompare(b.row.workoutDate) || b.score - a.score);

      const previewCandidates = candidates.map((entry) => ({
        workoutId: entry.row.trainingPeaksWorkoutId,
        workoutDate: entry.row.workoutDate,
        title: entry.row.title,
        score: entry.score,
      }));
      const sourceInferencePreview = buildMoveSourceInferencePreviewFromCacheCandidates({
        candidates: previewCandidates,
      });
      payload.sourceInferencePreview = sourceInferencePreview;
      payload.sourceInference = {
        strategy: "future_workout_cache_preview",
        trusted: false,
        source: "trainingpeaks_workout_cache",
        candidateCount: sourceInferencePreview.candidateCount,
        selectedWorkoutId: sourceInferencePreview.selectedCandidate?.workoutId,
        candidates: sourceInferencePreview.candidates,
        reason: sourceInferencePreview.reason ?? null,
        warnings: sourceInferencePreview.warnings,
      };

      if (sourceInferencePreview.warnings?.length) {
        payload.warnings?.push(...sourceInferencePreview.warnings);
      }
      if (sourceInferencePreview.reason === "multiple source workout candidates") {
        payload.needsClarification = true;
        payload.clarificationReason = sourceInferencePreview.reason;
      } else if (sourceInferencePreview.candidateCount === 0) {
        payload.needsClarification = true;
        payload.clarificationReason = "unresolved_workout";
      }
    }
  }

  // Target-relative warnings only make sense once the target resolved to a concrete date.
  if (targetDateIso) {
    const targetDayRows = rows.filter((row) => row.workoutDate === targetDateIso && row.isPlanned);
    if (targetDayRows.length > 0) {
      payload.warnings?.push("На целевой день уже есть тренировка. Проверь расписание недели.");
    }

    const explicitSourceIso = payload.sourceDate ?? payload.source_date;
    const previewSelectedWorkoutId = payload.sourceInferencePreview?.selectedCandidate?.workoutId;
    const sourceRow = explicitSourceIso
      ? rows.find(
          (row) =>
            row.workoutDate === explicitSourceIso &&
            row.isPlanned &&
            (previewSelectedWorkoutId ? row.trainingPeaksWorkoutId === previewSelectedWorkoutId : true)
        ) ?? rows.find((row) => row.workoutDate === explicitSourceIso && row.isPlanned)
      : null;
    if (sourceRow && isLikelyHardOrIntervalWorkout(sourceRow)) {
      const aroundTarget = rows.filter((row) => {
        if (!row.isPlanned || row.workoutDate === targetDateIso) {
          return false;
        }
        const distanceDays =
          Math.abs(
            Date.parse(`${row.workoutDate}T12:00:00Z`) - Date.parse(`${targetDateIso}T12:00:00Z`)
          ) / (1000 * 60 * 60 * 24);
        return distanceDays > 0 && distanceDays <= 1.5;
      });
      if (aroundTarget.length > 0) {
        payload.warnings?.push("Перенос интервальной тренировки раньше может потребовать корректировки недели.");
        const suggestedDate = addLocalDaysIso(targetDateIso, 3);
        const hasNearSuggested = rows.some((row) => row.workoutDate === suggestedDate);
        if (!hasNearSuggested) {
          payload.suggestedAdjustments?.push(
            `Возможно, стоит сдвинуть тренировку ${addLocalDaysIso(targetDateIso, 1)} на ${suggestedDate}.`
          );
        }
      }
    }
  }

  return payload;
}

function formatTrainingPeaksMoveWorkoutTargetSummary(target: TrainingPeaksMoveWorkoutTimeRef): string {
  if (target.kind === "date") {
    return `на ${target.value}`;
  }
  if (target.kind === "relative_day") {
    if (target.value === "tomorrow") {
      return "на завтра";
    }
    if (target.value === "day_after_tomorrow") {
      return "на послезавтра";
    }
    if (target.value === "today") {
      return "на сегодня";
    }
  }
  const weekdayLabelByValue: Record<string, string> = {
    monday: "на понедельник",
    tuesday: "на вторник",
    wednesday: "на среду",
    thursday: "на четверг",
    friday: "на пятницу",
    saturday: "на субботу",
    sunday: "на воскресенье",
  };
  return weekdayLabelByValue[target.value] ?? `на ${target.sourceText}`;
}

function getTrainingPeaksTelegramLinkCodePrefix(studentName: string): string {
  const normalized = studentName
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "")
    .toUpperCase();

  return normalized.slice(0, 4) || "TP";
}

function createTrainingPeaksTelegramLinkCodeValue(studentName: string): string {
  const prefix = getTrainingPeaksTelegramLinkCodePrefix(studentName);
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${suffix}`;
}

function extractTrainingPeaksTelegramLinkCodeCandidates(text: string): string[] {
  const matches = text.toUpperCase().match(TP_TELEGRAM_LINK_CODE_PATTERN) ?? [];
  return Array.from(new Set(matches.map((match) => match.trim()).filter(Boolean)));
}

function compareStudentReports(
  left: TrainingPeaksWeeklyReport,
  right: TrainingPeaksWeeklyReport
): number {
  return (
    right.weekFrom.localeCompare(left.weekFrom) ||
    right.weekTo.localeCompare(left.weekTo) ||
    right.syncedAt.localeCompare(left.syncedAt)
  );
}

function pickMatchingStudentReport(
  reports: TrainingPeaksWeeklyReport[],
  studentQuery: string
): TrainingPeaksWeeklyReport | null {
  const normalizedQuery = normalizeStudentQuery(studentQuery);

  if (!normalizedQuery) {
    return null;
  }

  const exactMatches = reports.filter((report) => {
    const normalizedStudentName = normalizeStudentQuery(report.studentName);
    const normalizedStudentId = normalizeStudentQuery(report.studentId);
    return normalizedStudentName === normalizedQuery || normalizedStudentId === normalizedQuery;
  });

  if (exactMatches.length > 0) {
    return exactMatches.sort(compareStudentReports)[0] ?? null;
  }

  const prefixMatches = reports.filter((report) => {
    const normalizedStudentName = normalizeStudentQuery(report.studentName);
    const normalizedStudentId = normalizeStudentQuery(report.studentId);
    return (
      normalizedStudentName.startsWith(normalizedQuery) ||
      normalizedStudentId.startsWith(normalizedQuery)
    );
  });

  if (prefixMatches.length === 1) {
    return prefixMatches[0];
  }

  const containsMatches = reports.filter((report) => {
    const normalizedStudentName = normalizeStudentQuery(report.studentName);
    const normalizedStudentId = normalizeStudentQuery(report.studentId);
    return (
      normalizedStudentName.includes(normalizedQuery) ||
      normalizedStudentId.includes(normalizedQuery)
    );
  });

  return containsMatches.length === 1 ? containsMatches[0] : null;
}

function hasReportMarkdown(reportMarkdown: string | null): boolean {
  return Boolean(reportMarkdown?.trim());
}

function hasSummaryJson(summaryJson: unknown | null): boolean {
  return summaryJson !== null;
}

function normalizeReportStatus(report: TrainingPeaksWeeklyReport): Exclude<TrainingPeaksStatus, "missing"> {
  if (report.status === "ready" || report.status === "parsed_only") {
    return report.status;
  }

  return hasReportMarkdown(report.reportMarkdown) ? "ready" : "parsed_only";
}

function getLatestWeekFromReports(reports: TrainingPeaksWeeklyReport[]): TrainingPeaksWeek | null {
  const latestReport = reports[0];
  return latestReport
    ? {
        weekFrom: latestReport.weekFrom,
        weekTo: latestReport.weekTo,
      }
    : null;
}

function getLatestReportByStudent(
  reports: TrainingPeaksWeeklyReport[]
): Map<string, TrainingPeaksWeeklyReport> {
  const latestByStudent = new Map<string, TrainingPeaksWeeklyReport>();

  for (const report of reports) {
    if (!latestByStudent.has(report.studentId)) {
      latestByStudent.set(report.studentId, report);
    }
  }

  return latestByStudent;
}

function getSortedStudents(
  latestByStudent: Map<string, TrainingPeaksWeeklyReport>
): TrainingPeaksWeeklyReport[] {
  return Array.from(latestByStudent.values()).sort((left, right) =>
    left.studentName.localeCompare(right.studentName, "ru")
  );
}

function getWeekReportByStudent(
  reports: TrainingPeaksWeeklyReport[],
  week: TrainingPeaksWeek
): Map<string, TrainingPeaksWeeklyReport> {
  return new Map(
    reports
      .filter((report) => report.weekFrom === week.weekFrom && report.weekTo === week.weekTo)
      .map((report) => [report.studentId, report])
  );
}

function stripTpAddStudentCommandPrefix(rawInput: string): string {
  return rawInput.replace(TP_ADD_STUDENT_COMMAND_PATTERN, "").trim();
}

function stripTpRunWeekCommandPrefix(rawInput: string): string {
  return rawInput.replace(TP_RUN_WEEK_COMMAND_PATTERN, "").trim();
}

function isIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function isValidTrainingPeaksAthleteUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function parseTrainingPeaksWeeklyRunWeekInput(rawInput: string):
  | { ok: true; weekFrom: string; weekTo: string }
  | {
      ok: false;
      reason: "invalid_format" | "invalid_date" | "invalid_range";
      message: string;
    } {
  const normalizedInput = stripTpRunWeekCommandPrefix(rawInput);
  const tokens = normalizedInput ? normalizedInput.split(/\s+/) : [];

  if (tokens.length === 1) {
    const resolvedWeek = resolveTrainingPeaksWeekKeyword(tokens[0] ?? "");

    if (!resolvedWeek) {
      return {
        ok: false,
        reason: "invalid_format",
        message: TP_RUN_WEEK_USAGE_MESSAGE,
      };
    }

    return {
      ok: true,
      weekFrom: resolvedWeek.weekFrom,
      weekTo: resolvedWeek.weekTo,
    };
  }

  if (tokens.length !== 2) {
    return {
      ok: false,
      reason: "invalid_format",
      message: TP_RUN_WEEK_USAGE_MESSAGE,
    };
  }

  const [weekFrom, weekTo] = tokens;

  if (!isIsoDate(weekFrom) || !isIsoDate(weekTo)) {
    return {
      ok: false,
      reason: "invalid_date",
      message: TP_RUN_WEEK_USAGE_MESSAGE,
    };
  }

  if (weekFrom > weekTo) {
    return {
      ok: false,
      reason: "invalid_range",
      message: TP_RUN_WEEK_USAGE_MESSAGE,
    };
  }

  return {
    ok: true,
    weekFrom,
    weekTo,
  };
}

function parseTpAddStudentInput(rawInput: string): { studentName: string; trainingPeaksAthleteUrl: string } {
  const normalizedInput = stripTpAddStudentCommandPrefix(rawInput);
  const separatorIndex = normalizedInput.indexOf("|");

  if (separatorIndex < 0) {
    return {
      studentName: normalizedInput.trim(),
      trainingPeaksAthleteUrl: "",
    };
  }

  return {
    studentName: normalizedInput.slice(0, separatorIndex).trim(),
    trainingPeaksAthleteUrl: normalizedInput.slice(separatorIndex + 1).trim(),
  };
}

function getRegistryStudentStatus(report: TrainingPeaksWeeklyReport | null): TrainingPeaksRegistryStatus {
  if (!report) {
    return "no_data";
  }

  if (hasReportMarkdown(report.reportMarkdown)) {
    return "ready";
  }

  if (hasSummaryJson(report.summaryJson)) {
    return "data_loaded";
  }

  return "no_report";
}

function findMatchingTrainingPeaksStudents(
  students: TrainingPeaksRegistryStudentSnapshot[],
  studentQuery: string
): TrainingPeaksRegistryStudentSnapshot[] {
  const normalizedQuery = normalizeStudentQuery(studentQuery);

  if (!normalizedQuery) {
    return [];
  }

  const exactMatches = students.filter((student) => {
    const normalizedStudentName = normalizeStudentQuery(student.studentName);
    const normalizedStudentId = normalizeStudentQuery(student.studentId);
    return normalizedStudentName === normalizedQuery || normalizedStudentId === normalizedQuery;
  });

  if (exactMatches.length > 0) {
    return exactMatches;
  }

  const prefixMatches = students.filter((student) => {
    const normalizedStudentName = normalizeStudentQuery(student.studentName);
    const normalizedStudentId = normalizeStudentQuery(student.studentId);
    return (
      normalizedStudentName.startsWith(normalizedQuery) ||
      normalizedStudentId.startsWith(normalizedQuery)
    );
  });

  if (prefixMatches.length > 0) {
    return prefixMatches;
  }

  return students.filter((student) => {
    const normalizedStudentName = normalizeStudentQuery(student.studentName);
    const normalizedStudentId = normalizeStudentQuery(student.studentId);
    return (
      normalizedStudentName.includes(normalizedQuery) ||
      normalizedStudentId.includes(normalizedQuery)
    );
  });
}

async function resolveTrainingPeaksRegistryStudent(
  studentQuery: string
): Promise<TrainingPeaksStudentCard> {
  const students = await getTrainingPeaksStudentsRegistryWithLatestReportStatus();
  const matches = findMatchingTrainingPeaksStudents(students, studentQuery);

  if (matches.length === 0) {
    return { kind: "not_found" };
  }

  if (matches.length > 1) {
    return {
      kind: "ambiguous",
      matches: matches.map((student) => ({
        studentId: student.studentId,
        studentName: student.studentName,
      })),
    };
  }

  const student = matches[0];

  if (!student) {
    return { kind: "not_found" };
  }

  return {
    kind: "student",
    student,
  };
}

async function getTrainingPeaksRegistryStudentByInternalId(
  id: string,
  options?: {
    includeArchived?: boolean;
  }
): Promise<TrainingPeaksRegistryStudentSnapshot | null> {
  const students = await getTrainingPeaksStudentsRegistryWithLatestReportStatus(options);
  return students.find((student) => student.id === id) ?? null;
}

export async function getTrainingPeaksStatusOverview(
  requestedWeek?: TrainingPeaksWeek
): Promise<TrainingPeaksStatusOverview | null> {
  const reports = await listAllTrainingPeaksReports();
  const week = requestedWeek ?? getLatestWeekFromReports(reports);

  if (!week) {
    return null;
  }

  const latestByStudent = getLatestReportByStudent(reports);
  const weekReportsByStudent = getWeekReportByStudent(reports, week);

  return {
    week,
    students: getSortedStudents(latestByStudent).map((student) => {
      const report = weekReportsByStudent.get(student.studentId);

      return {
        studentId: student.studentId,
        studentName: student.studentName,
        status: report ? normalizeReportStatus(report) : "missing",
        hasReport: report ? hasReportMarkdown(report.reportMarkdown) : false,
      };
    }),
  };
}

export async function getTrainingPeaksStudentSnapshots(): Promise<TrainingPeaksStudentSnapshot[]> {
  const reports = await listAllTrainingPeaksReports();

  return getSortedStudents(getLatestReportByStudent(reports)).map((report) => ({
    studentId: report.studentId,
    studentName: report.studentName,
    weekFrom: report.weekFrom,
    weekTo: report.weekTo,
    status: normalizeReportStatus(report),
  }));
}

export async function addTrainingPeaksStudentFromCommand(
  rawInput: string
): Promise<AddTrainingPeaksStudentResult> {
  const { studentName, trainingPeaksAthleteUrl } = parseTpAddStudentInput(rawInput);

  if (!studentName) {
    return { ok: false, reason: "empty_name" };
  }

  if (!trainingPeaksAthleteUrl.startsWith("https://")) {
    return { ok: false, reason: "invalid_url" };
  }

  try {
    const student = await insertTrainingPeaksStudent({
      studentId: studentName,
      studentName,
      trainingPeaksAthleteUrl,
    });

    return {
      ok: true,
      student,
    };
  } catch (error) {
    if (error instanceof TrainingPeaksStudentConflictError) {
      return {
        ok: false,
        reason: error.reason === "trainingpeaks_athlete_url" ? "duplicate_url" : "duplicate_student",
      };
    }

    console.error("Failed to add TrainingPeaks student", {
      rawInput,
      error,
    });

    return { ok: false, reason: "unknown" };
  }
}

export async function createTrainingPeaksStudent(
  input: CreateTrainingPeaksStudentInput
): Promise<CreateTrainingPeaksStudentResult> {
  const studentId = normalizeTrainingPeaksStudentId(input.studentId);
  const studentName = input.studentName.trim();
  const trainingPeaksAthleteUrl = input.trainingPeaksAthleteUrl.trim();
  const notes = normalizeOptionalText(input.notes);
  const dataQualityStatus = normalizeOptionalText(input.dataQualityStatus);

  const studentIdError = validateTrainingPeaksStudentId(studentId);

  if (studentIdError) {
    return {
      ok: false,
      reason: studentId ? "invalid_student_id" : "empty_student_id",
      message: studentIdError,
    };
  }

  if (!studentName) {
    return {
      ok: false,
      reason: "empty_student_name",
      message: "Укажи имя ученика.",
    };
  }

  if (!trainingPeaksAthleteUrl) {
    return {
      ok: false,
      reason: "empty_url",
      message: "Укажи ссылку на TrainingPeaks athlete.",
    };
  }

  if (!isValidTrainingPeaksAthleteUrl(trainingPeaksAthleteUrl)) {
    return {
      ok: false,
      reason: "invalid_url",
      message: "Ссылка на TrainingPeaks athlete должна выглядеть как URL.",
    };
  }

  try {
    const student = await insertTrainingPeaksStudent({
      studentId,
      studentName,
      trainingPeaksAthleteUrl,
      isActive: true,
      weeklyReportEnabled: true,
      telegramDeliveryEnabled: false,
      dataQualityStatus,
      notes,
    });

    return {
      ok: true,
      student,
    };
  } catch (error) {
    if (error instanceof TrainingPeaksStudentConflictError) {
      return {
        ok: false,
        reason: error.reason === "trainingpeaks_athlete_url" ? "duplicate_url" : "duplicate_student",
        message:
          error.reason === "trainingpeaks_athlete_url"
            ? "Ученик с таким TrainingPeaks URL уже существует."
            : "Ученик с таким техническим кодом уже существует.",
      };
    }

    console.error("Failed to create TrainingPeaks student from admin", {
      input: {
        ...input,
        notes,
        dataQualityStatus,
        trainingPeaksAthleteUrl,
        studentId,
        studentName,
      },
      error,
    });

    return {
      ok: false,
      reason: "unknown",
      message: "Не удалось создать ученика. Попробуй ещё раз.",
    };
  }
}

export async function setTrainingPeaksStudentWeeklyReportsEnabled(
  id: string,
  enabled: boolean
): Promise<SetTrainingPeaksStudentWeeklyReportsEnabledResult> {
  const existingStudent = await getTrainingPeaksStudentByIdFromRepository(id);

  if (!existingStudent) {
    return {
      ok: false,
      reason: "not_found",
      message: "Ученик не найден.",
    };
  }

  if (enabled && !existingStudent.isActive) {
    return {
      ok: false,
      reason: "student_archived",
      message: "Нельзя включить недельные отчёты для архивного ученика.",
    };
  }

  const student = await setTrainingPeaksStudentWeeklyReportsEnabledById(id, enabled);

  if (!student) {
    return {
      ok: false,
      reason: "not_found",
      message: "Ученик не найден.",
    };
  }

  return {
    ok: true,
    student,
  };
}

export async function unlinkTrainingPeaksStudentTelegram(
  id: string
): Promise<UnlinkTrainingPeaksStudentTelegramResult> {
  const existingStudent = await getTrainingPeaksStudentByIdFromRepository(id);

  if (!existingStudent) {
    return {
      ok: false,
      reason: "not_found",
      message: "Ученик не найден.",
    };
  }

  const student = await unlinkTrainingPeaksStudentTelegramById(id);

  if (!student) {
    return {
      ok: false,
      reason: "not_found",
      message: "Ученик не найден.",
    };
  }

  return {
    ok: true,
    student,
  };
}

export async function listTrainingPeaksWeeklyReportEligibleStudents(): Promise<
  Pick<TrainingPeaksStudent, "studentId" | "studentName">[]
> {
  const students = await listTrainingPeaksWeeklyReportEligibleStudentsFromRepository();
  return students.map((student) => ({
    studentId: student.studentId,
    studentName: student.studentName,
  }));
}

export async function requestTrainingPeaksWeeklyRun(
  rawInput: string,
  requester: TrainingPeaksJobRequester
): Promise<RequestTrainingPeaksWeeklyRunResult> {
  const parsedInput = parseTrainingPeaksWeeklyRunWeekInput(rawInput);

  if (!parsedInput.ok) {
    return parsedInput;
  }

  try {
    const job = await createTrainingPeaksWeeklyJob({
      weekFrom: parsedInput.weekFrom,
      weekTo: parsedInput.weekTo,
      requestedByChatId: String(requester.chatId),
      requestedByUserId: requester.userId === null ? null : String(requester.userId),
    });

    return {
      ok: true,
      job,
    };
  } catch (error) {
    if (error instanceof TrainingPeaksJobConflictError) {
      const activeJob = await findActiveTrainingPeaksJobForWeek(
        "weekly_reports",
        parsedInput.weekFrom,
        parsedInput.weekTo
      );

      return {
        ok: false,
        reason: "duplicate",
        activeJob: activeJob ? mapActiveTrainingPeaksJobSnapshot(activeJob) : null,
        message: "Такая задача уже ожидает выполнения или сейчас выполняется.",
      };
    }

    console.error("Failed to request TrainingPeaks weekly job", {
      rawInput,
      requester,
      error,
    });

    return {
      ok: false,
      reason: "unknown",
      activeJob: null,
      message: "Не смог создать задачу TrainingPeaks. Попробуй позже.",
    };
  }
}

const TP_RUN_STUDENT_COMMAND_PATTERN = /^\/tp_run_student(?:@\w+)?(?:\s+|$)/;

function stripTpRunStudentCommandPrefix(rawInput: string): string {
  return rawInput.replace(TP_RUN_STUDENT_COMMAND_PATTERN, "").trim();
}

function parseTpRunStudentCommand(rawInput: string):
  | { ok: true; studentQuery: string; weekFrom: string; weekTo: string }
  | {
      ok: false;
      reason: "invalid_format" | "invalid_date" | "invalid_range";
      message: string;
    } {
  const normalizedInput = stripTpRunStudentCommandPrefix(rawInput);

  if (!normalizedInput) {
    return {
      ok: false,
      reason: "invalid_format",
      message:
        "Напиши так: /tp_run_student levan 2026-05-11 2026-05-17 или /tp_run_student \"Alena Kovaldova\" 2026-05-11 2026-05-17",
    };
  }

  const quotedMatch = normalizedInput.match(/^"([^"]+)"\s+(\S+)\s+(\S+)$/);
  if (quotedMatch) {
    const [, studentQuery, weekFrom, weekTo] = quotedMatch;
    if (!isIsoDate(weekFrom) || !isIsoDate(weekTo)) {
      return {
        ok: false,
        reason: "invalid_date",
        message: "Даты недели нужно передать в формате YYYY-MM-DD YYYY-MM-DD.",
      };
    }
    if (weekFrom > weekTo) {
      return {
        ok: false,
        reason: "invalid_range",
        message: "Дата начала недели не может быть позже даты окончания.",
      };
    }
    return { ok: true, studentQuery: studentQuery.trim(), weekFrom, weekTo };
  }

  const tokens = normalizedInput.split(/\s+/);
  if (tokens.length < 3) {
    return {
      ok: false,
      reason: "invalid_format",
      message:
        "Напиши так: /tp_run_student levan 2026-05-11 2026-05-17 или /tp_run_student \"Alena Kovaldova\" 2026-05-11 2026-05-17",
    };
  }

  const weekTo = tokens[tokens.length - 1] ?? "";
  const weekFrom = tokens[tokens.length - 2] ?? "";
  const studentQuery = tokens.slice(0, -2).join(" ").trim();

  if (!studentQuery) {
    return {
      ok: false,
      reason: "invalid_format",
      message: "После /tp_run_student нужно указать ученика.",
    };
  }

  if (!isIsoDate(weekFrom) || !isIsoDate(weekTo)) {
    return {
      ok: false,
      reason: "invalid_date",
      message: "Даты недели нужно передать в формате YYYY-MM-DD YYYY-MM-DD.",
    };
  }

  if (weekFrom > weekTo) {
    return {
      ok: false,
      reason: "invalid_range",
      message: "Дата начала недели не может быть позже даты окончания.",
    };
  }

  return { ok: true, studentQuery, weekFrom, weekTo };
}

function validateStudentForSingleWeeklyJob(
  match: TrainingPeaksStudentCard
):
  | { ok: true; student: TrainingPeaksRegistryStudentSnapshot }
  | {
      ok: false;
      reason:
        | "student_not_found"
        | "student_ambiguous"
        | "student_archived"
        | "student_inactive"
        | "missing_trainingpeaks_url";
      message: string;
      matches?: { studentId: string; studentName: string }[];
    } {
  if (match.kind === "not_found") {
    return { ok: false, reason: "student_not_found", message: "Ученик не найден." };
  }

  if (match.kind === "ambiguous") {
    return {
      ok: false,
      reason: "student_ambiguous",
      message: `Нашлось несколько учеников: ${match.matches.map((entry) => entry.studentName).join(", ")}. Уточни имя или slug.`,
      matches: match.matches,
    };
  }

  const { student } = match;

  if (student.archivedAt) {
    return {
      ok: false,
      reason: "student_archived",
      message: `Ученик ${student.studentName} в архиве. Восстанови его перед генерацией отчёта.`,
    };
  }

  if (!student.isActive) {
    return {
      ok: false,
      reason: "student_inactive",
      message: `Ученик ${student.studentName} неактивен.`,
    };
  }

  if (!student.trainingPeaksAthleteUrl.trim()) {
    return {
      ok: false,
      reason: "missing_trainingpeaks_url",
      message: `У ученика ${student.studentName} нет ссылки TrainingPeaks athlete.`,
    };
  }

  return { ok: true, student };
}

function mapActiveTrainingPeaksJobSnapshot(
  job: TrainingPeaksJob
): Pick<TrainingPeaksJob, "id" | "status" | "weekFrom" | "weekTo" | "scope" | "studentId"> {
  return {
    id: job.id,
    status: job.status,
    weekFrom: job.weekFrom,
    weekTo: job.weekTo,
    scope: job.scope,
    studentId: job.studentId,
  };
}

export async function requestTrainingPeaksWeeklyRunForStudent(
  rawInput: string,
  requester: TrainingPeaksJobRequester
): Promise<RequestTrainingPeaksWeeklyRunForStudentResult> {
  const parsedInput = parseTpRunStudentCommand(rawInput);

  if (!parsedInput.ok) {
    return parsedInput;
  }

  const studentMatch = await resolveTrainingPeaksRegistryStudent(parsedInput.studentQuery);
  const validatedStudent = validateStudentForSingleWeeklyJob(studentMatch);

  if (!validatedStudent.ok) {
    return validatedStudent;
  }

  try {
    const job = await createTrainingPeaksWeeklyJob({
      scope: "single_student",
      studentId: validatedStudent.student.studentId,
      weekFrom: parsedInput.weekFrom,
      weekTo: parsedInput.weekTo,
      requestedByChatId: String(requester.chatId),
      requestedByUserId: requester.userId === null ? null : String(requester.userId),
    });

    return {
      ok: true,
      job,
      student: validatedStudent.student,
    };
  } catch (error) {
    if (error instanceof TrainingPeaksJobConflictError) {
      const activeJob = await findActiveTrainingPeaksJobForStudentWeek(
        "weekly_reports",
        validatedStudent.student.studentId,
        parsedInput.weekFrom,
        parsedInput.weekTo
      );

      return {
        ok: false,
        reason: "duplicate",
        activeJob: activeJob ? mapActiveTrainingPeaksJobSnapshot(activeJob) : null,
        message: "Такая задача для этого ученика уже ожидает выполнения или сейчас выполняется.",
      };
    }

    console.error("Failed to request TrainingPeaks single-student weekly job", {
      rawInput,
      requester,
      error,
    });

    return {
      ok: false,
      reason: "unknown",
      activeJob: null,
      message: "Не смог создать задачу TrainingPeaks. Попробуй позже.",
    };
  }
}

export async function requestTrainingPeaksWeeklyRunForStudentByInternalId(input: {
  studentInternalId: string;
  weekFrom: string;
  weekTo: string;
  requestedByChatId?: string | null;
  requestedByUserId?: string | null;
}): Promise<RequestTrainingPeaksWeeklyRunForStudentResult> {
  if (!isIsoDate(input.weekFrom) || !isIsoDate(input.weekTo)) {
    return {
      ok: false,
      reason: "invalid_date",
      message: "Даты недели нужно передать в формате YYYY-MM-DD.",
    };
  }

  if (input.weekFrom > input.weekTo) {
    return {
      ok: false,
      reason: "invalid_range",
      message: "Дата начала недели не может быть позже даты окончания.",
    };
  }

  const studentRecord = await getTrainingPeaksStudentByIdFromRepository(input.studentInternalId);

  if (!studentRecord) {
    return { ok: false, reason: "student_not_found", message: "Ученик не найден." };
  }

  return requestTrainingPeaksWeeklyRunForStudent(
    `/tp_run_student ${studentRecord.studentId} ${input.weekFrom} ${input.weekTo}`,
    {
      chatId: input.requestedByChatId ?? "admin",
      userId: input.requestedByUserId ?? null,
    }
  );
}

export async function getTrainingPeaksWeeklyReportForStudentWeekFromService(
  studentId: string,
  weekFrom: string,
  weekTo: string
) {
  return getTrainingPeaksWeeklyReportForStudentWeek(studentId, weekFrom, weekTo);
}

function parseTrainingPeaksAthleteIdFromUrl(value: string): number | null {
  const match = value.match(/\/athletes\/(\d+)/i);
  if (!match) {
    return null;
  }

  const parsed = Number(match[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function getUtcTodayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function getDefaultRaceResultsProbeFromDate(): string {
  return "2024-01-01";
}

export async function requestTrainingPeaksRaceResultsProbeJob(
  studentInternalId: string,
  requestedByChatId: string,
  options?: RequestTrainingPeaksRaceResultsProbeOptions
): Promise<RequestTrainingPeaksRaceResultsProbeResult> {
  const normalizedChatId = requestedByChatId.trim();
  if (!normalizedChatId) {
    return {
      ok: false,
      reason: "missing_requester",
      message: "Не указан chat_id тренера для ответа.",
    };
  }

  const student = await getTrainingPeaksStudentByIdFromRepository(studentInternalId);
  if (!student) {
    return {
      ok: false,
      reason: "student_not_found",
      message: "Ученик не найден.",
    };
  }

  const athleteUrl = student.trainingPeaksAthleteUrl.trim();
  if (!athleteUrl) {
    return {
      ok: false,
      reason: "missing_trainingpeaks_url",
      message: `У ученика ${student.studentName} нет ссылки TrainingPeaks athlete.`,
    };
  }

  const athleteId = parseTrainingPeaksAthleteIdFromUrl(athleteUrl);
  if (!athleteId) {
    return {
      ok: false,
      reason: "invalid_athlete_url",
      message: `Не удалось извлечь athlete id из ссылки TrainingPeaks для ${student.studentName}.`,
    };
  }

  const toDate = options?.to?.trim() || getUtcTodayIsoDate();
  const fromDate = options?.from?.trim() || getDefaultRaceResultsProbeFromDate();

  if (!isIsoDate(fromDate) || !isIsoDate(toDate)) {
    return {
      ok: false,
      reason: "invalid_date",
      message: "Период нужно передать в формате YYYY-MM-DD.",
    };
  }

  if (fromDate > toDate) {
    return {
      ok: false,
      reason: "invalid_range",
      message: "Дата начала периода не может быть позже даты окончания.",
    };
  }

  const requestJson: TrainingPeaksRaceResultsProbeRequestJson = {
    distance: options?.distance?.trim() || "all",
    preset: options?.preset?.trim() || "default_24m",
    from: fromDate,
    to: toDate,
    athleteId,
    studentSlug: student.studentId,
  };

  try {
    const job = await createTrainingPeaksRaceResultsProbeJob({
      studentInternalId: student.id,
      fromDate,
      toDate,
      requestJson,
      requestedByChatId: normalizedChatId,
    });

    return { ok: true, job };
  } catch (error) {
    if (error instanceof TrainingPeaksJobConflictError) {
      const activeJob = await findActiveTrainingPeaksRaceResultsProbeJobForStudent(student.id);
      return {
        ok: false,
        reason: "duplicate",
        activeJob: activeJob ? mapActiveTrainingPeaksJobSnapshot(activeJob) : null,
        message: "Такая задача уже в очереди или выполняется.",
      };
    }

    console.error("Failed to request TrainingPeaks race-results probe job", {
      studentInternalId,
      requestedByChatId: normalizedChatId,
      options,
      error,
    });

    return {
      ok: false,
      reason: "unknown",
      activeJob: null,
      message: "Не смог создать задачу по дистанциям. Попробуй позже.",
    };
  }
}

export async function requestTrainingPeaksRaceScan(
  fromDate: string,
  toDate: string,
  requester: TrainingPeaksJobRequester
): Promise<RequestTrainingPeaksRaceScanResult> {
  if (!ISO_DATE_PATTERN.test(fromDate) || !ISO_DATE_PATTERN.test(toDate)) {
    return {
      ok: false,
      reason: "invalid_date",
      message: "Период нужно передать в формате YYYY-MM-DD YYYY-MM-DD.",
    };
  }
  if (fromDate > toDate) {
    return {
      ok: false,
      reason: "invalid_range",
      message: "Дата начала периода не может быть позже даты окончания.",
    };
  }

  try {
    const job = await createTrainingPeaksRaceScanJob({
      fromDate,
      toDate,
      requestedByChatId: String(requester.chatId),
      requestedByUserId: requester.userId === null ? null : String(requester.userId),
    });
    return { ok: true, job };
  } catch (error) {
    if (error instanceof TrainingPeaksJobConflictError) {
      const activeJob = await findActiveTrainingPeaksJobForWeek("race_scan_events", fromDate, toDate);
      return {
        ok: false,
        reason: "duplicate",
        activeJob: activeJob
          ? {
              id: activeJob.id,
              status: activeJob.status,
              weekFrom: activeJob.weekFrom,
              weekTo: activeJob.weekTo,
            }
          : null,
        message: "Такая задача по забегам уже ожидает выполнения или сейчас выполняется.",
      };
    }
    console.error("Failed to request TrainingPeaks race scan job", {
      fromDate,
      toDate,
      requester,
      error,
    });
    return {
      ok: false,
      reason: "unknown",
      activeJob: null,
      message: "Не смог создать задачу сканирования забегов. Попробуй позже.",
    };
  }
}

export async function getActiveTrainingPeaksWeeklyJobForWeek(
  week: TrainingPeaksWeek
): Promise<Pick<TrainingPeaksJob, "id" | "status" | "weekFrom" | "weekTo"> | null> {
  const activeJob = await findActiveTrainingPeaksJobForWeek("weekly_reports", week.weekFrom, week.weekTo);

  if (!activeJob) {
    return null;
  }

  return {
    id: activeJob.id,
    status: activeJob.status,
    weekFrom: activeJob.weekFrom,
    weekTo: activeJob.weekTo,
  };
}

export async function cancelTrainingPeaksWeeklyRun(
  jobId: string
): Promise<CancelTrainingPeaksWeeklyRunResult> {
  const cancelledJob = await cancelQueuedTrainingPeaksJob(jobId);

  if (cancelledJob) {
    return {
      ok: true,
      job: cancelledJob,
    };
  }

  const existingJob = await getTrainingPeaksJobById(jobId);

  if (!existingJob) {
    return {
      ok: false,
      reason: "not_found",
    };
  }

  if (existingJob.status === "running") {
    return {
      ok: false,
      reason: "already_started",
    };
  }

  return {
    ok: false,
    reason: "not_cancellable",
  };
}

export { TRAININGPEAKS_JOB_CANCELLED_ERROR_MESSAGE };

export async function getTrainingPeaksJobsStatus(): Promise<TrainingPeaksJob[]> {
  return listRecentTrainingPeaksJobs(10);
}

function getIsoTimeMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function isWithinLookbackHours(value: string | null | undefined, lookbackHours: number): boolean {
  const timeMs = getIsoTimeMs(value);
  if (timeMs === null) {
    return false;
  }
  const cutoffMs = Date.now() - lookbackHours * 60 * 60 * 1000;
  return timeMs >= cutoffMs;
}

const YESTERDAY_SCAN_FAILURE_TTL_HOURS = 48;
const YESTERDAY_SCAN_MISSING_ALERT_START_HOUR = 11;
const YESTERDAY_SCAN_SMALL_FAILURE_NAMES_LIMIT = 3;
const YESTERDAY_SCAN_FAILURE_PREVIEW_NAMES_LIMIT = 4;
const ATTENTION_OPERATIONAL_LIST_MAX_ITEMS = 20;
/** Matches `/tp_signals` command limit in `handleTrainingPeaksOperationalSignalsCommand`. */
export const TRAININGPEAKS_OPERATIONAL_SIGNALS_TELEGRAM_LIMIT = 100;
const ATTENTION_NO_CONTACT_MINIMUM_COACH_IDLE_DAYS = TRAININGPEAKS_NO_CONTACT_ALERT_DAYS;

type YesterdayScanStatusSignalSource = {
  studentId: string;
  status: "ok" | "failed" | "skipped";
  scannedAt: string;
};

type YesterdayScanActiveStudentSource = {
  id: string;
  studentName: string | null;
};

type YesterdayScanAttentionSummary = {
  actionableFailedCount: number;
  actionableFailedNames: string[];
  missingScanCount: number;
  shouldShowMissingScanAlert: boolean;
  latestStatusByStudentId: Map<string, YesterdayScanStatusSignalSource>;
  latestOkStatusByStudentId: Map<string, YesterdayScanStatusSignalSource>;
};

function getBelgradeHour(now = new Date()): number | null {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TRAININGPEAKS_TIME_ZONE,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hourRaw = parts.find((part) => part.type === "hour")?.value ?? "";
  const hour = Number(hourRaw);
  return Number.isFinite(hour) ? hour : null;
}

function shouldShowMissingYesterdayScanAlert(now = new Date()): boolean {
  const belgradeHour = getBelgradeHour(now);
  if (belgradeHour === null) {
    return false;
  }
  return belgradeHour >= YESTERDAY_SCAN_MISSING_ALERT_START_HOUR;
}

export function summarizeYesterdayScanAttention(input: {
  activeStudents: YesterdayScanActiveStudentSource[];
  statuses: YesterdayScanStatusSignalSource[];
  now?: Date;
  failureTtlHours?: number;
}): YesterdayScanAttentionSummary {
  const now = input.now ?? new Date();
  const failureTtlHours = input.failureTtlHours ?? YESTERDAY_SCAN_FAILURE_TTL_HOURS;
  const failedCutoffMs = now.getTime() - failureTtlHours * 60 * 60 * 1000;
  const activeStudentsById = new Map(
    input.activeStudents.map((student) => [student.id, student.studentName?.trim() || null])
  );
  const latestStatusByStudentId = new Map<string, YesterdayScanStatusSignalSource>();
  const latestStatusMsByStudentId = new Map<string, number | null>();
  const latestFailedMsByStudentId = new Map<string, number>();
  const latestOkMsByStudentId = new Map<string, number>();
  const latestOkStatusByStudentId = new Map<string, YesterdayScanStatusSignalSource>();
  const hasAnyStatusByStudentId = new Set<string>();

  for (const status of input.statuses) {
    if (!activeStudentsById.has(status.studentId)) {
      continue;
    }
    hasAnyStatusByStudentId.add(status.studentId);
    const statusTimeMs = getIsoTimeMs(status.scannedAt);
    const currentLatestMs = latestStatusMsByStudentId.get(status.studentId) ?? null;
    const shouldPromoteLatest =
      !latestStatusByStudentId.has(status.studentId) ||
      (statusTimeMs !== null && (currentLatestMs === null || statusTimeMs > currentLatestMs));
    if (shouldPromoteLatest) {
      latestStatusByStudentId.set(status.studentId, status);
      latestStatusMsByStudentId.set(status.studentId, statusTimeMs);
    }
    if (statusTimeMs === null) {
      continue;
    }
    if (status.status === "failed") {
      const previousFailedMs = latestFailedMsByStudentId.get(status.studentId);
      if (previousFailedMs === undefined || statusTimeMs > previousFailedMs) {
        latestFailedMsByStudentId.set(status.studentId, statusTimeMs);
      }
      continue;
    }
    if (status.status === "ok") {
      const previousOkMs = latestOkMsByStudentId.get(status.studentId);
      if (previousOkMs === undefined || statusTimeMs > previousOkMs) {
        latestOkMsByStudentId.set(status.studentId, statusTimeMs);
        latestOkStatusByStudentId.set(status.studentId, status);
      }
    }
  }

  const actionableFailedNames: string[] = [];
  let missingScanCount = 0;
  for (const student of input.activeStudents) {
    if (!hasAnyStatusByStudentId.has(student.id)) {
      missingScanCount += 1;
      continue;
    }
    const latestFailedMs = latestFailedMsByStudentId.get(student.id);
    if (latestFailedMs === undefined || latestFailedMs < failedCutoffMs) {
      continue;
    }
    const latestOkMs = latestOkMsByStudentId.get(student.id);
    if (latestOkMs !== undefined && latestOkMs > latestFailedMs) {
      continue;
    }
    const name = activeStudentsById.get(student.id);
    if (name) {
      actionableFailedNames.push(name);
    }
  }

  actionableFailedNames.sort((left, right) => left.localeCompare(right, "ru-RU"));

  return {
    actionableFailedCount: actionableFailedNames.length,
    actionableFailedNames,
    missingScanCount,
    shouldShowMissingScanAlert: shouldShowMissingYesterdayScanAlert(now),
    latestStatusByStudentId,
    latestOkStatusByStudentId,
  };
}

function pushUniqueAttentionSignal(
  list: TrainingPeaksAttentionSignal[],
  signal: TrainingPeaksAttentionSignal
): void {
  const key = `${signal.level}:${signal.studentName ?? ""}:${signal.reason}`;
  const exists = list.some(
    (item) =>
      `${item.level}:${item.studentName ?? ""}:${item.reason}` === key
  );
  if (!exists) {
    list.push(signal);
  }
}

export function formatRussianCountedNoun(
  count: number,
  forms: readonly [one: string, few: string, many: string]
): string {
  const abs = Math.abs(count);
  const lastTwoDigits = abs % 100;
  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
    return forms[2];
  }
  const lastDigit = abs % 10;
  if (lastDigit === 1) {
    return forms[0];
  }
  if (lastDigit >= 2 && lastDigit <= 4) {
    return forms[1];
  }
  return forms[2];
}

function formatAttentionCaseCreatedAtLabel(isoDateTime: string): string | null {
  const parsed = new Date(isoDateTime);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  const parts = new Intl.DateTimeFormat("ru-RU", {
    timeZone: DEFAULT_COACH_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(parsed);
  const day = parts.find((part) => part.type === "day")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  if (!day || !month || !hour || !minute) {
    return null;
  }
  return `${day}.${month} ${hour}:${minute}`;
}

function getBelgradeIsoDate(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TRAININGPEAKS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? "");
  const month = Number(parts.find((part) => part.type === "month")?.value ?? "");
  const day = Number(parts.find((part) => part.type === "day")?.value ?? "");
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    throw new Error("Unable to derive Belgrade date.");
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function shiftBelgradeIsoDate(isoDate: string, days: number): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return isoDate;
  }
  const shifted = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days, 12, 0, 0));
  return getBelgradeIsoDate(shifted);
}

function getYesterdayBelgradeIsoDate(now = new Date()): string {
  const today = getBelgradeIsoDate(now);
  return shiftBelgradeIsoDate(today, -1);
}

function formatMissedRunningWorkoutReason(count: number): string {
  const lastTwoDigits = Math.abs(count) % 100;
  const lastDigit = Math.abs(count) % 10;
  const noun = lastTwoDigits >= 11 && lastTwoDigits <= 14
    ? "беговых тренировок"
    : lastDigit >= 2 && lastDigit <= 4
      ? "беговые тренировки"
      : "беговых тренировок";
  return `вчера ${count} ${noun}, выполнения не найдено`;
}

type OperationalHealthFollowUpAttentionItem = {
  studentId: string;
  studentName: string | null;
  reason: string;
  state: "pending_due" | "pending_overdue";
  dueDate: string | null;
  daysOverdue: number;
  episodeKey: string | null;
  signalId: string;
};

function getSignalMetadataString(
  metadata: Record<string, unknown>,
  key: string
): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function getSignalMetadataBoolean(
  metadata: Record<string, unknown>,
  key: string
): boolean | null {
  const value = metadata[key];
  return typeof value === "boolean" ? value : null;
}

function compactOperationalSignalText(raw: string, maxLength = 90): string {
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(1, maxLength - 3)).trimEnd()}...`;
}

function isScheduleOperationalSignalType(signalType: string): boolean {
  return (
    signalType === "schedule_unavailability_window" ||
    signalType === "schedule_availability_window" ||
    signalType === "plan_generation_constraint"
  );
}

function resolveScheduleOperationalSignalValidUntil(
  signal: Pick<TrainingPeaksStudentOperationalSignal, "validUntil" | "structuredPayload">
): string | null {
  if (signal.validUntil) {
    return signal.validUntil;
  }
  return normalizeRecordString(signal.structuredPayload.valid_until);
}

function addIsoDateDays(isoDate: string, days: number): string {
  const parsed = new Date(`${isoDate}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return isoDate;
  }
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function isStaleGenericScheduleUnavailabilitySignal(input: {
  signal: TrainingPeaksStudentOperationalSignal;
  asOfDate: string;
}): boolean {
  if (input.signal.signalType !== "schedule_unavailability_window") {
    return false;
  }
  if (resolveScheduleOperationalSignalValidUntil(input.signal)) {
    return false;
  }
  const durationDaysRaw = input.signal.structuredPayload.duration_days;
  const durationDays =
    typeof durationDaysRaw === "number" && Number.isFinite(durationDaysRaw) && durationDaysRaw > 0
      ? Math.floor(durationDaysRaw)
      : null;
  const createdDate = input.signal.createdAt.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(createdDate)) {
    return false;
  }
  const inferredEnd = addIsoDateDays(createdDate, durationDays ?? 7);
  return inferredEnd < input.asOfDate;
}

function areAllPlannedTrainingDatesExpired(
  structuredPayload: Record<string, unknown>,
  asOfDate: string
): boolean {
  const plannedDates = normalizeRecordStringArray(structuredPayload.planned_training_dates);
  if (plannedDates.length === 0) {
    return false;
  }
  if (!plannedDates.every((date) => date < asOfDate)) {
    return false;
  }
  const unavailableDates = normalizeRecordStringArray(structuredPayload.unavailable_dates);
  const resolvedDates = normalizeRecordStringArray(structuredPayload.resolved_available_dates);
  const hasFutureUnavailable = unavailableDates.some((date) => date >= asOfDate);
  const hasFutureResolved = resolvedDates.some((date) => date >= asOfDate);
  return !hasFutureUnavailable && !hasFutureResolved;
}

function isExpiredPlannedTrainingDatesSignal(
  signal: { signalType: string; structuredPayload: Record<string, unknown> },
  asOfDate: string
): boolean {
  if (!isScheduleOperationalSignalType(signal.signalType)) {
    return false;
  }
  return areAllPlannedTrainingDatesExpired(signal.structuredPayload, asOfDate);
}

export function isExpiredScheduleOperationalSignal(
  signal: { signalType: string; validUntil: string | null; structuredPayload: Record<string, unknown> },
  asOfDate: string,
  options?: { referenceObservedAt?: string | null }
): boolean {
  if (!isScheduleOperationalSignalType(signal.signalType)) {
    return false;
  }
  let validUntil = resolveScheduleOperationalSignalValidUntil(signal);
  if (!validUntil && options?.referenceObservedAt) {
    validUntil = inferOneOffWeekdayConstraintValidUntil(
      signal.structuredPayload as Parameters<typeof inferOneOffWeekdayConstraintValidUntil>[0],
      options.referenceObservedAt
    );
  }
  if (!validUntil) {
    return isExpiredPlannedTrainingDatesSignal(signal, asOfDate);
  }
  return validUntil < asOfDate;
}

function normalizeRecordBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function isMoveOperationalSignalType(signalType: string): boolean {
  return signalType === "move_workout_candidate";
}

function normalizeRecordString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeRecordStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => normalizeRecordString(item)).filter((item): item is string => Boolean(item)) : [];
}

function translateHealthSymptom(value: string): string {
  switch (value) {
    case "fever":
      return "температура";
    case "cough":
      return "кашель";
    case "throat":
      return "горло";
    case "voice":
      return "голос";
    case "runny_nose":
      return "насморк";
    case "cold":
      return "простуда";
    case "orvi":
      return "ОРВИ";
    case "weakness":
      return "слабость";
    default:
      return value;
  }
}

function readMoveActionDates(action: Pick<TrainingPeaksAction, "parsedPayload">): {
  sourceDate: string | null;
  targetDate: string | null;
} {
  if (!action.parsedPayload || typeof action.parsedPayload !== "object") {
    return { sourceDate: null, targetDate: null };
  }
  const payload = action.parsedPayload as {
    source?: { kind?: string; value?: string };
    target?: { kind?: string; value?: string };
    sourceDate?: string;
    source_date?: string;
  };
  return {
    sourceDate:
      normalizeRecordString(payload.sourceDate) ??
      normalizeRecordString(payload.source_date) ??
      (payload.source?.kind === "date" ? normalizeRecordString(payload.source.value) : null),
    targetDate: payload.target?.kind === "date" ? normalizeRecordString(payload.target.value) : null,
  };
}

function isActionActiveForMoveSignal(
  signal: Pick<TrainingPeaksStudentOperationalSignal, "studentId" | "linkedActionId" | "sourceDate" | "targetDate">,
  actions: readonly TrainingPeaksAction[]
): boolean {
  return actions.some((action) => {
    if (action.studentId !== signal.studentId) {
      return false;
    }
    if (signal.linkedActionId && action.id === signal.linkedActionId) {
      return action.status === "pending_coach" || (action.status === "approved" && action.executionStatus !== "completed");
    }
    const dates = readMoveActionDates(action);
    return (
      (action.status === "pending_coach" || (action.status === "approved" && action.executionStatus !== "completed")) &&
      dates.sourceDate === (signal.sourceDate ?? null) &&
      dates.targetDate === (signal.targetDate ?? null)
    );
  });
}

function buildHealthOperationalSignalText(
  signal: TrainingPeaksStudentOperationalSignal,
  signalTypeOverride?: string | null
): string {
  const latestSummary =
    normalizeRecordString(signal.structuredPayload.latest_summary) ??
    getSignalMetadataString(signal.metadata, "latest_summary") ??
    getSignalMetadataString(signal.metadata, "follow_up_reason");
  const sanitizedSummary = sanitizeHealthOperationalSummary(latestSummary);
  if (sanitizedSummary) {
    return compactOperationalSignalText(sanitizedSummary, 140);
  }

  const healthState =
    normalizeRecordString(signal.structuredPayload.health_state) ??
    getSignalMetadataString(signal.metadata, "health_state");
  const symptoms = normalizeRecordStringArray(signal.structuredPayload.symptoms);
  const recommendation =
    normalizeRecordString(signal.structuredPayload.training_recommendation) ??
    getSignalMetadataString(signal.metadata, "training_recommendation");
  const lines: string[] = [];

  if (healthState === "improving") {
    if (symptoms.includes("fever") && symptoms.includes("weakness")) {
      lines.push("вчера была температура, сегодня лучше, но слабость");
    } else {
      lines.push(
        symptoms.length > 0
          ? `восстанавливается, ${symptoms.map(translateHealthSymptom).join(", ")}`
          : "восстанавливается"
      );
    }
  } else if (healthState === "sick") {
    lines.push(
      symptoms.length > 0 ? `болеет, ${symptoms.map(translateHealthSymptom).join(", ")}` : "болеет"
    );
  } else if (healthState === "resolved") {
    lines.push("самочувствие нормализовалось");
  }

  if (recommendation === "easy_if_symptom_free") {
    lines.push("лёгкий возврат только без симптомов");
  } else if (recommendation === "resume_carefully") {
    lines.push("аккуратный возврат к тренировкам");
  }

  if (lines.length > 0) {
    return compactOperationalSignalText(lines.join("; "), 140);
  }

  const typeLabel = getOperationalSignalTypeLabel(signalTypeOverride ?? signal.signalType);
  const windowPart = getOperationalSignalWindowPart(signal);
  return windowPart ? `${typeLabel} (${windowPart})` : typeLabel;
}

const INTERNAL_OPERATIONAL_EPISODE_ROLES = new Set([
  "health_context",
  "schedule_context",
  "pause_context",
  "plan_adjustment",
]);

function stripInternalOperationalDisplayPrefix(raw: string): string {
  return raw.replace(/^health_context:\s*/iu, "").trim();
}

function sanitizeHealthOperationalSummary(raw: string | null): string | null {
  if (!raw) {
    return null;
  }
  const normalized = stripInternalOperationalDisplayPrefix(raw.replace(/\s+/gu, " ").trim());
  if (!normalized) {
    return null;
  }
  const parts = normalized
    .split(/\s*;\s*/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => stripInternalOperationalDisplayPrefix(part))
    .filter((part) => {
      const lower = part.toLowerCase();
      if (!lower) {
        return false;
      }
      if (lower === "пауза / наблюдать") {
        return false;
      }
      if (lower === "illness onset follow-up") {
        return false;
      }
      if (lower === "illness-related pause follow-up") {
        return false;
      }
      if (lower === "follow-up") {
        return false;
      }
      return true;
    });
  if (parts.length === 0) {
    return null;
  }
  return parts.join("; ");
}

function isAmbiguousIllnessText(raw: string): boolean {
  return /(может|возможно|кажется)\s+заболева/iu.test(raw);
}

function normalizeAmbiguousIllnessDisplayText(raw: string): string {
  const compact = compactOperationalSignalText(raw, 140).toLowerCase();
  if (compact === "болеет" || isAmbiguousIllnessText(compact)) {
    return "возможно заболевает";
  }
  return raw;
}

function getOperationalSignalTypeLabel(signalType: string): string {
  if (signalType === "health_issue_started") {
    return "болезнь";
  }
  if (signalType === "health_issue_improving") {
    return "восстановление";
  }
  if (signalType === "health_issue_resolved") {
    return "самочувствие";
  }
  if (signalType === "pause_training") {
    return "пауза";
  }
  if (signalType === "resume_training") {
    return "возврат";
  }
  if (signalType === "schedule_unavailability_window") {
    return "недоступность";
  }
  if (signalType === "schedule_availability_window") {
    return "окно доступности";
  }
  if (signalType === "plan_generation_constraint") {
    return "ограничение плана";
  }
  if (signalType === "pain_injury") {
    return "боль / травма";
  }
  if (signalType === "external_training_context") {
    return "внешний тренировочный контекст";
  }
  if (signalType === "move_workout_candidate") {
    return "запрос на перенос";
  }
  if (signalType === "race_load_context") {
    return "контекст гонки";
  }
  return signalType.replace(/_/g, " ");
}

function getOperationalSignalWindowPart(signal: Pick<TrainingPeaksStudentOperationalSignal, "validFrom" | "validUntil">): string {
  if (signal.validFrom && signal.validUntil) {
    if (signal.validFrom === signal.validUntil) {
      return signal.validFrom;
    }
    return `${signal.validFrom}—${signal.validUntil}`;
  }
  if (signal.validFrom) {
    return `с ${signal.validFrom}`;
  }
  if (signal.validUntil) {
    return `до ${signal.validUntil}`;
  }
  return "";
}

function isHealthOperationalSignalType(signalType: string): boolean {
  return (
    signalType === "health_issue_started" ||
    signalType === "health_issue_improving" ||
    signalType === "pause_training" ||
    signalType === "pain_injury" ||
    signalType === "resume_training"
  );
}

function compactHealthFollowUpReason(rawReason: string | null): string | null {
  if (!rawReason) {
    return null;
  }
  const normalized = rawReason.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }
  return normalized.length <= 70 ? normalized : `${normalized.slice(0, 67).trimEnd()}...`;
}

function formatOperationalHealthFollowUpReason(
  item: Pick<OperationalHealthFollowUpAttentionItem, "state" | "daysOverdue" | "reason">
): string {
  const base = item.reason;
  if (item.state === "pending_overdue") {
    return item.daysOverdue > 0
      ? `просрочено ${item.daysOverdue} дн.: ${base}`
      : `просрочено: ${base}`;
  }
  return `${base}. Срок сегодня`;
}

function getOperationalHealthFollowUpSortKey(
  item: Pick<OperationalHealthFollowUpAttentionItem, "state" | "dueDate" | "studentName">
): string {
  const statePriority = item.state === "pending_overdue" ? "0" : "1";
  const dueDate = item.dueDate ?? "9999-12-31";
  const name = (item.studentName ?? "").toLocaleLowerCase("ru-RU");
  return `${statePriority}:${dueDate}:${name}`;
}

async function listOperationalHealthFollowUpsForAttention(
  activeStudentNameById: ReadonlyMap<string, string | null>,
  maxItems = 5
): Promise<{ items: OperationalHealthFollowUpAttentionItem[]; overflowCount: number }> {
  const asOfDate = getCoachTodayDateKey(DEFAULT_COACH_TIMEZONE);
  const signals = await listTrainingPeaksOperationalSignals({
    status: "active",
    limit: 200,
  });
  return collectOperationalHealthFollowUpsFromSignals({
    signals: signals.items,
    activeStudentNameById,
    asOfDate,
    maxItems,
  });
}

type OperationalPlanningAttentionItem = {
  studentId: string;
  studentName: string | null;
  reason: string;
  episodeKey: string | null;
  signalId: string;
  sortDate: string | null;
};

export type OperationalPainInjuryAttentionItem = {
  studentId: string;
  studentName: string | null;
  reason: string;
  signalId: string;
  signalType: string;
  lifecycleDisplayState: TrainingPeaksOperationalSignalsItem["lifecycleDisplayState"];
  followUpState: TrainingPeaksOperationalSignalsItem["followUpState"];
};

export function extractOperationalPainInjuryItemsFromSnapshot(
  snapshot: TrainingPeaksOperationalSignalsSnapshot
): TrainingPeaksOperationalSignalsItem[] {
  return snapshot.sections.find((section) => section.key === "pain_injury")?.items ?? [];
}

export function mapOperationalPainInjuryItemToAttentionSignal(
  item: OperationalPainInjuryAttentionItem
): TrainingPeaksAttentionSignal {
  return {
    level: "today",
    studentName: item.studentName,
    studentId: item.studentId,
    reason: item.reason,
    signalKind: "operational_pain_injury",
  };
}

function getOperationalPlanningSortKey(
  item: Pick<OperationalPlanningAttentionItem, "sortDate" | "studentName">
): string {
  const date = item.sortDate ?? "9999-12-31";
  const name = (item.studentName ?? "").toLocaleLowerCase("ru-RU");
  return `${date}:${name}`;
}

function collectOperationalPlanningAttentionItems(input: {
  signals: TrainingPeaksStudentOperationalSignal[];
  activeStudentNameById: ReadonlyMap<string, string | null>;
  asOfDate: string;
  signalTypes: Set<string>;
  maxItems: number;
}): { items: OperationalPlanningAttentionItem[]; overflowCount: number } {
  const dedupedByEpisode = new Map<string, OperationalPlanningAttentionItem>();
  const fallbackItems: OperationalPlanningAttentionItem[] = [];
  const scheduleSignalsByEpisode = new Map<string, TrainingPeaksStudentOperationalSignal[]>();

  for (const signal of input.signals) {
    if (!input.signalTypes.has(signal.signalType)) {
      continue;
    }
    if (!isScheduleOperationalSignalType(signal.signalType)) {
      continue;
    }
    const episodeKey = getSignalMetadataString(signal.metadata, "episode_key");
    if (!episodeKey) {
      continue;
    }
    const dedupeKey = `${signal.studentId}:${episodeKey}`;
    const group = scheduleSignalsByEpisode.get(dedupeKey) ?? [];
    group.push(signal);
    scheduleSignalsByEpisode.set(dedupeKey, group);
  }

  for (const [dedupeKey, group] of scheduleSignalsByEpisode) {
    const primarySignal = [...group].sort((left, right) => {
      const leftDate = left.validUntil ?? left.validFrom ?? left.updatedAt ?? left.createdAt ?? "";
      const rightDate = right.validUntil ?? right.validFrom ?? right.updatedAt ?? right.createdAt ?? "";
      if (leftDate !== rightDate) {
        return rightDate.localeCompare(leftDate);
      }
      return right.id.localeCompare(left.id);
    })[0];
    if (!primarySignal) {
      continue;
    }

    const episodeKey = getSignalMetadataString(primarySignal.metadata, "episode_key");
    const reason = buildCanonicalEpisodeScheduleDisplayText({ signals: group });
    const item: OperationalPlanningAttentionItem = {
      studentId: primarySignal.studentId,
      studentName: input.activeStudentNameById.get(primarySignal.studentId) ?? null,
      reason,
      episodeKey,
      signalId: primarySignal.id,
      sortDate:
        primarySignal.validUntil ??
        primarySignal.targetDate ??
        primarySignal.validFrom ??
        primarySignal.sourceDate ??
        null,
    };
    dedupedByEpisode.set(dedupeKey, item);
  }

  for (const signal of input.signals) {
    if (!input.signalTypes.has(signal.signalType)) {
      continue;
    }
    if (isScheduleOperationalSignalType(signal.signalType)) {
      continue;
    }

    const episodeKey = getSignalMetadataString(signal.metadata, "episode_key");
    const reason = `кандидат переноса ${signal.sourceDate ?? "—"} → ${signal.targetDate ?? "—"}`;

    const item: OperationalPlanningAttentionItem = {
      studentId: signal.studentId,
      studentName: input.activeStudentNameById.get(signal.studentId) ?? null,
      reason,
      episodeKey,
      signalId: signal.id,
      sortDate: signal.validUntil ?? signal.targetDate ?? signal.validFrom ?? signal.sourceDate ?? null,
    };

    if (!episodeKey) {
      fallbackItems.push(item);
      continue;
    }

    const dedupeKey = `${item.studentId}:${episodeKey}`;
    const existing = dedupedByEpisode.get(dedupeKey);
    if (!existing) {
      dedupedByEpisode.set(dedupeKey, item);
      continue;
    }

    const existingKey = getOperationalPlanningSortKey(existing);
    const nextKey = getOperationalPlanningSortKey(item);
    const preferred =
      nextKey < existingKey || (nextKey === existingKey && item.signalId < existing.signalId)
        ? item
        : existing;
    dedupedByEpisode.set(dedupeKey, preferred);
  }

  for (const signal of input.signals) {
    if (!input.signalTypes.has(signal.signalType)) {
      continue;
    }
    if (!isScheduleOperationalSignalType(signal.signalType)) {
      continue;
    }
    const episodeKey = getSignalMetadataString(signal.metadata, "episode_key");
    if (episodeKey) {
      continue;
    }

    const episodeContext = null;
    const reason = formatScheduleOperationalSignalText({
      signalType: signal.signalType,
      validFrom: signal.validFrom,
      validUntil: signal.validUntil,
      structuredPayload: signal.structuredPayload,
      episodeContext,
    });

    fallbackItems.push({
      studentId: signal.studentId,
      studentName: input.activeStudentNameById.get(signal.studentId) ?? null,
      reason,
      episodeKey: null,
      signalId: signal.id,
      sortDate: signal.validUntil ?? signal.targetDate ?? signal.validFrom ?? signal.sourceDate ?? null,
    });
  }

  const merged = [...dedupedByEpisode.values(), ...fallbackItems];
  merged.sort((left, right) => {
    const leftKey = getOperationalPlanningSortKey(left);
    const rightKey = getOperationalPlanningSortKey(right);
    if (leftKey !== rightKey) {
      return leftKey.localeCompare(rightKey);
    }
    return left.signalId.localeCompare(right.signalId);
  });

  const limited = merged.slice(0, input.maxItems);
  return {
    items: limited,
    overflowCount: Math.max(0, merged.length - limited.length),
  };
}

async function listOperationalScheduleSignalsForAttention(
  activeStudentNameById: ReadonlyMap<string, string | null>,
  maxItems = 5
): Promise<{ items: OperationalPlanningAttentionItem[]; overflowCount: number }> {
  const asOfDate = getCoachTodayDateKey(DEFAULT_COACH_TIMEZONE);
  const signals = await listTrainingPeaksOperationalSignals({
    status: "active",
    limit: 200,
  });
  if (signals.items.length === 0) {
    return { items: [], overflowCount: 0 };
  }

  return collectOperationalScheduleSignalsForAttentionFromSignals({
    signals: signals.items,
    activeStudentNameById,
    asOfDate,
    maxItems,
  });
}

async function listOperationalMoveSignalsForAttention(
  activeStudentNameById: ReadonlyMap<string, string | null>,
  maxItems = 5
): Promise<{ items: OperationalPlanningAttentionItem[]; overflowCount: number }> {
  const [signals, activeMoveActions] = await Promise.all([
    listTrainingPeaksOperationalSignals({
      status: "active",
      limit: 200,
    }),
    listActiveTrainingPeaksMoveActions(250),
  ]);
  if (signals.items.length === 0) {
    return { items: [], overflowCount: 0 };
  }

  return collectOperationalPlanningAttentionItems({
    signals: signals.items.filter(
      (signal) => !isMoveOperationalSignalType(signal.signalType) || isActionActiveForMoveSignal(signal, activeMoveActions)
    ),
    activeStudentNameById,
    asOfDate: getCoachTodayDateKey(DEFAULT_COACH_TIMEZONE),
    signalTypes: new Set(["move_workout_candidate"]),
    maxItems,
  });
}

async function listOperationalPainInjurySignalsForAttention(
  activeStudentNameById: ReadonlyMap<string, string | null>,
  maxItems = ATTENTION_OPERATIONAL_LIST_MAX_ITEMS
): Promise<{ items: OperationalPainInjuryAttentionItem[]; overflowCount: number }> {
  const asOfDate = getCoachTodayDateKey(DEFAULT_COACH_TIMEZONE);
  const [signals, activeMoveActions] = await Promise.all([
    listTrainingPeaksOperationalSignals({
      status: "active",
      limit: 250,
    }),
    listActiveTrainingPeaksMoveActions(250),
  ]);
  if (signals.items.length === 0) {
    return { items: [], overflowCount: 0 };
  }

  const displayEvidenceBySignalId = await buildOperationalSignalDisplayEvidenceMap({
    signals: signals.items,
    asOfDate,
  });
  const snapshot = buildTrainingPeaksOperationalSignalsSnapshotFromSignals({
    signals: signals.items,
    studentNameById: activeStudentNameById,
    asOfDate,
    scope: "all",
    limit: TRAININGPEAKS_OPERATIONAL_SIGNALS_TELEGRAM_LIMIT,
    activeMoveActions,
    displayEvidenceBySignalId,
  });
  const painItems = extractOperationalPainInjuryItemsFromSnapshot(snapshot);
  const limited = painItems.slice(0, maxItems);
  return {
    items: limited.map((item) => ({
      studentId: item.studentId,
      studentName: item.studentName,
      reason: item.text,
      signalId: item.signalId,
      signalType: item.signalType,
      lifecycleDisplayState: item.lifecycleDisplayState,
      followUpState: item.followUpState,
    })),
    overflowCount: Math.max(0, painItems.length - limited.length),
  };
}

export async function safeAttentionSource<T>(
  label: string,
  load: () => Promise<T>,
  fallback: T
): Promise<T> {
  try {
    return await load();
  } catch (error) {
    console.error("trainingpeaks_attention_source_failed", {
      label,
      error: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  }
}

export async function getTrainingPeaksAttentionSnapshot(): Promise<TrainingPeaksAttentionSnapshot> {
  const [actions, jobs] = await safeAttentionSource<
    [
      Awaited<ReturnType<typeof listRecentTrainingPeaksActionsFromRepository>>,
      Awaited<ReturnType<typeof listRecentTrainingPeaksJobs>>,
    ]
  >(
    "recent_actions_and_jobs",
    () => Promise.all([listRecentTrainingPeaksActionsFromRepository(50), listRecentTrainingPeaksJobs(40)]),
    [[], []]
  );
  const latestRunsByActionId = await safeAttentionSource<
    Awaited<ReturnType<typeof listLatestTrainingPeaksActionRunsByActionIds>>
  >(
    "latest_action_runs_by_action_ids",
    () => listLatestTrainingPeaksActionRunsByActionIds(actions.map((action) => action.id)),
    new Map() as Awaited<ReturnType<typeof listLatestTrainingPeaksActionRunsByActionIds>>
  );

  const urgent: TrainingPeaksAttentionSignal[] = [];
  const today: TrainingPeaksAttentionSignal[] = [];
  const observe: TrainingPeaksAttentionSignal[] = [];
  const fyi: TrainingPeaksAttentionSignal[] = [];
  const checkTodaySignals: TrainingPeaksAttentionSignal[] = [];
  const painDiscomfort: TrainingPeaksAttentionSignal[] = [];
  const missedWorkouts: TrainingPeaksAttentionSignal[] = [];
  const planExtras: TrainingPeaksAttentionSignal[] = [];

  for (const action of actions) {
    const studentName = action.studentName?.trim() || null;

    if (action.status === "pending_coach") {
      pushUniqueAttentionSignal(planExtras, {
        level: "today",
        studentName,
        reason: "ждёт решения по переносу тренировки",
        studentId: action.studentId ?? null,
        actionId: action.id,
        signalKind: "move_pending_action",
      });
    }

    if (
      action.executionStatus === "failed" &&
      isWithinLookbackHours(action.updatedAt, 48)
    ) {
      const latestRun = latestRunsByActionId.get(action.id);
      const isResolvedAction = action.status === "rejected";

      if (isResolvedAction) {
        continue;
      }

      if (latestRun) {
        if (latestRun.status === "completed") {
          continue;
        }

        if (latestRun.status === "failed" && isWithinLookbackHours(latestRun.createdAt, 48)) {
          pushUniqueAttentionSignal(checkTodaySignals, {
            level: "today",
            studentName,
            reason: "выполнение переноса завершилось с ошибкой",
            studentId: action.studentId ?? null,
            actionId: action.id,
            signalKind: "move_failed_action",
          });
        }
        continue;
      }

      pushUniqueAttentionSignal(checkTodaySignals, {
        level: "today",
        studentName,
        reason: "выполнение переноса завершилось с ошибкой",
        studentId: action.studentId ?? null,
        actionId: action.id,
        signalKind: "move_failed_action",
      });
    }

    // Stuck detection is temporarily disabled: we need a more reliable source of truth
    // before surfacing intermediate statuses in /tp_attention.
  }

  const yesterdayDate = getYesterdayBelgradeIsoDate();
  const [activeStudents, yesterdayWorkoutRows, yesterdayScanStatuses] = await safeAttentionSource<
    [
      Awaited<ReturnType<typeof listTrainingPeaksStudents>>,
      Awaited<ReturnType<typeof listTrainingPeaksWorkoutCacheForDateRange>>,
      Awaited<ReturnType<typeof listTrainingPeaksWorkoutCacheScanStatusesCoveringDate>>,
    ]
  >(
    "yesterday_scan_sources",
    () =>
      Promise.all([
        listTrainingPeaksStudents(),
        listTrainingPeaksWorkoutCacheForDateRange({
          from: yesterdayDate,
          to: yesterdayDate,
        }),
        listTrainingPeaksWorkoutCacheScanStatusesCoveringDate(yesterdayDate),
      ]),
    [[], [], []]
  );

  const rowsByStudentId = new Map<string, (typeof yesterdayWorkoutRows)>();
  for (const row of yesterdayWorkoutRows) {
    const rows = rowsByStudentId.get(row.studentId) ?? [];
    rows.push(row);
    rowsByStudentId.set(row.studentId, rows);
  }

  const yesterdayScanSummary = summarizeYesterdayScanAttention({
    activeStudents: activeStudents.map((student) => ({
      id: student.id,
      studentName: student.studentName?.trim() || null,
    })),
    statuses: yesterdayScanStatuses.map((status) => ({
      studentId: status.studentId,
      status: status.status,
      scannedAt: status.scannedAt,
    })),
  });

  if (yesterdayScanSummary.actionableFailedCount > 0) {
    const failedCount = yesterdayScanSummary.actionableFailedCount;
    const studentNoun = formatRussianCountedNoun(failedCount, ["ученик", "ученика", "учеников"]);
    let namesSuffix = "";
    if (failedCount <= YESTERDAY_SCAN_SMALL_FAILURE_NAMES_LIMIT) {
      namesSuffix = ` (${yesterdayScanSummary.actionableFailedNames.join(", ")})`;
    } else if (yesterdayScanSummary.actionableFailedNames.length > 0) {
      const previewNames = yesterdayScanSummary.actionableFailedNames.slice(
        0,
        YESTERDAY_SCAN_FAILURE_PREVIEW_NAMES_LIMIT
      );
      const hiddenNames = Math.max(0, failedCount - previewNames.length);
      namesSuffix =
        hiddenNames > 0
          ? `; первые: ${previewNames.join(", ")}; ещё ${hiddenNames}`
          : `; первые: ${previewNames.join(", ")}`;
    }
    pushUniqueAttentionSignal(checkTodaySignals, {
      level: "today",
      studentName: null,
      reason: `⚠️ Скан TP за вчера не прошёл (${failedCount} ${studentNoun}${namesSuffix}) — данные о тренировках могут быть неполными. Перелогинься: npm run tp-login (в tools/trainingpeaks-export)`,
      signalKind: "scan_failed",
    });
  }

  for (const student of activeStudents) {
    const studentName = student.studentName?.trim() || null;
    const scanStatus = yesterdayScanSummary.latestStatusByStudentId.get(student.id);
    const fallbackOkStatus = yesterdayScanSummary.latestOkStatusByStudentId.get(student.id);

    // Determine effective scan: use latest if ok, else fall back to last ok within 48h
    let usedFallback = false;
    if (scanStatus?.status === "ok") {
      // normal path
    } else if (
      fallbackOkStatus &&
      isWithinLookbackHours(fallbackOkStatus.scannedAt, YESTERDAY_SCAN_FAILURE_TTL_HOURS)
    ) {
      usedFallback = true;
    } else {
      continue;
    }

    const studentRows = rowsByStudentId.get(student.id) ?? [];
    if (studentRows.length === 0) {
      continue;
    }

    let missedRunningPlannedCount = 0;
    for (const row of studentRows) {
      if (!row.isPlanned || row.isCompleted) {
        continue;
      }

      const classification = classifyTrainingPeaksWorkoutActivity({
        title: row.title,
        sportOrTypeCode: row.sportOrTypeCode,
        workoutTypeValueId: row.workoutTypeValueId,
        workoutSubTypeId: row.workoutSubTypeId,
        sourceSnapshot: row.sourceSnapshot,
      });

      if (classification.isRunning) {
        missedRunningPlannedCount += 1;
      }
    }

    const staleSuffix = usedFallback ? " (по данным предыдущего скана)" : "";

    if (missedRunningPlannedCount === 1) {
      pushUniqueAttentionSignal(missedWorkouts, {
        level: "today",
        studentName,
        reason: `вчера была беговая тренировка, выполнения не найдено${staleSuffix}`,
        studentId: student.id,
        signalKind: "missed_workout",
      });
      continue;
    }

    if (missedRunningPlannedCount > 1) {
      pushUniqueAttentionSignal(missedWorkouts, {
        level: "today",
        studentName,
        reason: `${formatMissedRunningWorkoutReason(missedRunningPlannedCount)}${staleSuffix}`,
        studentId: student.id,
        signalKind: "missed_workout",
      });
    }
  }

  if (yesterdayScanSummary.shouldShowMissingScanAlert && yesterdayScanSummary.missingScanCount > 0) {
    const missingCount = yesterdayScanSummary.missingScanCount;
    pushUniqueAttentionSignal(fyi, {
      level: "fyi",
      studentName: null,
      reason: `Нет свежего скана тренировок за вчера для ${missingCount} ${formatRussianCountedNoun(missingCount, ["ученика", "учеников", "учеников"])}`,
      signalKind: "fyi",
    });
  }

  const recoveryAlertTargetDate = yesterdayDate;
  const recoveryAlertFromDate = shiftBelgradeIsoDate(recoveryAlertTargetDate, -2);
  const eligibleRecoveryProfiles = await safeAttentionSource<
    Awaited<ReturnType<typeof listTrainingPeaksStudentsEligibleForHealthMetrics>>
  >(
    "eligible_students_for_health_metrics",
    () => listTrainingPeaksStudentsEligibleForHealthMetrics(),
    []
  );
  for (const profile of eligibleRecoveryProfiles) {
    const metrics = await safeAttentionSource<
      Awaited<ReturnType<typeof listTrainingPeaksHealthMetricsForStudentDateRange>>
    >(
      `health_metrics_for_student:${profile.studentId}`,
      () =>
        listTrainingPeaksHealthMetricsForStudentDateRange({
          studentId: profile.studentId,
          from: recoveryAlertFromDate,
          to: recoveryAlertTargetDate,
        }),
      []
    );
    const alert = evaluateTrainingPeaksRecoveryAlert({
      profile,
      metrics,
      targetDate: recoveryAlertTargetDate,
      lookbackDays: 3,
    });
    if (!alert) {
      continue;
    }
    pushUniqueAttentionSignal(observe, {
      level: "observe",
      studentName: profile.studentName?.trim() || null,
      reason: alert.message,
      studentId: profile.studentId,
      signalKind: "recovery_alert",
    });
  }

  for (const job of jobs) {
    if (job.status !== "failed") {
      continue;
    }
    if (!isWithinLookbackHours(job.updatedAt, 48)) {
      continue;
    }

    if (job.jobType === "race_scan_events") {
      pushUniqueAttentionSignal(checkTodaySignals, {
        level: "today",
        studentName: null,
        reason: "последний запуск сканирования забегов завершился с ошибкой",
        signalKind: "failed_job",
      });
      continue;
    }

    pushUniqueAttentionSignal(checkTodaySignals, {
      level: "today",
      studentName: null,
      reason: "последний запуск TP завершился с ошибкой",
      signalKind: "failed_job",
    });
  }

  const activeStudentNameById = new Map(
    activeStudents.map((student) => [student.id, student.studentName?.trim() || null])
  );
  const caseStatusesForAttention = ["logged", "open", "needs_review"] as const;
  const nowMs = Date.now();
  let contactStatuses: Awaited<ReturnType<typeof listTrainingPeaksStudentContactStatusInRepository>> = [];
  try {
    contactStatuses = await listTrainingPeaksStudentContactStatusInRepository();
  } catch (error) {
    console.warn("Failed to load TrainingPeaks student contact status for attention snapshot", {
      error,
    });
  }
  try {
    const moveNeedsReviewCases = await listRecentTrainingPeaksCoachCasesForAttention({
      sinceHours: 72,
      caseKinds: ["move_workout_needs_review"],
      statuses: caseStatusesForAttention,
      limit: 300,
    });

    for (const caseRow of moveNeedsReviewCases) {
      const studentName = activeStudentNameById.get(caseRow.studentId) ?? null;
      const createdAtLabel = formatAttentionCaseCreatedAtLabel(caseRow.createdAt);
      pushUniqueAttentionSignal(planExtras, {
        level: "today",
        studentName,
        reason: createdAtLabel
          ? `перенос тренировки требует проверки (${createdAtLabel})`
          : "перенос тренировки требует проверки",
        studentId: caseRow.studentId,
        caseId: caseRow.id,
        signalKind: "move_needs_review_case",
      });
    }
  } catch (error) {
    console.warn("Failed to load coach case signals for attention snapshot", { error });
  }

  try {
    const painSignals = await listOperationalPainInjurySignalsForAttention(
      activeStudentNameById,
      ATTENTION_OPERATIONAL_LIST_MAX_ITEMS
    );
    for (const item of painSignals.items) {
      pushUniqueAttentionSignal(painDiscomfort, mapOperationalPainInjuryItemToAttentionSignal(item));
    }
  } catch (error) {
    console.warn("Failed to load operational pain/injury signals for attention snapshot", { error });
  }

  let followUpToday: TrainingPeaksAttentionSignal[] = [];
  let followUpOverflowCount = 0;
  let planConstraintsToday: TrainingPeaksAttentionSignal[] = [];
  let planConstraintsOverflowCount = 0;
  let movesToday: TrainingPeaksAttentionSignal[] = [];
  let movesOverflowCount = 0;
  const noContact5Days: TrainingPeaksAttentionSignal[] = [];
  const noContactStatuses = contactStatuses
    .map((status) => {
      const contactDisplay = buildTrainingPeaksContactDisplay(
        { lastCoachTouchAt: status.lastCoachTouchAt },
        nowMs
      );
      return {
        status,
        contactDisplay,
      };
    })
    .filter(
      ({ status, contactDisplay }) =>
        activeStudentNameById.has(status.studentId) &&
        contactDisplay.daysWithoutContact !== null &&
        contactDisplay.daysWithoutContact >= ATTENTION_NO_CONTACT_MINIMUM_COACH_IDLE_DAYS
    )
    .sort((left, right) => {
      const leftCoachIdleDays = left.contactDisplay.daysWithoutContact ?? 0;
      const rightCoachIdleDays = right.contactDisplay.daysWithoutContact ?? 0;
      if (leftCoachIdleDays !== rightCoachIdleDays) {
        return rightCoachIdleDays - leftCoachIdleDays;
      }
      const leftName = (activeStudentNameById.get(left.status.studentId) ?? "").toLocaleLowerCase("ru-RU");
      const rightName = (activeStudentNameById.get(right.status.studentId) ?? "").toLocaleLowerCase("ru-RU");
      return leftName.localeCompare(rightName, "ru-RU");
    });

  for (const { status } of noContactStatuses) {
    const studentName = activeStudentNameById.get(status.studentId) ?? null;
    pushUniqueAttentionSignal(noContact5Days, {
      level: "fyi",
      studentName,
      studentId: status.studentId,
      reason: "",
      signalKind: "no_contact",
    });
  }

  try {
    const followUps = await listOperationalHealthFollowUpsForAttention(
      activeStudentNameById,
      ATTENTION_OPERATIONAL_LIST_MAX_ITEMS
    );
    followUpToday = followUps.items.map((item) => ({
      level: "today",
      studentName: item.studentName,
      studentId: item.studentId,
      reason: item.reason,
      signalKind: "operational_follow_up",
    }));
    followUpOverflowCount = followUps.overflowCount;
  } catch (error) {
    console.warn("Failed to load operational signal follow-ups for attention snapshot", { error });
  }

  try {
    const scheduleSignals = await listOperationalScheduleSignalsForAttention(
      activeStudentNameById,
      ATTENTION_OPERATIONAL_LIST_MAX_ITEMS
    );
    planConstraintsToday = scheduleSignals.items.map((item) => ({
      level: "today",
      studentName: item.studentName,
      studentId: item.studentId,
      reason: item.reason,
      signalKind: "operational_schedule",
    }));
    planConstraintsOverflowCount = scheduleSignals.overflowCount;
    for (const signal of planExtras) {
      pushUniqueAttentionSignal(planConstraintsToday, signal);
    }
  } catch (error) {
    console.warn("Failed to load operational schedule signals for attention snapshot", { error });
    for (const signal of planExtras) {
      pushUniqueAttentionSignal(planConstraintsToday, signal);
    }
  }

  try {
    const moveSignals = await listOperationalMoveSignalsForAttention(
      activeStudentNameById,
      ATTENTION_OPERATIONAL_LIST_MAX_ITEMS
    );
    movesToday = moveSignals.items.map((item) => ({
      level: "today",
      studentName: item.studentName,
      studentId: item.studentId,
      reason: item.reason,
      signalKind: "operational_move",
    }));
    movesOverflowCount = moveSignals.overflowCount;
  } catch (error) {
    console.warn("Failed to load operational move signals for attention snapshot", { error });
  }

  return {
    urgent,
    today,
    observe,
    fyi,
    checkTodaySignals,
    painDiscomfort,
    missedWorkouts,
    noContact5Days,
    followUpToday,
    followUpOverflowCount,
    planConstraintsToday,
    planConstraintsOverflowCount,
    movesToday,
    movesOverflowCount,
  };
}

const TRAININGPEAKS_OPERATIONAL_SIGNALS_SECTION_ORDER: TrainingPeaksOperationalSignalsSectionKey[] = [
  "health_pause",
  "pain_injury",
  "plan_constraints",
  "moves",
  "other",
];

function createOperationalSignalsSections(): Record<
  TrainingPeaksOperationalSignalsSectionKey,
  TrainingPeaksOperationalSignalsSection
> {
  return {
    health_pause: {
      key: "health_pause",
      title: "🟡 Болезнь / самочувствие",
      items: [],
    },
    pain_injury: {
      key: "pain_injury",
      title: "🦵 Травмы / боль / дискомфорт",
      items: [],
    },
    plan_constraints: {
      key: "plan_constraints",
      title: "📅 Учесть в плане",
      items: [],
    },
    moves: {
      key: "moves",
      title: "🔁 Переносы",
      items: [],
    },
    other: {
      key: "other",
      title: "ℹ️ Остальное",
      items: [],
    },
  } as Record<TrainingPeaksOperationalSignalsSectionKey, TrainingPeaksOperationalSignalsSection>;
}

function shouldKeepOperationalSignalByScope(
  signalType: string,
  scope: TrainingPeaksOperationalSignalsScope
): boolean {
  if (scope === "all") {
    return true;
  }
  if (scope === "health") {
    return isHealthOperationalSignalType(signalType);
  }
  if (scope === "schedule") {
    return isScheduleOperationalSignalType(signalType);
  }
  return isMoveOperationalSignalType(signalType);
}

function getOperationalSignalSortKey(item: TrainingPeaksOperationalSignalsItem): string {
  const due = item.dueDate ?? "9999-12-31";
  const name = (item.studentName ?? "").toLocaleLowerCase("ru-RU");
  return `${String(item.priority).padStart(4, "0")}:${String(item.sortBucket).padStart(2, "0")}:${due}:${name}:${item.signalId}`;
}

type EffectiveOperationalSignalForDisplay = {
  effectiveSignalType: string;
  effectiveActivityDomain: string | null;
  effectivePlanningEffect: string | null;
  effectiveVisibleInTpSignals: boolean | null;
  effectiveDisplaySummary: string | null;
  effectiveRequiresCoachReview: boolean | null;
};

type OperationalSignalDisplayLifecycleState =
  | "active_problem"
  | "monitoring_after_return"
  | "ready_for_coach_close"
  | "stale_needs_review";

function isPainInjuryOperationalSignalForDisplay(
  effective: EffectiveOperationalSignalForDisplay
): boolean {
  if (effective.effectiveSignalType === "pain_injury") {
    return true;
  }
  if (effective.effectiveActivityDomain === "injury") {
    return true;
  }
  return false;
}

const MUSCULOSKELETAL_BODY_PART_CUES = [
  "надкостниц",
  "голен",
  "колен",
  "ахилл",
  "стоп",
  "ступн",
  "икр",
  "бедр",
  "спин",
  "поясниц",
  "нерв",
  "палец",
  "пальц",
  "мозол",
  "обув",
  "кроссов",
  "шиповк",
  "натер",
  "натёр",
  "опух",
  "отек",
  "отёк",
  "таз",
  "передн",
  "мышечн",
  "стабилизатор",
] as const;

const CLEAR_ILLNESS_SYMPTOM_CUES = [
  "кашель",
  "насморк",
  "температур",
  "горло",
  "простуд",
  "простыл",
  "простыла",
  "болеет",
  "орви",
  "сопли",
] as const;

const TRAVEL_SCHEDULE_CUES = [
  "дорог",
  "поездк",
  "уезжа",
  "улета",
  "перелёт",
  "перелет",
  "командировк",
  "в отъезде",
] as const;

const TRAINING_UNAVAILABILITY_CUES = [
  "не смогу бегать",
  "бегать не смогу",
  "не смогу тренироваться",
  "не буду бегать",
  "не получится бегать",
  "тренироваться не смогу",
] as const;

function normalizeOperationalSignalSemanticText(parts: Array<string | null | undefined>): string {
  return parts
    .filter((part): part is string => Boolean(part && part.trim().length > 0))
    .join(" ")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

function textIncludesAnyCue(text: string, cues: readonly string[]): boolean {
  return cues.some((cue) => text.includes(cue));
}

const STANDALONE_PAIN_WORD_PATTERN = /(?:^|[^\p{L}])боль(?![а-яё])/iu;

function hasStandalonePainWordSemantic(text: string): boolean {
  return STANDALONE_PAIN_WORD_PATTERN.test(text);
}

function hasOperationalPainVerbSemantic(text: string): boolean {
  return /болит|болел[ао]?|болят|побалива/iu.test(text);
}

function hasMusculoskeletalPainSemantic(text: string): boolean {
  if (textIncludesAnyCue(text, MUSCULOSKELETAL_BODY_PART_CUES) && /чувств|ноет|тянет/iu.test(text)) {
    return true;
  }
  const hasPainCue =
    hasOperationalPainVerbSemantic(text) ||
    hasStandalonePainWordSemantic(text) ||
    textIncludesAnyCue(text, [
      "болела",
      "болело",
      "болев",
      "побал",
      "дискомфорт",
      "защем",
      "мозол",
      "натер",
      "натёр",
      "опух",
      "отек",
      "отёк",
    ]);
  if (!hasPainCue) {
    return false;
  }
  if (textIncludesAnyCue(text, MUSCULOSKELETAL_BODY_PART_CUES)) {
    return true;
  }
  return (
    /передн\w*\s+част\w*\s+бедр/iu.test(text) ||
    /бедр\w*\s+болит/iu.test(text)
  );
}

function hasClearIllnessSemantic(text: string): boolean {
  return textIncludesAnyCue(text, CLEAR_ILLNESS_SYMPTOM_CUES);
}

function isTravelOnlyTrainingUnavailabilitySemantic(text: string): boolean {
  if (!textIncludesAnyCue(text, TRAVEL_SCHEDULE_CUES)) {
    return false;
  }
  const hasTrainingConstraint =
    textIncludesAnyCue(text, TRAINING_UNAVAILABILITY_CUES) ||
    (/не\s+(?:смогу|могу)/iu.test(text) && /бег|трениров/iu.test(text));
  if (!hasTrainingConstraint) {
    return false;
  }
  if (hasClearIllnessSemantic(text) || hasMusculoskeletalPainSemantic(text)) {
    return false;
  }
  return true;
}

function hasRecoveryReadySemantic(text: string): boolean {
  return /завтра.*(?:выйду|побегаю|пробегу|бегу)|(?:выйду|побегаю|пробегу).*завтра|готов.*(?:бегать|бежать)|разрешил[аи].*(?:бегать|бежать)|выйду.*побега/iu.test(
    text
  );
}

function painLimitsRunningSemantic(text: string): boolean {
  if (isTravelOnlyTrainingUnavailabilitySemantic(text)) {
    return false;
  }
  if (!hasMusculoskeletalPainSemantic(text)) {
    return false;
  }
  return /не\s+(?:смогу|могу)\s+бегать|бегать\s+не\s+смогу|не\s+могу\s+бежать|мешает\s+бегать/iu.test(text);
}

function collectOperationalSignalSemanticTexts(input: {
  signal: TrainingPeaksStudentOperationalSignal;
  effective: EffectiveOperationalSignalForDisplay;
  sourceText?: string | null;
}): string {
  return normalizeOperationalSignalSemanticText([
    input.effective.effectiveDisplaySummary,
    resolveOperationalSignalDisplaySummary(input.signal),
    normalizeRecordString(input.signal.structuredPayload.latest_summary),
    normalizeRecordString(input.signal.structuredPayload.display_summary),
    getSignalMetadataString(input.signal.metadata, "follow_up_reason"),
    input.sourceText,
  ]);
}

type OperationalSignalDisplaySemantics = {
  effective: EffectiveOperationalSignalForDisplay;
  rerouteSection: TrainingPeaksOperationalSignalsSectionKey | null;
  rerouteScheduleText: string | null;
};

function formatTravelOnlyScheduleDisplayText(input: {
  signal: TrainingPeaksStudentOperationalSignal;
  sourceText: string | null;
  summary: string | null;
}): string {
  const reason = (input.sourceText ?? input.summary ?? "ограничение по расписанию").replace(/\s+/gu, " ").trim();
  const summarized = summarizeLongScheduleConstraintText(reason);
  if (summarized) {
    return summarized;
  }
  return compactCoachFacingScheduleSignalText(reason);
}

function resolveOperationalSignalDisplaySemantics(input: {
  signal: TrainingPeaksStudentOperationalSignal;
  effective: EffectiveOperationalSignalForDisplay;
  sourceText?: string | null;
}): OperationalSignalDisplaySemantics {
  const semanticText = collectOperationalSignalSemanticTexts(input);
  let effective = input.effective;

  if (
    isHealthOperationalSignalType(effective.effectiveSignalType) &&
    !isPainInjuryOperationalSignalForDisplay(effective) &&
    hasMusculoskeletalPainSemantic(semanticText)
  ) {
    effective = {
      ...effective,
      effectiveSignalType: "pain_injury",
      effectiveActivityDomain: "injury",
    };
  }

  if (
    isHealthOperationalSignalType(effective.effectiveSignalType) &&
    isTravelOnlyTrainingUnavailabilitySemantic(semanticText)
  ) {
    return {
      effective,
      rerouteSection: "plan_constraints",
      rerouteScheduleText: formatTravelOnlyScheduleDisplayText({
        signal: input.signal,
        sourceText: input.sourceText ?? null,
        summary: resolveOperationalSignalDisplaySummary(input.signal),
      }),
    };
  }

  return {
    effective,
    rerouteSection: null,
    rerouteScheduleText: null,
  };
}

function shouldHideNutritionOnlyScheduleSignal(input: {
  signal: TrainingPeaksStudentOperationalSignal;
  effective: EffectiveOperationalSignalForDisplay;
  sourceText?: string | null;
}): boolean {
  const semanticText = collectOperationalSignalSemanticTexts(input);
  return isNutritionOnlyScheduleConstraintText(semanticText);
}

function resolveOperationalSignalDisplaySection(
  effective: EffectiveOperationalSignalForDisplay
): TrainingPeaksOperationalSignalsSectionKey {
  if (isPainInjuryOperationalSignalForDisplay(effective)) {
    return "pain_injury";
  }
  if (isHealthOperationalSignalType(effective.effectiveSignalType)) {
    return "health_pause";
  }
  if (isScheduleOperationalSignalType(effective.effectiveSignalType)) {
    return "plan_constraints";
  }
  if (isMoveOperationalSignalType(effective.effectiveSignalType)) {
    return "moves";
  }
  return "other";
}

export function resolveEffectiveOperationalSignalForDisplay(
  signal: Pick<TrainingPeaksStudentOperationalSignal, "signalType" | "structuredPayload" | "metadata">
): EffectiveOperationalSignalForDisplay {
  return {
    effectiveSignalType:
      normalizeRecordString(signal.structuredPayload.signal_type) ??
      getSignalMetadataString(signal.metadata, "signal_type") ??
      signal.signalType,
    effectiveActivityDomain:
      normalizeRecordString(signal.structuredPayload.activity_domain) ??
      getSignalMetadataString(signal.metadata, "activity_domain"),
    effectivePlanningEffect:
      normalizeRecordString(signal.structuredPayload.planning_effect) ??
      getSignalMetadataString(signal.metadata, "planning_effect"),
    effectiveVisibleInTpSignals:
      normalizeRecordBoolean(signal.structuredPayload.visible_in_tp_signals) ??
      getSignalMetadataBoolean(signal.metadata, "visible_in_tp_signals"),
    effectiveDisplaySummary:
      normalizeRecordString(signal.structuredPayload.display_summary) ??
      normalizeRecordString(signal.structuredPayload.latest_summary) ??
      getSignalMetadataString(signal.metadata, "display_summary") ??
      getSignalMetadataString(signal.metadata, "latest_summary"),
    effectiveRequiresCoachReview:
      normalizeRecordBoolean(signal.structuredPayload.requires_coach_review) ??
      getSignalMetadataBoolean(signal.metadata, "requires_coach_review"),
  };
}

function isSignalMarkedStaleNeedsReview(signal: TrainingPeaksStudentOperationalSignal): boolean {
  const metadata = signal.metadata;
  const payload = signal.structuredPayload;
  const lifecycleMeta = signal.lifecycleMeta;
  const markerCandidates = [
    getSignalMetadataString(metadata, "lifecycle_effective"),
    getSignalMetadataString(metadata, "proposed_action"),
    normalizeRecordString(payload.lifecycle_effective),
    normalizeRecordString(payload.proposed_action),
    normalizeRecordString(lifecycleMeta.lifecycle_effective),
    normalizeRecordString(lifecycleMeta.proposed_action),
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.trim().toLowerCase());
  if (
    markerCandidates.includes("stale_needs_review") ||
    markerCandidates.includes("stale")
  ) {
    return true;
  }
  return (
    getSignalMetadataBoolean(metadata, "stale_needs_review") === true ||
    normalizeRecordBoolean(payload.stale_needs_review) === true ||
    normalizeRecordBoolean(lifecycleMeta.stale_needs_review) === true
  );
}

function resolveOperationalSignalLatestNegativeText(
  signal: TrainingPeaksStudentOperationalSignal,
  evidence: TrainingPeaksOperationalSignalDisplayEvidence | null | undefined
): string | null {
  const negativeAfterCompletion = resolveNegativeAfterCompletionDisplayText(evidence);
  if (negativeAfterCompletion) {
    return negativeAfterCompletion;
  }
  const latestNegative = evidence?.latestNegative;
  if (!latestNegative?.observedAt || latestNegative.observedAt < signal.createdAt) {
    return null;
  }
  const text = latestNegative.textPreview?.replace(/\s+/g, " ").trim() ?? "";
  return isOperationalNegativeObservationText(text) ? text : null;
}

function hasOperationalDisplayNegativeEvidence(input: {
  signal: TrainingPeaksStudentOperationalSignal;
  evidence: TrainingPeaksOperationalSignalDisplayEvidence | null | undefined;
  completion: OperationalSignalLifecycleInput["latestTpCompletionAfterOpen"];
}): boolean {
  if (resolveOperationalSignalLatestNegativeText(input.signal, input.evidence)) {
    return true;
  }
  return hasDisplayNegativeAfterRunningCompletion({
    evidence: input.evidence,
    completion: input.completion,
  });
}

function hasFreshOperationalPainCloseEvidence(
  signal: TrainingPeaksStudentOperationalSignal,
  evidence: TrainingPeaksOperationalSignalDisplayEvidence | null | undefined
): boolean {
  const latestPositive = evidence?.latestPositive;
  if (!latestPositive?.observedAt || latestPositive.observedAt < signal.createdAt) {
    return false;
  }
  const positiveText = latestPositive.textPreview?.replace(/\s+/g, " ").trim() ?? "";
  if (!isOperationalPositiveObservationText(positiveText)) {
    return false;
  }
  const positiveAt = Date.parse(latestPositive.observedAt);
  const latestNegative = evidence?.latestNegative;
  if (latestNegative?.observedAt) {
    const negativeAt = Date.parse(latestNegative.observedAt);
    if (Number.isFinite(positiveAt) && Number.isFinite(negativeAt) && negativeAt >= positiveAt) {
      const negativeText = latestNegative.textPreview?.replace(/\s+/g, " ").trim() ?? "";
      if (
        isOperationalNegativeObservationText(negativeText) ||
        matchesOperationalPainNegativeSemantic(negativeText)
      ) {
        return false;
      }
    }
  }
  return true;
}

function hasFreshIllnessCloseCandidateEvidence(
  signal: TrainingPeaksStudentOperationalSignal,
  evidence: TrainingPeaksOperationalSignalDisplayEvidence | null | undefined
): boolean {
  if (signal.lifecycleState !== "monitoring_after_return") {
    return false;
  }
  const effective = resolveEffectiveOperationalSignalForDisplay(signal);
  if (!isHealthOperationalSignalType(effective.effectiveSignalType)) {
    return false;
  }
  if (isPainInjuryOperationalSignalForDisplay(effective)) {
    return false;
  }
  const completion = evidence?.completion?.latestCompletionAfterOpen ?? null;
  if (!hasReliableRunningCompletionAfterOpen(completion)) {
    return false;
  }
  if (hasOperationalDisplayNegativeEvidence({ signal, evidence, completion })) {
    return false;
  }
  if (evidence?.completion?.recommendedAction === "coach_close_candidate") {
    return true;
  }
  return true;
}

export function resolveOperationalSignalDisplayLifecycleState(
  signal: TrainingPeaksStudentOperationalSignal,
  evidence?: TrainingPeaksOperationalSignalDisplayEvidence | null
): OperationalSignalDisplayLifecycleState {
  if (isSignalMarkedStaleNeedsReview(signal)) {
    return "stale_needs_review";
  }
  const effective = resolveEffectiveOperationalSignalForDisplay(signal);
  if (evidence) {
    if (isPainInjuryOperationalSignalForDisplay(effective) && hasFreshOperationalPainCloseEvidence(signal, evidence)) {
      return "ready_for_coach_close";
    }
    if (!isPainInjuryOperationalSignalForDisplay(effective) && hasFreshIllnessCloseCandidateEvidence(signal, evidence)) {
      return "ready_for_coach_close";
    }
  }
  if (signal.lifecycleState === "monitoring_after_return") {
    if (signal.requiresCoachClose) {
      return "ready_for_coach_close";
    }
    return "monitoring_after_return";
  }
  return "active_problem";
}

function parseNumberishOperationalSignal(value: number | string | null | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const parsed = Number(value.replace(",", ".").replace(/[^\d.-]/gu, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function deriveOperationalSignalCompletionDelta(workout: TrainingPeaksWorkoutCacheRow): PlannedVsCompletedDelta {
  const complianceDuration = parseNumberishOperationalSignal(workout.complianceDurationPercent);
  const complianceDistance = parseNumberishOperationalSignal(workout.complianceDistancePercent);
  if (complianceDuration !== null && complianceDuration < 80) {
    return "modified_easy";
  }
  if (complianceDistance !== null && complianceDistance < 80) {
    return "modified_easy";
  }
  const plannedTime = parseNumberishOperationalSignal(workout.plannedTimeRaw);
  const completedTime = parseNumberishOperationalSignal(workout.completedTimeRaw);
  if (plannedTime !== null && plannedTime > 0 && completedTime !== null) {
    const ratio = completedTime / plannedTime;
    if (ratio < 0.8) {
      return "modified_easy";
    }
    if (ratio > 1.25) {
      return "modified_other";
    }
    return "normal";
  }
  return "unknown";
}

function deriveOperationalSignalEvidenceFreshness(
  workout: TrainingPeaksWorkoutCacheRow,
  asOfDate: string
): EvidenceFreshness {
  const asOf = new Date(`${asOfDate}T23:59:59.999Z`).getTime();
  const scannedAt = Date.parse(workout.scannedAt);
  if (!Number.isFinite(scannedAt)) {
    return "missing";
  }
  const ageDays = (asOf - scannedAt) / (24 * 60 * 60 * 1000);
  return ageDays > 3 ? "stale" : "ok";
}

function classifyOperationalSignalWorkout(workout: TrainingPeaksWorkoutCacheRow) {
  const sourceSnapshot =
    workout.sourceSnapshot && typeof workout.sourceSnapshot === "object" && !Array.isArray(workout.sourceSnapshot)
      ? (workout.sourceSnapshot as Record<string, unknown>)
      : {};
  return classifyTpWorkoutEvidence({
    workoutId: String(workout.trainingPeaksWorkoutId),
    workoutDate: workout.workoutDate,
    title: workout.title,
    description: typeof sourceSnapshot.description === "string" ? sourceSnapshot.description : null,
    coachComments: typeof sourceSnapshot.coachComments === "string" ? sourceSnapshot.coachComments : null,
    sportOrTypeCode: workout.sportOrTypeCode,
    workoutTypeValueId: workout.workoutTypeValueId,
    workoutSubTypeId: workout.workoutSubTypeId,
    snapshotWorkoutTypeValueId:
      typeof sourceSnapshot.workoutTypeValueId === "number" ? sourceSnapshot.workoutTypeValueId : null,
    snapshotRawWorkoutTypeValueId:
      typeof sourceSnapshot.rawWorkoutTypeValueId === "number" ? sourceSnapshot.rawWorkoutTypeValueId : null,
    snapshotRawWorkoutSubTypeId:
      typeof sourceSnapshot.rawWorkoutSubTypeId === "number" ? sourceSnapshot.rawWorkoutSubTypeId : null,
    snapshotRawCode: typeof sourceSnapshot.rawCode === "string" ? sourceSnapshot.rawCode : null,
    isPlanned: workout.isPlanned,
    isCompleted: workout.isCompleted,
    plannedVsCompletedDelta: deriveOperationalSignalCompletionDelta(workout),
    complianceDurationPercent: parseNumberishOperationalSignal(workout.complianceDurationPercent),
    complianceDistancePercent: parseNumberishOperationalSignal(workout.complianceDistancePercent),
    plannedTimeRaw: parseNumberishOperationalSignal(workout.plannedTimeRaw),
    completedTimeRaw: parseNumberishOperationalSignal(workout.completedTimeRaw),
    plannedDistanceRaw: parseNumberishOperationalSignal(workout.plannedDistanceRaw),
    completedDistanceRaw: parseNumberishOperationalSignal(workout.completedDistanceRaw),
  });
}

function buildOperationalSignalCompletionInfo(input: {
  workouts: TrainingPeaksWorkoutCacheRow[];
  openedDate: string;
  asOfDate: string;
}): OperationalSignalLifecycleInput["latestTpCompletionAfterOpen"] {
  const candidates = input.workouts
    .filter((workout) => workout.workoutDate >= input.openedDate && workout.workoutDate <= input.asOfDate)
    .filter((workout) => workout.isCompleted)
    .sort((left, right) => {
      if (left.workoutDate === right.workoutDate) {
        return left.trainingPeaksWorkoutId - right.trainingPeaksWorkoutId;
      }
      return left.workoutDate.localeCompare(right.workoutDate);
    });
  const latest = candidates[candidates.length - 1];
  if (!latest) {
    return null;
  }
  const classification = classifyOperationalSignalWorkout(latest);
  return {
    workoutId: String(latest.trainingPeaksWorkoutId),
    workoutDate: latest.workoutDate,
    title: latest.title,
    sportOrTypeCode: latest.sportOrTypeCode,
    sportClass: classification.sportClass,
    runningCompletionClass: classification.runningCompletionClass,
    classificationConfidence: classification.confidence,
    classificationReasonCodes: classification.reasonCodes,
    classificationInspectedFields: classification.inspectedFields,
    plannedVsCompletedDelta: deriveOperationalSignalCompletionDelta(latest),
    evidenceFreshness: deriveOperationalSignalEvidenceFreshness(latest, input.asOfDate),
    completionObservedAt: latest.startTime ?? latest.startTimePlanned ?? null,
  };
}

function getOperationalSignalLifecycle(signal: TrainingPeaksStudentOperationalSignal): OperationalSignalLifecycle {
  if (signal.lifecycleState) {
    return signal.lifecycleState;
  }
  const payloadLifecycle = normalizeRecordString(signal.structuredPayload.lifecycle_state);
  if (
    payloadLifecycle === "active_problem" ||
    payloadLifecycle === "return_planned" ||
    payloadLifecycle === "return_trial_completed" ||
    payloadLifecycle === "monitoring_after_return" ||
    payloadLifecycle === "resolved"
  ) {
    return payloadLifecycle;
  }
  return "active_problem";
}

function classifyOperationalSignalForLifecycle(signal: TrainingPeaksStudentOperationalSignal): OperationalSignalClass {
  const effective = resolveEffectiveOperationalSignalForDisplay(signal);
  const healthKind = normalizeRecordString(signal.structuredPayload.health_issue_kind) ?? "";
  const summary = [
    normalizeRecordString(signal.structuredPayload.display_summary),
    normalizeRecordString(signal.structuredPayload.latest_summary),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (isScheduleOperationalSignalType(effective.effectiveSignalType)) {
    return "schedule_pause";
  }
  if (effective.effectiveSignalType === "resume_training" || effective.effectiveSignalType === "external_training_context") {
    return "return_to_run";
  }
  if (isPainInjuryOperationalSignalForDisplay(effective)) {
    return "injury_pain";
  }
  if (effective.effectiveSignalType === "pause_training") {
    return "confirmed_illness";
  }
  if (isHealthOperationalSignalType(effective.effectiveSignalType)) {
    if (healthKind.includes("ambiguous") || summary.includes("возможно") || summary.includes("не очень")) {
      return "ambiguous_illness";
    }
    return "confirmed_illness";
  }
  return "unknown";
}

function countCleanOperationalSignalRunningCompletions(input: {
  workouts: TrainingPeaksWorkoutCacheRow[];
  openedDate: string;
  asOfDate: string;
}): number {
  let count = 0;
  for (const workout of input.workouts) {
    if (workout.workoutDate < input.openedDate || workout.workoutDate > input.asOfDate || !workout.isCompleted) {
      continue;
    }
    const classification = classifyOperationalSignalWorkout(workout);
    if (
      isCleanRunningCompletion({
        sportClass: classification.sportClass,
        runningCompletionClass: classification.runningCompletionClass,
        classificationConfidence: classification.confidence,
      })
    ) {
      count += 1;
    }
  }
  return count;
}

function toOperationalSignalSourceEvidence(
  observation: TrainingPeaksTelegramContextObservation | null | undefined
): TrainingPeaksOperationalSignalSourceEvidence | null {
  if (!observation) {
    return null;
  }
  return {
    observationId: observation.id,
    observedAt: observation.observedAt,
    sourceType: observation.sourceType,
    textPreview: observation.textPreview,
  };
}

export function matchesOperationalPainNegativeSemantic(text: string): boolean {
  const normalized = normalizeOperationalSignalSemanticText([text]);
  return (
    hasOperationalPainVerbSemantic(normalized) ||
    hasStandalonePainWordSemantic(normalized) ||
    /дискомфорт|травм|защем|мозол|натер|натёр|опух|отек|отёк/iu.test(normalized)
  );
}

export function isOperationalNegativeObservationText(text: string): boolean {
  const normalized = normalizeOperationalSignalSemanticText([text]);
  return (
    OPERATIONAL_NEGATIVE_OBSERVATION_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    hasMusculoskeletalPainSemantic(normalized)
  );
}

export function isOperationalPositiveObservationText(text: string): boolean {
  const normalized = normalizeOperationalSignalSemanticText([text]);
  return OPERATIONAL_RECOVERY_OBSERVATION_PATTERNS.some((pattern) => pattern.test(normalized));
}

function resolveNegativeAfterCompletionDisplayText(
  evidence: TrainingPeaksOperationalSignalDisplayEvidence | null | undefined
): string | null {
  if (!evidence?.completion?.negativeMessageAfterCompletion) {
    return null;
  }
  const negativeAfterCompletion = evidence.negativeAfterCompletion;
  if (negativeAfterCompletion?.observationId === evidence.completion.negativeMessageAfterCompletion.observationId) {
    return negativeAfterCompletion.textPreview?.replace(/\s+/g, " ").trim() ?? null;
  }
  const latestNegative = evidence.latestNegative;
  if (latestNegative?.observationId === evidence.completion.negativeMessageAfterCompletion.observationId) {
    return latestNegative.textPreview?.replace(/\s+/g, " ").trim() ?? null;
  }
  return null;
}

function hasDisplayNegativeAfterRunningCompletion(input: {
  evidence: TrainingPeaksOperationalSignalDisplayEvidence | null | undefined;
  completion: OperationalSignalLifecycleInput["latestTpCompletionAfterOpen"];
}): boolean {
  if (!input.evidence?.completion?.negativeMessageAfterCompletion) {
    return false;
  }
  if (!hasReliableRunningCompletionAfterOpen(input.completion)) {
    return false;
  }
  return Boolean(resolveNegativeAfterCompletionDisplayText(input.evidence));
}

export const AUTO_HIDDEN_CLEAN_ILLNESS_RECOVERY_RUN_REASON = "auto_hidden_clean_recovery_run";

export function shouldAutoHideCleanIllnessRecoveryFromTpSignals(input: {
  signal: TrainingPeaksStudentOperationalSignal;
  effective: EffectiveOperationalSignalForDisplay;
  lifecycleDisplayState: OperationalSignalDisplayLifecycleState;
  displayEvidence?: TrainingPeaksOperationalSignalDisplayEvidence | null;
}): boolean {
  if (input.lifecycleDisplayState === "stale_needs_review") {
    return false;
  }
  if (isPainInjuryOperationalSignalForDisplay(input.effective)) {
    return false;
  }
  if (isScheduleOperationalSignalType(input.effective.effectiveSignalType)) {
    return false;
  }
  if (!isHealthOperationalSignalType(input.effective.effectiveSignalType)) {
    return false;
  }
  const signalClass = classifyOperationalSignalForLifecycle(input.signal);
  if (
    signalClass === "injury_pain" ||
    signalClass === "schedule_pause" ||
    signalClass === "return_to_run"
  ) {
    return false;
  }
  const healthKind = normalizeRecordString(input.signal.structuredPayload.health_issue_kind) ?? "";
  if (healthKind === "pain_or_injury" || healthKind.includes("pain")) {
    return false;
  }
  const completion = input.displayEvidence?.completion?.latestCompletionAfterOpen ?? null;
  if (!hasReliableRunningCompletionAfterOpen(completion)) {
    return false;
  }
  if (
    hasOperationalDisplayNegativeEvidence({
      signal: input.signal,
      evidence: input.displayEvidence ?? null,
      completion,
    })
  ) {
    return false;
  }
  return true;
}

function sortOperationalSignalObservations(
  observations: readonly TrainingPeaksTelegramContextObservation[]
): TrainingPeaksTelegramContextObservation[] {
  return [...observations].sort((left, right) => {
    const byTime = left.observedAt.localeCompare(right.observedAt);
    if (byTime !== 0) {
      return byTime;
    }
    return left.id.localeCompare(right.id);
  });
}

function shiftIsoDateTimeByHours(iso: string, hours: number): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) {
    return iso;
  }
  return new Date(parsed + hours * 60 * 60 * 1000).toISOString();
}

const OPERATIONAL_RECOVERY_OBSERVATION_PATTERNS = [
  /вс[её]\s*(?:ок|хорошо|норм)/iu,
  /хорошо/iu,
  /нормальн/iu,
  /с\s+самочувствием\s+вс[её]\s+в\s+порядке/iu,
  /самочувствие\s+в\s+порядке/iu,
  /по\s+самочувствию\s+вс[её]\s+ок/iu,
  /вс[её]\s+ок\s+по\s+самочувствию/iu,
  /после\s+пробежки\s+вс[её]\s+нормально/iu,
  /самочувствие\s+(?:норм|хорош)/iu,
  /чувствую\s+себя\s+лучше/iu,
  /лучше\s+себя\s+чувствую/iu,
  /вроде\s+(?:лучше|норм|ок)/iu,
  /в\s+строю/iu,
  /врач\s+разрешил[а-яё]*/iu,
  /разрешил[аи]\s+(?:бег|трен)/iu,
  /завтра.*(?:выйду|побегаю|побегу|пробегу|бегу)/iu,
  /(?:выйду|побегаю|побегу|пробегу).*завтра/iu,
  /боли?\s+нет/iu,
  /ничего\s+не\s+болел/iu,
  /не\s+болел[ао]?/iu,
];

const OPERATIONAL_NEGATIVE_OBSERVATION_PATTERNS = [
  /температур/iu,
  /лихорад/iu,
  /боле[еюи]/iu,
  /забол/iu,
  /простуд/iu,
  /кашель|горло|насморк|сопли/iu,
  /хуже|ухудш/iu,
  /слабост|сил\s+нет/iu,
  /боли?\s+(?:снова|опять|вернул[а-яё]*)/iu,
  /болит/iu,
  STANDALONE_PAIN_WORD_PATTERN,
  /болел[ао]?/iu,
  /болят/iu,
  /побалива/iu,
  /дискомфорт|травм|защем|мозол|натер|натёр|опух|отек|отёк/iu,
  /не\s+бегаю|не\s+смогу\s+бегать|не\s+могу\s+бежать|пропущу|пропустил/iu,
  /долеч/u,
  /лучше\s+не\s+становится/u,
  /с\s+новой\s+недел/u,
  /пока\s+продолжаю/u,
  /самочувств(?:ие|ия).*(?:не\s+очень|плох|не\s+хорош|не\s+норм|вс[её]\s+равно)/iu,
  /(?:не\s+очень|плох(?:о|ое)).*самочувств/iu,
  /(?:после|побегал(?:а|и)?).*(?:слабост|не\s+восстанов)/iu,
  /не\s+восстановил(?:ся|ась|ись)/iu,
  /голова\s+круж|головокруж/iu,
  /(?:в\s+)?сон\s+клонит|клонит\s+в\s+сон|хочется\s+спать/iu,
  /(?:меня\s+)?хватило\s+(?:минут\s+)?(?:на\s+)?\d+|хватило\s+минут/iu,
  /(?:^|[,.!\s])плохо(?:[,.!\s]|$)/iu,
];

const OPERATIONAL_PLAN_AGREEMENT_PATTERNS = [
  /\b(?:30|40|тридцать|сорок)\s*(?:мин|минут)/iu,
  /очень\s+легко|тихонечко|спокойно|спокойненько/iu,
  /попроб(?:овать|уй|уем|ую)|провер(?:ить|им)/iu,
  /завтра.*(?:бег|трен|пробеж)/iu,
];

function getObservationSemanticText(observation: TrainingPeaksTelegramContextObservation): string {
  return normalizeOperationalSignalSemanticText([
    observation.textPreview,
    observation.labels.join(" "),
    normalizeRecordString(observation.metadata.signal_type),
    normalizeRecordString(observation.metadata.activity_domain),
  ]);
}

function isOperationalPositiveObservation(observation: TrainingPeaksTelegramContextObservation): boolean {
  const text = getObservationSemanticText(observation);
  return OPERATIONAL_RECOVERY_OBSERVATION_PATTERNS.some((pattern) => pattern.test(text));
}

function isOperationalNegativeObservation(observation: TrainingPeaksTelegramContextObservation): boolean {
  const text = getObservationSemanticText(observation);
  return OPERATIONAL_NEGATIVE_OBSERVATION_PATTERNS.some((pattern) => pattern.test(text)) || hasMusculoskeletalPainSemantic(text);
}

function isOperationalAgreementObservation(observation: TrainingPeaksTelegramContextObservation): boolean {
  const text = getObservationSemanticText(observation);
  return OPERATIONAL_PLAN_AGREEMENT_PATTERNS.some((pattern) => pattern.test(text));
}

function isOperationalRelevantObservation(input: {
  observation: TrainingPeaksTelegramContextObservation;
  signal: TrainingPeaksStudentOperationalSignal;
}): boolean {
  const text = getObservationSemanticText(input.observation);
  const effective = resolveEffectiveOperationalSignalForDisplay(input.signal);
  if (isPainInjuryOperationalSignalForDisplay(effective)) {
    return hasMusculoskeletalPainSemantic(text) || isOperationalPositiveObservation(input.observation) || isOperationalAgreementObservation(input.observation);
  }
  if (isHealthOperationalSignalType(effective.effectiveSignalType)) {
    return (
      hasClearIllnessSemantic(text) ||
      isOperationalNegativeObservation(input.observation) ||
      isOperationalPositiveObservation(input.observation) ||
      isOperationalAgreementObservation(input.observation)
    );
  }
  return isOperationalAgreementObservation(input.observation);
}

function findLatestOperationalSignalObservation(input: {
  signal: TrainingPeaksStudentOperationalSignal;
  observations: readonly TrainingPeaksTelegramContextObservation[];
  predicate: (observation: TrainingPeaksTelegramContextObservation) => boolean;
  afterIso?: string | null;
}): TrainingPeaksOperationalSignalSourceEvidence | null {
  const openedAt = input.afterIso ?? input.signal.createdAt;
  const latest = sortOperationalSignalObservations(input.observations)
    .filter((observation) => observation.observedAt >= openedAt)
    .filter(input.predicate)
    .at(-1);
  return toOperationalSignalSourceEvidence(latest);
}

function findOperationalSignalSourceObservation(input: {
  signal: TrainingPeaksStudentOperationalSignal;
  observations: readonly TrainingPeaksTelegramContextObservation[];
}): TrainingPeaksOperationalSignalSourceEvidence | null {
  const sourceObservationId = input.signal.sourceObservationId;
  const exact = sourceObservationId
    ? input.observations.find((observation) => observation.id === sourceObservationId)
    : null;
  const fallback =
    exact ??
    sortOperationalSignalObservations(input.observations).find((observation) => observation.observedAt >= input.signal.createdAt) ??
    null;
  return toOperationalSignalSourceEvidence(fallback);
}

function findOperationalSignalRecoveryMessage(
  observations: readonly TrainingPeaksTelegramContextObservation[],
  openedAt: string
): OperationalSignalLifecycleInput["explicitRecoveryMessage"] {
  const recovery = sortOperationalSignalObservations(observations)
    .filter((observation) => observation.observedAt >= openedAt)
    .find(isOperationalPositiveObservation);
  if (!recovery) {
    return null;
  }
  return {
    observationId: recovery.id,
    observedAt: recovery.observedAt,
    reason: "matched_recovery_context",
  };
}

export function findOperationalSignalNegativeAfterOpen(
  observations: readonly TrainingPeaksTelegramContextObservation[],
  openedAt: string
): OperationalSignalLifecycleInput["negativeMessageAfterCompletion"] {
  const openedAtMs = Date.parse(openedAt);
  const negative = sortOperationalSignalObservations(observations).find((observation) => {
    const observedAt = Date.parse(observation.observedAt);
    return Number.isFinite(observedAt) && observedAt >= openedAtMs && isOperationalNegativeObservation(observation);
  });
  if (!negative) {
    return null;
  }
  return {
    observationId: negative.id,
    observedAt: negative.observedAt,
    reason: "matched_negative_after_open",
  };
}

export function findOperationalSignalNegativeAfterCompletion(input: {
  observations: readonly TrainingPeaksTelegramContextObservation[];
  completionDate: string | null;
  completionObservedAt: string | null | undefined;
  openedAt: string;
}): OperationalSignalLifecycleInput["negativeMessageAfterCompletion"] {
  if (!input.completionDate) {
    return findOperationalSignalNegativeAfterOpen(input.observations, input.openedAt);
  }
  const completionStart = Number.isFinite(Date.parse(input.completionObservedAt ?? ""))
    ? Date.parse(input.completionObservedAt as string)
    : Date.parse(`${input.completionDate}T00:00:00.000Z`);
  const openedAtMs = Date.parse(input.openedAt);
  const thresholdMs = Number.isFinite(openedAtMs) ? Math.max(openedAtMs, completionStart) : completionStart;
  const negative = sortOperationalSignalObservations(input.observations).find((observation) => {
    const observedAt = Date.parse(observation.observedAt);
    return Number.isFinite(observedAt) && observedAt >= thresholdMs && isOperationalNegativeObservation(observation);
  });
  if (!negative) {
    return findOperationalSignalNegativeAfterOpen(input.observations, input.openedAt);
  }
  return {
    observationId: negative.id,
    observedAt: negative.observedAt,
    reason: "matched_negative_context",
  };
}

function buildOperationalSignalLifecycleInputFromCache(input: {
  signal: TrainingPeaksStudentOperationalSignal;
  workouts: TrainingPeaksWorkoutCacheRow[];
  asOfDate: string;
  observations?: readonly TrainingPeaksTelegramContextObservation[];
}): OperationalSignalLifecycleInput {
  const openedAt = input.signal.createdAt;
  const openedDate = openedAt.slice(0, 10);
  const completion = buildOperationalSignalCompletionInfo({
    workouts: input.workouts,
    openedDate,
    asOfDate: input.asOfDate,
  });
  return {
    studentId: input.signal.studentId,
    signalClass: classifyOperationalSignalForLifecycle(input.signal),
    currentLifecycle: getOperationalSignalLifecycle(input.signal),
    openedAt,
    latestTpCompletionAfterOpen: completion,
    negativeMessageAfterCompletion: findOperationalSignalNegativeAfterCompletion({
      observations: input.observations ?? [],
      completionDate: completion?.workoutDate ?? null,
      completionObservedAt: completion?.completionObservedAt,
      openedAt,
    }),
    explicitRecoveryMessage: findOperationalSignalRecoveryMessage(input.observations ?? [], openedAt),
    missedOrSkippedReturnWorkout: false,
    returnWorkoutBlocker: null,
  };
}

function formatOperationalSignalShortDate(iso: string | null | undefined): string | null {
  if (!iso) {
    return null;
  }
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/u);
  if (!match) {
    return null;
  }
  return `${match[3]}.${match[2]}`;
}

function formatOperationalSignalSummaryLine(summary: string): string {
  const compact = summary.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_match, _year, month, day) => `${day}.${month}`);
  const pauseMatch = compact.match(/^пауза\s*\(([^)]+)\)$/iu);
  if (pauseMatch?.[1]) {
    return `пауза: ${pauseMatch[1].replace(/\s*—\s*/g, "—").trim()}`;
  }
  return compact;
}

function formatOperationalSignalCompletionEvidence(
  completion: TrainingPeaksOperationalSignalCompletionEvidence | null | undefined,
  signal: TrainingPeaksStudentOperationalSignal
): string[] {
  if (!completion) {
    return ["подтверждение: данных из кэша пока нет", "что сделать: проверить вручную"];
  }
  if (completion.evidenceError) {
    return ["подтверждение: не удалось прочитать кэш TrainingPeaks", "что сделать: проверить вручную"];
  }
  const latest = completion.latestCompletionAfterOpen;
  const lines: string[] = [];
  if (latest?.sportClass === "running_like") {
    lines.push(
      `подтверждение: после сигнала есть завершённая беговая тренировка (${formatOperationalSignalShortDate(latest.workoutDate) ?? latest.workoutDate})`
    );
  } else if (latest) {
    lines.push("подтверждение: после сигнала есть завершённая тренировка");
  } else if (completion.latestCacheScannedAt) {
    lines.push(
      `подтверждение: после ${formatOperationalSignalShortDate(signal.createdAt) ?? signal.createdAt.slice(0, 10)} в кэше нет завершённых беговых тренировок`
    );
  } else {
    lines.push("подтверждение: в кэше пока нет данных по периоду");
  }
  if (latest?.evidenceFreshness === "stale" || latest?.evidenceFreshness === "missing") {
    lines.push(`кэш: ${latest.evidenceFreshness === "stale" ? "устаревший" : "неполный"}, лучше перепроверить`);
  } else if (!latest && completion.latestCacheScannedAt) {
    lines.push(`кэш: последнее обновление ${completion.latestCacheScannedAt.slice(0, 16).replace("T", " ")}`);
  }
  return lines;
}

type OperationalPainSeverity =
  | "acute_limiting"
  | "needs_clarification"
  | "minor_discomfort"
  | "ready_to_close_after_check";

const PAIN_ACUTE_CUES = [
  /острая?\s+боль/iu,
  /сильн[а-яё]*\s+боль/iu,
  /резк[а-яё]*\s+боль/iu,
  /не\s+могу\s+(бежать|бегать|наступать)/iu,
  /мешает\s+бежать/iu,
  /защем[а-яё]*\s+нерв|нерв\s+.*защем/iu,
  /от[её]к|опух/iu,
];

const PAIN_MINOR_DISCOMFORT_CUES = [
  /немного/iu,
  /л[её]гк[а-яё]*/iu,
  /дискомфорт/iu,
  /побал[а-яё]*/iu,
  /рабоч[а-яё]*\s+мышечн[а-яё]*/iu,
  /мышечн[а-яё]*\s+боль/iu,
  /наблюда[а-яё]*/iu,
  /стабилизатор[а-яё]*/iu,
];

function normalizeCoachFacingSignalText(raw: string): string {
  return raw
    .replace(/\s+/gu, " ")
    .replace(/после паузы:\s*после болезни:/giu, "после болезни:")
    .replace(/\s+/gu, " ")
    .trim();
}

function resolvePainSeverity(input: {
  lifecycleDisplayState: OperationalSignalDisplayLifecycleState;
  summary: string;
  sourceText: string | null;
}): OperationalPainSeverity {
  if (input.lifecycleDisplayState === "ready_for_coach_close") {
    return "ready_to_close_after_check";
  }
  const joined = `${input.summary} ${input.sourceText ?? ""}`.toLowerCase();
  const hasNegatedAcuteCue =
    joined.includes("не похоже на острую травму") ||
    joined.includes("не острая травма") ||
    joined.includes("не острая боль");
  if (PAIN_MINOR_DISCOMFORT_CUES.some((cue) => cue.test(joined))) {
    return "minor_discomfort";
  }
  if (!hasNegatedAcuteCue && painLimitsRunningSemantic(joined)) {
    return "acute_limiting";
  }
  if (!hasNegatedAcuteCue && PAIN_ACUTE_CUES.some((cue) => cue.test(joined))) {
    return "acute_limiting";
  }
  return "needs_clarification";
}

export function buildMonitoringLifetimeDisplayLines(input: {
  lifecycleDisplayState: OperationalSignalDisplayLifecycleState;
  completion: TrainingPeaksOperationalSignalCompletionEvidence | null | undefined;
  sourceText: string | null;
  latestPositiveText?: string | null;
  latestNegativeText?: string | null;
  isPain: boolean;
}): string[] {
  const latest = input.completion?.latestCompletionAfterOpen ?? null;
  const hasRunningCompletion = latest?.sportClass === "running_like";
  const recoveryReady = hasRecoveryReadySemantic(
    normalizeOperationalSignalSemanticText([input.sourceText, input.latestPositiveText])
  );
  const contextText = normalizeOperationalSignalSemanticText([
    input.sourceText,
    input.latestPositiveText,
    input.latestNegativeText,
  ]);
  const hasCleanReportAfterRun = Boolean(hasRunningCompletion && input.latestPositiveText && !input.latestNegativeText);

  if (input.lifecycleDisplayState === "ready_for_coach_close") {
    if (
      !input.isPain &&
      hasRunningCompletion &&
      !input.latestNegativeText &&
      latest &&
      hasReliableRunningCompletionAfterOpen(latest)
    ) {
      return [
        "почему видно: после болезни пробежка была, новых жалоб не видно — можно закрыть после проверки",
        "что закрывает: ручное безопасное закрытие после короткой проверки",
        "что сделать: закрыть после короткой проверки самочувствия.",
      ];
    }
    return [
      "почему видно: есть признаки, что эпизод можно закрыть, но нужна короткая проверка",
      "что закрывает: подтверждение самочувствия / ручное безопасное закрытие",
      input.isPain
        ? "что сделать: уточнить, болит ли сейчас. Если уже не актуально — закрыть сигнал через безопасное закрытие."
        : "что сделать: уточнить текущее самочувствие. Если всё стабильно — закрыть сигнал через безопасное закрытие.",
    ];
  }

  if (input.lifecycleDisplayState === "monitoring_after_return") {
    if (input.isPain) {
      return [
        "статус: можно закрыть после проверки",
        hasRunningCompletion
          ? "почему видно: после возврата есть пробежка, ждём подтверждения что боль не вернулась"
          : "почему видно: ждём подтверждения, что возврат прошёл нормально",
        "что закрывает: нет новых жалоб / ручное безопасное закрытие",
        "что сделать: уточнить, болит ли сейчас. Если уже не актуально — закрыть сигнал через безопасное закрытие.",
      ];
    }
    if (hasCleanReportAfterRun) {
      return [
        "почему видно: есть пробежка и чистый отчёт после неё, сигнал оставлен для короткой проверки",
        "что закрывает: ручное безопасное закрытие после проверки, что новых жалоб нет",
        "что сделать: закрыть после короткой проверки самочувствия.",
      ];
    }
    if (recoveryReady && !hasRunningCompletion) {
      return [
        "почему видно: ученик сообщил о готовности к бегу, но подтверждённой пробежки после этого ещё нет",
        "что закрывает: чистая пробежка + нет новых жалоб / ручное безопасное закрытие",
        "что сделать: если пробежка прошла нормально — перевести в наблюдение или закрыть после проверки",
      ];
    }
    if (hasRunningCompletion) {
      if (
        !input.latestNegativeText &&
        latest &&
        hasReliableRunningCompletionAfterOpen(latest) &&
        !input.isPain
      ) {
        return [
          "почему видно: после болезни пробежка была, новых жалоб не видно — можно закрыть после проверки",
          "что закрывает: ручное безопасное закрытие после короткой проверки",
          "что сделать: закрыть после короткой проверки самочувствия.",
        ];
      }
      return [
        input.latestNegativeText
          ? "почему видно: после пробежки есть новое негативное сообщение, закрывать нельзя"
          : "почему видно: после возврата есть пробежка, ждём чистый отчёт после неё",
        "что закрывает: отчёт «всё ок» после пробежки и отсутствие новых жалоб",
        input.latestNegativeText
          ? "что сделать: уточнить текущее самочувствие и держать на контроле до стабильного состояния."
          : "что сделать: проверить самочувствие после пробежки.",
      ];
    }
    return [
      "почему видно: ждём подтверждения, что возврат прошёл нормально",
      "что закрывает: чистая пробежка + нет новых жалоб / ручное безопасное закрытие",
      "что сделать: уточнить самочувствие после возврата к тренировкам",
    ];
  }

  if (recoveryReady && !hasRunningCompletion) {
    return [
      "почему видно: ученик сообщил о готовности к бегу, но подтверждённой пробежки после этого ещё нет",
      "что закрывает: чистая пробежка + нет новых жалоб / ручное безопасное закрытие",
      "что сделать: если пробежка прошла нормально — перевести в наблюдение или закрыть после проверки",
    ];
  }

  if (hasRunningCompletion) {
    if (
      !input.latestNegativeText &&
      latest &&
      hasReliableRunningCompletionAfterOpen(latest) &&
      !input.isPain &&
      input.lifecycleDisplayState !== "active_problem"
    ) {
      return [
        "почему видно: после болезни пробежка была, новых жалоб не видно — можно закрыть после проверки",
        "что закрывает: ручное безопасное закрытие после короткой проверки",
        "что сделать: закрыть после короткой проверки самочувствия.",
      ];
    }
    return [
      input.latestNegativeText
        ? "почему видно: после пробежки есть новое негативное сообщение, закрывать нельзя"
        : "почему видно: после возврата есть пробежка, ждём чистый отчёт после неё",
      "что закрывает: отчёт «всё ок» после пробежки и отсутствие новых жалоб",
      input.latestNegativeText
        ? "что сделать: уточнить текущее самочувствие и держать на контроле до стабильного состояния."
        : "что сделать: проверить самочувствие после пробежки.",
    ];
  }

  if (input.completion?.recommendedAction === "coach_close_candidate") {
    return [
      "почему видно: есть признаки, что эпизод можно закрыть, но нужна короткая проверка",
      "что закрывает: подтверждение самочувствия / ручное безопасное закрытие",
      "что сделать: уточнить текущее самочувствие. Если всё стабильно — закрыть сигнал через безопасное закрытие.",
    ];
  }

  if (!hasRunningCompletion && input.completion?.latestCacheScannedAt) {
    return [
      "почему видно: нет подтверждённой пробежки после сообщения",
      "что закрывает: чистая пробежка + нет новых жалоб / ручное безопасное закрытие",
      /ближе\s+к\s+выходн|к\s+выходн/iu.test(contextText)
        ? "что сделать: уточнить самочувствие ближе к выходным / перед возвратом к бегу."
        : "что сделать: уточнить текущее самочувствие и обновить сигнал.",
    ];
  }

  return [
    "почему видно: нет закрывающего сообщения или чистой пробежки после сигнала",
    "что закрывает: чистый отчёт после пробежки и отсутствие новых жалоб",
    /ближе\s+к\s+выходн|к\s+выходн/iu.test(contextText)
      ? "что сделать: уточнить самочувствие ближе к выходным / перед возвратом к бегу."
      : "что сделать: уточнить текущее самочувствие и обновить сигнал.",
  ];
}

function normalizeCoachActionLineForDedup(line: string): string {
  return line
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .replace(/[.;]+$/u, "")
    .trim();
}

function shouldSkipDuplicateCoachAction(action: string, existingText: string): boolean {
  const normalizedAction = normalizeCoachActionLineForDedup(action);
  if (!normalizedAction) {
    return true;
  }
  const normalizedExisting = normalizeCoachActionLineForDedup(existingText);
  if (normalizedExisting.includes(normalizedAction)) {
    return true;
  }
  if (/уточнить/iu.test(normalizedAction) && /уточнить/iu.test(normalizedExisting)) {
    if (/мешает/iu.test(normalizedAction) && /мешает/iu.test(normalizedExisting)) {
      return true;
    }
    if (/болит\s+ли\s+сейчас/iu.test(normalizedAction) && /болит\s+ли\s+сейчас/iu.test(normalizedExisting)) {
      return true;
    }
  }
  return false;
}

function joinCompactCoachSituationAndAction(situation: string, action: string): string {
  const left = situation.replace(/[.;,\s]+$/u, "").trim();
  const right = action.replace(/^[.;,\s]+/u, "").trim();
  if (!left) {
    return right;
  }
  if (!right || shouldSkipDuplicateCoachAction(right, left)) {
    return left;
  }
  return `${left} — ${right}`;
}

function extractCompactPainSituation(summaryLine: string, displaySourceText: string | null): string {
  const joined = `${summaryLine} ${displaySourceText ?? ""}`.toLowerCase();
  if (/мозол|обув|пал[её]ц/iu.test(joined)) {
    return "мозоль/палец от обуви";
  }
  if (/защем|спин/iu.test(joined) && painLimitsRunningSemantic(joined)) {
    return "защемило спину, не бегает";
  }
  if (/колен/iu.test(joined)) {
    if (/почти\s+норм|лучше|проходит/iu.test(joined)) {
      return "колено почти нормально";
    }
    return summaryLine.replace(/^после\s+паузы:\s*/iu, "").replace(/^после\s+болезни:\s*/iu, "");
  }
  if (/стоп|стабилизатор/iu.test(joined) && /дискомфорт|побал|немного/iu.test(joined)) {
    return "лёгкий дискомфорт стопы";
  }
  return summaryLine.replace(/^после\s+паузы:\s*/iu, "").replace(/^после\s+болезни:\s*/iu, "");
}

function extractCompactNegativeEvidenceSnippet(text: string): string {
  const lower = text.toLowerCase();
  if (/температур/iu.test(lower)) {
    return "снова была температура";
  }
  if (/кашл/iu.test(lower)) {
    return "снова усилился кашель";
  }
  if (hasOperationalPainVerbSemantic(lower) || hasStandalonePainWordSemantic(lower)) {
    return "снова появилась боль";
  }
  return compactOperationalSignalText(text, 60).replace(/^./u, (char) => char.toLowerCase());
}

function stripTrailingMonitoringObserve(summaryLine: string): string {
  return summaryLine.replace(/;\s*наблюдать\s*$/iu, "").trim();
}

function stripCoachClosePrefix(summaryLine: string): string {
  return summaryLine.replace(/^можно\s+закрыть\s+после\s+проверки:\s*/iu, "").trim();
}

function normalizeEmbeddedCoachActionSummary(summaryLine: string): string | null {
  const match = summaryLine.match(/^(.+?)\s*\(([^)]+)\)\s*$/u);
  if (!match) {
    return null;
  }
  const action = match[2]?.trim() ?? "";
  if (!/^уточнить|^наблюдать|^проверить|^закрыть|^после\b/iu.test(action)) {
    return null;
  }
  const situation = match[1]?.trim() ?? "";
  if (!situation) {
    return null;
  }
  return joinCompactCoachSituationAndAction(situation, action.replace(/\.$/u, ""));
}

function shouldApplyFreshIllnessRecoveryMonitoringOverlay(input: {
  isPain: boolean;
  lifecycleDisplayState: OperationalSignalDisplayLifecycleState;
  completion: OperationalSignalLifecycleInput["latestTpCompletionAfterOpen"];
  hasNegativeAfterCompletion: boolean;
}): boolean {
  return (
    !input.isPain &&
    input.lifecycleDisplayState === "monitoring_after_return" &&
    !input.hasNegativeAfterCompletion &&
    hasReliableRunningCompletionAfterOpen(input.completion)
  );
}

function buildFreshIllnessRecoveryMonitoringDisplayText(input: {
  completion: NonNullable<OperationalSignalLifecycleInput["latestTpCompletionAfterOpen"]>;
}): string {
  const runDate = formatOperationalSignalShortDate(input.completion.workoutDate);
  const title = input.completion.title?.trim();
  const titlePart = title && title.length > 0 && title.length <= 40 ? ` («${title}»)` : "";
  const datePart = runDate ? ` ${runDate}` : "";
  return `после болезни: первая пробежка выполнена${datePart}${titlePart}, новых жалоб после неё нет — уточнить самочувствие / можно закрыть после проверки.`;
}

export type OperationalSignalDisplayDebugInfo = {
  displayBranchUsed: string;
  latestNegativeObservationId: string | null;
  latestNegativeObservedAt: string | null;
  latestNegativeSourceType: string | null;
  latestNegativeTextPreview: string | null;
  negativeAfterCompletion: boolean;
  completionWorkoutId: string | null;
  completionDate: string | null;
  completionStartedAt: string | null;
  completionCompletedAt: string | null;
};

function finishCompactCoachDisplay(text: string, branch: string): { text: string; branch: string } {
  return { text, branch };
}

function buildCompactCoachFacingOperationalSignalText(input: {
  signal: TrainingPeaksStudentOperationalSignal;
  effective: EffectiveOperationalSignalForDisplay;
  summary: string;
  lifecycleDisplayState: OperationalSignalDisplayLifecycleState;
  evidence: TrainingPeaksOperationalSignalDisplayEvidence | null;
  asOfDate: string;
}): { text: string; branch: string } {
  const isPain = isPainInjuryOperationalSignalForDisplay(input.effective);
  let summaryLine =
    normalizeCoachFacingSignalText(
      formatOperationalSignalSummaryLine(stripTrailingMonitoringObserve(stripCoachClosePrefix(input.summary.trim())))
    ) || "контекст: полный текст недоступен в signal payload";

  const sourceText = input.evidence?.source?.textPreview?.replace(/\s+/g, " ").trim() ?? null;
  const latestRelevantText = input.evidence?.latestRelevant?.textPreview?.replace(/\s+/g, " ").trim() ?? null;
  const latestPositiveText = input.evidence?.latestPositive?.textPreview?.replace(/\s+/g, " ").trim() ?? null;
  const latestNegativeText =
    resolveOperationalSignalLatestNegativeText(input.signal, input.evidence) ??
    input.evidence?.latestNegative?.textPreview?.replace(/\s+/g, " ").trim() ??
    null;
  const negativeAfterCompletionText = resolveNegativeAfterCompletionDisplayText(input.evidence);
  const completionForEvidence = input.evidence?.completion?.latestCompletionAfterOpen ?? null;
  const hasNegativeAfterCompletion = hasOperationalDisplayNegativeEvidence({
    signal: input.signal,
    evidence: input.evidence,
    completion: completionForEvidence,
  });
  const latestPainText =
    latestRelevantText && hasMusculoskeletalPainSemantic(latestRelevantText.toLowerCase()) ? latestRelevantText : null;
  const sourcePainText = sourceText && hasMusculoskeletalPainSemantic(sourceText.toLowerCase()) ? sourceText : null;
  const displaySourceText = latestPainText && !sourcePainText ? latestPainText : sourceText;

  if (isPain && latestPainText && !sourcePainText) {
    summaryLine = compactOperationalSignalText(latestPainText, 140);
  } else if (isPain && sourcePainText && !hasMusculoskeletalPainSemantic(summaryLine.toLowerCase())) {
    summaryLine = compactOperationalSignalText(sourcePainText, 140);
  }

  if (
    input.effective.effectiveSignalType === "pause_training" ||
    input.effective.effectiveSignalType === "resume_training" ||
    /^пауза:/iu.test(summaryLine)
  ) {
    return finishCompactCoachDisplay(summaryLine, "pause_or_resume");
  }

  const embeddedCoachSummary = normalizeEmbeddedCoachActionSummary(summaryLine);
  if (embeddedCoachSummary) {
    return finishCompactCoachDisplay(embeddedCoachSummary, "embedded_coach_action");
  }

  const completion = input.evidence?.completion ?? null;
  const latest = completion?.latestCompletionAfterOpen ?? null;
  const hasRunningCompletion = latest?.sportClass === "running_like";
  const runDate = formatOperationalSignalShortDate(latest?.workoutDate);

  if (
    shouldApplyFreshIllnessRecoveryMonitoringOverlay({
      isPain,
      lifecycleDisplayState: input.lifecycleDisplayState,
      completion: latest,
      hasNegativeAfterCompletion,
    }) &&
    latest
  ) {
    return finishCompactCoachDisplay(
      buildFreshIllnessRecoveryMonitoringDisplayText({ completion: latest }),
      "fresh_illness_recovery_monitoring_overlay"
    );
  }

  if (
    !isPain &&
    summaryAlreadyHasRecoveryPrefix(summaryLine) &&
    input.lifecycleDisplayState !== "ready_for_coach_close" &&
    input.lifecycleDisplayState !== "stale_needs_review" &&
    !hasNegativeAfterCompletion &&
    !(
      input.lifecycleDisplayState === "monitoring_after_return" &&
      hasReliableRunningCompletionAfterOpen(latest)
    )
  ) {
    const cleanedRecoverySummary = stripTrailingMonitoringObserve(summaryLine);
    if (
      hasRecoveryReadySemantic(cleanedRecoverySummary) ||
      /в строю|завтра проб/iu.test(cleanedRecoverySummary)
    ) {
      if (/;\s*наблюдать\s*$/iu.test(summaryLine)) {
        return finishCompactCoachDisplay(
          joinCompactCoachSituationAndAction(cleanedRecoverySummary, "наблюдать"),
          "recovery_prefix_with_observe"
        );
      }
      return finishCompactCoachDisplay(cleanedRecoverySummary, "recovery_prefix_clean");
    }
  }
  const contextText = normalizeOperationalSignalSemanticText([
    displaySourceText,
    latestPositiveText,
    negativeAfterCompletionText ?? latestNegativeText,
    summaryLine,
  ]);
  const recoveryReady = hasRecoveryReadySemantic(contextText);
  const hasCleanReportAfterRun = Boolean(
    hasRunningCompletion && latestPositiveText && !hasNegativeAfterCompletion
  );
  const joinedContext = `${summaryLine} ${displaySourceText ?? ""}`.toLowerCase();

  if (input.lifecycleDisplayState === "stale_needs_review") {
    return finishCompactCoachDisplay(
      "давно нет новых данных — проверить вручную.",
      "stale_needs_review"
    );
  }

  if (isPain) {
    const situation = extractCompactPainSituation(summaryLine, displaySourceText);
    if (
      input.lifecycleDisplayState === "monitoring_after_return" ||
      input.lifecycleDisplayState === "ready_for_coach_close"
    ) {
      if (/колен/iu.test(joinedContext)) {
        const base = runDate
          ? joinCompactCoachSituationAndAction("колено почти нормально", `пробежка ${runDate} была`)
          : "колено почти нормально";
        return finishCompactCoachDisplay(
          joinCompactCoachSituationAndAction(base, "после пробежки проверить реакцию"),
          "pain_monitoring_knee_after_run"
        );
      }
      if (input.lifecycleDisplayState === "ready_for_coach_close") {
        const positiveSnippet = latestPositiveText ? compactOperationalSignalText(latestPositiveText, 40) : null;
        const action = positiveSnippet
          ? `свежий ответ: ${positiveSnippet} — закрыть после проверки`
          : "закрыть после короткой проверки";
        return finishCompactCoachDisplay(
          joinCompactCoachSituationAndAction(situation, action),
          "pain_ready_for_coach_close"
        );
      }
      return finishCompactCoachDisplay(
        joinCompactCoachSituationAndAction(
          stripTrailingMonitoringObserve(situation),
          "уточнить, болит ли сейчас — закрыть, если уже не актуально"
        ),
        "pain_monitoring_check"
      );
    }

    const severity = resolvePainSeverity({
      lifecycleDisplayState: input.lifecycleDisplayState,
      summary: summaryLine,
      sourceText: displaySourceText,
    });

    if (severity === "acute_limiting") {
      if (/спин|нерв|защем/iu.test(joinedContext)) {
        return finishCompactCoachDisplay(
          joinCompactCoachSituationAndAction(situation, "уточнить состояние и срок возврата"),
          "pain_acute_limiting_spine"
        );
      }
      return finishCompactCoachDisplay(
        joinCompactCoachSituationAndAction(situation, "уточнить, мешает ли боль бегу"),
        "pain_acute_limiting"
      );
    }
    if (severity === "minor_discomfort") {
      if (/стоп|стабилизатор/iu.test(joinedContext)) {
        return finishCompactCoachDisplay(
          "лёгкий дискомфорт стопы — наблюдать, уточнить если усилится.",
          "pain_minor_discomfort_foot"
        );
      }
      if (/колен/iu.test(joinedContext)) {
        return finishCompactCoachDisplay(
          joinCompactCoachSituationAndAction(
            "колено почти нормально",
            "наблюдать, после пробежки проверить реакцию"
          ),
          "pain_minor_discomfort_knee"
        );
      }
      if (/мозол|обув|пал[её]ц/iu.test(joinedContext)) {
        return finishCompactCoachDisplay(
          "мозоль/палец от обуви — уточнить, мешает ли бегу.",
          "pain_minor_discomfort_blister"
        );
      }
      return finishCompactCoachDisplay(
        joinCompactCoachSituationAndAction(situation, "наблюдать, уточнить если усилится"),
        "pain_minor_discomfort"
      );
    }
    return finishCompactCoachDisplay(
      joinCompactCoachSituationAndAction(situation, "уточнить, болит ли сейчас и мешает ли тренировкам"),
      "pain_needs_clarification"
    );
  }

  let situation = summaryLine;
  if (
    !summaryAlreadyHasRecoveryPrefix(situation) &&
    (hasRunningCompletion || input.lifecycleDisplayState !== "active_problem")
  ) {
    if (/простуд|орви|насморк|кашл/iu.test(contextText) && !hasRunningCompletion) {
      situation = "простуда";
    } else if (input.lifecycleDisplayState !== "active_problem") {
      situation = situation.startsWith("после")
        ? situation
        : `после болезни: ${situation.replace(/^после\s+паузы:\s*/iu, "")}`;
    }
  }

  if (hasNegativeAfterCompletion && hasRunningCompletion) {
    const negText = negativeAfterCompletionText ?? latestNegativeText;
    if (negText) {
      const negSnippet = extractCompactNegativeEvidenceSnippet(negText);
      return finishCompactCoachDisplay(
        `после пробежки ${negSnippet} — держать на контроле, уточнить самочувствие сегодня.`,
        "post_run_negative_after_completion"
      );
    }
  }

  if (input.lifecycleDisplayState === "ready_for_coach_close" || hasCleanReportAfterRun) {
    if (hasRunningCompletion || hasCleanReportAfterRun) {
      return finishCompactCoachDisplay(
        "после болезни: пробежка была, новых жалоб нет — закрыть после проверки.",
        "ready_for_coach_close_after_run"
      );
    }
    const readySummary = summaryLine.replace(/^после\s+паузы:\s*/iu, "после болезни: ");
    return finishCompactCoachDisplay(
      joinCompactCoachSituationAndAction(readySummary, "закрыть после проверки"),
      "ready_for_coach_close"
    );
  }

  if (hasRunningCompletion) {
    if (
      input.lifecycleDisplayState === "monitoring_after_return" &&
      latest &&
      hasReliableRunningCompletionAfterOpen(latest) &&
      !hasNegativeAfterCompletion
    ) {
      return finishCompactCoachDisplay(
        buildFreshIllnessRecoveryMonitoringDisplayText({ completion: latest }),
        "monitoring_after_return_fresh_recovery_overlay"
      );
    }
    const runPart = runDate ? `пробежка ${runDate} была` : "пробежка была";
    if (input.lifecycleDisplayState === "monitoring_after_return") {
      return finishCompactCoachDisplay(
        `после болезни: ${runPart} — проверить отчёт/самочувствие и закрыть, если всё ок.`,
        "monitoring_after_return_with_run"
      );
    }
    return finishCompactCoachDisplay(
      `после болезни: ${runPart} — проверить самочувствие после пробежки.`,
      "running_completion_check"
    );
  }

  if (recoveryReady && !hasRunningCompletion) {
    return finishCompactCoachDisplay(
      joinCompactCoachSituationAndAction(
        situation.replace(/^после\s+паузы:\s*/iu, "после болезни: "),
        "уточнить перед первой пробежкой"
      ),
      "recovery_ready_before_first_run"
    );
  }

  if (/ближе\s+к\s+выходн|к\s+выходн/iu.test(contextText)) {
    return finishCompactCoachDisplay(
      "после болезни лучше, к бегу ближе к выходным — уточнить перед первой пробежкой.",
      "recovery_weekend_timing"
    );
  }

  if (!isPain && input.lifecycleDisplayState === "active_problem") {
    for (const text of [latestRelevantText, latestNegativeText]) {
      if (!text) {
        continue;
      }
      const continuedIllnessSummary = buildContinuedIllnessCoachDisplaySummary(text);
      if (continuedIllnessSummary) {
        return finishCompactCoachDisplay(continuedIllnessSummary, "continued_illness_active_problem");
      }
    }
  }

  if (/простуд|орви|насморк/iu.test(contextText) && input.lifecycleDisplayState === "active_problem") {
    return finishCompactCoachDisplay(
      "простуда — уточнить самочувствие перед возвратом к бегу.",
      "active_problem_cold"
    );
  }

  if (input.lifecycleDisplayState === "monitoring_after_return") {
    const monitoringSummary = summaryLine.replace(/^после\s+паузы:\s*/iu, "после болезни: ");
    return finishCompactCoachDisplay(
      joinCompactCoachSituationAndAction(monitoringSummary, "наблюдать, уточнить самочувствие"),
      "monitoring_after_return"
    );
  }

  return finishCompactCoachDisplay(
    joinCompactCoachSituationAndAction(situation, "уточнить текущее самочувствие"),
    "default_clarify_wellbeing"
  );
}

export function compactCoachFacingOperationalSignalText(input: {
  signal: TrainingPeaksStudentOperationalSignal;
  effective: EffectiveOperationalSignalForDisplay;
  summary: string;
  lifecycleDisplayState: OperationalSignalDisplayLifecycleState;
  evidence: TrainingPeaksOperationalSignalDisplayEvidence | null;
  asOfDate: string;
}): string {
  return buildCompactCoachFacingOperationalSignalText(input).text;
}

export function resolveOperationalSignalDisplayDebugInfo(input: {
  signal: TrainingPeaksStudentOperationalSignal;
  effective: EffectiveOperationalSignalForDisplay;
  summary: string;
  lifecycleDisplayState: OperationalSignalDisplayLifecycleState;
  evidence: TrainingPeaksOperationalSignalDisplayEvidence | null;
  asOfDate: string;
}): OperationalSignalDisplayDebugInfo {
  const built = buildCompactCoachFacingOperationalSignalText(input);
  const latestNegative = input.evidence?.latestNegative ?? null;
  const completion = input.evidence?.completion?.latestCompletionAfterOpen ?? null;
  return {
    displayBranchUsed: built.branch,
    latestNegativeObservationId: latestNegative?.observationId ?? null,
    latestNegativeObservedAt: latestNegative?.observedAt ?? null,
    latestNegativeSourceType: latestNegative?.sourceType ?? null,
    latestNegativeTextPreview: latestNegative?.textPreview?.replace(/\s+/g, " ").trim() ?? null,
    negativeAfterCompletion: Boolean(input.evidence?.completion?.negativeMessageAfterCompletion),
    completionWorkoutId: completion?.workoutId ?? null,
    completionDate: completion?.workoutDate ?? null,
    completionStartedAt: completion?.completionObservedAt ?? null,
    completionCompletedAt: completion?.completionObservedAt ?? null,
  };
}

function buildActionableHealthOrPainDisplayText(input: {
  signal: TrainingPeaksStudentOperationalSignal;
  effective: EffectiveOperationalSignalForDisplay;
  summary: string;
  lifecycleDisplayState: OperationalSignalDisplayLifecycleState;
  evidence: TrainingPeaksOperationalSignalDisplayEvidence | null;
  asOfDate: string;
}): string {
  return compactCoachFacingOperationalSignalText(input);
}

export function buildDetailedActionableHealthOrPainDisplayText(input: {
  signal: TrainingPeaksStudentOperationalSignal;
  effective: EffectiveOperationalSignalForDisplay;
  summary: string;
  lifecycleDisplayState: OperationalSignalDisplayLifecycleState;
  evidence: TrainingPeaksOperationalSignalDisplayEvidence | null;
  asOfDate: string;
}): string {
  const isPain = isPainInjuryOperationalSignalForDisplay(input.effective);
  let summaryLine =
    normalizeCoachFacingSignalText(formatOperationalSignalSummaryLine(input.summary.trim())) ||
    "контекст: полный текст недоступен в signal payload";
  const source = input.evidence?.source ?? null;
  const sourceText = source?.textPreview?.replace(/\s+/g, " ").trim() ?? null;
  const sourceDate =
    formatOperationalSignalShortDate(source?.observedAt) ??
    formatOperationalSignalShortDate(input.signal.createdAt);
  const latestRelevant = input.evidence?.latestRelevant ?? null;
  const latestRelevantText = latestRelevant?.textPreview?.replace(/\s+/g, " ").trim() ?? null;
  const latestRelevantDate = formatOperationalSignalShortDate(latestRelevant?.observedAt);
  const latestPositiveText = input.evidence?.latestPositive?.textPreview?.replace(/\s+/g, " ").trim() ?? null;
  const latestNegativeText = input.evidence?.latestNegative?.textPreview?.replace(/\s+/g, " ").trim() ?? null;
  const latestAgreement = input.evidence?.latestAgreement ?? null;
  const latestAgreementText = latestAgreement?.textPreview?.replace(/\s+/g, " ").trim() ?? null;
  const latestAgreementDate = formatOperationalSignalShortDate(latestAgreement?.observedAt);
  const latestPainText =
    latestRelevantText && hasMusculoskeletalPainSemantic(latestRelevantText.toLowerCase()) ? latestRelevantText : null;
  const sourcePainText = sourceText && hasMusculoskeletalPainSemantic(sourceText.toLowerCase()) ? sourceText : null;
  const displaySourceText = latestPainText && !sourcePainText ? latestPainText : sourceText;
  const displaySourceDate = latestPainText && !sourcePainText ? latestRelevantDate : sourceDate;
  if (isPain && latestPainText && !sourcePainText) {
    summaryLine = compactOperationalSignalText(latestPainText, 140);
  } else if (isPain && sourcePainText && !hasMusculoskeletalPainSemantic(summaryLine.toLowerCase())) {
    summaryLine = compactOperationalSignalText(sourcePainText, 140);
  }
  const lines = [summaryLine];
  if (displaySourceText) {
    lines.push(`источник: ${displaySourceDate ?? "дата неизвестна"}, ${displaySourceText}`);
  } else {
    lines.push("источник: не найден в payload/cache — нужен review");
  }
  if (latestRelevantText && latestRelevantText !== displaySourceText) {
    lines.push(`последнее: ${latestRelevantDate ?? "дата неизвестна"}, ${latestRelevantText}`);
  }
  if (latestNegativeText && latestNegativeText !== latestRelevantText && latestNegativeText !== displaySourceText) {
    const latestNegativeDate = formatOperationalSignalShortDate(input.evidence?.latestNegative?.observedAt);
    lines.push(`важно: ${latestNegativeDate ?? "дата неизвестна"}, ${latestNegativeText}`);
  }
  if (latestAgreementText && latestAgreementText !== latestRelevantText && latestAgreementText !== displaySourceText) {
    lines.push(`договорились: ${latestAgreementDate ?? "дата неизвестна"}, ${latestAgreementText}`);
  }

  if (isPain) {
    if (
      input.lifecycleDisplayState === "monitoring_after_return" ||
      input.lifecycleDisplayState === "ready_for_coach_close"
    ) {
      lines.push(...formatOperationalSignalCompletionEvidence(input.evidence?.completion, input.signal));
      lines.push(
        ...buildMonitoringLifetimeDisplayLines({
          lifecycleDisplayState: input.lifecycleDisplayState,
          completion: input.evidence?.completion ?? null,
          sourceText: displaySourceText,
          latestPositiveText,
          latestNegativeText,
          isPain: true,
        })
      );
      return lines.join("\n");
    }
    const severity = resolvePainSeverity({
      lifecycleDisplayState: input.lifecycleDisplayState,
      summary: summaryLine,
      sourceText: displaySourceText,
    });
    if (severity === "ready_to_close_after_check") {
      lines.push(
        ...buildMonitoringLifetimeDisplayLines({
          lifecycleDisplayState: input.lifecycleDisplayState,
          completion: input.evidence?.completion ?? null,
          sourceText: displaySourceText,
          latestPositiveText,
          latestNegativeText,
          isPain: true,
        })
      );
      return lines.join("\n");
    }
    if (severity === "acute_limiting") {
      lines.push("статус: боль / ограничивает бег");
      lines.push(
        /спин|нерв|защем/iu.test(`${summaryLine} ${displaySourceText ?? ""}`)
          ? "что сделать: уточнить состояние спины и когда сможет вернуться к бегу."
          : "что сделать: уточнить, мешает ли боль бегу сейчас; до проверки не усиливать нагрузку."
      );
      return lines.join("\n");
    }
    if (severity === "minor_discomfort") {
      lines.push("статус: лёгкий дискомфорт / наблюдать");
      lines.push(
        /колен/iu.test(`${summaryLine} ${displaySourceText ?? ""}`)
          ? "что сделать: после пробежки проверить реакцию колена."
          : "что сделать: наблюдать и уточнить на ближайшем контакте, усиливается ли симптом."
      );
      return lines.join("\n");
    }
    lines.push("статус: боль / нужно уточнить");
    lines.push("что сделать: уточнить, болит ли сейчас и мешает ли тренировкам.");
    return lines.join("\n");
  }

  lines.push(...formatOperationalSignalCompletionEvidence(input.evidence?.completion, input.signal));
  lines.push(
    ...buildMonitoringLifetimeDisplayLines({
      lifecycleDisplayState: input.lifecycleDisplayState,
      completion: input.evidence?.completion ?? null,
      sourceText: displaySourceText,
      latestPositiveText,
      latestNegativeText,
      isPain: false,
    })
  );
  return lines.join("\n");
}

export async function buildOperationalSignalDisplayEvidenceMap(input: {
  signals: TrainingPeaksStudentOperationalSignal[];
  asOfDate: string;
}): Promise<ReadonlyMap<string, TrainingPeaksOperationalSignalDisplayEvidence>> {
  const eligible = input.signals.filter((signal) => {
    if (signal.lifecycleState === "resolved") {
      return false;
    }
    const effective = resolveEffectiveOperationalSignalForDisplay(signal);
    return isHealthOperationalSignalType(effective.effectiveSignalType) || isPainInjuryOperationalSignalForDisplay(effective);
  });
  if (eligible.length === 0) {
    return new Map();
  }

  const byStudent = new Map<string, TrainingPeaksStudentOperationalSignal[]>();
  for (const signal of eligible) {
    const group = byStudent.get(signal.studentId) ?? [];
    group.push(signal);
    byStudent.set(signal.studentId, group);
  }

  const evidence = new Map<string, TrainingPeaksOperationalSignalDisplayEvidence>();
  await Promise.all(
    [...byStudent.entries()].map(async ([studentId, studentSignals]) => {
      const oldestOpened = studentSignals
        .map((signal) => signal.createdAt.slice(0, 10))
        .sort()[0] ?? input.asOfDate;
      try {
        const [workouts, observations] = await Promise.all([
          listTrainingPeaksWorkoutCacheForStudentDateRange({
            studentId,
            from: oldestOpened,
            to: input.asOfDate,
          }),
          listTrainingPeaksTelegramContextObservationsForStudent(studentId, 250),
        ]);
        const latestCacheScannedAt = workouts
          .map((workout) => workout.scannedAt)
          .filter(Boolean)
          .sort()
          .at(-1) ?? null;
        for (const signal of studentSignals) {
          const lifecycleInput = buildOperationalSignalLifecycleInputFromCache({
            signal,
            workouts,
            asOfDate: input.asOfDate,
            observations,
          });
          const proposal = evaluateOperationalSignalLifecycle(lifecycleInput);
          const cleanRunningCompletionCount = countCleanOperationalSignalRunningCompletions({
            workouts,
            openedDate: signal.createdAt.slice(0, 10),
            asOfDate: input.asOfDate,
          });
          const bridge = resolveBridgeRecommendedAction({
            signalId: signal.id,
            signalType: signal.signalType,
            signalClass: lifecycleInput.signalClass,
            currentLifecycle: lifecycleInput.currentLifecycle,
            lifecycleInput,
            proposal,
            asOfDate: input.asOfDate,
            cleanRunningCompletionCount,
          });
          const source = findOperationalSignalSourceObservation({ signal, observations });
          const negativeAfterCompletionObservation = lifecycleInput.negativeMessageAfterCompletion
            ? observations.find(
                (observation) => observation.id === lifecycleInput.negativeMessageAfterCompletion?.observationId
              ) ?? null
            : null;
          evidence.set(signal.id, {
            source,
            latestRelevant: findLatestOperationalSignalObservation({
              signal,
              observations,
              predicate: (observation) => isOperationalRelevantObservation({ signal, observation }),
              afterIso: shiftIsoDateTimeByHours(signal.createdAt, -48),
            }),
            latestNegative: findLatestOperationalSignalObservation({
              signal,
              observations,
              predicate: isOperationalNegativeObservation,
              afterIso: signal.createdAt,
            }),
            negativeAfterCompletion: toOperationalSignalSourceEvidence(negativeAfterCompletionObservation),
            latestPositive: findLatestOperationalSignalObservation({
              signal,
              observations,
              predicate: isOperationalPositiveObservation,
            }),
            latestAgreement: findLatestOperationalSignalObservation({
              signal,
              observations,
              predicate: isOperationalAgreementObservation,
            }),
            completion: {
              latestCacheScannedAt,
              latestCompletionAfterOpen: lifecycleInput.latestTpCompletionAfterOpen ?? null,
              negativeMessageAfterCompletion: lifecycleInput.negativeMessageAfterCompletion ?? null,
              recommendedAction: bridge.recommendedAction,
              recommendationReason: bridge.reason,
              applyDryRunCommand: bridge.applyDryRunCommand,
              cleanRunningCompletionCount,
            },
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        for (const signal of studentSignals) {
          evidence.set(signal.id, {
            source: null,
            completion: {
              latestCacheScannedAt: null,
              latestCompletionAfterOpen: null,
              recommendedAction: "manual_review",
              recommendationReason: "TP cache evidence read failed; use diagnostic refresh/check.",
              applyDryRunCommand: null,
              cleanRunningCompletionCount: 0,
              evidenceError: message,
            },
          });
        }
      }
    })
  );
  return evidence;
}

function isSignalSupersededForDisplay(signal: TrainingPeaksStudentOperationalSignal): boolean {
  const supersededBySignalId =
    getSignalMetadataString(signal.metadata, "superseded_by_signal_id") ??
    normalizeRecordString(signal.structuredPayload.superseded_by_signal_id) ??
    normalizeRecordString(signal.lifecycleMeta.superseded_by_signal_id);
  return Boolean(supersededBySignalId);
}

function shouldSkipOperationalSignalForAttentionHealthFollowUp(
  signal: TrainingPeaksStudentOperationalSignal
): boolean {
  if (signal.lifecycleState === "resolved") {
    return true;
  }
  if (isSignalSupersededForDisplay(signal)) {
    return true;
  }
  const effective = resolveEffectiveOperationalSignalForDisplay(signal);
  if (effective.effectiveVisibleInTpSignals === false) {
    return true;
  }
  return false;
}

function shouldSkipOperationalSignalForAttentionSchedulePlan(
  signal: TrainingPeaksStudentOperationalSignal
): boolean {
  if (signal.lifecycleState === "resolved") {
    return true;
  }
  if (isSignalSupersededForDisplay(signal)) {
    return true;
  }
  const effective = resolveEffectiveOperationalSignalForDisplay(signal);
  if (effective.effectiveVisibleInTpSignals === false) {
    return true;
  }
  if (effective.effectiveSignalType === "external_training_context") {
    return true;
  }
  const scheduleSummary = resolveOperationalSignalDisplaySummary(signal) ?? "";
  if (isNutritionOnlyScheduleConstraintText(scheduleSummary)) {
    return true;
  }
  return false;
}

const NUTRITION_ONLY_CONSTRAINT_CUES = [
  "еда",
  "питание",
  "калории",
  "ккал",
  "бжу",
  "жиры",
  "белки",
  "углеводы",
  "считаю",
  "не считаю",
  "контролировать еду",
  "fatsecret",
  "myfitnesspal",
];

const TRAINING_AVAILABILITY_CUES = [
  "тренировка",
  "тренироваться",
  "бег",
  "бежать",
  "смогу",
  "не смогу",
  "доступна",
  "недоступна",
  "перенести",
  "понедельник",
  "вторник",
  "среда",
  "четверг",
  "пятница",
  "суббота",
  "воскресенье",
  "выходные",
  "утром",
  "вечером",
];

function isNutritionOnlyScheduleConstraintText(raw: string): boolean {
  const normalized = raw.toLowerCase().replace(/\s+/gu, " ").trim();
  if (!normalized) {
    return false;
  }
  const hasNutritionCue = NUTRITION_ONLY_CONSTRAINT_CUES.some((cue) => normalized.includes(cue));
  if (!hasNutritionCue) {
    return false;
  }
  const hasTrainingAvailabilityCue = TRAINING_AVAILABILITY_CUES.some((cue) => normalized.includes(cue));
  return !hasTrainingAvailabilityCue;
}

function readRecoveryUpdatedDisplaySummary(
  signal: Pick<TrainingPeaksStudentOperationalSignal, "lifecycleMeta">
): string | null {
  const recoveryUpdate = signal.lifecycleMeta.recovery_update;
  if (!recoveryUpdate || typeof recoveryUpdate !== "object") {
    return null;
  }
  const updatedDisplaySummary = (recoveryUpdate as Record<string, unknown>).updated_display_summary;
  return typeof updatedDisplaySummary === "string" && updatedDisplaySummary.trim().length > 0
    ? updatedDisplaySummary.trim()
    : null;
}

export function resolveOperationalSignalDisplaySummary(
  signal: Pick<
    TrainingPeaksStudentOperationalSignal,
    "structuredPayload" | "metadata" | "lifecycleMeta"
  >,
  followUpReason?: string | null
): string | null {
  return resolveOperationalSignalDisplaySummaryCandidates(signal, followUpReason);
}

function resolveOperationalSignalDisplaySummaryCandidates(
  signal: Pick<
    TrainingPeaksStudentOperationalSignal,
    "structuredPayload" | "metadata" | "lifecycleMeta"
  >,
  followUpReason?: string | null
): string | null {
  const candidates: Array<string | null> = [
    readRecoveryUpdatedDisplaySummary(signal),
    normalizeRecordString(signal.structuredPayload.display_summary),
    normalizeRecordString(signal.structuredPayload.latest_summary),
    followUpReason ?? null,
    getSignalMetadataString(signal.metadata, "follow_up_reason"),
    getSignalMetadataString(signal.metadata, "display_summary"),
    getSignalMetadataString(signal.metadata, "latest_summary"),
  ];
  for (const candidate of candidates) {
    const sanitized = sanitizeHealthOperationalSummary(candidate);
    if (!sanitized) {
      continue;
    }
    return sanitized;
  }
  return null;
}

export function resolveOperationalSignalAttentionSummary(
  signal: TrainingPeaksStudentOperationalSignal,
  followUpReason?: string | null
): string | null {
  const summary = resolveOperationalSignalDisplaySummaryCandidates(signal, followUpReason);
  if (!summary) {
    return null;
  }
  return compactHealthFollowUpReason(summary) ?? summary;
}

function summaryAlreadyIncludesMonitoringObserve(summary: string): boolean {
  return summary
    .split(/\s*;\s*/u)
    .map((part) => part.trim().toLowerCase())
    .some((part) => part === "наблюдать" || part === "пауза / наблюдать" || part.endsWith("наблюдать"));
}

function summaryAlreadyHasRecoveryPrefix(summary: string): boolean {
  const lower = summary.trim().toLowerCase();
  return lower.startsWith("после болезни:") || lower.startsWith("после паузы:");
}

function formatMonitoringAfterReturnAttentionSummary(summary: string | null): string {
  if (!summary) {
    return "после паузы: наблюдать";
  }
  if (summaryAlreadyHasRecoveryPrefix(summary)) {
    return summaryAlreadyIncludesMonitoringObserve(summary) ? summary : `${summary}; наблюдать`;
  }
  return summaryAlreadyIncludesMonitoringObserve(summary)
    ? `после паузы: ${summary}`
    : `после паузы: ${summary}; наблюдать`;
}

function buildOperationalHealthFollowUpLifecycleBaseReason(
  signal: TrainingPeaksStudentOperationalSignal,
  followUpReason: string | null
): string {
  const lifecycleDisplayState = resolveOperationalSignalDisplayLifecycleState(signal);
  const summary = resolveOperationalSignalAttentionSummary(signal, followUpReason);

  if (lifecycleDisplayState === "ready_for_coach_close") {
    return summary ? `можно закрыть после проверки: ${summary}` : "можно закрыть после проверки";
  }
  if (lifecycleDisplayState === "stale_needs_review") {
    return "давно нет новых данных, проверить вручную";
  }
  if (lifecycleDisplayState === "monitoring_after_return") {
    return formatMonitoringAfterReturnAttentionSummary(summary);
  }
  return summary ?? "проверить самочувствие после болезни/паузы";
}

export function collectOperationalHealthFollowUpsFromSignals(input: {
  signals: TrainingPeaksStudentOperationalSignal[];
  activeStudentNameById: ReadonlyMap<string, string | null>;
  asOfDate: string;
  maxItems?: number;
}): { items: OperationalHealthFollowUpAttentionItem[]; overflowCount: number } {
  const maxItems = input.maxItems ?? 5;
  if (input.signals.length === 0) {
    return { items: [], overflowCount: 0 };
  }

  const dedupedByEpisode = new Map<string, OperationalHealthFollowUpAttentionItem>();
  const fallbackItems: OperationalHealthFollowUpAttentionItem[] = [];
  for (const signal of input.signals) {
    if (!isHealthOperationalSignalType(signal.signalType)) {
      continue;
    }
    if (shouldSkipOperationalSignalForAttentionHealthFollowUp(signal)) {
      continue;
    }
    const followUp = normalizeOperationalSignalFollowUp(signal.metadata, {
      asOfDate: input.asOfDate,
      timeZone: DEFAULT_COACH_TIMEZONE,
    });
    if (followUp.state !== "pending_due" && followUp.state !== "pending_overdue") {
      continue;
    }

    const reason = buildOperationalHealthFollowUpLifecycleBaseReason(signal, followUp.reason);
    const item: OperationalHealthFollowUpAttentionItem = {
      studentId: signal.studentId,
      studentName: input.activeStudentNameById.get(signal.studentId) ?? null,
      reason: formatOperationalHealthFollowUpReason({
        state: followUp.state,
        daysOverdue: followUp.days_overdue,
        reason,
      }),
      state: followUp.state,
      dueDate: followUp.due_date,
      daysOverdue: followUp.days_overdue,
      episodeKey: getSignalMetadataString(signal.metadata, "episode_key"),
      signalId: signal.id,
    };

    const episodeKey = item.episodeKey;
    if (!episodeKey) {
      fallbackItems.push(item);
      continue;
    }

    const dedupeKey = `${item.studentId}:${episodeKey}`;
    const existing = dedupedByEpisode.get(dedupeKey);
    if (!existing) {
      dedupedByEpisode.set(dedupeKey, item);
      continue;
    }

    const existingSortKey = getOperationalHealthFollowUpSortKey(existing);
    const nextSortKey = getOperationalHealthFollowUpSortKey(item);
    if (nextSortKey < existingSortKey || (nextSortKey === existingSortKey && item.signalId < existing.signalId)) {
      dedupedByEpisode.set(dedupeKey, item);
    }
  }

  const merged = [...dedupedByEpisode.values(), ...fallbackItems];
  merged.sort((a, b) => {
    const left = getOperationalHealthFollowUpSortKey(a);
    const right = getOperationalHealthFollowUpSortKey(b);
    if (left !== right) {
      return left.localeCompare(right);
    }
    return a.signalId.localeCompare(b.signalId);
  });

  const limited = merged.slice(0, maxItems);
  const overflowCount = Math.max(0, merged.length - limited.length);
  return {
    items: limited,
    overflowCount,
  };
}

export function collectOperationalScheduleSignalsForAttentionFromSignals(input: {
  signals: TrainingPeaksStudentOperationalSignal[];
  activeStudentNameById: ReadonlyMap<string, string | null>;
  asOfDate: string;
  maxItems?: number;
}): { items: OperationalPlanningAttentionItem[]; overflowCount: number } {
  const maxItems = input.maxItems ?? 5;
  const scheduleTypes = new Set([
    "schedule_unavailability_window",
    "schedule_availability_window",
    "plan_generation_constraint",
  ]);
  const activeSignals = input.signals.filter((signal) => {
    if (!scheduleTypes.has(signal.signalType)) {
      return false;
    }
    if (signal.validUntil && signal.validUntil < input.asOfDate) {
      return false;
    }
    if (shouldSkipOperationalSignalForAttentionSchedulePlan(signal)) {
      return false;
    }
    return true;
  });

  return collectOperationalPlanningAttentionItems({
    signals: activeSignals,
    activeStudentNameById: input.activeStudentNameById,
    asOfDate: input.asOfDate,
    signalTypes: scheduleTypes,
    maxItems,
  });
}

function buildOperationalSignalItemFromSignal(input: {
  signal: TrainingPeaksStudentOperationalSignal;
  studentNameById: ReadonlyMap<string, string | null>;
  asOfDate: string;
  episodeScheduleContext?: EpisodeScheduleContext | null;
  activeMoveActions?: readonly TrainingPeaksAction[];
  displayEvidence?: TrainingPeaksOperationalSignalDisplayEvidence | null;
}): TrainingPeaksOperationalSignalsItem {
  const { signal, studentNameById, asOfDate } = input;
  const sourceText = input.displayEvidence?.source?.textPreview?.replace(/\s+/g, " ").trim() ?? null;
  const latestText = input.displayEvidence?.latestRelevant?.textPreview?.replace(/\s+/g, " ").trim() ?? null;
  const semanticEvidenceText =
    latestText && latestText !== sourceText ? normalizeOperationalSignalSemanticText([sourceText, latestText]) : sourceText;
  const semantics = resolveOperationalSignalDisplaySemantics({
    signal,
    effective: resolveEffectiveOperationalSignalForDisplay(signal),
    sourceText: semanticEvidenceText,
  });
  const effective = semantics.effective;
  const followUp = normalizeOperationalSignalFollowUp(signal.metadata, {
    asOfDate,
    timeZone: DEFAULT_COACH_TIMEZONE,
  });
  const studentName = studentNameById.get(signal.studentId) ?? null;
  const reasonFromMeta = compactOperationalSignalText(getSignalMetadataString(signal.metadata, "follow_up_reason") ?? "", 80);
  const typeLabel = getOperationalSignalTypeLabel(effective.effectiveSignalType);
  const episodeRole = getSignalMetadataString(signal.metadata, "episode_role");
  const windowPart = getOperationalSignalWindowPart(signal);
  const windowSuffix = windowPart ? ` (${windowPart})` : "";
  const episodeKey = getSignalMetadataString(signal.metadata, "episode_key");
  const relatedSignalTypes = getSignalMetadataString(signal.metadata, "related_signal_types");
  const relatedSuffix = relatedSignalTypes ? `; сигналы: ${compactOperationalSignalText(relatedSignalTypes, 42)}` : "";
  const rolePrefix =
    episodeRole && !INTERNAL_OPERATIONAL_EPISODE_ROLES.has(episodeRole) ? `${episodeRole}: ` : "";
  const lifecycleDisplayState = resolveOperationalSignalDisplayLifecycleState(signal, input.displayEvidence ?? null);
  const displaySection = resolveOperationalSignalDisplaySection(effective);
  let lifecyclePriority =
    lifecycleDisplayState === "active_problem"
      ? 30
      : lifecycleDisplayState === "monitoring_after_return"
        ? 55
        : lifecycleDisplayState === "ready_for_coach_close"
          ? 56
          : 57;
  let lifecycleSortBucket =
    lifecycleDisplayState === "active_problem"
      ? 2
      : lifecycleDisplayState === "monitoring_after_return"
        ? 6
        : lifecycleDisplayState === "ready_for_coach_close"
          ? 7
          : 8;
  if (displaySection === "pain_injury") {
    if (lifecycleDisplayState === "ready_for_coach_close") {
      lifecyclePriority = 28;
      lifecycleSortBucket = 2;
    } else if (lifecycleDisplayState === "monitoring_after_return") {
      lifecyclePriority = 45;
      lifecycleSortBucket = 5;
    } else if (lifecycleDisplayState === "active_problem") {
      lifecyclePriority = 32;
      lifecycleSortBucket = 2;
    }
  }
  if (isSignalSupersededForDisplay(signal)) {
    return {
      signalId: signal.id,
      studentId: signal.studentId,
      studentName,
      section: resolveOperationalSignalDisplaySection(effective),
      priority: 999,
      sortBucket: 9,
      dueDate: null,
      episodeKey,
      signalType: effective.effectiveSignalType,
      isEpisodeSummary: false,
      followUpState: followUp.state,
      lifecycleDisplayState,
      text: "",
      hiddenReason: "superseded_signal_hidden",
    };
  }
  if (effective.effectiveVisibleInTpSignals === false) {
    return {
      signalId: signal.id,
      studentId: signal.studentId,
      studentName,
      section: "other",
      priority: 999,
      sortBucket: 9,
      dueDate: null,
      episodeKey,
      signalType: effective.effectiveSignalType,
      isEpisodeSummary: false,
      followUpState: followUp.state,
      lifecycleDisplayState,
      text: "",
      hiddenReason: "v2_payload_hidden",
    };
  }

  if (semantics.rerouteSection === "plan_constraints" && semantics.rerouteScheduleText) {
    return {
      signalId: signal.id,
      studentId: signal.studentId,
      studentName,
      section: "plan_constraints",
      priority: 40,
      sortBucket: 3,
      dueDate: signal.validUntil ?? signal.validFrom ?? null,
      episodeKey,
      signalType: effective.effectiveSignalType,
      isEpisodeSummary: false,
      followUpState: followUp.state,
      lifecycleDisplayState,
      text: compactCoachFacingScheduleSignalText(semantics.rerouteScheduleText),
      requiresCoachReview: effective.effectiveRequiresCoachReview,
      hiddenReason: null,
    };
  }

  if (
    shouldAutoHideCleanIllnessRecoveryFromTpSignals({
      signal,
      effective,
      lifecycleDisplayState,
      displayEvidence: input.displayEvidence ?? null,
    })
  ) {
    return {
      signalId: signal.id,
      studentId: signal.studentId,
      studentName,
      section: displaySection,
      priority: 999,
      sortBucket: 9,
      dueDate: followUp.due_date,
      episodeKey,
      signalType: effective.effectiveSignalType,
      isEpisodeSummary: false,
      followUpState: followUp.state,
      lifecycleDisplayState,
      text: "",
      requiresCoachReview: effective.effectiveRequiresCoachReview,
      hiddenReason: AUTO_HIDDEN_CLEAN_ILLNESS_RECOVERY_RUN_REASON,
    };
  }

  if (
    isPainInjuryOperationalSignalForDisplay(effective) ||
    isHealthOperationalSignalType(effective.effectiveSignalType)
  ) {
    const resolvedSummary = resolveOperationalSignalDisplaySummary(signal, reasonFromMeta || null);
    let lifecycleText: string;
    if (lifecycleDisplayState === "monitoring_after_return") {
      lifecycleText = formatMonitoringAfterReturnAttentionSummary(resolvedSummary);
    } else if (lifecycleDisplayState === "ready_for_coach_close") {
      lifecycleText = resolvedSummary
        ? `можно закрыть после проверки: ${resolvedSummary}`
        : "можно закрыть после проверки";
    } else if (lifecycleDisplayState === "stale_needs_review") {
      lifecycleText = "давно нет новых данных, проверить вручную";
    } else {
      const baseReason =
        resolvedSummary ||
        buildHealthOperationalSignalText(signal, effective.effectiveSignalType) ||
        reasonFromMeta ||
        `${typeLabel}${windowSuffix}`;
      lifecycleText = normalizeAmbiguousIllnessDisplayText(
        `${rolePrefix}${baseReason}${relatedSuffix}`.replace(/\s+/g, " ").trim()
      );
    }
    lifecycleText = buildActionableHealthOrPainDisplayText({
      signal,
      effective,
      summary: lifecycleText,
      lifecycleDisplayState,
      evidence: input.displayEvidence ?? null,
      asOfDate,
    });
    return {
      signalId: signal.id,
      studentId: signal.studentId,
      studentName,
      section: displaySection,
      priority: lifecyclePriority,
      sortBucket: lifecycleSortBucket,
      dueDate: followUp.due_date,
      episodeKey,
      signalType: effective.effectiveSignalType,
      isEpisodeSummary: false,
      followUpState: followUp.state,
      lifecycleDisplayState,
      text: lifecycleText,
      requiresCoachReview: effective.effectiveRequiresCoachReview,
      hiddenReason: null,
    };
  }

  if (isScheduleOperationalSignalType(effective.effectiveSignalType)) {
    if (
      isExpiredPlannedTrainingDatesSignal(
        {
          signalType: effective.effectiveSignalType,
          structuredPayload: signal.structuredPayload,
        },
        asOfDate
      )
    ) {
      return {
        signalId: signal.id,
        studentId: signal.studentId,
        studentName,
        section: "plan_constraints",
        priority: 999,
        sortBucket: 9,
        dueDate: null,
        episodeKey,
        signalType: effective.effectiveSignalType,
        isEpisodeSummary: false,
        followUpState: followUp.state,
        lifecycleDisplayState,
        text: "",
        hiddenReason: "expired_planned_training_dates",
      };
    }
    if (
      isExpiredScheduleOperationalSignal(
        {
          signalType: effective.effectiveSignalType,
          validUntil: signal.validUntil,
          structuredPayload: signal.structuredPayload,
        },
        asOfDate,
        { referenceObservedAt: signal.createdAt }
      )
    ) {
      return {
        signalId: signal.id,
        studentId: signal.studentId,
        studentName,
        section: "plan_constraints",
        priority: 999,
        sortBucket: 9,
        dueDate: null,
        episodeKey,
        signalType: effective.effectiveSignalType,
        isEpisodeSummary: false,
        followUpState: followUp.state,
        lifecycleDisplayState,
        text: "",
        hiddenReason: "expired_schedule_signal",
      };
    }
    if (shouldHideNutritionOnlyScheduleSignal({ signal, effective, sourceText: semanticEvidenceText })) {
      return {
        signalId: signal.id,
        studentId: signal.studentId,
        studentName,
        section: "plan_constraints",
        priority: 999,
        sortBucket: 9,
        dueDate: null,
        episodeKey,
        signalType: effective.effectiveSignalType,
        isEpisodeSummary: false,
        followUpState: followUp.state,
        lifecycleDisplayState,
        text: "",
        hiddenReason: "nutrition_only_hidden",
      };
    }
    const scheduleText = formatScheduleOperationalSignalText({
      signalType: effective.effectiveSignalType,
      validFrom: signal.validFrom,
      validUntil: signal.validUntil,
      structuredPayload: signal.structuredPayload,
      episodeContext: input.episodeScheduleContext ?? null,
      asOfDate,
    });
    const compactScheduleText = compactCoachFacingScheduleSignalText(
      scheduleText.trim() || "контекст: полный текст недоступен в signal payload"
    );
    if (
      compactScheduleText === "недоступность" &&
      isStaleGenericScheduleUnavailabilitySignal({ signal, asOfDate })
    ) {
      return {
        signalId: signal.id,
        studentId: signal.studentId,
        studentName,
        section: "plan_constraints",
        priority: 999,
        sortBucket: 9,
        dueDate: null,
        episodeKey,
        signalType: effective.effectiveSignalType,
        isEpisodeSummary: false,
        followUpState: followUp.state,
        lifecycleDisplayState,
        text: "",
        hiddenReason: "stale_generic_schedule_unavailability",
      };
    }
    return {
      signalId: signal.id,
      studentId: signal.studentId,
      studentName,
      section: "plan_constraints",
      priority: 40,
      sortBucket: 3,
      dueDate: signal.validUntil ?? signal.validFrom ?? null,
      episodeKey,
      signalType: effective.effectiveSignalType,
      isEpisodeSummary: false,
      followUpState: followUp.state,
      lifecycleDisplayState,
      text: compactScheduleText,
      requiresCoachReview: effective.effectiveRequiresCoachReview,
      hiddenReason: null,
    };
  }

  if (isMoveOperationalSignalType(effective.effectiveSignalType)) {
    const sourceDate = signal.sourceDate ?? "—";
    const targetDate = signal.targetDate ?? "—";
    const isVisible = isActionActiveForMoveSignal(signal, input.activeMoveActions ?? []);
    return {
      signalId: signal.id,
      studentId: signal.studentId,
      studentName,
      section: "moves",
      priority: 50,
      sortBucket: 4,
      dueDate: signal.targetDate ?? signal.sourceDate ?? null,
      episodeKey,
      signalType: effective.effectiveSignalType,
      isEpisodeSummary: false,
      followUpState: followUp.state,
      lifecycleDisplayState,
      text: `кандидат переноса ${sourceDate} → ${targetDate}`,
      requiresCoachReview: effective.effectiveRequiresCoachReview,
      hiddenReason: isVisible ? null : "no_active_move_action",
    };
  }

  const genericReason = compactOperationalSignalText(
    getSignalMetadataString(signal.metadata, "reason") ??
      getSignalMetadataString(signal.metadata, "summary") ??
      "",
    160
  );
  const genericBase = `${typeLabel}${windowSuffix}`;
  if (effective.effectiveSignalType === "health_issue_resolved" || genericBase === "самочувствие") {
    return {
      signalId: signal.id,
      studentId: signal.studentId,
      studentName,
      section: "other",
      priority: 100,
      sortBucket: 9,
      dueDate: signal.validUntil ?? signal.validFrom ?? null,
      episodeKey,
      signalType: effective.effectiveSignalType,
      isEpisodeSummary: false,
      followUpState: followUp.state,
      lifecycleDisplayState,
      text: genericReason ? `${genericBase}: ${genericReason}` : genericBase,
      requiresCoachReview: effective.effectiveRequiresCoachReview,
      hiddenReason: "resolved_health_hidden_in_normal_view",
    };
  }
  return {
    signalId: signal.id,
    studentId: signal.studentId,
    studentName,
    section: "other",
    priority: 60,
    sortBucket: 5,
    dueDate: signal.validUntil ?? signal.validFrom ?? null,
    episodeKey,
    signalType: effective.effectiveSignalType,
    isEpisodeSummary: false,
    followUpState: followUp.state,
    lifecycleDisplayState,
    text: genericReason ? `${genericBase}: ${genericReason}` : genericBase,
    requiresCoachReview: effective.effectiveRequiresCoachReview,
    hiddenReason: null,
  };
}

function isAmbiguousIllnessDisplayItem(item: TrainingPeaksOperationalSignalsItem): boolean {
  if (item.section !== "health_pause" || item.signalType !== "health_issue_started") {
    return false;
  }
  const normalized = item.text.trim().toLowerCase();
  if (normalized.includes("возможно заболевает") || normalized.includes("уточнить самочувствие")) {
    return true;
  }
  if (item.requiresCoachReview !== true) {
    return false;
  }
  return normalized === "болеет";
}

function mergeOperationalSignalEpisodeItems(
  current: TrainingPeaksOperationalSignalsItem,
  incoming: TrainingPeaksOperationalSignalsItem,
  episodeSignals?: readonly TrainingPeaksStudentOperationalSignal[],
  asOfDate?: string
): TrainingPeaksOperationalSignalsItem {
  if (
    current.section === "pain_injury" &&
    incoming.section === "health_pause" &&
    isAmbiguousIllnessDisplayItem(incoming)
  ) {
    return current;
  }
  if (
    incoming.section === "pain_injury" &&
    current.section === "health_pause" &&
    isAmbiguousIllnessDisplayItem(current)
  ) {
    return incoming;
  }
  if (current.section === "health_pause" && incoming.section === "health_pause") {
    const rank = (item: TrainingPeaksOperationalSignalsItem): number => {
      if (item.signalType === "health_issue_started" || item.signalType === "pause_training") {
        return 4;
      }
      if (item.signalType === "health_issue_improving") {
        return 3;
      }
      if (item.signalType === "resume_training") {
        return 2;
      }
      return 1;
    };
    const currentRank = rank(current);
    const incomingRank = rank(incoming);
    if (incomingRank !== currentRank) {
      return incomingRank > currentRank ? incoming : current;
    }
    if (incoming.text.length !== current.text.length) {
      return incoming.text.length > current.text.length ? incoming : current;
    }
  }

  if (
    current.section === "plan_constraints" &&
    incoming.section === "plan_constraints" &&
    episodeSignals &&
    episodeSignals.length > 0
  ) {
    const currentKey = getOperationalSignalSortKey(current);
    const incomingKey = getOperationalSignalSortKey(incoming);
    const preferred = incomingKey < currentKey ? incoming : current;
    return {
      ...preferred,
      text: buildCanonicalEpisodeScheduleDisplayText({ signals: episodeSignals, asOfDate }),
    };
  }

  const currentKey = getOperationalSignalSortKey(current);
  const incomingKey = getOperationalSignalSortKey(incoming);
  return incomingKey < currentKey ? incoming : current;
}

function hasConcretePainInjuryMonitoringItem(item: TrainingPeaksOperationalSignalsItem): boolean {
  if (item.section !== "pain_injury") {
    return false;
  }
  return (
    item.lifecycleDisplayState === "monitoring_after_return" ||
    item.lifecycleDisplayState === "ready_for_coach_close"
  );
}

function suppressAmbiguousIllnessWhenConcretePainVisible(
  items: readonly TrainingPeaksOperationalSignalsItem[]
): TrainingPeaksOperationalSignalsItem[] {
  const studentsWithConcretePain = new Set<string>();
  for (const item of items) {
    if (hasConcretePainInjuryMonitoringItem(item)) {
      studentsWithConcretePain.add(item.studentId);
    }
  }
  if (studentsWithConcretePain.size === 0) {
    return [...items];
  }
  return items.filter((item) => {
    if (item.section !== "health_pause") {
      return true;
    }
    if (!studentsWithConcretePain.has(item.studentId)) {
      return true;
    }
    return !isAmbiguousIllnessDisplayItem(item);
  });
}

function filterNormalOperationalSignalItems(items: TrainingPeaksOperationalSignalsItem[]): TrainingPeaksOperationalSignalsItem[] {
  return items.filter((item) => {
    if (item.signalType === "resolved") {
      return false;
    }
    if (item.hiddenReason) {
      return false;
    }
    if (item.signalType === "health_issue_resolved") {
      return false;
    }
    if (item.section === "pain_injury") {
      if (item.lifecycleDisplayState === "monitoring_after_return") {
        return true;
      }
      if (item.lifecycleDisplayState === "ready_for_coach_close") {
        return true;
      }
      if (item.lifecycleDisplayState === "stale_needs_review") {
        return true;
      }
    }
    if (item.section === "health_pause") {
      if (item.lifecycleDisplayState === "monitoring_after_return") {
        return true;
      }
      if (item.lifecycleDisplayState === "ready_for_coach_close") {
        return true;
      }
      if (item.lifecycleDisplayState === "stale_needs_review") {
        return true;
      }
      if (item.signalType === "health_issue_improving") {
        return true;
      }
      if (item.signalType === "health_issue_started") {
        return item.followUpState !== "resolved_or_non_pending";
      }
    }
    if (item.followUpState === "pending_due" || item.followUpState === "pending_overdue") {
      if (
        item.section === "pain_injury" &&
        (item.lifecycleDisplayState === "monitoring_after_return" ||
          item.lifecycleDisplayState === "ready_for_coach_close")
      ) {
        return true;
      }
      return false;
    }
    if (item.section === "other" && /^самочувствие\b/iu.test(item.text)) {
      return false;
    }
    return true;
  });
}

function dedupeHealthByStudent(items: readonly TrainingPeaksOperationalSignalsItem[]): TrainingPeaksOperationalSignalsItem[] {
  const grouped = new Map<string, TrainingPeaksOperationalSignalsItem[]>();
  for (const item of items) {
    if (item.section !== "health_pause") {
      continue;
    }
    const list = grouped.get(item.studentId) ?? [];
    list.push(item);
    grouped.set(item.studentId, list);
  }
  const keepByStudent = new Map<string, string>();
  for (const [studentId, studentItems] of grouped.entries()) {
    const best = [...studentItems].sort((left, right) => {
      const rank = (item: TrainingPeaksOperationalSignalsItem): number => {
        if (item.lifecycleDisplayState === "active_problem") {
          return 10;
        }
        if (item.lifecycleDisplayState === "ready_for_coach_close") {
          return 7;
        }
        if (item.lifecycleDisplayState === "monitoring_after_return") {
          return 6;
        }
        if (item.lifecycleDisplayState === "stale_needs_review") {
          return 5;
        }
        if (item.signalType === "health_issue_started" || item.signalType === "pause_training") {
          return 4;
        }
        if (item.signalType === "health_issue_improving") {
          return 3;
        }
        if (item.signalType === "resume_training") {
          return 2;
        }
        return 1;
      };
      const rankDelta = rank(right) - rank(left);
      if (rankDelta !== 0) {
        return rankDelta;
      }
      const textDelta = right.text.length - left.text.length;
      if (textDelta !== 0) {
        return textDelta;
      }
      return getOperationalSignalSortKey(left).localeCompare(getOperationalSignalSortKey(right));
    })[0];
    if (best) {
      keepByStudent.set(studentId, best.signalId);
    }
  }
  return items.filter((item) => item.section !== "health_pause" || keepByStudent.get(item.studentId) === item.signalId);
}

function hasRichScheduleDisplayText(text: string): boolean {
  return text.split("; ").some(
    (part) => part.startsWith("доступна:") || part.startsWith("недоступна:") || part.startsWith("учесть в плане:")
  );
}

function shouldSuppressLegacyScheduleDuplicate(input: {
  item: TrainingPeaksOperationalSignalsItem;
  allItems: readonly TrainingPeaksOperationalSignalsItem[];
}): boolean {
  const { item, allItems } = input;
  if (item.section !== "plan_constraints" || item.signalType !== "schedule_unavailability_window") {
    return false;
  }
  if (item.text !== "недоступность") {
    return false;
  }

  return allItems.some((candidate) => {
    if (candidate === item) {
      return false;
    }
    if (candidate.studentId !== item.studentId) {
      return false;
    }
    if (candidate.section !== "plan_constraints") {
      return false;
    }
    return hasRichScheduleDisplayText(candidate.text);
  });
}

function toOperationalSignalDisplayLine(item: TrainingPeaksOperationalSignalsItem): string {
  const name = item.studentName?.trim() || "Без ученика";
  return formatOperationalSignalTelegramLine(name, item.text);
}

export function formatTrainingPeaksOperationalSignalsForTelegram(
  snapshot: TrainingPeaksOperationalSignalsSnapshot
): string {
  const lines: string[] = [];
  lines.push("📍 Сигналы");

  const nonEmptySections = snapshot.sections.filter((section) => section.items.length > 0);
  if (nonEmptySections.length === 0) {
    lines.push("", "Активных сигналов не найдено.");
    return lines.join("\n");
  }

  for (const section of nonEmptySections) {
    const visibleItems = section.items.filter((item) =>
      !shouldSuppressLegacyScheduleDuplicate({
        item,
        allItems: section.items,
      })
    );
    if (visibleItems.length === 0) {
      continue;
    }
    lines.push("", section.title, "");
    for (let index = 0; index < visibleItems.length; index += 1) {
      if (index > 0) {
        lines.push("");
      }
      lines.push(toOperationalSignalDisplayLine(visibleItems[index]!));
    }
  }

  if (snapshot.overflowCount > 0) {
    lines.push("", `+${snapshot.overflowCount} ещё сигналов`);
  }

  return lines.join("\n");
}

const TELEGRAM_SIGNALS_CHUNK_LIMIT = 3500;

function splitOperationalSignalCardLine(line: string, limit: number): string[] {
  if (line.length <= limit) {
    return [line];
  }
  const parts: string[] = [];
  let rest = line.trim();
  let index = 0;
  while (rest.length > 0) {
    const prefix = index === 0 ? "" : "• продолжение\n  ";
    const available = Math.max(200, limit - prefix.length);
    if (rest.length <= available) {
      parts.push(`${prefix}${rest}`);
      break;
    }
    let boundary = rest.lastIndexOf("\n", available);
    if (boundary < Math.floor(available * 0.5)) {
      boundary = rest.lastIndexOf(" ", available);
    }
    if (boundary <= 0) {
      boundary = available;
    }
    parts.push(`${prefix}${rest.slice(0, boundary).trimEnd()}`);
    rest = rest.slice(boundary).trimStart();
    index += 1;
  }
  return parts.filter(Boolean);
}

export function formatTrainingPeaksOperationalSignalsForTelegramMultiMessage(
  snapshot: TrainingPeaksOperationalSignalsSnapshot
): string[] {
  const nonEmptySections = snapshot.sections.filter((section) => section.items.length > 0);
  if (nonEmptySections.length === 0) {
    return ["📍 Сигналы\n\nАктивных сигналов не найдено."];
  }

  const blocks: { sectionTitle: string; line: string }[] = [];
  for (const section of nonEmptySections) {
    const visibleItems = section.items.filter((item) =>
      !shouldSuppressLegacyScheduleDuplicate({
        item,
        allItems: section.items,
      })
    );
    for (const item of visibleItems) {
      for (const line of splitOperationalSignalCardLine(
        toOperationalSignalDisplayLine(item),
        TELEGRAM_SIGNALS_CHUNK_LIMIT - 120
      )) {
        blocks.push({ sectionTitle: section.title, line });
      }
    }
  }

  if (blocks.length === 0) {
    return ["📍 Сигналы\n\nАктивных сигналов не найдено."];
  }

  const chunks: string[] = [];
  let currentChunk = "📍 Сигналы";
  let currentSection = "";

  for (const block of blocks) {
    let addition = "";
    if (block.sectionTitle !== currentSection) {
      addition = `\n\n${block.sectionTitle}\n\n${block.line}`;
      currentSection = block.sectionTitle;
    } else {
      addition = `\n\n${block.line}`;
    }

    if (currentChunk.length + addition.length > TELEGRAM_SIGNALS_CHUNK_LIMIT && currentChunk !== "📍 Сигналы") {
      chunks.push(currentChunk);
      currentChunk = "📍 Сигналы (продолжение)";
      addition = `\n\n${block.sectionTitle}\n\n${block.line}`;
      currentSection = block.sectionTitle;
    }
    currentChunk += addition;
  }
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  if (chunks.length <= 1) {
    return chunks;
  }

  return chunks.map((chunk, index) =>
    chunk.replace(
      /^📍 Сигналы(?:\s*\(продолжение\))?/u,
      `📍 Сигналы ${index + 1}/${chunks.length}`
    )
  );
}

function collectOperationalSignalDisplayItemsFromSignals(input: {
  signals: TrainingPeaksStudentOperationalSignal[];
  studentNameById: ReadonlyMap<string, string | null>;
  asOfDate: string;
  scope: TrainingPeaksOperationalSignalsScope;
  activeMoveActions?: readonly TrainingPeaksAction[];
  displayEvidenceBySignalId?: ReadonlyMap<string, TrainingPeaksOperationalSignalDisplayEvidence>;
}): TrainingPeaksOperationalSignalsItem[] {
  const episodeScheduleIndex = buildEpisodeScheduleContextIndex(input.signals);
  const dedupedByEpisode = new Map<string, TrainingPeaksOperationalSignalsItem>();
  const episodeSignalsByKey = new Map<string, TrainingPeaksStudentOperationalSignal[]>();
  const fallbackItems: TrainingPeaksOperationalSignalsItem[] = [];
  for (const signal of input.signals) {
    if (signal.lifecycleState === "resolved") {
      continue;
    }
    const effective = resolveEffectiveOperationalSignalForDisplay(signal);
    if (!shouldKeepOperationalSignalByScope(effective.effectiveSignalType, input.scope)) {
      continue;
    }
    const episodeKey = getSignalMetadataString(signal.metadata, "episode_key");
    if (episodeKey && isScheduleOperationalSignalType(effective.effectiveSignalType)) {
      const episodeDedupeKey = `${signal.studentId}:${episodeKey}`;
      const group = episodeSignalsByKey.get(episodeDedupeKey) ?? [];
      group.push(signal);
      episodeSignalsByKey.set(episodeDedupeKey, group);
    }
  }

  for (const signal of input.signals) {
    if (signal.lifecycleState === "resolved") {
      continue;
    }
    const effective = resolveEffectiveOperationalSignalForDisplay(signal);
    if (!shouldKeepOperationalSignalByScope(effective.effectiveSignalType, input.scope)) {
      continue;
    }
    const episodeKey = getSignalMetadataString(signal.metadata, "episode_key");
    const episodeScheduleContext = episodeKey
      ? episodeScheduleIndex.get(`${signal.studentId}:${episodeKey}`) ?? null
      : null;
    const item = buildOperationalSignalItemFromSignal({
      signal,
      studentNameById: input.studentNameById,
      asOfDate: input.asOfDate,
      episodeScheduleContext,
      activeMoveActions: input.activeMoveActions,
      displayEvidence: input.displayEvidenceBySignalId?.get(signal.id) ?? null,
    });
    if (item.hiddenReason) {
      continue;
    }
    if (!item.episodeKey) {
      fallbackItems.push(item);
      continue;
    }
    const episodeDedupeKey = `${item.studentId}:${item.episodeKey}`;
    const existing = dedupedByEpisode.get(episodeDedupeKey);
    if (!existing) {
      if (item.section === "plan_constraints") {
        const episodeSignals = episodeSignalsByKey.get(episodeDedupeKey) ?? [signal];
        dedupedByEpisode.set(episodeDedupeKey, {
          ...item,
          text: buildCanonicalEpisodeScheduleDisplayText({ signals: episodeSignals, asOfDate: input.asOfDate }),
        });
      } else {
        dedupedByEpisode.set(episodeDedupeKey, item);
      }
      continue;
    }
    dedupedByEpisode.set(
      episodeDedupeKey,
      mergeOperationalSignalEpisodeItems(
        existing,
        item,
        episodeSignalsByKey.get(episodeDedupeKey),
        input.asOfDate
      )
    );
  }

  const allItemsRaw = [...dedupedByEpisode.values(), ...fallbackItems];
  const allItems = suppressAmbiguousIllnessWhenConcretePainVisible(
    dedupeHealthByStudent(filterNormalOperationalSignalItems(allItemsRaw))
  );
  allItems.sort((left, right) => getOperationalSignalSortKey(left).localeCompare(getOperationalSignalSortKey(right)));
  return allItems;
}

export function collectOperationalSignalDiagnosticItems(input: {
  signals: TrainingPeaksStudentOperationalSignal[];
  studentNameById: ReadonlyMap<string, string | null>;
  asOfDate: string;
  scope?: TrainingPeaksOperationalSignalsScope;
  activeMoveActions?: readonly TrainingPeaksAction[];
  displayEvidenceBySignalId?: ReadonlyMap<string, TrainingPeaksOperationalSignalDisplayEvidence>;
  visibleOnly?: boolean;
}): TrainingPeaksOperationalSignalsItem[] {
  const scope = input.scope ?? "all";
  const episodeScheduleIndex = buildEpisodeScheduleContextIndex(input.signals);
  const dedupedByEpisode = new Map<string, TrainingPeaksOperationalSignalsItem>();
  const episodeSignalsByKey = new Map<string, TrainingPeaksStudentOperationalSignal[]>();
  const fallbackItems: TrainingPeaksOperationalSignalsItem[] = [];
  for (const signal of input.signals) {
    if (signal.lifecycleState === "resolved") {
      continue;
    }
    const effective = resolveEffectiveOperationalSignalForDisplay(signal);
    if (!shouldKeepOperationalSignalByScope(effective.effectiveSignalType, scope)) {
      continue;
    }
    const episodeKey = getSignalMetadataString(signal.metadata, "episode_key");
    if (episodeKey && isScheduleOperationalSignalType(effective.effectiveSignalType)) {
      const episodeDedupeKey = `${signal.studentId}:${episodeKey}`;
      const group = episodeSignalsByKey.get(episodeDedupeKey) ?? [];
      group.push(signal);
      episodeSignalsByKey.set(episodeDedupeKey, group);
    }
  }

  for (const signal of input.signals) {
    if (signal.lifecycleState === "resolved") {
      continue;
    }
    const effective = resolveEffectiveOperationalSignalForDisplay(signal);
    if (!shouldKeepOperationalSignalByScope(effective.effectiveSignalType, scope)) {
      continue;
    }
    const episodeKey = getSignalMetadataString(signal.metadata, "episode_key");
    const episodeScheduleContext = episodeKey
      ? episodeScheduleIndex.get(`${signal.studentId}:${episodeKey}`) ?? null
      : null;
    const item = buildOperationalSignalItemFromSignal({
      signal,
      studentNameById: input.studentNameById,
      asOfDate: input.asOfDate,
      episodeScheduleContext,
      activeMoveActions: input.activeMoveActions,
      displayEvidence: input.displayEvidenceBySignalId?.get(signal.id) ?? null,
    });
    if (input.visibleOnly && item.hiddenReason) {
      continue;
    }
    if (!item.episodeKey) {
      fallbackItems.push(item);
      continue;
    }
    const episodeDedupeKey = `${item.studentId}:${item.episodeKey}`;
    const existing = dedupedByEpisode.get(episodeDedupeKey);
    if (!existing) {
      if (item.section === "plan_constraints" && !item.hiddenReason) {
        const episodeSignals = episodeSignalsByKey.get(episodeDedupeKey) ?? [signal];
        dedupedByEpisode.set(episodeDedupeKey, {
          ...item,
          text: buildCanonicalEpisodeScheduleDisplayText({ signals: episodeSignals, asOfDate: input.asOfDate }),
        });
      } else {
        dedupedByEpisode.set(episodeDedupeKey, item);
      }
      continue;
    }
    if (item.hiddenReason) {
      continue;
    }
    dedupedByEpisode.set(
      episodeDedupeKey,
      mergeOperationalSignalEpisodeItems(existing, item, episodeSignalsByKey.get(episodeDedupeKey), input.asOfDate)
    );
  }

  const allItemsRaw = [...dedupedByEpisode.values(), ...fallbackItems];
  const filtered = input.visibleOnly
    ? suppressAmbiguousIllnessWhenConcretePainVisible(
        dedupeHealthByStudent(filterNormalOperationalSignalItems(allItemsRaw.filter((item) => !item.hiddenReason)))
      )
    : allItemsRaw;
  filtered.sort((left, right) => getOperationalSignalSortKey(left).localeCompare(getOperationalSignalSortKey(right)));
  return filtered;
}

export function buildTrainingPeaksOperationalSignalsSnapshotFromSignals(input: {
  signals: TrainingPeaksStudentOperationalSignal[];
  studentNameById?: ReadonlyMap<string, string | null>;
  asOfDate: string;
  scope?: TrainingPeaksOperationalSignalsScope;
  limit?: number;
  activeMoveActions?: readonly TrainingPeaksAction[];
  displayEvidenceBySignalId?: ReadonlyMap<string, TrainingPeaksOperationalSignalDisplayEvidence>;
}): TrainingPeaksOperationalSignalsSnapshot {
  const scope = input.scope ?? "all";
  const maxItems = Math.max(5, Math.min(100, Math.floor(input.limit ?? 20)));
  const studentNameById = input.studentNameById ?? new Map<string, string | null>();
  const allItems = collectOperationalSignalDisplayItemsFromSignals({
    signals: input.signals,
    studentNameById,
    asOfDate: input.asOfDate,
    scope,
    activeMoveActions: input.activeMoveActions,
    displayEvidenceBySignalId: input.displayEvidenceBySignalId,
  });
  const limited = allItems.slice(0, maxItems);

  const sectionsMap = createOperationalSignalsSections();
  for (const item of limited) {
    sectionsMap[item.section].items.push(item);
  }

  return {
    scope,
    sections: TRAININGPEAKS_OPERATIONAL_SIGNALS_SECTION_ORDER.map((key) => sectionsMap[key]),
    totalBeforeLimit: allItems.length,
    overflowCount: Math.max(0, allItems.length - limited.length),
  };
}

export async function getTrainingPeaksOperationalSignalsSnapshot(input?: {
  scope?: TrainingPeaksOperationalSignalsScope;
  limit?: number;
}): Promise<TrainingPeaksOperationalSignalsSnapshot> {
  const [signals, students, actions] = await Promise.all([
    listTrainingPeaksOperationalSignals({
      status: "active",
      limit: 250,
    }),
    listTrainingPeaksStudents(),
    listActiveTrainingPeaksMoveActions(250),
  ]);
  const studentNameById = new Map(students.map((student) => [student.id, student.studentName?.trim() || null]));
  const asOfDate = getCoachTodayDateKey(DEFAULT_COACH_TIMEZONE);
  const displayEvidenceBySignalId = await buildOperationalSignalDisplayEvidenceMap({
    signals: signals.items,
    asOfDate,
  });
  return buildTrainingPeaksOperationalSignalsSnapshotFromSignals({
    signals: signals.items,
    studentNameById,
    asOfDate,
    scope: input?.scope,
    limit: input?.limit,
    activeMoveActions: actions,
    displayEvidenceBySignalId,
  });
}

export async function getTrainingPeaksHealthSnapshot(): Promise<TrainingPeaksHealthSnapshot> {
  const staleRunningCutoffIso = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const [lastAttentionDigestCronRun, runningJobsOlderThanSixHours] = await Promise.all([
    getLatestTrainingPeaksCronRunLog({
      jobName: TRAININGPEAKS_ATTENTION_DIGEST_CRON_JOB_NAME,
    }),
    countRunningTrainingPeaksJobsUpdatedBefore(staleRunningCutoffIso),
  ]);

  return {
    lastAttentionDigestCronStatus: lastAttentionDigestCronRun?.status ?? null,
    runningJobsOlderThanSixHours,
  };
}

function trimTelegramBusinessText(value: string | undefined): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return null;
  }

  return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
}

export async function upsertTrainingPeaksBusinessChatFromMessage(
  message: Pick<TelegramMessage, "business_connection_id" | "chat" | "text" | "caption">
): Promise<TrainingPeaksBusinessChatSnapshot | null> {
  const businessConnectionId = message.business_connection_id?.trim();
  const chatId = message.chat?.id;

  if (!businessConnectionId || chatId === undefined || chatId === null) {
    return null;
  }

  return upsertTrainingPeaksBusinessChatFromMessageInRepository({
    businessConnectionId,
    chatId: String(chatId),
    username: message.chat.username?.trim() || null,
    firstName: message.chat.first_name?.trim() || null,
    lastName: message.chat.last_name?.trim() || null,
    lastText: trimTelegramBusinessText(message.text ?? message.caption),
    lastSeenAt: new Date().toISOString(),
  });
}

export async function listRecentTrainingPeaksBusinessChats(
  limit = 10
): Promise<TrainingPeaksBusinessChatSnapshot[]> {
  return listRecentTrainingPeaksBusinessChatsFromRepository(limit);
}

export async function findTrainingPeaksBusinessChatsByUsername(
  username: string,
  limit = 10
): Promise<TrainingPeaksBusinessChatSnapshot[]> {
  return listTrainingPeaksBusinessChatsByUsernameFromRepository(username, limit);
}

export async function getTrainingPeaksBusinessChatByInternalId(
  id: string
): Promise<TrainingPeaksBusinessChatSnapshot | null> {
  return getTrainingPeaksBusinessChatById(id);
}

export async function getTrainingPeaksBusinessChatByChatId(
  chatId: string
): Promise<TrainingPeaksBusinessChatSnapshot | null> {
  return getTrainingPeaksBusinessChatByChatIdFromRepository(chatId);
}

export async function listTrainingPeaksBusinessChatsForTelegramLinking(
  limit = 500
): Promise<TrainingPeaksBusinessChatSnapshot[]> {
  return listTrainingPeaksBusinessChatsForTelegramLinkingFromRepository(limit);
}

export async function linkTrainingPeaksStudentToBusinessChat(
  studentId: string,
  chatId: string,
  businessConnectionId: string
): Promise<{ student: TrainingPeaksStudent; chat: TrainingPeaksBusinessChatSnapshot } | null> {
  return linkTrainingPeaksStudentToBusinessChatInRepository(studentId, chatId, businessConnectionId);
}

export async function createTrainingPeaksStudentTelegramLinkCode(
  studentId: string,
  options?: {
    expiresInHours?: number;
  }
): Promise<
  | {
      student: TrainingPeaksRegistryStudentSnapshot;
      linkCode: TrainingPeaksStudentTelegramLinkCodeSnapshot;
    }
  | null
> {
  const student = await getTrainingPeaksStudentCardByInternalId(studentId);

  if (!student) {
    return null;
  }

  await expireActiveTrainingPeaksStudentTelegramLinkCodesForStudent(student.id);
  const expiresInHours = Math.max(1, Math.floor(options?.expiresInHours ?? TP_TELEGRAM_LINK_CODE_DEFAULT_TTL_HOURS));
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = createTrainingPeaksTelegramLinkCodeValue(student.studentName);

    try {
      const linkCode = await insertTrainingPeaksStudentTelegramLinkCode({
        studentId: student.id,
        code,
        expiresAt,
      });

      return {
        student,
        linkCode,
      };
    } catch (error) {
      if (error instanceof TrainingPeaksTelegramLinkCodeConflictError) {
        continue;
      }

      throw error;
    }
  }

  throw new Error("Failed to generate unique TrainingPeaks Telegram link code");
}

async function getStudentNameByInternalId(id: string): Promise<string | null> {
  const student = await getTrainingPeaksStudentByIdFromRepository(id);
  return student?.studentName ?? null;
}

export async function consumeTrainingPeaksStudentTelegramLinkCode(
  text: string,
  businessConnectionId: string,
  chatId: string
): Promise<ConsumeTrainingPeaksStudentTelegramLinkCodeResult> {
  const candidateCodes = extractTrainingPeaksTelegramLinkCodeCandidates(text);

  if (candidateCodes.length === 0) {
    return { kind: "no_candidate" };
  }

  const allMatchingCodes = await listTrainingPeaksStudentTelegramLinkCodesByCode(candidateCodes);
  const now = Date.now();
  const expiredActiveCodes = allMatchingCodes.filter(
    (code) => code.status === "active" && new Date(code.expiresAt).getTime() <= now
  );

  if (expiredActiveCodes.length > 0) {
    await expireTrainingPeaksStudentTelegramLinkCodesByIds(expiredActiveCodes.map((code) => code.id));
  }

  for (const candidateCode of candidateCodes) {
    const candidateMatches = allMatchingCodes.filter((code) => code.code === candidateCode);
    const activeMatches = candidateMatches.filter(
      (code) => code.status === "active" && new Date(code.expiresAt).getTime() > now
    );

    if (activeMatches.length === 1) {
      const activeCode = activeMatches[0]!;
      const linked = await linkTrainingPeaksStudentToBusinessChatInRepository(
        activeCode.studentId,
        chatId,
        businessConnectionId
      );

      if (!linked) {
        return {
          kind: "link_failed",
          code: candidateCode,
          studentName: await getStudentNameByInternalId(activeCode.studentId),
        };
      }

      await markTrainingPeaksStudentTelegramLinkCodeUsed(activeCode.id, {
        businessConnectionId,
        chatId,
      });

      return {
        kind: "linked",
        code: candidateCode,
        student: linked.student,
        chat: linked.chat,
      };
    }
  }

  for (const candidateCode of candidateCodes) {
    const candidateMatches = allMatchingCodes.filter((code) => code.code === candidateCode);
    const activeMatches = candidateMatches.filter(
      (code) => code.status === "active" && new Date(code.expiresAt).getTime() > now
    );

    if (activeMatches.length > 1) {
      return {
        kind: "ambiguous",
        code: candidateCode,
        matches: activeMatches.length,
      };
    }

    const usedMatch = candidateMatches.find((code) => code.status === "used");

    if (usedMatch) {
      return {
        kind: "used",
        code: candidateCode,
        studentName: await getStudentNameByInternalId(usedMatch.studentId),
      };
    }

    const expiredMatch = candidateMatches.find(
      (code) => code.status === "expired" || new Date(code.expiresAt).getTime() <= now
    );

    if (expiredMatch) {
      return {
        kind: "expired",
        code: candidateCode,
        studentName: await getStudentNameByInternalId(expiredMatch.studentId),
      };
    }
  }

  return {
    kind: "no_match",
    code: candidateCodes[0]!,
  };
}

const MULTI_MESSAGE_MOVE_INTENT_CONFIDENCE_CAP = 0.85;
const MULTI_MESSAGE_MOVE_INTENT_DEDUPE_MINUTES = 10;
const MULTI_MESSAGE_MOVE_INTENT_CONTEXT_MINUTES = 3;
const MULTI_MESSAGE_MOVE_INTENT_CONTEXT_LIMIT = 5;
const MULTI_MESSAGE_MOVE_INTENT_CONTEXT_PREVIEW_LIMIT = 3;

type AssembledMoveIntentParseResult = {
  parsed: ParsedTrainingPeaksMoveWorkoutPayload;
  confidence: number;
  contextMessageIds: Array<string | number>;
  contextPreviews: string[];
};

async function tryAssembleMultiMessageMoveIntent(input: {
  chatId: string;
  triggerText: string;
  triggerMessageId: string;
  messageDateUnix?: number | null;
}): Promise<AssembledMoveIntentParseResult | null> {
  if (!triggerHasStrictMoveVerb(input.triggerText)) {
    return null;
  }

  let recent: Awaited<
    ReturnType<typeof listRecentTrainingPeaksTelegramContextObservationsForChat>
  > = [];
  try {
    recent = await listRecentTrainingPeaksTelegramContextObservationsForChat({
      telegramChatId: input.chatId,
      sinceMinutes: MULTI_MESSAGE_MOVE_INTENT_CONTEXT_MINUTES,
      limit: MULTI_MESSAGE_MOVE_INTENT_CONTEXT_LIMIT,
    });
  } catch (error) {
    console.warn("Failed to list recent TrainingPeaks telegram context observations for multi-message move intent", {
      chatId: input.chatId,
      messageId: input.triggerMessageId,
      error,
    });
    return null;
  }

  const assembled = assembleTrainingPeaksMoveIntentContext({
    triggerText: input.triggerText,
    triggerMessageId: input.triggerMessageId,
    recentMessages: recent.map((row) => ({
      textPreview: row.textPreview ?? "",
      messageId: row.messageId,
      observedAt: row.observedAt,
      labels: row.labels,
    })),
  });

  if (!assembled) {
    return null;
  }

  const assembledParse = await parseTrainingPeaksMoveWorkoutRequest(assembled.assembledText, {
    messageDateUnix: input.messageDateUnix ?? null,
  });

  if (!assembledParse.ok) {
    return null;
  }

  // Safety: even if the parser accepted the assembled text, reject any
  // ambiguous-source/target situations explicitly. We want the assembled
  // path to be at least as conservative as the single-message path.
  if (
    assembledParse.payload.clarificationReason === "source day is ambiguous" ||
    assembledParse.payload.clarificationReason === "ambiguous_target_day"
  ) {
    return null;
  }

  return {
    parsed: assembledParse.payload,
    confidence: assembledParse.confidence,
    contextMessageIds: assembled.contextMessageIds,
    contextPreviews: assembled.contextPreviews,
  };
}

function applyMultiMessageMoveIntentCaution(input: {
  parsed: ParsedTrainingPeaksMoveWorkoutPayload;
  contextMessageIds: Array<string | number>;
  contextPreviews: string[];
}): ParsedTrainingPeaksMoveWorkoutPayload {
  const cappedConfidence = Math.min(
    input.parsed.confidence,
    MULTI_MESSAGE_MOVE_INTENT_CONFIDENCE_CAP
  );
  const cautionWarning =
    "Собрано из нескольких сообщений. Проверь источник и целевой день вручную.";
  const warnings = [...(input.parsed.warnings ?? [])];
  if (!warnings.includes(cautionWarning)) {
    warnings.push(cautionWarning);
  }

  const safeContextPreviews = input.contextPreviews
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .slice(0, MULTI_MESSAGE_MOVE_INTENT_CONTEXT_PREVIEW_LIMIT);

  return {
    ...input.parsed,
    confidence: cappedConfidence,
    needsClarification: true,
    clarificationReason:
      input.parsed.clarificationReason ?? "assembled_from_multiple_messages",
    warnings,
    parsingDiagnostics: {
      ...(input.parsed.parsingDiagnostics ?? {
        parserBaseDateSource: "server_now",
        parserBaseDateIso: "",
        messageTimestampAvailable: false,
      }),
      assemblyKind: "multi_message",
      contextMessageIds: input.contextMessageIds,
      contextPreviews: safeContextPreviews,
    },
  };
}

export async function createTrainingPeaksMoveWorkoutActionFromTelegram(
  input: CreateTrainingPeaksMoveWorkoutActionFromTelegramInput
): Promise<CreateTrainingPeaksMoveWorkoutActionFromTelegramResult> {
  const trimmedText = input.text.trim();

  if (!trimmedText) {
    return { ok: false, reason: "empty_text" };
  }

  const student = await getTrainingPeaksStudentByTelegramChatIdFromRepository(input.chatId);
  if (!student) {
    return { ok: false, reason: "student_not_found" };
  }

  const parsed = await parseTrainingPeaksMoveWorkoutRequest(trimmedText, {
    messageDateUnix: input.messageDateUnix ?? null,
    studentTimezone: input.studentTimezone ?? null,
    bypassStrictGate: input.aiBypass === true,
  });

  let parsedPayload: ParsedTrainingPeaksMoveWorkoutPayload | null = null;
  let parsedConfidence: number | null = null;
  let assemblyKind: "single_message" | "multi_message" = "single_message";

  if (parsed.ok) {
    parsedPayload = parsed.payload;
    parsedConfidence = parsed.confidence;
  } else if (parsed.reason === "not_explicit_move_request") {
    const assembled = await tryAssembleMultiMessageMoveIntent({
      chatId: input.chatId,
      triggerText: trimmedText,
      triggerMessageId: input.messageId,
      messageDateUnix: input.messageDateUnix ?? null,
    });
    if (!assembled) {
      return { ok: false, reason: parsed.reason, student };
    }

    // Dedupe: if a pending coach-gated move action already exists for this
    // student + chat in the past few minutes, skip creating another one to
    // avoid surfacing duplicate requests when a burst keeps arriving.
    try {
      const recentPending = await listRecentPendingTrainingPeaksMoveActionsForStudentChat({
        studentId: student.id,
        sourceChatId: input.chatId,
        sinceMinutes: MULTI_MESSAGE_MOVE_INTENT_DEDUPE_MINUTES,
      });
      if (recentPending.length > 0) {
        console.info("Skipping multi-message TrainingPeaks move action — existing pending action present", {
          studentId: student.id,
          chatId: input.chatId,
          messageId: input.messageId,
          existingActionIds: recentPending.map((row) => row.id),
        });
        return { ok: false, reason: "parse_rejected", student };
      }
    } catch (error) {
      console.warn("Failed to dedupe recent pending TrainingPeaks move actions; skipping multi-message creation", {
        studentId: student.id,
        chatId: input.chatId,
        messageId: input.messageId,
        error,
      });
      return { ok: false, reason: "parse_rejected", student };
    }

    parsedPayload = applyMultiMessageMoveIntentCaution({
      parsed: assembled.parsed,
      contextMessageIds: assembled.contextMessageIds,
      contextPreviews: assembled.contextPreviews,
    });
    parsedConfidence = parsedPayload.confidence;
    assemblyKind = "multi_message";
  } else {
    return { ok: false, reason: parsed.reason, student };
  }

  let enrichedParsed = parsedPayload;
  try {
    enrichedParsed = await enrichParsedMovePayloadWithWorkoutInference({
      studentId: student.id,
      rawText: trimmedText,
      parsedPayload: parsedPayload,
      studentTimezone: input.studentTimezone ?? null,
    });
  } catch (error) {
    console.warn("Failed to enrich move workout payload with workout cache inference", {
      studentId: student.id,
      chatId: input.chatId,
      messageId: input.messageId,
      error,
    });
    enrichedParsed = {
      ...parsedPayload,
      warnings: [...(parsedPayload.warnings ?? []), "Не удалось автоматически подобрать исходную тренировку. Нужна ручная проверка."],
    };
  }

  if (assemblyKind === "multi_message") {
    // Re-apply caution metadata in case enrichment dropped or overwrote it.
    const enrichmentLostAssemblyDiagnostics =
      enrichedParsed.parsingDiagnostics?.assemblyKind !== "multi_message";
    if (enrichmentLostAssemblyDiagnostics) {
      enrichedParsed = applyMultiMessageMoveIntentCaution({
        parsed: enrichedParsed,
        contextMessageIds:
          parsedPayload.parsingDiagnostics?.contextMessageIds ?? [],
        contextPreviews:
          parsedPayload.parsingDiagnostics?.contextPreviews ?? [],
      });
    }
    // Confidence cap must always apply after enrichment.
    enrichedParsed = {
      ...enrichedParsed,
      confidence: Math.min(
        enrichedParsed.confidence ?? parsedConfidence ?? 0,
        MULTI_MESSAGE_MOVE_INTENT_CONFIDENCE_CAP
      ),
      needsClarification: true,
    };
  }

  // Greedy-fix: «давайте сделаю <тип> в <день>» where no such workout is in the plan is an ADD
  // request, not a move. Do NOT create a move card pulling an unrelated workout (creating workouts
  // is a separate feature). Silently skip — the student can rephrase or the coach acts manually.
  if (enrichedParsed.moveSituation === "no_such_workout") {
    console.info("Skipping TrainingPeaks move action — no such workout in plan (add request, not move)", {
      studentId: student.id,
      chatId: input.chatId,
      messageId: input.messageId,
    });
    return { ok: false, reason: "no_such_workout_not_a_move", student };
  }

  const action = await createTrainingPeaksActionInRepository({
    studentId: student.id,
    actionType: "move_workout",
    status: "approved",
    executionStatus: "not_started",
    approvedAt: new Date().toISOString(),
    sourceChatId: input.chatId,
    sourceMessageId: input.messageId,
    sourceUserId: input.userId ?? null,
    rawText: trimmedText,
    parsedPayload: {
      ...enrichedParsed,
      parsingDiagnostics: {
        ...(enrichedParsed.parsingDiagnostics ?? {
          parserBaseDateSource: "server_now",
          parserBaseDateIso: "",
          messageTimestampAvailable: false,
        }),
        autoApprovedForDryRun: true,
      },
    },
    confidence: String(enrichedParsed.confidence ?? parsedConfidence ?? 0),
    coachChatId: input.coachChatId ?? null,
  });

  return {
    ok: true,
    action,
    student,
    parsed: enrichedParsed,
  };
}

export function formatTrainingPeaksMoveWorkoutActionSummary(
  payload: ParsedTrainingPeaksMoveWorkoutPayload
): string {
  const previewLine = formatMoveSourceInferencePreviewRu(payload.sourceInferencePreview);
  const base = `move_workout ${formatTrainingPeaksMoveWorkoutTargetSummary(payload.target)}`;
  const assemblyLine =
    payload.parsingDiagnostics?.assemblyKind === "multi_message"
      ? "⚠️ Собрано из нескольких сообщений — проверь источник и день."
      : null;
  return [base, previewLine, assemblyLine].filter(Boolean).join("\n");
}

export async function approveTrainingPeaksAction(
  input: DecideTrainingPeaksActionInput
): Promise<DecideTrainingPeaksActionResultSnapshot> {
  const result = await approveTrainingPeaksActionInRepository({
    actionId: input.actionId,
    decidedByChatId: input.decidedByChatId,
    decidedByUserId: input.decidedByUserId ?? null,
    decisionMessageId: input.decisionMessageId ?? null,
  });
  await recordTrainingPeaksCoachActionDecisionContactEvent(result);
  return result;
}

export async function rejectTrainingPeaksAction(
  input: DecideTrainingPeaksActionInput
): Promise<DecideTrainingPeaksActionResultSnapshot> {
  const result = await rejectTrainingPeaksActionInRepository({
    actionId: input.actionId,
    decidedByChatId: input.decidedByChatId,
    decidedByUserId: input.decidedByUserId ?? null,
    decisionMessageId: input.decisionMessageId ?? null,
  });
  await recordTrainingPeaksCoachActionDecisionContactEvent(result);
  return result;
}

export async function requestTrainingPeaksActionExecution(input: {
  actionId: string;
  requestedByChatId: string;
  requestedByUserId?: string | null;
  requestMessageId?: string | null;
}): Promise<RequestTrainingPeaksActionExecutionResultSnapshot> {
  return requestTrainingPeaksActionExecutionInRepository({
    actionId: input.actionId,
    requestedByChatId: input.requestedByChatId,
    requestedByUserId: input.requestedByUserId ?? null,
    requestMessageId: input.requestMessageId ?? null,
  });
}

export async function requestTrainingPeaksActionDryRunRecheck(input: {
  actionId: string;
  requestedByChatId: string;
}): Promise<RequestTrainingPeaksActionDryRunRecheckResultSnapshot> {
  return requestTrainingPeaksActionDryRunRecheckInRepository({
    actionId: input.actionId,
    requestedByChatId: input.requestedByChatId,
  });
}

export async function confirmTrainingPeaksActionSourceDate(input: {
  actionId: string;
  confirmedByChatId: string;
  confirmedByUserId?: string | null;
  confirmationMessageId?: string | null;
}): Promise<ConfirmTrainingPeaksActionSourceDateResultSnapshot> {
  return confirmTrainingPeaksActionSourceDateInRepository({
    actionId: input.actionId,
    confirmedByChatId: input.confirmedByChatId,
    confirmedByUserId: input.confirmedByUserId ?? null,
    confirmationMessageId: input.confirmationMessageId ?? null,
  });
}

export async function confirmTrainingPeaksActionSourceWorkout(input: {
  actionId: string;
  confirmedByChatId: string;
  confirmedByUserId?: string | null;
  confirmationMessageId?: string | null;
}): Promise<ConfirmTrainingPeaksActionSourceWorkoutResultSnapshot> {
  return confirmTrainingPeaksActionSourceWorkoutInRepository({
    actionId: input.actionId,
    confirmedByChatId: input.confirmedByChatId,
    confirmedByUserId: input.confirmedByUserId ?? null,
    confirmationMessageId: input.confirmationMessageId ?? null,
  });
}

export const extractMoveSourcePickerCandidates = extractMoveSourcePickerCandidatesInRepository;

export async function pickTrainingPeaksActionSourceCandidate(input: {
  actionId: string;
  candidateIndex: number;
  confirmedByChatId: string;
  confirmedByUserId?: string | null;
}): Promise<PickTrainingPeaksActionSourceCandidateResult> {
  return pickTrainingPeaksActionSourceCandidateInRepository({
    actionId: input.actionId,
    candidateIndex: input.candidateIndex,
    confirmedByChatId: input.confirmedByChatId,
    confirmedByUserId: input.confirmedByUserId ?? null,
  });
}

export async function cancelTrainingPeaksActionExecution(input: {
  actionId: string;
  cancelledByChatId: string;
  cancelledByUserId?: string | null;
  cancelMessageId?: string | null;
}): Promise<CancelTrainingPeaksActionExecutionResultSnapshot> {
  return cancelTrainingPeaksActionExecutionInRepository({
    actionId: input.actionId,
    cancelledByChatId: input.cancelledByChatId,
    cancelledByUserId: input.cancelledByUserId ?? null,
    cancelMessageId: input.cancelMessageId ?? null,
  });
}

export async function listRecentTrainingPeaksActions(
  limit = 15
): Promise<TrainingPeaksActionWithStudentSnapshot[]> {
  return listRecentTrainingPeaksActionsFromRepository(limit);
}

export async function listRecentTrainingPeaksActionsWithLatestRunContext(limit = 15): Promise<
  Array<
    TrainingPeaksActionWithStudentSnapshot & {
      latestRunContext: TrainingPeaksActionLatestRunContextSnapshot | null;
    }
  >
> {
  const actions = await listRecentTrainingPeaksActionsFromRepository(limit);
  const latestRunContexts = await listTrainingPeaksActionLatestRunContexts(actions.map((action) => action.id));
  return actions.map((action) => ({
    ...action,
    latestRunContext: latestRunContexts.get(action.id) ?? null,
  }));
}

export async function getTrainingPeaksActionWithStudentById(
  actionId: string
): Promise<TrainingPeaksActionWithStudentSnapshot | null> {
  const action = await getTrainingPeaksActionByIdInRepository(actionId);
  if (!action) {
    return null;
  }
  let studentName: string | null = null;
  if (action.studentId) {
    const student = await getTrainingPeaksStudentByIdFromRepository(action.studentId);
    studentName = student?.studentName ?? null;
  }
  return { ...action, studentName };
}

export async function getTrainingPeaksActionWithStudentAndLatestRunContextById(actionId: string): Promise<
  (TrainingPeaksActionWithStudentSnapshot & {
    latestRunContext: TrainingPeaksActionLatestRunContextSnapshot | null;
  }) | null
> {
  const [action, latestRunContext] = await Promise.all([
    getTrainingPeaksActionWithStudentById(actionId),
    getTrainingPeaksActionLatestRunContext(actionId),
  ]);
  if (!action) {
    return null;
  }
  return {
    ...action,
    latestRunContext,
  };
}

export async function claimOneApprovedTrainingPeaksActionForDryRun(
  claimedBy: string
): Promise<ClaimedTrainingPeaksDryRunActionSnapshot | null> {
  return claimOneApprovedTrainingPeaksActionForDryRunInRepository(claimedBy);
}

export async function createTrainingPeaksActionDryRun(
  actionId: string,
  runnerId: string
): Promise<TrainingPeaksActionRunSnapshot> {
  return createTrainingPeaksActionRunInRepository({
    actionId,
    runType: "dry_run",
    dryRun: true,
    runnerId,
  });
}

export async function completeTrainingPeaksActionDryRun(
  actionId: string,
  input: {
    runId: string;
    logJson?: unknown;
    screenshotBeforePath?: string | null;
    screenshotAfterPath?: string | null;
  }
): Promise<void> {
  return completeTrainingPeaksActionDryRunInRepository(actionId, input);
}

export async function failTrainingPeaksActionDryRun(
  actionId: string,
  input: {
    runId: string;
    errorMessage: string;
    logJson?: unknown;
  }
): Promise<void> {
  return failTrainingPeaksActionDryRunInRepository(actionId, input);
}

export async function recoverStaleTrainingPeaksJobs(timeoutMinutes: number): Promise<number> {
  return recoverStaleTrainingPeaksRunningJobs(timeoutMinutes);
}

export async function recoverStaleTrainingPeaksRaceScanJobs(timeoutMinutes: number): Promise<number> {
  return recoverStaleTrainingPeaksRunningRaceScanJobs(timeoutMinutes);
}

export async function countTrainingPeaksStudentThreadsByStudentIds(
  studentIds: string[]
): Promise<Map<string, number>> {
  return countTrainingPeaksStudentThreadsByStudentIdsFromRepository(studentIds);
}

export async function listTrainingPeaksStudentContactStatus(): Promise<TrainingPeaksStudentContactStatus[]> {
  return listTrainingPeaksStudentContactStatusFromRepository();
}

export async function getTrainingPeaksStudentsRegistryWithLatestReportStatus(options?: {
  includeArchived?: boolean;
}): Promise<TrainingPeaksRegistryStudentSnapshot[]> {
  const [students, reports] = await Promise.all([
    options?.includeArchived ? listTrainingPeaksStudentsIncludingArchived() : listTrainingPeaksStudents(),
    listAllTrainingPeaksReports(),
  ]);
  const latestByStudent = getLatestReportByStudent(reports);
  const groupTopicCountByStudentId = await countTrainingPeaksStudentThreadsByStudentIdsFromRepository(
    students.map((student) => student.id)
  );

  return students
    .map((student) => {
      const latestReport = latestByStudent.get(student.studentId) ?? null;
      const groupTopicCount = groupTopicCountByStudentId.get(student.id) ?? 0;

      return {
        id: student.id,
        studentId: student.studentId,
        studentName: student.studentName,
        trainingPeaksAthleteUrl: student.trainingPeaksAthleteUrl,
        isActive: student.isActive,
        weeklyReportEnabled: student.weeklyReportEnabled,
        archivedAt: student.archivedAt,
        telegramChatId: student.telegramChatId,
        telegramUsername: student.telegramUsername,
        telegramProfileUrl: student.telegramProfileUrl,
        telegramDeliveryEnabled: student.telegramDeliveryEnabled,
        telegramFormality: student.telegramFormality,
        telegramContextNotes: student.telegramContextNotes,
        dataQualityStatus: student.dataQualityStatus,
        notes: student.notes,
        createdAt: student.createdAt,
        updatedAt: student.updatedAt,
        latestWeekFrom: latestReport?.weekFrom ?? null,
        latestWeekTo: latestReport?.weekTo ?? null,
        latestReportStatus: getRegistryStudentStatus(latestReport),
        hasGroupTopic: groupTopicCount > 0,
        groupTopicCount,
      };
    })
    .sort((left, right) => left.studentName.localeCompare(right.studentName, "ru"));
}

export async function getTrainingPeaksStudentCard(
  studentQuery: string
): Promise<TrainingPeaksStudentCard> {
  return resolveTrainingPeaksRegistryStudent(studentQuery);
}

export async function getTrainingPeaksStudentCardByInternalId(
  id: string
): Promise<TrainingPeaksRegistryStudentSnapshot | null> {
  return getTrainingPeaksRegistryStudentByInternalId(id);
}

export async function getTrainingPeaksStudentById(studentId: string): Promise<TrainingPeaksStudent | null> {
  return getTrainingPeaksStudentByIdFromRepository(studentId);
}

export async function getTrainingPeaksStudentByStudentId(
  studentId: string
): Promise<TrainingPeaksStudent | null> {
  return getTrainingPeaksStudentByStudentIdFromRepository(studentId);
}

export async function listStudentThreads(
  studentId: string
): Promise<TrainingPeaksStudentThreadSnapshot[]> {
  return listTrainingPeaksStudentThreadsFromRepository(studentId);
}

export async function getTrainingPeaksStudentThreadByChatThread(
  telegramChatId: string,
  telegramMessageThreadId: number
): Promise<TrainingPeaksStudentThreadSnapshot | null> {
  return getTrainingPeaksStudentThreadByChatThreadFromRepository(
    telegramChatId,
    telegramMessageThreadId
  );
}

export async function getTrainingPeaksThreadInfo(input: {
  telegramChatId: string;
  telegramMessageThreadId: number;
  chatTitle?: string | null;
  threadTitle?: string | null;
}): Promise<TrainingPeaksThreadInfo> {
  const thread = await getTrainingPeaksStudentThreadByChatThreadFromRepository(
    input.telegramChatId,
    input.telegramMessageThreadId
  );

  if (!thread) {
    return {
      linked: false,
      chatId: input.telegramChatId,
      messageThreadId: input.telegramMessageThreadId,
      chatTitle: input.chatTitle ?? null,
      threadTitle: input.threadTitle ?? null,
    };
  }

  const student = await getTrainingPeaksRegistryStudentByInternalId(thread.studentId, {
    includeArchived: true,
  });

  return {
    linked: true,
    chatId: thread.telegramChatId,
    messageThreadId: thread.telegramMessageThreadId,
    chatTitle: thread.chatTitle ?? input.chatTitle ?? null,
    threadTitle: thread.threadTitle ?? input.threadTitle ?? null,
    thread,
    student,
  };
}

export async function linkTrainingPeaksStudentThread(input: {
  studentQuery: string;
  telegramChatId: string;
  telegramMessageThreadId: number;
  chatTitle?: string | null;
  threadTitle?: string | null;
  linkedByUserId: string;
}): Promise<LinkTrainingPeaksStudentThreadResult> {
  const match = await resolveTrainingPeaksRegistryStudent(input.studentQuery);

  if (match.kind === "not_found") {
    return {
      ok: false,
      reason: "student_not_found",
      message: `Ученик "${input.studentQuery}" не найден.\nПосмотри список: /tp_students`,
    };
  }

  if (match.kind === "ambiguous") {
    return {
      ok: false,
      reason: "student_ambiguous",
      message: `Нашлось несколько учеников: ${match.matches.map((entry) => entry.studentName).join(", ")}. Уточни имя или slug.`,
      matches: match.matches,
    };
  }

  if (match.student.archivedAt) {
    return {
      ok: false,
      reason: "student_archived",
      message: "Нельзя привязать тему к архивному ученику.",
    };
  }

  if (!match.student.isActive) {
    return {
      ok: false,
      reason: "student_inactive",
      message: "Нельзя привязать тему к неактивному ученику.",
    };
  }

  const existingThread = await getTrainingPeaksStudentThreadByChatThreadFromRepository(
    input.telegramChatId,
    input.telegramMessageThreadId
  );

  if (existingThread) {
    if (existingThread.studentId !== match.student.id) {
      const existingStudent = await getTrainingPeaksRegistryStudentByInternalId(existingThread.studentId, {
        includeArchived: true,
      });

      return {
        ok: false,
        reason: "linked_to_other_student",
        message: "Эта тема уже привязана к другому ученику. Сначала отправь /tp_unlink_thread в этой теме.",
        thread: existingThread,
        existingStudent,
      };
    }

    const updatedThread =
      (await updateTrainingPeaksStudentThreadById(existingThread.id, {
        chatTitle: input.chatTitle ?? null,
        threadTitle: input.threadTitle ?? null,
        linkedByUserId: input.linkedByUserId,
      })) ?? existingThread;

    return {
      ok: true,
      kind: "already_linked",
      thread: updatedThread,
      student: match.student,
    };
  }

  try {
    const thread = await insertTrainingPeaksStudentThread({
      studentId: match.student.id,
      telegramChatId: input.telegramChatId,
      telegramMessageThreadId: input.telegramMessageThreadId,
      chatTitle: input.chatTitle ?? null,
      threadTitle: input.threadTitle ?? null,
      linkedByUserId: input.linkedByUserId,
    });

    return {
      ok: true,
      kind: "linked",
      thread,
      student: match.student,
    };
  } catch (error) {
    if (error instanceof TrainingPeaksStudentThreadConflictError) {
      const conflictedThread = await getTrainingPeaksStudentThreadByChatThreadFromRepository(
        input.telegramChatId,
        input.telegramMessageThreadId
      );

      if (conflictedThread?.studentId === match.student.id) {
        return {
          ok: true,
          kind: "already_linked",
          thread: conflictedThread,
          student: match.student,
        };
      }

      const existingStudent = conflictedThread
        ? await getTrainingPeaksRegistryStudentByInternalId(conflictedThread.studentId, {
            includeArchived: true,
          })
        : null;

      return {
        ok: false,
        reason: "linked_to_other_student",
        message: "Эта тема уже привязана к другому ученику. Сначала отправь /tp_unlink_thread в этой теме.",
        thread:
          conflictedThread ??
          ({
            id: "",
            studentId: "",
            telegramChatId: input.telegramChatId,
            telegramMessageThreadId: input.telegramMessageThreadId,
            chatTitle: input.chatTitle ?? null,
            threadTitle: input.threadTitle ?? null,
            linkedByUserId: input.linkedByUserId,
            createdAt: "",
            updatedAt: "",
          } satisfies TrainingPeaksStudentThreadSnapshot),
        existingStudent,
      };
    }

    throw error;
  }
}

export async function unlinkTrainingPeaksStudentThread(input: {
  telegramChatId: string;
  telegramMessageThreadId: number;
}): Promise<UnlinkTrainingPeaksStudentThreadResult> {
  const existingThread = await getTrainingPeaksStudentThreadByChatThreadFromRepository(
    input.telegramChatId,
    input.telegramMessageThreadId
  );

  if (!existingThread) {
    return {
      ok: false,
      reason: "not_linked",
      message: "Эта тема пока не привязана.",
    };
  }

  const student = await getTrainingPeaksRegistryStudentByInternalId(existingThread.studentId, {
    includeArchived: true,
  });
  const deletedThread = await deleteTrainingPeaksStudentThreadById(existingThread.id);

  return {
    ok: true,
    thread: deletedThread ?? existingThread,
    student,
  };
}

export async function disableTrainingPeaksStudent(
  studentQuery: string
): Promise<DisableTrainingPeaksStudentResult> {
  const match = await resolveTrainingPeaksRegistryStudent(studentQuery);

  if (match.kind !== "student") {
    return match;
  }

  const student = await disableTrainingPeaksStudentById(match.student.id);

  return {
    kind: "student",
    student,
  };
}

export async function disableTrainingPeaksStudentByInternalId(
  id: string
): Promise<TrainingPeaksRegistryStudentSnapshot | null> {
  const existingStudent = await getTrainingPeaksRegistryStudentByInternalId(id, {
    includeArchived: true,
  });

  if (!existingStudent) {
    return null;
  }

  await disableTrainingPeaksStudentById(id);
  return getTrainingPeaksRegistryStudentByInternalId(id, {
    includeArchived: true,
  });
}

export async function enableTrainingPeaksStudent(
  studentQuery: string
): Promise<EnableTrainingPeaksStudentResult> {
  const match = await resolveTrainingPeaksRegistryStudent(studentQuery);

  if (match.kind !== "student") {
    return match;
  }

  const student = await enableTrainingPeaksStudentById(match.student.id);

  return {
    kind: "student",
    student,
  };
}

export async function enableTrainingPeaksStudentByInternalId(
  id: string
): Promise<TrainingPeaksRegistryStudentSnapshot | null> {
  const existingStudent = await getTrainingPeaksRegistryStudentByInternalId(id, {
    includeArchived: true,
  });

  if (!existingStudent) {
    return null;
  }

  await enableTrainingPeaksStudentById(id);
  return getTrainingPeaksRegistryStudentByInternalId(id, {
    includeArchived: true,
  });
}

export async function getTrainingPeaksReportMarkdown(
  studentQuery: string,
  week?: TrainingPeaksWeek
): Promise<string | null> {
  const report = await getTrainingPeaksReportSnapshot(studentQuery, week);
  return report?.reportMarkdown ?? null;
}

export async function getTrainingPeaksReportSnapshot(
  studentQuery: string,
  week?: TrainingPeaksWeek
): Promise<TrainingPeaksReportSnapshot | null> {
  const reports = await listAllTrainingPeaksReports();
  const filteredReports = week
    ? reports.filter((report) => report.weekFrom === week.weekFrom && report.weekTo === week.weekTo)
    : reports;
  const report = pickMatchingStudentReport(filteredReports, studentQuery);
  const reportMarkdown = report?.reportMarkdown?.trim();

  if (!report || !reportMarkdown) {
    return null;
  }

  return {
    studentId: report.studentId,
    studentName: report.studentName,
    weekFrom: report.weekFrom,
    weekTo: report.weekTo,
    reportMarkdown,
  };
}

export async function getTrainingPeaksLatestReportSnapshotByInternalId(
  id: string
): Promise<TrainingPeaksReportSnapshot | null> {
  const student = await getTrainingPeaksRegistryStudentByInternalId(id);

  if (!student) {
    return null;
  }

  return getTrainingPeaksReportSnapshot(student.studentId);
}

export async function updateTrainingPeaksStudentTelegramContactByInternalId(
  id: string,
  input: UpdateTrainingPeaksStudentTelegramContactInput
): Promise<TrainingPeaksRegistryStudentSnapshot | null> {
  const existingStudent = await getTrainingPeaksStudentByIdFromRepository(id);

  if (!existingStudent) {
    return null;
  }

  await updateTrainingPeaksStudentTelegramContactById(id, input);
  return getTrainingPeaksRegistryStudentByInternalId(id);
}

export async function updateTrainingPeaksStudentTelegramContact(
  studentId: string,
  input: UpdateTrainingPeaksStudentTelegramContactParams
): Promise<TrainingPeaksStudent | null> {
  const existingStudent = await getTrainingPeaksStudentByIdFromRepository(studentId);

  if (!existingStudent) {
    return null;
  }

  return updateTrainingPeaksStudentTelegramContactInRepository(studentId, input);
}

export async function updateTrainingPeaksStudentTelegramContextByInternalId(
  id: string,
  input: UpdateTrainingPeaksStudentTelegramContextInput
): Promise<TrainingPeaksRegistryStudentSnapshot | null> {
  const existingStudent = await getTrainingPeaksStudentByIdFromRepository(id);

  if (!existingStudent) {
    return null;
  }

  await updateTrainingPeaksStudentTelegramContextById(id, input);
  return getTrainingPeaksRegistryStudentByInternalId(id, {
    includeArchived: true,
  });
}

export async function listTrainingPeaksStudentTelegramContextObservations(
  studentId: string,
  limit = 10
) {
  return listTrainingPeaksTelegramContextObservationsForStudent(studentId, limit);
}

export async function getTrainingPeaksWeeklyReportByInternalId(
  id: string
): Promise<TrainingPeaksWeeklyReport | null> {
  return getTrainingPeaksWeeklyReportById(id);
}

export async function updateTrainingPeaksWeeklyReportStateByInternalId(
  id: string,
  input: UpdateTrainingPeaksWeeklyReportStateInput
): Promise<TrainingPeaksWeeklyReport | null> {
  const existingReport = await getTrainingPeaksWeeklyReportById(id);

  if (!existingReport) {
    return null;
  }

  return updateTrainingPeaksWeeklyReportStateById(id, input);
}

export async function updateTrainingPeaksWeeklyReportContentByInternalId(
  id: string,
  input: UpdateTrainingPeaksWeeklyReportContentInput
): Promise<TrainingPeaksWeeklyReport | null> {
  const existingReport = await getTrainingPeaksWeeklyReportById(id);

  if (!existingReport) {
    return null;
  }

  return updateTrainingPeaksWeeklyReportContentById(id, input);
}

export async function deleteTrainingPeaksOrphanReportsForWeek(
  weekFrom: string,
  weekTo: string
): Promise<
  | {
      ok: true;
      deletedCount: number;
      weekFrom: string;
      weekTo: string;
    }
  | {
      ok: false;
      message: string;
    }
> {
  if (!ISO_DATE_PATTERN.test(weekFrom) || !ISO_DATE_PATTERN.test(weekTo)) {
    return {
      ok: false,
      message: "Некорректный диапазон недели.",
    };
  }

  const deletedCount = await deleteTrainingPeaksOrphanReportsForWeekInRepository(weekFrom, weekTo);

  return {
    ok: true,
    deletedCount,
    weekFrom,
    weekTo,
  };
}

export async function deleteTrainingPeaksOrphanReportByInternalId(
  id: string
): Promise<
  | {
      ok: true;
      report: TrainingPeaksWeeklyReport;
    }
  | {
      ok: false;
      message: string;
    }
> {
  const report = await getTrainingPeaksWeeklyReportById(id);

  if (!report) {
    return {
      ok: false,
      message: "Отчёт не найден.",
    };
  }

  const student = await getTrainingPeaksStudentByStudentIdFromRepository(report.studentId);

  if (student) {
    return {
      ok: false,
      message: "Можно удалить только orphan-отчёт, если ученика нет в реестре.",
    };
  }

  const deletedReport = await deleteTrainingPeaksWeeklyReportById(id);

  if (!deletedReport) {
    return {
      ok: false,
      message: "Отчёт не найден.",
    };
  }

  return {
    ok: true,
    report: deletedReport,
  };
}

export async function updateTrainingPeaksWeeklyReportReviewState(
  reportId: string,
  input: UpdateTrainingPeaksWeeklyReportReviewStateInput
): Promise<TrainingPeaksWeeklyReport | null> {
  const existingReport = await getTrainingPeaksWeeklyReportById(reportId);

  if (!existingReport) {
    return null;
  }

  return updateTrainingPeaksWeeklyReportReviewStateInRepository(reportId, input);
}

export async function approveTrainingPeaksWeeklyReportDraftByInternalId(
  id: string
): Promise<TrainingPeaksWeeklyReport | null> {
  return approveTrainingPeaksWeeklyReportIfDraft(id);
}

export async function claimTrainingPeaksWeeklyReportForSend(
  reportId: string
): Promise<TrainingPeaksWeeklyReport | null> {
  return claimTrainingPeaksWeeklyReportForSendInRepository(reportId);
}
