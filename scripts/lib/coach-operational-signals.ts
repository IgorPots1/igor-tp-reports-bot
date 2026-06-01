export type OperationalPrimaryBucket =
  | "durable_memory"
  | "temporary_memory"
  | "operational_signal"
  | "coach_case"
  | "trainingpeaks_action"
  | "health_lifecycle_signal"
  | "skip";

export type OperationalSignalType =
  | "schedule_availability_window"
  | "schedule_unavailability_window"
  | "resume_training"
  | "pause_training"
  | "health_issue_started"
  | "health_issue_improving"
  | "health_issue_resolved"
  | "move_workout_candidate"
  | "plan_generation_constraint"
  | "race_load_context";

export type OperationalConfidence = "low" | "medium" | "high";

export type OperationalStructuredPayload = {
  available_days: string[];
  unavailable_days: string[];
  valid_from: string | null;
  valid_until: string | null;
  resume_from_date: string | null;
  health_issue_kind: string | null;
  target_date: string | null;
  source_date: string | null;
};

export type ObservationLike = {
  sourceType: "business_dm" | "group_topic" | "group_general" | "private_dm" | string | null;
  textPreview: string | null;
  labels: string[];
  metadata: Record<string, unknown>;
  observedAt: string;
  studentId: string | null;
};

export type OperationalClassification = {
  primary_bucket: OperationalPrimaryBucket;
  secondary_buckets: OperationalPrimaryBucket[];
  signal_type: OperationalSignalType | null;
  structured_payload: OperationalStructuredPayload;
  should_create_memory: boolean;
  should_create_case: boolean;
  should_create_trainingpeaks_action: boolean;
  confidence: OperationalConfidence;
  reason: string;
};

const DAY_ALIASES: Array<{ day: string; forms: string[] }> = [
  { day: "Monday", forms: ["понедельник", "понедельникам", "понедельникам", "пн"] },
  { day: "Tuesday", forms: ["вторник", "вторникам", "вторникам", "вт"] },
  { day: "Wednesday", forms: ["среда", "среду", "средам", "ср"] },
  { day: "Thursday", forms: ["четверг", "четвергам", "четвергам", "чт"] },
  { day: "Friday", forms: ["пятница", "пятницу", "пятницам", "пт"] },
  { day: "Saturday", forms: ["суббота", "субботу", "субботам", "сб"] },
  { day: "Sunday", forms: ["воскресенье", "воскресеньям", "вс"] },
];

const DAY_TO_INDEX: Record<string, number> = {
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
  Sunday: 0,
};

const NOISE_ONLY_PATTERN = /^(ок|окей|спасибо|thanks|понял[а]?|принято|👍|👌|🙏)$/iu;

function normalize(text: string | null): string {
  return (text ?? "").replace(/\s+/gu, " ").trim().toLowerCase();
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseIsoDateFallback(input: string): Date {
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    return new Date();
  }
  return parsed;
}

