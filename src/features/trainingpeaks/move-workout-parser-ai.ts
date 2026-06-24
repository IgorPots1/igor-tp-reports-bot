import type {
  ParsedTrainingPeaksMoveWorkoutPayload,
  TrainingPeaksMoveWorkoutDescriptor,
  TrainingPeaksMoveWorkoutTimeRef,
} from "@/features/trainingpeaks/service";

type AiFallbackPayload = Omit<ParsedTrainingPeaksMoveWorkoutPayload, "actionType" | "parser">;

const AI_MODEL = process.env.OPENAI_MOVE_WORKOUT_PARSER_MODEL?.trim() || "gpt-4o-mini";
const OPENAI_API_URL = process.env.OPENAI_API_URL?.trim() || "https://api.openai.com/v1/chat/completions";

function sanitizeTimeRef(value: unknown): TrainingPeaksMoveWorkoutTimeRef | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as { kind?: unknown; value?: unknown; sourceText?: unknown };
  if (
    (raw.kind !== "date" && raw.kind !== "weekday" && raw.kind !== "relative_day") ||
    typeof raw.value !== "string" ||
    typeof raw.sourceText !== "string"
  ) {
    return null;
  }
  return {
    kind: raw.kind,
    value: raw.value.trim(),
    sourceText: raw.sourceText.trim(),
  };
}

function sanitizeWorkoutDescriptor(value: unknown): TrainingPeaksMoveWorkoutDescriptor | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as { raw?: unknown; type?: unknown; confidence?: unknown };
  if (typeof raw.raw !== "string" || typeof raw.type !== "string" || typeof raw.confidence !== "number") {
    return null;
  }
  if (!["easy_run", "interval", "tempo", "long_run", "run", "unknown"].includes(raw.type)) {
    return null;
  }
  return {
    raw: raw.raw.trim(),
    type: raw.type as TrainingPeaksMoveWorkoutDescriptor["type"],
    confidence: Math.max(0, Math.min(1, Number(raw.confidence.toFixed(2)))),
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

export async function parseMoveWorkoutWithAiFallback(
  rawText: string,
  // Pass the student's timezone when available (trainingpeaks_students.timezone, column not yet in DB).
  // Falls back to Moscow — the audience default. Do NOT pass the coach timezone (Belgrade).
  studentTimezone?: string
): Promise<AiFallbackPayload | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  const now = new Date();
  const timezone = studentTimezone?.trim() || "Europe/Moscow";
  const todayInTz = new Intl.DateTimeFormat("sv-SE", { timeZone: timezone }).format(now);
  const schemaHint = {
    source: { kind: "date|weekday|relative_day", value: "string", sourceText: "string" },
    target: { kind: "date|weekday|relative_day", value: "string", sourceText: "string" },
    workoutDescriptor: {
      raw: "string",
      type: "easy_run|interval|tempo|long_run|run|unknown",
      confidence: 0.0,
    },
    confidence: 0.0,
    needsClarification: false,
    clarificationReason: "string|null",
  };

  const prompt = [
    "Ты парсер русских сообщений для действия move_workout.",
    "Верни только JSON без markdown и без пояснений.",
    "Если target неясен или есть несколько целей, needsClarification=true и clarificationReason.",
    "Не выдумывай данные. Если source непонятен, source=null.",
    "Если дата ('вчера', 'сегодня') указана как причина/контекст (например, 'вчера был хайкинг'), а не как исходная дата тренировки, ставь source=null.",
    `Текущая дата: ${todayInTz}; timezone: ${timezone}.`,
    `Схема: ${JSON.stringify(schemaHint)}.`,
    `Сообщение: ${rawText}`,
  ].join("\n");

  try {
    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: AI_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "Return strict JSON only.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const text = payload.choices?.[0]?.message?.content?.trim();
    if (!text) {
      return null;
    }
    const parsed = JSON.parse(extractJsonOnly(text)) as {
      source?: unknown;
      target?: unknown;
      workoutDescriptor?: unknown;
      confidence?: unknown;
      needsClarification?: unknown;
      clarificationReason?: unknown;
    };

    const source = sanitizeTimeRef(parsed.source);
    const target = sanitizeTimeRef(parsed.target);
    if (!target) {
      return null;
    }

    return {
      source,
      target,
      workoutDescriptor: sanitizeWorkoutDescriptor(parsed.workoutDescriptor),
      confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
      needsClarification: parsed.needsClarification === true,
      clarificationReason:
        typeof parsed.clarificationReason === "string" ? parsed.clarificationReason : parsed.needsClarification ? "ambiguous request" : null,
      sourceDate: source?.kind === "date" ? source.value : undefined,
      source_date: source?.kind === "date" ? source.value : undefined,
    };
  } catch {
    return null;
  }
}
