// READ-ONLY checkpoint for master order Task 3 (awaiting_generation / held fallback).
// On ONE real student, runs two cases WITHOUT persisting:
//   HELD : force the model to fail (provider=openai, quota exhausted) -> expect
//          generation_mode=awaiting_generation, athlete draft HELD (null), quota note.
//   OK   : provider=anthropic (Claude) -> expect generation_mode=ai, draft present.
// Writes ЧЕКПОЙНТ_задача3_held_<slug>.md and ЧЕКПОЙНТ_задача3_ok_<slug>.md.
//
//   npx tsx scripts/checkpoint-nutrition-task3.ts
//   npx tsx scripts/checkpoint-nutrition-task3.ts --student-name "Имя"
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

async function buildContextFor(row: { studentId: string; latestReportId: string }) {
  const reportWithMacros = await getNutritionReportWithMacros(row.latestReportId);
  if (!reportWithMacros) {
    throw new Error(`report not found: ${row.latestReportId}`);
  }
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
  return buildNutritionStudentContext({
    studentId: row.studentId,
    weekFrom: reportWithMacros.report.weekFrom,
    weekTo: reportWithMacros.report.weekTo,
    manualRows: rows,
    athleteReportSignals: detectNutritionAthleteReportSignalsFromTexts(signalTexts),
  });
}

function writeMd(fileName: string, title: string, generated: { generation_mode: string; ai_model: string; athlete_message_draft: string | null; internal_summary?: { notes?: string[] } }) {
  const notes = generated.internal_summary?.notes ?? [];
  const md = [
    `# ${title}`,
    "",
    `- generation_mode: \`${generated.generation_mode}\``,
    `- ai_model: \`${generated.ai_model}\``,
    `- athlete_message_draft: ${generated.athlete_message_draft === null ? "**null (держим, ученику не уходит)**" : "присутствует"}`,
    `- notes: ${notes.length ? notes.map((n) => `\`${n}\``).join(", ") : "(нет)"}`,
    "",
    "## Athlete-текст",
    "",
    generated.athlete_message_draft ?? "_(нет — разбор не сгенерирован живой моделью; держим до перегенерации)_",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(process.cwd(), fileName), md, "utf8");
}

async function main() {
  loadScriptEnv();
  if (!resolveSupabaseEnv()) {
    console.error("Нет SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY в .env.local.");
    process.exit(1);
  }
  const studentName = arg("student-name");
  const dashboardRows = await listNutritionAdminDashboardRows({ viewMode: "test" });
  let eligible = dashboardRows.filter((r) => r.latestReportId);
  if (studentName) {
    eligible = eligible.filter((r) => r.studentName.toLowerCase().includes(studentName.toLowerCase()));
  }
  const row = eligible[0];
  if (!row) {
    console.error("Нет учеников теста с готовым отчётом.");
    process.exit(1);
  }
  const slug = row.studentSlug;
  console.log(`Ученик: ${row.studentName} (${slug})`);

  // --- HELD case: force model failure via OpenAI (quota exhausted) ---
  process.env.NUTRITION_AI_PROVIDER = "openai";
  delete process.env.NUTRITION_AI_MODEL;
  const heldContext = await buildContextFor({ studentId: row.studentId, latestReportId: row.latestReportId as string });
  const held = await generateNutritionWeeklyAnalysis({ context: heldContext });
  console.log("\n=== HELD (provider=openai, модель недоступна) ===");
  console.log("generation_mode:", held.generation_mode, "| athlete_draft:", held.athlete_message_draft === null ? "null (держим)" : "present");
  console.log("notes:", (held.internal_summary?.notes ?? []).filter((n) => n.startsWith("ai_generation_fallback")).join("; ") || "(нет ai_generation_fallback)");
  writeMd(`ЧЕКПОЙНТ_задача3_held_${slug}.md`, `Чекпойнт Задача 3 — HELD (awaiting_generation) — ${row.studentName}`, held);
  console.log(`saved: ЧЕКПОЙНТ_задача3_held_${slug}.md`);
  console.log(held.generation_mode === "awaiting_generation" && held.athlete_message_draft === null
    ? "✅ HELD корректен: awaiting_generation, текст ученику не сформирован."
    : "⚠️ HELD неожиданный результат.");

  // --- OK case: Claude ---
  process.env.NUTRITION_AI_PROVIDER = "anthropic";
  const okContext = await buildContextFor({ studentId: row.studentId, latestReportId: row.latestReportId as string });
  const ok = await generateNutritionWeeklyAnalysis({ context: okContext });
  console.log("\n=== OK (provider=anthropic, Claude) ===");
  console.log("generation_mode:", ok.generation_mode, "| ai_model:", ok.ai_model, "| athlete_draft:", ok.athlete_message_draft ? "present" : "null");
  writeMd(`ЧЕКПОЙНТ_задача3_ok_${slug}.md`, `Чекпойнт Задача 3 — OK (live Claude) — ${row.studentName}`, ok);
  console.log(`saved: ЧЕКПОЙНТ_задача3_ok_${slug}.md`);
  console.log(ok.generation_mode === "ai" && Boolean(ok.athlete_message_draft)
    ? "✅ OK корректен: happy-path не задет, текст доезжает."
    : "⚠️ OK неожиданный результат.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
