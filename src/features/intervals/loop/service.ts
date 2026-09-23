/**
 * Сборка контура: что дёргают маршруты. Здесь порядок действий и отказы,
 * правила — в чистых модулях рядом.
 */

import { createSupabaseServerClient, describeSupabaseError } from "@/features/supabase/server";
import { BEGINNER_METHODOLOGY_ID, BEGINNER_METHODOLOGY_VERSION } from "@/features/methodology/beginner";

import { checkinReplyRu, effortByCode, painByCode, simpleCheckinReplyRu } from "./effort-scale";
import { buildCabinetView, type CabinetView } from "./cabinet-view";
import { decideMove, weekdayIndex, type MoveDecision } from "./move";
import { applyCheckinToProgression } from "./progression";
import { reportedWeekStart } from "./weekly-report";
import {
  getCheckinForSession,
  getOnboardingAnswers,
  getCheckinByDate,
  getProgression,
  getPublishedCycle,
  getSessionById,
  listActivitiesInRange,
  listCheckins,
  listSessionsByIds,
  listSessionsInRange,
  listVisibleCoachMessages,
  moveSession,
  saveCheckin,
  saveCheckinEdit,
  saveProgression,
  getWeeklyReport,
  listPlanWeeks,
} from "./repository";
import { diffCheckin, type CheckinSnapshot } from "./checkin-edit";
import { buildStudentView, formatRuDay, type CoachReplyView, type StudentView } from "./student-view";
import type { Checkin } from "./types";

const DAY_MS = 86_400_000;

const DAY_RU_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

/**
 * Сводка анкеты словами человека.
 *
 * Показывается, пока плана нет, чтобы ошибку в ответах можно было заметить
 * СЕЙЧАС, а не через неделю по неудобному плану. Только то, что человек
 * отвечал сам: поля, заданные тренером, он не выбирал и подтверждать ему нечего.
 */
function summariseAnswersRu(
  answers: Awaited<ReturnType<typeof getOnboardingAnswers>>
): string[] {
  if (!answers) return [];
  const coachSet = new Set(answers.coachSetFields);
  const lines: string[] = [];
  const mine = (field: string) => !coachSet.has(field);

  if (mine("weekStability") && answers.weekStability) {
    lines.push(
      answers.weekStability === "stable" ? "Неделя примерно одинаковая" : "Неделя каждый раз разная"
    );
  }
  if (mine("availableWeekdays") && answers.availableWeekdays.length > 0) {
    lines.push(`Свободны: ${answers.availableWeekdays.map((d) => DAY_RU_SHORT[d]).join(", ")}`);
  }
  if (mine("unavailableWeekdays") && answers.unavailableWeekdays.length > 0) {
    lines.push(`Заняты: ${answers.unavailableWeekdays.map((d) => DAY_RU_SHORT[d]).join(", ")}`);
  }
  if (mine("preferredLongWeekday") && answers.preferredLongWeekday !== null) {
    lines.push(`Длинная тренировка: ${DAY_RU_SHORT[answers.preferredLongWeekday]}`);
  }
  if (mine("maxSessionMinutes") && answers.maxSessionMinutes !== null) {
    lines.push(`На тренировку есть до ${answers.maxSessionMinutes} минут`);
  }
  if (mine("runSurfaces") && answers.runSurfaces.length > 0) {
    lines.push(`Бегаете: ${answers.runSurfaces.join(", ")}`);
  }
  return lines;
}

function shiftIso(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Источник данных ученика БЕЗ СЕКРЕТА.
 *
 * Отдельная функция, а не getSourceWithSecret: весь контур работает с
 * идентификатором источника и ключ ему не нужен ни разу. Не тащить секрет туда,
 * где он не нужен, дешевле, чем потом следить, чтобы он не утёк.
 */
export async function getStudentSourceId(studentUuid: string): Promise<string | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("student_data_sources")
    .select("id, is_active, kind")
    .eq("student_id", studentUuid)
    .eq("provider", "intervals")
    .limit(1);
  if (error) throw new Error(`student_data_sources: ${describeSupabaseError(error)}`);
  const row = (data ?? [])[0] as { id: string; is_active: boolean } | undefined;
  if (!row || row.is_active !== true) return null;
  return row.id;
}

