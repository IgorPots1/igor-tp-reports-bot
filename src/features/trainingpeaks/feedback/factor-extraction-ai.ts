// Block 1 — Haiku extraction of student-named factors (жара, не пил, недосып, ремонт, болит…).
// Primary path; stated-factors.ts holds the deterministic FALLBACK. Keyword matching breaks on
// paraphrase exactly where it matters ("не брала воду" / "забыла попить" / "пила мало" are three
// stems), so a one-shot Haiku JSON pass reads intent instead. Mirrors move-workout-intent-ai.ts:
// raw fetch, strict-JSON, graceful degradation. Gated so it fires only when there are windowed
// messages to read, and falls back (never throws) when the model is disabled/unavailable/errors.

import { logAiCall } from "@/features/trainingpeaks/ai-call-log";
import { assembleFactorsFromHits, extractStatedFactorsDeterministic, FACTOR_WINDOW_BACK_DAYS, FACTOR_WINDOW_FWD_DAYS } from "./stated-factors.ts";
import type { PlannerStudentMessage, StatedFactor, StatedFactorKind } from "./types.ts";

const CLAUDE_MODEL = process.env.FEEDBACK_FACTOR_MODEL?.trim() || "claude-haiku-4-5-20251001";
const ANTHROPIC_API_URL = process.env.ANTHROPIC_API_URL?.trim() || "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

const ALLOWED_FACTORS = new Set<StatedFactorKind>(["illness", "soreness", "undersleep", "dehydration", "heat", "life_stress", "conditions"]);

function extractJsonOnly(content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
}

function windowMessages(messages: PlannerStudentMessage[], workoutDate: string): PlannerStudentMessage[] {
  const wd = new Date(`${workoutDate}T00:00:00Z`).getTime();
  return messages
    .filter((m) => {
      if (!m.date) return false;
      const diffDays = (new Date(`${m.date}T00:00:00Z`).getTime() - wd) / 86_400_000;
      return Number.isFinite(diffDays) && diffDays >= -FACTOR_WINDOW_BACK_DAYS && diffDays <= FACTOR_WINDOW_FWD_DAYS;
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

function buildPrompt(windowed: PlannerStudentMessage[]): string {
  return [
    "Ты извлекаешь из сообщений бегуна ПРИЧИНЫ, которые он сам назвал про свою тренировку/самочувствие.",
    "Верни СТРОГО JSON: {\"factors\":[{\"factor\":\"...\",\"quote\":\"дословный кусок сообщения\",\"date\":\"YYYY-MM-DD\"}]}.",
    "factor — ТОЛЬКО из набора:",
    "- illness (болел/простыл/горло/температура/недомогание)",
    "- soreness (что-то болит/тянет/забиты — колено, стопа, спина)",
    "- undersleep (мало спал/недосып/не выспался)",
    "- dehydration (не пил/забыл попить/воду не брал/пил мало) — сюда же любые перефразы",
    "- heat (жара/духота/пекло/высокая температура воздуха)",
    "- life_stress (работа/ремонт/переезд/аврал/стресс/устаю по жизни)",
    "- conditions (рельеф/горки/дорожка-манеж/ветер/грязь/снег)",
    "Правила: бери фактор ТОЛЬКО если он явно назван словами ученика. Не выдумывай и не додумывай.",
    "quote — дословно из сообщения, без чисел-выдумок. Если ничего не названо, верни {\"factors\":[]}.",
    "Одно сообщение может нести несколько факторов; перечисли каждый отдельным элементом.",
    "",
    "Сообщения ученика (новые сверху), формат [дата] текст:",
    ...windowed.map((m) => `[${m.date}] ${m.text}`),
  ].join("\n");
}

/**
 * Extract the factors a student named around this workout. Haiku primary, deterministic fallback.
 * NEVER throws — any failure (disabled, no key, HTTP error, bad JSON) degrades to the keyword
 * extractor, which itself returns [] when nothing matches. Only calls the model when there ARE
 * windowed messages, so the cost tracks the enqueue rate (a handful/day), not every packet.
 */
export async function extractStatedFactors(messages: PlannerStudentMessage[], workoutDate: string): Promise<StatedFactor[]> {
  const windowed = windowMessages(messages, workoutDate);
  if (windowed.length === 0) return [];

  const disabled = process.env.FEEDBACK_FACTOR_EXTRACTION_DISABLED?.trim() === "1";
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (disabled || !apiKey) return extractStatedFactorsDeterministic(messages, workoutDate);

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" },
      body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 512, system: "Return strict JSON only.", messages: [{ role: "user", content: buildPrompt(windowed) }] }),
    });
    if (!response.ok) return extractStatedFactorsDeterministic(messages, workoutDate);

    const payload = (await response.json()) as { content?: Array<{ type: string; text: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
    const text = payload.content?.find((b) => b.type === "text")?.text?.trim();
    if (!text) return extractStatedFactorsDeterministic(messages, workoutDate);

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJsonOnly(text));
    } catch {
      return extractStatedFactorsDeterministic(messages, workoutDate);
    }
    const rawFactors = (parsed as { factors?: unknown }).factors;
    if (!Array.isArray(rawFactors)) return extractStatedFactorsDeterministic(messages, workoutDate);

    const windowDates = new Set(windowed.map((m) => m.date));
    const hits: Array<{ factor: StatedFactorKind; quote: string; date: string }> = [];
    for (const r of rawFactors) {
      const factor = (r as { factor?: unknown }).factor;
      const quote = (r as { quote?: unknown }).quote;
      const date = (r as { date?: unknown }).date;
      if (typeof factor !== "string" || !ALLOWED_FACTORS.has(factor as StatedFactorKind)) continue;
      if (typeof quote !== "string" || quote.trim().length === 0) continue;
      // Trust the message dates we actually sent; a hallucinated date falls back to the newest.
      const safeDate = typeof date === "string" && windowDates.has(date) ? date : windowed[0]!.date;
      hits.push({ factor: factor as StatedFactorKind, quote: quote.trim(), date: safeDate });
    }

    logAiCall({
      callSite: "feedback_factor",
      model: CLAUDE_MODEL,
      labels: [],
      inputTokens: payload.usage?.input_tokens ?? null,
      outputTokens: payload.usage?.output_tokens ?? null,
      messageId: null,
      studentRef: null,
    });

    return assembleFactorsFromHits(hits, workoutDate);
  } catch {
    return extractStatedFactorsDeterministic(messages, workoutDate);
  }
}
