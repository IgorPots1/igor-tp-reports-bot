/**
 * Сборка контура: что дёргают маршруты. Здесь порядок действий и отказы,
 * правила — в чистых модулях рядом.
 */

import { createSupabaseServerClient, describeSupabaseError } from "@/features/supabase/server";
import { BEGINNER_METHODOLOGY_ID, BEGINNER_METHODOLOGY_VERSION } from "@/features/methodology/beginner";

import { checkinReplyRu, effortByCode, painByCode } from "./effort-scale";
import { decideMove, weekdayIndex, type MoveDecision } from "./move";
import { applyCheckinToProgression } from "./progression";
import {
  getCheckinForSession,
  getOnboardingAnswers,
  getProgression,
  getPublishedCycle,
  getSessionById,
  listActivitiesInRange,
  listSessionsInRange,
  listVisibleCoachMessages,
  moveSession,
  saveCheckin,
  saveProgression,
} from "./repository";
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
  const sessions = await listSessionsInRange(cycle.id, shiftIso(todayIso, -7), shiftIso(todayIso, 14));

  const supabase = createSupabaseServerClient();
  const { data: checkinRows, error } = await supabase
    .from("intervals_checkins")
    .select("id, plan_session_id, session_date, effort_label, effort_rpe, pain")
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
      commentText: null,
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

  return buildStudentView({
    todayIso,
    sessions,
    checkinsBySessionId: bySession,
    progression,
    unavailableWeekdays: answers?.unavailableWeekdays ?? [],
    hasUnplannedCheckinToday: hasUnplannedToday,
    coachReplies,
  });
}

export type SubmitCheckinResult =
  | {
      ok: true;
      replyRu: string;
      stepBefore: number;
      stepAfter: number;
      action: string;
      reason: string;
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
  if (input.planSessionId) {
    const session = await getSessionById(input.planSessionId);
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
  }

  const [progression, answers] = await Promise.all([
    getProgression(input.sourceId),
    getOnboardingAnswers(input.sourceId),
  ]);

  const applied = applyCheckinToProgression({
    state: progression,
    sourceId: input.sourceId,
    sessionDate,
    rpe: effort.rpe,
    pain: painOption.pain,
    canRunContinuously: answers?.canRunContinuously ?? null,
  });

  // Тренировка того же дня, если она уже приехала. Отсутствие — норма, а не сбой.
  const activities = await listActivitiesInRange(input.sourceId, sessionDate, sessionDate);
  const activityId = activities[0]?.activityId ?? null;

  const checkin = await saveCheckin({
    sourceId: input.sourceId,
    planSessionId: input.planSessionId,
    activityId,
    sessionDate,
    effortRpe: effort.rpe,
    effortLabel: effort.labelRu,
    pain: painOption.pain,
    painNote: null,
    commentText: input.commentText,
    voiceFileId: input.voiceFileId,
    stepBefore: applied.stepBefore,
    stepAfter: applied.decision.nextStep,
    progressionAction: applied.decision.action,
    progressionReason: applied.decision.reason,
  });

  await saveProgression({
    ...applied.next,
    methodologyId: applied.next.methodologyId || BEGINNER_METHODOLOGY_ID,
    methodologyVersion: applied.next.methodologyVersion || BEGINNER_METHODOLOGY_VERSION,
  });

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
