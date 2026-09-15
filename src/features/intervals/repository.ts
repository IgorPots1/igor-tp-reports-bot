/** Чтение и запись приёма Intervals.icu. Только база — ни сети, ни решений. */

import { randomUUID } from "node:crypto";

import { createSupabaseServerClient, describeSupabaseError } from "@/features/supabase/server";

import { assessDataQuality } from "./data-quality";
import type {
  ActivityStreams,
  DataSourceKind,
  IntervalsActivity,
  StudentDataSource,
} from "./types";

type SourceRow = {
  id: string;
  student_id: string | null;
  kind: string;
  provider: string;
  external_athlete_id: string;
  auth_method: string;
  credential: string;
  is_active: boolean;
  last_synced_at: string | null;
};

function toDomainSource(row: SourceRow): StudentDataSource {
  return {
    id: row.id,
    studentId: row.student_id,
    kind: row.kind === "self" || row.kind === "test" ? row.kind : "student",
    provider: "intervals",
    externalAthleteId: row.external_athlete_id,
    authMethod: row.auth_method === "oauth" ? "oauth" : "api_key",
    credential: row.credential,
    isActive: row.is_active,
    lastSyncedAt: row.last_synced_at,
  };
}

// Колонки перечислены поимённо, а не select("*"), сознательно: так секрет
// попадает в память только там, где он нужен для заголовка, и ни один будущий
// «покажем источники в админке» не утащит credential случайно.
const SOURCE_COLUMNS_WITH_SECRET =
  "id, student_id, kind, provider, external_athlete_id, auth_method, credential, is_active, last_synced_at";

/**
 * Источник ученика ВМЕСТЕ С СЕКРЕТОМ. Звать только оттуда, где сейчас же
 * собирают заголовок авторизации. Никогда — из кода, который что-то отдаёт
 * наружу.
 */
export async function getSourceWithSecret(
  studentUuid: string,
  provider: "intervals" = "intervals"
): Promise<StudentDataSource | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("student_data_sources")
    .select(SOURCE_COLUMNS_WITH_SECRET)
    .eq("student_id", studentUuid)
    .eq("provider", provider)
    .maybeSingle();

  if (error) {
    throw new Error(`Не удалось прочитать источник ученика: ${describeSupabaseError(error)}`);
  }
  return data ? toDomainSource(data as SourceRow) : null;
}

/**
 * Источник по athlete_id провайдера, ВМЕСТЕ С СЕКРЕТОМ.
 *
 * Для источников без владельца (kind self/test) это единственный способ их
 * найти: student_id у них NULL, и поиск «по ученику» для них не существует.
 */
export async function getSourceByAthlete(
  externalAthleteId: string,
  provider: "intervals" = "intervals"
): Promise<StudentDataSource | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("student_data_sources")
    .select(SOURCE_COLUMNS_WITH_SECRET)
    .eq("provider", provider)
    .eq("external_athlete_id", externalAthleteId)
    .maybeSingle();

  if (error) {
    throw new Error(`Не удалось прочитать источник по athlete: ${describeSupabaseError(error)}`);
  }
  return data ? toDomainSource(data as SourceRow) : null;
}

/** Ученик по человекочитаемому student_id из trainingpeaks_students. */
export async function findStudentByKey(
  studentKey: string
): Promise<{ id: string; studentId: string; studentName: string } | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .select("id, student_id, student_name")
    .eq("student_id", studentKey)
    .maybeSingle();

  if (error) {
    throw new Error(`Не удалось найти ученика: ${describeSupabaseError(error)}`);
  }
  return data
    ? { id: data.id as string, studentId: data.student_id as string, studentName: data.student_name as string }
    : null;
}

/**
 * Заводит или обновляет источник. Секрет приходит параметром и НЕ попадает ни в
 * лог, ни в возвращаемое значение — наружу уходит только id строки.
 */
