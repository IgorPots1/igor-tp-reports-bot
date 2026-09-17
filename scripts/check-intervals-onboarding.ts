/**
 * Чек арифметики стартовой точки. Ни сети, ни базы — только чистые функции.
 *
 * Эти числа становятся базой цикла, то есть объёмом, который человек побежит.
 * Ошибка здесь не падает, а тихо занижает или завышает нагрузку на все 12
 * недель. Оба случая, которые чек ловит первыми, найдены на живых данных, а не
 * придуманы: пробежка текущей недели проходила фильтр, но не попадала ни в одну
 * корзину (её минуты исчезали), а заметка про «другие виды спорта» считала их
 * по всей истории вместо окна.
 *
 *   npx tsx scripts/check-intervals-onboarding.ts
 */
import assert from "node:assert/strict";

import {
  computeStartingPointFromHistory,
  hasUsableHistory,
  mondayOf,
  startingPointFromAnswers,
  type ActivityForStartingPoint,
} from "@/features/intervals/onboarding/starting-point";
import type { OnboardingAnswers } from "@/features/intervals/onboarding/types";

const ASOF = "2026-08-26"; // среда
assert.equal(mondayOf(ASOF), "2026-08-24", "понедельник недели считается от даты");
assert.equal(mondayOf("2026-08-24"), "2026-08-24", "понедельник сам себе понедельник");
assert.equal(mondayOf("2026-08-23"), "2026-08-17", "воскресенье принадлежит предыдущей неделе");

function run(day: string, minutes: number, km: number, dataLevel = "pace_only"): ActivityForStartingPoint {
  return {
    activityType: "Run",
    startDateLocal: `${day}T08:00:00`,
    movingTimeS: minutes * 60,
    distanceM: km * 1000,
    dataLevel,
  };
}

// ── Границы окна ─────────────────────────────────────────────────────────────

// Окно — 8 полных недель, заканчивающихся 2026-08-23. Текущая неделя не входит.
const boundary = computeStartingPointFromHistory(
  [run("2026-08-25", 40, 8), run("2026-08-20", 40, 8)],
  ASOF
);
assert.equal(boundary.windowFrom, "2026-06-29");
assert.equal(boundary.windowTo, "2026-08-23");
assert.equal(boundary.runsTotal, 1, "пробежка текущей неполной недели в окно не входит");
assert.equal(
  boundary.weekly.reduce((sum, week) => sum + week.minutes, 0),
  40,
  "минуты попавшей в окно пробежки обязаны оказаться в корзине, а не исчезнуть"
);
assert.equal(boundary.weekly.length, 8, "корзин ровно восемь, включая пустые");

// ── Медиана считается по ВСЕМ неделям окна, включая нулевые ──────────────────
const sparse = computeStartingPointFromHistory(
  [run("2026-08-18", 60, 12), run("2026-08-19", 60, 12)],
  ASOF
);
assert.equal(sparse.medianWeeklyMinutes, 0, "семь пустых недель из восьми дают нулевую медиану");
assert.equal(sparse.weeksWithRuns, 1);
assert.equal(hasUsableHistory(sparse), false, "одна неделя данных — не история");

// ── Достаточная история ──────────────────────────────────────────────────────
const dense = computeStartingPointFromHistory(
  [
    run("2026-07-01", 50, 10), run("2026-07-08", 50, 10), run("2026-07-15", 50, 10),
    run("2026-07-22", 50, 10), run("2026-07-29", 50, 10), run("2026-08-05", 50, 10),
  ],
  ASOF
);
assert.equal(dense.weeksWithRuns, 6);
assert.equal(dense.medianWeeklyMinutes, 50, "шесть недель по 50 и две пустые → медиана 50");
assert.equal(hasUsableHistory(dense), true);

// ── Темп лёгкого: медиана МЕДЛЕННОЙ половины ────────────────────────────────
// Пять пробежек: 4:00, 4:30, 5:00, 5:30, 6:00 мин/км. Медиана всех — 5:00,
// медиана медленной половины (5:00, 5:30, 6:00) — 5:30. Быстрые не должны
// утягивать якорь лёгкого вниз.
const paced = computeStartingPointFromHistory(
  [
    run("2026-07-01", 40, 10), run("2026-07-02", 45, 10), run("2026-07-03", 50, 10),
    run("2026-07-08", 55, 10), run("2026-07-09", 60, 10),
  ],
  ASOF
);
assert.equal(paced.easyPaceSec, 330, "якорь лёгкого — 5:30/км, а не медиана всех 5:00");
assert.equal(paced.easyPaceSampleSize, 5);

