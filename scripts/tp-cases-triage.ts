import process from "node:process";

import { createSupabaseServerClient } from "@/features/supabase/server";
import type { TrainingPeaksCoachCaseKind, TrainingPeaksCoachCaseStatus } from "@/features/trainingpeaks/repository";

const LOG_PREFIX = "[tp-cases-triage]";
const PAGE_SIZE = 500;
const SINCE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const CASE_KINDS: readonly TrainingPeaksCoachCaseKind[] = [
  "move_workout_requested",
  "move_workout_needs_review",
  "question_to_coach",
  "pain_or_health_signal",
  "unrecognized_intent",
  "observation_only",
];

const ATTENTION_DB_CASE_KINDS: readonly TrainingPeaksCoachCaseKind[] = [
  "pain_or_health_signal",
  "question_to_coach",
  "move_workout_needs_review",
  "move_workout_requested",
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
  "athlete_url",
  "email",
  "phone",
] as const;

type CliOptions = {
  attention: boolean;
  limit: number;
  status?: TrainingPeaksCoachCaseStatus;
  caseKind?: TrainingPeaksCoachCaseKind;
  studentId?: string;
  since?: string;
  summaryOnly: boolean;
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
  const options: CliOptions = { attention: false, limit: 20, summaryOnly: false };

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

    if (arg.startsWith("--since=")) {
      const value = arg.slice("--since=".length).trim();
      if (!SINCE_PATTERN.test(value)) {
        throw new Error(`${LOG_PREFIX} FAIL: invalid --since value, expected YYYY-MM-DD`);
      }
      options.since = value;
      continue;
    }

    if (arg === "--since") {
      const value = parseNextValue(argv, index, "--since");
      if (!SINCE_PATTERN.test(value)) {
        throw new Error(`${LOG_PREFIX} FAIL: invalid --since value, expected YYYY-MM-DD`);
      }
      options.since = value;
      index += 1;
      continue;
    }

    if (arg === "--summary-only") {
      options.summaryOnly = true;
      continue;
    }

    if (arg === "--attention") {
      options.attention = true;
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

function safeError(line: string): void {
  assertSafeOutput(line);
  console.error(line);
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

function sinceStartIso(since: string): string {
  return `${since}T00:00:00.000Z`;
}

function resolveQueryCaseKinds(options: CliOptions): TrainingPeaksCoachCaseKind[] | null {
  if (!options.attention) {
    return options.caseKind ? [options.caseKind] : null;
  }

  if (options.caseKind) {
    return ATTENTION_DB_CASE_KINDS.includes(options.caseKind) ? [options.caseKind] : [];
  }

  return [...ATTENTION_DB_CASE_KINDS];
}

function isAttentionCase(row: CoachCaseRow): boolean {
  switch (row.case_kind) {
    case "pain_or_health_signal":
    case "question_to_coach":
    case "move_workout_needs_review":
      return true;
    case "move_workout_requested":
      // Normal move requests are already handled by linked action flow.
      return !row.intent_log_id || !row.action_id || !row.snapshot_id;
    case "unrecognized_intent":
    case "observation_only":
      return false;
    default: {
      const exhaustiveCheck: never = row.case_kind;
      return exhaustiveCheck;
    }
  }
}

function applyAttentionFilter(rows: readonly CoachCaseRow[]): CoachCaseRow[] {
  return rows.filter((row) => isAttentionCase(row));
}

function chunkArray<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function formatCountLine<T extends string>(prefix: string, keys: readonly T[], counter: Record<T, number>): string {
  return `${LOG_PREFIX} ${prefix} ${keys.map((key) => `${key}=${counter[key]}`).join(" ")}`;
}

function formatPercent(numerator: number, denominator: number): string {
  if (denominator <= 0) {
    return "0%";
  }
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function formatCoverageLine(
  prefix: string,
  valuesByKind: Record<TrainingPeaksCoachCaseKind, number>,
  totalsByKind: Record<TrainingPeaksCoachCaseKind, number>
): string {
  return `${LOG_PREFIX} ${prefix} ${CASE_KINDS.map((kind) => `${kind}=${formatPercent(valuesByKind[kind], totalsByKind[kind])}`).join(" ")}`;
}

function detectCluster(rows: readonly CoachCaseRow[]): { count: number; firstCreatedAt: string } | null {
  if (rows.length < 3) {
    return null;
  }

  const sorted = [...rows].sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at));
  let bestCount = 0;
  let bestStartIndex = -1;
  let windowStartIndex = 0;

  for (let windowEndIndex = 0; windowEndIndex < sorted.length; windowEndIndex += 1) {
    const windowEndTime = Date.parse(sorted[windowEndIndex].created_at);
    while (windowStartIndex <= windowEndIndex) {
      const windowStartTime = Date.parse(sorted[windowStartIndex].created_at);
      if (!Number.isFinite(windowEndTime) || !Number.isFinite(windowStartTime) || windowEndTime - windowStartTime <= 86_400_000) {
        break;
      }
      windowStartIndex += 1;
    }

    const windowCount = windowEndIndex - windowStartIndex + 1;
    if (windowCount > bestCount) {
      bestCount = windowCount;
      bestStartIndex = windowStartIndex;
    }
  }

  if (bestCount < 3 || bestStartIndex < 0) {
    return null;
  }

  return {
    count: bestCount,
    firstCreatedAt: sorted[bestStartIndex].created_at,
  };
}

async function fetchMatchingCasesPage(options: CliOptions, offset: number, limit: number): Promise<CoachCaseRow[]> {
  const supabase = createSupabaseServerClient();
  const queryCaseKinds = resolveQueryCaseKinds(options);
  if (queryCaseKinds && queryCaseKinds.length === 0) {
    return [];
  }

  let query = supabase
    .from("trainingpeaks_coach_cases")
    .select("id, student_id, case_kind, status, created_at, intent_log_id, action_id, snapshot_id")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit - 1);

  if (options.status) {
    query = query.eq("status", options.status);
  }
  if (queryCaseKinds?.length === 1) {
    query = query.eq("case_kind", queryCaseKinds[0]);
  }
  if (queryCaseKinds && queryCaseKinds.length > 1) {
    query = query.in("case_kind", queryCaseKinds);
  }
  if (options.studentId) {
    query = query.eq("student_id", options.studentId);
  }
  if (options.since) {
    query = query.gte("created_at", sinceStartIso(options.since));
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`${LOG_PREFIX} FAIL: ${error.message}`);
  }

  return (data as CoachCaseRow[] | null) ?? [];
}

