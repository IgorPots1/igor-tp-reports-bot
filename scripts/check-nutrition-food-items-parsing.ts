import assert from "node:assert/strict";

import { extractNutritionRowsFromFatSecretPdfText } from "@/features/nutrition/file-intake";
import { sanitizeNutritionFoodItems } from "@/features/nutrition/context";
import {
  buildAthleteFacingNotableFoodMention,
  EVENING_SECTIONS,
  pickNotableFoods,
} from "@/features/nutrition/narrative-composer";

// Synthetic products only — never commit a real athlete's food log.
function parse(text: string) {
  return extractNutritionRowsFromFatSecretPdfText({ text, sourceFileName: "synthetic-fatsecret-items.txt" });
}

function run(): void {
  // --- Full RU detailed layout with meal sections -------------------------
  const fullLayoutDay = [
    "понедельник, июня 1, 2026",
    "Кал Жир Н/жир Углев Клетч Сахар Белк Натри Холес Калий",
    "Завтрак",
    "Овсянка Тестовая 320 6 1 55 8 2 12 10 0 200",
    "Всего 320 6 1 55 8 2 12 10 0 200",
    "Ужин",
    "Пицца Тестовая 600 30 12 60 3 5 25 800 40 300",
    "Сыр Домашний Тестовый 200 16 9 2 0 1 12 300 50 100",
    "Перекус/Другое",
    "Мороженое Тестовое 250 14 8 28 0 24 5 80 30 150",
    "Банан Тестовый 90 0 23 1",
    "Всего 1370 66 30 145 11 32 54 1190 120 750",
  ].join("\n");

  const result = parse(fullLayoutDay);
  assert.equal(result.extractedRows.length, 1, "should parse exactly one day");
  const row = result.extractedRows[0];
  assert(row, "row must exist");

  // Daily totals must be IDENTICAL to the daily-total parser (never from items).
  assert.equal(row.day, "2026-06-01");
  assert.equal(row.kcal, 1370, "day total kcal must come from Всего, not items");
  assert.equal(row.fatG, 66);
  assert.equal(row.carbsG, 145);
  assert.equal(row.proteinG, 54);

  const items = row.items ?? [];
  assert(items.length >= 4, `expected >=4 items, got ${items.length}`);

  // No item is sourced from a "Всего" total line.
  assert(
    items.every((item) => !/^всего/i.test(item.name)),
    "no item should be parsed from a Всего line"
  );

  // Sections resolved.
  const byName = new Map(items.map((item) => [item.name, item]));
  assert.equal(byName.get("Овсянка Тестовая")?.section, "breakfast");
  assert.equal(byName.get("Пицца Тестовая")?.section, "dinner");
  assert.equal(byName.get("Сыр Домашний Тестовый")?.section, "dinner");
  assert.equal(byName.get("Мороженое Тестовое")?.section, "snack");

  // Full layout macro picker: kcal[0], fat[1], carbs[3], protein[6].
  assert.equal(byName.get("Пицца Тестовая")?.kcal, 600);
  assert.equal(byName.get("Пицца Тестовая")?.fatG, 30);
  assert.equal(byName.get("Пицца Тестовая")?.carbsG, 60);
  assert.equal(byName.get("Пицца Тестовая")?.proteinG, 25);
  assert.equal(byName.get("Пицца Тестовая")?.source, "fatsecret_pdf_ru_detailed");

  // Compact layout (4 tokens): kcal[0], fat[1], carbs[2], protein[3].
  assert.equal(byName.get("Банан Тестовый")?.kcal, 90);
  assert.equal(byName.get("Банан Тестовый")?.carbsG, 23);
  assert.equal(byName.get("Банан Тестовый")?.proteinG, 1);

  // --- Evening sources picker --------------------------------------------
  const eveningFatFoods = pickNotableFoods(items, "fatG", { sections: EVENING_SECTIONS, limit: 3 });
  assert.deepEqual(
    eveningFatFoods,
    ["Пицца Тестовая", "Сыр Домашний Тестовый", "Мороженое Тестовое"],
    "evening fat sources should be sorted by fat desc"
  );
  // Breakfast item must never appear in an evening pick.
  assert(!eveningFatFoods.includes("Овсянка Тестовая"), "breakfast item leaked into evening pick");
  assert.deepEqual(pickNotableFoods(undefined, "fatG"), [], "undefined items -> []");
  assert.deepEqual(pickNotableFoods([], "fatG"), [], "empty items -> []");

  // --- Old rows without items still parse cleanly ------------------------
  const legacyWeek = [
    "понедельник, июня 1, 2026",
    "Всего 1617 44,97 9,837 176,7 11,11 36,29 112,97 621,1 111,1 811",
    "вторник, июня 2, 2026",
    "Всего 1419 47,69 3,694 164,02 6,7 23,45 80,11 231,1 8 283",
  ].join("\n");
  const legacy = parse(legacyWeek);
  assert.equal(legacy.extractedRows.length, 2, "legacy totals-only layout still parses");
  assert.equal(legacy.extractedRows[0]?.kcal, 1617);
  assert(
    legacy.extractedRows.every((r) => (r.items ?? []).length === 0),
    "totals-only rows carry no items"
  );

  // --- Sanitizer drops malformed entries ---------------------------------
  const sanitized = sanitizeNutritionFoodItems([
    { name: "Хорошее Тестовое", section: "dinner", kcal: 100, fatG: 5, carbsG: 10, proteinG: 4 },
    { name: "", section: "dinner", kcal: 1 },
    { name: "12345", section: "dinner", kcal: 1 },
    { name: "Плохая Секция", section: "midnight", kcal: 50, fatG: 1, carbsG: 1, proteinG: 1 },
    "not-an-object",
  ]);
  assert.equal(sanitized.length, 2, "sanitizer keeps only plausible product rows");
  assert.equal(sanitized.find((s) => s.name === "Плохая Секция")?.section, null, "bad section -> null");

  // --- Athlete-facing policy gating --------------------------------------
  // Default coach_only: never mention high-fat product names athlete-facing.
  assert.equal(
    buildAthleteFacingNotableFoodMention({
      fatFeedbackPolicy: "coach_only",
      items,
      loadDay: true,
      lowCarbs: true,
      highEveningFat: true,
    }),
    null,
    "coach_only must not surface athlete-facing product names"
  );
  for (const policy of ["suppress_athlete", "soften"] as const) {
    assert.equal(
      buildAthleteFacingNotableFoodMention({
        fatFeedbackPolicy: policy,
        items,
        loadDay: true,
        lowCarbs: true,
        highEveningFat: true,
      }),
      null,
      `${policy} must not surface athlete-facing product names`
    );
  }
  // policy=normal on a low-carb load day with high evening fat: neutral mention.
  const normalMention = buildAthleteFacingNotableFoodMention({
    fatFeedbackPolicy: "normal",
    items,
    loadDay: true,
    lowCarbs: true,
    highEveningFat: true,
  });
  assert(normalMention, "policy=normal load+lowCarb+highEveningFat should mention foods");
  assert(normalMention!.includes("Пицца Тестовая"), "neutral mention should name evening fat sources");
  assert(
    !/вредн|плох|неполезн/i.test(normalMention!),
    "athlete-facing mention must stay neutral (no morality words)"
  );
  // policy=normal but not a load/low-carb context: stay silent.
  assert.equal(
    buildAthleteFacingNotableFoodMention({
      fatFeedbackPolicy: "normal",
      items,
      loadDay: false,
      lowCarbs: true,
      highEveningFat: true,
    }),
    null,
    "normal policy without load day stays silent"
  );

  console.log("check:nutrition-food-items-parsing OK");
}

run();
