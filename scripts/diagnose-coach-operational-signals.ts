import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import type { PostgrestError } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/features/supabase/server";

import { classifyCoachOperationalSignal, type ObservationLike } from "./lib/coach-operational-signals";

const LOG_PREFIX = "[diagnose-coach-operational-signals]";
const DEFAULT_LIMIT = 20;
const DEFAULT_DAYS = 30;
const MAX_LIMIT = 200;
const MAX_FETCH = 2000;
const ALLOWED_SOURCE_VALUES = new Set(["all", "business_dm", "group_topic", "general_group"]);
const DB_SOURCE_BY_CLI: Record<string, string> = {
  business_dm: "business_dm",
  group_topic: "group_topic",
  general_group: "group_general",
};

type CliSource = "all" | "business_dm" | "group_topic" | "general_group";

type CliOptions = {
  limit: number;
  student: string | null;
  source: CliSource;
  days: number;
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
  text_preview: string | null;
  labels: unknown;
  metadata: unknown;
  observed_at: string | null;
  created_at: string;
};

type OutputRow = {
  student: {
    slug: string;
    name: string;
    id: string;
  };
  observation_id: string;
  source_type: string;
  preview: string;
  classification: ReturnType<typeof classifyCoachOperationalSignal>;
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
    days: DEFAULT_DAYS,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
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
    if (arg.startsWith("--days=")) {
      options.days = parsePositiveInt(arg.slice("--days=".length), "--days");
      continue;
    }
    if (arg === "--days") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --days`);
      }
      options.days = parsePositiveInt(next, "--days");
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

function toIsoSince(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
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

function truncatePreview(text: string | null, max = 160): string {
  const compact = (text ?? "").replace(/\s+/gu, " ").trim();
  if (!compact) {
    return "(empty)";
  }
  if (compact.length <= max) {
    return compact;
  }
  return `${compact.slice(0, max - 3)}...`;
}

async function fetchStudents(studentQuery: string | null): Promise<Map<string, StudentRow>> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.from("trainingpeaks_students").select("id, student_id, student_name").limit(5000);
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
  const sinceIso = toIsoSince(options.days);
  const selectLimit = Math.min(MAX_FETCH, Math.max(options.limit * 10, 100));
  let query = supabase
    .from("trainingpeaks_telegram_context_observations")
    .select("id, student_id, source_type, text_preview, labels, metadata, observed_at, created_at")
    .gte("created_at", sinceIso)
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

function buildOutputRows(rows: ObservationRow[], studentById: Map<string, StudentRow>, limit: number): OutputRow[] {
  const output: OutputRow[] = [];
  for (const row of rows) {
    if (!row.student_id) {
      continue;
    }
    const student = studentById.get(row.student_id);
    if (!student) {
      continue;
    }
    const labels = coerceStringArray(row.labels).map((label) => label.toLowerCase());
    const sourceType = (row.source_type ?? "").toLowerCase();
    const observedAt = row.observed_at ?? row.created_at;
    const observationInput: ObservationLike = {
      sourceType,
      textPreview: row.text_preview,
      labels,
      metadata: coerceObject(row.metadata),
      observedAt,
      studentId: row.student_id,
    };
    output.push({
      student: {
        slug: student.student_id,
        name: student.student_name,
        id: student.id,
      },
      observation_id: row.id,
      source_type: sourceType || "unknown",
      preview: truncatePreview(row.text_preview, 160),
      classification: classifyCoachOperationalSignal(observationInput),
    });
    if (output.length >= limit) {
      break;
    }
  }
  return output;
}

function printTextOutput(options: CliOptions, output: OutputRow[]): void {
  console.log(`${LOG_PREFIX} mode=read-only`);
  console.log(`${LOG_PREFIX} query_policy=select_only`);
  console.log(`${LOG_PREFIX} source=${options.source}`);
  console.log(`${LOG_PREFIX} days=${options.days}`);
  console.log(`${LOG_PREFIX} limit=${options.limit}`);
  console.log(`${LOG_PREFIX} classified=${output.length}`);
  for (const row of output) {
    const c = row.classification;
    console.log("");
    console.log(`- student=${row.student.name} (${row.student.slug})`);
    console.log(`  observation_id=${row.observation_id}`);
    console.log(`  source_type=${row.source_type}`);
    console.log(`  preview=${JSON.stringify(row.preview)}`);
    console.log(`  primary_bucket=${c.primary_bucket}`);
    console.log(`  secondary_buckets=${JSON.stringify(c.secondary_buckets)}`);
    console.log(`  signal_type=${c.signal_type ?? "null"}`);
    console.log(`  structured_payload=${JSON.stringify(c.structured_payload)}`);
    console.log(`  should_create_memory=${c.should_create_memory}`);
    console.log(`  should_create_case=${c.should_create_case}`);
    console.log(`  should_create_trainingpeaks_action=${c.should_create_trainingpeaks_action}`);
    console.log(`  confidence=${c.confidence}`);
    console.log(`  reason=${c.reason}`);
  }
  console.log("");
  console.log(`${LOG_PREFIX} OK diagnostic complete`);
}

async function run(): Promise<void> {
  loadLocalEnvFiles();
  const options = parseCliOptions(process.argv.slice(2));
  const studentById = await fetchStudents(options.student);
  if (options.student && studentById.size === 0) {
    throw new Error(`${LOG_PREFIX} FAIL: no students match --student`);
  }
  const rows = await fetchObservations(options, [...studentById.keys()]);
  const output = buildOutputRows(rows, studentById, options.limit);

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          mode: "read-only",
          query_policy: "select_only",
          options,
          observations: output,
        },
        null,
        2
      )
    );
    return;
  }

  printTextOutput(options, output);
}

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.startsWith(`${LOG_PREFIX} FAIL:`) ? message : `${LOG_PREFIX} FAIL: ${message}`);
  process.exit(1);
});
