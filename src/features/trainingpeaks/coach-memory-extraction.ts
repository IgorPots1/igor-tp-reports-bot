import {
  insertTrainingPeaksStudentMemoryItem,
  touchTrainingPeaksStudentMemoryItem,
  type TrainingPeaksStudentMemoryItem,
  type TrainingPeaksStudentMemoryType,
} from "@/features/trainingpeaks/repository";

const OPENAI_API_URL = process.env.OPENAI_API_URL?.trim() || "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL =
  process.env.COACH_MEMORY_EXTRACTION_MODEL?.trim() ||
  process.env.OPENAI_COACH_MEMORY_MODEL?.trim() ||
  "gpt-4o-mini";
const DRY_RUN_GUARD_ENV = "COACH_MEMORY_AI_DRY_RUN_MODE";
const EXTRACTION_ENABLED_ENV = "COACH_MEMORY_EXTRACTION_ENABLED";
const MIN_CONFIDENCE_ENV = "COACH_MEMORY_MIN_CONFIDENCE";

const MEMORY_TYPES = new Set<TrainingPeaksStudentMemoryType>([
  "communication_style",
  "schedule_constraint",
  "availability_preference",
  "pain_or_injury",
  "health_status",
  "emotional_state",
  "load_tolerance",
  "planning_preference",
  "race_or_goal",
  "travel_or_life_event",
  "equipment_or_device_note",
]);

const NOTIFICATION_LEVELS = new Set<CoachMemoryExtractionNotificationLevel>([
  "immediate",
  "digest",
  "silent",
  "ignore",
]);

const SUPERSEDES_REASONS = new Set<"resolved" | "updated" | "contradicted">([
  "resolved",
  "updated",
  "contradicted",
]);

const CASE_KINDS = new Set<NonNullable<CoachMemoryExtractionResult["caseCandidate"]>["kind"]>([
  "pain_or_health_signal",
  "question_to_coach",
  "move_workout_needs_review",
  "observation_only",
]);

const CASE_PRIORITIES = new Set<NonNullable<CoachMemoryExtractionResult["caseCandidate"]>["priority"]>([
  "urgent",
  "normal",
  "low",
]);

export type CoachMemoryExtractionNotificationLevel = "immediate" | "digest" | "silent" | "ignore";

export type CoachMemoryExtractionMemoryType = TrainingPeaksStudentMemoryType;

export type CoachMemoryExtractionItem = {
  memoryType: CoachMemoryExtractionMemoryType;
  summaryText: string;
  structured: Record<string, unknown>;
  validFrom: string | null;
  validUntil: string | null;
  confidence: number;
  affectsPlanning: boolean;
  requiresCoachAttention: boolean;
  notificationLevel: CoachMemoryExtractionNotificationLevel;
  supersedesHint: {
    reason: "resolved" | "updated" | "contradicted" | null;
    targetMemoryType: CoachMemoryExtractionMemoryType | null;
  };
};

export type CoachMemoryExtractionResult = {
  shouldRemember: boolean;
  memoryItems: CoachMemoryExtractionItem[];
  caseCandidate: {
    kind: "pain_or_health_signal" | "question_to_coach" | "move_workout_needs_review" | "observation_only" | null;
    priority: "urgent" | "normal" | "low" | null;
  } | null;
  reason: string;
};

type ExtractionInput = {
  studentName: string;
  observationPreview: string;
  observationLabels: string[];
  sourceType: string | null;
  observedAt: string;
  currentActiveMemoryItems?: Array<{
    memoryType: string;
    summaryText: string;
    structured?: Record<string, unknown>;
    validUntil?: string | null;
  }>;
  referenceDate?: string;
};

export type ProcessCoachMemoryForObservationInput = {
  observationId: string;
  studentId: string;
  studentName: string;
  textPreview: string | null;
  labels: string[];
  sourceType: string | null;
  observedAt: string;
  currentActiveMemoryItems: Pick<
    TrainingPeaksStudentMemoryItem,
    "id" | "memoryType" | "summaryText" | "structured" | "validUntil"
  >[];
  applyWrites?: boolean;
  precomputedExtraction?: CoachMemoryExtractionResult;
};

export type ProcessCoachMemoryForObservationResult =
  | {
      status: "disabled";
      inserted: 0;
      touched: 0;
      skipped: 0;
      belowConfidence: 0;
      duplicate: 0;
      reason: string;
    }
  | {
      status: "no_memory";
      inserted: 0;
      touched: 0;
      skipped: number;
      belowConfidence: 0;
      duplicate: 0;
      reason: string;
    }
  | {
      status: "processed";
      inserted: number;
      touched: number;
      skipped: number;
      belowConfidence: number;
      duplicate: number;
      reason: string;
      applyWrites: boolean;
    };

type OpenAiChatResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
};

const MUSCULOSKELETAL_PAIN_OR_INJURY_KEYWORDS = [
  "болит",
  "боль",
  "болезнен",
  "травм",
  "колено",
  "ахилл",
  "икра",
  "бедро",
  "спина",
  "голеностоп",
  "стоп",
  "пятк",
  "сустав",
  "мышц",
  "сухожил",
  "голень",
  "растяж",
  "надрыв",
  "перегруз",
  "injur",
  "pain",
];

const ILLNESS_HEALTH_KEYWORDS = [
  "горло",
  "температур",
  "болезн",
  "забол",
  "простуд",
  "кашель",
  "насморк",
  "орви",
  "грипп",
  "ангин",
  "головн",
  "тошн",
  "слабост",
  "озноб",
  "давлен",
  "ill",
  "sick",
  "fever",
  "cough",
  "cold",
];

const NON_BODY_DISCOMFORT_KEYWORDS = [
  "телефон",
  "карман",
  "кроссовк",
  "шнур",
  "одежд",
  "майк",
  "тайтс",
  "дожд",
  "жарк",
  "холод",
  "ветер",
  "phone",
  "shoe",
  "weather",
  "pocket",
];

