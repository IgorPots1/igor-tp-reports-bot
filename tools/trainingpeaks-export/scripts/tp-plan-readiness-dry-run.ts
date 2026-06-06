import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import type { TrainingPeaksStudent, TrainingPeaksStudentOperationalSignal } from "../../../src/features/trainingpeaks/repository.ts";
import * as trainingPeaksRepository from "../../../src/features/trainingpeaks/repository.ts";
import { analyzePlannedVsCompletedFrequency } from "./lib/planned-vs-completed-frequency.ts";
import { toolRoot } from "./lib/paths.ts";

type Decision = "ready_for_plan" | "needs_coach_review" | "blocked";
type BaselineConfidence = "low" | "medium" | "high";

type CliArgs = {
  asOf: string;
  athleteId: number | null;
  athleteIds: number[];
  sampleSafe: boolean;
  baselineReportDir: string | null;
  maxAthletes: number;
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

type BaselineV2PerAthlete = {
  student_name: string;
  student_id: string;
  athlete_id: number;
  normal_baseline: {
    frequency_cap: number | null;
    weekly_minutes_cap: number | null;
    long_run_cap_min: number | null;
    quality_count_cap: number | null;
  };
  planned_context_baseline: {
    frequency_cap: number | null;
    weekly_minutes_cap: number | null;
  };
  confidence: BaselineConfidence;
  needs_review: boolean;
  notes: string[];
  context_flags: string[];
  baseline_source: string;
  active_training_window?: {
    baseline_period_type: string;
    recent_4w_frequency: number | null;
    all_window_frequency: number | null;
    active_window_frequency: number | null;
    normal_week_frequency: number | null;
  };
  completed_vs_planned_divergence: {
    planned_only_running_workouts: number;
  };
  baseline_change_vs_planned_context: {
    materially_changed: boolean;
  };
  race_specific_context: {
    race_candidate_count: number;
    race_candidates: Array<{
      source_type?: "keyword" | "events_api" | "mixed";
      event_name?: string | null;
      date?: string | null;
      confidence?: string;
      confirmed_by_workout?: boolean;
    }>;
  };
};

type AthleteTrainingBaselineDbRow = {
  student_id: string;
  trainingpeaks_athlete_id: string | null;
  frequency_cap: number | null;
  weekly_minutes_cap: number | null;
  long_run_cap_min: number | null;
  quality_count_cap: number | null;
  confidence: BaselineConfidence | null;
  baseline_source?: string | null;
  raw_stats_jsonb: Record<string, unknown> | null;
  is_current: boolean;
  is_manually_overridden: boolean;
  needs_review: boolean;
  context_flags: string[] | null;
  trainingpeaks_students?:
    | { student_name?: string | null; student_id?: string | null }
    | Array<{ student_name?: string | null; student_id?: string | null }>
    | null;
};

type ReadinessRow = {
  athlete_id: number;
  student_id: string;
  name: string;
  decision: Decision;
  confidence: BaselineConfidence | "unknown";
  reasons: string[];
  blocking_reasons: string[];
  review_reasons: string[];
  frequency_cap: number | null;
  weekly_minutes_cap: number | null;
  long_run_cap_min: number | null;
  quality_count_cap: number | null;
  actual_completed_frequency: number | null;
  planned_context_frequency: number | null;
  planned_vs_completed_delta: number | null;
  recent_4w_frequency: number | null;
  active_baseline_period: string | null;
  race_context_summary: string;
  operational_signal_summary: string;
  data_quality_summary: string;
};

type ReadinessReport = {
  generated_at: string;
  mode: "dry-run";
  read_only: true;
  no_db_writes: true;
  no_trainingpeaks_mutations: true;
  no_telegram_sends: true;
  as_of: string;
  source_report_dir: string;
  athlete_count: number;
  counts: {
    ready_for_plan: number;
    needs_coach_review: number;
    blocked: number;
  };
  operational_signals: {
    included: boolean;
    unavailable_reason: string | null;
  };
  athletes: ReadinessRow[];
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

function printHelp(): void {
  console.log("Training plan readiness dry-run (read-only)");
  console.log("");
  console.log("Usage:");
  console.log(
    "  npx tsx tools/trainingpeaks-export/scripts/tp-plan-readiness-dry-run.ts --athlete-id 5621054 --as-of 2026-06-06",
  );
  console.log(
    "  npx tsx tools/trainingpeaks-export/scripts/tp-plan-readiness-dry-run.ts --athlete-ids 5621054,5928404,6309121 --as-of 2026-06-06",
  );
  console.log("");
  console.log("Optional:");
  console.log("  --sample-safe --max-athletes 5 --baseline-report-dir reports/athlete-training-baseline-v2/20260606-091920 --json");
  console.log("");
  console.log("Safety:");
  console.log("  - read-only");
  console.log("  - no DB writes");
  console.log("  - no TrainingPeaks mutations");
  console.log("  - no Telegram sends");
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    asOf: validateIsoDate(new Date().toISOString().slice(0, 10), "--as-of"),
    athleteId: null,
    athleteIds: [],
    sampleSafe: false,
    baselineReportDir: null,
    maxAthletes: 5,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg.startsWith("--as-of=")) {
      parsed.asOf = validateIsoDate(arg.slice("--as-of=".length).trim(), "--as-of");
      continue;
    }
    if (arg === "--as-of") {
      parsed.asOf = validateIsoDate((argv[index + 1] ?? "").trim(), "--as-of");
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
    if (arg.startsWith("--athlete-ids=")) {
      const raw = arg.slice("--athlete-ids=".length).trim();
      parsed.athleteIds = raw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => parseAthleteId(item, "--athlete-ids"));
      continue;
    }
    if (arg === "--athlete-ids") {
      const raw = (argv[index + 1] ?? "").trim();
      parsed.athleteIds = raw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => parseAthleteId(item, "--athlete-ids"));
      index += 1;
      continue;
    }
    if (arg === "--sample-safe") {
      parsed.sampleSafe = true;
      continue;
    }
    if (arg.startsWith("--max-athletes=")) {
      parsed.maxAthletes = Number(arg.slice("--max-athletes=".length));
      continue;
    }
    if (arg === "--max-athletes") {
      parsed.maxAthletes = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--baseline-report-dir=")) {
      parsed.baselineReportDir = arg.slice("--baseline-report-dir=".length).trim() || null;
      continue;
    }
    if (arg === "--baseline-report-dir") {
      parsed.baselineReportDir = (argv[index + 1] ?? "").trim() || null;
      index += 1;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(parsed.maxAthletes) || parsed.maxAthletes < 1 || parsed.maxAthletes > 20) {
    throw new Error("Invalid --max-athletes. Expected integer 1..20.");
  }
  return parsed;
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

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ").replace(/ё/gu, "е");
}

