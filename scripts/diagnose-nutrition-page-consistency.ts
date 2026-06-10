import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { getNutritionAdminStudentCard } from "../src/features/nutrition/admin";
import { pickDefaultNutritionReport } from "../src/features/nutrition/admin-labels";
import {
  buildDerivedNutritionCoachDayByDayText,
  buildDerivedNutritionCombinedMessage,
} from "../src/features/nutrition/combined-message";
import { buildNutritionStudentContext, type NutritionTrainingPeaksWeekContext } from "../src/features/nutrition/context";
import { getNutritionPlanTargetWeekToday } from "../src/features/nutrition/plan-week-policy";
import { resolveNutritionWeeklyPlanForDisplay } from "../src/features/nutrition/repository";
import { loadScriptEnv, resolveSupabaseEnv } from "./lib/load-script-env";

type CliOptions = {
  studentId?: string;
  studentName?: string;
  weekFrom?: string;
  weekTo?: string;
  reviewId?: string;
  planId?: string;
  reportId?: string;
};

type StudentRow = {
  id: string;
  student_id: string;
  student_name: string;
};

type WorkoutBrief = {
  date: string;
  title: string;
  type: string | null;
  status?: string | null;
  completed?: boolean;
};

const STALE_PHRASES = [
  "Данные по питанию за день неполные",
  "Комментарий:",
  "можно дать",
] as const;

const KEY_COMMITS = {
  eaAware: "0b9ab13",
  practicalTargets: "7de22f2",
  macroGuardrails: "e2e554e",
} as const;

