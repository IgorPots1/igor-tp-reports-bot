import { evaluateTrainingPeaksRecoveryAlert } from "@/features/trainingpeaks/recovery-alerts";
import {
  getTrainingPeaksStudentById,
  listTrainingPeaksTelegramContextObservationsForStudent,
  listTrainingPeaksHealthMetricsForStudentDateRange,
  listTrainingPeaksStudentHealthMetricProfiles,
  listTrainingPeaksWorkoutCacheForStudentDateRange,
  type TrainingPeaksWorkoutCacheRow,
} from "@/features/trainingpeaks/repository";
import { classifyTrainingPeaksWorkoutActivity } from "@/features/trainingpeaks/workout-activity-classification";

const BELGRADE_TIMEZONE = "Europe/Belgrade";
const LOOKBACK_DAYS = 7;
const CACHE_STALE_AFTER_MS = 48 * 60 * 60 * 1000;
const TELEGRAM_CONTEXT_NOTES_MAX_LENGTH = 500;
const RECENT_OBSERVATION_LABELS_MAX_COUNT = 6;

export type TrainingPeaksReplyDraftWorkoutSummary = {
  workoutDate: string;
  title: string;
  status: "planned" | "completed" | "planned_and_completed" | "other";
  activityLabel: string;
  plannedDuration: string | null;
  completedDuration: string | null;
  plannedDistance: string | null;
  completedDistance: string | null;
};

export type TrainingPeaksReplyDraftContext = {
  studentName: string;
  studentSlug: string;
  studentUuid: string;
  periodFrom: string;
  periodTo: string;
  cacheStatus: "ok" | "empty" | "stale";
  cacheStatusNote: string;
  workouts: TrainingPeaksReplyDraftWorkoutSummary[];
  missedPlannedRunningDates: string[];
  recoveryAlertMessage: string | null;
  recoveryAlertAvailable: boolean;
  telegramContextBullets: string[];
  promptContext: string;
};

export type BuildTrainingPeaksReplyDraftContextInput = {
  studentUuid: string;
  studentSlug: string;
  studentName: string;
  referenceDate?: string;
};

export async function buildTrainingPeaksReplyDraftContext(
  input: BuildTrainingPeaksReplyDraftContextInput
): Promise<TrainingPeaksReplyDraftContext> {
  const periodTo = input.referenceDate?.trim() || getTodayIsoInTimezone(BELGRADE_TIMEZONE);
  const periodFrom = shiftIsoDate(periodTo, -(LOOKBACK_DAYS - 1));

  const [workoutRows, healthProfiles] = await Promise.all([
    listTrainingPeaksWorkoutCacheForStudentDateRange({
      studentId: input.studentUuid,
      from: periodFrom,
      to: periodTo,
    }),
    listTrainingPeaksStudentHealthMetricProfiles(),
  ]);
  const [student, recentContextObservations] = await Promise.all([
    getTrainingPeaksStudentById(input.studentUuid),
    listTrainingPeaksTelegramContextObservationsForStudent(input.studentUuid, 10),
  ]);

  const cacheStatus = resolveCacheStatus(workoutRows);
  const workouts = workoutRows.map(summarizeWorkoutRow);
  const missedPlannedRunningDates = collectMissedPlannedRunningDates(workoutRows);
  const telegramContextNotes = trimTelegramContextNotes(student?.telegramContextNotes ?? null);
  const recentObservationLabels = collectRecentObservationLabels(recentContextObservations);
  const recovery = await resolveRecoveryAlert({
    studentUuid: input.studentUuid,
    studentName: input.studentName,
    targetDate: periodTo,
    healthProfiles,
  });

  const telegramContextBullets = buildTelegramContextBullets({
    periodFrom,
    periodTo,
    cacheStatus,
    workouts,
    missedPlannedRunningDates,
    recoveryAlertMessage: recovery.message,
    recoveryAlertAvailable: recovery.available,
    recentObservationLabels,
  });

  const promptContext = buildPromptContext({
    studentName: input.studentName,
    studentSlug: input.studentSlug,
    studentUuid: input.studentUuid,
    periodFrom,
    periodTo,
    cacheStatus,
    cacheStatusNote: cacheStatus.note,
    workouts,
    missedPlannedRunningDates,
    recoveryAlertMessage: recovery.message,
    recoveryAlertAvailable: recovery.available,
    telegramContextNotes,
    recentObservationLabels,
  });

  return {
    studentName: input.studentName,
    studentSlug: input.studentSlug,
    studentUuid: input.studentUuid,
    periodFrom,
    periodTo,
    cacheStatus: cacheStatus.kind,
    cacheStatusNote: cacheStatus.note,
    workouts,
    missedPlannedRunningDates,
    recoveryAlertMessage: recovery.message,
    recoveryAlertAvailable: recovery.available,
    telegramContextBullets,
    promptContext,
  };
}