async function fetchAllMatchingCases(options: CliOptions): Promise<CoachCaseRow[]> {
  const allRows: CoachCaseRow[] = [];
  let offset = 0;

  while (true) {
    const page = await fetchMatchingCasesPage(options, offset, PAGE_SIZE);
    allRows.push(...page);

    if (page.length < PAGE_SIZE) {
      return allRows;
    }

    offset += page.length;
  }
}

async function fetchMatchingCasesWindow(options: CliOptions): Promise<CoachCaseRow[]> {
  if (!options.attention) {
    return fetchMatchingCasesPage(options, 0, options.limit);
  }

  const windowRows: CoachCaseRow[] = [];
  let offset = 0;

  while (windowRows.length < options.limit) {
    const page = await fetchMatchingCasesPage(options, offset, PAGE_SIZE);
    if (page.length === 0) {
      break;
    }

    const attentionPage = applyAttentionFilter(page);
    for (const row of attentionPage) {
      windowRows.push(row);
      if (windowRows.length >= options.limit) {
        return windowRows;
      }
    }

    if (page.length < PAGE_SIZE) {
      break;
    }

    offset += page.length;
  }

  return windowRows;
}

async function fetchStudentNamesById(studentIds: readonly string[]): Promise<Map<string, string>> {
  const supabase = createSupabaseServerClient();
  const studentNamesById = new Map<string, string>();

  for (const chunk of chunkArray(studentIds, PAGE_SIZE)) {
    const { data, error } = await supabase.from("trainingpeaks_students").select("id, student_name").in("id", chunk);
    if (error) {
      throw new Error(`${LOG_PREFIX} FAIL: ${error.message}`);
    }
    for (const row of ((data as StudentRow[] | null) ?? [])) {
      studentNamesById.set(row.id, row.student_name);
    }
  }

  return studentNamesById;
}

async function fetchSnapshotLabelKeysById(snapshotIds: readonly string[]): Promise<Map<string, string[]>> {
  const supabase = createSupabaseServerClient();
  const snapshotLabelKeysById = new Map<string, string[]>();

  for (const chunk of chunkArray(snapshotIds, PAGE_SIZE)) {
    const { data, error } = await supabase
      .from("trainingpeaks_student_context_snapshots")
      .select("id, label_summary")
      .in("id", chunk);
    if (error) {
      throw new Error(`${LOG_PREFIX} FAIL: ${error.message}`);
    }
    for (const row of ((data as SnapshotRow[] | null) ?? [])) {
      snapshotLabelKeysById.set(row.id, extractLabelSummaryKeys(row.label_summary));
    }
  }

  return snapshotLabelKeysById;
}

