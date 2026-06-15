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

const STABLE = "stable rules block";
const DYNAMIC = "dynamic per-student block";
const FACTS = { a: 1, nested: { b: 2 } };

// --- buildNutritionModelRequest: Anthropic (cached stable block) ------------
{
  const req = buildNutritionModelRequest({
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    apiKey: "key-a",
    systemStable: STABLE,
    systemDynamic: DYNAMIC,
    factsPayload: FACTS,
  });
  assert.equal(req.url, "https://api.anthropic.com/v1/messages", "anthropic endpoint");
  assert.equal(req.headers["x-api-key"], "key-a", "x-api-key header");
  assert.equal(req.headers["anthropic-version"], "2023-06-01", "anthropic-version header");
  assert.ok(!("Authorization" in req.headers), "no Bearer auth on anthropic");
  const body = JSON.parse(req.body) as Record<string, unknown>;
  assert.equal(body.model, "claude-sonnet-4-6");
  assert.equal(body.max_tokens, 8192, "anthropic uses max_tokens (raised for merged review+plan output — Task 6)");
  const system = body.system as Array<Record<string, unknown>>;
  assert.ok(Array.isArray(system) && system.length === 2, "system is two blocks (stable + dynamic)");
  assert.equal(system[0].text, STABLE, "first block is the stable prompt");
  assert.deepEqual(system[0].cache_control, { type: "ephemeral" }, "cache_control on the stable block");
  assert.equal(system[1].text, DYNAMIC, "second block is the dynamic prompt");
  assert.ok(!("cache_control" in system[1]), "no cache_control on the dynamic block");
  assert.ok(!("temperature" in body), "no temperature on anthropic (avoids 400 across models)");
  // Compact JSON: no pretty-print newlines/indentation in the facts payload.
  const userContent = (body.messages as Array<{ content: string }>)[0].content;
  assert.ok(userContent.includes('{"a":1'), "facts JSON is compact (no pretty-print)");
}

// --- buildNutritionModelRequest: OpenAI gpt-4o (stable+dynamic concatenated) -
{
  const req = buildNutritionModelRequest({
    provider: "openai",
    model: "gpt-4o",
    apiKey: "key-o",
    systemStable: STABLE,
    systemDynamic: DYNAMIC,
    factsPayload: FACTS,
  });
  assert.equal(req.url, "https://api.openai.com/v1/chat/completions", "openai endpoint");
  assert.equal(req.headers.Authorization, "Bearer key-o", "Bearer auth on openai");
  const body = JSON.parse(req.body) as Record<string, unknown>;
  assert.deepEqual(body.response_format, { type: "json_object" }, "openai json_object format");
  const sys = (body.messages as Array<{ role: string; content: string }>)[0];
  assert.equal(sys.role, "system");
  assert.equal(sys.content, `${STABLE}\n${DYNAMIC}`, "openai system = stable + dynamic, stable first");
  assert.equal(body.temperature, 0.2, "gpt-4o keeps temperature");
  assert.equal(body.max_tokens, 8192, "gpt-4o keeps max_tokens");
  assert.ok(!("max_completion_tokens" in body), "gpt-4o does not use max_completion_tokens");
}

// --- buildNutritionModelRequest: OpenAI gpt-5 / o-series (next-gen params) --
{
  for (const model of ["gpt-5.2-chat-latest", "o3-mini"]) {
    const req = buildNutritionModelRequest({
      provider: "openai",
      model,
      apiKey: "key-o",
      systemStable: STABLE,
      systemDynamic: DYNAMIC,
      factsPayload: FACTS,
    });
    const body = JSON.parse(req.body) as Record<string, unknown>;
    assert.equal(body.max_completion_tokens, 8192, `${model} uses max_completion_tokens`);
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
