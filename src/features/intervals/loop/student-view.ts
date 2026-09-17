/**
 * Что видит ученица. Чистая сборка из строк базы — ни запросов, ни решений.
 *
 * ГРАНИЦА НАРЯДА: карточка на сегодня, ближайшие дни, ступень. Кабинета с
 * графиками здесь нет и не должно быть — новичку график недельного объёма не
 * говорит ничего, кроме «цифра маленькая».
 */

import { BEGINNER_LADDER, stepByIndex } from "@/features/methodology/beginner";

import { EFFORT_OPTIONS, PAIN_OPTIONS } from "./effort-scale";
import { allowedMoveTargets } from "./move";
import type { Checkin, PlanSession, ProgressionState, SessionNote, SessionSegment, SessionStep } from "./types";

const DAY_RU_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const RU_MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

export function formatRuDay(iso: string): string {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match) return iso;
  const day = Number.parseInt(match[3], 10);
  const month = RU_MONTHS[Number.parseInt(match[2], 10) - 1] ?? "";
  return `${day} ${month}`;
}

export type StudentSessionCard = {
  sessionId: string;
  date: string;
  dateLabel: string;
  weekdayLabel: string;
  title: string;
  minutes: number;
  description: string | null;
  /** null — сессия сгенерирована до появления колонки, структуры нет. */
  segments: SessionSegment[] | null;
  /** Ручное авторство — заполнено, значит рендерим по шагам, не по segments/description. */
  steps: SessionStep[] | null;
  notes: SessionNote[] | null;
  /** Уже отмечена? Тогда вместо кнопок — что она ответила. */
  checkedIn: boolean;
  checkinLabel: string | null;
  /** Дни, на которые эту тренировку разрешено перенести. */
  moveTargets: Array<{ date: string; label: string }>;
  movedFrom: string | null;
};

export type StudentLadderView = {
  step: number;
  totalSteps: number;
  labelRu: string;
  /** Что будет следующим — для новичка это и есть мотивация. */
  nextLabelRu: string | null;
  sessionsAtStep: number;
  /** Человеческое «что дальше», без слов про RPE и без обещаний по календарю. */
  progressNoteRu: string;
};

/**
 * Что показать, пока плана нет.
 *
 * РАНЬШЕ ЗДЕСЬ БЫЛ ТУПИК: одна строчка «план ещё готовится» и пустой экран.
 * Человек только что подключил часы и ответил на восемь вопросов, а в ответ
 * получил стену. Он не знает ни дошли ли его ответы, ни идут ли данные, ни
 * сколько ждать — и идёт спрашивать тренера ровно то, что система знает.
 *
 * Поэтому экран ожидания показывает ТРИ вещи: что уже сделано (и значит не
 * потеряно), что происходит сейчас, и что будет дальше.
 */
export type WaitingView = {
  messageRu: string;
  /** Пройденные шаги: человек видит, что его работа не пропала. */
  doneRu: string[];
  /** Что сейчас происходит и от кого зависит. */
  nextRu: string;
  /** Короткая сводка ответов анкеты, чтобы можно было заметить ошибку. */
  answersSummaryRu: string[];
};

/**
 * Ответ тренера так, как его видит ученица.
 *
 * ПОЧЕМУ ЭТО ЕСТЬ В ПРИЛОЖЕНИИ, А НЕ ТОЛЬКО В ЧАТЕ. Она отмечается здесь, а
 * ответ раньше приходил в переписку, и то лишь при включённом killswitch-е.
 * Человек ищет ответ там, где задавал вопрос; в чате он к тому же тонет между
 * другими сообщениями, а здесь лежит рядом с той самой тренировкой.
 */
export type CoachReplyView = {
  id: string;
  /** Про какой день ответ: «про 22 сентября». */
  aboutDateLabel: string | null;
  body: string;
  /** Дата ответа для порядка, без времени: точность до минуты ей не нужна. */
  dateLabel: string;
  /** Новый — тот, что она ещё не открывала. */
  isNew: boolean;
};

