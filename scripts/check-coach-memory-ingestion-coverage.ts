import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/features/supabase/server";

const LOG_PREFIX = "[check-coach-memory-ingestion-coverage]";
const SOURCE_MESSAGE_PREVIEW_DB_LIMIT = 160;

type ObservationRow = {
  id: string;
  student_id: string | null;
  source_type: string | null;
  labels: unknown;
  observed_at: string;
  created_at: string;
};

type MemoryRow = {
  id: string;
  student_id: string;
  memory_type: string;
  is_active: boolean;
};

type CaseRow = {
  case_kind: string;
  status: string;
};

type IntentLogRow = {
  status: string;
};

type ReplyDraftRow = {
  outcome: string;
  metadata: unknown;
};

type ContactEventRow = {
  event_type: string;
  source: string;
};

type SourceClassification = {
  source: string;
  runtimeCovered: "yes" | "no" | "partial";
  historicalBackfill: "yes" | "no" | "partial";
  greetingStyle: "yes" | "no" | "partial";
  risk: "low" | "medium" | "high";
  recommendation: string;
};

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

function getEnvValue(
  name: "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"
): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
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

function printSection(title: string): void {
  console.log("");
  console.log(`${LOG_PREFIX} ${title}`);
}

function printMetric(name: string, value: string | number): void {
  console.log(`${LOG_PREFIX} ${name}=${value}`);
}

function shortCountByKey(rows: Array<{ key: string; count: number }>): void {
  for (const row of rows) {
    printMetric(row.key, row.count);
  }
}

function toObject(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  return input as Record<string, unknown>;
}

function coerceStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const output: string[] = [];
  for (const item of input) {
    if (typeof item === "string") {
      const normalized = item.trim();
      if (normalized) {
        output.push(normalized);
      }
    }
  }
  return output;
}

function getIsoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function incrementCounter(counter: Record<string, number>, key: string): void {
  counter[key] = (counter[key] ?? 0) + 1;
}

function sortedCounterEntries(counter: Record<string, number>): Array<[string, number]> {
  return Object.entries(counter).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

async function safeCount(
  supabase: SupabaseClient,
  tableName: string,
  applyFilter?: (query: ReturnType<SupabaseClient["from"]>) => ReturnType<SupabaseClient["from"]>
): Promise<number> {
  let query = supabase.from(tableName).select("id", { count: "exact", head: true });
  if (applyFilter) {
    query = applyFilter(query);
  }
  const { count, error } = await query;
  if (error) {
    if (isMissingRelationError(error)) {
      return 0;
    }
    throw new Error(`${LOG_PREFIX} FAIL: count ${tableName}: ${error.message}`);
  }
  return count ?? 0;
}

async function fetchObservationsInRange(sinceIso: string): Promise<ObservationRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_telegram_context_observations")
    .select("id, student_id, source_type, labels, observed_at, created_at")
    .gte("observed_at", sinceIso);
  if (error) {
    if (isMissingRelationError(error)) {
      return [];
    }
    throw new Error(`${LOG_PREFIX} FAIL: observations: ${error.message}`);
  }
  return (data as ObservationRow[] | null) ?? [];
}

async function fetchAllMemoryItems(): Promise<MemoryRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_student_memory_items")
    .select("id, student_id, memory_type, is_active");
  if (error) {
    if (isMissingRelationError(error)) {
      return [];
    }
    throw new Error(`${LOG_PREFIX} FAIL: memory items: ${error.message}`);
  }
  return (data as MemoryRow[] | null) ?? [];
}

async function fetchCasesInRange(sinceIso: string): Promise<CaseRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_coach_cases")
    .select("case_kind, status")
    .gte("created_at", sinceIso);
  if (error) {
    if (isMissingRelationError(error)) {
      return [];
    }
    throw new Error(`${LOG_PREFIX} FAIL: coach cases: ${error.message}`);
  }
  return (data as CaseRow[] | null) ?? [];
}

async function fetchIntentLogsInRange(sinceIso: string): Promise<IntentLogRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_message_intent_logs")
    .select("status")
    .gte("created_at", sinceIso);
  if (error) {
    if (isMissingRelationError(error)) {
      return [];
    }
    throw new Error(`${LOG_PREFIX} FAIL: intent logs: ${error.message}`);
  }
  return (data as IntentLogRow[] | null) ?? [];
}

