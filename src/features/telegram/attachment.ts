import type { TelegramMessage } from "@/features/telegram/types";

// Kept in sync with the attachment_type check constraint on
// trainingpeaks_telegram_context_observations (migration 20260915160000) — 'unknown' is
// reserved for historical rows backfilled without a real file_id, never assigned here.
export type TelegramAttachmentType = "voice" | "video_note" | "photo" | "document" | "sticker" | "audio";

export type TelegramAttachmentInfo = {
  attachmentType: TelegramAttachmentType;
  fileId: string;
  fileUniqueId: string | null;
  durationSec: number | null;
};

// The ONE place that decides "does this message carry a STORABLE attachment, and what kind" —
// every source path (business_dm, private_dm, group_topic, group_general) calls this instead of
// re-deriving the same voice/video_note/audio/photo/sticker/document checks locally. Distinct
// from context-observer.ts's own detectTelegramAttachment(), which is a broader boolean
// "has *any* non-text content" flag (also covers location/poll/contact/animation) used for
// classification scoring, not for deciding what to store in attachment_type/attachment_file_id.
export function extractTelegramAttachmentInfo(message: TelegramMessage): TelegramAttachmentInfo | null {
  if (message.voice) {
    return {
      attachmentType: "voice",
      fileId: message.voice.file_id,
      fileUniqueId: message.voice.file_unique_id,
      durationSec: message.voice.duration,
    };
  }

  if (message.video_note) {
    return {
      attachmentType: "video_note",
      fileId: message.video_note.file_id,
      fileUniqueId: message.video_note.file_unique_id,
      durationSec: message.video_note.duration,
    };
  }

  if (message.audio) {
    return {
      attachmentType: "audio",
      fileId: message.audio.file_id,
      fileUniqueId: message.audio.file_unique_id,
      durationSec: message.audio.duration,
    };
  }

  if (message.photo && message.photo.length > 0) {
    const largest = message.photo[message.photo.length - 1]!;
    return {
      attachmentType: "photo",
      fileId: largest.file_id,
      fileUniqueId: largest.file_unique_id,
      durationSec: null,
    };
  }

  if (message.sticker) {
    return {
      attachmentType: "sticker",
      fileId: message.sticker.file_id,
      fileUniqueId: message.sticker.file_unique_id,
      durationSec: null,
    };
  }

  if (message.document) {
    return {
      attachmentType: "document",
      fileId: message.document.file_id,
      fileUniqueId: message.document.file_unique_id,
      durationSec: null,
    };
  }

  return null;
}
