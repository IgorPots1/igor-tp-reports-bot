import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import type { PostgrestError } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/features/supabase/server";

const LOG_PREFIX = "[check-trainingpeaks-context-coverage]";
const DEFAULT_DAYS = 7;
const TOP_LABEL_LIMIT = 12;

type CliOptions = {
  days: number;
  studentQuery: string | null;
  json: boolean;
};

type StudentRow = {
  id: string;
  student_id: string;
  student_name: string;
  is_active: boolean;
  telegram_chat_id: string | null;
  telegram_delivery_enabled: boolean;
};

type ThreadRow = {
  student_id: string;
};

type BusinessChatRow = {
  chat_id: string;
};

type ObservationRow = {
  id: string;
  student_id: string | null;
  source_type: string;
  labels: unknown;
  observed_at: string;
};

type ContactEventRow = {
  student_id: string;
  event_type: string;
  occurred_at: string;
};

type ContactStatusRow = {
  student_id: string;
  silence_days: number | null;
  unanswered_seconds: number | null;
  last_athlete_message_at: string | null;
  last_coach_touch_at: string | null;
};

type CaseRow = {
  id: string;
  student_id: string;
  status: string;
  case_kind: string;
  created_at: string;
  action_id: string | null;
  intent_log_id: string | null;
  context_obs_id: string | null;
  snapshot_id: string | null;
};

type DraftRow = {
  id: string;
  student_id: string;
  case_id: string | null;
  outcome: string;
  metadata: unknown;
  created_at: string;
};

type IntentLogRow = {
  id: string;
  student_id: string | null;
  status: string;
  created_at: string;
};

type SnapshotRow = {
  id: string;
  student_id: string | null;
  missed_planned_dates: unknown;
  created_at: string;
};

type CountByKey = Record<string, number>;

function loadLocalEnvFiles(): void {
  const repoRoot = path.resolve(process.cwd());
  const envPaths = [path.join(repoRoot, ".env.local"), path.join(repoRoot, ".env")];

  for (const envPath of envPaths) {
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
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      process.env[key] = value;
    }
  }
}

function getEnvValue(name: "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    days: DEFAULT_DAYS,
    studentQuery: null,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg.startsWith("--days=")) {
      const rawValue = arg.slice("--days=".length).trim();
      const parsed = Number(rawValue);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`${LOG_PREFIX} FAIL: invalid --days value: ${rawValue}`);
      }
      options.days = Math.floor(parsed);
      continue;
    }

    if (arg === "--days") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --days`);
      }
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`${LOG_PREFIX} FAIL: invalid --days value: ${next}`);
      }
      options.days = Math.floor(parsed);
      index += 1;
      continue;
    }

    if (arg.startsWith("--student=")) {
      const value = arg.slice("--student=".length).trim();
      options.studentQuery = value || null;
      continue;
    }

    if (arg === "--student") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --student`);
      }
      options.studentQuery = next;
      index += 1;
    }
  }

  return options;
}

function isMissingRelationError(error: PostgrestError): boolean {
  const code = (error.code ?? "").toUpperCase();
  const message = (error.message ?? "").toLowerCase();
  return (
    code === "PGRST205" ||
    code === "42P01" ||
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("could not find the table")
  );
}

