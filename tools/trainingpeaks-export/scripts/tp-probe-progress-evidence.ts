import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { chromium } from "playwright";

import * as workoutActivityClassificationModule from "../../../src/features/trainingpeaks/workout-activity-classification.ts";
import {
  collectWorkoutText,
  containsStrongRaceKeyword,
  extractWorkoutSummaryMetrics,
  hasSameDayNamedEvent,
  median,
} from "../src/quality/index.ts";
import { profileDir, toolRoot } from "./lib/paths.ts";
import { readStudentsConfig, type StudentConfig } from "./lib/students.ts";
import { captureSessionAuth, performApiJsonRequest } from "./lib/trainingpeaks-api-move.ts";
import {
  normalizeTrainingPeaksWorkoutItems,
  type TrainingPeaksWorkoutRaw,
} from "./lib/trainingpeaks-workout-normalization.ts";

const classifyTrainingPeaksWorkoutActivity: (
  typeof workoutActivityClassificationModule
)["classifyTrainingPeaksWorkoutActivity"] =
  workoutActivityClassificationModule.classifyTrainingPeaksWorkoutActivity ??
  workoutActivityClassificationModule.default?.classifyTrainingPeaksWorkoutActivity;

const TP_API_HOST = "https://tpapi.trainingpeaks.com";
const APP_HOST = "https://app.trainingpeaks.com";

const EASY_MIN_DURATION_MIN = 25;
const EASY_MAX_DURATION_MIN = 95;
const LONG_MIN_DURATION_MIN = 80;
const EASY_MIN_SAMPLE = 4;
const LONG_MIN_SAMPLE = 2;
const COHORT_FRACTION = 0.3;
const COHORT_MAX_FRACTION = 0.35;
const COHORT_WINDOW_DAYS = 70;
const MAX_MANUAL_REVIEW_CANDIDATES = 12;
const MAX_EXCLUSION_EXAMPLES = 8;
const MAX_SECONDARY_EXAMPLES = 8;

const EASY_CUE_PATTERN =
  /\b(easy|recovery|aerobic|conversational|steady easy|легк|восстанов|аэроб|спокойн|разговорн|джог|easy run|recovery run)\b/i;
const HARD_RUN_PATTERN =
  /\b(interval|intervals|tempo|threshold|fartlek|hill repeats?|repeats?|track|vo2|max effort|race pace|progression|hard run|hard\b|test run|интерв|порог|фартлек|горк|ускорен)\b/i;
const INTERVAL_REPEAT_PATTERN = /\d+\s*[x×хX]\s*\d+/;
const TEMPO_WORKOUT_PATTERN = /(?:\btempo\b|темпов|темповая|темповый|темповой|threshold run|порогов)/i;
const LONG_CUE_KEYWORDS = [
  "long run",
  "long",
  "длительн",
  "длинн",
  "lsd",
  "продолжительн",
] as const;
const INDOOR_PATTERN = /\b(treadmill|indoor|tm\b|беговая дорожка|дорожк|манеж)\b/i;

const RU_MONTHS = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
] as const;

type CompareWithOption = "6m" | "12m";

type ComparisonWindow = {
  from: string;
  to: string;
  label: string;
};

type ComparisonModeInfo = {
  mode: "range_auto" | "as_of_window";
  as_of: string | null;
  recent_window: ComparisonWindow | null;
  baseline_window: ComparisonWindow | null;
  compare_with: CompareWithOption | null;
  description: string;
};

type CliArgs = {
  from: string;
  to: string;
  asOf: string | null;
  recentMonths: number | null;
  recentDays: number | null;
  compareWith: CompareWithOption | null;
  athleteId: number | null;
  athleteUrl: string | null;
  student: string | null;
  headed: boolean;
};

type ResolvedTarget = {
  athleteId: number;
  athleteUrl: string;
  studentId: string | null;
  studentName: string | null;
};

type ApiFetchResult = {
  endpoint: string;
  status: number;
  ok: boolean;
  count: number;
  error: string | null;
};

type ParsedEvent = {
  event_id: string | null;
  event_date: string;
  event_name: string | null;
  event_distance_km: number | null;
  sport_type: string | null;
  raw: Record<string, unknown>;
};

type FieldName =
  | "distance"
  | "totalTime"
  | "heartRateAverage"
  | "heartRateMinimum"
  | "heartRateMaximum"
  | "velocityAverage"
  | "velocityMaximum"
  | "normalizedSpeedActual"
  | "elevationGain"
  | "if"
  | "tssActual"
  | "description"
  | "coachComments"
  | "workoutComments"
  | "workoutDeviceSource"
  | "syncedTo"
  | "personalRecordCount"
  | "raceTypeDuration";

type ComparableRun = {
  workoutId: number;
  date: string;
  title: string;
  distanceKm: number;
  durationMin: number;
  paceSecPerKm: number;
  avgHr: number | null;
  minHr: number | null;
  maxHr: number | null;
  elevationGain: number | null;
  elevationPerKm: number | null;
  intensityFactor: number | null;
  tssActual: number | null;
  velocityAverage: number | null;
  velocityMaximum: number | null;
  normalizedSpeedActual: number | null;
  derivedSpeedMps: number | null;
  isIndoor: boolean;
  surface: "indoor" | "outdoor";
  easyCue: boolean;
  hardCue: boolean;
  longCue: boolean;
  raceLike: boolean;
  raceLikeReasons: string[];
  suspiciousReasons: string[];
  category: "easy_run" | "long_run";
  durationBand: string;
  terrainBand: string;
  comparisonBand: string;
};

type FunnelStageCounts = {
  total_workouts: number;
  running_workouts: number;
  completed_running: number;
  has_distance_time: number;
  passes_basic_quality: number;
  not_race_like: number;
  not_interval_tempo_hard: number;
  duration_in_bucket: number;
  primary_hr_eligible: number;
  secondary_no_hr_eligible: number;
  comparable_primary: number;
  comparable_secondary: number;
};

type ExclusionExample = {
  date: string;
  title: string;
  workout_id: number;
  stage: string;
  reason: string;
};

type CandidateExample = {
  date: string;
  title: string;
  workout_id: number;
  distance_km: number;
  duration_min: number;
  pace_sec_per_km: number;
  avg_hr: number | null;
  reason: string;
};

type CategorySelectionResult = {
  funnel: FunnelStageCounts;
  primary: ComparableRun[];
  secondary: ComparableRun[];
  exclusionExamples: ExclusionExample[];
  manualReview: ManualReviewCandidate[];
};

type CohortSummary = {
  label: string;
  window: ComparisonWindow | null;
  from: string | null;
  to: string | null;
  n: number;
  median_pace_sec_per_km: number | null;
  median_hr: number | null;
  median_duration_min: number | null;
  median_distance_km: number | null;
  median_elevation_gain: number | null;
  median_if: number | null;
  median_tss: number | null;
  workouts: ComparableRun[];
};

type DeltaSummary = {
  pace_change_sec_per_km: number | null;
  hr_change_bpm: number | null;
  duration_change_min: number | null;
  distance_change_km: number | null;
  elevation_gain_change: number | null;
};

type EvidenceStatus = "found" | "needs_review" | "insufficient_data";
type EvidenceConfidence = "high" | "medium" | "low";
type EvidenceInterpretation =
  | "faster_at_same_or_lower_hr"
  | "faster_but_higher_hr"
  | "similar_pace_lower_hr"
  | "no_clear_progress"
  | "insufficient_data";

type RepresentativeWorkout = {
  date: string;
  title: string;
  workout_id: number;
  distance_km: number;
  duration_min: number;
  pace_sec_per_km: number;
  avg_hr: number | null;
  elevation_gain: number | null;
  surface: "indoor" | "outdoor";
};

type EvidenceItem = {
  status: EvidenceStatus;
  confidence: EvidenceConfidence;
  baseline_cohort: CohortSummary | null;
  recent_cohort: CohortSummary | null;
  delta: DeltaSummary | null;
  interpretation: EvidenceInterpretation;
  representative_workouts: {
    baseline: RepresentativeWorkout[];
    recent: RepresentativeWorkout[];
  };
  guardrails_applied: string[];
  manual_review_notes: string[];
  summary: string;
  comparable_workouts_count: number;
  eligible_workouts_count: number;
  primary_eligible_count: number;
  secondary_eligible_count: number;
  secondary_examples: CandidateExample[];
  funnel: FunnelStageCounts;
  top_exclusion_examples: ExclusionExample[];
};

type ManualReviewCandidate = {
  category: "easy_run" | "long_run" | "race_result_progress";
  date: string | null;
  title: string;
  workout_id: number | null;
  reason: string;
  note: string;
};

type ProgressEvidenceReport = {
  run_at: string;
  athlete: {
    athlete_id: number;
    athlete_url: string;
    student_id: string | null;
    student_name: string | null;
  };
  comparison_mode: ComparisonModeInfo;
  range: { from: string; to: string };
  data_sources: {
    workouts: ApiFetchResult;
    events: ApiFetchResult;
  };
  fields_available: string[];
  fields_missing: string[];
  evidence_summary: string[];
  easy_run_progress: EvidenceItem;
  long_run_progress: EvidenceItem;
  race_result_progress: EvidenceItem;
  manual_review_candidates: ManualReviewCandidate[];
  easy_run_funnel: FunnelStageCounts;
  long_run_funnel: FunnelStageCounts;
  top_exclusion_examples: {
    easy_run: ExclusionExample[];
    long_run: ExclusionExample[];
  };
  limitations: string[];
  workouts_scanned: number;
  output_paths: {
    report_json: string;
    report_md: string;
  };
};

function readTextFileSyncSafe(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function loadDotEnvFile(dotEnvPath: string): void {
  if (!existsSync(dotEnvPath)) return;
  const content = readTextFileSyncSafe(dotEnvPath);
  if (content === null) return;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) continue;
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
  for (const envPath of [
    path.join(repoRoot, ".env.local"),
    path.join(repoRoot, ".env"),
    path.join(toolRoot, ".env"),
  ]) {
    loadDotEnvFile(envPath);
  }
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseAthleteIdFromUrl(value: string): number | null {
  const match = value.match(/\/athletes\/(\d+)/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim().replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toPositiveInt(value: unknown): number | null {
  const parsed = toFiniteNumber(value);
  if (parsed === null || !Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function toIsoDatePart(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})(?:$|[T\s])/);
  return match?.[1] ?? null;
}

function pickFirstString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return null;
}

function pickFirstNonEmpty(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    const value = record[key];
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && !value.trim()) continue;
    return value;
  }
  return null;
}

function formatDistanceKm(rawDistance: unknown): { distance: string | null; meters: number | null } {
  const numeric = toFiniteNumber(rawDistance);
  if (numeric === null || numeric <= 0) {
    return { distance: null, meters: null };
  }
  const meters = numeric > 200 ? numeric : numeric * 1000;
  const kilometers = meters / 1000;
  const roundedOne = Math.round(kilometers * 10) / 10;
  return { distance: `${roundedOne.toFixed(1)} km`, meters };
}

