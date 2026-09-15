/**
 * Удаление ученика Intervals вместе со всеми его данными.
 *
 * ── ПОЧЕМУ НЕ ФЛАГОМ ────────────────────────────────────────────────────────
 *
 * До сих пор «удаление» означало is_active=false, потому что права на DELETE у
 * карточек не было. От тестовых прогонов накапливались погашенные карточки: они
 * не видны в списке, но живут в базе, занимают студенческие ключи и попадают в
 * любой запрос, который забыл про фильтр. Для тестовых данных это мусор, для
 * ушедшего человека — хранение персональных данных без причины.
 *
 * ── ЧТО СТЕРЕЖЁТ ОТ БЕДЫ ────────────────────────────────────────────────────
 *
 * 1. Удаляет функция в базе (delete_intervals_student), а не этот код. Она
 *    отказывается трогать карточку, у которой площадка не intervals. Ростер
 *    TrainingPeaks недостижим физически, а не по договорённости.
 * 2. Перед удалением СЧИТАЕМ строки и показываем их человеку. «Удалить
 *    ученика?» — плохой вопрос; «удалить 412 тренировок, 18 чек-инов и 6 ваших
 *    текстов?» — хороший.
 * 3. Вызывающий обязан передать ИМЯ ученика буква в букву. Промах мимо кнопки
 *    и промах мимо строки — разные вероятности.
 */

import { createSupabaseServerClient, describeSupabaseError } from "@/features/supabase/server";

export type DeletionRow = { labelRu: string; table: string; count: number };

export type DeletionPreview = {
  studentUuid: string;
  studentName: string;
  studentKey: string;
  platform: string | null;
  isActive: boolean;
  rows: DeletionRow[];
  total: number;
  /**
   * Похоже ли это на живого человека, а не на тестовый прогон.
   *
   * Считаем по следам работы: отметки о тренировках и ответы тренера. Привезённые
   * тренировки в счёт не идут: их бывает много и у тестовой карточки, если в неё
   * копировали историю.
   */
  looksLikeRealStudent: boolean;
};

async function countRows(
  table: string,
  column: string,
  value: string | string[]
): Promise<number> {
  const supabase = createSupabaseServerClient();
  let query = supabase.from(table).select("*", { count: "exact", head: true });
  query = Array.isArray(value) ? query.in(column, value) : query.eq(column, value);
  const { count, error } = await query;
  // ОШИБКУ НЕ ГЛОТАЕМ. count:null без ошибки означает «таблицы нет», и прочитать
  // это как «строк ноль» — ровно тот случай, когда предупреждение тренеру
  // окажется вдвое меньше правды.
  if (error) throw new Error(`${table}: ${describeSupabaseError(error)}`);
  return count ?? 0;
}

export async function previewStudentDeletion(studentUuid: string): Promise<DeletionPreview | null> {
  const supabase = createSupabaseServerClient();
  const { data: card, error } = await supabase
    .from("trainingpeaks_students")
    .select("id, student_id, student_name, coaching_platform, is_active")
    .eq("id", studentUuid)
    .maybeSingle();
  if (error) throw new Error(`trainingpeaks_students: ${describeSupabaseError(error)}`);
  if (!card) return null;
  const row = card as Record<string, unknown>;

  const { data: sources } = await supabase
    .from("student_data_sources")
    .select("id")
    .eq("student_id", studentUuid);
  const sourceIds = (sources ?? []).map((item) => String((item as { id: string }).id));

  const bySource = async (table: string): Promise<number> =>
    sourceIds.length === 0 ? 0 : countRows(table, "source_id", sourceIds);

  const { data: cycles } = sourceIds.length
    ? await supabase.from("intervals_plan_cycles").select("id").in("source_id", sourceIds)
    : { data: [] as Array<{ id: string }> };
  const cycleIds = (cycles ?? []).map((item) => String((item as { id: string }).id));

  const rows: DeletionRow[] = [
    { labelRu: "карточка ученика", table: "trainingpeaks_students", count: 1 },
    { labelRu: "источник данных", table: "student_data_sources", count: sourceIds.length },
    { labelRu: "анкета", table: "intervals_onboarding_answers", count: await bySource("intervals_onboarding_answers") },
    { labelRu: "предзаполнение тренера", table: "intervals_onboarding_prefill", count: await bySource("intervals_onboarding_prefill") },
    { labelRu: "циклы плана", table: "intervals_plan_cycles", count: cycleIds.length },
    {
      labelRu: "тренировки в плане",
      table: "intervals_plan_sessions",
      count: cycleIds.length === 0 ? 0 : await countRows("intervals_plan_sessions", "cycle_id", cycleIds),
    },
    { labelRu: "ступень (прогрессия)", table: "intervals_beginner_progression", count: await bySource("intervals_beginner_progression") },
    { labelRu: "чек-ины", table: "intervals_checkins", count: await bySource("intervals_checkins") },
    { labelRu: "ваши тексты ученику", table: "intervals_coach_messages", count: await bySource("intervals_coach_messages") },
    { labelRu: "напоминания", table: "intervals_reminders", count: await bySource("intervals_reminders") },
    { labelRu: "привезённые тренировки", table: "intervals_activities", count: await countRows("intervals_activities", "student_id", studentUuid) },
    { labelRu: "заявки на подключение", table: "intervals_oauth_states", count: await countRows("intervals_oauth_states", "student_id", studentUuid) },
  ];

  const checkins = rows.find((item) => item.table === "intervals_checkins")?.count ?? 0;
  const messages = rows.find((item) => item.table === "intervals_coach_messages")?.count ?? 0;

  return {
    studentUuid,
    studentName: String(row.student_name),
    studentKey: String(row.student_id),
    platform: (row.coaching_platform as string | null) ?? null,
    isActive: row.is_active === true,
    rows,
    total: rows.reduce((sum, item) => sum + item.count, 0),
    looksLikeRealStudent: checkins + messages > 0,
  };
}

export type DeletionResult =
  | { ok: true; preview: DeletionPreview }
  | { ok: false; reason: string };

/**
 * Удалить. Имя проверяется буква в букву ДО вызова базы.
 *
 * ПОЧЕМУ ИМЯ, А НЕ ЕЩЁ ОДНО «ВЫ УВЕРЕНЫ». Второе подтверждение того же вида
 * нажимается автоматически: рука уже в движении. Набрать имя невозможно, не
 * прочитав, кого удаляешь, — и это единственный барьер, который заставляет
 * посмотреть на карточку, а не на кнопку.
 */
export async function deleteIntervalsStudentCompletely(input: {
  studentUuid: string;
  typedName: string;
}): Promise<DeletionResult> {
  const preview = await previewStudentDeletion(input.studentUuid);
  if (!preview) return { ok: false, reason: "Карточка не найдена: возможно, её уже удалили." };

  if (preview.platform !== "intervals") {
    return {
      ok: false,
      reason: `Это карточка площадки «${preview.platform ?? "не задана"}». Удалять так можно только учеников Intervals.`,
    };
  }

  const typed = input.typedName.trim();
  if (typed !== preview.studentName.trim()) {
    return {
      ok: false,
      reason: `Имя не совпало. Введите точно: ${preview.studentName}`,
    };
  }

  const supabase = createSupabaseServerClient();
  const { error } = await supabase.rpc("delete_intervals_student", {
    p_student_uuid: input.studentUuid,
  });
  if (error) return { ok: false, reason: describeSupabaseError(error) };

  return { ok: true, preview };
}
