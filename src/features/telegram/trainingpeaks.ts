import type {
  ParsedTelegramCallbackUpdate,
  ParsedTelegramMessageUpdate,
  ParsedTelegramUpdate,
} from "@/features/telegram/parser";
import {
  addTrainingPeaksStudentFromCommand,
  cancelTrainingPeaksWeeklyRun,
  consumeTrainingPeaksStudentTelegramLinkCode,
  createTrainingPeaksStudentTelegramLinkCode,
  disableTrainingPeaksStudent,
  disableTrainingPeaksStudentByInternalId,
  enableTrainingPeaksStudent,
  enableTrainingPeaksStudentByInternalId,
  findTrainingPeaksBusinessChatsByUsername,
  getTrainingPeaksJobsStatus,
  getTrainingPeaksBusinessChatByInternalId,
  getTrainingPeaksLatestReportSnapshotByInternalId,
  getTrainingPeaksReportSnapshot,
  getTrainingPeaksStatusOverview,
  getTrainingPeaksStudentCard,
  getTrainingPeaksStudentCardByInternalId,
  getTrainingPeaksStudentById,
  getTrainingPeaksStudentsRegistryWithLatestReportStatus,
  getTrainingPeaksWeeklyReportByInternalId,
  linkTrainingPeaksStudentToBusinessChat,
  listRecentTrainingPeaksBusinessChats,
  TRAININGPEAKS_JOB_CANCELLED_ERROR_MESSAGE,
  type RequestTrainingPeaksWeeklyRunResult,
  requestTrainingPeaksWeeklyRun,
  updateTrainingPeaksWeeklyReportStateByInternalId,
  updateTrainingPeaksStudentTelegramContact,
  upsertTrainingPeaksBusinessChatFromMessage,
} from "@/features/trainingpeaks/service";
import { sendTrainingPeaksWeeklyReportToStudent } from "@/features/trainingpeaks/report-delivery";
import {
  resolveTrainingPeaksWeekKeyword,
} from "@/features/trainingpeaks/week";
import {
  editTelegramMessageText,
  sendTelegramMessage,
  sendTelegramMessageStrict,
} from "@/features/telegram/telegram-client";
import type {
  TelegramInlineKeyboardMarkup,
  TelegramMessage,
  TelegramReplyKeyboardMarkup,
} from "@/features/telegram/types";

const COACH_ONLY_MESSAGE = "⛔ Эта команда доступна только тренеру.";
const TP_WEEKLY_DISABLED_MESSAGE =
  "⚙️ Запуск TrainingPeaks workflow из Telegram отключён. TrainingPeaks остаётся только в read-only режиме.";
const TP_UNKNOWN_COMMAND_MESSAGE = "Не поняла команду. Используй кнопки внизу или отправь /start.";
const TELEGRAM_MESSAGE_LIMIT = 4000;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const STUDENTS_PAGE_SIZE = 8;
const TP_CALLBACK_PREFIX = "tp:";
const TP_CALLBACK_MAIN_MENU = "tp:m";
const TP_CALLBACK_WEEK_MENU = "tp:w";
const TP_CALLBACK_WEEK_LAST = "tp:wl";
const TP_CALLBACK_WEEK_CURRENT = "tp:wc";
const TP_CALLBACK_JOBS = "tp:j";
const TP_CALLBACK_HELP = "tp:h";
const TP_CALLBACK_REPORTS = "tp:reports";
const TP_CALLBACK_REPORT_SEND_PREFIX = "tp:rs:";
const TP_CALLBACK_REPORT_SKIP_PREFIX = "tp:rk:";
const TP_CALLBACK_STUDENT_LINK_PREFIX = "tp:sl:";
const TP_CALLBACK_STUDENT_USERNAME_PREFIX = "tp:su:";
const TP_CALLBACK_STUDENT_LINK_CODE_PREFIX = "tp:sk:";
const TP_CALLBACK_STUDENT_SELECT_CHAT_PREFIX = "tp:sc:";
const TP_CALLBACK_STUDENT_TEST_PREFIX = "tp:st:";
const TP_REPLY_BUTTON_MENU = "🏠 Меню";
const TP_REPLY_BUTTON_STUDENTS = "👥 Ученики";
const TP_REPLY_BUTTON_ADD = "➕ Добавить";
const TP_REPLY_BUTTON_WEEK = "▶️ Неделя";
const TP_REPLY_BUTTON_JOBS = "🧾 Задачи";
const TP_REPLY_BUTTON_BACK = "⬅️ Назад";
const TP_REPLY_BUTTON_STUDENTS_BACK = "⬅️ Ученики";
const TP_REPLY_BUTTON_WEEK_LAST = "Прошлая неделя";
const TP_REPLY_BUTTON_WEEK_CURRENT = "Текущая неделя";
const TP_REPLY_BUTTON_JOBS_REFRESH = "🔄 Обновить задачи";
const TP_REPLY_BUTTON_CANCEL_JOB = "❌ Отменить задачу";
const TP_REPLY_BUTTON_REPORT = "📄 Отчёт";
const TP_REPLY_BUTTON_TELEGRAM_LINK = "🔗 Привязать Telegram";
const TP_REPLY_BUTTON_TELEGRAM_USERNAME = "🔎 Найти по username";
const TP_REPLY_BUTTON_TELEGRAM_CODE = "🔗 Код привязки";
const TP_REPLY_BUTTON_TELEGRAM_TEST = "📨 Отправить тест";
const TP_REPLY_BUTTON_DISABLE = "⛔ Отключить";
const TP_REPLY_BUTTON_ENABLE = "✅ Включить";
const TP_CHAT_CONTEXT_TTL_MS = 30 * 60 * 1000;
const TP_ADD_STUDENT_WAITING_TTL_MS = 10 * 60 * 1000;
const TP_TELEGRAM_LINK_OPTIONS_TTL_MS = 10 * 60 * 1000;
const TP_TELEGRAM_USERNAME_WAITING_TTL_MS = 10 * 60 * 1000;
const TP_ADD_STUDENT_DEPRECATED_MESSAGE = "Добавление учеников теперь выполняется в админке.";
const TP_ADD_STUDENT_EXAMPLE =
  "Valentin https://app.trainingpeaks.com/#calendar/athletes/5673496";
const TP_TRAININGPEAKS_URL_PATTERN = /\bhttps?:\/\/\S*trainingpeaks\.com\S*/i;

const TP_MAIN_COMMAND_PATTERN = /^\/tp(?:@\w+)?(?:\s+|$)/;
const TP_STATUS_COMMAND_PATTERN = /^\/tp_status(?:@\w+)?(?:\s+|$)/;
const TP_STUDENTS_COMMAND_PATTERN = /^\/tp_students(?:@\w+)?(?:\s+|$)/;
const TP_STUDENT_COMMAND_PATTERN = /^\/tp_student(?:@\w+)?(?:\s+|$)/;
const TP_DISABLE_STUDENT_COMMAND_PATTERN = /^\/tp_disable_student(?:@\w+)?(?:\s+|$)/;
const TP_ENABLE_STUDENT_COMMAND_PATTERN = /^\/tp_enable_student(?:@\w+)?(?:\s+|$)/;
const TP_ADD_COMMAND_PATTERN = /^\/tp_add(?:@\w+)?(?:\s+|$)/;
const TP_ADD_STUDENT_COMMAND_PATTERN = /^\/tp_add_student(?:@\w+)?(?:\s+|$)/;
const TP_REPORT_COMMAND_PATTERN = /^\/tp_report(?:@\w+)?(?:\s+|$)/;
const TP_WEEK_COMMAND_PATTERN = /^\/tp_week(?:@\w+)?(?:\s+|$)/;
const TP_RUN_COMMAND_PATTERN = /^\/tp_run(?:@\w+)?(?:\s+|$)/;
const TP_RUN_WEEK_COMMAND_PATTERN = /^\/tp_run_week(?:@\w+)?(?:\s+|$)/;
const TP_JOBS_COMMAND_PATTERN = /^\/tp_jobs(?:@\w+)?(?:\s+|$)/;
const TP_WEEKLY_COMMAND_PATTERN = /^\/tp_weekly(?:@\w+)?(?:\s+|$)/;
const TP_BUSINESS_TEST_COMMAND_PATTERN = /^\/tp_business_test(?:@\w+)?(?:\s+|$)/;
const TP_SET_TELEGRAM_COMMAND_PATTERN = /^\/tp_set_telegram(?:@\w+)?(?:\s+|$)/;
const TP_BIND_COMMAND_PATTERN = /^\/tp_bind(?:@\w+)?(?:\s+|$)/;
const TP_COMMAND_PATTERN = /^\/tp(?:_[a-z0-9_]+)?(?:@\w+)?(?:\s+|$)/;
const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

type TrainingPeaksCommand =
  | "tp"
  | "tp_status"
  | "tp_students"
  | "tp_student"
  | "tp_disable_student"
  | "tp_enable_student"
  | "tp_add"
  | "tp_add_student"
  | "tp_report"
  | "tp_week"
  | "tp_run"
  | "tp_run_week"
  | "tp_jobs"
  | "tp_weekly"
  | "tp_business_test"
  | "tp_set_telegram"
  | "tp_bind"
  | "unknown";

type TrainingPeaksWeek = {
  weekFrom: string;
  weekTo: string;
};

type TrainingPeaksMenuButton = {
  text: string;
  callback_data: string;
};

type ParsedTrainingPeaksCallback =
  | { kind: "main_menu" }
  | { kind: "students_page"; page: number }
  | { kind: "student_card"; studentId: string }
  | { kind: "student_report"; studentId: string }
  | { kind: "student_disable"; studentId: string }
  | { kind: "student_enable"; studentId: string }
  | { kind: "student_link"; studentId: string }
  | { kind: "student_username_prompt"; studentId: string }
  | { kind: "student_link_code"; studentId: string }
  | { kind: "student_choose_chat"; studentId: string; chatKey: string }
  | { kind: "student_test"; studentId: string }
  | { kind: "report_send"; reportId: string }
  | { kind: "report_skip"; reportId: string }
  | { kind: "week_menu" }
  | { kind: "week_last" }
  | { kind: "week_current" }
  | { kind: "jobs" }
  | { kind: "help" }
  | { kind: "reports_hint" };

type TrainingPeaksScreen =
  | "main_menu"
  | "students"
  | "student_actions"
  | "student_username_waiting"
  | "week"
  | "jobs"
  | "add_student_waiting";

type TrainingPeaksChatContext = {
  selectedStudentId: string | null;
  selectedStudentName: string | null;
  cancellableWeeklyJob:
    | {
        jobId: string;
        weekFrom: string;
        weekTo: string;
      }
    | null;
  screen: TrainingPeaksScreen;
  expiresAt: number;
};

type ParsedTrainingPeaksAddStudentInput = {
  studentName: string;
  trainingPeaksAthleteUrl: string;
};

type TrainingPeaksTelegramLinkContext = {
  studentId: string;
  optionsByKey: Record<string, string>;
  expiresAt: number;
};

type TrainingPeaksReplyKeyboardAction =
  | "main_menu"
  | "students"
  | "add_student_help"
  | "week_menu"
  | "jobs"
  | "back"
  | "students_back"
  | "week_last"
  | "week_current"
  | "jobs_refresh"
  | "cancel_job"
  | "student_report"
  | "student_link"
  | "student_username"
  | "student_link_code"
  | "student_test"
  | "student_disable"
  | "student_enable";

const trainingPeaksChatContextByChatId = new Map<string, TrainingPeaksChatContext>();
const trainingPeaksTelegramLinkContextByChatId = new Map<string, TrainingPeaksTelegramLinkContext>();

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
  if (TP_MAIN_COMMAND_PATTERN.test(text)) {
    return "tp";
  }

  if (TP_STATUS_COMMAND_PATTERN.test(text)) {
    return "tp_status";
  }

  if (TP_STUDENTS_COMMAND_PATTERN.test(text)) {
    return "tp_students";
  }

  if (TP_STUDENT_COMMAND_PATTERN.test(text)) {
    return "tp_student";
  }

  if (TP_DISABLE_STUDENT_COMMAND_PATTERN.test(text)) {
    return "tp_disable_student";
  }

  if (TP_ENABLE_STUDENT_COMMAND_PATTERN.test(text)) {
    return "tp_enable_student";
  }

  if (TP_ADD_COMMAND_PATTERN.test(text)) {
    return "tp_add";
  }

  if (TP_ADD_STUDENT_COMMAND_PATTERN.test(text)) {
    return "tp_add_student";
  }

  if (TP_REPORT_COMMAND_PATTERN.test(text)) {
    return "tp_report";
  }

  if (TP_WEEK_COMMAND_PATTERN.test(text)) {
    return "tp_week";
  }

  if (TP_RUN_COMMAND_PATTERN.test(text)) {
    return "tp_run";
  }

  if (TP_RUN_WEEK_COMMAND_PATTERN.test(text)) {
    return "tp_run_week";
  }

  if (TP_JOBS_COMMAND_PATTERN.test(text)) {
    return "tp_jobs";
  }

  if (TP_WEEKLY_COMMAND_PATTERN.test(text)) {
    return "tp_weekly";
  }

  if (TP_BUSINESS_TEST_COMMAND_PATTERN.test(text)) {
    return "tp_business_test";
  }

  if (TP_SET_TELEGRAM_COMMAND_PATTERN.test(text)) {
    return "tp_set_telegram";
  }

  if (TP_BIND_COMMAND_PATTERN.test(text)) {
    return "tp_bind";
  }

  if (TP_COMMAND_PATTERN.test(text)) {
    return "unknown";
  }

  return null;
}

function isIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function formatWeek(week: TrainingPeaksWeek): string {
  return `${formatShortDate(week.weekFrom)} — ${formatShortDate(week.weekTo)}`;
}

function formatWeekIso(week: TrainingPeaksWeek): string {
  return `${week.weekFrom} — ${week.weekTo}`;
}

function formatShortDate(value: string): string {
  return SHORT_DATE_FORMATTER.format(new Date(`${value}T00:00:00Z`)).replace(/\.$/, "");
}

function getStatusLabel(status: string): string {
  if (status === "ready") {
    return "готов";
  }

  if (status === "parsed_only") {
    return "только данные";
  }

  return "нет данных";
}

function getStatusEmoji(status: string): string {
  if (status === "ready") {
    return "✅";
  }

  if (status === "parsed_only") {
    return "⚠️";
  }

  return "❌";
}

function getStatusDetails(status: string): string {
  if (status === "ready") {
    return " (отчёт есть)";
  }

  if (status === "parsed_only") {
    return " (нет отчёта)";
  }

  return "";
}

function splitTelegramMessage(text: string): string[] {
  const normalizedText = text.trim();

  if (normalizedText.length <= TELEGRAM_MESSAGE_LIMIT) {
    return [normalizedText];
  }

  const chunks: string[] = [];
  let rest = normalizedText;

  while (rest.length > 0) {
    if (rest.length <= TELEGRAM_MESSAGE_LIMIT) {
      chunks.push(rest);
      break;
    }

    let boundary = rest.lastIndexOf("\n\n", TELEGRAM_MESSAGE_LIMIT);
    if (boundary < Math.floor(TELEGRAM_MESSAGE_LIMIT * 0.5)) {
      boundary = rest.lastIndexOf("\n", TELEGRAM_MESSAGE_LIMIT);
    }
    if (boundary < Math.floor(TELEGRAM_MESSAGE_LIMIT * 0.5)) {
      boundary = rest.lastIndexOf(" ", TELEGRAM_MESSAGE_LIMIT);
    }
    if (boundary <= 0) {
      boundary = TELEGRAM_MESSAGE_LIMIT;
    }

    chunks.push(rest.slice(0, boundary).trimEnd());
    rest = rest.slice(boundary).trimStart();
  }

  return chunks.filter(Boolean);
}