function timestampForPath(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function resolveChromeExecutablePath(): string | undefined {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    path.join(process.env.HOME ?? "", "Applications", "Google Chrome.app", "Contents", "MacOS", "Google Chrome"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return undefined;
}

function formatPaceLabel(paceSecPerKm: number | null): string {
  if (paceSecPerKm === null) return "н/д";
  const rounded = Math.round(paceSecPerKm);
  const min = Math.floor(rounded / 60);
  const sec = rounded % 60;
  return `${min}:${String(sec).padStart(2, "0")}/км`;
}

function formatHrLabel(value: number | null): string {
  if (value === null) return "н/д";
  return `${Math.round(value)} bpm`;
}

function formatSignedSeconds(value: number | null): string {
  if (value === null) return "н/д";
  const rounded = Math.round(value);
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded} сек/км`;
}

function formatSignedBpm(value: number | null): string {
  if (value === null) return "н/д";
  const rounded = Math.round(value);
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded} bpm`;
}

function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const base = Math.floor(position);
  const rest = position - base;
  const left = sorted[base]!;
  const right = sorted[Math.min(base + 1, sorted.length - 1)]!;
  return left + (right - left) * rest;
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function subtractMonths(isoDate: string, months: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - months);
  return date.toISOString().slice(0, 10);
}

function parseIsoDateUtc(isoDate: string): Date {
  return new Date(`${isoDate}T12:00:00Z`);
}

function formatPeriodLabel(from: string, to: string): string {
  const fromDate = parseIsoDateUtc(from);
  const toDate = parseIsoDateUtc(to);
  const fromMonth = RU_MONTHS[fromDate.getUTCMonth()]!;
  const toMonth = RU_MONTHS[toDate.getUTCMonth()]!;
  const fromYear = fromDate.getUTCFullYear();
  const toYear = toDate.getUTCFullYear();

  if (from === to) {
    return `${fromMonth} ${fromYear}`;
  }
  if (fromYear === toYear && fromDate.getUTCMonth() === toDate.getUTCMonth()) {
    return `${fromMonth} ${fromYear}`;
  }
  if (fromYear === toYear) {
    return `${fromMonth}–${toMonth} ${fromYear}`;
  }
  return `${fromMonth} ${fromYear} → ${toMonth} ${toYear}`;
}

function buildWindow(from: string, to: string): ComparisonWindow {
  return { from, to, label: formatPeriodLabel(from, to) };
}

function shiftWindowByCompareWith(
  window: ComparisonWindow,
  compareWith: CompareWithOption,
): ComparisonWindow {
  const months = compareWith === "6m" ? 6 : 12;
  const from = subtractMonths(window.from, months);
  const to = subtractMonths(window.to, months);
  return buildWindow(from, to);
}

function buildAsOfComparisonMode(input: {
  asOf: string;
  recentMonths: number | null;
  recentDays: number | null;
  compareWith: CompareWithOption;
}): ComparisonModeInfo {
  const recentFrom =
    input.recentDays !== null
      ? addDays(input.asOf, -input.recentDays)
      : subtractMonths(input.asOf, input.recentMonths ?? 0);
  const recentWindow = buildWindow(recentFrom, input.asOf);
  const baselineWindow = shiftWindowByCompareWith(recentWindow, input.compareWith);

  const compareLabel = input.compareWith === "6m" ? "6 месяцев назад" : "год назад";
  let description: string;
  if (input.recentDays !== null) {
    description = `Сравнение: последние ${input.recentDays} дней против такого же периода ${compareLabel}.`;
  } else {
    const months = input.recentMonths ?? 0;
    const monthWord = months === 1 ? "месяц" : months >= 2 && months <= 4 ? "месяца" : "месяцев";
    description = `Сравнение: последние ${months} ${monthWord} против такого же периода ${compareLabel}.`;
  }

  return {
    mode: "as_of_window",
    as_of: input.asOf,
    recent_window: recentWindow,
    baseline_window: baselineWindow,
    compare_with: input.compareWith,
    description,
  };
}

function buildRangeAutoComparisonMode(_from: string, _to: string): ComparisonModeInfo {
  return {
    mode: "range_auto",
    as_of: null,
    recent_window: null,
    baseline_window: null,
    compare_with: null,
    description: "Сравнение: ранняя и последняя части выбранного диапазона.",
  };
}

function parseCompareWith(value: string): CompareWithOption {
  const normalized = value.trim().toLowerCase();
  if (normalized === "6m") return "6m";
  if (normalized === "12m") return "12m";
  throw new Error(`Invalid --compare-with value: "${value}". Expected 6m or 12m.`);
}

function parseArgs(argv: string[]): CliArgs & { comparisonMode: ComparisonModeInfo } {
  const parsed: CliArgs = {
    from: "",
    to: "",
    asOf: null,
    recentMonths: null,
    recentDays: null,
    compareWith: null,
    athleteId: null,
    athleteUrl: null,
    student: null,
    headed: false,
  };

  let targetCount = 0;

  for (const arg of argv) {
    if (arg.startsWith("--from=")) {
      parsed.from = arg.slice("--from=".length).trim();
      continue;
    }
    if (arg.startsWith("--to=")) {
      parsed.to = arg.slice("--to=".length).trim();
      continue;
    }
    if (arg.startsWith("--as-of=")) {
      const asOf = arg.slice("--as-of=".length).trim();
      if (!isIsoDate(asOf)) {
        throw new Error(`Invalid --as-of date: "${asOf}". Expected YYYY-MM-DD.`);
      }
      parsed.asOf = asOf;
      continue;
    }
    if (arg.startsWith("--recent-months=")) {
      const recentMonths = Number(arg.slice("--recent-months=".length).trim());
      if (!Number.isInteger(recentMonths) || recentMonths <= 0) {
        throw new Error(`Invalid --recent-months value: ${arg}`);
      }
      parsed.recentMonths = recentMonths;
      continue;
    }
    if (arg.startsWith("--recent-days=")) {
      const recentDays = Number(arg.slice("--recent-days=".length).trim());
      if (!Number.isInteger(recentDays) || recentDays <= 0) {
        throw new Error(`Invalid --recent-days value: ${arg}`);
      }
      parsed.recentDays = recentDays;
      continue;
    }
    if (arg.startsWith("--compare-with=")) {
      parsed.compareWith = parseCompareWith(arg.slice("--compare-with=".length));
      continue;
    }
    if (arg.startsWith("--athlete-id=")) {
      const athleteId = Number(arg.slice("--athlete-id=".length).trim());
      if (!Number.isInteger(athleteId) || athleteId <= 0) {
        throw new Error(`Invalid --athlete-id value: ${arg}`);
      }
      parsed.athleteId = athleteId;
      targetCount += 1;
      continue;
    }
    if (arg.startsWith("--athlete-url=")) {
      const athleteUrl = arg.slice("--athlete-url=".length).trim();
      if (!athleteUrl) throw new Error("Empty --athlete-url value.");
      parsed.athleteUrl = athleteUrl;
      targetCount += 1;
      continue;
    }
    if (arg.startsWith("--student=")) {
      const student = arg.slice("--student=".length).trim();
      if (!student) throw new Error("Empty --student value.");
      parsed.student = student;
      targetCount += 1;
      continue;
    }
    if (arg === "--headed") {
      parsed.headed = true;
      continue;
    }
    if (arg === "--headless") {
      parsed.headed = false;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (targetCount === 0) {
    throw new Error("Exactly one target is required: --student, --athlete-id, or --athlete-url.");
  }
  if (targetCount > 1) {
    throw new Error("Ambiguous target: provide only one of --student, --athlete-id, or --athlete-url.");
  }

  if (parsed.recentMonths !== null && parsed.recentDays !== null) {
    throw new Error("Provide only one recent window: --recent-months or --recent-days, not both.");
  }

  let comparisonMode: ComparisonModeInfo;

  if (parsed.asOf) {
    if (parsed.recentMonths === null && parsed.recentDays === null) {
      throw new Error(
        "With --as-of, provide a recent window via --recent-months or --recent-days.",
      );
    }
    const compareWith = parsed.compareWith ?? "12m";
    comparisonMode = buildAsOfComparisonMode({
      asOf: parsed.asOf,
      recentMonths: parsed.recentMonths,
      recentDays: parsed.recentDays,
      compareWith,
    });
    parsed.from = comparisonMode.baseline_window!.from;
    parsed.to = comparisonMode.recent_window!.to;
    parsed.compareWith = compareWith;
  } else {
    if (!isIsoDate(parsed.from)) {
      throw new Error(`Missing or invalid --from date: "${parsed.from}". Expected YYYY-MM-DD.`);
    }
    if (!isIsoDate(parsed.to)) {
      throw new Error(`Missing or invalid --to date: "${parsed.to}". Expected YYYY-MM-DD.`);
    }
    if (parsed.from > parsed.to) {
      throw new Error(`Invalid date range: --from (${parsed.from}) is after --to (${parsed.to}).`);
    }
    comparisonMode = buildRangeAutoComparisonMode(parsed.from, parsed.to);
  }

  return { ...parsed, comparisonMode };
}

function resolveTarget(args: CliArgs, students: StudentConfig[]): ResolvedTarget {
  const studentNeedle = args.student?.trim().toLowerCase() ?? null;
  const athleteIdFromUrl = args.athleteUrl ? parseAthleteIdFromUrl(args.athleteUrl) : null;
  const resolvedAthleteId = args.athleteId ?? athleteIdFromUrl;
  const normalizedAthleteUrl = args.athleteUrl ? normalizeUrl(args.athleteUrl) : null;

  if (args.athleteUrl && !resolvedAthleteId) {
    throw new Error(`Could not parse athlete id from --athlete-url: ${args.athleteUrl}`);
  }

  const matchedStudents = students.filter((student) => {
    if (studentNeedle) {
      const idMatch = student.student_id.toLowerCase() === studentNeedle;
      const nameMatch = (student.name ?? "").toLowerCase() === studentNeedle;
      if (!idMatch && !nameMatch) return false;
    }

    const studentAthleteId = parseAthleteIdFromUrl(student.trainingpeaks_athlete_url);
    if (resolvedAthleteId && studentAthleteId !== resolvedAthleteId) {
      if (!normalizedAthleteUrl) return false;
      if (normalizeUrl(student.trainingpeaks_athlete_url) !== normalizedAthleteUrl) return false;
    }
    if (normalizedAthleteUrl && normalizeUrl(student.trainingpeaks_athlete_url) !== normalizedAthleteUrl) {
      if (!resolvedAthleteId || studentAthleteId !== resolvedAthleteId) return false;
    }
    return true;
  });

  if (studentNeedle && matchedStudents.length === 0) {
    throw new Error(`No student matched --student="${args.student}".`);
  }
  if (matchedStudents.length > 1) {
    const sample = matchedStudents.slice(0, 5).map((s) => `${s.name ?? s.student_id} (${s.student_id})`);
    throw new Error(`Multiple students matched target. Narrow input. Matches: ${sample.join(", ")}`);
  }

  const matched = matchedStudents[0] ?? null;
  const athleteId = resolvedAthleteId ?? (matched ? parseAthleteIdFromUrl(matched.trainingpeaks_athlete_url) : null);
  if (!athleteId) {
    throw new Error("Could not resolve TrainingPeaks athlete id from target arguments.");
  }

  return {
    athleteId,
    athleteUrl: args.athleteUrl ?? matched?.trainingpeaks_athlete_url ?? `${APP_HOST}/#calendar/athletes/${athleteId}`,
    studentId: matched?.student_id ?? null,
    studentName: matched?.name ?? matched?.student_id ?? null,
  };
}

function pickEventDate(record: Record<string, unknown>): string | null {
  const raw = pickFirstString(record, ["EventDate", "eventDate", "Date", "date"]);
  if (!raw) return null;
  const isoMatch = raw.match(/\d{4}-\d{2}-\d{2}/);
  return isoMatch ? isoMatch[0] : null;
}

function pickEventId(record: Record<string, unknown>): string | null {
  return pickFirstString(record, [
    "AthleteEventId",
    "athleteEventId",
    "EventId",
    "eventId",
    "Id",
    "id",
  ]);
}

function looksLikeEventRecord(record: Record<string, unknown>): boolean {
  const keysLower = Object.keys(record).map((key) => key.toLowerCase());
  const eventHints = new Set([
    "eventdate",
    "eventtype",
    "sporttype",
    "distance",
    "goal",
    "goals",
    "description",
    "eventtitle",
    "eventname",
    "name",
    "title",
  ]);
  return keysLower.some((key) => eventHints.has(key));
}

function flattenEventCandidates(input: unknown): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  const dedupe = new Set<string>();

  function visit(node: unknown): void {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }

    const record = node as Record<string, unknown>;
    if (looksLikeEventRecord(record)) {
      const eventDate = pickEventDate(record) ?? "";
      const eventTitle =
        pickFirstString(record, ["EventTitle", "eventTitle", "EventName", "eventName", "Name", "name", "Title", "title"]) ??
        "";
      const key = [eventDate, eventTitle].join("|").toLowerCase();
      if (!dedupe.has(key)) {
        dedupe.add(key);
        found.push(record);
      }
    }

    for (const value of Object.values(record)) visit(value);
  }

  visit(input);
  return found;
}