/** Всё, что нужно показать ученице на одном экране. */
/**
 * Ответы тренера для экрана ученицы.
 *
 * ПОКАЗЫВАЕМ ТОЛЬКО ОТДАННЫЕ. Черновик и подготовленный текст — внутренняя
 * кухня тренера, и человек не должен видеть то, что тренер ещё не решил
 * отдать. Отбор делает сам запрос (visible_to_student_at not null), а не
 * фильтр в разметке: фильтр в разметке однажды забудут.
 */
async function loadCoachReplies(sourceId: string): Promise<CoachReplyView[]> {
  const messages = await listVisibleCoachMessages(sourceId, 5);
  return messages.map((message) => {
    const context = message.context as {
      checkin?: { date?: string } | null;
      plannedSession?: { date?: string } | null;
    };
    const about = context.checkin?.date ?? context.plannedSession?.date ?? null;
    return {
      id: message.id,
      aboutDateLabel: about ? formatRuDay(about) : null,
      body: message.body,
      dateLabel: formatRuDay((message.visibleToStudentAt ?? message.createdAt).slice(0, 10)),
      // «Новое» считаем по факту, что ответ моложе суток: отдельного признака
      // «прочитано» в контуре нет, а заводить его ради точки на экране значит
      // писать в базу на каждое открытие приложения.
      isNew:
        Date.now() - Date.parse(message.visibleToStudentAt ?? message.createdAt) < 24 * 60 * 60 * 1000,
    };
  });
}

