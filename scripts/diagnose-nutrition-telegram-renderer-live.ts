import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { buildDerivedNutritionCombinedMessage } from "../src/features/nutrition/combined-message";
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
  weekFrom?: string;
  weekTo?: string;
};

type StudentRow = {
  id: string;
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

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

function getDailyAnalysis(review: NutritionWeeklyAnalysis): Record<string, unknown>[] {
  const summary = toObject(review.nutritionSummary);
  return Array.isArray(summary.daily_analysis)
    ? summary.daily_analysis.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function getNextWeekPlan(plan: NutritionWeeklyPlan | null): Record<string, unknown> {
  if (!plan) {
    return {};
  }
  const summary = toObject(plan.planSummary);
  return toObject(summary.next_week_plan);
}

function getNextWeekPlanDays(plan: NutritionWeeklyPlan | null): Record<string, unknown>[] {
  const nextWeekPlan = getNextWeekPlan(plan);
  return Array.isArray(nextWeekPlan.days)
    ? nextWeekPlan.days.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function getLongRunTargetKcal(plan: NutritionWeeklyPlan | null): number | null {
  const nextWeekPlan = getNextWeekPlan(plan);
  const targets = toObject(nextWeekPlan.day_type_targets);
  return asNumber(toObject(targets.long_run).target_kcal);
}

function roundToNearest(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function formatTargetKcal(value: number | null): string {
  return value == null ? "unknown" : `~${roundToNearest(value, 100)} ккал`;
}

function resolveRawDayType(day: Record<string, unknown>): string {
  return (
    asString(day.training_type) ??
    asString(day.trainingType) ??
    asString(day.day_type) ??
    asString(day.dayType) ??
    (toObject(day.flags).long_run === true ? "long_run" : "unknown")
  );
}

function resolveRawLabel(day: Record<string, unknown>): string {
  return (
    asString(day.training_label) ??
    asString(day.trainingLabel) ??
    asString(day.training_label_raw) ??
    asString(day.trainingLabelRaw) ??
    asString(day.workout_title) ??
    asString(day.workoutTitle) ??
    asString(day.title) ??
    "none"
  );
}

function resolveFinalLabel(day: Record<string, unknown>): string {
  const dayType = resolveRawDayType(day);
  const rawLabel = resolveRawLabel(day);
  if (dayType !== "long_run" && dayType !== "longRun") {
    return rawLabel;
  }
  const distanceMatch = rawLabel.match(/(\d+(?:[,.]\d+)?)\s*(?:км|km)\b/i);
  return distanceMatch ? `длительная ${distanceMatch[1].replace(".", ",")} км` : "длительная";
}

function printRelevantPlanDays(plan: NutritionWeeklyPlan | null): void {
  const days = getNextWeekPlanDays(plan);
  const longRunTarget = getLongRunTargetKcal(plan);
  for (const day of days) {
    const rawLabel = resolveRawLabel(day);
    const dayType = resolveRawDayType(day);
    const targetKcal = asNumber(day.target_kcal ?? day.targetKcal);
    const relevant =
      dayType === "long_run" ||
      dayType === "longRun" ||
      /Бег по пульсу/i.test(rawLabel) ||
      (longRunTarget != null && targetKcal === longRunTarget);
    if (!relevant) {
      continue;
    }
    console.log(`- date: ${asString(day.date) ?? "none"}`);
    console.log(`  weekday: ${asString(day.weekday_ru) ?? asString(day.weekdayRu) ?? "none"}`);
    console.log(`  raw title/label: ${rawLabel}`);
    console.log(`  resolved day type: ${dayType}`);
    console.log(`  resolved final label: ${resolveFinalLabel(day)}`);
    console.log(`  target kcal: ${targetKcal ?? "none"}`);
    console.log(`  source object keys: ${Object.keys(day).sort().join(", ")}`);
  }
}

function printRelevantDailyAnalysis(review: NutritionWeeklyAnalysis): void {
  for (const item of getDailyAnalysis(review)) {
    const canonical = toObject(item.canonicalDailyAnalysis ?? item.canonical_daily_analysis);
    const source = Object.keys(canonical).length > 0 ? canonical : item;
    const rawLabel = resolveRawLabel(source);
    const dayType = resolveRawDayType(source);
    if (dayType !== "long_run" && dayType !== "longRun" && !/Бег по пульсу/i.test(rawLabel)) {
      continue;
    }
    console.log(`- date: ${asString(source.date) ?? "none"}`);
    console.log(`  weekday: ${asString(source.weekday_ru) ?? asString(source.weekdayRu) ?? "none"}`);
    console.log(`  raw title/label: ${rawLabel}`);
    console.log(`  resolved day type: ${dayType}`);
    console.log(`  resolved final label: ${resolveFinalLabel(source)}`);
    console.log(`  source object keys: ${Object.keys(source).sort().join(", ")}`);
  }
}

function printRelevantRenderedLines(text: string): void {
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    if (/Воскресенье|длительная|Бег по пульсу|~2500/.test(line)) {
      console.log(`${index + 1}: ${line}`);
    }
  });
}

function printLongRunValidatorTrigger(text: string, longRunTargetKcalText: string): void {
  const lines = text.split("\n");
  const triggers = lines
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => /Бег по пульсу/.test(line) && line.includes(longRunTargetKcalText) && !/длительн/i.test(line));
  if (triggers.length === 0) {
    console.log("- no final rendered line triggers long_run_label");
    return;
  }
  for (const trigger of triggers) {
    console.log(`- line ${trigger.number}: ${trigger.line}`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.studentId) {
    throw new Error("Provide --student-id.");
  }
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
  const { data: student, error: studentError } = await supabase
    .from("trainingpeaks_students")
    .select("id,student_name")
    .eq("id", options.studentId)
    .maybeSingle();
  if (studentError) {
    throw new Error(`Failed to load student: ${studentError.message}`);
  }
  if (!student) {
    throw new Error("Student not found.");
  }

  const review = await getNutritionWeeklyAnalysisForWeek({
    studentId: student.id,
    weekFrom,
    weekTo,
  });
  if (!review) {
    throw new Error(`No nutrition weekly analysis for ${weekFrom}..${weekTo}.`);
  }
  const profile = await getNutritionStudentProfile(student.id);
  const planWeek = calculateNutritionPlanWeek(review.weekTo);
  const planResolution = await resolveNutritionWeeklyPlanForDisplay({
    studentId: student.id,
    planWeekFrom: planWeek.from,
    planWeekTo: planWeek.to,
  });
  const plan = planResolution.displayPlan;

  const combined = buildDerivedNutritionCombinedMessage({
    review,
    plan,
    formality: "ty",
    studentName: (student as StudentRow).student_name,
    profilePreferences: toObject(profile?.preferences ?? null),
  });
  const renderedText = combined.renderResult.text ?? combined.athleteMessageDraft ?? "";

  console.log("Nutrition Telegram renderer live diagnostic (read-only)");
  console.log("Git/Runtime:");
  console.log("- helper version marker: post-1fe9e7a-long-run-debug");
  console.log("- renderer file imported?: yes");
  console.log("");

  console.log("Selected review:");
  console.log(`- id: ${review.id}`);
  console.log(`- week: ${review.weekFrom}..${review.weekTo}`);
  console.log(`- has canonical daily analysis: ${yesNo(getDailyAnalysis(review).length > 0)}`);
  console.log("");

  console.log("Resolved display plan:");
  console.log(`- id: ${plan?.id ?? "none"}`);
  console.log(`- status: ${plan?.status ?? "none"}`);
  console.log(`- plan_week_from/to: ${plan?.planWeekFrom ?? "none"}..${plan?.planWeekTo ?? "none"}`);
  console.log(`- has next_week_plan: ${yesNo(getNextWeekPlanDays(plan).length > 0)}`);
  console.log(`- day count: ${getNextWeekPlanDays(plan).length}`);
  console.log("");

  console.log("Long-run relevant source data: plan days");
  printRelevantPlanDays(plan);
  console.log("");

  console.log("Long-run relevant source data: daily analysis");
  printRelevantDailyAnalysis(review);
  console.log("");

  console.log("Final rendered text:");
  console.log(`- result.ok: ${combined.renderResult.ok}`);
  console.log(
    `- errors/warnings: ${combined.renderResult.issues.filter((issue) => issue.severity === "error").length}/${combined.renderResult.issues.filter((issue) => issue.severity === "warning").length}`
  );
  console.log(`- charCount: ${combined.renderResult.charCount}`);
  console.log("- relevant lines:");
  printRelevantRenderedLines(renderedText);
  console.log("");

  console.log("Validator diagnosis:");
  console.log("- long_run_label trigger lines:");
  printLongRunValidatorTrigger(renderedText, formatTargetKcal(getLongRunTargetKcal(plan)));
  console.log("- issues:");
  for (const issue of combined.renderResult.issues) {
    console.log(`  ${issue.severity}: ${issue.rule}: ${issue.message}`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`diagnose-nutrition-telegram-renderer-live failed: ${message}`);
  process.exitCode = 1;
});
