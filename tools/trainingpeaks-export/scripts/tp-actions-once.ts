import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

import { profileDir, toolRoot } from "./lib/paths.ts";

type ActionExecutionStatus =
  | "not_started"
  | "dry_run_running"
  | "dry_run_completed"
  | "execute_pending"
  | "running_local"
  | "completed"
  | "failed";

type ActionExecutionMode = "dry_run" | "real";
type ActionRunType = "dry_run" | "real";
type ActionRunStatus = "running" | "completed" | "failed";

type TrainingPeaksStudentRow = {
  id: string;
  student_id: string;
  student_name: string;
  telegram_chat_id: string | null;
  trainingpeaks_athlete_url: string;
};

type TrainingPeaksActionRow = {
  id: string;
  student_id: string | null;
  action_type: "move_workout";
  status: "pending_coach" | "approved" | "rejected";
  raw_text: string;
  parsed_payload: unknown;
  coach_chat_id: string | null;
  decided_by_chat_id: string | null;
  execution_status: ActionExecutionStatus;
  execution_mode: ActionExecutionMode | null;
};

type TrainingPeaksActionRunRow = {
  id: string;
  action_id: string;
  run_type: ActionRunType;
  status: ActionRunStatus;
  dry_run: boolean;
  runner_id: string | null;
  started_at: string;
};

type ClaimedAction = {
  action: TrainingPeaksActionRow;
  student: TrainingPeaksStudentRow | null;
};

type DryRunArtifacts = {
  screenshotBeforePath: string;
  screenshotAfterPath: string | null;
  dryRunEvaluation: DryRunEvaluation;
  pageMeta: {
    url: string;
    title: string;
    loginRequired: boolean;
    athletePageLikelyReachable: boolean;
    trainingPeaksContextLikely: boolean;
  };
};

type TrainingPeaksMoveWorkoutTarget =
  | { kind: "relative_day"; value: "tomorrow" | "day_after_tomorrow"; sourceText?: string }
  | {
      kind: "weekday";
      value: "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
      sourceText?: string;
    };

type ParsedMoveWorkoutPayload = {
  actionType?: "move_workout";
  target?: TrainingPeaksMoveWorkoutTarget;
  source?: TrainingPeaksMoveWorkoutTarget | { date?: string; isoDate?: string };
  sourceDate?: string;
  source_date?: string;
};

type DryRunResult = "candidate_found" | "ambiguous" | "not_found" | "failed";

type DryRunResolvedDates = {
  sourceDate: string | null;
  targetDate: string | null;
  timezone: string | null;
};

type DryRunCandidate = {
  title: string | null;
  type: string | null;
  plannedDurationSec: number | null;
  plannedDistance: number | null;
  startTimeLocal: string | null;
  fingerprint: string;
};

type DryRunDiagnostics = {
  loginRequired: boolean;
  athleteReachable: boolean;
  trainingPeaksContextOk: boolean;
  parseWarnings: string[];
  domDebug?: DryRunDomDebug | null;
};

type IdentityMatchType = "athlete_id" | "trainingpeaks_name" | "inconclusive" | "mismatch";

type DryRunIdentityCheck = {
  telegramUsername: string | null;
  telegramChatId: string | null;
  expectedTrainingPeaksName: string | null;
  visibleTrainingPeaksName: string | null;
  expectedAthleteId: string | null;
  currentAthleteId: string | null;
  expectedTrainingPeaksUrl: string | null;
  currentUrl: string | null;
  matchedBy: IdentityMatchType;
  warnings: string[];
};

type DryRunDebugCandidate = {
  rawTextSnippet: string;
  selectorHint: string | null;
  classHint: string | null;
  title: string | null;
  type: string | null;
  plannedDurationSec: number | null;
  plannedDistance: number | null;
  startTimeLocal: string | null;
  sourceDate: string | null;
  score: number;
  reasons: string[];
};

type DryRunEvaluation = {
  dryRunResult: DryRunResult;
  resolvedDates: DryRunResolvedDates;
  candidate: DryRunCandidate | null;
  candidateAlternativesCount: number;
  confidence: number;
  canExecute: boolean;
  canExecuteReasons: string[];
  diagnostics: DryRunDiagnostics;
  identityCheck: DryRunIdentityCheck;
  debugCandidatesTopN: DryRunDebugCandidate[];
  rankingDebug?: {
    strictGlobalCount: number;
    selectedSourceDatePolicy: string;
    selectedSourceDate: string | null;
    selectedSourceDateCandidateCount: number;
    globalCandidateCount: number;
    sourceDateBucketCounts: Record<string, number>;
  };
  selectedSourceDatePolicy?: string;
  selectedSourceDate?: string | null;
  selectedSourceDateCandidateCount?: number;
  globalCandidateCount?: number;
  sourceDateBucketCounts?: Record<string, number>;
};

type RawWorkoutCandidate = {
  rawTextSnippet: string;
  selectorHint: string | null;
  classHint: string | null;
  title: string | null;
  type: string | null;
  plannedDurationSec: number | null;
  plannedDistance: number | null;
  startTimeLocal: string | null;
  dateIso: string | null;
  reasons: string[];
  fromFallback: boolean;
  rawScore: number;
};

type DryRunDomDebugSelectorCounts = {
  calendarRoots: number;
  dayCells: number;
  primaryWorkoutCards: number;
  fallbackWorkoutDivCards: number;
};

type DryRunDomDebugCheckpoint = {
  label: string;
  selectorCounts: DryRunDomDebugSelectorCounts;
};

type DryRunDomDebug = {
  enabled: boolean;
  calendarRootClass: string | null;
  selectorCounts: DryRunDomDebugSelectorCounts;
  checkpoints: DryRunDomDebugCheckpoint[];
  cardSnippets: string[];
  extractionError: string | null;
};

type WorkoutExtractionResult = {
  candidates: RawWorkoutCandidate[];
  domDebug: DryRunDomDebug | null;
  parseWarnings: string[];
  extractionError: string | null;
};

const TELEGRAM_API_BASE_URL = "https://api.telegram.org";
const TP_CALLBACK_ACTION_EXECUTE_PREFIX = "tp:ta:x:";
const TP_CALLBACK_ACTION_CANCEL_PREFIX = "tp:ta:c:";
const ACTION_ARTIFACTS_ROOT = path.join(toolRoot, "action-artifacts");
const TP_CALENDAR_ROOT_SELECTOR = "div.calendar.athleteCalendar";
const TP_DAY_CELL_SELECTOR = ".dayWidth.dayContainer.day";
const TP_PRIMARY_WORKOUT_CARD_SELECTOR = ".dayWidth.dayContainer.day .activities .MuiCard-root.activity.workout";
const TP_FALLBACK_WORKOUT_CARD_SELECTOR = ".dayWidth.dayContainer.day .workoutDiv";
const TP_PRIMARY_WORKOUT_CARD_WITHIN_DAY_SELECTOR = ".activities .MuiCard-root.activity.workout";
const TP_FALLBACK_WORKOUT_CARD_WITHIN_DAY_SELECTOR = ".workoutDiv";

