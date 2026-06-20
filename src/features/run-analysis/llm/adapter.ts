// Server-only adapter — picks provider by env, hides provider details from callers
import type { RunAnalysisApiPayload, RunAnalysisReport } from "@/features/run-analysis/types";
import { callClaudeRunAnalysis } from "@/features/run-analysis/llm/claude";
import { callOpenAiRunAnalysis } from "@/features/run-analysis/llm/openai";

export type RunAnalysisLlmResult =
  | { ok: true; report: RunAnalysisReport; provider: string; model: string }
  | { ok: false; error: string };

function resolveProvider(): "claude" | "openai" {
  const v = process.env.RUN_ANALYSIS_LLM_PROVIDER?.trim().toLowerCase();
  return v === "openai" ? "openai" : "claude";
}

export async function generateRunAnalysis(
  payload: RunAnalysisApiPayload
): Promise<RunAnalysisLlmResult> {
  const provider = resolveProvider();

  if (provider === "openai") {
    const result = await callOpenAiRunAnalysis(payload);
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, report: result.report, provider: "openai", model: result.model };
  }

  const result = await callClaudeRunAnalysis(payload);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, report: result.report, provider: "claude", model: result.model };
}
