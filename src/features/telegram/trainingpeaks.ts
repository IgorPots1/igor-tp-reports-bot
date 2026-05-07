import type {
  ParsedTelegramCallbackUpdate,
  ParsedTelegramMessageUpdate,
  ParsedTelegramUpdate,
} from "@/features/telegram/parser";
import {
  addTrainingPeaksStudentFromCommand,
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
  requestTrainingPeaksWeeklyRun,
} from "@/features/trainingpeaks/service";
import {
  resolveTrainingPeaksWeekKeyword,
} from "@/features/trainingpeaks/week";
import {
  editTelegramMessageText,
  sendTelegramMessage,
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
// Telegram requires non-empty text when attaching a reply keyboard.
const TP_REPLY_KEYBOARD_ATTACH_MESSAGE = "\u200B";

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

type TrainingPeaksReplyKeyboardAction =
  | "main_menu"
  | "students"
  | "add_student_help"
  | "week_menu"
  | "jobs";

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

async function sendTrainingPeaksMessage(chatId: number | string, text: string): Promise<void> {
  for (const chunk of splitTelegramMessage(text)) {
    await sendTelegramMessage(chatId, chunk);
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

function getTrainingPeaksReplyKeyboardMarkup(): TelegramReplyKeyboardMarkup {
  return {
    keyboard: [
      [{ text: TP_REPLY_BUTTON_MENU }, { text: TP_REPLY_BUTTON_STUDENTS }],
      [{ text: TP_REPLY_BUTTON_ADD }, { text: TP_REPLY_BUTTON_WEEK }],
      [{ text: TP_REPLY_BUTTON_JOBS }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

async function sendTrainingPeaksReplyKeyboard(chatId: number | string): Promise<void> {
  await sendTelegramMessage(chatId, TP_REPLY_KEYBOARD_ATTACH_MESSAGE, {
    replyMarkup: getTrainingPeaksReplyKeyboardMarkup(),
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

function getTpAddStudentNamePreview(rawInput: string): string {
  const separatorIndex = rawInput.indexOf("|");
  return (separatorIndex >= 0 ? rawInput.slice(0, separatorIndex) : rawInput).trim();
}

function normalizeTpRunCommand(text: string): string {
  const args = text.replace(TP_RUN_COMMAND_PATTERN, "").trim();
  return args ? `/tp_run_week ${args}` : "/tp_run_week";
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
    return "в очереди";
  }

  if (status === "running") {
    return "выполняется";
  }

  if (status === "completed") {
    return "завершена";
  }

  if (status === "failed") {
    return "ошибка";
  }

  return status;
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
    "🧾 Задачи TrainingPeaks:",
    "",
    ...jobs.flatMap((job) => {
      const shortError = shortenJobError(job.errorMessage);
      const countsSummary = getJobCountsSummary(job.resultJson);
      const hasWarnings = jobHasWarnings(job.resultJson);
      const missingStudentsSummary = formatMissingStudentsSummary(job.resultJson);
      const statusLabel = getJobStatusLabel(job.status);

      if (job.status === "failed" && shortError) {
        return [`• ${statusLabel} — ${job.weekFrom} — ${job.weekTo}: ${shortError}`];
      }

      if (job.status === "completed" && countsSummary) {
        return [
          `• ${statusLabel} — ${job.weekFrom} — ${job.weekTo} — ${countsSummary}${hasWarnings ? " ⚠️" : ""}`,
          ...(missingStudentsSummary ? [`  Не готово: ${missingStudentsSummary}`] : []),
        ];
      }

      return [`• ${statusLabel} — ${job.weekFrom} — ${job.weekTo}`];
    }),
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
    "➕ Добавить — показать формат команды для добавления ученика",
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
  return ["Главное меню", "Выберите действие:"].join("\n");
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
    "Ученики TrainingPeaks пока не найдены.",
    "",
    "Нажми «➕ Добавить» или отправь `/tp_add Имя | ссылка TrainingPeaks`.",
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
    `Страница ${page + 1} из ${Math.max(totalPages, 1)}`,
    "",
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
  return "Какую неделю поставить в очередь?";
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
    [createMenuButton("🔄 Обновить", TP_CALLBACK_JOBS)],
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
    "Отправь команду в формате:",
    "",
    "/tp_add Имя | ссылка TrainingPeaks",
    "",
    "Пример:",
    "/tp_add Nastya | https://app.trainingpeaks.com/...",
  ].join("\n");
}

function getAddStudentInstructionsMarkup(): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([[createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)]]);
}

function getCallbackErrorMarkup(): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([[createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)]]);
}

async function showTrainingPeaksMainMenu(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate
): Promise<void> {
  if (parsedMessage.kind === "callback_query") {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      getTrainingPeaksMainMenuText(),
      getTrainingPeaksMainMenuMarkup()
    );
    return;
  }

  await sendTrainingPeaksMenuMessage(
    parsedMessage.chatId,
    getTrainingPeaksMainMenuText(),
    getTrainingPeaksMainMenuMarkup()
  );
  await sendTrainingPeaksReplyKeyboard(parsedMessage.chatId);
}

async function showTrainingPeaksStudentsPage(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate,
  requestedPage: number
): Promise<void> {
  const students = await getTrainingPeaksStudentsRegistryWithLatestReportStatus();

  if (students.length === 0) {
    if (parsedMessage.kind === "callback_query") {
      await editTrainingPeaksMenuMessage(
        parsedMessage.chatId,
        parsedMessage.messageId,
        getStudentsEmptyMenuText(),
        getStudentsEmptyMenuMarkup()
      );
      return;
    }

    await sendTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      getStudentsEmptyMenuText(),
      getStudentsEmptyMenuMarkup()
    );
    await sendTrainingPeaksReplyKeyboard(parsedMessage.chatId);
    return;
  }

  const totalPages = Math.max(1, Math.ceil(students.length / STUDENTS_PAGE_SIZE));
  const safePage = Math.min(Math.max(requestedPage, 0), totalPages - 1);
  const startIndex = safePage * STUDENTS_PAGE_SIZE;
  const pageStudents = students.slice(startIndex, startIndex + STUDENTS_PAGE_SIZE);
  const text = getStudentsPageText(pageStudents, safePage, totalPages);
  const markup = getStudentsPageMarkup(pageStudents, safePage, totalPages);

  if (parsedMessage.kind === "callback_query") {
    await editTrainingPeaksMenuMessage(parsedMessage.chatId, parsedMessage.messageId, text, markup);
    return;
  }

  await sendTrainingPeaksMenuMessage(parsedMessage.chatId, text, markup);
  await sendTrainingPeaksReplyKeyboard(parsedMessage.chatId);
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

    await sendTrainingPeaksMenuMessage(parsedMessage.chatId, text, markup);
    return;
  }

  const text = getStudentCardMessageLines(student).join("\n");
  const markup = getStudentCardMenuMarkup(student.id, student.isActive);

  if (parsedMessage.kind === "callback_query") {
    await editTrainingPeaksMenuMessage(parsedMessage.chatId, parsedMessage.messageId, text, markup);
    return;
  }

  await sendTrainingPeaksMenuMessage(parsedMessage.chatId, text, markup);
}

async function showTrainingPeaksWeekMenu(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate
): Promise<void> {
  if (parsedMessage.kind === "callback_query") {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      getWeekMenuText(),
      getWeekMenuMarkup()
    );
    return;
  }

  await sendTrainingPeaksMenuMessage(parsedMessage.chatId, getWeekMenuText(), getWeekMenuMarkup());
  await sendTrainingPeaksReplyKeyboard(parsedMessage.chatId);
}

