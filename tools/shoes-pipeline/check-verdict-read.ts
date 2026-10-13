/**
 * Чек правил чтения обзоров (наряд «путь первый», 13.10.2026).
 *
 *   npm run check:shoes-verdict-read
 *
 * Держит то, что нельзя отдавать на добросовестность модели: цитата ищется
 * кодом точной подстрокой, сравнения не засчитываются, один источник не даёт
 * вердикта без confidence low, соседние деления сводятся медианой, далёкие —
 * спор.
 */
import assert from "node:assert/strict";

import {
  FEEL_ORDINAL,
  FIRMNESS_ORDINAL,
  checkQuote,
  firmnessConflict,
  gateBySense,
  medianTowardCenter,
  settleField,
  vetAnswer,
  type Obs,
  type ReaderAnswer,
} from "./lib/verdict-read";
import { ALL_CON, ALL_PRO, OPPOSITE, THESIS_FIELD } from "./lib/theses";

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`  ✓ ${name}`);
};

const PAGE =
  "The Clifton 11 is a daily trainer. The midsole feels soft and protective underfoot on long runs. " +
  "It is firmer than the Pegasus 41 in the forefoot. The Clifton 10 felt a bit softer overall. " +
  "Heel lockdown is secure and I had no slipping at all.";

ok("цитата, которой нет на странице, отброшена", () => {
  const r = checkQuote(PAGE, "The midsole feels plush and bouncy underfoot", [], undefined);
  assert.equal(r.ok, false);
});
ok("точная подстрока принята, пробелы и кавычки не мешают", () => {
  assert.equal(checkQuote(PAGE, "The midsole  feels soft and protective underfoot", []).ok, true);
});
ok("регистр важен: «точная подстрока» значит точная", () => {
  assert.equal(checkQuote(PAGE, "the midsole feels soft and protective underfoot", []).ok, false);
});
ok("короткая цитата не доказывает ничего", () => {
  assert.equal(checkQuote(PAGE, "feels soft", []).ok, false);
});
ok("сравнение «firmer than the …» не засчитывается", () => {
  const r = checkQuote(PAGE, "It is firmer than the Pegasus 41 in the forefoot.", ["Pegasus"]);
  assert.equal(r.ok, false);
});
ok("имя другой модели с заглавной — отброшено даже без оборота сравнения", () => {
  const page = "I swapped to the Pegasus for intervals and back.";
  assert.equal(checkQuote(page, "I swapped to the Pegasus for intervals", ["Pegasus"]).ok, false);
});
ok("обычное слово в строчном написании — не имя модели (shoe, heel не режут цитату)", () => {
  assert.equal(checkQuote(PAGE, "Heel lockdown is secure and I had no slipping at all.", ["Shoe", "Lockdown"]).ok, true);
});
ok("«than» внутри самой модели — не сравнение (пятка против носка)", () => {
  const page = "The heel does a better job of absorbing impact than the forefoot on long runs.";
  assert.equal(checkQuote(page, "The heel does a better job of absorbing impact than the forefoot", []).ok, true);
});
ok("«than many shoes» — сравнение с другими, отброшено", () => {
  const page = "Its midsole absorbs more impact than many shoes can in the first 10k.";
  assert.equal(checkQuote(page, "Its midsole absorbs more impact than many shoes can", []).ok, false);
});
ok("«Compared to …» в начале предложения тоже ловится", () => {
  const page = "Compared to the old foam, this ride is much softer underfoot.";
  assert.equal(checkQuote(page, "Compared to the old foam, this ride is much softer", []).ok, false);
});
ok("шкала firmness — 1 жёстко … 5 мягко: «firm» не даёт 4–5", () => {
  // До 14.10.2026 шкала шла наоборот (1 очень мягкая). Инвариант Игоря держит
  // направление опросника: слова и число не должны спорить.
  assert.ok(firmnessConflict(5, "It is remarkably firm underfoot"));
  assert.ok(firmnessConflict(4, "плотная пена, жёсткая на пятке"));
  assert.equal(firmnessConflict(2, "It is remarkably firm underfoot"), null);
});
ok("шкала firmness: «soft», «мягкая» не даёт 1–2", () => {
  assert.ok(firmnessConflict(1, "The foam feels soft and plush"));
  assert.ok(firmnessConflict(2, "очень мягкая подошва"));
  assert.equal(firmnessConflict(5, "The foam feels soft and plush"), null);
});
ok("обе группы слов в одной цитате оставляют только середину", () => {
  assert.ok(firmnessConflict(4, "firm but soft underfoot"));
  assert.ok(firmnessConflict(2, "firm but soft underfoot"));
  assert.equal(firmnessConflict(3, "firm but soft underfoot"), null);
});
ok("сравнение по-русски не засчитывается", () => {
  const page = "Пена мягче, чем у прошлой версии, и это заметно на длинных.";
  assert.equal(checkQuote(page, "Пена мягче, чем у прошлой версии, и это заметно", []).ok, false);
});
ok("прошлая версия той же линейки не засчитывается", () => {
  const r = checkQuote(PAGE, "The Clifton 10 felt a bit softer overall.", [], { name: "clifton", version: 11 });
  assert.equal(r.ok, false);
});
ok("своя версия в цитате не мешает", () => {
  const r = checkQuote(PAGE, "The Clifton 11 is a daily trainer.", [], { name: "clifton", version: 11 });
  assert.equal(r.ok, true);
});

