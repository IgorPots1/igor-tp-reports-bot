/**
 * Настройка графика: то единственное, чего генератор не берёт из данных, а
 * тренер не знает про человека заранее.
 *
 * ЧТО ЗДЕСЬ НЕ СПРАШИВАЕТСЯ И ПОЧЕМУ. Опыт, травмы, история бега, объём со
 * слов, «может ли бежать непрерывно» — всё это живёт в развёрнутой анкете ДО
 * приложения (интенсив или форма тренера) и закрывается предзаполнением.
 * Спрашивать это второй раз значит просить человека пересказать то, что тренер
 * уже прочитал, и получить пересказ хуже оригинала.
 */

export type WeekStability = "stable" | "varies";
export type TimeOfDay = "morning" | "evening" | "varies";

export const WEEK_STABILITY_OPTIONS: Array<{ code: WeekStability; labelRu: string; hintRu: string }> = [
  {
    code: "stable",
    labelRu: "Примерно одинаковая",
    hintRu: "свободные дни из недели в неделю одни и те же",
  },
  {
    code: "varies",
    labelRu: "Каждую неделю по-разному",
    hintRu: "сменный график, командировки, дети",
  },
];

export const TIME_OF_DAY_OPTIONS: Array<{ code: TimeOfDay; labelRu: string; hintRu: string }> = [
  { code: "morning", labelRu: "Утром", hintRu: "до работы или сразу после подъёма" },
  { code: "evening", labelRu: "Вечером", hintRu: "после работы" },
  { code: "varies", labelRu: "Когда получится", hintRu: "по-разному" },
];

/**
 * Варианты покрытия СОВПАДАЮТ со значениями анкеты интенсива (surfaces), чтобы
 * ответ выпускника переносился предзаполнением без перевода. «Набережная»
 * добавлена: в интенсиве её нет, а вопрос про неё задают чаще всего.
 */
export const SURFACE_OPTIONS = [
  "Улица / парк",
  "Набережная",
  "Стадион",
  "Дорожка",
  "Манеж",
] as const;

/**
 * Сколько времени человек реально может выделить на ОДНУ тренировку.
 *
 * ХРАНИМ ЧИСЛО, А НЕ ДИАПАЗОН. «45–60» читается человеком, но сравнивать с ним
 * нельзя; потолок обязан быть числом, иначе каждый читатель будет разбирать
 * строку по-своему. Берём ВЕРХНЮЮ границу диапазона: человек сказал, сколько у
 * него есть, а не сколько он хочет бежать.
 *
 * Последний вариант без потолка: тот, у кого есть полтора часа и больше, не
 * ограничен ничем, кроме методики, и выдуманное число здесь только мешало бы.
 */
export const SESSION_CAP_OPTIONS: Array<{ code: string; labelRu: string; minutes: number | null }> = [
  { code: "u30", labelRu: "До 30 минут", minutes: 30 },
  { code: "u45", labelRu: "30–45 минут", minutes: 45 },
  { code: "u60", labelRu: "45–60 минут", minutes: 60 },
  { code: "u90", labelRu: "60–90 минут", minutes: 90 },
  { code: "free", labelRu: "Больше 90 минут", minutes: null },
];

export function sessionCapByCode(code: string): number | null | undefined {
  const found = SESSION_CAP_OPTIONS.find((o) => o.code === code);
  return found ? found.minutes : undefined;
}

/**
 * Потолок сессии → пожелания, которые понимает сборщик недели.
 *
 * ВТОРОГО МЕХАНИЗМА НЕ ЗАВОДИМ. У сборщика уже есть day_max_minutes: потолок
 * минут в конкретный день, обкатанный на ростере TP. Потолок «на любую
 * тренировку» — это он же, выставленный на все семь дней. Своя ветка резки
 * означала бы два места, которые разойдутся.
 */
