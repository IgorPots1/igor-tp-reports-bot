import {
  isNonTrainingAdministrativeIntentText,
  isWeatherOrTemperatureSoftContextText,
} from "@/features/trainingpeaks/coach-operational-signals";
import type { TrainingPeaksStudentOperationalSignal } from "@/features/trainingpeaks/repository";
import {
  isExpiredScheduleOperationalSignal,
  isOperationalNegativeObservationText,
  resolveEffectiveOperationalSignalForDisplay,
  resolveOperationalSignalDisplaySummary,
} from "@/features/trainingpeaks/service";

export const TP_SIGNALS_PERSISTED_CLEANUP_CONFIRM = "APPLY TP SIGNALS CLEANUP";

export type PersistedCleanupEligibility = "eligible" | "not_eligible" | "partial_only";

export type PersistedCleanupReason =
  | "false_positive_billing_admin"
  | "false_positive_weather_soft_context"
  | "expired_schedule_constraint"
  | "partial_stale_dates"
  | "not_safe";

export type PersistedCleanupRecommendedAction =
  | "consume"
  | "hide"
  | "no_action"
  | "partial_report_only";

export type PersistedCleanupCandidate = {
  student: string;
  signal_id: string;
  signal_type: string;
  category: string;
  current_status: string;
  current_lifecycle_state: string | null;
  visible_summary: string;
  source_observation_id: string | null;
  source_snippet: string;
  structured_payload_dates: {
    planned_training_dates: string[];
    unavailable_dates: string[];
    valid_until: string | null;
  };
  eligibility: PersistedCleanupEligibility;
  recommended_action: PersistedCleanupRecommendedAction;
  reason: PersistedCleanupReason;
  safety_notes: string[];
};

const SCHEDULE_OR_CONSTRAINT_SIGNAL_TYPES = new Set([
  "schedule_unavailability_window",
  "schedule_availability_window",
  "plan_generation_constraint",
]);

const PROTECTED_HEALTH_SIGNAL_TYPES = new Set([
  "health_issue_started",
  "health_issue_improving",
  "health_issue_resolved",
  "pain_injury",
  "resume_training",
]);

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : null))
    .filter((item): item is string => Boolean(item));
}

function normalizeRecordString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function extractStructuredPayloadDates(
  structuredPayload: Record<string, unknown>
): PersistedCleanupCandidate["structured_payload_dates"] {
  return {
    planned_training_dates: normalizeStringArray(structuredPayload.planned_training_dates),
    unavailable_dates: normalizeStringArray(structuredPayload.unavailable_dates),
    valid_until:
      normalizeRecordString(structuredPayload.valid_until) ?? null,
  };
}

export function hasPartialStaleScheduleDates(
  structuredPayload: Record<string, unknown>,
  asOfDate: string
): boolean {
  const plannedDates = normalizeStringArray(structuredPayload.planned_training_dates);
  const unavailableDates = normalizeStringArray(structuredPayload.unavailable_dates);
  const resolvedDates = normalizeStringArray(structuredPayload.resolved_available_dates);

  const hasPastPlanned = plannedDates.some((date) => date < asOfDate);
  const hasFuturePlanned = plannedDates.some((date) => date >= asOfDate);
  const hasPastUnavailable = unavailableDates.some((date) => date < asOfDate);
  const hasFutureUnavailable = unavailableDates.some((date) => date >= asOfDate);
  const hasPastResolved = resolvedDates.some((date) => date < asOfDate);
  const hasFutureResolved = resolvedDates.some((date) => date >= asOfDate);

  if (hasPastPlanned && hasFuturePlanned) {
    return true;
  }
  if (hasPastUnavailable && hasFutureUnavailable) {
    return true;
  }
  if (hasPastUnavailable && hasFuturePlanned) {
    return true;
  }
  if (hasPastPlanned && hasFutureUnavailable) {
    return true;
  }
  if (hasPastResolved && hasFutureResolved) {
    return true;
  }
  return false;
}

function isScheduleOrConstraintSignalType(signalType: string): boolean {
  return SCHEDULE_OR_CONSTRAINT_SIGNAL_TYPES.has(signalType);
}

function isProtectedHealthSignalType(signalType: string): boolean {
  return PROTECTED_HEALTH_SIGNAL_TYPES.has(signalType);
}

function resolveSourceTextForClassification(input: {
  sourceSnippet: string | null;
  visibleSummary: string | null;
}): string | null {
  const source = input.sourceSnippet?.trim() ?? "";
  if (source) {
    return source;
  }
  return input.visibleSummary?.trim() || null;
}

