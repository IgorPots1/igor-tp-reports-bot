import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, afterEach, before, describe, test } from "node:test";

import {
  chunkDateRangeInclusive,
  getHealthMetrics,
  getWorkoutsByDateRange,
  isWorkoutGone,
  resetTpApiClientAuthCacheForTests,
  TpApiSchemaError,
  __setSessionSnapshotPathForTests,
} from "./tp-api-client.ts";

/**
 * First test file in this repo -- uses node:test (built into Node.js, zero new
 * dependency), matching the codebase's existing preference for plain
 * `node --experimental-strip-types` scripts over a heavier framework.
 *
 * Run: node --experimental-strip-types --test src/features/trainingpeaks/tp-api-client.test.ts
 */

// ─── chunkDateRangeInclusive ────────────────────────────────────────────────

describe("chunkDateRangeInclusive", () => {
  test("single day (start === end) produces one chunk covering exactly that day", () => {
    const chunks = chunkDateRangeInclusive("2026-06-13", "2026-06-13");
    assert.deepEqual(chunks, [{ start: "2026-06-13", end: "2026-06-13" }]);
  });

  test("exactly 90 days produces a single chunk", () => {
    // 2026-01-01 .. 2026-03-31 inclusive = 90 days
    const chunks = chunkDateRangeInclusive("2026-01-01", "2026-03-31");
    assert.equal(chunks.length, 1);
    assert.deepEqual(chunks[0], { start: "2026-01-01", end: "2026-03-31" });
  });

  test("91 days splits into two chunks with no overlap and no gap", () => {
    const chunks = chunkDateRangeInclusive("2026-01-01", "2026-04-01");
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].start, "2026-01-01");
    assert.equal(chunks[0].end, "2026-03-31");
    // next chunk starts the day AFTER the previous chunk's end -- no end+1 on the
    // request itself, just the chunk boundary advancing by one calendar day.
    assert.equal(chunks[1].start, "2026-04-01");
    assert.equal(chunks[1].end, "2026-04-01");
  });

  test("a long range splits into multiple 90-day chunks, last chunk shorter", () => {
    const chunks = chunkDateRangeInclusive("2026-01-01", "2026-08-01"); // 213 days
    assert.equal(chunks.length, 3);
    for (let i = 1; i < chunks.length; i += 1) {
      const prevEnd = new Date(`${chunks[i - 1].end}T00:00:00Z`).getTime();
      const nextStart = new Date(`${chunks[i].start}T00:00:00Z`).getTime();
      assert.equal(nextStart - prevEnd, 24 * 60 * 60 * 1000, `chunk ${i} must start exactly 1 day after chunk ${i - 1} ends`);
    }
    assert.equal(chunks.at(-1)?.end, "2026-08-01");
  });

  test("throws when end is before start", () => {
    assert.throws(() => chunkDateRangeInclusive("2026-06-13", "2026-06-01"), /before start/);
  });

  test("throws on malformed date", () => {
    assert.throws(() => chunkDateRangeInclusive("13-06-2026", "2026-06-13"), /Invalid date/);
  });
});

// ─── isWorkoutGone (PR1 deletion-semantics finding) ────────────────────────────

describe("isWorkoutGone", () => {
  test("404 is gone", () => assert.equal(isWorkoutGone(404, null), true));
  test("403 is gone", () => assert.equal(isWorkoutGone(403, null), true));
  test('400 with "Invalid workoutId" body is gone (tpapi\'s actual delete signature)', () => {
    assert.equal(isWorkoutGone(400, "Invalid workoutId (3840679213)"), true);
    assert.equal(isWorkoutGone(400, { message: "Invalid workoutId (123)" }), true);
  });
  test("400 with an unrelated body is NOT treated as gone", () => {
    assert.equal(isWorkoutGone(400, "Some other bad request"), false);
  });
  test("200 is not gone", () => assert.equal(isWorkoutGone(200, {}), false));
  test("500 is not gone (transient, not a deletion signal)", () => assert.equal(isWorkoutGone(500, null), false));
});

// ─── auth + retry + schema validation (mocked fetch + temp snapshot file) ─────

