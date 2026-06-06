import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import {
  type QualityIntent,
  type QualityStructure,
  type QualityWorkoutKey,
  selectQualityMethodologyV0,
} from "./lib/plan-quality-methodology-catalog.ts";
import { toolRoot } from "./lib/paths.ts";

type DraftStatus =
  | "draft_ready_for_coach_review"
  | "draft_invalid_needs_fix"
  | "draft_blocked_by_readiness";

type WorkoutType = "easy_run" | "controlled_quality" | "long_easy_run";

type CliArgs = {
  athleteId: number | null;
  weekStart: string;
  readinessReportDir: string;
  json: boolean;
};

type ReadinessAthlete = {
  athlete_id: number;
  student_id: string;
  name: string;
  decision: "ready_for_plan" | "needs_coach_review" | "blocked";
  confidence: "low" | "medium" | "high" | "unknown";
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
  as_of: string;
  source_report_dir: string;
  athletes: ReadinessAthlete[];
};

type AthleteTrainingBaselineDbRow = {
  student_id: string;
  trainingpeaks_athlete_id: string | null;
  frequency_cap: number | null;
  weekly_minutes_cap: number | null;
  long_run_cap_min: number | null;
  quality_count_cap: number | null;
  confidence: "low" | "medium" | "high" | null;
  raw_stats_jsonb: Record<string, unknown> | null;
  is_current: boolean;
};

type DraftWorkout = {
  date: string;
  day_of_week: string;
  workout_type: WorkoutType;
  title: string;
  raw_duration_minutes: number;
  rounded_duration_minutes: number;
  duration_minutes: number;
  rounding_reason: string;
  quality_flag: boolean;
  quality_intent: QualityIntent | null;
  quality_workout_key: QualityWorkoutKey | null;
  structure: QualityStructure | null;
  selection_reason: string | null;
  intensity_target: string;
  coach_notes: string;
  guardrail_notes: string;
};

type GuardrailCheck = {
  planned_run_count_lte_frequency_cap: { ok: boolean; value: number; cap: number | null };
  planned_weekly_minutes_lte_weekly_minutes_cap: { ok: boolean; value: number; cap: number | null };
  long_run_minutes_lte_long_run_cap: { ok: boolean; value: number; cap: number | null };
  quality_session_count_lte_quality_cap: { ok: boolean; value: number; cap: number | null };
  no_active_illness_or_injury_conflict: { ok: boolean; details: string };
  no_race_or_recovery_conflict: { ok: boolean; details: string };
  no_device_or_upload_issue_conflict: { ok: boolean; details: string };
  no_planned_vs_completed_issue_conflict: { ok: boolean; details: string };
};

