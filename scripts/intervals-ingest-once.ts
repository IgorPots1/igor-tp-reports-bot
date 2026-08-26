/**
 * Ручной приём тренировок ученика из Intervals.icu.
 *
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=.env.local scripts/intervals-ingest-once.ts \
 *     --student=<student_id> [--all | --from=YYYY-MM-DD --to=YYYY-MM-DD] [--verify=<activity_id>]
 *
 * --all              вся история (с 2010 года)
 * --from / --to      период, границы включительно; --to по умолчанию сегодня
 * --verify=<id>      после прогона показать длины рядов этой активности
 *
 * Повторный запуск по тому же периоду ничего не дублирует: идемпотентность
 * держится на upsert по activity_id провайдера.
 *
 * Регулярный опрос и вебхуки — отдельный кусок; здесь их намеренно нет.
 */
import process from "node:process";

import { HISTORY_START, ingestStudentActivities } from "@/features/intervals/ingest";
import { findStudentByKey, getStreamLengths, summariseStudent } from "@/features/intervals/repository";

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function main(): Promise<void> {
  const studentKey = arg("student");
  const all = process.argv.includes("--all");
  const from = arg("from");
  const to = arg("to");
  const verifyActivityId = arg("verify");

  if (!studentKey) {
    console.error("Нужен --student=<student_id>");
    process.exit(1);
  }
  for (const [label, value] of [["--from", from], ["--to", to]] as const) {
    if (value && !DATE_RE.test(value)) {
      console.error(`${label} должен быть в виде YYYY-MM-DD`);
      process.exit(1);
    }
  }
  if (!all && !from) {
    console.error("Укажите период: --all или --from=YYYY-MM-DD");
    process.exit(1);
  }

  const student = await findStudentByKey(studentKey);
  if (!student) {
    console.error(`Ученик со student_id=${studentKey} не найден`);
    process.exit(1);
  }

  console.log(`Ученик: ${student.studentName} (${student.studentId})`);

  const startedAt = Date.now();
  const summary = await ingestStudentActivities({
    studentUuid: student.id,
    from: all ? HISTORY_START : (from ?? undefined),
    to: to ?? undefined,
    onProgress: (message) => console.log(message),
  });

  const seconds = Math.round((Date.now() - startedAt) / 1000);

  console.log("");
  console.log("── Итог прогона ─────────────────────────────");
  console.log(`athlete_id:            ${summary.externalAthleteId}`);
  console.log(`период:                ${summary.from} … ${summary.to}`);
  console.log(`активностей в списке:  ${summary.activitiesSeen}`);
  console.log(`сохранено:             ${summary.activitiesSaved}`);
  console.log(`с рядами:              ${summary.streamsSaved}`);
  console.log(`без рядов:             ${summary.streamsMissing}`);
  console.log(`с пульсом:             ${summary.withHeartrate}`);
  console.log(`только темп:           ${summary.paceOnly}`);
  console.log(`без пульса и темпа:    ${summary.noData}`);
  console.log(`ошибок:                ${summary.failures.length}`);
  console.log(`время:                 ${seconds} с`);

  if (summary.failures.length > 0) {
    console.log("");
    console.log("Не удалось забрать:");
    for (const failure of summary.failures.slice(0, 20)) {
      console.log(`  ${failure.activityId}: ${failure.reason}`);
    }
    if (summary.failures.length > 20) {
      console.log(`  …и ещё ${summary.failures.length - 20}`);
    }
  }

  // Сводка из БАЗЫ, а не из счётчиков прогона: она показывает, что реально
  // лежит у ученика после всех прогонов, включая прошлые.
  const stored = await summariseStudent(student.id);
  console.log("");
  console.log("── В базе по ученику ────────────────────────");
  console.log(`всего:        ${stored.total}`);
  console.log(`с пульсом:    ${stored.withHeartrate}`);
  console.log(`только темп:  ${stored.paceOnly}`);
  console.log(`без данных:   ${stored.noData}`);

  if (verifyActivityId) {
    const lengths = await getStreamLengths(verifyActivityId);
    console.log("");
    console.log(`── Ряды активности ${verifyActivityId} ──`);
    if (!lengths) {
      console.log("рядов в базе нет");
    } else {
      console.log(`point_count:      ${lengths.pointCount}`);
      console.log(`time:             ${lengths.time}`);
      console.log(`heartrate:        ${lengths.heartrate ?? "ряда нет"}`);
      console.log(`velocity_smooth:  ${lengths.velocitySmooth ?? "ряда нет"}`);
    }
  }
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
