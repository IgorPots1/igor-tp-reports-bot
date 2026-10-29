/* Пробная неделя в основном боте (вход из рилсов): чистая логика без сети и без базы.
 *
 * Здесь: разбор deep link, анкета по цели, классификация результата, сборка недели,
 * прогрессия по отметкам «как прошло» и решение «что отправить сейчас». Неделя бегуна
 * (лёгкий, интервалы, длительная) отдельно, в runner-week.ts. Всё
 * детерминировано и проверяется в scripts/check-trial-bot.ts на тестовых датах.
 *
 * Время: Москва (Europe/Moscow). Все окна отправки ниже заданы в московском времени. */

import { BEGINNER_LADDER, FIRST_STEP, LAST_STEP, decideNextStep, type SessionFeedback } from "@/features/methodology/beginner";

import {
  hasRunnerBase,
  type IntervalsExp,
  type Longest,
  type RaceDistance,
  type RaceResult,
  type RunnerInput,
  type RunnerSession,
  type WeeklyKm,
} from "./runner-week";

// ── вход ─────────────────────────────────────────────────────────────────────

/** Параметр /start целиком: trial или trial_<источник>. Telegram пускает в параметр до 64 символов [A-Za-z0-9_-]. */
export const TRIAL_START_RE = /^trial(?:_([A-Za-z0-9_-]{1,58}))?$/;

export type TrialStart = { source: string | null };

/** null, если это не вход в пробную неделю. Принимает текст сообщения целиком («/start trial_reel12»). */
export function parseTrialStart(messageText: string): TrialStart | null {
  const m = messageText.trim().match(/^\/start(?:@\w+)?\s+(\S+)$/);
  if (!m) return null;
  const payload = m[1];
  if (payload.length > 64) return null;
  const parsed = payload.match(TRIAL_START_RE);
  if (!parsed) return null;
  return { source: parsed[1] ?? null };
}

