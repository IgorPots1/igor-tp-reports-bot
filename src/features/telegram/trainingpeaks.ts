import type { ParsedTelegramUpdate } from "@/features/telegram/parser";
import {
  addTrainingPeaksStudentFromCommand,
  getTrainingPeaksJobsStatus,
  getTrainingPeaksReportSnapshot,
  getTrainingPeaksStatusOverview,
  getTrainingPeaksStudentsRegistryWithLatestReportStatus,
  requestTrainingPeaksWeeklyRun,
} from "@/features/trainingpeaks/service";
import {
  getCurrentTrainingPeaksWeek,
  getPreviousTrainingPeaksWeek,
  getWeekBeforePreviousTrainingPeaksWeek,
} from "@/features/trainingpeaks/week";
import { sendTelegramMessage } from "@/features/telegram/telegram-client";

const COACH_ONLY_MESSAGE = "⛔ Эта команда доступна только тренеру.";
const TP_WEEKLY_DISABLED_MESSAGE =
  "⚙️ Запуск TrainingPeaks workflow из Telegram отключён. TrainingPeaks остаётся только в read-only режиме.";
const TP_UNKNOWN_COMMAND_MESSAGE = "ℹ️ Команда TrainingPeaks не распознана. Используй /help.";
const TELEGRAM_MESSAGE_LIMIT = 4000;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const TP_STATUS_COMMAND_PATTERN = /^\/tp_status(?:@\w+)?(?:\s+|$)/;
const TP_STUDENTS_COMMAND_PATTERN = /^\/tp_students(?:@\w+)?(?:\s+|$)/;
const TP_ADD_STUDENT_COMMAND_PATTERN = /^\/tp_add_student(?:@\w+)?(?:\s+|$)/;
const TP_REPORT_COMMAND_PATTERN = /^\/tp_report(?:@\w+)?(?:\s+|$)/;
const TP_WEEK_COMMAND_PATTERN = /^\/tp_week(?:@\w+)?(?:\s+|$)/;
const TP_RUN_WEEK_COMMAND_PATTERN = /^\/tp_run_week(?:@\w+)?(?:\s+|$)/;
const TP_JOBS_COMMAND_PATTERN = /^\/tp_jobs(?:@\w+)?(?:\s+|$)/;
const TP_WEEKLY_COMMAND_PATTERN = /^\/tp_weekly(?:@\w+)?(?:\s+|$)/;
const TP_COMMAND_PATTERN = /^\/tp_[a-z0-9_]+(?:@\w+)?(?:\s+|$)/;
const TP_ADD_STUDENT_USAGE =
  "Напиши так: /tp_add_student Olga | https://app.trainingpeaks.com/athlete/...";
const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

type TrainingPeaksCommand =
  | "tp_status"
  | "tp_students"
  | "tp_add_student"
  | "tp_report"
  | "tp_week"
  | "tp_run_week"
  | "tp_jobs"
  | "tp_weekly"
  | "unknown";

