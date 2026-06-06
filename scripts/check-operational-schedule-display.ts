import process from "node:process";

import { classifyCoachOperationalSignals } from "./lib/coach-operational-signals";
import {
  buildCanonicalEpisodeScheduleDisplayText,
  buildEpisodeScheduleContextIndex,
  formatScheduleOperationalSignalText,
  inferUnavailabilityAfterAvailableDates,
  resolveDayToIsoDate,
} from "@/features/trainingpeaks/operational-schedule-display";
import {
  buildTrainingPeaksOperationalSignalsSnapshotFromSignals,
  formatTrainingPeaksOperationalSignalsForTelegram,
} from "@/features/trainingpeaks/service";
import { formatTrainingPeaksAttentionSnapshotMessage } from "@/features/trainingpeaks/attention-telegram";
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
  updatedAt?: string;
  createdAt?: string;
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
    createdAt: input.createdAt ?? "2026-06-01T10:00:00.000Z",
    updatedAt: input.updatedAt ?? input.createdAt ?? "2026-06-01T10:00:00.000Z",
  };
}

function run(): void {
  const observedAt = "2026-06-01T12:00:00.000Z";
  const studentId = "sofia-student";

  const weekdayMap = new Map<string, string>([
    ["Monday", "2026-06-01"],
    ["Tuesday", "2026-06-02"],
    ["Wednesday", "2026-06-03"],
    ["Thursday", "2026-06-04"],
    ["Friday", "2026-06-05"],
    ["Saturday", "2026-06-06"],
    ["Sunday", "2026-06-07"],
  ]);
  for (const [day, expectedDate] of weekdayMap.entries()) {
    const got = resolveDayToIsoDate(day, observedAt, "this_week");
    assert(got === expectedDate, `Weekday check failed for ${day}: expected ${expectedDate}, got ${got}`);
  }

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
    availability!.structured_payload.resolved_available_dates.includes("2026-06-02") &&
      availability!.structured_payload.resolved_available_dates.includes("2026-06-04"),
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
  assert(inferred?.validFrom === "2026-06-05", `Expected unavailability from 2026-06-05, got ${inferred?.validFrom}`);
  assert(inferred?.validUntil === "2026-06-08", `Expected unavailability until 2026-06-08, got ${inferred?.validUntil}`);

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
    travelDisplay.includes("05.06") && travelDisplay.includes("08.06"),
    `Travel display should include inferred range, got: ${travelDisplay}`
  );
  assert(
    travelDisplay.startsWith("недоступна:"),
    `Travel display should render unavailability phrase first, got: ${travelDisplay}`
  );

  const availabilityDisplay = formatScheduleOperationalSignalText({
    signalType: "plan_generation_constraint",
    validFrom: availability!.structured_payload.valid_from,
    validUntil: availability!.structured_payload.valid_until,
    structuredPayload: availability!.structured_payload as Record<string, unknown>,
  });
  assert(
    availabilityDisplay.includes("вт 02.06") && availabilityDisplay.includes("чт 04.06"),
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
    telegramText.includes("вт 02.06") || telegramText.includes("доступна"),
    "tp_signals schedule output should include availability dates."
  );
  assert(
    telegramText.includes("05.06") || telegramText.includes("недоступна"),
    "tp_signals schedule output should include unavailability range."
  );

  const staleOverlayEpisodeKey = "student:sofia-student:observation:fixture:episode:schedule-stale-overlay";
  const staleOverlaySignals = [
    makeSignal({
      id: "sig-availability-old",
      studentId,
      signalType: "schedule_availability_window",
      episodeKey: staleOverlayEpisodeKey,
      updatedAt: "2026-06-01T08:00:00.000Z",
      structuredPayload: {
        resolved_available_dates: ["2026-06-03", "2026-06-05"],
      },
    }),
    makeSignal({
      id: "sig-availability-new",
      studentId,
      signalType: "schedule_availability_window",
      episodeKey: staleOverlayEpisodeKey,
      updatedAt: "2026-06-02T12:00:00.000Z",
      structuredPayload: {
        resolved_available_dates: ["2026-06-02", "2026-06-04"],
      },
    }),
    makeSignal({
      id: "sig-unavailability-new",
      studentId,
      signalType: "schedule_unavailability_window",
      episodeKey: staleOverlayEpisodeKey,
      updatedAt: "2026-06-02T12:00:00.000Z",
      validFrom: "2026-06-05",
      validUntil: "2026-06-08",
      structuredPayload: {},
    }),
    makeSignal({
      id: "sig-unavailability-legacy-vague",
      studentId,
      signalType: "schedule_unavailability_window",
      episodeKey: staleOverlayEpisodeKey,
      updatedAt: "2026-06-01T08:00:00.000Z",
      structuredPayload: {},
    }),
  ];

  const canonicalOverlayText = buildCanonicalEpisodeScheduleDisplayText({
    signals: staleOverlaySignals,
  });
  assert(canonicalOverlayText.includes("вт 02.06"), "Canonical overlay text should include Tue 02.06.");
  assert(canonicalOverlayText.includes("чт 04.06"), "Canonical overlay text should include Thu 04.06.");
  assert(canonicalOverlayText.includes("05.06—08.06"), "Canonical overlay text should include unavailability range.");
  assert(!canonicalOverlayText.includes("ср 03.06"), "Canonical overlay text must not include stale Wed 03.06.");
  assert(!canonicalOverlayText.includes("пт 05.06"), "Canonical overlay text must not include stale Fri 05.06.");
  const availabilityParts = canonicalOverlayText.split("; ").filter((part) => part.startsWith("доступна:"));
  assert(availabilityParts.length === 1, "Canonical overlay text must not duplicate availability prefix.");

  const overlaySnapshot = buildTrainingPeaksOperationalSignalsSnapshotFromSignals({
    signals: staleOverlaySignals,
    studentNameById: new Map([[studentId, "Sofia Vlasova"]]),
    asOfDate: "2026-06-03",
    scope: "schedule",
    limit: 10,
  });
  const overlayTelegramText = formatTrainingPeaksOperationalSignalsForTelegram(overlaySnapshot);
  assert(overlayTelegramText.includes("вт 02.06"), "tp_signals overlay fixture should show canonical Tue date.");
  assert(!overlayTelegramText.includes("ср 03.06"), "tp_signals overlay fixture must hide stale Wed date.");
  assert(!overlayTelegramText.includes("недоступность"), "tp_signals overlay fixture should suppress vague duplicate.");

  const attentionMessage = formatTrainingPeaksAttentionSnapshotMessage(
    {
      urgent: [],
      today: [],
      observe: [],
      fyi: [],
      noContact5Days: [],
      followUpToday: [],
      followUpOverflowCount: 0,
      planConstraintsToday: [
        {
          level: "today",
          studentName: "Sofia Vlasova",
          studentId,
          reason: canonicalOverlayText,
          signalKind: "operational_schedule",
        },
      ],
      planConstraintsOverflowCount: 0,
      movesToday: [
        {
          level: "today",
          studentName: "Ilya Bogdanov",
          studentId: "student-move",
          reason: "кандидат переноса 2026-06-05 → 2026-06-04",
          signalKind: "operational_move",
        },
      ],
      movesOverflowCount: 0,
    },
    "Утренний обзор"
  );
  assert(
    attentionMessage.includes("📅 Учесть в плане\n\n• Sofia Vlasova"),
    "Attention digest should include blank line after plan section header."
  );
  assert(
    attentionMessage.includes("🔁 Переносы\n\n• Ilya Bogdanov"),
    "Attention digest should include blank line after moves section header."
  );

  const restrictionWithReason = formatScheduleOperationalSignalText({
    signalType: "schedule_availability_window",
    validFrom: null,
    validUntil: "2026-06-07",
    structuredPayload: {
      display_summary: "Голова просто раскалывается, не могу сегодня",
      valid_until: "2026-06-07",
    },
  });
  assert(
    restrictionWithReason === "ограничение: головная боль (до 07.06)",
    `Restriction with reason should preserve short reason, got: ${restrictionWithReason}`
  );

  const restrictionWithoutReason = formatScheduleOperationalSignalText({
    signalType: "schedule_availability_window",
    validFrom: null,
    validUntil: "2026-06-07",
    structuredPayload: {
      valid_until: "2026-06-07",
    },
  });
  assert(
    restrictionWithoutReason === "ограничение (до 07.06)",
    `Restriction without reason should keep generic wording, got: ${restrictionWithoutReason}`
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
