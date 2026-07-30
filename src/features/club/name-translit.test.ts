import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { nameGuesses, normalizeCyrillicName, translitWord } from "./name-translit.ts";

describe("translitWord", () => {
  test("real roster surnames transliterate to the expected Cyrillic", () => {
    assert.equal(translitWord("Malyk"), "Малык");
    assert.equal(translitWord("Anton"), "Антон");
    assert.equal(translitWord("Plotnitskaya"), "Плотницкая");
    assert.equal(translitWord("Ashrapova"), "Ашрапова");
    assert.equal(translitWord("Ivoshin"), "Ивошин");
    assert.equal(translitWord("Pamparayte"), "Пампарайте");
    assert.equal(translitWord("Zalogina"), "Залогина");
    assert.equal(translitWord("Murtazalieva"), "Муртазалиева");
  });

  test("y is a glide after a vowel (ай), else the vowel ы", () => {
    assert.equal(translitWord("Nikolay"), "Николай");
    assert.equal(translitWord("Rybak"), "Рыбак");
  });

  test("common digraphs", () => {
    assert.equal(translitWord("Shishkin"), "Шишкин");
    assert.equal(translitWord("Zhukov"), "Жуков");
    assert.equal(translitWord("Chekhov"), "Чехов");
  });
});

describe("nameGuesses", () => {
  test("returns both surname/given orders for a two-token Latin name", () => {
    const g = nameGuesses("Malyk Anton");
    assert.deepEqual(g, [
      { surname: "Малык", given: "Антон" },
      { surname: "Антон", given: "Малык" },
    ]);
  });

  test("passes already-Cyrillic names through (only cased)", () => {
    const g = nameGuesses("Плотницкая Анна");
    assert.equal(g[0].surname, "Плотницкая");
    assert.equal(g[0].given, "Анна");
  });
});

describe("normalizeCyrillicName", () => {
  test("lowercases and folds ё→е", () => {
    assert.equal(normalizeCyrillicName("Пётр Королёв"), "петр королев");
    assert.equal(normalizeCyrillicName("  Анна   ПЛОТНИЦКАЯ "), "анна плотницкая");
  });
});
