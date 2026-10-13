/**
 * Критерии подбора на вердиктах: вес бегуна и правило «null — нет данных».
 *
 *   npm run check:shoes-verdict-criteria
 */
import {
  FIT_UNKNOWN,
  NEUTRAL,
  NOT_FOR_HEAVY,
  feelFromVerdicts,
  fitWarnings,
  runnerWeightFromVerdicts,
} from "../src/features/shoes/verdict-criteria";
import { basisLinks } from "../src/features/shoes/verdict-basis";
import { EMPTY_VERDICTS, type VerdictRecord, type Verdicts } from "../src/features/shoes/verdict-types";

let failures = 0;
const check = (cond: boolean, msg: string) => {
  console.log(`  ${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) failures += 1;
};
const v = (patch: Partial<Verdicts>): Verdicts => ({ ...EMPTY_VERDICTS, purpose: [], best_for: [], not_for: [], ...patch });

console.log("=== ощущение: шкала опросника и firmness одного направления ===");
// firmness: 1 жёстко … 5 очень мягко (решение Игоря 14.10.2026; до этого шкала
// вердикта шла наоборот). Ответ «максимум мягкости» обязан поднимать firmness 5.
{
  const soft5 = feelFromVerdicts(5, v({ firmness: 5 })).score;
  const hard1 = feelFromVerdicts(5, v({ firmness: 1 })).score;
  check(soft5 > hard1, "«максимум мягкости» поднимает firmness 5 выше firmness 1");
  check(soft5 === 1, "«максимум мягкости» и firmness 5 — полное попадание");
  const order = [1, 2, 3, 4, 5].map((f) => feelFromVerdicts(5, v({ firmness: f as 1 })).score);
  check(order.every((x, i) => i === 0 || x > order[i - 1]), "при «максимум мягкости» балл растёт с firmness монотонно");
  check(
    feelFromVerdicts(1, v({ firmness: 1 })).score > feelFromVerdicts(1, v({ firmness: 5 })).score,
    "«жёстко и отзывчиво» поднимает firmness 1 выше firmness 5"
  );
  check(feelFromVerdicts(5, v({})).score === NEUTRAL, "firmness неизвестен — нейтрально");
  check(feelFromVerdicts(5, v({ firmness: 1 })).note?.text === "заметно жёстче, чем ты просил", "жёсткая при просьбе мягкой — минус «жёстче»");
}

console.log("\n=== «на чём основано»: только ссылки, без цитат ===");
{
  const rec: VerdictRecord = {
    id: "x", brand: "B", model: "m", year: 2026, year_source: null, year_conflict: null,
    verdicts: v({}), confidence: "low", disputed: [], decided_by: {}, status: "draft",
    evidence: [
      { field: "firmness", url: "https://a.example/r1", source: "a", source_title: "Площадка А", date: null, quote: "SECRET QUOTE ONE" },
      { field: "feel", url: "https://a.example/r1", source: "a", source_title: "Площадка А", date: null, quote: "SECRET QUOTE TWO" },
      { field: "width", url: "https://b.example/r2", source: "b", source_title: "Площадка Б", date: null, quote: "SECRET QUOTE THREE" },
    ],
  };
  const basis = basisLinks(rec);
  check(basis.length === 2, "один обзор — одна строка, хоть полей по нему несколько");
  check(!JSON.stringify(basis).includes("SECRET"), "в блок карточки не попадает текст цитаты");
  check(basis.every((b) => Object.keys(b).sort().join() === "title,url"), "в блоке только название и ссылка");
}

console.log("\n=== вес бегуна от 85 кг ===");
check(runnerWeightFromVerdicts(92, v({ durability: "high", purpose: ["daily"] })).score === 1, "живучая ежедневная — плюс");
check(runnerWeightFromVerdicts(92, v({ durability: "high", purpose: ["max"] })).score === 1, "живучая максималка — плюс");
check(runnerWeightFromVerdicts(92, v({ durability: "high", purpose: ["race"] })).score === NEUTRAL, "живучая, но стартовая — нейтрально");
check(runnerWeightFromVerdicts(92, v({ not_for: [NOT_FOR_HEAVY] })).score < NEUTRAL, "явное «не для тяжёлых» — штраф");
check(
  runnerWeightFromVerdicts(92, v({ durability: "high", purpose: ["daily"], not_for: [NOT_FOR_HEAVY] })).score < NEUTRAL,
  "явный запрет обзора сильнее плюса за подошву"
);

console.log("\n=== легче 85 кг критерий молчит ===");
check(runnerWeightFromVerdicts(70, v({ not_for: [NOT_FOR_HEAVY] })).score === NEUTRAL, "лёгкому «не для тяжёлых» не мешает");
check(runnerWeightFromVerdicts(70, v({ durability: "high", purpose: ["daily"] })).score === NEUTRAL, "и плюса за подошву не даёт");

console.log("\n=== null — нет данных, не стандарт ===");
// Прежний критерий судил по стеку; новый не имеет права делать выводы из
// отсутствия поля. Модель без данных и модель с «средней» подошвой равны.
const empty = runnerWeightFromVerdicts(92, v({}));
const average = runnerWeightFromVerdicts(92, v({ durability: "average", purpose: ["daily"] }));
check(empty.score === NEUTRAL && empty.note === null, "пустые поля — нейтрально и без пояснения");
check(empty.score === average.score, "пустое поле не проигрывает известному среднему");

console.log("\n=== жалоба есть, данных нет — строка про примерку ===");
check(fitWarnings(["narrow"], v({ width: null })).includes(FIT_UNKNOWN), "узко + ширина неизвестна → примерка");
check(fitWarnings(["heel_rub"], v({ heel_hold: null })).includes(FIT_UNKNOWN), "пятка + посадка пятки неизвестна → примерка");
check(fitWarnings(["narrow"], v({ width: "wide" })).length === 0, "ширина известна — строки нет");
check(fitWarnings(["heavy"], v({})).length === 0, "жалоба не про посадку — строки нет");
check(fitWarnings(["narrow", "heel_rub"], v({})).length === 1, "оба поля пусты — строка одна, не две");

console.log(failures ? `\nПРОВАЛ: ${failures}` : "\nОК");
process.exit(failures ? 1 : 0);
