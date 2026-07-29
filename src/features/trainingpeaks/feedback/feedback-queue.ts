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
import { enforceGreeting, normalizeDraftFormat, stripLongDash } from "@/features/trainingpeaks/feedback/draft-text";
import { computeDraftEditDiff, type DraftEditDiff } from "@/features/trainingpeaks/feedback/draft-edit-diff";

const TABLE = "trainingpeaks_workout_feedback_jobs";

// Compute + persist the draft→sent word diff on a job. Best-effort: the row already carries
// draft_text and sent_text, so a failed diff write just leaves edit_diff null — never blocks the
// send/edit. Called AFTER the main CAS update returns the row (so draft_text is in hand).
async function persistEditDiff(jobId: string, draftText: string | null, finalText: string): Promise<DraftEditDiff> {
  const diff = computeDraftEditDiff(draftText, finalText);
  const supabase = createSupabaseServerClient();
  await withSupabaseNetworkRetry(() => supabase.from(TABLE).update({ edit_diff: diff }).eq("id", jobId)).catch(() => {});
  return diff;
}

// pending/generating/done/failed/blocked come from the bridge (part 1). sent/shared/
// dismissed are the review terminal states the Mini App writes:
//   sent    — delivered to a 1:1 Business DM by the server (confirmed).
//   shared  — handed to Telegram's share sheet for a GROUP from Igor's own account;
//             delivery is NOT confirmable (no API round-trip). Because a wrong-chat pick
//             can't be detected, 'shared' is NOT terminal: the card STAYS in review with
//             «Отправить ещё раз», and only Igor's explicit «Готово» closes it.
//   shared_confirmed — Igor confirmed the group share actually landed («Готово»). Terminal,
//             moves to history. The only way a shared card leaves the review cycle.
//   dismissed — coach chose not to send / cleared from the queue.
export type FeedbackJobStatus = "pending" | "generating" | "done" | "failed" | "blocked" | "sent" | "shared" | "shared_confirmed" | "dismissed";

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
  // Review fields (Mini App «Отчёты», migration 20260723120000).
  coachEditedText: string | null;
  sentText: string | null;
  editDiff: DraftEditDiff | null;
  sentAt: string | null;
  dismissedAt: string | null;
  reviewedByChatId: string | null;
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
  coach_edited_text: string | null;
  sent_text: string | null;
  edit_diff: DraftEditDiff | null;
  sent_at: string | null;
  dismissed_at: string | null;
  reviewed_by_chat_id: string | null;
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
    // The columns are absent until migration 20260723120000 is applied — coalesce so a
    // pre-migration read still maps cleanly (proof runs against would-be rows).
    coachEditedText: row.coach_edited_text ?? null,
    sentText: row.sent_text ?? null,
    editDiff: row.edit_diff ?? null,
    sentAt: row.sent_at ?? null,
    dismissedAt: row.dismissed_at ?? null,
    reviewedByChatId: row.reviewed_by_chat_id ?? null,
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
 * Arbiter clarification enrichment: the student added a follow-up detail to a run they'd already
 * reported ("забыла отписать про интервалы, GPS не работал"). It must NOT create a new card — it
 * enriches the words on the EXISTING one. Only a card still BEFORE generation (pending/generating)
 * is touched: a done/sent draft is already written and must not silently change under Igor. Verbatim
 * text is appended to context_packet.studentWords (deduped, capped). No-op (returns false) when there
 * is no pre-generation card for this run or the text is already there.
 */
