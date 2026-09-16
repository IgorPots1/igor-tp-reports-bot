/**
 * Voice-transcription worker — one pass per invocation, meant to be ticked by launchd every
 * 15-20s (see tools/trainingpeaks-export/scripts/run-voice-transcription-worker.sh + the
 * matching plist), NOT a long-running daemon: each run claims up to a few pending jobs,
 * processes them serially, and exits. Vercel enqueues into voice_transcription_jobs
 * (src/features/voice-transcription/webhook.ts); this is the only thing that ever reads
 * 'pending' rows back out.
 *
 * file_id freshness: Telegram's file_id is only guaranteed valid for a limited window. A job
 * older than 24h is marked 'failed' without attempting a download — a stale getFile call would
 * just fail anyway, and this makes the reason explicit instead of a generic download error.
 *
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=.env.local scripts/voice-transcription-worker.ts
 */
import { editTelegramMessageText, sendTelegramMessage } from "@/features/telegram/telegram-client";
import {
  claimPendingVoiceTranscriptionJobs,
  markVoiceTranscriptionJobDone,
  markVoiceTranscriptionJobFailedOrRequeue,
  type VoiceTranscriptionJob,
} from "@/features/voice-transcription/repository";
import {
  claimPendingTranscriptionObservations,
  markObservationTranscriptDone,
  markObservationTranscriptFailedOrRequeue,
  type PendingTranscriptionObservation,
} from "@/features/trainingpeaks/repository";
import { transcribeTelegramFile, getFfmpegPath, getWhisperCliPath, getWhisperModelPath } from "@/features/voice-transcription/transcribe";
import { splitForTelegram } from "@/features/voice-transcription/telegram-message-split";

// Log the RESOLVED paths every tick — not what .env.local is assumed to say, what this exact
// process actually got. Added 2026-09-16 after two separate missing-env-var incidents
// (VOICE_TRANSCRIPTION_WHISPER_MODEL_PATH, then a suspicion about CLI_PATH/FFMPEG_PATH) that
// took live debugging to confirm; this makes it a one-line log check going forward.
function logResolvedPaths(): void {
  let modelPath: string;
  try {
    modelPath = getWhisperModelPath();
  } catch (error) {
    modelPath = `НЕ ЗАДАН (${error instanceof Error ? error.message : String(error)})`;
  }
  console.log(
    `[voice-transcription] paths: ffmpeg=${getFfmpegPath()} whisper-cli=${getWhisperCliPath()} model=${modelPath}`
  );
}

const MAX_JOBS_PER_TICK = Number(process.env.VOICE_TRANSCRIPTION_MAX_JOBS_PER_TICK ?? "3");
const MAX_ATTEMPTS = Number(process.env.VOICE_TRANSCRIPTION_MAX_ATTEMPTS ?? "3");
const STALE_JOB_AGE_MS = 24 * 60 * 60 * 1000;
// Same queue size/retry budget as the manual jobs table — one shared read of what "too many at
// once" and "give up" mean, not two independently-tuned numbers.
const MAX_OBSERVATIONS_PER_TICK = Number(process.env.VOICE_TRANSCRIPTION_MAX_OBSERVATIONS_PER_TICK ?? "5");

async function deliverTranscript(job: VoiceTranscriptionJob, transcript: string): Promise<void> {
  const chunks = splitForTelegram(transcript || "(пусто — распознать нечего)");

  if (job.ackMessageId) {
    await editTelegramMessageText(job.telegramChatId, Number(job.ackMessageId), chunks[0]!);
  } else {
    await sendTelegramMessage(job.telegramChatId, chunks[0]!);
  }

  for (const chunk of chunks.slice(1)) {
    await sendTelegramMessage(job.telegramChatId, chunk);
  }
}

