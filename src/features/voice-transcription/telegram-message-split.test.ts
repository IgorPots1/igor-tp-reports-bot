import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { splitForTelegram } from "./telegram-message-split.ts";

describe("splitForTelegram — режем длинный транскрипт под лимит Telegram", () => {
  test("короткий текст — один кусок без изменений", () => {
    const chunks = splitForTelegram("Привет, это короткая расшифровка.", 4096);
    assert.deepEqual(chunks, ["Привет, это короткая расшифровка."]);
  });

  test("длиннее лимита — режется на несколько кусков, ничего не теряется", () => {
    const sentence = "Сегодня пробежала интервалы, было тяжело но справилась. ";
    const long = sentence.repeat(200); // well past 4096 chars
    const chunks = splitForTelegram(long, 500);

    assert.ok(chunks.length > 1, "должно быть больше одного куска");
    for (const chunk of chunks) {
      assert.ok(chunk.length <= 500, `кусок не длиннее лимита: ${chunk.length}`);
    }
    // Реконструкция (с точностью до пробелов на стыках) содержит весь исходный текст.
    const rebuilt = chunks.join(" ").replace(/\s+/g, " ").trim();
    const original = long.replace(/\s+/g, " ").trim();
    assert.equal(rebuilt, original, "ни один символ текста не потерян при разбиении");
  });

  test("режет по границе предложения, а не посреди слова, когда это возможно", () => {
    const text = "Первое предложение тут. Второе предложение здесь. " + "X".repeat(480);
    const chunks = splitForTelegram(text, 60);
    assert.ok(chunks[0]!.endsWith("."), `первый кусок должен закончиться на границе предложения: "${chunks[0]}"`);
  });

  test("пустая расшифровка — один пустой кусок, не падает", () => {
    const chunks = splitForTelegram("", 4096);
    assert.deepEqual(chunks, [""]);
  });
});
