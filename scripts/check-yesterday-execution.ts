// Чек «выполнил / не выполнил» за вчера (наряд 2026-10-02): сопоставление плановой беговой с
// незапланированной выполненной того же дня, тип сбоя скана, свежесть, и что десктоп с
// дайджестом показывают одни и те же списки. Без БД и сети.
//
// Пары взяты из аудита 02.10 (живые строки кэша, числа те же).

import process from "node:process";

import type { TrainingPeaksAttentionSnapshot } from "@/features/trainingpeaks/service";
import { buildCoachDeskTodayView } from "@/features/trainingpeaks/coach-desk-today";
import { formatTrainingPeaksAttentionSnapshotMessage } from "@/features/trainingpeaks/attention-telegram";
import {
  classifyScanFailure,
  describePlannedRunOutcome,
  formatDataFreshness,
  isUnplannedCompletedWorkout,
  resolvePlannedRunOutcomes,
  type ExecutionWorkoutRow,
} from "@/features/trainingpeaks/yesterday-execution";

const LOG_PREFIX = "[check-yesterday-execution]";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function planned(title: string, type: number, minutes: number): ExecutionWorkoutRow {
  return {
    title,
    workoutTypeValueId: type,
    isPlanned: true,
    isCompleted: false,
    plannedTimeRaw: minutes / 60,
    completedTimeRaw: null,
    plannedDistanceRaw: null,
    completedDistanceRaw: null,
  };
}

function done(title: string, type: number, minutes: number): ExecutionWorkoutRow {
  return {
    title,
    workoutTypeValueId: type,
    isPlanned: false,
    isCompleted: true,
    plannedTimeRaw: null,
    completedTimeRaw: minutes / 60,
    plannedDistanceRaw: null,
    completedDistanceRaw: null,
  };
}

function one(plan: ExecutionWorkoutRow, facts: ExecutionWorkoutRow[]) {
  const outcomes = resolvePlannedRunOutcomes({ missedPlannedRuns: [plan], unplannedCompleted: facts });
  assert(outcomes.length === 1, "one planned → one outcome");
  return outcomes[0]!;
}

function checkPairing(): void {
  // Alfina 21.09: «Легкий бег» 40 мин, сделан «Running» 37 мин — тот же вид, 92% → выполнено.
  const alfina = one(planned("Легкий бег", 3, 40), [done("Running", 3, 37)]);
  assert(alfina.kind === "completed_unplanned_same_type", `Alfina должна быть выполнена, а не ${alfina.kind}`);
  assert(describePlannedRunOutcome(alfina) === null, "выполненная не даёт строки");

  // Ровно 70% — ещё выполнено; ниже — частично.
  assert(one(planned("Бег", 3, 50), [done("Running", 3, 35)]).kind === "completed_unplanned_same_type", "70% = выполнено");
  const partial = one(planned("Бег по пульсу", 3, 50), [done("Running", 3, 25)]);
  assert(partial.kind === "partial", `25 из 50 мин — частично, а не ${partial.kind}`);
  assert(
    describePlannedRunOutcome(partial) === "выполнено частично: 25 из 50 мин (план: «Бег по пульсу»)",
    `строка частичного: ${describePlannedRunOutcome(partial)}`
  );

  // Замены из аудита: другой вид → вне плана, не пропуск.
  const substitutions: Array<[string, ExecutionWorkoutRow, ExecutionWorkoutRow, string]> = [
    ["Pamparaite 23.09", planned("Бег по пульсу", 3, 50), done("Padel Racket", 100, 86), "Padel Racket"],
    ["Rishko 20.09", planned("Легкий бег по темпу", 3, 80), done("Open Water Swimming", 1, 93), "Open Water Swimming"],
    ["Polyakova 27.09", planned("Бег в легком темпе", 3, 40), done("Walking", 13, 316), "Walking"],
    ["Stas 29.09", planned("Бег по темпу", 3, 50), done("Strength", 9, 66), "Strength"],
  ];
  for (const [who, plan, fact, label] of substitutions) {
    const outcome = one(plan, [fact]);
    assert(outcome.kind === "off_plan", `${who}: ожидалось вне плана, а не ${outcome.kind}`);
    const line = describePlannedRunOutcome(outcome) ?? "";
    assert(line.startsWith(`вне плана: ${label} `), `${who}: строка «${line}»`);
  }

  // Ничего не сделано — пропуск.
  assert(one(planned("Бег", 3, 50), []).kind === "missed", "без факта — пропуск");

  // Один факт закрывает одну плановую; тот же вид уходит к беговой, даже если идёт вторым.
  const twoPlans = resolvePlannedRunOutcomes({
    missedPlannedRuns: [
      { ...planned("Бег утро", 3, 40), orderOnDay: 1 },
      { ...planned("Бег вечер", 3, 40), orderOnDay: 2 },
    ],
    unplannedCompleted: [done("Running", 3, 40)],
  });
  assert(
    twoPlans.map((outcome) => outcome.kind).join(",") === "completed_unplanned_same_type,missed",
    `две плановые и один факт: ${twoPlans.map((outcome) => outcome.kind).join(",")}`
  );
  const sameTypeFirst = resolvePlannedRunOutcomes({
    missedPlannedRuns: [planned("Бег", 3, 40)],
    unplannedCompleted: [done("Yoga", 100, 90), done("Running", 3, 40)],
  });
  assert(sameTypeFirst[0]!.kind === "completed_unplanned_same_type", "тот же вид берётся раньше более длинного другого");

  // Сравнить нечем (у плана нет ни времени, ни дистанции) — тот же вид считается выполненным.
  const noMeasure = one({ ...planned("Бег", 3, 0), plannedTimeRaw: null }, [done("Running", 3, 20)]);
  assert(noMeasure.kind === "completed_unplanned_same_type", "без меры «частично» не выдумываем");

  // Day Off — отметка календаря, а не тренировка: в «выполненные вне плана» не попадает.
  assert(!isUnplannedCompletedWorkout(done("Day Off", 7, 0)), "Day Off не факт");
  assert(isUnplannedCompletedWorkout(done("Padel Racket", 100, 60)), "падел — факт");
  assert(!isUnplannedCompletedWorkout(planned("Бег", 3, 40)), "плановая — не факт вне плана");
}

