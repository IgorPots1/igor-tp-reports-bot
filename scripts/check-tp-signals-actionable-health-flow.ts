import process from "node:process";

import {
  buildTrainingPeaksOperationalSignalsSnapshotFromSignals,
  formatTrainingPeaksOperationalSignalsForTelegram,
  formatTrainingPeaksOperationalSignalsForTelegramMultiMessage,
  type TrainingPeaksOperationalSignalDisplayEvidence,
} from "@/features/trainingpeaks/service";
import type { TrainingPeaksStudentOperationalSignal } from "@/features/trainingpeaks/repository";

const LOG_PREFIX = "[check-tp-signals-actionable-health-flow]";
const TELEGRAM_SAFE_LIMIT = 3500;

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function makeSignal(input: {
  signalId: string;
  studentId: string;
  signalType: string;
  structuredPayload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  lifecycleState?: TrainingPeaksStudentOperationalSignal["lifecycleState"];
  requiresCoachClose?: boolean;
  validFrom?: string | null;
  validUntil?: string | null;
  createdAt?: string;
}): TrainingPeaksStudentOperationalSignal {
  return {
    id: input.signalId,
    studentId: input.studentId,
    signalType: input.signalType as TrainingPeaksStudentOperationalSignal["signalType"],
    status: "active",
    lifecycleState: input.lifecycleState ?? null,
    lifecycleStateUpdatedAt: null,
    lifecycleAppliedAt: null,
    lifecycleMeta: {},
    resolvedAt: null,
    resolvedReason: null,
    requiresCoachClose: input.requiresCoachClose ?? false,
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
    dedupeKey: `fixture:${input.signalId}`,
    consumedAt: null,
    metadata: input.metadata ?? {},
    createdAt: input.createdAt ?? "2026-06-05T08:00:00.000Z",
    updatedAt: input.createdAt ?? "2026-06-05T08:00:00.000Z",
  };
}

