import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";
import { toolRoot } from "./lib/paths.ts";

type ImportAction = "import" | "manual_review" | "skip" | "blocked";
type Confidence = "low" | "medium" | "high";
type ApplyMode = "preview" | "apply";

type CliArgs = {
  reportDir: string;
  importDryRunDir: string;
  safeBatchReviewDir: string;
  allowlistFile: string;
  apply: boolean;
  confirm: string | null;
  sourceReportDir: string | null;
};

type SafeBatchAllowlistEntry = {
  athlete_id: number;
  student_id: string;
  name: string;
};

type SafeBatchReview = {
  source_report_dir: string;
  source_import_dry_run_dir: string;
  ultra_safe_batch: SafeBatchAllowlistEntry[];
};

type ImportActionRow = {
  student_name: string;
  student_id: string;
  athlete_id: number;
  action: ImportAction;
  reasons: string[];
  context_flags: string[];
  proposed_frequency_cap: number | null;
  proposed_weekly_minutes_cap: number | null;
  proposed_long_run_cap: number | null;
  proposed_quality_sessions_cap: number | null;
  proposed_confidence: Confidence;
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
  notes: string[];
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
  confidence: Confidence;
};

type CandidateStatus = "allowed_preview" | "blocked";

type CandidateResult = {
  athlete_id: number;
  student_id: string;
  student_name: string;
  status: CandidateStatus;
  reason: string;
  import_action: ImportAction | "missing";
  reasons: string[];
  current_is_manually_overridden: boolean;
};

type BeforeAfterPreviewRow = {
  athlete_id: number;
  student_id: string;
  student_name: string;
  current_frequency_cap: number | null;
  proposed_frequency_cap: number | null;
  current_weekly_minutes_cap: number | null;
  proposed_weekly_minutes_cap: number | null;
  current_long_run_cap_min: number | null;
  proposed_long_run_cap_min: number | null;
  current_quality_count_cap: number | null;
  proposed_quality_count_cap: number | null;
  current_confidence: Confidence | null;
  proposed_confidence: Confidence;
};

const APPLY_CONFIRM_TEXT = "APPLY BASELINE V2 ULTRA SAFE BATCH";
const DISALLOWED_REASON_SET = new Set([
  "high_delta_vs_current",
  "race_context_changed_baseline",
  "device_upload_issue",
  "injury_break_context",
  "completed_data_incomplete",
  "manual_override_protected",
  "self_profile_or_non_student_baseline_target",
  "melnikova_special_case",
  "krylova_special_case",
  "abramova_special_case",
]);

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

