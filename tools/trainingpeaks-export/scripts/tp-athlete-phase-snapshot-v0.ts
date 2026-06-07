import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import type {
  TrainingPeaksStudent,
  TrainingPeaksStudentOperationalSignal,
  TrainingPeaksWorkoutCacheRow,
} from "../../../src/features/trainingpeaks/repository.ts";
import * as trainingPeaksRepository from "../../../src/features/trainingpeaks/repository.ts";
import { toolRoot } from "./lib/paths.ts";
import {
  defaultHistoryWindowBeforeWeekStart,
  diagnoseWorkoutRow,
  isCompletedRunningWorkout,
} from "./lib/recent-workout-quality-diagnostic.ts";
import {
  detectTrainingPhaseV0,
  PHASE_DETECTOR_SAFETY_MARKERS,
  type AthletePhaseSnapshot,
  type RaceContextCandidate,
  type ReviewLevel,
} from "./lib/training-phase-detector-v0.ts";

type CliArgs = {
  weekStart: string;
  allActiveStudents: boolean;
  studentId: string | null;
  athleteId: number | null;
  raceScanDir: string | null;
  json: boolean;
};

type RepositoryCompat = {
  listTrainingPeaksStudents?: () => Promise<TrainingPeaksStudent[]>;
  listActiveTrainingPeaksOperationalSignalsByStudent?: (
    studentId: string,
  ) => Promise<TrainingPeaksStudentOperationalSignal[]>;
  default?: {
    listTrainingPeaksStudents?: () => Promise<TrainingPeaksStudent[]>;
    listActiveTrainingPeaksOperationalSignalsByStudent?: (
      studentId: string,
    ) => Promise<TrainingPeaksStudentOperationalSignal[]>;
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

type BaselineV2PerAthlete = {
  student_name: string;
  student_id: string;
  athlete_id: number;
  confidence: "low" | "medium" | "high";
  needs_review: boolean;
  normal_baseline: {
    frequency_cap: number | null;
    quality_count_cap: number | null;
  };
  active_training_window?: {
    recent_4w_frequency: number | null;
  };
  race_specific_context: {
    race_candidate_count: number;
    race_candidates: Array<{
      date?: string | null;
      estimated_distance?: string | null;
      confidence?: string | null;
      title?: string | null;
      event_name?: string | null;
      source_type?: string | null;
      distance_km?: number | null;
      event_type?: string | null;
    }>;
  };
  context_flags: string[];
  notes?: string[];
};

type AthleteTrainingBaselineDbRow = {
  student_id: string;
  trainingpeaks_athlete_id: string | null;
  frequency_cap: number | null;
  quality_count_cap: number | null;
  confidence: "low" | "medium" | "high" | null;
  needs_review: boolean;
  context_flags: string[] | null;
  raw_stats_jsonb: Record<string, unknown> | null;
  is_current: boolean;
};

type PhaseSnapshotReport = {
  generated_at: string;
  week_start: string;
  athlete_count: number;
  baseline_v2_source_dir: string | null;
  operational_signals_included: boolean;
  operational_signals_unavailable_reason: string | null;
  counts_by_detected_context: Record<string, number>;
  counts_by_review_level: Record<ReviewLevel, number>;
  race_context_summary: {
    athletes_with_upcoming_race: number;
    athletes_with_multiple_races: number;
    athletes_with_marathon_context: number;
    athletes_with_trail_context: number;
    athletes_needing_race_confirmation: number;
  };
  manual_review_count: number;
  possible_deload_count: number;
  safety: typeof PHASE_DETECTOR_SAFETY_MARKERS;
  athletes: AthletePhaseSnapshot[];
};

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
    // Ignore local env load failures.
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

function validateIsoDate(value: string, argName: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid ${argName}. Expected YYYY-MM-DD.`);
  }
  return value;
}

function parseAthleteId(value: string, argName: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${argName}. Expected positive integer.`);
  }
  return parsed;
}

