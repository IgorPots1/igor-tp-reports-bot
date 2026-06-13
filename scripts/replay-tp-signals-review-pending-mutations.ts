import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  classifyPendingReviewMutations,
  TP_SIGNAL_REVIEW_PENDING_MUTATIONS_CONFIRM,
  type PendingMutationCandidate,
} from "@/features/trainingpeaks/tp-signals-review-pending-mutations";
import {
  dismissOperationalSignalByReviewQueue,
  listLatestTrainingPeaksOperationalSignalReviewDecisionsBySignalIds,
  listTrainingPeaksOperationalSignals,
  listTrainingPeaksStudents,
  markOperationalSignalResolvedByReviewQueue,
  type TrainingPeaksOperationalSignalReviewQueueMutationResult,
  type TrainingPeaksStudentOperationalSignal,
} from "@/features/trainingpeaks/repository";

const LOG_PREFIX = "[replay:tp-signals-review-pending-mutations]";
const REPORT_ROOT = "reports/tp-signals-review-pending-mutations";

type CliOptions = {
  asOfDate: string;
  signalId: string | null;
  apply: boolean;
  confirm: string | null;
  noWrite: boolean;
};

function loadLocalEnvFiles(): void {
  const repoRoot = path.resolve(process.cwd());
  for (const envPath of [path.join(repoRoot, ".env.local"), path.join(repoRoot, ".env")]) {
    if (!fs.existsSync(envPath)) continue;
    for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const i = line.indexOf("=");
      if (i <= 0) continue;
      const key = line.slice(0, i).trim();
      if (!key || process.env[key] !== undefined) continue;
      let v = line.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[key] = v;
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
    if (arg === "--dry-run") continue;
    if (arg === "--no-write") {
      options.noWrite = true;
      continue;
    }
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg.startsWith("--date=")) {
      options.asOfDate = parseIsoDate(arg.slice("--date=".length));
      continue;
    }
    if (arg === "--date") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error(`${LOG_PREFIX} FAIL: missing value for --date`);
      options.asOfDate = parseIsoDate(next);
      index += 1;
      continue;
    }
    if (arg.startsWith("--signal-id=")) {
      options.signalId = arg.slice("--signal-id=".length).trim() || null;
      continue;
    }
    if (arg === "--signal-id") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error(`${LOG_PREFIX} FAIL: missing value for --signal-id`);
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
      if (next === undefined) throw new Error(`${LOG_PREFIX} FAIL: missing value for --confirm`);
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

function validateApplyPrerequisites(options: CliOptions): void {
  if (!options.apply) return;
  if (options.confirm !== TP_SIGNAL_REVIEW_PENDING_MUTATIONS_CONFIRM) {
    throw new Error(`${LOG_PREFIX} FAIL: --apply requires --confirm "${TP_SIGNAL_REVIEW_PENDING_MUTATIONS_CONFIRM}"`);
  }
}

async function fetchAllActiveSignals(limit = 2000): Promise<TrainingPeaksStudentOperationalSignal[]> {
  const items: TrainingPeaksStudentOperationalSignal[] = [];
  const pageSize = 200;
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  while (items.length < limit && offset < total) {
    const page = await listTrainingPeaksOperationalSignals({ status: "active", limit: pageSize, offset });
    total = page.total;
    if (page.items.length === 0) break;
    items.push(...page.items);
    offset += page.items.length;
  }
  return items.slice(0, limit);
}

async function applyOne(input: {
  candidate: PendingMutationCandidate;
  signal: TrainingPeaksStudentOperationalSignal;
  asOfDate: string;
}): Promise<TrainingPeaksOperationalSignalReviewQueueMutationResult> {
  const { candidate, signal } = input;
  const reason = `pending_mutation_replay:${candidate.decision}`;
  if (candidate.decision === "close_signal") {
    return markOperationalSignalResolvedByReviewQueue({
      signal,
      reviewDecisionId: candidate.decisionId,
      reviewDecision: "close_signal",
      reason,
      asOfDate: input.asOfDate,
    });
  }
  // hide_from_queue
  return dismissOperationalSignalByReviewQueue({
    signal,
    reviewDecisionId: candidate.decisionId,
    reviewDecision: "hide_from_queue",
    reason,
  });
}

