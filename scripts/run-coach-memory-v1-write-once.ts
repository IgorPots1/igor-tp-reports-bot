import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import type { PostgrestError } from "@supabase/supabase-js";

import { processCoachMemoryForObservation } from "@/features/trainingpeaks/coach-memory-extraction";
import { createSupabaseServerClient } from "@/features/supabase/server";
import { listActiveTrainingPeaksStudentMemoryItems } from "@/features/trainingpeaks/repository";

const LOG_PREFIX = "[run-coach-memory-v1-write-once]";
const DEFAULT_LIMIT = 3;
const MAX_DEFAULT_LIMIT = 5;
const DEFAULT_ENV_WRITE_LIMIT = 5;

type CliOptions = {
  apply: boolean;
  limit: number;
  studentQuery: string | null;
};

type ObservationRow = {
  id: string;
  student_id: string | null;
  source_type: string | null;
  labels: unknown;
  text_preview: string | null;
  observed_at: string;
};

type StudentRow = {
  id: string;
  student_name: string;
  student_id: string;
};

type Counters = {
  processed: number;
  inserted: number;
  touched: number;
  skipped: number;
  disabled: number;
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

function parsePositiveInt(rawValue: string, flag: string): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${LOG_PREFIX} FAIL: invalid ${flag} value: ${rawValue}`);
  }
  return Math.floor(parsed);
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    apply: false,
    limit: DEFAULT_LIMIT,
    studentQuery: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--apply") {
      options.apply = true;
      continue;
    }

    if (arg.startsWith("--limit=")) {
      options.limit = parsePositiveInt(arg.slice("--limit=".length).trim(), "--limit");
      continue;
    }
    if (arg === "--limit") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --limit`);
      }
      options.limit = parsePositiveInt(next, "--limit");
      index += 1;
      continue;
    }

    if (arg.startsWith("--student=")) {
      const value = arg.slice("--student=".length).trim();
      options.studentQuery = value || null;
      continue;
    }
    if (arg === "--student") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --student`);
      }
      options.studentQuery = next;
      index += 1;
      continue;
    }
  }

  const envCapRaw = process.env.COACH_MEMORY_WRITE_LIMIT_PER_RUN?.trim();
  const envCapParsed = envCapRaw ? Number(envCapRaw) : Number.NaN;
  const envCap = Number.isFinite(envCapParsed) && envCapParsed > 0 ? Math.floor(envCapParsed) : DEFAULT_ENV_WRITE_LIMIT;
  const hardCap = Math.max(1, Math.min(envCap, MAX_DEFAULT_LIMIT));
  options.limit = Math.min(options.limit, hardCap);
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

function coerceStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const output: string[] = [];
  for (const item of input) {
    if (typeof item === "string") {
      const trimmed = item.trim();
      if (trimmed) {
        output.push(trimmed);
      }
    }
  }
  return output;
}

function studentSafeRef(student: StudentRow | null, studentId: string | null): string {
  if (student) {
    return `${student.student_id}:${student.id.slice(0, 8)}`;
  }
  if (!studentId) {
    return "unknown";
  }
  return `unknown:${studentId.slice(0, 8)}`;
}

async function fetchStudents(studentQuery: string | null): Promise<Map<string, StudentRow>> {
  const supabase = createSupabaseServerClient();
  let query = supabase.from("trainingpeaks_students").select("id, student_name, student_id");
  if (studentQuery) {
    query = query.ilike("student_name", `%${studentQuery}%`);
  }
  const { data, error } = await query.limit(2000);
  if (error) {
    throw new Error(`${LOG_PREFIX} FAIL: trainingpeaks_students: ${error.message}`);
  }
  const rows = (data as StudentRow[] | null) ?? [];
  return new Map(rows.map((item) => [item.id, item]));
}

async function fetchRecentObservations(limit: number, studentIds: string[]): Promise<ObservationRow[]> {
  const supabase = createSupabaseServerClient();
  let query = supabase
    .from("trainingpeaks_telegram_context_observations")
    .select("id, student_id, source_type, labels, text_preview, observed_at")
    .order("observed_at", { ascending: false });
  if (studentIds.length > 0) {
    query = query.in("student_id", studentIds);
  }

  const { data, error } = await query.limit(Math.max(limit * 4, 20));
  if (error) {
    if (isMissingRelationError(error)) {
      return [];
    }
    throw new Error(`${LOG_PREFIX} FAIL: trainingpeaks_telegram_context_observations: ${error.message}`);
  }
  return ((data as ObservationRow[] | null) ?? []).filter((row) => Boolean(row.student_id)).slice(0, limit);
}

async function run(): Promise<void> {
  loadLocalEnvFiles();
  const options = parseCliOptions(process.argv.slice(2));

  if (process.env.COACH_MEMORY_EXTRACTION_ENABLED?.trim() !== "true") {
    throw new Error(`${LOG_PREFIX} FAIL: set COACH_MEMORY_EXTRACTION_ENABLED=true to run this script`);
  }

  const studentById = await fetchStudents(options.studentQuery);
  const observations = await fetchRecentObservations(options.limit, [...studentById.keys()]);
  const counters: Counters = {
    processed: 0,
    inserted: 0,
    touched: 0,
    skipped: 0,
    disabled: 0,
    errors: 0,
  };

  console.log(`${LOG_PREFIX} mode=${options.apply ? "apply" : "dry-run"}`);
  console.log(`${LOG_PREFIX} limit=${options.limit}`);
  if (!options.apply) {
    console.log(`${LOG_PREFIX} apply=false (no DB writes)`);
  }

  for (const observation of observations) {
    const studentId = observation.student_id;
    if (!studentId) {
      continue;
    }
    const student = studentById.get(studentId) ?? null;
    const labels = coerceStringArray(observation.labels);
    counters.processed += 1;

    try {
      const activeMemoryItems = await listActiveTrainingPeaksStudentMemoryItems(studentId, {
        limit: 200,
      });
      const result = await processCoachMemoryForObservation({
        observationId: observation.id,
        studentId,
        studentName: student?.student_name ?? "Unknown student",
        textPreview: observation.text_preview,
        labels,
        sourceType: observation.source_type,
        observedAt: observation.observed_at,
        currentActiveMemoryItems: activeMemoryItems.map((item) => ({
          id: item.id,
          memoryType: item.memoryType,
          summaryText: item.summaryText,
          structured: item.structured,
          validUntil: item.validUntil,
        })),
        applyWrites: options.apply,
      });

      if (result.status === "disabled") {
        counters.disabled += 1;
      } else {
        counters.inserted += result.inserted;
        counters.touched += result.touched;
        counters.skipped += result.skipped;
      }

      console.log(
        `${LOG_PREFIX} obs=${observation.id.slice(0, 8)} student=${studentSafeRef(student, studentId)} status=${result.status}`
      );
    } catch (error) {
      counters.errors += 1;
      const errorName = error instanceof Error ? error.name : "UnknownError";
      console.warn(`${LOG_PREFIX} observation_failed`, {
        observationIdPrefix: observation.id.slice(0, 8),
        studentIdPrefix: studentId.slice(0, 8),
        errorClass: errorName,
      });
    }
  }

  console.log("");
  console.log("Coach Memory v1 write-once summary:");
  console.log(`processed=${counters.processed}`);
  console.log(`inserted=${counters.inserted}`);
  console.log(`touched=${counters.touched}`);
  console.log(`skipped=${counters.skipped}`);
  console.log(`disabled=${counters.disabled}`);
  console.log(`errors=${counters.errors}`);
}

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.startsWith(`${LOG_PREFIX} FAIL:`) ? message : `${LOG_PREFIX} FAIL: ${message}`);
  process.exit(1);
});