function printHelp(): void {
  console.log("Baseline v2 apply preview / guarded apply");
  console.log("");
  console.log("Usage:");
  console.log(
    "  npx tsx tools/trainingpeaks-export/scripts/tp-apply-athlete-training-baselines-v2.ts --report-dir <baseline-v2-dir> --import-dry-run-dir <import-dry-run-dir> --safe-batch-review-dir <safe-batch-dir> --allowlist-file <safe-batch-review.json>",
  );
  console.log("");
  console.log("Default mode:");
  console.log("  - preview only");
  console.log("  - no DB writes");
  console.log("");
  console.log("Apply mode requires all gates:");
  console.log("  --apply");
  console.log("  --allowlist-file <path>");
  console.log(`  --confirm "${APPLY_CONFIRM_TEXT}"`);
  console.log("  --source-report-dir <exact import-dry-run dir>");
  console.log("  BASELINE_V2_APPLY_ENABLED=true");
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    reportDir: "",
    importDryRunDir: "",
    safeBatchReviewDir: "",
    allowlistFile: "",
    apply: false,
    confirm: null,
    sourceReportDir: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg.startsWith("--report-dir=")) {
      parsed.reportDir = arg.slice("--report-dir=".length).trim();
      continue;
    }
    if (arg === "--report-dir") {
      parsed.reportDir = (argv[index + 1] ?? "").trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--import-dry-run-dir=")) {
      parsed.importDryRunDir = arg.slice("--import-dry-run-dir=".length).trim();
      continue;
    }
    if (arg === "--import-dry-run-dir") {
      parsed.importDryRunDir = (argv[index + 1] ?? "").trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--safe-batch-review-dir=")) {
      parsed.safeBatchReviewDir = arg.slice("--safe-batch-review-dir=".length).trim();
      continue;
    }
    if (arg === "--safe-batch-review-dir") {
      parsed.safeBatchReviewDir = (argv[index + 1] ?? "").trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--allowlist-file=")) {
      parsed.allowlistFile = arg.slice("--allowlist-file=".length).trim();
      continue;
    }
    if (arg === "--allowlist-file") {
      parsed.allowlistFile = (argv[index + 1] ?? "").trim();
      index += 1;
      continue;
    }
    if (arg === "--apply") {
      parsed.apply = true;
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
    if (arg.startsWith("--source-report-dir=")) {
      parsed.sourceReportDir = arg.slice("--source-report-dir=".length).trim();
      continue;
    }
    if (arg === "--source-report-dir") {
      parsed.sourceReportDir = (argv[index + 1] ?? "").trim();
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!parsed.reportDir) throw new Error("Missing --report-dir.");
  if (!parsed.importDryRunDir) throw new Error("Missing --import-dry-run-dir.");
  if (!parsed.safeBatchReviewDir) throw new Error("Missing --safe-batch-review-dir.");
  if (!parsed.allowlistFile) throw new Error("Missing --allowlist-file.");

  return parsed;
}