export type StudentView =
  | { state: "no_plan"; messageRu: string; waiting: WaitingView }
  | {
      state: "ready";
      today: StudentSessionCard | null;
      upcoming: StudentSessionCard[];
      ladder: StudentLadderView | null;
      /** Незапланированная пробежка: отметиться можно и без неё в плане. */
      canLogUnplanned: boolean;
      /** Что ответил тренер. Пусто — ответов пока нет. */
      coachReplies: CoachReplyView[];
      effortOptions: typeof EFFORT_OPTIONS;
      painOptions: typeof PAIN_OPTIONS;
      restNoteRu: string | null;
      /** Заметка к неделе целиком — один раз наверху экрана, не в каждой карточке. */
      weekNote: string | null;
    };

/**
 * «Что дальше» словами.
 *
 * НЕ ОБЕЩАЕМ ДАТУ ПЕРЕХОДА. Прогрессия управляется тем, как далась работа, а не
 * календарём; сказать «через неделю перейдёшь» значит дать обещание, которое
 * система не контролирует, и первый же тяжёлый день сделает нас лжецами.
 */
function progressNote(state: ProgressionState): string {
  const current = stepByIndex(state.currentStep);
  const isLast = state.currentStep >= BEGINNER_LADDER[BEGINNER_LADDER.length - 1].index;
  if (isLast) {
    return "Это последняя ступень программы новичка. Дальше обычные беговые планы, тренер скажет когда.";
  }
  const next = stepByIndex(state.currentStep + 1);
  if (state.sessionsAtStep === 0) {
    return `Эту ступень только начали. Следующая: ${next.labelRu}.`;
  }
  return (
    `На этой ступени отработано ${state.sessionsAtStep} ${plural(state.sessionsAtStep, "тренировка", "тренировки", "тренировок")}. ` +
    `Когда ${current.labelRu} начнёт даваться спокойно — перейдём на ${next.labelRu}.`
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = n % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

function toCard(
  session: PlanSession,
  checkin: Checkin | null,
  context: {
    todayIso: string;
    unavailableWeekdays: number[];
    siblings: PlanSession[];
  }
): StudentSessionCard {
  const moveTargets = allowedMoveTargets({
    session: {
      id: session.id,
      sessionDate: session.sessionDate,
      dayIdx: session.dayIdx,
      weekStart: session.weekStart,
    },
    todayIso: context.todayIso,
    unavailableWeekdays: context.unavailableWeekdays,
    siblingSessions: context.siblings.map((other) => ({
      id: other.id,
      sessionDate: other.sessionDate,
      dayIdx: other.dayIdx,
      weekStart: other.weekStart,
    })),
    hasCheckin: checkin !== null,
  });

  return {
    sessionId: session.id,
    date: session.sessionDate,
    dateLabel: formatRuDay(session.sessionDate),
    weekdayLabel: DAY_RU_SHORT[session.dayIdx] ?? "",
    title: session.title,
    minutes: session.minutes,
    description: session.description,
    segments: session.segments,
    steps: session.steps,
    notes: session.notes,
    checkedIn: checkin !== null,
    checkinLabel: checkin
      ? checkin.pain
        ? `${checkin.effortLabel ?? "отмечено"} · что-то беспокоило`
        : checkin.effortLabel ?? "отмечено"
      : null,
    moveTargets: moveTargets.map((date) => ({
      date,
      label: `${DAY_RU_SHORT[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7]}, ${formatRuDay(date)}`,
    })),
    movedFrom: session.originalSessionDate,
  };
}

export function buildStudentView(input: {
  todayIso: string;
  /** null — плана нет или он ещё не подтверждён тренером. */
  sessions: PlanSession[] | null;
  checkinsBySessionId: Map<string, Checkin>;
  progression: ProgressionState | null;
  unavailableWeekdays: number[];
  /** Есть ли уже сегодняшний чек-ин по незапланированной пробежке. */
  hasUnplannedCheckinToday: boolean;
  /** Короткая сводка анкеты: показывается на экране ожидания. */
  answersSummary?: string[];
  /** Отданные тренером тексты, новые сверху. */
  coachReplies?: CoachReplyView[];
  upcomingDays?: number;
  /** Заметка к неделе целиком — с опубликованного цикла. */
  weekNote?: string | null;
}): StudentView {
  if (input.sessions === null) {
    const messageRu =
      "План ещё готовится, тренер его проверяет. Как только будет готов, он появится здесь.";
    return {
      state: "no_plan",
      messageRu,
      waiting: {
        messageRu,
        doneRu: [
          "Часы подключены, тренировки приходят",
          ...(input.answersSummary && input.answersSummary.length > 0
            ? ["Анкета заполнена, ответы у тренера"]
            : []),
        ],
        nextRu:
          "Сейчас ход за тренером: он собирает план и проверяет его перед тем, как показать вам. " +
          "Обычно это занимает день. Ничего делать не нужно, экран обновится сам.",
        answersSummaryRu: input.answersSummary ?? [],
      },
    };
  }

  const horizon = input.upcomingDays ?? 10;
  const horizonEnd = new Date(Date.parse(`${input.todayIso}T00:00:00Z`) + horizon * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const sorted = [...input.sessions].sort((a, b) => a.sessionDate.localeCompare(b.sessionDate));
  const todaySession = sorted.find((session) => session.sessionDate === input.todayIso) ?? null;
  const upcoming = sorted.filter(
    (session) => session.sessionDate > input.todayIso && session.sessionDate <= horizonEnd
  );

  const cardContext = {
    todayIso: input.todayIso,
    unavailableWeekdays: input.unavailableWeekdays,
    siblings: sorted,
  };

  const ladder: StudentLadderView | null = input.progression
    ? {
        step: input.progression.currentStep,
        totalSteps: BEGINNER_LADDER.length,
        labelRu: stepByIndex(input.progression.currentStep).labelRu,
        nextLabelRu:
          input.progression.currentStep < BEGINNER_LADDER[BEGINNER_LADDER.length - 1].index
            ? stepByIndex(input.progression.currentStep + 1).labelRu
            : null,
        sessionsAtStep: input.progression.sessionsAtStep,
        progressNoteRu: progressNote(input.progression),
      }
    : null;

  // ДЕНЬ БЕЗ ТРЕНИРОВКИ ОБЪЯСНЯЕТСЯ. Пустой экран новичок читает как «что-то
  // сломалось» или «я что-то пропустила». У новичка отдых — часть методики, и
  // сказать это прямо дешевле, чем потом отвечать на вопрос в личке.
  const restNote =
    todaySession === null
      ? upcoming.length > 0
        ? `Сегодня отдых. Ближайшая тренировка — ${DAY_RU_SHORT[upcoming[0].dayIdx]}, ${formatRuDay(upcoming[0].sessionDate)}. Отдых у новичка это часть плана, а не пропуск: тело растёт между тренировками, а не на них.`
        : "Сегодня отдых. Ближайших тренировок в плане пока нет, тренер их добавит."
      : null;

  return {
    state: "ready",
    today: todaySession ? toCard(todaySession, input.checkinsBySessionId.get(todaySession.id) ?? null, cardContext) : null,
    upcoming: upcoming.map((session) =>
      toCard(session, input.checkinsBySessionId.get(session.id) ?? null, cardContext)
    ),
    ladder,
    // Отметиться можно ВСЕГДА, даже если в плане на сегодня ничего нет и
    // активность из Intervals не приехала: человек мог пробежать и не записать.
    canLogUnplanned: !input.hasUnplannedCheckinToday && todaySession === null,
    coachReplies: input.coachReplies ?? [],
    effortOptions: EFFORT_OPTIONS,
    painOptions: PAIN_OPTIONS,
    restNoteRu: restNote,
    weekNote: input.weekNote ?? null,
  };
}