function run(): void {
  const longRestriction =
    "на следующей неделе: во вторник вечер занят, не смогу тренироваться. " +
    "в четверг вечером уезжаю, но утром успею коротенькую тренировку. " +
    "в субботу возвращаюсь поздно, воскресенье лучше оставить как запасной день.";
  const veryLongPainContext = Array.from({ length: 600 }, (_, index) => `деталь-${index + 1}`).join(" ");
  const signals = [
    makeSignal({
      signalId: "anna-schedule",
      studentId: "anna",
      signalType: "schedule_availability_window",
      validFrom: "2026-06-08",
      validUntil: "2026-06-14",
      structuredPayload: {
        display_summary: longRestriction,
        valid_from: "2026-06-08",
        valid_until: "2026-06-14",
      },
    }),
    makeSignal({
      signalId: "alex-pain",
      studentId: "alex",
      signalType: "health_issue_started",
      structuredPayload: {
        signal_type: "pain_injury",
        activity_domain: "injury",
        display_summary: "лёгкий дискомфорт стопы, не похоже на острую травму",
      },
    }),
    makeSignal({
      signalId: "stepan-close",
      studentId: "stepan",
      signalType: "health_issue_started",
      lifecycleState: "monitoring_after_return",
      requiresCoachClose: true,
      structuredPayload: {
        signal_type: "pain_injury",
        activity_domain: "injury",
        display_summary: "боль / надкостница",
      },
    }),
    makeSignal({
      signalId: "anna-health",
      studentId: "anna-health",
      signalType: "health_issue_started",
      structuredPayload: {
        display_summary: "самочувствие улучшается",
      },
    }),
    makeSignal({
      signalId: "long-card",
      studentId: "long-card",
      signalType: "health_issue_started",
      structuredPayload: {
        signal_type: "pain_injury",
        activity_domain: "injury",
        display_summary: `боль / стоп ${veryLongPainContext}`,
      },
    }),
  ];

  const evidence = new Map<string, TrainingPeaksOperationalSignalDisplayEvidence>([
    [
      "alex-pain",
      {
        source: {
          observedAt: "2026-06-08T07:30:00.000Z",
          textPreview:
            "Все хорошо, немного стабилизаторы стопы побаливают при движении, но боль рабочая мышечная",
        },
      },
    ],
    [
      "stepan-close",
      {
        source: {
          observedAt: "2026-06-02T07:30:00.000Z",
          textPreview:
            "Чао) че то короче не пошло сегодня, икры или надкостница опять болит на тренировке",
        },
      },
    ],
    [
      "anna-health",
      {
        source: {
          observedAt: "2026-06-05T08:00:00.000Z",
          textPreview: "самочувствие улучшается",
        },
        completion: {
          latestCacheScannedAt: "2026-06-08T10:00:00.000Z",
          latestCompletionAfterOpen: {
            workoutId: "tp-1",
            workoutDate: "2026-06-07",
            title: "Easy Run",
            sportOrTypeCode: "run",
            sportClass: "running_like",
            runningCompletionClass: "normal_planned_run",
            classificationConfidence: "high",
            classificationReasonCodes: ["fixture"],
            classificationInspectedFields: {},
            plannedVsCompletedDelta: "normal",
            evidenceFreshness: "ok",
            completionObservedAt: "2026-06-07T09:00:00.000Z",
          },
          recommendedAction: "apply_monitoring_after_return",
          recommendationReason: "fixture",
          applyDryRunCommand: "npm run apply-operational-signal-lifecycle -- --signal-id anna-health --as-of 2026-06-08",
          cleanRunningCompletionCount: 1,
        },
      },
    ],
  ]);

  const snapshot = buildTrainingPeaksOperationalSignalsSnapshotFromSignals({
    signals,
    studentNameById: new Map([
      ["anna", "Anna Denisova"],
      ["alex", "Alexander Lavrentyev"],
      ["stepan", "Stepan Trofimov"],
      ["anna-health", "Anna Lobodina"],
      ["long-card", "Very Long Athlete"],
    ]),
    asOfDate: "2026-06-08",
    scope: "all",
    limit: 100,
    activeMoveActions: [],
    displayEvidenceBySignalId: evidence,
  });

  const text = formatTrainingPeaksOperationalSignalsForTelegram(snapshot);
  assert(!text.includes("ещё сигналов"), "must not hide rows behind +N more");
  assert(
    text.includes("вт вечер занята") && text.includes("короткая тренировка"),
    "schedule restriction must be summarized into compact coach text"
  );
  assert(!text.includes("…"), "fixture output must not contain synthetic ellipsis");
  assert(!text.includes("источник:"), "compact output must not show diagnostic source line");
  assert(
    /лёгкий дискомфорт стопы/iu.test(text) && text.includes("наблюдать"),
    "Lavrentyev should be mild discomfort in compact form"
  );
  assert(
    text.includes("закрыть после короткой проверки") || text.includes("закрыть, если уже не актуально"),
    "close candidate should have simple close guidance"
  );
  assert(!text.includes("подтверждение:"), "compact output must not show TP completion diagnostic label");
  assert(!text.includes("почему видно:"), "compact output must not show why-visible diagnostic label");
  assert(!text.includes("что закрывает:"), "compact output must not show what-closes diagnostic label");
  assert(!text.includes("статус: актуально / требует проверки"), "health rows must not show generic actionable status");
  assert(!text.includes("lifecycle:"), "coach text must not leak lifecycle label");
  assert(!text.includes("active_problem"), "coach text must not leak internal lifecycle state");
  assert(!text.includes("monitoring_after_return"), "coach text must not leak monitoring state name");
  assert(!text.includes("guarded close"), "coach text must not leak guarded close wording");
  assert(!text.includes("close candidate"), "coach text must not leak close-candidate wording");

  const messages = formatTrainingPeaksOperationalSignalsForTelegramMultiMessage(snapshot);
  assert(messages.every((message) => message.length <= TELEGRAM_SAFE_LIMIT), "all chunks must stay under safe limit");
  assert(messages.join("\n").includes("• продолжение"), "oversized card must split with continuation marker");

  const painSection = text.split("🦵 Травмы / боль / дискомфорт")[1]?.split("📅 Учесть в плане")[0] ?? "";
  assert(/\n\n• /u.test(painSection), "athlete cards in pain section must be separated by a blank line");

  const semanticsSnapshot = buildTrainingPeaksOperationalSignalsSnapshotFromSignals({
    signals: [
      makeSignal({
        signalId: "nadya-thigh-pain",
        studentId: "nadya",
        signalType: "health_issue_started",
        structuredPayload: {
          display_summary: "плохое самочувствие",
        },
      }),
      makeSignal({
        signalId: "anna-travel",
        studentId: "anna-travel",
        signalType: "pause_training",
        validFrom: "2026-06-08",
        validUntil: "2026-06-09",
        structuredPayload: {
          display_summary: "pause_training",
        },
      }),
      makeSignal({
        signalId: "anastasia-nutrition",
        studentId: "anastasia",
        signalType: "schedule_availability_window",
        validFrom: "2026-06-08",
        validUntil: "2026-06-14",
        structuredPayload: {
          display_summary:
            "игорь. я пока не считаю. в поездке сложно контролировать еду. что успела схватить, то и хорошо) может завтра попробую з…",
          valid_from: "2026-06-08",
          valid_until: "2026-06-14",
        },
      }),
      makeSignal({
        signalId: "elena-recovery",
        studentId: "elena",
        signalType: "health_issue_improving",
        structuredPayload: {
          display_summary: "самочувствие улучшается; планирует отлежаться пару дней",
        },
      }),
    ],
    studentNameById: new Map([
      ["nadya", "Nadya Hoffman"],
      ["anna-travel", "Anna Plotnitskaya"],
      ["anastasia", "Anastasia Utenkova"],
      ["elena", "Elena Vasileva"],
    ]),
    asOfDate: "2026-06-08",
    scope: "all",
    limit: 100,
    activeMoveActions: [],
    displayEvidenceBySignalId: new Map([
      [
        "nadya-thigh-pain",
        {
          source: {
            observedAt: "2026-06-08T15:07:15.262664+00:00",
            textPreview: "болит передняя часть бедра, особенно при беге",
          },
        },
      ],
      [
        "anna-travel",
        {
          source: {
            observedAt: "2026-06-08T15:00:33.389+00:00",
            textPreview: "Тренер, в пятницу-субботу не смогу бегать, буду в дороге",
          },
        },
      ],
      [
        "elena-recovery",
        {
          source: {
            observedAt: "2026-06-08T14:26:12.157+00:00",
            textPreview: "Привет!я сходила к врачу,врач разрешила,завтра выйду,побегаю тихонечко?)",
          },
        },
      ],
    ]),
  });
  const semanticsText = formatTrainingPeaksOperationalSignalsForTelegram(semanticsSnapshot);
  const illnessSection =
    semanticsText.split("🟡 Болезнь / самочувствие")[1]?.split("🦵 Травмы / боль / дискомфорт")[0] ?? "";
  const painSectionSemantics =
    semanticsText.split("🦵 Травмы / боль / дискомфорт")[1]?.split("📅 Учесть в плане")[0] ?? "";
  assert(
    semanticsText.includes("🦵 Травмы / боль / дискомфорт") && painSectionSemantics.includes("Nadya Hoffman"),
    "front-thigh pain must route to pain/injury section"
  );
  assert(!illnessSection.includes("Nadya Hoffman"), "front-thigh pain must not stay in illness section");
  assert(
    semanticsText.includes("Anna Plotnitskaya") &&
      semanticsText.includes("📅 Учесть в плане") &&
      semanticsText.includes("в дороге"),
    "travel-only unavailability must appear in plan constraints as compact travel summary"
  );
  assert(!illnessSection.includes("Anna Plotnitskaya"), "travel-only unavailability must not appear in illness section");
  assert(!semanticsText.includes("Anastasia Utenkova"), "nutrition-only schedule text must be hidden from /tp_signals");
  assert(
    semanticsText.includes("Elena Vasileva") &&
      (semanticsText.includes("уточнить перед первой пробежкой") ||
        semanticsText.includes("проверить отчёт/самочувствие")),
    "recovery-ready athlete should show compact return-to-run guidance"
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
