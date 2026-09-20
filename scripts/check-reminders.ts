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
  MISSED_STREAK_SILENCE,
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
  missedStreak: 0,
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

  step("ВЕЧЕР: ДВА РАЗНЫХ РАЗГОВОРА");
  // Тренировка была — спрашиваем, как прошла.
  const afterRun = at({ localHour: 20, hasActivityToday: true });
  expect(afterRun.send && afterRun.kind === "checkin_nudge", "после состоявшейся тренировки просим отметиться");
  expect(
    afterRun.send && afterRun.textRu.includes("Вижу, что вы сегодня бегали"),
    "текст опирается на факт: мы знаем, что она бегала"
  );

  // Тренировки не было — разговор про человека, а не про отметку.
  const missed = at({ localHour: 20, hasActivityToday: false });
  expect(missed.send && missed.kind === "missed_nudge", "пропущенная тренировка получает свой вид напоминания");
  expect(
    missed.send && missed.textRu.includes("всё в порядке"),
    "спрашиваем, всё ли в порядке, а не требуем отметиться"
  );
  expect(
    missed.send && !missed.textRu.includes("Отметьтесь"),
    "не просим отметиться о том, чего не было"
  );
  expect(
    missed.send && missed.textRu.includes("догонять не нужно"),
    "без упрёка: догонять не нужно"
  );

  const noPlanNoRun = at({ localHour: 20, todaySession: null, hasActivityToday: false });
  expect(noPlanNoRun.send === false, "вечером без тренировки и без пробежки молчим");

  step("НЕСКОЛЬКО ПРОПУСКОВ ПОДРЯД: БОТ ЗАМОЛКАЕТ");
  expect(
    at({ localHour: 20, hasActivityToday: false, missedStreak: 1 }).send === true,
    "после первого пропуска ещё спрашиваем: бытовая случайность"
  );
  const longSilence = at({ localHour: 20, hasActivityToday: false, missedStreak: MISSED_STREAK_SILENCE });
  expect(longSilence.send === false, `после ${MISSED_STREAK_SILENCE} пропусков подряд бот молчит`);
  expect(
    longSilence.send === false && longSilence.reason.includes("к тренеру"),
    "и причина названа: дальше должен спросить человек, а не программа"
  );

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
    at({ localHour: 20, hasActivityToday: true, alreadySentKinds: ["checkin_nudge"] }).send === false,
    "вечернее уже уходило сегодня — второй раз нет"
  );
  expect(
    at({ localHour: 20, alreadySentKinds: ["missed_nudge"] }).send === false,
    "вопрос про пропуск тоже задаётся один раз в день"
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

  step("НЕДЕЛЬНАЯ ФОРМА");
  // Своё окно, 10–12: в 7–9 в воскресенье уже уходит «сегодня по плану», и две
  // просьбы в одно утро тонут обе.
  const sunday = (over: Record<string, unknown> = {}) =>
    decideReminder({
      localHour: 11,
      todaySession: { title: "Длительный аэробный", minutes: 30 },
      hasCheckinToday: false,
      hasActivityToday: false,
      alreadySentKinds: [],
      hasPublishedPlan: true,
      isSunday: true,
      hasCheckinThisWeek: true,
      hasWeeklyReportThisWeek: false,
      ...over,
    } as Parameters<typeof decideReminder>[0]);

  expect(sunday().send === true && sunday().kind === "weekly_form", "в воскресенье в окно форма уходит");
  expect(sunday({ localHour: 9 }).send !== true || sunday({ localHour: 9 }).kind !== "weekly_form",
    "в 9 утра форма не уходит: это окно тренировочного напоминания");
  expect(sunday({ isSunday: false }).kind !== "weekly_form", "в будни форма не уходит");
  expect(sunday({ hasWeeklyReportThisWeek: true }).send === false, "заполненную форму второй раз не просим");
  expect(sunday({ hasCheckinThisWeek: false }).send === false,
    "без единой отметки за неделю форму не шлём: это к тренеру, а не к боту");
  expect(sunday({ alreadySentKinds: ["weekly_form"] }).send === false, "один раз в сутки, как и остальные");

  // ГЛАВНОЕ: воскресная отметка о длительной НЕ отменяет форму. Она про одну
  // тренировку, форма — про неделю целиком.
  expect(sunday({ hasCheckinToday: true }).kind === "weekly_form",
    "отметка о сегодняшней тренировке не должна съедать недельную форму");

  console.log("");
  if (failures === 0) {
    console.log("ВСЁ ПРОШЛО. Провалов: 0.");
    process.exit(0);
  }
  console.log(`ПРОВАЛОВ: ${failures}.`);
  process.exit(1);
}

main();
