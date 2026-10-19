import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { TrainingPeaksWorkoutCacheRow } from "@/features/trainingpeaks/repository";

const root = process.cwd();
const contextPath = join(root, "src/features/nutrition/context.ts");
const repositoryPath = join(root, "src/features/trainingpeaks/repository.ts");
// Renamed in 362e512 when the scan window became parameterised (run-workout-cache-scan-yesterday.sh
// → run-workout-cache-scan.sh). The check kept reading the old path and died on ENOENT, so it has
// been asserting nothing at all since 8 июля.
const scanScriptPath = join(root, "tools/trainingpeaks-export/scripts/run-workout-cache-scan.sh");
const scanTsPath = join(root, "tools/trainingpeaks-export/scripts/tp-workouts-cache-scan.ts");

const contextSource = readFileSync(contextPath, "utf8");
const repositorySource = readFileSync(repositoryPath, "utf8");
const scanScriptSource = readFileSync(scanScriptPath, "utf8");
const scanTsSource = readFileSync(scanTsPath, "utf8");

assert.match(repositorySource, /\.gte\("workout_date", input\.from\)/, "cache query must use inclusive from date");
assert.match(repositorySource, /\.lte\("workout_date", input\.to\)/, "cache query must use inclusive to date");
assert.doesNotMatch(
  contextSource,
  /rows\s*=\s*rows\.filter\(\(row\) => row\.isCompleted\)/,
  "nutrition TP week context must not reduce cache rows to completed-only"
);
assert.match(contextSource, /for \(const row of rows\)/, "nutrition TP week context must iterate all cache rows");
// weekTo+1..weekTo+8 since e09e942: the plan week runs Mon→next Mon (8 days, bridge Monday), and
// the saved next-week context has to span all 8 plan days. That commit updated
// check-nutrition-plan-week-policy but not this file — nobody noticed, because this check was
// already dying on the ENOENT above and never reached the assertion.
assert.match(
  contextSource,
  /addDays\(input\.weekTo, 1\)[\s\S]*addDays\(input\.weekTo, 8\)/,
  "next-week nutrition window must be weekTo+1..weekTo+8 (Mon→next Mon, bridge day included)"
);
// The window is parameterised now (FUTURE_DAYS), so pin the REQUIREMENT — the scan must reach far
// enough ahead to cache next week's workouts, which is what the nutrition plan reads — instead of
// the literal `date -v+7d` it used to be written as. A rename of the variable must not be able to
// silence this again.
const futureWindowDays = Number(scanScriptSource.match(/FUTURE_DAYS:-(\d+)/)?.[1] ?? 0);
assert.ok(
  futureWindowDays >= 7,
  `daily cache scan must reach at least 7 days ahead so next week's workouts are cached (default window is ${futureWindowDays} days)`
);
assert.match(scanScriptSource, /date -v\+"\$\{FUTURE_DAYS\}"d/, "the future window must actually be applied to the end date");
assert.match(scanScriptSource, /--from="\$\{FROM\}" --to="\$\{TO\}"/, "daily cache scan must pass an explicit date range");
/**
 * TP-SAFETY: the workout cache scan is READ-ONLY against TrainingPeaks.
 *
 * ЧТО БЫЛО И ПОЧЕМУ ПЕРЕПИСАНО (2026-10-19, наряд «силовые в кэш»). Прежний guard требовал, чтобы
 * каждый запрос в TP шёл через performApiJsonRequest({ method: "GET" }) — помощник Playwright-пути.
 * Скан давно ушёл на fetch-клиент (наряд ЭТАП 2: tp-api-client, getTpApiJsonRaw), performApiJsonRequest
 * в нём не осталось, и чек стоял КРАСНЫМ на main, то есть не сторожил ничего. А теперь скан ходит
 * ещё и во второй хост TP — сервис силовых (api.peakswaresb.com), — так что сторож нужен как никогда.
 *
 * Инвариант тот же, проверка — под нынешний путь и СТРОЖЕ прежней:
 *  1. из tp-api-client скан импортирует ТОЛЬКО белый список: getTpApiJsonRaw (метода в сигнатуре
 *     нет — это GET и только GET), нарезку дат и классы ошибок. Любая пишущая функция клиента
 *     (createWorkout, updateWorkout, moveWorkout, deleteWorkout, createStrengthWorkout, createEvent,
 *     createNote, createAvailability, createStrengthExercise, …) в импорте — красный;
 *  2. сам getTpApiJsonRaw в клиенте жёстко зашит на { method: "GET" } и не принимает метод;
 *  3. вынесенные модули скана (тело по ученику, строки силовых) не ходят в сеть вовсе — не
 *     импортируют клиент и не зовут fetch;
 *  4. сырой fetch в скане — только в api.telegram.org (алерт тренеру); ни к одному хосту TP
 *     (trainingpeaks / peakswaresb) напрямую.
 */
