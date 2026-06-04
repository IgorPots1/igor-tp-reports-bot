import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import type { PostgrestError } from "@supabase/supabase-js";

import {
  buildDuplicateSignalIdSet,
  hasMatchingActiveMoveAction,
  isPossibleFalsePause,
  LIFECYCLE_SIGNAL_TYPES,
  type AuditRisk,
} from "./audit-trainingpeaks-operational-signals-stale";
import {
  listActiveTrainingPeaksMoveActions,
  listTrainingPeaksOperationalSignals,
  type TrainingPeaksAction,
  type TrainingPeaksOperationalSignalType,
  type TrainingPeaksStudentOperationalSignal,
} from "@/features/trainingpeaks/repository";
import { DEFAULT_COACH_TIMEZONE, getCoachTodayDateKey } from "@/features/trainingpeaks/operational-follow-up";
import { buildTrainingPeaksOperationalSignalsSnapshotFromSignals } from "@/features/trainingpeaks/service";
import { createSupabaseServerClient } from "@/features/supabase/server";

const LOG_PREFIX = "[cleanup-trainingpeaks-operational-signals]";
export const REQUIRED_CONFIRMATION = "CLEANUP OPERATIONAL SIGNALS";

const PROTECTED_HIDE_SIGNAL_TYPES = new Set<TrainingPeaksOperationalSignalType>([
  "health_issue_started",
  "health_issue_improving",
  "plan_generation_constraint",
  "schedule_unavailability_window",
]);

type CleanupAction = "expire" | "hide" | "review-only";
type CleanupRecommendation = "keep" | "manual_review" | "expire_candidate" | "hide_candidate";
type CleanupMode = "dry-run" | "apply";

type CliOptions = {
  signalIds: string[];
  action: CleanupAction;
  apply: boolean;
  confirm: string | null;
};

type StudentRow = {
  id: string;
  student_name: string | null;
};

type ObservationRow = {
  id: string;
  text_preview: string | null;
};

type SignalRow = {
  id: string;
  student_id: string;
  signal_type: TrainingPeaksOperationalSignalType;
  status: string;
  valid_from: string | null;
  valid_until: string | null;
  source_observation_id: string | null;
  linked_action_id: string | null;
  source_date: string | null;
  target_date: string | null;
  metadata: unknown;
  structured_payload: unknown;
  updated_at: string;
};

type MinimalMoveActionForMatch = {
  id: string;
  studentId: string;
  sourceDate: string | null;
  targetDate: string | null;
};

type SelectedSignalEvaluation = {
  signalId: string;
  studentId: string;
  studentName: string;
  signalType: TrainingPeaksOperationalSignalType;
  status: string;
  validFrom: string | null;
  validUntil: string | null;
  sourceObservationId: string | null;
  latestSummary: string | null;
  risks: AuditRisk[];
  recommendation: CleanupRecommendation;
  visibleInTpSignals: boolean;
  plannedMutation: string[];
  applyAllowed: boolean;
  applyBlockReason: string | null;
};

