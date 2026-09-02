/**
 * Переходник: анкета + стартовая точка Intervals → вход ДЕЙСТВУЮЩЕГО генератора.
 *
 * Второго генератора здесь нет и быть не должно. Недели считает buildWeek, цикл
 * разворачивает forecast — тот же код, что работает на ростере TrainingPeaks.
 * Этот файл только собирает для них вход из данных, которых у того ростера нет.
 *
 * ЧТО ЗДЕСЬ ЧЕСТНО, А ЧТО ПРИБЛИЖЕНО. Генератор рассчитан на атлета с историей
 * ПЛАНОВ тренера: он знает, сколько ему назначали, что он выполнил, какие
 * сессии были качественными. У человека, который просто писал тренировки в
 * Intervals, ничего этого нет. Поэтому:
 *   • измеримое (объём, частота, дни, длительности, темп) — берётся из фактов;
 *   • плановое (выполнение, назначенные объёмы) — остаётся нулевым, и генератор
 *     сам уходит на свои документированные запасные пути;
 *   • качество (пороговые, отрезки) — НЕ ВЫДУМЫВАЕТСЯ. Порога у новичка нет,
 *     и сборщик по своему же правилу откажется ставить качественную сессию,
 *     назвав причину. Дыра в неделе, объяснённая причиной, честнее выдуманного
 *     темпа отрезков.
 */

import type { Envelope } from "./autoplanner-context.ts";
import { tierOf } from "./easy-anchor.ts";
import type { AthleteAnchors, EasyAnchor } from "./pace-resolver.ts";
import {
  DELOAD_AEROBIC_FACTOR, DELOAD_EVERY_N, DELOAD_QUALITY_FACTOR, LENGTH_WEEKS,
  PEAK_OVER_BASE_MAX, PEAK_OVER_HISTORIC_MAX, STEP_AEROBIC, STEP_QUALITY, TAPER_PROFILE,
  capBetween, intentFromDistance, type CycleDraft, type CycleIntent,
} from "./training-cycle.ts";

/** Структурная копия StartingPoint из @/features/intervals/onboarding/types. */
export type StartingPointInput = {
  source: "history" | "questionnaire";
  weeksObserved: number;
  weekly: { weekStart: string; minutes: number; runs: number }[];
  medianWeeklyMinutes: number;
  rolling4wWeeklyMinutes: number;
  rolling8wWeeklyMinutes: number;
  runsPerWeek: number;
  dayHistogram: number[];
  dayHistogramLong: number[];
  typicalRunMinutes: number;
  longestRunMinutes: number;
  longRunMedianMinutes: number;
  runMinutesP10: number;
  runMinutesP90: number;
  easyPaceSec: number | null;
  easyPaceSampleSize: number;
  dataLevel: "heartrate" | "pace_only" | "none";
};

export type AnswersInput = {
  goalKind: "race" | "regular" | "start_running";
  raceDate: string | null;
  raceDistanceKm: number | null;
  daysPerWeek: number;
  unavailableWeekdays: number[];
  preferredLongWeekday: number | null;
};

/**
 * Полоса лёгкого вокруг измеренной медианы, ±15 с/км.
 *
 * Ширина взята не с потолка: сборщик всё равно сужает полосу лёгкого до 30 с
 * (EASY_BAND_MAX_S), поэтому более широкая была бы срезана им же, а более
 * узкая соврала бы о точности медианы по нескольким десяткам пробежек.
 */
const EASY_BAND_HALF_S = 15;

/** Доверие к измеренному темпу — по размеру выборки. Границы назначенные, и это видно. */
function easyConfidence(sampleSize: number): EasyAnchor["confidence"] {
  if (sampleSize >= 30) return "medium";
  if (sampleSize >= 12) return "medium_low";
  return "low";
}

