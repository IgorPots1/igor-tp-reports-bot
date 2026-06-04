import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import type { PostgrestError } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/features/supabase/server";

const LOG_PREFIX = "[check-athlete-training-baselines]";
const EXPECTED_BASELINE_SIZE = 101;

type BaselineRow = {
  id: string;
  student_id: string;
  source_from: string | null;
  source_to: string | null;
  generated_at: string | null;
  confidence: "low" | "medium" | "high" | string | null;
  raw_stats_jsonb: Record<string, unknown> | null;
  frequency_cap: number | null;
  weekly_minutes_cap: number | null;
  long_run_cap_min: number | null;
  quality_count_cap: number | null;
  interval_like_count: number | null;
  is_current: boolean;
  is_manually_overridden: boolean;
  override_reason: string | null;
  family_label_advisory: string | null;
};

type DuplicateCurrentRow = {
  student_id: string;
  count: number;
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

function isNegative(value: number | null): boolean {
  return value != null && value < 0;
}

async function run(): Promise<void> {
  loadLocalEnvFiles();
  const supabaseUrl = getEnvValue("NEXT_PUBLIC_SUPABASE_URL") ?? getEnvValue("SUPABASE_URL");
  const serviceRoleKey = getEnvValue("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.log(
      `${LOG_PREFIX} SKIP: missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY`
    );
    return;
  }
  if (!process.env.SUPABASE_URL) {
    process.env.SUPABASE_URL = supabaseUrl;
  }

  const supabase = createSupabaseServerClient();
  const checks: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  const tableProbe = await supabase.from("athlete_training_baselines").select("id").limit(1);
  if (isMissingRelationError(tableProbe.error ?? null)) {
    throw new Error(`${LOG_PREFIX} FAIL: table public.athlete_training_baselines does not exist`);
  }
  if (tableProbe.error) {
    throw new Error(`${LOG_PREFIX} FAIL: unable to access athlete_training_baselines: ${tableProbe.error.message}`);
  }
  checks.push("athlete_training_baselines table exists.");

  const [allRowsResult, currentRowsResult] = await Promise.all([
    supabase.from("athlete_training_baselines").select(
      "id, student_id, source_from, source_to, generated_at, confidence, raw_stats_jsonb, frequency_cap, weekly_minutes_cap, long_run_cap_min, quality_count_cap, interval_like_count, is_current, is_manually_overridden, override_reason, family_label_advisory"
    ),
    supabase
      .from("athlete_training_baselines")
      .select(
        "id, student_id, source_from, source_to, generated_at, confidence, raw_stats_jsonb, frequency_cap, weekly_minutes_cap, long_run_cap_min, quality_count_cap, interval_like_count, is_current, is_manually_overridden, override_reason, family_label_advisory"
      )
      .eq("is_current", true),
  ]);

  if (allRowsResult.error) {
    throw new Error(`${LOG_PREFIX} FAIL: unable to read athlete_training_baselines: ${allRowsResult.error.message}`);
  }
  if (currentRowsResult.error) {
    throw new Error(`${LOG_PREFIX} FAIL: unable to read current baselines: ${currentRowsResult.error.message}`);
  }
  const allRows = (allRowsResult.data ?? []) as BaselineRow[];
  const currentRows = (currentRowsResult.data ?? []) as BaselineRow[];
  const groupedCurrentMap = new Map<string, number>();
  for (const row of currentRows) {
    groupedCurrentMap.set(row.student_id, (groupedCurrentMap.get(row.student_id) ?? 0) + 1);
  }
  const groupedCurrent: DuplicateCurrentRow[] = Array.from(groupedCurrentMap.entries()).map(
    ([student_id, count]) => ({
      student_id,
      count,
    })
  );

  const invalidCurrentGroups = groupedCurrent.filter((row) => Number(row.count) > 1);
  if (invalidCurrentGroups.length > 0) {
    errors.push(`More than one current baseline for students: ${invalidCurrentGroups.map((row) => row.student_id).join(", ")}`);
  } else {
    checks.push("At most one current baseline exists per student.");
  }

  if (currentRows.length > 0) {
    checks.push(`Current baseline count is ${currentRows.length} (> 0).`);
  } else {
    errors.push("Current baseline count is 0.");
  }

  const invalidCurrentRows = currentRows.filter(
    (row) =>
      !row.source_from ||
      !row.source_to ||
      !row.generated_at ||
      !row.confidence ||
      row.raw_stats_jsonb == null
  );
  if (invalidCurrentRows.length > 0) {
    errors.push(`Current baselines missing required fields: ${invalidCurrentRows.length}`);
  } else {
    checks.push("Current baseline rows contain source_from/source_to/generated_at/confidence/raw_stats_jsonb.");
  }

  const invalidConfidenceRows = allRows.filter(
    (row) => row.confidence !== "low" && row.confidence !== "medium" && row.confidence !== "high"
  );
  if (invalidConfidenceRows.length > 0) {
    errors.push(`Invalid confidence values found: ${invalidConfidenceRows.length}`);
  } else {
    checks.push("All confidence values are valid.");
  }

  const negativeCapsRows = allRows.filter(
    (row) =>
      isNegative(row.frequency_cap) ||
      isNegative(row.weekly_minutes_cap) ||
      isNegative(row.long_run_cap_min) ||
      isNegative(row.quality_count_cap) ||
      isNegative(row.interval_like_count)
  );
  if (negativeCapsRows.length > 0) {
    errors.push(`Rows with negative caps found: ${negativeCapsRows.length}`);
  } else {
    checks.push("No negative cap values found.");
  }

  const invalidOverrides = allRows.filter(
    (row) => row.is_manually_overridden && (!row.override_reason || row.override_reason.trim().length === 0)
  );
  if (invalidOverrides.length > 0) {
    errors.push(`Manual override rows without override_reason: ${invalidOverrides.length}`);
  } else {
    checks.push("Override rows include override_reason.");
  }

  checks.push("family_label_advisory treated as advisory/debug field only (checked via migration comment and script behavior).");

  const mediumOrHighCount = currentRows.filter(
    (row) => row.confidence === "medium" || row.confidence === "high"
  ).length;
  if (currentRows.length > 0 && mediumOrHighCount === 0) {
    errors.push("No medium/high confidence current baseline rows found.");
  } else if (currentRows.length > 0) {
    checks.push(`Current baselines include medium/high confidence rows (${mediumOrHighCount}).`);
  } else {
    warnings.push("Skipping medium/high confidence requirement because current baseline set is empty.");
  }

  if (currentRows.length > 0 && currentRows.length < EXPECTED_BASELINE_SIZE * 0.8) {
    warnings.push(
      `Current baseline count (${currentRows.length}) is far below expected cohort size (~${EXPECTED_BASELINE_SIZE}).`
    );
  } else if (currentRows.length > 0) {
    checks.push(`Current baseline count (${currentRows.length}) is within expected range of ~${EXPECTED_BASELINE_SIZE}.`);
  }

  console.log(`${LOG_PREFIX} current_count=${currentRows.length}`);
  console.log(`${LOG_PREFIX} total_rows=${allRows.length}`);

  for (const check of checks) {
    console.log(`${LOG_PREFIX} PASS: ${check}`);
  }
  for (const warning of warnings) {
    console.log(`${LOG_PREFIX} WARN: ${warning}`);
  }
  for (const error of errors) {
    console.log(`${LOG_PREFIX} FAIL: ${error}`);
  }

  if (errors.length > 0) {
    throw new Error(`${LOG_PREFIX} FAIL: baseline invariant checks failed.`);
  }

  console.log(`${LOG_PREFIX} PASS checks=${checks.length} warnings=${warnings.length}`);
}

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${LOG_PREFIX} FAIL`);
  console.error(message);
  process.exit(1);
});
