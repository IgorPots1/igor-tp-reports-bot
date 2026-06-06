import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";
import { toolRoot } from "./lib/paths.ts";

type Confidence = "low" | "medium" | "high";
type Mode = "preview" | "apply";

type CliArgs = {
  athleteId: number | null;
  studentId: string | null;
  sourceReportDir: string;
  qualityValidationDir: string | null;
  previousApplyReportDir: string;
  apply: boolean;
  confirm: string | null;
};

type PerAthleteBaselineRow = {
  student_name: string;
  student_id: string;
  athlete_id: number;
  analyzed_from: string;
  analyzed_to: string;
  confidence: Confidence;
  needs_review: boolean;
  context_flags: string[];
  normal_baseline: {
    frequency_cap: number | null;
    weekly_minutes_cap: number | null;
    long_run_cap_min: number | null;
    quality_count_cap: number | null;
    interval_like_count: number | null;
  };
};

type DbCurrentBaselineRow = {
  id: string;
  student_id: string;
  trainingpeaks_athlete_id: string | null;
  is_current: boolean;
  is_manually_overridden: boolean;
  frequency_cap: number | null;
  weekly_minutes_cap: number | null;
  long_run_cap_min: number | null;
  quality_count_cap: number | null;
  interval_like_count: number | null;
  confidence: Confidence;
  needs_review: boolean;
  context_flags: string[];
  source_report_path: string | null;
};

type SafetyCheck = {
  gate: string;
  passed: boolean;
  detail: string;
};

const TARGET_ATHLETE_ID = 5652949;
const TARGET_STUDENT_ID = "f5f2c862-326f-4dd9-a5da-f555816a225b";
const TARGET_STUDENT_NAME = "Aleksandr Sorokin";
const APPLY_CONFIRM_TEXT = "CORRECT SOROKIN BASELINE QUALITY TO 1";
const CORRECTION_REASON = "quality_classifier_false_positive_fix";
const EXPECTED_CURRENT_QUALITY = 2;
const EXPECTED_PROPOSED_QUALITY = 1;

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