export async function enrichPendingCardStudentWords(workoutCacheId: string, text: string): Promise<boolean> {
  const t = (text ?? "").trim();
  if (!t) return false;
  const supabase = createSupabaseServerClient();
  const { data, error } = await withSupabaseNetworkRetry(() =>
    supabase.from(TABLE).select("id, context_packet").eq("workout_cache_id", workoutCacheId).in("status", ["pending", "generating"]).order("created_at", { ascending: false }).limit(1)
  );
  if (error || !data || data.length === 0) return false;
  const row = data[0] as { id: string; context_packet: FeedbackContextPacket | Record<string, unknown> };
  const packet = (row.context_packet ?? {}) as { studentWords?: unknown };
  const words = Array.isArray(packet.studentWords) ? (packet.studentWords as string[]) : [];
  if (words.some((w) => w.trim() === t)) return false; // already present (e.g. re-scan)
  const updated = [...words, t].slice(0, 8); // cap — the coach panel doesn't need a wall of text
  const { error: updateError } = await withSupabaseNetworkRetry(() =>
    supabase.from(TABLE).update({ context_packet: { ...(row.context_packet as Record<string, unknown>), studentWords: updated } }).eq("id", row.id)
  );
  return !updateError;
}

/**
 * Which of these workouts already have a HANDLED job (done/dismissed/sent/shared): a
 * draft was generated and is awaiting review, was sent/shared, or the coach dismissed
 * it. The enqueue sweep skips these so an hourly metrics recompute can't resurrect a
 * workout Igor already dealt with — the active-only partial-unique index covers only
 * pending/generating, so terminal states would otherwise re-enqueue a fresh pending.
 * blocked/failed are deliberately NOT here: those stay enqueuable (a retry path).
 */
export async function fetchHandledWorkoutCacheIds(cacheIds: string[]): Promise<Set<string>> {
  if (cacheIds.length === 0) return new Set();
  const supabase = createSupabaseServerClient();
  const handled = new Set<string>();
  for (let i = 0; i < cacheIds.length; i += 150) {
    const part = cacheIds.slice(i, i + 150);
    const { data, error } = await withSupabaseNetworkRetry(() =>
      supabase.from(TABLE).select("workout_cache_id").in("workout_cache_id", part).in("status", ["done", "dismissed", "sent", "shared", "shared_confirmed"])
    );
    if (error) throw new Error(`fetch handled workout cache ids failed: ${error.message}`);
    for (const r of (data as Array<{ workout_cache_id: string }>) ?? []) handled.add(r.workout_cache_id);
  }
  return handled;
}

export type WorkoutJobBlockState = { blocked: boolean; dismissedAt: string | null };

// After this many FAILED jobs for one workout, stop re-enqueuing it. Each re-enqueue is a NEW job row
// (attempts is per-row, so it can't see prior rows), so a DETERMINISTIC failure — e.g. the fact-check
// blocking «pulse on untrusted HR» every time — piled up 3× for Koroleva. A couple of retries cover a
// transient hiccup; past that it's not going to self-heal, so leave the failed card for the coach.
export const FEEDBACK_FAILED_RETRY_CAP = 2;

/**
 * Per workout, the state the REPORT-triggered sweep needs to decide whether to (re)enqueue:
 *   blocked      — an active or completed job exists (pending/generating/done/sent/shared): never
 *                  re-enqueue (already in the queue, already drafted, or already delivered).
 *   dismissedAt  — the newest dismissal, when the ONLY jobs are dismissed (no blocking job). The
 *                  sweep re-enqueues such a run ONLY if the student's report is NEWER than this — a
 *                  fresh report after the coach cleared the card resurrects it, but the same report
 *                  the coach already dismissed does not (no re-dismiss loop).
 * This is the report-triggered replacement for fetchHandledWorkoutCacheIds, which treated every
 * 'dismissed' as a permanent block (correct for the old workout-driven sweep, wrong once the trigger
 * is the student's message).
 */
