import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { getSignalMetadataString } from "@/features/trainingpeaks/operational-schedule-display";
import { evaluateOperationalSignalLifecycle } from "@/features/trainingpeaks/operational-signal-lifecycle";
import {
  listActiveTrainingPeaksMoveActions,
  listTrainingPeaksOperationalSignals,
  listTrainingPeaksStudents,
  listTrainingPeaksTelegramContextObservationsForStudent,
  listTrainingPeaksWorkoutCacheForStudentDateRange,
  type TrainingPeaksStudentOperationalSignal,
} from "@/features/trainingpeaks/repository";
import {
  buildTrainingPeaksOperationalSignalsSnapshotFromSignals,
  formatTrainingPeaksOperationalSignalsForTelegram,
  type TrainingPeaksOperationalSignalsItem,
  type TrainingPeaksOperationalSignalsSnapshot,
} from "@/features/trainingpeaks/service";
import {
  buildLifecycleInputFromEvidence,
  classifySignal,
  evaluateLifecycleFromEvidence,
  getSignalLifecycle,
} from "./lib/operational-signal-lifecycle-runtime";

const LOG_PREFIX = "[diagnose-trainingpeaks-signals-live-expanded]";
const LIVE_DISPLAY_LIMIT = 15;
const FULL_DISPLAY_LIMIT = 250;
const DEFAULT_AS_OF = "2026-06-06";
const DUPLICATE_WINDOW_DAYS = 10;

type RecommendedFixType =
  | "apply_monitoring"
  | "coach_close"
  | "mark_superseded"
  | "expire_or_resolve_schedule"
  | "fix_display_wording"
  | "fix_classifier_creation"
  | "keep_active"
  | "needs_manual_review";

type CliOptions = {
  asOfDate: string;
  student: string | null;
  includeOverflow: boolean;
  json: boolean;
};

type TriageRow = {
  display_order: number | null;
  section: string | null;
  visible_in_final_message: boolean;
  overflow: boolean;
  student_name: string;
  signal_id: string;
  signal_type: string;
  v2_payload_signal_type: string | null;
  activity_domain: string | null;
  planning_effect: string | null;
  lifecycle_state: string;
  requires_coach_close: boolean;
  status: string;
  valid_from: string | null;
  valid_until: string | null;
  follow_up_due_date: string | null;
  display_summary: string | null;
  source_observation_ids: string;
  latest_raw_evidence: string;
  latest_tp_completion_after_open: string | null;
  proposed_lifecycle: string;
  proposed_action: string;
  duplicate_cluster_key: string;
  duplicate_cluster_size: number;
  superseded_by_signal_id: string | null;
  hidden_reason: string | null;
  why_visible: string;
  recommended_fix_type: RecommendedFixType;
  confidence: string | null;
  safety_notes: string;
};

function loadLocalEnvFiles(): void {
  const repoRoot = path.resolve(process.cwd());
  const envPaths = [path.join(repoRoot, ".env.local"), path.join(repoRoot, ".env")];
  for (const envPath of envPaths) {
    if (!fs.existsSync(envPath)) {
      continue;
    }
    const content = fs.readFileSync(envPath, "utf8");
    for (const rawLine of content.split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }
      const separatorIndex = line.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }
      const key = line.slice(0, separatorIndex).trim();
      if (!key || process.env[key] !== undefined) {
        continue;
      }
      let value = line.slice(separatorIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

function parseAsOfDate(raw: string): string {
  const normalized = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) {
    throw new Error(`${LOG_PREFIX} FAIL: invalid --as-of value: ${raw}`);
  }
  return normalized;
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    asOfDate: DEFAULT_AS_OF,
    student: null,
    includeOverflow: false,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--include-overflow") {
      options.includeOverflow = true;
      continue;
    }
    if (arg.startsWith("--as-of=")) {
      options.asOfDate = parseAsOfDate(arg.slice("--as-of=".length));
      continue;
    }
    if (arg === "--as-of") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --as-of`);
      }
      options.asOfDate = parseAsOfDate(next);
      index += 1;
      continue;
    }
    if (arg.startsWith("--student=")) {
      options.student = arg.slice("--student=".length).trim() || null;
      continue;
    }
    if (arg === "--student") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --student`);
      }
      options.student = next;
      index += 1;
      continue;
    }
  }
  return options;
}

function normalizeMatch(input: string): string {
  return input.toLowerCase().replace(/\s+/gu, " ").trim();
}

