import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  listTrainingPeaksOperationalSignals,
  type TrainingPeaksOperationalSignalStatus,
  type TrainingPeaksOperationalSignalType,
} from "@/features/trainingpeaks/repository";
import { createSupabaseServerClient } from "@/features/supabase/server";
import {
  DEFAULT_COACH_TIMEZONE,
  formatFollowUpStateForText,
  getCoachTodayDateKey,
  matchesOperationalSignalFollowUpFilter,
  normalizeOperationalSignalFollowUp,
  parseCoachAsOfDate,
  type OperationalSignalFollowUpFilter,
} from "./lib/coach-operational-follow-up";

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

const ALLOWED_FOLLOW_UP_FILTERS: readonly OperationalSignalFollowUpFilter[] = [
  "pending",
  "due",
  "overdue",
  "all",
];

type CliOptions = {
  status: TrainingPeaksOperationalSignalStatus | null;
  student: string | null;
  signalType: TrainingPeaksOperationalSignalType | null;
  followUp: OperationalSignalFollowUpFilter | null;
  asOfDate: string | null;
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

function parseFollowUpFilter(raw: string): OperationalSignalFollowUpFilter {
  const normalized = raw.trim().toLowerCase() as OperationalSignalFollowUpFilter;
  if (!ALLOWED_FOLLOW_UP_FILTERS.includes(normalized)) {
    throw new Error(`${LOG_PREFIX} FAIL: invalid --follow-up value: ${raw}`);
  }
  return normalized;
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    status: null,
    student: null,
    signalType: null,
    followUp: null,
    asOfDate: null,
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
    if (arg.startsWith("--follow-up=")) {
      options.followUp = parseFollowUpFilter(arg.slice("--follow-up=".length));
      continue;
    }
    if (arg === "--follow-up") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --follow-up`);
      }
      options.followUp = parseFollowUpFilter(next);
      index += 1;
      continue;
    }
    if (arg.startsWith("--as-of=")) {
      options.asOfDate = parseCoachAsOfDate(arg.slice("--as-of=".length));
      continue;
    }
    if (arg === "--as-of") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --as-of`);
      }
      options.asOfDate = parseCoachAsOfDate(next);
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