async function processJob(job: VoiceTranscriptionJob): Promise<void> {
  const ageMs = Date.now() - new Date(job.createdAt).getTime();
  if (ageMs > STALE_JOB_AGE_MS) {
    const outcome = await markVoiceTranscriptionJobFailedOrRequeue({
      id: job.id,
      attempts: MAX_ATTEMPTS, // force 'failed' regardless of attempts — staleness is terminal
      maxAttempts: MAX_ATTEMPTS,
      error: `file_id too old to trust (job age ${Math.round(ageMs / 3600000)}h)`,
    });
    console.warn(`[voice-transcription] job ${job.id} stale (${outcome}), skipping download`);
    if (job.ackMessageId) {
      await editTelegramMessageText(
        job.telegramChatId,
        Number(job.ackMessageId),
        "Не успел обработать вовремя — Telegram уже не отдаст файл. Пришли ещё раз."
      );
    }
    return;
  }

  try {
    const result = await transcribeTelegramFile(job.fileId);
    await markVoiceTranscriptionJobDone({
      id: job.id,
      transcript: result.transcript,
      transcriptModel: result.model,
      processingMs: result.processingMs,
    });
    await deliverTranscript(job, result.transcript);
    console.log(`[voice-transcription] job ${job.id} done in ${result.processingMs}ms`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const outcome = await markVoiceTranscriptionJobFailedOrRequeue({
      id: job.id,
      attempts: job.attempts,
      maxAttempts: MAX_ATTEMPTS,
      error: message,
    });
    console.error(`[voice-transcription] job ${job.id} failed (attempt ${job.attempts}/${MAX_ATTEMPTS}): ${message}`);

    if (outcome === "failed") {
      const chunks = splitForTelegram(`Не смог расшифровать после ${MAX_ATTEMPTS} попыток: ${message}`);
      if (job.ackMessageId) {
        await editTelegramMessageText(job.telegramChatId, Number(job.ackMessageId), chunks[0]!);
      } else {
        await sendTelegramMessage(job.telegramChatId, chunks[0]!);
      }
    }
  }
}

// The automatic queue (attachment_type in voice/video_note on context observations, either
// direction). No Telegram delivery here — unlike the manual path, this is silent context
// enrichment: transcript goes into the transcript column for the feedback/reply-draft/memory
// pipelines to read, text_preview (the original message's own text, usually empty for a voice
// note) is never touched.
async function processObservation(observation: PendingTranscriptionObservation): Promise<void> {
  const ageMs = Date.now() - new Date(observation.observedAt).getTime();
  if (ageMs > STALE_JOB_AGE_MS) {
    await markObservationTranscriptFailedOrRequeue({
      id: observation.id,
      attempts: MAX_ATTEMPTS,
      maxAttempts: MAX_ATTEMPTS,
      error: `file_id too old to trust (observation age ${Math.round(ageMs / 3600000)}h)`,
    });
    console.warn(`[voice-transcription] observation ${observation.id} stale, skipping download`);
    return;
  }

  try {
    const result = await transcribeTelegramFile(observation.attachmentFileId);
    await markObservationTranscriptDone({ id: observation.id, transcript: result.transcript });
    console.log(`[voice-transcription] observation ${observation.id} done in ${result.processingMs}ms`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const outcome = await markObservationTranscriptFailedOrRequeue({
      id: observation.id,
      attempts: observation.attempts,
      maxAttempts: MAX_ATTEMPTS,
      error: message,
    });
    console.error(
      `[voice-transcription] observation ${observation.id} failed (attempt ${observation.attempts}/${MAX_ATTEMPTS}): ${message} (${outcome})`
    );
  }
}

async function main(): Promise<void> {
  logResolvedPaths();

  const jobs = await claimPendingVoiceTranscriptionJobs(MAX_JOBS_PER_TICK);

  if (jobs.length === 0) {
    console.log("[voice-transcription] no pending manual jobs");
  } else {
    console.log(`[voice-transcription] claimed ${jobs.length} manual job(s)`);
    for (const job of jobs) {
      await processJob(job);
    }
  }

  const observations = await claimPendingTranscriptionObservations(MAX_OBSERVATIONS_PER_TICK);

  if (observations.length === 0) {
    console.log("[voice-transcription] no pending observations");
  } else {
    console.log(`[voice-transcription] claimed ${observations.length} observation(s)`);
    for (const observation of observations) {
      await processObservation(observation);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[voice-transcription] worker tick failed", error);
    process.exit(1);
  });