function addDays(input: Date, days: number): Date {
  const copy = new Date(input.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function endOfWeekSunday(input: Date): Date {
  const day = input.getUTCDay();
  return addDays(input, 7 - day);
}

function startOfWeekMonday(input: Date): Date {
  const day = input.getUTCDay();
  const delta = day === 0 ? -6 : 1 - day;
  return addDays(input, delta);
}

function endOfNextWeek(input: Date): string {
  return isoDate(endOfWeekSunday(addDays(input, 7)));
}

function hasAny(text: string, patterns: readonly string[]): boolean {
  return patterns.some((item) => text.includes(item));
}

function hasToken(text: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = new RegExp(`(^|[^a-zа-яё0-9])${escaped}([^a-zа-яё0-9]|$)`, "iu");
  return pattern.test(text);
}

function extractDays(text: string): string[] {
  const output: string[] = [];
  for (const alias of DAY_ALIASES) {
    if (alias.forms.some((form) => hasToken(text, form))) {
      output.push(alias.day);
    }
  }
  return output;
}

function parseRelativeDate(text: string, observedAt: string): string | null {
  const observed = parseIsoDateFallback(observedAt);
  if (text.includes("завтра") || text.includes("с завтрашнего дня")) {
    return isoDate(addDays(observed, 1));
  }
  if (text.includes("сегодня")) {
    return isoDate(observed);
  }
  if (text.includes("послезавтра")) {
    return isoDate(addDays(observed, 2));
  }
  return null;
}

function parseNamedDayTargetDate(text: string, observedAt: string): string | null {
  const observed = parseIsoDateFallback(observedAt);
  for (let index = 0; index < DAY_ALIASES.length; index += 1) {
    const alias = DAY_ALIASES[index]!;
    const hasDirectionalForm = alias.forms.some((form) => text.includes(`на ${form}`));
    if (!hasDirectionalForm) {
      continue;
    }
    const today = observed.getUTCDay();
    const targetDow = index === 6 ? 0 : index + 1;
    let delta = (targetDow - today + 7) % 7;
    if (delta === 0) {
      delta = 7;
    }
    return isoDate(addDays(observed, delta));
  }
  return null;
}

function inferDateForDay(day: string, observedAt: string): string | null {
  const observed = parseIsoDateFallback(observedAt);
  const targetDow = DAY_TO_INDEX[day];
  if (targetDow === undefined) {
    return null;
  }
  const today = observed.getUTCDay();
  let delta = (targetDow - today + 7) % 7;
  if (delta === 0) {
    delta = 7;
  }
  return isoDate(addDays(observed, delta));
}

function toDefaultPayload(): OperationalStructuredPayload {
  return {
    available_days: [],
    unavailable_days: [],
    valid_from: null,
    valid_until: null,
    resume_from_date: null,
    health_issue_kind: null,
    target_date: null,
    source_date: null,
  };
}

function isExplicitCoachRelevantSignal(text: string, labels: string[]): boolean {
  if (labels.includes("move_workout_candidate") || labels.includes("pain_or_health")) {
    return true;
  }
  const cueWords = [
    "не могу",
    "не смогу",
    "перенеси",
    "перенести",
    "можно",
    "сделать",
    "на этой неделе",
    "на следующей неделе",
    "могу только",
    "готов",
    "готова",
    "болит",
    "болела",
    "болею",
    "лучше",
    "без боли",
    "прошло",
    "забол",
    "горло",
    "колено",
    "нога",
    "ахилл",
    "стоп",
    "марафон",
    "тренировки",
    "по вторникам",
  ];
  return hasAny(text, cueWords);
}

function classifyHealthIssueKind(text: string): string | null {
  if (hasAny(text, ["нога", "колено", "ахилл", "икра", "спина", "голень", "стоп"])) {
    return "pain_or_injury";
  }
  if (hasAny(text, ["горло", "температур", "простуд", "кашель", "боле"])) {
    return "illness";
  }
  if (text.includes("бол")) {
    return "pain_unspecified";
  }
  return null;
}

function parseMoveDays(text: string): { sourceDay: string | null; targetDay: string | null } {
  const source = text.match(/с\s+(пн|вт|ср|чт|пт|сб|вс|понедельник(?:а|у)?|вторник(?:а|у)?|сред[ауы]|четверг(?:а|у)?|пятниц[ауы]|суббот[ауы]|воскресенье)\s+на\s+(пн|вт|ср|чт|пт|сб|вс|понедельник(?:а|у)?|вторник(?:а|у)?|сред[ауы]|четверг(?:а|у)?|пятниц[ауы]|суббот[ауы]|воскресенье)/iu);
  if (source) {
    const parsed = extractDays(`${source[1]} ${source[2]}`);
    return {
      sourceDay: parsed[0] ?? null,
      targetDay: parsed[1] ?? null,
    };
  }
  const adjectiveToDay: Array<{ day: string; pattern: RegExp }> = [
    { day: "Monday", pattern: /понедельнич/iu },
    { day: "Tuesday", pattern: /вторнич/iu },
    { day: "Wednesday", pattern: /сред/iu },
    { day: "Thursday", pattern: /четвергов|четверг/iu },
    { day: "Friday", pattern: /пятнич/iu },
    { day: "Saturday", pattern: /суббот/iu },
    { day: "Sunday", pattern: /воскрес/iu },
  ];
  const phrased = text.match(
    /(понедельнич[^ ]*|вторнич[^ ]*|сред[^ ]*|четверг[^ ]*|пятнич[^ ]*|суббот[^ ]*|воскрес[^ ]*)\s+трениров[^ ]*.*?\sв\s+(пн|вт|ср|чт|пт|сб|вс|понедельник(?:а|у)?|вторник(?:а|у)?|сред[ауы]|четверг(?:а|у)?|пятниц[ауы]|суббот[ауы]|воскресенье)/iu
  );
  if (phrased) {
    const firstToken = phrased[1] ?? "";
    const sourceDay = adjectiveToDay.find((item) => item.pattern.test(firstToken))?.day ?? null;
    const targetDay = extractDays(phrased[2] ?? "")[0] ?? null;
    return { sourceDay, targetDay };
  }
  const generic = text.match(
    /перенеси.*?(пн|вт|ср|чт|пт|сб|вс|понедельник(?:а|у)?|вторник(?:а|у)?|сред[ауы]|четверг(?:а|у)?|пятниц[ауы]|суббот[ауы]|воскресенье).*?\bна\s+(пн|вт|ср|чт|пт|сб|вс|понедельник(?:а|у)?|вторник(?:а|у)?|сред[ауы]|четверг(?:а|у)?|пятниц[ауы]|суббот[ауы]|воскресенье)/iu
  );
  if (generic) {
    return {
      sourceDay: extractDays(generic[1] ?? "")[0] ?? null,
      targetDay: extractDays(generic[2] ?? "")[0] ?? null,
    };
  }
  return { sourceDay: null, targetDay: null };
}

function hasScheduleContext(text: string): boolean {
  return hasAny(text, [
    "тренировк",
    "бегать",
    "могу",
    "может",
    "можно",
    "на этой неделе",
    "на следующей неделе",
    "на след неделе",
    "следующей неделе",
  ]);
}

function hasMoveWorkoutIntent(text: string, labels: string[]): boolean {
  if (labels.includes("move_workout_candidate")) {
    return true;
  }
  if (hasAny(text, ["перенеси тренировку", "перенести тренировку", "перенеси", "перенести", "сдвинь тренировку"])) {
    return true;
  }
  if (/с\s+.*\s+на\s+/iu.test(text) && text.includes("трениров")) {
    return true;
  }
  if (
    /(понедельнич[^ ]*|вторнич[^ ]*|сред[^ ]*|четверг[^ ]*|пятнич[^ ]*|суббот[^ ]*|воскрес[^ ]*)\s+трениров[^ ]*.*\sв\s+(пн|вт|ср|чт|пт|сб|вс)/iu.test(
      text
    )
  ) {
    return true;
  }
  if (/можно.*тренировк\w*.*\bв\s+(пн|вт|ср|чт|пт|сб|вс)/iu.test(text) && text.includes("не перенос")) {
    return true;
  }
  return false;
}

export function classifyCoachOperationalSignal(input: ObservationLike): OperationalClassification {
  let groupMissingSenderRoleButAccepted = false;
  const text = normalize(input.textPreview);
  const labels = input.labels.map((label) => label.toLowerCase());
  const payload = toDefaultPayload();

  if (!text || NOISE_ONLY_PATTERN.test(text) || labels.includes("ack_or_noise")) {
    return {
      primary_bucket: "skip",
      secondary_buckets: [],
      signal_type: null,
      structured_payload: payload,
      should_create_memory: false,
      should_create_case: false,
      should_create_trainingpeaks_action: false,
      confidence: "high",
      reason: "ack/noise or empty observation",
    };
  }

  if (!input.studentId) {
    return {
      primary_bucket: "skip",
      secondary_buckets: [],
      signal_type: null,
      structured_payload: payload,
      should_create_memory: false,
      should_create_case: false,
      should_create_trainingpeaks_action: false,
      confidence: "high",
      reason: "missing student attribution",
    };
  }

  const source = (input.sourceType ?? "").toLowerCase();
  if (source === "group_topic" || source === "group_general") {
    const senderRole =
      typeof input.metadata.senderRole === "string" ? input.metadata.senderRole.toLowerCase() : "";
    const isExplicitNonStudent = ["coach", "admin", "bot"].some((role) => senderRole.includes(role));
    const isExplicitStudent = ["known_student", "linked_student", "student"].some((role) => senderRole.includes(role));
    if (isExplicitNonStudent) {
      return {
        primary_bucket: "skip",
        secondary_buckets: [],
        signal_type: null,
        structured_payload: payload,
        should_create_memory: false,
        should_create_case: false,
        should_create_trainingpeaks_action: false,
        confidence: "high",
        reason: "group message explicitly non-student-authored",
      };
    }
    if (!isExplicitStudent && senderRole) {
      return {
        primary_bucket: "skip",
        secondary_buckets: [],
        signal_type: null,
        structured_payload: payload,
        should_create_memory: false,
        should_create_case: false,
        should_create_trainingpeaks_action: false,
        confidence: "high",
        reason: "group message not student-authored",
      };
    }
    if (!isExplicitCoachRelevantSignal(text, labels)) {
      return {
        primary_bucket: "skip",
        secondary_buckets: [],
        signal_type: null,
        structured_payload: payload,
        should_create_memory: false,
        should_create_case: false,
        should_create_trainingpeaks_action: false,
        confidence: "medium",
        reason: "group message ambiguous for coach signal",
      };
    }
    if (!isExplicitStudent && !senderRole) {
      groupMissingSenderRoleButAccepted = true;
    }
  }
  const explicitSignalReason = groupMissingSenderRoleButAccepted
    ? "group message missing senderRole but explicit student signal accepted"
    : null;

  if (
    hasMoveWorkoutIntent(text, labels)
  ) {
    const { sourceDay, targetDay } = parseMoveDays(text);
    payload.target_date =
      (targetDay ? inferDateForDay(targetDay, input.observedAt) : null) ??
      parseRelativeDate(text, input.observedAt) ??
      parseNamedDayTargetDate(text, input.observedAt);
    payload.source_date = sourceDay
      ? inferDateForDay(sourceDay, input.observedAt)
      : text.includes("сегодня")
        ? parseRelativeDate("сегодня", input.observedAt)
        : null;
    return {
      primary_bucket: "coach_case",
      secondary_buckets: ["trainingpeaks_action", "operational_signal"],
      signal_type: "move_workout_candidate",
      structured_payload: payload,
      should_create_memory: false,
      should_create_case: true,
      should_create_trainingpeaks_action: true,
      confidence: sourceDay || targetDay ? "high" : "medium",
      reason: explicitSignalReason ?? "explicit move-workout request",
    };
  }

  const healthImproving = hasAny(text, ["значительно лучше", "намного лучше", "лучше", "становится лучше", "полегче"]);
  const healthResolved =
    hasAny(text, ["без боли", "не болит", "прошло", "прошел", "прошла", "выздоров"]) &&
    hasAny(text, ["бол", "горло", "колено", "нога", "ахилл", "стоп", "простуд", "кашель", "самочув"]);

  const resolvedHealth =
    (hasAny(text, ["прошло", "прошел", "прошла", "уже не болит", "не болит", "выздоров", "готова бегать", "готов бегать"]) &&
      hasAny(text, ["бол", "горло", "простуд", "трав"])) ||
    healthResolved;
  if (healthImproving || hasAny(text, ["самочувствие хорошо", "самочувствие норм", "самочувствие вроде хорошо"])) {
    payload.health_issue_kind = classifyHealthIssueKind(text);
    return {
      primary_bucket: "health_lifecycle_signal",
      secondary_buckets: [],
      signal_type: "health_issue_improving",
      structured_payload: payload,
      should_create_memory: false,
      should_create_case: false,
      should_create_trainingpeaks_action: false,
      confidence: "medium",
      reason: explicitSignalReason ?? "health improvement signal detected",
    };
  }
  if (resolvedHealth) {
    payload.resume_from_date = parseRelativeDate(text, input.observedAt);
    payload.health_issue_kind = classifyHealthIssueKind(text);
    const withResume = hasAny(text, ["готова бегать", "готов бегать", "начинаются тренировки", "возобновля"]);
    return {
      primary_bucket: withResume ? "operational_signal" : "health_lifecycle_signal",
      secondary_buckets: withResume ? ["health_lifecycle_signal"] : [],
      signal_type: withResume ? "resume_training" : "health_issue_resolved",
      structured_payload: payload,
      should_create_memory: false,
      should_create_case: false,
      should_create_trainingpeaks_action: false,
      confidence: "medium",
      reason: explicitSignalReason ?? "health resolution signal detected",
    };
  }

  const resumeTraining = hasAny(text, ["с завтрашнего дня начинаются тренировки", "начинаются тренировки", "возобновляю тренировки"]);
  if (resumeTraining) {
    payload.resume_from_date = parseRelativeDate(text, input.observedAt);
    return {
      primary_bucket: "operational_signal",
      secondary_buckets: [],
      signal_type: "resume_training",
      structured_payload: payload,
      should_create_memory: false,
      should_create_case: false,
      should_create_trainingpeaks_action: false,
      confidence: "high",
      reason: explicitSignalReason ?? "explicit resume training phrasing",
    };
  }

  const healthStarted =
    hasAny(text, ["болела", "болею", "забол", "температур", "горло", "простуд", "болит"]) &&
    !resolvedHealth;
  if (healthStarted) {
    payload.health_issue_kind = classifyHealthIssueKind(text);
    const hasPersistence = hasAny(text, ["третий день", "несколько дней", "постоянно", "после каждой тренировки"]);
    if (hasPersistence && payload.health_issue_kind === "pain_or_injury") {
      return {
        primary_bucket: "durable_memory",
        secondary_buckets: ["coach_case"],
        signal_type: "health_issue_started",
        structured_payload: payload,
        should_create_memory: true,
        should_create_case: true,
        should_create_trainingpeaks_action: false,
        confidence: "high",
        reason: "persistent musculoskeletal pain likely durable",
      };
    }
    return {
      primary_bucket: "temporary_memory",
      secondary_buckets: ["health_lifecycle_signal"],
      signal_type: "health_issue_started",
      structured_payload: payload,
      should_create_memory: true,
      should_create_case: false,
      should_create_trainingpeaks_action: false,
      confidence: "medium",
      reason: explicitSignalReason ?? "health issue present without durable persistence evidence",
    };
  }

  const days = extractDays(text);
  const scheduleAvailability = hasAny(text, [
    "может бегать",
    "сможет бегать",
    "могу только",
    "может только",
    "можно",
    "смогу бегать",
    "могу бегать",
  ]);
  const scheduleUnavailability = hasAny(text, ["не могу", "не смогу", "не успеваю", "не может"]);
  if (days.length > 0 && hasScheduleContext(text) && (scheduleAvailability || scheduleUnavailability)) {
    if (scheduleAvailability) {
      payload.available_days = days;
    }
    if (scheduleUnavailability) {
      payload.unavailable_days = days;
    }
    const observed = parseIsoDateFallback(input.observedAt);
    if (text.includes("на следующей неделе") || text.includes("следующей неделе")) {
      payload.valid_from = isoDate(startOfWeekMonday(addDays(observed, 7)));
      payload.valid_until = endOfNextWeek(observed);
    } else if (text.includes("на этой неделе")) {
      payload.valid_from = isoDate(startOfWeekMonday(observed));
      payload.valid_until = isoDate(endOfWeekSunday(observed));
    } else if (text.includes("сегодня")) {
      payload.valid_from = isoDate(observed);
      payload.valid_until = isoDate(observed);
    }
    const durableConstraint =
      hasAny(text, ["по вторникам", "по средам", "по четвергам", "из-за ребенка", "из-за ребёнка", "каждый"]) &&
      scheduleUnavailability;
    if (durableConstraint) {
      return {
        primary_bucket: "durable_memory",
        secondary_buckets: ["operational_signal"],
        signal_type: "plan_generation_constraint",
        structured_payload: payload,
        should_create_memory: true,
        should_create_case: false,
        should_create_trainingpeaks_action: false,
        confidence: "high",
        reason: "recurring schedule constraint with explicit life conflict",
      };
    }
    return {
      primary_bucket: "operational_signal",
      secondary_buckets: [],
      signal_type:
        scheduleAvailability && text.includes("на этой неделе")
          ? "plan_generation_constraint"
          : scheduleUnavailability
            ? "schedule_unavailability_window"
            : "schedule_availability_window",
      structured_payload: payload,
      should_create_memory: false,
      should_create_case: false,
      should_create_trainingpeaks_action: false,
      confidence: text.includes("можно") ? "medium" : "high",
      reason: explicitSignalReason ?? "bounded schedule window detected",
    };
  }

  if (hasAny(text, ["сегодня не успеваю", "сегодня не могу"])) {
    const today = parseRelativeDate("сегодня", input.observedAt);
    payload.valid_from = today;
    payload.valid_until = today;
    return {
      primary_bucket: "operational_signal",
      secondary_buckets: [],
      signal_type: "schedule_unavailability_window",
      structured_payload: payload,
      should_create_memory: false,
      should_create_case: false,
      should_create_trainingpeaks_action: false,
      confidence: "high",
      reason: "single-day unavailability",
    };
  }

  if (hasAny(text, ["готовится к", "готовлюсь к", "цель", "10 км", "10к", "марафон", "полумарафон"])) {
    if (hasAny(text, ["слишком много марафонов", "слишком много стартов", "слишком много соревнований"])) {
      return {
        primary_bucket: "durable_memory",
        secondary_buckets: ["operational_signal"],
        signal_type: "race_load_context",
        structured_payload: payload,
        should_create_memory: true,
        should_create_case: false,
        should_create_trainingpeaks_action: false,
        confidence: "medium",
        reason: "race load tolerance context, not explicit race goal",
      };
    }
    return {
      primary_bucket: "durable_memory",
      secondary_buckets: [],
      signal_type: null,
      structured_payload: payload,
      should_create_memory: true,
      should_create_case: false,
      should_create_trainingpeaks_action: false,
      confidence: "high",
      reason: "future race/goal context",
    };
  }

  if (hasAny(text, ["пробежала забег", "пробежал забег", "финишировал", "финишировала"])) {
    return {
      primary_bucket: "skip",
      secondary_buckets: [],
      signal_type: null,
      structured_payload: payload,
      should_create_memory: false,
      should_create_case: false,
      should_create_trainingpeaks_action: false,
      confidence: "high",
      reason: "past event report without durable planning signal",
    };
  }

  return {
    primary_bucket: "skip",
    secondary_buckets: [],
    signal_type: null,
    structured_payload: payload,
    should_create_memory: false,
    should_create_case: false,
    should_create_trainingpeaks_action: false,
    confidence: "low",
    reason: "no conservative deterministic signal matched",
  };
}
