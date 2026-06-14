import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  listActiveTrainingPeaksMoveActions,
  listLatestTrainingPeaksOperationalSignalReviewDecisionsBySignalIds,
  listTrainingPeaksOperationalSignals,
  listTrainingPeaksStudents,
  type TrainingPeaksStudent,
} from "@/features/trainingpeaks/repository";
import {
  buildOperationalSignalDisplayEvidenceMap,
  collectOperationalSignalDiagnosticItems,
} from "@/features/trainingpeaks/service";
import {
  buildTpSignalReviewQueueDryRunPreview,
  getTrainingPeaksTpSignalReviewQueueFeatureFlags,
  isTrainingPeaksTpSignalReviewQueueEnabled,
  isTrainingPeaksTpSignalReviewQueueSendEnabled,
  notifyCoachTpSignalReviewQueue,
} from "@/features/trainingpeaks/tp-signals-review-flow";
import {
  buildActiveSignalReviewBucketItems,
  buildTelegramReviewQueueDiagnosticRows,
  formatTpSignalReviewQueueSummaryMarkdown,
  selectTpSignalReviewQueueItems,
  type TpSignalReviewDecisionRecord,
} from "@/features/trainingpeaks/tp-signals-review-queue-helpers";

const LOG_PREFIX = "[diagnose:tp-signals-review-queue]";
const REPORT_ROOT = "reports/tp-signals-review-queue";
const DEFAULT_SIGNAL_LIMIT = 250;
const DEFAULT_SEND_LIMIT = 5;

type CliOptions = {
  asOfDate: string;
  names: string[];
  allActive: boolean;
  limit: number | null;
  includeReviewed: boolean;
  noWrite: boolean;
  send: boolean;
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

function parseIsoDate(raw: string, flagName: string): string {
  const normalized = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) {
    throw new Error(`${LOG_PREFIX} FAIL: invalid ${flagName}: ${raw}`);
  }
  return normalized;
}

function parseCliOptions(argv: string[]): CliOptions {
  const today = new Date().toISOString().slice(0, 10);
  const options: CliOptions = {
    asOfDate: today,
    names: [],
    allActive: false,
    limit: null,
    includeReviewed: false,
    noWrite: false,
    send: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--send") {
      options.send = true;
      continue;
    }
    if (arg === "--no-write") {
      options.noWrite = true;
      continue;
    }
    if (arg === "--all-active") {
      options.allActive = true;
      continue;
    }
    if (arg === "--include-reviewed") {
      options.includeReviewed = true;
      continue;
    }
    if (arg.startsWith("--date=")) {
      options.asOfDate = parseIsoDate(arg.slice("--date=".length), "--date");
      continue;
    }
    if (arg === "--date") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --date`);
      }
      options.asOfDate = parseIsoDate(next, "--date");
      index += 1;
      continue;
    }
    if (arg.startsWith("--names=")) {
      options.names = arg
        .slice("--names=".length)
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);
      continue;
    }
    if (arg === "--names") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --names`);
      }
      options.names = next
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);
      index += 1;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      options.limit = Math.max(1, Number(arg.slice("--limit=".length)) || 1);
      continue;
    }
    if (arg === "--limit") {
      const next = argv[index + 1];
      options.limit = Math.max(1, Number(next) || 1);
      index += 1;
      continue;
    }
  }

  return options;
}

function assertSendSafetyGuards(options: CliOptions): void {
  if (!options.send) {
    return;
  }

  if (options.allActive && !options.limit) {
    throw new Error(
      `${LOG_PREFIX} FAIL: --send with --all-active requires --limit (safety cap; do not send all active cards)`
    );
  }

  if (!options.allActive && options.names.length === 0) {
    throw new Error(`${LOG_PREFIX} FAIL: --send requires --names or --all-active with --limit`);
  }

  if (!isTrainingPeaksTpSignalReviewQueueEnabled()) {
    throw new Error(
      `${LOG_PREFIX} FAIL: --send requires TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_ENABLED=true`
    );
  }

  if (!isTrainingPeaksTpSignalReviewQueueSendEnabled()) {
    throw new Error(
      `${LOG_PREFIX} FAIL: --send requires TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_SEND_ENABLED=true`
    );
  }
}

