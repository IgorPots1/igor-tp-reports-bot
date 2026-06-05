import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import type { TrainingPeaksStudent } from "../../../src/features/trainingpeaks/repository.ts";
import * as trainingPeaksRepository from "../../../src/features/trainingpeaks/repository.ts";
import { toolRoot } from "./lib/paths.ts";

type Confidence = "low" | "medium" | "high";
type ImportAction = "import" | "manual_review" | "skip" | "blocked";

type CliArgs = {
  reportDir: string;
  json: boolean;
};

type RepositoryCompat = {
  listTrainingPeaksStudents?: () => Promise<TrainingPeaksStudent[]>;
  default?: {
    listTrainingPeaksStudents?: () => Promise<TrainingPeaksStudent[]>;
  };
};

type BaselineV2PerAthlete = {
  student_name: string;
  student_id: string;
  athlete_id: number;
  analyzed_from: string;
  analyzed_to: string;
  normal_baseline: {
    frequency_cap: number | null;
    weekly_minutes_cap: number | null;
    long_run_cap_min: number | null;
    quality_count_cap: number | null;
    interval_like_count: number | null;
  };
  all_week_baseline: {
    frequency_cap: number | null;
    weekly_minutes_cap: number | null;
    long_run_cap_min: number | null;
    quality_count_cap: number | null;
    interval_like_count: number | null;
  };
  baseline_metric_source: string;
  baseline_source: string;
  confidence: Confidence;
  needs_review: boolean;
  context_flags: string[];
  notes: string[];
  normal_training_weeks_count: number;
  total_weeks_count: number;
  excluded_weeks_by_tag: Record<string, number>;
  active_training_window?: {
    active_training_window_start: string | null;
    active_training_window_end: string | null;
    active_training_weeks_count: number;
    pre_active_gap_weeks_count: number;
    pre_active_inactive_weeks: string[];
    all_window_frequency: number | null;
    active_window_frequency: number | null;
    normal_week_frequency: number | null;
    recent_4w_frequency: number | null;
    recent_4w_completed_minutes: number | null;
    baseline_period_type: string;
  };
  recent_current_status?: {
    latest_week_start: string | null;
    latest_week_tag: string | null;
    latest_two_weeks: Array<{
      week_start: string;
      tag: string;
      planned_running_minutes: number;
      completed_running_minutes: number;
    }>;
    run_walk_status: "run_walk_actual" | "possible_run_walk_signal" | "none";
  };
};

type BaselineV2Summary = {
  generated_at: string;
  date_range: { from: string; to: string };
};

type AthleteTrainingBaselineDbRow = {
  id: string;
  student_id: string;
  trainingpeaks_athlete_id: string | null;
  source_report_path: string | null;
  source_from: string;
  source_to: string;
  generated_at: string;
  is_current: boolean;
  frequency_cap: number | null;
  weekly_minutes_cap: number | null;
  long_run_cap_min: number | null;
  quality_count_cap: number | null;
  interval_like_count: number | null;
  confidence: Confidence;
  needs_review: boolean;
  context_flags: string[] | null;
  family_label_advisory: string | null;
  raw_stats_jsonb: Record<string, unknown> | null;
  is_manually_overridden?: boolean;
};

type CurrentBaselineMapValue = AthleteTrainingBaselineDbRow & {
  student_name: string | null;
  student_external_id: string | null;
};

type ActionRow = {
  student_name: string;
  student_id: string;
  student_external_id: string | null;
  athlete_id: number;
  action: ImportAction;
  reasons: string[];
  source_baseline_frequency: number | null;
  source_baseline_weekly_minutes: number | null;
  source_baseline_long_run: number | null;
  source_baseline_quality: number | null;
  proposed_frequency_cap: number | null;
  proposed_weekly_minutes_cap: number | null;
  proposed_long_run_cap: number | null;
  proposed_quality_sessions_cap: number | null;
  proposed_confidence: Confidence;
  confidence_delta: number | null;
  frequency_delta: number | null;
  weekly_minutes_delta: number | null;
  long_run_delta: number | null;
  quality_sessions_delta: number | null;
  current_baseline_exists: boolean;
  current_is_manually_overridden: boolean;
  current_frequency_cap: number | null;
  current_weekly_minutes_cap: number | null;
  current_long_run_cap: number | null;
  current_quality_sessions_cap: number | null;
  current_confidence: Confidence | null;
  context_flags: string[];
  would_set_is_current: boolean;
  would_unset_previous_current: boolean;
  raw_stats_preview: Record<string, unknown>;
};

