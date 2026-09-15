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
  goalKind: "race" | "regular" | "improve" | "start_running";
  raceDate: string | null;
  raceDistanceKm: number | null;
  daysPerWeek: number;
  unavailableWeekdays: number[];
  preferredLongWeekday: number | null;
  /** Потолок одной тренировки из анкеты. null — не спрашивали. */
  maxSessionMinutes: number | null;
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

/**
 * Порог ученика Intervals, как он лежит в источнике данных.
 *
 * ТРИ ПОЛЯ ВМЕСТЕ ИЛИ НИ ОДНОГО: число без происхождения и даты — это темпы
 * всей работы цикла неизвестного качества. Констрейнт в базе стережёт то же
 * самое, здесь просто нечего собирать из половины.
 */
export type StoredThreshold = {
  paceSecPerKm: number;
  source: "diagnostic" | "race_result" | "coach_manual";
  setAt: string;
};

/**
 * Доверие по происхождению.
 *
 * Диагностика — это измерение, сделанное специально и недавно: доверие высокое.
 * Результат старта — тоже измерение, но обстоятельства старта нам неизвестны
 * (жара, рельеф, форма), поэтому на ступень ниже. Ручная простановка — знание
 * тренера о человеке: оно бывает точнее любого теста, но проверить его нечем,
 * и в служебной строке это должно быть видно.
 */
function thresholdConfidence(source: StoredThreshold["source"]): "high" | "medium" | "medium_low" {
  if (source === "diagnostic") return "high";
  if (source === "race_result") return "medium";
  return "medium_low";
}

