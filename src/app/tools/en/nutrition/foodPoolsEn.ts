// English food pools for the public pre/post-run nutrition calculator.
// Same structure and the same grams as ../../nutrition/foodPools.ts; only the
// food names are adapted for an international reader (no Russian-only dishes
// like syrniki, kefir or buckwheat porridge as the default).

import type { NutritionBlock, NutritionResult, TimeBefore, WorkoutType } from "../../nutrition/foodPools";

type FoodPoolKey = "fast" | "meal" | "recovery" | "recovery_light";

const FOOD_POOLS_EN: Record<FoodPoolKey, string[]> = {
  // Fast carbs (30-60 min before, little fat, protein or fibre)
  fast: [
    "A banana",
    "Toast with honey",
    "Toast with jam",
    "4-5 dates",
    "An energy gel",
    "A sports drink",
    "White bread with honey",
    "Rice cakes with jam",
    "Half a bagel with jam",
    "A small pancake with honey",
    "A baked apple",
    "Juice and a banana",
    "A handful of raisins",
    "5-6 dried apricots",
    "2-3 marshmallows",
    "A handful of jelly sweets",
    "Crackers with jam",
    "Mashed banana",
    "A handful of dried fruit",
    "Plain biscuits with honey",
  ],

  // Normal meal (2-3 hours before, carbs plus some protein)
  meal: [
    "Porridge with milk, banana and honey",
    "Rice, an egg and vegetables",
    "Pasta and chicken breast (low fat)",
    "Rice and two eggs",
    "Porridge, cottage cheese and berries",
    "Toast, an egg and a little cheese",
    "Rice pudding with honey",
    "Boiled potatoes and turkey",
    "Omelette, toast and a banana",
    "Chicken sandwich and a banana",
    "Rice and chicken breast",
    "Porridge, egg whites and honey",
    "Pasta and tuna (in water)",
    "Rice, turkey and vegetables",
    "Pancakes with honey and a banana",
    "Pancakes with cottage cheese and honey",
    "Toast, a poached egg and a banana",
    "Couscous and chicken",
    "Bagel with cream cheese and honey",
    "Overnight oats with yogurt and banana",
  ],

  // Recovery after hard or long sessions (carbs plus full protein)
  recovery: [
    "Chocolate milk and a banana",
    "Rice, chicken and vegetables",
    "Cottage cheese, banana and honey",
    "Rice and turkey",
    "Omelette, toast and a banana",
    "Protein shake and a banana",
    "Chicken and potatoes",
    "Salmon and rice",
    "Greek yogurt, granola and honey",
    "Pancakes and Greek yogurt with berries",
    "Pasta and chicken breast",
    "Rice, beef and vegetables",
    "Eggs, toast and avocado",
    "Turkey, couscous and vegetables",
    "Mackerel and potatoes",
    "Cottage cheese, porridge and banana",
    "Chicken soup and bread",
    "Tuna, rice and vegetables",
    "Protein porridge with berries",
    "Turkey meatballs and rice",
  ],

  // Recovery after easy runs (simpler, carbs plus protein)
  recovery_light: [
    "Yogurt, banana and oats",
    "Cottage cheese with honey and bread",
    "Eggs, toast and a banana",
    "Drinking yogurt, fruit and granola",
    "Chicken sandwich",
    "Smoothie: banana, oats and milk",
    "Cottage cheese, berries and honey",
    "Omelette and toast",
    "Yogurt, granola and a banana",
    "Pancakes and a glass of milk",
  ],
};

// Seeded shuffle (LCG), the same as the Russian calculator.
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

export function calcNutritionEn(
  weight: number,
  type: WorkoutType,
  timeBefore: TimeBefore,
  seed: number,
): NutritionResult {
  const before: NutritionBlock = { carbs: 0, protein: 0, examples: [], rule: "" };
  const after: NutritionBlock = { carbs: 0, protein: 0, examples: [], rule: "" };

  const hours = TIME_MAP[timeBefore];
  const closeToRun = hours <= 1;

  if (type === "easy_short") {
    if (closeToRun) {
      before.rule = "Close to the run: only fast carbs, no protein or fat";
      before.carbs = Math.round(weight * 0.5);
      before.examples = pickN(FOOD_POOLS_EN.fast, 3, seed);
    } else {
      before.rule = "You can run on an empty stomach if you're used to it, or eat a normal meal with carbs and protein";
      before.carbs = Math.round(weight * 1);
      before.protein = Math.round(weight * 0.25);
      before.examples = [
        ...pickN(FOOD_POOLS_EN.meal, 2, seed),
        "Or on an empty stomach, if you had carbs the evening before",
      ];
    }
  } else if (type === "long") {
    if (closeToRun) {
      before.carbs = Math.round(weight * 0.7);
      before.rule = "Not much time left: fast carbs only";
      before.examples = pickN(FOOD_POOLS_EN.fast, 3, seed);
    } else {
      const gPerKg = hours >= 3 ? 2.5 : 1.5;
      before.carbs = Math.round(weight * gPerKg);
      before.protein = Math.round(weight * 0.25);
      before.rule = `A normal meal ${timeBefore} h before: carbs plus a little protein. Protein smooths out the sugar spike`;
      before.examples = pickN(FOOD_POOLS_EN.meal, 3, seed);
    }
  } else if (type === "tempo") {
    if (closeToRun) {
      before.carbs = Math.round(weight * 0.7);
      before.rule = "Not much time left: fast carbs. Skip protein now, it will get in the way";
      before.examples = pickN(FOOD_POOLS_EN.fast, 3, seed);
    } else {
      const gPerKg = hours >= 2 ? 2 : 1.5;
      before.carbs = Math.round(weight * gPerKg);
      before.protein = Math.round(weight * 0.25);
      before.rule = `Carbs are a must ${timeBefore} h before, plus a little protein. Hard running burns mostly carbs`;
      before.examples = pickN(FOOD_POOLS_EN.meal, 3, seed);
    }
  }

  after.carbs = Math.round(weight * 1);
  after.protein = type === "long" ? 30 : 25;
  after.rule = `In the first 30-60 minutes: ${after.carbs} g of carbs plus ${after.protein} g of protein. A full meal within 2 hours`;

  after.examples =
    type === "long" ? pickN(FOOD_POOLS_EN.recovery, 3, seed) : pickN(FOOD_POOLS_EN.recovery_light, 3, seed);

  return { before, after };
}
