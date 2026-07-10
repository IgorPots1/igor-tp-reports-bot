// Check for withSupabaseNetworkRetry (src/features/supabase/server.ts).
//
// Contract under test: retry ONLY on a rejected promise recognized as a
// network error. A resolved result (including one with `{ error }` set by
// Postgres/PostgREST) must come back verbatim on the first attempt — no
// retry, no interpretation. An unrecognized rejection must propagate
// immediately, no retry, no swallowing.

import { withSupabaseNetworkRetry } from "@/features/supabase/server";

let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ok   - ${message}`);
  } else {
    failed += 1;
    console.log(`  FAIL - ${message}`);
  }
}

async function run(): Promise<void> {
  // Scenario 1: network reject twice, success on 3rd attempt -> fn called 3 times.
  {
    let calls = 0;
    const result = await withSupabaseNetworkRetry(async () => {
      calls += 1;
      if (calls < 3) {
        throw new TypeError("fetch failed");
      }
      return { data: { ok: true }, error: null };
    });
    assert(calls === 3, "network reject x2 then success: fn called exactly 3 times");
    assert(
      result.data?.ok === true && result.error === null,
      "network reject x2 then success: final resolved result returned",
    );
  }

  // Scenario 2: resolved with { error } set -> returned verbatim, fn called exactly 1 time.
  {
    let calls = 0;
    const postgresError = { message: "duplicate key value violates unique constraint", code: "23505" };
    const result = await withSupabaseNetworkRetry(async () => {
      calls += 1;
      return { data: null, error: postgresError };
    });
    assert(calls === 1, "{ error } resolve: fn called exactly 1 time (no retry)");
    assert(
      result.data === null && result.error === postgresError,
      "{ error } resolve: result returned verbatim, byte-for-byte identical",
    );
  }

  // Scenario 3: unrecognized (non-network) throw -> propagated immediately, fn called exactly 1 time.
  {
    let calls = 0;
    const domainError = new Error("some non-network application error");
    let caught: unknown;
    try {
      await withSupabaseNetworkRetry(async () => {
        calls += 1;
        throw domainError;
      });
    } catch (error) {
      caught = error;
    }
    assert(calls === 1, "non-network throw: fn called exactly 1 time (no retry)");
    assert(caught === domainError, "non-network throw: propagated immediately, same error instance");
  }

  if (failed > 0) {
    console.log(`\ncheck-supabase-network-retry: FAILED (${failed})`);
    process.exitCode = 1;
  } else {
    console.log("\ncheck-supabase-network-retry: PASSED");
  }
}

run();
