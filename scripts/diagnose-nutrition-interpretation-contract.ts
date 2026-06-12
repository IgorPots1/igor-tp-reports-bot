import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { buildDerivedNutritionCombinedMessage } from "../src/features/nutrition/combined-message";
import {
  countForbiddenInterpretationTerms,
  countMacroNumberWarnings,
  buildNutritionInterpretationValidationFacts,
  validateNutritionWeeklyInterpretation,
} from "../src/features/nutrition/interpretation-contract";
import {
  buildNutritionInterpretationFactsPayload,
  generateNutritionWeeklyInterpretationShadow,
  resolveNutritionInterpretationPreviousWeeksContext,
} from "../src/features/nutrition/interpretation-generator";
import {
  getLatestNutritionWeeklyPlanForStudentWeek,
  getNutritionWeeklyAnalysisForWeek,
} from "../src/features/nutrition/repository";
import { loadScriptEnv, resolveSupabaseEnv } from "./lib/load-script-env";

type CliOptions = {
  studentId?: string;
  studentName?: string;
  weekFrom?: string;
  weekTo?: string;
  reviewId?: string;
  dryRun?: boolean;
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
    } else if (arg === "--dry-run") {
      options.dryRun = true;
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

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function addIsoDays(isoDate: string, days: number): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return isoDate;
  }
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function hasPreviousWeeksContextFromReview(review: { nutritionSummary: unknown; internalSummary: unknown; contextSnapshot: unknown }): boolean {
  const summary = toObject(review.nutritionSummary);
  const internalSummary = toObject(review.internalSummary);
  const contextSnapshot = toObject(review.contextSnapshot);
  const candidates = [
    summary.previous_weeks_context,
    summary.previousWeeksContext,
    internalSummary.previous_weeks_context,
    internalSummary.previousWeeksContext,
    contextSnapshot.previous_weeks_context,
    contextSnapshot.previousWeeksContext,
  ];
  return candidates.some((candidate) => {
    if (Array.isArray(candidate)) {
      return candidate.length > 0;
    }
    return Object.keys(toObject(candidate)).length > 0;
  });
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
  } else if (options.studentName) {
    studentQuery = studentQuery.ilike("student_name", `%${options.studentName}%`);
  } else {
    throw new Error("Provide --student-id or --student-name.");
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

  let review = await getNutritionWeeklyAnalysisForWeek({
    studentId: student.id,
    weekFrom,
    weekTo,
  });
  if (options.reviewId) {
    const { data, error } = await supabase
      .from("nutrition_weekly_analyses")
      .select("*")
      .eq("id", options.reviewId)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to load review by id: ${error.message}`);
    }
    if (!data) {
      throw new Error(`Review not found: ${options.reviewId}`);
    }
    review = {
      id: data.id,
      studentId: data.student_id,
      reportId: data.report_id,
      weekFrom: data.week_from,
      weekTo: data.week_to,
      status: data.status,
      internalSummary: data.internal_summary ?? {},
      tpPastWeekContext: data.tp_past_week_context ?? {},
      tpNextWeekContext: data.tp_next_week_context ?? {},
      nutritionSummary: data.nutrition_summary ?? {},
      safetyFlags: data.safety_flags ?? {},
      contextSnapshot: data.context_snapshot ?? {},
      promptHash: data.prompt_hash,
      contextHash: data.context_hash,
      aiModel: data.ai_model,
      athleteMessageDraft: data.athlete_message_draft,
      coachEdits: data.coach_edits,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }
  if (!review) {
    throw new Error(`No nutrition weekly analysis for ${weekFrom}..${weekTo}.`);
  }

  const summary = toObject(review.nutritionSummary);
  const daily = Array.isArray(summary.daily_analysis) ? summary.daily_analysis : [];
  const canonicalDates = daily
    .map((raw) => toObject(raw))
    .map((day) => (typeof day.date === "string" ? day.date : null))
    .filter((date): date is string => Boolean(date))
    .sort();
  const coachContextRu =
    typeof summary.coach_context_ru === "string"
      ? summary.coach_context_ru
      : typeof toObject(review.contextSnapshot).coach_context_ru === "string"
        ? (toObject(review.contextSnapshot).coach_context_ru as string)
        : null;
  const athleteSignals = Array.isArray(summary.athlete_report_signals) ? summary.athlete_report_signals : [];
  const previousWeeksContext = hasPreviousWeeksContextFromReview(review);
  const storedShadow = toObject(summary.interpretation_shadow);

  const factsPayload = buildNutritionInterpretationFactsPayload({
    student: {
      name: student.student_name,
      formality: "unknown",
      coach_context_ru: coachContextRu,
    },
    athlete_report_signals: athleteSignals,
    previous_weeks_context: previousWeeksContext ? summary.previous_weeks_context ?? [{ week_from: weekFrom }] : null,
    daily_analysis: daily,
    one_focus: summary.one_focus ?? null,
    methodology_signals: summary.methodology_signals ?? null,
    data_quality: summary.data_quality_summary ?? null,
  });
  const validationFacts = buildNutritionInterpretationValidationFacts({
    dailyAnalysis: factsPayload.daily_analysis,
    hasPreviousWeeksContext: resolveNutritionInterpretationPreviousWeeksContext(factsPayload),
  });

  let mode = typeof storedShadow.mode === "string" ? storedShadow.mode : "n/a";
  let validationOk = typeof storedShadow.validation_ok === "boolean" ? storedShadow.validation_ok : false;
  let issues = Array.isArray(storedShadow.issues) ? storedShadow.issues : [];
  let interpretation = storedShadow.interpretation ?? null;

  if (options.dryRun || !storedShadow.version) {
    const shadow = await generateNutritionWeeklyInterpretationShadow({
      factsPayload,
      formality: "unknown",
      studentName: student.student_name,
    });
    mode = shadow.mode;
    const validated = validateNutritionWeeklyInterpretation(shadow.interpretation, validationFacts);
    validationOk = validated.ok;
    issues = validated.issues;
    interpretation = shadow.interpretation;
  }

  const interpretationText = JSON.stringify(interpretation ?? {});
  const forbiddenCounts = countForbiddenInterpretationTerms(interpretationText);
  const allowedMacroValues = validationFacts.dailyDates.flatMap((date) => {
    const macros = validationFacts.dayMacroValuesByDate[date];
    if (!macros) {
      return [];
    }
    return [macros.kcal, macros.proteinG, macros.fatG, macros.carbsG].filter(
      (value): value is number => value != null && Number.isFinite(value)
    );
  });
  const macroWarningCount = countMacroNumberWarnings(interpretationText, allowedMacroValues);

  console.log("Nutrition interpretation contract diagnostic (read-only)");
  console.log(`Student: ${student.student_name} (${student.id})`);
  console.log(`Review: ${review.id} · week ${review.weekFrom}..${review.weekTo}`);
  console.log(`Dry run shadow generation: ${yesNo(Boolean(options.dryRun || !storedShadow.version))}`);
  console.log("");
  console.log(`Canonical day dates (${canonicalDates.length}): ${canonicalDates.join(", ") || "none"}`);
  console.log(`coach_context_ru present?: ${yesNo(Boolean(coachContextRu && coachContextRu.trim()))}`);
  console.log(`athlete_report_signals count: ${athleteSignals.length}`);
  console.log(`previous_weeks_context present?: ${yesNo(previousWeeksContext)}`);
  console.log("");
  console.log(`interpretation mode: ${mode}`);
  console.log(`validation ok: ${yesNo(validationOk)}`);
  console.log(`comparison line allowed?: ${yesNo(previousWeeksContext)}`);
  console.log(`forbidden term counts: ${Object.keys(forbiddenCounts).length === 0 ? "none" : JSON.stringify(forbiddenCounts)}`);
  console.log(`macro number warning counts: ${macroWarningCount}`);
  console.log("");
  if (issues.length > 0) {
    console.log("Validation issues:");
    for (const issue of issues) {
      console.log(`- [${issue.severity}] ${issue.code}: ${issue.message}`);
    }
    console.log("");
  }
  if (interpretation && typeof interpretation === "object") {
    const blocks = Array.isArray((interpretation as { daily_blocks?: unknown }).daily_blocks)
      ? ((interpretation as { daily_blocks: Array<{ date: string; comment_ru: string }> }).daily_blocks ?? [])
      : [];
    console.log("Daily comments preview:");
    for (const block of blocks.slice(0, 7)) {
      const preview = block.comment_ru.length > 120 ? `${block.comment_ru.slice(0, 117)}...` : block.comment_ru;
      console.log(`- ${block.date}: ${preview}`);
    }
    const weekSummary =
      typeof (interpretation as { week_summary_ru?: unknown }).week_summary_ru === "string"
        ? (interpretation as { week_summary_ru: string }).week_summary_ru
        : "";
    const focus =
      typeof (interpretation as { one_focus_statement_ru?: unknown }).one_focus_statement_ru === "string"
        ? (interpretation as { one_focus_statement_ru: string }).one_focus_statement_ru
        : "";
    const comparison =
      (interpretation as { week_comparison_line_ru?: string | null }).week_comparison_line_ru ?? null;
    console.log("");
    console.log(`week_summary_ru: ${weekSummary || "n/a"}`);
    console.log(`one_focus_statement_ru: ${focus || "n/a"}`);
    console.log(`week_comparison_line_ru: ${comparison ?? "null"}`);
  }

  const planWeekFrom = addIsoDays(weekTo, 1);
  const planWeekTo = addIsoDays(weekTo, 7);
  const plan = await getLatestNutritionWeeklyPlanForStudentWeek({
    studentId: student.id,
    planWeekFrom,
    planWeekTo,
  });
  if (plan) {
    const combined = buildDerivedNutritionCombinedMessage({
      review,
      plan,
      formality: "ty",
      studentName: student.student_name,
    });
    console.log("");
    console.log(`production combined message uses shadow?: no (status=${combined.status})`);
    console.log(`production copy-ready text present?: ${yesNo(Boolean(combined.athleteMessageDraft))}`);
  }

}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`diagnose-nutrition-interpretation-contract failed: ${message}`);
  process.exitCode = 1;
});