async function resolveLatestBaselineReportDir(repoRoot: string): Promise<string> {
  const baseDir = path.join(repoRoot, "reports", "athlete-training-baseline-v2");
  const entries = await readdir(baseDir, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory() && /^\d{8}-\d{6}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a));
  if (dirs.length === 0) {
    throw new Error(`No report directories found in ${baseDir}`);
  }
  return path.join(baseDir, dirs[0]!);
}

function loadJson<T>(filePath: string): T {
  if (!existsSync(filePath)) {
    throw new Error(`Required file not found: ${filePath}`);
  }
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

async function fetchCurrentBaselinesByAthleteIdReadOnly(): Promise<Map<number, AthleteTrainingBaselineDbRow>> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("athlete_training_baselines")
    .select(
      "student_id, trainingpeaks_athlete_id, frequency_cap, weekly_minutes_cap, long_run_cap_min, quality_count_cap, confidence, raw_stats_jsonb, is_current, is_manually_overridden, needs_review, context_flags, trainingpeaks_students(student_name, student_id)",
    )
    .eq("is_current", true);

  if (error) {
    throw new Error(`Failed to read current athlete_training_baselines: ${error.message}`);
  }

  const rows = (data as AthleteTrainingBaselineDbRow[] | null) ?? [];
  const mapped = new Map<number, AthleteTrainingBaselineDbRow>();
  for (const row of rows) {
    const athleteId = Number(row.trainingpeaks_athlete_id);
    if (!Number.isInteger(athleteId) || athleteId <= 0) continue;
    mapped.set(athleteId, row);
  }
  return mapped;
}

