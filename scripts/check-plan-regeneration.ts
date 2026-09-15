/**
 * Перегенерация плана после появления порога: границы и числа.
 *
 * ТРИ ВЕЩИ, КАЖДАЯ ЛОМАЕТСЯ МОЛЧА:
 *   1. Граница «с какой недели можно переписывать». Ошибка на день означает,
 *      что человеку переписали пятницу, о которой он уже знал.
 *   2. Полоса ОСНОВНОЙ части. Если взять первый сегмент, разница покажет темп
 *      разминки, и тренер решит, что порог ничего не изменил.
 *   3. Разбор старого описания. Планы, выданные до появления колонок, хранят
 *      числа только в тексте, и без разбора разница соврёт «цели нет».
 */

import {
  nextMonday,
  parseTargetFromDescription,
  workBand,
} from "../tools/trainingpeaks-export/scripts/lib/intervals-session-target.ts";

let failures = 0;
function expect(condition: boolean, message: string): void {
  console.log(`  ${condition ? "✓" : "✗"} ${message}`);
  if (!condition) failures += 1;
}
function step(title: string): void {
  console.log("");
  console.log(`── ${title} ${"─".repeat(Math.max(0, 52 - title.length))}`);
}

function main(): void {
  console.log("ПЕРЕГЕНЕРАЦИЯ ПЛАНА");

  step("ТЕКУЩУЮ НЕДЕЛЮ НЕ ТРОГАЕМ");
  // 2026-09-15 это вторник. Переписывать можно с понедельника 21-го.
  expect(nextMonday("2026-09-15") === "2026-09-21", `вторник → ${nextMonday("2026-09-15")}`);
  expect(nextMonday("2026-09-21") === "2026-09-28", `сам понедельник → ${nextMonday("2026-09-21")}`);
  expect(nextMonday("2026-09-20") === "2026-09-21", `воскресенье → ${nextMonday("2026-09-20")}`);
  expect(nextMonday("2026-12-31") === "2027-01-04", `через новый год → ${nextMonday("2026-12-31")}`);

  step("ПОЛОСА ОСНОВНОЙ ЧАСТИ, А НЕ РАЗМИНКИ");
  // Качественная сессия: разминка, работа, заминка.
  const quality = [
    { fastSec: 329, slowSec: 359 },
    { fastSec: 283, slowSec: 312 },
    { fastSec: 329, slowSec: 359 },
  ];
  const band = workBand(quality);
  expect(band.fastSec === 283 && band.slowSec === 312, `взята работа: ${band.fastSec}–${band.slowSec}`);

  const easy = [{ fastSec: 329, slowSec: 359 }];
  expect(workBand(easy).fastSec === 329, "у лёгкой сессии полоса одна, её и берём");

  const noPace = [
    { fastSec: null, slowSec: null },
    { fastSec: null, slowSec: null },
  ];
  expect(workBand(noPace).fastSec === null, "сессия без темпов даёт пусто, а не ноль");

  const mixed = [
    { fastSec: 329, slowSec: 359 },
    { fastSec: null, slowSec: null },
  ];
  expect(workBand(mixed).fastSec === 329, "сегмент без темпа не мешает найти тот, где темп есть");

  step("ЧИСЛА ИЗ СТАРОГО ОПИСАНИЯ");
  const oldQuality =
    "Разминка, спокойно (Zone 2): 15 минут 5:29–5:59. " +
    "Основная часть: 20 минут 4:43–5:12. " +
    "Заминка, свободно (Zone 2): 10 минут 5:29–5:59.";
  const parsed = parseTargetFromDescription(oldQuality);
  expect(
    parsed.fastSec === 283 && parsed.slowSec === 312,
    `из текста взята работа, а не разминка: ${parsed.fastSec}–${parsed.slowSec}`
  );

  const byEffort =
    "Разминка, спокойно (Zone 2): 15 минут 5:29–5:59. " +
    "Основная часть: 20 минут усилие 6 из 10, дышать заметно чаще. " +
    "Заминка, свободно (Zone 2): 10 минут 5:29–5:59.";
  const effort = parseTargetFromDescription(byEffort);
  expect(effort.rpe === 6, `усилие прочитано: ${effort.rpe}`);
  expect(
    effort.fastSec === 329,
    "и полоса разминки тоже прочитана: она единственная числовая в этой сессии"
  );

  expect(parseTargetFromDescription("").fastSec === null, "пустое описание не роняет разбор");
  expect(
    parseTargetFromDescription("Лёгкий бег: 50 минут 5:29–5:59.").fastSec === 329,
    "простая лёгкая читается"
  );
  expect(
    parseTargetFromDescription("Основная часть: 20 минут усилие 6.5 из 10.").rpe === 6.5,
    "дробное усилие тоже читается"
  );

  console.log("");
  if (failures === 0) {
    console.log("ВСЁ ПРОШЛО. Провалов: 0.");
    process.exit(0);
  }
  console.log(`ПРОВАЛОВ: ${failures}.`);
  process.exit(1);
}

main();
