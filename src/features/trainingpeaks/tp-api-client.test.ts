import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, afterEach, before, describe, test } from "node:test";

import {
  chunkDateRangeInclusive,
  createStrengthWorkout,
  createWorkout,
  deleteWorkout,
  getCoachedAthletesRoster,
  getHealthMetrics,
  getWorkoutsByDateRange,
  isWorkoutGone,
  putWorkout,
  resetTpApiClientAuthCacheForTests,
  TpApiHttpError,
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

// ─── writes (PR3) -- mocked fetch only, NEVER invoked against real TrainingPeaks ──

describe("write functions (mocked network)", () => {
  let tmpDir: string;
  let originalFetch: typeof fetch;

  before(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "tp-api-client-write-test-"));
    const snapshotPath = path.join(tmpDir, "session-snapshot.json");
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

  function mockFetchSequence(responder: (url: string, method: string, body: unknown) => { status: number; body: unknown }) {
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const parsedBody = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      const { status, body } = responder(url, method, parsedBody);
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
  }

  test("createWorkout POSTs with workoutId:0 and returns the server-assigned numeric id", async () => {
    let capturedMethod = "";
    let capturedBody: Record<string, unknown> | null = null;
    mockFetchSequence((url, method, body) => {
      if (url.includes("/users/v3/token")) return { status: 200, body: { success: true, token: { access_token: "abc", expires_in: 3600 } } };
      capturedMethod = method;
      capturedBody = body as Record<string, unknown>;
      return { status: 200, body: { workoutId: 3840679213, title: "Test" } };
    });

    const result = await createWorkout({
      athleteId: 42,
      workoutDay: "2026-08-01",
      title: "Test",
      workoutTypeValueId: 3,
      workoutSubTypeId: null,
      description: null,
      coachComments: null,
      distancePlanned: null,
      totalTimePlanned: 1.5,
      structure: null,
    });

    assert.equal(result.workoutId, 3840679213);
    assert.equal(capturedMethod, "POST");
    assert.equal((capturedBody as Record<string, unknown> | null)?.workoutId, 0, "must send workoutId:0 to signal create");
  });

  test("putWorkout PUTs the full merged body to the workout's own endpoint", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    mockFetchSequence((url, method) => {
      if (url.includes("/users/v3/token")) return { status: 200, body: { success: true, token: { access_token: "abc", expires_in: 3600 } } };
      capturedUrl = url;
      capturedMethod = method;
      return { status: 200, body: { workoutId: 123, title: "Updated" } };
    });

    const result = await putWorkout(42, 123, { title: "Updated", distancePlanned: 5000 });
    assert.equal(capturedMethod, "PUT");
    assert.match(capturedUrl, /\/fitness\/v6\/athletes\/42\/workouts\/123$/);
    assert.equal(result.title, "Updated");
  });

  test("deleteWorkout DELETEs and returns the raw status/body for the caller to interpret via isWorkoutGone", async () => {
    let capturedMethod = "";
    mockFetchSequence((url, method) => {
      if (url.includes("/users/v3/token")) return { status: 200, body: { success: true, token: { access_token: "abc", expires_in: 3600 } } };
      capturedMethod = method;
      return { status: 200, body: true };
    });

    const result = await deleteWorkout("tpapi", 42, 123);
    assert.equal(capturedMethod, "DELETE");
    assert.equal(result.status, 200);
    assert.equal(isWorkoutGone(result.status, result.body), false, "a 200 from the DELETE call itself is not yet 'gone' -- gone is checked on the FOLLOW-UP GET");
  });

  test("createStrengthWorkout POSTs to the peakswaresb /save endpoint (PR1-resolved single atomic call)", async () => {
    let capturedUrl = "";
    mockFetchSequence((url) => {
      if (url.includes("/users/v3/token")) return { status: 200, body: { success: true, token: { access_token: "abc", expires_in: 3600 } } };
      capturedUrl = url;
      return { status: 200, body: { data: { id: "22291958", complianceState: "NoCompletion" } } };
    });

    const result = await createStrengthWorkout({
      workoutType: "StructuredStrength",
      calendarId: 3102415,
      prescribedDate: "2026-08-01",
      title: "Test strength",
      blocks: [],
    });

    assert.match(capturedUrl, /api\.peakswaresb\.com\/rx\/activity\/v1\/workouts\/save$/);
    assert.equal(result.id, "22291958");
  });

  test("write functions surface a TpApiHttpError (with the real status/body) on a non-2xx response", async () => {
    mockFetchSequence((url) => {
      if (url.includes("/users/v3/token")) return { status: 200, body: { success: true, token: { access_token: "abc", expires_in: 3600 } } };
      return { status: 500, body: "server error" };
    });

    await assert.rejects(
      () =>
        createWorkout({
          athleteId: 42,
          workoutDay: "2026-08-01",
          title: "Test",
          workoutTypeValueId: 3,
          workoutSubTypeId: null,
          description: null,
          coachComments: null,
          distancePlanned: null,
          totalTimePlanned: null,
          structure: null,
        }),
      (error: unknown) => error instanceof TpApiHttpError && error.status === 500,
    );
  });
});

