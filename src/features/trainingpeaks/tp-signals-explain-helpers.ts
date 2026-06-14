import type { TrainingPeaksStudentOperationalSignal } from "@/features/trainingpeaks/repository";
import {
  resolveEffectiveOperationalSignalForDisplay,
  resolveOperationalSignalDisplayDebugInfo,
  resolveOperationalSignalDisplayLifecycleState,
  resolveOperationalSignalDisplaySummary,
  type OperationalSignalDisplayDebugInfo,
  type TrainingPeaksOperationalSignalDisplayEvidence,
  type TrainingPeaksOperationalSignalsItem,
} from "@/features/trainingpeaks/service";

export type TpSignalExplainRecord = {
  student: string;
  visible_output: string;
  signal_id: string;
  signal_type: string;
  category: string;
  status: string;
  lifecycle_state: string | null;
  source_observation_ids: string[];
  source_snippets: string[];
  normalized_dates: {
    source_date: string | null;
    target_date: string | null;
    valid_until: string | null;
    planned_training_dates: string[];
    unavailable_dates: string[];
  };
  latest_positive_evidence: string[];
  latest_negative_evidence: string[];
  why_visible: string;
  why_not_closed: string;
  recommended_state: string;
  suspected_bug_class: string | null;
  missing_explainability_fields?: string[];
  hidden_reason?: string | null;
};

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

function inferSuspectedBugClass(input: {
  item: TrainingPeaksOperationalSignalsItem;
  signal: TrainingPeaksStudentOperationalSignal;
  evidence: TrainingPeaksOperationalSignalDisplayEvidence | null;
  debugInfo: OperationalSignalDisplayDebugInfo | null;
  asOfDate: string;
}): string | null {
  const effective = resolveEffectiveOperationalSignalForDisplay(input.signal);
  const payload = input.signal.structuredPayload;
  const unavailableDates = normalizeStringArray(payload.unavailable_dates);
  const plannedDates = normalizeStringArray(payload.planned_training_dates);
  const pastUnavailableVisible = unavailableDates.some((date) => date < input.asOfDate);
  const latestNegative = input.evidence?.latestNegative?.textPreview ?? null;
  const gatedNegativeMissing =
    Boolean(latestNegative) === false &&
    Boolean(input.evidence?.source?.textPreview && /голова\s+круж|сон/i.test(input.evidence.source.textPreview));
  const billingLike =
    /оплач|зарплат|\bзп\b|перевед|абонемент/iu.test(
      [
        input.evidence?.source?.textPreview,
        effective.effectiveDisplaySummary,
        input.item.text,
      ]
        .filter(Boolean)
        .join(" ")
    );

  if (billingLike && input.item.section === "plan_constraints") {
    return "F5";
  }
  if (pastUnavailableVisible && plannedDates.some((date) => date >= input.asOfDate)) {
    return "F1/F11/F12";
  }
  if (/34|жар|градус/iu.test(input.item.text) && input.item.section === "plan_constraints") {
    return "F6";
  }
  if (
    input.item.lifecycleDisplayState === "monitoring_after_return" &&
    gatedNegativeMissing &&
    /новых жалоб нет|закрыть после проверки/iu.test(input.item.text)
  ) {
    return "F4";
  }
  if (
    effective.effectiveSignalType === "pain_injury" &&
    input.evidence?.latestPositive?.textPreview &&
    input.item.lifecycleDisplayState === "active_problem"
  ) {
    return "F2/F3/F13";
  }
  if (
    effective.effectiveSignalType === "pain_injury" &&
    (input.item.text.match(/уточнить/giu)?.length ?? 0) > 1
  ) {
    return "F7";
  }
  if (
    unavailableDates.some((date) => date < input.asOfDate) &&
    normalizeStringArray(payload.unavailable_days).length > 0 &&
    !payload.valid_until
  ) {
    return "F1/F12";
  }
  if (input.item.lifecycleDisplayState === "monitoring_after_return" && /проверить самочувствие/iu.test(input.item.text)) {
    return "F2/F13";
  }
  return null;
}

function inferRecommendedState(input: {
  item: TrainingPeaksOperationalSignalsItem;
  signal: TrainingPeaksStudentOperationalSignal;
  evidence: TrainingPeaksOperationalSignalDisplayEvidence | null;
}): string {
  if (input.item.hiddenReason) {
    return "hidden";
  }
  if (input.item.lifecycleDisplayState === "ready_for_coach_close") {
    return "close_candidate";
  }
  if (input.item.lifecycleDisplayState === "stale_needs_review") {
    return "stale_needs_review";
  }
  if (input.evidence?.latestNegative?.textPreview) {
    return "needs_review";
  }
  if (input.signal.lifecycleState === "monitoring_after_return") {
    return "monitoring_after_return";
  }
  return input.item.lifecycleDisplayState;
}

