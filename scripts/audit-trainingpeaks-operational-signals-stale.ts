import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  listActiveTrainingPeaksMoveActions,
  listTrainingPeaksOperationalSignals,
  type TrainingPeaksAction,
  type TrainingPeaksOperationalSignalType,
  type TrainingPeaksStudentOperationalSignal,
} from "@/features/trainingpeaks/repository";
import { buildTrainingPeaksOperationalSignalsSnapshotFromSignals } from "@/features/trainingpeaks/service";
import { DEFAULT_COACH_TIMEZONE, getCoachTodayDateKey } from "@/features/trainingpeaks/operational-follow-up";
import { createSupabaseServerClient } from "@/features/supabase/server";

const LOG_PREFIX = "[audit-trainingpeaks-operational-signals-stale]";
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

export const LIFECYCLE_SIGNAL_TYPES = new Set<TrainingPeaksOperationalSignalType>([
  "health_issue_started",
  "health_issue_improving",
  "pause_training",
  "resume_training",
  "plan_generation_constraint",
  "schedule_unavailability_window",
  "schedule_availability_window",
  "move_workout_candidate",
]);

export const DUPLICATE_SCAN_SIGNAL_TYPES = new Set<TrainingPeaksOperationalSignalType>([
  "health_issue_started",
  "health_issue_improving",
  "pause_training",
  "plan_generation_constraint",
  "schedule_unavailability_window",
  "move_workout_candidate",
]);

const ALLOWED_SIGNAL_TYPES: readonly TrainingPeaksOperationalSignalType[] = [
  "schedule_availability_window",
  "schedule_unavailability_window",
  "resume_training",
  "pause_training",
  "health_issue_started",
  "health_issue_resolved",
  "health_issue_improving",
  "move_workout_candidate",
  "plan_generation_constraint",
  "race_load_context",
];

const LOGISTICS_CUES = [
  "поездк",
  "экзамен",
  "лагерь",
  "день рождения",
  "стадион",
  "мск",
  "москв",
  "поеду",
  "уеду",
  "не смогу",
  "не получится",
];

const HEALTH_CUES = [
  "бол",
  "темпера",
  "кашель",
  "горло",
  "слабость",
  "травм",
  "боль",
  "недомога",
  "отврат",
];

type CliOptions = {
  student: string | null;
  signalType: TrainingPeaksOperationalSignalType | null;
  limit: number;
  json: boolean;
  includeHidden: boolean;
};

type StudentRow = {
  id: string;
  student_name: string | null;
};

type ObservationRow = {
  id: string;
  text_preview: string | null;
};

type MinimalSignalForDuplicate = {
  id: string;
  studentId: string;
  signalType: string;
  validFrom: string | null;
  validUntil: string | null;
};

type MinimalMoveActionForMatch = {
  id: string;
  studentId: string;
  sourceDate: string | null;
  targetDate: string | null;
};

export type AuditRisk =
  | "expired_but_active"
  | "missing_valid_until"
  | "missing_source_observation"
  | "duplicate_candidate"
  | "possible_false_pause"
  | "active_move_without_action"
  | "visible_in_tp_signals"
  | "should_review_manually";

type AuditRecommendation = "keep" | "manual_review" | "expire_candidate" | "hide_candidate";

type AuditItem = {
  studentName: string;
  signalType: string;
  risks: AuditRisk[];
  validFrom?: string | null;
  validUntil?: string | null;
  sourceObservationId?: string | null;
  latestSummary?: string | null;
  evidencePreview?: string | null;
  recommendation: AuditRecommendation;
};

