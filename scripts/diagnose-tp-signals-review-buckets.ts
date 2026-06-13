import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  listActiveTrainingPeaksMoveActions,
  listTrainingPeaksOperationalSignals,
  listTrainingPeaksStudents,
  listTrainingPeaksTelegramContextObservationsForStudent,
  type TrainingPeaksStudent,
} from "@/features/trainingpeaks/repository";
import {
  buildOperationalSignalDisplayEvidenceMap,
  collectOperationalSignalDiagnosticItems,
} from "@/features/trainingpeaks/service";
import {
  assignActiveSignalReviewBucket,
  buildReviewBucketCounts,
  buildSilentSkipReviewBucketItem,
  classifySilentSkipReviewBucketItems,
  formatReviewBucketsReadme,
  formatReviewBucketsSummaryMarkdown,
  type ActiveSignalReviewBucketItem,
  type ReviewBucketName,
  type SilentSkipReviewBucketItem,
} from "@/features/trainingpeaks/tp-signals-review-buckets-helpers";

const LOG_PREFIX = "[diagnose:tp-signals-review-buckets]";
const REPORT_ROOT = "reports/tp-signals-review-buckets";
const DEFAULT_OBSERVATION_LIMIT = 250;
const DEFAULT_SIGNAL_LIMIT = 250;

type CliOptions = {
  fromDate: string;
  toDate: string;
  names: string[];
  allActive: boolean;
  limit: number;
  noWrite: boolean;
};