function readStringMetadata(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readStringArrayMetadata(metadata: Record<string, unknown>, key: string): string[] {
  const value = metadata[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim());
}

function extractEpisodeFields(metadata: Record<string, unknown>): {
  episodeKey: string | null;
  episodeType: string | null;
  episodeRole: string | null;
  relatedSignalTypes: string[];
} {
  return {
    episodeKey: readStringMetadata(metadata, "episode_key"),
    episodeType: readStringMetadata(metadata, "episode_type"),
    episodeRole: readStringMetadata(metadata, "episode_role"),
    relatedSignalTypes: readStringArrayMetadata(metadata, "related_signal_types"),
  };
}

function extractFollowUpFields(metadata: Record<string, unknown>): {
  dueAt: string | null;
  kind: string | null;
  reason: string | null;
  status: string | null;
} {
  return {
    dueAt: readStringMetadata(metadata, "follow_up_due_at"),
    kind: readStringMetadata(metadata, "follow_up_kind"),
    reason: readStringMetadata(metadata, "follow_up_reason"),
    status: readStringMetadata(metadata, "follow_up_status"),
  };
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
  const asOfDate = options.asOfDate ?? getCoachTodayDateKey(DEFAULT_COACH_TIMEZONE);

  const resultBase = await listTrainingPeaksOperationalSignals({
    status: options.status ?? undefined,
    studentQuery: options.student,
    signalType: options.signalType ?? undefined,
    limit: options.limit,
  });
  const resultItems = options.followUp
    ? resultBase.items.filter((item) =>
        matchesOperationalSignalFollowUpFilter(
          normalizeOperationalSignalFollowUp(item.metadata, {
            asOfDate,
            timeZone: DEFAULT_COACH_TIMEZONE,
          }),
          options.followUp as OperationalSignalFollowUpFilter
        )
      )
    : resultBase.items;

  const result = {
    items: resultItems,
    total: resultItems.length,
  };

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
        signals: entry.rows.map((row) => {
          const episode = extractEpisodeFields(row.metadata);
          const followUp = extractFollowUpFields(row.metadata);
          const normalizedFollowUp = normalizeOperationalSignalFollowUp(row.metadata, {
            asOfDate,
            timeZone: DEFAULT_COACH_TIMEZONE,
          });
          return {
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
            episode: {
              key: episode.episodeKey,
              type: episode.episodeType,
              role: episode.episodeRole,
              related_signal_types: episode.relatedSignalTypes,
            },
            follow_up: {
              has_follow_up: normalizedFollowUp.has_follow_up,
              state: normalizedFollowUp.state,
              due_at: followUp.dueAt,
              due_date: normalizedFollowUp.due_date,
              kind: followUp.kind,
              reason: followUp.reason,
              status: followUp.status,
              days_overdue: normalizedFollowUp.days_overdue,
            },
          };
        }),
      }));
    console.log(
      JSON.stringify(
        {
          mode: "read-only",
          options: {
            ...options,
            asOfDate,
            timezone: DEFAULT_COACH_TIMEZONE,
          },
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
  console.log(
    `${LOG_PREFIX} filters status=${options.status ?? "all"} student=${JSON.stringify(options.student)} signal_type=${options.signalType ?? "all"} follow_up=${options.followUp ?? "none"} as_of=${asOfDate} tz=${DEFAULT_COACH_TIMEZONE}`
  );
  console.log(`${LOG_PREFIX} total=${result.items.length}`);

  const sortedStudents = [...byStudent.values()].sort((a, b) => a.studentName.localeCompare(b.studentName));
  for (const student of sortedStudents) {
    const activeCount = student.rows.filter((row) => row.status === "active").length;
    console.log("");
    console.log(`${student.studentName} (${student.studentSlug})`);
    console.log(`  active signals: ${activeCount}`);
    const episodeRows = student.rows
      .map((row) => {
        const episode = extractEpisodeFields(row.metadata);
        return {
          row,
          episode,
        };
      })
      .sort((a, b) => {
        const aKey = a.episode.episodeKey ?? "";
        const bKey = b.episode.episodeKey ?? "";
        if (aKey && bKey && aKey !== bKey) {
          return aKey.localeCompare(bKey);
        }
        if (aKey && !bKey) {
          return -1;
        }
        if (!aKey && bKey) {
          return 1;
        }
        return 0;
      });
    let previousEpisodeKey: string | null = null;
    for (const { row, episode } of episodeRows) {
      const dayTokens = extractDayTokens(row.structuredPayload);
      const reason = compactReason(row.structuredPayload);
      const followUp = extractFollowUpFields(row.metadata);
      const followUpNormalized = normalizeOperationalSignalFollowUp(row.metadata, {
        asOfDate,
        timeZone: DEFAULT_COACH_TIMEZONE,
      });
      if (episode.episodeKey && episode.episodeKey !== previousEpisodeKey) {
        const episodeSuffix = episode.episodeKey.slice(-12);
        console.log(`  episode ${episode.episodeType ?? "unknown"}#${episodeSuffix}`);
      }
      previousEpisodeKey = episode.episodeKey;
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
      if (episode.episodeRole) {
        details.push(`role=${episode.episodeRole}`);
      }
      if (episode.relatedSignalTypes.length > 0) {
        details.push(`related=${episode.relatedSignalTypes.join(",")}`);
      }
      if (followUpNormalized.has_follow_up) {
        details.push(`follow-up=${formatFollowUpStateForText(followUpNormalized.state)}`);
        if (followUpNormalized.due_date) {
          details.push(`follow-up due=${followUpNormalized.due_date}`);
        }
        if (followUp.kind) {
          details.push(`kind=${followUp.kind}`);
        }
        if (followUp.reason) {
          details.push(`reason=${followUp.reason}`);
        }
        if (followUp.status) {
          details.push(`status=${followUp.status}`);
        }
        if (followUpNormalized.days_overdue > 0) {
          details.push(`days_overdue=${followUpNormalized.days_overdue}`);
        }
        details.push(`signal_row=${row.id.slice(0, 8)}`);
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