type TrainingPeaksWeek = {
  weekFrom: string;
  weekTo: string;
};

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

  if (TP_ADD_STUDENT_COMMAND_PATTERN.test(text)) {
    return "tp_add_student";
  }

  if (TP_REPORT_COMMAND_PATTERN.test(text)) {
    return "tp_report";
  }

  if (TP_WEEK_COMMAND_PATTERN.test(text)) {
    return "tp_week";
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

function getRegistryStatusLabel(status: string): string {
  if (status === "ready") {
    return "готов";
  }

  if (status === "data_loaded") {
    return "данные загружены";
  }

  if (status === "no_report") {
    return "нет отчета";
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
      error: "Напиши так: /tp_report Olga или /tp_report Olga 2026-04-27 2026-05-03",
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

  return {
    studentQuery: args,
    week: null,
    error: null,
  };
}

function parseAddStudentCommand(text: string): string {
  return text.replace(TP_ADD_STUDENT_COMMAND_PATTERN, "").trim();
}

function getTpAddStudentNamePreview(rawInput: string): string {
  const separatorIndex = rawInput.indexOf("|");
  return (separatorIndex >= 0 ? rawInput.slice(0, separatorIndex) : rawInput).trim();
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

function formatStudentsMessage(
  students: {
    studentName: string;
    latestWeekFrom: string | null;
    latestWeekTo: string | null;
    latestReportStatus: string;
  }[]
): string {
  return [
    "Ученики TrainingPeaks:",
    "",
    ...students.map((student) => {
      if (student.latestWeekFrom && student.latestWeekTo) {
        return `• ${student.studentName} — ${getRegistryStatusLabel(student.latestReportStatus)}, последняя неделя: ${student.latestWeekFrom} — ${student.latestWeekTo}`;
      }

      return `• ${student.studentName} — ${getRegistryStatusLabel(student.latestReportStatus)}`;
    }),
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

function getJobCountsSummary(resultJson: unknown): string | null {
  if (!resultJson || typeof resultJson !== "object") {
    return null;
  }

  const reportsFound = getFiniteNumber((resultJson as { reports_found?: unknown }).reports_found);
  const reportsSent = getFiniteNumber(
    (resultJson as { reports_sent_to_telegram?: unknown }).reports_sent_to_telegram
  );

  if (reportsFound === null && reportsSent === null) {
    return null;
  }

  const parts: string[] = [];

  if (reportsFound !== null) {
    parts.push(`отчетов: ${reportsFound}`);
  }

  if (reportsSent !== null) {
    parts.push(`отправлено: ${reportsSent}`);
  }

  return parts.length > 0 ? parts.join(", ") : null;
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
    "Задачи TrainingPeaks:",
    "",
    ...jobs.map((job) => {
      const shortError = shortenJobError(job.errorMessage);
      const countsSummary = getJobCountsSummary(job.resultJson);

      if (job.status === "failed" && shortError) {
        return `• ${job.status} — ${job.weekFrom} — ${job.weekTo}: ${shortError}`;
      }

      if (job.status === "completed" && countsSummary) {
        return `• ${job.status} — ${job.weekFrom} — ${job.weekTo} — ${countsSummary}`;
      }

      return `• ${job.status} — ${job.weekFrom} — ${job.weekTo}`;
    }),
  ].join("\n");
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
    "/tp_status — статусы за последнюю синхронизированную неделю",
    "/tp_status <from> <to> — статусы за выбранную неделю",
    "/tp_students — ученики и их последний статус",
    "/tp_add_student Имя | ссылка",
    "/tp_week — подсказка по неделям",
    "/tp_run_week last|current|previous|YYYY-MM-DD YYYY-MM-DD",
    "/tp_jobs",
    "/tp_report <ученик> [from to] — текст отчёта",
  ];
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
  const students = await getTrainingPeaksStudentsRegistryWithLatestReportStatus();

  if (students.length === 0) {
    await sendTrainingPeaksMessage(
      parsedMessage.chatId,
      [
        "В Supabase пока нет учеников TrainingPeaks. Добавь первого через:",
        TP_ADD_STUDENT_USAGE.replace("Напиши так: ", ""),
      ].join("\n")
    );
    return;
  }

  await sendTrainingPeaksMessage(parsedMessage.chatId, formatStudentsMessage(students));
}

async function handleTrainingPeaksAddStudent(
  parsedMessage: ParsedTelegramUpdate,
  text: string
): Promise<void> {
  const rawInput = parseAddStudentCommand(text);

  if (!rawInput) {
    await sendTrainingPeaksMessage(parsedMessage.chatId, TP_ADD_STUDENT_USAGE);
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
  const previousWeek = getPreviousTrainingPeaksWeek();
  const currentWeek = getCurrentTrainingPeaksWeek();
  const weekBeforePrevious = getWeekBeforePreviousTrainingPeaksWeek();

  await sendTrainingPeaksMessage(
    parsedMessage.chatId,
    [
      "Выбери неделю для отчетов:",
      "",
      "Прошлая неделя:",
      `/tp_run_week ${previousWeek.weekFrom} ${previousWeek.weekTo}`,
      "",
      "Текущая неделя:",
      `/tp_run_week ${currentWeek.weekFrom} ${currentWeek.weekTo}`,
      "",
      "Неделей раньше:",
      `/tp_run_week ${weekBeforePrevious.weekFrom} ${weekBeforePrevious.weekTo}`,
      "",
      "Потом запусти на Mac:",
      "cd ~/igor-tp-reports-bot/tools/trainingpeaks-export && npm run tp-agent-once",
    ].join("\n")
  );
}

async function handleTrainingPeaksRunWeek(
  parsedMessage: ParsedTelegramUpdate,
  text: string
): Promise<void> {
  const result = await requestTrainingPeaksWeeklyRun(text, {
    chatId: parsedMessage.chatId,
    userId: parsedMessage.userId,
  });

  if (!result.ok) {
    await sendTrainingPeaksMessage(parsedMessage.chatId, result.message);
    return;
  }

  await sendTrainingPeaksMessage(
    parsedMessage.chatId,
    [
      `✅ Задача создана: недельные отчеты ${formatWeekIso(result.job)}.`,
      "",
      "Теперь на Mac запусти:",
      "cd ~/igor-tp-reports-bot/tools/trainingpeaks-export && npm run tp-agent-once",
    ].join("\n")
  );
}

async function handleTrainingPeaksJobs(parsedMessage: ParsedTelegramUpdate): Promise<void> {
  const jobs = await getTrainingPeaksJobsStatus();

  if (jobs.length === 0) {
    await sendTrainingPeaksMessage(parsedMessage.chatId, "Задач TrainingPeaks пока нет.");
    return;
  }

  await sendTrainingPeaksMessage(parsedMessage.chatId, formatJobsMessage(jobs));
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
    if (command === "tp_status") {
      await handleTrainingPeaksStatus(parsedMessage, text);
      return "handled";
    }

    if (command === "tp_students") {
      await handleTrainingPeaksStudents(parsedMessage);
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
