// «Выполнил / не выполнил» за вчера — чистая логика без БД и без импортов, общая для десктопа
// (/m/desk), утреннего дайджеста в боте и раннера скана. Наряд 2026-10-02.
//
// Почему отдельный модуль: до него план и факт одного дня не сопоставлялись вовсе. Плановая беговая
// без выполнения считалась пропуском, даже если в тот же день лежала незапланированная выполненная
// тренировка — TP не склеил их (другое название, часы записали как Running, ученица сыграла в падел
// вместо бега). Аудит 02.10: 16 таких пар за 14 дней.
//
// Правила тренера (02.10):
//  - тот же вид (workout_type_value_id совпал), факт >= 70% плана → выполнено;
//  - тот же вид, факт < 70% → «выполнено частично», не пропуск;
//  - другой вид → «вне плана: <вид>», не пропуск;
//  - ничего выполненного в этот день → пропуск.
// Маппинг видов не трогаем: вид = workout_type_value_id как есть из TP. sport_or_type_code не
// используется — это пользовательский «код тренировки» TP, он пуст всегда.

export const SAME_TYPE_COMPLETED_MIN_RATIO = 0.7;

/** TP «Day Off» — отметка календаря, а не выполненная тренировка. */
const DAY_OFF_WORKOUT_TYPE_VALUE_ID = 7;

export type ExecutionWorkoutRow = {
  title: string | null;
  workoutTypeValueId: number | null;
  isPlanned: boolean;
  isCompleted: boolean | null;
  plannedTimeRaw: number | null;
  completedTimeRaw: number | null;
  plannedDistanceRaw: number | null;
  completedDistanceRaw: number | null;
  orderOnDay?: number | null;
};

export type PlannedRunOutcome<Row extends ExecutionWorkoutRow = ExecutionWorkoutRow> =
  | { kind: "missed"; planned: Row }
  | { kind: "completed_unplanned_same_type"; planned: Row; done: Row; ratio: number | null }
  | { kind: "partial"; planned: Row; done: Row; ratio: number }
  | { kind: "off_plan"; planned: Row; done: Row };