type DateWindow = {
  fromDate: string;
  toDate: string;
  label: string;
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
    fromDate: today,
    toDate: today,
    names: [],
    allActive: false,
    limit: DEFAULT_OBSERVATION_LIMIT,
    noWrite: false,
  };

  let explicitDate: string | null = null;
  let explicitFrom: string | null = null;
  let explicitTo: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--no-write") {
      options.noWrite = true;
      continue;
    }
    if (arg === "--all-active") {
      options.allActive = true;
      continue;
    }
    if (arg.startsWith("--date=")) {
      explicitDate = parseIsoDate(arg.slice("--date=".length), "--date");
      continue;
    }
    if (arg === "--date") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --date`);
      }
      explicitDate = parseIsoDate(next, "--date");
      index += 1;
      continue;
    }
    if (arg.startsWith("--from=")) {
      explicitFrom = parseIsoDate(arg.slice("--from=".length), "--from");
      continue;
    }
    if (arg === "--from") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --from`);
      }
      explicitFrom = parseIsoDate(next, "--from");
      index += 1;
      continue;
    }
    if (arg.startsWith("--to=")) {
      explicitTo = parseIsoDate(arg.slice("--to=".length), "--to");
      continue;
    }
    if (arg === "--to") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --to`);
      }
      explicitTo = parseIsoDate(next, "--to");
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
      options.limit = Math.max(1, Number(arg.slice("--limit=".length)) || DEFAULT_OBSERVATION_LIMIT);
      continue;
    }
    if (arg === "--limit") {
      const next = argv[index + 1];
      options.limit = Math.max(1, Number(next) || DEFAULT_OBSERVATION_LIMIT);
      index += 1;
      continue;
    }
  }

  if (explicitDate && (explicitFrom || explicitTo)) {
    throw new Error(`${LOG_PREFIX} FAIL: use either --date or --from/--to, not both`);
  }
  if (explicitDate) {
    options.fromDate = explicitDate;
    options.toDate = explicitDate;
  } else {
    if (explicitFrom) {
      options.fromDate = explicitFrom;
    }
    if (explicitTo) {
      options.toDate = explicitTo;
    }
  }
  if (options.fromDate > options.toDate) {
    throw new Error(`${LOG_PREFIX} FAIL: --from must be <= --to`);
  }

  return options;
}

function resolveDateWindow(options: CliOptions): DateWindow {
  if (options.fromDate === options.toDate) {
    return {
      fromDate: options.fromDate,
      toDate: options.toDate,
      label: options.fromDate,
    };
  }
  return {
    fromDate: options.fromDate,
    toDate: options.toDate,
    label: `${options.fromDate}..${options.toDate}`,
  };
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

function observationDateKey(observedAt: string): string {
  return observedAt.slice(0, 10);
}

function isObservationInWindow(observedAt: string, window: DateWindow): boolean {
  const dateKey = observationDateKey(observedAt);
  return dateKey >= window.fromDate && dateKey <= window.toDate;
}

function countBuckets(
  activeItems: ActiveSignalReviewBucketItem[],
  silentSkipClassification: ReturnType<typeof classifySilentSkipReviewBucketItems>
): Record<ReviewBucketName, number> & {
  silent_skip_raw_with_cues: number;
  silent_skip_suppressed_noise: number;
} {
  return buildReviewBucketCounts({ activeItems, silentSkipClassification });
}

function countVisibleDiagnosticRows(activeItems: ActiveSignalReviewBucketItem[]): number {
  return activeItems.filter((item) => item.visible).length;
}

function printConsoleSummary(input: {
  window: DateWindow;
  matchedStudents: TrainingPeaksStudent[];
  observationsScanned: number;
  activeSignalsScanned: number;
  visibleDiagnosticRows: number;
  bucketCounts: ReturnType<typeof countBuckets>;
  activeItems: ActiveSignalReviewBucketItem[];
  silentSkipClassification: ReturnType<typeof classifySilentSkipReviewBucketItems>;
  noWrite: boolean;
  reportDir: string | null;
  allActive: boolean;
}): void {
  const visibleOrCandidateRows = input.visibleDiagnosticRows + input.bucketCounts.silent_skip_with_cues;
  const silentSkipPct =
    input.observationsScanned > 0
      ? ((input.bucketCounts.silent_skip_with_cues / input.observationsScanned) * 100).toFixed(1)
      : "0.0";
  const rawSilentSkipPct =
    input.observationsScanned > 0
      ? ((input.bucketCounts.silent_skip_raw_with_cues / input.observationsScanned) * 100).toFixed(1)
      : "0.0";
  const reviewRequiredPct =
    visibleOrCandidateRows > 0
      ? ((input.bucketCounts.review_required / visibleOrCandidateRows) * 100).toFixed(1)
      : "0.0";
  const closeCandidatePct =
    visibleOrCandidateRows > 0
      ? ((input.bucketCounts.close_candidate_review / visibleOrCandidateRows) * 100).toFixed(1)
      : "0.0";

  console.log("TP Signals Review Buckets Diagnostic");
  console.log(`Date/window: ${input.window.label}`);
  console.log(`Scope: ${input.allActive ? "all active students (Supabase is_active=true)" : "named subset"}`);
  console.log(`Students matched: ${input.matchedStudents.length}`);
  console.log(`Observations scanned: ${input.observationsScanned}`);
  console.log(`Active signals scanned: ${input.activeSignalsScanned}`);
  console.log(`Visible diagnostic rows: ${input.visibleDiagnosticRows}`);
  console.log("");
  console.log("Bucket summary:");
  console.log(`- obvious_auto_record: ${input.bucketCounts.obvious_auto_record}`);
  console.log(`- review_required: ${input.bucketCounts.review_required}`);
  console.log(`- close_candidate_review: ${input.bucketCounts.close_candidate_review}`);
  console.log(`- silent_skip_raw_with_cues: ${input.bucketCounts.silent_skip_raw_with_cues}`);
  console.log(`- silent_skip_with_cues (strict retained): ${input.bucketCounts.silent_skip_with_cues}`);
  console.log(`- silent_skip_suppressed_noise: ${input.bucketCounts.silent_skip_suppressed_noise}`);
  console.log("");
  console.log("Suppressed silent-skip noise by reason:");
  for (const [reason, count] of Object.entries(input.silentSkipClassification.suppressedByReason)) {
    if (count > 0) {
      console.log(`- ${reason}: ${count}`);
    }
  }
  console.log("");
  console.log("Percentages:");
  console.log(`- silent_skip_raw_with_cues / observations_scanned: ${rawSilentSkipPct}%`);
  console.log(`- silent_skip_with_cues (strict) / observations_scanned: ${silentSkipPct}%`);
  console.log(`- review_required / visible_or_candidate_rows: ${reviewRequiredPct}%`);
  console.log(`- close_candidate_review / visible_or_candidate_rows: ${closeCandidatePct}%`);
  console.log("");

  for (const bucket of ["close_candidate_review", "review_required", "obvious_auto_record"] as const) {
    const items = input.activeItems.filter((item) => item.bucket === bucket);
    if (items.length === 0) {
      continue;
    }
    console.log(`[${bucket}]`);
    for (const item of items) {
      console.log(`• ${item.studentName}`);
      console.log(`  category: ${item.category}`);
      console.log(`  state: ${item.state}`);
      console.log(`  reason: ${item.reason}`);
      console.log(`  source: ${item.sourceObservationId ?? item.signalId}`);
      console.log(`  preview: "${item.preview}"`);
    }
    console.log("");
  }

  if (input.silentSkipClassification.retainedCandidates.length > 0) {
    console.log("[silent_skip_with_cues strict retained]");
    for (const item of input.silentSkipClassification.retainedCandidates) {
      console.log(`• ${item.studentName}`);
      console.log(`  diagnostic sub-bucket: ${item.diagnosticSubBucket}`);
      console.log(`  candidate family: ${item.candidateFamily}`);
      console.log(`  skip reason: ${item.skipReason}`);
      console.log(`  classification note: ${item.classificationNote}`);
      console.log(`  source observation_id: ${item.observationId}`);
      console.log(`  raw preview: "${item.rawPreview}"`);
    }
    console.log("");
  }

  if (input.silentSkipClassification.suppressedRows.length > 0) {
    console.log("[silent_skip_suppressed_noise]");
    for (const item of input.silentSkipClassification.suppressedRows.slice(0, 12)) {
      console.log(`• ${item.studentName}`);
      console.log(`  suppression reason: ${item.diagnosticSubBucket}`);
      console.log(`  raw preview: "${item.rawPreview}"`);
    }
    if (input.silentSkipClassification.suppressedRows.length > 12) {
      console.log(`… ${input.silentSkipClassification.suppressedRows.length - 12} more suppressed rows in report`);
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

  const window = resolveDateWindow(options);
  const asOfDate = window.toDate;

  const [students, signalsResult, actions] = await Promise.all([
    listTrainingPeaksStudents(),
    listTrainingPeaksOperationalSignals({ status: "active", limit: DEFAULT_SIGNAL_LIMIT }),
    listActiveTrainingPeaksMoveActions(250),
  ]);

  const matchedStudents = options.allActive ? students : resolveStudentsByNames(students, options.names);
  const matchedStudentIds = new Set(matchedStudents.map((student) => student.id));
  const studentNameById = new Map(matchedStudents.map((student) => [student.id, student.studentName?.trim() || student.studentId]));
  const signals = signalsResult.items.filter((signal) => matchedStudentIds.has(signal.studentId));

  const displayEvidenceBySignalId = await buildOperationalSignalDisplayEvidenceMap({
    signals,
    asOfDate,
  });
  const diagnosticItems = collectOperationalSignalDiagnosticItems({
    signals,
    studentNameById,
    asOfDate,
    activeMoveActions: actions,
    displayEvidenceBySignalId,
  });
  const diagnosticItemBySignalId = new Map(diagnosticItems.map((item) => [item.signalId, item]));

  const activeItems: ActiveSignalReviewBucketItem[] = [];
  for (const signal of signals) {
    const item = diagnosticItemBySignalId.get(signal.id);
    if (!item) {
      continue;
    }
    activeItems.push(
      assignActiveSignalReviewBucket({
        studentName: studentNameById.get(signal.studentId) ?? signal.studentId,
        signal,
        item,
        evidence: displayEvidenceBySignalId.get(signal.id) ?? null,
        asOfDate,
      })
    );
  }

  const persistedObservationIds = new Set(
    signals
      .map((signal) => signal.sourceObservationId)
      .filter((value): value is string => Boolean(value))
  );

  const rawSilentSkipItems: Array<{
    item: SilentSkipReviewBucketItem;
    metadata: Record<string, unknown>;
  }> = [];
  let observationsScanned = 0;
  for (const student of matchedStudents) {
    const observations = await listTrainingPeaksTelegramContextObservationsForStudent(student.id, options.limit);
    for (const observation of observations) {
      if (!isObservationInWindow(observation.observedAt, window)) {
        continue;
      }
      observationsScanned += 1;
      if (persistedObservationIds.has(observation.id)) {
        continue;
      }
      const item = buildSilentSkipReviewBucketItem({
        observation,
        studentName: student.studentName,
        studentId: student.id,
      });
      if (item) {
        rawSilentSkipItems.push({
          item,
          metadata: observation.metadata ?? {},
        });
      }
    }
  }

  const silentSkipClassification = classifySilentSkipReviewBucketItems(rawSilentSkipItems);
  const retainedSilentSkipItems = silentSkipClassification.retainedCandidates;

  retainedSilentSkipItems.sort((left, right) => right.observedAt.localeCompare(left.observedAt));
  silentSkipClassification.suppressedRows.sort((left, right) => right.observedAt.localeCompare(left.observedAt));
  activeItems.sort((left, right) => left.studentName.localeCompare(right.studentName, "ru"));

  const bucketCounts = countBuckets(activeItems, silentSkipClassification);
  const visibleDiagnosticRows = countVisibleDiagnosticRows(activeItems);
  const generatedAt = new Date().toISOString();
  const timestamp = generatedAt.replace(/[:.]/gu, "-");
  const reportDir = path.join(REPORT_ROOT, timestamp);
  const scopeLabel = options.allActive ? "--all-active" : options.names.join(", ");

  const summaryMarkdown = formatReviewBucketsSummaryMarkdown({
    generatedAt,
    windowLabel: window.label,
    names: options.allActive ? ["--all-active"] : options.names,
    matchedStudents: matchedStudents.map((student) => ({ id: student.id, name: student.studentName })),
    observationsScanned,
    activeSignalsScanned: signals.length,
    visibleDiagnosticRows,
    bucketCounts,
    activeItems,
    silentSkipItems: retainedSilentSkipItems,
    silentSkipClassification,
    reportDir: options.noWrite ? null : reportDir,
    noWrite: options.noWrite,
    scopeLabel,
  });

  if (!options.noWrite) {
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(path.join(reportDir, "summary.md"), summaryMarkdown);
    fs.writeFileSync(path.join(reportDir, "README.md"), formatReviewBucketsReadme());
    fs.writeFileSync(
      path.join(reportDir, "review-buckets.json"),
      `${JSON.stringify(
        {
          generatedAt,
          window,
          scope: scopeLabel,
          allActive: options.allActive,
          matchedStudents: matchedStudents.map((student) => ({
            id: student.id,
            name: student.studentName,
            studentId: student.studentId,
          })),
          observationsScanned,
          activeSignalsScanned: signals.length,
          visibleDiagnosticRows,
          bucketCounts,
          activeItems,
        },
        null,
        2
      )}\n`
    );
    fs.writeFileSync(
      path.join(reportDir, "silent-skip-with-cues.json"),
      `${JSON.stringify(
        {
          generatedAt,
          window,
          rawWithCuesCount: silentSkipClassification.rawWithCuesCount,
          retainedCandidateCount: silentSkipClassification.retainedCandidateCount,
          suppressedNoiseCount: silentSkipClassification.suppressedNoiseCount,
          suppressedByReason: silentSkipClassification.suppressedByReason,
          retainedCandidates: retainedSilentSkipItems,
          suppressedRows: silentSkipClassification.suppressedRows,
          diagnosticNote: "not persisted; gates remain authoritative; strict retained list is review-candidate surfacing only",
        },
        null,
        2
      )}\n`
    );
  }

  printConsoleSummary({
    window,
    matchedStudents,
    observationsScanned,
    activeSignalsScanned: signals.length,
    visibleDiagnosticRows,
    bucketCounts,
    activeItems,
    silentSkipClassification,
    noWrite: options.noWrite,
    reportDir: options.noWrite ? null : reportDir,
    allActive: options.allActive,
  });
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