function getTrainingPeaksChatContext(chatId: number | string): TrainingPeaksChatContext | null {
  const state = getTrainingPeaksChatContextState(chatId);
  return state.kind === "active" ? state.context : null;
}

function getTrainingPeaksChatContextState(
  chatId: number | string
):
  | { kind: "missing" }
  | { kind: "active"; context: TrainingPeaksChatContext }
  | { kind: "expired"; context: TrainingPeaksChatContext } {
  const context = trainingPeaksChatContextByChatId.get(String(chatId));

  if (!context) {
    return { kind: "missing" };
  }

  if (context.expiresAt <= Date.now()) {
    trainingPeaksChatContextByChatId.delete(String(chatId));
    return { kind: "expired", context };
  }

  return { kind: "active", context };
}

function clearTrainingPeaksChatContext(chatId: number | string): void {
  trainingPeaksChatContextByChatId.delete(String(chatId));
}

function getTrainingPeaksTelegramLinkContext(
  chatId: number | string
): TrainingPeaksTelegramLinkContext | null {
  const context = trainingPeaksTelegramLinkContextByChatId.get(String(chatId));

  if (!context) {
    return null;
  }

  if (context.expiresAt <= Date.now()) {
    trainingPeaksTelegramLinkContextByChatId.delete(String(chatId));
    return null;
  }

  return context;
}

function setTrainingPeaksTelegramLinkContext(
  chatId: number | string,
  studentId: string,
  optionsByKey: Record<string, string>
): void {
  trainingPeaksTelegramLinkContextByChatId.set(String(chatId), {
    studentId,
    optionsByKey,
    expiresAt: Date.now() + TP_TELEGRAM_LINK_OPTIONS_TTL_MS,
  });
}

function clearTrainingPeaksTelegramLinkContext(chatId: number | string): void {
  trainingPeaksTelegramLinkContextByChatId.delete(String(chatId));
}

function setTrainingPeaksChatContextWithTtl(
  chatId: number | string,
  context: Omit<TrainingPeaksChatContext, "expiresAt">,
  expiresInMs: number
): void {
  trainingPeaksChatContextByChatId.set(String(chatId), {
    ...context,
    expiresAt: Date.now() + expiresInMs,
  });
}

function setTrainingPeaksChatContext(
  chatId: number | string,
  context: Omit<TrainingPeaksChatContext, "expiresAt">
): void {
  setTrainingPeaksChatContextWithTtl(chatId, context, TP_CHAT_CONTEXT_TTL_MS);
}

function setTrainingPeaksAddStudentWaitingContext(chatId: number | string): void {
  setTrainingPeaksChatContextWithTtl(
    chatId,
    {
      selectedStudentId: null,
      selectedStudentName: null,
      cancellableWeeklyJob: null,
      screen: "add_student_waiting",
    },
    TP_ADD_STUDENT_WAITING_TTL_MS
  );
}

function setTrainingPeaksUsernameWaitingContext(
  chatId: number | string,
  studentId: string,
  studentName: string
): void {
  setTrainingPeaksChatContextWithTtl(
    chatId,
    {
      selectedStudentId: studentId,
      selectedStudentName: studentName,
      cancellableWeeklyJob: null,
      screen: "student_username_waiting",
    },
    TP_TELEGRAM_USERNAME_WAITING_TTL_MS
  );
}

function setTrainingPeaksScreenContext(
  chatId: number | string,
  screen: TrainingPeaksScreen,
  options?: {
    selectedStudentId?: string | null;
    selectedStudentName?: string | null;
  }
): void {
  const currentContext = getTrainingPeaksChatContext(chatId);

  setTrainingPeaksChatContext(chatId, {
    selectedStudentId:
      options && "selectedStudentId" in options
        ? options.selectedStudentId ?? null
        : currentContext?.selectedStudentId ?? null,
    selectedStudentName:
      options && "selectedStudentName" in options
        ? options.selectedStudentName ?? null
        : currentContext?.selectedStudentName ?? null,
    cancellableWeeklyJob: currentContext?.cancellableWeeklyJob ?? null,
    screen,
  });
}

function clearTrainingPeaksSelectedStudent(chatId: number | string, screen: TrainingPeaksScreen): void {
  setTrainingPeaksChatContext(chatId, {
    selectedStudentId: null,
    selectedStudentName: null,
    cancellableWeeklyJob: null,
    screen,
  });
}

function setTrainingPeaksCancellableWeeklyJobContext(
  chatId: number | string,
  job: {
    jobId: string;
    weekFrom: string;
    weekTo: string;
  }
): void {
  const currentContext = getTrainingPeaksChatContext(chatId);
  setTrainingPeaksChatContext(chatId, {
    selectedStudentId: currentContext?.selectedStudentId ?? null,
    selectedStudentName: currentContext?.selectedStudentName ?? null,
    cancellableWeeklyJob: job,
    screen: currentContext?.screen ?? "week",
  });
}

function clearTrainingPeaksCancellableWeeklyJobContext(chatId: number | string): void {
  const currentContext = getTrainingPeaksChatContext(chatId);

  if (!currentContext) {
    return;
  }

  setTrainingPeaksChatContext(chatId, {
    selectedStudentId: currentContext.selectedStudentId,
    selectedStudentName: currentContext.selectedStudentName,
    cancellableWeeklyJob: null,
    screen: currentContext.screen,
  });
}

function getTrainingPeaksCancellableWeeklyJobContext(chatId: number | string): {
  jobId: string;
  weekFrom: string;
  weekTo: string;
} | null {
  return getTrainingPeaksChatContext(chatId)?.cancellableWeeklyJob ?? null;
}

async function sendTrainingPeaksMessage(
  chatId: number | string,
  text: string,
  options?: {
    replyMarkup?: TelegramReplyKeyboardMarkup;
  }
): Promise<void> {
  const chunks = splitTelegramMessage(text);

  for (const [index, chunk] of chunks.entries()) {
    await sendTelegramMessage(chatId, chunk, {
      replyMarkup: index === chunks.length - 1 ? options?.replyMarkup : undefined,
    });
  }
}

function createMenuButton(text: string, callbackData: string): TrainingPeaksMenuButton {
  return {
    text,
    callback_data: callbackData,
  };
}

function createInlineKeyboardMarkup(
  rows: TrainingPeaksMenuButton[][]
): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: rows,
  };
}

function createReplyKeyboardMarkup(rows: string[][]): TelegramReplyKeyboardMarkup {
  return {
    keyboard: rows.map((row) => row.map((text) => ({ text }))),
    resize_keyboard: true,
    is_persistent: true,
  };
}

function getTrainingPeaksMainReplyKeyboardMarkup(): TelegramReplyKeyboardMarkup {
  return createReplyKeyboardMarkup([
    [TP_REPLY_BUTTON_MENU, TP_REPLY_BUTTON_STUDENTS],
    [TP_REPLY_BUTTON_WEEK],
    [TP_REPLY_BUTTON_JOBS],
  ]);
}

function getTrainingPeaksStudentsReplyKeyboardMarkup(
  students: {
    studentName: string;
  }[]
): TelegramReplyKeyboardMarkup {
  return createReplyKeyboardMarkup([
    ...students.map((student) => [student.studentName]),
    [TP_REPLY_BUTTON_BACK],
    [TP_REPLY_BUTTON_MENU],
  ]);
}

function getTrainingPeaksStudentActionsReplyKeyboardMarkup(
  student: {
    isActive: boolean;
    telegramChatId: string | null;
    telegramDeliveryEnabled: boolean;
  }
): TelegramReplyKeyboardMarkup {
  const rows = [
    [TP_REPLY_BUTTON_REPORT],
    [TP_REPLY_BUTTON_TELEGRAM_LINK],
    [TP_REPLY_BUTTON_TELEGRAM_USERNAME],
    [TP_REPLY_BUTTON_TELEGRAM_CODE],
  ];

  if (student.telegramChatId && student.telegramDeliveryEnabled) {
    rows.push([TP_REPLY_BUTTON_TELEGRAM_TEST]);
  }

  rows.push([student.isActive ? TP_REPLY_BUTTON_DISABLE : TP_REPLY_BUTTON_ENABLE]);
  rows.push([TP_REPLY_BUTTON_STUDENTS_BACK, TP_REPLY_BUTTON_MENU]);

  return createReplyKeyboardMarkup(rows);
}

function getTrainingPeaksWeekReplyKeyboardMarkup(): TelegramReplyKeyboardMarkup {
  return createReplyKeyboardMarkup([
    [TP_REPLY_BUTTON_WEEK_LAST],
    [TP_REPLY_BUTTON_WEEK_CURRENT],
    [TP_REPLY_BUTTON_BACK],
    [TP_REPLY_BUTTON_MENU],
  ]);
}

function getTrainingPeaksJobsReplyKeyboardMarkup(): TelegramReplyKeyboardMarkup {
  return createReplyKeyboardMarkup([[TP_REPLY_BUTTON_JOBS_REFRESH], [TP_REPLY_BUTTON_MENU]]);
}

function getTrainingPeaksQueuedDuplicateReplyKeyboardMarkup(): TelegramReplyKeyboardMarkup {
  return createReplyKeyboardMarkup([
    [TP_REPLY_BUTTON_JOBS],
    [TP_REPLY_BUTTON_CANCEL_JOB],
    [TP_REPLY_BUTTON_MENU],
  ]);
}

function getTrainingPeaksRunningDuplicateReplyKeyboardMarkup(): TelegramReplyKeyboardMarkup {
  return createReplyKeyboardMarkup([[TP_REPLY_BUTTON_JOBS], [TP_REPLY_BUTTON_MENU]]);
}

async function sendTrainingPeaksReplyScreen(
  chatId: number | string,
  text: string,
  replyMarkup: TelegramReplyKeyboardMarkup
): Promise<void> {
  await sendTrainingPeaksMessage(chatId, text, {
    replyMarkup,
  });
}

async function sendTrainingPeaksMenuMessage(
  chatId: number | string,
  text: string,
  replyMarkup: TelegramInlineKeyboardMarkup
): Promise<void> {
  await sendTelegramMessage(chatId, text, {
    replyMarkup,
  });
}

async function editTrainingPeaksMenuMessage(
  chatId: number | string,
  messageId: number,
  text: string,
  replyMarkup: TelegramInlineKeyboardMarkup
): Promise<void> {
  await editTelegramMessageText(chatId, messageId, text, {
    replyMarkup,
  });
}

async function showTrainingPeaksMenuScreen(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate,
  text: string,
  replyMarkup: TelegramInlineKeyboardMarkup
): Promise<void> {
  if (parsedMessage.kind === "callback_query") {
    await editTrainingPeaksMenuMessage(parsedMessage.chatId, parsedMessage.messageId, text, replyMarkup);
    return;
  }

  await sendTrainingPeaksMenuMessage(parsedMessage.chatId, text, replyMarkup);
}

function parseWeekArgs(
  tokens: string[],
  usageExample: string
): { week: TrainingPeaksWeek | null; error: string | null } {
  if (tokens.length === 0) {
    return { week: null, error: null };
  }

  if (tokens.length !== 2) {
    return {
      week: null,
      error: `Напиши так: ${usageExample}`,
    };
  }

  const [weekFrom, weekTo] = tokens;

  if (!isIsoDate(weekFrom) || !isIsoDate(weekTo)) {
    return {
      week: null,
      error: "Неделю нужно передать в формате YYYY-MM-DD YYYY-MM-DD.",
    };
  }

  if (weekFrom > weekTo) {
    return {
      week: null,
      error: "Дата начала недели не может быть позже даты окончания.",
    };
  }

  return {
    week: { weekFrom, weekTo },
    error: null,
  };
}

function parseStatusCommandWeek(text: string): { week: TrainingPeaksWeek | null; error: string | null } {
  const args = text.replace(TP_STATUS_COMMAND_PATTERN, "").trim();
  return parseWeekArgs(args ? args.split(/\s+/) : [], "/tp_status 2026-04-27 2026-05-03");
}

function parseReportCommand(text: string): {
  studentQuery: string | null;
  week: TrainingPeaksWeek | null;
  error: string | null;
} {
  const args = text.replace(TP_REPORT_COMMAND_PATTERN, "").trim();

  if (!args) {
    return {
      studentQuery: null,
      week: null,
      error: "Напиши так: /tp_report Olga, /tp_report Olga last или /tp_report Olga 2026-04-27 2026-05-03",
    };
  }

  const tokens = args.split(/\s+/);
  const lastToken = tokens[tokens.length - 1] ?? "";
  const beforeLastToken = tokens[tokens.length - 2] ?? "";

  if (tokens.length >= 3 && isIsoDate(beforeLastToken) && isIsoDate(lastToken)) {
    const studentQuery = tokens.slice(0, -2).join(" ").trim();
    const { week, error } = parseWeekArgs(
      [beforeLastToken, lastToken],
      "/tp_report Olga 2026-04-27 2026-05-03"
    );

    if (!studentQuery) {
      return {
        studentQuery: null,
        week: null,
        error: "После /tp_report нужно указать ученика.",
      };
    }

    return {
      studentQuery,
      week,
      error,
    };
  }

  if (tokens.length >= 2) {
    const resolvedWeek = resolveTrainingPeaksWeekKeyword(lastToken);

    if (resolvedWeek) {
      const studentQuery = tokens.slice(0, -1).join(" ").trim();

      if (!studentQuery) {
        return {
          studentQuery: null,
          week: null,
          error: "После /tp_report нужно указать ученика.",
        };
      }

      return {
        studentQuery,
        week: resolvedWeek,
        error: null,
      };
    }
  }

  return {
    studentQuery: args,
    week: null,
    error: null,
  };
}

function parseAddStudentCommand(text: string): string {
  if (TP_ADD_COMMAND_PATTERN.test(text)) {
    return text.replace(TP_ADD_COMMAND_PATTERN, "").trim();
  }

  return text.replace(TP_ADD_STUDENT_COMMAND_PATTERN, "").trim();
}

function parseTrainingPeaksAddStudentInput(rawInput: string): ParsedTrainingPeaksAddStudentInput {
  const normalizedInput = parseAddStudentCommand(rawInput);
  const urlMatch = normalizedInput.match(TP_TRAININGPEAKS_URL_PATTERN);

  if (!urlMatch || typeof urlMatch.index !== "number") {
    return {
      studentName: normalizedInput.replace(/\|\s*$/, "").trim(),
      trainingPeaksAthleteUrl: "",
    };
  }

  return {
    studentName: normalizedInput
      .slice(0, urlMatch.index)
      .replace(/\|\s*$/, "")
      .trim(),
    trainingPeaksAthleteUrl: urlMatch[0].trim(),
  };
}

function normalizeTrainingPeaksAddStudentInput(rawInput: string): string {
  const parsedInput = parseTrainingPeaksAddStudentInput(rawInput);
  return `${parsedInput.studentName} | ${parsedInput.trainingPeaksAthleteUrl}`;
}

function getTpAddStudentNamePreview(rawInput: string): string {
  return parseTrainingPeaksAddStudentInput(rawInput).studentName;
}

function getAddStudentMissingUrlMessage(): string {
  return [
    TP_ADD_STUDENT_DEPRECATED_MESSAGE,
    "",
    "Не вижу ссылку TrainingPeaks.",
    "",
    "Legacy fallback:",
    `/tp_add_student ${TP_ADD_STUDENT_EXAMPLE}`,
  ].join("\n");
}

function getAddStudentMissingNameMessage(): string {
  return [
    TP_ADD_STUDENT_DEPRECATED_MESSAGE,
    "",
    "Не вижу имя ученика.",
    "",
    "Legacy fallback:",
    `/tp_add_student ${TP_ADD_STUDENT_EXAMPLE}`,
  ].join("\n");
}

function getAddStudentExpiredMessage(): string {
  return `${TP_ADD_STUDENT_DEPRECATED_MESSAGE}\n\nОткрой Web Admin или повтори legacy-команду /tp_add_student.`;
}