function getIsoSince(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function coerceLabelArray(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const labels: string[] = [];
  for (const item of input) {
    if (typeof item === "string") {
      const normalized = item.trim();
      if (normalized) {
        labels.push(normalized);
      }
    }
  }
  return labels;
}

function toObject(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  return input as Record<string, unknown>;
}

function incrementBucket(buckets: CountByKey, key: string): void {
  buckets[key] = (buckets[key] ?? 0) + 1;
}

function sortBucketsDesc(buckets: CountByKey): Array<[string, number]> {
  return Object.entries(buckets).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function pickTopBuckets(buckets: CountByKey, limit: number): Array<[string, number]> {
  return sortBucketsDesc(buckets).slice(0, limit);
}

function toDateMs(iso: string): number {
  return new Date(iso).getTime();
}

function isOnOrAfter(iso: string, thresholdIso: string): boolean {
  return toDateMs(iso) >= toDateMs(thresholdIso);
}

function compactStudentRef(student: StudentRow): string {
  const idPrefix = student.id.slice(0, 8);
  return `${student.student_id} (${idPrefix})`;
}

function printSection(title: string): void {
  console.log("");
  console.log(`${LOG_PREFIX} ${title}`);
}

function printMetric(name: string, value: number | string): void {
  console.log(`${LOG_PREFIX} ${name}=${value}`);
}

function extractDraftMetadataFlags(row: DraftRow): {
  origin: string | null;
  sendStatus: string | null;
} {
  const metadata = toObject(row.metadata);
  const originRaw = metadata?.origin;
  const origin = typeof originRaw === "string" ? originRaw.trim() : null;

  const sendObj = toObject(metadata?.send);
  const sendStatusRaw = sendObj?.status;
  const sendStatus = typeof sendStatusRaw === "string" ? sendStatusRaw.trim() : null;

  return { origin, sendStatus };
}

function likelyNoiseLabel(label: string): boolean {
  const normalized = label.toLowerCase();
  return (
    normalized.includes("ack") ||
    normalized.includes("skip") ||
    normalized.includes("noise") ||
    normalized.includes("irrelevant") ||
    normalized.includes("small_talk") ||
    normalized.includes("small-talk") ||
    normalized.includes("emoji")
  );
}

async function fetchStudents(): Promise<StudentRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .select("id, student_id, student_name, is_active, telegram_chat_id, telegram_delivery_enabled");

  if (error) {
    throw new Error(`${LOG_PREFIX} FAIL: trainingpeaks_students: ${error.message}`);
  }

  return (data as StudentRow[] | null) ?? [];
}

async function fetchStudentThreads(): Promise<ThreadRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.from("trainingpeaks_student_threads").select("student_id");
  if (error) {
    if (isMissingRelationError(error)) {
      return [];
    }
    throw new Error(`${LOG_PREFIX} FAIL: trainingpeaks_student_threads: ${error.message}`);
  }
  return (data as ThreadRow[] | null) ?? [];
}

async function fetchBusinessChats(): Promise<BusinessChatRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.from("trainingpeaks_telegram_business_chats").select("chat_id");
  if (error) {
    if (isMissingRelationError(error)) {
      return [];
    }
    throw new Error(`${LOG_PREFIX} FAIL: trainingpeaks_telegram_business_chats: ${error.message}`);
  }
  return (data as BusinessChatRow[] | null) ?? [];
}

async function fetchObservations(sinceIso: string): Promise<ObservationRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_telegram_context_observations")
    .select("id, student_id, source_type, labels, observed_at")
    .gte("observed_at", sinceIso);

  if (error) {
    if (isMissingRelationError(error)) {
      return [];
    }
    throw new Error(`${LOG_PREFIX} FAIL: trainingpeaks_telegram_context_observations: ${error.message}`);
  }
  return (data as ObservationRow[] | null) ?? [];
}

async function fetchContactEvents(sinceIso: string): Promise<ContactEventRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_student_contact_events")
    .select("student_id, event_type, occurred_at")
    .gte("occurred_at", sinceIso);

  if (error) {
    if (isMissingRelationError(error)) {
      return [];
    }
    throw new Error(`${LOG_PREFIX} FAIL: trainingpeaks_student_contact_events: ${error.message}`);
  }
  return (data as ContactEventRow[] | null) ?? [];
}

async function fetchContactStatus(): Promise<ContactStatusRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_student_contact_status")
    .select("student_id, silence_days, unanswered_seconds, last_athlete_message_at, last_coach_touch_at");

  if (error) {
    if (isMissingRelationError(error)) {
      return [];
    }
    throw new Error(`${LOG_PREFIX} FAIL: trainingpeaks_student_contact_status: ${error.message}`);
  }
  return (data as ContactStatusRow[] | null) ?? [];
}

async function fetchCases(sinceIso: string): Promise<CaseRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_coach_cases")
    .select("id, student_id, status, case_kind, created_at, action_id, intent_log_id, context_obs_id, snapshot_id")
    .gte("created_at", sinceIso);

  if (error) {
    if (isMissingRelationError(error)) {
      return [];
    }
    throw new Error(`${LOG_PREFIX} FAIL: trainingpeaks_coach_cases: ${error.message}`);
  }
  return (data as CaseRow[] | null) ?? [];
}