type DryRunReport = {
  generated_at: string;
  mode: "dry-run";
  read_only: true;
  no_db_writes: true;
  source_report_dir: string;
  source_report_summary: {
    from: string;
    to: string;
    generated_at: string;
    athletes_in_report: number;
  };
  db_context: {
    current_db_baseline_available: boolean;
    current_db_baseline_unavailable: boolean;
    manual_override_protection_found: boolean;
    schema_notes: string[];
  };
  actions: ActionRow[];
  counts: Record<ImportAction, number>;
  high_delta_count: number;
  special_cases: Array<{
    athlete: string;
    athlete_id: number;
    status: string;
    details: Record<string, unknown>;
  }>;
  recommendations: string[];
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

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ").replace(/ё/gu, "е");
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asRoundedInt(value: number | null): number | null {
  if (value === null) return null;
  return Math.max(0, Math.round(value));
}

function confidenceScore(value: Confidence | null): number | null {
  if (value === "low") return 1;
  if (value === "medium") return 2;
  if (value === "high") return 3;
  return null;
}

function confidenceDelta(newConfidence: Confidence, currentConfidence: Confidence | null): number | null {
  const next = confidenceScore(newConfidence);
  const current = confidenceScore(currentConfidence);
  if (next === null || current === null) return null;
  return next - current;
}

function delta(newValue: number | null, currentValue: number | null): number | null {
  if (newValue === null || currentValue === null) return null;
  return Number((newValue - currentValue).toFixed(2));
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

function printHelp(): void {
  console.log("Baseline v2 import dry-run (read-only, no DB writes)");
  console.log("");
  console.log("Usage:");
  console.log(
    "  npx tsx tools/trainingpeaks-export/scripts/tp-dry-run-import-athlete-training-baselines-v2.ts --report-dir reports/athlete-training-baseline-v2/20260605-104943",
  );
  console.log("");
  console.log("Optional:");
  console.log("  --json");
  console.log("");
  console.log("Safety:");
  console.log("  - read-only");
  console.log("  - no DB writes");
  console.log("  - no TrainingPeaks mutations");
}

function parseArgs(argv: string[]): CliArgs {
  let reportDir = "";
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg.startsWith("--report-dir=")) {
      reportDir = arg.slice("--report-dir=".length).trim();
      continue;
    }
    if (arg === "--report-dir") {
      reportDir = (argv[index + 1] ?? "").trim();
      index += 1;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!reportDir) {
    throw new Error("Missing --report-dir.");
  }

  return { reportDir, json };
}

function loadJson<T>(filePath: string): T {
  if (!existsSync(filePath)) {
    throw new Error(`Required file not found: ${filePath}`);
  }
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

async function fetchCurrentBaselinesReadOnly(): Promise<{
  available: boolean;
  map: Map<string, CurrentBaselineMapValue>;
  manualOverrideProtectionFound: boolean;
  schemaNotes: string[];
}> {
  const schemaNotes: string[] = [];
  const map = new Map<string, CurrentBaselineMapValue>();
  const supabase = createSupabaseServerClient();

  const withOverride = await supabase
    .from("athlete_training_baselines")
    .select(
      "id, student_id, trainingpeaks_athlete_id, source_report_path, source_from, source_to, generated_at, is_current, frequency_cap, weekly_minutes_cap, long_run_cap_min, quality_count_cap, interval_like_count, confidence, needs_review, context_flags, family_label_advisory, raw_stats_jsonb, is_manually_overridden, trainingpeaks_students(student_name, student_id)",
    )
    .eq("is_current", true);

  let rows:
    | Array<
        AthleteTrainingBaselineDbRow & {
          trainingpeaks_students?:
            | { student_name?: string | null; student_id?: string | null }
            | Array<{ student_name?: string | null; student_id?: string | null }>
            | null;
        }
      >
    | null = null;

  let manualOverrideProtectionFound = true;

  if (withOverride.error) {
    const message = withOverride.error.message.toLowerCase();
    if (message.includes("is_manually_overridden")) {
      manualOverrideProtectionFound = false;
      schemaNotes.push("Column is_manually_overridden not found; manual override protection is unavailable.");

      const fallback = await supabase
        .from("athlete_training_baselines")
        .select(
          "id, student_id, trainingpeaks_athlete_id, source_report_path, source_from, source_to, generated_at, is_current, frequency_cap, weekly_minutes_cap, long_run_cap_min, quality_count_cap, interval_like_count, confidence, needs_review, context_flags, family_label_advisory, raw_stats_jsonb, trainingpeaks_students(student_name, student_id)",
        )
        .eq("is_current", true);
      if (fallback.error) {
        schemaNotes.push(`DB read failed: ${fallback.error.message}`);
        return { available: false, map, manualOverrideProtectionFound, schemaNotes };
      }
      rows = fallback.data as typeof rows;
    } else {
      schemaNotes.push(`DB read failed: ${withOverride.error.message}`);
      return { available: false, map, manualOverrideProtectionFound, schemaNotes };
    }
  } else {
    rows = withOverride.data as typeof rows;
  }

  for (const row of rows ?? []) {
    const joined = Array.isArray(row.trainingpeaks_students) ? row.trainingpeaks_students[0] : row.trainingpeaks_students;
    map.set(row.student_id, {
      ...row,
      student_name: joined?.student_name?.trim() ?? null,
      student_external_id: joined?.student_id?.trim() ?? null,
      is_manually_overridden: row.is_manually_overridden === true,
    });
  }

  return { available: true, map, manualOverrideProtectionFound, schemaNotes };
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

function buildManualReviewShortlistMd(rows: ActionRow[]): string {
  const filtered = rows.filter((row) => row.action === "manual_review");
  const lines = ["# Manual Review Shortlist", ""];
  if (filtered.length === 0) {
    lines.push("- No manual review athletes.");
    return `${lines.join("\n")}\n`;
  }
  for (const row of filtered) {
    lines.push(`## ${row.student_name} (${row.athlete_id})`);
    lines.push(`- reasons: ${row.reasons.join(", ")}`);
    lines.push(`- proposed_baseline: freq=${row.proposed_frequency_cap ?? "n/a"}, weekly_minutes=${row.proposed_weekly_minutes_cap ?? "n/a"}, long_run=${row.proposed_long_run_cap ?? "n/a"}, quality=${row.proposed_quality_sessions_cap ?? "n/a"}`);
    lines.push(`- current_baseline: freq=${row.current_frequency_cap ?? "n/a"}, weekly_minutes=${row.current_weekly_minutes_cap ?? "n/a"}, long_run=${row.current_long_run_cap ?? "n/a"}, quality=${row.current_quality_sessions_cap ?? "n/a"}`);
    lines.push(`- deltas: frequency=${row.frequency_delta ?? "n/a"}, weekly_minutes=${row.weekly_minutes_delta ?? "n/a"}, long_run=${row.long_run_delta ?? "n/a"}, quality=${row.quality_sessions_delta ?? "n/a"}, confidence_delta=${row.confidence_delta ?? "n/a"}`);
    const activePreview = row.raw_stats_preview.source_values as Record<string, unknown>;
    lines.push(
      `- active_training_window: period_type=${String(activePreview.baseline_period_type ?? "n/a")}, start=${String(activePreview.active_training_window_start ?? "n/a")}, pre_active_gap=${String(activePreview.pre_active_gap_weeks_count ?? "n/a")}`,
    );
    lines.push(
      `- frequency_layers: all_window=${String(activePreview.all_window_frequency ?? "n/a")}, active_window=${String(activePreview.active_window_frequency ?? "n/a")}, normal_week=${String(activePreview.normal_week_frequency ?? "n/a")}, recent_4w=${String(activePreview.recent_4w_frequency ?? "n/a")}`,
    );
    lines.push(`- context_flags: ${row.context_flags.join(", ") || "none"}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function buildSkipListMd(rows: ActionRow[]): string {
  const filtered = rows.filter((row) => row.action === "skip" || row.action === "blocked");
  const lines = ["# Skip / Blocked Athletes", ""];
  if (filtered.length === 0) {
    lines.push("- No skip/blocked athletes.");
    return `${lines.join("\n")}\n`;
  }
  for (const row of filtered) {
    lines.push(`- ${row.student_name} (${row.athlete_id}) | action=${row.action} | reasons=${row.reasons.join(", ")}`);
  }
  return `${lines.join("\n")}\n`;
}

function buildHighDeltaReviewMd(rows: ActionRow[]): string {
  const filtered = rows.filter((row) => row.reasons.includes("high_delta_vs_current"));
  const lines = ["# High Delta Review", ""];
  if (filtered.length === 0) {
    lines.push("- No high-delta athletes.");
    return `${lines.join("\n")}\n`;
  }
  for (const row of filtered) {
    lines.push(`## ${row.student_name} (${row.athlete_id})`);
    lines.push(`- action: ${row.action}`);
    lines.push(`- deltas: frequency=${row.frequency_delta ?? "n/a"}, weekly_minutes=${row.weekly_minutes_delta ?? "n/a"}, long_run=${row.long_run_delta ?? "n/a"}, quality=${row.quality_sessions_delta ?? "n/a"}`);
    lines.push(`- reasons: ${row.reasons.join(", ")}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function buildCombinedMd(report: DryRunReport): string {
  const lines: string[] = [];
  lines.push("# COMBINED IMPORT DRY RUN");
  lines.push("");
  lines.push("## 1. Summary");
  lines.push("- This was a dry-run only. No DB writes were performed.");
  lines.push(`- source_report_dir: ${report.source_report_dir}`);
  lines.push(`- athletes_in_report: ${report.source_report_summary.athletes_in_report}`);
  lines.push(
    `- source_range: ${report.source_report_summary.from}..${report.source_report_summary.to}`,
  );
  lines.push(`- db_current_baseline_available: ${report.db_context.current_db_baseline_available}`);
  lines.push("");
  lines.push("## 2. Proposed action counts");
  lines.push(`- import: ${report.counts.import}`);
  lines.push(`- manual_review: ${report.counts.manual_review}`);
  lines.push(`- skip: ${report.counts.skip}`);
  lines.push(`- blocked: ${report.counts.blocked}`);
  lines.push("");
  lines.push("## 3. Import candidates");
  const importRows = report.actions.filter((row) => row.action === "import").slice(0, 20);
  if (importRows.length === 0) lines.push("- none");
  for (const row of importRows) {
    lines.push(`- ${row.student_name} (${row.athlete_id}) | freq=${row.proposed_frequency_cap ?? "n/a"} | minutes=${row.proposed_weekly_minutes_cap ?? "n/a"} | reasons=${row.reasons.join(", ") || "none"}`);
  }
  lines.push("");
  lines.push("## 4. Manual review athletes");
  const manualRows = report.actions.filter((row) => row.action === "manual_review");
  if (manualRows.length === 0) lines.push("- none");
  for (const row of manualRows.slice(0, 50)) {
    lines.push(`- ${row.student_name} (${row.athlete_id}) | reasons=${row.reasons.join(", ")}`);
  }
  lines.push("");
  lines.push("## 5. Skipped/blocked athletes");
  const skipOrBlocked = report.actions.filter((row) => row.action === "skip" || row.action === "blocked");
  if (skipOrBlocked.length === 0) lines.push("- none");
  for (const row of skipOrBlocked) {
    lines.push(`- ${row.student_name} (${row.athlete_id}) | action=${row.action} | reasons=${row.reasons.join(", ")}`);
  }
  lines.push("");
  lines.push("## 6. High deltas vs current baseline");
  const highDelta = report.actions.filter((row) => row.reasons.includes("high_delta_vs_current"));
  if (highDelta.length === 0) lines.push("- none");
  for (const row of highDelta) {
    lines.push(`- ${row.student_name} (${row.athlete_id}) | frequency_delta=${row.frequency_delta ?? "n/a"} | weekly_minutes_delta=${row.weekly_minutes_delta ?? "n/a"} | long_run_delta=${row.long_run_delta ?? "n/a"} | quality_delta=${row.quality_sessions_delta ?? "n/a"}`);
  }
  lines.push("");
  lines.push("## 7. Special-case athletes");
  for (const special of report.special_cases) {
    lines.push(`- ${special.athlete} (${special.athlete_id}) | status=${special.status} | details=${JSON.stringify(special.details)}`);
  }
  if (report.special_cases.length === 0) lines.push("- none");
  lines.push("");
  lines.push("## 8. Safety notes");
  lines.push("- Read-only script; no insert/update/upsert/delete executed.");
  lines.push("- No TrainingPeaks mutation paths are called.");
  lines.push("- No Telegram paths are called.");
  if (!report.db_context.manual_override_protection_found) {
    lines.push("- Manual override protection column not detected; this must be added before apply.");
  }
  for (const note of report.db_context.schema_notes) {
    lines.push(`- ${note}`);
  }
  lines.push("");
  lines.push("## 9. Next step recommendation");
  lines.push("- Keep apply step disabled.");
  lines.push("- Review all manual_review/skip/blocked rows with coach context.");
  lines.push("- Only after manual review, implement separate guarded apply command.");
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
  const sourceReportDir = path.resolve(repoRoot, args.reportDir);
  const perAthletePath = path.join(sourceReportDir, "per-athlete-baseline-v2.json");
  const summaryPath = path.join(sourceReportDir, "baseline-v2-summary.json");
  const perAthlete = loadJson<BaselineV2PerAthlete[]>(perAthletePath);
  const summary = loadJson<BaselineV2Summary>(summaryPath);

  const compat = trainingPeaksRepository as RepositoryCompat;
  const listStudentsFn = compat.listTrainingPeaksStudents ?? compat.default?.listTrainingPeaksStudents;
  if (!listStudentsFn) {
    throw new Error("TrainingPeaks repository helpers are unavailable in this runtime.");
  }
  const students = await listStudentsFn();
  const studentsByInternalId = new Map(students.map((student) => [student.id, student]));
  const studentsByName = new Map(students.map((student) => [normalizeName(student.studentName), student]));

  const current = await fetchCurrentBaselinesReadOnly();

  const actions: ActionRow[] = [];
  const specialCases: DryRunReport["special_cases"] = [];

  for (const athlete of perAthlete) {
    const studentById = studentsByInternalId.get(athlete.student_id);
    const studentByName = studentsByName.get(normalizeName(athlete.student_name));
    const matchedStudent = studentById ?? studentByName ?? null;
    const currentBaseline = current.map.get(athlete.student_id) ?? null;
    const reasons = new Set<string>();
    const flags = new Set<string>(athlete.context_flags ?? []);
    const notesLower = athlete.notes.map((value) => value.toLowerCase());

    const frequencyRaw = athlete.normal_baseline.frequency_cap;
    const weeklyMinutesRaw = athlete.normal_baseline.weekly_minutes_cap;
    const longRunRaw = athlete.normal_baseline.long_run_cap_min;
    const qualityRaw = athlete.normal_baseline.quality_count_cap;

    const proposedFrequency = asRoundedInt(frequencyRaw);
    const proposedWeeklyMinutes = asRoundedInt(weeklyMinutesRaw);
    const proposedLongRun = asRoundedInt(longRunRaw);
    const proposedQuality = asRoundedInt(qualityRaw);

    if (
      (frequencyRaw !== null && !Number.isInteger(frequencyRaw)) ||
      (weeklyMinutesRaw !== null && !Number.isInteger(weeklyMinutesRaw)) ||
      (longRunRaw !== null && !Number.isInteger(longRunRaw)) ||
      (qualityRaw !== null && !Number.isInteger(qualityRaw))
    ) {
      flags.add("fractional_metric_rounded");
    }

    if (notesLower.some((note) => note.includes("gps_only_or_completed_only_pattern"))) {
      flags.add("completed_only_gps_pattern");
    }

    const activeWindow = athlete.active_training_window ?? null;
    const allWeekFrequency = toNumberOrNull(
      activeWindow?.all_window_frequency ?? athlete.all_week_baseline.frequency_cap,
    );
    const normalWeekFrequency = toNumberOrNull(
      activeWindow?.normal_week_frequency ?? athlete.normal_baseline.frequency_cap,
    );
    const activeWindowFrequency = toNumberOrNull(activeWindow?.active_window_frequency ?? null);
    const recent4wFrequency = toNumberOrNull(
      activeWindow?.recent_4w_frequency ?? athlete.recent_current_status?.recent_4w_frequency ?? null,
    );

    if (
      allWeekFrequency !== null &&
      normalWeekFrequency !== null &&
      Math.abs(normalWeekFrequency - allWeekFrequency) >= 1
    ) {
      flags.add("normal_vs_all_window_shift");
      reasons.add("normal_vs_all_window_shift");
    }

    if (activeWindow?.baseline_period_type === "active_since") {
      flags.add("active_since");
      reasons.add("active_since");
      if (activeWindow.pre_active_gap_weeks_count > 0) {
        flags.add("pre_active_gap_excluded");
        reasons.add("pre_active_gap_excluded");
      }
    }

    if (activeWindow?.baseline_period_type === "insufficient_active_window") {
      flags.add("insufficient_active_window");
      reasons.add("insufficient_active_window");
    }

    if (
      normalWeekFrequency !== null &&
      recent4wFrequency !== null &&
      Math.abs(normalWeekFrequency - recent4wFrequency) >= 1.5
    ) {
      flags.add("recent_status_differs_from_baseline");
      reasons.add("recent_status_differs_from_baseline");
    }

    const latestWeeks = athlete.recent_current_status?.latest_two_weeks ?? [];
    const latestDropOff = latestWeeks.length > 0 && latestWeeks.every((week) => week.planned_running_minutes > 0 && week.completed_running_minutes <= 0);
    if (latestDropOff) {
      flags.add("completed_data_incomplete");
      reasons.add("completed_data_incomplete");
    }

    if (!matchedStudent) {
      reasons.add("unresolved_identity_or_mapping");
    }
    if (!current.available) {
      reasons.add("current_db_baseline_unavailable");
      flags.add("current_db_baseline_unavailable");
    }

    if (athlete.normal_training_weeks_count < 4) {
      reasons.add("insufficient_completed_running_data");
      flags.add("insufficient_completed_running_data");
    }

    if (currentBaseline?.is_manually_overridden) {
      reasons.add("skip_manual_override");
    }

    if (athlete.confidence === "low") {
      reasons.add("low_confidence");
      flags.add("manual_review");
    }

    if (athlete.needs_review) {
      flags.add("manual_review");
    }

    if (athlete.athlete_id === 5485169) {
      reasons.add("melnikova_special_case");
      flags.add("completed_only_gps_pattern");
      flags.add("manual_review");
      specialCases.push({
        athlete: athlete.student_name,
        athlete_id: athlete.athlete_id,
        status: "manual_review",
        details: {
          baseline_period_type: activeWindow?.baseline_period_type ?? "unknown",
          active_training_window_start: activeWindow?.active_training_window_start ?? null,
          all_window_frequency: allWeekFrequency,
          active_window_frequency: activeWindowFrequency,
          normal_week_frequency: normalWeekFrequency,
          recent_4w_frequency: recent4wFrequency,
        },
      });
    }

    if (athlete.athlete_id === 5475895) {
      reasons.add("krylova_special_case");
      flags.add("injury_break_context");
      flags.add("healthy_baseline_vs_recent_status");
      flags.add("manual_review");
      specialCases.push({
        athlete: athlete.student_name,
        athlete_id: athlete.athlete_id,
        status: "manual_review",
        details: {
          baseline_period_type: activeWindow?.baseline_period_type ?? "unknown",
          all_window_frequency: allWeekFrequency,
          healthy_normal_week_frequency: normalWeekFrequency,
          recent_4w_frequency: recent4wFrequency,
        },
      });
    }

    if (athlete.athlete_id === 5959298) {
      if (latestDropOff) {
        flags.add("device_upload_issue");
        flags.add("completed_data_incomplete");
      }
      reasons.add("abramova_special_case");
      flags.add("manual_review");
      specialCases.push({
        athlete: athlete.student_name,
        athlete_id: athlete.athlete_id,
        status: "manual_review",
        details: {
          latest_upload_dropoff_detected: latestDropOff,
        },
      });
    }

    if (athlete.athlete_id === 3102415 || normalizeName(athlete.student_name) === "igor potseluev") {
      reasons.add("self_profile_or_non_student_baseline_target");
      flags.add("gps_completed_only_pattern");
    }

    const frequencyDelta = delta(proposedFrequency, currentBaseline?.frequency_cap ?? null);
    const weeklyMinutesDelta = delta(proposedWeeklyMinutes, currentBaseline?.weekly_minutes_cap ?? null);
    const longRunDelta = delta(proposedLongRun, currentBaseline?.long_run_cap_min ?? null);
    const qualityDelta = delta(proposedQuality, currentBaseline?.quality_count_cap ?? null);
    const confidenceDiff = confidenceDelta(athlete.confidence, currentBaseline?.confidence ?? null);

    if (
      (frequencyDelta !== null && Math.abs(frequencyDelta) >= 2) ||
      (weeklyMinutesDelta !== null && Math.abs(weeklyMinutesDelta) >= 90) ||
      (longRunDelta !== null && Math.abs(longRunDelta) >= 45) ||
      (qualityDelta !== null && Math.abs(qualityDelta) >= 1.5)
    ) {
      reasons.add("high_delta_vs_current");
      flags.add("manual_review");
    }

    let action: ImportAction = "import";
    if (!current.available) {
      action = "blocked";
    } else if (reasons.has("skip_manual_override")) {
      action = "skip";
    } else if (reasons.has("unresolved_identity_or_mapping")) {
      action = "skip";
    } else if (reasons.has("insufficient_completed_running_data")) {
      action = "skip";
    } else if (reasons.has("insufficient_active_window")) {
      action = "manual_review";
    } else if (reasons.has("self_profile_or_non_student_baseline_target")) {
      action = "skip";
    } else if (
      athlete.confidence === "low" ||
      reasons.has("normal_vs_all_window_shift") ||
      reasons.has("active_since") ||
      reasons.has("recent_status_differs_from_baseline") ||
      reasons.has("completed_data_incomplete") ||
      reasons.has("high_delta_vs_current") ||
      reasons.has("melnikova_special_case") ||
      reasons.has("krylova_special_case") ||
      reasons.has("abramova_special_case") ||
      !currentBaseline
    ) {
      action = "manual_review";
    }

    if (!current.manualOverrideProtectionFound) {
      reasons.add("manual_override_protection_missing");
      action = "blocked";
    }

    const rawStatsPreview = {
      baseline_source: "completed_actual_running_v2",
      source_report_dir: args.reportDir,
      source_report_window: {
        from: athlete.analyzed_from,
        to: athlete.analyzed_to,
      },
      source_values: {
        normal_frequency_cap: athlete.normal_baseline.frequency_cap,
        all_week_frequency_cap: athlete.all_week_baseline.frequency_cap,
        normal_weekly_minutes_cap: athlete.normal_baseline.weekly_minutes_cap,
        all_week_weekly_minutes_cap: athlete.all_week_baseline.weekly_minutes_cap,
        active_training_window_start: activeWindow?.active_training_window_start ?? null,
        active_training_window_end: activeWindow?.active_training_window_end ?? null,
        active_training_weeks_count: activeWindow?.active_training_weeks_count ?? null,
        pre_active_gap_weeks_count: activeWindow?.pre_active_gap_weeks_count ?? null,
        all_window_frequency: allWeekFrequency,
        active_window_frequency: activeWindowFrequency,
        normal_week_frequency: normalWeekFrequency,
        recent_4w_frequency: recent4wFrequency,
        recent_4w_completed_minutes: activeWindow?.recent_4w_completed_minutes ?? null,
        baseline_period_type: activeWindow?.baseline_period_type ?? null,
      },
      special_case_context:
        athlete.athlete_id === 5485169
          ? "melnikova_normal_vs_all_week_shift"
          : athlete.athlete_id === 5475895
            ? "krylova_injury_break_context"
            : athlete.athlete_id === 5959298
              ? "abramova_device_upload_issue_context"
              : null,
    };

    actions.push({
      student_name: athlete.student_name,
      student_id: athlete.student_id,
      student_external_id: currentBaseline?.student_external_id ?? null,
      athlete_id: athlete.athlete_id,
      action,
      reasons: [...reasons].sort(),
      source_baseline_frequency: athlete.normal_baseline.frequency_cap,
      source_baseline_weekly_minutes: athlete.normal_baseline.weekly_minutes_cap,
      source_baseline_long_run: athlete.normal_baseline.long_run_cap_min,
      source_baseline_quality: athlete.normal_baseline.quality_count_cap,
      proposed_frequency_cap: proposedFrequency,
      proposed_weekly_minutes_cap: proposedWeeklyMinutes,
      proposed_long_run_cap: proposedLongRun,
      proposed_quality_sessions_cap: proposedQuality,
      proposed_confidence: athlete.confidence,
      confidence_delta: confidenceDiff,
      frequency_delta: frequencyDelta,
      weekly_minutes_delta: weeklyMinutesDelta,
      long_run_delta: longRunDelta,
      quality_sessions_delta: qualityDelta,
      current_baseline_exists: currentBaseline !== null,
      current_is_manually_overridden: currentBaseline?.is_manually_overridden === true,
      current_frequency_cap: currentBaseline?.frequency_cap ?? null,
      current_weekly_minutes_cap: currentBaseline?.weekly_minutes_cap ?? null,
      current_long_run_cap: currentBaseline?.long_run_cap_min ?? null,
      current_quality_sessions_cap: currentBaseline?.quality_count_cap ?? null,
      current_confidence: currentBaseline?.confidence ?? null,
      context_flags: [...flags].sort(),
      would_set_is_current: action === "import" || action === "manual_review",
      would_unset_previous_current: currentBaseline !== null && action !== "skip" && action !== "blocked",
      raw_stats_preview: rawStatsPreview,
    });
  }

  const alexAuditPath = path.join(repoRoot, "reports", "baseline-v2-athlete-export-audit", "20260605-133500", "combined-summary.json");
  if (existsSync(alexAuditPath)) {
    const audit = loadJson<{
      comparison?: Array<{
        athlete: string;
        athlete_id: number;
        export_median_completed_runs_per_week: number;
        baseline_v2_freq: number;
        cache_freq: number;
      }>;
    }>(alexAuditPath);
    const alex = audit.comparison?.find((row) => row.athlete_id === 5738641) ?? null;
    if (alex) {
      specialCases.push({
        athlete: "Alex",
        athlete_id: 5738641,
        status: "audit_reference_only",
        details: {
          export_median_completed_runs_per_week: alex.export_median_completed_runs_per_week,
          baseline_v2_freq: alex.baseline_v2_freq,
          cache_freq: alex.cache_freq,
          note: "Identity matched to 5738641; 5973196 intentionally not used.",
        },
      });
    }
  }

  actions.sort((a, b) => a.student_name.localeCompare(b.student_name));
  const counts: Record<ImportAction, number> = { import: 0, manual_review: 0, skip: 0, blocked: 0 };
  for (const row of actions) counts[row.action] += 1;

  const report: DryRunReport = {
    generated_at: new Date().toISOString(),
    mode: "dry-run",
    read_only: true,
    no_db_writes: true,
    source_report_dir: sourceReportDir,
    source_report_summary: {
      from: summary.date_range.from,
      to: summary.date_range.to,
      generated_at: summary.generated_at,
      athletes_in_report: perAthlete.length,
    },
    db_context: {
      current_db_baseline_available: current.available,
      current_db_baseline_unavailable: !current.available,
      manual_override_protection_found: current.manualOverrideProtectionFound,
      schema_notes: current.schemaNotes,
    },
    actions,
    counts,
    high_delta_count: actions.filter((row) => row.reasons.includes("high_delta_vs_current")).length,
    special_cases: specialCases,
    recommendations: [
      "Dry-run only complete; no DB writes performed.",
      "Review manual_review, skip, and blocked rows before any apply step.",
      "Keep completed actual running as primary numeric baseline source.",
    ],
  };

  const outputDir = path.join(repoRoot, "reports", "athlete-training-baseline-v2-import-dry-run", timestampForPath(new Date()));
  await mkdir(outputDir, { recursive: true });

  const files = {
    summaryMd: path.join(outputDir, "import-dry-run-summary.md"),
    summaryJson: path.join(outputDir, "import-dry-run-summary.json"),
    actionsCsv: path.join(outputDir, "import-actions.csv"),
    actionsJson: path.join(outputDir, "import-actions.json"),
    manualReviewMd: path.join(outputDir, "manual-review-shortlist.md"),
    skipMd: path.join(outputDir, "skip-list.md"),
    highDeltaMd: path.join(outputDir, "high-delta-review.md"),
    diffCsv: path.join(outputDir, "current-vs-new-diff.csv"),
    combinedMd: path.join(outputDir, "COMBINED-IMPORT-DRY-RUN.md"),
  };

  const actionsHeader = [
    "student_name",
    "student_id",
    "student_external_id",
    "athlete_id",
    "action",
    "reasons",
    "proposed_frequency_cap",
    "proposed_weekly_minutes_cap",
    "proposed_long_run_cap",
    "proposed_quality_sessions_cap",
    "proposed_confidence",
    "current_frequency_cap",
    "current_weekly_minutes_cap",
    "current_long_run_cap",
    "current_quality_sessions_cap",
    "current_confidence",
    "frequency_delta",
    "weekly_minutes_delta",
    "long_run_delta",
    "quality_sessions_delta",
    "confidence_delta",
    "context_flags",
  ];
  const actionsCsvRows = [actionsHeader, ...actions.map((row) => [
    row.student_name,
    row.student_id,
    row.student_external_id ?? "",
    String(row.athlete_id),
    row.action,
    row.reasons.join("|"),
    String(row.proposed_frequency_cap ?? ""),
    String(row.proposed_weekly_minutes_cap ?? ""),
    String(row.proposed_long_run_cap ?? ""),
    String(row.proposed_quality_sessions_cap ?? ""),
    row.proposed_confidence,
    String(row.current_frequency_cap ?? ""),
    String(row.current_weekly_minutes_cap ?? ""),
    String(row.current_long_run_cap ?? ""),
    String(row.current_quality_sessions_cap ?? ""),
    row.current_confidence ?? "",
    String(row.frequency_delta ?? ""),
    String(row.weekly_minutes_delta ?? ""),
    String(row.long_run_delta ?? ""),
    String(row.quality_sessions_delta ?? ""),
    String(row.confidence_delta ?? ""),
    row.context_flags.join("|"),
  ])];

  const diffHeader = [
    "student_name",
    "athlete_id",
    "current_frequency_cap",
    "new_frequency_cap",
    "frequency_delta",
    "current_weekly_minutes_cap",
    "new_weekly_minutes_cap",
    "weekly_minutes_delta",
    "current_long_run_cap",
    "new_long_run_cap",
    "long_run_delta",
    "current_quality_sessions_cap",
    "new_quality_sessions_cap",
    "quality_sessions_delta",
    "current_confidence",
    "new_confidence",
    "confidence_delta",
    "action",
    "reasons",
  ];
  const diffRows = [diffHeader, ...actions.map((row) => [
    row.student_name,
    String(row.athlete_id),
    String(row.current_frequency_cap ?? ""),
    String(row.proposed_frequency_cap ?? ""),
    String(row.frequency_delta ?? ""),
    String(row.current_weekly_minutes_cap ?? ""),
    String(row.proposed_weekly_minutes_cap ?? ""),
    String(row.weekly_minutes_delta ?? ""),
    String(row.current_long_run_cap ?? ""),
    String(row.proposed_long_run_cap ?? ""),
    String(row.long_run_delta ?? ""),
    String(row.current_quality_sessions_cap ?? ""),
    String(row.proposed_quality_sessions_cap ?? ""),
    String(row.quality_sessions_delta ?? ""),
    row.current_confidence ?? "",
    row.proposed_confidence,
    String(row.confidence_delta ?? ""),
    row.action,
    row.reasons.join("|"),
  ])];

  const summaryMd = [
    "# Baseline v2 Import Dry-Run Summary",
    "",
    "This was a dry-run only. No DB writes were performed.",
    "",
    `- source_report_dir: ${sourceReportDir}`,
    `- output_dir: ${outputDir}`,
    `- athletes_in_report: ${perAthlete.length}`,
    `- action_counts: ${JSON.stringify(counts)}`,
    `- high_delta_count: ${report.high_delta_count}`,
    `- db_current_baseline_available: ${current.available}`,
    `- manual_override_protection_found: ${current.manualOverrideProtectionFound}`,
  ].join("\n");

  await writeFile(files.summaryMd, `${summaryMd}\n`, "utf8");
  await writeFile(files.summaryJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(files.actionsCsv, listToCsv(actionsCsvRows), "utf8");
  await writeFile(files.actionsJson, `${JSON.stringify(actions, null, 2)}\n`, "utf8");
  await writeFile(files.manualReviewMd, buildManualReviewShortlistMd(actions), "utf8");
  await writeFile(files.skipMd, buildSkipListMd(actions), "utf8");
  await writeFile(files.highDeltaMd, buildHighDeltaReviewMd(actions), "utf8");
  await writeFile(files.diffCsv, listToCsv(diffRows), "utf8");
  await writeFile(files.combinedMd, buildCombinedMd(report), "utf8");

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("[tp-dry-run-import-athlete-training-baselines-v2] mode=dry-run");
  console.log("[tp-dry-run-import-athlete-training-baselines-v2] read_only=true");
  console.log("[tp-dry-run-import-athlete-training-baselines-v2] no_db_writes=true");
  console.log(`source_report_dir: ${sourceReportDir}`);
  console.log(`output_dir: ${outputDir}`);
  console.log(`counts: ${JSON.stringify(counts)}`);
  console.log(`high_delta_count: ${report.high_delta_count}`);
  console.log(`manual_override_protection_found: ${current.manualOverrideProtectionFound}`);
}

main().catch((error: unknown) => {
  console.error("tp-dry-run-import-athlete-training-baselines-v2 failed.");
  console.error(error);
  process.exit(1);
});
