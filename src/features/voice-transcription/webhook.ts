import { isCoachChat } from "@/features/telegram/trainingpeaks";
import { sendTelegramMessage, sendTelegramMessageReturningId } from "@/features/telegram/telegram-client";
import type { TelegramMessage } from "@/features/telegram/types";
import {
  getVoiceTranscriptionJobByChatMessage,
  insertVoiceTranscriptionJob,
  type VoiceTranscriptionSourceKind,
} from "@/features/voice-transcription/repository";

// Bot API's own getFile ceiling for regular bots — Telegram refuses to serve file_path past this,
// so checking message.*.file_size up front (when Telegram sends it) avoids a doomed download.
const TELEGRAM_BOT_API_MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

function getMaxVoiceDurationSec(): number {
  const raw = process.env.VOICE_TRANSCRIPTION_MAX_DURATION_SEC?.trim();
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1200; // 20 min default
}

type TranscribableMedia = {
  kind: VoiceTranscriptionSourceKind;
  fileId: string;
  fileUniqueId: string | null;
  durationSec: number | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
};

export function extractTranscribableMedia(message: TelegramMessage): TranscribableMedia | null {
  if (message.voice) {
    return {
      kind: "voice",
      fileId: message.voice.file_id,
      fileUniqueId: message.voice.file_unique_id,
      durationSec: message.voice.duration,
      mimeType: message.voice.mime_type ?? null,
      fileSizeBytes: message.voice.file_size ?? null,
    };
  }

  if (message.video_note) {
    return {
      kind: "video_note",
      fileId: message.video_note.file_id,
      fileUniqueId: message.video_note.file_unique_id,
      durationSec: message.video_note.duration,
      mimeType: null,
      fileSizeBytes: message.video_note.file_size ?? null,
    };
  }

  if (message.audio) {
    return {
      kind: "audio",
      fileId: message.audio.file_id,
      fileUniqueId: message.audio.file_unique_id,
      durationSec: message.audio.duration,
      mimeType: message.audio.mime_type ?? null,
      fileSizeBytes: message.audio.file_size ?? null,
    };
  }

  // A forwarded voice message can arrive as a generic "document" depending on client/version —
  // only treat it as transcribable when Telegram itself tagged the mime type as audio.
  if (message.document && message.document.mime_type?.startsWith("audio/")) {
    return {
      kind: "document",
      fileId: message.document.file_id,
      fileUniqueId: message.document.file_unique_id,
      durationSec: null,
      mimeType: message.document.mime_type ?? null,
      fileSizeBytes: message.document.file_size ?? null,
    };
  }

  return null;
}

export type ManualVoiceTranscriptionOutcome =
  | { kind: "handled" }
  | { kind: "not_applicable" }
  | { kind: "retry_later"; reason: string };

// Manual-only path: Igor forwards/records a voice message directly to the bot in a private chat.
// Everyone else gets silence (return "not_applicable" — route.ts falls through to existing
// behavior unchanged, same as it does today for a non-coach voice message). NOT the automatic
// incoming-voice pipeline (naряд Задача 4 of the context-completeness наряд) — that is a
// separate, later task and reuses the same queue table with a different enqueue call site.
export async function handleManualVoiceTranscriptionRequest(
  message: TelegramMessage
): Promise<ManualVoiceTranscriptionOutcome> {
  if (message.chat.type !== "private") {
    return { kind: "not_applicable" };
  }

  if (message.from?.id === undefined || !isCoachChat(message.from.id)) {
    return { kind: "not_applicable" };
  }

  const media = extractTranscribableMedia(message);
  if (!media) {
    return { kind: "not_applicable" };
  }

  const chatId = String(message.chat.id);
  const messageId = String(message.message_id);

  const dedupLookup = await getVoiceTranscriptionJobByChatMessage({ chatId, messageId });

  if (dedupLookup.status === "found") {
    console.info("Voice transcription dedup: skipping already-enqueued message", {
      event: "voice_transcription_dedup_skip",
      chatId,
      messageId,
    });
    return { kind: "handled" };
  }

  if (dedupLookup.status === "unavailable") {
    console.error("Voice transcription dedup check unavailable, refusing to process", {
      event: "voice_transcription_dedup_unavailable",
      chatId,
      messageId,
      reason: dedupLookup.reason,
    });
    return { kind: "retry_later", reason: "Dedup check unavailable, retry later." };
  }

  const maxDurationSec = getMaxVoiceDurationSec();
  const tooLong = media.durationSec !== null && media.durationSec > maxDurationSec;
  const tooBig = media.fileSizeBytes !== null && media.fileSizeBytes > TELEGRAM_BOT_API_MAX_FILE_SIZE_BYTES;

  if (tooLong || tooBig) {
    const reason = tooBig
      ? `file_size_bytes=${media.fileSizeBytes} exceeds ${TELEGRAM_BOT_API_MAX_FILE_SIZE_BYTES}`
      : `duration_sec=${media.durationSec} exceeds ${maxDurationSec}`;

    try {
      const job = await insertVoiceTranscriptionJob({
        telegramChatId: chatId,
        telegramMessageId: messageId,
        ackMessageId: null,
        fileId: media.fileId,
        fileUniqueId: media.fileUniqueId,
        durationSec: media.durationSec,
        mimeType: media.mimeType,
        fileSizeBytes: media.fileSizeBytes,
        sourceKind: media.kind,
        status: "skipped",
        lastError: reason,
      });
      void job;
    } catch (error) {
      console.warn("Failed to record skipped voice transcription job", { chatId, messageId, error });
    }

    await sendTelegramMessage(
      chatId,
      tooBig
        ? "Файл больше 20 МБ — Telegram Bot API не отдаёт такие боту, расшифровать не могу."
        : `Голосовое длиннее ${Math.round(maxDurationSec / 60)} мин — пропускаю, слишком долго для этого пайплайна.`
    );

    return { kind: "handled" };
  }

  let ackResult: Awaited<ReturnType<typeof sendTelegramMessageReturningId>>;
  try {
    ackResult = await sendTelegramMessageReturningId(chatId, "Принял, расшифровываю…");
  } catch (error) {
    console.error("Failed to send voice transcription ack, asking Telegram to redeliver", {
      event: "voice_transcription_ack_failed",
      chatId,
      messageId,
      error,
    });
    return { kind: "retry_later", reason: "Ack send failed, retry later." };
  }

  try {
    await insertVoiceTranscriptionJob({
      telegramChatId: chatId,
      telegramMessageId: messageId,
      ackMessageId: ackResult ? String(ackResult.messageId) : null,
      fileId: media.fileId,
      fileUniqueId: media.fileUniqueId,
      durationSec: media.durationSec,
      mimeType: media.mimeType,
      fileSizeBytes: media.fileSizeBytes,
      sourceKind: media.kind,
    });
  } catch (error) {
    console.error("Failed to enqueue voice transcription job, asking Telegram to redeliver", {
      event: "voice_transcription_enqueue_failed",
      chatId,
      messageId,
      error,
    });
    return { kind: "retry_later", reason: "Voice transcription enqueue failed, retry later." };
  }

  return { kind: "handled" };
}