function normalizeRecordString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function toDaysBetween(leftIso: string, rightIso: string): number {
  const left = Date.parse(leftIso);
  const right = Date.parse(rightIso);
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Math.floor(Math.abs(right - left) / (24 * 60 * 60 * 1000));
}

function buildDuplicateClusters(signals: TrainingPeaksStudentOperationalSignal[]): Map<string, number> {
  const rows = [...signals].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const counts = new Map<string, number>();
  for (let index = 0; index < rows.length; index += 1) {
    const base = rows[index]!;
    let count = 1;
    for (let nextIndex = index + 1; nextIndex < rows.length; nextIndex += 1) {
      const next = rows[nextIndex]!;
      if (next.studentId !== base.studentId || next.signalType !== base.signalType) {
        continue;
      }
      if (toDaysBetween(base.createdAt, next.createdAt) > DUPLICATE_WINDOW_DAYS) {
        continue;
      }
      count += 1;
    }
    counts.set(base.id, count);
  }
  return counts;
}

function getDuplicateClusterKey(signal: TrainingPeaksStudentOperationalSignal): string {
  const episodeKey =
    getSignalMetadataString(signal.metadata, "episode_key") ??
    normalizeRecordString(signal.structuredPayload.episode_key);
  return `${signal.studentId}:${signal.signalType}:${episodeKey ?? signal.createdAt.slice(0, 10)}`;
}

function getSupersededBySignalId(signal: TrainingPeaksStudentOperationalSignal): string | null {
  return (
    getSignalMetadataString(signal.metadata, "superseded_by_signal_id") ??
    normalizeRecordString(signal.structuredPayload.superseded_by_signal_id) ??
    normalizeRecordString(signal.lifecycleMeta.superseded_by_signal_id)
  );
}

function flattenSnapshotItems(snapshot: TrainingPeaksOperationalSignalsSnapshot): TrainingPeaksOperationalSignalsItem[] {
  const items: TrainingPeaksOperationalSignalsItem[] = [];
  for (const section of snapshot.sections) {
    for (const item of section.items) {
      items.push({ ...item, section: section.key });
    }
  }
  return items;
}

function sectionTitle(snapshot: TrainingPeaksOperationalSignalsSnapshot, sectionKey: string | null): string | null {
  if (!sectionKey) {
    return null;
  }
  return snapshot.sections.find((section) => section.key === sectionKey)?.title ?? sectionKey;
}

function resolveSoloHiddenReason(input: {
  signal: TrainingPeaksStudentOperationalSignal;
  allSignals: readonly TrainingPeaksStudentOperationalSignal[];
  studentNameById: ReadonlyMap<string, string | null>;
  asOfDate: string;
  activeMoveActions: Awaited<ReturnType<typeof listActiveTrainingPeaksMoveActions>>;
}): string | null {
  const soloSnapshot = buildTrainingPeaksOperationalSignalsSnapshotFromSignals({
    signals: [input.signal],
    studentNameById: input.studentNameById,
    asOfDate: input.asOfDate,
    activeMoveActions: input.activeMoveActions,
    limit: 5,
  });
  const soloItems = flattenSnapshotItems(soloSnapshot);
  if (soloItems.length > 0) {
    return null;
  }
  const withContextSnapshot = buildTrainingPeaksOperationalSignalsSnapshotFromSignals({
    signals: input.allSignals,
    studentNameById: input.studentNameById,
    asOfDate: input.asOfDate,
    activeMoveActions: input.activeMoveActions,
    limit: FULL_DISPLAY_LIMIT,
  });
  const visibleIds = new Set(flattenSnapshotItems(withContextSnapshot).map((item) => item.signalId));
  if (visibleIds.has(input.signal.id)) {
    return "deduped_or_merged_in_full_pipeline";
  }
  return "hidden_before_projection_pipeline";
}

function resolveProposedAction(input: {
  signal: TrainingPeaksStudentOperationalSignal;
  lifecycleCurrent: ReturnType<typeof getSignalLifecycle>;
  proposal: ReturnType<typeof evaluateOperationalSignalLifecycle>;
  duplicateCount: number;
  hiddenReason: string | null;
}): string {
  if (input.duplicateCount > 1 && input.proposal.proposedLifecycle !== "active_problem") {
    return "possible_duplicate_superseded";
  }
  if (input.hiddenReason === "expired_schedule_signal" || input.hiddenReason === "expired_planned_training_dates") {
    return "expire_or_resolve_schedule";
  }
  if (
    input.proposal.proposedLifecycle === "monitoring_after_return" &&
    input.proposal.requiresCoachClose &&
    input.lifecycleCurrent === "monitoring_after_return"
  ) {
    return "ready_for_coach_close";
  }
  if (input.proposal.proposedLifecycle === "monitoring_after_return") {
    return "demote_to_monitoring";
  }
  if (input.proposal.proposedLifecycle === "resolved") {
    return "resolve_to_memory";
  }
  return "keep_active";
}