function resolveCacheStatus(rows: TrainingPeaksWorkoutCacheRow[]): {
  kind: "ok" | "empty" | "stale";
  note: string;
} {
  if (rows.length === 0) {
    return {
      kind: "empty",
      note: "В кэше Supabase нет тренировок за последние 7 дней — не выдумывай факты о плане.",
    };
  }

  const latestScannedAt = rows.reduce<string | null>((latest, row) => {
    if (!row.scannedAt) {
      return latest;
    }
    if (!latest || row.scannedAt > latest) {
      return row.scannedAt;
    }
    return latest;
  }, null);

  if (!latestScannedAt) {
    return {
      kind: "stale",
      note: "Кэш тренировок без отметки scanned_at — данные могут быть неактуальны.",
    };
  }

  const scannedAtMs = Date.parse(latestScannedAt);
  if (!Number.isFinite(scannedAtMs) || Date.now() - scannedAtMs > CACHE_STALE_AFTER_MS) {
    return {
      kind: "stale",
      note: `Последний скан кэша: ${formatScannedAtLabel(latestScannedAt)}. Данные могут быть неактуальны.`,
    };
  }

  return {
    kind: "ok",
    note: `Кэш обновлён ${formatScannedAtLabel(latestScannedAt)}.`,
  };
}

function summarizeWorkoutRow(row: TrainingPeaksWorkoutCacheRow): TrainingPeaksReplyDraftWorkoutSummary {
  const classification = classifyTrainingPeaksWorkoutActivity({
    title: row.title,
    sportOrTypeCode: row.sportOrTypeCode,
    workoutTypeValueId: row.workoutTypeValueId,
    workoutSubTypeId: row.workoutSubTypeId,
  });

  return {
    workoutDate: row.workoutDate,
    title: row.title?.trim() || "Без названия",
    status: resolveWorkoutStatus(row),
    activityLabel: formatActivityFamilyLabel(classification.family),
    plannedDuration: formatWorkoutDuration(row.plannedTimeRaw),
    completedDuration: formatWorkoutDuration(row.completedTimeRaw),
    plannedDistance: formatWorkoutDistance(row.plannedDistanceRaw),
    completedDistance: formatWorkoutDistance(row.completedDistanceRaw),
  };
}

function resolveWorkoutStatus(
  row: TrainingPeaksWorkoutCacheRow
): TrainingPeaksReplyDraftWorkoutSummary["status"] {
  if (row.isPlanned && row.isCompleted) {
    return "planned_and_completed";
  }
  if (row.isCompleted) {
    return "completed";
  }
  if (row.isPlanned) {
    return "planned";
  }
  return "other";
}

function collectMissedPlannedRunningDates(rows: TrainingPeaksWorkoutCacheRow[]): string[] {
  const dates = new Set<string>();

  for (const row of rows) {
    if (!row.isPlanned || row.isCompleted) {
      continue;
    }

    const classification = classifyTrainingPeaksWorkoutActivity({
      title: row.title,
      sportOrTypeCode: row.sportOrTypeCode,
      workoutTypeValueId: row.workoutTypeValueId,
      workoutSubTypeId: row.workoutSubTypeId,
    });

    if (classification.isRunning) {
      dates.add(row.workoutDate);
    }
  }

  return [...dates].sort();
}

