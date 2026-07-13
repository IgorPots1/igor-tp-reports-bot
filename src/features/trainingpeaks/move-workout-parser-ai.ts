import type {
  ParsedTrainingPeaksMoveWorkoutPayload,
  TrainingPeaksMoveWorkoutDescriptor,
  TrainingPeaksMoveWorkoutTimeRef,
} from "@/features/trainingpeaks/service";
import * as aiCallLogModule from "@/features/trainingpeaks/ai-call-log";

// CJS/ESM boundary workaround: a plain named import of this file can
// intermittently lose named exports when first reached via a named import
// from Node's native TS stripping (order-dependent — see
// tools/trainingpeaks-export/scripts/tp-actions-once.ts for the established
// namespace + .default fallback pattern this mirrors).
type NamespaceWithOptionalDefault<T> = T & { default?: T };
const aiCallLogModuleCompat = aiCallLogModule as NamespaceWithOptionalDefault<typeof aiCallLogModule>;
const logAiCall = aiCallLogModuleCompat.logAiCall ?? aiCallLogModuleCompat.default?.logAiCall;

if (typeof logAiCall !== "function") {
  throw new Error("ai-call-log.logAiCall is unavailable.");
}

type AiFallbackPayload = Omit<ParsedTrainingPeaksMoveWorkoutPayload, "actionType" | "parser">;

const CLAUDE_MODEL = process.env.MOVE_INTENT_MODEL?.trim() || "claude-haiku-4-5-20251001";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

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

const VALID_WORKOUT_DESCRIPTOR_TYPES = [
  "easy_run",
  "interval",
  "tempo",
  "long_run",
  "run",
  "strength",
  "bike",
  "swim",
  "unknown",
];