const ONE_OFF_MOVE_REQUEST_KEYWORDS = [
  "перенести",
  "перенесу",
  "перенес",
  "перенос",
  "на завтра",
  "можно завтра",
  "попробую завтра",
  "побегу завтра",
  "не побегу сегодня",
  "из-за дождя",
  "move to tomorrow",
];

const SCHEDULE_CONSTRAINT_KEYWORDS = [
  "не могу",
  "не смогу",
  "не получается",
  "не получится",
  "недоступ",
  "нет возможности",
  "график меняется",
  "меняется график",
  "по вторникам",
  "по средам",
  "по четвергам",
  "по пятницам",
  "по субботам",
  "по воскресеньям",
  "по понедельникам",
  "каждый вторник",
  "каждую неделю",
  "в отпуске",
  "командировк",
  "работ",
  "смена",
  "семейн",
];
const AVAILABILITY_PREFERENCE_KEYWORDS = [
  "предпочита",
  "удобнее",
  "лучше",
  "могу только",
  "предпочитает",
  "обычно",
  "обычно могу",
];
const OPERATIONAL_STARTS_TOMORROW_KEYWORDS = [
  "с завтрашнего дня начинаются тренировки",
  "с завтрашнего дня начинаются тренировки.",
];

const SCHEDULE_INFO_REQUEST_KEYWORDS = [
  "интересуюсь расписанием",
  "что по плану",
  "какая тренировка",
  "что запланировано",
  "что на субботу",
  "что в субботу",
];

const RECURRENT_LOAD_KEYWORDS = ["третий раз", "повтор", "снова", "каждый раз", "не вывожу", "слишком тяжело"];
const URGENT_SCHEDULE_KEYWORDS = ["сегодня", "завтра", "ближайш", "сейчас", "утром", "вечером"];
const PAST_EVENT_ONLY_KEYWORDS = [
  "участвова",
  "пробежал",
  "пробежала",
  "сходил на забег",
  "сходила на забег",
  "финиширова",
  "закончил",
  "закончила",
  "completed",
  "participated",
  "finished",
];
const FUTURE_RACE_GOAL_KEYWORDS = [
  "готовит",
  "готовлюсь",
  "планиру",
  "цель",
  "предстоящ",
  "будущ",
  "следующ",
  "стартую",
  "upcoming",
  "goal",
  "target race",
  "next race",
  "prep",
];
const REFLECTIVE_RACE_OVERLOAD_KEYWORDS = [
  "слишком большом количестве марафонов",
  "слишком много марафонов",
  "слишком много стартов",
  "слишком часто старт",
  "слишком много соревнований",
  "too many marathons",
  "too many races",
  "overracing",
];
const TRANSIENT_RESOLVED_PAIN_KEYWORDS = [
  "потом прошло",
  "поболело и прошло",
  "сейчас не болит",
  "дискомфорт прошел",
  "дискомфорт прошёл",
  "уже прошло",
  "уже не болит",
  "не болит сейчас",
  "passed",
  "resolved",
  "no longer hurts",
];
const PERSISTENT_PAIN_KEYWORDS = [
  "несколько дней",
  "повторя",
  "усилива",
  "не проход",
  "после каждой тренировки",
  "каждой тренировки",
  "каждый раз",
  "постоянно",
  "остается",
  "остаётся",
  "persistent",
  "worse",
  "keeps hurting",
];
const TEMPORARY_AVAILABILITY_HINTS = [
  "на следующей неделе",
  "следующей неделе",
  "только вт",
  "только чт",
  "только во вторник",
  "только в четверг",
  "сегодня",
  "завтра",
  "в поездке",
  "поездк",
  "в отпуске",
  "until",
  "next week",
  "today",
  "tomorrow",
];
const RU_MONTH_TO_NUMBER: Record<string, string> = {
  января: "01",
  феврал: "02",
  марта: "03",
  апрел: "04",
  мая: "05",
  май: "05",
  июня: "06",
  июля: "07",
  августа: "08",
  сентября: "09",
  октября: "10",
  ноября: "11",
  декабря: "12",
};

function normalizeForRules(input: string): string {
  return input.toLowerCase().replace(/\s+/gu, " ").trim();
}

function getCoachMemoryMinConfidence(): number {
  const raw = process.env[MIN_CONFIDENCE_ENV]?.trim();
  if (!raw) {
    return 0.7;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return 0.7;
  }

  return Math.max(0, Math.min(1, parsed));
}

function isCoachMemoryExtractionEnabled(): boolean {
  return process.env[EXTRACTION_ENABLED_ENV]?.trim() === "true";
}

function normalizeSummaryForDedupe(input: string): string {
  return input.toLowerCase().replace(/\s+/gu, " ").trim();
}

function pickTouchedValidUntil(existingValidUntil: string | null, candidateValidUntil: string | null): string | null | undefined {
  if (candidateValidUntil && !existingValidUntil) {
    return candidateValidUntil;
  }
  return undefined;
}

function toLowerString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = normalizeForRules(value);
  return normalized || null;
}

function buildStructuredDedupeKey(memoryType: CoachMemoryExtractionMemoryType, structured: Record<string, unknown>): string | null {
  if (memoryType === "schedule_constraint") {
    const dayOfWeek = toLowerString(structured.day_of_week);
    const constraint = toLowerString(structured.constraint);
    if (dayOfWeek && constraint) {
      return `schedule_constraint:${dayOfWeek}:${constraint}`;
    }
  }

  if (memoryType === "pain_or_injury") {
    const bodyPart = toLowerString(structured.body_part);
    const symptom = toLowerString(structured.symptom);
    if (bodyPart && symptom) {
      return `pain_or_injury:${bodyPart}:${symptom}`;
    }
  }

  if (memoryType === "race_or_goal") {
    const eventDate = toLowerString(structured.event_date) ?? toLowerString(structured.date);
    if (eventDate) {
      return `race_or_goal:${eventDate}`;
    }
  }

  return null;
}

