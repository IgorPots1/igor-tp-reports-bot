/**
 * Диагностический тест: задание человеку и разбор результата.
 *
 * ПОЧЕМУ СИНТЕТИКА. У живой тренировки неизвестен правильный ответ: «4:42 за
 * двадцать минут» может быть и верным числом, и следствием ошибки на минуту в
 * окне. Здесь ряд построен руками, и от разбора требуется вернуть ИМЕННО то,
 * что положено, с точностью до пары секунд.
 *
 * Границы ровности калибровались на живых рядах (замер по 80 записям, числа и
 * выводы записаны в самом модуле). Тут проверяется, что правило применяется как
 * задумано, а не что оно правильно выбрано.
 */

import {
  buildTestPlan,
  evaluateTest,
  pickTestRecord,
  testPaceText,
  DIAGNOSTIC_TEST_PRESET,
  type DayRecord,
} from "@/features/intervals/diagnostic-test";
import { pendingTestDate, signalLabelsRu, signalWeight } from "@/features/intervals/loop/coach-view";

let failures = 0;
function expect(condition: boolean, message: string): void {
  console.log(`  ${condition ? "✓" : "✗"} ${message}`);
  if (!condition) failures += 1;
}
function step(title: string): void {
  console.log("");
  console.log(`── ${title} ${"─".repeat(Math.max(0, 52 - title.length))}`);
}

/** Ряд 1 Гц из кусков «сколько минут в каком темпе (с/км)». */
function stream(parts: Array<{ minutes: number; paceSec: number | "стоп" }>): {
  timeS: number[];
  velocity: Array<number | null>;
} {
  const timeS: number[] = [];
  const velocity: Array<number | null> = [];
  let t = 0;
  for (const part of parts) {
    const mps = part.paceSec === "стоп" ? 0 : 1000 / part.paceSec;
    for (let i = 0; i < part.minutes * 60; i += 1) {
      timeS.push(t);
      velocity.push(mps);
      t += 1;
    }
  }
  return { timeS, velocity };
}

/** Ряд с «живой» рябью: темп гуляет вокруг среднего на ±amplitude секунд. */
function wobbly(minutes: number, paceSec: number, amplitudeSec: number) {
  const timeS: number[] = [];
  const velocity: Array<number | null> = [];
  for (let s = 0; s < minutes * 60; s += 1) {
    const minute = Math.floor(s / 60);
    const pace = paceSec + amplitudeSec * (minute % 2 === 0 ? 1 : -1);
    timeS.push(s);
    velocity.push(1000 / pace);
  }
  return { timeS, velocity };
}

