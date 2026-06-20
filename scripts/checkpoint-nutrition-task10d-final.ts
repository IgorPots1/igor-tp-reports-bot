// READ-ONLY final checkpoint (ONE Claude generation). Renders the REAL two-part
// combined message for Любовь (goal=lose, with height/age → Mifflin), to show all
// at once: rest days uniformly "многовато", intervals carry more carbs than easy,
// gentle protein tone, and the Telegram two-message split. Nothing is persisted.
//
//   npx tsx scripts/checkpoint-nutrition-task10d-final.ts --student-name "Любовь" --height 168 --age 40
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { collectNutritionAthleteReportSignalTexts, detectNutritionAthleteReportSignalsFromTexts } from "@/features/nutrition/athlete-signals";
import { listNutritionAdminDashboardRows } from "@/features/nutrition/admin";
import { buildDerivedNutritionCombinedMessage } from "@/features/nutrition/combined-message";
import { buildNutritionStudentContext } from "@/features/nutrition/context";
import { generateNutritionWeeklyAnalysis } from "@/features/nutrition/draft-generator";
import { resolveNutritionAiModel, resolveNutritionAiProvider } from "@/features/nutrition/nutrition-ai-provider";
import { getNutritionReportWithMacros, getNutritionStudentEssentials } from "@/features/nutrition/repository";
import type { NutritionSex, NutritionWeeklyAnalysis, NutritionWeeklyPlan } from "@/features/nutrition/repository";
import {
  buildNutritionWeeklyPlanFactsFromSources,
  generateNutritionWeeklyPlanFromReviewProse,
} from "@/features/nutrition/weekly-plan-generator";
import { loadScriptEnv, resolveSupabaseEnv } from "./lib/load-script-env";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  loadScriptEnv();
  if (!resolveSupabaseEnv()) {
    console.error("Нет SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY в .env.local.");
    process.exit(1);
  }
  const provider = resolveNutritionAiProvider();
  console.log(`provider=${provider} model=${resolveNutritionAiModel(provider)}`);
  const studentName = arg("student-name") ?? "Любовь";
  const sex: NutritionSex = (arg("sex") as NutritionSex) ?? "female";
  const heightCm = arg("height") ? Number(arg("height")) : 168;
  const ageYears = arg("age") ? Number(arg("age")) : 40;
  const rows = await listNutritionAdminDashboardRows({ viewMode: "test" });
  const row = rows.filter((r) => r.latestReportId).find((r) => r.studentName.toLowerCase().includes(studentName.toLowerCase()));
  if (!row) {
    console.error(`Не найден ученик ${studentName}`);
    process.exit(1);
  }
  const report = await getNutritionReportWithMacros(row.latestReportId as string);
  if (!report) {
    console.error("report not found");
    process.exit(1);
  }
  const macroRows = report.macros.map((m) => ({
    day: m.day, weekday: null, kcal: m.kcal, proteinG: m.proteinG, fatG: m.fatG, carbsG: m.carbsG,
    confidence: m.confidence ?? 1, notes: m.notes, ...(m.items.length > 0 ? { items: m.items } : {}),
  }));
  const essentials = await getNutritionStudentEssentials(row.studentId);
  const signals = detectNutritionAthleteReportSignalsFromTexts(
    collectNutritionAthleteReportSignalTexts({
      reportComment: report.report.rawText,
      manualMacroNotes: macroRows.map((r) => r.notes),
      nutritionContextNotes: essentials.contextItems.map((i) => i.text),
      profileToleranceNotes: essentials.profile?.toleranceNotes ?? null,
    })
  );

  const context = await buildNutritionStudentContext({
    studentId: row.studentId,
    weekFrom: report.report.weekFrom,
    weekTo: report.report.weekTo,
    manualRows: macroRows,
    athleteReportSignals: signals,
  });
  // Goal = lose, with anthropometrics so BMR uses Mifflin (training days realistic).
  context.nutritionGoalType = "lose";
  context.sex = sex;
  context.heightCm = heightCm;
  context.ageYears = ageYears;

  // ===== THE ONE AND ONLY MODEL GENERATION =====
  const generated = await generateNutritionWeeklyAnalysis({ context });

  const reviewRecord = {
    id: "cp10d-review",
    studentId: row.studentId,
    reportId: report.report.id,
    weekFrom: report.report.weekFrom,
    weekTo: report.report.weekTo,
    status: generated.status === "draft_ready" ? "draft_generated" : generated.status,
    internalSummary: generated.internal_summary,
    tpPastWeekContext: context.tpPastWeek,
    tpNextWeekContext: context.tpNextWeek,
    nutritionSummary: { ...generated.nutrition_summary, daily_analysis: generated.daily_analysis },
    safetyFlags: generated.safety_flags,
    contextSnapshot: {},
    promptHash: generated.prompt_hash,
    contextHash: generated.context_hash,
    aiModel: generated.ai_model,
    athleteMessageDraft: generated.athlete_message_draft,
    coachEdits: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as unknown as NutritionWeeklyAnalysis;

  const planFacts = buildNutritionWeeklyPlanFactsFromSources({
    studentId: row.studentId,
    studentName: row.studentName,
    formality: context.resolvedCommunicationProfile.formality,
    weightKg: context.currentWeightKg,
    sourceAnalysis: reviewRecord,
    tpNextWeekContextOverride: context.tpNextWeek as unknown as Record<string, unknown>,
    planWeekOverride: { from: context.tpNextWeek.periodFrom, to: context.tpNextWeek.periodTo, mode: "next_week" },
    nutritionGoalType: "lose",
    sex,
    heightCm,
    ageYears,
  });
  const generatedPlan = generateNutritionWeeklyPlanFromReviewProse({
    facts: planFacts,
    claudePlanProse: generated.next_week_plan_text ?? "",
    claudePlanAiModel: generated.ai_model,
  });
  const planRecord = {
    id: "cp10d-plan",
    studentId: row.studentId,
    sourceReportId: report.report.id,
    sourceAnalysisId: "cp10d-review",
    planWeekFrom: context.tpNextWeek.periodFrom,
    planWeekTo: context.tpNextWeek.periodTo,
    status: generatedPlan.status,
    generationMode: generatedPlan.generationMode,
    promptVersion: generatedPlan.promptVersion,
    aiModel: generatedPlan.aiModel,
    coachSummary: generatedPlan.coachSummary,
    athleteMessageDraft: generatedPlan.athleteMessageDraft,
    coachEditedDraft: null,
    approvedAt: null,
    planSummary: generatedPlan.planSummary,
    trainingContextSnapshot: generatedPlan.trainingContextSnapshot,
    nutritionContextSnapshot: generatedPlan.nutritionContextSnapshot,
    safetyFlags: generatedPlan.safetyFlags,
    supersededByPlanId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as unknown as NutritionWeeklyPlan;

  const combined = buildDerivedNutritionCombinedMessage({
    review: reviewRecord,
    plan: planRecord,
    formality: context.resolvedCommunicationProfile.formality,
    studentName: row.studentName,
    profilePreferences: essentials.profile?.preferences ?? null,
    planWeekMode: "next_week",
  });

  const parts =
    combined.athleteMessageDraftParts.length > 0
      ? combined.athleteMessageDraftParts
      : combined.renderResult.parts; // show parts even when validation withheld them
  console.log(`combined status=${combined.status} ok=${combined.renderResult.ok} parts=${parts.length} lengths=${parts.map((p) => p.length).join(" / ")}`);
  console.log(`issues: ${JSON.stringify(combined.renderResult.issues)}`);
  console.log(`warnings: ${JSON.stringify(combined.warnings)}`);

  const md = [
    `# Чекпойнт Задача 10d — ФИНАЛ (одна генерация) — ${row.studentName}`,
    "",
    `- provider/model: \`${provider}\` / \`${generated.ai_model}\` · цель lose · пол ${sex} · рост ${heightCm} · возраст ${ageYears}`,
    `- combined status: \`${combined.status}\` · renderer.ok: \`${combined.renderResult.ok}\` · частей: ${parts.length} · длины: ${parts.map((p) => `${p.length}`).join(" / ")} (лимит 4096)`,
    `- issues: \`${JSON.stringify(combined.renderResult.issues)}\``,
    "",
    "## СООБЩЕНИЕ 1 — разбор прошлой недели",
    "",
    parts[0] ?? "_(нет)_",
    "",
    "## СООБЩЕНИЕ 2 — план на неделю",
    "",
    parts[1] ?? "_(одно сообщение)_",
    "",
    "## (диагностика) athlete_message_draft модели",
    "",
    generated.athlete_message_draft ?? "_(нет)_",
    "",
  ].join("\n");
  const file = `ЧЕКПОЙНТ_задача10d_final_${row.studentSlug}.md`;
  fs.writeFileSync(path.join(process.cwd(), file), md, "utf8");
  console.log(`saved: ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
