// Тренерские силовые → строки trainingpeaks_workout_cache (наряд 19.10, п.4 «силовые в кэш»).
//
// ЗАЧЕМ. Структурные силовые живут в отдельном сервисе TP (api.peakswaresb.com/rx/activity/v1/,
// тот же bearer) и НЕ приходят в ленту tpapi /workouts — значит, их не было в кэше вообще, и
// всё, что читает кэш (автопланировщик, питание, клуб), не видело силовую в дне.
//
// ТОЛЬКО ЧТЕНИЕ из TP: модуль ничего не запрашивает сам — сводки календаря ему передают
// (fetch — в скане, через getTpApiJsonRaw, в котором нет метода, кроме GET).
//
// Решения (все — в пользу «не навредить потребителям кэша»):
//  • Берём только ТРЕНЕРСКИЕ: сервис листает и файлы с часов («Strength»/«Yoga»: Unplanned, без
//    назначенных подходов). Их и так видно в tpapi (completed type 9) — второй раз не пишем.
//  • Только видимые атлету (isHidden=false). Скрытая — черновик тренера до «покажи»; кэш читают
//    и экраны ученика (клуб «следующая тренировка», план питания) — показывать там то, чего
//    ученик в TP не видит, нельзя.
//  • Только сегодня и вперёд (по Белграду). Цель — планирование. Прошлое закрыто часами
//    (completed type 9 из tpapi); прошлая силовая как «план не выполнен» давала бы ложь, а как
//    «выполнена» — двойной счёт с файлом часов (физио-нагрузка, расход в разборе питания) и
//    вызовы tpapi с чужим id из FIT-ингеста (он берёт completed-строки без фильтра типа).
//  • is_planned=true, is_completed=false ВСЕГДА. Отметка выполнения — в source_snapshot.
//  • Без длительности/дистанции (null): в кэше они в ЧАСАХ/метрах, а у силовой их нет.
//  • id силовой — из другого пространства (~3.5e7), чем tpapi workoutId (в кэше 2.9e9…4.0e9 на
//    19.10.2026, ни одного ниже 1e9). Уникальный ключ кэша (athlete_id, workout_id) — поэтому id
//    силовой >= 1e9 НЕ пишем (вошёл бы в пространство tpapi), и id, совпавший с workoutId из
//    того же ответа tpapi, тоже (защита в глубину).

import type {
  TrainingPeaksStudent,
  TrainingPeaksWorkoutCacheUpsertRow,
} from "../../../../src/features/trainingpeaks/repository.ts";

export const STRENGTH_CACHE_SOURCE = "tp_strength_service";
export const STRENGTH_CACHE_WORKOUT_TYPE_VALUE_ID = 9;
/** id силовой должен быть строго ниже: выше начинается пространство tpapi workoutId. */
export const STRENGTH_ID_EXCLUSIVE_MAX = 1_000_000_000;
export const STRENGTH_SCAN_FLAG = "TP_SCAN_STRENGTH";

/** Флаг окружения. Выключено по умолчанию: только ровно "1" включает. */
export function isStrengthScanEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[STRENGTH_SCAN_FLAG]?.trim() === "1";
}

export function strengthCalendarPath(athleteId: number, from: string, to: string): string {
  return `/rx/activity/v1/workouts/calendar/${athleteId}/${from}/${to}`;
}

/** «Сегодня» по Белграду (так считает окно скана run-workout-cache-scan.sh). */
export function belgradeTodayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Belgrade" }).format(now);
}

type Rec = Record<string, unknown>;