function positive(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Доля выполнения: по времени, если оно есть у обеих сторон, иначе по дистанции. null — сравнить
 * нечем (общей меры у плана и факта нет): тогда тот же вид считается выполненным, потому что
 * «частично» без измерения было бы выдумкой.
 */
export function executionRatio(planned: ExecutionWorkoutRow, done: ExecutionWorkoutRow): number | null {
  const plannedTime = positive(planned.plannedTimeRaw);
  const doneTime = positive(done.completedTimeRaw);
  if (plannedTime !== null && doneTime !== null) return doneTime / plannedTime;
  const plannedDistance = positive(planned.plannedDistanceRaw);
  const doneDistance = positive(done.completedDistanceRaw);
  if (plannedDistance !== null && doneDistance !== null) return doneDistance / plannedDistance;
  return null;
}

export function isUnplannedCompletedWorkout(row: ExecutionWorkoutRow): boolean {
  return !row.isPlanned && row.isCompleted === true && row.workoutTypeValueId !== DAY_OFF_WORKOUT_TYPE_VALUE_ID;
}

function doneSize(row: ExecutionWorkoutRow): number {
  return positive(row.completedTimeRaw) ?? 0;
}

/**
 * Сопоставляет невыполненные плановые беговые одного ученика за день с незапланированными
 * выполненными того же дня. Каждая выполненная закрывает не больше одной плановой.
 * Сначала тот же вид (по всем плановым), потом другой — чтобы «Running» ушёл к беговой плановой,
 * а не к случайной. Внутри прохода берётся самая длинная из свободных.
 */
export function resolvePlannedRunOutcomes<Row extends ExecutionWorkoutRow>(input: {
  missedPlannedRuns: Row[];
  unplannedCompleted: Row[];
}): PlannedRunOutcome<Row>[] {
  const planned = [...input.missedPlannedRuns].sort(
    (a, b) => (a.orderOnDay ?? 0) - (b.orderOnDay ?? 0)
  );
  const free = [...input.unplannedCompleted].sort((a, b) => doneSize(b) - doneSize(a));
  const used = new Set<Row>();
  const outcomeByPlanned = new Map<Row, PlannedRunOutcome<Row>>();

  for (const plan of planned) {
    const done = free.find(
      (row) => !used.has(row) && row.workoutTypeValueId !== null && row.workoutTypeValueId === plan.workoutTypeValueId
    );
    if (!done) continue;
    used.add(done);
    const ratio = executionRatio(plan, done);
    outcomeByPlanned.set(
      plan,
      ratio === null || ratio >= SAME_TYPE_COMPLETED_MIN_RATIO
        ? { kind: "completed_unplanned_same_type", planned: plan, done, ratio }
        : { kind: "partial", planned: plan, done, ratio }
    );
  }

  for (const plan of planned) {
    if (outcomeByPlanned.has(plan)) continue;
    const done = free.find((row) => !used.has(row));
    if (!done) continue;
    used.add(done);
    outcomeByPlanned.set(plan, { kind: "off_plan", planned: plan, done });
  }

  return planned.map((plan) => outcomeByPlanned.get(plan) ?? { kind: "missed", planned: plan });
}

function minutes(hours: number | null): number | null {
  const value = positive(hours);
  return value === null ? null : Math.round(value * 60);
}

function quoted(title: string | null): string {
  const text = title?.trim();
  return text ? `«${text}»` : "тренировка";
}

/** Строка для тренера. Тот же текст идёт и в десктоп, и в дайджест. */
export function describePlannedRunOutcome(outcome: PlannedRunOutcome): string | null {
  switch (outcome.kind) {
    case "missed":
    case "completed_unplanned_same_type":
      return null;
    case "off_plan":
      return `вне плана: ${outcome.done.title?.trim() || "другой вид"} (план: ${quoted(outcome.planned.title)})`;
    case "partial": {
      const doneMin = minutes(outcome.done.completedTimeRaw);
      const planMin = minutes(outcome.planned.plannedTimeRaw);
      const amount =
        doneMin !== null && planMin !== null
          ? `${doneMin} из ${planMin} мин`
          : `${Math.round(outcome.ratio * 100)}% плана`;
      return `выполнено частично: ${amount} (план: ${quoted(outcome.planned.title)})`;
    }
  }
}

// --- сбои скана --------------------------------------------------------------------------------
//
// 403 и сетевой сбой — разные вещи, их нельзя смешивать (решение тренера 02.10):
//  - 403: у тренера нет доступа к календарю ученика в TP. Это не лечится перелогином и не пройдёт
//    само: ученик показывается «нет доступа к TP», пока ok-скан не вернётся;
//  - fetch failed: разовый сбой сети до Supabase/TP, следующий прогон обычно проходит.
// Текст ошибки пишет tp-workouts-cache-scan.ts: "TrainingPeaks workouts GET failed: status=403, ok=false".

export type ScanFailureKind = "access_lost" | "fetch_failed" | "other";

export function classifyScanFailure(errorMessage: string | null | undefined): ScanFailureKind {
  const text = errorMessage ?? "";
  if (/status=403\b/u.test(text)) return "access_lost";
  if (/fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up/iu.test(text)) return "fetch_failed";
  return "other";
}

// --- свежесть данных ---------------------------------------------------------------------------

/** «обновлено 3 ч назад» по последнему ok-скану ученика. */
export function formatDataFreshness(lastOkScanAt: string | null | undefined, now: Date = new Date()): string {
  if (!lastOkScanAt) return "нет успешного скана";
  const ms = now.getTime() - new Date(lastOkScanAt).getTime();
  if (!Number.isFinite(ms)) return "нет успешного скана";
  const hours = Math.max(0, Math.floor(ms / 3_600_000));
  if (hours < 1) return "обновлено меньше часа назад";
  if (hours < 48) return `обновлено ${hours} ч назад`;
  return `обновлено ${Math.floor(hours / 24)} дн назад`;
}

// --- здоровье прогона скана (heartbeat) ---------------------------------------------------------
//
// partial — «прогон дошёл до конца, часть учеников упала» — НЕ безусловно живой (решение тренера
// 02.10). Протухни сессия посреди прогона — все 133 получат 403, и partial это бы скрыл. Тревога:
//  - ok меньше 80% сканируемых (без skipped — у них нет TP id, их не сканируют вообще);
//  - число 403 выросло больше чем на 3 к предыдущему прогону.
// Стабильные 12 × 403 тревоги не вызывают: их доля ~9%, и от прогона к прогону число не растёт.

export const SCAN_RUN_MIN_OK_SHARE = 0.8;
export const SCAN_RUN_MAX_ACCESS_LOST_JUMP = 3;

export type ScanRunOutcomeCounts = {
  ok: number;
  accessLost: number;
  fetchFailed: number;
  otherFailed: number;
  skipped: number;
};

export type ScanRunVerdict = { verdict: "ok" | "partial" | "alarm"; reasons: string[] };

export function evaluateScanRunHealth(input: {
  current: ScanRunOutcomeCounts;
  /** accessLost прошлого прогона; null — неизвестно (первый прогон с новым кодом), правило скачка молчит. */
  previousAccessLost: number | null;
}): ScanRunVerdict {
  const { current } = input;
  const failed = current.accessLost + current.fetchFailed + current.otherFailed;
  const scanned = current.ok + failed;
  const reasons: string[] = [];
  if (scanned > 0 && current.ok < SCAN_RUN_MIN_OK_SHARE * scanned) {
    reasons.push(`ok ${current.ok} из ${scanned} (меньше ${Math.round(SCAN_RUN_MIN_OK_SHARE * 100)}%)`);
  }
  if (input.previousAccessLost !== null && current.accessLost - input.previousAccessLost > SCAN_RUN_MAX_ACCESS_LOST_JUMP) {
    reasons.push(`403 стало ${current.accessLost}, было ${input.previousAccessLost}`);
  }
  if (reasons.length > 0) return { verdict: "alarm", reasons };
  return { verdict: failed > 0 ? "partial" : "ok", reasons };
}
