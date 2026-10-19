/**
 * Проверка: тренерские силовые в кэше (наряд 19.10, п.4). Без сети и без базы — подставные
 * ответы сервиса силовых, подставной upsert и модель сверки (plannedCacheRowIsStale — тот же
 * предикат, что у RPC reconcile_trainingpeaks_workout_cache_planned_rows).
 *
 * Что держит:
 *  1. фильтр «тренерская vs файл с часов»;
 *  2. маппинг сводки в строку кэша (тип 9, план, не выполнена, без времени/дистанции, источник);
 *  3. отсутствие коллизий id с tpapi;
 *  4. БЕЗ флага скан ведёт себя как до наряда (ни запроса к силовым, ни строки, ни ключа в итоге);
 *  5. сверка не удаляет живые силовые и не трогается ими; при сбое силовых сверка пропускается.
 *
 * Запуск: npm --prefix tools/trainingpeaks-export run check:strength-cache-scan
 */
import assert from "node:assert/strict";

import type { TrainingPeaksWorkoutCacheUpsertRow } from "../../../src/features/trainingpeaks/repository.ts";
import { plannedCacheRowIsStale } from "../../../src/features/trainingpeaks/workout-cache-reconcile.ts";
import {
  buildStrengthCacheRows,
  extractStrengthCalendarItems,
  isCoachPrescribedStrength,
  isStrengthScanEnabled,
  isStrengthServiceCacheRow,
  STRENGTH_CACHE_SOURCE,
} from "./lib/strength-cache-rows.ts";
import { scanOneStudent, type StrengthScanInput } from "./lib/workout-cache-scan-student.ts";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

// ─── фикстуры ────────────────────────────────────────────────────────────────

const ATHLETE = 3102415;
const STUDENT = { id: "00000000-0000-4000-8000-000000000001", studentName: "Тест Атлет" };
const FROM = "2026-10-09";
const TO = "2026-10-29";
const TODAY = "2026-10-19";
const SCANNED_AT = "2026-10-19T10:00:00.000Z";

/** Сводка календаря сервиса силовых — форма снята живьём 19.10 (тестовый атлет). */
function coachStrength(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "35367145", calendarId: ATHLETE, title: "Силовая круговая — основная", workoutType: "StructuredStrength",
    prescribedDate: "2026-10-21", prescribedStartTime: null, orderOnDay: null, isHidden: false, isLocked: false,
    hasPrescribedData: true, hasFileData: false, complianceState: "NoCompletion", compliancePercent: 0,
    totalBlocks: 1, totalPrescriptions: 7, totalSets: 21, completedSets: 0,
    prescribedDurationInSeconds: null, executedDurationInSeconds: null, completedDateTime: null,
    lastUpdatedAt: "2026-10-19T14:11:07", instructions: "Начинай с более слабой ноги",
    sequenceSummary: [{ sequenceOrder: "A", title: "Круг", compliancePercent: 0, complianceState: "NoCompletion" }],
    ...over,
  };
}

/** Файл с часов, который сервис силовых тоже листает (разведка 18.10: 331 таких). */
function watchFile(over: Record<string, unknown> = {}): Record<string, unknown> {
  return coachStrength({
    id: "35100001", title: "Strength", hasPrescribedData: false, hasFileData: true, complianceState: "Unplanned",
    totalBlocks: 0, totalPrescriptions: 0, totalSets: 0, sequenceSummary: [], prescribedDate: "2026-10-22",
    ...over,
  });
}

function tpapiRun(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    workoutId: 4012345678, athleteId: ATHLETE, workoutDay: "2026-10-21T00:00:00", title: "Лёгкий бег",
    workoutTypeValueId: 3, totalTimePlanned: 0.75, distancePlanned: 8000, orderOnDay: 2,
    lastModifiedDate: "2026-10-18T09:00:00", structure: null, ...over,
  };
}

type Call = { kind: "fetch"; endpoint: string } | { kind: "strength"; args: unknown[] } | { kind: "upsert"; rows: TrainingPeaksWorkoutCacheUpsertRow[] } | { kind: "reconcile"; input: unknown };

