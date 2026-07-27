/**
 * Правило тренера (2026-07-28): у худеющих дефицит НЕ применяется в дни большой работы
 * (long_run / long_endurance / hard). pre_long, rest, easy, strength, cross_training
 * дефицит СОХРАНЯЮТ. maintain и gain не затронуты вовсе.
 *
 * Плюс узкое следствие: у lose на pre_long углеводный finding подавляется, а тренеру
 * вместо него уходит заметка (coachNotesRu) — иначе система ругала бы за исполнение
 * собственного плана (предписывала ~190 г при коридоре 5-7 г/кг).
 *
 * Никаких сетевых вызовов и никакой live-генерации: только чистые формулы и фикстуры.
 */
import assert from "node:assert/strict";

import type { NutritionStudentContext } from "@/features/nutrition/context";
import { buildNutritionMethodologyContext } from "@/features/nutrition/methodology";
import {
  applyNutritionGoalToDayTarget,
  calculateNutritionDayTypeTarget,
  computeNutritionGoalDayTarget,
} from "@/features/nutrition/weekly-plan-formulas";

const BW = 65;
const SEX = "female" as const;
const HEIGHT = 162;
const AGE = 39;

function target(dayType: Parameters<typeof computeNutritionGoalDayTarget>[0]["dayType"], opts?: {
  goalType?: "lose" | "maintain" | "gain";
  raceWeekDeficitOff?: boolean;
  durationHours?: number | null;
  exerciseKcal?: number;
}) {
  return computeNutritionGoalDayTarget({
    goalType: opts?.goalType ?? "lose",
    dayType,
    bodyweightKg: BW,
    sex: SEX,
    heightCm: HEIGHT,
    ageYears: AGE,
    exerciseKcal: opts?.exerciseKcal ?? 600,
    durationHours: opts?.durationHours ?? 1.5,
    raceWeekDeficitOff: opts?.raceWeekDeficitOff ?? false,
  });
}

// ── 1. Дни большой работы: дефицита нет ────────────────────────────────────────────
// Проверяем инвариантом, а не磁 магическим числом: результат обязан совпасть с тем,
// что даёт явно выключенный дефицит (raceWeekDeficitOff) — это и есть «дефицит = 0».
for (const dayType of ["long_run", "long_endurance", "hard"] as const) {
  const normal = target(dayType);
  const deficitOff = target(dayType, { raceWeekDeficitOff: true });
  assert.ok(normal && deficitOff, `${dayType}: таргет не посчитался`);
  assert.equal(
    normal.target_kcal,
    deficitOff.target_kcal,
    `${dayType}: дефицит должен быть снят (получили ${normal.target_kcal}, без дефицита ${deficitOff.target_kcal})`
  );
  assert.equal(normal.carbs_g, deficitOff.carbs_g, `${dayType}: углеводы должны совпасть с бездефицитными`);
}

// ── 2. Дни, где дефицит ОСТАЁТСЯ ───────────────────────────────────────────────────
for (const dayType of ["pre_long", "rest", "easy", "strength", "cross_training"] as const) {
  const normal = target(dayType);
  const deficitOff = target(dayType, { raceWeekDeficitOff: true });
  assert.ok(normal && deficitOff, `${dayType}: таргет не посчитался`);
  assert.ok(
    normal.target_kcal < deficitOff.target_kcal,
    `${dayType}: дефицит обязан сохраниться (${normal.target_kcal} должно быть меньше ${deficitOff.target_kcal})`
  );
}

// ── 3. maintain не тронут: возвращается ровно ideal ────────────────────────────────
for (const dayType of ["long_run", "hard", "pre_long", "rest", "easy"] as const) {
  const ideal = calculateNutritionDayTypeTarget({ bodyweightKg: BW, dayType, durationHours: 1.5 });
  const maintain = target(dayType, { goalType: "maintain" });
  assert.deepEqual(maintain, ideal, `maintain/${dayType}: таргет обязан остаться ideal байт-в-байт`);
}

