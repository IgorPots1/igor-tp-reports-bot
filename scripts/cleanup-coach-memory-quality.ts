import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import type { PostgrestError } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/features/supabase/server";
import type { TrainingPeaksStudentMemoryType } from "@/features/trainingpeaks/repository";

const LOG_PREFIX = "[cleanup-coach-memory-quality]";

type Action = "deactivate" | "expire" | "retype" | "keep";

type CliOptions = {
  itemId: string;
  action: Action;
  validUntil: string | null;
  memoryType: TrainingPeaksStudentMemoryType | null;
  apply: boolean;
  json: boolean;
};

type MemoryItemRow = {
  id: string;
  student_id: string;
  memory_type: TrainingPeaksStudentMemoryType;
  summary_text: string;
  confidence: number | null;
  valid_from: string | null;
  valid_until: string | null;
  source: string;
  is_active: boolean;
};

type StudentRow = {
  id: string;
  student_id: string;
  student_name: string;
};

type Report = {
  mode: "dry-run";
  policy: "no_writes";
  current_memory_item: {
    id: string;
    student: {
      id: string;
      slug: string;
      name: string;
    };
    memory_type: TrainingPeaksStudentMemoryType;
    summary_text: string;
    confidence: number | null;
    valid_from: string | null;
    valid_until: string | null;
    source: string;
    is_active: boolean;
  };
  proposed_action: Action;
  proposed_changes: Partial<{
    is_active: boolean;
    valid_until: string;
    memory_type: TrainingPeaksStudentMemoryType;
  }>;
  safety_note: string;
};

const ALLOWED_ACTIONS: readonly Action[] = ["deactivate", "expire", "retype", "keep"];
const ALLOWED_MEMORY_TYPES: readonly TrainingPeaksStudentMemoryType[] = [
  "communication_style",
  "schedule_constraint",
  "availability_preference",
  "pain_or_injury",
  "health_status",
  "emotional_state",
  "load_tolerance",
  "planning_preference",
  "race_or_goal",
  "travel_or_life_event",
  "equipment_or_device_note",
];

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

function parseAction(rawValue: string): Action {
  if (ALLOWED_ACTIONS.includes(rawValue as Action)) {
    return rawValue as Action;
  }
  throw new Error(`${LOG_PREFIX} FAIL: unsupported --action value: ${rawValue}`);
}

function parseMemoryType(rawValue: string): TrainingPeaksStudentMemoryType {
  if (ALLOWED_MEMORY_TYPES.includes(rawValue as TrainingPeaksStudentMemoryType)) {
    return rawValue as TrainingPeaksStudentMemoryType;
  }
  throw new Error(`${LOG_PREFIX} FAIL: unsupported --memory-type value: ${rawValue}`);
}

function isValidDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value);
}

function isLikelyUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function parseCliOptions(argv: string[]): CliOptions {
  let itemId: string | null = null;
  let action: Action | null = null;
  let validUntil: string | null = null;
  let memoryType: TrainingPeaksStudentMemoryType | null = null;
  let apply = false;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg.startsWith("--item-id=")) {
      itemId = arg.slice("--item-id=".length).trim() || null;
      continue;
    }
    if (arg === "--item-id") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --item-id`);
      }
      itemId = next;
      index += 1;
      continue;
    }
    if (arg.startsWith("--action=")) {
      action = parseAction(arg.slice("--action=".length).trim());
      continue;
    }
    if (arg === "--action") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --action`);
      }
      action = parseAction(next);
      index += 1;
      continue;
    }
    if (arg.startsWith("--valid-until=")) {
      validUntil = arg.slice("--valid-until=".length).trim() || null;
      continue;
    }
    if (arg === "--valid-until") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --valid-until`);
      }
      validUntil = next;
      index += 1;
      continue;
    }
    if (arg.startsWith("--memory-type=")) {
      memoryType = parseMemoryType(arg.slice("--memory-type=".length).trim());
      continue;
    }
    if (arg === "--memory-type") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --memory-type`);
      }
      memoryType = parseMemoryType(next);
      index += 1;
      continue;
    }
    throw new Error(`${LOG_PREFIX} FAIL: unknown argument: ${arg}`);
  }

  if (!itemId) {
    throw new Error(`${LOG_PREFIX} FAIL: --item-id is required`);
  }
  if (!isLikelyUuid(itemId)) {
    throw new Error(`${LOG_PREFIX} FAIL: --item-id must be a UUID`);
  }
  if (!action) {
    throw new Error(`${LOG_PREFIX} FAIL: --action is required`);
  }
  if (action === "expire") {
    if (!validUntil) {
      throw new Error(`${LOG_PREFIX} FAIL: --valid-until is required when --action=expire`);
    }
    if (!isValidDateOnly(validUntil)) {
      throw new Error(`${LOG_PREFIX} FAIL: --valid-until must be YYYY-MM-DD`);
    }
  }
  if (action !== "expire" && validUntil) {
    throw new Error(`${LOG_PREFIX} FAIL: --valid-until is only allowed when --action=expire`);
  }
  if (action === "retype" && !memoryType) {
    throw new Error(`${LOG_PREFIX} FAIL: --memory-type is required when --action=retype`);
  }
  if (action !== "retype" && memoryType) {
    throw new Error(`${LOG_PREFIX} FAIL: --memory-type is only allowed when --action=retype`);
  }

  return {
    itemId,
    action,
    validUntil,
    memoryType,
    apply,
    json,
  };
}

