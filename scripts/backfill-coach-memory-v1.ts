import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import type { PostgrestError } from "@supabase/supabase-js";

import {
  extractCoachMemoryItemsDryRun,
  processCoachMemoryForObservation,
  type CoachMemoryExtractionNotificationLevel,
} from "@/features/trainingpeaks/coach-memory-extraction";
import { listActiveTrainingPeaksStudentMemoryItems } from "@/features/trainingpeaks/repository";
import { createSupabaseServerClient } from "@/features/supabase/server";

const LOG_PREFIX = "[backfill-coach-memory-v1]";
const DEFAULT_DAYS = 30;
const DEFAULT_LIMIT = 20;
const DEFAULT_HARD_CAP = 20;
const MAX_FETCH_LIMIT = 2000;
const TOP_STUDENT_COUNT = 10;
const ALLOWED_SOURCES = new Set(["business_dm", "group_topic", "group_general"]);

type SourceFilter = "business_dm" | "group_topic" | "group_general" | "all";
type ObservationStatus =
  | "no_memory"
  | "would_insert"
  | "would_touch"
  | "inserted"
  | "touched"
  | "below_confidence"
  | "duplicate"
  | "disabled"
  | "error";

type CliOptions = {
  days: number;
  limit: number;
  requestedLimit: number;
  allowLarge: boolean;
  apply: boolean;
  studentQuery: string | null;
  source: SourceFilter;
  json: boolean;
  sample: boolean;
  skipExistingSourceObservations: boolean;
  includeProcessed: boolean;
  offset: number;
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
  labels: unknown;
  text_preview: string | null;
  created_at: string;
  observed_at: string | null;
};