export function buildAnchors(start: StartingPointInput): AthleteAnchors {
  const easy: EasyAnchor | null =
    start.easyPaceSec === null
      ? null
      : {
          fastSec: start.easyPaceSec - EASY_BAND_HALF_S,
          slowSec: start.easyPaceSec + EASY_BAND_HALF_S,
          source: "intervals_easy_measured",
          confidence: easyConfidence(start.easyPaceSampleSize),
          effectiveN: start.easyPaceSampleSize,
        };

  return {
    // Числового идентификатора TrainingPeaks у этого человека нет. Ноль здесь —
    // не «атлет №0», а признак «не из ростера TP»; настоящая личность живёт в
    // source_id строки плана. Поле используется генератором только как подпись
    // в отчёте, поиска по нему нет (проверено: три места, все — вывод).
    athleteId: 0,
    tier: tierOf(start.medianWeeklyMinutes),
    easy,
    // ПОРОГА НЕТ. Ни в Intervals, ни в анкете его взять неоткуда, а выдуманный
    // порог — это выдуманные темпы всех качественных сессий цикла. Сборщик по
    // своему правилу откажет качеству и назовёт причину.
    threshold: null,
    quality: null,
  };
}

export function buildEnvelope(start: StartingPointInput): Envelope {
  const weeklyMinutes = start.weekly.map((point) => point.minutes);
  const lastWeek = weeklyMinutes.length ? weeklyMinutes[weeklyMinutes.length - 1] : 0;

  return {
    rolling4wWeeklyMin: start.rolling4wWeeklyMinutes,
    rolling4wFrequency: start.runsPerWeek,
    // Качественных сессий не измеряем: в Intervals нет ни заголовков тренера, ни
    // разметки, по которой их можно отличить. Ноль здесь — «не знаем», и он же
    // не даёт скелету потребовать качество, которое нечем наполнить.
    rolling4wQuality: 0,
    qualityLast8w: 0,
    lastWeekQualityCount: 0,
    hasTempoPractice: false,
    hasIntervalPractice: false,

    lastWeekMinutes: lastWeek,

    // ПЛАНОВЫХ ВЕЛИЧИН НЕТ ВООБЩЕ: человеку никто не назначал недели, значит и
    // выполнения не существует. Нули и null — это факт, а не заглушка.
    rolling4wPlannedMin: 0,
    lastWeekPlannedMinutes: 0,
    typicalPlannedWeekMin: 0,
    complianceRatio: null,
    lowComplianceWeeks: 0,
    notRunningWeeks: 0,

    typicalEasyMinutes: start.typicalRunMinutes,
    lastQualityWorkMinutes: null,

    // Потолков от тренера нет — их роль играет собственная практика ниже.
    capWeeklyMin: null,
    capLongRunMin: null,
    capQuality: null,
    capFrequency: null,

    longRunPracticeMaxMin: start.longestRunMinutes,
    longRunPracticeMedianMin: start.longRunMedianMinutes,

    // ЛИЧНЫЕ ПОЛ, ЦЕЛЬ И ПОТОЛОК ЛЁГКОЙ — по длительностям пробежек.
    // ПРИБЛИЖЕНИЕ: в TP эти числа считаются по НЕ-качественным пробежкам, а здесь
    // качественные отделить нечем, и они попадают в ту же выборку. Смещение
    // направлено вниз (качественные обычно короче лёгких), то есть в сторону
    // осторожности, и это лучше, чем когортное число вместо личного.
    easyFloorPersonalMin: start.runMinutesP10,
    easyTargetPersonalMin: start.typicalRunMinutes,
    easyMaxPersonalMin: start.runMinutesP90,

    dayHistogram: start.dayHistogram,
    dayHistogramLong: start.dayHistogramLong,
    // Качественных дней не знаем — пустая гистограмма, а не копия общей: копия
    // выглядела бы как знание.
    dayHistogramQuality: [0, 0, 0, 0, 0, 0, 0],
    dayHistogramEasy: start.dayHistogram,

    weeksObserved: start.weeksObserved,
  };
}

/** Сколько недель между понедельниками. */
function weeksBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / (7 * 86_400_000));
}

export type CycleShape = {
  draft: CycleDraft;
  intent: CycleIntent;
  lengthWeeks: number;
  notes: string[];
};

/**
 * Черновик цикла. Параметры роста, разгрузки и подводки берутся из общего
 * модуля — здесь только база, длина и цель.
 */
