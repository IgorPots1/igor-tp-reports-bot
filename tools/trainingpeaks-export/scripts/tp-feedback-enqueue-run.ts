// Local feedback-enqueue runner — the SAME logic as the Vercel cron route
// (src/app/api/cron/trainingpeaks-workout-feedback-enqueue), but run on the Mac right
// after fit-ingest computes metrics. This is how «one service does both»: fit-ingest
// writes derived_metrics → this scans what changed since the last successful enqueue and
// drops feedback jobs into «Новые». ZERO Vercel crons — nothing to pay Pro for.
//
// It ONLY enqueues (fills the list). Generation stays Igor's Mini App tap (Вариант Б).
// Uses the shared cron-run-log (job "workout_feedback_enqueue"), so the "since last run"
// window — and thus the guard against re-scanning already-processed metrics — is identical
// to the HTTP cron. Idempotent: the active-workout unique index skips duplicates.

import { loadLocalEnv } from "./lib/local-env.ts";

loadLocalEnv();

import { sweepAndEnqueueFeedbackJobs } from "../../../src/features/trainingpeaks/feedback/feedback-enqueue.ts";
import { reclaimStaleGeneratingFeedbackJobs } from "../../../src/features/trainingpeaks/feedback/feedback-queue.ts";
import { STALE_GENERATING_TTL_MS } from "../../../src/features/trainingpeaks/feedback/feedback-worker-auth.ts";
import {
  createTrainingPeaksCronRunLog,
  finishTrainingPeaksCronRunLog,
  getLatestTrainingPeaksCronRunLog,
} from "../../../src/features/trainingpeaks/repository.ts";

const CRON_JOB_NAME = "workout_feedback_enqueue";
// First-run / no-prior-log window (mirrors the HTTP route).
const DEFAULT_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;

async function main(): Promise<void> {
  const startedAtMs = Date.now();
  const runLog = await createTrainingPeaksCronRunLog({
    jobName: CRON_JOB_NAME,
    source: "manual",
    status: "started",
    requestPath: "launchd:run-fit-ingest-scan",
  });

  try {
    // Reclaim any generation that was claimed but never submitted (crashed/abandoned) —
    // the on-demand path doesn't reclaim, so this hourly run is the server-side safety net.
    await reclaimStaleGeneratingFeedbackJobs(new Date(startedAtMs - STALE_GENERATING_TTL_MS).toISOString()).catch(() => {});

    const lastOk = await getLatestTrainingPeaksCronRunLog({ jobName: CRON_JOB_NAME, status: "sent" });
    const sinceUpdatedAt = lastOk?.startedAt ?? new Date(startedAtMs - DEFAULT_LOOKBACK_MS).toISOString();

    const summary = await sweepAndEnqueueFeedbackJobs({ sinceUpdatedAt });

    await finishTrainingPeaksCronRunLog(runLog.id, {
      status: "sent",
      durationMs: Date.now() - startedAtMs,
      responseStatus: 200,
      counts: { ...summary, sinceUpdatedAt },
    });
    console.log(`[tp-feedback-enqueue-run] ${JSON.stringify({ ...summary, sinceUpdatedAt })}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishTrainingPeaksCronRunLog(runLog.id, {
      status: "failed",
      durationMs: Date.now() - startedAtMs,
      responseStatus: 500,
      errorMessage: message,
    }).catch(() => {});
    console.error(`[tp-feedback-enqueue-run] failed: ${message}`);
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(`[tp-feedback-enqueue-run] fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