type AuditJsonOutput = {
  generatedAt: string;
  scannedCount: number;
  countsBySignalType: Record<string, number>;
  riskCounts: Record<AuditRisk, number>;
  items: AuditItem[];
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

function parsePositiveInt(raw: string, flag: string): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${LOG_PREFIX} FAIL: invalid ${flag} value: ${raw}`);
  }
  return Math.floor(parsed);
}

function parseSignalType(raw: string): TrainingPeaksOperationalSignalType {
  const normalized = raw.trim().toLowerCase() as TrainingPeaksOperationalSignalType;
  if (!ALLOWED_SIGNAL_TYPES.includes(normalized)) {
    throw new Error(`${LOG_PREFIX} FAIL: invalid --type value: ${raw}`);
  }
  return normalized;
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    student: null,
    signalType: null,
    limit: DEFAULT_LIMIT,
    json: false,
    includeHidden: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--include-hidden") {
      options.includeHidden = true;
      continue;
    }
    if (arg === "--apply") {
      throw new Error(
        `${LOG_PREFIX} FAIL: --apply is not supported; this audit is strictly read-only`
      );
    }
    if (arg.startsWith("--limit=")) {
      options.limit = Math.min(parsePositiveInt(arg.slice("--limit=".length), "--limit"), MAX_LIMIT);
      continue;
    }
    if (arg === "--limit") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --limit`);
      }
      options.limit = Math.min(parsePositiveInt(next, "--limit"), MAX_LIMIT);
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
    if (arg.startsWith("--type=")) {
      options.signalType = parseSignalType(arg.slice("--type=".length));
      continue;
    }
    if (arg === "--type") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --type`);
      }
      options.signalType = parseSignalType(next);
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`${LOG_PREFIX} FAIL: unknown argument: ${arg}`);
    }
  }

  return options;
}

function asLower(value: string | null | undefined): string {
  return (value ?? "").toLowerCase();
}

function compact(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/gu, " ").trim();
}

function formatDateShort(value: string | null): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return "open";
  }
  return `${value.slice(8, 10)}.${value.slice(5, 7)}`;
}

function formatWindow(validFrom: string | null, validUntil: string | null): string {
  if (validFrom && validUntil) {
    if (validFrom === validUntil) {
      return formatDateShort(validFrom);
    }
    return `${formatDateShort(validFrom)}—${formatDateShort(validUntil)}`;
  }
  if (validFrom) {
    return `${formatDateShort(validFrom)}—open`;
  }
  if (validUntil) {
    return `open—${formatDateShort(validUntil)}`;
  }
  return "open";
}

function normalizeMaybeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function truncateText(value: string | null, maxLength = 140): string | null {
  const normalized = compact(value);
  if (!normalized) {
    return null;
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function hasWindowOverlap(
  leftFrom: string | null,
  leftUntil: string | null,
  rightFrom: string | null,
  rightUntil: string | null
): boolean {
  const minDate = "0001-01-01";
  const maxDate = "9999-12-31";
  const normalizedLeftFrom = leftFrom ?? minDate;
  const normalizedLeftUntil = leftUntil ?? maxDate;
  const normalizedRightFrom = rightFrom ?? minDate;
  const normalizedRightUntil = rightUntil ?? maxDate;
  return normalizedLeftFrom <= normalizedRightUntil && normalizedRightFrom <= normalizedLeftUntil;
}

export function buildDuplicateSignalIdSet(
  signals: readonly MinimalSignalForDuplicate[]
): Set<string> {
  const grouped = new Map<string, MinimalSignalForDuplicate[]>();
  for (const signal of signals) {
    if (!DUPLICATE_SCAN_SIGNAL_TYPES.has(signal.signalType as TrainingPeaksOperationalSignalType)) {
      continue;
    }
    const key = `${signal.studentId}|${signal.signalType}`;
    const existing = grouped.get(key) ?? [];
    existing.push(signal);
    grouped.set(key, existing);
  }

  const duplicateIds = new Set<string>();
  for (const group of grouped.values()) {
    for (let leftIndex = 0; leftIndex < group.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < group.length; rightIndex += 1) {
        const left = group[leftIndex]!;
        const right = group[rightIndex]!;
        if (hasWindowOverlap(left.validFrom, left.validUntil, right.validFrom, right.validUntil)) {
          duplicateIds.add(left.id);
          duplicateIds.add(right.id);
        }
      }
    }
  }
  return duplicateIds;
}

export function isPossibleFalsePause(evidence: string): boolean {
  const normalized = asLower(evidence);
  if (!normalized) {
    return false;
  }
  const hasLogisticsCue = LOGISTICS_CUES.some((cue) => normalized.includes(cue));
  if (!hasLogisticsCue) {
    return false;
  }
  const hasHealthCue = HEALTH_CUES.some((cue) => normalized.includes(cue));
  return !hasHealthCue;
}

export function hasMatchingActiveMoveAction(
  signal: Pick<
    TrainingPeaksStudentOperationalSignal,
    "studentId" | "linkedActionId" | "sourceDate" | "targetDate"
  >,
  moveActions: readonly MinimalMoveActionForMatch[]
): boolean {
  for (const action of moveActions) {
    if (action.studentId !== signal.studentId) {
      continue;
    }
    if (signal.linkedActionId && signal.linkedActionId === action.id) {
      return true;
    }
    if (signal.sourceDate && signal.targetDate) {
      if (signal.sourceDate === action.sourceDate && signal.targetDate === action.targetDate) {
        return true;
      }
    }
  }
  return false;
}

function toMinimalMoveAction(action: TrainingPeaksAction): MinimalMoveActionForMatch | null {
  if (action.actionType !== "move_workout") {
    return null;
  }
  const payload =
    action.parsedPayload && typeof action.parsedPayload === "object"
      ? (action.parsedPayload as Record<string, unknown>)
      : {};
  const sourceDate =
    normalizeMaybeString(payload.sourceDate) ??
    normalizeMaybeString(payload.source_date) ??
    (() => {
      const source = payload.source;
      if (!source || typeof source !== "object" || Array.isArray(source)) {
        return null;
      }
      const sourceObj = source as Record<string, unknown>;
      if (sourceObj.kind !== "date") {
        return null;
      }
      return normalizeMaybeString(sourceObj.value);
    })();

  const targetDate = (() => {
    const target = payload.target;
    if (!target || typeof target !== "object" || Array.isArray(target)) {
      return null;
    }
    const targetObj = target as Record<string, unknown>;
    if (targetObj.kind !== "date") {
      return null;
    }
    return normalizeMaybeString(targetObj.value);
  })();

  return {
    id: action.id,
    studentId: action.studentId,
    sourceDate,
    targetDate,
  };
}

function extractLatestSummary(signal: TrainingPeaksStudentOperationalSignal): string | null {
  const fromStructured = normalizeMaybeString(signal.structuredPayload.latest_summary);
  if (fromStructured) {
    return fromStructured;
  }
  const fromMetadata = normalizeMaybeString(signal.metadata.follow_up_reason);
  if (fromMetadata) {
    return fromMetadata;
  }
  return null;
}

function computeRecommendation(risks: readonly AuditRisk[]): AuditRecommendation {
  if (risks.includes("expired_but_active")) {
    return "expire_candidate";
  }
  if (risks.includes("active_move_without_action")) {
    return "hide_candidate";
  }
  if (risks.length > 0) {
    return "manual_review";
  }
  return "keep";
}

function shouldMarkManualReview(risks: readonly AuditRisk[]): boolean {
  if (risks.length === 0) {
    return false;
  }
  if (risks.includes("expired_but_active")) {
    return false;
  }
  if (risks.includes("active_move_without_action")) {
    return false;
  }
  return true;
}

function shouldIncludeInRows(risks: readonly AuditRisk[], includeHidden: boolean): boolean {
  if (includeHidden) {
    return true;
  }
  return (
    risks.includes("visible_in_tp_signals") ||
    risks.includes("expired_but_active") ||
    risks.includes("active_move_without_action") ||
    risks.includes("possible_false_pause")
  );
}

function buildRiskScore(risks: readonly AuditRisk[]): number {
  let score = 0;
  for (const risk of risks) {
    switch (risk) {
      case "expired_but_active":
        score += 50;
        break;
      case "active_move_without_action":
        score += 40;
        break;
      case "duplicate_candidate":
        score += 30;
        break;
      case "possible_false_pause":
        score += 30;
        break;
      case "missing_valid_until":
        score += 20;
        break;
      case "missing_source_observation":
        score += 20;
        break;
      case "visible_in_tp_signals":
        score += 10;
        break;
      case "should_review_manually":
        score += 1;
        break;
    }
  }
  return score;
}

async function fetchActiveSignals(options: {
  student: string | null;
  signalType: TrainingPeaksOperationalSignalType | null;
  limit: number;
}): Promise<TrainingPeaksStudentOperationalSignal[]> {
  const items: TrainingPeaksStudentOperationalSignal[] = [];
  const pageSize = 200;
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  while (items.length < options.limit && offset < total) {
    const page = await listTrainingPeaksOperationalSignals({
      status: "active",
      studentQuery: options.student,
      signalType: options.signalType ?? undefined,
      limit: pageSize,
      offset,
    });
    total = page.total;
    if (page.items.length === 0) {
      break;
    }
    items.push(...page.items);
    offset += page.items.length;
  }
  return items.slice(0, options.limit);
}

async function fetchStudentsByIds(studentIds: readonly string[]): Promise<Map<string, string>> {
  if (studentIds.length === 0) {
    return new Map();
  }
  const supabase = createSupabaseServerClient();
  const out = new Map<string, string>();
  for (let index = 0; index < studentIds.length; index += 200) {
    const chunk = studentIds.slice(index, index + 200);
    const { data, error } = await supabase
      .from("trainingpeaks_students")
      .select("id, student_name")
      .in("id", chunk);
    if (error) {
      throw new Error(`${LOG_PREFIX} FAIL: trainingpeaks_students read failed: ${error.message}`);
    }
    const rows = (data as StudentRow[] | null) ?? [];
    for (const row of rows) {
      out.set(row.id, row.student_name?.trim() || `Unknown (${row.id.slice(0, 8)})`);
    }
  }
  return out;
}

async function fetchObservationPreviewById(
  observationIds: readonly string[]
): Promise<Map<string, string | null>> {
  if (observationIds.length === 0) {
    return new Map();
  }
  const supabase = createSupabaseServerClient();
  const out = new Map<string, string | null>();
  for (let index = 0; index < observationIds.length; index += 200) {
    const chunk = observationIds.slice(index, index + 200);
    const { data, error } = await supabase
      .from("trainingpeaks_telegram_context_observations")
      .select("id, text_preview")
      .in("id", chunk);
    if (error) {
      throw new Error(
        `${LOG_PREFIX} FAIL: trainingpeaks_telegram_context_observations read failed: ${error.message}`
      );
    }
    const rows = (data as ObservationRow[] | null) ?? [];
    for (const row of rows) {
      out.set(row.id, row.text_preview ?? null);
    }
  }
  return out;
}

function createEmptyRiskCounts(): Record<AuditRisk, number> {
  return {
    expired_but_active: 0,
    missing_valid_until: 0,
    missing_source_observation: 0,
    duplicate_candidate: 0,
    possible_false_pause: 0,
    active_move_without_action: 0,
    visible_in_tp_signals: 0,
    should_review_manually: 0,
  };
}

function printTextReport(output: AuditJsonOutput, includeHidden: boolean): void {
  console.log("Operational Signals stale audit");
  console.log("");
  console.log(`Total active signals scanned: ${output.scannedCount}`);
  console.log("");
  console.log("By signal_type:");
  for (const [signalType, count] of Object.entries(output.countsBySignalType).sort((left, right) =>
    left[0].localeCompare(right[0])
  )) {
    console.log(`- ${signalType}: ${count}`);
  }
  console.log("");
  console.log("Risk buckets:");
  for (const [risk, count] of Object.entries(output.riskCounts)) {
    console.log(`- ${risk}: ${count}`);
  }
  console.log("");
  console.log(`Top review rows${includeHidden ? " (including hidden rows)" : ""}:`);
  const top = output.items.slice(0, 10);
  if (top.length === 0) {
    console.log("- none");
    return;
  }
  for (const row of top) {
    console.log(`• ${row.studentName}`);
    console.log(`  signal_type: ${row.signalType}`);
    console.log(`  risks: ${row.risks.join(", ")}`);
    console.log(`  window: ${formatWindow(row.validFrom ?? null, row.validUntil ?? null)}`);
    console.log(`  valid_until: ${row.validUntil ?? "null"}`);
    console.log(`  source_observation_id: ${row.sourceObservationId ?? "null"}`);
    console.log(`  evidence: ${truncateText(row.evidencePreview ?? null, 120) ?? "null"}`);
    console.log(`  latest_summary: ${truncateText(row.latestSummary ?? null, 120) ?? "null"}`);
    console.log(`  recommendation: ${row.recommendation}`);
  }
}

async function run(): Promise<void> {
  loadLocalEnvFiles();
  const options = parseCliOptions(process.argv.slice(2));
  const asOfDate = getCoachTodayDateKey(DEFAULT_COACH_TIMEZONE);

  const signals = await fetchActiveSignals({
    student: options.student,
    signalType: options.signalType,
    limit: options.limit,
  });

  const studentIds = [...new Set(signals.map((signal) => signal.studentId))];
  const observationIds = [
    ...new Set(
      signals
        .map((signal) => signal.sourceObservationId)
        .filter((value): value is string => Boolean(value))
    ),
  ];
  const [studentNameById, observationPreviewById, rawMoveActions] = await Promise.all([
    fetchStudentsByIds(studentIds),
    fetchObservationPreviewById(observationIds),
    listActiveTrainingPeaksMoveActions(500),
  ]);
  const moveActions = rawMoveActions
    .map(toMinimalMoveAction)
    .filter((value): value is MinimalMoveActionForMatch => value !== null);

  const snapshot = buildTrainingPeaksOperationalSignalsSnapshotFromSignals({
    signals,
    studentNameById: new Map(
      [...studentNameById.entries()].map(([id, name]) => [id, name ?? `Unknown (${id.slice(0, 8)})`])
    ),
    asOfDate,
    limit: 30,
    activeMoveActions: rawMoveActions,
  });
  const visibleSignalIds = new Set(snapshot.sections.flatMap((section) => section.items.map((item) => item.signalId)));

  const duplicateSignalIds = buildDuplicateSignalIdSet(
    signals.map((signal) => ({
      id: signal.id,
      studentId: signal.studentId,
      signalType: signal.signalType,
      validFrom: signal.validFrom,
      validUntil: signal.validUntil,
    }))
  );

  const countsBySignalType = signals.reduce<Record<string, number>>((acc, signal) => {
    acc[signal.signalType] = (acc[signal.signalType] ?? 0) + 1;
    return acc;
  }, {});
  const riskCounts = createEmptyRiskCounts();
  const items: AuditItem[] = [];

  for (const signal of signals) {
    const risks: AuditRisk[] = [];

    if (signal.validUntil && signal.validUntil < asOfDate) {
      risks.push("expired_but_active");
    }
    if (!signal.validUntil && LIFECYCLE_SIGNAL_TYPES.has(signal.signalType)) {
      risks.push("missing_valid_until");
    }
    if (!signal.sourceObservationId || !observationPreviewById.has(signal.sourceObservationId)) {
      risks.push("missing_source_observation");
    }
    if (duplicateSignalIds.has(signal.id)) {
      risks.push("duplicate_candidate");
    }

    const latestSummary = extractLatestSummary(signal);
    const evidencePieces = [
      latestSummary,
      normalizeMaybeString(signal.metadata.follow_up_reason),
      signal.sourceObservationId ? observationPreviewById.get(signal.sourceObservationId) ?? null : null,
    ].filter((value): value is string => Boolean(value));
    const evidenceJoined = compact(evidencePieces.join(" | "));
    const evidenceLower = asLower(evidenceJoined);

    if (signal.signalType === "pause_training" && isPossibleFalsePause(evidenceLower)) {
      risks.push("possible_false_pause");
    }

    if (signal.signalType === "move_workout_candidate") {
      const hasMatch = hasMatchingActiveMoveAction(signal, moveActions);
      if (!hasMatch) {
        risks.push("active_move_without_action");
      }
    }

    if (visibleSignalIds.has(signal.id)) {
      risks.push("visible_in_tp_signals");
    }

    if (shouldMarkManualReview(risks)) {
      risks.push("should_review_manually");
    }

    const dedupedRisks = [...new Set(risks)];
    for (const risk of dedupedRisks) {
      riskCounts[risk] += 1;
    }
    if (!dedupedRisks.length) {
      continue;
    }
    if (!shouldIncludeInRows(dedupedRisks, options.includeHidden)) {
      continue;
    }

    const studentName = studentNameById.get(signal.studentId) ?? `Unknown (${signal.studentId.slice(0, 8)})`;
    items.push({
      studentName,
      signalType: signal.signalType,
      risks: dedupedRisks,
      validFrom: signal.validFrom,
      validUntil: signal.validUntil,
      sourceObservationId: signal.sourceObservationId,
      latestSummary: latestSummary ?? null,
      evidencePreview: truncateText(evidenceJoined, 140),
      recommendation: computeRecommendation(dedupedRisks),
    });
  }

  items.sort((left, right) => {
    const scoreDiff = buildRiskScore(right.risks) - buildRiskScore(left.risks);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    return left.studentName.localeCompare(right.studentName);
  });

  const output: AuditJsonOutput = {
    generatedAt: new Date().toISOString(),
    scannedCount: signals.length,
    countsBySignalType,
    riskCounts,
    items,
  };

  if (options.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  printTextReport(output, options.includeHidden);
}

if (
  process.argv[1] &&
  process.argv[1].endsWith("audit-trainingpeaks-operational-signals-stale.ts")
) {
  void run().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message.startsWith(`${LOG_PREFIX} FAIL:`) ? message : `${LOG_PREFIX} FAIL: ${message}`);
    process.exit(1);
  });
}
