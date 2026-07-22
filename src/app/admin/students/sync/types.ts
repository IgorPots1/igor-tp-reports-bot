import type { ImportPlan } from "@/features/trainingpeaks/athlete-roster-import";

/**
 * Result of the live "Sync from TrainingPeaks" preview action. Shared between the
 * server action (return type) and the client panel (rendering). Kept out of the
 * "use server" actions file so that file only exports async functions.
 */
export type TrainingPeaksRosterSyncPreviewResult =
  | { ok: true; plan: ImportPlan }
  | {
      ok: false;
      kind: "snapshot_missing" | "auth_stale" | "tp_http" | "tp_schema" | "unknown";
      message: string;
    };