async function printSummaryOnly(options: CliOptions): Promise<void> {
  const matchingCases = await fetchAllMatchingCases(options);
  const cases = options.attention ? applyAttentionFilter(matchingCases) : matchingCases;
  if (options.attention && cases.length === 0) {
    safeLog(`${LOG_PREFIX} no_attention_cases`);
    return;
  }

  const byCaseKind = initCounter(CASE_KINDS);
  const byStatus = initCounter(STATUSES);
  const intentLinkedByCaseKind = initCounter(CASE_KINDS);
  const actionLinkedByCaseKind = initCounter(CASE_KINDS);
  const snapshotLinkedByCaseKind = initCounter(CASE_KINDS);

  const studentIds = [...new Set(cases.map((row) => row.student_id).filter(Boolean))];
  const snapshotIds = [...new Set(cases.map((row) => row.snapshot_id).filter((value): value is string => Boolean(value)))];
  const studentNamesById = studentIds.length > 0 ? await fetchStudentNamesById(studentIds) : new Map<string, string>();
  const snapshotLabelKeysById = snapshotIds.length > 0 ? await fetchSnapshotLabelKeysById(snapshotIds) : new Map<string, string[]>();
  const labelCounts = new Map<string, number>();
  const clustersByStudentAndKind = new Map<string, CoachCaseRow[]>();

  for (const row of cases) {
    byCaseKind[row.case_kind] += 1;
    byStatus[row.status] += 1;

    if (row.intent_log_id) {
      intentLinkedByCaseKind[row.case_kind] += 1;
    }
    if (row.action_id) {
      actionLinkedByCaseKind[row.case_kind] += 1;
    }
    if (row.snapshot_id) {
      snapshotLinkedByCaseKind[row.case_kind] += 1;
      for (const label of snapshotLabelKeysById.get(row.snapshot_id) ?? []) {
        labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
      }
    }

    const clusterKey = `${row.student_id}::${row.case_kind}`;
    const clusterRows = clustersByStudentAndKind.get(clusterKey) ?? [];
    clusterRows.push(row);
    clustersByStudentAndKind.set(clusterKey, clusterRows);
  }

  safeLog(`${LOG_PREFIX} total_cases=${cases.length}`);
  safeLog(formatCountLine("by_case_kind", CASE_KINDS, byCaseKind));
  safeLog(formatCountLine("by_status", STATUSES, byStatus));
  safeLog(formatCoverageLine("coverage_intent_linked", intentLinkedByCaseKind, byCaseKind));
  safeLog(formatCoverageLine("coverage_action_linked", actionLinkedByCaseKind, byCaseKind));
  safeLog(formatCoverageLine("coverage_snapshot_linked", snapshotLinkedByCaseKind, byCaseKind));

  const topLabels = [...labelCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 10);
  if (topLabels.length === 0) {
    safeLog(`${LOG_PREFIX} top_labels none`);
  } else {
    safeLog(`${LOG_PREFIX} top_labels ${topLabels.map(([label, count]) => `${label}=${count}`).join(" ")}`);
  }

  const clusterLines: string[] = [];
  for (const rows of clustersByStudentAndKind.values()) {
    const cluster = detectCluster(rows);
    if (!cluster) {
      continue;
    }

    const sample = rows[0];
    const studentName = studentNamesById.get(sample.student_id) ?? "—";
    clusterLines.push(
      `${LOG_PREFIX} cluster_alert student=${JSON.stringify(studentName)} kind=${sample.case_kind} count=${cluster.count} window=24h first=${formatRelativeAge(cluster.firstCreatedAt)}`
    );
  }

  if (clusterLines.length === 0) {
    safeLog(`${LOG_PREFIX} cluster_alert none`);
    return;
  }

  clusterLines.sort((left, right) => left.localeCompare(right));
  for (const line of clusterLines) {
    safeLog(line);
  }
}

async function run(): Promise<void> {
  const supabaseUrl = getEnvValue("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = getEnvValue("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    safeLog(`${LOG_PREFIX} SKIP: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY`);
    return;
  }

  if (!process.env.SUPABASE_URL) {
    process.env.SUPABASE_URL = supabaseUrl;
  }

  const options = parseCliOptions(process.argv.slice(2));
  if (options.attention) {
    safeLog(`${LOG_PREFIX} mode=attention`);
  }

  if (options.summaryOnly) {
    await printSummaryOnly(options);
    return;
  }

  const cases = await fetchMatchingCasesWindow(options);
  if (options.attention && cases.length === 0) {
    safeLog(`${LOG_PREFIX} no_attention_cases`);
    return;
  }

  const studentIds = [...new Set(cases.map((row) => row.student_id).filter(Boolean))];
  const snapshotIds = [...new Set(cases.map((row) => row.snapshot_id).filter((value): value is string => Boolean(value)))];
  const studentNamesById = studentIds.length > 0 ? await fetchStudentNamesById(studentIds) : new Map<string, string>();
  const snapshotLabelKeysById =
    snapshotIds.length > 0 ? await fetchSnapshotLabelKeysById(snapshotIds) : new Map<string, string[]>();

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

  safeLog(`${LOG_PREFIX} total_cases_window=${cases.length}`);
  safeLog(formatCountLine("by_case_kind_window", CASE_KINDS, byCaseKind));
  safeLog(formatCountLine("by_status_window", STATUSES, byStatus));
  safeLog(`${LOG_PREFIX} note=window_scoped_use_summary_only_for_global_counts`);
}

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith(`${LOG_PREFIX} FAIL:`)) {
    safeError(message);
  } else {
    safeError(`${LOG_PREFIX} FAIL: ${message}`);
  }
  process.exit(1);
});
