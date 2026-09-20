/**
 * Ручной ввод тренировки: ученики без подключаемых часов.
 *
 * ── ПОЧЕМУ ЭТО ОТДЕЛЬНЫЙ МОДУЛЬ ─────────────────────────────────────────────
 *
 * Валентине и её Honor это не подошло бы: у неё Honor, он в Intervals.icu не
 * подключается. Тем не менее тренировка от неё обязана вести себя как обычная:
 * закрывать плановую сессию, двигать прогрессию, попадать в стартовую точку.
 * Вся эта механика уже есть и работает по source_id + дате (submitCheckin,
 * computeStartingPointFromHistory) — этот модуль только кладёт СТРОКУ
 * АКТИВНОСТИ, которую та механика ожидает найти, и заводит источник, под
 * который эта строка пишется.
 *
 * ── ЧЕГО ЗДЕСЬ НАМЕРЕННО НЕТ ─────────────────────────────────────────────────
 *
 * Рядов (time_s/velocity/heartrate). Их не будет никогда: человек не может
 * продиктовать посекундный ряд, а выдумать его из среднего темпа — соврать
 * генератору, что тренировка ровнее или рванее, чем была на самом деле.
 * data_level='manual' — явный сигнал остальному коду: числа (объём, средний
 * темп, средний пульс) достоверны как СРЕДНИЕ, но об интенсивности ВНУТРИ
 * тренировки судить нельзя — ровно тот же принцип, по которому генератор
 * молчит об интенсивности без пульса (см. data-quality.ts).
 */

import { createSupabaseServerClient, describeSupabaseError } from "@/features/supabase/server";

import { PENDING_ATHLETE_PREFIX } from "./repository";
import { submitCheckin, type SubmitCheckinResult } from "./loop/service";

/** Префикс синтетического external_athlete_id ручного источника. */
export const MANUAL_ATHLETE_PREFIX = "manual-";

/** Кредит-заглушка: колонка NOT NULL, секрета здесь никогда не будет. */
const MANUAL_CREDENTIAL_PLACEHOLDER = "manual-entry";

/**
 * Завести (или подтвердить уже заведённый) источник ручного ввода.
 *
 * ЗАГОТОВКА, ЗАВЕДЁННАЯ ПРИ РЕГИСТРАЦИИ, ЗАБИРАЕТСЯ, А НЕ ДУБЛИРУЕТСЯ — тот же
 * приём, что и у OAuth (connectOauthSource): переименовываем pending-строку на
 * месте, сохраняя source_id, чтобы уже сохранённое предзаполнение анкеты не
 * потерялось.
 *
 * ИДЕМПОТЕНТНО: повторный вызов на уже ручном источнике просто возвращает его
 * id, ничего не переписывая — человек мог нажать кнопку дважды.
 */
