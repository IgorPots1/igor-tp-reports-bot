/**
 * Методика начинающего: лестница шаг-бег и правила перехода.
 *
 * ПЕРЕНЕСЕНО ИЗ /Users/igor/ai-running-coach (src/features/plans/methodology.ts,
 * TRUE_BEGINNER_BASE_SEGMENT, methodology_version "true_beginner_v1"). Тот
 * репозиторий стоит с мая 2026; держать две версии правды нельзя, поэтому
 * источник переехал сюда целиком и версионирован.
 *
 * ВЕРСИЯ ПОДНЯТА ДО v2, потому что содержимое отличается от перенесённого —
 * это решения тренера от 26.08.2026, а не копия:
 *   • ступеней семь, а не шесть: непрерывный бег разделён на 25 и 30 минут;
 *   • RPE на сессии шаг-бег 2–4, а не 4–5 (каталожные пресеты приведены к этому);
 *   • появился минимум сессий на ступени перед переходом (его в v1 не было).
 * Правила перехода по RPE и приоритет боли над прогрессией — как в v1.
 *
 * ЭТО ИСТОЧНИК, А НЕ ВСПОМОГАТЕЛЬНЫЙ КОД. Числа лестницы и правила перехода
 * лежат здесь и только здесь; генератор, каталог и состояние прогрессии
 * ссылаются на них, а не повторяют.
 */

export const BEGINNER_METHODOLOGY_ID = "coach_igor_true_beginner";
export const BEGINNER_METHODOLOGY_VERSION = "true_beginner_v2";

/** «Хочу начать бегать» — сегмент, к которому применима эта методика. */
export const BEGINNER_SEGMENT_LABEL_RU = "Хочу начать бегать";

/**
 * ПОТОЛОК БЕГОВЫХ ДНЕЙ В НЕДЕЛЮ — ЖЁСТКИЙ.
 *
 * Из перенесённой методики: «В первые 12 недель давать только 2-3 беговые
 * тренировки в неделю». Это не рекомендация к округлению: просьбу о четырёх
 * днях мы ОТКЛОНЯЕМ с объяснением, а не урезаем молча — человек должен знать,
 * что его услышали и почему ответили нет.
 */
export const BEGINNER_MAX_RUNS_PER_WEEK = 3;

/**
 * СКОЛЬКО СЕССИЙ НУЖНО ОТРАБОТАТЬ НА СТУПЕНИ ПЕРЕД ПЕРЕХОДОМ.
 *
 * В перенесённой методике числа не было: RPE 2–3 разрешал прогрессию сразу.
 * Одна удачная тренировка не отличает «нагрузка переносится» от «сегодня был
 * хороший день»: выспался, прохладно, свежие ноги. Две подряд — отличают.
 *
 * Почему именно две, а не три. При 2–3 беговых днях в неделю две сессии — это
 * примерно неделя на ступени, то есть семь ступеней проходятся за 7–8 недель и
 * укладываются в «первые 12 недель» методики С ЗАПАСОМ на повторы, которые
 * обязательно будут (RPE 4–5 → повторить). Три сессии на ступень растянули бы
 * минимум до 10–12 недель, и любой повтор выбивал бы человека из горизонта.
 */
export const MIN_SESSIONS_PER_STEP = 2;

/** Ступень «аккуратной» прогрессии требует одной сессии сверх минимума. */
export const CAREFUL_EXTRA_SESSIONS = 1;

export type BeginnerStepKind = "run_walk" | "continuous";

export type BeginnerStep = {
  /** 1…7. Номер — часть контракта: он хранится в состоянии прогрессии. */
  index: number;
  presetCode: string;
  kind: BeginnerStepKind;
  /** Плановое число повторов. Для «5-6» здесь 6 — см. repsMin. */
  reps: number | null;
  /** Нижняя граница диапазона повторов: столько допустимо, если тяжело. */
  repsMin: number | null;
  runMin: number | null;
  walkMin: number | null;
  continuousMin: number | null;
  labelRu: string;
  /** Вся сессия целиком, мин (без разминки и заминки — см. комментарий ниже). */
  totalMinutes: number;
  /** Из них собственно бега, мин. Именно это число идёт в недельный объём. */
  runningMinutes: number;
};

/**
 * ЛЕСТНИЦА. Логика роста: сначала СОКРАЩАЕТСЯ ОТДЫХ при неизменной работе
 * (ступени 1→4), потом ДОБАВЛЯЕТСЯ ПОВТОР (4→5), и только затем шаг убирается
 * совсем (5→6). Непрерывный бег растёт длительностью (6→7).
 *
 * Разминки и заминки в минутах сессии НЕТ намеренно: формат шаг-бег сам себе
 * разминка — первый отрезок бежится с холодных ног в том же лёгком усилии.
 * Приписывать сверху «12 минут разминки» значило бы выдать новичку сессию на
 * 50 минут вместо 30.
 */