type CounterSummary = {
  selected: number;
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

type CandidateDecision = {
  selected: boolean;
  reasons: string[];
  skipReason: string | null;
};

type StudentScore = {
  wouldInsert: number;
  inserted: number;
};

type PerObservationOutput = {
  obs: string;
  student: string;
  source: string;
  status: ObservationStatus;
  memoryTypes: string[];
  notificationLevels: string[];
  validUntil: string[];
  samplePreview?: string;
};

type JsonPayload = {
  mode: "dry-run" | "apply";
  days: number;
  source: SourceFilter;
  requestedLimit: number;
  effectiveLimit: number;
  selected: number;
  offset: number;
  skipExistingSourceObservations: boolean;
  candidateObservationsBeforeSkip: number;
  existingSourceObservationsCount: number;
  candidateObservationsAfterSkip: number;
  processed: number;
  counters: CounterSummary;
  bySourceType: Record<string, number>;
  byMemoryType: Record<string, number>;
  byNotificationLevel: Record<string, number>;
  studentCount: number;
  topStudents: Array<{ student: string; wouldInsert: number; inserted: number }>;
  recommendations: string[];
  observations: PerObservationOutput[];
};

const HIGH_CONFIDENCE_LABELS = new Set([
  "pain_or_health",
  "schedule_context",
  "race_context",
  "move_workout_candidate",
  "question_to_coach",
]);

const DURABLE_KEYWORDS = {
  healthPain: [
    "боль",
    "болит",
    "дискомфорт",
    "травма",
    "колено",
    "голень",
    "ахилл",
    "спина",
    "стопа",
    "заболел",
    "температура",
    "горло",
  ],
  scheduleAvailability: [
    "не могу",
    "не смогу",
    "график",
    "работа",
    "смена",
    "занят",
    "вторник",
    "среда",
    "неделя",
    "выходные",
  ],
  preferencePlanning: [
    "лучше ставить",
    "удобнее",
    "предпочитаю",
    "могу только",
    "длительную",
    "интервалы",
    "силовую",
  ],
  emotionLoad: ["тяжело", "нет сил", "усталость", "перегруз", "нет мотивации", "стресс"],
  raceGoal: ["старт", "забег", "марафон", "полумарафон", "10к", "5к", "цель"],
  travelLife: ["отпуск", "поездка", "командировка", "уезжаю"],
  equipment: ["garmin", "часы", "пульсометр", "hrm", "apple watch"],
};

const ONE_OFF_MOVE_PHRASES = [
  "перенеси на завтра",
  "можно завтра",
  "попробую завтра",
  "из-за дождя перенесу на завтра",
  "перенесу на завтра",
  "перенести на завтра",
  "побегу завтра",
  "move to tomorrow",
];

const ACK_OR_NOISE_LABELS = ["unknown", "ack_or_noise"];
const NOISE_HINTS = ["спасибо", "ок", "окей", "понял", "поняла", "👍", "👌"];

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

function parseSource(rawValue: string): SourceFilter {
  const normalized = rawValue.trim().toLowerCase();
  if (
    normalized === "all" ||
    normalized === "business_dm" ||
    normalized === "group_topic" ||
    normalized === "group_general"
  ) {
    return normalized;
  }
  throw new Error(`${LOG_PREFIX} FAIL: invalid --source value: ${rawValue}`);
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    days: DEFAULT_DAYS,
    limit: DEFAULT_LIMIT,
    requestedLimit: DEFAULT_LIMIT,
    allowLarge: false,
    apply: false,
    studentQuery: null,
    source: "all",
    json: false,
    sample: false,
    skipExistingSourceObservations: false,
    includeProcessed: false,
    offset: 0,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--allow-large") {
      options.allowLarge = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--sample") {
      options.sample = true;
      continue;
    }
    if (arg === "--skip-existing-source-observations") {
      options.skipExistingSourceObservations = true;
      continue;
    }
    if (arg === "--include-processed") {
      options.includeProcessed = true;
      continue;
    }
    if (arg.startsWith("--offset=")) {
      const parsedOffset = Number(arg.slice("--offset=".length).trim());
      if (!Number.isFinite(parsedOffset) || parsedOffset < 0) {
        throw new Error(`${LOG_PREFIX} FAIL: invalid --offset value: ${arg.slice("--offset=".length).trim()}`);
      }
      options.offset = Math.floor(parsedOffset);
      continue;
    }
    if (arg === "--offset") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --offset`);
      }
      const parsedOffset = Number(next);
      if (!Number.isFinite(parsedOffset) || parsedOffset < 0) {
        throw new Error(`${LOG_PREFIX} FAIL: invalid --offset value: ${next}`);
      }
      options.offset = Math.floor(parsedOffset);
      index += 1;
      continue;
    }
    if (arg.startsWith("--days=")) {
      options.days = parsePositiveInt(arg.slice("--days=".length).trim(), "--days");
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

  options.limit = options.allowLarge ? options.requestedLimit : Math.min(options.requestedLimit, DEFAULT_HARD_CAP);
  if (options.apply && options.includeProcessed) {
    options.skipExistingSourceObservations = false;
  } else if (options.apply) {
    options.skipExistingSourceObservations = true;
  }
  return options;
}

function validateApplySafety(options: CliOptions): void {
  if (!options.apply) {
    return;
  }
  if (process.env.COACH_MEMORY_EXTRACTION_ENABLED?.trim() !== "true") {
    throw new Error(`${LOG_PREFIX} FAIL: apply requires COACH_MEMORY_EXTRACTION_ENABLED=true`);
  }
  if (!options.allowLarge && options.limit > DEFAULT_HARD_CAP) {
    throw new Error(`${LOG_PREFIX} FAIL: apply limit exceeds cap ${DEFAULT_HARD_CAP}; use --allow-large`);
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

function getIsoSince(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function normalizeForMatch(input: string): string {
  return input.toLowerCase().replace(/\s+/gu, " ").trim();
}

function containsAny(text: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
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

function truncatePreview(input: string | null, maxLength = 80): string {
  if (!input) {
    return "(empty)";
  }
  const compact = input.replace(/\s+/gu, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, maxLength - 3)}...`;
}

