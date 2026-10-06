/**
 * Пауза ученика: отрезок, когда с него ничего не спрашивают.
 *
 * ── ЗАЧЕМ [06.10.2026] ──────────────────────────────────────────────────────
 *
 * 01.10 ученица написала тренеру: «Неважно себя чувствую, насморк + болит мышца
 * после бега. Приостановите, пожалуйста, бота по тренировкам.» Тренер ответил
 * «выздоравливайте». Приостановить было НЕЧЕМ, и на третий день болезни ей ушло
 * напоминание missed_nudge — «вы пропустили тренировку».
 *
 * Человек попросил прямо, тренер согласился, система сделала наоборот. Это
 * хуже, чем отсутствие функции: обещание было дано и нарушено.
 *
 * ── ЧТО ПАУЗА ДЕЛАЕТ ────────────────────────────────────────────────────────
 *
 * Молчат напоминания. Пропущенные в эти дни тренировки не показываются ученице
 * укором «не отмечено». Тренер видит на карточке, что человек на паузе и почему.
 *
 * ── ЧЕГО ПАУЗА НЕ ДЕЛАЕТ ────────────────────────────────────────────────────
 *
 * Не удаляет тренировки из плана и не сдвигает цикл. Удалить значило бы
 * потерять то, что тренер уже собрал, а сдвиг календаря на болезнь — отдельное
 * решение, которое принимает тренер, глядя на человека, а не арифметика.
 *
 * Не мешает ученице отметиться самой. Если она в паузу всё-таки пробежала и
 * хочет записать — записывает; пауза снимает ТРЕБОВАНИЕ, а не возможность.
 *
 * ── ГРАНИЦЫ ВКЛЮЧИТЕЛЬНО ────────────────────────────────────────────────────
 *
 * «С первого по пятое» для человека значит, что и первое, и пятое внутри.
 * Любая другая арифметика здесь даёт ошибку на один день в обе стороны.
 *
 * ЧИСТЫЕ ФУНКЦИИ, БЕЗ БАЗЫ: их гоняет check:pause.
 */

export type Pause = {
  id: string;
  /** Местная дата ученика, включительно. */
  startedOn: string;
  /** Включительно. null — пауза идёт. */
  endedOn: string | null;
  reason: string;
};

/** Пауза, накрывающая этот день. null — день свободен. */
export function pauseCovering(dateIso: string, pauses: Pause[]): Pause | null {
  for (const pause of pauses) {
    if (dateIso < pause.startedOn) continue;
    if (pause.endedOn !== null && dateIso > pause.endedOn) continue;
    return pause;
  }
  return null;
}

export function isPausedOn(dateIso: string, pauses: Pause[]): boolean {
  return pauseCovering(dateIso, pauses) !== null;
}

/**
 * Открытая пауза, если есть. Их не бывает двух: это держит частичный уникальный
 * индекс в базе, а не аккуратность кода.
 */
export function openPause(pauses: Pause[]): Pause | null {
  return pauses.find((pause) => pause.endedOn === null) ?? null;
}

const RU_MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

function dayRu(iso: string): string {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match) return iso;
  return `${Number.parseInt(match[3], 10)} ${RU_MONTHS[Number.parseInt(match[2], 10) - 1] ?? ""}`;
}

/**
 * Словами для карточки тренера.
 *
 * ЧИСЛО ДНЕЙ НАЗЫВАЕМ ВСЛУХ: «на паузе с 1 октября» не отвечает на вопрос, с
 * которым тренер смотрит на карточку, — сколько человек уже не бегает.
 */
export function pauseLabelRu(pause: Pause, todayIso: string): string {
  if (pause.endedOn === null) {
    const days = daysInclusive(pause.startedOn, todayIso);
    return `На паузе с ${dayRu(pause.startedOn)}, уже ${days} ${plural(days, "день", "дня", "дней")}: ${pause.reason}`;
  }
  const days = daysInclusive(pause.startedOn, pause.endedOn);
  return `Пауза с ${dayRu(pause.startedOn)} по ${dayRu(pause.endedOn)}, ${days} ${plural(days, "день", "дня", "дней")}: ${pause.reason}`;
}

export function daysInclusive(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return 0;
  return Math.round((to - from) / 86_400_000) + 1;
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = n % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
