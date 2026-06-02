import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  buildCanonicalEpisodeScheduleDisplayText,
  getScheduleOperationalSignalRole,
} from "@/features/trainingpeaks/operational-schedule-display";
import {
  listTrainingPeaksOperationalSignals,
  type TrainingPeaksOperationalSignalStatus,
  type TrainingPeaksOperationalSignalType,
} from "@/features/trainingpeaks/repository";
import { createSupabaseServerClient } from "@/features/supabase/server";

const LOG_PREFIX = "[diagnose-operational-schedule-duplicates]";
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

const SCHEDULE_SIGNAL_TYPES: readonly TrainingPeaksOperationalSignalType[] = [
  "schedule_availability_window",
  "schedule_unavailability_window",
  "plan_generation_constraint",
];

type CliOptions = {
  student: string | null;
  status: TrainingPeaksOperationalSignalStatus | null;
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
      const eq = line.indexOf("=");
      if (eq <= 0) {
        continue;
      }
      const key = line.slice(0, eq).trim();
      if (!key || process.env[key] !== undefined) {
        continue;
      }
      let value = line.slice(eq + 1).trim();
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

function parseCliOptions(argv: readonly string[]): CliOptions {
  let student: string | null = null;
  let status: TrainingPeaksOperationalSignalStatus | null = "active";
  let signalType: TrainingPeaksOperationalSignalType | null = null;
  let limit = DEFAULT_LIMIT;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--student") {
      student = argv[index + 1]?.trim() || null;
      index += 1;
      continue;
    }
    if (arg === "--status") {
      status = (argv[index + 1]?.trim() as TrainingPeaksOperationalSignalStatus | undefined) ?? null;
      index += 1;
      continue;
    }
    if (arg === "--signal-type") {
      signalType = (argv[index + 1]?.trim() as TrainingPeaksOperationalSignalType | undefined) ?? null;
      index += 1;
      continue;
    }
    if (arg === "--limit") {
      const parsed = Number(argv[index + 1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        limit = Math.min(MAX_LIMIT, Math.floor(parsed));
      }
      index += 1;
    }
  }

  return { student, status, signalType, limit, json };
}

function readStringMetadata(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readResolvedAvailableDates(payload: Record<string, unknown>): string[] {
  const value = payload.resolved_available_dates;
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
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

  const scheduleSignals = result.items.filter((item) => SCHEDULE_SIGNAL_TYPES.includes(item.signalType));
  const studentById = await fetchStudentsByIds([...new Set(scheduleSignals.map((item) => item.studentId))]);

  const grouped = new Map<
    string,
    { studentId: string; episodeKey: string; signals: typeof scheduleSignals }
  >();
  for (const signal of scheduleSignals) {
    const episodeKey = readStringMetadata(signal.metadata, "episode_key") ?? "(missing episode_key)";
    const groupKey = `${signal.studentId}:${episodeKey}`;
    const existing = grouped.get(groupKey);
    if (existing) {
      existing.signals.push(signal);
      continue;
    }
    grouped.set(groupKey, {
      studentId: signal.studentId,
      episodeKey,
      signals: [signal],
    });
  }

  const episodes = [...grouped.values()]
    .map(({ studentId, episodeKey, signals }) => {
      const student = studentById.get(studentId);
      const roles = signals.reduce<Record<string, number>>((acc, signal) => {
        const role = getScheduleOperationalSignalRole(signal.signalType) ?? signal.signalType;
        acc[role] = (acc[role] ?? 0) + 1;
        return acc;
      }, {});
      const duplicateRoles = Object.entries(roles).filter(([, count]) => count > 1);
      const canonicalText = buildCanonicalEpisodeScheduleDisplayText({ signals });

      return {
        student_id: studentId,
        student_name: student?.student_name ?? null,
        episode_key: episodeKey,
        signal_count: signals.length,
        duplicate_roles: duplicateRoles.map(([role, count]) => ({ role, count })),
        has_overlay_risk: duplicateRoles.length > 0,
        canonical_display_text: canonicalText,
        signals: signals.map((signal) => ({
          signal_id: signal.id,
          signal_type: signal.signalType,
          status: signal.status,
          source_observation_id: signal.sourceObservationId,
          episode_key: readStringMetadata(signal.metadata, "episode_key"),
          episode_role: readStringMetadata(signal.metadata, "episode_role"),
          valid_from: signal.validFrom,
          valid_until: signal.validUntil,
          resolved_available_dates: readResolvedAvailableDates(signal.structuredPayload),
          duration_days:
            typeof signal.structuredPayload.duration_days === "number"
              ? signal.structuredPayload.duration_days
              : null,
          created_at: signal.createdAt,
          updated_at: signal.updatedAt,
          dedupe_key: signal.dedupeKey,
        })),
      };
    })
    .sort((left, right) => {
      if (left.has_overlay_risk !== right.has_overlay_risk) {
        return left.has_overlay_risk ? -1 : 1;
      }
      return (left.student_name ?? "").localeCompare(right.student_name ?? "", "ru-RU");
    });

  const summary = {
    mode: "read-only",
    total_schedule_signals: scheduleSignals.length,
    episode_groups: episodes.length,
    overlay_risk_groups: episodes.filter((episode) => episode.has_overlay_risk).length,
  };

  if (options.json) {
    console.log(JSON.stringify({ summary, options, episodes }, null, 2));
    return;
  }

  console.log(`${LOG_PREFIX} mode=read-only`);
  console.log(`${LOG_PREFIX} schedule_signals=${summary.total_schedule_signals}`);
  console.log(`${LOG_PREFIX} episode_groups=${summary.episode_groups}`);
  console.log(`${LOG_PREFIX} overlay_risk_groups=${summary.overlay_risk_groups}`);

  for (const episode of episodes) {
    console.log("");
    console.log(
      `${LOG_PREFIX} student=${episode.student_name ?? episode.student_id} episode_key=${episode.episode_key}`
    );
    if (episode.duplicate_roles.length > 0) {
      console.log(
        `${LOG_PREFIX} duplicate_roles=${episode.duplicate_roles
          .map((entry) => `${entry.role}:${entry.count}`)
          .join(", ")}`
      );
    }
    console.log(`${LOG_PREFIX} canonical_display_text=${episode.canonical_display_text || "(empty)"}`);
    for (const signal of episode.signals) {
      console.log(
        `${LOG_PREFIX}   signal_id=${signal.signal_id} type=${signal.signal_type} updated_at=${signal.updated_at} resolved=${signal.resolved_available_dates.join(",") || "-"} valid=${signal.valid_from ?? "-"}..${signal.valid_until ?? "-"}`
      );
    }
  }
}

run().catch((error) => {
  console.error(`${LOG_PREFIX} FAIL`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