function resolveRecommendedFixType(input: {
  signal: TrainingPeaksStudentOperationalSignal;
  lifecycleCurrent: ReturnType<typeof getSignalLifecycle>;
  proposal: ReturnType<typeof evaluateOperationalSignalLifecycle>;
  proposedAction: string;
  visibleInFinalMessage: boolean;
  overflow: boolean;
  hiddenReason: string | null;
  displaySummary: string | null;
  displayText: string | null;
  episodeClass: ReturnType<typeof classifySignal>;
}): RecommendedFixType {
  if (input.proposedAction === "possible_duplicate_superseded") {
    return "mark_superseded";
  }
  if (input.proposedAction === "ready_for_coach_close") {
    return "coach_close";
  }
  if (input.proposedAction === "resolve_to_memory") {
    return "coach_close";
  }
  if (input.proposedAction === "expire_or_resolve_schedule") {
    return "expire_or_resolve_schedule";
  }
  if (
    input.proposedAction === "demote_to_monitoring" &&
    input.lifecycleCurrent === "active_problem" &&
    input.proposal.proposedLifecycle === "monitoring_after_return"
  ) {
    return "apply_monitoring";
  }
  if (input.hiddenReason === "deduped_or_merged_in_full_pipeline") {
    if (input.proposedAction === "demote_to_monitoring" || input.proposedAction === "possible_duplicate_superseded") {
      return input.proposedAction === "possible_duplicate_superseded" ? "mark_superseded" : "apply_monitoring";
    }
    return "needs_manual_review";
  }
  if (
    input.visibleInFinalMessage &&
    input.lifecycleCurrent === "active_problem" &&
    input.proposal.proposedLifecycle === "monitoring_after_return"
  ) {
    return "apply_monitoring";
  }
  if (
    !input.visibleInFinalMessage &&
    input.episodeClass === "injury_pain" &&
    input.lifecycleCurrent === "monitoring_after_return"
  ) {
    return "fix_display_wording";
  }
  if (
    input.displayText &&
    input.displaySummary &&
    input.displayText.includes("ограничение") &&
    !input.displayText.includes(input.displaySummary)
  ) {
    return "fix_display_wording";
  }
  if (input.hiddenReason?.includes("expired")) {
    return "expire_or_resolve_schedule";
  }
  if (input.proposedAction === "keep_active" && input.visibleInFinalMessage) {
    return "keep_active";
  }
  if (!input.visibleInFinalMessage && input.overflow) {
    return "needs_manual_review";
  }
  if (input.proposal.reason.includes("classifier") || input.proposal.reason.includes("misread")) {
    return "fix_classifier_creation";
  }
  return "needs_manual_review";
}

function resolveLatestRawEvidence(input: {
  lifecycleInput: ReturnType<typeof buildLifecycleInputFromEvidence>;
  sourceObservationPreview: string | null;
}): string {
  const completion = input.lifecycleInput.latestTpCompletionAfterOpen;
  if (input.lifecycleInput.negativeMessageAfterCompletion) {
    return `negative_after_return:${input.lifecycleInput.negativeMessageAfterCompletion.reason}`;
  }
  if (input.lifecycleInput.explicitRecoveryMessage) {
    return `explicit_recovery:${input.lifecycleInput.explicitRecoveryMessage.reason}`;
  }
  if (completion) {
    return `tp_completion:${completion.workoutDate}:${completion.sportClass}:${completion.runningCompletionClass}`;
  }
  if (input.sourceObservationPreview) {
    return `telegram:${input.sourceObservationPreview}`;
  }
  return "none";
}

function formatTpCompletion(
  lifecycleInput: ReturnType<typeof buildLifecycleInputFromEvidence>
): string | null {
  const completion = lifecycleInput.latestTpCompletionAfterOpen;
  if (!completion) {
    return null;
  }
  return `${completion.workoutDate} ${completion.sportClass}/${completion.runningCompletionClass}`;
}