export async function fetchWorkoutJobBlockState(cacheIds: string[]): Promise<Map<string, WorkoutJobBlockState>> {
  const out = new Map<string, WorkoutJobBlockState>();
  if (cacheIds.length === 0) return out;
  const supabase = createSupabaseServerClient();
  const BLOCKING = new Set<FeedbackJobStatus>(["pending", "generating", "done", "sent", "shared", "shared_confirmed"]);
  const failedCount = new Map<string, number>();
  for (let i = 0; i < cacheIds.length; i += 150) {
    const part = cacheIds.slice(i, i + 150);
    const { data, error } = await withSupabaseNetworkRetry(() =>
      supabase.from(TABLE).select("workout_cache_id, status, dismissed_at").in("workout_cache_id", part)
    );
    if (error) throw new Error(`fetch workout job block state failed: ${error.message}`);
    for (const r of (data as Array<{ workout_cache_id: string; status: FeedbackJobStatus; dismissed_at: string | null }>) ?? []) {
      const cur = out.get(r.workout_cache_id) ?? { blocked: false, dismissedAt: null };
      if (BLOCKING.has(r.status)) cur.blocked = true;
      else if (r.status === "failed") failedCount.set(r.workout_cache_id, (failedCount.get(r.workout_cache_id) ?? 0) + 1);
      else if (r.status === "dismissed" && r.dismissed_at && (!cur.dismissedAt || r.dismissed_at > cur.dismissedAt)) cur.dismissedAt = r.dismissed_at;
      out.set(r.workout_cache_id, cur);
    }
  }
  // Retry cap: a workout that already failed FEEDBACK_FAILED_RETRY_CAP times stops re-enqueuing (the
  // failure is deterministic, not a hiccup). The failed card stays for the coach; no more duplicates.
  for (const [cacheId, n] of failedCount) {
    if (n >= FEEDBACK_FAILED_RETRY_CAP) {
      const cur = out.get(cacheId) ?? { blocked: false, dismissedAt: null };
      cur.blocked = true;
      out.set(cacheId, cur);
    }
  }
  return out;
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
 * Claim ONE specific pending job (compare-and-swap pending→generating) for on-demand
 * generation — Igor tapped «Сгенерить» on that card. Unlike claimNextPendingFeedbackJob
 * (oldest-first), this targets the exact job. Returns the claimed job, or null if it
 * was not 'pending' (already generating/done/dismissed, or a double-tap lost the race).
 */
export async function claimSpecificPendingFeedbackJob(jobId: string): Promise<TrainingPeaksFeedbackJob | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await withSupabaseNetworkRetry(() =>
    supabase
      .from(TABLE)
      .update({ status: "generating", claimed_at: new Date().toISOString() })
      .eq("id", jobId)
      .eq("status", "pending")
      .select("*")
      .maybeSingle()
  );
  if (error) throw new Error(`claim specific feedback job failed: ${error.message}`);
  return data ? mapRow(data as FeedbackJobRow) : null;
}

/**
 * Return a job from 'generating' back to 'pending' after a GENERATION error (API
 * transport/quota, empty response) — the draft was never produced, so the card should
 * stay in «Новые» and be retriable. Distinct from submitFeedbackDraft's failed state,
 * which is a produced-but-rejected draft. Records the error for visibility. CAS on
 * 'generating' so it can't stomp a job that meanwhile reached done/failed.
 */
export async function resetFeedbackJobToPending(input: { jobId: string; errorReason: string }): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { error } = await withSupabaseNetworkRetry(() =>
    supabase
      .from(TABLE)
      .update({ status: "pending", claimed_at: null, error_reason: input.errorReason })
      .eq("id", input.jobId)
      .eq("status", "generating")
  );
  if (error) throw new Error(`reset feedback job to pending failed: ${error.message}`);
}

/**
 * Return jobs stuck in 'generating' back to 'pending' (crash recovery): the worker
 * claims pending→generating, then submits generating→done/failed. If the worker dies
 * between the two, the job sits in 'generating' and no claim would ever pick it up
 * again. This resets any such job whose claim is older than the cutoff so the next
 * run re-generates it — nothing is lost. Called at the start of a worker batch.
 * claimed_at is null for a freshly reset job, so a NULL claim never blocks reclaim.
 */
