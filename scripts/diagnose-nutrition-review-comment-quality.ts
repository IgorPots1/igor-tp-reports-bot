import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { buildDerivedNutritionCoachDayByDayText } from "../src/features/nutrition/combined-message";
import { getNutritionWeeklyAnalysisForWeek } from "../src/features/nutrition/repository";
import { loadScriptEnv, resolveSupabaseEnv } from "./lib/load-script-env";

const MACRO_GUARDRAILS_COMMIT_ISO = "2026-06-10T00:00:00.000Z";

type CliOptions = {
  studentId?: string;
  studentName?: string;
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
    } else if ((arg === "--student-name" || arg === "--student") && next) {
      options.studentName = next;
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

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function mentionEnergy(text: string): boolean {
  return /энерг|ккал|пустым по питанию|маловато/.test(text);
}

function mentionProtein(text: string): boolean {
  return /белок|белка/i.test(text);
}

function mentionFat(text: string): boolean {
  return /жир/i.test(text);
}

function mentionCarbs(text: string): boolean {
  return /углевод/i.test(text);
}

function isGenericTemplate(text: string): boolean {
  return /День выглядит ровно|ничего специально менять не нужно/.test(text);
}

function extractDayCommentBlock(derived: string | null, dateLabel: string): string | null {
  if (!derived) {
    return null;
  }
  const blocks = derived.split("\n\n");
  return blocks.find((block) => block.includes(`(${dateLabel})`)) ?? null;
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

  const review = await getNutritionWeeklyAnalysisForWeek({
    studentId: student.id,
    weekFrom,
    weekTo,
  });
  if (!review) {
    throw new Error(`No nutrition weekly analysis for ${weekFrom}..${weekTo}.`);
  }

  const summary = toObject(review.nutritionSummary);
  const daily = Array.isArray(summary.daily_analysis) ? summary.daily_analysis : [];
  const derived = buildDerivedNutritionCoachDayByDayText(review);
  const createdAt = review.createdAt ?? "";
  const generatedAfterMacroGuardrails = createdAt >= MACRO_GUARDRAILS_COMMIT_ISO;

  let daysWithMacroGuardrails = 0;
  let daysWithMacroIssues = 0;
  let daysWhereCommentMentionsEnergy = 0;
  let daysWhereCommentMentionsProtein = 0;
  let daysWhereCommentMentionsFat = 0;
  let daysWhereCommentMentionsCarbs = 0;
  let daysWhereCommentSaysOnlyGenericTemplate = 0;

  const hasMacroInSummary = daily.some((raw) => {
    const day = toObject(raw);
    const canonical = toObject(day.canonical_daily_analysis ?? day.canonicalDailyAnalysis);
    return Boolean(canonical.macroGuardrails ?? canonical.macro_guardrails);
  });
  const hasEnergyAvailability = daily.some((raw) => {
    const day = toObject(raw);
    const canonical = toObject(day.canonical_daily_analysis ?? day.canonicalDailyAnalysis);
    return Boolean(canonical.energyAvailability ?? canonical.energy_availability);
  });

  console.log("Nutrition review comment quality diagnostic (read-only)");
  console.log(`Student: ${student.student_name} (${student.id})`);
  console.log(`Week: ${weekFrom}..${weekTo}`);
  console.log("");
  console.log("Selected review:");
  console.log(`- id: ${review.id}`);
  console.log(`- created_at: ${createdAt}`);
  console.log(`- generated after macro guardrails rollout marker: ${yesNo(generatedAfterMacroGuardrails)}`);
  console.log(`- has macroGuardrails in nutrition_summary.daily_analysis?: ${yesNo(hasMacroInSummary)}`);
  console.log(`- has energyAvailability?: ${yesNo(hasEnergyAvailability)}`);
  console.log(`- methodology version: ${summary.methodology_version ?? summary.methodologyVersion ?? "n/a"}`);
  console.log("");

  for (const raw of daily) {
    const day = toObject(raw);
    const canonical = toObject(day.canonical_daily_analysis ?? day.canonicalDailyAnalysis);
    const macro = toObject(canonical.macroGuardrails ?? canonical.macro_guardrails);
    const protein = toObject(macro.protein);
    const fat = toObject(macro.fat);
    const carbs = toObject(macro.carbs);
    const energyAvailability = toObject(canonical.energyAvailability ?? canonical.energy_availability);
    const energyFloor = toObject(canonical.energyFloor ?? canonical.energy_floor);
    const dateLabel =
      typeof day.date_label === "string"
        ? day.date_label
        : typeof canonical.dateLabel === "string"
          ? canonical.dateLabel
          : "??.??";
    const commentBlock = extractDayCommentBlock(derived, dateLabel) ?? "";
    const commentLines = commentBlock.split("\n");
    const comment = commentLines.slice(2).join(" ").trim();

    if (Object.keys(macro).length > 0) {
      daysWithMacroGuardrails += 1;
    }
    if (
      protein.status === "low" ||
      protein.status === "borderline" ||
      fat.status === "low" ||
      fat.status === "borderline" ||
      carbs.status === "low" ||
      carbs.status === "borderline"
    ) {
      daysWithMacroIssues += 1;
    }
    if (mentionEnergy(comment)) daysWhereCommentMentionsEnergy += 1;
    if (mentionProtein(comment)) daysWhereCommentMentionsProtein += 1;
    if (mentionFat(comment)) daysWhereCommentMentionsFat += 1;
    if (mentionCarbs(comment)) daysWhereCommentMentionsCarbs += 1;
    if (isGenericTemplate(comment)) daysWhereCommentSaysOnlyGenericTemplate += 1;

    console.log(`Day ${day.date ?? canonical.date} · ${day.training_label ?? canonical.trainingLabel}`);
    console.log(
      `- macros: kcal=${day.actual_kcal ?? toObject(day.actual).kcal ?? canonical.actual} P=${day.protein_g ?? toObject(day.actual).proteinG} F=${day.fat_g ?? toObject(day.actual).fatG} C=${day.carbs_g ?? toObject(day.actual).carbsG}`
    );
    console.log(
      `- guardrails: protein=${protein.status ?? "n/a"} (${protein.gPerKg ?? "n/a"} g/kg) fat=${fat.status ?? "n/a"} (${fat.gPerKg ?? "n/a"} g/kg) carbs=${carbs.status ?? "n/a"} (${carbs.gPerKg ?? "n/a"} g/kg, range ${carbs.rangeMinGPerKg ?? "n/a"}-${carbs.rangeMaxGPerKg ?? "n/a"})`
    );
    console.log(`- nutritionStatus: ${day.nutrition_status ?? canonical.nutritionStatus ?? "n/a"}`);
    console.log(`- energyAvailability zone: ${energyAvailability.eaZone ?? energyAvailability.ea_zone ?? "n/a"}`);
    console.log(
      `- energyFloor flags: belowLoad=${energyFloor.belowLoadFloor ?? energyFloor.below_load_floor ?? "n/a"} belowCross=${energyFloor.belowCrossTrainingFloor ?? energyFloor.below_cross_training_floor ?? "n/a"}`
    );
    console.log(`- findings (canonical): ${asStringArray(canonical.findings).join(", ") || "—"}`);
    console.log(`- rendered comment: ${comment || "—"}`);
    console.log(
      `- surfaced markers: energy=${yesNo(mentionEnergy(comment))} protein=${yesNo(mentionProtein(comment))} fat=${yesNo(mentionFat(comment))} carbs=${yesNo(mentionCarbs(comment))} generic_only=${yesNo(isGenericTemplate(comment))}`
    );
    console.log("");
  }

  console.log("Summary:");
  console.log(`- days_with_macro_guardrails: ${daysWithMacroGuardrails}`);
  console.log(`- days_with_macro_issues: ${daysWithMacroIssues}`);
  console.log(`- days_where_comment_mentions_energy: ${daysWhereCommentMentionsEnergy}`);
  console.log(`- days_where_comment_mentions_protein: ${daysWhereCommentMentionsProtein}`);
  console.log(`- days_where_comment_mentions_fat: ${daysWhereCommentMentionsFat}`);
  console.log(`- days_where_comment_mentions_carbs: ${daysWhereCommentMentionsCarbs}`);
  console.log(`- days_where_comment_says_only_generic_template: ${daysWhereCommentSaysOnlyGenericTemplate}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`diagnose-nutrition-review-comment-quality failed: ${message}`);
  process.exitCode = 1;
});
