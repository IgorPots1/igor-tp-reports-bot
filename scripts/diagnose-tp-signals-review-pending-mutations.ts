import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  classifyPendingReviewMutations,
  type PendingMutationCandidate,
} from "@/features/trainingpeaks/tp-signals-review-pending-mutations";
import {
  listLatestTrainingPeaksOperationalSignalReviewDecisionsBySignalIds,
  listTrainingPeaksOperationalSignals,
  listTrainingPeaksStudents,
  type TrainingPeaksStudentOperationalSignal,
} from "@/features/trainingpeaks/repository";

const LOG_PREFIX = "[diagnose:tp-signals-review-pending-mutations]";
const REPORT_ROOT = "reports/tp-signals-review-pending-mutations";

type CliOptions = {
  asOfDate: string;
  noWrite: boolean;
};

function loadLocalEnvFiles(): void {
  const repoRoot = path.resolve(process.cwd());
  for (const envPath of [path.join(repoRoot, ".env.local"), path.join(repoRoot, ".env")]) {
    if (!fs.existsSync(envPath)) {
      continue;
    }
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
    noWrite: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
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
      if (!next || next.startsWith("--")) throw new Error(`${LOG_PREFIX} FAIL: missing value for --date`);
      options.asOfDate = parseIsoDate(next);
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`${LOG_PREFIX} FAIL: unknown argument: ${arg}`);
    }
  }
  return options;
}

export async function fetchAllActiveSignals(limit = 2000): Promise<TrainingPeaksStudentOperationalSignal[]> {
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

function formatReportMarkdown(input: {
  generatedAt: string;
  asOfDate: string;
  reportDir: string;
  candidates: PendingMutationCandidate[];
}): string {
  const eligible = input.candidates.filter((c) => c.eligible);
  const skipped = input.candidates.filter((c) => !c.eligible);
  const byDecision = eligible.reduce<Record<string, number>>((acc, c) => {
    acc[c.decision] = (acc[c.decision] ?? 0) + 1;
    return acc;
  }, {});
  const byCategory = eligible.reduce<Record<string, number>>((acc, c) => {
    acc[c.category] = (acc[c.category] ?? 0) + 1;
    return acc;
  }, {});
  const byProposed = eligible.reduce<Record<string, number>>((acc, c) => {
    const key = c.proposedStatus ?? "none";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const lines = [
    "# TP Signals — Pending Review-Queue Mutations",
    "",
    `- generated_at: ${input.generatedAt}`,
    `- as_of_date: ${input.asOfDate}`,
    `- report_dir: ${input.reportDir}`,
    "",
    "Pending = a `close_signal`/`hide_from_queue` review decision was recorded (telegram/manual)",
    "but the operational signal is still `active` with no applied review-queue mutation metadata",
    "(typically because mutations were disabled when the coach clicked).",
    "",
    "## Counts",
    "",
    `- total_signals_with_decision: ${input.candidates.length}`,
    `- eligible_pending: ${eligible.length}`,
    `- skipped: ${skipped.length}`,
    "",
    "### Eligible by decision",
    ...Object.entries(byDecision).map(([k, v]) => `- ${k}: ${v}`),
    "",
    "### Eligible by category",
    ...Object.entries(byCategory).map(([k, v]) => `- ${k}: ${v}`),
    "",
    "### Eligible by proposed status",
    ...Object.entries(byProposed).map(([k, v]) => `- ${k}: ${v}`),
    "",
    "## Eligible pending mutations",
    "",
    "| Student | Signal | Type/Category | Decision | Decided at | Current status | Current lifecycle | Proposed status | Proposed lifecycle | Reason |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...eligible.map(
      (c) =>
        `| ${c.studentName} | ${c.signalId} | ${c.signalType}/${c.category} | ${c.decision} | ${c.decisionCreatedAt} | ${c.currentStatus} | ${c.currentLifecycleState ?? "null"} | ${c.proposedStatus} | ${c.proposedLifecycleState ?? "null"} | ${c.reason} |`
    ),
    "",
    "## Skipped (not eligible)",
    "",
    "| Student | Signal | Decision | Skip reason | Detail |",
    "|---|---|---|---|---|",
    ...skipped.map(
      (c) => `| ${c.studentName} | ${c.signalId} | ${c.decision} | ${c.skipReason} | ${c.reason} |`
    ),
    "",
    "## Safety",
    "",
    "- Read-only diagnostic: no DB writes, no Telegram, no TrainingPeaks mutations.",
    "- Apply only via `replay:tp-signals-review-pending-mutations --apply --confirm`.",
    "",
  ];
  return `${lines.join("\n")}\n`;
}

async function run(): Promise<void> {
  loadLocalEnvFiles();
  const options = parseCliOptions(process.argv.slice(2));

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
  const latestDecisionBySignalId = await listLatestTrainingPeaksOperationalSignalReviewDecisionsBySignalIds(
    activeSignals.map((s) => s.id)
  );

  const { candidates, eligible, skipped } = classifyPendingReviewMutations({
    signals: activeSignals,
    latestDecisionBySignalId,
    studentNameById,
  });

  const timestamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const reportDir = path.join(REPORT_ROOT, timestamp);
  const generatedAt = new Date().toISOString();

  if (!options.noWrite) {
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(path.join(reportDir, "candidates.json"), `${JSON.stringify(candidates, null, 2)}\n`);
    fs.writeFileSync(
      path.join(reportDir, "README.md"),
      formatReportMarkdown({ generatedAt, asOfDate: options.asOfDate, reportDir, candidates })
    );
  }

  console.log(`${LOG_PREFIX} as_of=${options.asOfDate} active_signals=${activeSignals.length} with_decision=${candidates.length}`);
  console.log(`${LOG_PREFIX} eligible_pending=${eligible.length} skipped=${skipped.length} no_write=${String(options.noWrite)}`);
  if (!options.noWrite) {
    console.log(`${LOG_PREFIX} report_dir=${reportDir}`);
  }
  for (const c of eligible) {
    console.log(`- ${c.studentName}: ${c.signalType} decision=${c.decision} → ${c.proposedStatus} (decided ${c.decisionCreatedAt})`);
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