export async function upsertSource(input: {
  /** null допустим только для kind self/test — это стережёт констрейнт в базе. */
  studentUuid: string | null;
  kind: DataSourceKind;
  externalAthleteId: string;
  authMethod: "api_key" | "oauth";
  credential: string;
  credentialExpiresAt?: string | null;
}): Promise<string> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("student_data_sources")
    .upsert(
      {
        student_id: input.studentUuid,
        kind: input.kind,
        provider: "intervals",
        external_athlete_id: input.externalAthleteId,
        auth_method: input.authMethod,
        credential: input.credential,
        credential_expires_at: input.credentialExpiresAt ?? null,
        is_active: true,
      },
      // Конфликт по (provider, external_athlete_id), а НЕ по (student_id, provider):
      // у источников без владельца student_id равен NULL, а Postgres считает
      // NULL-ы различными — уникальный индекс с ним пропустил бы второй такой
      // же источник, и повторный запуск завёл бы дубль вместо обновления.
      // athlete_id есть всегда и всегда осмыслен.
      { onConflict: "provider,external_athlete_id" }
    )
    .select("id")
    .single();

  if (error) {
    throw new Error(`Не удалось сохранить источник: ${describeSupabaseError(error)}`);
  }
  return data.id as string;
}

export async function markSourceSynced(sourceId: string): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("student_data_sources")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", sourceId);

  if (error) {
    throw new Error(`Не удалось отметить синхронизацию: ${describeSupabaseError(error)}`);
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * Сохраняет активность и её ряды.
 *
 * Идемпотентность держится на upsert по activity_id: второй прогон по тому же
 * периоду обновит строки и не создаст ни одной новой. Проверять «а нет ли уже»
 * отдельным запросом не нужно и вредно — между проверкой и вставкой всегда
 * помещается второй прогон.
 */
export async function saveActivity(input: {
  sourceId: string;
  /** null — активность из источника без владельца. */
  studentUuid: string | null;
  activity: IntervalsActivity;
  streams: ActivityStreams | null;
}): Promise<{ activityId: string; streamsSaved: boolean }> {
  const supabase = createSupabaseServerClient();
  const { activity } = input;
  const quality = assessDataQuality(input.streams);

  const { error: activityError } = await supabase.from("intervals_activities").upsert(
    {
      source_id: input.sourceId,
      student_id: input.studentUuid,
      activity_id: activity.id,
      name: textOrNull(activity.name),
      activity_type: textOrNull(activity.type),
      start_date: textOrNull(activity.start_date),
      start_date_local: textOrNull(activity.start_date_local),
      timezone: textOrNull(activity.timezone),
      moving_time_s: numberOrNull(activity.moving_time),
      elapsed_time_s: numberOrNull(activity.elapsed_time),
      distance_m: numberOrNull(activity.distance),
      total_elevation_gain_m: numberOrNull(activity.total_elevation_gain),
      average_heartrate: numberOrNull(activity.average_heartrate),
      max_heartrate: numberOrNull(activity.max_heartrate),
      average_speed_mps: numberOrNull(activity.average_speed),
      calories: numberOrNull(activity.calories),
      data_level: quality.dataLevel,
      has_heartrate: quality.hasHeartrate,
      has_pace: quality.hasPace,
      hr_coverage_pct: quality.hrCoveragePct,
      raw: activity,
    },
    { onConflict: "activity_id" }
  );

  if (activityError) {
    throw new Error(
      `Не удалось сохранить активность ${activity.id}: ${describeSupabaseError(activityError)}`
    );
  }

  if (!input.streams) {
    return { activityId: activity.id, streamsSaved: false };
  }

  // Ряды обязаны быть параллельными. Расхождение длин — признак битой выгрузки,
  // и записывать её нельзя: дальше по ним будут считать темп поточечно, и сдвиг
  // на одну точку тихо испортит весь расчёт.
  const { time, heartrate, velocitySmooth } = input.streams;
  for (const [label, series] of [
    ["heartrate", heartrate],
    ["velocity_smooth", velocitySmooth],
  ] as const) {
    if (series && series.length !== time.length) {
      throw new Error(
        `Активность ${activity.id}: длина ряда ${label} (${series.length}) не совпадает с осью времени (${time.length})`
      );
    }
  }

  const { error: streamsError } = await supabase.from("intervals_activity_streams").upsert(
    {
      activity_id: activity.id,
      point_count: time.length,
      time_s: time,
      heartrate,
      velocity_smooth: velocitySmooth,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: "activity_id" }
  );

  if (streamsError) {
    throw new Error(
      `Не удалось сохранить ряды ${activity.id}: ${describeSupabaseError(streamsError)}`
    );
  }

  return { activityId: activity.id, streamsSaved: true };
}

/**
 * Сводка по ИСТОЧНИКУ, а не по ученику: у источников без владельца ученика нет,
 * а сводка нужна одинаково. source_id есть у любой привезённой активности.
 */
export async function summariseSource(sourceId: string): Promise<{
  total: number;
  withHeartrate: number;
  paceOnly: number;
  noData: number;
}> {
  const supabase = createSupabaseServerClient();
  const counts = { total: 0, withHeartrate: 0, paceOnly: 0, noData: 0 };

  // Считаем на сервере через head+count, а не выборкой строк: выборка упёрлась
  // бы в порог db-max-rows=1000 и занизила бы числа молча.
  for (const [key, level] of [
    ["withHeartrate", "heartrate"],
    ["paceOnly", "pace_only"],
    ["noData", "none"],
  ] as const) {
    const { count, error } = await supabase
      .from("intervals_activities")
      .select("id", { head: true, count: "exact" })
      .eq("source_id", sourceId)
      .eq("data_level", level);
    if (error) {
      throw new Error(`Не удалось посчитать сводку: ${describeSupabaseError(error)}`);
    }
    counts[key] = count ?? 0;
  }

  counts.total = counts.withHeartrate + counts.paceOnly + counts.noData;
  return counts;
}

/** Длины рядов конкретной активности — для точечной проверки выгрузки. */
export async function getStreamLengths(activityId: string): Promise<{
  pointCount: number;
  time: number;
  heartrate: number | null;
  velocitySmooth: number | null;
} | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("intervals_activity_streams")
    .select("point_count, time_s, heartrate, velocity_smooth")
    .eq("activity_id", activityId)
    .maybeSingle();

  if (error) {
    throw new Error(`Не удалось прочитать ряды: ${describeSupabaseError(error)}`);
  }
  if (!data) return null;

  return {
    pointCount: data.point_count as number,
    time: Array.isArray(data.time_s) ? data.time_s.length : 0,
    heartrate: Array.isArray(data.heartrate) ? data.heartrate.length : null,
    velocitySmooth: Array.isArray(data.velocity_smooth) ? data.velocity_smooth.length : null,
  };
}

