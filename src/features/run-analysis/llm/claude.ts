// Server-only — ANTHROPIC_API_KEY must not reach the client bundle
import type { RunAnalysisApiPayload, RunAnalysisReport } from "@/features/run-analysis/types";
import { buildUserMessage, SYSTEM_PROMPT } from "@/features/run-analysis/llm/prompt";
import { extractJsonOnly, parseRunAnalysisReport } from "@/features/run-analysis/llm/parse";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_OUTPUT_TOKENS = 2048;

// thinking disabled in Phase 1 — enable with { type: "adaptive" } via env when ready
const THINKING_ENABLED = process.env.RUN_ANALYSIS_THINKING_ENABLED === "true";

function getModel(): string {
  return process.env.RUN_ANALYSIS_CLAUDE_MODEL?.trim() || "claude-opus-4-8";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type AnthropicError = "rate_limit" | "quota" | "server_error" | "other";

function classifyAnthropicError(status: number, body: string): AnthropicError {
  if (status === 429) return "rate_limit";
  if (status >= 500 || status === 529) return "server_error";
  if ((status === 400 || status === 403) && /credit|billing|quota|insufficient/i.test(body)) return "quota";
  return "other";
}

export type ClaudeRunAnalysisResult =
  | { ok: true; report: RunAnalysisReport; model: string }
  | { ok: false; error: string };

export async function callClaudeRunAnalysis(
  payload: RunAnalysisApiPayload
): Promise<ClaudeRunAnalysisResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return { ok: false, error: "ANTHROPIC_API_KEY not configured" };

  const model = getModel();
  const userMessage = buildUserMessage(payload);

  const requestBody: Record<string, unknown> = {
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  };

  if (THINKING_ENABLED) {
    // Phase 2: adaptive thinking — increases latency and cost but improves analysis depth
    requestBody.thinking = { type: "adaptive" };
  }

  const maxAttempts = 3;
  let lastError = "unknown";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response;
    try {
      res = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });
    } catch (err) {
      lastError = err instanceof Error ? err.message : "network_error";
      if (attempt < maxAttempts) await sleep(2000 * attempt);
      continue;
    }

    const bodyText = await res.text().catch(() => "");

    if (!res.ok) {
      const errType = classifyAnthropicError(res.status, bodyText);
      lastError = `http_${res.status}_${errType}`;
      if (errType === "quota") return { ok: false, error: `Anthropic quota exhausted: ${res.status}` };
      if (attempt < maxAttempts) await sleep(2000 * attempt);
      continue;
    }

    let json: unknown;
    try {
      json = JSON.parse(bodyText);
    } catch {
      lastError = "json_parse_error";
      if (attempt < maxAttempts) await sleep(2000 * attempt);
      continue;
    }

    const contentBlocks = (json as { content?: Array<{ type: string; text?: string }> })?.content;
    const textBlock = Array.isArray(contentBlocks)
      ? contentBlocks.find((b) => b.type === "text" && typeof b.text === "string")
      : undefined;

    if (!textBlock?.text?.trim()) {
      lastError = "empty_content";
      if (attempt < maxAttempts) await sleep(2000 * attempt);
      continue;
    }

    const jsonOnly = extractJsonOnly(textBlock.text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonOnly);
    } catch {
      lastError = "report_json_parse_error";
      if (attempt < maxAttempts) await sleep(2000 * attempt);
      continue;
    }

    const result = parseRunAnalysisReport(parsed);
    if (!result.ok) {
      lastError = `report_parse_${result.error}`;
      if (attempt < maxAttempts) await sleep(2000 * attempt);
      continue;
    }

    return { ok: true, report: result.report, model };
  }

  return { ok: false, error: `Claude failed after ${maxAttempts} attempts: ${lastError}` };
}
