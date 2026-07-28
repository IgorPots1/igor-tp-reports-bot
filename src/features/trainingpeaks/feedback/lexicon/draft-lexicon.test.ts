import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { stemRu, tokenizeRu } from "./stemmer.ts";
import { checkDraftVocabulary } from "./draft-lexicon.ts";

describe("stemRu — inflections collapse, short words survive", () => {
  test("verb forms of «частить» share a stem", () => {
    const s = stemRu("частил");
    assert.equal(stemRu("частила"), s);
    assert.equal(stemRu("частят"), s);
  });
  test("adjective forms collapse", () => {
    const s = stemRu("ровный");
    assert.equal(stemRu("ровная"), s);
    assert.equal(stemRu("ровные"), s);
  });
  test("short words kept whole", () => {
    assert.equal(stemRu("бег"), "бег");
    assert.equal(stemRu("сон"), "сон");
  });
  test("ё normalised to е", () => {
    assert.equal(stemRu("тёмп"), stemRu("темп"));
  });
});

describe("tokenizeRu", () => {
  test("keeps Cyrillic words, drops numbers/latin/emoji/punct", () => {
    assert.deepEqual(tokenizeRu("Отлично 👍 темп 340 EF ok!"), ["отлично", "темп"]);
  });
  test("splits on punctuation, keeps hyphenated", () => {
    assert.deepEqual(tokenizeRu("когда-нибудь, потом."), ["когда-нибудь", "потом"]);
  });
});

describe("checkDraftVocabulary — Блок 2+3", () => {
  test("catches the three target jargon words", () => {
    const jargon = checkDraftVocabulary("По темпу аэробно ты частил, декаплинг небольшой").findings.filter((f) => f.reason === "jargon");
    const words = jargon.map((f) => f.word);
    assert.ok(words.includes("аэробно"), "аэробно flagged");
    assert.ok(words.includes("частил"), "частил flagged");
    assert.ok(words.includes("декаплинг"), "декаплинг flagged");
  });
  test("«часто» / «часть» are NOT flagged (blacklist is exact-form, not stem «част»)", () => {
    const found = checkDraftVocabulary("ты часто бегаешь эту часть трассы").findings.map((f) => f.word);
    assert.ok(!found.includes("часто"));
    assert.ok(!found.includes("часть"));
  });
  test("a clean in-voice draft has no jargon findings", () => {
    const jargon = checkDraftVocabulary("Отлично пробежал 👍 темп ровный, молодец").findings.filter((f) => f.reason === "jargon");
    assert.equal(jargon.length, 0);
  });
  test("dedups repeated jargon by form", () => {
    const jargon = checkDraftVocabulary("аэробно и ещё раз аэробно").findings.filter((f) => f.reason === "jargon");
    assert.equal(jargon.length, 1);
  });
});
