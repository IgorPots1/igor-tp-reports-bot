import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient, type PostgrestError } from "@supabase/supabase-js";

const LOG_PREFIX = "[check-coach-memory-v1-estimate]";
const DEFAULT_DAYS = 14;
const MAX_SAMPLE_PER_TYPE = 3;

type MemoryType =
  | "communication_style"
  | "schedule_constraint"
  | "availability_preference"
  | "pain_or_injury"
  | "health_status"
  | "emotional_state"
  | "load_tolerance"
  | "planning_preference"
  | "race_or_goal"
  | "travel_or_life_event"
  | "equipment_or_device_note";

type NotificationTier = "immediate" | "digest" | "silent" | "ignored";

type CliOptions = {
  days: number;
  sample: boolean;
  studentQuery: string | null;
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
  text_sha256: string | null;
  created_at: string;
  metadata: unknown;
};

type ClassifiedObservation = {
  row: ObservationRow;
  memoryTypes: Set<MemoryType>;
  urgentSchedule: boolean;
  likelyNoise: boolean;
};

type SampleItem = {
  studentRef: string;
  sourceType: string;
  createdAtDate: string;
  labels: string[];
  textPreview: string | null;
};

const MEMORY_TYPES: MemoryType[] = [
  "communication_style",
  "schedule_constraint",
  "availability_preference",
  "pain_or_injury",
  "health_status",
  "emotional_state",
  "load_tolerance",
  "planning_preference",
  "race_or_goal",
  "travel_or_life_event",
  "equipment_or_device_note",
];

const IMMEDIATE_TYPES = new Set<MemoryType>(["pain_or_injury", "health_status"]);
const DIGEST_TYPES = new Set<MemoryType>([
  "emotional_state",
  "race_or_goal",
  "travel_or_life_event",
  "schedule_constraint",
  "availability_preference",
]);
const SILENT_TYPES = new Set<MemoryType>([
  "communication_style",
  "planning_preference",
  "equipment_or_device_note",
]);

const SCHEDULE_KEYWORDS = [
  "не смогу",
  "не могу",
  "не получится",
  "cannot train",
  "cannot run",
  "unavailable",
  "busy",
  "no time",
  "work",
  "график",
  "понедельник",
  "вторник",
  "среда",
  "четверг",
  "пятница",
  "суббота",
  "воскресенье",
  "завтра",
  "послезавтра",
  "следующая неделя",
  "следующей неделе",
  "на неделе",
  "выходные",
];

const URGENT_SCHEDULE_KEYWORDS = ["сегодня", "завтра", "послезавтра", "today", "tomorrow", "urgent"];

const AVAILABILITY_KEYWORDS = [
  "лучше ставить",
  "удобнее",
  "предпочитаю",
  "могу только",
  "удобно",
  "длительную в субботу",
  "интервалы во вторник",
  "prefer",
  "works better",
];

const PAIN_INJURY_KEYWORDS = [
  "боль",
  "болит",
  "дискомфорт",
  "тянет",
  "ноет",
  "травма",
  "колено",
  "голень",
  "ахилл",
  "стопа",
  "спина",
  "бедро",
  "таз",
  "икронож",
  "связка",
  "injury",
  "pain",
  "discomfort",
];

const HEALTH_KEYWORDS = [
  "заболел",
  "заболела",
  "температура",
  "простуда",
  "грипп",
  "кашель",
  "горло",
  "болезнь",
  "sick",
  "fever",
];

const EMOTIONAL_KEYWORDS = [
  "тяжело",
  "нет сил",
  "усталость",
  "устала",
  "устал",
  "стресс",
  "нет мотивации",
  "тяжко",
  "перегруз",
  "fatigue",
  "motivation",
  "mood",
];

const LOAD_KEYWORDS = [
  "слишком тяжело",
  "не вывожу",
  "много нагрузки",
  "перегруз",
  "overload",
  "too much load",
];

const PLANNING_KEYWORDS = [
  "длительную",
  "интервалы",
  "силовую",
  "сбу",
  "утро",
  "вечер",
  "удобно",
  "неудобно",
  "plan",
  "planning",
];

const RACE_GOAL_KEYWORDS = [
  "старт",
  "забег",
  "марафон",
  "полумарафон",
  "10к",
  "5к",
  "соревнование",
  "race",
  "marathon",
  "half marathon",
];

const TRAVEL_KEYWORDS = [
  "отпуск",
  "командировка",
  "поездка",
  "уезжаю",
  "перелёт",
  "travel",
  "vacation",
  "trip",
];

