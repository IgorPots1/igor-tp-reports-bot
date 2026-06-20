// Server-only — OPENAI_API_KEY must not reach the client bundle
import type { RunAnalysisApiPayload, RunAnalysisReport } from "@/features/run-analysis/types";
import { buildUserMessage, SYSTEM_PROMPT } from "@/features/run-analysis/llm/prompt";
import { extractJsonOnly, parseRunAnalysisReport } from "@/features/run-analysis/llm/parse";

const OPENAI_API_URL = process.env.OPENAI_API_URL?.trim() || "https://api.openai.com/v1/chat/completions";
const MAX_OUTPUT_TOKENS = 2048;

function getModel(): string {
  return process.env.RUN_ANALYSIS_OPENAI_MODEL?.trim() || "gpt-5.5";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type OpenAiErrorKind = "rate_limit" | "quota" | "server_error" | "other";

function classifyOpenAiError(status: number, body: string): OpenAiErrorKind {
  if (status === 429) {
    if (/insufficient_quota|billing/i.test(body)) return "quota";
    return "rate_limit";
  }
  if (status >= 500) return "server_error";
  return "other";
}

export type OpenAiRunAnalysisResult =
  | { ok: true; report: RunAnalysisReport; model: string }
  | { ok: false; error: string };

export async function callOpenAiRunAnalysis(
  payload: RunAnalysisApiPayload
): Promise<OpenAiRunAnalysisResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return { ok: false, error: "OPENAI_API_KEY not configured" };

  const model = getModel();
  const isNextGen = /^(gpt-5|o\d)/i.test(model);

  const requestBody: Record<string, unknown> = {
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserMessage(payload) },
    ],
  };

  if (isNextGen) {
    requestBody.max_completion_tokens = MAX_OUTPUT_TOKENS;
  } else {
    requestBody.temperature = 0.2;
    requestBody.max_tokens = MAX_OUTPUT_TOKENS;
  }

  const maxAttempts = 3;
  let lastError = "unknown";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response;
    try {
      res = await fetch(OPENAI_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
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
      const errType = classifyOpenAiError(res.status, bodyText);
      lastError = `http_${res.status}_${errType}`;
      if (errType === "quota") return { ok: false, error: `OpenAI quota exhausted: ${res.status}` };
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

    const content = (
      json as { choices?: Array<{ message?: { content?: unknown } }> }
    )?.choices?.[0]?.message?.content;

    if (typeof content !== "string" || !content.trim()) {
      lastError = "empty_content";
      if (attempt < maxAttempts) await sleep(2000 * attempt);
      continue;
    }

    const jsonOnly = extractJsonOnly(content);
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

  return { ok: false, error: `OpenAI failed after ${maxAttempts} attempts: ${lastError}` };
}
