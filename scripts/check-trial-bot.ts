/**
 * Пробная неделя в основном боте: логика и сценарии на тестовых датах, без сети, без базы
 * и без настоящего Telegram. Хранилище в памяти, Telegram пишет исходящие вызовы в массив.
 *
 * ЧТО СТЕРЕЖЁТ:
 *   — флаг: по умолчанию выключен; в вебхуке обе ветки (/start trial и кнопки tr:) стоят
 *     за isTrialEnabled(), ветка входа стоит ДО /start run, /start club и маппинга в /tp_start;
 *   — deep link: trial и trial_<источник> ([A-Za-z0-9_-], параметр до 64), остальное не наше;
 *   — анкета по цели (как онбординг AI-coach): путь вопросов по ветке, кнопки до 30 знаков,
 *     без «(а)» и без прошедшего времени с родом; по вопросу про здоровье хранится ТОЛЬКО
 *     флаг, тренеру не уходит, что именно отмечено;
 *   — НИКОМУ НЕ ОТКАЗЫВАЕМ [29.10.2026]: перебором всех путей анкеты через бота каждый без
 *     отметки про здоровье получает результат и предложение недели (было: исход «уже бегаешь,
 *     неделя тебе не нужна»);
 *   — неделя бегуна (регулярно / к старту): лёгкий, интервалы, длительная по методике, размер
 *     из ответов; поправки по отметкам; лестница интервалов совпадает с генератором;
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
  ALL_DAY_PATTERNS,
  DAY_PATTERNS,
  HEALTH_NONE,
  QUESTIONS,
  buildWeek,
  classifyResult,
  dueActions,
  isRunnerTrack,
  isTrialEnabled,
  isoWeekday,
  mskNow,
  parseTrialCallback,
  parseTrialStart,
  pathLength,
  planNext,
  questionAt,
  questionPath,
  runnerInputFor,
  startRungFor,
  testOutcome,
  weekAdvice,
  type Checkin,
  type PlannedSession,
  type ScheduleUser,
  type TrialAnswers,
} from "@/features/trial-bot/logic";
import {
  TRIAL_INTERVAL_LADDER,
  buildRunnerWeek,
  planRunnerSession,
  runnerWeekAdvice,
  startIntervalStep,
  type RunnerInput,
  type RunnerPlanned,
  type RunnerSession,
} from "@/features/trial-bot/runner-week";
import * as T from "@/features/trial-bot/texts";
import { fallbackWorkout, runnerWorkout, stepRowKey, toBotVoice, usableEtalon, workoutFor, type LibraryRows } from "@/features/trial-bot/workouts";
import { BEGINNER_LADDER } from "@/features/methodology/beginner";

import { WALK_INTERVAL_LADDER } from "../tools/trainingpeaks-export/scripts/lib/interval-ladder.ts";

import { memStore } from "./lib/trial-bot-memstore";

const EM = "—";
const EN = "–";

/* [29.10.2026] было: только длинное тире. Правило Игоря и про среднее: ни «—», ни «–». */
function noEm(text: string, where: string) {
  assert.ok(!text.includes(EM) && !text.includes(EN), `длинное или среднее тире в тексте (${where}): ${text}`);
}

/** Время по Москве (UTC+3, без перевода часов). */
function msk(date: string, hhmm: string): Date {
  return new Date(`${date}T${hhmm}:00+03:00`);
}

// ── память и Telegram ────────────────────────────────────────────────────────

type Sent = { chatId: string; text: string; kb?: T.Keyboard; method: "send" | "edit" | "answer" | "photo"; photo?: string };

function setup(opts: { now: Date; library?: LibraryRows; landingUrl?: string | null; blocked?: Set<string>; photoFails?: boolean; students?: Set<number> | "throw" }) {
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
    isActiveStudent: async (id) => {
      if (opts.students === "throw") throw new Error("supabase down");
      return opts.students?.has(id) ?? false;
    },
  });
  return { bot, mem, out, setNow: (d: Date) => { now = d; } };
}

const USER = { id: 501, first_name: "Аня", username: "anya" };

async function press(env: ReturnType<typeof setup>, data: string, from = USER) {
  const cb = parseTrialCallback(data);
  assert.ok(cb, `кнопка ${data} разбирается`);
  await env.bot.handleCallback({ from, chatId: from.id, messageId: 1, callbackQueryId: "q", cb });
}

/** Кнопка ответа: вопрос по id и вариант по коду. */
function btn(qid: string, code: string): string {
  const i = QUESTIONS[qid].options.findIndex((o) => o.code === code);
  assert.ok(i >= 0, `нет варианта ${code} у вопроса ${qid}`);
  return `tr:a:${qid}:${i}`;
}

/**
 * Пройти анкету: codes — коды ответов по порядку пути (последний — про здоровье). Вопрос на
 * каждом шаге берётся из того, что бот реально показал последним (не из пути в чеке), так что
 * разойдись путь бота с ожиданием — нажатие упадёт на «кнопка не найдена».
 */
async function passTest(env: ReturnType<typeof setup>, codes: string[], from = USER) {
  await env.bot.handleStart({ from, chatId: from.id, source: "reel12" });
  await press(env, "tr:go", from);
  for (const code of codes) {
    const last = [...env.out].reverse().find((o) => o.kb?.flat().some((b) => "data" in b && b.data.startsWith("tr:a:")));
    assert.ok(last, "вопрос показан");
    const b = last.kb!.flat().find((x) => "data" in x && x.data.startsWith("tr:a:") && QUESTIONS[x.data.split(":")[2]].options[Number(x.data.split(":")[3])].code === code);
    assert.ok(b && "data" in b, `на экране нет кнопки с кодом ${code}: ${last.text}`);
    await press(env, b.data, from);
  }
}

/* Пути анкеты по целям. Последний код всегда про здоровье. */
const START_LT5 = ["start", "rarely", "lt5", "3", "none", HEALTH_NONE];
const START_5_30_TWO = ["start", "sometimes", "5_30", "2", "none", HEALTH_NONE];
const RETURN_3_6M = ["return", "3_6m", "3k", "3", "none", HEALTH_NONE];