function resolveEffectiveSendLimit(options: CliOptions): number | null {
  if (!options.send) {
    return options.limit;
  }

  if (options.limit && options.limit > 0) {
    return options.limit;
  }

  return DEFAULT_SEND_LIMIT;
}

function normalizeMatch(value: string | null | undefined): string {
  return (value ?? "")
    .toLocaleLowerCase("ru")
    .replace(/ё/gu, "е")
    .replace(/\s+/gu, " ")
    .trim();
}

function compactMatch(value: string | null | undefined): string {
  return normalizeMatch(value).replace(/[^a-zа-я0-9]+/giu, "");
}

function resolveStudentsByNames(students: TrainingPeaksStudent[], names: string[]): TrainingPeaksStudent[] {
  const resolved: TrainingPeaksStudent[] = [];
  const missing: string[] = [];
  for (const name of names) {
    const normalizedQuery = normalizeMatch(name);
    const compactQuery = compactMatch(name);
    const matches = students.filter((student) => {
      const fields = [student.studentName, student.studentId, student.telegramUsername].filter(Boolean);
      return fields.some((field) => {
        const normalizedField = normalizeMatch(field);
        const compactField = compactMatch(field);
        return (
          normalizedField === normalizedQuery ||
          compactField === compactQuery ||
          normalizedField.includes(normalizedQuery) ||
          compactField.includes(compactQuery)
        );
      });
    });
    if (matches.length === 0) {
      missing.push(name);
      continue;
    }
    if (matches.length > 1) {
      console.warn(`${LOG_PREFIX} ambiguous name "${name}" — using first match: ${matches[0]!.studentName}`);
    }
    resolved.push(matches[0]!);
  }
  if (missing.length > 0) {
    console.warn(`${LOG_PREFIX} no student match for: ${missing.join(", ")}`);
  }
  return resolved;
}

function mapLatestDecisions(
  decisions: Awaited<ReturnType<typeof listLatestTrainingPeaksOperationalSignalReviewDecisionsBySignalIds>>
): Map<string, TpSignalReviewDecisionRecord> {
  const mapped = new Map<string, TpSignalReviewDecisionRecord>();
  for (const [signalId, decision] of decisions.entries()) {
    mapped.set(signalId, {
      signalId: decision.signalId,
      studentId: decision.studentId,
      bucket: decision.bucket,
      decision: decision.decision,
      decisionSource: decision.decisionSource,
      coachTelegramUserId: decision.coachTelegramUserId,
      callbackShortId: decision.callbackShortId,
      createdAt: decision.createdAt,
      metadata: decision.metadata,
    });
  }
  return mapped;
}

