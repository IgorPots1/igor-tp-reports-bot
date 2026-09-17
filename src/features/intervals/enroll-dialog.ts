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
import { createSupabaseServerClient } from "@/features/supabase/server";
import { listActiveStudentsByTelegramUserId } from "@/features/trainingpeaks/repository";

import { buildStudentKey, createIntervalsStudent } from "./enrollment";
import { handleRunStartCommand } from "./run-start-onboarding";

/** Префикс всех кнопок этого диалога. Чужие обработчики его не трогают. */
export const ENROLL_CALLBACK_PREFIX = "iv:";

/**
 * Шаги остались в базе от прежнего диалога, но используется только name —
 * окно на переименование сразу после заведения. Констрейнт не трогаем: сузить
 * список значений — это разрушительная правка ради красоты, а лишние значения
 * никому не мешают.
 */
type Step = "name" | "goal" | "days" | "continuity" | "health" | "confirm" | "done" | "cancelled";

type Draft = {
  id: string;
  coachChatId: string;
  telegramUserId: number;
  telegramUsername: string | null;
  suggestedName: string | null;
  studentName: string | null;
  step: Step;
  createdStudentUuid: string | null;
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
    createdStudentUuid: (row.created_student_uuid as string | null) ?? null,
  };
}

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

// ── Заведение в одно нажатие ────────────────────────────────────────────────
//
// РАНЬШЕ ЗДЕСЬ БЫЛ ДИАЛОГ из пяти вопросов: цель, дни, непрерывный бег,
// здоровье, подтверждение. Он убран [решение Игоря, 15.09.2026] и вот почему:
// отвечать за человека на вопросы, которые он сам закроет за полминуты в
// анкете, — это работа тренеру, а не удобство ученику. Тренер жмёт кнопку,
// карточка появляется, приглашение уходит.
//
// ЕДИНСТВЕННОЕ, ЧТО ОСТАЛОСЬ СПРАШИВАТЬ, — имя, и то не вопросом: карточка уже
// заведена с именем из телеграма, а если оно кривое («Валя 🌸»), тренер
// присылает правильное следующим сообщением. Окно на переименование живёт в
// той же таблице черновиков, шаг name.
//
// ПРЕДЗАПОЛНЕНИЕ ИЗ БОТА УБРАНО ЦЕЛИКОМ, но сам механизм жив: из скрипта
// intervals-student-setup.ts тренер по-прежнему задаёт любое поле, когда
// действительно знает человека. Тогда вопроса в анкете не будет.

async function openRename(coachChatId: string): Promise<Draft | null> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("intervals_enrollment_drafts")
    .select("*")
    .eq("coach_chat_id", coachChatId)
    .eq("step", "name")
    .maybeSingle();
  return data ? toDraft(data as Record<string, unknown>) : null;
}

async function closeRename(id: string, patch: Record<string, unknown> = {}): Promise<void> {
  const supabase = createSupabaseServerClient();
  await supabase
    .from("intervals_enrollment_drafts")
    .update({ ...patch, step: "done", updated_at: new Date().toISOString() })
    .eq("id", id);
}

/**
 * Завести ученика и позвать его в приложение. Один шаг, без вопросов.
 *
 * ССЫЛКУ ШЛЁТ БОТ, А НЕ ТРЕНЕР: копировать её руками — лишнее действие ровно в
 * тот момент, когда тренер уже закончил и переключился на другое.
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

  const name = (input.suggestedName ?? "").trim() || `Ученик ${input.telegramUserId}`;
  const studentKey = buildStudentKey(name, input.telegramUserId);

  try {
    const created = await createIntervalsStudent({
      studentKey,
      name,
      telegramUserId: input.telegramUserId,
      telegramChatId: String(input.telegramUserId),
      athleteId: null,
      // ПРЕДЗАПОЛНЕНИЯ НЕТ: всё, что важно, она ответит сама в анкете.
      prefill: null,
    });

    // Окно на переименование: следующее обычное сообщение тренера в этот чат
    // будет прочитано как правильное имя.
    await supabase.from("intervals_enrollment_drafts").insert({
      coach_chat_id: input.coachChatId,
      telegram_user_id: input.telegramUserId,
      telegram_username: input.username,
      suggested_name: input.suggestedName,
      student_name: name,
      step: "name",
      created_student_uuid: created.studentUuid,
    });

    await supabase
      .from("intervals_bot_visitors")
      .update({ status: "enrolled" })
      .eq("telegram_user_id", input.telegramUserId);

    await sendCallbackButton({
      chatId: input.coachChatId,
      text:
        `Готово: ${name} заведена, приглашение ей отправлено.\n\n` +
        "Дальше она подключает часы и отвечает на вопросы про расписание сама. " +
        "Вы увидите её в списке учеников Intervals.\n\n" +
        "Если имя записалось криво, пришлите правильное следующим сообщением.",
      buttons: [[{ label: "Имя в порядке", data: `${ENROLL_CALLBACK_PREFIX}namedone` }]],
    });

    await handleRunStartCommand({
      chatId: input.telegramUserId,
      from: { id: input.telegramUserId },
      skipGreeting: true,
    });
  } catch (error) {
    await sendTelegramMessageStrict(
      input.coachChatId,
      `Не получилось завести: ${error instanceof Error ? error.message : String(error)}`
    );
  }
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

  if (action === "namedone") {
    await answerTelegramCallbackQuery(input.callbackQueryId, "Хорошо");
    const rename = await openRename(input.coachChatId);
    if (rename) await closeRename(rename.id);
    return true;
  }

  await answerTelegramCallbackQuery(input.callbackQueryId);
  return true;
}

/**
 * Обычное сообщение тренера, пока открыто окно переименования.
 *
 * Возвращает true, только если сообщение было именем: иначе оно уйдёт дальше по
 * общей цепочке обработчиков и не будет проглочено молча.
 */
export async function handleEnrollmentText(input: {
  coachChatId: string;
  text: string;
}): Promise<boolean> {
  const rename = await openRename(input.coachChatId);
  if (!rename || !rename.createdStudentUuid) return false;
  const name = input.text.trim().slice(0, 120);
  if (name.length === 0) return false;

  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("trainingpeaks_students")
    .update({ student_name: name })
    .eq("id", rename.createdStudentUuid);
  if (error) {
    await sendTelegramMessageStrict(input.coachChatId, `Имя не поменялось: ${error.message}`);
    return true;
  }
  await closeRename(rename.id, { student_name: name });
  await sendTelegramMessageStrict(input.coachChatId, `Записал: ${name}.`);
  return true;
}

/** Есть ли открытое окно переименования. Нужно вебхуку, чтобы не съесть чужой текст. */
export async function hasOpenEnrollment(coachChatId: string): Promise<boolean> {
  return (await openRename(coachChatId)) !== null;
}
