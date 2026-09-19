/**
 * Разбор того, что человек РЕАЛЬНО вводит в форму отчёта.
 *
 * ПОЧЕМУ ЭТО ОТДЕЛЬНЫЙ МОДУЛЬ. Живой случай 19.09.2026: ученица написала в поле
 * темпа «812», имея в виду 8:12, и объяснила почему — «в темпе кроме цифр
 * ничего не ввести». Поле стояло с inputMode="numeric", то есть клавиатура
 * показывала только цифры, а проверка требовала двоеточие. Отправить отчёт было
 * НЕВОЗМОЖНО в принципе, и человек этого не понимал: подсказка про формат
 * висела внизу формы, далеко от поля.
 *
 * ПРАВИЛО, КОТОРОЕ ИЗ ЭТОГО СЛЕДУЕТ: не отвергать, а разбирать. Запятая вместо
 * точки, время как 1:05 и как 65, темп как 8:12, 812, 8.12 и 8,12 — всё это
 * один и тот же человек, который честно пытается ответить. Угадывать формат
 * должна программа.
 *
 * ЧИСТЫЕ ФУНКЦИИ, БЕЗ DOM И БЕЗ СЕТИ: их гоняет check:manual-entry-parse.
 */

export type ParseResult =
  | { ok: true; value: number | null }
  | { ok: false; errorRu: string };

const OK_EMPTY: ParseResult = { ok: true, value: null };

/** Убрать пробелы (в том числе неразрывные) и заменить запятую на точку. */
function normalize(raw: string): string {
  return raw.replace(/[\s ]/gu, "").replace(",", ".");
}

/**
 * Время тренировки: «65», «65мин», «1:05», «1.05» (час с четвертью не бывает
 * «1.05» — это час пять, см. ниже), «1ч05».
 *
 * ПОЧЕМУ «105» — ЭТО СТО ПЯТЬ МИНУТ, А НЕ ЧАС ПЯТЬ. Полтора часа бега —
 * обычное дело, и трогать голое число нельзя: 105 минут человек имел в виду
 * ровно 105 минут. Час с минутами он напишет через разделитель.
 */
export function parseDurationMinutes(raw: string): ParseResult {
  const text = normalize(raw).replace(/(мин|минут|м|ч|час|часа|часов)$/iu, "");
  if (!text) return OK_EMPTY;

  const withSeparator = text.match(/^(\d{1,2})[:.чh](\d{1,2})$/iu);
  if (withSeparator) {
    const hours = Number(withSeparator[1]);
    const minutes = Number(withSeparator[2]);
    if (minutes > 59) {
      return { ok: false, errorRu: `В «${raw.trim()}» минут больше 59. Час двадцать пишите 1:20.` };
    }
    const total = hours * 60 + minutes;
    if (total < 1 || total > 600) {
      return { ok: false, errorRu: `${total} минут — это точно так? Ждём от 1 минуты до 10 часов.` };
    }
    return { ok: true, value: total };
  }

  if (/^\d{1,3}$/u.test(text)) {
    const total = Number(text);
    if (total < 1 || total > 600) {
      return { ok: false, errorRu: `${total} минут — это точно так? Ждём от 1 минуты до 10 часов.` };
    }
    return { ok: true, value: total };
  }

  return {
    ok: false,
    errorRu: `Не понял «${raw.trim()}». Напишите минуты числом, например 40. Час пять — 1:05 или 65.`,
  };
}

/** Дистанция: «6.5», «6,5», «6», «6.5км». Запятая — обычный русский разделитель. */
export function parseDistanceKm(raw: string): ParseResult {
  const text = normalize(raw).replace(/(км|km)$/iu, "");
  if (!text) return OK_EMPTY;
  if (!/^\d{1,3}(\.\d{1,3})?$/u.test(text)) {
    return { ok: false, errorRu: `Не понял «${raw.trim()}». Напишите километры числом, например 6.5 или 6,5.` };
  }
  const km = Number(text);
  if (km <= 0 || km > 300) {
    return { ok: false, errorRu: `${km} км — это точно так? Ждём от 0 до 300.` };
  }
  return { ok: true, value: km };
}

/** Средний пульс: просто число. */
export function parseHeartrate(raw: string): ParseResult {
  const text = normalize(raw).replace(/(уд|bpm)$/iu, "");
  if (!text) return OK_EMPTY;
  if (!/^\d{2,3}$/u.test(text)) {
    return { ok: false, errorRu: `Не понял «${raw.trim()}». Пульс — число, например 148.` };
  }
  const hr = Number(text);
  if (hr < 60 || hr > 230) {
    return { ok: false, errorRu: `Пульс ${hr} — это точно так? Ждём от 60 до 230.` };
  }
  return { ok: true, value: hr };
}

/**
 * Средний темп → секунды на километр.
 *
 * ПРИНИМАЕМ ЧЕТЫРЕ ЗАПИСИ ОДНОГО И ТОГО ЖЕ: «8:12», «812», «8.12», «8,12».
 * Голые цифры — главный случай: на числовой клавиатуре двоеточия просто нет.
 * Последние две цифры — всегда секунды, остальное — минуты.
 *
 * «8» без секунд читаем как 8:00: человек, написавший одну цифру, имел в виду
 * ровно минуты, и отказывать ему не за что.
 */
export function parsePaceSecPerKm(raw: string): ParseResult {
  const text = normalize(raw).replace(/(\/км|\/km|мин\/км)$/iu, "");
  if (!text) return OK_EMPTY;

  let minutes: number | null = null;
  let seconds: number | null = null;

  const separated = text.match(/^(\d{1,2})[:.](\d{1,2})$/u);
  const digitsOnly = text.match(/^(\d{1,2})(\d{2})$/u);
  const single = text.match(/^(\d{1,2})$/u);

  if (separated) {
    minutes = Number(separated[1]);
    seconds = Number(separated[2].padEnd(2, "0"));
  } else if (digitsOnly) {
    minutes = Number(digitsOnly[1]);
    seconds = Number(digitsOnly[2]);
  } else if (single) {
    minutes = Number(single[1]);
    seconds = 0;
  } else {
    return {
      ok: false,
      errorRu: `Не понял «${raw.trim()}». Темп можно написать как 8:12, 812 или 8.12 — как удобно.`,
    };
  }

  if (seconds > 59) {
    return { ok: false, errorRu: `В «${raw.trim()}» секунд больше 59. Восемь двенадцать — это 8:12 или 812.` };
  }
  const total = minutes * 60 + seconds;
  if (total < 120 || total > 900) {
    return { ok: false, errorRu: `Темп ${minutes}:${String(seconds).padStart(2, "0")} — это точно так? Ждём от 2:00 до 15:00 на километр.` };
  }
  return { ok: true, value: total };
}

/** Для показа разобранного значения обратно человеку: 492 → «8:12». */
export function paceTextRu(secPerKm: number): string {
  return `${Math.floor(secPerKm / 60)}:${String(Math.round(secPerKm % 60)).padStart(2, "0")}`;
}

/** Для показа разобранного времени: 65 → «1 ч 05 мин». */
export function durationTextRu(minutes: number): string {
  if (minutes < 60) return `${minutes} мин`;
  return `${Math.floor(minutes / 60)} ч ${String(minutes % 60).padStart(2, "0")} мин`;
}
