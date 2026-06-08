import {
  getTrainingPeaksStudentByTelegramChatId,
  getTrainingPeaksStudentByTelegramUsername,
  getTrainingPeaksGroupWorkoutReportIntakeBySourceMessage,
  insertTrainingPeaksGroupWorkoutReportIntake,
  listTrainingPeaksStudentsIncludingArchived,
  type TrainingPeaksStudent,
} from "@/features/trainingpeaks/repository";
import {
  createTrainingPeaksGroupMoveRequestCase,
  passesTrainingPeaksStrictMoveWorkoutIntentGate,
} from "@/features/trainingpeaks/service";
import { buildTelegramContextTextPreview } from "@/features/trainingpeaks/telegram-context";
import { getTrainingPeaksCoachChatIds } from "@/features/trainingpeaks/attention-telegram";
import { sendTelegramMessage } from "@/features/telegram/telegram-client";
import type { TelegramInlineKeyboardMarkup, TelegramMessage } from "@/features/telegram/types";
import {
  decideTrainingPeaksGroupWorkoutReportIntake,
  getTrainingPeaksGroupWorkoutReportChatAllowlist,
  isTrainingPeaksGroupWorkoutReportIntakeEnabled,
} from "@/features/trainingpeaks/group-workout-report-intake";

const PREVIEW_MAX_LENGTH = 120;
const TP_CALLBACK_CASES_RECENT = "tp:cases:recent";
const TP_CALLBACK_CASE_RESOLVE_PREFIX = "tp:case:r:";
const TP_CALLBACK_CASE_DISMISS_PREFIX = "tp:case:d:";
const TELEGRAM_SERVICE_MESSAGE_KEYS = [
  "new_chat_members",
  "left_chat_member",
  "new_chat_title",
  "new_chat_photo",
  "delete_chat_photo",
  "group_chat_created",
  "supergroup_chat_created",
  "channel_chat_created",
  "migrate_to_chat_id",
  "migrate_from_chat_id",
  "pinned_message",
  "forum_topic_created",
  "forum_topic_edited",
  "forum_topic_closed",
  "forum_topic_reopened",
  "general_forum_topic_hidden",
  "general_forum_topic_unhidden",
  "write_access_allowed",
  "video_chat_scheduled",
  "video_chat_started",
  "video_chat_ended",
  "video_chat_participants_invited",
] as const;
const DIRECT_MOVE_WORDING_PATTERN =
  /(?:^|[\s,.!?;:()"'`])(?:можешь|можно|сдвин(?:уть|ь)|перенести|перенеси|перенесите|поставить|поставь|поставьте|переставить|переставь|сместить)(?:$|[\s,.!?;:()"'`])/u;
const COACH_MENTION_PATTERN = /@\w+/u;

type GroupProbeMatchMethod = "telegram_chat_id" | "telegram_username";

function isTrainingPeaksGroupProbeCoachNotificationEnabled(): boolean {
  const value = process.env.TRAININGPEAKS_GROUP_PROBE_ENABLED?.trim();
  if (value !== "true") {
    return false;
  }

  // Probe notifications are strictly debug-only and must stay disabled in production.
  return process.env.NODE_ENV !== "production";
}

function buildGroupProbePreview(message: TelegramMessage): string {
  const raw = (message.text ?? message.caption ?? "").trim();

  if (raw.length <= PREVIEW_MAX_LENGTH) {
    return raw;
  }

  return `${raw.slice(0, PREVIEW_MAX_LENGTH)}…`;
}

function buildGroupMovePreview(message: TelegramMessage): string | null {
  return buildTelegramContextTextPreview((message.text ?? message.caption ?? "").trim() || null);
}

function normalizeTelegramUsername(username: string | undefined): string | null {
  const normalized = username?.trim().replace(/^@+/, "") ?? "";

  return normalized || null;
}

async function matchGroupProbeSender(
  fromUserId: number | undefined,
  fromUsername: string | undefined
): Promise<{ student: TrainingPeaksStudent | null; matchMethod: GroupProbeMatchMethod | null }> {
  if (fromUserId != null) {
    const studentByChatId = await getTrainingPeaksStudentByTelegramChatId(String(fromUserId));

    if (studentByChatId) {
      return { student: studentByChatId, matchMethod: "telegram_chat_id" };
    }
  }

  const normalizedUsername = normalizeTelegramUsername(fromUsername);

  if (normalizedUsername) {
    const studentByUsername = await getTrainingPeaksStudentByTelegramUsername(normalizedUsername);

    if (studentByUsername) {
      return { student: studentByUsername, matchMethod: "telegram_username" };
    }
  }

  if (fromUserId == null && !normalizedUsername) {
    return { student: null, matchMethod: null };
  }

  // Inactive student detection must stay strict: exact telegram id/username match only.
  const studentsIncludingArchived = await listTrainingPeaksStudentsIncludingArchived();
  if (fromUserId != null) {
    const byChatId = studentsIncludingArchived.find(
      (student) => student.telegramChatId === String(fromUserId)
    );
    if (byChatId) {
      return { student: byChatId, matchMethod: "telegram_chat_id" };
    }
  }

  if (normalizedUsername) {
    const byUsername = studentsIncludingArchived.find(
      (student) => student.telegramUsername?.toLowerCase() === normalizedUsername.toLowerCase()
    );
    if (byUsername) {
      return { student: byUsername, matchMethod: "telegram_username" };
    }
  }

  return { student: null, matchMethod: null };
}

async function notifyCoachGroupProbe(text: string): Promise<void> {
  const coachChatIds = getTrainingPeaksCoachChatIds();

  if (coachChatIds.length === 0) {
    return;
  }

  await Promise.allSettled(
    coachChatIds.map(async (chatId) => {
      await sendTelegramMessage(chatId, text);
    })
  );
}

function normalizeMoveDetectText(value: string): string {
  return value
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/[.,!?;:()"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const MOVE_PAIR_SIDE_TOKEN_PATTERN = /^[а-яa-z0-9_-]{2,}$/iu;
const MOVE_PAIR_SIDE_BLOCKED_WORDS = new Set([
  "можешь",
  "можно",
  "сдвинуть",
  "сдвинь",
  "перенести",
  "перенеси",
  "перенесите",
  "поставить",
  "поставь",
  "поставьте",
  "переставить",
  "переставь",
  "сместить",
  "тренировку",
  "тренировки",
]);

function isCompactMovePairSide(raw: string): boolean {
  const tokens = raw
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  if (tokens.length < 1 || tokens.length > 2) {
    return false;
  }
  return tokens.every(
    (token) => MOVE_PAIR_SIDE_TOKEN_PATTERN.test(token) && !MOVE_PAIR_SIDE_BLOCKED_WORDS.has(token)
  );
}

function detectMovePairsPreview(rawText: string): Array<{ source: string; target: string }> {
  const normalized = normalizeMoveDetectText(rawText);
  if (!normalized) {
    return [];
  }

  const tokens = normalized.split(" ").filter((token) => token.length > 0);
  const pairs: Array<{ source: string; target: string }> = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index] !== "на") {
      continue;
    }

    let extracted: { source: string; target: string } | null = null;
    for (const sourceLength of [1, 2]) {
      const sourceStart = index - sourceLength;
      if (sourceStart < 0) {
        continue;
      }
      const source = tokens.slice(sourceStart, index).join(" ").trim();
      if (!isCompactMovePairSide(source)) {
        continue;
      }

      for (const targetLength of [1, 2]) {
        const targetEnd = index + 1 + targetLength;
        if (targetEnd > tokens.length) {
          continue;
        }
        const target = tokens.slice(index + 1, targetEnd).join(" ").trim();
        if (!isCompactMovePairSide(target)) {
          continue;
        }
        extracted = { source, target };
        break;
      }

      if (extracted) {
        break;
      }
    }

    if (extracted) {
      pairs.push(extracted);
    }
  }

  return pairs.slice(0, 3);
}

function detectGroupMoveMultiMove(rawText: string): {
  detected: boolean;
  possible: boolean;
  reason: string | null;
  movePairsPreview: Array<{ source: string; target: string }>;
} {
  const pairs = detectMovePairsPreview(rawText);
  if (pairs.length >= 2) {
    return {
      detected: true,
      possible: true,
      reason: "multiple source-target phrases",
      movePairsPreview: pairs,
    };
  }

  const normalized = normalizeMoveDetectText(rawText);
  const hasConjunctionSplit = /\b(а|и)\b/.test(normalized);
  const naMatches = normalized.match(/\bна\b/g)?.length ?? 0;
  if (hasConjunctionSplit && naMatches >= 2) {
    return {
      detected: false,
      possible: true,
      reason: "multiple source-target phrases",
      movePairsPreview: pairs,
    };
  }

  return {
    detected: false,
    possible: false,
    reason: null,
    movePairsPreview: pairs,
  };
}

function isCoachTelegramId(value: number | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  return new Set(getTrainingPeaksCoachChatIds()).has(String(value));
}

function isTelegramBotSender(message: TelegramMessage): boolean {
  const rawFrom = message.from as ({ is_bot?: boolean } | undefined);
  return rawFrom?.is_bot === true;
}

function isTelegramServiceMessage(message: TelegramMessage): boolean {
  const rawMessage = message as Record<string, unknown>;
  return TELEGRAM_SERVICE_MESSAGE_KEYS.some((key) => rawMessage[key] !== undefined);
}

function getGroupMoveCoachMarkup(caseShortId: string): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "🧩 Открыть кейсы", callback_data: TP_CALLBACK_CASES_RECENT }],
      [
        { text: "✅ Закрыть", callback_data: `${TP_CALLBACK_CASE_RESOLVE_PREFIX}${caseShortId}` },
        { text: "🙈 Скрыть", callback_data: `${TP_CALLBACK_CASE_DISMISS_PREFIX}${caseShortId}` },
      ],
    ],
  };
}

