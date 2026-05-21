import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { parsedRoot, toolRoot } from "./lib/paths.ts";
import {
  DISTANCE_PRESETS,
  formatDurationFromSeconds,
  formatDurationText,
  formatPaceText,
  isDistanceKey,
  paceMinPerKmToSeconds,
  parseDurationToSeconds,
  type DistanceKey,
} from "./lib/race-distance.ts";
import { readStudentsConfig, type StudentConfig } from "./lib/students.ts";

const PROBE_STALE_DAYS = 14;

type ConfidenceLevel = "high" | "medium" | "low";

type CliArgs = {
  student: string | null;
  athleteId: number | null;
  athleteUrl: string | null;
  raceDate: string;
  distance: DistanceKey;
  weeks: number;
  from: string | null;
  to: string | null;
  raceName: string | null;
  targetTime: string | null;
  noAi: boolean;
  includeReviewAnchors: boolean;
};

type ResolvedTarget = {
  athleteId: number;
  athleteUrl: string;
  studentId: string;
  studentName: string;
};

type WeekRange = { from: string; to: string };

type WeeklySummaryWorkout = {
  date: string | null;
  title: string | null;
  sport: string | null;
  distance_km: number | null;
  completed_duration_minutes: number | null;
  avg_pace_min_per_km: number | null;
  avg_pace_text: string | null;
  intensity_flags: string[];
  data_warnings: string[];
  classification: {
    type: string;
    is_planned: boolean;
    is_completed: boolean;
    is_skipped: boolean;
  };
  planned: { description: string | null; coach_comments: string | null };
  completed: {
    detail_source: { type: string; match_status: string };
  };
};

type WeeklySummary = {
  schema_version: string;
  student_id: string;
  week: WeekRange;
  segment_analysis: {
    available: boolean;
    reason: string;
    workouts_with_matched_fit: number;
  };
  totals: {
    completed_workouts_count: number;
    total_distance_km: number | null;
  };
  week_metrics: {
    plan_vs_fact: { completion_rate: number | null };
    counts: {
      planned_completed: number;
      planned_skipped: number;
      extra_completed: number;
    };
    data_quality: { warnings: string[] };
  };
  workouts: WeeklySummaryWorkout[];
};

type RaceResultCandidate = {
  workoutId: number;
  date: string;
  title: string | null;
  distance_bucket: DistanceKey;
  distance_km: number;
  duration_min: number;
  duration_text: string;
  pace_min_per_km: number;
  pace_text: string;
  display_class?: string;
  result_status?: string;
  data_quality_status?: string;
  warnings?: string[];
  same_day_event?: boolean;
  event_name?: string | null;
};

type RaceResultsProbeReport = {
  run_at: string;
  athlete: {
    athlete_id: number;
    student_id: string | null;
    student_name: string | null;
  };
  distance_results: Partial<
    Record<
      DistanceKey,
      {
        official_best: RaceResultCandidate | null;
        official_flagged: RaceResultCandidate | null;
        probable_best: RaceResultCandidate | null;
        clean_training_best: RaceResultCandidate | null;
        candidates: RaceResultCandidate[];
      }
    >
  >;
  manual_review_candidates?: Array<{
    distance_bucket: DistanceKey;
    date: string;
    workoutId: number;
    display_class?: string;
    result_status?: string;
    data_quality_status?: string;
    pace_text: string;
    duration_text: string;
    title: string | null;
  }>;
};

type ProgressEvidenceReport = {
  run_at: string;
  easy_run_progress: {
    status: string;
    confidence: ConfidenceLevel;
    interpretation: string;
    summary: string;
    delta: { pace_change_sec_per_km: number | null; hr_change_bpm: number | null } | null;
  };
  long_run_progress: {
    status: string;
    confidence: ConfidenceLevel;
    interpretation: string;
    summary: string;
    delta: { pace_change_sec_per_km: number | null } | null;
  };
  limitations: string[];
};

type AnchorKind =
  | "official_best"
  | "official_flagged"
  | "probable_best"
  | "clean_training_best"
  | "needs_coach_review";

type SelectedAnchor = {
  kind: AnchorKind;
  candidate: RaceResultCandidate;
  confidence_weight: number;
};

type PredictionScenario = {
  time_text: string;
  pace_text: string;
  seconds: number;
};

type RacePredictionReport = {
  schema_version: "race-prediction.v1";
  run_at: string;
  athlete: {
    student_id: string;
    student_name: string;
    athlete_id: number;
  };
  race: {
    date: string;
    distance: DistanceKey;
    distance_km: number;
    name: string | null;
    days_until_race: number;
  };
  window: {
    from: string;
    to: string;
    weeks_requested: number;
    weeks_found: number;
    weeks_missing: number;
  };
  data_sources: {
    weekly_summaries: Array<{ from: string; to: string; path: string | null; found: boolean }>;
    race_results_probe: { path: string | null; run_at: string | null; stale: boolean };
    progress_evidence_probe: { path: string | null; run_at: string | null; stale: boolean };
    fit_weeks_count: number;
    workout_files_present_weeks: number;
  };
  features: {
    weekly_volume: Array<{ week: WeekRange; running_km: number | null; completed_workouts: number }>;
    long_runs: Array<{
      date: string;
      title: string | null;
      distance_km: number;
      duration_text: string;
      pace_text: string;
      week: WeekRange;
    }>;
    key_workouts: Array<{
      category: "tempo_threshold" | "intervals" | "race_pace_like" | "long_run";
      date: string;
      title: string | null;
      distance_km: number | null;
      duration_text: string | null;
      pace_text: string | null;
      week: WeekRange;
    }>;
    missed_workouts_count: number;
    taper: {
      last_days: number;
      recent_km: number | null;
      prior_3w_median_km: number | null;
      ratio: number | null;
      signal: "taper_detected" | "flat" | "volume_spike" | "insufficient_data";
    };
    data_quality: {
      warnings: string[];
      suspicious_weeks: number;
      fit_coverage_weeks: number;
    };
  };
  anchors: {
    target_distance: {
      primary: SelectedAnchor | null;
      alternates: SelectedAnchor[];
      excluded_for_review: SelectedAnchor[];
    };
    cross_distance: SelectedAnchor[];
  };
  prediction: {
    conservative: PredictionScenario;
    likely: PredictionScenario;
    optimistic: PredictionScenario;
    confidence: ConfidenceLevel;
    confidence_score: number;
    confidence_reasons: string[];
    method: "deterministic_v1";
    target_time_hint_used: boolean;
  };
  limitations: string[];
  output_paths: {
    report_json: string;
    report_md: string;
  };
};