function isPastDate(value: string | null, referenceIso: string): boolean {
  if (!value) {
    return false;
  }

  return value < referenceIso.slice(0, 10);
}

function textHasAny(text: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function isOneOffMoveRequest(text: string): boolean {
  return textHasAny(text, ONE_OFF_MOVE_REQUEST_KEYWORDS);
}

function looksLikeScheduleInfoRequest(text: string): boolean {
  return textHasAny(text, SCHEDULE_INFO_REQUEST_KEYWORDS);
}

function looksLikeDurableScheduleConstraint(text: string): boolean {
  return textHasAny(text, SCHEDULE_CONSTRAINT_KEYWORDS);
}

function looksLikeDurableAvailabilityPreference(text: string): boolean {
  return textHasAny(text, AVAILABILITY_PREFERENCE_KEYWORDS);
}

function looksLikeOperationalTrainingStartsTomorrow(text: string): boolean {
  return textHasAny(text, OPERATIONAL_STARTS_TOMORROW_KEYWORDS);
}

function hasMusculoskeletalPainOrInjurySignal(text: string): boolean {
  return textHasAny(text, MUSCULOSKELETAL_PAIN_OR_INJURY_KEYWORDS);
}

function hasIllnessHealthSignal(text: string): boolean {
  return textHasAny(text, ILLNESS_HEALTH_KEYWORDS);
}

function hasAnyHealthSignal(text: string): boolean {
  return hasMusculoskeletalPainOrInjurySignal(text) || hasIllnessHealthSignal(text);
}

function isIllnessOnlySignal(text: string): boolean {
  return hasIllnessHealthSignal(text) && !hasMusculoskeletalPainOrInjurySignal(text);
}

function hasOnlyNonBodyDiscomfort(text: string): boolean {
  return textHasAny(text, NON_BODY_DISCOMFORT_KEYWORDS) && !hasAnyHealthSignal(text);
}

function addDaysToIsoDate(isoDate: string, days: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(isoDate)) {
    return null;
  }
  const parsed = Date.parse(`${isoDate}T00:00:00.000Z`);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return new Date(parsed + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function collectIsoDatesFromText(text: string): string[] {
  const dates = new Set<string>();
  for (const match of text.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/gu)) {
    if (match[1]) {
      dates.add(match[1]);
    }
  }
  return [...dates];
}

function monthFromText(rawMonth: string): string | null {
  const normalized = rawMonth.toLowerCase().replace(/ё/gu, "е");
  for (const [stem, month] of Object.entries(RU_MONTH_TO_NUMBER)) {
    if (normalized.startsWith(stem)) {
      return month;
    }
  }
  return null;
}

function collectLocalizedDatesFromText(text: string, referenceDate: string): string[] {
  const dates = new Set<string>();

  for (const match of text.matchAll(/\b([0-3]?\d)\.([01]?\d)(?:\.(20\d{2}))?\b/gu)) {
    const day = match[1]?.padStart(2, "0");
    const month = match[2]?.padStart(2, "0");
    const year = match[3] ?? referenceDate.slice(0, 4);
    if (day && month) {
      dates.add(`${year}-${month}-${day}`);
    }
  }

  for (const match of text.matchAll(/\b([0-3]?\d)\s+([а-яё]+)(?:\s+(20\d{2}))?\b/gu)) {
    const day = match[1]?.padStart(2, "0");
    const month = monthFromText(match[2] ?? "");
    const year = match[3] ?? referenceDate.slice(0, 4);
    if (day && month) {
      dates.add(`${year}-${month}-${day}`);
    }
  }

  return [...dates].filter((date) => /^\d{4}-\d{2}-\d{2}$/u.test(date));
}

function hasFutureDateSignal(text: string, referenceDate: string): boolean {
  const normalizedReference = referenceDate.slice(0, 10);
  const candidates = [
    ...collectIsoDatesFromText(text),
    ...collectLocalizedDatesFromText(text, normalizedReference),
  ];
  return candidates.some((date) => date > normalizedReference);
}

function shouldSkipPastEventRaceOrGoal(
  text: string,
  structured: Record<string, unknown>,
  validFrom: string | null,
  referenceDate: string
): boolean {
  const hasPastOnlySignal = textHasAny(text, PAST_EVENT_ONLY_KEYWORDS);
  const hasReflectiveOverloadSignal = textHasAny(text, REFLECTIVE_RACE_OVERLOAD_KEYWORDS);
  if (!hasPastOnlySignal && !hasReflectiveOverloadSignal) {
    return false;
  }

  const hasFutureSignal =
    textHasAny(text, FUTURE_RACE_GOAL_KEYWORDS) ||
    hasFutureDateSignal(text, referenceDate) ||
    (validFrom !== null && validFrom > referenceDate);

  const structuredEventDate = toSafeDate(structured.event_date) ?? toSafeDate(structured.date);
  if (structuredEventDate && structuredEventDate > referenceDate) {
    return false;
  }

  return !hasFutureSignal;
}

function shouldSkipResolvedTransientPain(text: string): boolean {
  const hasResolvedSignal = textHasAny(text, TRANSIENT_RESOLVED_PAIN_KEYWORDS);
  if (!hasResolvedSignal) {
    return false;
  }
  return !textHasAny(text, PERSISTENT_PAIN_KEYWORDS);
}

function isTemporaryAvailabilitySignal(memoryType: CoachMemoryExtractionMemoryType, text: string): boolean {
  if (
    memoryType !== "availability_preference" &&
    memoryType !== "schedule_constraint" &&
    memoryType !== "travel_or_life_event"
  ) {
    return false;
  }
  return textHasAny(text, TEMPORARY_AVAILABILITY_HINTS) || /с\s+\d{1,2}\s+по\s+\d{1,2}\s+[а-яё]+/u.test(text);
}

function inferBoundedValidUntil(text: string, referenceDate: string): string | null {
  const normalizedReference = referenceDate.slice(0, 10);
  const candidates = new Set<string>();

  for (const date of collectIsoDatesFromText(text)) {
    candidates.add(date);
  }
  for (const date of collectLocalizedDatesFromText(text, normalizedReference)) {
    candidates.add(date);
  }

  const rangeMatch = text.match(/с\s+([0-3]?\d)\s+по\s+([0-3]?\d)\s+([а-яё]+)(?:\s+(20\d{2}))?/u);
  if (rangeMatch) {
    const endDay = rangeMatch[2]?.padStart(2, "0");
    const month = monthFromText(rangeMatch[3] ?? "");
    const year = rangeMatch[4] ?? normalizedReference.slice(0, 4);
    if (endDay && month) {
      candidates.add(`${year}-${month}-${endDay}`);
    }
  }

  if (text.includes("сегодня")) {
    candidates.add(normalizedReference);
  }
  if (text.includes("завтра")) {
    const tomorrow = addDaysToIsoDate(normalizedReference, 1);
    if (tomorrow) {
      candidates.add(tomorrow);
    }
  }
  if (text.includes("на следующей неделе") || text.includes("следующей неделе")) {
    const twoWeeks = addDaysToIsoDate(normalizedReference, 14);
    if (twoWeeks) {
      candidates.add(twoWeeks);
    }
  }

  const sorted = [...candidates]
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/u.test(date) && date >= normalizedReference)
    .sort();
  return sorted[sorted.length - 1] ?? null;
}