function normalizeTpRunCommand(text: string): string {
  const args = text.replace(TP_RUN_COMMAND_PATTERN, "").trim();
  return args ? `/tp_run_week ${args}` : "/tp_run_week";
}

function parseTpBusinessTestChatId(text: string): string | null {
  const args = text.replace(TP_BUSINESS_TEST_COMMAND_PATTERN, "").trim();

  if (!args) {
    return null;
  }

  const tokens = args.split(/\s+/);

  if (tokens.length !== 1) {
    return null;
  }

  return /^-?\d+$/.test(tokens[0] ?? "") ? tokens[0]! : null;
}

function parseTpSetTelegramCommand(text: string): {
  studentId: string | null;
  chatId: string | null;
  username: string | null;
} {
  const args = text.replace(TP_SET_TELEGRAM_COMMAND_PATTERN, "").trim();

  if (!args) {
    return {
      studentId: null,
      chatId: null,
      username: null,
    };
  }

  const tokens = args.split(/\s+/);

  if (tokens.length < 2 || tokens.length > 3) {
    return {
      studentId: null,
      chatId: null,
      username: null,
    };
  }

  const studentId = tokens[0]?.trim() || null;
  const chatId = tokens[1]?.trim() || null;
  const rawUsername = tokens[2]?.trim() || null;
  const username = rawUsername ? rawUsername.replace(/^@/, "") || null : null;

  return {
    studentId,
    chatId,
    username,
  };
}

function parseTpBindCommand(text: string): {
  studentQuery: string | null;
  username: string | null;
} {
  const args = text.replace(TP_BIND_COMMAND_PATTERN, "").trim();

  if (!args) {
    return {
      studentQuery: null,
      username: null,
    };
  }

  const tokens = args.split(/\s+/);
  const rawUsername = tokens[tokens.length - 1]?.trim() ?? "";
  const studentQuery = tokens.slice(0, -1).join(" ").trim() || null;
  const username = normalizeTelegramUsernameLookup(rawUsername);

  return {
    studentQuery,
    username,
  };
}

function formatTpRunAliasMessage(message: string): string {
  return message.replaceAll("/tp_run_week", "/tp_run");
}

function formatStatusMessage(
  week: TrainingPeaksWeek,
  students: {
    studentName: string;
    status: string;
    hasReport: boolean;
  }[]
): string {
  return [
    `📊 Отчёты за ${formatWeek(week)}`,
    "",
    ...students.map(
      (student) =>
        `${student.studentName} — ${getStatusEmoji(student.status)} ${getStatusLabel(student.status)}${getStatusDetails(student.status)}`
    ),
  ].join("\n");
}

function parseStudentCommand(text: string): string {
  return text.replace(TP_STUDENT_COMMAND_PATTERN, "").trim();
}

function parseDisableStudentCommand(text: string): string {
  return text.replace(TP_DISABLE_STUDENT_COMMAND_PATTERN, "").trim();
}

function parseEnableStudentCommand(text: string): string {
  return text.replace(TP_ENABLE_STUDENT_COMMAND_PATTERN, "").trim();
}

function getStudentCardReportStatusLabel(status: string): string {
  if (status === "ready") {
    return "готов";
  }

  if (status === "data_loaded") {
    return "данные загружены";
  }

  return "нет отчёта";
}

function getStudentCardStatusLabel(isActive: boolean): string {
  return isActive ? "активен" : "отключен";
}

function truncateTelegramLabel(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function getTelegramBusinessChatDisplayName(chat: {
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

function normalizeTelegramUsernameLookup(value: string): string | null {
  const normalized = value.trim().replace(/^@+/, "").replace(/\s+/g, "");
  return normalized ? normalized.toLocaleLowerCase("en-US") : null;
}

function formatTelegramUsername(username: string | null): string {
  return username ? `@${username}` : "без username";
}

function formatLinkCodeExpiresAt(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  }).format(new Date(value));
}

function getStudentTelegramStatusLabel(student: {
  telegramChatId: string | null;
  telegramUsername: string | null;
  telegramDeliveryEnabled: boolean;
}): string {
  if (!student.telegramChatId) {
    return ["Статус: не привязан", "Доставка: выключена"].join("\n");
  }

  return [
    `Статус: привязан${student.telegramUsername ? ` ${formatTelegramUsername(student.telegramUsername)}` : ""}`,
    `Доставка: ${student.telegramDeliveryEnabled ? "включена" : "выключена"}`,
    `chat_id: ${student.telegramChatId}`,
  ].join("\n");
}

function getStudentCardHint(student: {
  isActive: boolean;
  latestReportStatus: string;
  weeklyReportEnabled: boolean;
}): string | null {
  if (!student.isActive) {
    return "Ученик отключён.";
  }

  if (!student.weeklyReportEnabled) {
    return "Недельные отчёты выключены.";
  }

  if (student.latestReportStatus === "no_data") {
    return "Запусти `/tp_run last`, чтобы загрузить свежую неделю.";
  }

  return null;
}

function getStudentCardMessageLines(student: {
  studentName: string;
  isActive: boolean;
  trainingPeaksAthleteUrl: string;
  telegramChatId: string | null;
  telegramUsername: string | null;
  telegramDeliveryEnabled: boolean;
  latestWeekFrom: string | null;
  latestWeekTo: string | null;
  latestReportStatus: string;
  weeklyReportEnabled: boolean;
}): string[] {
  const hint = getStudentCardHint(student);
  const weekLabel =
    student.latestWeekFrom && student.latestWeekTo
      ? `${student.latestWeekFrom} — ${student.latestWeekTo}`
      : "ещё нет";

  return [
    `👤 ${student.studentName}`,
    `Статус: ${getStudentCardStatusLabel(student.isActive)}`,
    "TrainingPeaks:",
    student.trainingPeaksAthleteUrl,
    "",
    "Telegram:",
    getStudentTelegramStatusLabel(student),
    "",
    "Последний отчёт:",
    getStudentCardReportStatusLabel(student.latestReportStatus),
    "",
    "Неделя:",
    weekLabel,
    ...(hint ? ["", `Подсказка: ${hint}`] : []),
  ];
}

function formatStudentAmbiguityMessage(
  matches: {
    studentId: string;
    studentName: string;
  }[]
): string {
  const visibleMatches = matches.slice(0, 5).map((student) => {
    const label =
      student.studentId !== student.studentName
        ? `${student.studentName} (${student.studentId})`
        : student.studentName;
    return `• ${label}`;
  });
  const hiddenMatchesCount = Math.max(0, matches.length - visibleMatches.length);

  return [
    "Нашлось несколько учеников:",
    ...visibleMatches,
    ...(hiddenMatchesCount > 0 ? [`• ... и ещё ${hiddenMatchesCount}`] : []),
    "Уточни имя точнее.",
    "Полный список: /tp_students",
  ].join("\n");
}

function shortenJobError(errorMessage: string | null): string | null {
  const normalized = errorMessage?.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return null;
  }

  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}

function shortenDeliveryError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const normalized = raw.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "Неизвестная ошибка доставки в Telegram";
  }

  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

async function sendTelegramBusinessMessage(
  chatId: string,
  text: string,
  businessConnectionId: string
): Promise<number> {
  const chunks = splitTelegramMessage(text);

  for (const [index, chunk] of chunks.entries()) {
    try {
      await sendTelegramMessageStrict(chatId, chunk, {
        businessConnectionId,
      });
    } catch (error) {
      throw new Error(
        `Не удалось отправить часть ${index + 1} из ${chunks.length}: ${shortenDeliveryError(error)}`
      );
    }
  }

  return chunks.length;
}

async function notifyCoachReportAction(
  chatId: number | string,
  text: string
): Promise<void> {
  await sendTelegramMessage(chatId, text);
}

function getFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function getMissingStudents(resultJson: unknown): { studentId: string | null; studentName: string | null }[] {
  if (!resultJson || typeof resultJson !== "object") {
    return [];
  }

  const rawMissingStudents = (resultJson as { missing_students?: unknown }).missing_students;
  if (!Array.isArray(rawMissingStudents)) {
    return [];
  }

  return rawMissingStudents.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const studentId =
      typeof (entry as { student_id?: unknown }).student_id === "string"
        ? (entry as { student_id: string }).student_id.trim()
        : "";
    const studentName =
      typeof (entry as { student_name?: unknown }).student_name === "string"
        ? (entry as { student_name: string }).student_name.trim()
        : "";

    if (!studentId && !studentName) {
      return [];
    }

    return [
      {
        studentId: studentId || null,
        studentName: studentName || null,
      },
    ];
  });
}

function formatMissingStudentsSummary(resultJson: unknown): string | null {
  const labels = getMissingStudents(resultJson).map(
    (student) => student.studentName ?? student.studentId ?? "Unknown"
  );

  if (labels.length === 0) {
    return null;
  }

  if (labels.length <= 3) {
    return labels.join(", ");
  }

  return `${labels.slice(0, 3).join(", ")} и ещё ${labels.length - 3}`;
}

function jobHasWarnings(resultJson: unknown): boolean {
  if (!resultJson || typeof resultJson !== "object") {
    return false;
  }

  return (
    getBoolean((resultJson as { has_warnings?: unknown }).has_warnings) === true ||
    getMissingStudents(resultJson).length > 0
  );
}

function getJobCountsSummary(resultJson: unknown): string | null {
  if (!resultJson || typeof resultJson !== "object") {
    return null;
  }

  const studentsExpected = getFiniteNumber((resultJson as { students_expected?: unknown }).students_expected);
  const reportsFound = getFiniteNumber((resultJson as { reports_found?: unknown }).reports_found);
  const reportsSent = getFiniteNumber(
    (resultJson as { reports_sent_to_telegram?: unknown }).reports_sent_to_telegram
  );

  if (reportsFound === null && reportsSent === null) {
    return null;
  }

  const parts: string[] = [];

  if (reportsFound !== null) {
    parts.push(
      studentsExpected !== null ? `отчётов: ${reportsFound}/${studentsExpected}` : `отчётов: ${reportsFound}`
    );
  }

  if (reportsSent !== null) {
    parts.push(`отправлено: ${reportsSent}`);
  }

  return parts.length > 0 ? parts.join(", ") : null;
}

function getJobStatusLabel(status: string): string {
  if (status === "queued") {
    return "ожидает запуска на Mac";
  }

  if (status === "running") {
    return "выполняется на Mac";
  }

  if (status === "completed") {
    return "завершена";
  }

  if (status === "failed") {
    return "ошибка";
  }

  return status;
}

function isCancelledTrainingPeaksJob(job: {
  status: string;
  errorMessage: string | null;
}): boolean {
  return (
    job.status === "failed" &&
    job.errorMessage?.trim() === TRAININGPEAKS_JOB_CANCELLED_ERROR_MESSAGE
  );
}

function getTrainingPeaksJobStatusLabel(job: {
  status: string;
  errorMessage: string | null;
}): string {
  if (job.status === "failed" && isCancelledTrainingPeaksJob(job)) {
    return "отменена";
  }

  if (job.status === "failed") {
    return "ошибка";
  }

  return getJobStatusLabel(job.status);
}

function formatJobsMessage(
  jobs: {
    status: string;
    weekFrom: string;
    weekTo: string;
    resultJson: unknown | null;
    errorMessage: string | null;
  }[]
): string {
  return [
    "🧾 Задачи TrainingPeaks",
    "",
    ...jobs.flatMap((job) => {
      const shortError = shortenJobError(job.errorMessage);
      const countsSummary = getJobCountsSummary(job.resultJson);
      const hasWarnings = jobHasWarnings(job.resultJson);
      const missingStudentsSummary = formatMissingStudentsSummary(job.resultJson);
      const statusLabel = getTrainingPeaksJobStatusLabel(job);
      const lines = [`• ${job.weekFrom} — ${job.weekTo}`, `  Статус: ${statusLabel}`];

      if (job.status === "failed" && !isCancelledTrainingPeaksJob(job) && shortError) {
        lines.push(`  Ошибка: ${shortError}`);
        return lines;
      }

      if (job.status === "completed" && countsSummary) {
        lines.push(`  ${countsSummary}${hasWarnings ? " ⚠️" : ""}`);
        if (missingStudentsSummary) {
          lines.push(`  Не готово: ${missingStudentsSummary}`);
        }
        return lines;
      }

      return lines;
    }),
    ...(jobs.some((job) => job.status === "queued")
      ? [
          "",
          "Чтобы начать обработку, запусти локальный runner:",
          "npm run tp-agent-once",
        ]
      : []),
  ].join("\n");
}

export function isCoachChat(chatId: number | string): boolean {
  return getCoachChatIds().has(String(chatId));
}

export function isTrainingPeaksCommand(text: string): boolean {
  return getTrainingPeaksCommand(text) !== null;
}

export function getTrainingPeaksHelpLines(): string[] {
  return [
    "Что можно сделать:",
    "",
    "🏠 Меню — открыть главное меню",
    "👥 Ученики — открыть список учеников",
    "▶️ Неделя — открыть меню запуска недели",
    "🧾 Задачи — посмотреть последние запуски",
    "Управление учениками и Telegram-привязкой теперь выполняется в Web Admin.",
    "🔎 Найти по username / 🔗 Код привязки остаются fallback-инструментами в карточке ученика",
    "",
    "Команды тоже работают, но обычно быстрее пользоваться кнопками.",
  ];
}

function getTrainingPeaksReplyKeyboardAction(text: string): TrainingPeaksReplyKeyboardAction | null {
  if (text === TP_REPLY_BUTTON_MENU) {
    return "main_menu";
  }

  if (text === TP_REPLY_BUTTON_STUDENTS) {
    return "students";
  }

  if (text === TP_REPLY_BUTTON_ADD) {
    return "add_student_help";
  }

  if (text === TP_REPLY_BUTTON_WEEK) {
    return "week_menu";
  }

  if (text === TP_REPLY_BUTTON_JOBS) {
    return "jobs";
  }

  if (text === TP_REPLY_BUTTON_BACK) {
    return "back";
  }

  if (text === TP_REPLY_BUTTON_STUDENTS_BACK) {
    return "students_back";
  }

  if (text === TP_REPLY_BUTTON_WEEK_LAST) {
    return "week_last";
  }

  if (text === TP_REPLY_BUTTON_WEEK_CURRENT) {
    return "week_current";
  }

  if (text === TP_REPLY_BUTTON_JOBS_REFRESH) {
    return "jobs_refresh";
  }

  if (text === TP_REPLY_BUTTON_CANCEL_JOB) {
    return "cancel_job";
  }

  if (text === TP_REPLY_BUTTON_REPORT) {
    return "student_report";
  }

  if (text === TP_REPLY_BUTTON_TELEGRAM_LINK) {
    return "student_link";
  }

  if (text === TP_REPLY_BUTTON_TELEGRAM_USERNAME) {
    return "student_username";
  }

  if (text === TP_REPLY_BUTTON_TELEGRAM_CODE) {
    return "student_link_code";
  }

  if (text === TP_REPLY_BUTTON_TELEGRAM_TEST) {
    return "student_test";
  }

  if (text === TP_REPLY_BUTTON_DISABLE) {
    return "student_disable";
  }

  if (text === TP_REPLY_BUTTON_ENABLE) {
    return "student_enable";
  }

  return null;
}

export function isTrainingPeaksCallback(data: string | null): boolean {
  return Boolean(data?.startsWith(TP_CALLBACK_PREFIX));
}

