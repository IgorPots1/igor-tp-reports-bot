import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import type { PostgrestError } from "@supabase/supabase-js";

import {
  upsertTrainingPeaksOperationalSignalFromCandidate,
  type TrainingPeaksOperationalSignalType,
} from "@/features/trainingpeaks/repository";
import { createSupabaseServerClient } from "@/features/supabase/server";

import {
  classifyCoachOperationalSignal,
  type ObservationLike,
  type OperationalConfidence,
  type OperationalPrimaryBucket,
} from "./lib/coach-operational-signals";

const LOG_PREFIX = "[persist-coach-operational-signals]";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_FETCH = 4000;
const CLASSIFIER_VERSION = "coach-operational-signals-v1";

const ALLOWED_SOURCE_VALUES = new Set(["all", "business_dm", "group_topic", "general_group"]);
const DB_SOURCE_BY_CLI: Record<string, string> = {
  business_dm: "business_dm",
  group_topic: "group_topic",
  general_group: "group_general",
};

const ACTIONABLE_BUCKETS = new Set<OperationalPrimaryBucket>([
  "operational_signal",
  "coach_case",
  "trainingpeaks_action",
  "health_lifecycle_signal",
]);

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

type CliSource = "all" | "business_dm" | "group_topic" | "general_group";

type CliOptions = {
  limit: number;
  student: string | null;
  source: CliSource;
  onlyActionable: boolean;
  apply: boolean;
  confirm: boolean;
  json: boolean;
};

type StudentRow = {
  id: string;
  student_id: string;
  student_name: string;
};

type ObservationRow = {
  id: string;
  student_id: string | null;
  source_type: string | null;
  chat_id: string | null;
  message_id: string | null;
  message_thread_id: number | null;
  text_preview: string | null;
  labels: unknown;
  metadata: unknown;
  observed_at: string | null;
  created_at: string;
};

type CandidateWriteStatus =
  | "dry_run"
  | "inserted"
  | "existing"
  | "updated"
  | "skipped"
  | "error";

type CandidateOutput = {
  student: string;
  source_type: string;
  signal_type: string | null;
  valid_from: string | null;
  valid_until: string | null;
  source_date: string | null;
  target_date: string | null;
  confidence: number | null;
  dedupe_key: string | null;
  write_status: CandidateWriteStatus;
  observation_id: string;
  reason: string;
};

type RunSummary = {
  processed_observations: number;
  candidate_signals: number;
  inserted: number;
  existing_deduped: number;
  updated: number;
  skipped: number;
  errors: number;
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

function parseSource(raw: string): CliSource {
  const normalized = raw.trim().toLowerCase();
  if (!ALLOWED_SOURCE_VALUES.has(normalized)) {
    throw new Error(`${LOG_PREFIX} FAIL: invalid --source value: ${raw}`);
  }
  return normalized as CliSource;
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    limit: DEFAULT_LIMIT,
    student: null,
    source: "all",
    onlyActionable: false,
    apply: false,
    confirm: false,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--dry-run") {
      continue;
    }
    if (arg === "--only-actionable") {
      options.onlyActionable = true;
      continue;
    }
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--confirm") {
      options.confirm = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
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
    if (arg.startsWith("--source=")) {
      options.source = parseSource(arg.slice("--source=".length));
      continue;
    }
    if (arg === "--source") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --source`);
      }
      options.source = parseSource(next);
      index += 1;
      continue;
    }
  }

  if (options.apply && !options.confirm) {
    throw new Error(`${LOG_PREFIX} FAIL: write mode requires both --apply and --confirm`);
  }
  if (!options.apply && options.confirm) {
    throw new Error(`${LOG_PREFIX} FAIL: --confirm requires --apply`);
  }

  return options;
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

function normalizeMatch(input: string): string {
  return input.toLowerCase().replace(/\s+/gu, " ").trim();
}

function coerceStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const out: string[] = [];
  for (const item of input) {
    if (typeof item === "string" && item.trim()) {
      out.push(item.trim());
    }
  }
  return out;
}

function coerceObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  return input as Record<string, unknown>;
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

function toIsoObservedAt(observation: ObservationRow): string {
  return observation.observed_at ?? observation.created_at;
}

function normalizeDate(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/u.test(normalized) ? normalized : null;
}

function normalizeDay(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`);
  return `{${entries.join(",")}}`;
}