const EQUIPMENT_KEYWORDS = [
  "часы",
  "garmin",
  "apple watch",
  "пульсометр",
  "датчик",
  "hrm",
  "нет часов",
  "нет пульсометра",
];

const COMMUNICATION_STYLE_KEYWORDS = [
  "formal",
  "informal",
  "tone",
  "formality",
  "на вы",
  "на ты",
  "вежливо",
];

const NOISE_KEYWORDS = [
  "ok",
  "ок",
  "понял",
  "поняла",
  "спасибо",
  "thanks",
  "👍",
  "👌",
  "emoji",
  "ack",
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

function getEnvValue(name: "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    days: DEFAULT_DAYS,
    sample: false,
    studentQuery: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--sample") {
      options.sample = true;
      continue;
    }

    if (arg.startsWith("--days=")) {
      const rawValue = arg.slice("--days=".length).trim();
      const parsed = Number(rawValue);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`${LOG_PREFIX} FAIL: invalid --days value: ${rawValue}`);
      }
      options.days = Math.floor(parsed);
      continue;
    }

    if (arg === "--days") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --days`);
      }
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`${LOG_PREFIX} FAIL: invalid --days value: ${next}`);
      }
      options.days = Math.floor(parsed);
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
    }
  }

  return options;
}

function getIsoSince(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
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

function toObject(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  return input as Record<string, unknown>;
}

function containsAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function normalizeText(row: ObservationRow): string {
  const labels = coerceStringArray(row.labels).join(" ").toLowerCase();
  const source = (row.source_type ?? "").toLowerCase();
  const preview = (row.text_preview ?? "").toLowerCase();
  return `${source} ${labels} ${preview}`.trim();
}

function detectCommunicationStyle(row: ObservationRow): boolean {
  const labels = coerceStringArray(row.labels).map((item) => item.toLowerCase());
  const metadata = toObject(row.metadata);
  const metadataTone = typeof metadata?.tone === "string" ? metadata.tone.toLowerCase() : "";
  const metadataFormality = typeof metadata?.formality === "string" ? metadata.formality.toLowerCase() : "";
  const preview = (row.text_preview ?? "").toLowerCase();

  const fromLabels = labels.some(
    (label) =>
      label.includes("communication_style") ||
      label.includes("tone") ||
      label.includes("formal") ||
      label.includes("informal")
  );
  const fromMetadata = Boolean(metadataTone || metadataFormality);
  const fromExplicitPreview = containsAny(preview, COMMUNICATION_STYLE_KEYWORDS);
  return fromLabels || fromMetadata || fromExplicitPreview;
}

function classifyObservation(row: ObservationRow): ClassifiedObservation {
  const memoryTypes = new Set<MemoryType>();
  const normalized = normalizeText(row);

  if (detectCommunicationStyle(row)) {
    memoryTypes.add("communication_style");
  }
  if (containsAny(normalized, SCHEDULE_KEYWORDS)) {
    memoryTypes.add("schedule_constraint");
  }
  if (containsAny(normalized, AVAILABILITY_KEYWORDS)) {
    memoryTypes.add("availability_preference");
  }
  if (containsAny(normalized, PAIN_INJURY_KEYWORDS)) {
    memoryTypes.add("pain_or_injury");
  }
  if (containsAny(normalized, HEALTH_KEYWORDS)) {
    memoryTypes.add("health_status");
  }
  if (containsAny(normalized, EMOTIONAL_KEYWORDS)) {
    memoryTypes.add("emotional_state");
  }
  if (containsAny(normalized, LOAD_KEYWORDS)) {
    memoryTypes.add("load_tolerance");
  }
  if (containsAny(normalized, PLANNING_KEYWORDS)) {
    memoryTypes.add("planning_preference");
  }
  if (containsAny(normalized, RACE_GOAL_KEYWORDS)) {
    memoryTypes.add("race_or_goal");
  }
  if (containsAny(normalized, TRAVEL_KEYWORDS)) {
    memoryTypes.add("travel_or_life_event");
  }
  if (containsAny(normalized, EQUIPMENT_KEYWORDS)) {
    memoryTypes.add("equipment_or_device_note");
  }

  const likelyNoise = memoryTypes.size === 0 && containsAny(normalized, NOISE_KEYWORDS);
  const urgentSchedule = memoryTypes.has("schedule_constraint") && containsAny(normalized, URGENT_SCHEDULE_KEYWORDS);

  return {
    row,
    memoryTypes,
    urgentSchedule,
    likelyNoise,
  };
}

function studentShortRef(student: StudentRow | null): string {
  if (!student) {
    return "unknown";
  }
  const shortId = student.id.slice(0, 8);
  return `${student.student_id}:${shortId}`;
}

function formatPercent(numerator: number, denominator: number): string {
  if (denominator <= 0) {
    return "0.0%";
  }
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function incrementCounter(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

function sortCountEntries(entries: Record<string, number>): Array<[string, number]> {
  return Object.entries(entries).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
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

async function fetchStudents(supabaseUrl: string, serviceRoleKey: string): Promise<StudentRow[]> {
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.from("trainingpeaks_students").select("id, student_id, student_name");

  if (error) {
    if (isMissingRelationError(error)) {
      return [];
    }
    throw new Error(`${LOG_PREFIX} FAIL: trainingpeaks_students: ${error.message}`);
  }
  return (data as StudentRow[] | null) ?? [];
}

async function fetchObservations(
  supabaseUrl: string,
  serviceRoleKey: string,
  sinceIso: string,
  studentId: string | null
): Promise<ObservationRow[]> {
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let query = supabase
    .from("trainingpeaks_telegram_context_observations")
    .select("id, student_id, source_type, labels, text_preview, text_sha256, created_at, metadata")
    .gte("created_at", sinceIso);

  if (studentId) {
    query = query.eq("student_id", studentId);
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

function printLine(name: string, value: string | number): void {
  console.log(`${LOG_PREFIX} ${name}=${value}`);
}

function printSection(title: string): void {
  console.log("");
  console.log(`${LOG_PREFIX} ${title}`);
}

function truncatePreview(input: string | null): string | null {
  if (!input) {
    return null;
  }
  if (input.length <= 80) {
    return input;
  }
  return `${input.slice(0, 77)}...`;
}

async function run(): Promise<void> {
  loadLocalEnvFiles();
  const options = parseCliOptions(process.argv.slice(2));

  const supabaseUrl = getEnvValue("NEXT_PUBLIC_SUPABASE_URL") ?? getEnvValue("SUPABASE_URL");
  const serviceRoleKey = getEnvValue("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.log(`${LOG_PREFIX} SKIP: missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY`);
    return;
  }

  const students = await fetchStudents(supabaseUrl, serviceRoleKey);
  const studentById = new Map(students.map((item) => [item.id, item]));

  let filteredStudentId: string | null = null;
  if (options.studentQuery) {
    const query = options.studentQuery.toLowerCase().trim();
    const matches = students.filter((student) => {
      return (
        student.id.toLowerCase().startsWith(query) ||
        student.student_id.toLowerCase().startsWith(query) ||
        student.student_name.toLowerCase().startsWith(query)
      );
    });

    if (matches.length === 0) {
      printLine("student_filter", "no_matches");
      printLine("student_filter_query", JSON.stringify(options.studentQuery));
      printLine("student_filter_action", "narrow_or_fix_query");
      return;
    }
    if (matches.length > 1) {
      printLine("student_filter", "ambiguous");
      printLine("student_filter_query", JSON.stringify(options.studentQuery));
      printLine("student_filter_matches", matches.length);
      printLine("student_filter_action", "narrow_query");
      return;
    }

    filteredStudentId = matches[0].id;
    printLine("student_filter", "single_match");
    printLine("student_scope", studentShortRef(matches[0]));
  }

  const sinceIso = getIsoSince(options.days);
  const observations = await fetchObservations(supabaseUrl, serviceRoleKey, sinceIso, filteredStudentId);

  const classified = observations.map(classifyObservation);
  const totalObservations = classified.length;
  const uniqueStudents = new Set(
    classified
      .map((item) => item.row.student_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
  );

  const memoryTypeCounts: Record<MemoryType, number> = Object.fromEntries(
    MEMORY_TYPES.map((type) => [type, 0])
  ) as Record<MemoryType, number>;
  const memoryTypeStudentSets: Record<MemoryType, Set<string>> = Object.fromEntries(
    MEMORY_TYPES.map((type) => [type, new Set<string>()])
  ) as Record<MemoryType, Set<string>>;
  const sourceTypeCounts: Record<string, number> = {};
  const sourceByMemoryTypeCounts: Record<string, number> = {};
  const sampleByType = MEMORY_TYPES.reduce<Record<MemoryType, SampleItem[]>>((acc, type) => {
    acc[type] = [];
    return acc;
  }, {} as Record<MemoryType, SampleItem[]>);

  const emotionalOrLoadPerStudent: Record<string, number> = {};
  let likelyNoiseCount = 0;
  let candidateObservations = 0;
  let urgentScheduleCount = 0;
  const immediateStudents = new Set<string>();
  const safetyStudentSet = new Set<string>();

  for (const item of classified) {
    const sourceType = item.row.source_type ?? "unknown";
    incrementCounter(sourceTypeCounts, sourceType);
    if (item.likelyNoise) {
      likelyNoiseCount += 1;
    }
    if (item.urgentSchedule) {
      urgentScheduleCount += 1;
    }

    const studentId = item.row.student_id;
    const student = studentId ? studentById.get(studentId) ?? null : null;
    if (item.memoryTypes.size > 0) {
      candidateObservations += 1;
    }

    if (item.memoryTypes.has("emotional_state") || item.memoryTypes.has("load_tolerance")) {
      if (studentId) {
        incrementCounter(emotionalOrLoadPerStudent, studentId);
      }
    }

    for (const memoryType of item.memoryTypes) {
      memoryTypeCounts[memoryType] += 1;
      if (studentId) {
        memoryTypeStudentSets[memoryType].add(studentId);
      }
      if (memoryType === "pain_or_injury" || memoryType === "health_status") {
        if (studentId) {
          safetyStudentSet.add(studentId);
        }
      }
      incrementCounter(sourceByMemoryTypeCounts, `${sourceType}__${memoryType}`);

      if (options.sample && sampleByType[memoryType].length < MAX_SAMPLE_PER_TYPE) {
        sampleByType[memoryType].push({
          studentRef: studentShortRef(student),
          sourceType,
          createdAtDate: item.row.created_at.slice(0, 10),
          labels: coerceStringArray(item.row.labels).slice(0, 5),
          textPreview: truncatePreview(item.row.text_preview),
        });
      }
    }
  }

  const repeated2StudentIds = new Set(
    Object.entries(emotionalOrLoadPerStudent)
      .filter(([, count]) => count >= 2)
      .map(([studentId]) => studentId)
  );
  const repeated3StudentIds = new Set(
    Object.entries(emotionalOrLoadPerStudent)
      .filter(([, count]) => count >= 3)
      .map(([studentId]) => studentId)
  );

  const tierCounts: Record<NotificationTier, number> = {
    immediate: 0,
    digest: 0,
    silent: 0,
    ignored: 0,
  };

  for (const item of classified) {
    if (item.memoryTypes.size === 0) {
      tierCounts.ignored += 1;
      continue;
    }

    const studentId = item.row.student_id;
    const repeatedLoadSignal = Boolean(studentId && repeated2StudentIds.has(studentId));

    const hasImmediateType = [...item.memoryTypes].some((type) => IMMEDIATE_TYPES.has(type));
    const hasDigestType = [...item.memoryTypes].some((type) => DIGEST_TYPES.has(type));
    const hasSilentType = [...item.memoryTypes].some((type) => SILENT_TYPES.has(type));

    if (hasImmediateType || repeatedLoadSignal || item.urgentSchedule) {
      tierCounts.immediate += 1;
      if (studentId) {
        immediateStudents.add(studentId);
      }
    } else if (hasDigestType) {
      tierCounts.digest += 1;
    } else if (hasSilentType) {
      tierCounts.silent += 1;
    } else {
      tierCounts.ignored += 1;
    }
  }

  const skippedUnknownOrNoise = totalObservations - candidateObservations;
  const noiseReductionPercent = formatPercent(skippedUnknownOrNoise, totalObservations);
  const candidatePercent = totalObservations > 0 ? (candidateObservations / totalObservations) * 100 : 0;

  const schedulePlanningCount =
    memoryTypeCounts.schedule_constraint +
    memoryTypeCounts.availability_preference +
    memoryTypeCounts.planning_preference;
  const healthPainCount = memoryTypeCounts.pain_or_injury + memoryTypeCounts.health_status;

  const recommendations: string[] = [];
  if (candidatePercent < 35) {
    recommendations.push("Taxonomy looks narrow enough");
  }
  if (candidatePercent > 50) {
    recommendations.push("Too noisy");
  }
  if (healthPainCount > 0) {
    recommendations.push("Pain/health memory coverage exists");
  }
  if (schedulePlanningCount > 0) {
    recommendations.push("Schedule/planning extraction worth implementing");
  }
  if (memoryTypeCounts.schedule_constraint > 0 || memoryTypeCounts.travel_or_life_event > 0) {
    recommendations.push("Need AI for temporal parsing");
  }
  if (memoryTypeCounts.communication_style === 0) {
    recommendations.push("Communication style cannot be reliably inferred from observations yet");
  }

  const underdetected = MEMORY_TYPES.filter((type) => memoryTypeCounts[type] === 0);

  printLine("mode", "read-only");
  printLine("query_policy", "select_only");
  printLine("days_window", options.days);
  printLine("privacy_default", "aggregate_only");
  if (options.sample) {
    printLine("privacy_sensitive_mode", "enabled (--sample)");
  }

  printSection("1) Header");
  printLine("window_days", options.days);
  printLine("observations_scanned", totalObservations);
  printLine("unique_students_scanned", uniqueStudents.size);
  printLine("observations_skipped_likely_noise_ack_unknown", skippedUnknownOrNoise);
  printLine("likely_noise_ack_subset", likelyNoiseCount);
  printLine("observations_pass_to_ai_extraction_estimate", candidateObservations);
  printLine("estimated_noise_reduction", noiseReductionPercent);

  printSection("2) Memory type distribution");
  for (const memoryType of MEMORY_TYPES) {
    const count = memoryTypeCounts[memoryType];
    const unique = memoryTypeStudentSets[memoryType].size;
    printLine(`memory_${memoryType}_count`, count);
    printLine(`memory_${memoryType}_unique_students`, unique);
    printLine(`memory_${memoryType}_pct_all_observations`, formatPercent(count, totalObservations));
    printLine(`memory_${memoryType}_pct_candidate_observations`, formatPercent(count, candidateObservations));
  }

  printSection("3) Source distribution");
  for (const [sourceType, count] of sortCountEntries(sourceTypeCounts)) {
    printLine(`source_${sourceType}_count`, count);
  }
  for (const [bucket, count] of sortCountEntries(sourceByMemoryTypeCounts)) {
    const [sourceType, memoryType] = bucket.split("__");
    printLine(`source_memory_${sourceType}_${memoryType}`, count);
  }

  printSection("4) Repeated load/emotional signals");
  printLine("students_with_2plus_emotional_or_load_signals", repeated2StudentIds.size);
  printLine("students_with_3plus_emotional_or_load_signals", repeated3StudentIds.size);

  printSection("5) Schedule/planning usefulness");
  printLine("schedule_constraint_count", memoryTypeCounts.schedule_constraint);
  printLine("availability_preference_count", memoryTypeCounts.availability_preference);
  printLine("planning_preference_count", memoryTypeCounts.planning_preference);
  printLine("travel_or_life_event_count", memoryTypeCounts.travel_or_life_event);
  printLine("race_or_goal_count", memoryTypeCounts.race_or_goal);

  printSection("6) Safety/health");
  printLine("pain_or_injury_count", memoryTypeCounts.pain_or_injury);
  printLine("health_status_count", memoryTypeCounts.health_status);
  printLine("unique_students_affected_safety_health", safetyStudentSet.size);

  printSection("7) Estimate funnel");
  printLine("funnel_observations_scanned", totalObservations);
  printLine("funnel_memory_candidates", candidateObservations);
  printLine("funnel_would_be_immediate_notification", tierCounts.immediate);
  printLine("funnel_would_be_digest_only", tierCounts.digest);
  printLine("funnel_would_be_silent_memory", tierCounts.silent);
  printLine("funnel_ignored_noise", tierCounts.ignored);
  printLine("funnel_students_with_immediate_signals", immediateStudents.size);
  printLine("funnel_urgent_schedule_candidates", urgentScheduleCount);

  printSection("8) Underdetected categories");
  if (underdetected.length === 0) {
    printLine("underdetected", "none");
  } else {
    printLine("underdetected_count", underdetected.length);
    printLine("underdetected_types", underdetected.join(","));
  }

  printSection("9) Recommendations");
  if (recommendations.length === 0) {
    printLine("recommendation", "No recommendation triggered");
  } else {
    for (const recommendation of recommendations) {
      printLine("recommendation", recommendation);
    }
  }

  if (options.sample) {
    printSection("10) Sample mode (privacy-sensitive)");
    for (const memoryType of MEMORY_TYPES) {
      const samples = sampleByType[memoryType];
      if (samples.length === 0) {
        continue;
      }
      for (const sample of samples) {
        printLine(
          `sample_${memoryType}`,
          JSON.stringify({
            student: sample.studentRef,
            source_type: sample.sourceType,
            created_at_date: sample.createdAtDate,
            labels: sample.labels,
            text_preview: sample.textPreview,
          })
        );
      }
    }
  }

  console.log("");
  console.log(`${LOG_PREFIX} OK read-only estimate complete`);
}

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.startsWith(`${LOG_PREFIX} FAIL:`) ? message : `${LOG_PREFIX} FAIL: ${message}`);
  process.exit(1);
});
