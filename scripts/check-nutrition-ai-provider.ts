import assert from "node:assert/strict";

import {
  buildNutritionModelRequest,
  classifyAiError,
  extractNutritionFinishReason,
  extractNutritionModelId,
  extractNutritionModelText,
  resolveNutritionAiModel,
  resolveNutritionAiProvider,
} from "@/features/nutrition/nutrition-ai-provider";

const SYSTEM = "system prompt";
const FACTS = { a: 1 };

// --- buildNutritionModelRequest: Anthropic ---------------------------------
{
  const req = buildNutritionModelRequest({
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    apiKey: "key-a",
    systemPrompt: SYSTEM,
    factsPayload: FACTS,
  });
  assert.equal(req.url, "https://api.anthropic.com/v1/messages", "anthropic endpoint");
  assert.equal(req.headers["x-api-key"], "key-a", "x-api-key header");
  assert.equal(req.headers["anthropic-version"], "2023-06-01", "anthropic-version header");
  assert.ok(!("Authorization" in req.headers), "no Bearer auth on anthropic");
  const body = JSON.parse(req.body) as Record<string, unknown>;
  assert.equal(body.model, "claude-sonnet-4-6");
  assert.equal(body.max_tokens, 4096, "anthropic uses max_tokens");
  assert.equal(body.system, SYSTEM, "system is a top-level field");
  assert.ok(Array.isArray(body.messages), "messages present");
  assert.ok(!("temperature" in body), "no temperature on anthropic (avoids 400 across models)");
  assert.ok(!("response_format" in body), "no response_format on anthropic");
}

// --- buildNutritionModelRequest: OpenAI gpt-4o (legacy params) --------------
{
  const req = buildNutritionModelRequest({
    provider: "openai",
    model: "gpt-4o",
    apiKey: "key-o",
    systemPrompt: SYSTEM,
    factsPayload: FACTS,
  });
  assert.equal(req.url, "https://api.openai.com/v1/chat/completions", "openai endpoint");
  assert.equal(req.headers.Authorization, "Bearer key-o", "Bearer auth on openai");
  const body = JSON.parse(req.body) as Record<string, unknown>;
  assert.deepEqual(body.response_format, { type: "json_object" }, "openai json_object format");
  assert.equal(body.temperature, 0.2, "gpt-4o keeps temperature");
  assert.equal(body.max_tokens, 4096, "gpt-4o keeps max_tokens");
  assert.ok(!("max_completion_tokens" in body), "gpt-4o does not use max_completion_tokens");
}

// --- buildNutritionModelRequest: OpenAI gpt-5 / o-series (next-gen params) --
{
  for (const model of ["gpt-5.2-chat-latest", "o3-mini"]) {
    const req = buildNutritionModelRequest({
      provider: "openai",
      model,
      apiKey: "key-o",
      systemPrompt: SYSTEM,
      factsPayload: FACTS,
    });
    const body = JSON.parse(req.body) as Record<string, unknown>;
    assert.equal(body.max_completion_tokens, 4096, `${model} uses max_completion_tokens`);
    assert.ok(!("max_tokens" in body), `${model} drops max_tokens`);
    assert.ok(!("temperature" in body), `${model} drops temperature`);
  }
}

// --- extractNutritionModelText / Id / finish reason -------------------------
{
  const anthropicJson = {
    model: "claude-sonnet-4-6",
    stop_reason: "end_turn",
    content: [
      { type: "thinking", thinking: "" },
      { type: "text", text: "  {\"ok\":true}  " },
    ],
  };
  assert.equal(extractNutritionModelText("anthropic", anthropicJson), '{"ok":true}', "anthropic text block, trimmed");
  assert.equal(extractNutritionModelId(anthropicJson), "claude-sonnet-4-6", "anthropic model id");
  assert.equal(extractNutritionFinishReason("anthropic", anthropicJson), "end_turn", "anthropic stop_reason");
  assert.equal(extractNutritionModelText("anthropic", { content: [] }), null, "empty anthropic content -> null");

  const openaiJson = {
    model: "gpt-4o",
    choices: [{ message: { content: " hello " }, finish_reason: "stop" }],
  };
  assert.equal(extractNutritionModelText("openai", openaiJson), "hello", "openai content, trimmed");
  assert.equal(extractNutritionModelId(openaiJson), "gpt-4o", "openai model id");
  assert.equal(extractNutritionFinishReason("openai", openaiJson), "stop", "openai finish_reason");
  assert.equal(extractNutritionModelText("openai", { choices: [] }), null, "empty openai choices -> null");
}

// --- classifyAiError -------------------------------------------------------
{
  // Anthropic
  assert.equal(classifyAiError("anthropic", 429, '{"error":{"type":"rate_limit_error"}}'), "rate_limit_exceeded");
  assert.equal(classifyAiError("anthropic", 529, "overloaded"), "server_error");
  assert.equal(classifyAiError("anthropic", 500, "boom"), "server_error");
  assert.equal(
    classifyAiError("anthropic", 400, '{"error":{"message":"Your credit balance is too low"}}'),
    "insufficient_quota"
  );
  assert.equal(classifyAiError("anthropic", 400, "malformed request"), "other");

  // OpenAI (delegates to the Task 1 classifier)
  assert.equal(
    classifyAiError("openai", 429, '{"error":{"type":"insufficient_quota"}}'),
    "insufficient_quota"
  );
  assert.equal(classifyAiError("openai", 429, '{"error":{"type":"rate_limit_error"}}'), "rate_limit_exceeded");
  assert.equal(classifyAiError("openai", 500, "boom"), "server_error");
}

// --- resolveNutritionAiProvider / Model defaults ---------------------------
{
  delete process.env.NUTRITION_AI_PROVIDER;
  delete process.env.NUTRITION_AI_MODEL;
  delete process.env.OPENAI_NUTRITION_WEEKLY_REVIEW_MODEL;
  assert.equal(resolveNutritionAiProvider(), "anthropic", "default provider is anthropic");
  assert.equal(resolveNutritionAiModel("anthropic"), "claude-sonnet-4-6", "default anthropic model");
  assert.equal(resolveNutritionAiModel("openai"), "gpt-4o-mini", "default openai model");

  process.env.NUTRITION_AI_PROVIDER = "openai";
  assert.equal(resolveNutritionAiProvider(), "openai", "env switches provider to openai");
  process.env.NUTRITION_AI_MODEL = "gpt-4o";
  assert.equal(resolveNutritionAiModel("openai"), "gpt-4o", "NUTRITION_AI_MODEL overrides");
  assert.equal(resolveNutritionAiModel("anthropic"), "gpt-4o", "NUTRITION_AI_MODEL overrides regardless of provider");
  delete process.env.NUTRITION_AI_PROVIDER;
  delete process.env.NUTRITION_AI_MODEL;
}

console.log("PASS check-nutrition-ai-provider");
