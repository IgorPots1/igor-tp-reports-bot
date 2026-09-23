/**
 * Правка собственного чек-ина и окно, в котором тренировку ещё можно закрыть.
 *
 * ── ТРИ ДЫРЫ, КОТОРЫЕ ЭТОТ МОДУЛЬ ЗАКРЫВАЕТ [23.09.2026] ────────────────────
 *
 * 1. ОТМЕТИТЬСЯ МОЖНО БЫЛО РОВНО ОДИН РАЗ. Форма не открывалась второй раз
 *    (условие `openCheckin && !card.checkedIn`), и человек, ошибшийся в цифре
 *    или передумавший про боль, не мог поправить ничего. Решение тренера:
 *    верные данные важнее неизменяемой отметки.
 *
 * 2. ВЧЕРАШНЯЯ НЕОТМЕЧЕННАЯ ТРЕНИРОВКА ПРОПАДАЛА С ЭКРАНА. Выборки были
 *    строгие: `today === сегодня`, `upcoming > сегодня`. Всё прошлое исчезало,
 *    отмеченное и неотмеченное одинаково, и закрыть пропуск было нечем.
 *
 * 3. ЗАПИСЬ «ВНЕ ПЛАНА» НЕ ЗАКРЫВАЛА ПЛАНОВЫЙ ДЕНЬ. Человек мог ввести
 *    пробежку вчерашним числом, но она уходила с planSessionId = null, и
 *    плановая тренировка оставалась неотмеченной навсегда.
 *
 * ── ОКНО ────────────────────────────────────────────────────────────────────
 *
 * Одно и то же число на оба правила: сколько дней назад тренировка ещё видна и
 * сколько дней её можно править. Два разных окна означали бы карточку, которую
 * видно, но нельзя тронуть, — и это выглядело бы поломкой.
 *
 * ТРИ ДНЯ. Тренер просил «хотя бы в тот же день»; три — с запасом на реальную
 * жизнь: пробежала в пятницу, открыла приложение в воскресенье. Дальше это уже
 * не «забыла отметиться», а настоящий пропуск, и он идёт к тренеру сигналом,
 * а не тихой правкой задним числом.
 *
 * ЧИСТЫЕ ФУНКЦИИ, БЕЗ БАЗЫ И БЕЗ DOM: их гоняет check:checkin-edit.
 */

/** Сколько дней назад тренировка ещё видна ученице и ещё открыта для правки. */
export const OPEN_PAST_DAYS = 3;

const DAY_MS = 86_400_000;

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY_MS);
}

/**
 * Открыта ли тренировка: сегодняшняя или из ближайшего прошлого.
 *
 * БУДУЩЕЕ ЗАКРЫТО. Отметиться о тренировке, которой ещё не было, нельзя: это
 * не правка данных, а выдумка, и приложение не должно её предлагать.
 */
export function isSessionOpen(input: { sessionDate: string; todayIso: string }): boolean {
  const age = daysBetween(input.sessionDate, input.todayIso);
  return age >= 0 && age <= OPEN_PAST_DAYS;
}

export type CheckinSnapshot = {
  effortRpe: number | null;
  effortLabel: string | null;
  pain: boolean;
  commentText: string | null;
};

export type CheckinChange = "effort" | "pain" | "comment";

function sameText(a: string | null, b: string | null): boolean {
  return (a ?? "").trim() === (b ?? "").trim();
}

/**
 * Что изменилось между прошлым ответом и новым.
 *
 * ПУСТОЙ СПИСОК — ЭТО НЕ ПРАВКА. Человек мог открыть форму, ничего не тронуть и
 * отправить заново, или просто нажать дважды. Записывать такое как «передумал»
 * значит врать тренеру о разговоре, которого не было.
 *
 * УСИЛИЕ СРАВНИВАЕТСЯ ПО RPE, А НЕ ПО ПОДПИСИ: подписи у двух шкал разные, а
 * шкала у человека может смениться вместе с прогрессией.
 */
export function diffCheckin(before: CheckinSnapshot, after: CheckinSnapshot): CheckinChange[] {
  const changed: CheckinChange[] = [];
  if (before.effortRpe !== after.effortRpe) changed.push("effort");
  if (before.pain !== after.pain) changed.push("pain");
  if (!sameText(before.commentText, after.commentText)) changed.push("comment");
  return changed;
}

/**
 * Правка, которую тренер обязан увидеть, — про боль или усилие.
 *
 * Поправленная запятая в комментарии на карточку не выносится: она не меняет
 * ни одного решения, а заметность стоит дорого и тратится на то, что её стоит.
 */
export function editNeedsCoachEye(changed: CheckinChange[]): boolean {
  return changed.includes("pain") || changed.includes("effort");
}

export type CheckinEdit = {
  editedAt: string;
  changed: CheckinChange[];
  effortLabelBefore: string | null;
  effortLabelAfter: string | null;
  painBefore: boolean | null;
  painAfter: boolean | null;
};

const PAIN_RU = (value: boolean | null): string =>
  value === null ? "—" : value ? "что-то беспокоило" : "всё спокойно";

/** «усилие: было «Тяжело», стало «Нормально» · боль: было «что-то беспокоило», стало «всё спокойно»» */
export function describeEditRu(edit: CheckinEdit): string {
  const parts: string[] = [];
  if (edit.changed.includes("effort")) {
    parts.push(`усилие: было «${edit.effortLabelBefore ?? "—"}», стало «${edit.effortLabelAfter ?? "—"}»`);
  }
  if (edit.changed.includes("pain")) {
    parts.push(`боль: было «${PAIN_RU(edit.painBefore)}», стало «${PAIN_RU(edit.painAfter)}»`);
  }
  if (edit.changed.includes("comment")) {
    parts.push("комментарий переписан");
  }
  return parts.join(" · ");
}
