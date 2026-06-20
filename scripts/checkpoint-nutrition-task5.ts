// READ-ONLY cost checkpoint for master order Task 5 (lighter prompt + caching).
// On ONE real student, runs the review narrative TWICE (run #2 should read the
// Anthropic prompt cache) and reports token usage + price per Sonnet 4.6 rates.
// Used to capture BEFORE (no caching) and AFTER (caching) on the same student.
//
//   npx tsx scripts/checkpoint-nutrition-task5.ts --student-name "Имя"
//   npx tsx scripts/checkpoint-nutrition-task5.ts --label before
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

// Sonnet 4.6 pricing ($/token).
const PRICE = {
  input: 3 / 1_000_000,
  output: 15 / 1_000_000,
  cacheWrite: 3.75 / 1_000_000,
  cacheRead: 0.3 / 1_000_000,
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function parseUsage(notes: string[]): { input: number; output: number; cacheCreation: number; cacheRead: number } | null {
  const note = notes.find((n) => n.startsWith("ai_usage:"));
  if (!note) return null;
  const get = (k: string) => Number(new RegExp(`${k}=(\\d+)`).exec(note)?.[1] ?? "0");
  return { input: get("input"), output: get("output"), cacheCreation: get("cache_creation"), cacheRead: get("cache_read") };
}

function cost(u: { input: number; output: number; cacheCreation: number; cacheRead: number }): number {
  return u.input * PRICE.input + u.output * PRICE.output + u.cacheCreation * PRICE.cacheWrite + u.cacheRead * PRICE.cacheRead;
}

async function buildContextFor(row: { studentId: string; latestReportId: string }) {
  const reportWithMacros = await getNutritionReportWithMacros(row.latestReportId);
  if (!reportWithMacros) throw new Error(`report not found: ${row.latestReportId}`);
  const rows = reportWithMacros.macros.map((m) => ({
    day: m.day, weekday: null, kcal: m.kcal, proteinG: m.proteinG, fatG: m.fatG, carbsG: m.carbsG,
    confidence: m.confidence ?? 1, notes: m.notes, ...(m.items.length > 0 ? { items: m.items } : {}),
  }));
  const essentials = await getNutritionStudentEssentials(row.studentId);
  const signalTexts = collectNutritionAthleteReportSignalTexts({
    reportComment: reportWithMacros.report.rawText,
    manualMacroNotes: rows.map((r) => r.notes),
    nutritionContextNotes: essentials.contextItems.map((item) => item.text),
    profileToleranceNotes: essentials.profile?.toleranceNotes ?? null,
  });
  return buildNutritionStudentContext({
    studentId: row.studentId,
    weekFrom: reportWithMacros.report.weekFrom,
    weekTo: reportWithMacros.report.weekTo,
    manualRows: rows,
    athleteReportSignals: detectNutritionAthleteReportSignalsFromTexts(signalTexts),
  });
}

async function main() {
  loadScriptEnv();
  if (!resolveSupabaseEnv()) {
    console.error("Нет SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY в .env.local.");
    process.exit(1);
  }
  const label = arg("label") ?? "run";
  const studentName = arg("student-name");
  const provider = resolveNutritionAiProvider();
  const model = resolveNutritionAiModel(provider);
  console.log(`=== provider=${provider} model=${model} label=${label} ===`);

  const dashboardRows = await listNutritionAdminDashboardRows({ viewMode: "test" });
  let eligible = dashboardRows.filter((r) => r.latestReportId);
  if (studentName) eligible = eligible.filter((r) => r.studentName.toLowerCase().includes(studentName.toLowerCase()));
  const row = eligible[0];
  if (!row) {
    console.error("Нет учеников теста с готовым отчётом.");
    process.exit(1);
  }
  console.log(`Ученик: ${row.studentName} (${row.studentSlug})`);

  const passes = Math.max(1, Number(arg("passes") ?? "2") || 2);
  let lastDraft: string | null = null;
  for (let pass = 1; pass <= passes; pass += 1) {
    const context = await buildContextFor({ studentId: row.studentId, latestReportId: row.latestReportId as string });
    const generated = await generateNutritionWeeklyAnalysis({ context });
    const usage = parseUsage(generated.internal_summary?.notes ?? []);
    lastDraft = generated.athlete_message_draft;
    console.log(`\n--- Прогон #${pass} (${generated.generation_mode}, ${generated.ai_model}) ---`);
    if (!usage) {
      console.log("usage: (нет ai_usage — fallback/awaiting или другой провайдер)");
      continue;
    }
    console.log(
      `tokens: input=${usage.input} output=${usage.output} cache_write=${usage.cacheCreation} cache_read=${usage.cacheRead}`
    );
    console.log(`цена нарратива: $${cost(usage).toFixed(4)}`);
  }

  const fileName = `ЧЕКПОЙНТ_задача5_${label}_${row.studentSlug}.md`;
  fs.writeFileSync(
    path.join(process.cwd(), fileName),
    [`# Чекпойнт Задача 5 (${label}) — ${row.studentName}`, "", "## Живой athlete-текст (последний прогон)", "", lastDraft ?? "_(нет)_", ""].join("\n"),
    "utf8"
  );
  console.log(`\nsaved: ${fileName}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
