import process from "node:process";

import {
  classifyCoachOperationalSignal,
  type ObservationLike,
  type OperationalPrimaryBucket,
  type OperationalSignalType,
} from "./lib/coach-operational-signals";

const LOG_PREFIX = "[check-coach-operational-signals]";

type Expectation = {
  primary_bucket: OperationalPrimaryBucket;
  signal_type: OperationalSignalType | null;
  should_create_memory: boolean;
  should_create_case: boolean;
  should_create_trainingpeaks_action: boolean;
  available_days?: string[];
  unavailable_days?: string[];
  health_issue_kind?: string | null;
  confidence_at_least?: "low" | "medium" | "high";
};

type CaseDef = {
  name: string;
  observation: ObservationLike;
  expected: Expectation;
};

const CONFIDENCE_ORDER: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

function mkObs(text: string, sourceType = "business_dm"): ObservationLike {
  return {
    sourceType,
    textPreview: text,
    labels: [],
    metadata: sourceType === "group_topic" || sourceType === "group_general" ? { senderRole: "known_student" } : {},
    observedAt: "2026-06-01T10:00:00.000Z",
    studentId: "test-student-id",
  };
}

function includesAll(left: string[], right: string[]): boolean {
  return right.every((item) => left.includes(item));
}

function assertCase(caseDef: CaseDef): string[] {
  const result = classifyCoachOperationalSignal(caseDef.observation);
  const failures: string[] = [];
  if (result.primary_bucket !== caseDef.expected.primary_bucket) {
    failures.push(`primary_bucket=${result.primary_bucket} expected=${caseDef.expected.primary_bucket}`);
  }
  if (result.signal_type !== caseDef.expected.signal_type) {
    failures.push(`signal_type=${result.signal_type ?? "null"} expected=${caseDef.expected.signal_type ?? "null"}`);
  }
  if (result.should_create_memory !== caseDef.expected.should_create_memory) {
    failures.push(
      `should_create_memory=${String(result.should_create_memory)} expected=${String(caseDef.expected.should_create_memory)}`
    );
  }
  if (result.should_create_case !== caseDef.expected.should_create_case) {
    failures.push(`should_create_case=${String(result.should_create_case)} expected=${String(caseDef.expected.should_create_case)}`);
  }
  if (result.should_create_trainingpeaks_action !== caseDef.expected.should_create_trainingpeaks_action) {
    failures.push(
      `should_create_trainingpeaks_action=${String(result.should_create_trainingpeaks_action)} expected=${String(caseDef.expected.should_create_trainingpeaks_action)}`
    );
  }
  if (caseDef.expected.available_days && !includesAll(result.structured_payload.available_days, caseDef.expected.available_days)) {
    failures.push(
      `available_days=${JSON.stringify(result.structured_payload.available_days)} expected_has=${JSON.stringify(caseDef.expected.available_days)}`
    );
  }
  if (
    caseDef.expected.unavailable_days &&
    !includesAll(result.structured_payload.unavailable_days, caseDef.expected.unavailable_days)
  ) {
    failures.push(
      `unavailable_days=${JSON.stringify(result.structured_payload.unavailable_days)} expected_has=${JSON.stringify(caseDef.expected.unavailable_days)}`
    );
  }
  if (caseDef.expected.health_issue_kind !== undefined && result.structured_payload.health_issue_kind !== caseDef.expected.health_issue_kind) {
    failures.push(
      `health_issue_kind=${result.structured_payload.health_issue_kind ?? "null"} expected=${caseDef.expected.health_issue_kind ?? "null"}`
    );
  }
  if (
    caseDef.expected.confidence_at_least &&
    CONFIDENCE_ORDER[result.confidence] < CONFIDENCE_ORDER[caseDef.expected.confidence_at_least]
  ) {
    failures.push(`confidence=${result.confidence} expected_at_least=${caseDef.expected.confidence_at_least}`);
  }
  return failures;
}