export async function provisionManualSource(
  studentUuid: string
): Promise<{ ok: true; sourceId: string } | { ok: false; message: string }> {
  const supabase = createSupabaseServerClient();

  const { data: existing, error: readError } = await supabase
    .from("student_data_sources")
    .select("id, auth_method, external_athlete_id")
    .eq("provider", "intervals")
    .eq("student_id", studentUuid)
    .maybeSingle();
  if (readError) return { ok: false, message: describeSupabaseError(readError) };

  const row = existing as { id: string; auth_method: string; external_athlete_id: string } | null;
  if (row?.auth_method === "manual") {
    // Уже ручной — нажатие повторное, ничего не делаем.
    return { ok: true, sourceId: row.id };
  }
  if (row && row.auth_method !== "manual" && !row.external_athlete_id.startsWith(PENDING_ATHLETE_PREFIX)) {
    // Настоящее подключение уже есть (OAuth или api_key) — переключать его на
    // ручной ввод тихой кнопкой нельзя: это решение теряет живые данные, и
    // принимать его молча не годится.
    return {
      ok: false,
      message: "У ученика уже есть подключение к Intervals.icu. Переключение на ручной ввод отсюда не делается.",
    };
  }

  const externalAthleteId = `${MANUAL_ATHLETE_PREFIX}${studentUuid}`;
  const now = new Date().toISOString();

  if (row) {
    // Забираем заготовку на месте: тот же source_id, предзаполнение цело.
    const { error: updateError } = await supabase
      .from("student_data_sources")
      .update({
        external_athlete_id: externalAthleteId,
        auth_method: "manual",
        credential: MANUAL_CREDENTIAL_PLACEHOLDER,
        credential_expires_at: null,
        is_active: true,
        connected_at: now,
        auth_failed_at: null,
        auth_failure_reason: null,
        updated_at: now,
      })
      .eq("id", row.id);
    if (updateError) return { ok: false, message: describeSupabaseError(updateError) };
    return { ok: true, sourceId: row.id };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("student_data_sources")
    .insert({
      student_id: studentUuid,
      provider: "intervals",
      external_athlete_id: externalAthleteId,
      auth_method: "manual",
      credential: MANUAL_CREDENTIAL_PLACEHOLDER,
      kind: "student",
      is_active: true,
      connected_at: now,
    })
    .select("id")
    .single();
  if (insertError) return { ok: false, message: describeSupabaseError(insertError) };
  return { ok: true, sourceId: String((inserted as { id: string }).id) };
}

/**
 * Перевести УЖЕ ПОДКЛЮЧЁННЫЙ источник (oauth/api_key) на ручной ввод — решение
 * тренера, не кнопка ученика.
 *
 * ЗАЧЕМ ЭТО ОТДЕЛЬНАЯ ФУНКЦИЯ, А НЕ СНЯТЫЙ ЗАСЛОН У provisionManualSource.
 * Тот заслон охраняет самообслуживание: ученик жмёт кнопку сам, и тихая потеря
 * настоящего подключения тихой кнопкой — это ровно то, чего заслон не даёт.
 * Здесь другая ситуация: тренер УЖЕ ЗНАЕТ, что подключение никогда не отдаст
 * данные (весь сегмент часов без API — Honor и подобные, см. заголовок файла),
 * и решение принимает он, глазами, а не человек по ошибке.
 *
 * ПОЧЕМУ ЭТО БЕЗОПАСНО ДЛЯ ДАННЫХ. Ничего не удаляется: intervals_activities
 * привязаны к source_id, а не к auth_method, и остаются на месте, если они
 * вообще были. Меняется только СПОСОБ, которым источник получает будущие
 * данные — с ожидания синка на самостоятельный ввод.
 *
 * ИДЕМПОТЕНТНО, КАК И provisionManualSource: повторный вызов на уже ручном
 * источнике — no-op, а не ошибка.
 */
export async function coachConvertSourceToManual(
  studentUuid: string
): Promise<
  | { ok: true; sourceId: string; previousAuthMethod: string }
  | { ok: false; message: string }
> {
  const supabase = createSupabaseServerClient();

  const { data: existing, error: readError } = await supabase
    .from("student_data_sources")
    .select("id, auth_method")
    .eq("provider", "intervals")
    .eq("student_id", studentUuid)
    .maybeSingle();
  if (readError) return { ok: false, message: describeSupabaseError(readError) };

  const row = existing as { id: string; auth_method: string } | null;
  if (!row) return { ok: false, message: "У ученика нет источника Intervals — переводить нечего." };
  if (row.auth_method === "manual") {
    return { ok: true, sourceId: row.id, previousAuthMethod: "manual" };
  }

  const externalAthleteId = `${MANUAL_ATHLETE_PREFIX}${studentUuid}`;
  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("student_data_sources")
    .update({
      external_athlete_id: externalAthleteId,
      auth_method: "manual",
      credential: MANUAL_CREDENTIAL_PLACEHOLDER,
      credential_expires_at: null,
      // СЛЕДЫ OAUTH СНИМАЮТСЯ ЯВНО, А НЕ ОСТАЮТСЯ ВИСЕТЬ. Токен настоящего
      // подключения после перевода — не секрет с истёкшим смыслом, а мусор,
      // который мог бы читаться как «подключение всё ещё где-то живо».
      oauth_scope: null,
      is_active: true,
      connected_at: now,
      auth_failed_at: null,
      auth_failure_reason: null,
      updated_at: now,
    })
    .eq("id", row.id);
  if (updateError) return { ok: false, message: describeSupabaseError(updateError) };
  return { ok: true, sourceId: row.id, previousAuthMethod: row.auth_method };
}

/** Границы поля — опечатка не должна пройти как факт. */
const MAX_DURATION_MIN = 480; // восемь часов: длиннее не бывает у бегового плана
const MIN_DURATION_MIN = 3;
const MAX_DISTANCE_KM = 100;
const MIN_HEARTRATE = 30;
const MAX_HEARTRATE = 230;
/** Разумные темпы: быстрее мировых рекордов и медленнее шага. Те же границы,
 * что у порога (intervals-set-threshold.ts) — опечатка, а не человек. */
const MIN_PACE_SEC_PER_KM = 120;
const MAX_PACE_SEC_PER_KM = 720;

export type ManualEntryInput = {
  sourceId: string;
  /** ГГГГ-ММ-ДД, местная дата ученика. */
  date: string;
  /** Единственное обязательное поле. */
  durationMinutes: number;
  distanceKm: number | null;
  averageHeartrate: number | null;
  /** Средний темп, с/км. Если не задан, а дистанция есть — считаем сами. */
  averagePaceSecPerKm: number | null;
  /** Сессия плана, которую закрывает эта тренировка. null — вне плана. */
  planSessionId: string | null;
  effortCode: string;
  painCode: string;
  commentText: string | null;
};

export type ManualEntryResult =
  | { ok: true; activityId: string; checkin: SubmitCheckinResult & { ok: true } }
  | { ok: false; code: string; messageRu: string };

function validate(input: ManualEntryInput): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return "Дата не похожа на дату.";
  if (input.date > new Date().toISOString().slice(0, 10)) return "Дата в будущем — так не бывает.";
  if (!Number.isFinite(input.durationMinutes) || input.durationMinutes < MIN_DURATION_MIN || input.durationMinutes > MAX_DURATION_MIN) {
    return `Время тренировки — от ${MIN_DURATION_MIN} минут до ${MAX_DURATION_MIN / 60} часов.`;
  }
  if (input.distanceKm !== null && (!Number.isFinite(input.distanceKm) || input.distanceKm <= 0 || input.distanceKm > MAX_DISTANCE_KM)) {
    return "Дистанция не похожа на правду.";
  }
  if (input.averageHeartrate !== null && (!Number.isFinite(input.averageHeartrate) || input.averageHeartrate < MIN_HEARTRATE || input.averageHeartrate > MAX_HEARTRATE)) {
    return `Пульс — от ${MIN_HEARTRATE} до ${MAX_HEARTRATE}.`;
  }
  if (
    input.averagePaceSecPerKm !== null &&
    (!Number.isFinite(input.averagePaceSecPerKm) || input.averagePaceSecPerKm < MIN_PACE_SEC_PER_KM || input.averagePaceSecPerKm > MAX_PACE_SEC_PER_KM)
  ) {
    return "Темп не похож на правду.";
  }
  return null;
}

