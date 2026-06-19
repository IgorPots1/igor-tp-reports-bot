import type {
  TelegramInlineKeyboardMarkup,
  TelegramReplyMarkup,
} from "@/features/telegram/types";

const TELEGRAM_API_BASE_URL = "https://api.telegram.org";
const TELEGRAM_DOCUMENT_BOUNDARY = "----cursor-telegram-document";

type TelegramGetFileResponse = {
  ok?: boolean;
  description?: string;
  result?: {
    file_path?: string;
  };
};

type SendTelegramMessageOptions = {
  replyMarkup?: TelegramReplyMarkup;
  businessConnectionId?: string;
  messageThreadId?: number;
  replyToMessageId?: number;
  parseMode?: "HTML";
};

export type SendTelegramMessageResult = {
  messageId: number;
};

const TELEGRAM_MESSAGE_TOO_LONG_PATTERN = /message is too long/i;

function isTelegramTopicClosedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes("TOPIC_CLOSED");
}

export function isTelegramMessageTooLongError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return TELEGRAM_MESSAGE_TOO_LONG_PATTERN.test(error.message);
}

type EditTelegramMessageTextOptions = {
  replyMarkup?: TelegramInlineKeyboardMarkup;
  parseMode?: "HTML";
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

  if (options?.parseMode) {
    body.parse_mode = options.parseMode;
  }

  if (options?.replyToMessageId !== undefined) {
    body.reply_to_message_id = options.replyToMessageId;
  }

  return body;
}

type TelegramSendMessageApiResponse = {
  ok?: boolean;
  description?: string;
  result?: {
    message_id?: number;
  };
};

async function postTelegramMessageReturningResult(
  chatId: string | number,
  text: string,
  options?: SendTelegramMessageOptions
): Promise<SendTelegramMessageResult | null> {
  const body = buildTelegramSendMessageBody(chatId, text, options);
  const token = getTelegramBotToken();
  const response = await fetch(`${TELEGRAM_API_BASE_URL}/bot${token}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`Telegram sendMessage failed (${response.status}): ${responseText}`);
  }

  if (!responseText) {
    return null;
  }

  const responseJson = JSON.parse(responseText) as TelegramSendMessageApiResponse;
  if (responseJson.ok === false) {
    throw new Error(
      `Telegram sendMessage failed: ${responseJson.description ?? "Unknown Telegram API error"}`
    );
  }

  const messageId = responseJson.result?.message_id;
  return typeof messageId === "number" ? { messageId } : null;
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

export async function sendTelegramMessageReturningId(
  chatId: string | number,
  text: string,
  options?: SendTelegramMessageOptions
): Promise<SendTelegramMessageResult | null> {
  try {
    return await postTelegramMessageReturningResult(chatId, text, options);
  } catch (error) {
    if (options?.messageThreadId !== undefined && isTelegramTopicClosedError(error)) {
      return postTelegramMessageReturningResult(chatId, text, {
        ...options,
        messageThreadId: undefined,
      });
    }
    throw error;
  }
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
      parse_mode: options?.parseMode,
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

export async function editTelegramMessageTextStrict(
  chatId: string | number,
  messageId: number,
  text: string,
  options?: EditTelegramMessageTextOptions
): Promise<void> {
  await postTelegramApi("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    reply_markup: options?.replyMarkup,
    parse_mode: options?.parseMode,
  });
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

export async function getTelegramFilePath(fileId: string): Promise<string> {
  const token = getTelegramBotToken();

  const response = await fetch(`${TELEGRAM_API_BASE_URL}/bot${token}/getFile`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      file_id: fileId,
    }),
  });

  if (!response.ok) {
    throw new Error(`Telegram getFile failed (${response.status})`);
  }

  const payload = (await response.json()) as TelegramGetFileResponse;
  if (payload.ok === false) {
    throw new Error(`Telegram getFile failed: ${payload.description ?? "Unknown Telegram API error"}`);
  }

  const filePath = payload.result?.file_path?.trim();
  if (!filePath) {
    throw new Error("Telegram getFile returned empty file_path");
  }

  return filePath;
}

export async function sendTelegramWebAppButton(input: {
  chatId: string | number;
  text: string;
  buttonLabel: string;
  webAppUrl: string;
  businessConnectionId?: string;
}): Promise<void> {
  const body: Record<string, unknown> = {
    chat_id: input.chatId,
    text: input.text,
    reply_markup: {
      inline_keyboard: [[{ text: input.buttonLabel, web_app: { url: input.webAppUrl } }]],
    },
  };
  if (input.businessConnectionId) {
    body.business_connection_id = input.businessConnectionId;
  }
  await postTelegramApi("sendMessage", body);
}

export async function downloadTelegramFile(fileId: string): Promise<Buffer> {
  const token = getTelegramBotToken();
  const filePath = await getTelegramFilePath(fileId);
  const safePath = filePath.replace(/^\/+/, "");
  const response = await fetch(`${TELEGRAM_API_BASE_URL}/file/bot${token}/${safePath}`);

  if (!response.ok) {
    throw new Error(`Telegram file download failed (${response.status})`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
