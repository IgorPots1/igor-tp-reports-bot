/**
 * Форма «Добавить старт» на /races: что принимается от посетителя.
 *
 * ЧТО СТЕРЕЖЁТ:
 *   — без ссылки заявки нет, ссылка без схемы дополняется https://;
 *   — заполненное скрытое поле значит бот: ответ «спасибо», в базу ничего;
 *   — длины обрезаются, пробелы схлопываются, «я организатор» только при true;
 *   — адрес посетителя не хранится, только хэш с солью; один адрес даёт один хэш.
 *
 *   npm run check:races-suggest
 */

import assert from "node:assert/strict";

import { checkSuggestion, clientIp, hashIp } from "@/app/races/suggest-logic";

assert.equal(checkSuggestion({}).kind, "invalid", "без ссылки нельзя");
assert.equal(checkSuggestion({ url: "просто текст" }).kind, "invalid");
assert.equal(checkSuggestion({ url: "javascript:alert(1)" }).kind, "invalid");
assert.deepEqual(checkSuggestion({ url: "https://x.ru", website: "spam" }), { kind: "bot" }, "honeypot");

const ok = checkSuggestion({ url: "auroratrail.run", name: "  Aurora   Trail ", city: "Кандалакша", is_organizer: "true" });
assert.equal(ok.kind, "ok");
if (ok.kind === "ok") {
  assert.equal(ok.value.url, "https://auroratrail.run/", "схема дополняется");
  assert.equal(ok.value.name, "Aurora Trail", "пробелы схлопнуты");
  assert.equal(ok.value.is_organizer, false, "строка 'true' не галочка");
  assert.equal(ok.value.contact, null);
}
const long = checkSuggestion({ url: "https://x.ru", name: "я".repeat(500) });
assert.ok(long.kind === "ok" && long.value.name!.length === 200, "длина обрезана");

assert.equal(clientIp("1.2.3.4, 10.0.0.1", null), "1.2.3.4");
assert.equal(clientIp(null, "5.6.7.8"), "5.6.7.8");
assert.equal(hashIp("1.2.3.4", "s"), hashIp("1.2.3.4", "s"), "один адрес даёт один хэш");
assert.notEqual(hashIp("1.2.3.4", "s"), hashIp("1.2.3.5", "s"));
assert.ok(!hashIp("1.2.3.4", "s").includes("1.2.3.4"), "адрес в хэше не виден");

console.log("check:races-suggest ok");
