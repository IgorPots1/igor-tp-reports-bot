import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import {
  buildNutritionTrainingPeaksWeekContext,
  type NutritionTrainingPeaksWeekContext,
} from "@/features/nutrition/context";
import { loadScriptEnv, resolveSupabaseEnv } from "./lib/load-script-env";

type CliOptions = {
  studentId?: string;
  student?: string;
  from?: string;
  to?: string;
  probeTpApi?: boolean;
};

type StudentRow = {
  id: string;
  student_id: string;
  student_name: string;
  trainingpeaks_athlete_url: string;
  is_active: boolean;
};

type CacheRowBrief = {
  workoutDate: string;
  title: string;
  isPlanned: boolean;
  isCompleted: boolean;
  sportOrTypeCode: string | null;
  plannedTimeRaw: number | string | null;
  scannedAt: string;
  trainingPeaksAthleteId: number;
  trainingPeaksWorkoutId: number;
};

type CacheDbRow = {
  workout_date: string;
  title: string | null;
  is_planned: boolean;
  is_completed: boolean;
  sport_or_type_code: string | null;
  planned_time_raw: number | string | null;
  scanned_at: string;
  trainingpeaks_athlete_id: number;
  trainingpeaks_workout_id: number;
};

type ScanStatusRow = {
  scan_from: string;
  scan_to: string;
  status: string;
  planned_count: number;
  completed_count: number;
  planned_not_completed_count: number;
  upserted_rows_count: number;
  scanned_at: string;
};

type TpApiWorkoutBrief = {
  workoutDate: string;
  title: string;
  isPlanned: boolean;
  isCompleted: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--student-id" && next) {
      options.studentId = next;
      index += 1;
    } else if (arg === "--student" && next) {
      options.student = next;
      index += 1;
    } else if (arg === "--from" && next) {
      options.from = next;
      index += 1;
    } else if (arg === "--to" && next) {
      options.to = next;
      index += 1;
    } else if (arg === "--probe-tp-api") {
      options.probeTpApi = true;
    }
  }
  return options;
}

