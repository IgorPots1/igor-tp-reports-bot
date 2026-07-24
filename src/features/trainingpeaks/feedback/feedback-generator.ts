// Swappable generator backend (мост, часть 1 — Igor's KEY requirement).
// FEEDBACK_GENERATOR=cowork|api behind ONE env switch, so Igor debugs on Cowork
// (from the subscription, no API spend) and can fall back to the API with one
// flag WITHOUT rewriting anything. Both must be the SAME model (Claude Sonnet) —
// the voice prompt is calibrated on Sonnet, so a different model would break the
// calibration on switch. The queue, packet, prompt and fact-check are shared;
// only WHO produces the text differs:
//
//   api    → generateFeedbackDraftViaApi(): direct Anthropic Messages call, in-process.
//   cowork → EXTERNAL worker (real Cowork scheduled task at x20 / an isolated
//            subsession stub now). It claims a pending job, generates, and calls
//            the SAME submitFeedbackDraft(). Plugging in real Cowork = replacing
//            that one worker, not the pipeline.

export type FeedbackGeneratorBackend = "api" | "cowork";

const ANTHROPIC_API_URL = process.env.ANTHROPIC_API_URL?.trim() || "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
// Must match the model Cowork runs (a Claude Sonnet) so API-fallback keeps the
// SAME voice the prompt was calibrated on. Override with FEEDBACK_AI_MODEL.
const DEFAULT_FEEDBACK_MODEL = "claude-sonnet-4-6";
const MAX_OUTPUT_TOKENS = 400; // one short Telegram message — never a wall of text

/**
 * Env-level backend (the fallback default). Pure — no DB, no network — so it stays unit-
 * testable. The DB-backed override lives in feedback-backend-mode.ts (getActiveFeedbackGeneratorBackend).
 */
export function resolveFeedbackGeneratorBackend(): FeedbackGeneratorBackend {
  return process.env.FEEDBACK_GENERATOR?.trim().toLowerCase() === "api" ? "api" : "cowork";
}

export function resolveFeedbackAiModel(): string {
  return process.env.FEEDBACK_AI_MODEL?.trim() || DEFAULT_FEEDBACK_MODEL;
}

export type FeedbackGenerationResult = { ok: true; text: string } | { ok: false; error: string };

/**
 * API backend: one Anthropic Messages call. The assembled prompt (voice rules +
 * few-shots + packet) is the single user message — the same input an isolated
 * Cowork/subsession receives, so both backends produce the same-shaped draft.
 * Returns ok:false (not throw) on transport/quota errors so the caller marks the
 * job failed with a reason and can retry later.
 */
export async function generateFeedbackDraftViaApi(prompt: string): Promise<FeedbackGenerationResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, error: "ANTHROPIC_API_KEY не задан" };
  }
  let response: Response;
  try {
    response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" },
      body: JSON.stringify({
        model: resolveFeedbackAiModel(),
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch (error) {
    return { ok: false, error: `сеть: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    return { ok: false, error: `HTTP ${response.status}: ${bodyText.slice(0, 200)}` };
  }
  const json = (await response.json().catch(() => null)) as { content?: Array<{ type?: string; text?: string }> } | null;
  const block = json?.content?.find((b) => b?.type === "text" && typeof b.text === "string");
  const text = block?.text?.trim();
  if (!text) {
    return { ok: false, error: "пустой ответ модели" };
  }
  return { ok: true, text };
}
