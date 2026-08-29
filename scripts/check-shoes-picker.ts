/**
 * Прогон движка подбора на профилях.
 *
 * Здесь же будет стенд калибровки (этап 2 ТЗ): Игорь даёт 5–7 реальных
 * атлетов и что бы он сам им посоветовал, профили ложатся в PROFILES с полем
 * `expect`, и веса в src/features/shoes/weights.ts крутятся, пока выдача не
 * совпадёт. Пока expect не заполнен, скрипт проверяет только инварианты,
 * которые не зависят от калибровки.
 *
 *   npm run check:shoes-picker
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { clientCatalog } from "../src/features/shoes/catalog";
import { recommend } from "../src/features/shoes/recommend";
import { searchShoes } from "../src/features/shoes/search";
import type { Answers } from "../src/features/shoes/types";

const base: Answers = {
  weeklyVolume: "40-60",
  surface: "road",
  goal: "half",
  winter: "none",
  speedwork: true,
  gender: "m",
  bodyWeightKg: 75,
  footWidth: "std",
  pronation: "neutral",
  issues: ["none"],
  ownedShoeIds: [],
  dislikes: ["none"],
  feel: 3,
  tier: "any",
  market: "ru",
  pairs: 3,
};

type Profile = { name: string; answers: Answers; expectSlots: string[] };

const PROFILES: Profile[] = [
  {
    name: "Одна пара на всё, без скоростных, 20–40 км",
    answers: { ...base, pairs: 1, speedwork: false, weeklyVolume: "20-40", goal: "just_run" },
    expectSlots: ["daily"],
  },
  {
    name: "Полумарафон, три пары, скоростные есть",
    answers: base,
    expectSlots: ["daily", "tempo", "race"],
  },
  {
    name: "Тяжёлый бегун 92 кг, болели голени, жалуется на жёсткость",
    answers: {
      ...base,
      bodyWeightKg: 92,
      issues: ["shin"],
      dislikes: ["harsh"],
      feel: 5,
      pairs: 2,
    },
    expectSlots: ["daily", "tempo"],
  },
  {
    name: "Широкая стопа, давило пальцы",
    answers: { ...base, footWidth: "wide", dislikes: ["narrow"], pairs: 2 },
    expectSlots: ["daily", "tempo"],
  },
  {
    name: "Трейл и ультра",
    answers: { ...base, surface: "trail", goal: "trail_ultra", pairs: 2 },
    expectSlots: ["daily", "trail", "tempo"],
  },
  {
    name: "Смешанная поверхность, три пары — добавляется грунт",
    answers: { ...base, surface: "mixed", goal: "marathon", pairs: 3 },
    expectSlots: ["daily", "tempo", "race", "trail_light"],
  },
  {
    name: "Бюджет «доступные» — стартовый слот обязан остаться живым",
    answers: { ...base, tier: "low" },
    expectSlots: ["daily", "tempo", "race"],
  },
  {
    name: "Женские модели, ахилл, 60–80 км",
    answers: {
      ...base,
      gender: "w",
      issues: ["achilles"],
      weeklyVolume: "60-80",
      bodyWeightKg: 58,
    },
    expectSlots: ["daily", "tempo", "race"],
  },
];

// Проверка зимнего слота — таблица «Проверка после внедрения» дополнения №1.
const WINTER_CASES: {
  name: string;
  answers: Answers;
  check: (r: ReturnType<typeof recommend>, fail: (m: string) => void) => void;
}[] = [
  {
    name: "Снег и лёд, асфальт — наверху глубокий протектор и мембрана",
    answers: { ...base, winter: "snow", surface: "road", pairs: 2 },
    check: (results, fail) => {
      const winter = results.find((r) => r.slot.id === "winter");
      if (!winter || winter.picks.length === 0) return fail("зимний слот пуст");
      const top = winter.picks[0];
      if (top.shoe.winter_grip < 9) fail(`наверху сцепление ${top.shoe.winter_grip}, ожидалось от 9`);
      if (top.shoe.membrane === "none") fail(`наверху пара без мембраны: ${top.shoe.id}`);
    },
  },
  {
    name: "Дождь и слякоть, асфальт — дорожные GTX выше трейловых",
    answers: { ...base, winter: "slush", surface: "road", pairs: 2 },
    check: (results, fail) => {
      const winter = results.find((r) => r.slot.id === "winter");
      if (!winter || winter.picks.length === 0) return fail("зимний слот пуст");
      if (winter.picks[0].shoe.surface !== "road") {
        fail(`наверху трейловая пара при асфальте: ${winter.picks[0].shoe.id}`);
      }
      const firstTrail = winter.picks.findIndex((x) => x.shoe.surface === "trail");
      const lastRoad = winter.picks.map((x) => x.shoe.surface).lastIndexOf("road");
      if (firstTrail !== -1 && firstTrail < lastRoad) {
        fail("трейловая пара оказалась выше дорожной при асфальте");
      }
    },
  },
  {
    name: "Дождь и слякоть, трейл — трейловые GTX допускаются наверх",
    answers: { ...base, winter: "slush", surface: "trail", goal: "trail_ultra", pairs: 2 },
    check: (results, fail) => {
      const winter = results.find((r) => r.slot.id === "winter");
      if (!winter || winter.picks.length === 0) return fail("зимний слот пуст");
      if (winter.picks[0].shoe.surface !== "trail") {
        fail(`на трейле наверху дорожная пара: ${winter.picks[0].shoe.id}`);
      }
    },
  },
  {
    name: "Зимой не бегаю — слота нет, мембраны нет нигде",
    answers: { ...base, winter: "none", pairs: 3 },
    check: (results, fail) => {
      if (results.some((r) => r.slot.id === "winter")) fail("зимний слот появился без зимы");
      const membrane = results
        .flatMap((r) => r.picks)
        .filter((x) => x.shoe.membrane !== "none" || x.shoe.categories.includes("winter"));
      if (membrane.length > 0) {
        fail(`зимняя модель попала в обычный слот: ${membrane.map((m) => m.shoe.id).join(", ")}`);
      }
    },
  },
  {
    name: "Две пары плюс зима — на выходе три слота, а не два",
    answers: { ...base, winter: "snow", pairs: 2 },
    check: (results, fail) => {
      if (results.length !== 3) fail(`слотов ${results.length}, ожидалось 3`);
      if (!results.some((r) => r.slot.id === "winter")) fail("нет зимнего слота");
    },
  },
];

let failures = 0;
const fail = (msg: string) => {
  console.error(`  ✗ ${msg}`);
  failures += 1;
};

// Инварианты, не зависящие от калибровки.
// 1. Цены не уезжают на клиент вообще.
const leaked = clientCatalog.shoes.filter((s) => "price" in s);
if (leaked.length > 0) fail(`в клиентский каталог просочилась цена: ${leaked.length} моделей`);

// 2. Клиентский компонент не тянет каталог сам: он приходит пропсом с сервера,
//    уже без цен. Прямой импорт catalog.ts затащил бы в браузерный бандл JSON
//    С ЦЕНАМИ — их бы никто не увидел на экране, но в исходниках страницы они
//    лежали бы открыто.
const picker = readFileSync(resolve("src/app/tools/shoes/ShoePicker.tsx"), "utf8");
if (/from "@\/features\/shoes\/catalog"/.test(picker)) {
  fail("ShoePicker импортирует catalog.ts напрямую — в бандл уедут цены");
}

for (const p of PROFILES) {
  console.log(`\n=== ${p.name} ===`);
  const results = recommend(clientCatalog, p.answers);
  const ids = results.map((r) => r.slot.id);
  if (ids.join(",") !== p.expectSlots.join(",")) {
    fail(`слоты: ожидались [${p.expectSlots.join(", ")}], получены [${ids.join(", ")}]`);
  }

  for (const r of results) {
    if (r.picks.length === 0) {
      console.log(`  ${r.slot.title}: пусто — «${r.emptyReason}»`);
      fail(`слот «${r.slot.title}» пуст на демо-базе`);
      continue;
    }
    const line = r.picks
      .map((x) => `${x.shoe.brand} ${x.shoe.model} (${x.score})`)
      .join(" · ");
    console.log(`  ${r.slot.title}: ${line}`);
    const first = r.picks[0];
    if (first.pros.length === 0) fail(`у лучшего совпадения в «${r.slot.title}» нет ни одного плюса`);

    // Пол не должен подменять вес бегуна: женская версия обязана приносить
    // свой вес пары, а не мужской, когда версия измерена.
    if (p.answers.gender === "w" && first.variant.gender !== "w") {
      fail(`выбрана мужская версия при запросе женских: ${first.shoe.id}`);
    }
  }

  // Профильные требования, которые калибровка сдвинуть не должна.
  const daily = results.find((r) => r.slot.id === "daily");
  if (p.answers.bodyWeightKg >= 85 && daily) {
    const thin = daily.picks.filter((x) => x.shoe.stack_heel_mm < 36);
    if (thin.length > 0) fail(`под ${p.answers.bodyWeightKg} кг предложен низкий стек: ${thin.map((t) => t.shoe.id).join(", ")}`);
  }
  if (p.answers.footWidth === "wide" && daily) {
    const narrow = daily.picks.filter((x) => x.shoe.last_width === "narrow");
    if (narrow.length > 0) fail(`под широкую стопу предложена узкая колодка: ${narrow.map((t) => t.shoe.id).join(", ")}`);
  }
  if (p.answers.issues.includes("achilles")) {
    const low = results.flatMap((r) => r.picks).filter((x) => x.shoe.drop_mm < 6);
    if (low.length > 0) fail(`при больном ахилле предложен дроп < 6 мм: ${low.map((t) => t.shoe.id).join(", ")}`);
  }
}

console.log("\n=== Зима ===");
for (const c of WINTER_CASES) {
  console.log(`\n--- ${c.name} ---`);
  const results = recommend(clientCatalog, c.answers);
  for (const r of results) {
    const line = r.picks.length
      ? r.picks.map((x) => `${x.shoe.brand} ${x.shoe.model} (${x.score})`).join(" · ")
      : `пусто — «${r.emptyReason}»`;
    console.log(`  ${r.slot.title}: ${line}`);
  }
  const winter = results.find((r) => r.slot.id === "winter");
  if (winter?.picks[0]) {
    console.log(`    плюсы: ${winter.picks[0].pros.join("; ") || "—"}`);
    console.log(`    минусы: ${winter.picks[0].cons.join("; ") || "—"}`);
  }
  c.check(results, fail);
}

// Пустой слот. На полной демо-базе он не встречается ни в одной из 1620
// комбинаций ответов — а значит, сам по себе не проверится никогда. Гоним его
// на урезанном каталоге: человеку должно достаться прямое сообщение с
// названием мешающего ограничения, а не пустое место и не выдуманная модель.
console.log("\n=== Пустой слот ===");
{
  const noTrail = {
    ...clientCatalog,
    shoes: clientCatalog.shoes.filter((s) => s.surface !== "trail"),
  };
  const results = recommend(noTrail, { ...base, surface: "trail", goal: "trail_ultra", pairs: 2 });
  const trail = results.find((r) => r.slot.id === "trail");
  if (!trail) fail("трейловый слот не появился");
  else {
    console.log(`  сообщение: «${trail.emptyReason}»`);
    if (trail.picks.length !== 0) fail("слот не пуст, проверка бессмысленна");
    if (!trail.emptyReason) fail("пустой слот остался без сообщения");
  }

  // И то же самое из-за рынка: сообщение обязано назвать именно рынок.
  const ruOnly = {
    ...clientCatalog,
    shoes: clientCatalog.shoes.map((s) => ({ ...s, available: ["ru"] as ("ru" | "eu")[] })),
  };
  const eu = recommend(ruOnly, { ...base, market: "eu" });
  const daily = eu.find((r) => r.slot.id === "daily");
  console.log(`  сообщение: «${daily?.emptyReason}»`);
  if (daily?.picks.length !== 0) fail("слот не пуст при недоступном рынке");
  if (!daily?.emptyReason?.includes("рынок")) fail("сообщение не назвало рынок как причину");
}

console.log("\n=== Поиск по индексу ===");
for (const q of ["новабласт", "пегас", "клифтон", "найк пегас", "хока", "асикс 2000", "endorphin"]) {
  const hits = searchShoes(q, 3);
  console.log(`  «${q}» → ${hits.map((h) => `${h.brand} ${h.model}`).join(" · ") || "ничего"}`);
  if (hits.length === 0) fail(`поиск «${q}» ничего не нашёл`);
}

if (failures > 0) {
  console.error(`\nПРОВАЛ: ${failures}`);
  process.exit(1);
}
console.log("\nОК");
