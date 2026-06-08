import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  listTrainingPeaksWorkoutCacheForDateRange,
  type TrainingPeaksWorkoutCacheRow,
} from "@/features/trainingpeaks/repository";

const LOG_PREFIX = "[audit-trainingpeaks-workout-details-availability]";
const REPORT_ROOT = "reports/group-workout-report-details-availability";

type Availability = {
  cache_has_avg_pace: boolean;
  cache_has_avg_hr: boolean;
  cache_has_lap_actuals: boolean;
  cache_has_interval_actuals: boolean;
  cache_has_planned_structure: boolean;
  cache_has_coach_comments: boolean;
  needs_live_tp_details_reader: boolean;
  recommended_next_step: string;
  sampled_rows: number;
  sampled_rows_with_snapshot: number;
  from: string;
  to: string;
  notes: string[];
  audit_mode: "cache_sampled" | "schema_fallback";
};

function formatTimestampPart(date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function shiftIsoDate(isoDate: string, days: number): string {
  const utc = Date.parse(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(utc)) {
    return isoDate;
  }
  return new Date(utc + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function hasKeyDeep(value: unknown, needles: string[], depth = 0): boolean {
  if (depth > 4) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => hasKeyDeep(entry, needles, depth + 1));
  }
  const record = asObject(value);
  if (!record) {
    return false;
  }
  for (const [key, nested] of Object.entries(record)) {
    const normalized = key.toLowerCase();
    if (needles.some((needle) => normalized.includes(needle))) {
      return true;
    }
    if (hasKeyDeep(nested, needles, depth + 1)) {
      return true;
    }
  }
  return false;
}

function evaluate(rows: TrainingPeaksWorkoutCacheRow[], from: string, to: string): Availability {
  const snapshots = rows
    .map((row) => row.sourceSnapshot)
    .filter((value): value is Record<string, unknown> => asObject(value) !== null);

  const hasAvgPace = snapshots.some((snapshot) =>
    hasKeyDeep(snapshot, ["avgpace", "averagepace", "pace_avg", "work_avg_pace"])
  );
  const hasAvgHr = snapshots.some((snapshot) =>
    hasKeyDeep(snapshot, ["avgheartrate", "averageheartrate", "heart_rate_avg", "work_avg_hr"])
  );
  const hasLapActuals = snapshots.some((snapshot) => hasKeyDeep(snapshot, ["lap", "split"]));
  const hasIntervalActuals = snapshots.some((snapshot) =>
    hasKeyDeep(snapshot, ["interval", "repetition", "segment"])
  );
  const hasPlannedStructure = snapshots.some((snapshot) =>
    hasKeyDeep(snapshot, ["structure", "steps", "planned_steps"])
  );
  const hasCoachComments = snapshots.some((snapshot) =>
    hasKeyDeep(snapshot, ["coachcomments", "coach_comments"])
  );

  const needsLive = !hasAvgPace || !hasAvgHr || !(hasLapActuals || hasIntervalActuals);
  const notes: string[] = [];
  if (!hasAvgPace) {
    notes.push("Average pace field was not found in sampled workout cache snapshots.");
  }
  if (!hasAvgHr) {
    notes.push("Average heart rate field was not found in sampled workout cache snapshots.");
  }
  if (!hasLapActuals && !hasIntervalActuals) {
    notes.push("Lap/interval actual structures were not found in sampled cache snapshots.");
  }
  if (!hasPlannedStructure) {
    notes.push("Planned structure fields are sparse or missing in sampled cache snapshots.");
  }
  if (!hasCoachComments) {
    notes.push("Coach comments fields are sparse or missing in sampled cache snapshots.");
  }

  return {
    cache_has_avg_pace: hasAvgPace,
    cache_has_avg_hr: hasAvgHr,
    cache_has_lap_actuals: hasLapActuals,
    cache_has_interval_actuals: hasIntervalActuals,
    cache_has_planned_structure: hasPlannedStructure,
    cache_has_coach_comments: hasCoachComments,
    needs_live_tp_details_reader: needsLive,
    recommended_next_step: needsLive
      ? "TASK 3 — TrainingPeaks Completed Workout Details Reader Probe"
      : "Proceed to integrate cache-backed analysis into controlled draft pipeline.",
    sampled_rows: rows.length,
    sampled_rows_with_snapshot: snapshots.length,
    from,
    to,
    notes,
    audit_mode: "cache_sampled",
  };
}

async function evaluateFromSchemaOnly(from: string, to: string, notes: string[]): Promise<Availability> {
  const repositorySource = await readFile(
    path.join(process.cwd(), "src/features/trainingpeaks/repository.ts"),
    "utf8"
  );
  const hasPlannedStructureHint = repositorySource.includes("source_snapshot");
  const hasCoachCommentsHint = repositorySource.includes("source_snapshot");
  const hasAvgPaceColumn = /avg.*pace|pace.*avg/u.test(repositorySource);
  const hasAvgHrColumn = /avg.*hr|avg.*heart|heart.*avg/u.test(repositorySource);
  const hasLapColumn = /\blap[s]?\b/u.test(repositorySource);
  const hasIntervalColumn = /\binterval[s]?\b/u.test(repositorySource);

  return {
    cache_has_avg_pace: hasAvgPaceColumn,
    cache_has_avg_hr: hasAvgHrColumn,
    cache_has_lap_actuals: hasLapColumn,
    cache_has_interval_actuals: hasIntervalColumn,
    cache_has_planned_structure: hasPlannedStructureHint,
    cache_has_coach_comments: hasCoachCommentsHint,
    needs_live_tp_details_reader: true,
    recommended_next_step: "TASK 3 — TrainingPeaks Completed Workout Details Reader Probe",
    sampled_rows: 0,
    sampled_rows_with_snapshot: 0,
    from,
    to,
    notes,
    audit_mode: "schema_fallback",
  };
}

function buildSummaryMarkdown(availability: Availability, reportDir: string): string {
  const lines: string[] = [];
  lines.push("# Group Workout Report Details Availability");
  lines.push("");
  lines.push(`- sampled_rows: ${availability.sampled_rows}`);
  lines.push(`- sampled_rows_with_snapshot: ${availability.sampled_rows_with_snapshot}`);
  lines.push(`- date_window: ${availability.from}..${availability.to}`);
  lines.push(`- cache_has_avg_pace: ${availability.cache_has_avg_pace}`);
  lines.push(`- cache_has_avg_hr: ${availability.cache_has_avg_hr}`);
  lines.push(`- cache_has_lap_actuals: ${availability.cache_has_lap_actuals}`);
  lines.push(`- cache_has_interval_actuals: ${availability.cache_has_interval_actuals}`);
  lines.push(`- cache_has_planned_structure: ${availability.cache_has_planned_structure}`);
  lines.push(`- cache_has_coach_comments: ${availability.cache_has_coach_comments}`);
  lines.push(`- needs_live_tp_details_reader: ${availability.needs_live_tp_details_reader}`);
  lines.push(`- recommended_next_step: ${availability.recommended_next_step}`);
  lines.push("");
  if (availability.notes.length > 0) {
    lines.push("## Notes");
    for (const note of availability.notes) {
      lines.push(`- ${note}`);
    }
    lines.push("");
  }
  lines.push("## Report Files");
  lines.push(`- ${path.join(reportDir, "availability.json")}`);
  return `${lines.join("\n")}\n`;
}

async function run(): Promise<void> {
  const to = process.env.TP_DETAILS_AUDIT_TO?.trim() || isoToday();
  const lookbackDaysRaw = process.env.TP_DETAILS_AUDIT_LOOKBACK_DAYS?.trim();
  const lookbackDays = lookbackDaysRaw ? Math.max(1, Number.parseInt(lookbackDaysRaw, 10) || 30) : 30;
  const from = process.env.TP_DETAILS_AUDIT_FROM?.trim() || shiftIsoDate(to, -(lookbackDays - 1));

  let availability: Availability;
  try {
    const rows = await listTrainingPeaksWorkoutCacheForDateRange({ from, to });
    availability = evaluate(rows, from, to);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    availability = await evaluateFromSchemaOnly(from, to, [
      "DB cache sampling was not available in this environment.",
      `Fallback reason: ${reason}`,
      "Result is based on repository/schema inspection and should be re-run with SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY for data-backed confirmation.",
    ]);
  }

  const stamp = formatTimestampPart();
  const reportDir = path.join(process.cwd(), REPORT_ROOT, stamp);
  await mkdir(reportDir, { recursive: true });

  const jsonPath = path.join(reportDir, "availability.json");
  const summaryPath = path.join(reportDir, "SUMMARY.md");

  await writeFile(jsonPath, `${JSON.stringify(availability, null, 2)}\n`, "utf8");
  await writeFile(summaryPath, buildSummaryMarkdown(availability, reportDir), "utf8");

  console.log(`${LOG_PREFIX} report_dir=${reportDir}`);
  console.log(`${LOG_PREFIX} availability_json=${jsonPath}`);
  console.log(`${LOG_PREFIX} summary_md=${summaryPath}`);
}

run().catch((error) => {
  console.error(`${LOG_PREFIX} FAIL`);
  console.error(error);
  process.exitCode = 1;
});