function readTextFileSyncSafe(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function loadDotEnvFile(dotEnvPath: string): void {
  if (!existsSync(dotEnvPath)) {
    return;
  }

  const content = readTextFileSyncSafe(dotEnvPath);
  if (content === null) {
    return;
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function loadLocalEnv(): void {
  const repoRoot = path.resolve(toolRoot, "..", "..");
  const envPaths = [
    path.join(repoRoot, ".env.local"),
    path.join(repoRoot, ".env"),
    path.join(toolRoot, ".env"),
  ];

  for (const envPath of envPaths) {
    loadDotEnvFile(envPath);
  }
}

function getRequiredEnv(name: "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}. Set it in .env.local, .env, or tools/trainingpeaks-export/.env.`);
  }

  return value;
}

function getOptionalEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function isTruthyEnvFlag(name: string): boolean {
  const value = getOptionalEnv(name);
  return value ? /^(1|true|yes|on)$/i.test(value) : false;
}

function getSupabase() {
  return createClient(getRequiredEnv("SUPABASE_URL"), getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function getRunnerId(): string {
  const hostname = process.env.HOSTNAME?.trim() || process.env.COMPUTERNAME?.trim() || "local-mac";
  return `tp-actions-once:${hostname}`;
}

function toShortErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (normalized.length <= 500) {
    return normalized;
  }
  return `${normalized.slice(0, 497)}...`;
}

function getTargetSummary(parsedPayload: unknown): string {
  if (!parsedPayload || typeof parsedPayload !== "object") {
    return "target: unknown";
  }

  const payload = parsedPayload as {
    target?: { kind?: string; value?: string; sourceText?: string };
  };
  const target = payload.target;
  if (!target) {
    return "target: unknown";
  }

  if (target.kind === "relative_day") {
    if (target.value === "tomorrow") {
      return "move_workout на завтра";
    }
    if (target.value === "day_after_tomorrow") {
      return "move_workout на послезавтра";
    }
  }

  if (target.kind === "weekday") {
    const map: Record<string, string> = {
      monday: "понедельник",
      tuesday: "вторник",
      wednesday: "среда",
      thursday: "четверг",
      friday: "пятница",
      saturday: "суббота",
      sunday: "воскресенье",
    };
    if (target.value && map[target.value]) {
      return `move_workout на ${map[target.value]}`;
    }
  }

  return "target: unknown";
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return Number(value.toFixed(2));
}

function parseMoveWorkoutPayload(parsedPayload: unknown): ParsedMoveWorkoutPayload | null {
  if (!parsedPayload || typeof parsedPayload !== "object") {
    return null;
  }

  const payload = parsedPayload as ParsedMoveWorkoutPayload;
  if (payload.actionType !== "move_workout" || !payload.target) {
    return null;
  }
  if (payload.target.kind !== "relative_day" && payload.target.kind !== "weekday") {
    return null;
  }
  return payload;
}

function resolveTargetDateFromPayload(target: TrainingPeaksMoveWorkoutTarget): { targetDate: string; warnings: string[] } {
  const warnings: string[] = [];
  const now = new Date();

  if (target.kind === "relative_day") {
    if (target.value === "tomorrow") {
      return { targetDate: toIsoDate(addDays(now, 1)), warnings };
    }
    return { targetDate: toIsoDate(addDays(now, 2)), warnings };
  }

  const weekdayMap: Record<TrainingPeaksMoveWorkoutTarget["value"], number> = {
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
    sunday: 0,
    tomorrow: 0,
    day_after_tomorrow: 0,
  };

  const nowWeekday = now.getUTCDay();
  const targetWeekday = weekdayMap[target.value];
  if (targetWeekday === undefined) {
    warnings.push("target weekday is unknown");
    return { targetDate: toIsoDate(now), warnings };
  }

  let delta = (targetWeekday - nowWeekday + 7) % 7;
  if (delta === 0) {
    delta = 7;
  }
  return { targetDate: toIsoDate(addDays(now, delta)), warnings };
}

function dateDistanceDays(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00.000Z`).getTime();
  const to = new Date(`${toIso}T00:00:00.000Z`).getTime();
  const diffMs = Math.abs(to - from);
  return Math.round(diffMs / (24 * 60 * 60 * 1000));
}

function normalizeDateCandidate(raw: string): string | null {
  const direct = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (direct) {
    return `${direct[1]}-${direct[2]}-${direct[3]}`;
  }

  const slash = raw.trim().match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{4}))?$/);
  if (slash) {
    const now = new Date();
    const year = slash[3] ? Number(slash[3]) : now.getUTCFullYear();
    const month = Number(slash[2]);
    const day = Number(slash[1]);
    if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
      return null;
    }
    const mm = String(month).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    return `${String(year).padStart(4, "0")}-${mm}-${dd}`;
  }

  return null;
}

function extractExplicitSourceDate(input: { rawText: string; parsedPayload: unknown }): string | null {
  const payload = input.parsedPayload && typeof input.parsedPayload === "object"
    ? (input.parsedPayload as ParsedMoveWorkoutPayload)
    : null;
  const payloadDateCandidates = [
    payload?.sourceDate,
    payload?.source_date,
    (payload?.source && typeof payload.source === "object" && "date" in payload.source
      ? payload.source.date
      : null) ?? null,
    (payload?.source && typeof payload.source === "object" && "isoDate" in payload.source
      ? payload.source.isoDate
      : null) ?? null,
  ];
  for (const candidate of payloadDateCandidates) {
    if (!candidate) {
      continue;
    }
    const normalized = normalizeDateCandidate(candidate);
    if (normalized) {
      return normalized;
    }
  }

  const rawText = input.rawText.toLowerCase();
  const explicitSourceRegex =
    /\b(?:с|со|from)\s+(\d{4}-\d{2}-\d{2}|\d{1,2}[./-]\d{1,2}(?:[./-]\d{4})?)/i;
  const sourceMatch = rawText.match(explicitSourceRegex);
  if (sourceMatch?.[1]) {
    const normalized = normalizeDateCandidate(sourceMatch[1]);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function formatDryRunReasonForCoach(reason: string): string {
  if (reason === "multiple candidates on selected source date") {
    return "Найдено несколько тренировок на исходную дату";
  }
  if (reason === "source date could not be resolved safely") {
    return "Нужна исходная дата";
  }
  if (reason === "no planned candidate on inferred source date") {
    return "Нужна конкретная тренировка";
  }
  return reason;
}

function candidateLooksCompleted(rawTextSnippet: string): boolean {
  const text = rawTextSnippet.toLowerCase();
  return /\b(done|completed|выполнено|завершено|finished|отчет|report|результат)\b/i.test(text);
}

function candidateLooksLikeWorkoutCard(candidate: RawWorkoutCandidate): boolean {
  const text = candidate.rawTextSnippet.toLowerCase();
  if (
    /\b(sidebar|navigation|menu|summary|итого|сводка|навигац|календарь|calendar|week total|month total)\b/i.test(
      text
    )
  ) {
    return false;
  }
  return Boolean(candidate.selectorHint?.includes(".activity.workout") || candidate.selectorHint?.includes(".workoutDiv"));
}

function isTargetTomorrow(action: TrainingPeaksActionRow): boolean {
  const parsed = parseMoveWorkoutPayload(action.parsed_payload);
  return parsed?.target?.kind === "relative_day" && parsed.target.value === "tomorrow";
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function toTextSnippet(value: string, maxLength = 240): string {
  return normalizeWhitespace(value).slice(0, maxLength);
}

function toIsoFromDateParts(year: number, month: number, day: number): string | null {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    return null;
  }
  return dt.toISOString().slice(0, 10);
}

function parseDateFromCalendarText(raw: string, defaultYear?: number): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const direct = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (direct) {
    return toIsoFromDateParts(Number(direct[1]), Number(direct[2]), Number(direct[3]));
  }
  const slash = trimmed.match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{4}))?$/);
  if (slash) {
    const year = slash[3] ? Number(slash[3]) : defaultYear;
    if (!year) {
      return null;
    }
    return toIsoFromDateParts(year, Number(slash[2]), Number(slash[1]));
  }
  return null;
}

function parseDateFromCalendarAttr(value: string | null | undefined, defaultYear?: number): string | null {
  if (!value) {
    return null;
  }
  const iso = value.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  if (iso) {
    return parseDateFromCalendarText(iso);
  }
  const slash = value.match(/\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{4})?\b/)?.[0];
  if (slash) {
    return parseDateFromCalendarText(slash, defaultYear);
  }
  return null;
}

async function getInnerTextSafe(
  locator: import("playwright").Locator,
  timeout = 700
): Promise<string | null> {
  try {
    const value = await locator.innerText({ timeout });
    const normalized = normalizeWhitespace(value);
    return normalized || null;
  } catch {
    return null;
  }
}

async function getAttributeSafe(
  locator: import("playwright").Locator,
  name: string,
  timeout = 700
): Promise<string | null> {
  try {
    const value = await locator.getAttribute(name, { timeout });
    if (value === null) {
      return null;
    }
    const normalized = normalizeWhitespace(value);
    return normalized || null;
  } catch {
    return null;
  }
}

async function collectLocatorInnerTextSnippets(
  locator: import("playwright").Locator,
  limit: number,
  maxLength = 180
): Promise<string[]> {
  const count = await locator.count();
  const snippets: string[] = [];
  for (let index = 0; index < count && snippets.length < limit; index += 1) {
    const text = await getInnerTextSafe(locator.nth(index));
    if (!text) {
      continue;
    }
    snippets.push(toTextSnippet(text, maxLength));
  }
  return snippets;
}

async function inferCalendarMonthYear(
  calendarRoot: import("playwright").Locator
): Promise<{ year: number | null; month: number | null; reason: string }> {
  const now = new Date();
  const monthMap: Record<string, number> = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
    январь: 1,
    января: 1,
    февраль: 2,
    февраля: 2,
    март: 3,
    марта: 3,
    апрель: 4,
    апреля: 4,
    май: 5,
    мая: 5,
    июнь: 6,
    июня: 6,
    июль: 7,
    июля: 7,
    август: 8,
    августа: 8,
    сентябрь: 9,
    сентября: 9,
    октябрь: 10,
    октября: 10,
    ноябрь: 11,
    ноября: 11,
    декабрь: 12,
    декабря: 12,
  };

  const candidateTexts = [
    await getAttributeSafe(calendarRoot, "aria-label"),
    await getAttributeSafe(calendarRoot, "title"),
    await getAttributeSafe(calendarRoot, "data-date"),
    ...(await calendarRoot
      .locator("h1, h2, h3, h4, [class*='month' i], [data-test*='month' i]")
      .allInnerTexts()
      .catch(() => []))
      .map((value) => normalizeWhitespace(value))
      .filter(Boolean)
      .slice(0, 20),
  ];

  for (const text of candidateTexts) {
    if (!text) {
      continue;
    }
    const lower = text.toLowerCase();
    for (const [monthName, monthNumber] of Object.entries(monthMap)) {
      if (!lower.includes(monthName)) {
        continue;
      }
      const yearMatch = lower.match(/\b(20\d{2})\b/);
      return {
        year: yearMatch ? Number(yearMatch[1]) : now.getUTCFullYear(),
        month: monthNumber,
        reason: yearMatch
          ? "calendar month/year resolved from visible calendar header"
          : "calendar month resolved from visible header; year defaulted to current year",
      };
    }
  }

  return {
    year: null,
    month: null,
    reason: "calendar month/year unresolved from visible calendar context",
  };
}

function detectWorkoutTypeFromText(text: string): string | null {
  const lower = text.toLowerCase();
  if (lower.includes("run") || lower.includes("бег")) {
    return "run";
  }
  if (lower.includes("bike") || lower.includes("ride") || lower.includes("вел")) {
    return "bike";
  }
  if (lower.includes("swim") || lower.includes("плав")) {
    return "swim";
  }
  if (lower.includes("strength")) {
    return "strength";
  }
  return null;
}

function extractTitleFromCardText(text: string): string | null {
  const firstPart = text
    .split(/[,|]/)[0]
    ?.trim()
    .replace(/\s+/g, " ");
  return firstPart ? firstPart.slice(0, 120) : null;
}

function extractDayNumberCandidate(value: string): number | null {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  const lines = normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 5);

  for (const line of lines) {
    const strictStart = line.match(/^([12]?\d|3[01])\b/);
    if (strictStart) {
      return Number(strictStart[1]);
    }
    if (line.length <= 12) {
      const compact = line.match(/\b([12]?\d|3[01])\b/);
      if (compact) {
        return Number(compact[1]);
      }
    }
  }

  const startMatch = normalized.match(/^\D*([12]?\d|3[01])\b/);
  return startMatch ? Number(startMatch[1]) : null;
}

function parseTrainingPeaksAthleteId(urlRaw: string | null): string | null {
  if (!urlRaw) {
    return null;
  }

  try {
    const url = new URL(urlRaw);
    const queryKeys = ["athleteid", "athlete_id", "athlete", "id"];
    for (const key of queryKeys) {
      const value = url.searchParams.get(key);
      if (value && /^[a-z0-9-]{4,}$/i.test(value.trim())) {
        return value.trim().toLowerCase();
      }
    }

    const pathMatch = url.pathname.match(/\/(?:athlete|athletes)\/([a-z0-9-]{4,})/i);
    if (pathMatch?.[1]) {
      return pathMatch[1].toLowerCase();
    }

    const hashMatch = url.hash.match(/\/(?:athlete|athletes)\/([a-z0-9-]{4,})/i);
    if (hashMatch?.[1]) {
      return hashMatch[1].toLowerCase();
    }
  } catch {
    const fallbackMatch = urlRaw.match(/(?:athlete|athletes)[=/]([a-z0-9-]{4,})/i);
    if (fallbackMatch?.[1]) {
      return fallbackMatch[1].toLowerCase();
    }
  }

  return null;
}

function normalizeName(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const normalized = value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || null;
}

function namesLikelyMatch(expected: string | null, visible: string | null): boolean {
  const left = normalizeName(expected);
  const right = normalizeName(visible);
  if (!left || !right) {
    return false;
  }
  if (left === right) {
    return true;
  }
  if (left.includes(right) || right.includes(left)) {
    return true;
  }
  const leftParts = new Set(left.split(" ").filter(Boolean));
  const rightParts = new Set(right.split(" ").filter(Boolean));
  if (leftParts.size === 0 || rightParts.size === 0) {
    return false;
  }
  let overlap = 0;
  for (const token of leftParts) {
    if (rightParts.has(token)) {
      overlap += 1;
    }
  }
  const ratio = overlap / Math.max(leftParts.size, rightParts.size);
  return ratio >= 0.5;
}

function parseDurationSeconds(raw: string): number | null {
  const text = raw.trim().toLowerCase();
  if (!text) {
    return null;
  }

  const hhmmss = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (hhmmss) {
    const hours = Number(hhmmss[1]);
    const minutes = Number(hhmmss[2]);
    const seconds = Number(hhmmss[3] ?? "0");
    return hours * 3600 + minutes * 60 + seconds;
  }

  const hourMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(h|hr|hour|hours|ч)\b/);
  const minMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(m|min|mins|minute|minutes|мин)\b/);
  const secMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(s|sec|secs|second|seconds|сек)\b/);
  if (hourMatch || minMatch || secMatch) {
    const hours = Number((hourMatch?.[1] ?? "0").replace(",", "."));
    const minutes = Number((minMatch?.[1] ?? "0").replace(",", "."));
    const seconds = Number((secMatch?.[1] ?? "0").replace(",", "."));
    return Math.round(hours * 3600 + minutes * 60 + seconds);
  }

  return null;
}

function parseDistance(raw: string): number | null {
  const text = raw.trim().toLowerCase();
  if (!text) {
    return null;
  }
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(km|км|mi|mile|miles|м|meter|meters)\b/);
  if (!match) {
    return null;
  }
  const value = Number(match[1].replace(",", "."));
  if (!Number.isFinite(value)) {
    return null;
  }
  const unit = match[2];
  if (unit === "mi" || unit === "mile" || unit === "miles") {
    return Number((value * 1.60934).toFixed(2));
  }
  if (unit === "m" || unit === "м" || unit === "meter" || unit === "meters") {
    return Number((value / 1000).toFixed(3));
  }
  return value;
}

function buildCandidateFingerprint(input: {
  studentId: string | null;
  dateIso: string | null;
  title: string | null;
  type: string | null;
  startTimeLocal: string | null;
  plannedDurationSec: number | null;
  plannedDistance: number | null;
}): string {
  const stable = [
    input.studentId ?? "na",
    input.dateIso ?? "na",
    (input.title ?? "untitled").trim().toLowerCase(),
    (input.type ?? "na").trim().toLowerCase(),
    input.startTimeLocal ?? "na",
    input.plannedDurationSec === null ? "na" : String(input.plannedDurationSec),
    input.plannedDistance === null ? "na" : String(input.plannedDistance),
  ].join("|");
  return createHash("sha1").update(stable).digest("hex");
}

function resolveDryRunNotificationChatId(action: TrainingPeaksActionRow): string | null {
  const chatId = action.coach_chat_id ?? action.decided_by_chat_id;
  if (!chatId) {
    console.warn(
      `TrainingPeaks dry-run: skipping coach Telegram notification — no chat id (coach_chat_id and decided_by_chat_id both null) for action ${action.id}, status=${action.status}`
    );
  }
  return chatId;
}

async function sendTelegramText(
  chatId: string,
  text: string,
  options?: {
    inlineKeyboardRows?: Array<Array<{ text: string; callback_data: string }>>;
  }
): Promise<{ messageId: string | null }> {
  const token = getOptionalEnv("TELEGRAM_BOT_TOKEN");
  if (!token) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN for Telegram delivery.");
  }

  const replyMarkup =
    options?.inlineKeyboardRows && options.inlineKeyboardRows.length > 0
      ? {
          inline_keyboard: options.inlineKeyboardRows,
        }
      : undefined;

  const response = await fetch(`${TELEGRAM_API_BASE_URL}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Telegram sendMessage failed (${response.status}): ${errorText}`);
  }

  const payload = (await response.json().catch(() => null)) as
    | {
        ok?: boolean;
        result?: { message_id?: number };
      }
    | null;
  const messageId = payload?.result?.message_id;
  return {
    messageId: typeof messageId === "number" ? String(messageId) : null,
  };
}

async function notifyCoachDryRunResult(input: {
  chatId: string | null;
  action: TrainingPeaksActionRow;
  studentName: string;
  statusText: string;
  note: string;
  dryRunEvaluation?: DryRunEvaluation | null;
  errorText?: string | null;
}): Promise<void> {
  if (!input.chatId) {
    return;
  }

  const lines = [
    "TrainingPeaks dry-run",
    `Action ID: ${input.action.id}`,
    `Ученик: ${input.studentName}`,
    `Raw text: ${input.action.raw_text}`,
    `Target: ${getTargetSummary(input.action.parsed_payload)}`,
    `Статус: ${input.statusText}`,
  ];

  if (input.dryRunEvaluation) {
    const evaluation = input.dryRunEvaluation;
    lines.push(`dryRunResult: ${evaluation.dryRunResult}`);
    lines.push(`identity: ${evaluation.identityCheck.matchedBy}`);
    lines.push(`DB student name: ${evaluation.identityCheck.expectedTrainingPeaksName ?? "unknown"}`);
    lines.push(`TP visible athlete: ${evaluation.identityCheck.visibleTrainingPeaksName ?? "unknown"}`);
    lines.push(`resolved target date: ${evaluation.resolvedDates.targetDate ?? "unknown"}`);
    lines.push(`resolved source date: ${evaluation.resolvedDates.sourceDate ?? "unknown"}`);
    lines.push(`candidate: ${formatCandidateLine(evaluation.candidate)}`);
    if (!evaluation.canExecute) {
      const reason =
        evaluation.canExecuteReasons.map(formatDryRunReasonForCoach).join("; ") || "небезопасно выполнить";
      lines.push(`reason: ${reason}`);
    }
    lines.push(`confidence: ${evaluation.confidence.toFixed(2)}`);
    lines.push(`canExecute: ${evaluation.canExecute ? "yes" : "no"}`);
  }

  if (input.errorText) {
    lines.push(`Ошибка: ${input.errorText}`);
  }
  lines.push(input.note);
  lines.push(
    "Это только подтверждение выполнения. TrainingPeaks изменится только после запуска локального runner на следующем этапе."
  );

  let inlineKeyboardRows: Array<Array<{ text: string; callback_data: string }>> = [];
  if (input.dryRunEvaluation?.dryRunResult === "candidate_found") {
    const actionId = input.action.id;
    const cancelButton = {
      text: "❌ Отменить",
      callback_data: `${TP_CALLBACK_ACTION_CANCEL_PREFIX}${actionId}`,
    };
    if (input.dryRunEvaluation.canExecute) {
      inlineKeyboardRows = [
        [
          {
            text: "✅ Выполнить перенос",
            callback_data: `${TP_CALLBACK_ACTION_EXECUTE_PREFIX}${actionId}`,
          },
        ],
        [cancelButton],
      ];
    } else {
      inlineKeyboardRows = [[cancelButton]];
    }
  }

  try {
    await sendTelegramText(input.chatId, lines.join("\n"), { inlineKeyboardRows });
  } catch (error) {
    console.warn(`Telegram action dry-run summary warning: ${toShortErrorMessage(error)}`);
  }
}

async function claimOneApprovedActionForDryRun(runnerId: string): Promise<ClaimedAction | null> {
  const supabase = getSupabase();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data: candidate, error: selectError } = await supabase
      .from("trainingpeaks_actions")
      .select("*")
      .eq("action_type", "move_workout")
      .eq("status", "approved")
      .eq("execution_status", "not_started")
      .order("approved_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (selectError) {
      throw new Error(`Failed to select approved action for dry-run: ${selectError.message}`);
    }

    if (!candidate) {
      return null;
    }

    const { data: claimed, error: claimError } = await supabase
      .from("trainingpeaks_actions")
      .update({
        execution_status: "dry_run_running",
        execution_mode: "dry_run",
        claimed_by: runnerId,
        claimed_at: new Date().toISOString(),
      })
      .eq("id", candidate.id)
      .eq("status", "approved")
      .eq("execution_status", "not_started")
      .select("*")
      .maybeSingle();

    if (claimError) {
      throw new Error(`Failed to claim action ${candidate.id} for dry-run: ${claimError.message}`);
    }

    if (!claimed) {
      continue;
    }

    const action = claimed as TrainingPeaksActionRow;
    let student: TrainingPeaksStudentRow | null = null;
    if (action.student_id) {
      const { data: studentData, error: studentError } = await supabase
        .from("trainingpeaks_students")
        .select("id, student_id, student_name, telegram_chat_id, trainingpeaks_athlete_url")
        .eq("id", action.student_id)
        .maybeSingle();
      if (studentError) {
        throw new Error(`Failed to fetch student for action ${action.id}: ${studentError.message}`);
      }
      student = (studentData as TrainingPeaksStudentRow | null) ?? null;
    }

    return { action, student };
  }

  return null;
}

async function createActionRun(actionId: string, runnerId: string): Promise<TrainingPeaksActionRunRow> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("trainingpeaks_action_runs")
    .insert({
      action_id: actionId,
      run_type: "dry_run",
      status: "running",
      dry_run: true,
      runner_id: runnerId,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create action run for ${actionId}: ${error.message}`);
  }

  return data as TrainingPeaksActionRunRow;
}

async function completeDryRun(
  actionId: string,
  runId: string,
  input: {
    logJson: unknown;
    screenshotBeforePath: string | null;
    screenshotAfterPath: string | null;
  }
): Promise<void> {
  const supabase = getSupabase();

  const { error: runError } = await supabase
    .from("trainingpeaks_action_runs")
    .update({
      status: "completed",
      finished_at: new Date().toISOString(),
      error_message: null,
      log_json: input.logJson,
      screenshot_before_path: input.screenshotBeforePath,
      screenshot_after_path: input.screenshotAfterPath,
    })
    .eq("id", runId)
    .eq("action_id", actionId)
    .eq("status", "running");
  if (runError) {
    throw new Error(`Failed to mark action run ${runId} completed: ${runError.message}`);
  }

  const { error: actionError } = await supabase
    .from("trainingpeaks_actions")
    .update({
      execution_status: "dry_run_completed",
      execution_mode: "dry_run",
      last_run_id: runId,
    })
    .eq("id", actionId);
  if (actionError) {
    throw new Error(`Failed to update action ${actionId} to dry_run_completed: ${actionError.message}`);
  }
}

async function failDryRun(
  actionId: string,
  runId: string,
  input: { errorMessage: string; logJson: unknown }
): Promise<void> {
  const supabase = getSupabase();

  const { error: runError } = await supabase
    .from("trainingpeaks_action_runs")
    .update({
      status: "failed",
      finished_at: new Date().toISOString(),
      error_message: input.errorMessage,
      log_json: input.logJson,
    })
    .eq("id", runId)
    .eq("action_id", actionId)
    .eq("status", "running");
  if (runError) {
    throw new Error(`Failed to mark action run ${runId} failed: ${runError.message}`);
  }

  const { error: actionError } = await supabase
    .from("trainingpeaks_actions")
    .update({
      execution_status: "failed",
      execution_mode: "dry_run",
      last_run_id: runId,
    })
    .eq("id", actionId);
  if (actionError) {
    throw new Error(`Failed to update action ${actionId} as failed: ${actionError.message}`);
  }
}

async function isVisible(locator: import("playwright").Locator, timeout = 700): Promise<boolean> {
  try {
    await locator.first().waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}

async function anyVisible(
  locators: import("playwright").Locator[],
  timeout = 700
): Promise<boolean> {
  for (const locator of locators) {
    if (await isVisible(locator, timeout)) {
      return true;
    }
  }
  return false;
}

async function assessTrainingPeaksPage(page: import("playwright").Page): Promise<{
  loginRequired: boolean;
  athletePageLikelyReachable: boolean;
  trainingPeaksContextLikely: boolean;
}> {
  await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});

  const [title, bodyText, currentUrl] = await Promise.all([
    page.title().catch(() => ""),
    page
      .locator("body")
      .innerText({ timeout: 3000 })
      .catch(() => ""),
    Promise.resolve(page.url()),
  ]);
  const combinedText = `${title} ${bodyText}`.replace(/\s+/g, " ").trim().toLowerCase();
  const trainingPeaksUrlDetected = currentUrl.toLowerCase().includes("trainingpeaks");

  const loginSignals = await Promise.all([
    isVisible(page.locator('input[type="password"]')),
    isVisible(page.locator('input[type="email"], input[name*="email" i], input[autocomplete="username"]')),
    anyVisible([
      page.getByRole("button", { name: /sign in|log in|login/i }),
      page.getByRole("link", { name: /sign in|log in|login/i }),
      page.getByText(/sign in|log in|login/i),
    ]),
  ]);
  const loginTextDetected = /sign in|log in|login|password|forgot password|remember me/.test(combinedText);
  if (/(login|signin|sign-in|auth)/i.test(currentUrl) || loginSignals.some(Boolean) || loginTextDetected) {
    return {
      loginRequired: true,
      athletePageLikelyReachable: false,
      trainingPeaksContextLikely: trainingPeaksUrlDetected,
    };
  }

  const shellTextDetected = /trainingpeaks|calendar|workout|athlete|account settings|export data/.test(combinedText);
  const trainingPeaksContextLikely = trainingPeaksUrlDetected || shellTextDetected;
  const athletePageLikelyReachable =
    trainingPeaksContextLikely && !/something went wrong|404|not found|unavailable|forbidden|access denied/.test(combinedText);

  return {
    loginRequired: false,
    athletePageLikelyReachable,
    trainingPeaksContextLikely,
  };
}

