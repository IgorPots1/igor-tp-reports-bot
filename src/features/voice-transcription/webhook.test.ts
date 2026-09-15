import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { extractTranscribableMedia } from "./webhook.ts";
import type { TelegramMessage } from "@/features/telegram/types.ts";

function baseMessage(overrides: Partial<TelegramMessage>): TelegramMessage {
  return {
    message_id: 1,
    chat: { id: 1, type: "private" },
    from: { id: 1 },
    ...overrides,
  };
}

describe("extractTranscribableMedia — что считаем расшифровываемым", () => {
  test("voice — распознаётся", () => {
    const media = extractTranscribableMedia(
      baseMessage({ voice: { file_id: "f1", file_unique_id: "u1", duration: 12 } })
    );
    assert.equal(media?.kind, "voice");
    assert.equal(media?.fileId, "f1");
    assert.equal(media?.durationSec, 12);
  });

  test("video_note — распознаётся", () => {
    const media = extractTranscribableMedia(
      baseMessage({ video_note: { file_id: "f2", file_unique_id: "u2", duration: 5 } })
    );
    assert.equal(media?.kind, "video_note");
  });

  test("audio — распознаётся", () => {
    const media = extractTranscribableMedia(
      baseMessage({ audio: { file_id: "f3", file_unique_id: "u3", duration: 30, mime_type: "audio/mpeg" } })
    );
    assert.equal(media?.kind, "audio");
  });

  test("document с audio/* mime — распознаётся (пересланное голосовое)", () => {
    const media = extractTranscribableMedia(
      baseMessage({
        document: { file_id: "f4", file_unique_id: "u4", mime_type: "audio/ogg" },
      })
    );
    assert.equal(media?.kind, "document");
  });

  test("document без audio mime — НЕ распознаётся", () => {
    const media = extractTranscribableMedia(
      baseMessage({
        document: { file_id: "f5", file_unique_id: "u5", mime_type: "application/pdf" },
      })
    );
    assert.equal(media, null);
  });

  test("обычный текст — НЕ распознаётся", () => {
    const media = extractTranscribableMedia(baseMessage({ text: "привет" }));
    assert.equal(media, null);
  });

  test("фото без подписи — НЕ распознаётся (не в списке типов наряда)", () => {
    const media = extractTranscribableMedia(baseMessage({}));
    assert.equal(media, null);
  });
});
