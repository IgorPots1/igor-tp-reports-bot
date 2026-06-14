import {
  classifyCoachOperationalSignal,
  isNonTrainingErrandWithoutTrainingImpact,
  isSoftSessionQuestionWithoutHardConstraint,
  isStrengthOnlyReshuffleWithoutRun,
  isScheduleSignalType,
} from "@/features/trainingpeaks/coach-operational-signals";
import {
  extractStructuredPayloadDates,
  hasPartialStaleScheduleDates,
} from "@/features/trainingpeaks/tp-signals-persisted-cleanup";
import type { TrainingPeaksStudentOperationalSignal } from "@/features/trainingpeaks/repository";
import {
  isOperationalNegativeObservationText,
  resolveEffectiveOperationalSignalForDisplay,
} from "@/features/trainingpeaks/service";

export const TP_SIGNALS_NONRUN_CONSTRAINT_CLEANUP_CONFIRM =
  "APPLY TP SIGNAL NONRUN CONSTRAINT CLEANUP";

export const TP_SIGNALS_PHASE3_NONRUN_CLEANUP_SOURCE =
  "tp_signals_phase3_nonrun_constraint_cleanup";

export const TP_SIGNALS_PHASE3_COMMIT = "df42d96";

export type NonRunConstraintCleanupClassification =
  | "strength_only_reshuffle"
  | "soft_session_question"
  | "non_training_errand";

export type NonRunConstraintCleanupEligibility = "eligible" | "not_eligible" | "not_safe";

export type NonRunConstraintCleanupCandidate = {
  student: string;
  signal_id: string;
  signal_type: string;
  current_status: string;
  source_observation_id: string | null;
  source_preview: string;
  classification: NonRunConstraintCleanupClassification | null;
  eligibility: NonRunConstraintCleanupEligibility;
  proposed_action: "dismiss" | "no_action";
  cleanup_reason: string | null;
  safety_guards_passed: string[];
  safety_guards_failed: string[];
};

const PLAN_CONSTRAINT_SIGNAL_TYPES = new Set(["plan_generation_constraint"]);

const PROTECTED_HEALTH_SIGNAL_TYPES = new Set([
  "health_issue_started",
  "health_issue_improving",
  "health_issue_resolved",
  "pain_injury",
  "resume_training",
]);

export const KNOWN_NONRUN_CONSTRAINT_TARGETS = [
  {
    studentName: "Katerina Melnikova",
    signalIdPrefix: "29bcac43",
    expectedClassification: "strength_only_reshuffle" as const,
  },
  {
    studentName: "Sofia Vlasova",
    signalIdPrefix: null,
    expectedClassification: "soft_session_question" as const,
  },
  {
    studentName: "grigori bereznoi",
    signalIdPrefix: null,
    expectedClassification: "non_training_errand" as const,
  },
] as const;

function recordGuard(
  passed: string[],
  failed: string[],
  label: string,
  ok: boolean
): void {
  if (ok) {
    passed.push(label);
    return;
  }
  failed.push(label);
}

export function classifyPhase3NonRunSuppressionClass(
  sourceText: string
): NonRunConstraintCleanupClassification | null {
  if (isStrengthOnlyReshuffleWithoutRun(sourceText)) {
    return "strength_only_reshuffle";
  }
  if (isSoftSessionQuestionWithoutHardConstraint(sourceText)) {
    return "soft_session_question";
  }
  if (isNonTrainingErrandWithoutTrainingImpact(sourceText)) {
    return "non_training_errand";
  }
  return null;
}

function hasFutureActionableScheduleDates(input: {
  structuredPayload: Record<string, unknown>;
  asOfDate: string;
}): boolean {
  const dates = extractStructuredPayloadDates(input.structuredPayload);
  return (
    dates.planned_training_dates.some((date) => date >= input.asOfDate) ||
    dates.unavailable_dates.some((date) => date >= input.asOfDate)
  );
}

function forwardClassifierStillCapturesScheduleConstraint(sourceText: string): boolean {
  const classification = classifyCoachOperationalSignal({
    textPreview: sourceText,
    observedAt: "2026-06-13T09:00:00.000Z",
    sourceType: "telegram_message",
    labels: [],
    metadata: {},
    studentId: "fixture-student",
  });
  return (
    classification.primary_bucket === "operational_signal" &&
    classification.signal_type !== null &&
    isScheduleSignalType(classification.signal_type)
  );
}

