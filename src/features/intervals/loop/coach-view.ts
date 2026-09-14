/**
 * Всё про ученика Intervals одной выборкой — для экрана тренера.
 *
 * Тренеру нужно ровно четыре вещи разом: её план, её чек-ины, её тренировки из
 * Intervals и на какой она ступени. Собираем их здесь, а не в странице, чтобы
 * страница осталась разметкой, а состав данных можно было прогнать проверкой.
 */

import { createSupabaseServerClient, describeSupabaseError } from "@/features/supabase/server";
import { stepByIndex } from "@/features/methodology/beginner";

import {
  getLatestCycle,
  getOnboardingAnswers,
  getProgression,
  getPublishedCycle,
  listActivitiesInRange,
  listCheckins,
  listCoachMessages,
  listSessionsInRange,
  type ActivityRow,
} from "./repository";
import { assessConnectionHealth, type ConnectionHealth } from "./connection-health";
import { getSourceConnection } from "../repository";
import type { Checkin, CoachMessage, PlanCycle, PlanSession, ProgressionState } from "./types";

export type IntervalsStudentRow = {
  studentUuid: string;
  studentId: string;
  studentName: string;
  sourceId: string | null;
  externalAthleteId: string | null;
  telegramChatId: string | null;
  telegramUserId: number | null;
  telegramDeliveryEnabled: boolean;
  lastSyncedAt: string | null;
  /** Зона ученика. null — не определилась, время считается по зоне тренера. */
  timezone: string | null;
};

/**
 * Сигналы в списке: что видно, не заходя в карточку.
 *
 * ЗАЧЕМ. На десяти учениках обход «открыть карточку, прокрутить, закрыть»
 * стоит полсотни кликов каждое утро, и это при том, что писать обычно надо
 * троим. Список без сигналов заставляет открывать всех, потому что заранее
 * неизвестно, у кого есть что отвечать. Сигналы переворачивают это: тренер
 * открывает тех, у кого горит.
 */
export type StudentSignals = {
  /** Чек-ины, на которые тренер ещё не ответил ни одним текстом. */
  unansweredCheckins: number;
  /**
   * Пробежка приехала, а отметки за тот день нет. Это НЕ то же самое, что
   * «нет данных»: данные как раз есть, молчит человек.
   */
  missedCheckinDates: string[];
  /** Состояние связи с Intervals, тот же диагноз, что и в карточке. */
  connection: ConnectionHealth["state"];
  /** План собран, но ученица его ещё не видит. */
  planWaitingPublish: boolean;
  /** Плана нет вообще: ни черновика, ни опубликованного. */
  noPlan: boolean;
};

/**
 * Насколько срочно смотреть этого человека. Чем больше, тем выше в списке.
 *
 * ПОРЯДОК ВАЖНЕЕ КРАСОТЫ: сломанная связь бьёт по всему остальному (данных нет
 * — нечего разбирать), поэтому она выше неотвеченных чек-инов. План, который
 * ждёт публикации, идёт следом: пока тренер не нажал, человек сидит без плана.
 */
export function signalWeight(signals: StudentSignals): number {
  let weight = 0;
  if (signals.connection === "auth_revoked") weight += 1000;
  if (signals.connection === "connected_but_silent") weight += 800;
  if (signals.connection === "not_connected") weight += 600;
  if (signals.planWaitingPublish) weight += 500;
  if (signals.noPlan) weight += 400;
  weight += signals.unansweredCheckins * 50;
  weight += signals.missedCheckinDates.length * 30;
  return weight;
}

/** Короткая строка «что делать», словами тренера. Пусто — всё спокойно. */
export function signalLabelsRu(signals: StudentSignals): string[] {
  const labels: string[] = [];
  if (signals.connection === "auth_revoked") labels.push("доступ отозван");
  if (signals.connection === "connected_but_silent") labels.push("данных нет, а бегает");
  if (signals.connection === "not_connected") labels.push("часы не подключены");
  if (signals.noPlan) labels.push("плана нет");
  if (signals.planWaitingPublish) labels.push("план ждёт публикации");
  if (signals.unansweredCheckins > 0) labels.push(`ответить: ${signals.unansweredCheckins}`);
  if (signals.missedCheckinDates.length > 0) {
    labels.push(`не отметилась: ${signals.missedCheckinDates.length}`);
  }
  return labels;
}