function parseTrainingPeaksCallback(data: string | null): ParsedTrainingPeaksCallback | null {
  if (!data) {
    return null;
  }

  if (data === TP_CALLBACK_MAIN_MENU) {
    return { kind: "main_menu" };
  }

  if (data === TP_CALLBACK_WEEK_MENU) {
    return { kind: "week_menu" };
  }

  if (data === TP_CALLBACK_WEEK_LAST) {
    return { kind: "week_last" };
  }

  if (data === TP_CALLBACK_WEEK_CURRENT) {
    return { kind: "week_current" };
  }

  if (data === TP_CALLBACK_JOBS) {
    return { kind: "jobs" };
  }

  if (data === TP_CALLBACK_HELP) {
    return { kind: "help" };
  }

  if (data === TP_CALLBACK_REPORTS) {
    return { kind: "reports_hint" };
  }

  if (data.startsWith("tp:s:")) {
    const page = Number.parseInt(data.slice("tp:s:".length), 10);

    if (Number.isInteger(page) && page >= 0) {
      return { kind: "students_page", page };
    }

    return null;
  }

  for (const [prefix, kind] of [
    ["tp:i:", "student_card"],
    ["tp:r:", "student_report"],
    ["tp:d:", "student_disable"],
    ["tp:e:", "student_enable"],
    [TP_CALLBACK_STUDENT_LINK_PREFIX, "student_link"],
    [TP_CALLBACK_STUDENT_USERNAME_PREFIX, "student_username_prompt"],
    [TP_CALLBACK_STUDENT_LINK_CODE_PREFIX, "student_link_code"],
    [TP_CALLBACK_STUDENT_TEST_PREFIX, "student_test"],
  ] as const) {
    if (data.startsWith(prefix)) {
      const studentId = data.slice(prefix.length).trim();
      return studentId ? { kind, studentId } : null;
    }
  }

  if (data.startsWith(TP_CALLBACK_STUDENT_SELECT_CHAT_PREFIX)) {
    const rest = data.slice(TP_CALLBACK_STUDENT_SELECT_CHAT_PREFIX.length);
    const separatorIndex = rest.lastIndexOf(":");

    if (separatorIndex <= 0) {
      return null;
    }

    const studentId = rest.slice(0, separatorIndex).trim();
    const chatKey = rest.slice(separatorIndex + 1).trim();
    return studentId && chatKey ? { kind: "student_choose_chat", studentId, chatKey } : null;
  }

  for (const [prefix, kind] of [
    [TP_CALLBACK_REPORT_SEND_PREFIX, "report_send"],
    [TP_CALLBACK_REPORT_SKIP_PREFIX, "report_skip"],
  ] as const) {
    if (data.startsWith(prefix)) {
      const reportId = data.slice(prefix.length).trim();
      return reportId ? { kind, reportId } : null;
    }
  }

  return null;
}

function getTrainingPeaksMainMenuText(): string {
  return ["🏠 Главное меню", "Выберите действие снизу."].join("\n");
}

function getTrainingPeaksMainMenuMarkup(): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    [createMenuButton("👥 Ученики", "tp:s:0")],
    [createMenuButton("▶️ Запустить неделю", TP_CALLBACK_WEEK_MENU)],
    [createMenuButton("🧾 Задачи", TP_CALLBACK_JOBS)],
    [createMenuButton("❓ Помощь", TP_CALLBACK_HELP)],
  ]);
}

function getStudentsEmptyMenuText(): string {
  return [
    "👥 Ученики",
    "",
    "Ученики TrainingPeaks пока не найдены.",
    "",
    "Добавление учеников теперь выполняется в админке.",
  ].join("\n");
}

function getStudentsEmptyMenuMarkup(): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([[createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)]]);
}

function getStudentsPageMarkup(
  students: {
    id: string;
    studentName: string;
  }[],
  page: number,
  totalPages: number
): TelegramInlineKeyboardMarkup {
  const rows: TrainingPeaksMenuButton[][] = students.map((student) => [
    createMenuButton(student.studentName, `tp:i:${student.id}`),
  ]);

  if (totalPages > 1) {
    const paginationRow: TrainingPeaksMenuButton[] = [];

    if (page > 0) {
      paginationRow.push(createMenuButton("◀️", `tp:s:${page - 1}`));
    }

    if (page < totalPages - 1) {
      paginationRow.push(createMenuButton("▶️", `tp:s:${page + 1}`));
    }

    if (paginationRow.length > 0) {
      rows.push(paginationRow);
    }
  }

  rows.push([createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)]);

  return createInlineKeyboardMarkup(rows);
}

function getStudentsPageText(
  students: {
    studentName: string;
  }[],
  page: number,
  totalPages: number
): string {
  return [
    "👥 Ученики",
    "",
    getStudentsPageSummary(students, page, totalPages),
  ].join("\n");
}

function getStudentsPageSummary(
  students: {
    studentName: string;
  }[],
  page: number,
  totalPages: number
): string {
  return [
    `Страница ${page + 1} из ${Math.max(totalPages, 1)}`,
    ...students.map((student) => `• ${student.studentName}`),
  ].join("\n");
}

function getStudentCardMenuMarkup(
  student: {
    id: string;
    isActive: boolean;
    telegramChatId: string | null;
    telegramDeliveryEnabled: boolean;
  }
): TelegramInlineKeyboardMarkup {
  const rows: TrainingPeaksMenuButton[][] = [
    [createMenuButton("📄 Отчёт", `tp:r:${student.id}`)],
    [createMenuButton("🔗 Привязать Telegram", `${TP_CALLBACK_STUDENT_LINK_PREFIX}${student.id}`)],
    [
      createMenuButton("🔎 Найти по username", `${TP_CALLBACK_STUDENT_USERNAME_PREFIX}${student.id}`),
      createMenuButton("🔗 Код привязки", `${TP_CALLBACK_STUDENT_LINK_CODE_PREFIX}${student.id}`),
    ],
  ];

  if (student.telegramChatId && student.telegramDeliveryEnabled) {
    rows.push([createMenuButton("📨 Отправить тест", `${TP_CALLBACK_STUDENT_TEST_PREFIX}${student.id}`)]);
  }

  rows.push([
    createMenuButton(student.isActive ? "⛔ Отключить" : "✅ Включить", `${student.isActive ? "tp:d" : "tp:e"}:${student.id}`),
  ]);
  rows.push([createMenuButton("⬅️ К ученикам", "tp:s:0"), createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)]);

  return createInlineKeyboardMarkup(rows);
}

function getStudentNotFoundMarkup(): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    [createMenuButton("⬅️ К ученикам", "tp:s:0")],
    [createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)],
  ]);
}

function getStudentReportMissingMarkup(studentId: string): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    [createMenuButton("⬅️ К ученику", `tp:i:${studentId}`)],
    [createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)],
  ]);
}

function getStudentTelegramLinkEmptyText(): string {
  return [
    "Пока нет входящих Telegram Business чатов.",
    "Пусть ученик сначала напишет тебе любое сообщение.",
  ].join("\n");
}

function getStudentTelegramLinkEmptyMarkup(studentId: string): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    [createMenuButton("⬅️ К ученику", `tp:i:${studentId}`)],
    [createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)],
  ]);
}

function getStudentTelegramUsernamePromptText(studentName: string): string {
  return [
    `🔎 Поиск по username: ${studentName}`,
    "",
    "Отправь username ученика одним сообщением.",
    "Подойдут оба варианта: @username или username.",
  ].join("\n");
}

function getStudentTelegramUsernamePromptMarkup(studentId: string): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    [createMenuButton("⬅️ К ученику", `tp:i:${studentId}`)],
    [createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)],
  ]);
}

function getStudentTelegramUsernameNotFoundText(): string {
  return "Не нашёл этот username среди последних Business-чатов. Попроси ученика написать тебе любое сообщение в Telegram и повтори привязку.";
}

function getStudentTelegramUsernameMatchesText(
  studentName: string,
  username: string,
  chats: {
    firstName: string | null;
    lastName: string | null;
    username: string | null;
    lastText: string | null;
    chatId: string;
  }[]
): string {
  return [
    `🔎 Поиск по username: ${studentName}`,
    "",
    `Нашлось несколько Business-чатов с username ${formatTelegramUsername(username)}.`,
    "Выбери нужный чат:",
    "",
    ...chats.map((chat) => {
      const lastText = chat.lastText ?? "без текста";
      return `• ${getTelegramBusinessChatDisplayName(chat)} — ${lastText}`;
    }),
  ].join("\n");
}

function getStudentTelegramLinkCodeText(
  studentName: string,
  code: string,
  expiresAt: string
): string {
  return [
    `🔗 Код привязки: ${studentName}`,
    "",
    `Код: ${code}`,
    `Действует до: ${formatLinkCodeExpiresAt(expiresAt)}`,
    "",
    "Попроси ученика прислать этот код тебе в Telegram одним сообщением.",
    "Как только код придёт из Business-чата, привязка выполнится автоматически.",
  ].join("\n");
}

function getStudentTelegramLinkCodeMarkup(studentId: string): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    [createMenuButton("⬅️ К ученику", `tp:i:${studentId}`)],
    [createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)],
  ]);
}

function getStudentTelegramLinkMenuText(
  studentName: string,
  chats: {
    firstName: string | null;
    lastName: string | null;
    username: string | null;
    lastText: string | null;
    chatId: string;
  }[]
): string {
  return [
    `🔗 Привязать Telegram: ${studentName}`,
    "",
    "Выбери чат ученика из последних Telegram Business сообщений:",
    "",
    ...chats.map((chat) => {
      const displayName = getTelegramBusinessChatDisplayName(chat);
      const lastText = chat.lastText ?? "без текста";
      return `• ${displayName} — ${lastText}`;
    }),
  ].join("\n");
}

function getStudentTelegramLinkMenuMarkup(
  studentId: string,
  chats: {
    key: string;
    firstName: string | null;
    lastName: string | null;
    username: string | null;
    lastText: string | null;
    chatId: string;
  }[]
): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    ...chats.map((chat) => [
      createMenuButton(
        truncateTelegramLabel(
          `${getTelegramBusinessChatDisplayName(chat)} — ${chat.lastText ?? "без текста"}`,
          64
        ),
        `${TP_CALLBACK_STUDENT_SELECT_CHAT_PREFIX}${studentId}:${chat.key}`
      ),
    ]),
    [createMenuButton("⬅️ К ученику", `tp:i:${studentId}`)],
    [createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)],
  ]);
}

function getStudentTelegramLinkSuccessMarkup(studentId: string): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    [createMenuButton("📨 Отправить тест", `${TP_CALLBACK_STUDENT_TEST_PREFIX}${studentId}`)],
    [createMenuButton("⬅️ К ученику", `tp:i:${studentId}`)],
    [createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)],
  ]);
}

function getStudentTelegramLinkErrorMarkup(studentId: string): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    [createMenuButton("🔗 Привязать Telegram", `${TP_CALLBACK_STUDENT_LINK_PREFIX}${studentId}`)],
    [createMenuButton("⬅️ К ученику", `tp:i:${studentId}`)],
  ]);
}

async function showTrainingPeaksLinkedStudentCard(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate,
  studentId: string
): Promise<void> {
  const student = await getTrainingPeaksStudentCardByInternalId(studentId);

  if (!student) {
    if (parsedMessage.kind === "callback_query") {
      await editTrainingPeaksMenuMessage(
        parsedMessage.chatId,
        parsedMessage.messageId,
        "Ученик больше не найден.",
        getStudentNotFoundMarkup()
      );
      return;
    }

    await showTrainingPeaksSelectedStudentFallback(parsedMessage);
    return;
  }

  setTrainingPeaksScreenContext(parsedMessage.chatId, "student_actions", {
    selectedStudentId: student.id,
    selectedStudentName: student.studentName,
  });

  if (parsedMessage.kind === "callback_query") {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      getStudentCardMessageLines(student).join("\n"),
      getStudentCardMenuMarkup(student)
    );
    return;
  }

  await sendTrainingPeaksReplyScreen(
    parsedMessage.chatId,
    getStudentCardMessageLines(student).join("\n"),
    getTrainingPeaksStudentActionsReplyKeyboardMarkup(student)
  );
}

function getWeekMenuText(): string {
  return ["▶️ Запустить неделю", "Выберите период снизу."].join("\n");
}

function getWeekMenuMarkup(): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    [createMenuButton("Прошлая неделя", TP_CALLBACK_WEEK_LAST)],
    [createMenuButton("Текущая неделя", TP_CALLBACK_WEEK_CURRENT)],
    [createMenuButton("⬅️ Назад", TP_CALLBACK_MAIN_MENU)],
  ]);
}

function getJobsMenuMarkup(): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    [createMenuButton("🔄 Обновить задачи", TP_CALLBACK_JOBS)],
    [createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)],
  ]);
}

function getReportsHintText(): string {
  return "Отчёты открываются из карточки ученика: 👥 Ученики -> выберите ученика -> Отчёт.";
}

function getReportsHintMarkup(): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    [createMenuButton("👥 К ученикам", "tp:s:0")],
    [createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)],
  ]);
}

function getHelpMenuText(): string {
  return getTrainingPeaksHelpLines().join("\n");
}

function getHelpMenuMarkup(): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([[createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)]]);
}

function getAddStudentInstructionsText(): string {
  return [
    TP_ADD_STUDENT_DEPRECATED_MESSAGE,
    "",
    "Основной путь: Web Admin -> Ученики.",
    "",
    "Legacy fallback по команде всё ещё доступен:",
    `/tp_add_student ${TP_ADD_STUDENT_EXAMPLE}`,
  ].join("\n");
}

function getAddStudentInstructionsMarkup(): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([[createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)]]);
}

function getCallbackErrorMarkup(): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([[createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)]]);
}

function getStudentsReplyScreenText(): string {
  return ["👥 Ученики", "Выберите ученика снизу."].join("\n");
}

function getJobsScreenText(
  jobs: {
    status: string;
    weekFrom: string;
    weekTo: string;
    resultJson: unknown | null;
    errorMessage: string | null;
  }[]
): string {
  return jobs.length === 0 ? "🧾 Задачи TrainingPeaks\n\nПока задач нет." : formatJobsMessage(jobs);
}

function getSelectedStudentMissingText(): string {
  return [
    "Не вижу, для какого ученика открыть действие.",
    "Сначала выберите ученика через «👥 Ученики».",
  ].join("\n");
}

async function findStudentByExactReplyButtonName(text: string): Promise<
  | {
      kind: "student";
      student: Awaited<ReturnType<typeof getTrainingPeaksStudentsRegistryWithLatestReportStatus>>[number];
    }
  | { kind: "ambiguous"; matches: { studentId: string; studentName: string }[] }
  | { kind: "not_found" }
> {
  const students = await getTrainingPeaksStudentsRegistryWithLatestReportStatus();
  const matches = students.filter((student) => student.studentName === text);

  if (matches.length === 0) {
    return { kind: "not_found" };
  }

  if (matches.length > 1) {
    return {
      kind: "ambiguous",
      matches: matches.map((student) => ({
        studentId: student.studentId,
        studentName: student.studentName,
      })),
    };
  }

  return {
    kind: "student",
    student: matches[0]!,
  };
}

async function showTrainingPeaksSelectedStudentFallback(
  parsedMessage: ParsedTelegramUpdate
): Promise<void> {
  const students = await getTrainingPeaksStudentsRegistryWithLatestReportStatus();

  if (students.length === 0) {
    clearTrainingPeaksSelectedStudent(parsedMessage.chatId, "main_menu");
    await sendTrainingPeaksReplyScreen(
      parsedMessage.chatId,
      getSelectedStudentMissingText(),
      getTrainingPeaksMainReplyKeyboardMarkup()
    );
    return;
  }

  clearTrainingPeaksSelectedStudent(parsedMessage.chatId, "students");
  await sendTrainingPeaksReplyScreen(
    parsedMessage.chatId,
    getSelectedStudentMissingText(),
    getTrainingPeaksStudentsReplyKeyboardMarkup(students)
  );
}

function getSelectedStudentContext(chatId: number | string): {
  selectedStudentId: string;
  selectedStudentName: string;
} | null {
  const context = getTrainingPeaksChatContext(chatId);

  if (!context?.selectedStudentId || !context.selectedStudentName) {
    return null;
  }

  return {
    selectedStudentId: context.selectedStudentId,
    selectedStudentName: context.selectedStudentName,
  };
}

