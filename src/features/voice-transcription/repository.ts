import {
  createSupabaseServerClient,
  describeSupabaseError,
  withSupabaseNetworkRetry,
} from "@/features/supabase/server";

export type VoiceTranscriptionSourceKind = "voice" | "video_note" | "audio" | "document";
export type VoiceTranscriptionJobStatus = "pending" | "processing" | "done" | "failed" | "skipped";

export type VoiceTranscriptionJob = {
  id: string;
  telegramChatId: string;
  telegramMessageId: string;
  ackMessageId: string | null;
  fileId: string;
  fileUniqueId: string | null;
  durationSec: number | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  sourceKind: VoiceTranscriptionSourceKind;
  status: VoiceTranscriptionJobStatus;
  attempts: number;
  lastError: string | null;
  transcript: string | null;
  transcriptModel: string | null;
  processingMs: number | null;
  createdAt: string;
  updatedAt: string;
};

type VoiceTranscriptionJobRow = {
  id: string;
  telegram_chat_id: string;
  telegram_message_id: string;
  ack_message_id: string | null;
  file_id: string;
  file_unique_id: string | null;
  duration_sec: number | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  source_kind: VoiceTranscriptionSourceKind;
  status: VoiceTranscriptionJobStatus;
  attempts: number;
  last_error: string | null;
  transcript: string | null;
  transcript_model: string | null;
  processing_ms: number | null;
  created_at: string;
  updated_at: string;
};