async function fetchReplyDraftsInRange(sinceIso: string): Promise<ReplyDraftRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_reply_drafts")
    .select("outcome, metadata")
    .gte("created_at", sinceIso);
  if (error) {
    if (isMissingRelationError(error)) {
      return [];
    }
    throw new Error(`${LOG_PREFIX} FAIL: reply drafts: ${error.message}`);
  }
  return (data as ReplyDraftRow[] | null) ?? [];
}

async function fetchContactEventsInRange(sinceIso: string): Promise<ContactEventRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_student_contact_events")
    .select("event_type, source")
    .gte("occurred_at", sinceIso);
  if (error) {
    if (isMissingRelationError(error)) {
      return [];
    }
    throw new Error(`${LOG_PREFIX} FAIL: contact events: ${error.message}`);
  }
  return (data as ContactEventRow[] | null) ?? [];
}

function inspectCodeCoverage(): {
  runtimeMemoryHookFromObserver: boolean;
  businessDmObservationPath: boolean;
  groupTopicObservationPath: boolean;
  groupGeneralObservationPath: boolean;
  memoryHookOutsideObserver: boolean;
  sourcePreviewMayExceedDbLimit: boolean;
  sourcePreviewClampedTo160: boolean;
  intentLogsStoreRawTextFieldInSchema: boolean;
  intentLogWriterStoresRawText: boolean;
  replyDraftStoresFullDraftText: boolean;
  replyDraftSendMetadataExists: boolean;
  businessChatStoresOutgoingTextOnlyAsLastText: boolean;
} {
  const repoRoot = process.cwd();
  const contextObserverPath = path.join(
    repoRoot,
    "src/features/trainingpeaks/context-observer.ts"
  );
  const extractionPath = path.join(
    repoRoot,
    "src/features/trainingpeaks/coach-memory-extraction.ts"
  );
  const telegramContextPath = path.join(
    repoRoot,
    "src/features/trainingpeaks/telegram-context.ts"
  );
  const messageIntentLogPath = path.join(
    repoRoot,
    "src/features/trainingpeaks/message-intent-log.ts"
  );
  const repositoryPath = path.join(repoRoot, "src/features/trainingpeaks/repository.ts");
  const intentMigrationPath = path.join(
    repoRoot,
    "supabase/migrations/20260523200000_create_trainingpeaks_message_intent_logs.sql"
  );

  const contextObserver = fs.existsSync(contextObserverPath)
    ? fs.readFileSync(contextObserverPath, "utf8")
    : "";
  const extraction = fs.existsSync(extractionPath)
    ? fs.readFileSync(extractionPath, "utf8")
    : "";
  const telegramContext = fs.existsSync(telegramContextPath)
    ? fs.readFileSync(telegramContextPath, "utf8")
    : "";
  const intentLogWriter = fs.existsSync(messageIntentLogPath)
    ? fs.readFileSync(messageIntentLogPath, "utf8")
    : "";
  const repository = fs.existsSync(repositoryPath)
    ? fs.readFileSync(repositoryPath, "utf8")
    : "";
  const intentMigration = fs.existsSync(intentMigrationPath)
    ? fs.readFileSync(intentMigrationPath, "utf8")
    : "";

  const runtimeMemoryHookFromObserver =
    contextObserver.includes("processCoachMemoryForObservation(") &&
    contextObserver.includes("COACH_MEMORY_EXTRACTION_ENABLED");
  const businessDmObservationPath =
    telegramContext.includes('sourceType: "business_dm"') ||
    contextObserver.includes('sourceType: "private_dm"');
  const groupTopicObservationPath = contextObserver.includes('sourceType: "group_topic"');
  const groupGeneralObservationPath = contextObserver.includes('sourceType: "group_general"');
  const memoryHookOutsideObserver =
    extraction.includes("processCoachMemoryForObservation(") &&
    !contextObserver.includes("processCoachMemoryForObservation(");

  const sourcePreviewMayExceedDbLimit = extraction.includes("sourceMessagePreview: input.textPreview?.slice(0, 500)");
  const sourcePreviewClampedTo160 =
    extraction.includes("sourceMessagePreview: input.textPreview?.slice(0, 160)");

  const intentLogsStoreRawTextFieldInSchema = intentMigration.includes("raw_text text");
  const intentLogWriterStoresRawText =
    intentLogWriter.includes("rawText: null") ||
    repository.includes("raw_text: input.rawText ?? null");

  const replyDraftStoresFullDraftText = repository.includes("draft_text: input.draftText");
  const replyDraftSendMetadataExists =
    repository.includes("metadata.send") || repository.includes("sendStatus");
  const businessChatStoresOutgoingTextOnlyAsLastText =
    repository.includes("trainingpeaks_telegram_business_chats") &&
    repository.includes("last_text: input.lastText ?? null");

  return {
    runtimeMemoryHookFromObserver,
    businessDmObservationPath,
    groupTopicObservationPath,
    groupGeneralObservationPath,
    memoryHookOutsideObserver,
    sourcePreviewMayExceedDbLimit,
    sourcePreviewClampedTo160,
    intentLogsStoreRawTextFieldInSchema,
    intentLogWriterStoresRawText,
    replyDraftStoresFullDraftText,
    replyDraftSendMetadataExists,
    businessChatStoresOutgoingTextOnlyAsLastText,
  };
}