function isRec(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function compact(value: unknown, maxLength = 2000): string | null {
  const s = str(value);
  if (!s) return null;
  const normalized = s.replace(/\s+/g, " ");
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}…`;
}

function isoDatePart(value: unknown): string | null {
  const s = str(value);
  return s?.match(/^(\d{4}-\d{2}-\d{2})(?:$|[T\s])/)?.[1] ?? null;
}

/**
 * Тренерская = есть назначенные подходы. Файл с часов: complianceState "Unplanned",
 * hasPrescribedData=false, 0 подходов (разведка 18.10: 331 из 1220, все такие).
 * hasPrescribedData=false при подходах > 0 бывает у тренерской с пустыми значениями (шаблон,
 * пустой вес null) — она тренерская, если это не Unplanned.
 */
export function isCoachPrescribedStrength(summary: Rec): boolean {
  if (summary.hasPrescribedData === true) return true;
  const totalSets = num(summary.totalSets) ?? 0;
  const totalPrescriptions = num(summary.totalPrescriptions) ?? 0;
  return summary.complianceState !== "Unplanned" && (totalSets > 0 || totalPrescriptions > 0);
}

/** Тело ответа календаря: массив сводок (живьём 19.10) или, на всякий случай, {data:[…]}. */
export function extractStrengthCalendarItems(body: unknown): Rec[] | null {
  const list = Array.isArray(body) ? body : isRec(body) && Array.isArray(body.data) ? body.data : null;
  if (!list) return null;
  return list.filter(isRec);
}

export type StrengthRowsCounts = {
  returned: number;
  watchFiles: number;
  hidden: number;
  past: number;
  outOfWindow: number;
  badId: number;
  idCollision: number;
  duplicate: number;
  rows: number;
};

export type StrengthRowsResult = {
  rows: TrainingPeaksWorkoutCacheUpsertRow[];
  /**
   * Для поиска дыр в orderOnDay: день + номер в дне у КАЖДОЙ тренерской силовой окна (в т.ч.
   * скрытой и прошлой, которые не пишутся), если TP номер дал.
   */
  orderItems: Array<{ workoutDate: string; orderOnDay: number | null }>;
  counts: StrengthRowsCounts;
};

export function buildStrengthCacheRows(input: {
  items: Rec[];
  student: Pick<TrainingPeaksStudent, "id" | "studentName">;
  athleteId: number;
  from: string;
  to: string;
  todayIso: string;
  scannedAt: string;
  /** workoutId из ответа tpapi этого же прогона — силовая с таким id не пишется. */
  tpapiWorkoutIds: ReadonlySet<number>;
}): StrengthRowsResult {
  const counts: StrengthRowsCounts = {
    returned: input.items.length, watchFiles: 0, hidden: 0, past: 0, outOfWindow: 0,
    badId: 0, idCollision: 0, duplicate: 0, rows: 0,
  };
  const rows: TrainingPeaksWorkoutCacheUpsertRow[] = [];
  const orderItems: StrengthRowsResult["orderItems"] = [];
  const seen = new Set<number>();
  const firstDay = input.from > input.todayIso ? input.from : input.todayIso;

  for (const item of input.items) {
    if (!isCoachPrescribedStrength(item)) { counts.watchFiles += 1; continue; }
    const date = isoDatePart(item.prescribedDate);
    if (!date || date > input.to || date < input.from) { counts.outOfWindow += 1; continue; }
    const orderRaw = num(item.orderOnDay);
    const orderOnDay = orderRaw !== null && Number.isInteger(orderRaw) && orderRaw >= 1 ? orderRaw : null;
    // Номер в дне — правда календаря TP, даже если строку мы не пишем (скрытая, прошлая): дыру
    // в нумерации ленты такая силовая объясняет так же.
    orderItems.push({ workoutDate: date, orderOnDay });
    if (item.isHidden === true) { counts.hidden += 1; continue; }
    if (date < firstDay) { counts.past += 1; continue; }
    const id = num(item.id);
    if (id === null || !Number.isInteger(id) || id <= 0 || id >= STRENGTH_ID_EXCLUSIVE_MAX) { counts.badId += 1; continue; }
    if (input.tpapiWorkoutIds.has(id)) { counts.idCollision += 1; continue; }
    if (seen.has(id)) { counts.duplicate += 1; continue; }
    seen.add(id);

    const sequence = Array.isArray(item.sequenceSummary)
      ? item.sequenceSummary.filter(isRec).map((s) => ({
        order: str(s.sequenceOrder),
        title: str(s.title),
      }))
      : null;

    rows.push({
      student_id: input.student.id,
      student_name: input.student.studentName,
      trainingpeaks_athlete_id: input.athleteId,
      trainingpeaks_workout_id: id,
      workout_date: date,
      title: str(item.title) ?? "Strength Workout",
      sport_or_type_code: null,
      workout_type_value_id: STRENGTH_CACHE_WORKOUT_TYPE_VALUE_ID,
      workout_sub_type_id: null,
      is_planned: true,
      is_completed: false,
      planned_time_raw: null,
      completed_time_raw: null,
      planned_distance_raw: null,
      completed_distance_raw: null,
      compliance_duration_percent: null,
      compliance_distance_percent: null,
      start_time_planned: null,
      start_time: null,
      source_updated_at: null,
      order_on_day: orderOnDay,
      scanned_at: input.scannedAt,
      normalization_warnings: [],
      source_snapshot: {
        source: STRENGTH_CACHE_SOURCE,
        strengthWorkoutId: String(item.id),
        workoutType: str(item.workoutType),
        rawTitle: str(item.title),
        rawWorkoutDay: str(item.prescribedDate),
        rawPrescribedStartTime: str(item.prescribedStartTime),
        rawLastUpdatedAt: str(item.lastUpdatedAt),
        rawOrderOnDay: item.orderOnDay ?? null,
        workoutTypeValueId: STRENGTH_CACHE_WORKOUT_TYPE_VALUE_ID,
        isHidden: item.isHidden === true,
        isLocked: item.isLocked === true,
        hasPrescribedData: item.hasPrescribedData === true,
        hasFileData: item.hasFileData === true,
        complianceState: str(item.complianceState),
        compliancePercent: num(item.compliancePercent),
        totalBlocks: num(item.totalBlocks),
        totalPrescriptions: num(item.totalPrescriptions),
        totalSets: num(item.totalSets),
        completedSets: num(item.completedSets),
        prescribedDurationInSeconds: num(item.prescribedDurationInSeconds),
        executedDurationInSeconds: num(item.executedDurationInSeconds),
        completedDateTime: str(item.completedDateTime),
        instructions: compact(item.instructions),
        sequence,
      },
    });
  }
  counts.rows = rows.length;
  return { rows, orderItems, counts };
}

/** Строка кэша — тренерская силовая из сервиса силовых (а не из ленты tpapi). */
export function isStrengthServiceCacheRow(row: { source_snapshot?: unknown } | { sourceSnapshot?: unknown }): boolean {
  const snapshot = "source_snapshot" in row ? row.source_snapshot : (row as { sourceSnapshot?: unknown }).sourceSnapshot;
  return isRec(snapshot) && snapshot.source === STRENGTH_CACHE_SOURCE;
}
