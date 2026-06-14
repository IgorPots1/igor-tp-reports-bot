import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  buildNonRunConstraintCleanupMetadata,
  classifyNonRunConstraintCleanupEligibility,
  formatNonRunConstraintCleanupReportMarkdown,
  TP_SIGNALS_NONRUN_CONSTRAINT_CLEANUP_CONFIRM,
  type NonRunConstraintCleanupCandidate,
} from "@/features/trainingpeaks/tp-signals-nonrun-constraint-cleanup";
import {
  listTrainingPeaksOperationalSignals,
  listTrainingPeaksStudents,
  type TrainingPeaksStudentOperationalSignal,
} from "@/features/trainingpeaks/repository";
import { createSupabaseServerClient } from "@/features/supabase/server";

const LOG_PREFIX = "[cleanup:tp-signals-nonrun-constraints]";
const REPORT_ROOT = "reports/tp-signals-nonrun-constraint-cleanup";

type CliOptions = {
  asOfDate: string;
  signalId: string | null;
  apply: boolean;
  confirm: string | null;
  noWrite: boolean;
};

type ObservationRow = {
  id: string;
  text_preview: string | null;
};

function loadLocalEnvFiles(): void {
  const repoRoot = path.resolve(process.cwd());
  for (const envPath of [path.join(repoRoot, ".env.local"), path.join(repoRoot, ".env")]) {
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
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

function parseIsoDate(raw: string): string {
  const normalized = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) {
    throw new Error(`${LOG_PREFIX} FAIL: invalid date: ${raw}`);
  }
  return normalized;
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    asOfDate: new Date().toISOString().slice(0, 10),
    signalId: null,
    apply: false,
    confirm: null,
    noWrite: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--dry-run") {
      continue;
    }
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--no-write") {
      options.noWrite = true;
      continue;
    }
    if (arg.startsWith("--date=")) {
      options.asOfDate = parseIsoDate(arg.slice("--date=".length));
      continue;
    }
    if (arg === "--date") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --date`);
      }
      options.asOfDate = parseIsoDate(next);
      index += 1;
      continue;
    }
    if (arg.startsWith("--signal-id=")) {
      options.signalId = arg.slice("--signal-id=".length).trim();
      continue;
    }
    if (arg === "--signal-id") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --signal-id`);
      }
      options.signalId = next.trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--confirm=")) {
      options.confirm = arg.slice("--confirm=".length);
      continue;
    }
    if (arg === "--confirm") {
      const next = argv[index + 1];
      if (next === undefined || next.trim().startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --confirm`);
      }
      options.confirm = next;
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`${LOG_PREFIX} FAIL: unknown argument: ${arg}`);
    }
  }
  return options;
}

function validateApplyPrerequisites(options: CliOptions): string | null {
  if (!options.apply) {
    return null;
  }
  if (!options.confirm || options.confirm !== TP_SIGNALS_NONRUN_CONSTRAINT_CLEANUP_CONFIRM) {
    return `--apply requires --confirm "${TP_SIGNALS_NONRUN_CONSTRAINT_CLEANUP_CONFIRM}"`;
  }
  return null;
}

async function fetchAllActivePlanConstraintSignals(
  limit = 1200
): Promise<TrainingPeaksStudentOperationalSignal[]> {
  const items: TrainingPeaksStudentOperationalSignal[] = [];
  const pageSize = 200;
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  while (items.length < limit && offset < total) {
    const page = await listTrainingPeaksOperationalSignals({
      status: "active",
      signalType: "plan_generation_constraint",
      limit: pageSize,
      offset,
    });
    total = page.total;
    if (page.items.length === 0) {
      break;
    }
    items.push(...page.items);
    offset += page.items.length;
  }
  return items.slice(0, limit);
}

async function fetchObservationRowsByIds(
  observationIds: readonly string[]
): Promise<Map<string, ObservationRow>> {
  if (observationIds.length === 0) {
    return new Map();
  }
  const supabase = createSupabaseServerClient();
  const out = new Map<string, ObservationRow>();
  for (let index = 0; index < observationIds.length; index += 200) {
    const chunk = observationIds.slice(index, index + 200);
    const { data, error } = await supabase
      .from("trainingpeaks_telegram_context_observations")
      .select("id, text_preview")
      .in("id", chunk);
    if (error) {
      throw new Error(`${LOG_PREFIX} FAIL: failed to read observations: ${error.message}`);
    }
    const rows = (data as ObservationRow[] | null) ?? [];
    for (const row of rows) {
      out.set(row.id, row);
    }
  }
  return out;
}

async function applyEligibleCleanup(input: {
  candidates: NonRunConstraintCleanupCandidate[];
  signalsById: Map<string, TrainingPeaksStudentOperationalSignal>;
}): Promise<number> {
  const supabase = createSupabaseServerClient();
  let written = 0;
  const eligible = input.candidates.filter((item) => item.eligibility === "eligible");

  for (const candidate of eligible) {
    const signal = input.signalsById.get(candidate.signal_id);
    if (!signal || signal.status !== "active") {
      throw new Error(`${LOG_PREFIX} FAIL: signal ${candidate.signal_id} is no longer active`);
    }

    const metadata = buildNonRunConstraintCleanupMetadata({
      existing: signal.metadata,
      candidate,
      previousStatus: signal.status,
    });
    const write = await supabase
      .from("trainingpeaks_student_operational_signals")
      .update({
        status: "dismissed",
        metadata,
        updated_at: new Date().toISOString(),
      })
      .eq("id", candidate.signal_id)
      .eq("status", "active")
      .select("id")
      .maybeSingle();

    if (write.error) {
      throw new Error(`${LOG_PREFIX} FAIL: failed to update signal ${candidate.signal_id}: ${write.error.message}`);
    }
    if (!write.data) {
      throw new Error(`${LOG_PREFIX} FAIL: no row updated for signal ${candidate.signal_id}`);
    }
    written += 1;
  }

  return written;
}

async function run(): Promise<void> {
  loadLocalEnvFiles();
  const options = parseCliOptions(process.argv.slice(2));
  const preApplyValidationError = validateApplyPrerequisites(options);
  if (preApplyValidationError) {
    throw new Error(`${LOG_PREFIX} FAIL: ${preApplyValidationError}`);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(`${LOG_PREFIX} FAIL: missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY`);
  }
  if (!process.env.SUPABASE_URL) {
    process.env.SUPABASE_URL = supabaseUrl;
  }

  const [students, activePlanConstraints] = await Promise.all([
    listTrainingPeaksStudents(),
    fetchAllActivePlanConstraintSignals(),
  ]);
  const studentNameById = new Map(
    students.map((student) => [student.id, student.studentName?.trim() || `Unknown (${student.id.slice(0, 8)})`])
  );

  let signals = activePlanConstraints.filter((signal) => signal.lifecycleState !== "resolved");
  if (options.signalId) {
    signals = signals.filter((signal) => signal.id === options.signalId);
    if (signals.length === 0) {
      throw new Error(`${LOG_PREFIX} FAIL: no active plan_generation_constraint found for signal_id=${options.signalId}`);
    }
  }

  const observationIds = [
    ...new Set(
      signals
        .map((signal) => signal.sourceObservationId)
        .filter((value): value is string => Boolean(value))
    ),
  ];
  const observationById = await fetchObservationRowsByIds(observationIds);

  const candidates = signals.map((signal) => {
    const observation = signal.sourceObservationId
      ? observationById.get(signal.sourceObservationId) ?? null
      : null;
    return classifyNonRunConstraintCleanupEligibility({
      signal,
      studentName: studentNameById.get(signal.studentId) ?? `Unknown (${signal.studentId.slice(0, 8)})`,
      sourceSnippet: observation?.text_preview ?? null,
      asOfDate: options.asOfDate,
    });
  });

  const wouldWriteCount = candidates.filter((item) => item.eligibility === "eligible").length;
  const mode = options.apply ? "apply" : "dry-run";
  let actualWrittenCount = 0;

  if (options.apply) {
    const signalsById = new Map(signals.map((signal) => [signal.id, signal]));
    actualWrittenCount = await applyEligibleCleanup({
      candidates,
      signalsById,
    });
  }

  const generatedAt = new Date().toISOString();
  const timestamp = generatedAt.replace(/[:.]/gu, "-");
  const reportDir = path.join(REPORT_ROOT, timestamp);
  const summaryMarkdown = formatNonRunConstraintCleanupReportMarkdown({
    generatedAt,
    asOfDate: options.asOfDate,
    signalId: options.signalId,
    mode,
    candidates,
    scannedCount: signals.length,
    wouldWriteCount,
    actualWrittenCount,
    reportDir,
  });

  if (!options.noWrite) {
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(path.join(reportDir, "README.md"), summaryMarkdown);
    fs.writeFileSync(path.join(reportDir, "candidates.json"), `${JSON.stringify(candidates, null, 2)}\n`);
  }

  console.log(`${LOG_PREFIX} mode=${mode} as_of=${options.asOfDate} scanned=${signals.length}`);
  console.log(`${LOG_PREFIX} eligible=${candidates.filter((item) => item.eligibility === "eligible").length}`);
  console.log(`${LOG_PREFIX} not_safe=${candidates.filter((item) => item.eligibility === "not_safe").length}`);
  console.log(`${LOG_PREFIX} not_eligible=${candidates.filter((item) => item.eligibility === "not_eligible").length}`);
  console.log(`${LOG_PREFIX} would_write=${wouldWriteCount} actual_written=${actualWrittenCount}`);
  if (!options.noWrite) {
    console.log(`${LOG_PREFIX} report_dir=${reportDir}`);
  } else {
    console.log(`${LOG_PREFIX} report_dir=(skipped --no-write)`);
  }

  for (const candidate of candidates) {
    if (
      candidate.eligibility === "eligible" ||
      candidate.eligibility === "not_safe" ||
      options.signalId
    ) {
      console.log(
        `- ${candidate.student}: ${candidate.signal_id.slice(0, 8)} eligibility=${candidate.eligibility} classification=${candidate.classification ?? "(none)"} action=${candidate.proposed_action}`
      );
      if (candidate.source_preview) {
        console.log(`  - source: ${candidate.source_preview.slice(0, 160)}`);
      }
    }
  }

  if (!options.apply) {
    console.log("");
    console.log("No DB writes made (dry-run).");
    console.log(`To apply, rerun with --apply --confirm "${TP_SIGNALS_NONRUN_CONSTRAINT_CLEANUP_CONFIRM}".`);
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
