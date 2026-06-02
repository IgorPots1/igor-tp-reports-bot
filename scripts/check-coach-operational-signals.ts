import process from "node:process";

import {
  classifyCoachOperationalSignal,
  classifyCoachOperationalSignals,
  type ObservationLike,
  type OperationalPrimaryBucket,
  type OperationalSignalType,
} from "./lib/coach-operational-signals";
import {
  matchesOperationalSignalFollowUpFilter,
  normalizeOperationalSignalFollowUp,
} from "./lib/coach-operational-follow-up";

const LOG_PREFIX = "[check-coach-operational-signals]";

type Expectation = {
  primary_bucket: OperationalPrimaryBucket;
  signal_type: OperationalSignalType | null;
  should_create_memory: boolean;
  should_create_case: boolean;
  should_create_trainingpeaks_action: boolean;
  available_days?: string[];
  unavailable_days?: string[];
  resolved_available_dates?: string[];
  valid_from?: string | null;
  valid_until?: string | null;
  duration_days?: number | null;
  health_issue_kind?: string | null;
  reason?: string;
  secondary_buckets_includes?: OperationalPrimaryBucket[];
  confidence_at_least?: "low" | "medium" | "high";
};

type CaseDef = {
  name: string;
  observation: ObservationLike;
  expected: Expectation;
};

type MultiExpectation = {
  signal_types: OperationalSignalType[];
  same_episode_expected?: boolean;
  episode_type?: string;
  role_by_signal?: Partial<Record<OperationalSignalType, string>>;
  health_follow_up_expected_for?: OperationalSignalType[];
  no_follow_up_for?: OperationalSignalType[];
};

type MultiCaseDef = {
  name: string;
  observation: ObservationLike;
  expected: MultiExpectation;
};

