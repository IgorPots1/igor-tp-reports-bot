// READ-ONLY checkpoint for Task 7 (review memory). Proves end-to-end without
// persisting: (1) detection proposes a repeating pattern with weeks_observed/
// since_week; (2) once approved (injected into memory) the next review pulls the
// history and voices "повторяется N-ю неделю" KINDLY; (3) when the pattern
// improves (carbs bumped) the review notes it positively; (4) the compact
// student_history adds little token cost (baseline vs with-history).
//
//   npx tsx scripts/checkpoint-nutrition-task7.ts --student-name "Nadezhda"
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { collectNutritionAthleteReportSignalTexts, detectNutritionAthleteReportSignalsFromTexts } from "@/features/nutrition/athlete-signals";
import { listNutritionAdminDashboardRows } from "@/features/nutrition/admin";
import { buildNutritionStudentContext } from "@/features/nutrition/context";
import { generateNutritionWeeklyAnalysis } from "@/features/nutrition/draft-generator";
import { resolveNutritionAiModel, resolveNutritionAiProvider } from "@/features/nutrition/nutrition-ai-provider";
import { getNutritionReportWithMacros, getNutritionStudentEssentials } from "@/features/nutrition/repository";
import {
  detectNutritionRepeatingPatterns,
  buildNutritionLoadCarbsTrend,
  type NutritionWeekDaily,
} from "@/features/nutrition/pattern-detection";
import { loadScriptEnv, resolveSupabaseEnv } from "./lib/load-script-env";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function usageNote(generated: { internal_summary?: { notes?: string[] } }): string {
  return (generated.internal_summary?.notes ?? []).find((n) => n.startsWith("ai_usage:")) ?? "ai_usage:n/a";
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

  const buildCtx = async (macroRows: typeof baseRows) =>
    buildNutritionStudentContext({
      studentId: row.studentId,
      weekFrom: report.report.weekFrom,
      weekTo: report.report.weekTo,
      manualRows: macroRows,
      athleteReportSignals: signals,
    });

  // ── (0) baseline review (no history) — also our token baseline ─────────────
  const baseCtx = await buildCtx(baseRows);
  const baseline = await generateNutritionWeeklyAnalysis({ context: baseCtx });
  const baseDaily = Array.isArray(baseline.nutrition_summary?.daily_analysis) ? baseline.nutrition_summary.daily_analysis : [];

  // ── (1) detection: replicate this week's findings across 3 weeks to simulate
  // a 2-3 week history, then propose. (Deterministic, no model.) ──────────────
  const curWeek: NutritionWeekDaily = { weekFrom: report.report.weekFrom, days: baseDaily as Array<Record<string, unknown>> };
  const priorWeeks: NutritionWeekDaily[] = [
    { weekFrom: "2026-06-01", days: baseDaily as Array<Record<string, unknown>> },
    { weekFrom: "2026-05-25", days: baseDaily as Array<Record<string, unknown>> },
  ];
  const candidates = detectNutritionRepeatingPatterns({ current: curWeek, prior: priorWeeks });
  const trend = buildNutritionLoadCarbsTrend({ current: curWeek, prior: priorWeeks });
  const topPattern = candidates[0] ?? null;

  // ── (2) "approve" the top pattern → inject into memory → re-run review ──────
  const repeatCtx = await buildCtx(baseRows);
  repeatCtx.studentMemory = {
    approved_patterns: topPattern
      ? [{ text: topPattern.text, since_week: topPattern.since_week }]
      : [{ text: "углеводы в нагрузочные (беговые) дни ниже ориентира", since_week: "2026-05-25" }],
    persistent_notes: [],
    last_focus: "поддержать углеводы вокруг ключевых работ",
    key_trends: trend ? [trend] : [],
  };
  const repeat = await generateNutritionWeeklyAnalysis({ context: repeatCtx });

  // ── (3) improvement: bump load-day carbs AND energy clearly above target so
  // the recurring low-carb/low-energy pattern no longer fires this week ────────
  const improvedRows = baseRows.map((r) => ({
    ...r,
    kcal: r.kcal != null ? Math.max(r.kcal, 2700) : r.kcal,
    carbsG: r.carbsG != null ? Math.max(r.carbsG, 400) : r.carbsG,
    fatG: r.fatG != null ? Math.min(r.fatG, 70) : r.fatG,
  }));
  const improveCtx = await buildCtx(improvedRows);
  improveCtx.studentMemory = repeatCtx.studentMemory;
  const improve = await generateNutritionWeeklyAnalysis({ context: improveCtx });

  const coach = (g: { nutrition_summary?: Record<string, unknown> }) =>
    (asObject(g.nutrition_summary).coach_summary_text as string) ?? "";
  const draft = (g: { athlete_message_draft?: string | null }) => g.athlete_message_draft ?? "";

  console.log(`\n--- detection: ${candidates.length} candidate(s) ---`);
  for (const c of candidates) console.log(`  • ${c.text} — ${c.weeks_observed} нед (с ${c.since_week})`);
  console.log(`trend: ${trend ?? "(нет)"}`);
  console.log(`\nbaseline usage:  ${usageNote(baseline)}`);
  console.log(`with-history:    ${usageNote(repeat)}`);
  console.log(`improvement run: ${usageNote(improve)}`);

  const md = [
    `# Чекпойнт Задача 7 — ${row.studentName}`,
    "",
    "## (1) Предложение паттерна (draft→approve, без модели)",
    candidates.length
      ? candidates.map((c) => `- **${c.text}** — повторяется **${c.weeks_observed} нед** (с ${c.since_week})`).join("\n")
      : "_(паттернов не обнаружено)_",
    `- числовой тренд (key_trends): \`${trend ?? "—"}\``,
    "",
    "## (2) После одобрения → история в разборе, озвучено по-доброму",
    `Внедрённая память: \`${JSON.stringify(repeatCtx.studentMemory.approved_patterns)}\``,
    "",
    "### Athlete-текст (с историей)",
    draft(repeat) || "_(нет)_",
    "",
    "### Coach summary (с историей)",
    coach(repeat) || "_(нет)_",
    "",
    "## (3) Улучшение (углеводы подтянули) → позитивная отметка",
    "### Athlete-текст (улучшение)",
    draft(improve) || "_(нет)_",
    "",
    "## (4) Цена: компактная история почти не растит токены",
    `- baseline (без истории): \`${usageNote(baseline)}\``,
    `- с историей: \`${usageNote(repeat)}\``,
    "",
    "## Baseline coach summary (без истории, для сравнения голоса)",
    coach(baseline) || "_(нет)_",
    "",
  ].join("\n");
  const file = `ЧЕКПОЙНТ_задача7_${row.studentSlug}.md`;
  fs.writeFileSync(path.join(process.cwd(), file), md, "utf8");
  console.log(`saved: ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
