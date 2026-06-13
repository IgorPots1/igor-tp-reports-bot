import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  classifyPersistedSignalCleanupEligibility,
  classifyStalePayloadParserOverreadWeekdayContextRemediation,
  formatPersistedCleanupSummaryMarkdown,
  TP_SIGNALS_PERSISTED_CLEANUP_CONFIRM,
  type PersistedCleanupCandidate,
  type TargetedPersistedCleanupReason,
} from "@/features/trainingpeaks/tp-signals-persisted-cleanup";
import {
  getTrainingPeaksTelegramContextObservationById,
  listTrainingPeaksOperationalSignals,
  listTrainingPeaksStudents,
  type TrainingPeaksStudent,
  type TrainingPeaksStudentOperationalSignal,
} from "@/features/trainingpeaks/repository";
import { createSupabaseServerClient } from "@/features/supabase/server";

const LOG_PREFIX = "[cleanup:tp-signals-persisted]";
const REPORT_ROOT = "reports/tp-signals-persisted-cleanup";

type CliOptions = {
  asOfDate: string;
  names: string[];
  signalId: string | null;
  reason: TargetedPersistedCleanupReason | null;
  apply: boolean;
  confirm: string | null;
};

type ObservationRow = {
  id: string;
  text_preview: string | null;
  observed_at: string | null;
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
    names: [],
    signalId: null,
    reason: null,
    apply: false,
    confirm: null,
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
    if (arg.startsWith("--reason=")) {
      options.reason = parseTargetedReason(arg.slice("--reason=".length));
      continue;
    }
    if (arg === "--reason") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --reason`);
      }
      options.reason = parseTargetedReason(next);
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

function parseTargetedReason(raw: string): TargetedPersistedCleanupReason {
  const normalized = raw.trim();
  if (normalized === "parser_overread_weekday_context") {
    return normalized;
  }
  throw new Error(
    `${LOG_PREFIX} FAIL: unsupported --reason=${raw}; supported: parser_overread_weekday_context`
  );
}

function validateCliOptions(options: CliOptions): void {
  if (options.reason && !options.signalId) {
    throw new Error(`${LOG_PREFIX} FAIL: --reason=${options.reason} requires --signal-id`);
  }
  if (options.signalId && !options.reason) {
    throw new Error(`${LOG_PREFIX} FAIL: --signal-id requires --reason=parser_overread_weekday_context`);
  }
}

function validateApplyPrerequisites(options: CliOptions): string | null {
  if (!options.apply) {
    return null;
  }
  if (!options.confirm || options.confirm !== TP_SIGNALS_PERSISTED_CLEANUP_CONFIRM) {
    return `--apply requires --confirm "${TP_SIGNALS_PERSISTED_CLEANUP_CONFIRM}"`;
  }
  return null;
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

async function fetchAllActiveSignals(limit = 1200): Promise<TrainingPeaksStudentOperationalSignal[]> {
  const items: TrainingPeaksStudentOperationalSignal[] = [];
  const pageSize = 200;
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  while (items.length < limit && offset < total) {
    const page = await listTrainingPeaksOperationalSignals({
      status: "active",
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
      .select("id, text_preview, observed_at")
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

function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function buildCleanupMetadata(input: {
  existing: unknown;
  reason: PersistedCleanupCandidate["reason"];
  recommendedAction: PersistedCleanupCandidate["recommended_action"];
  mode: "dry-run" | "apply";
}): Record<string, unknown> {
  return {
    ...normalizeMetadata(input.existing),
    tp_signals_persisted_cleanup_reason: input.reason,
    tp_signals_persisted_cleanup_action: input.recommendedAction,
    tp_signals_persisted_cleanup_at: new Date().toISOString(),
    tp_signals_persisted_cleanup_mode: input.mode,
    tp_signals_persisted_cleanup_source: "guarded_persisted_cleanup_v1",
  };
}

async function applyEligibleCleanup(input: {
  candidates: PersistedCleanupCandidate[];
  signalsById: Map<string, TrainingPeaksStudentOperationalSignal>;
  asOfDate: string;
}): Promise<number> {
  const supabase = createSupabaseServerClient();
  let written = 0;
  const eligible = input.candidates.filter((item) => item.eligibility === "eligible");

  for (const candidate of eligible) {
    const signal = input.signalsById.get(candidate.signal_id);
    if (!signal || signal.status !== "active") {
      throw new Error(`${LOG_PREFIX} FAIL: signal ${candidate.signal_id} is no longer active`);
    }

    const metadata = buildCleanupMetadata({
      existing: signal.metadata,
      reason: candidate.reason,
      recommendedAction: candidate.recommended_action,
      mode: "apply",
    });
    const updates: Record<string, unknown> = {
      metadata,
      updated_at: new Date().toISOString(),
    };

    if (candidate.reason === "expired_schedule_constraint" || candidate.reason === "stale_payload_parser_overread_weekday_context") {
      updates.status = "expired";
      const nextValidUntil =
        !signal.validUntil || signal.validUntil > input.asOfDate ? input.asOfDate : signal.validUntil;
      updates.valid_until = nextValidUntil;
    } else {
      updates.status = "dismissed";
    }

    const write = await supabase
      .from("trainingpeaks_student_operational_signals")
      .update(updates)
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
  validateCliOptions(options);
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

  const [students, activeSignals] = await Promise.all([
    listTrainingPeaksStudents(),
    fetchAllActiveSignals(),
  ]);
  const studentNameById = new Map(
    students.map((student) => [student.id, student.studentName?.trim() || `Unknown (${student.id.slice(0, 8)})`])
  );

  let signals = activeSignals.filter((signal) => signal.lifecycleState !== "resolved");
  if (options.signalId) {
    signals = signals.filter((signal) => signal.id === options.signalId);
    if (signals.length === 0) {
      throw new Error(`${LOG_PREFIX} FAIL: no active signal found for signal_id=${options.signalId}`);
    }
  }
  if (options.names.length > 0) {
    const matchedStudents = resolveStudentsByNames(students, options.names);
    const matchedStudentIds = new Set(matchedStudents.map((student) => student.id));
    signals = signals.filter((signal) => matchedStudentIds.has(signal.studentId));
  }

  const observationIds = [
    ...new Set(
      signals
        .map((signal) => signal.sourceObservationId)
        .filter((value): value is string => Boolean(value))
    ),
  ];
  const observationById = await fetchObservationRowsByIds(observationIds);

  let candidates: PersistedCleanupCandidate[];
  if (options.reason === "parser_overread_weekday_context") {
    if (signals.length !== 1) {
      throw new Error(
        `${LOG_PREFIX} FAIL: targeted remediation requires exactly one active signal; found ${signals.length}`
      );
    }
    const signal = signals[0]!;
    const observation = signal.sourceObservationId
      ? await getTrainingPeaksTelegramContextObservationById(signal.sourceObservationId)
      : null;
    candidates = [
      classifyStalePayloadParserOverreadWeekdayContextRemediation({
        signal,
        studentName: studentNameById.get(signal.studentId) ?? `Unknown (${signal.studentId.slice(0, 8)})`,
        sourceSnippet: observation?.textPreview ?? observationById.get(signal.sourceObservationId ?? "")?.text_preview ?? null,
        asOfDate: options.asOfDate,
        referenceObservedAt: observation?.observedAt ?? signal.createdAt,
        studentId: signal.studentId,
        sourceType: observation?.sourceType ?? null,
        sourceLabels: observation?.labels ?? [],
        sourceMetadata: observation?.metadata ?? {},
      }),
    ];
  } else {
    candidates = signals.map((signal) => {
      const observation = signal.sourceObservationId
        ? observationById.get(signal.sourceObservationId) ?? null
        : null;
      return classifyPersistedSignalCleanupEligibility({
        signal,
        studentName: studentNameById.get(signal.studentId) ?? `Unknown (${signal.studentId.slice(0, 8)})`,
        sourceSnippet: observation?.text_preview ?? null,
        asOfDate: options.asOfDate,
        referenceObservedAt: observation?.observed_at ?? signal.createdAt,
      });
    });
  }

  const wouldWriteCount = candidates.filter((item) => item.eligibility === "eligible").length;
  const mode = options.apply ? "apply" : "dry-run";
  let actualWrittenCount = 0;

  if (options.apply) {
    if (options.reason === "parser_overread_weekday_context" && wouldWriteCount !== 1) {
      throw new Error(
        `${LOG_PREFIX} FAIL: targeted apply blocked; expected would_write=1, got ${wouldWriteCount}`
      );
    }
    const signalsById = new Map(signals.map((signal) => [signal.id, signal]));
    actualWrittenCount = await applyEligibleCleanup({
      candidates,
      signalsById,
      asOfDate: options.asOfDate,
    });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const reportDir = path.join(REPORT_ROOT, timestamp);
  const generatedAt = new Date().toISOString();
  const summaryMarkdown = formatPersistedCleanupSummaryMarkdown({
    generatedAt,
    asOfDate: options.asOfDate,
    names: options.names,
    signalId: options.signalId,
    targetedReason: options.reason,
    mode,
    candidates,
    wouldWriteCount,
    actualWrittenCount,
    reportDir,
  });

  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, "cleanup-candidates.json"), `${JSON.stringify(candidates, null, 2)}\n`);
  fs.writeFileSync(path.join(reportDir, "summary.md"), summaryMarkdown);

  console.log(`${LOG_PREFIX} mode=${mode} as_of=${options.asOfDate} inspected=${candidates.length}`);
  if (options.reason) {
    console.log(`${LOG_PREFIX} targeted_reason=${options.reason} signal_id=${options.signalId ?? "(none)"}`);
  }
  console.log(`${LOG_PREFIX} eligible=${candidates.filter((item) => item.eligibility === "eligible").length}`);
  console.log(`${LOG_PREFIX} partial_only=${candidates.filter((item) => item.eligibility === "partial_only").length}`);
  console.log(`${LOG_PREFIX} not_eligible=${candidates.filter((item) => item.eligibility === "not_eligible").length}`);
  console.log(`${LOG_PREFIX} would_write=${wouldWriteCount} actual_written=${actualWrittenCount}`);
  console.log(`${LOG_PREFIX} report_dir=${reportDir}`);

  for (const candidate of candidates) {
    if (candidate.eligibility === "eligible" || candidate.eligibility === "partial_only") {
      console.log(
        `- ${candidate.student}: ${candidate.signal_type} eligibility=${candidate.eligibility} reason=${candidate.reason} action=${candidate.recommended_action}`
      );
    }
    if (options.reason && candidate.safety_notes.length > 0) {
      for (const note of candidate.safety_notes) {
        console.log(`  - ${note}`);
      }
    }
  }

  if (!options.apply) {
    console.log("");
    console.log("No DB writes made (dry-run).");
    console.log(`To apply, rerun with --apply --confirm "${TP_SIGNALS_PERSISTED_CLEANUP_CONFIRM}".`);
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
