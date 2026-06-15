// READ-ONLY: render the REAL combined message (what ships to the athlete) for a
// student WITH approved history, to confirm the "повторяется N-ю неделю" callout
// survives the hybrid render path (day_prose + week summary + plan prose), not
// just the raw athlete_message_draft. Nothing persisted.
//
//   npx tsx scripts/checkpoint-nutrition-task7-combined.ts --student-name "Nadezhda"
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
import type { NutritionWeeklyAnalysis, NutritionWeeklyPlan } from "@/features/nutrition/repository";
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
  const studentName = arg("student-name") ?? "Nadezhda";
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
  // Approved history (as if coach accepted the proposal earlier).
  context.studentMemory = {
    approved_patterns: [
      { text: "углеводы в нагрузочные (беговые) дни ниже ориентира", since_week: "2026-05-25" },
      { text: "жиры вытесняют углеводы в нагрузочные дни", since_week: "2026-05-25" },
    ],
    persistent_notes: [],
    last_focus: "поддержать углеводы вокруг ключевых работ",
    key_trends: ["углеводы в нагрузочные дни: ~200/200/215 г за 3 нед"],
  };

  const generated = await generateNutritionWeeklyAnalysis({ context });

  const reviewRecord = {
    id: "cp7-review",
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
  });
  const generatedPlan = generateNutritionWeeklyPlanFromReviewProse({
    facts: planFacts,
    claudePlanProse: generated.next_week_plan_text ?? "",
    claudePlanAiModel: generated.ai_model,
  });
  const planRecord = {
    id: "cp7-plan",
    studentId: row.studentId,
    sourceReportId: report.report.id,
    sourceAnalysisId: "cp7-review",
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

  const text = combined.renderResult.text ?? "";
  const hasCallout = /повтор|недел[юяи]\s*подряд|третью недел|вторую недел|каждую недел/i.test(text);
  console.log(`combined status=${combined.status} renderer.ok=${combined.renderResult.ok}`);
  console.log(`callout про повтор в COMBINED: ${hasCallout}`);

  const md = [
    `# Чекпойнт Задача 7 — COMBINED (что уйдёт ученику) — ${row.studentName}`,
    "",
    `- provider/model: \`${provider}\` / \`${generated.ai_model}\` · combined status: \`${combined.status}\` · renderer.ok: \`${combined.renderResult.ok}\``,
    `- внедрённая память (approved): \`углеводы в беговые дни ниже ориентира\`, \`жиры вытесняют углеводы\` (since 2026-05-25)`,
    `- callout про «повторяется N-ю неделю» присутствует в COMBINED: **${hasCallout}**`,
    "",
    "## COMBINED-сообщение целиком (как уйдёт ученику)",
    "",
    text || `_(не сформирован: status=${combined.status})_`,
    "",
  ].join("\n");
  const file = `ЧЕКПОЙНТ_задача7_combined_${row.studentSlug}.md`;
  fs.writeFileSync(path.join(process.cwd(), file), md, "utf8");
  console.log(`saved: ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