/** Список учеников, которых ведут в Intervals. Ростера TP не касается. */
export async function listIntervalsStudents(): Promise<IntervalsStudentRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .select(
      "id, student_id, student_name, telegram_chat_id, telegram_user_id, telegram_delivery_enabled, timezone"
    )
    .eq("coaching_platform", "intervals")
    .eq("is_active", true)
    .order("student_name", { ascending: true });
  if (error) throw new Error(`trainingpeaks_students: ${describeSupabaseError(error)}`);

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) return [];

  const { data: sources, error: sourceError } = await supabase
    .from("student_data_sources")
    .select("id, student_id, external_athlete_id, last_synced_at")
    .eq("provider", "intervals")
    .in("student_id", rows.map((row) => String(row.id)));
  if (sourceError) throw new Error(`student_data_sources: ${describeSupabaseError(sourceError)}`);

  const byStudent = new Map<string, Record<string, unknown>>();
  for (const raw of sources ?? []) {
    const row = raw as unknown as Record<string, unknown>;
    byStudent.set(String(row.student_id), row);
  }

  return rows.map((row) => {
    const source = byStudent.get(String(row.id));
    return {
      studentUuid: String(row.id),
      studentId: String(row.student_id),
      studentName: String(row.student_name),
      sourceId: source ? String(source.id) : null,
      externalAthleteId: source ? String(source.external_athlete_id) : null,
      telegramChatId: (row.telegram_chat_id as string | null) ?? null,
      telegramUserId:
        row.telegram_user_id === null || row.telegram_user_id === undefined
          ? null
          : Number(row.telegram_user_id),
      telegramDeliveryEnabled: row.telegram_delivery_enabled === true,
      lastSyncedAt: source ? ((source.last_synced_at as string | null) ?? null) : null,
      timezone: (row.timezone as string | null) ?? null,
    };
  });
}

/**
 * Сигналы по всем ученикам сразу.
 *
 * ОДНОЙ ПАЧКОЙ, А НЕ ПО ОДНОМУ. Обход по ученику дал бы пять запросов на
 * человека и пятьдесят на десятерых, то есть список открывался бы дольше, чем
 * карточка. Здесь пять запросов на весь список независимо от его длины.
 *
 * ОКНО 14 ДНЕЙ. Чек-ин двухнедельной давности, на который не ответили, это уже
 * не «надо ответить», а «поезд ушёл»; тянуть его в сигналы значит держать
 * красную метку, которую невозможно погасить.
 */
export async function loadStudentsSignals(
  students: IntervalsStudentRow[],
  todayIso: string
): Promise<Map<string, StudentSignals>> {
  const result = new Map<string, StudentSignals>();
  const sourceIds = students.map((student) => student.sourceId).filter((id): id is string => id !== null);
  if (sourceIds.length === 0) {
    for (const student of students) {
      result.set(student.studentUuid, {
        unansweredCheckins: 0,
        missedCheckinDates: [],
        connection: "not_connected",
        planWaitingPublish: false,
        noPlan: true,
      });
    }
    return result;
  }

  const supabase = createSupabaseServerClient();
  const from = shift(todayIso, -14);
  const activityFrom = shift(todayIso, -3);

  const [cycles, checkins, messages, activities, sources] = await Promise.all([
    supabase
      .from("intervals_plan_cycles")
      .select("id, source_id, status, created_at")
      .in("source_id", sourceIds)
      .order("created_at", { ascending: false }),
    supabase
      .from("intervals_checkins")
      .select("id, source_id, session_date")
      .in("source_id", sourceIds)
      .gte("session_date", from),
    supabase
      .from("intervals_coach_messages")
      .select("checkin_id, source_id")
      .in("source_id", sourceIds)
      .not("checkin_id", "is", null),
    supabase
      .from("intervals_activities")
      .select("source_id, start_date_local")
      .in("source_id", sourceIds)
      .gte("start_date_local", `${activityFrom}T00:00:00`),
    supabase
      .from("student_data_sources")
      .select("id, is_active, connected_at, auth_failed_at")
      .in("id", sourceIds),
  ]);

  const latestCycleBySource = new Map<string, { status: string }>();
  for (const raw of cycles.data ?? []) {
    const row = raw as unknown as Record<string, unknown>;
    const key = String(row.source_id);
    if (!latestCycleBySource.has(key)) latestCycleBySource.set(key, { status: String(row.status) });
  }

  const answered = new Set(
    (messages.data ?? []).map((raw) => String((raw as Record<string, unknown>).checkin_id))
  );

  const checkinsBySource = new Map<string, Array<{ id: string; date: string }>>();
  for (const raw of checkins.data ?? []) {
    const row = raw as unknown as Record<string, unknown>;
    const key = String(row.source_id);
    const list = checkinsBySource.get(key) ?? [];
    list.push({ id: String(row.id), date: String(row.session_date) });
    checkinsBySource.set(key, list);
  }

  const activityDatesBySource = new Map<string, Set<string>>();
  for (const raw of activities.data ?? []) {
    const row = raw as unknown as Record<string, unknown>;
    const key = String(row.source_id);
    const date = String(row.start_date_local ?? "").slice(0, 10);
    if (!date) continue;
    const set = activityDatesBySource.get(key) ?? new Set<string>();
    set.add(date);
    activityDatesBySource.set(key, set);
  }

  const sourceById = new Map<string, Record<string, unknown>>();
  for (const raw of sources.data ?? []) {
    const row = raw as unknown as Record<string, unknown>;
    sourceById.set(String(row.id), row);
  }

  for (const student of students) {
    if (!student.sourceId) {
      result.set(student.studentUuid, {
        unansweredCheckins: 0,
        missedCheckinDates: [],
        connection: "not_connected",
        planWaitingPublish: false,
        noPlan: true,
      });
      continue;
    }
    const sourceId = student.sourceId;
    const own = checkinsBySource.get(sourceId) ?? [];
    const checkinDates = new Set(own.map((item) => item.date));
    const activityDates = activityDatesBySource.get(sourceId) ?? new Set<string>();
    const sourceRow = sourceById.get(sourceId);
    const cycle = latestCycleBySource.get(sourceId);

    const health = assessConnectionHealth({
      todayIso,
      connection: sourceRow
        ? {
            connectedAtIso: (sourceRow.connected_at as string | null) ?? null,
            authFailedAtIso: (sourceRow.auth_failed_at as string | null) ?? null,
            isActive: sourceRow.is_active === true,
          }
        : null,
      activityDates: [...activityDates],
      checkinDates: own.map((item) => item.date),
    });

    result.set(student.studentUuid, {
      unansweredCheckins: own.filter((item) => !answered.has(item.id)).length,
      // Сегодняшний день не считаем: человек ещё бежит или только вернулся, и
      // требовать отметку через час после пробежки значит торопить.
      missedCheckinDates: [...activityDates]
        .filter((date) => date < todayIso && !checkinDates.has(date))
        .sort(),
      connection: health.state,
      planWaitingPublish: cycle?.status === "draft",
      noPlan: cycle === undefined,
    });
  }

  return result;
}