async function showTrainingPeaksMainMenu(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate
): Promise<void> {
  clearTrainingPeaksSelectedStudent(parsedMessage.chatId, "main_menu");
  clearTrainingPeaksTelegramLinkContext(parsedMessage.chatId);

  if (parsedMessage.kind === "callback_query") {
    await showTrainingPeaksMenuScreen(parsedMessage, getTrainingPeaksMainMenuText(), getTrainingPeaksMainMenuMarkup());
    return;
  }

  await sendTrainingPeaksReplyScreen(
    parsedMessage.chatId,
    getTrainingPeaksMainMenuText(),
    getTrainingPeaksMainReplyKeyboardMarkup()
  );
}

async function showTrainingPeaksStudentsPage(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate,
  requestedPage: number
): Promise<void> {
  clearTrainingPeaksTelegramLinkContext(parsedMessage.chatId);
  const students = await getTrainingPeaksStudentsRegistryWithLatestReportStatus();

  if (students.length === 0) {
    clearTrainingPeaksSelectedStudent(parsedMessage.chatId, "students");

    if (parsedMessage.kind === "callback_query") {
      await showTrainingPeaksMenuScreen(parsedMessage, getStudentsEmptyMenuText(), getStudentsEmptyMenuMarkup());
      return;
    }

    await sendTrainingPeaksReplyScreen(
      parsedMessage.chatId,
      getStudentsEmptyMenuText(),
      getTrainingPeaksMainReplyKeyboardMarkup()
    );
    return;
  }

  clearTrainingPeaksSelectedStudent(parsedMessage.chatId, "students");

  if (parsedMessage.kind === "message") {
    await sendTrainingPeaksReplyScreen(
      parsedMessage.chatId,
      getStudentsReplyScreenText(),
      getTrainingPeaksStudentsReplyKeyboardMarkup(students)
    );
    return;
  }

  const totalPages = Math.max(1, Math.ceil(students.length / STUDENTS_PAGE_SIZE));
  const safePage = Math.min(Math.max(requestedPage, 0), totalPages - 1);
  const startIndex = safePage * STUDENTS_PAGE_SIZE;
  const pageStudents = students.slice(startIndex, startIndex + STUDENTS_PAGE_SIZE);
  const text = getStudentsPageText(pageStudents, safePage, totalPages);
  const markup = getStudentsPageMarkup(pageStudents, safePage, totalPages);

  await showTrainingPeaksMenuScreen(parsedMessage, text, markup);
}

async function showTrainingPeaksStudentCardMenu(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate,
  studentId: string
): Promise<void> {
  const student = await getTrainingPeaksStudentCardByInternalId(studentId);

  if (!student) {
    const text = "Ученик больше не найден.";
    const markup = getStudentNotFoundMarkup();

    if (parsedMessage.kind === "callback_query") {
      await editTrainingPeaksMenuMessage(parsedMessage.chatId, parsedMessage.messageId, text, markup);
      return;
    }

    clearTrainingPeaksSelectedStudent(parsedMessage.chatId, "students");
    await sendTrainingPeaksReplyScreen(
      parsedMessage.chatId,
      text,
      getTrainingPeaksMainReplyKeyboardMarkup()
    );
    return;
  }

  const text = getStudentCardMessageLines(student).join("\n");
  const markup = getStudentCardMenuMarkup(student);
  clearTrainingPeaksTelegramLinkContext(parsedMessage.chatId);
  setTrainingPeaksScreenContext(parsedMessage.chatId, "student_actions", {
    selectedStudentId: student.id,
    selectedStudentName: student.studentName,
  });

  if (parsedMessage.kind === "callback_query") {
    await editTrainingPeaksMenuMessage(parsedMessage.chatId, parsedMessage.messageId, text, markup);
    return;
  }

  await sendTrainingPeaksReplyScreen(
    parsedMessage.chatId,
    text,
    getTrainingPeaksStudentActionsReplyKeyboardMarkup(student)
  );
}

async function showTrainingPeaksStudentTelegramLinkMenu(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate,
  studentId: string
): Promise<void> {
  const [student, chats] = await Promise.all([
    getTrainingPeaksStudentCardByInternalId(studentId),
    listRecentTrainingPeaksBusinessChats(10),
  ]);

  if (!student) {
    if (parsedMessage.kind === "callback_query") {
      await editTrainingPeaksMenuMessage(
        parsedMessage.chatId,
        parsedMessage.messageId,
        "Ученик больше не найден.",
        getStudentNotFoundMarkup()
      );
      return;
    }

    await showTrainingPeaksSelectedStudentFallback(parsedMessage);
    return;
  }

  if (chats.length === 0) {
    if (parsedMessage.kind === "callback_query") {
      await editTrainingPeaksMenuMessage(
        parsedMessage.chatId,
        parsedMessage.messageId,
        getStudentTelegramLinkEmptyText(),
        getStudentTelegramLinkEmptyMarkup(student.id)
      );
      return;
    }

    await sendTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      getStudentTelegramLinkEmptyText(),
      getStudentTelegramLinkEmptyMarkup(student.id)
    );
    return;
  }

  const chatsWithKeys = chats.map((chat, index) => ({
    ...chat,
    key: index.toString(36),
  }));

  setTrainingPeaksTelegramLinkContext(
    parsedMessage.chatId,
    student.id,
    Object.fromEntries(chatsWithKeys.map((chat) => [chat.key, chat.id]))
  );
  setTrainingPeaksScreenContext(parsedMessage.chatId, "student_actions", {
    selectedStudentId: student.id,
    selectedStudentName: student.studentName,
  });

  if (parsedMessage.kind === "callback_query") {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      getStudentTelegramLinkMenuText(student.studentName, chatsWithKeys),
      getStudentTelegramLinkMenuMarkup(student.id, chatsWithKeys)
    );
    return;
  }

  await sendTrainingPeaksMenuMessage(
    parsedMessage.chatId,
    getStudentTelegramLinkMenuText(student.studentName, chatsWithKeys),
    getStudentTelegramLinkMenuMarkup(student.id, chatsWithKeys)
  );
}

async function promptTrainingPeaksStudentUsernameLookup(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate,
  studentId: string
): Promise<void> {
  const student = await getTrainingPeaksStudentCardByInternalId(studentId);

  if (!student) {
    if (parsedMessage.kind === "callback_query") {
      await editTrainingPeaksMenuMessage(
        parsedMessage.chatId,
        parsedMessage.messageId,
        "Ученик больше не найден.",
        getStudentNotFoundMarkup()
      );
      return;
    }

    await showTrainingPeaksSelectedStudentFallback(parsedMessage);
    return;
  }

  clearTrainingPeaksTelegramLinkContext(parsedMessage.chatId);
  setTrainingPeaksUsernameWaitingContext(parsedMessage.chatId, student.id, student.studentName);

  if (parsedMessage.kind === "callback_query") {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      getStudentTelegramUsernamePromptText(student.studentName),
      getStudentTelegramUsernamePromptMarkup(student.id)
    );
    return;
  }

  await sendTrainingPeaksReplyScreen(
    parsedMessage.chatId,
    getStudentTelegramUsernamePromptText(student.studentName),
    getTrainingPeaksStudentActionsReplyKeyboardMarkup(student)
  );
}

async function handleTrainingPeaksStudentUsernameLookup(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate,
  studentId: string,
  rawUsername: string
): Promise<void> {
  const student = await getTrainingPeaksStudentCardByInternalId(studentId);

  if (!student) {
    if (parsedMessage.kind === "callback_query") {
      await editTrainingPeaksMenuMessage(
        parsedMessage.chatId,
        parsedMessage.messageId,
        "Ученик больше не найден.",
        getStudentNotFoundMarkup()
      );
      return;
    }

    await showTrainingPeaksSelectedStudentFallback(parsedMessage);
    return;
  }

  const username = normalizeTelegramUsernameLookup(rawUsername);

  if (!username) {
    setTrainingPeaksUsernameWaitingContext(parsedMessage.chatId, student.id, student.studentName);

    if (parsedMessage.kind === "callback_query") {
      await editTrainingPeaksMenuMessage(
        parsedMessage.chatId,
        parsedMessage.messageId,
        getStudentTelegramUsernamePromptText(student.studentName),
        getStudentTelegramUsernamePromptMarkup(student.id)
      );
      return;
    }

    await sendTrainingPeaksReplyScreen(
      parsedMessage.chatId,
      [
        "Не вижу username.",
        "",
        getStudentTelegramUsernamePromptText(student.studentName),
      ].join("\n"),
      getTrainingPeaksStudentActionsReplyKeyboardMarkup(student)
    );
    return;
  }

  const chats = await findTrainingPeaksBusinessChatsByUsername(username, 10);
  setTrainingPeaksScreenContext(parsedMessage.chatId, "student_actions", {
    selectedStudentId: student.id,
    selectedStudentName: student.studentName,
  });

  if (chats.length === 0) {
    clearTrainingPeaksTelegramLinkContext(parsedMessage.chatId);

    if (parsedMessage.kind === "callback_query") {
      await editTrainingPeaksMenuMessage(
        parsedMessage.chatId,
        parsedMessage.messageId,
        getStudentTelegramUsernameNotFoundText(),
        getStudentTelegramLinkErrorMarkup(student.id)
      );
      return;
    }

    await sendTrainingPeaksReplyScreen(
      parsedMessage.chatId,
      getStudentTelegramUsernameNotFoundText(),
      getTrainingPeaksStudentActionsReplyKeyboardMarkup(student)
    );
    return;
  }

  if (chats.length === 1) {
    const linked = await linkTrainingPeaksStudentToBusinessChat(
      student.id,
      chats[0]!.chatId,
      chats[0]!.businessConnectionId
    );

    if (!linked) {
      clearTrainingPeaksTelegramLinkContext(parsedMessage.chatId);

      if (parsedMessage.kind === "callback_query") {
        await editTrainingPeaksMenuMessage(
          parsedMessage.chatId,
          parsedMessage.messageId,
          "Не удалось привязать Telegram. Попробуй ещё раз.",
          getStudentTelegramLinkErrorMarkup(student.id)
        );
        return;
      }

      await sendTrainingPeaksReplyScreen(
        parsedMessage.chatId,
        "Не удалось привязать Telegram. Попробуй ещё раз.",
        getTrainingPeaksStudentActionsReplyKeyboardMarkup(student)
      );
      return;
    }

    clearTrainingPeaksTelegramLinkContext(parsedMessage.chatId);
    await showTrainingPeaksLinkedStudentCard(parsedMessage, linked.student.id);
    return;
  }

  const chatsWithKeys = chats.map((chat, index) => ({
    ...chat,
    key: index.toString(36),
  }));

  setTrainingPeaksTelegramLinkContext(
    parsedMessage.chatId,
    student.id,
    Object.fromEntries(chatsWithKeys.map((chat) => [chat.key, chat.id]))
  );

  if (parsedMessage.kind === "callback_query") {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      getStudentTelegramUsernameMatchesText(student.studentName, username, chatsWithKeys),
      getStudentTelegramLinkMenuMarkup(student.id, chatsWithKeys)
    );
    return;
  }

  await sendTrainingPeaksMenuMessage(
    parsedMessage.chatId,
    getStudentTelegramUsernameMatchesText(student.studentName, username, chatsWithKeys),
    getStudentTelegramLinkMenuMarkup(student.id, chatsWithKeys)
  );
}

async function handleTrainingPeaksStudentLinkCodeRequest(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate,
  studentId: string
): Promise<void> {
  const result = await createTrainingPeaksStudentTelegramLinkCode(studentId);

  if (!result) {
    if (parsedMessage.kind === "callback_query") {
      await editTrainingPeaksMenuMessage(
        parsedMessage.chatId,
        parsedMessage.messageId,
        "Ученик больше не найден.",
        getStudentNotFoundMarkup()
      );
      return;
    }

    await showTrainingPeaksSelectedStudentFallback(parsedMessage);
    return;
  }

  setTrainingPeaksScreenContext(parsedMessage.chatId, "student_actions", {
    selectedStudentId: result.student.id,
    selectedStudentName: result.student.studentName,
  });

  if (parsedMessage.kind === "callback_query") {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      getStudentTelegramLinkCodeText(
        result.student.studentName,
        result.linkCode.code,
        result.linkCode.expiresAt
      ),
      getStudentTelegramLinkCodeMarkup(result.student.id)
    );
    return;
  }

  await sendTrainingPeaksReplyScreen(
    parsedMessage.chatId,
    getStudentTelegramLinkCodeText(
      result.student.studentName,
      result.linkCode.code,
      result.linkCode.expiresAt
    ),
    getTrainingPeaksStudentActionsReplyKeyboardMarkup(result.student)
  );
}

async function notifyCoachChats(text: string): Promise<void> {
  const coachChatIds = Array.from(getCoachChatIds());

  if (coachChatIds.length === 0) {
    return;
  }

  await Promise.allSettled(
    coachChatIds.map(async (chatId) => {
      await sendTelegramMessage(chatId, text);
    })
  );
}

export async function handleTrainingPeaksTelegramBusinessMessage(
  message: Pick<TelegramMessage, "business_connection_id" | "chat" | "text" | "caption">
): Promise<void> {
  const persistedChat = await upsertTrainingPeaksBusinessChatFromMessage(message);
  const businessConnectionId = message.business_connection_id?.trim();
  const chatId =
    message.chat?.id === undefined || message.chat?.id === null ? null : String(message.chat.id);
  const messageText = (message.text ?? message.caption ?? "").trim();

  if (!persistedChat || !businessConnectionId || !chatId || !messageText) {
    return;
  }

  const result = await consumeTrainingPeaksStudentTelegramLinkCode(
    messageText,
    businessConnectionId,
    chatId
  );

  if (result.kind === "no_candidate" || result.kind === "no_match") {
    return;
  }

  if (result.kind === "linked") {
    await notifyCoachChats(
      [
        `✅ Telegram привязан по коду ${result.code}.`,
        `Ученик: ${result.student.studentName}`,
        `Чат: ${getTelegramBusinessChatDisplayName(result.chat)}`,
      ].join("\n")
    );
    return;
  }

  if (result.kind === "used") {
    await notifyCoachChats(
      `Код привязки ${result.code} уже использован${result.studentName ? ` для ${result.studentName}` : ""}. Новая привязка не выполнена.`
    );
    return;
  }

  if (result.kind === "expired") {
    await notifyCoachChats(
      `Код привязки ${result.code} истёк${result.studentName ? ` для ${result.studentName}` : ""}. Сгенерируй новый код и попроси ученика отправить его снова.`
    );
    return;
  }

  if (result.kind === "ambiguous") {
    await notifyCoachChats(
      `По коду ${result.code} найдено несколько активных записей (${result.matches}). Автопривязка не выполнена.`
    );
    return;
  }

  await notifyCoachChats(
    `Не удалось завершить привязку по коду ${result.code}${result.studentName ? ` для ${result.studentName}` : ""}.`
  );
}

