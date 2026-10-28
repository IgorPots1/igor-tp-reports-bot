/* Пробная неделя в основном боте (вход из рилсов): чистая логика без сети и без базы.
 *
 * Здесь: разбор deep link, вопросы теста, классификация результата, сборка недели,
 * прогрессия по отметкам «как прошло» и решение «что отправить сейчас». Всё
 * детерминировано и проверяется в scripts/check-trial-bot.ts на тестовых датах.
 *
 * Время: Москва (Europe/Moscow). Все окна отправки ниже заданы в московском времени. */

import { BEGINNER_LADDER, FIRST_STEP, LAST_STEP, decideNextStep, type SessionFeedback } from "@/features/methodology/beginner";

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

// ── тест ─────────────────────────────────────────────────────────────────────

export type Q1 = "no" | "quit" | "regular";
export type Q2 = "lt5" | "5_15" | "15_30" | "gt30";
export type Q3 = "breath" | "knees" | "time" | "progress" | "never";
export type Q4 = "2" | "3";
export type Q5 = "regular" | "5k" | "shape" | "return";

/** Ответы БЕЗ вопроса про здоровье: по нему хранится только флаг, а не что именно отмечено. */
export type TrialAnswers = { q1?: Q1; q2?: Q2; q3?: Q3; q4?: Q4; q5?: Q5 };

export type QuestionOption = { code: string; label: string };
export type Question = { n: number; key: "q1" | "q2" | "q3" | "q4" | "q5" | "q6"; text: string; options: QuestionOption[] };

/** Код ответа «Ничего из этого» на шестом вопросе. Любой другой код = health_flag. */
export const HEALTH_NONE = "none";

export const QUESTIONS: Question[] = [
  {
    n: 1,
    key: "q1",
    text: "Бегаешь сейчас?",
    options: [
      { code: "no", label: "Нет, хочу начать" },
      { code: "quit", label: "Пробовал(а), но бросил(а)" },
      { code: "regular", label: "Да, регулярно" },
    ],
  },
  {
    n: 2,
    key: "q2",
    text: "Сколько сейчас можешь пробежать без остановки?",
    options: [
      { code: "lt5", label: "Меньше 5 минут" },
      { code: "5_15", label: "5-15 минут" },
      { code: "15_30", label: "15-30 минут" },
      { code: "gt30", label: "Больше 30 минут" },
    ],
  },
  {
    n: 3,
    key: "q3",
    text: "Что чаще всего мешало раньше?",
    options: [
      { code: "breath", label: "Задыхаюсь, тяжело" },
      { code: "knees", label: "Болят колени или голени" },
      { code: "time", label: "Не хватает времени" },
      { code: "progress", label: "Не вижу прогресса" },
      { code: "never", label: "Ещё не пробовал(а)" },
    ],
  },
  {
    n: 4,
    key: "q4",
    text: "Сколько раз в неделю реально готов(а) бегать?",
    options: [
      { code: "2", label: "2 раза" },
      { code: "3", label: "3 раза" },
    ],
  },
  {
    n: 5,
    key: "q5",
    text: "Какая цель на ближайшие 2-3 месяца?",
    options: [
      { code: "regular", label: "Просто бегать регулярно" },
      { code: "5k", label: "Пробежать 5 км без остановки" },
      { code: "shape", label: "Прийти в форму" },
      { code: "return", label: "Вернуться после перерыва" },
    ],
  },
  {
    n: 6,
    key: "q6",
    text: "Последний вопрос, важный. Есть ли что-то из этого?",
    options: [
      { code: "heart", label: "Сердце или давление" },
      { code: "chest", label: "Боль в груди или головокружение при нагрузке" },
      { code: "injury", label: "Травма или боль сейчас" },
      { code: "pregnant", label: "Беременность" },
      { code: HEALTH_NONE, label: "Ничего из этого" },
    ],
  },
];

export const QUESTION_COUNT = QUESTIONS.length;

export function questionByNumber(n: number): Question | null {
  return QUESTIONS.find((q) => q.n === n) ?? null;
}

/** Ответ из кнопки: номер вопроса и индекс варианта. null, если такой кнопки нет. */
export function optionAt(n: number, index: number): QuestionOption | null {
  const q = questionByNumber(n);
  if (!q || !Number.isInteger(index) || index < 0 || index >= q.options.length) return null;
  return q.options[index];
}

/** Записать ответ на вопросы 1-5. Шестой сюда не попадает никогда. */
export function withAnswer(answers: TrialAnswers, n: number, code: string): TrialAnswers {
  const q = questionByNumber(n);
  if (!q || q.key === "q6") return answers;
  if (!q.options.some((o) => o.code === code)) return answers;
  return { ...answers, [q.key]: code };
}

// ── результат ────────────────────────────────────────────────────────────────

export type ResultType = "clean_start" | "too_fast" | "no_system" | "comeback";

export type TestOutcome =
  | { kind: "health_stop" }
  | { kind: "already_runner" }
  | { kind: "result"; resultType: ResultType; startRung: number; weeklyRuns: 2 | 3 };

