import type { TrainingPeaksMessageIntentLog } from "@/features/trainingpeaks/repository";

const TP_INTENT_LOG_TRIAGE_TIME_FORMATTER = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Belgrade",
});

export type TrainingPeaksMessageIntentLogTriageTelegramOptions = {
  limit: number;
  studentNames?: ReadonlyMap<string, string>;
};

export type ParsedTrainingPeaksIntentsCommandArgs =
  | {
      limit: number;
      aiMoveOnly: boolean;
      unknownOnly: boolean;
    }
  | {
      error: string;
    };

const TP_INTENTS_COMMAND_PREFIX_PATTERN =
  /^\/tp_(?:intents|intent_logs|unknown|ai_intents)(?:@\w+)?(?:\s+(.*))?$/i;

function readNestedField(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return (value as Record<string, unknown>)[key] ?? null;
}

function formatConfidence(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }

  return value.toFixed(2);
}

function formatIntentLogTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return TP_INTENT_LOG_TRIAGE_TIME_FORMATTER.format(date);
}

function formatStudentLabel(
  log: TrainingPeaksMessageIntentLog,
  studentNames?: ReadonlyMap<string, string>
): string | null {
  if (!log.studentId) {
    return null;
  }

  const studentName = studentNames?.get(log.studentId)?.trim();
  return studentName || log.studentId;
}

export function buildTrainingPeaksMessageIntentLogTriageRecommendation(
  log: TrainingPeaksMessageIntentLog
): string {
  if (log.status === "action_created" || log.actionId) {
    return "Заявка уже создана";
  }

  if (log.status === "student_not_found") {
    return "Ученик не привязан";
  }

  const aiIntent = typeof log.aiIntent?.intent === "string" ? log.aiIntent.intent : null;

  if (aiIntent === "none") {
    return "действий не нужно";
  }

  if (
    aiIntent === "move_workout" &&
    (log.status === "unrecognized" || log.status === "parse_failed" || log.status === "needs_review")
  ) {
    return "AI понял перенос, rule-parser пропустил";
  }

  if (log.status === "unrecognized" || log.status === "parse_failed") {
    return "Нужен alias в parser?";
  }

  if (log.status === "needs_review") {
    return "Нужно уточнение";
  }

  return "Проверить вручную";
}

function formatTelegramAiSummary(log: TrainingPeaksMessageIntentLog): string {
  const aiIntent = log.aiIntent;
  const intent = typeof aiIntent?.intent === "string" ? aiIntent.intent : null;
  const confidence = formatConfidence(log.aiConfidence);

  if (!aiIntent) {
    return `AI: — · ${confidence}`;
  }

  if (!intent || intent === "none") {
    return `AI: none · ${confidence}`;
  }

  const workoutKind = readNestedField(aiIntent.workout_reference, "kind");
  const targetText = readNestedField(aiIntent.target_date, "text");
  const targetValue = readNestedField(aiIntent.target_date, "value");
  const targetSummary =
    typeof targetText === "string" && targetText.trim()
      ? targetText.trim()
      : typeof targetValue === "string" && targetValue.trim()
        ? targetValue.trim()
        : "—";
  const workoutSummary = typeof workoutKind === "string" && workoutKind.trim() ? workoutKind.trim() : "—";

  return `AI: ${intent} · ${workoutSummary} → ${targetSummary} · ${confidence}`;
}

function formatTelegramTriageItem(
  log: TrainingPeaksMessageIntentLog,
  index: number,
  studentNames?: ReadonlyMap<string, string>
): string {
  const reasonSuffix = log.reason ? ` · ${log.reason}` : "";
  const lines = [`${index}) ${formatIntentLogTime(log.createdAt)} · ${log.status}${reasonSuffix}`];

  const studentLabel = formatStudentLabel(log, studentNames);
  if (studentLabel) {
    lines.push(`Ученик: ${studentLabel}`);
  }

  const textPreview = log.textPreview?.trim();
  lines.push(`Текст: ${textPreview ? `«${textPreview}»` : "—"}`);
  lines.push(formatTelegramAiSummary(log));
  lines.push(`Рекомендация: ${buildTrainingPeaksMessageIntentLogTriageRecommendation(log)}`);

  return lines.join("\n");
}

export function formatTrainingPeaksMessageIntentLogsTriageTelegram(
  logs: TrainingPeaksMessageIntentLog[],
  options: TrainingPeaksMessageIntentLogTriageTelegramOptions
): string {
  if (logs.length === 0) {
    return "🧠 Непонятые TP-сообщения\n\nЗа последние 24 часа triage-записей нет.";
  }

  const items = logs.map((log, index) =>
    formatTelegramTriageItem(log, index + 1, options.studentNames)
  );

  return [
    "🧠 Непонятые TP-сообщения",
    "",
    items.join("\n\n"),
    "",
    `Показано: ${logs.length}`,
    `Команда: /tp_intents ${options.limit}`,
  ].join("\n");
}

export function parseTrainingPeaksIntentsCommandArgs(text: string): ParsedTrainingPeaksIntentsCommandArgs {
  const match = text.trim().match(TP_INTENTS_COMMAND_PREFIX_PATTERN);
  if (!match) {
    return {
      error: "Не поняла команду. Напиши: /tp_intents [лимит] [ai|unknown]",
    };
  }

  const args = (match[1] ?? "").trim().split(/\s+/).filter(Boolean);
  let limit = 10;
  let aiMoveOnly = false;
  let unknownOnly = false;

  for (const arg of args) {
    if (/^\d+$/.test(arg)) {
      const parsedLimit = Number.parseInt(arg, 10);
      if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
        return {
          error: "Лимит должен быть положительным числом.\nНапиши: /tp_intents 20",
        };
      }

      limit = Math.min(parsedLimit, 50);
      continue;
    }

    if (arg === "ai") {
      aiMoveOnly = true;
      continue;
    }

    if (arg === "unknown") {
      unknownOnly = true;
      continue;
    }

    return {
      error: `Не понял аргумент «${arg}».\nНапиши: /tp_intents [лимит] [ai|unknown]`,
    };
  }

  return {
    limit,
    aiMoveOnly,
    unknownOnly,
  };
}
