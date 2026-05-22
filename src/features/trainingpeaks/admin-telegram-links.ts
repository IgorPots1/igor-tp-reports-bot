import {
  formatTrainingPeaksAdminTelegramChatName,
  shortenTrainingPeaksAdminChatId,
} from "@/features/trainingpeaks/admin-telegram";
import {
  getTrainingPeaksBusinessChatByChatId,
  getTrainingPeaksStudentsRegistryWithLatestReportStatus,
  listTrainingPeaksBusinessChatsForTelegramLinking,
  type TrainingPeaksBusinessChatSnapshot,
  type TrainingPeaksRegistryStudentSnapshot,
} from "@/features/trainingpeaks/service";
import {
  getCapturedTelegramDisplayName,
  getTelegramMismatchRiskScore,
  hasTelegramIdentityMismatch,
  scoreTelegramMatchForStudent,
} from "@/features/trainingpeaks/telegram-identity-match";

export type TrainingPeaksAdminTelegramLinksTab = "suspicious" | "unlinked" | "orphans";

export type TrainingPeaksAdminStudentTelegramMismatchStatus = {
  capturedChat: TrainingPeaksBusinessChatSnapshot | null;
  capturedName: string | null;
  hasMismatch: boolean;
  capturedChatMissing: boolean;
  riskScore: number;
};

export type TrainingPeaksAdminTelegramSuggestedMatch = {
  chat: TrainingPeaksBusinessChatSnapshot;
  score: number;
};

export type TrainingPeaksAdminSuspiciousTelegramLinkRecord = {
  student: TrainingPeaksRegistryStudentSnapshot;
  capturedChat: TrainingPeaksBusinessChatSnapshot | null;
  capturedName: string | null;
  hasMismatch: boolean;
  capturedChatMissing: boolean;
  riskScore: number;
  lastSeenAt: string | null;
};

export type TrainingPeaksAdminUnlinkedTelegramStudentRecord = {
  student: TrainingPeaksRegistryStudentSnapshot;
  candidates: TrainingPeaksAdminTelegramSuggestedMatch[];
  bestScore: number;
  lastSeenAt: string | null;
};

export type TrainingPeaksAdminOrphanTelegramChatRecord = {
  chat: TrainingPeaksBusinessChatSnapshot;
  capturedName: string | null;
};

export type TrainingPeaksAdminTelegramLinksOverview = {
  suspicious: TrainingPeaksAdminSuspiciousTelegramLinkRecord[];
  unlinked: TrainingPeaksAdminUnlinkedTelegramStudentRecord[];
  orphans: TrainingPeaksAdminOrphanTelegramChatRecord[];
};

const SUGGESTED_MATCH_LIMIT = 3;
const MIN_SUGGESTED_MATCH_SCORE = 20;

function compareByRiskThenLastSeen<T extends { riskScore: number; lastSeenAt: string | null }>(
  left: T,
  right: T
): number {
  if (right.riskScore !== left.riskScore) {
    return right.riskScore - left.riskScore;
  }

  const leftSeen = left.lastSeenAt ? Date.parse(left.lastSeenAt) : 0;
  const rightSeen = right.lastSeenAt ? Date.parse(right.lastSeenAt) : 0;

  return rightSeen - leftSeen;
}

function compareByScoreThenLastSeen(
  left: TrainingPeaksAdminUnlinkedTelegramStudentRecord,
  right: TrainingPeaksAdminUnlinkedTelegramStudentRecord
): number {
  if (right.bestScore !== left.bestScore) {
    return right.bestScore - left.bestScore;
  }

  const leftSeen = left.lastSeenAt ? Date.parse(left.lastSeenAt) : 0;
  const rightSeen = right.lastSeenAt ? Date.parse(right.lastSeenAt) : 0;

  return rightSeen - leftSeen;
}

function compareChatsByLastSeen(
  left: TrainingPeaksAdminOrphanTelegramChatRecord,
  right: TrainingPeaksAdminOrphanTelegramChatRecord
): number {
  return Date.parse(right.chat.lastSeenAt) - Date.parse(left.chat.lastSeenAt);
}

export function buildTrainingPeaksAdminStudentTelegramMismatchStatus(
  student: Pick<
    TrainingPeaksRegistryStudentSnapshot,
    "studentName" | "telegramUsername" | "telegramChatId" | "telegramDeliveryEnabled"
  >,
  capturedChat: TrainingPeaksBusinessChatSnapshot | null
): TrainingPeaksAdminStudentTelegramMismatchStatus {
  const capturedChatMissing = Boolean(student.telegramChatId && !capturedChat);
  const hasMismatch = hasTelegramIdentityMismatch(student, capturedChat);

  return {
    capturedChat,
    capturedName: capturedChat ? getCapturedTelegramDisplayName(capturedChat) : null,
    hasMismatch,
    capturedChatMissing,
    riskScore: getTelegramMismatchRiskScore({
      hasMismatch,
      telegramDeliveryEnabled: student.telegramDeliveryEnabled,
      capturedChatMissing,
    }),
  };
}

