/**
 * Критерии подбора на вердиктах: вес бегуна и правило «null — нет данных».
 *
 *   npm run check:shoes-verdict-criteria
 */
import {
  FIT_UNKNOWN,
  NEUTRAL,
  NOT_FOR_HEAVY,
  fitWarnings,
  runnerWeightFromVerdicts,
} from "../src/features/shoes/verdict-criteria";
import { EMPTY_VERDICTS, type Verdicts } from "../src/features/shoes/verdict-types";

let failures = 0;
const check = (cond: boolean, msg: string) => {
  console.log(`  ${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) failures += 1;
};
const v = (patch: Partial<Verdicts>): Verdicts => ({ ...EMPTY_VERDICTS, purpose: [], best_for: [], not_for: [], ...patch });

console.log("=== вес бегуна от 85 кг ===");
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
