/**
 * Delete ONE orphan TP entity by kind + id — for cleanup of entities NOT linked to any
 * club_calendar_entry (so execute-one cannot reach them). Read the actual kind from a state
 * audit first; passing the wrong kind hits the wrong endpoint.
 *
 * SAFETY: needs the athlete id, an explicit kind, an id, AND CLUB_TP_EXECUTION_ENABLED=true.
 * Without the env flag it is a DRY-RUN (prints, deletes nothing). Igor's hand.
 *
 *   CLUB_TP_EXECUTION_ENABLED=true node --experimental-strip-types \
 *     --loader ./scripts/_alias-loader.mjs --env-file=/Users/igor/igor-tp-reports-bot/.env.local \
 *     scripts/club-tp-delete.ts <workout|event|note|availability> <tpId> [athleteId]
 * Default athleteId = Igor (3102415).
 */
import { deleteWorkout, deleteEvent, deleteNote, deleteAvailability } from "@/features/trainingpeaks/tp-api-client";

const kind = process.argv[2];
const tpId = Number(process.argv[3]);
const athleteId = Number(process.argv[4] ?? "3102415");

async function main(): Promise<void> {
  if (!["workout", "event", "note", "availability"].includes(kind) || !Number.isFinite(tpId)) {
    console.error("usage: club-tp-delete.ts <workout|event|note|availability> <tpId> [athleteId]");
    process.exit(1);
  }
  const gated = process.env.CLUB_TP_EXECUTION_ENABLED === "true";
  if (!gated) {
    console.log(`DRY-RUN: удалил бы ${kind} ${tpId} (athlete ${athleteId}). Для реального удаления: CLUB_TP_EXECUTION_ENABLED=true.`);
    process.exit(0);
  }
  const del = kind === "event"
    ? await deleteEvent(athleteId, tpId)
    : kind === "note"
    ? await deleteNote(athleteId, tpId)
    : kind === "availability"
    ? await deleteAvailability(athleteId, tpId)
    : await deleteWorkout("tpapi", athleteId, tpId);
  console.log(`delete ${kind} ${tpId} status=${del.status}`);
  process.exit(del.status >= 200 && del.status < 300 ? 0 : 1);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