function applyConservativeMemoryRules(
  item: CoachMemoryExtractionItem,
  observationText: string,
  referenceDate: string
): CoachMemoryExtractionItem | null {
  const normalizedReference = referenceDate.slice(0, 10);
  const combinedText = normalizeForRules(`${observationText} ${item.summaryText}`);
  const adjusted: CoachMemoryExtractionItem = {
    ...item,
    structured: { ...item.structured },
  };

  if (
    adjusted.memoryType === "race_or_goal" &&
    shouldSkipPastEventRaceOrGoal(combinedText, adjusted.structured, adjusted.validFrom, normalizedReference)
  ) {
    return null;
  }

  if (adjusted.memoryType === "pain_or_injury") {
    if (isIllnessOnlySignal(combinedText)) {
      adjusted.memoryType = "health_status";
      adjusted.structured = { ...adjusted.structured };
    } else if (shouldSkipResolvedTransientPain(combinedText)) {
      return null;
    }
  }

  if (isTemporaryAvailabilitySignal(adjusted.memoryType, combinedText) && !adjusted.validUntil) {
    const inferredValidUntil = inferBoundedValidUntil(combinedText, normalizedReference);
    if (inferredValidUntil) {
      adjusted.validUntil = inferredValidUntil;
    } else {
      adjusted.confidence = Math.min(adjusted.confidence, 0.64);
    }
  }

  return adjusted;
}

function normalizeNotificationLevelWithRules(
  item: CoachMemoryExtractionItem,
  text: string
): CoachMemoryExtractionNotificationLevel {
  if (item.memoryType === "communication_style" || item.memoryType === "equipment_or_device_note") {
    return "silent";
  }

  if (item.memoryType === "planning_preference" || item.memoryType === "availability_preference") {
    return "silent";
  }

  if (item.memoryType === "pain_or_injury" || item.memoryType === "health_status") {
    return "immediate";
  }

  if (item.memoryType === "load_tolerance") {
    return textHasAny(text, RECURRENT_LOAD_KEYWORDS) ? "immediate" : "digest";
  }

  if (item.memoryType === "schedule_constraint") {
    const urgent = textHasAny(text, URGENT_SCHEDULE_KEYWORDS);
    const constraint = looksLikeDurableScheduleConstraint(text);
    return urgent && constraint ? "immediate" : "digest";
  }

  if (item.memoryType === "emotional_state" || item.memoryType === "race_or_goal" || item.memoryType === "travel_or_life_event") {
    return "digest";
  }

  return item.notificationLevel;
}

function applyDryRunMemoryGuards(
  rawItems: CoachMemoryExtractionItem[],
  input: ExtractionInput
): { memoryItems: CoachMemoryExtractionItem[]; forcedCaseCandidate: CoachMemoryExtractionResult["caseCandidate"] | null } {
  const observationText = normalizeForRules(input.observationPreview);
  const referenceDate = (input.referenceDate ?? input.observedAt.slice(0, 10)).slice(0, 10);
  const labels = input.observationLabels.map((label) => label.toLowerCase());
  const sourceType = (input.sourceType ?? "").toLowerCase();
  const oneOffMoveRequest = isOneOffMoveRequest(observationText);
  const scheduleInfoRequest = looksLikeScheduleInfoRequest(observationText);
  const durableScheduleConstraint = looksLikeDurableScheduleConstraint(observationText);
  const durableAvailabilityPreference = looksLikeDurableAvailabilityPreference(observationText);
  const operationalStartsTomorrow = looksLikeOperationalTrainingStartsTomorrow(observationText);
  const inboundBusinessDm = sourceType === "business_dm";

  const filtered = rawItems
    .filter((item) => {
      if (item.memoryType === "communication_style" && inboundBusinessDm) {
        const hasCoachStyleEvidenceLabel = labels.some(
          (label) => label.includes("coach_outgoing") || label.includes("coach_style")
        );
        if (!hasCoachStyleEvidenceLabel) {
          return false;
        }
      }

      if (item.memoryType === "pain_or_injury") {
        const combinedPainEvidenceText = `${observationText} ${normalizeForRules(item.summaryText)}`;
        const hasMusculoskeletalSignal = hasMusculoskeletalPainOrInjurySignal(combinedPainEvidenceText);
        const illnessOnly = isIllnessOnlySignal(combinedPainEvidenceText);
        if ((!hasMusculoskeletalSignal && !illnessOnly) || hasOnlyNonBodyDiscomfort(combinedPainEvidenceText)) {
          return false;
        }
      }

      if (item.memoryType === "schedule_constraint") {
        if (scheduleInfoRequest) {
          return false;
        }
        if (oneOffMoveRequest && !durableScheduleConstraint) {
          return false;
        }
        if (!durableScheduleConstraint && observationText.includes("попробую завтра")) {
          return false;
        }
      }

      if (
        item.memoryType === "availability_preference" &&
        operationalStartsTomorrow &&
        !durableScheduleConstraint &&
        !durableAvailabilityPreference
      ) {
        return false;
      }

      return true;
    })
    .map((item) => {
      const adjusted = applyConservativeMemoryRules(item, observationText, referenceDate);
      if (!adjusted) {
        return null;
      }
      return {
        ...adjusted,
        notificationLevel: normalizeNotificationLevelWithRules(adjusted, observationText),
      };
    })
    .filter((item): item is CoachMemoryExtractionItem => Boolean(item));

  if (oneOffMoveRequest && !durableScheduleConstraint) {
    return {
      memoryItems: filtered,
      forcedCaseCandidate: {
        kind: "move_workout_needs_review",
        priority: "normal",
      },
    };
  }

  return {
    memoryItems: filtered,
    forcedCaseCandidate: null,
  };
}

