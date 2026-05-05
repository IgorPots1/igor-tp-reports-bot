import type { ParsedTelegramUpdate } from "@/features/telegram/parser";
import { sendTelegramMessage } from "@/features/telegram/telegram-client";

const COACH_ONLY_MESSAGE = "⛔ Эта команда доступна только тренеру.";
const TP_UNKNOWN_COMMAND_MESSAGE = "ℹ️ Команда TrainingPeaks пока не распознана. Используй /help.";

const TP_STATUS_COMMAND_PATTERN = /^\/tp_status(?:@\w+)?(?:\s+|$)/;
const TP_STUDENTS_COMMAND_PATTERN = /^\/tp_students(?:@\w+)?(?:\s+|$)/;
const TP_REPORT_COMMAND_PATTERN = /^\/tp_report(?:@\w+)?(?:\s+|$)/;
const TP_WEEKLY_COMMAND_PATTERN = /^\/tp_weekly(?:@\w+)?(?:\s+|$)/;
const TP_COMMAND_PATTERN = /^\/tp_[a-z0-9_]+(?:@\w+)?(?:\s+|$)/;

type TrainingPeaksCommand = "tp_status" | "tp_students" | "tp_report" | "tp_weekly" | "unknown";

function getCoachChatIds(): Set<string> {
  const value = process.env.TELEGRAM_COACH_CHAT_IDS?.trim();

  if (!value) {
    return new Set();
  }

  return new Set(
    value
      .split(",")
      .map((chatId) => chatId.trim())
      .filter(Boolean)
  );
}

function getTrainingPeaksCommand(text: string): TrainingPeaksCommand | null {
  if (TP_STATUS_COMMAND_PATTERN.test(text)) {
    return "tp_status";
  }

  if (TP_STUDENTS_COMMAND_PATTERN.test(text)) {
    return "tp_students";
  }

  if (TP_REPORT_COMMAND_PATTERN.test(text)) {
    return "tp_report";
  }

  if (TP_WEEKLY_COMMAND_PATTERN.test(text)) {
    return "tp_weekly";
  }

  if (TP_COMMAND_PATTERN.test(text)) {
    return "unknown";
  }

  return null;
}

function getTrainingPeaksPlaceholderMessage(command: TrainingPeaksCommand): string {
  switch (command) {
    case "tp_status":
      return [
        "📊 TrainingPeaks отчёты пока не подключены к Telegram.",
        "Следующий шаг: синхронизировать локальные черновики отчётов в безопасное хранилище.",
      ].join("\n");
    case "tp_students":
      return [
        "👥 Список учеников TrainingPeaks пока доступен только локально на Mac.",
        "Следующий шаг: добавить безопасную публикацию статусов в Telegram.",
      ].join("\n");
    case "tp_report":
      return [
        "📝 Просмотр отчёта в Telegram пока не подключён.",
        "Сейчас отчёты доступны локально через tp-report-open и tp-report-copy.",
      ].join("\n");
    case "tp_weekly":
      return [
        "⚙️ Запуск TrainingPeaks workflow из Telegram пока отключён.",
        "Это специально: TrainingPeaks и Playwright должны оставаться только на локальном Mac.",
      ].join("\n");
    default:
      return TP_UNKNOWN_COMMAND_MESSAGE;
  }
}

export function isCoachChat(chatId: number | string): boolean {
  return getCoachChatIds().has(String(chatId));
}

export function isTrainingPeaksCommand(text: string): boolean {
  return TP_COMMAND_PATTERN.test(text);
}

export function getTrainingPeaksHelpLines(): string[] {
  return [
    "TrainingPeaks отчёты:",
    "/tp_status — статус отчётов (пока в режиме подключения)",
    "/tp_students — ученики (пока в режиме подключения)",
    "/tp_report <ученик> — черновик отчёта (пока в режиме подключения)",
    "/tp_weekly — запуск недельного workflow (пока в режиме подключения)",
  ];
}

export async function handleTrainingPeaksTelegramCommand(
  parsedMessage: ParsedTelegramUpdate,
  text: string
): Promise<"handled" | "ignored"> {
  const command = getTrainingPeaksCommand(text);

  if (!command) {
    return "ignored";
  }

  if (!isCoachChat(parsedMessage.chatId)) {
    await sendTelegramMessage(parsedMessage.chatId, COACH_ONLY_MESSAGE);
    return "handled";
  }

  await sendTelegramMessage(
    parsedMessage.chatId,
    getTrainingPeaksPlaceholderMessage(command)
  );

  return "handled";
}
