/**
 * Заведение ученика прямо в боте: «постучался — завести — ответить на вопросы».
 *
 * ── ПОЧЕМУ ЭТО ВООБЩЕ ПОНАДОБИЛОСЬ ──────────────────────────────────────────
 *
 * Заведение из терминала упирается в вопрос без ответа: откуда тренер возьмёт
 * telegram id человека, который ему ещё НЕ ПИСАЛ. Ниоткуда. В телеграме нет
 * поиска по имени, отдающего id, а сама она свой id не знает и найти его не
 * сумеет. Единственный надёжный источник id — её собственное сообщение боту.
 *
 * Отсюда правильный порядок, обратный привычному: она пишет первой, бот
 * показывает тренеру, кто постучался, тренер жмёт кнопку. Тогда id берётся
 * оттуда, где он достоверен, и искать его не нужно вообще.
 *
 * ── ДВА ПУТИ, ОДИН ДИАЛОГ ───────────────────────────────────────────────────
 *
 * 1. Она написала боту → тренеру уведомление с кнопкой «Завести ученика».
 * 2. Тренер сам прислал боту её id или ПЕРЕСЛАЛ её сообщение.
 * Дальше в обоих случаях один и тот же диалог, потому что вопросы одни и те же.
 *
 * ── ЧЕГО ЗДЕСЬ НАМЕРЕННО НЕТ ────────────────────────────────────────────────
 *
 * Свободного ввода там, где хватает кнопок. Кнопка не опечатывается, не требует
 * разбора и не ставит бота в положение «я не понял, повторите»: для тренера,
 * который заводит человека с телефона на бегу, это разница между пятнадцатью
 * секундами и минутой раздражения.
 */

import {
  answerTelegramCallbackQuery,
  sendTelegramMessageStrict,
} from "@/features/telegram/telegram-client";
import { createSupabaseServerClient, describeSupabaseError } from "@/features/supabase/server";
import { listActiveStudentsByTelegramUserId } from "@/features/trainingpeaks/repository";
import type { PrefillableField } from "@/features/intervals/loop/prefill";

import { buildStudentKey, createIntervalsStudent } from "./enrollment";
import { handleRunStartCommand } from "./run-start-onboarding";

/** Префикс всех кнопок этого диалога. Чужие обработчики его не трогают. */
export const ENROLL_CALLBACK_PREFIX = "iv:";

type Step = "name" | "goal" | "days" | "continuity" | "health" | "confirm" | "done" | "cancelled";

type Draft = {
  id: string;
  coachChatId: string;
  telegramUserId: number;
  telegramUsername: string | null;
  suggestedName: string | null;
  studentName: string | null;
  step: Step;
  goalKind: string | null;
  daysPerWeek: number | null;
  canRunContinuously: boolean | null;
  healthLimits: string | null;
};

function toDraft(row: Record<string, unknown>): Draft {
  return {
    id: String(row.id),
    coachChatId: String(row.coach_chat_id),
    telegramUserId: Number(row.telegram_user_id),
    telegramUsername: (row.telegram_username as string | null) ?? null,
    suggestedName: (row.suggested_name as string | null) ?? null,
    studentName: (row.student_name as string | null) ?? null,
    step: String(row.step) as Step,
    goalKind: (row.goal_kind as string | null) ?? null,
    daysPerWeek: row.days_per_week === null || row.days_per_week === undefined ? null : Number(row.days_per_week),
    canRunContinuously:
      row.can_run_continuously === null || row.can_run_continuously === undefined
        ? null
        : row.can_run_continuously === true,
    healthLimits: (row.health_limits as string | null) ?? null,
  };
}

const GOAL_LABELS: Record<string, string> = {
  race: "готовится к старту",
  improve: "улучшать результаты",
  regular: "бегать регулярно",
  start_running: "начинает с нуля",
};

// ── Незнакомый человек ──────────────────────────────────────────────────────