export function classifyNonRunConstraintCleanupEligibility(input: {
  signal: TrainingPeaksStudentOperationalSignal;
  studentName: string;
  sourceSnippet: string | null;
  asOfDate: string;
}): NonRunConstraintCleanupCandidate {
  const effective = resolveEffectiveOperationalSignalForDisplay(input.signal);
  const passed: string[] = [];
  const failed: string[] = [];
  const base = {
    student: input.studentName,
    signal_id: input.signal.id,
    signal_type: effective.effectiveSignalType,
    current_status: input.signal.status,
    source_observation_id: input.signal.sourceObservationId,
    source_preview: input.sourceSnippet?.trim() ?? "",
    classification: null as NonRunConstraintCleanupClassification | null,
    eligibility: "not_eligible" as NonRunConstraintCleanupEligibility,
    proposed_action: "no_action" as const,
    cleanup_reason: null as string | null,
    safety_guards_passed: passed,
    safety_guards_failed: failed,
  };

  recordGuard(passed, failed, "status_active", input.signal.status === "active");
  if (input.signal.status !== "active") {
    return {
      ...base,
      eligibility: "not_eligible",
      safety_guards_passed: passed,
      safety_guards_failed: failed,
    };
  }

  recordGuard(
    passed,
    failed,
    "signal_type_plan_generation_constraint",
    PLAN_CONSTRAINT_SIGNAL_TYPES.has(effective.effectiveSignalType)
  );
  if (!PLAN_CONSTRAINT_SIGNAL_TYPES.has(effective.effectiveSignalType)) {
    return {
      ...base,
      eligibility: "not_eligible",
      safety_guards_passed: passed,
      safety_guards_failed: failed,
    };
  }

  recordGuard(
    passed,
    failed,
    "not_protected_health_signal",
    !PROTECTED_HEALTH_SIGNAL_TYPES.has(effective.effectiveSignalType)
  );
  if (PROTECTED_HEALTH_SIGNAL_TYPES.has(effective.effectiveSignalType)) {
    return {
      ...base,
      eligibility: "not_safe",
      safety_guards_passed: passed,
      safety_guards_failed: failed,
    };
  }

  recordGuard(
    passed,
    failed,
    "lifecycle_not_resolved",
    input.signal.lifecycleState !== "resolved"
  );
  if (input.signal.lifecycleState === "resolved") {
    return {
      ...base,
      eligibility: "not_eligible",
      safety_guards_passed: passed,
      safety_guards_failed: failed,
    };
  }

  const sourceText = input.sourceSnippet?.trim() ?? "";
  recordGuard(passed, failed, "source_text_available", sourceText.length > 0);
  if (!sourceText) {
    return {
      ...base,
      eligibility: "not_safe",
      safety_guards_passed: passed,
      safety_guards_failed: failed,
    };
  }

  recordGuard(
    passed,
    failed,
    "no_negative_health_evidence",
    !isOperationalNegativeObservationText(sourceText)
  );
  if (isOperationalNegativeObservationText(sourceText)) {
    return {
      ...base,
      eligibility: "not_safe",
      safety_guards_passed: passed,
      safety_guards_failed: failed,
    };
  }

  const classification = classifyPhase3NonRunSuppressionClass(sourceText);
  recordGuard(passed, failed, "phase3_nonrun_suppression_class", classification !== null);
  if (!classification) {
    return {
      ...base,
      eligibility: "not_eligible",
      safety_guards_passed: passed,
      safety_guards_failed: failed,
    };
  }

  const partialStale = hasPartialStaleScheduleDates(input.signal.structuredPayload, input.asOfDate);
  recordGuard(passed, failed, "no_partial_stale_schedule_dates", !partialStale);
  if (partialStale) {
    return {
      ...base,
      classification,
      eligibility: "not_safe",
      safety_guards_passed: passed,
      safety_guards_failed: failed,
    };
  }

  const futureActionable = hasFutureActionableScheduleDates({
    structuredPayload: input.signal.structuredPayload,
    asOfDate: input.asOfDate,
  });
  recordGuard(passed, failed, "no_future_actionable_schedule_dates", !futureActionable);
  if (futureActionable) {
    return {
      ...base,
      classification,
      eligibility: "not_safe",
      safety_guards_passed: passed,
      safety_guards_failed: failed,
    };
  }

  const forwardStillCaptures = forwardClassifierStillCapturesScheduleConstraint(sourceText);
  recordGuard(
    passed,
    failed,
    "forward_classifier_no_longer_captures_schedule_constraint",
    !forwardStillCaptures
  );
  if (forwardStillCaptures) {
    return {
      ...base,
      classification,
      eligibility: "not_safe",
      safety_guards_passed: passed,
      safety_guards_failed: failed,
    };
  }

  return {
    ...base,
    source_preview: sourceText,
    classification,
    eligibility: "eligible",
    proposed_action: "dismiss",
    cleanup_reason: `phase3_nonrun_false_positive:${classification}`,
    safety_guards_passed: passed,
    safety_guards_failed: failed,
  };
}