export async function reclaimStaleGeneratingFeedbackJobs(cutoffIso: string): Promise<{ reclaimed: number; ids: string[] }> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await withSupabaseNetworkRetry(() =>
    supabase
      .from(TABLE)
      .update({ status: "pending", claimed_at: null })
      .eq("status", "generating")
      .lt("claimed_at", cutoffIso)
      .select("id")
  );
  if (error) throw new Error(`reclaim stale generating failed: ${error.message}`);
  const ids = ((data as Array<{ id: string }>) ?? []).map((r) => r.id);
  return { reclaimed: ids.length, ids };
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
}): Promise<{ status: "done" | "failed"; reason?: string; draftText?: string }> {
  const supabase = createSupabaseServerClient();
  const { data: jobRow, error: fetchError } = await withSupabaseNetworkRetry(() =>
    supabase.from(TABLE).select("*").eq("id", input.jobId).maybeSingle()
  );
  if (fetchError) throw new Error(`submit: fetch job failed: ${fetchError.message}`);
  if (!jobRow) throw new Error(`submit: job ${input.jobId} not found`);
  const job = mapRow(jobRow as FeedbackJobRow);

  // Normalize before both the fact-check and storage, so the stored draft is exactly what the check
  // ran on. Deterministic chain (the prompt asks for all three, but the model drifts): drop the long
  // dash → force the greeting to the student's register → strip the trailing period and split a rich
  // draft into greeting/body/question paragraphs (short one-liners stay compact).
  const draftText = normalizeDraftFormat(enforceGreeting(stripLongDash(input.draftText), job.contextPacket.register));
  const check = validateFeedbackDraft({ draft: draftText, packet: job.contextPacket });
  const now = new Date().toISOString();
  const nextStatus = check.ok ? "done" : "failed";
  const update: Record<string, unknown> = {
    status: nextStatus,
    draft_text: draftText,
    generator_backend: input.backend,
    generated_at: now,
    attempts: job.attempts + 1,
    error_reason: check.ok ? null : check.reason,
  };
  const { error: updateError } = await withSupabaseNetworkRetry(() => supabase.from(TABLE).update(update).eq("id", input.jobId));
  if (updateError) throw new Error(`submit: update failed: ${updateError.message}`);
  // Return the STORED (normalized) text so callers show the client exactly what was saved/sent —
  // not the raw model output (which still carries the long dash / wrong greeting).
  return check.ok ? { status: "done", draftText } : { status: "failed", reason: check.reason };
}

export async function listTrainingPeaksFeedbackJobs(options?: { status?: FeedbackJobStatus | FeedbackJobStatus[]; limit?: number }): Promise<TrainingPeaksFeedbackJob[]> {
  const supabase = createSupabaseServerClient();
  let query = supabase.from(TABLE).select("*").order("created_at", { ascending: false }).limit(options?.limit ?? 50);
  if (Array.isArray(options?.status)) query = query.in("status", options.status);
  else if (options?.status) query = query.eq("status", options.status);
  const { data, error } = await withSupabaseNetworkRetry(() => query);
  if (error) throw new Error(`list feedback jobs failed: ${error.message}`);
  return ((data as FeedbackJobRow[]) ?? []).map(mapRow);
}

export async function getTrainingPeaksFeedbackJobById(jobId: string): Promise<TrainingPeaksFeedbackJob | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await withSupabaseNetworkRetry(() =>
    supabase.from(TABLE).select("*").eq("id", jobId).maybeSingle()
  );
  if (error) throw new Error(`get feedback job failed: ${error.message}`);
  return data ? mapRow(data as FeedbackJobRow) : null;
}

/**
 * Save Igor's edit of a draft. Only a 'done' job is editable (a sent/dismissed one
 * is terminal). Stored separately from draft_text so the pair survives as few-shot
 * signal. Returns the updated job, or null if the job was not in an editable state.
 */