function resolveCandidateModels(): string[] {
  const preferred = OPENAI_MODEL.trim();
  const fallback = "gpt-4o-mini";
  const models = [preferred, fallback].filter((value, index, array) => value.length > 0 && array.indexOf(value) === index);
  return models;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5;
  }
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function toObject(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  return input as Record<string, unknown>;
}

function toSafeDate(input: unknown): string | null {
  if (typeof input !== "string") {
    return null;
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  return /^\d{4}-\d{2}-\d{2}$/u.test(trimmed) ? trimmed : null;
}

function toTrimmedString(input: unknown, maxLength: number): string | null {
  if (typeof input !== "string") {
    return null;
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, maxLength);
}

function extractJsonOnly(content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }
  return trimmed;
}

function sanitizeCommunicationStyleStructured(structured: Record<string, unknown>): Record<string, unknown> {
  const formalityRaw = structured.formality;
  const toneRaw = structured.tone;
  const emojiLevelRaw = structured.emoji_level;
  const punctuationStyleRaw = structured.punctuation_style;

  const formality = formalityRaw === "ty" || formalityRaw === "vy" || formalityRaw === "unknown" ? formalityRaw : "unknown";
  const tone = toneRaw === "warm" || toneRaw === "neutral" || toneRaw === "direct" || toneRaw === "formal" ? toneRaw : "neutral";
  const emojiLevel =
    emojiLevelRaw === "none" || emojiLevelRaw === "low" || emojiLevelRaw === "moderate" || emojiLevelRaw === "high"
      ? emojiLevelRaw
      : "low";
  const punctuationStyle =
    punctuationStyleRaw === "standard" || punctuationStyleRaw === "minimal" || punctuationStyleRaw === "expressive"
      ? punctuationStyleRaw
      : "standard";

  const preferredGreetingRaw = structured.preferred_greeting;
  const greetingConfidenceRaw = structured.greeting_confidence;
  const greetingObservationCountRaw = structured.greeting_observation_count;

  const preferredGreeting =
    typeof preferredGreetingRaw === "string"
      ? preferredGreetingRaw.trim().slice(0, 80) || null
      : preferredGreetingRaw === null
        ? null
        : null;

  const greetingConfidence =
    typeof greetingConfidenceRaw === "number" && Number.isFinite(greetingConfidenceRaw)
      ? clamp01(greetingConfidenceRaw)
      : null;

  const greetingObservationCount =
    typeof greetingObservationCountRaw === "number" && Number.isFinite(greetingObservationCountRaw)
      ? Math.max(0, Math.floor(greetingObservationCountRaw))
      : null;

  return {
    formality,
    tone,
    emoji_level: emojiLevel,
    punctuation_style: punctuationStyle,
    preferred_greeting: preferredGreeting,
    greeting_confidence: greetingConfidence,
    greeting_observation_count: greetingObservationCount,
  };
}

function sanitizeExtractionItem(input: unknown): CoachMemoryExtractionItem | null {
  const raw = toObject(input);
  if (!raw) {
    return null;
  }

  const memoryTypeRaw = raw.memoryType;
  if (typeof memoryTypeRaw !== "string" || !MEMORY_TYPES.has(memoryTypeRaw as TrainingPeaksStudentMemoryType)) {
    return null;
  }
  const memoryType = memoryTypeRaw as CoachMemoryExtractionMemoryType;

  const summaryText = toTrimmedString(raw.summaryText, 200);
  if (!summaryText) {
    return null;
  }

  const structured = toObject(raw.structured) ?? {};
  const normalizedStructured =
    memoryType === "communication_style" ? sanitizeCommunicationStyleStructured(structured) : structured;

  const confidence = clamp01(typeof raw.confidence === "number" ? raw.confidence : 0.5);
  const validFrom = toSafeDate(raw.validFrom);
  const validUntil = toSafeDate(raw.validUntil);

  const affectsPlanning = raw.affectsPlanning === true;
  const requiresCoachAttention = raw.requiresCoachAttention === true;
  const notificationLevel =
    typeof raw.notificationLevel === "string" && NOTIFICATION_LEVELS.has(raw.notificationLevel as CoachMemoryExtractionNotificationLevel)
      ? (raw.notificationLevel as CoachMemoryExtractionNotificationLevel)
      : "digest";

  const supersedesHintRaw = toObject(raw.supersedesHint);
  const supersedesReasonRaw = supersedesHintRaw?.reason;
  const supersedesTargetRaw = supersedesHintRaw?.targetMemoryType;
  const supersedesReason =
    typeof supersedesReasonRaw === "string" && SUPERSEDES_REASONS.has(supersedesReasonRaw as "resolved" | "updated" | "contradicted")
      ? (supersedesReasonRaw as "resolved" | "updated" | "contradicted")
      : null;
  const supersedesTarget =
    typeof supersedesTargetRaw === "string" && MEMORY_TYPES.has(supersedesTargetRaw as TrainingPeaksStudentMemoryType)
      ? (supersedesTargetRaw as CoachMemoryExtractionMemoryType)
      : null;

  return {
    memoryType,
    summaryText,
    structured: normalizedStructured,
    validFrom,
    validUntil,
    confidence,
    affectsPlanning,
    requiresCoachAttention,
    notificationLevel,
    supersedesHint: {
      reason: supersedesReason,
      targetMemoryType: supersedesTarget,
    },
  };
}