// Короткие пробежки в расчёт темпа не идут.
const shortOnly = computeStartingPointFromHistory(
  [run("2026-07-01", 12, 2), run("2026-07-02", 12, 2), run("2026-07-03", 12, 2),
   run("2026-07-08", 12, 2), run("2026-07-09", 12, 2)],
  ASOF
);
assert.equal(shortOnly.easyPaceSec, null, "пробежки короче 3 км темп лёгкого не задают");

// ── Чужой спорт в беговой объём не входит ───────────────────────────────────
const mixed = computeStartingPointFromHistory(
  [
    run("2026-07-01", 50, 10),
    { activityType: "Swim", startDateLocal: "2026-07-02T08:00:00", movingTimeS: 3600, distanceM: 2000, dataLevel: "pace_only" },
    { activityType: "Ride", startDateLocal: "2026-07-03T08:00:00", movingTimeS: 7200, distanceM: 60000, dataLevel: "heartrate" },
  ],
  ASOF
);
assert.equal(mixed.runsTotal, 1, "плавание и велосипед — не беговой объём");
assert.equal(mixed.weekly.reduce((sum, week) => sum + week.minutes, 0), 50);
assert.ok(
  mixed.notes.some((note) => note.includes("в окне")),
  "заметка про другие виды спорта обязана считать их В ОКНЕ, а не по всей истории"
);

// ── Длительная и дни ─────────────────────────────────────────────────────────
// Неделя 07-06…07-12: 40 (Пн), 90 (Ср), 50 (Пт) — длительная в среду.
// Неделя 07-13…07-19: 80 (Сб) — длительная в субботу.
const longRun = computeStartingPointFromHistory(
  [run("2026-07-06", 40, 8), run("2026-07-08", 90, 16), run("2026-07-10", 50, 10),
   run("2026-07-18", 80, 15)],
  ASOF
);
assert.equal(longRun.longestRunMinutes, 90);
assert.equal(longRun.longRunMedianMinutes, 85, "медиана самых длинных пробежек недель: 90 и 80 → 85");
assert.equal(longRun.dayHistogramLong[2], 1, "длительная первой недели — среда");
assert.equal(longRun.dayHistogramLong[5], 1, "длительная второй недели — суббота");
assert.equal(
  longRun.dayHistogramLong.reduce((sum, value) => sum + value, 0),
  2,
  "по одной длительной на неделю, а не по одной на пробежку"
);
assert.equal(longRun.dayHistogram[0], 1, "понедельничная пробежка попала в общую гистограмму");

// ── Уровень данных ───────────────────────────────────────────────────────────
const withHr = computeStartingPointFromHistory(
  [run("2026-07-01", 50, 10, "heartrate"), run("2026-07-08", 50, 10, "heartrate"),
   run("2026-07-15", 50, 10, "pace_only")],
  ASOF
);
assert.equal(withHr.dataLevel, "heartrate", "две пульсовые из трёх — уровень heartrate");
// Граница включительная — та же, что у покрытия пульса внутри тренировки:
// ровно половина считается «пульс есть». Держать здесь другое правило значит
// заводить второй порог про одно и то же.
const halfHr = computeStartingPointFromHistory(
  [run("2026-07-01", 50, 10), run("2026-07-08", 50, 10, "heartrate")],
  ASOF
);
assert.equal(halfHr.dataLevel, "heartrate", "ровно половина с пульсом — граница включительная");

const mostlyNoHr = computeStartingPointFromHistory(
  [run("2026-07-01", 50, 10), run("2026-07-08", 50, 10), run("2026-07-15", 50, 10, "heartrate")],
  ASOF
);
assert.equal(mostlyNoHr.dataLevel, "pace_only", "одна пульсовая из трёх — цели будут по темпу");
assert.ok(
  mostlyNoHr.notes.some((note) => note.includes("цели будут по темпу")),
  "нехватка пульса обязана быть названа в заметках, а не только в поле"
);

// ── Ветка анкеты ─────────────────────────────────────────────────────────────
const answers: OnboardingAnswers = {
  sourceId: "s", goalKind: "race", raceDate: "2026-11-22", raceDistanceKm: 21.1,
  daysPerWeek: 4, selfReportedWeeklyMinutes: 200, unavailableWeekdays: [0], preferredLongWeekday: 6,
  canRunContinuously: null,
};
const fromAnswers = startingPointFromAnswers(answers);
assert.equal(fromAnswers.source, "questionnaire");
assert.equal(fromAnswers.medianWeeklyMinutes, 200, "база со слов");
assert.equal(fromAnswers.dataLevel, "none", "у ветки анкеты нет данных вообще");
assert.equal(fromAnswers.easyPaceSec, null, "темп не выдумывается без явного якоря от тренера");
assert.equal(fromAnswers.easyPaceOrigin, undefined, "без якоря происхождение не проставляется");
assert.equal(hasUsableHistory(fromAnswers), false, "анкета никогда не выдаёт себя за историю");

