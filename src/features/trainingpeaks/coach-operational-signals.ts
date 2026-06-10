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
  | "pain_injury"
  | "external_training_context"
  | "race_load_context";

export type OperationalConfidence = "low" | "medium" | "high";

export type OperationalActivityDomain =
  | "running"
  | "strength"
  | "cross_training"
  | "life_schedule"
  | "health"
  | "injury"
  | "unknown";

export type OperationalPlanningEffect =
  | "planned_run"
  | "run_unavailable"
  | "strength_schedule_context"
  | "external_training_context"
  | "life_schedule_constraint"
  | "move_request"
  | "safety_review"
  | "context_only"
  | "none";

export type OperationalEvidenceLevel =
  | "explicit_illness"
  | "ambiguous_malaise"
  | "explicit_pain_or_injury"
  | "possible_schedule"
  | "explicit_run_plan"
  | "strength_context"
  | "unknown";

export type OperationalDateCertainty = "confirmed" | "probable" | "possible" | "habitual_weekdays" | "none";

export type OperationalStructuredPayload = {
  available_days: string[];
  unavailable_days: string[];
  resolved_available_dates: string[];
  planned_training_dates: string[];
  unavailable_dates: string[];
  planning_status: "athlete_intends_to_train" | null;
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
  activity_domain: OperationalActivityDomain;
  planning_effect: OperationalPlanningEffect;
  evidence_level: OperationalEvidenceLevel;
  date_certainty: OperationalDateCertainty;
  requires_coach_review: boolean;
  visible_in_tp_signals: boolean;
  display_summary: string | null;
  evidence_phrases: string[];
  weekdays: Array<"monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday">;
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
  { day: "Sunday", forms: ["воскресенье", "воскресеньям", "вс", "вскр"] },
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

const FIGURATIVE_HEALTH_PHRASES = [
  "душа болит",
  "душа не болит",
  "душа просит",
  "минутка слабости",
  "момент слабости",
  "минутная слабость",
  "слабость была минутка",
  "боль и соузы",
] as const;

const ACTIVE_PAIN_SYMPTOM_CUES = [
  "болит",
  "болела",
  "болело",
  "болел",
  "болели",
  "боль",
  "боли",
  "болевые",
  "побалива",
] as const;

function stripFigurativeHealthPhrases(text: string): string {
  let result = text;
  for (const phrase of FIGURATIVE_HEALTH_PHRASES) {
    result = result.split(phrase).join(" ");
  }
  return result.replace(/\s+/gu, " ").trim();
}

function healthClassificationText(text: string): string {
  let result = stripFigurativeHealthPhrases(text);
  result = stripFamilyMemberIllnessPhrases(result);
  result = stripPostWorkoutSorenessPhrases(result);
  return result.replace(/\s+/gu, " ").trim();
}

const FAMILY_MEMBER_ILLNESS_PHRASE_PATTERN =
  /(?:^|[^\p{L}])(?:доч(?:ь|ка)|сын(?:ок)?|реб[её]нок|дети|муж(?:а|у)?|жена|мам(?:а|ы|е|у)?|пап(?:а|ы|е|у)?|брат(?:а|у)?|сестр(?:а|ы|е|у)?|родител(?:и|ь|я|ей|ям)?)\s+(?:\S+\s+){0,4}?(?:заболел(?:а|и|о)?|боле(?:ет|ют|л(?:а|и|о)?)|приболел(?:а|и|о)?)/giu;

const ATHLETE_CO_ILLNESS_PATTERNS = [
  /\b(?:я|у\s+меня|мне)\b.{0,24}\b(?:тоже|опять|снова)\b.{0,24}(?:заболел(?:а|и)?|боле(?:ю|ет)|температур|горло|кашл)/iu,
  /\b(?:мы|обе|оба)\b.{0,20}(?:заболел(?:и)?|боле(?:ем|ют))/iu,
  /\b(?:я|у\s+меня|мне)\b.{0,20}(?:температур|горло|кашл|насморк|сопл|простуд)/iu,
  /\b(?:я|мне)\b.{0,12}(?:заболел(?:а|и)?|боле(?:ю|ет)|приболел(?:а|и)?)/iu,
] as const;

const POST_WORKOUT_SORENESS_PATTERN =
  /(?:^|[^\p{L}])(?:немного\s+)?(?:ягодиц(?:ы|а|е|у)?|ног(?:и|а|е|у)?|икр(?:ы|а|е|у)?|мышц(?:ы|а|е|у)?|бедр(?:а|о|е|у)?|спин(?:а|ы|е|у)?|колен(?:о|а|е|у)?|стоп(?:ы|а|е|у)?)\s+(?:\S+\s+){0,4}?болел(?:а|и|о)?\s+после(?:\s|$|[^\p{L}])/giu;

function stripFamilyMemberIllnessPhrases(text: string): string {
  return text.replace(FAMILY_MEMBER_ILLNESS_PHRASE_PATTERN, " ").replace(/\s+/gu, " ").trim();
}

function stripPostWorkoutSorenessPhrases(text: string): string {
  if (!hasAny(text, ["силов", "зал", "жим", "присед", "планк", "тяг", "велотрен"])) {
    return text;
  }
  return text.replace(POST_WORKOUT_SORENESS_PATTERN, " ").replace(/\s+/gu, " ").trim();
}

export function hasFamilyMemberIllnessCue(text: string): boolean {
  return FAMILY_MEMBER_ILLNESS_PHRASE_PATTERN.test(stripFigurativeHealthPhrases(text));
}

export function hasAthleteCoIllnessCue(text: string): boolean {
  return ATHLETE_CO_ILLNESS_PATTERNS.some((pattern) => pattern.test(text));
}

export function isFamilyMemberIllnessOnlyContext(text: string): boolean {
  const normalized = stripFigurativeHealthPhrases(text);
  if (!FAMILY_MEMBER_ILLNESS_PHRASE_PATTERN.test(normalized)) {
    return false;
  }
  if (hasAthleteCoIllnessCue(normalized)) {
    return false;
  }
  const healthText = healthClassificationText(text);
  return !hasHealthStartedCue(healthText) && !hasExplicitIllnessCue(healthText);
}

function isNegatedCueOccurrence(text: string, cueIndex: number, cue: string): boolean {
  const windowStart = Math.max(0, cueIndex - 35);
  const before = text.slice(windowStart, cueIndex);
  if (/\bбез\s*$/iu.test(before)) {
    return true;
  }
  if (/(?:^|[^\p{L}])не\s+(?:\S+\s+){0,3}$/iu.test(before)) {
    return true;
  }
  if (/\bничего\s+не\s+(?:\S+\s+){0,2}$/iu.test(before)) {
    return true;
  }
  if (/\bникогда\s+не\s+(?:\S+\s+){0,2}$/iu.test(before)) {
    return true;
  }
  const after = text.slice(cueIndex, cueIndex + cue.length + 10);
  if (/^боли\s+нет\b/iu.test(after) || /^боль\s+нет\b/iu.test(after)) {
    return true;
  }
  return false;
}

function hasActiveCue(text: string, cue: string): boolean {
  const healthText = healthClassificationText(text);
  if (!healthText.includes(cue)) {
    return false;
  }
  let searchFrom = 0;
  while (searchFrom < healthText.length) {
    const index = healthText.indexOf(cue, searchFrom);
    if (index === -1) {
      return false;
    }
    if (!isNegatedCueOccurrence(healthText, index, cue)) {
      return true;
    }
    searchFrom = index + 1;
  }
  return false;
}

function hasActiveAny(text: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => hasActiveCue(text, pattern));
}