async function handleTrainingPeaksStudentChooseBusinessChatCallback(
  parsedMessage: ParsedTelegramCallbackUpdate,
  studentId: string,
  chatKey: string
): Promise<void> {
  const linkContext = getTrainingPeaksTelegramLinkContext(parsedMessage.chatId);

  if (!linkContext || linkContext.studentId !== studentId) {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      "Список чатов устарел. Нажми «Привязать Telegram» ещё раз.",
      getStudentTelegramLinkErrorMarkup(studentId)
    );
    return;
  }

  const businessChatId = linkContext.optionsByKey[chatKey];

  if (!businessChatId) {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      "Не вижу выбранный чат. Нажми «Привязать Telegram» ещё раз.",
      getStudentTelegramLinkErrorMarkup(studentId)
    );
    return;
  }

  const [student, businessChat] = await Promise.all([
    getTrainingPeaksStudentCardByInternalId(studentId),
    getTrainingPeaksBusinessChatByInternalId(businessChatId),
  ]);

  if (!student) {
    clearTrainingPeaksTelegramLinkContext(parsedMessage.chatId);
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      "Ученик больше не найден.",
      getStudentNotFoundMarkup()
    );
    return;
  }

  if (!businessChat) {
    clearTrainingPeaksTelegramLinkContext(parsedMessage.chatId);
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      "Чат больше не найден. Открой список и выбери заново.",
      getStudentTelegramLinkErrorMarkup(student.id)
    );
    return;
  }

  const linked = await linkTrainingPeaksStudentToBusinessChat(
    student.id,
    businessChat.chatId,
    businessChat.businessConnectionId
  );

  if (!linked) {
    clearTrainingPeaksTelegramLinkContext(parsedMessage.chatId);
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      "Не удалось привязать Telegram. Попробуй выбрать чат ещё раз.",
      getStudentTelegramLinkErrorMarkup(student.id)
    );
    return;
  }

  clearTrainingPeaksTelegramLinkContext(parsedMessage.chatId);
  await showTrainingPeaksLinkedStudentCard(parsedMessage, linked.student.id);
}

async function sendTrainingPeaksStudentTestMessage(
  studentId: string
): Promise<
  | { kind: "not_found" }
  | { kind: "not_configured"; studentId: string }
  | { kind: "missing_business_connection"; studentId: string }
  | { kind: "sent"; studentId: string; studentName: string }
  | { kind: "failed"; studentId: string; errorMessage: string }
> {
  const student = await getTrainingPeaksStudentById(studentId);

  if (!student) {
    return { kind: "not_found" };
  }

  if (!student.telegramChatId || !student.telegramDeliveryEnabled) {
    return { kind: "not_configured", studentId: student.id };
  }

  const businessConnectionId = process.env.TELEGRAM_BUSINESS_CONNECTION_ID?.trim();

  if (!businessConnectionId) {
    return { kind: "missing_business_connection", studentId: student.id };
  }

  try {
    await sendTelegramBusinessMessage(
      student.telegramChatId,
      "Тестовое сообщение от Игоря ✅",
      businessConnectionId
    );
    return {
      kind: "sent",
      studentId: student.id,
      studentName: student.studentName,
    };
  } catch (error) {
    return {
      kind: "failed",
      studentId: student.id,
      errorMessage: shortenDeliveryError(error),
    };
  }
}

async function handleTrainingPeaksStudentTestMessageCallback(
  parsedMessage: ParsedTelegramCallbackUpdate,
  studentId: string
): Promise<void> {
  const result = await sendTrainingPeaksStudentTestMessage(studentId);

  if (result.kind === "not_found") {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      "Ученик больше не найден.",
      getStudentNotFoundMarkup()
    );
    return;
  }

  if (result.kind === "not_configured") {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      "Не могу отправить тест: у ученика не привязан Telegram или доставка выключена.",
      getStudentTelegramLinkErrorMarkup(result.studentId)
    );
    return;
  }

  if (result.kind === "missing_business_connection") {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      "Не могу отправить тест: missing TELEGRAM_BUSINESS_CONNECTION_ID.",
      getStudentTelegramLinkSuccessMarkup(result.studentId)
    );
    return;
  }

  if (result.kind === "sent") {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      `✅ Тестовое сообщение отправлено: ${result.studentName}.`,
      getStudentTelegramLinkSuccessMarkup(result.studentId)
    );
    return;
  }

  await editTrainingPeaksMenuMessage(
    parsedMessage.chatId,
    parsedMessage.messageId,
    `Не удалось отправить тестовое сообщение: ${result.errorMessage}.`,
    getStudentTelegramLinkSuccessMarkup(result.studentId)
  );
}

async function showTrainingPeaksWeekMenu(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate
): Promise<void> {
  setTrainingPeaksScreenContext(parsedMessage.chatId, "week");

  if (parsedMessage.kind === "callback_query") {
    await showTrainingPeaksMenuScreen(parsedMessage, getWeekMenuText(), getWeekMenuMarkup());
    return;
  }

  await sendTrainingPeaksReplyScreen(
    parsedMessage.chatId,
    getWeekMenuText(),
    getTrainingPeaksWeekReplyKeyboardMarkup()
  );
}

async function showTrainingPeaksJobsMenu(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate
): Promise<void> {
  const jobs = await getTrainingPeaksJobsStatus();
  const text = getJobsScreenText(jobs);
  const markup = getJobsMenuMarkup();
  setTrainingPeaksScreenContext(parsedMessage.chatId, "jobs");

  if (parsedMessage.kind === "callback_query") {
    await showTrainingPeaksMenuScreen(parsedMessage, text, markup);
    return;
  }

  await sendTrainingPeaksReplyScreen(parsedMessage.chatId, text, getTrainingPeaksJobsReplyKeyboardMarkup());
}

async function showTrainingPeaksReportsHint(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate
): Promise<void> {
  if (parsedMessage.kind === "callback_query") {
    await showTrainingPeaksMenuScreen(parsedMessage, getReportsHintText(), getReportsHintMarkup());
    return;
  }

  await sendTrainingPeaksReplyScreen(
    parsedMessage.chatId,
    getReportsHintText(),
    getTrainingPeaksMainReplyKeyboardMarkup()
  );
}

async function showTrainingPeaksHelpMenu(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate
): Promise<void> {
  if (parsedMessage.kind === "callback_query") {
    await showTrainingPeaksMenuScreen(parsedMessage, getHelpMenuText(), getHelpMenuMarkup());
    return;
  }

  await sendTrainingPeaksReplyScreen(
    parsedMessage.chatId,
    getHelpMenuText(),
    getTrainingPeaksMainReplyKeyboardMarkup()
  );
}

async function showTrainingPeaksAddStudentInstructions(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate
): Promise<void> {
  setTrainingPeaksAddStudentWaitingContext(parsedMessage.chatId);

  if (parsedMessage.kind === "callback_query") {
    await showTrainingPeaksMenuScreen(
      parsedMessage,
      getAddStudentInstructionsText(),
      getAddStudentInstructionsMarkup()
    );
    return;
  }

  await sendTrainingPeaksReplyScreen(
    parsedMessage.chatId,
    getAddStudentInstructionsText(),
    getTrainingPeaksMainReplyKeyboardMarkup()
  );
}

async function handleTrainingPeaksAddStudentInput(
  parsedMessage: ParsedTelegramUpdate,
  rawInput: string,
  options?: {
    showStudentsListOnSuccess?: boolean;
  }
): Promise<void> {
  const parsedInput = parseTrainingPeaksAddStudentInput(rawInput);

  if (!parsedInput.trainingPeaksAthleteUrl) {
    await sendTrainingPeaksReplyScreen(
      parsedMessage.chatId,
      getAddStudentMissingUrlMessage(),
      getTrainingPeaksMainReplyKeyboardMarkup()
    );
    return;
  }

  if (!parsedInput.studentName) {
    await sendTrainingPeaksReplyScreen(
      parsedMessage.chatId,
      getAddStudentMissingNameMessage(),
      getTrainingPeaksMainReplyKeyboardMarkup()
    );
    return;
  }

  const normalizedInput = normalizeTrainingPeaksAddStudentInput(rawInput);
  const result = await addTrainingPeaksStudentFromCommand(normalizedInput);
  const studentName = getTpAddStudentNamePreview(normalizedInput);

  if (!result.ok) {
    if (result.reason === "empty_name") {
      await sendTrainingPeaksReplyScreen(
        parsedMessage.chatId,
        getAddStudentMissingNameMessage(),
        getTrainingPeaksMainReplyKeyboardMarkup()
      );
      return;
    }

    if (result.reason === "invalid_url") {
      await sendTrainingPeaksReplyScreen(
        parsedMessage.chatId,
        [TP_ADD_STUDENT_DEPRECATED_MESSAGE, "", "Ссылка на TrainingPeaks должна начинаться с https://"].join(
          "\n"
        ),
        getTrainingPeaksMainReplyKeyboardMarkup()
      );
      return;
    }

    if (result.reason === "duplicate_student") {
      await sendTrainingPeaksReplyScreen(
        parsedMessage.chatId,
        [TP_ADD_STUDENT_DEPRECATED_MESSAGE, "", `Ученик "${studentName}" уже существует.`].join("\n"),
        getTrainingPeaksMainReplyKeyboardMarkup()
      );
      return;
    }

    if (result.reason === "duplicate_url") {
      await sendTrainingPeaksReplyScreen(
        parsedMessage.chatId,
        [
          TP_ADD_STUDENT_DEPRECATED_MESSAGE,
          "",
          "Этот URL TrainingPeaks уже привязан к другому ученику.",
        ].join("\n"),
        getTrainingPeaksMainReplyKeyboardMarkup()
      );
      return;
    }

    await sendTrainingPeaksReplyScreen(
      parsedMessage.chatId,
      [TP_ADD_STUDENT_DEPRECATED_MESSAGE, "", "Не смог добавить ученика в Supabase. Попробуй позже."].join(
        "\n"
      ),
      getTrainingPeaksMainReplyKeyboardMarkup()
    );
    return;
  }

  clearTrainingPeaksChatContext(parsedMessage.chatId);

  if (options?.showStudentsListOnSuccess) {
    await sendTrainingPeaksMessage(
      parsedMessage.chatId,
      [TP_ADD_STUDENT_DEPRECATED_MESSAGE, "", `✅ Ученик добавлен: ${result.student.studentName}`].join(
        "\n"
      )
    );
    await showTrainingPeaksStudentsPage(parsedMessage, 0);
    return;
  }

  await sendTrainingPeaksReplyScreen(
    parsedMessage.chatId,
    [
      TP_ADD_STUDENT_DEPRECATED_MESSAGE,
      "",
      `✅ Ученик добавлен: ${result.student.studentName}`,
      "",
      "Локальный Mac runner подтянет этого ученика из Supabase при следующем запуске tp-agent-once.",
    ].join("\n"),
    getTrainingPeaksMainReplyKeyboardMarkup()
  );
}

export async function handleTrainingPeaksTelegramHelp(
  parsedMessage: ParsedTelegramMessageUpdate
): Promise<void> {
  await showTrainingPeaksHelpMenu(parsedMessage);
}

export async function handleTrainingPeaksTelegramReplyKeyboardMessage(
  parsedMessage: ParsedTelegramMessageUpdate,
  text: string
): Promise<"handled" | "ignored"> {
  const action = getTrainingPeaksReplyKeyboardAction(text);

  if (!isCoachChat(parsedMessage.chatId)) {
    if (!action) {
      return "ignored";
    }

    await sendTrainingPeaksMessage(parsedMessage.chatId, COACH_ONLY_MESSAGE);
    return "handled";
  }

  try {
    if (!action) {
      if (!isTrainingPeaksCommand(text)) {
        const chatContextState = getTrainingPeaksChatContextState(parsedMessage.chatId);

        if (
          chatContextState.kind === "expired" &&
          chatContextState.context.screen === "add_student_waiting"
        ) {
          await sendTrainingPeaksReplyScreen(
            parsedMessage.chatId,
            getAddStudentExpiredMessage(),
            getTrainingPeaksMainReplyKeyboardMarkup()
          );
          return "handled";
        }

        if (
          chatContextState.kind === "expired" &&
          chatContextState.context.screen === "student_username_waiting"
        ) {
          await sendTrainingPeaksReplyScreen(
            parsedMessage.chatId,
            "Режим поиска по username истёк. Нажми «🔎 Найти по username» ещё раз.",
            getTrainingPeaksMainReplyKeyboardMarkup()
          );
          return "handled";
        }

        if (
          chatContextState.kind === "active" &&
          chatContextState.context.screen === "add_student_waiting"
        ) {
          await handleTrainingPeaksAddStudentInput(parsedMessage, text, {
            showStudentsListOnSuccess: true,
          });
          return "handled";
        }

        if (
          chatContextState.kind === "active" &&
          chatContextState.context.screen === "student_username_waiting" &&
          chatContextState.context.selectedStudentId
        ) {
          await handleTrainingPeaksStudentUsernameLookup(
            parsedMessage,
            chatContextState.context.selectedStudentId,
            text
          );
          return "handled";
        }
      }

      const studentSelection = await findStudentByExactReplyButtonName(text);

      if (studentSelection.kind === "not_found") {
        return "ignored";
      }

      if (studentSelection.kind === "ambiguous") {
        await sendTrainingPeaksMessage(
          parsedMessage.chatId,
          formatStudentAmbiguityMessage(studentSelection.matches)
        );
        return "handled";
      }

      await showTrainingPeaksStudentCardMenu(parsedMessage, studentSelection.student.id);
      return "handled";
    }

    if (action === "main_menu") {
      await showTrainingPeaksMainMenu(parsedMessage);
      return "handled";
    }

    if (action === "students") {
      await showTrainingPeaksStudentsPage(parsedMessage, 0);
      return "handled";
    }

    if (action === "add_student_help") {
      await showTrainingPeaksAddStudentInstructions(parsedMessage);
      return "handled";
    }

    if (action === "week_menu") {
      await showTrainingPeaksWeekMenu(parsedMessage);
      return "handled";
    }

    if (action === "jobs") {
      await showTrainingPeaksJobsMenu(parsedMessage);
      return "handled";
    }

    if (action === "back") {
      await showTrainingPeaksMainMenu(parsedMessage);
      return "handled";
    }

    if (action === "students_back") {
      await showTrainingPeaksStudentsPage(parsedMessage, 0);
      return "handled";
    }

    if (action === "week_last" || action === "week_current") {
      await handleTrainingPeaksRunWeek(
        parsedMessage,
        action === "week_last" ? "/tp_run_week last" : "/tp_run_week current"
      );
      return "handled";
    }

    if (action === "jobs_refresh") {
      await showTrainingPeaksJobsMenu(parsedMessage);
      return "handled";
    }

    if (action === "cancel_job") {
      await handleTrainingPeaksCancelQueuedJob(parsedMessage);
      return "handled";
    }

    if (action === "student_report") {
      const selectedStudent = getSelectedStudentContext(parsedMessage.chatId);

      if (!selectedStudent) {
        await showTrainingPeaksSelectedStudentFallback(parsedMessage);
        return "handled";
      }

      const student = await getTrainingPeaksStudentCardByInternalId(selectedStudent.selectedStudentId);

      if (!student) {
        await showTrainingPeaksSelectedStudentFallback(parsedMessage);
        return "handled";
      }

      const report = await getTrainingPeaksLatestReportSnapshotByInternalId(student.id);

      if (!report) {
        await sendTrainingPeaksReplyScreen(
          parsedMessage.chatId,
          "Последний отчёт для этого ученика пока не найден.",
          getTrainingPeaksStudentActionsReplyKeyboardMarkup(student)
        );
        setTrainingPeaksScreenContext(parsedMessage.chatId, "student_actions", {
          selectedStudentId: student.id,
          selectedStudentName: student.studentName,
        });
        return "handled";
      }

      await sendTrainingPeaksMessage(
        parsedMessage.chatId,
        `📝 ${report.studentName} — отчёт за ${formatWeek(report)}\n\n${report.reportMarkdown}`,
        {
          replyMarkup: getTrainingPeaksStudentActionsReplyKeyboardMarkup(student),
        }
      );
      setTrainingPeaksScreenContext(parsedMessage.chatId, "student_actions", {
        selectedStudentId: student.id,
        selectedStudentName: student.studentName,
      });
      return "handled";
    }

    if (action === "student_link") {
      const selectedStudent = getSelectedStudentContext(parsedMessage.chatId);

      if (!selectedStudent) {
        await showTrainingPeaksSelectedStudentFallback(parsedMessage);
        return "handled";
      }

      await showTrainingPeaksStudentTelegramLinkMenu(parsedMessage, selectedStudent.selectedStudentId);
      return "handled";
    }

    if (action === "student_username") {
      const selectedStudent = getSelectedStudentContext(parsedMessage.chatId);

      if (!selectedStudent) {
        await showTrainingPeaksSelectedStudentFallback(parsedMessage);
        return "handled";
      }

      await promptTrainingPeaksStudentUsernameLookup(parsedMessage, selectedStudent.selectedStudentId);
      return "handled";
    }

    if (action === "student_link_code") {
      const selectedStudent = getSelectedStudentContext(parsedMessage.chatId);

      if (!selectedStudent) {
        await showTrainingPeaksSelectedStudentFallback(parsedMessage);
        return "handled";
      }

      await handleTrainingPeaksStudentLinkCodeRequest(parsedMessage, selectedStudent.selectedStudentId);
      return "handled";
    }

    if (action === "student_test") {
      const selectedStudent = getSelectedStudentContext(parsedMessage.chatId);

      if (!selectedStudent) {
        await showTrainingPeaksSelectedStudentFallback(parsedMessage);
        return "handled";
      }

      const result = await sendTrainingPeaksStudentTestMessage(selectedStudent.selectedStudentId);

      if (result.kind === "not_found") {
        await showTrainingPeaksSelectedStudentFallback(parsedMessage);
        return "handled";
      }

      const student = await getTrainingPeaksStudentCardByInternalId(selectedStudent.selectedStudentId);

      if (!student) {
        await showTrainingPeaksSelectedStudentFallback(parsedMessage);
        return "handled";
      }

      setTrainingPeaksScreenContext(parsedMessage.chatId, "student_actions", {
        selectedStudentId: student.id,
        selectedStudentName: student.studentName,
      });

      if (result.kind === "not_configured") {
        await sendTrainingPeaksReplyScreen(
          parsedMessage.chatId,
          "Не могу отправить тест: у ученика не привязан Telegram или доставка выключена.",
          getTrainingPeaksStudentActionsReplyKeyboardMarkup(student)
        );
        return "handled";
      }

      if (result.kind === "missing_business_connection") {
        await sendTrainingPeaksReplyScreen(
          parsedMessage.chatId,
          "Не могу отправить тест: missing TELEGRAM_BUSINESS_CONNECTION_ID.",
          getTrainingPeaksStudentActionsReplyKeyboardMarkup(student)
        );
        return "handled";
      }

      if (result.kind === "sent") {
        await sendTrainingPeaksReplyScreen(
          parsedMessage.chatId,
          `✅ Тестовое сообщение отправлено: ${result.studentName}.`,
          getTrainingPeaksStudentActionsReplyKeyboardMarkup(student)
        );
        return "handled";
      }

      await sendTrainingPeaksReplyScreen(
        parsedMessage.chatId,
        `Не удалось отправить тестовое сообщение: ${result.errorMessage}.`,
        getTrainingPeaksStudentActionsReplyKeyboardMarkup(student)
      );
      return "handled";
    }

    if (action === "student_disable" || action === "student_enable") {
      const selectedStudent = getSelectedStudentContext(parsedMessage.chatId);

      if (!selectedStudent) {
        await showTrainingPeaksSelectedStudentFallback(parsedMessage);
        return "handled";
      }

      const updatedStudent =
        action === "student_disable"
          ? await disableTrainingPeaksStudentByInternalId(selectedStudent.selectedStudentId)
          : await enableTrainingPeaksStudentByInternalId(selectedStudent.selectedStudentId);

      if (!updatedStudent) {
        await showTrainingPeaksSelectedStudentFallback(parsedMessage);
        return "handled";
      }

      setTrainingPeaksScreenContext(parsedMessage.chatId, "student_actions", {
        selectedStudentId: updatedStudent.id,
        selectedStudentName: updatedStudent.studentName,
      });
      await sendTrainingPeaksReplyScreen(
        parsedMessage.chatId,
        [
          action === "student_disable"
            ? `⛔ Ученик отключён: ${updatedStudent.studentName}`
            : `✅ Ученик включён: ${updatedStudent.studentName}`,
          "",
          getStudentCardMessageLines(updatedStudent).join("\n"),
        ].join("\n"),
        getTrainingPeaksStudentActionsReplyKeyboardMarkup(updatedStudent)
      );
      return "handled";
    }
  } catch (error) {
    console.error("TrainingPeaks Telegram reply keyboard action failed", {
      chatId: parsedMessage.chatId,
      messageId: parsedMessage.messageId,
      text,
      error,
    });

    await sendTrainingPeaksMessage(
      parsedMessage.chatId,
      "Не смог загрузить данные TrainingPeaks. Попробуй позже."
    );
    return "handled";
  }

  return "handled";
}