export function sessionCapPreferences(
  maxSessionMinutes: number | null
): Array<{ kind: "day_max_minutes"; dayOfWeek: number; maxMinutes: number; reason: string }> {
  if (maxSessionMinutes === null) return [];
  return [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
    kind: "day_max_minutes" as const,
    dayOfWeek,
    maxMinutes: maxSessionMinutes,
    reason: "анкета: сколько времени есть на тренировку",
  }));
}

/** Состояние дня: сказали «свободен», сказали «занят» или не уточняли. */
export type DayState = "free" | "busy" | "unset";

export function dayState(
  day: number,
  available: number[],
  unavailable: number[]
): DayState {
  if (unavailable.includes(day)) return "busy";
  if (available.includes(day)) return "free";
  return "unset";
}

export type DerivedDays =
  | { ok: true; daysPerWeek: number; source: "coach" | "derived"; reasonRu: string }
  | { ok: false; messageRu: string };

/**
 * Сколько беговых дней в неделе.
 *
 * ФОРМА БОЛЬШЕ НЕ СПРАШИВАЕТ ЧИСЛО. Человек называет конкретные дни, а не
 * количество: «сколько раз в неделю готовы бегать» — вопрос к тренеру, а не к
 * человеку, который ещё не начал. Поэтому число либо задал тренер, либо
 * выводится здесь, и тренер видит, что именно перед ним.
 *
 * Правило вывода:
 *   · тренер задал — берём его, спорить не с чем;
 *   · неделя плавающая — три дня. Не средневзвешенное: у плавающей недели
 *     «свободных дней» нет как факта, а три беговых с запасом на переносы
 *     переживают срыв любого одного;
 *   · неделя стабильная — столько, сколько свободных дней названо, но не выше
 *     потолка. У новичка потолок методики жёсткий (три), у остальных пять:
 *     шестой и седьмой беговой день — это решение тренера, а не следствие
 *     того, что человек свободен.
 */
export function deriveDaysPerWeek(input: {
  coachSetDays: number | null;
  weekStability: WeekStability | null;
  availableWeekdays: number[];
  isBeginner: boolean;
}): DerivedDays {
  const cap = input.isBeginner ? 3 : 5;

  if (input.coachSetDays !== null) {
    if (input.isBeginner && input.coachSetDays > 3) {
      return {
        ok: false,
        messageRu:
          "Тренер поставил больше трёх беговых дней при программе новичка. Напишите ему, он поправит.",
      };
    }
    return {
      ok: true,
      daysPerWeek: input.coachSetDays,
      source: "coach",
      reasonRu: "задал тренер",
    };
  }

  if (input.weekStability === "varies") {
    return {
      ok: true,
      daysPerWeek: Math.min(3, cap),
      source: "derived",
      reasonRu: "неделя плавающая: три тренировки с запасом на переносы",
    };
  }

  const free = new Set(input.availableWeekdays).size;
  if (free < 2) {
    return {
      ok: false,
      messageRu:
        "Отметьте хотя бы два дня, когда точно можете бегать. На одном дне в неделю план не строится.",
    };
  }
  const days = Math.min(free, cap);
  return {
    ok: true,
    daysPerWeek: days,
    source: "derived",
    reasonRu:
      days < free
        ? `свободных дней ${free}, берём ${days} (потолок ${input.isBeginner ? "методики новичка" : "без решения тренера"})`
        : `по числу свободных дней (${free})`,
  };
}

/**
 * Проверка согласованности дней.
 *
 * Один и тот же день не может быть одновременно свободным и занятым. Форма
 * такого не допускает, но запрос приходит от клиента, и верить ему нельзя.
 */
export function conflictingDays(available: number[], unavailable: number[]): number[] {
  const busy = new Set(unavailable);
  return [...new Set(available)].filter((day) => busy.has(day));
}

const DAY_NAMES_RU = [
  "понедельник",
  "вторник",
  "среда",
  "четверг",
  "пятница",
  "суббота",
  "воскресенье",
];

export function dayNameRu(day: number): string {
  return DAY_NAMES_RU[day] ?? String(day);
}
