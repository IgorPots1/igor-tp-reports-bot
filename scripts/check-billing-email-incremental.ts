// Чек окна ежедневного крона billing-email-import (аудит 2026-10-11): смотреть назад только с
// последнего успешного прогона минус 2 дня, а не всё окно lookbackDays каждый день. Без БД и сети.
//
// Главное, что стережёт чек: окно только СУЖАЕТСЯ. Дальше lookbackDays назад не уходим, а без
// прошлого успеха работает прежний lookbackDays — пропустить письмо из-за этой правки нельзя.

import process from "node:process";

import { BILLING_EMAIL_INCREMENTAL_MARGIN_DAYS, resolveIncrementalSince } from "@/features/billing/email-ingestion";

const LOG_PREFIX = "[check-billing-email-incremental]";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function main(): void {
  const now = new Date("2026-10-11T08:58:28Z");
  assert(BILLING_EMAIL_INCREMENTAL_MARGIN_DAYS === 2, "запас 2 дня");

  // Обычный день: вчерашний успех в 08:58 → окно с позавчера-1 (10.10 − 2 дня = 08.10).
  assert(
    resolveIncrementalSince({ lastSuccessStartedAt: "2026-10-10T08:58:28Z", lookbackDays: 7, now }) === "2026-10-08",
    "вчерашний успех — с 08.10",
  );
  // Сегодняшний прогон упал (11.10, Unexpected close): завтра окно всё равно от 10.10 − 2 дня.
  assert(
    resolveIncrementalSince({
      lastSuccessStartedAt: "2026-10-10T08:58:28Z",
      lookbackDays: 7,
      now: new Date("2026-10-12T08:58:28Z"),
    }) === "2026-10-08",
    "после упавшего прогона — от прошлого успеха",
  );
  // Успеха давно не было — не уходим дальше lookbackDays: null = прежнее полное окно.
  assert(
    resolveIncrementalSince({ lastSuccessStartedAt: "2026-09-20T08:58:28Z", lookbackDays: 7, now }) === null,
    "старый успех — полное окно lookbackDays",
  );
  // Совсем нет успеха / битая дата — полное окно.
  assert(resolveIncrementalSince({ lastSuccessStartedAt: null, lookbackDays: 7, now }) === null, "нет успеха");
  assert(resolveIncrementalSince({ lastSuccessStartedAt: "не дата", lookbackDays: 7, now }) === null, "битая дата");
  // Граница: успех ровно lookbackDays − margin назад — окно совпало бы с полным, оставляем полное.
  assert(
    resolveIncrementalSince({ lastSuccessStartedAt: "2026-10-06T08:58:28Z", lookbackDays: 7, now }) === null,
    "совпадает с полным — полное",
  );
  // Расширенный lookback через env (например 30): окно всё равно от прошлого успеха.
  assert(
    resolveIncrementalSince({ lastSuccessStartedAt: "2026-10-10T08:58:28Z", lookbackDays: 30, now }) === "2026-10-08",
    "lookback 30 — от прошлого успеха",
  );

  console.log(`${LOG_PREFIX} OK`);
}

try {
  main();
} catch (error) {
  console.error(`${LOG_PREFIX} FAILED:`, error instanceof Error ? error.message : error);
  process.exit(1);
}
