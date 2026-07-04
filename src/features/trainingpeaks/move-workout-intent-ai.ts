import { listKnownWorkoutAliasesForAiPrompt } from "@/features/trainingpeaks/workout-reference";
import { logAiCall } from "@/features/trainingpeaks/ai-call-log";

export type TrainingPeaksAiIntentKind = "move_workout" | "none" | "unknown";

export type TrainingPeaksAiWorkoutReferenceKind =
  | "long_run"
  | "tempo"
  | "intervals"
  | "easy_run"
  | "workout"
  | "strength"
  | "bike"
  | "swim"
  | "unknown";

export type TrainingPeaksAiDateReferenceKind = "date" | "relative" | "unknown";

export type TrainingPeaksAiWorkoutReference = {
  kind: TrainingPeaksAiWorkoutReferenceKind;
  text: string | null;
  confidence: number;
};

export type TrainingPeaksAiDateReference = {
  kind: TrainingPeaksAiDateReferenceKind;
  value: string | null;
  text: string | null;
  confidence: number;
};

export type TrainingPeaksAiIntentClassification = {
  intent: TrainingPeaksAiIntentKind;
  workout_reference: TrainingPeaksAiWorkoutReference;
  target_date: TrainingPeaksAiDateReference;
  source_date: TrainingPeaksAiDateReference | null;
  confidence: number;
  needs_clarification: boolean;
  clarification_reason: string | null;
  reasoning_summary: string;
};

export type ClassifyTrainingPeaksMoveIntentInput = {
  normalizedText: string;
  textPreview: string;
  studentLinked: boolean;
  timezone?: string;
  baseDate?: Date;
  _logCtx?: { messageId?: string | null; studentRef?: string | null };
};

export type ClassifyTrainingPeaksMoveIntentResult =
  | {
      ok: true;
      classification: TrainingPeaksAiIntentClassification;
      model: string;
    }
  | {
      ok: false;
      error: string;
    };

const CLAUDE_MODEL = process.env.MOVE_INTENT_MODEL?.trim() || "claude-haiku-4-5-20251001";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const ALLOWED_INTENTS = new Set<TrainingPeaksAiIntentKind>(["move_workout", "none", "unknown"]);
const ALLOWED_WORKOUT_KINDS = new Set<TrainingPeaksAiWorkoutReferenceKind>([
  "long_run",
  "tempo",
  "intervals",
  "easy_run",
  "workout",
  "strength",
  "bike",
  "swim",
  "unknown",
]);
const ALLOWED_DATE_KINDS = new Set<TrainingPeaksAiDateReferenceKind>(["date", "relative", "unknown"]);

function clampConfidence(value: unknown, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}

function sanitizeNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function sanitizeDateReference(value: unknown): TrainingPeaksAiDateReference | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw = value as { kind?: unknown; value?: unknown; text?: unknown; confidence?: unknown };
  if (typeof raw.kind !== "string" || !ALLOWED_DATE_KINDS.has(raw.kind as TrainingPeaksAiDateReferenceKind)) {
    return null;
  }

  return {
    kind: raw.kind as TrainingPeaksAiDateReferenceKind,
    value: sanitizeNullableString(raw.value),
    text: sanitizeNullableString(raw.text),
    confidence: clampConfidence(raw.confidence, 0),
  };
}

function sanitizeWorkoutReference(value: unknown): TrainingPeaksAiWorkoutReference | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw = value as { kind?: unknown; text?: unknown; confidence?: unknown };
  if (typeof raw.kind !== "string" || !ALLOWED_WORKOUT_KINDS.has(raw.kind as TrainingPeaksAiWorkoutReferenceKind)) {
    return null;
  }

  return {
    kind: raw.kind as TrainingPeaksAiWorkoutReferenceKind,
    text: sanitizeNullableString(raw.text),
    confidence: clampConfidence(raw.confidence, 0),
  };
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

export function parseTrainingPeaksAiIntentClassification(
  rawJson: unknown
): { ok: true; classification: TrainingPeaksAiIntentClassification } | { ok: false; error: string } {
  if (!rawJson || typeof rawJson !== "object") {
    return { ok: false, error: "invalid_json_object" };
  }

  const raw = rawJson as {
    intent?: unknown;
    workout_reference?: unknown;
    target_date?: unknown;
    source_date?: unknown;
    confidence?: unknown;
    needs_clarification?: unknown;
    clarification_reason?: unknown;
    reasoning_summary?: unknown;
  };

  if (typeof raw.intent !== "string" || !ALLOWED_INTENTS.has(raw.intent as TrainingPeaksAiIntentKind)) {
    return { ok: false, error: "invalid_intent" };
  }

  const workoutReference = sanitizeWorkoutReference(raw.workout_reference);
  if (!workoutReference) {
    return { ok: false, error: "invalid_workout_reference" };
  }

  const targetDate = sanitizeDateReference(raw.target_date);
  if (!targetDate) {
    return { ok: false, error: "invalid_target_date" };
  }

  const sourceDate =
    raw.source_date === null || raw.source_date === undefined
      ? null
      : sanitizeDateReference(raw.source_date);
  if (raw.source_date !== null && raw.source_date !== undefined && !sourceDate) {
    return { ok: false, error: "invalid_source_date" };
  }

  const confidence = clampConfidence(raw.confidence, 0);
  const reasoningSummary = sanitizeNullableString(raw.reasoning_summary);
  if (!reasoningSummary) {
    return { ok: false, error: "missing_reasoning_summary" };
  }

  return {
    ok: true,
    classification: {
      intent: raw.intent as TrainingPeaksAiIntentKind,
      workout_reference: workoutReference,
      target_date: targetDate,
      source_date: sourceDate,
      confidence,
      needs_clarification: raw.needs_clarification === true,
      clarification_reason: sanitizeNullableString(raw.clarification_reason),
      reasoning_summary: reasoningSummary,
    },
  };
}

