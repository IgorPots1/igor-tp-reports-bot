import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import type { PostgrestError } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/features/supabase/server";

const LOG_PREFIX = "[import-athlete-training-baselines]";
const DEFAULT_REPORT_DIR = "reports/athlete-training-baseline/20260603-143558";
const KNOWN_CONTEXT_FLAGS = new Set([
  "insufficient_data",
  "injury",
  "acute_pain",
  "illness",
  "returning",
  "run_walk_actual",
  "pilot",
  "low_confidence",
  "manual_review",
]);

type CliOptions = {
  apply: boolean;
  reportDir: string;
  reportDirProvided: boolean;
};

type BaselineSummaryJson = {
  input?: {
    from?: string;
    to?: string;
  };
  cohort?: {
    athletes_analyzed?: number;
  };
};

type PerAthleteBaselineRow = {
  identity?: {
    student_name?: string;
    student_id?: string;
    internal_id?: string;
    trainingpeaks_athlete_id?: number | string | null;
    analyzed_from?: string;
    analyzed_to?: string;
  };
  weekly_baseline?: {
    planned_running_workouts_per_week?: {
      median?: number | null;
    };
    planned_running_minutes_per_week?: {
      median?: number | null;
    };
  };
  long_run_baseline?: {
    typical_long_run_duration_minutes?: number | null;
  };
  family_distribution_per_week?: Record<string, { median?: number | null } | null> | null;
  quality_baseline?: {
    quality_sessions_per_week?: {
      median?: number | null;
    };
    most_common_interval_patterns?: Array<{ pattern?: string | null; count?: number | null }> | null;
  };
  planning_baseline_recommendation?: {
    recommended_initial_frequency?: number | null;
    do_not_exceed_weekly_minutes_without_coach_review?: number | null;
    do_not_exceed_long_run_minutes_without_coach_review?: number | null;
    typical_quality_sessions_per_week?: number | null;
    baseline_confidence?: string | null;
    needs_coach_review?: boolean | null;
  };
  safety_flags?: {
    insufficient_data?: boolean;
    risky_load_pattern?: boolean;
    notes?: string[];
  };
};

type StudentRow = {
  id: string;
  student_id: string;
  student_name: string;
};

type ParsedBaselineRow = {
  studentName: string;
  studentKeyNormalized: string;
  studentIdExternal: string | null;
  studentIdInternal: string | null;
  trainingpeaksAthleteId: string | null;
  sourceFrom: string;
  sourceTo: string;
  frequencyCap: number | null;
  weeklyMinutesCap: number | null;
  longRunCapMin: number | null;
  qualityCountCap: number | null;
  intervalLikeCount: number | null;
  confidence: "low" | "medium" | "high";
  needsReview: boolean;
  contextFlags: string[];
  familyLabelAdvisory: string | null;
  rawStats: Record<string, unknown>;
  warnings: string[];
};

type ImportPayloadRow = {
  student_id: string;
  trainingpeaks_athlete_id: string | null;
  source_report_path: string;
  source_from: string;
  source_to: string;
  generated_at: string;
  is_current: boolean;
  frequency_cap: number | null;
  weekly_minutes_cap: number | null;
  long_run_cap_min: number | null;
  quality_count_cap: number | null;
  interval_like_count: number | null;
  confidence: "low" | "medium" | "high";
  needs_review: boolean;
  context_flags: string[];
  family_label_advisory: string | null;
  raw_stats_jsonb: Record<string, unknown>;
};

type ImportSummary = {
  reportDir: string;
  sourceFrom: string;
  sourceTo: string;
  rowsParsed: number;
  rowsMatched: number;
  rowsMissingMatch: number;
  rowsAmbiguousMatch: number;
  rowsInsertedOrUpdated: number;
  currentBaselinesMarkedNonCurrent: number;
  confidenceCounts: Record<string, number>;
  contextFlagCounts: Record<string, number>;
  warnings: string[];
  expectedAthletesAnalyzed: number | null;
};

