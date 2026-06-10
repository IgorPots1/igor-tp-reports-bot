import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  buildOperationalSignalDisplayEvidenceMap,
  buildTrainingPeaksOperationalSignalsSnapshotFromSignals,
  AUTO_HIDDEN_CLEAN_ILLNESS_RECOVERY_RUN_REASON,
  resolveEffectiveOperationalSignalForDisplay,
  resolveOperationalSignalDisplayDebugInfo,
  resolveOperationalSignalDisplayLifecycleState,
  resolveOperationalSignalDisplaySummary,
  type TrainingPeaksOperationalSignalDisplayEvidence,
  type TrainingPeaksOperationalSignalsItem,
  type TrainingPeaksOperationalSignalsSnapshot,
} from "@/features/trainingpeaks/service";
import {
  getTrainingPeaksMessageIntentLogByTelegramMessage,
  listActiveTrainingPeaksMoveActions,
  listTrainingPeaksOperationalSignals,
  listTrainingPeaksStudents,
  listTrainingPeaksTelegramContextObservationsForStudent,
  listTrainingPeaksWorkoutCacheForStudentDateRange,
  type TrainingPeaksStudent,
  type TrainingPeaksStudentOperationalSignal,
  type TrainingPeaksTelegramContextObservation,
  type TrainingPeaksWorkoutCacheRow,
} from "@/features/trainingpeaks/repository";
import { isCompletedRunReflectionNotScheduleConstraint } from "@/features/trainingpeaks/coach-operational-signals";

const LOG_PREFIX = "[diagnose-operational-signals-ai-review]";
const DEFAULT_LIMIT = 20;
const DEFAULT_AS_OF = "2026-06-10";
const REPORT_ROOT = "reports/operational-signals-ai-review";

type CliOptions = {
  limit: number;
  student: string | null;
  includeHidden: boolean;
  asOfDate: string;
  callAi: boolean;
};

type TextSource = "normalized_text" | "text_preview";

type EvidenceObservation = {
  observationId: string;
  observedAt: string;
  sourceType: string;
  text: string;
  labels: string[];
  isAfterCompletion: boolean | null;
  text_source: TextSource;
  is_truncated: boolean;
};

type EvidencePack = {
  student: {
    id: string;
    name: string;
    slug: string | null;
  };
  currentSignal: {
    id: string;
    type: string;
    status: string;
    lifecycleState: string | null;
    displaySummary: string | null;
    latestSummary: string | null;
    createdAt: string;
    updatedAt: string;
    validFrom: string | null;
    validUntil: string | null;
  };
  recentObservations: EvidenceObservation[];
  tpEvidence: {
    latestRunningCompletionAfterOpen: {
      workoutId: string;
      date: string;
      title: string;
      completedAt: string | null;
      confidence: "low" | "medium" | "high";
    } | null;
    plannedWorkouts: Array<{
      workoutId: string;
      date: string;
      title: string;
      isCompleted: boolean;
    }>;
  };
  deterministicVerdict: {
    visibleInTpSignals: boolean;
    hiddenReason: string | null;
    renderedText: string | null;
    displayBranchUsed: string | null;
    lifecycleRecommendation: string | null;
    reasonCodes: string[];
  };
  aiReviewPlaceholder: {
    recommendedCategory: string;
    shouldShowInTpSignals: boolean;
    lifecycleRecommendation: string;
    confidence: number;
    reasons: string[];
    safetyFlags: string[];
  };
  safetyVerdict: {
    allowedActions: string[];
    blockedActions: string[];
    reason: string;
  };
};

