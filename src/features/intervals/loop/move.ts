/**
 * Перенос тренировки самим учеником.
 *
 * ЗАЧЕМ ЭТО ВООБЩЕ. Перенос — самая частая причина, по которой ученик пишет
 * тренеру. Каждое такое сообщение стоит тренеру внимания, а ученику — паузы:
 * пока тренер не ответил, непонятно, бежать сегодня или нет. Разрешить перенос
 * самому — это не удобство, это снятие единственного регулярного затора.
 *
 * ЧЕГО ЗДЕСЬ НАМЕРЕННО НЕТ: переноса между неделями. Неделя — это доза
 * нагрузки; утащив субботнюю тренировку на вторник следующей недели, человек
 * делает одну неделю пустой, а другую перегруженной, и обе перестают
 * соответствовать ступени. Отказ говорит об этом прямо, а не молчит.
 */

export type MoveRefusalCode =
  | "unknown_session"
  | "past_session"
  | "past_target"
  | "outside_week"
  | "unavailable_weekday"
  | "day_taken"
  | "already_done"
  | "same_day";

export type MoveDecision =
  | { ok: true; toDayIdx: number }
  | { ok: false; code: MoveRefusalCode; messageRu: string };

export type MoveCandidateSession = {
  id: string;
  sessionDate: string;
  dayIdx: number;
  weekStart: string;
};

const DAY_RU_FULL = [
  "понедельник",
  "вторник",
  "среду",
  "четверг",
  "пятницу",
  "субботу",
  "воскресенье",
];

const DAY_MS = 86_400_000;

function parseIso(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

/** 0 = понедельник … 6 = воскресенье, как во всём остальном коде недели. */
export function weekdayIndex(iso: string): number {
  const jsDay = new Date(parseIso(iso)).getUTCDay();
  return (jsDay + 6) % 7;
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((parseIso(toIso) - parseIso(fromIso)) / DAY_MS);
}

/**
 * Можно ли перенести сессию на выбранный день.
 *
 * Чистая функция: всё, что ей нужно знать о мире, передано аргументами — и
 * поэтому все отказы можно прогнать проверкой, не трогая базу.
 */
export function decideMove(input: {
  session: MoveCandidateSession;
  toDate: string;
  todayIso: string;
  /** Дни, в которые человек сказал, что бегать не может (0=Пн…6=Вс). */
  unavailableWeekdays: number[];
  /** Остальные сессии того же цикла — чтобы не поставить две в один день. */
  siblingSessions: MoveCandidateSession[];
  /** Есть ли уже чек-ин по этой сессии: сделанное не переносят. */
  hasCheckin: boolean;
}): MoveDecision {
  const { session, toDate, todayIso } = input;

  if (input.hasCheckin) {
    return {
      ok: false,
      code: "already_done",
      messageRu: "Эта тренировка уже отмечена как выполненная — переносить нечего.",
    };
  }

  if (toDate === session.sessionDate) {
    return { ok: false, code: "same_day", messageRu: "Тренировка и так стоит в этот день." };
  }

  // Прошедшую тренировку не переносят: её либо сделали, либо пропустили, и
  // и то и другое — уже факт. Двигать факт значит подделывать историю, по
  // которой потом считается прогрессия.
  if (daysBetween(todayIso, session.sessionDate) < 0) {
    return {
      ok: false,
      code: "past_session",
      messageRu: "Прошедшую тренировку перенести нельзя. Если пробежала — отметься, если нет — просто идём дальше.",
    };
  }

  if (daysBetween(todayIso, toDate) < 0) {
    return { ok: false, code: "past_target", messageRu: "На прошедший день перенести нельзя." };
  }

  const offset = daysBetween(session.weekStart, toDate);
  if (offset < 0 || offset > 6) {
    return {
      ok: false,
      code: "outside_week",
      messageRu:
        "Переносить можно только внутри той же недели. Неделя — это доза нагрузки: " +
        "если унести тренировку в соседнюю, одна неделя станет пустой, а другая тяжёлой.",
    };
  }

  const toDayIdx = weekdayIndex(toDate);
  if (input.unavailableWeekdays.includes(toDayIdx)) {
    return {
      ok: false,
      code: "unavailable_weekday",
      messageRu: `В анкете ${DAY_RU_FULL[toDayIdx]} отмечена как день, когда бегать не получается. Если это изменилось — скажи тренеру, поправим анкету.`,
    };
  }

  const taken = input.siblingSessions.some(
    (other) => other.id !== session.id && other.sessionDate === toDate
  );
  if (taken) {
    return {
      ok: false,
      code: "day_taken",
      messageRu:
        "В этот день уже стоит другая тренировка. Две подряд новичку не ставим — выбери свободный день.",
    };
  }

  return { ok: true, toDayIdx };
}

/**
 * Дни, которые вообще имеет смысл предложить для переноса.
 *
 * Показываем только допустимые: список, где половина кнопок отвечает отказом,
 * учит человека, что система капризная, а не что у неё есть правила.
 */
export function allowedMoveTargets(input: {
  session: MoveCandidateSession;
  todayIso: string;
  unavailableWeekdays: number[];
  siblingSessions: MoveCandidateSession[];
  hasCheckin: boolean;
}): string[] {
  const targets: string[] = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const date = new Date(parseIso(input.session.weekStart) + offset * DAY_MS)
      .toISOString()
      .slice(0, 10);
    const decision = decideMove({ ...input, toDate: date });
    if (decision.ok) targets.push(date);
  }
  return targets;
}
