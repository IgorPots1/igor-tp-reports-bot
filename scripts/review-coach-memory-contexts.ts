import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import type { PostgrestError } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/features/supabase/server";
import { parseMemoryDuplicateSignals } from "@/features/trainingpeaks/coach-memory-duplicate-clustering";
import type { TrainingPeaksStudentMemoryType } from "@/features/trainingpeaks/repository";

const LOG_PREFIX = "[review-coach-memory-contexts]";
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const RECENT_OBSERVATION_DAYS = 30;
const SUMMARY_LIMIT = 160;

type CliOptions = {
  json: boolean;
  limit: number;
  studentQuery: string | null;
  onlyWithMemory: boolean;
  withoutMemory: boolean;
  recentObservations: boolean;
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
  source: string;
  confidence: number | null;
  valid_from: string | null;
  valid_until: string | null;
  created_at: string;
  updated_at: string;
  is_active: boolean;
  structured: Record<string, unknown> | null;
};

type ObservationRow = {
  id: string;
  student_id: string | null;
  observed_at: string;
};

type GroupedSection = {
  title: string;
  items: MemoryRow[];
};

type StudentReviewRow = {
  studentId: string;
  studentSlug: string;
  studentName: string;
  activeMemoryCount: number;
  newestMemoryDate: string | null;
  recentObservationsCount: number;
  duplicateClustersFound: number;
  reviewHint: string | null;
  sections: GroupedSection[];
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
    json: false,
    limit: DEFAULT_LIMIT,
    studentQuery: null,
    onlyWithMemory: false,
    withoutMemory: false,
    recentObservations: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--only-with-memory") {
      options.onlyWithMemory = true;
      continue;
    }
    if (arg === "--without-memory") {
      options.withoutMemory = true;
      continue;
    }
    if (arg === "--recent-observations") {
      options.recentObservations = true;
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

  if (options.onlyWithMemory && options.withoutMemory) {
    throw new Error(`${LOG_PREFIX} FAIL: --only-with-memory and --without-memory cannot be used together`);
  }

  return options;
}

function normalizeText(input: string): string {
  return input.toLowerCase().replace(/\s+/gu, " ").trim();
}

