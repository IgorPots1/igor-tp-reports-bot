// Shared, side-effect-free helpers for the club → TP reconciliation (club-reconcile-tp-once.ts):
// direction "deleted in TP → reflected in the app". Kept in its own module so the invariants can be
// unit-tested without importing the runner (which touches the DB + TP on import).

/** Marker prefix written into tp_send_error when reconciliation removes a vanished start, so the
 *  coach admin can list "removed directly in TP" separately from send/rollback failures. */
export const RECONCILE_REMOVED_MARKER = "СВЕРКА:";

/** 404 → the TP event is GONE (deleted directly in TP by a human). ONLY 404 counts as gone: a 5xx
 *  or a transient error must NOT reject a live race, so anything else is "unknown, leave it". */
export function isEventGone(status: number): boolean {
  return status === 404;
}

/** 2xx → the event is still in TP. Reconciliation does nothing for these. */
export function isEventPresent(status: number): boolean {
  return status >= 200 && status < 300;
}

/**
 * Lower-bound ISO date (inclusive) for reconciliation: today minus `days`. Past races older than
 * this are skipped — a finished race removed in TP is not actionable and not worth a request.
 * Pure (takes today as input), so it is deterministic and testable.
 */
export function reconcileCutoffIso(todayIso: string, days: number): string {
  const [y, m, d] = todayIso.split("-").map((n) => Number.parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - days);
  return dt.toISOString().slice(0, 10);
}
