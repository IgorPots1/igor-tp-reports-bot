import {
  classifyNonRunConstraintCleanupEligibility,
  classifyPhase3NonRunSuppressionClass,
  TP_SIGNALS_NONRUN_CONSTRAINT_CLEANUP_CONFIRM,
} from "@/features/trainingpeaks/tp-signals-nonrun-constraint-cleanup";
import type { TrainingPeaksStudentOperationalSignal } from "@/features/trainingpeaks/repository";

const LOG_PREFIX = "[check:tp-signals-nonrun-constraint-cleanup]";
const AS_OF = "2026-06-14";

let passed = 0;
let failed = 0;

function assert(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`OK ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function mkSignal(overrides: Partial<TrainingPeaksStudentOperationalSignal>): TrainingPeaksStudentOperationalSignal {
  return {
    id: overrides.id ?? "00000000-0000-4000-8000-000000000001",
    studentId: overrides.studentId ?? "student-1",
    signalType: overrides.signalType ?? "plan_generation_constraint",
    status: overrides.status ?? "active",
    lifecycleState: overrides.lifecycleState ?? null,
    lifecycleStateUpdatedAt: null,
    lifecycleAppliedAt: null,
    lifecycleMeta: {},
    resolvedAt: null,
    resolvedReason: null,
    requiresCoachClose: false,
    sourceType: "telegram_message",
    sourceObservationId: overrides.sourceObservationId ?? "obs-1",
    telegramChatId: null,
    telegramMessageId: null,
    telegramMessageThreadId: null,
    structuredPayload: overrides.structuredPayload ?? {},
    confidence: 0.8,
    validFrom: null,
    validUntil: "2026-06-14",
    sourceDate: null,
    targetDate: null,
    sourceDay: null,
    targetDay: null,
    linkedMemoryItemId: null,
    linkedCaseId: null,
    linkedActionId: null,
    dedupeKey: "dedupe",
    consumedAt: null,
    metadata: overrides.metadata ?? {},
    createdAt: "2026-06-13T08:00:00.000Z",
    updatedAt: "2026-06-13T08:00:00.000Z",
    ...overrides,
  };
}

function classify(
  signal: TrainingPeaksStudentOperationalSignal,
  sourceSnippet: string | null,
  studentName = "Fixture Student"
) {
  return classifyNonRunConstraintCleanupEligibility({
    signal,
    studentName,
    sourceSnippet,
    asOfDate: AS_OF,
  });
}

function run(): void {
  assert(
    "Katerina-like strength-only reshuffle → eligible dismiss",
    classify(
      mkSignal({ id: "29bcac43-f4b9-4f1a-a3c6-25fed850eae3" }),
      "привет !) а можно мне силовые на сегодня переставить, а то вот к бегу стабильно я привыкаю, а к силовым ещё нет",
      "Katerina Melnikova"
    ).eligibility === "eligible"
  );

  assert(
    "Sofia-like soft ordinary session question → eligible dismiss",
    classify(
      mkSignal({ id: "3af9a632-dd2b-4a3a-b527-33596edbe58b" }),
      "а можно сегодня обычную тренировку? восстановиться",
      "Sofia Vlasova"
    ).eligibility === "eligible"
  );

  assert(
    "grigori-like non-training car errand → eligible dismiss",
    classify(
      mkSignal({ id: "5fd87a12-e2e8-4622-a606-1df5ef24a54f" }),
      "но я только в понедельник поеду за новой машиной",
      "grigori bereznoi"
    ).eligibility === "eligible"
  );

  assert(
    "explicit run unavailability → not eligible",
    classify(
      mkSignal({ id: "11111111-1111-4111-8111-111111111111" }),
      "силовую можно перенести, бег сегодня не смогу"
    ).eligibility === "not_eligible"
  );

  assert(
    "explicit move workout → not eligible",
    classify(
      mkSignal({ id: "22222222-2222-4222-8222-222222222222" }),
      "можно перенести беговую тренировку с сегодня на завтра?"
    ).eligibility === "not_eligible"
  );

  assert(
    "valid future availability payload → not_safe",
    classify(
      mkSignal({
        id: "33333333-3333-4333-8333-333333333333",
        structuredPayload: {
          unavailable_dates: ["2026-06-16"],
        },
      }),
      "а можно сегодня обычную тренировку? восстановиться"
    ).eligibility === "not_safe"
  );

  assert(
    "missing source text → not_safe",
    classify(mkSignal({ id: "44444444-4444-4444-8444-444444444444" }), null).eligibility === "not_safe"
  );

  assert(
    "non-active row → not eligible",
    classify(
      mkSignal({ id: "55555555-5555-4555-8555-555555555555", status: "dismissed" }),
      "а можно сегодня обычную тренировку? восстановиться"
    ).eligibility === "not_eligible"
  );

  assert(
    "apply requires exact confirm string",
    TP_SIGNALS_NONRUN_CONSTRAINT_CLEANUP_CONFIRM === "APPLY TP SIGNAL NONRUN CONSTRAINT CLEANUP"
  );

  assert(
    "phase3 classifier maps Katerina text to strength_only_reshuffle",
    classifyPhase3NonRunSuppressionClass(
      "можно мне силовые на сегодня переставить, а то к бегу привыкаю"
    ) === "strength_only_reshuffle"
  );

  assert(
    "phase3 classifier maps Sofia text to soft_session_question",
    classifyPhase3NonRunSuppressionClass("можно сегодня обычную тренировку? восстановиться") ===
      "soft_session_question"
  );

  assert(
    "phase3 classifier maps grigori text to non_training_errand",
    classifyPhase3NonRunSuppressionClass("только в понедельник поеду за новой машиной") ===
      "non_training_errand"
  );

  const eligibleCandidate = classify(
    mkSignal({ id: "66666666-6666-4666-8666-666666666666" }),
    "а можно сегодня обычную тренировку? восстановиться"
  );
  assert(
    "eligible candidate proposes dismiss with active-status guard intent",
    eligibleCandidate.proposed_action === "dismiss" &&
      eligibleCandidate.safety_guards_passed.includes("status_active")
  );

  console.log(`${LOG_PREFIX} pass=${passed} fail=${failed}`);
  if (failed > 0) {
    process.exit(1);
  }
}

run();
