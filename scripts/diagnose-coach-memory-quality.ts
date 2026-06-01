import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import type { PostgrestError } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/features/supabase/server";
import type { TrainingPeaksStudentMemoryType } from "@/features/trainingpeaks/repository";

const LOG_PREFIX = "[diagnose-coach-memory-quality]";
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

type SuggestedAction = "keep" | "review" | "deactivate_candidate" | "expire_candidate" | "retype_candidate";
type QualityReason =
  | "illness_only_as_pain_or_injury"
  | "race_or_goal_completed_past_event_only"
  | "race_or_goal_reflective_overload_without_future_goal"
  | "pain_or_injury_resolved_transient"
  | "schedule_or_availability_valid_until_in_past"
  | "temporary_without_valid_until";

type CliOptions = {
  json: boolean;
  limit: number;
  studentQuery: string | null;
};

type StudentRow = {
  id: string;
  student_id: string;
  student_name: string;
  is_active: boolean;
};

type MemoryRow = {
  id: string;
  student_id: string;
  memory_type: TrainingPeaksStudentMemoryType;
  summary_text: string;
  valid_from: string | null;
  valid_until: string | null;
  structured: Record<string, unknown> | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type Candidate = {
  studentName: string;
  studentSlug: string;
  studentId: string;
  memoryItemId: string;
  type: TrainingPeaksStudentMemoryType;
  summary: string;
  reason: QualityReason;
  suggestedAction: SuggestedAction;
};

const ILLNESS_ONLY_KEYWORDS = [
  "болезн",
  "простуд",
  "температур",
  "кашел",
  "кашль",
  "горло",
  "насморк",
  "орви",
  "грипп",
  "ангин",
  "давлен",
  "sick",
  "fever",
  "cough",
  "cold",
];
const MUSCULOSKELETAL_KEYWORDS = [
  "колено",
  "ахилл",
  "икра",
  "бедро",
  "спина",
  "голен",
  "стоп",
  "пятк",
  "сустав",
  "мышц",
  "сухожил",
  "травм",
  "injur",
];
const PAST_EVENT_ONLY_KEYWORDS = [
  "участвова",
  "пробежал",
  "пробежала",
  "финиширова",
  "закончил",
  "закончила",
  "completed",
  "participated",
  "finished",
];
const FUTURE_GOAL_KEYWORDS = [
  "готовит",
  "готовлюсь",
  "планир",
  "цель",
  "предстоящ",
  "будущ",
  "следующ",
  "upcoming",
  "goal",
  "target race",
  "next race",
];
const REFLECTIVE_OVERLOAD_KEYWORDS = [
  "слишком большом количестве марафонов",
  "слишком много марафонов",
  "слишком много стартов",
  "слишком много соревнований",
  "too many marathons",
  "too many races",
  "overracing",
];
const RESOLVED_PAIN_KEYWORDS = [
  "потом прошло",
  "прошло",
  "сейчас не болит",
  "уже не болит",
  "не болит сейчас",
  "resolved",
  "no longer hurts",
];
const PERSISTENT_PAIN_KEYWORDS = [
  "несколько дней",
  "повторя",
  "усилива",
  "не проход",
  "после каждой тренировки",
  "каждый раз",
  "постоянно",
  "persistent",
  "keeps hurting",
];
const TEMPORARY_HINTS = [
  "на следующей неделе",
  "следующей неделе",
  "сегодня",
  "завтра",
  "поездк",
  "в отпуске",
  "только вт",
  "только чт",
  "только во вторник",
  "только в четверг",
  "until",
  "next week",
  "today",
  "tomorrow",
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
    json: false,
    limit: DEFAULT_LIMIT,
    studentQuery: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
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
      options.studentQuery = arg.slice("--student=".length).trim() || null;
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

  return options;
}

function normalizeText(input: string): string {
  return input.toLowerCase().replace(/\s+/gu, " ").trim();
}

function textHasAny(text: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function truncateSummary(summary: string): string {
  const compact = summary.replace(/\s+/gu, " ").trim();
  if (compact.length <= 180) {
    return compact;
  }
  return `${compact.slice(0, 177).trimEnd()}...`;
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

async function fetchStudents(): Promise<StudentRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .select("id, student_id, student_name, is_active")
    .eq("is_active", true)
    .limit(5000);
  if (error) {
    throw new Error(`${LOG_PREFIX} FAIL: trainingpeaks_students: ${error.message}`);
  }
  return (data as StudentRow[] | null) ?? [];
}

async function fetchActiveMemoryByStudentIds(studentIds: readonly string[]): Promise<MemoryRow[]> {
  if (studentIds.length === 0) {
    return [];
  }
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_student_memory_items")
    .select("id, student_id, memory_type, summary_text, valid_from, valid_until, structured, is_active, created_at, updated_at")
    .in("student_id", [...studentIds])
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(10000);
  if (error) {
    if (isMissingRelationError(error)) {
      return [];
    }
    throw new Error(`${LOG_PREFIX} FAIL: trainingpeaks_student_memory_items: ${error.message}`);
  }
  return (data as MemoryRow[] | null) ?? [];
}

function toSafeDate(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/u.test(trimmed) ? trimmed : null;
}

function hasFutureSignal(text: string, item: MemoryRow, referenceDate: string): boolean {
  if (textHasAny(text, FUTURE_GOAL_KEYWORDS)) {
    return true;
  }
  if ((item.valid_from ?? "") > referenceDate) {
    return true;
  }
  const structuredDate = toSafeDate(item.structured?.event_date) ?? toSafeDate(item.structured?.date);
  if (structuredDate && structuredDate > referenceDate) {
    return true;
  }
  for (const match of text.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/gu)) {
    const date = match[1];
    if (date && date > referenceDate) {
      return true;
    }
  }
  return false;
}

function isTemporaryType(type: TrainingPeaksStudentMemoryType): boolean {
  return type === "availability_preference" || type === "schedule_constraint" || type === "travel_or_life_event";
}

function detectQualityCandidate(item: MemoryRow, student: StudentRow, referenceDate: string): Candidate[] {
  const text = normalizeText(`${item.summary_text} ${JSON.stringify(item.structured ?? {})}`);
  const candidates: Candidate[] = [];

  const push = (reason: QualityReason, suggestedAction: SuggestedAction): void => {
    candidates.push({
      studentName: student.student_name,
      studentSlug: student.student_id,
      studentId: student.id,
      memoryItemId: item.id,
      type: item.memory_type,
      summary: truncateSummary(item.summary_text),
      reason,
      suggestedAction,
    });
  };

  if (item.memory_type === "pain_or_injury") {
    const illnessOnly = textHasAny(text, ILLNESS_ONLY_KEYWORDS) && !textHasAny(text, MUSCULOSKELETAL_KEYWORDS);
    if (illnessOnly) {
      push("illness_only_as_pain_or_injury", "retype_candidate");
    }
    const resolvedTransient = textHasAny(text, RESOLVED_PAIN_KEYWORDS) && !textHasAny(text, PERSISTENT_PAIN_KEYWORDS);
    if (resolvedTransient) {
      push("pain_or_injury_resolved_transient", "deactivate_candidate");
    }
  }

  if (item.memory_type === "race_or_goal") {
    const reflectiveOverload = textHasAny(text, REFLECTIVE_OVERLOAD_KEYWORDS);
    if (reflectiveOverload && !hasFutureSignal(text, item, referenceDate)) {
      push("race_or_goal_reflective_overload_without_future_goal", "retype_candidate");
    }
    const pastOnly = textHasAny(text, PAST_EVENT_ONLY_KEYWORDS);
    if (pastOnly && !hasFutureSignal(text, item, referenceDate)) {
      push("race_or_goal_completed_past_event_only", "deactivate_candidate");
    }
  }

  if ((item.memory_type === "schedule_constraint" || item.memory_type === "availability_preference") && item.valid_until) {
    if (item.valid_until < referenceDate) {
      push("schedule_or_availability_valid_until_in_past", "expire_candidate");
    }
  }

  if (isTemporaryType(item.memory_type) && !item.valid_until && textHasAny(text, TEMPORARY_HINTS)) {
    push("temporary_without_valid_until", "review");
  }

  return candidates;
}

function printReadableOutput(candidates: Candidate[]): void {
  console.log(`${LOG_PREFIX} mode=read-only`);
  console.log(`${LOG_PREFIX} query_policy=select_only`);
  console.log(`${LOG_PREFIX} candidates=${candidates.length}`);
  for (const candidate of candidates) {
    console.log("");
    console.log(`- student=${candidate.studentName} (${candidate.studentSlug})`);
    console.log(`  memory_item_id=${candidate.memoryItemId}`);
    console.log(`  type=${candidate.type}`);
    console.log(`  summary=${candidate.summary}`);
    console.log(`  reason=${candidate.reason}`);
    console.log(`  suggested_action=${candidate.suggestedAction}`);
  }
  console.log("");
  console.log(`${LOG_PREFIX} OK read-only quality diagnostic complete`);
}

async function run(): Promise<void> {
  loadLocalEnvFiles();
  const options = parseCliOptions(process.argv.slice(2));

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceRoleKey) {
    console.log(`${LOG_PREFIX} SKIP: missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY`);
    return;
  }
  if (!process.env.SUPABASE_URL) {
    process.env.SUPABASE_URL = supabaseUrl;
  }

  let students = await fetchStudents();
  if (options.studentQuery) {
    const query = normalizeText(options.studentQuery);
    students = students.filter((student) => {
      return (
        student.id.toLowerCase().startsWith(query) ||
        student.student_id.toLowerCase().includes(query) ||
        student.student_name.toLowerCase().includes(query)
      );
    });
  }
  if (students.length === 0) {
    console.log(`${LOG_PREFIX} student_filter=no_matches`);
    console.log(`${LOG_PREFIX} student_query=${JSON.stringify(options.studentQuery)}`);
    return;
  }

  const byStudentId = new Map(students.map((student) => [student.id, student]));
  const memoryRows = await fetchActiveMemoryByStudentIds(students.map((student) => student.id));
  const referenceDate = new Date().toISOString().slice(0, 10);
  const candidates: Candidate[] = [];
  for (const item of memoryRows) {
    const student = byStudentId.get(item.student_id);
    if (!student) {
      continue;
    }
    candidates.push(...detectQualityCandidate(item, student, referenceDate));
    if (candidates.length >= options.limit) {
      break;
    }
  }

  const limited = candidates.slice(0, options.limit);
  if (options.json) {
    console.log(
      JSON.stringify(
        {
          mode: "read-only",
          query_policy: "select_only",
          limit: options.limit,
          student: options.studentQuery,
          candidates: limited,
        },
        null,
        2
      )
    );
    return;
  }

  printReadableOutput(limited);
}

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.startsWith(`${LOG_PREFIX} FAIL:`) ? message : `${LOG_PREFIX} FAIL: ${message}`);
  process.exit(1);
});