// ── OAuth: одноразовое состояние и привязка источника ────────────────────────

/**
 * Завести state для потока авторизации.
 *
 * Случайность берётся у crypto, а не у Math.random: state — это предъявление
 * «мы выдали именно эту ссылку», и предсказуемое значение лишает его смысла.
 */
export async function createOauthState(studentUuid: string): Promise<string> {
  const supabase = createSupabaseServerClient();
  const state = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "").slice(0, 8);
  const { error } = await supabase
    .from("intervals_oauth_states")
    .insert({ state, student_id: studentUuid });
  if (error) throw new Error(`intervals_oauth_states insert: ${describeSupabaseError(error)}`);
  return state;
}

/** Сколько живёт выданная ссылка. Человек идёт по ней сразу, час с запасом. */
const OAUTH_STATE_TTL_MS = 60 * 60 * 1000;

export type OauthStateCheck =
  | { ok: true; studentUuid: string }
  | { ok: false; code: "unknown" | "replayed" | "expired" };

/**
 * Погасить state и сказать, чей он был.
 *
 * ГАСИМ ДО ПРОВЕРКИ СРОКА и одним условным апдейтом: два параллельных возврата
 * (человек нажал дважды, браузер повторил запрос) иначе оба прошли бы проверку
 * и оба завели бы источник.
 */
export async function consumeOauthState(state: string): Promise<OauthStateCheck> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("intervals_oauth_states")
    .update({ used_at: new Date().toISOString() })
    .eq("state", state)
    .is("used_at", null)
    .select("student_id, created_at")
    .maybeSingle();
  if (error) throw new Error(`intervals_oauth_states update: ${describeSupabaseError(error)}`);

  if (!data) {
    // Либо такого state не было вовсе, либо он уже погашен. Различаем: первое —
    // чужая или обрезанная ссылка, второе — повтор, и человеку это разные слова.
    const { data: existing } = await supabase
      .from("intervals_oauth_states")
      .select("state")
      .eq("state", state)
      .maybeSingle();
    return { ok: false, code: existing ? "replayed" : "unknown" };
  }

  const row = data as unknown as Record<string, unknown>;
  const createdAt = Date.parse(String(row.created_at));
  if (Number.isFinite(createdAt) && Date.now() - createdAt > OAUTH_STATE_TTL_MS) {
    return { ok: false, code: "expired" };
  }
  return { ok: true, studentUuid: String(row.student_id) };
}