function sanitizeCaseCandidate(input: unknown): CoachMemoryExtractionResult["caseCandidate"] {
  const raw = toObject(input);
  if (!raw) {
    return null;
  }

  const kindRaw = raw.kind;
  const priorityRaw = raw.priority;

  const kind =
    typeof kindRaw === "string" && CASE_KINDS.has(kindRaw as NonNullable<CoachMemoryExtractionResult["caseCandidate"]>["kind"])
      ? (kindRaw as NonNullable<CoachMemoryExtractionResult["caseCandidate"]>["kind"])
      : null;
  const priority =
    typeof priorityRaw === "string" && CASE_PRIORITIES.has(priorityRaw as NonNullable<CoachMemoryExtractionResult["caseCandidate"]>["priority"])
      ? (priorityRaw as NonNullable<CoachMemoryExtractionResult["caseCandidate"]>["priority"])
      : null;

  if (!kind && !priority) {
    return null;
  }

  return { kind, priority };
}

function buildSystemPrompt(referenceDate: string): string {
  return [
    "Ты извлекаешь долговременную память тренера (Coach Memory v1) из наблюдений о студенте.",
    "Верни ТОЛЬКО строгий JSON без markdown, без комментариев и без дополнительного текста.",
    "Дата отсчета: " + referenceDate + ".",
    "",
    "Разрешенные memoryType:",
    "- communication_style",
    "- schedule_constraint",
    "- availability_preference",
    "- pain_or_injury",
    "- health_status",
    "- emotional_state",
    "- load_tolerance",
    "- planning_preference",
    "- race_or_goal",
    "- travel_or_life_event",
    "- equipment_or_device_note",
    "",
    "Ключевое различие:",
    "- Durable memory: факт, который должен влиять на будущие ответы тренера, будущий план или будущие решения.",
    "- Operational request: разовая просьба/вопрос, который может стать caseCandidate, но обычно НЕ память.",
    "",
    "Запоминать ТОЛЬКО durable memory:",
    "1) ограничения по расписанию / доступность (особенно повторяющиеся или на период)",
    "2) боль/травма/болезнь/физические симптомы",
    "3) эмоциональное состояние/переносимость нагрузки при явной значимости",
    "4) устойчивые предпочтения планирования",
    "5) старт/цель",
    "6) поездки/жизненные события, влияющие на тренировки",
    "7) ограничения по устройствам/экипировке",
    "8) communication_style только при надежном evidence coach-to-student",
    "",
    "НЕ запоминать:",
    "- простые подтверждения и благодарности",
    "- шутки и casual small talk",
    "- одноразовые фразы без будущей ценности",
    "- общие комментарии без практического влияния",
    "- дубли без новых деталей",
    "- шум о третьих лицах",
    "- разовые запросы на перенос без устойчивого ограничения",
    "- вопросы о расписании без факта ограничения",
    "",
    "Operational request examples (обычно caseCandidate, НЕ memory):",
    "- 'перенеси бег на завтра'",
    "- 'можно завтра?'",
    "- 'попробую завтра'",
    "- 'интересуюсь расписанием на субботу'",
    "- 'из-за дождя сегодня не побегу, перенесу на завтра'",
    "- Для таких случаев memoryItems обычно пустой, если нет явного повторяющегося ограничения/предпочтения.",
    "",
    "Правила:",
    "- summaryText на русском, коротко, <=200 символов.",
    "- Не выдумывай факты.",
    "- Если данных мало/неясно: shouldRemember=false.",
    "- Уверенность отражает неопределенность (0..1).",
    "- Ограничения расписания/поездки: укажи validFrom/validUntil если возможно.",
    "- Долгие предпочтения: validUntil=null.",
    "- communication_style НЕ создавай из одного inbound-сообщения ученика.",
    "- communication_style допустим только при явном coach-to-student evidence или явном контексте стиля тренера.",
    "- pain_or_injury не создавай для нефизического дискомфорта (телефон, одежда, погода, обувь без боли в теле).",
    "- Болезнь/простуда/температура/кашель/горло без явной боли в опорно-двигательном аппарате => health_status (НЕ pain_or_injury).",
    "- schedule_constraint создавай только при недоступности/ограничении/изменении графика/жизненном конфликте.",
    "- schedule_constraint НЕ создавай для 'просто спросил расписание' или 'разово перенести на завтра' без ограничения.",
    "- race_or_goal создавай только при явном будущем старте/цели/подготовке; рефлексия типа 'слишком много марафонов' без будущей цели не race_or_goal.",
    "- immediate только для pain_or_injury, health_status, тяжелого/повторяющегося load_tolerance, или срочного near-term конфликта расписания.",
    "- digest для не-срочных schedule/life/race/emotion.",
    "- silent для стабильных planning_preference, equipment_or_device_note, communication_style.",
    "",
    "Критично про greeting style:",
    "- 'Привет, Игорь' от ученика сам по себе обычно НЕ является coach greeting style.",
    "- preferred_greeting выводи только если явное подтверждение coach-to-student стиля или надежный контекст.",
    "- Если доказательств мало: preferred_greeting=null и не придумывай.",
    "",
    "Примеры:",
    "- 'На следующей неделе во вторник не смогу бегать' -> schedule_constraint, affectsPlanning=true.",
    "- 'Длительную лучше ставить на субботу' -> availability_preference/planning_preference.",
    "- 'Болит колено' -> pain_or_injury, immediate.",
    "- 'Мне третий раз тяжело на этой нагрузке' -> load_tolerance.",
    "",
    "JSON schema:",
    JSON.stringify(
      {
        shouldRemember: true,
        memoryItems: [
          {
            memoryType: "schedule_constraint",
            summaryText: "Со следующей недели во вторник не может бегать.",
            structured: {
              note: "optional",
            },
            validFrom: "YYYY-MM-DD or null",
            validUntil: "YYYY-MM-DD or null",
            confidence: 0.0,
            affectsPlanning: true,
            requiresCoachAttention: false,
            notificationLevel: "immediate|digest|silent|ignore",
            supersedesHint: {
              reason: "resolved|updated|contradicted|null",
              targetMemoryType: "memoryType|null",
            },
          },
        ],
        caseCandidate: {
          kind: "pain_or_health_signal|question_to_coach|move_workout_needs_review|observation_only|null",
          priority: "urgent|normal|low|null",
        },
        reason: "Короткое объяснение.",
      },
      null,
      2
    ),
    "",
    "Для communication_style structured используй:",
    JSON.stringify(
      {
        formality: "ty|vy|unknown",
        tone: "warm|neutral|direct|formal",
        emoji_level: "none|low|moderate|high",
        punctuation_style: "standard|minimal|expressive",
        preferred_greeting: "string|null",
        greeting_confidence: 0.0,
        greeting_observation_count: 0,
      },
      null,
      2
    ),
  ].join("\n");
}

