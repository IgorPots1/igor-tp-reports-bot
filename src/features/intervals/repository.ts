/** Чтение и запись приёма Intervals.icu. Только база — ни сети, ни решений. */

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