export function buildDraftFromOnboarding(
  answers: AnswersInput,
  start: StartingPointInput,
  firstWeekStart: string
): CycleShape {
  const notes: string[] = [];
  const gaps: string[] = [];

  // start_running сюда не доходит: у него своя ветка, лестница шаг-бега вместо
  // цикла по объёму. Значение оставлено ради полноты разбора.
  const intent: CycleIntent =
    answers.goalKind === "race" ? intentFromDistance(answers.raceDistanceKm) : "maintenance";

  // ДЛИНА ЦИКЛА. У старта — сколько недель до него осталось, но не больше
  // канонической длины подготовки под эту дистанцию: если до полумарафона год,
  // это не «цикл на 52 недели», а несколько циклов подряд.
  let lengthWeeks = LENGTH_WEEKS[intent];
  if (answers.goalKind === "race" && answers.raceDate) {
    const toRace = weeksBetween(firstWeekStart, answers.raceDate);
    lengthWeeks = Math.max(1, Math.min(LENGTH_WEEKS[intent], toRace));
    notes.push(
      `до старта ${toRace} нед; длина цикла ${lengthWeeks} (канон для ${intent} — ${LENGTH_WEEKS[intent]})`
    );
  }

  const baseAerobic = Math.max(0, Math.round(start.medianWeeklyMinutes));
  // КАЧЕСТВО В БАЗЕ — НОЛЬ. Не потому, что его не нужно, а потому что измерить
  // его в данных Intervals нечем. Это записано в gaps черновика, чтобы не
  // выглядело как «тренер решил обойтись без работы».
  const baseQuality = 0;
  gaps.push("качественные сессии в истории Intervals не размечены — база работы принята нулевой");
  if (start.source === "questionnaire") {
    gaps.push("истории нет — база целиком со слов ученика");
  }

  const historicMaxAerobic = start.weekly.length
    ? Math.max(...start.weekly.map((point) => point.minutes))
    : baseAerobic;

  // Потолок роста — тот же расчёт, что и у ростера TP: между базой и собственным
  // историческим максимумом, с ограниченным выходом выше обоих.
  const peakCapAerobic = Math.round(
    capBetween(baseAerobic * PEAK_OVER_BASE_MAX, historicMaxAerobic * PEAK_OVER_HISTORIC_MAX)
  );

  const draft: CycleDraft = {
    athleteId: 0,
    intent,
    targetRaceId: null,
    targetDate: answers.goalKind === "race" ? answers.raceDate : null,
    lengthWeeks,
    baseAerobicMin: baseAerobic,
    baseQualityMin: baseQuality,
    stepAerobic: STEP_AEROBIC,
    stepQuality: STEP_QUALITY,
    deloadEveryN: DELOAD_EVERY_N,
    deloadDepthAerobic: DELOAD_AEROBIC_FACTOR,
    deloadQualityFactor: DELOAD_QUALITY_FACTOR,
    taperProfile: TAPER_PROFILE[intent],
    days: answers.daysPerWeek,
    peakCapAerobicMin: peakCapAerobic,
    historicMaxAerobicMin: historicMaxAerobic,
    peakCapQualityMin: 0,
    historicMaxQualityMin: 0,
    aerobicIfFromMax: Math.round(historicMaxAerobic * PEAK_OVER_HISTORIC_MAX),
    // Полураспад и наклон — диагностика взвешенной базы, которой здесь нет:
    // база это медиана окна, а не экспоненциальное среднее по 26 неделям.
    halfLifeDays: 0,
    base42Aerobic: baseAerobic,
    slopeMinPerWeek: 0,
    ownSharePct: 0,
    baseAerobicManual: null,
    baseQualityManual: null,
    baseManualReason: null,
    baseAerobicComputed: baseAerobic,
    baseQualityComputed: baseQuality,
    base8Aerobic: start.rolling8wWeeklyMinutes,
    base8Quality: 0,
    illWeeks: 0,
    gaps,
  };

  return { draft, intent, lengthWeeks, notes };
}
