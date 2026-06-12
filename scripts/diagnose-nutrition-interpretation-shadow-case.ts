import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { buildDerivedNutritionCombinedMessage } from "../src/features/nutrition/combined-message";
import {
  buildNutritionInterpretationValidationFacts,
  validateNutritionWeeklyInterpretation,
  type NutritionWeeklyInterpretation,
} from "../src/features/nutrition/interpretation-contract";
import {
  analyzeProductionText,
  analyzeShadowInterpretation,
  buildCanonicalFactsReadiness,
  compareNutritionOutputs,
} from "../src/features/nutrition/interpretation-audit";
import {
  buildNutritionInterpretationFactsPayload,
  generateNutritionWeeklyInterpretationShadow,
  resolveNutritionInterpretationPreviousWeeksContext,
} from "../src/features/nutrition/interpretation-generator";
import {
  getLatestNutritionWeeklyPlanForStudentWeek,
  getNutritionStudentDefaultWeek,
  getNutritionWeeklyAnalysisForWeek,
} from "../src/features/nutrition/repository";
import { loadScriptEnv, resolveSupabaseEnv } from "./lib/load-script-env";

type CliOptions = {
  studentName?: string;
  studentId?: string;
  weekFrom?: string;
  weekTo?: string;
  regenShadow: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { regenShadow: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if ((arg === "--student-name" || arg === "--student") && next) {
      options.studentName = next;
      index += 1;
    } else if (arg === "--student-id" && next) {
      options.studentId = next;
      index += 1;
    } else if (arg === "--week-from" && next) {
      options.weekFrom = next;
      index += 1;
    } else if (arg === "--week-to" && next) {
      options.weekTo = next;
      index += 1;
    } else if (arg === "--regen-shadow") {
      options.regenShadow = true;
    }
  }
  return options;
}

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function addIsoDays(date: string, days: number): string {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return date;
  }
  const next = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  loadScriptEnv();
  const env = resolveSupabaseEnv();
  if (!env) {
    console.log("SKIP: missing Supabase env; cannot run read-only diagnostic.");
    return;
  }
  const supabase = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let query = supabase.from("trainingpeaks_students").select("id,student_id,student_name").limit(5);
  if (options.studentId) {
    query = query.eq("id", options.studentId);
  } else if (options.studentName) {
    query = query.ilike("student_name", `%${options.studentName}%`);
  } else {
    throw new Error("Provide --student-name or --student-id.");
  }
  const { data: students, error } = await query;
  if (error) {
    throw new Error(`Failed to load student: ${error.message}`);
  }
  if (!students || students.length === 0) {
    console.log("Student not found.");
    return;
  }
  const student = students.find(
    (row) => row.student_name.toLowerCase() === (options.studentName ?? "").toLowerCase()
  ) ?? students[0];

  let weekFrom = options.weekFrom;
  let weekTo = options.weekTo;
  if (!weekFrom || !weekTo) {
    const defaultWeek = await getNutritionStudentDefaultWeek(student.id);
    if (!defaultWeek) {
      console.log(`No nutrition week found for ${student.student_name}.`);
      return;
    }
    weekFrom = defaultWeek.weekFrom;
    weekTo = defaultWeek.weekTo;
  }

  const review = await getNutritionWeeklyAnalysisForWeek({ studentId: student.id, weekFrom, weekTo });
  if (!review) {
    console.log(`No nutrition weekly analysis for ${student.student_name} ${weekFrom}..${weekTo}.`);
    return;
  }

  const summary = toObject(review.nutritionSummary);
  const daily = Array.isArray(summary.daily_analysis) ? summary.daily_analysis : [];
  const coachContext =
    typeof summary.coach_context_ru === "string" && summary.coach_context_ru.trim()
      ? summary.coach_context_ru
      : null;
  const athleteSignals = Array.isArray(summary.athlete_report_signals) ? summary.athlete_report_signals : [];
  const previousWeeksContext = Object.keys(toObject(summary.previous_weeks_context)).length > 0 ||
    (Array.isArray(summary.previous_weeks_context) && summary.previous_weeks_context.length > 0);

  const factsPayload = buildNutritionInterpretationFactsPayload({
    student: { name: student.student_name, formality: "unknown", coach_context_ru: coachContext },
    athlete_report_signals: athleteSignals,
    previous_weeks_context: previousWeeksContext ? summary.previous_weeks_context ?? [{ week_from: weekFrom }] : null,
    daily_analysis: daily,
    one_focus: summary.one_focus ?? null,
  });
  const validationFacts = buildNutritionInterpretationValidationFacts({
    dailyAnalysis: factsPayload.daily_analysis,
    hasPreviousWeeksContext: resolveNutritionInterpretationPreviousWeeksContext(factsPayload),
  });

  const storedShadow = toObject(summary.interpretation_shadow);
  let shadowMode = typeof storedShadow.mode === "string" ? storedShadow.mode : "n/a";
  let interpretation = (storedShadow.interpretation as NutritionWeeklyInterpretation | null) ?? null;
  if (options.regenShadow || !storedShadow.version) {
    const generated = await generateNutritionWeeklyInterpretationShadow({
      factsPayload,
      formality: "unknown",
      studentName: student.student_name,
    });
    shadowMode = generated.mode;
    interpretation = generated.interpretation;
  }
  const validated = validateNutritionWeeklyInterpretation(interpretation, validationFacts);
  interpretation = validated.interpretation ?? interpretation;

  const planWeekFrom = addIsoDays(weekTo, 1);
  const planWeekTo = addIsoDays(weekTo, 7);
  const plan = await getLatestNutritionWeeklyPlanForStudentWeek({ studentId: student.id, planWeekFrom, planWeekTo });
  const combined = buildDerivedNutritionCombinedMessage({
    review,
    plan,
    formality: "ty",
    studentName: student.student_name,
  });

  const readiness = buildCanonicalFactsReadiness({
    dailyAnalysis: daily,
    coachContextPresent: Boolean(coachContext),
    athleteSignalsCount: athleteSignals.length,
    previousWeeksContextPresent: previousWeeksContext,
  });
  const production = analyzeProductionText({ text: combined.athleteMessageDraft, warnings: combined.warnings });
  const shadow = analyzeShadowInterpretation({ mode: shadowMode, interpretation, issues: validated.issues, facts: validationFacts });
  const comparison = compareNutritionOutputs({ production, shadow, interpretation, readiness });

  console.log("Nutrition interpretation shadow case diagnostic (read-only)");
  console.log(`Student: ${student.student_name} (${student.id})`);
  console.log(`Week: ${weekFrom}..${weekTo} · reviewId: ${review.id} · planId: ${plan?.id ?? "n/a"}`);
  console.log("");
  console.log(`Facts: ${readiness.dailyCount} days · key=${readiness.keyWorkoutDates.join(",") || "none"} · longRun=${readiness.longRunDates.join(",") || "none"}`);
  console.log(`Production: status=${combined.status} chars=${production.charCount} repeated=${production.repeatedPhraseCounts} keyMentions=${production.keyWorkoutMentions}`);
  console.log(`Shadow: mode=${shadow.mode} validationOk=${shadow.validationOk} blocks=${shadow.dailyBlockCount} macroWarn=${shadow.macroNumberWarnings}`);
  console.log("");
  console.log(`Verdict: ${comparison.verdict}`);
  console.log(`Better signals: ${comparison.shadowBetterSignals.join(", ") || "none"}`);
  console.log(`Risk signals: ${comparison.shadowRiskSignals.join(", ") || "none"}`);
  if (validated.issues.length > 0) {
    console.log("");
    console.log("Validation issues:");
    for (const issue of validated.issues) {
      console.log(`- [${issue.severity}] ${issue.code}: ${issue.message}`);
    }
  }
  if (interpretation) {
    console.log("");
    console.log("Shadow daily comments:");
    for (const block of interpretation.daily_blocks.slice(0, 7)) {
      const preview = block.comment_ru.length > 120 ? `${block.comment_ru.slice(0, 117)}...` : block.comment_ru;
      console.log(`- ${block.date}: ${preview}`);
    }
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`diagnose-nutrition-interpretation-shadow-case failed: ${message}`);
  process.exitCode = 1;
});
