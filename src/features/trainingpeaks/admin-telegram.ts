import type { TrainingPeaksBusinessChat } from "@/features/trainingpeaks/repository";
import { getTrainingPeaksBusinessChatByConnectionAndChatId } from "@/features/trainingpeaks/repository";
import {
  createTrainingPeaksStudentTelegramLinkCode,
  findTrainingPeaksBusinessChatsByUsername,
  getTrainingPeaksBusinessChatByInternalId,
  getTrainingPeaksStudentById,
  getTrainingPeaksStudentCardByInternalId,
  linkTrainingPeaksStudentToBusinessChat,
  listRecentTrainingPeaksBusinessChats,
  type TrainingPeaksBusinessChatSnapshot,
} from "@/features/trainingpeaks/service";
import {
  getRequiredTrainingPeaksBusinessConnectionId,
  sendTrainingPeaksTelegramBusinessMessage,
  shortenTrainingPeaksTelegramDeliveryError,
} from "@/features/trainingpeaks/telegram-business";

export const TRAININGPEAKS_ADMIN_TELEGRAM_USERNAME_NOT_FOUND_MESSAGE =
  "Не нашёл этот username среди последних Business-чатов. Попроси ученика написать тебе любое сообщение в Telegram и повтори поиск.";

type ActiveStudentLookupResult =
  | { ok: true; student: NonNullable<Awaited<ReturnType<typeof getTrainingPeaksStudentCardByInternalId>>> }
  | { ok: false; message: string };

export type BindTrainingPeaksAdminStudentTelegramByChatResult =
  | {
      ok: true;
      studentName: string;
      chat: TrainingPeaksBusinessChatSnapshot;
    }
  | {
      ok: false;
      message: string;
    };

export type BindTrainingPeaksAdminStudentTelegramByUsernameResult =
  | {
      ok: true;
      studentName: string;
      chat: TrainingPeaksBusinessChatSnapshot;
    }
  | {
      ok: false;
      message: string;
      normalizedUsername?: string | null;
      candidates?: TrainingPeaksBusinessChatSnapshot[];
    };

export type SendTrainingPeaksAdminStudentTelegramTestResult =
  | {
      ok: true;
      studentName: string;
    }
  | {
      ok: false;
      message: string;
    };

function normalizeTelegramUsernameLookup(value: string): string | null {
  const normalized = value.trim().replace(/^@+/, "").replace(/\s+/g, "");
  return normalized ? normalized.toLocaleLowerCase("en-US") : null;
}

async function getActiveStudentByInternalId(studentId: string): Promise<ActiveStudentLookupResult> {
  const student = await getTrainingPeaksStudentCardByInternalId(studentId);

  if (!student) {
    return {
      ok: false,
      message: "Ученик не найден.",
    };
  }

  if (!student.isActive) {
    return {
      ok: false,
      message: "Нельзя привязать Telegram для архивного ученика. Сначала восстанови его.",
    };
  }

  return {
    ok: true,
    student,
  };
}

async function bindStudentToBusinessChat(
  studentId: string,
  chat: Pick<TrainingPeaksBusinessChat, "businessConnectionId" | "chatId"> & TrainingPeaksBusinessChatSnapshot
): Promise<BindTrainingPeaksAdminStudentTelegramByChatResult> {
  const studentResult = await getActiveStudentByInternalId(studentId);

  if (!studentResult.ok) {
    return studentResult;
  }

  const linked = await linkTrainingPeaksStudentToBusinessChat(
    studentResult.student.id,
    chat.chatId,
    chat.businessConnectionId
  );

  if (!linked) {
    return {
      ok: false,
      message: "Не удалось привязать Telegram. Попробуй ещё раз.",
    };
  }

  return {
    ok: true,
    studentName: linked.student.studentName,
    chat: linked.chat,
  };
}

export function formatTrainingPeaksAdminTelegramChatName(chat: {
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  chatId: string;
}): string {
  const fullName = [chat.firstName, chat.lastName].filter(Boolean).join(" ").trim();

  if (fullName && chat.username) {
    return `${fullName} @${chat.username}`;
  }

  if (fullName) {
    return fullName;
  }

  if (chat.username) {
    return `@${chat.username}`;
  }

  return `chat ${chat.chatId}`;
}

export function formatTrainingPeaksAdminLinkCodeExpiresAt(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  }).format(new Date(value));
}

export function shortenTrainingPeaksAdminChatId(chatId: string): string {
  if (chatId.length <= 10) {
    return chatId;
  }

  return `${chatId.slice(0, 4)}...${chatId.slice(-4)}`;
}

export function normalizeTrainingPeaksAdminTelegramUsername(value: string): string | null {
  return normalizeTelegramUsernameLookup(value);
}