function hasActivePainSymptom(text: string): boolean {
  return hasActiveAny(text, ACTIVE_PAIN_SYMPTOM_CUES);
}

const PAUSE_TRAINING_CUES = [
  "воздержусь от бега",
  "не буду бегать",
  "пауза от бега",
  "не побегу",
  "беру паузу",
  "сделаю паузу",
] as const;

const SINGLE_EVENT_RUN_SKIP_CUES = [
  "не побегу",
  "не смогу побегать",
  "не могу побегать",
  "не получится побегать",
  "не смогу убежать",
  "не могу убежать",
] as const;

function hasPauseTrainingCue(text: string): boolean {
  return hasAny(text, PAUSE_TRAINING_CUES);
}

function hasTravelScheduleCue(text: string): boolean {
  return hasAny(text, [
    "улетаю",
    "поездк",
    "фестиваль",
    "командировк",
    "отпуск",
    "в отъезде",
    "в отезде",
    "свадьб",
    "день рождения",
  ]);
}

function hasDurationRunPauseConstraint(text: string): boolean {
  const hasRunCannotCue = hasAny(text, ["не смогу бегать", "бегать не смогу"]);
  if (!hasRunCannotCue) {
    return false;
  }
  if (!hasExplicitPauseWindowCue(text)) {
    return false;
  }
  if (hasHealthStartedCue(text)) {
    return false;
  }
  if (hasTravelScheduleCue(text)) {
    return false;
  }
  return true;
}

function hasToken(text: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = new RegExp(`(^|[^a-zа-яё0-9])${escaped}([^a-zа-яё0-9]|$)`, "iu");
  return pattern.test(text);
}

function hasStandaloneTomorrowToken(text: string): boolean {
  return /(?:^|[^\p{L}])завтра(?:[^\p{L}]|$)/iu.test(text);
}

function hasPositiveAbilityCue(text: string): boolean {
  const stripped = text
    .replace(/(?:^|[^\p{L}])не\s+могу(?:[^\p{L}]|$)/giu, " ")
    .replace(/(?:^|[^\p{L}])не\s+смогу(?:[^\p{L}]|$)/giu, " ");
  return hasToken(stripped, "смогу") || hasToken(stripped, "могу") || stripped.includes("смогу только");
}

const NON_TRAINING_INABILITY_PHRASES = [
  "не могу понять",
  "не могу решить",
  "не могу выбрать",
  "не могу определить",
  "не смогу понять",
  "не смогу решить",
  "не смогу выбрать",
] as const;

const EXPLICIT_TRAINING_UNAVAILABILITY_CUES = [
  "не смогу бегать",
  "не могу бегать",
  "не смогу побегать",
  "не могу побегать",
  "не смогу тренироваться",
  "не могу тренироваться",
  "не получится тренировка",
  "не получится побегать",
  "не найду время для тренировки",
  "не побегу",
  "не смогу убежать",
  "не могу убежать",
  "не смогла",
  "не смог",
  "не смогли",
] as const;

function hasTrainingUnavailabilityCue(text: string): boolean {
  if (hasAny(text, EXPLICIT_TRAINING_UNAVAILABILITY_CUES)) {
    return true;
  }
  if (!hasAny(text, ["не смогу", "не могу", "не получится", "недоступ"])) {
    return false;
  }
  if (NON_TRAINING_INABILITY_PHRASES.some((phrase) => text.includes(phrase))) {
    return false;
  }
  return hasRunningCue(text) || hasAny(text, ["трениров", "найду время"]);
}

function hasPastCompletedRunCue(text: string): boolean {
  return /(?:^|[^\p{L}])(?:по|от|про)?бегал(?:а|и|о)?(?:[^\p{L}]|$)/iu.test(text);
}

function hasFutureRunAvailabilityCue(clause: string, globalRunningContext: boolean): boolean {
  if (
    hasAny(clause, [
      "побегу",
      "пробегу",
      "планир",
      "выйду на пробежку",
      "выйти на пробежку",
      "смогу побегать",
      "могу побегать",
      "смогу бегать",
      "могу бегать",
    ])
  ) {
    return true;
  }
  if (
    hasStandaloneTomorrowToken(clause) &&
    hasPositiveAbilityCue(clause) &&
    (hasRunningCue(clause) || globalRunningContext)
  ) {
    return true;
  }
  if (hasStandaloneTomorrowToken(clause) && hasTrainingUnavailabilityCue(clause)) {
    return true;
  }
  return false;
}

function isPastCompletedRunReflectionOnly(clause: string, globalRunningContext: boolean): boolean {
  return hasPastCompletedRunCue(clause) && !hasFutureRunAvailabilityCue(clause, globalRunningContext);
}