export async function recordOauthOutcome(
  state: string,
  outcome: "connected" | "denied" | "failed" | "expired" | "replayed"
): Promise<void> {
  const supabase = createSupabaseServerClient();
  // Отметка исхода не должна ронять поток: человек уже дошёл до конца.
  const { error } = await supabase
    .from("intervals_oauth_states")
    .update({ outcome, used_at: new Date().toISOString() })
    .eq("state", state);
  if (error) console.warn("[intervals.oauth] не удалось записать исход", { error: error.message });
}

/**
 * Положить выданный токен в источник ученика.
 *
 * Апсерт по (provider, external_athlete_id) — тот же ключ, что у ручного
 * заведения. Так повторное подключение того же аккаунта обновляет строку, а не
 * спорит с уникальным индексом.
 *
 * ЕСЛИ АККАУНТ УЖЕ ПРИВЯЗАН К ДРУГОМУ ЧЕЛОВЕКУ — отказываемся. Молча перевесить
 * источник значило бы отдать чужие тренировки в чужую карточку.
 */
/**
 * Адрес источника-заготовки, заведённого тренером до подключения.
 *
 * Живёт здесь, а не в модуле заведения, потому что главный его читатель —
 * именно OAuth: он обязан узнать заготовку и забрать её себе, а не завести
 * рядом вторую строку.
 */
export const PENDING_ATHLETE_PREFIX = "pending-";

export async function connectOauthSource(input: {
  studentUuid: string;
  externalAthleteId: string;
  accessToken: string;
  scope: string | null;
}): Promise<{ ok: true; sourceId: string } | { ok: false; reason: string }> {
  const supabase = createSupabaseServerClient();

  const { data: existing, error: readError } = await supabase
    .from("student_data_sources")
    .select("id, student_id, kind")
    .eq("provider", "intervals")
    .eq("external_athlete_id", input.externalAthleteId)
    .maybeSingle();
  if (readError) return { ok: false, reason: describeSupabaseError(readError) };

  const existingRow = existing as { student_id: string | null; kind?: string } | null;
  const owner = existingRow?.student_id ?? null;
  if (existingRow && owner !== input.studentUuid) {
    // ВЛАДЕЛЕЦ NULL ТОЖЕ СЧИТАЕТСЯ ЧУЖИМ. Источник без ученика — это аккаунт
    // тренера (kind='self') или техническое подключение: перехватив его,
    // OAuth переписал бы способ доступа и владельца у строки, за которой стоят
    // чужие привезённые тренировки. Тренер отдельным решением завёл себя НЕ
    // учеником, и подключение через приложение не вправе это отменять.
    return {
      ok: false,
      reason: owner
        ? "этот аккаунт Intervals уже подключён к другому ученику"
        : `аккаунт ${input.externalAthleteId} уже заведён как источник тренера (kind=${existingRow.kind ?? "?"})`,
    };
  }

  // ЗАГОТОВКА, ЗАВЕДЁННАЯ ТРЕНЕРОМ, ЗАБИРАЕТСЯ, А НЕ ДУБЛИРУЕТСЯ. На ней уже
  // висит предзаполнение анкеты (ключ предзаполнения — source_id), и завести
  // рядом вторую строку значит потерять ответы тренера и оставить человеку
  // вопросы, на которые за него уже ответили.
  const { data: pendingRows } = await supabase
    .from("student_data_sources")
    .select("id, external_athlete_id")
    .eq("provider", "intervals")
    .eq("student_id", input.studentUuid)
    .like("external_athlete_id", `${PENDING_ATHLETE_PREFIX}%`);
  const pendingRow = (pendingRows ?? [])[0] as { id: string } | undefined;
  if (pendingRow) {
    if (existingRow) {
      // Настоящая строка уже есть (подключался раньше) — заготовка лишняя.
      await supabase.from("student_data_sources").delete().eq("id", pendingRow.id);
    } else {
      // Переименовываем ДО апсерта: после переименования апсерт найдёт её по
      // (provider, athlete id) и дозаполнит токеном, сохранив тот же source_id.
      const { error: claimError } = await supabase
        .from("student_data_sources")
        .update({ external_athlete_id: input.externalAthleteId })
        .eq("id", pendingRow.id);
      if (claimError) return { ok: false, reason: describeSupabaseError(claimError) };
    }
  }

  const { data, error } = await supabase
    .from("student_data_sources")
    .upsert(
      {
        student_id: input.studentUuid,
        provider: "intervals",
        external_athlete_id: input.externalAthleteId,
        auth_method: "oauth",
        credential: input.accessToken,
        // У токенов Intervals срока жизни нет, поэтому поле остаётся пустым
        // осознанно, а не «пока не заполнили».
        credential_expires_at: null,
        kind: "student",
        is_active: true,
        oauth_scope: input.scope,
        connected_at: new Date().toISOString(),
        auth_failed_at: null,
        auth_failure_reason: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "provider,external_athlete_id" }
    )
    .select("id")
    .single();
  if (error) return { ok: false, reason: describeSupabaseError(error) };
  return { ok: true, sourceId: String((data as { id: string }).id) };
}