function chooseSampleSafeAthletes(perAthlete: BaselineV2PerAthlete[], maxAthletes: number): number[] {
  const preferredNames = [
    "Eseniya Degtyareva",
    "Veronika Ashrapova",
    "Igor Klimovich",
    "Anna Kruglova",
    "Nastya Bunyakina",
    "Anna Kukushkina",
    "Elena Titskaia",
    "Anna Chernysheva",
  ];
  const avoidNames = [
    "Aleksandra Tararova",
    "Aleksandr Sorokin",
    "Yulia Krylova",
    "Anastasia Abramova",
    "Irina Melnikova",
    "Alex",
    "Igor Potseluev",
  ];
  const byName = new Map(perAthlete.map((row) => [normalizeName(row.student_name), row]));
  const avoid = new Set(avoidNames.map(normalizeName));
  const selected: number[] = [];

  for (const name of preferredNames) {
    const row = byName.get(normalizeName(name));
    if (!row) continue;
    if (avoid.has(normalizeName(row.student_name))) continue;
    if (row.needs_review) continue;
    if (row.confidence === "low") continue;
    if (selected.includes(row.athlete_id)) continue;
    selected.push(row.athlete_id);
    if (selected.length >= maxAthletes) return selected;
  }

  for (const row of perAthlete) {
    if (avoid.has(normalizeName(row.student_name))) continue;
    if (row.needs_review) continue;
    if (row.confidence === "low") continue;
    if (selected.includes(row.athlete_id)) continue;
    selected.push(row.athlete_id);
    if (selected.length >= maxAthletes) break;
  }
  return selected;
}

function toRounded(value: number | null): number | null {
  if (value === null) return null;
  return Math.max(0, Math.round(value));
}

function extractHealthFlags(signals: TrainingPeaksStudentOperationalSignal[]): {
  hasActiveIllness: boolean;
  hasActivePainInjury: boolean;
  hasReturnMonitoring: boolean;
  hasRequiresCoachClose: boolean;
  summaryParts: string[];
} {
  const activeSignals = signals.filter((signal) => signal.status === "active");
  const hasActiveIllness = activeSignals.some((signal) =>
    signal.signalType === "health_issue_started" ||
    signal.lifecycleState === "active_problem" ||
    signal.structuredPayload.health_state === "sick",
  );
  const hasActivePainInjury = activeSignals.some((signal) => signal.signalType === "pain_injury");
  const hasReturnMonitoring = activeSignals.some((signal) =>
    signal.signalType === "health_issue_improving" ||
    signal.lifecycleState === "monitoring_after_return" ||
    signal.lifecycleState === "return_planned" ||
    signal.lifecycleState === "return_trial_completed",
  );
  const hasRequiresCoachClose = activeSignals.some((signal) => signal.requiresCoachClose === true);
  const summaryParts = [
    `active_signals=${activeSignals.length}`,
    hasActiveIllness ? "active_illness=true" : "active_illness=false",
    hasActivePainInjury ? "active_pain_injury=true" : "active_pain_injury=false",
    hasReturnMonitoring ? "return_monitoring=true" : "return_monitoring=false",
    hasRequiresCoachClose ? "requires_coach_close=true" : "requires_coach_close=false",
  ];
  return {
    hasActiveIllness,
    hasActivePainInjury,
    hasReturnMonitoring,
    hasRequiresCoachClose,
    summaryParts,
  };
}

function buildRaceContextSummary(row: BaselineV2PerAthlete): string {
  const raceCount = row.race_specific_context.race_candidate_count;
  const eventsApiCount = row.race_specific_context.race_candidates.filter((item) => item.source_type === "events_api").length;
  const keywordCount = row.race_specific_context.race_candidates.filter((item) => item.source_type === "keyword").length;
  if (raceCount === 0) return "no_detected_race_context";
  return `race_candidates=${raceCount}; events_api=${eventsApiCount}; keyword=${keywordCount}`;
}

function buildDataQualitySummary(flags: string[]): string {
  if (flags.length === 0) return "no_data_quality_flags";
  return flags.join(", ");
}

function detectSelfProfile(athleteId: number, name: string): boolean {
  return athleteId === 3102415 || normalizeName(name) === "igor potseluev";
}