/**
 * Кто-то написал боту, и мы его не знаем.
 *
 * ОДНО УВЕДОМЛЕНИЕ НА ЧЕЛОВЕКА, А НЕ НА СООБЩЕНИЕ. Человек, которому не
 * ответили, пишет ещё и ещё; тренер получил бы пять одинаковых уведомлений и
 * перестал бы их читать на третьем.
 *
 * ЕЙ САМОЙ БОТ НЕ ОТВЕЧАЕТ НИЧЕГО. Это сознательно: пока тренер не решил,
 * ученица она или ошиблась адресом, любое приветствие было бы обещанием.
 */
export async function noticeUnknownVisitor(input: {
  from: { id: number; first_name?: string | null; last_name?: string | null; username?: string | null };
  chatId: string | number;
  coachChatId: string | null;
}): Promise<void> {
  if (!input.coachChatId) return;
  const supabase = createSupabaseServerClient();
  const displayName = [input.from.first_name, input.from.last_name].filter(Boolean).join(" ").trim();

  const { data: existing } = await supabase
    .from("intervals_bot_visitors")
    .select("telegram_user_id, notified_at, status")
    .eq("telegram_user_id", input.from.id)
    .maybeSingle();

  await supabase.from("intervals_bot_visitors").upsert(
    {
      telegram_user_id: input.from.id,
      chat_id: String(input.chatId),
      first_name: displayName || null,
      username: input.from.username ?? null,
      last_seen_at: new Date().toISOString(),
      ...(existing ? {} : { first_seen_at: new Date().toISOString() }),
    },
    { onConflict: "telegram_user_id" }
  );

  const row = existing as { notified_at: string | null; status: string } | null;
  if (row?.notified_at) return;
  if (row?.status === "ignored") return;

  const who = displayName || "без имени";
  const handle = input.from.username ? ` (@${input.from.username})` : "";
  // Кнопка с callback_data: нажатие должно вернуться в бота и начать диалог, а
  // не увести тренера по ссылке.
  await sendCallbackButton({
    chatId: input.coachChatId,
    text:
      `Незнакомый человек написал боту: ${who}${handle}\n` +
      `telegram id ${input.from.id}\n\n` +
      "Если это новая ученица, заведите её кнопкой ниже: id возьмётся отсюда, искать его не нужно.",
    buttons: [
      [{ label: "Завести ученика", data: `${ENROLL_CALLBACK_PREFIX}new:${input.from.id}` }],
      [{ label: "Не наш человек", data: `${ENROLL_CALLBACK_PREFIX}ignore:${input.from.id}` }],
    ],
  });

  await supabase
    .from("intervals_bot_visitors")
    .update({ notified_at: new Date().toISOString() })
    .eq("telegram_user_id", input.from.id);
}

async function sendCallbackButton(input: {
  chatId: string | number;
  text: string;
  buttons: Array<Array<{ label: string; data: string }>>;
}): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: input.chatId,
      text: input.text,
      reply_markup: {
        inline_keyboard: input.buttons.map((row) =>
          row.map((button) => ({ text: button.label, callback_data: button.data }))
        ),
      },
    }),
  });
}

// ── Диалог ──────────────────────────────────────────────────────────────────

async function openDraft(coachChatId: string): Promise<Draft | null> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("intervals_enrollment_drafts")
    .select("*")
    .eq("coach_chat_id", coachChatId)
    .not("step", "in", "(done,cancelled)")
    .maybeSingle();
  return data ? toDraft(data as Record<string, unknown>) : null;
}

async function patchDraft(id: string, patch: Record<string, unknown>): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("intervals_enrollment_drafts")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`черновик не обновился: ${describeSupabaseError(error)}`);
}

