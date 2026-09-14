/**
 * Текст инструкции: разметка, деление на части и единственность источника.
 *
 * ЗАЧЕМ. Один и тот же текст теперь показывают две поверхности: страница
 * igorp.run/connect и мини-приложение. Три вещи могут сломаться молча, и
 * каждая дорого стоит:
 *
 *   1. В тексте появится разметка, которой разметчик не умеет (таблица,
 *      цитата, картинка). Он не падает, он её ПРОПУСКАЕТ: текст уедет в прод
 *      покалеченным, и никто не заметит.
 *   2. Правила формата уползут обратно в шаги подключения. Деление сделано
 *      ради человека, который подключается: ему нечего запоминать про разборы.
 *   3. Кто-нибудь заведёт вторую копию текста рядом с приложением, и правка
 *      тренера доедет до страницы, но не до приложения.
 *
 * Запуск: npm run check:connect-text
 */

import { readFileSync } from "node:fs";

import { CONNECT_PAGE } from "@/features/intervals/connect-content";
import {
  DEVICE_GUIDES,
  NO_WATCH_BODY_RU,
  STEP_LEAD_RU,
} from "@/features/intervals/device-guide";
import { findUnsupported } from "@/features/intervals/markdown-blocks";

let failures = 0;
function expect(condition: boolean, message: string): void {
  console.log(`  ${condition ? "✓" : "✗"} ${message}`);
  if (!condition) failures += 1;
}
function step(title: string): void {
  console.log("");
  console.log(`── ${title} ${"─".repeat(Math.max(0, 52 - title.length))}`);
}

const SLOTS: Array<[string, string]> = [
  ["leadRu", CONNECT_PAGE.leadRu],
  ["formatRu", CONNECT_PAGE.formatRu],
  ["step1Ru", CONNECT_PAGE.step1Ru],
  ["step1DetailsRu", CONNECT_PAGE.step1DetailsRu],
  ["afterStepsRu", CONNECT_PAGE.afterStepsRu],
  ["troubleRu", CONNECT_PAGE.troubleRu],
  ["device-guide: подводка шага 2", STEP_LEAD_RU],
  ["device-guide: если часов нет", NO_WATCH_BODY_RU],
];

function main(): void {
  console.log("ТЕКСТ ИНСТРУКЦИИ");

  step("РАЗМЕТКА, КОТОРУЮ УМЕЕМ ПОКАЗАТЬ");
  for (const [name, text] of SLOTS) {
    const bad = findUnsupported(text);
    expect(bad.length === 0, `${name}: ${bad.length === 0 ? "разметка вся поддержана" : bad.join(" | ")}`);
  }

  step("ПОДКЛЮЧЕНИЕ И ПРАВИЛА НЕ ПЕРЕМЕШАНЫ");
  // Экран подключения показывает step1Ru и шаг 2. Если туда просочились
  // правила формата, человек снова читает про разборы в момент, когда у него
  // ещё нет плана.
  expect(
    !CONNECT_PAGE.step1Ru.includes("## Что входит") &&
      !CONNECT_PAGE.step1Ru.includes("## Правила"),
    "в шаге 1 нет правил формата"
  );
  expect(
    CONNECT_PAGE.formatRu.includes("## Что входит") &&
      CONNECT_PAGE.formatRu.includes("## Правила"),
    "правила формата лежат в своём слоте"
  );
  expect(!CONNECT_PAGE.formatRu.includes("## Шаг"), "в правилах формата нет шагов подключения");
  expect(CONNECT_PAGE.step1Ru.startsWith("## Шаг 1."), "шаг 1 начинается со своего заголовка");
  expect(CONNECT_PAGE.step1DetailsTitleRu.length > 0, "у свёрнутого подраздела есть заголовок");

  step("ИСТОЧНИК ТЕКСТА ОДИН");
  const surfaces: Array<[string, string]> = [
    ["страница сайта", "src/app/connect/page.tsx"],
    ["мини-приложение", "src/app/m/run/page.tsx"],
  ];
  for (const [label, path] of surfaces) {
    const code = readFileSync(path, "utf8");
    expect(
      code.includes('from "@/features/intervals/connect-content"'),
      `${label} берёт текст из общего файла`
    );
  }
  const app = readFileSync("src/app/m/run/page.tsx", "utf8");
  expect(
    !app.includes("igorp.run/connect"),
    "приложение больше не отправляет человека на сайт за инструкцией"
  );

  step("APPLE WATCH");
  const apple = DEVICE_GUIDES.find((guide) => guide.code === "apple");
  expect(apple !== undefined && apple.bridgeRu.length > 0, "карточка на месте и не пуста");

  console.log("");
  if (failures === 0) {
    console.log("ВСЁ ПРОШЛО. Провалов: 0.");
    process.exit(0);
  }
  console.log(`ПРОВАЛОВ: ${failures}.`);
  process.exit(1);
}

main();
