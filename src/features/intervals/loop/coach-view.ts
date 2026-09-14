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
};

/** Список учеников, которых ведут в Intervals. Ростера TP не касается. */
export async function listIntervalsStudents(): Promise<IntervalsStudentRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .select(
      "id, student_id, student_name, telegram_chat_id, telegram_user_id, telegram_delivery_enabled"
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
    };
  });
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
  };
}

function shift(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
