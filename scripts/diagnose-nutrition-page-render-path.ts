import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { getNutritionAdminStudentCard } from "../src/features/nutrition/admin";
import { pickDefaultNutritionReport } from "../src/features/nutrition/admin-labels";
import { buildDerivedNutritionCombinedMessage } from "../src/features/nutrition/combined-message";
import { getNutritionPlanTargetWeekToday } from "../src/features/nutrition/plan-week-policy";
import { resolveNutritionWeeklyPlanForDisplay } from "../src/features/nutrition/repository";
import { loadScriptEnv, resolveSupabaseEnv } from "./lib/load-script-env";

type CliOptions = {
  studentId?: string;
  weekFrom?: string;
  weekTo?: string;
  reviewId?: string;
  planId?: string;
  reportId?: string;
};

const FORBIDDEN_PHRASES = [
  "Данные по питанию за день неполные",
  "день без тренировки в план тренировок",
  "TrainingPeaks",
  "Бег по пульсу · ~2500",
  "по сравнению с прошлой",
  "—",
  "**",
  "Комментарий:",
  "можно дать",
] as const;

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

function countPhrase(text: string, phrase: string): number {
  if (!phrase) {
    return 0;
  }
  return text.split(phrase).length - 1;
}

function findForbiddenPhrases(text: string): string[] {
  return FORBIDDEN_PHRASES.filter((phrase) => {
    if (phrase === "—") {
      return /(^|\s)—(\s|$)/.test(text);
    }
    return text.includes(phrase);
  });
}

function firstLines(text: string, count: number): string[] {
  return text.split("\n").slice(0, count);
}

function findSundayLine(text: string): string | null {
  return text.split("\n").find((line) => /Воскресенье/.test(line) && (/длительн|Бег по пульсу|~2500/.test(line))) ?? null;
}

function findRestLines(text: string): string[] {
  return text.split("\n").filter((line) => /день отдыха|день без тренировки/i.test(line));
}