async function showTrainingPeaksJobsMenu(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate
): Promise<void> {
  const jobs = await getTrainingPeaksJobsStatus();
  const text = jobs.length === 0 ? "Задач TrainingPeaks пока нет." : formatJobsMessage(jobs);
  const markup = getJobsMenuMarkup();

  if (parsedMessage.kind === "callback_query") {
    await editTrainingPeaksMenuMessage(parsedMessage.chatId, parsedMessage.messageId, text, markup);
    return;
  }

  await sendTrainingPeaksMenuMessage(parsedMessage.chatId, text, markup);
  await sendTrainingPeaksReplyKeyboard(parsedMessage.chatId);
}

async function showTrainingPeaksReportsHint(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate
): Promise<void> {
  if (parsedMessage.kind === "callback_query") {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      getReportsHintText(),
      getReportsHintMarkup()
    );
    return;
  }

  await sendTrainingPeaksMenuMessage(
    parsedMessage.chatId,
    getReportsHintText(),
    getReportsHintMarkup()
  );
  await sendTrainingPeaksReplyKeyboard(parsedMessage.chatId);
}

async function showTrainingPeaksHelpMenu(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate
): Promise<void> {
  if (parsedMessage.kind === "callback_query") {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      getHelpMenuText(),
      getHelpMenuMarkup()
    );
    return;
  }

  await sendTrainingPeaksMenuMessage(parsedMessage.chatId, getHelpMenuText(), getHelpMenuMarkup());
  await sendTrainingPeaksReplyKeyboard(parsedMessage.chatId);
}

