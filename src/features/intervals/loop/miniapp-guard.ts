/**
 * Вход в мини-приложение ученика Intervals. Общий гард для /api/m/run/*.
 *
 * ПОЧЕМУ ФОРМА И КАБИНЕТ ЖИВУТ В TELEGRAM, А НЕ СТРАНИЦЕЙ НА igorp.run
 * [решение 02.10.2026]:
 *
 *   1. Личность. initData подписан ботом по HMAC, то есть Telegram-аккаунт
 *      известен бесплатно и подделать его нельзя. Ровно по этому аккаунту
 *      тренер потом ей пишет. На публичной странице пришлось бы завести свою
 *      авторизацию (ссылка-токен, почта, пароль) — и всё равно в конце
 *      привязывать к Telegram, потому что отвечать он будет туда.
 *   2. Один путь вместо двух. Всё, что идёт после анкеты, — карточка на сегодня,
 *      чек-ин, перенос, ответ тренера — происходит в Telegram. Анкета на вебе
 *      означала бы две разные личности, которые надо сшивать, и сшивать в самый
 *      неудачный момент: у человека, который ещё ничего не начал.
 *   3. Кабинет уже здесь. «Дальше там же будет кабинет» — кабинет ученика уже
 *      существует мини-приложением (/m/club), с той же оболочкой, темой и
 *      резолвером. Второй каркас на вебе пришлось бы догонять по всему.
 *   4. Цена публичности. Открытая страница анкеты — это форма, которую может
 *      отправить кто угодно: нужна своя защита от мусора и свой текст про
 *      обработку данных. В мини-приложении отправитель известен по подписи.
 *
 * ЧТО МЫ ЗА ЭТО ОТДАЁМ: ссылку нельзя открыть вне Telegram. Для ученицы, с
 * которой тренер и так переписывается в Telegram, это не потеря.
 *
 * ПРИВЯЗКА НЕ АВТОМАТИЧЕСКАЯ. Как в клубе (и в отличие от /m/n), аккаунт сам
 * себя ни к кому не привязывает: молчаливая привязка по пересланной ссылке
 * показала бы человеку чужой план. Привязку делает тренер в админке.
 */

import { parseTelegramInitDataUser, validateTelegramInitData } from "@/features/telegram/validate-init-data";
import { listActiveStudentsByTelegramUserId } from "@/features/trainingpeaks/repository";
import { createSupabaseServerClient, describeSupabaseError } from "@/features/supabase/server";

import {
  countActivitiesForSource,
  getSourceConnection,
  isConnectionUsable,
  type SourceConnection,
} from "../repository";
import { isValidTimeZone } from "./clock";

export function isRunAppEnabled(): boolean {
  return process.env.MINIAPP_ENABLED === "true" && process.env.INTERVALS_RUN_APP_ENABLED === "true";
}

export function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export type RunAppResolution =
  | {
      ok: true;
      studentUuid: string;
      studentName: string;
      /**
       * null — часы ещё не подключены. НЕ ошибка: именно с этого состояния
       * человек и начинает, и экран подключения живёт внутри приложения.
       */
      sourceId: string | null;
      connection: SourceConnection | null;
      telegramUserId: number;
      /** Зона ученика с карточки. null — ещё не определена. */
      timezone: string | null;
    }
  | {
      ok: false;
      httpStatus: number;
      code: "no_init_data" | "bad_signature" | "not_linked" | "wrong_platform";
      error: string;
    };