/** Вопрос текущего шага. Вся разница между шагами живёт здесь, одной таблицей. */
async function askStep(draft: Draft): Promise<void> {
  const chatId = draft.coachChatId;
  switch (draft.step) {
    case "name":
      await sendCallbackButton({
        chatId,
        text:
          `Заводим ученика, telegram id ${draft.telegramUserId}.\n\n` +
          "Как его записать? Можно оставить имя из телеграма или прислать своё сообщением.",
        buttons: [
          ...(draft.suggestedName
            ? [[{ label: `Оставить «${draft.suggestedName}»`, data: `${ENROLL_CALLBACK_PREFIX}name:keep` }]]
            : []),
          [{ label: "Отменить", data: `${ENROLL_CALLBACK_PREFIX}cancel` }],
        ],
      });
      return;
    case "goal":
      await sendCallbackButton({
        chatId,
        text: `${draft.studentName}: какая цель?`,
        buttons: [
          [{ label: "Готовится к старту", data: `${ENROLL_CALLBACK_PREFIX}goal:race` }],
          [{ label: "Улучшать результаты", data: `${ENROLL_CALLBACK_PREFIX}goal:improve` }],
          [{ label: "Бегать регулярно", data: `${ENROLL_CALLBACK_PREFIX}goal:regular` }],
          [{ label: "Начинает с нуля", data: `${ENROLL_CALLBACK_PREFIX}goal:start_running` }],
          [{ label: "Отменить", data: `${ENROLL_CALLBACK_PREFIX}cancel` }],
        ],
      });
      return;
    case "days":
      await sendCallbackButton({
        chatId,
        text: "Сколько беговых дней в неделю?",
        buttons: [
          [2, 3, 4].map((n) => ({ label: String(n), data: `${ENROLL_CALLBACK_PREFIX}days:${n}` })),
          [5, 6].map((n) => ({ label: String(n), data: `${ENROLL_CALLBACK_PREFIX}days:${n}` })),
          [{ label: "Пусть решит сама", data: `${ENROLL_CALLBACK_PREFIX}days:ask` }],
        ],
      });
      return;
    case "continuity":
      await sendCallbackButton({
        chatId,
        text: "Бежит ли непрерывно хотя бы двадцать минут?",
        buttons: [
          [{ label: "Да, бежит", data: `${ENROLL_CALLBACK_PREFIX}cont:yes` }],
          [{ label: "Пока нет", data: `${ENROLL_CALLBACK_PREFIX}cont:no` }],
          [{ label: "Не знаю", data: `${ENROLL_CALLBACK_PREFIX}cont:unknown` }],
        ],
      });
      return;
    case "health":
      await sendCallbackButton({
        chatId,
        text:
          "Что важно знать про здоровье? Травмы, ограничения, на что беречься.\n\n" +
          "Пришлите сообщением или пропустите.",
        buttons: [[{ label: "Ничего важного", data: `${ENROLL_CALLBACK_PREFIX}health:skip` }]],
      });
      return;
    case "confirm": {
      const lines = [
        `Имя: ${draft.studentName}`,
        `Telegram id: ${draft.telegramUserId}`,
        `Цель: ${draft.goalKind ? GOAL_LABELS[draft.goalKind] : "не задана"}`,
        `Дней в неделю: ${draft.daysPerWeek ?? "спросим её саму"}`,
        `Непрерывно: ${
          draft.canRunContinuously === null ? "не задано" : draft.canRunContinuously ? "да" : "нет"
        }`,
        `Здоровье: ${draft.healthLimits ?? "ничего не отмечено"}`,
      ];
      await sendCallbackButton({
        chatId,
        text:
          `Проверьте:\n\n${lines.join("\n")}\n\n` +
          "Что задали вы, ученица в анкете не увидит вообще: спрашивать о том, что уже знаете, незачем.",
        buttons: [
          [{ label: "Завести", data: `${ENROLL_CALLBACK_PREFIX}confirm` }],
          [{ label: "Отменить", data: `${ENROLL_CALLBACK_PREFIX}cancel` }],
        ],
      });
      return;
    }
    default:
      return;
  }
}

/** Следующий шаг после текущего. Пропуски решаются здесь, а не в каждом обработчике. */
function nextStep(draft: Draft): Step {
  switch (draft.step) {
    case "name":
      return "goal";
    case "goal":
      return "days";
    case "days":
      return "continuity";
    case "continuity":
      return "health";
    case "health":
      return "confirm";
    default:
      return "confirm";
  }
}

/**
 * Записать ответ и задать следующий вопрос.
 *
 * ЧЕРНОВИК ПЕРЕЧИТЫВАЕТСЯ ИЗ БАЗЫ, а не собирается из кусков в памяти: вопрос
 * следующего шага показывает уже сохранённые ответы («Валентина: какая цель?»),
 * и собранный вручную объект однажды разойдётся с тем, что реально записано.
 */