async function notifyCoachGroupMoveCase(input: {
  student: TrainingPeaksStudent;
  message: TelegramMessage;
  sourceType: "group_topic" | "group_general";
  parseReason: string;
  preview: string | null;
  caseShortId: string;
}): Promise<void> {
  const coachChatIds = getTrainingPeaksCoachChatIds();
  if (coachChatIds.length === 0) {
    return;
  }

  const sourceLabel = input.message.chat.title?.trim() || String(input.message.chat.id);
  const topicSuffix =
    input.sourceType === "group_topic" && input.message.message_thread_id !== undefined
      ? ` / topic ${input.message.message_thread_id}`
      : "";
  const text = [
    "📌 Групповой запрос TrainingPeaks",
    `Ученик: ${input.student.studentName}`,
    `Источник: ${sourceLabel}${topicSuffix}`,
    `Сообщение: ${input.preview || "(без текста)"}`,
    `Определение: ${input.parseReason}`,
    "Статус: needs review",
    `#${input.caseShortId}`,
  ].join("\n");

  const markup = getGroupMoveCoachMarkup(input.caseShortId);
  await Promise.allSettled(
    coachChatIds.map(async (chatId) => {
      await sendTelegramMessage(chatId, text, { replyMarkup: markup });
    })
  );
}