function loadJson<T>(filePath: string): T {
  if (!existsSync(filePath)) {
    throw new Error(`Required file not found: ${filePath}`);
  }
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
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

function listToCsv(rows: string[][]): string {
  return `${rows
    .map((row) =>
      row
        .map((cell) => {
          if (cell.includes(",") || cell.includes('"') || cell.includes("\n")) {
            return `"${cell.replaceAll('"', '""')}"`;
          }
          return cell;
        })
        .join(","),
    )
    .join("\n")}\n`;
}

function toIntOrNull(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.round(value));
}

function normalizeRelativePath(input: string): string {
  return input.replace(/^\.?\/*/, "").replace(/\/+$/, "");
}

function approximatelyEqual(actual: number | null, expected: number | null, tolerance = 1): boolean {
  if (actual === null && expected === null) return true;
  if (actual === null || expected === null) return false;
  return Math.abs(actual - expected) <= tolerance;
}

function printHelp(): void {
  console.log("Guarded single-athlete Baseline v2 correction (Sorokin quality fix)");
  console.log("");
  console.log("Usage:");
  console.log(
    "  npx tsx tools/trainingpeaks-export/scripts/tp-correct-athlete-baseline-v2-once.ts --source-report-dir <baseline-v2-dir> [--quality-validation-dir <dir>] [--previous-apply-report-dir <dir>]",
  );
  console.log("");
  console.log("Default mode:");
  console.log("  - preview only");
  console.log("  - no DB writes");
  console.log("");
  console.log("Apply mode requires all gates:");
  console.log(`  --apply --athlete-id ${TARGET_ATHLETE_ID} --student-id ${TARGET_STUDENT_ID}`);
  console.log(`  --confirm "${APPLY_CONFIRM_TEXT}"`);
  console.log("  BASELINE_V2_CORRECTION_ENABLED=true");
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    athleteId: null,
    studentId: null,
    sourceReportDir: "",
    qualityValidationDir: null,
    previousApplyReportDir: "reports/athlete-training-baseline-v2-apply-preview/20260605-190711",
    apply: false,
    confirm: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg.startsWith("--source-report-dir=")) {
      parsed.sourceReportDir = arg.slice("--source-report-dir=".length).trim();
      continue;
    }
    if (arg === "--source-report-dir") {
      parsed.sourceReportDir = (argv[index + 1] ?? "").trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--quality-validation-dir=")) {
      parsed.qualityValidationDir = arg.slice("--quality-validation-dir=".length).trim();
      continue;
    }
    if (arg === "--quality-validation-dir") {
      parsed.qualityValidationDir = (argv[index + 1] ?? "").trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--previous-apply-report-dir=")) {
      parsed.previousApplyReportDir = arg.slice("--previous-apply-report-dir=".length).trim();
      continue;
    }
    if (arg === "--previous-apply-report-dir") {
      parsed.previousApplyReportDir = (argv[index + 1] ?? "").trim();
      index += 1;
      continue;
    }
    if (arg === "--apply") {
      parsed.apply = true;
      continue;
    }
    if (arg.startsWith("--athlete-id=")) {
      parsed.athleteId = Number.parseInt(arg.slice("--athlete-id=".length), 10);
      continue;
    }
    if (arg === "--athlete-id") {
      parsed.athleteId = Number.parseInt(argv[index + 1] ?? "", 10);
      index += 1;
      continue;
    }
    if (arg.startsWith("--student-id=")) {
      parsed.studentId = arg.slice("--student-id=".length).trim();
      continue;
    }
    if (arg === "--student-id") {
      parsed.studentId = (argv[index + 1] ?? "").trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--confirm=")) {
      parsed.confirm = arg.slice("--confirm=".length);
      continue;
    }
    if (arg === "--confirm") {
      parsed.confirm = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!parsed.sourceReportDir) throw new Error("Missing --source-report-dir.");
  return parsed;
}

async function fetchStudentName(studentId: string): Promise<string | null> {
  const supabase = createSupabaseServerClient();
  const query = await supabase.from("trainingpeaks_students").select("student_name").eq("id", studentId).maybeSingle();
  if (query.error) {
    throw new Error(`student_name_read_failed: ${query.error.message}`);
  }
  return query.data?.student_name?.trim() ?? null;
}

async function fetchCurrentBaselineForStudent(studentId: string): Promise<DbCurrentBaselineRow | null> {
  const supabase = createSupabaseServerClient();
  const query = await supabase
    .from("athlete_training_baselines")
    .select(
      "id, student_id, trainingpeaks_athlete_id, is_current, is_manually_overridden, frequency_cap, weekly_minutes_cap, long_run_cap_min, quality_count_cap, interval_like_count, confidence, needs_review, context_flags, source_report_path",
    )
    .eq("student_id", studentId)
    .eq("is_current", true)
    .maybeSingle();

  if (query.error) {
    throw new Error(`current_baseline_read_failed: ${query.error.message}`);
  }
  return (query.data as DbCurrentBaselineRow | null) ?? null;
}

async function countCurrentRowsForStudent(studentId: string): Promise<number> {
  const supabase = createSupabaseServerClient();
  const query = await supabase
    .from("athlete_training_baselines")
    .select("id", { count: "exact", head: true })
    .eq("student_id", studentId)
    .eq("is_current", true);
  if (query.error) {
    throw new Error(`current_row_count_failed: ${query.error.message}`);
  }
  return query.count ?? 0;
}

async function countAllCurrentRows(): Promise<number> {
  const supabase = createSupabaseServerClient();
  const query = await supabase.from("athlete_training_baselines").select("id", { count: "exact", head: true }).eq("is_current", true);
  if (query.error) {
    throw new Error(`all_current_row_count_failed: ${query.error.message}`);
  }
  return query.count ?? 0;
}

async function fetchBaselineRowById(id: string): Promise<DbCurrentBaselineRow | null> {
  const supabase = createSupabaseServerClient();
  const query = await supabase
    .from("athlete_training_baselines")
    .select(
      "id, student_id, trainingpeaks_athlete_id, is_current, is_manually_overridden, frequency_cap, weekly_minutes_cap, long_run_cap_min, quality_count_cap, interval_like_count, confidence, needs_review, context_flags, source_report_path",
    )
    .eq("id", id)
    .maybeSingle();
  if (query.error) {
    throw new Error(`baseline_row_read_failed: ${query.error.message}`);
  }
  return (query.data as DbCurrentBaselineRow | null) ?? null;
}

function buildSafetyChecks(input: {
  args: CliArgs;
  studentName: string | null;
  currentRow: DbCurrentBaselineRow | null;
  currentRowCount: number;
  sourceRow: PerAthleteBaselineRow | null;
  proposed: {
    frequency_cap: number | null;
    weekly_minutes_cap: number | null;
    long_run_cap_min: number | null;
    quality_count_cap: number | null;
    confidence: Confidence;
  };
}): SafetyCheck[] {
  const checks: SafetyCheck[] = [];

  checks.push({
    gate: "exact_athlete_id",
    passed: input.args.athleteId === null || input.args.athleteId === TARGET_ATHLETE_ID,
    detail: `expected ${TARGET_ATHLETE_ID}, got ${String(input.args.athleteId)}`,
  });
  checks.push({
    gate: "exact_student_id",
    passed: input.args.studentId === null || input.args.studentId === TARGET_STUDENT_ID,
    detail: `expected ${TARGET_STUDENT_ID}, got ${String(input.args.studentId)}`,
  });
  checks.push({
    gate: "exact_student_name",
    passed: input.studentName === TARGET_STUDENT_NAME,
    detail: `expected ${TARGET_STUDENT_NAME}, got ${String(input.studentName)}`,
  });
  checks.push({
    gate: "single_current_row",
    passed: input.currentRowCount === 1,
    detail: `expected 1 current row, got ${input.currentRowCount}`,
  });
  checks.push({
    gate: "current_row_present",
    passed: input.currentRow !== null,
    detail: input.currentRow ? "current row found" : "current row missing",
  });
  checks.push({
    gate: "current_trainingpeaks_athlete_id",
    passed: input.currentRow?.trainingpeaks_athlete_id === String(TARGET_ATHLETE_ID),
    detail: `expected ${TARGET_ATHLETE_ID}, got ${String(input.currentRow?.trainingpeaks_athlete_id)}`,
  });
  checks.push({
    gate: "current_quality_count_cap",
    passed: input.currentRow?.quality_count_cap === EXPECTED_CURRENT_QUALITY,
    detail: `expected ${EXPECTED_CURRENT_QUALITY}, got ${String(input.currentRow?.quality_count_cap)}`,
  });
  checks.push({
    gate: "current_frequency_cap",
    passed: input.currentRow?.frequency_cap === 3,
    detail: `expected 3, got ${String(input.currentRow?.frequency_cap)}`,
  });
  checks.push({
    gate: "current_weekly_minutes_cap",
    passed: approximatelyEqual(input.currentRow?.weekly_minutes_cap ?? null, 218),
    detail: `expected ~218, got ${String(input.currentRow?.weekly_minutes_cap)}`,
  });
  checks.push({
    gate: "current_long_run_cap_min",
    passed: approximatelyEqual(input.currentRow?.long_run_cap_min ?? null, 90),
    detail: `expected ~90, got ${String(input.currentRow?.long_run_cap_min)}`,
  });
  checks.push({
    gate: "source_row_present",
    passed: input.sourceRow !== null,
    detail: input.sourceRow ? "source row found" : "source row missing in report",
  });
  checks.push({
    gate: "source_identity_match",
    passed:
      input.sourceRow?.student_id === TARGET_STUDENT_ID && input.sourceRow?.athlete_id === TARGET_ATHLETE_ID,
    detail: `source student_id=${String(input.sourceRow?.student_id)} athlete_id=${String(input.sourceRow?.athlete_id)}`,
  });
  checks.push({
    gate: "proposed_quality_count_cap",
    passed: input.proposed.quality_count_cap === EXPECTED_PROPOSED_QUALITY,
    detail: `expected ${EXPECTED_PROPOSED_QUALITY}, got ${String(input.proposed.quality_count_cap)}`,
  });
  checks.push({
    gate: "proposed_frequency_cap",
    passed: input.proposed.frequency_cap === 3,
    detail: `expected 3, got ${String(input.proposed.frequency_cap)}`,
  });
  checks.push({
    gate: "proposed_weekly_minutes_cap",
    passed: approximatelyEqual(input.proposed.weekly_minutes_cap, 218),
    detail: `expected ~218, got ${String(input.proposed.weekly_minutes_cap)}`,
  });
  checks.push({
    gate: "proposed_long_run_cap_min",
    passed: approximatelyEqual(input.proposed.long_run_cap_min, 90),
    detail: `expected ~90, got ${String(input.proposed.long_run_cap_min)}`,
  });
  checks.push({
    gate: "proposed_confidence",
    passed: input.proposed.confidence === "high",
    detail: `expected high, got ${input.proposed.confidence}`,
  });
  checks.push({
    gate: "non_quality_fields_unchanged",
    passed:
      input.currentRow !== null &&
      input.currentRow.frequency_cap === input.proposed.frequency_cap &&
      approximatelyEqual(input.currentRow.weekly_minutes_cap, input.proposed.weekly_minutes_cap) &&
      approximatelyEqual(input.currentRow.long_run_cap_min, input.proposed.long_run_cap_min) &&
      input.currentRow.confidence === input.proposed.confidence,
    detail: "only quality_count_cap should change",
  });
  checks.push({
    gate: "manual_override_absent",
    passed: input.currentRow?.is_manually_overridden !== true,
    detail: `is_manually_overridden=${String(input.currentRow?.is_manually_overridden)}`,
  });
  checks.push({
    gate: "single_athlete_target_only",
    passed: true,
    detail: `hardcoded target only: ${TARGET_STUDENT_NAME} (${TARGET_ATHLETE_ID})`,
  });

  return checks;
}

async function applyCorrection(input: {
  currentRow: DbCurrentBaselineRow;
  sourceRow: PerAthleteBaselineRow;
  sourceReportDir: string;
  previousApplyReportDir: string;
  qualityValidationDir: string | null;
}): Promise<{ previousRowId: string; insertedRowId: string | null }> {
  const supabase = createSupabaseServerClient();

  const currentOverrideCheck = await supabase
    .from("athlete_training_baselines")
    .select("id, is_current, is_manually_overridden")
    .eq("id", input.currentRow.id)
    .eq("is_current", true)
    .maybeSingle();

  if (currentOverrideCheck.error) {
    throw new Error(`apply_current_row_recheck_failed: ${currentOverrideCheck.error.message}`);
  }
  if (!currentOverrideCheck.data) {
    throw new Error(`apply_current_row_missing: ${TARGET_STUDENT_ID}`);
  }
  if (currentOverrideCheck.data.is_manually_overridden === true) {
    throw new Error(`manual_override_protected: ${TARGET_STUDENT_ID}`);
  }

  const deactivate = await supabase
    .from("athlete_training_baselines")
    .update({ is_current: false })
    .eq("id", input.currentRow.id)
    .eq("is_current", true);
  if (deactivate.error) {
    throw new Error(`apply_deactivate_current_failed: ${deactivate.error.message}`);
  }

  const insertPayload = {
    student_id: input.sourceRow.student_id,
    trainingpeaks_athlete_id: String(input.sourceRow.athlete_id),
    source_report_path: input.sourceReportDir,
    source_from: input.sourceRow.analyzed_from,
    source_to: input.sourceRow.analyzed_to,
    is_current: true,
    frequency_cap: toIntOrNull(input.sourceRow.normal_baseline.frequency_cap),
    weekly_minutes_cap: toIntOrNull(input.sourceRow.normal_baseline.weekly_minutes_cap),
    long_run_cap_min: toIntOrNull(input.sourceRow.normal_baseline.long_run_cap_min),
    quality_count_cap: toIntOrNull(input.sourceRow.normal_baseline.quality_count_cap),
    interval_like_count: toIntOrNull(input.sourceRow.normal_baseline.interval_like_count),
    confidence: input.sourceRow.confidence,
    needs_review: input.sourceRow.needs_review,
    context_flags: input.sourceRow.context_flags,
    raw_stats_jsonb: {
      baseline_source: "completed_actual_running_v2",
      correction_metadata: {
        mode: "baseline_v2_single_athlete_correction",
        correction_reason: CORRECTION_REASON,
        source_report_dir: input.sourceReportDir,
        previous_apply_report_dir: input.previousApplyReportDir,
        quality_fix_validation_dir: input.qualityValidationDir,
        corrected_at: new Date().toISOString(),
        previous_current_row_id: input.currentRow.id,
      },
    },
  };

  const inserted = await supabase.from("athlete_training_baselines").insert(insertPayload).select("id").single();
  if (inserted.error) {
    throw new Error(`apply_insert_new_baseline_failed: ${inserted.error.message}`);
  }

  return {
    previousRowId: input.currentRow.id,
    insertedRowId: (inserted.data as { id: string } | null)?.id ?? null,
  };
}

async function main(): Promise<void> {
  loadLocalEnv();
  if (!process.env.SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_URL) {
    process.env.SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  }

  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(toolRoot, "..", "..");
  const sourceReportDirAbs = path.resolve(repoRoot, args.sourceReportDir);
  const perAthletePath = path.join(sourceReportDirAbs, "per-athlete-baseline-v2.json");
  const perAthleteRows = loadJson<PerAthleteBaselineRow[]>(perAthletePath);
  const sourceRow = perAthleteRows.find((row) => row.student_id === TARGET_STUDENT_ID) ?? null;

  const proposed = {
    frequency_cap: toIntOrNull(sourceRow?.normal_baseline.frequency_cap ?? null),
    weekly_minutes_cap: toIntOrNull(sourceRow?.normal_baseline.weekly_minutes_cap ?? null),
    long_run_cap_min: toIntOrNull(sourceRow?.normal_baseline.long_run_cap_min ?? null),
    quality_count_cap: toIntOrNull(sourceRow?.normal_baseline.quality_count_cap ?? null),
    interval_like_count: toIntOrNull(sourceRow?.normal_baseline.interval_like_count ?? null),
    confidence: sourceRow?.confidence ?? ("low" as Confidence),
  };

  const studentName = await fetchStudentName(TARGET_STUDENT_ID);
  const currentRow = await fetchCurrentBaselineForStudent(TARGET_STUDENT_ID);
  const currentRowCount = await countCurrentRowsForStudent(TARGET_STUDENT_ID);
  const allCurrentRowsBefore = await countAllCurrentRows();

  const safetyChecks = buildSafetyChecks({
    args,
    studentName,
    currentRow,
    currentRowCount,
    sourceRow,
    proposed,
  });
  const allGatesPassed = safetyChecks.every((check) => check.passed);

  const missingApplyGates: string[] = [];
  if (args.apply) {
    if (process.env.BASELINE_V2_CORRECTION_ENABLED !== "true") {
      missingApplyGates.push("BASELINE_V2_CORRECTION_ENABLED=true");
    }
    if (args.confirm !== APPLY_CONFIRM_TEXT) {
      missingApplyGates.push(`--confirm "${APPLY_CONFIRM_TEXT}"`);
    }
    if (args.athleteId !== TARGET_ATHLETE_ID) {
      missingApplyGates.push(`--athlete-id ${TARGET_ATHLETE_ID}`);
    }
    if (args.studentId !== TARGET_STUDENT_ID) {
      missingApplyGates.push(`--student-id ${TARGET_STUDENT_ID}`);
    }
  }

  const mode: Mode = args.apply ? "apply" : "preview";
  const outputRoot = args.apply
    ? path.join(repoRoot, "reports", "athlete-training-baseline-v2-single-correction-apply")
    : path.join(repoRoot, "reports", "athlete-training-baseline-v2-single-correction-preview");
  const outputDir = path.join(outputRoot, timestampForPath(new Date()));
  await mkdir(outputDir, { recursive: true });

  const beforeAfter = {
    athlete_id: TARGET_ATHLETE_ID,
    student_id: TARGET_STUDENT_ID,
    student_name: TARGET_STUDENT_NAME,
    current_frequency_cap: currentRow?.frequency_cap ?? null,
    proposed_frequency_cap: proposed.frequency_cap,
    current_weekly_minutes_cap: currentRow?.weekly_minutes_cap ?? null,
    proposed_weekly_minutes_cap: proposed.weekly_minutes_cap,
    current_long_run_cap_min: currentRow?.long_run_cap_min ?? null,
    proposed_long_run_cap_min: proposed.long_run_cap_min,
    current_quality_count_cap: currentRow?.quality_count_cap ?? null,
    proposed_quality_count_cap: proposed.quality_count_cap,
    current_interval_like_count: currentRow?.interval_like_count ?? null,
    proposed_interval_like_count: proposed.interval_like_count,
    current_confidence: currentRow?.confidence ?? null,
    proposed_confidence: proposed.confidence,
  };

  let applyResult: {
    previousRowId: string;
    insertedRowId: string | null;
    previousRowAfter: DbCurrentBaselineRow | null;
    currentRowAfter: DbCurrentBaselineRow | null;
    allCurrentRowsAfter: number;
  } | null = null;

  if (args.apply) {
    if (missingApplyGates.length > 0) {
      throw new Error(`apply_gates_failed_closed: ${missingApplyGates.join("; ")}`);
    }
    if (!allGatesPassed) {
      throw new Error("safety_gates_failed_closed");
    }
    if (!currentRow || !sourceRow) {
      throw new Error("apply_missing_required_rows");
    }

    const result = await applyCorrection({
      currentRow,
      sourceRow,
      sourceReportDir: normalizeRelativePath(args.sourceReportDir),
      previousApplyReportDir: normalizeRelativePath(args.previousApplyReportDir),
      qualityValidationDir: args.qualityValidationDir ? normalizeRelativePath(args.qualityValidationDir) : null,
    });

    const previousRowAfter = await fetchBaselineRowById(result.previousRowId);
    const currentRowAfter = await fetchCurrentBaselineForStudent(TARGET_STUDENT_ID);
    const allCurrentRowsAfter = await countAllCurrentRows();

    applyResult = {
      ...result,
      previousRowAfter,
      currentRowAfter,
      allCurrentRowsAfter,
    };
  }

  const safetyPayload = {
    generated_at: new Date().toISOString(),
    mode,
    dry_run_only: !args.apply,
    no_db_writes_performed: !args.apply,
    correction_strategy: "append_only_deactivate_previous_insert_new",
    target_athlete_id: TARGET_ATHLETE_ID,
    target_student_id: TARGET_STUDENT_ID,
    target_student_name: TARGET_STUDENT_NAME,
    source_report_dir: args.sourceReportDir,
    previous_apply_report_dir: args.previousApplyReportDir,
    quality_validation_dir: args.qualityValidationDir,
    all_gates_passed: allGatesPassed,
    apply_gates_required: {
      apply_flag: true,
      athlete_id: TARGET_ATHLETE_ID,
      student_id: TARGET_STUDENT_ID,
      confirm_text: APPLY_CONFIRM_TEXT,
      env_gate: "BASELINE_V2_CORRECTION_ENABLED=true",
    },
    checks: safetyChecks,
    all_current_rows_before: allCurrentRowsBefore,
    all_current_rows_after: applyResult?.allCurrentRowsAfter ?? null,
  };

  const previewMarkdown = [
    args.apply ? "# SOROKIN BASELINE CORRECTION APPLY" : "# SOROKIN BASELINE CORRECTION PREVIEW",
    "",
    args.apply ? "**APPLY COMPLETED.**" : "**DRY RUN ONLY. NO DB WRITES PERFORMED.**",
    "",
    `- mode: ${mode}`,
    `- correction_strategy: append_only_deactivate_previous_insert_new`,
    `- target: ${TARGET_STUDENT_NAME} (${TARGET_ATHLETE_ID} / ${TARGET_STUDENT_ID})`,
    `- source_report_dir: ${args.sourceReportDir}`,
    `- previous_apply_report_dir: ${args.previousApplyReportDir}`,
    `- quality_validation_dir: ${args.qualityValidationDir ?? "n/a"}`,
    `- all_gates_passed: ${allGatesPassed}`,
    "",
    "## Before / After",
    `- quality_count_cap: ${String(beforeAfter.current_quality_count_cap)} -> ${String(beforeAfter.proposed_quality_count_cap)}`,
    `- frequency_cap: ${String(beforeAfter.current_frequency_cap)} -> ${String(beforeAfter.proposed_frequency_cap)}`,
    `- weekly_minutes_cap: ${String(beforeAfter.current_weekly_minutes_cap)} -> ${String(beforeAfter.proposed_weekly_minutes_cap)}`,
    `- long_run_cap: ${String(beforeAfter.current_long_run_cap_min)} -> ${String(beforeAfter.proposed_long_run_cap_min)}`,
    `- confidence: ${String(beforeAfter.current_confidence)} -> ${String(beforeAfter.proposed_confidence)}`,
    "",
    "## Safety Gates",
    ...safetyChecks.map((check) => `- ${check.gate}: ${check.passed ? "PASS" : "FAIL"} (${check.detail})`),
  ];

  if (applyResult) {
    previewMarkdown.push(
      "",
      "## Post-Apply Verification",
      `- previous_row_id: ${applyResult.previousRowId}`,
      `- inserted_row_id: ${applyResult.insertedRowId ?? "unknown"}`,
      `- previous_row_is_current: ${String(applyResult.previousRowAfter?.is_current ?? "unknown")}`,
      `- current_row_quality_count_cap: ${String(applyResult.currentRowAfter?.quality_count_cap ?? "unknown")}`,
      `- current_row_count_for_student: ${applyResult.currentRowAfter ? "1 expected" : "missing"}`,
      `- all_current_rows_before: ${allCurrentRowsBefore}`,
      `- all_current_rows_after: ${applyResult.allCurrentRowsAfter}`,
    );
  }

  const markdownFileName = args.apply ? "SOROKIN-CORRECTION-APPLY.md" : "SOROKIN-CORRECTION-PREVIEW.md";
  const jsonFileName = args.apply ? "sorokin-correction-apply.json" : "sorokin-correction-preview.json";

  await writeFile(path.join(outputDir, markdownFileName), `${previewMarkdown.join("\n")}\n`, "utf8");
  await writeFile(
    path.join(outputDir, jsonFileName),
    `${JSON.stringify(
      {
        ...safetyPayload,
        before_after: beforeAfter,
        apply_result: applyResult,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(path.join(outputDir, "safety-checks.json"), `${JSON.stringify(safetyPayload, null, 2)}\n`, "utf8");
  await writeFile(
    path.join(outputDir, "before-after.csv"),
    listToCsv([
      [
        "field",
        "current",
        "proposed",
      ],
      ["quality_count_cap", String(beforeAfter.current_quality_count_cap ?? ""), String(beforeAfter.proposed_quality_count_cap ?? "")],
      ["frequency_cap", String(beforeAfter.current_frequency_cap ?? ""), String(beforeAfter.proposed_frequency_cap ?? "")],
      [
        "weekly_minutes_cap",
        String(beforeAfter.current_weekly_minutes_cap ?? ""),
        String(beforeAfter.proposed_weekly_minutes_cap ?? ""),
      ],
      ["long_run_cap_min", String(beforeAfter.current_long_run_cap_min ?? ""), String(beforeAfter.proposed_long_run_cap_min ?? "")],
      ["confidence", String(beforeAfter.current_confidence ?? ""), String(beforeAfter.proposed_confidence ?? "")],
    ]),
    "utf8",
  );

  if (!allGatesPassed && !args.apply) {
    console.log("[tp-correct-athlete-baseline-v2-once] preview blocked by failed safety gates");
  } else {
    console.log(`[tp-correct-athlete-baseline-v2-once] mode=${mode}`);
    if (!args.apply) {
      console.log("[tp-correct-athlete-baseline-v2-once] DRY RUN ONLY. NO DB WRITES PERFORMED.");
    }
  }
  console.log(`output_dir: ${outputDir}`);
  console.log(`all_gates_passed: ${allGatesPassed}`);

  if (!allGatesPassed) {
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error("tp-correct-athlete-baseline-v2-once failed.");
  console.error(error);
  process.exit(1);
});
