/** Онбординг: что человек сказал о себе и что видно из его истории. */

export type GoalKind = "race" | "regular";

/** Анкета. Состав обоснован в миграции 20260928000000 — по полю на абзац. */
export type OnboardingAnswers = {
  sourceId: string;
  goalKind: GoalKind;
  raceDate: string | null;
  raceDistanceKm: number | null;
  daysPerWeek: number;
  /** Со слов. Используется ТОЛЬКО когда истории нет. */
  selfReportedWeeklyMinutes: number | null;
  /** 0=Пн … 6=Вс. Жёсткое ограничение календаря, не пожелание. */
  unavailableWeekdays: number[];
  preferredLongWeekday: number | null;
};

/**
 * Стартовая точка — то, ОТ ЧЕГО растёт цикл.
 *
 * Считается из истории, когда она есть, и из анкеты, когда её нет. Это две
 * разные ветки, а не «история с подстановкой умолчаний»: у них разная цена
 * ошибки и разное обещание тренеру, и различать их надо явно.
 */
export type StartingPointSource = "history" | "questionnaire";

export type WeeklyVolumePoint = { weekStart: string; minutes: number; runs: number };

export type StartingPoint = {
  source: StartingPointSource;

  /** Окно наблюдения. Для ветки анкеты — null. */
  windowFrom: string | null;
  windowTo: string | null;
  weeksObserved: number;

  /** Понедельные минуты бега, от старых к свежим. Тренер должен видеть ряд, а не только итог. */
  weekly: WeeklyVolumePoint[];

  /** Медиана недельных минут по окну — база цикла. */
  medianWeeklyMinutes: number;
  rolling4wWeeklyMinutes: number;
  rolling8wWeeklyMinutes: number;

  /** Фактическая частота: пробежек в неделю по окну. */
  runsPerWeek: number;
  /** Наблюдаемое распределение дней: 0=Пн … 6=Вс. */
  dayHistogram: number[];
  /** Сколько недель окна содержат хотя бы одну пробежку. */
  weeksWithRuns: number;

  /** Медиана длительности пробежки, мин. 0 — не из чего считать. */
  typicalRunMinutes: number;
  /** Самая длинная пробежка окна, мин. */
  longestRunMinutes: number;
  /**
   * Медиана САМОЙ ДЛИННОЙ пробежки недели. Именно она отвечает на вопрос «какая
   * у человека обычная длительная», тогда как максимум за окно — это его лучший
   * день, а медиана всех пробежек — его обычная лёгкая.
   */
  longRunMedianMinutes: number;
  /** p10 и p90 длительности пробежки, мин — личные пол и потолок лёгкой. */
  runMinutesP10: number;
  runMinutesP90: number;
  /**
   * Распределение дней САМОЙ ДЛИННОЙ пробежки недели, 0=Пн … 6=Вс.
   * Общая гистограмма забита лёгкими днями и про длительную не говорит ничего —
   * это измерено на ростере TP: argmax общей совпадает с настоящим днём
   * длительной лишь у 27 атлетов из 99.
   */
  dayHistogramLong: number[];

  /**
   * Темп лёгкого бега, сек/км: медиана МЕДЛЕННОЙ ПОЛОВИНЫ пробежек окна.
   * null — пробежек с дистанцией и временем не набралось.
   */
  easyPaceSec: number | null;
  easyPaceSampleSize: number;

  /** Что реально есть в тренировках окна — считается по уже сохранённым уровням. */
  dataLevel: "heartrate" | "pace_only" | "none";
  runsWithHeartrate: number;
  runsTotal: number;

  /** Пояснения к цифрам: тренер должен проверять, а не верить. */
  notes: string[];
};