async function resolveRecoveryAlert(input: {
  studentUuid: string;
  studentName: string;
  targetDate: string;
  healthProfiles: Awaited<ReturnType<typeof listTrainingPeaksStudentHealthMetricProfiles>>;
}): Promise<{ available: boolean; message: string | null }> {
  const profile = input.healthProfiles.find((item) => item.studentId === input.studentUuid);

  if (!profile?.recoveryMetricsEnabled) {
    return { available: false, message: null };
  }

  const from = shiftIsoDate(input.targetDate, -2);
  const metrics = await listTrainingPeaksHealthMetricsForStudentDateRange({
    studentId: input.studentUuid,
    from,
    to: input.targetDate,
  });

  const alert = evaluateTrainingPeaksRecoveryAlert({
    profile: {
      studentId: input.studentUuid,
      studentName: input.studentName,
    },
    metrics,
    targetDate: input.targetDate,
    lookbackDays: 3,
  });

  return {
    available: true,
    message: alert?.message ?? null,
  };
}

function buildTelegramContextBullets(input: {
  periodFrom: string;
  periodTo: string;
  cacheStatus: { kind: "ok" | "empty" | "stale"; note: string };
  workouts: TrainingPeaksReplyDraftWorkoutSummary[];
  missedPlannedRunningDates: string[];
  recoveryAlertMessage: string | null;
  recoveryAlertAvailable: boolean;
  recentObservationLabels: string[];
}): string[] {
  const bullets: string[] = [];

  const completedCount = input.workouts.filter(
    (workout) => workout.status === "completed" || workout.status === "planned_and_completed"
  ).length;
  const plannedOnlyCount = input.workouts.filter((workout) => workout.status === "planned").length;

  bullets.push(
    `Период ${input.periodFrom} — ${input.periodTo}: ${input.workouts.length} тренировок в кэше (${completedCount} выполнено, ${plannedOnlyCount} только в плане).`
  );

  if (input.cacheStatus.kind !== "ok") {
    bullets.push(input.cacheStatus.note);
  } else {
    const latestCompleted = [...input.workouts]
      .reverse()
      .find((workout) => workout.status === "completed" || workout.status === "planned_and_completed");
    if (latestCompleted) {
      bullets.push(
        `Последняя выполненная: ${latestCompleted.workoutDate}, «${latestCompleted.title}»${latestCompleted.completedDuration ? `, ${latestCompleted.completedDuration}` : ""}.`
      );
    }
  }

  if (input.missedPlannedRunningDates.length > 0) {
    bullets.push(
      `Пропущенные запланированные беговые: ${input.missedPlannedRunningDates.join(", ")}.`
    );
  }

  if (input.recoveryAlertAvailable && input.recoveryAlertMessage) {
    bullets.push(input.recoveryAlertMessage);
  }

  const limitedBullets = bullets.slice(0, 3);
  if (input.recentObservationLabels.length > 0) {
    limitedBullets.push(`Недавние Telegram-наблюдения: ${input.recentObservationLabels.join(", ")}.`);
  }

  return limitedBullets.slice(0, 4);
}