function buildUserPrompt(input: ExtractionInput): string {
  const preview = input.observationPreview.trim().slice(0, 500);
  const labels = input.observationLabels.slice(0, 15);
  const activeMemory = (input.currentActiveMemoryItems ?? []).slice(0, 12).map((item) => ({
    memoryType: item.memoryType,
    summaryText: item.summaryText?.slice(0, 160),
    structured: item.structured ?? {},
    validUntil: item.validUntil ?? null,
  }));

  return [
    "Наблюдение для оценки:",
    JSON.stringify(
      {
        studentName: input.studentName.trim().slice(0, 80),
        sourceType: input.sourceType ?? "unknown",
        observedAt: input.observedAt,
        labels,
        observationPreview: preview,
      },
      null,
      2
    ),
    "",
    "Текущая активная память (если есть):",
    JSON.stringify(activeMemory, null, 2),
  ].join("\n");
}

export async function extractCoachMemoryItemsDryRun(input: ExtractionInput): Promise<CoachMemoryExtractionResult> {
  const dryRunGuardEnabled = process.env[DRY_RUN_GUARD_ENV] === "1";
  if (!dryRunGuardEnabled) {
    return {
      shouldRemember: false,
      memoryItems: [],
      caseCandidate: null,
      reason: "AI extractor disabled outside dry-run guard.",
    };
  }

  return extractCoachMemoryItems(input);
}

async function extractCoachMemoryItems(input: ExtractionInput): Promise<CoachMemoryExtractionResult> {

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return {
      shouldRemember: false,
      memoryItems: [],
      caseCandidate: null,
      reason: "OPENAI_API_KEY is missing.",
    };
  }

  const referenceDate = (input.referenceDate ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
  const systemPrompt = buildSystemPrompt(referenceDate);
  const userPrompt = buildUserPrompt(input);

  let content: string | null = null;
  const candidateModels = resolveCandidateModels();
  const attemptErrors: string[] = [];
  for (const model of candidateModels) {
    try {
      const response = await fetch(OPENAI_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
      });

      if (!response.ok) {
        attemptErrors.push(`${model}:HTTP_${response.status}`);
        continue;
      }

      const payload = (await response.json()) as OpenAiChatResponse;
      content = payload.choices?.[0]?.message?.content?.trim() ?? null;
      if (!content) {
        attemptErrors.push(`${model}:empty_response`);
        continue;
      }
      break;
    } catch {
      attemptErrors.push(`${model}:request_failed`);
    }
  }

  if (!content) {
    return {
      shouldRemember: false,
      memoryItems: [],
      caseCandidate: null,
      reason: `OpenAI request failed for all models: ${attemptErrors.join(",") || "unknown_error"}`,
    };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(extractJsonOnly(content)) as Record<string, unknown>;
  } catch {
    return {
      shouldRemember: false,
      memoryItems: [],
      caseCandidate: null,
      reason: "Failed to parse OpenAI JSON response.",
    };
  }

  const shouldRemember = parsed.shouldRemember === true;
  const rawItems = Array.isArray(parsed.memoryItems) ? parsed.memoryItems : [];
  const sanitizedItems = rawItems.map(sanitizeExtractionItem).filter((item): item is CoachMemoryExtractionItem => Boolean(item));
  const guarded = applyDryRunMemoryGuards(sanitizedItems, input);
  const memoryItems = guarded.memoryItems;
  const caseCandidate = guarded.forcedCaseCandidate ?? sanitizeCaseCandidate(parsed.caseCandidate);
  const reason = toTrimmedString(parsed.reason, 240) ?? "No reason provided.";

  if (!shouldRemember) {
    return {
      shouldRemember: false,
      memoryItems: [],
      caseCandidate,
      reason,
    };
  }

  if (memoryItems.length === 0) {
    return {
      shouldRemember: false,
      memoryItems: [],
      caseCandidate,
      reason: `Model returned shouldRemember=true but no valid memory items. ${reason}`,
    };
  }

  return {
    shouldRemember: true,
    memoryItems,
    caseCandidate,
    reason,
  };
}

