import { RECONCILE_REMOVED_MARKER } from "@/features/club/tp-reconcile";

// A club race row can reach status='rejected' by two DISTINCT causes, which otherwise look identical
// in the admin queue (both just say "отклонён"):
//   - the coach rejected the request himself (setCalendarEntryStatus) — no marker;
//   - reconciliation found the TP event was deleted directly in TP (club-reconcile-tp) — the reason
//     is stamped into tp_send_error with RECONCILE_REMOVED_MARKER.
// (A student cancelling their own start does NOT land here — that path DELETES the row, per the
// delete-flow design.) This pure helper turns those signals into a short human reason. Returns null
// for a non-rejected row.
export function rejectedRaceReason(status: string, tpSendError: string | null): string | null {
  if (status !== "rejected") return null;
  if (tpSendError && tpSendError.startsWith(RECONCILE_REMOVED_MARKER)) return "снято в TP (сверка)";
  return "отклонено тренером";
}