function buildPromptContext(input: {
  studentName: string;
  studentSlug: string;
  studentUuid: string;
  periodFrom: string;
  periodTo: string;
  cacheStatus: { kind: "ok" | "empty" | "stale"; note: string };
  cacheStatusNote: string;
  workouts: TrainingPeaksReplyDraftWorkoutSummary[];
  missedPlannedRunningDates: string[];
  recoveryAlertMessage: string | null;
  recoveryAlertAvailable: boolean;
  telegramContextNotes: string | null;
  recentObservationLabels: string[];
}): string {
  const workoutLines =
    input.workouts.length === 0
      ? ["workouts: []"]
      : [
          "workouts:",
          ...input.workouts.map((workout) => {
            const metrics = [
              workout.plannedDuration ? `plan_time=${workout.plannedDuration}` : null,
              workout.completedDuration ? `done_time=${workout.completedDuration}` : null,
              workout.plannedDistance ? `plan_dist=${workout.plannedDistance}` : null,
              workout.completedDistance ? `done_dist=${workout.completedDistance}` : null,
            ]
              .filter(Boolean)
              .join(", ");
            return `- ${workout.workoutDate} | ${workout.status} | ${workout.activityLabel} | ${workout.title}${metrics ? ` | ${metrics}` : ""}`;
          }),
        ];

  return [
    `student_name=${input.studentName}`,
    `student_slug=${input.studentSlug}`,
    `student_uuid=${input.studentUuid}`,
    `period=${input.periodFrom}..${input.periodTo}`,
    `cache_status=${input.cacheStatus.kind}`,
    `cache_note=${input.cacheStatusNote}`,
    ...(input.telegramContextNotes ? [`telegram_context_notes=${input.telegramContextNotes}`] : []),
    ...(input.recentObservationLabels.length > 0
      ? [`recent_observation_labels=${input.recentObservationLabels.join(", ")}`]
      : []),
    ...workoutLines,
    input.missedPlannedRunningDates.length > 0
      ? `missed_planned_running_dates=${input.missedPlannedRunningDates.join(", ")}`
      : "missed_planned_running_dates=none",
    input.recoveryAlertAvailable
      ? `recovery_alert=${input.recoveryAlertMessage ?? "none"}`
      : "recovery_alert=not_available",
  ].join("\n");
}

function trimTelegramContextNotes(value: string | null): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }

  if (normalized.length <= TELEGRAM_CONTEXT_NOTES_MAX_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, TELEGRAM_CONTEXT_NOTES_MAX_LENGTH - 1)}…`;
}

function collectRecentObservationLabels(
  observations: Awaited<ReturnType<typeof listTrainingPeaksTelegramContextObservationsForStudent>>
): string[] {
  const labels = new Set<string>();

  for (const observation of observations) {
    for (const label of observation.labels) {
      if (!label || labels.has(label)) {
        continue;
      }

      labels.add(label);
      if (labels.size >= RECENT_OBSERVATION_LABELS_MAX_COUNT) {
        return [...labels];
      }
    }
  }

  return [...labels];
}

function formatActivityFamilyLabel(family: string): string {
  if (family === "run") {
    return "бег";
  }
  if (family === "bike") {
    return "вел";
  }
  if (family === "swim") {
    return "плавание";
  }
  if (family === "strength") {
    return "силовая";
  }
  if (family === "day_off") {
    return "отдых";
  }
  return family;
}

function formatWorkoutDuration(raw: number | string | null): string | null {
  const hours = toFiniteNumber(raw);
  if (hours === null || hours <= 0) {
    return null;
  }

  const totalMinutes = Math.round(hours * 60);
  if (totalMinutes < 60) {
    return `${totalMinutes} мин`;
  }

  const wholeHours = Math.floor(totalMinutes / 60);
  const remainderMinutes = totalMinutes % 60;
  if (remainderMinutes === 0) {
    return `${wholeHours} ч`;
  }

  return `${wholeHours} ч ${remainderMinutes} мин`;
}

function formatWorkoutDistance(raw: number | string | null): string | null {
  const km = toFiniteNumber(raw);
  if (km === null || km <= 0) {
    return null;
  }

  return `${km.toFixed(1)} км`;
}

function toFiniteNumber(value: number | string | null): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatScannedAtLabel(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: BELGRADE_TIMEZONE,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function getTodayIsoInTimezone(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function shiftIsoDate(isoDate: string, days: number): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return isoDate;
  }

  const shifted = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days, 12, 0, 0)
  );
  return shifted.toISOString().slice(0, 10);
}