const answer = (over: Partial<ReaderAnswer>): ReaderAnswer => ({
  key: "hoka/clifton-11",
  source: "x",
  url: "u",
  about_model: true,
  purpose: [],
  feel: null,
  firmness: null,
  width: null,
  durability: null,
  heel_hold: null,
  winter_grip: null,
  best_for: [],
  not_for: [],
  release: null,
  ...over,
});

ok("тезис не из словаря отброшен, даже с верной цитатой", () => {
  const v = vetAnswer(
    answer({ best_for: [{ thesis: "мягкий как облако", quote: "The midsole feels soft and protective underfoot" }] }),
    PAGE,
    []
  );
  assert.equal(v.accepted.length, 0);
  assert.equal(v.rejected[0].reason, "тезиса нет в словаре");
});
ok("значение вне шкалы отброшено", () => {
  const v = vetAnswer(
    answer({ firmness: { value: 7 as never, quote: "The midsole feels soft and protective underfoot" } }),
    PAGE,
    []
  );
  assert.equal(v.accepted.length, 0);
});
ok("страница не про модель — ни одного вердикта", () => {
  const v = vetAnswer(
    answer({ about_model: false, firmness: { value: 2, quote: "The midsole feels soft and protective underfoot" } }),
    PAGE,
    []
  );
  assert.equal(v.accepted.length, 0);
});

const o = <T>(value: T, source: string): Obs<T> => ({ value, quote: "q", source, url: source, date: null });

ok("один источник без confidence low — не вердикт", () => {
  assert.equal(settleField([o(2, "a")], false, FIRMNESS_ORDINAL).kind, "single");
});
ok("один источник с confidence low — вердикт", () => {
  const s = settleField([o(2, "a")], true, FIRMNESS_ORDINAL);
  assert.equal(s.kind === "agreed" && s.value, 2);
});
ok("два наблюдения ОДНОГО источника — всё равно один источник", () => {
  assert.equal(settleField([o(2, "a"), o(2, "a")], false, FIRMNESS_ORDINAL).kind, "single");
});
ok("firmness: разница в 1 — не спор, медиана к центру (2 и 3 → 3, 4 и 5 → 4)", () => {
  const a = settleField([o(2, "a"), o(3, "b")], false, FIRMNESS_ORDINAL);
  assert.equal(a.kind === "agreed" && a.value, 3);
  const b = settleField([o(5, "a"), o(4, "b")], false, FIRMNESS_ORDINAL);
  assert.equal(b.kind === "agreed" && b.value, 4);
});
ok("firmness: разница от 2 — спор, значение не ставится", () => {
  assert.equal(settleField([o(2, "a"), o(4, "b")], false, FIRMNESS_ORDINAL).kind, "disputed");
  assert.equal(settleField([o(2, "a"), o(3, "b"), o(4, "c")], false, FIRMNESS_ORDINAL).kind, "disputed");
});
ok("feel: соседние (balanced и soft_stable) сводятся, далёкие — спор", () => {
  const a = settleField([o("balanced", "a"), o("soft_stable", "b")], false, FEEL_ORDINAL);
  assert.equal(a.kind, "agreed");
  assert.equal(settleField([o("firm_responsive", "a"), o("soft_stable", "b")], false, FEEL_ORDINAL).kind, "disputed");
});
ok("width: соседства нет — узкая против обычной это спор", () => {
  assert.equal(settleField([o("narrow", "a"), o("standard", "b")], false, null).kind, "disputed");
});
ok("медиана нечётного числа — середина, без сдвига", () => {
  assert.equal(medianTowardCenter([1, 2, 2], 2), 2);
});

ok("смысловой шлюз: подтверждённое проходит, отвергнутое и непроверенное — нет", () => {
  const items = [{ id: "a#0" }, { id: "a#1" }, { id: "b#0" }];
  const g = gateBySense(items, [
    { id: "a#0", ok: true },
    { id: "a#1", ok: false, why: "про общий характер, не про жёсткость" },
  ]);
  assert.deepEqual(g.passed.map((x) => x.id), ["a#0"]);
  assert.equal(g.failed.find((x) => x.id === "b#0")?.reason, "смысл не проверен");
});
ok("нет файла проверки — не засчитано ничего", () => {
  assert.equal(gateBySense([{ id: "a#0" }], null).passed.length, 0);
});

ok("vetAnswer отбрасывает firmness, спорящий со словами цитаты", () => {
  const v = vetAnswer(answer({ firmness: { value: 5, quote: "The midsole feels soft and protective underfoot" } }), PAGE, []);
  assert.equal(v.accepted.length, 1);
  const w = vetAnswer(answer({ firmness: { value: 1, quote: "The midsole feels soft and protective underfoot" } }), PAGE, []);
  assert.equal(w.accepted.length, 0);
  assert.equal(w.rejected[0].reason, "цитата про мягкость не даёт 1–2");
});

ok("пары противоположных тезисов и привязки к полям — дословно из словаря", () => {
  // Опечатка в паре молча отключила бы правило «противоположные тезисы снимаются
  // оба» (у Tecton X 3 в карточке спорили «просторная» и «узкая колодка»).
  const dict = new Set([...ALL_PRO, ...ALL_CON]);
  for (const [a, b] of OPPOSITE) assert.ok(dict.has(a) && dict.has(b), `${a} / ${b}`);
  for (const t of Object.keys(THESIS_FIELD)) assert.ok(dict.has(t), t);
});

console.log(`\ncheck-verdict-read: ${n} проверок прошли`);