export type CoachStudentView = {
  student: IntervalsStudentRow;
  answers: Awaited<ReturnType<typeof getOnboardingAnswers>>;
  progression: ProgressionState | null;
  stepLabelRu: string | null;
  /** Последний цикл любого статуса — тренер смотрит и черновик. */
  latestCycle: PlanCycle | null;
  publishedCycleId: string | null;
  sessions: PlanSession[];
  checkins: Checkin[];
  activities: ActivityRow[];
  messages: CoachMessage[];
  /** Чек-ины, на которые тренер ещё не ответил ни одним текстом. */
  unansweredCheckinIds: Set<string>;
  /** Идут ли данные вообще. Главное, что тренер должен увидеть первым. */
  connectionHealth: ConnectionHealth;
};

export async function loadCoachStudentView(
  student: IntervalsStudentRow,
  todayIso: string
): Promise<CoachStudentView> {
  if (!student.sourceId) {
    return {
      student,
      answers: null,
      progression: null,
      stepLabelRu: null,
      latestCycle: null,
      publishedCycleId: null,
      sessions: [],
      checkins: [],
      activities: [],
      messages: [],
      unansweredCheckinIds: new Set(),
      connectionHealth: { state: "not_connected" },
    };
  }

  const sourceId = student.sourceId;
  const from = shift(todayIso, -21);
  const to = shift(todayIso, 21);

  const [answers, progression, latestCycle, publishedCycle, checkins, activities, messages] =
    await Promise.all([
      getOnboardingAnswers(sourceId),
      getProgression(sourceId),
      getLatestCycle(sourceId),
      getPublishedCycle(sourceId),
      listCheckins(sourceId, 40),
      listActivitiesInRange(sourceId, from, to),
      listCoachMessages(sourceId, 40),
    ]);

  const sessions = latestCycle ? await listSessionsInRange(latestCycle.id, from, to) : [];

  const connection = await getSourceConnection(student.studentUuid);
  const connectionHealth = assessConnectionHealth({
    todayIso,
    connection: connection
      ? {
          connectedAtIso: connection.connectedAt,
          authFailedAtIso: connection.authFailedAt,
          isActive: connection.isActive,
        }
      : null,
    activityDates: activities
      .map((activity) => activity.startDateLocal?.slice(0, 10) ?? "")
      .filter(Boolean),
    // Только те чек-ины, в которых человек ПОДТВЕРДИЛ тренировку: строка
    // чек-ина существует ровно потому, что он отметил, как она прошла.
    checkinDates: checkins.map((checkin) => checkin.sessionDate),
  });

  const answered = new Set(
    messages.map((message) => message.checkinId).filter((id): id is string => id !== null)
  );

  return {
    student,
    answers,
    progression,
    stepLabelRu: progression ? stepByIndex(progression.currentStep).labelRu : null,
    latestCycle,
    publishedCycleId: publishedCycle?.id ?? null,
    sessions,
    checkins,
    activities,
    messages,
    unansweredCheckinIds: new Set(
      checkins.filter((checkin) => !answered.has(checkin.id)).map((checkin) => checkin.id)
    ),
    connectionHealth,
  };
}

function shift(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
