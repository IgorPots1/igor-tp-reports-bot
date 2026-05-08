import type {
  ParsedTelegramCallbackUpdate,
  ParsedTelegramMessageUpdate,
  ParsedTelegramUpdate,
} from "@/features/telegram/parser";
import {
  addTrainingPeaksStudentFromCommand,
  cancelTrainingPeaksWeeklyRun,
  disableTrainingPeaksStudent,
  disableTrainingPeaksStudentByInternalId,
  enableTrainingPeaksStudent,
  enableTrainingPeaksStudentByInternalId,
  getTrainingPeaksJobsStatus,
  getTrainingPeaksLatestReportSnapshotByInternalId,
  getTrainingPeaksReportSnapshot,
  getTrainingPeaksStatusOverview,
  getTrainingPeaksStudentCard,
  getTrainingPeaksStudentCardByInternalId,
  getTrainingPeaksStudentsRegistryWithLatestReportStatus,
  TRAININGPEAKS_JOB_CANCELLED_ERROR_MESSAGE,
  type RequestTrainingPeaksWeeklyRunResult,
  requestTrainingPeaksWeeklyRun,
} from "@/features/trainingpeaks/service";
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
const TP_REPLY_BUTTON_DISABLE = "⛔ Отключить";
const TP_REPLY_BUTTON_ENABLE = "✅ Включить";
const TP_CHAT_CONTEXT_TTL_MS = 30 * 60 * 1000;
const TP_ADD_STUDENT_WAITING_TTL_MS = 10 * 60 * 1000;
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
  | "student_disable"
  | "student_enable";

const trainingPeaksChatContextByChatId = new Map<string, TrainingPeaksChatContext>();

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
    [TP_REPLY_BUTTON_ADD, TP_REPLY_BUTTON_WEEK],
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
  }
): TelegramReplyKeyboardMarkup {
  return createReplyKeyboardMarkup([
    [TP_REPLY_BUTTON_REPORT],
    [student.isActive ? TP_REPLY_BUTTON_DISABLE : TP_REPLY_BUTTON_ENABLE],
    [TP_REPLY_BUTTON_STUDENTS_BACK, TP_REPLY_BUTTON_MENU],
  ]);
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
  return ["Не вижу ссылку TrainingPeaks.", "", "Отправь так:", TP_ADD_STUDENT_EXAMPLE].join("\n");
}

function getAddStudentMissingNameMessage(): string {
  return ["Не вижу имя ученика.", "", "Отправь так:", TP_ADD_STUDENT_EXAMPLE].join("\n");
}

function getAddStudentExpiredMessage(): string {
  return "Режим добавления истёк. Нажми «➕ Добавить» ещё раз.";
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
    "➕ Добавить — открыть режим добавления ученика",
    "▶️ Неделя — открыть меню запуска недели",
    "🧾 Задачи — посмотреть последние запуски",
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
  ] as const) {
    if (data.startsWith(prefix)) {
      const studentId = data.slice(prefix.length).trim();
      return studentId ? { kind, studentId } : null;
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
    "Нажми «➕ Добавить» и отправь имя со ссылкой одним сообщением.",
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

function getStudentCardMenuMarkup(studentId: string, isActive: boolean): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    [createMenuButton("📄 Отчёт", `tp:r:${studentId}`)],
    [createMenuButton(isActive ? "⛔ Отключить" : "✅ Включить", `${isActive ? "tp:d" : "tp:e"}:${studentId}`)],
    [createMenuButton("⬅️ К ученикам", "tp:s:0"), createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)],
  ]);
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
    "➕ Добавить ученика",
    "",
    "Отправь имя и ссылку одним сообщением:",
    "",
    TP_ADD_STUDENT_EXAMPLE,
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
  parsedMessage: ParsedTelegramMessageUpdate
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
  const markup = getStudentCardMenuMarkup(student.id, student.isActive);
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
        "Ссылка на TrainingPeaks должна начинаться с https://",
        getTrainingPeaksMainReplyKeyboardMarkup()
      );
      return;
    }

    if (result.reason === "duplicate_student") {
      await sendTrainingPeaksReplyScreen(
        parsedMessage.chatId,
        `Ученик "${studentName}" уже существует.`,
        getTrainingPeaksMainReplyKeyboardMarkup()
      );
      return;
    }

    if (result.reason === "duplicate_url") {
      await sendTrainingPeaksReplyScreen(
        parsedMessage.chatId,
        "Этот URL TrainingPeaks уже привязан к другому ученику.",
        getTrainingPeaksMainReplyKeyboardMarkup()
      );
      return;
    }

    await sendTrainingPeaksReplyScreen(
      parsedMessage.chatId,
      "Не смог добавить ученика в Supabase. Попробуй позже.",
      getTrainingPeaksMainReplyKeyboardMarkup()
    );
    return;
  }

  clearTrainingPeaksChatContext(parsedMessage.chatId);

  if (options?.showStudentsListOnSuccess) {
    await sendTrainingPeaksMessage(
      parsedMessage.chatId,
      `✅ Ученик добавлен: ${result.student.studentName}`
    );
    await showTrainingPeaksStudentsPage(parsedMessage, 0);
    return;
  }

  await sendTrainingPeaksReplyScreen(
    parsedMessage.chatId,
    [
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
          chatContextState.kind === "active" &&
          chatContextState.context.screen === "add_student_waiting"
        ) {
          await handleTrainingPeaksAddStudentInput(parsedMessage, text, {
            showStudentsListOnSuccess: true,
          });
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
        getStudentCardMenuMarkup(student.id, student.isActive)
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
        getStudentCardMenuMarkup(student.id, student.isActive)
      );
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
