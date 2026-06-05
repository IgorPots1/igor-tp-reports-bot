import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import type { PostgrestError } from "@supabase/supabase-js";

import {
  classifyCoachOperationalSignals,
  type ObservationLike,
  type OperationalConfidence,
} from "@/features/trainingpeaks/coach-operational-signals";
import type { TrainingPeaksOperationalSignalType } from "@/features/trainingpeaks/repository";
import { createSupabaseServerClient } from "@/features/supabase/server";

const LOG_PREFIX = "[recompute-trainingpeaks-operational-signal]";
export const RECOMPUTE_REQUIRED_CONFIRMATION = "RECOMPUTE OPERATIONAL SIGNAL";
export const RECOMPUTE_CLASSIFIER_VERSION = "coach-operational-signals-v1";
export const RECOMPUTE_BY_TASK = "operational_signal_single_observation_recompute_apply_v1";

const PERSISTABLE_SIGNAL_TYPES = new Set<TrainingPeaksOperationalSignalType>([
  "schedule_availability_window",
  "schedule_unavailability_window",
  "resume_training",
  "pause_training",
  "health_issue_started",
  "health_issue_resolved",
  "health_issue_improving",
  "pain_injury",
  "external_training_context",
  "move_workout_candidate",
  "plan_generation_constraint",
  "race_load_context",
]);

type RecomputeMode = "dry-run" | "apply";

type CliOptions = {
  sourceObservationId: string;
  apply: boolean;
  confirm: string | null;
};

type ObservationRow = {
  id: string;
  student_id: string | null;
  source_type: string;
  observed_at: string;
  text_preview: string | null;
  labels: unknown;
  metadata: unknown;
};

type StudentRow = {
  id: string;
  student_name: string | null;
};

type SignalRow = {
  id: string;
  student_id: string;
  signal_type: string;
  status: string;
  source_observation_id: string | null;
  structured_payload: unknown;
  metadata: unknown;
  confidence: number | null;
};

type PersistableCandidate = {
  signalType: TrainingPeaksOperationalSignalType;
  payload: Record<string, unknown>;
  confidence: OperationalConfidence;
};