function checkScanFailureKinds(): void {
  assert(classifyScanFailure("TrainingPeaks workouts GET failed: status=403, ok=false") === "access_lost", "403");
  assert(
    classifyScanFailure("Failed to upsert TrainingPeaks workout cache rows: TypeError: fetch failed") === "fetch_failed",
    "fetch failed"
  );
  assert(classifyScanFailure("TrainingPeaks workouts GET failed: status=500, ok=false") === "other", "500 — other");
  assert(classifyScanFailure("status=4030") === "other", "403 только целым числом");
  assert(classifyScanFailure(null) === "other", "null — other");
}

function checkFreshness(): void {
  const now = new Date("2026-10-02T15:00:00Z");
  assert(formatDataFreshness("2026-10-02T12:00:00Z", now) === "обновлено 3 ч назад", "3 ч");
  assert(formatDataFreshness("2026-10-02T14:40:00Z", now) === "обновлено меньше часа назад", "<1 ч");
  assert(formatDataFreshness("2026-09-28T15:00:00Z", now) === "обновлено 4 дн назад", "4 дн");
  assert(formatDataFreshness(null, now) === "нет успешного скана", "null");
}

function checkDeskDigestParity(): void {
  const signal = (name: string, id: string, reason: string, signalKind: string, dataAsOf: string | null) => ({
    level: "today" as const,
    studentName: name,
    studentId: id,
    reason,
    signalKind,
    dataAsOf,
  });
  const snapshot: TrainingPeaksAttentionSnapshot = {
    urgent: [],
    today: [],
    observe: [],
    fyi: [],
    checkTodaySignals: [],
    painDiscomfort: [],
    missedWorkouts: [
      signal("Ученица А", "a", "вчера была беговая тренировка, выполнения не найдено", "missed_workout", "2026-10-02T12:00:00Z"),
    ],
    offPlanWorkouts: [
      signal(
        "Kristina Pamparaite",
        "k",
        "вчера вне плана: Padel Racket (план: «Бег по пульсу»)",
        "off_plan_workout",
        "2026-10-02T12:00:00Z"
      ),
    ],
    tpAccessLost: [
      signal(
        "Nastya Bunyakina",
        "n",
        "нет доступа к TP (403), последние данные 28.09 — пропуски не считаются",
        "tp_access_lost",
        "2026-09-28T19:00:00Z"
      ),
    ],
    noContact5Days: [],
    followUpToday: [],
    followUpOverflowCount: 0,
    freshIllnessToday: [],
    planConstraintsToday: [],
    planConstraintsOverflowCount: 0,
    movesToday: [],
    movesOverflowCount: 0,
  };

  const view = buildCoachDeskTodayView(snapshot, undefined, new Date("2026-10-02T15:00:00Z"));
  assert(view.missed.length === 1 && view.missed[0]!.detail === "обновлено 3 ч назад", "свежесть у пропуска");
  assert(view.offPlan.length === 1, "вне плана на десктопе");
  assert(
    view.offPlan[0]!.detail === "вне плана: Padel Racket (план: «Бег по пульсу») · обновлено 3 ч назад",
    `деталь вне плана: ${view.offPlan[0]!.detail}`
  );
  assert(!view.missed.some((row) => row.name === "Kristina Pamparaite"), "замена не в «Нет выполнения»");
  assert(view.tpAccessLost.length === 1, "нет доступа на десктопе");
  assert(
    view.tpAccessLost[0]!.detail === "последние данные 28.09 — пропуски не считаются",
    `деталь нет доступа: ${view.tpAccessLost[0]!.detail}`
  );

  // Дайджест строится из ТОГО ЖЕ снапшота и показывает те же три списка.
  const digest = formatTrainingPeaksAttentionSnapshotMessage(snapshot, "Сводка");
  for (const needle of ["Ученица А", "вне плана: Padel Racket", "Nastya Bunyakina", "🔁 Вне плана / частично", "🔒 Нет доступа к TP"]) {
    assert(digest.includes(needle), `в дайджесте нет «${needle}»`);
  }
  const missedBlock = digest.split("🏃")[1]?.split("🔁")[0] ?? "";
  assert(!missedBlock.includes("Pamparaite"), "замена не в разделе пропусков дайджеста");
}

function main(): void {
  checkPairing();
  checkScanFailureKinds();
  checkFreshness();
  checkDeskDigestParity();
  console.log(`${LOG_PREFIX} OK`);
}

try {
  main();
} catch (error) {
  console.error(`${LOG_PREFIX} FAILED:`, error instanceof Error ? error.message : error);
  process.exit(1);
}