async function run(): Promise<void> {
  const cases: CaseDef[] = [
    {
      name: "next-week-tue-thu-availability",
      observation: mkObs("На следующей неделе сможет бегать во вторник и четверг."),
      expected: {
        primary_bucket: "operational_signal",
        signal_type: "schedule_availability_window",
        should_create_memory: false,
        should_create_case: false,
        should_create_trainingpeaks_action: false,
        available_days: ["Tuesday", "Thursday"],
        confidence_at_least: "high",
      },
    },
    {
      name: "this-week-only-tuesday",
      observation: mkObs("На этой неделе может только во вторник."),
      expected: {
        primary_bucket: "operational_signal",
        signal_type: "schedule_availability_window",
        should_create_memory: false,
        should_create_case: false,
        should_create_trainingpeaks_action: false,
        available_days: ["Tuesday"],
      },
    },
    {
      name: "starts-tomorrow-resume",
      observation: mkObs("С завтрашнего дня начинаются тренировки."),
      expected: {
        primary_bucket: "operational_signal",
        signal_type: "resume_training",
        should_create_memory: false,
        should_create_case: false,
        should_create_trainingpeaks_action: false,
      },
    },
    {
      name: "was-sick-this-week",
      observation: mkObs("Болела на неделе."),
      expected: {
        primary_bucket: "temporary_memory",
        signal_type: "health_issue_started",
        should_create_memory: true,
        should_create_case: false,
        should_create_trainingpeaks_action: false,
      },
    },
    {
      name: "throat-resolved-ready-tomorrow",
      observation: mkObs("Горло прошло, завтра готова бегать."),
      expected: {
        primary_bucket: "operational_signal",
        signal_type: "resume_training",
        should_create_memory: false,
        should_create_case: false,
        should_create_trainingpeaks_action: false,
        health_issue_kind: "illness",
      },
    },
    {
      name: "knee-hurts-third-day",
      observation: mkObs("Колено болит третий день."),
      expected: {
        primary_bucket: "durable_memory",
        signal_type: "health_issue_started",
        should_create_memory: true,
        should_create_case: true,
        should_create_trainingpeaks_action: false,
        health_issue_kind: "musculoskeletal",
      },
    },
    {
      name: "knee-hurt-but-resolved",
      observation: mkObs("Колено болело, но прошло."),
      expected: {
        primary_bucket: "health_lifecycle_signal",
        signal_type: "health_issue_resolved",
        should_create_memory: false,
        should_create_case: false,
        should_create_trainingpeaks_action: false,
      },
    },
    {
      name: "move-workout-friday",
      observation: mkObs("Перенеси тренировку на пятницу."),
      expected: {
        primary_bucket: "coach_case",
        signal_type: "move_workout_candidate",
        should_create_memory: false,
        should_create_case: true,
        should_create_trainingpeaks_action: true,
      },
    },
    {
      name: "today-cannot-make-it",
      observation: mkObs("Сегодня не успеваю."),
      expected: {
        primary_bucket: "operational_signal",
        signal_type: "schedule_unavailability_window",
        should_create_memory: false,
        should_create_case: false,
        should_create_trainingpeaks_action: false,
      },
    },
    {
      name: "preparing-for-10k",
      observation: mkObs("Готовится к 10 км."),
      expected: {
        primary_bucket: "durable_memory",
        signal_type: null,
        should_create_memory: true,
        should_create_case: false,
        should_create_trainingpeaks_action: false,
      },
    },
    {
      name: "ran-race-at-dawn",
      observation: mkObs("Пробежала забег на рассвете."),
      expected: {
        primary_bucket: "skip",
        signal_type: null,
        should_create_memory: false,
        should_create_case: false,
        should_create_trainingpeaks_action: false,
      },
    },
    {
      name: "too-many-marathons-season",
      observation: mkObs("Слишком много марафонов в сезоне."),
      expected: {
        primary_bucket: "durable_memory",
        signal_type: "race_load_context",
        should_create_memory: true,
        should_create_case: false,
        should_create_trainingpeaks_action: false,
      },
    },
    {
      name: "cannot-tuesday-child",
      observation: mkObs("По вторникам не может из-за ребёнка."),
      expected: {
        primary_bucket: "durable_memory",
        signal_type: "plan_generation_constraint",
        should_create_memory: true,
        should_create_case: false,
        should_create_trainingpeaks_action: false,
        unavailable_days: ["Tuesday"],
      },
    },
  ];

  let failed = 0;
  for (const caseDef of cases) {
    const failures = assertCase(caseDef);
    if (failures.length > 0) {
      failed += 1;
      console.log(`${LOG_PREFIX} FAIL ${caseDef.name}: ${failures.join("; ")}`);
    } else {
      console.log(`${LOG_PREFIX} OK ${caseDef.name}`);
    }
  }

  if (failed > 0) {
    console.error(`${LOG_PREFIX} FAIL: ${failed} case(s) failed`);
    process.exit(1);
  }
  console.log(`${LOG_PREFIX} OK all deterministic checks passed`);
}

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.startsWith(`${LOG_PREFIX} FAIL:`) ? message : `${LOG_PREFIX} FAIL: ${message}`);
  process.exit(1);
});
