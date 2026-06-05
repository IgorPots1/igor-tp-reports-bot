import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import type { TrainingPeaksStudent, TrainingPeaksWorkoutCacheRow } from "../../../src/features/trainingpeaks/repository.ts";
import * as trainingPeaksRepository from "../../../src/features/trainingpeaks/repository.ts";
import { toolRoot } from "./lib/paths.ts";
import {
  analyzeAthleteTrainingBaselineV2,
  buildBaselineV2SummaryMarkdown,
  buildCombinedArtifactsMarkdown,
  buildDataGapsMarkdown,
  buildManualReviewShortlistMarkdown,
  buildPerAthleteBaselineV2Markdown,
  buildRaceEvidenceCalibrationMarkdown,
  buildRaceCandidatesMarkdown,
  buildWeekTagsMarkdown,
  type BaselineV2Confidence,
  type CurrentBaselineContext,
} from "./lib/athlete-training-baseline-v2.ts";

type CliArgs = {
  from: string;
  to: string | null;
  student: string | null;
  athleteId: number | null;
  minNormalWeeks: number;
  json: boolean;
};

type RepositoryCompat = {
  listTrainingPeaksStudents?: () => Promise<TrainingPeaksStudent[]>;
  default?: {
    listTrainingPeaksStudents?: () => Promise<TrainingPeaksStudent[]>;
  };
};

type TrainingPeaksWorkoutCacheDbRow = {
  id: string;
  student_id: string;
  student_name: string;
  trainingpeaks_athlete_id: number;
  trainingpeaks_workout_id: number;
  workout_date: string;
  title: string | null;
  sport_or_type_code: string | null;
  workout_type_value_id: number | null;
  workout_sub_type_id: number | null;
  is_planned: boolean;
  is_completed: boolean;
  planned_time_raw: number | string | null;
  completed_time_raw: number | string | null;
  planned_distance_raw: number | string | null;
  completed_distance_raw: number | string | null;
  compliance_duration_percent: number | string | null;
  compliance_distance_percent: number | string | null;
  start_time_planned: string | null;
  start_time: string | null;
  source_updated_at: string | null;
  order_on_day: number | string | null;
  scanned_at: string;
  scan_job_id: string | null;
  normalization_warnings: string[] | null;
  source_snapshot: unknown;
  created_at: string;
  updated_at: string;
};

type AthleteTrainingBaselineDbRow = {
  student_id: string;
  trainingpeaks_athlete_id: string | null;
  confidence: BaselineV2Confidence | null;
  context_flags: string[] | null;
  family_label_advisory: string | null;
  is_current: boolean;
};

const CACHE_PAGE_SIZE = 1000;

function readEnvFile(filePath: string): void {
  try {
    if (!existsSync(filePath)) return;
    const content = readFileSync(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex <= 0) continue;
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
  } catch {
    // Ignore local env load failures; explicit env still works.
  }
}

function loadLocalEnv(): void {
  const repoRoot = path.resolve(toolRoot, "..", "..");
  for (const envPath of [path.join(repoRoot, ".env.local"), path.join(repoRoot, ".env"), path.join(toolRoot, ".env")]) {
    readEnvFile(envPath);
  }
}

function getRequiredEnv(name: "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}. Set it in .env.local or .env.`);
  }
  return value;
}