export async function saveFeedbackDraftCoachEdit(input: {
  jobId: string;
  coachEditedText: string;
  actorChatId: string;
}): Promise<TrainingPeaksFeedbackJob | null> {
  const supabase = createSupabaseServerClient();
  // Strip the long dash on the coach's edit too — the generation seam already does, but the edit
  // path stored the text raw, so a dash the coach kept/typed (or one that survived because the API
  // generate route returns the UNstripped text to the client) leaked into the sent message. Only the
  // dash is touched here — the coach's own formatting/period is deliberate and left alone (Block 3).
  const coachEditedText = stripLongDash(input.coachEditedText);
  const { data, error } = await withSupabaseNetworkRetry(() =>
    supabase
      .from(TABLE)
      .update({ coach_edited_text: coachEditedText, reviewed_by_chat_id: input.actorChatId })
      .eq("id", input.jobId)
      .eq("status", "done")
      .select("*")
      .maybeSingle()
  );
  if (error) throw new Error(`save coach edit failed: ${error.message}`);
  if (!data) return null;
  // Freeze the draft→edit diff (what Igor rewrote). Intermediate — the send path re-diffs against
  // the FINAL sent_text below, which is authoritative.
  const editDiff = await persistEditDiff(input.jobId, (data as FeedbackJobRow).draft_text, coachEditedText);
  return mapRow({ ...(data as FeedbackJobRow), edit_diff: editDiff });
}

/**
 * Skip a draft (coach chose not to send). Allowed from any non-sent state where a
 * decision is Igor's to make: 'pending' (a «Новые» card he'll answer himself), 'done',
 * 'blocked', 'failed'. NOT from 'generating' (mid-flight) or a terminal sent/shared.
 * CAS on those statuses so a race with a send/generate is rejected. Null if not dismissible.
 */
export async function markFeedbackJobDismissed(input: {
  jobId: string;
  actorChatId: string;
}): Promise<TrainingPeaksFeedbackJob | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await withSupabaseNetworkRetry(() =>
    supabase
      .from(TABLE)
      .update({ status: "dismissed", dismissed_at: new Date().toISOString(), reviewed_by_chat_id: input.actorChatId })
      .eq("id", input.jobId)
      .in("status", ["pending", "done", "blocked", "failed"])
      .select("*")
      .maybeSingle()
  );
  if (error) throw new Error(`dismiss feedback job failed: ${error.message}`);
  return data ? mapRow(data as FeedbackJobRow) : null;
}

/**
 * Bulk-clear stale «Новые» cards: dismiss every PENDING job whose workout is older than
 * the cutoff (by workout DATE, from context_packet.workoutDate — not created_at), so Igor
 * can wipe a backlog he's already answered by hand in one tap. Only 'pending' is touched;
 * generated/sent/blocked rows are left alone. Nothing is deleted — status change only.
 * Returns how many were dismissed.
 */
export async function markPendingFeedbackJobsDismissedOlderThan(input: {
  workoutDateCutoff: string; // 'YYYY-MM-DD' exclusive — dismiss workouts strictly before this
  actorChatId: string;
}): Promise<{ dismissed: number }> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await withSupabaseNetworkRetry(() =>
    supabase
      .from(TABLE)
      .update({ status: "dismissed", dismissed_at: new Date().toISOString(), reviewed_by_chat_id: input.actorChatId })
      .eq("status", "pending")
      .lt("context_packet->>workoutDate", input.workoutDateCutoff)
      .select("id")
  );
  if (error) throw new Error(`bulk dismiss old pending failed: ${error.message}`);
  return { dismissed: ((data as Array<{ id: string }>) ?? []).length };
}

