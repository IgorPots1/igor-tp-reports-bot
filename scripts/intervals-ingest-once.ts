/**
 * Ручной приём тренировок из Intervals.icu.
 *
 * Боевой прогон — по ученику, доступ берётся из базы, привезённое ложится в базу:
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=.env.local scripts/intervals-ingest-once.ts \
 *     --student=<student_id> [--from=YYYY-MM-DD --to=YYYY-MM-DD] [--verify=<activity_id>]
 *
 * Источник без владельца (аккаунт тренера, тестовое подключение) адресуется
 * не учеником, а аккаунтом:
 *   node ... scripts/intervals-ingest-once.ts --athlete=i38500 --all
 *
 * Холостой прогон — по аккаунту, БЕЗ ученика и БЕЗ записи в базу:
 *   node ... scripts/intervals-ingest-once.ts --dry-run --athlete=i38500 --all
 *
 * --all              вся история (с 2010 года) — ЭТО ЖЕ И ПОВЕДЕНИЕ ПО УМОЛЧАНИЮ
 * --from / --to      сузить до периода, границы включительно; --to по умолчанию сегодня
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

import {
  dryRunActivities,
  HISTORY_START,
  ingestAthleteActivities,
  ingestStudentActivities,
} from "@/features/intervals/ingest";
import { findStudentByKey, getStreamLengths, summariseSource } from "@/features/intervals/repository";
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
  // Период по умолчанию — ВСЯ история. Полная история на онбординге стоит
  // своих мегабайт: пятилетний архив тяжёлого пользователя занял 67,5 МБ сырого
  // JSON, и это верхняя граница, а не типичный случай. Окно (--from/--to)
  // остаётся опцией — на случай, если кто-то придёт с десятью годами.

  const startedAt = Date.now();
  const period = {
    from: all || !from ? HISTORY_START : from,
    to: to ?? undefined,
  };

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

  // Боевой прогон адресуется либо учеником, либо аккаунтом. Второе — не
  // «удобство»: у источников без владельца (kind self/test) ученика нет, и
  // адресовать их можно ТОЛЬКО по athlete_id.
  const studentKey = arg("student");
  const athleteKey = arg("athlete");
  if (!studentKey && !athleteKey) {
    fail("Нужен --student=<student_id> или --athlete=<i38500>");
  }
  if (studentKey && athleteKey) {
    fail("Укажите что-то одно: --student или --athlete");
  }

  let summary;
  if (studentKey) {
    const student = await findStudentByKey(studentKey);
    if (!student) fail(`Ученик со student_id=${studentKey} не найден`);
    console.log(`Ученик: ${student.studentName} (${student.studentId})`);
    summary = await ingestStudentActivities({
      studentUuid: student.id,
      ...period,
      onProgress: (message) => console.log(message),
    });
  } else {
    console.log(`Аккаунт: ${athleteKey}`);
    summary = await ingestAthleteActivities(athleteKey!, {
      ...period,
      onProgress: (message) => console.log(message),
    });
  }
  printSummary(summary, Math.round((Date.now() - startedAt) / 1000));

  // Сводка из БАЗЫ, а не из счётчиков прогона: она показывает, что реально
  // лежит по источнику после ВСЕХ прогонов, включая прошлые. По источнику, а не
  // по ученику: у self/test ученика нет, а сводка нужна одинаково.
  const stored = await summariseSource(summary.sourceId!);
  console.log("");
  console.log("── В базе по источнику ──────────────────────");
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