function buildDedupeKey(input: {
  studentId: string;
  sourceObservationId: string;
  signalType: TrainingPeaksOperationalSignalType;
  sourceType: string;
  validFrom: string | null;
  validUntil: string | null;
  sourceDate: string | null;
  targetDate: string | null;
  sourceDay: string | null;
  targetDay: string | null;
  structuredPayload: Record<string, unknown>;
}): string {
  const raw = [
    input.studentId,
    input.sourceObservationId,
    input.signalType,
    input.sourceType,
    input.validFrom ?? "",
    input.validUntil ?? "",
    input.sourceDate ?? "",
    input.targetDate ?? "",
    input.sourceDay ?? "",
    input.targetDay ?? "",
    stableJsonStringify(input.structuredPayload),
  ].join("|");
  return createHash("sha256").update(raw).digest("hex");
}

function isActionableClassification(input: {
  primaryBucket: OperationalPrimaryBucket;
  secondaryBuckets: OperationalPrimaryBucket[];
}): boolean {
  if (ACTIONABLE_BUCKETS.has(input.primaryBucket)) {
    return true;
  }
  return input.secondaryBuckets.some((bucket) => ACTIONABLE_BUCKETS.has(bucket));
}

function parseTelegramBigInt(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value.trim());
  if (!Number.isSafeInteger(parsed)) {
    return null;
  }
  return parsed;
}

async function fetchStudents(studentQuery: string | null): Promise<Map<string, StudentRow>> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .select("id, student_id, student_name")
    .limit(5000);
  if (error) {
    throw new Error(`${LOG_PREFIX} FAIL: trainingpeaks_students: ${error.message}`);
  }
  const rows = (data as StudentRow[] | null) ?? [];
  if (!studentQuery) {
    return new Map(rows.map((row) => [row.id, row]));
  }
  const query = normalizeMatch(studentQuery);
  const filtered = rows.filter((row) => {
    return (
      row.id.toLowerCase().startsWith(query) ||
      row.student_id.toLowerCase().includes(query) ||
      row.student_name.toLowerCase().includes(query)
    );
  });
  return new Map(filtered.map((row) => [row.id, row]));
}

async function fetchObservations(options: CliOptions, studentIds: string[]): Promise<ObservationRow[]> {
  const supabase = createSupabaseServerClient();
  const selectLimit = Math.min(MAX_FETCH, Math.max(options.limit * 12, 200));
  let query = supabase
    .from("trainingpeaks_telegram_context_observations")
    .select(
      "id, student_id, source_type, chat_id, message_id, message_thread_id, text_preview, labels, metadata, observed_at, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(selectLimit);

  if (options.source !== "all") {
    query = query.eq("source_type", DB_SOURCE_BY_CLI[options.source]!);
  } else {
    query = query.in("source_type", ["business_dm", "group_topic", "group_general"]);
  }
  if (studentIds.length > 0) {
    query = query.in("student_id", studentIds);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingRelationError(error)) {
      return [];
    }
    throw new Error(`${LOG_PREFIX} FAIL: trainingpeaks_telegram_context_observations: ${error.message}`);
  }
  return (data as ObservationRow[] | null) ?? [];
}