export function suggestTrainingPeaksAdminTelegramMatchesForStudent(
  student: Pick<TrainingPeaksRegistryStudentSnapshot, "studentName" | "telegramUsername">,
  availableChats: TrainingPeaksBusinessChatSnapshot[],
  limit = SUGGESTED_MATCH_LIMIT
): TrainingPeaksAdminTelegramSuggestedMatch[] {
  return availableChats
    .map((chat) => ({
      chat,
      score: scoreTelegramMatchForStudent(student, chat),
    }))
    .filter((entry) => entry.score >= MIN_SUGGESTED_MATCH_SCORE)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return Date.parse(right.chat.lastSeenAt) - Date.parse(left.chat.lastSeenAt);
    })
    .slice(0, limit);
}

export function formatTrainingPeaksAdminTelegramBindConfirmMessage(
  studentName: string,
  chat: Pick<TrainingPeaksBusinessChatSnapshot, "firstName" | "lastName" | "username" | "chatId">
): string {
  const capturedName = formatTrainingPeaksAdminTelegramChatName(chat);
  const chatLabel = shortenTrainingPeaksAdminChatId(chat.chatId);

  return `Привязать ${studentName} к ${capturedName} / chat ${chatLabel}?`;
}

export async function getTrainingPeaksAdminStudentCapturedBusinessChat(
  student: Pick<TrainingPeaksRegistryStudentSnapshot, "telegramChatId">
): Promise<TrainingPeaksBusinessChatSnapshot | null> {
  if (!student.telegramChatId) {
    return null;
  }

  return getTrainingPeaksBusinessChatByChatId(student.telegramChatId);
}

export async function getTrainingPeaksAdminStudentTelegramMismatchStatus(
  student: Pick<
    TrainingPeaksRegistryStudentSnapshot,
    "studentName" | "telegramUsername" | "telegramChatId" | "telegramDeliveryEnabled"
  >
): Promise<TrainingPeaksAdminStudentTelegramMismatchStatus> {
  const capturedChat = await getTrainingPeaksAdminStudentCapturedBusinessChat(student);
  return buildTrainingPeaksAdminStudentTelegramMismatchStatus(student, capturedChat);
}

export async function getTrainingPeaksAdminStudentTelegramSuggestedMatches(
  student: Pick<TrainingPeaksRegistryStudentSnapshot, "studentName" | "telegramUsername" | "telegramChatId">
): Promise<TrainingPeaksAdminTelegramSuggestedMatch[]> {
  if (student.telegramChatId) {
    return [];
  }

  const [businessChats, students] = await Promise.all([
    listTrainingPeaksBusinessChatsForTelegramLinking(),
    getTrainingPeaksStudentsRegistryWithLatestReportStatus(),
  ]);

  const linkedChatIds = new Set(
    students
      .map((entry) => entry.telegramChatId)
      .filter((chatId): chatId is string => Boolean(chatId))
  );
  const unlinkedChats = businessChats.filter((chat) => !linkedChatIds.has(chat.chatId));

  return suggestTrainingPeaksAdminTelegramMatchesForStudent(student, unlinkedChats);
}

export async function listTrainingPeaksAdminTelegramLinksOverview(): Promise<TrainingPeaksAdminTelegramLinksOverview> {
  const [students, businessChats] = await Promise.all([
    getTrainingPeaksStudentsRegistryWithLatestReportStatus(),
    listTrainingPeaksBusinessChatsForTelegramLinking(),
  ]);

  const activeStudents = students.filter((student) => student.isActive);
  const linkedChatIds = new Set(
    activeStudents
      .map((student) => student.telegramChatId)
      .filter((chatId): chatId is string => Boolean(chatId))
  );
  const chatByChatId = new Map(businessChats.map((chat) => [chat.chatId, chat]));
  const unlinkedChats = businessChats.filter((chat) => !linkedChatIds.has(chat.chatId));

  const suspicious = activeStudents
    .filter((student) => student.telegramChatId)
    .map((student) => {
      const capturedChat = chatByChatId.get(student.telegramChatId!) ?? null;
      const status = buildTrainingPeaksAdminStudentTelegramMismatchStatus(student, capturedChat);

      return {
        student,
        capturedChat,
        capturedName: status.capturedName,
        hasMismatch: status.hasMismatch,
        capturedChatMissing: status.capturedChatMissing,
        riskScore: status.riskScore,
        lastSeenAt: capturedChat?.lastSeenAt ?? null,
      };
    })
    .filter((entry) => entry.hasMismatch || entry.capturedChatMissing)
    .sort(compareByRiskThenLastSeen);

  const unlinked = activeStudents
    .filter((student) => !student.telegramChatId)
    .map((student) => {
      const candidates = suggestTrainingPeaksAdminTelegramMatchesForStudent(student, unlinkedChats);

      return {
        student,
        candidates,
        bestScore: candidates[0]?.score ?? 0,
        lastSeenAt: candidates[0]?.chat.lastSeenAt ?? null,
      };
    })
    .filter((entry) => entry.candidates.length > 0)
    .sort(compareByScoreThenLastSeen);

  const orphans = unlinkedChats
    .map((chat) => ({
      chat,
      capturedName: getCapturedTelegramDisplayName(chat),
    }))
    .sort(compareChatsByLastSeen);

  return {
    suspicious,
    unlinked,
    orphans,
  };
}
