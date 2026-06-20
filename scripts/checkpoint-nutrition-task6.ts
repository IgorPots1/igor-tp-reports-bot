// READ-ONLY checkpoint for Task 6 (merge review + next-week plan into ONE Claude
// call). Live Claude run on a real student. Proves: a single model call returns
// both the review prose AND next_week_plan_text; the plan record is built from
// that prose + deterministic formula numbers (no OpenAI); the full combined
// message (last week + next week) renders in one voice; the plan days line up
// with the real next-week key workouts. Nothing is persisted.
//
//   npx tsx scripts/checkpoint-nutrition-task6.ts --student-name "Nadezhda"
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { collectNutritionAthleteReportSignalTexts, detectNutritionAthleteReportSignalsFromTexts } from "@/features/nutrition/athlete-signals";
import { listNutritionAdminDashboardRows } from "@/features/nutrition/admin";
import { buildDerivedNutritionCombinedMessage } from "@/features/nutrition/combined-message";
import { buildNutritionStudentContext } from "@/features/nutrition/context";
import { generateNutritionWeeklyAnalysis } from "@/features/nutrition/draft-generator";
import { renderNutritionTelegramMessage, validateNutritionDayProse } from "@/features/nutrition/telegram-renderer";
import { buildNutritionDayProseFacts } from "@/features/nutrition/combined-message";
import type { NutritionNextWeekPlan } from "@/features/nutrition/weekly-plan-formulas";
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

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0));
  return dt.toISOString().slice(0, 10);
}

