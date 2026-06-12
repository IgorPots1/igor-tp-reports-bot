import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { buildNutritionTrainingPeaksWeekContext } from "../src/features/nutrition/context";
import { classifyTrainingPeaksWorkoutActivity } from "../src/features/trainingpeaks/workout-activity-classification";
import { loadScriptEnv, resolveSupabaseEnv } from "./lib/load-script-env";

type CliOptions = {
  studentName?: string;
  studentId?: string;
  from?: string;
  to?: string;
};

type StudentRow = {
  id: string;
  student_id: string;
  student_name: string;
};

type WorkoutDiag = {
  date: string;
  title: string;
  status: string;
  isPlanned: boolean;
  isCompleted: boolean;
  sportOrTypeCode: string | null;
  workoutTypeValueId: number | null;
  workoutSubTypeId: number | null;
  trainingType: string;
  loadType: string;
  durationRaw: number | string | null;
  distanceRaw: number | string | null;
  isKey: boolean;
  keyReason: string;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if ((arg === "--student-name" || arg === "--student") && next) {
      options.studentName = next;
      i += 1;
    } else if (arg === "--student-id" && next) {
      options.studentId = next;
      i += 1;
    } else if ((arg === "--from" || arg === "--week-from") && next) {
      options.from = next;
      i += 1;
    } else if ((arg === "--to" || arg === "--week-to") && next) {
      options.to = next;
      i += 1;
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

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

function inferTrainingType(titleRaw: string): string {
  const title = (titleRaw ?? "").toLocaleLowerCase("ru");
  if (
    /интерв|tempo|темпо|темпов|порог|threshold|vo2|спринт|hill/.test(title) ||
    /\b\d{1,2}\s*(?:x|х|×|\*)\s*\d{1,2}\s*(?:мин|min|m)?\b/i.test(title)
  ) {
    return "hard";
  }
  if (/длитель|long\s*run|\blongrun\b/.test(title)) {
    return "long_run";
  }
  if (/легк|easy/.test(title)) {
    return "easy";
  }
  return "other";
}

function inferLoadType(isRunning: boolean, trainingType: string): string {
  if (!isRunning) {
    return "non_run";
  }
  if (trainingType === "hard" || trainingType === "long_run") {
    return "key_load";
  }
  if (trainingType === "easy") {
    return "easy_load";
  }
  return "run_other";
}

function isKeyByNutritionLogic(input: {
  title: string;
  isRunning: boolean;
  classificationReason: string;
}): { isKey: boolean; reason: string } {
  const title = (input.title ?? "").toLocaleLowerCase("ru");
  if (
    /интерв|tempo|темпо|темпов|порог|threshold|vo2|спринт|hill/.test(title) ||
    /\b\d{1,2}\s*(?:x|х|×|\*)\s*\d{1,2}\s*(?:мин|min|m)?\b/i.test(title)
  ) {
    return { isKey: true, reason: "title_pattern_quality_or_intervals" };
  }
  if (input.isRunning && /quality|race|interval/.test(input.classificationReason.toLocaleLowerCase("ru"))) {
    return { isKey: true, reason: "classification_reason_quality_race_interval" };
  }
  return { isKey: false, reason: "no_key_signal" };
}

async function resolveStudent(options: CliOptions, supabase: ReturnType<typeof createClient>): Promise<StudentRow> {
  let query = supabase.from("trainingpeaks_students").select("id,student_id,student_name").limit(5);
  if (options.studentId) {
    query = query.eq("id", options.studentId);
  } else if (options.studentName) {
    query = query.ilike("student_name", `%${options.studentName}%`);
  } else {
    throw new Error("Provide --student-id or --student-name.");
  }
  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to load student: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new Error("Student not found.");
  }
  if (data.length > 1) {
    throw new Error(
      `Student selector matched multiple candidates:\n${data.map((item) => `  - ${item.student_name} (${item.id})`).join("\n")}\nUse --student-id.`
    );
  }
  return data[0] as StudentRow;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const from = requireIsoDate(options.from, "--from");
  const to = requireIsoDate(options.to, "--to");

  loadScriptEnv();
  const env = resolveSupabaseEnv();
  if (!env) {
    throw new Error("Missing Supabase env; cannot run read-only diagnostic.");
  }
  const supabase = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const student = await resolveStudent(options, supabase);

  const { data: rawRows, error: rowsError } = await supabase
    .from("trainingpeaks_workout_cache")
    .select(
      "workout_date,title,is_planned,is_completed,planned_time_raw,completed_time_raw,planned_distance_raw,completed_distance_raw,sport_or_type_code,workout_type_value_id,workout_sub_type_id,source_snapshot"
    )
    .eq("student_id", student.id)
    .gte("workout_date", from)
    .lte("workout_date", to)
    .order("workout_date", { ascending: true });
  if (rowsError) {
    throw new Error(`Failed to load training cache rows: ${rowsError.message}`);
  }

  const context = await buildNutritionTrainingPeaksWeekContext(student.id, from, to, {
    keyWorkoutMode: "all",
  });
  const reviewContext = await buildNutritionTrainingPeaksWeekContext(student.id, from, to, {
    keyWorkoutMode: "completed_only",
  });
  const keyDateTitleSet = new Set(context.keyWorkouts.map((item) => `${item.date}::${item.title}`));
  const diagnostics: WorkoutDiag[] = ((rawRows ?? []) as Array<Record<string, unknown>>).map((row) => {
    const title = typeof row.title === "string" ? row.title : "Untitled workout";
    const date = typeof row.workout_date === "string" ? row.workout_date : "unknown-date";
    const isPlanned = row.is_planned === true;
    const isCompleted = row.is_completed === true;
    const status = isPlanned && isCompleted ? "planned_and_completed" : isCompleted ? "completed" : isPlanned ? "planned" : "other";
    const classification = classifyTrainingPeaksWorkoutActivity({
      title,
      sportOrTypeCode: typeof row.sport_or_type_code === "string" ? row.sport_or_type_code : null,
      workoutTypeValueId: typeof row.workout_type_value_id === "number" ? row.workout_type_value_id : null,
      workoutSubTypeId: typeof row.workout_sub_type_id === "number" ? row.workout_sub_type_id : null,
      sourceSnapshot: row.source_snapshot,
    });
    const trainingType = inferTrainingType(title);
    const loadType = inferLoadType(classification.isRunning, trainingType);
    const keyEval = isKeyByNutritionLogic({
      title,
      isRunning: classification.isRunning,
      classificationReason: classification.reason,
    });
    const isKey = keyEval.isKey || keyDateTitleSet.has(`${date}::${title}`);
    const keyReason = keyEval.isKey ? keyEval.reason : keyDateTitleSet.has(`${date}::${title}`) ? "selected_in_context_key_workouts" : "no_key_signal";
    return {
      date,
      title,
      status,
      isPlanned,
      isCompleted,
      sportOrTypeCode: typeof row.sport_or_type_code === "string" ? row.sport_or_type_code : null,
      workoutTypeValueId: typeof row.workout_type_value_id === "number" ? row.workout_type_value_id : null,
      workoutSubTypeId: typeof row.workout_sub_type_id === "number" ? row.workout_sub_type_id : null,
      trainingType,
      loadType,
      durationRaw: (row.completed_time_raw as number | string | null) ?? (row.planned_time_raw as number | string | null) ?? null,
      distanceRaw:
        (row.completed_distance_raw as number | string | null) ?? (row.planned_distance_raw as number | string | null) ?? null,
      isKey,
      keyReason,
    };
  });

  console.log("Nutrition TP key classification diagnostic (read-only)");
  console.log("");
  console.log("Student:");
  console.log(`- id: ${student.id}`);
  console.log(`- slug: ${student.student_id}`);
  console.log(`- name: ${student.student_name}`);
  console.log(`- week: ${from}..${to}`);
  console.log("");
  console.log("TP week context summary:");
  console.log(`- cache status: ${context.cacheStatus}`);
  console.log(`- workouts: ${context.workouts.length}`);
  console.log(`- key workouts: ${context.keyWorkouts.length}`);
  for (const item of context.keyWorkouts) {
    console.log(`  · ${item.date} · ${item.title} · ${item.type} · confidence=${item.confidence}`);
  }
  console.log(`- key workouts (review/completed-only): ${reviewContext.keyWorkouts.length}`);
  for (const item of reviewContext.keyWorkouts) {
    console.log(`  · ${item.date} · ${item.title} · ${item.type} · confidence=${item.confidence}`);
  }
  console.log("");
  console.log("Per-workout classification:");
  for (const row of diagnostics) {
    console.log(
      `- ${row.date} | ${row.title} | status=${row.status} | planned=${yesNo(row.isPlanned)} | completed=${yesNo(
        row.isCompleted
      )} | trainingType=${row.trainingType} | loadType=${row.loadType} | isKey=${yesNo(row.isKey)} | keyReason=${row.keyReason}`
    );
  }
  console.log("");
  const keyRows = diagnostics.filter((row) => row.isKey);
  console.log("Verdict helpers:");
  console.log(`- key rows total: ${keyRows.length}`);
  console.log(`- planned-only key rows: ${keyRows.filter((row) => row.status === "planned").length}`);
  console.log(
    `- easy-title key rows: ${keyRows.filter((row) => /легк|easy/i.test(row.title) && !/интерв|tempo|темп|порог|threshold|vo2|спринт|hill/i.test(row.title)).length}`
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`diagnose-nutrition-tp-key-classification failed: ${message}`);
  process.exitCode = 1;
});