function normalizeRelativePath(input: string): string {
  return input.replace(/^\.?\/*/, "").replace(/\/+$/, "");
}

function assertAllowlistIsValid(
  allowlist: SafeBatchAllowlistEntry[],
  importActionsByStudentId: Map<string, ImportActionRow>,
): void {
  if (allowlist.length === 0) {
    throw new Error("allowlist_missing_or_empty");
  }

  for (const entry of allowlist) {
    if (!entry.student_id || !Number.isInteger(entry.athlete_id)) {
      throw new Error("allowlist_has_names_without_required_ids");
    }
    const actionRow = importActionsByStudentId.get(entry.student_id);
    if (!actionRow || actionRow.athlete_id !== entry.athlete_id) {
      throw new Error(`allowlist_identity_not_found_in_import_dry_run: ${entry.student_id}/${entry.athlete_id}`);
    }
    if (actionRow.action !== "import") {
      throw new Error(`allowlist_non_import_action_detected: ${entry.student_id}/${entry.athlete_id}/${actionRow.action}`);
    }
    if (actionRow.reasons.some((reason) => reason === "high_delta_vs_current")) {
      throw new Error(`allowlist_contains_high_delta: ${entry.student_id}/${entry.athlete_id}`);
    }
  }
}

async function fetchCurrentBaselinesReadOnly(): Promise<{
  available: boolean;
  manualOverrideProtectionFound: boolean;
  rowsByStudentId: Map<string, DbCurrentBaselineRow>;
}> {
  const rowsByStudentId = new Map<string, DbCurrentBaselineRow>();
  const supabase = createSupabaseServerClient();

  const query = await supabase
    .from("athlete_training_baselines")
    .select(
      "id, student_id, trainingpeaks_athlete_id, is_current, is_manually_overridden, frequency_cap, weekly_minutes_cap, long_run_cap_min, quality_count_cap, confidence",
    )
    .eq("is_current", true);

  if (query.error) {
    const message = query.error.message.toLowerCase();
    if (message.includes("is_manually_overridden")) {
      return { available: false, manualOverrideProtectionFound: false, rowsByStudentId };
    }
    throw new Error(`current_baseline_read_failed: ${query.error.message}`);
  }

  const rows = (query.data as DbCurrentBaselineRow[] | null) ?? [];
  for (const row of rows) {
    rowsByStudentId.set(row.student_id, row);
  }
  return { available: true, manualOverrideProtectionFound: true, rowsByStudentId };
}

async function applyOneAthlete(input: {
  currentRow: DbCurrentBaselineRow;
  perAthlete: PerAthleteBaselineRow;
  sourceReportDir: string;
  importDryRunDir: string;
}): Promise<void> {
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
    throw new Error(`apply_current_row_missing: ${input.perAthlete.student_id}`);
  }
  if (currentOverrideCheck.data.is_manually_overridden === true) {
    throw new Error(`manual_override_protected: ${input.perAthlete.student_id}`);
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
    student_id: input.perAthlete.student_id,
    trainingpeaks_athlete_id: String(input.perAthlete.athlete_id),
    source_report_path: input.sourceReportDir,
    source_from: input.perAthlete.analyzed_from,
    source_to: input.perAthlete.analyzed_to,
    is_current: true,
    frequency_cap: toIntOrNull(input.perAthlete.normal_baseline.frequency_cap),
    weekly_minutes_cap: toIntOrNull(input.perAthlete.normal_baseline.weekly_minutes_cap),
    long_run_cap_min: toIntOrNull(input.perAthlete.normal_baseline.long_run_cap_min),
    quality_count_cap: toIntOrNull(input.perAthlete.normal_baseline.quality_count_cap),
    interval_like_count: toIntOrNull(input.perAthlete.normal_baseline.interval_like_count),
    confidence: input.perAthlete.confidence,
    needs_review: input.perAthlete.needs_review,
    context_flags: input.perAthlete.context_flags,
    raw_stats_jsonb: {
      baseline_source: "completed_actual_running_v2",
      apply_metadata: {
        mode: "baseline_v2_guarded_apply",
        source_report_dir: input.sourceReportDir,
        source_import_dry_run_dir: input.importDryRunDir,
        applied_at: new Date().toISOString(),
      },
    },
  };

  const inserted = await supabase.from("athlete_training_baselines").insert(insertPayload);
  if (inserted.error) {
    throw new Error(`apply_insert_new_baseline_failed: ${inserted.error.message}`);
  }
}

async function main(): Promise<void> {
  loadLocalEnv();
  if (!process.env.SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_URL) {
    process.env.SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  }

  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(toolRoot, "..", "..");

  const sourceReportDirAbs = path.resolve(repoRoot, args.reportDir);
  const importDryRunDirAbs = path.resolve(repoRoot, args.importDryRunDir);
  const safeBatchReviewDirAbs = path.resolve(repoRoot, args.safeBatchReviewDir);
  const allowlistFileAbs = path.resolve(repoRoot, args.allowlistFile);

  const perAthletePath = path.join(sourceReportDirAbs, "per-athlete-baseline-v2.json");
  const importActionsPath = path.join(importDryRunDirAbs, "import-actions.json");

  const safeBatchReview = loadJson<SafeBatchReview>(allowlistFileAbs);
  const perAthleteRows = loadJson<PerAthleteBaselineRow[]>(perAthletePath);
  const importActions = loadJson<ImportActionRow[]>(importActionsPath);

  const importActionsByStudentId = new Map(importActions.map((row) => [row.student_id, row]));
  assertAllowlistIsValid(safeBatchReview.ultra_safe_batch, importActionsByStudentId);

  const sourceReportDirNormalized = normalizeRelativePath(args.reportDir);
  const importDryRunDirNormalized = normalizeRelativePath(args.importDryRunDir);
  if (normalizeRelativePath(safeBatchReview.source_report_dir) !== sourceReportDirNormalized) {
    throw new Error("source_report_path_mismatch");
  }
  if (normalizeRelativePath(safeBatchReview.source_import_dry_run_dir) !== importDryRunDirNormalized) {
    throw new Error("source_import_dry_run_path_mismatch");
  }
  if (!allowlistFileAbs.startsWith(safeBatchReviewDirAbs)) {
    throw new Error("allowlist_file_outside_safe_batch_review_dir");
  }

  const current = await fetchCurrentBaselinesReadOnly();
  if (!current.manualOverrideProtectionFound) {
    throw new Error("manual_override_protection_unverified");
  }
  if (!current.available) {
    throw new Error("current_baseline_read_unavailable");
  }

  const perAthleteByStudentId = new Map(perAthleteRows.map((row) => [row.student_id, row]));
  const candidateResults: CandidateResult[] = [];
  const beforeAfterPreview: BeforeAfterPreviewRow[] = [];
  const applyReady: Array<{
    allowlist: SafeBatchAllowlistEntry;
    perAthlete: PerAthleteBaselineRow;
    currentRow: DbCurrentBaselineRow;
  }> = [];

  for (const entry of safeBatchReview.ultra_safe_batch) {
    const importRow = importActionsByStudentId.get(entry.student_id);
    const perAthlete = perAthleteByStudentId.get(entry.student_id);
    const currentRow = current.rowsByStudentId.get(entry.student_id);

    if (!importRow || importRow.athlete_id !== entry.athlete_id) {
      candidateResults.push({
        athlete_id: entry.athlete_id,
        student_id: entry.student_id,
        student_name: entry.name,
        status: "blocked",
        reason: "missing_import_action_row",
        import_action: "missing",
        reasons: [],
        current_is_manually_overridden: false,
      });
      continue;
    }

    if (!perAthlete || perAthlete.athlete_id !== entry.athlete_id) {
      candidateResults.push({
        athlete_id: entry.athlete_id,
        student_id: entry.student_id,
        student_name: entry.name,
        status: "blocked",
        reason: "missing_source_baseline_row",
        import_action: importRow.action,
        reasons: importRow.reasons,
        current_is_manually_overridden: false,
      });
      continue;
    }

    if (!currentRow) {
      candidateResults.push({
        athlete_id: entry.athlete_id,
        student_id: entry.student_id,
        student_name: entry.name,
        status: "blocked",
        reason: "missing_current_baseline",
        import_action: importRow.action,
        reasons: importRow.reasons,
        current_is_manually_overridden: false,
      });
      continue;
    }

    if (currentRow.is_manually_overridden) {
      candidateResults.push({
        athlete_id: entry.athlete_id,
        student_id: entry.student_id,
        student_name: entry.name,
        status: "blocked",
        reason: "manual_override_protected",
        import_action: importRow.action,
        reasons: importRow.reasons,
        current_is_manually_overridden: true,
      });
      continue;
    }

    if (importRow.action !== "import") {
      candidateResults.push({
        athlete_id: entry.athlete_id,
        student_id: entry.student_id,
        student_name: entry.name,
        status: "blocked",
        reason: "not_import_action",
        import_action: importRow.action,
        reasons: importRow.reasons,
        current_is_manually_overridden: false,
      });
      continue;
    }

    const hasDisallowedReason = importRow.reasons.some((reason) => DISALLOWED_REASON_SET.has(reason));
    if (hasDisallowedReason) {
      candidateResults.push({
        athlete_id: entry.athlete_id,
        student_id: entry.student_id,
        student_name: entry.name,
        status: "blocked",
        reason: "disallowed_reason_present",
        import_action: importRow.action,
        reasons: importRow.reasons,
        current_is_manually_overridden: false,
      });
      continue;
    }

    candidateResults.push({
      athlete_id: entry.athlete_id,
      student_id: entry.student_id,
      student_name: entry.name,
      status: "allowed_preview",
      reason: "ultra_safe_allowlist_passed",
      import_action: importRow.action,
      reasons: importRow.reasons,
      current_is_manually_overridden: false,
    });

    beforeAfterPreview.push({
      athlete_id: entry.athlete_id,
      student_id: entry.student_id,
      student_name: entry.name,
      current_frequency_cap: currentRow.frequency_cap,
      proposed_frequency_cap: toIntOrNull(perAthlete.normal_baseline.frequency_cap),
      current_weekly_minutes_cap: currentRow.weekly_minutes_cap,
      proposed_weekly_minutes_cap: toIntOrNull(perAthlete.normal_baseline.weekly_minutes_cap),
      current_long_run_cap_min: currentRow.long_run_cap_min,
      proposed_long_run_cap_min: toIntOrNull(perAthlete.normal_baseline.long_run_cap_min),
      current_quality_count_cap: currentRow.quality_count_cap,
      proposed_quality_count_cap: toIntOrNull(perAthlete.normal_baseline.quality_count_cap),
      current_confidence: currentRow.confidence ?? null,
      proposed_confidence: perAthlete.confidence,
    });

    applyReady.push({ allowlist: entry, perAthlete, currentRow });
  }

  const mode: ApplyMode = args.apply ? "apply" : "preview";
  const missingApplyGates: string[] = [];
  if (args.apply) {
    if (process.env.BASELINE_V2_APPLY_ENABLED !== "true") missingApplyGates.push("BASELINE_V2_APPLY_ENABLED=true");
    if (args.confirm !== APPLY_CONFIRM_TEXT) missingApplyGates.push(`--confirm "${APPLY_CONFIRM_TEXT}"`);
    if (!args.sourceReportDir) missingApplyGates.push("--source-report-dir <exact import dry-run dir>");
    if (!args.allowlistFile) missingApplyGates.push("--allowlist-file <path>");
    if (normalizeRelativePath(args.sourceReportDir ?? "") !== importDryRunDirNormalized) {
      missingApplyGates.push("--source-report-dir must match --import-dry-run-dir exactly");
    }
  }

  if (args.apply && missingApplyGates.length > 0) {
    throw new Error(`apply_gates_failed_closed: ${missingApplyGates.join("; ")}`);
  }

  if (args.apply) {
    for (const row of applyReady) {
      await applyOneAthlete({
        currentRow: row.currentRow,
        perAthlete: row.perAthlete,
        sourceReportDir: args.reportDir,
        importDryRunDir: args.importDryRunDir,
      });
    }
  }

  const outputDir = path.join(
    repoRoot,
    "reports",
    "athlete-training-baseline-v2-apply-preview",
    timestampForPath(new Date()),
  );
  await mkdir(outputDir, { recursive: true });

  const allowedRows = candidateResults.filter((row) => row.status === "allowed_preview");
  const blockedRows = candidateResults.filter((row) => row.status === "blocked");

  const safetyChecks = {
    generated_at: new Date().toISOString(),
    mode,
    dry_run_only: !args.apply,
    no_db_writes_performed: !args.apply,
    source_report_dir: args.reportDir,
    import_dry_run_dir: args.importDryRunDir,
    safe_batch_review_dir: args.safeBatchReviewDir,
    allowlist_file: args.allowlistFile,
    allowlist_count: safeBatchReview.ultra_safe_batch.length,
    apply_preview_count: allowedRows.length,
    blocked_count: blockedRows.length,
    manual_override_protection_found: current.manualOverrideProtectionFound,
    allowlist_source_matches: true,
    disallowed_reasons_blocked: true,
    apply_gates_required: {
      apply_flag: true,
      allowlist_file: true,
      confirm_text: APPLY_CONFIRM_TEXT,
      source_report_dir: true,
      env_gate: "BASELINE_V2_APPLY_ENABLED=true",
    },
  };

  const summaryMarkdown = [
    "# APPLY PREVIEW",
    "",
    "**DRY RUN ONLY. NO DB WRITES PERFORMED.**",
    "",
    `- mode: ${mode}`,
    `- source_report_dir: ${args.reportDir}`,
    `- import_dry_run_dir: ${args.importDryRunDir}`,
    `- safe_batch_review_dir: ${args.safeBatchReviewDir}`,
    `- allowlist_file: ${args.allowlistFile}`,
    `- ultra_safe_allowlist_count: ${safeBatchReview.ultra_safe_batch.length}`,
    `- apply_preview_allowed_count: ${allowedRows.length}`,
    `- blocked_count: ${blockedRows.length}`,
    `- manual_override_protection_found: ${current.manualOverrideProtectionFound}`,
    "",
    "## Safety",
    "- Only ultra-safe allowlist athlete IDs/student IDs are considered.",
    "- manual_review/skip/blocked/high_delta and disallowed-reason athletes are fail-closed blocked.",
    "- Apply requires --apply + --allowlist-file + --confirm + --source-report-dir + BASELINE_V2_APPLY_ENABLED=true.",
  ].join("\n");

  await writeFile(path.join(outputDir, "APPLY-PREVIEW.md"), `${summaryMarkdown}\n`, "utf8");
  await writeFile(
    path.join(outputDir, "apply-preview.json"),
    `${JSON.stringify(
      {
        ...safetyChecks,
        allowed_athletes: allowedRows,
        blocked_athletes: blockedRows,
        before_after_preview: beforeAfterPreview,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(path.join(outputDir, "safety-checks.json"), `${JSON.stringify(safetyChecks, null, 2)}\n`, "utf8");

  const allowedCsvRows = [
    ["athlete_id", "student_id", "student_name", "status", "reason"],
    ...allowedRows.map((row) => [
      String(row.athlete_id),
      row.student_id,
      row.student_name,
      row.status,
      row.reason,
    ]),
  ];
  await writeFile(path.join(outputDir, "allowed-athletes.csv"), listToCsv(allowedCsvRows), "utf8");

  const blockedCsvRows = [
    ["athlete_id", "student_id", "student_name", "status", "reason", "import_action", "reasons"],
    ...blockedRows.map((row) => [
      String(row.athlete_id),
      row.student_id,
      row.student_name,
      row.status,
      row.reason,
      row.import_action,
      row.reasons.join("|"),
    ]),
  ];
  await writeFile(path.join(outputDir, "blocked-athletes.csv"), listToCsv(blockedCsvRows), "utf8");

  const beforeAfterCsvRows = [
    [
      "athlete_id",
      "student_id",
      "student_name",
      "current_frequency_cap",
      "proposed_frequency_cap",
      "current_weekly_minutes_cap",
      "proposed_weekly_minutes_cap",
      "current_long_run_cap_min",
      "proposed_long_run_cap_min",
      "current_quality_count_cap",
      "proposed_quality_count_cap",
      "current_confidence",
      "proposed_confidence",
    ],
    ...beforeAfterPreview.map((row) => [
      String(row.athlete_id),
      row.student_id,
      row.student_name,
      String(row.current_frequency_cap ?? ""),
      String(row.proposed_frequency_cap ?? ""),
      String(row.current_weekly_minutes_cap ?? ""),
      String(row.proposed_weekly_minutes_cap ?? ""),
      String(row.current_long_run_cap_min ?? ""),
      String(row.proposed_long_run_cap_min ?? ""),
      String(row.current_quality_count_cap ?? ""),
      String(row.proposed_quality_count_cap ?? ""),
      row.current_confidence ?? "",
      row.proposed_confidence,
    ]),
  ];
  await writeFile(path.join(outputDir, "before-after-preview.csv"), listToCsv(beforeAfterCsvRows), "utf8");

  console.log("[tp-apply-athlete-training-baselines-v2] mode=preview");
  console.log("[tp-apply-athlete-training-baselines-v2] DRY RUN ONLY. NO DB WRITES PERFORMED.");
  console.log(`output_dir: ${outputDir}`);
  console.log(`ultra_safe_allowlist_count: ${safeBatchReview.ultra_safe_batch.length}`);
  console.log(`apply_preview_allowed_count: ${allowedRows.length}`);
  console.log(`blocked_count: ${blockedRows.length}`);
}

main().catch((error: unknown) => {
  console.error("tp-apply-athlete-training-baselines-v2 failed.");
  console.error(error);
  process.exit(1);
});
