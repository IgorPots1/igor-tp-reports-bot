import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { descriptorToKm, distanceMatch, extractFinishes, matchRace, type ProbegFinish } from "./probeg-parse.ts";

// Rows copied from a real probeg /results/ page (shape preserved): a word-form marathon, a numeric
// "5 км", and a meters "10550 м" — the three distance encodings the parser must all read.
const FIXTURE = `
<table class="table table-condensed table-hover">
<tr class="info"><th>№</th><th>Дата</th><th>Забег</th><th>Город</th><th>Результат</th></tr>
<tr><td>1</td><td class="text-center"><a href="/race/187000/">04.07.2026</a></td><td><a href="/race/187000/">XXXV Международный марафон «Белые ночи»<br/>марафон</a></td><td><a href="/races/city/1/">Санкт-Петербург</a></td><td>4:34:39</td><td>7309 из 8000</td><td>М 35-44<br/>(100 из 200)</td><td>40 лет</td><td>Сергей Ивошин</td><td>г Самара</td><td></td></tr>
<tr><td>2</td><td class="text-center"><a href="/race/1/">05.07.2026</a></td><td><a href="/race/1/">Коломенский полумарафон «Летопись победы»<br/>5 км</a></td><td><a href="/races/city/2/">Московская область, Коломна</a></td><td>0:38:04</td><td>247 из 259</td><td>Ж 35-44</td><td>39 лет</td><td>Виктория Малык</td><td>г Москва</td><td></td></tr>
<tr><td>3</td><td class="text-center"><a href="/race/3/">22.06.2025</a></td><td><a href="/race/3/">V Международный марафон Алые Паруса<br/>10550 м</a></td><td><a href="/races/city/1/">Санкт-Петербург</a></td><td>1:00:20</td><td>243 из 900</td><td>М 35-44</td><td>39 лет</td><td>Сергей Ивошин</td><td>г Самара</td><td></td></tr>
</table>`;

describe("extractFinishes", () => {
  const f = extractFinishes(FIXTURE);
  test("one finish per data row (header skipped)", () => {
    assert.equal(f.length, 3);
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

describe("matchRace", () => {
  const at = (h: number, m: number, s: number): number => h * 3600 + m * 60 + s;

  test("Малык bug: a same-date 5h marathon is NOT a candidate for our 46-min 10k", () => {
    const race = { date: "2026-07-04", ourSeconds: at(0, 45, 8), ourKm: 10 };
    const finishes: ProbegFinish[] = [{ date: "2026-07-04", seconds: at(0, 45, 0), distanceKm: 42.2, name: "Антон Антонов", place: "1", city: "", event: "" }];
    assert.equal(matchRace(race, finishes).verdict, "none"); // Δ 8s BUT distance mismatch → dropped
  });

  test("Ивошин: our 4:41 marathon vs probeg 4:34 marathon → probable (gun vs chip)", () => {
    const race = { date: "2026-07-04", ourSeconds: at(4, 41, 9), ourKm: 42.2 };
    const finishes: ProbegFinish[] = [{ date: "2026-07-04", seconds: at(4, 34, 39), distanceKm: 42.2, name: "Сергей Ивошин", place: "7309", city: "СПб", event: "" }];
    const r = matchRace(race, finishes);
    assert.equal(r.verdict, "probable");
    assert.equal(r.deltaSeconds, 390);
  });

  test("exact when time ≤1min and distance corroborates", () => {
    const race = { date: "2026-05-23", ourSeconds: at(0, 45, 8), ourKm: 10 };
    const finishes: ProbegFinish[] = [{ date: "2026-05-23", seconds: at(0, 45, 20), distanceKm: 10, name: "Антон Малык", place: "102", city: "", event: "" }];
    assert.equal(matchRace(race, finishes).verdict, "exact");
  });

  test("exact still fires when probeg has no readable distance (time ≤1min is self-disambiguating)", () => {
    const race = { date: "2026-05-23", ourSeconds: at(0, 45, 8), ourKm: 10 };
    const finishes: ProbegFinish[] = [{ date: "2026-05-23", seconds: at(0, 45, 20), distanceKm: null, name: "Антон Малык", place: "102", city: "", event: "" }];
    assert.equal(matchRace(race, finishes).verdict, "exact");
  });

  test("both distances known and conflicting → not even exact", () => {
    const race = { date: "2026-05-23", ourSeconds: at(0, 45, 8), ourKm: 10 };
    const finishes: ProbegFinish[] = [{ date: "2026-05-23", seconds: at(0, 45, 20), distanceKm: 42.2, name: "namesake", place: "1", city: "", event: "" }];
    assert.equal(matchRace(race, finishes).verdict, "none");
  });
});
