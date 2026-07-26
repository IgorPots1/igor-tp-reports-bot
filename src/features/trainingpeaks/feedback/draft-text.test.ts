import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { enforceGreeting } from "./draft-text.ts";

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
