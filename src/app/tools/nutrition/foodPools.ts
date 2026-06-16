// Пулы еды и логика расчёта для публичного калькулятора питания под тренировку.
// Источник: food_pools_extended.js (70 позиций) и nutrition_calc_v4.jsx.
// Граммовку и состав пулов НЕ менять — выверено вручную.

export type FoodPoolKey = "fast" | "meal" | "recovery" | "recovery_light";

// ============================================================
// РАСШИРЕННЫЕ ПУЛЫ ЕДЫ — научно выверенные
//   FAST     — только быстрые углеводы, минимум жира/белка/клетчатки (за 30-60 мин)
//   MEAL     — углеводы + умеренный белок (за 2-3 часа)
//   RECOVERY — после тяжёлых: углеводы + полноценный белок
//   RECOVERY_LIGHT — после лёгких: проще, но всё равно углеводы + белок
// ============================================================
export const FOOD_POOLS: Record<FoodPoolKey, string[]> = {
  // ========== БЫСТРЫЕ УГЛЕВОДЫ (за 30-60 мин, без жира/белка/клетчатки) ==========
  fast: [
    "Банан",
    "Тост с мёдом",
    "Тост с джемом",
    "Финики 4-5 шт",
    "Энергетический гель",
    "Спортивный напиток",
    "Белый хлеб с мёдом",
    "Рисовые хлебцы с джемом",
    "Половина бейгла с джемом",
    "Овсяноблин с мёдом",
    "Печёное яблоко",
    "Сок + банан",
    "Изюм горсть",
    "Курага 5-6 шт",
    "Зефир 2-3 шт",
    "Мармелад горсть",
    "Хлебцы с вареньем",
    "Банановое пюре",
    "Сухофрукты горсть",
    "Галеты с мёдом",
  ],

  // ========== НОРМАЛЬНАЯ ЕДА (за 2-3 часа, углеводы + белок) ==========
  meal: [
    "Овсянка на молоке + банан + мёд",
    "Рис + яйцо + овощи",
    "Паста + куриная грудка (нежирно)",
    "Гречка + яйцо",
    "Овсянка + творог + ягоды",
    "Тосты + яйцо + немного сыра",
    "Рисовая каша на молоке + мёд",
    "Картофель отварной + индейка",
    "Омлет + тост + банан",
    "Сэндвич с курицей + банан",
    "Гречка + куриная грудка",
    "Овсянка + яичный белок + мёд",
    "Паста + тунец (в собственном соку)",
    "Рис + индейка + овощи",
    "Творожная запеканка + банан",
    "Блины с творогом + мёд",
    "Тост + яйцо пашот + банан",
    "Булгур + курица",
    "Сырники (запечённые) + мёд",
    "Овсяноблин + творог + банан",
  ],

  // ========== ВОССТАНОВЛЕНИЕ ПОСЛЕ ТЯЖЁЛЫХ (углеводы + белок) ==========
  recovery: [
    "Шоколадное молоко + банан",
    "Рис + курица + овощи",
    "Творог + банан + мёд",
    "Гречка + индейка",
    "Омлет + тост + банан",
    "Протеиновый коктейль + банан",
    "Курица + картофель",
    "Лосось + рис",
    "Греческий йогурт + гранола + мёд",
    "Творожная запеканка + ягоды",
    "Паста + куриная грудка",
    "Рис + говядина + овощи",
    "Яйца + тост + авокадо",
    "Индейка + булгур + овощи",
    "Скумбрия + картофель",
    "Творог + овсянка + банан",
    "Куриный суп + хлеб",
    "Тунец + рис + овощи",
    "Протеин + овсянка + ягоды",
    "Котлеты из индейки + гречка",
  ],

  // ========== ВОССТАНОВЛЕНИЕ ПОСЛЕ ЛЁГКИХ (проще, углеводы + белок) ==========
  recovery_light: [
    "Йогурт + банан + овсянка",
    "Творог с мёдом + хлеб",
    "Яйца + тост + банан",
    "Кефир + фрукты + гранола",
    "Сэндвич с курицей",
    "Смузи: банан + овсянка + молоко",
    "Творог + ягоды + мёд",
    "Омлет + тост",
    "Йогурт + гранола + банан",
    "Сырники + чай",
  ],
};

