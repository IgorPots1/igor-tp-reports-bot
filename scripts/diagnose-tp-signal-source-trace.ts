import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { classifyCoachOperationalSignal } from "@/features/trainingpeaks/coach-operational-signals";
import {
  getTrainingPeaksTelegramContextObservationById,
  listTrainingPeaksOperationalSignals,
  listTrainingPeaksStudents,
  type TrainingPeaksStudent,
  type TrainingPeaksStudentOperationalSignal,
  type TrainingPeaksTelegramContextObservation,
} from "@/features/trainingpeaks/repository";
import { createSupabaseServerClient } from "@/features/supabase/server";

const LOG_PREFIX = "[diagnose:tp-signal-source-trace]";
const REPORT_ROOT = "reports/tp-signals-source-trace";

type CliOptions = {
  asOfDate: string;
  name: string;
  signalId: string | null;
  windowDaysBefore: number;
  windowDaysAfter: number;
  includeIntentLogs: boolean;
  includeSiblingSignals: boolean;
  includeSameSourceCandidates: boolean;
  noWrite: boolean;
};

type RelatedObservationReport = {
  id: string;
  created_at: string;
  observed_at: string;
  text_preview: string;
  labels: string[];
  matched_dates_or_relative_terms: string[];
};

type SourceObservationReport = {
  created_at: string;
  observed_at: string;
  text_preview: string;
  labels: string[];
  text_sha256: string | null;
};

type DateExtractionTrace = {
  raw_date_tokens_found: string[];
  relative_terms_found: string[];
  normalized_dates: string[];
  normalization_reason: string;
  confidence: "high" | "medium" | "low" | "unknown";
};

type SignalTraceReport = {
  signal_id: string;
  signal_type: string;
  status: string;
  lifecycle_state: string | null;
  created_at: string;
  updated_at: string;
  valid_until: string | null;
  display_summary: string;
  latest_summary: string;
  structured_payload: {
    planned_training_dates: string[];
    unavailable_dates: string[];
    valid_from: string | null;
    valid_until: string | null;
  };
  source_observation_id: string | null;
  source_observation: SourceObservationReport | null;
  related_observations_window: RelatedObservationReport[];
  related_intent_logs: Array<{
    created_at: string;
    text_preview: string;
    status: string;
    ai_intent: Record<string, unknown> | null;
    final_intent: Record<string, unknown> | null;
  }>;
  sibling_signals: Array<{
    signal_id: string;
    signal_type: string;
    status: string;
    created_at: string;
    source_observation_id: string | null;
    planned_training_dates: string[];
    unavailable_dates: string[];
  }>;
  same_source_candidates: Array<{
    signal_id: string;
    signal_type: string;
    status: string;
    created_at: string;
    structured_payload: Record<string, unknown>;
  }>;
  keyword_snippets: Array<{
    keyword: string;
    observed_at: string;
    text_preview: string;
    labels: string[];
    is_source_observation: boolean;
  }>;
  parser_simulation: {
    signal_type: string | null;
    planned_training_dates: string[];
    unavailable_dates: string[];
    reason: string | null;
  } | null;
  date_extraction_trace: DateExtractionTrace;
  forensic_verdict:
    | "real_source_message"
    | "preview_truncated"
    | "stale_payload"
    | "wrong_merge"
    | "wrong_student_association"
    | "unknown";
  recommended_action: "leave_active" | "partial_only" | "dismiss_false_positive" | "needs_manual_review";
  notes: string[];
};

type FullReport = {
  student: string;
  as_of_date: string;
  signals: SignalTraceReport[];
};

type ObservationRow = {
  id: string;
  observed_at: string;
  created_at: string;
  labels: unknown;
  text_preview: string | null;
};

const KEYWORD_SNIPPET_TERMS = [
  "пн",
  "понедельник",
  "сегодня",
  "завтра",
  "10",
  "15",
  "не побегу",
  "планир",
  "недоступ",
  "не могу",
  "удалось",
  "был прям нужен",
] as const;