export const BEGINNER_LADDER: BeginnerStep[] = [
  { index: 1, presetCode: "rw_5x4_2walk",     kind: "run_walk",   reps: 5, repsMin: 5, runMin: 4, walkMin: 2,   continuousMin: null, labelRu: "5 x 4 мин бег / 2 мин шаг",       totalMinutes: 30,   runningMinutes: 20 },
  { index: 2, presetCode: "rw_5x5_2walk",     kind: "run_walk",   reps: 5, repsMin: 5, runMin: 5, walkMin: 2,   continuousMin: null, labelRu: "5 x 5 мин бег / 2 мин шаг",       totalMinutes: 35,   runningMinutes: 25 },
  { index: 3, presetCode: "rw_5x5_90walk",    kind: "run_walk",   reps: 5, repsMin: 5, runMin: 5, walkMin: 1.5, continuousMin: null, labelRu: "5 x 5 мин бег / 1:30 шаг",        totalMinutes: 32.5, runningMinutes: 25 },
  { index: 4, presetCode: "rw_5x5_1walk",     kind: "run_walk",   reps: 5, repsMin: 5, runMin: 5, walkMin: 1,   continuousMin: null, labelRu: "5 x 5 мин бег / 1 мин шаг",       totalMinutes: 30,   runningMinutes: 25 },
  { index: 5, presetCode: "rw_6x5_1walk",     kind: "run_walk",   reps: 6, repsMin: 5, runMin: 5, walkMin: 1,   continuousMin: null, labelRu: "5-6 x 5 мин бег / 1 мин шаг",     totalMinutes: 36,   runningMinutes: 30 },
  { index: 6, presetCode: "rw_continuous_25", kind: "continuous", reps: null, repsMin: null, runMin: null, walkMin: null, continuousMin: 25, labelRu: "25 мин лёгкого непрерывного бега", totalMinutes: 25, runningMinutes: 25 },
  { index: 7, presetCode: "rw_continuous_30", kind: "continuous", reps: null, repsMin: null, runMin: null, walkMin: null, continuousMin: 30, labelRu: "30 мин лёгкого непрерывного бега", totalMinutes: 30, runningMinutes: 30 },
];

export const FIRST_STEP = BEGINNER_LADDER[0].index;
export const LAST_STEP = BEGINNER_LADDER[BEGINNER_LADDER.length - 1].index;

export function stepByIndex(index: number): BeginnerStep {
  const step = BEGINNER_LADDER.find((candidate) => candidate.index === index);
  if (!step) throw new Error(`Ступени ${index} в лестнице новичка нет (есть 1…${LAST_STEP})`);
  return step;
}

/**
 * RPE НА СЕССИИ ШАГ-БЕГ: цель 2, потолок 4 [решение тренера 26.08.2026].
 *
 * Перенесённые каталожные пресеты стояли на 4/5 — это выше, чем методика
 * разрешает новичку, и совпадало с верхней границей «обычно стоит повторить».
 * То есть сессия по замыслу назначалась сразу на уровне, с которого прогрессии
 * не бывает.
 */
export const BEGINNER_RPE_TARGET = 2;
export const BEGINNER_RPE_CAP = 4;

/**
 * ПРАВИЛА ПЕРЕХОДА ПО RPE — методические, из v1, дословно по смыслу:
 *   RPE 2-3 — можно прогрессировать
 *   RPE 3-4 — прогрессировать только аккуратно
 *   RPE 4-5 — обычно стоит повторить похожую нагрузку
 *   RPE > 5 — повторить или упростить
 *   любая боль блокирует прогрессию
 *
 * Полосы в источнике ПЕРЕКРЫВАЮТСЯ на целых числах (3 попадает и в «2-3», и в
 * «3-4»). Для машины это недопустимо, поэтому границы закрыты сверху: 3 → можно,
 * 4 → аккуратно, 5 → повторить. Это единственное место, где мы дописали за
 * методику, и дописали в сторону осторожности.
 */
export type RpeBand = "may_progress" | "careful" | "repeat" | "simplify";

export function rpeBand(rpe: number): RpeBand {
  if (rpe <= 3) return "may_progress";
  if (rpe <= 4) return "careful";
  if (rpe <= 5) return "repeat";
  return "simplify";
}

