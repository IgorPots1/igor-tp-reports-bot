import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { enforceGreeting, normalizeDraftFormat } from "./draft-text.ts";

describe("enforceGreeting — Block 2, greeting must match register", () => {
  test("вы: wrong «Привет!» is rewritten to «Здравствуйте!»", () => {
    assert.equal(enforceGreeting("Привет! Хорошо разложил темп)", "vy"), "Здравствуйте! Хорошо разложил темп)");
  });

  test("вы: «Привет, всё ровно» keeps the rest of the line", () => {
    assert.equal(enforceGreeting("Привет, всё ровно", "vy"), "Здравствуйте! всё ровно");
  });

  test("вы: correct «Здравствуйте!» is left untouched", () => {
    const t = "Здравствуйте! Отлично вышло)";
    assert.equal(enforceGreeting(t, "vy"), t);
  });

  test("ты: wrong «Здравствуйте!» is rewritten to «Привет!»", () => {
    assert.equal(enforceGreeting("Здравствуйте! молодец)", "ty"), "Привет! молодец)");
  });

  test("ты: correct «Привет!» is left untouched", () => {
    const t = "Привет! молодец)";
    assert.equal(enforceGreeting(t, "ty"), t);
  });

  test("unknown register defaults to вы", () => {
    assert.equal(enforceGreeting("Привет! ровно шёл", "unknown"), "Здравствуйте! ровно шёл");
  });

  test("no greeting → prepend the register greeting as first line", () => {
    assert.equal(enforceGreeting("Отлично вышло)", "vy"), "Здравствуйте!\nОтлично вышло)");
    assert.equal(enforceGreeting("Отлично вышло)", "ty"), "Привет!\nОтлично вышло)");
  });

  test("leading blank line before the greeting is handled", () => {
    assert.equal(enforceGreeting("\nПривет! ровно", "vy"), "\nЗдравствуйте! ровно");
  });

  test("does not touch «привет» inside a later line, only the first non-empty line", () => {
    // first line has the correct greeting; a body «привет» is irrelevant
    assert.equal(enforceGreeting("Здравствуйте! ты писал привет вчера", "vy"), "Здравствуйте! ты писал привет вчера");
  });
});

describe("normalizeDraftFormat — Block 3, trailing period + conditional paragraphs", () => {
  test("strips a single trailing period", () => {
    assert.equal(normalizeDraftFormat("Привет! Молодец."), "Привет! Молодец");
  });
  test("keeps an ellipsis «…» (two dots guard)", () => {
    assert.equal(normalizeDraftFormat("Привет! ну ладно.."), "Привет! ну ладно..");
  });
  test("keeps «?» and «)» and emoji endings", () => {
    assert.equal(normalizeDraftFormat("Привет! как ноги?"), "Привет! как ноги?");
    assert.equal(normalizeDraftFormat("Привет! молодец)"), "Привет! молодец)");
    assert.equal(normalizeDraftFormat("Привет! отлично 👍"), "Привет! отлично 👍");
  });
  test("period after emoji is stripped", () => {
    assert.equal(normalizeDraftFormat("Привет! отлично 👍."), "Привет! отлично 👍");
  });

  test("short praise stays a compact one-liner (greeting inline, no blank line)", () => {
    assert.equal(normalizeDraftFormat("Здравствуйте!\nМолодец 👍"), "Здравствуйте! Молодец 👍");
  });

  test("rich draft: greeting / body / question split by blank lines", () => {
    const inp = "Здравствуйте! В целом отлично, только начинали каждый отрезок слишком быстро, к концу тяжело. Как самочувствие было?";
    const out = normalizeDraftFormat(inp);
    assert.equal(out, "Здравствуйте!\n\nВ целом отлично, только начинали каждый отрезок слишком быстро, к концу тяжело\n\nКак самочувствие было?");
  });

  test("rich body without a question still separates greeting from body", () => {
    const inp = "Здравствуйте! Первую половину держали ровно, во второй пульс пополз вверх, для длительной терпимо, старайтесь ровнее.";
    const out = normalizeDraftFormat(inp);
    assert.ok(out.startsWith("Здравствуйте!\n\n"), out);
    assert.ok(!out.endsWith("."), "no trailing period");
  });

  test("greeting-only draft returns just the greeting", () => {
    assert.equal(normalizeDraftFormat("Здравствуйте!"), "Здравствуйте!");
  });
});