/** Записать, что провайдер перестал принимать доступ. */
export async function markAuthFailure(sourceId: string, reason: string): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("student_data_sources")
    .update({ auth_failed_at: new Date().toISOString(), auth_failure_reason: reason.slice(0, 500) })
    .eq("id", sourceId);
  if (error) console.warn("[intervals.oauth] не удалось отметить отказ", { error: error.message });
}

/** Снять отметку отказа: доступ снова работает. */
export async function clearAuthFailure(sourceId: string): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("student_data_sources")
    .update({ auth_failed_at: null, auth_failure_reason: null })
    .eq("id", sourceId)
    .not("auth_failed_at", "is", null);
  if (error) console.warn("[intervals.oauth] не удалось снять отметку отказа", { error: error.message });
}

/**
 * СПОСОБЕН ЛИ ИСТОЧНИК ОТДАВАТЬ ДАННЫЕ, а не «заведена ли строка».
 *
 * ПОЙМАНО НА ЖИВОМ ПРОГОНЕ 15.09.2026. Тестовая карточка тренера имела активный
 * источник с ключом-заглушкой: строка есть, данных нет и быть не может. Гард
 * спрашивал «есть ли источник», видел строку и пропускал экран подключения —
 * человек заполнял анкету, не подключив ничего, и мы этого не замечали.
 *
 * Признак пригодности: подключение через OAuth состоялось ЛИБО хоть раз прошла
 * синхронизация ЛИБО в базе есть хоть одна привезённая тренировка. Наличие
 * строки не значит ничего: её заводит скрипт, а данные приносит провайдер.
 */
export function isConnectionUsable(
  connection: SourceConnection | null,
  activitiesCount: number
): boolean {
  if (!connection || !connection.isActive) return false;
  if (connection.authFailedAt) return false;
  if (connection.authMethod === "oauth" && connection.connectedAt) return true;
  return connection.lastSyncedAt !== null || activitiesCount > 0;
}

export async function countActivitiesForSource(sourceId: string): Promise<number> {
  const supabase = createSupabaseServerClient();
  const { count, error } = await supabase
    .from("intervals_activities")
    .select("id", { count: "exact", head: true })
    .eq("source_id", sourceId);
  if (error) throw new Error(`intervals_activities count: ${describeSupabaseError(error)}`);
  return count ?? 0;
}

export type SourceConnection = {
  sourceId: string;
  externalAthleteId: string;
  authMethod: "api_key" | "oauth";
  isActive: boolean;
  connectedAt: string | null;
  authFailedAt: string | null;
  authFailureReason: string | null;
  lastSyncedAt: string | null;
};

/** Состояние подключения БЕЗ СЕКРЕТА: всё, что нужно экранам. */
export async function getSourceConnection(studentUuid: string): Promise<SourceConnection | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("student_data_sources")
    .select(
      "id, external_athlete_id, auth_method, is_active, connected_at, auth_failed_at, auth_failure_reason, last_synced_at"
    )
    .eq("student_id", studentUuid)
    .eq("provider", "intervals")
    .limit(1);
  if (error) throw new Error(`student_data_sources: ${describeSupabaseError(error)}`);
  const raw = (data ?? [])[0];
  if (!raw) return null;
  const row = raw as unknown as Record<string, unknown>;
  return {
    sourceId: String(row.id),
    externalAthleteId: String(row.external_athlete_id),
    authMethod: row.auth_method === "oauth" ? "oauth" : "api_key",
    isActive: row.is_active === true,
    connectedAt: (row.connected_at as string | null) ?? null,
    authFailedAt: (row.auth_failed_at as string | null) ?? null,
    authFailureReason: (row.auth_failure_reason as string | null) ?? null,
    lastSyncedAt: (row.last_synced_at as string | null) ?? null,
  };
}