async function showTrainingPeaksAddStudentInstructions(
  parsedMessage: ParsedTelegramUpdate | ParsedTelegramCallbackUpdate
): Promise<void> {
  if (parsedMessage.kind === "callback_query") {
    await editTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      parsedMessage.messageId,
      getAddStudentInstructionsText(),
      getAddStudentInstructionsMarkup()
    );
    return;
  }

  await sendTrainingPeaksMenuMessage(
    parsedMessage.chatId,
    getAddStudentInstructionsText(),
    getAddStudentInstructionsMarkup()
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

  if (!action) {
    return "ignored";
  }

  if (!isCoachChat(parsedMessage.chatId)) {
    await sendTrainingPeaksMessage(parsedMessage.chatId, COACH_ONLY_MESSAGE);
    return "handled";
  }

  try {
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

  await sendTrainingPeaksMenuMessage(
    parsedMessage.chatId,
    getStudentCardMessageLines(result.student).join("\n"),
    getStudentCardMenuMarkup(result.student.id, result.student.isActive)
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
    await sendTrainingPeaksMenuMessage(
      parsedMessage.chatId,
      getAddStudentInstructionsText(),
      getAddStudentInstructionsMarkup()
    );
    return;
  }

  const result = await addTrainingPeaksStudentFromCommand(rawInput);
  const studentName = getTpAddStudentNamePreview(rawInput);

  if (!result.ok) {
    if (result.reason === "empty_name") {
      await sendTrainingPeaksMessage(parsedMessage.chatId, "Имя ученика не должно быть пустым.");
      return;
    }

    if (result.reason === "invalid_url") {
      await sendTrainingPeaksMessage(
        parsedMessage.chatId,
        "Ссылка на TrainingPeaks должна начинаться с https://"
      );
      return;
    }

    if (result.reason === "duplicate_student") {
      await sendTrainingPeaksMessage(
        parsedMessage.chatId,
        `Ученик "${studentName}" уже существует.`
      );
      return;
    }

    if (result.reason === "duplicate_url") {
      await sendTrainingPeaksMessage(
        parsedMessage.chatId,
        "Этот URL TrainingPeaks уже привязан к другому ученику."
      );
      return;
    }

    await sendTrainingPeaksMessage(
      parsedMessage.chatId,
      "Не смог добавить ученика в Supabase. Попробуй позже."
    );
    return;
  }

  await sendTrainingPeaksMessage(
    parsedMessage.chatId,
    [
      `✅ Ученик добавлен: ${result.student.studentName}`,
      "",
      "Локальный Mac runner подтянет этого ученика из Supabase при следующем запуске tp-agent-once.",
    ].join("\n")
  );
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

  if (!result.ok) {
    await sendTrainingPeaksMessage(
      parsedMessage.chatId,
      options?.useRunAliasMessage ? formatTpRunAliasMessage(result.message) : result.message
    );
    return;
  }

  await sendTrainingPeaksMessage(
    parsedMessage.chatId,
    [
      `✅ Задача создана: недельные отчёты ${formatWeekIso(result.job)}.`,
      "",
      "Теперь на Mac запусти:",
      "cd ~/igor-tp-reports-bot/tools/trainingpeaks-export && npm run tp-agent-once",
    ].join("\n")
  );
}

async function handleTrainingPeaksJobs(parsedMessage: ParsedTelegramUpdate): Promise<void> {
  await showTrainingPeaksJobsMenu(parsedMessage);
}

function getWeekResultMarkup(): TelegramInlineKeyboardMarkup {
  return createInlineKeyboardMarkup([
    [createMenuButton("⬅️ Назад", TP_CALLBACK_WEEK_MENU)],
    [createMenuButton("🏠 Меню", TP_CALLBACK_MAIN_MENU)],
  ]);
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
      const result = await requestTrainingPeaksWeeklyRun(
        callback.kind === "week_last" ? "/tp_run_week last" : "/tp_run_week current",
        {
          chatId: parsedMessage.chatId,
          userId: parsedMessage.userId,
        }
      );

      if (!result.ok) {
        await editTrainingPeaksMenuMessage(
          parsedMessage.chatId,
          parsedMessage.messageId,
          result.message,
          getWeekResultMarkup()
        );
        return "handled";
      }

      await editTrainingPeaksMenuMessage(
        parsedMessage.chatId,
        parsedMessage.messageId,
        [
          `✅ Задача создана: недельные отчёты ${formatWeekIso(result.job)}.`,
          "",
          "Теперь на Mac запусти:",
          "cd ~/igor-tp-reports-bot/tools/trainingpeaks-export && npm run tp-agent-once",
        ].join("\n"),
        getWeekResultMarkup()
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