export async function loadStudentView(sourceId: string, todayIso: string): Promise<StudentView> {
  const cycle = await getPublishedCycle(sourceId);
  const [progression, answers, coachReplies] = await Promise.all([
    getProgression(sourceId),
    getOnboardingAnswers(sourceId),
    loadCoachReplies(sourceId),
  ]);

  if (!cycle) {
    return buildStudentView({
      todayIso,
      sessions: null,
      checkinsBySessionId: new Map(),
      progression,
      unavailableWeekdays: answers?.unavailableWeekdays ?? [],
      hasUnplannedCheckinToday: false,
      answersSummary: summariseAnswersRu(answers),
      coachReplies,
    });
  }

  // Окно: неделя назад (чтобы видеть, что уже отмечено) и две вперёд.
  const allSessions = await listSessionsInRange(cycle.id, shiftIso(todayIso, -7), shiftIso(todayIso, 14));

  /**
   * НЕДЕЛЯ БЕЗ released ЧЕЛОВЕКУ НЕ ПОКАЗЫВАЕТСЯ [20.09.2026].
   *
   * Раньше единицей публикации был цикл: опубликован — видно всё, включая
   * недоделанную правку будущей недели. Теперь видно только то, что тренер
   * отдал отдельным нажатием.
   *
   * Неделя без строки состояния считается НЕ отданной. Это осознанно строгая
   * сторона: забытая строка даёт пустой экран, который тренер заметит, а
   * забытый released отдал бы черновик ученице молча.
   */
  const weeks = await listPlanWeeks(cycle.id);
  const releasedWeeks = new Set(
    weeks.filter((week) => week.status === "released").map((week) => week.weekStart)
  );
  const sessions = allSessions.filter((session) => releasedWeeks.has(session.weekStart));

  const supabase = createSupabaseServerClient();
  const { data: checkinRows, error } = await supabase
    .from("intervals_checkins")
    .select("id, plan_session_id, session_date, effort_label, effort_rpe, pain, comment_text")
    .eq("source_id", sourceId)
    .gte("session_date", shiftIso(todayIso, -7));
  if (error) throw new Error(`intervals_checkins: ${describeSupabaseError(error)}`);

  const bySession = new Map<string, Checkin>();
  let hasUnplannedToday = false;
  for (const raw of checkinRows ?? []) {
    const row = raw as unknown as Record<string, unknown>;
    const planSessionId = (row.plan_session_id as string | null) ?? null;
    const partial = {
      id: String(row.id),
      sourceId,
      planSessionId,
      activityId: null,
      sessionDate: String(row.session_date),
      effortRpe: row.effort_rpe === null || row.effort_rpe === undefined ? null : Number(row.effort_rpe),
      effortLabel: (row.effort_label as string | null) ?? null,
      pain: row.pain === true,
      painNote: null,
      painResolvedAt: null,
      painResolvedBy: null,
      // Комментарий нужен форме правки: она открывается заполненной.
      commentText: (row.comment_text as string | null) ?? null,
      voiceFileId: null,
      stepBefore: null,
      stepAfter: null,
      progressionAction: null,
      progressionReason: null,
      createdAt: "",
    } satisfies Checkin;
    if (planSessionId) bySession.set(planSessionId, partial);
    else if (partial.sessionDate === todayIso) hasUnplannedToday = true;
  }

  /**
   * НЕДЕЛЬНАЯ ФОРМА: в свои дни (вс/пн) и пока ответа за эту неделю нет.
   *
   * УСЛОВИЕ ПРО ОТМЕТКИ ЖИВЁТ НА УВЕДОМЛЕНИИ, А НЕ ЗДЕСЬ [21.09.2026].
   *
   * Сначала я повторил его и тут — и получилось ровно наоборот задуманному:
   * человеку, у которого неделя не сложилась и отметок нет, форма НЕ
   * открывалась. То есть вариант «почти ничего не получилось» был недоступен
   * ровно тем, для кого он написан. Поймано на Валентине: ноль чек-инов за
   * неделю (форма отчёта у неё падала), и открыть недельную форму она не может.
   *
   * Бот по-прежнему МОЛЧИТ, когда отметок не было: навязываться человеку,
   * который не появлялся, нельзя. Но если он открыл приложение сам или тренер
   * прислал форму руками — она должна работать.
   */
  const weekForForm = reportedWeekStart(todayIso);
  let weeklyFormWeekStart: string | null = null;
  if (weekForForm) {
    const existing = await getWeeklyReport(sourceId, weekForForm);
    if (!existing) weeklyFormWeekStart = weekForForm;
  }

  return buildStudentView({
    todayIso,
    sessions,
    checkinsBySessionId: bySession,
    progression,
    unavailableWeekdays: answers?.unavailableWeekdays ?? [],
    hasUnplannedCheckinToday: hasUnplannedToday,
    coachReplies,
    weekNotes: cycle.weekNotes,
    weeklyFormWeekStart,
  });
}

/**
 * Личный кабинет: недель вместе, неделя цикла, итоги, история, ступени.
 * Загрузка тут; решения о том, что показать, а что скрыть пустым — в
 * buildCabinetView (cabinet-view.ts).
 */
export async function loadCabinetView(sourceId: string, todayIso: string): Promise<CabinetView> {
  const supabase = createSupabaseServerClient();
  const [{ data: sourceRow, error: sourceError }, cycle, progression, checkins] = await Promise.all([
    supabase.from("student_data_sources").select("connected_at").eq("id", sourceId).maybeSingle(),
    getPublishedCycle(sourceId),
    getProgression(sourceId),
    listCheckins(sourceId, 200),
  ]);
  if (sourceError) throw new Error(`student_data_sources: ${describeSupabaseError(sourceError)}`);

  const sessionIds = [...new Set(checkins.map((c) => c.planSessionId).filter((id): id is string => id !== null))];
  const sessions = await listSessionsByIds(sessionIds);
  const sessionsById = new Map(sessions.map((s) => [s.id, s]));

  // МИНУТЫ — ПО ДАТЕ, А НЕ ПО checkin.activityId. Тот пишется один раз в
  // submitCheckin и остаётся пустым, если тренировка из Intervals ещё не
  // приехала на момент чек-ина — а обычно так и есть. Здесь сопоставляем
  // заново, на текущий момент: то, что успело дойти к открытию кабинета.
  const actualMinutesByDate = new Map<string, number>();
  if (checkins.length > 0) {
    const dates = checkins.map((c) => c.sessionDate).sort();
    const activities = await listActivitiesInRange(sourceId, dates[0], dates[dates.length - 1]);
    for (const activity of activities) {
      if (activity.movingTimeS === null || !activity.startDateLocal) continue;
      const date = activity.startDateLocal.slice(0, 10);
      // Несколько активностей в один день — берём более длинную: рабочая
      // тренировка дня, а не случайная короткая прогулка тем же числом.
      const minutes = Math.round(activity.movingTimeS / 60);
      const existing = actualMinutesByDate.get(date);
      if (existing === undefined || minutes > existing) actualMinutesByDate.set(date, minutes);
    }
  }

  return buildCabinetView({
    todayIso,
    connectedAtIso: (sourceRow as { connected_at: string | null } | null)?.connected_at ?? null,
    cycle,
    progression,
    checkins,
    sessionsById,
    actualMinutesByDate,
  });
}

