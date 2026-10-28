/**
 * Пробная неделя в основном боте: логика и сценарии на тестовых датах, без сети, без базы
 * и без настоящего Telegram. Хранилище в памяти, Telegram пишет исходящие вызовы в массив.
 *
 * ЧТО СТЕРЕЖЁТ:
 *   — флаг: по умолчанию выключен; в вебхуке обе ветки (/start trial и кнопки tr:) стоят
 *     за isTrialEnabled(), ветка входа стоит ДО /start run, /start club и маппинга в /tp_start;
 *   — deep link: trial и trial_<источник> ([A-Za-z0-9_-], параметр до 64), остальное не наше;
 *   — тест: классификация результата по правилу, исходы «здоровье» и «уже бегаешь»;
 *     по шестому вопросу хранится ТОЛЬКО флаг, тренеру не уходит, что именно отмечено;
 *   — неделя: старт со следующего подходящего дня, ровно 2 или 3 тренировки за 7 дней;
 *   — прогрессия: вверх только после двух «Легко/Нормально», «Тяжело» вниз, «Что-то болело»
 *     заменяет следующую на ходьбу, «Не получилось» ничего не меняет;
 *   — расписание: окна по Москве, повторный тик ничего не дублирует, 403 останавливает человека;
 *   — тексты: ни одного длинного тире, тексты тренировок из библиотеки, при сбое из методики.
 *
 *   npm run check:trial-bot
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { createTrialBot, TrialBlockedError } from "@/features/trial-bot/bot";
import {
  DAY_PATTERNS,
  HEALTH_NONE,
  QUESTIONS,
  buildWeek,
  classifyResult,
  dueActions,
  isTrialEnabled,
  isoWeekday,
  mskNow,
  parseTrialCallback,
  parseTrialStart,
  planNext,
  startRungFor,
  testOutcome,
  weekAdvice,
  type Checkin,
  type PlannedSession,
  type ScheduleUser,
} from "@/features/trial-bot/logic";
import * as T from "@/features/trial-bot/texts";
import { fallbackWorkout, toBotVoice, workoutFor, type LibraryRows } from "@/features/trial-bot/workouts";
import { BEGINNER_LADDER } from "@/features/methodology/beginner";

import { memStore } from "./lib/trial-bot-memstore";

const EM = "—";

function noEm(text: string, where: string) {
  assert.ok(!text.includes(EM), `длинное тире в тексте (${where}): ${text}`);
}

/** Время по Москве (UTC+3, без перевода часов). */
function msk(date: string, hhmm: string): Date {
  return new Date(`${date}T${hhmm}:00+03:00`);
}

// ── память и Telegram ────────────────────────────────────────────────────────

type Sent = { chatId: string; text: string; kb?: T.Keyboard; method: "send" | "edit" | "answer" | "photo"; photo?: string };

function setup(opts: { now: Date; library?: LibraryRows; landingUrl?: string | null; blocked?: Set<string>; photoFails?: boolean }) {
  const mem = memStore();
  const out: Sent[] = [];
  let now = opts.now;
  let mid = 100;
  const blocked = opts.blocked ?? new Set<string>();
  const bot = createTrialBot({
    store: mem.store,
    tg: {
      async send(chatId, text, kb) {
        if (blocked.has(String(chatId))) throw new TrialBlockedError();
        out.push({ chatId: String(chatId), text, kb, method: "send" });
        return ++mid;
      },
      async edit(chatId, _messageId, text, kb) { out.push({ chatId: String(chatId), text, kb, method: "edit" }); },
      async answer(_id, text) { out.push({ chatId: "", text: text ?? "", method: "answer" }); },
      async sendPhoto(chatId, photoUrl, caption) {
        if (blocked.has(String(chatId))) throw new TrialBlockedError();
        if (opts.photoFails) throw new Error("Bad Request: wrong file identifier/HTTP URL specified");
        out.push({ chatId: String(chatId), text: caption ?? "", method: "photo", photo: photoUrl });
        return ++mid;
      },
    },
    now: () => now,
    library: async () => opts.library ?? new Map(),
    coachChatId: "999",
    landingUrl: opts.landingUrl ?? null,
  });
  return { bot, mem, out, setNow: (d: Date) => { now = d; } };
}

const USER = { id: 501, first_name: "Аня", username: "anya" };

async function press(env: ReturnType<typeof setup>, data: string, from = USER) {
  const cb = parseTrialCallback(data);
  assert.ok(cb, `кнопка ${data} разбирается`);
  await env.bot.handleCallback({ from, chatId: from.id, messageId: 1, callbackQueryId: "q", cb });
}

/** Пройти тест: answers — индексы вариантов по вопросам 1..6. */
async function passTest(env: ReturnType<typeof setup>, answers: number[], from = USER) {
  await env.bot.handleStart({ from, chatId: from.id, source: "reel12" });
  await press(env, "tr:go", from);
  for (let i = 0; i < answers.length; i++) await press(env, `tr:a:${i + 1}:${answers[i]}`, from);
}

const idxOf = (n: number, code: string) => QUESTIONS[n - 1].options.findIndex((o) => o.code === code);

