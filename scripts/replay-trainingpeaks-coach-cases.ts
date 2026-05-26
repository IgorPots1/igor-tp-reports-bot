import process from "node:process";

import {
  insertTrainingPeaksCoachCase,
  insertTrainingPeaksStudentContextSnapshot,
  type TrainingPeaksCoachCaseKind,
  type TrainingPeaksMessageIntentLogStatus,
} from "@/features/trainingpeaks/repository";
import { createSupabaseServerClient } from "@/features/supabase/server";

const LOG_PREFIX = "[replay-coach-cases]";
const PAGE_SIZE = 500;
const SINCE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type CliArgs = {
  dryRun: boolean;
  since: string | null;
};

type ReplaySummary = {
  processed: number;
  insertedCases: number;
  insertedSnapshots: number;
  skippedExisting: number;
  skippedNoCaseKind: number;
  failed: number;
};

type IntentLogRow = {
  id: string;
  created_at: string;
  student_id: string;
  telegram_chat_id: string | null;
  telegram_message_id: string | null;
  status: TrainingPeaksMessageIntentLogStatus;
  action_id: string | null;
};

type ContextObservationRow = {
  id: string;
  labels: unknown;
};

type ExistingCaseRow = {
  case_kind: string;
};

type ExistingSnapshotRow = {
  id: string;
};

function getEnvValue(name: "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function parseArgs(argv: string[]): CliArgs {
  let dryRun = false;
  let since: string | null = null;

  for (const arg of argv) {
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg.startsWith("--since=")) {
      const candidate = arg.slice("--since=".length).trim();
      if (!SINCE_PATTERN.test(candidate)) {
        throw new Error(`${LOG_PREFIX} FAIL: invalid --since value, expected YYYY-MM-DD`);
      }
      since = candidate;
      continue;
    }

    throw new Error(`${LOG_PREFIX} FAIL: unsupported argument ${arg}`);
  }

  return { dryRun, since };
}

function ensureSupabaseEnv(): boolean {
  const supabaseUrl = getEnvValue("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = getEnvValue("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    console.log(`${LOG_PREFIX} SKIP: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY`);
    return false;
  }

  if (!process.env.SUPABASE_URL) {
    process.env.SUPABASE_URL = supabaseUrl;
  }

  return true;
}

function normalizeLabels(labels: unknown): string[] {
  if (!Array.isArray(labels)) {
    return [];
  }

  const unique = new Set<string>();
  for (const label of labels) {
    if (typeof label !== "string") {
      continue;
    }

    const normalized = label.trim();
    if (!normalized) {
      continue;
    }

    unique.add(normalized);
  }

  return [...unique];
}

function buildLabelSummary(labels: readonly string[]): Record<string, boolean> {
  const summary: Record<string, boolean> = {};

  for (const label of labels) {
    summary[label] = true;
  }

  return summary;
}

function deriveCaseKinds(input: {
  intentStatus: TrainingPeaksMessageIntentLogStatus;
  actionId: string | null;
  labels: readonly string[];
}): TrainingPeaksCoachCaseKind[] {
  const kinds = new Set<TrainingPeaksCoachCaseKind>();

  if (input.intentStatus === "action_created" && input.actionId) {
    kinds.add("move_workout_requested");
  }
  if (input.intentStatus === "needs_review") {
    kinds.add("move_workout_needs_review");
  }
  if (input.intentStatus === "unrecognized") {
    kinds.add("unrecognized_intent");
  }
  if (input.labels.includes("pain_or_health")) {
    kinds.add("pain_or_health_signal");
  }
  if (input.labels.includes("question_to_coach")) {
    kinds.add("question_to_coach");
  }

  return [...kinds];
}

function parseTelegramMessageId(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    return null;
  }

  return parsed;
}

function formatKinds(caseKinds: readonly string[]): string {
  return caseKinds.length > 0 ? caseKinds.join(",") : "none";
}

function sinceStartIso(since: string): string {
  return `${since}T00:00:00.000Z`;
}

async function fetchIntentLogPage(
  offset: number,
  since: string | null
): Promise<IntentLogRow[]> {
  const supabase = createSupabaseServerClient();
  let query = supabase
    .from("trainingpeaks_message_intent_logs")
    .select("id, created_at, student_id, telegram_chat_id, telegram_message_id, status, action_id")
    .not("student_id", "is", null)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .range(offset, offset + PAGE_SIZE - 1);

  if (since) {
    query = query.gte("created_at", sinceStartIso(since));
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to list TrainingPeaks message intent logs: ${error.message}`);
  }

  return ((data as IntentLogRow[] | null) ?? []).filter((row): row is IntentLogRow => Boolean(row.student_id));
}

async function lookupContextObservation(
  telegramChatId: string | null,
  telegramMessageId: string | null
): Promise<{ id: string; labels: string[] } | null> {
  if (!telegramChatId || !telegramMessageId) {
    return null;
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_telegram_context_observations")
    .select("id, labels")
    .eq("chat_id", telegramChatId)
    .eq("message_id", telegramMessageId)
    .order("observed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to lookup TrainingPeaks context observation: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  const row = data as ContextObservationRow;
  return {
    id: row.id,
    labels: normalizeLabels(row.labels),
  };
}

async function lookupExistingCaseKinds(intentLogId: string): Promise<Set<TrainingPeaksCoachCaseKind>> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_coach_cases")
    .select("case_kind")
    .eq("intent_log_id", intentLogId);

  if (error) {
    throw new Error(`Failed to lookup existing TrainingPeaks coach cases: ${error.message}`);
  }

  return new Set(
    ((data as ExistingCaseRow[] | null) ?? [])
      .map((row) => row.case_kind)
      .filter((value): value is TrainingPeaksCoachCaseKind => typeof value === "string")
  );
}

async function lookupExistingSnapshotId(intentLogId: string): Promise<string | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_student_context_snapshots")
    .select("id")
    .eq("source_intent_log_id", intentLogId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to lookup existing TrainingPeaks snapshot: ${error.message}`);
  }

  return (data as ExistingSnapshotRow | null)?.id ?? null;
}

