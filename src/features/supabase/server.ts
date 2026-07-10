import { createClient } from "@supabase/supabase-js";

function getRequiredEnv(name: "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function createSupabaseServerClient() {
  return createClient(
    getRequiredEnv("SUPABASE_URL"),
    getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

const SUPABASE_RETRY_ATTEMPTS = 3;
const SUPABASE_RETRY_BASE_DELAY_MS = 500;
const SUPABASE_NETWORK_ERROR_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN"]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isSupabaseNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && SUPABASE_NETWORK_ERROR_CODES.has(code)) return true;

  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const causeCode = (cause as { code?: unknown }).code;
    if (typeof causeCode === "string" && SUPABASE_NETWORK_ERROR_CODES.has(causeCode)) return true;
  }

  return (
    (error instanceof TypeError && /fetch failed/i.test(error.message)) ||
    /socket hang up/i.test(error.message)
  );
}

/**
 * Retries ONLY a rejected promise recognized as network-shaped (the request
 * never reached PostgREST/Postgres). A resolved result — including one with
 * `{ error }` set by Postgres/PostgREST — is returned verbatim on the first
 * attempt: zero retries, zero interpretation. An unrecognized rejection is
 * rethrown immediately, no retry, no swallowing.
 *
 * Only call this around retry-safe operations (pure reads, upsert-by-unique-key,
 * idempotent RPCs). Do not wrap action/job-queue mutations where a retry after
 * an already-succeeded write could duplicate a real side effect.
 */
export async function withSupabaseNetworkRetry<T>(fn: () => PromiseLike<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < SUPABASE_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isSupabaseNetworkError(error) || attempt === SUPABASE_RETRY_ATTEMPTS - 1) {
        throw error;
      }
      await sleep(SUPABASE_RETRY_BASE_DELAY_MS * (attempt + 1));
    }
  }
  throw lastError;
}
