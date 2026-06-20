// READ-ONLY checkpoint for Task 4. Live Claude run on a real student; re-validates
// each day's model prose with the SAME validator the renderer uses and reports
// passed vs cut, so we can see days no longer fall to dry text. Saves the per-day
// proses + athlete draft to ЧЕКПОЙНТ_задача4_<slug>.md. Not persisted.
//
//   npx tsx scripts/checkpoint-nutrition-task4.ts --student-name "Nadezhda"
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { collectNutritionAthleteReportSignalTexts, detectNutritionAthleteReportSignalsFromTexts } from "@/features/nutrition/athlete-signals";
import { listNutritionAdminDashboardRows } from "@/features/nutrition/admin";
import { buildNutritionDayProseFacts } from "@/features/nutrition/combined-message";
import { buildNutritionStudentContext } from "@/features/nutrition/context";
import { generateNutritionWeeklyAnalysis } from "@/features/nutrition/draft-generator";
import { resolveNutritionAiModel, resolveNutritionAiProvider } from "@/features/nutrition/nutrition-ai-provider";
import { getNutritionReportWithMacros, getNutritionStudentEssentials } from "@/features/nutrition/repository";
import { validateNutritionDayProse } from "@/features/nutrition/telegram-renderer";
import { loadScriptEnv, resolveSupabaseEnv } from "./lib/load-script-env";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
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

  const generated = await generateNutritionWeeklyAnalysis({ context });
  const notes = generated.internal_summary?.notes ?? [];
  const rejectedNotes = notes.filter((n) => n.startsWith("day_prose_rejected"));
  const daily = Array.isArray(generated.nutrition_summary?.daily_analysis) ? generated.nutrition_summary.daily_analysis : [];

  let withProse = 0;
  let cut = 0;
  const dayLines: string[] = [];
  for (const d of daily) {
    const day = asObject(d);
    const prose = typeof day.athlete_prose === "string" ? day.athlete_prose.trim() : "";
    if (!prose) continue;
    withProse += 1;
    const issues = validateNutritionDayProse({ prose, facts: buildNutritionDayProseFacts(day) });
    const errs = issues.filter((i) => i.severity === "error");
    if (errs.length > 0) cut += 1;
    dayLines.push(`### ${day.date} — ${errs.length > 0 ? `❌ CUT (${errs.map((i) => i.rule).join(",")})` : "✅ passes"}\n${prose}`);
  }

  console.log(`generation_mode=${generated.generation_mode} ai_model=${generated.ai_model}`);
  console.log(`дней с прозой: ${withProse} | зарублено валидатором: ${cut}`);
  console.log(`day_prose_rejected в нотах: ${rejectedNotes.length}`);

  const md = [
    `# Чекпойнт Задача 4 — ${row.studentName}`,
    "",
    `- generation_mode: \`${generated.generation_mode}\` · ai_model: \`${generated.ai_model}\``,
    `- дней с прозой: **${withProse}**, зарублено валидатором: **${cut}** (было: почти все падали)`,
    `- day_prose_rejected в нотах: **${rejectedNotes.length}**`,
    rejectedNotes.length ? `- остаточные срезы: ${rejectedNotes.map((n) => `\`${n.slice(0, 80)}\``).join(", ")}` : "",
    "",
    "## Проза по дням (модельная, с проверкой валидатором)",
    "",
    ...dayLines,
    "",
    "## Athlete-текст (целиком)",
    "",
    generated.athlete_message_draft ?? "_(нет)_",
    "",
  ].join("\n");
  const file = `ЧЕКПОЙНТ_задача4_${row.studentSlug}.md`;
  fs.writeFileSync(path.join(process.cwd(), file), md, "utf8");
  console.log(`saved: ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