async function fetchAllCasesCurrent(): Promise<CaseRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_coach_cases")
    .select("id, student_id, status, case_kind, created_at, action_id, intent_log_id, context_obs_id, snapshot_id");

  if (error) {
    if (isMissingRelationError(error)) {
      return [];
    }
    throw new Error(`${LOG_PREFIX} FAIL: trainingpeaks_coach_cases(all): ${error.message}`);
  }
  return (data as CaseRow[] | null) ?? [];
}

async function fetchDrafts(sinceIso: string): Promise<DraftRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_reply_drafts")
    .select("id, student_id, case_id, outcome, metadata, created_at")
    .gte("created_at", sinceIso);

  if (error) {
    if (isMissingRelationError(error)) {
      return [];
    }
    throw new Error(`${LOG_PREFIX} FAIL: trainingpeaks_reply_drafts: ${error.message}`);
  }
  return (data as DraftRow[] | null) ?? [];
}

async function fetchIntentLogs(sinceIso: string): Promise<IntentLogRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_message_intent_logs")
    .select("id, student_id, status, created_at")
    .gte("created_at", sinceIso);

  if (error) {
    if (isMissingRelationError(error)) {
      return [];
    }
    throw new Error(`${LOG_PREFIX} FAIL: trainingpeaks_message_intent_logs: ${error.message}`);
  }
  return (data as IntentLogRow[] | null) ?? [];
}

async function fetchSnapshots(sinceIso: string): Promise<SnapshotRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_student_context_snapshots")
    .select("id, student_id, missed_planned_dates, created_at")
    .gte("created_at", sinceIso);

  if (error) {
    if (isMissingRelationError(error)) {
      return [];
    }
    throw new Error(`${LOG_PREFIX} FAIL: trainingpeaks_student_context_snapshots: ${error.message}`);
  }
  return (data as SnapshotRow[] | null) ?? [];
}

async function countPendingMoveActions(): Promise<number> {
  const supabase = createSupabaseServerClient();
  const query = supabase
    .from("trainingpeaks_actions")
    .select("id", { count: "exact", head: true })
    .eq("action_type", "move_workout")
    .or(
      "status.eq.pending_coach,execution_status.eq.execute_pending,execution_status.eq.running_local,execution_status.eq.dry_run_running"
    );
  const { count, error } = await query;

  if (error) {
    if (isMissingRelationError(error)) {
      return 0;
    }
    throw new Error(`${LOG_PREFIX} FAIL: trainingpeaks_actions pending: ${error.message}`);
  }
  return count ?? 0;
}

async function countFailedActions(): Promise<number> {
  const supabase = createSupabaseServerClient();
  const { count, error } = await supabase
    .from("trainingpeaks_actions")
    .select("id", { count: "exact", head: true })
    .eq("execution_status", "failed");

  if (error) {
    if (isMissingRelationError(error)) {
      return 0;
    }
    throw new Error(`${LOG_PREFIX} FAIL: trainingpeaks_actions failed: ${error.message}`);
  }
  return count ?? 0;
}

