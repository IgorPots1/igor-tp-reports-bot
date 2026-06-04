import {
  enrichScheduleStructuredPayload,
  resolveDayToIsoDate,
  detectWeekScopeFromText,
  parseDurationDaysFromText,
} from "@/features/trainingpeaks/operational-schedule-display";

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
  resolved_available_dates: string[];
  duration_days: number | null;
  valid_from: string | null;
  valid_until: string | null;
  resume_from_date: string | null;
  health_issue_kind: string | null;
  target_date: string | null;
  source_date: string | null;
  health_state: "sick" | "improving" | "resolved" | "unknown" | null;
  symptoms: string[];
  training_recommendation: "pause" | "easy_if_symptom_free" | "monitor" | "resume_carefully" | null;
  latest_summary: string | null;
  follow_up_due_at: string | null;
  planned_attempt_date: string | null;
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

export type OperationalSignalCandidate = Omit<OperationalClassification, "signal_type"> & {
  signal_type: OperationalSignalType;
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

const WORD_NUMBER_DAYS: Array<{ patterns: string[]; value: number }> = [
  { patterns: ["один", "одну"], value: 1 },
  { patterns: ["два", "две"], value: 2 },
  { patterns: ["три"], value: 3 },
  { patterns: ["четыре"], value: 4 },
  { patterns: ["пять"], value: 5 },
  { patterns: ["шесть"], value: 6 },
  { patterns: ["семь"], value: 7 },
  { patterns: ["восемь"], value: 8 },
  { patterns: ["девять"], value: 9 },
  { patterns: ["десять"], value: 10 },
];

function parsePauseDurationDays(text: string): number | null {
  const numericWithNoNa = text.match(/(?:на\s+)?(\d{1,2})\s+дн(?:я|ей)?/iu);
  if (numericWithNoNa) {
    const parsed = Number(numericWithNoNa[1]);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  const fromScheduleParser = parseDurationDaysFromText(text);
  if (fromScheduleParser) {
    return fromScheduleParser;
  }
  if (/пару\s+дн(?:я|ей)?/iu.test(text)) {
    return 2;
  }
  if (/несколько\s+дн(?:я|ей)?/iu.test(text)) {
    return 3;
  }
  for (const item of WORD_NUMBER_DAYS) {
    if (item.patterns.some((pattern) => new RegExp(`(?:на\\s+)?${pattern}\\s+дн(?:я|ей)?`, "iu").test(text))) {
      return item.value;
    }
  }
  return null;
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

export function extractDaysFromText(text: string): string[] {
  return extractDays(normalize(text));
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

function inferDateForDay(day: string, observedAt: string, weekScopeText = ""): string | null {
  const weekScope = detectWeekScopeFromText(weekScopeText);
  return resolveDayToIsoDate(day, observedAt, weekScope);
}

function toDefaultPayload(): OperationalStructuredPayload {
  return {
    available_days: [],
    unavailable_days: [],
    resolved_available_dates: [],
    duration_days: null,
    valid_from: null,
    valid_until: null,
    resume_from_date: null,
    health_issue_kind: null,
    target_date: null,
    source_date: null,
    health_state: null,
    symptoms: [],
    training_recommendation: null,
    latest_summary: null,
    follow_up_due_at: null,
    planned_attempt_date: null,
  };
}

function finalizeSchedulePayload(text: string, observedAt: string, payload: OperationalStructuredPayload): void {
  enrichScheduleStructuredPayload(text, observedAt, payload);
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
  if (
    hasAny(text, [
      "горло",
      "температур",
      "темпера подним",
      "простуд",
      "кашель",
      "болею",
      "болеет",
      "болел",
      "болела",
      "болели",
      "забол",
      "прибол",
      "насморк",
      "сопли",
      "орви",
      "осип",
      "голос сел",
      "голос осип",
      "осип голос",
      "голос пропал",
      "голос вернул",
      "слабост",
      "отврат",
      "недомога",
      "плохо себя чувств",
    ])
  ) {
    return "illness";
  }
  if (text.includes("бол")) {
    return "pain_unspecified";
  }
  return null;
}

const HEALTH_SYMPTOM_PATTERNS: Array<{ symptom: string; patterns: string[] }> = [
  { symptom: "fever", patterns: ["температур", "темпера"] },
  { symptom: "cough", patterns: ["кашель", "кашля"] },
  { symptom: "throat", patterns: ["горло"] },
  { symptom: "voice", patterns: ["голос пропал", "голос осип", "голос сел", "осип голос", "голос вернул", "голос немного вернул"] },
  { symptom: "runny_nose", patterns: ["насморк", "сопли"] },
  { symptom: "cold", patterns: ["простуд"] },
  { symptom: "orvi", patterns: ["орви"] },
  { symptom: "weakness", patterns: ["слабост"] },
  { symptom: "malaise", patterns: ["отврат", "недомога", "плохо себя чувств"] },
];

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function detectHealthSymptoms(text: string): string[] {
  const symptoms: string[] = [];
  for (const descriptor of HEALTH_SYMPTOM_PATTERNS) {
    if (hasAny(text, descriptor.patterns)) {
      symptoms.push(descriptor.symptom);
    }
  }
  return dedupeStrings(symptoms);
}

function hasHealthStartedCue(text: string): boolean {
  return hasAny(text, [
    "забол",
    "прибол",
    "болею",
    "болеет",
    "болел",
    "болела",
    "болели",
    "болит",
    "температур",
    "темпера подним",
    "кашель",
    "горло",
    "голос пропал",
    "голос сел",
    "голос осип",
    "осип голос",
    "насморк",
    "сопли",
    "простуд",
    "орви",
    "слабост",
    "отврат",
    "недомога",
    "плохо себя чувств",
    "отлежусь",
  ]);
}

function hasHealthImprovingCue(text: string): boolean {
  return hasAny(text, [
    "стало лучше",
    "лучше стало",
    "получше",
    "полегче",
    "лучше, но",
    "лучше но",
    "уже лучше",
    "сегодня получше",
    "сегодня лучше",
    "сегодня пока норм, но",
    "сегодня пока норм но",
    "значительно лучше",
    "еще лучше",
    "ещё лучше",
    "еще болею",
    "ещё болею",
    "плюс-минус болею",
    "плюс минус болею",
    "уже более менее",
    "более менее",
    "более-менее",
    "голос немного вернул",
    "голос вернул",
    "температура спала",
    "кашля меньше",
  ]);
}

function hasHealthResolvedCue(text: string): boolean {
  return hasAny(text, [
    "выздоров",
    "кашля нет",
    "кашель прошел",
    "кашель прошёл",
    "температуры нет",
    "температура прошла",
    "симптомов нет",
    "чувствую себя нормально",
    "чувствую себя норм",
    "без боли",
    "боли нет",
  ]);
}

function symptomLabel(symptom: string): string {
  switch (symptom) {
    case "fever":
      return "температура";
    case "cough":
      return "кашель";
    case "throat":
      return "горло";
    case "voice":
      return "голос";
    case "runny_nose":
      return "насморк";
    case "cold":
      return "простуда";
    case "orvi":
      return "ОРВИ";
    case "weakness":
      return "слабость";
    case "malaise":
      return "плохое самочувствие";
    default:
      return symptom;
  }
}

function joinSymptomLabels(symptoms: string[]): string {
  return symptoms.map(symptomLabel).join(", ");
}

function buildHealthFollowUpDueAt(observedAt: string, preferredDate?: string | null): string {
  const base =
    preferredDate && /^\d{4}-\d{2}-\d{2}$/u.test(preferredDate)
      ? new Date(`${preferredDate}T09:00:00.000Z`)
      : addDays(parseIsoDateFallback(observedAt), 1);
  return base.toISOString();
}

function buildHealthSummary(input: {
  text: string;
  signalType: "health_issue_started" | "health_issue_improving" | "health_issue_resolved";
  symptoms: string[];
  recommendation: "pause" | "easy_if_symptom_free" | "monitor" | "resume_carefully";
  plannedAttemptDate: string | null;
}): string {
  const lines: string[] = [];
  const symptomSummary = joinSymptomLabels(input.symptoms);
  const pauseDays = parsePauseDurationDays(input.text);
  const hasRunPauseConstraint = hasAny(input.text, ["не смогу бегать", "бегать не смогу", "не буду бегать", "не бегать"]);
  const hasVoiceRecovery = hasAny(input.text, ["голос немного вернул", "голос вернул"]);
  const hasRestPlan = hasAny(input.text, ["отлежусь", "отлежат", "пару дней", "несколько дней"]);
  const hasConditionalRunPlan =
    input.plannedAttemptDate !== null &&
    hasAny(input.text, ["пробеж", "выйти на пробежку", "выйду на пробежку", "побегу"]);

  if (input.signalType === "health_issue_started") {
    if (input.text.includes("температур") && input.text.includes("с понедельника")) {
      lines.push("болеет, температура с понедельника");
    } else if (input.text.includes("температур")) {
      lines.push("болеет, температура");
    } else if (input.text.includes("кашель") && input.text.includes("горло")) {
      lines.push("болеет, кашель и горло");
    } else if (symptomSummary) {
      lines.push(`болеет, ${symptomSummary}`);
    } else {
      lines.push("болеет");
    }
    if (hasRunPauseConstraint && pauseDays) {
      lines.push(`не бегает ${pauseDays} дней`);
    }
    lines.push("пауза / наблюдать");
    return lines.join("; ");
  }

  if (input.signalType === "health_issue_improving") {
    if (
      input.text.includes("вчера") &&
      input.text.includes("сегодня") &&
      input.text.includes("темпера") &&
      input.text.includes("слабост")
    ) {
      lines.push("вчера была температура, сегодня лучше, но слабость");
    } else if (input.symptoms.includes("cough")) {
      lines.push("восстанавливается, кашель ещё есть");
    } else if (symptomSummary) {
      lines.push(`ещё болеет, симптомы сохраняются: ${symptomSummary}`);
    } else {
      lines.push("самочувствие улучшается");
    }
    if (hasVoiceRecovery) {
      lines.push("голос частично вернулся");
    }
    if (hasRestPlan) {
      lines.push("планирует отлежаться пару дней");
    }
    if (hasConditionalRunPlan && input.plannedAttemptDate) {
      const when =
        input.text.includes("завтра вечером") || (input.text.includes("завтра") && input.text.includes("вечер"))
          ? "завтра вечером"
          : compactOperationalDate(input.plannedAttemptDate);
      lines.push(`хочет пробежку ${when}, если кашля не будет`);
    } else if (input.recommendation === "easy_if_symptom_free") {
      lines.push("лёгкий возврат только если симптомов не будет");
    }
    return lines.join("; ");
  }

  if (input.text.includes("кашля нет")) {
    lines.push("самочувствие нормализовалось, кашля нет");
  } else if (input.text.includes("температур") && hasAny(input.text, ["нет", "не"])) {
    lines.push("самочувствие нормализовалось, температуры нет");
  } else {
    lines.push("самочувствие нормализовалось");
  }
  lines.push("можно аккуратно возвращаться к бегу");
  return lines.join("; ");
}

function compactOperationalDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value) ? value.slice(8, 10) + "." + value.slice(5, 7) : value;
}

function classifyHealthLifecycleSignal(input: {
  text: string;
  observedAt: string;
}): {
  signalType: "health_issue_started" | "health_issue_improving" | "health_issue_resolved";
  payload: OperationalStructuredPayload;
  confidence: OperationalConfidence;
  reason: string;
} | null {
  const text = input.text;
  const payload = toDefaultPayload();
  const symptoms = detectHealthSymptoms(text);
  const plannedAttemptDate =
    hasAny(text, ["пробеж", "выйти на пробежку", "выйду на пробежку", "побегу"]) ? parseRelativeDate(text, input.observedAt) : null;
  payload.health_issue_kind = classifyHealthIssueKind(text);
  payload.symptoms = symptoms;
  payload.planned_attempt_date = plannedAttemptDate;

  const improving = hasHealthImprovingCue(text);
  const resolved = hasHealthResolvedCue(text);
  const started = hasHealthStartedCue(text);
  const weatherTemperatureContext =
    hasAny(text, ["на улице", "за окном", "погода", "воздуха"]) &&
    hasAny(text, ["температур", "темпера"]);
  const illnessCounterCues = hasAny(text, [
    "боле",
    "кашель",
    "горло",
    "слабост",
    "голос",
    "озноб",
    "отврат",
    "недомога",
    "плохо себя чувств",
  ]);

  if (weatherTemperatureContext && !illnessCounterCues && !improving && !resolved) {
    return null;
  }

  if (resolved) {
    payload.health_state = "resolved";
    payload.training_recommendation = "resume_carefully";
    payload.latest_summary = buildHealthSummary({
      text,
      signalType: "health_issue_resolved",
      symptoms,
      recommendation: "resume_carefully",
      plannedAttemptDate,
    });
    return {
      signalType: "health_issue_resolved",
      payload,
      confidence: "medium",
      reason: "health resolution signal detected",
    };
  }

  if (improving) {
    payload.health_state = "improving";
    payload.training_recommendation = plannedAttemptDate ? "easy_if_symptom_free" : "monitor";
    payload.follow_up_due_at = buildHealthFollowUpDueAt(input.observedAt, plannedAttemptDate);
    payload.latest_summary = buildHealthSummary({
      text,
      signalType: "health_issue_improving",
      symptoms,
      recommendation: payload.training_recommendation,
      plannedAttemptDate,
    });
    return {
      signalType: "health_issue_improving",
      payload,
      confidence: "medium",
      reason: "health improvement signal detected",
    };
  }

  if (!started) {
    return null;
  }

  const pauseDays = parsePauseDurationDays(text);
  const hasRunPauseConstraint = hasAny(text, ["не смогу бегать", "бегать не смогу", "не буду бегать", "не бегать"]);
  payload.health_state = "sick";
  payload.training_recommendation = "pause";
  if (hasRunPauseConstraint && pauseDays) {
    const observed = parseIsoDateFallback(input.observedAt);
    payload.duration_days = pauseDays;
    payload.valid_from = isoDate(observed);
    payload.valid_until = isoDate(addDays(observed, pauseDays));
  }
  payload.follow_up_due_at = buildHealthFollowUpDueAt(input.observedAt, null);
  payload.latest_summary = buildHealthSummary({
    text,
    signalType: "health_issue_started",
    symptoms,
    recommendation: "pause",
    plannedAttemptDate,
  });
  return {
    signalType: "health_issue_started",
    payload,
    confidence: "medium",
    reason: "health issue present without durable persistence evidence",
  };
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

const SCHEDULE_CONTEXT_CUE_WORDS = [
  "бегать",
  "тренировк",
  "на этой неделе",
  "на следующей неделе",
  "на след неделе",
  "следующей неделе",
  "улетаю",
  "поездк",
  "командировк",
  "отпуск",
  "фестиваль",
  "не смогу",
  "не могу",
  "не получится",
  "поеду",
  "уеду",
  "в мск",
  "в москв",
  "недоступ",
  "на 4 дня",
];

export function hasScheduleContextCue(text: string | null): boolean {
  const normalized = normalize(text);
  return hasAny(normalized, SCHEDULE_CONTEXT_CUE_WORDS);
}

const SCHEDULE_AVAILABILITY_CUES = [
  "не смогу",
  "не могу",
  "не получится",
  "не доступен",
  "недоступен",
  "не доступна",
  "недоступна",
];

const SCHEDULE_TRAVEL_CUES = ["уеду", "поеду", "в поездк", "буду в мск", "буду в москв", "в мск", "в москв"];

const SCHEDULE_UNCERTAINTY_CUES = ["возможно", "может быть", "наверное", "пока не решила", "пока не решил", "типо"];

function hasScheduleDateCue(text: string): boolean {
  if (
    hasAny(text, [
      "сегодня",
      "завтра",
      "послезавтра",
      "на этой неделе",
      "на следующей неделе",
      "на след неделе",
      "следующей неделе",
    ])
  ) {
    return true;
  }
  if (extractDays(text).length > 0) {
    return true;
  }
  if (/(?:^|[^0-9])([12]?\d|3[01])\s*(?:[-–]\s*)?(?:го|ое|й)(?:[^a-zа-яё]|$)/iu.test(text)) {
    return true;
  }
  if (/\b([12]?\d|3[01])(?:[./](?:0?\d|1[0-2]))\b/iu.test(text)) {
    return true;
  }
  if (/\b([12]?\d|3[01])\s*(?:или|\/)\s*([12]?\d|3[01])\b/iu.test(text)) {
    return true;
  }
  if (
    /\b([12]?\d|3[01])\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\b/iu.test(
      text
    )
  ) {
    return true;
  }
  return false;
}

function extractDayOfMonthTokens(text: string): number[] {
  const output: number[] = [];
  const push = (value: number): void => {
    if (Number.isInteger(value) && value >= 1 && value <= 31 && !output.includes(value)) {
      output.push(value);
    }
  };
  for (const match of text.matchAll(/(?:^|[^0-9])([12]?\d|3[01])\s*(?:[-–]\s*)?(?:го|ое|й)(?:[^a-zа-яё]|$)/giu)) {
    push(Number(match[1]));
  }
  for (const match of text.matchAll(/\b([12]?\d|3[01])(?:[./](?:0?\d|1[0-2]))\b/giu)) {
    push(Number(match[1]));
  }
  for (const match of text.matchAll(/\b([12]?\d|3[01])\s*(?:или|\/)\s*([12]?\d|3[01])\b/giu)) {
    if (text.includes(" или ") || text.includes("/")) {
      push(Number(match[1]));
      push(Number(match[2]));
    }
  }
  for (const match of text.matchAll(/\b([12]?\d|3[01])\b/giu)) {
    const day = Number(match[1]);
    if (day <= 31 && !/^\d{4}$/u.test(match[1] ?? "")) {
      push(day);
    }
  }
  return output;
}

function buildDateBasedScheduleSummary(text: string): string | null {
  const clauses = text.split(/[.!?;\n]+/u).map((item) => item.trim()).filter(Boolean);
  const strongDays: number[] = [];
  const uncertainDays: number[] = [];
  for (const clause of clauses) {
    const hasLogisticsCue = hasAny(clause, [...SCHEDULE_AVAILABILITY_CUES, ...SCHEDULE_TRAVEL_CUES]);
    if (!hasLogisticsCue || !hasScheduleDateCue(clause)) {
      continue;
    }
    const target = hasAny(clause, SCHEDULE_UNCERTAINTY_CUES) ? uncertainDays : strongDays;
    for (const day of extractDayOfMonthTokens(clause)) {
      if (!target.includes(day)) {
        target.push(day);
      }
    }
  }
  if (strongDays.length === 0 && uncertainDays.length === 0) {
    return null;
  }
  const formatDay = (value: number): string => String(value).padStart(2, "0");
  const strong = strongDays.sort((a, b) => a - b).map(formatDay);
  const uncertain = uncertainDays.filter((day) => !strongDays.includes(day)).sort((a, b) => a - b).map(formatDay);
  const parts: string[] = [];
  if (strong.length > 0) {
    parts.push(`недоступен: ${strong.join(" или ")}`);
  }
  if (uncertain.length > 0) {
    parts.push(`возможно недоступен: ${uncertain.join(" или ")}`);
  }
  return parts.join("; ");
}

export function isBareWeekdayObservationText(text: string | null): boolean {
  const normalized = normalize(text);
  if (!normalized) {
    return false;
  }
  const days = extractDays(normalized);
  if (days.length === 0) {
    return false;
  }
  if (hasScheduleContext(normalized)) {
    return false;
  }
  const tokens = normalized.split(/[^a-zа-яё0-9]+/giu).filter(Boolean);
  if (tokens.length === 0) {
    return false;
  }
  const allowedTokens = new Set([
    "понедельник",
    "понедельника",
    "понедельнику",
    "вторник",
    "вторника",
    "вторнику",
    "среда",
    "среду",
    "средам",
    "четверг",
    "четверга",
    "четвергу",
    "пятница",
    "пятницу",
    "пятницам",
    "суббота",
    "субботу",
    "субботам",
    "воскресенье",
    "пн",
    "вт",
    "ср",
    "чт",
    "пт",
    "сб",
    "вс",
    "и",
    "или",
  ]);
  return tokens.every((token) => allowedTokens.has(token));
}

export function buildPromotedBareWeekdayScheduleCandidate(input: {
  observation: ObservationLike;
  contextText: string;
}): OperationalSignalCandidate | null {
  const text = normalize(input.observation.textPreview);
  if (!isBareWeekdayObservationText(text) || !hasScheduleContextCue(input.contextText)) {
    return null;
  }
  const payload = toDefaultPayload();
  payload.available_days = extractDays(text);
  const normalizedContext = normalize(input.contextText);
  const contextWithWeekScope =
    normalizedContext.includes("на этой неделе") ||
    normalizedContext.includes("на следующей неделе") ||
    normalizedContext.includes("следующей неделе")
      ? normalizedContext
      : `на этой неделе ${normalizedContext}`;
  finalizeSchedulePayload(`${text}. ${contextWithWeekScope}`, input.observation.observedAt, payload);
  return {
    primary_bucket: "operational_signal",
    secondary_buckets: [],
    signal_type:
      normalizedContext.includes("на этой неделе") || normalizedContext.includes("на этой")
        ? "plan_generation_constraint"
        : "schedule_availability_window",
    structured_payload: payload,
    should_create_memory: false,
    should_create_case: false,
    should_create_trainingpeaks_action: false,
    confidence: "medium",
    reason: "bare weekdays promoted by neighboring schedule context",
  };
}

function hasAvailabilityIntent(text: string, days: string[]): boolean {
  const hasNegativeAbility = hasAny(text, ["не смогу", "не могу", "не получится"]);
  if (
    hasAny(text, [
      "может бегать",
      "сможет бегать",
      "могу только",
      "может только",
      "можно",
      "смогу бегать",
      "могу бегать",
    ])
  ) {
    return true;
  }
  if (!hasNegativeAbility && days.length > 0 && (hasToken(text, "смогу") || hasToken(text, "могу"))) {
    return true;
  }
  if (
    days.length > 0 &&
    hasToken(text, "лучше") &&
    hasAny(text, ["на следующей неделе", "на след неделе", "следующей неделе", "на этой неделе", "на этой"])
  ) {
    return true;
  }
  return false;
}

function inferPauseWindow(
  text: string,
  observedAt: string
): Pick<OperationalStructuredPayload, "valid_from" | "valid_until"> {
  const observed = parseIsoDateFallback(observedAt);
  const today = isoDate(observed);
  const tomorrow = isoDate(addDays(observed, 1));
  if (text.includes("сегодня") && text.includes("завтра")) {
    return { valid_from: today, valid_until: tomorrow };
  }
  if (text.includes("сегодня")) {
    return { valid_from: today, valid_until: today };
  }
  if (text.includes("завтра")) {
    return { valid_from: tomorrow, valid_until: tomorrow };
  }
  return { valid_from: today, valid_until: null };
}

function parseConditionalEasyRunDate(text: string, observedAt: string): string | null {
  const plannedDate = parseRelativeDate(text, observedAt);
  if (!plannedDate) {
    return null;
  }
  const hasConditionalCue =
    hasAny(text, ["если"]) &&
    hasAny(text, ["кашля не будет", "кашель не будет", "самочувствие хорошее"]) &&
    hasAny(text, ["пробеж", "выйти на пробежку", "выйду на пробежку", "побегу"]);
  return hasConditionalCue ? plannedDate : null;
}

function hasMoveWorkoutIntent(text: string, labels: string[]): boolean {
  if (labels.includes("move_workout_candidate")) {
    return true;
  }
  if (hasAny(text, ["перенеси тренировку", "перенести тренировку", "перенеси", "перенести", "сдвинь тренировку"])) {
    return true;
  }
  if (
    hasAny(text, ["переставить", "переставь", "переставим"]) &&
    (
      hasAny(text, ["трениров", "интервал"])
    )
  ) {
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
  if (
    hasAny(text, ["поставь", "поставьте"]) &&
    (
      (text.includes("на завтра") && (/\b\d{1,2}([.:]\d{1,2})?\b/u.test(text) || text.includes("трениров"))) ||
      text.includes("сегодня не получается")
    )
  ) {
    return true;
  }
  return false;
}

function buildMoveWorkoutCandidate(
  input: ObservationLike,
  text: string,
  labels: string[]
): OperationalSignalCandidate | null {
  if (!hasMoveWorkoutIntent(text, labels)) {
    return null;
  }
  const payload = toDefaultPayload();
  const { sourceDay, targetDay } = parseMoveDays(text);
  payload.target_date =
    (targetDay ? inferDateForDay(targetDay, input.observedAt, text) : null) ??
    parseRelativeDate(text, input.observedAt) ??
    parseNamedDayTargetDate(text, input.observedAt);
  payload.source_date = sourceDay
    ? inferDateForDay(sourceDay, input.observedAt, text)
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
    reason: "explicit move-workout request",
  };
}

function buildHealthLifecycleCandidate(
  input: ObservationLike,
  text: string
): OperationalSignalCandidate | null {
  const details = classifyHealthLifecycleSignal({
    text,
    observedAt: input.observedAt,
  });
  if (!details) {
    return null;
  }
  const hasPersistence = hasAny(text, ["третий день", "несколько дней", "постоянно", "после каждой тренировки"]);
  if (details.signalType === "health_issue_started" && hasPersistence && details.payload.health_issue_kind === "pain_or_injury") {
    return {
      primary_bucket: "durable_memory",
      secondary_buckets: ["coach_case"],
      signal_type: "health_issue_started",
      structured_payload: details.payload,
      should_create_memory: true,
      should_create_case: true,
      should_create_trainingpeaks_action: false,
      confidence: "high",
      reason: "persistent musculoskeletal pain likely durable",
    };
  }
  if (details.signalType !== "health_issue_started") {
    return {
      primary_bucket: "health_lifecycle_signal",
      secondary_buckets: [],
      signal_type: details.signalType,
      structured_payload: details.payload,
      should_create_memory: false,
      should_create_case: false,
      should_create_trainingpeaks_action: false,
      confidence: details.confidence,
      reason: details.reason,
    };
  }
  return {
    primary_bucket: "temporary_memory",
    secondary_buckets: ["health_lifecycle_signal"],
    signal_type: details.signalType,
    structured_payload: details.payload,
    should_create_memory: true,
    should_create_case: false,
    should_create_trainingpeaks_action: false,
    confidence: details.confidence,
    reason: details.reason,
  };
}

function buildPauseTrainingCandidate(
  input: ObservationLike,
  text: string
): OperationalSignalCandidate | null {
  const pauseTraining = hasAny(text, [
    "воздержусь от бега",
    "не буду бегать",
    "пауза от бега",
    "не побегу",
    "беру паузу",
    "сделаю паузу",
  ]);
  if (!pauseTraining) {
    return null;
  }
  const payload = toDefaultPayload();
  const pauseWindow = inferPauseWindow(text, input.observedAt);
  payload.valid_from = pauseWindow.valid_from;
  payload.valid_until = pauseWindow.valid_until;
  payload.health_issue_kind = classifyHealthIssueKind(text);
  return {
    primary_bucket: "operational_signal",
    secondary_buckets: payload.health_issue_kind ? ["health_lifecycle_signal"] : [],
    signal_type: "pause_training",
    structured_payload: payload,
    should_create_memory: false,
    should_create_case: false,
    should_create_trainingpeaks_action: false,
    confidence: payload.health_issue_kind ? "high" : "medium",
    reason: payload.health_issue_kind
      ? "explicit pause training with health context"
      : "explicit temporary training pause",
  };
}

function buildScheduleCandidate(
  input: ObservationLike,
  text: string
): OperationalSignalCandidate | null {
  const payload = toDefaultPayload();
  const hasLogisticsCue = hasAny(text, [...SCHEDULE_AVAILABILITY_CUES, ...SCHEDULE_TRAVEL_CUES]);
  const hasDateConstraint = hasScheduleDateCue(text);
  if (hasLogisticsCue && hasDateConstraint) {
    payload.latest_summary = buildDateBasedScheduleSummary(text) ?? text;
    finalizeSchedulePayload(text, input.observedAt, payload);
    return {
      primary_bucket: "operational_signal",
      secondary_buckets: [],
      signal_type: "plan_generation_constraint",
      structured_payload: payload,
      should_create_memory: false,
      should_create_case: false,
      should_create_trainingpeaks_action: false,
      confidence: hasAny(text, SCHEDULE_UNCERTAINTY_CUES) ? "medium" : "high",
      reason: "date-based schedule constraint with logistics cue",
    };
  }
  const days = extractDays(text);
  const scheduleAvailability = hasAvailabilityIntent(text, days);
  const scheduleUnavailability = hasAny(text, ["не могу", "не смогу", "не успеваю", "не может"]);

  if (days.length > 0 && hasScheduleContext(text) && (scheduleAvailability || scheduleUnavailability)) {
    if (scheduleAvailability) {
      payload.available_days = days;
    }
    if (scheduleUnavailability) {
      payload.unavailable_days = days;
    }
    if (text.includes("сегодня")) {
      const observed = parseIsoDateFallback(input.observedAt);
      payload.valid_from = isoDate(observed);
      payload.valid_until = isoDate(observed);
    }
    const durableConstraint =
      hasAny(text, ["по вторникам", "по средам", "по четвергам", "из-за ребенка", "из-за ребёнка", "каждый"]) &&
      scheduleUnavailability;
    if (durableConstraint) {
      finalizeSchedulePayload(text, input.observedAt, payload);
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
    finalizeSchedulePayload(text, input.observedAt, payload);
    return {
      primary_bucket: "operational_signal",
      secondary_buckets: [],
      signal_type:
        scheduleAvailability && (text.includes("на этой неделе") || text.includes("на этой"))
          ? "plan_generation_constraint"
          : scheduleUnavailability
            ? "schedule_unavailability_window"
            : "schedule_availability_window",
      structured_payload: payload,
      should_create_memory: false,
      should_create_case: false,
      should_create_trainingpeaks_action: false,
      confidence: text.includes("можно") ? "medium" : "high",
      reason: "bounded schedule window detected",
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

  const hasRunUnavailability = hasAny(text, [
    "точно бегать не смогу",
    "не смогу бегать",
    "бегать не смогу",
    "не получится бегать",
    "бегать не получится",
    "тренироваться не смогу",
  ]);
  const hasTravelContext = hasAny(text, [
    "улетаю",
    "поездк",
    "фестиваль",
    "командировк",
    "отпуск",
    "в отъезде",
    "в отезде",
  ]);
  const durationDays = parsePauseDurationDays(text);
  if (hasRunUnavailability && (hasTravelContext || durationDays !== null)) {
    const baseDate = parseRelativeDate("сегодня", input.observedAt) ?? isoDate(parseIsoDateFallback(input.observedAt));
    payload.valid_from = baseDate;
    if (durationDays && baseDate) {
      payload.duration_days = durationDays;
      payload.valid_until = isoDate(addDays(parseIsoDateFallback(baseDate), durationDays));
    }
    finalizeSchedulePayload(text, input.observedAt, payload);
    return {
      primary_bucket: "operational_signal",
      secondary_buckets: [],
      signal_type: "schedule_unavailability_window",
      structured_payload: payload,
      should_create_memory: false,
      should_create_case: false,
      should_create_trainingpeaks_action: false,
      confidence: "medium",
      reason: "temporary running unavailability with explicit duration",
    };
  }

  const conditionalEasyRunDate = parseConditionalEasyRunDate(text, input.observedAt);
  if (conditionalEasyRunDate) {
    payload.valid_from = conditionalEasyRunDate;
    payload.valid_until = conditionalEasyRunDate;
    payload.resolved_available_dates = [conditionalEasyRunDate];
    payload.latest_summary = `${compactOperationalDate(conditionalEasyRunDate)}: если кашля не будет — лёгкая пробежка вечером`;
    return {
      primary_bucket: "operational_signal",
      secondary_buckets: ["health_lifecycle_signal"],
      signal_type: "plan_generation_constraint",
      structured_payload: payload,
      should_create_memory: false,
      should_create_case: false,
      should_create_trainingpeaks_action: false,
      confidence: "medium",
      reason: "conditional easy run planning constraint from health update",
    };
  }
  return null;
}

function isHealthSignal(signalType: OperationalSignalType): boolean {
  return (
    signalType === "health_issue_started" ||
    signalType === "health_issue_improving" ||
    signalType === "health_issue_resolved" ||
    signalType === "pause_training" ||
    signalType === "resume_training"
  );
}

export function isScheduleSignalType(signalType: OperationalSignalType): boolean {
  return (
    signalType === "plan_generation_constraint" ||
    signalType === "schedule_availability_window" ||
    signalType === "schedule_unavailability_window"
  );
}

function addUniqueCandidate(
  list: OperationalSignalCandidate[],
  next: OperationalSignalCandidate | null
): void {
  if (!next) {
    return;
  }
  if (list.some((item) => item.signal_type === next.signal_type)) {
    return;
  }
  list.push(next);
}

function withPrimaryReasonSuffix(
  candidate: OperationalSignalCandidate | null,
  primaryReason: string | null
): OperationalSignalCandidate | null {
  if (!candidate) {
    return null;
  }
  if (!primaryReason) {
    return candidate;
  }
  return {
    ...candidate,
    reason: `${candidate.reason}; ${primaryReason}`,
  };
}

export function classifyCoachOperationalSignals(input: ObservationLike): OperationalSignalCandidate[] {
  const primary = classifyCoachOperationalSignal(input);
  if (!primary.signal_type) {
    return [];
  }
  const text = normalize(input.textPreview);
  const labels = input.labels.map((label) => label.toLowerCase());

  const candidates: OperationalSignalCandidate[] = [
    {
      ...primary,
      signal_type: primary.signal_type,
    },
  ];

  const primarySignal = primary.signal_type;
  const primaryReason = primary.reason.includes("group message missing senderRole")
    ? "group message missing senderRole but explicit student signal accepted"
    : null;

  if (
    primarySignal === "move_workout_candidate" ||
    isScheduleSignalType(primarySignal) ||
    primarySignal === "pause_training"
  ) {
    addUniqueCandidate(
      candidates,
      withPrimaryReasonSuffix(
        buildHealthLifecycleCandidate(input, text),
        primaryReason
      )
    );
  }

  if (isHealthSignal(primarySignal)) {
    addUniqueCandidate(
      candidates,
      withPrimaryReasonSuffix(
        buildMoveWorkoutCandidate(input, text, labels),
        primaryReason
      )
    );
    addUniqueCandidate(
      candidates,
      withPrimaryReasonSuffix(
        buildScheduleCandidate(input, text),
        primaryReason
      )
    );
    addUniqueCandidate(
      candidates,
      withPrimaryReasonSuffix(
        buildPauseTrainingCandidate(input, text),
        primaryReason
      )
    );
  }

  if (primarySignal === "pause_training") {
    addUniqueCandidate(
      candidates,
      withPrimaryReasonSuffix(
        buildHealthLifecycleCandidate(input, text),
        primaryReason
      )
    );
  }

  return candidates;
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
      (targetDay ? inferDateForDay(targetDay, input.observedAt, text) : null) ??
      parseRelativeDate(text, input.observedAt) ??
      parseNamedDayTargetDate(text, input.observedAt);
    payload.source_date = sourceDay
      ? inferDateForDay(sourceDay, input.observedAt, text)
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

  const healthDetails = classifyHealthLifecycleSignal({
    text,
    observedAt: input.observedAt,
  });
  const resolvedHealth = healthDetails?.signalType === "health_issue_resolved";
  if (healthDetails?.signalType === "health_issue_improving") {
    return {
      primary_bucket: "health_lifecycle_signal",
      secondary_buckets: [],
      signal_type: "health_issue_improving",
      structured_payload: healthDetails.payload,
      should_create_memory: false,
      should_create_case: false,
      should_create_trainingpeaks_action: false,
      confidence: healthDetails.confidence,
      reason: explicitSignalReason ?? healthDetails.reason,
    };
  }
  if (resolvedHealth && healthDetails) {
    healthDetails.payload.resume_from_date = parseRelativeDate(text, input.observedAt);
    const withResume = hasAny(text, ["готова бегать", "готов бегать", "начинаются тренировки", "возобновля"]);
    return {
      primary_bucket: withResume ? "operational_signal" : "health_lifecycle_signal",
      secondary_buckets: withResume ? ["health_lifecycle_signal"] : [],
      signal_type: withResume ? "resume_training" : "health_issue_resolved",
      structured_payload: healthDetails.payload,
      should_create_memory: false,
      should_create_case: false,
      should_create_trainingpeaks_action: false,
      confidence: healthDetails.confidence,
      reason: explicitSignalReason ?? healthDetails.reason,
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

  const pauseTraining = hasAny(text, [
    "воздержусь от бега",
    "не буду бегать",
    "пауза от бега",
    "не побегу",
    "беру паузу",
    "сделаю паузу",
  ]);
  if (pauseTraining) {
    const pauseWindow = inferPauseWindow(text, input.observedAt);
    payload.valid_from = pauseWindow.valid_from;
    payload.valid_until = pauseWindow.valid_until;
    payload.health_issue_kind = classifyHealthIssueKind(text);
    return {
      primary_bucket: "operational_signal",
      secondary_buckets: payload.health_issue_kind ? ["health_lifecycle_signal"] : [],
      signal_type: "pause_training",
      structured_payload: payload,
      should_create_memory: false,
      should_create_case: false,
      should_create_trainingpeaks_action: false,
      confidence: payload.health_issue_kind ? "high" : "medium",
      reason:
        explicitSignalReason ??
        (payload.health_issue_kind
          ? "explicit pause training with health context"
          : "explicit temporary training pause"),
    };
  }

  if (healthDetails?.signalType === "health_issue_started") {
    const hasPersistence = hasAny(text, ["третий день", "несколько дней", "постоянно", "после каждой тренировки"]);
    if (hasPersistence && healthDetails.payload.health_issue_kind === "pain_or_injury") {
      return {
        primary_bucket: "durable_memory",
        secondary_buckets: ["coach_case"],
        signal_type: "health_issue_started",
        structured_payload: healthDetails.payload,
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
      structured_payload: healthDetails.payload,
      should_create_memory: true,
      should_create_case: false,
      should_create_trainingpeaks_action: false,
      confidence: healthDetails.confidence,
      reason: explicitSignalReason ?? healthDetails.reason,
    };
  }

  const conditionalEasyRunDate = parseConditionalEasyRunDate(text, input.observedAt);
  if (conditionalEasyRunDate) {
    payload.valid_from = conditionalEasyRunDate;
    payload.valid_until = conditionalEasyRunDate;
    payload.resolved_available_dates = [conditionalEasyRunDate];
    payload.latest_summary = `${compactOperationalDate(conditionalEasyRunDate)}: если кашля не будет — лёгкая пробежка вечером`;
    return {
      primary_bucket: "operational_signal",
      secondary_buckets: ["health_lifecycle_signal"],
      signal_type: "plan_generation_constraint",
      structured_payload: payload,
      should_create_memory: false,
      should_create_case: false,
      should_create_trainingpeaks_action: false,
      confidence: "medium",
      reason: explicitSignalReason ?? "conditional easy run planning constraint from health update",
    };
  }

  const days = extractDays(text);
  const hasLogisticsCue = hasAny(text, [...SCHEDULE_AVAILABILITY_CUES, ...SCHEDULE_TRAVEL_CUES]);
  const hasDateConstraint = hasScheduleDateCue(text);
  if (hasLogisticsCue && hasDateConstraint) {
    payload.latest_summary = buildDateBasedScheduleSummary(text) ?? text;
    finalizeSchedulePayload(text, input.observedAt, payload);
    return {
      primary_bucket: "operational_signal",
      secondary_buckets: [],
      signal_type: "plan_generation_constraint",
      structured_payload: payload,
      should_create_memory: false,
      should_create_case: false,
      should_create_trainingpeaks_action: false,
      confidence: hasAny(text, SCHEDULE_UNCERTAINTY_CUES) ? "medium" : "high",
      reason: explicitSignalReason ?? "date-based schedule constraint with logistics cue",
    };
  }
  const scheduleAvailability = hasAvailabilityIntent(text, days);
  const scheduleUnavailability = hasAny(text, ["не могу", "не смогу", "не успеваю", "не может"]);
  if (days.length > 0 && hasScheduleContext(text) && (scheduleAvailability || scheduleUnavailability)) {
    if (scheduleAvailability) {
      payload.available_days = days;
    }
    if (scheduleUnavailability) {
      payload.unavailable_days = days;
    }
    if (text.includes("сегодня")) {
      const observed = parseIsoDateFallback(input.observedAt);
      payload.valid_from = isoDate(observed);
      payload.valid_until = isoDate(observed);
    }
    const durableConstraint =
      hasAny(text, ["по вторникам", "по средам", "по четвергам", "из-за ребенка", "из-за ребёнка", "каждый"]) &&
      scheduleUnavailability;
    if (durableConstraint) {
      finalizeSchedulePayload(text, input.observedAt, payload);
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
    finalizeSchedulePayload(text, input.observedAt, payload);
    return {
      primary_bucket: "operational_signal",
      secondary_buckets: [],
      signal_type:
        scheduleAvailability && (text.includes("на этой неделе") || text.includes("на этой"))
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

  const hasRunUnavailability = hasAny(text, [
    "точно бегать не смогу",
    "не смогу бегать",
    "бегать не смогу",
    "не получится бегать",
    "бегать не получится",
    "тренироваться не смогу",
  ]);
  const hasTravelContext = hasAny(text, [
    "улетаю",
    "поездк",
    "фестиваль",
    "командировк",
    "отпуск",
    "в отъезде",
    "в отезде",
  ]);
  const hasDurationContext = /на\s+\d{1,2}\s+дн/iu.test(text);
  if (hasRunUnavailability && (hasTravelContext || hasDurationContext)) {
    if (text.includes("сегодня")) {
      const today = parseRelativeDate("сегодня", input.observedAt);
      payload.valid_from = today;
      if (hasDurationContext && today) {
        const daysCount = Number(text.match(/на\s+(\d{1,2})\s+дн/iu)?.[1] ?? 0);
        if (daysCount > 0) {
          payload.duration_days = daysCount;
          payload.valid_until = isoDate(addDays(parseIsoDateFallback(today), daysCount - 1));
        }
      }
    }
    finalizeSchedulePayload(text, input.observedAt, payload);
    return {
      primary_bucket: "operational_signal",
      secondary_buckets: [],
      signal_type: "schedule_unavailability_window",
      structured_payload: payload,
      should_create_memory: false,
      should_create_case: false,
      should_create_trainingpeaks_action: false,
      confidence: "medium",
      reason: "travel/duration-linked temporary running unavailability",
    };
  }

  if (hasAny(text, ["отдыхать буду после марафона", "отдыхать я буду после марафона"])) {
    return {
      primary_bucket: "skip",
      secondary_buckets: [],
      signal_type: null,
      structured_payload: payload,
      should_create_memory: false,
      should_create_case: false,
      should_create_trainingpeaks_action: false,
      confidence: "medium",
      reason: "future post-race rest note without current operational constraint",
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