/**
 * Mark a reviewed draft as SHARED to a group: Igor tapped «Отправить в чат», which opens
 * Telegram's share sheet from his own account. There is no delivery confirmation, so this is
 * NOT 'sent', and NOT terminal — the card stays in review as "передано в чат" so a wrong-chat
 * pick can be re-shared. CAS allows 'done' OR 'shared' (an idempotent «Отправить ещё раз»), but
 * NOT 'shared_confirmed' (already closed) — so a resend re-freezes the text without reopening a
 * confirmed card. Returns the updated job, or null if it was neither 'done' nor 'shared'.
 */
export async function markFeedbackJobShared(input: {
  jobId: string;
  sharedText: string;
  actorChatId: string;
}): Promise<TrainingPeaksFeedbackJob | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await withSupabaseNetworkRetry(() =>
    supabase
      .from(TABLE)
      .update({ status: "shared", sent_text: input.sharedText, sent_at: new Date().toISOString(), reviewed_by_chat_id: input.actorChatId })
      .eq("id", input.jobId)
      .in("status", ["done", "shared"])
      .select("*")
      .maybeSingle()
  );
  if (error) throw new Error(`mark feedback job shared failed: ${error.message}`);
  if (!data) return null;
  const editDiff = await persistEditDiff(input.jobId, (data as FeedbackJobRow).draft_text, input.sharedText);
  return mapRow({ ...(data as FeedbackJobRow), edit_diff: editDiff });
}

/**
 * Confirm a group share actually landed (shared→shared_confirmed): Igor tapped «Готово». This is
 * the ONLY exit from 'shared' — it moves the card to history. CAS on 'shared' so it can't fire on
 * a card that isn't awaiting confirmation. Returns the updated job, or null if it wasn't 'shared'.
 */
export async function markFeedbackJobSharedConfirmed(input: { jobId: string; actorChatId: string }): Promise<TrainingPeaksFeedbackJob | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await withSupabaseNetworkRetry(() =>
    supabase
      .from(TABLE)
      .update({ status: "shared_confirmed", reviewed_by_chat_id: input.actorChatId })
      .eq("id", input.jobId)
      .eq("status", "shared")
      .select("*")
      .maybeSingle()
  );
  if (error) throw new Error(`confirm feedback job shared failed: ${error.message}`);
  return data ? mapRow(data as FeedbackJobRow) : null;
}

/**
 * Claim a 'done' job for sending (CAS done→sent, freezing sent_text). Claim-BEFORE-send
 * so a second concurrent tap can never deliver the same draft twice — the loser sees
 * status≠done and is refused. If delivery then fails, rollbackFeedbackJobSend puts it
 * back to 'done'. Returns the claimed job, or null if it was not in 'done'.
 */
export async function claimFeedbackJobForSend(input: {
  jobId: string;
  sentText: string;
  actorChatId: string;
}): Promise<TrainingPeaksFeedbackJob | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await withSupabaseNetworkRetry(() =>
    supabase
      .from(TABLE)
      .update({ status: "sent", sent_text: input.sentText, sent_at: new Date().toISOString(), reviewed_by_chat_id: input.actorChatId })
      .eq("id", input.jobId)
      .eq("status", "done")
      .select("*")
      .maybeSingle()
  );
  if (error) throw new Error(`claim feedback job for send failed: ${error.message}`);
  if (!data) return null;
  // Authoritative diff: generated draft vs the exact text delivered to the student.
  const editDiff = await persistEditDiff(input.jobId, (data as FeedbackJobRow).draft_text, input.sentText);
  return mapRow({ ...(data as FeedbackJobRow), edit_diff: editDiff });
}

/** Roll a claimed send back to 'done' after a delivery failure, recording the reason. */
export async function rollbackFeedbackJobSend(input: { jobId: string; errorReason: string }): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { error } = await withSupabaseNetworkRetry(() =>
    supabase
      .from(TABLE)
      .update({ status: "done", sent_text: null, sent_at: null, error_reason: input.errorReason })
      .eq("id", input.jobId)
      .eq("status", "sent")
  );
  if (error) throw new Error(`rollback feedback job send failed: ${error.message}`);
}
