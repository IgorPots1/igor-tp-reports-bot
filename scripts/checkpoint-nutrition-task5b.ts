// READ-ONLY checkpoint for Task 5b. Uses a REAL student's macros/context but
// constructs two controlled training scenarios (we override the TP training
// context to make the cases deterministic), runs them live through Claude, and
// shows the day prose reads calm — no "energy low under load".
//   A) No-training week: empty past week + noTrainingWeek=true (maintenance).
//   B) Missed-day week: one PLANNED-but-not-completed interval on a low-intake day.
// Writes ЧЕКПОЙНТ_задача5б_<case>_<slug>.md. Not persisted.
//
//   npx tsx scripts/checkpoint-nutrition-task5b.ts --student-name "Nadezhda"
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { collectNutritionAthleteReportSignalTexts, detectNutritionAthleteReportSignalsFromTexts } from "@/features/nutrition/athlete-signals";
import { listNutritionAdminDashboardRows } from "@/features/nutrition/admin";
import { buildNutritionStudentContext, type NutritionStudentContext } from "@/features/nutrition/context";
import { generateNutritionWeeklyAnalysis } from "@/features/nutrition/draft-generator";
import { resolveNutritionAiModel, resolveNutritionAiProvider } from "@/features/nutrition/nutrition-ai-provider";
import { getNutritionReportWithMacros, getNutritionStudentEssentials } from "@/features/nutrition/repository";
import { loadScriptEnv, resolveSupabaseEnv } from "./lib/load-script-env";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function buildRealContext(row: { studentId: string; latestReportId: string }): Promise<NutritionStudentContext> {
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

function writeMd(file: string, title: string, g: { generation_mode: string; ai_model: string; athlete_message_draft: string | null; coach_summary_text: string; internal_summary?: { notes?: string[] } }) {
  const notes = g.internal_summary?.notes ?? [];
  fs.writeFileSync(
    path.join(process.cwd(), file),
    [
      `# ${title}`,
      "",
      `- generation_mode: \`${g.generation_mode}\` · ai_model: \`${g.ai_model}\``,
      `- notes: ${notes.length ? notes.map((n) => `\`${n}\``).join(", ") : "(нет)"}`,
      "",
      "## Coach summary (с оговоркой про TP)",
      "",
      g.coach_summary_text || "_(нет)_",
      "",
      "## Athlete-текст",
      "",
      g.athlete_message_draft ?? "_(нет)_",
      "",
    ].join("\n"),
    "utf8"
  );
}

async function main() {
  loadScriptEnv();
  if (!resolveSupabaseEnv()) {
    console.error("Нет SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY в .env.local.");
    process.exit(1);
  }
  const provider = resolveNutritionAiProvider();
  console.log(`provider=${provider} model=${resolveNutritionAiModel(provider)}`);
  const studentName = arg("student-name");
  const dashboardRows = await listNutritionAdminDashboardRows({ viewMode: "test" });
  let eligible = dashboardRows.filter((r) => r.latestReportId);
  if (studentName) eligible = eligible.filter((r) => r.studentName.toLowerCase().includes(studentName.toLowerCase()));
  const row = eligible[0];
  if (!row) {
    console.error("Нет учеников теста с готовым отчётом.");
    process.exit(1);
  }
  const slug = row.studentSlug;
  console.log(`Ученик: ${row.studentName} (${slug}) — контролируемые сценарии тренировок на реальных макросах\n`);

  // A) No-training week: empty past-week + noTrainingWeek=true.
  const baseA = await buildRealContext({ studentId: row.studentId, latestReportId: row.latestReportId as string });
  const ctxA: NutritionStudentContext = {
    ...baseA,
    noTrainingWeek: true,
    tpPastWeek: { ...baseA.tpPastWeek, cacheStatus: "empty", cacheStatusNote: "empty (simulated no-training)", workouts: [], keyWorkouts: [], longRun: null, totalSessions: 0, completedSessions: 0, plannedSessions: 0, runningSessions: 0 },
  };
  const a = await generateNutritionWeeklyAnalysis({ context: ctxA });
  console.log(`=== A) Неделя без тренировок === generation_mode=${a.generation_mode} ai_model=${a.ai_model}`);
  console.log("notes:", (a.internal_summary?.notes ?? []).filter((n) => n.startsWith("no_training_week")).join("; ") || "(нет no_training_week)");
  writeMd(`ЧЕКПОЙНТ_задача5б_no-training_${slug}.md`, `Задача 5б — неделя без тренировок — ${row.studentName}`, a);
  console.log(`saved: ЧЕКПОЙНТ_задача5б_no-training_${slug}.md\n`);

  // B) Missed-day week: take the real context and flip its first workout to
  //    planned-but-not-completed (skipped); leave the rest as-is.
  const baseB = await buildRealContext({ studentId: row.studentId, latestReportId: row.latestReportId as string });
  if (baseB.tpPastWeek.workouts.length > 0) {
    const flipped = baseB.tpPastWeek.workouts.map((w, idx) => (idx === 0 ? { ...w, status: "planned" as const } : w));
    const ctxB: NutritionStudentContext = { ...baseB, tpPastWeek: { ...baseB.tpPastWeek, workouts: flipped } };
    const b = await generateNutritionWeeklyAnalysis({ context: ctxB });
    const skippedDate = baseB.tpPastWeek.workouts[0]?.date;
    console.log(`=== B) Пропущенный день (${skippedDate}, planned, не выполнен) === generation_mode=${b.generation_mode}`);
    writeMd(`ЧЕКПОЙНТ_задача5б_missed-day_${slug}.md`, `Задача 5б — пропущенный день (${skippedDate}) — ${row.studentName}`, b);
    console.log(`saved: ЧЕКПОЙНТ_задача5б_missed-day_${slug}.md`);
  } else {
    console.log("=== B) пропущен: у реального past-week нет тренировок для флипа ===");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
