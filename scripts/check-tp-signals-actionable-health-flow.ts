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
  assert(text.includes(longRestriction), "schedule restriction must preserve full source context");
  assert(!text.includes("…"), "fixture output must not contain synthetic ellipsis");
  assert(
    text.includes("источник: 08.06, Все хорошо, немного стабилизаторы стопы побаливают при движении, но боль рабочая мышечная"),
    "pain row must include full source context"
  );
  assert(text.includes("статус: лёгкий дискомфорт / наблюдать"), "Lavrentyev should be mild discomfort.");
  assert(text.includes("статус: можно закрыть после проверки"), "close candidate should have Russian close status.");
  assert(
    text.includes("что сделать: уточнить, болит ли сейчас. Если уже не актуально — закрыть сигнал через безопасное закрытие."),
    "close candidate should have simple close guidance"
  );
  assert(
    text.includes("подтверждение: после сигнала есть завершённая беговая тренировка (07.06)"),
    "health row must show Russian TP completion evidence"
  );
  assert(text.includes("статус: наблюдать после возврата"), "health row should have Russian lifecycle status");
  assert(!text.includes("lifecycle:"), "coach text must not leak lifecycle label");
  assert(!text.includes("active_problem"), "coach text must not leak internal lifecycle state");
  assert(!text.includes("monitoring_after_return"), "coach text must not leak monitoring state name");
  assert(!text.includes("guarded close"), "coach text must not leak guarded close wording");
  assert(!text.includes("close candidate"), "coach text must not leak close-candidate wording");

  const messages = formatTrainingPeaksOperationalSignalsForTelegramMultiMessage(snapshot);
  assert(messages.every((message) => message.length <= TELEGRAM_SAFE_LIMIT), "all chunks must stay under safe limit");
  assert(messages.join("\n").includes("• продолжение"), "oversized card must split with continuation marker");

  console.log(`${LOG_PREFIX} PASS`);
}

try {
  run();
} catch (error) {
  console.error(`${LOG_PREFIX} FAIL`);
  console.error((error as Error).message);
  process.exit(1);
}