export async function listTrainingPeaksAdminRecentBusinessChats(
  limit = 10
): Promise<TrainingPeaksBusinessChatSnapshot[]> {
  return listRecentTrainingPeaksBusinessChats(limit);
}

export async function findTrainingPeaksAdminBusinessChatsByUsername(
  rawUsername: string,
  limit = 10
): Promise<{
  normalizedUsername: string | null;
  chats: TrainingPeaksBusinessChatSnapshot[];
}> {
  const normalizedUsername = normalizeTelegramUsernameLookup(rawUsername);

  if (!normalizedUsername) {
    return {
      normalizedUsername: null,
      chats: [],
    };
  }

  return {
    normalizedUsername,
    chats: await findTrainingPeaksBusinessChatsByUsername(normalizedUsername, limit),
  };
}

export async function getTrainingPeaksAdminStudentLastKnownBusinessChat(
  student: NonNullable<Awaited<ReturnType<typeof getTrainingPeaksStudentCardByInternalId>>>
): Promise<TrainingPeaksBusinessChatSnapshot | null> {
  if (student.telegramChatId) {
    const businessConnectionId = process.env.TELEGRAM_BUSINESS_CONNECTION_ID?.trim();

    if (businessConnectionId) {
      const exactChat = await getTrainingPeaksBusinessChatByConnectionAndChatId(
        businessConnectionId,
        student.telegramChatId
      );

      if (exactChat) {
        return exactChat;
      }
    }
  }

  if (!student.telegramUsername) {
    return null;
  }

  const chats = await findTrainingPeaksBusinessChatsByUsername(student.telegramUsername, 1);
  return chats[0] ?? null;
}

export async function bindTrainingPeaksAdminStudentTelegramByBusinessChat(
  studentId: string,
  businessChatId: string
): Promise<BindTrainingPeaksAdminStudentTelegramByChatResult> {
  const chat = await getTrainingPeaksBusinessChatByInternalId(businessChatId);

  if (!chat) {
    return {
      ok: false,
      message: "Чат больше не найден. Обнови список и попробуй снова.",
    };
  }

  return bindStudentToBusinessChat(studentId, chat);
}

export async function bindTrainingPeaksAdminStudentTelegramByUsername(
  studentId: string,
  rawUsername: string
): Promise<BindTrainingPeaksAdminStudentTelegramByUsernameResult> {
  const studentResult = await getActiveStudentByInternalId(studentId);

  if (!studentResult.ok) {
    return studentResult;
  }

  const normalizedUsername = normalizeTelegramUsernameLookup(rawUsername);

  if (!normalizedUsername) {
    return {
      ok: false,
      message: "Введи username в формате @username или username.",
      normalizedUsername: null,
    };
  }

  const chats = await findTrainingPeaksBusinessChatsByUsername(normalizedUsername, 10);

  if (chats.length === 0) {
    return {
      ok: false,
      message: TRAININGPEAKS_ADMIN_TELEGRAM_USERNAME_NOT_FOUND_MESSAGE,
      normalizedUsername,
      candidates: [],
    };
  }

  if (chats.length > 1) {
    return {
      ok: false,
      message: "Нашлось несколько Business-чатов. Выбери нужный вариант ниже.",
      normalizedUsername,
      candidates: chats,
    };
  }

  return bindStudentToBusinessChat(studentResult.student.id, chats[0]!);
}

export async function createTrainingPeaksAdminStudentTelegramLinkCode(studentId: string) {
  return createTrainingPeaksStudentTelegramLinkCode(studentId);
}

export async function sendTrainingPeaksAdminStudentTelegramTestMessage(
  studentId: string
): Promise<SendTrainingPeaksAdminStudentTelegramTestResult> {
  const student = await getTrainingPeaksStudentById(studentId);

  if (!student) {
    return {
      ok: false,
      message: "Ученик не найден.",
    };
  }

  if (!student.telegramChatId) {
    return {
      ok: false,
      message: "Не могу отправить тест: у ученика не привязан Telegram.",
    };
  }

  if (!student.telegramDeliveryEnabled) {
    return {
      ok: false,
      message: "Не могу отправить тест: у ученика выключена доставка в Telegram.",
    };
  }

  let businessConnectionId: string;

  try {
    businessConnectionId = getRequiredTrainingPeaksBusinessConnectionId();
  } catch (error) {
    return {
      ok: false,
      message: shortenTrainingPeaksTelegramDeliveryError(error),
    };
  }

  try {
    await sendTrainingPeaksTelegramBusinessMessage(
      student.telegramChatId,
      "Тестовое сообщение от Игоря ✅",
      businessConnectionId
    );

    return {
      ok: true,
      studentName: student.studentName,
    };
  } catch (error) {
    return {
      ok: false,
      message: `Не удалось отправить тестовое сообщение: ${shortenTrainingPeaksTelegramDeliveryError(error)}.`,
    };
  }
}
