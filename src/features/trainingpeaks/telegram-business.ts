import { sendTelegramMessageStrict } from "@/features/telegram/telegram-client";

const TELEGRAM_MESSAGE_LIMIT = 4000;

export function splitTrainingPeaksTelegramMessage(text: string, limit = TELEGRAM_MESSAGE_LIMIT): string[] {
  const normalizedText = text.trim();

  if (normalizedText.length <= limit) {
    return [normalizedText];
  }

  const chunks: string[] = [];
  let rest = normalizedText;

  while (rest.length > 0) {
    if (rest.length <= limit) {
      chunks.push(rest);
      break;
    }

    let boundary = rest.lastIndexOf("\n\n", limit);
    if (boundary < Math.floor(limit * 0.5)) {
      boundary = rest.lastIndexOf("\n", limit);
    }
    if (boundary < Math.floor(limit * 0.5)) {
      boundary = rest.lastIndexOf(" ", limit);
    }
    if (boundary <= 0) {
      boundary = limit;
    }

    chunks.push(rest.slice(0, boundary).trimEnd());
    rest = rest.slice(boundary).trimStart();
  }

  return chunks.filter(Boolean);
}

export function shortenTrainingPeaksTelegramDeliveryError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const normalized = raw.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "Неизвестная ошибка доставки в Telegram";
  }

  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

export function getRequiredTrainingPeaksBusinessConnectionId(): string {
  const value = process.env.TELEGRAM_BUSINESS_CONNECTION_ID?.trim();

  if (!value) {
    throw new Error("Не настроен TELEGRAM_BUSINESS_CONNECTION_ID.");
  }

  return value;
}

export async function sendTrainingPeaksTelegramBusinessMessage(
  chatId: string,
  text: string,
  businessConnectionId: string
): Promise<number> {
  const chunks = splitTrainingPeaksTelegramMessage(text);

  for (const [index, chunk] of chunks.entries()) {
    try {
      await sendTelegramMessageStrict(chatId, chunk, {
        businessConnectionId,
      });
    } catch (error) {
      throw new Error(
        `Не удалось отправить часть ${index + 1} из ${chunks.length}: ${shortenTrainingPeaksTelegramDeliveryError(error)}`
      );
    }
  }

  return chunks.length;
}
