import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import type { PostgrestError } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/features/supabase/server";

const LOG_PREFIX = "[diagnose-student-communication-style]";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
const LOW_GREETING_CONFIDENCE_THRESHOLD = 0.7;

type NormalizedFormality = "ty" | "vy" | "unknown";
type ConflictFlag =
  | "formality_mismatch"
  | "multiple_communication_style"
  | "formality_unknown_with_memory"
  | "memory_formality_unknown"
  | "no_communication_data"
  | "greeting_low_confidence"
  | "manual_memory_conflict";
type RecommendedAction =
  | "ok"
  | "set_formality_from_memory"
  | "resolve_conflict"
  | "needs_manual_set"
  | "review_memory";

type CliOptions = {
  json: boolean;
  limit: number;
  studentQuery: string | null;
  onlyConflicts: boolean;
  onlyNeedsAction: boolean;
};

type StudentRow = {
  id: string;
  student_id: string;
  student_name: string;
  is_active: boolean;
  telegram_formality: string | null;
  telegram_context_notes: string | null;
};

type MemoryRow = {
  id: string;
  student_id: string;
  memory_type: string;
  is_active: boolean;
  summary_text: string;
  structured: unknown;
  source: string;
  confidence: number | null;
  updated_at: string;
  source_message_preview: string | null;
};

type CommunicationMemorySnapshot = {
  id: string;
  summary: string;
  formality: NormalizedFormality;
  tone: string | null;
  preferredGreeting: string | null;
  greetingConfidence: number | null;
  source: string;
  confidence: number | null;
  updatedAt: string;
  sourceMessagePreview: string | null;
  isManualEvidence: boolean;
};

type StudentDiagnostic = {
  studentId: string;
  studentSlug: string;
  studentName: string;
  telegramFormality: NormalizedFormality;
  telegramContextNotes: string | null;
  communicationMemoryItems: CommunicationMemorySnapshot[];
  conflictFlags: ConflictFlag[];
  draftContextReady: boolean;
  recommendedAction: RecommendedAction;
};

