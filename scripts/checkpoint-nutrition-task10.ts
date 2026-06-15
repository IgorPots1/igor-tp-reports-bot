// READ-ONLY checkpoint for Task 10 (student goal). Live Claude run on a real
// student with goal=lose injected: proves the plan targets are a moderate
// periodized deficit (rest cut more than hard, high protein, controlled fat) —
// NOT "load to 3000" — the review praises protein and voices high fat; a maintain
// contrast shows higher targets (unchanged); and safety still blocks a dangerous
// low-kcal week even for goal=lose. Nothing is persisted.
//
//   npx tsx scripts/checkpoint-nutrition-task10.ts --student-name "Любовь"
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { collectNutritionAthleteReportSignalTexts, detectNutritionAthleteReportSignalsFromTexts } from "@/features/nutrition/athlete-signals";
import { listNutritionAdminDashboardRows } from "@/features/nutrition/admin";
import { buildNutritionStudentContext } from "@/features/nutrition/context";
import { generateNutritionWeeklyAnalysis } from "@/features/nutrition/draft-generator";
import { resolveNutritionAiModel, resolveNutritionAiProvider } from "@/features/nutrition/nutrition-ai-provider";
import { getNutritionReportWithMacros, getNutritionStudentEssentials } from "@/features/nutrition/repository";
import type { NutritionGoalType } from "@/features/nutrition/repository";
import { loadScriptEnv, resolveSupabaseEnv } from "./lib/load-script-env";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function planDay(generated: { next_week_plan?: { days?: Array<Record<string, unknown>> } }, type: string) {
  return (generated.next_week_plan?.days ?? []).find((d) => d.training_type === type) ?? null;
}
function fmtDay(d: Record<string, unknown> | null): string {
  if (!d) return "—";
  const kcal = d.target_kcal as number;
  const p = d.protein_g as number;
  const f = d.fat_g as number;
  const c = d.carbs_g as number;
  const fatPct = kcal ? Math.round(((f * 9) / kcal) * 100) : 0;
  return `${kcal} ккал · Б ${p} · Ж ${f} (${fatPct}%) · У ${c}`;
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
  const rows = await listNutritionAdminDashboardRows({ viewMode: "test" });
  const withReport = rows.filter((r) => r.latestReportId);
  const row = withReport.find((r) => r.studentName.toLowerCase().includes(studentName.toLowerCase())) ?? withReport[0];
  if (!row) {
    console.error("Нет учеников с отчётом");
    process.exit(1);
  }
  console.log(`student: ${row.studentName}${row.studentName.toLowerCase().includes(studentName.toLowerCase()) ? "" : " (fallback)"}`);
  const report = await getNutritionReportWithMacros(row.latestReportId as string);
  if (!report) {
    console.error("report not found");
    process.exit(1);
  }
  const baseRows = report.macros.map((m) => ({
    day: m.day, weekday: null, kcal: m.kcal, proteinG: m.proteinG, fatG: m.fatG, carbsG: m.carbsG,
    confidence: m.confidence ?? 1, notes: m.notes, ...(m.items.length > 0 ? { items: m.items } : {}),
  }));
  const essentials = await getNutritionStudentEssentials(row.studentId);
  const signals = detectNutritionAthleteReportSignalsFromTexts(
    collectNutritionAthleteReportSignalTexts({
      reportComment: report.report.rawText,
      manualMacroNotes: baseRows.map((r) => r.notes),
      nutritionContextNotes: essentials.contextItems.map((i) => i.text),
      profileToleranceNotes: essentials.profile?.toleranceNotes ?? null,
    })
  );
  const buildCtx = async (macroRows: typeof baseRows, goalType: NutritionGoalType, targetWeightKg: number | null) => {
    const ctx = await buildNutritionStudentContext({
      studentId: row.studentId,
      weekFrom: report.report.weekFrom,
      weekTo: report.report.weekTo,
      manualRows: macroRows,
      athleteReportSignals: signals,
    });
    ctx.nutritionGoalType = goalType;
    ctx.targetWeightKg = targetWeightKg;
    return ctx;
  };

  // lose
  const loseCtx = await buildCtx(baseRows, "lose", arg("target-weight") ? Number(arg("target-weight")) : null);
  const lose = await generateNutritionWeeklyAnalysis({ context: loseCtx });
  // maintain contrast
  const maintainCtx = await buildCtx(baseRows, "maintain", null);
  const maintain = await generateNutritionWeeklyAnalysis({ context: maintainCtx });
  // safety: dangerously low kcal + goal lose must still block
  const lowRows = baseRows.map((r) => ({ ...r, kcal: 900, carbsG: 70, proteinG: 40, fatG: 30 }));
  const lowCtx = await buildCtx(lowRows, "lose", null);
  const lowSafety = await generateNutritionWeeklyAnalysis({ context: lowCtx });

  const coach = (g: { nutrition_summary?: Record<string, unknown> }) => (asObject(g.nutrition_summary).coach_summary_text as string) ?? "";

  console.log(`\nLOSE focus: ${lose.one_focus.category} — ${lose.one_focus.statement_ru}`);
  console.log(`LOSE plan rest: ${fmtDay(planDay(lose, "rest"))}`);
  console.log(`LOSE plan hard: ${fmtDay(planDay(lose, "hard"))}`);
  console.log(`MAINTAIN plan rest: ${fmtDay(planDay(maintain, "rest"))}`);
  console.log(`SAFETY (lose + 900 kcal): blocked=${lowSafety.safety_flags.blocked} status=${lowSafety.status}`);

  const md = [
    `# Чекпойнт Задача 10 — Цель ученика — ${row.studentName}`,
    "",
    `- provider/model: \`${provider}\` / \`${lose.ai_model}\``,
    "",
    "## Цель = СНИЖЕНИЕ (lose)",
    `- Фокус: **${lose.one_focus.category}** — ${lose.one_focus.statement_ru}`,
    `- План, день отдыха: \`${fmtDay(planDay(lose, "rest"))}\``,
    `- План, ключевой/интервалы: \`${fmtDay(planDay(lose, "hard"))}\``,
    `- План, длительная: \`${fmtDay(planDay(lose, "long_run"))}\``,
    "  (ожидается: дефицит, отдых срезан сильнее работы, белок высокий ~1.9 г/кг, жир 20–30%)",
    "",
    "### Athlete-текст (lose)",
    lose.athlete_message_draft ?? "_(нет)_",
    "",
    "### Coach summary (lose)",
    coach(lose) || "_(нет)_",
    "",
    "## Контраст: Цель = ПОДДЕРЖАНИЕ (maintain) — поведение прежнее",
    `- Фокус: **${maintain.one_focus.category}**`,
    `- План, день отдыха: \`${fmtDay(planDay(maintain, "rest"))}\` (выше, чем при lose)`,
    `- План, ключевой: \`${fmtDay(planDay(maintain, "hard"))}\``,
    "",
    "## Safety НЕ ослаблен целью lose",
    `- Искусственно низкая калорийность (900 ккал/день) + цель lose → blocked=**${lowSafety.safety_flags.blocked}**, status=\`${lowSafety.status}\`, hard_flags=${JSON.stringify(lowSafety.safety_flags.hard_flags)}`,
    "",
  ].join("\n");
  const file = `ЧЕКПОЙНТ_задача10_${row.studentSlug}.md`;
  fs.writeFileSync(path.join(process.cwd(), file), md, "utf8");
  console.log(`saved: ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