function formatPercent(numerator: number, denominator: number): string {
  if (denominator <= 0) {
    return "n/a";
  }
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function runStudentProbe(
  query: string,
  students: StudentRow[],
  observationRows: ObservationRow[],
  contactStatuses: ContactStatusRow[],
  currentCases: CaseRow[],
  draftsInRange: DraftRow[]
): string {
  const lowered = query.toLowerCase();
  const student = students.find((row) => {
    return (
      row.student_id.toLowerCase().includes(lowered) ||
      row.student_name.toLowerCase().includes(lowered) ||
      row.id.toLowerCase().startsWith(lowered)
    );
  });
  if (!student) {
    return `${LOG_PREFIX} student_probe=not_found query=${JSON.stringify(query)}`;
  }

  const hasObs = observationRows.some((row) => row.student_id === student.id);
  const status = contactStatuses.find((row) => row.student_id === student.id) ?? null;
  const openCaseCount = currentCases.filter(
    (row) => row.student_id === student.id && (row.status === "open" || row.status === "needs_review" || row.status === "logged")
  ).length;
  const draftCount = draftsInRange.filter((row) => row.student_id === student.id).length;

  return `${LOG_PREFIX} student_probe=${compactStudentRef(student)} active=${student.is_active ? "yes" : "no"} telegram_linked=${student.telegram_chat_id ? "yes" : "no"} delivery_enabled=${student.telegram_delivery_enabled ? "yes" : "no"} observed_recently=${hasObs ? "yes" : "no"} open_cases=${openCaseCount} drafts_in_window=${draftCount} silence_days=${status?.silence_days ?? "n/a"} unanswered_hours=${status?.unanswered_seconds ? Math.floor(status.unanswered_seconds / 3600) : "n/a"}`;
}

async function run(): Promise<void> {
  loadLocalEnvFiles();
  const options = parseCliOptions(process.argv.slice(2));

  const supabaseUrl = getEnvValue("NEXT_PUBLIC_SUPABASE_URL") ?? getEnvValue("SUPABASE_URL");
  const serviceRoleKey = getEnvValue("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.log(`${LOG_PREFIX} SKIP: missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY`);
    return;
  }

  if (!process.env.SUPABASE_URL) {
    process.env.SUPABASE_URL = supabaseUrl;
  }

  const daysWindow = options.days;
  const maxWindow = Math.max(daysWindow, 30);
  const sinceDays = getIsoSince(daysWindow);
  const since7 = getIsoSince(7);
  const since30 = getIsoSince(30);
  const sinceMax = getIsoSince(maxWindow);

  const [
    students,
    threads,
    businessChats,
    observationsAll,
    contactEventsAll,
    contactStatuses,
    casesCurrent,
    casesInMax,
    draftsInMax,
    intentLogsInMax,
    snapshotsInMax,
    pendingMoveActions,
    failedActions,
  ] = await Promise.all([
    fetchStudents(),
    fetchStudentThreads(),
    fetchBusinessChats(),
    fetchObservations(sinceMax),
    fetchContactEvents(sinceMax),
    fetchContactStatus(),
    fetchAllCasesCurrent(),
    fetchCases(sinceMax),
    fetchDrafts(sinceMax),
    fetchIntentLogs(sinceMax),
    fetchSnapshots(sinceMax),
    countPendingMoveActions(),
    countFailedActions(),
  ]);

  const activeStudents = students.filter((row) => row.is_active);
  const inactiveStudents = students.filter((row) => !row.is_active);

  const threadStudentIds = new Set(threads.map((row) => row.student_id));
  const businessChatIds = new Set(businessChats.map((row) => row.chat_id));
  const studentsWithBusinessCaptured = students.filter(
    (row) => row.telegram_chat_id && businessChatIds.has(row.telegram_chat_id)
  ).length;

  const observations7 = observationsAll.filter((row) => isOnOrAfter(row.observed_at, since7));
  const observations30 = observationsAll.filter((row) => isOnOrAfter(row.observed_at, since30));
  const observationsDays = observationsAll.filter((row) => isOnOrAfter(row.observed_at, sinceDays));

  const sourceTypeCounts: CountByKey = {};
  const labelCounts: CountByKey = {};
  let likelyNoiseCount = 0;
  for (const row of observationsDays) {
    incrementBucket(sourceTypeCounts, row.source_type || "unknown");
    const labels = coerceLabelArray(row.labels);
    let rowLooksNoisy = false;
    for (const label of labels) {
      incrementBucket(labelCounts, label);
      if (likelyNoiseLabel(label)) {
        rowLooksNoisy = true;
      }
    }
    if (rowLooksNoisy) {
      likelyNoiseCount += 1;
    }
  }

  const contact7 = contactEventsAll.filter((row) => isOnOrAfter(row.occurred_at, since7));
  const contact7Students = new Set(contact7.map((row) => row.student_id));
  const coachTouch7Students = new Set(
    contact7
      .filter((row) => row.event_type === "coach_message" || row.event_type === "report_sent" || row.event_type === "coach_action_decision")
      .map((row) => row.student_id)
  );
  const silentOver5Days = contactStatuses.filter((row) => (row.silence_days ?? -1) > 5).length;
  const unansweredOver24h = contactStatuses.filter((row) => (row.unanswered_seconds ?? -1) >= 24 * 3600).length;
  const noContactEver = contactStatuses.filter(
    (row) => !row.last_athlete_message_at && !row.last_coach_touch_at
  ).length;

  const openStatuses = new Set(["open", "needs_review", "logged"]);
  const closedStatuses = new Set(["resolved", "dismissed"]);

  const openCasesCurrent = casesCurrent.filter((row) => openStatuses.has(row.status)).length;
  const resolvedDismissedCurrent = casesCurrent.filter((row) => closedStatuses.has(row.status)).length;

  const caseKindCounts: CountByKey = {};
  for (const row of casesCurrent) {
    incrementBucket(caseKindCounts, row.case_kind || "unknown");
  }

  const cases7 = casesInMax.filter((row) => isOnOrAfter(row.created_at, since7));
  const casesDays = casesInMax.filter((row) => isOnOrAfter(row.created_at, sinceDays));
  const casesLinkedAction = casesCurrent.filter((row) => row.action_id != null).length;
  const casesLinkedIntent = casesCurrent.filter((row) => row.intent_log_id != null).length;
  const casesLinkedObs = casesCurrent.filter((row) => row.context_obs_id != null).length;
  const casesLinkedSnapshot = casesCurrent.filter((row) => row.snapshot_id != null).length;

  const drafts7 = draftsInMax.filter((row) => isOnOrAfter(row.created_at, since7));
  const draftsDays = draftsInMax.filter((row) => isOnOrAfter(row.created_at, sinceDays));
  const draftOutcomeCounts: CountByKey = {};
  let voiceOriginDrafts = 0;
  let sentDrafts = 0;
  let failedSendDrafts = 0;
  for (const row of drafts7) {
    incrementBucket(draftOutcomeCounts, row.outcome || "unknown");
    const flags = extractDraftMetadataFlags(row);
    if (flags.origin === "voice") {
      voiceOriginDrafts += 1;
    }
    if (flags.sendStatus === "sent") {
      sentDrafts += 1;
    } else if (flags.sendStatus === "failed") {
      failedSendDrafts += 1;
    }
  }

  const observationIdsDays = new Set(observationsDays.map((row) => row.id));
  const casesFromObsDays = casesDays.filter((row) => row.context_obs_id && observationIdsDays.has(row.context_obs_id)).length;
  const draftsFromCasesDays = draftsDays.filter((row) => row.case_id != null).length;
  const sentDraftsDays = draftsDays.filter((row) => extractDraftMetadataFlags(row).sendStatus === "sent").length;
  const closedCasesDays = casesDays.filter((row) => closedStatuses.has(row.status)).length;

  const intent7 = intentLogsInMax.filter((row) => isOnOrAfter(row.created_at, since7));
  const intentDays = intentLogsInMax.filter((row) => isOnOrAfter(row.created_at, sinceDays));
  const intentStatusCounts: CountByKey = {};
  for (const row of intent7) {
    incrementBucket(intentStatusCounts, row.status || "unknown");
  }

  const missedWorkoutRows = snapshotsInMax.filter((row) => {
    if (!isOnOrAfter(row.created_at, sinceDays)) {
      return false;
    }
    return Array.isArray(row.missed_planned_dates) && row.missed_planned_dates.length > 0;
  });
  const missedWorkoutStudents = new Set(
    missedWorkoutRows.map((row) => row.student_id).filter((id): id is string => Boolean(id))
  );

  const activeStudentIds = new Set(activeStudents.map((row) => row.id));
  const activeWithObservation = new Set(
    observationsDays
      .map((row) => row.student_id)
      .filter((id): id is string => typeof id === "string")
      .filter((id) => activeStudentIds.has(id))
  );
  const activeWithCase = new Set(
    casesCurrent
      .filter((row) => openStatuses.has(row.status) && activeStudentIds.has(row.student_id))
      .map((row) => row.student_id)
  );
  const activeWithDraft = new Set(
    draftsDays
      .map((row) => row.student_id)
      .filter((id) => activeStudentIds.has(id))
  );
  const activeWithContact = new Set(
    contactEventsAll
      .filter((row) => isOnOrAfter(row.occurred_at, sinceDays) && activeStudentIds.has(row.student_id))
      .map((row) => row.student_id)
  );
  const activeWithSnapshot = new Set(
    snapshotsInMax
      .filter((row) => isOnOrAfter(row.created_at, sinceDays) && row.student_id && activeStudentIds.has(row.student_id))
      .map((row) => row.student_id as string)
  );

  const activeWithUsefulContext = new Set<string>([
    ...activeWithObservation,
    ...activeWithCase,
    ...activeWithDraft,
    ...activeWithContact,
    ...activeWithSnapshot,
  ]);

  const recommendations: string[] = [];
  if (observationsDays.length >= 20 && casesDays.length <= Math.max(2, Math.floor(observationsDays.length * 0.05))) {
    recommendations.push("High observation volume but low case conversion — review label thresholds.");
  }
  if (openCasesCurrent >= 10) {
    recommendations.push("Many open cases older than 7 days — case lifecycle needs cleanup.");
  }
  if ((draftOutcomeCounts.generated ?? 0) > (draftOutcomeCounts.used ?? 0) + (draftOutcomeCounts.edited ?? 0)) {
    recommendations.push("Many generated drafts remain unresolved — draft feedback/send funnel needs review.");
  }
  if (silentOver5Days > Math.max(5, Math.floor(activeStudents.length * 0.2))) {
    recommendations.push("Many silent students — contact workflow may need attention.");
  }
  if (recommendations.length === 0) {
    recommendations.push("Context coverage looks healthy.");
  }

  const reportObject = {
    mode: "read-only",
    days_window: daysWindow,
    students: {
      active_students: activeStudents.length,
      inactive_or_archived_students: inactiveStudents.length,
      students_with_telegram_chat_id: students.filter((row) => Boolean(row.telegram_chat_id)).length,
      students_with_telegram_delivery_enabled: students.filter((row) => row.telegram_delivery_enabled).length,
      students_with_group_topic_thread_link: threadStudentIds.size,
      students_with_business_chat_captured: studentsWithBusinessCaptured,
    },
    observations: {
      last_7_days: {
        total_observations: observations7.length,
        students_with_observations: new Set(
          observations7.map((row) => row.student_id).filter((id): id is string => Boolean(id))
        ).size,
      },
      last_30_days: {
        total_observations: observations30.length,
        students_with_observations: new Set(
          observations30.map((row) => row.student_id).filter((id): id is string => Boolean(id))
        ).size,
      },
      selected_window: {
        total_observations: observationsDays.length,
        students_with_observations: activeWithObservation.size,
        observations_by_source_type: sourceTypeCounts,
        observations_by_label: labelCounts,
        top_labels: pickTopBuckets(labelCounts, TOP_LABEL_LIMIT).map(([label, count]) => ({ label, count })),
        likely_noise_or_ack_skipped: likelyNoiseCount,
      },
    },
    contact_status: {
      students_with_contact_events_last_7_days: contact7Students.size,
      students_with_coach_touch_last_7_days: coachTouch7Students.size,
      silent_students_over_5_days: silentOver5Days,
      unanswered_students_over_24h: unansweredOver24h,
      students_with_no_contact_events_ever: noContactEver,
    },
    cases: {
      open_needs_review_logged: openCasesCurrent,
      resolved_dismissed: resolvedDismissedCurrent,
      by_kind: caseKindCounts,
      created_last_7_days: cases7.length,
      linked_to_action_id: casesLinkedAction,
      linked_to_intent_log_id: casesLinkedIntent,
      linked_to_context_obs_id: casesLinkedObs,
      linked_to_snapshot_id: casesLinkedSnapshot,
      resolution_rate: formatPercent(resolvedDismissedCurrent, Math.max(casesCurrent.length, 1)),
    },
    reply_drafts: {
      generated_last_7_days: drafts7.length,
      outcomes_last_7_days: draftOutcomeCounts,
      voice_origin_drafts_last_7_days: voiceOriginDrafts,
      sent_drafts_last_7_days: sentDrafts,
      failed_send_drafts_last_7_days: failedSendDrafts,
    },
    signal_to_action_funnel: {
      observations_to_cases: `${casesFromObsDays}/${observationsDays.length} (${formatPercent(
        casesFromObsDays,
        observationsDays.length
      )})`,
      cases_to_drafts: `${draftsFromCasesDays}/${casesDays.length} (${formatPercent(draftsFromCasesDays, casesDays.length)})`,
      drafts_to_sent_messages: `${sentDraftsDays}/${draftsDays.length} (${formatPercent(
        sentDraftsDays,
        draftsDays.length
      )})`,
      cases_to_resolved_or_dismissed: `${closedCasesDays}/${casesDays.length} (${formatPercent(
        closedCasesDays,
        casesDays.length
      )})`,
    },
    intent_logs: {
      logs_last_7_days: intent7.length,
      action_created: intentStatusCounts.action_created ?? 0,
      needs_review: intentStatusCounts.needs_review ?? 0,
      unrecognized: intentStatusCounts.unrecognized ?? 0,
      parse_failed: intentStatusCounts.parse_failed ?? 0,
      student_not_found: intentStatusCounts.student_not_found ?? 0,
      skipped_irrelevant: intentStatusCounts.ignored ?? 0,
      logs_selected_window: intentDays.length,
    },
    attention_digest_related: {
      current_open_attention_worthy_cases: openCasesCurrent,
      pending_move_actions: pendingMoveActions,
      failed_actions: failedActions,
      missed_workout_signals_students_in_window: missedWorkoutStudents.size,
      silent_student_fyi_count: silentOver5Days,
    },
    coverage_summary: {
      active_students_with_useful_context: activeWithUsefulContext.size,
      active_students_without_useful_context: Math.max(0, activeStudents.length - activeWithUsefulContext.size),
      active_students_with_recent_observations: activeWithObservation.size,
      active_students_silent_or_stale: silentOver5Days,
    },
    recommendations,
  };

  if (options.json) {
    console.log(JSON.stringify(reportObject, null, 2));
  } else {
    console.log(`${LOG_PREFIX} mode=read-only`);
    console.log(`${LOG_PREFIX} privacy=aggregate-only`);
    console.log(`${LOG_PREFIX} days_window=${daysWindow}`);

    printSection("1) Students");
    printMetric("active_students_count", reportObject.students.active_students);
    printMetric("inactive_or_archived_count", reportObject.students.inactive_or_archived_students);
    printMetric("students_with_telegram_chat_id", reportObject.students.students_with_telegram_chat_id);
    printMetric("students_with_telegram_delivery_enabled", reportObject.students.students_with_telegram_delivery_enabled);
    printMetric("students_with_group_topic_thread_link", reportObject.students.students_with_group_topic_thread_link);
    printMetric("students_with_business_chat_captured", reportObject.students.students_with_business_chat_captured);

    printSection("2) Context observations");
    printMetric("last_7_days_total_observations", reportObject.observations.last_7_days.total_observations);
    printMetric("last_7_days_students_with_observations", reportObject.observations.last_7_days.students_with_observations);
    printMetric("last_30_days_total_observations", reportObject.observations.last_30_days.total_observations);
    printMetric("last_30_days_students_with_observations", reportObject.observations.last_30_days.students_with_observations);
    printMetric("window_total_observations", reportObject.observations.selected_window.total_observations);
    printMetric(
      "window_students_with_observations",
      reportObject.observations.selected_window.students_with_observations
    );
    for (const [key, value] of sortBucketsDesc(reportObject.observations.selected_window.observations_by_source_type)) {
      printMetric(`window_observations_by_source_type_${key}`, value);
    }
    for (const [key, value] of pickTopBuckets(reportObject.observations.selected_window.observations_by_label, TOP_LABEL_LIMIT)) {
      printMetric(`window_top_label_${key}`, value);
    }
    printMetric(
      "window_likely_noise_or_ack_skipped",
      reportObject.observations.selected_window.likely_noise_or_ack_skipped
    );

    printSection("3) Contact status");
    printMetric("students_with_contact_events_last_7_days", reportObject.contact_status.students_with_contact_events_last_7_days);
    printMetric("students_with_coach_touch_last_7_days", reportObject.contact_status.students_with_coach_touch_last_7_days);
    printMetric("silent_students_over_5_days", reportObject.contact_status.silent_students_over_5_days);
    printMetric("unanswered_students_over_24h", reportObject.contact_status.unanswered_students_over_24h);
    printMetric("students_with_no_contact_events_ever", reportObject.contact_status.students_with_no_contact_events_ever);

    printSection("4) Cases");
    printMetric("open_needs_review_logged", reportObject.cases.open_needs_review_logged);
    printMetric("resolved_dismissed", reportObject.cases.resolved_dismissed);
    for (const [kind, value] of sortBucketsDesc(reportObject.cases.by_kind)) {
      printMetric(`cases_by_kind_${kind}`, value);
    }
    printMetric("cases_created_last_7_days", reportObject.cases.created_last_7_days);
    printMetric("cases_linked_action_id", reportObject.cases.linked_to_action_id);
    printMetric("cases_linked_intent_log_id", reportObject.cases.linked_to_intent_log_id);
    printMetric("cases_linked_context_obs_id", reportObject.cases.linked_to_context_obs_id);
    printMetric("cases_linked_snapshot_id", reportObject.cases.linked_to_snapshot_id);
    printMetric("cases_resolution_rate", reportObject.cases.resolution_rate);

    printSection("5) Reply drafts");
    printMetric("drafts_generated_last_7_days", reportObject.reply_drafts.generated_last_7_days);
    printMetric("drafts_used_last_7_days", reportObject.reply_drafts.outcomes_last_7_days.used ?? 0);
    printMetric("drafts_ignored_last_7_days", reportObject.reply_drafts.outcomes_last_7_days.ignored ?? 0);
    printMetric("drafts_edited_last_7_days", reportObject.reply_drafts.outcomes_last_7_days.edited ?? 0);
    printMetric("drafts_still_generated_last_7_days", reportObject.reply_drafts.outcomes_last_7_days.generated ?? 0);
    printMetric("voice_origin_drafts_last_7_days", reportObject.reply_drafts.voice_origin_drafts_last_7_days);
    printMetric("sent_drafts_last_7_days", reportObject.reply_drafts.sent_drafts_last_7_days);
    printMetric("failed_send_drafts_last_7_days", reportObject.reply_drafts.failed_send_drafts_last_7_days);

    printSection("6) Signal-to-action funnel");
    printMetric("observations_to_cases", reportObject.signal_to_action_funnel.observations_to_cases);
    printMetric("cases_to_drafts", reportObject.signal_to_action_funnel.cases_to_drafts);
    printMetric("drafts_to_sent_messages", reportObject.signal_to_action_funnel.drafts_to_sent_messages);
    printMetric("cases_to_resolved_or_dismissed", reportObject.signal_to_action_funnel.cases_to_resolved_or_dismissed);

    printSection("7) Intent logs");
    printMetric("logs_last_7_days", reportObject.intent_logs.logs_last_7_days);
    printMetric("intent_action_created", reportObject.intent_logs.action_created);
    printMetric("intent_needs_review", reportObject.intent_logs.needs_review);
    printMetric("intent_unrecognized", reportObject.intent_logs.unrecognized);
    printMetric("intent_parse_failed", reportObject.intent_logs.parse_failed);
    printMetric("intent_student_not_found", reportObject.intent_logs.student_not_found);
    printMetric("intent_skipped_irrelevant", reportObject.intent_logs.skipped_irrelevant);

    printSection("8) Attention/digest related");
    printMetric("current_open_attention_worthy_cases", reportObject.attention_digest_related.current_open_attention_worthy_cases);
    printMetric("pending_move_actions", reportObject.attention_digest_related.pending_move_actions);
    printMetric("failed_actions", reportObject.attention_digest_related.failed_actions);
    printMetric(
      "missed_workout_signals_students_in_window",
      reportObject.attention_digest_related.missed_workout_signals_students_in_window
    );
    printMetric("silent_student_fyi_count", reportObject.attention_digest_related.silent_student_fyi_count);

    printSection("Coverage summary");
    printMetric("active_students_with_useful_context", reportObject.coverage_summary.active_students_with_useful_context);
    printMetric("active_students_without_useful_context", reportObject.coverage_summary.active_students_without_useful_context);
    printMetric(
      "active_students_with_recent_observations",
      reportObject.coverage_summary.active_students_with_recent_observations
    );
    printMetric("active_students_silent_or_stale", reportObject.coverage_summary.active_students_silent_or_stale);

    if (options.studentQuery) {
      printSection("Student probe");
      console.log(
        runStudentProbe(
          options.studentQuery,
          students,
          observationsDays,
          contactStatuses,
          casesCurrent,
          draftsDays
        )
      );
    }

    printSection("Recommendations");
    for (const item of recommendations) {
      console.log(`${LOG_PREFIX} recommendation=${item}`);
    }

    console.log("");
    console.log(`${LOG_PREFIX} OK read-only diagnostic complete`);
  }
}

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.startsWith(`${LOG_PREFIX} FAIL:`) ? message : `${LOG_PREFIX} FAIL: ${message}`);
  process.exit(1);
});
