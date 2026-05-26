import process from "node:process";

import { createSupabaseServerClient } from "@/features/supabase/server";
import type { TrainingPeaksCoachCaseKind, TrainingPeaksCoachCaseStatus } from "@/features/trainingpeaks/repository";

const LOG_PREFIX = "[tp-cases-triage]";

const CASE_KINDS: readonly TrainingPeaksCoachCaseKind[] = [
  "move_workout_requested",
  "move_workout_needs_review",
  "question_to_coach",
  "pain_or_health_signal",
  "unrecognized_intent",
  "observation_only",
];

const STATUSES: readonly TrainingPeaksCoachCaseStatus[] = ["logged", "open", "needs_review", "resolved", "dismissed"];

const UNSAFE_OUTPUT_TOKENS = [
  "raw_text",
  "message_text",
  "text_preview",
  "text_sha256",
  "sha256",
  "telegram_chat_id",
  "telegram_message_id",
  "chat_id",
  "message_id",
  "body",
  "content",
  "prompt",
  "raw_payload",
] as const;

type CliOptions = {
  limit: number;
  status?: TrainingPeaksCoachCaseStatus;
  caseKind?: TrainingPeaksCoachCaseKind;
  studentId?: string;
};

type CoachCaseRow = {
  id: string;
  student_id: string;
  case_kind: TrainingPeaksCoachCaseKind;
  status: TrainingPeaksCoachCaseStatus;
  created_at: string;
  intent_log_id: string | null;
  action_id: string | null;
  snapshot_id: string | null;
};

type StudentRow = {
  id: string;
  student_name: string;
};

type SnapshotRow = {
  id: string;
  label_summary: unknown;
};

function getEnvValue(name: "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function parsePositiveInteger(value: string, argName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${LOG_PREFIX} FAIL: ${argName} must be a positive integer`);
  }

  return parsed;
}

