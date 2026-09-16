/**
 * «Подключено, а данных нет».
 *
 * САМЫЙ ОПАСНЫЙ ОТКАЗ ВО ВСЁМ КОНТУРЕ, потому что он не выглядит отказом.
 * В Intervals галочки скачивания снимаются и отмечаются отдельно; не отметив
 * нужную, человек всё равно проходит авторизацию и видит «часы подключены».
 * Дальше он бегает, отмечается в чек-ине, а тренер смотрит на пустой календарь
 * и читает его как «не бегает». Оба уверены, что всё в порядке.
 *
 * ПРИЗНАК СОБИРАЕТСЯ ИЗ ДВУХ ИСТОЧНИКОВ, И В ЭТОМ ВСЯ СУТЬ. Ни один по
 * отдельности ничего не доказывает: «нет тренировок» бывает у того, кто
 * действительно не бегал, а чек-ин без активности бывает у того, кто забыл часы.
 * Вместе они означают ровно одно: человек бегает, а данные не идут.
 *
 * Отдельно от auth_failed_at: там доступ ОТОЗВАН и провайдер отвечает 401.
 * Здесь доступ рабочий, запросы проходят, просто отдавать провайдеру нечего.
 *
 * РУЧНОЙ ВВОД СЮДА НЕ ПОПАДАЕТ ВООБЩЕ [16.09.2026]. У auth_method='manual'
 * нет ни подключения, которое может отвалиться, ни провайдера, который может
 * не отдать данные: человек сам решает, когда и что записать, и «молчание»
 * для него означает «не бегала», а не поломку. Проверка выходит РАНЬШЕ
 * is_active/authFailedAt намеренно: у ручного источника оба этих поля
 * технически «в порядке» (is_active=true, отказов нет), и без явного
 * короткого замыкания сигнал прошёл бы дальше по случайности значений, а не
 * по смыслу.
 */

export type ConnectionHealth =
  | { state: "ok" }
  | { state: "manual" }
  | { state: "not_connected" }
  | { state: "auth_revoked"; sinceIso: string }
  | {
      state: "connected_but_silent";
      /** Сколько суток подряд нет ни одной активности. */
      silentDays: number;
      /** Чек-ины, которыми человек подтвердил, что бегал. */
      checkinDates: string[];
      messageRu: string;
    };

/** Сколько суток молчания считаем поводом для тревоги. Двое, как в наряде. */
export const SILENT_DAYS_THRESHOLD = 2;

export type ConnectionHealthInput = {
  todayIso: string;
  /** null — источника нет вовсе. */
  connection: {
    connectedAtIso: string | null;
    authFailedAtIso: string | null;
    isActive: boolean;
    /** 'manual' выключает весь дальнейший разбор, см. комментарий выше. */
    authMethod?: string | null;
  } | null;
  /** Даты активностей, приехавших из Intervals (любые, не только беговые). */
  activityDates: string[];
  /** Даты чек-инов, в которых человек отметил, что тренировался. */
  checkinDates: string[];
};

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round(
    (Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000
  );
}

export function assessConnectionHealth(input: ConnectionHealthInput): ConnectionHealth {
  const { connection } = input;
  if (connection?.authMethod === "manual") return { state: "manual" };
  if (!connection || !connection.isActive) return { state: "not_connected" };
  if (connection.authFailedAtIso) {
    return { state: "auth_revoked", sinceIso: connection.authFailedAtIso.slice(0, 10) };
  }

  // ОКНО СЧИТАЕТСЯ ОТ ПОДКЛЮЧЕНИЯ, А НЕ ОТ СЕГОДНЯ. Человека, подключившегося
  // час назад, не в чем обвинять: данных ещё не должно быть. Тревога имеет
  // смысл только после того, как прошло достаточно времени.
  const connectedAt = connection.connectedAtIso ? connection.connectedAtIso.slice(0, 10) : null;
  if (!connectedAt) return { state: "ok" };
  const sinceConnect = daysBetween(connectedAt, input.todayIso);
  if (sinceConnect < SILENT_DAYS_THRESHOLD) return { state: "ok" };

  const windowStart = new Date(
    Date.parse(`${input.todayIso}T00:00:00Z`) - (SILENT_DAYS_THRESHOLD - 1) * 86_400_000
  )
    .toISOString()
    .slice(0, 10);

  // Активности считаем по окну, но не раньше подключения: тренировки, приехавшие
  // до подключения, к вопросу «идут ли данные сейчас» отношения не имеют.
  const from = windowStart > connectedAt ? windowStart : connectedAt;
  const activitiesInWindow = input.activityDates.filter((date) => date >= from && date <= input.todayIso);
  if (activitiesInWindow.length > 0) return { state: "ok" };

  const confirmedRuns = input.checkinDates
    .filter((date) => date >= from && date <= input.todayIso)
    .sort();
  if (confirmedRuns.length === 0) {
    // Тренировок нет и человек ничего не отмечал. Это «не бегал», а не поломка,
    // и объявлять поломку здесь значило бы кричать на каждого, кто взял паузу.
    return { state: "ok" };
  }

  const silentDays = daysBetween(from, input.todayIso) + 1;
  return {
    state: "connected_but_silent",
    silentDays,
    checkinDates: confirmedRuns,
    messageRu:
      `Часы подключены, доступ рабочий, но за ${silentDays} ${silentDays === 1 ? "сутки" : "суток"} ` +
      `не приехало ни одной тренировки, а человек отметился ${confirmedRuns.length} ` +
      `${confirmedRuns.length === 1 ? "раз" : "раза"} (${confirmedRuns.join(", ")}). ` +
      "Почти наверняка в Intervals не отмечена галочка скачивания тренировок: " +
      "подключение при этом выглядит успешным.",
  };
}