const EA_AWARE_COMMIT = "0b9ab13";
const CURRENT_METHODOLOGY_VERSION = "ea_screening_v1";

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function resolveEaCommitPresent(): boolean {
  try {
    execSync(`git merge-base --is-ancestor ${EA_AWARE_COMMIT} HEAD`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function resolveEaCommitDate(): string | null {
  try {
    return execSync(`git show -s --format=%ci ${EA_AWARE_COMMIT}`, { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function isCreatedBeforeEaCommit(createdAt: string | null | undefined): boolean | null {
  const eaCommitDate = resolveEaCommitDate();
  if (!createdAt || !eaCommitDate) {
    return null;
  }
  return new Date(createdAt).getTime() < new Date(eaCommitDate).getTime();
}

function extractMiniTableLines(text: string): string[] {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => /Мини-таблица/.test(line));
  if (start < 0) {
    return [];
  }
  const result: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.trim()) {
      break;
    }
    if (/^🍽|^📋|^🔹|^Kristina|^На этой|^Начинаем|^Делаем|^Если тренировка|^После тренировки/.test(line)) {
      break;
    }
    result.push(line);
  }
  return result;
}

function summarizeDailyAnalysis(summary: Record<string, unknown>): {
  hasEnergyAvailability: boolean;
  hasLoadClassification: boolean;
  hasEnergyFloor: boolean;
  hasMethodologyVersion: boolean;
  hasPadelCrossTraining: boolean;
  rows: string[];
} {
  const daily = Array.isArray(summary.daily_analysis) ? summary.daily_analysis : [];
  const hasMethodologyVersion =
    typeof summary.methodology_version === "string" ||
    daily.some((item) => typeof asObject(item).methodology_version === "string");
  const rows: string[] = [];
  let hasPadelCrossTraining = false;

  for (const item of daily) {
    const day = asObject(item);
    const canonical = asObject(day.canonicalDailyAnalysis) ?? asObject(day.canonical_daily_analysis);
    const energyAvailability = asObject(day.energyAvailability) ?? asObject(canonical.energyAvailability);
    const energyFloor = asObject(day.energyFloor) ?? asObject(canonical.energyFloor);
    const loadClassification = asObject(day.loadClassification) ?? asObject(canonical.loadClassification);
    const trainingType =
      (typeof day.trainingType === "string" ? day.trainingType : null) ??
      (typeof day.training_type === "string" ? day.training_type : null) ??
      (typeof loadClassification.trainingType === "string" ? loadClassification.trainingType : null) ??
      "?";
    const trainingLabel =
      (typeof day.trainingLabel === "string" ? day.trainingLabel : null) ??
      (typeof day.training_label === "string" ? day.training_label : null) ??
      "?";
    const nutritionStatus =
      (typeof day.nutritionStatus === "string" ? day.nutritionStatus : null) ??
      (typeof day.nutrition_status === "string" ? day.nutrition_status : null) ??
      "?";
    const findings = asStringArray(day.findings).join(",");
    const eaZone = typeof energyAvailability.eaZone === "string" ? energyAvailability.eaZone : "none";
    const belowLoadFloor = energyFloor.belowLoadFloor === true ? "yes" : "no";
    if (/padel/i.test(trainingLabel) && trainingType === "cross_training") {
      hasPadelCrossTraining = true;
    }
    rows.push(
      [
        day.date ?? "?",
        trainingLabel,
        `type=${trainingType}`,
        `kcal=${day.kcal ?? "?"}`,
        `status=${nutritionStatus}`,
        `ea=${eaZone}`,
        `belowLoadFloor=${belowLoadFloor}`,
        findings ? `findings=${findings}` : "findings=none",
      ].join(" | ")
    );
  }

  return {
    hasEnergyAvailability: daily.some((item) => {
      const day = asObject(item);
      const canonical = asObject(day.canonicalDailyAnalysis) ?? asObject(day.canonical_daily_analysis);
      return Boolean(day.energyAvailability) || Boolean(canonical.energyAvailability);
    }),
    hasLoadClassification: daily.some((item) => {
      const day = asObject(item);
      const canonical = asObject(day.canonicalDailyAnalysis) ?? asObject(day.canonical_daily_analysis);
      return Boolean(day.loadClassification) || Boolean(canonical.loadClassification);
    }),
    hasEnergyFloor: daily.some((item) => {
      const day = asObject(item);
      const canonical = asObject(day.canonicalDailyAnalysis) ?? asObject(day.canonical_daily_analysis);
      return Boolean(day.energyFloor) || Boolean(canonical.energyFloor);
    }),
    hasMethodologyVersion,
    hasPadelCrossTraining,
    rows,
  };
}

function summarizePlanDays(planSummary: Record<string, unknown>): string[] {
  const nextWeekPlan = asObject(planSummary.next_week_plan);
  const days = Array.isArray(nextWeekPlan.days) ? nextWeekPlan.days : [];
  return days.map((item) => {
    const day = asObject(item);
    return [
      day.date ?? "?",
      day.workout_title ?? day.training_label ?? "?",
      `day_type=${day.training_type ?? day.day_type ?? "?"}`,
      `target_kcal=${day.target_kcal ?? "null"}`,
    ].join(" | ");
  });
}

function resolveGitHead(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
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

  const card = await getNutritionAdminStudentCard({
    studentId: options.studentId,
    weekFrom,
    weekTo,
    reviewId: options.reviewId ?? null,
  });
  if (!card.student) {
    throw new Error("Student not found.");
  }

  const selectedReportId = pickDefaultNutritionReport(card.reports, options.reportId ?? null);
  const review = card.weeklyAnalysis;
  const targetPlanWeek = review ? getNutritionPlanTargetWeekToday() : null;
  const planWeek = targetPlanWeek
    ? { from: targetPlanWeek.planWeekFrom, to: targetPlanWeek.planWeekTo, mode: targetPlanWeek.mode }
    : null;

  let planResolution: Awaited<ReturnType<typeof resolveNutritionWeeklyPlanForDisplay>> | null = null;
  if (planWeek) {
    planResolution = await resolveNutritionWeeklyPlanForDisplay({
      studentId: options.studentId,
      planWeekFrom: planWeek.from,
      planWeekTo: planWeek.to,
      planIdFromQuery: options.planId ?? null,
    });
  }
  const displayPlan = planResolution?.displayPlan ?? null;

  const combined = buildDerivedNutritionCombinedMessage({
    review,
    plan: displayPlan,
    formality: card.context.resolvedCommunicationProfile.formality,
    studentName: card.student.studentName,
    profilePreferences: card.profile?.preferences ?? null,
    planWeekMode: planWeek?.mode,
  });
  const renderedText = combined.renderResult.text ?? "";
  const storedReviewDraft = review?.athleteMessageDraft ?? "";
  const storedPlanDraft = displayPlan?.athleteMessageDraft ?? "";

  console.log("Nutrition page render path diagnostic (read-only, mirrors page.tsx)");
  console.log("");
  console.log("Git/runtime:");
  console.log(`- HEAD: ${resolveGitHead()}`);
  console.log(`- latest EA commit present?: ${yesNo(resolveEaCommitPresent())} (${EA_AWARE_COMMIT})`);
  console.log(`- expected methodology version: ${CURRENT_METHODOLOGY_VERSION}`);
  console.log("");
  console.log("Input:");
  console.log(`- studentId: ${options.studentId}`);
  console.log(`- weekFrom/weekTo: ${weekFrom}..${weekTo}`);
  console.log(`- reviewId param: ${options.reviewId ?? "none"}`);
  console.log(`- planId param: ${options.planId ?? "none"}`);
  console.log(`- reportId param: ${options.reportId ?? selectedReportId ?? "none"}`);
  console.log("");
  console.log("Selected review:");
  if (!review) {
    console.log("- none");
  } else {
    console.log(`- id: ${review.id}`);
    console.log(`- status: ${review.status}`);
    console.log(`- created_at: ${review.createdAt}`);
    console.log(`- source report id: ${review.reportId ?? "none"}`);
    console.log(`- selected by URL?: ${yesNo(Boolean(options.reviewId && options.reviewId === review.id))}`);
    console.log(`- athlete_message_draft hash: ${sha1(storedReviewDraft)}`);
    console.log(`- athlete_message_draft contains old phrases?: ${yesNo(findForbiddenPhrases(storedReviewDraft).length > 0)}`);
    console.log(`- old phrase hits: ${findForbiddenPhrases(storedReviewDraft).join(", ") || "none"}`);
    const summary = review.nutritionSummary as Record<string, unknown>;
    const dailySummary = summarizeDailyAnalysis(summary);
    const createdBeforeEa = isCreatedBeforeEaCommit(review.createdAt);
    console.log(
      `- nutrition_summary.daily_analysis exists?: ${yesNo(Array.isArray(summary.daily_analysis) && summary.daily_analysis.length > 0)}`
    );
    console.log(`- generated before ${EA_AWARE_COMMIT}?: ${createdBeforeEa == null ? "unknown" : yesNo(createdBeforeEa)}`);
    console.log(`- daily_analysis contains energyAvailability?: ${yesNo(dailySummary.hasEnergyAvailability)}`);
    console.log(`- daily_analysis contains energyFloor?: ${yesNo(dailySummary.hasEnergyFloor)}`);
    console.log(`- daily_analysis contains loadClassification?: ${yesNo(dailySummary.hasLoadClassification)}`);
    console.log(`- daily_analysis contains Padel as cross_training?: ${yesNo(dailySummary.hasPadelCrossTraining)}`);
    console.log(`- methodology_version present?: ${yesNo(dailySummary.hasMethodologyVersion)}`);
    console.log(`- stored athlete_message_draft old?: ${yesNo(findForbiddenPhrases(storedReviewDraft).length > 0)}`);
    if (dailySummary.rows.length > 0) {
      console.log("- Kristina daily rows:");
      for (const row of dailySummary.rows) {
        console.log(`  ${row}`);
      }
    }
  }
  console.log("");
  console.log("Selected/display plan:");
  if (!displayPlan) {
    console.log("- none");
  } else {
    console.log(`- requested planId: ${options.planId ?? "none"}`);
    console.log(`- resolved display plan id: ${displayPlan.id}`);
    console.log(`- resolved display plan status/week: ${displayPlan.status} · ${displayPlan.planWeekFrom}..${displayPlan.planWeekTo}`);
    console.log(`- selected by URL/latest/fallback?: ${options.planId ? (planResolution?.planSelectedById ? "URL" : "fallback") : "latest"}`);
    console.log(`- is superseded?: ${yesNo(displayPlan.status === "superseded")}`);
    console.log(`- planId warning: ${planResolution?.planIdWarning ?? "none"}`);
    console.log(`- superseded notice: ${planResolution?.supersededPlanNotice ?? "none"}`);
    console.log(`- athlete_message_draft hash: ${sha1(storedPlanDraft)}`);
    console.log(`- athlete_message_draft contains old phrases?: ${yesNo(findForbiddenPhrases(storedPlanDraft).length > 0)}`);
    console.log(`- old phrase hits: ${findForbiddenPhrases(storedPlanDraft).join(", ") || "none"}`);
    const planSummary = displayPlan.planSummary as Record<string, unknown>;
    const planCreatedBeforeEa = isCreatedBeforeEaCommit(displayPlan.createdAt);
    console.log(`- generated before ${EA_AWARE_COMMIT}?: ${planCreatedBeforeEa == null ? "unknown" : yesNo(planCreatedBeforeEa)}`);
    const planRows = summarizePlanDays(planSummary);
    if (planRows.length > 0) {
      console.log("- next_week_plan rows:");
      for (const row of planRows) {
        console.log(`  ${row}`);
      }
    }
  }
  console.log("");
  console.log("Combined/render (page-equivalent helper):");
  console.log(`- helper called: yes`);
  console.log(`- formality: ${card.context.resolvedCommunicationProfile.formality}`);
  console.log(`- planWeekMode: ${planWeek?.mode ?? "none"}`);
  console.log(`- combined status: ${combined.status}`);
  console.log(`- renderResult.ok: ${combined.renderResult.ok}`);
  console.log(
    `- errors/warnings: ${combined.renderResult.issues.filter((issue) => issue.severity === "error").length}/${combined.renderResult.issues.filter((issue) => issue.severity === "warning").length}`
  );
  console.log(`- charCount: ${combined.renderResult.charCount}`);
  console.log(`- text hash: ${sha1(renderedText)}`);
  console.log(`- copy enabled on page?: ${yesNo(Boolean(combined.renderResult.text && !combined.renderResult.issues.some((issue) => issue.severity === "error")))}`);
  console.log("- first 40 lines:");
  for (const line of firstLines(renderedText, 40)) {
    console.log(`  ${line}`);
  }
  console.log(`- contains "День выглядит ровно": ${countPhrase(renderedText, "День выглядит ровно")}`);
  console.log(`- contains "ккал н/д": ${countPhrase(renderedText, "ккал н/д")}`);
  console.log(`- contains Padel lines: ${renderedText.split("\n").filter((line) => /Padel|Падел/i.test(line)).length}`);
  console.log(`- contains силовая lines: ${renderedText.split("\n").filter((line) => /силов/i.test(line)).length}`);
  const miniTableLines = extractMiniTableLines(renderedText);
  if (miniTableLines.length > 0) {
    console.log("- mini-table lines:");
    for (const line of miniTableLines) {
      console.log(`  ${line}`);
    }
  }
  console.log(`- forbidden phrases in derived text: ${findForbiddenPhrases(renderedText).join(", ") || "none"}`);
  console.log(
    `- incomplete-data phrase count: ${countPhrase(renderedText, "Данные по питанию за день неполные") + countPhrase(renderedText, "вывод короткий")}`
  );
  console.log(`- rest labels: ${findRestLines(renderedText).join(" | ") || "none"}`);
  console.log(`- final Sunday line: ${findSundayLine(renderedText) ?? "none"}`);
  console.log("");
  console.log("UI block source comparison:");
  console.log(`- primary block source: renderResult.text (hash ${sha1(renderedText)})`);
  console.log(`- secondary review draft block source: stored review draft (hash ${sha1(storedReviewDraft)})`);
  console.log(`- plan focus draft block source: stored plan draft (hash ${sha1(storedPlanDraft)})`);
  console.log(
    `- primary vs stored review draft match?: ${yesNo(renderedText === storedReviewDraft)}`
  );
  console.log(
    `- primary vs stored plan draft match?: ${yesNo(renderedText === storedPlanDraft)}`
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`diagnose-nutrition-page-render-path failed: ${message}`);
  process.exitCode = 1;
});
