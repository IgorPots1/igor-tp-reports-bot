/**
 * Первый вход в бота для ученика на тарифе с подключением часов.
 *
 * ДАЁТ ССЫЛКУ НА СТРАНИЦУ, А НЕ ТЕКСТ ИНСТРУКЦИИ. Пересланное сообщение нельзя
 * поправить: оно расходится с реальностью в день, когда Intervals меняет
 * настройки, и тонет в переписке. Страницу можно дать сто раз, и все сто раз
 * она будет актуальной.
 *
 * Отвечает ТОЛЬКО на /start run — на собственное действие человека. Ничего не
 * рассылает и никого не будит.
 */

import { SITE_URL } from "@/lib/site";
import { sendTelegramMessageStrict, sendTelegramUrlButton } from "@/features/telegram/telegram-client";

export const RUN_START_PARAM = "run";

const GREETING_RU =
  "Привет! Чтобы тренер собрал план, нужно, чтобы ваши тренировки к нему приходили.\n\n" +
  "Это делается один раз и занимает пару минут: вы разрешаете Intervals.icu отдавать данные " +
  "с часов. Главное — отметить галочку про скачивание тренировок: без неё подключение " +
  "выглядит успешным, а данные не идут.\n\n" +
  "По ссылке ниже расписано, что отметить именно для ваших часов.";

export async function handleRunStartCommand(input: {
  chatId: string | number;
  from: { id: number } | null;
}): Promise<boolean> {
  if (!input.from?.id) return false;
  const url = `${SITE_URL}/connect`;
  try {
    await sendTelegramUrlButton({
      chatId: input.chatId,
      text: GREETING_RU,
      buttonLabel: "Как подключить часы",
      url,
    });
  } catch (error) {
    // Кнопка не прошла (например, business-чат её не принимает) — отправляем
    // ссылкой текстом. Промолчать нельзя: человек нажал /start и ждёт ответа.
    console.warn("[run.start] кнопка не прошла, отправляю текстом", {
      error: error instanceof Error ? error.message : String(error),
    });
    try {
      await sendTelegramMessageStrict(input.chatId, `${GREETING_RU}\n\n${url}`);
    } catch (fallbackError) {
      console.error("[run.start] не удалось ответить", {
        error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
      });
    }
  }
  return true;
}
