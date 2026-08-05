/**
 * autoplanner-provenance — the durable provenance cutoff (spec §1.0, override П5).
 *
 * The easy anchor is built from workout descriptions. It must NEVER learn from its own generated
 * output (layer conflation). The durable artifact is a fixed CUTOFF DATE, not a per-row column:
 * every description already in the cache before the generator's first write is coach-authored.
 *
 * As of this sprint the autoplanner is SHADOW-ONLY — it writes nothing to TrainingPeaks — so every
 * existing description is coach-authored. When the generator first writes a real workout, it must
 * stamp provenance='generated' on that row (and 'generated_coach_edited' if Igor edits it), and the
 * anchor pool must then exclude pure 'generated' rows. Until then this cutoff is the single guard.
 *
 * BLOCKING (spec §1.0): this cutoff must be committed BEFORE the first generation write.
 * Retroactively unmarkable — you cannot later tell coach text from machine text.
 */

/** Descriptions from workouts scanned/created strictly before this date are coach-authored. */
export const COACH_AUTHORED_BEFORE = "2026-08-01";

/** The autoplanner has NOT written any workout yet. Set to the ISO date of the first real
 *  generation write when v2 goes live; until then, everything is coach-authored. */
export const AUTOPLANNER_FIRST_GENERATION_DATE: string | null = null;

export type Provenance = "coach_authored" | "generated" | "generated_coach_edited";

/** Provenance of a cache description, by the workout's scan/creation date, until per-row stamping
 *  exists (v2). Before the cutoff → coach_authored; the generator stamps rows it writes thereafter. */
export function provenanceByDate(workoutScannedOrCreated: string | null): Provenance {
  if (AUTOPLANNER_FIRST_GENERATION_DATE === null) return "coach_authored";
  return workoutScannedOrCreated && workoutScannedOrCreated < COACH_AUTHORED_BEFORE ? "coach_authored" : "generated";
}

/** Rows eligible for the easy-anchor pool (spec §1.0): coach_authored or coach-edited only. */
export function eligibleForAnchor(p: Provenance): boolean {
  return p === "coach_authored" || p === "generated_coach_edited";
}
