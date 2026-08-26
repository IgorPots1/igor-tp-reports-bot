/**
 * Приём тренировок ученика: список → детали → ряды → база.
 *
 * Здесь и только здесь живёт порядок действий. Клиент API не знает про базу,
 * репозиторий не знает про сеть, а этот файл не знает, каким способом получен
 * доступ, — за это отвечает buildAuthorizationHeader.
 */

import { fetchActivities, fetchActivity, fetchActivityStreams, IntervalsApiError } from "./api-client";
import { redactSecrets } from "./auth";
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

export type IngestOptions = {
  studentUuid: string;
  /** «YYYY-MM-DD». По умолчанию — вся история. */
  from?: string;
  /** «YYYY-MM-DD». По умолчанию — сегодня. */
  to?: string;
  /** Куда рассказывать о ходе дела. По умолчанию молча. */
  onProgress?: (message: string) => void;
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function ingestStudentActivities(options: IngestOptions): Promise<IngestSummary> {
  const from = options.from ?? HISTORY_START;
  const to = options.to ?? today();
  const say = options.onProgress ?? (() => {});

  const source = await getSourceWithSecret(options.studentUuid);
  if (!source) {
    throw new Error(
      "У ученика нет источника Intervals. Заведите его: scripts/intervals-link-source.ts"
    );
  }
  if (!source.isActive) {
    throw new Error("Источник Intervals у ученика отключён (is_active = false)");
  }

  const summary: IngestSummary = {
    studentId: options.studentUuid,
    externalAthleteId: source.externalAthleteId,
    from,
    to,
    activitiesSeen: 0,
    activitiesSaved: 0,
    streamsSaved: 0,
    streamsMissing: 0,
    withHeartrate: 0,
    paceOnly: 0,
    noData: 0,
    failures: [],
  };

  const list = await fetchActivities(source, source.externalAthleteId, from, to);
  summary.activitiesSeen = list.length;
  say(`Активностей в периоде ${from}…${to}: ${list.length}`);

  for (const [index, listed] of list.entries()) {
    try {
      // Детали берём отдельным запросом, а не довольствуемся строкой списка:
      // список у провайдера урезан, часть полей (в т.ч. пульсовые) в нём
      // отсутствует. Что именно урезано — зависит от вида спорта, поэтому
      // проще всегда брать полную карточку, чем держать список исключений.
      const activity = await fetchActivity(source, listed.id);
      const streams = await fetchActivityStreams(source, listed.id);

      const { streamsSaved } = await saveActivity({
        sourceId: source.id,
        studentUuid: options.studentUuid,
        activity,
        streams,
      });

      summary.activitiesSaved += 1;
      if (streamsSaved) summary.streamsSaved += 1;
      else summary.streamsMissing += 1;

      const quality = assessDataQuality(streams);
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

  // Отметку ставим, только если что-то реально доехало: иначе следующий прогон
  // решит, что период уже забран, и дыра в данных закрепится.
  if (summary.activitiesSaved > 0) {
    await markSourceSynced(source.id);
  }

  return summary;
}