function parseNextValue(argv: string[], index: number, argName: string): string {
  const next = argv[index + 1]?.trim();
  if (!next || next.startsWith("--")) {
    throw new Error(`${LOG_PREFIX} FAIL: missing value for ${argName}`);
  }
  return next;
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = { limit: 20 };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg.startsWith("--limit=")) {
      options.limit = parsePositiveInteger(arg.slice("--limit=".length), "--limit");
      continue;
    }

    if (arg === "--limit") {
      const value = parseNextValue(argv, index, "--limit");
      options.limit = parsePositiveInteger(value, "--limit");
      index += 1;
      continue;
    }

    if (arg.startsWith("--status=")) {
      const value = arg.slice("--status=".length).trim();
      if (!STATUSES.includes(value as TrainingPeaksCoachCaseStatus)) {
        throw new Error(`${LOG_PREFIX} FAIL: --status must be one of ${STATUSES.join("|")}`);
      }
      options.status = value as TrainingPeaksCoachCaseStatus;
      continue;
    }

    if (arg === "--status") {
      const value = parseNextValue(argv, index, "--status");
      if (!STATUSES.includes(value as TrainingPeaksCoachCaseStatus)) {
        throw new Error(`${LOG_PREFIX} FAIL: --status must be one of ${STATUSES.join("|")}`);
      }
      options.status = value as TrainingPeaksCoachCaseStatus;
      index += 1;
      continue;
    }

    if (arg.startsWith("--case-kind=")) {
      const value = arg.slice("--case-kind=".length).trim();
      if (!CASE_KINDS.includes(value as TrainingPeaksCoachCaseKind)) {
        throw new Error(`${LOG_PREFIX} FAIL: --case-kind must be one of ${CASE_KINDS.join("|")}`);
      }
      options.caseKind = value as TrainingPeaksCoachCaseKind;
      continue;
    }

    if (arg === "--case-kind") {
      const value = parseNextValue(argv, index, "--case-kind");
      if (!CASE_KINDS.includes(value as TrainingPeaksCoachCaseKind)) {
        throw new Error(`${LOG_PREFIX} FAIL: --case-kind must be one of ${CASE_KINDS.join("|")}`);
      }
      options.caseKind = value as TrainingPeaksCoachCaseKind;
      index += 1;
      continue;
    }

    if (arg.startsWith("--student-id=")) {
      const value = arg.slice("--student-id=".length).trim();
      if (!value) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --student-id`);
      }
      options.studentId = value;
      continue;
    }

    if (arg === "--student-id") {
      const value = parseNextValue(argv, index, "--student-id");
      options.studentId = value;
      index += 1;
      continue;
    }

    throw new Error(`${LOG_PREFIX} FAIL: unknown argument ${arg}`);
  }

  return options;
}

function yesNo(value: string | null): "yes" | "no" {
  return value ? "yes" : "no";
}

function formatRelativeAge(createdAt: string): string {
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) {
    return "unknown";
  }

  const diffMs = Math.max(0, Date.now() - timestamp);
  const diffMinutes = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMinutes < 1) {
    return "just_now";
  }
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  return `${diffDays}d ago`;
}

function assertSafeOutput(line: string): void {
  const lower = line.toLowerCase();
  for (const token of UNSAFE_OUTPUT_TOKENS) {
    if (lower.includes(token)) {
      throw new Error(`${LOG_PREFIX} FAIL: unsafe output field detected: ${token}`);
    }
  }
}

function safeLog(line: string): void {
  assertSafeOutput(line);
  console.log(line);
}

function extractLabelSummaryKeys(labelSummary: unknown): string[] {
  if (!labelSummary || typeof labelSummary !== "object" || Array.isArray(labelSummary)) {
    return [];
  }

  return Object.keys(labelSummary as Record<string, unknown>)
    .map((key) => key.trim())
    .filter((key) => key.length > 0)
    .sort((a, b) => a.localeCompare(b));
}

function initCounter<T extends string>(keys: readonly T[]): Record<T, number> {
  const counter = {} as Record<T, number>;
  for (const key of keys) {
    counter[key] = 0;
  }
  return counter;
}

async function run(): Promise<void> {
  const supabaseUrl = getEnvValue("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = getEnvValue("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.log(`${LOG_PREFIX} SKIP: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY`);
    return;
  }

  if (!process.env.SUPABASE_URL) {
    process.env.SUPABASE_URL = supabaseUrl;
  }

  const options = parseCliOptions(process.argv.slice(2));
  const supabase = createSupabaseServerClient();

  let query = supabase
    .from("trainingpeaks_coach_cases")
    .select("id, student_id, case_kind, status, created_at, intent_log_id, action_id, snapshot_id")
    .order("created_at", { ascending: false })
    .limit(options.limit);

  if (options.status) {
    query = query.eq("status", options.status);
  }
  if (options.caseKind) {
    query = query.eq("case_kind", options.caseKind);
  }
  if (options.studentId) {
    query = query.eq("student_id", options.studentId);
  }

  const { data: caseData, error: caseError } = await query;
  if (caseError) {
    throw new Error(`${LOG_PREFIX} FAIL: ${caseError.message}`);
  }

  const cases = (caseData as CoachCaseRow[] | null) ?? [];
  const studentIds = [...new Set(cases.map((row) => row.student_id).filter(Boolean))];
  const snapshotIds = [...new Set(cases.map((row) => row.snapshot_id).filter((value): value is string => Boolean(value)))];

  const studentNamesById = new Map<string, string>();
  if (studentIds.length > 0) {
    const { data, error } = await supabase.from("trainingpeaks_students").select("id, student_name").in("id", studentIds);
    if (error) {
      throw new Error(`${LOG_PREFIX} FAIL: ${error.message}`);
    }
    for (const row of ((data as StudentRow[] | null) ?? [])) {
      studentNamesById.set(row.id, row.student_name);
    }
  }

  const snapshotLabelKeysById = new Map<string, string[]>();
  if (snapshotIds.length > 0) {
    const { data, error } = await supabase
      .from("trainingpeaks_student_context_snapshots")
      .select("id, label_summary")
      .in("id", snapshotIds);
    if (error) {
      throw new Error(`${LOG_PREFIX} FAIL: ${error.message}`);
    }
    for (const row of ((data as SnapshotRow[] | null) ?? [])) {
      snapshotLabelKeysById.set(row.id, extractLabelSummaryKeys(row.label_summary));
    }
  }

  const byCaseKind = initCounter(CASE_KINDS);
  const byStatus = initCounter(STATUSES);

  for (const row of cases) {
    byCaseKind[row.case_kind] += 1;
    byStatus[row.status] += 1;

    const studentName = studentNamesById.get(row.student_id) ?? "—";
    const labels = row.snapshot_id ? snapshotLabelKeysById.get(row.snapshot_id) ?? [] : [];
    const labelsText = labels.length > 0 ? labels.join(",") : "—";

    safeLog(
      `${LOG_PREFIX} case id=${row.id} kind=${row.case_kind} status=${row.status} age=${formatRelativeAge(
        row.created_at
      )} student=${JSON.stringify(studentName)} linked=intent:${yesNo(row.intent_log_id)} action:${yesNo(
        row.action_id
      )} snapshot:${yesNo(row.snapshot_id)} labels=${labelsText}`
    );
  }

  safeLog(`${LOG_PREFIX} total_cases=${cases.length}`);
  safeLog(
    `${LOG_PREFIX} by_case_kind ${CASE_KINDS.map((caseKind) => `${caseKind}=${byCaseKind[caseKind]}`).join(" ")}`
  );
  safeLog(`${LOG_PREFIX} by_status ${STATUSES.map((status) => `${status}=${byStatus[status]}`).join(" ")}`);
}

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith(`${LOG_PREFIX} FAIL:`)) {
    console.error(message);
  } else {
    console.error(`${LOG_PREFIX} FAIL: ${message}`);
  }
  process.exit(1);
});
