import type { TrainingPeaksStudentMemoryType } from "@/features/trainingpeaks/repository";

const OPENAI_API_URL = process.env.OPENAI_API_URL?.trim() || "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = process.env.OPENAI_COACH_MEMORY_MODEL?.trim() || "gpt-5.5";
const DRY_RUN_GUARD_ENV = "COACH_MEMORY_AI_DRY_RUN_MODE";

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

type OpenAiChatResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
};

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
    "Запоминать ТОЛЬКО:",
    "1) стиль коммуникации / приветствие / ты-вы / тон",
    "2) ограничения по расписанию / доступность",
    "3) боль / дискомфорт / травма / здоровье",
    "4) эмоциональное состояние / усталость / мотивация / переносимость нагрузки",
    "5) устойчивые предпочтения планирования",
    "6) старт/цель",
    "7) поездки/жизненные события",
    "8) ограничения по устройствам/экипировке",
    "",
    "НЕ запоминать:",
    "- простые подтверждения и благодарности",
    "- шутки и casual small talk",
    "- одноразовые фразы без будущей ценности",
    "- общие комментарии без практического влияния",
    "- дубли без новых деталей",
    "- шум о третьих лицах",
    "",
    "Правила:",
    "- summaryText на русском, коротко, <=200 символов.",
    "- Не выдумывай факты.",
    "- Если данных мало/неясно: shouldRemember=false.",
    "- Уверенность отражает неопределенность (0..1).",
    "- Ограничения расписания/поездки: укажи validFrom/validUntil если возможно.",
    "- Долгие предпочтения: validUntil=null.",
    "- pain_or_injury / health_status обычно requiresCoachAttention=true и notificationLevel=immediate.",
    "- communication_style обычно notificationLevel=silent.",
    "- planning_preference обычно silent или digest.",
    "- emotional_state обычно digest, immediate только если повтор/серьезность.",
    "- load_tolerance immediate только при повторе/серьезности.",
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
  const memoryItems = rawItems.map(sanitizeExtractionItem).filter((item): item is CoachMemoryExtractionItem => Boolean(item));
  const caseCandidate = sanitizeCaseCandidate(parsed.caseCandidate);
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
