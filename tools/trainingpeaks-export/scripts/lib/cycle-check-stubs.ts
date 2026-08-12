/**
 * cycle-check-stubs — минимальные заглушки для проверок сборщика. ТОЛЬКО ДЛЯ ТЕСТОВ.
 *
 * Зачем не брать живые данные: проверка должна падать на ЛОГИКЕ, а не на том, что
 * сегодня в базе. Живой прогон завтра поменяет числа, и тест начнёт мигать.
 *
 * Значения подобраны так, чтобы неделя собиралась без отказов и без упора в защиты:
 * тогда любое расхождение с целью цикла — это расхождение подключения, а не полов.
 */
import type { AerobicPreset, Catalog, QualityPreset } from "./autoplanner-catalog.ts";
import type { Envelope } from "./autoplanner-context.ts";
import type { AthleteAnchors } from "./pace-resolver.ts";

export function stubAnchors(): AthleteAnchors {
  return {
    athleteId: 1,
    tier: "T2",
    easy: { fastSec: 360, slowSec: 385, source: "easy_description", confidence: "high", effectiveN: 6 },
    threshold: { paceSec: 300, source: "applied_threshold_coach", confidence: "high" },
    quality: null,
  };
}

export function stubEnvelope(): Envelope {
  return {
    rolling4wWeeklyMin: 180,
    rolling4wFrequency: 3,
    rolling4wQuality: 1,
    qualityLast8w: 6,
    lastWeekMinutes: 175,
    rolling4wPlannedMin: 190,
    lastWeekPlannedMinutes: 185,
    typicalPlannedWeekMin: 190,
    complianceRatio: 0.95,
    lowComplianceWeeks: 0,
    notRunningWeeks: 0,
    typicalEasyMinutes: 45,
    lastQualityWorkMinutes: 24,
    capWeeklyMin: null,
    capLongRunMin: null,
    capQuality: null,
    capFrequency: null,
    // Практики длительных у заглушки нет намеренно: потолок длительной тогда считается от
    // недельного объёма, как при пустом baseline, и проверки меряют ЛОГИКУ, а не подсунутое число.
    longRunPracticeMaxMin: 0,
    longRunPracticeMedianMin: 0,
    // личного пола у заглушки нет: проверки должны мерить ЛОГИКУ, а не подсунутое число
    easyFloorPersonalMin: 0,
    easyTargetPersonalMin: 0,
    easyMaxPersonalMin: 0,
    dayHistogram: [1, 1, 1, 1, 1, 1, 1],
    weeksObserved: 20,
  };
}

const aerobic = (presetCode: string): AerobicPreset => ({
  presetCode, displayNameRu: presetCode, targetMode: "pace",
  rpeTarget: null, rpeCap: null, advisoryMinMinutes: null, advisoryMaxMinutes: null,
  controlModeOverriddenByTier: false,
});

const quality = (presetCode: string, reps: number, workMinutes: number): QualityPreset => ({
  presetCode, displayNameRu: presetCode, intensityIntent: "controlled_threshold",
  reps, workMinutes, recoveryMinutes: 1, rpeTarget: null, rpeCap: null,
  avoidAcidosis: true, coachReviewRequired: false, requiresExplicitVo2: false,
  warmupMinutes: 12, cooldownMinutes: 12, totalWorkMinutes: reps * workMinutes,
  athleteLevelMin: "L1",
});

export function stubCatalog(): Catalog {
  return {
    aerobic: new Map([
      ["easy_continuous", aerobic("easy_continuous")],
      ["easy_plus_strides", aerobic("easy_plus_strides")],
      ["recovery_easy", aerobic("recovery_easy")],
      ["long_aerobic", aerobic("long_aerobic")],
    ]),
    // лесенка от 20 до 48 мин работы — достаточно, чтобы цель цикла нашла близкий формат
    quality: [
      quality("thr_4x5", 4, 5), quality("thr_3x8", 3, 8), quality("thr_5x6", 5, 6),
      quality("thr_4x8", 4, 8), quality("thr_5x7", 5, 7), quality("thr_4x10", 4, 10),
      quality("thr_3x14", 3, 14), quality("thr_3x16", 3, 16),
    ],
    guardrails: [],
    reviewRules: [],
  };
}