function loadLocalEnvFiles(): void {
  const repoRoot = path.resolve(process.cwd());
  for (const envPath of [path.join(repoRoot, ".env.local"), path.join(repoRoot, ".env")]) {
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
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

function parseIsoDate(raw: string): string {
  const normalized = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) {
    throw new Error(`${LOG_PREFIX} FAIL: invalid date: ${raw}`);
  }
  return normalized;
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    limit: DEFAULT_LIMIT,
    student: null,
    includeHidden: false,
    asOfDate: DEFAULT_AS_OF,
    callAi: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--include-hidden") {
      options.includeHidden = true;
      continue;
    }
    if (arg === "--call-ai") {
      options.callAi = true;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      options.limit = parseLimit(arg.slice("--limit=".length));
      continue;
    }
    if (arg === "--limit") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --limit`);
      }
      options.limit = parseLimit(next);
      index += 1;
      continue;
    }
    if (arg.startsWith("--student=")) {
      options.student = arg.slice("--student=".length).trim() || null;
      continue;
    }
    if (arg === "--student") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --student`);
      }
      options.student = next.trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--as-of=")) {
      options.asOfDate = parseIsoDate(arg.slice("--as-of=".length));
      continue;
    }
    if (arg === "--as-of") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --as-of`);
      }
      options.asOfDate = parseIsoDate(next);
      index += 1;
      continue;
    }
  }
  return options;
}

function parseLimit(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${LOG_PREFIX} FAIL: invalid --limit value: ${raw}`);
  }
  return Math.max(1, Math.min(100, Math.trunc(parsed)));
}

function normalizeMatch(value: string | null | undefined): string {
  return (value ?? "")
    .toLocaleLowerCase("ru")
    .replace(/ё/gu, "е")
    .replace(/\s+/gu, " ")
    .trim();
}

function compactMatch(value: string | null | undefined): string {
  return normalizeMatch(value).replace(/[^a-zа-я0-9]+/giu, "");
}

function slugForStudent(student: TrainingPeaksStudent): string | null {
  return student.telegramUsername?.trim() || student.studentId?.trim() || compactMatch(student.studentName) || null;
}

function resolveStudentMatch(students: TrainingPeaksStudent[], query: string | null): TrainingPeaksStudent | null {
  if (!query) {
    return null;
  }
  const normalizedQuery = normalizeMatch(query);
  const compactQuery = compactMatch(query);
  const exactMatches = students.filter((student) =>
    [student.studentName, student.studentId, student.telegramUsername]
      .filter(Boolean)
      .some((field) => normalizeMatch(field) === normalizedQuery || compactMatch(field) === compactQuery)
  );
  if (exactMatches.length === 1) {
    return exactMatches[0]!;
  }
  if (exactMatches.length > 1) {
    console.error(`${LOG_PREFIX} ambiguous exact --student "${query}". Matches:`);
    for (const match of exactMatches) {
      console.error(`- ${match.studentName} (${match.studentId}, id=${match.id})`);
    }
    process.exit(2);
  }
  const matches = students.filter((student) => {
    const fields = [student.studentName, student.studentId, student.telegramUsername].filter(Boolean);
    return fields.some((field) => {
      const normalizedField = normalizeMatch(field);
      const compactField = compactMatch(field);
      return normalizedField.includes(normalizedQuery) || compactField.includes(compactQuery);
    });
  });
  if (matches.length === 0) {
    throw new Error(`${LOG_PREFIX} FAIL: no student matches "${query}"`);
  }
  if (matches.length > 1) {
    console.error(`${LOG_PREFIX} ambiguous --student "${query}". Matches:`);
    for (const match of matches) {
      console.error(`- ${match.studentName} (${match.studentId}, id=${match.id})`);
    }
    process.exit(2);
  }
  return matches[0]!;
}

function flattenSnapshotItems(snapshot: TrainingPeaksOperationalSignalsSnapshot): TrainingPeaksOperationalSignalsItem[] {
  return snapshot.sections.flatMap((section) => section.items.map((item) => ({ ...item, section: item.section })));
}

