// READ-ONLY checkpoint runner for master order Task 1 (generation queue vs 429).
// Builds the REAL context for real students (DB reads only) and runs the live
// model through the new queue, WITHOUT persisting anything. Prints generation
// mode / model / notes per student and whether any student fell to fallback
// because of a rate limit. Writes each athlete draft to ЧЕКПОЙНТ_задача1_<slug>.md.
//
// Run (default: first 3 test-cohort students with a ready report):
//   npx tsx scripts/checkpoint-nutrition-task1.ts
//   npx tsx scripts/checkpoint-nutrition-task1.ts --count 3
//   npx tsx scripts/checkpoint-nutrition-task1.ts --student-name "Имя"
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { collectNutritionAthleteReportSignalTexts, detectNutritionAthleteReportSignalsFromTexts } from "@/features/nutrition/athlete-signals";
import { listNutritionAdminDashboardRows } from "@/features/nutrition/admin";
import { buildNutritionStudentContext } from "@/features/nutrition/context";
import { generateNutritionWeeklyAnalysis } from "@/features/nutrition/draft-generator";
import { getNutritionReportWithMacros, getNutritionStudentEssentials } from "@/features/nutrition/repository";
import { loadScriptEnv, resolveSupabaseEnv } from "./lib/load-script-env";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function runOneStudent(row: {
  studentId: string;
  studentName: string;
  studentSlug: string;
  latestReportId: string;
}) {
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

  // Live model call through the new queue. NOT persisted.
  const generated = await generateNutritionWeeklyAnalysis({ context });
  const notes = generated.internal_summary?.notes ?? [];
  const rateLimited = notes.some((n) => n.includes("ai_rate_limited") || n.includes("ai_insufficient_quota"));

  return { generated, notes, rateLimited, effectiveWeekFrom, effectiveWeekTo };
}

async function main() {
  loadScriptEnv();
  const env = resolveSupabaseEnv();
  if (!env) {
    console.error("Нет SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY в .env.local.");
    process.exit(1);
  }
  console.log("=== ENV ===");
  console.log("OPENAI_API_KEY present:", Boolean(process.env.OPENAI_API_KEY?.trim()));
  console.log("model:", process.env.OPENAI_NUTRITION_WEEKLY_REVIEW_MODEL?.trim() || "(default gpt-4o-mini)");
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
    console.error("Нет учеников теста с готовым отчётом (latestReportId). Передай --student-name или включи учеников.");
    process.exit(1);
  }

  console.log(`\n=== Прогон пачки (${eligible.length} учеников, последовательно через очередь) ===`);
  let okAi = 0;
  let fallback = 0;
  let rateLimitedTotal = 0;
  const startedAt = Date.now();

  for (const row of eligible) {
    const label = `${row.studentName} (${row.studentSlug})`;
    try {
      const { generated, notes, rateLimited } = await runOneStudent({
        studentId: row.studentId,
        studentName: row.studentName,
        studentSlug: row.studentSlug,
        latestReportId: row.latestReportId as string,
      });
      if (generated.generation_mode === "ai") {
        okAi += 1;
      } else {
        fallback += 1;
      }
      if (rateLimited) {
        rateLimitedTotal += 1;
      }

      console.log(`\n--- ${label} ---`);
      console.log("generation_mode:", generated.generation_mode, "| ai_model:", generated.ai_model);
      console.log("notes:", notes.length ? notes.join("; ") : "(нет)");

      const draft = generated.athlete_message_draft ?? "(нет athlete-текста — блок безопасности или fallback)";
      const fileName = `ЧЕКПОЙНТ_задача1_${row.studentSlug}.md`;
      const md = [
        `# Чекпойнт после Задачи 1 — ${row.studentName}`,
        "",
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
  console.log(`всего: ${eligible.length} | ai: ${okAi} | fallback: ${fallback} | в т.ч. из-за лимита OpenAI: ${rateLimitedTotal}`);
  console.log(`время: ${elapsedS}s`);
  if (rateLimitedTotal === 0) {
    console.log("✅ Ни один разбор не упал в fallback по причине 429 (критерий приёмки Задачи 1).");
  } else {
    console.log("⚠️ Часть разборов упала из-за лимита/квоты OpenAI — см. ноты (проверь баланс/tier).");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