/** Обратная связь по одной сессии. Свежие — первыми. */
export type SessionFeedback = {
  date: string;
  /** null — человек не ответил. Отсутствие ответа не равно «всё хорошо». */
  rpe: number | null;
  pain: boolean;
};

export type ProgressionAction = "progress" | "repeat" | "step_back" | "hold_for_coach";

export type ProgressionDecision = {
  action: ProgressionAction;
  /** Ступень, на которой человек окажется после решения. */
  nextStep: number;
  reason: string;
};

/**
 * Решение о следующей ступени. Чистая функция от состояния и обратной связи —
 * НЕ от номера недели: прогрессия управляется тем, как человек перенёс работу,
 * а календарь к этому отношения не имеет.
 */
export function decideNextStep(input: {
  currentStep: number;
  sessionsAtStep: number;
  /** Обратная связь, свежая первой. */
  recent: SessionFeedback[];
}): ProgressionDecision {
  const { currentStep, sessionsAtStep, recent } = input;
  const last = recent[0];

  if (!last) {
    return { action: "repeat", nextStep: currentStep, reason: "сессий на ступени ещё не было" };
  }

  // БОЛЬ ВЫШЕ ВСЕГО. Не «понизить ступень», а остановиться и позвать тренера:
  // отличить крепатуру от травмы по одному флагу нельзя, и решать это должен
  // человек, а не таблица.
  if (last.pain) {
    return {
      action: "hold_for_coach",
      nextStep: currentStep,
      reason: "боль или выраженный дискомфорт — прогрессия заблокирована, нужен тренер",
    };
  }

  if (last.rpe === null) {
    return {
      action: "repeat",
      nextStep: currentStep,
      reason: "нет обратной связи по последней сессии — не двигаемся вслепую",
    };
  }

  const band = rpeBand(last.rpe);

  if (band === "simplify") {
    const previous = recent[1];
    // Два тяжёлых подряд — это не случайность, а слишком высокая ступень.
    if (previous && previous.rpe !== null && rpeBand(previous.rpe) === "simplify") {
      return {
        action: "step_back",
        nextStep: Math.max(FIRST_STEP, currentStep - 1),
        reason: `RPE ${last.rpe} второй раз подряд — возвращаемся на предыдущую безопасную ступень`,
      };
    }
    return { action: "repeat", nextStep: currentStep, reason: `RPE ${last.rpe} — повторяем ступень` };
  }

  if (band === "repeat") {
    return { action: "repeat", nextStep: currentStep, reason: `RPE ${last.rpe} — повторяем похожую нагрузку` };
  }

  if (currentStep >= LAST_STEP) {
    return {
      action: "repeat",
      nextStep: currentStep,
      reason: "последняя ступень лестницы — дальше человек выходит из методики новичка",
    };
  }

  const needed = band === "careful" ? MIN_SESSIONS_PER_STEP + CAREFUL_EXTRA_SESSIONS : MIN_SESSIONS_PER_STEP;
  if (sessionsAtStep < needed) {
    return {
      action: "repeat",
      nextStep: currentStep,
      reason:
        band === "careful"
          ? `RPE ${last.rpe} — прогрессируем аккуратно: нужно ${needed} сессии на ступени, отработано ${sessionsAtStep}`
          : `RPE ${last.rpe} — нужно ${needed} сессии на ступени, отработано ${sessionsAtStep}`,
    };
  }

  // Подтверждение не одной сессией: последние needed сессий обязаны быть без
  // боли и не тяжелее той полосы, которая разрешает движение.
  const window = recent.slice(0, needed);
  const allClean = window.every(
    (session) => !session.pain && session.rpe !== null && rpeBand(session.rpe) !== "repeat" && rpeBand(session.rpe) !== "simplify"
  );
  if (!allClean) {
    return {
      action: "repeat",
      nextStep: currentStep,
      reason: `последние ${needed} сессии подряд не подтвердили переносимость — повторяем`,
    };
  }

  return {
    action: "progress",
    nextStep: currentStep + 1,
    reason: `RPE ${last.rpe} на ${sessionsAtStep} сессиях подряд — переходим на ступень ${currentStep + 1}`,
  };
}