const TEMPO_PATTERN =
  /\b(tempo|threshold|порог|темпов|темповая|темповый|темповой|lactate|lt\b|critical power)\b/i;
const INTERVAL_PATTERN =
  /\b(interval|intervals|интерв|повтор|repeats?|fartlek|фартлек|vo2|ускорен|track)\b|\d+\s*[x×хX]\s*\d+/i;
const RACE_PACE_PATTERN =
  /\b(race pace|goal pace|целевой темп|темп старта|темп гонки|marathon pace|half marathon pace|10k pace|5k pace)\b/i;
const LONG_RUN_PATTERN = /\b(long run|long\b|длительн|длинн|lsd|продолжительн)\b/i;
const RUNNING_SPORT_PATTERN = /\b(run|running|бег|jog)\b/i;

function readTextFileSyncSafe(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const start = new Date(`${from}T12:00:00Z`).getTime();
  const end = new Date(`${to}T12:00:00Z`).getTime();
  return Math.round((end - start) / (24 * 60 * 60 * 1000));
}

function getWeekStartMonday(isoDate: string): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(isoDate, diff);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
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

function timestampForPath(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    student: null,
    athleteId: null,
    athleteUrl: null,
    raceDate: "",
    distance: "10k",
    weeks: 8,
    from: null,
    to: null,
    raceName: null,
    targetTime: null,
    noAi: true,
    includeReviewAnchors: false,
  };

  let targetCount = 0;

  for (const arg of argv) {
    if (arg.startsWith("--student=")) {
      parsed.student = arg.slice("--student=".length).trim();
      targetCount += 1;
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
    if (arg.startsWith("--race-date=")) {
      parsed.raceDate = arg.slice("--race-date=".length).trim();
      continue;
    }
    if (arg.startsWith("--distance=")) {
      const distance = arg.slice("--distance=".length).trim().toLowerCase();
      if (!isDistanceKey(distance)) {
        throw new Error(`Unknown --distance "${distance}". Supported: 5k, 10k, half, marathon`);
      }
      parsed.distance = distance;
      continue;
    }
    if (arg.startsWith("--weeks=")) {
      const weeks = Number(arg.slice("--weeks=".length).trim());
      if (!Number.isInteger(weeks) || weeks <= 0) {
        throw new Error(`Invalid --weeks value: ${arg}`);
      }
      parsed.weeks = weeks;
      continue;
    }
    if (arg.startsWith("--from=")) {
      parsed.from = arg.slice("--from=".length).trim();
      continue;
    }
    if (arg.startsWith("--to=")) {
      parsed.to = arg.slice("--to=".length).trim();
      continue;
    }
    if (arg.startsWith("--race-name=")) {
      parsed.raceName = arg.slice("--race-name=".length).trim() || null;
      continue;
    }
    if (arg.startsWith("--target-time=")) {
      parsed.targetTime = arg.slice("--target-time=".length).trim() || null;
      continue;
    }
    if (arg === "--no-ai") {
      parsed.noAi = true;
      continue;
    }
    if (arg === "--ai") {
      parsed.noAi = false;
      continue;
    }
    if (arg === "--include-review-anchors") {
      parsed.includeReviewAnchors = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (targetCount === 0) {
    throw new Error("Exactly one target is required: --student or --athlete-id (or --athlete-url).");
  }
  if (targetCount > 1) {
    throw new Error("Ambiguous target: provide only one of --student, --athlete-id, or --athlete-url.");
  }
  if (!isIsoDate(parsed.raceDate)) {
    throw new Error(`Missing or invalid --race-date: "${parsed.raceDate}". Expected YYYY-MM-DD.`);
  }
  if (parsed.from && !isIsoDate(parsed.from)) {
    throw new Error(`Invalid --from date: "${parsed.from}".`);
  }
  if (parsed.to && !isIsoDate(parsed.to)) {
    throw new Error(`Invalid --to date: "${parsed.to}".`);
  }
  if (parsed.from && parsed.to && parsed.from > parsed.to) {
    throw new Error(`Invalid range: --from (${parsed.from}) is after --to (${parsed.to}).`);
  }
  if (parsed.noAi === false) {
    throw new Error("AI mode is not implemented in Phase 1. Use --no-ai (default).");
  }

  return parsed;
}

function resolveTarget(args: CliArgs, students: StudentConfig[]): ResolvedTarget {
  const studentNeedle = args.student?.trim().toLowerCase() ?? null;
  const athleteIdFromUrl = args.athleteUrl ? parseAthleteIdFromUrl(args.athleteUrl) : null;
  const resolvedAthleteId = args.athleteId ?? athleteIdFromUrl;
  const normalizedAthleteUrl = args.athleteUrl ? normalizeUrl(args.athleteUrl) : null;

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
    throw new Error(`Multiple students matched target. Matches: ${sample.join(", ")}`);
  }

  const matched = matchedStudents[0] ?? null;
  const athleteId = resolvedAthleteId ?? (matched ? parseAthleteIdFromUrl(matched.trainingpeaks_athlete_url) : null);
  if (!athleteId) {
    throw new Error("Could not resolve TrainingPeaks athlete id from target arguments.");
  }

  return {
    athleteId,
    athleteUrl: args.athleteUrl ?? matched?.trainingpeaks_athlete_url ?? "",
    studentId: matched?.student_id ?? args.student ?? `athlete-${athleteId}`,
    studentName: matched?.name ?? matched?.student_id ?? args.student ?? String(athleteId),
  };
}

function buildPrepWindow(input: {
  raceDate: string;
  weeks: number;
  fromOverride: string | null;
  toOverride: string | null;
}): { from: string; to: string; weekRanges: WeekRange[] } {
  if (input.fromOverride && input.toOverride) {
    const weekRanges: WeekRange[] = [];
    let weekEnd = input.toOverride;
    for (let index = 0; index < input.weeks; index += 1) {
      const weekStart = addDays(weekEnd, -6);
      if (weekEnd < input.fromOverride) break;
      weekRanges.unshift({ from: weekStart, to: weekEnd });
      weekEnd = addDays(weekStart, -1);
    }
    return { from: input.fromOverride, to: input.toOverride, weekRanges };
  }

  const raceWeekMonday = getWeekStartMonday(input.raceDate);
  const prepTo = addDays(raceWeekMonday, -1);
  const prepFrom = addDays(prepTo, -(input.weeks * 7 - 1));
  const weekRanges = enumerateWeeksEndingOn(prepTo, input.weeks);
  return { from: prepFrom, to: prepTo, weekRanges };
}

function enumerateWeeksEndingOn(weekEndingSunday: string, count: number): WeekRange[] {
  const weeks: WeekRange[] = [];
  let weekEnd = weekEndingSunday;
  for (let index = 0; index < count; index += 1) {
    const weekStart = addDays(weekEnd, -6);
    weeks.unshift({ from: weekStart, to: weekEnd });
    weekEnd = addDays(weekStart, -1);
  }
  return weeks;
}

function weeklySummaryPath(studentId: string, week: WeekRange): string {
  return path.join(parsedRoot, studentId, `${week.from}_${week.to}`, "weekly-summary.json");
}

async function loadWeeklySummary(studentId: string, week: WeekRange): Promise<WeeklySummary | null> {
  const summaryPath = weeklySummaryPath(studentId, week);
  if (!existsSync(summaryPath)) return null;
  const raw = await readFile(summaryPath, "utf8");
  return JSON.parse(raw) as WeeklySummary;
}

function isRunningWorkout(workout: WeeklySummaryWorkout): boolean {
  const sport = (workout.sport ?? "").toLowerCase();
  if (RUNNING_SPORT_PATTERN.test(sport)) return true;
  const title = (workout.title ?? "").toLowerCase();
  return RUNNING_SPORT_PATTERN.test(title);
}

function collectWorkoutText(workout: WeeklySummaryWorkout): string {
  return [
    workout.title,
    workout.planned.description,
    workout.planned.coach_comments,
  ]
    .filter(Boolean)
    .join(" ");
}

function classifyKeyWorkout(
  workout: WeeklySummaryWorkout,
): "tempo_threshold" | "intervals" | "race_pace_like" | "long_run" | null {
  if (!workout.classification.is_completed || !isRunningWorkout(workout)) return null;
  const text = collectWorkoutText(workout);
  if (workout.intensity_flags.includes("long_run") || LONG_RUN_PATTERN.test(text)) {
    return "long_run";
  }
  if (INTERVAL_PATTERN.test(text)) return "intervals";
  if (TEMPO_PATTERN.test(text)) return "tempo_threshold";
  if (RACE_PACE_PATTERN.test(text)) return "race_pace_like";
  return null;
}

function isLongRunWorkout(workout: WeeklySummaryWorkout): boolean {
  if (!workout.classification.is_completed || !isRunningWorkout(workout)) return false;
  if (workout.intensity_flags.includes("long_run")) return true;
  const distance = workout.distance_km ?? 0;
  const duration = workout.completed_duration_minutes ?? 0;
  if (distance >= 16 || duration >= 80) return true;
  return LONG_RUN_PATTERN.test(collectWorkoutText(workout));
}

function findLatestProbeReport<T>(baseDir: string, athleteId: number): {
  path: string | null;
  report: T | null;
  runAt: string | null;
  stale: boolean;
} {
  const athleteDir = path.join(baseDir, String(athleteId));
  if (!existsSync(athleteDir)) {
    return { path: null, report: null, runAt: null, stale: true };
  }

  const timestamps = readdirSync(athleteDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();

  for (const timestamp of timestamps) {
    const reportPath = path.join(athleteDir, timestamp, "report.json");
    if (!existsSync(reportPath)) continue;
    const raw = readTextFileSyncSafe(reportPath);
    if (!raw) continue;
    const report = JSON.parse(raw) as T & { run_at?: string };
    const runAt = typeof report.run_at === "string" ? report.run_at : null;
    const stale =
      runAt === null
        ? true
        : daysBetween(runAt.slice(0, 10), new Date().toISOString().slice(0, 10)) > PROBE_STALE_DAYS;
    return { path: reportPath, report, runAt, stale };
  }

  return { path: null, report: null, runAt: null, stale: true };
}

function anchorWeight(kind: AnchorKind): number {
  switch (kind) {
    case "official_best":
      return 1.0;
    case "official_flagged":
      return 0.9;
    case "probable_best":
      return 0.82;
    case "clean_training_best":
      return 0.55;
    case "needs_coach_review":
      return 0.45;
    default:
      return 0.5;
  }
}

function candidateToAnchor(kind: AnchorKind, candidate: RaceResultCandidate): SelectedAnchor {
  return {
    kind,
    candidate,
    confidence_weight: anchorWeight(kind),
  };
}

function isUsableAnchor(candidate: RaceResultCandidate, includeReview: boolean): boolean {
  if (candidate.data_quality_status === "excluded") return false;
  if (candidate.result_status === "excluded") return false;
  if (candidate.display_class === "excluded") return false;
  if (!includeReview) {
    if (candidate.result_status === "needs_coach_review") return false;
    if (candidate.display_class === "manual_review") return false;
  }
  return true;
}

function selectAnchorsFromRaceProbe(
  report: RaceResultsProbeReport | null,
  distance: DistanceKey,
  includeReviewAnchors: boolean,
): {
  primary: SelectedAnchor | null;
  alternates: SelectedAnchor[];
  excludedForReview: SelectedAnchor[];
  crossDistance: SelectedAnchor[];
} {
  if (!report) {
    return { primary: null, alternates: [], excludedForReview: [], crossDistance: [] };
  }

  const bucket = report.distance_results[distance];
  const excludedForReview: SelectedAnchor[] = [];
  const alternates: SelectedAnchor[] = [];

  const ordered: Array<{ kind: AnchorKind; candidate: RaceResultCandidate | null | undefined }> = [
    { kind: "official_best", candidate: bucket?.official_best },
    { kind: "official_flagged", candidate: bucket?.official_flagged },
    { kind: "probable_best", candidate: bucket?.probable_best },
    { kind: "clean_training_best", candidate: bucket?.clean_training_best },
  ];

  let primary: SelectedAnchor | null = null;
  for (const entry of ordered) {
    if (!entry.candidate) continue;
    if (!isUsableAnchor(entry.candidate, includeReviewAnchors)) {
      if (
        entry.candidate.result_status === "needs_coach_review" ||
        entry.candidate.display_class === "manual_review"
      ) {
        excludedForReview.push(candidateToAnchor("needs_coach_review", entry.candidate));
      }
      continue;
    }
    const anchor = candidateToAnchor(entry.kind, entry.candidate);
    if (!primary) {
      primary = anchor;
    } else {
      alternates.push(anchor);
    }
  }

  if (includeReviewAnchors) {
    for (const row of report.manual_review_candidates ?? []) {
      if (row.distance_bucket !== distance) continue;
      if (row.data_quality_status === "excluded") continue;
      const candidate: RaceResultCandidate = {
        workoutId: row.workoutId,
        date: row.date,
        title: row.title,
        distance_bucket: row.distance_bucket,
        distance_km: 0,
        duration_min: 0,
        duration_text: row.duration_text,
        pace_min_per_km: 0,
        pace_text: row.pace_text,
        display_class: row.display_class,
        result_status: row.result_status,
        data_quality_status: row.data_quality_status,
      };
      const paceMatch = row.pace_text.match(/(\d+):(\d+)/);
      if (paceMatch) {
        candidate.pace_min_per_km = Number(paceMatch[1]) + Number(paceMatch[2]) / 60;
      }
      const durationMatch = row.duration_text.match(/(?:(\d+):)?(\d+):(\d+)/) ?? row.duration_text.match(/(\d+):(\d+)/);
      if (durationMatch) {
        const seconds = parseDurationToSeconds(row.duration_text);
        if (seconds !== null) candidate.duration_min = seconds / 60;
      }
      excludedForReview.push(candidateToAnchor("needs_coach_review", candidate));
    }
  }

  const crossDistance: SelectedAnchor[] = [];
  for (const [key, otherBucket] of Object.entries(report.distance_results)) {
    if (key === distance || !otherBucket) continue;
    const candidate =
      otherBucket.official_best ??
      otherBucket.probable_best ??
      otherBucket.clean_training_best ??
      null;
    if (!candidate || !isUsableAnchor(candidate, includeReviewAnchors)) continue;
    const kind: AnchorKind = otherBucket.official_best
      ? "official_best"
      : otherBucket.probable_best
        ? "probable_best"
        : "clean_training_best";
    crossDistance.push(candidateToAnchor(kind, candidate));
  }

  return { primary, alternates, excludedForReview, crossDistance };
}

function buildScenario(seconds: number, distanceKm: number): PredictionScenario {
  const paceMinPerKm = seconds / 60 / distanceKm;
  return {
    seconds,
    time_text: formatDurationFromSeconds(seconds),
    pace_text: formatPaceText(paceMinPerKm),
  };
}

function computePrediction(input: {
  distance: DistanceKey;
  anchor: SelectedAnchor | null;
  targetTimeSeconds: number | null;
  completionRates: number[];
  missedWorkouts: number;
  weeksFound: number;
  weeksRequested: number;
  keyWorkoutsFound: number;
  progressPositive: boolean;
  dataWarnings: string[];
  taperSignal: RacePredictionReport["features"]["taper"]["signal"];
}): {
  prediction: RacePredictionReport["prediction"];
  limitations: string[];
} {
  const preset = DISTANCE_PRESETS[input.distance];
  const limitations: string[] = [];
  const confidenceReasons: string[] = [];
  let confidenceScore = 50;

  let baseSeconds: number;
  if (input.anchor) {
    baseSeconds = paceMinPerKmToSeconds(
      input.anchor.candidate.pace_min_per_km,
      preset.target_km,
    );
    confidenceScore += Math.round(input.anchor.confidence_weight * 25);
    confidenceReasons.push(
      `Опорный результат: ${input.anchor.kind} (${input.anchor.candidate.date}, ${input.anchor.candidate.pace_text}).`,
    );
    if (input.anchor.kind === "clean_training_best") {
      limitations.push("Опора — тренировочный ориентир, не официальный старт.");
      confidenceScore -= 8;
    }
    if (input.anchor.candidate.data_quality_status === "suspicious") {
      limitations.push("Опорный результат помечен как suspicious в race-results probe.");
      confidenceScore -= 12;
    }
  } else {
    baseSeconds = paceMinPerKmToSeconds(6.0, preset.target_km);
    limitations.push("Нет надёжного результата на целевой дистанции — использован широкий базовый ориентир.");
    confidenceScore -= 25;
    confidenceReasons.push("Опорный результат на целевой дистанции не найден.");
  }

  if (input.targetTimeSeconds !== null) {
    baseSeconds = Math.round(baseSeconds * 0.7 + input.targetTimeSeconds * 0.3);
    confidenceReasons.push("Учтён --target-time как мягкая подсказка (30% веса).");
  }

  let spreadConservative = 0.05;
  let spreadOptimistic = 0.035;

  if (!input.anchor || input.anchor.confidence_weight < 0.7) {
    spreadConservative += 0.04;
    spreadOptimistic += 0.025;
  }
  if (input.weeksFound < input.weeksRequested) {
    const missing = input.weeksRequested - input.weeksFound;
    spreadConservative += Math.min(0.08, missing * 0.012);
    spreadOptimistic += Math.min(0.04, missing * 0.006);
    limitations.push(`Не хватает ${missing} недель parsed weekly-summary.`);
    confidenceScore -= missing * 4;
    confidenceReasons.push(`Найдено ${input.weeksFound}/${input.weeksRequested} недель подготовки.`);
  } else {
    confidenceScore += 8;
    confidenceReasons.push("Полный набор недель подготовки найден локально.");
  }

  const completionMedian = median(input.completionRates);
  if (completionMedian !== null) {
    if (completionMedian >= 0.85) {
      confidenceScore += 6;
      confidenceReasons.push(`Медианное выполнение плана ~${Math.round(completionMedian * 100)}%.`);
    } else if (completionMedian < 0.7) {
      spreadConservative += 0.03;
      limitations.push("Низкое выполнение плана в подготовительном блоке.");
      confidenceScore -= 10;
      confidenceReasons.push(`Слабое выполнение плана (~${Math.round(completionMedian * 100)}%).`);
    }
  } else if (input.weeksFound === 0) {
    confidenceScore -= 15;
  }

  if (input.missedWorkouts >= 3) {
    spreadConservative += 0.025;
    confidenceScore -= Math.min(12, input.missedWorkouts * 2);
    limitations.push(`Пропущено ${input.missedWorkouts} запланированных тренировок.`);
  }

  if (input.keyWorkoutsFound < 2) {
    spreadConservative += 0.02;
    limitations.push("Мало ключевых тренировок (темп/интервалы/темп гонки) в окне.");
    confidenceScore -= 6;
  } else {
    confidenceScore += 4;
  }

  if (input.progressPositive) {
    spreadOptimistic += 0.015;
    confidenceScore += 5;
    confidenceReasons.push("Progress-evidence: положительный тренд лёгкого/длинного бега.");
  }

  if (input.dataWarnings.length > 0) {
    confidenceScore -= Math.min(15, input.dataWarnings.length * 2);
    limitations.push(`Предупреждения качества данных: ${input.dataWarnings.slice(0, 5).join(", ")}.`);
  }

  let conservativeShift = 0;
  let optimisticShift = 0;
  if (input.taperSignal === "taper_detected") {
    optimisticShift -= 0.01;
    confidenceScore += 3;
    confidenceReasons.push("Тейпер: объём последних дней ниже 3-недельной медианы.");
  } else if (input.taperSignal === "volume_spike") {
    conservativeShift += 0.02;
    limitations.push("Перед стартом объём не снижался (возможен недотейпер).");
    confidenceScore -= 4;
  } else if (input.taperSignal === "insufficient_data") {
    limitations.push("Тейпер оценён приблизительно — мало недельных данных.");
  }

  const conservativeSeconds = Math.round(
    baseSeconds * (1 + spreadConservative + conservativeShift),
  );
  const likelySeconds = Math.round(baseSeconds);
  const optimisticSeconds = Math.round(
    baseSeconds * (1 - spreadOptimistic + optimisticShift),
  );

  const ordered = [conservativeSeconds, likelySeconds, optimisticSeconds].sort((a, b) => a - b);

  let confidence: ConfidenceLevel = "medium";
  if (confidenceScore >= 72) confidence = "high";
  if (confidenceScore <= 45) confidence = "low";

  return {
    prediction: {
      conservative: buildScenario(ordered[2]!, preset.target_km),
      likely: buildScenario(ordered[1]!, preset.target_km),
      optimistic: buildScenario(ordered[0]!, preset.target_km),
      confidence,
      confidence_score: Math.max(0, Math.min(100, confidenceScore)),
      confidence_reasons: confidenceReasons,
      method: "deterministic_v1",
      target_time_hint_used: input.targetTimeSeconds !== null,
    },
    limitations,
  };
}

function progressEvidencePositive(report: ProgressEvidenceReport | null): boolean {
  if (!report) return false;
  const interpretations = new Set([
    report.easy_run_progress.interpretation,
    report.long_run_progress.interpretation,
  ]);
  return (
    interpretations.has("faster_at_same_or_lower_hr") ||
    interpretations.has("similar_pace_lower_hr")
  );
}

function createMarkdown(report: RacePredictionReport): string {
  const lines: string[] = [];
  lines.push(`# Прогноз результата — ${report.athlete.student_name}`);
  lines.push(
    `- Старт: ${DISTANCE_PRESETS[report.race.distance].label}, ${report.race.date}${report.race.name ? `, ${report.race.name}` : ""}`,
  );
  lines.push(`- Окно анализа: ${report.window.from} → ${report.window.to}`);
  lines.push("");
  lines.push("## Прогноз");
  lines.push("| Сценарий | Время | Темп |");
  lines.push("|---|---:|---:|");
  lines.push(
    `| Консервативно | ${report.prediction.conservative.time_text} | ${report.prediction.conservative.pace_text} |`,
  );
  lines.push(
    `| Вероятно | ${report.prediction.likely.time_text} | ${report.prediction.likely.pace_text} |`,
  );
  lines.push(
    `| Оптимистично | ${report.prediction.optimistic.time_text} | ${report.prediction.optimistic.pace_text} |`,
  );
  lines.push("");
  lines.push(
    `**Уверенность:** ${report.prediction.confidence} (${report.prediction.confidence_score}/100), метод ${report.prediction.method}.`,
  );
  lines.push("");
  lines.push("## Почему");
  for (const reason of report.prediction.confidence_reasons) {
    lines.push(`- ${reason}`);
  }
  if (report.anchors.target_distance.primary) {
    const anchor = report.anchors.target_distance.primary;
    lines.push(
      `- Опора: ${anchor.kind}, ${anchor.candidate.date}, ${anchor.candidate.distance_km} км за ${anchor.candidate.duration_text} (${anchor.candidate.pace_text}).`,
    );
  }
  lines.push(
    `- Недели: ${report.window.weeks_found}/${report.window.weeks_requested}; пропуски planned: ${report.features.missed_workouts_count}.`,
  );
  lines.push(
    `- Тейпер: ${report.features.taper.signal}${report.features.taper.ratio !== null ? ` (ratio ${report.features.taper.ratio.toFixed(2)})` : ""}.`,
  );
  lines.push("");
  lines.push("## Ключевые тренировки");
  if (!report.features.key_workouts.length) {
    lines.push("- Ключевые тренировки в parsed weekly-summary не найдены.");
  } else {
    for (const workout of report.features.key_workouts.slice(0, 12)) {
      lines.push(
        `- ${workout.date} · ${workout.category} · ${workout.title ?? "без названия"} · ${workout.pace_text ?? "н/д"} · ${workout.duration_text ?? "н/д"}`,
      );
    }
  }
  lines.push("");
  lines.push("## Риски");
  if (report.features.missed_workouts_count >= 3) {
    lines.push(`- ${report.features.missed_workouts_count} пропущенных тренировок в окне.`);
  }
  if (report.features.taper.signal === "volume_spike") {
    lines.push("- Объём перед стартом не снижался — риск усталости.");
  }
  if (report.features.data_quality.warnings.length) {
    lines.push(`- Качество данных: ${report.features.data_quality.warnings.join(", ")}.`);
  }
  if (
    !report.features.missed_workouts_count &&
    !report.features.data_quality.warnings.length &&
    report.features.taper.signal !== "volume_spike"
  ) {
    lines.push("- Явных красных флагов по summary-данным нет; FIT-сегменты не проверялись.");
  }
  lines.push("");
  lines.push("## Пробелы в данных");
  for (const limitation of report.limitations) {
    lines.push(`- ${limitation}`);
  }
  if (!report.limitations.length) {
    lines.push("- Существенных пробелов не отмечено.");
  }
  lines.push("");
  lines.push("## Что проверить тренеру");
  if (report.anchors.target_distance.excluded_for_review.length) {
    lines.push("- Проверить кандидатов, исключённых из опоры (needs_coach_review / manual_review).");
  }
  if (report.data_sources.fit_weeks_count === 0) {
    lines.push("- Нет FIT в weekly-summary: прогноз по summary, без lap/segment анализа.");
  }
  if (report.data_sources.race_results_probe.path === null) {
    lines.push("- Нет кэша race-results probe — опора только по тренировкам.");
  }
  if (report.data_sources.progress_evidence_probe.path === null) {
    lines.push("- Нет кэша progress-evidence probe — тренд аэробной формы не подтверждён.");
  }
  if (
    !report.anchors.target_distance.excluded_for_review.length &&
    report.data_sources.fit_weeks_count > 0 &&
    report.data_sources.race_results_probe.path
  ) {
    lines.push("- Сверить прогноз с ощущениями спортсмена и планом старта.");
  }
  lines.push("");
  lines.push("## Рекомендация по тактике");
  lines.push(
    `- Стартовать ближе к **${report.prediction.likely.time_text}** (${report.prediction.likely.pace_text}); при плохом самочувствии держать **${report.prediction.conservative.pace_text}**.`,
  );
  lines.push(
    `- Верхняя граница сценария дня — около **${report.prediction.optimistic.time_text}**, только если план по темпу держится без «красной зоны» в первой половине.`,
  );
  lines.push("");
  lines.push("## Artifacts");
  lines.push(`- report_json: \`${report.output_paths.report_json}\``);
  lines.push(`- report_md: \`${report.output_paths.report_md}\``);
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const students = await readStudentsConfig();
  const target = resolveTarget(args, students);
  const runAt = new Date().toISOString();
  const today = runAt.slice(0, 10);
  const commandUsed = `npm run tp-race-prediction-probe -- ${process.argv.slice(2).join(" ")}`.trim();

  const prepWindow = buildPrepWindow({
    raceDate: args.raceDate,
    weeks: args.weeks,
    fromOverride: args.from,
    toOverride: args.to,
  });

  const weeklySummaries: Array<{ week: WeekRange; summary: WeeklySummary | null; path: string | null }> = [];
  for (const week of prepWindow.weekRanges) {
    const summaryPath = weeklySummaryPath(target.studentId, week);
    const summary = await loadWeeklySummary(target.studentId, week);
    weeklySummaries.push({
      week,
      summary,
      path: summary ? summaryPath : null,
    });
  }

  const weeksFound = weeklySummaries.filter((entry) => entry.summary !== null).length;
  const weeksMissing = args.weeks - weeksFound;

  const raceResultsCached = findLatestProbeReport<RaceResultsProbeReport>(
    path.join(toolRoot, "debug", "race-results-probe"),
    target.athleteId,
  );
  const progressCached = findLatestProbeReport<ProgressEvidenceReport>(
    path.join(toolRoot, "debug", "progress-evidence"),
    target.athleteId,
  );

  const anchors = selectAnchorsFromRaceProbe(
    raceResultsCached.report,
    args.distance,
    args.includeReviewAnchors,
  );

  const weeklyVolume: RacePredictionReport["features"]["weekly_volume"] = [];
  const longRuns: RacePredictionReport["features"]["long_runs"] = [];
  const keyWorkouts: RacePredictionReport["features"]["key_workouts"] = [];
  const completionRates: number[] = [];
  const dataWarnings = new Set<string>();
  let missedWorkouts = 0;
  let fitWeeks = 0;
  let workoutFilesWeeks = 0;
  let suspiciousWeeks = 0;

  const taperRecentDates = addDays(args.raceDate, -10);
  let taperRecentKm = 0;

  for (const entry of weeklySummaries) {
    const summary = entry.summary;
    if (!summary) continue;

    let runningKm = 0;
    let completedRunning = 0;
    for (const workout of summary.workouts) {
      if (!isRunningWorkout(workout) || !workout.classification.is_completed) continue;
      completedRunning += 1;
      runningKm += workout.distance_km ?? 0;
      for (const warning of workout.data_warnings) dataWarnings.add(warning);
      if (workout.date && workout.date >= taperRecentDates && workout.date < args.raceDate) {
        taperRecentKm += workout.distance_km ?? 0;
      }

      if (isLongRunWorkout(workout) && workout.date && workout.distance_km) {
        longRuns.push({
          date: workout.date,
          title: workout.title,
          distance_km: workout.distance_km,
          duration_text:
            workout.completed_duration_minutes !== null
              ? formatDurationText(workout.completed_duration_minutes)
              : "н/д",
          pace_text: workout.avg_pace_text ?? (workout.avg_pace_min_per_km ? formatPaceText(workout.avg_pace_min_per_km) : "н/д"),
          week: entry.week,
        });
      }

      const keyCategory = classifyKeyWorkout(workout);
      if (keyCategory && workout.date) {
        keyWorkouts.push({
          category: keyCategory,
          date: workout.date,
          title: workout.title,
          distance_km: workout.distance_km,
          duration_text:
            workout.completed_duration_minutes !== null
              ? formatDurationText(workout.completed_duration_minutes)
              : null,
          pace_text: workout.avg_pace_text ?? (workout.avg_pace_min_per_km ? formatPaceText(workout.avg_pace_min_per_km) : null),
          week: entry.week,
        });
      }
    }

    weeklyVolume.push({
      week: entry.week,
      running_km: runningKm > 0 ? Math.round(runningKm * 10) / 10 : null,
      completed_workouts: completedRunning,
    });

    const completion = summary.week_metrics.plan_vs_fact.completion_rate;
    if (completion !== null) completionRates.push(completion);
    missedWorkouts += summary.week_metrics.counts.planned_skipped;

    for (const warning of summary.week_metrics.data_quality.warnings) {
      dataWarnings.add(warning);
    }
    if (summary.week_metrics.data_quality.warnings.length > 0) suspiciousWeeks += 1;

    if (summary.segment_analysis.workouts_with_matched_fit > 0) {
      fitWeeks += 1;
      workoutFilesWeeks += 1;
    } else if (summary.segment_analysis.reason === "no_workout_files") {
      dataWarnings.add("no_workout_files");
    }
  }

  const volumeKmValues = weeklyVolume
    .map((week) => week.running_km)
    .filter((value): value is number => value !== null);
  const prior3w = volumeKmValues.slice(-4, -1);
  const prior3wMedian = median(prior3w);
  let taperSignal: RacePredictionReport["features"]["taper"]["signal"] = "insufficient_data";
  let taperRatio: number | null = null;
  if (prior3wMedian !== null && prior3wMedian > 0 && weeksFound > 0) {
    taperRatio = taperRecentKm / prior3wMedian;
    if (taperRatio <= 0.55) taperSignal = "taper_detected";
    else if (taperRatio >= 0.95) taperSignal = "volume_spike";
    else taperSignal = "flat";
  }

  const targetTimeSeconds = args.targetTime ? parseDurationToSeconds(args.targetTime) : null;
  if (args.targetTime && targetTimeSeconds === null) {
    throw new Error(`Could not parse --target-time: "${args.targetTime}"`);
  }

  const { prediction, limitations: predictionLimitations } = computePrediction({
    distance: args.distance,
    anchor: anchors.primary,
    targetTimeSeconds,
    completionRates,
    missedWorkouts,
    weeksFound,
    weeksRequested: args.weeks,
    keyWorkoutsFound: keyWorkouts.length,
    progressPositive: progressEvidencePositive(progressCached.report),
    dataWarnings: [...dataWarnings],
    taperSignal,
  });

  const limitations = [
    "Read-only local probe: без Supabase, Telegram, TrainingPeaks и AI.",
    ...predictionLimitations,
  ];
  if (raceResultsCached.path === null) {
    limitations.push("Кэш race-results probe не найден — рекомендуется `npm run tp-probe-race-results`.");
  } else if (raceResultsCached.stale) {
    limitations.push("Кэш race-results probe устарел (>14 дней).");
  }
  if (progressCached.path === null) {
    limitations.push("Кэш progress-evidence probe не найден — аэробный тренд не подтверждён.");
  } else if (progressCached.stale) {
    limitations.push("Кэш progress-evidence probe устарел (>14 дней).");
  }
  if (fitWeeks === 0) {
    limitations.push("FIT/workout files в weekly-summary не найдены — только summary-метрики.");
  }

  const timestamp = timestampForPath(new Date(runAt));
  const outputDir = path.join(
    toolRoot,
    "debug",
    "race-prediction",
    target.studentId,
    timestamp,
  );
  await mkdir(outputDir, { recursive: true });
  const reportJsonPath = path.join(outputDir, "report.json");
  const reportMdPath = path.join(outputDir, "report.md");

  const report: RacePredictionReport = {
    schema_version: "race-prediction.v1",
    run_at: runAt,
    athlete: {
      student_id: target.studentId,
      student_name: target.studentName,
      athlete_id: target.athleteId,
    },
    race: {
      date: args.raceDate,
      distance: args.distance,
      distance_km: DISTANCE_PRESETS[args.distance].target_km,
      name: args.raceName,
      days_until_race: daysBetween(today, args.raceDate),
    },
    window: {
      from: prepWindow.from,
      to: prepWindow.to,
      weeks_requested: args.weeks,
      weeks_found: weeksFound,
      weeks_missing: weeksMissing,
    },
    data_sources: {
      weekly_summaries: weeklySummaries.map((entry) => ({
        from: entry.week.from,
        to: entry.week.to,
        path: entry.path,
        found: entry.summary !== null,
      })),
      race_results_probe: {
        path: raceResultsCached.path,
        run_at: raceResultsCached.runAt,
        stale: raceResultsCached.stale,
      },
      progress_evidence_probe: {
        path: progressCached.path,
        run_at: progressCached.runAt,
        stale: progressCached.stale,
      },
      fit_weeks_count: fitWeeks,
      workout_files_present_weeks: workoutFilesWeeks,
    },
    features: {
      weekly_volume: weeklyVolume,
      long_runs: longRuns.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8),
      key_workouts: keyWorkouts.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 16),
      missed_workouts_count: missedWorkouts,
      taper: {
        last_days: 10,
        recent_km: taperRecentKm > 0 ? Math.round(taperRecentKm * 10) / 10 : null,
        prior_3w_median_km: prior3wMedian !== null ? Math.round(prior3wMedian * 10) / 10 : null,
        ratio: taperRatio !== null ? Math.round(taperRatio * 100) / 100 : null,
        signal: taperSignal,
      },
      data_quality: {
        warnings: [...dataWarnings].sort(),
        suspicious_weeks: suspiciousWeeks,
        fit_coverage_weeks: fitWeeks,
      },
    },
    anchors: {
      target_distance: {
        primary: anchors.primary,
        alternates: anchors.alternates,
        excluded_for_review: anchors.excludedForReview,
      },
      cross_distance: anchors.crossDistance,
    },
    prediction,
    limitations,
    output_paths: {
      report_json: reportJsonPath,
      report_md: reportMdPath,
    },
  };

  await writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(reportMdPath, createMarkdown(report), "utf8");

  console.log("[tp-race-prediction-probe] Summary");
  console.log(`command_used: ${commandUsed}`);
  console.log(`student_id: ${target.studentId}`);
  console.log(`athlete_id: ${target.athleteId}`);
  console.log(`race: ${args.distance} on ${args.raceDate}`);
  console.log(`window: ${prepWindow.from} -> ${prepWindow.to}`);
  console.log(`weeks_found: ${weeksFound}`);
  console.log(`weeks_missing: ${weeksMissing}`);
  console.log(
    `selected_anchor: ${
      anchors.primary
        ? `${anchors.primary.kind} | ${anchors.primary.candidate.date} | ${anchors.primary.candidate.pace_text}`
        : "none"
    }`,
  );
  console.log(
    `prediction_range: conservative ${prediction.conservative.time_text} | likely ${prediction.likely.time_text} | optimistic ${prediction.optimistic.time_text}`,
  );
  console.log(`confidence: ${prediction.confidence} (${prediction.confidence_score}/100)`);
  console.log(`report_json: ${reportJsonPath}`);
  console.log(`report_md: ${reportMdPath}`);
}

main().catch((error: unknown) => {
  console.error("tp-race-prediction-probe failed.");
  console.error(error);
  process.exit(1);
});
