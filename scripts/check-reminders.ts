/**
 * Правило напоминаний: когда шлём, когда молчим.
 *
 * ПРОВЕРЯЕМ ИМЕННО РЕШЕНИЕ, а не отправку. Отправка это телеграм и живые люди,
 * её нельзя гонять в проверке; а вот «в какой час», «при каких условиях» и
 * «сколько раз» — чистая логика, и ошибка в ней стоит дорого: лишнее
 * напоминание человеку, который уже отметился, читается как «меня не слышат».
 */

import {
  decideReminder,
  EVENING_WINDOW,
  MORNING_WINDOW,
  type ReminderInput,
} from "@/features/intervals/loop/reminders";

let failures = 0;
function expect(condition: boolean, message: string): void {
  console.log(`  ${condition ? "✓" : "✗"} ${message}`);
  if (!condition) failures += 1;
}
function step(title: string): void {
  console.log("");
  console.log(`── ${title} ${"─".repeat(Math.max(0, 52 - title.length))}`);
}

const base: ReminderInput = {
  localHour: 8,
  todaySession: { title: "Бег/шаг · ступень 1", minutes: 30 },
  hasCheckinToday: false,
  hasActivityToday: false,
  alreadySentKinds: [],
  hasPublishedPlan: true,
};
const at = (patch: Partial<ReminderInput>) => decideReminder({ ...base, ...patch });

function main(): void {
  console.log("ПРАВИЛО НАПОМИНАНИЙ");
  console.log(`утро ${MORNING_WINDOW.fromHour}–${MORNING_WINDOW.toHour}, вечер ${EVENING_WINDOW.fromHour}–${EVENING_WINDOW.toHour} по зоне ученицы`);

  step("УТРО: ЧТО СЕГОДНЯ");
  const morning = at({ localHour: 8 });
  expect(morning.send && morning.kind === "today_session", "в утреннем окне уходит напоминание о тренировке");
  expect(
    morning.send && morning.textRu.includes("30 минут") && morning.textRu.includes("перенести"),
    "в тексте названа тренировка и сказано про перенос"
  );
  expect(at({ localHour: 6 }).send === false, "в 6 утра молчим: рано");
  expect(at({ localHour: 12 }).send === false, "днём молчим: окно прошло");
  expect(at({ localHour: 8, todaySession: null }).send === false, "в день отдыха утром молчим");

  step("ВЕЧЕР: ОТМЕТИТЬСЯ");
  const evening = at({ localHour: 20 });
  expect(evening.send && evening.kind === "checkin_nudge", "в вечернем окне уходит напоминание отметиться");
  const afterRun = at({ localHour: 20, hasActivityToday: true });
  expect(
    afterRun.send && afterRun.textRu.includes("Вижу, что вы сегодня бегали"),
    "если тренировка приехала из Intervals, текст другой: мы знаем, что она бегала"
  );
  const noPlanNoRun = at({ localHour: 20, todaySession: null, hasActivityToday: false });
  expect(noPlanNoRun.send === false, "вечером без тренировки и без пробежки молчим");

  step("ЧЕГО НЕ ДЕЛАЕМ НИКОГДА");
  expect(at({ hasCheckinToday: true }).send === false, "отметилась — утром не трогаем");
  expect(
    at({ localHour: 20, hasCheckinToday: true, hasActivityToday: true }).send === false,
    "отметилась — вечером тем более не трогаем"
  );
  expect(at({ hasPublishedPlan: false }).send === false, "плана нет — напоминать не о чем");
  expect(
    at({ localHour: 8, alreadySentKinds: ["today_session"] }).send === false,
    "утреннее уже уходило сегодня — второй раз нет"
  );
  expect(
    at({ localHour: 20, alreadySentKinds: ["checkin_nudge"] }).send === false,
    "вечернее уже уходило сегодня — второй раз нет"
  );
  // Утреннее ушло, вечернее нет: это РАЗНЫЕ напоминания, и второе имеет право уйти.
  expect(
    at({ localHour: 20, alreadySentKinds: ["today_session"] }).send === true,
    "утреннее не запирает вечернее: они про разное"
  );

  step("ОКНО ПЕРЕЖИВАЕТ ПРОПУЩЕННЫЙ ЗАПУСК");
  // Раннер ходит раз в полчаса; окно в два часа означает четыре попытки, и
  // достаточно одной. Точное время означало бы «не пришло, если машина спала».
  const morningHits = [7, 8, 9].filter((hour) => at({ localHour: hour }).send);
  expect(morningHits.length === 3, `в утреннее окно попадает ${morningHits.length} часа из трёх`);

  console.log("");
  if (failures === 0) {
    console.log("ВСЁ ПРОШЛО. Провалов: 0.");
    process.exit(0);
  }
  console.log(`ПРОВАЛОВ: ${failures}.`);
  process.exit(1);
}

main();
