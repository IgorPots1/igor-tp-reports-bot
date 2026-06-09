import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { loadScriptEnv, resolveSupabaseEnv } from "./lib/load-script-env";
import {
  buildNutritionStudentContext,
  type NutritionTrainingPeaksWeekContext,
} from "@/features/nutrition/context";
import {
  buildNutritionWeeklyPlanFactsFromSources,
  calculateNutritionPlanWeek,
} from "@/features/nutrition/weekly-plan-generator";
import type { NutritionWeeklyAnalysis } from "@/features/nutrition/repository";

type CliOptions = {
  studentId?: string;
  student?: string;
  weekFrom?: string;
  weekTo?: string;
};

type StudentRow = {
  id: string;
  student_id: string;
  student_name: string;
};

type AnalysisRow = {
  id: string;
  student_id: string;
  report_id: string | null;
  week_from: string;
  week_to: string;
  status: NutritionWeeklyAnalysis["status"];
  internal_summary: unknown;
  tp_past_week_context: unknown;
  tp_next_week_context: unknown;
  nutrition_summary: unknown;
  safety_flags: unknown;
  context_snapshot: unknown;
  prompt_hash: string | null;
  context_hash: string | null;
  ai_model: string | null;
  athlete_message_draft: string | null;
  coach_edits: string | null;
  created_at: string;
  updated_at: string;
};

