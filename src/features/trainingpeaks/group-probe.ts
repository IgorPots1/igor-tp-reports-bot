import {
  getTrainingPeaksStudentByTelegramChatId,
  getTrainingPeaksStudentByTelegramUsername,
  type TrainingPeaksStudent,
} from "@/features/trainingpeaks/repository";
import { getTrainingPeaksCoachChatIds } from "@/features/trainingpeaks/attention-telegram";
import { sendTelegramMessage } from "@/features/telegram/telegram-client";
import type { TelegramMessage } from "@/features/telegram/types";

const PREVIEW_MAX_LENGTH = 120;

type GroupProbeMatchMethod = "telegram_chat_id" | "telegram_username";

function isTrainingPeaksGroupProbeCoachNotificationEnabled(): boolean {
  const value = process.env.TRAININGPEAKS_GROUP_PROBE_ENABLED?.trim();
  return value === "true" || value === "1";
}

function buildGroupProbePreview(message: TelegramMessage): string {
  const raw = (message.text ?? message.caption ?? "").trim();

  if (raw.length <= PREVIEW_MAX_LENGTH) {
    return raw;
  }

  return `${raw.slice(0, PREVIEW_MAX_LENGTH)}…`;
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

export async function handleTrainingPeaksGroupProbe(message: TelegramMessage): Promise<void> {
  const from = message.from;
  const preview = buildGroupProbePreview(message);

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
