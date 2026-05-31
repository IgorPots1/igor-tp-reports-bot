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
  onlyCandidates: boolean;
  allowLarge: boolean;
  requestedLimit: number;
  effectiveLimit: number;
  capSource: "COACH_MEMORY_WRITE_LIMIT_PER_RUN" | "default" | "allow_large";
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
  wouldInsert: number;
  wouldTouch: number;
  noMemory: number;
  belowConfidence: number;
  duplicate: number;
  skipped: number;
  disabled: number;
  errors: number;
};

const CANDIDATE_LABELS = new Set([
  "pain_or_health",
  "schedule_context",
  "race_context",
  "move_workout_candidate",
  "question_to_coach",
]);

const CANDIDATE_KEYWORDS = [
  "боль",
  "болит",
  "дискомфорт",
  "заболел",
  "температура",
  "не могу",
  "не смогу",
  "график",
  "во вторник",
  "в среду",
  "длительную",
  "интервалы",
  "отпуск",
  "командировка",
  "тяжело",
  "нет сил",
  "усталость",
  "старт",
  "марафон",
  "пульсометр",
];

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
    onlyCandidates: false,
    allowLarge: false,
    requestedLimit: DEFAULT_LIMIT,
    effectiveLimit: DEFAULT_LIMIT,
    capSource: "default",
    limit: DEFAULT_LIMIT,
    studentQuery: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--only-candidates") {
      options.onlyCandidates = true;
      continue;
    }
    if (arg === "--allow-large") {
      options.allowLarge = true;
      continue;
    }

    if (arg.startsWith("--limit=")) {
      options.requestedLimit = parsePositiveInt(arg.slice("--limit=".length).trim(), "--limit");
      continue;
    }
    if (arg === "--limit") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --limit`);
      }
      options.requestedLimit = parsePositiveInt(next, "--limit");
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
  const capSource = Number.isFinite(envCapParsed) && envCapParsed > 0 ? "COACH_MEMORY_WRITE_LIMIT_PER_RUN" : "default";
  const envCap = Number.isFinite(envCapParsed) && envCapParsed > 0 ? Math.floor(envCapParsed) : DEFAULT_ENV_WRITE_LIMIT;
  const hardCap = Math.max(1, Math.min(envCap, MAX_DEFAULT_LIMIT));
  options.capSource = options.allowLarge ? "allow_large" : capSource;
  options.effectiveLimit = options.allowLarge ? options.requestedLimit : Math.min(options.requestedLimit, hardCap);
  options.limit = options.effectiveLimit;
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

function isCandidateObservation(observation: ObservationRow): boolean {
  const labels = coerceStringArray(observation.labels).map((value) => value.toLowerCase());
  if (labels.some((label) => CANDIDATE_LABELS.has(label))) {
    return true;
  }
  const preview = (observation.text_preview ?? "").toLowerCase();
  if (!preview) {
    return false;
  }
  return CANDIDATE_KEYWORDS.some((keyword) => preview.includes(keyword));
}

function mapObservationStatus(
  result: Awaited<ReturnType<typeof processCoachMemoryForObservation>>,
  apply: boolean
): "no_memory" | "would_insert" | "would_touch" | "inserted" | "touched" | "below_confidence" | "duplicate" | "error" {
  if (result.status === "disabled") {
    return "no_memory";
  }
  if (result.status === "no_memory") {
    return "no_memory";
  }
  if (result.inserted > 0) {
    return apply ? "inserted" : "would_insert";
  }
  if (result.touched > 0) {
    return apply ? "touched" : "would_touch";
  }
  if (result.belowConfidence > 0) {
    return "below_confidence";
  }
  if (result.duplicate > 0) {
    return "duplicate";
  }
  return "no_memory";
}

async function run(): Promise<void> {
  loadLocalEnvFiles();
  const options = parseCliOptions(process.argv.slice(2));

  if (process.env.COACH_MEMORY_EXTRACTION_ENABLED?.trim() !== "true") {
    throw new Error(`${LOG_PREFIX} FAIL: set COACH_MEMORY_EXTRACTION_ENABLED=true to run this script`);
  }

  const studentById = await fetchStudents(options.studentQuery);
  const observationFetchLimit = options.onlyCandidates ? Math.max(options.limit * 8, 40) : options.limit;
  const recentObservations = await fetchRecentObservations(observationFetchLimit, [...studentById.keys()]);
  const observations = options.onlyCandidates
    ? recentObservations.filter((observation) => isCandidateObservation(observation)).slice(0, options.limit)
    : recentObservations.slice(0, options.limit);
  const counters: Counters = {
    processed: 0,
    inserted: 0,
    touched: 0,
    wouldInsert: 0,
    wouldTouch: 0,
    noMemory: 0,
    belowConfidence: 0,
    duplicate: 0,
    skipped: 0,
    disabled: 0,
    errors: 0,
  };

  console.log(`${LOG_PREFIX} mode=${options.apply ? "apply" : "dry-run"}`);
  console.log(`${LOG_PREFIX} requestedLimit=${options.requestedLimit}`);
  console.log(`${LOG_PREFIX} effectiveLimit=${options.effectiveLimit}`);
  console.log(`${LOG_PREFIX} capSource=${options.capSource}`);
  console.log(`${LOG_PREFIX} candidateMode=${options.onlyCandidates ? "only_candidates" : "latest"}`);
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
        counters.noMemory += 1;
      } else {
        if (options.apply) {
          counters.inserted += result.inserted;
          counters.touched += result.touched;
        } else {
          counters.wouldInsert += result.inserted;
          counters.wouldTouch += result.touched;
        }
        counters.belowConfidence += result.belowConfidence;
        counters.duplicate += result.duplicate;
        counters.skipped += result.skipped;
        if (result.status === "no_memory") {
          counters.noMemory += 1;
        } else if (
          result.inserted === 0 &&
          result.touched === 0 &&
          result.belowConfidence === 0 &&
          result.duplicate === 0
        ) {
          counters.noMemory += 1;
        }
      }

      const status = mapObservationStatus(result, options.apply);
      console.log(
        `${LOG_PREFIX} obs=${observation.id.slice(0, 8)} student=${studentSafeRef(student, studentId)} status=${status}`
      );
    } catch (error) {
      counters.errors += 1;
      const errorName = error instanceof Error ? error.name : "UnknownError";
      console.warn(`${LOG_PREFIX} observation_failed`, {
        observationIdPrefix: observation.id.slice(0, 8),
        studentIdPrefix: studentId.slice(0, 8),
        errorClass: errorName,
      });
      console.log(
        `${LOG_PREFIX} obs=${observation.id.slice(0, 8)} student=${studentSafeRef(student, studentId)} status=error`
      );
    }
  }

  console.log("");
  console.log("Coach Memory v1 write-once summary:");
  console.log(`processed=${counters.processed}`);
  console.log(`inserted=${counters.inserted}`);
  console.log(`touched=${counters.touched}`);
  console.log(`wouldInsert=${counters.wouldInsert}`);
  console.log(`wouldTouch=${counters.wouldTouch}`);
  console.log(`noMemory=${counters.noMemory}`);
  console.log(`belowConfidence=${counters.belowConfidence}`);
  console.log(`duplicate=${counters.duplicate}`);
  console.log(`skipped=${counters.skipped}`);
  console.log(`disabled=${counters.disabled}`);
  console.log(`errors=${counters.errors}`);
}

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.startsWith(`${LOG_PREFIX} FAIL:`) ? message : `${LOG_PREFIX} FAIL: ${message}`);
  process.exit(1);
});
