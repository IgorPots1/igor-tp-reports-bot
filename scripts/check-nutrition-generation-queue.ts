import assert from "node:assert/strict";

import {
  classifyOpenAiError,
  enqueueOpenAiCall,
  getNutritionGenDelayMs,
} from "@/features/nutrition/nutrition-generation-queue";

// --- classifyOpenAiError ---------------------------------------------------

// 1. 429 with a plain rate-limit body -> transient rate limit (retry helps).
{
  const body = JSON.stringify({
    error: { type: "rate_limit_error", message: "Rate limit reached for requests" },
  });
  assert.equal(classifyOpenAiError(429, body), "rate_limit_exceeded");
}

// 2. 429 with insufficient_quota -> quota exhausted (retry is useless).
{
  const body = JSON.stringify({
    error: { type: "insufficient_quota", code: "insufficient_quota", message: "You exceeded your current quota" },
  });
  assert.equal(classifyOpenAiError(429, body), "insufficient_quota");
}

// 3. 5xx -> transient server error.
{
  assert.equal(classifyOpenAiError(500, "internal error"), "server_error");
  assert.equal(classifyOpenAiError(503, ""), "server_error");
}

// 4. Other statuses -> other.
{
  assert.equal(classifyOpenAiError(400, "bad request"), "other");
  assert.equal(classifyOpenAiError(0, ""), "other");
}

// --- enqueueOpenAiCall serialisation ---------------------------------------

// 5. Calls never overlap: at most one runs at a time, in FIFO order.
async function testSerialisation() {
  let active = 0;
  let maxActive = 0;
  const order: number[] = [];

  const makeCall = (id: number) =>
    enqueueOpenAiCall(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      // Yield so any (incorrectly) parallel call would overlap here.
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(id);
      active -= 1;
      return id;
    });

  const results = await Promise.all([makeCall(1), makeCall(2), makeCall(3)]);

  assert.equal(maxActive, 1, "no two OpenAI calls may run at the same time");
  assert.deepEqual(order, [1, 2, 3], "calls run in FIFO order");
  assert.deepEqual(results, [1, 2, 3], "each call resolves with its own value");
}

// 6. A rejecting call does not wedge the queue for the next call.
async function testRejectionDoesNotWedge() {
  await assert.rejects(
    enqueueOpenAiCall(async () => {
      throw new Error("boom");
    })
  );
  const after = await enqueueOpenAiCall(async () => "ok");
  assert.equal(after, "ok", "queue keeps running after a rejected call");
}

// 7. The configured gap is enforced between consecutive call starts.
async function testDelayBetweenStarts() {
  const delay = getNutritionGenDelayMs();
  if (delay <= 0) {
    return; // gap disabled via env; nothing to assert
  }
  const starts: number[] = [];
  await enqueueOpenAiCall(async () => {
    starts.push(Date.now());
  });
  await enqueueOpenAiCall(async () => {
    starts.push(Date.now());
  });
  const gap = starts[1] - starts[0];
  // Allow a little timer slack below the configured delay.
  assert.ok(gap >= delay - 50, `gap between starts (${gap}ms) must be >= ~${delay}ms`);
}

async function main() {
  await testSerialisation();
  await testRejectionDoesNotWedge();
  await testDelayBetweenStarts();
  console.log("PASS check-nutrition-generation-queue");
}

void main();