const tpApiClientSource = readFileSync(join(root, "src/features/trainingpeaks/tp-api-client.ts"), "utf8");
const scanLibSources = [
  "tools/trainingpeaks-export/scripts/lib/workout-cache-scan-student.ts",
  "tools/trainingpeaks-export/scripts/lib/strength-cache-rows.ts",
].map((relativePath) => ({ relativePath, source: readFileSync(join(root, relativePath), "utf8") }));

const SCAN_ALLOWED_TP_CLIENT_IMPORTS = new Set(["chunkDateRangeInclusive", "getTpApiJsonRaw", "TpApiAuthError", "TpApiHttpError"]);

function assertScanNeverMutatesTrainingPeaks(source: string): void {
  const clientImports = [...source.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*"[^"]*tp-api-client(?:\.ts)?"/g)];
  assert.ok(clientImports.length > 0, "the scan must reach TrainingPeaks through tp-api-client");
  for (const [, names] of clientImports) {
    for (const name of names.split(",").map((part) => part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]!).filter(Boolean)) {
      assert.ok(
        SCAN_ALLOWED_TP_CLIENT_IMPORTS.has(name),
        `workout cache scan must not mutate TP workouts: it imports "${name}" from tp-api-client (allowed: GET-only getTpApiJsonRaw + helpers)`
      );
    }
  }
  assert.doesNotMatch(source, /import\s*\*\s*as\s+\w+\s+from\s*"[^"]*tp-api-client/, "workout cache scan must not mutate TP workouts: namespace import of tp-api-client hides what is used");
  for (const [, target] of source.matchAll(/fetch\(\s*([`"'][^`"']*)/g)) {
    assert.match(target, /api\.telegram\.org/, "TrainingPeaks must be reached only through the audited request helper, never a raw fetch");
  }
  assert.doesNotMatch(
    source,
    /fetch\(\s*[`"'][^`"']*(?:trainingpeaks|peakswaresb)/i,
    "TrainingPeaks must be reached only through the audited request helper, never a raw fetch"
  );
}

assertScanNeverMutatesTrainingPeaks(scanTsSource);

// getTpApiJsonRaw: без параметра метода и с зашитым GET.
const rawGetFn = tpApiClientSource.match(/export async function getTpApiJsonRaw\(([\s\S]*?)\)[^{]*\{([\s\S]*?)\n\}/);
assert.ok(rawGetFn, "tp-api-client must export getTpApiJsonRaw");
assert.doesNotMatch(rawGetFn![1]!, /method/i, "getTpApiJsonRaw must not accept a method");
assert.match(rawGetFn![2]!, /\{\s*method:\s*"GET"\s*\}/, "getTpApiJsonRaw must be hard-wired to GET");

for (const { relativePath, source } of scanLibSources) {
  assert.doesNotMatch(source, /from\s*"[^"]*tp-api-client/, `${relativePath} must not talk to TP itself (no tp-api-client import)`);
  assert.doesNotMatch(source, /\bfetch\(/, `${relativePath} must not do network I/O of its own`);
}

// Positive controls — the guard must still catch a real TP mutation, by every route. Without these,
// someone could loosen it again and the check would stay green while the invariant died, which is
// exactly how it got here (twice).
assert.throws(
  () =>
    assertScanNeverMutatesTrainingPeaks(
      `${scanTsSource}\nimport { deleteWorkout } from "../../../src/features/trainingpeaks/tp-api-client.ts";\n`
    ),
  /must not mutate TP workouts/,
  "guard must still catch a write function imported from the client"
);
assert.throws(
  () =>
    assertScanNeverMutatesTrainingPeaks(
      `${scanTsSource}\nimport { getTpApiJsonRaw, createStrengthWorkout as save } from "../../../src/features/trainingpeaks/tp-api-client.ts";\n`
    ),
  /must not mutate TP workouts/,
  "guard must still catch an aliased write import"
);
assert.throws(
  () =>
    assertScanNeverMutatesTrainingPeaks(
      `${scanTsSource}\nawait fetch("https://tpapi.trainingpeaks.com/fitness/v6/workouts", { method: "DELETE" })\n`
    ),
  /only through the audited request helper/,
  "guard must still catch a raw mutating fetch straight at a TP host"
);
assert.throws(
  () =>
    assertScanNeverMutatesTrainingPeaks(
      scanTsSource + "\nawait fetch(`https://api.peakswaresb.com/rx/activity/v1/workouts/${id}`, { method: \"DELETE\" })\n"
    ),
  /only through the audited request helper/,
  "guard must still catch a raw fetch at the strength host"
);

function buildPlannedFutureRow(input: {
  date: string;
  title: string;
  plannedHours?: number;
}): TrainingPeaksWorkoutCacheRow {
  const scannedAt = new Date().toISOString();
  return {
    id: `fixture-${input.date}`,
    studentId: "student-fixture",
    studentName: "Fixture Athlete",
    trainingPeaksAthleteId: 123456,
    trainingPeaksWorkoutId: Number(input.date.replace(/-/g, "")),
    workoutDate: input.date,
    title: input.title,
    sportOrTypeCode: "run",
    workoutTypeValueId: 1,
    workoutSubTypeId: null,
    isPlanned: true,
    isCompleted: false,
    plannedTimeRaw: input.plannedHours ?? 1.5,
    completedTimeRaw: null,
    plannedDistanceRaw: null,
    completedDistanceRaw: null,
    complianceDurationPercent: null,
    complianceDistancePercent: null,
    startTimePlanned: null,
    startTime: null,
    sourceUpdatedAt: null,
    orderOnDay: null,
    scannedAt,
    scanJobId: null,
    normalizationWarnings: [],
    sourceSnapshot: {},
    createdAt: scannedAt,
    updatedAt: scannedAt,
  };
}

const fixtureRows = [
  buildPlannedFutureRow({ date: "2026-06-08", title: "Бег по пульсу" }),
  buildPlannedFutureRow({ date: "2026-06-10", title: "7 х 5 мин" }),
  buildPlannedFutureRow({ date: "2026-06-14", title: "Длительный бег 18 км", plannedHours: 1.8 }),
];

const inRange = fixtureRows.filter((row) => row.workoutDate >= "2026-06-08" && row.workoutDate <= "2026-06-14");
assert.equal(inRange.length, 3, "inclusive date range must include boundary days");
assert.equal(
  inRange.filter((row) => row.isPlanned && !row.isCompleted).length,
  3,
  "planned-only future rows must remain eligible for nutrition context"
);

const plannedSessions = inRange.filter((row) => row.isPlanned).length;
assert.equal(plannedSessions, 3, "plannedSessions counter contract must see all planned future rows");

const keyTitles = inRange.filter((row) => /интерв|х\s*\d|длитель|long run/i.test(row.title ?? ""));
assert.ok(keyTitles.length >= 2, "fixture must include classifiable key/long workouts for planned rows");

console.log("PASS check-nutrition-tp-future-workout-context");
