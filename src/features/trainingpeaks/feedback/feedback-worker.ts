// Cowork worker seam (real Cowork as generator, manual run). The Cowork skill can't
// import the TypeScript fact-check, so it drives two thin HTTP endpoints instead of
// touching the DB directly: claim (this batch) → the model generates each draft from
// the returned prompt → submit (→ submitFeedbackDraft → fact-check → write). This
// module is the shared logic behind those endpoints, kept out of the routes so it is
// unit-testable and the routes stay thin.
//
// Generation happens ON THE SUBSCRIPTION (the Cowork model writes the text); nothing
// here calls a paid API. The endpoints only move jobs through the queue and hand back
// the already-assembled prompt.

import { assembleFeedbackPrompt } from "@/features/trainingpeaks/feedback/feedback-prompt";
import {
  claimNextPendingFeedbackJob,
  reclaimStaleGeneratingFeedbackJobs,
} from "@/features/trainingpeaks/feedback/feedback-queue";
import { STALE_GENERATING_TTL_MS, clampWorkerLimit } from "@/features/trainingpeaks/feedback/feedback-worker-auth";

// Re-export the auth core so callers (routes) have one worker entry point.
export {
  DEFAULT_WORKER_BATCH,
  MAX_WORKER_BATCH,
  STALE_GENERATING_TTL_MS,
  verifyFeedbackWorkerRequest,
  type WorkerAuthResult,
} from "@/features/trainingpeaks/feedback/feedback-worker-auth";

export type FeedbackWorkerJob = {
  jobId: string;
  prompt: string;
  // Labels for the worker's log/coach-note only — NOT the student's name (the prompt
  // is voice-only: register/sex, never a name). Nothing here identifies the student.
  sessionType: string | null;
  workoutDate: string;
};

export type ClaimFeedbackWorkerBatchResult = {
  reclaimed: number; // stale 'generating' jobs reset to 'pending' before claiming
  claimed: number;
  jobs: FeedbackWorkerJob[];
};

/**
 * One worker pass: reclaim crashed jobs, then CAS-claim up to `limit` pending jobs and
 * assemble each one's prompt. The CAS in claimNextPendingFeedbackJob guarantees two
 * concurrent passes never take the same job — a double run yields disjoint batches.
 */
export async function claimFeedbackWorkerBatch(input: { limit?: number; nowMs?: number } = {}): Promise<ClaimFeedbackWorkerBatchResult> {
  const limit = clampWorkerLimit(input.limit);
  const nowMs = input.nowMs ?? Date.now();
  const cutoffIso = new Date(nowMs - STALE_GENERATING_TTL_MS).toISOString();

  const { reclaimed } = await reclaimStaleGeneratingFeedbackJobs(cutoffIso);

  const jobs: FeedbackWorkerJob[] = [];
  for (let i = 0; i < limit; i += 1) {
    const job = await claimNextPendingFeedbackJob();
    if (!job) break; // queue drained
    jobs.push({
      jobId: job.id,
      prompt: assembleFeedbackPrompt(job.contextPacket),
      sessionType: job.contextPacket?.sessionType ?? null,
      workoutDate: job.contextPacket?.workoutDate ?? job.createdAt.slice(0, 10),
    });
  }

  return { reclaimed, claimed: jobs.length, jobs };
}