function requireIsoDate(value: string | undefined, name: string): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Missing or invalid ${name}; expected YYYY-MM-DD.`);
  }
  return value;
}

function parseAthleteIdFromUrl(value: string): number | null {
  const match = value.match(/\/athletes\/(\d+)/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function toBrief(row: CacheDbRow): CacheRowBrief {
  return {
    workoutDate: row.workout_date,
    title: row.title?.trim() || "Untitled workout",
    isPlanned: row.is_planned,
    isCompleted: row.is_completed,
    sportOrTypeCode: row.sport_or_type_code,
    plannedTimeRaw: row.planned_time_raw,
    scannedAt: row.scanned_at,
    trainingPeaksAthleteId: row.trainingpeaks_athlete_id,
    trainingPeaksWorkoutId: row.trainingpeaks_workout_id,
  };
}

function formatWorkoutBriefs(rows: CacheRowBrief[]): string[] {
  if (rows.length === 0) {
    return ["  - none"];
  }
  return rows.map(
    (row) =>
      `  - ${row.workoutDate} · ${row.title} · planned=${row.isPlanned} completed=${row.isCompleted} · athlete=${row.trainingPeaksAthleteId} · id=${row.trainingPeaksWorkoutId} · scanned=${row.scannedAt}`,
  );
}

function formatNutritionContext(context: NutritionTrainingPeaksWeekContext): string[] {
  return [
    `- period: ${context.periodFrom}..${context.periodTo}`,
    `- cacheStatus: ${context.cacheStatus}`,
    `- cacheStatusNote: ${context.cacheStatusNote}`,
    `- totalSessions: ${context.totalSessions}`,
    `- plannedSessions: ${context.plannedSessions}`,
    `- completedSessions: ${context.completedSessions}`,
    `- runningSessions: ${context.runningSessions}`,
    `- keyWorkouts: ${context.keyWorkouts.length}`,
    `- workouts in context: ${context.workouts.length}`,
    ...context.workouts.map(
      (workout) => `  - ${workout.date} · ${workout.title} · ${workout.type} · ${workout.status}`,
    ),
  ];
}

function classifyMismatch(input: {
  cacheRowsInRange: CacheRowBrief[];
  nutritionContext: NutritionTrainingPeaksWeekContext;
  athleteIdsInRange: Set<number>;
  mappedAthleteId: number | null;
}): string[] {
  const notes: string[] = [];
  if (input.cacheRowsInRange.length > 0 && input.nutritionContext.totalSessions === 0) {
    notes.push("cache has rows in range but Nutrition context returns empty — reader/filter bug likely");
  }
  if (input.cacheRowsInRange.length > 0 && input.nutritionContext.totalSessions > 0) {
    notes.push("cache and Nutrition context both see workouts — no read-path mismatch");
  }
  if (input.cacheRowsInRange.length === 0) {
    notes.push("no cache rows in target date range — upstream ingestion gap likely");
  }
  if (
    input.mappedAthleteId &&
    input.athleteIdsInRange.size > 0 &&
    !input.athleteIdsInRange.has(input.mappedAthleteId)
  ) {
    notes.push("cache rows in range use different athlete id than student mapping");
  }
  return notes;
}

async function probeTpApiWorkouts(input: {
  athleteId: number;
  from: string;
  to: string;
}): Promise<{ status: "skipped" | "ok" | "error"; details: string[] }> {
  const token = process.env.TRAININGPEAKS_API_BEARER?.trim();
  if (!token) {
    return {
      status: "skipped",
      details: ["TRAININGPEAKS_API_BEARER not set — TP API probe skipped."],
    };
  }

  const endpoint = `https://tpapi.trainingpeaks.com/fitness/v6/athletes/${input.athleteId}/workouts/${input.from}/${input.to}`;
  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "x-requested-with": "XMLHttpRequest",
      },
    });
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      return {
        status: "error",
        details: [`GET ${endpoint} failed: status=${response.status}`],
      };
    }
    if (!Array.isArray(payload)) {
      return {
        status: "error",
        details: [`GET ${endpoint} returned non-array body.`],
      };
    }

    const briefs: TpApiWorkoutBrief[] = payload
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
      .map((item) => {
        const workoutDay = typeof item.workoutDay === "string" ? item.workoutDay.slice(0, 10) : "unknown-date";
        const title = typeof item.title === "string" ? item.title.trim() || "Untitled workout" : "Untitled workout";
        return {
          workoutDate: workoutDay,
          title,
          isPlanned: item.workoutTypeValueId !== undefined && item.workoutTypeValueId !== null,
          isCompleted: item.completed === true,
        };
      })
      .filter((item) => item.workoutDate >= input.from && item.workoutDate <= input.to);

    const planned = briefs.filter((item) => item.isPlanned && !item.isCompleted);
    return {
      status: "ok",
      details: [
        `endpoint: ${endpoint}`,
        `status: ${response.status}`,
        `total items in range: ${briefs.length}`,
        `planned-not-completed in range: ${planned.length}`,
        ...briefs.map(
          (item) => `  - ${item.workoutDate} · ${item.title} · planned=${item.isPlanned} completed=${item.isCompleted}`,
        ),
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "error",
      details: [`TP API probe failed: ${message}`],
    };
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const from = requireIsoDate(options.from, "--from");
  const to = requireIsoDate(options.to, "--to");
  if (from > to) {
    throw new Error(`Invalid range: --from (${from}) is after --to (${to}).`);
  }

  loadScriptEnv();
  const env = resolveSupabaseEnv();
  if (!env) {
    throw new Error("Missing Supabase env; cannot run read-only diagnostic.");
  }

  const supabase = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let studentQuery = supabase
    .from("trainingpeaks_students")
    .select("id,student_id,student_name,trainingpeaks_athlete_url,is_active")
    .limit(2);
  if (options.studentId) {
    studentQuery = studentQuery.eq("id", options.studentId);
  } else if (options.student) {
    studentQuery = studentQuery.ilike("student_name", `%${options.student}%`);
  } else {
    throw new Error("Provide --student-id or --student.");
  }

  const { data: students, error: studentError } = await studentQuery;
  if (studentError) {
    throw new Error(`Failed to load student: ${studentError.message}`);
  }
  if (!students || students.length === 0) {
    throw new Error("Student not found.");
  }
  if (students.length > 1) {
    throw new Error(`Student selector matched multiple students: ${students.map((s) => s.student_name).join(", ")}`);
  }
  const student = students[0] as StudentRow;
  const mappedAthleteId = parseAthleteIdFromUrl(student.trainingpeaks_athlete_url);

  const { count: totalCacheRows, error: totalCountError } = await supabase
    .from("trainingpeaks_workout_cache")
    .select("id", { count: "exact", head: true })
    .eq("student_id", student.id);
  if (totalCountError) {
    throw new Error(`Failed to count cache rows: ${totalCountError.message}`);
  }

  const { data: allAthleteIds, error: athleteIdsError } = await supabase
    .from("trainingpeaks_workout_cache")
    .select("trainingpeaks_athlete_id")
    .eq("student_id", student.id);
  if (athleteIdsError) {
    throw new Error(`Failed to list athlete ids in cache: ${athleteIdsError.message}`);
  }
  const distinctAthleteIds = new Set(
    (allAthleteIds ?? []).map((row) => Number((row as { trainingpeaks_athlete_id: number }).trainingpeaks_athlete_id)),
  );

  const { data: rangeRows, error: rangeError } = await supabase
    .from("trainingpeaks_workout_cache")
    .select(
      "workout_date,title,is_planned,is_completed,sport_or_type_code,planned_time_raw,scanned_at,trainingpeaks_athlete_id,trainingpeaks_workout_id",
    )
    .eq("student_id", student.id)
    .gte("workout_date", from)
    .lte("workout_date", to)
    .order("workout_date", { ascending: true })
    .order("trainingpeaks_workout_id", { ascending: true });
  if (rangeError) {
    throw new Error(`Failed to load cache rows in range: ${rangeError.message}`);
  }

  const briefRows = ((rangeRows as CacheDbRow[]) ?? []).map(toBrief);
  const plannedRows = briefRows.filter((row) => row.isPlanned);
  const completedRows = briefRows.filter((row) => row.isCompleted);
  const plannedNotCompleted = briefRows.filter((row) => row.isPlanned && !row.isCompleted);
  const athleteIdsInRange = new Set(briefRows.map((row) => row.trainingPeaksAthleteId));

  const { data: scanStatuses, error: scanError } = await supabase
    .from("trainingpeaks_workout_cache_scan_status")
    .select(
      "scan_from,scan_to,status,planned_count,completed_count,planned_not_completed_count,upserted_rows_count,scanned_at",
    )
    .eq("student_id", student.id)
    .lte("scan_from", to)
    .gte("scan_to", from)
    .order("scanned_at", { ascending: false })
    .limit(20);
  if (scanError) {
    throw new Error(`Failed to load scan statuses: ${scanError.message}`);
  }

  const { data: latestScanAny, error: latestScanError } = await supabase
    .from("trainingpeaks_workout_cache_scan_status")
    .select("scan_from,scan_to,status,planned_not_completed_count,scanned_at")
    .eq("student_id", student.id)
    .order("scanned_at", { ascending: false })
    .limit(5);
  if (latestScanError) {
    throw new Error(`Failed to load latest scan statuses: ${latestScanError.message}`);
  }

  const nutritionContext = await buildNutritionTrainingPeaksWeekContext(student.id, from, to);
  const mismatchNotes = classifyMismatch({
    cacheRowsInRange: briefRows,
    nutritionContext,
    athleteIdsInRange,
    mappedAthleteId,
  });

  let tpApiProbe: { status: "skipped" | "ok" | "error"; details: string[] } = {
    status: "skipped",
    details: ["TP API probe not requested (pass --probe-tp-api to enable)."],
  };
  if (options.probeTpApi && mappedAthleteId) {
    tpApiProbe = await probeTpApiWorkouts({
      athleteId: mappedAthleteId,
      from,
      to,
    });
  } else if (options.probeTpApi && !mappedAthleteId) {
    tpApiProbe = {
      status: "skipped",
      details: ["Cannot probe TP API: student has no parseable athlete id in URL."],
    };
  }

  const lines = [
    "TrainingPeaks future workout cache diagnostic (read-only)",
    "",
    "Student mapping:",
    `- student_id: ${student.id}`,
    `- student slug: ${student.student_id}`,
    `- student name: ${student.student_name}`,
    `- is_active: ${student.is_active}`,
    `- trainingpeaks_athlete_url: ${student.trainingpeaks_athlete_url}`,
    `- parsed athlete id: ${mappedAthleteId ?? "none"}`,
    "",
    `Target date range: ${from}..${to}`,
    "",
    "Workout cache rows:",
    `- total rows for student: ${totalCacheRows ?? 0}`,
    `- distinct athlete ids in all cache rows: ${[...distinctAthleteIds].join(", ") || "none"}`,
    `- rows in date range: ${briefRows.length}`,
    `- planned in range: ${plannedRows.length}`,
    `- completed in range: ${completedRows.length}`,
    `- planned-not-completed in range: ${plannedNotCompleted.length}`,
    "- rows in range:",
    ...formatWorkoutBriefs(briefRows),
    "",
    "Scan status overlapping target range:",
    ...(scanStatuses && scanStatuses.length > 0
      ? (scanStatuses as ScanStatusRow[]).map(
          (row) =>
            `  - ${row.scan_from}..${row.scan_to} · status=${row.status} · upserted=${row.upserted_rows_count} · planned_nc=${row.planned_not_completed_count} · scanned=${row.scanned_at}`,
        )
      : ["  - none"]),
    "",
    "Latest scan status rows (any range):",
    ...(latestScanAny && latestScanAny.length > 0
      ? (latestScanAny as ScanStatusRow[]).map(
          (row) =>
            `  - ${row.scan_from}..${row.scan_to} · status=${row.status} · planned_nc=${row.planned_not_completed_count} · scanned=${row.scanned_at}`,
        )
      : ["  - none"]),
    "",
    "Nutrition context result (buildNutritionTrainingPeaksWeekContext):",
    ...formatNutritionContext(nutritionContext),
    "",
    "Potential mismatch:",
    ...mismatchNotes.map((note) => `- ${note}`),
    ...(briefRows.length === 0 && tpApiProbe.status === "ok"
      ? [
          `- TP API has ${tpApiProbe.details.find((line) => line.startsWith("total items")) ?? "workouts"} while cache is empty — ingestion gap confirmed`,
        ]
      : []),
    "",
    "TP API probe (read-only GET):",
    `- status: ${tpApiProbe.status}`,
    ...tpApiProbe.details.map((line) => `- ${line}`),
  ];

  console.log(lines.join("\n"));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ERROR: ${message}`);
  process.exit(1);
});