function harness(opts: {
  tpapiBody: unknown[];
  strength?: { items?: Record<string, unknown>[]; throws?: string };
  upsertThrowsOnStrength?: boolean;
}) {
  const calls: Call[] = [];
  const strength: StrengthScanInput | undefined = opts.strength
    ? {
      todayIso: TODAY,
      fetchItems: async (...args) => {
        calls.push({ kind: "strength", args });
        if (opts.strength!.throws) throw new Error(opts.strength!.throws);
        return opts.strength!.items ?? [];
      },
    }
    : undefined;
  const run = () => scanOneStudent({
    upsertCacheFn: async (rows) => {
      calls.push({ kind: "upsert", rows });
      if (opts.upsertThrowsOnStrength && rows.some((row) => isStrengthServiceCacheRow(row))) throw new Error("db down");
    },
    reconcileFn: async (input) => { calls.push({ kind: "reconcile", input }); return 0; },
    fetchFn: async (endpoint) => { calls.push({ kind: "fetch", endpoint }); return { status: 200, ok: true, body: opts.tpapiBody }; },
    target: { student: STUDENT as never, athleteId: ATHLETE, athleteUrl: "" },
    from: FROM, to: TO, scannedAt: SCANNED_AT, strength,
  });
  return { calls, run };
}

// ─── 1. фильтр ───────────────────────────────────────────────────────────────

await test("тренерская: hasPrescribedData=true", () => assert.equal(isCoachPrescribedStrength(coachStrength()), true));
await test("файл с часов (Unplanned, без подходов) — не тренерская", () => assert.equal(isCoachPrescribedStrength(watchFile()), false));
await test("тренерская с пустыми значениями (hasPrescribedData=false, но подходы есть) — тренерская", () =>
  assert.equal(isCoachPrescribedStrength(coachStrength({ hasPrescribedData: false })), true));
await test("Unplanned с подходами (файл, размеченный атлетом) — не тренерская", () =>
  assert.equal(isCoachPrescribedStrength(watchFile({ totalSets: 3 })), false));
await test("тело календаря: массив и {data:[…]}; прочее — null", () => {
  assert.equal(extractStrengthCalendarItems([coachStrength(), 5])?.length, 1);
  assert.equal(extractStrengthCalendarItems({ data: [coachStrength()] })?.length, 1);
  assert.equal(extractStrengthCalendarItems({ errors: {} }), null);
});
await test("флаг: только ровно \"1\" включает", () => {
  assert.equal(isStrengthScanEnabled({}), false);
  assert.equal(isStrengthScanEnabled({ TP_SCAN_STRENGTH: "0" }), false);
  assert.equal(isStrengthScanEnabled({ TP_SCAN_STRENGTH: "true" }), false);
  assert.equal(isStrengthScanEnabled({ TP_SCAN_STRENGTH: " 1 " }), true);
});

// ─── 2–3. маппинг и id ───────────────────────────────────────────────────────

const build = (items: Record<string, unknown>[], tpapiIds: number[] = []) => buildStrengthCacheRows({
  items, student: STUDENT, athleteId: ATHLETE, from: FROM, to: TO, todayIso: TODAY, scannedAt: SCANNED_AT,
  tpapiWorkoutIds: new Set(tpapiIds),
});

await test("маппинг: строка кэша тренерской силовой", () => {
  const { rows, counts } = build([coachStrength({ orderOnDay: 1 })]);
  assert.equal(rows.length, 1);
  assert.equal(counts.rows, 1);
  const row = rows[0]!;
  assert.deepEqual(
    { ...row, source_snapshot: undefined },
    {
      student_id: STUDENT.id, student_name: STUDENT.studentName, trainingpeaks_athlete_id: ATHLETE,
      trainingpeaks_workout_id: 35367145, workout_date: "2026-10-21", title: "Силовая круговая — основная",
      sport_or_type_code: null, workout_type_value_id: 9, workout_sub_type_id: null,
      is_planned: true, is_completed: false,
      planned_time_raw: null, completed_time_raw: null, planned_distance_raw: null, completed_distance_raw: null,
      compliance_duration_percent: null, compliance_distance_percent: null,
      start_time_planned: null, start_time: null, source_updated_at: null, order_on_day: 1,
      scanned_at: SCANNED_AT, normalization_warnings: [], source_snapshot: undefined,
    },
  );
  const snap = row.source_snapshot as Record<string, unknown>;
  assert.equal(snap.source, STRENGTH_CACHE_SOURCE);
  assert.equal(snap.strengthWorkoutId, "35367145");
  assert.equal(snap.complianceState, "NoCompletion");
  assert.equal(snap.totalSets, 21);
  // структуры бега нет — потребители, читающие source_snapshot.structure / tssPlanned, видят «нет»
  assert.equal("structure" in snap, false);
  assert.equal("tssPlanned" in snap, false);
  assert.equal(isStrengthServiceCacheRow(row), true);
});