function buildWhyVisible(input: {
  item: TrainingPeaksOperationalSignalsItem;
  signal: TrainingPeaksStudentOperationalSignal;
  debugInfo: OperationalSignalDisplayDebugInfo | null;
}): string {
  if (input.item.hiddenReason) {
    return `hidden: ${input.item.hiddenReason}`;
  }
  const parts = [
    `section=${input.item.section}`,
    `lifecycle_display=${input.item.lifecycleDisplayState}`,
    `status=${input.signal.status}`,
    input.signal.lifecycleState ? `db_lifecycle=${input.signal.lifecycleState}` : null,
    input.debugInfo?.displayBranchUsed ? `branch=${input.debugInfo.displayBranchUsed}` : null,
  ].filter(Boolean);
  return parts.join("; ");
}

function buildWhyNotClosed(input: {
  item: TrainingPeaksOperationalSignalsItem;
  signal: TrainingPeaksStudentOperationalSignal;
  evidence: TrainingPeaksOperationalSignalDisplayEvidence | null;
  debugInfo: OperationalSignalDisplayDebugInfo | null;
}): string {
  if (input.item.hiddenReason) {
    return `Signal hidden (${input.item.hiddenReason}) — not shown in /tp_signals projection.`;
  }
  if (input.item.lifecycleDisplayState === "ready_for_coach_close") {
    return "Eligible for coach close after review; awaiting manual safe close.";
  }
  if (input.evidence?.latestNegative?.textPreview) {
    return "Recent negative evidence blocks close.";
  }
  if (input.debugInfo?.negativeAfterCompletion) {
    return "Negative message after TP completion requires review.";
  }
  if (input.signal.signalType === "pain_injury") {
    return "Pain/injury signals require coach review; no auto-resolve.";
  }
  if (input.signal.lifecycleState === "monitoring_after_return") {
    return "Monitoring after return — waiting for clean completion/report or coach close.";
  }
  if (input.signal.requiresCoachClose) {
    return "requires_coach_close flag is set.";
  }
  return "Active operational signal without terminal lifecycle transition.";
}

