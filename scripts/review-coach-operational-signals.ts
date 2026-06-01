import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  listTrainingPeaksOperationalSignals,
  type TrainingPeaksOperationalSignalStatus,
  type TrainingPeaksOperationalSignalType,
} from "@/features/trainingpeaks/repository";
import { createSupabaseServerClient } from "@/features/supabase/server";

const LOG_PREFIX = "[review-coach-operational-signals]";
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

const ALLOWED_STATUSES: readonly TrainingPeaksOperationalSignalStatus[] = [
  "active",
  "consumed",
  "expired",
  "cancelled",
  "dismissed",
];

const ALLOWED_SIGNAL_TYPES: readonly TrainingPeaksOperationalSignalType[] = [
  "schedule_availability_window",
  "schedule_unavailability_window",
  "resume_training",
  "pause_training",
  "health_issue_started",
  "health_issue_resolved",
  "health_issue_improving",
  "move_workout_candidate",
  "plan_generation_constraint",
  "race_load_context",
];

type CliOptions = {
  status: TrainingPeaksOperationalSignalStatus | null;
  student: string | null;
  signalType: TrainingPeaksOperationalSignalType | null;
  limit: number;
  json: boolean;
};

type StudentRow = {
  id: string;
  student_id: string;
  student_name: string;
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

function parsePositiveInt(raw: string, flag: string): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${LOG_PREFIX} FAIL: invalid ${flag} value: ${raw}`);
  }
  return Math.floor(parsed);
}

function parseStatus(raw: string): TrainingPeaksOperationalSignalStatus {
  const normalized = raw.trim().toLowerCase() as TrainingPeaksOperationalSignalStatus;
  if (!ALLOWED_STATUSES.includes(normalized)) {
    throw new Error(`${LOG_PREFIX} FAIL: invalid --status value: ${raw}`);
  }
  return normalized;
}

function parseSignalType(raw: string): TrainingPeaksOperationalSignalType {
  const normalized = raw.trim().toLowerCase() as TrainingPeaksOperationalSignalType;
  if (!ALLOWED_SIGNAL_TYPES.includes(normalized)) {
    throw new Error(`${LOG_PREFIX} FAIL: invalid --signal-type value: ${raw}`);
  }
  return normalized;
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    status: null,
    student: null,
    signalType: null,
    limit: DEFAULT_LIMIT,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--json") {
      options.json = true;
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
    if (arg.startsWith("--status=")) {
      options.status = parseStatus(arg.slice("--status=".length));
      continue;
    }
    if (arg === "--status") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --status`);
      }
      options.status = parseStatus(next);
      index += 1;
      continue;
    }
    if (arg.startsWith("--student=")) {
      options.student = arg.slice("--student=".length).trim() || null;
      continue;
    }
    if (arg === "--student") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --student`);
      }
      options.student = next;
      index += 1;
      continue;
    }
    if (arg.startsWith("--signal-type=")) {
      options.signalType = parseSignalType(arg.slice("--signal-type=".length));
      continue;
    }
    if (arg === "--signal-type") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --signal-type`);
      }
      options.signalType = parseSignalType(next);
      index += 1;
      continue;
    }
  }

  return options;
}

function normalizeDate(value: string | null): string {
  return value ?? "open";
}

function extractDayTokens(structuredPayload: Record<string, unknown>): string[] {
  const available = Array.isArray(structuredPayload.available_days)
    ? structuredPayload.available_days
    : [];
  const unavailable = Array.isArray(structuredPayload.unavailable_days)
    ? structuredPayload.unavailable_days
    : [];
  const out = [...available, ...unavailable]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());
  return [...new Set(out)];
}

function compactReason(structuredPayload: Record<string, unknown>): string | null {
  const kind = structuredPayload.health_issue_kind;
  if (typeof kind === "string" && kind.trim()) {
    return kind.trim();
  }
  return null;
}

async function fetchStudentsByIds(studentIds: readonly string[]): Promise<Map<string, StudentRow>> {
  if (studentIds.length === 0) {
    return new Map();
  }
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .select("id, student_id, student_name")
    .in("id", [...studentIds])
    .limit(5000);
  if (error) {
    throw new Error(`${LOG_PREFIX} FAIL: trainingpeaks_students: ${error.message}`);
  }
  const rows = (data as StudentRow[] | null) ?? [];
  return new Map(rows.map((row) => [row.id, row]));
}

