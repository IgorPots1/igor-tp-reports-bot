import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import type { PostgrestError } from "@supabase/supabase-js";

import {
  extractCoachMemoryItemsDryRun,
  type CoachMemoryExtractionItem,
  type CoachMemoryExtractionNotificationLevel,
  type CoachMemoryExtractionResult,
} from "@/features/trainingpeaks/coach-memory-extraction";
import { createSupabaseServerClient } from "@/features/supabase/server";

const LOG_PREFIX = "[check-coach-memory-v1-ai-dry-run]";
const DEFAULT_DAYS = 14;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT_DEFAULT = 50;
const MAX_SUMMARY_LINES = 3;

type CliOptions = {
  days: number;
  limit: number;
  studentQuery: string | null;
  noAi: boolean;
  json: boolean;
  sample: boolean;
  allowLarge: boolean;
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
  observed_at: string;
  created_at: string;
};

type SelectedObservation = {
  row: ObservationRow;
  labels: string[];
  student: StudentRow | null;
  score: number;
  selectedReasons: string[];
  prefilterNotes: string[];
};

type ObservationResult = {
  selected: SelectedObservation;
  extraction: CoachMemoryExtractionResult | null;
  extractorInput: {
    studentName: string;
    observationPreview: string;
    observationLabels: string[];
    sourceType: string | null;
    observedAt: string;
    referenceDate: string;
    currentActiveMemoryItems: Array<{
      memoryType: string;
      summaryText: string;
      structured?: Record<string, unknown>;
      validUntil?: string | null;
    }>;
  };
};