type JsonPayload = {
  mode: "read-only";
  query_policy: "select_only";
  filters: {
    student: string | null;
    limit: number;
    only_conflicts: boolean;
    only_needs_action: boolean;
  };
  total_students: number;
  formality_set: {
    total: number;
    ty: number;
    vy: number;
  };
  formality_unknown: number;
  with_communication_memory: number;
  conflicts: number;
  draft_ready: number;
  needs_manual_set: number;
  recommended_actions: Record<RecommendedAction, number>;
  students: Array<{
    student_name: string;
    student_slug: string;
    student_id: string;
    telegram_formality: NormalizedFormality;
    telegram_context_notes: string | null;
    active_communication_style_memory: number;
    memory: Array<{
      summary: string;
      formality: NormalizedFormality;
      tone: string | null;
      preferred_greeting: string | null;
      greeting_confidence: number | null;
      source: string;
      confidence: number | null;
      updated_at: string;
      source_message_preview: string | null;
    }>;
    conflict_flags: ConflictFlag[];
    draft_context_ready: boolean;
    recommended_action: RecommendedAction;
  }>;
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

function parsePositiveInt(rawValue: string, flag: string): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${LOG_PREFIX} FAIL: invalid ${flag} value: ${rawValue}`);
  }
  return Math.floor(parsed);
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    json: false,
    limit: DEFAULT_LIMIT,
    studentQuery: null,
    onlyConflicts: false,
    onlyNeedsAction: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--only-conflicts") {
      options.onlyConflicts = true;
      continue;
    }
    if (arg === "--only-needs-action") {
      options.onlyNeedsAction = true;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      options.limit = Math.min(parsePositiveInt(arg.slice("--limit=".length), "--limit"), MAX_LIMIT);
      continue;
    }
    if (arg === "--limit") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --limit`);
      }
      options.limit = Math.min(parsePositiveInt(next, "--limit"), MAX_LIMIT);
      index += 1;
      continue;
    }
    if (arg.startsWith("--student=")) {
      options.studentQuery = arg.slice("--student=".length).trim() || null;
      continue;
    }
    if (arg === "--student") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --student`);
      }
      options.studentQuery = next;
      index += 1;
      continue;
    }
  }

  return options;
}

function normalizeText(input: string): string {
  return input.toLowerCase().replace(/\s+/gu, " ").trim();
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

function normalizeFormality(value: unknown): NormalizedFormality {
  if (typeof value !== "string") {
    return "unknown";
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "ty" || normalized === "vy" ? normalized : "unknown";
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function normalizeStructured(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function formatDate(value: string): string {
  return value.length >= 10 ? value.slice(0, 10) : value;
}

function truncateText(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/gu, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function isManualMemorySource(source: string): boolean {
  const normalized = source.trim().toLowerCase();
  return normalized === "coach_manual" || normalized === "telegram_command" || normalized.includes("manual");
}

function hasReliableMemoryFormality(items: CommunicationMemorySnapshot[]): boolean {
  return items.some((item) => {
    if (item.formality !== "ty" && item.formality !== "vy") {
      return false;
    }
    if (item.isManualEvidence) {
      return true;
    }
    const confidence = item.confidence ?? 0;
    return confidence >= LOW_GREETING_CONFIDENCE_THRESHOLD;
  });
}

async function fetchActiveStudents(): Promise<StudentRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .select("id, student_id, student_name, is_active, telegram_formality, telegram_context_notes")
    .eq("is_active", true)
    .order("student_name", { ascending: true })
    .limit(5000);

  if (error) {
    throw new Error(`${LOG_PREFIX} FAIL: trainingpeaks_students: ${error.message}`);
  }
  return (data as StudentRow[] | null) ?? [];
}

async function fetchCommunicationMemoryByStudentIds(studentIds: readonly string[]): Promise<MemoryRow[]> {
  if (studentIds.length === 0) {
    return [];
  }
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_student_memory_items")
    .select(
      "id, student_id, memory_type, is_active, summary_text, structured, source, confidence, updated_at, source_message_preview"
    )
    .in("student_id", [...studentIds])
    .eq("memory_type", "communication_style")
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(10000);

  if (error) {
    if (isMissingRelationError(error)) {
      return [];
    }
    throw new Error(`${LOG_PREFIX} FAIL: trainingpeaks_student_memory_items: ${error.message}`);
  }
  return (data as MemoryRow[] | null) ?? [];
}

function buildStudentDiagnostic(
  student: StudentRow,
  communicationMemoryItems: CommunicationMemorySnapshot[]
): StudentDiagnostic {
  const telegramFormality = normalizeFormality(student.telegram_formality);
  const memoryFormalities = communicationMemoryItems.map((item) => item.formality);
  const memoryHasTyVy = memoryFormalities.some((value) => value === "ty" || value === "vy");
  const oppositeFormality: NormalizedFormality =
    telegramFormality === "ty" ? "vy" : telegramFormality === "vy" ? "ty" : "unknown";

  const flags = new Set<ConflictFlag>();

  if (
    (telegramFormality === "ty" || telegramFormality === "vy") &&
    communicationMemoryItems.some((item) => item.formality === oppositeFormality)
  ) {
    flags.add("formality_mismatch");
  }

  if (communicationMemoryItems.length > 1) {
    flags.add("multiple_communication_style");
  }

  if (telegramFormality === "unknown" && memoryHasTyVy) {
    flags.add("formality_unknown_with_memory");
  }

  if (communicationMemoryItems.some((item) => item.formality === "unknown")) {
    flags.add("memory_formality_unknown");
  }

  if (telegramFormality === "unknown" && communicationMemoryItems.length === 0) {
    flags.add("no_communication_data");
  }

  if (
    communicationMemoryItems.some((item) => {
      if (!item.preferredGreeting) {
        return false;
      }
      const confidence = item.greetingConfidence;
      return confidence == null || confidence < LOW_GREETING_CONFIDENCE_THRESHOLD;
    })
  ) {
    flags.add("greeting_low_confidence");
  }

  if (
    (telegramFormality === "ty" || telegramFormality === "vy") &&
    communicationMemoryItems.some((item) => item.isManualEvidence && item.formality === oppositeFormality)
  ) {
    flags.add("manual_memory_conflict");
  }

  const draftContextReady = telegramFormality === "ty" || telegramFormality === "vy" || memoryHasTyVy;
  const reliableMemoryFormality = hasReliableMemoryFormality(communicationMemoryItems);

  let recommendedAction: RecommendedAction;
  if (flags.has("formality_mismatch") || flags.has("manual_memory_conflict")) {
    recommendedAction = "resolve_conflict";
  } else if (flags.has("no_communication_data")) {
    recommendedAction = "needs_manual_set";
  } else if (telegramFormality === "unknown" && memoryHasTyVy && reliableMemoryFormality) {
    recommendedAction = "set_formality_from_memory";
  } else if (
    flags.has("multiple_communication_style") ||
    flags.has("memory_formality_unknown") ||
    flags.has("greeting_low_confidence")
  ) {
    recommendedAction = "review_memory";
  } else if (draftContextReady) {
    recommendedAction = "ok";
  } else {
    recommendedAction = "needs_manual_set";
  }

  return {
    studentId: student.id,
    studentSlug: student.student_id,
    studentName: student.student_name,
    telegramFormality,
    telegramContextNotes: normalizeString(student.telegram_context_notes),
    communicationMemoryItems,
    conflictFlags: [...flags],
    draftContextReady,
    recommendedAction,
  };
}

function printStudentBlock(row: StudentDiagnostic): void {
  console.log(`student: ${row.studentName} (${row.studentSlug})`);
  console.log(`telegram_formality: ${row.telegramFormality}`);
  console.log(`telegram_context_notes: ${row.telegramContextNotes ? JSON.stringify(row.telegramContextNotes) : "<none>"}`);
  console.log(
    `active_communication_style_memory: ${row.communicationMemoryItems.length} ${row.communicationMemoryItems.length === 1 ? "item" : "items"}`
  );

  if (row.communicationMemoryItems.length === 0) {
    console.log("  <none>");
  } else {
    for (const item of row.communicationMemoryItems) {
      console.log(`  summary: ${JSON.stringify(item.summary)}`);
      console.log(
        `  formality: ${item.formality} | tone: ${item.tone ?? "unknown"} | greeting: ${item.preferredGreeting ? JSON.stringify(item.preferredGreeting) : "unknown"}`
      );
      console.log(
        `  source: ${item.source} | confidence: ${item.confidence ?? "null"} | updated: ${formatDate(item.updatedAt)}`
      );
      if (item.sourceMessagePreview) {
        console.log(`  source_message_preview: ${JSON.stringify(item.sourceMessagePreview)}`);
      }
    }
  }

  console.log(`conflict_flags: ${row.conflictFlags.length > 0 ? row.conflictFlags.join(", ") : "none"}`);
  console.log(`draft_context_ready: ${row.draftContextReady}`);
  console.log(`recommended_action: ${row.recommendedAction}`);
}

function buildJsonPayload(rows: StudentDiagnostic[], options: CliOptions): JsonPayload {
  const formalityTy = rows.filter((row) => row.telegramFormality === "ty").length;
  const formalityVy = rows.filter((row) => row.telegramFormality === "vy").length;
  const formalityUnknown = rows.filter((row) => row.telegramFormality === "unknown").length;
  const conflicts = rows.filter((row) => {
    return row.conflictFlags.includes("formality_mismatch") || row.conflictFlags.includes("manual_memory_conflict");
  }).length;
  const draftReady = rows.filter((row) => row.draftContextReady).length;
  const needsManualSet = rows.filter((row) => row.recommendedAction === "needs_manual_set").length;

  const recommendedActions: Record<RecommendedAction, number> = {
    ok: 0,
    set_formality_from_memory: 0,
    resolve_conflict: 0,
    needs_manual_set: 0,
    review_memory: 0,
  };
  for (const row of rows) {
    recommendedActions[row.recommendedAction] += 1;
  }

  return {
    mode: "read-only",
    query_policy: "select_only",
    filters: {
      student: options.studentQuery,
      limit: options.limit,
      only_conflicts: options.onlyConflicts,
      only_needs_action: options.onlyNeedsAction,
    },
    total_students: rows.length,
    formality_set: {
      total: formalityTy + formalityVy,
      ty: formalityTy,
      vy: formalityVy,
    },
    formality_unknown: formalityUnknown,
    with_communication_memory: rows.filter((row) => row.communicationMemoryItems.length > 0).length,
    conflicts,
    draft_ready: draftReady,
    needs_manual_set: needsManualSet,
    recommended_actions: recommendedActions,
    students: rows.map((row) => ({
      student_name: row.studentName,
      student_slug: row.studentSlug,
      student_id: row.studentId,
      telegram_formality: row.telegramFormality,
      telegram_context_notes: row.telegramContextNotes,
      active_communication_style_memory: row.communicationMemoryItems.length,
      memory: row.communicationMemoryItems.map((item) => ({
        summary: item.summary,
        formality: item.formality,
        tone: item.tone,
        preferred_greeting: item.preferredGreeting,
        greeting_confidence: item.greetingConfidence,
        source: item.source,
        confidence: item.confidence,
        updated_at: item.updatedAt,
        source_message_preview: item.sourceMessagePreview,
      })),
      conflict_flags: row.conflictFlags,
      draft_context_ready: row.draftContextReady,
      recommended_action: row.recommendedAction,
    })),
  };
}

function printSummary(payload: JsonPayload): void {
  console.log("");
  console.log(`total_students: ${payload.total_students}`);
  console.log(
    `formality_set: ${payload.formality_set.total} (ty=${payload.formality_set.ty}, vy=${payload.formality_set.vy})`
  );
  console.log(`formality_unknown: ${payload.formality_unknown}`);
  console.log(`with_communication_memory: ${payload.with_communication_memory}`);
  console.log(`conflicts: ${payload.conflicts}`);
  console.log(`draft_ready: ${payload.draft_ready}`);
  console.log(`needs_manual_set: ${payload.needs_manual_set}`);
  console.log("recommended_actions:");
  console.log(`  ok: ${payload.recommended_actions.ok}`);
  console.log(`  set_formality_from_memory: ${payload.recommended_actions.set_formality_from_memory}`);
  console.log(`  resolve_conflict: ${payload.recommended_actions.resolve_conflict}`);
  console.log(`  needs_manual_set: ${payload.recommended_actions.needs_manual_set}`);
  console.log(`  review_memory: ${payload.recommended_actions.review_memory}`);
}

async function run(): Promise<void> {
  loadLocalEnvFiles();
  const options = parseCliOptions(process.argv.slice(2));

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceRoleKey) {
    console.log(`${LOG_PREFIX} SKIP: missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY`);
    return;
  }
  if (!process.env.SUPABASE_URL) {
    process.env.SUPABASE_URL = supabaseUrl;
  }

  let students = await fetchActiveStudents();
  if (options.studentQuery) {
    const query = normalizeText(options.studentQuery);
    students = students.filter((student) => {
      return (
        student.id.toLowerCase().startsWith(query) ||
        student.student_id.toLowerCase().includes(query) ||
        student.student_name.toLowerCase().includes(query)
      );
    });
  }

  if (students.length === 0) {
    console.log(`${LOG_PREFIX} student_filter=no_matches`);
    console.log(`${LOG_PREFIX} student_query=${JSON.stringify(options.studentQuery)}`);
    return;
  }

  const studentIds = students.map((student) => student.id);
  const memoryRows = await fetchCommunicationMemoryByStudentIds(studentIds);
  const memoryByStudent = new Map<string, CommunicationMemorySnapshot[]>();

  for (const row of memoryRows) {
    const structured = normalizeStructured(row.structured);
    const snapshot: CommunicationMemorySnapshot = {
      id: row.id,
      summary: truncateText(normalizeString(row.summary_text) ?? "", 220) || "<empty>",
      formality: normalizeFormality(structured.formality),
      tone: normalizeString(structured.tone),
      preferredGreeting: normalizeString(structured.preferred_greeting),
      greetingConfidence: normalizeNumber(structured.greeting_confidence),
      source: normalizeString(row.source) ?? "unknown",
      confidence: normalizeNumber(row.confidence),
      updatedAt: row.updated_at,
      sourceMessagePreview: normalizeString(row.source_message_preview),
      isManualEvidence: isManualMemorySource(normalizeString(row.source) ?? "unknown"),
    };
    memoryByStudent.set(row.student_id, [...(memoryByStudent.get(row.student_id) ?? []), snapshot]);
  }

  let diagnostics = students.map((student) => {
    const communicationMemoryItems = (memoryByStudent.get(student.id) ?? []).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt)
    );
    return buildStudentDiagnostic(student, communicationMemoryItems);
  });

  if (options.onlyConflicts) {
    diagnostics = diagnostics.filter(
      (row) =>
        row.conflictFlags.includes("formality_mismatch") || row.conflictFlags.includes("manual_memory_conflict")
    );
  }
  if (options.onlyNeedsAction) {
    diagnostics = diagnostics.filter((row) => row.recommendedAction !== "ok");
  }

  diagnostics = diagnostics.slice(0, options.limit);

  const payload = buildJsonPayload(diagnostics, options);

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`${LOG_PREFIX} mode=read-only`);
  console.log(`${LOG_PREFIX} query_policy=select_only`);
  console.log(
    `${LOG_PREFIX} filters student=${JSON.stringify(options.studentQuery)} limit=${options.limit} only_conflicts=${options.onlyConflicts} only_needs_action=${options.onlyNeedsAction}`
  );
  console.log("");

  for (const row of diagnostics) {
    printStudentBlock(row);
    console.log("");
  }

  printSummary(payload);
  console.log("");
  console.log(`${LOG_PREFIX} OK read-only communication style diagnostic complete`);
}

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.startsWith(`${LOG_PREFIX} FAIL:`) ? message : `${LOG_PREFIX} FAIL: ${message}`);
  process.exit(1);
});