export async function resolveRunAppStudent(initDataRaw: unknown): Promise<RunAppResolution> {
  const initData = typeof initDataRaw === "string" ? initDataRaw.trim() : "";
  if (!initData) {
    return { ok: false, httpStatus: 401, code: "no_init_data", error: "Откройте приложение из Telegram." };
  }
  if (!validateTelegramInitData(initData)) {
    return { ok: false, httpStatus: 401, code: "bad_signature", error: "Подпись Telegram не сошлась." };
  }
  const tgUser = parseTelegramInitDataUser(initData);
  if (!tgUser) {
    return { ok: false, httpStatus: 401, code: "no_init_data", error: "Telegram не передал пользователя." };
  }

  // ВЫБОР ПО ПРИЛОЖЕНИЮ, А НЕ ПО КАРТОЧКЕ [14.09.2026].
  //
  // Один Telegram может держать ДВЕ карточки: ученик переходит с основного
  // тарифа на Intervals или обратно, и какое-то время у него есть обе. Раньше
  // резолвер брал «единственную» карточку и на двух падал, а на одной чужой
  // площадке отвечал «ваши тренировки ведутся в другом приложении» — фраза,
  // которая не говорит человеку ни в каком, ни что делать.
  //
  // Правильный ответ: /m/run обслуживает Intervals, значит из карточек берётся
  // Intervals-карточка. «Отчёты», питание и клуб точно так же берут свою.
  const cards = await listActiveStudentsByTelegramUserId(tgUser.id);
  const student = cards.find((card) => card.coachingPlatform === "intervals") ?? null;

  if (!student) {
    const onTrainingPeaks = cards.some((card) => card.coachingPlatform === "trainingpeaks");
    return {
      ok: false,
      httpStatus: 403,
      code: onTrainingPeaks ? "wrong_platform" : "not_linked",
      error: onTrainingPeaks
        ? // Человек нам ЗНАКОМ, просто ведётся на другом тарифе. Говорим это
          // прямо и ведём туда, где его план, а не в тупик.
          "Ваш план ведётся на основном тарифе, а это приложение для тарифа с подключением часов. " +
          "Свой план вы найдёте в приложении «Отчёты». Если вы переходите на новый тариф, напишите тренеру: " +
          "он откроет доступ, это занимает минуту."
        : "Этот аккаунт Telegram нам ещё не знаком. Откройте приложение с того аккаунта, " +
          "по которому вы общаетесь с тренером, или напишите ему, и он свяжет этот.",
    };
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .select("timezone")
    .eq("id", student.id)
    .maybeSingle();
  if (error) throw new Error(`trainingpeaks_students: ${describeSupabaseError(error)}`);
  const card = data as { timezone?: string | null } | null;

  // ОТСУТСТВИЕ ИСТОЧНИКА БОЛЬШЕ НЕ ОТКАЗ. Раньше человек без подключения
  // упирался в «напишите тренеру» и дальше зависел от переписки. Теперь он
  // попадает на экран подключения, и весь путь проходит сам.
  const connection = await getSourceConnection(student.id);
  // sourceId отдаём ТОЛЬКО когда источник реально способен отдавать данные.
  // Строка без единой синхронизации — это не подключение, а заготовка.
  const activities = connection ? await countActivitiesForSource(connection.sourceId) : 0;
  const usable = isConnectionUsable(connection, activities);

  return {
    ok: true,
    studentUuid: student.id,
    studentName: student.studentName,
    sourceId: usable ? connection!.sourceId : null,
    connection,
    telegramUserId: tgUser.id,
    timezone: card?.timezone ?? null,
  };
}

/**
 * Запомнить зону, определённую браузером.
 *
 * ПИШЕМ ТОЛЬКО ТО, ЧЕГО НЕ БЫЛО, ИЛИ НАСТОЯЩЕЕ ИЗМЕНЕНИЕ. Тихо перетирать зону
 * на каждом открытии нельзя: человек в командировке откроет приложение из
 * другого пояса, и его постоянный график уедет на неделю. Поэтому переносим
 * только когда зоны на карточке нет вовсе.
 *
 * Возвращает зону, с которой дальше работать.
 */
export async function rememberDetectedZone(input: {
  studentUuid: string;
  stored: string | null;
  detected: unknown;
}): Promise<string | null> {
  if (input.stored) return input.stored;
  if (!isValidTimeZone(input.detected)) return null;

  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("trainingpeaks_students")
    .update({ timezone: input.detected })
    .eq("id", input.studentUuid)
    .is("timezone", null);
  if (error) {
    // Не роняем экран из-за зоны: человек пришёл смотреть тренировку. Но и не
    // молчим — без отметки в логе расхождение дат объяснить будет нечем.
    console.warn("[m.run] не удалось запомнить часовой пояс", {
      studentUuid: input.studentUuid,
      error: error.message,
    });
    return input.detected;
  }
  return input.detected;
}
