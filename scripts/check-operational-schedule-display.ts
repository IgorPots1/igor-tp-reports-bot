import process from "node:process";

import { classifyCoachOperationalSignals } from "./lib/coach-operational-signals";
import {
  buildEpisodeScheduleContextIndex,
  formatScheduleOperationalSignalText,
  inferUnavailabilityAfterAvailableDates,
} from "@/features/trainingpeaks/operational-schedule-display";
import {
  buildTrainingPeaksOperationalSignalsSnapshotFromSignals,
  formatTrainingPeaksOperationalSignalsForTelegram,
} from "@/features/trainingpeaks/service";
import type { TrainingPeaksStudentOperationalSignal } from "@/features/trainingpeaks/repository";

const LOG_PREFIX = "[check-operational-schedule-display]";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function makeSignal(input: {
  id: string;
  studentId: string;
  signalType: string;
  structuredPayload?: Record<string, unknown>;
  validFrom?: string | null;
  validUntil?: string | null;
  episodeKey?: string | null;
}): TrainingPeaksStudentOperationalSignal {
  const metadata: Record<string, unknown> = {};
  if (input.episodeKey) {
    metadata.episode_key = input.episodeKey;
  }
  return {
    id: input.id,
    studentId: input.studentId,
    signalType: input.signalType as TrainingPeaksStudentOperationalSignal["signalType"],
    status: "active",
    sourceType: "fixture",
    sourceObservationId: null,
    telegramChatId: null,
    telegramMessageId: null,
    telegramMessageThreadId: null,
    structuredPayload: input.structuredPayload ?? {},
    confidence: null,
    validFrom: input.validFrom ?? null,
    validUntil: input.validUntil ?? null,
    sourceDate: null,
    targetDate: null,
    sourceDay: null,
    targetDay: null,
    linkedMemoryItemId: null,
    linkedCaseId: null,
    linkedActionId: null,
    dedupeKey: `fixture:${input.id}`,
    consumedAt: null,
    metadata,
    createdAt: "2026-06-01T10:00:00.000Z",
    updatedAt: "2026-06-01T10:00:00.000Z",
  };
}

function run(): void {
  const observedAt = "2026-05-31T12:00:00.000Z";
  const studentId = "sofia-student";

  const availabilityCandidates = classifyCoachOperationalSignals({
    sourceType: "business_dm",
    textPreview: "на этой смогу во вторник и четверг",
    labels: [],
    metadata: {},
    observedAt,
    studentId,
  });
  const availability = availabilityCandidates.find((item) => item.signal_type === "plan_generation_constraint");
  assert(Boolean(availability), "Sofia availability signal missing.");
  assert(
    availability!.structured_payload.resolved_available_dates.includes("2026-06-03") &&
      availability!.structured_payload.resolved_available_dates.includes("2026-06-05"),
    "Sofia availability should resolve Tue/Thu dates for anchor week."
  );

  const travelCandidates = classifyCoachOperationalSignals({
    sourceType: "business_dm",
    textPreview: "Потом на 4 дня на винный фестиваль улетаю, точно бегать не смогу.",
    labels: [],
    metadata: {},
    observedAt: "2026-05-31T13:00:00.000Z",
    studentId,
  });
  const travel = travelCandidates.find((item) => item.signal_type === "schedule_unavailability_window");
  assert(Boolean(travel), "Sofia travel unavailability signal missing.");
  assert(travel!.structured_payload.duration_days === 4, "Sofia travel should keep duration_days=4.");

  const inferred = inferUnavailabilityAfterAvailableDates({
    availableDates: availability!.structured_payload.resolved_available_dates,
    durationDays: 4,
  });
  assert(inferred?.validFrom === "2026-06-06", `Expected unavailability from 2026-06-06, got ${inferred?.validFrom}`);
  assert(inferred?.validUntil === "2026-06-09", `Expected unavailability until 2026-06-09, got ${inferred?.validUntil}`);

  const episodeKey = "student:sofia-student:observation:fixture:episode:schedule_unavailability";
  const signals = [
    makeSignal({
      id: "sig-availability",
      studentId,
      signalType: "plan_generation_constraint",
      episodeKey,
      structuredPayload: availability!.structured_payload as Record<string, unknown>,
      validFrom: availability!.structured_payload.valid_from,
      validUntil: availability!.structured_payload.valid_until,
    }),
    makeSignal({
      id: "sig-travel",
      studentId,
      signalType: "schedule_unavailability_window",
      episodeKey,
      structuredPayload: travel!.structured_payload as Record<string, unknown>,
      validFrom: null,
      validUntil: null,
    }),
  ];

  const episodeIndex = buildEpisodeScheduleContextIndex(signals);
  const episodeContext = episodeIndex.get(`${studentId}:${episodeKey}`);
  assert(Boolean(episodeContext), "Episode schedule context should be built.");

  const travelDisplay = formatScheduleOperationalSignalText({
    signalType: "schedule_unavailability_window",
    validFrom: null,
    validUntil: null,
    structuredPayload: travel!.structured_payload as Record<string, unknown>,
    episodeContext: episodeContext ?? null,
  });
  assert(
    travelDisplay.includes("2026-06-06") && travelDisplay.includes("2026-06-09"),
    `Travel display should include inferred range, got: ${travelDisplay}`
  );

  const availabilityDisplay = formatScheduleOperationalSignalText({
    signalType: "plan_generation_constraint",
    validFrom: availability!.structured_payload.valid_from,
    validUntil: availability!.structured_payload.valid_until,
    structuredPayload: availability!.structured_payload as Record<string, unknown>,
  });
  assert(
    availabilityDisplay.includes("2026-06-03") && availabilityDisplay.includes("2026-06-05"),
    `Availability display should include concrete dates, got: ${availabilityDisplay}`
  );

  const snapshot = buildTrainingPeaksOperationalSignalsSnapshotFromSignals({
    signals,
    studentNameById: new Map([[studentId, "Sofia Vlasova"]]),
    asOfDate: "2026-06-03",
    scope: "schedule",
    limit: 10,
  });
  const telegramText = formatTrainingPeaksOperationalSignalsForTelegram(snapshot);
  assert(telegramText.includes("Sofia Vlasova"), "tp_signals schedule output should include student name.");
  assert(
    telegramText.includes("2026-06-03") || telegramText.includes("доступна"),
    "tp_signals schedule output should include availability dates."
  );
  assert(
    telegramText.includes("2026-06-06") || telegramText.includes("недоступна"),
    "tp_signals schedule output should include unavailability range."
  );

  console.log(`${LOG_PREFIX} PASS`);
}

try {
  run();
} catch (error) {
  console.error(`${LOG_PREFIX} FAIL`);
  console.error((error as Error).message);
  process.exit(1);
}
