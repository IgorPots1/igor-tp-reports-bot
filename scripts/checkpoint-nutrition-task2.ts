// READ-ONLY checkpoint runner for master order Task 2 (Claude provider).
// Builds the REAL context for real students (DB reads only) and runs the live
// model THROUGH THE PROVIDER ADAPTER (default: Anthropic Claude), WITHOUT
// persisting anything. Prints provider / model / generation mode / notes per
// student and writes each athlete draft to ЧЕКПОЙНТ_задача2_<slug>.md.
//
// Run (default: first 3 test-cohort students with a ready report, provider from env):
//   npx tsx scripts/checkpoint-nutrition-task2.ts
//   NUTRITION_AI_PROVIDER=anthropic npx tsx scripts/checkpoint-nutrition-task2.ts --count 3
//   npx tsx scripts/checkpoint-nutrition-task2.ts --student-name "Имя"
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { collectNutritionAthleteReportSignalTexts, detectNutritionAthleteReportSignalsFromTexts } from "@/features/nutrition/athlete-signals";
import { listNutritionAdminDashboardRows } from "@/features/nutrition/admin";
import { buildNutritionStudentContext } from "@/features/nutrition/context";
import { generateNutritionWeeklyAnalysis } from "@/features/nutrition/draft-generator";
import { resolveNutritionAiModel, resolveNutritionAiProvider } from "@/features/nutrition/nutrition-ai-provider";
import { getNutritionReportWithMacros, getNutritionStudentEssentials } from "@/features/nutrition/repository";
import { loadScriptEnv, resolveSupabaseEnv } from "./lib/load-script-env";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function runOneStudent(row: { studentId: string; latestReportId: string }) {
  const reportWithMacros = await getNutritionReportWithMacros(row.latestReportId);
  if (!reportWithMacros) {
    throw new Error(`report not found: ${row.latestReportId}`);
  }
  const effectiveWeekFrom = reportWithMacros.report.weekFrom;
  const effectiveWeekTo = reportWithMacros.report.weekTo;

  const rows = reportWithMacros.macros.map((m) => ({
    day: m.day,
    weekday: null,
    kcal: m.kcal,
    proteinG: m.proteinG,
    fatG: m.fatG,
    carbsG: m.carbsG,
    confidence: m.confidence ?? 1,
    notes: m.notes,
    ...(m.items.length > 0 ? { items: m.items } : {}),
  }));

  const essentials = await getNutritionStudentEssentials(row.studentId);
  const signalTexts = collectNutritionAthleteReportSignalTexts({
    reportComment: reportWithMacros.report.rawText,
    manualMacroNotes: rows.map((r) => r.notes),
    nutritionContextNotes: essentials.contextItems.map((item) => item.text),
    profileToleranceNotes: essentials.profile?.toleranceNotes ?? null,
  });
  const athleteReportSignals = detectNutritionAthleteReportSignalsFromTexts(signalTexts);

  const context = await buildNutritionStudentContext({
    studentId: row.studentId,
    weekFrom: effectiveWeekFrom,
    weekTo: effectiveWeekTo,
    manualRows: rows,
    athleteReportSignals,
  });

  // Live model call through the provider adapter. NOT persisted.
  const generated = await generateNutritionWeeklyAnalysis({ context });
  const notes = generated.internal_summary?.notes ?? [];
  return { generated, notes };
}

async function main() {
  loadScriptEnv();
  const env = resolveSupabaseEnv();
  if (!env) {
    console.error("Нет SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY в .env.local.");
    process.exit(1);
  }
  const provider = resolveNutritionAiProvider();
  const model = resolveNutritionAiModel(provider);
  console.log("=== ENV ===");
  console.log("provider:", provider, "| model:", model);
  console.log("ANTHROPIC_API_KEY present:", Boolean(process.env.ANTHROPIC_API_KEY?.trim()));
  console.log("OPENAI_API_KEY present:", Boolean(process.env.OPENAI_API_KEY?.trim()));
  console.log("NUTRITION_GEN_DELAY_MS:", process.env.NUTRITION_GEN_DELAY_MS?.trim() || "(default 1800)");

  const count = Number(arg("count") ?? "3");
  const studentName = arg("student-name");

  const dashboardRows = await listNutritionAdminDashboardRows({ viewMode: "test" });
  let eligible = dashboardRows.filter((r) => r.latestReportId);
  if (studentName) {
    eligible = eligible.filter((r) => r.studentName.toLowerCase().includes(studentName.toLowerCase()));
  }
  eligible = eligible.slice(0, Number.isFinite(count) && count > 0 ? count : 3);

  if (eligible.length === 0) {
    console.error("Нет учеников теста с готовым отчётом (latestReportId). Передай --student-name.");
    process.exit(1);
  }

  console.log(`\n=== Прогон пачки (${eligible.length} учеников, последовательно через очередь, провайдер ${provider}) ===`);
  let okAi = 0;
  let fallback = 0;
  const startedAt = Date.now();

  for (const row of eligible) {
    const label = `${row.studentName} (${row.studentSlug})`;
    try {
      const { generated, notes } = await runOneStudent({
        studentId: row.studentId,
        latestReportId: row.latestReportId as string,
      });
      if (generated.generation_mode === "ai") {
        okAi += 1;
      } else {
        fallback += 1;
      }

      console.log(`\n--- ${label} ---`);
      console.log("generation_mode:", generated.generation_mode, "| ai_model:", generated.ai_model);
      console.log("notes:", notes.length ? notes.join("; ") : "(нет)");

      const draft = generated.athlete_message_draft ?? "(нет athlete-текста — блок безопасности или fallback)";
      const fileName = `ЧЕКПОЙНТ_задача2_${row.studentSlug}.md`;
      const md = [
        `# Чекпойнт после Задачи 2 (провайдер ${provider}) — ${row.studentName}`,
        "",
        `- provider: \`${provider}\``,
        `- generation_mode: \`${generated.generation_mode}\``,
        `- ai_model: \`${generated.ai_model}\``,
        `- notes: ${notes.length ? notes.map((n) => `\`${n}\``).join(", ") : "(нет)"}`,
        "",
        "## Athlete-текст разбора",
        "",
        draft,
        "",
      ].join("\n");
      fs.writeFileSync(path.join(process.cwd(), fileName), md, "utf8");
      console.log("saved:", fileName);
    } catch (error) {
      fallback += 1;
      console.error(`\n--- ${label} --- ОШИБКА:`, error instanceof Error ? error.message : error);
    }
  }

  const elapsedS = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log("\n=== ИТОГ ПАЧКИ ===");
  console.log(`всего: ${eligible.length} | ai: ${okAi} | fallback: ${fallback} | время: ${elapsedS}s`);
  if (okAi === eligible.length) {
    console.log(`✅ Все разборы сгенерированы живой моделью через ${provider} (generation_mode=ai).`);
  } else {
    console.log("⚠️ Часть разборов в fallback — см. ноты по ученикам.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
