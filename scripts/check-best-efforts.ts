/**
 * Поиск лучшего отрезка: проверяем на рядах, которые построили сами.
 *
 * ПОЧЕМУ СИНТЕТИКА, А НЕ ЖИВАЯ ТРЕНИРОВКА. У живой неизвестен правильный ответ:
 * «5:14 за двадцать минут» может быть и верным, и следствием ошибки на единицу
 * в окне. Здесь быстрый кусок положен руками, и от поиска требуется найти
 * ИМЕННО ЕГО, с точностью до секунды начала.
 *
 * Эта же машинка будет доставать результат диагностического теста, поэтому
 * ошибка здесь стоит дороже, чем неудобный список в терминале.
 */

import { bestEfforts, paceText } from "@/features/intervals/best-efforts";

let failures = 0;
function expect(condition: boolean, message: string): void {
  console.log(`  ${condition ? "✓" : "✗"} ${message}`);
  if (!condition) failures += 1;
}
function step(title: string): void {
  console.log("");
  console.log(`── ${title} ${"─".repeat(Math.max(0, 52 - title.length))}`);
}

/** Ряд 1 Гц из кусков «сколько секунд с какой скоростью». */
function buildStream(parts: Array<{ seconds: number; mps: number }>): {
  time: number[];
  velocity: Array<number | null>;
} {
  const time: number[] = [];
  const velocity: Array<number | null> = [];
  let t = 0;
  for (const part of parts) {
    for (let i = 0; i < part.seconds; i += 1) {
      time.push(t);
      velocity.push(part.mps);
      t += 1;
    }
  }
  return { time, velocity };
}

function main(): void {
  console.log("ЛУЧШИЕ ОТРЕЗКИ");

  step("БЫСТРЫЙ КУСОК НАХОДИТСЯ ТАМ, ГДЕ ПОЛОЖЕН");
  // 30 минут по 3 м/с (5:33/км), 10 минут по 4 м/с (4:10/км), 20 минут по 3 м/с.
  const run = buildStream([
    { seconds: 30 * 60, mps: 3 },
    { seconds: 10 * 60, mps: 4 },
    { seconds: 20 * 60, mps: 3 },
  ]);
  const best = bestEfforts(run.time, run.velocity, [10 * 60, 30 * 60, 90 * 60]);

  const ten = best.get(10 * 60);
  expect(ten !== null && ten !== undefined, "лучшие 10 минут найдены");
  if (ten) {
    expect(
      Math.abs(ten.paceSecPerKm - 250) <= 2,
      `темп лучших 10 минут ${paceText(ten.paceSecPerKm)}/км ≈ 4:10 (4 м/с)`
    );
    expect(
      Math.abs(ten.startOffsetS - 1800) <= 2,
      `начало найдено на 30-й минуте (смещение ${ten.startOffsetS} с)`
    );
  }

  const thirty = best.get(30 * 60);
  expect(thirty !== null && thirty !== undefined, "лучшие 30 минут найдены");
  if (thirty && ten) {
    expect(
      thirty.paceSecPerKm > ten.paceSecPerKm,
      "тридцать минут медленнее десяти: быстрый кусок разбавлен — так и должно быть"
    );
  }

  expect(best.get(90 * 60) === null, "длительность больше тренировки даёт null, а не ноль");

  step("ПАУЗА НЕ ПОПАДАЕТ В ЛУЧШЕЕ ОКНО");
  // Быстрый кусок с дырой посередине и такой же быстрый целый следом.
  const withPause = buildStream([
    { seconds: 5 * 60, mps: 4 },
    { seconds: 3 * 60, mps: 0 },
    { seconds: 5 * 60, mps: 4 },
    { seconds: 5 * 60, mps: 3 },
    { seconds: 10 * 60, mps: 4 },
  ]);
  const paused = bestEfforts(withPause.time, withPause.velocity, [10 * 60]);
  const tenPaused = paused.get(10 * 60);
  expect(tenPaused !== null && tenPaused !== undefined, "окно найдено");
  if (tenPaused) {
    expect(
      Math.abs(tenPaused.paceSecPerKm - 250) <= 2,
      `выбран кусок без паузы: ${paceText(tenPaused.paceSecPerKm)}/км`
    );
    // Допуск в пару секунд: ряд дискретный, и окно ровно в 600 секунд
    // начинается на отсчёте 1079, а не 1080. Это свойство данных, не ошибка.
    expect(
      tenPaused.startOffsetS >= 18 * 60 - 2,
      `и это последний, целый кусок, а не первый с дырой (смещение ${tenPaused.startOffsetS} с)`
    );
  }

  step("КРАЙНИЕ СЛУЧАИ");
  const empty = bestEfforts([], [], [10 * 60]);
  expect(empty.get(10 * 60) === null, "пустой ряд не роняет счёт");
  const single = bestEfforts([0], [3], [60]);
  expect(single.get(60) === null, "ряд из одной точки — тоже null");
  const standing = buildStream([{ seconds: 20 * 60, mps: 0 }]);
  expect(
    bestEfforts(standing.time, standing.velocity, [10 * 60]).get(10 * 60) === null,
    "стоял на месте — темпа нет, а не бесконечность"
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