type WorkoutBrief = {
  date: string;
  title: string;
  type: string | null;
  status?: string | null;
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
    } else if (arg === "--week-from" && next) {
      options.weekFrom = next;
      index += 1;
    } else if (arg === "--week-to" && next) {
      options.weekTo = next;
      index += 1;
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

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function toAnalysis(row: AnalysisRow): NutritionWeeklyAnalysis {
  return {
    id: row.id,
    studentId: row.student_id,
    reportId: row.report_id,
    weekFrom: row.week_from,
    weekTo: row.week_to,
    status: row.status,
    internalSummary: toObject(row.internal_summary),
    tpPastWeekContext: toObject(row.tp_past_week_context),
    tpNextWeekContext: toObject(row.tp_next_week_context),
    nutritionSummary: toObject(row.nutrition_summary),
    safetyFlags: toObject(row.safety_flags),
    contextSnapshot: toObject(row.context_snapshot),
    promptHash: row.prompt_hash,
    contextHash: row.context_hash,
    aiModel: row.ai_model,
    athleteMessageDraft: row.athlete_message_draft,
    coachEdits: row.coach_edits,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function briefSavedWorkouts(tpNextWeek: Record<string, unknown>): WorkoutBrief[] {
  const workouts = Array.isArray(tpNextWeek.workouts) ? tpNextWeek.workouts : [];
  return workouts
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    .map((workout) => ({
      date: typeof workout.date === "string" ? workout.date : "unknown-date",
      title: typeof workout.title === "string" ? workout.title : "Untitled workout",
      type: typeof workout.type === "string" ? workout.type : null,
      status: typeof workout.status === "string" ? workout.status : null,
    }));
}

function briefCurrentWorkouts(context: NutritionTrainingPeaksWeekContext): WorkoutBrief[] {
  return context.workouts.map((workout) => ({
    date: workout.date,
    title: workout.title,
    type: workout.type,
    status: workout.status,
  }));
}

function keySet(workouts: WorkoutBrief[]): Set<string> {
  return new Set(workouts.map((workout) => `${workout.date}|${workout.title}`));
}

function diffWorkouts(left: WorkoutBrief[], right: WorkoutBrief[]): WorkoutBrief[] {
  const rightKeys = keySet(right);
  return left.filter((workout) => !rightKeys.has(`${workout.date}|${workout.title}`));
}

function formatWorkouts(workouts: WorkoutBrief[]): string[] {
  if (workouts.length === 0) {
    return ["  - none"];
  }
  return workouts.map((workout) => `  - ${workout.date} · ${workout.title} · ${workout.type ?? "unknown"}${workout.status ? ` · ${workout.status}` : ""}`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const weekFrom = requireIsoDate(options.weekFrom, "--week-from");
  const weekTo = requireIsoDate(options.weekTo, "--week-to");

  loadScriptEnv();
  const env = resolveSupabaseEnv();
  if (!env) {
    throw new Error("Missing Supabase env; cannot run read-only diagnostic.");
  }

  const supabase = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let studentQuery = supabase.from("trainingpeaks_students").select("id,student_id,student_name").limit(2);
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
    throw new Error(`Student selector matched multiple students: ${students.map((student) => student.student_name).join(", ")}`);
  }
  const student = students[0] as StudentRow;

  const { data: analysisData, error: analysisError } = await supabase
    .from("nutrition_weekly_analyses")
    .select("*")
    .eq("student_id", student.id)
    .eq("week_from", weekFrom)
    .eq("week_to", weekTo)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (analysisError) {
    throw new Error(`Failed to load nutrition weekly analysis: ${analysisError.message}`);
  }
  if (!analysisData) {
    throw new Error(`No nutrition weekly analysis found for ${student.student_name} ${weekFrom}..${weekTo}.`);
  }

  const sourceAnalysis = toAnalysis(analysisData as AnalysisRow);
  const planWeek = calculateNutritionPlanWeek(sourceAnalysis.weekTo);
  const savedTpNextWeek = sourceAnalysis.tpNextWeekContext;
  const savedWorkouts = briefSavedWorkouts(savedTpNextWeek);
  const savedKeyWorkouts = Array.isArray(savedTpNextWeek.keyWorkouts) ? savedTpNextWeek.keyWorkouts : [];

  const currentContext = await buildNutritionStudentContext({
    studentId: student.id,
    weekFrom,
    weekTo,
    manualRows: [],
  });
  const currentTpNextWeek = currentContext.tpNextWeek;
  const currentWorkouts = briefCurrentWorkouts(currentTpNextWeek);

  const facts = buildNutritionWeeklyPlanFactsFromSources({
    studentId: student.id,
    studentName: student.student_name,
    formality: currentContext.resolvedCommunicationProfile.formality,
    weightKg: currentContext.currentWeightKg,
    sourceAnalysis,
    sourceReportId: sourceAnalysis.reportId,
  });

  const factsWorkouts = facts.nextWeekTraining.workouts.map((workout) => ({
    date: workout.date,
    title: workout.title ?? "Untitled workout",
    type: workout.type,
  }));
  const factsKeyWorkouts = facts.nextWeekTraining.keyWorkouts.map((workout) => ({
    date: workout.date,
    title: workout.title ?? "Untitled workout",
    type: workout.type,
  }));

  const currentOnly = diffWorkouts(currentWorkouts, savedWorkouts);
  const savedOnly = diffWorkouts(savedWorkouts, currentWorkouts);
  const savedRangeFrom = typeof savedTpNextWeek.periodFrom === "string" ? savedTpNextWeek.periodFrom : null;
  const savedRangeTo = typeof savedTpNextWeek.periodTo === "string" ? savedTpNextWeek.periodTo : null;
  const rangeMismatch = savedRangeFrom !== planWeek.from || savedRangeTo !== planWeek.to;

  const lines = [
    "Nutrition TP next-week context diagnostic",
    "",
    "Student:",
    `- id: ${student.id}`,
    `- slug: ${student.student_id}`,
    `- name: ${student.student_name}`,
    "",
    "Source review:",
    `- review id: ${sourceAnalysis.id}`,
    `- report week: ${sourceAnalysis.weekFrom}..${sourceAnalysis.weekTo}`,
    `- source report id: ${sourceAnalysis.reportId ?? "none"}`,
    `- created: ${sourceAnalysis.createdAt}`,
    `- updated: ${sourceAnalysis.updatedAt}`,
    `- has tp_next_week_context: ${Object.keys(savedTpNextWeek).length > 0 ? "yes" : "no"}`,
    `- saved tp_next_week range: ${savedRangeFrom ?? "unknown"}..${savedRangeTo ?? "unknown"}`,
    `- saved cache status: ${typeof savedTpNextWeek.cacheStatus === "string" ? savedTpNextWeek.cacheStatus : "unknown"}`,
    `- saved workouts count: ${savedWorkouts.length}`,
    `- saved key workouts count: ${savedKeyWorkouts.length}`,
    ...formatWorkouts(savedWorkouts),
    "",
    "Expected plan week:",
    `- from: ${planWeek.from}`,
    `- to: ${planWeek.to}`,
    "",
    "Current nutrition context builder / cache:",
    `- current tp_next_week range: ${currentTpNextWeek.periodFrom}..${currentTpNextWeek.periodTo}`,
    `- current cache status: ${currentTpNextWeek.cacheStatus}`,
    `- current cache note: ${currentTpNextWeek.cacheStatusNote}`,
    `- current workouts count: ${currentWorkouts.length}`,
    `- current key workouts count: ${currentTpNextWeek.keyWorkouts.length}`,
    ...formatWorkouts(currentWorkouts),
    "",
    "Diff:",
    `- range mismatch: ${rangeMismatch ? "yes" : "no"}`,
    `- workouts in current cache but not saved review context: ${currentOnly.length}`,
    ...formatWorkouts(currentOnly),
    `- workouts in saved review context but not current cache: ${savedOnly.length}`,
    ...formatWorkouts(savedOnly),
    "",
    "Weekly plan facts:",
    `- nextWeekTraining.status: ${facts.nextWeekTraining.status}`,
    `- facts workouts count: ${facts.nextWeekTraining.workouts.length}`,
    `- facts key workouts count: ${facts.nextWeekTraining.keyWorkouts.length}`,
    ...formatWorkouts(factsWorkouts),
    "- facts key workouts:",
    ...formatWorkouts(factsKeyWorkouts),
  ];

  console.log(lines.join("\n"));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ERROR: ${message}`);
  process.exit(1);
});