function incrementCounter(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

function sortedCountEntries(input: Record<string, number>): Array<[string, number]> {
  return Object.entries(input).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

async function fetchStudents(studentQuery: string | null): Promise<Map<string, StudentRow>> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.from("trainingpeaks_students").select("id, student_id, student_name").limit(5000);
  if (error) {
    throw new Error(`${LOG_PREFIX} FAIL: trainingpeaks_students: ${error.message}`);
  }
  const all = (data as StudentRow[] | null) ?? [];
  if (!studentQuery) {
    return new Map(all.map((student) => [student.id, student]));
  }

  const query = normalizeForMatch(studentQuery);
  const filtered = all.filter((student) => {
    const id = student.id.toLowerCase();
    const slug = student.student_id.toLowerCase();
    const name = student.student_name.toLowerCase();
    return id.startsWith(query) || slug.startsWith(query) || name.startsWith(query);
  });
  return new Map(filtered.map((student) => [student.id, student]));
}

async function fetchObservationRows(options: CliOptions, studentIds: string[]): Promise<ObservationRow[]> {
  const supabase = createSupabaseServerClient();
  const sinceIso = getIsoSince(options.days);
  const boundedLimit = Math.max(options.limit * 12, options.limit, 60);
  const fetchLimit = Math.min(MAX_FETCH_LIMIT, boundedLimit);

  let query = supabase
    .from("trainingpeaks_telegram_context_observations")
    .select("id, student_id, source_type, labels, text_preview, created_at, observed_at")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(fetchLimit);

  if (options.source !== "all") {
    query = query.eq("source_type", options.source);
  } else {
    query = query.in("source_type", [...ALLOWED_SOURCES]);
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

async function fetchExistingSourceObservationIds(studentIds: string[]): Promise<Set<string>> {
  if (studentIds.length === 0) {
    return new Set();
  }
  const supabase = createSupabaseServerClient();
  const observed = new Set<string>();
  const pageSize = 5000;
  let from = 0;
  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("trainingpeaks_student_memory_items")
      .select("source_observation_id")
      .in("student_id", studentIds)
      .not("source_observation_id", "is", null)
      .range(from, to);
    if (error) {
      if (isMissingRelationError(error)) {
        return new Set();
      }
      throw new Error(`${LOG_PREFIX} FAIL: trainingpeaks_student_memory_items: ${error.message}`);
    }
    const rows = (data as Array<{ source_observation_id: string | null }> | null) ?? [];
    for (const row of rows) {
      if (typeof row.source_observation_id === "string" && row.source_observation_id.length > 0) {
        observed.add(row.source_observation_id);
      }
    }
    if (rows.length < pageSize) {
      break;
    }
    from += pageSize;
  }
  return observed;
}

function hasDurableSignal(text: string): boolean {
  return (
    containsAny(text, DURABLE_KEYWORDS.healthPain) ||
    containsAny(text, DURABLE_KEYWORDS.scheduleAvailability) ||
    containsAny(text, DURABLE_KEYWORDS.preferencePlanning) ||
    containsAny(text, DURABLE_KEYWORDS.emotionLoad) ||
    containsAny(text, DURABLE_KEYWORDS.raceGoal) ||
    containsAny(text, DURABLE_KEYWORDS.travelLife) ||
    containsAny(text, DURABLE_KEYWORDS.equipment)
  );
}

function hasStrongDurableSignal(text: string): boolean {
  return (
    containsAny(text, DURABLE_KEYWORDS.healthPain) ||
    containsAny(text, DURABLE_KEYWORDS.scheduleAvailability) ||
    containsAny(text, DURABLE_KEYWORDS.preferencePlanning) ||
    containsAny(text, DURABLE_KEYWORDS.raceGoal) ||
    containsAny(text, DURABLE_KEYWORDS.travelLife) ||
    containsAny(text, DURABLE_KEYWORDS.equipment)
  );
}

function isOneOffMoveLikely(text: string): boolean {
  return containsAny(text, ONE_OFF_MOVE_PHRASES);
}

function pickCandidate(row: ObservationRow): CandidateDecision {
  if (!row.student_id) {
    return { selected: false, reasons: [], skipReason: "missing_student_id" };
  }
  const sourceType = (row.source_type ?? "").toLowerCase();
  if (!ALLOWED_SOURCES.has(sourceType)) {
    return { selected: false, reasons: [], skipReason: "source_not_allowed" };
  }

  const labels = coerceStringArray(row.labels).map((item) => item.toLowerCase());
  const text = normalizeForMatch(row.text_preview ?? "");

  if (labels.some((label) => ACK_OR_NOISE_LABELS.includes(label)) && !hasDurableSignal(text)) {
    return { selected: false, reasons: [], skipReason: "ack_or_noise" };
  }
  if (labels.some((label) => label.includes("third_party_in_linked_topic")) && !hasStrongDurableSignal(text)) {
    return { selected: false, reasons: [], skipReason: "third_party_weak_signal" };
  }
  if (!text && labels.length === 0) {
    return { selected: false, reasons: [], skipReason: "empty_observation" };
  }
  if (text.length <= 12 && containsAny(text, NOISE_HINTS) && !hasDurableSignal(text)) {
    return { selected: false, reasons: [], skipReason: "short_noise_text" };
  }

  const reasons: string[] = [];
  const durableSignal = hasDurableSignal(text);
  const oneOffMove = isOneOffMoveLikely(text);
  const hasSchedulePreferenceSignal =
    containsAny(text, DURABLE_KEYWORDS.scheduleAvailability) || containsAny(text, DURABLE_KEYWORDS.preferencePlanning);

  const hasPainHealthLabel = labels.includes("pain_or_health");
  const hasScheduleLabel = labels.includes("schedule_context");
  const hasRaceLabel = labels.includes("race_context");
  const hasMoveLabel = labels.includes("move_workout_candidate");
  const hasQuestionLabel = labels.includes("question_to_coach");
  const hasReportLike = labels.includes("report_like");
  const hasAnyHighConfidenceLabel = labels.some((label) => HIGH_CONFIDENCE_LABELS.has(label));

  if (hasPainHealthLabel) {
    reasons.push("label:pain_or_health");
  }
  if (hasScheduleLabel) {
    reasons.push("label:schedule_context");
  }
  if (hasRaceLabel) {
    reasons.push("label:race_context");
  }

  if (hasMoveLabel) {
    if (!oneOffMove || hasSchedulePreferenceSignal) {
      reasons.push("label:move_workout_candidate_durable");
    } else {
      return { selected: false, reasons: [], skipReason: "one_off_move_candidate" };
    }
  }

  if (hasQuestionLabel) {
    if (hasStrongDurableSignal(text)) {
      reasons.push("label:question_to_coach_durable");
    } else {
      return { selected: false, reasons: [], skipReason: "question_without_durable_fact" };
    }
  }

  if (hasReportLike && durableSignal) {
    reasons.push("label:report_like_with_durable_signal");
  }

  if (durableSignal) {
    reasons.push("text:durable_keywords");
  }

  if (!hasAnyHighConfidenceLabel && !durableSignal) {
    return { selected: false, reasons: [], skipReason: "below_high_confidence_filter" };
  }

  if (oneOffMove && !hasSchedulePreferenceSignal && !hasPainHealthLabel && !hasRaceLabel) {
    return { selected: false, reasons: [], skipReason: "one_off_move_without_stable_constraint" };
  }

  if (reasons.length === 0) {
    return { selected: false, reasons: [], skipReason: "no_candidate_reasons" };
  }

  return { selected: true, reasons, skipReason: null };
}

function mapStatus(
  result: Awaited<ReturnType<typeof processCoachMemoryForObservation>>,
  apply: boolean
): ObservationStatus {
  if (result.status === "disabled") {
    return "disabled";
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

function buildRecommendations(
  counters: CounterSummary,
  bySourceType: Record<string, number>,
  byNotificationLevel: Record<string, number>
): string[] {
  const output: string[] = [];
  if (counters.selected === 0) {
    output.push("No candidates selected: widen --days or use --source all.");
  }
  if (counters.processed > 0 && counters.wouldInsert === 0 && counters.inserted === 0) {
    output.push("No insertions detected: candidate filter may be strict or model confidence may be low.");
  }
  if ((byNotificationLevel.immediate ?? 0) > (byNotificationLevel.digest ?? 0) + (byNotificationLevel.silent ?? 0)) {
    output.push("Immediate notifications dominate extracted items: manually review candidate quality.");
  }
  if ((bySourceType.business_dm ?? 0) === 0 && (bySourceType.group_topic ?? 0) > 0) {
    output.push("Business DM produced no candidates in this run; verify source filter and ingestion coverage.");
  }
  if (counters.processed > 0 && counters.errors === 0) {
    output.push("Safe to start apply with --limit 5 or --limit 10 after reviewing dry-run output.");
  }
  return output;
}

function printPerObservationLine(item: PerObservationOutput): void {
  const extra: string[] = [];
  if (item.memoryTypes.length > 0) {
    extra.push(`memoryTypes=${item.memoryTypes.join(",")}`);
  }
  if (item.notificationLevels.length > 0) {
    extra.push(`notification=${item.notificationLevels.join(",")}`);
  }
  if (item.validUntil.length > 0) {
    extra.push(`validUntil=${item.validUntil.join(",")}`);
  }
  if (item.samplePreview) {
    extra.push(`sample=${JSON.stringify(item.samplePreview)}`);
  }
  const suffix = extra.length > 0 ? ` ${extra.join(" ")}` : "";
  console.log(
    `${LOG_PREFIX} obs=${item.obs} student=${item.student} source=${item.source} status=${item.status}${suffix}`
  );
}

async function run(): Promise<void> {
  loadLocalEnvFiles();
  const options = parseCliOptions(process.argv.slice(2));
  validateApplySafety(options);

  if (!options.apply) {
    process.env.COACH_MEMORY_EXTRACTION_ENABLED = "true";
  }
  process.env.COACH_MEMORY_AI_DRY_RUN_MODE = "1";

  const studentById = await fetchStudents(options.studentQuery);
  if (options.studentQuery && studentById.size === 0) {
    throw new Error(`${LOG_PREFIX} FAIL: no students match --student query`);
  }

  const rows = await fetchObservationRows(options, [...studentById.keys()]);
  const selectedRows: Array<{ row: ObservationRow; reasons: string[] }> = [];
  const skipReasons: Record<string, number> = {};
  const candidateRows: Array<{ row: ObservationRow; reasons: string[] }> = [];
  for (const row of rows) {
    const decision = pickCandidate(row);
    if (!decision.selected) {
      if (decision.skipReason) {
        incrementCounter(skipReasons, decision.skipReason);
      }
      continue;
    }
    candidateRows.push({ row, reasons: decision.reasons });
  }

  const candidateObservationsBeforeSkip = candidateRows.length;
  let existingSourceObservationIds = new Set<string>();
  if (options.skipExistingSourceObservations) {
    existingSourceObservationIds = await fetchExistingSourceObservationIds([...studentById.keys()]);
  }
  const existingSourceObservationsCount = existingSourceObservationIds.size;

  const candidatesAfterSkip = options.skipExistingSourceObservations
    ? candidateRows.filter((entry) => !existingSourceObservationIds.has(entry.row.id))
    : candidateRows;
  const candidateObservationsAfterSkip = candidatesAfterSkip.length;

  const limitedCandidates = candidatesAfterSkip.slice(options.offset);
  for (const candidate of limitedCandidates) {
    selectedRows.push(candidate);
    if (selectedRows.length >= options.limit) {
      break;
    }
  }

  const counters: CounterSummary = {
    selected: selectedRows.length,
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

  const bySourceType: Record<string, number> = {};
  const byMemoryType: Record<string, number> = {};
  const byNotificationLevel: Record<string, number> = {};
  const studentScores = new Map<string, StudentScore>();
  const studentsWithProcessed = new Set<string>();
  const perObservation: PerObservationOutput[] = [];

  console.log(`${LOG_PREFIX} mode=${options.apply ? "apply" : "dry-run"}`);
  console.log(`${LOG_PREFIX} days=${options.days}`);
  console.log(`${LOG_PREFIX} source=${options.source}`);
  console.log(`${LOG_PREFIX} requestedLimit=${options.requestedLimit}`);
  console.log(`${LOG_PREFIX} effectiveLimit=${options.limit}`);
  console.log(`${LOG_PREFIX} offset=${options.offset}`);
  console.log(`${LOG_PREFIX} skip_existing_source_observations=${options.skipExistingSourceObservations}`);
  console.log(`${LOG_PREFIX} existing_source_observations_count=${existingSourceObservationsCount}`);
  console.log(`${LOG_PREFIX} candidate_observations_before_skip=${candidateObservationsBeforeSkip}`);
  console.log(`${LOG_PREFIX} candidate_observations_after_skip=${candidateObservationsAfterSkip}`);
  if (options.includeProcessed) {
    console.log(`${LOG_PREFIX} warning=include-processed enabled; existing source observations are not skipped`);
  }
  if (!options.apply) {
    console.log(`${LOG_PREFIX} apply=false (no DB writes)`);
  } else {
    console.log(`${LOG_PREFIX} apply=true`);
    console.log(`${LOG_PREFIX} recommendation=start with --limit 5 or --limit 10`);
  }

  for (const selected of selectedRows) {
    const row = selected.row;
    const studentId = row.student_id;
    if (!studentId) {
      continue;
    }
    const student = studentById.get(studentId) ?? null;
    const source = row.source_type ?? "unknown";
    incrementCounter(bySourceType, source);
    counters.processed += 1;
    studentsWithProcessed.add(studentId);

    try {
      const activeMemoryItems = await listActiveTrainingPeaksStudentMemoryItems(studentId, { limit: 200 });
      const labels = coerceStringArray(row.labels);
      const extraction = await extractCoachMemoryItemsDryRun({
        studentName: student?.student_name ?? "Unknown student",
        observationPreview: row.text_preview ?? "",
        observationLabels: labels,
        sourceType: row.source_type,
        observedAt: row.observed_at ?? row.created_at,
        currentActiveMemoryItems: activeMemoryItems.map((item) => ({
          memoryType: item.memoryType,
          summaryText: item.summaryText,
          structured: item.structured,
          validUntil: item.validUntil,
        })),
      });

      const result = await processCoachMemoryForObservation({
        observationId: row.id,
        studentId,
        studentName: student?.student_name ?? "Unknown student",
        textPreview: row.text_preview,
        labels,
        sourceType: row.source_type,
        observedAt: row.observed_at ?? row.created_at,
        currentActiveMemoryItems: activeMemoryItems.map((item) => ({
          id: item.id,
          memoryType: item.memoryType,
          summaryText: item.summaryText,
          structured: item.structured,
          validUntil: item.validUntil,
        })),
        applyWrites: options.apply,
        precomputedExtraction: extraction,
      });

      const memoryTypes = [...new Set(extraction.memoryItems.map((item) => item.memoryType))];
      const notificationLevels = [...new Set(extraction.memoryItems.map((item) => item.notificationLevel))];
      const validUntil = [
        ...new Set(
          extraction.memoryItems
            .map((item) => item.validUntil)
            .filter((value): value is string => typeof value === "string" && value.length > 0)
        ),
      ];
      for (const item of extraction.memoryItems) {
        incrementCounter(byMemoryType, item.memoryType);
        incrementCounter(byNotificationLevel, item.notificationLevel as CoachMemoryExtractionNotificationLevel);
      }

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
        }
      }

      const key = studentSafeRef(student, studentId);
      const existingScore = studentScores.get(key) ?? { wouldInsert: 0, inserted: 0 };
      if (options.apply) {
        existingScore.inserted += result.inserted;
      } else {
        existingScore.wouldInsert += result.inserted;
      }
      studentScores.set(key, existingScore);

      const observationOutput: PerObservationOutput = {
        obs: row.id.slice(0, 8),
        student: key,
        source,
        status: mapStatus(result, options.apply),
        memoryTypes,
        notificationLevels,
        validUntil,
      };
      if (options.sample) {
        observationOutput.samplePreview = truncatePreview(row.text_preview, 100);
      }
      perObservation.push(observationOutput);
      printPerObservationLine(observationOutput);
    } catch (error) {
      counters.errors += 1;
      const observationOutput: PerObservationOutput = {
        obs: row.id.slice(0, 8),
        student: studentSafeRef(student, studentId),
        source,
        status: "error",
        memoryTypes: [],
        notificationLevels: [],
        validUntil: [],
      };
      if (options.sample) {
        observationOutput.samplePreview = truncatePreview(row.text_preview, 100);
      }
      perObservation.push(observationOutput);
      printPerObservationLine(observationOutput);

      const errorName = error instanceof Error ? error.name : "UnknownError";
      console.warn(`${LOG_PREFIX} observation_failed`, {
        observationIdPrefix: row.id.slice(0, 8),
        studentIdPrefix: studentId.slice(0, 8),
        errorClass: errorName,
      });
    }
  }

  const topStudents = [...studentScores.entries()]
    .map(([student, score]) => ({ student, wouldInsert: score.wouldInsert, inserted: score.inserted }))
    .sort((a, b) => b.wouldInsert + b.inserted - (a.wouldInsert + a.inserted) || a.student.localeCompare(b.student))
    .slice(0, TOP_STUDENT_COUNT);

  const recommendations = buildRecommendations(counters, bySourceType, byNotificationLevel);
  const payload: JsonPayload = {
    mode: options.apply ? "apply" : "dry-run",
    days: options.days,
    source: options.source,
    requestedLimit: options.requestedLimit,
    effectiveLimit: options.limit,
    selected: selectedRows.length,
    offset: options.offset,
    skipExistingSourceObservations: options.skipExistingSourceObservations,
    candidateObservationsBeforeSkip,
    existingSourceObservationsCount,
    candidateObservationsAfterSkip,
    processed: counters.processed,
    counters,
    bySourceType,
    byMemoryType,
    byNotificationLevel,
    studentCount: studentsWithProcessed.size,
    topStudents,
    recommendations,
    observations: perObservation,
  };

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("");
  console.log("Coach Memory v1 historical backfill summary:");
  console.log(`selected=${counters.selected}`);
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
  console.log(`students=${studentsWithProcessed.size}`);

  console.log("");
  console.log("By source_type:");
  for (const [key, value] of sortedCountEntries(bySourceType)) {
    console.log(`- ${key}: ${value}`);
  }

  console.log("");
  console.log("By memory_type:");
  for (const [key, value] of sortedCountEntries(byMemoryType)) {
    console.log(`- ${key}: ${value}`);
  }

  console.log("");
  console.log("By notificationLevel:");
  for (const [key, value] of sortedCountEntries(byNotificationLevel)) {
    console.log(`- ${key}: ${value}`);
  }

  console.log("");
  console.log("Top students by wouldInsert/inserted:");
  if (topStudents.length === 0) {
    console.log("- none");
  } else {
    for (const student of topStudents) {
      console.log(`- ${student.student}: wouldInsert=${student.wouldInsert} inserted=${student.inserted}`);
    }
  }

  console.log("");
  console.log("Prefilter skip reasons:");
  for (const [key, value] of sortedCountEntries(skipReasons)) {
    console.log(`- ${key}: ${value}`);
  }

  console.log("");
  console.log("Recommendations:");
  if (recommendations.length === 0) {
    console.log("- no additional recommendations");
  } else {
    for (const recommendation of recommendations) {
      console.log(`- ${recommendation}`);
    }
  }
}

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.startsWith(`${LOG_PREFIX} FAIL:`) ? message : `${LOG_PREFIX} FAIL: ${message}`);
  process.exit(1);
});