async function fetchMemoryItem(itemId: string): Promise<MemoryItemRow | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_student_memory_items")
    .select("id, student_id, memory_type, summary_text, confidence, valid_from, valid_until, source, is_active")
    .eq("id", itemId)
    .maybeSingle();
  if (error) {
    if (isMissingRelationError(error)) {
      return null;
    }
    throw new Error(`${LOG_PREFIX} FAIL: trainingpeaks_student_memory_items: ${error.message}`);
  }
  return (data as MemoryItemRow | null) ?? null;
}

async function fetchStudentById(id: string): Promise<StudentRow | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .select("id, student_id, student_name")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (isMissingRelationError(error)) {
      return null;
    }
    throw new Error(`${LOG_PREFIX} FAIL: trainingpeaks_students: ${error.message}`);
  }
  return (data as StudentRow | null) ?? null;
}

function buildProposedChanges(options: CliOptions): Report["proposed_changes"] {
  if (options.action === "deactivate") {
    return { is_active: false };
  }
  if (options.action === "expire") {
    return { valid_until: options.validUntil as string };
  }
  if (options.action === "retype") {
    return { memory_type: options.memoryType as TrainingPeaksStudentMemoryType };
  }
  return {};
}

function buildReport(memoryItem: MemoryItemRow, student: StudentRow, options: CliOptions): Report {
  return {
    mode: "dry-run",
    policy: "no_writes",
    current_memory_item: {
      id: memoryItem.id,
      student: {
        id: student.id,
        slug: student.student_id,
        name: student.student_name,
      },
      memory_type: memoryItem.memory_type,
      summary_text: memoryItem.summary_text,
      confidence: memoryItem.confidence,
      valid_from: memoryItem.valid_from,
      valid_until: memoryItem.valid_until,
      source: memoryItem.source,
      is_active: memoryItem.is_active,
    },
    proposed_action: options.action,
    proposed_changes: buildProposedChanges(options),
    safety_note:
      "Dry-run only. No database writes, no Telegram sends, no TrainingPeaks mutations, no migrations, and no backfill apply.",
  };
}

function printReadableOutput(report: Report): void {
  console.log(`${LOG_PREFIX} mode=${report.mode}`);
  console.log(`${LOG_PREFIX} policy=${report.policy}`);
  console.log(`${LOG_PREFIX} current_memory_item:`);
  console.log(`${LOG_PREFIX}   id=${report.current_memory_item.id}`);
  console.log(
    `${LOG_PREFIX}   student=${report.current_memory_item.student.name} (${report.current_memory_item.student.slug})`
  );
  console.log(`${LOG_PREFIX}   memory_type=${report.current_memory_item.memory_type}`);
  console.log(`${LOG_PREFIX}   summary_text=${JSON.stringify(report.current_memory_item.summary_text)}`);
  console.log(`${LOG_PREFIX}   confidence=${report.current_memory_item.confidence ?? "null"}`);
  console.log(`${LOG_PREFIX}   valid_from=${report.current_memory_item.valid_from ?? "null"}`);
  console.log(`${LOG_PREFIX}   valid_until=${report.current_memory_item.valid_until ?? "null"}`);
  console.log(`${LOG_PREFIX}   source=${report.current_memory_item.source}`);
  console.log(`${LOG_PREFIX}   is_active=${report.current_memory_item.is_active}`);
  console.log(`${LOG_PREFIX} proposed_action=${report.proposed_action}`);
  console.log(`${LOG_PREFIX} proposed_changes=${JSON.stringify(report.proposed_changes)}`);
  console.log(`${LOG_PREFIX} safety_note=${report.safety_note}`);
}

async function run(): Promise<void> {
  loadLocalEnvFiles();
  const options = parseCliOptions(process.argv.slice(2));

  if (options.apply) {
    throw new Error("Apply mode is not implemented yet. Review dry-run output first.");
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceRoleKey) {
    console.log(`${LOG_PREFIX} SKIP: missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY`);
    return;
  }
  if (!process.env.SUPABASE_URL) {
    process.env.SUPABASE_URL = supabaseUrl;
  }

  const memoryItem = await fetchMemoryItem(options.itemId);
  if (!memoryItem) {
    throw new Error(`${LOG_PREFIX} FAIL: memory item not found for --item-id=${options.itemId}`);
  }

  const student = await fetchStudentById(memoryItem.student_id);
  if (!student) {
    throw new Error(`${LOG_PREFIX} FAIL: student not found for memory item --item-id=${options.itemId}`);
  }

  const report = buildReport(memoryItem, student, options);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  printReadableOutput(report);
}

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.startsWith(`${LOG_PREFIX} FAIL:`) ? message : `${LOG_PREFIX} FAIL: ${message}`);
  process.exit(1);
});