type FollowUpCaseDef = {
  name: string;
  metadata: Record<string, unknown>;
  asOfDate: string;
  expectedState: "none" | "pending_future" | "pending_due" | "pending_overdue" | "resolved_or_non_pending";
  include: {
    pending: boolean;
    due: boolean;
    overdue: boolean;
    all: boolean;
  };
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
  if (
    caseDef.expected.resolved_available_dates &&
    !includesAll(result.structured_payload.resolved_available_dates, caseDef.expected.resolved_available_dates)
  ) {
    failures.push(
      `resolved_available_dates=${JSON.stringify(result.structured_payload.resolved_available_dates)} expected_has=${JSON.stringify(caseDef.expected.resolved_available_dates)}`
    );
  }
  if (caseDef.expected.valid_from !== undefined && result.structured_payload.valid_from !== caseDef.expected.valid_from) {
    failures.push(`valid_from=${result.structured_payload.valid_from ?? "null"} expected=${caseDef.expected.valid_from ?? "null"}`);
  }
  if (caseDef.expected.valid_until !== undefined && result.structured_payload.valid_until !== caseDef.expected.valid_until) {
    failures.push(`valid_until=${result.structured_payload.valid_until ?? "null"} expected=${caseDef.expected.valid_until ?? "null"}`);
  }
  if (caseDef.expected.duration_days !== undefined && result.structured_payload.duration_days !== caseDef.expected.duration_days) {
    failures.push(
      `duration_days=${String(result.structured_payload.duration_days)} expected=${String(caseDef.expected.duration_days)}`
    );
  }
  if (caseDef.expected.health_issue_kind !== undefined && result.structured_payload.health_issue_kind !== caseDef.expected.health_issue_kind) {
    failures.push(
      `health_issue_kind=${result.structured_payload.health_issue_kind ?? "null"} expected=${caseDef.expected.health_issue_kind ?? "null"}`
    );
  }
  if (caseDef.expected.reason !== undefined && result.reason !== caseDef.expected.reason) {
    failures.push(`reason=${result.reason} expected=${caseDef.expected.reason}`);
  }
  if (caseDef.expected.secondary_buckets_includes && !includesAll(result.secondary_buckets, caseDef.expected.secondary_buckets_includes)) {
    failures.push(
      `secondary_buckets=${JSON.stringify(result.secondary_buckets)} expected_has=${JSON.stringify(caseDef.expected.secondary_buckets_includes)}`
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

function assertMultiCase(caseDef: MultiCaseDef): string[] {
  const result = classifyCoachOperationalSignals(caseDef.observation);
  const failures: string[] = [];
  const resultTypes = result.map((item) => item.signal_type);
  for (const expectedType of caseDef.expected.signal_types) {
    if (!resultTypes.includes(expectedType)) {
      failures.push(`missing signal_type=${expectedType}; got=${JSON.stringify(resultTypes)}`);
    }
  }
  if (caseDef.expected.signal_types.length !== result.length) {
    failures.push(`signal_count=${result.length} expected=${caseDef.expected.signal_types.length}`);
  }
  return failures;
}

function assertFollowUpCase(caseDef: FollowUpCaseDef): string[] {
  const normalized = normalizeOperationalSignalFollowUp(caseDef.metadata, {
    asOfDate: caseDef.asOfDate,
  });
  const failures: string[] = [];
  if (normalized.state !== caseDef.expectedState) {
    failures.push(`state=${normalized.state} expected=${caseDef.expectedState}`);
  }
  const pending = matchesOperationalSignalFollowUpFilter(normalized, "pending");
  if (pending !== caseDef.include.pending) {
    failures.push(`pending=${String(pending)} expected=${String(caseDef.include.pending)}`);
  }
  const due = matchesOperationalSignalFollowUpFilter(normalized, "due");
  if (due !== caseDef.include.due) {
    failures.push(`due=${String(due)} expected=${String(caseDef.include.due)}`);
  }
  const overdue = matchesOperationalSignalFollowUpFilter(normalized, "overdue");
  if (overdue !== caseDef.include.overdue) {
    failures.push(`overdue=${String(overdue)} expected=${String(caseDef.include.overdue)}`);
  }
  const all = matchesOperationalSignalFollowUpFilter(normalized, "all");
  if (all !== caseDef.include.all) {
    failures.push(`all=${String(all)} expected=${String(caseDef.include.all)}`);
  }
  return failures;
}

async function run(): Promise<void> {
  const episodeCases: MultiCaseDef[] = [
    {
      name: "episode-health-related-move-adjustment",
      observation: mkObs("переставить интервалы пока на среду, заболевать начала, горло болит, колбасить начинает"),
      expected: {
        signal_types: ["move_workout_candidate", "health_issue_started"],
      },
    },
    {
      name: "episode-illness-pause",
      observation: mkObs("сегодня-завтра воздержусь от бега, кашель, голос осип"),
      expected: {
        signal_types: ["pause_training", "health_issue_started"],
      },
    },
    {
      name: "episode-pure-move-stays-simple",
      observation: mkObs("А можно пятничную тренировку в чт сделать? У меня она не переносится"),
      expected: {
        signal_types: ["move_workout_candidate"],
      },
    },
    {
      name: "episode-schedule-stays-schedule-no-health-fp",
      observation: mkObs("на этой неделе смогу во вторник и четверг"),
      expected: {
        signal_types: ["plan_generation_constraint"],
      },
    },
  ];
  const cases: CaseDef[] = [
    {
      name: "current-week-multi-day-availability",
      observation: mkObs("Можно на этой неделе тренировки вторник, среда, пятница и воскресенье?"),
      expected: {
        primary_bucket: "operational_signal",
        signal_type: "plan_generation_constraint",
        should_create_memory: false,
        should_create_case: false,
        should_create_trainingpeaks_action: false,
        available_days: ["Tuesday", "Wednesday", "Friday", "Sunday"],
        confidence_at_least: "medium",
      },
    },
    {
      name: "next-week-tue-thu-availability",
      observation: mkObs("На следующей неделе смогу бегать во вторник и четверг."),
      expected: {
        primary_bucket: "operational_signal",
        signal_type: "schedule_availability_window",
        should_create_memory: false,
        should_create_case: false,
        should_create_trainingpeaks_action: false,
        available_days: ["Tuesday", "Thursday"],
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
      name: "knee-hurts-third-day",
      observation: mkObs("Колено болит третий день."),
      expected: {
        primary_bucket: "durable_memory",
        signal_type: "health_issue_started",
        should_create_memory: true,
        should_create_case: true,
        should_create_trainingpeaks_action: false,
        health_issue_kind: "pain_or_injury",
      },
    },
    {
      name: "no-pain-today",
      observation: mkObs("Я сегодня вообще без боли побегал."),
      expected: {
        primary_bucket: "health_lifecycle_signal",
        signal_type: "health_issue_resolved",
        should_create_memory: false,
        should_create_case: false,
        should_create_trainingpeaks_action: false,
      },
    },
    {
      name: "leg-significantly-better",
      observation: mkObs("Ну я тебе скажу что у меня сегодня нога уже значительно лучше"),
      expected: {
        primary_bucket: "health_lifecycle_signal",
        signal_type: "health_issue_improving",
        should_create_memory: false,
        should_create_case: false,
        should_create_trainingpeaks_action: false,
        health_issue_kind: "pain_or_injury",
      },
    },
    {
      name: "move-workout-friday-to-thursday",
      observation: mkObs("А можно пятничную тренировку в чт сделать? У меня она не переносится("),
      expected: {
        primary_bucket: "coach_case",
        signal_type: "move_workout_candidate",
        should_create_memory: false,
        should_create_case: true,
        should_create_trainingpeaks_action: true,
        secondary_buckets_includes: ["trainingpeaks_action"],
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
      name: "zabolela-noga-is-not-illness",
      observation: mkObs("Важный момент: день когда заболела нога это была первая тренировка в новых кроссовках"),
      expected: {
        primary_bucket: "temporary_memory",
        signal_type: "health_issue_started",
        should_create_memory: true,
        should_create_case: false,
        should_create_trainingpeaks_action: false,
        health_issue_kind: "pain_or_injury",
      },
    },
    {
      name: "group-missing-senderrole-explicit-schedule-accepted",
      observation: {
        ...mkObs("Можно на этой неделе тренировки вт, ср, пт и вс?", "group_topic"),
        metadata: {},
      },
      expected: {
        primary_bucket: "operational_signal",
        signal_type: "plan_generation_constraint",
        should_create_memory: false,
        should_create_case: false,
        should_create_trainingpeaks_action: false,
        available_days: ["Tuesday", "Wednesday", "Friday", "Sunday"],
      },
    },
    {
      name: "group-missing-senderrole-ambiguous-skipped",
      observation: {
        ...mkObs("Спасибо! Все ок", "group_topic"),
        metadata: {},
      },
      expected: {
        primary_bucket: "skip",
        signal_type: null,
        should_create_memory: false,
        should_create_case: false,
        should_create_trainingpeaks_action: false,
      },
    },
    {
      name: "group-explicit-non-student-skipped",
      observation: {
        ...mkObs("Можно на этой неделе только во вторник", "group_topic"),
        metadata: { senderRole: "coach" },
      },
      expected: {
        primary_bucket: "skip",
        signal_type: null,
        should_create_memory: false,
        should_create_case: false,
        should_create_trainingpeaks_action: false,
        reason: "group message explicitly non-student-authored",
      },
    },
    {
      name: "pause-training-illness-window",
      observation: mkObs(
        "Здравствуйте. Я наверное сегодня, завтра воздержусь от бега. Кашель какой-то непонятный появился и голос осип"
      ),
      expected: {
        primary_bucket: "operational_signal",
        signal_type: "pause_training",
        should_create_memory: false,
        should_create_case: false,
        should_create_trainingpeaks_action: false,
        health_issue_kind: "illness",
        secondary_buckets_includes: ["health_lifecycle_signal"],
        confidence_at_least: "medium",
      },
    },
    {
      name: "this-week-availability-with-days",
      observation: {
        ...mkObs(
          "Добрый день, сорри, я пропадаю переодически. Я на прошлой неделе не бегала, на этой смогу во вторник и в четверг."
        ),
        observedAt: "2026-05-31T12:00:00.000Z",
      },
      expected: {
        primary_bucket: "operational_signal",
        signal_type: "plan_generation_constraint",
        should_create_memory: false,
        should_create_case: false,
        should_create_trainingpeaks_action: false,
        available_days: ["Tuesday", "Thursday"],
        resolved_available_dates: ["2026-06-02", "2026-06-04"],
        valid_from: "2026-06-01",
        valid_until: "2026-06-07",
        confidence_at_least: "medium",
      },
    },
    {
      name: "bare-weekdays-still-skip",
      observation: mkObs("Вторник и четверг"),
      expected: {
        primary_bucket: "skip",
        signal_type: null,
        should_create_memory: false,
        should_create_case: false,
        should_create_trainingpeaks_action: false,
      },
    },
    {
      name: "travel-unavailability-duration",
      observation: mkObs("Потом на 4 дня на винный фестиваль улетаю, точно бегать не смогу."),
      expected: {
        primary_bucket: "operational_signal",
        signal_type: "schedule_unavailability_window",
        should_create_memory: false,
        should_create_case: false,
        should_create_trainingpeaks_action: false,
        duration_days: 4,
        confidence_at_least: "medium",
      },
    },
    {
      name: "put-on-tomorrow-move-candidate",
      observation: mkObs("Игорь привет Поставь пожалуйста на завтра 1.20 сегодня не получается с мелким некого оставить"),
      expected: {
        primary_bucket: "coach_case",
        signal_type: "move_workout_candidate",
        should_create_memory: false,
        should_create_case: true,
        should_create_trainingpeaks_action: true,
        secondary_buckets_includes: ["operational_signal", "trainingpeaks_action"],
        confidence_at_least: "medium",
      },
    },
    {
      name: "non-health-better-with-week-days-is-schedule",
      observation: mkObs("Привет. Отбегала. Что-то было непросто. На след неделе лучше вт-чт-пт-вс?"),
      expected: {
        primary_bucket: "operational_signal",
        signal_type: "schedule_availability_window",
        should_create_memory: false,
        should_create_case: false,
        should_create_trainingpeaks_action: false,
        available_days: ["Tuesday", "Thursday", "Friday", "Sunday"],
      },
    },
  ];
  const followUpCases: FollowUpCaseDef[] = [
    {
      name: "follow-up-case-a-pending-future",
      asOfDate: "2026-06-03",
      metadata: {
        follow_up_status: "pending",
        follow_up_due_at: "2026-06-04T12:00:00.000+02:00",
        follow_up_kind: "health_check",
        follow_up_reason: "illness check next day",
      },
      expectedState: "pending_future",
      include: {
        pending: true,
        due: false,
        overdue: false,
        all: true,
      },
    },
    {
      name: "follow-up-case-b-due-today",
      asOfDate: "2026-06-03",
      metadata: {
        follow_up_status: "pending",
        follow_up_due_at: "2026-06-03T10:15:00.000+02:00",
      },
      expectedState: "pending_due",
      include: {
        pending: true,
        due: true,
        overdue: false,
        all: true,
      },
    },
    {
      name: "follow-up-case-c-overdue",
      asOfDate: "2026-06-03",
      metadata: {
        follow_up_status: "pending",
        follow_up_due_at: "2026-06-02T20:00:00.000+02:00",
      },
      expectedState: "pending_overdue",
      include: {
        pending: true,
        due: true,
        overdue: true,
        all: true,
      },
    },
    {
      name: "follow-up-case-d-non-pending",
      asOfDate: "2026-06-03",
      metadata: {
        follow_up_status: "resolved",
        follow_up_due_at: "2026-06-01T12:00:00.000+02:00",
      },
      expectedState: "resolved_or_non_pending",
      include: {
        pending: false,
        due: false,
        overdue: false,
        all: true,
      },
    },
    {
      name: "follow-up-case-e-none",
      asOfDate: "2026-06-03",
      metadata: {},
      expectedState: "none",
      include: {
        pending: false,
        due: false,
        overdue: false,
        all: false,
      },
    },
  ];

  let failed = 0;
  for (const caseDef of episodeCases) {
    const failures = assertMultiCase(caseDef);
    if (failures.length > 0) {
      failed += 1;
      console.log(`${LOG_PREFIX} FAIL ${caseDef.name}: ${failures.join("; ")}`);
    } else {
      console.log(`${LOG_PREFIX} OK ${caseDef.name}`);
    }
  }
  for (const caseDef of cases) {
    const failures = assertCase(caseDef);
    if (failures.length > 0) {
      failed += 1;
      console.log(`${LOG_PREFIX} FAIL ${caseDef.name}: ${failures.join("; ")}`);
    } else {
      console.log(`${LOG_PREFIX} OK ${caseDef.name}`);
    }
  }
  for (const caseDef of followUpCases) {
    const failures = assertFollowUpCase(caseDef);
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
