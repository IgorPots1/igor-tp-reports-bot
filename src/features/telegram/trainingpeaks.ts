import type { ParsedTelegramUpdate } from "@/features/telegram/parser";
import {
  getLatestTrainingPeaksWeekReports,
  getTrainingPeaksReportForStudent,
  getTrainingPeaksReportsForWeek,
  getTrainingPeaksStudentStatuses,
} from "@/features/trainingpeaks/service";
import { sendTelegramMessage } from "@/features/telegram/telegram-client";

const COACH_ONLY_MESSAGE = "⛔ Эта команда доступна только тренеру.";
const TP_WEEKLY_DISABLED_MESSAGE =
  "⚙️ Запуск TrainingPeaks workflow из Telegram отключён. TrainingPeaks остаётся только в read-only режиме.";
const TP_UNKNOWN_COMMAND_MESSAGE = "ℹ️ Команда TrainingPeaks не распознана. Используй /help.";
const TELEGRAM_MESSAGE_LIMIT = 4000;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const TP_STATUS_COMMAND_PATTERN = /^\/tp_status(?:@\w+)?(?:\s+|$)/;
const TP_STUDENTS_COMMAND_PATTERN = /^\/tp_students(?:@\w+)?(?:\s+|$)/;
const TP_REPORT_COMMAND_PATTERN = /^\/tp_report(?:@\w+)?(?:\s+|$)/;
const TP_WEEKLY_COMMAND_PATTERN = /^\/tp_weekly(?:@\w+)?(?:\s+|$)/;
const TP_COMMAND_PATTERN = /^\/tp_[a-z0-9_]+(?:@\w+)?(?:\s+|$)/;

type TrainingPeaksCommand = "tp_status" | "tp_students" | "tp_report" | "tp_weekly" | "unknown";

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

function isIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function formatWeek(week: TrainingPeaksWeek): string {
  return `${week.weekFrom} — ${week.weekTo}`;
}

function formatTrainingPeaksStatus(status: string, hasReport: boolean): string {
  if (status === "ready") {
    return "готов";
  }

  if (status === "parsed_only") {
    return hasReport ? "готов" : "только метаданные";
  }

  return hasReport ? `${status} (отчёт есть)` : status;
}

function formatSyncedAt(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
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

function parseWeekArgs(tokens: string[]): { week: TrainingPeaksWeek | null; error: string | null } {
  if (tokens.length === 0) {
    return { week: null, error: null };
  }

  if (tokens.length !== 2) {
    return {
      week: null,
      error: "Напиши так: /tp_status 2026-04-27 2026-05-03",
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
  return parseWeekArgs(args ? args.split(/\s+/) : []);
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
    const { week, error } = parseWeekArgs([beforeLastToken, lastToken]);

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

function formatStatusMessage(
  week: TrainingPeaksWeek,
  reports: {
    studentName: string;
    studentId: string;
    status: string;
    reportMarkdown: string | null;
    syncedAt: string;
  }[]
): string {
  const readyCount = reports.filter((report) => report.reportMarkdown?.trim()).length;
  const parsedOnlyCount = reports.length - readyCount;

  return [
    `📊 TrainingPeaks за неделю ${formatWeek(week)}`,
    "",
    `Всего записей: ${reports.length}`,
    `Готовых отчётов: ${readyCount}`,
    `Только метаданные: ${parsedOnlyCount}`,
    "",
    ...reports.map(
      (report, index) =>
        `${index + 1}. ${report.studentName} — ${formatTrainingPeaksStatus(
          report.status,
          Boolean(report.reportMarkdown?.trim())
        )}, синхронизировано ${formatSyncedAt(report.syncedAt)}`
    ),
  ].join("\n");
}

function formatStudentsMessage(
  students: {
    studentName: string;
    weekFrom: string;
    weekTo: string;
    status: string;
    reportMarkdown: string | null;
    syncedAt: string;
  }[]
): string {
  return [
    "👥 Ученики TrainingPeaks",
    "",
    `Всего учеников: ${students.length}`,
    "",
    ...students.map(
      (student, index) =>
        `${index + 1}. ${student.studentName} — ${formatTrainingPeaksStatus(
          student.status,
          Boolean(student.reportMarkdown?.trim())
        )}, ${student.weekFrom} — ${student.weekTo}, синхронизировано ${formatSyncedAt(student.syncedAt)}`
    ),
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
    "/tp_report <ученик> [from to] — текст отчёта",
    "/tp_weekly — запуск workflow отключён",
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

  const result = week
    ? await getTrainingPeaksReportsForWeek(week)
    : await getLatestTrainingPeaksWeekReports();

  if (!result || result.reports.length === 0) {
    await sendTrainingPeaksMessage(
      parsedMessage.chatId,
      week
        ? `За неделю ${formatWeek(week)} синхронизированных отчётов нет.`
        : "В Supabase пока нет синхронизированных отчётов TrainingPeaks."
    );
    return;
  }

  await sendTrainingPeaksMessage(
    parsedMessage.chatId,
    formatStatusMessage(result.week, result.reports)
  );
}

async function handleTrainingPeaksStudents(parsedMessage: ParsedTelegramUpdate): Promise<void> {
  const students = await getTrainingPeaksStudentStatuses();

  if (students.length === 0) {
    await sendTrainingPeaksMessage(
      parsedMessage.chatId,
      "В Supabase пока нет синхронизированных учеников TrainingPeaks."
    );
    return;
  }

  await sendTrainingPeaksMessage(parsedMessage.chatId, formatStudentsMessage(students));
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

  const result = await getTrainingPeaksReportForStudent(studentQuery, week ?? undefined);

  if (!result) {
    await sendTrainingPeaksMessage(
      parsedMessage.chatId,
      week
        ? `Не нашёл отчёт для «${studentQuery}» за неделю ${formatWeek(week)}.`
        : `Не нашёл отчёт для «${studentQuery}» в синхронизированных данных.`
    );
    return;
  }

  const reportMarkdown = result.report.reportMarkdown?.trim();

  if (!reportMarkdown) {
    await sendTrainingPeaksMessage(
      parsedMessage.chatId,
      [
        `📝 ${result.report.studentName}`,
        `Неделя: ${formatWeek(result.week)}`,
        `Статус: ${formatTrainingPeaksStatus(result.report.status, false)}`,
        "",
        "Текст отчёта ещё не синхронизирован. В Supabase есть только метаданные.",
      ].join("\n")
    );
    return;
  }

  await sendTrainingPeaksMessage(
    parsedMessage.chatId,
    [`📝 ${result.report.studentName}`, `Неделя: ${formatWeek(result.week)}`, "", reportMarkdown].join(
      "\n"
    )
  );
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

    if (command === "tp_report") {
      await handleTrainingPeaksReport(parsedMessage, text);
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