function resolveWhyVisible(input: {
  visibleInFinalMessage: boolean;
  overflow: boolean;
  hiddenReason: string | null;
  displayText: string | null;
  lifecycleCurrent: ReturnType<typeof getSignalLifecycle>;
  proposedAction: string;
}): string {
  if (input.visibleInFinalMessage) {
    return `included in top-${LIVE_DISPLAY_LIMIT} projection rows; lifecycle=${input.lifecycleCurrent}; text="${input.displayText ?? ""}"`;
  }
  if (input.overflow) {
    return `passed projection filters but truncated by +N overflow cap (${LIVE_DISPLAY_LIMIT}); lifecycle=${input.lifecycleCurrent}`;
  }
  if (input.hiddenReason) {
    return `suppressed: ${input.hiddenReason}; proposed_action=${input.proposedAction}`;
  }
  return `not in live message; proposed_action=${input.proposedAction}`;
}

function printCoachPreview(input: {
  liveSnapshot: TrainingPeaksOperationalSignalsSnapshot;
  fullItems: TrainingPeaksOperationalSignalsItem[];
  liveItems: TrainingPeaksOperationalSignalsItem[];
  hiddenRows: TriageRow[];
}): void {
  console.log("");
  console.log("=== COACH-FACING PREVIEW ===");
  console.log("VISIBLE:");
  console.log(formatTrainingPeaksOperationalSignalsForTelegram(input.liveSnapshot));
  console.log("");
  console.log("OVERFLOW:");
  const liveIds = new Set(input.liveItems.map((item) => item.signalId));
  const overflowItems = input.fullItems.filter((item) => !liveIds.has(item.signalId));
  if (overflowItems.length === 0) {
    console.log("(none)");
  } else {
    for (const item of overflowItems) {
      const name = item.studentName?.trim() || "Без ученика";
      console.log(`• ${name}`);
      console.log(`  ${item.text}`);
    }
  }
  console.log("");
  console.log("HIDDEN/SUPPRESSED:");
  const hiddenVisible = input.hiddenRows.filter((row) => !row.visible_in_final_message && !row.overflow);
  if (hiddenVisible.length === 0) {
    console.log("(none)");
  } else {
    for (const row of hiddenVisible) {
      console.log(
        `• ${row.student_name} [${row.signal_id}] ${row.signal_type}: ${row.hidden_reason ?? row.why_visible}`
      );
    }
  }
}

function printTable(rows: TriageRow[]): void {
  const columns: Array<keyof TriageRow> = [
    "display_order",
    "section",
    "visible_in_final_message",
    "overflow",
    "student_name",
    "signal_id",
    "signal_type",
    "v2_payload_signal_type",
    "activity_domain",
    "planning_effect",
    "lifecycle_state",
    "requires_coach_close",
    "status",
    "valid_from",
    "valid_until",
    "follow_up_due_date",
    "display_summary",
    "source_observation_ids",
    "latest_raw_evidence",
    "latest_tp_completion_after_open",
    "proposed_lifecycle",
    "proposed_action",
    "duplicate_cluster_key",
    "duplicate_cluster_size",
    "superseded_by_signal_id",
    "hidden_reason",
    "why_visible",
    "recommended_fix_type",
    "confidence",
    "safety_notes",
  ];
  console.log(columns.join("\t"));
  for (const row of rows) {
    console.log(columns.map((column) => String(row[column] ?? "")).join("\t"));
  }
}

function printRootCauseSummary(rows: TriageRow[]): void {
  const staleDb = rows.filter(
    (row) =>
      row.lifecycle_state === "active_problem" &&
      (row.proposed_lifecycle === "monitoring_after_return" || row.proposed_action === "demote_to_monitoring")
  );
  const displayIssues = rows.filter(
    (row) =>
      row.recommended_fix_type === "fix_display_wording" ||
      row.overflow ||
      (row.hidden_reason === "deduped_or_merged_in_full_pipeline" && row.signal_type === "pain_injury")
  );
  const classifierIssues = rows.filter((row) => row.recommended_fix_type === "fix_classifier_creation");
  const legitimate = rows.filter((row) => row.recommended_fix_type === "keep_active" && row.visible_in_final_message);

  console.log("");
  console.log("=== ROOT CAUSE GROUPING ===");
  console.log(`Category A — stale DB lifecycle state: ${staleDb.length}`);
  for (const row of staleDb) {
    console.log(`  - ${row.student_name} ${row.signal_id} ${row.display_summary ?? row.signal_type}`);
  }
  console.log(`Category B — display/projection issue: ${displayIssues.length}`);
  for (const row of displayIssues) {
    console.log(`  - ${row.student_name} ${row.signal_id} ${row.why_visible}`);
  }
  console.log(`Category C — classifier/observer creation issue: ${classifierIssues.length}`);
  for (const row of classifierIssues) {
    console.log(`  - ${row.student_name} ${row.signal_id} ${row.latest_raw_evidence}`);
  }
  console.log(`Category D — legitimate active signal: ${legitimate.length}`);
  for (const row of legitimate) {
    console.log(`  - ${row.student_name} ${row.signal_id} ${row.display_summary ?? row.signal_type}`);
  }
}