export function buildAnchors(start: StartingPointInput, stored: StoredThreshold | null = null): AthleteAnchors {
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
    // ПОРОГ — ТОЛЬКО ИЗМЕРЕННЫЙ ИЛИ ПОСТАВЛЕННЫЙ ТРЕНЕРОМ. Вывести его из якоря
    // лёгкого через отношение нельзя: это выдуманные темпы всех отрезков цикла.
    // Пусто — работа назначается по усилию (см. qualityByEffort ниже).
    threshold: stored
      ? {
          paceSec: stored.paceSecPerKm,
          source:
            stored.source === "diagnostic"
              ? "intervals_threshold_diagnostic"
              : stored.source === "race_result"
                ? "intervals_threshold_race"
                : "intervals_threshold_manual",
          confidence: thresholdConfidence(stored.source),
        }
      : null,
    quality: null,
    // КОГДА ПОРОГА НЕТ — КАЧЕСТВО ПО УСИЛИЮ [решение Игоря, 15.09.2026].
    // Флаг остаётся включённым и при заданном пороге: он ничего не меняет там,
    // где темпы есть, а резолвер идёт обычным путём.
    //
    // Без этого человек, попросивший развития, получал двенадцать недель одного
    // лёгкого бега: цикл рос объёмом, работы не было ни одной. Пресеты несут
    // собственный RPE, то есть методика знает, каким должно быть усилие, и без
    // темпа. «6 × 3 минуты, усилие 7 из 10, говорить можно короткими фразами» —
    // это настоящая работа, просто описанная не числами темпа.
    //
    // Флаг стоит ТОЛЬКО здесь, у ветки Intervals. Ростер TrainingPeaks его не
    // видит и ведёт себя ровно как раньше: там отказ означает «сначала поставь
    // порог», и это правильное поведение.
    qualityByEffort: true,
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
    answers.goalKind === "race"
      ? intentFromDistance(answers.raceDistanceKm)
      : answers.goalKind === "improve"
        ? "develop"
        : "maintenance";

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

  /**
   * СКОЛЬКО РАБОТЫ В НЕДЕЛЕ.
   *
   * Измерить качество в данных Intervals нечем: заголовков тренера там нет,
   * разметки тоже. Раньше отсюда следовал ноль, и цикл развития двенадцать
   * недель рос одним объёмом — человек просил развития, а получал поддержание
   * с добавкой километров.
   *
   * Поэтому для цели «улучшать результаты» работа назначается ОТ ОБЪЁМА, а не
   * от истории качества: десятая часть недели, но не больше 25 минут работы.
   * Числа выбраны консервативно и осознанно:
   *   · 10% недельного объёма — нижняя граница обычной практики (в ростере
   *     доля работы у ведущих 12–18%), то есть заведомо мягкий вход;
   *   · потолок 25 минут — это одна сессия вроде 5 × 4 или 6 × 3 минуты,
   *     столько же берёт первый пороговый блок у человека без истории работы;
   *   · пол 10 минут — меньше не имеет смысла, это не работа.
   *
   * Для «просто бегать регулярно» и для новичка остаётся ноль: там растить
   * объём и есть вся задача.
   */
  const QUALITY_SHARE = 0.1;
  const QUALITY_MIN_MINUTES = 10;
  const QUALITY_MAX_MINUTES = 25;
  const wantsQuality = intent === "develop";
  const baseQuality = wantsQuality
    ? Math.min(
        QUALITY_MAX_MINUTES,
        Math.max(QUALITY_MIN_MINUTES, Math.round((baseAerobic * QUALITY_SHARE) / 5) * 5)
      )
    : 0;
  gaps.push("качественные сессии в истории Intervals не размечены — база работы принята нулевой");
  if (intent === "develop") {
    // ЯВНО И ПЕРВОЙ СТРОКОЙ. Работа в цикле есть, но она назначена ПО УСИЛИЮ, а
    // не по темпу, и тренер обязан видеть это в плане, а не выяснять из текста
    // сессий. Прежняя формулировка («качественных сессий нет») была верна до
    // 15.09.2026 и теперь снята вместе с причиной.
    gaps.push(
      "РАБОТА В ЭТОМ ЦИКЛЕ НАЗНАЧЕНА ПО УСИЛИЮ, БЕЗ ТЕМПОВ. Порога у ученика нет: в Intervals " +
        "его взять неоткуда, а выводить из якоря лёгкого значило бы выдумать темпы всех " +
        "отрезков. Поэтому отрезки описаны усилием по шкале 1–10, как их несёт методика. " +
        "Разминка и трусца идут по темпу: якорь лёгкого измерен. Когда появится порог " +
        "(диагностика или результат старта), те же сессии получат темпы."
    );
  }
  if (start.source === "questionnaire") {
    gaps.push("истории нет — база целиком со слов ученика");
  }

  const historicMaxAerobic = start.weekly.length
    ? Math.max(...start.weekly.map((point) => point.minutes))
    : baseAerobic;

  // Потолок роста — тот же расчёт, что и у ростера TP: между базой и собственным
  // историческим максимумом, с ограниченным выходом выше обоих.
  let peakCapAerobic = Math.round(
    capBetween(baseAerobic * PEAK_OVER_BASE_MAX, historicMaxAerobic * PEAK_OVER_HISTORIC_MAX)
  );

  // ПОТОЛОК ОГРАНИЧЕН ЕЩЁ И ВРЕМЕНЕМ, КОТОРОЕ ЧЕЛОВЕК НАЗВАЛ.
  //
  // История говорит, сколько он БЕГАЛ, анкета — сколько он МОЖЕТ. Пока это не
  // сведено, цикл развития растёт в потолок, выведенный из прошлого, и упирается
  // в календарь человека: план на 240 минут в неделю при трёх тренировках по
  // часу невыполним, и невыполним предсказуемо.
  //
  // Недельная вместимость = потолок одной тренировки × число беговых дней.
  // Считаем ТОЛЬКО когда обе величины названы: выдуманная вместимость была бы
  // хуже её отсутствия.
  if (answers.maxSessionMinutes !== null && answers.daysPerWeek > 0) {
    const weeklyCapacity = answers.maxSessionMinutes * answers.daysPerWeek;
    if (weeklyCapacity < peakCapAerobic) {
      notes.push(
        `потолок срезан временем из анкеты: ${answers.maxSessionMinutes} мин × ${answers.daysPerWeek} дн = ` +
          `${weeklyCapacity} мин в неделю (по истории выходило ${peakCapAerobic})`
      );
      peakCapAerobic = weeklyCapacity;
    }
  }

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
    // ПОТОЛОК РАБОТЫ. Ноль здесь означал бы «работы не будет», что бы ни стояло
    // в базе: forecast режет минуты работы по этому числу. Для цикла развития
    // потолок — полуторная база, то есть к концу двенадцати недель работа
    // вырастает с 15 до 20–25 минут, не больше одной сессии.
    peakCapQualityMin: Math.round(baseQuality * 1.5),
    historicMaxQualityMin: baseQuality,
    aerobicIfFromMax: Math.round(historicMaxAerobic * PEAK_OVER_HISTORIC_MAX),
    // Полураспад и наклон — диагностика взвешенной базы, которой здесь нет:
    // база это медиана окна, а не экспоненциальное среднее по 26 неделям.
    halfLifeDays: 0,
    base42Aerobic: baseAerobic,
    slopeMinPerWeek: 0,
    /**
     * ОБЫЧНАЯ ДОЛЯ РАБОТЫ. Цикл следит, чтобы доля работы не уезжала от
     * привычной человеку больше чем на два процентных пункта (clampShare).
     * Ноль означал бы «привычная доля — нисколько», и любая работа срезалась бы
     * обратно в ноль: именно на этом качество и терялось молча.
     *
     * У ученика Intervals привычной доли не измерить, поэтому берём ту, под
     * которую и назначена работа: десятую часть недели. Это не факт о человеке,
     * а наша же цель, сказанная вслух.
     */
    ownSharePct: wantsQuality ? 10 : 0,
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