export function buildTpSignalExplainRecord(input: {
  studentName: string;
  signal: TrainingPeaksStudentOperationalSignal;
  item: TrainingPeaksOperationalSignalsItem;
  evidence: TrainingPeaksOperationalSignalDisplayEvidence | null;
  asOfDate: string;
}): TpSignalExplainRecord {
  const effective = resolveEffectiveOperationalSignalForDisplay(input.signal);
  const summary = resolveOperationalSignalDisplaySummary(input.signal, null) ?? "";
  const lifecycleDisplayState = resolveOperationalSignalDisplayLifecycleState(input.signal, input.evidence);
  const debugInfo = resolveOperationalSignalDisplayDebugInfo({
    signal: input.signal,
    effective,
    summary,
    lifecycleDisplayState,
    evidence: input.evidence,
    asOfDate: input.asOfDate,
  });
  const payload = input.signal.structuredPayload;
  const sourceIds = [
    input.signal.sourceObservationId,
    input.evidence?.source?.observationId,
    input.evidence?.latestRelevant?.observationId,
    input.evidence?.latestNegative?.observationId,
    input.evidence?.latestPositive?.observationId,
  ]
    .map((value) => normalizeRecordString(value))
    .filter((value): value is string => Boolean(value));
  const sourceSnippets = [
    input.evidence?.source?.textPreview,
    input.evidence?.latestRelevant?.textPreview,
    effective.effectiveDisplaySummary,
    summary,
  ]
    .map((value) => value?.replace(/\s+/g, " ").trim() ?? null)
    .filter((value): value is string => Boolean(value));
  const latestPositiveEvidence = [
    input.evidence?.latestPositive?.textPreview,
    input.evidence?.completion?.recommendedAction,
  ]
    .map((value) => value?.replace(/\s+/g, " ").trim() ?? null)
    .filter((value): value is string => Boolean(value));
  const latestNegativeEvidence = [
    input.evidence?.latestNegative?.textPreview,
    debugInfo.latestNegativeTextPreview,
    input.evidence?.negativeAfterCompletion?.textPreview,
  ]
    .map((value) => value?.replace(/\s+/g, " ").trim() ?? null)
    .filter((value): value is string => Boolean(value));

  const missing: string[] = [];
  if (sourceIds.length === 0) {
    missing.push("source_observation_ids");
  }
  if (sourceSnippets.length === 0) {
    missing.push("source_snippets");
  }
  if (!input.evidence?.completion && isHealthLikeSignal(input.signal.signalType)) {
    missing.push("tp_completion_evidence");
  }

  const record: TpSignalExplainRecord = {
    student: input.studentName,
    visible_output: input.item.text,
    signal_id: input.signal.id,
    signal_type: input.signal.signalType,
    category: input.item.section,
    status: input.signal.status,
    lifecycle_state: input.signal.lifecycleState,
    source_observation_ids: [...new Set(sourceIds)],
    source_snippets: [...new Set(sourceSnippets)],
    normalized_dates: {
      source_date: input.signal.sourceDate,
      target_date: input.signal.targetDate,
      valid_until: input.signal.validUntil ?? normalizeRecordString(payload.valid_until),
      planned_training_dates: normalizeStringArray(payload.planned_training_dates),
      unavailable_dates: normalizeStringArray(payload.unavailable_dates),
    },
    latest_positive_evidence: [...new Set(latestPositiveEvidence)],
    latest_negative_evidence: [...new Set(latestNegativeEvidence)],
    why_visible: buildWhyVisible({ item: input.item, signal: input.signal, debugInfo }),
    why_not_closed: buildWhyNotClosed({
      item: input.item,
      signal: input.signal,
      evidence: input.evidence,
      debugInfo,
    }),
    recommended_state: inferRecommendedState({
      item: input.item,
      signal: input.signal,
      evidence: input.evidence,
    }),
    suspected_bug_class: inferSuspectedBugClass({
      item: input.item,
      signal: input.signal,
      evidence: input.evidence,
      debugInfo,
      asOfDate: input.asOfDate,
    }),
    hidden_reason: input.item.hiddenReason ?? null,
  };
  if (missing.length > 0) {
    record.missing_explainability_fields = missing;
  }
  return record;
}

function isHealthLikeSignal(signalType: string): boolean {
  return (
    signalType === "health_issue_started" ||
    signalType === "health_issue_improving" ||
    signalType === "pause_training" ||
    signalType === "pain_injury"
  );
}

export function formatTpSignalExplainSummaryMarkdown(input: {
  generatedAt: string;
  asOfDate: string;
  names: string[];
  reportDir: string;
  records: TpSignalExplainRecord[];
}): string {
  const lines: string[] = [];
  lines.push("# TP Signals Explain Diagnostic");
  lines.push("");
  lines.push(`- generated_at: ${input.generatedAt}`);
  lines.push(`- as_of: ${input.asOfDate}`);
  lines.push(`- names: ${input.names.join(", ")}`);
  lines.push(`- visible_signals: ${input.records.length}`);
  lines.push(`- report_dir: ${input.reportDir}`);
  lines.push("");
  for (const record of input.records) {
    lines.push(`## ${record.student}`);
    lines.push("");
    lines.push(`- signal_id: ${record.signal_id}`);
    lines.push(`- signal_type: ${record.signal_type}`);
    lines.push(`- category: ${record.category}`);
    lines.push(`- status: ${record.status} / lifecycle_state: ${record.lifecycle_state ?? "null"}`);
    lines.push(`- suspected_bug_class: ${record.suspected_bug_class ?? "none"}`);
    lines.push(`- recommended_state: ${record.recommended_state}`);
    lines.push(`- why_visible: ${record.why_visible}`);
    lines.push(`- why_not_closed: ${record.why_not_closed}`);
    if (record.missing_explainability_fields?.length) {
      lines.push(`- missing_explainability_fields: ${record.missing_explainability_fields.join(", ")}`);
    }
    lines.push("");
    lines.push("Visible output:");
    lines.push("");
    lines.push("```");
    lines.push(record.visible_output || "(empty)");
    lines.push("```");
    lines.push("");
    if (record.source_snippets.length > 0) {
      lines.push("Source snippets:");
      for (const snippet of record.source_snippets.slice(0, 5)) {
        lines.push(`- ${snippet}`);
      }
      lines.push("");
    }
  }
  return `${lines.join("\n")}\n`;
}