function resolveCleanupCategory(signalType: string): string {
  if (isScheduleOrConstraintSignalType(signalType)) {
    return "schedule_or_constraint";
  }
  if (signalType === "pause_training") {
    return "pause_training";
  }
  if (isProtectedHealthSignalType(signalType)) {
    return "health_or_return";
  }
  return "other";
}

function buildCandidateBase(input: {
  signal: TrainingPeaksStudentOperationalSignal;
  studentName: string;
  sourceSnippet: string | null;
}): Omit<
  PersistedCleanupCandidate,
  "eligibility" | "recommended_action" | "reason" | "safety_notes"
> {
  const effective = resolveEffectiveOperationalSignalForDisplay(input.signal);
  const visibleSummary =
    resolveOperationalSignalDisplaySummary(input.signal) ??
    effective.effectiveDisplaySummary ??
    "";
  return {
    student: input.studentName,
    signal_id: input.signal.id,
    signal_type: effective.effectiveSignalType,
    category: resolveCleanupCategory(effective.effectiveSignalType),
    current_status: input.signal.status,
    current_lifecycle_state: input.signal.lifecycleState,
    visible_summary: visibleSummary,
    source_observation_id: input.signal.sourceObservationId,
    source_snippet: input.sourceSnippet?.trim() ?? "",
    structured_payload_dates: extractStructuredPayloadDates(input.signal.structuredPayload),
  };
}

export function classifyPersistedSignalCleanupEligibility(input: {
  signal: TrainingPeaksStudentOperationalSignal;
  studentName: string;
  sourceSnippet: string | null;
  asOfDate: string;
  referenceObservedAt?: string | null;
}): PersistedCleanupCandidate {
  const base = buildCandidateBase(input);
  const safetyNotes: string[] = [];
  const effective = resolveEffectiveOperationalSignalForDisplay(input.signal);

  if (input.signal.status !== "active") {
    return {
      ...base,
      eligibility: "not_eligible",
      recommended_action: "no_action",
      reason: "not_safe",
      safety_notes: [`Signal status is ${input.signal.status}; only active rows are eligible.`],
    };
  }

  if (input.signal.lifecycleState === "resolved") {
    return {
      ...base,
      eligibility: "not_eligible",
      recommended_action: "no_action",
      reason: "not_safe",
      safety_notes: ["Resolved lifecycle rows are never auto-cleaned."],
    };
  }

  if (isProtectedHealthSignalType(effective.effectiveSignalType)) {
    return {
      ...base,
      eligibility: "not_eligible",
      recommended_action: "no_action",
      reason: "not_safe",
      safety_notes: [
        `${effective.effectiveSignalType} is protected; pain/illness/return rows require coach close.`,
      ],
    };
  }

  if (effective.effectiveSignalType === "pause_training") {
    safetyNotes.push("pause_training rows are conservative-blocked unless whole-row schedule expiry is explicit.");
  }

  const sourceText = resolveSourceTextForClassification({
    sourceSnippet: input.sourceSnippet,
    visibleSummary: base.visible_summary,
  });

  if (sourceText && isOperationalNegativeObservationText(sourceText)) {
    return {
      ...base,
      eligibility: "not_eligible",
      recommended_action: "no_action",
      reason: "not_safe",
      safety_notes: ["Source text contains negative health evidence."],
    };
  }

  if (
    isScheduleOrConstraintSignalType(effective.effectiveSignalType) &&
    hasPartialStaleScheduleDates(input.signal.structuredPayload, input.asOfDate)
  ) {
    const hasFutureDate =
      base.structured_payload_dates.planned_training_dates.some((date) => date >= input.asOfDate) ||
      base.structured_payload_dates.unavailable_dates.some((date) => date >= input.asOfDate);
    return {
      ...base,
      eligibility: "partial_only",
      recommended_action: "partial_report_only",
      reason: "partial_stale_dates",
      safety_notes: [
        "Row mixes past and future actionable dates; whole-row consume is blocked in Phase 4A.",
        hasFutureDate
          ? "Future actionable date remains; presentation filtering already hides past dates."
          : "No future actionable date detected, but mixed payload still requires manual review.",
      ],
    };
  }

  const billingEligible =
    isScheduleOrConstraintSignalType(effective.effectiveSignalType) &&
    sourceText !== null &&
    isNonTrainingAdministrativeIntentText(sourceText);
  if (billingEligible) {
    return {
      ...base,
      eligibility: "eligible",
      recommended_action: "hide",
      reason: "false_positive_billing_admin",
      safety_notes: [
        "Source text matches billing/admin negative-intent gate; schedule/restriction false positive.",
      ],
    };
  }

  const weatherEligible =
    isScheduleOrConstraintSignalType(effective.effectiveSignalType) &&
    sourceText !== null &&
    isWeatherOrTemperatureSoftContextText(sourceText);
  if (weatherEligible) {
    return {
      ...base,
      eligibility: "eligible",
      recommended_action: "hide",
      reason: "false_positive_weather_soft_context",
      safety_notes: [
        "Source text matches weather/temperature soft-context gate; hard restriction false positive.",
      ],
    };
  }

  const expiredEligible =
    isScheduleOrConstraintSignalType(effective.effectiveSignalType) &&
    isExpiredScheduleOperationalSignal(
      {
        signalType: effective.effectiveSignalType,
        validUntil: input.signal.validUntil,
        structuredPayload: input.signal.structuredPayload,
      },
      input.asOfDate,
      { referenceObservedAt: input.referenceObservedAt ?? input.signal.createdAt }
    );
  if (expiredEligible) {
    return {
      ...base,
      eligibility: "eligible",
      recommended_action: "consume",
      reason: "expired_schedule_constraint",
      safety_notes: [
        "All actionable schedule dates are in the past as of --date; safe to expire/consume persisted row.",
      ],
    };
  }

  if (!sourceText) {
    safetyNotes.push("Source text missing or preview-limited; conservative no-action.");
  } else if (!isScheduleOrConstraintSignalType(effective.effectiveSignalType)) {
    safetyNotes.push(
      `${effective.effectiveSignalType} is outside schedule/constraint cleanup scope for billing/weather rules.`
    );
  } else {
    safetyNotes.push("No deterministic Phase 2–3 false-positive or expiry rule matched.");
  }

  return {
    ...base,
    eligibility: "not_eligible",
    recommended_action: "no_action",
    reason: "not_safe",
    safety_notes: safetyNotes.length > 0 ? safetyNotes : ["Ambiguous row left active."],
  };
}

