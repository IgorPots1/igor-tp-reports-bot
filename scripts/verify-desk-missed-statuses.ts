// Живая проверка критериев наряда 2026-10-02 «статусы выполнил / не выполнил в /m/desk».
// ТОЛЬКО ЧТЕНИЕ: ничего не пишет ни в Supabase, ни в TP, в Telegram не шлёт. Гоняет ту же
// чистую логику, что и десктоп с дайджестом (evaluateYesterdayRunExecution,
// summarizeYesterdayScanAttention), на настоящих строках кэша.
//
//   npx tsx scripts/verify-desk-missed-statuses.ts
//
// Печатает: покрытие статусами (пагинация), учеников «нет доступа к TP», свежесть ok-скана у
// активных и разбор конкретных дней из аудита (Denisova, Alfina, замены).

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function loadEnv(): void {
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    path.join(process.env.HOME ?? "", "igor-tp-reports-bot", ".env.local"),
  ];
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/u);
      if (!match || process.env[match[1]!] !== undefined) continue;
      process.env[match[1]!] = match[2]!.replace(/^["']|["']$/gu, "");
    }
    return;
  }
}

const AUDIT_DAYS: Array<{ name: string; dates: string[] }> = [
  { name: "Anna Denisova", dates: ["2026-09-22", "2026-09-23", "2026-09-30", "2026-10-01"] },
  { name: "Alfina", dates: ["2026-09-21"] },
  { name: "Kristina Pamparaite", dates: ["2026-09-23", "2026-09-29"] },
  { name: "Tatyana Rishko", dates: ["2026-09-18", "2026-09-20"] },
  { name: "Polyakova Anastasia", dates: ["2026-09-27"] },
  { name: "Stas", dates: ["2026-09-29"] },
];

async function main(): Promise<void> {
  loadEnv();
  const repository = await import("@/features/trainingpeaks/repository");
  const service = await import("@/features/trainingpeaks/service");

  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const [students, statuses] = await Promise.all([
    repository.listTrainingPeaksStudents(),
    repository.listTrainingPeaksWorkoutCacheScanStatusesCoveringDate(yesterday),
  ]);
  const active = students.filter((student) => student.isActive);
  const summary = service.summarizeYesterdayScanAttention({
    activeStudents: active.map((student) => ({ id: student.id, studentName: student.studentName })),
    statuses: statuses.map((status) => ({
      studentId: status.studentId,
      status: status.status,
      scannedAt: status.scannedAt,
      errorMessage: status.errorMessage,
    })),
  });

  console.log(`== Покрытие статусами за ${yesterday}`);
  console.log(
    `строк статусов: ${statuses.length}; учеников со статусом: ${new Set(statuses.map((s) => s.studentId)).size}; активных: ${active.length}; без статуса: ${summary.missingScanCount}`
  );

  console.log("\n== Нет доступа к TP (последний скан 403)");
  const nameById = new Map(active.map((student) => [student.id, student.studentName]));
  for (const id of summary.accessLostStudentIds) {
    const lastOk = await repository.getLatestOkTrainingPeaksWorkoutCacheScanAt(id);
    console.log(`- ${nameById.get(id) ?? id}: последний ok ${lastOk ?? "никогда"}`);
  }

  console.log("\n== Свежесть ok-скана у активных (без 403 и без TP id)");
  const now = Date.now();
  let fresh = 0;
  const stale: string[] = [];
  for (const student of active) {
    if (summary.accessLostStudentIds.has(student.id)) continue;
    const latest = summary.latestStatusByStudentId.get(student.id);
    if (latest?.status === "skipped") continue;
    const ok = summary.latestOkStatusByStudentId.get(student.id);
    const ageH = ok ? (now - new Date(ok.scannedAt).getTime()) / 3_600_000 : Infinity;
    if (ageH <= 8) fresh += 1;
    else stale.push(`${student.studentName} (${ageH === Infinity ? "нет ok" : `${ageH.toFixed(1)} ч`})`);
  }
  console.log(`ok-скан не старше 8 ч: ${fresh}; старше: ${stale.length}${stale.length ? ` — ${stale.join(", ")}` : ""}`);

  console.log("\n== Дни из аудита (новая логика)");
  for (const { name, dates } of AUDIT_DAYS) {
    const student = students.find((item) => item.studentName === name);
    if (!student) {
      console.log(`- ${name}: ученик не найден`);
      continue;
    }
    for (const date of dates) {
      const rows = await repository.listTrainingPeaksWorkoutCacheForDateRange({ from: date, to: date, studentId: student.id });
      const result = service.evaluateYesterdayRunExecution(rows);
      const verdict =
        result.missedRunningPlannedCount > 0
          ? `ПРОПУСК ×${result.missedRunningPlannedCount}`
          : result.offPlanLines.length > 0
            ? result.offPlanLines.join("; ")
            : "не пропуск";
      console.log(`- ${name} ${date}: ${verdict}`);
    }
  }
}

main().catch((error) => {
  console.error("[verify-desk-missed-statuses] FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