export async function handleTrainingPeaksGroupProbe(message: TelegramMessage): Promise<void> {
  const from = message.from;
  const preview = buildGroupProbePreview(message);
  const rawText = (message.text ?? message.caption ?? "").trim();

  const safeMetadata = {
    chatId: message.chat.id,
    chatTitle: message.chat.title ?? null,
    fromId: from?.id ?? null,
    fromUsername: from?.username ?? null,
    fromFirstName: from?.first_name ?? null,
    preview,
    date: message.date ?? null,
  };

  console.info("TrainingPeaks group probe: message seen", safeMetadata);

  const { student, matchMethod } = await matchGroupProbeSender(from?.id, from?.username);

  console.info("TrainingPeaks group probe: sender match", {
    ...safeMetadata,
    matched: student !== null,
    matchMethod,
    studentId: student?.studentId ?? null,
    studentName: student?.studentName ?? null,
  });

  const sourceType: "group_topic" | "group_general" =
    message.is_topic_message || message.message_thread_id !== undefined ? "group_topic" : "group_general";

  const reportIntakeDecision = await decideTrainingPeaksGroupWorkoutReportIntake({
    message,
    featureEnabled: isTrainingPeaksGroupWorkoutReportIntakeEnabled(),
    allowedChatIds: getTrainingPeaksGroupWorkoutReportChatAllowlist(),
    isCoachTelegramId,
    resolveSender: matchGroupProbeSender,
    hasExistingBySourceMessage: async (sourceChatId, sourceMessageId) => {
      const existing = await getTrainingPeaksGroupWorkoutReportIntakeBySourceMessage(
        sourceChatId,
        sourceMessageId
      );
      return existing !== null;
    },
  });

  if (reportIntakeDecision.shouldPersist && reportIntakeDecision.messageText) {
    const insertedIntake = await insertTrainingPeaksGroupWorkoutReportIntake({
      sourceChatId: String(message.chat.id),
      sourceMessageId: String(message.message_id),
      sourceMessageTimestamp:
        typeof message.date === "number" && Number.isFinite(message.date) && message.date > 0
          ? new Date(message.date * 1000).toISOString()
          : new Date().toISOString(),
      sourceTelegramUserId: message.from?.id != null ? String(message.from.id) : null,
      sourceTelegramUsername: message.from?.username?.trim() ?? null,
      sourceTelegramDisplayName: message.from?.first_name?.trim() ?? null,
      sourceChatTitle: message.chat.title?.trim() ?? null,
      studentId: reportIntakeDecision.student?.id ?? null,
      trainingPeaksAthleteId: reportIntakeDecision.trainingPeaksAthleteId,
      messageText: reportIntakeDecision.messageText,
      detectedLabels: reportIntakeDecision.detectedLabels,
      intakeStatus: reportIntakeDecision.intakeStatus,
      skipReason: reportIntakeDecision.skipReason,
      metadata: {
        sourceType,
        senderMatchMethod: reportIntakeDecision.senderMatchMethod,
      },
    });

    if (!insertedIntake) {
      console.info("TrainingPeaks group workout report intake: duplicate source message skipped", {
        chatId: message.chat.id,
        messageId: message.message_id,
      });
    }
  }

  if (
    student &&
    matchMethod &&
    rawText &&
    !rawText.startsWith("/") &&
    !isTelegramBotSender(message) &&
    !isCoachTelegramId(from?.id) &&
    !isTelegramServiceMessage(message)
  ) {
    const strictMoveIntent = passesTrainingPeaksStrictMoveWorkoutIntentGate(rawText);
    const directMoveWording = DIRECT_MOVE_WORDING_PATTERN.test(normalizeMoveDetectText(rawText));
    const coachMentioned = COACH_MENTION_PATTERN.test(rawText);
    const moveWorkoutCandidate = strictMoveIntent;

    if (moveWorkoutCandidate && (coachMentioned || directMoveWording)) {
      const multiMove = detectGroupMoveMultiMove(rawText);
      const parseReason =
        multiMove.detected || multiMove.possible
          ? "possible move request (multi-move)"
          : "possible move request";
      const caseResult = await createTrainingPeaksGroupMoveRequestCase({
        message,
        student,
        sourceType,
        senderMatchMethod: matchMethod,
        parseGateResult: {
          strictMoveIntent,
          moveWorkoutCandidate,
          directMoveWording,
          coachMentioned,
          reason: parseReason,
        },
        multiMove,
      });

      if (caseResult.kind === "created") {
        await notifyCoachGroupMoveCase({
          student,
          message,
          sourceType,
          parseReason,
          preview: buildGroupMovePreview(message),
          caseShortId: caseResult.shortId,
        });
      } else if (caseResult.kind === "duplicate") {
        console.info("TrainingPeaks group probe: duplicate move review case skipped", {
          studentId: student.id,
          chatId: message.chat.id,
          messageId: message.message_id,
          caseId: caseResult.caseId,
        });
      }
    }
  }

  if (!isTrainingPeaksGroupProbeCoachNotificationEnabled()) {
    return;
  }

  const groupLabel = message.chat.title?.trim()
    ? `${message.chat.title} (${message.chat.id})`
    : String(message.chat.id);

  const senderLabel = from?.username
    ? `@${from.username} (${from.id})`
    : from?.id != null
      ? String(from.id)
      : "unknown";

  const matchLabel = student
    ? `Matched: ${student.studentName} (${student.studentId}, via ${matchMethod})`
    : "Not matched";

  const notificationText = [
    "Group probe: message seen",
    `Group: ${groupLabel}`,
    `Sender: ${senderLabel}`,
    from?.first_name ? `Name: ${from.first_name}` : null,
    `Preview: ${preview || "(empty)"}`,
    matchLabel,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

  await notifyCoachGroupProbe(notificationText);
}
