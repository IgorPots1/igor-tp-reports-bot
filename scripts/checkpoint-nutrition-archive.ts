// LIVE checkpoint for Task 2 (soft archive). Archives a test student's latest
// report + weekly analysis, verifies they drop out of the active reads ("latest",
// "previous week"/memory source) while approved patterns stay intact, then
// UN-archives them (net-zero). Mutates archived_at only; reversible.
//
//   npx tsx scripts/checkpoint-nutrition-archive.ts --student-name "Любовь"
import process from "node:process";

import { listNutritionAdminDashboardRows } from "@/features/nutrition/admin";
import {
  getNutritionStudentProfile,
  getNutritionWeeklyAnalysisForWeek,
  listNutritionReportsForStudent,
  listNutritionWeeklyAnalysesForStudentHistory,
  listRecentNutritionWeeklyAnalysesForStudent,
  setNutritionReportArchived,
  setNutritionWeeklyAnalysisArchived,
} from "@/features/nutrition/repository";
import { loadScriptEnv, resolveSupabaseEnv } from "./lib/load-script-env";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const yn = (b: boolean) => (b ? "да" : "нет");

async function main() {
  loadScriptEnv();
  if (!resolveSupabaseEnv()) {
    console.error("Нет SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY в .env.local.");
    process.exit(1);
  }
  const studentName = arg("student-name") ?? "Любовь";
  const rows = await listNutritionAdminDashboardRows({ viewMode: "test" });
  const row = rows.find((r) => r.studentName.toLowerCase().includes(studentName.toLowerCase()));
  if (!row) {
    console.error(`Не найден ученик ${studentName}`);
    process.exit(1);
  }
  const studentId = row.studentId;
  console.log(`student: ${row.studentName} (${studentId})`);

  const history = await listNutritionWeeklyAnalysesForStudentHistory(studentId);
  const analysis = history.find((a) => !a.archivedAt) ?? history[0];
  const reportsActiveBefore = await listNutritionReportsForStudent(studentId);
  const report = reportsActiveBefore[0];
  if (!analysis || !report) {
    console.error("Нет активного разбора или отчёта для теста.");
    process.exit(1);
  }
  const week = { weekFrom: analysis.weekFrom, weekTo: analysis.weekTo };
  const memoryBefore = JSON.stringify((await getNutritionStudentProfile(studentId))?.nutritionMemory ?? null);

  const probe = async () => {
    const forWeek = await getNutritionWeeklyAnalysisForWeek({ studentId, ...week });
    const recent = await listRecentNutritionWeeklyAnalysesForStudent(studentId);
    const activeReports = await listNutritionReportsForStudent(studentId);
    const memory = JSON.stringify((await getNutritionStudentProfile(studentId))?.nutritionMemory ?? null);
    return {
      analysisVisibleForWeek: forWeek?.id === analysis.id,
      analysisInRecent: recent.some((a) => a.id === analysis.id),
      reportInActive: activeReports.some((r) => r.id === report.id),
      memoryUnchanged: memory === memoryBefore,
    };
  };

  console.log(`\nЦель: разбор ${week.weekFrom}–${week.weekTo} (${analysis.id.slice(0, 8)}), отчёт ${report.id.slice(0, 8)}`);
  console.log(`Память (approved patterns): ${memoryBefore}`);

  const before = await probe();
  console.log(`\n[ДО] разбор виден за неделю=${yn(before.analysisVisibleForWeek)} · в recent(память)=${yn(before.analysisInRecent)} · отчёт в активных=${yn(before.reportInActive)}`);

  await setNutritionWeeklyAnalysisArchived(analysis.id, true);
  await setNutritionReportArchived(report.id, true);
  const archived = await probe();
  const archivedInHistory = (await listNutritionWeeklyAnalysesForStudentHistory(studentId)).some(
    (a) => a.id === analysis.id && Boolean(a.archivedAt)
  );
  console.log(`[АРХИВ] разбор виден за неделю=${yn(archived.analysisVisibleForWeek)} · в recent(память)=${yn(archived.analysisInRecent)} · отчёт в активных=${yn(archived.reportInActive)} · виден в истории(архив)=${yn(archivedInHistory)} · память цела=${yn(archived.memoryUnchanged)}`);

  await setNutritionWeeklyAnalysisArchived(analysis.id, false);
  await setNutritionReportArchived(report.id, false);
  const restored = await probe();
  console.log(`[ВОЗВРАТ] разбор виден за неделю=${yn(restored.analysisVisibleForWeek)} · в recent(память)=${yn(restored.analysisInRecent)} · отчёт в активных=${yn(restored.reportInActive)} · память цела=${yn(restored.memoryUnchanged)}`);

  const ok =
    before.analysisVisibleForWeek &&
    before.reportInActive &&
    !archived.analysisVisibleForWeek &&
    !archived.analysisInRecent &&
    !archived.reportInActive &&
    archivedInHistory &&
    archived.memoryUnchanged &&
    restored.analysisVisibleForWeek &&
    restored.analysisInRecent &&
    restored.reportInActive &&
    restored.memoryUnchanged;
  console.log(`\nROUND-TRIP: ${ok ? "✅ OK (архив скрыл, память цела, возврат восстановил, net-zero)" : "❌ что-то не так — см. строки выше"}`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
