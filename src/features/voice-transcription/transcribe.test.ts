import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { stripWhisperTimestamps } from "./transcribe.ts";

describe("stripWhisperTimestamps", () => {
  test("removes the [start --> end] prefix from each line", () => {
    const raw =
      "[00:00:00.000 --> 00:00:10.520]   Игорь, привет.\n" +
      "[00:00:10.520 --> 00:00:19.140]   Как дела?";
    assert.equal(stripWhisperTimestamps(raw), "Игорь, привет.\nКак дела?");
  });

  test("leaves plain text (no timestamp prefix) untouched", () => {
    assert.equal(stripWhisperTimestamps("просто текст без таймштампов"), "просто текст без таймштампов");
  });

  test("trims leading/trailing whitespace from the whole output", () => {
    const raw = "\n[00:00:00.000 --> 00:00:01.000]  привет\n\n";
    assert.equal(stripWhisperTimestamps(raw), "привет");
  });

  test("only strips the timestamp prefix, not a bracketed word mid-sentence", () => {
    const raw = "[00:00:00.000 --> 00:00:01.000]  он сказал [неразборчиво] и ушёл";
    assert.equal(stripWhisperTimestamps(raw), "он сказал [неразборчиво] и ушёл");
  });
});
