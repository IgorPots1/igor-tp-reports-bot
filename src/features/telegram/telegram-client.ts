import type {
  TelegramInlineKeyboardMarkup,
  TelegramReplyMarkup,
} from "@/features/telegram/types";

const TELEGRAM_API_BASE_URL = "https://api.telegram.org";
const TELEGRAM_DOCUMENT_BOUNDARY = "----cursor-telegram-document";

type SendTelegramMessageOptions = {
  replyMarkup?: TelegramReplyMarkup;
  businessConnectionId?: string;
  messageThreadId?: number;
};

function isTelegramTopicClosedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes("TOPIC_CLOSED");
}

type EditTelegramMessageTextOptions = {
  replyMarkup?: TelegramInlineKeyboardMarkup;
};

type SendTelegramDocumentOptions = {
  filename: string;
  caption?: string;
  contentType?: string;
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

async function postTelegramMultipartApi(
  method: string,
  body: ArrayBuffer,
  contentType: string
): Promise<void> {
  const token = getTelegramBotToken();

  const response = await fetch(`${TELEGRAM_API_BASE_URL}/bot${token}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
    },
    body,
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

function buildTelegramSendMessageBody(
  chatId: string | number,
  text: string,
  options?: SendTelegramMessageOptions
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    reply_markup: options?.replyMarkup,
  };

  if (options?.businessConnectionId) {
    body.business_connection_id = options.businessConnectionId;
  }

  if (options?.messageThreadId !== undefined) {
    body.message_thread_id = options.messageThreadId;
  }

  return body;
}

async function postTelegramMessage(
  chatId: string | number,
  text: string,
  options?: SendTelegramMessageOptions
): Promise<void> {
  const body = buildTelegramSendMessageBody(chatId, text, options);

  try {
    await postTelegramApi("sendMessage", body);
  } catch (error) {
    if (options?.messageThreadId !== undefined && isTelegramTopicClosedError(error)) {
      console.warn("Telegram sendMessage TOPIC_CLOSED, retrying without message_thread_id", {
        chatId,
        messageThreadId: options.messageThreadId,
      });

      const fallbackBody = buildTelegramSendMessageBody(chatId, text, {
        ...options,
        messageThreadId: undefined,
      });

      try {
        await postTelegramApi("sendMessage", fallbackBody);
        return;
      } catch (fallbackError) {
        console.warn("Telegram sendMessage fallback without message_thread_id failed", {
          chatId,
          messageThreadId: options.messageThreadId,
          error:
            fallbackError instanceof Error
              ? fallbackError.message
              : "Unknown error while sending Telegram message",
        });
        throw fallbackError;
      }
    }

    throw error;
  }
}

export async function sendTelegramMessageStrict(
  chatId: string | number,
  text: string,
  options?: SendTelegramMessageOptions
): Promise<void> {
  await postTelegramMessage(chatId, text, options);
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

function buildTelegramDocumentPayload(
  chatId: string | number,
  content: string,
  options: SendTelegramDocumentOptions
): {
  body: ArrayBuffer;
  contentType: string;
} {
  const encoder = new TextEncoder();
  const fileBytes = encoder.encode(content);
  const parts = [
    `--${TELEGRAM_DOCUMENT_BOUNDARY}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${String(chatId)}\r\n`,
    options.caption
      ? `--${TELEGRAM_DOCUMENT_BOUNDARY}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${options.caption}\r\n`
      : "",
    `--${TELEGRAM_DOCUMENT_BOUNDARY}\r\nContent-Disposition: form-data; name="document"; filename="${options.filename}"\r\nContent-Type: ${options.contentType ?? "text/plain;charset=utf-8"}\r\n\r\n`,
  ];
  const closing = `\r\n--${TELEGRAM_DOCUMENT_BOUNDARY}--\r\n`;

  const headerBytes = encoder.encode(parts.join(""));
  const closingBytes = encoder.encode(closing);
  const body = new Uint8Array(headerBytes.length + fileBytes.length + closingBytes.length);
  body.set(headerBytes, 0);
  body.set(fileBytes, headerBytes.length);
  body.set(closingBytes, headerBytes.length + fileBytes.length);

  return {
    body: body.buffer,
    contentType: `multipart/form-data; boundary=${TELEGRAM_DOCUMENT_BOUNDARY}`,
  };
}

export async function sendTelegramDocument(
  chatId: string | number,
  content: string,
  options: SendTelegramDocumentOptions
) {
  try {
    const payload = buildTelegramDocumentPayload(chatId, content, options);
    await postTelegramMultipartApi("sendDocument", payload.body, payload.contentType);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error while sending Telegram document";

    console.error("Telegram sendDocument request failed", {
      chatId,
      filename: options.filename,
      error: message,
    });
    throw error;
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