function parseAthleteIdFromUrl(athleteUrl: string | null | undefined): number | null {
  if (!athleteUrl) return null;
  const match = athleteUrl.match(/\/athletes\/(\d+)/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function printHelp(): void {
  console.log("Athlete TrainingPhase / Situation snapshot v0 (read-only)");
  console.log("");
  console.log("Usage:");
  console.log("  npm run tp-athlete-phase-snapshot-v0 -- --week-start 2026-06-08 --all-active-students");
  console.log("  npm run tp-athlete-phase-snapshot-v0 -- --week-start 2026-06-08 --student-id <uuid>");
  console.log("  npm run tp-athlete-phase-snapshot-v0 -- --week-start 2026-06-08 --athlete-id <id>");
  console.log("  npm run tp-athlete-phase-snapshot-v0 -- --week-start 2026-06-08 --all-active-students --race-scan-dir reports/races-scan/<timestamp>");
  console.log("");
  console.log("Optional:");
  console.log("  --json");
  console.log("");
  console.log("Safety:");
  console.log("  - read-only diagnostic");
  console.log("  - no TrainingPeaks mutations");
  console.log("  - no DB writes");
  console.log("  - no Telegram sends");
  console.log("  - no plan generation");
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    weekStart: validateIsoDate(new Date().toISOString().slice(0, 10), "--week-start"),
    allActiveStudents: false,
    studentId: null,
    athleteId: null,
    raceScanDir: null,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg.startsWith("--week-start=")) {
      parsed.weekStart = validateIsoDate(arg.slice("--week-start=".length).trim(), "--week-start");
      continue;
    }
    if (arg === "--week-start") {
      parsed.weekStart = validateIsoDate((argv[index + 1] ?? "").trim(), "--week-start");
      index += 1;
      continue;
    }
    if (arg === "--all-active-students") {
      parsed.allActiveStudents = true;
      continue;
    }
    if (arg.startsWith("--student-id=")) {
      parsed.studentId = arg.slice("--student-id=".length).trim() || null;
      continue;
    }
    if (arg === "--student-id") {
      parsed.studentId = (argv[index + 1] ?? "").trim() || null;
      index += 1;
      continue;
    }
    if (arg.startsWith("--athlete-id=")) {
      parsed.athleteId = parseAthleteId(arg.slice("--athlete-id=".length).trim(), "--athlete-id");
      continue;
    }
    if (arg === "--athlete-id") {
      parsed.athleteId = parseAthleteId((argv[index + 1] ?? "").trim(), "--athlete-id");
      index += 1;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg.startsWith("--race-scan-dir=")) {
      parsed.raceScanDir = arg.slice("--race-scan-dir=".length).trim() || null;
      continue;
    }
    if (arg === "--race-scan-dir") {
      parsed.raceScanDir = (argv[index + 1] ?? "").trim() || null;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!parsed.allActiveStudents && !parsed.studentId && parsed.athleteId === null) {
    parsed.allActiveStudents = true;
  }

  return parsed;
}

type RaceScanRow = {
  athlete_id?: number | string | null;
  event_date?: string | null;
  event_title?: string | null;
  event_name?: string | null;
  distance?: string | number | null;
  distance_km?: string | number | null;
  sport_type?: string | null;
  confidence?: string | number | null;
  source_type?: string | null;
};

function normalizeRaceScanConfidence(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 0.8) return "high";
    if (value >= 0.5) return "medium";
    return "low";
  }
  return null;
}

type RaceScanJson = {
  rows?: RaceScanRow[];
};

function parseDistanceKmValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Number(value.toFixed(3));
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const direct = Number(trimmed.replace(",", "."));
  if (Number.isFinite(direct) && direct > 0) return Number(direct.toFixed(3));
  const match = trimmed.match(/(\d+(?:[.,]\d+)?)/);
  if (!match) return null;
  const parsed = Number(match[1]!.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Number(parsed.toFixed(3));
}

