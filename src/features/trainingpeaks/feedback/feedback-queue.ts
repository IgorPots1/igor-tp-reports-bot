// Queue I/O for the feedback bridge (мост, часть 1). The buffer table
// (trainingpeaks_workout_feedback_jobs) is the handoff between the planner
// (enqueue) and whichever generator backend produces the draft. submitFeedbackDraft
// is the SHARED seam both backends (API in-process, Cowork worker) go through:
// it runs the iron fact-check and stores done/failed — so swapping the backend
// never bypasses the check.
//
// service_role table (RLS, no anon/authenticated) — server-only, like trainingpeaks_jobs.

import { createSupabaseServerClient, withSupabaseNetworkRetry } from "@/features/supabase/server";
import { validateFeedbackDraft } from "@/features/trainingpeaks/feedback/feedback-factcheck";
import type { FeedbackContextPacket } from "@/features/trainingpeaks/feedback/context-packet";
import type { FeedbackGeneratorBackend } from "@/features/trainingpeaks/feedback/feedback-generator";

const TABLE = "trainingpeaks_workout_feedback_jobs";

export type FeedbackJobStatus = "pending" | "generating" | "done" | "failed" | "blocked";

export type TrainingPeaksFeedbackJob = {
  id: string;
  workoutCacheId: string;
  studentId: string;
  contextPacket: FeedbackContextPacket;
  status: FeedbackJobStatus;
  draftText: string | null;
  generatorBackend: FeedbackGeneratorBackend | null;
  attempts: number;
  errorReason: string | null;
  blockedReason: string | null;
  createdAt: string;
  claimedAt: string | null;
  generatedAt: string | null;
  updatedAt: string | null;
};

type FeedbackJobRow = {
  id: string;
  workout_cache_id: string;
  student_id: string;
  context_packet: FeedbackContextPacket;
  status: FeedbackJobStatus;
  draft_text: string | null;
  generator_backend: FeedbackGeneratorBackend | null;
  attempts: number;
  error_reason: string | null;
  blocked_reason: string | null;
  created_at: string;
  claimed_at: string | null;
  generated_at: string | null;
  updated_at: string | null;
};

