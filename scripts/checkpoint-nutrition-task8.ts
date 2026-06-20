// READ-ONLY checkpoint for Task 8 (coach notes at upload). Live Claude run on a
// real student with a coach note injected ("интервалы натощак рано утром"). Proves
// the note reaches the review and shifts fueling to the NIGHT BEFORE / AFTER, not
// "low carbs in the day before the workout". Nothing is persisted.
//
//   npx tsx scripts/checkpoint-nutrition-task8.ts --student-name "Nadezhda"
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
  const coachNote =
    arg("coach-note") ??
    "Интервалы в среду Надя делает натощак, рано утром около 6:48 (так удобнее по графику). Вторник был суматошный, ела на бегу.";

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

  // Inject the coach note exactly as the upload flow would (report.coach_notes_ru).
  const context = await buildNutritionStudentContext({
    studentId: row.studentId,
    weekFrom: report.report.weekFrom,
    weekTo: report.report.weekTo,
    manualRows: macroRows,
    athleteReportSignals: detectNutritionAthleteReportSignalsFromTexts(signalTexts),
    coachReportNoteRu: coachNote,
  });
  console.log(`coachReportNoteRu in context: ${Boolean(context.coachReportNoteRu)}`);

  const generated = await generateNutritionWeeklyAnalysis({ context });
  const daily = Array.isArray(generated.nutrition_summary?.daily_analysis) ? generated.nutrition_summary.daily_analysis : [];
  const dayProse = (d: Record<string, unknown>): string => (typeof d.athlete_prose === "string" ? d.athlete_prose : "");

  // Find the interval / hard day (the fasted one).
  const intervalDay = daily.find((d) => {
    const obj = asObject(d);
    const label = `${obj.training_label ?? ""} ${obj.training_type ?? ""}`.toLowerCase();
    return /интерв|7\s*[x×х]\s*5|6\s*[x×х]\s*6|темп|tempo/.test(label) || asObject(obj.flags).hard === true;
  });
  const intervalProse = intervalDay ? dayProse(asObject(intervalDay)) : "";
  const prevDay = intervalDay
    ? daily.find((d) => asObject(d).date === addDaysLocal(String(asObject(intervalDay).date), -1))
    : undefined;

  console.log(`generation_mode=${generated.generation_mode} ai_model=${generated.ai_model}`);
  console.log(`--- interval/fasted day prose ---\n${intervalProse || "(нет)"}`);

  const md = [
    `# Чекпойнт Задача 8 — ${row.studentName}`,
    "",
    "## Заметка тренера (как при загрузке)",
    `> ${coachNote}`,
    "",
    `- provider/model: \`${provider}\` / \`${generated.ai_model}\` · generation_mode: \`${generated.generation_mode}\``,
    `- заметка доехала в контекст: **${Boolean(context.coachReportNoteRu)}**`,
    "",
    "## Подневный разбор (модельный)",
    "",
    ...daily.map((d) => {
      const o = asObject(d);
      const prose = dayProse(o);
      return `### ${o.date} — ${o.training_label ?? o.training_type ?? ""}\n${prose || "_(дет. комментарий)_"}`;
    }),
    "",
    "## Что проверяем (натощак)",
    `- День интервалов (натощак утром): акцент должен сместиться на УЖИН НАКАНУНЕ и ЗАВТРАК/восстановление ПОСЛЕ, а не «в день до тренировки мало углеводов».`,
    prevDay ? `- День накануне интервалов (${asObject(prevDay).date}): ${dayProse(asObject(prevDay)) || "_(дет.)_"}` : "",
    "",
    "## Coach summary (от того же вызова)",
    "",
    (asObject(generated.nutrition_summary).coach_summary_text as string) ?? "_(нет)_",
    "",
  ].filter(Boolean).join("\n");
  const file = `ЧЕКПОЙНТ_задача8_${row.studentSlug}.md`;
  fs.writeFileSync(path.join(process.cwd(), file), md, "utf8");
  console.log(`saved: ${file}`);
}

function addDaysLocal(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0)).toISOString().slice(0, 10);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