function loadLocalEnvFiles(): void {
  const repoRoot = path.resolve(process.cwd());
  const envPaths = [path.join(repoRoot, ".env.local"), path.join(repoRoot, ".env")];
  for (const envPath of envPaths) {
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
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

function getEnvValue(
  name: "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"
): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function normalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/ё/gu, "е");
}

function parseArgs(argv: string[]): CliOptions {
  let apply = false;
  let reportDir = DEFAULT_REPORT_DIR;
  let reportDirProvided = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg.startsWith("--report-dir=")) {
      reportDir = arg.slice("--report-dir=".length).trim();
      reportDirProvided = true;
      continue;
    }
    if (arg === "--report-dir") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --report-dir`);
      }
      reportDir = next;
      reportDirProvided = true;
      index += 1;
      continue;
    }
  }

  return {
    apply,
    reportDir,
    reportDirProvided,
  };
}

function resolveReportDir(inputDir: string): string {
  const resolved = path.resolve(process.cwd(), inputDir);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`${LOG_PREFIX} FAIL: report directory not found: ${inputDir}`);
  }
  return resolved;
}

function readJsonFile<T>(filePath: string): T {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${LOG_PREFIX} FAIL: required file missing: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, "utf8");
  return JSON.parse(content) as T;
}

function asNonNegativeInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const rounded = Math.round(value);
  return rounded >= 0 ? rounded : null;
}

function parseConfidence(value: unknown): "low" | "medium" | "high" {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }
  return "low";
}

function getIntervalLikeCount(row: PerAthleteBaselineRow): number | null {
  const patterns = row.quality_baseline?.most_common_interval_patterns;
  if (!Array.isArray(patterns) || patterns.length === 0) {
    return null;
  }
  let total = 0;
  for (const pattern of patterns) {
    const count = asNonNegativeInteger(pattern?.count ?? null);
    if (count != null) {
      total += count;
    }
  }
  return total > 0 ? total : null;
}

function getFamilyLabelAdvisory(row: PerAthleteBaselineRow): string | null {
  const familyDistribution = row.family_distribution_per_week;
  if (!familyDistribution || typeof familyDistribution !== "object") {
    return null;
  }

  let winner: { name: string; value: number } | null = null;
  for (const [name, stats] of Object.entries(familyDistribution)) {
    const median = asNonNegativeInteger((stats as { median?: number | null } | null)?.median ?? null);
    if (median == null) {
      continue;
    }
    if (winner == null || median > winner.value) {
      winner = { name, value: median };
    }
  }

  return winner ? winner.name : null;
}

function buildContextFlags(row: PerAthleteBaselineRow): string[] {
  const flags = new Set<string>();
  const confidence = parseConfidence(row.planning_baseline_recommendation?.baseline_confidence ?? null);
  const insufficientData = row.safety_flags?.insufficient_data === true;
  const riskyLoad = row.safety_flags?.risky_load_pattern === true;
  const notesRaw = row.safety_flags?.notes ?? [];
  const notes = Array.isArray(notesRaw) ? notesRaw.map((item) => String(item).toLowerCase()) : [];

  if (insufficientData) {
    flags.add("insufficient_data");
    flags.add("manual_review");
  }
  if (confidence === "low") {
    flags.add("low_confidence");
    flags.add("manual_review");
  }
  if (riskyLoad) {
    flags.add("manual_review");
  }
  if (notes.some((note) => note.includes("return"))) {
    flags.add("returning");
  }

  return Array.from(flags).filter((flag) => KNOWN_CONTEXT_FLAGS.has(flag));
}

function parseRows(
  rows: PerAthleteBaselineRow[],
  summary: BaselineSummaryJson,
  sourceReportPath: string
): {
  parsedRows: ParsedBaselineRow[];
  expectedAthletesAnalyzed: number | null;
} {
  const defaultFrom = summary.input?.from;
  const defaultTo = summary.input?.to;
  if (!defaultFrom || !defaultTo) {
    throw new Error(`${LOG_PREFIX} FAIL: baseline-summary.json is missing input.from/input.to`);
  }

  const parsedRows: ParsedBaselineRow[] = rows.map((row) => {
    const identity = row.identity ?? {};
    const studentName = String(identity.student_name ?? "").trim();
    const studentIdExternal = identity.student_id ? String(identity.student_id) : null;
    const studentIdInternal = identity.internal_id ? String(identity.internal_id) : null;
    const trainingpeaksAthleteId =
      identity.trainingpeaks_athlete_id == null ? null : String(identity.trainingpeaks_athlete_id);
    const sourceFrom = String(identity.analyzed_from ?? defaultFrom);
    const sourceTo = String(identity.analyzed_to ?? defaultTo);
    const confidence = parseConfidence(row.planning_baseline_recommendation?.baseline_confidence ?? null);
    const contextFlags = buildContextFlags(row);
    const warnings: string[] = [];

    const frequencyCap =
      asNonNegativeInteger(row.planning_baseline_recommendation?.recommended_initial_frequency ?? null) ??
      asNonNegativeInteger(row.weekly_baseline?.planned_running_workouts_per_week?.median ?? null);
    if (frequencyCap == null) {
      warnings.push("frequency_cap_unmapped");
    }

    const weeklyMinutesCap =
      asNonNegativeInteger(
        row.planning_baseline_recommendation?.do_not_exceed_weekly_minutes_without_coach_review ?? null
      ) ?? asNonNegativeInteger(row.weekly_baseline?.planned_running_minutes_per_week?.median ?? null);
    if (weeklyMinutesCap == null) {
      warnings.push("weekly_minutes_cap_unmapped");
    }

    const longRunCapMin =
      asNonNegativeInteger(
        row.planning_baseline_recommendation?.do_not_exceed_long_run_minutes_without_coach_review ?? null
      ) ?? asNonNegativeInteger(row.long_run_baseline?.typical_long_run_duration_minutes ?? null);
    if (longRunCapMin == null) {
      warnings.push("long_run_cap_unmapped");
    }

    const qualityCountCap =
      asNonNegativeInteger(row.planning_baseline_recommendation?.typical_quality_sessions_per_week ?? null) ??
      asNonNegativeInteger(row.quality_baseline?.quality_sessions_per_week?.median ?? null);
    if (qualityCountCap == null) {
      warnings.push("quality_count_cap_unmapped");
    }

    const intervalLikeCount = getIntervalLikeCount(row);
    if (intervalLikeCount == null) {
      warnings.push("interval_like_count_unmapped");
    }

    const needsReview =
      row.planning_baseline_recommendation?.needs_coach_review === true || contextFlags.includes("manual_review");
    const familyLabelAdvisory = getFamilyLabelAdvisory(row);

    return {
      studentName,
      studentKeyNormalized: normalizeName(studentName),
      studentIdExternal,
      studentIdInternal,
      trainingpeaksAthleteId,
      sourceFrom,
      sourceTo,
      frequencyCap,
      weeklyMinutesCap,
      longRunCapMin,
      qualityCountCap,
      intervalLikeCount,
      confidence,
      needsReview,
      contextFlags,
      familyLabelAdvisory,
      rawStats: {
        source_report_path: sourceReportPath,
        source_identity: row.identity ?? null,
        weekly_baseline: row.weekly_baseline ?? null,
        family_distribution_per_week: row.family_distribution_per_week ?? null,
        long_run_baseline: row.long_run_baseline ?? null,
        quality_baseline: row.quality_baseline ?? null,
        planning_baseline_recommendation: row.planning_baseline_recommendation ?? null,
        safety_flags: row.safety_flags ?? null,
      },
      warnings,
    };
  });

  const expectedAthletesAnalyzed = asNonNegativeInteger(summary.cohort?.athletes_analyzed ?? null);

  return {
    parsedRows,
    expectedAthletesAnalyzed,
  };
}

function isMissingRelationError(error: PostgrestError | null): boolean {
  if (!error) {
    return false;
  }
  const code = (error.code ?? "").toUpperCase();
  const message = (error.message ?? "").toLowerCase();
  return (
    code === "PGRST205" ||
    code === "42P01" ||
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("could not find the table")
  );
}

function printSummary(summary: ImportSummary): void {
  console.log(`${LOG_PREFIX} report_dir=${summary.reportDir}`);
  console.log(`${LOG_PREFIX} source_from=${summary.sourceFrom}`);
  console.log(`${LOG_PREFIX} source_to=${summary.sourceTo}`);
  console.log(`${LOG_PREFIX} rows_parsed=${summary.rowsParsed}`);
  console.log(`${LOG_PREFIX} rows_matched_to_students=${summary.rowsMatched}`);
  console.log(`${LOG_PREFIX} rows_missing_student_match=${summary.rowsMissingMatch}`);
  console.log(`${LOG_PREFIX} rows_ambiguous_name_match=${summary.rowsAmbiguousMatch}`);
  console.log(`${LOG_PREFIX} rows_inserted_or_updated=${summary.rowsInsertedOrUpdated}`);
  console.log(`${LOG_PREFIX} current_baselines_marked_non_current=${summary.currentBaselinesMarkedNonCurrent}`);
  console.log(`${LOG_PREFIX} confidence_counts=${JSON.stringify(summary.confidenceCounts)}`);
  console.log(`${LOG_PREFIX} context_flag_counts=${JSON.stringify(summary.contextFlagCounts)}`);
  if (summary.expectedAthletesAnalyzed != null) {
    console.log(`${LOG_PREFIX} expected_athletes_analyzed=${summary.expectedAthletesAnalyzed}`);
  }
  for (const warning of summary.warnings) {
    console.log(`${LOG_PREFIX} warning=${warning}`);
  }
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.apply && !options.reportDirProvided) {
    throw new Error(`${LOG_PREFIX} FAIL: --report-dir is required when using --apply`);
  }
  const resolvedReportDir = resolveReportDir(options.reportDir);
  const reportDirRelative = path.relative(process.cwd(), resolvedReportDir) || ".";
  const perAthleteJsonPath = path.join(resolvedReportDir, "per-athlete-baseline.json");
  const baselineSummaryJsonPath = path.join(resolvedReportDir, "baseline-summary.json");

  const perAthleteRows = readJsonFile<PerAthleteBaselineRow[]>(perAthleteJsonPath);
  if (!Array.isArray(perAthleteRows)) {
    throw new Error(`${LOG_PREFIX} FAIL: per-athlete-baseline.json must be an array`);
  }
  const baselineSummary = readJsonFile<BaselineSummaryJson>(baselineSummaryJsonPath);
  const sourceReportPath = path.join(reportDirRelative, "per-athlete-baseline.json");
  const { parsedRows, expectedAthletesAnalyzed } = parseRows(perAthleteRows, baselineSummary, sourceReportPath);

  if (!options.apply) {
    const confidenceCounts: Record<string, number> = {};
    const contextFlagCounts: Record<string, number> = {};
    const warnings: string[] = [];
    for (const row of parsedRows) {
      confidenceCounts[row.confidence] = (confidenceCounts[row.confidence] ?? 0) + 1;
      for (const contextFlag of row.contextFlags) {
        contextFlagCounts[contextFlag] = (contextFlagCounts[contextFlag] ?? 0) + 1;
      }
      for (const warning of row.warnings) {
        warnings.push(`${row.studentName}: ${warning}`);
      }
    }
    printSummary({
      reportDir: reportDirRelative,
      sourceFrom: baselineSummary.input?.from ?? "unknown",
      sourceTo: baselineSummary.input?.to ?? "unknown",
      rowsParsed: parsedRows.length,
      rowsMatched: 0,
      rowsMissingMatch: 0,
      rowsAmbiguousMatch: 0,
      rowsInsertedOrUpdated: 0,
      currentBaselinesMarkedNonCurrent: 0,
      confidenceCounts,
      contextFlagCounts,
      warnings,
      expectedAthletesAnalyzed,
    });
    console.log(`${LOG_PREFIX} mode=dry-run`);
    console.log(`${LOG_PREFIX} note=run with --apply to write data`);
    return;
  }

  loadLocalEnvFiles();
  const supabaseUrl = getEnvValue("NEXT_PUBLIC_SUPABASE_URL") ?? getEnvValue("SUPABASE_URL");
  const serviceRoleKey = getEnvValue("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      `${LOG_PREFIX} FAIL: missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY`
    );
  }
  if (!process.env.SUPABASE_URL) {
    process.env.SUPABASE_URL = supabaseUrl;
  }

  const supabase = createSupabaseServerClient();

  const baselineTableProbe = await supabase
    .from("athlete_training_baselines")
    .select("id")
    .limit(1);
  if (isMissingRelationError(baselineTableProbe.error ?? null)) {
    throw new Error(
      `${LOG_PREFIX} FAIL: table public.athlete_training_baselines does not exist. Apply migration first.`
    );
  }
  if (baselineTableProbe.error) {
    throw new Error(`${LOG_PREFIX} FAIL: unable to access athlete_training_baselines: ${baselineTableProbe.error.message}`);
  }

  const studentsResult = await supabase
    .from("trainingpeaks_students")
    .select("id, student_id, student_name")
    .limit(10000);
  if (studentsResult.error) {
    throw new Error(`${LOG_PREFIX} FAIL: unable to read trainingpeaks_students: ${studentsResult.error.message}`);
  }
  const students = (studentsResult.data ?? []) as StudentRow[];
  const studentsById = new Map<string, StudentRow>();
  const studentsByExternalId = new Map<string, StudentRow>();
  const studentsByName = new Map<string, StudentRow[]>();
  for (const student of students) {
    studentsById.set(student.id, student);
    studentsByExternalId.set(student.student_id, student);
    const key = normalizeName(student.student_name);
    const bucket = studentsByName.get(key) ?? [];
    bucket.push(student);
    studentsByName.set(key, bucket);
  }

  const baselineRowsResult = await supabase
    .from("athlete_training_baselines")
    .select("student_id, trainingpeaks_athlete_id")
    .eq("is_current", true);
  if (baselineRowsResult.error) {
    throw new Error(`${LOG_PREFIX} FAIL: unable to inspect current baselines: ${baselineRowsResult.error.message}`);
  }
  const currentBaselines = (baselineRowsResult.data ?? []) as Array<{
    student_id: string;
    trainingpeaks_athlete_id: string | null;
  }>;
  const existingStudentByTpAthleteId = new Map<string, string>();
  for (const baseline of currentBaselines) {
    if (baseline.trainingpeaks_athlete_id) {
      existingStudentByTpAthleteId.set(baseline.trainingpeaks_athlete_id, baseline.student_id);
    }
  }

  const matchedRows: Array<{ parsed: ParsedBaselineRow; student: StudentRow }> = [];
  const missingRows: ParsedBaselineRow[] = [];
  const ambiguousRows: ParsedBaselineRow[] = [];

  for (const parsed of parsedRows) {
    let student: StudentRow | null = null;

    if (parsed.studentIdInternal && studentsById.has(parsed.studentIdInternal)) {
      student = studentsById.get(parsed.studentIdInternal) ?? null;
    }
    if (!student && parsed.studentIdExternal && studentsByExternalId.has(parsed.studentIdExternal)) {
      student = studentsByExternalId.get(parsed.studentIdExternal) ?? null;
    }
    if (!student && parsed.trainingpeaksAthleteId) {
      const matchedStudentId = existingStudentByTpAthleteId.get(parsed.trainingpeaksAthleteId);
      if (matchedStudentId && studentsById.has(matchedStudentId)) {
        student = studentsById.get(matchedStudentId) ?? null;
      }
    }
    if (!student) {
      const byName = studentsByName.get(parsed.studentKeyNormalized) ?? [];
      if (byName.length === 1) {
        student = byName[0];
      } else if (byName.length > 1) {
        ambiguousRows.push(parsed);
        continue;
      }
    }

    if (!student) {
      missingRows.push(parsed);
      continue;
    }

    matchedRows.push({ parsed, student });
  }

  const uniqueStudentIds = Array.from(new Set(matchedRows.map((row) => row.student.id)));
  if (uniqueStudentIds.length > 0) {
    const { error: updateOldError } = await supabase
      .from("athlete_training_baselines")
      .update({ is_current: false })
      .in("student_id", uniqueStudentIds)
      .eq("is_current", true);
    if (updateOldError) {
      throw new Error(`${LOG_PREFIX} FAIL: unable to mark previous baselines non-current: ${updateOldError.message}`);
    }
  }

  const payload: ImportPayloadRow[] = matchedRows.map(({ parsed, student }) => ({
    student_id: student.id,
    trainingpeaks_athlete_id: parsed.trainingpeaksAthleteId,
    source_report_path: sourceReportPath,
    source_from: parsed.sourceFrom,
    source_to: parsed.sourceTo,
    generated_at: new Date().toISOString(),
    is_current: true,
    frequency_cap: parsed.frequencyCap,
    weekly_minutes_cap: parsed.weeklyMinutesCap,
    long_run_cap_min: parsed.longRunCapMin,
    quality_count_cap: parsed.qualityCountCap,
    interval_like_count: parsed.intervalLikeCount,
    confidence: parsed.confidence,
    needs_review: parsed.needsReview,
    context_flags: parsed.contextFlags,
    family_label_advisory: parsed.familyLabelAdvisory,
    raw_stats_jsonb: parsed.rawStats,
  }));

  if (payload.length > 0) {
    const { error: insertError } = await supabase
      .from("athlete_training_baselines")
      .insert(payload);
    if (insertError) {
      throw new Error(`${LOG_PREFIX} FAIL: unable to insert baseline rows: ${insertError.message}`);
    }
  }

  const confidenceCounts: Record<string, number> = {};
  const contextFlagCounts: Record<string, number> = {};
  const warnings: string[] = [];
  for (const row of parsedRows) {
    confidenceCounts[row.confidence] = (confidenceCounts[row.confidence] ?? 0) + 1;
    for (const contextFlag of row.contextFlags) {
      contextFlagCounts[contextFlag] = (contextFlagCounts[contextFlag] ?? 0) + 1;
    }
    for (const warning of row.warnings) {
      warnings.push(`${row.studentName}: ${warning}`);
    }
  }
  for (const row of missingRows) {
    warnings.push(`${row.studentName}: missing student match`);
  }
  for (const row of ambiguousRows) {
    warnings.push(`${row.studentName}: ambiguous student name match`);
  }

  printSummary({
    reportDir: reportDirRelative,
    sourceFrom: baselineSummary.input?.from ?? "unknown",
    sourceTo: baselineSummary.input?.to ?? "unknown",
    rowsParsed: parsedRows.length,
    rowsMatched: matchedRows.length,
    rowsMissingMatch: missingRows.length,
    rowsAmbiguousMatch: ambiguousRows.length,
    rowsInsertedOrUpdated: payload.length,
    currentBaselinesMarkedNonCurrent: uniqueStudentIds.length,
    confidenceCounts,
    contextFlagCounts,
    warnings,
    expectedAthletesAnalyzed,
  });
  console.log(`${LOG_PREFIX} mode=apply`);
}

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${LOG_PREFIX} FAIL`);
  console.error(message);
  process.exit(1);
});