/**
 * ТИП РЕЗУЛЬТАТА. Правило по порядку, первое совпадение побеждает:
 *   1. Q1 «Нет, хочу начать»                         → Чистый старт
 *   2. Q3 «Задыхаюсь, тяжело»                        → Слишком быстро
 *   3. Q5 «Вернуться после перерыва» или Q3 «колени» → Возвращение
 *   4. Q3 «Не хватает времени» или «Не вижу прогресса» → Нет системы
 *   5. Q1 «Пробовал(а), но бросил(а)» и Q2 меньше 15 минут → Слишком быстро
 *   6. иначе                                         → Нет системы
 * Названная человеком причина (Q3) важнее выведенной из цифр (п.5), поэтому п.5 ниже.
 */
export function classifyResult(a: TrialAnswers): ResultType {
  if (a.q1 === "no") return "clean_start";
  if (a.q3 === "breath") return "too_fast";
  if (a.q5 === "return" || a.q3 === "knees") return "comeback";
  if (a.q3 === "time" || a.q3 === "progress") return "no_system";
  if (a.q1 === "quit" && (a.q2 === "lt5" || a.q2 === "5_15")) return "too_fast";
  return "no_system";
}

/**
 * СТУПЕНЬ ПЕРВОЙ НЕДЕЛИ по Q2 (лестница новичка, src/features/methodology/beginner.ts):
 *   меньше 5 минут → ступень 1 (rw_5x4_2walk)
 *   5-15 минут     → ступень 3 (rw_5x5_90walk)
 *   15-30 и больше → ступень 6 (rw_continuous_25, 25 минут лёгкого непрерывного бега).
 * Почему ступень 6, а не пресет easy_continuous: у easy_continuous в библиотеке нет
 * текста (длительность берётся из объёмного конверта атлета), а у ступени 6 есть
 * готовое описание тренера ровно про 25 минут лёгкого непрерывного бега.
 */
export function startRungFor(q2: Q2 | undefined): number {
  if (q2 === "lt5") return 1;
  if (q2 === "5_15") return 3;
  return 6;
}

export function testOutcome(answers: TrialAnswers, healthCode: string): TestOutcome {
  if (healthCode !== HEALTH_NONE) return { kind: "health_stop" };
  if (answers.q1 === "regular" && answers.q2 === "gt30") return { kind: "already_runner" };
  return {
    kind: "result",
    resultType: classifyResult(answers),
    startRung: startRungFor(answers.q2),
    weeklyRuns: answers.q4 === "2" ? 2 : 3,
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

export function patternsFor(runs: 2 | 3): string[] {
  return Object.keys(DAY_PATTERNS).filter((k) => DAY_PATTERNS[k].runs === runs);
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
  const pattern = DAY_PATTERNS[patternCode];
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

export type PlannedSession = { kind: "rung"; rung: number } | { kind: "walk" };

/**
 * ЧТО ДАВАТЬ НА СЛЕДУЮЩЕЙ ТРЕНИРОВКЕ, по отметкам предыдущих (по порядку).
 *   «Легко» / «Нормально» → RPE 2 / 3 и decideNextStep из методики: вверх только после
 *     MIN_SESSIONS_PER_STEP (2) чистых сессий подряд на ступени;
 *   «Тяжело» → сразу ступенью ниже (не ниже первой). Здесь мы строже decideNextStep,
 *     который при RPE > 5 сначала повторяет: человеку уже обещано «больше шага, бег
 *     медленнее», и обещание должно сбыться на следующей же тренировке;
 *   «Что-то болело» → следующая тренировка заменяется 30 минутами быстрой ходьбы, ступень
 *     не меняется; после ходьбы возвращаемся на ту же ступень;
 *   «Не получилось» и молчание → ничего не меняют.
 */
export function planNext(startRung: number, history: Array<{ planned: PlannedSession; checkin: Checkin | null }>): PlannedSession {
  let rung = clampRung(startRung);
  let sessionsAtRung = 0;
  let recent: SessionFeedback[] = [];
  let walkNext = false;

  for (const h of history) {
    if (h.checkin === "pain") {
      walkNext = true;
      continue;
    }
    if (h.planned.kind === "walk") {
      // Ходьба была (с любой отметкой, кроме новой боли выше): ступень та же, дальше снова бег.
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

export function weekAdvice(startRung: number, history: Array<{ planned: PlannedSession; checkin: Checkin | null }>): NextStepAdvice {
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
  | { kind: "answer"; n: number; index: number }
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
      const n = Number(parts[1]);
      const index = Number(parts[2]);
      return parts.length === 3 && optionAt(n, index) ? { kind: "answer", n, index } : null;
    }
    case "wk":
      return parts[1] === "y" || parts[1] === "n" ? { kind: "week", yes: parts[1] === "y" } : null;
    case "days":
      return parts[1] && DAY_PATTERNS[parts[1]] ? { kind: "days", pattern: parts[1] } : null;
    case "ci": {
      const idx = Number(parts[1]);
      const value = parts[2] as Checkin;
      return Number.isInteger(idx) && idx >= 1 && idx <= 3 && CHECKINS.includes(value) ? { kind: "checkin", idx, value } : null;
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