export async function processCoachMemoryForObservation(
  input: ProcessCoachMemoryForObservationInput
): Promise<ProcessCoachMemoryForObservationResult> {
  if (!isCoachMemoryExtractionEnabled()) {
    return {
      status: "disabled",
      inserted: 0,
      touched: 0,
      skipped: 0,
      belowConfidence: 0,
      duplicate: 0,
      reason: "COACH_MEMORY_EXTRACTION_ENABLED is not true.",
    };
  }

  const extraction =
    input.precomputedExtraction ??
    (await extractCoachMemoryItems({
      studentName: input.studentName,
      observationPreview: input.textPreview ?? "",
      observationLabels: input.labels,
      sourceType: input.sourceType,
      observedAt: input.observedAt,
      currentActiveMemoryItems: input.currentActiveMemoryItems.map((item) => ({
        memoryType: item.memoryType,
        summaryText: item.summaryText,
        structured: item.structured,
        validUntil: item.validUntil,
      })),
    }));

  if (!extraction.shouldRemember || extraction.memoryItems.length === 0) {
    return {
      status: "no_memory",
      inserted: 0,
      touched: 0,
      skipped: extraction.memoryItems.length,
      belowConfidence: 0,
      duplicate: 0,
      reason: extraction.reason,
    };
  }

  const minConfidence = getCoachMemoryMinConfidence();
  const observationText = normalizeForRules(input.textPreview ?? "");
  const labels = input.labels.map((label) => label.toLowerCase());
  const sourceType = (input.sourceType ?? "").toLowerCase();
  const inboundBusinessDm = sourceType === "business_dm";
  const applyWrites = input.applyWrites ?? true;
  const referenceDate = input.observedAt;

  const exactByTypeAndSummary = new Map<string, ProcessCoachMemoryForObservationInput["currentActiveMemoryItems"][number]>();
  const structuredByTypeAndKey = new Map<string, ProcessCoachMemoryForObservationInput["currentActiveMemoryItems"][number]>();
  for (const activeItem of input.currentActiveMemoryItems) {
    const normalizedSummary = normalizeSummaryForDedupe(activeItem.summaryText);
    if (normalizedSummary) {
      exactByTypeAndSummary.set(`${activeItem.memoryType}:${normalizedSummary}`, activeItem);
    }
    const structuredKey = buildStructuredDedupeKey(activeItem.memoryType, activeItem.structured);
    if (structuredKey) {
      structuredByTypeAndKey.set(structuredKey, activeItem);
    }
  }

  let inserted = 0;
  let touched = 0;
  let skipped = 0;
  let belowConfidence = 0;
  let duplicate = 0;

  for (const rawItem of extraction.memoryItems) {
    const adjustedItem = applyConservativeMemoryRules(rawItem, observationText, referenceDate.slice(0, 10));
    if (!adjustedItem) {
      skipped += 1;
      continue;
    }
    if (adjustedItem.confidence < minConfidence) {
      skipped += 1;
      belowConfidence += 1;
      continue;
    }
    if (!MEMORY_TYPES.has(adjustedItem.memoryType)) {
      skipped += 1;
      continue;
    }
    if (!adjustedItem.summaryText.trim()) {
      skipped += 1;
      continue;
    }
    if (isPastDate(adjustedItem.validUntil, referenceDate)) {
      skipped += 1;
      continue;
    }
    if (adjustedItem.memoryType === "communication_style" && inboundBusinessDm) {
      const hasCoachStyleEvidenceLabel = labels.some(
        (label) => label.includes("coach_outgoing") || label.includes("coach_style")
      );
      if (!hasCoachStyleEvidenceLabel) {
        skipped += 1;
        continue;
      }
    }
    if (
      adjustedItem.memoryType === "schedule_constraint" &&
      isOneOffMoveRequest(observationText) &&
      !looksLikeDurableScheduleConstraint(observationText)
    ) {
      skipped += 1;
      continue;
    }
    if (
      adjustedItem.memoryType === "availability_preference" &&
      looksLikeOperationalTrainingStartsTomorrow(observationText) &&
      !looksLikeDurableScheduleConstraint(observationText) &&
      !looksLikeDurableAvailabilityPreference(observationText)
    ) {
      skipped += 1;
      continue;
    }

    const normalizedSummary = normalizeSummaryForDedupe(adjustedItem.summaryText);
    const exactKey = `${adjustedItem.memoryType}:${normalizedSummary}`;
    const exactDuplicate = exactByTypeAndSummary.get(exactKey);
    if (exactDuplicate) {
      if (applyWrites) {
        await touchTrainingPeaksStudentMemoryItem(exactDuplicate.id, {
          validUntil: pickTouchedValidUntil(exactDuplicate.validUntil, adjustedItem.validUntil),
        });
      }
      touched += 1;
      duplicate += 1;
      continue;
    }

    const structuredKey = buildStructuredDedupeKey(adjustedItem.memoryType, adjustedItem.structured);
    const structuredDuplicate = structuredKey ? structuredByTypeAndKey.get(structuredKey) : null;
    if (structuredDuplicate) {
      if (applyWrites) {
        await touchTrainingPeaksStudentMemoryItem(structuredDuplicate.id, {
          validUntil: pickTouchedValidUntil(structuredDuplicate.validUntil, adjustedItem.validUntil),
        });
      }
      touched += 1;
      duplicate += 1;
      continue;
    }

    if (applyWrites) {
      const insertedItem = await insertTrainingPeaksStudentMemoryItem({
        studentId: input.studentId,
        memoryType: adjustedItem.memoryType,
        summaryText: adjustedItem.summaryText,
        structured: adjustedItem.structured,
        source: "ai_extraction",
        confidence: adjustedItem.confidence,
        validFrom: adjustedItem.validFrom,
        validUntil: adjustedItem.validUntil,
        sourceObservationId: input.observationId,
        sourceMessagePreview: input.textPreview?.slice(0, 160) ?? null,
        metadata: {
          affects_planning: adjustedItem.affectsPlanning,
          requires_coach_attention: adjustedItem.requiresCoachAttention,
          notification_level: adjustedItem.notificationLevel,
        },
      });
      exactByTypeAndSummary.set(exactKey, insertedItem);
      if (structuredKey) {
        structuredByTypeAndKey.set(structuredKey, insertedItem);
      }
    }
    inserted += 1;
  }

  return {
    status: "processed",
    inserted,
    touched,
    skipped,
    belowConfidence,
    duplicate,
    reason: extraction.reason,
    applyWrites,
  };
}
