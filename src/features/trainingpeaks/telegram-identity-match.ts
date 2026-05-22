import type { TrainingPeaksBusinessChatSnapshot } from "@/features/trainingpeaks/service";

export type TelegramCapturedIdentity = Pick<
  TrainingPeaksBusinessChatSnapshot,
  "firstName" | "lastName" | "username" | "lastSeenAt" | "chatId" | "lastText"
>;

export function normalizeTelegramIdentityText(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value
    .toLocaleLowerCase("ru")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized || null;
}

export function getCapturedTelegramDisplayName(
  chat: Pick<TelegramCapturedIdentity, "firstName" | "lastName">
): string | null {
  const fullName = [chat.firstName, chat.lastName].filter(Boolean).join(" ").trim();
  return fullName || null;
}

export function normalizeTelegramUsername(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().replace(/^@+/, "").toLocaleLowerCase("en-US");
  return normalized || null;
}

export function telegramIdentityTextsOverlap(
  left: string | null | undefined,
  right: string | null | undefined
): boolean {
  const normalizedLeft = normalizeTelegramIdentityText(left);
  const normalizedRight = normalizeTelegramIdentityText(right);

  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  if (normalizedLeft === normalizedRight) {
    return true;
  }

  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) {
    return true;
  }

  const leftParts = new Set(normalizedLeft.split(" ").filter(Boolean));
  const rightParts = new Set(normalizedRight.split(" ").filter(Boolean));

  if (leftParts.size === 0 || rightParts.size === 0) {
    return false;
  }

  let overlap = 0;

  for (const token of leftParts) {
    if (rightParts.has(token)) {
      overlap += 1;
    }
  }

  const ratio = overlap / Math.max(leftParts.size, rightParts.size);
  return ratio >= 0.5;
}

export function telegramUsernamesOverlap(
  studentUsername: string | null | undefined,
  capturedUsername: string | null | undefined
): boolean {
  const left = normalizeTelegramUsername(studentUsername);
  const right = normalizeTelegramUsername(capturedUsername);

  if (!left || !right) {
    return false;
  }

  return left === right;
}

export function hasTelegramIdentityMismatch(
  student: {
    studentName: string;
    telegramUsername: string | null;
  },
  capturedChat: Pick<TelegramCapturedIdentity, "firstName" | "lastName" | "username"> | null
): boolean {
  if (!capturedChat) {
    return false;
  }

  const capturedName = getCapturedTelegramDisplayName(capturedChat);
  const nameOverlap = telegramIdentityTextsOverlap(student.studentName, capturedName);
  const usernameOverlap = telegramUsernamesOverlap(student.telegramUsername, capturedChat.username);

  return !nameOverlap && !usernameOverlap;
}

export function scoreTelegramMatchForStudent(
  student: {
    studentName: string;
    telegramUsername: string | null;
  },
  chat: Pick<TelegramCapturedIdentity, "firstName" | "lastName" | "username">
): number {
  const capturedName = getCapturedTelegramDisplayName(chat);
  let score = 0;

  if (telegramIdentityTextsOverlap(student.studentName, capturedName)) {
    score += 100;
  } else {
    const studentTokens = new Set(
      (normalizeTelegramIdentityText(student.studentName) ?? "").split(" ").filter(Boolean)
    );
    const capturedTokens = new Set(
      (normalizeTelegramIdentityText(capturedName) ?? "").split(" ").filter(Boolean)
    );

    if (studentTokens.size > 0 && capturedTokens.size > 0) {
      let overlap = 0;

      for (const token of studentTokens) {
        if (capturedTokens.has(token)) {
          overlap += 1;
        }
      }

      score += Math.round((overlap / Math.max(studentTokens.size, capturedTokens.size)) * 80);
    }
  }

  if (telegramUsernamesOverlap(student.telegramUsername, chat.username)) {
    score += 100;
  } else if (chat.username) {
    const studentTokens = (normalizeTelegramIdentityText(student.studentName) ?? "")
      .split(" ")
      .filter(Boolean);
    const usernameTokens = chat.username
      .replace(/[_-]+/g, " ")
      .toLocaleLowerCase("en-US")
      .split(/[^a-z0-9]+/)
      .filter(Boolean);

    for (const token of studentTokens) {
      if (usernameTokens.some((part) => part.includes(token) || token.includes(part))) {
        score += 15;
      }
    }
  }

  return score;
}

export function getTelegramMismatchRiskScore(input: {
  hasMismatch: boolean;
  telegramDeliveryEnabled: boolean;
  capturedChatMissing: boolean;
}): number {
  if (input.hasMismatch && input.telegramDeliveryEnabled) {
    return 300;
  }

  if (input.hasMismatch) {
    return 200;
  }

  if (input.capturedChatMissing) {
    return 100;
  }

  return 0;
}

export function formatTelegramMismatchAcknowledgementMessage(input: {
  studentName: string;
  capturedName: string | null;
  capturedUsername: string | null;
  actionLabel: string;
}): string {
  const capturedIdentity = [
    input.capturedName,
    input.capturedUsername ? `@${input.capturedUsername.replace(/^@+/, "")}` : null,
  ]
    .filter(Boolean)
    .join(" / ");

  return [
    "ВНИМАНИЕ: Telegram-привязка не совпадает с учеником.",
    `Ученик: ${input.studentName}`,
    `В Business-чате: ${capturedIdentity || "без имени"}`,
    "",
    `${input.actionLabel} всё равно?`,
  ].join("\n");
}