// ── 4. gain не тронут снятием дефицита (профицит считается от maintenance) ─────────
for (const dayType of ["long_run", "hard"] as const) {
  const gainNormal = target(dayType, { goalType: "gain" });
  const gainOff = target(dayType, { goalType: "gain", raceWeekDeficitOff: true });
  assert.ok(gainNormal && gainOff);
  assert.equal(gainNormal.target_kcal, gainOff.target_kcal, `gain/${dayType}: флаг дефицита не должен ни на что влиять`);
}

// ── 5. Гоночная неделя не сломана ──────────────────────────────────────────────────
// race сохраняет свой дефицит вне окна гонки и теряет его внутри окна.
const raceNormal = target("race");
const raceInWindow = target("race", { raceWeekDeficitOff: true });
assert.ok(raceNormal && raceInWindow);
assert.ok(
  raceNormal.target_kcal < raceInWindow.target_kcal,
  "race вне гоночного окна обязан сохранять дефицит (окно закрывает raceWeekDeficitOff)"
);

// ── 6. Рампа: снятие дефицита не должно пробивать потолок base+600 ─────────────────
// Регресс-сторож для наблюдения из разведки: у мало едящих рампа гасит эффект правки.
// Фиксируем ФАКТ (а не желаемое), чтобы изменение поведения было заметно.
const ideal = calculateNutritionDayTypeTarget({ bodyweightKg: BW, dayType: "long_run", durationHours: 1.5 });
const ramped = applyNutritionGoalToDayTarget(ideal, {
  goalType: "lose",
  dayType: "long_run",
  bodyweightKg: BW,
  maintenanceKcal: 2600,
  exerciseKcal: 600,
  sex: SEX,
  actualBaseKcal: 1500,
});
assert.ok(ramped);
assert.ok(
  ramped.target_kcal <= 1500 + 600,
  `рампа обязана ограничивать таргет потолком base+600 (получили ${ramped.target_kcal})`
);

// ── 7. pre_long у lose: finding подавлен, заметка тренеру есть ─────────────────────
function buildContext(goalType: "lose" | "maintain"): NutritionStudentContext {
  return {
    studentName: "Fixture",
    studentSlug: "fixture",
    studentUuid: "fixture-uuid",
    resolvedCommunicationProfile: {
      formality: "ty",
      formalitySource: "manual",
      tone: "neutral",
      preferredGreeting: null,
      notes: null,
      conflictFlags: [],
    },
    communicationProfilePromptLines: [],
    telegramContextNotes: "female",
    coachMemoryItems: [],
    nutritionContextItems: [],
    weightLogs: [],
    currentWeightKg: BW,
    nutritionGoal: null,
    nutritionGoalType: goalType,
    sex: SEX,
    heightCm: HEIGHT,
    ageYears: AGE,
    coachContextRu: null,
    athleteReportSignals: [],
    // Суббота (06.06) — pre_long перед длительной 07.06, углеводы 267 г = 4.11 г/кг:
    // ровно случай Старостиной из разведки (ниже порога low 4.5 г/кг).
    manualMacroRows: [
      { day: "2026-06-01", weekday: "пн", kcal: 2300, proteinG: 99, fatG: 97, carbsG: 263, confidence: 1, notes: null },
      { day: "2026-06-02", weekday: "вт", kcal: 2465, proteinG: 134, fatG: 101, carbsG: 277, confidence: 1, notes: null },
      { day: "2026-06-03", weekday: "ср", kcal: 2022, proteinG: 115, fatG: 116, carbsG: 136, confidence: 1, notes: null },
      { day: "2026-06-04", weekday: "чт", kcal: 2179, proteinG: 130, fatG: 83, carbsG: 246, confidence: 1, notes: null },
      { day: "2026-06-05", weekday: "пт", kcal: 2400, proteinG: 142, fatG: 89, carbsG: 281, confidence: 1, notes: null },
      { day: "2026-06-06", weekday: "сб", kcal: 2099, proteinG: 122, fatG: 65, carbsG: 267, confidence: 1, notes: null },
      { day: "2026-06-07", weekday: "вс", kcal: 2438, proteinG: 117, fatG: 64, carbsG: 367, confidence: 1, notes: null },
    ],
    dataQuality: {
      parsedDays: 7,
      lowConfidenceDays: 0,
      hasResolvedDates: true,
      unrealisticRows: 0,
      duplicateDays: [],
      qualityFlags: [],
    },
    reportStatus: "ready_for_analysis",
    tpPastWeek: {
      periodFrom: "2026-06-01",
      periodTo: "2026-06-07",
      cacheStatus: "ok",
      cacheStatusNote: "ok",
      totalSessions: 3,
      plannedSessions: 3,
      completedSessions: 3,
      runningSessions: 3,
      longRun: { date: "2026-06-07", title: "Длительная 17 км", durationHours: 2, distanceKm: 17 },
      keyWorkouts: [
        { date: "2026-06-02", title: "Интервалы 6×6 мин", type: "run", confidence: "high" },
        { date: "2026-06-07", title: "Длительная 17 км", type: "run", confidence: "high" },
      ],
      workouts: [
        {
          date: "2026-06-02",
          title: "Интервалы 6×6 мин",
          status: "completed",
          type: "run",
          description: null,
          coachComments: null,
          plannedText: null,
        },
        {
          date: "2026-06-07",
          title: "Длительная 17 км",
          status: "completed",
          type: "run",
          description: null,
          coachComments: null,
          plannedText: null,
        },
      ],
    },
    tpNextWeek: {
      periodFrom: "2026-06-08",
      periodTo: "2026-06-14",
      cacheStatus: "ok",
      cacheStatusNote: "ok",
      totalSessions: 0,
      plannedSessions: 0,
      completedSessions: 0,
      runningSessions: 0,
      longRun: null,
      keyWorkouts: [],
      workouts: [],
    },
  } as unknown as NutritionStudentContext;
}