function parseEventsFromApi(body: unknown, from: string, to: string): ParsedEvent[] {
  const eventObjects = flattenEventCandidates(body);
  const parsed: ParsedEvent[] = [];
  for (const eventObj of eventObjects) {
    const eventDate = pickEventDate(eventObj);
    if (!eventDate || eventDate < from || eventDate > to) continue;
    const distanceValue = pickFirstNonEmpty(eventObj, ["Distance", "distance"]);
    const distanceParsed = formatDistanceKm(distanceValue);
    parsed.push({
      event_id: pickEventId(eventObj),
      event_date: eventDate,
      event_name: pickFirstString(eventObj, [
        "EventTitle",
        "eventTitle",
        "EventName",
        "eventName",
        "Name",
        "name",
        "Title",
        "title",
      ]),
      event_distance_km:
        distanceParsed.meters !== null ? Math.round((distanceParsed.meters / 1000) * 1000) / 1000 : null,
      sport_type: pickFirstString(eventObj, ["SportType", "sportType", "EventType", "eventType"]),
      raw: eventObj,
    });
  }
  return parsed;
}

function hasPlausibleAverageHr(minHr: number | null, avgHr: number | null, maxHr: number | null): boolean {
  if (avgHr === null) return false;
  if (avgHr < 90 || avgHr > 190) return false;
  if (maxHr !== null && avgHr > maxHr) return false;
  if (minHr !== null && minHr > avgHr) return false;
  return true;
}

function hasHardRunCue(text: string): boolean {
  if (INTERVAL_REPEAT_PATTERN.test(text)) return true;
  if (TEMPO_WORKOUT_PATTERN.test(text)) return true;
  return HARD_RUN_PATTERN.test(text);
}