function cyrillicTokenPattern(token: string): RegExp {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?:^|[^a-zа-яё0-9])${escaped}(?:[^a-zа-яё0-9]|$)`, "iu");
}

const RELATIVE_DATE_PATTERNS: ReadonlyArray<{ pattern: RegExp; token: string }> = [
  { pattern: cyrillicTokenPattern("сегодня"), token: "сегодня" },
  { pattern: cyrillicTokenPattern("завтра"), token: "завтра" },
  { pattern: cyrillicTokenPattern("послезавтра"), token: "послезавтра" },
  { pattern: cyrillicTokenPattern("вчера"), token: "вчера" },
  { pattern: cyrillicTokenPattern("позавчера"), token: "позавчера" },
  { pattern: cyrillicTokenPattern("пн"), token: "пн" },
  { pattern: cyrillicTokenPattern("вт"), token: "вт" },
  { pattern: cyrillicTokenPattern("ср"), token: "ср" },
  { pattern: cyrillicTokenPattern("чт"), token: "чт" },
  { pattern: cyrillicTokenPattern("пт"), token: "пт" },
  { pattern: cyrillicTokenPattern("сб"), token: "сб" },
  { pattern: cyrillicTokenPattern("вс"), token: "вс" },
  { pattern: cyrillicTokenPattern("понедельник"), token: "понедельник" },
  { pattern: cyrillicTokenPattern("вторник"), token: "вторник" },
  { pattern: cyrillicTokenPattern("среда"), token: "среда" },
  { pattern: cyrillicTokenPattern("четверг"), token: "четверг" },
  { pattern: cyrillicTokenPattern("пятница"), token: "пятница" },
  { pattern: cyrillicTokenPattern("суббота"), token: "суббота" },
  { pattern: cyrillicTokenPattern("воскресенье"), token: "воскресенье" },
];

function loadLocalEnvFiles(): void {
  const repoRoot = path.resolve(process.cwd());
  for (const envPath of [path.join(repoRoot, ".env.local"), path.join(repoRoot, ".env")]) {
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
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

function parseIsoDate(raw: string): string {
  const normalized = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) {
    throw new Error(`${LOG_PREFIX} FAIL: invalid date: ${raw}`);
  }
  return normalized;
}

function parsePositiveInt(raw: string, flag: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${LOG_PREFIX} FAIL: invalid value for ${flag}: ${raw}`);
  }
  return parsed;
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    asOfDate: new Date().toISOString().slice(0, 10),
    name: "",
    signalId: null,
    windowDaysBefore: 5,
    windowDaysAfter: 5,
    includeIntentLogs: false,
    includeSiblingSignals: false,
    includeSameSourceCandidates: false,
    noWrite: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--no-write") {
      options.noWrite = true;
      continue;
    }
    if (arg === "--include-intent-logs") {
      options.includeIntentLogs = true;
      continue;
    }
    if (arg === "--include-sibling-signals") {
      options.includeSiblingSignals = true;
      continue;
    }
    if (arg === "--include-same-source-candidates") {
      options.includeSameSourceCandidates = true;
      continue;
    }
    if (arg.startsWith("--window-days-before=")) {
      options.windowDaysBefore = parsePositiveInt(arg.slice("--window-days-before=".length), "--window-days-before");
      continue;
    }
    if (arg === "--window-days-before") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --window-days-before`);
      }
      options.windowDaysBefore = parsePositiveInt(next, "--window-days-before");
      index += 1;
      continue;
    }
    if (arg.startsWith("--window-days-after=")) {
      options.windowDaysAfter = parsePositiveInt(arg.slice("--window-days-after=".length), "--window-days-after");
      continue;
    }
    if (arg === "--window-days-after") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --window-days-after`);
      }
      options.windowDaysAfter = parsePositiveInt(next, "--window-days-after");
      index += 1;
      continue;
    }
    if (arg.startsWith("--date=")) {
      options.asOfDate = parseIsoDate(arg.slice("--date=".length));
      continue;
    }
    if (arg === "--date") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --date`);
      }
      options.asOfDate = parseIsoDate(next);
      index += 1;
      continue;
    }
    if (arg.startsWith("--name=")) {
      options.name = arg.slice("--name=".length).trim();
      continue;
    }
    if (arg === "--name") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --name`);
      }
      options.name = next.trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--signal-id=")) {
      const value = arg.slice("--signal-id=".length).trim();
      options.signalId = value.length > 0 ? value : null;
      continue;
    }
    if (arg === "--signal-id") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --signal-id`);
      }
      options.signalId = next.trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`${LOG_PREFIX} FAIL: unknown argument: ${arg}`);
    }
  }
  if (!options.name) {
    throw new Error(`${LOG_PREFIX} FAIL: provide --name`);
  }
  return options;
}

function normalizeMatch(value: string | null | undefined): string {
  return (value ?? "")
    .toLocaleLowerCase("ru")
    .replace(/ё/gu, "е")
    .replace(/\s+/gu, " ")
    .trim();
}

function compactMatch(value: string | null | undefined): string {
  return normalizeMatch(value).replace(/[^a-zа-я0-9]+/giu, "");
}

function resolveStudentByName(students: TrainingPeaksStudent[], name: string): TrainingPeaksStudent {
  const normalizedQuery = normalizeMatch(name);
  const compactQuery = compactMatch(name);
  const matches = students.filter((student) => {
    const fields = [student.studentName, student.studentId, student.telegramUsername].filter(Boolean);
    return fields.some((field) => {
      const normalizedField = normalizeMatch(field);
      const compactField = compactMatch(field);
      return (
        normalizedField === normalizedQuery ||
        compactField === compactQuery ||
        normalizedField.includes(normalizedQuery) ||
        compactField.includes(compactQuery)
      );
    });
  });
  if (matches.length === 0) {
    throw new Error(`${LOG_PREFIX} FAIL: no student match for "${name}"`);
  }
  if (matches.length > 1) {
    console.warn(`${LOG_PREFIX} ambiguous student "${name}", using first: ${matches[0]!.studentName}`);
  }
  return matches[0]!;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function extractDateTokens(text: string): { rawTokens: string[]; relativeTerms: string[] } {
  const normalized = text.replace(/\s+/gu, " ").trim();
  if (!normalized) {
    return { rawTokens: [], relativeTerms: [] };
  }

  const raw = new Set<string>();
  const isoMatches = normalized.match(/\b\d{4}-\d{2}-\d{2}\b/gu) ?? [];
  for (const token of isoMatches) {
    raw.add(token);
  }
  const dotMatches = normalized.match(/\b\d{1,2}\.\d{1,2}(?:\.\d{2,4})?\b/gu) ?? [];
  for (const token of dotMatches) {
    raw.add(token);
  }

  const relative = new Set<string>();
  for (const entry of RELATIVE_DATE_PATTERNS) {
    if (entry.pattern.test(normalized)) {
      relative.add(entry.token);
    }
  }

  return {
    rawTokens: [...raw],
    relativeTerms: [...relative],
  };
}

function truncatePreview(value: string | null | undefined, max = 160): string {
  const normalized = (value ?? "").replace(/\s+/gu, " ").trim();
  if (!normalized) {
    return "";
  }
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}

async function listRelatedObservationsWindow(input: {
  studentId: string;
  centerObservedAt: string | null;
  fallbackAsOfDate: string;
  windowDaysBefore: number;
  windowDaysAfter: number;
  limit: number;
}): Promise<TrainingPeaksTelegramContextObservation[]> {
  const supabase = createSupabaseServerClient();
  const baseDate = input.centerObservedAt ?? `${input.fallbackAsOfDate}T00:00:00.000Z`;
  const base = new Date(baseDate);
  const fromIso = new Date(base.getTime() - input.windowDaysBefore * 24 * 60 * 60 * 1000).toISOString();
  const toIso = new Date(base.getTime() + input.windowDaysAfter * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("trainingpeaks_telegram_context_observations")
    .select("id, student_id, source_type, chat_id, message_thread_id, message_id, observed_at, labels, text_sha256, text_preview, metadata, created_at")
    .eq("student_id", input.studentId)
    .gte("observed_at", fromIso)
    .lte("observed_at", toIso)
    .order("observed_at", { ascending: false })
    .limit(input.limit);

  if (error) {
    throw new Error(`${LOG_PREFIX} FAIL: failed to load related observations: ${error.message}`);
  }

  const rows = (data as ObservationRow[] | null) ?? [];
  return rows.map((row) => ({
    id: row.id,
    studentId: input.studentId,
    sourceType: "private_dm",
    chatId: "",
    messageThreadId: null,
    messageId: null,
    observedAt: row.observed_at,
    labels: Array.isArray(row.labels) ? row.labels.map(String) : [],
    textSha256: null,
    textPreview: row.text_preview,
    metadata: {},
    createdAt: row.created_at,
  }));
}

async function listRelatedIntentLogs(input: {
  studentId: string;
  sourceObservation: TrainingPeaksTelegramContextObservation | null;
  asOfDate: string;
  centerObservedAt: string | null;
  windowDaysBefore: number;
  windowDaysAfter: number;
}): Promise<
  Array<{
    created_at: string;
    text_preview: string;
    status: string;
    ai_intent: Record<string, unknown> | null;
    final_intent: Record<string, unknown> | null;
  }>
> {
  const supabase = createSupabaseServerClient();
  const center = input.centerObservedAt ?? `${input.asOfDate}T12:00:00.000Z`;
  const base = new Date(center);
  const startIso = new Date(base.getTime() - input.windowDaysBefore * 24 * 60 * 60 * 1000).toISOString();
  const endIso = new Date(base.getTime() + input.windowDaysAfter * 24 * 60 * 60 * 1000).toISOString();

  let query = supabase
    .from("trainingpeaks_message_intent_logs")
    .select("created_at, text_preview, status, ai_intent, final_intent, telegram_chat_id, telegram_message_id, student_id")
    .eq("student_id", input.studentId)
    .gte("created_at", startIso)
    .lte("created_at", endIso)
    .order("created_at", { ascending: false })
    .limit(50);

  if (input.sourceObservation?.chatId) {
    query = query.eq("telegram_chat_id", input.sourceObservation.chatId);
  }
  if (input.sourceObservation?.messageId) {
    query = query.eq("telegram_message_id", input.sourceObservation.messageId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`${LOG_PREFIX} FAIL: failed to load related intent logs: ${error.message}`);
  }

  const rows =
    (data as Array<{
      created_at: string;
      text_preview: string | null;
      status: string;
      ai_intent: unknown;
      final_intent: unknown;
    }> | null) ?? [];

  return rows.map((row) => ({
    created_at: row.created_at,
    text_preview: truncatePreview(row.text_preview, 240),
    status: row.status,
    ai_intent:
      row.ai_intent && typeof row.ai_intent === "object" && !Array.isArray(row.ai_intent)
        ? (row.ai_intent as Record<string, unknown>)
        : null,
    final_intent:
      row.final_intent && typeof row.final_intent === "object" && !Array.isArray(row.final_intent)
        ? (row.final_intent as Record<string, unknown>)
        : null,
  }));
}

function inferVerdict(input: {
  sourceObservation: TrainingPeaksTelegramContextObservation | null;
  plannedDates: string[];
  unavailableDates: string[];
  extraction: { rawTokens: string[]; relativeTerms: string[] };
  relatedObservations: RelatedObservationReport[];
}): {
  verdict:
    | "real_source_message"
    | "preview_truncated"
    | "stale_payload"
    | "wrong_merge"
    | "wrong_student_association"
    | "unknown";
  recommendedAction: "leave_active" | "partial_only" | "dismiss_false_positive" | "needs_manual_review";
  notes: string[];
  normalizationReason: string;
  confidence: "high" | "medium" | "low" | "unknown";
} {
  const notes: string[] = [];
  const hasDatesInPayload = input.plannedDates.length > 0 || input.unavailableDates.length > 0;
  const hasDateTokensInSource = input.extraction.rawTokens.length > 0 || input.extraction.relativeTerms.length > 0;
  const hasDateTokensInRelated = input.relatedObservations.some((item) => item.matched_dates_or_relative_terms.length > 0);

  if (!input.sourceObservation) {
    notes.push("source_observation is missing for this signal row");
    return {
      verdict: "unknown",
      recommendedAction: "needs_manual_review",
      notes,
      normalizationReason: "missing_source_observation",
      confidence: "unknown",
    };
  }

  if (hasDatesInPayload && hasDateTokensInSource) {
    notes.push("Source preview contains direct/relative date cues consistent with payload dates.");
    if (input.plannedDates.length > 0 && input.unavailableDates.length > 0) {
      notes.push("Mixed past unavailable + future planned dates detected; keep row active with partial interpretation.");
      return {
        verdict: "real_source_message",
        recommendedAction: "partial_only",
        notes,
        normalizationReason: "source_text_contains_date_cues",
        confidence: "medium",
      };
    }
    return {
      verdict: "real_source_message",
      recommendedAction: "leave_active",
      notes,
      normalizationReason: "source_text_contains_date_cues",
      confidence: "high",
    };
  }

  if (hasDatesInPayload && !hasDateTokensInSource && hasDateTokensInRelated) {
    notes.push("Source preview has no explicit date cues, but nearby same-student observations include date/relative terms.");
    notes.push("Likely preview truncation or context carry from adjacent observation.");
    return {
      verdict: "preview_truncated",
      recommendedAction: input.plannedDates.length > 0 ? "needs_manual_review" : "dismiss_false_positive",
      notes,
      normalizationReason: "dates_found_only_in_related_observations_window",
      confidence: "low",
    };
  }

  if (hasDatesInPayload && !hasDateTokensInSource && !hasDateTokensInRelated) {
    notes.push("Payload keeps normalized dates not visible in source/related previews.");
    notes.push("Potential stale_payload or wrong merge; no safe auto-dismiss when future date exists.");
    return {
      verdict: "stale_payload",
      recommendedAction: input.plannedDates.some((date) => date >= new Date().toISOString().slice(0, 10))
        ? "needs_manual_review"
        : "dismiss_false_positive",
      notes,
      normalizationReason: "payload_dates_without_textual_support",
      confidence: "low",
    };
  }

  notes.push("Unable to determine deterministic source path from available traces.");
  return {
    verdict: "unknown",
    recommendedAction: "needs_manual_review",
    notes,
    normalizationReason: "insufficient_evidence",
    confidence: "unknown",
  };
}

function buildSummaryMarkdown(input: {
  generatedAt: string;
  reportDir: string;
  report: FullReport;
}): string {
  const lines: string[] = [];
  lines.push("# TP Signal Source Trace");
  lines.push("");
  lines.push(`- generated_at: ${input.generatedAt}`);
  lines.push(`- student: ${input.report.student}`);
  lines.push(`- as_of_date: ${input.report.as_of_date}`);
  lines.push(`- signals: ${input.report.signals.length}`);
  lines.push(`- report_dir: ${input.reportDir}`);
  lines.push("");

  for (const signal of input.report.signals) {
    lines.push(`## ${signal.signal_id}`);
    lines.push("");
    lines.push(`- signal_type: ${signal.signal_type}`);
    lines.push(`- status: ${signal.status}`);
    lines.push(`- lifecycle_state: ${signal.lifecycle_state ?? "null"}`);
    lines.push(`- valid_until: ${signal.valid_until ?? "null"}`);
    lines.push(`- source_observation_id: ${signal.source_observation_id ?? "null"}`);
    lines.push(`- forensic_verdict: ${signal.forensic_verdict}`);
    lines.push(`- recommended_action: ${signal.recommended_action}`);
    lines.push(`- normalized_dates: ${signal.date_extraction_trace.normalized_dates.join(", ") || "none"}`);
    lines.push(`- raw_date_tokens_found: ${signal.date_extraction_trace.raw_date_tokens_found.join(", ") || "none"}`);
    lines.push(`- relative_terms_found: ${signal.date_extraction_trace.relative_terms_found.join(", ") || "none"}`);
    lines.push(`- source_preview: ${signal.source_observation?.text_preview || "(empty)"}`);
    if (signal.parser_simulation) {
      lines.push(
        `- parser_simulation: planned=${signal.parser_simulation.planned_training_dates.join(",") || "none"} unavailable=${signal.parser_simulation.unavailable_dates.join(",") || "none"}`
      );
    }
    lines.push(`- keyword_snippets: ${signal.keyword_snippets.length}`);
    lines.push(`- sibling_signals: ${signal.sibling_signals.length}`);
    lines.push(`- same_source_candidates: ${signal.same_source_candidates.length}`);
    lines.push("");
    if (signal.notes.length > 0) {
      lines.push("Notes:");
      for (const note of signal.notes) {
        lines.push(`- ${note}`);
      }
      lines.push("");
    }
  }

  return `${lines.join("\n")}\n`;
}