function normalizeRecordString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function addDaysIso(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function confidenceFromDisplayEvidence(value: string | null | undefined): "low" | "medium" | "high" {
  if (value === "high" || value === "medium" || value === "low") {
    return value;
  }
  return "medium";
}

function selectLatestCompletion(input: {
  signal: TrainingPeaksStudentOperationalSignal;
  workouts: TrainingPeaksWorkoutCacheRow[];
  displayEvidence: TrainingPeaksOperationalSignalDisplayEvidence | null;
}): EvidencePack["tpEvidence"]["latestRunningCompletionAfterOpen"] {
  const fromEvidence = input.displayEvidence?.completion?.latestCompletionAfterOpen ?? null;
  if (fromEvidence) {
    return {
      workoutId: fromEvidence.workoutId,
      date: fromEvidence.workoutDate,
      title: fromEvidence.title ?? "",
      completedAt: fromEvidence.completionObservedAt ?? null,
      confidence: confidenceFromDisplayEvidence(fromEvidence.classificationConfidence),
    };
  }
  const openedDate = input.signal.createdAt.slice(0, 10);
  const latest = input.workouts
    .filter((workout) => workout.isCompleted && workout.workoutDate >= openedDate)
    .sort((left, right) => left.workoutDate.localeCompare(right.workoutDate) || left.trainingPeaksWorkoutId - right.trainingPeaksWorkoutId)
    .at(-1);
  if (!latest) {
    return null;
  }
  return {
    workoutId: String(latest.trainingPeaksWorkoutId),
    date: latest.workoutDate,
    title: latest.title ?? "",
    completedAt: latest.startTime ?? latest.startTimePlanned ?? null,
    confidence: "low",
  };
}

function isObservationAfterCompletion(
  observation: TrainingPeaksTelegramContextObservation,
  completion: EvidencePack["tpEvidence"]["latestRunningCompletionAfterOpen"]
): boolean | null {
  if (!completion?.completedAt) {
    return null;
  }
  const observedAt = Date.parse(observation.observedAt);
  const completedAt = Date.parse(completion.completedAt);
  if (!Number.isFinite(observedAt) || !Number.isFinite(completedAt)) {
    return null;
  }
  return observedAt > completedAt;
}

async function resolveObservationText(
  observation: TrainingPeaksTelegramContextObservation
): Promise<{ text: string; text_source: TextSource; is_truncated: boolean }> {
  if (observation.chatId && observation.messageId) {
    const intentLog = await getTrainingPeaksMessageIntentLogByTelegramMessage(
      observation.chatId,
      observation.messageId
    );
    const normalized = intentLog?.normalizedText?.replace(/\s+/gu, " ").trim();
    if (normalized) {
      return {
        text: normalized,
        text_source: "normalized_text",
        is_truncated: false,
      };
    }
  }
  return {
    text: observation.textPreview?.replace(/\s+/gu, " ").trim() ?? "",
    text_source: "text_preview",
    is_truncated: true,
  };
}

async function buildRecentObservations(input: {
  observations: TrainingPeaksTelegramContextObservation[];
  signal: TrainingPeaksStudentOperationalSignal;
  completion: EvidencePack["tpEvidence"]["latestRunningCompletionAfterOpen"];
}): Promise<EvidenceObservation[]> {
  const relevantIds = new Set<string>();
  if (input.signal.sourceObservationId) {
    relevantIds.add(input.signal.sourceObservationId);
  }
  const openedAt = Date.parse(input.signal.createdAt);
  const recent = input.observations
    .filter((observation) => {
      if (relevantIds.has(observation.id)) {
        return true;
      }
      const observedAt = Date.parse(observation.observedAt);
      if (!Number.isFinite(observedAt) || !Number.isFinite(openedAt)) {
        return false;
      }
      return observedAt >= openedAt - 48 * 60 * 60 * 1000;
    })
    .sort((left, right) => right.observedAt.localeCompare(left.observedAt))
    .slice(0, 12);

  const rows: EvidenceObservation[] = [];
  for (const observation of recent) {
    const resolvedText = await resolveObservationText(observation);
    rows.push({
      observationId: observation.id,
      observedAt: observation.observedAt,
      sourceType: observation.sourceType,
      text: resolvedText.text,
      labels: observation.labels,
      isAfterCompletion: isObservationAfterCompletion(observation, input.completion),
      text_source: resolvedText.text_source,
      is_truncated: resolvedText.is_truncated,
    });
  }
  return rows;
}

function inferPlaceholder(input: {
  signal: TrainingPeaksStudentOperationalSignal;
  hiddenReason: string | null;
  visibleInTpSignals: boolean;
  recentObservations: EvidenceObservation[];
}): EvidencePack["aiReviewPlaceholder"] {
  const type = input.signal.signalType;
  let recommendedCategory = "none";
  let lifecycleRecommendation = input.visibleInTpSignals ? "keep_visible" : "needs_manual_review";
  const reasons: string[] = [`deterministic_signal_type:${type}`];
  const safetyFlags: string[] = [];

  if (type === "pain_injury") {
    recommendedCategory = "pain_injury";
    lifecycleRecommendation = "keep_visible";
    safetyFlags.push("injury_pain");
  } else if (type.startsWith("health_issue_") || type === "pause_training" || type === "resume_training") {
    recommendedCategory = "illness_recovery";
  } else if (
    type === "plan_generation_constraint" ||
    type === "schedule_unavailability_window" ||
    type === "schedule_availability_window" ||
    type === "move_workout_candidate"
  ) {
    recommendedCategory = "schedule_constraint";
  } else if (type === "external_training_context" || type === "race_load_context") {
    recommendedCategory = "load_adjustment_request";
  }

  if (input.hiddenReason === "auto_hidden_clean_recovery_run") {
    recommendedCategory = "illness_recovery";
    lifecycleRecommendation = "close_candidate";
    reasons.push("deterministic_hidden:auto_hidden_clean_recovery_run");
  } else if (input.hiddenReason?.includes("completed_run_reflection")) {
    recommendedCategory = "completed_workout_reflection";
    lifecycleRecommendation = "hide_as_false_positive";
    reasons.push(`deterministic_hidden:${input.hiddenReason}`);
  } else if (input.hiddenReason) {
    lifecycleRecommendation = "hide_as_false_positive";
    reasons.push(`deterministic_hidden:${input.hiddenReason}`);
  }

  if (input.recentObservations.some((observation) => observation.isAfterCompletion === true)) {
    safetyFlags.push("post_run_negative");
  }
  if (input.recentObservations.some((observation) => observation.is_truncated)) {
    safetyFlags.push("truncated_source");
  }

  return {
    recommendedCategory,
    shouldShowInTpSignals: input.visibleInTpSignals,
    lifecycleRecommendation,
    confidence: input.hiddenReason || input.visibleInTpSignals ? 0.65 : 0.35,
    reasons,
    safetyFlags: [...new Set(safetyFlags)],
  };
}

function buildSafetyVerdict(input: {
  placeholder: EvidencePack["aiReviewPlaceholder"];
  signal: TrainingPeaksStudentOperationalSignal;
  hiddenReason: string | null;
}): EvidencePack["safetyVerdict"] {
  const allowedActions = ["show_review_only"];
  const blockedActions = ["db_write", "telegram_send", "trainingpeaks_mutation", "ai_auto_apply"];
  if (input.signal.signalType === "pain_injury" || input.placeholder.safetyFlags.includes("injury_pain")) {
    blockedActions.push("auto_close_pain_injury", "auto_hide_pain_injury");
    return {
      allowedActions,
      blockedActions,
      reason: "Pain/injury evidence is coach-review only in v0.",
    };
  }
  if (input.placeholder.safetyFlags.includes("post_run_negative")) {
    blockedActions.push("auto_close_post_run_negative");
    return {
      allowedActions,
      blockedActions,
      reason: "Observation after completion requires coach review.",
    };
  }
  if (input.hiddenReason === "auto_hidden_clean_recovery_run") {
    allowedActions.push("close_candidate_suggestion");
    return {
      allowedActions,
      blockedActions,
      reason: "Deterministic clean recovery hide is eligible for review-only close candidate.",
    };
  }
  if (input.hiddenReason) {
    allowedActions.push("hide_suggestion");
    return {
      allowedActions,
      blockedActions,
      reason: `Deterministic hidden reason present: ${input.hiddenReason}.`,
    };
  }
  return {
    allowedActions,
    blockedActions,
    reason: "No auto action in diagnostic v0; evidence pack only.",
  };
}

function reasonCodesFor(input: {
  visibleItem: TrainingPeaksOperationalSignalsItem | null;
  hiddenReason: string | null;
  debugInfo: ReturnType<typeof resolveOperationalSignalDisplayDebugInfo> | null;
}): string[] {
  const codes: string[] = [];
  if (input.visibleItem) {
    codes.push(`section:${input.visibleItem.section}`);
    codes.push(`lifecycle_display:${input.visibleItem.lifecycleDisplayState}`);
  }
  if (input.hiddenReason) {
    codes.push(`hidden:${input.hiddenReason}`);
  }
  if (input.debugInfo?.negativeAfterCompletion) {
    codes.push("negative_after_completion");
  }
  if (input.debugInfo?.completionWorkoutId) {
    codes.push("tp_completion_after_open");
  }
  return codes;
}

function formatMarkdownReport(input: {
  options: CliOptions;
  reportDir: string;
  packs: EvidencePack[];
}): string {
  const lines: string[] = [];
  lines.push("# Operational Signals AI Review Diagnostic");
  lines.push("");
  lines.push(`- as_of: ${input.options.asOfDate}`);
  lines.push(`- limit: ${input.options.limit}`);
  lines.push(`- student: ${input.options.student ?? "all"}`);
  lines.push(`- include_hidden: ${String(input.options.includeHidden)}`);
  lines.push(`- call_ai: false`);
  lines.push(`- report_dir: ${input.reportDir}`);
  lines.push("");
  for (const pack of input.packs) {
    lines.push(`## ${pack.student.name}`);
    lines.push("");
    lines.push(`- signal: ${pack.currentSignal.type} (${pack.currentSignal.id})`);
    lines.push(`- visible: ${String(pack.deterministicVerdict.visibleInTpSignals)}`);
    lines.push(`- hidden_reason: ${pack.deterministicVerdict.hiddenReason ?? "null"}`);
    lines.push(`- rendered: ${pack.deterministicVerdict.renderedText ?? "null"}`);
    lines.push(`- placeholder: ${pack.aiReviewPlaceholder.recommendedCategory} / ${pack.aiReviewPlaceholder.lifecycleRecommendation}`);
    lines.push(`- safety: ${pack.safetyVerdict.reason}`);
    lines.push("");
    lines.push("Recent observations:");
    if (pack.recentObservations.length === 0) {
      lines.push("- none");
    } else {
      for (const observation of pack.recentObservations.slice(0, 5)) {
        lines.push(
          `- ${observation.observedAt} ${observation.text_source}${observation.is_truncated ? " truncated" : ""}: ${observation.text}`
        );
      }
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

async function buildEvidencePack(input: {
  signal: TrainingPeaksStudentOperationalSignal;
  student: TrainingPeaksStudent;
  visibleItem: TrainingPeaksOperationalSignalsItem | null;
  hiddenReason: string | null;
  displayEvidence: TrainingPeaksOperationalSignalDisplayEvidence | null;
  asOfDate: string;
}): Promise<EvidencePack> {
  const effective = resolveEffectiveOperationalSignalForDisplay(input.signal);
  const summary = resolveOperationalSignalDisplaySummary(input.signal, null);
  const lifecycleDisplayState = resolveOperationalSignalDisplayLifecycleState(input.signal);
  const debugInfo =
    input.visibleItem || input.displayEvidence
      ? resolveOperationalSignalDisplayDebugInfo({
          signal: input.signal,
          effective,
          summary: summary ?? "",
          lifecycleDisplayState,
          evidence: input.displayEvidence,
          asOfDate: input.asOfDate,
        })
      : null;
  const workoutFrom = addDaysIso(input.signal.createdAt.slice(0, 10), -2);
  const workoutTo = addDaysIso(input.asOfDate, 14);
  const [observations, workouts] = await Promise.all([
    listTrainingPeaksTelegramContextObservationsForStudent(input.signal.studentId, 250),
    listTrainingPeaksWorkoutCacheForStudentDateRange({
      studentId: input.signal.studentId,
      from: workoutFrom,
      to: workoutTo,
    }),
  ]);
  const latestCompletion = selectLatestCompletion({
    signal: input.signal,
    workouts,
    displayEvidence: input.displayEvidence,
  });
  const recentObservations = await buildRecentObservations({
    observations,
    signal: input.signal,
    completion: latestCompletion,
  });
  const refinedHiddenReason = refineHiddenReason({
    rawHiddenReason: input.hiddenReason,
    visibleItem: input.visibleItem,
    signal: input.signal,
    debugInfo,
    recentObservations,
  });
  const plannedWorkouts = workouts
    .filter((workout) => workout.workoutDate >= input.asOfDate && workout.isPlanned)
    .slice(0, 14)
    .map((workout) => ({
      workoutId: String(workout.trainingPeaksWorkoutId),
      date: workout.workoutDate,
      title: workout.title ?? "",
      isCompleted: workout.isCompleted,
    }));
  const visibleInTpSignals = Boolean(input.visibleItem);
  const placeholder = inferPlaceholder({
    signal: input.signal,
    hiddenReason: refinedHiddenReason,
    visibleInTpSignals,
    recentObservations,
  });

  return {
    student: {
      id: input.student.id,
      name: input.student.studentName,
      slug: slugForStudent(input.student),
    },
    currentSignal: {
      id: input.signal.id,
      type: input.signal.signalType,
      status: input.signal.status,
      lifecycleState: input.signal.lifecycleState,
      displaySummary: effective.effectiveDisplaySummary ?? null,
      latestSummary: normalizeRecordString(input.signal.structuredPayload.latest_summary),
      createdAt: input.signal.createdAt,
      updatedAt: input.signal.updatedAt,
      validFrom: input.signal.validFrom,
      validUntil: input.signal.validUntil,
    },
    recentObservations,
    tpEvidence: {
      latestRunningCompletionAfterOpen: latestCompletion,
      plannedWorkouts,
    },
    deterministicVerdict: {
      visibleInTpSignals,
      hiddenReason: refinedHiddenReason,
      renderedText: input.visibleItem?.text ?? null,
      displayBranchUsed: debugInfo?.displayBranchUsed ?? null,
      lifecycleRecommendation: input.displayEvidence?.completion?.recommendedAction ?? null,
      reasonCodes: reasonCodesFor({
        visibleItem: input.visibleItem,
        hiddenReason: refinedHiddenReason,
        debugInfo,
      }),
    },
    aiReviewPlaceholder: placeholder,
    safetyVerdict: buildSafetyVerdict({
      placeholder,
      signal: input.signal,
      hiddenReason: refinedHiddenReason,
    }),
  };
}

function refineHiddenReason(input: {
  rawHiddenReason: string | null;
  visibleItem: TrainingPeaksOperationalSignalsItem | null;
  signal: TrainingPeaksStudentOperationalSignal;
  debugInfo: ReturnType<typeof resolveOperationalSignalDisplayDebugInfo> | null;
  recentObservations: EvidenceObservation[];
}): string | null {
  if (input.visibleItem) {
    return null;
  }
  if (
    input.rawHiddenReason &&
    input.debugInfo?.displayBranchUsed === "fresh_illness_recovery_monitoring_overlay"
  ) {
    return AUTO_HIDDEN_CLEAN_ILLNESS_RECOVERY_RUN_REASON;
  }
  if (
    input.rawHiddenReason &&
    input.signal.signalType === "plan_generation_constraint" &&
    input.recentObservations.some((observation) =>
      isCompletedRunReflectionNotScheduleConstraint(observation.text)
    )
  ) {
    return "completed_run_reflection_not_schedule";
  }
  return input.rawHiddenReason;
}

function selectSignals(input: {
  signals: TrainingPeaksStudentOperationalSignal[];
  visibleItems: TrainingPeaksOperationalSignalsItem[];
  options: CliOptions;
  targetStudent: TrainingPeaksStudent | null;
}): TrainingPeaksStudentOperationalSignal[] {
  const byId = new Map(input.signals.map((signal) => [signal.id, signal]));
  const selected: TrainingPeaksStudentOperationalSignal[] = [];
  const selectedIds = new Set<string>();
  const visibleIds = input.visibleItems.map((item) => item.signalId);
  for (const signalId of visibleIds) {
    const signal = byId.get(signalId);
    if (!signal) {
      continue;
    }
    if (input.targetStudent && signal.studentId !== input.targetStudent.id) {
      continue;
    }
    selected.push(signal);
    selectedIds.add(signal.id);
    if (!input.options.includeHidden && selected.length >= input.options.limit) {
      return selected;
    }
  }
  if (input.options.includeHidden || input.targetStudent) {
    for (const signal of input.signals) {
      if (input.targetStudent && signal.studentId !== input.targetStudent.id) {
        continue;
      }
      if (selectedIds.has(signal.id)) {
        continue;
      }
      selected.push(signal);
      selectedIds.add(signal.id);
      if (selected.length >= input.options.limit) {
        break;
      }
    }
  }
  return selected.slice(0, input.options.limit);
}

async function run(): Promise<void> {
  loadLocalEnvFiles();
  const options = parseCliOptions(process.argv.slice(2));
  if (options.callAi) {
    console.warn(`${LOG_PREFIX} --call-ai is accepted for future compatibility, but v0 does not call AI APIs.`);
  }

  const [students, signalsResult, actions] = await Promise.all([
    listTrainingPeaksStudents(),
    listTrainingPeaksOperationalSignals({
      status: "active",
      limit: 200,
    }),
    listActiveTrainingPeaksMoveActions(250),
  ]);
  const targetStudent = resolveStudentMatch(students, options.student);
  if (targetStudent) {
    console.log(`${LOG_PREFIX} matched student: ${targetStudent.studentName} (${targetStudent.studentId}, id=${targetStudent.id})`);
  }
  const signals = targetStudent
    ? signalsResult.items.filter((signal) => signal.studentId === targetStudent.id)
    : signalsResult.items;
  const studentById = new Map(students.map((student) => [student.id, student]));
  const studentNameById = new Map(students.map((student) => [student.id, student.studentName?.trim() || null]));
  const displayEvidenceBySignalId = await buildOperationalSignalDisplayEvidenceMap({
    signals,
    asOfDate: options.asOfDate,
  });
  const fullSnapshot = buildTrainingPeaksOperationalSignalsSnapshotFromSignals({
    signals,
    studentNameById,
    asOfDate: options.asOfDate,
    limit: 100,
    activeMoveActions: actions,
    displayEvidenceBySignalId,
  });
  const visibleItems = flattenSnapshotItems(fullSnapshot);
  const visibleBySignalId = new Map(visibleItems.map((item) => [item.signalId, item]));
  const selectedSignals = selectSignals({
    signals,
    visibleItems,
    options,
    targetStudent,
  });

  const packs: EvidencePack[] = [];
  for (const signal of selectedSignals) {
    const student = studentById.get(signal.studentId);
    if (!student) {
      continue;
    }
    const visibleItem = visibleBySignalId.get(signal.id) ?? null;
    const hiddenReason = visibleItem ? null : "hidden_before_projection_pipeline";
    const pack = await buildEvidencePack({
      signal,
      student,
      visibleItem,
      hiddenReason,
      displayEvidence: displayEvidenceBySignalId.get(signal.id) ?? null,
      asOfDate: options.asOfDate,
    });
    packs.push(pack);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const reportDir = path.join(REPORT_ROOT, timestamp);
  fs.mkdirSync(reportDir, { recursive: true });
  const summary = {
    generatedAt: new Date().toISOString(),
    asOfDate: options.asOfDate,
    limit: options.limit,
    studentQuery: options.student,
    includeHidden: options.includeHidden,
    callAi: false,
    selectedSignals: packs.length,
    reportDir,
  };
  fs.writeFileSync(path.join(reportDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  fs.writeFileSync(path.join(reportDir, "evidence-packs.json"), `${JSON.stringify(packs, null, 2)}\n`);
  fs.writeFileSync(path.join(reportDir, "review-preview.md"), formatMarkdownReport({ options, reportDir, packs }));

  console.log(`${LOG_PREFIX} wrote ${reportDir}`);
  console.log(`${LOG_PREFIX} selected_signals=${packs.length} visible_projection=${visibleItems.length}`);
  for (const pack of packs) {
    console.log("");
    console.log(`=== ${pack.student.name} ===`);
    console.log(`signal: ${pack.currentSignal.type} ${pack.currentSignal.id}`);
    console.log(
      `deterministic: visible=${String(pack.deterministicVerdict.visibleInTpSignals)} hidden=${pack.deterministicVerdict.hiddenReason ?? "null"} branch=${pack.deterministicVerdict.displayBranchUsed ?? "null"}`
    );
    console.log(`rendered: ${pack.deterministicVerdict.renderedText ?? "null"}`);
    console.log(
      `placeholder: ${pack.aiReviewPlaceholder.recommendedCategory} ${pack.aiReviewPlaceholder.lifecycleRecommendation} confidence=${pack.aiReviewPlaceholder.confidence}`
    );
    console.log(`safety: ${pack.safetyVerdict.reason}`);
    const completion = pack.tpEvidence.latestRunningCompletionAfterOpen;
    console.log(`tp_completion: ${completion ? `${completion.date} ${completion.title}` : "null"}`);
    for (const observation of pack.recentObservations.slice(0, 3)) {
      console.log(
        `obs: ${observation.observedAt} ${observation.text_source} truncated=${String(observation.is_truncated)} after_completion=${String(observation.isAfterCompletion)} ${observation.text}`
      );
    }
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