export type WorkoutType = "easy_short" | "long" | "tempo";
export type TimeBefore = "<1" | "1-2" | "2-3" | "3+";

export type NutritionBlock = {
  carbs: number;
  protein: number;
  examples: string[];
  rule: string;
};

export type NutritionResult = {
  before: NutritionBlock;
  after: NutritionBlock;
};

// Сид-перемешивание (LCG) — детерминированный выбор примеров, как в исходнике.
function pickN(arr: string[], n: number, seed: number): string[] {
  const shuffled = [...arr];
  let s = seed;
  for (let i = shuffled.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, n);
}

const TIME_MAP: Record<TimeBefore, number> = {
  "<1": 0.5,
  "1-2": 1.5,
  "2-3": 2.5,
  "3+": 3.5,
};

export function calcNutrition(
  weight: number,
  type: WorkoutType,
  timeBefore: TimeBefore,
  seed: number,
): NutritionResult {
  const before: NutritionBlock = { carbs: 0, protein: 0, examples: [], rule: "" };
  const after: NutritionBlock = { carbs: 0, protein: 0, examples: [], rule: "" };

  const hours = TIME_MAP[timeBefore];
  const closeToRun = hours <= 1; // меньше часа: только быстрые углеводы, без белка

  // ===== ДО =====
  if (type === "easy_short") {
    if (closeToRun) {
      before.rule = "Близко к пробежке, только быстрые углеводы без белка и жира";
      before.carbs = Math.round(weight * 0.5);
      before.examples = pickN(FOOD_POOLS.fast, 3, seed);
    } else {
      before.rule = "Можно натощак при адаптации, или нормальный приём с углеводами и белком";
      before.carbs = Math.round(weight * 1);
      before.protein = Math.round(weight * 0.25);
      before.examples = [
        ...pickN(FOOD_POOLS.meal, 2, seed),
        "Или натощак, если с вечера были углеводы",
      ];
    }
  } else if (type === "long") {
    if (closeToRun) {
      before.carbs = Math.round(weight * 0.7);
      before.rule = "Времени мало, только быстрые углеводы";
      before.examples = pickN(FOOD_POOLS.fast, 3, seed);
    } else {
      const gPerKg = hours >= 3 ? 2.5 : 1.5;
      before.carbs = Math.round(weight * gPerKg);
      before.protein = Math.round(weight * 0.25);
      before.rule = `Нормальный приём за ${timeBefore} ч: углеводы плюс немного белка. Белок сглаживает скачок сахара`;
      before.examples = pickN(FOOD_POOLS.meal, 3, seed);
    }
  } else if (type === "tempo") {
    if (closeToRun) {
      before.carbs = Math.round(weight * 0.7);
      before.rule = "Времени мало, быстрые углеводы. Белок сейчас не нужен, помешает";
      before.examples = pickN(FOOD_POOLS.fast, 3, seed);
    } else {
      const gPerKg = hours >= 2 ? 2 : 1.5;
      before.carbs = Math.round(weight * gPerKg);
      before.protein = Math.round(weight * 0.25);
      before.rule = `Углеводы обязательно за ${timeBefore} ч плюс немного белка. На интенсивной тело работает на углеводах`;
      before.examples = pickN(FOOD_POOLS.meal, 3, seed);
    }
  }

  // ===== ПОСЛЕ =====
  after.carbs = Math.round(weight * 1);
  after.protein = type === "long" ? 30 : 25;
  after.rule = `Первые 30-60 минут: ${after.carbs} г углеводов плюс ${after.protein} г белка. Полноценный приём в течение 2 часов`;

  if (type === "long") {
    after.examples = pickN(FOOD_POOLS.recovery, 3, seed);
  } else {
    after.examples = pickN(FOOD_POOLS.recovery_light, 3, seed);
  }

  return { before, after };
}