function createSupabaseServerClient() {
  return createClient(getRequiredEnv("SUPABASE_URL"), getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function timestampForPath(date: Date): string {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ").replace(/ё/gu, "е");
}

function parseAthleteIdFromUrl(athleteUrl: string | null | undefined): number | null {
  if (!athleteUrl) return null;
  const match = athleteUrl.match(/\/athletes\/(\d+)/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function studentMatches(student: TrainingPeaksStudent, needle: string): boolean {
  const normalizedNeedle = normalizeName(needle);
  return (
    normalizeName(student.studentName) === normalizedNeedle ||
    student.studentId.trim().toLowerCase() === normalizedNeedle ||
    student.id.trim().toLowerCase() === normalizedNeedle
  );
}

function validateIsoDate(value: string, argName: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid ${argName} date format. Expected YYYY-MM-DD.`);
  }
  return value;
}

function printHelp(): void {
  console.log("Baseline v2 diagnostic with race / result awareness (read-only)");
  console.log("");
  console.log("Usage:");
  console.log("  npx tsx tools/trainingpeaks-export/scripts/tp-diagnose-athlete-training-baseline-v2.ts --from 2026-01-01 --to 2026-06-04");
  console.log('  npx tsx tools/trainingpeaks-export/scripts/tp-diagnose-athlete-training-baseline-v2.ts --student "Alena Grill"');
  console.log("  npx tsx tools/trainingpeaks-export/scripts/tp-diagnose-athlete-training-baseline-v2.ts --athlete-id 123456");
  console.log("");
  console.log("Optional:");
  console.log("  --min-normal-weeks 6 --json");
  console.log("");
  console.log("Safety:");
  console.log("  - read-only");
  console.log("  - no DB writes");
  console.log("  - no TrainingPeaks mutations");
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    from: "2026-01-01",
    to: null,
    student: null,
    athleteId: null,
    minNormalWeeks: 6,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg.startsWith("--from=")) {
      parsed.from = validateIsoDate(arg.slice("--from=".length).trim(), "--from");
      continue;
    }
    if (arg === "--from") {
      parsed.from = validateIsoDate((argv[index + 1] ?? "").trim(), "--from");
      index += 1;
      continue;
    }
    if (arg.startsWith("--to=")) {
      parsed.to = validateIsoDate(arg.slice("--to=".length).trim(), "--to");
      continue;
    }
    if (arg === "--to") {
      parsed.to = validateIsoDate((argv[index + 1] ?? "").trim(), "--to");
      index += 1;
      continue;
    }
    if (arg.startsWith("--student=")) {
      parsed.student = arg.slice("--student=".length).trim() || null;
      continue;
    }
    if (arg === "--student") {
      parsed.student = (argv[index + 1] ?? "").trim() || null;
      index += 1;
      continue;
    }
    if (arg.startsWith("--athlete-id=")) {
      parsed.athleteId = Number(arg.slice("--athlete-id=".length));
      continue;
    }
    if (arg === "--athlete-id") {
      parsed.athleteId = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--min-normal-weeks=")) {
      parsed.minNormalWeeks = Number(arg.slice("--min-normal-weeks=".length));
      continue;
    }
    if (arg === "--min-normal-weeks") {
      parsed.minNormalWeeks = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(parsed.minNormalWeeks) || parsed.minNormalWeeks < 4 || parsed.minNormalWeeks > 12) {
    throw new Error("Invalid --min-normal-weeks. Expected integer 4..12.");
  }
  if (parsed.to !== null && parsed.from > parsed.to) {
    throw new Error(`Invalid range: --from (${parsed.from}) is after --to (${parsed.to}).`);
  }
  if (parsed.athleteId !== null && (!Number.isInteger(parsed.athleteId) || parsed.athleteId <= 0)) {
    throw new Error("Invalid --athlete-id. Expected positive integer.");
  }
  return parsed;
}

function mapWorkoutCacheDbRow(row: TrainingPeaksWorkoutCacheDbRow): TrainingPeaksWorkoutCacheRow {
  return {
    id: row.id,
    studentId: row.student_id,
    studentName: row.student_name,
    trainingPeaksAthleteId: row.trainingpeaks_athlete_id,
    trainingPeaksWorkoutId: row.trainingpeaks_workout_id,
    workoutDate: row.workout_date,
    title: row.title,
    sportOrTypeCode: row.sport_or_type_code,
    workoutTypeValueId: row.workout_type_value_id,
    workoutSubTypeId: row.workout_sub_type_id,
    isPlanned: row.is_planned,
    isCompleted: row.is_completed,
    plannedTimeRaw: row.planned_time_raw,
    completedTimeRaw: row.completed_time_raw,
    plannedDistanceRaw: row.planned_distance_raw,
    completedDistanceRaw: row.completed_distance_raw,
    complianceDurationPercent: row.compliance_duration_percent,
    complianceDistancePercent: row.compliance_distance_percent,
    startTimePlanned: row.start_time_planned,
    startTime: row.start_time,
    sourceUpdatedAt: row.source_updated_at,
    orderOnDay: row.order_on_day,
    scannedAt: row.scanned_at,
    scanJobId: row.scan_job_id,
    normalizationWarnings: row.normalization_warnings ?? [],
    sourceSnapshot: row.source_snapshot,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function fetchLatestWorkoutDate(): Promise<string | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_workout_cache")
    .select("workout_date")
    .order("workout_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to determine latest workout date: ${error.message}`);
  }
  return data?.workout_date ?? null;
}

async function fetchPaginatedWorkoutCacheRowsForDateRange(input: {
  from: string;
  to: string;
  studentId?: string;
  athleteId?: number;
}): Promise<TrainingPeaksWorkoutCacheRow[]> {
  const supabase = createSupabaseServerClient();
  const rows: TrainingPeaksWorkoutCacheRow[] = [];
  let offset = 0;

  while (true) {
    let query = supabase
      .from("trainingpeaks_workout_cache")
      .select("*")
      .gte("workout_date", input.from)
      .lte("workout_date", input.to)
      .order("student_name", { ascending: true })
      .order("workout_date", { ascending: true })
      .order("trainingpeaks_workout_id", { ascending: true })
      .range(offset, offset + CACHE_PAGE_SIZE - 1);

    if (input.studentId) query = query.eq("student_id", input.studentId);
    if (input.athleteId) query = query.eq("trainingpeaks_athlete_id", input.athleteId);

    const { data, error } = await query;
    if (error) {
      throw new Error(
        `Failed to fetch workout cache page for ${input.from}..${input.to} (offset=${offset}): ${error.message}`,
      );
    }

    const page = ((data as TrainingPeaksWorkoutCacheDbRow[] | null) ?? []).map(mapWorkoutCacheDbRow);
    rows.push(...page);
    if (page.length < CACHE_PAGE_SIZE) break;
    offset += CACHE_PAGE_SIZE;
  }

  return rows;
}

async function fetchCurrentBaselinesMap(studentIds: string[]): Promise<Map<string, CurrentBaselineContext>> {
  const result = new Map<string, CurrentBaselineContext>();
  if (studentIds.length === 0) return result;

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("athlete_training_baselines")
    .select("student_id, trainingpeaks_athlete_id, confidence, context_flags, family_label_advisory, is_current")
    .eq("is_current", true)
    .in("student_id", studentIds);

  if (error) {
    throw new Error(`Failed to load current athlete baselines: ${error.message}`);
  }

  for (const row of ((data as AthleteTrainingBaselineDbRow[] | null) ?? [])) {
    result.set(row.student_id, {
      studentId: row.student_id,
      trainingPeaksAthleteId: row.trainingpeaks_athlete_id ? Number(row.trainingpeaks_athlete_id) : null,
      contextFlags: row.context_flags ?? [],
      confidence: row.confidence ?? null,
      familyLabelAdvisory: row.family_label_advisory,
    });
  }

  return result;
}

function buildRaceCandidatesJsonRows(markdownCompatibleCandidates: ReturnType<typeof analyzeAthleteTrainingBaselineV2>["raceCandidates"]) {
  return markdownCompatibleCandidates.map((candidate) => ({
    student: candidate.student_name,
    athlete_id: candidate.athlete_id,
    date: candidate.date,
    estimated_distance: candidate.estimated_distance,
    estimated_distance_km: candidate.estimated_distance_km,
    source_signals: candidate.source_signals,
    source_types: candidate.source_types,
    matched_reasons: candidate.matched_reasons,
    score: candidate.score,
    confidence: candidate.confidence,
    title: candidate.title,
    matched_text_snippet: candidate.matched_text_snippet,
    completed_without_plan: candidate.completed_without_plan,
    exclusion_eligible: candidate.exclusion_eligible,
    exclusion_decision_reason: candidate.exclusion_decision_reason,
    caused_exclusion: candidate.caused_exclusion,
  }));
}

function buildRequiredAthletesBeforeAfterRows(
  athletes: ReturnType<typeof analyzeAthleteTrainingBaselineV2>["perAthlete"],
): Array<{
  requested_name: string;
  matched_student_name: string | null;
  athlete_id: number | null;
  old_v2_frequency_planned_context: number | null;
  new_completed_primary_frequency: number | null;
  completed_running_workouts_total: number;
  planned_running_workouts_total: number;
  low_data_weeks_before_planned_context: number | null;
  low_data_weeks_after_completed_primary: number;
  normal_training_weeks_count_before_planned_context: number | null;
  normal_training_weeks_count_after_completed_primary: number;
  fallback_status_before_planned_context: boolean | null;
  fallback_status_after_completed_primary: boolean;
  baseline_period_type: string | null;
  active_training_window_start: string | null;
  pre_active_gap_weeks_count: number | null;
  all_window_frequency: number | null;
  active_window_frequency: number | null;
  normal_week_frequency: number | null;
  recent_4w_frequency: number | null;
  context_flags: string[];
  short_diagnosis: string;
}> {
  const requiredNames = [
    "Margarita",
    "Irina Melnikova",
    "Anastasia Abramova",
    "Anastasia Utenkova",
    "Alexander Abramov",
    "Igor Potseluev",
    "Yulia Krylova",
    "Anna Chernysheva",
    "Aleksei Lobus",
  ];
  const normalized = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

  function matchAthlete(name: string) {
    const n = normalized(name);
    const exact = athletes.find((athlete) => normalized(athlete.student_name) === n);
    if (exact) return exact;
    const partial = athletes.find((athlete) => normalized(athlete.student_name).includes(n) || n.includes(normalized(athlete.student_name)));
    return partial ?? null;
  }

  return requiredNames.map((requestedName) => {
    const athlete = matchAthlete(requestedName);
    if (!athlete) {
      return {
        requested_name: requestedName,
        matched_student_name: null,
        athlete_id: null,
        old_v2_frequency_planned_context: null,
        new_completed_primary_frequency: null,
        completed_running_workouts_total: 0,
        planned_running_workouts_total: 0,
        low_data_weeks_before_planned_context: null,
        low_data_weeks_after_completed_primary: 0,
        normal_training_weeks_count_before_planned_context: null,
        normal_training_weeks_count_after_completed_primary: 0,
        fallback_status_before_planned_context: null,
        fallback_status_after_completed_primary: false,
        baseline_period_type: null,
        active_training_window_start: null,
        pre_active_gap_weeks_count: null,
        all_window_frequency: null,
        active_window_frequency: null,
        normal_week_frequency: null,
        recent_4w_frequency: null,
        context_flags: [],
        short_diagnosis: "No matching athlete name found in this run.",
      };
    }

    const lowDataAfter = athlete.excluded_weeks_by_tag.low_data;
    const completedWorkouts = athlete.completed_vs_planned_divergence.completed_only_running_workouts;
    const plannedOnlyWorkouts = athlete.completed_vs_planned_divergence.planned_only_running_workouts;
    const diagnosisParts = [
      athlete.baseline_change_vs_planned_context.materially_changed
        ? "Material completed-vs-planned baseline shift."
        : "No material baseline shift.",
      completedWorkouts > plannedOnlyWorkouts
        ? "Completed-only pattern dominates."
        : plannedOnlyWorkouts > completedWorkouts
          ? "Planned-only pattern dominates."
          : "Completed/planned workout patterns are balanced.",
      lowDataAfter > 0 ? `Has ${lowDataAfter} completed-primary low_data weeks.` : "No completed-primary low_data weeks.",
      athlete.active_training_window.baseline_period_type === "active_since"
        ? `Active training since ${athlete.active_training_window.active_training_window_start ?? "unknown"}.`
        : `Baseline period type: ${athlete.active_training_window.baseline_period_type}.`,
      athlete.active_training_window.normal_week_frequency !== null &&
      athlete.active_training_window.all_window_frequency !== null &&
      athlete.active_training_window.normal_week_frequency - athlete.active_training_window.all_window_frequency >= 1
        ? `Normal-week frequency (${athlete.active_training_window.normal_week_frequency}) stays above all-window (${athlete.active_training_window.all_window_frequency}).`
        : "No major normal-vs-all-window frequency shift.",
    ];

    return {
      requested_name: requestedName,
      matched_student_name: athlete.student_name,
      athlete_id: athlete.athlete_id,
      old_v2_frequency_planned_context: athlete.planned_context_baseline.frequency_cap,
      new_completed_primary_frequency: athlete.normal_baseline.frequency_cap,
      completed_running_workouts_total:
        athlete.completed_vs_planned_divergence.completed_only_running_workouts +
        Math.max(
          0,
          athlete.completed_vs_planned_divergence.weeks_with_workout_count_difference -
            athlete.completed_vs_planned_divergence.planned_only_running_workouts,
        ),
      planned_running_workouts_total:
        athlete.completed_vs_planned_divergence.planned_only_running_workouts +
        Math.max(
          0,
          athlete.completed_vs_planned_divergence.weeks_with_workout_count_difference -
            athlete.completed_vs_planned_divergence.completed_only_running_workouts,
        ),
      low_data_weeks_before_planned_context: null,
      low_data_weeks_after_completed_primary: lowDataAfter,
      normal_training_weeks_count_before_planned_context: null,
      normal_training_weeks_count_after_completed_primary: athlete.normal_training_weeks_count,
      fallback_status_before_planned_context: null,
      fallback_status_after_completed_primary: athlete.baseline_source === "fallback_all_weeks",
      baseline_period_type: athlete.active_training_window.baseline_period_type,
      active_training_window_start: athlete.active_training_window.active_training_window_start,
      pre_active_gap_weeks_count: athlete.active_training_window.pre_active_gap_weeks_count,
      all_window_frequency: athlete.active_training_window.all_window_frequency,
      active_window_frequency: athlete.active_training_window.active_window_frequency,
      normal_week_frequency: athlete.active_training_window.normal_week_frequency,
      recent_4w_frequency: athlete.active_training_window.recent_4w_frequency,
      context_flags: athlete.context_flags,
      short_diagnosis: diagnosisParts.join(" "),
    };
  });
}

async function main(): Promise<void> {
  loadLocalEnv();
  if (!process.env.SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_URL) {
    process.env.SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  }

  const args = parseArgs(process.argv.slice(2));
  const dateTo = args.to ?? (await fetchLatestWorkoutDate());
  if (!dateTo) {
    throw new Error("No cached workout rows found. Cannot determine default --to.");
  }

  const repoCompat = trainingPeaksRepository as RepositoryCompat;
  const listStudentsFn = repoCompat.listTrainingPeaksStudents ?? repoCompat.default?.listTrainingPeaksStudents;
  if (!listStudentsFn) {
    throw new Error("TrainingPeaks repository helpers are unavailable in this runtime.");
  }

  const students = await listStudentsFn();
  const activeStudents = students.filter((student) => student.isActive);

  let selectedStudent: TrainingPeaksStudent | null = null;
  if (args.student) {
    const matches = activeStudents.filter((student) => studentMatches(student, args.student!));
    if (matches.length === 0) throw new Error(`No active student matched --student="${args.student}"`);
    if (matches.length > 1) throw new Error(`Multiple students matched --student="${args.student}"`);
    selectedStudent = matches[0]!;
  }

  let selectedAthleteId: number | undefined;
  if (args.athleteId !== null) {
    selectedAthleteId = args.athleteId;
  } else if (selectedStudent) {
    const parsed = parseAthleteIdFromUrl(selectedStudent.trainingPeaksAthleteUrl);
    if (parsed !== null) selectedAthleteId = parsed;
  }

  const rows = await fetchPaginatedWorkoutCacheRowsForDateRange({
    from: args.from,
    to: dateTo,
    studentId: selectedStudent?.id,
    athleteId: selectedAthleteId,
  });

  const rowsByAthlete = new Map<number, TrainingPeaksWorkoutCacheRow[]>();
  for (const row of rows) {
    const bucket = rowsByAthlete.get(row.trainingPeaksAthleteId) ?? [];
    bucket.push(row);
    rowsByAthlete.set(row.trainingPeaksAthleteId, bucket);
  }

  const studentIds = [...new Set(rows.map((row) => row.studentId))];
  const currentBaselineMap = await fetchCurrentBaselinesMap(studentIds);
  const athletes = [...rowsByAthlete.entries()]
    .map(([athleteId, athleteRows]) => {
      const student = activeStudents.find((candidate) => candidate.id === athleteRows[0]?.studentId);
      if (!student) return null;
      return {
        studentId: student.id,
        studentName: student.studentName,
        athleteId,
        rows: athleteRows,
        currentBaseline: currentBaselineMap.get(student.id) ?? null,
      };
    })
    .filter((value): value is NonNullable<typeof value> => value !== null);

  const analysis = analyzeAthleteTrainingBaselineV2({
    athletes,
    from: args.from,
    to: dateTo,
    minNormalWeeks: args.minNormalWeeks,
    generatedAt: new Date().toISOString(),
    activeAthletesTotal: selectedStudent ? 1 : activeStudents.length,
  });

  const repoRoot = path.resolve(toolRoot, "..", "..");
  const reportDir = path.join(repoRoot, "reports", "athlete-training-baseline-v2", timestampForPath(new Date()));
  await mkdir(reportDir, { recursive: true });

  const files = {
    summaryJson: path.join(reportDir, "baseline-v2-summary.json"),
    summaryMd: path.join(reportDir, "baseline-v2-summary.md"),
    perAthleteJson: path.join(reportDir, "per-athlete-baseline-v2.json"),
    perAthleteMd: path.join(reportDir, "per-athlete-baseline-v2.md"),
    raceCandidatesJson: path.join(reportDir, "race-candidates.json"),
    raceCandidatesMd: path.join(reportDir, "race-candidates.md"),
    weekTagsJson: path.join(reportDir, "week-tags.json"),
    weekTagsMd: path.join(reportDir, "week-tags.md"),
    manualReviewMd: path.join(reportDir, "manual-review-shortlist.md"),
    dataGapsMd: path.join(reportDir, "data-gaps.md"),
    raceEvidenceCalibrationJson: path.join(reportDir, "race-evidence-calibration.json"),
    raceEvidenceCalibrationMd: path.join(reportDir, "race-evidence-calibration.md"),
    requiredAthletesBeforeAfterJson: path.join(reportDir, "required-athletes-before-after.json"),
    combinedMd: path.join(reportDir, "COMBINED-BASELINE-V2-ARTIFACTS.md"),
  };

  analysis.summary.report_paths = files;

  const summaryMd = buildBaselineV2SummaryMarkdown(analysis.summary);
  const perAthleteMd = buildPerAthleteBaselineV2Markdown(analysis.perAthlete);
  const raceCandidatesMd = buildRaceCandidatesMarkdown(analysis.raceCandidates);
  const weekTagsMd = buildWeekTagsMarkdown(analysis.weekTags);
  const manualReviewMd = buildManualReviewShortlistMarkdown(analysis.manualReviewShortlist);
  const dataGapsMd = buildDataGapsMarkdown(analysis.dataGaps);
  const raceEvidenceCalibrationMd = buildRaceEvidenceCalibrationMarkdown(analysis.raceEvidenceCalibration);
  const combinedMd = buildCombinedArtifactsMarkdown({
    summaryMd,
    perAthleteMd,
    raceCandidatesMd,
    weekTagsMd,
    manualReviewMd,
    dataGapsMd,
    raceEvidenceCalibrationMd,
  });

  await writeFile(files.summaryJson, `${JSON.stringify(analysis.summary, null, 2)}\n`, "utf8");
  await writeFile(files.summaryMd, summaryMd, "utf8");
  await writeFile(files.perAthleteJson, `${JSON.stringify(analysis.perAthlete, null, 2)}\n`, "utf8");
  await writeFile(files.perAthleteMd, perAthleteMd, "utf8");
  await writeFile(files.raceCandidatesJson, `${JSON.stringify(buildRaceCandidatesJsonRows(analysis.raceCandidates), null, 2)}\n`, "utf8");
  await writeFile(files.raceCandidatesMd, raceCandidatesMd, "utf8");
  await writeFile(files.weekTagsJson, `${JSON.stringify(analysis.weekTags, null, 2)}\n`, "utf8");
  await writeFile(files.weekTagsMd, weekTagsMd, "utf8");
  await writeFile(files.manualReviewMd, manualReviewMd, "utf8");
  await writeFile(files.dataGapsMd, dataGapsMd, "utf8");
  await writeFile(files.raceEvidenceCalibrationJson, `${JSON.stringify(analysis.raceEvidenceCalibration, null, 2)}\n`, "utf8");
  await writeFile(files.raceEvidenceCalibrationMd, raceEvidenceCalibrationMd, "utf8");
  await writeFile(
    files.requiredAthletesBeforeAfterJson,
    `${JSON.stringify(buildRequiredAthletesBeforeAfterRows(analysis.perAthlete), null, 2)}\n`,
    "utf8",
  );
  await writeFile(files.combinedMd, combinedMd, "utf8");

  if (args.json) {
    console.log(JSON.stringify(analysis.summary, null, 2));
    return;
  }

  console.log("[tp-diagnose-athlete-training-baseline-v2] read_only=true");
  console.log(`from: ${args.from}`);
  console.log(`to: ${dateTo}`);
  console.log(`athletes_analyzed: ${analysis.summary.athletes_analyzed}`);
  console.log(`athletes_with_enough_clean_normal_weeks: ${analysis.summary.athletes_with_enough_clean_normal_weeks}`);
  console.log(`athletes_with_fallback_baseline: ${analysis.summary.athletes_with_fallback_baseline}`);
  console.log(`athletes_with_detected_race_candidates: ${analysis.summary.athletes_with_detected_race_candidates}`);
  console.log(`total_normal_weeks: ${analysis.summary.total_normal_weeks}`);
  console.log(`confidence_distribution: ${JSON.stringify(analysis.summary.confidence_distribution)}`);
  console.log(`excluded_weeks_by_tag: ${JSON.stringify(analysis.summary.total_excluded_weeks_by_tag)}`);
  console.log(`report_dir: ${reportDir}`);
  console.log(`summary_json: ${files.summaryJson}`);
  console.log(`per_athlete_json: ${files.perAthleteJson}`);
  console.log(`race_candidates_json: ${files.raceCandidatesJson}`);
  console.log(`week_tags_json: ${files.weekTagsJson}`);
  console.log(`manual_review_md: ${files.manualReviewMd}`);
  console.log(`race_evidence_calibration_json: ${files.raceEvidenceCalibrationJson}`);
  console.log(`race_evidence_calibration_md: ${files.raceEvidenceCalibrationMd}`);
  console.log(`required_athletes_before_after_json: ${files.requiredAthletesBeforeAfterJson}`);
}

main().catch((error: unknown) => {
  console.error("tp-diagnose-athlete-training-baseline-v2 failed.");
  console.error(error);
  process.exit(1);
});