async function run(): Promise<void> {
  loadLocalEnvFiles();
  const options = parseCliOptions(process.argv.slice(2));
  const studentQuery = options.student ? normalizeMatch(options.student) : null;

  const [signalsResult, students, activeMoveActions] = await Promise.all([
    listTrainingPeaksOperationalSignals({ status: "active", limit: 250 }),
    listTrainingPeaksStudents(),
    listActiveTrainingPeaksMoveActions(250),
  ]);

  const studentNameById = new Map(students.map((student) => [student.id, student.studentName?.trim() || null]));
  const studentById = new Map(students.map((student) => [student.id, student]));
  const allSignals = signalsResult.items.filter((signal) => {
    if (!studentQuery) {
      return true;
    }
    const student = studentById.get(signal.studentId);
    if (!student) {
      return false;
    }
    const haystack = `${student.studentName} ${student.studentId} ${student.id}`.toLowerCase();
    return haystack.includes(studentQuery);
  });

  const liveSnapshot = buildTrainingPeaksOperationalSignalsSnapshotFromSignals({
    signals: allSignals,
    studentNameById,
    asOfDate: options.asOfDate,
    activeMoveActions,
    limit: LIVE_DISPLAY_LIMIT,
  });
  const fullSnapshot = buildTrainingPeaksOperationalSignalsSnapshotFromSignals({
    signals: allSignals,
    studentNameById,
    asOfDate: options.asOfDate,
    activeMoveActions,
    limit: FULL_DISPLAY_LIMIT,
  });

  const liveItems = flattenSnapshotItems(liveSnapshot);
  const fullItems = flattenSnapshotItems(fullSnapshot);
  const liveIds = new Set(liveItems.map((item) => item.signalId));
  const fullItemBySignalId = new Map(fullItems.map((item) => [item.signalId, item]));
  const duplicateMap = buildDuplicateClusters(allSignals);

  const observationsByStudent = new Map<string, Awaited<ReturnType<typeof listTrainingPeaksTelegramContextObservationsForStudent>>>();
  const workoutsByStudent = new Map<string, Awaited<ReturnType<typeof listTrainingPeaksWorkoutCacheForStudentDateRange>>>();

  const rows: TriageRow[] = [];
  for (const signal of allSignals) {
    const student = studentById.get(signal.studentId);
    const studentName = student?.studentName ?? "unknown";
    if (!observationsByStudent.has(signal.studentId)) {
      observationsByStudent.set(
        signal.studentId,
        await listTrainingPeaksTelegramContextObservationsForStudent(signal.studentId, 250)
      );
    }
    if (!workoutsByStudent.has(signal.studentId)) {
      const openedDate = signal.createdAt.slice(0, 10);
      workoutsByStudent.set(
        signal.studentId,
        await listTrainingPeaksWorkoutCacheForStudentDateRange({
          studentId: signal.studentId,
          from: openedDate,
          to: options.asOfDate,
        })
      );
    }
    const observations = observationsByStudent.get(signal.studentId) ?? [];
    const workouts = workoutsByStudent.get(signal.studentId) ?? [];
    const { lifecycleInput, proposal } = evaluateLifecycleFromEvidence({
      signal,
      asOfDate: options.asOfDate,
      workouts,
      observations,
    });
    const lifecycleCurrent = getSignalLifecycle(signal);
    const episodeClass = classifySignal(signal);
    const duplicateCount = duplicateMap.get(signal.id) ?? 1;
    const projectedItem = fullItemBySignalId.get(signal.id) ?? null;
    const visibleInFinalMessage = liveIds.has(signal.id);
    const overflow = Boolean(projectedItem && !visibleInFinalMessage);
    const hiddenReason = projectedItem
      ? null
      : resolveSoloHiddenReason({
          signal,
          allSignals,
          studentNameById,
          asOfDate: options.asOfDate,
          activeMoveActions,
        });
    const proposedAction = resolveProposedAction({
      signal,
      lifecycleCurrent,
      proposal,
      duplicateCount,
      hiddenReason,
    });
    const sourceObservation = observations.find((item) => item.id === signal.sourceObservationId) ?? null;
    const sourceObservationPreview = sourceObservation?.textPreview?.replace(/\s+/gu, " ").trim() ?? null;
    const displaySummary =
      normalizeRecordString(signal.structuredPayload.display_summary) ??
      normalizeRecordString(signal.structuredPayload.latest_summary) ??
      normalizeRecordString(signal.metadata.summary) ??
      null;
    const displayText = projectedItem?.text ?? null;
    const displayOrder = projectedItem ? fullItems.findIndex((item) => item.signalId === signal.id) + 1 : null;
    const recommendedFixType = resolveRecommendedFixType({
      signal,
      lifecycleCurrent,
      proposal,
      proposedAction,
      visibleInFinalMessage,
      overflow,
      hiddenReason,
      displaySummary,
      displayText,
      episodeClass,
    });

    rows.push({
      display_order: displayOrder,
      section: projectedItem ? sectionTitle(fullSnapshot, projectedItem.section) : null,
      visible_in_final_message: visibleInFinalMessage,
      overflow,
      student_name: studentName,
      signal_id: signal.id,
      signal_type: signal.signalType,
      v2_payload_signal_type: normalizeRecordString(signal.structuredPayload.signal_type),
      activity_domain:
        normalizeRecordString(signal.structuredPayload.activity_domain) ??
        getSignalMetadataString(signal.metadata, "activity_domain"),
      planning_effect:
        normalizeRecordString(signal.structuredPayload.planning_effect) ??
        getSignalMetadataString(signal.metadata, "planning_effect"),
      lifecycle_state: lifecycleCurrent,
      requires_coach_close: signal.requiresCoachClose,
      status: signal.status,
      valid_from: signal.validFrom,
      valid_until: signal.validUntil,
      follow_up_due_date: getSignalMetadataString(signal.metadata, "follow_up_due_date"),
      display_summary: displaySummary,
      source_observation_ids: signal.sourceObservationId ?? "none",
      latest_raw_evidence: resolveLatestRawEvidence({
        lifecycleInput,
        sourceObservationPreview,
      }),
      latest_tp_completion_after_open: formatTpCompletion(lifecycleInput),
      proposed_lifecycle: proposal.proposedLifecycle,
      proposed_action: proposedAction,
      duplicate_cluster_key: getDuplicateClusterKey(signal),
      duplicate_cluster_size: duplicateCount,
      superseded_by_signal_id: getSupersededBySignalId(signal),
      hidden_reason: hiddenReason,
      why_visible: resolveWhyVisible({
        visibleInFinalMessage,
        overflow,
        hiddenReason,
        displayText,
        lifecycleCurrent,
        proposedAction,
      }),
      recommended_fix_type: recommendedFixType,
      confidence: signal.confidence === null ? null : String(signal.confidence),
      safety_notes: "read-only diagnostic; no lifecycle apply",
    });
  }

  rows.sort((left, right) => {
    const leftOrder = left.display_order ?? 999;
    const rightOrder = right.display_order ?? 999;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return left.student_name.localeCompare(right.student_name, "ru-RU");
  });

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          mode: "read-only",
          as_of: options.asOfDate,
          live_limit: LIVE_DISPLAY_LIMIT,
          total_active_signals: allSignals.length,
          total_projected_items: fullSnapshot.totalBeforeLimit,
          overflow_count: liveSnapshot.overflowCount,
          rows,
        },
        null,
        2
      )
    );
    return;
  }

  console.log(
    `${LOG_PREFIX} as_of=${options.asOfDate} active_signals=${allSignals.length} projected_items=${fullSnapshot.totalBeforeLimit} live_visible=${liveItems.length} overflow=${liveSnapshot.overflowCount}`
  );
  printTable(rows);
  if (options.includeOverflow || !options.student) {
    printCoachPreview({
      liveSnapshot,
      fullItems,
      liveItems,
      hiddenRows: rows,
    });
  }
  printRootCauseSummary(rows);
}

if (process.argv[1] && process.argv[1].endsWith("diagnose-trainingpeaks-signals-live-expanded.ts")) {
  void run().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message.startsWith(`${LOG_PREFIX} FAIL:`) ? message : `${LOG_PREFIX} FAIL: ${message}`);
    process.exit(1);
  });
}
