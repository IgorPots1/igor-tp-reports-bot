// Check for the workout-cache reconciliation logic (phantom-plan cleanup).
//
// Covers the four safety scenarios from the hardening brief:
//   1. "Move"    — plan moved D -> D+2: the refreshed D+2 row is kept, no stale D row.
//   2. "Delete"  — plan on D deleted in TP: the stale D row is removed.
//   3. "Live"    — future uncompleted plan still in TP: refreshed, kept.
//   4. "Scan 401"— student scan failed: reconcile is a no-op (nothing deleted).
//
// The predicate under test (plannedCacheRowIsStale / selectRowsToReconcile) is the
// single source of truth mirrored by the supabase delete in
// reconcileTrainingPeaksWorkoutCachePlannedRows (repository.ts).

import {
  plannedCacheRowIsStale,
  selectRowsToReconcile,
  type PlannedCacheRowForReconcile,
  type ReconcileWindow,
} from "@/features/trainingpeaks/workout-cache-reconcile";

// Window scanned this run: [-10 .. +10] around 2026-07-08, run fixed at 12:00Z.
const WIN: ReconcileWindow = {
  from: "2026-06-28",
  to: "2026-07-18",
  runStartedAt: "2026-07-08T12:00:00.000Z",
};

// scanned_at written this run for every upserted (refreshed) row.
const FRESH = "2026-07-08T12:00:00.000Z"; // === runStartedAt
// scanned_at from a previous run (older) — anything TP no longer returns keeps this.
const STALE = "2026-07-05T09:00:00.000Z";

type Row = PlannedCacheRowForReconcile & { label: string };

function row(
  label: string,
  overrides: Partial<PlannedCacheRowForReconcile>,
): Row {
  return {
    label,
    workout_date: "2026-07-10",
    is_planned: true,
    is_completed: false,
    scanned_at: FRESH,
    ...overrides,
  };
}

let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ok   - ${message}`);
  } else {
    failed += 1;
    console.log(`  FAIL - ${message}`);
  }
}

// --- Predicate-level cases -------------------------------------------------

// Scenario 2: deleted plan — stale, planned, not completed, inside window.
assert(
  plannedCacheRowIsStale(row("deleted-plan", { scanned_at: STALE }), WIN),
  "deleted plan (stale, planned, open, in-window) is flagged stale",
);

// Scenario 3: live plan refreshed this run — scanned_at === runStartedAt -> kept.
assert(
  !plannedCacheRowIsStale(row("live-refreshed", { scanned_at: FRESH }), WIN),
  "live refreshed plan (scanned_at === runStartedAt) is NOT stale",
);

// Scenario 3b: future uncompleted plan still in TP, refreshed -> kept.
assert(
  !plannedCacheRowIsStale(
    row("live-future", { workout_date: "2026-07-16", scanned_at: FRESH }),
    WIN,
  ),
  "future uncompleted plan refreshed this run is NOT stale",
);

// Completed rows are never touched, even if stale.
assert(
  !plannedCacheRowIsStale(
    row("completed-stale", { is_completed: true, scanned_at: STALE }),
    WIN,
  ),
  "completed row is never stale (never deleted), even when scanned_at is old",
);

// A non-planned (actual-only) stale row is not a phantom plan.
assert(
  !plannedCacheRowIsStale(
    row("actual-only", { is_planned: false, scanned_at: STALE }),
    WIN,
  ),
  "non-planned row is not treated as a stale plan",
);

// Out-of-window stale plan is left alone (reconcile only heals inside the window).
assert(
  !plannedCacheRowIsStale(
    row("out-of-window", { workout_date: "2026-05-01", scanned_at: STALE }),
    WIN,
  ),
  "stale plan outside the scanned window is NOT deleted",
);

// --- Full-run selection cases ---------------------------------------------

// Post-scan DB state for one student. A plan was moved D(2026-07-10) -> D+2(2026-07-12):
// the upsert (keyed on workout_id) updated the SAME row in place to D+2 with a fresh
// scanned_at, so there is no separate D row. A different, older plan on 2026-07-02 was
// deleted in TP and lingers with a stale scanned_at.
const postScanRows: Row[] = [
  row("moved-to-D+2", { workout_date: "2026-07-12", scanned_at: FRESH }),
  row("live-today", { workout_date: "2026-07-08", scanned_at: FRESH }),
  row("deleted-plan", { workout_date: "2026-07-02", scanned_at: STALE }),
  row("completed-old", {
    workout_date: "2026-07-01",
    is_completed: true,
    scanned_at: STALE,
  }),
];

// Scenarios 1-3 together: only the deleted phantom is removed on a successful scan.
const deletedOnOk = selectRowsToReconcile(postScanRows, WIN, true);
assert(
  deletedOnOk.length === 1 && deletedOnOk[0]?.label === "deleted-plan",
  "successful scan deletes exactly the one deleted/phantom plan (move + live kept)",
);

// Scenario 4: failed scan (e.g. HTTP 401) — reconcile must delete nothing.
const deletedOnFail = selectRowsToReconcile(postScanRows, WIN, false);
assert(
  deletedOnFail.length === 0,
  "failed scan (scanOk=false) deletes nothing — live plans are safe",
);

if (failed > 0) {
  console.log(`\ncheck-trainingpeaks-workout-cache-reconcile: FAILED (${failed})`);
  process.exitCode = 1;
} else {
  console.log("\ncheck-trainingpeaks-workout-cache-reconcile: PASSED");
}