// ── Объём со слов даёт конверт, а не пустую неделю [17.09.2026] ─────────────
//
// Сегмент без подключаемых часов (Honor и подобные) никогда не наберёт
// историю: ждать её значит никогда не собрать план. buildWeek должен пройти
// мимо порога MIN_WEEKS_FOR_ENVELOPE, когда объём назван, и по-прежнему
// отказывать, когда не назван — это не смягчение порога вообще, а именно
// узкое, явное исключение.
const noVolumeAnswers: OnboardingAnswers = {
  ...answers,
  goalKind: "regular",
  selfReportedWeeklyMinutes: null,
};
const noVolumeStart = startingPointFromAnswers(noVolumeAnswers);
assert.equal(noVolumeStart.typicalRunMinutes, 0, "без объёма со слов типичная тренировка остаётся нулевой");
assert.equal(noVolumeStart.runMinutesP10, 0);
assert.equal(noVolumeStart.runMinutesP90, 0);

const reportedAnswers: OnboardingAnswers = {
  ...answers,
  goalKind: "regular",
  daysPerWeek: 3,
  selfReportedWeeklyMinutes: 70,
};
const EASY_PACE_7_22 = 7 * 60 + 22; // 442 с/км
const reportedStart = startingPointFromAnswers(reportedAnswers, { manualEasyPaceSec: EASY_PACE_7_22 });
assert.equal(reportedStart.typicalRunMinutes, 23, "70 мин / 3 дня ≈ 23 мин типичная тренировка");
assert.equal(reportedStart.runMinutesP10, 14, "пол — 60% от типичной, полоса намеренно широкая");
assert.equal(reportedStart.runMinutesP90, 32, "потолок — 140% от типичной");
assert.equal(reportedStart.easyPaceSec, EASY_PACE_7_22, "якорь — ровно тот, что назвал тренер");
assert.equal(reportedStart.easyPaceOrigin, "coach_stated");
assert.ok(
  reportedStart.notes.some((note) => note.includes("широкая")),
  "широкая полоса названа в заметках, а не молчит числом"
);

{
  const { buildAnchors, buildEnvelope } = await import("../tools/trainingpeaks-export/scripts/lib/intervals-plan-adapter.ts");
  const { buildWeek } = await import("../tools/trainingpeaks-export/scripts/lib/autoplanner-week.ts");
  const { stubCatalog } = await import("../tools/trainingpeaks-export/scripts/lib/cycle-check-stubs.ts");

  const cat = stubCatalog();
  const weekStart = "2026-09-21"; // понедельник

  // Без объёма — ОТКАЗ, как и раньше. Регресс здесь был бы тихим и опасным:
  // случайно ослабленный порог пустил бы в план людей вообще без данных.
  const envNoVolume = buildEnvelope(noVolumeStart);
  const anchorsNoVolume = buildAnchors(noVolumeStart, null);
  const weekNoVolume = buildWeek(anchorsNoVolume, envNoVolume, cat, weekStart, false);
  assert.equal(weekNoVolume.refusedKind, "insufficient_data", "без объёма со слов buildWeek по-прежнему отказывает");

  // С объёмом — план собирается, работа по усилию, якорь — тот, что назвал
  // тренер, с пониженным доверием.
  const envReported = buildEnvelope(reportedStart);
  assert.equal(envReported.volumeIsReported, true, "конверт помечен как со слов");
  const anchorsReported = buildAnchors(reportedStart, null);
  assert.equal(anchorsReported.easy?.source, "easy_description", "якорь помечен как названный тренером");
  assert.equal(anchorsReported.easy?.confidence, "medium_low", "доверие ниже, чем у измеренного якоря");
  const weekReported = buildWeek(anchorsReported, envReported, cat, weekStart, false);
  assert.equal(weekReported.refusedKind, null, "с объёмом со слов buildWeek больше не отказывает");
  assert.ok(weekReported.sessions.length > 0, "неделя реально собралась, не осталась пустой");
  assert.ok(
    weekReported.notes.some((note) => note.includes("СО СЛОВ")),
    "тренер видит прямым текстом, что конверт этой недели не измерен"
  );
}

console.log("check:intervals-onboarding — все проверки пройдены");
