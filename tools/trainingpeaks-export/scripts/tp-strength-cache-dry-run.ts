/**
 * СУХОЙ прогон скана кэша с тренерскими силовыми (наряд 19.10, п.4) по одному атлету.
 *
 * Гоняет ТОТ ЖЕ scanOneStudent, что и боевой скан, но upsert и сверка подменены печатью:
 * в базу НЕ пишется ничего, база даже не читается (ученик — заглушка, нужен только athleteId).
 * В TP — только GET: лента tpapi /workouts и календарь сервиса силовых через getTpApiJsonRaw
 * (метода в нём нет). Флаг TP_SCAN_STRENGTH здесь не нужен — силовые включены всегда.
 *
 *   npx tsx scripts/tp-strength-cache-dry-run.ts --athlete-id=3102415 [--from=YYYY-MM-DD --to=YYYY-MM-DD] [--json]
 *
 * Окно по умолчанию — как у боевого раннера: сегодня −10 … +10 (Белград).
 */
import process from "node:process";

import type { TrainingPeaksWorkoutCacheUpsertRow } from "../../../src/features/trainingpeaks/repository.ts";
import { chunkDateRangeInclusive, getTpApiJsonRaw } from "../../../src/features/trainingpeaks/tp-api-client.ts";
import {
  belgradeTodayIso,
  extractStrengthCalendarItems,
  isStrengthServiceCacheRow,
  strengthCalendarPath,
} from "./lib/strength-cache-rows.ts";
import { scanOneStudent } from "./lib/workout-cache-scan-student.ts";

const TP_API_HOST = "https://tpapi.trainingpeaks.com";

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function arg(name: string): string | null {
  const hit = process.argv.slice(2).find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3).trim() : null;
}

async function main(): Promise<void> {
  const athleteId = Number(arg("athlete-id"));
  if (!Number.isInteger(athleteId) || athleteId <= 0) throw new Error("--athlete-id=N обязателен");
  const today = belgradeTodayIso();
  const from = arg("from") ?? addDays(today, -10);
  const to = arg("to") ?? addDays(today, 10);
  const asJson = process.argv.includes("--json");

  const upserts: TrainingPeaksWorkoutCacheUpsertRow[][] = [];
  let reconcileWouldRun = false;
  let strengthReturned: Record<string, unknown>[] = [];

  const summary = await scanOneStudent({
    upsertCacheFn: async (rows) => { upserts.push(rows); },
    reconcileFn: async () => { reconcileWouldRun = true; return 0; },
    fetchFn: async (endpoint) => {
      const { status, body } = await getTpApiJsonRaw("tpapi", endpoint.slice(TP_API_HOST.length));
      return { status, ok: status === 200, body };
    },
    target: { student: { id: "dry-run", studentName: "dry-run" } as never, athleteId, athleteUrl: "" },
    from,
    to,
    scannedAt: new Date().toISOString(),
    strength: {
      todayIso: today,
      fetchItems: async (id, rangeFrom, rangeTo) => {
        const items: Record<string, unknown>[] = [];
        for (const chunk of chunkDateRangeInclusive(rangeFrom, rangeTo)) {
          const { status, body } = await getTpApiJsonRaw("strength", strengthCalendarPath(id, chunk.start, chunk.end));
          if (status !== 200) throw new Error(`TrainingPeaks strength calendar GET failed: status=${status}`);
          const list = extractStrengthCalendarItems(body);
          if (!list) throw new Error("TrainingPeaks strength calendar GET returned non-array JSON body.");
          items.push(...list);
        }
        strengthReturned = items;
        return items;
      },
    },
  });

  const allRows = upserts.flat();
  const strengthRows = allRows.filter((row) => isStrengthServiceCacheRow(row));
  console.log(`[dry-run] athlete=${athleteId} window=${from}..${to} today=${today} — В БАЗУ НЕ ПИСАЛОСЬ`);
  console.log(`[dry-run] tpapi rows (would upsert): ${allRows.length - strengthRows.length}`);
  console.log(`[dry-run] strength service returned: ${strengthReturned.length}`);
  console.log(`[dry-run] strength summary: ${JSON.stringify(summary.strength)}`);
  console.log(`[dry-run] reconcile would run: ${reconcileWouldRun ? "yes" : "NO (strength failed)"}`);
  console.log(`[dry-run] incomplete days: ${JSON.stringify(summary.incompleteDays ?? [])}`);
  for (const item of strengthReturned) {
    console.log(
      `  · src id=${item.id} date=${item.prescribedDate} hidden=${item.isHidden} compliance=${item.complianceState} ` +
        `prescribed=${item.hasPrescribedData} sets=${item.totalSets} order=${item.orderOnDay} title=${JSON.stringify(item.title)}`,
    );
  }
  console.log("[dry-run] strength rows that WOULD be upserted:");
  for (const row of strengthRows) {
    console.log(asJson ? JSON.stringify(row) : `  → ${row.workout_date} id=${row.trainingpeaks_workout_id} type=${row.workout_type_value_id} planned=${row.is_planned} completed=${row.is_completed} order=${row.order_on_day} hidden=${(row.source_snapshot as Record<string, unknown>).isHidden} title=${JSON.stringify(row.title)}`);
  }
}

main().catch((error: unknown) => {
  console.error("tp-strength-cache-dry-run failed.");
  console.error(error);
  process.exit(1);
});