async function main() {
  // ── флаг и вебхук ──────────────────────────────────────────────────────────
  assert.equal(isTrialEnabled({}), false, "по умолчанию выключено");
  assert.equal(isTrialEnabled({ TRIAL_BOT_ENABLED: "" }), false);
  assert.equal(isTrialEnabled({ TRIAL_BOT_ENABLED: "0" }), false);
  assert.equal(isTrialEnabled({ TRIAL_BOT_ENABLED: "false" }), false);
  assert.equal(isTrialEnabled({ TRIAL_BOT_ENABLED: "1" }), true);
  assert.equal(isTrialEnabled({ TRIAL_BOT_ENABLED: "true" }), true);
  {
    const route = readFileSync(path.join(process.cwd(), "src/app/api/telegram/webhook/route.ts"), "utf8");
    assert.ok(route.includes("isTrialEnabled() ? parseTrialStart(messageText) : null"), "вход за флагом");
    assert.ok(route.includes("isTrialEnabled() ? parseTrialCallback(parsedMessage.data) : null"), "кнопки за флагом");
    const trialAt = route.indexOf("parseTrialStart(messageText)");
    assert.ok(trialAt > 0 && trialAt < route.indexOf("clubStartParam === RUN_START_PARAM"), "вход раньше /start run");
    assert.ok(trialAt < route.indexOf('clubStartParam === "club"'), "вход раньше /start club");
    assert.ok(trialAt < route.indexOf("mapStartMessageToTrainingPeaksCommand(messageText)"), "вход раньше /tp_start");
    assert.ok(trialAt < route.indexOf("await noticeUnknownVisitor({"), "вход раньше noticeUnknownVisitor на /start");
    const cbAt = route.indexOf("parseTrialCallback(parsedMessage.data)");
    assert.ok(cbAt > 0 && cbAt < route.indexOf("ENROLL_CALLBACK_PREFIX)"), "кнопки tr: раньше прочих кнопок");
    // Ветки только для лички.
    assert.ok(route.includes('update.message.chat.type === "private"'));
    assert.ok(route.includes('update.callback_query?.message?.chat.type === "private"'));
    // Кнопки заведения по-прежнему только тренеру.
    assert.ok(route.includes("if (!parsedMessage.userId || !isCoachChat(parsedMessage.userId))"));
  }

  // ── deep link ──────────────────────────────────────────────────────────────
  assert.deepEqual(parseTrialStart("/start trial"), { source: null });
  assert.deepEqual(parseTrialStart("/start trial_reel12"), { source: "reel12" });
  assert.deepEqual(parseTrialStart("/start@igor_bot trial_ig-story_3"), { source: "ig-story_3" });
  assert.deepEqual(parseTrialStart("/start trial_" + "a".repeat(58)), { source: "a".repeat(58) }, "64 символа целиком");
  assert.equal(parseTrialStart("/start trial_" + "a".repeat(59)), null, "65 символов не наше");
  assert.equal(parseTrialStart("/start trial_"), null);
  assert.equal(parseTrialStart("/start trialx"), null);
  assert.equal(parseTrialStart("/start trial_a:b"), null);
  assert.equal(parseTrialStart("/start club"), null);
  assert.equal(parseTrialStart("/start run"), null);
  assert.equal(parseTrialStart("/start"), null);
  assert.equal(parseTrialStart("trial"), null);

  // ── классификация ──────────────────────────────────────────────────────────
  assert.equal(classifyResult({ q1: "no", q3: "breath" }), "clean_start", "Q1 нет важнее всего");
  assert.equal(classifyResult({ q1: "quit", q3: "breath", q5: "return" }), "too_fast", "задыхаюсь раньше возвращения");
  assert.equal(classifyResult({ q1: "quit", q3: "knees" }), "comeback");
  assert.equal(classifyResult({ q1: "regular", q3: "time", q5: "return" }), "comeback");
  assert.equal(classifyResult({ q1: "regular", q3: "progress" }), "no_system");
  assert.equal(classifyResult({ q1: "quit", q2: "5_15", q3: "time" }), "no_system", "названная причина важнее выведенной");
  assert.equal(classifyResult({ q1: "quit", q2: "lt5", q3: "never" }), "too_fast");
  assert.equal(classifyResult({ q1: "quit", q2: "15_30", q3: "never" }), "no_system");
  assert.equal(startRungFor("lt5"), 1);
  assert.equal(startRungFor("5_15"), 3);
  assert.equal(startRungFor("15_30"), 6);
  assert.equal(BEGINNER_LADDER[0].presetCode, "rw_5x4_2walk");
  assert.equal(BEGINNER_LADDER[2].presetCode, "rw_5x5_90walk");
  for (const code of ["heart", "chest", "injury", "pregnant"]) {
    assert.deepEqual(testOutcome({ q1: "no", q2: "lt5" }, code), { kind: "health_stop" }, code);
  }
  assert.deepEqual(testOutcome({ q1: "regular", q2: "gt30" }, HEALTH_NONE), { kind: "already_runner" });
  assert.deepEqual(testOutcome({ q1: "regular", q2: "gt30" }, "heart"), { kind: "health_stop" }, "здоровье раньше всего");
  assert.deepEqual(testOutcome({ q1: "no", q2: "lt5", q3: "never", q4: "2", q5: "5k" }, HEALTH_NONE), {
    kind: "result", resultType: "clean_start", startRung: 1, weeklyRuns: 2,
  });

  // ── неделя ─────────────────────────────────────────────────────────────────
  // 2026-11-02 — понедельник.
  assert.equal(isoWeekday("2026-11-02"), 1);
  for (const [code, p] of Object.entries(DAY_PATTERNS)) {
    for (let shift = 0; shift < 7; shift++) {
      const today = new Date(Date.UTC(2026, 10, 2 + shift)).toISOString().slice(0, 10);
      const w = buildWeek(today, code)!; // без времени: как после 14:00, сегодня не берём
      assert.equal(w.dates.length, p.runs, `${code} от ${today}`);
      assert.ok(w.weekStart > today, "сегодня не берём");
      assert.equal(w.dates[0], w.weekStart);
      for (const d of w.dates) assert.ok(p.days.includes(isoWeekday(d)), `${code}: ${d} в наборе`);
      const last = w.dates[w.dates.length - 1];
      assert.ok(Date.parse(last) - Date.parse(w.weekStart) <= 6 * 86_400_000, "в пределах 7 дней");
    }
  }
  assert.deepEqual(buildWeek("2026-11-02", "m3a", 14 * 60), { weekStart: "2026-11-04", dates: ["2026-11-04", "2026-11-07", "2026-11-09"], startsToday: false }, "пн 14:00: уже не сегодня");
  // [решение Игоря 28.10.2026] сегодня в наборе и раньше 14:00 по Москве: неделя с сегодня.
  assert.deepEqual(buildWeek("2026-11-02", "m3a", 13 * 60 + 59), { weekStart: "2026-11-02", dates: ["2026-11-02", "2026-11-04", "2026-11-07"], startsToday: true });
  assert.deepEqual(buildWeek("2026-11-02", "m3a", 7 * 60), { weekStart: "2026-11-02", dates: ["2026-11-02", "2026-11-04", "2026-11-07"], startsToday: true });
  assert.equal(buildWeek("2026-11-02", "m3b", 9 * 60)!.weekStart, "2026-11-03", "сегодня не в наборе: со следующего подходящего");
  assert.equal(buildWeek("2026-11-02", "nope"), null);

  // ── прогрессия ─────────────────────────────────────────────────────────────
  const R = (rung: number): PlannedSession => ({ kind: "rung", rung });
  const W: PlannedSession = { kind: "walk" };
  assert.deepEqual(planNext(1, []), R(1));
  assert.deepEqual(planNext(1, [{ planned: R(1), checkin: "easy" }]), R(1), "одной мало");
  assert.deepEqual(planNext(1, [{ planned: R(1), checkin: "easy" }, { planned: R(1), checkin: "ok" }]), R(2), "две чистые: вверх");
  assert.deepEqual(planNext(1, [{ planned: R(1), checkin: "easy" }, { planned: R(1), checkin: "miss" }]), R(1), "пропуск не считается");
  assert.deepEqual(planNext(1, [{ planned: R(1), checkin: "easy" }, { planned: R(1), checkin: null }, { planned: R(1), checkin: "ok" }]), R(2));
  assert.deepEqual(planNext(3, [{ planned: R(3), checkin: "hard" }]), R(2), "тяжело: ступенью ниже");
  assert.deepEqual(planNext(1, [{ planned: R(1), checkin: "hard" }]), R(1), "ниже первой некуда");
  assert.deepEqual(planNext(3, [{ planned: R(3), checkin: "easy" }, { planned: R(3), checkin: "hard" }]), R(2));
  assert.deepEqual(planNext(3, [{ planned: R(3), checkin: "pain" }]), W, "болело: ходьба");
  assert.deepEqual(planNext(3, [{ planned: R(3), checkin: "pain" }, { planned: W, checkin: "ok" }]), R(3), "после ходьбы та же ступень");
  assert.deepEqual(planNext(3, [{ planned: R(3), checkin: "pain" }, { planned: W, checkin: null }]), R(3), "ходьба одна");
  assert.deepEqual(planNext(3, [{ planned: R(3), checkin: "pain" }, { planned: W, checkin: "pain" }]), W, "снова болело: снова ходьба");
  assert.deepEqual(planNext(7, [{ planned: R(7), checkin: "easy" }, { planned: R(7), checkin: "easy" }]), R(7), "выше седьмой некуда");
  assert.equal(weekAdvice(1, [{ planned: R(1), checkin: "easy" }, { planned: R(1), checkin: "ok" }]).kind, "up");
  assert.equal(weekAdvice(1, [{ planned: R(1), checkin: "easy" }, { planned: R(1), checkin: "pain" }]).kind, "careful");
  assert.equal(weekAdvice(1, [{ planned: R(1), checkin: "ok" }, { planned: R(1), checkin: "miss" }]).kind, "same");

  // ── расписание ─────────────────────────────────────────────────────────────
  const WS = "2026-11-04"; // среда, день 1
  const base: ScheduleUser = { stage: "week", stopped: false, test_q: null, last_action_at: null, test_started_at: null, week_start: WS, base_requested: false };
  const ses = [
    { idx: 1, date: "2026-11-04", checkin: null as Checkin | null },
    { idx: 2, date: "2026-11-07", checkin: null as Checkin | null },
    { idx: 3, date: "2026-11-09", checkin: null as Checkin | null },
  ];
  const kinds = (u: ScheduleUser, s: typeof ses, d: Date) => dueActions(u, s, d).map((a) => a.kind);
  assert.deepEqual(kinds(base, ses, msk("2026-11-04", "07:59")), []);
  assert.deepEqual(kinds(base, ses, msk("2026-11-04", "08:11")), ["morning"]);
  assert.deepEqual(kinds(base, ses, msk("2026-11-04", "14:00")), []);
  assert.deepEqual(kinds(base, ses, msk("2026-11-04", "19:11")), ["evening"]);
  assert.deepEqual(kinds(base, [{ ...ses[0], checkin: "ok" }, ses[1], ses[2]], msk("2026-11-04", "19:41")), [], "ответил: вечер не нужен");
  assert.deepEqual(kinds(base, ses, msk("2026-11-05", "08:11")), [], "не день тренировки");
  // Офер середины недели [решение Игоря 28.10.2026]: не «день 4» по календарю, а наутро после второй
  // отметки (любой), 12:00-18:00; меньше двух отметок к дню 5 — в день 5. Было: всегда день 4.
  assert.deepEqual(kinds(base, ses, msk("2026-11-07", "12:11")), [], "день 4 без двух отметок: офера нет");
  assert.deepEqual(kinds(base, ses, msk("2026-11-08", "12:11")), ["day4"], "день 5: запасной офер");
  assert.deepEqual(kinds(base, ses, msk("2026-11-09", "12:11")), ["day4"], "день 6: если день 5 не ушёл");
  assert.deepEqual(kinds(base, ses, msk("2026-11-10", "12:11")), [], "день 7: офера нет, будет итог");
  {
    const two = [
      { ...ses[0], checkin: "miss" as Checkin, checkin_at: msk("2026-11-04", "19:20").toISOString() },
      { ...ses[1], checkin: "ok" as Checkin, checkin_at: msk("2026-11-05", "09:00").toISOString() },
      ses[2],
    ];
    assert.deepEqual(kinds(base, two, msk("2026-11-05", "17:41")), ["case1"], "в день второй отметки офера нет");
    assert.deepEqual(kinds(base, two, msk("2026-11-06", "11:59")), [], "до 12:00 нет");
    assert.deepEqual(kinds(base, two, msk("2026-11-06", "12:11")), ["day4"], "наутро после второй отметки («Не получилось» тоже отметка)");
    assert.deepEqual(kinds(base, two, msk("2026-11-06", "18:11")), [], "после 18:00 нет");
  }
  // Истории учеников: день 2 и день 5, 13:00-18:00 по Москве.
  assert.deepEqual(kinds(base, ses, msk("2026-11-05", "12:59")), []);
  assert.deepEqual(kinds(base, ses, msk("2026-11-05", "13:11")), ["case1"]);
  assert.deepEqual(kinds(base, ses, msk("2026-11-05", "17:41")), ["case1"]);
  assert.deepEqual(kinds(base, ses, msk("2026-11-05", "18:11")), []);
  assert.deepEqual(kinds(base, ses, msk("2026-11-07", "13:11")), [], "в день 4 истории нет");
  // [решение Игоря 28.10.2026] в день офера историй нет: история переезжает на следующий день.
  // Было: в день 5 и офер, и история Лены.
  assert.deepEqual(kinds(base, ses, msk("2026-11-08", "13:11")), ["day4"], "день 5: офер этим тиком, история ждёт");
  assert.deepEqual(kinds({ ...base, offer_sent_on: "2026-11-08" }, ses, msk("2026-11-08", "13:11")), ["day4"], "офер уже ушёл сегодня: истории нет");
  assert.deepEqual(kinds({ ...base, offer_sent_on: "2026-11-08" }, ses, msk("2026-11-09", "13:11")), ["day4", "case2"], "история Лены на следующий день (day4 здесь отсечёт ключ, офер уже ушёл)");
  assert.deepEqual(kinds({ ...base, offer_sent_on: "2026-11-08" }, ses, msk("2026-11-09", "12:41")), ["day4"], "до 13:00 истории нет (офер отсечёт ключ)");
  assert.deepEqual(kinds({ ...base, offer_sent_on: "2026-11-07" }, ses, msk("2026-11-08", "13:11")), ["day4", "case2"], "офер был вчера: история Лены в свой день 5");
  assert.deepEqual(kinds({ ...base, offer_sent_on: "2026-11-06" }, ses, msk("2026-11-09", "13:11")), ["day4"], "офер не в день 5: история не переезжает на день 6");
  assert.deepEqual(kinds({ ...base, offer_sent_on: "2026-11-05" }, ses, msk("2026-11-05", "13:11")), [], "офер в день 2: история Марины переезжает");
  assert.deepEqual(kinds({ ...base, offer_sent_on: "2026-11-05" }, ses, msk("2026-11-06", "13:11")), ["case1"], "Марина на день 3");
  assert.deepEqual(kinds({ ...base, stage: "post" }, ses, msk("2026-11-12", "13:11")), [], "после недели историй нет");
  assert.deepEqual(kinds({ ...base, stopped: true }, ses, msk("2026-11-05", "13:11")), [], "остановил бота: истории нет");
  assert.deepEqual(kinds({ ...base, stage: "declined" }, ses, msk("2026-11-05", "13:11")), [], "только смотрит: истории нет");
  assert.equal(dueActions(base, ses, msk("2026-11-05", "13:11"))[0].kind === "case1" && (dueActions(base, ses, msk("2026-11-05", "13:11"))[0] as { key: string }).key, "w2026-11-04:case1");
  assert.deepEqual(kinds(base, ses, msk("2026-11-10", "19:41")), [], "день 7 до 20:30, есть неотмеченные");
  assert.deepEqual(kinds(base, ses, msk("2026-11-10", "20:41")), ["day7"]);
  const allIn = ses.map((s) => ({ ...s, checkin: "ok" as Checkin }));
  assert.deepEqual(kinds(base, allIn, msk("2026-11-10", "19:41")), ["day7"], "все отметки: итог сразу вечером");
  assert.deepEqual(kinds(base, ses, msk("2026-11-11", "10:00")), ["set_stage"]);
  const post: ScheduleUser = { ...base, stage: "post" };
  assert.deepEqual(kinds(post, ses, msk("2026-11-11", "12:11")), ["fu8"]);
  assert.deepEqual(kinds(post, ses, msk("2026-11-12", "12:11")), []);
  assert.deepEqual(kinds(post, ses, msk("2026-11-13", "12:11")), ["fu10"]);
  assert.deepEqual(kinds(post, ses, msk("2026-11-15", "12:11")), ["channel"]);
  assert.deepEqual(kinds(post, ses, msk("2026-11-15", "18:11")), ["set_stage"]);
  assert.deepEqual(kinds({ ...post, base_requested: true }, ses, msk("2026-11-11", "12:11")), [], "попросился в Базу: не дожимаем");
  assert.deepEqual(kinds({ ...base, stopped: true }, ses, msk("2026-11-04", "08:11")), [], "остановил бота: тишина");
  const keys = dueActions(base, ses, msk("2026-11-04", "08:11")).map((a) => ("key" in a ? a.key : ""));
  assert.deepEqual(keys, ["w2026-11-04:morning:1"], "ключ с датой недели");
  const testing: ScheduleUser = { ...base, stage: "test", test_q: 3, test_started_at: "2026-11-02T08:00:00.000Z", last_action_at: msk("2026-11-02", "11:00").toISOString() };
  assert.deepEqual(kinds(testing, [], msk("2026-11-02", "13:59")), [], "меньше 3 часов");
  assert.deepEqual(kinds(testing, [], msk("2026-11-02", "14:11")), ["nudge"]);
  assert.deepEqual(kinds({ ...testing, last_action_at: msk("2026-11-02", "20:00").toISOString() }, [], msk("2026-11-02", "23:30")), [], "ночью не напоминаем");
  assert.equal(mskNow(new Date("2026-11-04T21:30:00Z")).date, "2026-11-05", "после полуночи по Москве уже завтра");

  // ── кнопки ─────────────────────────────────────────────────────────────────
  const allKbs: T.Keyboard[] = [
    T.INTRO_KB, T.NUDGE_KB, T.HEALTH_KB, T.ALREADY_KB, T.OFFER_WEEK_KB, T.DECLINED_KB, T.chooseDaysKb(Object.keys(DAY_PATTERNS)),
    T.eveningKb(1), T.eveningKb(3), T.day4Kb("https://igorp.run/baza"), T.BASE_KB, T.BASE_YES_KB, T.FOLLOWUP_KB, T.CHANNEL_KB, T.TEXT_HINT_KB,
    ...QUESTIONS.map((q) => T.questionKb(q)),
  ];
  for (const kb of allKbs) {
    for (const b of kb.flat()) {
      noEm(b.text, "кнопка");
      if ("data" in b) {
        assert.ok(Buffer.byteLength(b.data) <= 64, `callback_data до 64 байт: ${b.data}`);
        assert.ok(parseTrialCallback(b.data), `кнопка разбирается: ${b.data}`);
      } else {
        assert.ok(b.url.startsWith("https://"), b.url);
      }
    }
  }
  assert.equal(parseTrialCallback("tr:a:7:0"), null);
  assert.equal(parseTrialCallback("tr:a:1:9"), null);
  assert.equal(parseTrialCallback("tr:ci:4:ok"), null);
  assert.equal(parseTrialCallback("tr:ci:1:great"), null);
  assert.equal(parseTrialCallback("iv:new:1"), null);
  assert.equal(T.day4Kb(null).flat().some((b) => "url" in b), false, "без TRIAL_BASE_LANDING_URL кнопки «Подробнее» нет");
  assert.ok(T.BASE_YES_KB[0][0] && "url" in T.BASE_YES_KB[0][0] && T.BASE_YES_KB[0][0].url.includes("tool=trial"));
  assert.ok("url" in T.BASE_YES_KB[0][0] && decodeURIComponent(T.BASE_YES_KB[0][0].url).includes("Хочу в Базу после пробной недели"));

  // ── тексты без длинных тире ────────────────────────────────────────────────
  for (const [k, v] of Object.entries(T)) if (typeof v === "string") noEm(v, k);
  for (const q of QUESTIONS) { noEm(T.questionText(q), `вопрос ${q.n}`); q.options.forEach((o) => noEm(o.label, "вариант")); }
  for (const s of BEGINNER_LADDER) {
    const fb = fallbackWorkout(s.index);
    noEm(fb.title + fb.body, `запасной текст ступени ${s.index}`);
    assert.ok(!/перейдите|оцените|отметьте/.test(fb.body), "голос на «ты»");
    for (const type of ["clean_start", "too_fast", "no_system", "comeback"] as const) noEm(T.resultCard(type, fb), type);
    noEm(T.morningText(fb), "утро");
  }
  for (const n of [0, 1, 2, 3]) for (const y of [1, 2, 3]) noEm(T.day4Text(n, y), "день 4");
  assert.match(T.day4Text(2, 3), /сделал\(а\) 2 из 3 тренировок/);
  assert.match(T.day4Text(1, 1), /1 из 1 тренировки/);
  for (const a of [{ kind: "up", rung: 2 }, { kind: "same", rung: 1 }, { kind: "careful", rung: 1 }] as const) {
    noEm(T.day7Text(2, 1, { ok: 1, easy: 1, pain: 1 }, a, "x"), "день 7");
    noEm(T.day7Text(0, 0, {}, a, "x"), "день 7, ноль");
  }
  // [решение Игоря 28.10.2026] пробежки и прогулки считаются отдельно. Было: «3 тренировки» вместе с ходьбой.
  assert.equal(T.doneLine(2, 1), "2 пробежки и 1 прогулка");
  assert.equal(T.doneLine(3, 0), "3 пробежки");
  assert.equal(T.doneLine(1, 0), "1 пробежка");
  assert.equal(T.doneLine(0, 1), "1 прогулка");
  assert.equal(T.doneLine(1, 2), "1 пробежка и 2 прогулки");
  assert.equal(T.doneLine(5, 0), "5 пробежек");
  assert.match(T.day7Text(3, 0, { easy: 1, ok: 2 }, { kind: "up", rung: 2 }, "5 x 5 мин бег / 2 мин шаг"), /^Неделя закончилась\. Итог: 3 пробежки, по ощущениям легко 1, нормально 2\. Следующий шаг для тебя: перейти на ступень выше: 5 x 5 мин бег \/ 2 мин шаг\. Дальше можем идти вместе в Базе\.$/);
  for (const c of ["easy", "ok", "hard", "miss", "pain"] as const) { noEm(T.CHECKIN_REPLIES[c], c); noEm(T.eveningAnswered(c), c); }
  const who = { firstName: "Аня", username: "anya", id: 1, source: "reel12" };
  noEm(T.coachHealth(who) + T.coachPain(who, 1, "x") + T.coachBase(who, 1, 2), "тренеру");
  noEm(T.weekConfirmed(["2026-11-04", "2026-11-07"]) + T.alreadyInWeek("2026-11-04") + T.alreadyInWeek(null) + T.nudgeText(3), "прочее");
  assert.equal(T.dayLabel("2026-11-04"), "ср 4 ноября");

  // Текст библиотеки (как в миграции 20260929000000) приводится к голосу бота.
  const libText =
    "5 повторов: 4 мин лёгкого бега + 2 мин шага. Шаг — это отдых, идти спокойно. Ни темпа, ни пульса не смотрим — только ощущения: усилие 2–4 по шкале 1–10, дыхание ровное, разговор возможен полными фразами. При боли или дискомфорте остановиться или перейти на шаг и сказать тренеру. После тренировки оцените усилие — от этой оценки зависит следующая ступень.";
  const voiced = toBotVoice(libText);
  noEm(voiced, "библиотека");
  assert.ok(voiced.includes("Шаг: это отдых"), voiced);
  assert.ok(voiced.includes("не смотрим, только ощущения"), voiced);
  assert.ok(voiced.includes("усилие 2-4"), voiced);
  assert.ok(voiced.includes("написать мне"), voiced);
  assert.ok(voiced.includes("оцени усилие, от этой оценки"), voiced);
  const lib: LibraryRows = new Map([["rw_5x4_2walk", { title: "5 x 4 мин бег / 2 мин шаг", body: libText }]]);
  assert.equal(workoutFor({ kind: "rung", rung: 1 }, lib).body, voiced, "текст из библиотеки");
  assert.equal(workoutFor({ kind: "rung", rung: 1 }, new Map()).body, fallbackWorkout(1).body, "сбой библиотеки: текст методики");
  assert.equal(workoutFor({ kind: "rung", rung: 1 }, new Map()).presetCode, "rw_5x4_2walk");

  // ── сценарий: тест → результат → неделя → утро/вечер → день 4 → итог → База ──
  {
    const env = setup({ now: msk("2026-11-02", "15:00"), library: lib });
    // Q1 «Пробовал(а), но бросил(а)», Q2 «Меньше 5 минут», Q3 «Задыхаюсь», Q4 «3 раза», Q5 «Прийти в форму», Q6 «Ничего».
    await passTest(env, [idxOf(1, "quit"), idxOf(2, "lt5"), idxOf(3, "breath"), idxOf(4, "3"), idxOf(5, "shape"), idxOf(6, HEALTH_NONE)]);
    const u = env.mem.users.get(USER.id)!;
    assert.equal(u.stage, "result");
    assert.equal(u.result_type, "too_fast");
    assert.equal(u.start_rung, 1);
    assert.equal(u.first_source, "reel12");
    assert.equal(u.health_flag, false);
    assert.deepEqual(Object.keys(u.answers).sort(), ["q1", "q2", "q3", "q4", "q5"], "вопрос про здоровье в ответы не попадает");
    const sends = env.out.filter((o) => o.method === "send").map((o) => o.text);
    assert.equal(sends[0], T.INTRO);
    assert.ok(sends.some((t) => t.startsWith("Твой результат: Слишком быстро") && t.includes("Первая тренировка: 5 x 4 мин бег / 2 мин шаг") && t.includes("Шаг: это отдых")));
    assert.equal(sends[sends.length - 1], T.OFFER_WEEK);
    const edits = env.out.filter((o) => o.method === "edit").map((o) => o.text);
    assert.ok(edits.includes("Вопрос 2 из 6\n\nСколько сейчас можешь пробежать без остановки?"), "вопросы правят одно сообщение");

    // старая кнопка вопроса ничего не ломает
    await press(env, "tr:a:3:0");
    assert.equal(env.mem.users.get(USER.id)!.stage, "result");

    await press(env, "tr:wk:y");
    assert.equal(env.mem.users.get(USER.id)!.stage, "choose_days");
    assert.deepEqual(env.out.at(-1)!.kb!.flat().map((b) => b.text), ["Пн Ср Сб", "Вт Чт Сб", "Вт Чт Вс"]);
    await press(env, "tr:days:m2a"); // чужой набор на 3 раза: игнор
    assert.equal(env.mem.users.get(USER.id)!.stage, "choose_days");
    await press(env, "tr:days:m3a");
    const uw = env.mem.users.get(USER.id)!;
    assert.equal(uw.stage, "week");
    assert.equal(uw.week_start, "2026-11-04");
    assert.deepEqual(env.mem.sessions.get(USER.id)!.map((s) => s.scheduled_date), ["2026-11-04", "2026-11-07", "2026-11-09"]);
    assert.ok(env.out.at(-1)!.text.includes("ср 4 ноября, сб 7 ноября, пн 9 ноября"));
    await press(env, "tr:days:m3b");
    assert.equal(env.mem.users.get(USER.id)!.days_pattern, "m3a", "повторное нажатие дней неделю не меняет");

    // утро дня 1: один раз, даже если тик пришёл дважды
    env.setNow(msk("2026-11-04", "08:11"));
    env.out.length = 0;
    await env.bot.runTick();
    await env.bot.runTick();
    env.setNow(msk("2026-11-04", "08:41"));
    await env.bot.runTick();
    const mornings = env.out.filter((o) => o.text.startsWith("Доброе утро!"));
    assert.equal(mornings.length, 1, "утро ровно одно");
    assert.ok(mornings[0].text.includes("Сегодня тренировка: 5 x 4 мин бег / 2 мин шаг."));
    // [решение Игоря 28.10.2026] усилие везде «2-4 из 10», как в библиотеке. Было «3-4».
    assert.ok(mornings[0].text.endsWith("Главное правило: усилие 2-4 из 10, можешь говорить фразами. Если что-то заболит, переходи на шаг."));
    assert.ok(!mornings[0].text.includes("3-4"), "нигде не «3-4»");

    // вечер: вопрос и ответ «Легко»
    env.setNow(msk("2026-11-04", "19:11"));
    env.out.length = 0;
    await env.bot.runTick();
    await env.bot.runTick();
    assert.equal(env.out.filter((o) => o.text === T.EVENING).length, 1);
    await press(env, "tr:ci:1:easy");
    assert.ok(env.out.some((o) => o.text === T.CHECKIN_REPLIES.easy));
    await press(env, "tr:ci:1:pain");
    assert.equal(env.mem.sessions.get(USER.id)![0].checkin, "easy", "первый ответ окончательный");
    env.setNow(msk("2026-11-04", "19:41"));
    env.out.length = 0;
    await env.bot.runTick();
    assert.equal(env.out.length, 0, "ответил: вечером больше не спрашиваем");

    // день 4 (сб 7 ноября): одна отметка, офера ещё нет
    env.setNow(msk("2026-11-07", "12:11"));
    env.out.length = 0;
    await env.bot.runTick();
    assert.ok(!env.out.some((o) => o.text.startsWith("Половина недели позади")), "одна отметка: офера нет");

    // утро сб: вторая тренировка (одной «Легко» мало, ступень та же); вечером «Нормально»
    env.setNow(msk("2026-11-07", "08:41"));
    await env.bot.runTick();
    assert.equal(env.mem.sessions.get(USER.id)![1].preset_code, "rw_5x4_2walk");
    env.setNow(msk("2026-11-07", "19:11"));
    await env.bot.runTick();
    await press(env, "tr:ci:2:ok");
    // наутро после второй отметки (вс 8 ноября, 12:00-18:00): офер «2 из 2», один раз
    env.setNow(msk("2026-11-08", "11:41"));
    env.out.length = 0;
    await env.bot.runTick();
    assert.ok(!env.out.some((o) => o.text.startsWith("Половина недели позади")), "до 12:00 нет");
    env.setNow(msk("2026-11-08", "12:11"));
    await env.bot.runTick();
    env.setNow(msk("2026-11-08", "12:41"));
    await env.bot.runTick();
    const d4s = env.out.filter((o) => o.text.startsWith("Половина недели позади"));
    assert.equal(d4s.length, 1, "офер один раз");
    assert.ok(d4s[0].text.includes("сделал(а) 2 из 2 тренировок"), d4s[0].text);
    assert.deepEqual(d4s[0].kb!.flat().map((b) => b.text), ["Сначала доделаю неделю"], "без TRIAL_BASE_LANDING_URL кнопки лендинга нет");
    // утро пн: две чистые → ступень 2 (текст из методики, библиотека его не знает)
    env.setNow(msk("2026-11-09", "08:11"));
    env.out.length = 0;
    await env.bot.runTick();
    assert.equal(env.mem.sessions.get(USER.id)![2].preset_code, "rw_5x5_2walk", "две чистые: ступенью выше");
    assert.ok(env.out.some((o) => o.text.includes("Сегодня тренировка: 5 x 5 мин бег / 2 мин шаг.")));

    // вечер пн (день 6, последняя тренировка): «Что-то болело» → тренеру без подробностей
    env.setNow(msk("2026-11-09", "19:11"));
    await env.bot.runTick();
    env.out.length = 0;
    await press(env, "tr:ci:3:pain");
    assert.ok(env.out.some((o) => o.text === T.CHECKIN_REPLIES.pain));
    const coach = env.out.filter((o) => o.chatId === "999");
    assert.equal(coach.length, 1);
    assert.ok(coach[0].text.includes("«Что-то болело»") && coach[0].text.includes("@anya"));
    assert.ok(!env.out.some((o) => o.text.startsWith("Неделя закончилась.")), "итог не раньше дня 7");
    // день 7: все отметки есть, итог уже вечером с 19:00, а не в 20:30, и только один раз
    env.setNow(msk("2026-11-10", "18:41"));
    await env.bot.runTick();
    assert.ok(!env.out.some((o) => o.text.startsWith("Неделя закончилась.")));
    env.setNow(msk("2026-11-10", "19:11"));
    await env.bot.runTick();
    const summary = env.out.find((o) => o.text.startsWith("Неделя закончилась."))!;
    assert.ok(summary, "итог вечером дня 7");
    assert.ok(summary.text.includes("Итог: 3 пробежки, по ощущениям легко 1, нормально 1, что-то болело 1."), summary.text);
    assert.ok(summary.text.includes("сначала убедиться, что ничего не болит"), summary.text);
    assert.deepEqual(summary.kb!.flat().map((b) => b.text), ["Хочу в Базу", "Подумаю"]);
    env.setNow(msk("2026-11-10", "20:41"));
    env.out.length = 0;
    await env.bot.runTick();
    assert.equal(env.out.length, 0, "итог не дублируется в 20:30");

    // переход в post, дожим дня 8, «Хочу в Базу» → тренеру один раз, дальше тишина
    env.setNow(msk("2026-11-11", "12:11"));
    await env.bot.runTick();
    assert.equal(env.mem.users.get(USER.id)!.stage, "post");
    await env.bot.runTick();
    assert.ok(env.out.some((o) => o.text === T.FOLLOWUP_8));
    env.out.length = 0;
    await press(env, "tr:base:y");
    await press(env, "tr:base:y");
    assert.equal(env.out.filter((o) => o.chatId === "999").length, 1, "тренеру один раз");
    assert.ok(env.out.filter((o) => o.chatId === "999")[0].text.includes("Хочу в Базу"));
    assert.ok(env.out.some((o) => o.text === T.BASE_YES));
    env.setNow(msk("2026-11-13", "12:11"));
    env.out.length = 0;
    await env.bot.runTick();
    assert.equal(env.out.length, 0, "после «Хочу в Базу» дожимов нет");
    env.setNow(msk("2026-11-16", "12:11"));
    await env.bot.runTick();
    assert.equal(env.mem.users.get(USER.id)!.stage, "done");
    assert.equal((await env.mem.store.listScheduled()).length, 0, "после конца тик человека не трогает");
  }

  // ── здоровье: план не выдаётся, тренеру без диагноза, хранится только флаг ──
  {
    const env = setup({ now: msk("2026-11-02", "15:00") });
    await passTest(env, [idxOf(1, "no"), idxOf(2, "lt5"), idxOf(3, "never"), idxOf(4, "2"), idxOf(5, "5k"), idxOf(6, "pregnant")]);
    const u = env.mem.users.get(USER.id)!;
    assert.equal(u.stage, "health_stop");
    assert.equal(u.health_flag, true);
    assert.equal(u.result_type, null);
    assert.ok(!JSON.stringify(u).includes("pregnant"), "что отмечено, не хранится");
    assert.ok(!JSON.stringify(env.mem.events).includes("pregnant"), "и в событиях нет");
    assert.ok(env.out.some((o) => o.text === T.HEALTH_STOP && o.kb?.[0][0] && "url" in o.kb[0][0]));
    assert.ok(!env.out.some((o) => o.text.startsWith("Твой результат")), "плана нет");
    const coach = env.out.filter((o) => o.chatId === "999");
    assert.equal(coach.length, 1);
    for (const word of ["Беремен", "беремен", "Сердце", "давлен", "груди", "Травма"]) assert.ok(!coach[0].text.includes(word), `тренеру без «${word}»`);
    assert.equal(env.mem.sessions.get(USER.id), undefined, "недели нет");
  }

  // ── уже бегает: без недели ──────────────────────────────────────────────────
  {
    const env = setup({ now: msk("2026-11-02", "15:00") });
    await passTest(env, [idxOf(1, "regular"), idxOf(2, "gt30"), idxOf(3, "progress"), idxOf(4, "3"), idxOf(5, "shape"), idxOf(6, HEALTH_NONE)]);
    assert.equal(env.mem.users.get(USER.id)!.stage, "already_runner");
    assert.ok(env.out.some((o) => o.text === T.ALREADY_RUNNER));
    assert.ok(!env.out.some((o) => o.text === T.OFFER_WEEK));
  }

  // ── «Пока только посмотрю», напоминание в тесте, 403 ────────────────────────
  {
    const env = setup({ now: msk("2026-11-02", "15:00") });
    await passTest(env, [idxOf(1, "no"), idxOf(2, "5_15"), idxOf(3, "never"), idxOf(4, "2"), idxOf(5, "regular"), idxOf(6, HEALTH_NONE)]);
    assert.equal(env.mem.users.get(USER.id)!.start_rung, 3);
    await press(env, "tr:wk:n");
    assert.equal(env.mem.users.get(USER.id)!.stage, "declined");
    assert.equal((await env.mem.store.listScheduled()).length, 0, "отказавшемуся тик ничего не шлёт");
    await press(env, "tr:wk:y");
    assert.equal(env.mem.users.get(USER.id)!.stage, "choose_days", "передумал: можно");
    assert.deepEqual(env.out.at(-1)!.kb!.flat().map((b) => b.text), ["Вт Сб", "Ср Вс"]);
  }
  {
    const env = setup({ now: msk("2026-11-02", "10:00") });
    await env.bot.handleStart({ from: USER, chatId: USER.id, source: null });
    await press(env, "tr:go");
    await press(env, "tr:a:1:0");
    await press(env, "tr:a:2:0");
    env.setNow(msk("2026-11-02", "13:11"));
    env.out.length = 0;
    await env.bot.runTick();
    env.setNow(msk("2026-11-02", "13:41"));
    await env.bot.runTick();
    env.setNow(msk("2026-11-02", "14:11"));
    await env.bot.runTick();
    const nudges = env.out.filter((o) => o.text.startsWith("Ты остановился(ась)"));
    assert.equal(nudges.length, 1, "напоминание один раз");
    assert.equal(nudges[0].text, "Ты остановился(ась) на вопросе 3, осталось меньше минуты.");
    await press(env, "tr:cont");
    assert.equal(env.out.at(-1)!.text, T.questionText(QUESTIONS[2]));
  }
  {
    const blocked = new Set<string>();
    const env = setup({ now: msk("2026-11-02", "15:00"), blocked });
    await passTest(env, [idxOf(1, "no"), idxOf(2, "lt5"), idxOf(3, "never"), idxOf(4, "3"), idxOf(5, "regular"), idxOf(6, HEALTH_NONE)]);
    await press(env, "tr:wk:y");
    await press(env, "tr:days:m3a");
    blocked.add(String(USER.id));
    env.setNow(msk("2026-11-04", "08:11"));
    const counts = await env.bot.runTick();
    assert.equal(counts.blocked, 1);
    assert.ok(env.mem.users.get(USER.id)!.stopped_at, "403: человек остановлен");
    assert.ok(env.mem.events.some((e) => e.kind === "blocked"));
    assert.equal((await env.mem.store.listScheduled()).length, 0);
  }

  // ── сбой отправки: ключ возвращается, следующий тик повторяет ───────────────
  {
    const env = setup({ now: msk("2026-11-02", "15:00") });
    await passTest(env, [idxOf(1, "no"), idxOf(2, "lt5"), idxOf(3, "never"), idxOf(4, "3"), idxOf(5, "regular"), idxOf(6, HEALTH_NONE)]);
    await press(env, "tr:wk:y");
    await press(env, "tr:days:m3a");
    let fail = true;
    const flaky = createTrialBot({
      store: env.mem.store,
      tg: {
        async send() { if (fail) throw new Error("network"); return 1; },
        async edit() {},
        async answer() {},
        async sendPhoto() { if (fail) throw new Error("network"); return 1; },
      },
      now: () => msk("2026-11-04", "08:11"),
      library: async () => new Map(),
      coachChatId: null,
      landingUrl: null,
    });
    const c1 = await flaky.runTick();
    assert.equal(c1.errors, 1);
    assert.equal(env.mem.sends.size, 0, "ключ возвращён");
    fail = false;
    const c2 = await flaky.runTick();
    assert.equal(c2.sent, 1);
  }

  // ── повторный /start посреди недели не сбрасывает её ───────────────────────
  {
    const env = setup({ now: msk("2026-11-02", "15:00") });
    await passTest(env, [idxOf(1, "no"), idxOf(2, "lt5"), idxOf(3, "never"), idxOf(4, "3"), idxOf(5, "regular"), idxOf(6, HEALTH_NONE)]);
    await press(env, "tr:wk:y");
    await press(env, "tr:days:m3a");
    env.setNow(msk("2026-11-05", "10:00"));
    await env.bot.handleStart({ from: USER, chatId: USER.id, source: "reel99" });
    assert.equal(env.mem.users.get(USER.id)!.stage, "week");
    assert.equal(env.out.at(-1)!.text, T.alreadyInWeek("2026-11-07"));
    assert.equal(env.mem.users.get(USER.id)!.first_source, "reel12", "первый источник не перетирается");
  }

  // ── истории учеников: Марина день 2 (фото), Лена день 5, Надя после дожима дня 8, Саша после дня 10 ──
  {
    const stories = { marina: T.CASE_MARINA, lena: T.CASE_LENA, nadya: T.CASE_NADYA, sasha: T.CASE_SASHA };
    for (const [k, c] of Object.entries(stories)) {
      noEm(c.text, `история ${k}`);
      assert.ok(c.text.length <= T.CAPTION_LIMIT, `подпись ${k} влезает в 1024`);
    }
    assert.ok(T.CASE_MARINA.text.startsWith("Расскажу про Марину.") && T.CASE_MARINA.text.endsWith("Ровно то, что ты делаешь на этой неделе."));
    assert.ok(T.CASE_MARINA.text.includes("не любит.\n\nПервое") && T.CASE_MARINA.text.includes("48:09, минус 14 минут."));
    assert.equal(T.CASE_MARINA.photoUrl, "https://igorp.run/landing/16-review-marina.jpg");
    assert.ok(T.CASE_LENA.text.startsWith("Ещё одна история, Лена. В мае она пробежала десятку за 55:01.") && T.CASE_LENA.text.endsWith("чтобы ты не перегорел(а)."));
    assert.equal(T.CASE_NADYA.text, "Надя в сентябре 2025 пробежала полумарафон за 1:51:54. Через 11 месяцев за 1:39:29: минус 12 минут на той же дистанции.");
    assert.equal(T.CASE_SASHA.text, "Саша в ноябре пробежал 5 км за 26:35. В феврале уже за 22:49: почти 4 минуты за два месяца.");
    assert.equal(T.CASE_LENA.photoUrl, null, "фото Лены, Нади и Саши Игорь пришлёт позже");
    assert.equal(T.CASE_NADYA.photoUrl, null);
    assert.equal(T.CASE_SASHA.photoUrl, null);

    for (const photoFails of [false, true]) {
      const env = setup({ now: msk("2026-11-02", "15:00"), photoFails });
      await passTest(env, [idxOf(1, "no"), idxOf(2, "lt5"), idxOf(3, "never"), idxOf(4, "3"), idxOf(5, "regular"), idxOf(6, HEALTH_NONE)]);
      await press(env, "tr:wk:y");
      await press(env, "tr:days:m3a"); // неделя с ср 4 ноября: день 2 = чт 5, день 5 = вс 8
      env.out.length = 0;
      for (const [d, t] of [["2026-11-05", "13:11"], ["2026-11-05", "13:41"], ["2026-11-05", "17:41"], ["2026-11-08", "12:11"], ["2026-11-08", "13:11"], ["2026-11-08", "16:41"], ["2026-11-09", "13:11"], ["2026-11-09", "16:41"]] as const) {
        env.setNow(msk(d, t));
        await env.bot.runTick();
        await env.bot.runTick();
      }
      const photos = env.out.filter((o) => o.method === "photo");
      const texts = env.out.filter((o) => o.method === "send" && (o.text === T.CASE_MARINA.text || o.text === T.CASE_LENA.text));
      if (!photoFails) {
        assert.deepEqual(photos.map((p) => [p.photo, p.text]), [[T.CASE_MARINA.photoUrl, T.CASE_MARINA.text]], "Марина фото с подписью, один раз");
        assert.deepEqual(texts.map((t) => t.text), [T.CASE_LENA.text], "Лена без фото: текст, один раз");
      } else {
        assert.equal(photos.length, 0);
        assert.deepEqual(texts.map((t) => t.text), [T.CASE_MARINA.text, T.CASE_LENA.text], "фото не принято: только текст, один раз");
      }
      // Дожимы дня 8 и 10: сначала дожим, следом история отдельным сообщением.
      for (const [d, t] of [["2026-11-11", "10:00"], ["2026-11-11", "12:11"], ["2026-11-11", "12:41"], ["2026-11-13", "12:11"], ["2026-11-13", "17:41"]] as const) {
        env.setNow(msk(d, t));
        await env.bot.runTick();
      }
      const sent = env.out.filter((o) => o.method === "send").map((o) => o.text);
      const i8 = sent.indexOf(T.FOLLOWUP_8);
      const i10 = sent.indexOf(T.FOLLOWUP_10);
      assert.ok(i8 >= 0 && sent[i8 + 1] === T.CASE_NADYA.text, "Надя сразу после дожима дня 8");
      assert.ok(i10 >= 0 && sent[i10 + 1] === T.CASE_SASHA.text, "Саша сразу после дожима дня 10");
      assert.equal(sent.filter((x) => x === T.CASE_NADYA.text).length, 1);
      assert.equal(sent.filter((x) => x === T.CASE_SASHA.text).length, 1);
    }
    // «Пока только посмотрю»: историй нет
    const env = setup({ now: msk("2026-11-02", "15:00") });
    await passTest(env, [idxOf(1, "no"), idxOf(2, "lt5"), idxOf(3, "never"), idxOf(4, "3"), idxOf(5, "regular"), idxOf(6, HEALTH_NONE)]);
    await press(env, "tr:wk:n");
    env.out.length = 0;
    env.setNow(msk("2026-11-05", "13:11"));
    await env.bot.runTick();
    assert.equal(env.out.length, 0);
  }

  // ── неделя с сегодня: первая тренировка сразу, тик её не повторяет ──────────
  {
    const env = setup({ now: msk("2026-11-02", "10:00") });
    await passTest(env, [idxOf(1, "no"), idxOf(2, "lt5"), idxOf(3, "never"), idxOf(4, "3"), idxOf(5, "regular"), idxOf(6, HEALTH_NONE)]);
    await press(env, "tr:wk:y");
    env.setNow(msk("2026-11-02", "13:30"));
    env.out.length = 0;
    await press(env, "tr:days:m3a");
    assert.equal(env.mem.users.get(USER.id)!.week_start, "2026-11-02");
    const confirm = env.out.find((o) => o.text.startsWith("Договорились, веду тебя неделю."))!;
    assert.ok(confirm.text.includes("пн 2 ноября, ср 4 ноября, сб 7 ноября") && confirm.text.includes("Первая уже сегодня"), confirm.text);
    // [решение Игоря 28.10.2026] сразу отправленная первая не «Доброе утро!», тело и приписка те же.
    assert.ok(!env.out.some((o) => o.text.startsWith("Доброе утро!")), "днём без «Доброе утро!»");
    const firstMorning = env.out.filter((o) => o.text.startsWith("Первая тренировка сегодня: 5 x 4 мин бег / 2 мин шаг."));
    assert.ok(firstMorning[0]?.text.endsWith("Главное правило: усилие 2-4 из 10, можешь говорить фразами. Если что-то заболит, переходи на шаг."));
    assert.ok(firstMorning[0]?.text.includes("5 повторов: 4 мин лёгкого бега"));
    assert.equal(firstMorning.length, 1, "задание сразу после выбора дней");
    assert.ok(env.out.indexOf(confirm) < env.out.indexOf(firstMorning[0]), "сначала подтверждение, потом задание");
    env.setNow(msk("2026-11-02", "13:41"));
    await env.bot.runTick();
    env.setNow(msk("2026-11-02", "19:11"));
    await env.bot.runTick();
    assert.equal(env.out.filter((o) => o.text.startsWith("Доброе утро!") || o.text.startsWith("Первая тренировка сегодня")).length, 1, "тик не повторяет");
    assert.equal(env.out.filter((o) => o.text === T.EVENING).length, 1, "вечером вопрос как обычно");
  }

  // ── день ходьбы: своё утро, в итоге прогулка отдельно ──────────────────────
  {
    noEm(T.MORNING_WALK, "утро ходьбы");
    assert.equal(T.MORNING_WALK, "Доброе утро! Сегодня вместо бега быстрая ходьба 30 минут. Спокойно, без рывков: это восстановление, а не пропуск.");
    const env = setup({ now: msk("2026-11-02", "15:00") });
    await passTest(env, [idxOf(1, "quit"), idxOf(2, "5_15"), idxOf(3, "knees"), idxOf(4, "3"), idxOf(5, "return"), idxOf(6, HEALTH_NONE)]);
    await press(env, "tr:wk:y");
    await press(env, "tr:days:m3a"); // ср 4, сб 7, пн 9
    for (const [d, c] of [["2026-11-04", "ok"], ["2026-11-07", "pain"], ["2026-11-09", "ok"]] as const) {
      env.setNow(msk(d, "08:11"));
      await env.bot.runTick();
      env.setNow(msk(d, "19:11"));
      await env.bot.runTick();
      await press(env, `tr:ci:${d === "2026-11-04" ? 1 : d === "2026-11-07" ? 2 : 3}:${c}`);
    }
    const walkMorning = env.out.filter((o) => o.text === T.MORNING_WALK);
    assert.equal(walkMorning.length, 1, "утро ходьбы своим текстом");
    // [решение Игоря 28.10.2026] было: к ходьбе приписка «переходи на шаг» и второй раз про врача.
    const mon = env.out.filter((o) => o.text.startsWith("Доброе утро!") && o.text !== T.MORNING_WALK);
    assert.equal(mon.length, 2);
    assert.equal(env.out.filter((o) => o.text.includes("лучше показаться врачу")).length, 1, "про врача только в ответе на «Что-то болело»");
    env.setNow(msk("2026-11-10", "19:11"));
    await env.bot.runTick();
    const summary = env.out.find((o) => o.text.startsWith("Неделя закончилась."))!;
    assert.ok(summary.text.includes("Итог: 2 пробежки и 1 прогулка, по ощущениям нормально 2, что-то болело 1."), summary.text);
  }

  // ── свободный текст ────────────────────────────────────────────────────────
  {
    const env = setup({ now: msk("2026-11-02", "15:00") });
    assert.equal(await env.bot.handleText({ from: { id: 777 }, chatId: 777 }), false, "не участник: решает вебхук");
    await env.bot.handleStart({ from: USER, chatId: USER.id, source: null });
    assert.equal(await env.bot.handleText({ from: USER, chatId: USER.id }), true);
    assert.equal(env.out.at(-1)!.text, T.TEXT_HINT);
  }

  console.log("check:trial-bot ok");
}

main().catch((e) => {
  console.error("check:trial-bot FAILED:", e instanceof Error ? e.message : e, e instanceof Error ? e.stack?.split("\n")[1] : "");
  process.exit(1);
});
