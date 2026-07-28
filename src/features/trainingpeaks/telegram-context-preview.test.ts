import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildTelegramContextTextPreview, TELEGRAM_CONTEXT_OBSERVATION_MAX_LENGTH, TELEGRAM_CONTEXT_TEXT_PREVIEW_MAX_LENGTH } from "./telegram-context.ts";

const LONG =
  "Всем привет! Длинную отбегала. Перед бегом съела овсянку с бананом и ложкой кленового сиропа. " +
  "Воду с собой не брала, она закончилась. Под конец без воды и еды было реально тяжело, ноги налились.";

describe("buildTelegramContextTextPreview — длина по назначению", () => {
  test("дефолт (показ) режет на 120 с многоточием", () => {
    const p = buildTelegramContextTextPreview(LONG)!;
    assert.equal(p.length, TELEGRAM_CONTEXT_TEXT_PREVIEW_MAX_LENGTH);
    assert.ok(p.endsWith("…"));
    assert.ok(!/тяжело/.test(p), "хвост про «тяжело» отрезан на показе — ок");
  });
  test("наблюдение (500) сохраняет еду/воду/«тяжело» целиком", () => {
    const p = buildTelegramContextTextPreview(LONG, TELEGRAM_CONTEXT_OBSERVATION_MAX_LENGTH)!;
    assert.ok(p.length <= TELEGRAM_CONTEXT_OBSERVATION_MAX_LENGTH);
    assert.ok(/овсянк/.test(p) && /без воды/.test(p) && /тяжело/.test(p), "еда, вода и «тяжело» видны");
    assert.ok(!p.endsWith("…"), "короче 500 → не обрезано");
  });
  test("короткое сообщение не трогается", () => {
    assert.equal(buildTelegramContextTextPreview("Легкая ✅ всё хорошо", TELEGRAM_CONTEXT_OBSERVATION_MAX_LENGTH), "Легкая ✅ всё хорошо");
  });
  test("патологически длинное всё же ограничено 500", () => {
    const huge = "а".repeat(3000);
    const p = buildTelegramContextTextPreview(huge, TELEGRAM_CONTEXT_OBSERVATION_MAX_LENGTH)!;
    assert.equal(p.length, TELEGRAM_CONTEXT_OBSERVATION_MAX_LENGTH);
    assert.ok(p.endsWith("…"));
  });
});