type PlanDraftJson = {
  generated_at: string;
  mode: "draft-only";
  read_only: true;
  no_db_writes: true;
  no_trainingpeaks_mutations: true;
  no_telegram_sends: true;
  athlete: {
    name: string;
    athlete_id: number;
    student_id: string;
  };
  readiness_source: string;
  readiness_generated_at: string;
  baseline_source_report_dir: string;
  week: {
    week_start: string;
    week_end: string;
  };
  status: DraftStatus;
  decision: "ready_for_plan" | "needs_coach_review";
  baseline: {
    frequency_cap: number | null;
    weekly_minutes_cap: number | null;
    long_run_cap_min: number | null;
    quality_count_cap: number | null;
    confidence: string;
    actual_completed_frequency: number | null;
    planned_context_frequency: number | null;
    planned_vs_completed_delta: number | null;
    recent_4w_frequency: number | null;
    baseline_period_type: string | null;
  };
  readiness: {
    decision: string;
    reasons: string[];
    blocking_reasons: string[];
    review_reasons: string[];
    operational_signal_summary: string;
    race_context_summary: string;
    data_quality_summary: string;
  };
  workouts: DraftWorkout[];
  planned: {
    run_count: number;
    weekly_minutes: number;
    long_run_minutes: number;
    quality_session_count: number;
  };
  guardrail_check: GuardrailCheck;
  missing_required_data: string[];
  coach_review_notes: string[];
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
  for (const envPath of [
    path.join(repoRoot, ".env.local"),
    path.join(repoRoot, ".env"),
    path.join(toolRoot, ".env"),
  ]) {
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
  console.log("Plan Draft Generator v0 (draft-only, read-only)");
  console.log("");
  console.log("Usage:");
  console.log(
    "  npx tsx tools/trainingpeaks-export/scripts/tp-plan-draft-generator-v0.ts --athlete-id 5905779 --week-start 2026-06-08 --readiness-report-dir reports/plan-readiness-dry-run/20260606-100903",
  );
  console.log("");
  console.log("Optional:");
  console.log("  --json");
  console.log("");
  console.log("Safety:");
  console.log("  - draft-only");
  console.log("  - no DB writes");
  console.log("  - no TrainingPeaks mutations");
  console.log("  - no Telegram sends");
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    athleteId: null,
    weekStart: "2026-06-08",
    readinessReportDir: "",
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
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
    if (arg.startsWith("--week-start=")) {
      parsed.weekStart = validateIsoDate(arg.slice("--week-start=".length).trim(), "--week-start");
      continue;
    }
    if (arg === "--week-start") {
      parsed.weekStart = validateIsoDate((argv[index + 1] ?? "").trim(), "--week-start");
      index += 1;
      continue;
    }
    if (arg.startsWith("--readiness-report-dir=")) {
      parsed.readinessReportDir = arg.slice("--readiness-report-dir=".length).trim();
      continue;
    }
    if (arg === "--readiness-report-dir") {
      parsed.readinessReportDir = (argv[index + 1] ?? "").trim();
      index += 1;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!parsed.readinessReportDir) {
    throw new Error("Missing --readiness-report-dir.");
  }

  return parsed;
}

function loadJson<T>(filePath: string): T {
  if (!existsSync(filePath)) {
    throw new Error(`Required file not found: ${filePath}`);
  }
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

async function fetchCurrentBaselineByAthleteIdReadOnly(
  athleteId: number,
): Promise<AthleteTrainingBaselineDbRow | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("athlete_training_baselines")
    .select(
      "student_id, trainingpeaks_athlete_id, frequency_cap, weekly_minutes_cap, long_run_cap_min, quality_count_cap, confidence, raw_stats_jsonb, is_current",
    )
    .eq("is_current", true)
    .eq("trainingpeaks_athlete_id", String(athleteId))
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read current baseline row for athlete ${athleteId}: ${error.message}`);
  }
  return (data as AthleteTrainingBaselineDbRow | null) ?? null;
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekday(isoDate: string): string {
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const date = new Date(`${isoDate}T00:00:00Z`);
  return names[date.getUTCDay()] ?? "Unknown";
}

function toRounded(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.round(value));
}

const EASY_RUN_ALLOWED_MINUTES = [30, 35, 40, 45, 50, 55, 60, 65, 70];
const LONG_RUN_ALLOWED_MINUTES = [75, 80, 85, 90, 95, 100, 105, 110, 115, 120];
const QUALITY_ALLOWED_MINUTES = [45, 50, 55, 60];

function allowedMinutesForType(type: WorkoutType): number[] {
  if (type === "long_easy_run") return LONG_RUN_ALLOWED_MINUTES;
  if (type === "controlled_quality") return QUALITY_ALLOWED_MINUTES;
  return EASY_RUN_ALLOWED_MINUTES;
}

function nearestAllowedMinute(rawMinutes: number, allowedMinutes: number[], cap: number | null): number {
  const candidates =
    cap === null
      ? [...allowedMinutes]
      : allowedMinutes.filter((minute) => minute <= cap);

  if (candidates.length === 0) {
    return Math.max(0, Math.min(rawMinutes, cap ?? rawMinutes));
  }

  const [best] = candidates.sort((a, b) => {
    const byDistance = Math.abs(a - rawMinutes) - Math.abs(b - rawMinutes);
    if (byDistance !== 0) return byDistance;
    // Conservative tie-break: choose the lower duration.
    return a - b;
  });
  return best ?? candidates[0]!;
}

function coachRoundDuration(
  workoutType: WorkoutType,
  rawMinutes: number,
  weeklyMinutesCap: number | null,
  longRunCap: number | null,
): { rounded: number; reason: string } {
  const allowed = allowedMinutesForType(workoutType);
  const boundedRaw = Math.max(0, Math.round(rawMinutes));
  let cap = weeklyMinutesCap;
  if (workoutType === "long_easy_run") {
    cap = longRunCap === null ? weeklyMinutesCap : Math.min(weeklyMinutesCap ?? longRunCap, longRunCap);
  }
  const rounded = nearestAllowedMinute(boundedRaw, allowed, cap);
  const reasonBase =
    workoutType === "easy_run"
      ? "Rounded to nearest coach-style easy-run duration; conservative tie-break rounds down."
      : workoutType === "long_easy_run"
        ? "Rounded to nearest coach-style long-run duration within long-run and weekly caps."
        : "Rounded to nearest coach-style controlled-quality duration based on structured session range.";
  return { rounded, reason: `${reasonBase} raw=${boundedRaw} -> rounded=${rounded}.` };
}

function nextAllowedMinute(workoutType: WorkoutType, current: number, direction: -1 | 1): number | null {
  const allowed = allowedMinutesForType(workoutType);
  const index = allowed.indexOf(current);
  if (index < 0) return null;
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= allowed.length) return null;
  return allowed[nextIndex] ?? null;
}

function applyCoachStyleRounding(
  workouts: DraftWorkout[],
  targetWeeklyMinutes: number,
  weeklyMinutesCap: number | null,
  longRunCap: number | null,
): void {
  for (const workout of workouts) {
    const rounded = coachRoundDuration(
      workout.workout_type,
      workout.raw_duration_minutes,
      weeklyMinutesCap,
      longRunCap,
    );
    workout.rounded_duration_minutes = rounded.rounded;
    workout.duration_minutes = rounded.rounded;
    workout.rounding_reason = rounded.reason;
  }

  const maxWeekly = weeklyMinutesCap ?? Number.POSITIVE_INFINITY;
  const totalMinutes = (): number => workouts.reduce((sum, workout) => sum + workout.duration_minutes, 0);

  // If rounded values exceed cap, step down in coach-style increments.
  while (totalMinutes() > maxWeekly) {
    const downCandidates = [...workouts].sort((a, b) => {
      const priority = (type: WorkoutType) =>
        type === "easy_run" ? 0 : type === "controlled_quality" ? 1 : 2;
      const p = priority(a.workout_type) - priority(b.workout_type);
      if (p !== 0) return p;
      return b.duration_minutes - a.duration_minutes;
    });
    let changed = false;
    for (const workout of downCandidates) {
      const next = nextAllowedMinute(workout.workout_type, workout.duration_minutes, -1);
      if (next === null) continue;
      if (workout.workout_type === "long_easy_run" && longRunCap !== null && next > longRunCap) continue;
      workout.duration_minutes = next;
      workout.rounded_duration_minutes = next;
      workout.rounding_reason = `${workout.rounding_reason} Stepped down one coach-style notch to satisfy weekly_minutes_cap.`;
      changed = true;
      break;
    }
    if (!changed) break;
  }

  // If we're meaningfully below target after rounding, nudge one easy run up by one coach-style step.
  const deficit = targetWeeklyMinutes - totalMinutes();
  if (deficit >= 5) {
    const easyCandidate = workouts
      .filter((workout) => workout.workout_type === "easy_run")
      .sort((a, b) => b.duration_minutes - a.duration_minutes)[0];
    if (easyCandidate) {
      const stepUp = nextAllowedMinute(easyCandidate.workout_type, easyCandidate.duration_minutes, 1);
      if (stepUp !== null) {
        const projectedTotal = totalMinutes() - easyCandidate.duration_minutes + stepUp;
        if (projectedTotal <= maxWeekly) {
          easyCandidate.duration_minutes = stepUp;
          easyCandidate.rounded_duration_minutes = stepUp;
          easyCandidate.rounding_reason = `${easyCandidate.rounding_reason} Stepped up one coach-style notch to reduce weekly target deficit while staying within caps.`;
        }
      }
    }
  }
}

function parseOperationalSummary(summary: string): {
  activeIllness: boolean;
  activePainInjury: boolean;
  returnMonitoring: boolean;
  requiresCoachClose: boolean;
} {
  const normalized = summary.toLowerCase();
  return {
    activeIllness: normalized.includes("active_illness=true"),
    activePainInjury: normalized.includes("active_pain_injury=true"),
    returnMonitoring: normalized.includes("return_monitoring=true"),
    requiresCoachClose: normalized.includes("requires_coach_close=true"),
  };
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

type RecentQualityDiagnosticSummary = {
  found_20x1min_candidate?: boolean;
};

function loadRecentQualityDiagnosticIfAvailable(repoRoot: string): {
  available: boolean;
  found20x1: boolean;
} {
  const diagnosticPath = path.join(
    repoRoot,
    "reports",
    "anna-recent-workout-diagnostic-v0",
    "20260606-115025",
    "summary.json",
  );
  if (!existsSync(diagnosticPath)) {
    return { available: false, found20x1: false };
  }
  const summary = loadJson<RecentQualityDiagnosticSummary>(diagnosticPath);
  return {
    available: true,
    found20x1: summary.found_20x1min_candidate === true,
  };
}

function buildMarkdown(plan: PlanDraftJson): string {
  const lines: string[] = [];
  lines.push("# PLAN DRAFT v0");
  lines.push("");
  lines.push("Local draft-only output. No DB writes, no TrainingPeaks mutations, no Telegram sends.");
  lines.push("");
  lines.push(`- generated_at: ${plan.generated_at}`);
  lines.push(`- status: ${plan.status}`);
  lines.push(`- decision: ${plan.decision}`);
  lines.push("");
  lines.push("## 1. Athlete summary");
  lines.push(`- name: ${plan.athlete.name}`);
  lines.push(`- athlete_id: ${plan.athlete.athlete_id}`);
  lines.push(`- student_id: ${plan.athlete.student_id}`);
  lines.push("");
  lines.push("## 2. Input baseline");
  lines.push(`- frequency_cap: ${plan.baseline.frequency_cap ?? "missing"}`);
  lines.push(`- weekly_minutes_cap: ${plan.baseline.weekly_minutes_cap ?? "missing"}`);
  lines.push(`- long_run_cap_min: ${plan.baseline.long_run_cap_min ?? "missing"}`);
  lines.push(`- quality_count_cap: ${plan.baseline.quality_count_cap ?? "missing"}`);
  lines.push(`- confidence: ${plan.baseline.confidence}`);
  lines.push(`- actual_completed_frequency: ${plan.baseline.actual_completed_frequency ?? "missing"}`);
  lines.push(`- planned_context_frequency: ${plan.baseline.planned_context_frequency ?? "missing"}`);
  lines.push(`- planned_vs_completed_delta: ${plan.baseline.planned_vs_completed_delta ?? "missing"}`);
  lines.push(`- recent_4w_frequency: ${plan.baseline.recent_4w_frequency ?? "missing"}`);
  lines.push(`- baseline_period_type: ${plan.baseline.baseline_period_type ?? "missing"}`);
  lines.push("");
  lines.push("## 3. Readiness summary");
  lines.push(`- readiness_decision: ${plan.readiness.decision}`);
  lines.push(`- reasons: ${plan.readiness.reasons.join(", ") || "none"}`);
  lines.push(`- blocking_reasons: ${plan.readiness.blocking_reasons.join(", ") || "none"}`);
  lines.push(`- review_reasons: ${plan.readiness.review_reasons.join(", ") || "none"}`);
  lines.push(`- operational_signal_summary: ${plan.readiness.operational_signal_summary}`);
  lines.push(`- race_context_summary: ${plan.readiness.race_context_summary}`);
  lines.push(`- data_quality_summary: ${plan.readiness.data_quality_summary}`);
  lines.push("");
  lines.push("## 4. Draft week overview");
  lines.push(`- week_start: ${plan.week.week_start}`);
  lines.push(`- week_end: ${plan.week.week_end}`);
  lines.push(`- planned_run_count: ${plan.planned.run_count}`);
  lines.push(`- planned_weekly_minutes: ${plan.planned.weekly_minutes}`);
  lines.push(`- long_run_minutes: ${plan.planned.long_run_minutes}`);
  lines.push(`- quality_session_count: ${plan.planned.quality_session_count}`);
  lines.push("");
  lines.push("### Duration rounding");
  lines.push(
    "- The generator rounds raw calculated durations into coach-style durations.",
  );
  lines.push(
    "- It prioritizes natural durations over exact percentage matching while staying within guardrails.",
  );
  lines.push("");
  lines.push("## 5. Workout list");
  if (plan.workouts.length === 0) {
    lines.push("- No workouts generated.");
  } else {
    for (const workout of plan.workouts) {
      lines.push(
        `- ${workout.date} (${workout.day_of_week}) | ${workout.workout_type} | ${workout.title} | raw=${workout.raw_duration_minutes} min | rounded=${workout.rounded_duration_minutes} min | quality=${workout.quality_flag} | reason=${workout.rounding_reason}`,
      );
      if (workout.quality_flag) {
        lines.push(
          `  quality_intent=${workout.quality_intent ?? "missing"} | quality_workout_key=${workout.quality_workout_key ?? "missing"} | selection_reason=${workout.selection_reason ?? "missing"}`,
        );
        if (workout.structure?.repeats) {
          lines.push(
            `  structure=${workout.structure.warmup_minutes} + ${workout.structure.repeats.repeat_count}x(${workout.structure.repeats.work_minutes}/${workout.structure.repeats.recovery_minutes}) + ${workout.structure.cooldown_minutes} = ${workout.structure.total_minutes}`,
          );
        } else {
          lines.push("  structure=missing");
        }
      }
    }
  }
  lines.push("");
  lines.push("## 6. Guardrail check");
  lines.push(
    `- planned_run_count <= frequency_cap: ${plan.guardrail_check.planned_run_count_lte_frequency_cap.ok} (${plan.guardrail_check.planned_run_count_lte_frequency_cap.value} <= ${plan.guardrail_check.planned_run_count_lte_frequency_cap.cap ?? "missing"})`,
  );
  lines.push(
    `- planned_weekly_minutes <= weekly_minutes_cap: ${plan.guardrail_check.planned_weekly_minutes_lte_weekly_minutes_cap.ok} (${plan.guardrail_check.planned_weekly_minutes_lte_weekly_minutes_cap.value} <= ${plan.guardrail_check.planned_weekly_minutes_lte_weekly_minutes_cap.cap ?? "missing"})`,
  );
  lines.push(
    `- long_run_minutes <= long_run_cap: ${plan.guardrail_check.long_run_minutes_lte_long_run_cap.ok} (${plan.guardrail_check.long_run_minutes_lte_long_run_cap.value} <= ${plan.guardrail_check.long_run_minutes_lte_long_run_cap.cap ?? "missing"})`,
  );
  lines.push(
    `- quality_session_count <= quality_cap: ${plan.guardrail_check.quality_session_count_lte_quality_cap.ok} (${plan.guardrail_check.quality_session_count_lte_quality_cap.value} <= ${plan.guardrail_check.quality_session_count_lte_quality_cap.cap ?? "missing"})`,
  );
  lines.push(
    `- no_active_illness_or_injury_conflict: ${plan.guardrail_check.no_active_illness_or_injury_conflict.ok} (${plan.guardrail_check.no_active_illness_or_injury_conflict.details})`,
  );
  lines.push(
    `- no_race_or_recovery_conflict: ${plan.guardrail_check.no_race_or_recovery_conflict.ok} (${plan.guardrail_check.no_race_or_recovery_conflict.details})`,
  );
  lines.push(
    `- no_device_or_upload_issue_conflict: ${plan.guardrail_check.no_device_or_upload_issue_conflict.ok} (${plan.guardrail_check.no_device_or_upload_issue_conflict.details})`,
  );
  lines.push(
    `- no_planned_vs_completed_issue_conflict: ${plan.guardrail_check.no_planned_vs_completed_issue_conflict.ok} (${plan.guardrail_check.no_planned_vs_completed_issue_conflict.details})`,
  );
  lines.push("");
  lines.push("## 7. Why this plan is safe");
  lines.push("- Readiness decision and current baseline caps are enforced.");
  lines.push("- Conservative weekly load target (90% of cap) and conservative long run (90% of cap).");
  lines.push("- At most one controlled quality session and mostly easy distribution.");
  lines.push("");
  lines.push("## 8. What requires coach review");
  if (plan.coach_review_notes.length === 0) {
    lines.push("- No additional review notes.");
  } else {
    for (const note of plan.coach_review_notes) {
      lines.push(`- ${note}`);
    }
  }
  lines.push("");
  lines.push("## 9. Next step recommendation");
  lines.push("- Coach reviews this draft report and either approves or edits the draft.");
  lines.push("- Keep TrainingPeaks write/apply disabled in this phase.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function buildCoachReviewNotes(plan: PlanDraftJson): string {
  const lines = [
    "# Coach Review Notes",
    "",
    `- athlete: ${plan.athlete.name} (${plan.athlete.athlete_id})`,
    `- draft_status: ${plan.status}`,
    `- readiness_decision: ${plan.readiness.decision}`,
    "",
    "## Notes",
  ];
  if (plan.coach_review_notes.length === 0) {
    lines.push("- No additional notes.");
  } else {
    for (const note of plan.coach_review_notes) lines.push(`- ${note}`);
  }
  lines.push("");
  lines.push("## Safety confirmation");
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
  const readinessDir = path.resolve(repoRoot, args.readinessReportDir);
  const readinessPath = path.join(readinessDir, "plan-readiness-dry-run.json");
  const readiness = loadJson<ReadinessReport>(readinessPath);

  let selectedAthlete: ReadinessAthlete | null = null;
  if (args.athleteId !== null) {
    selectedAthlete = readiness.athletes.find((row) => row.athlete_id === args.athleteId) ?? null;
    if (!selectedAthlete) {
      throw new Error(`Athlete ${args.athleteId} not found in readiness report ${readinessPath}`);
    }
  } else {
    const ready = readiness.athletes.filter((row) => row.decision === "ready_for_plan");
    if (ready.length !== 1) {
      throw new Error(
        "Could not auto-resolve athlete_id. Provide --athlete-id explicitly because readiness report does not contain exactly one ready athlete.",
      );
    }
    selectedAthlete = ready[0] ?? null;
  }

  if (!selectedAthlete) {
    throw new Error("Failed to resolve selected athlete from readiness report.");
  }

  const baselineDb = await fetchCurrentBaselineByAthleteIdReadOnly(selectedAthlete.athlete_id);

  const frequencyCap = toRounded(baselineDb?.frequency_cap ?? selectedAthlete.frequency_cap);
  const weeklyMinutesCap = toRounded(baselineDb?.weekly_minutes_cap ?? selectedAthlete.weekly_minutes_cap);
  const longRunCap = toRounded(baselineDb?.long_run_cap_min ?? selectedAthlete.long_run_cap_min);
  const qualityCap = toRounded(baselineDb?.quality_count_cap ?? selectedAthlete.quality_count_cap);

  const rawStats = (baselineDb?.raw_stats_jsonb ?? {}) as Record<string, unknown>;
  const sourceValues = (rawStats.source_values ?? {}) as Record<string, unknown>;
  const baselinePeriodType =
    (typeof sourceValues.baseline_period_type === "string" && sourceValues.baseline_period_type) ||
    selectedAthlete.active_baseline_period ||
    null;

  const missingRequiredData: string[] = [];
  if (frequencyCap === null) missingRequiredData.push("frequency_cap");
  if (weeklyMinutesCap === null) missingRequiredData.push("weekly_minutes_cap");
  if (longRunCap === null) missingRequiredData.push("long_run_cap_min");
  if (qualityCap === null) missingRequiredData.push("quality_count_cap");
  if (selectedAthlete.actual_completed_frequency === null) missingRequiredData.push("actual_completed_frequency");
  if (selectedAthlete.planned_context_frequency === null) missingRequiredData.push("planned_context_frequency");
  if (selectedAthlete.planned_vs_completed_delta === null) missingRequiredData.push("planned_vs_completed_delta");
  if (selectedAthlete.recent_4w_frequency === null) missingRequiredData.push("recent_4w_frequency");
  if (baselinePeriodType === null) missingRequiredData.push("baseline_period_type");

  const op = parseOperationalSummary(selectedAthlete.operational_signal_summary);
  const hasRaceContext = selectedAthlete.race_context_summary !== "no_detected_race_context";
  const hasDeviceIssue = selectedAthlete.data_quality_summary.includes("device_upload_issue");
  const hasPlannedVsCompletedIssue =
    selectedAthlete.reasons.includes("planned_vs_completed_frequency_delta") ||
    selectedAthlete.review_reasons.includes("planned_vs_completed_frequency_delta") ||
    Math.abs(selectedAthlete.planned_vs_completed_delta ?? 0) >= 1;
  const hasMinorUncertainty =
    selectedAthlete.review_reasons.length > 0 ||
    selectedAthlete.data_quality_summary !== "no_data_quality_flags" ||
    op.returnMonitoring ||
    op.requiresCoachClose ||
    hasRaceContext;

  let plannedRunCount = 0;
  if (frequencyCap !== null) {
    const recentFreq = selectedAthlete.recent_4w_frequency !== null ? Math.max(1, Math.round(selectedAthlete.recent_4w_frequency)) : frequencyCap;
    plannedRunCount = hasMinorUncertainty ? Math.min(frequencyCap, recentFreq) : frequencyCap;
  }
  plannedRunCount = Math.max(0, plannedRunCount);

  const plannedWeeklyMinutes = weeklyMinutesCap !== null ? Math.max(0, Math.round(weeklyMinutesCap * 0.9)) : 0;
  const longRunMinutes = longRunCap !== null ? Math.max(0, Math.round(longRunCap * 0.9)) : 0;
  const qualitySessionCount = qualityCap !== null && qualityCap >= 1 ? 1 : 0;
  const recentDiagnostic = loadRecentQualityDiagnosticIfAvailable(repoRoot);
  const qualitySelection = selectQualityMethodologyV0({
    quality_count_cap: qualityCap,
    planned_run_count: plannedRunCount,
    has_active_illness_or_injury: op.activeIllness || op.activePainInjury,
    has_race_context: hasRaceContext,
    recent_quality_diagnostic_available: recentDiagnostic.available,
    found_20x1_candidate: recentDiagnostic.found20x1,
  });

  const workouts: DraftWorkout[] = [];
  const weekStart = args.weekStart;
  const weekEnd = addDays(weekStart, 6);

  if (plannedRunCount > 0 && plannedWeeklyMinutes > 0) {
    const qualityMinutes = qualitySessionCount > 0 ? Math.min(55, Math.max(35, Math.round((plannedWeeklyMinutes - longRunMinutes) * 0.45))) : 0;
    const remainingForEasy = Math.max(0, plannedWeeklyMinutes - longRunMinutes - qualityMinutes);
    const easyCount = plannedRunCount - qualitySessionCount - 1;
    const easyMinutesEach = easyCount > 0 ? Math.max(25, Math.round(remainingForEasy / easyCount)) : 0;

    if (plannedRunCount === 3) {
      workouts.push({
        date: addDays(weekStart, 1),
        day_of_week: weekday(addDays(weekStart, 1)),
        workout_type: "easy_run",
        title: "Easy aerobic run",
        raw_duration_minutes: easyCount > 0 ? easyMinutesEach : Math.max(30, remainingForEasy),
        rounded_duration_minutes: easyCount > 0 ? easyMinutesEach : Math.max(30, remainingForEasy),
        duration_minutes: easyCount > 0 ? easyMinutesEach : Math.max(30, remainingForEasy),
        rounding_reason: "No rounding applied yet.",
        quality_flag: false,
        quality_intent: null,
        quality_workout_key: null,
        structure: null,
        selection_reason: null,
        intensity_target: "easy / conversational",
        coach_notes: "Keep effort relaxed and controlled.",
        guardrail_notes: "Counts toward frequency only; low intensity.",
      });
      if (qualitySessionCount > 0) {
        const qualityDurationFromStructure = qualitySelection.selected
          ? qualitySelection.structure.total_minutes
          : qualityMinutes;
        const qualityTitle = qualitySelection.selected
          ? "Интервалы 10×2 мин"
          : "Quality session requires coach intent selection";
        const qualityCoachNotes = qualitySelection.selected
          ? "Беги сильно, но контролируемо. Восстановление между отрезками — легкий бег трусцой. Не спринтуй первые отрезки; последние отрезки держи технично и стабильно."
          : "Missing explicit quality intent/structure in draft. Manual coach selection is required before writer preview.";
        workouts.push({
          date: addDays(weekStart, 3),
          day_of_week: weekday(addDays(weekStart, 3)),
          workout_type: "controlled_quality",
          title: qualityTitle,
          raw_duration_minutes: qualityDurationFromStructure,
          rounded_duration_minutes: qualityDurationFromStructure,
          duration_minutes: qualityDurationFromStructure,
          rounding_reason: "No rounding applied yet.",
          quality_flag: true,
          quality_intent: qualitySelection.selected ? qualitySelection.intent : null,
          quality_workout_key: qualitySelection.selected ? qualitySelection.workout_key : null,
          structure: qualitySelection.selected ? qualitySelection.structure : null,
          selection_reason: qualitySelection.selection_reason,
          intensity_target: qualitySelection.selected
            ? "strong but controlled VO2-oriented; not all-out"
            : "manual coach review required",
          coach_notes: qualityCoachNotes,
          guardrail_notes: "Single quality session only (v0).",
        });
      }
      workouts.push({
        date: addDays(weekStart, 6),
        day_of_week: weekday(addDays(weekStart, 6)),
        workout_type: "long_easy_run",
        title: "Long easy run",
        raw_duration_minutes: longRunMinutes,
        rounded_duration_minutes: longRunMinutes,
        duration_minutes: longRunMinutes,
        rounding_reason: "No rounding applied yet.",
        quality_flag: false,
        quality_intent: null,
        quality_workout_key: null,
        structure: null,
        selection_reason: null,
        intensity_target: "easy / steady low intensity",
        coach_notes: "Stay aerobic; avoid progression to hard finish.",
        guardrail_notes: "Long run kept below long_run_cap_min.",
      });
    } else {
      // Generic conservative layout for 1/2/4+ runs.
      const baseOffsets = [0, 2, 4, 6];
      const selectedOffsets = baseOffsets.slice(0, plannedRunCount);
      for (let i = 0; i < selectedOffsets.length; i += 1) {
        const offset = selectedOffsets[i]!;
        const isLong = i === selectedOffsets.length - 1;
        const useQuality = qualitySessionCount > 0 && i === 1 && !isLong;
        let type: WorkoutType = "easy_run";
        let title = "Easy aerobic run";
        let duration = easyMinutesEach > 0 ? easyMinutesEach : Math.max(25, Math.round(plannedWeeklyMinutes / plannedRunCount));
        let notes = "Keep effort easy.";
        let intensity = "easy / conversational";
        if (useQuality) {
          type = "controlled_quality";
          title = "Controlled quality support";
          duration = qualityMinutes;
          notes = "Conservative quality only, keep full control.";
          intensity = "comfortably hard, controlled";
        } else if (isLong) {
          type = "long_easy_run";
          title = "Long easy run";
          duration = longRunMinutes;
          notes = "Long aerobic run, no hard surges.";
          intensity = "easy / steady low intensity";
        }
        workouts.push({
          date: addDays(weekStart, offset),
          day_of_week: weekday(addDays(weekStart, offset)),
          workout_type: type,
          title,
          raw_duration_minutes: duration,
          rounded_duration_minutes: duration,
          duration_minutes: duration,
          rounding_reason: "No rounding applied yet.",
          quality_flag: useQuality,
          quality_intent: null,
          quality_workout_key: null,
          structure: null,
          selection_reason: null,
          intensity_target: intensity,
          coach_notes: notes,
          guardrail_notes: isLong
            ? "Long run kept below long_run_cap_min."
            : useQuality
              ? "Single quality session only (v0)."
              : "Easy-only support run.",
        });
      }
    }
  }

  applyCoachStyleRounding(workouts, plannedWeeklyMinutes, weeklyMinutesCap, longRunCap);

  const buildGuardrailCheck = (draftWorkouts: DraftWorkout[]): GuardrailCheck => {
    const plannedMinutesFromWorkouts = draftWorkouts.reduce((sum, workout) => sum + workout.duration_minutes, 0);
    const qualityCountFromWorkouts = draftWorkouts.filter((workout) => workout.quality_flag).length;
    const longRunFromWorkouts = draftWorkouts
      .filter((workout) => workout.workout_type === "long_easy_run")
      .reduce((max, workout) => Math.max(max, workout.duration_minutes), 0);
    return {
      planned_run_count_lte_frequency_cap: {
        ok: frequencyCap !== null && draftWorkouts.length <= frequencyCap,
        value: draftWorkouts.length,
        cap: frequencyCap,
      },
      planned_weekly_minutes_lte_weekly_minutes_cap: {
        ok: weeklyMinutesCap !== null && plannedMinutesFromWorkouts <= weeklyMinutesCap,
        value: plannedMinutesFromWorkouts,
        cap: weeklyMinutesCap,
      },
      long_run_minutes_lte_long_run_cap: {
        ok: longRunCap !== null && longRunFromWorkouts <= longRunCap,
        value: longRunFromWorkouts,
        cap: longRunCap,
      },
      quality_session_count_lte_quality_cap: {
        ok: qualityCap !== null && qualityCountFromWorkouts <= qualityCap,
        value: qualityCountFromWorkouts,
        cap: qualityCap,
      },
      no_active_illness_or_injury_conflict: {
        ok: !op.activeIllness && !op.activePainInjury,
        details: selectedAthlete.operational_signal_summary,
      },
      no_race_or_recovery_conflict: {
        ok: !hasRaceContext,
        details: selectedAthlete.race_context_summary,
      },
      no_device_or_upload_issue_conflict: {
        ok: !hasDeviceIssue,
        details: selectedAthlete.data_quality_summary,
      },
      no_planned_vs_completed_issue_conflict: {
        ok: !hasPlannedVsCompletedIssue,
        details: `delta=${selectedAthlete.planned_vs_completed_delta ?? "missing"}; reasons=${selectedAthlete.reasons.join("|") || "none"}`,
      },
    };
  };
  let guardrailCheck = buildGuardrailCheck(workouts);

  const coachReviewNotes: string[] = [];
  if (selectedAthlete.decision !== "ready_for_plan") {
    coachReviewNotes.push("Readiness decision is not ready_for_plan; draft should not be used for apply.");
  }
  if (missingRequiredData.length > 0) {
    coachReviewNotes.push(`Missing required input data: ${missingRequiredData.join(", ")}.`);
  }
  if (hasMinorUncertainty) {
    coachReviewNotes.push("Minor uncertainty flags detected; frequency was constrained conservatively.");
  }
  if (!guardrailCheck.no_active_illness_or_injury_conflict.ok) {
    coachReviewNotes.push("Active illness/injury conflict detected.");
  }
  if (!guardrailCheck.no_race_or_recovery_conflict.ok) {
    coachReviewNotes.push("Race/recovery context conflict detected.");
  }
  if (!guardrailCheck.no_device_or_upload_issue_conflict.ok) {
    coachReviewNotes.push("Device/upload data quality conflict detected.");
  }
  if (!guardrailCheck.no_planned_vs_completed_issue_conflict.ok) {
    coachReviewNotes.push("Planned-vs-completed frequency conflict detected.");
  }

  const hardGuardrailsPass =
    guardrailCheck.planned_run_count_lte_frequency_cap.ok &&
    guardrailCheck.planned_weekly_minutes_lte_weekly_minutes_cap.ok &&
    guardrailCheck.long_run_minutes_lte_long_run_cap.ok &&
    guardrailCheck.quality_session_count_lte_quality_cap.ok &&
    guardrailCheck.no_active_illness_or_injury_conflict.ok &&
    guardrailCheck.no_race_or_recovery_conflict.ok &&
    guardrailCheck.no_device_or_upload_issue_conflict.ok &&
    guardrailCheck.no_planned_vs_completed_issue_conflict.ok;

  let status: DraftStatus = "draft_ready_for_coach_review";
  let decision: "ready_for_plan" | "needs_coach_review" = "ready_for_plan";
  if (selectedAthlete.decision !== "ready_for_plan") {
    status = "draft_blocked_by_readiness";
    decision = "needs_coach_review";
  } else if (missingRequiredData.length > 0 || !hardGuardrailsPass) {
    status = "draft_invalid_needs_fix";
    decision = "needs_coach_review";
  }

  if (status !== "draft_ready_for_coach_review" && workouts.length > 0) {
    workouts.length = 0;
    coachReviewNotes.push("No workout draft generated because readiness did not allow a plan-ready draft.");
    guardrailCheck = buildGuardrailCheck(workouts);
  }

  const plannedMinutesFromWorkouts = workouts.reduce((sum, workout) => sum + workout.duration_minutes, 0);
  const qualityCountFromWorkouts = workouts.filter((workout) => workout.quality_flag).length;
  const longRunFromWorkouts = workouts
    .filter((workout) => workout.workout_type === "long_easy_run")
    .reduce((max, workout) => Math.max(max, workout.duration_minutes), 0);

  const planJson: PlanDraftJson = {
    generated_at: new Date().toISOString(),
    mode: "draft-only",
    read_only: true,
    no_db_writes: true,
    no_trainingpeaks_mutations: true,
    no_telegram_sends: true,
    athlete: {
      name: selectedAthlete.name,
      athlete_id: selectedAthlete.athlete_id,
      student_id: selectedAthlete.student_id,
    },
    readiness_source: readinessDir,
    readiness_generated_at: readiness.generated_at,
    baseline_source_report_dir: readiness.source_report_dir,
    week: {
      week_start: weekStart,
      week_end: weekEnd,
    },
    status,
    decision,
    baseline: {
      frequency_cap: frequencyCap,
      weekly_minutes_cap: weeklyMinutesCap,
      long_run_cap_min: longRunCap,
      quality_count_cap: qualityCap,
      confidence: baselineDb?.confidence ?? selectedAthlete.confidence,
      actual_completed_frequency: selectedAthlete.actual_completed_frequency,
      planned_context_frequency: selectedAthlete.planned_context_frequency,
      planned_vs_completed_delta: selectedAthlete.planned_vs_completed_delta,
      recent_4w_frequency: selectedAthlete.recent_4w_frequency,
      baseline_period_type: baselinePeriodType,
    },
    readiness: {
      decision: selectedAthlete.decision,
      reasons: selectedAthlete.reasons,
      blocking_reasons: selectedAthlete.blocking_reasons,
      review_reasons: selectedAthlete.review_reasons,
      operational_signal_summary: selectedAthlete.operational_signal_summary,
      race_context_summary: selectedAthlete.race_context_summary,
      data_quality_summary: selectedAthlete.data_quality_summary,
    },
    workouts,
    planned: {
      run_count: workouts.length,
      weekly_minutes: plannedMinutesFromWorkouts,
      long_run_minutes: longRunFromWorkouts,
      quality_session_count: qualityCountFromWorkouts,
    },
    guardrail_check: guardrailCheck,
    missing_required_data: missingRequiredData,
    coach_review_notes: coachReviewNotes,
  };

  const outputDir = path.join(repoRoot, "reports", "plan-draft-generator-v0", timestampForPath(new Date()));
  await mkdir(outputDir, { recursive: true });

  const files = {
    markdown: path.join(outputDir, "PLAN-DRAFT.md"),
    json: path.join(outputDir, "plan-draft.json"),
    workoutsCsv: path.join(outputDir, "workouts.csv"),
    guardrail: path.join(outputDir, "guardrail-check.json"),
    coachReview: path.join(outputDir, "coach-review-notes.md"),
  };

  const workoutRows: string[][] = [
    [
      "date",
      "day_of_week",
      "workout_type",
      "title",
      "raw_duration_minutes",
      "rounded_duration_minutes",
      "duration_minutes",
      "rounding_reason",
      "quality_flag",
      "quality_intent",
      "quality_workout_key",
      "selection_reason",
      "structure_repeat_count",
      "structure_work_minutes",
      "structure_recovery_minutes",
      "structure_total_minutes",
      "intensity_target",
      "coach_notes",
      "guardrail_notes",
    ],
    ...workouts.map((workout) => [
      workout.date,
      workout.day_of_week,
      workout.workout_type,
      workout.title,
      String(workout.raw_duration_minutes),
      String(workout.rounded_duration_minutes),
      String(workout.duration_minutes),
      workout.rounding_reason,
      String(workout.quality_flag),
      workout.quality_intent ?? "",
      workout.quality_workout_key ?? "",
      workout.selection_reason ?? "",
      String(workout.structure?.repeats?.repeat_count ?? ""),
      String(workout.structure?.repeats?.work_minutes ?? ""),
      String(workout.structure?.repeats?.recovery_minutes ?? ""),
      String(workout.structure?.total_minutes ?? ""),
      workout.intensity_target,
      workout.coach_notes,
      workout.guardrail_notes,
    ]),
  ];

  await writeFile(files.markdown, buildMarkdown(planJson), "utf8");
  await writeFile(files.json, `${JSON.stringify(planJson, null, 2)}\n`, "utf8");
  await writeFile(files.workoutsCsv, listToCsv(workoutRows), "utf8");
  await writeFile(files.guardrail, `${JSON.stringify(planJson.guardrail_check, null, 2)}\n`, "utf8");
  await writeFile(files.coachReview, buildCoachReviewNotes(planJson), "utf8");

  if (args.json) {
    console.log(JSON.stringify(planJson, null, 2));
    return;
  }

  console.log("[tp-plan-draft-generator-v0] mode=draft-only");
  console.log("[tp-plan-draft-generator-v0] read_only=true");
  console.log("[tp-plan-draft-generator-v0] no_db_writes=true");
  console.log("[tp-plan-draft-generator-v0] no_trainingpeaks_mutations=true");
  console.log("[tp-plan-draft-generator-v0] no_telegram_sends=true");
  console.log(`readiness_report_dir: ${readinessDir}`);
  console.log(`athlete: ${selectedAthlete.name} (${selectedAthlete.athlete_id})`);
  console.log(`status: ${planJson.status}`);
  console.log(`week: ${weekStart}..${weekEnd}`);
  console.log(`report_dir: ${outputDir}`);
}

main().catch((error: unknown) => {
  console.error("tp-plan-draft-generator-v0 failed.");
  console.error(error);
  process.exit(1);
});