function printTextOutput(
  options: CliOptions,
  summary: RunSummary,
  candidates: CandidateOutput[]
): void {
  console.log(`${LOG_PREFIX} mode=${options.apply ? "apply" : "dry-run"}`);
  console.log(`${LOG_PREFIX} source=${options.source}`);
  console.log(`${LOG_PREFIX} limit=${options.limit}`);
  console.log(`${LOG_PREFIX} only_actionable=${options.onlyActionable}`);
  if (!options.apply) {
    console.log(`${LOG_PREFIX} apply=false (no DB writes)`);
  } else {
    console.log(`${LOG_PREFIX} apply=true confirm=true`);
  }

  for (const row of candidates) {
    console.log("");
    console.log(`- student=${row.student}`);
    console.log(`  source_type=${row.source_type}`);
    console.log(`  signal_type=${row.signal_type ?? "null"}`);
    console.log(`  valid_from=${row.valid_from ?? "null"}`);
    console.log(`  valid_until=${row.valid_until ?? "null"}`);
    console.log(`  source_date=${row.source_date ?? "null"}`);
    console.log(`  target_date=${row.target_date ?? "null"}`);
    console.log(`  confidence=${row.confidence ?? "null"}`);
    console.log(`  dedupe_key=${row.dedupe_key ?? "null"}`);
    console.log(`  write_status=${row.write_status}`);
    console.log(`  reason=${row.reason}`);
    console.log(`  observation_id=${row.observation_id}`);
  }

  console.log("");
  console.log(`${LOG_PREFIX} processed_observations=${summary.processed_observations}`);
  console.log(`${LOG_PREFIX} candidate_signals=${summary.candidate_signals}`);
  console.log(`${LOG_PREFIX} inserted=${summary.inserted}`);
  console.log(`${LOG_PREFIX} existing_deduped=${summary.existing_deduped}`);
  console.log(`${LOG_PREFIX} updated=${summary.updated}`);
  console.log(`${LOG_PREFIX} skipped=${summary.skipped}`);
  console.log(`${LOG_PREFIX} errors=${summary.errors}`);
  console.log(`${LOG_PREFIX} OK persistence foundation run complete`);
}

