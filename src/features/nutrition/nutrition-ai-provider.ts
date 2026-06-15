/**
 * Provider adapter for nutrition prose generation (master order Task 2).
 *
 * Why: the OpenAI account ran out of quota, so live prose stopped reaching
 * students. This module lets the provider and model be switched by env alone
 * (no code edits) and hides the wire-format differences between OpenAI's
 * chat-completions API and Anthropic's Messages API behind one adapter — same
 * facts in, same parsed fields out (coach_summary_text, day_by_day_analysis_text,
 * athlete_message_draft, day_prose). Default provider is Anthropic (Claude);
 * OpenAI stays available as the fallback.
 */

import { classifyOpenAiError, type OpenAiErrorType } from "@/features/nutrition/nutrition-generation-queue";

export type NutritionAiProvider = "openai" | "anthropic";

const OPENAI_API_URL = process.env.OPENAI_API_URL?.trim() || "https://api.openai.com/v1/chat/completions";
const ANTHROPIC_API_URL = process.env.ANTHROPIC_API_URL?.trim() || "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";
const MAX_OUTPUT_TOKENS = 4096;

/** Selected provider. Default is Anthropic; set NUTRITION_AI_PROVIDER=openai to fall back. */
export function resolveNutritionAiProvider(): NutritionAiProvider {
  return process.env.NUTRITION_AI_PROVIDER?.trim().toLowerCase() === "openai" ? "openai" : "anthropic";
}

/** Model for the provider. NUTRITION_AI_MODEL overrides; otherwise a per-provider default. */
export function resolveNutritionAiModel(provider: NutritionAiProvider): string {
  const explicit = process.env.NUTRITION_AI_MODEL?.trim();
  if (explicit) {
    return explicit;
  }
  if (provider === "anthropic") {
    return DEFAULT_ANTHROPIC_MODEL;
  }
  return process.env.OPENAI_NUTRITION_WEEKLY_REVIEW_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
}

/** API key for the provider, or undefined when not configured. */
export function resolveNutritionAiApiKey(provider: NutritionAiProvider): string | undefined {
  const key = provider === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY;
  return key?.trim() || undefined;
}

/**
 * Build the HTTP request for the chosen provider/model. This is the model-aware
 * request builder the master order calls for: it picks the right endpoint,
 * headers, and body shape so switching provider/model never reproduces an
 * HTTP 400 from mismatched params.
 *
 * - OpenAI: chat-completions; JSON object response_format; gpt-5/o-series use
 *   max_completion_tokens (no temperature), older models use temperature + max_tokens.
 * - Anthropic: Messages API; `system` is a separate top-level field; no temperature
 *   (omitted so switching to opus-4.x never 400s); JSON is enforced by the prompt.
 */
export function buildNutritionModelRequest(input: {
  provider: NutritionAiProvider;
  model: string;
  apiKey: string;
  systemPrompt: string;
  factsPayload: unknown;
}): { url: string; headers: Record<string, string>; body: string } {
  const factsContent = `Facts JSON:\n${JSON.stringify(input.factsPayload, null, 2)}`;

  if (input.provider === "anthropic") {
    return {
      url: ANTHROPIC_API_URL,
      headers: {
        "x-api-key": input.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: input.systemPrompt,
        messages: [{ role: "user", content: factsContent }],
      }),
    };
  }

  const isNextGenModel = /^(gpt-5|o\d)/i.test(input.model);
  const requestBody: Record<string, unknown> = {
    model: input.model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: factsContent },
    ],
  };
  if (isNextGenModel) {
    requestBody.max_completion_tokens = MAX_OUTPUT_TOKENS;
  } else {
    requestBody.temperature = 0.2;
    requestBody.max_tokens = MAX_OUTPUT_TOKENS;
  }
  return {
    url: OPENAI_API_URL,
    headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  };
}

/** Pull the assistant text out of a provider response, or null if absent/empty. */
export function extractNutritionModelText(provider: NutritionAiProvider, json: unknown): string | null {
  if (provider === "anthropic") {
    const content = (json as { content?: unknown })?.content;
    if (Array.isArray(content)) {
      const textBlock = content.find(
        (block): block is { type: string; text: string } =>
          Boolean(block) &&
          typeof block === "object" &&
          (block as { type?: unknown }).type === "text" &&
          typeof (block as { text?: unknown }).text === "string"
      );
      const text = textBlock?.text?.trim();
      return text ? text : null;
    }
    return null;
  }
  const content = (json as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
  return typeof content === "string" && content.trim() ? content.trim() : null;
}

/** The model id that actually answered (both providers echo `model` at top level). */
export function extractNutritionModelId(json: unknown): string | null {
  const model = (json as { model?: unknown })?.model;
  return typeof model === "string" && model ? model : null;
}

/** Provider-specific finish/stop reason, for diagnostics only. */
export function extractNutritionFinishReason(provider: NutritionAiProvider, json: unknown): string | null {
  if (provider === "anthropic") {
    const reason = (json as { stop_reason?: unknown })?.stop_reason;
    return typeof reason === "string" ? reason : null;
  }
  const reason = (json as { choices?: Array<{ finish_reason?: unknown }> })?.choices?.[0]?.finish_reason;
  return typeof reason === "string" ? reason : null;
}

/**
 * Classify an error response per provider so the fallback reason is actionable.
 * OpenAI reuses the Task 1 classifier. Anthropic: 429 is a rate limit, 529/5xx
 * are transient server errors, and a credit/billing 400/403 is an exhausted
 * quota (retry is useless).
 */
export function classifyAiError(provider: NutritionAiProvider, status: number, bodyText: string): OpenAiErrorType {
  if (provider === "openai") {
    return classifyOpenAiError(status, bodyText);
  }
  if (status === 429) {
    return "rate_limit_exceeded";
  }
  if (status === 529 || status >= 500) {
    return "server_error";
  }
  if ((status === 400 || status === 403) && /credit balance|billing|insufficient|quota/i.test(bodyText)) {
    return "insufficient_quota";
  }
  return "other";
}
