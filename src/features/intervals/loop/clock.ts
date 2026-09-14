/**
 * «Сегодня» для контура.
 *
 * ЗОНА УЧЕНИКА, А НЕ ТРЕНЕРА [решение 14.09.2026]. Весь контур крутится вокруг
 * дня: карточка на сегодня, перенос внутри недели, дата чек-ина. Тренер в
 * Белграде, ученики в основном нет.
 *
 * Цена ошибки не косметическая. Ученик из Москвы в 23:30 по своему времени
 * увидел бы ещё сегодняшний план вместо завтрашнего; ученик из Владивостока
 * утром — вчерашний. И тот и другой отметились бы ЧУЖИМ ДНЁМ, а прогрессия
 * двигается по дню: чек-ин лёг бы на другую сессию и на другую ступень.
 *
 * ЗОНА ОПРЕДЕЛЯЕТСЯ САМА. Мини-приложение отдаёт имя зоны из Intl браузера,
 * сервер его проверяет и запоминает на карточке. Спрашиваем только когда
 * определить не удалось: вопрос, на который машина знает ответ, — плохой
 * вопрос.
 */

/** Зона тренера. Запасной вариант, когда зона ученика неизвестна. */
export const COACH_TIMEZONE = "Europe/Belgrade";

/**
 * Настоящая ли это зона IANA.
 *
 * Проверяем ПОПЫТКОЙ ПРИМЕНИТЬ, а не списком: список пришлось бы обновлять, и
 * он молча устаревал бы. Intl бросает RangeError на неизвестной зоне, и это
 * единственный честный ответ на вопрос «понимает ли её эта среда».
 */
export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/** Зона ученика, если она известна и валидна; иначе зона тренера. */
export function resolveZone(timezone: string | null | undefined): string {
  return isValidTimeZone(timezone) ? timezone : COACH_TIMEZONE;
}

/** «Сегодня» в указанной зоне, YYYY-MM-DD. */
export function todayIsoInZone(timezone: string | null | undefined, now: Date = new Date()): string {
  // sv-SE даёт ISO-подобный YYYY-MM-DD без ручной сборки из частей.
  return new Intl.DateTimeFormat("sv-SE", { timeZone: resolveZone(timezone) }).format(now);
}

/** «Сегодня» глазами тренера. Для его собственных экранов и отчётов. */
export function todayIsoInCoachTimezone(now: Date = new Date()): string {
  return todayIsoInZone(COACH_TIMEZONE, now);
}

/** Местное время ученика, ЧЧ:ММ. Нужно, чтобы понимать, когда ждать чек-ин. */
export function localTimeInZone(timezone: string | null | undefined, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: resolveZone(timezone),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
}

/**
 * Насколько день ученика отличается от дня тренера: -1, 0 или +1.
 *
 * Нужно тренеру на экране: «у неё уже завтра» объясняет, почему её чек-ин
 * помечен днём, которого у тренера ещё не наступило.
 */
export function dayOffsetFromCoach(timezone: string | null | undefined, now: Date = new Date()): number {
  const theirs = todayIsoInZone(timezone, now);
  const ours = todayIsoInCoachTimezone(now);
  if (theirs === ours) return 0;
  return theirs > ours ? 1 : -1;
}

/**
 * Зоны на выбор, когда определить не удалось.
 *
 * Список КОРОТКИЙ и по делу: это запасной путь, а не справочник. Города, а не
 * смещения: «Europe/Moscow» переживёт перевод часов, «UTC+3» — нет.
 */
export const FALLBACK_TIMEZONES: Array<{ zone: string; labelRu: string }> = [
  { zone: "Europe/Moscow", labelRu: "Москва, Петербург" },
  { zone: "Europe/Kaliningrad", labelRu: "Калининград" },
  { zone: "Europe/Samara", labelRu: "Самара" },
  { zone: "Asia/Yekaterinburg", labelRu: "Екатеринбург" },
  { zone: "Asia/Omsk", labelRu: "Омск" },
  { zone: "Asia/Krasnoyarsk", labelRu: "Красноярск" },
  { zone: "Asia/Irkutsk", labelRu: "Иркутск" },
  { zone: "Asia/Vladivostok", labelRu: "Владивосток" },
  { zone: "Europe/Belgrade", labelRu: "Белград, Будва" },
  { zone: "Europe/Kyiv", labelRu: "Киев" },
  { zone: "Asia/Tbilisi", labelRu: "Тбилиси" },
  { zone: "Asia/Yerevan", labelRu: "Ереван" },
  { zone: "Asia/Almaty", labelRu: "Алматы" },
  { zone: "Asia/Dubai", labelRu: "Дубай" },
];