type ApplyRecomputeUpdate = {
  structuredPayload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  confidence: number | null;
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

function normalizeRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function normalizeLabels(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function compact(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/gu, " ").trim();
}

function confidenceToNumeric(value: OperationalConfidence): number {
  if (value === "high") {
    return 0.9;
  }
  if (value === "medium") {
    return 0.65;
  }
  return 0.35;
}

export function parseRecomputeCliOptions(argv: string[]): CliOptions {
  let sourceObservationId: string | null = null;
  let dryRun = false;
  let apply = false;
  let confirm: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg.startsWith("--source-observation-id=")) {
      sourceObservationId = arg.slice("--source-observation-id=".length).trim();
      continue;
    }
    if (arg === "--source-observation-id") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --source-observation-id`);
      }
      sourceObservationId = next;
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

  if (dryRun && apply) {
    throw new Error(`${LOG_PREFIX} FAIL: --dry-run and --apply cannot be used together`);
  }
  if (!sourceObservationId) {
    throw new Error(`${LOG_PREFIX} FAIL: --source-observation-id is required`);
  }
  if (!isLikelyUuid(sourceObservationId)) {
    throw new Error(`${LOG_PREFIX} FAIL: --source-observation-id must be UUID, got: ${sourceObservationId}`);
  }
  return { sourceObservationId, apply, confirm };
}

export function validateRecomputeApplyPrerequisites(options: CliOptions): string | null {
  if (!options.apply) {
    return null;
  }
  if (!options.confirm || options.confirm !== RECOMPUTE_REQUIRED_CONFIRMATION) {
    return `--apply requires --confirm "${RECOMPUTE_REQUIRED_CONFIRMATION}"`;
  }
  return null;
}

export function validateActiveSignalsForApply(activeSignalCount: number): string | null {
  if (activeSignalCount === 0) {
    return "no active signals linked to source observation";
  }
  if (activeSignalCount > 1) {
    return `expected exactly one active signal, found ${activeSignalCount}`;
  }
  return null;
}

export function buildRecomputeMetadata(input: {
  existing: unknown;
  sourceObservationId: string;
  now?: string;
}): Record<string, unknown> {
  return {
    ...normalizeRecord(input.existing),
    recomputed_at: input.now ?? new Date().toISOString(),
    recompute_source_observation_id: input.sourceObservationId,
    recompute_reason: "single_observation_guarded_recompute",
    recompute_confirmed: true,
    classifier_version: RECOMPUTE_CLASSIFIER_VERSION,
    recomputed_by_task: RECOMPUTE_BY_TASK,
  };
}

export function mergeRecomputeStructuredPayload(
  existingPayload: Record<string, unknown>,
  nextPayload: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...existingPayload,
    ...nextPayload,
  };
}

export function findMatchingRecomputeCandidate(
  existingSignalType: string,
  candidates: readonly PersistableCandidate[]
): PersistableCandidate | null {
  return candidates.find((candidate) => candidate.signalType === existingSignalType) ?? null;
}

export function selectRecomputeCandidateForApply(
  activeSignalCount: number,
  existingSignalType: string,
  candidates: readonly PersistableCandidate[]
): PersistableCandidate | null {
  if (candidates.length === 0) {
    return null;
  }
  if (activeSignalCount === 1) {
    return findMatchingRecomputeCandidate(existingSignalType, candidates) ?? candidates[0]!;
  }
  return findMatchingRecomputeCandidate(existingSignalType, candidates);
}

export function buildApplyRecomputeUpdate(input: {
  existingPayload: Record<string, unknown>;
  existingMetadata: unknown;
  sourceObservationId: string;
  candidate: PersistableCandidate;
  now?: string;
}): ApplyRecomputeUpdate {
  const structuredPayload = mergeRecomputeStructuredPayload(input.existingPayload, input.candidate.payload);
  const metadata = buildRecomputeMetadata({
    existing: input.existingMetadata,
    sourceObservationId: input.sourceObservationId,
    now: input.now,
  });
  return {
    structuredPayload,
    metadata,
    confidence: confidenceToNumeric(input.candidate.confidence),
  };
}

export function buildPlannedRecomputeMutation(input: {
  sourceObservationId: string;
  existingPayload: Record<string, unknown>;
  existingMetadata: unknown;
  candidate: PersistableCandidate;
}): string[] {
  const update = buildApplyRecomputeUpdate(input);
  const lines = buildRecomputeDiff(input.existingPayload, update.structuredPayload);
  lines.push(`set metadata.recomputed_at="<now>"`);
  lines.push(`set metadata.recompute_source_observation_id="${input.sourceObservationId}"`);
  lines.push(`set metadata.recompute_reason="single_observation_guarded_recompute"`);
  lines.push(`set metadata.recompute_confirmed=true`);
  lines.push(`set metadata.classifier_version="${RECOMPUTE_CLASSIFIER_VERSION}"`);
  lines.push(`set metadata.recomputed_by_task="${RECOMPUTE_BY_TASK}"`);
  return lines;
}

async function fetchObservationById(sourceObservationId: string): Promise<ObservationRow> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_telegram_context_observations")
    .select("id, student_id, source_type, observed_at, text_preview, labels, metadata")
    .eq("id", sourceObservationId)
    .maybeSingle();

  if (error) {
    if (isMissingRelationError(error)) {
      throw new Error(
        `${LOG_PREFIX} FAIL: trainingpeaks_telegram_context_observations table missing; apply migration first`
      );
    }
    throw new Error(`${LOG_PREFIX} FAIL: failed to read source observation: ${error.message}`);
  }
  if (!data) {
    throw new Error(`${LOG_PREFIX} FAIL: source observation not found: ${sourceObservationId}`);
  }
  return data as ObservationRow;
}

async function fetchStudentNameById(studentId: string | null): Promise<string> {
  if (!studentId) {
    return "Unknown student";
  }
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .select("id, student_name")
    .eq("id", studentId)
    .maybeSingle();
  if (error) {
    throw new Error(`${LOG_PREFIX} FAIL: failed to read student: ${error.message}`);
  }
  if (!data) {
    return `Unknown (${studentId.slice(0, 8)})`;
  }
  const row = data as StudentRow;
  return row.student_name?.trim() || `Unknown (${row.id.slice(0, 8)})`;
}

async function fetchActiveSignalsForObservation(sourceObservationId: string): Promise<SignalRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_student_operational_signals")
    .select(
      "id, student_id, signal_type, status, source_observation_id, structured_payload, metadata, confidence"
    )
    .eq("source_observation_id", sourceObservationId)
    .eq("status", "active")
    .order("updated_at", { ascending: false });
  if (error) {
    throw new Error(`${LOG_PREFIX} FAIL: failed to read existing active signals: ${error.message}`);
  }
  return (data as SignalRow[] | null) ?? [];
}

function buildClassificationInput(observation: ObservationRow): ObservationLike {
  return {
    sourceType: observation.source_type,
    textPreview: observation.text_preview,
    labels: normalizeLabels(observation.labels),
    metadata: normalizeRecord(observation.metadata),
    observedAt: observation.observed_at,
    studentId: observation.student_id,
  };
}

function pickPersistableCandidates(observation: ObservationLike): PersistableCandidate[] {
  const all = classifyCoachOperationalSignals(observation);
  const filtered = all.filter((candidate) =>
    PERSISTABLE_SIGNAL_TYPES.has(candidate.signal_type as TrainingPeaksOperationalSignalType)
  );
  return filtered.map((candidate) => ({
    signalType: candidate.signal_type as TrainingPeaksOperationalSignalType,
    payload: normalizeRecord(candidate.structured_payload),
    confidence: candidate.confidence,
  }));
}

function stringify(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function printSignalLine(prefix: string, value: unknown): void {
  const json = stringify(value).replace(/\n/gu, "\n  ");
  console.log(`${prefix}${json}`);
}

export function buildRecomputeDiff(
  existingPayload: Record<string, unknown> | null,
  nextPayload: Record<string, unknown>
): string[] {
  const lines: string[] = [];
  const existingPlanned = Array.isArray(existingPayload?.planned_training_dates)
    ? (existingPayload?.planned_training_dates as unknown[]).map(String)
    : [];
  const nextPlanned = Array.isArray(nextPayload.planned_training_dates)
    ? (nextPayload.planned_training_dates as unknown[]).map(String)
    : [];
  if (existingPlanned.join("|") !== nextPlanned.join("|")) {
    lines.push(`would set planned_training_dates: ${JSON.stringify(nextPlanned)}`);
  }

  const existingUnavailable = Array.isArray(existingPayload?.unavailable_dates)
    ? (existingPayload?.unavailable_dates as unknown[]).map(String)
    : [];
  const nextUnavailable = Array.isArray(nextPayload.unavailable_dates)
    ? (nextPayload.unavailable_dates as unknown[]).map(String)
    : [];
  if (existingUnavailable.join("|") !== nextUnavailable.join("|")) {
    lines.push(`would set unavailable_dates: ${JSON.stringify(nextUnavailable)}`);
  }

  const existingPlanningStatus =
    typeof existingPayload?.planning_status === "string" ? existingPayload.planning_status : null;
  const nextPlanningStatus = typeof nextPayload.planning_status === "string" ? nextPayload.planning_status : null;
  if (existingPlanningStatus !== nextPlanningStatus) {
    lines.push(`would set planning_status: ${JSON.stringify(nextPlanningStatus)}`);
  }

  const existingSummary = typeof existingPayload?.latest_summary === "string" ? existingPayload.latest_summary : null;
  const nextSummary = typeof nextPayload.latest_summary === "string" ? nextPayload.latest_summary : null;
  if (existingSummary !== nextSummary) {
    lines.push(`would update latest_summary: ${JSON.stringify(nextSummary)}`);
  }

  if (lines.length === 0) {
    lines.push("no payload changes detected");
  }
  return lines;
}

function printRecomputeReport(input: {
  mode: RecomputeMode;
  sourceObservationId: string;
  studentName: string;
  observationPreview: string | null;
  existingSignals: SignalRow[];
  nextCandidates: PersistableCandidate[];
}): void {
  const title = input.mode === "apply" ? "Operational Signal recompute apply" : "Operational Signal recompute dry-run";
  console.log(title);
  console.log("");
  console.log(`Mode: ${input.mode}`);
  console.log(`source_observation_id: ${input.sourceObservationId}`);
  console.log(`student: ${input.studentName}`);
  console.log(`source preview: ${compact(input.observationPreview) || "null"}`);
  console.log("");
  console.log("Existing active signals from this observation:");
  if (input.existingSignals.length === 0) {
    console.log("- none");
  } else {
    for (const signal of input.existingSignals) {
      console.log(`- signal_id: ${signal.id}`);
      console.log(`  signal_type: ${signal.signal_type}`);
      printSignalLine("  payload: ", normalizeRecord(signal.structured_payload));
    }
  }
  console.log("");
  console.log("New classifier output:");
  if (input.nextCandidates.length === 0) {
    console.log("- none");
  } else {
    for (const candidate of input.nextCandidates) {
      console.log(`- signal_type: ${candidate.signalType}`);
      printSignalLine("  payload: ", candidate.payload);
    }
  }

  console.log("");
  console.log("Diff:");
  if (input.nextCandidates.length === 0) {
    console.log("- no persistable classifier output");
  } else if (input.existingSignals.length === 1) {
    const activeSignal = input.existingSignals[0]!;
    const candidate = selectRecomputeCandidateForApply(
      input.existingSignals.length,
      activeSignal.signal_type,
      input.nextCandidates
    );
    if (!candidate) {
      console.log("- no persistable classifier output");
      return;
    }
    const existingPayload = normalizeRecord(activeSignal.structured_payload);
    const mergedPayload = mergeRecomputeStructuredPayload(existingPayload, candidate.payload);
    const diffLines = buildRecomputeDiff(existingPayload, mergedPayload);
    console.log(`- linked active signal ${activeSignal.id} (${activeSignal.signal_type}):`);
    if (candidate.signalType !== activeSignal.signal_type) {
      console.log(`  - classifier primary output type: ${candidate.signalType}`);
    }
    for (const line of diffLines) {
      console.log(`  - ${line}`);
    }
  } else {
    for (const candidate of input.nextCandidates) {
      const matchingExisting = input.existingSignals.find((signal) => signal.signal_type === candidate.signalType);
      const diffLines = buildRecomputeDiff(
        matchingExisting ? normalizeRecord(matchingExisting.structured_payload) : null,
        candidate.payload
      );
      console.log(`- ${candidate.signalType}:`);
      for (const line of diffLines) {
        console.log(`  - ${line}`);
      }
    }
  }
}

async function applyRecomputeMutation(input: {
  sourceObservationId: string;
  signal: SignalRow;
  candidate: PersistableCandidate;
}): Promise<void> {
  const existingPayload = normalizeRecord(input.signal.structured_payload);
  const update = buildApplyRecomputeUpdate({
    existingPayload,
    existingMetadata: input.signal.metadata,
    sourceObservationId: input.sourceObservationId,
    candidate: input.candidate,
  });

  const supabase = createSupabaseServerClient();
  const write = await supabase
    .from("trainingpeaks_student_operational_signals")
    .update({
      structured_payload: update.structuredPayload,
      metadata: update.metadata,
      confidence: update.confidence,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.signal.id)
    .eq("status", "active")
    .eq("source_observation_id", input.sourceObservationId)
    .select("id")
    .maybeSingle();

  if (write.error) {
    throw new Error(`${LOG_PREFIX} FAIL: failed to update signal ${input.signal.id}: ${write.error.message}`);
  }
  if (!write.data) {
    throw new Error(
      `${LOG_PREFIX} FAIL: no row updated for signal ${input.signal.id} (status drift, missing row, or observation mismatch)`
    );
  }
}

async function run(): Promise<void> {
  loadLocalEnvFiles();
  const options = parseRecomputeCliOptions(process.argv.slice(2));
  const mode: RecomputeMode = options.apply ? "apply" : "dry-run";
  const preApplyValidationError = validateRecomputeApplyPrerequisites(options);
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

  const observation = await fetchObservationById(options.sourceObservationId);
  const studentName = await fetchStudentNameById(observation.student_id);
  const existingSignals = await fetchActiveSignalsForObservation(options.sourceObservationId);
  const nextCandidates = pickPersistableCandidates(buildClassificationInput(observation));

  printRecomputeReport({
    mode,
    sourceObservationId: options.sourceObservationId,
    studentName,
    observationPreview: observation.text_preview,
    existingSignals,
    nextCandidates,
  });

  if (mode === "dry-run") {
    console.log("No changes made.");
    console.log(`To apply, rerun with --apply --confirm "${RECOMPUTE_REQUIRED_CONFIRMATION}".`);
    return;
  }

  const observationBeforeWrite = await fetchObservationById(options.sourceObservationId);
  const activeSignalsBeforeWrite = await fetchActiveSignalsForObservation(options.sourceObservationId);
  const activeSignalGuard = validateActiveSignalsForApply(activeSignalsBeforeWrite.length);
  if (activeSignalGuard) {
    throw new Error(`${LOG_PREFIX} FAIL: ${activeSignalGuard}`);
  }

  const activeSignal = activeSignalsBeforeWrite[0]!;
  const candidatesBeforeWrite = pickPersistableCandidates(buildClassificationInput(observationBeforeWrite));
  const matchingCandidate = selectRecomputeCandidateForApply(
    activeSignalsBeforeWrite.length,
    activeSignal.signal_type,
    candidatesBeforeWrite
  );
  if (!matchingCandidate) {
    throw new Error(`${LOG_PREFIX} FAIL: no persistable classifier output for source observation`);
  }

  await applyRecomputeMutation({
    sourceObservationId: options.sourceObservationId,
    signal: activeSignal,
    candidate: matchingCandidate,
  });

  console.log("");
  console.log(`Applied recompute to signal_id: ${activeSignal.id}`);
}

if (
  process.argv[1] &&
  process.argv[1].endsWith("recompute-trainingpeaks-operational-signal.ts")
) {
  void run().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message.startsWith(`${LOG_PREFIX} FAIL:`) ? message : `${LOG_PREFIX} FAIL: ${message}`);
    process.exit(1);
  });
}