function printConsoleSummary(input: {
  asOfDate: string;
  scopeLabel: string;
  matchedStudents: TrainingPeaksStudent[];
  activeSignalsScanned: number;
  featureFlags: ReturnType<typeof getTrainingPeaksTpSignalReviewQueueFeatureFlags>;
  selection: ReturnType<typeof selectTpSignalReviewQueueItems>;
  diagnosticRows: ReturnType<typeof buildTelegramReviewQueueDiagnosticRows>;
  sampleCards: string[];
  noWrite: boolean;
  reportDir: string | null;
  sendResult?: Awaited<ReturnType<typeof notifyCoachTpSignalReviewQueue>>;
}): void {
  console.log("TP Signals Review Queue Diagnostic");
  console.log(`As-of date: ${input.asOfDate}`);
  console.log(`Scope: ${input.scopeLabel}`);
  console.log(`Students matched: ${input.matchedStudents.length}`);
  console.log(`Active signals scanned: ${input.activeSignalsScanned}`);
  console.log("");
  console.log("Feature flags:");
  console.log(`- TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_ENABLED=${String(input.featureFlags.queueEnabled)}`);
  console.log(`- TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_SEND_ENABLED=${String(input.featureFlags.sendEnabled)}`);
  console.log(
    `- TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_BUTTONS_ENABLED=${String(input.featureFlags.buttonsEnabled)}`
  );
  console.log(
    `- TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_MUTATIONS_ENABLED=${String(input.featureFlags.mutationsEnabled)}`
  );
  console.log("");
  console.log("Queue selection:");
  console.log(`- total_selected: ${input.selection.totalSelected}`);
  console.log(`- review_required: ${input.selection.byBucket.review_required}`);
  console.log(`- close_candidate_review: ${input.selection.byBucket.close_candidate_review}`);
  console.log(`- pending: ${input.selection.pendingCount}`);
  console.log(`- hidden: ${input.selection.hiddenCount}`);
  console.log(`- keep_visible: ${input.selection.keepVisibleCount}`);
  console.log(`- would_send: ${input.selection.wouldSendCount}`);
  console.log(`- mutable_if_enabled: ${input.selection.wouldSendCount}`);

  const excludedRows = input.diagnosticRows.filter((row) => !row.includedInQueue);
  const includedRows = input.diagnosticRows.filter((row) => row.includedInQueue);
  const byCategory = new Map<string, number>();
  for (const row of includedRows) {
    byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + 1);
  }
  const excludedByReason = new Map<string, number>();
  for (const row of excludedRows) {
    const reason = row.queueExclusionReason ?? "unknown";
    excludedByReason.set(reason, (excludedByReason.get(reason) ?? 0) + 1);
  }

  console.log(`- queue_candidates: ${input.diagnosticRows.length}`);
  console.log(`- excluded_from_queue: ${excludedRows.length}`);
  if (byCategory.size > 0) {
    console.log("- by category (included):");
    for (const [category, count] of [...byCategory.entries()].sort((left, right) => left[0].localeCompare(right[0], "ru"))) {
      console.log(`  - ${category}: ${count}`);
    }
  }
  if (excludedByReason.size > 0) {
    console.log("- excluded by reason:");
    for (const [reason, count] of [...excludedByReason.entries()].sort((left, right) => left[0].localeCompare(right[0]))) {
      console.log(`  - ${reason}: ${count}`);
    }
  }
  console.log("");

  if (input.diagnosticRows.length > 0) {
    console.log("Queue item details (first 20):");
    for (const row of input.diagnosticRows.slice(0, 20)) {
      console.log(
        `- ${row.studentName} | bucket=${row.bucket} | category=${row.category} | included=${String(row.includedInQueue)} | queue_reason=${row.queueReason ?? "—"} | exclusion=${row.queueExclusionReason ?? "—"} | recommended=${row.sourceSignalRecommendedState} | close_candidate=${String(row.isCloseCandidate)} | actionable_dates=${String(row.hasActionableDates)} | valid_until=${row.validUntil ?? "—"} | source_obs=${row.sourceObservationId ?? "—"}`
      );
    }
    console.log("");
  }

  console.log("");

  if (input.sampleCards.length > 0) {
    console.log("Sample cards:");
    for (const card of input.sampleCards.slice(0, 5)) {
      console.log("---");
      console.log(card);
    }
    console.log("");
  }

  if (input.sendResult) {
    console.log("Live send:");
    console.log(`- status: ${input.sendResult.status}`);
    if (input.sendResult.status === "sent") {
      console.log(`- sent_count: ${input.sendResult.sentCount}`);
      console.log("- destination: coach chat only (TELEGRAM_COACH_CHAT_IDS)");
    }
    console.log("");
  }

  if (input.noWrite) {
    console.log(`${LOG_PREFIX} --no-write set: report files were not written`);
  } else if (input.reportDir) {
    console.log(`${LOG_PREFIX} report_dir=${input.reportDir}`);
  }
}