const EXPECTED_REVIEW_METHODOLOGY = "ea_macro_narrative_v1";
const EXPECTED_PLAN_METHODOLOGY = "practical_targets_v1";

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--student-id" && next) {
      options.studentId = next;
      index += 1;
    } else if ((arg === "--student-name" || arg === "--student") && next) {
      options.studentName = next;
      index += 1;
    } else if (arg === "--week-from" && next) {
      options.weekFrom = next;
      index += 1;
    } else if (arg === "--week-to" && next) {
      options.weekTo = next;
      index += 1;
    } else if (arg === "--review-id" && next) {
      options.reviewId = next;
      index += 1;
    } else if (arg === "--plan-id" && next) {
      options.planId = next;
      index += 1;
    } else if (arg === "--report-id" && next) {
      options.reportId = next;
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

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

function sha1(text: string): string {
  return createHash("sha1").update(text).digest("hex").slice(0, 12);
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function countPhrase(text: string, phrase: string): number {
  if (!phrase) {
    return 0;
  }
  return text.split(phrase).length - 1;
}

function findStalePhrases(text: string): string[] {
  return STALE_PHRASES.filter((phrase) => text.includes(phrase));
}

function firstLines(text: string, count: number): string[] {
  return text.split("\n").slice(0, count);
}

function resolveGitHead(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function resolveGitShortHead(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function resolveDirtyNutritionFiles(): string[] {
  try {
    const output = execSync(
      "git status --short -- scripts/diagnose-nutrition* scripts/check-nutrition* src/features/nutrition src/app/admin/coach-os/nutrition package.json",
      { encoding: "utf8" }
    ).trim();
    return output ? output.split("\n").map((line) => line.trim()) : [];
  } catch {
    return [];
  }
}

function resolveCommitDate(commit: string): string | null {
  try {
    return execSync(`git show -s --format=%ci ${commit}`, { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function isCreatedBeforeCommit(createdAt: string | null | undefined, commit: string): boolean | null {
  const commitDate = resolveCommitDate(commit);
  if (!createdAt || !commitDate) {
    return null;
  }
  return new Date(createdAt).getTime() < new Date(commitDate).getTime();
}

function briefTpWorkouts(context: NutritionTrainingPeaksWeekContext): WorkoutBrief[] {
  return context.workouts.map((workout) => ({
    date: workout.date,
    title: workout.title,
    type: workout.type,
    status: workout.status,
    completed: workout.status === "completed",
  }));
}

function briefSavedWorkouts(tpContext: Record<string, unknown>): WorkoutBrief[] {
  const workouts = Array.isArray(tpContext.workouts) ? tpContext.workouts : [];
  return workouts
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    .map((workout) => ({
      date: typeof workout.date === "string" ? workout.date : "unknown-date",
      title: typeof workout.title === "string" ? workout.title : "Untitled workout",
      type: typeof workout.type === "string" ? workout.type : null,
      status: typeof workout.status === "string" ? workout.status : null,
      completed: workout.status === "completed",
    }));
}

function countSavedTpWorkouts(tpContext: Record<string, unknown>): number {
  const workouts = tpContext.workouts;
  if (Array.isArray(workouts)) {
    return workouts.length;
  }
  if (typeof tpContext.plannedSessions === "number") {
    return tpContext.plannedSessions;
  }
  if (typeof tpContext.totalSessions === "number") {
    return tpContext.totalSessions;
  }
  return 0;
}

function countSavedTpKeyWorkouts(tpContext: Record<string, unknown>): number {
  const keyWorkouts = tpContext.keyWorkouts;
  return Array.isArray(keyWorkouts) ? keyWorkouts.length : 0;
}

function workoutsByDate(workouts: WorkoutBrief[]): Map<string, WorkoutBrief[]> {
  const map = new Map<string, WorkoutBrief[]>();
  for (const workout of workouts) {
    const existing = map.get(workout.date) ?? [];
    existing.push(workout);
    map.set(workout.date, existing);
  }
  return map;
}

function summarizeDailyRow(item: unknown): {
  date: string;
  kcal: unknown;
  protein: unknown;
  fat: unknown;
  carbs: unknown;
  trainingType: string;
  trainingLabel: string;
  nutritionStatus: string;
  hasCanonical: boolean;
  hasMacroGuardrails: boolean;
  hasEnergyAvailability: boolean;
  isRest: boolean;
} {
  const day = asObject(item);
  const canonical = asObject(day.canonicalDailyAnalysis) ?? asObject(day.canonical_daily_analysis);
  const loadClassification = asObject(day.loadClassification) ?? asObject(canonical.loadClassification);
  const actual = asObject(day.actual);
  const trainingType =
    (typeof day.training_type === "string" ? day.training_type : null) ??
    (typeof day.trainingType === "string" ? day.trainingType : null) ??
    (typeof loadClassification.trainingType === "string" ? loadClassification.trainingType : null) ??
    "unknown";
  const trainingLabel =
    (typeof day.training_label === "string" ? day.training_label : null) ??
    (typeof day.trainingLabel === "string" ? day.trainingLabel : null) ??
    "?";
  const nutritionStatus =
    (typeof day.nutrition_status === "string" ? day.nutrition_status : null) ??
    (typeof day.nutritionStatus === "string" ? day.nutritionStatus : null) ??
    "?";
  const kcal = day.kcal ?? day.actual_kcal ?? actual.kcal ?? actual.actual_kcal ?? "?";
  const protein = day.protein_g ?? day.proteinG ?? actual.protein_g ?? actual.proteinG ?? "?";
  const fat = day.fat_g ?? day.fatG ?? actual.fat_g ?? actual.fatG ?? "?";
  const carbs = day.carbs_g ?? day.carbsG ?? actual.carbs_g ?? actual.carbsG ?? "?";
  const macroGuardrails = asObject(day.macro_guardrails) ?? asObject(day.macroGuardrails) ?? asObject(canonical.macroGuardrails);
  const energyAvailability = asObject(day.energyAvailability) ?? asObject(canonical.energyAvailability);
  return {
    date: typeof day.date === "string" ? day.date : "?",
    kcal,
    protein,
    fat,
    carbs,
    trainingType,
    trainingLabel,
    nutritionStatus,
    hasCanonical: Object.keys(canonical).length > 0,
    hasMacroGuardrails: Object.keys(macroGuardrails).length > 0,
    hasEnergyAvailability: Object.keys(energyAvailability).length > 0,
    isRest: trainingType === "rest" || /отдых/i.test(trainingLabel),
  };
}

function planHasPracticalTarget(planSummary: Record<string, unknown>): boolean {
  const nextWeekPlan = asObject(planSummary.next_week_plan);
  const days = Array.isArray(nextWeekPlan.days) ? nextWeekPlan.days : [];
  return days.some((item) => {
    const day = asObject(item);
    return Boolean(day.practical_target) || Boolean(day.practicalTarget);
  });
}

function classifyRootCause(input: {
  hasPlan: boolean;
  combinedStatus: string;
  reviewCreatedBeforeEa: boolean | null;
  reviewHasMacroGuardrails: boolean;
  reviewHasEnergyAvailability: boolean;
  reviewGenerationMode: string;
  planHasPracticalTarget: boolean;
  planCreatedBeforePractical: boolean | null;
  dailyAllRest: boolean;
  freshPastKeyCount: number;
  savedPastKeyCount: number;
  coachSummaryHasKeySessions: boolean;
  coachUsesStoredDayByDay: boolean;
  storedDayByDayHasStalePhrases: boolean;
}): string[] {
  const categories: string[] = [];
  if (!input.hasPlan || input.combinedStatus === "missing_plan") {
    categories.push("A-missing-plan/focus");
  }
  if (
    input.reviewCreatedBeforeEa === true ||
    (!input.reviewHasMacroGuardrails && !input.reviewHasEnergyAvailability)
  ) {
    categories.push("B-stale-review");
  }
  if (input.hasPlan && input.planCreatedBeforePractical === true && !input.planHasPracticalTarget) {
    categories.push("C-stale-plan");
  }
  if (input.reviewGenerationMode === "fallback" || input.reviewGenerationMode === "template") {
    categories.push("D-fallback/template-review");
  }
  if (
    (input.dailyAllRest && input.freshPastKeyCount > 0) ||
    (input.coachSummaryHasKeySessions && input.dailyAllRest)
  ) {
    categories.push("E-tp-context-mismatch");
  }
  if (input.coachUsesStoredDayByDay || input.storedDayByDayHasStalePhrases) {
    categories.push("F-coach-details-legacy");
  }
  if (categories.length === 0) {
    categories.push("none-obvious");
  }
  return categories;
}

async function resolveStudent(options: CliOptions, supabase: ReturnType<typeof createClient>): Promise<StudentRow> {
  let studentQuery = supabase.from("trainingpeaks_students").select("id,student_id,student_name").limit(5);
  if (options.studentId) {
    studentQuery = studentQuery.eq("id", options.studentId);
  } else if (options.studentName) {
    studentQuery = studentQuery.ilike("student_name", `%${options.studentName}%`);
  } else {
    throw new Error("Provide --student-id or --student-name.");
  }
  const { data: students, error } = await studentQuery;
  if (error) {
    throw new Error(`Failed to load student: ${error.message}`);
  }
  if (!students || students.length === 0) {
    throw new Error("Student not found.");
  }
  if (students.length > 1) {
    throw new Error(
      `Student selector matched multiple candidates:\n${students.map((s) => `  - ${s.student_name} (${s.id})`).join("\n")}\nUse --student-id.`
    );
  }
  return students[0] as StudentRow;
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

  const student = await resolveStudent(options, supabase);
  const card = await getNutritionAdminStudentCard({
    studentId: student.id,
    weekFrom,
    weekTo,
    reviewId: options.reviewId ?? null,
  });

  const selectedReportId = pickDefaultNutritionReport(card.reports, options.reportId ?? null);
  const selectedReport = card.reports.find((report) => report.id === selectedReportId) ?? null;
  const review = card.weeklyAnalysis;
  const targetPlanWeek = review ? getNutritionPlanTargetWeekToday() : null;
  const planWeek = targetPlanWeek
    ? { from: targetPlanWeek.planWeekFrom, to: targetPlanWeek.planWeekTo, mode: targetPlanWeek.mode }
    : null;

  let planResolution: Awaited<ReturnType<typeof resolveNutritionWeeklyPlanForDisplay>> | null = null;
  if (planWeek) {
    planResolution = await resolveNutritionWeeklyPlanForDisplay({
      studentId: student.id,
      planWeekFrom: planWeek.from,
      planWeekTo: planWeek.to,
      planIdFromQuery: options.planId ?? null,
    });
  }
  const displayPlan = planResolution?.displayPlan ?? null;

  const freshReviewWeekContext = await buildNutritionStudentContext({
    studentId: student.id,
    weekFrom,
    weekTo,
    manualRows: [],
  });
  const freshTargetWeekContext = planWeek
    ? await buildNutritionStudentContext({
        studentId: student.id,
        weekFrom: planWeek.from,
        weekTo: planWeek.to,
        manualRows: [],
      })
    : null;

  const combined = buildDerivedNutritionCombinedMessage({
    review,
    plan: displayPlan,
    formality: card.context.resolvedCommunicationProfile.formality,
    studentName: card.student?.studentName ?? student.student_name,
    profilePreferences: card.profile?.preferences ?? null,
    planWeekMode: planWeek?.mode,
  });

  const summary = review ? asObject(review.nutritionSummary) : {};
  const dailyAnalysis = Array.isArray(summary.daily_analysis) ? summary.daily_analysis : [];
  const dailyRows = dailyAnalysis.map(summarizeDailyRow);
  const generationMode =
    typeof summary.generation_mode === "string" ? summary.generation_mode : review ? "fallback" : "none";
  const methodologyVersion =
    typeof summary.methodology_version === "string" ? summary.methodology_version : null;
  const coachSummaryText =
    typeof summary.coach_summary_text === "string" ? summary.coach_summary_text : "";
  const dayByDayAnalysisText =
    typeof summary.day_by_day_analysis_text === "string" ? summary.day_by_day_analysis_text : "";
  const derivedCoachDayByDay = buildDerivedNutritionCoachDayByDayText(review);
  const coachDayByDayDisplay = derivedCoachDayByDay ?? dayByDayAnalysisText;
  const coachUsesStoredDayByDay = !derivedCoachDayByDay && Boolean(dayByDayAnalysisText);
  const storedReviewDraft = review?.athleteMessageDraft ?? "";
  const storedPlanDraft = displayPlan?.athleteMessageDraft ?? "";
  const renderedText = combined.renderResult.text ?? "";

  const savedPastTp = review ? asObject(review.tpPastWeekContext) : {};
  const savedNextTp = review ? asObject(review.tpNextWeekContext) : {};
  const savedPlanTp = displayPlan ? asObject(displayPlan.trainingContextSnapshot) : {};
  const freshPastWorkouts = briefTpWorkouts(freshReviewWeekContext.tpPastWeek);
  const freshTargetWorkouts = freshTargetWeekContext
    ? briefTpWorkouts(freshTargetWeekContext.tpPastWeek)
    : [];
  const savedPastWorkouts = briefSavedWorkouts(savedPastTp);
  const savedNextWorkouts = briefSavedWorkouts(savedNextTp);

  const freshPastByDate = workoutsByDate(freshPastWorkouts);
  const dailyAllRest = dailyRows.length > 0 && dailyRows.every((row) => row.isRest);
  const reviewHasMacroGuardrails = dailyRows.some((row) => row.hasMacroGuardrails);
  const reviewHasEnergyAvailability = dailyRows.some((row) => row.hasEnergyAvailability);
  const reviewHasCanonical = dailyRows.some((row) => row.hasCanonical);
  const planSummary = displayPlan ? asObject(displayPlan.planSummary) : {};
  const hasPracticalTarget = planHasPracticalTarget(planSummary);
  const planMethodologyVersion =
    typeof planSummary.methodology_version === "string" ? planSummary.methodology_version : null;

  const reviewCreatedBeforeEa = review ? isCreatedBeforeCommit(review.createdAt, KEY_COMMITS.eaAware) : null;
  const reviewCreatedBeforeMacro = review ? isCreatedBeforeCommit(review.createdAt, KEY_COMMITS.macroGuardrails) : null;
  const planCreatedBeforePractical = displayPlan
    ? isCreatedBeforeCommit(displayPlan.createdAt, KEY_COMMITS.practicalTargets)
    : null;

  const coachSummaryHasKeySessions = /ключев/i.test(coachSummaryText) && /\d/.test(coachSummaryText);
  const storedDayByDayHasStalePhrases = findStalePhrases(dayByDayAnalysisText).length > 0;

  const rootCauseCategories = classifyRootCause({
    hasPlan: Boolean(displayPlan),
    combinedStatus: combined.status,
    reviewCreatedBeforeEa,
    reviewHasMacroGuardrails,
    reviewHasEnergyAvailability,
    reviewGenerationMode: generationMode,
    planHasPracticalTarget: hasPracticalTarget,
    planCreatedBeforePractical,
    dailyAllRest,
    freshPastKeyCount: freshReviewWeekContext.tpPastWeek.keyWorkouts.length,
    savedPastKeyCount: countSavedTpKeyWorkouts(savedPastTp),
    coachSummaryHasKeySessions,
    coachUsesStoredDayByDay,
    storedDayByDayHasStalePhrases,
  });

  console.log("Nutrition page consistency diagnostic (read-only, mirrors page.tsx selection)");
  console.log("");
  console.log("Git/runtime:");
  console.log(`- HEAD: ${resolveGitShortHead()} (${resolveGitHead()})`);
  const dirtyFiles = resolveDirtyNutritionFiles();
  console.log(`- dirty tracked nutrition files: ${dirtyFiles.length === 0 ? "none" : ""}`);
  for (const line of dirtyFiles) {
    console.log(`  ${line}`);
  }
  console.log(`- expected review methodology: ${EXPECTED_REVIEW_METHODOLOGY}`);
  console.log(`- expected plan methodology: ${EXPECTED_PLAN_METHODOLOGY}`);
  console.log("");
  console.log("Student:");
  console.log(`- id: ${student.id}`);
  console.log(`- name: ${student.student_name}`);
  console.log(`- slug: ${student.student_id}`);
  console.log(`- weight source/current: profile=${card.profile?.currentWeightKg ?? "null"} · context=${card.context.currentWeightKg ?? "null"}`);
  console.log("");
  console.log("Selected report:");
  if (!selectedReport) {
    console.log("- none");
  } else {
    console.log(`- id: ${selectedReport.id}`);
    console.log(`- week: ${selectedReport.weekFrom}..${selectedReport.weekTo}`);
    console.log(`- created_at: ${selectedReport.createdAt}`);
    console.log(`- selected by URL?: ${yesNo(Boolean(options.reportId && options.reportId === selectedReport.id))}`);
  }
  console.log("");
  console.log("Selected review:");
  if (!review) {
    console.log("- none");
  } else {
    console.log(`- id: ${review.id}`);
    console.log(`- created_at: ${review.createdAt}`);
    console.log(`- updated_at: ${review.updatedAt}`);
    console.log(`- generation mode: ${generationMode}`);
    console.log(`- selected by URL?: ${yesNo(Boolean(options.reviewId && options.reviewId === review.id))}`);
    console.log(`- review status: ${review.status}`);
    console.log(`- methodology_version: ${methodologyVersion ?? "missing"}`);
    console.log(`- created before ${KEY_COMMITS.eaAware}?: ${reviewCreatedBeforeEa == null ? "unknown" : yesNo(reviewCreatedBeforeEa)}`);
    console.log(`- created before ${KEY_COMMITS.macroGuardrails}?: ${reviewCreatedBeforeMacro == null ? "unknown" : yesNo(reviewCreatedBeforeMacro)}`);
    console.log(`- nutrition_summary.daily_analysis exists?: ${yesNo(dailyAnalysis.length > 0)} (${dailyAnalysis.length} rows)`);
    console.log(`- canonicalDailyAnalysis exists?: ${yesNo(reviewHasCanonical)}`);
    console.log(`- macroGuardrails exists?: ${yesNo(reviewHasMacroGuardrails)}`);
    console.log(`- energyAvailability exists?: ${yesNo(reviewHasEnergyAvailability)}`);
    console.log(`- stored coach_summary_text stale phrases: ${findStalePhrases(coachSummaryText).join(", ") || "none"}`);
    console.log(`- stored day_by_day stale phrases: ${findStalePhrases(dayByDayAnalysisText).join(", ") || "none"}`);
    console.log(`- all days labeled rest?: ${yesNo(dailyAllRest)}`);
  }
  console.log("");
  console.log("Selected plan/focus:");
  if (!displayPlan) {
    console.log("- missing");
    console.log(`- combined full-text blocked reason: ${combined.status}`);
  } else {
    console.log(`- id: ${displayPlan.id}`);
    console.log(`- status: ${displayPlan.status}`);
    console.log(`- created_at: ${displayPlan.createdAt}`);
    console.log(`- selected by URL/latest?: ${options.planId ? (planResolution?.planSelectedById ? "URL" : "fallback-latest") : "latest"}`);
    console.log(`- plan week: ${displayPlan.planWeekFrom}..${displayPlan.planWeekTo}`);
    console.log(`- next_week_plan exists?: ${yesNo(Boolean(asObject(planSummary.next_week_plan).days))}`);
    console.log(`- practicalTarget exists?: ${yesNo(hasPracticalTarget)}`);
    console.log(`- methodology_version: ${planMethodologyVersion ?? "missing"}`);
    console.log(`- created before ${KEY_COMMITS.practicalTargets}?: ${planCreatedBeforePractical == null ? "unknown" : yesNo(planCreatedBeforePractical)}`);
    console.log(`- stale/superseded?: ${yesNo(displayPlan.status === "superseded")}`);
    console.log(`- target week TP context count: ${countSavedTpWorkouts(savedPlanTp)} workouts · key ${countSavedTpKeyWorkouts(savedPlanTp)}`);
  }
  console.log("");
  console.log("TrainingPeaks context:");
  console.log("Saved review tp past-week (review week):");
  console.log(`- status: ${typeof savedPastTp.cacheStatus === "string" ? savedPastTp.cacheStatus : "unknown"}`);
  console.log(`- workouts: ${countSavedTpWorkouts(savedPastTp)} · key: ${countSavedTpKeyWorkouts(savedPastTp)}`);
  for (const workout of savedPastWorkouts.slice(0, 8)) {
    console.log(`  · ${workout.date} · ${workout.title} · ${workout.type ?? "?"}${workout.status ? ` · ${workout.status}` : ""}`);
  }
  console.log("Saved review tp next-week:");
  console.log(`- status: ${typeof savedNextTp.cacheStatus === "string" ? savedNextTp.cacheStatus : "unknown"}`);
  console.log(`- workouts: ${countSavedTpWorkouts(savedNextTp)} · key: ${countSavedTpKeyWorkouts(savedNextTp)}`);
  for (const workout of savedNextWorkouts.slice(0, 8)) {
    console.log(`  · ${workout.date} · ${workout.title} · ${workout.type ?? "?"}${workout.status ? ` · ${workout.status}` : ""}`);
  }
  console.log("Fresh cache review week:");
  console.log(`- status: ${freshReviewWeekContext.tpPastWeek.cacheStatus}`);
  console.log(`- workouts: ${freshReviewWeekContext.tpPastWeek.workouts.length} · key: ${freshReviewWeekContext.tpPastWeek.keyWorkouts.length}`);
  for (const workout of freshPastWorkouts.slice(0, 8)) {
    console.log(`  · ${workout.date} · ${workout.title} · ${workout.type ?? "?"}${workout.status ? ` · ${workout.status}` : ""}`);
  }
  if (freshTargetWeekContext) {
    console.log("Fresh cache target/plan week:");
    console.log(`- status: ${freshTargetWeekContext.tpPastWeek.cacheStatus}`);
    console.log(`- workouts: ${freshTargetWeekContext.tpPastWeek.workouts.length} · key: ${freshTargetWeekContext.tpPastWeek.keyWorkouts.length}`);
    for (const workout of freshTargetWorkouts.slice(0, 8)) {
      console.log(`  · ${workout.date} · ${workout.title} · ${workout.type ?? "?"}${workout.status ? ` · ${workout.status}` : ""}`);
    }
  }
  console.log("");
  console.log("Daily analysis vs TP context (review week):");
  if (dailyRows.length === 0) {
    console.log("- no daily_analysis rows");
  } else {
    for (const row of dailyRows) {
      const freshOnDate = freshPastByDate.get(row.date) ?? [];
      const mismatchRestButTp =
        row.isRest && freshOnDate.length > 0 ? "MISMATCH: daily=rest, fresh TP has workout" : null;
      const mismatchLongRunPlannedOnly =
        row.trainingType === "long_run" &&
        freshOnDate.some((w) => w.status && w.status !== "completed")
          ? "MISMATCH: daily=long_run, TP planned-only"
          : null;
      console.log(
        `- ${row.date}: nutrition=${row.kcal}/${row.protein}/${row.fat}/${row.carbs} · daily=${row.trainingLabel} (${row.trainingType}) · freshTP=${freshOnDate.length} workout(s)${mismatchRestButTp ? ` · ${mismatchRestButTp}` : ""}${mismatchLongRunPlannedOnly ? ` · ${mismatchLongRunPlannedOnly}` : ""}`
      );
    }
    if (dailyAllRest && freshReviewWeekContext.tpPastWeek.keyWorkouts.length > 0) {
      console.log("- SUMMARY MISMATCH: all daily rows rest but fresh TP has key workouts");
    }
    if (coachSummaryHasKeySessions && dailyAllRest) {
      console.log("- SUMMARY MISMATCH: coach_summary mentions key sessions but daily all rest");
    }
  }
  console.log("");
  console.log("Coach details block sources:");
  console.log(`- coach_summary_text source: stored review (never derived)`);
  console.log(`- day-by-day display source: ${derivedCoachDayByDay ? "derived from canonical daily_analysis" : dayByDayAnalysisText ? "stored day_by_day_analysis_text (fallback)" : "none"}`);
  console.log(`- derived vs stored day-by-day match?: ${yesNo(Boolean(derivedCoachDayByDay && dayByDayAnalysisText && derivedCoachDayByDay === dayByDayAnalysisText))}`);
  console.log(`- stored day-by-day stale phrases: ${findStalePhrases(dayByDayAnalysisText).join(", ") || "none"}`);
  console.log(`- derived day-by-day stale phrases: ${findStalePhrases(derivedCoachDayByDay ?? "").join(", ") || "none"}`);
  console.log(`- display day-by-day stale phrases: ${findStalePhrases(coachDayByDayDisplay).join(", ") || "none"}`);
  console.log("");
  console.log("Primary combined render:");
  console.log(`- can build full text?: ${yesNo(combined.status === "ready" || combined.status === "needs_review")}`);
  console.log(`- if no reason: ${combined.status}`);
  console.log(`- renderResult ok: ${combined.renderResult.ok}`);
  console.log(
    `- errors/warnings: ${combined.renderResult.issues.filter((i) => i.severity === "error").length}/${combined.renderResult.issues.filter((i) => i.severity === "warning").length}`
  );
  console.log(`- text hash: ${sha1(renderedText)}`);
  console.log(`- primary vs stored review draft match?: ${yesNo(renderedText === storedReviewDraft)}`);
  console.log(`- primary vs stored plan draft match?: ${yesNo(renderedText === storedPlanDraft)}`);
  console.log(`- forbidden/stale phrase counts in primary: incomplete=${countPhrase(renderedText, STALE_PHRASES[0])} · Комментарий:=${countPhrase(renderedText, STALE_PHRASES[1])} · можно дать=${countPhrase(renderedText, STALE_PHRASES[2])}`);
  console.log(`- rest labels in primary: ${renderedText.split("\n").filter((line) => /день отдыха|день без тренировки/i.test(line)).length}`);
  console.log("- first 20 lines:");
  for (const line of firstLines(renderedText, 20)) {
    console.log(`  ${line}`);
  }
  console.log("");
  console.log("Root cause categories:");
  for (const category of rootCauseCategories) {
    console.log(`- ${category}`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`diagnose-nutrition-page-consistency failed: ${message}`);
  process.exitCode = 1;
});