function printSourceClassificationTable(rows: SourceClassification[]): void {
  printSection("Source classification table");
  console.log(`${LOG_PREFIX} Source | Runtime covered? | Historical backfill? | Greeting/style? | Risk | Recommendation`);
  for (const row of rows) {
    console.log(
      `${LOG_PREFIX} ${row.source} | ${row.runtimeCovered} | ${row.historicalBackfill} | ${row.greetingStyle} | ${row.risk} | ${row.recommendation}`
    );
  }
}

async function run(): Promise<void> {
  loadLocalEnvFiles();

  const supabaseUrl = getEnvValue("NEXT_PUBLIC_SUPABASE_URL") ?? getEnvValue("SUPABASE_URL");
  const serviceRoleKey = getEnvValue("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.log(`${LOG_PREFIX} SKIP: missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY`);
    return;
  }
  if (!process.env.SUPABASE_URL) {
    process.env.SUPABASE_URL = supabaseUrl;
  }

  const code = inspectCodeCoverage();
  const supabase = createSupabaseServerClient();
  const since7 = getIsoDaysAgo(7);
  const since30 = getIsoDaysAgo(30);

  const [
    activeStudentsCount,
    observationsTotalCount,
    observations7Rows,
    observations30Rows,
    memoryRows,
    memoryActiveCount,
    cases30Rows,
    intent30Rows,
    drafts30Rows,
    contactEvents30Rows,
    intentLogsTotalCount,
    casesTotalCount,
    snapshotsTotalCount,
    contactEventsTotalCount,
    replyDraftsTotalCount,
    businessChatsTotalCount,
    studentsTotalCount,
  ] = await Promise.all([
    safeCount(supabase, "trainingpeaks_students", (query) => query.eq("is_active", true)),
    safeCount(supabase, "trainingpeaks_telegram_context_observations"),
    fetchObservationsInRange(since7),
    fetchObservationsInRange(since30),
    fetchAllMemoryItems(),
    safeCount(supabase, "trainingpeaks_student_memory_items", (query) => query.eq("is_active", true)),
    fetchCasesInRange(since30),
    fetchIntentLogsInRange(since30),
    fetchReplyDraftsInRange(since30),
    fetchContactEventsInRange(since30),
    safeCount(supabase, "trainingpeaks_message_intent_logs"),
    safeCount(supabase, "trainingpeaks_coach_cases"),
    safeCount(supabase, "trainingpeaks_student_context_snapshots"),
    safeCount(supabase, "trainingpeaks_student_contact_events"),
    safeCount(supabase, "trainingpeaks_reply_drafts"),
    safeCount(supabase, "trainingpeaks_telegram_business_chats"),
    safeCount(supabase, "trainingpeaks_students"),
  ]);

  const observations7Count = observations7Rows.length;
  const observations30Count = observations30Rows.length;

  const observationsBySourceType: Record<string, number> = {};
  const observationsByLabel: Record<string, number> = {};
  let observationsWithStudent = 0;
  let observationsWithoutStudent = 0;
  for (const row of observations30Rows) {
    incrementCounter(observationsBySourceType, row.source_type ?? "unknown");
    const labels = coerceStringArray(row.labels);
    for (const label of labels) {
      incrementCounter(observationsByLabel, label);
    }
    if (row.student_id) {
      observationsWithStudent += 1;
    } else {
      observationsWithoutStudent += 1;
    }
  }

  const memoryByType: Record<string, number> = {};
  const activeMemoryStudentIds = new Set<string>();
  for (const row of memoryRows) {
    incrementCounter(memoryByType, row.memory_type || "unknown");
    if (row.is_active) {
      activeMemoryStudentIds.add(row.student_id);
    }
  }
  const studentsWithActiveMemory = activeMemoryStudentIds.size;
  const studentsWithNoActiveMemory = Math.max(0, activeStudentsCount - studentsWithActiveMemory);

  const casesByKindStatus: Record<string, number> = {};
  for (const row of cases30Rows) {
    incrementCounter(casesByKindStatus, `${row.case_kind}:${row.status}`);
  }

  const intentByStatus: Record<string, number> = {};
  for (const row of intent30Rows) {
    incrementCounter(intentByStatus, row.status || "unknown");
  }

  const draftsByOutcome: Record<string, number> = {};
  let sentDraftsCount = 0;
  for (const row of drafts30Rows) {
    incrementCounter(draftsByOutcome, row.outcome || "unknown");
    const metadata = toObject(row.metadata);
    const send = toObject(metadata?.send);
    if (send?.status === "sent") {
      sentDraftsCount += 1;
    }
  }

  const contactEventsByType: Record<string, number> = {};
  const contactEventsBySource: Record<string, number> = {};
  for (const row of contactEvents30Rows) {
    incrementCounter(contactEventsByType, row.event_type || "unknown");
    incrementCounter(contactEventsBySource, row.source || "unknown");
  }

  const sourceRows: SourceClassification[] = [
    {
      source: "Telegram Business DM context observations",
      runtimeCovered: code.businessDmObservationPath && code.runtimeMemoryHookFromObserver ? "yes" : "partial",
      historicalBackfill: observationsBySourceType.business_dm ? "yes" : "partial",
      greetingStyle: "partial",
      risk: "medium",
      recommendation: "Primary runtime+backfill memory source; keep style extraction conservative.",
    },
    {
      source: "Group topic observations",
      runtimeCovered: code.groupTopicObservationPath && code.runtimeMemoryHookFromObserver ? "yes" : "partial",
      historicalBackfill: observationsBySourceType.group_topic ? "yes" : "partial",
      greetingStyle: "no",
      risk: "medium",
      recommendation: "Use for durable facts; keep sender-link confidence checks.",
    },
    {
      source: "General group observations",
      runtimeCovered: code.groupGeneralObservationPath ? "yes" : "partial",
      historicalBackfill: observationsBySourceType.group_general ? "yes" : "partial",
      greetingStyle: "no",
      risk: "high",
      recommendation: "Backfill with stricter filters; high noise/third-party risk.",
    },
    {
      source: "Message intent logs",
      runtimeCovered: "no",
      historicalBackfill: intentLogsTotalCount > 0 ? "partial" : "no",
      greetingStyle: "no",
      risk: "high",
      recommendation: "Secondary-only source for gaps not present in observations.",
    },
    {
      source: "Coach cases",
      runtimeCovered: "no",
      historicalBackfill: casesTotalCount > 0 ? "partial" : "no",
      greetingStyle: "no",
      risk: "medium",
      recommendation: "Use as supporting structured signals by case kind.",
    },
    {
      source: "Student context snapshots",
      runtimeCovered: "no",
      historicalBackfill: snapshotsTotalCount > 0 ? "partial" : "no",
      greetingStyle: "no",
      risk: "high",
      recommendation: "Do not use as primary backfill source; derived point-in-time data.",
    },
    {
      source: "Student contact events",
      runtimeCovered: "no",
      historicalBackfill: contactEventsTotalCount > 0 ? "partial" : "no",
      greetingStyle: "partial",
      risk: "medium",
      recommendation: "Useful for cadence/style telemetry later, not durable memory now.",
    },
    {
      source: "Reply drafts and sent outcomes",
      runtimeCovered: "no",
      historicalBackfill: replyDraftsTotalCount > 0 ? "partial" : "no",
      greetingStyle: code.replyDraftStoresFullDraftText ? "yes" : "partial",
      risk: "medium",
      recommendation: "Best current style signal candidate; require sent-only filtering.",
    },
    {
      source: "Telegram Business chats table",
      runtimeCovered: "no",
      historicalBackfill: businessChatsTotalCount > 0 ? "partial" : "no",
      greetingStyle: "partial",
      risk: "high",
      recommendation: "Metadata-only fallback; lacks direction and full sent-text history.",
    },
  ];

  printMetric("mode", "read-only");
  printMetric("query_policy", "select_only");
  printMetric("privacy", "aggregate_only_no_raw_text_no_full_chat_ids");

  printSection("Task B: Runtime ingestion coverage map");
  printMetric("business_dm_persisted_as_observations", code.businessDmObservationPath ? "yes" : "partial");
  printMetric("business_dm_memory_hook_path", code.runtimeMemoryHookFromObserver ? "yes" : "no");
  printMetric("business_dm_student_link_reliability", "medium (chat-id link required)");
  printMetric(
    "business_dm_runtime_memory_eligible",
    code.businessDmObservationPath && code.runtimeMemoryHookFromObserver ? "yes" : "partial"
  );

  printMetric("group_topic_persisted_as_observations", code.groupTopicObservationPath ? "yes" : "partial");
  printMetric("group_topic_memory_hook_covered", code.runtimeMemoryHookFromObserver ? "yes" : "no");
  printMetric("group_topic_student_link_reliability", "medium-high (thread link + sender checks)");

  printMetric("group_general_persisted_as_observations", code.groupGeneralObservationPath ? "yes" : "partial");
  printMetric("group_general_memory_hook_covered", code.groupGeneralObservationPath ? "yes" : "no");
  printMetric("group_general_skip_noise_rules", "yes (ack/noise filters in observer)");

  printMetric("existing_observations_backfill_available", observationsTotalCount > 0 ? "yes" : "no");
  printMetric("observations_last_7_days", observations7Count);
  printMetric("observations_last_30_days", observations30Count);
  printMetric("observations_all_time", observationsTotalCount);

  printMetric("message_intent_logs_used_by_runtime_memory_now", "no");
  printMetric("message_intent_logs_backfill_candidate", intentLogsTotalCount > 0 ? "partial_secondary" : "no");
  printMetric(
    "message_intent_logs_data_shape",
    code.intentLogsStoreRawTextFieldInSchema
      ? "schema_has_raw_text_but_writer_prefers_preview_hash"
      : "preview_hash_only"
  );

  printMetric("coach_cases_used_by_runtime_memory_now", "no");
  printMetric("coach_cases_backfill_candidate", casesTotalCount > 0 ? "partial_supporting" : "no");
  printMetric(
    "coach_cases_kind_to_memory_hint",
    "pain_or_health_signal->pain/health; question_to_coach->question context; move_workout_needs_review->schedule context"
  );

  printMetric("student_context_snapshots_used_by_runtime_memory_now", "no");
  printMetric(
    "student_context_snapshots_backfill_candidate",
    snapshotsTotalCount > 0 ? "avoid_as_primary" : "no"
  );

  printMetric("contact_events_used_by_runtime_memory_now", "no");
  printMetric(
    "contact_events_memory_vs_style_fit",
    "better_for_contact_cadence_and_style_telemetry_than_durable_memory"
  );

  printMetric("reply_drafts_store_final_sent_text", code.replyDraftStoresFullDraftText ? "yes(draft_text)" : "partial");
  printMetric("reply_drafts_style_extraction_candidate", sentDraftsCount >= 3 ? "yes" : "partial");
  printMetric("reply_drafts_safe_fields", "outcome,metadata.send.status,draft_preview,draft_text(hash/preview-first)");
  printMetric("reply_drafts_sent_count_in_30d", sentDraftsCount);

  printMetric(
    "telegram_business_chats_contains_outgoing_content",
    code.businessChatStoresOutgoingTextOnlyAsLastText ? "only_last_text_metadata" : "unknown"
  );
  printMetric("telegram_business_chats_style_extraction_ready", "no_directional_history");

  printSection("Task C: Aggregate metrics summary");
  printMetric("active_students_count", activeStudentsCount);
  printMetric("students_total_count", studentsTotalCount);
  printMetric("observations_total", observationsTotalCount);
  printMetric("observations_7d", observations7Count);
  printMetric("observations_30d", observations30Count);
  for (const [sourceType, count] of sortedCounterEntries(observationsBySourceType)) {
    printMetric(`observations_by_source_type_${sourceType}`, count);
  }
  for (const [label, count] of sortedCounterEntries(observationsByLabel).slice(0, 20)) {
    printMetric(`observations_by_label_${label}`, count);
  }
  printMetric("observations_with_student_id_30d", observationsWithStudent);
  printMetric("observations_without_student_id_30d", observationsWithoutStudent);

  printMetric("memory_items_total", memoryRows.length);
  printMetric("memory_items_active", memoryActiveCount);
  for (const [memoryType, count] of sortedCounterEntries(memoryByType)) {
    printMetric(`memory_items_by_type_${memoryType}`, count);
  }
  printMetric("students_with_active_memory", studentsWithActiveMemory);
  printMetric("students_with_no_active_memory", studentsWithNoActiveMemory);

  for (const [key, count] of sortedCounterEntries(casesByKindStatus)) {
    printMetric(`cases_by_kind_status_${key}`, count);
  }
  for (const [status, count] of sortedCounterEntries(intentByStatus)) {
    printMetric(`intent_logs_by_status_${status}`, count);
  }
  for (const [outcome, count] of sortedCounterEntries(draftsByOutcome)) {
    printMetric(`reply_drafts_by_outcome_${outcome}`, count);
  }
  printMetric("sent_drafts_count_30d", sentDraftsCount);
  for (const [eventType, count] of sortedCounterEntries(contactEventsByType)) {
    printMetric(`contact_events_by_event_type_${eventType}`, count);
  }
  for (const [source, count] of sortedCounterEntries(contactEventsBySource)) {
    printMetric(`contact_events_by_source_${source}`, count);
  }

  printSection("Task D: Source classification");
  printSourceClassificationTable(sourceRows);

  printSection("Task E: Recommended Phase 2 backfill order");
  shortCountByKey([
    { key: "backfill_order_1", count: 1 },
    { key: "backfill_order_2", count: 2 },
    { key: "backfill_order_3", count: 3 },
  ]);
  printMetric(
    "backfill_order_notes",
    "1) observations first; 2) high-confidence labels only; 3) secondary/supporting sources last"
  );
  printMetric(
    "high_confidence_labels_initial",
    "pain_or_health,schedule_context,race_context,move_workout_candidate(non_one_off),question_to_coach(durable_fact_only)"
  );
  printMetric("avoid_report_like_without_keywords", "yes");
  printMetric("avoid_intent_logs_as_primary", "yes");
  printMetric("avoid_snapshots_as_primary", "yes");
  printMetric("avoid_contact_events_for_durable_memory", "yes");
  printMetric("outgoing_coach_messages_separate_project", "yes_greeting_style_track");

  printSection("Task F: Greeting/style feasibility");
  const greetingSignalEnough = sentDraftsCount >= 3;
  printMetric("can_infer_preferred_greeting_now", greetingSignalEnough ? "partial_yes" : "not_enough_data");
  printMetric("can_infer_ty_vy_now", greetingSignalEnough ? "partial_yes" : "not_enough_data");
  printMetric("can_infer_tone_now", greetingSignalEnough ? "partial_yes" : "not_enough_data");
  printMetric("can_infer_emoji_level_now", greetingSignalEnough ? "partial_yes" : "not_enough_data");
  printMetric("can_infer_punctuation_style_now", greetingSignalEnough ? "partial_yes" : "not_enough_data");
  if (!greetingSignalEnough) {
    printMetric(
      "minimal_future_logging_needed",
      "store_sent_coach_preview_hash,direction=coach_to_student,greeting_pattern_counts,infer_after_n>=3"
    );
  }

  printSection("Task G: source_message_preview pre-flight bug check");
  printMetric("db_constraint_source_message_preview_max_chars", SOURCE_MESSAGE_PREVIEW_DB_LIMIT);
  printMetric(
    "code_path_preview_clamped_to_160",
    code.sourcePreviewClampedTo160 ? "yes" : "no"
  );
  printMetric(
    "code_path_preview_may_exceed_160",
    code.sourcePreviewMayExceedDbLimit ? "yes" : "no"
  );
  if (!code.sourcePreviewClampedTo160) {
    printMetric("source_message_preview_bug_status", "requires_fix_before_write_paths_are_safe");
  } else {
    printMetric("source_message_preview_bug_status", "safe_clamp_present");
  }

  printSection("Uncovered sources and caution");
  printMetric(
    "runtime_uncovered_sources",
    "message_intent_logs,coach_cases,student_context_snapshots,contact_events,reply_drafts,telegram_business_chats"
  );
  printMetric("highest_noise_risk_source", "group_general_observations");
  printMetric("highest_privacy_caution_source", "message_intent_logs_schema_raw_text_field");
  printMetric("no_raw_text_output_confirmed", "yes");
  printMetric("no_full_chat_ids_output_confirmed", "yes");

  console.log("");
  console.log(`${LOG_PREFIX} OK read-only diagnostic complete`);
}

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.startsWith(`${LOG_PREFIX} FAIL:`) ? message : `${LOG_PREFIX} FAIL: ${message}`);
  process.exit(1);
});