async function run(): Promise<void> {
  loadLocalEnvFiles();
  const options = parseCliOptions(process.argv.slice(2));
  if (!options.allActive && options.names.length === 0) {
    throw new Error(`${LOG_PREFIX} FAIL: provide --names or --all-active`);
  }
  if (options.allActive && options.names.length > 0) {
    throw new Error(`${LOG_PREFIX} FAIL: use either --names or --all-active, not both`);
  }
  assertSendSafetyGuards(options);

  const featureFlags = getTrainingPeaksTpSignalReviewQueueFeatureFlags();
  const [students, signalsResult, actions] = await Promise.all([
    listTrainingPeaksStudents(),
    listTrainingPeaksOperationalSignals({ status: "active", limit: DEFAULT_SIGNAL_LIMIT }),
    listActiveTrainingPeaksMoveActions(250),
  ]);

  const matchedStudents = options.allActive ? students : resolveStudentsByNames(students, options.names);
  const matchedStudentIds = new Set(matchedStudents.map((student) => student.id));
  const studentNameById = new Map(
    matchedStudents.map((student) => [student.id, student.studentName?.trim() || student.studentId])
  );
  const signals = signalsResult.items.filter((signal) => matchedStudentIds.has(signal.studentId));

  const displayEvidenceBySignalId = await buildOperationalSignalDisplayEvidenceMap({
    signals,
    asOfDate: options.asOfDate,
  });
  const diagnosticItems = collectOperationalSignalDiagnosticItems({
    signals,
    studentNameById,
    asOfDate: options.asOfDate,
    activeMoveActions: actions,
    displayEvidenceBySignalId,
  });
  const activeItems = buildActiveSignalReviewBucketItems({
    signals,
    diagnosticItems,
    studentNameById,
    displayEvidenceBySignalId,
    asOfDate: options.asOfDate,
  });

  let latestDecisionsBySignalId = new Map<string, TpSignalReviewDecisionRecord>();
  try {
    const latestDecisions = await listLatestTrainingPeaksOperationalSignalReviewDecisionsBySignalIds(
      activeItems.map((item) => item.signalId)
    );
    latestDecisionsBySignalId = mapLatestDecisions(latestDecisions);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("trainingpeaks_operational_signal_review_decisions table is missing")) {
      console.warn(`${LOG_PREFIX} review decisions table not migrated yet — treating all items as pending`);
    } else {
      throw error;
    }
  }

  const effectiveLimit = resolveEffectiveSendLimit(options);
  const diagnosticRows = buildTelegramReviewQueueDiagnosticRows(activeItems);
  const selection = selectTpSignalReviewQueueItems({
    activeItems,
    latestDecisionsBySignalId,
    includeReviewed: options.includeReviewed,
    limit: effectiveLimit,
  });
  const sampleCards = buildTpSignalReviewQueueDryRunPreview({ items: selection.items });
  let sendResult: Awaited<ReturnType<typeof notifyCoachTpSignalReviewQueue>> | undefined;
  if (options.send) {
    sendResult = await notifyCoachTpSignalReviewQueue({ items: selection.items });
  }
  const scopeLabel = options.allActive
    ? "all active students (Supabase is_active=true)"
    : `named subset (${options.names.join(", ")})`;

  printConsoleSummary({
    asOfDate: options.asOfDate,
    scopeLabel,
    matchedStudents,
    activeSignalsScanned: signals.length,
    featureFlags,
    selection,
    diagnosticRows,
    sampleCards,
    noWrite: options.noWrite,
    reportDir: null,
    sendResult,
  });

  if (options.noWrite) {
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const reportDir = path.join(process.cwd(), REPORT_ROOT, timestamp);
  fs.mkdirSync(reportDir, { recursive: true });

  const summaryMarkdown = formatTpSignalReviewQueueSummaryMarkdown({
    generatedAt: new Date().toISOString(),
    asOfDate: options.asOfDate,
    scopeLabel,
    featureFlags,
    selection,
    sampleCards: sampleCards.slice(0, 10),
  });

  fs.writeFileSync(path.join(reportDir, "summary.md"), summaryMarkdown, "utf8");
  fs.writeFileSync(
    path.join(reportDir, "queue-items.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        asOfDate: options.asOfDate,
        featureFlags,
        selection,
        diagnosticRows,
        sampleCards,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(`${LOG_PREFIX} report_dir=${reportDir}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