async function run(): Promise<void> {
  loadLocalEnvFiles();
  const options = parseCliOptions(process.argv.slice(2));

  const result = await listTrainingPeaksOperationalSignals({
    status: options.status ?? undefined,
    studentQuery: options.student,
    signalType: options.signalType ?? undefined,
    limit: options.limit,
  });

  const studentById = await fetchStudentsByIds([...new Set(result.items.map((item) => item.studentId))]);

  const byStudent = new Map<
    string,
    {
      studentName: string;
      studentSlug: string;
      rows: typeof result.items;
    }
  >();

  for (const item of result.items) {
    const student = studentById.get(item.studentId);
    const studentName = student?.student_name ?? `Unknown (${item.studentId.slice(0, 8)})`;
    const studentSlug = student?.student_id ?? item.studentId.slice(0, 8);
    const key = item.studentId;
    const existing = byStudent.get(key) ?? {
      studentName,
      studentSlug,
      rows: [],
    };
    existing.rows.push(item);
    byStudent.set(key, existing);
  }

  const summary = {
    total_signals: result.items.length,
    active: result.items.filter((item) => item.status === "active").length,
    consumed: result.items.filter((item) => item.status === "consumed").length,
    expired: result.items.filter((item) => item.status === "expired").length,
    dismissed: result.items.filter((item) => item.status === "dismissed").length,
    by_signal_type: result.items.reduce<Record<string, number>>((acc, item) => {
      acc[item.signalType] = (acc[item.signalType] ?? 0) + 1;
      return acc;
    }, {}),
    by_source_type: result.items.reduce<Record<string, number>>((acc, item) => {
      acc[item.sourceType] = (acc[item.sourceType] ?? 0) + 1;
      return acc;
    }, {}),
    students_with_active_signals: new Set(
      result.items.filter((item) => item.status === "active").map((item) => item.studentId)
    ).size,
  };

  if (options.json) {
    const students = [...byStudent.values()]
      .sort((a, b) => a.studentName.localeCompare(b.studentName))
      .map((entry) => ({
        student_name: entry.studentName,
        student_slug: entry.studentSlug,
        active_signals: entry.rows.filter((row) => row.status === "active").length,
        signals: entry.rows.map((row) => ({
          signal_type: row.signalType,
          status: row.status,
          valid_from: row.validFrom,
          valid_until: row.validUntil,
          source_type: row.sourceType,
          source_date: row.sourceDate,
          target_date: row.targetDate,
          source_day: row.sourceDay,
          target_day: row.targetDay,
          confidence: row.confidence,
          dedupe_key: row.dedupeKey,
        })),
      }));
    console.log(
      JSON.stringify(
        {
          mode: "read-only",
          options,
          summary,
          students,
        },
        null,
        2
      )
    );
    return;
  }

  console.log(`${LOG_PREFIX} mode=read-only`);
  console.log(`${LOG_PREFIX} filters status=${options.status ?? "all"} student=${JSON.stringify(options.student)} signal_type=${options.signalType ?? "all"}`);
  console.log(`${LOG_PREFIX} total=${result.items.length}`);

  const sortedStudents = [...byStudent.values()].sort((a, b) => a.studentName.localeCompare(b.studentName));
  for (const student of sortedStudents) {
    const activeCount = student.rows.filter((row) => row.status === "active").length;
    console.log("");
    console.log(`${student.studentName} (${student.studentSlug})`);
    console.log(`  active signals: ${activeCount}`);
    for (const row of student.rows) {
      const dayTokens = extractDayTokens(row.structuredPayload);
      const reason = compactReason(row.structuredPayload);
      const details: string[] = [
        `${row.signalType}`,
        `valid ${normalizeDate(row.validFrom)}..${normalizeDate(row.validUntil)}`,
      ];
      if (dayTokens.length > 0) {
        details.push(dayTokens.join("/"));
      }
      if (reason) {
        details.push(reason);
      }
      details.push(`source: ${row.sourceType}`);
      console.log(`  - ${details.join(" | ")}`);
    }
  }

  console.log("");
  console.log("Summary:");
  console.log(`total_signals=${summary.total_signals}`);
  console.log(`active=${summary.active}`);
  console.log(`consumed=${summary.consumed}`);
  console.log(`expired=${summary.expired}`);
  console.log(`dismissed=${summary.dismissed}`);
  console.log(`students_with_active_signals=${summary.students_with_active_signals}`);
  for (const [signalType, count] of Object.entries(summary.by_signal_type).sort((a, b) => b[1] - a[1])) {
    console.log(`by_signal_type.${signalType}=${count}`);
  }
  for (const [sourceType, count] of Object.entries(summary.by_source_type).sort((a, b) => b[1] - a[1])) {
    console.log(`by_source_type.${sourceType}=${count}`);
  }
}

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.startsWith(`${LOG_PREFIX} FAIL:`) ? message : `${LOG_PREFIX} FAIL: ${message}`);
  process.exit(1);
});