async function advance(draft: Draft, patch: Record<string, unknown>): Promise<void> {
  const step = nextStep(draft);
  await patchDraft(draft.id, { ...patch, step });
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("intervals_enrollment_drafts")
    .select("*")
    .eq("id", draft.id)
    .maybeSingle();
  if (!data) return;
  await askStep(toDraft(data as Record<string, unknown>));
}

/**
 * Начать диалог.
 *
 * ЗАНЯТО — ЗНАЧИТ ЗАНЯТО. Один открытый диалог на тренера, потому что ответ
 * «3» на вопрос о днях невозможно отнести к нужному человеку, если диалогов
 * два. Уникальный индекс в базе стережёт это даже при гонке.
 */
export async function startEnrollment(input: {
  coachChatId: string;
  telegramUserId: number;
  suggestedName: string | null;
  username: string | null;
}): Promise<void> {
  const supabase = createSupabaseServerClient();

  const cards = await listActiveStudentsByTelegramUserId(input.telegramUserId).catch(() => []);
  if (cards.length > 0) {
    await sendTelegramMessageStrict(
      input.coachChatId,
      `Этот человек уже заведён: ${cards[0].studentName} (${cards[0].coachingPlatform}). Второй карточки не делаю.`
    );
    return;
  }

  const existing = await openDraft(input.coachChatId);
  if (existing) {
    await sendTelegramMessageStrict(
      input.coachChatId,
      "Уже идёт заведение другого человека. Закончите его или нажмите «Отменить» в том сообщении."
    );
    return;
  }

  const { data, error } = await supabase
    .from("intervals_enrollment_drafts")
    .insert({
      coach_chat_id: input.coachChatId,
      telegram_user_id: input.telegramUserId,
      telegram_username: input.username,
      suggested_name: input.suggestedName,
      student_name: input.suggestedName,
      step: "name",
    })
    .select("*")
    .single();
  if (error) throw new Error(`черновик не завёлся: ${describeSupabaseError(error)}`);
  await askStep(toDraft(data as Record<string, unknown>));
}

/** Ответ кнопкой. Возвращает true, если кнопка наша. */
export async function handleEnrollmentCallback(input: {
  coachChatId: string;
  callbackQueryId: string;
  data: string;
}): Promise<boolean> {
  if (!input.data.startsWith(ENROLL_CALLBACK_PREFIX)) return false;
  const payload = input.data.slice(ENROLL_CALLBACK_PREFIX.length);
  const [action, value] = payload.split(":");
  const supabase = createSupabaseServerClient();

  if (action === "new") {
    await answerTelegramCallbackQuery(input.callbackQueryId, "Завожу");
    const userId = Number(value);
    const { data: visitor } = await supabase
      .from("intervals_bot_visitors")
      .select("first_name, username")
      .eq("telegram_user_id", userId)
      .maybeSingle();
    const row = visitor as { first_name: string | null; username: string | null } | null;
    await startEnrollment({
      coachChatId: input.coachChatId,
      telegramUserId: userId,
      suggestedName: row?.first_name ?? null,
      username: row?.username ?? null,
    });
    return true;
  }

  if (action === "ignore") {
    await answerTelegramCallbackQuery(input.callbackQueryId, "Скрыл");
    await supabase
      .from("intervals_bot_visitors")
      .update({ status: "ignored" })
      .eq("telegram_user_id", Number(value));
    await sendTelegramMessageStrict(input.coachChatId, "Понял, больше про него не напоминаю.");
    return true;
  }

  const draft = await openDraft(input.coachChatId);
  if (!draft) {
    await answerTelegramCallbackQuery(input.callbackQueryId, "Диалог уже закрыт");
    return true;
  }

  if (action === "cancel") {
    await answerTelegramCallbackQuery(input.callbackQueryId, "Отменил");
    await patchDraft(draft.id, { step: "cancelled" });
    await sendTelegramMessageStrict(input.coachChatId, "Заведение отменено, ничего не создано.");
    return true;
  }

  await answerTelegramCallbackQuery(input.callbackQueryId);

  if (action === "name" && value === "keep") {
    await advance(draft, { student_name: draft.suggestedName });
    return true;
  }
  if (action === "goal") {
    await advance(draft, { goal_kind: value });
    return true;
  }
  if (action === "days") {
    await advance(draft, { days_per_week: value === "ask" ? null : Number(value) });
    return true;
  }
  if (action === "cont") {
    await advance(draft, {
      can_run_continuously: value === "unknown" ? null : value === "yes",
    });
    return true;
  }
  if (action === "health" && value === "skip") {
    await advance(draft, { health_limits: null });
    return true;
  }
  if (action === "confirm") {
    await finishEnrollment(draft);
    return true;
  }
  return true;
}

