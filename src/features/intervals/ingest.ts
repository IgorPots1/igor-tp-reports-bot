/**
 * Приём тренировок ученика: список → детали → ряды → база.
 *
 * Здесь и только здесь живёт порядок действий. Клиент API не знает про базу,
 * репозиторий не знает про сеть, а этот файл не знает, каким способом получен
 * доступ, — за это отвечает buildAuthorizationHeader.
 */

import { fetchActivities, fetchActivity, fetchActivityStreams, IntervalsApiError } from "./api-client";
import { redactSecrets, type DataSourceCredentials } from "./auth";
import { assessDataQuality } from "./data-quality";
import { getSourceWithSecret, markSourceSynced, saveActivity } from "./repository";
import type { IngestSummary } from "./types";

/**
 * С какой даты начинается «вся история». Intervals появился в 2018-м, но ученик
 * мог занести туда и более ранний архив из Garmin, поэтому граница взята с
 * запасом. Пустой период стоит один запрос списка и ничего не портит.
 */
export const HISTORY_START = "2010-01-01";

/**
 * Пауза между активностями. Бэкфилл истории — это сотни запросов подряд к
 * чужому сервису; идти без пауз значит проверять на прочность чужой rate-limit
 * ради выигрыша в минуту на разовой операции.
 */
const PAUSE_BETWEEN_ACTIVITIES_MS = 150;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Куда складывать привезённое. null означает холостой прогон.
 *
 * Это не «режим отладки», а способ посмотреть на живые данные ДО того, как они
 * поедут в боевые таблицы: пройти весь путь целиком, посчитать уровень качества
 * и объём рядов — и ничего не записать. На пилоте это единственный способ
 * узнать, сколько места займут ряды, не скачав их сначала.
 */
type IngestDestination = { sourceId: string; studentUuid: string } | null;

type RunOptions = {
  credentials: DataSourceCredentials;
  athleteId: string;
  destination: IngestDestination;
  from: string;
  to: string;
  onProgress: (message: string) => void;
};

async function run(options: RunOptions): Promise<IngestSummary> {
  const { credentials, athleteId, destination, from, to, onProgress: say } = options;

  const summary: IngestSummary = {
    studentId: destination?.studentUuid ?? null,
    externalAthleteId: athleteId,
    from,
    to,
    dryRun: destination === null,
    activitiesSeen: 0,
    activitiesSaved: 0,
    streamsSaved: 0,
    streamsMissing: 0,
    withHeartrate: 0,
    paceOnly: 0,
    noData: 0,
    streamBytes: 0,
    failures: [],
  };

  const list = await fetchActivities(credentials, athleteId, from, to);
  summary.activitiesSeen = list.length;
  say(`Активностей в периоде ${from}…${to}: ${list.length}`);

  for (const [index, listed] of list.entries()) {
    try {
      // Детали берём отдельным запросом, а не довольствуемся строкой списка:
      // список у провайдера урезан — в нём, например, нет пульсовых полей
      // (проверено на живом ответе: 40 полей в строке списка против 183 в
      // карточке активности).
      const activity = await fetchActivity(credentials, listed.id);
      const streams = await fetchActivityStreams(credentials, listed.id);
      const quality = assessDataQuality(streams);

      if (destination) {
        await saveActivity({
          sourceId: destination.sourceId,
          studentUuid: destination.studentUuid,
          activity,
          streams,
        });
      } else if (streams) {
        // Считаем ровно то, что записали бы.
        summary.streamBytes += Buffer.byteLength(
          JSON.stringify([streams.time, streams.heartrate, streams.velocitySmooth])
        );
      }

      summary.activitiesSaved += 1;
      if (streams) summary.streamsSaved += 1;
      else summary.streamsMissing += 1;

      if (quality.dataLevel === "heartrate") summary.withHeartrate += 1;
      else if (quality.dataLevel === "pace_only") summary.paceOnly += 1;
      else summary.noData += 1;

      say(
        `[${index + 1}/${list.length}] ${listed.id} · ${activity.type ?? "?"} · ` +
          `${quality.dataLevel} · точек ${quality.pointCount}`
      );
    } catch (error) {
      // Одна битая активность не должна ронять бэкфилл истории: остальные
      // тренировки к ней отношения не имеют. Причину складываем в отчёт —
      // молчаливый пропуск выглядел бы как «у ученика столько и было».
      const reason =
        error instanceof IntervalsApiError
          ? `HTTP ${error.status}: ${error.message}`
          : redactSecrets(String(error));
      summary.failures.push({ activityId: listed.id, reason });
      say(`[${index + 1}/${list.length}] ${listed.id} — ОШИБКА: ${reason}`);
    }

    if (index < list.length - 1) await sleep(PAUSE_BETWEEN_ACTIVITIES_MS);
  }

  // Отметку ставим, только если что-то реально доехало В БАЗУ: иначе следующий
  // прогон решит, что период уже забран, и дыра в данных закрепится. Холостой
  // прогон не отмечает ничего — он и не забирал.
  if (destination && summary.activitiesSaved > 0) {
    await markSourceSynced(destination.sourceId);
  }

  return summary;
}

export type IngestOptions = {
  studentUuid: string;
  /** «YYYY-MM-DD». По умолчанию — вся история. */
  from?: string;
  /** «YYYY-MM-DD». По умолчанию — сегодня. */
  to?: string;
  onProgress?: (message: string) => void;
};

/** Боевой приём: доступ берётся из базы, привезённое ложится в базу. */
export async function ingestStudentActivities(options: IngestOptions): Promise<IngestSummary> {
  const source = await getSourceWithSecret(options.studentUuid);
  if (!source) {
    throw new Error(
      "У ученика нет источника Intervals. Заведите его: scripts/intervals-link-source.ts"
    );
  }
  if (!source.isActive) {
    throw new Error("Источник Intervals у ученика отключён (is_active = false)");
  }

  return run({
    credentials: source,
    athleteId: source.externalAthleteId,
    destination: { sourceId: source.id, studentUuid: options.studentUuid },
    from: options.from ?? HISTORY_START,
    to: options.to ?? today(),
    onProgress: options.onProgress ?? (() => {}),
  });
}

export type DryRunOptions = {
  credentials: DataSourceCredentials;
  athleteId: string;
  from?: string;
  to?: string;
  onProgress?: (message: string) => void;
};

/**
 * Холостой прогон по аккаунту БЕЗ строки ученика и без записи.
 *
 * Существует ровно потому, что доступ и ученик — разные вещи: посмотреть на
 * данные аккаунта можно и нужно раньше, чем решено, к какой карточке их
 * привязывать. Ни одной записи в базу отсюда не уходит.
 */
export async function dryRunActivities(options: DryRunOptions): Promise<IngestSummary> {
  return run({
    credentials: options.credentials,
    athleteId: options.athleteId,
    destination: null,
    from: options.from ?? HISTORY_START,
    to: options.to ?? today(),
    onProgress: options.onProgress ?? (() => {}),
  });
}
