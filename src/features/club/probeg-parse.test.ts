import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { studentNameVariantSets } from "./name-translit.ts";
import { descriptorToKm, distanceMatch, extractFinishes, isForeignRace, matchRace, nameGate, type ProbegFinish } from "./probeg-parse.ts";

// Rows copied from a real probeg /results/ page (shape preserved): a word-form marathon, a numeric
// "5 км", and a meters "10550 м" — the three distance encodings the parser must all read.
const FIXTURE = `
<table class="table table-condensed table-hover">
<tr class="info"><th>№</th><th>Дата</th><th>Забег</th><th>Город</th><th>Результат</th></tr>
<tr><td>1</td><td class="text-center"><a href="/race/187000/">04.07.2026</a></td><td><a href="/race/187000/">XXXV Международный марафон «Белые ночи»<br/>марафон</a></td><td><a href="/races/city/1/">Санкт-Петербург</a></td><td>4:34:39</td><td>7309 из 8000</td><td>М 35-44<br/>(100 из 200)</td><td>40 лет</td><td>Сергей Ивошин</td><td>г Самара</td><td></td></tr>
<tr><td>2</td><td class="text-center"><a href="/race/1/">05.07.2026</a></td><td><a href="/race/1/">Коломенский полумарафон «Летопись победы»<br/>5 км</a></td><td><a href="/races/city/2/">Московская область, Коломна</a></td><td>0:38:04</td><td>247 из 259</td><td>Ж 35-44</td><td>39 лет</td><td>Виктория Малык</td><td>г Москва</td><td></td></tr>
<tr><td>3</td><td class="text-center"><a href="/race/3/">22.06.2025</a></td><td><a href="/race/3/">V Международный марафон Алые Паруса<br/>10550 м</a></td><td><a href="/races/city/1/">Санкт-Петербург</a></td><td>1:00:20</td><td>243 из 900</td><td>М 35-44</td><td>39 лет</td><td>Сергей Ивошин</td><td>г Самара</td><td></td></tr>
<tr><td>4</td><td class="text-center"><a href="/race/4/">15.06.2025</a></td><td><a href="/race/4/">Арена Марафон<br/>10 км</a></td><td><a href="/races/city/1/">Санкт-Петербург</a></td><td>0:50:00</td><td>10 из 100</td><td>М 30-39</td><td>31 год</td><td></td><td>г Москва</td><td></td></tr>
</table>`;

describe("extractFinishes", () => {
  const f = extractFinishes(FIXTURE);
  test("one finish per data row (header skipped)", () => {
    assert.equal(f.length, 4);
  });
  test("name comes from the «Имя» column, not the event cell («Арена Марафон» is the event, name is blank)", () => {
    assert.equal(f[3].event, "Арена Марафон"); // two capitalised words in the event cell...
    assert.equal(f[3].name, ""); // ...must NOT leak into the finisher name; the «Имя» cell is empty
  });
  test("distance from all three encodings: word марафон, N км, N м", () => {
    assert.equal(f[0].distanceKm, 42.2); // «марафон»
    assert.equal(f[1].distanceKm, 5); // «5 км»
    assert.equal(f[2].distanceKm, 10.55); // «10550 м»
  });
  test("date, time, place, city, finisher name", () => {
    assert.equal(f[0].date, "2026-07-04");
    assert.equal(f[0].seconds, 4 * 3600 + 34 * 60 + 39);
    assert.equal(f[0].place, "7309");
    assert.equal(f[0].city, "Санкт-Петербург");
    assert.equal(f[0].name, "Сергей Ивошин"); // namesake disambiguation is by eye; the name is shown, never decisive
    assert.equal(f[1].name, "Виктория Малык");
  });
});

describe("descriptorToKm", () => {
  test("words and numbers", () => {
    assert.equal(descriptorToKm("марафон"), 42.2);
    assert.equal(descriptorToKm("полумарафон"), 21.1); // checked before марафон (substring)
    assert.equal(descriptorToKm("21.1 км"), 21.1);
    assert.equal(descriptorToKm("10550 м"), 10.55);
    assert.equal(descriptorToKm("5 км"), 5);
    assert.equal(descriptorToKm(""), null);
  });
});