const loseDays = buildNutritionMethodologyContext({ context: buildContext("lose") }).dailyAnalysis;
const maintainDays = buildNutritionMethodologyContext({ context: buildContext("maintain") }).dailyAnalysis;

const losePreLong = loseDays.find((day) => day.date === "2026-06-06");
const maintainPreLong = maintainDays.find((day) => day.date === "2026-06-06");
assert.ok(losePreLong && maintainPreLong, "pre_long день фикстуры не найден");

assert.equal(
  losePreLong.canonicalDailyAnalysis.trainingType,
  "pre_long",
  "фикстура обязана давать pre_long — иначе тест проверяет не то"
);
// Проверяем ИМЕННО углеводный сигнал через findings, а не через статус: статус —
// приоритетная цепочка, и его может занять более важный сигнал (в этой фикстуре —
// below_energy_availability). Тогда notEqual по статусу прошёл бы вхолостую, а код
// finding'а продолжал бы утекать к ученице. Ровно это тест и поймал при первом прогоне.
assert.ok(
  !losePreLong.canonicalDailyAnalysis.findings.includes("low_carbs_for_load_type"),
  "lose/pre_long: углеводный finding обязан быть подавлен"
);
assert.notEqual(
  losePreLong.canonicalDailyAnalysis.nutritionStatus,
  "pre_long_low",
  "lose/pre_long: статус pre_long_low должен быть подавлен"
);
assert.ok(
  losePreLong.coachNotesRu.length > 0,
  "lose/pre_long: подавили finding — обязаны оставить заметку тренеру"
);
assert.match(
  losePreLong.coachNotesRu[0],
  /перед длительной/i,
  "заметка тренеру должна называть день перед длительной"
);
assert.match(losePreLong.coachNotesRu[0], /267/, "заметка тренеру должна показывать фактические углеводы");

// maintain — поведение прежнее: углеводный сигнал на месте, заметки нет.
assert.ok(
  maintainPreLong.canonicalDailyAnalysis.findings.includes("low_carbs_for_load_type"),
  "maintain/pre_long: углеводный finding обязан остаться как был"
);
assert.equal(maintainPreLong.coachNotesRu.length, 0, "maintain/pre_long: заметка тренеру не нужна");

// ── 8. Прочие дни у lose сигналы НЕ теряют ────────────────────────────────────────
const loseMidweekLowCarb = loseDays.find((day) => day.date === "2026-06-03");
assert.ok(loseMidweekLowCarb, "день 03.06 фикстуры не найден");
assert.equal(
  loseMidweekLowCarb.coachNotesRu.length,
  0,
  "подавление обязано быть узким: только pre_long, прочие дни без заметок"
);

console.log("PASS check-nutrition-load-day-no-deficit");
