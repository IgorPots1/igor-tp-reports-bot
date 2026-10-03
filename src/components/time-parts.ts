/* Разбор и сборка времени по трём полям: часы, минуты, секунды.
 *
 * Отдельным модулем от TimeFields.tsx, а не рядом с ним: компонент клиентский и
 * тянет css-модуль, а эти функции должен уметь прогнать обычный чек в node.
 */

export type TimeParts = { h: string; m: string; s: string };

export const EMPTY_TIME: TimeParts = { h: "", m: "", s: "" };

/** «50:00» → {h:"", m:"50", s:"00"}; «4:00:00» → {h:"4", m:"00", s:"00"}. */
export function splitTime(raw: string): TimeParts {
  const parts = (raw || "").trim().split(":");
  if (parts.length === 3) return { h: parts[0], m: parts[1], s: parts[2] };
  if (parts.length === 2) return { h: "", m: parts[0], s: parts[1] };
  return EMPTY_TIME;
}

/**
 * Обратно в строку, которую понимает parseTime инструмента.
 *
 * Пустые поля дают пустую строку, а не «0:00»: ноль это ответ, а пусто это
 * «не заполнил», и на /tools/marathon разница между ними решает, показывать
 * прогноз или нет.
 *
 * НИЧЕГО НЕ ДОБИВАЕТСЯ НУЛЯМИ, и это не косметика. /tools/raskladka гоняет
 * значение через строку на каждом нажатии: поля читаются из splitTime(target),
 * а onChange пишет обратно joinTime. Пока минуты дополнялись до двух знаков,
 * набранная «4» мгновенно превращалась в «04», занимала оба знака, и вторая
 * цифра уже не влезала — вместо 3:45:00 получалось 3:04:00. Для parseTime
 * ведущие нули всё равно ничего не значат.
 */
export function joinTime({ h, m, s }: TimeParts): string {
  if (!h && !m && !s) return "";
  const mm = m || "0";
  const ss = s || "0";
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