function estimateDistanceFromKm(distanceKm: number | null): string | null {
  if (distanceKm === null) return null;
  if (distanceKm >= 41 && distanceKm <= 43.5) return "marathon";
  if (distanceKm >= 20.5 && distanceKm <= 22.5) return "half";
  if (distanceKm >= 9.5 && distanceKm <= 10.8) return "10k";
  if (distanceKm >= 4.6 && distanceKm <= 5.6) return "5k";
  if (distanceKm > 43.5) return "ultra";
  return "unknown";
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

async function fetchWorkoutCacheRows(input: {
  studentId: string;
  athleteId: number;
  from: string;
  to: string;
}): Promise<TrainingPeaksWorkoutCacheRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_workout_cache")
    .select("*")
    .eq("student_id", input.studentId)
    .eq("trainingpeaks_athlete_id", input.athleteId)
    .gte("workout_date", input.from)
    .lte("workout_date", input.to)
    .order("workout_date", { ascending: true })
    .order("trainingpeaks_workout_id", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to read workout cache for student ${input.studentId} (${input.from}..${input.to}): ${error.message}`,
    );
  }

  return ((data as TrainingPeaksWorkoutCacheDbRow[] | null) ?? []).map(mapWorkoutCacheDbRow);
}

async function fetchCurrentBaselinesByStudentId(): Promise<Map<string, AthleteTrainingBaselineDbRow>> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("athlete_training_baselines")
    .select(
      "student_id, trainingpeaks_athlete_id, frequency_cap, quality_count_cap, confidence, needs_review, context_flags, raw_stats_jsonb, is_current",
    )
    .eq("is_current", true);

  if (error) {
    throw new Error(`Failed to read athlete_training_baselines: ${error.message}`);
  }

  const mapped = new Map<string, AthleteTrainingBaselineDbRow>();
  for (const row of (data as AthleteTrainingBaselineDbRow[] | null) ?? []) {
    mapped.set(row.student_id, row);
  }
  return mapped;
}

async function resolveLatestBaselineV2ReportDir(repoRoot: string): Promise<string | null> {
  const baseDir = path.join(repoRoot, "reports", "athlete-training-baseline-v2");
  if (!existsSync(baseDir)) return null;
  const entries = await readdir(baseDir, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory() && /^\d{8}-\d{6}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a));
  if (dirs.length === 0) return null;
  return path.join(baseDir, dirs[0]!);
}

function loadJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function listToCsv(rows: string[][]): string {
  return `${rows
    .map((row) =>
      row
        .map((cell) => {
          const safe = cell ?? "";
          if (safe.includes(",") || safe.includes('"') || safe.includes("\n")) {
            return `"${safe.replaceAll('"', '""')}"`;
          }
          return safe;
        })
        .join(","),
    )
    .join("\n")}\n`;
}

function mapRaceCandidatesFromBaselineV2(row: BaselineV2PerAthlete | null): RaceContextCandidate[] {
  if (!row) return [];
  return row.race_specific_context.race_candidates.map((candidate) => ({
    date: candidate.date ?? null,
    estimated_distance: candidate.estimated_distance ?? null,
    confidence: candidate.confidence ?? null,
    event_name: candidate.event_name ?? candidate.title ?? null,
    source_type: candidate.source_type ?? null,
    distance_km: candidate.distance_km ?? null,
    event_type: candidate.event_type ?? null,
  }));
}

function mapRaceCandidatesFromRaceScan(rows: RaceScanRow[]): Map<number, RaceContextCandidate[]> {
  const byAthlete = new Map<number, RaceContextCandidate[]>();
  for (const row of rows) {
    const athleteId =
      typeof row.athlete_id === "number"
        ? row.athlete_id
        : typeof row.athlete_id === "string"
          ? Number(row.athlete_id)
          : null;
    if (!athleteId || !Number.isInteger(athleteId) || athleteId <= 0) continue;
    const date = row.event_date?.trim();
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const distanceKm = parseDistanceKmValue(row.distance_km ?? row.distance ?? null);
    const estimatedDistance = estimateDistanceFromKm(distanceKm);
    const source: RaceContextCandidate = {
      date,
      estimated_distance: estimatedDistance,
      confidence:
        normalizeRaceScanConfidence(row.confidence) ??
        (estimatedDistance && estimatedDistance !== "unknown" ? "medium" : "low"),
      event_name: row.event_title ?? row.event_name ?? null,
      source_type: row.source_type ?? "events_api",
      event_type: row.sport_type ?? null,
      distance_km: distanceKm,
    };
    const bucket = byAthlete.get(athleteId) ?? [];
    bucket.push(source);
    byAthlete.set(athleteId, bucket);
  }
  for (const [athleteId, bucket] of byAthlete.entries()) {
    bucket.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
    byAthlete.set(athleteId, bucket);
  }
  return byAthlete;
}

function mergeRaceCandidates(
  baseline: RaceContextCandidate[],
  scan: RaceContextCandidate[],
): RaceContextCandidate[] {
  const merged = new Map<string, RaceContextCandidate>();
  for (const candidate of [...baseline, ...scan]) {
    const key = `${candidate.date ?? ""}|${(candidate.event_name ?? "").toLowerCase()}|${candidate.estimated_distance ?? ""}`;
    const previous = merged.get(key);
    if (!previous) {
      merged.set(key, candidate);
      continue;
    }
    const prevConfidence = (previous.confidence ?? "").toLowerCase();
    const nextConfidence = (candidate.confidence ?? "").toLowerCase();
    const best =
      (prevConfidence === "high" ? 3 : prevConfidence === "medium" ? 2 : 1) >=
      (nextConfidence === "high" ? 3 : nextConfidence === "medium" ? 2 : 1)
        ? previous
        : candidate;
    merged.set(key, {
      ...best,
      source_type:
        previous.source_type && candidate.source_type && previous.source_type !== candidate.source_type
          ? "mixed"
          : best.source_type ?? previous.source_type ?? candidate.source_type ?? null,
      distance_km: best.distance_km ?? previous.distance_km ?? candidate.distance_km ?? null,
      event_type: best.event_type ?? previous.event_type ?? candidate.event_type ?? null,
    });
  }
  return [...merged.values()].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
}

function detectUploadIssueSuspected(input: {
  contextFlags: string[];
  notes: string[];
}): boolean {
  const blob = `${input.contextFlags.join(" ")} ${input.notes.join(" ")}`.toLowerCase();
  return /device_upload|gps_only|completed_only|cache_gap|upload_issue|planned_only_running/i.test(blob);
}

function buildPhaseGroups(athletes: AthletePhaseSnapshot[]): Record<string, AthletePhaseSnapshot[]> {
  const groups: Record<string, AthletePhaseSnapshot[]> = {};
  for (const athlete of athletes) {
    const bucket = groups[athlete.detected_context] ?? [];
    bucket.push(athlete);
    groups[athlete.detected_context] = bucket;
  }
  return groups;
}

function buildReadme(report: PhaseSnapshotReport, outputDir: string): string {
  const lines = [
    "# Athlete Phase Snapshot v0",
    "",
    "Read-only TrainingPhase / current situation diagnostic. No DB writes, no TrainingPeaks mutations, no Telegram sends, no plan generation.",
    "",
    `- generated_at: ${report.generated_at}`,
    `- week_start: ${report.week_start}`,
    `- athletes_evaluated: ${report.athlete_count}`,
    `- baseline_v2_source_dir: ${report.baseline_v2_source_dir ?? "none"}`,
    `- operational_signals_included: ${report.operational_signals_included}`,
    `- manual_review_count: ${report.manual_review_count}`,
    `- possible_deload_count: ${report.possible_deload_count}`,
    "",
    "## Counts by detected context",
    "",
  ];

  for (const [context, count] of Object.entries(report.counts_by_detected_context).sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${context}: ${count}`);
  }

  lines.push("", "## Counts by review_level", "");
  for (const [level, count] of Object.entries(report.counts_by_review_level).sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${level}: ${count}`);
  }

  lines.push("", "## Race context summary", "");
  lines.push(`- athletes_with_upcoming_race: ${report.race_context_summary.athletes_with_upcoming_race}`);
  lines.push(`- athletes_with_multiple_races: ${report.race_context_summary.athletes_with_multiple_races}`);
  lines.push(`- athletes_with_marathon_context: ${report.race_context_summary.athletes_with_marathon_context}`);
  lines.push(`- athletes_with_trail_context: ${report.race_context_summary.athletes_with_trail_context}`);
  lines.push(`- athletes_needing_race_confirmation: ${report.race_context_summary.athletes_needing_race_confirmation}`);

  lines.push("", "## Safety", "");
  lines.push("- mode: read_only");
  lines.push("- no_trainingpeaks_mutations: true");
  lines.push("- no_db_writes: true");
  lines.push("- no_telegram_sends: true");
  lines.push("- no_plan_generation: true");
  lines.push("", `Output directory: ${outputDir}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  loadLocalEnv();
  if (!process.env.SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_URL) {
    process.env.SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  }

  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(toolRoot, "..", "..");
  const historyWindow = defaultHistoryWindowBeforeWeekStart(args.weekStart);

  const repoCompat = trainingPeaksRepository as RepositoryCompat;
  const listStudentsFn = repoCompat.listTrainingPeaksStudents ?? repoCompat.default?.listTrainingPeaksStudents;
  const listSignalsFn =
    repoCompat.listActiveTrainingPeaksOperationalSignalsByStudent ??
    repoCompat.default?.listActiveTrainingPeaksOperationalSignalsByStudent;
  if (!listStudentsFn) {
    throw new Error("TrainingPeaks repository student helper is unavailable.");
  }

  const allStudents = await listStudentsFn();
  let selectedStudents: TrainingPeaksStudent[] = allStudents;

  if (args.studentId) {
    selectedStudents = allStudents.filter(
      (student) => student.id === args.studentId || student.studentId === args.studentId,
    );
    if (selectedStudents.length === 0) {
      throw new Error(`Student ${args.studentId} not found among active TrainingPeaks students.`);
    }
  } else if (args.athleteId !== null) {
    selectedStudents = allStudents.filter((student) => {
      const parsed = parseAthleteIdFromUrl(student.trainingPeaksAthleteUrl);
      return parsed === args.athleteId;
    });
    if (selectedStudents.length === 0) {
      throw new Error(`Athlete ${args.athleteId} not found among active TrainingPeaks students.`);
    }
  } else if (args.allActiveStudents) {
    selectedStudents = allStudents;
  }

  const baselineV2Dir = await resolveLatestBaselineV2ReportDir(repoRoot);
  let baselineV2ByAthleteId = new Map<number, BaselineV2PerAthlete>();
  if (baselineV2Dir) {
    const perAthletePath = path.join(baselineV2Dir, "per-athlete-baseline-v2.json");
    if (existsSync(perAthletePath)) {
      const perAthlete = loadJson<BaselineV2PerAthlete[]>(perAthletePath);
      baselineV2ByAthleteId = new Map(perAthlete.map((row) => [row.athlete_id, row]));
    }
  }

  let raceScanByAthleteId = new Map<number, RaceContextCandidate[]>();
  if (args.raceScanDir) {
    const raceScanDir = path.resolve(repoRoot, args.raceScanDir);
    const raceScanPath = path.join(raceScanDir, "races.json");
    if (existsSync(raceScanPath)) {
      const raceScan = loadJson<RaceScanJson>(raceScanPath);
      raceScanByAthleteId = mapRaceCandidatesFromRaceScan(raceScan.rows ?? []);
    } else {
      throw new Error(`--race-scan-dir provided but races.json was not found: ${raceScanPath}`);
    }
  }

  const baselinesByStudentId = await fetchCurrentBaselinesByStudentId();
  let operationalSignalsUnavailableReason: string | null = null;
  const athletes: AthletePhaseSnapshot[] = [];

  for (const student of selectedStudents) {
    const athleteId = parseAthleteIdFromUrl(student.trainingPeaksAthleteUrl);
    if (!athleteId) {
      athletes.push(
        detectTrainingPhaseV0({
          week_start: args.weekStart,
          name: student.studentName,
          athlete_id: null,
          student_id: student.id,
          workouts: [],
          operational_signals: [],
          baseline: null,
          race_context: null,
          schedule_constrained: false,
        }),
      );
      continue;
    }

    const cacheRows = await fetchWorkoutCacheRows({
      studentId: student.id,
      athleteId,
      from: historyWindow.from,
      to: args.weekStart,
    });
    const diagnosticWorkouts = cacheRows.filter(isCompletedRunningWorkout).map(diagnoseWorkoutRow);

    let operationalSignals: TrainingPeaksStudentOperationalSignal[] = [];
    if (listSignalsFn) {
      try {
        operationalSignals = await listSignalsFn(student.id);
      } catch (error) {
        operationalSignalsUnavailableReason =
          error instanceof Error ? error.message : "Failed to load operational signals";
        operationalSignals = [];
      }
    } else {
      operationalSignalsUnavailableReason =
        operationalSignalsUnavailableReason ??
        "listActiveTrainingPeaksOperationalSignalsByStudent helper unavailable";
    }

    const baselineDb = baselinesByStudentId.get(student.id) ?? null;
    const baselineV2 = baselineV2ByAthleteId.get(athleteId) ?? null;
    const contextFlags = baselineV2?.context_flags ?? baselineDb?.context_flags ?? [];
    const scheduleConstrained = contextFlags.some((flag) =>
      /schedule|constraint|travel|availability/i.test(flag),
    );

    const baselineRaceCandidates = mapRaceCandidatesFromBaselineV2(baselineV2);
    const scanRaceCandidates = raceScanByAthleteId.get(athleteId) ?? [];
    const mergedRaceCandidates = mergeRaceCandidates(baselineRaceCandidates, scanRaceCandidates);
    const snapshot = detectTrainingPhaseV0({
        week_start: args.weekStart,
        name: student.studentName,
        athlete_id: athleteId,
        student_id: student.id,
        workouts: diagnosticWorkouts,
        operational_signals: operationalSignals,
        baseline: {
          confidence: baselineV2?.confidence ?? baselineDb?.confidence ?? null,
          needs_review: baselineV2?.needs_review ?? baselineDb?.needs_review ?? false,
          frequency_cap: baselineV2?.normal_baseline.frequency_cap ?? baselineDb?.frequency_cap ?? null,
          quality_count_cap: baselineV2?.normal_baseline.quality_count_cap ?? baselineDb?.quality_count_cap ?? null,
          recent_4w_frequency: baselineV2?.active_training_window?.recent_4w_frequency ?? null,
          context_flags: contextFlags,
        },
        race_context: {
          candidates: mergedRaceCandidates,
        },
        schedule_constrained: scheduleConstrained,
      });
    if (snapshot.recent_training_summary.completed_runs === 0) {
      snapshot.data_visibility_status = detectUploadIssueSuspected({
        contextFlags,
        notes: baselineV2?.notes ?? [],
      })
        ? "device_upload_issue_suspected"
        : "no_completed_data";
    } else if (snapshot.data_visibility_status !== "normal") {
      snapshot.data_visibility_status = "normal";
    }
    athletes.push(snapshot);
  }

  const countsByDetectedContext: Record<string, number> = {};
  const countsByReviewLevel: Record<ReviewLevel, number> = {
    none: 0,
    info: 0,
    coach_review: 0,
    hard_block: 0,
  };
  for (const athlete of athletes) {
    countsByDetectedContext[athlete.detected_context] = (countsByDetectedContext[athlete.detected_context] ?? 0) + 1;
    countsByReviewLevel[athlete.review_level] += 1;
  }

  const raceContextSummary = {
    athletes_with_upcoming_race: athletes.filter((athlete) => athlete.race_context.upcoming_race_detected).length,
    athletes_with_multiple_races: athletes.filter((athlete) => athlete.race_context.upcoming_races_count > 1).length,
    athletes_with_marathon_context: athletes.filter((athlete) =>
      athlete.race_context.all_upcoming_races_preview.some((race) => race.distance === "marathon"),
    ).length,
    athletes_with_trail_context: athletes.filter((athlete) =>
      athlete.race_context.all_upcoming_races_preview.some((race) => race.type === "trail"),
    ).length,
    athletes_needing_race_confirmation: athletes.filter((athlete) => athlete.race_context.race_context_needs_confirmation)
      .length,
  };

  const report: PhaseSnapshotReport = {
    generated_at: new Date().toISOString(),
    week_start: args.weekStart,
    athlete_count: athletes.length,
    baseline_v2_source_dir: baselineV2Dir,
    operational_signals_included: operationalSignalsUnavailableReason === null,
    operational_signals_unavailable_reason: operationalSignalsUnavailableReason,
    counts_by_detected_context: countsByDetectedContext,
    counts_by_review_level: countsByReviewLevel,
    race_context_summary: raceContextSummary,
    manual_review_count: athletes.filter((athlete) => athlete.flags.manual_review_required).length,
    possible_deload_count: athletes.filter((athlete) => athlete.flags.possible_deload_recommended).length,
    safety: PHASE_DETECTOR_SAFETY_MARKERS,
    athletes,
  };

  const outputDir = path.join(repoRoot, "reports", "athlete-phase-snapshot-v0", timestampForPath(new Date()));
  await mkdir(outputDir, { recursive: true });

  const summary = {
    ...report,
    athletes: undefined,
    students: athletes,
  };
  delete (summary as { athletes?: AthletePhaseSnapshot[] }).athletes;

  await writeFile(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await writeFile(path.join(outputDir, "students.json"), `${JSON.stringify(athletes, null, 2)}\n`, "utf8");
  await writeFile(path.join(outputDir, "phase-groups.json"), `${JSON.stringify(buildPhaseGroups(athletes), null, 2)}\n`, "utf8");

  const summaryCsvRows: string[][] = [
    [
      "athlete_id",
      "student_id",
      "name",
      "detected_context",
      "confidence",
      "review_level",
      "manual_review_required",
      "possible_deload_recommended",
      "last_quality_date",
      "last_quality_type",
      "recommendation_summary",
      "data_visibility_status",
      "upcoming_race_detected",
      "upcoming_races_count",
      "next_race_date",
      "next_race_name",
      "next_race_distance",
      "next_race_type",
      "weeks_to_next_race",
      "race_confidence",
      "race_context_needs_confirmation",
      "all_upcoming_races_preview",
    ],
    ...athletes.map((athlete) => [
      String(athlete.athlete_id ?? ""),
      athlete.student_id ?? "",
      athlete.name,
      athlete.detected_context,
      athlete.confidence,
      athlete.review_level,
      String(athlete.flags.manual_review_required),
      String(athlete.flags.possible_deload_recommended),
      athlete.recent_training_summary.last_quality_date ?? "",
      athlete.recent_training_summary.last_quality_type ?? "",
      athlete.recommendation.summary,
      athlete.data_visibility_status,
      String(athlete.race_context.upcoming_race_detected),
      String(athlete.race_context.upcoming_races_count),
      athlete.race_context.next_race_date ?? "",
      athlete.race_context.next_race_name ?? "",
      athlete.race_context.next_race_distance ?? "",
      athlete.race_context.next_race_type ?? "",
      String(athlete.race_context.weeks_to_next_race ?? ""),
      athlete.race_context.race_confidence ?? "",
      String(athlete.race_context.race_context_needs_confirmation),
      athlete.race_context.all_upcoming_races_preview
        .map((race) => `${race.date}:${race.name ?? "n/a"}:${race.distance ?? "unknown"}:${race.type ?? "unknown"}`)
        .join(" | "),
    ]),
  ];
  await writeFile(path.join(outputDir, "summary.csv"), listToCsv(summaryCsvRows), "utf8");

  const manualReviewRows: string[][] = [
    [
      "athlete_id",
      "name",
      "detected_context",
      "review_level",
      "confidence",
      "review_reasons",
      "evidence",
      "recommendation_summary",
    ],
    ...athletes
      .filter((athlete) => athlete.flags.manual_review_required)
      .map((athlete) => [
        String(athlete.athlete_id ?? ""),
        athlete.name,
        athlete.detected_context,
        athlete.review_level,
        athlete.confidence,
        athlete.review_reasons.join(" | "),
        athlete.evidence.join(" | "),
        athlete.recommendation.summary,
      ]),
  ];
  await writeFile(path.join(outputDir, "manual-review.csv"), listToCsv(manualReviewRows), "utf8");

  const hardBlockRows: string[][] = [
    ["athlete_id", "name", "detected_context", "review_reasons", "evidence", "recommendation_summary"],
    ...athletes
      .filter((athlete) => athlete.review_level === "hard_block")
      .map((athlete) => [
        String(athlete.athlete_id ?? ""),
        athlete.name,
        athlete.detected_context,
        athlete.review_reasons.join(" | "),
        athlete.evidence.join(" | "),
        athlete.recommendation.summary,
      ]),
  ];
  await writeFile(path.join(outputDir, "hard-block.csv"), listToCsv(hardBlockRows), "utf8");

  const coachReviewRows: string[][] = [
    ["athlete_id", "name", "detected_context", "review_reasons", "evidence", "recommendation_summary"],
    ...athletes
      .filter((athlete) => athlete.review_level === "coach_review")
      .map((athlete) => [
        String(athlete.athlete_id ?? ""),
        athlete.name,
        athlete.detected_context,
        athlete.review_reasons.join(" | "),
        athlete.evidence.join(" | "),
        athlete.recommendation.summary,
      ]),
  ];
  await writeFile(path.join(outputDir, "coach-review.csv"), listToCsv(coachReviewRows), "utf8");

  const infoOnlyRows: string[][] = [
    ["athlete_id", "name", "detected_context", "review_reasons", "evidence", "recommendation_summary"],
    ...athletes
      .filter((athlete) => athlete.review_level === "info")
      .map((athlete) => [
        String(athlete.athlete_id ?? ""),
        athlete.name,
        athlete.detected_context,
        athlete.review_reasons.join(" | "),
        athlete.evidence.join(" | "),
        athlete.recommendation.summary,
      ]),
  ];
  await writeFile(path.join(outputDir, "info-only.csv"), listToCsv(infoOnlyRows), "utf8");

  const cleanRows: string[][] = [
    ["athlete_id", "name", "detected_context", "confidence", "recommendation_summary"],
    ...athletes
      .filter((athlete) => athlete.review_level === "none")
      .map((athlete) => [
        String(athlete.athlete_id ?? ""),
        athlete.name,
        athlete.detected_context,
        athlete.confidence,
        athlete.recommendation.summary,
      ]),
  ];
  await writeFile(path.join(outputDir, "clean.csv"), listToCsv(cleanRows), "utf8");

  const deloadRows: string[][] = [
    ["athlete_id", "name", "consecutive_quality_weeks", "evidence", "recommendation_summary"],
    ...athletes
      .filter((athlete) => athlete.flags.possible_deload_recommended)
      .map((athlete) => [
        String(athlete.athlete_id ?? ""),
        athlete.name,
        String(athlete.recent_training_summary.consecutive_quality_weeks ?? ""),
        athlete.evidence.filter((item) => /deload|quality weeks/i.test(item)).join(" | "),
        athlete.recommendation.summary,
      ]),
  ];
  await writeFile(path.join(outputDir, "possible-deload-review.csv"), listToCsv(deloadRows), "utf8");

  const illnessRows: string[][] = [
    ["athlete_id", "name", "active_illness", "illness_return_week", "recommendation_summary"],
    ...athletes
      .filter((athlete) => athlete.flags.active_illness || athlete.flags.illness_return_week)
      .map((athlete) => [
        String(athlete.athlete_id ?? ""),
        athlete.name,
        String(athlete.flags.active_illness),
        String(athlete.flags.illness_return_week),
        athlete.recommendation.summary,
      ]),
  ];
  await writeFile(path.join(outputDir, "return-after-illness.csv"), listToCsv(illnessRows), "utf8");

  const raceRows: string[][] = [
    [
      "athlete_id",
      "name",
      "detected_context",
      "review_level",
      "upcoming_race_detected",
      "upcoming_races_count",
      "next_race_date",
      "next_race_name",
      "next_race_distance",
      "next_race_type",
      "weeks_to_next_race",
      "race_confidence",
      "race_context_needs_confirmation",
      "marathon_specific_requires_review",
      "all_upcoming_races_preview",
      "evidence",
    ],
    ...athletes
      .filter((athlete) => {
        const hasTrail = athlete.race_context.all_upcoming_races_preview.some((race) => race.type === "trail");
        return (
          athlete.race_context.upcoming_race_detected ||
          athlete.flags.race_context_needs_confirmation ||
          athlete.race_context.upcoming_races_count > 1 ||
          athlete.flags.marathon_specific_requires_review ||
          hasTrail ||
          athlete.detected_context === "race_specific_context" ||
          athlete.detected_context === "taper_context"
        );
      })
      .map((athlete) => [
        String(athlete.athlete_id ?? ""),
        athlete.name,
        athlete.detected_context,
        athlete.review_level,
        String(athlete.race_context.upcoming_race_detected),
        String(athlete.race_context.upcoming_races_count),
        athlete.race_context.next_race_date ?? "",
        athlete.race_context.next_race_name ?? "",
        athlete.race_context.next_race_distance ?? "",
        athlete.race_context.next_race_type ?? "",
        String(athlete.race_context.weeks_to_next_race ?? ""),
        athlete.race_context.race_confidence ?? "",
        String(athlete.flags.race_context_needs_confirmation),
        String(athlete.flags.marathon_specific_requires_review),
        athlete.race_context.all_upcoming_races_preview
          .map((race) => `${race.date}:${race.name ?? "n/a"}:${race.distance ?? "unknown"}:${race.type ?? "unknown"}`)
          .join(" | "),
        athlete.evidence.filter((item) => /race|marathon|taper|trail/i.test(item)).join(" | "),
      ]),
  ];
  await writeFile(path.join(outputDir, "race-context-review.csv"), listToCsv(raceRows), "utf8");

  const lowConfidenceRows: string[][] = [
    ["athlete_id", "name", "detected_context", "confidence", "completed_runs", "evidence"],
    ...athletes
      .filter((athlete) => athlete.confidence === "low" || athlete.detected_context === "manual_review_unknown")
      .map((athlete) => [
        String(athlete.athlete_id ?? ""),
        athlete.name,
        athlete.detected_context,
        athlete.confidence,
        String(athlete.recent_training_summary.completed_runs),
        athlete.evidence.join(" | "),
      ]),
  ];
  await writeFile(path.join(outputDir, "low-confidence.csv"), listToCsv(lowConfidenceRows), "utf8");
  await writeFile(path.join(outputDir, "README.md"), buildReadme(report, outputDir), "utf8");

  if (args.json) {
    console.log(JSON.stringify({ output_dir: outputDir, report }, null, 2));
  } else {
    console.log(`Athlete phase snapshot v0 complete: ${outputDir}`);
    console.log(`Athletes evaluated: ${report.athlete_count}`);
    console.log(`Manual review: ${report.manual_review_count}`);
    console.log(`Possible deload flags: ${report.possible_deload_count}`);
    console.log("Counts by review_level:");
    for (const [level, count] of Object.entries(report.counts_by_review_level).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${level}: ${count}`);
    }
    console.log("Counts by detected_context:");
    for (const [context, count] of Object.entries(report.counts_by_detected_context).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${context}: ${count}`);
    }
    console.log("Race context summary:");
    console.log(`  athletes_with_upcoming_race: ${report.race_context_summary.athletes_with_upcoming_race}`);
    console.log(`  athletes_with_multiple_races: ${report.race_context_summary.athletes_with_multiple_races}`);
    console.log(`  athletes_with_marathon_context: ${report.race_context_summary.athletes_with_marathon_context}`);
    console.log(`  athletes_with_trail_context: ${report.race_context_summary.athletes_with_trail_context}`);
    console.log(
      `  athletes_needing_race_confirmation: ${report.race_context_summary.athletes_needing_race_confirmation}`,
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
