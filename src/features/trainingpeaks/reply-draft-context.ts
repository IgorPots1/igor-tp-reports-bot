import { evaluateTrainingPeaksRecoveryAlert } from "@/features/trainingpeaks/recovery-alerts";
import {
  getTrainingPeaksStudentById,
  getTrainingPeaksStudentContactStatus,
  listActiveTrainingPeaksStudentMemoryItems,
  type TrainingPeaksStudentMemoryItem,
  type TrainingPeaksStudentMemoryType,
  listTrainingPeaksTelegramContextObservationsForStudent,
  listTrainingPeaksHealthMetricsForStudentDateRange,
  listRecentTrainingPeaksStudentContactEvents,
  listTrainingPeaksStudentHealthMetricProfiles,
  listTrainingPeaksWorkoutCacheForStudentDateRange,
  type TrainingPeaksStudentContactEvent,
  type TrainingPeaksStudentContactStatus,
  type TrainingPeaksWorkoutCacheRow,
} from "@/features/trainingpeaks/repository";
import { isMemoryItemFresh } from "@/features/trainingpeaks/memory-freshness";
import { classifyTrainingPeaksWorkoutActivity } from "@/features/trainingpeaks/workout-activity-classification";
import {
  buildResolvedCommunicationProfilePromptLines,
  resolveStudentCommunicationProfile,
  type ResolvedStudentCommunicationProfile,
} from "@/features/trainingpeaks/communication-profile";

const BELGRADE_TIMEZONE = "Europe/Belgrade";
const LOOKBACK_DAYS = 7;
const CACHE_STALE_AFTER_MS = 48 * 60 * 60 * 1000;
const TELEGRAM_CONTEXT_NOTES_MAX_LENGTH = 500;
const RECENT_OBSERVATION_LABELS_MAX_COUNT = 6;
const COACH_MEMORY_MAX_TOTAL_ITEMS = 12;
const COACH_MEMORY_MAX_ITEMS_PER_GROUP = 3;
const HUMANIZED_OBSERVATION_LABELS: Partial<Record<string, string>> = {
  question_to_coach: "ученик задавал вопрос",
  pain_or_health: "был сигнал по самочувствию/дискомфорту",
  schedule_context: "обсуждался перенос или расписание",
  report_like: "был отчёт/сообщение о тренировке",
  race_context: "обсуждался старт",
  move_workout_candidate: "возможный запрос на перенос тренировки",
};

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
  coachMemoryPromptBlock: string | null;
  resolvedCommunicationProfile: ResolvedStudentCommunicationProfile;
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
      // This module never touches row.sourceSnapshot (summarizeWorkoutRow, resolveWorkoutStatus and
      // collectMissedPlannedRunningDates read scalars only), and it runs on the hottest path in the
      // product — one reply draft per incoming student message. Skipping the jsonb payload cuts the
      // bytes per draft by roughly an order of magnitude.
      includeSourceSnapshot: false,
    }),
    listTrainingPeaksStudentHealthMetricProfiles(),
  ]);
  const [student, recentContextObservations, contactStatus, recentContactEvents] = await Promise.all([
    getTrainingPeaksStudentById(input.studentUuid),
    listTrainingPeaksTelegramContextObservationsForStudent(input.studentUuid, 10),
    getTrainingPeaksStudentContactStatus(input.studentUuid),
    listRecentTrainingPeaksStudentContactEvents({
      studentId: input.studentUuid,
      limit: 5,
    }),
  ]);
  const activeMemoryItems = await safelyListActiveCoachMemoryItems(input.studentUuid);

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
    contactStatus,
    recentContactEvents,
    recentObservationLabels,
  });

  const resolvedCommunicationProfile = resolveStudentCommunicationProfile({
    telegramFormality: student?.telegramFormality ?? "unknown",
    telegramContextNotes,
    activeMemoryItems,
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
    contactStatus,
    recentContactEvents,
    recentObservationLabels,
    telegramFormality: student?.telegramFormality ?? "unknown",
    activeMemoryItems,
    resolvedCommunicationProfile,
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
    coachMemoryPromptBlock: buildCoachMemoryPromptBlock(activeMemoryItems, periodTo),
    resolvedCommunicationProfile,
    promptContext,
  };
}

async function safelyListActiveCoachMemoryItems(studentId: string): Promise<TrainingPeaksStudentMemoryItem[]> {
  try {
    return await listActiveTrainingPeaksStudentMemoryItems(studentId);
  } catch (error) {
    if (isMissingCoachMemoryTableError(error)) {
      console.warn("TrainingPeaks reply draft context coach memory table unavailable; continuing without memory", {
        studentId,
      });
      return [];
    }
    throw error;
  }
}

function isMissingCoachMemoryTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();
  return normalized.includes("trainingpeaks_student_memory_items") && (
    normalized.includes("does not exist") ||
    normalized.includes("relation") ||
    normalized.includes("42p01")
  );
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
  contactStatus: TrainingPeaksStudentContactStatus | null;
  recentContactEvents: TrainingPeaksStudentContactEvent[];
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

  const contactBullets = buildContactStatusBullets(input.contactStatus, input.recentContactEvents);
  const limitedBullets = [...bullets, ...contactBullets].slice(0, 3);
  const humanizedObservationLabels = humanizeRecentObservationLabels(input.recentObservationLabels);
  if (humanizedObservationLabels.length > 0) {
    limitedBullets.push(`Недавние Telegram-наблюдения: ${humanizedObservationLabels.join(", ")}.`);
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
  telegramFormality: "ty" | "vy" | "unknown";
  contactStatus: TrainingPeaksStudentContactStatus | null;
  recentContactEvents: TrainingPeaksStudentContactEvent[];
  recentObservationLabels: string[];
  activeMemoryItems: TrainingPeaksStudentMemoryItem[];
  resolvedCommunicationProfile: ResolvedStudentCommunicationProfile;
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
  const recentContactEventsSummary = formatRecentContactEventsSummary(input.recentContactEvents);
  const coachMemoryPromptBlock = buildCoachMemoryPromptBlock(input.activeMemoryItems, input.periodTo);

  return [
    `student_name=${input.studentName}`,
    `student_slug=${input.studentSlug}`,
    `student_uuid=${input.studentUuid}`,
    `period=${input.periodFrom}..${input.periodTo}`,
    `cache_status=${input.cacheStatus.kind}`,
    `cache_note=${input.cacheStatusNote}`,
    `telegram_formality_manual=${input.telegramFormality}`,
    ...(input.telegramContextNotes ? [`telegram_context_notes=${input.telegramContextNotes}`] : []),
    ...(input.recentObservationLabels.length > 0
      ? [`recent_observation_labels=${input.recentObservationLabels.join(", ")}`]
      : []),
    ...buildContactStatusPromptLines(input.contactStatus),
    ...(recentContactEventsSummary ? [`recent_contact_events=${recentContactEventsSummary}`] : []),
    "",
    ...buildResolvedCommunicationProfilePromptLines(input.resolvedCommunicationProfile),
    ...(coachMemoryPromptBlock ? ["", coachMemoryPromptBlock] : []),
    ...workoutLines,
    input.missedPlannedRunningDates.length > 0
      ? `missed_planned_running_dates=${input.missedPlannedRunningDates.join(", ")}`
      : "missed_planned_running_dates=none",
    input.recoveryAlertAvailable
      ? `recovery_alert=${input.recoveryAlertMessage ?? "none"}`
      : "recovery_alert=not_available",
  ].join("\n");
}

function buildCoachMemoryPromptBlock(
  items: TrainingPeaksStudentMemoryItem[],
  asOfDate: string
): string | null {
  if (items.length === 0) {
    return null;
  }

  // Drop items that have gone stale for their type (per-type freshness window). Display-only: the DB
  // row stays active, we just don't feed an old cold / mood note into the draft as current context.
  const freshItems = items.filter((item) => isMemoryItemFresh(item, asOfDate));
  const totalItems = freshItems.slice(0, COACH_MEMORY_MAX_TOTAL_ITEMS);
  if (totalItems.length === 0) {
    return null;
  }

  const groupOrder = [
    "Communication style",
    "Schedule / planning",
    "Health / injury",
    "Emotional / load",
    "Goals / races",
    "Equipment",
  ] as const;
  const grouped = new Map<(typeof groupOrder)[number], string[]>();

  for (const item of totalItems) {
    const group = getCoachMemoryGroupLabel(item.memoryType);
    const current = grouped.get(group) ?? [];
    if (current.length >= COACH_MEMORY_MAX_ITEMS_PER_GROUP) {
      continue;
    }
    current.push(formatCoachMemoryItemLine(item));
    grouped.set(group, current);
  }

  const lines: string[] = ["Coach Memory:"];
  let shownCount = 0;
  for (const group of groupOrder) {
    const entries = grouped.get(group);
    if (!entries || entries.length === 0) {
      continue;
    }
    lines.push(`${group}:`);
    for (const entry of entries) {
      lines.push(`- ${entry}`);
    }
    shownCount += entries.length;
  }

  if (shownCount === 0) {
    return null;
  }

  // Count only fresh-but-unshown items here; stale items were intentionally suppressed above and must
  // not be advertised back ("+ N notes" would defeat hiding them).
  const hiddenCount = freshItems.length - shownCount;
  if (hiddenCount > 0) {
    lines.push(`+ еще ${hiddenCount} заметок`);
  }

  return lines.join("\n");
}

function getCoachMemoryGroupLabel(
  memoryType: TrainingPeaksStudentMemoryType
): "Communication style" | "Schedule / planning" | "Health / injury" | "Emotional / load" | "Goals / races" | "Equipment" {
  if (memoryType === "communication_style") {
    return "Communication style";
  }
  if (
    memoryType === "schedule_constraint" ||
    memoryType === "availability_preference" ||
    memoryType === "planning_preference" ||
    memoryType === "travel_or_life_event"
  ) {
    return "Schedule / planning";
  }
  if (memoryType === "pain_or_injury" || memoryType === "health_status") {
    return "Health / injury";
  }
  if (memoryType === "emotional_state" || memoryType === "load_tolerance") {
    return "Emotional / load";
  }
  if (memoryType === "race_or_goal") {
    return "Goals / races";
  }
  return "Equipment";
}