// ─── getCoachedAthletesRoster (read-only roster fetch, mocked network) ─────────

describe("getCoachedAthletesRoster (mocked network)", () => {
  let tmpDir: string;
  let originalFetch: typeof fetch;

  before(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "tp-api-client-roster-test-"));
    const snapshotPath = path.join(tmpDir, "session-snapshot.json");
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

  function mockFetchSequence(responder: (url: string) => { status: number; body: unknown }) {
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      const { status, body } = responder(url);
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
  }

  test("GETs /users/v3/user and maps user.athletes[] into normalized rows", async () => {
    let rosterCalls = 0;
    mockFetchSequence((url) => {
      if (url.includes("/users/v3/token")) {
        return { status: 200, body: { success: true, token: { access_token: "abc", expires_in: 3600 } } };
      }
      assert.ok(url.includes("/users/v3/user"), "roster fetch must hit /users/v3/user");
      rosterCalls += 1;
      return {
        status: 200,
        body: {
          user: {
            athletes: [
              { athleteId: 222, firstName: "Boris", lastName: "Petrov" },
              { athleteId: 111, fullName: "Anna Ivanova" },
              { athleteId: 333 }, // no name -> fallback
            ],
          },
        },
      };
    });

    const roster = await getCoachedAthletesRoster();
    assert.equal(rosterCalls, 1);
    // sorted by display name: "Anna Ivanova", "Athlete 333", "Boris Petrov"
    assert.deepEqual(
      roster.map((r) => [r.athleteId, r.displayName]),
      [
        [111, "Anna Ivanova"],
        [333, "Athlete 333"],
        [222, "Boris Petrov"],
      ],
    );
    assert.equal(roster[0].trainingpeaksAthleteUrl, "https://app.trainingpeaks.com/#calendar/athletes/111");
  });

  test("a legitimately empty roster returns []", async () => {
    mockFetchSequence((url) => {
      if (url.includes("/users/v3/token")) {
        return { status: 200, body: { success: true, token: { access_token: "abc", expires_in: 3600 } } };
      }
      return { status: 200, body: { user: { athletes: [] } } };
    });

    assert.deepEqual(await getCoachedAthletesRoster(), []);
  });

  test("a structurally wrong body (missing user.athletes) throws TpApiSchemaError", async () => {
    mockFetchSequence((url) => {
      if (url.includes("/users/v3/token")) {
        return { status: 200, body: { success: true, token: { access_token: "abc", expires_in: 3600 } } };
      }
      return { status: 200, body: { user: { profile: {} } } };
    });

    await assert.rejects(() => getCoachedAthletesRoster(), TpApiSchemaError);
  });
});