type ApplyEligibilityInput = {
  action: CleanupAction;
  signalType: TrainingPeaksOperationalSignalType;
  risks: readonly AuditRisk[];
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

function isMissingRelationError(error: PostgrestError): boolean {
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

function isLikelyUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function normalizeMaybeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function compact(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/gu, " ").trim();
}

function asLower(value: string | null | undefined): string {
  return (value ?? "").toLowerCase();
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function parseAction(raw: string): CleanupAction {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "expire" || normalized === "hide" || normalized === "review-only") {
    return normalized;
  }
  throw new Error(`${LOG_PREFIX} FAIL: unknown --action value: ${raw}`);
}

export function parseCleanupCliOptions(argv: string[]): CliOptions {
  const signalIds: string[] = [];
  let action: CleanupAction | null = null;
  let apply = false;
  let confirm: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg.startsWith("--signal-id=")) {
      const value = arg.slice("--signal-id=".length).trim();
      if (!value) {
        throw new Error(`${LOG_PREFIX} FAIL: empty --signal-id value`);
      }
      signalIds.push(value);
      continue;
    }
    if (arg === "--signal-id") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --signal-id`);
      }
      signalIds.push(next);
      index += 1;
      continue;
    }
    if (arg.startsWith("--action=")) {
      action = parseAction(arg.slice("--action=".length));
      continue;
    }
    if (arg === "--action") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --action`);
      }
      action = parseAction(next);
      index += 1;
      continue;
    }
    if (arg.startsWith("--confirm=")) {
      confirm = arg.slice("--confirm=".length);
      continue;
    }
    if (arg === "--confirm") {
      const next = argv[index + 1];
      if (next === undefined || next.trim().startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --confirm`);
      }
      confirm = next;
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`${LOG_PREFIX} FAIL: unknown argument: ${arg}`);
    }
  }

  if (!action) {
    throw new Error(`${LOG_PREFIX} FAIL: --action is required`);
  }
  if (signalIds.length === 0) {
    throw new Error(`${LOG_PREFIX} FAIL: at least one --signal-id is required`);
  }
  for (const signalId of signalIds) {
    if (!isLikelyUuid(signalId)) {
      throw new Error(`${LOG_PREFIX} FAIL: --signal-id must be UUID, got: ${signalId}`);
    }
  }

  const dedupedSignalIds = uniqueStrings(signalIds);
  return { signalIds: dedupedSignalIds, action, apply, confirm };
}

export function validateApplyPrerequisites(options: CliOptions): string | null {
  if (!options.apply) {
    return null;
  }
  if (options.signalIds.length === 0) {
    return "--apply requires explicit --signal-id values";
  }
  if (!options.confirm || options.confirm !== REQUIRED_CONFIRMATION) {
    return `--apply requires --confirm "${REQUIRED_CONFIRMATION}"`;
  }
  if (options.action === "review-only") {
    return "--apply does not support --action=review-only";
  }
  return null;
}

function computeRecommendation(risks: readonly AuditRisk[]): CleanupRecommendation {
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

export function evaluateApplyEligibility(input: ApplyEligibilityInput): {
  allowed: boolean;
  reason: string | null;
} {
  if (input.action === "review-only") {
    return { allowed: false, reason: "review-only is dry-run only" };
  }

  if (input.action === "expire") {
    if (!input.risks.includes("expired_but_active")) {
      return { allowed: false, reason: "expire apply requires expired_but_active risk" };
    }
    return { allowed: true, reason: null };
  }

  if (input.action === "hide") {
    if (PROTECTED_HIDE_SIGNAL_TYPES.has(input.signalType)) {
      return {
        allowed: false,
        reason: `hide apply is blocked for ${input.signalType}; manual review required`,
      };
    }
    if (!input.risks.includes("active_move_without_action")) {
      return { allowed: false, reason: "hide apply requires active_move_without_action risk" };
    }
    if (input.signalType !== "move_workout_candidate") {
      return { allowed: false, reason: "hide apply is currently restricted to move_workout_candidate" };
    }
    return { allowed: true, reason: null };
  }

  return { allowed: false, reason: "unknown action" };
}

async function fetchSignalsByIds(signalIds: readonly string[]): Promise<SignalRow[]> {
  const supabase = createSupabaseServerClient();
  const out: SignalRow[] = [];
  for (let index = 0; index < signalIds.length; index += 200) {
    const chunk = signalIds.slice(index, index + 200);
    const { data, error } = await supabase
      .from("trainingpeaks_student_operational_signals")
      .select(
        "id, student_id, signal_type, status, valid_from, valid_until, source_observation_id, linked_action_id, source_date, target_date, metadata, structured_payload, updated_at"
      )
      .in("id", chunk);
    if (error) {
      if (isMissingRelationError(error)) {
        throw new Error(
          `${LOG_PREFIX} FAIL: trainingpeaks_student_operational_signals table missing; apply migration first`
        );
      }
      throw new Error(`${LOG_PREFIX} FAIL: failed to read selected signals: ${error.message}`);
    }
    out.push(...(((data as SignalRow[] | null) ?? []) as SignalRow[]));
  }
  return out;
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

async function fetchAllActiveSignals(limit = 1000): Promise<TrainingPeaksStudentOperationalSignal[]> {
  const items: TrainingPeaksStudentOperationalSignal[] = [];
  const pageSize = 200;
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  while (items.length < limit && offset < total) {
    const page = await listTrainingPeaksOperationalSignals({
      status: "active",
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
  return items.slice(0, limit);
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

function extractLatestSummary(value: unknown, metadata: unknown): string | null {
  const structuredPayload =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const metadataObject =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  const fromStructured = normalizeMaybeString(structuredPayload.latest_summary);
  if (fromStructured) {
    return fromStructured;
  }
  const fromMetadata = normalizeMaybeString(metadataObject.follow_up_reason);
  if (fromMetadata) {
    return fromMetadata;
  }
  return null;
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function buildCleanupMetadata(input: {
  existing: unknown;
  action: CleanupAction;
  mode: CleanupMode;
  risks: readonly AuditRisk[];
}): Record<string, unknown> {
  return {
    ...normalizeMetadata(input.existing),
    cleanup_operational_signal_action: input.action,
    cleanup_operational_signal_mode: input.mode,
    cleanup_operational_signal_applied_at: new Date().toISOString(),
    cleanup_operational_signal_risks: [...input.risks],
  };
}

function buildPlannedMutation(input: {
  action: CleanupAction;
  signal: SignalRow;
  asOfDate: string;
  risks: readonly AuditRisk[];
}): string[] {
  if (input.action === "review-only") {
    return ["no mutation (review-only)"];
  }

  if (input.action === "hide") {
    return [
      `update status: ${input.signal.status} -> dismissed`,
      "preserve row for audit history",
      `set metadata.cleanup_operational_signal_action="${input.action}"`,
    ];
  }

  const nextValidUntil =
    !input.signal.valid_until || input.signal.valid_until > input.asOfDate
      ? input.asOfDate
      : input.signal.valid_until;
  return [
    `update status: ${input.signal.status} -> expired`,
    `update valid_until: ${input.signal.valid_until ?? "null"} -> ${nextValidUntil}`,
    `set metadata.cleanup_operational_signal_action="${input.action}"`,
  ];
}

function renderSignalDetail(value: SelectedSignalEvaluation): void {
  console.log(`• ${value.signalId}`);
  console.log(`  student: ${value.studentName}`);
  console.log(`  signal_type: ${value.signalType}`);
  console.log(`  valid_from: ${value.validFrom ?? "null"}`);
  console.log(`  valid_until: ${value.validUntil ?? "null"}`);
  console.log(`  source_observation_id: ${value.sourceObservationId ?? "null"}`);
  console.log(`  latest_summary: ${value.latestSummary ?? "null"}`);
  console.log(`  current visible_in_tp_signals: ${value.visibleInTpSignals ? "yes" : "no"}`);
  console.log(`  risks: ${value.risks.join(", ") || "none"}`);
  console.log(`  recommended action from stale audit: ${value.recommendation}`);
  if (!value.applyAllowed && value.applyBlockReason) {
    console.log(`  apply_guard: blocked (${value.applyBlockReason})`);
  }
  console.log("  planned mutation:");
  for (const line of value.plannedMutation) {
    console.log(`    - ${line}`);
  }
}

function parseSignalRows(rows: readonly SignalRow[]): Map<string, SignalRow> {
  const map = new Map<string, SignalRow>();
  for (const row of rows) {
    map.set(row.id, row);
  }
  return map;
}

function ensureAllSelectedSignalsFound(selectedIds: readonly string[], rows: readonly SignalRow[]): void {
  const byId = parseSignalRows(rows);
  const missing = selectedIds.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new Error(`${LOG_PREFIX} FAIL: signal IDs not found: ${missing.join(", ")}`);
  }
}

async function evaluateSelectedSignals(input: {
  options: CliOptions;
  selectedRows: SignalRow[];
  asOfDate: string;
}): Promise<SelectedSignalEvaluation[]> {
  const selectedRowsById = parseSignalRows(input.selectedRows);
  const selectedIdsOrdered = input.options.signalIds.map((id) => selectedRowsById.get(id)!);
  const selectedStudentIds = uniqueStrings(selectedIdsOrdered.map((row) => row.student_id));
  const selectedObservationIds = uniqueStrings(
    selectedIdsOrdered
      .map((row) => row.source_observation_id)
      .filter((value): value is string => Boolean(value))
  );

  const [activeSignals, moveActionsRaw, studentNameById, observationPreviewById] = await Promise.all([
    fetchAllActiveSignals(1200),
    listActiveTrainingPeaksMoveActions(500),
    fetchStudentsByIds(selectedStudentIds),
    fetchObservationPreviewById(selectedObservationIds),
  ]);

  const activeSignalDuplicateSet = buildDuplicateSignalIdSet(
    activeSignals.map((signal) => ({
      id: signal.id,
      studentId: signal.studentId,
      signalType: signal.signalType,
      validFrom: signal.validFrom,
      validUntil: signal.validUntil,
    }))
  );

  const activeMoveActions = moveActionsRaw
    .map(toMinimalMoveAction)
    .filter((value): value is MinimalMoveActionForMatch => value !== null);

  const allActiveStudentIds = uniqueStrings(activeSignals.map((signal) => signal.studentId));
  const allActiveStudentNameMap = await fetchStudentsByIds(allActiveStudentIds);
  const snapshot = buildTrainingPeaksOperationalSignalsSnapshotFromSignals({
    signals: activeSignals,
    studentNameById: allActiveStudentNameMap,
    asOfDate: input.asOfDate,
    limit: 30,
    activeMoveActions: moveActionsRaw,
  });
  const visibleSignalIds = new Set(snapshot.sections.flatMap((section) => section.items.map((item) => item.signalId)));

  return selectedIdsOrdered.map((row): SelectedSignalEvaluation => {
    const latestSummary = extractLatestSummary(row.structured_payload, row.metadata);
    const observationPreview = row.source_observation_id
      ? observationPreviewById.get(row.source_observation_id) ?? null
      : null;
    const evidenceJoined = compact([latestSummary, observationPreview].filter(Boolean).join(" | "));
    const risks: AuditRisk[] = [];

    if (row.valid_until && row.valid_until < input.asOfDate && row.status === "active") {
      risks.push("expired_but_active");
    }
    if (!row.valid_until && LIFECYCLE_SIGNAL_TYPES.has(row.signal_type)) {
      risks.push("missing_valid_until");
    }
    if (!row.source_observation_id || (row.source_observation_id && !observationPreviewById.has(row.source_observation_id))) {
      risks.push("missing_source_observation");
    }
    if (activeSignalDuplicateSet.has(row.id)) {
      risks.push("duplicate_candidate");
    }
    if (row.signal_type === "pause_training" && isPossibleFalsePause(asLower(evidenceJoined))) {
      risks.push("possible_false_pause");
    }
    if (row.signal_type === "move_workout_candidate") {
      const hasMatch = hasMatchingActiveMoveAction(
        {
          studentId: row.student_id,
          linkedActionId: row.linked_action_id,
          sourceDate: row.source_date,
          targetDate: row.target_date,
        },
        activeMoveActions
      );
      if (!hasMatch && row.status === "active") {
        risks.push("active_move_without_action");
      }
    }
    if (visibleSignalIds.has(row.id)) {
      risks.push("visible_in_tp_signals");
    }
    if (shouldMarkManualReview(risks)) {
      risks.push("should_review_manually");
    }

    const dedupedRisks = [...new Set(risks)];
    const recommendation = computeRecommendation(dedupedRisks);
    const applyEligibility = evaluateApplyEligibility({
      action: input.options.action,
      signalType: row.signal_type,
      risks: dedupedRisks,
    });

    return {
      signalId: row.id,
      studentId: row.student_id,
      studentName: studentNameById.get(row.student_id) ?? `Unknown (${row.student_id.slice(0, 8)})`,
      signalType: row.signal_type,
      status: row.status,
      validFrom: row.valid_from,
      validUntil: row.valid_until,
      sourceObservationId: row.source_observation_id,
      latestSummary,
      risks: dedupedRisks,
      recommendation,
      visibleInTpSignals: visibleSignalIds.has(row.id),
      plannedMutation: buildPlannedMutation({
        action: input.options.action,
        signal: row,
        asOfDate: input.asOfDate,
        risks: dedupedRisks,
      }),
      applyAllowed: applyEligibility.allowed,
      applyBlockReason: applyEligibility.reason,
    };
  });
}

function printHeader(input: { mode: CleanupMode; action: CleanupAction; selectedCount: number }): void {
  console.log("Operational Signals cleanup dry-run");
  console.log("");
  console.log(`Mode: ${input.mode}`);
  console.log(`Action: ${input.action}`);
  console.log(`Selected signals: ${input.selectedCount}`);
  console.log("");
}

async function applyMutation(input: {
  options: CliOptions;
  selectedRowsBeforeApply: SignalRow[];
  selectedEvaluations: SelectedSignalEvaluation[];
  asOfDate: string;
}): Promise<number> {
  const supabase = createSupabaseServerClient();
  let mutatedCount = 0;
  const evalById = new Map(input.selectedEvaluations.map((item) => [item.signalId, item] as const));

  for (const row of input.selectedRowsBeforeApply) {
    const selectedEval = evalById.get(row.id);
    if (!selectedEval) {
      continue;
    }
    if (!selectedEval.applyAllowed) {
      throw new Error(
        `${LOG_PREFIX} FAIL: apply blocked for signal ${row.id}: ${selectedEval.applyBlockReason ?? "manual review required"}`
      );
    }
    if (row.status !== "active") {
      throw new Error(`${LOG_PREFIX} FAIL: apply requires active row status; ${row.id} is ${row.status}`);
    }
    const metadata = buildCleanupMetadata({
      existing: row.metadata,
      action: input.options.action,
      mode: "apply",
      risks: selectedEval.risks,
    });
    const updates: Record<string, unknown> = {
      metadata,
      updated_at: new Date().toISOString(),
    };
    if (input.options.action === "hide") {
      updates.status = "dismissed";
    } else if (input.options.action === "expire") {
      updates.status = "expired";
      const nextValidUntil =
        !row.valid_until || row.valid_until > input.asOfDate ? input.asOfDate : row.valid_until;
      updates.valid_until = nextValidUntil;
    } else {
      throw new Error(`${LOG_PREFIX} FAIL: unsupported apply action ${input.options.action}`);
    }

    const write = await supabase
      .from("trainingpeaks_student_operational_signals")
      .update(updates)
      .eq("id", row.id)
      .eq("status", "active")
      .select("id")
      .maybeSingle();

    if (write.error) {
      throw new Error(`${LOG_PREFIX} FAIL: failed to update signal ${row.id}: ${write.error.message}`);
    }
    if (!write.data) {
      throw new Error(`${LOG_PREFIX} FAIL: no row updated for signal ${row.id} (status drift or missing row)`);
    }
    mutatedCount += 1;
  }
  return mutatedCount;
}

async function run(): Promise<void> {
  loadLocalEnvFiles();
  const options = parseCleanupCliOptions(process.argv.slice(2));
  const mode: CleanupMode = options.apply ? "apply" : "dry-run";
  const preApplyValidationError = validateApplyPrerequisites(options);
  if (preApplyValidationError) {
    throw new Error(`${LOG_PREFIX} FAIL: ${preApplyValidationError}`);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(`${LOG_PREFIX} FAIL: missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY`);
  }
  if (!process.env.SUPABASE_URL) {
    process.env.SUPABASE_URL = supabaseUrl;
  }

  const asOfDate = getCoachTodayDateKey(DEFAULT_COACH_TIMEZONE);
  const selectedRows = await fetchSignalsByIds(options.signalIds);
  ensureAllSelectedSignalsFound(options.signalIds, selectedRows);
  const selectedEvaluations = await evaluateSelectedSignals({
    options,
    selectedRows,
    asOfDate,
  });

  printHeader({ mode, action: options.action, selectedCount: selectedEvaluations.length });
  for (const selected of selectedEvaluations) {
    renderSignalDetail(selected);
  }

  if (!options.apply) {
    console.log("");
    console.log("No changes made.");
    console.log(`To apply, rerun with --apply --confirm "${REQUIRED_CONFIRMATION}".`);
    return;
  }

  const blocked = selectedEvaluations.filter((item) => !item.applyAllowed);
  if (blocked.length > 0) {
    const details = blocked
      .map((item) => `${item.signalId}: ${item.applyBlockReason ?? "manual review required"}`)
      .join("; ");
    throw new Error(`${LOG_PREFIX} FAIL: apply blocked for one or more signals: ${details}`);
  }

  const selectedRowsBeforeApply = await fetchSignalsByIds(options.signalIds);
  ensureAllSelectedSignalsFound(options.signalIds, selectedRowsBeforeApply);

  const mutated = await applyMutation({
    options,
    selectedRowsBeforeApply,
    selectedEvaluations,
    asOfDate,
  });

  const selectedRowsAfterApply = await fetchSignalsByIds(options.signalIds);
  ensureAllSelectedSignalsFound(options.signalIds, selectedRowsAfterApply);

  console.log("");
  console.log("Before/after:");
  const afterById = new Map(selectedRowsAfterApply.map((row) => [row.id, row] as const));
  for (const before of selectedRowsBeforeApply) {
    const after = afterById.get(before.id)!;
    console.log(`• ${before.id}`);
    console.log(`  status: ${before.status} -> ${after.status}`);
    console.log(`  valid_until: ${before.valid_until ?? "null"} -> ${after.valid_until ?? "null"}`);
  }
  console.log(`mutated: ${mutated}`);
}

if (
  process.argv[1] &&
  process.argv[1].endsWith("cleanup-trainingpeaks-operational-signals.ts")
) {
  void run().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message.startsWith(`${LOG_PREFIX} FAIL:`) ? message : `${LOG_PREFIX} FAIL: ${message}`);
    process.exit(1);
  });
}