type SummaryCounters = {
  observationsTotal: number;
  memoryItemsTotal: number;
  shouldRememberCount: number;
  itemsByMemoryType: Record<string, number>;
  notificationTierCounts: Record<CoachMemoryExtractionNotificationLevel, number>;
  affectsPlanningCount: number;
  requiresCoachAttentionCount: number;
  lowConfidenceCount: number;
  communicationStyleFromBusinessDmCount: number;
  oneOffMoveDominantCount: number;
  oneOffMoveObservationsCount: number;
  likelyFalsePositiveNotes: string[];
  qualityWarnings: string[];
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

function getEnvValue(name: "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
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
    days: DEFAULT_DAYS,
    limit: DEFAULT_LIMIT,
    studentQuery: null,
    noAi: false,
    json: false,
    sample: false,
    allowLarge: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--no-ai") {
      options.noAi = true;
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
    if (arg === "--allow-large") {
      options.allowLarge = true;
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

  if (!options.allowLarge && options.limit > MAX_LIMIT_DEFAULT) {
    console.warn(
      `${LOG_PREFIX} WARN: --limit ${options.limit} exceeds ${MAX_LIMIT_DEFAULT}; capped to ${MAX_LIMIT_DEFAULT}. Use --allow-large to override.`
    );
    options.limit = MAX_LIMIT_DEFAULT;
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

function containsAny(text: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function normalizeForKeywords(input: string): string {
  return input.toLowerCase().replace(/\s+/gu, " ").trim();
}

function truncateOneLine(input: string | null, maxLength = 120): string {
  if (!input) {
    return "(empty)";
  }
  const singleLine = input.replace(/\s+/gu, " ").trim();
  if (singleLine.length <= maxLength) {
    return singleLine;
  }
  return `${singleLine.slice(0, maxLength - 3)}...`;
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

const ACK_NOISE_EXACT = new Set([
  "ok",
  "ок",
  "окей",
  "ага",
  "угу",
  "понял",
  "поняла",
  "принял",
  "приняла",
  "спасибо",
  "thanks",
  "thx",
  "👍",
  "👌",
  "🙏",
  "ясно",
]);

const ACK_NOISE_CONTAINS = ["small_talk", "small-talk", "ack", "emoji", "noise", "irrelevant"];
const CANDIDATE_LABELS = new Set([
  "pain_or_health",
  "schedule_context",
  "race_context",
  "question_to_coach",
  "move_workout_candidate",
]);
const REPORT_LIKE_LABEL = "report_like";

const EMOTIONAL_LOAD_KEYWORDS = [
  "тяжело",
  "устал",
  "устала",
  "усталость",
  "нет сил",
  "мотивац",
  "перегруз",
  "не вывожу",
  "слишком тяжело",
  "fatigue",
  "tired",
  "overload",
  "motivation",
];

const SCHEDULE_PLANNING_HINT_KEYWORDS = [
  "не смогу",
  "не могу",
  "не получится",
  "вторник",
  "среда",
  "четверг",
  "пятница",
  "суббота",
  "воскресенье",
  "понедельник",
  "завтра",
  "на следующей неделе",
  "на неделе",
  "удобнее",
  "удобно",
  "лучше ставить",
  "предпочитаю",
  "длительную",
  "интервалы",
];

const PAIN_HEALTH_HINT_KEYWORDS = [
  "болит",
  "боль",
  "дискомфорт",
  "травм",
  "колено",
  "ахилл",
  "спина",
  "температура",
  "забол",
  "простуд",
];

const ONE_OFF_MOVE_REQUEST_KEYWORDS = [
  "перенести",
  "перенесу",
  "перенес",
  "перенос",
  "на завтра",
  "можно завтра",
  "попробую завтра",
  "побегу завтра",
  "не побегу сегодня",
  "из-за дождя",
  "move to tomorrow",
];

function isOneOffMoveRequest(textPreview: string | null): boolean {
  const preview = normalizeForKeywords(textPreview ?? "");
  return containsAny(preview, ONE_OFF_MOVE_REQUEST_KEYWORDS);
}

function scoreObservationCandidate(row: ObservationRow): {
  selected: boolean;
  score: number;
  selectedReasons: string[];
  notes: string[];
} {
  const labels = coerceStringArray(row.labels).map((label) => label.toLowerCase());
  const preview = normalizeForKeywords(row.text_preview ?? "");
  const selectedReasons: string[] = [];
  const notes: string[] = [];

  if (!preview && labels.length === 0) {
    return { selected: false, score: 0, selectedReasons, notes: ["empty_observation"] };
  }

  if (preview.length <= 16 && ACK_NOISE_EXACT.has(preview)) {
    return { selected: false, score: 0, selectedReasons, notes: ["short_ack_noise"] };
  }

  if (labels.some((label) => ACK_NOISE_CONTAINS.some((noiseTag) => label.includes(noiseTag)))) {
    return { selected: false, score: 0, selectedReasons, notes: ["ack_noise_label"] };
  }

  let score = 0;

  for (const label of labels) {
    if (CANDIDATE_LABELS.has(label)) {
      score += 6;
      selectedReasons.push(`label:${label}`);
    }
  }

  if (labels.includes(REPORT_LIKE_LABEL)) {
    const hasUsefulReportHint =
      containsAny(preview, SCHEDULE_PLANNING_HINT_KEYWORDS) ||
      containsAny(preview, PAIN_HEALTH_HINT_KEYWORDS) ||
      containsAny(preview, EMOTIONAL_LOAD_KEYWORDS);
    if (hasUsefulReportHint) {
      score += 3;
      selectedReasons.push("label:report_like+hint");
    } else {
      notes.push("report_like_without_memory_hint");
    }
  }

  if (containsAny(preview, PAIN_HEALTH_HINT_KEYWORDS)) {
    score += 5;
    selectedReasons.push("keyword:pain_health");
  }
  if (containsAny(preview, SCHEDULE_PLANNING_HINT_KEYWORDS)) {
    score += 4;
    selectedReasons.push("keyword:schedule_planning");
  }
  if (containsAny(preview, EMOTIONAL_LOAD_KEYWORDS)) {
    score += 4;
    selectedReasons.push("keyword:emotional_load");
  }
  if (preview.includes("?")) {
    score += 2;
    selectedReasons.push("hint:question");
  }

  const tooShortLikelyNoise = preview.length > 0 && preview.length <= 10 && score < 6;
  if (tooShortLikelyNoise) {
    notes.push("too_short_low_signal");
    return { selected: false, score: 0, selectedReasons, notes };
  }

  return {
    selected: score >= 6,
    score,
    selectedReasons,
    notes,
  };
}

function printHeader(options: CliOptions, selectedCount: number, aiCalls: number): void {
  console.log("Coach Memory v1 AI Dry Run");
  console.log(`Window: ${options.days}d`);
  console.log(`Limit: ${options.limit}`);
  console.log(`Observations selected: ${selectedCount}`);
  console.log(`AI calls: ${aiCalls}`);
}

function printItemLine(item: CoachMemoryExtractionItem): void {
  const parts = [
    `type=${item.memoryType}`,
    `summary=${JSON.stringify(truncateOneLine(item.summaryText, 110))}`,
    `confidence=${item.confidence.toFixed(2)}`,
    `notification=${item.notificationLevel}`,
    `affectsPlanning=${item.affectsPlanning ? "yes" : "no"}`,
  ];
  if (item.validUntil) {
    parts.push(`validUntil=${item.validUntil}`);
  }
  console.log(`  - ${parts.join(" | ")}`);
}

function printObservationResult(result: ObservationResult, noAiMode: boolean, sampleMode: boolean): void {
  const row = result.selected.row;
  const shortObsId = row.id.slice(0, 8);
  const safeRef = studentSafeRef(result.selected.student, row.student_id);

  console.log("");
  console.log(`Observation ${shortObsId}`);
  console.log(`  student=${safeRef}`);
  console.log(`  source_type=${row.source_type ?? "unknown"}`);
  console.log(`  labels=${result.selected.labels.join(",") || "(none)"}`);
  console.log(`  prefilter_score=${result.selected.score}`);
  if (result.selected.selectedReasons.length > 0) {
    console.log(`  prefilter_reasons=${result.selected.selectedReasons.join(",")}`);
  }
  if (sampleMode) {
    console.log(`  preview=${JSON.stringify(truncateOneLine(row.text_preview, 140))}`);
  }

  if (noAiMode) {
    console.log("  AI result: skipped (--no-ai)");
    const compactInput = {
      studentName: result.extractorInput.studentName,
      sourceType: result.extractorInput.sourceType,
      observedAt: result.extractorInput.observedAt,
      labels: result.extractorInput.observationLabels,
      observationPreview: truncateOneLine(result.extractorInput.observationPreview, 120),
      activeMemoryCount: result.extractorInput.currentActiveMemoryItems.length,
    };
    console.log(`  extractor_input=${JSON.stringify(compactInput)}`);
    return;
  }

  const extraction = result.extraction;
  if (!extraction) {
    console.log("  AI result: missing");
    return;
  }

  console.log("  AI result:");
  console.log(`    shouldRemember=${extraction.shouldRemember ? "true" : "false"}`);
  if (extraction.memoryItems.length === 0) {
    console.log("    memory_items=(none)");
  } else {
    console.log("    memory_items:");
    for (const item of extraction.memoryItems) {
      printItemLine(item);
    }
  }
  if (extraction.caseCandidate) {
    console.log(
      `    case_candidate=${JSON.stringify({
        kind: extraction.caseCandidate.kind,
        priority: extraction.caseCandidate.priority,
      })}`
    );
  }
  console.log(`    reason=${JSON.stringify(truncateOneLine(extraction.reason, 180))}`);
}

function summarizeResults(results: ObservationResult[]): SummaryCounters {
  const summary: SummaryCounters = {
    observationsTotal: results.length,
    memoryItemsTotal: 0,
    shouldRememberCount: 0,
    itemsByMemoryType: {},
    notificationTierCounts: {
      immediate: 0,
      digest: 0,
      silent: 0,
      ignore: 0,
    },
    affectsPlanningCount: 0,
    requiresCoachAttentionCount: 0,
    lowConfidenceCount: 0,
    communicationStyleFromBusinessDmCount: 0,
    oneOffMoveDominantCount: 0,
    oneOffMoveObservationsCount: 0,
    likelyFalsePositiveNotes: [],
    qualityWarnings: [],
  };

  for (const result of results) {
    const extraction = result.extraction;
    const isOneOffMove = isOneOffMoveRequest(result.selected.row.text_preview);
    if (isOneOffMove) {
      summary.oneOffMoveObservationsCount += 1;
    }
    if (!extraction) {
      continue;
    }

    if (extraction.shouldRemember) {
      summary.shouldRememberCount += 1;
    } else if (result.selected.score >= 10) {
      summary.likelyFalsePositiveNotes.push(
        `obs:${result.selected.row.id.slice(0, 8)} high prefilter score but shouldRemember=false`
      );
    }

    for (const item of extraction.memoryItems) {
      summary.memoryItemsTotal += 1;
      summary.itemsByMemoryType[item.memoryType] = (summary.itemsByMemoryType[item.memoryType] ?? 0) + 1;
      summary.notificationTierCounts[item.notificationLevel] += 1;
      if (item.affectsPlanning) {
        summary.affectsPlanningCount += 1;
      }
      if (item.requiresCoachAttention) {
        summary.requiresCoachAttentionCount += 1;
      }
      if (item.confidence < 0.55) {
        summary.lowConfidenceCount += 1;
      }
      if (
        item.memoryType === "communication_style" &&
        result.selected.row.source_type?.toLowerCase() === "business_dm"
      ) {
        summary.communicationStyleFromBusinessDmCount += 1;
      }
      if (
        item.memoryType === "communication_style" &&
        item.structured.preferred_greeting == null &&
        item.structured.greeting_confidence != null &&
        Number(item.structured.greeting_confidence) > 0.7
      ) {
        summary.likelyFalsePositiveNotes.push(
          `obs:${result.selected.row.id.slice(0, 8)} greeting_confidence high with null preferred_greeting`
        );
      }
    }

    if (isOneOffMove && extraction.memoryItems.length > 0) {
      summary.oneOffMoveDominantCount += 1;
    }
  }

  if (summary.likelyFalsePositiveNotes.length > MAX_SUMMARY_LINES) {
    summary.likelyFalsePositiveNotes = summary.likelyFalsePositiveNotes.slice(0, MAX_SUMMARY_LINES);
  }

  const shouldRememberRatio = summary.observationsTotal > 0 ? summary.shouldRememberCount / summary.observationsTotal : 0;
  const immediateRatio = summary.memoryItemsTotal > 0 ? summary.notificationTierCounts.immediate / summary.memoryItemsTotal : 0;

  if (shouldRememberRatio > 0.6) {
    summary.qualityWarnings.push(
      `shouldRemember ratio high: ${(shouldRememberRatio * 100).toFixed(1)}% > 60%`
    );
  }
  if (immediateRatio > 0.4) {
    summary.qualityWarnings.push(
      `immediate ratio high: ${(immediateRatio * 100).toFixed(1)}% > 40%`
    );
  }
  if (summary.communicationStyleFromBusinessDmCount > 0) {
    summary.qualityWarnings.push(
      `communication_style emitted from business_dm: ${summary.communicationStyleFromBusinessDmCount}`
    );
  }
  if (summary.oneOffMoveDominantCount > 0 && summary.oneOffMoveObservationsCount > 0) {
    const oneOffMemoryRatio = summary.oneOffMoveDominantCount / summary.oneOffMoveObservationsCount;
    if (oneOffMemoryRatio > 0.5) {
      summary.qualityWarnings.push(
        `one-off move requests dominating memory candidates: ${(oneOffMemoryRatio * 100).toFixed(1)}%`
      );
    }
  }

  return summary;
}

async function fetchStudents(): Promise<StudentRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.from("trainingpeaks_students").select("id, student_id, student_name");
  if (error) {
    throw new Error(`${LOG_PREFIX} FAIL: trainingpeaks_students: ${error.message}`);
  }
  return (data as StudentRow[] | null) ?? [];
}

async function fetchRecentObservations(sinceIso: string): Promise<ObservationRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_telegram_context_observations")
    .select("id, student_id, source_type, labels, text_preview, observed_at, created_at")
    .gte("observed_at", sinceIso)
    .order("observed_at", { ascending: false })
    .limit(2000);

  if (error) {
    if (isMissingRelationError(error)) {
      return [];
    }
    throw new Error(`${LOG_PREFIX} FAIL: trainingpeaks_telegram_context_observations: ${error.message}`);
  }

  return (data as ObservationRow[] | null) ?? [];
}

function buildExtractorInput(selected: SelectedObservation, referenceDate: string): ObservationResult["extractorInput"] {
  return {
    studentName: selected.student?.student_name ?? "Unknown student",
    observationPreview: selected.row.text_preview ?? "",
    observationLabels: selected.labels,
    sourceType: selected.row.source_type,
    observedAt: selected.row.observed_at,
    referenceDate,
    currentActiveMemoryItems: [],
  };
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
  if (!process.env.SUPABASE_URL) {
    process.env.SUPABASE_URL = supabaseUrl;
  }

  const hasApiKey = Boolean(process.env.OPENAI_API_KEY?.trim());
  if (!options.noAi && !hasApiKey) {
    console.warn(`${LOG_PREFIX} WARN: OPENAI_API_KEY missing; switching to --no-ai behavior.`);
  }

  const sinceIso = getIsoSince(options.days);
  const students = await fetchStudents();
  const studentById = new Map(students.map((item) => [item.id, item]));

  let studentFilterId: string | null = null;
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
      console.log(`${LOG_PREFIX} student_filter=no_matches query=${JSON.stringify(options.studentQuery)}`);
      return;
    }
    if (matches.length > 1) {
      console.log(`${LOG_PREFIX} student_filter=ambiguous query=${JSON.stringify(options.studentQuery)} matches=${matches.length}`);
      return;
    }
    studentFilterId = matches[0].id;
  }

  const observationRows = await fetchRecentObservations(sinceIso);
  const filteredRows = studentFilterId
    ? observationRows.filter((row) => row.student_id === studentFilterId)
    : observationRows;

  const selectedScored: SelectedObservation[] = [];
  for (const row of filteredRows) {
    const labels = coerceStringArray(row.labels);
    const scored = scoreObservationCandidate(row);
    if (!scored.selected) {
      continue;
    }
    selectedScored.push({
      row,
      labels,
      student: row.student_id ? studentById.get(row.student_id) ?? null : null,
      score: scored.score,
      selectedReasons: scored.selectedReasons,
      prefilterNotes: scored.notes,
    });
  }

  selectedScored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return new Date(b.row.observed_at).getTime() - new Date(a.row.observed_at).getTime();
  });
  const selected = selectedScored.slice(0, options.limit);

  const noAiMode = options.noAi || !hasApiKey;
  const referenceDate = new Date().toISOString().slice(0, 10);
  const results: ObservationResult[] = [];
  let aiCalls = 0;

  if (!noAiMode) {
    process.env.COACH_MEMORY_AI_DRY_RUN_MODE = "1";
  }

  for (const selectedObservation of selected) {
    const extractorInput = buildExtractorInput(selectedObservation, referenceDate);
    if (noAiMode) {
      results.push({
        selected: selectedObservation,
        extraction: null,
        extractorInput,
      });
      continue;
    }

    aiCalls += 1;
    const extraction = await extractCoachMemoryItemsDryRun(extractorInput);
    results.push({
      selected: selectedObservation,
      extraction,
      extractorInput,
    });
  }

  if (!noAiMode) {
    delete process.env.COACH_MEMORY_AI_DRY_RUN_MODE;
  }

  if (options.json) {
    const payload = {
      title: "Coach Memory v1 AI Dry Run",
      windowDays: options.days,
      limit: options.limit,
      observationsSelected: selected.length,
      aiCalls,
      noAiMode,
      observations: results.map((result) => ({
        observationId: result.selected.row.id.slice(0, 8),
        student: studentSafeRef(result.selected.student, result.selected.row.student_id),
        sourceType: result.selected.row.source_type ?? "unknown",
        labels: result.selected.labels,
        prefilter: {
          score: result.selected.score,
          reasons: result.selected.selectedReasons,
        },
        aiResult: result.extraction,
        extractorInput:
          noAiMode || options.sample
            ? {
                studentName: result.extractorInput.studentName,
                sourceType: result.extractorInput.sourceType,
                observedAt: result.extractorInput.observedAt,
                labels: result.extractorInput.observationLabels,
                observationPreview: truncateOneLine(result.extractorInput.observationPreview, 160),
              }
            : undefined,
      })),
      summary: summarizeResults(results),
    };
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  printHeader(options, selected.length, aiCalls);
  console.log(`${LOG_PREFIX} mode=read-only`);
  console.log(`${LOG_PREFIX} privacy=compact-safe`);
  if (noAiMode) {
    console.log(`${LOG_PREFIX} ai_mode=disabled`);
  }
  if (options.sample) {
    console.log(`${LOG_PREFIX} sample_mode=enabled`);
  }

  for (const result of results) {
    printObservationResult(result, noAiMode, options.sample);
  }

  console.log("");
  console.log("Summary:");
  const summary = summarizeResults(results);
  console.log(`- shouldRemember count: ${summary.shouldRememberCount}`);
  console.log(`- items by memoryType: ${JSON.stringify(summary.itemsByMemoryType)}`);
  console.log(`- notification tiers: ${JSON.stringify(summary.notificationTierCounts)}`);
  console.log(`- affectsPlanning count: ${summary.affectsPlanningCount}`);
  console.log(`- requiresCoachAttention count: ${summary.requiresCoachAttentionCount}`);
  console.log(`- low confidence count: ${summary.lowConfidenceCount}`);
  console.log(
    `- communication_style from business_dm: ${summary.communicationStyleFromBusinessDmCount}`
  );
  console.log(
    `- one-off move observations with memory: ${summary.oneOffMoveDominantCount}/${summary.oneOffMoveObservationsCount}`
  );
  if (summary.likelyFalsePositiveNotes.length === 0) {
    console.log("- likely false positive notes: none");
  } else {
    console.log(`- likely false positive notes: ${summary.likelyFalsePositiveNotes.join("; ")}`);
  }
  if (summary.qualityWarnings.length === 0) {
    console.log("- quality warnings: none");
  } else {
    console.log(`- quality warnings: ${summary.qualityWarnings.join("; ")}`);
  }

  console.log("");
  console.log(`${LOG_PREFIX} OK dry-run complete (no DB writes)`);
}

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.startsWith(`${LOG_PREFIX} FAIL:`) ? message : `${LOG_PREFIX} FAIL: ${message}`);
  process.exit(1);
});
