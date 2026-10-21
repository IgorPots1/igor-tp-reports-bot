// Скрытые тренерские силовые в кэше и то, что видит ученик (решение Игоря 21.10).
//
// Тренерские силовые из сервиса силовых TP (source_snapshot.source = "tp_strength_service", пишет
// скан кэша за флагом TP_SCAN_STRENGTH=1) попадают в кэш И скрытыми — с пометкой
// source_snapshot.isHidden = true. Скрытая — черновик тренера до «покажи»: автопланировщик и
// тренерские экраны её видят (это цель — не ставить качественную в день силовой), а всё, что
// видит ученик (клуб «следующая тренировка», план питания, черновики ответов ученику), — нет.
//
// Отдельной колонки под скрытие в trainingpeaks_workout_cache нет (information_schema, 21.10) —
// признак живёт в source_snapshot. Модуль без зависимостей: его импортируют и src/, и раннеры.
//
// ГРАНИЦА: фильтр — только для скрытых ТРЕНЕРСКИХ СИЛОВЫХ. Скрытые беговые из ленты tpapi
// (source_snapshot.isHidden=true без source) он не трогает: это прежнее поведение, менять его —
// отдельное решение (черновики недель тренера тоже бывают скрытыми).

export const COACH_STRENGTH_CACHE_SOURCE = "tp_strength_service";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function snapshotOf(row: unknown): unknown {
  if (!isRecord(row)) return null;
  return "source_snapshot" in row ? row.source_snapshot : row.sourceSnapshot;
}

/** Строка кэша — тренерская силовая из сервиса силовых (snake из базы или camel из repository). */
export function isCoachStrengthCacheRow(row: unknown): boolean {
  const snapshot = snapshotOf(row);
  return isRecord(snapshot) && snapshot.source === COACH_STRENGTH_CACHE_SOURCE;
}

/** Скрытая от ученика тренерская силовая. Ученику такую строку не показываем. */
export function isHiddenCoachStrengthCacheRow(row: unknown): boolean {
  const snapshot = snapshotOf(row);
  return isRecord(snapshot) && snapshot.source === COACH_STRENGTH_CACHE_SOURCE && snapshot.isHidden === true;
}

/**
 * Тот же фильтр на стороне базы (PostgREST .or()) — для запросов с limit или без source_snapshot
 * в select: оставить строку, если она НЕ (силовая сервиса И скрытая).
 * SQL: source is null OR source <> 'tp_strength_service' OR isHidden is null OR isHidden <> 'true'.
 * У силовых сервиса isHidden всегда true/false; is.null — чтобы NULL не выбросил чужие строки.
 */
export const ATHLETE_VISIBLE_CACHE_ROWS_OR_FILTER =
  `source_snapshot->>source.is.null,source_snapshot->>source.neq.${COACH_STRENGTH_CACHE_SOURCE},` +
  "source_snapshot->>isHidden.is.null,source_snapshot->>isHidden.neq.true";