function hasLongCue(text: string): boolean {
  const lower = text.toLowerCase();
  return LONG_CUE_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function detectRaceLike(input: {
  raw: TrainingPeaksWorkoutRaw;
  text: string;
  date: string;
  eventsByDate: Map<string, ParsedEvent[]>;
}): { raceLike: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (hasSameDayNamedEvent(input.date, input.eventsByDate)) {
    reasons.push("same_day_named_event");
  }
  if (containsStrongRaceKeyword(input.text)) {
    reasons.push("race_keyword_in_text");
  }
  if ((toFiniteNumber(input.raw.personalRecordCount) ?? 0) > 0) {
    reasons.push("personal_record_count");
  }
  if (input.raw.raceTypeDuration !== null && input.raw.raceTypeDuration !== undefined) {
    reasons.push("race_type_duration");
  }

  return { raceLike: reasons.length > 0, reasons };
}

function isIntervalTempoHard(run: ComparableRun): boolean {
  return run.hardCue;
}

function isEasyEnough(run: ComparableRun): boolean {
  const lowIntensity = run.intensityFactor !== null && run.intensityFactor < 0.78;
  if (lowIntensity) return true;
  if (run.easyCue) return true;
  if (run.hardCue || run.raceLike) return false;
  return true;
}

function hasBasicQuality(run: ComparableRun): boolean {
  const blocking = new Set([
    "gps_spike_or_speed_anomaly",
    "implausible_max_speed",
    "implausible_avg_hr",
    "avg_hr_gt_max_hr",
    "min_hr_gt_avg_hr",
  ]);
  return !run.suspiciousReasons.some((reason) => blocking.has(reason));
}

function createEmptyFunnel(totalWorkouts: number): FunnelStageCounts {
  return {
    total_workouts: totalWorkouts,
    running_workouts: 0,
    completed_running: 0,
    has_distance_time: 0,
    passes_basic_quality: 0,
    not_race_like: 0,
    not_interval_tempo_hard: 0,
    duration_in_bucket: 0,
    primary_hr_eligible: 0,
    secondary_no_hr_eligible: 0,
    comparable_primary: 0,
    comparable_secondary: 0,
  };
}

function pushExclusionExample(
  target: ExclusionExample[],
  example: ExclusionExample,
): void {
  if (target.length >= MAX_EXCLUSION_EXAMPLES) return;
  const key = `${example.workout_id}|${example.stage}|${example.reason}`;
  if (target.some((item) => `${item.workout_id}|${item.stage}|${item.reason}` === key)) return;
  target.push(example);
}

function toCandidateExample(run: ComparableRun, reason: string): CandidateExample {
  return {
    date: run.date,
    title: run.title,
    workout_id: run.workoutId,
    distance_km: run.distanceKm,
    duration_min: run.durationMin,
    pace_sec_per_km: run.paceSecPerKm,
    avg_hr: run.avgHr,
    reason,
  };
}

function buildSuspiciousReasons(raw: TrainingPeaksWorkoutRaw, derivedSpeedMps: number | null): string[] {
  const suspicious: string[] = [];
  const metrics = extractWorkoutSummaryMetrics(raw, toFiniteNumber);
  const velocityAverage = metrics.velocityAverage;
  const velocityMaximum = metrics.velocityMaximum;
  const normalizedSpeedActual = metrics.normalizedSpeedActual;
  const minHr = metrics.heartRateMinimum;
  const avgHr = metrics.heartRateAverage;
  const maxHr = metrics.heartRateMaximum;

  if (avgHr !== null && maxHr !== null && avgHr > maxHr) suspicious.push("avg_hr_gt_max_hr");
  if (minHr !== null && avgHr !== null && minHr > avgHr) suspicious.push("min_hr_gt_avg_hr");
  if (avgHr !== null && (avgHr < 90 || avgHr > 190)) suspicious.push("implausible_avg_hr");

  if (
    derivedSpeedMps !== null &&
    velocityAverage !== null &&
    velocityAverage > 0 &&
    Math.abs(derivedSpeedMps - velocityAverage) / velocityAverage > 0.05
  ) {
    suspicious.push("speed_summary_inconsistent");
  }
  if (
    derivedSpeedMps !== null &&
    normalizedSpeedActual !== null &&
    normalizedSpeedActual > 0 &&
    Math.abs(derivedSpeedMps - normalizedSpeedActual) / normalizedSpeedActual > 0.07
  ) {
    suspicious.push("normalized_speed_mismatch");
  }
  if (
    derivedSpeedMps !== null &&
    velocityMaximum !== null &&
    derivedSpeedMps > 0 &&
    velocityMaximum / derivedSpeedMps > 2.2
  ) {
    suspicious.push("gps_spike_or_speed_anomaly");
  }
  if (velocityMaximum !== null && velocityMaximum > 8.5) {
    suspicious.push("implausible_max_speed");
  }

  return suspicious;
}

function buildDurationBand(category: "easy_run" | "long_run", durationMin: number): string {
  if (category === "easy_run") {
    if (durationMin < 45) return "25-44";
    if (durationMin < 70) return "45-69";
    return "70-95";
  }
  if (durationMin < 110) return "90-109";
  if (durationMin < 140) return "110-139";
  return "140+";
}

function buildTerrainBand(elevationPerKm: number | null): string {
  if (elevationPerKm === null) return "unknown";
  if (elevationPerKm < 8) return "flat";
  if (elevationPerKm < 20) return "rolling";
  return "hilly";
}

function toComparableRun(input: {
  raw: TrainingPeaksWorkoutRaw;
  athleteId: number;
  eventsByDate: Map<string, ParsedEvent[]>;
}): ComparableRun | null {
  const workoutId = toPositiveInt(input.raw.workoutId);
  const date = toIsoDatePart(input.raw.workoutDay);
  const distanceMeters = toFiniteNumber(input.raw.distance);
  const totalTimeHours = toFiniteNumber(input.raw.totalTime);
  if (!workoutId || !date || distanceMeters === null || totalTimeHours === null) return null;
  if (distanceMeters <= 0 || totalTimeHours <= 0) return null;

  const classification = classifyTrainingPeaksWorkoutActivity({
    title: typeof input.raw.title === "string" ? input.raw.title : null,
    sportOrTypeCode: typeof input.raw.code === "string" ? input.raw.code : null,
    workoutTypeValueId: toFiniteNumber(input.raw.workoutTypeValueId),
    workoutSubTypeId: toFiniteNumber(input.raw.workoutSubTypeId),
    sourceSnapshot: input.raw,
  });
  if (!classification.isRunning) return null;

  const title = typeof input.raw.title === "string" && input.raw.title.trim() ? input.raw.title.trim() : "Running";
  const text = collectWorkoutText(input.raw);
  const distanceKm = distanceMeters / 1000;
  const durationMin = totalTimeHours * 60;
  const paceSecPerKm = (durationMin * 60) / distanceKm;
  const elevationGain = toFiniteNumber(input.raw.elevationGain);
  const elevationPerKm = elevationGain !== null && distanceKm > 0 ? elevationGain / distanceKm : null;
  const avgHr = toFiniteNumber(input.raw.heartRateAverage);
  const minHr = toFiniteNumber(input.raw.heartRateMinimum);
  const maxHr = toFiniteNumber(input.raw.heartRateMaximum);
  const intensityFactor = toFiniteNumber(input.raw.if);
  const tssActual = toFiniteNumber(input.raw.tssActual);
  const derivedSpeedMps = distanceMeters / (totalTimeHours * 3600);
  const suspiciousReasons = buildSuspiciousReasons(input.raw, derivedSpeedMps);

  const { raceLike, reasons: raceLikeReasons } = detectRaceLike({
    raw: input.raw,
    text,
    date,
    eventsByDate: input.eventsByDate,
  });

  const easyCue = EASY_CUE_PATTERN.test(text);
  const hardCue = hasHardRunCue(text);
  const longCue = hasLongCue(text);
  const isIndoor =
    INDOOR_PATTERN.test(text) ||
    (typeof input.raw.workoutDeviceSource === "string" && INDOOR_PATTERN.test(input.raw.workoutDeviceSource));

  return {
    workoutId,
    date,
    title,
    distanceKm: Math.round(distanceKm * 100) / 100,
    durationMin: Math.round(durationMin * 10) / 10,
    paceSecPerKm: Math.round(paceSecPerKm),
    avgHr,
    minHr,
    maxHr,
    elevationGain: elevationGain !== null ? Math.round(elevationGain) : null,
    elevationPerKm: elevationPerKm !== null ? Number(elevationPerKm.toFixed(1)) : null,
    intensityFactor,
    tssActual,
    velocityAverage: toFiniteNumber(input.raw.velocityAverage),
    velocityMaximum: toFiniteNumber(input.raw.velocityMaximum),
    normalizedSpeedActual: toFiniteNumber(input.raw.normalizedSpeedActual),
    derivedSpeedMps,
    isIndoor,
    surface: isIndoor ? "indoor" : "outdoor",
    easyCue,
    hardCue,
    longCue,
    raceLike,
    raceLikeReasons,
    suspiciousReasons,
    category: "easy_run",
    durationBand: buildDurationBand("easy_run", durationMin),
    terrainBand: buildTerrainBand(elevationPerKm),
    comparisonBand: "",
  };
}

function maybeAddManualReview(
  manualReview: ManualReviewCandidate[],
  candidate: ManualReviewCandidate,
): void {
  manualReview.push(candidate);
}

function evaluateManualReviewForRun(
  run: ComparableRun,
  category: "easy_run" | "long_run",
  stageContext: {
    raceAmbiguous: boolean;
    hardAmbiguous: boolean;
    nearlyAcceptedDespiteHardCue: boolean;
    easyTitleButHardMetrics: boolean;
    includeIndoorReview: boolean;
  },
  manualReview: ManualReviewCandidate[],
): void {
  const suspiciousGps = run.suspiciousReasons.some((reason) =>
    ["gps_spike_or_speed_anomaly", "implausible_max_speed", "speed_summary_inconsistent", "normalized_speed_mismatch"].includes(reason),
  );

  if (stageContext.raceAmbiguous) {
    maybeAddManualReview(manualReview, {
      category,
      date: run.date,
      title: run.title,
      workout_id: run.workoutId,
      reason: "ambiguous_race_like",
      note: `${run.date} · ${run.title} · ${run.raceLikeReasons.join(", ") || "race-like signals mixed"}`,
    });
  }
  if (stageContext.hardAmbiguous) {
    maybeAddManualReview(manualReview, {
      category,
      date: run.date,
      title: run.title,
      workout_id: run.workoutId,
      reason: "ambiguous_hard_classification",
      note: `${run.date} · ${run.title}`,
    });
  }
  if (suspiciousGps) {
    maybeAddManualReview(manualReview, {
      category,
      date: run.date,
      title: run.title,
      workout_id: run.workoutId,
      reason: "gps_or_speed_anomaly",
      note: `${run.date} · ${run.title} · ${run.suspiciousReasons.join(", ")}`,
    });
  }
  if (
    run.suspiciousReasons.includes("speed_summary_inconsistent") ||
    run.suspiciousReasons.includes("normalized_speed_mismatch")
  ) {
    maybeAddManualReview(manualReview, {
      category,
      date: run.date,
      title: run.title,
      workout_id: run.workoutId,
      reason: "speed_data_inconsistent",
      note: `${run.date} · ${run.title}`,
    });
  }
  if (stageContext.includeIndoorReview && run.isIndoor) {
    maybeAddManualReview(manualReview, {
      category,
      date: run.date,
      title: run.title,
      workout_id: run.workoutId,
      reason: "indoor_ambiguity",
      note: `${run.date} · ${run.title}`,
    });
  }
  if (stageContext.easyTitleButHardMetrics) {
    maybeAddManualReview(manualReview, {
      category,
      date: run.date,
      title: run.title,
      workout_id: run.workoutId,
      reason: "easy_title_hard_metrics",
      note: `${run.date} · ${run.title}`,
    });
  }
  if (stageContext.longTitleButShortMetrics) {
    maybeAddManualReview(manualReview, {
      category,
      date: run.date,
      title: run.title,
      workout_id: run.workoutId,
      reason: "long_title_short_metrics",
      note: `${run.date} · ${run.title}`,
    });
  }
  if (stageContext.nearlyAcceptedDespiteHardCue) {
    maybeAddManualReview(manualReview, {
      category,
      date: run.date,
      title: run.title,
      workout_id: run.workoutId,
      reason: "hard_cue_near_miss",
      note: `${run.date} · ${run.title}`,
    });
  }
}

function finalizeComparableRun(
  run: ComparableRun,
  category: "easy_run" | "long_run",
): ComparableRun {
  return {
    ...run,
    category,
    durationBand: buildDurationBand(category, run.durationMin),
    comparisonBand: `${run.surface}|${buildDurationBand(category, run.durationMin)}|${run.terrainBand}`,
  };
}

function selectEasyCandidates(input: {
  totalWorkouts: number;
  runningWorkouts: number;
  completedRunning: number;
  runs: ComparableRun[];
}): CategorySelectionResult {
  const funnel = createEmptyFunnel(input.totalWorkouts);
  funnel.running_workouts = input.runningWorkouts;
  funnel.completed_running = input.completedRunning;

  const primary: ComparableRun[] = [];
  const secondary: ComparableRun[] = [];
  const exclusionExamples: ExclusionExample[] = [];
  const manualReview: ManualReviewCandidate[] = [];

  for (const run of input.runs) {
    funnel.has_distance_time += 1;

    if (!hasBasicQuality(run)) {
      pushExclusionExample(exclusionExamples, {
        date: run.date,
        title: run.title,
        workout_id: run.workoutId,
        stage: "passes_basic_quality",
        reason: run.suspiciousReasons[0] ?? "basic_quality_failed",
      });
      evaluateManualReviewForRun(run, "easy_run", {
        raceAmbiguous: false,
        hardAmbiguous: false,
        nearlyAcceptedDespiteHardCue: false,
        easyTitleButHardMetrics: false,
        longTitleButShortMetrics: false,
        includeIndoorReview: false,
      }, manualReview);
      continue;
    }
    funnel.passes_basic_quality += 1;

    if (run.raceLike) {
      pushExclusionExample(exclusionExamples, {
        date: run.date,
        title: run.title,
        workout_id: run.workoutId,
        stage: "not_race_like",
        reason: run.raceLikeReasons[0] ?? "race_like",
      });
      continue;
    }
    funnel.not_race_like += 1;

    const hard = isIntervalTempoHard(run);
    const easyEnough = isEasyEnough(run);
    const hardAmbiguous = run.hardCue && !hard && easyEnough;
    const nearlyAcceptedDespiteHardCue = run.hardCue && easyEnough && !hard;

    if (hard) {
      pushExclusionExample(exclusionExamples, {
        date: run.date,
        title: run.title,
        workout_id: run.workoutId,
        stage: "not_interval_tempo_hard",
        reason: run.hardCue ? "interval_tempo_or_hard_cue" : "high_intensity_factor",
      });
      evaluateManualReviewForRun(run, "easy_run", {
        raceAmbiguous: false,
        hardAmbiguous,
        nearlyAcceptedDespiteHardCue,
        easyTitleButHardMetrics: run.easyCue && hard,
        longTitleButShortMetrics: false,
        includeIndoorReview: false,
      }, manualReview);
      continue;
    }
    funnel.not_interval_tempo_hard += 1;

    if (run.durationMin < EASY_MIN_DURATION_MIN || run.durationMin > EASY_MAX_DURATION_MIN) {
      pushExclusionExample(exclusionExamples, {
        date: run.date,
        title: run.title,
        workout_id: run.workoutId,
        stage: "duration_in_bucket",
        reason: "duration_out_of_easy_range",
      });
      continue;
    }
    funnel.duration_in_bucket += 1;

    const easyTitleButHardMetrics =
      run.easyCue &&
      ((run.intensityFactor !== null && run.intensityFactor >= 0.85) ||
        (run.avgHr !== null && run.maxHr !== null && run.avgHr / run.maxHr > 0.92));

    const hasHr = hasPlausibleAverageHr(run.minHr, run.avgHr, run.maxHr);
    if (!easyEnough) {
      pushExclusionExample(exclusionExamples, {
        date: run.date,
        title: run.title,
        workout_id: run.workoutId,
        stage: "primary_hr_eligible",
        reason: "not_clearly_easy",
      });
      evaluateManualReviewForRun(run, "easy_run", {
        raceAmbiguous: false,
        hardAmbiguous,
        nearlyAcceptedDespiteHardCue,
        easyTitleButHardMetrics,
        longTitleButShortMetrics: false,
        includeIndoorReview: true,
      }, manualReview);
      continue;
    }

    const finalized = finalizeComparableRun(run, "easy_run");

    if (hasHr) {
      funnel.primary_hr_eligible += 1;
      primary.push(finalized);
      evaluateManualReviewForRun(run, "easy_run", {
        raceAmbiguous: false,
        hardAmbiguous,
        nearlyAcceptedDespiteHardCue,
        easyTitleButHardMetrics,
        longTitleButShortMetrics: false,
        includeIndoorReview: true,
      }, manualReview);
      continue;
    }

    funnel.secondary_no_hr_eligible += 1;
    secondary.push(finalized);
  }

  return {
    funnel,
    primary: primary.sort((a, b) => a.date.localeCompare(b.date)),
    secondary: secondary.sort((a, b) => a.date.localeCompare(b.date)),
    exclusionExamples,
    manualReview,
  };
}

function selectLongCandidates(input: {
  totalWorkouts: number;
  runningWorkouts: number;
  completedRunning: number;
  runs: ComparableRun[];
  longDistanceThresholdKm: number;
}): CategorySelectionResult {
  const funnel = createEmptyFunnel(input.totalWorkouts);
  funnel.running_workouts = input.runningWorkouts;
  funnel.completed_running = input.completedRunning;

  const primary: ComparableRun[] = [];
  const secondary: ComparableRun[] = [];
  const exclusionExamples: ExclusionExample[] = [];
  const manualReview: ManualReviewCandidate[] = [];

  for (const run of input.runs) {
    funnel.has_distance_time += 1;

    if (!hasBasicQuality(run)) {
      pushExclusionExample(exclusionExamples, {
        date: run.date,
        title: run.title,
        workout_id: run.workoutId,
        stage: "passes_basic_quality",
        reason: run.suspiciousReasons[0] ?? "basic_quality_failed",
      });
      evaluateManualReviewForRun(run, "long_run", {
        raceAmbiguous: false,
        hardAmbiguous: false,
        nearlyAcceptedDespiteHardCue: false,
        easyTitleButHardMetrics: false,
        longTitleButShortMetrics: false,
        includeIndoorReview: false,
      }, manualReview);
      continue;
    }
    funnel.passes_basic_quality += 1;

    if (run.raceLike) {
      pushExclusionExample(exclusionExamples, {
        date: run.date,
        title: run.title,
        workout_id: run.workoutId,
        stage: "not_race_like",
        reason: run.raceLikeReasons[0] ?? "race_like",
      });
      continue;
    }
    funnel.not_race_like += 1;

    const hard = isIntervalTempoHard(run);
    const hardAmbiguous = run.hardCue && !hard;
    const nearlyAcceptedDespiteHardCue = run.hardCue && !hard;

    if (hard) {
      pushExclusionExample(exclusionExamples, {
        date: run.date,
        title: run.title,
        workout_id: run.workoutId,
        stage: "not_interval_tempo_hard",
        reason: run.hardCue ? "interval_tempo_or_hard_cue" : "high_intensity_factor",
      });
      evaluateManualReviewForRun(run, "long_run", {
        raceAmbiguous: false,
        hardAmbiguous,
        nearlyAcceptedDespiteHardCue,
        easyTitleButHardMetrics: false,
        longTitleButShortMetrics: false,
        includeIndoorReview: false,
      }, manualReview);
      continue;
    }
    funnel.not_interval_tempo_hard += 1;

    const longEnough =
      run.durationMin >= LONG_MIN_DURATION_MIN ||
      run.distanceKm >= input.longDistanceThresholdKm ||
      run.longCue;
    if (!longEnough) {
      pushExclusionExample(exclusionExamples, {
        date: run.date,
        title: run.title,
        workout_id: run.workoutId,
        stage: "duration_in_bucket",
        reason: "not_long_enough",
      });
      continue;
    }
    funnel.duration_in_bucket += 1;

    const longTitleButShortMetrics =
      run.longCue &&
      run.durationMin < LONG_MIN_DURATION_MIN &&
      run.distanceKm < input.longDistanceThresholdKm;

    const hasHr = hasPlausibleAverageHr(run.minHr, run.avgHr, run.maxHr);
    const hrImplausibleButPresent =
      run.avgHr !== null && !hasHr;

    const finalized = finalizeComparableRun(run, "long_run");

    if (hasHr) {
      funnel.primary_hr_eligible += 1;
      primary.push(finalized);
      evaluateManualReviewForRun(run, "long_run", {
        raceAmbiguous: false,
        hardAmbiguous,
        nearlyAcceptedDespiteHardCue,
        easyTitleButHardMetrics: false,
        longTitleButShortMetrics,
        includeIndoorReview: true,
      }, manualReview);
      continue;
    }

    funnel.secondary_no_hr_eligible += 1;
    secondary.push(finalized);

    if (hrImplausibleButPresent) {
      evaluateManualReviewForRun(run, "long_run", {
        raceAmbiguous: false,
        hardAmbiguous,
        nearlyAcceptedDespiteHardCue,
        easyTitleButHardMetrics: false,
        longTitleButShortMetrics,
        includeIndoorReview: true,
      }, manualReview);
    }
  }

  return {
    funnel,
    primary: primary.sort((a, b) => a.date.localeCompare(b.date)),
    secondary: secondary.sort((a, b) => a.date.localeCompare(b.date)),
    exclusionExamples,
    manualReview,
  };
}

function chooseCountBasedCohortSize(total: number, minSample: number): number {
  const maxCount = Math.max(minSample, Math.ceil(total * COHORT_MAX_FRACTION));
  const target = Math.max(minSample, Math.round(total * COHORT_FRACTION));
  const nonOverlappingMax = Math.floor(total / 2);
  return Math.min(maxCount, Math.max(minSample, Math.min(target, nonOverlappingMax)));
}

function sliceCohorts<T extends { date: string }>(
  items: T[],
  minSample: number,
): { baseline: T[]; recent: T[]; strategy: "first_last_10_weeks" | "first_last_30_percent" | null } {
  if (items.length < minSample * 2) {
    return { baseline: [], recent: [], strategy: null };
  }

  const maxCount = Math.max(minSample, Math.ceil(items.length * COHORT_MAX_FRACTION));
  const weeksBaseline = items.filter((item) => item.date <= addDays(items[0]!.date, COHORT_WINDOW_DAYS));
  const weeksRecent = items.filter((item) => item.date >= addDays(items[items.length - 1]!.date, -COHORT_WINDOW_DAYS));

  const useWeeks =
    weeksBaseline.length >= minSample &&
    weeksRecent.length >= minSample &&
    weeksBaseline.length <= maxCount &&
    weeksRecent.length <= maxCount &&
    weeksBaseline[weeksBaseline.length - 1]!.date < weeksRecent[0]!.date;

  if (useWeeks) {
    return { baseline: weeksBaseline, recent: weeksRecent, strategy: "first_last_10_weeks" };
  }

  const countSize = chooseCountBasedCohortSize(items.length, minSample);
  if (countSize < minSample) {
    return { baseline: [], recent: [], strategy: null };
  }

  return {
    baseline: items.slice(0, countSize),
    recent: items.slice(items.length - countSize),
    strategy: "first_last_30_percent",
  };
}

function filterCohortsByWindow<T extends { date: string }>(
  items: T[],
  baselineWindow: ComparisonWindow,
  recentWindow: ComparisonWindow,
): { baseline: T[]; recent: T[] } {
  return {
    baseline: items.filter((item) => item.date >= baselineWindow.from && item.date <= baselineWindow.to),
    recent: items.filter((item) => item.date >= recentWindow.from && item.date <= recentWindow.to),
  };
}

function buildCohortWindowFromItems(
  items: ComparableRun[],
  fallback: ComparisonWindow | null,
): ComparisonWindow | null {
  if (!items.length) return fallback;
  return buildWindow(items[0]!.date, items[items.length - 1]!.date);
}

function selectCohorts(
  items: ComparableRun[],
  minSample: number,
  comparisonMode: ComparisonModeInfo,
): {
  baseline: ComparableRun[];
  recent: ComparableRun[];
  baselineWindow: ComparisonWindow | null;
  recentWindow: ComparisonWindow | null;
} {
  if (
    comparisonMode.mode === "as_of_window" &&
    comparisonMode.baseline_window &&
    comparisonMode.recent_window
  ) {
    const filtered = filterCohortsByWindow(
      items,
      comparisonMode.baseline_window,
      comparisonMode.recent_window,
    );
    return {
      baseline: filtered.baseline,
      recent: filtered.recent,
      baselineWindow: comparisonMode.baseline_window,
      recentWindow: comparisonMode.recent_window,
    };
  }

  const sliced = sliceCohorts(items, minSample);
  return {
    baseline: sliced.baseline,
    recent: sliced.recent,
    baselineWindow: buildCohortWindowFromItems(sliced.baseline, null),
    recentWindow: buildCohortWindowFromItems(sliced.recent, null),
  };
}

function summarizeCohort(
  label: string,
  items: ComparableRun[],
  window: ComparisonWindow | null,
): CohortSummary {
  const resolvedWindow = window ?? buildCohortWindowFromItems(items, null);
  return {
    label,
    window: resolvedWindow,
    from: resolvedWindow?.from ?? items[0]?.date ?? null,
    to: resolvedWindow?.to ?? items[items.length - 1]?.date ?? null,
    n: items.length,
    median_pace_sec_per_km: median(items.map((item) => item.paceSecPerKm)),
    median_hr: median(items.map((item) => item.avgHr).filter((value): value is number => value !== null)),
    median_duration_min: median(items.map((item) => item.durationMin)),
    median_distance_km: median(items.map((item) => item.distanceKm)),
    median_elevation_gain: median(
      items.map((item) => item.elevationGain).filter((value): value is number => value !== null),
    ),
    median_if: median(items.map((item) => item.intensityFactor).filter((value): value is number => value !== null)),
    median_tss: median(items.map((item) => item.tssActual).filter((value): value is number => value !== null)),
    workouts: items,
  };
}

function pickRepresentativeWorkouts(items: ComparableRun[], targetPace: number | null): RepresentativeWorkout[] {
  const sorted = [...items].sort((a, b) => {
    const deltaA = Math.abs((targetPace ?? a.paceSecPerKm) - a.paceSecPerKm);
    const deltaB = Math.abs((targetPace ?? b.paceSecPerKm) - b.paceSecPerKm);
    return deltaA - deltaB || a.date.localeCompare(b.date);
  });
  return sorted.slice(0, 3).map((item) => ({
    date: item.date,
    title: item.title,
    workout_id: item.workoutId,
    distance_km: item.distanceKm,
    duration_min: item.durationMin,
    pace_sec_per_km: item.paceSecPerKm,
    avg_hr: item.avgHr,
    elevation_gain: item.elevationGain,
    surface: item.surface,
  }));
}

function buildDelta(baseline: CohortSummary, recent: CohortSummary): DeltaSummary {
  return {
    pace_change_sec_per_km:
      baseline.median_pace_sec_per_km !== null && recent.median_pace_sec_per_km !== null
        ? Math.round(recent.median_pace_sec_per_km - baseline.median_pace_sec_per_km)
        : null,
    hr_change_bpm:
      baseline.median_hr !== null && recent.median_hr !== null
        ? Math.round(recent.median_hr - baseline.median_hr)
        : null,
    duration_change_min:
      baseline.median_duration_min !== null && recent.median_duration_min !== null
        ? Number((recent.median_duration_min - baseline.median_duration_min).toFixed(1))
        : null,
    distance_change_km:
      baseline.median_distance_km !== null && recent.median_distance_km !== null
        ? Number((recent.median_distance_km - baseline.median_distance_km).toFixed(2))
        : null,
    elevation_gain_change:
      baseline.median_elevation_gain !== null && recent.median_elevation_gain !== null
        ? Math.round(recent.median_elevation_gain - baseline.median_elevation_gain)
        : null,
  };
}

function interpretDelta(delta: DeltaSummary | null): EvidenceInterpretation {
  if (!delta || delta.pace_change_sec_per_km === null) return "insufficient_data";

  const paceImproved = delta.pace_change_sec_per_km <= -10;
  const paceSimilar = Math.abs(delta.pace_change_sec_per_km) < 10;
  const hrLowerOrSame = delta.hr_change_bpm === null || delta.hr_change_bpm <= 2;
  const hrClearlyLower = delta.hr_change_bpm !== null && delta.hr_change_bpm <= -4;
  const hrHigher = delta.hr_change_bpm !== null && delta.hr_change_bpm > 2;

  if (paceImproved && hrLowerOrSame) return "faster_at_same_or_lower_hr";
  if (paceImproved && hrHigher) return "faster_but_higher_hr";
  if (paceSimilar && hrClearlyLower) return "similar_pace_lower_hr";
  return "no_clear_progress";
}

function chooseComparableSubset(
  items: ComparableRun[],
  minSample: number,
  comparisonMode: ComparisonModeInfo,
): { selected: ComparableRun[]; guardrails: string[] } {
  if (!items.length) return { selected: [], guardrails: [] };
  const guardrails: string[] = [];

  const strategies: Array<(item: ComparableRun) => string> = [
    (item) => `${item.surface}|${item.durationBand}|${item.terrainBand}`,
    (item) => `${item.surface}|${item.durationBand}`,
    (item) => item.surface,
  ];

  for (const strategy of strategies) {
    const groups = new Map<string, ComparableRun[]>();
    for (const item of items) {
      const key = strategy(item);
      const current = groups.get(key) ?? [];
      current.push(item);
      groups.set(key, current);
    }

    const ranked = [...groups.entries()]
      .map(([key, group]) => {
        const cohorts = selectCohorts(group, minSample, comparisonMode);
        return {
          key,
          group,
          baselineN: cohorts.baseline.length,
          recentN: cohorts.recent.length,
        };
      })
      .sort((a, b) => {
        const balanceA = Math.min(a.baselineN, a.recentN);
        const balanceB = Math.min(b.baselineN, b.recentN);
        return balanceB - balanceA || b.group.length - a.group.length || a.key.localeCompare(b.key);
      });

    const winner = ranked.find(
      (entry) => entry.baselineN >= minSample && entry.recentN >= minSample,
    );
    if (winner) {
      guardrails.push(`comparison_group=${winner.key}`);
      if (winner.key.startsWith("indoor")) {
        guardrails.push("indoor_only_comparison");
      } else {
        guardrails.push("outdoor_preferred_or_outdoor_only");
      }
      return { selected: winner.group.sort((a, b) => a.date.localeCompare(b.date)), guardrails };
    }
  }

  const outdoor = items.filter((item) => item.surface === "outdoor");
  const indoor = items.filter((item) => item.surface === "indoor");
  if (outdoor.length > 0 && indoor.length > 0) {
    guardrails.push("mixed_indoor_outdoor_population");
  }
  guardrails.push("no_strict_comparable_band_found");
  return { selected: items, guardrails };
}

function buildSecondaryOnlyEvidence(input: {
  label: "easy_run" | "long_run";
  primary: ComparableRun[];
  secondary: ComparableRun[];
  funnel: FunnelStageCounts;
  exclusionExamples: ExclusionExample[];
  minSample: number;
  comparisonMode: ComparisonModeInfo;
}): EvidenceItem {
  const secondaryExamples = input.secondary.slice(0, MAX_SECONDARY_EXAMPLES).map((run) =>
    toCandidateExample(run, "secondary_no_hr"),
  );

  const comparableSecondary = chooseComparableSubset(
    input.secondary,
    input.minSample,
    input.comparisonMode,
  );
  const secondaryCohorts = selectCohorts(
    comparableSecondary.selected,
    input.minSample,
    input.comparisonMode,
  );
  const guardrailsApplied = [...comparableSecondary.guardrails, "secondary_no_hr_only"];
  const manualReviewNotes: string[] = [
    "Недостаточно тренировок с пульсом для уверенного вывода.",
    "Есть похожие пробежки без пульса — их можно использовать только как слабый ориентир.",
  ];

  let summary =
    "Недостаточно тренировок с пульсом для уверенного вывода. Есть только слабые ориентиры без HR.";
  let interpretation: EvidenceInterpretation = "insufficient_data";
  let status: EvidenceStatus = "insufficient_data";
  const confidence: EvidenceConfidence = "low";
  let baseline: CohortSummary | null = null;
  let recent: CohortSummary | null = null;
  let delta: DeltaSummary | null = null;

  if (
    secondaryCohorts.baseline.length >= input.minSample &&
    secondaryCohorts.recent.length >= input.minSample
  ) {
    baseline = summarizeCohort("baseline", secondaryCohorts.baseline, secondaryCohorts.baselineWindow);
    recent = summarizeCohort("recent", secondaryCohorts.recent, secondaryCohorts.recentWindow);
    delta = buildDelta(baseline, recent);
    guardrailsApplied.push("pace_duration_trend_without_hr");
    manualReviewNotes.push("Тренд по темпу/длительности без подтверждения пульсом.");

    if (delta.pace_change_sec_per_km !== null && delta.pace_change_sec_per_km <= -10) {
      summary =
        "Есть слабый ориентир: темп улучшился, но без подтверждения пульсом уверенность низкая.";
      interpretation = "no_clear_progress";
      status = "needs_review";
    } else if (delta.pace_change_sec_per_km !== null && Math.abs(delta.pace_change_sec_per_km) < 10) {
      summary =
        "Темп примерно стабилен по пробежкам без пульса; это только слабый ориентир.";
      interpretation = "no_clear_progress";
      status = "needs_review";
    } else {
      summary =
        "Недостаточно тренировок с пульсом для уверенного вывода. Есть только слабые ориентиры без HR.";
    }
    input.funnel.comparable_secondary = comparableSecondary.selected.length;
  }

  return {
    status,
    confidence,
    baseline_cohort: baseline,
    recent_cohort: recent,
    delta,
    interpretation,
    representative_workouts: {
      baseline: baseline
        ? pickRepresentativeWorkouts(secondaryCohorts.baseline, baseline.median_pace_sec_per_km)
        : [],
      recent: recent
        ? pickRepresentativeWorkouts(secondaryCohorts.recent, recent.median_pace_sec_per_km)
        : [],
    },
    guardrails_applied: guardrailsApplied,
    manual_review_notes: manualReviewNotes,
    summary,
    comparable_workouts_count: comparableSecondary.selected.length,
    eligible_workouts_count: input.primary.length + input.secondary.length,
    primary_eligible_count: input.primary.length,
    secondary_eligible_count: input.secondary.length,
    secondary_examples: secondaryExamples,
    funnel: input.funnel,
    top_exclusion_examples: input.exclusionExamples,
  };
}

function buildEvidenceItem(input: {
  label: "easy_run" | "long_run";
  primary: ComparableRun[];
  secondary: ComparableRun[];
  funnel: FunnelStageCounts;
  exclusionExamples: ExclusionExample[];
  minSample: number;
  comparisonMode: ComparisonModeInfo;
}): EvidenceItem {
  if (input.primary.length === 0 && input.secondary.length > 0) {
    return buildSecondaryOnlyEvidence(input);
  }

  const comparable = chooseComparableSubset(input.primary, input.minSample, input.comparisonMode);
  const cohorts = selectCohorts(comparable.selected, input.minSample, input.comparisonMode);
  const manualReviewNotes: string[] = [];
  const guardrailsApplied = [...comparable.guardrails];
  const secondaryExamples = input.secondary.slice(0, MAX_SECONDARY_EXAMPLES).map((run) =>
    toCandidateExample(run, "secondary_no_hr"),
  );

  input.funnel.comparable_primary = comparable.selected.length;
  if (input.secondary.length > 0) {
    manualReviewNotes.push(
      `${input.secondary.length} похожих пробежек без пульса не участвуют в основном сравнении.`,
    );
  }

  if (cohorts.baseline.length < input.minSample || cohorts.recent.length < input.minSample) {
    if (input.secondary.length > 0) {
      const secondaryEvidence = buildSecondaryOnlyEvidence(input);
      secondaryEvidence.manual_review_notes.push(
        ...manualReviewNotes,
        "После ужесточения сопоставимости primary-выборка стала слишком маленькой.",
      );
      return secondaryEvidence;
    }

    if (input.primary.length > 0 && comparable.selected.length !== input.primary.length) {
      manualReviewNotes.push("После ужесточения сопоставимости выборка стала слишком маленькой.");
    }
    return {
      status: "insufficient_data",
      confidence: "low",
      baseline_cohort: cohorts.baseline.length
        ? summarizeCohort("baseline", cohorts.baseline, cohorts.baselineWindow)
        : null,
      recent_cohort: cohorts.recent.length
        ? summarizeCohort("recent", cohorts.recent, cohorts.recentWindow)
        : null,
      delta: null,
      interpretation: "insufficient_data",
      representative_workouts: {
        baseline: [],
        recent: [],
      },
      guardrails_applied: guardrailsApplied,
      manual_review_notes: manualReviewNotes,
      summary: "Недостаточно сопоставимых тренировок.",
      comparable_workouts_count: comparable.selected.length,
      eligible_workouts_count: input.primary.length + input.secondary.length,
      primary_eligible_count: input.primary.length,
      secondary_eligible_count: input.secondary.length,
      secondary_examples: secondaryExamples,
      funnel: input.funnel,
      top_exclusion_examples: input.exclusionExamples,
    };
  }

  const baseline = summarizeCohort("baseline", cohorts.baseline, cohorts.baselineWindow);
  const recent = summarizeCohort("recent", cohorts.recent, cohorts.recentWindow);
  const delta = buildDelta(baseline, recent);
  const interpretation = interpretDelta(delta);

  const distanceDelta = Math.abs((delta.distance_change_km ?? 0));
  const elevationDelta = Math.abs((delta.elevation_gain_change ?? 0));
  const hrMissing =
    input.label === "easy_run" &&
    (baseline.median_hr === null || recent.median_hr === null);

  if (distanceDelta > 2.5) {
    guardrailsApplied.push("distance_mismatch_downgrade");
    manualReviewNotes.push("Сравниваются тренировки с заметно разной дистанцией.");
  }
  if (elevationDelta > 80) {
    guardrailsApplied.push("elevation_mismatch_downgrade");
    manualReviewNotes.push("Рельеф между когортами отличается.");
  }
  if (hrMissing) {
    guardrailsApplied.push("missing_hr_downgrade");
    manualReviewNotes.push("Для части лёгких пробежек нет надёжного HR.");
  }

  let status: EvidenceStatus = "found";
  let confidence: EvidenceConfidence =
    input.label === "easy_run" ? "high" : "medium";

  if (
    interpretation === "no_clear_progress" ||
    distanceDelta > 2.5 ||
    elevationDelta > 80 ||
    hrMissing
  ) {
    status = "needs_review";
    confidence = "low";
  } else if (
    input.label === "long_run" &&
    (cohorts.baseline.length < 3 || cohorts.recent.length < 3)
  ) {
    confidence = "medium";
  }

  let summary = "Недостаточно сопоставимых тренировок.";
  if (interpretation === "faster_at_same_or_lower_hr") {
    summary = "Есть хороший признак прогресса.";
  } else if (interpretation === "faster_but_higher_hr") {
    summary = "Похоже на прогресс по темпу, но нагрузка стала выше.";
  } else if (interpretation === "similar_pace_lower_hr") {
    summary = "Есть хороший признак прогресса: темп похожий, а пульс ниже.";
  } else if (interpretation === "no_clear_progress") {
    summary = "Явного сигнала прогресса по этой выборке нет.";
  }

  return {
    status,
    confidence,
    baseline_cohort: baseline,
    recent_cohort: recent,
    delta,
    interpretation,
    representative_workouts: {
      baseline: pickRepresentativeWorkouts(cohorts.baseline, baseline.median_pace_sec_per_km),
      recent: pickRepresentativeWorkouts(cohorts.recent, recent.median_pace_sec_per_km),
    },
    guardrails_applied: guardrailsApplied,
    manual_review_notes: manualReviewNotes,
    summary,
    comparable_workouts_count: comparable.selected.length,
    eligible_workouts_count: input.primary.length + input.secondary.length,
    primary_eligible_count: input.primary.length,
    secondary_eligible_count: input.secondary.length,
    secondary_examples: secondaryExamples,
    funnel: input.funnel,
    top_exclusion_examples: input.exclusionExamples,
  };
}

function createRacePlaceholder(eventsScanned: number): EvidenceItem {
  const note =
    eventsScanned > 0
      ? "Старты в диапазоне найдены, но прогресс по ним пока лучше смотреть отдельным probe."
      : "Интеграция прогресса по стартам вынесена в следующий этап.";
  const emptyFunnel = createEmptyFunnel(0);
  return {
    status: "needs_review",
    confidence: "low",
    baseline_cohort: null,
    recent_cohort: null,
    delta: null,
    interpretation: "insufficient_data",
    representative_workouts: { baseline: [], recent: [] },
    guardrails_applied: ["phase1_placeholder"],
    manual_review_notes: [
      "Для стартов используйте `npm run tp-probe-race-results -- --athlete-id=... --from=... --to=...`.",
      note,
    ],
    summary: "Прогресс по стартам пока вынесен в отдельный probe.",
    comparable_workouts_count: 0,
    eligible_workouts_count: 0,
    primary_eligible_count: 0,
    secondary_eligible_count: 0,
    secondary_examples: [],
    funnel: emptyFunnel,
    top_exclusion_examples: [],
  };
}

function manualReviewGroupKey(item: ManualReviewCandidate): string {
  if (item.workout_id !== null) return `w:${item.workout_id}`;
  return `d:${item.date ?? ""}|${item.title}`;
}

function extractManualReviewNoteSuffix(item: ManualReviewCandidate): string {
  const { date, title, note } = item;
  if (!note.trim()) return "";
  const dateTitle = date ? `${date} · ${title}` : title;
  if (note === dateTitle) return "";
  if (note.startsWith(`${dateTitle} · `)) return note.slice(`${dateTitle} · `.length);
  return note;
}

function splitManualReviewWarningTokens(value: string): string[] {
  if (!value.trim()) return [];
  return value
    .split(/,\s*/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function manualReviewReasonLabel(reason: string): string | null {
  const knownReasons = new Set([
    "ambiguous_race_like",
    "ambiguous_hard_classification",
    "gps_or_speed_anomaly",
    "speed_data_inconsistent",
    "indoor_ambiguity",
    "easy_title_hard_metrics",
    "long_title_short_metrics",
    "hard_cue_near_miss",
    "phase1_placeholder",
  ]);
  return knownReasons.has(reason) ? reason : null;
}

function collectMergedManualReviewWarnings(group: ManualReviewCandidate[]): string[] {
  const warnings = new Set<string>();
  for (const item of group) {
    for (const token of splitManualReviewWarningTokens(extractManualReviewNoteSuffix(item))) {
      warnings.add(token);
    }
  }
  if (warnings.size === 0) {
    for (const item of group) {
      const label = manualReviewReasonLabel(item.reason);
      if (label) warnings.add(label);
    }
  }
  return [...warnings];
}

function pickBestManualReviewRepresentative(group: ManualReviewCandidate[]): ManualReviewCandidate {
  return group.reduce((best, item) => {
    const bestCount = splitManualReviewWarningTokens(extractManualReviewNoteSuffix(best)).length;
    const itemCount = splitManualReviewWarningTokens(extractManualReviewNoteSuffix(item)).length;
    if (itemCount > bestCount) return item;
    if (itemCount < bestCount) return best;
    return item.reason.length > best.reason.length ? item : best;
  });
}

function buildManualReviewNote(
  date: string | null,
  title: string,
  warnings: string[],
): string {
  const warningText = warnings.join(", ");
  if (!date) return warningText ? `${title} · ${warningText}` : title;
  return warningText ? `${date} · ${title} · ${warningText}` : `${date} · ${title}`;
}

function normalizeManualReviewCandidates(items: ManualReviewCandidate[]): ManualReviewCandidate[] {
  const groups = new Map<string, ManualReviewCandidate[]>();
  for (const item of items) {
    const key = manualReviewGroupKey(item);
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }

  const normalized: ManualReviewCandidate[] = [];
  for (const group of groups.values()) {
    const warnings = collectMergedManualReviewWarnings(group);
    if (!warnings.length) continue;

    const representative = pickBestManualReviewRepresentative(group);
    normalized.push({
      ...representative,
      note: buildManualReviewNote(representative.date, representative.title, warnings),
    });
  }

  return normalized
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || a.title.localeCompare(b.title))
    .slice(0, MAX_MANUAL_REVIEW_CANDIDATES);
}

function formatManualReviewMarkdownLine(item: ManualReviewCandidate): string {
  const suffix = extractManualReviewNoteSuffix(item);
  const warnings = splitManualReviewWarningTokens(suffix);
  if (!warnings.length) return "";

  if (item.date) {
    return `- ${item.date} · ${item.title} · ${warnings.join(", ")}`;
  }
  if (suffix && suffix !== item.title) {
    return `- ${suffix}`;
  }
  return `- ${item.title} · ${warnings.join(", ")}`;
}

function buildEvidenceSummary(report: {
  easy: EvidenceItem;
  long: EvidenceItem;
  race: EvidenceItem;
}): string[] {
  const lines: string[] = [];
  if (report.easy.status === "found") {
    lines.push(`Лёгкий бег: ${report.easy.summary}`);
  } else if (report.easy.status === "needs_review") {
    lines.push(`Лёгкий бег: ${report.easy.summary}`);
  } else {
    lines.push("Лёгкий бег: недостаточно сопоставимых тренировок.");
  }

  if (report.long.status === "found") {
    lines.push(`Длинные: ${report.long.summary}`);
  } else if (report.long.status === "needs_review") {
    lines.push(`Длинные: ${report.long.summary}`);
  } else {
    lines.push("Длинные: недостаточно сопоставимых тренировок.");
  }

  lines.push("Старты: прогресс по стартам пока остаётся в отдельном probe.");
  return lines;
}

function formatCohortMiniSummary(cohort: CohortSummary | null): string {
  if (!cohort || cohort.n === 0) return "Недостаточно данных.";
  const periodLabel = cohort.window?.label ? ` (${cohort.window.label})` : "";
  return `n=${cohort.n}${periodLabel}, медианный темп ${formatPaceLabel(cohort.median_pace_sec_per_km)}, медианный HR ${formatHrLabel(cohort.median_hr)}`;
}

function formatExamplesTable(examples: CandidateExample[]): string[] {
  if (!examples.length) return [];
  const lines: string[] = [];
  lines.push("");
  lines.push("| Date | Title | Distance | Duration | Pace | HR | Reason |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | --- |");
  for (const example of examples.slice(0, 8)) {
    lines.push(
      `| ${example.date} | ${example.title.replace(/\|/g, "/")} | ${example.distance_km.toFixed(1)} km | ${example.duration_min.toFixed(0)} min | ${formatPaceLabel(example.pace_sec_per_km)} | ${formatHrLabel(example.avg_hr)} | ${example.reason} |`,
    );
  }
  return lines;
}

function appendEvidenceSection(
  lines: string[],
  title: string,
  evidence: EvidenceItem,
  comparisonMode: ComparisonModeInfo,
): void {
  lines.push(`## ${title}`);
  lines.push(`- ${evidence.summary}`);
  lines.push(`- Primary eligible: ${evidence.primary_eligible_count}, secondary: ${evidence.secondary_eligible_count}`);
  lines.push(`- Базовая когорта: ${formatCohortMiniSummary(evidence.baseline_cohort)}`);
  lines.push(`- Последняя когорта: ${formatCohortMiniSummary(evidence.recent_cohort)}`);
  if (evidence.delta) {
    lines.push(
      `- Изменение: темп ${formatSignedSeconds(evidence.delta.pace_change_sec_per_km)}, HR ${formatSignedBpm(evidence.delta.hr_change_bpm)}`,
    );
  }
  lines.push(`- ${comparisonMode.description}`);
  const coachNotes = evidence.manual_review_notes.filter(
    (note) => !note.startsWith("cohorts="),
  );
  if (coachNotes.length > 0) {
    for (const note of coachNotes) {
      lines.push(`- Важно: ${note}`);
    }
  }

  const showSecondaryNote =
    evidence.primary_eligible_count === 0 &&
    evidence.secondary_eligible_count > 0 &&
    evidence.status !== "found";
  if (showSecondaryNote) {
    lines.push(
      "- Недостаточно тренировок с пульсом для уверенного вывода.",
    );
    lines.push(
      "- Но есть несколько похожих лёгких пробежек без пульса/с неполными данными — их можно использовать только как слабый ориентир.",
    );
    lines.push(...formatExamplesTable(evidence.secondary_examples));
  } else if (evidence.secondary_examples.length > 0) {
    lines.push("- Поддерживающие примеры без пульса:");
    lines.push(...formatExamplesTable(evidence.secondary_examples));
  }
  lines.push("");
}

function createMarkdown(report: ProgressEvidenceReport): string {
  const athleteLabel = report.athlete.student_name ?? String(report.athlete.athlete_id);
  const lines: string[] = [];
  lines.push(`# Прогресс — ${athleteLabel}, ${report.range.from} → ${report.range.to}`);
  lines.push("");
  lines.push("## Период сравнения");
  const baselineLabel =
    report.comparison_mode.baseline_window?.label ??
    report.easy_run_progress.baseline_cohort?.window?.label ??
    report.long_run_progress.baseline_cohort?.window?.label ??
    "н/д";
  const recentLabel =
    report.comparison_mode.recent_window?.label ??
    report.easy_run_progress.recent_cohort?.window?.label ??
    report.long_run_progress.recent_cohort?.window?.label ??
    "н/д";
  lines.push(`- База: ${baselineLabel}`);
  lines.push(`- Сейчас: ${recentLabel}`);
  lines.push("");
  lines.push("## Где виден прогресс");
  for (const line of report.evidence_summary) {
    lines.push(`- ${line}`);
  }
  lines.push("");

  appendEvidenceSection(lines, "Лёгкий бег", report.easy_run_progress, report.comparison_mode);
  appendEvidenceSection(lines, "Длинные", report.long_run_progress, report.comparison_mode);

  lines.push("## Старты");
  lines.push(`- ${report.race_result_progress.summary}`);
  for (const note of report.race_result_progress.manual_review_notes) {
    lines.push(`- ${note}`);
  }
  lines.push("");

  lines.push("## Что проверить вручную");
  const manualReviewLines = report.manual_review_candidates
    .map((item) => formatManualReviewMarkdownLine(item))
    .filter(Boolean);
  if (!manualReviewLines.length) {
    lines.push("- Ничего критичного не отмечено.");
  } else {
    lines.push(...manualReviewLines);
  }
  lines.push("");

  lines.push("## Ограничения данных");
  for (const limitation of report.limitations) {
    lines.push(`- ${limitation}`);
  }

  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  const { comparisonMode } = args;
  const students = await readStudentsConfig();
  const target = resolveTarget(args, students);
  const runAt = new Date().toISOString();
  const commandUsed = `npm run tp-probe-progress-evidence -- ${process.argv.slice(2).join(" ")}`.trim();

  const workoutsEndpoint = `${TP_API_HOST}/fitness/v6/athletes/${target.athleteId}/workouts/${args.from}/${args.to}`;
  const eventsEndpoint = `${TP_API_HOST}/fitness/v6/athletes/${target.athleteId}/events/${args.from}/${args.to}`;

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: !args.headed,
    viewport: null,
    executablePath: resolveChromeExecutablePath(),
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const auth = await captureSessionAuth({ context, page, athleteId: target.athleteId });
    if (!auth.sampleRequestUrl && !auth.authorizationHeader) {
      throw new Error("Failed to capture TrainingPeaks auth/session (no API session context observed).");
    }

    const headers: Record<string, string> = {
      accept: "application/json, text/javascript, */*; q=0.01",
      "x-requested-with": "XMLHttpRequest",
    };
    if (auth.authorizationHeader) headers.authorization = auth.authorizationHeader;
    if (typeof auth.sampleHeaders.referer === "string" && auth.sampleHeaders.referer.trim()) {
      headers.referer = auth.sampleHeaders.referer;
    }
    if (typeof auth.sampleHeaders.origin === "string" && auth.sampleHeaders.origin.trim()) {
      headers.origin = auth.sampleHeaders.origin;
    }

    const workoutsResult = await performApiJsonRequest({
      page,
      method: "GET",
      endpoint: workoutsEndpoint,
      headers,
    });
    const eventsResult = await performApiJsonRequest({
      page,
      method: "GET",
      endpoint: eventsEndpoint,
      headers,
    });

    const workoutsApi: ApiFetchResult = {
      endpoint: workoutsEndpoint,
      status: workoutsResult.status,
      ok: workoutsResult.ok,
      count: Array.isArray(workoutsResult.body) ? workoutsResult.body.length : 0,
      error: workoutsResult.status === 200 ? null : `HTTP ${workoutsResult.status}`,
    };
    const eventsApi: ApiFetchResult = {
      endpoint: eventsEndpoint,
      status: eventsResult.status,
      ok: eventsResult.ok,
      count: 0,
      error: eventsResult.status === 200 ? null : `HTTP ${eventsResult.status}`,
    };

    if (workoutsResult.status !== 200 || !Array.isArray(workoutsResult.body)) {
      throw new Error(`TrainingPeaks workouts GET failed: status=${workoutsResult.status}`);
    }

    const parsedEvents =
      eventsResult.status === 200 ? parseEventsFromApi(eventsResult.body, args.from, args.to) : [];
    eventsApi.count = parsedEvents.length;

    const eventsByDate = new Map<string, ParsedEvent[]>();
    for (const event of parsedEvents) {
      const list = eventsByDate.get(event.event_date) ?? [];
      list.push(event);
      eventsByDate.set(event.event_date, list);
    }

    const rawItems = workoutsResult.body.filter((item): item is TrainingPeaksWorkoutRaw => isRecord(item));
    const normalizedItems = normalizeTrainingPeaksWorkoutItems({
      athleteId: target.athleteId,
      rawItems,
    });
    const inRangeItems = normalizedItems.filter(
      (item) => item.workoutDate >= args.from && item.workoutDate <= args.to,
    );

    const rawByWorkoutId = new Map<number, TrainingPeaksWorkoutRaw>();
    for (const raw of rawItems) {
      const workoutId = toPositiveInt(raw.workoutId);
      if (workoutId && !rawByWorkoutId.has(workoutId)) rawByWorkoutId.set(workoutId, raw);
    }

    const fieldPresence = new Map<FieldName, number>();
    const trackedFields: FieldName[] = [
      "distance",
      "totalTime",
      "heartRateAverage",
      "heartRateMinimum",
      "heartRateMaximum",
      "velocityAverage",
      "velocityMaximum",
      "normalizedSpeedActual",
      "elevationGain",
      "if",
      "tssActual",
      "description",
      "coachComments",
      "workoutComments",
      "workoutDeviceSource",
      "syncedTo",
      "personalRecordCount",
      "raceTypeDuration",
    ];
    const trackField = (name: FieldName, present: boolean): void => {
      if (!fieldPresence.has(name)) fieldPresence.set(name, 0);
      if (present) fieldPresence.set(name, (fieldPresence.get(name) ?? 0) + 1);
    };

    const runningComparableRuns: ComparableRun[] = [];
    let runningWorkoutsCount = 0;
    let completedRunningCount = 0;

    for (const item of inRangeItems) {
      const raw = rawByWorkoutId.get(item.trainingPeaksWorkoutId);
      if (!raw) continue;

      trackField("distance", raw.distance !== null && raw.distance !== undefined);
      trackField("totalTime", raw.totalTime !== null && raw.totalTime !== undefined);
      trackField("heartRateAverage", raw.heartRateAverage !== null && raw.heartRateAverage !== undefined);
      trackField("heartRateMinimum", raw.heartRateMinimum !== null && raw.heartRateMinimum !== undefined);
      trackField("heartRateMaximum", raw.heartRateMaximum !== null && raw.heartRateMaximum !== undefined);
      trackField("velocityAverage", raw.velocityAverage !== null && raw.velocityAverage !== undefined);
      trackField("velocityMaximum", raw.velocityMaximum !== null && raw.velocityMaximum !== undefined);
      trackField(
        "normalizedSpeedActual",
        raw.normalizedSpeedActual !== null && raw.normalizedSpeedActual !== undefined,
      );
      trackField("elevationGain", raw.elevationGain !== null && raw.elevationGain !== undefined);
      trackField("if", raw.if !== null && raw.if !== undefined);
      trackField("tssActual", raw.tssActual !== null && raw.tssActual !== undefined);
      trackField("description", typeof raw.description === "string" && Boolean(raw.description.trim()));
      trackField("coachComments", typeof raw.coachComments === "string" && Boolean(raw.coachComments.trim()));
      trackField("workoutComments", typeof raw.workoutComments === "string" && Boolean(raw.workoutComments.trim()));
      trackField(
        "workoutDeviceSource",
        raw.workoutDeviceSource !== null && raw.workoutDeviceSource !== undefined,
      );
      trackField("syncedTo", raw.syncedTo !== null && raw.syncedTo !== undefined);
      trackField("personalRecordCount", raw.personalRecordCount !== null && raw.personalRecordCount !== undefined);
      trackField("raceTypeDuration", raw.raceTypeDuration !== null && raw.raceTypeDuration !== undefined);

      const classification = classifyTrainingPeaksWorkoutActivity({
        title: typeof raw.title === "string" ? raw.title : null,
        sportOrTypeCode: typeof raw.code === "string" ? raw.code : null,
        workoutTypeValueId: toFiniteNumber(raw.workoutTypeValueId),
        workoutSubTypeId: toFiniteNumber(raw.workoutSubTypeId),
        sourceSnapshot: raw,
      });
      if (!classification.isRunning) continue;
      runningWorkoutsCount += 1;
      if (!item.isCompleted) continue;
      completedRunningCount += 1;

      const comparable = toComparableRun({
        raw,
        athleteId: target.athleteId,
        eventsByDate,
      });
      if (comparable) runningComparableRuns.push(comparable);
    }

    const nonRaceCompletedRuns = runningComparableRuns.filter((run) => !run.raceLike);
    const longDistanceThresholdKm = Math.max(
      14,
      Number((quantile(nonRaceCompletedRuns.map((run) => run.distanceKm), 0.75) ?? 14).toFixed(1)),
    );

    const easySelection = selectEasyCandidates({
      totalWorkouts: inRangeItems.length,
      runningWorkouts: runningWorkoutsCount,
      completedRunning: completedRunningCount,
      runs: runningComparableRuns,
    });
    const longSelection = selectLongCandidates({
      totalWorkouts: inRangeItems.length,
      runningWorkouts: runningWorkoutsCount,
      completedRunning: completedRunningCount,
      runs: runningComparableRuns,
      longDistanceThresholdKm,
    });

    const manualReviewSeed: ManualReviewCandidate[] = [
      ...easySelection.manualReview,
      ...longSelection.manualReview,
    ];

    const easyEvidence = buildEvidenceItem({
      label: "easy_run",
      primary: easySelection.primary,
      secondary: easySelection.secondary,
      funnel: easySelection.funnel,
      exclusionExamples: easySelection.exclusionExamples,
      minSample: EASY_MIN_SAMPLE,
      comparisonMode,
    });
    const longEvidence = buildEvidenceItem({
      label: "long_run",
      primary: longSelection.primary,
      secondary: longSelection.secondary,
      funnel: longSelection.funnel,
      exclusionExamples: longSelection.exclusionExamples,
      minSample: LONG_MIN_SAMPLE,
      comparisonMode,
    });
    const raceEvidence = createRacePlaceholder(parsedEvents.length);

    manualReviewSeed.push({
      category: "race_result_progress",
      date: null,
      title: "Старты",
      workout_id: null,
      reason: "phase1_placeholder",
      note: "Интеграция прогресса по стартам пока вынесена в отдельный probe.",
    });

    const fieldsAvailable = trackedFields.filter((name) => (fieldPresence.get(name) ?? 0) > 0).sort();
    const fieldsMissing = trackedFields.filter((name) => (fieldPresence.get(name) ?? 0) === 0).sort();

    const timestamp = timestampForPath(new Date(runAt));
    const outputDir = path.join(toolRoot, "debug", "progress-evidence", String(target.athleteId), timestamp);
    await mkdir(outputDir, { recursive: true });
    const reportJsonPath = path.join(outputDir, "report.json");
    const reportMdPath = path.join(outputDir, "report.md");

    const evidenceSummary = buildEvidenceSummary({
      easy: easyEvidence,
      long: longEvidence,
      race: raceEvidence,
    });

    const resolvedComparisonMode: ComparisonModeInfo =
      comparisonMode.mode === "range_auto"
        ? {
            ...comparisonMode,
            baseline_window:
              easyEvidence.baseline_cohort?.window ??
              longEvidence.baseline_cohort?.window ??
              null,
            recent_window:
              easyEvidence.recent_cohort?.window ??
              longEvidence.recent_cohort?.window ??
              null,
          }
        : comparisonMode;

    const report: ProgressEvidenceReport = {
      run_at: runAt,
      athlete: {
        athlete_id: target.athleteId,
        athlete_url: target.athleteUrl,
        student_id: target.studentId,
        student_name: target.studentName,
      },
      comparison_mode: resolvedComparisonMode,
      range: { from: args.from, to: args.to },
      data_sources: {
        workouts: workoutsApi,
        events: eventsApi,
      },
      fields_available: fieldsAvailable,
      fields_missing: fieldsMissing,
      evidence_summary: evidenceSummary,
      easy_run_progress: easyEvidence,
      long_run_progress: longEvidence,
      race_result_progress: raceEvidence,
      manual_review_candidates: normalizeManualReviewCandidates(manualReviewSeed),
      easy_run_funnel: easyEvidence.funnel,
      long_run_funnel: longEvidence.funnel,
      top_exclusion_examples: {
        easy_run: easyEvidence.top_exclusion_examples,
        long_run: longEvidence.top_exclusion_examples,
      },
      limitations: [
        "Это read-only probe без мутаций TrainingPeaks и без записей в Supabase.",
        "Сравнение строится по медианам когорт, а не по одной тренировке.",
        "Интервалы, темпо и разбор FIT/Workout Files в этот этап не входят.",
        "Тредмил/indoor стараемся не смешивать с outdoor; при нехватке выборки уверенность снижается.",
        "Пробежки без пульса могут использоваться только как слабые ориентиры, не как основной вывод.",
        "Прогресс по стартам пока лучше смотреть отдельно через `tp-probe-race-results`.",
      ],
      workouts_scanned: inRangeItems.length,
      output_paths: {
        report_json: reportJsonPath,
        report_md: reportMdPath,
      },
    };

    await writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await writeFile(reportMdPath, createMarkdown(report), "utf8");

    console.log("[tp-probe-progress-evidence] Summary");
    console.log(`command_used: ${commandUsed}`);
    console.log(`athlete_id: ${target.athleteId}`);
    console.log(`comparison_mode: ${comparisonMode.mode}`);
    console.log(`range: ${args.from} -> ${args.to}`);
    if (comparisonMode.baseline_window) {
      console.log(
        `baseline_window: ${comparisonMode.baseline_window.from} -> ${comparisonMode.baseline_window.to} (${comparisonMode.baseline_window.label})`,
      );
    }
    if (comparisonMode.recent_window) {
      console.log(
        `recent_window: ${comparisonMode.recent_window.from} -> ${comparisonMode.recent_window.to} (${comparisonMode.recent_window.label})`,
      );
    }
    console.log(`comparison_description: ${comparisonMode.description}`);
    console.log(`workouts_scanned: ${report.workouts_scanned}`);
    console.log(`running_workouts_scanned: ${runningComparableRuns.length}`);
    console.log(`easy_run_funnel: ${JSON.stringify(easyEvidence.funnel)}`);
    console.log(`long_run_funnel: ${JSON.stringify(longEvidence.funnel)}`);
    console.log(`easy_run_primary_eligible: ${easyEvidence.primary_eligible_count}`);
    console.log(`easy_run_secondary_eligible: ${easyEvidence.secondary_eligible_count}`);
    console.log(`long_run_primary_eligible: ${longEvidence.primary_eligible_count}`);
    console.log(`long_run_secondary_eligible: ${longEvidence.secondary_eligible_count}`);
    console.log(`manual_review_candidates: ${report.manual_review_candidates.length}`);
    console.log(`easy_run_progress_verdict: ${easyEvidence.status} | ${easyEvidence.confidence} | ${easyEvidence.summary}`);
    console.log(`long_run_progress_verdict: ${longEvidence.status} | ${longEvidence.confidence} | ${longEvidence.summary}`);
    console.log(`events_scanned: ${parsedEvents.length}`);
    console.log(`report_json: ${reportJsonPath}`);
    console.log(`report_md: ${reportMdPath}`);
  } finally {
    await context.close().catch(() => {});
  }
}

main().catch((error: unknown) => {
  console.error("tp-probe-progress-evidence failed.");
  console.error(error);
  process.exit(1);
});
