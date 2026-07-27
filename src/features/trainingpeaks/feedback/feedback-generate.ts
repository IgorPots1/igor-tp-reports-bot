// On-demand generation engine (API path) — the motor behind Igor's «Сгенерить» tap and
// the "Сгенерить свежие (до N)" batch. It wires the previously-unwired API generator into
// the queue: claim ONE pending job → assemble its frozen prompt → call the Anthropic API
// in-process → run it back through submitFeedbackDraft (the SHARED fact-check seam). No
// auto-generation, no cron — every draft is a deliberate tap. Cowork stays the offline
// fallback (a separate desktop worker); when the active backend is 'cowork' this refuses,
// so the paid path never fires behind Igor's back.

import {
  claimSpecificPendingFeedbackJob,
  listTrainingPeaksFeedbackJobs,
  resetFeedbackJobToPending,
  submitFeedbackDraft,
} from "@/features/trainingpeaks/feedback/feedback-queue";
import { generateFeedbackDraftViaApi } from "@/features/trainingpeaks/feedback/feedback-generator";
import { getActiveFeedbackGeneratorBackend } from "@/features/trainingpeaks/feedback/feedback-backend-mode";
import { assembleFeedbackPrompt } from "@/features/trainingpeaks/feedback/feedback-prompt";
import { scoreFeedbackSignificance } from "@/features/trainingpeaks/feedback/feedback-significance";
import type { FeedbackContextPacket } from "@/features/trainingpeaks/feedback/context-packet";

/** Hard cap on a single batch tap — a deliberate guard so 100 generations can't fire by accident. */
export const MAX_BATCH = 10;

export type GenerateOneOutcome =
  | { status: "done"; jobId: string; draftText: string }
  | { status: "failed"; jobId: string; reason: string } // draft produced but rejected by fact-check
  | { status: "error"; jobId: string; reason: string } // API/transport error — job reset to pending, retriable
  | { status: "skipped"; jobId: string; reason: string } // not pending (already generating/done/dismissed)
  | { status: "refused"; jobId: string; reason: string }; // active backend is not 'api'

/**
 * Generate ONE job through the API path. Claims it (pending→generating) so a double-tap
 * or a concurrent batch can't generate it twice; on an API error it's reset to pending
 * (retriable) rather than left stranded in 'generating'.
 */
export async function generateOneFeedbackJobViaApi(jobId: string): Promise<GenerateOneOutcome> {
  const backend = await getActiveFeedbackGeneratorBackend();
  if (backend !== "api") {
    return { status: "refused", jobId, reason: "Активен режим Cowork — генерация идёт из десктопа, не по кнопке. Переключи режим на API." };
  }

  const job = await claimSpecificPendingFeedbackJob(jobId);
  if (!job) {
    return { status: "skipped", jobId, reason: "Задача уже не в очереди (генерируется, готова или убрана)." };
  }

  const prompt = assembleFeedbackPrompt(job.contextPacket as FeedbackContextPacket);
  const result = await generateFeedbackDraftViaApi(prompt);
  if (!result.ok) {
    // Never produced a draft — put it back so the card stays in «Новые» and is retriable.
    await resetFeedbackJobToPending({ jobId, errorReason: result.error });
    return { status: "error", jobId, reason: result.error };
  }

  const submitted = await submitFeedbackDraft({ jobId, draftText: result.text, backend: "api" });
  if (submitted.status === "failed") {
    return { status: "failed", jobId, reason: submitted.reason ?? "факт-чек отклонил черновик" };
  }
  // Return the STORED normalized draft (dash stripped, greeting/format fixed), not the raw model
  // text — so the coach's editable preview matches what was saved and will be sent.
  return { status: "done", jobId, draftText: submitted.draftText ?? result.text };
}

export type GenerateBatchSummary = {
  requested: number;
  done: number;
  failed: number;
  errored: number;
  skipped: number;
  refused: number;
  outcomes: GenerateOneOutcome[];
};

/**
 * Batch: take the top-N PENDING jobs BY SIGNIFICANCE (most to discuss first, not merely
 * newest) and generate each in sequence. Sequential on purpose — bounds API spend/rate and
 * keeps the cost of one tap predictable. `limit` is clamped by the caller (route caps at 10).
 * Returns a summary the coach note is built from.
 */
export async function generateTopPendingFeedbackJobs(limit: number): Promise<GenerateBatchSummary> {
  const safeLimit = Math.max(0, Math.min(limit, MAX_BATCH));
  const outcomes: GenerateOneOutcome[] = [];
  if (safeLimit === 0) {
    return { requested: 0, done: 0, failed: 0, errored: 0, skipped: 0, refused: 0, outcomes };
  }

  // Refuse the whole batch up front if the backend isn't API — don't claim/reset N jobs.
  const backend = await getActiveFeedbackGeneratorBackend();
  if (backend !== "api") {
    return { requested: safeLimit, done: 0, failed: 0, errored: 0, skipped: 0, refused: safeLimit, outcomes };
  }

  const pending = await listTrainingPeaksFeedbackJobs({ status: "pending", limit: 200 });
  const top = pending
    .map((job) => ({ job, score: scoreFeedbackSignificance(job.contextPacket as FeedbackContextPacket).score, date: (job.contextPacket as FeedbackContextPacket)?.workoutDate ?? "" }))
    .sort((a, b) => b.score - a.score || b.date.localeCompare(a.date))
    .slice(0, safeLimit);

  for (const { job } of top) {
    // Sequential by design — bounds API spend/rate for a batch tap.
    outcomes.push(await generateOneFeedbackJobViaApi(job.id));
  }

  return {
    requested: top.length,
    done: outcomes.filter((o) => o.status === "done").length,
    failed: outcomes.filter((o) => o.status === "failed").length,
    errored: outcomes.filter((o) => o.status === "error").length,
    skipped: outcomes.filter((o) => o.status === "skipped").length,
    refused: outcomes.filter((o) => o.status === "refused").length,
    outcomes,
  };
}
