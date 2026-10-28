/* Пробная неделя: обработка входа, кнопок и плановый тик.
 *
 * Хранилище, Telegram, часы и библиотека тренировок приходят снаружи (deps): в бою это
 * Supabase и Bot API основного бота (runtime.ts), в чеке память и запись исходящих
 * вызовов (scripts/check-trial-bot.ts). Флаг TRIAL_BOT_ENABLED проверяет вызывающий код
 * (вебхук и cron-маршрут): при выключенном флаге сюда никто не заходит. */

import {
  DAY_PATTERNS,
  QUESTION_COUNT,
  buildWeek,
  dueActions,
  isDone,
  mskNow,
  optionAt,
  patternsFor,
  planNext,
  questionByNumber,
  testOutcome,
  weekAdvice,
  withAnswer,
  WALK_PRESET,
  type Checkin,
  type DueAction,
  type PlannedSession,
  type Stage,
  type TrialAnswers,
  type TrialCallback,
} from "./logic";
import * as T from "./texts";
import { WALK_WORKOUT, workoutFor, type LibraryRows, type WorkoutText } from "./workouts";

// ── типы хранилища ───────────────────────────────────────────────────────────

export type TrialUser = {
  telegram_user_id: number;
  chat_id: number;
  first_name: string | null;
  username: string | null;
  first_source: string | null;
  last_source: string | null;
  stage: Stage;
  test_q: number | null;
  answers: TrialAnswers;
  health_flag: boolean | null;
  result_type: string | null;
  start_rung: number | null;
  weekly_runs: number | null;
  days_pattern: string | null;
  week_start: string | null;
  test_started_at: string | null;
  test_completed_at: string | null;
  week_opted_at: string | null;
  week_declined_at: string | null;
  offer4_at: string | null;
  day7_at: string | null;
  base_requested_at: string | null;
  followup8_at: string | null;
  followup10_at: string | null;
  channel_at: string | null;
  stopped_at: string | null;
  last_action_at: string | null;
};

export type TrialSession = {
  telegram_user_id: number;
  idx: number;
  scheduled_date: string;
  rung: number | null;
  preset_code: string | null;
  title: string | null;
  body: string | null;
  checkin: Checkin | null;
  checkin_at: string | null;
  morning_sent_at: string | null;
};

export type TrialEventKind =
  | "start"
  | "test_started"
  | "answer"
  | "test_completed"
  | "health_stop"
  | "already_runner"
  | "week_opted"
  | "week_declined"
  | "days_chosen"
  | "morning_sent"
  | "evening_sent"
  | "checkin"
  | "offer4_sent"
  | "offer4_later"
  | "case_sent"
  | "day7_sent"
  | "base_click"
  | "base_later"
  | "followup_sent"
  | "channel_sent"
  | "nudge_sent"
  | "text_hint"
  | "blocked";

export type TrialStore = {
  getUser(id: number): Promise<TrialUser | null>;
  /** Создать или обновить по telegram_user_id. */
  saveUser(patch: Partial<TrialUser> & { telegram_user_id: number }): Promise<void>;
  /** Кому тик может что-то отправить: не остановленные, стадии test / week / post. */
  listScheduled(): Promise<TrialUser[]>;
  getSessions(id: number): Promise<TrialSession[]>;
  /** Заменить сессии человека новой неделей (старые от прошлого прохода удаляются). */
  replaceSessions(id: number, rows: TrialSession[]): Promise<void>;
  updateSession(id: number, idx: number, patch: Partial<TrialSession>): Promise<void>;
  /** Захватить ключ отправки: true — ключ наш, отправляем; false — уже отправлено (или отправляется). */
  claimSend(id: number, key: string): Promise<boolean>;
  /** Вернуть ключ после неудачной отправки, чтобы следующий тик повторил. */
  releaseSend(id: number, key: string): Promise<void>;
  logEvent(id: number, kind: TrialEventKind, meta?: Record<string, unknown>): Promise<void>;
};

export class TrialBlockedError extends Error {
  constructor(message = "bot was blocked by the user") {
    super(message);
    this.name = "TrialBlockedError";
  }
}

export type TrialTg = {
  /** Бросает TrialBlockedError, если человек остановил бота (403). */
  send(chatId: number | string, text: string, kb?: T.Keyboard): Promise<number | null>;
  edit(chatId: number | string, messageId: number, text: string, kb?: T.Keyboard): Promise<void>;
  answer(callbackQueryId: string, text?: string): Promise<void>;
  /** Фото по публичному URL (подпись до 1024 символов). Бросает TrialBlockedError на 403. */
  sendPhoto(chatId: number | string, photoUrl: string, caption?: string): Promise<number | null>;
};

