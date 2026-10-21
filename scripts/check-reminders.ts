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
  releasedSessionsOnly,
  EVENING_WINDOW,
  MISSED_STREAK_SILENCE,
  MORNING_WINDOW,
  type ReminderInput,
} from "@/features/intervals/loop/reminders";
import { reminderForPage } from "@/features/intervals/plan-page/core";

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

  /* ── ВОПРОС ПРО ПРОПУСК УЕХАЛ НА СЛЕДУЮЩИЙ ПОЛДЕНЬ [наряд Игоря, 11.10.2026]
   *
   * ПОЧЕМУ ЭТИ УТВЕРЖДЕНИЯ ПЕРЕПИСАНЫ. Прежде вопрос задавался в тот же вечер,
   * и проверка это стерегла. Но ученица вводит пробежки на СЛЕДУЮЩЕЕ УТРО:
   * вечером система не отличает «не бегал» от «бегал и не записал», и посылала
   * «её не видно» в день, когда она бегала. Сообщение, обвиняющее человека в
   * том, чего он не делал, дороже любого пропущенного напоминания.
   *
   * Теперь проверка держит СИЛЬНЕЕ: вечером про пропуск не говорим ВООБЩЕ. */
  const eveningMissed = at({ localHour: 20, hasActivityToday: false });
  expect(
    eveningMissed.send === false,
    "вечером про пропуск НЕ спрашиваем: пробежка могла быть и ещё не записана"
  );

  // А на следующий полдень — спрашиваем, если вчерашний день так и не закрыт.
  const nextDay = at({
    localHour: 13,
    todaySession: null,
    yesterdaySession: { title: "Лёгкий бег", minutes: 40 },
    yesterdayClosed: false,
  });
  expect(nextDay.send && nextDay.kind === "missed_nudge", "на следующий полдень вопрос задаётся");
  expect(
    nextDay.send && nextDay.textRu.includes("Вчера по плану"),
    "и текст говорит про ВЧЕРА, а не про сегодня"
  );
  expect(
    nextDay.send && nextDay.textRu.includes("всё в порядке"),
    "спрашиваем, всё ли в порядке, а не требуем отметиться"
  );
  expect(
    nextDay.send && !nextDay.textRu.includes("Отметьтесь"),
    "не просим отметиться о том, чего не было"
  );
  expect(
    nextDay.send && nextDay.textRu.includes("догонять не нужно"),
    "без упрёка: догонять не нужно"
  );
  expect(
    nextDay.send && nextDay.textRu.includes("не успели записать"),
    "и прямо названа самая частая причина: бегала, но не записала"
  );

  /* ГЛАВНОЕ УТВЕРЖДЕНИЕ НАРЯДА: записала утром — вопроса не будет вовсе. */
  expect(
    at({
      localHour: 13,
      todaySession: null,
      yesterdaySession: { title: "Лёгкий бег", minutes: 40 },
      yesterdayClosed: true,
    }).send === false,
    "вчерашний день закрыт к полудню — молчим, это её обычный способ отмечаться"
  );
  expect(
    at({ localHour: 13, todaySession: null, yesterdaySession: null, yesterdayClosed: false }).send === false,
    "вчера плана не было — спрашивать не о чем"
  );
  // Вне окна полудня вопрос не задаётся: одно правило, одно окно.
  expect(
    at({ localHour: 16, todaySession: null, yesterdaySession: { title: "Лёгкий бег", minutes: 40 }, yesterdayClosed: false }).send === false,
    "после окна полудня уже не спрашиваем: два окна дали бы два сообщения об одном дне"
  );

  const noPlanNoRun = at({ localHour: 20, todaySession: null, hasActivityToday: false });
  expect(noPlanNoRun.send === false, "вечером без тренировки и без пробежки молчим");

  step("НЕСКОЛЬКО ПРОПУСКОВ ПОДРЯД: БОТ ЗАМОЛКАЕТ");
  const streakArgs = {
    localHour: 13,
    todaySession: null,
    yesterdaySession: { title: "Лёгкий бег", minutes: 40 },
    yesterdayClosed: false,
  };
  expect(
    at({ ...streakArgs, missedStreak: 1 }).send === true,
    "после первого пропуска ещё спрашиваем: бытовая случайность"
  );
  const longSilence = at({ ...streakArgs, missedStreak: MISSED_STREAK_SILENCE });
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
    at({
      localHour: 13,
      todaySession: null,
      yesterdaySession: { title: "Лёгкий бег", minutes: 40 },
      yesterdayClosed: false,
      alreadySentKinds: ["missed_nudge"],
    }).send === false,
    "вопрос про пропуск тоже задаётся один раз в день"
  );
  // Утреннее ушло, вечернее нет: это РАЗНЫЕ напоминания, и второе имеет право уйти.
  expect(
    at({ localHour: 20, hasActivityToday: true, alreadySentKinds: ["today_session"] }).send === true,
    "утреннее не запирает вечернее: они про разное"
  );

  step("НАПОМИНАЕМ ТОЛЬКО ПРО ОТДАННЫЕ НЕДЕЛИ");
  /* ЭТОГО УТВЕРЖДЕНИЯ НЕ БЫЛО, И В ЭТОМ БЫЛА ДЫРА [наряд Игоря, 12.10.2026].
   *
   * Чек напоминаний проверял только решатель, которому сессию передают уже
   * ГОТОВОЙ. Выбор сессии жил в раннере и не был покрыт ничем — поэтому там
   * спокойно стояло «бери всё из опубликованного цикла», хотя единица отдачи
   * это НЕДЕЛЯ. Неделя 12.10 была собрана и не отдана, ученица её не видела, а
   * раннер 14 октября объявил бы ей тренировку из неё. */
  const plan = [
    { weekStart: "2026-10-05", sessionDate: "2026-10-08", title: "6 x 5" },
    { weekStart: "2026-10-05", sessionDate: "2026-10-10", title: "Лёгкий" },
    { weekStart: "2026-10-12", sessionDate: "2026-10-14", title: "6 x 4" },
    { weekStart: "2026-10-12", sessionDate: "2026-10-16", title: "Лёгкий" },
  ];
  const onlyFirstReleased = releasedSessionsOnly(plan, new Set(["2026-10-05"]));
  expect(
    onlyFirstReleased.length === 2 && onlyFirstReleased.every((s) => s.weekStart === "2026-10-05"),
    `из цикла берутся только тренировки отданных недель: ${onlyFirstReleased.length} из ${plan.length}`
  );
  expect(
    releasedSessionsOnly(plan, new Set(["2026-10-05"])).every((s) => s.sessionDate !== "2026-10-14"),
    "тренировка неотданной недели в напоминания НЕ попадает"
  );
  // НЕДЕЛЯ БЕЗ СТРОКИ СОСТОЯНИЯ = НЕ ОТДАНА. Строгая сторона выбрана осознанно:
  // забытая строка даёт молчание, которое тренер заметит, а обратная ошибка
  // молча пишет человеку про план, которого он не видит.
  expect(
    releasedSessionsOnly(plan, new Set<string>()).length === 0,
    "ни одной отданной недели — не напоминаем вообще, а не напоминаем про всё"
  );
  expect(
    releasedSessionsOnly(plan, new Set(["2026-10-05", "2026-10-12"])).length === 4,
    "обе недели отданы — берём обе"
  );
  // Отбор НЕ ЗАВИСИТ от порядка и не теряет день, попавший в обе выборки.
  expect(
    releasedSessionsOnly([...plan].reverse(), new Set(["2026-10-12"])).length === 2,
    "порядок входа на отбор не влияет"
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

  step("УЧЕНИЦА НА СТРАНИЦЕ ПЛАНА");
  // БЫЛО [до 21.10.2026]: утверждения выше — форма уходит в воскресенье, текст
  // зовёт перенести «прямо в приложении» — держали ВСЕХ. ОТМЕНЕНО для учениц со
  // ссылкой на страницу плана: мини-апп у них показывает «План переехал», а
  // недельной формы на странице нет [решение Игоря, 21.10.2026: её заменяет
  // «Написать тренеру»]. Для мини-аппа всё выше осталось как было. Здесь —
  // строже, чем «в этот раз не ушла»: форма не уходит НИ В ОДНОМ окне, слова
  // «приложени» нет НИ В ОДНОМ тексте, и у каждого напоминания кнопка ведёт на
  // КАРТОЧКУ той тренировки, о которой речь.
  const viaPage = (d: ReturnType<typeof decideReminder>) =>
    d.send ? reminderForPage({ kind: d.kind, textRu: d.textRu, todaySessionId: "today-id", yesterdaySessionId: "yesterday-id" }) : null;
  for (const hour of [8, 10, 11, 12, 13, 20]) {
    const d = sunday({ localHour: hour });
    const p = viaPage(d);
    expect(!d.send || d.kind !== "weekly_form" || (p !== null && p.send === false),
      `в воскресенье в ${hour}:00 недельная форма ей не уходит`);
  }
  const pageMorning = viaPage(at({ localHour: 8 }));
  expect(pageMorning !== null && pageMorning.send && !/приложени/iu.test(pageMorning.textRu) && pageMorning.textRu.includes("перенести"),
    "утром у страницы про перенос сказано, без «приложения»");
  expect(pageMorning !== null && pageMorning.send && pageMorning.target.kind === "session" && pageMorning.target.sessionId === "today-id",
    "утреннее ведёт на карточку сегодняшней тренировки");
  const pageEvening = viaPage(at({ localHour: 20, hasActivityToday: true }));
  expect(pageEvening !== null && pageEvening.send && !/приложени/iu.test(pageEvening.textRu),
    "вечернее «отметьтесь» у страницы без «приложения»");
  const pageNextDay = viaPage(at({
    localHour: 12, todaySession: null,
    yesterdaySession: { title: "Бег/шаг", minutes: 30 }, yesterdayClosed: false,
  } as Partial<ReminderInput>));
  expect(pageNextDay !== null && pageNextDay.send && pageNextDay.target.kind === "session" && pageNextDay.target.sessionId === "yesterday-id",
    "«вчера не видно» ведёт на карточку ВЧЕРАШНЕЙ тренировки, а не на главную");
  expect(pageNextDay !== null && pageNextDay.send && !/приложени/iu.test(pageNextDay.textRu),
    "«вчера не видно» у страницы без «приложения»");

  console.log("");
  if (failures === 0) {
    console.log("ВСЁ ПРОШЛО. Провалов: 0.");
    process.exit(0);
  }
  console.log(`ПРОВАЛОВ: ${failures}.`);
  process.exit(1);
}

main();
