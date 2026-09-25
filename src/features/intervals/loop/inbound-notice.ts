/**
 * Когда сказать тренеру, что ученица написала.
 *
 * ── ЗАЧЕМ [23.09.2026] ──────────────────────────────────────────────────────
 *
 * Тренер отправил ученице три вопроса про боль в пятке. Она ответила через
 * восемь часов, в личку. Ответ лёг в базу наблюдений, привязался к её карточке
 * и был помечен как «про здоровье» с уверенностью 0.84 — и ПРОЛЕЖАЛ ДВА ДНЯ,
 * потому что никто об этом не сказал, а в карточке Intervals переписки не
 * видно. Тренер узнал, только когда попросил свести всё по ученице вручную.
 *
 * ── ПОЧЕМУ РЕШЕНИЕ ЖИВЁТ ОТДЕЛЬНО ОТ ОТПРАВКИ ───────────────────────────────
 *
 * Звать его будут из двух мест: из обработчика входящего сообщения (сразу) и
 * из раннера напоминаний (то, что отложили на ночь). Правило должно быть одно
 * и проверяемое без телеграма и базы.
 *
 * ── ТРИ ИСХОДА, И «ПОТОМ» НЕ РАВНО «НИКОГДА» ────────────────────────────────
 *
 * `send` — сказать сейчас.
 * `defer` — тихие часы: ночью тренер не работает, а сообщение не теряется,
 *           его заберёт раннер утром.
 * `skip`  — только что говорили: очередь сообщений подряд это один разговор,
 *           а не пять поводов звякнуть.
 *
 * ЧИСТЫЕ ФУНКЦИИ: их гоняет check:inbound-notice.
 */

/** Не звякаем чаще, чем раз в это время: подряд идущие сообщения — один разговор. */
export const NOTICE_COOLDOWN_MIN = 20;

/** Тихие часы тренера, по его зоне. С 23:00 до 08:00 сообщения ждут утра. */
export const QUIET_FROM_HOUR = 23;
export const QUIET_UNTIL_HOUR = 8;

export type InboundNoticeDecision =
  | { kind: "send" }
  | { kind: "defer"; reason: string }
  | { kind: "skip"; reason: string };

export function isQuietHour(coachHour: number): boolean {
  return coachHour >= QUIET_FROM_HOUR || coachHour < QUIET_UNTIL_HOUR;
}

export function decideInboundNotice(input: {
  /** Час у тренера, 0–23. */
  coachHour: number;
  /** Когда звякали в прошлый раз по этому ученику. null — ни разу. */
  lastNotifiedAt: string | null;
  /** Сейчас, ISO. */
  nowIso: string;
}): InboundNoticeDecision {
  const now = Date.parse(input.nowIso);

  /**
   * ОСТЫВАНИЕ ПРОВЕРЯЕТСЯ ПЕРВЫМ, ДО ТИХИХ ЧАСОВ. Иначе три сообщения подряд в
   * полночь превратились бы в три отложенных, и утром тренер получил бы очередь
   * из одинаковых звонков про один разговор.
   */
  if (input.lastNotifiedAt) {
    const sinceMin = (now - Date.parse(input.lastNotifiedAt)) / 60_000;
    if (sinceMin < NOTICE_COOLDOWN_MIN) {
      return { kind: "skip", reason: `звякали ${Math.round(sinceMin)} мин назад` };
    }
  }

  if (isQuietHour(input.coachHour)) {
    return { kind: "defer", reason: `тихие часы (${input.coachHour}:00)` };
  }

  return { kind: "send" };
}

/**
 * Текст тренеру. Коротко и с именем: он читает это с телефона между делами, и
 * ему нужно понять, к кому идти, не открывая ничего.
 *
 * САМО СООБЩЕНИЕ НЕ ПЕРЕСКАЗЫВАЕМ ЦЕЛИКОМ. Во-первых, оно может быть длинным;
 * во-вторых, отвечать всё равно надо глядя на карточку, где рядом план и
 * отметки. Даём первую строку, чтобы понять срочность, и зовём в карточку.
 */
export function inboundNoticeTextRu(input: {
  studentName: string;
  preview: string | null;
  /** Сколько сообщений накопилось с прошлого раза. 1 — обычный случай. */
  count: number;
  /** Пролежало с ночи: скажем об этом прямо, чтобы не выглядело как «только что». */
  deferred: boolean;
}): string {
  const head = input.count > 1
    ? `${input.studentName} написала (${input.count} сообщения)`
    : `${input.studentName} написала`;
  const when = input.deferred ? " ночью" : "";
  const body = input.preview ? `\n\n«${input.preview.slice(0, 200)}»` : "";
  return `${head}${when}.${body}`;
}