await test("выполненная тренерская всё равно is_completed=false (выполнение — в снимке)", () => {
  const { rows } = build([coachStrength({ complianceState: "Compliant", completedSets: 21, executedDurationInSeconds: 1800 })]);
  assert.equal(rows[0]!.is_completed, false);
  assert.equal(rows[0]!.completed_time_raw, null);
  assert.equal((rows[0]!.source_snapshot as Record<string, unknown>).complianceState, "Compliant");
});

await test("отсев: файл с часов, скрытая, прошлая, вне окна", () => {
  const { rows, counts } = build([
    coachStrength(),
    watchFile(),
    coachStrength({ id: "35409762", isHidden: true, prescribedDate: "2026-10-23" }),
    coachStrength({ id: "35300000", prescribedDate: "2026-10-18" }),
    coachStrength({ id: "35300001", prescribedDate: "2026-11-30" }),
    coachStrength({ id: "35300002", prescribedDate: null }),
  ]);
  assert.deepEqual(rows.map((row) => row.trainingpeaks_workout_id), [35367145]);
  assert.deepEqual(
    { watchFiles: counts.watchFiles, hidden: counts.hidden, past: counts.past, outOfWindow: counts.outOfWindow },
    { watchFiles: 1, hidden: 1, past: 1, outOfWindow: 2 },
  );
});

await test("сегодняшняя силовая берётся (граница «сегодня» включительно)", () => {
  assert.equal(build([coachStrength({ prescribedDate: TODAY })]).rows.length, 1);
});

await test("id: >= 1e9 (пространство tpapi), нечисловой, 0 — не пишутся", () => {
  const { rows, counts } = build([
    coachStrength({ id: "1000000000" }),
    coachStrength({ id: "4012345678" }),
    coachStrength({ id: "a1b2-uuid" }),
    coachStrength({ id: "0" }),
  ]);
  assert.equal(rows.length, 0);
  assert.equal(counts.badId, 4);
});

await test("id совпал с workoutId из ответа tpapi — не пишется (коллизия ключа кэша)", () => {
  const { rows, counts } = build([coachStrength({ id: "35367145" })], [35367145]);
  assert.equal(rows.length, 0);
  assert.equal(counts.idCollision, 1);
});

await test("дубль id в ответе — одна строка", () => {
  const { rows, counts } = build([coachStrength(), coachStrength()]);
  assert.equal(rows.length, 1);
  assert.equal(counts.duplicate, 1);
});

// ─── 4. без флага ────────────────────────────────────────────────────────────

const TPAPI_BODY = [tpapiRun(), tpapiRun({ workoutId: 4012345679, workoutDay: "2026-10-23T00:00:00", orderOnDay: 1 })];

await test("БЕЗ флага: один GET в tpapi, один upsert только строк ленты, сверка, в итоге нет ключа strength", async () => {
  const { calls, run } = harness({ tpapiBody: TPAPI_BODY });
  const summary = await run();
  assert.deepEqual(calls.map((call) => call.kind), ["fetch", "upsert", "reconcile"]);
  const fetchCall = calls[0] as Extract<Call, { kind: "fetch" }>;
  assert.equal(fetchCall.endpoint, `https://tpapi.trainingpeaks.com/fitness/v6/athletes/${ATHLETE}/workouts/${FROM}/${TO}`);
  const upsert = calls[1] as Extract<Call, { kind: "upsert" }>;
  assert.deepEqual(upsert.rows.map((row) => row.trainingpeaks_workout_id), [4012345678, 4012345679]);
  assert.equal(upsert.rows.some((row) => isStrengthServiceCacheRow(row)), false);
  assert.equal("strength" in summary, false);
  assert.deepEqual(calls[2], { kind: "reconcile", input: { studentId: STUDENT.id, from: FROM, to: TO, runStartedAt: SCANNED_AT } });
});

await test("с флагом строки ленты — те же самые, что без флага (силовые не меняют ленту)", async () => {
  const off = harness({ tpapiBody: TPAPI_BODY });
  await off.run();
  const on = harness({ tpapiBody: TPAPI_BODY, strength: { items: [coachStrength({ prescribedDate: "2026-10-25" })] } });
  await on.run();
  const tpapiRowsOff = (off.calls.find((call) => call.kind === "upsert") as Extract<Call, { kind: "upsert" }>).rows;
  const tpapiRowsOn = (on.calls.find((call) => call.kind === "upsert") as Extract<Call, { kind: "upsert" }>).rows;
  assert.deepEqual(tpapiRowsOn, tpapiRowsOff);
});

