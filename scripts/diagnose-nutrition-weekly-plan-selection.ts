import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { formatNutritionPlanTrainingContextLine } from "../src/features/nutrition/admin-labels";
import { loadScriptEnv, resolveSupabaseEnv } from "./lib/load-script-env";

type CliOptions = {
  studentId?: string;
  student?: string;
  weekFrom?: string;
  weekTo?: string;
  planWeekFrom?: string;
  planWeekTo?: string;
  planId?: string;
};

type StudentRow = {
  id: string;
  student_id: string;
  student_name: string;
};

type PlanRow = {
  id: string;
  student_id: string;
  source_report_id: string | null;
  source_analysis_id: string | null;
  plan_week_from: string;
  plan_week_to: string;
  status: string;
  generation_mode: string;
  training_context_snapshot: unknown;
  superseded_by_plan_id: string | null;
  created_at: string;
  updated_at: string;
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
    } else if (arg === "--plan-week-from" && next) {
      options.planWeekFrom = next;
      index += 1;
    } else if (arg === "--plan-week-to" && next) {
      options.planWeekTo = next;
      index += 1;
    } else if (arg === "--plan-id" && next) {
      options.planId = next;
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

function shortId(id: string): string {
  return id.slice(0, 8);
}

function countWorkouts(context: Record<string, unknown>): number {
  if (typeof context.workoutCount === "number") {
    return context.workoutCount;
  }
  const workouts = context.workouts;
  return Array.isArray(workouts) ? workouts.length : 0;
}

function countKeyWorkouts(context: Record<string, unknown>): number {
  const keyWorkouts = context.keyWorkouts;
  return Array.isArray(keyWorkouts) ? keyWorkouts.length : 0;
}

function briefKeyWorkouts(context: Record<string, unknown>): string[] {
  const keyWorkouts = context.keyWorkouts;
  if (!Array.isArray(keyWorkouts)) {
    return [];
  }
  return keyWorkouts
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    .map((workout) => {
      const date = typeof workout.date === "string" ? workout.date : "?";
      const title = typeof workout.title === "string" ? workout.title : "Untitled";
      return `${date} · ${title}`;
    });
}

function summarizeTrainingSnapshot(snapshot: Record<string, unknown>): {
  source: string | null;
  topStatus: string | null;
  topWorkoutCount: number | null;
  topKeyWorkouts: number | null;
  freshCacheStatus: string | null;
  freshWorkoutCount: number;
  freshKeyWorkoutCount: number;
  sourceReviewCacheStatus: string | null;
  sourceReviewWorkoutCount: number;
  sourceReviewKeyWorkoutCount: number;
  diffChanged: boolean | null;
  diffSourceCount: number | null;
  diffFreshCount: number | null;
  warningCount: number;
  uiLine: string;
  keyWorkoutLines: string[];
} {
  const freshContext = toObject(snapshot.fresh_context);
  const sourceReviewContext = toObject(snapshot.source_review_context);
  const diff = toObject(snapshot.diff);
  const warnings = snapshot.warnings;
  const topKeyWorkouts = snapshot.keyWorkouts;

  return {
    source: typeof snapshot.source === "string" ? snapshot.source : null,
    topStatus: typeof snapshot.status === "string" ? snapshot.status : null,
    topWorkoutCount: typeof snapshot.workoutCount === "number" ? snapshot.workoutCount : null,
    topKeyWorkouts: Array.isArray(topKeyWorkouts) ? topKeyWorkouts.length : null,
    freshCacheStatus: typeof freshContext.cacheStatus === "string" ? freshContext.cacheStatus : null,
    freshWorkoutCount: countWorkouts(freshContext),
    freshKeyWorkoutCount: countKeyWorkouts(freshContext),
    sourceReviewCacheStatus:
      typeof sourceReviewContext.cacheStatus === "string" ? sourceReviewContext.cacheStatus : null,
    sourceReviewWorkoutCount: countWorkouts(sourceReviewContext),
    sourceReviewKeyWorkoutCount: countKeyWorkouts(sourceReviewContext),
    diffChanged: typeof diff.changed === "boolean" ? diff.changed : null,
    diffSourceCount:
      typeof diff.source_review_workouts_count === "number" ? diff.source_review_workouts_count : null,
    diffFreshCount: typeof diff.fresh_workouts_count === "number" ? diff.fresh_workouts_count : null,
    warningCount: Array.isArray(warnings) ? warnings.length : 0,
    uiLine: formatNutritionPlanTrainingContextLine(snapshot),
    keyWorkoutLines: briefKeyWorkouts(freshContext).length > 0 ? briefKeyWorkouts(freshContext) : briefKeyWorkouts(snapshot),
  };
}

function printPlanSummary(plan: PlanRow, label: string): void {
  const snapshot = toObject(plan.training_context_snapshot);
  const summary = summarizeTrainingSnapshot(snapshot);
  console.log(`  [${label}] ${shortId(plan.id)} (${plan.id})`);
  console.log(`    status: ${plan.status}`);
  console.log(`    generation_mode: ${plan.generation_mode}`);
  console.log(`    created_at: ${plan.created_at}`);
  console.log(`    updated_at: ${plan.updated_at}`);
  console.log(`    superseded_by_plan_id: ${plan.superseded_by_plan_id ? shortId(plan.superseded_by_plan_id) : "—"}`);
  console.log(`    source_analysis_id: ${plan.source_analysis_id ? shortId(plan.source_analysis_id) : "—"}`);
  console.log(`    source_report_id: ${plan.source_report_id ? shortId(plan.source_report_id) : "—"}`);
  console.log(`    plan_week: ${plan.plan_week_from}..${plan.plan_week_to}`);
  console.log(`    training_context_snapshot:`);
  console.log(`      source: ${summary.source ?? "—"}`);
  console.log(`      top-level status/workoutCount/keyWorkouts: ${summary.topStatus ?? "—"} / ${summary.topWorkoutCount ?? "—"} / ${summary.topKeyWorkouts ?? "—"}`);
  console.log(
    `      fresh_context cacheStatus/workouts/keys: ${summary.freshCacheStatus ?? "—"} / ${summary.freshWorkoutCount} / ${summary.freshKeyWorkoutCount}`
  );
  console.log(
    `      source_review_context cacheStatus/workouts/keys: ${summary.sourceReviewCacheStatus ?? "—"} / ${summary.sourceReviewWorkoutCount} / ${summary.sourceReviewKeyWorkoutCount}`
  );
  console.log(
    `      diff changed/source/fresh: ${summary.diffChanged ?? "—"} / ${summary.diffSourceCount ?? "—"} / ${summary.diffFreshCount ?? "—"}`
  );
  console.log(`      warnings: ${summary.warningCount}`);
  console.log(`      UI line: ${summary.uiLine}`);
  if (summary.keyWorkoutLines.length > 0) {
    console.log(`      key workouts:`);
    for (const line of summary.keyWorkoutLines) {
      console.log(`        - ${line}`);
    }
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const weekFrom = requireIsoDate(options.weekFrom, "--week-from");
  const weekTo = requireIsoDate(options.weekTo, "--week-to");
  const planWeekFrom = requireIsoDate(options.planWeekFrom, "--plan-week-from");
  const planWeekTo = requireIsoDate(options.planWeekTo, "--plan-week-to");

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
    throw new Error(
      `Student selector matched multiple students: ${students.map((student) => student.student_name).join(", ")}`
    );
  }
  const student = students[0] as StudentRow;

  const { data: plansData, error: plansError } = await supabase
    .from("nutrition_weekly_plans")
    .select(
      "id,student_id,source_report_id,source_analysis_id,plan_week_from,plan_week_to,status,generation_mode,training_context_snapshot,superseded_by_plan_id,created_at,updated_at"
    )
    .eq("student_id", student.id)
    .eq("plan_week_from", planWeekFrom)
    .eq("plan_week_to", planWeekTo)
    .order("created_at", { ascending: false });
  if (plansError) {
    throw new Error(`Failed to load nutrition weekly plans: ${plansError.message}`);
  }
  const plans = (plansData as PlanRow[] | null) ?? [];

  let selectedByUrl: PlanRow | null = null;
  if (options.planId) {
    const normalizedPlanId = options.planId.length === 8 ? plans.find((plan) => plan.id.startsWith(options.planId!))?.id : options.planId;
    if (normalizedPlanId) {
      selectedByUrl = plans.find((plan) => plan.id === normalizedPlanId) ?? null;
    }
    if (!selectedByUrl) {
      const { data: planById, error: planByIdError } = await supabase
        .from("nutrition_weekly_plans")
        .select(
          "id,student_id,source_report_id,source_analysis_id,plan_week_from,plan_week_to,status,generation_mode,training_context_snapshot,superseded_by_plan_id,created_at,updated_at"
        )
        .eq("id", normalizedPlanId ?? options.planId)
        .maybeSingle();
      if (planByIdError) {
        throw new Error(`Failed to load plan by id: ${planByIdError.message}`);
      }
      selectedByUrl = (planById as PlanRow | null) ?? null;
    }
  }

  const latestPlan = plans[0] ?? null;
  const latestNonSuperseded =
    plans.find((plan) => plan.status !== "superseded" && plan.status !== "archived") ?? null;

  console.log("Student:");
  console.log(`  id: ${student.id}`);
  console.log(`  name: ${student.student_name}`);
  console.log(`  tp student_id: ${student.student_id}`);
  console.log("");
  console.log("Input:");
  console.log(`  report week: ${weekFrom}..${weekTo}`);
  console.log(`  plan week: ${planWeekFrom}..${planWeekTo}`);
  console.log(`  selected plan id from URL: ${options.planId ?? "—"}`);
  console.log("");
  console.log(`Plans for student/week (${plans.length}):`);
  if (plans.length === 0) {
    console.log("  - none");
  } else {
    for (const plan of plans) {
      printPlanSummary(plan, "plan");
      console.log("");
    }
  }

  console.log("Selection diagnosis:");
  console.log(`  selectedByUrl exists: ${selectedByUrl ? "yes" : "no"}`);
  if (selectedByUrl) {
    console.log(`  selectedByUrl id/status: ${shortId(selectedByUrl.id)} / ${selectedByUrl.status}`);
    console.log(`  selectedByUrl is superseded: ${selectedByUrl.status === "superseded" ? "yes" : "no"}`);
    console.log(
      `  selectedByUrl superseded_by points to latest: ${
        selectedByUrl.superseded_by_plan_id && latestPlan
          ? selectedByUrl.superseded_by_plan_id === latestPlan.id
            ? "yes"
            : `no (${shortId(selectedByUrl.superseded_by_plan_id)})`
          : "n/a"
      }`
    );
  }
  console.log(
    `  latestPlan id/status: ${latestPlan ? `${shortId(latestPlan.id)} / ${latestPlan.status}` : "—"}`
  );
  console.log(
    `  latestNonSuperseded id/status: ${latestNonSuperseded ? `${shortId(latestNonSuperseded.id)} / ${latestNonSuperseded.status}` : "—"}`
  );

  const uiWouldShow = selectedByUrl ?? latestPlan;
  if (uiWouldShow) {
    const uiSummary = summarizeTrainingSnapshot(toObject(uiWouldShow.training_context_snapshot));
    console.log(`  UI would display plan: ${shortId(uiWouldShow.id)} (${uiWouldShow.status})`);
    console.log(`  UI TrainingPeaks line: ${uiSummary.uiLine}`);
  } else {
    console.log("  UI would display plan: none");
  }

  const shouldClearUrl =
    Boolean(selectedByUrl?.status === "superseded" && latestNonSuperseded && selectedByUrl.id !== latestNonSuperseded.id);
  console.log(`  URL should be cleared/replaced: ${shouldClearUrl ? "yes" : "no"}`);
  if (shouldClearUrl && latestNonSuperseded) {
    console.log(`  recommended planId: ${latestNonSuperseded.id}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
