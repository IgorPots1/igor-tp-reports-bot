/**
 * HTTP-клиент Intervals.icu. Знает про адреса и формы ответов — и НЕ знает, как
 * получен доступ: заголовок ему приносит buildAuthorizationHeader.
 */

import { buildAuthorizationHeader, redactSecrets, type DataSourceCredentials } from "./auth";
import type { ActivityStreams, IntervalsActivity } from "./types";

const API_BASE = "https://intervals.icu/api/v1";

/** Ряды, которые забираем. Проверено вручную: приходят точка в секунду. */
export const STREAM_TYPES = ["time", "heartrate", "velocity_smooth"] as const;

/** Сколько ждать один запрос. Выгрузка рядов у длинной тренировки не мгновенная. */
const REQUEST_TIMEOUT_MS = 60_000;

export class IntervalsApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    // Текст ошибки уходит в логи и в отчёт скрипта, поэтому чистится ВСЕГДА,
    // а не по усмотрению вызывающего.
    super(redactSecrets(message));
    this.name = "IntervalsApiError";
    this.status = status;
  }
}

async function request<T>(path: string, source: DataSourceCredentials): Promise<T> {
  const url = `${API_BASE}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Authorization: buildAuthorizationHeader(source),
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // Сетевой отказ или таймаут: до HTTP-статуса дело не дошло.
    throw new IntervalsApiError(0, `Запрос ${path} не дошёл: ${String(error)}`);
  }

  if (!response.ok) {
    // Тело ошибки бывает и HTML-страницей, поэтому обрезаем: в лог нужна
    // причина, а не портянка.
    const body = (await response.text().catch(() => "")).slice(0, 300);
    throw new IntervalsApiError(
      response.status,
      `${path} → HTTP ${response.status}${body ? `: ${body}` : ""}`
    );
  }

  return (await response.json()) as T;
}

/**
 * Список активностей за период. Даты — «YYYY-MM-DD», границы включительно.
 * Без периода провайдер отдаёт последние тренировки, а не всё, поэтому для
 * полной истории вызывающий подставляет заведомо раннюю дату.
 */
export async function fetchActivities(
  source: DataSourceCredentials,
  athleteId: string,
  from: string,
  to: string
): Promise<IntervalsActivity[]> {
  const query = new URLSearchParams({ oldest: from, newest: to });
  const data = await request<unknown>(
    `/athlete/${encodeURIComponent(athleteId)}/activities?${query.toString()}`,
    source
  );

  if (!Array.isArray(data)) {
    throw new IntervalsApiError(0, "Список активностей пришёл не массивом");
  }
  // Активность без id бесполезна: по нему держится вся идемпотентность.
  return data.filter(
    (item): item is IntervalsActivity =>
      Boolean(item) && typeof (item as IntervalsActivity).id === "string"
  );
}

/** Детали одной активности. */
export async function fetchActivity(
  source: DataSourceCredentials,
  activityId: string
): Promise<IntervalsActivity> {
  return request<IntervalsActivity>(`/activity/${encodeURIComponent(activityId)}`, source);
}

type RawStream = { type?: unknown; data?: unknown };

/** Приводит один ряд к массиву чисел с дырками. Всё нечисловое становится null. */
function toNumericSeries(data: unknown): (number | null)[] | null {
  if (!Array.isArray(data)) return null;
  return data.map((value) => (typeof value === "number" && Number.isFinite(value) ? value : null));
}

/**
 * Посекундные ряды активности.
 *
 * Ответ разбирается ДВУМЯ способами: провайдер отдаёт массив объектов
 * [{type, data}], но встречается и форма «объект, ключи — типы рядов». Гадать,
 * какая придёт сегодня, дороже, чем принять обе: цена ошибки — молча пустые
 * ряды у всей выгрузки.
 */
export async function fetchActivityStreams(
  source: DataSourceCredentials,
  activityId: string
): Promise<ActivityStreams | null> {
  const query = new URLSearchParams({ types: STREAM_TYPES.join(",") });
  const data = await request<unknown>(
    `/activity/${encodeURIComponent(activityId)}/streams?${query.toString()}`,
    source
  );

  const byType = new Map<string, (number | null)[] | null>();

  if (Array.isArray(data)) {
    for (const item of data as RawStream[]) {
      if (item && typeof item.type === "string") {
        byType.set(item.type, toNumericSeries(item.data));
      }
    }
  } else if (data && typeof data === "object") {
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const series =
        value && typeof value === "object" && "data" in (value as RawStream)
          ? toNumericSeries((value as RawStream).data)
          : toNumericSeries(value);
      byType.set(key, series);
    }
  }

  const time = byType.get("time");
  if (!time || time.length === 0) {
    // Без оси времени ряды бессмысленны: не к чему привязывать точки. Это
    // штатный исход (силовая без записи, ручной ввод), а не сбой.
    return null;
  }

  return {
    // Ось времени дырок не имеет; если провайдер прислал null, точка мертва.
    time: time.map((value) => value ?? 0),
    heartrate: byType.get("heartrate") ?? null,
    velocitySmooth: byType.get("velocity_smooth") ?? null,
  };
}