/**
 * Записать тренировку и закрыть чек-ин ОДНИМ ДЕЙСТВИЕМ.
 *
 * ПОРЯДОК ВАЖЕН: строка активности пишется ПЕРВОЙ. submitCheckin сам находит
 * тренировку того же дня (listActivitiesInRange) — тем же способом, каким он
 * уже находит привезённые из Intervals активности. Второй код пути для
 * прогрессии заводить не нужно: он один на всех.
 *
 * ЕСЛИ CHECKIN НЕ ПРОШЁЛ (плохой effort/pain код, чужая сессия) — активность
 * ОСТАЁТСЯ. Это осознанный выбор: тренировка объективно была, отменять факт
 * из-за ошибки в соседнем поле формы неправильно. Отметиться можно будет
 * заново тем же экраном.
 */
export async function submitManualEntry(input: ManualEntryInput): Promise<ManualEntryResult> {
  const problem = validate(input);
  if (problem) return { ok: false, code: "bad_input", messageRu: problem };

  const supabase = createSupabaseServerClient();
  const { data: sourceRow, error: sourceError } = await supabase
    .from("student_data_sources")
    .select("student_id, auth_method")
    .eq("id", input.sourceId)
    .maybeSingle();
  if (sourceError) return { ok: false, code: "db_error", messageRu: describeSupabaseError(sourceError) };
  if (!sourceRow) return { ok: false, code: "no_source", messageRu: "Источник не найден." };

  const distanceM = input.distanceKm !== null ? Math.round(input.distanceKm * 1000) : null;
  const movingTimeS = Math.round(input.durationMinutes * 60);
  // Темп ВСЕГДА среднее по факту: если дана дистанция, считаем сами и не
  // полагаемся на то, что человек посчитал в уме верно. Если дистанции нет,
  // берём темп со слов — он ни во что не попадёт, кроме отображения (см.
  // комментарий в data-quality.ts про paceSamples: там гейт по дистанции).
  const averageSpeedMps =
    distanceM !== null && movingTimeS > 0
      ? distanceM / movingTimeS
      : input.averagePaceSecPerKm !== null
        ? 1000 / input.averagePaceSecPerKm
        : null;

  const activityId = `manual-${crypto.randomUUID()}`;
  // Времени суток человек не называет, только дату и продолжительность.
  // Полдень — нейтральный якорь: день недели и попадание в окно считаются по
  // ДАТЕ, а не по часам, так что выдумывать точное время незачем.
  const startDateLocal = `${input.date}T12:00:00`;

  const { error: insertError } = await supabase.from("intervals_activities").insert({
    source_id: input.sourceId,
    student_id: (sourceRow as { student_id: string }).student_id,
    activity_id: activityId,
    name: "Ручной ввод",
    activity_type: "Run",
    start_date: `${input.date}T12:00:00Z`,
    start_date_local: startDateLocal,
    moving_time_s: movingTimeS,
    elapsed_time_s: movingTimeS,
    distance_m: distanceM,
    average_heartrate: input.averageHeartrate,
    average_speed_mps: averageSpeedMps,
    data_level: "manual",
    has_heartrate: false,
    has_pace: false,
    hr_coverage_pct: null,
    raw: null,
  });
  if (insertError) return { ok: false, code: "db_error", messageRu: describeSupabaseError(insertError) };

  const checkin = await submitCheckin({
    sourceId: input.sourceId,
    planSessionId: input.planSessionId,
    sessionDate: input.date,
    effortCode: input.effortCode,
    painCode: input.painCode,
    commentText: input.commentText,
    voiceFileId: null,
  });
  if (!checkin.ok) {
    /**
     * ПОЛОВИНЧАТОЙ ЗАПИСИ НЕ ОСТАЁТСЯ [20.09.2026].
     *
     * Две записи идут подряд: активность, потом чек-ин. Если падал второй,
     * первая ОСТАВАЛАСЬ — и получалась пробежка без отчёта: человек видел
     * отказ и был уверен, что не отправил ничего, а в базе висела тренировка.
     * Дальше она молча участвовала в расчётах, как настоящая.
     *
     * Транзакции здесь нет (две отдельные записи через PostgREST), поэтому
     * откатываем компенсацией: удаляем активность, которую только что завели.
     * Удаляем ИМЕННО свою, по сгенерированному activity_id — чужого не трогаем
     * ни при каком исходе.
     *
     * Если и откат не прошёл, говорим об этом ОТДЕЛЬНОЙ строкой в логе: тогда
     * сирота всё-таки осталась, и это должно быть видно, а не выясняться через
     * неделю по странным числам.
     */
    const { error: rollbackError } = await supabase
      .from("intervals_activities")
      .delete()
      .eq("source_id", input.sourceId)
      .eq("activity_id", activityId);
    if (rollbackError) {
      console.error("[intervals.manual-entry] откат активности не прошёл", {
        activityId,
        sourceId: input.sourceId,
        error: describeSupabaseError(rollbackError),
      });
    }
    return { ok: false, code: checkin.code, messageRu: checkin.messageRu };
  }
  return { ok: true, activityId, checkin };
}

/** Ручной ли ввод у ученика — для бота и прочих мест, которым нужен только факт. */
export async function isManualEntryStudent(studentUuid: string): Promise<boolean> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("student_data_sources")
    .select("auth_method")
    .eq("student_id", studentUuid)
    .eq("provider", "intervals")
    .maybeSingle();
  return (data as { auth_method?: string } | null)?.auth_method === "manual";
}