export type SubmitCheckinResult =
  | {
      ok: true;
      replyRu: string;
      /** null — не на лестнице, прогрессия эту тренировку не решала вообще. */
      stepBefore: number | null;
      stepAfter: number | null;
      action: string | null;
      reason: string | null;
      checkinId: string;
    }
  | { ok: false; code: "bad_effort" | "bad_pain" | "unknown_session" | "wrong_owner"; messageRu: string };

/**
 * Чек-ин: ответ ученицы → строка в базе → сдвиг ступени.
 *
 * НЕ ТРЕБУЕТ АКТИВНОСТИ ИЗ INTERVALS. Если тренировка уже приехала — привяжем
 * её к ответу; если нет — ответ полноценен и без неё. Человек может пробежать
 * и не записать, и наказывать его за это молчанием системы нельзя.
 */
export async function submitCheckin(input: {
  sourceId: string;
  /** null — пробежка вне плана. */
  planSessionId: string | null;
  sessionDate: string;
  effortCode: string;
  painCode: string;
  commentText: string | null;
  voiceFileId: string | null;
}): Promise<SubmitCheckinResult> {
  const effort = effortByCode(input.effortCode);
  if (!effort) {
    return { ok: false, code: "bad_effort", messageRu: "Неизвестный вариант ответа про усилие." };
  }
  const painOption = painByCode(input.painCode);
  if (!painOption) {
    return { ok: false, code: "bad_pain", messageRu: "Неизвестный вариант ответа про самочувствие." };
  }

  let sessionDate = input.sessionDate;
  let planSessionId = input.planSessionId;
  if (planSessionId) {
    const session = await getSessionById(planSessionId);
    if (!session) {
      return { ok: false, code: "unknown_session", messageRu: "Тренировка не найдена." };
    }
    // Чужую сессию отметить нельзя: id в запросе приходит от клиента, и
    // проверять принадлежность обязан сервер.
    const cycle = await getPublishedCycle(input.sourceId);
    if (!cycle || cycle.id !== session.cycleId) {
      return { ok: false, code: "wrong_owner", messageRu: "Эта тренировка не из вашего плана." };
    }
    sessionDate = session.sessionDate;
  } else {
    /**
     * ЗАПИСЬ БЕЗ СЕССИИ САМА НАХОДИТ СВОЙ ПЛАНОВЫЙ ДЕНЬ [23.09.2026].
     *
     * Раньше пробежка, записанная кнопкой «Записать тренировку», уходила с
     * planSessionId = null ВСЕГДА — даже когда человек ставил вчерашнюю дату, в
     * которой плановая тренировка была. Плановый день оставался неотмеченным
     * навсегда: закрыть его было нечем, а у тренера он вечно висел пропуском.
     *
     * Привязываем ТОЛЬКО при полной однозначности: ровно одна сессия в этот
     * день у опубликованного цикла. Двух в день у этого сегмента не бывает, но
     * если появятся — гадать не станем, запись останется вне плана. Закрыть
     * наугад не ту тренировку хуже, чем не закрыть никакой.
     */
    const cycle = await getPublishedCycle(input.sourceId);
    if (cycle) {
      const sameDay = await listSessionsInRange(cycle.id, sessionDate, sessionDate);
      if (sameDay.length === 1) {
        planSessionId = sameDay[0].id;
      }
    }
  }

  const [progression, answers, existing] = await Promise.all([
    getProgression(input.sourceId),
    getOnboardingAnswers(input.sourceId),
    // Прежний ответ за этот день — ОБЯЗАТЕЛЬНО ДО записи: saveCheckin делает
    // upsert по ключу (источник, день), и после него «что было» взять неоткуда.
    getCheckinByDate(input.sourceId, sessionDate),
  ]);

  const after: CheckinSnapshot = {
    effortRpe: effort.rpe,
    effortLabel: effort.labelRu,
    pain: painOption.pain,
    commentText: input.commentText,
  };
  const before: CheckinSnapshot | null = existing
    ? {
        effortRpe: existing.effortRpe,
        effortLabel: existing.effortLabel,
        pain: existing.pain,
        commentText: existing.commentText,
      }
    : null;
  const changed = before ? diffCheckin(before, after) : [];

  // Тренировка того же дня, если она уже приехала. Отсутствие — норма, а не сбой.
  const activities = await listActivitiesInRange(input.sourceId, sessionDate, sessionDate);
  const activityId = activities[0]?.activityId ?? null;

  // НЕ НА ЛЕСТНИЦЕ — ПРОГРЕССИЮ НЕ СЧИТАЕМ ВООБЩЕ [решение Игоря, 17.09.2026].
  // Раньше applyCheckinToProgression звался безусловно для всех: у неё
  // state?.currentStep ?? 1 молча подставлял ступень 1 человеку, который на
  // лестнице не стоял вообще (Валентина, Дарья — обычный цикл, не методика
  // новичка), а saveProgression следом заводил ей фантомную строку
  // intervals_beginner_progression и ответ «идём на ступень 2». Гейт — по
  // прогрессии: она существует ТОЛЬКО у тех, кого реально ведёт лестница
  // (заводится при первой генерации плана новичка, см. runBeginnerBranch).
  if (progression === null) {
    const checkin = await saveCheckin({
      sourceId: input.sourceId,
      planSessionId,
      activityId,
      sessionDate,
      effortRpe: effort.rpe,
      effortLabel: effort.labelRu,
      pain: painOption.pain,
      painNote: null,
      commentText: input.commentText,
      voiceFileId: input.voiceFileId,
      stepBefore: null,
      stepAfter: null,
      progressionAction: null,
      progressionReason: null,
    });
    if (before && changed.length > 0) {
      await saveCheckinEdit({ checkinId: checkin.id, changed, before, after });
    }
    return {
      ok: true,
      replyRu: simpleCheckinReplyRu(painOption.pain),
      stepBefore: null,
      stepAfter: null,
      action: null,
      reason: null,
      checkinId: checkin.id,
    };
  }

  /**
   * ПРАВКА НЕ ДВИГАЕТ СТУПЕНЬ ВТОРОЙ РАЗ [23.09.2026].
   *
   * Ступень уже сдвинулась на первом ответе. Пересчитать её от нового значит
   * применить к прогрессии ДВА решения об одной тренировке: applyCheckinToProgression
   * считает от ТЕКУЩЕГО состояния, а не от того, что было до первого ответа, и
   * «Тяжело, поправленное на Нормально» подняло бы человека на ступень вверх от
   * уже опущенной. Откатить первое решение нечем: за ним могли пройти другие
   * чек-ины.
   *
   * Поэтому правка меняет ОТВЕТ, но не лестницу, и тренер видит расхождение на
   * карточке отдельной строкой «было → стало». Решение про ступень после правки
   * принимает он, как и с болью.
   */
  const applied = applyCheckinToProgression({
    state: progression,
    sourceId: input.sourceId,
    sessionDate,
    rpe: effort.rpe,
    pain: painOption.pain,
    canRunContinuously: answers?.canRunContinuously ?? null,
  });

  const checkin = await saveCheckin({
    sourceId: input.sourceId,
    planSessionId,
    activityId,
    sessionDate,
    effortRpe: effort.rpe,
    effortLabel: effort.labelRu,
    pain: painOption.pain,
    painNote: null,
    commentText: input.commentText,
    voiceFileId: input.voiceFileId,
    // У правки ступень остаётся той, что записал первый ответ: заново её никто
    // не решал, и подменять запись расчётом, который не применялся, нельзя.
    stepBefore: existing ? existing.stepBefore : applied.stepBefore,
    stepAfter: existing ? existing.stepAfter : applied.decision.nextStep,
    progressionAction: existing ? existing.progressionAction : applied.decision.action,
    progressionReason: existing ? existing.progressionReason : applied.decision.reason,
  });

  if (before && changed.length > 0) {
    await saveCheckinEdit({ checkinId: checkin.id, changed, before, after });
  }

  if (!existing) {
    await saveProgression({
      ...applied.next,
      methodologyId: applied.next.methodologyId || BEGINNER_METHODOLOGY_ID,
      methodologyVersion: applied.next.methodologyVersion || BEGINNER_METHODOLOGY_VERSION,
    });
  }

  /**
   * ОТВЕТ ЧЕЛОВЕКУ ТОЖЕ ПРО ТО, ЧТО РЕАЛЬНО ПРОИЗОШЛО. Сказать «идём на ступень
   * три» после правки, которая ступень не двигала, — обещание, которое экран
   * тут же не выполнит: ступень там прежняя.
   */
  if (existing) {
    return {
      ok: true,
      replyRu: "Ответ поправил. Тренер увидит, что изменилось.",
      stepBefore: existing.stepBefore,
      stepAfter: existing.stepAfter,
      action: existing.progressionAction,
      reason: existing.progressionReason,
      checkinId: checkin.id,
    };
  }

  return {
    ok: true,
    replyRu: checkinReplyRu({
      action: applied.decision.action,
      stepAfter: applied.decision.nextStep,
      pain: painOption.pain,
    }),
    stepBefore: applied.stepBefore,
    stepAfter: applied.decision.nextStep,
    action: applied.decision.action,
    reason: applied.decision.reason,
    checkinId: checkin.id,
  };
}