function escapeRegexToken(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function isPastTenseMissedRunPhrase(text: string): boolean {
  return /не\s+смог(?:ла|л|ли)?\s*(?:по)?бег|не\s+смог(?:ла|л|ли)?\s+.*\s*(?:бег|побег|пробеж|убеж)/iu.test(
    text
  );
}

function extractPastMissedRunWeekdays(text: string): Set<string> {
  const missed = new Set<string>();
  if (!isPastTenseMissedRunPhrase(text)) {
    return missed;
  }
  for (const alias of DAY_ALIASES) {
    const nearMissed = alias.forms.some((form) => {
      const escaped = escapeRegexToken(form);
      return new RegExp(
        `(?:^|[^a-zа-яё])в\\s+${escaped}\\s+не\\s+смог|не\\s+смог(?:ла|л|ли)?[^.!?;]{0,48}(?:в\\s+)?${escaped}`,
        "iu"
      ).test(text);
    });
    if (nearMissed) {
      missed.add(alias.day);
    }
  }
  return missed;
}

function filterDaysExcludingPastMissedRun(text: string, days: string[]): string[] {
  const missed = extractPastMissedRunWeekdays(text);
  return days.filter((day) => !missed.has(day));
}

function extractDays(text: string): string[] {
  const output: string[] = [];
  for (const alias of DAY_ALIASES) {
    if (alias.forms.some((form) => hasToken(text, form))) {
      output.push(alias.day);
    }
  }
  return filterDaysExcludingPastMissedRun(text, output);
}

function hasTomorrowRunAvailabilityIntent(clause: string, globalRunningContext: boolean): boolean {
  if (!hasStandaloneTomorrowToken(clause)) {
    return false;
  }
  if (/завтра\s+не|не\s+[^.!?;]{0,24}завтра/iu.test(clause)) {
    return false;
  }
  if (!hasPositiveAbilityCue(clause)) {
    return false;
  }
  return hasRunningCue(clause) || globalRunningContext;
}

function parseHealthPauseUntilDate(text: string, observedAt: string): string | null {
  const match = text.match(
    /до\s+(понедельника|вторника|среды|четверга|пятницы|субботы|воскресенья|вскр|вс|пн|вт|ср|чт|пт|сб|завтра|послезавтра)/iu
  );
  if (!match?.[1]) {
    return null;
  }
  const token = match[1].toLowerCase();
  if (token === "завтра") {
    return isoDate(addDays(parseIsoDateFallback(observedAt), 1));
  }
  if (token === "послезавтра") {
    return isoDate(addDays(parseIsoDateFallback(observedAt), 2));
  }
  const days = extractDays(token);
  if (days.length > 0) {
    return inferDateForDay(days[0]!, observedAt, text);
  }
  return null;
}

export function extractDaysFromText(text: string): string[] {
  return extractDays(normalize(text));
}

function parseRelativeDate(text: string, observedAt: string): string | null {
  const observed = parseIsoDateFallback(observedAt);
  if (hasStandaloneTomorrowToken(text) || text.includes("с завтрашнего дня")) {
    return isoDate(addDays(observed, 1));
  }
  if (hasToken(text, "сегодня") || text.includes("сегодня")) {
    return isoDate(observed);
  }
  if (hasToken(text, "послезавтра") || text.includes("послезавтра")) {
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
    planned_training_dates: [],
    unavailable_dates: [],
    planning_status: null,
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
    activity_domain: "unknown",
    planning_effect: "none",
    evidence_level: "unknown",
    date_certainty: "none",
    requires_coach_review: false,
    visible_in_tp_signals: true,
    display_summary: null,
    evidence_phrases: [],
    weekdays: [],
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
    "силов",
    "зал",
    "надкостниц",
  ];
  return hasAny(text, cueWords);
}

function classifyHealthIssueKind(text: string): string | null {
  const healthText = healthClassificationText(text);
  const hasBodyPartCue = hasAny(healthText, ["нога", "колено", "ахилл", "икра", "спина", "голень", "стоп"]);
  const hasBodyRecoveryCue = hasAny(healthText, [
    "лучше",
    "получше",
    "значительно лучше",
    "полегче",
    "прошло",
    "без боли",
    "боли нет",
  ]);
  if (hasBodyPartCue && (hasActivePainSymptom(healthText) || hasBodyRecoveryCue)) {
    return "pain_or_injury";
  }
  if (
    hasActiveAny(healthText, [
      "горло",
      "температур",
      "темпера подним",
      "простуд",
      "простыл",
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
    ])
  ) {
    return "illness";
  }
  if (hasActiveAny(healthText, ["голова болит", "голов болит", "головная боль"])) {
    return null;
  }
  if (hasActivePainSymptom(healthText)) {
    return "pain_unspecified";
  }
  return null;
}

const HEALTH_SYMPTOM_PATTERNS: Array<{ symptom: string; patterns: string[] }> = [
  { symptom: "fever", patterns: ["температур", "темпера"] },
  { symptom: "cough", patterns: ["кашель", "кашля"] },
  { symptom: "throat", patterns: ["горло"] },
  { symptom: "voice", patterns: ["голос пропал", "голос осип", "голос сел", "осип голос", "голос вернул", "голос немного вернул"] },
  { symptom: "runny_nose", patterns: ["насморк", "сопли", "закладывает нос"] },
  { symptom: "cold", patterns: ["простуд", "простыл"] },
  { symptom: "orvi", patterns: ["орви"] },
  { symptom: "fatigue", patterns: ["сил нет", "сил вообще нет", "нет сил", "вообще нет сил", "без сил"] },
  { symptom: "headache", patterns: ["голова болит", "голов болит", "головная боль"] },
  { symptom: "weakness", patterns: ["слабост"] },
  { symptom: "malaise", patterns: ["отврат", "недомога", "плохо себя чувств"] },
];

function hasExplicitIllnessCue(text: string): boolean {
  return hasActiveAny(text, [
    "болею",
    "болеет",
    "болел",
    "болела",
    "болели",
    "забол",
    "прибол",
    "температур",
    "темпера подним",
    "кашель",
    "горло",
    "насморк",
    "сопли",
    "простуд",
    "простыл",
    "орви",
    "голос осип",
    "голос сел",
    "осип голос",
    "голос пропал",
  ]);
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function detectHealthSymptoms(text: string): string[] {
  const healthText = healthClassificationText(text);
  const symptoms: string[] = [];
  for (const descriptor of HEALTH_SYMPTOM_PATTERNS) {
    if (hasActiveAny(healthText, descriptor.patterns)) {
      symptoms.push(descriptor.symptom);
    }
  }
  return dedupeStrings(symptoms);
}

function hasHealthStartedCue(text: string): boolean {
  return hasActiveAny(text, [
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
    "простыл",
    "орви",
    "слабост",
    "отврат",
    "недомога",
    "плохо себя чувств",
    "отлежусь",
    "тайм аут",
    "тайм-аут",
    "таймаут",
  ]);
}

const PLANNED_RUN_ATTEMPT_CUES = [
  "пробеж",
  "выйти на пробежку",
  "выйду на пробежку",
  "выйду",
  "побегу",
  "побегаю",
  "побегать",
  "попробую побегать",
  "можно побегу",
  "можно побегать",
] as const;

const RETURN_INTENT_CUES = [
  "с понедельника начинаем тренировки",
  "начинаем тренировки",
  "возобновляем тренировки",
  "возвращаюсь к тренировкам",
  "возвращаюсь к бегу",
  "завтра побегу",
  "завтра попробую побегать",
  "попробую побегать",
  "можно побегу",
  "можно побегать",
  "с новой недели начн",
] as const;

const CONTINUED_ILLNESS_CUES = [
  "долечиться",
  "долечиваться",
  "лучше не становится",
  "не становится лучше",
  "пока продолжаю",
  "с новой недели начн",
  "с новой недели начнём",
  "с новой недели начнем",
] as const;

const RESUME_TRAINING_CUES = [
  "с завтрашнего дня начинаются тренировки",
  "начинаются тренировки",
  "начинаем тренировки",
  "возобновляю тренировки",
  "возобновляем тренировки",
  "возвращаюсь к тренировкам",
  "возвращаюсь к бегу",
  "я в строю",
  "в строю",
  "готов к тренировкам",
  "готова к тренировкам",
] as const;

function hasPlannedRunAttemptCue(text: string): boolean {
  return hasAny(text, PLANNED_RUN_ATTEMPT_CUES);
}

function hasReturnIntentCue(text: string): boolean {
  return hasAny(text, RETURN_INTENT_CUES);
}

function hasResumeTrainingCue(text: string): boolean {
  return hasAny(text, RESUME_TRAINING_CUES);
}

function hasContinuedIllnessCue(text: string): boolean {
  return hasAny(text, CONTINUED_ILLNESS_CUES);
}

export function buildContinuedIllnessCoachDisplaySummary(text: string): string | null {
  if (!hasContinuedIllnessCue(text)) {
    return null;
  }
  if (hasAny(text, ["с новой недели"])) {
    return "продолжает долечиваться, к бегу лучше вернуться с новой недели — держать паузу / уточнить перед стартом.";
  }
  return "продолжает долечиваться — держать паузу / уточнить перед стартом.";
}

function hasDoctorClearedRunCue(text: string): boolean {
  return /врач\s+разрешил[а-яё]*/iu.test(text) || hasAny(text, ["разрешила бег", "разрешил бег"]);
}

function hasHealthImprovingCue(text: string): boolean {
  if (hasDoctorClearedRunCue(text)) {
    return true;
  }
  return hasAny(text, [
    "самочувствие лучше",
    "самочувствие улучшается",
    "чувствую себя лучше",
    "лучше себя чувствую",
    "выздоравливаю",
    "выздоравливает",
    "восстанавливаюсь",
    "восстанавливается",
    "после болезни",
    "после простуды",
    "после орви",
    "восстановилась после болезни",
    "восстановился после болезни",
  ]);
}

function hasGenericImprovingCue(text: string): boolean {
  return hasAny(text, [
    "стало лучше",
    "лучше стало",
    "вроде лучше",
    "вроде лучше намного",
    "лучше намного",
    "намного лучше",
    "немного лучше",
    "чуть лучше",
    "мне лучше",
    "вроде ок",
    "вроде норм",
    "вроде нормально",
    "почти ок",
    "почти нормально",
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

function hasHealthEvidenceForImproving(text: string, symptoms: string[]): boolean {
  if (symptoms.length > 0) {
    return true;
  }
  const healthText = healthClassificationText(text);
  return (
    hasActiveAny(text, ["болею", "болела", "болел", "болит", "боль"]) ||
    hasAny(healthText, [
      "после болезни",
      "кашель",
      "горло",
      "темпера",
      "слабост",
      "недомога",
      "плохо себя чувств",
      "голос осип",
      "голос сел",
      "нога",
      "колено",
      "ахилл",
      "икра",
      "спина",
      "голень",
      "стоп",
      "травма",
    ])
  );
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
    "чувствую себя хорошо",
    "с самочувствием всё в порядке",
    "с самочувствием все в порядке",
    "самочувствие в порядке",
    "по самочувствию всё ок",
    "по самочувствию все ок",
    "всё ок по самочувствию",
    "все ок по самочувствию",
    "после пробежки всё нормально",
    "после пробежки все нормально",
    "я в строю",
    "в строю",
    "готов к тренировкам",
    "готова к тренировкам",
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
    case "fatigue":
      return "сил нет";
    case "headache":
      return "голова болит";
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
  observedAt?: string;
  signalType: "health_issue_started" | "health_issue_improving" | "health_issue_resolved";
  symptoms: string[];
  recommendation: "pause" | "easy_if_symptom_free" | "monitor" | "resume_carefully";
  plannedAttemptDate: string | null;
  pauseUntil?: string | null;
  hasTimeoutCue?: boolean;
}): string {
  const lines: string[] = [];
  const symptomSummary = joinSymptomLabels(input.symptoms);
  const pauseDays = parsePauseDurationDays(input.text);
  const hasRunPauseConstraint = hasAny(input.text, ["не смогу бегать", "бегать не смогу", "не буду бегать", "не бегать"]);
  const hasVoiceRecovery = hasAny(input.text, ["голос немного вернул", "голос вернул"]);
  const hasRestPlan = hasAny(input.text, ["отлежусь", "отлежат", "пару дней", "несколько дней"]);
  const hasReturnRunPlan =
    input.plannedAttemptDate !== null && hasPlannedRunAttemptCue(input.text);
  const hasConditionalRunPlan =
    hasReturnRunPlan &&
    hasAny(input.text, ["если", "когда"]) &&
    !hasAny(input.text, ["завтра побегу", "завтра попробую побегать", "можно побегу", "можно побегать"]);
  const explicitIllness = hasExplicitIllnessCue(input.text);

  if (input.signalType === "health_issue_started") {
    const continuedIllnessSummary = buildContinuedIllnessCoachDisplaySummary(input.text);
    if (continuedIllnessSummary) {
      return continuedIllnessSummary;
    }
    if (
      input.hasTimeoutCue &&
      input.pauseUntil &&
      hasAny(input.text, ["простыл", "простуд"])
    ) {
      return `простыла, тайм-аут до ${compactOperationalDate(input.pauseUntil)}`;
    }
    if (explicitIllness && input.text.includes("температур") && input.text.includes("с понедельника")) {
      lines.push("болеет, температура с понедельника");
    } else if (explicitIllness && input.text.includes("температур")) {
      lines.push("болеет, температура");
    } else if (explicitIllness && input.text.includes("кашель") && input.text.includes("горло")) {
      lines.push("болеет, кашель и горло");
    } else if (explicitIllness && symptomSummary) {
      lines.push(`болеет, ${symptomSummary}`);
    } else if (symptomSummary) {
      lines.push(symptomSummary);
    } else {
      lines.push(explicitIllness ? "болеет" : "плохое самочувствие");
    }
    if (hasRunPauseConstraint && pauseDays) {
      lines.push(`не бегает ${pauseDays} дней`);
    }
    lines.push("пауза / наблюдать");
    return lines.join("; ");
  }

  if (input.signalType === "health_issue_improving") {
    if (hasDoctorClearedRunCue(input.text)) {
      if (hasReturnRunPlan && input.plannedAttemptDate) {
        return "после болезни: врач разрешил бег, завтра лёгкий выход; наблюдать";
      }
      return "после болезни: врач разрешил бег; наблюдать";
    }
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
    if (hasReturnRunPlan && input.plannedAttemptDate) {
      const when =
        input.text.includes("завтра вечером") || (input.text.includes("завтра") && input.text.includes("вечер"))
          ? "завтра вечером"
          : input.text.includes("завтра")
            ? "завтра"
            : compactOperationalDate(input.plannedAttemptDate);
      if (hasConditionalRunPlan) {
        lines.push(`хочет пробежку ${when}, если кашля не будет`);
      } else if (hasAny(input.text, ["можно побег"])) {
        lines.push(`просит разрешение на пробежку (${when})`);
      } else {
        lines.push(`планирует пробежку ${when}`);
      }
    } else if (input.recommendation === "easy_if_symptom_free") {
      lines.push("лёгкий возврат только если симптомов не будет");
    }
    return lines.join("; ");
  }

  if (hasAny(input.text, ["в строю", "я в строю"])) {
    lines.push("в строю, готов к тренировкам");
  } else if (hasAny(input.text, ["готов к тренировкам", "готова к тренировкам", "начинаем тренировки"])) {
    lines.push("готов возобновить тренировки");
  } else if (input.text.includes("кашля нет")) {
    lines.push("самочувствие нормализовалось, кашля нет");
  } else if (input.text.includes("температур") && hasAny(input.text, ["нет", "не"])) {
    lines.push("самочувствие нормализовалось, температуры нет");
  } else {
    lines.push("самочувствие нормализовалось");
  }
  lines.push("можно аккуратно возвращаться к бегу");
  return lines.join("; ");
}

function buildPainInjuryCandidate(input: ObservationLike, text: string): OperationalSignalCandidate | null {
  const hasPainCue = hasActiveAny(text, ["болит", "болела", "боль", "тянет", "дискомфорт", "побалива"]);
  const healthText = healthClassificationText(text);
  const hasFingerNailCue = hasAny(healthText, PAIN_INJURY_FINGER_NAIL_CUES);
  const hasHandCue = hasAny(healthText, PAIN_INJURY_HAND_CUES);
  const hasStandardBodyCue = hasAny(healthText, PAIN_INJURY_BODY_CUES);
  const hasTraumaCue = hasAny(healthText, TRAUMA_INJURY_CUES);
  const hasTraumaInjury = hasTraumaCue && (hasFingerNailCue || hasHandCue || hasStandardBodyCue);
  const hasPainBodyInjury =
    hasPainCue && (hasStandardBodyCue || hasFingerNailCue || (hasHandCue && hasTraumaCue));
  if (!hasTraumaInjury && !hasPainBodyInjury) {
    return null;
  }
  const payload = toDefaultPayload();
  payload.activity_domain = "injury";
  payload.planning_effect = "safety_review";
  payload.evidence_level = "explicit_pain_or_injury";
  payload.date_certainty = "none";
  payload.requires_coach_review = true;
  payload.visible_in_tp_signals = true;
  payload.health_issue_kind = "pain_or_injury";
  payload.evidence_phrases = [
    ...TRAUMA_INJURY_CUES,
    ...PAIN_INJURY_BODY_CUES,
    ...PAIN_INJURY_FINGER_NAIL_CUES,
    ...PAIN_INJURY_HAND_CUES,
  ].filter((cue) => text.includes(cue));
  let base: string;
  const hasNailCue = hasAny(healthText, ["ногт", "ногтев"]);
  if (hasNailCue && hasTraumaCue) {
    base = "ноготь после удара/отрыва — уточнить, мешает ли бегу.";
  } else if (hasFingerNailCue && hasPainCue && !hasNailCue) {
    base = "боль / палец";
  } else if (hasFingerNailCue && hasTraumaCue) {
    base = "палец после удара/ушиба — уточнить, мешает ли бегу";
  } else if (payload.evidence_phrases.includes("надкостниц")) {
    base = "боль / надкостница";
  } else if (payload.evidence_phrases.length > 0) {
    base = `боль / ${payload.evidence_phrases[0]}`;
  } else {
    base = "боль / травма";
  }
  const isPastOrResolving =
    hasActiveAny(text, ["болела"]) || hasAny(text, ["был дискомфорт", "было"]);
  payload.display_summary = isPastOrResolving ? `${base} (уточнить, актуально ли)` : base;
  payload.latest_summary = payload.display_summary;

  return {
    primary_bucket: "health_lifecycle_signal",
    secondary_buckets: ["coach_case"],
    signal_type: "pain_injury",
    structured_payload: payload,
    should_create_memory: false,
    should_create_case: true,
    should_create_trainingpeaks_action: false,
    confidence: "high",
    reason: "explicit pain/injury mention",
  };
}

function compactOperationalDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value) ? value.slice(8, 10) + "." + value.slice(5, 7) : value;
}

function toWeekdayToken(day: string): OperationalStructuredPayload["weekdays"][number] | null {
  switch (day) {
    case "Monday":
      return "monday";
    case "Tuesday":
      return "tuesday";
    case "Wednesday":
      return "wednesday";
    case "Thursday":
      return "thursday";
    case "Friday":
      return "friday";
    case "Saturday":
      return "saturday";
    case "Sunday":
      return "sunday";
    default:
      return null;
  }
}

function buildWeekdayCompactLabel(weekdays: OperationalStructuredPayload["weekdays"]): string {
  const ruMap: Record<OperationalStructuredPayload["weekdays"][number], string> = {
    monday: "пн",
    tuesday: "вт",
    wednesday: "ср",
    thursday: "чт",
    friday: "пт",
    saturday: "сб",
    sunday: "вс",
  };
  return weekdays.map((weekday) => ruMap[weekday]).join("/");
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
  const healthText = healthClassificationText(text);
  const payload = toDefaultPayload();
  const symptoms = detectHealthSymptoms(text);
  const plannedAttemptDate = hasPlannedRunAttemptCue(text) ? parseRelativeDate(text, input.observedAt) : null;
  payload.health_issue_kind = classifyHealthIssueKind(text);
  payload.symptoms = symptoms;
  payload.planned_attempt_date = plannedAttemptDate;
  payload.activity_domain = "health";
  payload.planning_effect = "safety_review";
  payload.visible_in_tp_signals = true;
  payload.requires_coach_review = false;

  if (isFamilyMemberIllnessOnlyContext(text)) {
    return null;
  }

  const improving = hasHealthImprovingCue(text);
  const genericImproving = hasGenericImprovingCue(text);
  const returnIntent = hasReturnIntentCue(text);
  const resolved = hasHealthResolvedCue(text);
  const started = hasHealthStartedCue(healthText);
  const weatherTemperatureContext =
    hasAny(text, ["на улице", "за окном", "погода", "воздуха"]) &&
    hasAny(text, ["температур", "темпера"]);
  const illnessCounterCues =
    hasActiveAny(healthText, ["болею", "болеет", "болел", "болела", "болели", "болит", "забол", "прибол"]) ||
    hasAny(healthText, [
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

  if (hasContinuedIllnessCue(text)) {
    payload.health_state = "sick";
    payload.training_recommendation = "pause";
    payload.evidence_level = hasExplicitIllnessCue(text) ? "explicit_illness" : "ambiguous_malaise";
    payload.requires_coach_review = !hasExplicitIllnessCue(text);
    payload.follow_up_due_at = buildHealthFollowUpDueAt(input.observedAt, null);
    payload.latest_summary = buildHealthSummary({
      text,
      observedAt: input.observedAt,
      signalType: "health_issue_started",
      symptoms,
      recommendation: "pause",
      plannedAttemptDate,
      pauseUntil: null,
      hasTimeoutCue: false,
    });
    payload.display_summary = payload.latest_summary;
    return {
      signalType: "health_issue_started",
      payload,
      confidence: "medium",
      reason: "continued illness or delayed return signal detected",
    };
  }

  if (resolved) {
    payload.health_state = "resolved";
    payload.training_recommendation = "resume_carefully";
    payload.evidence_level = hasExplicitIllnessCue(text) ? "explicit_illness" : "unknown";
    payload.date_certainty = "probable";
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

  if (improving || (genericImproving && (hasHealthEvidenceForImproving(text, symptoms) || returnIntent))) {
    payload.health_state = "improving";
    payload.training_recommendation = plannedAttemptDate ? "easy_if_symptom_free" : "monitor";
    payload.follow_up_due_at = buildHealthFollowUpDueAt(input.observedAt, plannedAttemptDate);
    payload.evidence_level = hasExplicitIllnessCue(text) ? "explicit_illness" : "ambiguous_malaise";
    payload.date_certainty = plannedAttemptDate ? "probable" : "none";
    payload.requires_coach_review = payload.evidence_level === "ambiguous_malaise";
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
  const pauseUntil = parseHealthPauseUntilDate(text, input.observedAt);
  const hasTimeoutCue = hasAny(text, ["тайм аут", "тайм-аут", "таймаут"]);
  const hasRunPauseConstraint = hasAny(text, ["не смогу бегать", "бегать не смогу", "не буду бегать", "не бегать"]);
  const explicitIllness = hasExplicitIllnessCue(healthText);
  payload.health_state = "sick";
  payload.training_recommendation = "pause";
  payload.evidence_level = explicitIllness ? "explicit_illness" : "ambiguous_malaise";
  payload.requires_coach_review = !explicitIllness;
  payload.date_certainty = pauseUntil ? "probable" : "none";
  if (pauseUntil) {
    payload.valid_from = isoDate(parseIsoDateFallback(input.observedAt));
    payload.valid_until = pauseUntil;
  } else if (hasRunPauseConstraint && pauseDays) {
    const observed = parseIsoDateFallback(input.observedAt);
    payload.duration_days = pauseDays;
    payload.valid_from = isoDate(observed);
    payload.valid_until = isoDate(addDays(observed, pauseDays));
  }
  payload.follow_up_due_at = buildHealthFollowUpDueAt(input.observedAt, pauseUntil);
  payload.latest_summary = buildHealthSummary({
    text,
    observedAt: input.observedAt,
    signalType: "health_issue_started",
    symptoms,
    recommendation: "pause",
    plannedAttemptDate,
    pauseUntil,
    hasTimeoutCue,
  });
  payload.display_summary = payload.latest_summary;
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
    "бег",
    "побег",
    "пробеж",
    "планир",
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
  "не побегу",
  "не смогу побегать",
  "не могу побегать",
  "не получится побегать",
  "не смогу убежать",
  "не могу убежать",
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

const SCHEDULE_TRAVEL_CUES = ["уеду", "поеду", "в поездк", "буду в мск", "буду в москв", "в мск", "в москв"];

const SCHEDULE_UNCERTAINTY_CUES = ["возможно", "может быть", "наверное", "пока не решила", "пока не решил", "типо"];

const STRENGTH_CONTEXT_CUES = [
  "силов",
  "зал",
  "тренажер",
  "тренажёр",
  "кроссфит",
  "офп",
] as const;

const PAIN_INJURY_BODY_CUES = [
  "надкостниц",
  "голен",
  "голени",
  "колен",
  "ахилл",
  "спин",
  "икр",
  "стоп",
] as const;

const PAIN_INJURY_FINGER_NAIL_CUES = ["палец", "пальц", "ногт", "ногтев"] as const;

const PAIN_INJURY_HAND_CUES = ["рук", "кист"] as const;

const TRAUMA_INJURY_CUES = [
  "врезал",
  "врезалась",
  "ударил",
  "ударила",
  "ударился",
  "ударилась",
  "ушиб",
  "ушибла",
  "ушибся",
  "оторвал",
  "оторвалась",
  "отрыв",
  "посинел",
  "опух",
] as const;

function hasScheduleDateCue(text: string): boolean {
  if (
    hasToken(text, "сегодня") ||
    hasStandaloneTomorrowToken(text) ||
    hasToken(text, "послезавтра") ||
    text.includes("с завтрашнего дня") ||
    hasAny(text, [
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

function hasExplicitPauseWindowCue(text: string): boolean {
  if (
    hasAny(text, [
      "пауза",
      "воздержусь от бега",
      "не буду бегать",
      "не смогу бегать",
      "бегать не смогу",
      "отлежусь",
      "на этой неделе не бегаю",
      "на этой неделе не буду бегать",
      "на неделю",
      "эту неделю",
      "несколько дней",
      "пару дней",
    ])
  ) {
    return true;
  }
  if (parsePauseDurationDays(text) !== null) {
    return true;
  }
  if (
    /до\s+(понедельника|вторника|среды|четверга|пятницы|субботы|воскресенья|завтра|послезавтра|\d{1,2}(?:[./]\d{1,2})?)/iu.test(
      text
    )
  ) {
    return true;
  }
  if (/(?:с|со)\s+\d{1,2}(?:[./]\d{1,2})?\s+по\s+\d{1,2}(?:[./]\d{1,2})?/iu.test(text)) {
    return true;
  }
  return false;
}

function isSingleEventRunSkip(text: string): boolean {
  if (!hasAny(text, SINGLE_EVENT_RUN_SKIP_CUES)) {
    return false;
  }
  if (!hasScheduleDateCue(text)) {
    return false;
  }
  if (hasHealthStartedCue(text) || hasExplicitPauseWindowCue(text)) {
    return false;
  }
  return true;
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
    const hasLogisticsCue =
      hasTrainingUnavailabilityCue(clause) || hasAny(clause, SCHEDULE_TRAVEL_CUES);
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
  const hasNegativeAbility = hasTrainingUnavailabilityCue(text);
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
  if (!hasNegativeAbility && days.length > 0 && hasPositiveAbilityCue(text)) {
    return true;
  }
  if (
    hasAny(text, ["планир", "побегу", "пробегу", "выйду на пробежку", "выйти на пробежку"]) &&
    hasAny(text, ["бег", "побег", "пробеж", "трениров"]) &&
    (days.length > 0 ||
      hasStandaloneTomorrowToken(text) ||
      hasToken(text, "сегодня") ||
      hasToken(text, "послезавтра"))
  ) {
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

function hasRunningCue(text: string): boolean {
  return hasAny(text, ["бег", "побег", "побеж", "пробеж", "убежать"]);
}

function extractPlanningIntentDates(input: { text: string; observedAt: string }): {
  plannedDates: string[];
  unavailableDates: string[];
} {
  const planned = new Set<string>();
  const unavailable = new Set<string>();
  const globalRunningContext = hasRunningCue(input.text);
  const clauses = input.text
    .split(/[.!?;\n]+/u)
    .map((item) => item.trim())
    .filter(Boolean);

  const collectDates = (clause: string): string[] => {
    const out = new Set<string>();
    const observed = parseIsoDateFallback(input.observedAt);
    if (hasToken(clause, "сегодня") || clause.includes("сегодня")) {
      out.add(isoDate(observed));
    }
    if (hasStandaloneTomorrowToken(clause)) {
      out.add(isoDate(addDays(observed, 1)));
    }
    if (hasToken(clause, "послезавтра") || clause.includes("послезавтра")) {
      out.add(isoDate(addDays(observed, 2)));
    }
    const days = extractDays(clause);
    for (const day of days) {
      const resolved = inferDateForDay(day, input.observedAt, clause);
      if (resolved) {
        out.add(resolved);
      }
    }
    return [...out];
  };

  for (const clause of clauses) {
    if (isPastCompletedRunReflectionOnly(clause, globalRunningContext)) {
      continue;
    }
    const clauseDates = collectDates(clause);
    if (clauseDates.length === 0) {
      continue;
    }
    const hasRunCue = hasRunningCue(clause);
    const hasStrengthCue = hasAny(clause, STRENGTH_CONTEXT_CUES);
    const hasPlanningCue = hasAny(clause, ["планир", "побегу", "пробегу", "выйду на пробежку", "выйти на пробежку"]);
    const hasUnavailabilityCue = hasTrainingUnavailabilityCue(clause);
    const hasPlannedIntent = hasPlanningCue && !hasStrengthCue && (hasRunCue || globalRunningContext);
    const hasTomorrowIntent = hasTomorrowRunAvailabilityIntent(clause, globalRunningContext);
    const hasUnavailableIntent =
      hasUnavailabilityCue && (hasRunCue || globalRunningContext || hasAny(clause, ["трениров"]));
    const pastMissedDays = extractPastMissedRunWeekdays(clause);
    const today = isoDate(parseIsoDateFallback(input.observedAt));

    const hasPastMissedUnavailable =
      pastMissedDays.size > 0 && hasAny(clause, ["не смогла", "не смог", "не смогли"]);
    if (hasUnavailableIntent) {
      if (hasPlannedIntent && clause.includes("сегодня")) {
        unavailable.add(today);
      } else if (!hasPastMissedUnavailable) {
        for (const date of clauseDates) {
          unavailable.add(date);
        }
      }
    }

    if (hasPlannedIntent) {
      for (const date of clauseDates) {
        const dateFromPastMissedDay = [...pastMissedDays].some((day) => inferDateForDay(day, input.observedAt, clause) === date);
        if (dateFromPastMissedDay) {
          continue;
        }
        if (hasUnavailableIntent && date === today) {
          continue;
        }
        planned.add(date);
      }
    }

    if (hasTomorrowIntent) {
      planned.add(isoDate(addDays(parseIsoDateFallback(input.observedAt), 1)));
    }
  }

  return {
    plannedDates: [...planned].sort(),
    unavailableDates: [...unavailable].sort(),
  };
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
  const painInjury = buildPainInjuryCandidate(input, text);
  if (painInjury) {
    return painInjury;
  }
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
  const pauseTraining = hasPauseTrainingCue(text) || hasDurationRunPauseConstraint(text);
  if (!pauseTraining) {
    return null;
  }
  if (isSingleEventRunSkip(text)) {
    return null;
  }
  if (hasTravelScheduleCue(text) && !hasHealthStartedCue(text)) {
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
  const strengthWeekdays = extractDays(text)
    .map((item) => toWeekdayToken(item))
    .filter((item): item is NonNullable<typeof item> => item !== null);
  const hasStrengthContext = hasAny(text, STRENGTH_CONTEXT_CUES);
  const hasStrengthBlocksRunningCue = hasAny(text, ["не ставить интервалы", "лучше не ставить", "не ставить"]);
  const hasExplicitRunPlanCue = hasAny(text, ["планирую побегать", "завтра побегу", "побегу", "пробеж"]);
  if (hasStrengthContext && strengthWeekdays.length > 0 && hasStrengthBlocksRunningCue) {
    const payload = toDefaultPayload();
    payload.activity_domain = "strength";
    payload.planning_effect = "life_schedule_constraint";
    payload.evidence_level = "strength_context";
    payload.date_certainty = "habitual_weekdays";
    payload.requires_coach_review = true;
    payload.visible_in_tp_signals = true;
    payload.weekdays = strengthWeekdays;
    payload.display_summary = `учесть силовую: ${buildWeekdayCompactLabel(strengthWeekdays)}`;
    payload.latest_summary = payload.display_summary;
    payload.evidence_phrases = STRENGTH_CONTEXT_CUES.filter((cue) => text.includes(cue));
    return {
      primary_bucket: "operational_signal",
      secondary_buckets: [],
      signal_type: "plan_generation_constraint",
      structured_payload: payload,
      should_create_memory: false,
      should_create_case: true,
      should_create_trainingpeaks_action: false,
      confidence: "medium",
      reason: "strength schedule constrains running plan",
    };
  }

  const strengthOnlyContext =
    hasStrengthContext &&
    strengthWeekdays.length > 0 &&
    !hasExplicitRunPlanCue &&
    !hasAny(text, ["не смогу побегать", "не могу побежать", "не побегу"]);
  if (strengthOnlyContext) {
    const payload = toDefaultPayload();
    payload.activity_domain = "strength";
    payload.planning_effect = "strength_schedule_context";
    payload.evidence_level = "strength_context";
    payload.date_certainty = "habitual_weekdays";
    payload.requires_coach_review = false;
    payload.visible_in_tp_signals = false;
    payload.weekdays = strengthWeekdays;
    payload.display_summary = `силовые: ${buildWeekdayCompactLabel(strengthWeekdays)}`;
    payload.latest_summary = payload.display_summary;
    payload.evidence_phrases = STRENGTH_CONTEXT_CUES.filter((cue) => text.includes(cue));
    return {
      primary_bucket: "temporary_memory",
      secondary_buckets: [],
      signal_type: "external_training_context",
      structured_payload: payload,
      should_create_memory: true,
      should_create_case: false,
      should_create_trainingpeaks_action: false,
      confidence: "medium",
      reason: "strength schedule context without explicit running intent",
    };
  }

  const payload = toDefaultPayload();
  const hasLogisticsCue = hasTrainingUnavailabilityCue(text) || hasAny(text, SCHEDULE_TRAVEL_CUES);
  const hasDateConstraint = hasScheduleDateCue(text);
  const planningDates = extractPlanningIntentDates({ text, observedAt: input.observedAt });
  if (planningDates.plannedDates.length > 0 || planningDates.unavailableDates.length > 0) {
    payload.resolved_available_dates = planningDates.plannedDates;
    payload.planned_training_dates = planningDates.plannedDates;
    payload.unavailable_dates = planningDates.unavailableDates;
    payload.planning_status = planningDates.plannedDates.length > 0 ? "athlete_intends_to_train" : null;
    payload.activity_domain =
      planningDates.plannedDates.length > 0 ? "running" : hasRunningCue(text) ? "running" : "life_schedule";
    payload.planning_effect =
      planningDates.plannedDates.length > 0 ? "planned_run" : planningDates.unavailableDates.length > 0 ? "run_unavailable" : "none";
    payload.evidence_level = planningDates.plannedDates.length > 0 ? "explicit_run_plan" : "possible_schedule";
    payload.date_certainty = "probable";
    payload.visible_in_tp_signals = true;
    if (!payload.valid_from && planningDates.unavailableDates.length > 0) {
      payload.valid_from = planningDates.unavailableDates[0] ?? null;
      payload.valid_until = planningDates.unavailableDates[planningDates.unavailableDates.length - 1] ?? null;
    }
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
      confidence: "high",
      reason: "planned training dates with explicit schedule constraints",
    };
  }
  if (hasAny(text, ["сегодня не успеваю", "сегодня не могу"])) {
    const today = parseRelativeDate("сегодня", input.observedAt);
    payload.valid_from = today;
    payload.valid_until = today;
    payload.activity_domain = "life_schedule";
    payload.planning_effect = "run_unavailable";
    payload.evidence_level = "possible_schedule";
    payload.date_certainty = "confirmed";
    payload.visible_in_tp_signals = true;
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
  if (hasLogisticsCue && hasDateConstraint) {
    payload.activity_domain = hasRunningCue(text) ? "running" : "life_schedule";
    payload.planning_effect = "run_unavailable";
    payload.evidence_level = "possible_schedule";
    payload.date_certainty = hasAny(text, SCHEDULE_UNCERTAINTY_CUES) ? "possible" : "probable";
    payload.visible_in_tp_signals = true;
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
  const scheduleUnavailability = hasTrainingUnavailabilityCue(text) || hasAny(text, ["не успеваю", "не может"]);

  if (days.length > 0 && hasScheduleContext(text) && (scheduleAvailability || scheduleUnavailability)) {
    payload.activity_domain = hasRunningCue(text) ? "running" : "life_schedule";
    payload.planning_effect = scheduleUnavailability ? "run_unavailable" : "context_only";
    payload.evidence_level = "possible_schedule";
    payload.date_certainty = "habitual_weekdays";
    payload.visible_in_tp_signals = true;
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
    payload.activity_domain = "running";
    payload.planning_effect = "run_unavailable";
    payload.evidence_level = "possible_schedule";
    payload.date_certainty = durationDays !== null ? "probable" : "possible";
    payload.visible_in_tp_signals = true;
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
    payload.activity_domain = "running";
    payload.planning_effect = "planned_run";
    payload.evidence_level = "explicit_run_plan";
    payload.date_certainty = "probable";
    payload.visible_in_tp_signals = true;
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
    signalType === "pain_injury" ||
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

  const painCandidate = buildPainInjuryCandidate(input, text);
  const hasPainPersistence = hasAny(text, ["третий день", "несколько дней", "постоянно", "после каждой тренировки"]);
  if (painCandidate && !hasPainPersistence) {
    return {
      ...painCandidate,
      reason: explicitSignalReason ?? painCandidate.reason,
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
    const withResume = hasResumeTrainingCue(text) || hasAny(text, ["готова бегать", "готов бегать"]);
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

  const resumeTraining = hasResumeTrainingCue(text);
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

  let pauseTraining = hasPauseTrainingCue(text) || hasDurationRunPauseConstraint(text);
  if (pauseTraining) {
    if (isSingleEventRunSkip(text)) {
      pauseTraining = false;
    }
    if (hasTravelScheduleCue(text) && !hasHealthStartedCue(text)) {
      pauseTraining = false;
    }
  }
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

  const scheduleCandidate = buildScheduleCandidate(input, text);
  if (scheduleCandidate) {
    return {
      ...scheduleCandidate,
      reason: explicitSignalReason ?? scheduleCandidate.reason,
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