/** Прогнать тики с шагом 30 минут по московским дням from..to (включительно). */
async function tickDays(env: ReturnType<typeof setup>, from: string, days: number) {
  for (let d = 0; d < days; d++) {
    const date = new Date(Date.parse(`${from}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
    for (let m = 0; m < 24 * 60; m += 30) {
      env.setNow(msk(date, `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`));
      await env.bot.runTick();
    }
  }
}

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

  // ── анкета ─────────────────────────────────────────────────────────────────
  // [29.10.2026] Было: шесть вопросов одним списком «для начинающих», классификация по
  // «что мешало», исход already_runner («неделя для начинающих тебе не нужна»). Отменено по
  // живому тесту Игоря: продукт для любого уровня. Теперь анкета по цели, как онбординг AI-coach.
  assert.deepEqual(questionPath({}).map((q) => q.id), ["goal"], "сначала цель");
  assert.deepEqual(QUESTIONS.goal.options.map((o) => o.label), ["Начать бегать", "Вернуться после перерыва", "Бегать регулярно", "Подготовиться к старту"]);
  assert.deepEqual(questionPath({ goal: "start" }).map((q) => q.id), ["goal", "nowrun", "canrun", "d23", "inj", "health"]);
  assert.deepEqual(questionPath({ goal: "return" }).map((q) => q.id), ["goal", "brk", "prev", "d234", "inj", "health"]);
  assert.deepEqual(questionPath({ goal: "regular" }).map((q) => q.id), ["goal", "wkm", "long", "intv", "d234", "inj", "health"]);
  assert.deepEqual(questionPath({ goal: "race" }).map((q) => q.id), ["goal", "dist"], "результат спрашиваем после дистанции");
  for (const d of ["5k", "10k", "21k", "42k"] as const) {
    assert.deepEqual(questionPath({ goal: "race", race_distance: d }).map((q) => q.id), ["goal", "dist", `rr${d}`, "wkm", "intv", "d34", "inj", "health"]);
  }
  for (const g of ["start", "return", "regular", "race"] as const) {
    const full = questionPath({ goal: g, race_distance: "10k" });
    assert.equal(pathLength({ goal: g }), full.length, `${g}: «из N» совпадает с путём`);
    assert.ok(full.length >= 6 && full.length <= 8, `${g}: путь 6-8 нажатий, а не ${full.length}`);
    assert.equal(full.at(-1)!.id, "health", `${g}: здоровье последним`);
    assert.equal(full.at(-2)!.id, "inj", `${g}: травмы перед здоровьем`);
  }
  // Варианты дней по цели, как getDaysPerWeekOptions в AI-coach (старт с 3, новичок до 3).
  assert.deepEqual(QUESTIONS.d23.options.map((o) => o.code), ["2", "3"]);
  assert.deepEqual(QUESTIONS.d234.options.map((o) => o.code), ["2", "3", "4"]);
  assert.deepEqual(QUESTIONS.d34.options.map((o) => o.code), ["3", "4"]);
  assert.equal(questionAt({ q1: "no" } as TrialAnswers, 3), null, "старая анкета без цели по новому пути не читается");

  // Ступени лестницы (новичок и возвращение) и неделя бегуна.
  // [29.10.2026, Игорь] было: четыре варианта длительности и ответ про режим ни на что не влиял.
  // Теперь три варианта, а режим сдвигает ступень. Держим всю таблицу целиком, а не пару точек.
  assert.deepEqual(QUESTIONS.canrun.options.map((o) => [o.code, o.label]), [["lt5", "Не дольше 5 минут"], ["5_30", "5-30 минут"], ["gt30", "Больше 30 минут"]]);
  assert.deepEqual(QUESTIONS.nowrun.options.map((o) => o.code), ["rarely", "sometimes", "weekly"], "оба вопроса новичка на месте");
  {
    const want: Record<string, [number, number, number]> = { lt5: [1, 1, 2], "5_30": [3, 4, 5], gt30: [5, 6, 7] }; // почти не бегаю, без режима, 1-2 раза
    for (const [can, rungs] of Object.entries(want)) {
      (["rarely", "sometimes", "weekly"] as const).forEach((now, i) => {
        assert.equal(startRungFor({ goal: "start", can_run: can as "lt5", now_running: now }), rungs[i], `новичок ${can} / ${now}`);
      });
    }
    const continuous = BEGINNER_LADDER.filter((x) => x.kind === "continuous").map((x) => x.index);
    for (const now of ["rarely", "sometimes", "weekly"] as const) {
      for (const can of ["lt5", "5_30"] as const) {
        assert.ok(!continuous.includes(startRungFor({ goal: "start", can_run: can, now_running: now })!), `${can}: непрерывного бега не даём, только с шагом`);
      }
    }
  }
  assert.equal(startRungFor({ goal: "start", can_run: "gt30", now_running: "sometimes", injury: "now" }), 5, "дискомфорт: ступенью ниже");
  assert.equal(startRungFor({ goal: "start", can_run: "lt5", now_running: "rarely", injury: "now" }), 1, "ниже первой некуда");
  assert.equal(startRungFor({ goal: "start", can_run: "15_30" as "5_30", now_running: "sometimes" }), 4, "старый код 15-30 читается как 5-30");
  assert.equal(startRungFor({ goal: "return", last_run: "6m_plus", prev_level: "3k" }), 1);
  assert.equal(startRungFor({ goal: "return", last_run: "3_6m", prev_level: "5k" }), 4);
  assert.equal(startRungFor({ goal: "return", last_run: "recent", prev_level: "10k" }), 7, "возвращение без интервалов даже с 10 км");
  assert.equal(startRungFor({ goal: "regular", weekly_km: "0_5", longest: "3_5" }), 6, "регулярно, но до 5 км: лестница, а не отказ");
  assert.equal(startRungFor({ goal: "regular", weekly_km: "15_30", longest: "up_to_3" }), 6);
  assert.equal(startRungFor({ goal: "regular", weekly_km: "15_30", longest: "5_10" }), null, "с базой: неделя бегуна");
  assert.equal(startRungFor({ goal: "race", race_distance: "10k", weekly_km: "unknown" }), null, "«не знаю» не лишает недели бегуна");
  assert.equal(classifyResult({ goal: "start" }), "clean_start");
  assert.equal(classifyResult({ goal: "return" }), "comeback");
  assert.equal(classifyResult({ goal: "regular", weekly_km: "15_30", longest: "5_10", intervals: "easy_only" }), "too_fast");
  assert.equal(classifyResult({ goal: "regular", weekly_km: "15_30", longest: "5_10", intervals: "regularly" }), "no_system");
  assert.equal(classifyResult({ goal: "race", weekly_km: "0_5" }), "no_system");
  assert.equal(BEGINNER_LADDER[0].presetCode, "rw_5x4_2walk");
  assert.equal(BEGINNER_LADDER[2].presetCode, "rw_5x5_90walk");
  for (const code of ["heart", "chest", "injury", "pregnant"]) {
    assert.deepEqual(testOutcome({ goal: "start", can_run: "lt5" }, code), { kind: "health_stop" }, code);
    assert.deepEqual(testOutcome({ goal: "race", race_distance: "42k", weekly_km: "50_plus" }, code), { kind: "health_stop" }, `${code}: здоровье раньше всего и у бегуна`);
  }
  assert.deepEqual(testOutcome({ goal: "start", now_running: "rarely", can_run: "lt5", days: "2", injury: "none" }, HEALTH_NONE), {
    kind: "result", resultType: "clean_start", startRung: 1, weeklyRuns: 2,
  });
  // Было: { q1: "regular", q2: "gt30" } → already_runner. Теперь у бегуна результат и неделя.
  assert.deepEqual(testOutcome({ goal: "regular", weekly_km: "30_50", longest: "10_15", intervals: "regularly", days: "4", injury: "none" }, HEALTH_NONE), {
    kind: "result", resultType: "no_system", startRung: null, weeklyRuns: 4,
  }, "«4 и больше» у бегуна: 4 тренировки (было 3 [решение Игоря 29.10.2026])");
  assert.equal(testOutcome({ goal: "return", last_run: "recent", prev_level: "10k", days: "4", injury: "none" }, HEALTH_NONE).kind === "result" &&
    (testOutcome({ goal: "return", last_run: "recent", prev_level: "10k", days: "4", injury: "none" }, HEALTH_NONE) as { weeklyRuns: number }).weeklyRuns, 3, "на лестнице «4 и больше» = 3: методика новичка не больше 3");

  // ── неделя бегуна по методике (AI-coach, сегмент run_regularly) ─────────────
  {
    // Лестница интервалов: та же, что у генератора Intervals, по порядку и формату.
    // [29.10.2026, Игорь] было: первые пять ступеней генератора, от 3 x 3 до 7 x 4. Теперь ровно
    // три размера первой недели, 3 x 3 и 7 x 4 нет вообще; 6 x 4 тот же пресет, что у генератора.
    assert.deepEqual(TRIAL_INTERVAL_LADDER.map((r) => [r.labelRu, r.restSec]), [["5 x 3 мин", 120], ["5 x 4 мин", 90], ["6 x 4 мин", 90]]);
    const g64 = WALK_INTERVAL_LADDER.find((r) => r.code === "int_walk_6x4")!;
    assert.equal(TRIAL_INTERVAL_LADDER[2].code, g64.code);
    assert.equal(TRIAL_INTERVAL_LADDER[2].reps * TRIAL_INTERVAL_LADDER[2].workMin, g64.workMinutes);
    const gi = WALK_INTERVAL_LADDER.findIndex((r) => r.code === "int_walk_6x4");
    assert.equal(WALK_INTERVAL_LADDER[gi + 1].labelRu, "7 x 4 мин", "совет «дальше» берёт следующую ступень генератора");
    const RI = (p: Partial<RunnerInput>): RunnerInput => ({ weeklyKm: "15_30", longest: "10_15", intervals: "sometimes", runs: 3, caution: false, raceDistance: null, raceResult: null, ...p });
    assert.deepEqual(buildRunnerWeek(RI({})), [{ kind: "easy", minutes: 40 }, { kind: "intervals", step: 1 }, { kind: "long", minutes: 75 }]);
    // [29.10.2026, решение Игоря] было: 2 пробежки = лёгкий + длительная без работы (AI-coach).
    // Теперь у бегуна при 2 пробежках интервалы + длительная, лёгкой нет.
    assert.deepEqual(buildRunnerWeek(RI({ runs: 2 })), [{ kind: "intervals", step: 1 }, { kind: "long", minutes: 75 }], "2 пробежки: интервалы и длительная");
    assert.deepEqual(buildRunnerWeek(RI({ runs: 2, caution: true })), [{ kind: "easy", minutes: 40 }, { kind: "long", minutes: 75 }], "2 пробежки с дискомфортом: без интервалов");
    // Было: «4 и больше» вело 3 тренировки. Теперь 4: лёгкий, интервалы, лёгкий, длительная.
    assert.deepEqual(buildRunnerWeek(RI({ runs: 4 })), [{ kind: "easy", minutes: 40 }, { kind: "intervals", step: 1 }, { kind: "easy", minutes: 40 }, { kind: "long", minutes: 75 }]);
    assert.deepEqual(buildRunnerWeek(RI({ runs: 4, caution: true })).map((x) => x.kind), ["easy", "easy", "easy", "long"]);
    assert.deepEqual(buildRunnerWeek(RI({ caution: true })).map((x) => x.kind), ["easy", "easy", "long"], "дискомфорт: интервалов нет совсем");
    assert.deepEqual(buildRunnerWeek(RI({ weeklyKm: "30_50", longest: "3_5" }))[2], { kind: "long", minutes: 55 }, "длительная длиннее лёгкой");
    assert.deepEqual(buildRunnerWeek(RI({ weeklyKm: "50_plus", longest: null, raceDistance: "5k" }))[2], { kind: "long", minutes: 70 }, "к пятёрке длительная не больше 70");
    // [29.10.2026, Игорь] было: объём и лучший результат двигали ступень до 7 x 4. Теперь только
    // опыт интервалов, и потолок 6 x 4 у всех: перебором всех ответов, а не одной точкой.
    for (const weeklyKm of ["0_5", "5_15", "15_30", "30_50", "50_plus", "unknown"] as const) {
      for (const raceResult of ["t1", "t2", "t3", "t4", "none", null] as const) {
        for (const raceDistance of ["5k", "10k", "21k", "42k", null] as const) {
          for (const [intervals, step] of [["easy_only", 0], ["unknown", 0], ["sometimes", 1], ["regularly", 2]] as const) {
            const w = buildRunnerWeek(RI({ weeklyKm, raceResult, raceDistance, intervals }));
            assert.deepEqual(w.find((x) => x.kind === "intervals"), { kind: "intervals", step }, `${weeklyKm}/${raceResult}/${raceDistance}/${intervals}`);
          }
        }
      }
    }
    assert.equal(startIntervalStep({ intervals: "regularly" }), 2);
    const base: RunnerSession[] = [{ kind: "easy", minutes: 40 }, { kind: "intervals", step: 2 }, { kind: "long", minutes: 75 }];
    const H = (planned: RunnerPlanned, checkin: Checkin | null) => ({ planned, checkin });
    assert.deepEqual(planRunnerSession(base, 2, [H(base[0], "easy")]), base[1], "внутри недели не прибавляем");
    assert.deepEqual(planRunnerSession(base, 2, [H(base[0], "hard")]), { kind: "intervals", step: 1 }, "тяжело: 6 x 4 → 5 x 4");
    const b1: RunnerSession[] = [base[0], { kind: "intervals", step: 1 }, base[2]];
    const b0: RunnerSession[] = [base[0], { kind: "intervals", step: 0 }, base[2]];
    assert.deepEqual(planRunnerSession(b1, 2, [H(b1[0], "hard")]), { kind: "intervals", step: 0 }, "тяжело: 5 x 4 → 5 x 3");
    assert.deepEqual(planRunnerSession(b0, 2, [H(b0[0], "hard")]), { kind: "intervals", step: 0 }, "ниже 5 x 3 некуда");
    assert.deepEqual(planRunnerSession(base, 3, [H(base[0], "ok"), H(base[1], "hard")]), { kind: "long", minutes: 60 }, "тяжело: длительная на пятую часть короче");
    assert.deepEqual(planRunnerSession(base, 3, [H(base[0], "hard"), H(base[1], "ok")]), base[2], "после «Нормально» снова по плану");
    assert.deepEqual(planRunnerSession(base, 3, [H(base[0], "miss"), H(base[1], null)]), base[2], "пропуск и молчание ничего не меняют");
    assert.deepEqual(planRunnerSession(base, 2, [H(base[0], "pain")]), { kind: "walk" }, "болело: ходьба");
    assert.deepEqual(planRunnerSession(base, 3, [H(base[0], "pain"), H({ kind: "walk" }, "ok")]), base[2], "после ходьбы по плану");
    assert.deepEqual(
      planRunnerSession([base[0], base[2], base[1]], 3, [H(base[0], "pain"), H({ kind: "walk" }, "ok")]),
      { kind: "easy", minutes: 40 },
      "после боли интервалы до конца недели становятся лёгким бегом",
    );
    assert.equal(runnerWeekAdvice(base, [H(base[0], "ok"), H(base[1], "easy"), H(base[2], "ok")]).kind, "up");
    assert.deepEqual(runnerWeekAdvice(base, [H(base[0], "ok"), H(base[1], "easy"), H(base[2], "ok")]), { kind: "up", nextIntervals: "7 x 4 мин" }, "после 6 x 4 следующая ступень генератора");
    assert.equal(runnerWeekAdvice(base, [H(base[0], "ok"), H(base[1], "hard"), H(base[2], "ok")]).kind, "same");
    assert.equal(runnerWeekAdvice(base, [H(base[0], "ok"), H(base[1], "miss"), H(base[2], null)]).kind, "same", "одна сделанная: прибавки нет");
    assert.equal(runnerWeekAdvice(base, [H(base[0], "pain"), H({ kind: "walk" }, "ok"), H(base[2], "ok")]).kind, "careful");
  }

  // ── никому не отказываем: перебор ВСЕХ путей анкеты через бота ────────────────
  // Было: регулярно и больше 30 минут без остановки → «неделя для начинающих тебе не нужна»,
  // без недели. Отменено [29.10.2026]. Утверждение сильнее прежнего: не «у бегуна есть
  // неделя» на одном примере, а у КАЖДОГО ответа без отметки про здоровье есть результат,
  // предложение недели и выдача, подходящая методике.
  {
    const paths: string[][] = [];
    const walk = (answers: TrialAnswers, codes: string[]) => {
      const q = questionPath(answers)[codes.length];
      if (q.id === "health") return void paths.push(codes);
      for (const o of q.options) walk({ ...answers, [q.key]: o.code }, [...codes, o.code]);
    };
    walk({}, []);
    assert.ok(paths.length > 3000, `путей ${paths.length}`);
    let runners = 0;
    let ladders = 0;
    for (const codes of paths) {
      let a: TrialAnswers = {};
      for (const c of codes) {
        const q = questionPath(a)[Object.keys(a).length];
        a = { ...a, [q.key]: c };
      }
      const out = testOutcome(a, HEALTH_NONE);
      assert.equal(out.kind, "result", `отказ на пути ${codes.join(",")}`);
      if (out.kind !== "result") continue;
      assert.ok(out.weeklyRuns === 2 || out.weeklyRuns === 3 || (out.weeklyRuns === 4 && out.startRung === null), "4 только у бегуна");
      if (out.startRung === null) {
        runners += 1;
        assert.ok(isRunnerTrack(a));
        const week = buildRunnerWeek(runnerInputFor(a)!);
        assert.equal(week.length, out.weeklyRuns, codes.join(","));
        const long = week.at(-1)!;
        assert.ok(long.kind === "long", codes.join(","));
        for (const x of week) if (x.kind === "easy") assert.ok(long.minutes > x.minutes, `длительная длиннее лёгкой: ${codes.join(",")}`);
        for (const x of week) if (x.kind !== "intervals") assert.ok(x.minutes >= 25 && x.minutes <= 110, codes.join(","));
        const q = week.filter((x) => x.kind === "intervals");
        // [29.10.2026] было: интервалы только при 3 пробежках. Теперь при любом числе, кроме дискомфорта.
        assert.equal(q.length, a.injury !== "now" ? 1 : 0, `интервалы: ровно одни без дискомфорта, ноль с ним (${codes.join(",")})`);
        // [29.10.2026] было: потолок 6 x 4 только у старта; теперь у всех, и размер только по опыту интервалов.
        if (q[0]?.kind === "intervals") assert.equal(q[0].step, a.intervals === "regularly" ? 2 : a.intervals === "sometimes" ? 1 : 0, codes.join(","));
      } else {
        ladders += 1;
        assert.ok(out.startRung >= 1 && out.startRung <= 7);
        assert.ok(a.goal === "start" || a.goal === "return" || !isRunnerTrack(a));
      }
      // Здоровье важнее всего на любом пути.
      assert.deepEqual(testOutcome(a, "heart"), { kind: "health_stop" });
    }
    assert.ok(runners > 0 && ladders > 0);
    // Через бота: ни одного отказа, у каждого карточка результата и «Да, веди».
    for (const codes of paths) {
      const env = setup({ now: msk("2026-11-02", "15:00") });
      await passTest(env, [...codes, HEALTH_NONE]);
      const u = env.mem.users.get(USER.id)!;
      assert.equal(u.stage, "result", `путь ${codes.join(",")}: ${u.stage}`);
      const texts = env.out.map((o) => o.text);
      assert.ok(texts.some((t) => t.startsWith("Твой результат: ")), codes.join(","));
      assert.equal(texts.at(-1), T.OFFER_WEEK, codes.join(","));
      assert.ok(!texts.some((t) => /не нужна|для начинающих|слишком лёгкой/.test(t)), `отказ в тексте: ${codes.join(",")}`);
      assert.equal(Object.keys(u.answers).length, codes.length, "здоровье в ответы не попадает");
    }
  }

  // ── неделя ─────────────────────────────────────────────────────────────────
  // 2026-11-02 — понедельник.
  assert.equal(isoWeekday("2026-11-02"), 1);
  for (const [code, p] of Object.entries(ALL_DAY_PATTERNS)) {
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
    T.INTRO_KB, T.NUDGE_KB, T.HEALTH_KB, T.OFFER_WEEK_KB, T.DECLINED_KB, T.chooseDaysKb(Object.keys(ALL_DAY_PATTERNS)),
    T.eveningKb(1), T.eveningKb(3), T.day4Kb("https://igorp.run/baza"), T.BASE_KB, T.BASE_YES_KB, T.FOLLOWUP_KB, T.CHANNEL_KB, T.TEXT_HINT_KB,
    ...Object.values(QUESTIONS).map((q) => T.questionKb(q)),
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
  // [29.10.2026] было «tr:a:<номер>:<вариант>»; номер на другом пути значил бы другой вопрос.
  assert.equal(parseTrialCallback("tr:a:1:0"), null, "кнопки старого вида больше не разбираются");
  assert.deepEqual(parseTrialCallback("tr:a:goal:3"), { kind: "answer", qid: "goal", index: 3 });
  assert.equal(parseTrialCallback("tr:a:goal:4"), null);
  assert.equal(parseTrialCallback("tr:a:nope:0"), null);
  assert.equal(parseTrialCallback("tr:a:__proto__:0"), null);
  // Код ведёт до 4 тренировок, значит в базе обязана быть миграция, расширяющая check-ограничения.
  // Выкатываются вместе: без неё запись 4-й тренировки упадёт на trial_bot_sessions_idx_check.
  {
    const mig = readFileSync(path.join(process.cwd(), "supabase/migrations/20261115000100_trial_bot_four_runs.sql"), "utf8");
    assert.ok(mig.includes("check (weekly_runs in (2, 3, 4))"), "миграция: weekly_runs до 4");
    assert.ok(mig.includes("check (idx between 1 and 4)"), "миграция: idx до 4");
    assert.equal(Math.max(...Object.values(ALL_DAY_PATTERNS).map((p) => p.runs)), 4, "наборы дней не длиннее, чем разрешает миграция");
    // Контракт с английской неделей: в DAY_PATTERNS только 2 и 3 дня, 4 живут в DAY_PATTERNS_4.
    assert.deepEqual([...new Set(Object.values(DAY_PATTERNS).map((p) => p.runs))].sort(), [2, 3]);
  }
  // [29.10.2026] было: 4-й тренировки не бывает, «tr:ci:4:ok» не разбиралась. Теперь до 4, пятой нет.
  assert.deepEqual(parseTrialCallback("tr:ci:4:ok"), { kind: "checkin", idx: 4, value: "ok" });
  assert.equal(parseTrialCallback("tr:ci:5:ok"), null);
  assert.equal(parseTrialCallback("tr:ci:0:ok"), null);
  assert.equal(parseTrialCallback("tr:ci:1:great"), null);
  assert.equal(parseTrialCallback("iv:new:1"), null);
  assert.equal(T.day4Kb(null).flat().some((b) => "url" in b), false, "без TRIAL_BASE_LANDING_URL кнопки «Подробнее» нет");
  assert.ok(T.BASE_YES_KB[0][0] && "url" in T.BASE_YES_KB[0][0] && T.BASE_YES_KB[0][0].url.includes("tool=trial"));
  assert.ok("url" in T.BASE_YES_KB[0][0] && decodeURIComponent(T.BASE_YES_KB[0][0].url).includes("Хочу в Базу после пробной недели"));

  // ── тексты без длинных тире ────────────────────────────────────────────────
  for (const [k, v] of Object.entries(T)) if (typeof v === "string") noEm(v, k);
  for (const q of Object.values(QUESTIONS)) { noEm(T.questionText(q, 2, 7), `вопрос ${q.id}`); q.options.forEach((o) => noEm(o.label, "вариант")); }
  for (const s of BEGINNER_LADDER) {
    const fb = fallbackWorkout(s.index);
    noEm(fb.title + fb.body, `запасной текст ступени ${s.index}`);
    assert.ok(!/перейдите|оцените|отметьте/.test(fb.body), "голос на «ты»");
    for (const type of ["clean_start", "too_fast", "no_system", "comeback"] as const) {
      noEm(T.resultCard(type, fb), type);
      noEm(T.resultCard(type, fb, ["a", "b"], true), type);
    }
    noEm(T.morningText(fb), "утро");
  }
  for (const n of [0, 1, 2, 3]) for (const y of [1, 2, 3]) noEm(T.day4Text(n, y), "день 4");
  // [правка текстов 28.10.2026] было «ты сделал(а) 2 из 3» и «больше, чем у большинства тех, кто
  // начинает с понедельника»: форма «(а)» убрана, сравнение без данных под ним снято.
  assert.match(T.day4Text(2, 3), /^Половина недели позади, и у тебя уже 2 из 3 тренировок\. Если хочешь/);
  for (const n of [1, 2, 3]) assert.ok(!/большинства|сделал/.test(T.day4Text(n, 3)), T.day4Text(n, 3));
  assert.match(T.day4Text(1, 1), /1 из 1 тренировки/);
  for (const a of [{ kind: "up", rung: 2 }, { kind: "same", rung: 1 }, { kind: "careful", rung: 1 }] as const) {
    noEm(T.day7Text(2, 1, { ok: 1, easy: 1, pain: 1 }, T.adviceText(a, "x")), "день 7");
    noEm(T.day7Text(0, 0, {}, T.restartStep("x")), "день 7, ноль");
  }
  for (const a of [{ kind: "up", nextIntervals: "6 x 4 мин" }, { kind: "up", nextIntervals: null }, { kind: "same" }, { kind: "careful" }] as const) {
    noEm(T.day7Text(2, 0, { ok: 2 }, T.runnerAdviceText(a)), "день 7 бегуна");
  }
  assert.equal(T.runnerAdviceText({ kind: "up", nextIntervals: "6 x 4 мин" }), "чуть больше работы, интервалы 6 x 4 мин, и длительная на 5-10 минут дольше");
  // [решение Игоря 28.10.2026] пробежки и прогулки считаются отдельно. Было: «3 тренировки» вместе с ходьбой.
  assert.equal(T.doneLine(2, 1), "2 пробежки и 1 прогулка");
  assert.equal(T.doneLine(3, 0), "3 пробежки");
  assert.equal(T.doneLine(1, 0), "1 пробежка");
  assert.equal(T.doneLine(0, 1), "1 прогулка");
  assert.equal(T.doneLine(1, 2), "1 пробежка и 2 прогулки");
  assert.equal(T.doneLine(5, 0), "5 пробежек");
  assert.match(T.day7Text(3, 0, { easy: 1, ok: 2 }, T.adviceText({ kind: "up", rung: 2 }, "5 x 5 мин бег / 2 мин шаг")), /^Неделя закончилась\. Итог: 3 пробежки, по ощущениям легко 1, нормально 2\. Следующий шаг для тебя: немного добавить бега, следующая тренировка будет чуть длиннее: 5 x 5 мин бег \/ 2 мин шаг\. Дальше можем идти вместе в Базе\.$/);
  for (const c of ["easy", "ok", "hard", "miss", "pain"] as const) { noEm(T.CHECKIN_REPLIES[c], c); noEm(T.eveningAnswered(c), c); }
  // [правка текстов 28.10.2026] «В следующий раз чуть прибавим» после одной «Легко» было неправдой:
  // planNext прибавляет только после двух чистых подряд. «Больше шага» после «Тяжело» было
  // неправдой на первой ступени, где облегчать некуда. Ответы обещают только то, что делает логика.
  assert.equal(T.CHECKIN_REPLIES.easy, "Отлично. Если и дальше будет легко, прибавим.");
  assert.ok(!/следующий раз чуть прибавим/.test(T.CHECKIN_REPLIES.easy));
  assert.ok(!/больше шага/.test(T.CHECKIN_REPLIES.hard) && T.CHECKIN_REPLIES.hard.includes("Прибавлять не будем."), T.CHECKIN_REPLIES.hard);
  assert.deepEqual(planNext(1, [{ planned: { kind: "rung", rung: 1 }, checkin: "hard" }]), { kind: "rung", rung: 1 }, "тяжело на первой: не прибавляем");
  assert.deepEqual(planNext(1, [{ planned: { kind: "rung", rung: 1 }, checkin: "easy" }]), { kind: "rung", rung: 1 }, "одна «Легко» ещё не прибавка");
  // Ноль тренировок за неделю: без выдуманной статистики («почти у всех, кто начинает без поддержки»).
  assert.ok(T.day7Text(0, 0, {}, T.restartStep("x")).startsWith("Неделя закончилась. Итог: в этот раз тренировки не сложились. Так бывает, это не приговор."));
  assert.equal(T.FOLLOWUP_10, "Самое трудное начинается, когда пропадает новизна. В Базе я рядом каждую неделю, чтобы бег не бросить.", "без «третья неделя» и без «(а)»");
  // Ни одного «(а)»/«(ась)» в том, что видит человек: тексты, вопросы, варианты, заготовки сообщений.
  // Тексты тренеру (coachHealth/coachPain/coachBase) не проверяются: их читает Игорь, не участник.
  {
    const userFacing = Object.entries(T).filter(([k, v]) => typeof v === "string" && !k.startsWith("coach")).map(([, v]) => v as string);
    userFacing.push(...Object.values(T.CHECKIN_REPLIES), T.nudgeText(3), T.CASE_MARINA.text, T.CASE_ANNA.text, T.CASE_NADYA.text, T.CASE_SASHA.text, T.FOLLOWUP_10);
    for (const q of Object.values(QUESTIONS)) userFacing.push(q.text, ...q.options.map((o) => o.label));
    for (const n of [0, 1, 2]) userFacing.push(T.day4Text(n, 3));
    for (const t of userFacing) assert.ok(!/\((а|ась|ла|ён|на)\)/.test(t), `форма «(а)» в тексте: ${t}`);
    // [29.10.2026] Анкета без прошедшего времени с родом («бегал», «пробегал», «был готов»):
    // вопросы и варианты читают все. Множественное «были» нейтрально и разрешено.
    for (const q of Object.values(QUESTIONS)) {
      for (const t of [q.text, ...q.options.map((o) => o.label)]) {
        assert.ok(!/(^|[^А-Яа-яЁё])[А-Яа-яЁё]{2,}(ал|ял|ил|ыл|ел|ала|яла|ила|ыла|ела|лся|лась)(?=[^А-Яа-яЁё]|$)/i.test(t), `род в анкете: ${t}`);
        assert.ok(!/(^|[^А-Яа-яЁё])(готов|готова|рад|рада)(?=[^А-Яа-яЁё]|$)/i.test(t), `род в анкете: ${t}`);
        assert.ok(!/(^|[^А-Яа-яЁё])(вы|вас|вам|ваш)/i.test(t), `«вы» в анкете: ${t}`);
      }
    }
  }
  assert.equal(T.PREFILL_HEALTH, "Привет! Я из теста в боте, хочу обсудить нагрузку с учётом здоровья");
  // Кнопки теста влезают в экран телефона: было «Боль в груди или головокружение при нагрузке» (44 знака).
  for (const q of Object.values(QUESTIONS)) for (const o of q.options) assert.ok(o.label.length <= 30, `кнопка длиннее 30 знаков: ${o.label}`);
  // Вопрос про здоровье не менялся: текст, варианты и коды прежние.
  assert.equal(QUESTIONS.health.text, "Последний вопрос, важный. Есть ли что-то из этого?");
  assert.deepEqual(QUESTIONS.health.options.map((o) => [o.code, o.label]), [
    ["heart", "Сердце или давление"], ["chest", "Боль в груди, головокружение"], ["injury", "Травма или боль сейчас"], ["pregnant", "Беременность"], [HEALTH_NONE, "Ничего из этого"],
  ]);
  // Приветствие [29.10.2026, правка Игоря]: было «почему бег у тебя не держится».
  assert.equal(T.INTRO, "Привет, это Игорь, тренер по бегу. За 2 минуты разберёмся, почему нет прогресса в беге, и я дам тебе неделю тренировок бесплатно. Начинаем?");
  assert.ok(!T.INTRO.includes("не держится"));
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
  // [правка текстов 28.10.2026] было: «усилие 2-4» и «оцени усилие, от этой оценки» в голосе бота.
  // «Ступень», «оценка усилия» новичку непонятны, а кнопки спрашивают легко/нормально/тяжело;
  // «усилие 2-4» дублировало утреннее «Главное правило». Теперь жаргона нет ВООБЩЕ.
  assert.ok(voiced.includes("напиши мне"), voiced);
  assert.ok(voiced.includes("отметь, как прошло: легко, нормально или тяжело. От этого зависит следующая тренировка."), voiced);
  assert.ok(voiced.includes("только ощущения: дыхание ровное, можно говорить полными фразами."), voiced);
  const JARGON = /ступен|оцени|оценк|усили|по шкале|тренеру/i;
  assert.ok(!JARGON.test(voiced), `жаргон в тексте бота: ${voiced}`);
  for (const s of BEGINNER_LADDER) {
    const body = fallbackWorkout(s.index).body;
    assert.ok(!JARGON.test(body), `жаргон в запасном тексте ступени ${s.index}: ${body}`);
    assert.ok(body.includes("легко, нормально или тяжело"), `ступень ${s.index}: просьба отметить, как прошло`);
    if (s.kind === "continuous") assert.ok(body.includes("отметь «Тяжело»: следующая тренировка будет легче."), body);
    // В утреннем сообщении правило про усилие ровно одно.
    assert.equal(T.morningText(fallbackWorkout(s.index)).match(/усилие/g)?.length, 1, `ступень ${s.index}: «усилие» один раз`);
  }
  const lib: LibraryRows = new Map([["rw_5x4_2walk", { title: "5 x 4 мин бег / 2 мин шаг", body: libText }]]);
  assert.equal(workoutFor({ kind: "rung", rung: 1 }, lib).body, voiced, "текст из библиотеки");
  assert.equal(workoutFor({ kind: "rung", rung: 1 }, new Map()).body, fallbackWorkout(1).body, "сбой библиотеки: текст методики");
  assert.equal(workoutFor({ kind: "rung", rung: 1 }, new Map()).presetCode, "rw_5x4_2walk");

  // ── сценарий: тест → результат → неделя → утро/вечер → день 4 → итог → База ──
  {
    const env = setup({ now: msk("2026-11-02", "15:00"), library: lib });
    // «Начать бегать», «Почти не бегаю», «Меньше 5 минут», «3 раза», травм не было, здоровье «Ничего».
    await passTest(env, START_LT5);
    const u = env.mem.users.get(USER.id)!;
    assert.equal(u.stage, "result");
    assert.equal(u.result_type, "clean_start");
    assert.equal(u.start_rung, 1);
    assert.equal(u.weekly_runs, 3);
    assert.equal(u.first_source, "reel12");
    assert.equal(u.health_flag, false);
    assert.deepEqual(Object.keys(u.answers).sort(), ["can_run", "days", "goal", "injury", "now_running"], "вопрос про здоровье в ответы не попадает");
    const sends = env.out.filter((o) => o.method === "send").map((o) => o.text);
    assert.equal(sends[0], T.INTRO);
    const card = sends.find((t) => t.startsWith("Твой результат: Чистый старт"))!;
    assert.ok(card && card.includes("Первая тренировка: 5 x 4 мин бег / 2 мин шаг") && card.includes("Шаг: это отдых"), card);
    assert.ok(!card.includes("Твоя неделя:"), "у лестницы списка недели нет: она растёт по отметкам");
    assert.equal(sends[sends.length - 1], T.OFFER_WEEK);
    const edits = env.out.filter((o) => o.method === "edit").map((o) => o.text);
    assert.ok(edits.includes("Вопрос 1\n\nКакая у тебя цель?"), "первый вопрос без «из»: длина пути ещё не известна");
    assert.ok(edits.includes("Вопрос 2 из 6\n\nКак сейчас с бегом?"), "вопросы правят одно сообщение");
    assert.ok(edits.includes("Вопрос 3 из 6\n\nСколько сейчас можешь пробежать без остановки?"));

    // старая кнопка вопроса ничего не ломает
    await press(env, btn("canrun", "gt30"));
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
    // [правка текстов 28.10.2026] было «сделал(а) 2 из 2»: формы «(а)» больше нет.
    assert.ok(d4s[0].text.includes("у тебя уже 2 из 2 тренировок") && !d4s[0].text.includes("(а)"), d4s[0].text);
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
    await passTest(env, ["start", "rarely", "lt5", "2", "none", "pregnant"]);
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

  // ── бегает регулярно: неделя бегуна, а не отказ ─────────────────────────────
  // Было [до 29.10.2026]: stage already_runner, текст «неделя для начинающих тебе не нужна», без
  // «Да, веди». Отменено по правке Игоря: продукт для любого уровня. Держим сильнее: у бегуна
  // полная неделя по методике (лёгкий, интервалы, длительная), утро с правильным правилом,
  // поправка после «Тяжело», итог со своим советом.
  {
    const env = setup({ now: msk("2026-11-02", "15:00") });
    await passTest(env, ["regular", "15_30", "10_15", "sometimes", "4", "none", HEALTH_NONE]);
    const u = env.mem.users.get(USER.id)!;
    assert.equal(u.stage, "result", "не already_runner");
    assert.equal(u.result_type, "too_fast");
    assert.equal(u.start_rung, null, "лестница не нужна");
    assert.equal(u.weekly_runs, 4, "«4 и больше»: бот ведёт 4 (было 3)");
    const card = env.out.find((o) => o.text.startsWith("Твой результат: Всё в одном темпе"))!;
    assert.ok(card, "карточка результата");
    assert.ok(card.text.includes("Твоя неделя:\n1. Лёгкий бег 40 минут\n2. Интервалы 5 x 4 мин через 1:30 шагом\n3. Лёгкий бег 40 минут\n4. Длительная 75 минут\n"), card.text);
    assert.ok(card.text.includes("Я веду 4 главные тренировки недели. Если бегаешь чаще, в остальные дни только спокойный лёгкий бег."));
    assert.ok(card.text.includes("Первая тренировка: Лёгкий бег 40 минут\nОсновная часть: 40 минут лёгкого бега."), card.text);
    assert.equal(env.out.at(-1)!.text, T.OFFER_WEEK);
    assert.ok(!env.out.some((o) => /не нужна|для начинающих/.test(o.text)));

    await press(env, "tr:wk:y");
    assert.deepEqual(env.out.at(-1)!.kb!.flat().map((b) => b.text), ["Вт Чт Сб Вс", "Пн Ср Пт Вс", "Вт Ср Пт Вс"], "наборы на 4 дня, те же дни, что у английской недели");
    await press(env, "tr:days:m3b"); // набор на 3 при недели на 4: игнор
    assert.equal(env.mem.users.get(USER.id)!.stage, "choose_days");
    await press(env, "tr:days:m4b"); // Пн Ср Пт Вс: ср 4, пт 6, вс 8, пн 9
    const rows = env.mem.sessions.get(USER.id)!;
    assert.deepEqual(rows.map((r) => [r.idx, r.scheduled_date, r.preset_code, r.rung]), [
      [1, "2026-11-04", "easy_continuous", null], [2, "2026-11-06", "trial_int_5x4", null], [3, "2026-11-08", "easy_continuous", null], [4, "2026-11-09", "long_aerobic", null],
    ], "план недели записан заранее, 4 тренировки");
    for (const [d, idx, c] of [["2026-11-04", 1, "easy"], ["2026-11-06", 2, "hard"], ["2026-11-08", 3, "ok"], ["2026-11-09", 4, "ok"]] as const) {
      env.setNow(msk(d, "08:11"));
      await env.bot.runTick();
      env.setNow(msk(d, "19:11"));
      await env.bot.runTick();
      await press(env, `tr:ci:${idx}:${c}`);
    }
    const mornings = env.out.filter((o) => o.text.startsWith("Доброе утро!")).map((o) => o.text);
    assert.equal(mornings.length, 4);
    assert.ok(mornings[0].startsWith("Доброе утро! Сегодня тренировка: Лёгкий бег 40 минут.") && mornings[0].endsWith(T.EASY_RULE));
    assert.ok(mornings[1].startsWith("Доброе утро! Сегодня тренировка: Интервалы 5 x 4 мин через 1:30 шагом."), mornings[1]);
    assert.ok(mornings[1].includes("Разминка: 12 минут лёгкого бега") && mornings[1].includes("Основная часть: 5 отрезков по 4 минуты, усилие 6 из 10") && mornings[1].includes("Между отрезками 1:30 шагом") && mornings[1].includes("Заминка: 10 минут"), mornings[1]);
    assert.ok(mornings[1].endsWith(T.INTERVALS_RULE), "у интервалов своё правило");
    assert.equal(mornings[1].match(/усилие/g)?.length, 1, "«усилие» один раз: в отрезке");
    assert.ok(!mornings[1].includes("2-4"), "под отрезки на 6 из 10 нет «2-4»");
    // «Тяжело» на интервалах: следующая лёгкая на пятую часть короче (40 → 30, кратно 5);
    // после «Нормально» длительная снова по плану.
    assert.ok(mornings[2].startsWith("Доброе утро! Сегодня тренировка: Лёгкий бег 30 минут."), mornings[2]);
    assert.ok(mornings[3].startsWith("Доброе утро! Сегодня тренировка: Длительная 75 минут."), mornings[3]);
    assert.equal(env.mem.sessions.get(USER.id)![2].title, "Лёгкий бег 30 минут");
    env.setNow(msk("2026-11-10", "19:11"));
    await env.bot.runTick();
    const summary = env.out.find((o) => o.text.startsWith("Неделя закончилась."))!;
    assert.ok(summary, "итог дня 7");
    assert.ok(summary.text.includes("Итог: 4 пробежки, по ощущениям легко 1, нормально 2, тяжело 1. Следующий шаг для тебя: повторить эту неделю без прибавки, чтобы тело её освоило."), summary.text);
  }
  {
    // К старту, 10 км, дискомфорт: интервалов нет совсем, длительная под дистанцию; боль → ходьба.
    const env = setup({ now: msk("2026-11-02", "15:00") });
    await passTest(env, ["race", "10k", "t2", "30_50", "regularly", "3", "now", HEALTH_NONE]);
    const u = env.mem.users.get(USER.id)!;
    assert.equal(u.stage, "result");
    assert.equal(u.result_type, "no_system");
    assert.equal(u.start_rung, null);
    const card = env.out.find((o) => o.text.startsWith("Твой результат: Нет системы"))!;
    assert.ok(card.text.includes("Твоя неделя:\n1. Лёгкий бег 45 минут\n2. Лёгкий бег 45 минут\n3. Длительная 90 минут\n"), card.text);
    assert.ok(!card.text.includes("Интервалы"), "при дискомфорте без работы на скорость");
    await press(env, "tr:wk:y");
    await press(env, "tr:days:m3a"); // ср 4, сб 7, пн 9
    for (const [d, idx, c] of [["2026-11-04", 1, "pain"], ["2026-11-07", 2, "ok"], ["2026-11-09", 3, "ok"]] as const) {
      env.setNow(msk(d, "08:11"));
      await env.bot.runTick();
      env.setNow(msk(d, "19:11"));
      await env.bot.runTick();
      await press(env, `tr:ci:${idx}:${c}`);
    }
    assert.equal(env.out.filter((o) => o.text === T.MORNING_WALK).length, 1, "после боли ходьба");
    assert.equal(env.out.filter((o) => o.chatId === "999" && o.text.includes("«Что-то болело»")).length, 1, "тренеру про боль");
    env.setNow(msk("2026-11-10", "19:11"));
    await env.bot.runTick();
    const summary = env.out.find((o) => o.text.startsWith("Неделя закончилась."))!;
    assert.ok(summary.text.includes("Итог: 2 пробежки и 1 прогулка") && summary.text.includes("сначала убедиться, что ничего не болит, и повторить неделю без прибавки и без интервалов"), summary.text);
  }
  {
    // Регулярно, без замечаний: «Легко/Нормально» всю неделю → совет прибавить интервалы.
    const env = setup({ now: msk("2026-11-02", "15:00") });
    await passTest(env, ["regular", "30_50", "15_21", "regularly", "3", "past", HEALTH_NONE]);
    assert.deepEqual(env.mem.users.get(USER.id)!.start_rung, null);
    await press(env, "tr:wk:y");
    await press(env, "tr:days:m3a");
    for (const [d, idx] of [["2026-11-04", 1], ["2026-11-07", 2], ["2026-11-09", 3]] as const) {
      env.setNow(msk(d, "08:11"));
      await env.bot.runTick();
      env.setNow(msk(d, "19:11"));
      await env.bot.runTick();
      await press(env, `tr:ci:${idx}:ok`);
    }
    assert.ok(env.out.some((o) => o.text.startsWith("Доброе утро! Сегодня тренировка: Интервалы 6 x 4 мин через 1:30 шагом.")), "регулярно и 30-50 км: 6 x 4, не 7 x 4 (потолок у всех)");
    env.setNow(msk("2026-11-10", "19:11"));
    await env.bot.runTick();
    const summary = env.out.find((o) => o.text.startsWith("Неделя закончилась."))!;
    assert.ok(summary.text.includes("чуть больше работы, интервалы 7 x 4 мин, и длительная на 5-10 минут дольше"), summary.text);
  }
  {
    // Регулярно, но до 5 км в неделю: лестница бега с шагом (ступень 6), не отказ и не интервалы.
    const env = setup({ now: msk("2026-11-02", "15:00") });
    await passTest(env, ["regular", "0_5", "3_5", "easy_only", "2", "none", HEALTH_NONE]);
    const u = env.mem.users.get(USER.id)!;
    assert.equal(u.stage, "result");
    assert.equal(u.start_rung, 6);
    assert.ok(env.out.some((o) => o.text.startsWith("Твой результат: Нет системы") && o.text.includes("Первая тренировка: 25 мин лёгкого непрерывного бега")));
  }
  {
    // Возвращение после полугода, 5 км: ступень 2, без интервалов.
    const env = setup({ now: msk("2026-11-02", "15:00") });
    await passTest(env, ["return", "6m_plus", "5k", "4", "none", HEALTH_NONE]);
    const u = env.mem.users.get(USER.id)!;
    assert.equal(u.start_rung, 2);
    assert.equal(u.weekly_runs, 3);
    assert.ok(env.out.some((o) => o.text.startsWith("Твой результат: Возвращение") && o.text.includes("Первая тренировка: 5 x 5 мин бег / 2 мин шаг")));
  }

  // ── тексты недели бегуна: эталоны тренера и запасной текст ────────────────────
  {
    for (const sess of [{ kind: "easy", minutes: 40 }, { kind: "long", minutes: 75 }, ...TRIAL_INTERVAL_LADDER.map((_, step) => ({ kind: "intervals", step }))] as RunnerSession[]) {
      const w = runnerWorkout(sess, new Map());
      noEm(w.title + w.body, `неделя бегуна ${w.presetCode}`);
      assert.ok(!/(^|[^А-Яа-яЁё])(вы|вас|вам|ваш)|\p{L}+(ете|ите|йте|ьте)(?=[^А-Яа-яЁё]|$)/iu.test(w.body), `«вы» в тексте бегуна: ${w.body}`);
      assert.ok(!/\d:\d\d\s*[-–—]\s*\d/.test(w.body), "темпов в тексте нет");
      noEm(T.morningText(w, false, sess.kind === "intervals"), "утро бегуна");
    }
    // 5 x 3 с отдыхом 2 минуты [29.10.2026, Игорь]; было 3 x 3 через минуту.
    assert.equal(runnerWorkout({ kind: "intervals", step: 0 }, new Map()).title, "Интервалы 5 x 3 мин через 2 мин шагом");
    assert.ok(runnerWorkout({ kind: "intervals", step: 0 }, new Map()).body.includes("Основная часть: 5 отрезков по 3 минуты, усилие 6 из 10") && runnerWorkout({ kind: "intervals", step: 0 }, new Map()).body.includes("Между отрезками 2 минуты шагом"));
    assert.ok(runnerWorkout({ kind: "intervals", step: 2 }, new Map()).body.includes("Разминка: 12 минут") && runnerWorkout({ kind: "intervals", step: 2 }, new Map()).body.includes("Заминка: 10 минут"));
    assert.equal(usableEtalon("Разговорный темп: можете говорить предложениями. Если тяжело дышать, сбавьте."), null, "эталон на «вы» не берём");
    assert.equal(usableEtalon("Держи 6:10 на километр"), null, "эталон с числом не берём");
    assert.equal(usableEtalon("Спокойно — можно говорить."), "Спокойно, можно говорить.");
    const lib: LibraryRows = new Map([
      [stepRowKey("easy_main_street"), { title: null, body: "Совсем спокойно, нос дышит." }],
      [stepRowKey("long_main_street"), { title: null, body: "Сбавьте, если тяжело." }],
      [stepRowKey("warmup_easy"), { title: null, body: "Очень спокойно" }],
    ]);
    assert.equal(runnerWorkout({ kind: "easy", minutes: 30 }, lib).body, "Основная часть: 30 минут лёгкого бега. Совсем спокойно, нос дышит.", "живой эталон тренера");
    assert.ok(runnerWorkout({ kind: "long", minutes: 60 }, lib).body.endsWith("что можешь ещё."), "эталон на «вы»: запасной текст");
    assert.ok(runnerWorkout({ kind: "intervals", step: 0 }, lib).body.startsWith("Разминка: 12 минут лёгкого бега, очень спокойно.\n"), "после запятой со строчной и с точкой");
  }

  // ── «Пока только посмотрю», напоминание в тесте, 403 ────────────────────────
  {
    const env = setup({ now: msk("2026-11-02", "15:00") });
    await passTest(env, START_5_30_TWO);
    // [29.10.2026] было «5-15 минут» → ступень 3; варианта больше нет, «5-30» без сдвига → 4.
    assert.equal(env.mem.users.get(USER.id)!.start_rung, 4);
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
    await press(env, btn("goal", "start"));
    await press(env, btn("nowrun", "rarely"));
    env.setNow(msk("2026-11-02", "13:11"));
    env.out.length = 0;
    await env.bot.runTick();
    env.setNow(msk("2026-11-02", "13:41"));
    await env.bot.runTick();
    env.setNow(msk("2026-11-02", "14:11"));
    await env.bot.runTick();
    // [правка текстов 28.10.2026] было «Ты остановился(ась) на вопросе 3»: без рода.
    const nudges = env.out.filter((o) => o.text.startsWith("Тест ждёт тебя"));
    assert.equal(nudges.length, 1, "напоминание один раз");
    assert.equal(nudges[0].text, "Тест ждёт тебя на вопросе 3, осталось меньше минуты.");
    await press(env, "tr:cont");
    assert.equal(env.out.at(-1)!.text, T.questionText(QUESTIONS.canrun, 3, 6));
  }
  {
    // Человек начал тест до 29.10.2026 (ответы старого вида, без цели): «Продолжить» начинает с цели.
    const env = setup({ now: msk("2026-11-02", "10:00") });
    await env.mem.store.saveUser({ telegram_user_id: USER.id, chat_id: USER.id, stage: "test", test_q: 3, answers: { q1: "no", q2: "lt5" } as TrialAnswers });
    await press(env, "tr:cont");
    assert.equal(env.out.at(-1)!.text, T.questionText(QUESTIONS.goal, 1, null));
    assert.equal(env.mem.users.get(USER.id)!.test_q, 1);
    assert.deepEqual(env.mem.users.get(USER.id)!.answers, {});
    await press(env, btn("goal", "race"));
    assert.equal(env.out.at(-1)!.text, T.questionText(QUESTIONS.dist, 2, 8));
    await press(env, btn("goal", "start"));
    assert.equal(env.mem.users.get(USER.id)!.answers.goal, "race", "повторная кнопка цели не меняет путь");
  }
  {
    const blocked = new Set<string>();
    const env = setup({ now: msk("2026-11-02", "15:00"), blocked });
    await passTest(env, START_LT5);
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
    await passTest(env, START_LT5);
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
      isActiveStudent: async () => false,
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
    await passTest(env, START_LT5);
    await press(env, "tr:wk:y");
    await press(env, "tr:days:m3a");
    env.setNow(msk("2026-11-05", "10:00"));
    await env.bot.handleStart({ from: USER, chatId: USER.id, source: "reel99" });
    assert.equal(env.mem.users.get(USER.id)!.stage, "week");
    assert.equal(env.out.at(-1)!.text, T.alreadyInWeek("2026-11-07"));
    assert.equal(env.mem.users.get(USER.id)!.first_source, "reel12", "первый источник не перетирается");
  }

  // ── действующий ученик по ссылке пробной недели [решение Игоря 28.10.2026] ──
  // Раньше ученик проходил тот же путь, что и лид из рилса: тест, неделя, оферы Базы.
  // Теперь: ровно один ответ без кнопок, строки участника нет, за две недели тиков ни звука.
  {
    const env = setup({ now: msk("2026-11-02", "10:00"), students: new Set([USER.id]) });
    await env.bot.handleStart({ from: USER, chatId: USER.id, source: "reel12" });
    assert.equal(env.out.length, 1, "ученику один ответ");
    assert.equal(env.out[0].text, T.ALREADY_STUDENT);
    assert.equal(env.out[0].text, "Ты уже тренируешься со мной, пробная неделя тебе не нужна. Если есть вопрос, просто напиши мне.");
    assert.equal(env.out[0].kb, undefined, "без кнопок: ни теста, ни оферов");
    assert.equal(env.mem.users.has(USER.id), false, "строка участника не заводится");
    assert.ok(env.mem.events.some((e) => e.kind === "already_student"));
    noEm(T.ALREADY_STUDENT, "ученику");
    // Повторный тап: снова один короткий ответ, теста нет.
    await env.bot.handleStart({ from: USER, chatId: USER.id, source: "reel13" });
    assert.deepEqual(env.out.map((o) => o.text), [T.ALREADY_STUDENT, T.ALREADY_STUDENT]);
    await tickDays(env, "2026-11-02", 14);
    assert.equal(env.out.length, 2, "тик ученику ничего не шлёт");
  }
  {
    // Человек был в пробной неделе и стал учеником: тап по ссылке закрывает неделю, дальше тишина.
    const env = setup({ now: msk("2026-11-02", "15:00") });
    await passTest(env, START_LT5);
    await press(env, "tr:wk:y");
    await press(env, "tr:days:m3a");
    assert.equal(env.mem.users.get(USER.id)!.stage, "week");
    const env2 = { ...env, bot: createTrialBot({
      store: env.mem.store,
      tg: { async send(chatId, text, kb) { env.out.push({ chatId: String(chatId), text, kb, method: "send" }); return 1; }, async edit() {}, async answer() {}, async sendPhoto(chatId, _u, caption) { env.out.push({ chatId: String(chatId), text: caption ?? "", method: "photo" }); return 1; } },
      now: () => msk("2026-11-02", "16:00"),
      library: async () => new Map(),
      coachChatId: null,
      landingUrl: null,
      isActiveStudent: async () => true,
    }) };
    env.out.length = 0;
    await env2.bot.handleStart({ from: USER, chatId: USER.id, source: "reel12" });
    assert.deepEqual(env.out.map((o) => o.text), [T.ALREADY_STUDENT], "вместо «Ты уже в пробной неделе» ответ ученику");
    assert.equal(env.mem.users.get(USER.id)!.stage, "done");
    await tickDays(env, "2026-11-03", 14);
    assert.equal(env.out.length, 1, "после этого ни утра, ни оферов");
  }
  {
    // Сбой проверки «ученик ли»: вход обычным путём, лид из рилса не теряется.
    const env = setup({ now: msk("2026-11-02", "10:00"), students: "throw" });
    await env.bot.handleStart({ from: USER, chatId: USER.id, source: "reel12" });
    assert.equal(env.out.at(-1)!.text, T.INTRO);
    assert.equal(env.mem.users.get(USER.id)!.stage, "intro");
  }
  {
    // Не ученик: обычный путь, проверка не мешает.
    const env = setup({ now: msk("2026-11-02", "10:00"), students: new Set([777]) });
    await env.bot.handleStart({ from: USER, chatId: USER.id, source: "reel12" });
    assert.equal(env.out.at(-1)!.text, T.INTRO);
  }

  // ── истории учеников: Марина день 2, Аня день 5, Надя после дожима дня 8, Саша после дня 10, все с фото ──
  // [28.10.2026] Лену (без фото) заменила Аня Кукушкина по решению Игоря; фото Ани, Нади и Саши прислал он же.
  {
    const stories = { marina: T.CASE_MARINA, anna: T.CASE_ANNA, nadya: T.CASE_NADYA, sasha: T.CASE_SASHA };
    for (const [k, c] of Object.entries(stories)) {
      noEm(c.text, `история ${k}`);
      assert.ok(c.text.length <= T.CAPTION_LIMIT, `подпись ${k} влезает в 1024`);
    }
    assert.ok(T.CASE_MARINA.text.startsWith("Расскажу про Марину.") && T.CASE_MARINA.text.endsWith("Ровно то, что ты делаешь на этой неделе."));
    assert.ok(T.CASE_MARINA.text.includes("не любит.\n\nПервое") && T.CASE_MARINA.text.includes("48:09, минус 14 минут."));
    assert.equal(T.CASE_MARINA.photoUrl, "https://igorp.run/landing/16-review-marina.jpg");
    // [28.10.2026] Лену заменила Аня; концовка в нейтральной по роду формулировке из правки текстов того же дня.
    assert.ok(T.CASE_ANNA.text.startsWith("Ещё одна история, Аня. В мае она пробежала полумарафон за 2:03:57.") && T.CASE_ANNA.text.includes("с 49:59 до 47:02") && T.CASE_ANNA.text.endsWith("кто-то следит, чтобы не было перегруза."));
    assert.equal(T.CASE_NADYA.text, "Надя в сентябре 2025 пробежала полумарафон за 1:51:54. Через 11 месяцев за 1:39:29: минус 12 минут на той же дистанции.");
    assert.equal(T.CASE_SASHA.text, "Саша в ноябре пробежал 5 км за 26:35. В феврале уже за 22:49: почти 4 минуты за два месяца.");
    // Было: фото Нади и Саши null («пришлёт позже»). Теперь у всех четырёх историй фото, адреса фиксируем.
    assert.equal(T.CASE_ANNA.photoUrl, "https://igorp.run/landing/cases/anna-kukushkina.jpg");
    assert.equal(T.CASE_NADYA.photoUrl, "https://igorp.run/landing/cases/nadya-ponomareva.jpg");
    assert.equal(T.CASE_SASHA.photoUrl, "https://igorp.run/landing/cases/sasha-lavrentyev.jpg");

    for (const photoFails of [false, true]) {
      const env = setup({ now: msk("2026-11-02", "15:00"), photoFails });
      await passTest(env, START_LT5);
      await press(env, "tr:wk:y");
      await press(env, "tr:days:m3a"); // неделя с ср 4 ноября: день 2 = чт 5, день 5 = вс 8
      env.out.length = 0;
      for (const [d, t] of [["2026-11-05", "13:11"], ["2026-11-05", "13:41"], ["2026-11-05", "17:41"], ["2026-11-08", "12:11"], ["2026-11-08", "13:11"], ["2026-11-08", "16:41"], ["2026-11-09", "13:11"], ["2026-11-09", "16:41"]] as const) {
        env.setNow(msk(d, t));
        await env.bot.runTick();
        await env.bot.runTick();
      }
      const photos = env.out.filter((o) => o.method === "photo");
      const texts = env.out.filter((o) => o.method === "send" && (o.text === T.CASE_MARINA.text || o.text === T.CASE_ANNA.text));
      if (!photoFails) {
        // Было: Лена без фото уходила текстом. Теперь обе истории недели фото с подписью, текстом ничего.
        assert.deepEqual(photos.filter((p) => p.photo === T.CASE_MARINA.photoUrl || p.photo === T.CASE_ANNA.photoUrl).map((p) => [p.photo, p.text]), [[T.CASE_MARINA.photoUrl, T.CASE_MARINA.text], [T.CASE_ANNA.photoUrl, T.CASE_ANNA.text]], "Марина и Аня фото с подписью, по одному разу");
        assert.deepEqual(texts.map((t) => t.text), [], "истории с фото не дублируются текстом");
      } else {
        assert.equal(photos.length, 0);
        assert.deepEqual(texts.map((t) => t.text), [T.CASE_MARINA.text, T.CASE_ANNA.text], "фото не принято: только текст, один раз");
      }
      // Дожимы дня 8 и 10: сначала дожим, следом история отдельным сообщением.
      for (const [d, t] of [["2026-11-11", "10:00"], ["2026-11-11", "12:11"], ["2026-11-11", "12:41"], ["2026-11-13", "12:11"], ["2026-11-13", "17:41"]] as const) {
        env.setNow(msk(d, t));
        await env.bot.runTick();
      }
      // Надя и Саша теперь с фото: подпись фото = текст истории, поэтому порядок проверяем по send и photo вместе.
      const sent = env.out.filter((o) => o.method === "send" || o.method === "photo").map((o) => o.text);
      const i8 = sent.indexOf(T.FOLLOWUP_8);
      const i10 = sent.indexOf(T.FOLLOWUP_10);
      assert.ok(i8 >= 0 && sent[i8 + 1] === T.CASE_NADYA.text, "Надя сразу после дожима дня 8");
      assert.ok(i10 >= 0 && sent[i10 + 1] === T.CASE_SASHA.text, "Саша сразу после дожима дня 10");
      assert.equal(sent.filter((x) => x === T.CASE_NADYA.text).length, 1);
      assert.equal(sent.filter((x) => x === T.CASE_SASHA.text).length, 1);
    }
    // «Пока только посмотрю»: историй нет
    const env = setup({ now: msk("2026-11-02", "15:00") });
    await passTest(env, START_LT5);
    await press(env, "tr:wk:n");
    env.out.length = 0;
    env.setNow(msk("2026-11-05", "13:11"));
    await env.bot.runTick();
    assert.equal(env.out.length, 0);
  }

  // ── неделя с сегодня: первая тренировка сразу, тик её не повторяет ──────────
  {
    const env = setup({ now: msk("2026-11-02", "10:00") });
    await passTest(env, START_LT5);
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
    await passTest(env, RETURN_3_6M);
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