function scoreWorkoutCandidate(input: {
  title: string | null;
  type: string | null;
  dateIso: string | null;
  targetDate: string | null;
  distanceFromTodayDays: number | null;
}): number {
  let score = 0.35;
  if (input.title) {
    score += 0.2;
  }
  if (input.type) {
    score += 0.1;
  }
  if (input.dateIso && input.targetDate) {
    const days = dateDistanceDays(input.dateIso, input.targetDate);
    if (days === 0) {
      score += 0.3;
    } else if (days === 1) {
      score += 0.2;
    } else if (days === 2) {
      score += 0.08;
    } else {
      score -= Math.min(0.2, days * 0.03);
    }
  }
  if (input.distanceFromTodayDays !== null) {
    if (input.distanceFromTodayDays <= 3) {
      score += 0.1;
    } else if (input.distanceFromTodayDays >= 8) {
      score -= 0.1;
    }
  }
  return clampConfidence(score);
}

function emptyDomSelectorCounts(): DryRunDomDebugSelectorCounts {
  return {
    calendarRoots: 0,
    dayCells: 0,
    primaryWorkoutCards: 0,
    fallbackWorkoutDivCards: 0,
  };
}

async function captureCalendarDomSnapshot(
  page: import("playwright").Page,
  includeCardSnippets = false
): Promise<{
  selectorCounts: DryRunDomDebugSelectorCounts;
  calendarRootClass: string | null;
  cardSnippets: string[];
  error: string | null;
}> {
  try {
    const calendarRoots = page.locator(TP_CALENDAR_ROOT_SELECTOR);
    const calendarRootCount = await calendarRoots.count();
    const root = calendarRoots.first();
    const selectorCounts: DryRunDomDebugSelectorCounts = {
      calendarRoots: calendarRootCount,
      dayCells: calendarRootCount > 0 ? await root.locator(TP_DAY_CELL_SELECTOR).count() : 0,
      primaryWorkoutCards: calendarRootCount > 0 ? await root.locator(TP_PRIMARY_WORKOUT_CARD_WITHIN_DAY_SELECTOR).count() : 0,
      fallbackWorkoutDivCards: calendarRootCount > 0 ? await root.locator(TP_FALLBACK_WORKOUT_CARD_WITHIN_DAY_SELECTOR).count() : 0,
    };

    const cardSnippets: string[] = [];
    if (includeCardSnippets && calendarRootCount > 0) {
      const primarySnippets = await collectLocatorInnerTextSnippets(
        root.locator(TP_PRIMARY_WORKOUT_CARD_WITHIN_DAY_SELECTOR),
        5
      );
      const fallbackSnippets = await collectLocatorInnerTextSnippets(
        root.locator(TP_FALLBACK_WORKOUT_CARD_WITHIN_DAY_SELECTOR),
        5
      );
      for (const snippet of [...primarySnippets, ...fallbackSnippets]) {
        if (!snippet || cardSnippets.includes(snippet)) {
          continue;
        }
        cardSnippets.push(snippet);
        if (cardSnippets.length >= 5) {
          break;
        }
      }
    }

    return {
      selectorCounts,
      calendarRootClass: calendarRootCount > 0 ? await getAttributeSafe(root, "class") : null,
      cardSnippets,
      error: null,
    };
  } catch (error) {
    return {
      selectorCounts: emptyDomSelectorCounts(),
      calendarRootClass: null,
      cardSnippets: [],
      error: `calendar DOM snapshot failed: ${toShortErrorMessage(error)}`,
    };
  }
}