// ─── 5. сверка ───────────────────────────────────────────────────────────────

await test("с флагом: GET силовых → upsert ленты → upsert силовых → сверка (сверка ПОСЛЕ записи силовых)", async () => {
  const { calls, run } = harness({ tpapiBody: TPAPI_BODY, strength: { items: [coachStrength(), watchFile()] } });
  const summary = await run();
  assert.deepEqual(calls.map((call) => call.kind), ["fetch", "strength", "upsert", "upsert", "reconcile"]);
  assert.deepEqual((calls[1] as Extract<Call, { kind: "strength" }>).args, [ATHLETE, FROM, TO]);
  const strengthRows = (calls[3] as Extract<Call, { kind: "upsert" }>).rows;
  assert.deepEqual(strengthRows.map((row) => row.trainingpeaks_workout_id), [35367145]);
  assert.equal(summary.status, "ok");
  assert.equal(summary.rows, 2, "rows/planned в итоге — по-прежнему только лента tpapi");
  assert.deepEqual(summary.strength && summary.strength.ok && summary.strength.counts.rows, 1);
});

/** Модель таблицы: upsert по (athlete, workout_id) + удаление по предикату RPC. */
function modelTable() {
  const table = new Map<string, TrainingPeaksWorkoutCacheUpsertRow>();
  return {
    table,
    upsert: async (rows: TrainingPeaksWorkoutCacheUpsertRow[]) => {
      for (const row of rows) table.set(`${row.trainingpeaks_athlete_id}:${row.trainingpeaks_workout_id}`, { ...row });
    },
    reconcile: async (win: { studentId: string; from: string; to: string; runStartedAt: string }) => {
      let deleted = 0;
      for (const [key, row] of table) {
        if (row.student_id !== win.studentId) continue;
        if (plannedCacheRowIsStale({ ...row, scanned_at: row.scanned_at! }, win)) { table.delete(key); deleted += 1; }
      }
      return deleted;
    },
  };
}

async function scanInto(db: ReturnType<typeof modelTable>, scannedAt: string, strength?: StrengthScanInput) {
  return scanOneStudent({
    upsertCacheFn: db.upsert, reconcileFn: db.reconcile,
    fetchFn: async () => ({ status: 200, ok: true, body: TPAPI_BODY }),
    target: { student: STUDENT as never, athleteId: ATHLETE, athleteUrl: "" },
    from: FROM, to: TO, scannedAt, strength,
  });
}
const strengthOf = (items: Record<string, unknown>[] | Error): StrengthScanInput => ({
  todayIso: TODAY,
  fetchItems: async () => { if (items instanceof Error) throw items; return items; },
});
const strengthIds = (db: ReturnType<typeof modelTable>) =>
  [...db.table.values()].filter((row) => isStrengthServiceCacheRow(row)).map((row) => row.trainingpeaks_workout_id).sort();

await test("сверка: живая силовая переживает следующий прогон; лента не страдает", async () => {
  const db = modelTable();
  await scanInto(db, "2026-10-19T10:00:00.000Z", strengthOf([coachStrength()]));
  const second = await scanInto(db, "2026-10-19T10:30:00.000Z", strengthOf([coachStrength()]));
  assert.deepEqual(strengthIds(db), [35367145]);
  assert.equal(second.reconciledDeleted, 0);
  assert.equal(db.table.size, 3);
});

await test("сверка: силовую сняли/скрыли в TP — строка удаляется, как фантом ленты", async () => {
  const db = modelTable();
  await scanInto(db, "2026-10-19T10:00:00.000Z", strengthOf([coachStrength()]));
  const second = await scanInto(db, "2026-10-19T10:30:00.000Z", strengthOf([coachStrength({ isHidden: true })]));
  assert.deepEqual(strengthIds(db), []);
  assert.equal(second.reconciledDeleted, 1);
});