/**
 * ПРАВИЛО УЧЁТА ШАГ-БЕГА В НЕДЕЛЬНОМ ОБЪЁМЕ [решение 26.08.2026].
 *
 * В минутный конверт недели идут ТОЛЬКО МИНУТЫ БЕГА. Шаг — это отдых внутри
 * сессии, а не нагрузка, и считать его беговым объёмом значит завышать нагрузку
 * ровно у того, кто её хуже всех переносит.
 *
 * Решающий довод — монотонность. По ступеням 1…5 полная длительность сессии
 * идёт 30 → 35 → 32.5 → 30 → 36: она ПАДАЕТ там, где человек прогрессирует
 * (сокращение шага с 2 до 1 минуты укорачивает сессию, хотя работа растёт).
 * Минуты бега идут 20 → 25 → 25 → 25 → 30 и не врут ни разу.
 *
 * Переход 5 → 6 (шаг убирается, 30 минут бега становятся 25) объём СНИЖАЕТ, и
 * это правильно: непрерывный бег тяжелее той же минуты бега с паузами, поэтому
 * первая непрерывная сессия короче. Падение числа здесь — не регресс.
 */
export function envelopeMinutes(step: BeginnerStep): number {
  return step.runningMinutes;
}

/** Плановые беговые минуты недели на этой ступени. */
export function weeklyRunningMinutes(step: BeginnerStep, runsPerWeek: number): number {
  return envelopeMinutes(step) * runsPerWeek;
}

/**
 * ПЕРВАЯ ТРЕНИРОВКА — ДИАГНОСТИЧЕСКАЯ, а не обычная неделя [методика v1].
 *
 * Две ветки по тому, может ли человек бежать непрерывно. Обе — без темпа и без
 * пульса: у новичка нет ни порога, ни истории, и любая цифра здесь была бы
 * выдумана. Управление по ощущению — это не упрощение, а требование методики.
 */
export type DiagnosticSession = {
  titleRu: string;
  totalMinutes: number;
  runningMinutes: number;
  descriptionRu: string;
  presetCode: string;
};

export function diagnosticSession(canRunContinuously: boolean): DiagnosticSession {
  if (canRunContinuously) {
    return {
      titleRu: "Диагностический лёгкий бег",
      totalMinutes: 25,
      runningMinutes: 25,
      presetCode: "rw_continuous_25",
      descriptionRu:
        "Сегодня спокойно проверяем, как тело реагирует на очень лёгкую нагрузку. " +
        "20–25 минут непрерывного очень лёгкого бега: дыхание ровное, разговор возможен полными фразами. " +
        "Ни темпа, ни пульса не смотрим — только ощущения. " +
        "При боли или дискомфорте остановиться или перейти на шаг и сказать тренеру. " +
        "После пробежки оцените усилие по шкале 1–10 — от этой оценки зависит следующая тренировка.",
    };
  }
  const step = stepByIndex(1);
  return {
    titleRu: "Диагностический бег/шаг",
    totalMinutes: step.totalMinutes,
    runningMinutes: step.runningMinutes,
    presetCode: step.presetCode,
    descriptionRu:
      "Сегодня спокойно проверяем, как тело реагирует на очень лёгкую нагрузку в формате бег/шаг. " +
      "5 x (4 мин лёгкий бег + 2 мин шаг). Бег очень лёгкий: дыхание ровное, разговор возможен полными фразами. " +
      "Шаг — это отдых, идти спокойно, не торопясь. Ни темпа, ни пульса не смотрим — только ощущения. " +
      "При боли или дискомфорте остановиться или перейти на шаг и сказать тренеру. " +
      "После тренировки оцените усилие по шкале 1–10 — от этой оценки зависит следующая тренировка.",
  };
}

/** Текст обычной сессии ступени. Хранится рядом с лестницей, а не в каталоге-заглушке. */
export function stepDescriptionRu(step: BeginnerStep): string {
  const tail =
    "Ни темпа, ни пульса не смотрим — только ощущения: усилие 2–4 по шкале 1–10, " +
    "дыхание ровное, разговор возможен полными фразами. " +
    "При боли или дискомфорте остановиться или перейти на шаг и сказать тренеру. " +
    "После тренировки оцените усилие — от этой оценки зависит следующая ступень.";

  if (step.kind === "continuous") {
    return (
      `${step.continuousMin} минут непрерывного лёгкого бега, без переходов на шаг. ` +
      `Если стало тяжело — перейдите на шаг и отметьте это: значит, ступень взята рано. ${tail}`
    );
  }

  const repsText = step.repsMin && step.repsMin !== step.reps
    ? `${step.repsMin}–${step.reps}`
    : String(step.reps);
  const walkText = step.walkMin === 1.5 ? "1 мин 30 сек" : `${step.walkMin} мин`;
  return (
    `${repsText} повторов: ${step.runMin} мин лёгкого бега + ${walkText} шага. ` +
    `Шаг — это отдых, идти спокойно. ${tail}`
  );
}