function mapRow(row: FeedbackJobRow): TrainingPeaksFeedbackJob {
  return {
    id: row.id,
    workoutCacheId: row.workout_cache_id,
    studentId: row.student_id,
    contextPacket: row.context_packet,
    status: row.status,
    draftText: row.draft_text,
    generatorBackend: row.generator_backend,
    attempts: row.attempts,
    errorReason: row.error_reason,
    blockedReason: row.blocked_reason,
    createdAt: row.created_at,
    claimedAt: row.claimed_at,
    generatedAt: row.generated_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Enqueue one workout. Either a ready-to-generate packet (status 'pending') or a
 * data-integrity block (status 'blocked' — coach signal, no draft). The partial
 * unique index rejects a duplicate ACTIVE job (pending/generating) for the same
 * workout; that conflict is swallowed and reported as skipped=true.
 */
export async function enqueueTrainingPeaksFeedbackJob(input: {
  workoutCacheId: string;
  studentId: string;
  packet?: FeedbackContextPacket;
  blockedReason?: string;
}): Promise<{ inserted: boolean; skipped: boolean }> {
  if (!input.packet && !input.blockedReason) {
    throw new Error("enqueueTrainingPeaksFeedbackJob: need either packet or blockedReason");
  }
  const supabase = createSupabaseServerClient();
  const payload: Record<string, unknown> = input.blockedReason
    ? { workout_cache_id: input.workoutCacheId, student_id: input.studentId, status: "blocked", blocked_reason: input.blockedReason, context_packet: input.packet ?? {} }
    : { workout_cache_id: input.workoutCacheId, student_id: input.studentId, status: "pending", context_packet: input.packet };

  const { error } = await withSupabaseNetworkRetry(() => supabase.from(TABLE).insert(payload));
  if (error) {
    // 23505 unique_violation → an active job already exists; not an error.
    if ((error as { code?: string }).code === "23505") {
      return { inserted: false, skipped: true };
    }
    throw new Error(`enqueue feedback job failed: ${error.message}`);
  }
  return { inserted: true, skipped: false };
}

/**
 * Claim the oldest pending job with a compare-and-swap (status pending→generating),
 * so two runners never take the same job. Returns null when the queue is empty.
 */
export async function claimNextPendingFeedbackJob(): Promise<TrainingPeaksFeedbackJob | null> {
  const supabase = createSupabaseServerClient();
  const { data: pending, error } = await withSupabaseNetworkRetry(() =>
    supabase.from(TABLE).select("id").eq("status", "pending").order("created_at", { ascending: true }).limit(20)
  );
  if (error) throw new Error(`claim: list pending failed: ${error.message}`);
  for (const candidate of (pending as Array<{ id: string }>) ?? []) {
    const { data: claimed, error: claimError } = await withSupabaseNetworkRetry(() =>
      supabase
        .from(TABLE)
        .update({ status: "generating", claimed_at: new Date().toISOString() })
        .eq("id", candidate.id)
        .eq("status", "pending")
        .select("*")
        .maybeSingle()
    );
    if (claimError) throw new Error(`claim: CAS failed: ${claimError.message}`);
    if (claimed) return mapRow(claimed as FeedbackJobRow);
    // Lost the race — another runner claimed it; try the next candidate.
  }
  return null;
}

/**
 * The SHARED seam: a backend hands its generated text here, and the fact-check
 * decides done vs failed. A number not in the packet or wrong gender → failed
 * (with error_reason, NOT done). draft_text is stored either way for inspection.
 * attempts is always incremented so retries are visible.
 */
export async function submitFeedbackDraft(input: {
  jobId: string;
  draftText: string;
  backend: FeedbackGeneratorBackend;
}): Promise<{ status: "done" | "failed"; reason?: string }> {
  const supabase = createSupabaseServerClient();
  const { data: jobRow, error: fetchError } = await withSupabaseNetworkRetry(() =>
    supabase.from(TABLE).select("*").eq("id", input.jobId).maybeSingle()
  );
  if (fetchError) throw new Error(`submit: fetch job failed: ${fetchError.message}`);
  if (!jobRow) throw new Error(`submit: job ${input.jobId} not found`);
  const job = mapRow(jobRow as FeedbackJobRow);

  const check = validateFeedbackDraft({ draft: input.draftText, packet: job.contextPacket });
  const now = new Date().toISOString();
  const nextStatus = check.ok ? "done" : "failed";
  const update: Record<string, unknown> = {
    status: nextStatus,
    draft_text: input.draftText,
    generator_backend: input.backend,
    generated_at: now,
    attempts: job.attempts + 1,
    error_reason: check.ok ? null : check.reason,
  };
  const { error: updateError } = await withSupabaseNetworkRetry(() => supabase.from(TABLE).update(update).eq("id", input.jobId));
  if (updateError) throw new Error(`submit: update failed: ${updateError.message}`);
  return check.ok ? { status: "done" } : { status: "failed", reason: check.reason };
}

export async function listTrainingPeaksFeedbackJobs(options?: { status?: FeedbackJobStatus; limit?: number }): Promise<TrainingPeaksFeedbackJob[]> {
  const supabase = createSupabaseServerClient();
  let query = supabase.from(TABLE).select("*").order("created_at", { ascending: false }).limit(options?.limit ?? 50);
  if (options?.status) query = query.eq("status", options.status);
  const { data, error } = await withSupabaseNetworkRetry(() => query);
  if (error) throw new Error(`list feedback jobs failed: ${error.message}`);
  return ((data as FeedbackJobRow[]) ?? []).map(mapRow);
}
