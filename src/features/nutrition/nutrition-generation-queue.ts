/**
 * Sequential queue + rate control for nutrition OpenAI calls (master order Task 1).
 *
 * Why: generating reviews "на поток" (many students) fired OpenAI requests
 * haphazardly and hit HTTP 429. This module serialises model calls — one at a
 * time, with a configurable gap between them — so bursts don't trip rate limits.
 * It also classifies 429 responses so callers can tell a transient rate limit
 * (retry helps) from an exhausted quota (retry is useless — check OpenAI balance).
 *
 * Scope note: this is an in-process serialiser. It guarantees ordering within a
 * single Node process (the sequential batch loop and the two calls per student).
 * It does not coordinate across separate serverless invocations.
 */

/** Delay between the START of consecutive OpenAI calls. */
const NUTRITION_GEN_DELAY_MS = (() => {
  const raw = Number(process.env.NUTRITION_GEN_DELAY_MS?.trim());
  return Number.isFinite(raw) && raw >= 0 ? raw : 1800;
})();

/** Tail of the serial chain. Each enqueued call links onto the previous one. */
let tail: Promise<unknown> = Promise.resolve();

/** Timestamp (ms) when the most recent call was allowed to start. */
let lastStartedAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `fn` after all previously enqueued calls have finished, holding the slot
 * for the entire duration of `fn` (including any retries inside it), and only
 * after at least NUTRITION_GEN_DELAY_MS has elapsed since the previous start.
 * OpenAI calls are never run in parallel through this queue.
 */
export function enqueueOpenAiCall<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(async () => {
    const elapsed = Date.now() - lastStartedAt;
    const wait = NUTRITION_GEN_DELAY_MS - elapsed;
    if (wait > 0) {
      await sleep(wait);
    }
    lastStartedAt = Date.now();
    return fn();
  });
  // Keep the chain alive even if this call rejects, so one failure does not
  // wedge the queue for every subsequent call.
  tail = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export type OpenAiErrorType =
  | "rate_limit_exceeded"
  | "insufficient_quota"
  | "server_error"
  | "other";

/**
 * Classify an OpenAI error response. 429 splits into a transient rate limit
 * (retry/backoff helps) and an exhausted quota (retry is useless). 5xx is a
 * transient server error; anything else is "other".
 */
export function classifyOpenAiError(status: number, bodyText: string): OpenAiErrorType {
  if (status === 429) {
    return /insufficient_quota/i.test(bodyText) ? "insufficient_quota" : "rate_limit_exceeded";
  }
  if (status >= 500) {
    return "server_error";
  }
  return "other";
}

/** Exposed for diagnostics/tests. */
export function getNutritionGenDelayMs(): number {
  return NUTRITION_GEN_DELAY_MS;
}
