/**
 * Напоминания: когда слать и что сказать.
 *
 * ЗАЧЕМ ОНИ ВООБЩЕ. Прогрессия в этом контуре двигается не календарём, а
 * отметками: пока человек не сказал, как далась тренировка, следующая не
 * станет сложнее. Значит забытая отметка останавливает не «статистику», а саму
 * программу. Новичок забывает не из вредности: у него ещё нет привычки, и
 * приложение он открывает не каждый день.
 *
 * ── ПОЧЕМУ ИМЕННО ДВА И ИМЕННО ТОГДА ────────────────────────────────────────
 *
 * УТРОМ — что сегодня. Не «иди беги», а «вот что на сегодня, и если день не
 * складывается, тренировку можно перенести». Утро выбрано потому, что решение
 * «когда сегодня бежать» человек принимает утром, а не вечером; вечернее
 * напоминание о тренировке приходит, когда день уже прожит, и читается как
 * упрёк.
 *
 * ВЕЧЕРОМ — отметиться. Только если тренировка была (по плану или по факту в
 * Intervals), а отметки нет. Вечер выбран потому, что к этому часу пробежка уже
 * случилась или уже не случится, и вопрос «как прошло» осмысленный в обоих
 * случаях.
 *
 * ОКНО, А НЕ ТОЧНОЕ ВРЕМЯ. Раннер просыпается раз в полчаса, ноутбук иногда
 * спит, запуск иногда пропускается. Точное «в 8:00» означало бы «не пришло
 * вовсе, если в 8:00 машина спала». Окно в два часа переживает один пропущенный
 * запуск, а от повторов защищает не аккуратность кода, а уникальный ключ в
 * базе: один вид напоминания на источник в сутки.
 *
 * ВРЕМЯ СЧИТАЕТСЯ ПО ЗОНЕ УЧЕНИЦЫ. Тренер в Белграде, ученица может быть где
 * угодно; напоминание в 8 утра по Белграду это 3 ночи во Владивостоке.
 */

export type ReminderKind = "today_session" | "checkin_nudge";

/** Утреннее окно, по местному времени ученицы. */
export const MORNING_WINDOW = { fromHour: 7, toHour: 9 } as const;
/** Вечернее окно, по местному времени ученицы. */
export const EVENING_WINDOW = { fromHour: 19, toHour: 21 } as const;

export type ReminderDecision =
  | { send: false; reason: string }
  | { send: true; kind: ReminderKind; textRu: string };

export type ReminderInput = {
  /** Местный час ученицы, 0–23. */
  localHour: number;
  /** Что стоит в плане на сегодня. null — сегодня отдыха или плана нет. */
  todaySession: { title: string; minutes: number } | null;
  /** Отметилась ли она сегодня. */
  hasCheckinToday: boolean;
  /** Приехала ли из Intervals тренировка сегодняшним днём. */
  hasActivityToday: boolean;
  /** Какие напоминания сегодня уже уходили. */
  alreadySentKinds: ReminderKind[];
  /** Опубликован ли план: без него напоминать не о чем. */
  hasPublishedPlan: boolean;
};

function inWindow(hour: number, window: { fromHour: number; toHour: number }): boolean {
  return hour >= window.fromHour && hour <= window.toHour;
}

export function decideReminder(input: ReminderInput): ReminderDecision {
  if (!input.hasPublishedPlan) {
    return { send: false, reason: "плана нет или он не опубликован" };
  }
  // ОТМЕТИЛАСЬ — ЗНАЧИТ НЕ ТРОГАЕМ. Оба напоминания существуют ради отметки;
  // после неё любое из них становится шумом.
  if (input.hasCheckinToday) {
    return { send: false, reason: "уже отметилась сегодня" };
  }

  const sent = new Set(input.alreadySentKinds);

  if (inWindow(input.localHour, MORNING_WINDOW) && !sent.has("today_session")) {
    if (!input.todaySession) {
      return { send: false, reason: "сегодня отдых, напоминать не о чем" };
    }
    return {
      send: true,
      kind: "today_session",
      textRu:
        `Сегодня по плану: ${input.todaySession.title}, ${input.todaySession.minutes} минут.\n\n` +
        "Если день не складывается, тренировку можно перенести на другой день прямо в приложении.",
    };
  }

  if (inWindow(input.localHour, EVENING_WINDOW) && !sent.has("checkin_nudge")) {
    if (input.hasActivityToday) {
      return {
        send: true,
        kind: "checkin_nudge",
        textRu:
          "Вижу, что вы сегодня бегали. Отметьтесь, пожалуйста: одна кнопка, десять секунд.\n\n" +
          "От вашего ответа зависит, станет ли следующая тренировка сложнее. Пока отметки нет, " +
          "программа стоит на месте.",
      };
    }
    if (input.todaySession) {
      return {
        send: true,
        kind: "checkin_nudge",
        textRu:
          "Как прошла сегодняшняя тренировка?\n\n" +
          "Если получилось, отметьтесь в приложении: это одна кнопка. Если не получилось, тоже " +
          "ничего страшного, догонять не нужно, просто продолжайте по плану.",
      };
    }
    return { send: false, reason: "сегодня ни плановой тренировки, ни пробежки" };
  }

  return { send: false, reason: "не время: ждём утреннего или вечернего окна" };
}

/** Включены ли напоминания вообще. По умолчанию выключены. */
export function areRemindersEnabled(): boolean {
  return process.env.INTERVALS_REMINDERS_ENABLED === "true";
}