describe("distanceMatch", () => {
  test("band tolerates GPS/labeling drift, rejects different distances", () => {
    assert.ok(distanceMatch(10, 10.55)); // 10k labeled 10550 m
    assert.ok(distanceMatch(42.2, 44)); // marathon GPS overrun
    assert.ok(distanceMatch(21.1, 21.3));
    assert.ok(!distanceMatch(10, 15));
    assert.ok(!distanceMatch(5, 3));
    assert.ok(!distanceMatch(10, null));
  });
});

describe("nameGate", () => {
  const malyk = studentNameVariantSets("Malyk Anton"); // roster is Latin
  const hadizhat = studentNameVariantSets("Murtazalieva Hadizhat");
  test("surname exact + given exact/shortened passes; foreign surname and namesake fail", () => {
    assert.ok(nameGate(malyk, "Антон Малык")); // exact both
    assert.ok(nameGate(hadizhat, "Хади Муртазалиева")); // surname exact, given Хади⊂Хадижат
    assert.ok(!nameGate(malyk, "Роман Антонов")); // surname Малык matches nothing (prefix pool Антон)
    assert.ok(!nameGate(hadizhat, "Надежда Муртазалиева")); // same surname, given incompatible → namesake
  });
  test("given-name coincidence alone does NOT pass (Павлова Кристина)", () => {
    const kristina = studentNameVariantSets("Kristina Pamparaite");
    assert.ok(!nameGate(kristina, "Павлова Кристина")); // only the given «Кристина» overlaps
    assert.ok(nameGate(kristina, "Кристина Пампарайте")); // her real row
  });
  test("strict forbids the given shortening (auto-link bar)", () => {
    assert.ok(!nameGate(hadizhat, "Хади Муртазалиева", { strict: true })); // Хади is not exact → no auto-link
    assert.ok(nameGate(malyk, "Антон Малык", { strict: true }));
  });

  test("the Бучкина bug: dictionary given name makes the student pass their OWN finish", () => {
    const buchkina = studentNameVariantSets("Buchkina Tatiana"); // rules alone gave «Татияна» ≠ «Татьяна»
    assert.ok(nameGate(buchkina, "Татьяна Бучкина")); // now passes — and strictly, so auto-linkable
    assert.ok(nameGate(buchkina, "Татьяна Бучкина", { strict: true }));
  });

  test("soft-sign / ё / one-letter tolerance on the surname", () => {
    assert.ok(nameGate(studentNameVariantSets("Vasileva Elena"), "Елена Васильева")); // ь
    assert.ok(nameGate(studentNameVariantSets("Melnikova Olga"), "Ольга Мельникова")); // ь
    assert.ok(nameGate(studentNameVariantSets("Korolev Petr"), "Пётр Королёв")); // ё/е
    assert.ok(!nameGate(malyk, "Антон Малыков")); // 2-letter surname extension still rejected
  });

  test("the one-letter tolerance does NOT merge distinct given names (Лилия ≠ Лидия)", () => {
    const liliya = studentNameVariantSets("Zalogina Liliya");
    assert.ok(nameGate(liliya, "Лилия Залогина"));
    assert.ok(!nameGate(liliya, "Лидия Залогина")); // both given names → fuzzy withheld → different person
    assert.ok(!nameGate(studentNameVariantSets("Karina Ivanova"), "Марина Иванова")); // Карина ≠ Марина
  });
});

describe("isForeignRace", () => {
  test("Latin-script titles flagged (the bulk of the abroad races)", () => {
    for (const t of ["Durmitor Ultra", "PG Run League", "Bokeški polumaraton", "Podgorička noć", "Columbus Marathon", "Hometown 10k", "Larnaka Race", "Rakvere jooks"]) {
      assert.ok(isForeignRace(t), t);
    }
  });
  test("Cyrillic toponyms flagged", () => {
    assert.ok(isForeignRace("Черногория, Будва — забег"));
    assert.ok(isForeignRace("Нарвский полумарафон"));
    assert.ok(isForeignRace("Дубайский марафон"));
  });
  test("Russian/CIS titles NOT flagged (Roman numerals are not Latin words)", () => {
    assert.ok(!isForeignRace("XII Казанский марафон"));
    assert.ok(!isForeignRace("XXXV Международный марафон «Белые ночи»"));
    assert.ok(!isForeignRace("Московский полумарафон"));
    assert.ok(!isForeignRace("Минский полумарафон")); // Belarus is CIS → on probeg
  });
});