async function handleTrainingPeaksMain(parsedMessage: ParsedTelegramUpdate): Promise<void> {
  await showTrainingPeaksMainMenu(parsedMessage);
}

async function handleTrainingPeaksStatus(
  parsedMessage: ParsedTelegramUpdate,
  text: string
): Promise<void> {
  const { week, error } = parseStatusCommandWeek(text);

  if (error) {
    await sendTrainingPeaksMessage(parsedMessage.chatId, error);
    return;
  }

  const result = await getTrainingPeaksStatusOverview(week ?? undefined);

  if (!result || result.students.length === 0) {
    await sendTrainingPeaksMessage(
      parsedMessage.chatId,
      week
        ? `За неделю ${formatWeek(week)} данных TrainingPeaks пока нет.`
        : "В Supabase пока нет данных TrainingPeaks."
    );
    return;
  }

  await sendTrainingPeaksMessage(parsedMessage.chatId, formatStatusMessage(result.week, result.students));
}

async function handleTrainingPeaksStudents(parsedMessage: ParsedTelegramUpdate): Promise<void> {
  await showTrainingPeaksStudentsPage(parsedMessage, 0);
}

async function handleTrainingPeaksStudent(
  parsedMessage: ParsedTelegramUpdate,
  text: string
): Promise<void> {
  const studentQuery = parseStudentCommand(text);

  if (!studentQuery) {
    await sendTrainingPeaksMessage(parsedMessage.chatId, "Напиши так: /tp_student Имя Фамилия");
    return;
  }

  const result = await getTrainingPeaksStudentCard(studentQuery);

  if (result.kind === "not_found") {
    await sendTrainingPeaksMessage(
      parsedMessage.chatId,
      `Ученик "${studentQuery}" не найден.\nПосмотри список: /tp_students`
    );
    return;
  }

  if (result.kind === "ambiguous") {
    await sendTrainingPeaksMessage(parsedMessage.chatId, formatStudentAmbiguityMessage(result.matches));
    return;
  }

  setTrainingPeaksScreenContext(parsedMessage.chatId, "student_actions", {
    selectedStudentId: result.student.id,
    selectedStudentName: result.student.studentName,
  });
  await sendTrainingPeaksReplyScreen(
    parsedMessage.chatId,
    getStudentCardMessageLines(result.student).join("\n"),
    getTrainingPeaksStudentActionsReplyKeyboardMarkup(result.student)
  );
}

async function handleTrainingPeaksDisableStudent(
  parsedMessage: ParsedTelegramUpdate,
  text: string
): Promise<void> {
  const studentQuery = parseDisableStudentCommand(text);

  if (!studentQuery) {
    await sendTrainingPeaksMessage(parsedMessage.chatId, "Напиши так: /tp_disable_student Имя Фамилия");
    return;
  }

  const result = await disableTrainingPeaksStudent(studentQuery);

  if (result.kind === "not_found") {
    await sendTrainingPeaksMessage(
      parsedMessage.chatId,
      `Ученик "${studentQuery}" не найден.\nПосмотри список: /tp_students`
    );
    return;
  }

  if (result.kind === "ambiguous") {
    await sendTrainingPeaksMessage(parsedMessage.chatId, formatStudentAmbiguityMessage(result.matches));
    return;
  }

  await sendTrainingPeaksMessage(
    parsedMessage.chatId,
    [
      `✅ Ученик отключён: ${result.student.studentName}`,
      "",
      "Он останется в Supabase и прошлых отчётах, но больше не попадёт в будущие недельные выгрузки TrainingPeaks.",
    ].join("\n")
  );
}

async function handleTrainingPeaksEnableStudent(
  parsedMessage: ParsedTelegramUpdate,
  text: string
): Promise<void> {
  const studentQuery = parseEnableStudentCommand(text);

  if (!studentQuery) {
    await sendTrainingPeaksMessage(parsedMessage.chatId, "Напиши так: /tp_enable_student Имя Фамилия");
    return;
  }

  const result = await enableTrainingPeaksStudent(studentQuery);

  if (result.kind === "not_found") {
    await sendTrainingPeaksMessage(
      parsedMessage.chatId,
      `Ученик "${studentQuery}" не найден.\nПосмотри список: /tp_students`
    );
    return;
  }

  if (result.kind === "ambiguous") {
    await sendTrainingPeaksMessage(parsedMessage.chatId, formatStudentAmbiguityMessage(result.matches));
    return;
  }

  await sendTrainingPeaksMessage(
    parsedMessage.chatId,
    [
      `✅ Ученик включён: ${result.student.studentName}`,
      "",
      "Теперь он будет попадать в будущие недельные выгрузки TrainingPeaks.",
    ].join("\n")
  );
}

async function handleTrainingPeaksAddStudent(
  parsedMessage: ParsedTelegramUpdate,
  text: string
): Promise<void> {
  const rawInput = parseAddStudentCommand(text);

  if (!rawInput) {
    await showTrainingPeaksAddStudentInstructions(parsedMessage);
    return;
  }

  await handleTrainingPeaksAddStudentInput(parsedMessage, rawInput);
}

async function handleTrainingPeaksReport(
  parsedMessage: ParsedTelegramUpdate,
  text: string
): Promise<void> {
  const { studentQuery, week, error } = parseReportCommand(text);

  if (error) {
    await sendTrainingPeaksMessage(parsedMessage.chatId, error);
    return;
  }

  if (!studentQuery) {
    await sendTrainingPeaksMessage(parsedMessage.chatId, "После /tp_report нужно указать ученика.");
    return;
  }

  const report = await getTrainingPeaksReportSnapshot(studentQuery, week ?? undefined);

  if (!report) {
    await sendTrainingPeaksMessage(parsedMessage.chatId, "Отчёт не найден");
    return;
  }

  await sendTrainingPeaksMessage(
    parsedMessage.chatId,
    `📝 ${report.studentName} — отчёт за ${formatWeek(report)}\n\n${report.reportMarkdown}`
  );
}

async function handleTrainingPeaksWeek(parsedMessage: ParsedTelegramUpdate): Promise<void> {
  await showTrainingPeaksWeekMenu(parsedMessage);
}

async function handleTrainingPeaksRunWeek(
  parsedMessage: ParsedTelegramUpdate,
  text: string,
  options?: {
    useRunAliasMessage?: boolean;
  }
): Promise<void> {
  const result = await requestTrainingPeaksWeeklyRun(text, {
    chatId: parsedMessage.chatId,
    userId: parsedMessage.userId,
  });
  setTrainingPeaksScreenContext(parsedMessage.chatId, "week");

  if (result.ok) {
    clearTrainingPeaksCancellableWeeklyJobContext(parsedMessage.chatId);
    await sendTrainingPeaksReplyScreen(
      parsedMessage.chatId,
      getQueuedWeeklyJobSuccessMessage(result.job),
      getTrainingPeaksWeekReplyKeyboardMarkup()
    );
    return;
  }

  if (result.reason === "duplicate" && result.activeJob) {
    if (result.activeJob.status === "queued") {
      setTrainingPeaksCancellableWeeklyJobContext(parsedMessage.chatId, {
        jobId: result.activeJob.id,
        weekFrom: result.activeJob.weekFrom,
        weekTo: result.activeJob.weekTo,
      });
      await sendTrainingPeaksReplyScreen(
        parsedMessage.chatId,
        getDuplicateQueuedWeeklyJobMessage(result.activeJob),
        getTrainingPeaksQueuedDuplicateReplyKeyboardMarkup()
      );
      return;
    }

    clearTrainingPeaksCancellableWeeklyJobContext(parsedMessage.chatId);
    await sendTrainingPeaksReplyScreen(
      parsedMessage.chatId,
      getDuplicateRunningWeeklyJobMessage(result.activeJob),
      getTrainingPeaksRunningDuplicateReplyKeyboardMarkup()
    );
    return;
  }

  clearTrainingPeaksCancellableWeeklyJobContext(parsedMessage.chatId);
  await sendTrainingPeaksReplyScreen(
    parsedMessage.chatId,
    options?.useRunAliasMessage ? formatTpRunAliasMessage(result.message) : result.message,
    getTrainingPeaksWeekReplyKeyboardMarkup()
  );
}

async function handleTrainingPeaksCancelQueuedJob(
  parsedMessage: ParsedTelegramMessageUpdate
): Promise<void> {
  const cancellableJob = getTrainingPeaksCancellableWeeklyJobContext(parsedMessage.chatId);

  if (!cancellableJob) {
    await sendTrainingPeaksReplyScreen(
      parsedMessage.chatId,
      getCancelWeeklyJobMissingContextMessage(),
      getTrainingPeaksMainReplyKeyboardMarkup()
    );
    return;
  }

  const result = await cancelTrainingPeaksWeeklyRun(cancellableJob.jobId);
  clearTrainingPeaksCancellableWeeklyJobContext(parsedMessage.chatId);

  if (result.ok) {
    await sendTrainingPeaksReplyScreen(
      parsedMessage.chatId,
      getCancelledWeeklyJobSuccessMessage(cancellableJob),
      getTrainingPeaksWeekReplyKeyboardMarkup()
    );
    return;
  }

  if (result.reason === "already_started") {
    await sendTrainingPeaksReplyScreen(
      parsedMessage.chatId,
      "Не удалось отменить задачу: она уже запущена на Mac.",
      getTrainingPeaksRunningDuplicateReplyKeyboardMarkup()
    );
    return;
  }

  await sendTrainingPeaksReplyScreen(
    parsedMessage.chatId,
    getCancelWeeklyJobMissingContextMessage(),
    getTrainingPeaksMainReplyKeyboardMarkup()
  );
}

async function handleTrainingPeaksJobs(parsedMessage: ParsedTelegramUpdate): Promise<void> {
  await showTrainingPeaksJobsMenu(parsedMessage);
}