export type MoveResult = { ok: true; toDate: string } | { ok: false; code: string; messageRu: string };

export async function moveStudentSession(input: {
  sourceId: string;
  sessionId: string;
  toDate: string;
  todayIso: string;
  movedBy: string;
}): Promise<MoveResult> {
  const session = await getSessionById(input.sessionId);
  if (!session) {
    return { ok: false, code: "unknown_session", messageRu: "Тренировка не найдена." };
  }
  const cycle = await getPublishedCycle(input.sourceId);
  if (!cycle || cycle.id !== session.cycleId) {
    return { ok: false, code: "wrong_owner", messageRu: "Эта тренировка не из вашего плана." };
  }

  const [answers, checkin, siblings] = await Promise.all([
    getOnboardingAnswers(input.sourceId),
    getCheckinForSession(session.id),
    listSessionsInRange(cycle.id, session.weekStart, shiftIso(session.weekStart, 6)),
  ]);

  const decision: MoveDecision = decideMove({
    session: {
      id: session.id,
      sessionDate: session.sessionDate,
      dayIdx: session.dayIdx,
      weekStart: session.weekStart,
    },
    toDate: input.toDate,
    todayIso: input.todayIso,
    unavailableWeekdays: answers?.unavailableWeekdays ?? [],
    siblingSessions: siblings.map((other) => ({
      id: other.id,
      sessionDate: other.sessionDate,
      dayIdx: other.dayIdx,
      weekStart: other.weekStart,
    })),
    hasCheckin: checkin !== null,
  });

  if (!decision.ok) {
    return { ok: false, code: decision.code, messageRu: decision.messageRu };
  }

  await moveSession({
    sessionId: session.id,
    toDate: input.toDate,
    toDayIdx: weekdayIndex(input.toDate),
    originalDate: session.sessionDate,
    originalDayIdx: session.dayIdx,
    alreadyMoved: session.originalSessionDate !== null,
    movedBy: input.movedBy,
  });

  return { ok: true, toDate: input.toDate };
}