describe("getWorkoutsByDateRange (mocked network)", () => {
  let tmpDir: string;
  let snapshotPath: string;
  let originalFetch: typeof fetch;

  before(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "tp-api-client-test-"));
    snapshotPath = path.join(tmpDir, "session-snapshot.json");
    await writeFile(
      snapshotPath,
      JSON.stringify({
        version: 1,
        cookieValue: "test-cookie-value",
        cookieExpiresAtMs: Date.now() + 30 * 24 * 60 * 60 * 1000,
        capturedAtMs: Date.now(),
        source: "playwright-profile",
      }),
    );
    __setSessionSnapshotPathForTests(snapshotPath);
  });

  after(async () => {
    __setSessionSnapshotPathForTests(undefined);
    await rm(tmpDir, { recursive: true, force: true });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetTpApiClientAuthCacheForTests();
  });

  function mockFetchSequence(responder: (url: string, callIndex: number) => { status: number; body: unknown }) {
    originalFetch = globalThis.fetch;
    let callIndex = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      const { status, body } = responder(url, callIndex);
      callIndex += 1;
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
  }

  test("happy path: token exchange then a single successful list call", async () => {
    mockFetchSequence((url) => {
      if (url.includes("/users/v3/token")) {
        return { status: 200, body: { success: true, token: { access_token: "abc", expires_in: 3600 } } };
      }
      return { status: 200, body: [{ workoutId: 1, athleteId: 42, workoutDay: "2026-06-13T00:00:00" }] };
    });

    const result = await getWorkoutsByDateRange(42, "2026-06-13", "2026-06-13");
    assert.equal(result.length, 1);
    assert.equal(result[0].workoutId, 1);
    assert.equal(result[0].workoutDay, "2026-06-13T00:00:00");
  });

  test("401 on the data call triggers exactly one forced token refresh, then succeeds", async () => {
    let tokenCalls = 0;
    let dataCalls = 0;
    mockFetchSequence((url) => {
      if (url.includes("/users/v3/token")) {
        tokenCalls += 1;
        return { status: 200, body: { success: true, token: { access_token: `token-${tokenCalls}`, expires_in: 3600 } } };
      }
      dataCalls += 1;
      if (dataCalls === 1) return { status: 401, body: "unauthorized" };
      return { status: 200, body: [{ workoutId: 7, athleteId: 42, workoutDay: "2026-06-13T00:00:00" }] };
    });

    const result = await getWorkoutsByDateRange(42, "2026-06-13", "2026-06-13");
    assert.equal(result.length, 1);
    assert.equal(dataCalls, 2, "expected exactly one retry after the 401");
    assert.equal(tokenCalls, 2, "expected exactly one forced re-exchange after the 401 (plus the initial one)");
  });

  test("transient 503 retries once without touching auth, then succeeds", async () => {
    let dataCalls = 0;
    mockFetchSequence((url) => {
      if (url.includes("/users/v3/token")) {
        return { status: 200, body: { success: true, token: { access_token: "abc", expires_in: 3600 } } };
      }
      dataCalls += 1;
      if (dataCalls === 1) return { status: 503, body: "unavailable" };
      return { status: 200, body: [{ workoutId: 9, athleteId: 42, workoutDay: "2026-06-13T00:00:00" }] };
    });

    const result = await getWorkoutsByDateRange(42, "2026-06-13", "2026-06-13");
    assert.equal(result.length, 1);
    assert.equal(dataCalls, 2);
  });

  test("non-transient 400 (not the gone-signature) throws immediately, no retry", async () => {
    let dataCalls = 0;
    mockFetchSequence((url) => {
      if (url.includes("/users/v3/token")) {
        return { status: 200, body: { success: true, token: { access_token: "abc", expires_in: 3600 } } };
      }
      dataCalls += 1;
      return { status: 400, body: "some other bad request" };
    });

    await assert.rejects(() => getWorkoutsByDateRange(42, "2026-06-13", "2026-06-13"));
    assert.equal(dataCalls, 1, "must not retry a non-transient, non-auth error");
  });

  test("missing workoutId in a returned item throws TpApiSchemaError loudly", async () => {
    mockFetchSequence((url) => {
      if (url.includes("/users/v3/token")) {
        return { status: 200, body: { success: true, token: { access_token: "abc", expires_in: 3600 } } };
      }
      return { status: 200, body: [{ athleteId: 42, workoutDay: "2026-06-13T00:00:00" }] };
    });

    await assert.rejects(() => getWorkoutsByDateRange(42, "2026-06-13", "2026-06-13"), TpApiSchemaError);
  });

  test("dedups by workoutId across chunk boundaries", async () => {
    mockFetchSequence((url) => {
      if (url.includes("/users/v3/token")) {
        return { status: 200, body: { success: true, token: { access_token: "abc", expires_in: 3600 } } };
      }
      // Both chunks (of a >90-day range) return the SAME workoutId -- must dedup to one entry.
      return { status: 200, body: [{ workoutId: 555, athleteId: 42, workoutDay: "2026-01-01T00:00:00" }] };
    });

    const result = await getWorkoutsByDateRange(42, "2026-01-01", "2026-08-01"); // 3 chunks
    assert.equal(result.length, 1, "identical workoutId returned by multiple chunks must dedup to one");
  });

  test("getHealthMetrics flattens multiple chunks without deduping (no workoutId concept)", async () => {
    mockFetchSequence((url) => {
      if (url.includes("/users/v3/token")) {
        return { status: 200, body: { success: true, token: { access_token: "abc", expires_in: 3600 } } };
      }
      return { status: 200, body: [{ date: "2026-06-13" }] };
    });
    const result = await getHealthMetrics(42, "2026-01-01", "2026-08-01"); // 3 chunks
    assert.equal(result.length, 3);
  });
});
