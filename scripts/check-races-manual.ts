/**
 * Шлюз ручных стартов (scripts/races-manual.ts): правила, которые еженедельный
 * агент не может обойти, потому что они в коде.
 *
 * ЧТО СТЕРЕЖЁТ:
 *   — дубль по правилу тренера: дата ±2 дня И (похожее название ИЛИ тот же
 *     город и тип). Дата в 3 дня уже не дубль;
 *   — окно: от сегодня до 31.12 следующего года;
 *   — insert без source_url, с чужим race_type или тегом, онлайн, детский,
 *     абонемент, кемп, велогонка отклоняются;
 *   — update только ручных строк и только разрешённых полей; status через
 *     update не меняется (убрать можно только командой remove с причиной);
 *   — реестр источников не принимает сайты, которые собирает робот;
 *     dead перепроверяется раз в 90 дней.
 *
 *   npm run check:races-manual
 */

import assert from "node:assert/strict";

import {
  dateText,
  dueSources,
  findDuplicate,
  inWindow,
  isAutoCollected,
  manualId,
  mergeSources,
  nameSimilar,
  validateInsert,
  validateUpdate,
  weeklySummary,
  type CalendarRow,
  type RaceInsert,
  type Source,
} from "./races-manual";

const TODAY = "2026-10-11";

// Похожесть названий.
assert.ok(nameSimilar("Кросс «Лисья гора»", "Лисья Гора - кросс 2026"));
assert.ok(nameSimilar("100-й Петербургский Марафон. Пушкин - Петербург", "Марафон «Пушкин — Петербург»"));
assert.ok(!nameSimilar("Новогодний забег", "Рождественский забег"), "общие служебные слова не делают похожими");
assert.ok(!nameSimilar("Забег", "Пробег"), "без значимых слов не похожи");

// Дубль: дата ±2 И (имя ИЛИ город+тип).
const cal: CalendarRow[] = [
  { id: "probeg:1", name: "Казанский марафон", date_start: "2027-05-02", date_end: null, city: "Казань", race_type: "road" },
  { id: "orgeo:2", name: "Кубок области", date_start: "2027-06-10", date_end: null, city: "Тверь", race_type: "tri" },
];
const ins = (o: Partial<RaceInsert>) => ({ name: "X", date_start: "2027-05-02", city: "Пермь", race_type: "road", ...o });
assert.equal(findDuplicate(ins({ name: "Казанский марафон 2027", date_start: "2027-05-04" }), cal)?.id, "probeg:1", "имя, +2 дня");
assert.equal(findDuplicate(ins({ name: "Казанский марафон", date_start: "2027-05-05" }), cal), null, "3 дня уже не дубль");
assert.equal(findDuplicate(ins({ name: "Совсем другое", city: "Тверь", race_type: "tri", date_start: "2027-06-11" }), cal)?.id, "orgeo:2", "город и тип");
assert.equal(findDuplicate(ins({ name: "Совсем другое", city: "Тверь", race_type: "road", date_start: "2027-06-11" }), cal), null, "город тот, тип другой");

// Окно.
assert.ok(inWindow("2026-10-11", TODAY) && inWindow("2027-12-31", TODAY));
assert.ok(!inWindow("2026-10-10", TODAY) && !inWindow("2028-01-01", TODAY));

// Валидация вставки.
const good: RaceInsert = {
  name: "Трейл «Аргамак»", date_start: "2027-05-30", city: "Аргамач-Пальна", race_type: "trail",
  source_url: "https://reg.russiarunning.com/event/argamak2027", tags: ["fest"], dist_km: [20, 7],
};
assert.deepEqual(validateInsert(good, TODAY), []);
assert.ok(validateInsert({ ...good, source_url: "" }, TODAY).length, "без подтверждения нельзя");
assert.ok(validateInsert({ ...good, race_type: "bike" }, TODAY).length);
assert.ok(validateInsert({ ...good, tags: ["kids"] }, TODAY).length);
for (const bad of ["Онлайн-забег", "Детский забег", "Беговой кемп", "Абонемент", "Велогонка"]) {
  assert.ok(validateInsert({ ...good, name: bad }, TODAY).length, `«${bad}» отклоняется`);
}

// Update: только ручные, только разрешённые поля, status нельзя.
assert.deepEqual(validateUpdate({ id: "manual:x-2027", reason: "перенос", date_start: "2027-06-01" }, TODAY), []);
assert.ok(validateUpdate({ id: "probeg:1", reason: "x", date_start: "2027-06-01" }, TODAY).length, "не ручная строка");
assert.ok(validateUpdate({ id: "manual:x", reason: "x", status: "active" } as never, TODAY).length, "status через update нельзя");
assert.ok(validateUpdate({ id: "manual:x", reason: "x", source: "probeg" } as never, TODAY).length, "source менять нельзя");
assert.ok(validateUpdate({ id: "manual:x", reason: "" }, TODAY).length, "без причины нельзя");

// Формат id и даты.
assert.equal(manualId("АРГАМАК ТРЕЙЛ 2027", "2027-05-30"), "manual:argamak-treil-2027");
assert.equal(manualId("Игры ЭкстримКрым", "2027-07-23"), "manual:igry-ekstrimkrym-2027");
assert.equal(dateText("2027-07-23", "2027-07-25"), "23-25.07.2027");
assert.equal(dateText("2027-05-30", "2027-05-30"), "30.05.2027");

// Реестр.
assert.ok(isAutoCollected("https://probeg.org/event/1/") && isAutoCollected("https://www.reg.place/x") && !isAutoCollected("https://reg.russiarunning.com/event/x"));
const reg: Source[] = [];
const m1 = mergeSources(reg, [{ url: "https://x-waters.com/events/ural/", kind: "series" }, { url: "https://probeg.org/event/5/" }], TODAY);
assert.equal(m1.added.length, 1);
assert.equal(m1.rejected.length, 1, "автосбор отклонён");
const m2 = mergeSources(m1.reg, [{ url: "https://x-waters.com/events/ural", status: "dead", note: "404" }], "2026-10-18");
assert.equal(m2.added.length, 0, "тот же сайт без слэша не дубль");
assert.equal(m2.reg[0].status, "dead");
assert.equal(dueSources(m2.reg, "2026-12-01").length, 0, "dead раньше 90 дней не обходим");
assert.equal(dueSources(m2.reg, "2027-01-17").length, 1, "dead через 90 дней перепроверяем");

// Итог недели в ops-log.
const sum = weeklySummary({
  apply: true,
  today: TODAY,
  proposal: { checked: ["manual:a"], candidates: [{ url: "https://cal.example/list", races: 40, dated_with_year: true }], queries: ["триатлон Казань 2027"] },
  out: [
    { kind: "added", id: "manual:t-2027", text: "...", link: "https://t.example", tri: true },
    { kind: "removed", id: "manual:b-2026", text: "появился в основном потоке: probeg:9" },
  ],
  merged: { added: [], changed: [], rejected: [] },
  activeTotal: 12,
});
assert.match(sum, /добавлено 1 \(из них триатлонов 1\)/);
assert.match(sum, /всего active 12/);
assert.match(sum, /Кандидаты в автосбор:\n- https:\/\/cal\.example\/list: около 40 стартов/);
assert.ok(!/[—–]/.test(sum), "без длинных тире");

console.log("check:races-manual ok");