function printSummary(summary: ReplaySummary): void {
  console.log(`${LOG_PREFIX} processed=${summary.processed}`);
  console.log(`${LOG_PREFIX} inserted_cases=${summary.insertedCases}`);
  console.log(`${LOG_PREFIX} inserted_snapshots=${summary.insertedSnapshots}`);
  console.log(`${LOG_PREFIX} skipped_existing=${summary.skippedExisting}`);
  console.log(`${LOG_PREFIX} skipped_no_case_kind=${summary.skippedNoCaseKind}`);
  console.log(`${LOG_PREFIX} failed=${summary.failed}`);
}

async function replayIntentLog(row: IntentLogRow, args: CliArgs, summary: ReplaySummary): Promise<void> {
  summary.processed += 1;

  const contextObservation = await lookupContextObservation(row.telegram_chat_id, row.telegram_message_id);
  const labels = contextObservation?.labels ?? [];
  const caseKinds = deriveCaseKinds({
    intentStatus: row.status,
    actionId: row.action_id,
    labels,
  });

  if (caseKinds.length === 0) {
    summary.skippedNoCaseKind += 1;
    console.log(
      `${LOG_PREFIX} SKIP: intent_log_id=${row.id} reason=no_case_kind status=${row.status} labels=${labels.length}`
    );
    return;
  }

  const existingCaseKinds = await lookupExistingCaseKinds(row.id);
  const missingCaseKinds = caseKinds.filter((caseKind) => !existingCaseKinds.has(caseKind));
  summary.skippedExisting += caseKinds.length - missingCaseKinds.length;

  if (missingCaseKinds.length === 0) {
    console.log(
      `${LOG_PREFIX} SKIP: intent_log_id=${row.id} reason=existing_cases case_kinds=${formatKinds(caseKinds)}`
    );
    return;
  }

  let snapshotId = await lookupExistingSnapshotId(row.id);
  const labelSummary = buildLabelSummary(labels);
  const telegramMessageId = parseTelegramMessageId(row.telegram_message_id);

  if (!snapshotId) {
    if (args.dryRun) {
      summary.insertedSnapshots += 1;
    } else {
      const snapshot = await insertTrainingPeaksStudentContextSnapshot({
        studentId: row.student_id,
        sourceIntentLogId: row.id,
        cacheStatus: "empty",
        labelSummary,
      });
      snapshotId = snapshot.id;
      summary.insertedSnapshots += 1;
    }
  }

  if (args.dryRun) {
    summary.insertedCases += missingCaseKinds.length;
    console.log(
      `${LOG_PREFIX} DRY: intent_log_id=${row.id} case_kinds=${formatKinds(missingCaseKinds)} snapshot=${
        snapshotId ? "reuse" : "new"
      } labels=${labels.length} context_labels=${formatKinds(labels)}`
    );
    return;
  }

  let insertedForRow = 0;
  for (const caseKind of missingCaseKinds) {
    const inserted = await insertTrainingPeaksCoachCase({
      studentId: row.student_id,
      caseKind,
      intentLogId: row.id,
      actionId: row.action_id,
      contextObsId: contextObservation?.id ?? null,
      snapshotId,
      telegramChatId: row.telegram_chat_id,
      telegramMessageId,
    });

    if (!inserted) {
      summary.skippedExisting += 1;
      continue;
    }

    insertedForRow += 1;
    summary.insertedCases += 1;
  }

  console.log(
    `${LOG_PREFIX} OK: intent_log_id=${row.id} inserted_cases=${insertedForRow} snapshot=${
      snapshotId ? "ready" : "missing"
    } case_kinds=${formatKinds(missingCaseKinds)} labels=${labels.length} context_labels=${formatKinds(labels)}`
  );
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!ensureSupabaseEnv()) {
    return;
  }

  const summary: ReplaySummary = {
    processed: 0,
    insertedCases: 0,
    insertedSnapshots: 0,
    skippedExisting: 0,
    skippedNoCaseKind: 0,
    failed: 0,
  };

  let offset = 0;

  while (true) {
    const page = await fetchIntentLogPage(offset, args.since);
    if (page.length === 0) {
      break;
    }

    for (const row of page) {
      try {
        await replayIntentLog(row, args, summary);
      } catch (error) {
        summary.failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`${LOG_PREFIX} FAIL: intent_log_id=${row.id} ${message}`);
      }
    }

    if (page.length < PAGE_SIZE) {
      break;
    }

    offset += page.length;
  }

  printSummary(summary);
}

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.startsWith(`${LOG_PREFIX} FAIL:`) ? message : `${LOG_PREFIX} FAIL: ${message}`);
  process.exit(1);
});
