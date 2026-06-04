import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import type { PostgrestError } from "@supabase/supabase-js";

import { classifyCoachOperationalSignals, type ObservationLike } from "@/features/trainingpeaks/coach-operational-signals";
import type { TrainingPeaksOperationalSignalType } from "@/features/trainingpeaks/repository";
import { createSupabaseServerClient } from "@/features/supabase/server";

const LOG_PREFIX = "[recompute-trainingpeaks-operational-signal]";
const PERSISTABLE_SIGNAL_TYPES = new Set<TrainingPeaksOperationalSignalType>([
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
]);

type CliOptions = {
  sourceObservationId: string;
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
  signal_type: string;
  status: string;
  source_observation_id: string | null;
  structured_payload: unknown;
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

export function parseRecomputeCliOptions(argv: string[]): CliOptions {
  let sourceObservationId: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--dry-run") {
      continue;
    }
    if (arg === "--apply") {
      throw new Error(`${LOG_PREFIX} FAIL: --apply is not supported in this script; dry-run only`);
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
    if (arg.startsWith("--")) {
      throw new Error(`${LOG_PREFIX} FAIL: unknown argument: ${arg}`);
    }
  }

  if (!sourceObservationId) {
    throw new Error(`${LOG_PREFIX} FAIL: --source-observation-id is required`);
  }
  if (!isLikelyUuid(sourceObservationId)) {
    throw new Error(`${LOG_PREFIX} FAIL: --source-observation-id must be UUID, got: ${sourceObservationId}`);
  }
  return { sourceObservationId };
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
    .select("id, signal_type, status, source_observation_id, structured_payload")
    .eq("source_observation_id", sourceObservationId)
    .eq("status", "active")
    .order("updated_at", { ascending: false });
  if (error) {
    throw new Error(`${LOG_PREFIX} FAIL: failed to read existing active signals: ${error.message}`);
  }
  return (data as SignalRow[] | null) ?? [];
}

function pickPersistableCandidates(observation: ObservationLike): Array<{
  signalType: TrainingPeaksOperationalSignalType;
  payload: Record<string, unknown>;
  confidence: string;
}> {
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

async function run(): Promise<void> {
  loadLocalEnvFiles();
  const options = parseRecomputeCliOptions(process.argv.slice(2));

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

  const classificationInput: ObservationLike = {
    sourceType: observation.source_type,
    textPreview: observation.text_preview,
    labels: normalizeLabels(observation.labels),
    metadata: normalizeRecord(observation.metadata),
    observedAt: observation.observed_at,
    studentId: observation.student_id,
  };
  const nextCandidates = pickPersistableCandidates(classificationInput);

  console.log("Operational Signal recompute dry-run");
  console.log("");
  console.log(`source_observation_id: ${options.sourceObservationId}`);
  console.log(`student: ${studentName}`);
  console.log(`source preview: ${compact(observation.text_preview) || "null"}`);
  console.log("");
  console.log("Existing active signals from this observation:");
  if (existingSignals.length === 0) {
    console.log("- none");
  } else {
    for (const signal of existingSignals) {
      console.log(`- signal_id: ${signal.id}`);
      console.log(`  signal_type: ${signal.signal_type}`);
      printSignalLine("  payload: ", normalizeRecord(signal.structured_payload));
    }
  }
  console.log("");
  console.log("New classifier output:");
  if (nextCandidates.length === 0) {
    console.log("- none");
  } else {
    for (const candidate of nextCandidates) {
      console.log(`- signal_type: ${candidate.signalType}`);
      printSignalLine("  payload: ", candidate.payload);
    }
  }

  console.log("");
  console.log("Diff:");
  if (nextCandidates.length === 0) {
    console.log("- no persistable classifier output");
  } else {
    for (const candidate of nextCandidates) {
      const matchingExisting = existingSignals.find((signal) => signal.signal_type === candidate.signalType);
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
  console.log("No changes made.");
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