export function buildTrainingPeaksAiIntentLogFields(input: {
  result: ClassifyTrainingPeaksMoveIntentResult;
}): {
  aiIntent: Record<string, unknown> | null;
  aiConfidence: number | null;
  metadata: Record<string, unknown>;
} {
  const metadata: Record<string, unknown> = {
    ai_mode: "log_only",
  };

  if (!input.result.ok) {
    metadata.ai_error = input.result.error;
    return {
      aiIntent: null,
      aiConfidence: null,
      metadata,
    };
  }

  metadata.ai_model = input.result.model;

  return {
    aiIntent: input.result.classification as unknown as Record<string, unknown>,
    aiConfidence: input.result.classification.confidence,
    metadata,
  };
}

export async function classifyTrainingPeaksMoveIntentWithAi(
  input: ClassifyTrainingPeaksMoveIntentInput
): Promise<ClassifyTrainingPeaksMoveIntentResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, error: "missing_anthropic_api_key" };
  }

  // Resolve by student timezone when provided; fall back to Moscow (audience default).
  // Belgrade is the coach timezone and must NOT be used here — "завтра" is tomorrow for the student.
  // When trainingpeaks_students.timezone column is added, pass it via input.timezone at call sites.
  const timezone = input.timezone?.trim() || "Europe/Moscow";
  const baseDate = input.baseDate ?? new Date();
  const todayInTz = new Intl.DateTimeFormat("sv-SE", { timeZone: timezone }).format(baseDate);
  const schemaHint = {
    intent: "move_workout|none|unknown",
    workout_reference: {
      kind: "long_run|tempo|intervals|easy_run|workout|strength|bike|swim|unknown",
      text: "string|null",
      confidence: 0.0,
    },
    target_date: {
      kind: "date|relative|unknown",
      value: "string|null",
      text: "string|null",
      confidence: 0.0,
    },
    source_date: {
      kind: "date|relative|unknown",
      value: "string|null",
      text: "string|null",
      confidence: 0.0,
    },
    confidence: 0.0,
    needs_clarification: false,
    clarification_reason: "string|null",
    reasoning_summary: "string",
  };

  const prompt = [
    "Ты классификатор русских Telegram-сообщений ученика тренера по бегу.",
    "Определи, просит ли ученик перенести тренировку в TrainingPeaks.",
    "Верни только JSON без markdown и без пояснений.",
    "Если это отчет, эмоция, casual chat или просто упоминание тренировки без просьбы перенести — intent=none.",
    "Если сообщение не про расписание/тренировки — intent=none.",
    "Если intent неясен — intent=unknown или needs_clarification=true.",
    "Не выдумывай даты. value для date — ISO YYYY-MM-DD, для relative — tomorrow|today|monday|...",
    `Текущая дата: ${todayInTz}; timezone: ${timezone}.`,
    `Ученик привязан к TrainingPeaks: ${input.studentLinked ? "yes" : "no"}.`,
    `Известные алиасы тренировок: ${listKnownWorkoutAliasesForAiPrompt()}.`,
    `Схема: ${JSON.stringify(schemaHint)}.`,
    `normalized_text: ${input.normalizedText}`,
    `text_preview: ${input.textPreview}`,
  ].join("\n");

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 512,
        system: "Return strict JSON only.",
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      return { ok: false, error: `anthropic_http_${response.status}` };
    }

    const payload = (await response.json()) as {
      content?: Array<{ type: string; text: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = payload.content?.find((b) => b.type === "text")?.text?.trim();
    if (!text) {
      return { ok: false, error: "empty_anthropic_response" };
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(extractJsonOnly(text));
    } catch {
      return { ok: false, error: "json_parse_failed" };
    }

    const parsed = parseTrainingPeaksAiIntentClassification(parsedJson);
    if (!parsed.ok) {
      return { ok: false, error: parsed.error };
    }

    logAiCall({
      callSite: "intent",
      model: CLAUDE_MODEL,
      labels: [],
      inputTokens: payload.usage?.input_tokens ?? null,
      outputTokens: payload.usage?.output_tokens ?? null,
      messageId: input._logCtx?.messageId ?? null,
      studentRef: input._logCtx?.studentRef ?? null,
    });

    return {
      ok: true,
      classification: parsed.classification,
      model: CLAUDE_MODEL,
    };
  } catch {
    return { ok: false, error: "anthropic_request_failed" };
  }
}