export type TrialDeps = {
  store: TrialStore;
  tg: TrialTg;
  now: () => Date;
  library: () => Promise<LibraryRows>;
  coachChatId: string | null;
  landingUrl: string | null;
};

export type TrialFrom = { id: number; first_name?: string | null; username?: string | null };

// ── бот ──────────────────────────────────────────────────────────────────────

export function createTrialBot(deps: TrialDeps) {
  const { store, tg } = deps;
  const iso = () => deps.now().toISOString();

  async function notifyCoach(text: string): Promise<void> {
    if (!deps.coachChatId) return;
    try {
      await tg.send(deps.coachChatId, text);
    } catch (e) {
      console.warn(`[trial-bot] уведомление тренеру не ушло: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function whoOf(u: TrialUser): T.Who {
    return { firstName: u.first_name, username: u.username, id: u.telegram_user_id, source: u.last_source ?? u.first_source };
  }

  async function safeSend(u: TrialUser, text: string, kb?: T.Keyboard): Promise<number | null> {
    try {
      return await tg.send(u.chat_id, text, kb);
    } catch (e) {
      if (e instanceof TrialBlockedError) {
        await markBlocked(u);
        return null;
      }
      throw e;
    }
  }

  async function markBlocked(u: TrialUser): Promise<void> {
    await store.saveUser({ telegram_user_id: u.telegram_user_id, stopped_at: iso() });
    await store.logEvent(u.telegram_user_id, "blocked");
  }

  /** История недели до сегодняшнего дня (не включая): что было запланировано и как прошло. */
  function historyBefore(sessions: TrialSession[], today: string) {
    return sessions
      .filter((s) => s.scheduled_date < today)
      .sort((a, b) => a.idx - b.idx)
      .map((s) => ({ planned: plannedOf(s), checkin: s.checkin }));
  }

  function plannedOf(s: TrialSession): PlannedSession {
    if (s.preset_code === WALK_PRESET) return { kind: "walk" };
    return { kind: "rung", rung: s.rung ?? 1 };
  }

  async function firstWorkout(u: TrialUser): Promise<WorkoutText> {
    return workoutFor({ kind: "rung", rung: u.start_rung ?? 1 }, await deps.library());
  }

  // ── вход ───────────────────────────────────────────────────────────────────

  async function handleStart(input: { from: TrialFrom; chatId: number; source: string | null }): Promise<void> {
    const { from, chatId, source } = input;
    const existing = await store.getUser(from.id);
    await store.logEvent(from.id, "start", { source, returning: Boolean(existing) });

    // Посреди недели повторный вход не сбрасывает её: человек получает, где он сейчас.
    if (existing && existing.stage === "week" && !existing.stopped_at) {
      await store.saveUser({
        telegram_user_id: from.id,
        chat_id: chatId,
        last_source: source ?? existing.last_source,
        last_action_at: iso(),
      });
      const today = mskNow(deps.now()).date;
      const sessions = await store.getSessions(from.id);
      const next = sessions.filter((s) => s.scheduled_date > today).sort((a, b) => a.idx - b.idx)[0];
      await tg.send(chatId, T.alreadyInWeek(next?.scheduled_date ?? null));
      return;
    }

    await store.saveUser({
      telegram_user_id: from.id,
      chat_id: chatId,
      first_name: from.first_name ?? null,
      username: from.username ?? null,
      first_source: existing?.first_source ?? source,
      last_source: source,
      stage: "intro",
      test_q: null,
      stopped_at: null,
      last_action_at: iso(),
    });
    await tg.send(chatId, T.INTRO, T.INTRO_KB);
  }

  // ── кнопки ─────────────────────────────────────────────────────────────────

  async function handleCallback(input: {
    from: TrialFrom;
    chatId: number;
    messageId: number;
    callbackQueryId: string;
    cb: TrialCallback;
  }): Promise<void> {
    const { from, chatId, messageId, callbackQueryId, cb } = input;
    const u = await store.getUser(from.id);
    if (!u) {
      await tg.answer(callbackQueryId, T.STALE_BUTTON);
      return;
    }
    // Нажатие кнопки = человек снова с нами (мог разблокировать бота).
    const touch: Partial<TrialUser> & { telegram_user_id: number } = {
      telegram_user_id: u.telegram_user_id,
      chat_id: chatId,
      last_action_at: iso(),
      stopped_at: null,
    };

    switch (cb.kind) {
      case "go": {
        if (u.stage !== "intro") return void (await tg.answer(callbackQueryId));
        await tg.answer(callbackQueryId);
        await store.saveUser({ ...touch, stage: "test", test_q: 1, answers: {}, test_started_at: iso() });
        await store.logEvent(u.telegram_user_id, "test_started");
        const q = questionByNumber(1)!;
        await tg.edit(chatId, messageId, T.questionText(q), T.questionKb(q));
        return;
      }
      case "cont": {
        await tg.answer(callbackQueryId);
        if (u.stage !== "test" || !u.test_q) return;
        await store.saveUser(touch);
        const q = questionByNumber(u.test_q)!;
        await tg.send(chatId, T.questionText(q), T.questionKb(q));
        return;
      }
      case "answer":
        return onAnswer(u, touch, input, cb.n, cb.index);
      case "week": {
        await tg.answer(callbackQueryId);
        if (u.stage !== "result" && u.stage !== "declined") return;
        if (cb.yes) {
          await store.saveUser({ ...touch, stage: "choose_days" });
          const runs = u.weekly_runs === 2 ? 2 : 3;
          await tg.send(chatId, T.chooseDaysText(runs), T.chooseDaysKb(patternsFor(runs)));
        } else {
          if (u.stage === "declined") return;
          await store.saveUser({ ...touch, stage: "declined", week_declined_at: iso() });
          await store.logEvent(u.telegram_user_id, "week_declined");
          await tg.send(chatId, T.DECLINED, T.DECLINED_KB);
        }
        return;
      }
      case "days": {
        await tg.answer(callbackQueryId);
        if (u.stage !== "choose_days") return;
        const pattern = DAY_PATTERNS[cb.pattern];
        if (!pattern || pattern.runs !== (u.weekly_runs === 2 ? 2 : 3)) return;
        const nowMsk = mskNow(deps.now());
        const week = buildWeek(nowMsk.date, cb.pattern, nowMsk.minutes);
        if (!week) return;
        const startRung = u.start_rung ?? 1;
        const first = workoutFor({ kind: "rung", rung: startRung }, await deps.library());
        await store.replaceSessions(
          u.telegram_user_id,
          week.dates.map((d, i) => ({
            telegram_user_id: u.telegram_user_id,
            idx: i + 1,
            scheduled_date: d,
            rung: startRung,
            preset_code: first.presetCode,
            title: first.title,
            body: first.body,
            checkin: null,
            checkin_at: null,
            morning_sent_at: null,
          })),
        );
        await store.saveUser({
          ...touch,
          stage: "week",
          days_pattern: cb.pattern,
          week_start: week.weekStart,
          week_opted_at: iso(),
          offer4_at: null,
          day7_at: null,
          base_requested_at: null,
          followup8_at: null,
          followup10_at: null,
          channel_at: null,
        });
        await store.logEvent(u.telegram_user_id, "week_opted", { pattern: cb.pattern, week_start: week.weekStart });
        await tg.edit(chatId, messageId, `${T.chooseDaysText(pattern.runs)}\n\n${pattern.label}`);
        await tg.send(chatId, T.weekConfirmed(week.dates, week.startsToday));
        // Неделя началась сегодня: утреннее окно могло пройти, первую тренировку шлём сразу.
        // Ключ тот же, что у утреннего тика, поэтому тик её не повторит.
        if (week.startsToday) {
          const fresh = await store.getUser(u.telegram_user_id);
          const key = `w${week.weekStart}:morning:1`;
          if (fresh && (await store.claimSend(u.telegram_user_id, key))) {
            try {
              await perform(fresh, { kind: "morning", key, idx: 1, immediate: true }, await store.getSessions(u.telegram_user_id));
            } catch (e) {
              await store.releaseSend(u.telegram_user_id, key).catch(() => undefined);
              throw e;
            }
          }
        }
        return;
      }
      case "checkin":
        return onCheckin(u, touch, input, cb.idx, cb.value);
      case "d4later": {
        await tg.answer(callbackQueryId);
        await store.saveUser(touch);
        await store.logEvent(u.telegram_user_id, "offer4_later");
        await tg.send(chatId, T.D4_LATER);
        return;
      }
      case "base": {
        await tg.answer(callbackQueryId);
        if (cb.yes) {
          const first = !u.base_requested_at;
          await store.saveUser({ ...touch, base_requested_at: u.base_requested_at ?? iso() });
          await store.logEvent(u.telegram_user_id, "base_click");
          await tg.send(chatId, T.BASE_YES, T.BASE_YES_KB);
          if (first) {
            const sessions = await store.getSessions(u.telegram_user_id);
            await notifyCoach(T.coachBase(whoOf(u), sessions.filter((s) => isDone(s.checkin)).length, sessions.length));
          }
        } else {
          await store.saveUser(touch);
          await store.logEvent(u.telegram_user_id, "base_later");
          await tg.send(chatId, T.BASE_NO);
        }
        return;
      }
    }
  }

  async function onAnswer(
    u: TrialUser,
    touch: Partial<TrialUser> & { telegram_user_id: number },
    input: { chatId: number; messageId: number; callbackQueryId: string },
    n: number,
    index: number,
  ): Promise<void> {
    const { chatId, messageId, callbackQueryId } = input;
    // Старая кнопка (вопрос уже отвечен или тест не идёт): ничего не меняем.
    if (u.stage !== "test" || u.test_q !== n) {
      await tg.answer(callbackQueryId, T.STALE_BUTTON);
      return;
    }
    const option = optionAt(n, index)!;
    await tg.answer(callbackQueryId);

    if (n < QUESTION_COUNT) {
      const answers = withAnswer(u.answers ?? {}, n, option.code);
      await store.saveUser({ ...touch, answers, test_q: n + 1 });
      await store.logEvent(u.telegram_user_id, "answer", { n, code: option.code });
      const q = questionByNumber(n + 1)!;
      await tg.edit(chatId, messageId, T.questionText(q), T.questionKb(q));
      return;
    }

    // Шестой вопрос: в базу и в события идёт ТОЛЬКО флаг, не то, что именно отмечено.
    const outcome = testOutcome(u.answers ?? {}, option.code);
    const healthFlag = outcome.kind === "health_stop";
    await tg.edit(chatId, messageId, T.TEST_DONE);

    if (outcome.kind === "health_stop") {
      await store.saveUser({ ...touch, stage: "health_stop", test_q: null, health_flag: true, test_completed_at: iso() });
      await store.logEvent(u.telegram_user_id, "health_stop");
      await tg.send(chatId, T.HEALTH_STOP, T.HEALTH_KB);
      await notifyCoach(T.coachHealth(whoOf(u)));
      return;
    }
    if (outcome.kind === "already_runner") {
      await store.saveUser({ ...touch, stage: "already_runner", test_q: null, health_flag: healthFlag, test_completed_at: iso() });
      await store.logEvent(u.telegram_user_id, "already_runner");
      await tg.send(chatId, T.ALREADY_RUNNER, T.ALREADY_KB);
      return;
    }

    const updated: TrialUser = { ...u, start_rung: outcome.startRung };
    await store.saveUser({
      ...touch,
      stage: "result",
      test_q: null,
      health_flag: false,
      result_type: outcome.resultType,
      start_rung: outcome.startRung,
      weekly_runs: outcome.weeklyRuns,
      test_completed_at: iso(),
    });
    await store.logEvent(u.telegram_user_id, "test_completed", { result_type: outcome.resultType, start_rung: outcome.startRung });
    await tg.send(chatId, T.resultCard(outcome.resultType, await firstWorkout(updated)));
    await tg.send(chatId, T.OFFER_WEEK, T.OFFER_WEEK_KB);
  }

  async function onCheckin(
    u: TrialUser,
    touch: Partial<TrialUser> & { telegram_user_id: number },
    input: { chatId: number; messageId: number; callbackQueryId: string },
    idx: number,
    value: Checkin,
  ): Promise<void> {
    const { chatId, messageId, callbackQueryId } = input;
    const sessions = await store.getSessions(u.telegram_user_id);
    const s = sessions.find((x) => x.idx === idx);
    // Первый ответ окончательный: повторное нажатие ничего не меняет.
    if (!s || s.checkin !== null || (u.stage !== "week" && u.stage !== "post")) {
      await tg.answer(callbackQueryId, T.STALE_BUTTON);
      return;
    }
    await tg.answer(callbackQueryId);
    await store.updateSession(u.telegram_user_id, idx, { checkin: value, checkin_at: iso() });
    await store.saveUser(touch);
    await store.logEvent(u.telegram_user_id, "checkin", { idx, value });
    await tg.edit(chatId, messageId, T.eveningAnswered(value));
    await tg.send(chatId, T.CHECKIN_REPLIES[value]);
    if (value === "pain") await notifyCoach(T.coachPain(whoOf(u), idx, s.title ?? s.preset_code ?? "тренировка"));

    // Последняя отметка вечером седьмого дня: итог сразу, не дожидаясь 20:30.
    const fresh = await store.getUser(u.telegram_user_id);
    if (fresh) await runForUser(fresh);
  }

  // ── плановые сообщения ─────────────────────────────────────────────────────

  type TickCounts = { users: number; sent: number; blocked: number; errors: number };

  async function runForUser(u: TrialUser, counts?: TickCounts): Promise<void> {
    const sessions = await store.getSessions(u.telegram_user_id);
    const now = deps.now();
    const actions = dueActions(
      {
        stage: u.stage,
        stopped: Boolean(u.stopped_at),
        test_q: u.test_q,
        last_action_at: u.last_action_at,
        test_started_at: u.test_started_at,
        week_start: u.week_start,
        base_requested: Boolean(u.base_requested_at),
        offer_sent_on: u.offer4_at ? mskNow(new Date(u.offer4_at)).date : null,
      },
      sessions.map((s) => ({ idx: s.idx, date: s.scheduled_date, checkin: s.checkin, checkin_at: s.checkin_at })),
      now,
    );

    for (const a of actions) {
      if (a.kind === "set_stage") {
        await store.saveUser({ telegram_user_id: u.telegram_user_id, stage: a.stage });
        continue;
      }
      if (!(await store.claimSend(u.telegram_user_id, a.key))) continue;
      try {
        const sent = await perform(u, a, sessions);
        if (sent === "blocked") {
          if (counts) counts.blocked += 1;
          return;
        }
        if (counts && sent) counts.sent += 1;
      } catch (e) {
        await store.releaseSend(u.telegram_user_id, a.key).catch(() => undefined);
        if (counts) counts.errors += 1;
        console.error(`[trial-bot] ${a.kind} для ${u.telegram_user_id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  /** true — отправлено; "blocked" — человек остановил бота, дальше по нему ничего не делаем. */
  async function perform(u: TrialUser, a: Exclude<DueAction, { kind: "set_stage" }>, sessions: TrialSession[]): Promise<true | "blocked"> {
    const send = async (text: string, kb?: T.Keyboard): Promise<true | "blocked"> => {
      try {
        await tg.send(u.chat_id, text, kb);
        return true;
      } catch (e) {
        if (e instanceof TrialBlockedError) {
          await markBlocked(u);
          return "blocked";
        }
        throw e;
      }
    };
    /**
     * История ученика: фото с подписью. Подпись длиннее лимита: фото отдельно, текст следом.
     * Telegram не принял фото (не 403): шлём только текст, чтобы история не потерялась.
     */
    const sendCase = async (story: T.CaseStory): Promise<"photo" | "text" | "blocked"> => {
      if (!story.photoUrl) {
        const r = await send(story.text);
        return r === "blocked" ? r : "text";
      }
      try {
        if (story.text.length <= T.CAPTION_LIMIT) {
          await tg.sendPhoto(u.chat_id, story.photoUrl, story.text);
        } else {
          await tg.sendPhoto(u.chat_id, story.photoUrl);
          const r = await send(story.text);
          if (r === "blocked") return r;
        }
        return "photo";
      } catch (e) {
        if (e instanceof TrialBlockedError) {
          await markBlocked(u);
          return "blocked";
        }
        console.warn(`[trial-bot] фото не ушло, шлю текст: ${e instanceof Error ? e.message : String(e)}`);
        const r = await send(story.text);
        return r === "blocked" ? r : "text";
      }
    };
    const id = u.telegram_user_id;
    const today = mskNow(deps.now()).date;

    switch (a.kind) {
      case "nudge": {
        const r = await send(T.nudgeText(u.test_q ?? 1), T.NUDGE_KB);
        if (r === true) await store.logEvent(id, "nudge_sent", { n: u.test_q });
        return r;
      }
      case "morning": {
        const startRung = u.start_rung ?? 1;
        const planned = planNext(startRung, historyBefore(sessions, today));
        const w = planned.kind === "walk" ? WALK_WORKOUT : workoutFor(planned, await deps.library());
        await store.updateSession(id, a.idx, {
          rung: planned.kind === "rung" ? planned.rung : sessions.find((s) => s.idx === a.idx)?.rung ?? startRung,
          preset_code: w.presetCode,
          title: w.title,
          body: w.body,
          morning_sent_at: deps.now().toISOString(),
        });
        const r = await send(planned.kind === "walk" ? T.MORNING_WALK : T.morningText(w, a.immediate === true));
        if (r === true) await store.logEvent(id, "morning_sent", { idx: a.idx, preset: w.presetCode });
        return r;
      }
      case "evening": {
        const r = await send(T.EVENING, T.eveningKb(a.idx));
        if (r === true) await store.logEvent(id, "evening_sent", { idx: a.idx });
        return r;
      }
      case "case1":
      case "case2": {
        const story = a.kind === "case1" ? T.CASE_MARINA : T.CASE_LENA;
        const r = await sendCase(story);
        if (r === "blocked") return r;
        await store.logEvent(id, "case_sent", { which: a.kind, as: r });
        return true;
      }
      case "day4": {
        const before = sessions.filter((s) => s.scheduled_date < today);
        const done = before.filter((s) => isDone(s.checkin)).length;
        const r = await send(T.day4Text(done, before.length), T.day4Kb(deps.landingUrl));
        if (r === true) {
          await store.saveUser({ telegram_user_id: id, offer4_at: deps.now().toISOString() });
          await store.logEvent(id, "offer4_sent", { done, planned: before.length });
        }
        return r;
      }
      case "day7": {
        const sorted = [...sessions].sort((x, y) => x.idx - y.idx);
        const history = sorted.map((s) => ({ planned: plannedOf(s), checkin: s.checkin }));
        const doneRows = sorted.filter((s) => isDone(s.checkin));
        const walks = doneRows.filter((s) => s.preset_code === WALK_PRESET).length;
        const done = doneRows.length;
        const counts: Partial<Record<Checkin, number>> = {};
        for (const s of sorted) if (s.checkin) counts[s.checkin] = (counts[s.checkin] ?? 0) + 1;
        const startRung = u.start_rung ?? 1;
        const advice = weekAdvice(startRung, history);
        const lib = await deps.library();
        const nextTitle = workoutFor({ kind: "rung", rung: done === 0 ? startRung : advice.rung }, lib).title;
        const r = await send(T.day7Text(done - walks, walks, counts, advice, nextTitle), T.BASE_KB);
        if (r === true) {
          await store.saveUser({ telegram_user_id: id, day7_at: deps.now().toISOString() });
          await store.logEvent(id, "day7_sent", { done, advice: advice.kind });
        }
        return r;
      }
      case "fu8":
      case "fu10": {
        const r = await send(a.kind === "fu8" ? T.FOLLOWUP_8 : T.FOLLOWUP_10, T.FOLLOWUP_KB);
        if (r === true) {
          // История ученика отдельным сообщением следом: день 8 Надя, день 10 Саша.
          const story = a.kind === "fu8" ? T.CASE_NADYA : T.CASE_SASHA;
          const c = await sendCase(story);
          if (c === "blocked") return c;
          await store.logEvent(id, "case_sent", { which: a.kind === "fu8" ? "nadya" : "sasha", as: c });
          await store.saveUser({ telegram_user_id: id, [a.kind === "fu8" ? "followup8_at" : "followup10_at"]: deps.now().toISOString() });
          await store.logEvent(id, "followup_sent", { which: a.kind });
        }
        return r;
      }
      case "channel": {
        const r = await send(T.CHANNEL_TEXT, T.CHANNEL_KB);
        if (r === true) {
          await store.saveUser({ telegram_user_id: id, channel_at: deps.now().toISOString(), stage: "done" });
          await store.logEvent(id, "channel_sent");
        }
        return r;
      }
    }
  }

  async function runTick(): Promise<TickCounts> {
    const users = await store.listScheduled();
    const counts: TickCounts = { users: users.length, sent: 0, blocked: 0, errors: 0 };
    for (const u of users) {
      try {
        await runForUser(u, counts);
      } catch (e) {
        counts.errors += 1;
        console.error(`[trial-bot] тик для ${u.telegram_user_id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return counts;
  }

  /** Свободный текст от участника пробной недели. false — человек не участник, решает вебхук. */
  async function handleText(input: { from: TrialFrom; chatId: number }): Promise<boolean> {
    const u = await store.getUser(input.from.id);
    if (!u) return false;
    await store.saveUser({ telegram_user_id: u.telegram_user_id, last_action_at: iso() });
    await store.logEvent(u.telegram_user_id, "text_hint");
    await safeSend(u, T.TEXT_HINT, T.TEXT_HINT_KB);
    return true;
  }

  return { handleStart, handleCallback, handleText, runTick, runForUser };
}

export type TrialBot = ReturnType<typeof createTrialBot>;