function mapVoiceTranscriptionJobRow(row: VoiceTranscriptionJobRow): VoiceTranscriptionJob {
  return {
    id: row.id,
    telegramChatId: row.telegram_chat_id,
    telegramMessageId: row.telegram_message_id,
    ackMessageId: row.ack_message_id,
    fileId: row.file_id,
    fileUniqueId: row.file_unique_id,
    durationSec: row.duration_sec,
    mimeType: row.mime_type,
    fileSizeBytes: row.file_size_bytes,
    sourceKind: row.source_kind,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    transcript: row.transcript,
    transcriptModel: row.transcript_model,
    processingMs: row.processing_ms,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type VoiceTranscriptionJobLookup =
  | { status: "found"; job: VoiceTranscriptionJob }
  | { status: "not_found" }
  | { status: "unavailable"; reason: string };

// Same dedup shape as getTrainingPeaksTelegramContextObservationByChatMessage: Telegram retries
// the webhook on a slow/failed ack, and the caller must fail closed (retry later), never guess
// "no duplicate" when the check itself is broken.
export async function getVoiceTranscriptionJobByChatMessage(input: {
  chatId: string;
  messageId: string;
}): Promise<VoiceTranscriptionJobLookup> {
  const supabase = createSupabaseServerClient();

  let data: unknown = null;
  let error: unknown = null;

  try {
    ({ data, error } = await withSupabaseNetworkRetry(() =>
      supabase
        .from("voice_transcription_jobs")
        .select("*")
        .eq("telegram_chat_id", input.chatId)
        .eq("telegram_message_id", input.messageId)
        .maybeSingle()
    ));
  } catch (thrown) {
    return { status: "unavailable", reason: describeSupabaseError(thrown) };
  }

  if (error) {
    return { status: "unavailable", reason: describeSupabaseError(error) };
  }

  if (!data) {
    return { status: "not_found" };
  }

  return { status: "found", job: mapVoiceTranscriptionJobRow(data as VoiceTranscriptionJobRow) };
}

export type InsertVoiceTranscriptionJobInput = {
  telegramChatId: string;
  telegramMessageId: string;
  ackMessageId: string | null;
  fileId: string;
  fileUniqueId: string | null;
  durationSec: number | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  sourceKind: VoiceTranscriptionSourceKind;
  status?: VoiceTranscriptionJobStatus;
  lastError?: string | null;
};

export async function insertVoiceTranscriptionJob(
  input: InsertVoiceTranscriptionJobInput
): Promise<VoiceTranscriptionJob> {
  const supabase = createSupabaseServerClient();

  const { data, error } = await withSupabaseNetworkRetry(() =>
    supabase
      .from("voice_transcription_jobs")
      .insert({
        telegram_chat_id: input.telegramChatId,
        telegram_message_id: input.telegramMessageId,
        ack_message_id: input.ackMessageId,
        file_id: input.fileId,
        file_unique_id: input.fileUniqueId,
        duration_sec: input.durationSec,
        mime_type: input.mimeType,
        file_size_bytes: input.fileSizeBytes,
        source_kind: input.sourceKind,
        status: input.status ?? "pending",
        last_error: input.lastError ?? null,
      })
      .select("*")
      .single()
  );

  if (error) {
    throw new Error(`Failed to insert voice transcription job: ${describeSupabaseError(error)}`);
  }

  return mapVoiceTranscriptionJobRow(data as VoiceTranscriptionJobRow);
}

// Compare-and-swap claim: UPDATE ... WHERE status = 'pending' only succeeds for the runner that
// gets there first — Postgres serializes the two concurrent UPDATEs on the same row, so a second
// launchd tick picking up mid-run can never double-claim. attempts is incremented here (not on
// enqueue), so it counts PROCESSING attempts, matching the retry budget in Task 3.
export async function claimPendingVoiceTranscriptionJobs(limit: number): Promise<VoiceTranscriptionJob[]> {
  const supabase = createSupabaseServerClient();

  const { data: candidates, error: listError } = await withSupabaseNetworkRetry(() =>
    supabase
      .from("voice_transcription_jobs")
      .select("id")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(limit)
  );

  if (listError) {
    throw new Error(`Failed to list pending voice transcription jobs: ${describeSupabaseError(listError)}`);
  }

  const claimed: VoiceTranscriptionJob[] = [];

  for (const candidate of (candidates as { id: string }[] | null) ?? []) {
    const { data: currentRows, error: readError } = await withSupabaseNetworkRetry(() =>
      supabase.from("voice_transcription_jobs").select("attempts").eq("id", candidate.id).single()
    );

    if (readError || !currentRows) {
      continue;
    }

    const nextAttempts = (currentRows as { attempts: number }).attempts + 1;

    const { data, error } = await withSupabaseNetworkRetry(() =>
      supabase
        .from("voice_transcription_jobs")
        .update({ status: "processing", attempts: nextAttempts })
        .eq("id", candidate.id)
        .eq("status", "pending")
        .select("*")
    );

    if (error || !data || data.length !== 1) {
      // Lost the race to another runner tick, or the row changed under us — skip, not an error.
      continue;
    }

    claimed.push(mapVoiceTranscriptionJobRow(data[0] as VoiceTranscriptionJobRow));
  }

  return claimed;
}

export async function markVoiceTranscriptionJobDone(input: {
  id: string;
  transcript: string;
  transcriptModel: string;
  processingMs: number;
}): Promise<void> {
  const supabase = createSupabaseServerClient();

  const { error } = await withSupabaseNetworkRetry(() =>
    supabase
      .from("voice_transcription_jobs")
      .update({
        status: "done",
        transcript: input.transcript,
        transcript_model: input.transcriptModel,
        processing_ms: input.processingMs,
        last_error: null,
      })
      .eq("id", input.id)
  );

  if (error) {
    throw new Error(`Failed to mark voice transcription job done: ${describeSupabaseError(error)}`);
  }
}

// Requeues to 'pending' when there is retry budget left (maxAttempts), else marks 'failed'.
// The launchd poll interval (15-20s) IS the backoff — no separate delay bookkeeping.
export async function markVoiceTranscriptionJobFailedOrRequeue(input: {
  id: string;
  attempts: number;
  maxAttempts: number;
  error: string;
}): Promise<"requeued" | "failed"> {
  const supabase = createSupabaseServerClient();
  const nextStatus = input.attempts >= input.maxAttempts ? "failed" : "pending";

  const { error } = await withSupabaseNetworkRetry(() =>
    supabase
      .from("voice_transcription_jobs")
      .update({ status: nextStatus, last_error: input.error })
      .eq("id", input.id)
  );

  if (error) {
    throw new Error(`Failed to update voice transcription job after failure: ${describeSupabaseError(error)}`);
  }

  return nextStatus === "failed" ? "failed" : "requeued";
}

export async function markVoiceTranscriptionJobSkipped(input: { id: string; reason: string }): Promise<void> {
  const supabase = createSupabaseServerClient();

  const { error } = await withSupabaseNetworkRetry(() =>
    supabase
      .from("voice_transcription_jobs")
      .update({ status: "skipped", last_error: input.reason })
      .eq("id", input.id)
  );

  if (error) {
    throw new Error(`Failed to mark voice transcription job skipped: ${describeSupabaseError(error)}`);
  }
}
