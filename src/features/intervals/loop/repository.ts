/**
 * Чтение и запись рабочего контура ученика. Только база — решений здесь нет.
 *
 * Решения живут в чистых модулях рядом: progression.ts (куда двигать ступень),
 * move.ts (можно ли переносить), effort-scale.ts (что значат слова). Так их
 * можно прогнать проверкой без базы, а базу — без методики.
 */

import { createSupabaseServerClient, describeSupabaseError } from "@/features/supabase/server";

import { isPrefillableField, type Prefill, type PrefillableField } from "./prefill";
import type { Checkin, CoachMessage, PlanCycle, PlanSession, ProgressionState } from "./types";

type Client = ReturnType<typeof createSupabaseServerClient>;

const SESSION_COLUMNS =
  "id, cycle_id, week_index, week_start, session_date, day_idx, role, title, minutes, preset_code, " +
  "description, target_mode, rpe, deferred, defer_reason, original_session_date, moved_at";

const CYCLE_COLUMNS =
  "id, source_id, intent, first_week_start, length_weeks, days, status, published_at, " +
  "data_level, start_point_source, created_at";

function toSession(row: Record<string, unknown>): PlanSession {
  return {
    id: String(row.id),
    cycleId: String(row.cycle_id),
    weekIndex: Number(row.week_index),
    weekStart: String(row.week_start),
    sessionDate: String(row.session_date),
    dayIdx: Number(row.day_idx),
    role: String(row.role),
    title: String(row.title),
    minutes: Number(row.minutes),
    presetCode: (row.preset_code as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    targetMode: row.target_mode === "pace" || row.target_mode === "rpe" ? row.target_mode : null,
    rpe: row.rpe === null || row.rpe === undefined ? null : Number(row.rpe),
    deferred: row.deferred === true,
    deferReason: (row.defer_reason as string | null) ?? null,
    originalSessionDate: (row.original_session_date as string | null) ?? null,
    movedAt: (row.moved_at as string | null) ?? null,
  };
}

function toCycle(row: Record<string, unknown>): PlanCycle {
  const status = row.status;
  return {
    id: String(row.id),
    sourceId: String(row.source_id),
    intent: String(row.intent),
    firstWeekStart: String(row.first_week_start),
    lengthWeeks: Number(row.length_weeks),
    days: Number(row.days),
    status: status === "published" || status === "superseded" ? status : "draft",
    publishedAt: (row.published_at as string | null) ?? null,
    dataLevel:
      row.data_level === "heartrate" || row.data_level === "pace_only" ? row.data_level : "none",
    startPointSource: row.start_point_source === "history" ? "history" : "questionnaire",
    createdAt: String(row.created_at),
  };
}

function toCheckin(row: Record<string, unknown>): Checkin {
  return {
    id: String(row.id),
    sourceId: String(row.source_id),
    planSessionId: (row.plan_session_id as string | null) ?? null,
    activityId: (row.activity_id as string | null) ?? null,
    sessionDate: String(row.session_date),
    effortRpe: row.effort_rpe === null || row.effort_rpe === undefined ? null : Number(row.effort_rpe),
    effortLabel: (row.effort_label as string | null) ?? null,
    pain: row.pain === true,
    painNote: (row.pain_note as string | null) ?? null,
    commentText: (row.comment_text as string | null) ?? null,
    voiceFileId: (row.voice_file_id as string | null) ?? null,
    stepBefore: row.step_before === null || row.step_before === undefined ? null : Number(row.step_before),
    stepAfter: row.step_after === null || row.step_after === undefined ? null : Number(row.step_after),
    progressionAction: (row.progression_action as string | null) ?? null,
    progressionReason: (row.progression_reason as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

/**
 * Цикл, который ученику РАЗРЕШЕНО видеть.
 *
 * Единственный вход для всего, что показывается человеку. Черновик сюда не
 * попадает никогда: пока тренер не подтвердил, плана для ученика не существует.
 */
export async function getPublishedCycle(
  sourceId: string,
  client?: Client
): Promise<PlanCycle | null> {
  const supabase = client ?? createSupabaseServerClient();
  const { data, error } = await supabase
    .from("intervals_plan_cycles")
    .select(CYCLE_COLUMNS)
    .eq("source_id", sourceId)
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`intervals_plan_cycles: ${describeSupabaseError(error)}`);
  const row = (data ?? [])[0];
  return row ? toCycle(row as unknown as Record<string, unknown>) : null;
}

/** Самый свежий цикл ЛЮБОГО статуса — для тренера, который смотрит черновик. */
export async function getLatestCycle(sourceId: string, client?: Client): Promise<PlanCycle | null> {
  const supabase = client ?? createSupabaseServerClient();
  const { data, error } = await supabase
    .from("intervals_plan_cycles")
    .select(CYCLE_COLUMNS)
    .eq("source_id", sourceId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`intervals_plan_cycles: ${describeSupabaseError(error)}`);
  const row = (data ?? [])[0];
  return row ? toCycle(row as unknown as Record<string, unknown>) : null;
}

/**
 * Сессии цикла в окне дат.
 *
 * Окно обязательно, а не «все сессии»: цикл на 12 недель по 3 тренировки — это
 * 36 строк сейчас, но у общего чтения без окна нет причины оставаться маленьким,
 * а серверный порог PostgREST (1000 строк) молча обрежет выборку, когда она
 * вырастет.
 */
export async function listSessionsInRange(
  cycleId: string,
  fromIso: string,
  toIso: string,
  client?: Client
): Promise<PlanSession[]> {
  const supabase = client ?? createSupabaseServerClient();
  const { data, error } = await supabase
    .from("intervals_plan_sessions")
    .select(SESSION_COLUMNS)
    .eq("cycle_id", cycleId)
    .gte("session_date", fromIso)
    .lte("session_date", toIso)
    .order("session_date", { ascending: true });
  if (error) throw new Error(`intervals_plan_sessions: ${describeSupabaseError(error)}`);
  return (data ?? []).map((row) => toSession(row as unknown as Record<string, unknown>));
}

export async function getSessionById(
  sessionId: string,
  client?: Client
): Promise<PlanSession | null> {
  const supabase = client ?? createSupabaseServerClient();
  const { data, error } = await supabase
    .from("intervals_plan_sessions")
    .select(SESSION_COLUMNS)
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw new Error(`intervals_plan_sessions: ${describeSupabaseError(error)}`);
  return data ? toSession(data as unknown as Record<string, unknown>) : null;
}

export async function getProgression(
  sourceId: string,
  client?: Client
): Promise<ProgressionState | null> {
  const supabase = client ?? createSupabaseServerClient();
  const { data, error } = await supabase
    .from("intervals_beginner_progression")
    .select(
      "source_id, methodology_id, methodology_version, current_step, sessions_at_step, " +
        "last_transition_at, recent_sessions, can_run_continuously"
    )
    .eq("source_id", sourceId)
    .maybeSingle();
  if (error) throw new Error(`intervals_beginner_progression: ${describeSupabaseError(error)}`);
  if (!data) return null;
  const row = data as unknown as Record<string, unknown>;
  return {
    sourceId: String(row.source_id),
    methodologyId: String(row.methodology_id),
    methodologyVersion: String(row.methodology_version),
    currentStep: Number(row.current_step),
    sessionsAtStep: Number(row.sessions_at_step),
    lastTransitionAt: (row.last_transition_at as string | null) ?? null,
    recentSessions: Array.isArray(row.recent_sessions)
      ? (row.recent_sessions as ProgressionState["recentSessions"])
      : [],
    canRunContinuously:
      row.can_run_continuously === null || row.can_run_continuously === undefined
        ? null
        : row.can_run_continuously === true,
  };
}

export async function saveProgression(
  state: {
    sourceId: string;
    methodologyId: string;
    methodologyVersion: string;
    currentStep: number;
    sessionsAtStep: number;
    lastTransitionAt: string | null;
    recentSessions: ProgressionState["recentSessions"];
    canRunContinuously: boolean | null;
  },
  client?: Client
): Promise<void> {
  const supabase = client ?? createSupabaseServerClient();
  const { error } = await supabase.from("intervals_beginner_progression").upsert(
    {
      source_id: state.sourceId,
      methodology_id: state.methodologyId,
      methodology_version: state.methodologyVersion,
      current_step: state.currentStep,
      sessions_at_step: state.sessionsAtStep,
      last_transition_at: state.lastTransitionAt,
      // Ряд намеренно подрезан: правило смотрит максимум на несколько последних
      // сессий, а хранить всю историю в jsonb значит растить строку без пользы.
      recent_sessions: state.recentSessions.slice(0, 20),
      can_run_continuously: state.canRunContinuously,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "source_id" }
  );
  if (error) throw new Error(`intervals_beginner_progression upsert: ${describeSupabaseError(error)}`);
}

export async function getCheckinForSession(
  planSessionId: string,
  client?: Client
): Promise<Checkin | null> {
  const supabase = client ?? createSupabaseServerClient();
  const { data, error } = await supabase
    .from("intervals_checkins")
    .select("*")
    .eq("plan_session_id", planSessionId)
    .maybeSingle();
  if (error) throw new Error(`intervals_checkins: ${describeSupabaseError(error)}`);
  return data ? toCheckin(data as unknown as Record<string, unknown>) : null;
}

export async function listCheckins(
  sourceId: string,
  limit = 30,
  client?: Client
): Promise<Checkin[]> {
  const supabase = client ?? createSupabaseServerClient();
  const { data, error } = await supabase
    .from("intervals_checkins")
    .select("*")
    .eq("source_id", sourceId)
    .order("session_date", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`intervals_checkins: ${describeSupabaseError(error)}`);
  return (data ?? []).map((row) => toCheckin(row as unknown as Record<string, unknown>));
}

export async function saveCheckin(
  input: {
    sourceId: string;
    planSessionId: string | null;
    activityId: string | null;
    sessionDate: string;
    effortRpe: number | null;
    effortLabel: string | null;
    pain: boolean;
    painNote: string | null;
    commentText: string | null;
    voiceFileId: string | null;
    stepBefore: number | null;
    stepAfter: number | null;
    progressionAction: string | null;
    progressionReason: string | null;
  },
  client?: Client
): Promise<Checkin> {
  const supabase = client ?? createSupabaseServerClient();
  const row = {
    source_id: input.sourceId,
    plan_session_id: input.planSessionId,
    activity_id: input.activityId,
    session_date: input.sessionDate,
    effort_rpe: input.effortRpe,
    effort_label: input.effortLabel,
    pain: input.pain,
    pain_note: input.painNote,
    comment_text: input.commentText,
    voice_file_id: input.voiceFileId,
    step_before: input.stepBefore,
    step_after: input.stepAfter,
    progression_action: input.progressionAction,
    progression_reason: input.progressionReason,
  };
  // Повторный ответ за тот же день ПРАВИТ строку, а не добавляет вторую: иначе
  // двойной тап засчитался бы как две отработанные сессии и сдвинул бы ступень
  // на ровном месте. Ключ один — (источник, день), и он же покрывает случай
  // «ответила по плану, потом отметилась ещё раз вне плана».
  const { data, error } = await supabase
    .from("intervals_checkins")
    .upsert(row, { onConflict: "source_id,session_date", ignoreDuplicates: false })
    .select("*")
    .single();
  if (error) throw new Error(`intervals_checkins upsert: ${describeSupabaseError(error)}`);
  return toCheckin(data as unknown as Record<string, unknown>);
}

export async function moveSession(
  input: {
    sessionId: string;
    toDate: string;
    toDayIdx: number;
    originalDate: string;
    originalDayIdx: number;
    alreadyMoved: boolean;
    movedBy: string;
  },
  client?: Client
): Promise<void> {
  const supabase = client ?? createSupabaseServerClient();
  const patch: Record<string, unknown> = {
    session_date: input.toDate,
    day_idx: input.toDayIdx,
    moved_at: new Date().toISOString(),
    moved_by: input.movedBy,
  };
  // Исходный день записываем ТОЛЬКО при первом переносе. Иначе второй перенос
  // затёр бы настоящий план генератора собственным предыдущим переносом, и
  // «куда это было назначено» стало бы неотличимо от «куда я это двигал».
  if (!input.alreadyMoved) {
    patch.original_session_date = input.originalDate;
    patch.original_day_idx = input.originalDayIdx;
  }
  const { error } = await supabase.from("intervals_plan_sessions").update(patch).eq("id", input.sessionId);
  if (error) throw new Error(`intervals_plan_sessions move: ${describeSupabaseError(error)}`);
}

export async function publishCycle(
  cycleId: string,
  sourceId: string,
  publishedBy: string,
  client?: Client
): Promise<void> {
  const supabase = client ?? createSupabaseServerClient();
  // Ровно один опубликованный цикл на ученика: прежние уходят в superseded
  // ДО публикации нового, чтобы между двумя запросами человек не увидел два
  // плана сразу.
  const { error: supersedeError } = await supabase
    .from("intervals_plan_cycles")
    .update({ status: "superseded" })
    .eq("source_id", sourceId)
    .eq("status", "published")
    .neq("id", cycleId);
  if (supersedeError) throw new Error(`intervals_plan_cycles supersede: ${describeSupabaseError(supersedeError)}`);

  const { error } = await supabase
    .from("intervals_plan_cycles")
    .update({ status: "published", published_at: new Date().toISOString(), published_by: publishedBy })
    .eq("id", cycleId);
  if (error) throw new Error(`intervals_plan_cycles publish: ${describeSupabaseError(error)}`);
}

export type ActivityRow = {
  activityId: string;
  name: string | null;
  startDate: string | null;
  startDateLocal: string | null;
  movingTimeS: number | null;
  distanceM: number | null;
  averageHeartrate: number | null;
  dataLevel: string;
  activityType: string | null;
};

export async function listActivitiesInRange(
  sourceId: string,
  fromIso: string,
  toIso: string,
  client?: Client
): Promise<ActivityRow[]> {
  const supabase = client ?? createSupabaseServerClient();
  const { data, error } = await supabase
    .from("intervals_activities")
    .select(
      "activity_id, name, start_date, start_date_local, moving_time_s, distance_m, " +
        "average_heartrate, data_level, activity_type"
    )
    .eq("source_id", sourceId)
    // Границы по МЕСТНОМУ времени старта: «какого числа была пробежка» — это
    // вопрос про часы ученика, а не про UTC. По UTC вечерняя пробежка уезжает
    // на следующий день и не находится по своей же дате.
    .gte("start_date_local", `${fromIso}T00:00:00`)
    .lte("start_date_local", `${toIso}T23:59:59`)
    .order("start_date_local", { ascending: false })
    .limit(200);
  if (error) throw new Error(`intervals_activities: ${describeSupabaseError(error)}`);
  return (data ?? []).map((raw) => {
    const row = raw as unknown as Record<string, unknown>;
    return {
      activityId: String(row.activity_id),
      name: (row.name as string | null) ?? null,
      startDate: (row.start_date as string | null) ?? null,
      startDateLocal: (row.start_date_local as string | null) ?? null,
      movingTimeS: row.moving_time_s === null || row.moving_time_s === undefined ? null : Number(row.moving_time_s),
      distanceM: row.distance_m === null || row.distance_m === undefined ? null : Number(row.distance_m),
      averageHeartrate:
        row.average_heartrate === null || row.average_heartrate === undefined
          ? null
          : Number(row.average_heartrate),
      dataLevel: String(row.data_level ?? "none"),
      activityType: (row.activity_type as string | null) ?? null,
    };
  });
}

function toCoachMessage(row: Record<string, unknown>): CoachMessage {
  const status = row.status;
  return {
    id: String(row.id),
    sourceId: String(row.source_id),
    planSessionId: (row.plan_session_id as string | null) ?? null,
    checkinId: (row.checkin_id as string | null) ?? null,
    activityId: (row.activity_id as string | null) ?? null,
    body: String(row.body),
    status: status === "sent" || status === "prepared" ? status : "draft",
    sentAt: (row.sent_at as string | null) ?? null,
    visibleToStudentAt: (row.visible_to_student_at as string | null) ?? null,
    createdAt: String(row.created_at),
    context: (row.context as unknown as Record<string, unknown>) ?? {},
  };
}

export async function saveCoachMessage(
  input: {
    sourceId: string;
    planSessionId: string | null;
    checkinId: string | null;
    activityId: string | null;
    body: string;
    context: Record<string, unknown>;
  },
  client?: Client
): Promise<CoachMessage> {
  const supabase = client ?? createSupabaseServerClient();
  const { data, error } = await supabase
    .from("intervals_coach_messages")
    .insert({
      source_id: input.sourceId,
      plan_session_id: input.planSessionId,
      checkin_id: input.checkinId,
      activity_id: input.activityId,
      body: input.body,
      context: input.context,
      status: "draft",
    })
    .select("*")
    .single();
  if (error) throw new Error(`intervals_coach_messages insert: ${describeSupabaseError(error)}`);
  return toCoachMessage(data as unknown as Record<string, unknown>);
}

/**
 * Отдать текст ученице: теперь она видит его в приложении.
 *
 * ОТДЕЛЬНО ОТ ДОСТАВКИ В ТЕЛЕГРАМ намеренно. Отдать ответ и уведомить о нём —
 * разные события: первое обязано случиться всегда, когда тренер нажал кнопку,
 * второе зависит от killswitch-а и от того, привязан ли чат.
 */
export async function markCoachMessageVisibleToStudent(
  messageId: string,
  client?: Client
): Promise<void> {
  const supabase = client ?? createSupabaseServerClient();
  const { error } = await supabase
    .from("intervals_coach_messages")
    .update({ visible_to_student_at: new Date().toISOString() })
    .eq("id", messageId)
    // Повторное нажатие не должно двигать дату: «когда ответ появился у неё»
    // важнее, чем «когда тренер последний раз нажал».
    .is("visible_to_student_at", null);
  if (error) throw new Error(`intervals_coach_messages visible: ${describeSupabaseError(error)}`);
}

/**
 * Что ученица видит в приложении. Только отданные тексты: черновики и
 * подготовленные, но не отданные, сюда не попадают никогда.
 */
export async function listVisibleCoachMessages(
  sourceId: string,
  limit = 10,
  client?: Client
): Promise<CoachMessage[]> {
  const supabase = client ?? createSupabaseServerClient();
  const { data, error } = await supabase
    .from("intervals_coach_messages")
    .select("*")
    .eq("source_id", sourceId)
    .not("visible_to_student_at", "is", null)
    .order("visible_to_student_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`intervals_coach_messages visible list: ${describeSupabaseError(error)}`);
  return (data ?? []).map((row) => toCoachMessage(row as unknown as Record<string, unknown>));
}

export async function markCoachMessageDelivered(
  input: {
    messageId: string;
    status: "prepared" | "sent";
    chatId: string | null;
    telegramMessageId: string | null;
  },
  client?: Client
): Promise<void> {
  const supabase = client ?? createSupabaseServerClient();
  const { error } = await supabase
    .from("intervals_coach_messages")
    .update({
      status: input.status,
      sent_at: input.status === "sent" ? new Date().toISOString() : null,
      sent_chat_id: input.chatId,
      sent_message_id: input.telegramMessageId,
    })
    .eq("id", input.messageId);
  if (error) throw new Error(`intervals_coach_messages update: ${describeSupabaseError(error)}`);
}

export async function listCoachMessages(
  sourceId: string,
  limit = 30,
  client?: Client
): Promise<CoachMessage[]> {
  const supabase = client ?? createSupabaseServerClient();
  const { data, error } = await supabase
    .from("intervals_coach_messages")
    .select("*")
    .eq("source_id", sourceId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`intervals_coach_messages: ${describeSupabaseError(error)}`);
  return (data ?? []).map((row) => toCoachMessage(row as unknown as Record<string, unknown>));
}

export async function getCoachMessageById(
  messageId: string,
  client?: Client
): Promise<CoachMessage | null> {
  const supabase = client ?? createSupabaseServerClient();
  const { data, error } = await supabase
    .from("intervals_coach_messages")
    .select("*")
    .eq("id", messageId)
    .maybeSingle();
  if (error) throw new Error(`intervals_coach_messages: ${describeSupabaseError(error)}`);
  return data ? toCoachMessage(data as unknown as Record<string, unknown>) : null;
}

/** Анкета ученика — нужна и перенос-правилам (запрещённые дни), и тренеру. */
export async function getOnboardingAnswers(
  sourceId: string,
  client?: Client
): Promise<{
  id: string;
  goalKind: string | null;
  raceDate: string | null;
  raceDistanceKm: number | null;
  daysPerWeek: number;
  unavailableWeekdays: number[];
  preferredLongWeekday: number | null;
  selfReportedWeeklyMinutes: number | null;
  canRunContinuously: boolean | null;
  coachNote: string | null;
  coachSetFields: string[];
  weekStability: string | null;
  availableWeekdays: number[];
  preferredQualityWeekday: number | null;
  timeOfDay: string | null;
  runSurfaces: string[];
  weekBreakers: string | null;
  daysPerWeekSource: string;
  maxSessionMinutes: number | null;
} | null> {
  const supabase = client ?? createSupabaseServerClient();
  const { data, error } = await supabase
    .from("intervals_onboarding_answers")
    .select(
      "id, goal_kind, race_date, race_distance_km, days_per_week, self_reported_weekly_minutes, " +
        "unavailable_weekdays, preferred_long_weekday, can_run_continuously, coach_note, coach_set_fields, " +
        "week_stability, available_weekdays, preferred_quality_weekday, time_of_day, run_surfaces, " +
        "week_breakers, days_per_week_source, max_session_minutes"
    )
    .eq("source_id", sourceId)
    .maybeSingle();
  if (error) throw new Error(`intervals_onboarding_answers: ${describeSupabaseError(error)}`);
  if (!data) return null;
  const row = data as unknown as Record<string, unknown>;
  return {
    id: String(row.id),
    goalKind: row.goal_kind === null || row.goal_kind === undefined ? null : String(row.goal_kind),
    raceDate: (row.race_date as string | null) ?? null,
    raceDistanceKm:
      row.race_distance_km === null || row.race_distance_km === undefined
        ? null
        : Number(row.race_distance_km),
    daysPerWeek: Number(row.days_per_week),
    unavailableWeekdays: Array.isArray(row.unavailable_weekdays)
      ? (row.unavailable_weekdays as number[]).map(Number)
      : [],
    preferredLongWeekday:
      row.preferred_long_weekday === null || row.preferred_long_weekday === undefined
        ? null
        : Number(row.preferred_long_weekday),
    canRunContinuously:
      row.can_run_continuously === null || row.can_run_continuously === undefined
        ? null
        : row.can_run_continuously === true,
    selfReportedWeeklyMinutes:
      row.self_reported_weekly_minutes === null || row.self_reported_weekly_minutes === undefined
        ? null
        : Number(row.self_reported_weekly_minutes),
    coachNote: (row.coach_note as string | null) ?? null,
    coachSetFields: Array.isArray(row.coach_set_fields) ? (row.coach_set_fields as string[]) : [],
    weekStability: (row.week_stability as string | null) ?? null,
    availableWeekdays: Array.isArray(row.available_weekdays)
      ? (row.available_weekdays as number[]).map(Number)
      : [],
    preferredQualityWeekday:
      row.preferred_quality_weekday === null || row.preferred_quality_weekday === undefined
        ? null
        : Number(row.preferred_quality_weekday),
    timeOfDay: (row.time_of_day as string | null) ?? null,
    runSurfaces: Array.isArray(row.run_surfaces) ? (row.run_surfaces as string[]) : [],
    weekBreakers: (row.week_breakers as string | null) ?? null,
    daysPerWeekSource: String(row.days_per_week_source ?? "answer"),
    maxSessionMinutes:
      row.max_session_minutes === null || row.max_session_minutes === undefined
        ? null
        : Number(row.max_session_minutes),
  };
}

export type OnboardingAnswersInput = {
  sourceId: string;
  goalKind: "race" | "regular" | "improve" | "start_running" | null;
  raceDate: string | null;
  raceDistanceKm: number | null;
  daysPerWeek: number;
  selfReportedWeeklyMinutes: number | null;
  unavailableWeekdays: number[];
  preferredLongWeekday: number | null;
  canRunContinuously: boolean | null;
  coachNote: string | null;
  weekStability: "stable" | "varies" | null;
  availableWeekdays: number[];
  preferredQualityWeekday: number | null;
  timeOfDay: "morning" | "evening" | "varies" | null;
  runSurfaces: string[];
  weekBreakers: string | null;
  maxSessionMinutes: number | null;
  daysPerWeekSource: "answer" | "coach" | "derived";
  /** Снимок: какие поля пришли от тренера, а не от ученика. */
  coachSetFields: string[];
};

/**
 * Анкета: одна строка на источник, повторная отправка ПРАВИТ её.
 *
 * Ограничения анкеты стоят в базе (потолок беговых дней у новичка, развилка про
 * непрерывный бег, обязательные дата и дистанция у старта) и здесь намеренно НЕ
 * продублированы. Проверка на входе была бы второй копией правила: они разошлись
 * бы при первой же правке, и разошлись бы молча. Отказ базы читается кодом
 * вызова и превращается в человеческий текст там.
 */
export async function saveOnboardingAnswers(
  input: OnboardingAnswersInput,
  client?: Client
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const supabase = client ?? createSupabaseServerClient();
  const { data, error } = await supabase
    .from("intervals_onboarding_answers")
    .upsert(
      {
        source_id: input.sourceId,
        goal_kind: input.goalKind,
        race_date: input.raceDate,
        race_distance_km: input.raceDistanceKm,
        days_per_week: input.daysPerWeek,
        self_reported_weekly_minutes: input.selfReportedWeeklyMinutes,
        unavailable_weekdays: input.unavailableWeekdays,
        preferred_long_weekday: input.preferredLongWeekday,
        can_run_continuously: input.canRunContinuously,
        coach_note: input.coachNote,
        week_stability: input.weekStability,
        available_weekdays: input.availableWeekdays,
        preferred_quality_weekday: input.preferredQualityWeekday,
        time_of_day: input.timeOfDay,
        run_surfaces: input.runSurfaces,
        week_breakers: input.weekBreakers,
        max_session_minutes: input.maxSessionMinutes,
        days_per_week_source: input.daysPerWeekSource,
        coach_set_fields: input.coachSetFields,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "source_id" }
    )
    .select("id")
    .single();
  if (error) return { ok: false, message: describeSupabaseError(error) };
  return { ok: true, id: String((data as { id: string }).id) };
}

// ── Предзаполнение анкеты тренером ───────────────────────────────────────────

export async function getPrefill(sourceId: string, client?: Client): Promise<Prefill | null> {
  const supabase = client ?? createSupabaseServerClient();
  const { data, error } = await supabase
    .from("intervals_onboarding_prefill")
    .select("*")
    .eq("source_id", sourceId)
    .maybeSingle();
  if (error) throw new Error(`intervals_onboarding_prefill: ${describeSupabaseError(error)}`);
  if (!data) return null;
  const row = data as unknown as Record<string, unknown>;
  const setFields = (Array.isArray(row.set_fields) ? (row.set_fields as string[]) : []).filter(
    isPrefillableField
  );
  return {
    sourceId: String(row.source_id),
    setFields,
    values: {
      goalKind:
        row.goal_kind === "race" || row.goal_kind === "regular" || row.goal_kind === "start_running"
          ? row.goal_kind
          : null,
      raceDate: (row.race_date as string | null) ?? null,
      raceDistanceKm:
        row.race_distance_km === null || row.race_distance_km === undefined
          ? null
          : Number(row.race_distance_km),
      daysPerWeek:
        row.days_per_week === null || row.days_per_week === undefined ? null : Number(row.days_per_week),
      selfReportedWeeklyMinutes:
        row.self_reported_weekly_minutes === null || row.self_reported_weekly_minutes === undefined
          ? null
          : Number(row.self_reported_weekly_minutes),
      unavailableWeekdays: Array.isArray(row.unavailable_weekdays)
        ? (row.unavailable_weekdays as number[]).map(Number)
        : null,
      preferredLongWeekday:
        row.preferred_long_weekday === null || row.preferred_long_weekday === undefined
          ? null
          : Number(row.preferred_long_weekday),
      canRunContinuously:
        row.can_run_continuously === null || row.can_run_continuously === undefined
          ? null
          : row.can_run_continuously === true,
      healthLimits: (row.health_limits as string | null) ?? null,
      experienceNote: (row.experience_note as string | null) ?? null,
      weekStability:
        row.week_stability === "stable" || row.week_stability === "varies" ? row.week_stability : null,
      availableWeekdays: Array.isArray(row.available_weekdays)
        ? (row.available_weekdays as number[]).map(Number)
        : null,
      preferredQualityWeekday:
        row.preferred_quality_weekday === null || row.preferred_quality_weekday === undefined
          ? null
          : Number(row.preferred_quality_weekday),
      timeOfDay:
        row.time_of_day === "morning" || row.time_of_day === "evening" || row.time_of_day === "varies"
          ? row.time_of_day
          : null,
      runSurfaces: Array.isArray(row.run_surfaces) ? (row.run_surfaces as string[]) : null,
      weekBreakers: (row.week_breakers as string | null) ?? null,
      maxSessionMinutes:
        row.max_session_minutes === null || row.max_session_minutes === undefined
          ? null
          : Number(row.max_session_minutes),
      timezone: (row.timezone as string | null) ?? null,
    },
    note: (row.note as string | null) ?? null,
    setBy: String(row.set_by ?? "coach"),
  };
}

export async function savePrefill(
  input: {
    sourceId: string;
    setFields: PrefillableField[];
    values: Partial<Prefill["values"]>;
    note: string | null;
    setBy: string;
  },
  client?: Client
): Promise<{ ok: true } | { ok: false; message: string }> {
  const supabase = client ?? createSupabaseServerClient();
  const { error } = await supabase.from("intervals_onboarding_prefill").upsert(
    {
      source_id: input.sourceId,
      set_fields: input.setFields,
      goal_kind: input.values.goalKind ?? null,
      race_date: input.values.raceDate ?? null,
      race_distance_km: input.values.raceDistanceKm ?? null,
      days_per_week: input.values.daysPerWeek ?? null,
      self_reported_weekly_minutes: input.values.selfReportedWeeklyMinutes ?? null,
      unavailable_weekdays: input.values.unavailableWeekdays ?? null,
      preferred_long_weekday: input.values.preferredLongWeekday ?? null,
      can_run_continuously: input.values.canRunContinuously ?? null,
      health_limits: input.values.healthLimits ?? null,
      experience_note: input.values.experienceNote ?? null,
      week_stability: input.values.weekStability ?? null,
      available_weekdays: input.values.availableWeekdays ?? null,
      preferred_quality_weekday: input.values.preferredQualityWeekday ?? null,
      time_of_day: input.values.timeOfDay ?? null,
      run_surfaces: input.values.runSurfaces ?? null,
      week_breakers: input.values.weekBreakers ?? null,
      max_session_minutes: input.values.maxSessionMinutes ?? null,
      timezone: input.values.timezone ?? null,
      note: input.note,
      set_by: input.setBy,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "source_id" }
  );
  if (error) return { ok: false, message: describeSupabaseError(error) };
  return { ok: true };
}