async function handleTrainingPeaksBusinessTest(
  parsedMessage: ParsedTelegramUpdate,
  text: string
): Promise<void> {
  const targetChatId = parseTpBusinessTestChatId(text);
  const businessConnectionId = process.env.TELEGRAM_BUSINESS_CONNECTION_ID?.trim();

  if (!businessConnectionId) {
    await sendTelegramMessage(
      parsedMessage.chatId,
      "Missing TELEGRAM_BUSINESS_CONNECTION_ID. Connect the business account first and copy the id from business_connection webhook logs."
    );
    return;
  }

  if (!targetChatId) {
    await sendTelegramMessage(parsedMessage.chatId, "/tp_business_test <chat_id>");
    return;
  }

  try {
    await sendTelegramMessageStrict(
      targetChatId,
      "Тестовое сообщение от Игоря через TrainingPeaks Reports Bot ✅",
      {
        businessConnectionId,
      }
    );
    await sendTelegramMessage(
      parsedMessage.chatId,
      `✅ Бизнес-сообщение отправлено в чат ${targetChatId}.`
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error while sending Telegram business message";
    await sendTelegramMessage(
      parsedMessage.chatId,
      `Не удалось отправить бизнес-сообщение в чат ${targetChatId}: ${message}`
    );
  }
}

async function handleTrainingPeaksSetTelegram(
  parsedMessage: ParsedTelegramUpdate,
  text: string
): Promise<void> {
  const parsedCommand = parseTpSetTelegramCommand(text);

  if (!parsedCommand.studentId || !parsedCommand.chatId) {
    await sendTelegramMessage(parsedMessage.chatId, "Usage: /tp_set_telegram <student_id> <chat_id>");
    return;
  }

  const students = await getTrainingPeaksStudentsRegistryWithLatestReportStatus();
  const student = students.find((entry) => entry.studentId === parsedCommand.studentId) ?? null;

  if (!student) {
    await sendTelegramMessage(
      parsedMessage.chatId,
      `Student with student_id "${parsedCommand.studentId}" not found.`
    );
    return;
  }

  const updatedStudent = await updateTrainingPeaksStudentTelegramContact(student.id, {
    telegram_chat_id: parsedCommand.chatId,
    telegram_username: parsedCommand.username ?? undefined,
    telegram_delivery_enabled: true,
  });

  if (!updatedStudent) {
    await sendTelegramMessage(
      parsedMessage.chatId,
      `Student with student_id "${parsedCommand.studentId}" not found.`
    );
    return;
  }

  const confirmationLines = [
    `Telegram chat linked for ${updatedStudent.studentName}: ${parsedCommand.chatId}`,
  ];

  if (parsedCommand.username) {
    confirmationLines.push(`Username: @${parsedCommand.username}`);
  }

  await sendTelegramMessage(parsedMessage.chatId, confirmationLines.join("\n"));
}

async function handleTrainingPeaksBind(
  parsedMessage: ParsedTelegramUpdate,
  text: string
): Promise<void> {
  const parsedCommand = parseTpBindCommand(text);

  if (!parsedCommand.studentQuery || !parsedCommand.username) {
    await sendTelegramMessage(
      parsedMessage.chatId,
      "Напиши так: /tp_bind <student_name_or_id> <@username>"
    );
    return;
  }

  const studentMatch = await getTrainingPeaksStudentCard(parsedCommand.studentQuery);

  if (studentMatch.kind === "not_found") {
    await sendTelegramMessage(
      parsedMessage.chatId,
      `Ученик "${parsedCommand.studentQuery}" не найден.\nПосмотри список: /tp_students`
    );
    return;
  }

  if (studentMatch.kind === "ambiguous") {
    await sendTelegramMessage(parsedMessage.chatId, formatStudentAmbiguityMessage(studentMatch.matches));
    return;
  }

  await handleTrainingPeaksStudentUsernameLookup(
    parsedMessage,
    studentMatch.student.id,
    parsedCommand.username
  );
}

function getWeekResultMarkup(options?: {
  includeJobsButton?: boolean;
}): TelegramInlineKeyboardMarkup {
  const rows: TrainingPeaksMenuButton[][] = [];

  if (options?.includeJobsButton) {
    rows.push([createMenuButton("🧾 Задачи", TP_CALLBACK_JOBS)]);
  }

  rows.push([
    createMenuButton("⬅️ Назад", TP_CALLBACK_WEEK_MENU),
    createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU),
  ]);

  return createInlineKeyboardMarkup(rows);
}

function getQueuedWeeklyJobSuccessMessage(week: TrainingPeaksWeek): string {
  return [
    "✅ Задача поставлена в очередь.",
    `Неделя: ${formatWeekIso(week)}`,
    "",
    "Статус: ожидает запуска на Mac.",
    "Чтобы начать обработку, запусти локальный runner:",
    "npm run tp-agent-once",
  ].join("\n");
}

function getDuplicateQueuedWeeklyJobMessage(week: TrainingPeaksWeek): string {
  return [
    "Задача за эту неделю уже ожидает запуска на Mac.",
    `Неделя: ${formatWeekIso(week)}`,
  ].join("\n");
}

function getDuplicateRunningWeeklyJobMessage(week: TrainingPeaksWeek): string {
  return [
    "Задача за эту неделю уже выполняется на Mac.",
    `Неделя: ${formatWeekIso(week)}`,
  ].join("\n");
}

function getCancelledWeeklyJobSuccessMessage(week: TrainingPeaksWeek): string {
  return [
    "✅ Задача отменена.",
    `Неделя: ${formatWeekIso(week)}`,
  ].join("\n");
}

function getCancelWeeklyJobMissingContextMessage(): string {
  return [
    "Не вижу задачу для отмены.",
    "Открой «🧾 Задачи» или попробуй поставить неделю в очередь ещё раз.",
  ].join("\n");
}

async function handleTrainingPeaksSendReportToStudentCallback(
  parsedMessage: ParsedTelegramCallbackUpdate,
  reportId: string
): Promise<void> {
  const report = await getTrainingPeaksWeeklyReportByInternalId(reportId);

  if (!report) {
    await notifyCoachReportAction(parsedMessage.chatId, "Отчёт не найден.");
    return;
  }

  const deliveryResult = await sendTrainingPeaksWeeklyReportToStudent(report.id);

  if (!deliveryResult.ok) {
    await notifyCoachReportAction(parsedMessage.chatId, deliveryResult.message);
    return;
  }

  await notifyCoachReportAction(
    parsedMessage.chatId,
    deliveryResult.deliveredChunks > 1
      ? `Отчёт отправлен ученику: ${deliveryResult.studentName} (${deliveryResult.deliveredChunks} сообщения).`
      : `Отчёт отправлен ученику: ${deliveryResult.studentName}.`
  );
}

async function handleTrainingPeaksSkipReportCallback(
  parsedMessage: ParsedTelegramCallbackUpdate,
  reportId: string
): Promise<void> {
  const report = await getTrainingPeaksWeeklyReportByInternalId(reportId);

  if (!report) {
    await notifyCoachReportAction(parsedMessage.chatId, "Отчёт не найден.");
    return;
  }

  if (report.reviewStatus === "sent") {
    await notifyCoachReportAction(
      parsedMessage.chatId,
      `Отчёт уже отправлен ученику: ${report.studentName}.`
    );
    return;
  }

  await updateTrainingPeaksWeeklyReportStateByInternalId(report.id, {
    reviewStatus: "skipped",
  });
  await notifyCoachReportAction(parsedMessage.chatId, `Отчёт пропущен: ${report.studentName}.`);
}

function presentTrainingPeaksWeekRunResult(
  result: RequestTrainingPeaksWeeklyRunResult,
  options?: {
    requestedWeek?: TrainingPeaksWeek | null;
    useRunAliasMessage?: boolean;
  }
): {
  text: string;
  replyMarkup: TelegramInlineKeyboardMarkup;
} {
  if (result.ok) {
    return {
      text: getQueuedWeeklyJobSuccessMessage(result.job),
      replyMarkup: getWeekResultMarkup({
        includeJobsButton: true,
      }),
    };
  }

  if (result.reason === "duplicate" && result.activeJob) {
    return {
      text:
        result.activeJob.status === "queued"
          ? getDuplicateQueuedWeeklyJobMessage(result.activeJob)
          : getDuplicateRunningWeeklyJobMessage(result.activeJob),
      replyMarkup: getWeekResultMarkup({
        includeJobsButton: true,
      }),
    };
  }

  if (result.reason === "duplicate" && options?.requestedWeek) {
    return {
      text: [
        "Задача за эту неделю уже ожидает запуска или выполняется на Mac.",
        `Неделя: ${formatWeekIso(options.requestedWeek)}`,
      ].join("\n"),
      replyMarkup: getWeekResultMarkup({
        includeJobsButton: true,
      }),
    };
  }

  return {
    text: options?.useRunAliasMessage ? formatTpRunAliasMessage(result.message) : result.message,
    replyMarkup: getWeekResultMarkup(),
  };
}

export async function handleTrainingPeaksTelegramCallback(
  parsedMessage: ParsedTelegramCallbackUpdate
): Promise<"handled" | "ignored"> {
  const callback = parseTrainingPeaksCallback(parsedMessage.data);

  if (!callback) {
    return "ignored";
  }

  if (!isCoachChat(parsedMessage.chatId)) {
    await sendTrainingPeaksMessage(parsedMessage.chatId, COACH_ONLY_MESSAGE);
    return "handled";
  }

  try {
    if (callback.kind === "main_menu") {
      await showTrainingPeaksMainMenu(parsedMessage);
      return "handled";
    }

    if (callback.kind === "students_page") {
      await showTrainingPeaksStudentsPage(parsedMessage, callback.page);
      return "handled";
    }

    if (callback.kind === "student_card") {
      await showTrainingPeaksStudentCardMenu(parsedMessage, callback.studentId);
      return "handled";
    }

    if (callback.kind === "student_link") {
      await showTrainingPeaksStudentTelegramLinkMenu(parsedMessage, callback.studentId);
      return "handled";
    }

    if (callback.kind === "student_username_prompt") {
      await promptTrainingPeaksStudentUsernameLookup(parsedMessage, callback.studentId);
      return "handled";
    }

    if (callback.kind === "student_link_code") {
      await handleTrainingPeaksStudentLinkCodeRequest(parsedMessage, callback.studentId);
      return "handled";
    }

    if (callback.kind === "student_choose_chat") {
      await handleTrainingPeaksStudentChooseBusinessChatCallback(
        parsedMessage,
        callback.studentId,
        callback.chatKey
      );
      return "handled";
    }

    if (callback.kind === "student_test") {
      await handleTrainingPeaksStudentTestMessageCallback(parsedMessage, callback.studentId);
      return "handled";
    }

    if (callback.kind === "student_report") {
      const student = await getTrainingPeaksStudentCardByInternalId(callback.studentId);

      if (!student) {
        await editTrainingPeaksMenuMessage(
          parsedMessage.chatId,
          parsedMessage.messageId,
          "Ученик больше не найден.",
          getStudentNotFoundMarkup()
        );
        return "handled";
      }

      const report = await getTrainingPeaksLatestReportSnapshotByInternalId(callback.studentId);

      if (!report) {
        await editTrainingPeaksMenuMessage(
          parsedMessage.chatId,
          parsedMessage.messageId,
          "Последний отчёт для этого ученика пока не найден.",
          getStudentReportMissingMarkup(callback.studentId)
        );
        return "handled";
      }

      await sendTrainingPeaksMessage(
        parsedMessage.chatId,
        `📝 ${report.studentName} — отчёт за ${formatWeek(report)}\n\n${report.reportMarkdown}`
      );
      return "handled";
    }

    if (callback.kind === "student_disable") {
      const student = await disableTrainingPeaksStudentByInternalId(callback.studentId);

      if (!student) {
        await editTrainingPeaksMenuMessage(
          parsedMessage.chatId,
          parsedMessage.messageId,
          "Ученик больше не найден.",
          getStudentNotFoundMarkup()
        );
        return "handled";
      }

      await editTrainingPeaksMenuMessage(
        parsedMessage.chatId,
        parsedMessage.messageId,
        getStudentCardMessageLines(student).join("\n"),
        getStudentCardMenuMarkup(student)
      );
      return "handled";
    }

    if (callback.kind === "student_enable") {
      const student = await enableTrainingPeaksStudentByInternalId(callback.studentId);

      if (!student) {
        await editTrainingPeaksMenuMessage(
          parsedMessage.chatId,
          parsedMessage.messageId,
          "Ученик больше не найден.",
          getStudentNotFoundMarkup()
        );
        return "handled";
      }

      await editTrainingPeaksMenuMessage(
        parsedMessage.chatId,
        parsedMessage.messageId,
        getStudentCardMessageLines(student).join("\n"),
        getStudentCardMenuMarkup(student)
      );
      return "handled";
    }

    if (callback.kind === "report_send") {
      await handleTrainingPeaksSendReportToStudentCallback(parsedMessage, callback.reportId);
      return "handled";
    }

    if (callback.kind === "report_skip") {
      await handleTrainingPeaksSkipReportCallback(parsedMessage, callback.reportId);
      return "handled";
    }

    if (callback.kind === "week_menu") {
      await showTrainingPeaksWeekMenu(parsedMessage);
      return "handled";
    }

    if (callback.kind === "week_last" || callback.kind === "week_current") {
      const requestedWeek = resolveTrainingPeaksWeekKeyword(
        callback.kind === "week_last" ? "last" : "current"
      );
      const result = await requestTrainingPeaksWeeklyRun(
        callback.kind === "week_last" ? "/tp_run_week last" : "/tp_run_week current",
        {
          chatId: parsedMessage.chatId,
          userId: parsedMessage.userId,
        }
      );
      const presentation = presentTrainingPeaksWeekRunResult(result, {
        requestedWeek,
      });

      await editTrainingPeaksMenuMessage(
        parsedMessage.chatId,
        parsedMessage.messageId,
        presentation.text,
        presentation.replyMarkup
      );
      return "handled";
    }

    if (callback.kind === "jobs") {
      await showTrainingPeaksJobsMenu(parsedMessage);
      return "handled";
    }

    if (callback.kind === "help") {
      await showTrainingPeaksHelpMenu(parsedMessage);
      return "handled";
    }

    if (callback.kind === "reports_hint") {
      await showTrainingPeaksReportsHint(parsedMessage);
      return "handled";
    }
  } catch (error) {
    console.error("TrainingPeaks Telegram callback failed", {
      chatId: parsedMessage.chatId,
      messageId: parsedMessage.messageId,
      callbackData: parsedMessage.data,
      error,
    });

    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      "Не смог загрузить данные TrainingPeaks. Попробуй позже.",
      getCallbackErrorMarkup()
    );
    return "handled";
  }

  return "handled";
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
    await sendTrainingPeaksMessage(parsedMessage.chatId, COACH_ONLY_MESSAGE);
    return "handled";
  }

  try {
    if (command === "tp") {
      await handleTrainingPeaksMain(parsedMessage);
      return "handled";
    }

    if (command === "tp_status") {
      await handleTrainingPeaksStatus(parsedMessage, text);
      return "handled";
    }

    if (command === "tp_students") {
      await handleTrainingPeaksStudents(parsedMessage);
      return "handled";
    }

    if (command === "tp_student") {
      await handleTrainingPeaksStudent(parsedMessage, text);
      return "handled";
    }

    if (command === "tp_disable_student") {
      await handleTrainingPeaksDisableStudent(parsedMessage, text);
      return "handled";
    }

    if (command === "tp_enable_student") {
      await handleTrainingPeaksEnableStudent(parsedMessage, text);
      return "handled";
    }

    if (command === "tp_add") {
      await handleTrainingPeaksAddStudent(parsedMessage, text);
      return "handled";
    }

    if (command === "tp_add_student") {
      await handleTrainingPeaksAddStudent(parsedMessage, text);
      return "handled";
    }

    if (command === "tp_report") {
      await handleTrainingPeaksReport(parsedMessage, text);
      return "handled";
    }

    if (command === "tp_week") {
      await handleTrainingPeaksWeek(parsedMessage);
      return "handled";
    }

    if (command === "tp_run") {
      await handleTrainingPeaksRunWeek(parsedMessage, normalizeTpRunCommand(text), {
        useRunAliasMessage: true,
      });
      return "handled";
    }

    if (command === "tp_run_week") {
      await handleTrainingPeaksRunWeek(parsedMessage, text);
      return "handled";
    }

    if (command === "tp_jobs") {
      await handleTrainingPeaksJobs(parsedMessage);
      return "handled";
    }

    if (command === "tp_weekly") {
      await sendTrainingPeaksMessage(parsedMessage.chatId, TP_WEEKLY_DISABLED_MESSAGE);
      return "handled";
    }

    if (command === "tp_business_test") {
      await handleTrainingPeaksBusinessTest(parsedMessage, text);
      return "handled";
    }

    if (command === "tp_set_telegram") {
      await handleTrainingPeaksSetTelegram(parsedMessage, text);
      return "handled";
    }

    if (command === "tp_bind") {
      await handleTrainingPeaksBind(parsedMessage, text);
      return "handled";
    }

    await sendTrainingPeaksMessage(parsedMessage.chatId, TP_UNKNOWN_COMMAND_MESSAGE);
  } catch (error) {
    console.error("TrainingPeaks Telegram command failed", {
      chatId: parsedMessage.chatId,
      messageId: parsedMessage.messageId,
      command,
      error,
    });

    await sendTrainingPeaksMessage(
      parsedMessage.chatId,
      "Не смог загрузить данные TrainingPeaks. Попробуй позже."
    );
  }

  return "handled";
}
