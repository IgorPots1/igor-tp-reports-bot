import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { nameSearchSpecs, normalizeCyrillicName, translitVariants } from "./name-translit.ts";

describe("translitVariants", () => {
  test("real roster names include the correct Cyrillic among the variants", () => {
    const cases: Array<[string, string]> = [
      ["Malyk", "Малык"],
      ["Anton", "Антон"],
      ["Plotnitskaya", "Плотницкая"],
      ["Ashrapova", "Ашрапова"],
      ["Ivoshin", "Ивошин"],
      ["Zalogina", "Залогина"],
      ["Murtazalieva", "Муртазалиева"],
      ["Sergey", "Сергей"],
    ];
    for (const [latin, expected] of cases) {
      assert.ok(translitVariants(latin).includes(expected), `${latin} → ${translitVariants(latin).join(", ")} должно содержать ${expected}`);
    }
  });

  test("the ai/ay bug: 'Pamparaite' now yields Пампарайте (not only Пампараите)", () => {
    const v = translitVariants("Pamparaite");
    assert.ok(v.includes("Пампарайте"), `variants: ${v.join(", ")}`);
    assert.ok(v.includes("Пампараите")); // the ambiguous alternative is also offered
  });

  test("y after a vowel is a glide (Николай), consonant-y is ы", () => {
    assert.ok(translitVariants("Nikolay").includes("Николай"));
    assert.ok(translitVariants("Rybak").includes("Рыбак"));
  });

  test("given-name DICTIONARY beats rules: correct spelling first", () => {
    const cases: Array<[string, string]> = [
      ["Alexander", "Александр"], ["Tatiana", "Татьяна"], ["Olga", "Ольга"], ["Igor", "Игорь"],
      ["Elena", "Елена"], ["Ekaterina", "Екатерина"], ["Anastasia", "Анастасия"], ["Dmitry", "Дмитрий"],
      ["Demian", "Демьян"],
    ];
    for (const [latin, expected] of cases) assert.equal(translitVariants(latin)[0], expected, `${latin} → ${translitVariants(latin).join(", ")}`);
  });

  test("surname SOFT-SIGN variants are offered (ль, палатализация, -ьев)", () => {
    assert.ok(translitVariants("Vasileva").includes("Васильева"));
    assert.ok(translitVariants("Melnikova").includes("Мельникова"));
    assert.ok(translitVariants("Diyachenko").includes("Дьяченко"));
  });
});

describe("nameSearchSpecs", () => {
  test("includes both orders AND a surname-only spec (the Хадижат given-mismatch case)", () => {
    const specs = nameSearchSpecs("Murtazalieva Hadizhat");
    assert.ok(specs.some((s) => s.surname === "Муртазалиева" && s.given === ""), "должен быть поиск только по фамилии");
    assert.ok(specs.some((s) => s.surname === "Муртазалиева" && s.given !== ""), "и фамилия+имя");
  });

  test("already-Cyrillic passes through", () => {
    const specs = nameSearchSpecs("Плотницкая Анна");
    assert.ok(specs.some((s) => s.surname === "Плотницкая" && s.given === "Анна"));
  });
});

describe("normalizeCyrillicName", () => {
  test("lowercases and folds ё→е", () => {
    assert.equal(normalizeCyrillicName("Пётр Королёв"), "петр королев");
    assert.equal(normalizeCyrillicName("  Анна   ПЛОТНИЦКАЯ "), "анна плотницкая");
  });
});