/** Ответ текстом: имя и здоровье. Возвращает true, если сообщение было ответом. */
export async function handleEnrollmentText(input: {
  coachChatId: string;
  text: string;
}): Promise<boolean> {
  const draft = await openDraft(input.coachChatId);
  if (!draft) return false;
  const text = input.text.trim();
  if (text.length === 0) return false;

  if (draft.step === "name") {
    await advance(draft, { student_name: text.slice(0, 120) });
    return true;
  }
  if (draft.step === "health") {
    await advance(draft, { health_limits: text.slice(0, 1000) });
    return true;
  }
  // На шагах с кнопками текст игнорируем молча: подсказка уже висит в вопросе,
  // а «я не понял» на каждое слово превращает диалог в препирательство.
  return false;
}

/**
 * Завести и сразу позвать ученицу в приложение.
 *
 * ССЫЛКУ ШЛЁТ БОТ, А НЕ ТРЕНЕР. Копировать её руками — лишний шаг ровно в тот
 * момент, когда тренер уже закончил работу и переключился.
 */
async function finishEnrollment(draft: Draft): Promise<void> {
  const setFields: PrefillableField[] = [];
  const values: Record<string, unknown> = {};
  if (draft.goalKind) {
    setFields.push("goalKind");
    values.goalKind = draft.goalKind;
  }
  if (draft.daysPerWeek !== null) {
    setFields.push("daysPerWeek");
    values.daysPerWeek = draft.daysPerWeek;
  }
  if (draft.canRunContinuously !== null) {
    setFields.push("canRunContinuously");
    values.canRunContinuously = draft.canRunContinuously;
  }
  if (draft.healthLimits) {
    setFields.push("healthLimits");
    values.healthLimits = draft.healthLimits;
  }

  const name = draft.studentName ?? draft.suggestedName ?? `Ученик ${draft.telegramUserId}`;
  const studentKey = buildStudentKey(name, draft.telegramUserId);

  try {
    const created = await createIntervalsStudent({
      studentKey,
      name,
      telegramUserId: draft.telegramUserId,
      telegramChatId: String(draft.telegramUserId),
      athleteId: null,
      prefill: {
        setFields,
        values: values as never,
        note: "заведено через бота",
        setBy: `coach:bot:${draft.coachChatId}`,
      },
    });

    await patchDraft(draft.id, { step: "done", created_student_uuid: created.studentUuid });
    const supabase = createSupabaseServerClient();
    await supabase
      .from("intervals_bot_visitors")
      .update({ status: "enrolled" })
      .eq("telegram_user_id", draft.telegramUserId);

    await sendTelegramMessageStrict(
      draft.coachChatId,
      `Готово: ${name} заведена.\n` +
        `Карточка: ${studentKey}\n` +
        `Скрыто в её анкете: ${setFields.length > 0 ? setFields.join(", ") : "ничего"}\n\n` +
        "Ей отправлено приглашение с кнопкой «Открыть приложение». Дальше она подключает часы " +
        "сама, а вы увидите её в списке учеников Intervals."
    );

    // Приглашение ученице: та же кнопка, что и на /start run.
    await handleRunStartCommand({
      chatId: draft.telegramUserId,
      from: { id: draft.telegramUserId },
    });
  } catch (error) {
    await sendTelegramMessageStrict(
      draft.coachChatId,
      `Не получилось завести: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/** Есть ли у тренера открытый диалог. Нужно вебхуку, чтобы не съесть чужой текст. */
export async function hasOpenEnrollment(coachChatId: string): Promise<boolean> {
  return (await openDraft(coachChatId)) !== null;
}
