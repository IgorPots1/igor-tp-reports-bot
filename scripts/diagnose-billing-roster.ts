/**
 * Read-only диагностика ростера биллинга.
 *
 * Отвечает на два вопроса:
 *  1) «Все ли там, кто есть» — кто из активных учеников не выставлен в биллинге,
 *     какие billing-клиенты не привязаны к ученику, и у кого клиент активен,
 *     а ученик уже ушёл (архивный) → кандидат на паузу.
 *  2) «Список пухнет по месяцам» — у кого накопились неоплаченные месяцы
 *     (pending/overdue/manual_review), которые и раздувают выпадайку.
 *
 * Только чтение: никаких записей в БД, Telegram или TrainingPeaks.
 *
 * Запуск (локально, с .env.local):
 *   npm run diagnose-billing-roster
 */
import process from "node:process";

import { loadScriptEnv, assertSupabaseEnvOrSkip } from "./lib/load-script-env";

const SCRIPT_NAME = "diagnose-billing-roster";

async function main(): Promise<void> {
  loadScriptEnv();
  if (!assertSupabaseEnvOrSkip(SCRIPT_NAME)) {
    return;
  }

  // Импорты после загрузки env, чтобы supabase-клиент видел переменные.
  const { listBillingClientsIncludingInactive, listBillingMonthlyPaymentsForClient } = await import(
    "@/features/billing/repository"
  );
  const { listTrainingPeaksAdminStudents } = await import("@/features/trainingpeaks/admin");

  const [students, clients] = await Promise.all([
    listTrainingPeaksAdminStudents("all"),
    listBillingClientsIncludingInactive(),
  ]);

  const studentById = new Map(students.map((student) => [student.id, student] as const));
  const activeStudents = students.filter((student) => student.isActive);
  const activeClients = clients.filter((client) => client.isActive);
  const linkedStudentIds = new Set(
    activeClients.flatMap((client) => (client.studentId ? [client.studentId] : []))
  );

  const UNPAID_STATUSES = new Set(["pending", "overdue", "manual_review"]);

  // 1) Активные ученики без активного billing-клиента (счёт не выставляется).
  const activeStudentsWithoutClient = activeStudents.filter((student) => !linkedStudentIds.has(student.id));

  // 2) Активные billing-клиенты без привязки к ученику.
  const activeClientsWithoutStudent = activeClients.filter((client) => !client.studentId);

  // 3) Активный billing-клиент, но ученик ушёл (архивный) или не найден → кандидат на паузу.
  const activeClientsWithDepartedStudent = activeClients.filter((client) => {
    if (!client.studentId) {
      return false;
    }
    const student = studentById.get(client.studentId);
    return !student || !student.isActive;
  });

  // 4) Накопление неоплаченных месяцев по активным клиентам.
  const unpaidByClient = await Promise.all(
    activeClients.map(async (client) => {
      const months = await listBillingMonthlyPaymentsForClient(client.id);
      const unpaidMonths = months
        .filter((month) => UNPAID_STATUSES.has(month.status))
        .map((month) => month.billingMonth)
        .sort();
      return { client, unpaidCount: unpaidMonths.length, unpaidMonths };
    })
  );
  const clientsWithBacklog = unpaidByClient
    .filter((row) => row.unpaidCount >= 2)
    .sort((left, right) => right.unpaidCount - left.unpaidCount);
  const totalUnpaidRows = unpaidByClient.reduce((sum, row) => sum + row.unpaidCount, 0);

  // ----- Отчёт -----
  const line = (label: string, value: string | number): void => console.log(`  ${label}: ${value}`);

  console.log(`\n[${SCRIPT_NAME}] read-only roster report\n`);
  console.log("Сводка:");
  line("Всего учеников (TP)", students.length);
  line("  из них активных", activeStudents.length);
  line("Всего billing-клиентов", clients.length);
  line("  из них активных", activeClients.length);
  line("Неоплаченных месячных строк (по активным клиентам)", totalUnpaidRows);

  console.log(`\n1) Активные ученики БЕЗ активного billing-клиента (${activeStudentsWithoutClient.length}) — счёт не выставляется:`);
  if (activeStudentsWithoutClient.length === 0) {
    console.log("   — нет, все активные ученики покрыты.");
  } else {
    for (const student of activeStudentsWithoutClient) {
      console.log(`   • ${student.studentName} (${student.studentId})`);
    }
  }

  console.log(`\n2) Активные billing-клиенты БЕЗ привязки к ученику (${activeClientsWithoutStudent.length}):`);
  if (activeClientsWithoutStudent.length === 0) {
    console.log("   — нет.");
  } else {
    for (const client of activeClientsWithoutStudent) {
      console.log(`   • ${client.clientName}${client.groupName ? ` [${client.groupName}]` : ""}`);
    }
  }

  console.log(`\n3) Клиент активен, а ученик ушёл/не найден (${activeClientsWithDepartedStudent.length}) — кандидаты «на паузу»:`);
  if (activeClientsWithDepartedStudent.length === 0) {
    console.log("   — нет.");
  } else {
    for (const client of activeClientsWithDepartedStudent) {
      const student = client.studentId ? studentById.get(client.studentId) : undefined;
      const reason = student ? "ученик архивный" : "ученик не найден";
      console.log(`   • ${client.clientName}${client.groupName ? ` [${client.groupName}]` : ""} — ${reason}`);
    }
  }

  console.log(`\n4) Накопленные неоплаченные месяцы (≥2) — раздувают список (${clientsWithBacklog.length}):`);
  if (clientsWithBacklog.length === 0) {
    console.log("   — нет, накоплений нет.");
  } else {
    for (const row of clientsWithBacklog) {
      const monthsLabel = row.unpaidMonths.map((month) => month.slice(0, 7)).join(", ");
      console.log(`   • ${row.client.clientName}: ${row.unpaidCount} мес. (${monthsLabel})`);
    }
  }

  console.log(`\n[${SCRIPT_NAME}] done (read-only, изменений не вносилось).`);
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] FAILED:`, error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
