import type {
  TelegramInlineKeyboardMarkup,
  TelegramReplyMarkup,
} from "@/features/telegram/types";

const TELEGRAM_API_BASE_URL = "https://api.telegram.org";

type SendTelegramMessageOptions = {
  replyMarkup?: TelegramReplyMarkup;
};

type EditTelegramMessageTextOptions = {
  replyMarkup?: TelegramInlineKeyboardMarkup;
};

function getTelegramBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is not set");
  }

  return token;
}

async function postTelegramApi(method: string, body: Record<string, unknown>): Promise<void> {
  const token = getTelegramBotToken();

  const response = await fetch(`${TELEGRAM_API_BASE_URL}/bot${token}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`Telegram ${method} failed (${response.status}): ${responseText}`);
  }

  if (!responseText) {
    return;
  }

  try {
    const responseJson = JSON.parse(responseText) as { ok?: boolean; description?: string };

    if (responseJson.ok === false) {
      throw new Error(
        `Telegram ${method} failed: ${responseJson.description ?? "Unknown Telegram API error"}`
      );
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      return;
    }

    throw error;
  }
}

async function postTelegramMessage(
  chatId: string | number,
  text: string,
  options?: SendTelegramMessageOptions
): Promise<void> {
  await postTelegramApi("sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: options?.replyMarkup,
  });
}

export async function sendTelegramMessage(
  chatId: string | number,
  text: string,
  options?: SendTelegramMessageOptions
) {
  try {
    await postTelegramMessage(chatId, text, options);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error while sending Telegram message";

    console.error("Telegram sendMessage request failed", {
      chatId,
      error: message,
    });
  }
}

export async function editTelegramMessageText(
  chatId: string | number,
  messageId: number,
  text: string,
  options?: EditTelegramMessageTextOptions
) {
  try {
    await postTelegramApi("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      reply_markup: options?.replyMarkup,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error while editing Telegram message";

    console.error("Telegram editMessageText request failed", {
      chatId,
      messageId,
      error: message,
    });
  }
}

export async function answerTelegramCallbackQuery(callbackQueryId: string, text?: string) {
  try {
    await postTelegramApi("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown error while answering Telegram callback query";

    console.error("Telegram answerCallbackQuery request failed", {
      callbackQueryId,
      error: message,
    });
  }
}
