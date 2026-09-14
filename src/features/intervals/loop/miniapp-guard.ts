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
import { getTrainingPeaksStudentByTelegramUserId } from "@/features/trainingpeaks/repository";
import { createSupabaseServerClient, describeSupabaseError } from "@/features/supabase/server";

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
      sourceId: string;
      telegramUserId: number;
    }
  | {
      ok: false;
      httpStatus: number;
      code: "no_init_data" | "bad_signature" | "not_linked" | "no_source" | "wrong_platform";
      error: string;
    };

export async function resolveRunAppStudent(initDataRaw: unknown): Promise<RunAppResolution> {
  const initData = typeof initDataRaw === "string" ? initDataRaw.trim() : "";
  if (!initData) {
    return { ok: false, httpStatus: 401, code: "no_init_data", error: "Открой приложение из Telegram." };
  }
  if (!validateTelegramInitData(initData)) {
    return { ok: false, httpStatus: 401, code: "bad_signature", error: "Подпись Telegram не сошлась." };
  }
  const tgUser = parseTelegramInitDataUser(initData);
  if (!tgUser) {
    return { ok: false, httpStatus: 401, code: "no_init_data", error: "Telegram не передал пользователя." };
  }

  const student = await getTrainingPeaksStudentByTelegramUserId(tgUser.id);
  if (!student) {
    return {
      ok: false,
      httpStatus: 403,
      code: "not_linked",
      error: "Этот Telegram-аккаунт ещё не связан с учеником. Напиши тренеру — он свяжет.",
    };
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .select("coaching_platform")
    .eq("id", student.id)
    .maybeSingle();
  if (error) throw new Error(`trainingpeaks_students: ${describeSupabaseError(error)}`);
  if ((data as { coaching_platform?: string } | null)?.coaching_platform !== "intervals") {
    return {
      ok: false,
      httpStatus: 403,
      code: "wrong_platform",
      error: "Твои тренировки ведутся в другом приложении.",
    };
  }

  const { data: sourceRows, error: sourceError } = await supabase
    .from("student_data_sources")
    .select("id, is_active")
    .eq("student_id", student.id)
    .eq("provider", "intervals")
    .limit(1);
  if (sourceError) throw new Error(`student_data_sources: ${describeSupabaseError(sourceError)}`);
  const source = (sourceRows ?? [])[0] as { id: string; is_active: boolean } | undefined;
  if (!source || source.is_active !== true) {
    return {
      ok: false,
      httpStatus: 403,
      code: "no_source",
      error: "Intervals ещё не подключён. Напиши тренеру.",
    };
  }

  return {
    ok: true,
    studentUuid: student.id,
    studentName: student.studentName,
    sourceId: source.id,
    telegramUserId: tgUser.id,
  };
}