function formatReportMarkdown(input: {
  generatedAt: string;
  asOfDate: string;
  mode: "dry-run" | "apply";
  signalId: string | null;
  reportDir: string;
  candidates: PendingMutationCandidate[];
  applied: Array<{ signalId: string; updated: boolean; previousStatus: string | null; newStatus: string | null; reason?: string }>;
}): string {
  const eligible = input.candidates.filter((c) => c.eligible);
  const lines = [
    "# TP Signals — Pending Review-Queue Mutation Replay",
    "",
    `- generated_at: ${input.generatedAt}`,
    `- as_of_date: ${input.asOfDate}`,
    `- mode: ${input.mode}`,
    `- signal_id_filter: ${input.signalId ?? "(none)"}`,
    `- report_dir: ${input.reportDir}`,
    "",
    "## Counts",
    `- eligible_pending: ${eligible.length}`,
    `- applied_attempted: ${input.applied.length}`,
    `- applied_updated: ${input.applied.filter((a) => a.updated).length}`,
    "",
    "## Eligible",
    "",
    "| Student | Signal | Decision | Proposed status | Reason |",
    "|---|---|---|---|---|",
    ...eligible.map((c) => `| ${c.studentName} | ${c.signalId} | ${c.decision} | ${c.proposedStatus} | ${c.reason} |`),
    "",
    "## Apply results",
    "",
    input.applied.length === 0
      ? "_Dry-run: no DB writes._"
      : ["| Signal | Updated | Previous | New | Reason |", "|---|---|---|---|---|", ...input.applied.map((a) => `| ${a.signalId} | ${a.updated} | ${a.previousStatus ?? "null"} | ${a.newStatus ?? "null"} | ${a.reason ?? "updated"} |`)].join("\n"),
    "",
    "## Safety",
    "- No deletes. Status updates guarded `.eq(\"status\",\"active\")` via review-queue repo functions.",
    "- Apply requires exact confirm string.",
    "- Audit metadata merged (review_queue_*, reason=pending_mutation_replay:<decision>).",
    "",
  ];
  return `${lines.join("\n")}\n`;
}

async function run(): Promise<void> {
  loadLocalEnvFiles();
  const options = parseCliOptions(process.argv.slice(2));
  validateApplyPrerequisites(options);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(`${LOG_PREFIX} FAIL: missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY`);
  }
  if (!process.env.SUPABASE_URL) process.env.SUPABASE_URL = supabaseUrl;

  const [students, activeSignals] = await Promise.all([listTrainingPeaksStudents(), fetchAllActiveSignals()]);
  const studentNameById = new Map(
    students.map((s) => [s.id, s.studentName?.trim() || `Unknown (${s.id.slice(0, 8)})`])
  );

  let scopedSignals = activeSignals;
  if (options.signalId) {
    scopedSignals = activeSignals.filter((s) => s.id === options.signalId);
  }

  const latestDecisionBySignalId = await listLatestTrainingPeaksOperationalSignalReviewDecisionsBySignalIds(
    scopedSignals.map((s) => s.id)
  );
  const { candidates, eligible } = classifyPendingReviewMutations({
    signals: scopedSignals,
    latestDecisionBySignalId,
    studentNameById,
  });

  // Targeted mode safety: exactly one eligible signal required to apply.
  if (options.signalId && options.apply && eligible.length !== 1) {
    throw new Error(
      `${LOG_PREFIX} FAIL: targeted --signal-id apply requires exactly one eligible signal; found ${eligible.length}`
    );
  }

  const signalById = new Map(scopedSignals.map((s) => [s.id, s]));
  const applied: Array<{ signalId: string; updated: boolean; previousStatus: string | null; newStatus: string | null; reason?: string }> = [];

  if (options.apply) {
    for (const candidate of eligible) {
      const signal = signalById.get(candidate.signalId);
      if (!signal || signal.status !== "active") {
        applied.push({ signalId: candidate.signalId, updated: false, previousStatus: signal?.status ?? null, newStatus: signal?.status ?? null, reason: "not_active" });
        continue;
      }
      const result = await applyOne({ candidate, signal, asOfDate: options.asOfDate });
      applied.push({
        signalId: candidate.signalId,
        updated: result.updated,
        previousStatus: result.previousStatus,
        newStatus: result.newStatus,
        reason: result.reason,
      });
    }
  }

  const mode = options.apply ? "apply" : "dry-run";
  const timestamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const reportDir = path.join(REPORT_ROOT, `${timestamp}-${mode}`);
  const generatedAt = new Date().toISOString();

  if (!options.noWrite) {
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(path.join(reportDir, "candidates.json"), `${JSON.stringify(candidates, null, 2)}\n`);
    fs.writeFileSync(path.join(reportDir, "applied.json"), `${JSON.stringify(applied, null, 2)}\n`);
    fs.writeFileSync(
      path.join(reportDir, "README.md"),
      formatReportMarkdown({ generatedAt, asOfDate: options.asOfDate, mode, signalId: options.signalId, reportDir, candidates, applied })
    );
  }

  console.log(`${LOG_PREFIX} mode=${mode} as_of=${options.asOfDate} scoped_signals=${scopedSignals.length} eligible=${eligible.length}`);
  console.log(`${LOG_PREFIX} applied_attempted=${applied.length} applied_updated=${applied.filter((a) => a.updated).length} no_write=${String(options.noWrite)}`);
  if (!options.noWrite) console.log(`${LOG_PREFIX} report_dir=${reportDir}`);
  for (const c of eligible) {
    console.log(`- ${c.studentName}: ${c.signalType} decision=${c.decision} → ${c.proposedStatus}${options.apply ? "" : " (dry-run)"}`);
  }
  if (!options.apply) {
    console.log("");
    console.log("No DB writes made (dry-run).");
    console.log(`To apply: rerun with --apply --confirm "${TP_SIGNAL_REVIEW_PENDING_MUTATIONS_CONFIRM}".`);
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