async function run(): Promise<void> {
  loadLocalEnvFiles();
  const options = parseCliOptions(process.argv.slice(2));
  const studentById = await fetchStudents(options.student);
  if (options.student && studentById.size === 0) {
    throw new Error(`${LOG_PREFIX} FAIL: no students match --student`);
  }

  const rows = await fetchObservations(options, [...studentById.keys()]);
  const summary: RunSummary = {
    processed_observations: 0,
    candidate_signals: 0,
    inserted: 0,
    existing_deduped: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
  };
  const outputRows: CandidateOutput[] = [];

  for (const row of rows) {
    if (outputRows.length >= options.limit) {
      break;
    }
    summary.processed_observations += 1;

    if (!row.student_id) {
      summary.skipped += 1;
      if (!options.onlyActionable) {
        outputRows.push({
          student: "unknown",
          source_type: row.source_type ?? "unknown",
          signal_type: null,
          valid_from: null,
          valid_until: null,
          source_date: null,
          target_date: null,
          confidence: null,
          dedupe_key: null,
          write_status: "skipped",
          observation_id: row.id,
          reason: "missing_student_id",
        });
      }
      continue;
    }

    const student = studentById.get(row.student_id);
    if (!student) {
      summary.skipped += 1;
      continue;
    }

    const sourceType = (row.source_type ?? "").toLowerCase();
    const classification = classifyCoachOperationalSignal({
      sourceType,
      textPreview: row.text_preview,
      labels: coerceStringArray(row.labels).map((label) => label.toLowerCase()),
      metadata: coerceObject(row.metadata),
      observedAt: toIsoObservedAt(row),
      studentId: row.student_id,
    } as ObservationLike);

    const signalType = classification.signal_type;
    const isActionable = isActionableClassification({
      primaryBucket: classification.primary_bucket,
      secondaryBuckets: classification.secondary_buckets,
    });
    const persistableSignalType =
      signalType &&
      PERSISTABLE_SIGNAL_TYPES.has(signalType as TrainingPeaksOperationalSignalType)
        ? (signalType as TrainingPeaksOperationalSignalType)
        : null;

    if (
      !persistableSignalType ||
      classification.primary_bucket === "skip" ||
      !isActionable
    ) {
      summary.skipped += 1;
      if (!options.onlyActionable) {
        outputRows.push({
          student: `${student.student_name} (${student.student_id})`,
          source_type: sourceType || "unknown",
          signal_type: signalType,
          valid_from: normalizeDate(classification.structured_payload.valid_from),
          valid_until: normalizeDate(classification.structured_payload.valid_until),
          source_date: normalizeDate(classification.structured_payload.source_date),
          target_date: normalizeDate(classification.structured_payload.target_date),
          confidence: confidenceToNumeric(classification.confidence),
          dedupe_key: null,
          write_status: "skipped",
          observation_id: row.id,
          reason: !signalType
            ? "missing_signal_type"
            : !isActionable
              ? "non_actionable_bucket"
              : "skip_or_non_persistable",
        });
      }
      continue;
    }

    summary.candidate_signals += 1;

    const validFrom = normalizeDate(classification.structured_payload.valid_from);
    const validUntil = normalizeDate(classification.structured_payload.valid_until);
    const sourceDate = normalizeDate(classification.structured_payload.source_date);
    const targetDate = normalizeDate(classification.structured_payload.target_date);
    const sourceDay = normalizeDay(
      (classification.structured_payload as Record<string, unknown>).source_day
    );
    const targetDay = normalizeDay(
      (classification.structured_payload as Record<string, unknown>).target_day
    );
    const dedupeKey = buildDedupeKey({
      studentId: row.student_id,
      sourceObservationId: row.id,
      signalType: persistableSignalType,
      sourceType: sourceType || "unknown",
      validFrom,
      validUntil,
      sourceDate,
      targetDate,
      sourceDay,
      targetDay,
      structuredPayload: classification.structured_payload as Record<string, unknown>,
    });

    if (!options.apply) {
      outputRows.push({
        student: `${student.student_name} (${student.student_id})`,
        source_type: sourceType || "unknown",
        signal_type: persistableSignalType,
        valid_from: validFrom,
        valid_until: validUntil,
        source_date: sourceDate,
        target_date: targetDate,
        confidence: confidenceToNumeric(classification.confidence),
        dedupe_key: dedupeKey,
        write_status: "dry_run",
        observation_id: row.id,
        reason: classification.reason,
      });
      continue;
    }

    try {
      const result = await upsertTrainingPeaksOperationalSignalFromCandidate({
        studentId: row.student_id,
        signalType: persistableSignalType,
        sourceType: sourceType || "unknown",
        sourceObservationId: row.id,
        telegramChatId: parseTelegramBigInt(row.chat_id),
        telegramMessageId: parseTelegramBigInt(row.message_id),
        telegramMessageThreadId: row.message_thread_id,
        structuredPayload: classification.structured_payload as Record<string, unknown>,
        confidence: confidenceToNumeric(classification.confidence),
        validFrom,
        validUntil,
        sourceDate,
        targetDate,
        sourceDay,
        targetDay,
        dedupeKey,
        metadata: {
          classifier_version: CLASSIFIER_VERSION,
          classifier_reason: classification.reason,
          classifier_confidence: classification.confidence,
          primary_bucket: classification.primary_bucket,
          secondary_buckets: classification.secondary_buckets,
          source_script: "persist-coach-operational-signals",
        },
      });
      if (result.writeStatus === "inserted") {
        summary.inserted += 1;
      } else if (result.writeStatus === "existing") {
        summary.existing_deduped += 1;
      } else if (result.writeStatus === "updated") {
        summary.updated += 1;
      }
      outputRows.push({
        student: `${student.student_name} (${student.student_id})`,
        source_type: sourceType || "unknown",
        signal_type: persistableSignalType,
        valid_from: validFrom,
        valid_until: validUntil,
        source_date: sourceDate,
        target_date: targetDate,
        confidence: confidenceToNumeric(classification.confidence),
        dedupe_key: dedupeKey,
        write_status: result.writeStatus,
        observation_id: row.id,
        reason: classification.reason,
      });
    } catch (error) {
      summary.errors += 1;
      outputRows.push({
        student: `${student.student_name} (${student.student_id})`,
        source_type: sourceType || "unknown",
        signal_type: persistableSignalType,
        valid_from: validFrom,
        valid_until: validUntil,
        source_date: sourceDate,
        target_date: targetDate,
        confidence: confidenceToNumeric(classification.confidence),
        dedupe_key: dedupeKey,
        write_status: "error",
        observation_id: row.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          mode: options.apply ? "apply" : "dry_run",
          options,
          summary,
          candidates: outputRows,
        },
        null,
        2
      )
    );
    return;
  }

  printTextOutput(options, summary, outputRows);
}

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.startsWith(`${LOG_PREFIX} FAIL:`) ? message : `${LOG_PREFIX} FAIL: ${message}`);
  process.exit(1);
});