async function extractWorkoutCandidatesFromPage(
  page: import("playwright").Page,
  targetDateIso: string | null
): Promise<WorkoutExtractionResult> {
  const nowIso = toIsoDate(new Date());
  const domDebugEnabled = isTruthyEnvFlag("TP_DRY_RUN_DOM_DEBUG");
  const parseWarnings: string[] = [];
  const checkpoints: DryRunDomDebugCheckpoint[] = [];

  const recordSnapshot = async (label: string, includeCardSnippets = false) => {
    const snapshot = await captureCalendarDomSnapshot(page, includeCardSnippets);
    if (snapshot.error) {
      parseWarnings.push(snapshot.error);
    }
    checkpoints.push({
      label,
      selectorCounts: snapshot.selectorCounts,
    });
    return snapshot;
  };

  await recordSnapshot("after goto");

  try {
    await page.locator(TP_CALENDAR_ROOT_SELECTOR).first().waitFor({ state: "attached", timeout: 5_000 });
  } catch (error) {
    parseWarnings.push(`calendar root wait failed: ${toShortErrorMessage(error)}`);
  }

  try {
    await page
      .locator(`${TP_CALENDAR_ROOT_SELECTOR} ${TP_DAY_CELL_SELECTOR}`)
      .first()
      .waitFor({ state: "attached", timeout: 5_000 });
  } catch (error) {
    parseWarnings.push(`calendar day cells wait failed: ${toShortErrorMessage(error)}`);
  }

  try {
    await Promise.any([
      page.locator(`${TP_CALENDAR_ROOT_SELECTOR} ${TP_PRIMARY_WORKOUT_CARD_WITHIN_DAY_SELECTOR}`).first().waitFor({
        state: "attached",
        timeout: 1_500,
      }),
      page.locator(`${TP_CALENDAR_ROOT_SELECTOR} ${TP_FALLBACK_WORKOUT_CARD_WITHIN_DAY_SELECTOR}`).first().waitFor({
        state: "attached",
        timeout: 1_500,
      }),
    ]);
  } catch (error) {
    parseWarnings.push(`calendar workout card wait finished without visible card roots: ${toShortErrorMessage(error)}`);
  }

  await recordSnapshot("after readiness wait");
  const beforeExtractSnapshot = await recordSnapshot("before extract", domDebugEnabled);

  type EvaluatedWorkoutCandidate = {
    rawTextSnippet: string;
    selectorHint: string | null;
    classHint: string | null;
    title: string | null;
    type: string | null;
    plannedDurationRaw: string | null;
    plannedDistanceRaw: string | null;
    startTimeLocal: string | null;
    sourceDateRaw: string | null;
    reasons: string[];
    fromFallback: boolean;
  };

  const extracted: EvaluatedWorkoutCandidate[] = [];
  let extractionError: string | null = null;

  try {
    const calendarRoot = page.locator(TP_CALENDAR_ROOT_SELECTOR).first();
    const calendarRootCount = await page.locator(TP_CALENDAR_ROOT_SELECTOR).count();
    if (calendarRootCount === 0) {
      throw new Error(`calendar root not found: ${TP_CALENDAR_ROOT_SELECTOR}`);
    }

    const calendarMonthYear = await inferCalendarMonthYear(calendarRoot);
    const dayCells = calendarRoot.locator(TP_DAY_CELL_SELECTOR);
    const dayCellCount = await dayCells.count();

    for (let dayIndex = 0; dayIndex < dayCellCount && extracted.length < 80; dayIndex += 1) {
      const dayCell = dayCells.nth(dayIndex);
      const dayTextRaw = (await dayCell.innerText().catch(() => "")) ?? "";
      const dayText = dayTextRaw.trim();
      const dayClass = await getAttributeSafe(dayCell, "class");
      const dayAttributes = {
        dataDate: await getAttributeSafe(dayCell, "data-date"),
        datetime: await getAttributeSafe(dayCell, "datetime"),
        ariaLabel: await getAttributeSafe(dayCell, "aria-label"),
        title: await getAttributeSafe(dayCell, "title"),
      };

      let resolvedSourceDate: string | null = null;
      let resolvedSourceDateReason = "source date unresolved";

      for (const [attrName, attrValue] of Object.entries(dayAttributes)) {
        const dateIso = parseDateFromCalendarAttr(attrValue);
        if (dateIso) {
          resolvedSourceDate = dateIso;
          resolvedSourceDateReason = `source date from day cell ${attrName}`;
          break;
        }
      }

      if (!resolvedSourceDate) {
        const descendantDateLocators = dayCell.locator(
          "[data-date],[datetime],[aria-label],[title],[class*='day' i],[class*='date' i],header,time"
        );
        const descendantCount = await descendantDateLocators.count();
        for (let descendantIndex = 0; descendantIndex < descendantCount; descendantIndex += 1) {
          const descendant = descendantDateLocators.nth(descendantIndex);
          for (const attrName of ["data-date", "datetime", "aria-label", "title"] as const) {
            const attrValue = await getAttributeSafe(descendant, attrName);
            const dateIso = parseDateFromCalendarAttr(attrValue);
            if (dateIso) {
              resolvedSourceDate = dateIso;
              resolvedSourceDateReason = `source date from day cell descendant ${attrName}`;
              break;
            }
          }
          if (resolvedSourceDate) {
            break;
          }
        }
      }

      const primaryCards = dayCell.locator(TP_PRIMARY_WORKOUT_CARD_WITHIN_DAY_SELECTOR);
      const fallbackCards = dayCell.locator(TP_FALLBACK_WORKOUT_CARD_WITHIN_DAY_SELECTOR);
      const primaryCount = await primaryCards.count();
      const fallbackCount = await fallbackCards.count();

      const dayCardTexts: string[] = [];
      for (let cardIndex = 0; cardIndex < primaryCount; cardIndex += 1) {
        const cardText = await getInnerTextSafe(primaryCards.nth(cardIndex));
        if (cardText) {
          dayCardTexts.push(cardText);
        }
      }
      for (let cardIndex = 0; cardIndex < fallbackCount; cardIndex += 1) {
        const cardText = await getInnerTextSafe(fallbackCards.nth(cardIndex));
        if (cardText) {
          dayCardTexts.push(cardText);
        }
      }

      if (!resolvedSourceDate && calendarMonthYear.month && calendarMonthYear.year) {
        let dayContextText = dayText;
        for (const cardText of dayCardTexts) {
          if (!cardText) {
            continue;
          }
          dayContextText = dayContextText.replace(cardText, " ");
        }
        const derivedDayNumber = extractDayNumberCandidate(dayContextText);
        if (derivedDayNumber !== null) {
          const derivedDate = toIsoFromDateParts(calendarMonthYear.year, calendarMonthYear.month, derivedDayNumber);
          if (derivedDate) {
            resolvedSourceDate = derivedDate;
            resolvedSourceDateReason = "source date derived from day cell number and visible calendar month/year";
          }
        }
      }

      if (!resolvedSourceDate && !calendarMonthYear.month) {
        resolvedSourceDateReason = calendarMonthYear.reason;
      }

      const buildCandidate = async (
        card: import("playwright").Locator,
        selectorHint: string,
        fromFallback: boolean
      ): Promise<EvaluatedWorkoutCandidate | null> => {
        const rawText = await getInnerTextSafe(card);
        if (!rawText) {
          return null;
        }
        const text = toTextSnippet(rawText);
        if (!text) {
          return null;
        }
        const title =
          (await getInnerTextSafe(card.locator("h1, h2, h3, strong, [class*='title' i]").first())) ??
          extractTitleFromCardText(text);
        const classHint = await getAttributeSafe(card, "class");
        const plannedDurationRaw =
          text.match(
            /\b(?:\d{1,2}:\d{2}(?::\d{2})?|\d+(?:[.,]\d+)?\s*(?:h|hr|hour|hours|ч|min|mins|minute|minutes|мин|sec|secs|second|seconds|сек))\b/i
          )?.[0] ?? null;
        const plannedDistanceRaw =
          text.match(/\b\d+(?:[.,]\d+)?\s*(?:km|км|mi|mile|miles|m|м|meter|meters)\b/i)?.[0] ?? null;
        const startTimeLocal = text.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/)?.[0] ?? null;

        return {
          rawTextSnippet: text,
          selectorHint,
          classHint,
          title,
          type: detectWorkoutTypeFromText(text),
          plannedDurationRaw,
          plannedDistanceRaw,
          startTimeLocal,
          sourceDateRaw: resolvedSourceDate,
          reasons: [
            resolvedSourceDateReason,
            fromFallback ? "candidate from .workoutDiv fallback card root" : "candidate from primary calendar card root",
            dayClass ? `day class: ${dayClass}` : "day class unavailable",
          ],
          fromFallback,
        };
      };

      for (let cardIndex = 0; cardIndex < primaryCount && extracted.length < 80; cardIndex += 1) {
        const candidate = await buildCandidate(
          primaryCards.nth(cardIndex),
          TP_PRIMARY_WORKOUT_CARD_SELECTOR,
          false
        );
        if (candidate) {
          extracted.push(candidate);
        }
      }

      for (let cardIndex = 0; cardIndex < fallbackCount && extracted.length < 80; cardIndex += 1) {
        const candidate = await buildCandidate(
          fallbackCards.nth(cardIndex),
          TP_FALLBACK_WORKOUT_CARD_SELECTOR,
          true
        );
        if (candidate) {
          extracted.push(candidate);
        }
      }
    }
  } catch (error) {
    extractionError = `calendar extraction failed: ${toShortErrorMessage(error)}`;
    parseWarnings.push(extractionError);
  }

  const seen = new Set<string>();
  const candidates = extracted
    .map((candidate) => {
      const dateIso = candidate.sourceDateRaw ? normalizeDateCandidate(candidate.sourceDateRaw) : null;
      const distanceFromTodayDays = dateIso ? dateDistanceDays(nowIso, dateIso) : null;
      let rawScore = scoreWorkoutCandidate({
        title: candidate.title,
        type: candidate.type,
        dateIso,
        targetDate: targetDateIso,
        distanceFromTodayDays,
      });
      if (candidate.fromFallback) {
        rawScore = clampConfidence(rawScore - 0.2);
      }
      if (!dateIso) {
        rawScore = clampConfidence(rawScore - 0.18);
      }
      return {
        rawTextSnippet: candidate.rawTextSnippet,
        selectorHint: candidate.selectorHint,
        classHint: candidate.classHint,
        title: candidate.title,
        type: candidate.type,
        plannedDurationSec: candidate.plannedDurationRaw ? parseDurationSeconds(candidate.plannedDurationRaw) : null,
        plannedDistance: candidate.plannedDistanceRaw ? parseDistance(candidate.plannedDistanceRaw) : null,
        startTimeLocal: candidate.startTimeLocal,
        dateIso,
        reasons: candidate.reasons,
        fromFallback: candidate.fromFallback,
        rawScore,
      } satisfies RawWorkoutCandidate;
    })
    .filter((candidate) => {
      if (!targetDateIso || !candidate.dateIso) {
        return true;
      }
      return dateDistanceDays(candidate.dateIso, targetDateIso) <= 14;
    })
    .filter((candidate) => {
      const key = `${candidate.title ?? "na"}|${candidate.type ?? "na"}|${candidate.dateIso ?? "na"}|${candidate.startTimeLocal ?? "na"}|${candidate.rawTextSnippet}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 80)
    .sort((left, right) => right.rawScore - left.rawScore);

  return {
    candidates,
    domDebug:
      domDebugEnabled || Boolean(extractionError)
        ? {
            enabled: domDebugEnabled,
            calendarRootClass: beforeExtractSnapshot.calendarRootClass,
            selectorCounts: beforeExtractSnapshot.selectorCounts,
            checkpoints,
            cardSnippets: beforeExtractSnapshot.cardSnippets,
            extractionError,
          }
        : null,
    parseWarnings,
    extractionError,
  };
}

async function extractVisibleTrainingPeaksAthleteName(page: import("playwright").Page): Promise<string | null> {
  const selectors = [
    "[data-test*='athlete' i]",
    "[data-testid*='athlete' i]",
    "[class*='athlete' i]",
    "header h1",
    "header h2",
    "main h1",
    "main h2",
    "[role='combobox']",
    "select",
  ];
  for (const selector of selectors) {
    const value = await page
      .locator(selector)
      .first()
      .innerText({ timeout: 400 })
      .catch(() => null);
    if (!value) {
      continue;
    }
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized || normalized.length > 120) {
      continue;
    }
    if (/calendar|workout|trainingpeaks|settings|home/i.test(normalized)) {
      continue;
    }
    return normalized;
  }
  return null;
}

function buildIdentityCheck(input: {
  student: TrainingPeaksStudentRow;
  expectedUrl: string;
  currentUrl: string;
  visibleTrainingPeaksName: string | null;
}): DryRunIdentityCheck {
  const warnings: string[] = [];
  const expectedAthleteId = parseTrainingPeaksAthleteId(input.expectedUrl);
  const currentAthleteId = parseTrainingPeaksAthleteId(input.currentUrl);
  const expectedTrainingPeaksName = input.student.student_name ?? null;
  const visibleTrainingPeaksName = input.visibleTrainingPeaksName ?? null;

  let matchedBy: IdentityMatchType = "inconclusive";
  if (expectedAthleteId && currentAthleteId) {
    if (expectedAthleteId === currentAthleteId) {
      matchedBy = "athlete_id";
    } else {
      matchedBy = "mismatch";
      warnings.push("athlete context mismatch: athlete id");
    }
  } else if (expectedTrainingPeaksName && visibleTrainingPeaksName) {
    if (namesLikelyMatch(expectedTrainingPeaksName, visibleTrainingPeaksName)) {
      matchedBy = "trainingpeaks_name";
    } else {
      matchedBy = "mismatch";
      warnings.push("athlete context mismatch: TrainingPeaks name");
    }
  }

  return {
    telegramUsername: null,
    telegramChatId: input.student.telegram_chat_id ?? null,
    expectedTrainingPeaksName,
    visibleTrainingPeaksName,
    expectedAthleteId,
    currentAthleteId,
    expectedTrainingPeaksUrl: input.expectedUrl,
    currentUrl: input.currentUrl,
    matchedBy,
    warnings,
  };
}

function evaluateDryRunOutcome(input: {
  action: TrainingPeaksActionRow;
  student: TrainingPeaksStudentRow | null;
  pageMeta: {
    loginRequired: boolean;
    athletePageLikelyReachable: boolean;
    trainingPeaksContextLikely: boolean;
  };
  candidates: RawWorkoutCandidate[];
  extraction: WorkoutExtractionResult;
  identityCheck: DryRunIdentityCheck;
}): DryRunEvaluation {
  const parseWarnings: string[] = [];
  const payload = parseMoveWorkoutPayload(input.action.parsed_payload);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  let targetDate: string | null = null;
  let sourceDate: string | null = null;
  let selectedSourceDatePolicy = "unresolved";
  let selectedSourceDate: string | null = null;

  if (!payload?.target) {
    parseWarnings.push("parsed_payload.target is missing or invalid");
  } else {
    const resolved = resolveTargetDateFromPayload(payload.target);
    targetDate = resolved.targetDate;
    parseWarnings.push(...resolved.warnings);
  }

  const explicitSourceDate = extractExplicitSourceDate({
    rawText: input.action.raw_text,
    parsedPayload: input.action.parsed_payload,
  });
  if (explicitSourceDate) {
    selectedSourceDatePolicy = "explicit_source_date";
    selectedSourceDate = explicitSourceDate;
  }

  const diagnostics: DryRunDiagnostics = {
    loginRequired: input.pageMeta.loginRequired,
    athleteReachable: input.pageMeta.athletePageLikelyReachable,
    trainingPeaksContextOk: input.pageMeta.trainingPeaksContextLikely,
    parseWarnings: [...parseWarnings, ...input.extraction.parseWarnings, ...input.identityCheck.warnings],
    domDebug: input.extraction.domDebug,
  };

  const canExecuteReasons: string[] = [];
  if (diagnostics.loginRequired) {
    canExecuteReasons.push("login required");
  }
  if (!diagnostics.athleteReachable) {
    canExecuteReasons.push("athlete page unreachable");
  }
  if (!diagnostics.trainingPeaksContextOk) {
    canExecuteReasons.push("trainingpeaks context not confirmed");
  }
  if (input.identityCheck.matchedBy === "mismatch") {
    canExecuteReasons.push(...input.identityCheck.warnings);
  }

  if (canExecuteReasons.length > 0) {
    return {
      dryRunResult: "failed",
      resolvedDates: { sourceDate: null, targetDate, timezone },
      candidate: null,
      candidateAlternativesCount: input.candidates.length,
      confidence: 0,
      canExecute: false,
      canExecuteReasons,
      diagnostics,
      identityCheck: input.identityCheck,
      debugCandidatesTopN: input.candidates.slice(0, 10).map((candidate) => ({
        rawTextSnippet: candidate.rawTextSnippet,
        selectorHint: candidate.selectorHint,
        classHint: candidate.classHint,
        title: candidate.title,
        type: candidate.type,
        plannedDurationSec: candidate.plannedDurationSec,
        plannedDistance: candidate.plannedDistance,
        startTimeLocal: candidate.startTimeLocal,
        sourceDate: candidate.dateIso,
        score: candidate.rawScore,
        reasons: candidate.reasons,
      })),
      selectedSourceDatePolicy,
      selectedSourceDate,
      selectedSourceDateCandidateCount: 0,
      globalCandidateCount: input.candidates.length,
      sourceDateBucketCounts: {},
      rankingDebug: {
        strictGlobalCount: 0,
        selectedSourceDatePolicy,
        selectedSourceDate,
        selectedSourceDateCandidateCount: 0,
        globalCandidateCount: input.candidates.length,
        sourceDateBucketCounts: {},
      },
    };
  }

  if (input.extraction.extractionError) {
    return {
      dryRunResult: "failed",
      resolvedDates: { sourceDate: null, targetDate, timezone },
      candidate: null,
      candidateAlternativesCount: 0,
      confidence: 0,
      canExecute: false,
      canExecuteReasons: ["Не удалось прочитать карточки тренировок из календаря"],
      diagnostics,
      identityCheck: input.identityCheck,
      debugCandidatesTopN: [],
      selectedSourceDatePolicy,
      selectedSourceDate,
      selectedSourceDateCandidateCount: 0,
      globalCandidateCount: 0,
      sourceDateBucketCounts: {},
      rankingDebug: {
        strictGlobalCount: 0,
        selectedSourceDatePolicy,
        selectedSourceDate,
        selectedSourceDateCandidateCount: 0,
        globalCandidateCount: 0,
        sourceDateBucketCounts: {},
      },
    };
  }

  if (input.candidates.length === 0) {
    return {
      dryRunResult: "not_found",
      resolvedDates: { sourceDate: null, targetDate, timezone },
      candidate: null,
      candidateAlternativesCount: 0,
      confidence: 0.2,
      canExecute: false,
      canExecuteReasons: ["Карточки тренировок не найдены в календаре"],
      diagnostics,
      identityCheck: input.identityCheck,
      debugCandidatesTopN: [],
      selectedSourceDatePolicy,
      selectedSourceDate,
      selectedSourceDateCandidateCount: 0,
      globalCandidateCount: 0,
      sourceDateBucketCounts: {},
      rankingDebug: {
        strictGlobalCount: 0,
        selectedSourceDatePolicy,
        selectedSourceDate,
        selectedSourceDateCandidateCount: 0,
        globalCandidateCount: 0,
        sourceDateBucketCounts: {},
      },
    };
  }

  const strictGlobalCandidates = input.candidates.filter((candidate) => {
    if (candidate.fromFallback) {
      return false;
    }
    if (!candidate.dateIso) {
      return false;
    }
    if (candidateLooksCompleted(candidate.rawTextSnippet)) {
      return false;
    }
    if (!candidateLooksLikeWorkoutCard(candidate)) {
      return false;
    }
    const fingerprint = buildCandidateFingerprint({
      studentId: input.student?.id ?? null,
      dateIso: candidate.dateIso,
      title: candidate.title,
      type: candidate.type,
      startTimeLocal: candidate.startTimeLocal,
      plannedDurationSec: candidate.plannedDurationSec,
      plannedDistance: candidate.plannedDistance,
    });
    return Boolean(fingerprint);
  });
  const globalCandidateCount = input.candidates.length;
  const sourceDateBucketCounts: Record<string, number> = {};
  for (const candidate of strictGlobalCandidates) {
    if (!candidate.dateIso) {
      continue;
    }
    sourceDateBucketCounts[candidate.dateIso] = (sourceDateBucketCounts[candidate.dateIso] ?? 0) + 1;
  }

  if (!selectedSourceDate && targetDate && isTargetTomorrow(input.action)) {
    selectedSourceDate = toIsoDate(new Date());
    selectedSourceDatePolicy = "target_tomorrow_prefers_today";
  }

  if (!selectedSourceDate && targetDate) {
    const eligibleDates = Object.keys(sourceDateBucketCounts)
      .filter((date) => date < targetDate)
      .map((date) => ({ date, delta: dateDistanceDays(date, targetDate) }))
      .filter((entry) => entry.delta >= 1 && entry.delta <= 3)
      .sort((left, right) => left.delta - right.delta);
    if (eligibleDates.length > 0) {
      selectedSourceDate = eligibleDates[0]!.date;
      selectedSourceDatePolicy = "nearest_prior_within_3_days";
    } else {
      selectedSourceDatePolicy = "no_safe_inferred_source_date";
    }
  }

  const selectedBucketCandidates = selectedSourceDate
    ? strictGlobalCandidates.filter((candidate) => candidate.dateIso === selectedSourceDate)
    : [];
  const selectedSourceDateCandidateCount = selectedBucketCandidates.length;

  if (!selectedSourceDate) {
    const reasons = ["source date could not be resolved safely", "Нужна исходная дата"];
    return {
      dryRunResult: strictGlobalCandidates.length > 0 ? "ambiguous" : "not_found",
      resolvedDates: { sourceDate: null, targetDate, timezone },
      candidate: null,
      candidateAlternativesCount: 0,
      confidence: 0,
      canExecute: false,
      canExecuteReasons: reasons,
      diagnostics,
      identityCheck: input.identityCheck,
      debugCandidatesTopN: input.candidates.slice(0, 10).map((candidate) => ({
        rawTextSnippet: candidate.rawTextSnippet,
        selectorHint: candidate.selectorHint,
        classHint: candidate.classHint,
        title: candidate.title,
        type: candidate.type,
        plannedDurationSec: candidate.plannedDurationSec,
        plannedDistance: candidate.plannedDistance,
        startTimeLocal: candidate.startTimeLocal,
        sourceDate: candidate.dateIso,
        score: candidate.rawScore,
        reasons: candidate.reasons,
      })),
      selectedSourceDatePolicy,
      selectedSourceDate,
      selectedSourceDateCandidateCount,
      globalCandidateCount,
      sourceDateBucketCounts,
      rankingDebug: {
        strictGlobalCount: strictGlobalCandidates.length,
        selectedSourceDatePolicy,
        selectedSourceDate,
        selectedSourceDateCandidateCount,
        globalCandidateCount,
        sourceDateBucketCounts,
      },
    };
  }

  if (selectedBucketCandidates.length === 0) {
    const reasons = ["no planned candidate on inferred source date", "Нужна конкретная тренировка"];
    return {
      dryRunResult: "not_found",
      resolvedDates: { sourceDate: selectedSourceDate, targetDate, timezone },
      candidate: null,
      candidateAlternativesCount: 0,
      confidence: 0,
      canExecute: false,
      canExecuteReasons: reasons,
      diagnostics,
      identityCheck: input.identityCheck,
      debugCandidatesTopN: input.candidates.slice(0, 10).map((candidate) => ({
        rawTextSnippet: candidate.rawTextSnippet,
        selectorHint: candidate.selectorHint,
        classHint: candidate.classHint,
        title: candidate.title,
        type: candidate.type,
        plannedDurationSec: candidate.plannedDurationSec,
        plannedDistance: candidate.plannedDistance,
        startTimeLocal: candidate.startTimeLocal,
        sourceDate: candidate.dateIso,
        score: candidate.rawScore,
        reasons: candidate.reasons,
      })),
      selectedSourceDatePolicy,
      selectedSourceDate,
      selectedSourceDateCandidateCount,
      globalCandidateCount,
      sourceDateBucketCounts,
      rankingDebug: {
        strictGlobalCount: strictGlobalCandidates.length,
        selectedSourceDatePolicy,
        selectedSourceDate,
        selectedSourceDateCandidateCount,
        globalCandidateCount,
        sourceDateBucketCounts,
      },
    };
  }

  const sortedBucketCandidates = [...selectedBucketCandidates].sort((left, right) => right.rawScore - left.rawScore);
  const top = sortedBucketCandidates[0]!;
  const second = sortedBucketCandidates[1] ?? null;
  const confidence = clampConfidence(
    top.rawScore - (second ? Math.min(0.18, Math.max(0, second.rawScore - 0.45)) : 0)
  );
  sourceDate = selectedSourceDate;
  const plausibleCandidates = sortedBucketCandidates.filter(
    (candidate) => candidate.rawScore >= Math.max(0.6, top.rawScore - 0.1)
  );
  const safeCandidates = sortedBucketCandidates.filter(
    (candidate) => !candidate.fromFallback && Boolean(candidate.dateIso) && candidate.rawScore >= 0.75
  );
  const alternativesCount = Math.max(0, sortedBucketCandidates.length - 1);

  const candidate: DryRunCandidate = {
    title: top.title,
    type: top.type,
    plannedDurationSec: top.plannedDurationSec,
    plannedDistance: top.plannedDistance,
    startTimeLocal: top.startTimeLocal,
    fingerprint: buildCandidateFingerprint({
      studentId: input.student?.id ?? null,
      dateIso: sourceDate,
      title: top.title,
      type: top.type,
      startTimeLocal: top.startTimeLocal,
      plannedDurationSec: top.plannedDurationSec,
      plannedDistance: top.plannedDistance,
    }),
  };

  let dryRunResult: DryRunResult = "candidate_found";
  const reasons: string[] = [];

  if (input.candidates.length > 1 && second && Math.abs(top.rawScore - second.rawScore) < 0.12) {
    dryRunResult = "ambiguous";
    reasons.push("top candidate margin too small");
  }
  if (plausibleCandidates.length > 1) {
    dryRunResult = "ambiguous";
    reasons.push("multiple candidates on selected source date");
  }
  if (!targetDate) {
    reasons.push("target date could not be resolved");
  }
  if (!sourceDate) {
    reasons.push("source date could not be resolved safely");
  }
  if (!candidate.fingerprint) {
    reasons.push("candidate fingerprint missing");
  }
  if (confidence < 0.8) {
    reasons.push("confidence below threshold 0.8");
  }
  if (safeCandidates.length !== 1) {
    reasons.push("multiple candidates on selected source date");
  }
  if (selectedSourceDatePolicy === "nearest_prior_within_3_days") {
    reasons.push("source date inferred with low confidence");
  }
  if (second && top.rawScore - second.rawScore < 0.12) {
    reasons.push("top candidate margin too small");
  }
  if (input.identityCheck.matchedBy === "mismatch") {
    reasons.push(...input.identityCheck.warnings);
  }

  const canExecute =
    dryRunResult === "candidate_found" &&
    safeCandidates.length === 1 &&
    Boolean(targetDate) &&
    Boolean(selectedSourceDate) &&
    Boolean(candidate.fingerprint) &&
    confidence >= 0.8 &&
    input.identityCheck.matchedBy !== "mismatch";

  if (!canExecute && reasons.length === 0) {
    reasons.push("safety policy conditions not met");
  }

  if (dryRunResult === "candidate_found" && !canExecute) {
    dryRunResult = sortedBucketCandidates.length > 1 ? "ambiguous" : "not_found";
  }

  return {
    dryRunResult,
    resolvedDates: {
      sourceDate: sourceDate ?? null,
      targetDate: targetDate ?? null,
      timezone,
    },
    candidate,
    candidateAlternativesCount: alternativesCount,
    confidence,
    canExecute,
    canExecuteReasons: canExecute ? [] : reasons,
    diagnostics,
    identityCheck: input.identityCheck,
    debugCandidatesTopN: input.candidates.slice(0, 10).map((candidate) => ({
      rawTextSnippet: candidate.rawTextSnippet,
      selectorHint: candidate.selectorHint,
      classHint: candidate.classHint,
      title: candidate.title,
      type: candidate.type,
      plannedDurationSec: candidate.plannedDurationSec,
      plannedDistance: candidate.plannedDistance,
      startTimeLocal: candidate.startTimeLocal,
      sourceDate: candidate.dateIso,
      score: candidate.rawScore,
      reasons: candidate.reasons,
    })),
    selectedSourceDatePolicy,
    selectedSourceDate,
    selectedSourceDateCandidateCount,
    globalCandidateCount,
    sourceDateBucketCounts,
    rankingDebug: {
      strictGlobalCount: strictGlobalCandidates.length,
      selectedSourceDatePolicy,
      selectedSourceDate,
      selectedSourceDateCandidateCount,
      globalCandidateCount,
      sourceDateBucketCounts,
    },
  };
}

function formatCandidateLine(candidate: DryRunCandidate | null): string {
  if (!candidate) {
    return "кандидат не найден";
  }
  const parts: string[] = [];
  if (candidate.title) {
    parts.push(candidate.title);
  }
  if (candidate.type) {
    parts.push(`тип=${candidate.type}`);
  }
  if (candidate.plannedDurationSec !== null) {
    parts.push(`длит=${candidate.plannedDurationSec}с`);
  }
  if (candidate.plannedDistance !== null) {
    parts.push(`дист=${candidate.plannedDistance}км`);
  }
  if (candidate.startTimeLocal) {
    parts.push(`старт=${candidate.startTimeLocal}`);
  }
  return parts.join(", ") || "кандидат без деталей";
}

async function runDryRunInspection(claimed: ClaimedAction, runId: string): Promise<DryRunArtifacts> {
  const student = claimed.student;
  if (!student) {
    throw new Error(`Student is missing for action ${claimed.action.id}.`);
  }
  if (!student.trainingpeaks_athlete_url?.trim()) {
    throw new Error(`Missing trainingpeaks_athlete_url for student ${student.student_name}.`);
  }

  await mkdir(profileDir, { recursive: true });
  const artifactDir = path.join(ACTION_ARTIFACTS_ROOT, claimed.action.id, runId);
  await mkdir(artifactDir, { recursive: true });

  const screenshotBeforePath = path.join(artifactDir, "before.png");
  const screenshotAfterPath = path.join(artifactDir, "after.png");

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: null,
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(student.trainingpeaks_athlete_url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.bringToFront();

    const pageAssessment = await assessTrainingPeaksPage(page);
    const visibleTrainingPeaksName = await extractVisibleTrainingPeaksAthleteName(page);
    const identityCheck = buildIdentityCheck({
      student,
      expectedUrl: student.trainingpeaks_athlete_url,
      currentUrl: page.url(),
      visibleTrainingPeaksName,
    });
    await page.screenshot({ path: screenshotBeforePath, fullPage: true });

    if (pageAssessment.loginRequired) {
      throw new Error("TrainingPeaks session expired or login required.");
    }
    if (!pageAssessment.trainingPeaksContextLikely) {
      throw new Error("Could not confirm TrainingPeaks context on athlete page.");
    }
    if (!pageAssessment.athletePageLikelyReachable) {
      throw new Error("Athlete page is not reachable or failed to load fully.");
    }

    const parsedPayload = parseMoveWorkoutPayload(claimed.action.parsed_payload);
    const resolvedTargetDate = parsedPayload?.target
      ? resolveTargetDateFromPayload(parsedPayload.target).targetDate
      : null;
    const extraction = await extractWorkoutCandidatesFromPage(page, resolvedTargetDate);
    const dryRunEvaluation = evaluateDryRunOutcome({
      action: claimed.action,
      student,
      pageMeta: pageAssessment,
      candidates: extraction.candidates,
      extraction,
      identityCheck,
    });

    await page.waitForTimeout(1000);
    await page.screenshot({ path: screenshotAfterPath, fullPage: true });

    return {
      screenshotBeforePath,
      screenshotAfterPath,
      dryRunEvaluation,
      pageMeta: {
        url: page.url(),
        title: await page.title().catch(() => ""),
        loginRequired: pageAssessment.loginRequired,
        athletePageLikelyReachable: pageAssessment.athletePageLikelyReachable,
        trainingPeaksContextLikely: pageAssessment.trainingPeaksContextLikely,
      },
    };
  } finally {
    await context.close().catch(() => {});
  }
}

async function main(): Promise<void> {
  loadLocalEnv();

  const runnerId = getRunnerId();
  const claimed = await claimOneApprovedActionForDryRun(runnerId);
  if (!claimed) {
    console.log("No approved TrainingPeaks actions ready for dry-run.");
    return;
  }

  console.log(`Claimed TrainingPeaks action ${claimed.action.id} for dry-run.`);
  const run = await createActionRun(claimed.action.id, runnerId);
  const baseLog: Record<string, unknown> = {
    actionId: claimed.action.id,
    runId: run.id,
    runnerId,
    runType: "dry_run",
    dryRun: true,
    actionType: claimed.action.action_type,
    actionStatus: claimed.action.status,
    rawText: claimed.action.raw_text,
    targetSummary: getTargetSummary(claimed.action.parsed_payload),
    student: claimed.student
      ? {
          id: claimed.student.id,
          studentId: claimed.student.student_id,
          studentName: claimed.student.student_name,
          telegramChatId: claimed.student.telegram_chat_id,
          trainingPeaksAthleteUrl: claimed.student.trainingpeaks_athlete_url,
        }
      : null,
  };

  const studentName = claimed.student?.student_name ?? "(unknown)";

  try {
    const artifacts = await runDryRunInspection(claimed, run.id);
    const evaluation = artifacts.dryRunEvaluation;
    const logJson = {
      ...baseLog,
      status: "dry_run_completed",
      inspectedAt: new Date().toISOString(),
      pageMeta: artifacts.pageMeta,
      dryRunResult: evaluation.dryRunResult,
      resolvedDates: evaluation.resolvedDates,
      candidate: evaluation.candidate,
      candidateAlternativesCount: evaluation.candidateAlternativesCount,
      confidence: evaluation.confidence,
      canExecute: evaluation.canExecute,
      canExecuteReasons: evaluation.canExecuteReasons,
      diagnostics: evaluation.diagnostics,
      identityCheck: evaluation.identityCheck,
      debugCandidatesTopN: evaluation.debugCandidatesTopN,
      rankingDebug: evaluation.rankingDebug,
      selectedSourceDatePolicy: evaluation.selectedSourceDatePolicy,
      selectedSourceDate: evaluation.selectedSourceDate,
      selectedSourceDateCandidateCount: evaluation.selectedSourceDateCandidateCount,
      globalCandidateCount: evaluation.globalCandidateCount,
      sourceDateBucketCounts: evaluation.sourceDateBucketCounts,
      note: "Ничего не изменено в TrainingPeaks",
    };

    await completeDryRun(claimed.action.id, run.id, {
      logJson,
      screenshotBeforePath: artifacts.screenshotBeforePath,
      screenshotAfterPath: artifacts.screenshotAfterPath,
    });

    await notifyCoachDryRunResult({
      chatId: resolveDryRunNotificationChatId(claimed.action),
      action: claimed.action,
      studentName,
      statusText: "dry-run completed",
      dryRunEvaluation: evaluation,
      note: "Ничего не изменено в TrainingPeaks",
    });

    console.log(`Dry-run completed for action ${claimed.action.id}.`);
  } catch (error) {
    const errorMessage = toShortErrorMessage(error);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
    const failedEvaluation: DryRunEvaluation = {
      dryRunResult: "failed",
      resolvedDates: {
        sourceDate: null,
        targetDate: null,
        timezone,
      },
      candidate: null,
      candidateAlternativesCount: 0,
      confidence: 0,
      canExecute: false,
      canExecuteReasons: [errorMessage],
      diagnostics: {
        loginRequired: /login|sign in|session expired/i.test(errorMessage),
        athleteReachable: false,
        trainingPeaksContextOk: false,
        parseWarnings: [],
      },
      identityCheck: {
        telegramUsername: null,
        telegramChatId: claimed.student?.telegram_chat_id ?? null,
        expectedTrainingPeaksName: claimed.student?.student_name ?? null,
        visibleTrainingPeaksName: null,
        expectedAthleteId: parseTrainingPeaksAthleteId(claimed.student?.trainingpeaks_athlete_url ?? null),
        currentAthleteId: null,
        expectedTrainingPeaksUrl: claimed.student?.trainingpeaks_athlete_url ?? null,
        currentUrl: null,
        matchedBy: "inconclusive",
        warnings: [],
      },
      debugCandidatesTopN: [],
    };
    const failedLog = {
      ...baseLog,
      status: "failed",
      failedAt: new Date().toISOString(),
      error: errorMessage,
      dryRunResult: failedEvaluation.dryRunResult,
      resolvedDates: failedEvaluation.resolvedDates,
      candidate: failedEvaluation.candidate,
      candidateAlternativesCount: failedEvaluation.candidateAlternativesCount,
      confidence: failedEvaluation.confidence,
      canExecute: failedEvaluation.canExecute,
      canExecuteReasons: failedEvaluation.canExecuteReasons,
      diagnostics: failedEvaluation.diagnostics,
      identityCheck: failedEvaluation.identityCheck,
      debugCandidatesTopN: failedEvaluation.debugCandidatesTopN,
      rankingDebug: failedEvaluation.rankingDebug,
      selectedSourceDatePolicy: failedEvaluation.selectedSourceDatePolicy,
      selectedSourceDate: failedEvaluation.selectedSourceDate,
      selectedSourceDateCandidateCount: failedEvaluation.selectedSourceDateCandidateCount,
      globalCandidateCount: failedEvaluation.globalCandidateCount,
      sourceDateBucketCounts: failedEvaluation.sourceDateBucketCounts,
      note: "Ничего не изменено в TrainingPeaks",
    };
    await failDryRun(claimed.action.id, run.id, {
      errorMessage,
      logJson: failedLog,
    });

    await notifyCoachDryRunResult({
      chatId: resolveDryRunNotificationChatId(claimed.action),
      action: claimed.action,
      studentName,
      statusText: "dry-run failed",
      dryRunEvaluation: failedEvaluation,
      note: "Ничего не изменено в TrainingPeaks",
      errorText: errorMessage,
    });

    throw error;
  }
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exit(1);
});