function truncateSummary(value: string): string {
  const trimmed = value.trim().replace(/\s+/gu, " ");
  if (trimmed.length <= SUMMARY_LIMIT) {
    return trimmed;
  }
  return `${trimmed.slice(0, SUMMARY_LIMIT - 1).trimEnd()}…`;
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
    .select(
      "id, student_id, memory_type, summary_text, source, confidence, valid_from, valid_until, created_at, updated_at, is_active, structured"
    )
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

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function fetchRecentObservationsByStudentIds(
  studentIds: readonly string[],
  sinceIso: string
): Promise<ObservationRow[]> {
  if (studentIds.length === 0) {
    return [];
  }
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_telegram_context_observations")
    .select("id, student_id, observed_at")
    .in("student_id", [...studentIds])
    .gte("observed_at", sinceIso)
    .order("observed_at", { ascending: false })
    .limit(10000);
  if (error) {
    if (isMissingRelationError(error)) {
      return [];
    }
    throw new Error(`${LOG_PREFIX} FAIL: trainingpeaks_telegram_context_observations: ${error.message}`);
  }
  return (data as ObservationRow[] | null) ?? [];
}

function memorySectionTitle(memoryType: TrainingPeaksStudentMemoryType): string {
  if (memoryType === "communication_style") {
    return "Стиль общения";
  }
  if (
    memoryType === "schedule_constraint" ||
    memoryType === "availability_preference" ||
    memoryType === "planning_preference" ||
    memoryType === "travel_or_life_event"
  ) {
    return "Расписание / планирование";
  }
  if (memoryType === "pain_or_injury" || memoryType === "health_status") {
    return "Здоровье / травмы";
  }
  if (memoryType === "emotional_state" || memoryType === "load_tolerance") {
    return "Эмоции / нагрузка";
  }
  if (memoryType === "race_or_goal") {
    return "Цели / старты";
  }
  if (memoryType === "equipment_or_device_note") {
    return "Экипировка";
  }
  return "Прочее";
}

function readStructuredDate(structured: Record<string, unknown> | null, key: string): string | null {
  const value = structured?.[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/u.test(trimmed) ? trimmed : null;
}

function isLikelyTemporaryItem(item: MemoryRow): boolean {
  if (item.valid_until) {
    return true;
  }
  const type = item.memory_type;
  return (
    type === "availability_preference" ||
    type === "schedule_constraint" ||
    type === "travel_or_life_event"
  );
}

function buildReviewHint(item: MemoryRow, referenceDate: string): string | null {
  if (item.valid_until && item.valid_until < referenceDate) {
    return "expired";
  }
  if ((item.confidence ?? 1) < 0.7) {
    return "low_confidence";
  }
  if (isLikelyTemporaryItem(item) && !item.valid_until && !readStructuredDate(item.structured, "valid_until")) {
    return "temporary_without_valid_until";
  }
  return null;
}

function buildDuplicateClusterCount(items: MemoryRow[]): number {
  if (items.length < 2) {
    return 0;
  }
  const clusters = new Map<string, Set<string>>();
  for (const item of items) {
    const signals = parseMemoryDuplicateSignals(item.summary_text);
    let clusterKey: string | null = null;

    if (item.memory_type === "pain_or_injury" && signals.bodyPart) {
      clusterKey = `pain:${signals.bodyPart}`;
    } else if (item.memory_type === "race_or_goal" && signals.raceAnchor && signals.raceDiscipline) {
      clusterKey = `race:${signals.raceAnchor}:${signals.raceDiscipline}`;
    }

    if (!clusterKey) {
      continue;
    }
    const summaries = clusters.get(clusterKey) ?? new Set<string>();
    summaries.add(normalizeText(item.summary_text));
    clusters.set(clusterKey, summaries);
  }

  let count = 0;
  for (const summarySet of clusters.values()) {
    if (summarySet.size >= 2) {
      count += 1;
    }
  }
  return count;
}

function buildStudentReviewRows(input: {
  students: StudentRow[];
  memoryRows: MemoryRow[];
  observationRows: ObservationRow[];
  options: CliOptions;
}): StudentReviewRow[] {
  const memoryByStudent = new Map<string, MemoryRow[]>();
  for (const row of input.memoryRows) {
    memoryByStudent.set(row.student_id, [...(memoryByStudent.get(row.student_id) ?? []), row]);
  }

  const observationsByStudent = new Map<string, { count: number; latest: string | null }>();
  for (const row of input.observationRows) {
    if (!row.student_id) {
      continue;
    }
    const prev = observationsByStudent.get(row.student_id) ?? { count: 0, latest: null };
    prev.count += 1;
    if (!prev.latest || row.observed_at > prev.latest) {
      prev.latest = row.observed_at;
    }
    observationsByStudent.set(row.student_id, prev);
  }

  const nowDate = new Date().toISOString().slice(0, 10);
  const rows: StudentReviewRow[] = [];
  for (const student of input.students) {
    const memoryItems = memoryByStudent.get(student.id) ?? [];
    const observationStats = observationsByStudent.get(student.id) ?? { count: 0, latest: null };

    if (input.options.onlyWithMemory && memoryItems.length === 0) {
      continue;
    }
    if (input.options.withoutMemory && memoryItems.length > 0) {
      continue;
    }
    if (input.options.withoutMemory && observationStats.count === 0) {
      continue;
    }

    const bySection = new Map<string, MemoryRow[]>();
    for (const item of memoryItems) {
      const title = memorySectionTitle(item.memory_type);
      bySection.set(title, [...(bySection.get(title) ?? []), item]);
    }
    const sectionOrder = [
      "Стиль общения",
      "Расписание / планирование",
      "Здоровье / травмы",
      "Эмоции / нагрузка",
      "Цели / старты",
      "Экипировка",
      "Прочее",
    ];
    const sections: GroupedSection[] = sectionOrder
      .map((title) => ({ title, items: bySection.get(title) ?? [] }))
      .filter((section) => section.items.length > 0);

    const newestMemoryDate = memoryItems
      .map((item) => item.updated_at || item.created_at)
      .sort((a, b) => b.localeCompare(a))[0] ?? null;

    const reviewHintSet = new Set<string>();
    for (const item of memoryItems) {
      const hint = buildReviewHint(item, nowDate);
      if (hint) {
        reviewHintSet.add(hint);
      }
    }

    rows.push({
      studentId: student.id,
      studentSlug: student.student_id,
      studentName: student.student_name,
      activeMemoryCount: memoryItems.length,
      newestMemoryDate,
      recentObservationsCount: observationStats.count,
      duplicateClustersFound: buildDuplicateClusterCount(memoryItems),
      reviewHint: reviewHintSet.size > 0 ? [...reviewHintSet].join(",") : null,
      sections,
    });
  }

  rows.sort((a, b) => {
    if (input.options.recentObservations) {
      if (b.recentObservationsCount !== a.recentObservationsCount) {
        return b.recentObservationsCount - a.recentObservationsCount;
      }
      return (b.newestMemoryDate ?? "").localeCompare(a.newestMemoryDate ?? "");
    }
    if (b.activeMemoryCount !== a.activeMemoryCount) {
      return b.activeMemoryCount - a.activeMemoryCount;
    }
    return (b.newestMemoryDate ?? "").localeCompare(a.newestMemoryDate ?? "");
  });

  return rows.slice(0, input.options.limit);
}

function printMemoryItem(item: MemoryRow): void {
  const compact = [
    `memory_type=${item.memory_type}`,
    `source=${item.source || "unknown"}`,
    `confidence=${item.confidence ?? "null"}`,
    `valid_from=${item.valid_from ?? "null"}`,
    `valid_until=${item.valid_until ?? "null"}`,
    `updated_at=${item.updated_at}`,
    `created_at=${item.created_at}`,
  ].join(" | ");
  console.log(`      - ${truncateSummary(item.summary_text)}`);
  console.log(`        ${compact}`);
}

function printReadableOutput(rows: StudentReviewRow[], options: CliOptions): void {
  console.log(`${LOG_PREFIX} mode=read-only`);
  console.log(`${LOG_PREFIX} query_policy=select_only`);
  console.log(`${LOG_PREFIX} limit=${options.limit}`);
  console.log(`${LOG_PREFIX} filters student=${JSON.stringify(options.studentQuery)} only_with_memory=${options.onlyWithMemory} without_memory=${options.withoutMemory} recent_observations=${options.recentObservations}`);
  console.log(`${LOG_PREFIX} students_returned=${rows.length}`);

  for (const row of rows) {
    console.log("");
    console.log(`• ${row.studentName}`);
    console.log(`  slug/id: ${row.studentSlug} / ${row.studentId}`);
    console.log(`  active_memory_items: ${row.activeMemoryCount}`);
    console.log(`  newest_memory_date: ${row.newestMemoryDate ?? "none"}`);
    console.log(`  recent_observations_count: ${row.recentObservationsCount}`);
    console.log(`  duplicate_clusters_found: ${row.duplicateClustersFound}`);
    if (row.reviewHint) {
      console.log(`  review_hint: ${row.reviewHint}`);
    }
    if (row.sections.length === 0) {
      console.log("  (активной памяти нет)");
      continue;
    }

    for (const section of row.sections) {
      console.log(`  ${section.title}:`);
      for (const item of section.items) {
        printMemoryItem(item);
      }
    }
  }

  console.log("");
  console.log(`${LOG_PREFIX} OK read-only context review complete`);
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

  const studentIds = students.map((student) => student.id);
  const [memoryRows, observationRows] = await Promise.all([
    fetchActiveMemoryByStudentIds(studentIds),
    fetchRecentObservationsByStudentIds(studentIds, isoDaysAgo(RECENT_OBSERVATION_DAYS)),
  ]);

  const reviewRows = buildStudentReviewRows({
    students,
    memoryRows,
    observationRows,
    options,
  });

  const payload = {
    mode: "read-only",
    query_policy: "select_only",
    filters: {
      student: options.studentQuery,
      limit: options.limit,
      only_with_memory: options.onlyWithMemory,
      without_memory: options.withoutMemory,
      recent_observations: options.recentObservations,
      observation_window_days: RECENT_OBSERVATION_DAYS,
    },
    students_returned: reviewRows.length,
    students: reviewRows.map((row) => ({
      student_name: row.studentName,
      student_slug: row.studentSlug,
      student_id: row.studentId,
      active_memory_items: row.activeMemoryCount,
      newest_memory_date: row.newestMemoryDate,
      recent_observations_count: row.recentObservationsCount,
      duplicate_clusters_found: row.duplicateClustersFound,
      review_hint: row.reviewHint,
      sections: row.sections.map((section) => ({
        title: section.title,
        items: section.items.map((item) => ({
          summary: truncateSummary(item.summary_text),
          memory_type: item.memory_type,
          source: item.source,
          confidence: item.confidence,
          valid_from: item.valid_from,
          valid_until: item.valid_until,
          updated_at: item.updated_at,
          created_at: item.created_at,
        })),
      })),
    })),
  };

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  printReadableOutput(reviewRows, options);
}

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.startsWith(`${LOG_PREFIX} FAIL:`) ? message : `${LOG_PREFIX} FAIL: ${message}`);
  process.exit(1);
});