export function buildNonRunConstraintCleanupMetadata(input: {
  existing: unknown;
  candidate: NonRunConstraintCleanupCandidate;
  previousStatus: string;
}): Record<string, unknown> {
  const existing =
    input.existing && typeof input.existing === "object" && !Array.isArray(input.existing)
      ? (input.existing as Record<string, unknown>)
      : {};
  return {
    ...existing,
    nonrun_constraint_cleanup_applied_at: new Date().toISOString(),
    cleanup_reason: input.candidate.cleanup_reason,
    cleanup_source: TP_SIGNALS_PHASE3_NONRUN_CLEANUP_SOURCE,
    previous_status: input.previousStatus,
    source_observation_id: input.candidate.source_observation_id,
    phase3_commit: TP_SIGNALS_PHASE3_COMMIT,
    nonrun_constraint_cleanup_classification: input.candidate.classification,
  };
}

export function formatNonRunConstraintCleanupReportMarkdown(input: {
  generatedAt: string;
  asOfDate: string;
  signalId: string | null;
  mode: "dry-run" | "apply";
  candidates: NonRunConstraintCleanupCandidate[];
  scannedCount: number;
  wouldWriteCount: number;
  actualWrittenCount: number;
  reportDir: string;
}): string {
  const eligible = input.candidates.filter((item) => item.eligibility === "eligible");
  const notSafe = input.candidates.filter((item) => item.eligibility === "not_safe");
  const notEligible = input.candidates.filter((item) => item.eligibility === "not_eligible");

  const lines = [
    "# TP Signals Non-Run Constraint Cleanup",
    "",
    `- generated_at: ${input.generatedAt}`,
    `- as_of_date: ${input.asOfDate}`,
    `- mode: ${input.mode}`,
    `- signal_id_filter: ${input.signalId ?? "(none)"}`,
    `- report_dir: ${input.reportDir}`,
    "",
    "## Counts",
    "",
    `- total_active_plan_constraints_scanned: ${input.scannedCount}`,
    `- eligible: ${eligible.length}`,
    `- not_safe: ${notSafe.length}`,
    `- not_eligible: ${notEligible.length}`,
    `- would_write: ${input.wouldWriteCount}`,
    `- actual_written: ${input.actualWrittenCount}`,
    "",
    "## Safety",
    "",
    "- No Telegram sends.",
    "- No TrainingPeaks mutations.",
    "- No row deletes.",
    "- Pain/illness/return rows are never auto-closed.",
    "- Apply requires exact confirm string and only updates active rows.",
    "",
    "## Target rows",
    "",
  ];

  if (input.candidates.length === 0) {
    lines.push("_None scanned._");
  } else {
    for (const item of input.candidates) {
      lines.push(`### ${item.student} | ${item.signal_id}`);
      lines.push("");
      lines.push(`- classification: ${item.classification ?? "(none)"}`);
      lines.push(`- source_observation_id: ${item.source_observation_id ?? "(missing)"}`);
      lines.push(`- source_preview: ${item.source_preview.slice(0, 180) || "(empty)"}`);
      lines.push(`- eligibility: ${item.eligibility}`);
      lines.push(`- proposed_action: ${item.proposed_action}`);
      lines.push(`- cleanup_reason: ${item.cleanup_reason ?? "(none)"}`);
      lines.push(`- guards_passed: ${item.safety_guards_passed.join(", ") || "(none)"}`);
      lines.push(`- guards_failed: ${item.safety_guards_failed.join(", ") || "(none)"}`);
      lines.push("");
    }
  }

  return `${lines.join("\n")}\n`;
}