const RU_WEEKDAYS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
function weekdayRu(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return RU_WEEKDAYS[new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay()] ?? "—";
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
  const signalTexts = collectNutritionAthleteReportSignalTexts({
    reportComment: report.report.rawText,
    manualMacroNotes: macroRows.map((r) => r.notes),
    nutritionContextNotes: essentials.contextItems.map((item) => item.text),
    profileToleranceNotes: essentials.profile?.toleranceNotes ?? null,
  });
  const context = await buildNutritionStudentContext({
    studentId: row.studentId,
    weekFrom: report.report.weekFrom,
    weekTo: report.report.weekTo,
    manualRows: macroRows,
    athleteReportSignals: detectNutritionAthleteReportSignalsFromTexts(signalTexts),
  });

  // ── ONE model call: review + plan prose together ──────────────────────────
  const generated = await generateNutritionWeeklyAnalysis({ context });
  const notes = generated.internal_summary?.notes ?? [];
  const usageNotes = notes.filter((n) => n.startsWith("ai_usage:"));

  // ── Diagnose the per-day REVIEW prose (must stay as alive as Task 4) ────────
  const reviewDaily = Array.isArray(generated.nutrition_summary?.daily_analysis)
    ? (generated.nutrition_summary.daily_analysis as Array<Record<string, unknown>>)
    : [];
  const dayProseRejectedNotes = notes.filter((n) => n.startsWith("day_prose_rejected"));
  const proseDiag = reviewDaily.map((d) => {
    const date = typeof d.date === "string" ? d.date : "?";
    const prose = typeof d.athlete_prose === "string" ? d.athlete_prose.trim() : "";
    const has = prose.length > 0;
    const issues = has ? validateNutritionDayProse({ prose, facts: buildNutritionDayProseFacts(d) }) : [];
    const errs = issues.filter((i) => i.severity === "error");
    return { date, has, len: prose.length, ok: has && errs.length === 0, rules: errs.map((i) => i.rule).join(","), prose };
  });
  const withProse = proseDiag.filter((p) => p.has).length;
  const usableProse = proseDiag.filter((p) => p.ok).length;
  console.log(`--- REVIEW day_prose: дней=${reviewDaily.length} с прозой=${withProse} валидны=${usableProse} rejected@gen=${dayProseRejectedNotes.length}`);
  for (const p of proseDiag) {
    console.log(`  ${p.date}: prose=${p.has ? `${p.len}ch` : "—"} ${p.ok ? "OK" : p.has ? `CUT(${p.rules})` : "MISSING"}`);
  }

  // Build the review-shaped record the plan facts read from (as createNutrition
  // WeeklyAnalysis would persist it), then build the plan from the SAME Claude
  // plan prose + formula numbers — no second model call.
  const reviewRecord = {
    id: "checkpoint-review",
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
    id: "checkpoint-plan",
    studentId: row.studentId,
    sourceReportId: report.report.id,
    sourceAnalysisId: "checkpoint-review",
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
  const rendererIssues = combined.renderResult.issues
    .filter((i) => i.severity === "error")
    .map((i) => `${i.rule}: ${i.message}`);
  if (rendererIssues.length > 0) {
    console.log(`renderer errors: ${rendererIssues.join(" | ")}`);
  }

  // ── Date scenario (Igor): report = PAST week from PDF, generation on another
  // day. Review week must be the PDF week; plan week must be the week right after
  // the report (weekTo+1..+7), NOT "today + a week"; and the plan mini-table must
  // hide days already past when generated mid-week (remaining-only). ───────────
  const reviewFrom = report.report.weekFrom;
  const reviewTo = report.report.weekTo;
  const planFrom = context.tpNextWeek.periodFrom;
  const planTo = context.tpNextWeek.periodTo;
  const expectedPlanFrom = addDays(reviewTo, 1);
  const expectedPlanTo = addDays(reviewTo, 7);
  const planWeekAnchoredToReport = planFrom === expectedPlanFrom && planTo === expectedPlanTo;
  // Simulate generating mid-week (e.g. Tuesday): default to plan week start + 2
  // days so the first two plan days are already in the past.
  const genDay = arg("gen-day") ?? addDays(planFrom, 2);
  const planNextWeek = generatedPlan.planSummary.next_week_plan as NutritionNextWeekPlan | undefined;
  const remainingRender = planNextWeek
    ? renderNutritionTelegramMessage({
        formality: context.resolvedCommunicationProfile.formality,
        athleteName: "",
        planWeekMode: "current_week",
        interpretation: { dayComments: [], weekSummaryRu: "Итог недели.", focusLinesRu: ["Фокус недели."], weekComparisonLineRu: null },
        nextWeekPlan: planNextWeek,
        fallbackPlanLines: ["План на неделю."],
        hasTargetWeekTrainingContext: true,
        hasPreviousWeeksContext: false,
        todayLocalDate: genDay,
        miniTableMode: "athlete_remaining_only",
      })
    : null;
  const planDays = planNextWeek?.days ?? [];
  const fmtDdMm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
  const remainingText = remainingRender?.text ?? "";
  const pastDaysLeaked = planDays
    .filter((d) => d.date < genDay)
    .filter((d) => remainingText.includes(fmtDdMm(d.date)))
    .map((d) => d.date);
  const futureDaysShown = planDays.filter((d) => d.date >= genDay).filter((d) => remainingText.includes(fmtDdMm(d.date))).map((d) => d.date);
  const remainingOnlyOk = remainingRender !== null && pastDaysLeaked.length === 0 && futureDaysShown.length > 0;

  console.log(`review week: ${reviewFrom}..${reviewTo} (${weekdayRu(reviewFrom)}-${weekdayRu(reviewTo)}) — из дат PDF`);
  console.log(`plan week:   ${planFrom}..${planTo} (= reportWeekTo+1..+7) — не уехал вперёд: ${planWeekAnchoredToReport}`);
  console.log(`gen-day (симуляция середины недели): ${genDay} (${weekdayRu(genDay)}) → remaining-only ок: ${remainingOnlyOk} (прошедшие скрыты: ${planDays.filter((d) => d.date < genDay).map((d) => fmtDdMm(d.date)).join(",") || "—"})`);

  // Plan days vs real next-week key workouts.
  const keyWorkouts = (context.tpNextWeek.keyWorkouts ?? []).map((k) => `${k.date} · ${k.title}`);
  const planKeyDays = (generated.next_week_plan.days ?? [])
    .filter((d) => d.flags?.key_workout || d.training_type === "long_run" || d.training_type === "hard")
    .map((d) => `${d.date} · ${d.training_label} (${d.training_type})`);

  console.log(`generation_mode=${generated.generation_mode} ai_model=${generated.ai_model}`);
  console.log(`модельных вызовов (ai_usage notes)=${usageNotes.length}`);
  console.log(`plan generationMode=${generatedPlan.generationMode} aiModel=${generatedPlan.aiModel}`);
  console.log(`next_week_plan_text присутствует: ${Boolean(generated.next_week_plan_text)}`);
  console.log(`combined status=${combined.status} renderer.ok=${combined.renderResult.ok}`);
  console.log(`ключевые тренировки след. недели (TP): ${keyWorkouts.join(" | ") || "—"}`);
  console.log(`ключевые дни плана: ${planKeyDays.join(" | ") || "—"}`);

  const md = [
    `# Чекпойнт Задача 6 — ${row.studentName}`,
    "",
    "## Один вызов модели = разбор + план",
    `- provider/model: \`${provider}\` / \`${generated.ai_model}\``,
    `- generation_mode (разбор): \`${generated.generation_mode}\``,
    `- модельных вызовов по нотам usage: **${usageNotes.length}** (ожидается 1 — план не зовёт модель отдельно)`,
    usageNotes.length ? `  - ${usageNotes.map((n) => `\`${n}\``).join(", ")}` : "",
    `- next_week_plan_text от Claude присутствует: **${Boolean(generated.next_week_plan_text)}**`,
    `- план generationMode: \`${generatedPlan.generationMode}\` · aiModel: \`${generatedPlan.aiModel}\` (числа — формулы, проза — тот же Claude-вызов)`,
    `- combined status: \`${combined.status}\` · renderer.ok: \`${combined.renderResult.ok}\` · символов: ${combined.renderResult.charCount}`,
    "",
    "## Даты (сценарий Игоря: отчёт за прошлую неделю, генерация в другой день)",
    `- **Неделя разбора (из PDF):** ${reviewFrom} … ${reviewTo} (${weekdayRu(reviewFrom)}–${weekdayRu(reviewTo)})`,
    `- **Неделя плана:** ${planFrom} … ${planTo} (${weekdayRu(planFrom)}–${weekdayRu(planTo)})`,
    `- **Почему именно эта:** план = неделя сразу после отчётной (\`reportWeekTo+1..+7\`), берётся из \`context.tpNextWeek\`, не из «сегодня». Ожидалось ${expectedPlanFrom}..${expectedPlanTo} → не уехал на неделю вперёд: **${planWeekAnchoredToReport}**`,
    `- **Мини-таблица remaining-only (генерация ${genDay}, ${weekdayRu(genDay)}):** прошедшие дни скрыты — ок: **${remainingOnlyOk}**; скрыты \`${planDays.filter((d) => d.date < genDay).map((d) => fmtDdMm(d.date)).join(", ") || "—"}\`, показаны \`${futureDaysShown.map(fmtDdMm).join(", ") || "—"}\``,
    pastDaysLeaked.length ? `  - ⚠️ протекли прошедшие дни: ${pastDaysLeaked.map(fmtDdMm).join(", ")}` : "",
    "",
    "## План привязан к реальным тренировкам след. недели",
    `- ключевые тренировки в TP (след. неделя): ${keyWorkouts.length ? keyWorkouts.map((k) => `\`${k}\``).join(", ") : "—"}`,
    `- ключевые дни плана (формулы): ${planKeyDays.length ? planKeyDays.map((k) => `\`${k}\``).join(", ") : "—"}`,
    "",
    "## next_week_plan_text (проза плана от Claude, до склейки)",
    "",
    generated.next_week_plan_text ?? "_(нет — held/blocked)_",
    "",
    "## Полный текст ученику (разбор прошлой недели + план), один голос",
    "",
    combined.renderResult.text ?? `_(не сформирован: status=${combined.status})_`,
    "",
    rendererIssues.length ? `## Renderer ошибки\n\n${rendererIssues.map((w) => `- ${w}`).join("\n")}\n` : "",
    combined.warnings.length ? `## Предупреждения\n\n${combined.warnings.map((w) => `- ${w}`).join("\n")}\n` : "",
    "## Служебный coach_summary (от того же вызова)",
    "",
    asObject(generated.nutrition_summary).coach_summary_text as string ?? "_(нет)_",
    "",
  ].filter(Boolean).join("\n");
  const file = `ЧЕКПОЙНТ_задача6_${row.studentSlug}.md`;
  fs.writeFileSync(path.join(process.cwd(), file), md, "utf8");
  console.log(`saved: ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