export function formatPersistedCleanupSummaryMarkdown(input: {
  generatedAt: string;
  asOfDate: string;
  names: string[];
  mode: "dry-run" | "apply";
  candidates: PersistedCleanupCandidate[];
  wouldWriteCount: number;
  actualWrittenCount: number;
  reportDir: string;
}): string {
  const eligible = input.candidates.filter((item) => item.eligibility === "eligible");
  const partial = input.candidates.filter((item) => item.eligibility === "partial_only");
  const notEligible = input.candidates.filter((item) => item.eligibility === "not_eligible");
  const reasonCounts = input.candidates.reduce<Record<string, number>>((acc, item) => {
    acc[item.reason] = (acc[item.reason] ?? 0) + 1;
    return acc;
  }, {});

  const lines = [
    "# TP Signals Persisted Cleanup",
    "",
    `- generated_at: ${input.generatedAt}`,
    `- as_of_date: ${input.asOfDate}`,
    `- mode: ${input.mode}`,
    `- names_filter: ${input.names.length > 0 ? input.names.join(", ") : "(all active signals)"}`,
    `- report_dir: ${input.reportDir}`,
    "",
    "## Counts",
    "",
    `- total_active_signals_inspected: ${input.candidates.length}`,
    `- eligible: ${eligible.length}`,
    `- partial_only: ${partial.length}`,
    `- not_eligible: ${notEligible.length}`,
    `- would_write: ${input.wouldWriteCount}`,
    `- actual_written: ${input.actualWrittenCount}`,
    "",
    "## By reason",
    "",
    ...Object.entries(reasonCounts)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([reason, count]) => `- ${reason}: ${count}`),
    "",
    "## Safety",
    "",
    "- No Telegram sends.",
    "- No TrainingPeaks mutations.",
    "- No row deletes.",
    "- Pain/illness/return rows are never auto-closed.",
    "- Apply requires exact confirm string and only updates eligible rows.",
    "",
    "## Eligible rows",
    "",
  ];

  if (eligible.length === 0) {
    lines.push("_None._");
  } else {
    for (const item of eligible) {
      lines.push(
        `- ${item.student} | ${item.signal_id} | ${item.signal_type} | ${item.reason} | action=${item.recommended_action}`
      );
      if (item.source_snippet) {
        lines.push(`  - source: ${item.source_snippet.slice(0, 160)}`);
      }
    }
  }

  lines.push("", "## Partial-only rows", "");
  if (partial.length === 0) {
    lines.push("_None._");
  } else {
    for (const item of partial) {
      lines.push(`- ${item.student} | ${item.signal_id} | ${item.reason}`);
      for (const note of item.safety_notes) {
        lines.push(`  - ${note}`);
      }
    }
  }

  return `${lines.join("\n")}\n`;
}
