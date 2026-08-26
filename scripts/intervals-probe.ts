/**
 * Разведка API Intervals.icu: ТОЛЬКО чтение, без единой записи в базу.
 *
 * Зачем отдельный скрипт. Формы ответов провайдера взяты из документации, а не
 * из живого ответа, — в этом репозитории на таком уже обжигались (наряд говорил
 * torque/normalizedSpeed, в реальности torqueAverage/normalizedSpeedActual).
 * Пока ключ не приехал, проверить было не на чем; этот скрипт даёт проверить
 * сразу, как только ключ появится, и ДО того, как что-то поедет в базу.
 *
 * Печатает ФОРМУ ответа — имена полей, типы, длины рядов — и ни одного
 * значения, кроме безобидных (id активности, вид спорта, длины). Ключ не
 * печатается никогда.
 *
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=.env.local scripts/intervals-probe.ts \
 *     --athlete=i38500 --from=2026-08-01 [--to=2026-08-26] [--activity=i179603376]
 */
import process from "node:process";

import { fetchActivities, fetchActivity, fetchActivityStreams } from "@/features/intervals/api-client";
import { assessDataQuality } from "@/features/intervals/data-quality";
import type { DataSourceCredentials } from "@/features/intervals/auth";

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : null;
}

/** Описывает значение типом и размером, но НЕ содержимым. */
function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `array[${value.length}]`;
  switch (typeof value) {
    case "string":
      return `string(${value.length})`;
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "object":
      return `object{${Object.keys(value as object).length}}`;
    default:
      return typeof value;
  }
}

async function main(): Promise<void> {
  const athleteId = arg("athlete");
  const from = arg("from");
  const to = arg("to") ?? new Date().toISOString().slice(0, 10);
  const activityArg = arg("activity");
  const keyEnv = arg("key-env") ?? "INTERVALS_PILOT_API_KEY";

  if (!athleteId || !from) {
    console.error("Нужны --athlete=<i38500> и --from=YYYY-MM-DD");
    process.exit(1);
  }

  const credential = process.env[keyEnv]?.trim();
  if (!credential) {
    console.error(`Переменная окружения ${keyEnv} пуста — нечем авторизоваться.`);
    process.exit(1);
  }

  const source: DataSourceCredentials = { authMethod: "api_key", credential };

  console.log(`── Список активностей ${from} … ${to} ──`);
  const list = await fetchActivities(source, athleteId, from, to);
  console.log(`получено: ${list.length}`);
  if (list.length === 0) {
    console.log("пусто — возьмите период пошире");
    return;
  }

  const first = list[0];
  console.log(`первая: ${first.id} · ${first.type ?? "?"} · старт ${first.start_date_local ?? "?"}`);
  console.log("поля строки списка:");
  for (const [key, value] of Object.entries(first).slice(0, 40)) {
    console.log(`  ${key}: ${describe(value)}`);
  }

  const activityId = activityArg ?? first.id;
  console.log("");
  console.log(`── Детали активности ${activityId} ──`);
  const activity = await fetchActivity(source, activityId);
  const detailKeys = Object.keys(activity);
  console.log(`полей: ${detailKeys.length}`);
  for (const key of ["type", "name", "start_date", "start_date_local", "timezone", "moving_time", "elapsed_time", "distance", "average_heartrate", "max_heartrate", "average_speed", "total_elevation_gain", "calories"]) {
    console.log(`  ${key}: ${key in activity ? describe(activity[key]) : "ПОЛЯ НЕТ"}`);
  }

  console.log("");
  console.log(`── Ряды активности ${activityId} ──`);
  const streams = await fetchActivityStreams(source, activityId);
  if (!streams) {
    console.log("рядов нет (или нет оси времени)");
    return;
  }
  console.log(`time:            ${streams.time.length}`);
  console.log(`heartrate:       ${streams.heartrate ? streams.heartrate.length : "ряда нет"}`);
  console.log(`velocity_smooth: ${streams.velocitySmooth ? streams.velocitySmooth.length : "ряда нет"}`);

  // Проверка «точка в секунду»: у ровного ряда разности времени равны 1.
  const gaps = new Set<number>();
  for (let i = 1; i < Math.min(streams.time.length, 200); i += 1) {
    gaps.add(streams.time[i] - streams.time[i - 1]);
  }
  console.log(`шаг времени (первые 200 точек): ${[...gaps].sort((a, b) => a - b).join(", ")}`);

  const quality = assessDataQuality(streams);
  console.log("");
  console.log(`уровень данных: ${quality.dataLevel}`);
  console.log(`пульс: ${quality.hasHeartrate}, покрытие ${quality.hrCoveragePct ?? "—"}%`);
  console.log(`темп: ${quality.hasPace}`);
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
