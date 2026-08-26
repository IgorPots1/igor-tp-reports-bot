/**
 * Ручной приём тренировок из Intervals.icu.
 *
 * Боевой прогон — по ученику, доступ берётся из базы, привезённое ложится в базу:
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=.env.local scripts/intervals-ingest-once.ts \
 *     --student=<student_id> [--all | --from=YYYY-MM-DD --to=YYYY-MM-DD] [--verify=<activity_id>]
 *
 * Холостой прогон — по аккаунту, БЕЗ ученика и БЕЗ записи в базу:
 *   node ... scripts/intervals-ingest-once.ts --dry-run --athlete=i38500 --all
 *
 * --all              вся история (с 2010 года)
 * --from / --to      период, границы включительно; --to по умолчанию сегодня
 * --verify=<id>      после боевого прогона показать длины рядов этой активности
 * --dry-run          пройти весь путь и посчитать всё, но не записать ни строки
 * --key-env=ИМЯ      откуда брать ключ в холостом прогоне (INTERVALS_PILOT_API_KEY)
 *
 * Повторный боевой запуск по тому же периоду ничего не дублирует: идемпотентность
 * держится на upsert по activity_id провайдера.
 *
 * Регулярный опрос и вебхуки — отдельный кусок; здесь их намеренно нет.
 */
import process from "node:process";

import { dryRunActivities, HISTORY_START, ingestStudentActivities } from "@/features/intervals/ingest";
import { findStudentByKey, getStreamLengths, summariseStudent } from "@/features/intervals/repository";
import type { IngestSummary } from "@/features/intervals/types";

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function printSummary(summary: IngestSummary, seconds: number): void {
  console.log("");
  console.log(
    summary.dryRun
      ? "── Итог ХОЛОСТОГО прогона (в базу не писали) ─"
      : "── Итог прогона ─────────────────────────────"
  );
  console.log(`athlete_id:            ${summary.externalAthleteId}`);
  console.log(`период:                ${summary.from} … ${summary.to}`);
  console.log(`активностей в списке:  ${summary.activitiesSeen}`);
  console.log(`${summary.dryRun ? "обработано:           " : "сохранено:            "} ${summary.activitiesSaved}`);
  console.log(`с рядами:              ${summary.streamsSaved}`);
  console.log(`без рядов:             ${summary.streamsMissing}`);
  console.log(`с пульсом:             ${summary.withHeartrate}`);
  console.log(`только темп:           ${summary.paceOnly}`);
  console.log(`без пульса и темпа:    ${summary.noData}`);
  console.log(`ошибок:                ${summary.failures.length}`);
  console.log(`время:                 ${seconds} с`);

  if (summary.dryRun && summary.streamsSaved > 0) {
    const mb = summary.streamBytes / 1024 / 1024;
    const perActivityKb = summary.streamBytes / summary.streamsSaved / 1024;
    console.log(`объём рядов:           ${mb.toFixed(1)} МБ (${perActivityKb.toFixed(1)} КБ на тренировку)`);
  }

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
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const all = process.argv.includes("--all");
  const from = arg("from");
  const to = arg("to");

  for (const [label, value] of [["--from", from], ["--to", to]] as const) {
    if (value && !DATE_RE.test(value)) fail(`${label} должен быть в виде YYYY-MM-DD`);
  }
  if (!all && !from) fail("Укажите период: --all или --from=YYYY-MM-DD");

  const startedAt = Date.now();
  const period = { from: all ? HISTORY_START : (from ?? undefined), to: to ?? undefined };

  if (dryRun) {
    const athleteId = arg("athlete");
    if (!athleteId) fail("Для --dry-run нужен --athlete=<i38500>");

    const keyEnv = arg("key-env") ?? "INTERVALS_PILOT_API_KEY";
    const credential = process.env[keyEnv]?.trim();
    if (!credential) fail(`Переменная окружения ${keyEnv} пуста — нечем авторизоваться.`);

    console.log(`Холостой прогон по аккаунту ${athleteId}. В базу не пишем.`);
    const summary = await dryRunActivities({
      credentials: { authMethod: "api_key", credential },
      athleteId,
      ...period,
      onProgress: (message) => console.log(message),
    });
    printSummary(summary, Math.round((Date.now() - startedAt) / 1000));
    console.log("");
    console.log("Холостой прогон: в базу не записано ничего.");
    return;
  }

  const studentKey = arg("student");
  if (!studentKey) fail("Нужен --student=<student_id> (или --dry-run --athlete=<i38500>)");

  const student = await findStudentByKey(studentKey);
  if (!student) fail(`Ученик со student_id=${studentKey} не найден`);

  console.log(`Ученик: ${student.studentName} (${student.studentId})`);
  const summary = await ingestStudentActivities({
    studentUuid: student.id,
    ...period,
    onProgress: (message) => console.log(message),
  });
  printSummary(summary, Math.round((Date.now() - startedAt) / 1000));

  // Сводка из БАЗЫ, а не из счётчиков прогона: она показывает, что реально
  // лежит у ученика после всех прогонов, включая прошлые.
  const stored = await summariseStudent(student.id);
  console.log("");
  console.log("── В базе по ученику ────────────────────────");
  console.log(`всего:        ${stored.total}`);
  console.log(`с пульсом:    ${stored.withHeartrate}`);
  console.log(`только темп:  ${stored.paceOnly}`);
  console.log(`без данных:   ${stored.noData}`);

  const verifyActivityId = arg("verify");
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