function formatCoachMemoryItemLine(item: TrainingPeaksStudentMemoryItem): string {
  const summary = item.summaryText.replace(/\s+/g, " ").trim();
  const normalizedSummary = summary || "Без описания";
  const extras: string[] = [];

  if (item.memoryType === "communication_style") {
    const formality = readStructuredString(item.structured, "formality");
    const tone = readStructuredString(item.structured, "tone");
    const preferredGreeting = readStructuredString(item.structured, "preferred_greeting");

    if (formality === "ty") {
      extras.push("формальность: на ты");
    } else if (formality === "vy") {
      extras.push("формальность: на вы");
    }
    if (tone) {
      extras.push(`тон: ${tone}`);
    }
    if (preferredGreeting) {
      extras.push(`приветствие: "${preferredGreeting}"`);
    }
  }

  const validUntil = formatCoachMemoryValidUntil(item.validUntil);
  if (validUntil) {
    extras.push(`до ${validUntil}`);
  }

  return extras.length > 0 ? `${normalizedSummary} (${extras.join(", ")})` : normalizedSummary;
}

function formatCoachMemoryValidUntil(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    return null;
  }
  return normalized.length >= 10 ? normalized.slice(0, 10) : normalized;
}

function readStructuredString(structured: Record<string, unknown>, key: string): string | null {
  const value = structured[key];
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || null;
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

function humanizeRecentObservationLabels(labels: string[]): string[] {
  const humanized = new Set<string>();

  for (const label of labels) {
    if (!label || label === "unknown") {
      continue;
    }

    const mapped = HUMANIZED_OBSERVATION_LABELS[label];
    if (mapped) {
      humanized.add(mapped);
    }
  }

  return [...humanized];
}

function buildContactStatusPromptLines(
  status: TrainingPeaksStudentContactStatus | null
): string[] {
  if (!status) {
    return [];
  }

  return [
    status.silenceDays !== null ? `contact_silence_days=${status.silenceDays}` : null,
    status.lastAthleteMessageAt
      ? `contact_last_athlete_message_at=${status.lastAthleteMessageAt}`
      : null,
    status.lastCoachTouchAt ? `contact_last_coach_touch_at=${status.lastCoachTouchAt}` : null,
    status.unansweredSince ? `contact_unanswered_since=${status.unansweredSince}` : null,
    status.unansweredSeconds !== null
      ? `contact_unanswered_seconds=${status.unansweredSeconds}`
      : null,
  ].filter((line): line is string => Boolean(line));
}

function buildContactStatusBullets(
  status: TrainingPeaksStudentContactStatus | null,
  recentEvents: TrainingPeaksStudentContactEvent[]
): string[] {
  const bullets: string[] = [];

  if (status?.unansweredSince) {
    const daysLabel =
      status.silenceDays === null
        ? "недавно"
        : status.silenceDays === 0
          ? "сегодня"
          : `${status.silenceDays} дн. назад`;
    bullets.push(`Контакт: ученик писал ${daysLabel}, ответа или касания тренера после этого пока не было.`);
  } else if (status?.silenceDays !== null && status?.silenceDays !== undefined) {
    const daysText =
      status.silenceDays === 0 ? "сегодня" : `${status.silenceDays} ${pluralizeRuDays(status.silenceDays)}`;
    bullets.push(`Контакт: ученик не писал ${daysText}.`);
  }

  if (status?.lastCoachTouchAt) {
    const latestCoachEvent = recentEvents.find((event) =>
      event.eventType === "coach_message" ||
      event.eventType === "report_sent" ||
      event.eventType === "coach_action_decision"
    );
    const sourceLabel = latestCoachEvent ? formatContactEventBulletLabel(latestCoachEvent) : "касание";
    bullets.push(`Последнее касание тренера: ${sourceLabel}, ${formatIsoDateShort(status.lastCoachTouchAt)}.`);
  }

  return bullets;
}

function formatRecentContactEventsSummary(events: TrainingPeaksStudentContactEvent[]): string | null {
  if (events.length === 0) {
    return null;
  }

  return events
    .map((event) => `${event.eventType}:${event.source}:${formatIsoDateOnly(event.occurredAt)}`)
    .join(", ");
}

function formatContactEventBulletLabel(event: TrainingPeaksStudentContactEvent): string {
  if (event.eventType === "report_sent") {
    return "отчёт";
  }
  if (event.eventType === "coach_action_decision") {
    return "действие";
  }
  if (event.eventType === "coach_message") {
    return "сообщение";
  }
  return "касание";
}

function formatIsoDateOnly(value: string): string {
  return value.slice(0, 10);
}

function formatIsoDateShort(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return formatIsoDateOnly(value);
  }

  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: BELGRADE_TIMEZONE,
    day: "numeric",
    month: "short",
  }).format(parsed);
}

function pluralizeRuDays(value: number): string {
  const mod10 = value % 10;
  const mod100 = value % 100;

  if (mod10 === 1 && mod100 !== 11) {
    return "день";
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return "дня";
  }
  return "дней";
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