function sanitizeWorkoutDescriptor(value: unknown): TrainingPeaksMoveWorkoutDescriptor | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as { raw?: unknown; type?: unknown; confidence?: unknown };
  if (typeof raw.raw !== "string" || typeof raw.type !== "string" || typeof raw.confidence !== "number") {
    return null;
  }
  if (!VALID_WORKOUT_DESCRIPTOR_TYPES.includes(raw.type)) {
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
  studentTimezone?: string,
  _logCtx?: { messageId?: string | null; studentRef?: string | null }
): Promise<AiFallbackPayload | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
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
      type: "easy_run|interval|tempo|long_run|run|strength|bike|swim|unknown",
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
      return null;
    }
    const payload = (await response.json()) as {
      content?: Array<{ type: string; text: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    logAiCall({
      callSite: "parser",
      model: CLAUDE_MODEL,
      labels: [],
      inputTokens: payload.usage?.input_tokens ?? null,
      outputTokens: payload.usage?.output_tokens ?? null,
      messageId: _logCtx?.messageId ?? null,
      studentRef: _logCtx?.studentRef ?? null,
    });
    const text = payload.content?.find((b) => b.type === "text")?.text?.trim();
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

// ── Calendar-aware source selection ──────────────────────────────────────────
// The plain parser (above) only sees the message text and leaves source=null when
// the student does not name a workout ("перенесите на субботу, сегодня плохо").
// This selector additionally sees the student's planned calendar and decides which
// concrete workout to move — the pragmatic leap the runner's arithmetic could not make
// ("сегодня плохо" → move TODAY's planned workout). It NEVER executes: the choice still
// goes through the coach card → confirmation → dry-run → execution, with all gates intact.

export type MoveSourceCalendarWorkout = {
  workoutId: number;
  date: string; // ISO YYYY-MM-DD
  type: string | null;
  title: string | null;
  isToday: boolean;
};

// What KIND of request this is, judged against the actual plan (not by keywords):
//  - move_existing: the student wants to reschedule a workout that is in the plan.
//  - already_planned: a workout of the asked type already stands on/around the asked day →
//    nothing to move blindly; offer the coach keep-as-is vs move-to-an-alternative-day.
//  - no_such_workout: no workout of that type in the plan → this is an ADD request, not a move;
//    we do NOT fabricate a move onto an unrelated workout (creating workouts is a separate feature).
//  - unclear: cannot tell from plan + message; fall back to existing source-inference behavior.
export type MoveSourceSituation =
  | "move_existing"
  | "already_planned"
  | "no_such_workout"
  | "unclear";

export type MoveSourceAiSelection = {
  situation: MoveSourceSituation;
  decision: "single" | "ambiguous" | "none";
  selectedWorkoutId: number | null;
  candidateWorkoutIds: number[];
  confidence: number;
  reasoning: string;
};

function sanitizeWorkoutIdList(value: unknown, allowed: Set<number>): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: number[] = [];
  for (const item of value) {
    const id = typeof item === "number" ? item : Number(item);
    if (Number.isFinite(id) && allowed.has(id) && !out.includes(id)) {
      out.push(id);
    }
  }
  return out;
}

export async function selectMoveSourceWorkoutWithAi(input: {
  messageText: string;
  todayIso: string;
  targetDateIso: string | null;
  timezone: string;
  calendar: MoveSourceCalendarWorkout[];
}): Promise<MoveSourceAiSelection | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }
  if (input.calendar.length === 0) {
    return null;
  }

  const allowedIds = new Set(input.calendar.map((w) => w.workoutId));
  const calendarLines = input.calendar
    .map(
      (w) =>
        `- workoutId=${w.workoutId} | ${w.date}${w.isToday ? " (СЕГОДНЯ)" : ""} | ${w.type ?? "?"} | ${
          w.title ?? "(без названия)"
        }`
    )
    .join("\n");

  const schemaHint = {
    situation: "move_existing|already_planned|no_such_workout|unclear",
    decision: "single|ambiguous|none",
    selectedWorkoutId: "number|null",
    candidateWorkoutIds: "number[]",
    confidence: 0.0,
    reasoning: "string",
  };

  const prompt = [
    "Ты помогаешь тренеру по бегу разобрать сообщение ученика про тренировки, СВЕРЯЯСЬ С ПЛАНОМ.",
    "У тебя есть текст ученика и его календарь запланированных НЕвыполненных тренировок.",
    "Сначала пойми ТИП ситуации (поле situation), потом — какую тренировку двигать:",
    "— move_existing: ученик хочет ПЕРЕНЕСТИ тренировку, которая есть в плане (явный сдвиг существующей).",
    "— already_planned: тренировка такого типа УЖЕ стоит в нужный день/период из сообщения. Двигать вслепую нечего; тренеру надо предложить «оставить как есть ИЛИ перенести на другой день из сообщения». В reasoning дай короткое предложение тренеру, например «вел уже стоит в сб — оставить или перенести на вс?».",
    "— no_such_workout: тренировки такого типа в плане НЕТ. Это просьба ДОБАВИТЬ новую, а не перенести. НЕ подбирай чужую тренировку. selectedWorkoutId=null.",
    "— unclear: не понять по плану и тексту.",
    "Ключевое: «сделаю/давай сделаю <тип> в <день>» — это НЕ всегда перенос. Если такая тренировка уже стоит → already_planned. Если её нет в плане → no_such_workout. Перенос (move_existing) — только когда ученик про существующую тренировку.",
    "Какую двигать (для move_existing) — по смыслу, не по близости дат:",
    "— «сегодня плохо/не могу сегодня/температура» → тренировку (СЕГОДНЯ);",
    "— «не могу во вторник/в среду» → тренировку того дня недели;",
    "— «уезжаю на выходных» → тренировки субботы/воскресенья;",
    "— назван тип («интервалы», «длительная», «силовая») → тренировку этого типа.",
    "Верни только JSON без markdown. Правила вывода:",
    "— situation=move_existing + decision=single + selectedWorkoutId, если однозначно какую двигать.",
    "— situation=move_existing + decision=ambiguous + candidateWorkoutIds (2-4 id), если реально непонятно.",
    "— situation=already_planned + selectedWorkoutId = уже стоящая тренировка (для справки), decision=none.",
    "— situation=no_such_workout → decision=none, selectedWorkoutId=null.",
    "— Не выдумывай workoutId — только из календаря.",
    `Сегодня: ${input.todayIso}; целевой день переноса: ${input.targetDateIso ?? "неизвестен"}; timezone: ${input.timezone}.`,
    `Схема: ${JSON.stringify(schemaHint)}.`,
    "Календарь запланированных тренировок:",
    calendarLines,
    `Сообщение ученика: ${input.messageText}`,
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
      return null;
    }
    const payload = (await response.json()) as {
      content?: Array<{ type: string; text: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    logAiCall({
      callSite: "parser",
      model: CLAUDE_MODEL,
      labels: [],
      inputTokens: payload.usage?.input_tokens ?? null,
      outputTokens: payload.usage?.output_tokens ?? null,
    });
    const text = payload.content?.find((b) => b.type === "text")?.text?.trim();
    if (!text) {
      return null;
    }
    const parsed = JSON.parse(extractJsonOnly(text)) as {
      situation?: unknown;
      decision?: unknown;
      selectedWorkoutId?: unknown;
      candidateWorkoutIds?: unknown;
      confidence?: unknown;
      reasoning?: unknown;
    };

    const situation: MoveSourceSituation =
      parsed.situation === "move_existing" ||
      parsed.situation === "already_planned" ||
      parsed.situation === "no_such_workout" ||
      parsed.situation === "unclear"
        ? parsed.situation
        : "unclear";
    const decision =
      parsed.decision === "single" || parsed.decision === "ambiguous" || parsed.decision === "none"
        ? parsed.decision
        : "none";
    const rawSelectedId =
      typeof parsed.selectedWorkoutId === "number" ? parsed.selectedWorkoutId : Number(parsed.selectedWorkoutId);
    const selectedWorkoutId =
      Number.isFinite(rawSelectedId) && allowedIds.has(rawSelectedId) ? rawSelectedId : null;
    const candidateWorkoutIds = sanitizeWorkoutIdList(parsed.candidateWorkoutIds, allowedIds);
    const confidence =
      typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0;
    const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning.trim() : "";

    // already_planned / no_such_workout: not a blind move. Keep the situation so enrich can offer
    // keep-or-move (already_planned) or decline the false move (no_such_workout) instead of pulling
    // an unrelated workout. decision is forced to "none" so no source gets auto-selected.
    if (situation === "already_planned" || situation === "no_such_workout") {
      return {
        situation,
        decision: "none",
        selectedWorkoutId: situation === "already_planned" ? selectedWorkoutId : null,
        candidateWorkoutIds: [],
        confidence,
        reasoning,
      };
    }

    // move_existing / unclear: reconcile decision with validated ids.
    if (decision === "single" && selectedWorkoutId !== null) {
      return { situation: "move_existing", decision: "single", selectedWorkoutId, candidateWorkoutIds: [], confidence, reasoning };
    }
    if (decision === "ambiguous" && candidateWorkoutIds.length >= 2) {
      return { situation: "move_existing", decision: "ambiguous", selectedWorkoutId: null, candidateWorkoutIds, confidence, reasoning };
    }
    return { situation: "unclear", decision: "none", selectedWorkoutId: null, candidateWorkoutIds: [], confidence, reasoning };
  } catch {
    return null;
  }
}
