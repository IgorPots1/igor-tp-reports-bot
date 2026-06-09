import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import {
  buildDerivedNutritionCoachDayByDayText,
  buildDerivedNutritionCombinedMessage,
} from "../src/features/nutrition/combined-message";
import { calculateNutritionPlanWeek } from "../src/features/nutrition/weekly-plan-generator";
import {
  getNutritionStudentProfile,
  getNutritionWeeklyAnalysisForWeek,
  resolveNutritionWeeklyPlanForDisplay,
  type NutritionWeeklyAnalysis,
  type NutritionWeeklyPlan,
} from "../src/features/nutrition/repository";
import { loadScriptEnv, resolveSupabaseEnv } from "./lib/load-script-env";

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

function shortId(id: string): string {
  return id.slice(0, 8);
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

function containsForbiddenPhrases(text: string | null | undefined): {
  commentLabel: boolean;
  mozhnoDat: boolean;
  ukazatFakt: boolean;
  dataQuality: boolean;
  nadezhdaFullName: boolean;
  decimalMacro: boolean;
  startsWithNadyaGreeting: boolean;
} {
  const source = text ?? "";
  return {
    commentLabel: /Комментарий:/.test(source),
    mozhnoDat: /можно дать/.test(source),
    ukazatFakt: /указать факт/.test(source),
    dataQuality: /по качеству данных здесь возможна неполная картина/.test(source),
    nadezhdaFullName: /Nadezhda Ponomareva/.test(source),
    decimalMacro: /\d+\.\d+\s*г/.test(source),
    startsWithNadyaGreeting: /^Надя, привет!/m.test(source),
  };
}

function firstLines(text: string | null | undefined, count: number): string[] {
  if (!text) {
    return [];
  }
  return text.split("\n").slice(0, count);
}

function hasCanonicalDailyAnalysis(review: NutritionWeeklyAnalysis): boolean {
  const summary = toObject(review.nutritionSummary);
  const daily = summary.daily_analysis;
  return Array.isArray(daily) && daily.length > 0;
}

function hasNextWeekPlan(plan: NutritionWeeklyPlan | null): boolean {
  if (!plan) {
    return false;
  }
  const summary = toObject(plan.planSummary);
  const nextWeekPlan = toObject(summary.next_week_plan);
  return typeof nextWeekPlan.formula_version === "string" && Array.isArray(nextWeekPlan.days);
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
    throw new Error(
      `Student selector matched multiple students: ${students.map((student) => student.student_name).join(", ")}`
    );
  }
  const student = students[0] as StudentRow;

  const profile = await getNutritionStudentProfile(student.id);
  const review = await getNutritionWeeklyAnalysisForWeek({
    studentId: student.id,
    weekFrom,
    weekTo,
  });
  if (!review) {
    throw new Error(`No nutrition weekly analysis for ${weekFrom}..${weekTo}.`);
  }
  const planWeek = calculateNutritionPlanWeek(review.weekTo);
  const planResolution = await resolveNutritionWeeklyPlanForDisplay({
    studentId: student.id,
    planWeekFrom: planWeek.from,
    planWeekTo: planWeek.to,
  });
  const displayPlan = planResolution.displayPlan;

  const storedDraftChecks = containsForbiddenPhrases(review.athleteMessageDraft);
  const combined = buildDerivedNutritionCombinedMessage({
    review,
    plan: displayPlan,
    formality: "ty",
    studentName: student.student_name,
    profilePreferences: toObject(profile?.preferences ?? null),
  });
  const combinedChecks = containsForbiddenPhrases(combined.athleteMessageDraft);
  const dayLineCount = (combined.athleteMessageDraft ?? "").split("\n").filter((line) => line.startsWith("🔹 ")).length;

  console.log("Nutrition combined message render diagnostic (read-only)");
  console.log(`Student: ${student.student_name} (${shortId(student.id)})`);
  console.log(`Review week: ${weekFrom}..${weekTo}`);
  console.log(`Plan week: ${planWeek.from}..${planWeek.to}`);
  console.log("");

  console.log("Selected review:");
  console.log(`- id: ${review.id}`);
  console.log(`- created_at: ${review.createdAt}`);
  console.log(`- has canonical daily_analysis: ${yesNo(hasCanonicalDailyAnalysis(review))}`);
  console.log(`- combined day lines rendered: ${dayLineCount}`);
  console.log(`- stored athlete_message_draft contains "Комментарий:": ${yesNo(storedDraftChecks.commentLabel)}`);
  console.log(`- stored athlete_message_draft contains decimals: ${yesNo(storedDraftChecks.decimalMacro)}`);
  console.log(`- stored athlete_message_draft contains "можно дать": ${yesNo(storedDraftChecks.mozhnoDat)}`);
  console.log("");

  console.log("Resolved display plan:");
  if (!displayPlan) {
    console.log("- none");
  } else {
    console.log(`- id: ${displayPlan.id}`);
    console.log(`- status: ${displayPlan.status}`);
    console.log(`- has next_week_plan: ${yesNo(hasNextWeekPlan(displayPlan))}`);
  }
  console.log("");

  console.log("Combined result:");
  console.log(`- status: ${combined.status}`);
  console.log(`- sourceReviewId: ${combined.sourceReviewId ?? "—"}`);
  console.log(`- sourcePlanId: ${combined.sourcePlanId ?? "—"}`);
  if (combined.warnings.length > 0) {
    console.log(`- warnings: ${combined.warnings.join(" | ")}`);
  }
  console.log("- first 20 lines:");
  for (const line of firstLines(combined.athleteMessageDraft, 20)) {
    console.log(`  ${line}`);
  }
  console.log(`- contains "Комментарий:": ${yesNo(combinedChecks.commentLabel)}`);
  console.log(`- contains "можно дать": ${yesNo(combinedChecks.mozhnoDat)}`);
  console.log(`- contains "указать факт": ${yesNo(combinedChecks.ukazatFakt)}`);
  console.log(`- contains decimal macro pattern: ${yesNo(combinedChecks.decimalMacro)}`);
  console.log(`- contains "Nadezhda Ponomareva": ${yesNo(combinedChecks.nadezhdaFullName)}`);
  console.log(`- starts with "Надя, привет!": ${yesNo(combinedChecks.startsWithNadyaGreeting)}`);
  console.log("");

  console.log("Stored review draft (secondary block) — first line only:");
  const storedFirstLine = firstLines(review.athleteMessageDraft, 1)[0] ?? "—";
  console.log(`- ${storedFirstLine}`);
  console.log("");

  const summary = toObject(review.nutritionSummary);
  const storedDayByDay =
    typeof summary.day_by_day_analysis_text === "string" ? summary.day_by_day_analysis_text : null;
  const derivedCoachDayByDay = buildDerivedNutritionCoachDayByDayText(review);
  const storedDayByDayChecks = containsForbiddenPhrases(storedDayByDay);
  const coachDayByDayChecks = containsForbiddenPhrases(derivedCoachDayByDay);
  console.log("Coach day-by-day (Детали для тренера):");
  console.log(`- uses derived canonical facts: ${yesNo(Boolean(derivedCoachDayByDay))}`);
  console.log(`- stored day_by_day_analysis_text contains "Комментарий:": ${yesNo(storedDayByDayChecks.commentLabel)}`);
  console.log(`- derived coach day-by-day contains "Комментарий:": ${yesNo(coachDayByDayChecks.commentLabel)}`);
  console.log(`- derived coach day-by-day contains "можно дать": ${yesNo(coachDayByDayChecks.mozhnoDat)}`);
  console.log("- derived coach day-by-day first line:");
  console.log(`  ${firstLines(derivedCoachDayByDay, 1)[0] ?? "—"}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`diagnose-nutrition-combined-message-render failed: ${message}`);
  process.exitCode = 1;
});