function buildMarkdown(report: ReadinessReport): string {
  const lines: string[] = [];
  lines.push("# PLAN READINESS DRY RUN");
  lines.push("");
  lines.push("Read-only diagnostic report. No DB writes, no TrainingPeaks mutations, no Telegram sends.");
  lines.push("");
  lines.push(`- as_of: ${report.as_of}`);
  lines.push(`- generated_at: ${report.generated_at}`);
  lines.push(`- source_report_dir: ${report.source_report_dir}`);
  lines.push(`- athletes_evaluated: ${report.athlete_count}`);
  lines.push(`- operational_signals_included: ${report.operational_signals.included}`);
  if (report.operational_signals.unavailable_reason) {
    lines.push(`- operational_signals_unavailable_reason: ${report.operational_signals.unavailable_reason}`);
  }
  lines.push("");
  lines.push("## Decision Summary");
  lines.push(`- Ready for plan: ${report.counts.ready_for_plan}`);
  lines.push(`- Needs coach review: ${report.counts.needs_coach_review}`);
  lines.push(`- Blocked: ${report.counts.blocked}`);
  lines.push("");
  lines.push("## Per-Athlete Decisions");
  for (const athlete of report.athletes) {
    lines.push(`### ${athlete.name} (${athlete.athlete_id})`);
    lines.push(`- decision: ${athlete.decision}`);
    lines.push(`- confidence: ${athlete.confidence}`);
    lines.push(`- reasons: ${athlete.reasons.join(", ") || "none"}`);
    lines.push(`- blocking_reasons: ${athlete.blocking_reasons.join(", ") || "none"}`);
    lines.push(`- review_reasons: ${athlete.review_reasons.join(", ") || "none"}`);
    lines.push(
      `- caps: frequency=${athlete.frequency_cap ?? "n/a"}, weekly_minutes=${athlete.weekly_minutes_cap ?? "n/a"}, long_run=${athlete.long_run_cap_min ?? "n/a"}, quality=${athlete.quality_count_cap ?? "n/a"}`,
    );
    lines.push(
      `- layers: actual_completed_frequency=${athlete.actual_completed_frequency ?? "n/a"}, planned_context_frequency=${athlete.planned_context_frequency ?? "n/a"}, planned_vs_completed_delta=${athlete.planned_vs_completed_delta ?? "n/a"}, recent_4w_frequency=${athlete.recent_4w_frequency ?? "n/a"}, active_baseline_period=${athlete.active_baseline_period ?? "n/a"}`,
    );
    lines.push(`- race_context_summary: ${athlete.race_context_summary}`);
    lines.push(`- operational_signal_summary: ${athlete.operational_signal_summary}`);
    lines.push(`- data_quality_summary: ${athlete.data_quality_summary}`);
    lines.push("");
  }
  lines.push("## Safety Confirmation");
  lines.push("- No DB writes.");
  lines.push("- No TrainingPeaks mutations.");
  lines.push("- No workout creation/move/delete/edit.");
  lines.push("- No Telegram sends.");
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
  const sourceReportDir = args.baselineReportDir
    ? path.resolve(repoRoot, args.baselineReportDir)
    : await resolveLatestBaselineReportDir(repoRoot);
  const perAthletePath = path.join(sourceReportDir, "per-athlete-baseline-v2.json");
  const perAthlete = loadJson<BaselineV2PerAthlete[]>(perAthletePath);

  const byAthleteId = new Map(perAthlete.map((row) => [row.athlete_id, row]));
  const selectedAthleteIds: number[] = [];
  if (args.athleteId !== null) {
    selectedAthleteIds.push(args.athleteId);
  }
  for (const athleteId of args.athleteIds) {
    if (!selectedAthleteIds.includes(athleteId)) selectedAthleteIds.push(athleteId);
  }
  if (args.sampleSafe && selectedAthleteIds.length === 0) {
    selectedAthleteIds.push(...chooseSampleSafeAthletes(perAthlete, args.maxAthletes));
  }
  if (selectedAthleteIds.length === 0) {
    throw new Error("No athletes selected. Use --athlete-id, --athlete-ids, or --sample-safe.");
  }

  const selectedRows: BaselineV2PerAthlete[] = selectedAthleteIds.map((athleteId) => {
    const row = byAthleteId.get(athleteId);
    if (!row) throw new Error(`Athlete ${athleteId} not found in ${perAthletePath}`);
    return row;
  });

  const currentBaselinesMap = await fetchCurrentBaselinesByAthleteIdReadOnly();
  const repoCompat = trainingPeaksRepository as RepositoryCompat;
  const listStudentsFn = repoCompat.listTrainingPeaksStudents ?? repoCompat.default?.listTrainingPeaksStudents;
  const listSignalsFn =
    repoCompat.listActiveTrainingPeaksOperationalSignalsByStudent ??
    repoCompat.default?.listActiveTrainingPeaksOperationalSignalsByStudent;
  if (!listStudentsFn) {
    throw new Error("TrainingPeaks repository student helper is unavailable.");
  }
  const students = await listStudentsFn();
  const studentsById = new Map(students.map((student) => [student.id, student]));

  let operationalSignalsUnavailableReason: string | null = null;
  const signalsByStudentId = new Map<string, TrainingPeaksStudentOperationalSignal[]>();
  if (listSignalsFn) {
    for (const row of selectedRows) {
      try {
        signalsByStudentId.set(row.student_id, await listSignalsFn(row.student_id));
      } catch (error) {
        operationalSignalsUnavailableReason =
          error instanceof Error ? error.message : "Failed to load operational signals";
        signalsByStudentId.clear();
        break;
      }
    }
  } else {
    operationalSignalsUnavailableReason = "listActiveTrainingPeaksOperationalSignalsByStudent helper unavailable";
  }

  const results: ReadinessRow[] = [];
  for (const row of selectedRows) {
    const baselineDb = currentBaselinesMap.get(row.athlete_id) ?? null;
    const student = studentsById.get(row.student_id) ?? null;
    const signals = signalsByStudentId.get(row.student_id) ?? [];
    const signalFlags = extractHealthFlags(signals);
    const blockingReasons = new Set<string>();
    const reviewReasons = new Set<string>();
    const dataQualityFlags = new Set<string>();

    const actualCompletedFrequency = row.active_training_window?.normal_week_frequency ?? null;
    const plannedContextFrequency = row.planned_context_baseline.frequency_cap;
    const recent4wFrequency = row.active_training_window?.recent_4w_frequency ?? null;
    const plannedVsCompleted = analyzePlannedVsCompletedFrequency({
      actualCompletedFrequency,
      plannedContextFrequency,
      plannedContextWeeklyMinutes: row.planned_context_baseline.weekly_minutes_cap,
      plannedOnlyRunningWorkouts: row.completed_vs_planned_divergence.planned_only_running_workouts,
      activeWindowFrequency: row.active_training_window?.active_window_frequency ?? null,
      allWindowFrequency: row.active_training_window?.all_window_frequency ?? null,
      recent4wFrequency,
    });

    const frequencyCap = toRounded(row.normal_baseline.frequency_cap);
    const weeklyMinutesCap = toRounded(row.normal_baseline.weekly_minutes_cap);
    const longRunCap = toRounded(row.normal_baseline.long_run_cap_min);
    const qualityCountCap = toRounded(row.normal_baseline.quality_count_cap);

    if (!baselineDb || !baselineDb.is_current) {
      blockingReasons.add("missing_current_baseline");
    }
    if (baselineDb?.is_manually_overridden) {
      blockingReasons.add("manual_override_conflict");
    }
    if (detectSelfProfile(row.athlete_id, row.student_name)) {
      blockingReasons.add("self_test_profile");
    }
    if (signalFlags.hasActiveIllness) {
      blockingReasons.add("active_illness");
    }
    if (signalFlags.hasActivePainInjury) {
      blockingReasons.add("active_pain_injury");
    }
    if (row.notes.some((note) => note.includes("device_upload")) || row.context_flags.includes("device_upload_issue")) {
      blockingReasons.add("device_upload_issue");
      dataQualityFlags.add("device_upload_issue");
    }

    if (row.normal_training_weeks_count < 4) {
      blockingReasons.add("no_reliable_completed_data");
      dataQualityFlags.add("completed_data_incomplete");
    }
    if (row.confidence === "low" || baselineDb?.confidence === "low") {
      reviewReasons.add("low_confidence_baseline");
    }
    if (row.needs_review || baselineDb?.needs_review) {
      reviewReasons.add("baseline_marked_needs_review");
    }
    if (signalFlags.hasReturnMonitoring) {
      reviewReasons.add("recent_return_to_training_monitoring");
    }
    if (signalFlags.hasRequiresCoachClose) {
      reviewReasons.add("operational_signal_requires_coach_close");
    }
    if (row.race_specific_context.race_candidate_count > 0) {
      reviewReasons.add("race_context_present");
    }
    if (row.baseline_change_vs_planned_context.materially_changed) {
      reviewReasons.add("coach_target_differs_from_completed_baseline");
    }
    if (
      plannedVsCompleted.planned_vs_completed_delta !== null &&
      Math.abs(plannedVsCompleted.planned_vs_completed_delta) >= 1
    ) {
      reviewReasons.add("planned_vs_completed_frequency_delta");
    }
    if (plannedVsCompleted.planned_vs_completed_reliability !== "reliable") {
      reviewReasons.add("planned_signal_missing_or_unreliable");
      dataQualityFlags.add("planned_signal_missing_or_unreliable");
    }
    if (
      actualCompletedFrequency !== null &&
      recent4wFrequency !== null &&
      Math.abs(actualCompletedFrequency - recent4wFrequency) >= 1.5
    ) {
      reviewReasons.add("recent_status_differs_from_baseline");
      dataQualityFlags.add("recent_status_differs_from_baseline");
    }
    if (row.active_training_window?.baseline_period_type === "active_since") {
      reviewReasons.add("active_since_limited_window");
    }
    if (row.context_flags.includes("normal_vs_all_window_shift")) {
      reviewReasons.add("normal_vs_all_window_shift");
    }
    if (row.notes.some((note) => note.includes("gps_only_or_completed_only_pattern"))) {
      reviewReasons.add("gps_only_or_completed_only_pattern");
      dataQualityFlags.add("completed_data_incomplete");
    }

    if (frequencyCap === null || weeklyMinutesCap === null || longRunCap === null || qualityCountCap === null) {
      reviewReasons.add("missing_cap_fields");
      dataQualityFlags.add("missing_cap_fields");
    }
    if (qualityCountCap !== null && (qualityCountCap < 0 || qualityCountCap > 3)) {
      reviewReasons.add("quality_count_cap_implausible");
    }
    if (frequencyCap !== null && (frequencyCap < 1 || frequencyCap > 14)) {
      reviewReasons.add("frequency_cap_implausible");
    }
    if (weeklyMinutesCap !== null && weeklyMinutesCap > 1200) {
      reviewReasons.add("weekly_minutes_cap_implausible");
    }

    let decision: Decision = "ready_for_plan";
    if (blockingReasons.size > 0) {
      decision = "blocked";
    } else if (reviewReasons.size > 0) {
      decision = "needs_coach_review";
    }

    const reasonSet = new Set<string>([...blockingReasons, ...reviewReasons]);
    results.push({
      athlete_id: row.athlete_id,
      student_id: row.student_id,
      name: student?.studentName ?? row.student_name,
      decision,
      confidence: baselineDb?.confidence ?? row.confidence ?? "unknown",
      reasons: [...reasonSet].sort(),
      blocking_reasons: [...blockingReasons].sort(),
      review_reasons: [...reviewReasons].sort(),
      frequency_cap: frequencyCap,
      weekly_minutes_cap: weeklyMinutesCap,
      long_run_cap_min: longRunCap,
      quality_count_cap: qualityCountCap,
      actual_completed_frequency: actualCompletedFrequency,
      planned_context_frequency: plannedContextFrequency,
      planned_vs_completed_delta: plannedVsCompleted.planned_vs_completed_delta,
      recent_4w_frequency: recent4wFrequency,
      active_baseline_period: row.active_training_window?.baseline_period_type ?? null,
      race_context_summary: buildRaceContextSummary(row),
      operational_signal_summary: signalFlags.summaryParts.join("; "),
      data_quality_summary: buildDataQualitySummary([...dataQualityFlags].sort()),
    });
  }

  results.sort((a, b) => a.name.localeCompare(b.name));
  const report: ReadinessReport = {
    generated_at: new Date().toISOString(),
    mode: "dry-run",
    read_only: true,
    no_db_writes: true,
    no_trainingpeaks_mutations: true,
    no_telegram_sends: true,
    as_of: args.asOf,
    source_report_dir: sourceReportDir,
    athlete_count: results.length,
    counts: {
      ready_for_plan: results.filter((item) => item.decision === "ready_for_plan").length,
      needs_coach_review: results.filter((item) => item.decision === "needs_coach_review").length,
      blocked: results.filter((item) => item.decision === "blocked").length,
    },
    operational_signals: {
      included: operationalSignalsUnavailableReason === null,
      unavailable_reason: operationalSignalsUnavailableReason,
    },
    athletes: results,
  };

  const reportDir = path.join(repoRoot, "reports", "plan-readiness-dry-run", timestampForPath(new Date()));
  await mkdir(reportDir, { recursive: true });

  const files = {
    markdown: path.join(reportDir, "PLAN-READINESS-DRY-RUN.md"),
    json: path.join(reportDir, "plan-readiness-dry-run.json"),
    csv: path.join(reportDir, "athlete-readiness.csv"),
    blockedCsv: path.join(reportDir, "blocked-athletes.csv"),
    reviewCsv: path.join(reportDir, "needs-review-athletes.csv"),
    readyCsv: path.join(reportDir, "ready-athletes.csv"),
  };

  const header = [
    "athlete_id",
    "student_id",
    "name",
    "decision",
    "confidence",
    "reasons",
    "blocking_reasons",
    "review_reasons",
    "frequency_cap",
    "weekly_minutes_cap",
    "long_run_cap_min",
    "quality_count_cap",
    "actual_completed_frequency",
    "planned_context_frequency",
    "planned_vs_completed_delta",
    "recent_4w_frequency",
    "active_baseline_period",
    "race_context_summary",
    "operational_signal_summary",
    "data_quality_summary",
  ];
  const rows = [header, ...results.map((item) => [
    String(item.athlete_id),
    item.student_id,
    item.name,
    item.decision,
    item.confidence,
    item.reasons.join("|"),
    item.blocking_reasons.join("|"),
    item.review_reasons.join("|"),
    String(item.frequency_cap ?? ""),
    String(item.weekly_minutes_cap ?? ""),
    String(item.long_run_cap_min ?? ""),
    String(item.quality_count_cap ?? ""),
    String(item.actual_completed_frequency ?? ""),
    String(item.planned_context_frequency ?? ""),
    String(item.planned_vs_completed_delta ?? ""),
    String(item.recent_4w_frequency ?? ""),
    item.active_baseline_period ?? "",
    item.race_context_summary,
    item.operational_signal_summary,
    item.data_quality_summary,
  ])];

  const blockedRows = [header, ...rows.slice(1).filter((row) => row[3] === "blocked")];
  const reviewRows = [header, ...rows.slice(1).filter((row) => row[3] === "needs_coach_review")];
  const readyRows = [header, ...rows.slice(1).filter((row) => row[3] === "ready_for_plan")];

  await writeFile(files.markdown, buildMarkdown(report), "utf8");
  await writeFile(files.json, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(files.csv, listToCsv(rows), "utf8");
  await writeFile(files.blockedCsv, listToCsv(blockedRows), "utf8");
  await writeFile(files.reviewCsv, listToCsv(reviewRows), "utf8");
  await writeFile(files.readyCsv, listToCsv(readyRows), "utf8");

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("[tp-plan-readiness-dry-run] mode=dry-run");
  console.log("[tp-plan-readiness-dry-run] read_only=true");
  console.log("[tp-plan-readiness-dry-run] no_db_writes=true");
  console.log("[tp-plan-readiness-dry-run] no_trainingpeaks_mutations=true");
  console.log(`source_report_dir: ${sourceReportDir}`);
  console.log(`report_dir: ${reportDir}`);
  console.log(`athletes_evaluated: ${report.athlete_count}`);
  console.log(`counts: ${JSON.stringify(report.counts)}`);
  console.log(`operational_signals_included: ${report.operational_signals.included}`);
  if (report.operational_signals.unavailable_reason) {
    console.log(`operational_signals_unavailable_reason: ${report.operational_signals.unavailable_reason}`);
  }
}

main().catch((error: unknown) => {
  console.error("tp-plan-readiness-dry-run failed.");
  console.error(error);
  process.exit(1);
});
