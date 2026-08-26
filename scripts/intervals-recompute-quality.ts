/**
 * Пересчитать уровень качества данных по УЖЕ СОХРАНЁННЫМ рядам.
 *
 * Зачем отдельный скрипт: правило «что считать пульсом» будет меняться — порог
 * покрытия, обработка провалов, новые виды спорта. Перекачивать ради этого
 * историю у провайдера незачем и нечестно по отношению к его серверу: ряды уже
 * лежат в базе, и пересчёт — это чистая функция от них.
 *
 * Именно это обещано комментарием в миграции 20260926000000: порог можно
 * сдвинуть пересчётом по базе, не трогая провайдера.
 *
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=.env.local scripts/intervals-recompute-quality.ts [--commit]
 *
 * По умолчанию ничего не пишет — только показывает, что изменилось бы.
 */
import process from "node:process";

import { assessDataQuality } from "@/features/intervals/data-quality";
import { createSupabaseServerClient, describeSupabaseError } from "@/features/supabase/server";
import { fetchAllRows } from "@/features/supabase/paginate";

const COMMIT = process.argv.includes("--commit");

// Страница маленькая НАМЕРЕННО: в каждой строке лежат три посекундных ряда,
// и страница в 1000 строк — это десятки мегабайт в одном ответе.
const PAGE = 50;

type StreamRow = {
  activity_id: string;
  time_s: number[];
  heartrate: (number | null)[] | null;
  velocity_smooth: (number | null)[] | null;
};

/** Перцентиль по возрастающе отсортированному массиву, линейной интерполяцией. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  if (sorted.length === 1) return sorted[0];
  const position = ((sorted.length - 1) * p) / 100;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

type ActivityRow = {
  activity_id: string;
  data_level: string;
  has_heartrate: boolean;
  has_pace: boolean;
  hr_coverage_pct: number | null;
};

async function main(): Promise<void> {
  const supabase = createSupabaseServerClient();

  // Обе выборки — через пагинацию: серверный порог 1000 строк не поднимается
  // параметром limit, и наивное чтение молча потеряло бы хвост.
  const activities = await fetchAllRows<ActivityRow>(
    (from, to) =>
      supabase
        .from("intervals_activities")
        .select("activity_id, data_level, has_heartrate, has_pace, hr_coverage_pct")
        .order("activity_id")
        .range(from, to),
    { label: "activities" }
  );
  const stored = new Map(activities.map((row) => [row.activity_id, row]));
  console.log(`активностей в базе: ${activities.length}`);

  const streams = await fetchAllRows<StreamRow>(
    (from, to) =>
      supabase
        .from("intervals_activity_streams")
        .select("activity_id, time_s, heartrate, velocity_smooth")
        .order("activity_id")
        .range(from, to),
    { label: "streams", pageSize: PAGE }
  );
  console.log(`рядов в базе: ${streams.length}`);

  const changes: { activityId: string; before: string; after: string }[] = [];
  // Переходы «было → стало». Счётчик изменений сам по себе не отвечает на
  // главный вопрос — что именно уехало и куда.
  const transitions = new Map<string, number>();
  // Покрытие пульса у тех, кто ОСТАЛСЯ heartrate. Медиана здесь важнее
  // среднего и важнее счётчика: если у половины «пульсовых» тренировок
  // покрытие около порога, значит порог слишком мягкий и генератор будет
  // рассуждать об интенсивности на половинных данных.
  const coverageOfHeartrate: number[] = [];

  for (const row of streams) {
    const quality = assessDataQuality({
      time: row.time_s,
      heartrate: row.heartrate,
      velocitySmooth: row.velocity_smooth,
    });
    const before = stored.get(row.activity_id);
    if (!before) continue;

    if (quality.dataLevel === "heartrate" && quality.hrCoveragePct !== null) {
      coverageOfHeartrate.push(quality.hrCoveragePct);
    }
    if (before.data_level !== quality.dataLevel) {
      const key = `${before.data_level} → ${quality.dataLevel}`;
      transitions.set(key, (transitions.get(key) ?? 0) + 1);
    }

    const sameLevel = before.data_level === quality.dataLevel;
    const sameHr = before.has_heartrate === quality.hasHeartrate;
    const samePace = before.has_pace === quality.hasPace;
    const sameCoverage =
      (before.hr_coverage_pct === null && quality.hrCoveragePct === null) ||
      Number(before.hr_coverage_pct) === Number(quality.hrCoveragePct);
    if (sameLevel && sameHr && samePace && sameCoverage) continue;

    changes.push({
      activityId: row.activity_id,
      before: `${before.data_level}, покрытие ${before.hr_coverage_pct ?? "—"}%`,
      after: `${quality.dataLevel}, покрытие ${quality.hrCoveragePct ?? "—"}%`,
    });

    if (COMMIT) {
      const { error } = await supabase
        .from("intervals_activities")
        .update({
          data_level: quality.dataLevel,
          has_heartrate: quality.hasHeartrate,
          has_pace: quality.hasPace,
          hr_coverage_pct: quality.hrCoveragePct,
        })
        .eq("activity_id", row.activity_id);
      if (error) {
        throw new Error(
          `Не удалось обновить ${row.activity_id}: ${describeSupabaseError(error)}`
        );
      }
    }
  }

  console.log("");
  console.log(`расходится с сохранённым: ${changes.length}`);
  for (const change of changes.slice(0, 40)) {
    console.log(`  ${change.activityId}: ${change.before} → ${change.after}`);
  }
  if (changes.length > 40) console.log(`  …и ещё ${changes.length - 40}`);

  console.log("");
  console.log("── Переходы уровня ──────────────────────────");
  if (transitions.size === 0) {
    console.log("  ни одна тренировка не сменила уровень");
  } else {
    for (const [key, count] of [...transitions].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${key.padEnd(26)} ${count}`);
    }
  }

  console.log("");
  console.log("── Покрытие пульса у оставшихся heartrate ───");
  if (coverageOfHeartrate.length === 0) {
    console.log("  таких тренировок нет");
  } else {
    const sorted = [...coverageOfHeartrate].sort((a, b) => a - b);
    console.log(`  тренировок:  ${sorted.length}`);
    console.log(`  минимум:     ${percentile(sorted, 0).toFixed(1)}%`);
    console.log(`  10-й проц.:  ${percentile(sorted, 10).toFixed(1)}%`);
    console.log(`  25-й проц.:  ${percentile(sorted, 25).toFixed(1)}%`);
    console.log(`  МЕДИАНА:     ${percentile(sorted, 50).toFixed(1)}%`);
    console.log(`  75-й проц.:  ${percentile(sorted, 75).toFixed(1)}%`);
    const nearThreshold = sorted.filter((value) => value < 60).length;
    console.log(`  ниже 60%:    ${nearThreshold} — это те, кого держит только мягкость порога`);
  }

  console.log("");
  console.log(COMMIT ? "Изменения записаны." : "Ничего не записано (запуск без --commit).");
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