function parseDateFromPayload(value: unknown): string[] {
  return normalizeStringArray(value).filter((entry) => /^\d{4}-\d{2}-\d{2}$/u.test(entry));
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function buildSignalDisplaySummary(signal: TrainingPeaksStudentOperationalSignal): string {
  const payload = normalizeMetadata(signal.structuredPayload);
  const displaySummary = readString(payload.display_summary);
  if (displaySummary) {
    return displaySummary;
  }
  const latestSummary = readString(payload.latest_summary);
  if (latestSummary) {
    return latestSummary;
  }
  return "";
}

function buildKeywordSnippets(input: {
  relatedObservations: RelatedObservationReport[];
  sourceObservationId: string | null;
}): SignalTraceReport["keyword_snippets"] {
  const snippets: SignalTraceReport["keyword_snippets"] = [];
  for (const observation of input.relatedObservations) {
    const haystack = observation.text_preview.toLocaleLowerCase("ru");
    for (const keyword of KEYWORD_SNIPPET_TERMS) {
      if (!haystack.includes(keyword)) {
        continue;
      }
      snippets.push({
        keyword,
        observed_at: observation.observed_at,
        text_preview: observation.text_preview,
        labels: observation.labels,
        is_source_observation: observation.id === input.sourceObservationId,
      });
    }
  }
  return snippets;
}

function buildSiblingSignals(input: {
  allSignals: TrainingPeaksStudentOperationalSignal[];
  targetSignalId: string;
  sourceObservationId: string | null;
}): SignalTraceReport["sibling_signals"] {
  return input.allSignals
    .filter((item) => item.id !== input.targetSignalId)
    .map((item) => {
      const payload = normalizeMetadata(item.structuredPayload);
      return {
        signal_id: item.id,
        signal_type: item.signalType,
        status: item.status,
        created_at: item.createdAt,
        source_observation_id: item.sourceObservationId,
        planned_training_dates: parseDateFromPayload(payload.planned_training_dates),
        unavailable_dates: parseDateFromPayload(payload.unavailable_dates),
      };
    });
}

function buildSameSourceCandidates(input: {
  allSignals: TrainingPeaksStudentOperationalSignal[];
  sourceObservationId: string | null;
}): SignalTraceReport["same_source_candidates"] {
  if (!input.sourceObservationId) {
    return [];
  }
  return input.allSignals
    .filter((item) => item.sourceObservationId === input.sourceObservationId)
    .map((item) => ({
      signal_id: item.id,
      signal_type: item.signalType,
      status: item.status,
      created_at: item.createdAt,
      structured_payload: normalizeMetadata(item.structuredPayload),
    }));
}

function simulateParserForSource(input: {
  sourceObservation: TrainingPeaksTelegramContextObservation | null;
  studentId: string;
}): SignalTraceReport["parser_simulation"] {
  if (!input.sourceObservation?.textPreview) {
    return null;
  }
  const parsed = classifyCoachOperationalSignal({
    sourceType: input.sourceObservation.sourceType,
    textPreview: input.sourceObservation.textPreview,
    labels: input.sourceObservation.labels,
    metadata: input.sourceObservation.metadata,
    observedAt: input.sourceObservation.observedAt,
    studentId: input.studentId,
  });
  return {
    signal_type: parsed.signal_type,
    planned_training_dates: normalizeStringArray(parsed.structured_payload.planned_training_dates),
    unavailable_dates: normalizeStringArray(parsed.structured_payload.unavailable_dates),
    reason: parsed.reason,
  };
}

async function run(): Promise<void> {
  loadLocalEnvFiles();
  const options = parseCliOptions(process.argv.slice(2));

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(`${LOG_PREFIX} FAIL: missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY`);
  }
  if (!process.env.SUPABASE_URL) {
    process.env.SUPABASE_URL = supabaseUrl;
  }

  const students = await listTrainingPeaksStudents();
  const student = resolveStudentByName(students, options.name);
  const signalsResult = await listTrainingPeaksOperationalSignals({
    studentQuery: student.studentName,
    status: "active",
    limit: 200,
  });
  const studentSignals = signalsResult.items.filter((signal) => signal.studentId === student.id);
  const targetSignals = options.signalId
    ? studentSignals.filter((signal) => signal.id === options.signalId)
    : studentSignals.filter((signal) => signal.signalType === "plan_generation_constraint");

  if (targetSignals.length === 0) {
    throw new Error(
      `${LOG_PREFIX} FAIL: no matching active signals for student=${student.studentName} signal_id=${options.signalId ?? "any"}`
    );
  }

  const reportSignals: SignalTraceReport[] = [];

  for (const signal of targetSignals) {
    const payload = normalizeMetadata(signal.structuredPayload);
    const plannedDates = parseDateFromPayload(payload.planned_training_dates);
    const unavailableDates = parseDateFromPayload(payload.unavailable_dates);
    const normalizedDates = [...new Set([...plannedDates, ...unavailableDates])].sort();
    const sourceObservation = signal.sourceObservationId
      ? await getTrainingPeaksTelegramContextObservationById(signal.sourceObservationId)
      : null;

    const sourcePreview = truncatePreview(sourceObservation?.textPreview ?? null, 240);
    const extracted = extractDateTokens(sourcePreview);
    const relatedObservations = await listRelatedObservationsWindow({
      studentId: student.id,
      centerObservedAt: sourceObservation?.observedAt ?? null,
      fallbackAsOfDate: options.asOfDate,
      windowDaysBefore: options.windowDaysBefore,
      windowDaysAfter: options.windowDaysAfter,
      limit: 80,
    });

    const relatedObservationReports: RelatedObservationReport[] = relatedObservations.map((item) => {
      const preview = truncatePreview(item.textPreview, 240);
      const extraction = extractDateTokens(preview);
      const matched = [...new Set([...extraction.rawTokens, ...extraction.relativeTerms])];
      return {
        id: item.id,
        created_at: item.createdAt,
        observed_at: item.observedAt,
        text_preview: preview,
        labels: item.labels,
        matched_dates_or_relative_terms: matched,
      };
    });

    const verdict = inferVerdict({
      sourceObservation,
      plannedDates,
      unavailableDates,
      extraction: extracted,
      relatedObservations: relatedObservationReports,
    });

    const relatedIntentLogs = options.includeIntentLogs
      ? await listRelatedIntentLogs({
          studentId: student.id,
          sourceObservation,
          asOfDate: options.asOfDate,
          centerObservedAt: sourceObservation?.observedAt ?? null,
          windowDaysBefore: options.windowDaysBefore,
          windowDaysAfter: options.windowDaysAfter,
        })
      : [];

    const siblingSignals = options.includeSiblingSignals
      ? buildSiblingSignals({
          allSignals: studentSignals,
          targetSignalId: signal.id,
          sourceObservationId: signal.sourceObservationId,
        })
      : [];

    const sameSourceCandidates = options.includeSameSourceCandidates
      ? buildSameSourceCandidates({
          allSignals: studentSignals,
          sourceObservationId: signal.sourceObservationId,
        })
      : [];

    const keywordSnippets = buildKeywordSnippets({
      relatedObservations: relatedObservationReports,
      sourceObservationId: signal.sourceObservationId,
    });

    const parserSimulation = simulateParserForSource({
      sourceObservation,
      studentId: student.id,
    });

    const notes = [...verdict.notes];
    if (options.includeIntentLogs) {
      if (relatedIntentLogs.length > 0) {
        notes.push(`Related intent logs found: ${relatedIntentLogs.length} row(s) in observation window.`);
      } else {
        notes.push("No related intent logs found in observation window.");
      }
    }
    if (parserSimulation) {
      notes.push(
        `Parser simulation: planned=${parserSimulation.planned_training_dates.join(",") || "none"} unavailable=${parserSimulation.unavailable_dates.join(",") || "none"}`
      );
    }
    if (extracted.relativeTerms.includes("сегодня") && extracted.relativeTerms.includes("пн")) {
      notes.push("Source contains both сегодня and пн; dates may come from relative weekday normalization at observed_at.");
    }

    reportSignals.push({
      signal_id: signal.id,
      signal_type: signal.signalType,
      status: signal.status,
      lifecycle_state: signal.lifecycleState,
      created_at: signal.createdAt,
      updated_at: signal.updatedAt,
      valid_until: signal.validUntil,
      display_summary: buildSignalDisplaySummary(signal),
      latest_summary: readString(payload.latest_summary),
      structured_payload: {
        planned_training_dates: plannedDates,
        unavailable_dates: unavailableDates,
        valid_from: signal.validFrom,
        valid_until: signal.validUntil ?? (readString(payload.valid_until) || null),
      },
      source_observation_id: signal.sourceObservationId,
      source_observation: sourceObservation
        ? {
            created_at: sourceObservation.createdAt,
            observed_at: sourceObservation.observedAt,
            text_preview: sourcePreview,
            labels: sourceObservation.labels,
            text_sha256: sourceObservation.textSha256,
          }
        : null,
      related_observations_window: relatedObservationReports,
      related_intent_logs: relatedIntentLogs,
      sibling_signals: siblingSignals,
      same_source_candidates: sameSourceCandidates,
      keyword_snippets: keywordSnippets,
      parser_simulation: parserSimulation,
      date_extraction_trace: {
        raw_date_tokens_found: extracted.rawTokens,
        relative_terms_found: extracted.relativeTerms,
        normalized_dates: normalizedDates,
        normalization_reason: verdict.normalizationReason,
        confidence: verdict.confidence,
      },
      forensic_verdict: verdict.verdict,
      recommended_action: verdict.recommendedAction,
      notes,
    });
  }

  const report: FullReport = {
    student: student.studentName,
    as_of_date: options.asOfDate,
    signals: reportSignals,
  };

  const timestamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const reportDir = path.join(REPORT_ROOT, timestamp);
  const generatedAt = new Date().toISOString();
  const summary = buildSummaryMarkdown({
    generatedAt,
    reportDir,
    report,
  });

  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, "polyakova-source-trace.json"), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(reportDir, "summary.md"), summary);

  console.log(
    `${LOG_PREFIX} student=${student.studentName} as_of=${options.asOfDate} signals=${reportSignals.length} no_write=${String(options.noWrite)}`
  );
  console.log(`${LOG_PREFIX} report_dir=${reportDir}`);
  for (const signal of reportSignals) {
    console.log(
      `- ${signal.signal_id} verdict=${signal.forensic_verdict} action=${signal.recommended_action} normalized_dates=${signal.date_extraction_trace.normalized_dates.join(",") || "none"}`
    );
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