await test("сверка: силовые НЕ прочитались — сверка пропущена, живая силовая на месте, ученик ok", async () => {
  const db = modelTable();
  await scanInto(db, "2026-10-19T10:00:00.000Z", strengthOf([coachStrength()]));
  const second = await scanInto(db, "2026-10-19T10:30:00.000Z", strengthOf(new Error("HTTP 503")));
  assert.deepEqual(strengthIds(db), [35367145]);
  assert.equal(second.status, "ok");
  assert.deepEqual(second.strength, { ok: false, error: "HTTP 503", reconcileSkipped: true });
});

await test("сверка: силовые НЕ записались — сверка пропущена, лента записана", async () => {
  const { calls, run } = harness({ tpapiBody: TPAPI_BODY, strength: { items: [coachStrength()] }, upsertThrowsOnStrength: true });
  const summary = await run();
  assert.deepEqual(calls.map((call) => call.kind), ["fetch", "strength", "upsert", "upsert"]);
  assert.equal(summary.status, "ok");
  assert.equal(summary.strength?.ok, false);
});

await test("сверка: флаг выключили — силовые окна уходят сами (не освежены → фантомы)", async () => {
  const db = modelTable();
  await scanInto(db, "2026-10-19T10:00:00.000Z", strengthOf([coachStrength()]));
  await scanInto(db, "2026-10-19T10:30:00.000Z");
  assert.deepEqual(strengthIds(db), []);
});

await test("сбой tpapi — силовые не запрашиваются и не пишутся", async () => {
  const calls: string[] = [];
  await assert.rejects(scanOneStudent({
    upsertCacheFn: async () => { calls.push("upsert"); },
    reconcileFn: async () => { calls.push("reconcile"); return 0; },
    fetchFn: async () => ({ status: 403, ok: false, body: null }),
    target: { student: STUDENT as never, athleteId: ATHLETE, athleteUrl: "" },
    from: FROM, to: TO, scannedAt: SCANNED_AT,
    strength: { todayIso: TODAY, fetchItems: async () => { calls.push("strength"); return [coachStrength()]; } },
  }));
  assert.deepEqual(calls, []);
});

// ─── дыры orderOnDay ─────────────────────────────────────────────────────────

await test("дыра orderOnDay, которую закрывает силовая, с флагом исчезает; без флага — как раньше", async () => {
  // В ленте 21.10 только #2 — #1 это силовая, которой в ленте нет (случай Елены 06.10).
  const off = await harness({ tpapiBody: TPAPI_BODY }).run();
  assert.deepEqual(off.incompleteDays, ["2026-10-21"]);
  const on = await harness({ tpapiBody: TPAPI_BODY, strength: { items: [coachStrength({ orderOnDay: 1 })] } }).run();
  assert.deepEqual(on.incompleteDays, []);
  // силовая без номера дыру не закрывает
  const noOrder = await harness({ tpapiBody: TPAPI_BODY, strength: { items: [coachStrength()] } }).run();
  assert.deepEqual(noOrder.incompleteDays, ["2026-10-21"]);
});

await test("прошлую и скрытую силовую не пишем, но дыру в нумерации они объясняют (живой случай 09.10)", async () => {
  const body = [tpapiRun({ workoutId: 4012345680, workoutDay: "2026-10-10T00:00:00", orderOnDay: 2 }), tpapiRun({ workoutId: 4012345681, workoutDay: "2026-10-25T00:00:00", orderOnDay: 2 })];
  const off = await harness({ tpapiBody: body }).run();
  assert.deepEqual(off.incompleteDays, ["2026-10-10", "2026-10-25"]);
  const { calls, run } = harness({
    tpapiBody: body,
    strength: { items: [
      coachStrength({ id: "35300010", prescribedDate: "2026-10-10", orderOnDay: 1 }),
      coachStrength({ id: "35300011", prescribedDate: "2026-10-25", orderOnDay: 1, isHidden: true }),
      watchFile({ id: "35300012", prescribedDate: "2026-10-25", orderOnDay: 1 }),
    ] },
  });
  const on = await run();
  assert.deepEqual(on.incompleteDays, []);
  assert.equal(calls.filter((call) => call.kind === "upsert").length, 1, "ни одной строки силовых — второго upsert нет");
  // файл с часов дыру НЕ закрывает (его номер — не про тренерскую силовую)
  const watchOnly = await harness({ tpapiBody: body, strength: { items: [watchFile({ prescribedDate: "2026-10-25", orderOnDay: 1 })] } }).run();
  assert.deepEqual(watchOnly.incompleteDays, ["2026-10-10", "2026-10-25"]);
});

console.log(`[check-strength-cache-scan] PASS (${passed})`);
