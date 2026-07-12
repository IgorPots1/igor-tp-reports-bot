# TP API Client (PR2) — Notes

Companion to `docs/tp-api-capability-matrix.md` (PR1). Covers the two carried-over tails from PR1 §A that this PR
was responsible for closing, plus a summary of what was built and verified.

## What was built

`src/features/trainingpeaks/tp-api-client.ts` — read-only client (no POST/PUT/DELETE anywhere in the module):

- Auth: profile-derived session snapshot (see below) → cookie → `GET /users/v3/token` → bearer, cached in memory,
  refreshed once per call on 401/403 (not a process-lifetime flag — see code comment for why this differs
  slightly in scope from `tp-scan-events.ts`'s single-run pattern, while still being "one-time refresh before
  retry").
- `chunkDateRangeInclusive()` — 90-day chunking, inclusive both ends, no overlap (next chunk starts at previous
  end + 1 day). Pure, exported, unit-tested directly.
- `getWorkoutsByDateRange`, `getWorkoutDetail`, `getHealthMetrics`, `getEvents`, `getStrengthWorkout` (peakswaresb
  host, same bearer).
- Retry: exactly one retry (2 attempts), transient = 408/429/≥500, zero backoff (lifted from
  `tp-scan-events.ts`), bounded worker-pool concurrency (1–5, default 3, no new dependency).
- Schema validation: throws `TpApiSchemaError` loudly on the handful of fields the client structurally depends on
  (`workoutId`, `athleteId`, `workoutDay`, strength `data.id`) rather than silently returning malformed data. Full
  raw object is preserved on `TpWorkoutSummary.raw` for callers needing fields not explicitly modeled.
- `isWorkoutGone(status, body)` — exported for PR3/PR4: tpapi returns HTTP 400 `"Invalid workoutId (<id>)"` for a
  deleted workout, not 404/403 (PR1 finding). Both forms are covered.
- Dedup by `workoutId` across chunk results — write invariant, defensive even though chunks are designed not to
  overlap.

`src/features/trainingpeaks/tp-session-snapshot.ts` — shared snapshot type/path/read/write, importable from both
`src/` (the client) and `tools/` (the refresh script), matching the existing one-way `tools/` → `src/` import
convention already used throughout the codebase.

`tools/trainingpeaks-export/scripts/tp-refresh-session-snapshot.ts` — the only Playwright-touching piece of this
design. Extracts `Production_tpAuth` from the persistent profile and writes the snapshot.

First test file in this repo: `src/features/trainingpeaks/tp-api-client.test.ts`, using Node's built-in
`node:test` (zero new dependency, consistent with the codebase's existing preference for plain
`node --experimental-strip-types` scripts over a heavier framework). **19/19 passing.** Run via
`npm run test:tp-api-client`.

One small, additive tsconfig change was required to make this runnable both by `tsc` and by plain Node:
`"allowImportingTsExtensions": true` — TypeScript's officially-supported way to permit explicit `.ts` import
extensions when `noEmit` is already set (it already was). This only *permits* something previously disallowed; it
does not change resolution of any existing extensionless import.

## Snapshot-export verdict (owned by this PR per plan §D)

**Solved.** Design: a single JSON file at a fixed, worktree-independent path —
`~/.tp-reports-bot/session-snapshot.json` (outside any git checkout, `mode 0600`). The Playwright-based refresh
script (run from whichever checkout has the one true logged-in profile — empirically the primary checkout,
`/Users/igor/igor-tp-reports-bot`) writes it; every worktree's `tp-api-client.ts` reads the same file via a plain
`fs.readFile`, no Playwright dependency needed there at all.

**Verified live, end-to-end, this pass:**
1. Ran `tp-refresh-session-snapshot.ts` from the primary checkout (the one with a logged-in profile) → wrote the
   snapshot (`cookie_length: 1776`, expiry `2026-08-11T17:51Z` — consistent with PR1's ~30-day TTL finding).
2. From a **completely different worktree** (`feature/tp-api-client`, which has no Playwright profile of its own
   — confirmed empty in PR1), called `getWorkoutsByDateRange` for a real athlete with zero Playwright involvement
   in that process. It authenticated via the snapshot and returned real data. **This is the strongest possible
   proof the cross-worktree design works, not just an inspection of the code.**

**Races, and how they're handled:**
- **Snapshot write vs. concurrent read:** solved by atomic write (temp file in the same directory +
  `rename()`, which is atomic on the same POSIX filesystem) — a reader never observes a partially-written file.
  No lock file needed for this half.
- **Two Playwright processes on the same profile (the real unresolved race):** Chromium disallows opening the
  same `user-data-dir` from two processes at once. If the refresh script runs while `tp-actions-once.ts` (or
  another Playwright-based script) already holds the profile, the refresh will fail. This is handled as a
  **non-fatal, loud failure** — the script detects the likely lock error, prints a clear message, exits 1, and
  **leaves the existing snapshot untouched** (thanks to the atomic-write design, a failed refresh can never
  corrupt or blank out a previously-good snapshot). Recommendation carried to PR3/PR4: don't run the refresh
  concurrently with DOM-writer sessions; a cron schedule that avoids known DOM-automation windows, or a
  best-effort retry wrapper, is enough — not attempted in this PR since it's an availability concern, not a
  correctness one.

## 17-vs-18 discrepancy — CLASSIFIED, closed

Per plan §A open question: athlete `5931798`, window `2026-06-13…2026-07-11`, live API had returned 17 workouts
while `trainingpeaks_workout_cache` held 18 (observed during PR1). Diffed the `workoutId` lists this pass:

- **Live re-read via the new client (from a worktree with zero Playwright profile):** 17 workouts.
- **Current cache state (same athlete/window):** also 17 workouts, **identical `workoutId` set, one-to-one.**
- The workout that caused the extra row, `workoutId 3827395676` (a *planned, not-yet-completed* running workout
  dated exactly `2026-07-11`, the last day of the window), **no longer exists anywhere in
  `trainingpeaks_workout_cache`** — not just outside this window, gone from the whole table.

**Classification: transient staleness, self-resolved by ordinary subsequent scanning — not a duplicate
`workoutId`, not an out-of-range record, and not "deleted in the API but still alive in the cache" as a bug.** At
the time of the original PR1 observation, the cache still held a future-planned workout that a later cron scan
(most recent `scanned_at` for this athlete: `2026-07-12 17:00:06Z`, i.e. after the original observation) removed
or superseded during its normal incremental update. Both sides now agree exactly. **Dedup-by-`workoutId` remains
a cache-write invariant regardless** (already encoded as a defensive behavior in `getWorkoutsByDateRange`, per
plan §A), but no fix was required for this specific discrepancy — it was not a bug.

One residual, minor observation for whoever owns the cache-scan cadence: a briefly-stale future-planned row is an
inherent characteristic of any cache with a scan interval, not a defect. Not actioned here (out of scope for a
read-client PR), just noted for awareness.