export function isTrialEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const v = (env.TRIAL_BOT_ENABLED ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

// ── анкета ───────────────────────────────────────────────────────────────────
//
// [29.10.2026, правка Игоря после живого теста] Было: один тест «для начинающих» из шести
// вопросов, и бегающему больше 30 минут бот отвечал «неделя для начинающих тебе не нужна».
// Отменено: продукт не только для новичков, никому не отказываем, неделю получает каждый.
//
// Теперь анкета как онбординг приложения AI-coach (ai-running-coach,
// src/features/onboarding/types.ts и onboarding-form.tsx): сначала цель, потом вопросы своей
// ветки, дни в неделю, травмы и последним прежний вопрос про здоровье (его обработка не
// менялась: плана нет, к врачу, Игорю уведомление без подробностей).

export type Goal = "start" | "return" | "regular" | "race";

/** Ответы БЕЗ вопроса про здоровье: по нему хранится только флаг, а не что именно отмечено. */
export type TrialAnswers = {
  goal?: Goal;
  // «начать бегать»
  now_running?: "rarely" | "sometimes" | "weekly";
  can_run?: "lt5" | "5_15" | "15_30" | "gt30";
  // «вернуться после перерыва»
  last_run?: "recent" | "3_6m" | "6m_plus";
  prev_level?: "3k" | "5k" | "10k";
  // «подготовиться к старту»
  race_distance?: RaceDistance;
  race_result?: RaceResult;
  // «бегать регулярно» и «старт»
  weekly_km?: WeeklyKm;
  longest?: Longest;
  intervals?: IntervalsExp;
  // все
  days?: "2" | "3" | "4";
  injury?: "none" | "past" | "now";
};

export type AnswerKey = keyof TrialAnswers;

export type QuestionOption = { code: string; label: string };
/** id короткий: уходит в callback_data «tr:a:<id>:<вариант>». */
export type Question = { id: string; key: AnswerKey | "health"; text: string; options: QuestionOption[] };

/** Код ответа «Ничего из этого» на вопросе про здоровье. Любой другой код = health_flag. */
export const HEALTH_NONE = "none";

const opt = (code: string, label: string): QuestionOption => ({ code, label });
const raceResultOptions = (t1: string, t2: string, t3: string, t4: string): QuestionOption[] => [
  opt("t1", t1),
  opt("t2", t2),
  opt("t3", t3),
  opt("t4", t4),
  opt("none", "Стартов ещё не было"),
];

export const QUESTIONS: Record<string, Question> = {
  goal: {
    id: "goal",
    key: "goal",
    text: "Какая у тебя цель?",
    options: [opt("start", "Начать бегать"), opt("return", "Вернуться после перерыва"), opt("regular", "Бегать регулярно"), opt("race", "Подготовиться к старту")],
  },
  nowrun: {
    id: "nowrun",
    key: "now_running",
    text: "Как сейчас с бегом?",
    options: [opt("rarely", "Почти не бегаю"), opt("sometimes", "Бывает, но без режима"), opt("weekly", "Бегаю 1-2 раза в неделю")],
  },
  canrun: {
    id: "canrun",
    key: "can_run",
    text: "Сколько сейчас можешь пробежать без остановки?",
    options: [opt("lt5", "Меньше 5 минут"), opt("5_15", "5-15 минут"), opt("15_30", "15-30 минут"), opt("gt30", "Больше 30 минут")],
  },
  brk: {
    id: "brk",
    key: "last_run",
    text: "Сколько длится перерыв в беге?",
    options: [opt("recent", "Меньше 2 месяцев"), opt("3_6m", "3-6 месяцев"), opt("6m_plus", "Больше полугода")],
  },
  prev: {
    id: "prev",
    key: "prev_level",
    text: "Сколько получалось пробежать до перерыва?",
    options: [opt("3k", "Несколько километров"), opt("5k", "Около 5 км"), opt("10k", "10 км и больше")],
  },
  dist: {
    id: "dist",
    key: "race_distance",
    text: "К какому старту готовишься?",
    options: [opt("5k", "5 км"), opt("10k", "10 км"), opt("21k", "Полумарафон"), opt("42k", "Марафон")],
  },
  rr5k: { id: "rr5k", key: "race_result", text: "Твой лучший результат на 5 км?", options: raceResultOptions("Быстрее 22 минут", "22-27 минут", "27-33 минуты", "Медленнее 33 минут") },
  rr10k: { id: "rr10k", key: "race_result", text: "Твой лучший результат на 10 км?", options: raceResultOptions("Быстрее 45 минут", "45-55 минут", "55-65 минут", "Медленнее 65 минут") },
  rr21k: { id: "rr21k", key: "race_result", text: "Твой лучший результат на полумарафоне?", options: raceResultOptions("Быстрее 1:40", "1:40-2:00", "2:00-2:20", "Медленнее 2:20") },
  rr42k: { id: "rr42k", key: "race_result", text: "Твой лучший результат на марафоне?", options: raceResultOptions("Быстрее 3:30", "3:30-4:00", "4:00-4:45", "Медленнее 4:45") },
  wkm: {
    id: "wkm",
    key: "weekly_km",
    text: "Сколько обычно набегаешь за неделю?",
    options: [opt("0_5", "До 5 км"), opt("5_15", "5-15 км"), opt("15_30", "15-30 км"), opt("30_50", "30-50 км"), opt("50_plus", "Больше 50 км"), opt("unknown", "Не знаю")],
  },
  long: {
    id: "long",
    key: "longest",
    text: "Самая длинная пробежка за последний месяц?",
    options: [
      opt("up_to_3", "До 3 км"),
      opt("3_5", "3-5 км"),
      opt("5_10", "5-10 км"),
      opt("10_15", "10-15 км"),
      opt("15_21", "15-21 км"),
      opt("21_plus", "Больше 21 км"),
      opt("unknown", "Не знаю"),
    ],
  },
  intv: {
    id: "intv",
    key: "intervals",
    text: "Были в твоих тренировках интервалы или темповые?",
    options: [opt("easy_only", "Нет, в основном лёгкий бег"), opt("sometimes", "Иногда были"), opt("regularly", "Да, регулярно"), opt("unknown", "Не знаю, что это")],
  },
  // Дни в неделю: варианты по цели, как getDaysPerWeekOptions в AI-coach. «4 и больше» хранится
  // как "4": у бегуна 4 тренировки, на лестнице бега с шагом 3 (методика новичка: не больше 3).
  d23: { id: "d23", key: "days", text: "Сколько раз в неделю реально получится бегать?", options: [opt("2", "2 раза"), opt("3", "3 раза")] },
  d234: { id: "d234", key: "days", text: "Сколько раз в неделю реально получится бегать?", options: [opt("2", "2 раза"), opt("3", "3 раза"), opt("4", "4 и больше")] },
  d34: { id: "d34", key: "days", text: "Сколько раз в неделю реально получится бегать?", options: [opt("3", "3 раза"), opt("4", "4 и больше")] },
  inj: {
    id: "inj",
    key: "injury",
    text: "Были травмы или боль от бега?",
    options: [opt("none", "Не было"), opt("past", "Были раньше, сейчас нет"), opt("now", "Бывает лёгкий дискомфорт")],
  },
  // Вопрос про здоровье: формулировка и варианты прежние, обработка прежняя.
  health: {
    id: "health",
    key: "health",
    text: "Последний вопрос, важный. Есть ли что-то из этого?",
    options: [
      opt("heart", "Сердце или давление"),
      opt("chest", "Боль в груди, головокружение"),
      opt("injury", "Травма или боль сейчас"),
      opt("pregnant", "Беременность"),
      opt(HEALTH_NONE, "Ничего из этого"),
    ],
  },
};

/**
 * Путь вопросов по ответам. Ветка становится известна после цели, вопрос о результате после
 * дистанции, поэтому номер текущего вопроса в пути не сдвигается от новых ответов.
 *   начать бегать:   цель, как сейчас с бегом, сколько без остановки, дни, травмы, здоровье (6)
 *   вернуться:       цель, перерыв, уровень до перерыва, дни, травмы, здоровье (6)
 *   регулярно:       цель, объём, самая длинная, интервалы, дни, травмы, здоровье (7)
 *   к старту:        цель, дистанция, результат, объём, интервалы, дни, травмы, здоровье (8)
 * У старта нет вопроса про самую длинную: длительная выводится из объёма и дистанции, иначе
 * путь выходит в 9 нажатий.
 */
export function questionPath(a: TrialAnswers): Question[] {
  const q = QUESTIONS;
  const tail = [q.inj, q.health];
  switch (a.goal) {
    case "start":
      return [q.goal, q.nowrun, q.canrun, q.d23, ...tail];
    case "return":
      return [q.goal, q.brk, q.prev, q.d234, ...tail];
    case "regular":
      return [q.goal, q.wkm, q.long, q.intv, q.d234, ...tail];
    case "race": {
      const rr = a.race_distance ? q[`rr${a.race_distance}`] : null;
      return rr ? [q.goal, q.dist, rr, q.wkm, q.intv, q.d34, ...tail] : [q.goal, q.dist];
    }
    default:
      return [q.goal];
  }
}

/** Сколько вопросов будет у этой цели (для «Вопрос 2 из 7»). null, пока цель не выбрана. */
export function pathLength(a: TrialAnswers): number | null {
  if (!a.goal) return null;
  if (a.goal === "race") return 8;
  return questionPath(a).length;
}

/** Вопрос номер n (1..) на пути этих ответов. null, если такого нет (старая анкета, сбитый номер). */
export function questionAt(a: TrialAnswers, n: number): Question | null {
  if (!Number.isInteger(n) || n < 1) return null;
  return questionPath(a)[n - 1] ?? null;
}

export function questionById(id: string): Question | null {
  return Object.prototype.hasOwnProperty.call(QUESTIONS, id) ? QUESTIONS[id] : null;
}

/** Ответ из кнопки: вопрос и индекс варианта. null, если такой кнопки нет. */
export function optionAt(id: string, index: number): QuestionOption | null {
  const q = questionById(id);
  if (!q || !Number.isInteger(index) || index < 0 || index >= q.options.length) return null;
  return q.options[index];
}

/** Записать ответ. Вопрос про здоровье сюда не попадает никогда. */
export function withAnswer(answers: TrialAnswers, id: string, code: string): TrialAnswers {
  const q = questionById(id);
  if (!q || q.key === "health") return answers;
  if (!q.options.some((o) => o.code === code)) return answers;
  return { ...answers, [q.key]: code };
}

// ── результат ────────────────────────────────────────────────────────────────

/**
 * Значения те же, что разрешает check в trial_bot_users.result_type (миграции не нужно),
 * смысл по цели:
 *   clean_start  начать бегать;
 *   comeback     вернуться после перерыва;
 *   too_fast     уже бегает, но интервалов не было или «не знаю», «иногда»: почти всё в одном
 *                среднем темпе (на карточке «Всё в одном темпе»);
 *   no_system    уже бегает и интервалы регулярно, или бегает совсем мало (до 5 км в неделю):
 *                нагрузка держится на настроении, а не на плане.
 */
export type ResultType = "clean_start" | "too_fast" | "no_system" | "comeback";

export type TestOutcome =
  | { kind: "health_stop" }
  | { kind: "result"; resultType: ResultType; startRung: number | null; weeklyRuns: 2 | 3 | 4 };

/** Бегущий уже с базой: неделя бегуна (лёгкий, интервалы, длительная), а не лестница бега с шагом. */
export function isRunnerTrack(a: TrialAnswers): boolean {
  if (a.goal !== "regular" && a.goal !== "race") return false;
  return hasRunnerBase(a.weekly_km ?? "unknown", a.goal === "regular" ? a.longest ?? "unknown" : null);
}

export function classifyResult(a: TrialAnswers): ResultType {
  if (a.goal === "start") return "clean_start";
  if (a.goal === "return") return "comeback";
  if (!isRunnerTrack(a)) return "no_system";
  return a.intervals === "regularly" ? "no_system" : "too_fast";
}

/**
 * Ступени возвращения (лестница новичка): по перерыву и уровню до него. Чем дольше перерыв и
 * ниже был уровень, тем ниже ступень. Даже недавний перерыв при 10 км не даёт интервалов:
 * методика возвращения первые недели без работы на скорость.
 */
const RETURN_RUNG: Record<NonNullable<TrialAnswers["last_run"]>, Record<NonNullable<TrialAnswers["prev_level"]>, number>> = {
  recent: { "3k": 5, "5k": 6, "10k": 7 },
  "3_6m": { "3k": 3, "5k": 4, "10k": 5 },
  "6m_plus": { "3k": 1, "5k": 2, "10k": 3 },
};

/**
 * СТУПЕНЬ ПЕРВОЙ НЕДЕЛИ на лестнице бега с шагом (src/features/methodology/beginner.ts).
 * null: человек идёт неделей бегуна, лестница не нужна.
 *   начать бегать: меньше 5 минут → 1, 5-15 → 3, 15-30 → 6 (25 минут непрерывно), больше 30 → 7;
 *   вернуться: таблица RETURN_RUNG;
 *   регулярно или старт без базы (до 5 км в неделю или самая длинная до 3 км) → 6;
 *   «бывает лёгкий дискомфорт» → ступенью ниже (не ниже первой).
 */
export function startRungFor(a: TrialAnswers): number | null {
  if (isRunnerTrack(a)) return null;
  let rung = 6;
  if (a.goal === "start") rung = a.can_run === "lt5" ? 1 : a.can_run === "5_15" ? 3 : a.can_run === "gt30" ? 7 : 6;
  if (a.goal === "return") rung = RETURN_RUNG[a.last_run ?? "6m_plus"][a.prev_level ?? "3k"];
  if (a.injury === "now") rung -= 1;
  return Math.max(1, rung);
}

/**
 * Сколько тренировок ведёт бот. «4 и больше»: у бегуна 4 [решение Игоря, 29.10.2026; было 3],
 * на лестнице 3 (методика новичка и возвращения не больше 3 в неделю).
 */
export function weeklyRunsFor(a: TrialAnswers): 2 | 3 | 4 {
  if (a.days === "2") return 2;
  if (a.days === "4" && isRunnerTrack(a)) return 4;
  return 3;
}

/** Вход для недели бегуна. null, если человек идёт лестницей. */
export function runnerInputFor(a: TrialAnswers): RunnerInput | null {
  if (!isRunnerTrack(a)) return null;
  return {
    weeklyKm: a.weekly_km ?? "unknown",
    longest: a.goal === "regular" ? a.longest ?? "unknown" : null,
    intervals: a.intervals ?? "unknown",
    runs: weeklyRunsFor(a),
    caution: a.injury === "now",
    raceDistance: a.goal === "race" ? a.race_distance ?? null : null,
    raceResult: a.goal === "race" ? a.race_result ?? null : null,
  };
}

/** Итог анкеты. Здоровье раньше всего; больше никаких отказов: неделю получает каждый. */
export function testOutcome(answers: TrialAnswers, healthCode: string): TestOutcome {
  if (healthCode !== HEALTH_NONE) return { kind: "health_stop" };
  return {
    kind: "result",
    resultType: classifyResult(answers),
    startRung: startRungFor(answers),
    weeklyRuns: weeklyRunsFor(answers),
  };
}

// ── дни и даты ───────────────────────────────────────────────────────────────

export const TRIAL_TZ = "Europe/Moscow";

/** Варианты дней. Числа: ISO-день недели (1 = понедельник). */
export const DAY_PATTERNS: Record<string, { runs: 2 | 3; days: number[]; label: string }> = {
  m3a: { runs: 3, days: [1, 3, 6], label: "Пн Ср Сб" },
  m3b: { runs: 3, days: [2, 4, 6], label: "Вт Чт Сб" },
  m3c: { runs: 3, days: [2, 4, 7], label: "Вт Чт Вс" },
  m2a: { runs: 2, days: [2, 6], label: "Вт Сб" },
  m2b: { runs: 2, days: [3, 7], label: "Ср Вс" },
};

/**
 * 4 тренировки [29.10.2026, «4 и больше» у бегуна]. Отдельной картой, а не в DAY_PATTERNS:
 * английская неделя (src/features/en-week) разворачивает DAY_PATTERNS у себя и ждёт там только
 * 2 и 3 дня. Дни те же, что у её r4a/r4b/r4c: длительная в воскресенье, интервалы не рядом с ней.
 */
export const DAY_PATTERNS_4: Record<string, { runs: 4; days: number[]; label: string }> = {
  m4a: { runs: 4, days: [2, 4, 6, 7], label: "Вт Чт Сб Вс" },
  m4b: { runs: 4, days: [1, 3, 5, 7], label: "Пн Ср Пт Вс" },
  m4c: { runs: 4, days: [2, 3, 5, 7], label: "Вт Ср Пт Вс" },
};

/** Все наборы дней пробной недели: на 2, 3 и 4 тренировки. */
export const ALL_DAY_PATTERNS: Record<string, { runs: 2 | 3 | 4; days: number[]; label: string }> = { ...DAY_PATTERNS, ...DAY_PATTERNS_4 };

export function patternsFor(runs: 2 | 3 | 4): string[] {
  return Object.keys(ALL_DAY_PATTERNS).filter((k) => ALL_DAY_PATTERNS[k].runs === runs);
}

export type MskNow = { date: string; minutes: number; weekday: number };

/** Московские дата (YYYY-MM-DD), минуты от полуночи и ISO-день недели. */
export function mskNow(now: Date): MskNow {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TRIAL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  return { date, minutes: Number(get("hour")) * 60 + Number(get("minute")), weekday: isoWeekday(date) };
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isoWeekday(date: string): number {
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
  return wd === 0 ? 7 : wd;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** День пробной недели: 1 = день первой тренировки. */
export function trialDay(weekStart: string, today: string): number {
  return daysBetween(weekStart, today) + 1;
}

/** До этого часа (МСК) неделя может начаться сегодня, если сегодняшний день есть в выбранном наборе. */
export const SAME_DAY_START_BEFORE = 14 * 60;

/**
 * НЕДЕЛЯ. Длится 7 дней, в них попадает ровно 2 или 3 тренировки [решение Игоря 28.10.2026]:
 *   — сегодняшний день есть в наборе и по Москве ещё нет 14:00 → неделя начинается сегодня
 *     (первую тренировку бот присылает сразу, утреннее окно уже могло пройти);
 *   — иначе со следующего подходящего дня.
 */
export function buildWeek(
  today: string,
  patternCode: string,
  nowMinutes: number = 24 * 60,
): { weekStart: string; dates: string[]; startsToday: boolean } | null {
  const pattern = ALL_DAY_PATTERNS[patternCode];
  if (!pattern) return null;
  const startsToday = pattern.days.includes(isoWeekday(today)) && nowMinutes < SAME_DAY_START_BEFORE;
  let start = startsToday ? today : addDays(today, 1);
  while (!pattern.days.includes(isoWeekday(start))) start = addDays(start, 1);
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i);
    if (pattern.days.includes(isoWeekday(d))) dates.push(d);
  }
  return { weekStart: start, dates, startsToday };
}

// ── прогрессия внутри недели ─────────────────────────────────────────────────

export type Checkin = "easy" | "ok" | "hard" | "miss" | "pain";
export const CHECKINS: Checkin[] = ["easy", "ok", "hard", "miss", "pain"];

/** Сессия, которую человек сделал (с любой оценкой). «Не получилось» и молчание сюда не входят. */
export function isDone(c: Checkin | null | undefined): boolean {
  return c === "easy" || c === "ok" || c === "hard" || c === "pain";
}

export const WALK_PRESET = "brisk_walk_30";

/**
 * Сессия лестницы бега с шагом: ступень или ходьба после боли. Контракт прежний: им же
 * пользуется английская неделя (src/features/en-week), поэтому сессии недели бегуна сюда не
 * добавлены, а живут в TrialPlanned.
 */
export type PlannedSession = { kind: "rung"; rung: number } | { kind: "walk" };
/** Любая сессия пробной недели: лестница или неделя бегуна (runner-week.ts). */
export type TrialPlanned = PlannedSession | RunnerSession;

/**
 * ЧТО ДАВАТЬ НА СЛЕДУЮЩЕЙ ТРЕНИРОВКЕ, по отметкам предыдущих (по порядку).
 *   «Легко» / «Нормально» → RPE 2 / 3 и decideNextStep из методики: вверх только после
 *     MIN_SESSIONS_PER_STEP (2) чистых сессий подряд на ступени;
 *   «Тяжело» → сразу ступенью ниже (не ниже первой). Здесь мы строже decideNextStep,
 *     который при RPE > 5 сначала повторяет. Ответ человеку обещает только «прибавлять не
 *     будем» и «беги медленнее» [правка текстов 28.10.2026]: прежнее «больше шага» было
 *     ложью на первой ступени, где облегчать некуда;
 *   «Что-то болело» → следующая тренировка заменяется 30 минутами быстрой ходьбы, ступень
 *     не меняется; после ходьбы возвращаемся на ту же ступень;
 *   «Не получилось» и молчание → ничего не меняют.
 */
export function planNext(startRung: number, history: Array<{ planned: TrialPlanned; checkin: Checkin | null }>): PlannedSession {
  let rung = clampRung(startRung);
  let sessionsAtRung = 0;
  let recent: SessionFeedback[] = [];
  let walkNext = false;

  for (const h of history) {
    if (h.checkin === "pain") {
      walkNext = true;
      continue;
    }
    if (h.planned.kind !== "rung") {
      // Ходьба была (с любой отметкой, кроме новой боли выше): ступень та же, дальше снова бег.
      // Сессий недели бегуна у человека на лестнице не бывает; если встретятся, ступень не двигают.
      walkNext = false;
      continue;
    }
    walkNext = false;
    if (h.checkin === "hard") {
      rung = Math.max(FIRST_STEP, rung - 1);
      sessionsAtRung = 0;
      recent = [];
      continue;
    }
    if (h.checkin === "easy" || h.checkin === "ok") {
      sessionsAtRung += 1;
      recent = [{ date: "", rpe: h.checkin === "easy" ? 2 : 3, pain: false }, ...recent];
      const decision = decideNextStep({ currentStep: rung, sessionsAtStep: sessionsAtRung, recent });
      if (decision.action === "progress" && decision.nextStep !== rung) {
        rung = decision.nextStep;
        sessionsAtRung = 0;
        recent = [];
      }
    }
  }
  return walkNext ? { kind: "walk" } : { kind: "rung", rung };
}

function clampRung(r: number): number {
  return Math.min(LAST_STEP, Math.max(FIRST_STEP, Math.round(r)));
}

export function presetForRung(rung: number): string {
  return BEGINNER_LADDER.find((s) => s.index === clampRung(rung))!.presetCode;
}

/** Совет на следующую неделю по всей истории недели. */
export type NextStepAdvice = { kind: "up"; rung: number } | { kind: "same"; rung: number } | { kind: "careful"; rung: number };

export function weekAdvice(startRung: number, history: Array<{ planned: TrialPlanned; checkin: Checkin | null }>): NextStepAdvice {
  const next = planNext(startRung, history);
  const lastRungSession = [...history].reverse().find((h) => h.planned.kind === "rung");
  const currentRung = lastRungSession && lastRungSession.planned.kind === "rung" ? lastRungSession.planned.rung : clampRung(startRung);
  if (history.some((h) => h.checkin === "pain") || next.kind === "walk") return { kind: "careful", rung: currentRung };
  if (next.kind === "rung" && next.rung > currentRung) return { kind: "up", rung: next.rung };
  return { kind: "same", rung: next.kind === "rung" ? next.rung : currentRung };
}

// ── что отправить сейчас ─────────────────────────────────────────────────────

export type Stage =
  | "intro"
  | "test"
  | "health_stop"
  | "already_runner"
  | "result"
  | "declined"
  | "choose_days"
  | "week"
  | "post"
  | "done";

export type ScheduleUser = {
  stage: Stage;
  stopped: boolean;
  test_q: number | null;
  last_action_at: string | null;
  test_started_at: string | null;
  week_start: string | null;
  base_requested: boolean;
  /** Московская дата, когда ушёл офер середины недели; null — ещё не уходил. */
  offer_sent_on?: string | null;
};

/** checkin_at нужен оферу середины недели: он уходит на следующий день после второй отметки. */
export type ScheduleSession = { idx: number; date: string; checkin: Checkin | null; checkin_at?: string | null };

/** Последний день недели, в который ещё уходит офер середины недели (день 7 занят итогом). */
export const OFFER_LAST_DAY = 6;
/** День, в который офер уходит, если к нему меньше двух отметок. */
export const OFFER_FALLBACK_DAY = 5;

/**
 * ОФЕР СЕРЕДИНЫ НЕДЕЛИ (бывший «день 4») [решение Игоря 28.10.2026]: не по календарю, а на
 * следующий день после второй отметки «как прошло» (любой: «Не получилось» тоже отметка).
 * Если к дню 5 отметок меньше двух, офер уходит в день 5. Позже дня 6 не уходит: в день 7 итог.
 */
export function offerDue(weekStart: string, today: string, sessions: ScheduleSession[]): boolean {
  const day = trialDay(weekStart, today);
  if (day < 1 || day > OFFER_LAST_DAY) return false;
  const marks = sessions
    .filter((s) => s.checkin !== null && s.checkin_at)
    .map((s) => mskNow(new Date(s.checkin_at!)).date)
    .sort();
  if (marks.length >= 2) return today > marks[1];
  return day >= OFFER_FALLBACK_DAY;
}

export type DueAction =
  | { kind: "nudge"; key: string }
  | { kind: "morning"; key: string; idx: number; immediate?: boolean }
  | { kind: "evening"; key: string; idx: number }
  | { kind: "day4"; key: string }
  | { kind: "case1"; key: string }
  | { kind: "case2"; key: string }
  | { kind: "day7"; key: string }
  | { kind: "fu8"; key: string }
  | { kind: "fu10"; key: string }
  | { kind: "channel"; key: string }
  | { kind: "set_stage"; stage: Stage };

/** Окна в московском времени, [с, до) в минутах от полуночи. Тик раз в 30 минут попадает в каждое минимум дважды. */
export const WINDOWS = {
  morning: [8 * 60, 12 * 60],
  evening: [19 * 60, 22 * 60],
  day4: [12 * 60, 18 * 60],
  /** Истории учеников (фото + подпись): день 2 и день 5 недели. */
  cases: [13 * 60, 18 * 60],
  day7: [20 * 60 + 30, 22 * 60 + 30],
  day7AfterCheckins: [19 * 60, 22 * 60 + 30],
  followup: [12 * 60, 18 * 60],
  nudge: [9 * 60, 21 * 60],
} as const;

export const NUDGE_AFTER_MS = 3 * 60 * 60 * 1000;
/** День пробной недели, на котором уходит сообщение с каналом; после него бот молчит. */
export const CHANNEL_DAY = 12;

function inWindow(minutes: number, w: readonly [number, number]): boolean {
  return minutes >= w[0] && minutes < w[1];
}

/**
 * Что пора отправить этому человеку сейчас. Повторы гасит не эта функция, а ключ
 * в trial_bot_sends: функция может вернуть то же действие на каждом тике окна.
 * Ключи недели начинаются с даты её старта, чтобы повторный проход теста через
 * месяц не упёрся в ключи прошлой недели.
 */
export function dueActions(user: ScheduleUser, sessions: ScheduleSession[], now: Date): DueAction[] {
  if (user.stopped) return [];
  const msk = mskNow(now);
  const out: DueAction[] = [];

  if (user.stage === "test") {
    const last = user.last_action_at ? Date.parse(user.last_action_at) : NaN;
    if (Number.isFinite(last) && now.getTime() - last >= NUDGE_AFTER_MS && inWindow(msk.minutes, WINDOWS.nudge)) {
      out.push({ kind: "nudge", key: `nudge:${user.test_started_at ?? "?"}` });
    }
    return out;
  }

  if ((user.stage !== "week" && user.stage !== "post") || !user.week_start) return out;
  const wk = user.week_start;
  const day = trialDay(wk, msk.date);
  if (day < 1) return out;

  if (user.stage === "week") {
    for (const s of sessions) {
      if (s.date !== msk.date) continue;
      if (inWindow(msk.minutes, WINDOWS.morning)) out.push({ kind: "morning", key: `w${wk}:morning:${s.idx}`, idx: s.idx });
      if (s.checkin === null && inWindow(msk.minutes, WINDOWS.evening)) {
        out.push({ kind: "evening", key: `w${wk}:evening:${s.idx}`, idx: s.idx });
      }
    }

    if (inWindow(msk.minutes, WINDOWS.day4) && offerDue(wk, msk.date, sessions)) out.push({ kind: "day4", key: `w${wk}:day4` });
    // ИСТОРИИ УЧЕНИКОВ: день 2 и день 5. Если в этот календарный день ушёл (или уходит этим
    // тиком) офер середины недели, история переезжает на следующий день в то же окно
    // [решение Игоря 28.10.2026: не больше одного продающего сообщения в день]. Раньше дня 7
    // переезд всегда заканчивается: офер не позже дня 6, история 5 → не позже дня 6.
    if (inWindow(msk.minutes, WINDOWS.cases)) {
      // day4 в списке считается, только если офер ещё не уходил: иначе его отсечёт ключ, и он не «сегодня».
      const offerToday = user.offer_sent_on === msk.date || (!user.offer_sent_on && out.some((a) => a.kind === "day4"));
      const offerYesterday = user.offer_sent_on === addDays(msk.date, -1);
      for (const [baseDay, kind] of [[2, "case1"], [5, "case2"]] as const) {
        if ((day === baseDay && !offerToday) || (day === baseDay + 1 && offerYesterday)) {
          out.push({ kind, key: `w${wk}:${kind}` });
        }
      }
    }
    if (day === 7) {
      const allIn = sessions.length > 0 && sessions.every((s) => s.checkin !== null);
      if (inWindow(msk.minutes, WINDOWS.day7) || (allIn && inWindow(msk.minutes, WINDOWS.day7AfterCheckins))) {
        out.push({ kind: "day7", key: `w${wk}:day7` });
      }
    }
    if (day >= 8) out.push({ kind: "set_stage", stage: "post" });
    return out;
  }

  // post: два коротких напоминания о Базе и канал. Кто уже попросился в Базу, тому не напоминаем.
  if (!user.base_requested && inWindow(msk.minutes, WINDOWS.followup)) {
    if (day === 8) out.push({ kind: "fu8", key: `w${wk}:fu8` });
    if (day === 10) out.push({ kind: "fu10", key: `w${wk}:fu10` });
    if (day === CHANNEL_DAY) out.push({ kind: "channel", key: `w${wk}:channel` });
  }
  if (day > CHANNEL_DAY || (day === CHANNEL_DAY && msk.minutes >= WINDOWS.followup[1])) {
    out.push({ kind: "set_stage", stage: "done" });
  }
  return out;
}

// ── кнопки ───────────────────────────────────────────────────────────────────

export const CB = "tr:";

export type TrialCallback =
  | { kind: "go" }
  | { kind: "cont" }
  | { kind: "answer"; qid: string; index: number }
  | { kind: "week"; yes: boolean }
  | { kind: "days"; pattern: string }
  | { kind: "checkin"; idx: number; value: Checkin }
  | { kind: "d4later" }
  | { kind: "base"; yes: boolean };

export function parseTrialCallback(data: string | null | undefined): TrialCallback | null {
  if (!data || !data.startsWith(CB)) return null;
  const parts = data.slice(CB.length).split(":");
  switch (parts[0]) {
    case "go":
      return parts.length === 1 ? { kind: "go" } : null;
    case "cont":
      return parts.length === 1 ? { kind: "cont" } : null;
    case "a": {
      // [29.10.2026] было «tr:a:<номер вопроса>:<вариант>»: вопросы шли одним списком. Теперь путь
      // зависит от цели, и номер на чужом пути значил бы другой вопрос, поэтому в кнопке id вопроса.
      const index = Number(parts[2]);
      return parts.length === 3 && optionAt(parts[1], index) ? { kind: "answer", qid: parts[1], index } : null;
    }
    case "wk":
      return parts[1] === "y" || parts[1] === "n" ? { kind: "week", yes: parts[1] === "y" } : null;
    case "days":
      return parts[1] && Object.prototype.hasOwnProperty.call(ALL_DAY_PATTERNS, parts[1]) ? { kind: "days", pattern: parts[1] } : null;
    case "ci": {
      const idx = Number(parts[1]);
      const value = parts[2] as Checkin;
      // [29.10.2026] было idx 1..3; у бегуна с «4 и больше» четыре тренировки.
      return Number.isInteger(idx) && idx >= 1 && idx <= 4 && CHECKINS.includes(value) ? { kind: "checkin", idx, value } : null;
    }
    case "d4":
      return parts[1] === "later" ? { kind: "d4later" } : null;
    case "base":
      return parts[1] === "y" || parts[1] === "n" ? { kind: "base", yes: parts[1] === "y" } : null;
    default:
      return null;
  }
}

// ── склонение ────────────────────────────────────────────────────────────────

export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