function main(): void {
  console.log("ДИАГНОСТИЧЕСКИЙ ТЕСТ");

  /* ───────────────────────── ЗАДАНИЕ ЧЕЛОВЕКУ ───────────────────────── */

  step("ТЕКСТ ЗАДАНИЯ");
  const plan = buildTestPlan(365, 395); // лёгкий 6:05…6:35
  expect(plan.minutes === 60, `тренировка на час (${plan.minutes} мин)`);
  expect(
    plan.segments.reduce((s, x) => s + x.minutes, 0) === 60,
    "сумма шагов совпадает с длительностью"
  );

  // ПЕРВЫМ ДЕЛОМ И ЗАМЕТНО: тест пишется отдельной записью.
  const firstLine = plan.description.split("\n")[0];
  expect(
    firstLine.includes("ВАЖНО ПРО ЗАПИСЬ"),
    `про запись сказано первой строкой: «${firstLine}»`
  );
  expect(
    plan.description.includes("Остановите запись после разминки и начните новую на тест"),
    "инструкция про остановку записи дословно на месте"
  );

  // ТИРЕ В ТЕКСТАХ ДЛЯ ЧЕЛОВЕКА НЕ ИСПОЛЬЗУЕМ.
  const dashes = [...plan.description].filter((ch) => ch === "—" || ch === "–").length;
  expect(dashes === 0, `тире в задании нет (найдено ${dashes})`);
  expect(!/\bты\b|\bтебе\b|\bтвой/iu.test(plan.description), "обращение на «вы», без «ты»");

  // ТЕМПЫ ОТ ЯКОРЯ, А НЕ ЗАШИТЫЕ ЧИСЛА.
  expect(plan.description.includes("6:05") && plan.description.includes("6:35"), "лёгкий взят из якоря");
  const brisk = plan.briskSec;
  expect(
    Math.abs((plan.easyFastSec + plan.easySlowSec) / 2 - brisk - 40) <= 5,
    `второй шаг на ~40 с быстрее лёгкого: ${testPaceText(brisk)} против середины ${testPaceText((plan.easyFastSec + plan.easySlowSec) / 2)}`
  );
  const other = buildTestPlan(300, 320); // другой человек, лёгкий 5:00…5:20
  expect(
    other.briskSec !== plan.briskSec && other.description.includes("5:00"),
    "у другого якоря числа другие: задание не зашито"
  );
  expect(
    plan.description.includes("Не разгоняйтесь в первые пять минут"),
    "предупреждение про разгон на месте"
  );
  expect(
    plan.description.includes("Тест не обязателен"),
    "сказано, что тест можно не делать"
  );
  expect(DIAGNOSTIC_TEST_PRESET === "diagnostic_test_30", "код теста один на всю систему");
  // Поймано живым прогоном: 359,7 с печатались как «5:60».
  expect(testPaceText(359.7) === "6:00", `темп на границе минуты: ${testPaceText(359.7)}`);
  expect(testPaceText(359.4) === "5:59", `и с другой стороны границы: ${testPaceText(359.4)}`);

  /* ───────────────────────── РАЗБОР ───────────────────────── */

  step("РОВНЫЙ ТЕСТ: СЧИТАЕМ ПОСЛЕДНИЕ 20 МИНУТ, А НЕ ВСЕ 30");
  // Разогналась: первые 10 по 4:00, последние 20 по 4:30. Средняя по тридцати
  // дала бы 4:20 и завысила порог; протокол требует 4:30.
  const split = stream([
    { minutes: 10, paceSec: 240 },
    { minutes: 20, paceSec: 270 },
  ]);
  const splitResult = evaluateTest({ timeS: split.timeS, velocity: split.velocity, easyPaceSec: 360 });
  expect(splitResult.metrics !== null, "разбор состоялся");
  if (splitResult.metrics) {
    expect(
      Math.abs(splitResult.metrics.thresholdSecPerKm - 270) <= 2,
      `порог ${testPaceText(splitResult.metrics.thresholdSecPerKm)} это последние 20 минут, а не средняя 4:20`
    );
    expect(splitResult.verdict === "ровно", `вердикт «${splitResult.verdict}»: зачётные минуты ровные`);
    expect(
      Math.abs(splitResult.windowStartOffsetS - 600) <= 2,
      `окно начинается на 10-й минуте записи (${splitResult.windowStartOffsetS} с)`
    );
  }

  step("ЖИВОЙ БЕГ С РЯБЬЮ ПРОХОДИТ");
  // ±8 секунд вокруг 4:30 это обычная рябь парка: рельеф, развороты, ветер.
  const alive = wobbly(30, 270, 8);
  const aliveResult = evaluateTest({ timeS: alive.timeS, velocity: alive.velocity, easyPaceSec: 360 });
  expect(
    aliveResult.verdict === "ровно",
    `вердикт «${aliveResult.verdict}», разброс ${aliveResult.metrics?.cvPct.toFixed(1)} %`
  );

  step("РАЗВАЛИЛАСЬ: ЛОВИМ ПРОСАДКОЙ, НЕ РАЗБРОСОМ");
  // Ровно, но с уходом: 4:15 → 5:05 внутри зачётных минут.
  const fading = stream([
    { minutes: 10, paceSec: 250 },
    { minutes: 10, paceSec: 255 },
    { minutes: 5, paceSec: 285 },
    { minutes: 5, paceSec: 305 },
  ]);
  const fadeResult = evaluateTest({ timeS: fading.timeS, velocity: fading.velocity, easyPaceSec: 360 });
  expect(
    fadeResult.verdict !== "ровно",
    `вердикт «${fadeResult.verdict}»: просадка ${fadeResult.metrics?.fadePct.toFixed(1)} %`
  );
  expect(
    (fadeResult.metrics?.fadePct ?? 0) > 8,
    "именно просадка, а не разброс, подняла тревогу"
  );
  expect(
    fadeResult.reasons.some((r) => r.includes("слишком быстрое начало")),
    "причина названа человеческими словами"
  );

  step("ИНТЕРВАЛЫ ВМЕСТО ТЕСТА");
  const intervals = stream(
    Array.from({ length: 30 }, (_, i) => ({ minutes: 1, paceSec: i % 2 === 0 ? 230 : 380 }))
  );
  const intervalResult = evaluateTest({
    timeS: intervals.timeS,
    velocity: intervals.velocity,
    easyPaceSec: 360,
  });
  expect(
    intervalResult.verdict === "невалидно",
    `вердикт «${intervalResult.verdict}», разброс ${intervalResult.metrics?.cvPct.toFixed(1)} %`
  );
  expect(
    (intervalResult.metrics?.cvPct ?? 0) > 8,
    "поймано разбросом: минута быстро, минута трусцой"
  );
  expect(
    Math.abs(intervalResult.metrics?.fadePct ?? 99) < 5,
    "просадки при этом почти нет: одним числом такой тест не поймать"
  );

  step("ПЕРЕШЛА НА ШАГ");
  const walked = stream([
    { minutes: 12, paceSec: 265 },
    { minutes: 2, paceSec: "стоп" },
    { minutes: 16, paceSec: 270 },
  ]);
  const walkResult = evaluateTest({ timeS: walked.timeS, velocity: walked.velocity, easyPaceSec: 360 });
  expect(walkResult.verdict === "невалидно", `вердикт «${walkResult.verdict}»`);
  expect(
    walkResult.reasons.some((r) => r.includes("остановки")),
    "остановки названы причиной"
  );

  step("«ТЕСТ» НА ЛЁГКОМ ТЕМПЕ НЕ ПИШЕТ ПОРОГ");
  const easyRun = wobbly(30, 358, 4);
  const easyResult = evaluateTest({ timeS: easyRun.timeS, velocity: easyRun.velocity, easyPaceSec: 360 });
  expect(easyResult.verdict === "невалидно", `вердикт «${easyResult.verdict}»`);
  expect(
    easyResult.reasons.some((r) => r.includes("лёгкую пробежку")),
    "сказано, что это похоже на лёгкий бег"
  );

  step("ЗАПИСЬ КОРОЧЕ ЗАЧЁТНОГО ОКНА");
  const short = wobbly(18, 270, 5);
  const shortResult = evaluateTest({ timeS: short.timeS, velocity: short.velocity });
  expect(shortResult.verdict === "невалидно" && shortResult.metrics === null, "короткая запись отклонена");
  expect(shortResult.reasons.some((r) => r.includes("не хватает")), "причина названа");

  step("ВСЁ ОДНОЙ ДЛИННОЙ ЗАПИСЬЮ: ЧИСЛО ДАЁМ, ДОВЕРИЕ ПОНИЖАЕМ");
  // Разминка 15 мин лёгкого, тест 30 мин по 4:30, заминка 10 мин лёгкого.
  const oneRecord = stream([
    { minutes: 15, paceSec: 370 },
    { minutes: 30, paceSec: 270 },
    { minutes: 10, paceSec: 380 },
  ]);
  const longResult = evaluateTest({
    timeS: oneRecord.timeS,
    velocity: oneRecord.velocity,
    fromLongRecord: true,
    easyPaceSec: 370,
  });
  expect(longResult.metrics !== null, "отрезок внутри длинной записи найден");
  if (longResult.metrics) {
    expect(
      Math.abs(longResult.metrics.thresholdSecPerKm - 270) <= 3,
      `темп ${testPaceText(longResult.metrics.thresholdSecPerKm)} это тест, а не средняя по часу`
    );
    expect(
      Math.abs(longResult.windowStartOffsetS - 25 * 60) <= 60,
      `окно встало на последние 20 минут теста (${Math.round(longResult.windowStartOffsetS / 60)}-я минута записи)`
    );
  }
  expect(
    longResult.verdict === "сомнительно",
    `вердикт «${longResult.verdict}»: ровный отрезок внутри длинной записи сам порог не пишет`
  );
  expect(
    longResult.reasons.some((r) => r.includes("не был записан отдельно")),
    "причина понижения доверия названа"
  );

  /* ───────────────────────── ВЫБОР ЗАПИСИ ───────────────────────── */

  step("КАКАЯ ИЗ ЗАПИСЕЙ ДНЯ ЭТО ТЕСТ");
  const day: DayRecord[] = [
    { activityId: "a1", name: "Разминка", movingTimeS: 15 * 60, paceSecPerKm: 370 },
    { activityId: "a2", name: "Тест", movingTimeS: 30 * 60, paceSecPerKm: 272 },
    { activityId: "a3", name: "Заминка", movingTimeS: 10 * 60, paceSecPerKm: 385 },
  ];
  const picked = pickTestRecord(day);
  expect(picked.record?.activityId === "a2", `выбрана запись теста (${picked.record?.name})`);
  expect(!picked.fromLongRecord, "отдельная запись, доверие полное");

  const twoLong: DayRecord[] = [
    { activityId: "b1", name: "Длинная разминка", movingTimeS: 28 * 60, paceSecPerKm: 372 },
    { activityId: "b2", name: "Тест", movingTimeS: 31 * 60, paceSecPerKm: 268 },
  ];
  expect(
    pickTestRecord(twoLong).record?.activityId === "b2",
    "из двух подходящих по длине берётся самая быстрая"
  );

  const single: DayRecord[] = [
    { activityId: "c1", name: "Бег", movingTimeS: 58 * 60, paceSecPerKm: 330 },
  ];
  const singlePick = pickTestRecord(single);
  expect(
    singlePick.record?.activityId === "c1" && singlePick.fromLongRecord,
    "одна длинная запись берётся, но помечается"
  );
  expect(singlePick.note.includes("всё подряд"), "и это сказано словами");

  const nothing = pickTestRecord([
    { activityId: "d1", name: "Трусца", movingTimeS: 12 * 60, paceSecPerKm: 380 },
  ]);
  expect(nothing.record === null, "короткая пробежка за тест не выдаётся");

  /* ───────────────────────── СИГНАЛ ТРЕНЕРУ ───────────────────────── */

  step("ТЕСТ ПОПАДАЕТСЯ ТРЕНЕРУ НА ГЛАЗА САМ");
  expect(
    pendingTestDate("2026-10-02", null, "2026-10-03") === "2026-10-02",
    "тест прошёл, порога нет: сигнал есть"
  );
  expect(
    pendingTestDate("2026-10-02", 265, "2026-10-03") === null,
    "порог поставлен: сигнал снят"
  );
  expect(
    pendingTestDate("2026-10-02", null, "2026-10-01") === null,
    "тест ещё впереди: сигнала нет"
  );
  expect(
    pendingTestDate("2026-10-02", null, "2026-10-30") === null,
    "через две недели сигнал уходит сам, чтобы не стать вечным красным"
  );
  expect(pendingTestDate(null, null, "2026-10-03") === null, "теста в плане не было: сигнала нет");

  const base = {
    unansweredCheckins: 0,
    missedCheckinDates: [],
    missedPlannedDates: [],
    connection: "ok" as const,
    planWaitingPublish: false,
    noPlan: false,
  };
  expect(
    signalLabelsRu({ ...base, testWaitingReview: "2026-10-02" }).some((l) => l.includes("разобрать тест")),
    "в списке учеников это написано словами"
  );
  expect(
    signalWeight({ ...base, testWaitingReview: "2026-10-02" }) >
      signalWeight({ ...base, testWaitingReview: null, unansweredCheckins: 2 }),
    "неразобранный тест поднимает ученика выше пары неотвеченных отметок"
  );
  expect(
    signalWeight({ ...base, testWaitingReview: "2026-10-02" }) <
      signalWeight({ ...base, testWaitingReview: null, connection: "auth_revoked" }),
    "но ниже оборванной связи: без данных разбирать нечего"
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