describe("matchRace", () => {
  const at = (h: number, m: number, s: number): number => h * 3600 + m * 60 + s;
  const malyk = studentNameVariantSets("Malyk Anton");
  const ivoshin = studentNameVariantSets("Ivoshin Sergey");
  const kristina = studentNameVariantSets("Kristina Pamparaite");
  const hadizhat = studentNameVariantSets("Murtazalieva Hadizhat");

  test("Назаров: matching name+date, Δ1s, but conflicting distance → probable «дистанция сомнительна» (not dropped)", () => {
    const race = { date: "2026-07-04", ourSeconds: at(3, 43, 57), ourKm: 47.641 }; // our GPS distance is garbage
    const finishes: ProbegFinish[] = [{ date: "2026-07-04", seconds: at(3, 43, 58), distanceKm: 42.2, name: "Дмитрий Назаров", place: "1", city: "", event: "" }];
    const r = matchRace(race, finishes, studentNameVariantSets("Nazarov Dmitry"));
    assert.equal(r.verdict, "probable");
    assert.equal(r.distanceDoubtful, true);
  });

  test("Головко: matching name+date, Δ2min, conflicting distance → probable «дистанция сомнительна»", () => {
    const race = { date: "2026-07-04", ourSeconds: at(4, 31, 37), ourKm: 57.618 };
    const finishes: ProbegFinish[] = [{ date: "2026-07-04", seconds: at(4, 29, 23), distanceKm: 42.2, name: "Екатерина Головко", place: "1", city: "", event: "" }];
    const r = matchRace(race, finishes, studentNameVariantSets("Golovko Ekaterina"));
    assert.equal(r.verdict, "probable");
    assert.equal(r.distanceDoubtful, true);
  });

  test("distance still guards NAMESAKES: a FOREIGN name with matching distance+time → none", () => {
    const race = { date: "2026-07-04", ourSeconds: at(0, 45, 8), ourKm: 10 };
    const finishes: ProbegFinish[] = [{ date: "2026-07-04", seconds: at(0, 45, 6), distanceKm: 10, name: "Роман Антонов", place: "1", city: "", event: "" }];
    assert.equal(matchRace(race, finishes, malyk).verdict, "none"); // name rules it out before distance matters
  });

  test("name gate: foreign surname on a perfect date+distance+time → none (the Роман Антонов false positive)", () => {
    const race = { date: "2026-07-04", ourSeconds: at(0, 45, 8), ourKm: 10 };
    const finishes: ProbegFinish[] = [{ date: "2026-07-04", seconds: at(0, 45, 10), distanceKm: 10, name: "Роман Антонов", place: "1", city: "", event: "" }];
    const r = matchRace(race, finishes, malyk);
    assert.equal(r.verdict, "none");
    assert.equal(r.nameRejected?.name, "Роман Антонов"); // surfaced so the report explains the drop
  });

  test("name gate: given-name coincidence on a perfect match → none (the Павлова Кристина false positive)", () => {
    const race = { date: "2026-05-23", ourSeconds: at(0, 57, 12), ourKm: 10 };
    const finishes: ProbegFinish[] = [{ date: "2026-05-23", seconds: at(0, 57, 12), distanceKm: 10, name: "Павлова Кристина", place: "1", city: "", event: "" }];
    assert.equal(matchRace(race, finishes, kristina).verdict, "none");
  });

  test("Ивошин: our 4:41 marathon vs probeg 4:34 marathon, name matches → probable", () => {
    const race = { date: "2026-07-04", ourSeconds: at(4, 41, 9), ourKm: 42.2 };
    const finishes: ProbegFinish[] = [{ date: "2026-07-04", seconds: at(4, 34, 39), distanceKm: 42.2, name: "Сергей Ивошин", place: "7309", city: "СПб", event: "" }];
    const r = matchRace(race, finishes, ivoshin);
    assert.equal(r.verdict, "probable");
    assert.equal(r.deltaSeconds, 390);
  });

  test("exact when time ≤1min, distance corroborates, and name is exact", () => {
    const race = { date: "2026-05-23", ourSeconds: at(0, 45, 8), ourKm: 10 };
    const finishes: ProbegFinish[] = [{ date: "2026-05-23", seconds: at(0, 45, 20), distanceKm: 10, name: "Антон Малык", place: "102", city: "", event: "" }];
    assert.equal(matchRace(race, finishes, malyk).verdict, "exact");
  });

  test("shortened given (Хади) demotes a perfect time+distance from exact to probable (no auto-link)", () => {
    const race = { date: "2026-05-23", ourSeconds: at(0, 55, 0), ourKm: 21.1 };
    const finishes: ProbegFinish[] = [{ date: "2026-05-23", seconds: at(0, 55, 5), distanceKm: 21.1, name: "Хади Муртазалиева", place: "5", city: "", event: "" }];
    assert.equal(matchRace(race, finishes, hadizhat).verdict, "probable"); // strict name fails → not auto-linked
  });

  test("a CONFIRMED spelling makes «Хади Муртазалиева» exact (auto-link, no re-queue)", () => {
    const race = { date: "2026-05-23", ourSeconds: at(0, 55, 0), ourKm: 21.1 };
    const finishes: ProbegFinish[] = [{ date: "2026-05-23", seconds: at(0, 55, 5), distanceKm: 21.1, name: "Хади Муртазалиева", place: "5", city: "", event: "" }];
    const r = matchRace(race, finishes, hadizhat, { exact: 60, probable: 900 }, ["хади муртазалиева"]);
    assert.equal(r.verdict, "exact");
    assert.equal(r.byConfirmedName, true);
  });

  test("a confirmed spelling with a conflicting distance is PROBABLE «дистанция сомнительна», never auto-linked", () => {
    const race = { date: "2026-05-23", ourSeconds: at(0, 55, 0), ourKm: 10 };
    const finishes: ProbegFinish[] = [{ date: "2026-05-23", seconds: at(0, 55, 5), distanceKm: 42.2, name: "Хади Муртазалиева", place: "5", city: "", event: "" }];
    const r = matchRace(race, finishes, hadizhat, { exact: 60, probable: 900 }, ["хади муртазалиева"]);
    assert.notEqual(r.verdict, "exact"); // distance conflict blocks auto-link even for a confirmed name
    assert.equal(r.verdict, "probable");
    assert.equal(r.distanceDoubtful, true);
  });

  test("unreadable finisher name is NOT a reject: perfect time+distance → probable «имя не распозналось»", () => {
    const race = { date: "2025-06-15", ourSeconds: at(0, 50, 2), ourKm: 10 };
    const finishes: ProbegFinish[] = [{ date: "2025-06-15", seconds: at(0, 50, 0), distanceKm: 10, name: "", place: "10", city: "", event: "Арена Марафон" }];
    const r = matchRace(race, finishes, malyk);
    assert.equal(r.verdict, "probable"); // not dropped — coach decides
    assert.equal(r.nameUnrecognized, true);
  });

  test("exact still fires when probeg has no readable distance (time ≤1min + exact name)", () => {
    const race = { date: "2026-05-23", ourSeconds: at(0, 45, 8), ourKm: 10 };
    const finishes: ProbegFinish[] = [{ date: "2026-05-23", seconds: at(0, 45, 20), distanceKm: null, name: "Антон Малык", place: "102", city: "", event: "" }];
    assert.equal(matchRace(race, finishes, malyk).verdict, "exact");
  });

  test("conflicting distance with a matching name blocks EXACT but yields probable «дистанция сомнительна»", () => {
    const race = { date: "2026-05-23", ourSeconds: at(0, 45, 8), ourKm: 10 };
    const finishes: ProbegFinish[] = [{ date: "2026-05-23", seconds: at(0, 45, 20), distanceKm: 42.2, name: "Антон Малык", place: "1", city: "", event: "" }];
    const r = matchRace(race, finishes, malyk);
    assert.equal(r.verdict, "probable");
    assert.equal(r.distanceDoubtful, true);
  });
});
