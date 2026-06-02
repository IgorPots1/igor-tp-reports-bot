import type { TrainingPeaksAttentionSnapshot } from "@/features/trainingpeaks/service";

export const TRAININGPEAKS_ATTENTION_DIGEST_CHUNK_LIMIT = 3500;

function formatAttentionSignalLine(signal: {
  studentName: string | null;
  reason: string;
  studentId?: string | null;
  caseId?: string | null;
  actionId?: string | null;
}, botUsername: string | null): string {
  const name = signal.studentName?.trim();
  const payload = getAttentionSignalDeepLinkPayload(signal);
  const linkedName =
    name && botUsername && payload
      ? name
      : name;

  if (linkedName) {
    return `• ${linkedName} — ${signal.reason}`;
  }

  return `• ${signal.reason}`;
}

function getTrainingPeaksBotUsername(): string | null {
  const value = process.env.TELEGRAM_BOT_USERNAME?.trim() ?? "";
  if (!value) {
    return null;
  }

  const normalized = value.replace(/^@+/, "").trim();
  return normalized || null;
}

function toShortId(value: string | null | undefined, limit: number): string | null {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }

  return normalized.length > limit ? normalized.slice(0, limit) : normalized;
}

function getAttentionSignalDeepLinkPayload(signal: {
  studentId?: string | null;
  caseId?: string | null;
  actionId?: string | null;
}): string | null {
  const caseShort = toShortId(signal.caseId, 8);
  if (caseShort) {
    return `case_${caseShort}`;
  }

  const actionShort = toShortId(signal.actionId, 8);
  if (actionShort) {
    return `action_${actionShort}`;
  }

  const studentShort = toShortId(signal.studentId, 40);
  if (studentShort) {
    return `student_${studentShort}`;
  }

  return null;
}

function buildAttentionSection(
  title: string,
  signals: Array<{
    studentName: string | null;
    reason: string;
    studentId?: string | null;
    caseId?: string | null;
    actionId?: string | null;
  }>,
  botUsername: string | null
): string[] {
  const lines = [title];
  if (signals.length === 0) {
    lines.push("• Нет");
    return lines;
  }

  for (const signal of signals) {
    lines.push(formatAttentionSignalLine(signal, botUsername));
  }

  return lines;
}

function joinAttentionDigestBlock(lines: string[]): string {
  return lines.join("\n");
}

function splitOversizedAttentionDigestBlock(lines: string[], limit: number): string[][] {
  if (lines.length === 0) {
    return [];
  }

  const header = lines[0];
  const items = lines.slice(1);
  if (items.length === 0) {
    return [lines];
  }

  const parts: string[][] = [];
  let current: string[] = [header];
  let currentLength = header.length;

  for (const item of items) {
    const separatorLength = current.length > 1 ? 1 : 0;
    const nextLength = currentLength + separatorLength + item.length;

    if (nextLength > limit && current.length > 1) {
      parts.push(current);
      current = [header, item];
      currentLength = header.length + 1 + item.length;
      continue;
    }

    current.push(item);
    currentLength = nextLength;
  }

  parts.push(current);
  return parts;
}

function hardSplitAttentionDigestText(text: string, limit: number): string[] {
  const chunks: string[] = [];
  let rest = text.trim();

  while (rest.length > 0) {
    if (rest.length <= limit) {
      chunks.push(rest);
      break;
    }

    let boundary = rest.lastIndexOf("\n", limit);
    if (boundary < Math.floor(limit * 0.5)) {
      boundary = rest.lastIndexOf(" ", limit);
    }
    if (boundary <= 0) {
      boundary = limit;
    }

    chunks.push(rest.slice(0, boundary).trimEnd());
    rest = rest.slice(boundary).trimStart();
  }

  return chunks.filter(Boolean);
}

function packAttentionDigestBlocks(blocks: string[][], limit: number): string[] {
  const chunks: string[] = [];
  let current: string[] = [];

  const flush = () => {
    if (current.length === 0) {
      return;
    }

    chunks.push(joinAttentionDigestBlock(current));
    current = [];
  };

  for (const block of blocks) {
    if (block.length === 0) {
      continue;
    }

    const blockText = joinAttentionDigestBlock(block);
    if (blockText.length > limit) {
      flush();
      for (const part of splitOversizedAttentionDigestBlock(block, limit)) {
        const partText = joinAttentionDigestBlock(part);
        if (partText.length > limit) {
          chunks.push(...hardSplitAttentionDigestText(partText, limit));
        } else {
          chunks.push(partText);
        }
      }
      continue;
    }

    if (current.length === 0) {
      current = [...block];
      continue;
    }

    const combinedLength = joinAttentionDigestBlock(current).length + 2 + blockText.length;
    if (combinedLength <= limit) {
      current.push("", ...block);
      continue;
    }

    flush();
    current = [...block];
  }

  flush();
  return chunks;
}

function buildAttentionDigestBlocks(
  snapshot: TrainingPeaksAttentionSnapshot,
  title: string
): string[][] {
  const botUsername = getTrainingPeaksBotUsername();
  const urgent = buildAttentionSection("Срочно", snapshot.urgent, botUsername);
  const today = buildAttentionSection("Сегодня", snapshot.today, botUsername);
  const observe = buildAttentionSection("Наблюдать", snapshot.observe, botUsername);

  const hasSignals = snapshot.urgent.length > 0 || snapshot.today.length > 0 || snapshot.observe.length > 0;
  const fyi = buildAttentionSection("FYI", snapshot.fyi, botUsername);
  if (snapshot.fyi.length === 0 && !hasSignals) {
    fyi.splice(1, fyi.length - 1, "• Активных сигналов больше нет");
  }

  const followUpSignals = [...snapshot.followUpToday];
  if (snapshot.followUpOverflowCount > 0) {
    followUpSignals.push({
      level: "today",
      studentName: null,
      reason: `+${snapshot.followUpOverflowCount} ещё follow-up`,
      studentId: null,
    });
  }
  const followUps = buildAttentionSection("Проверить сегодня", followUpSignals, botUsername);

  return [[title], urgent, today, followUps, observe, fyi];
}

export function buildTrainingPeaksAttentionDigestMessages(
  snapshot: TrainingPeaksAttentionSnapshot,
  title: string,
  chunkLimit = TRAININGPEAKS_ATTENTION_DIGEST_CHUNK_LIMIT
): string[] {
  return packAttentionDigestBlocks(buildAttentionDigestBlocks(snapshot, title), chunkLimit);
}

export function formatTrainingPeaksAttentionSnapshotMessage(
  snapshot: TrainingPeaksAttentionSnapshot,
  title: string
): string {
  const blocks = buildAttentionDigestBlocks(snapshot, title);
  return blocks
    .map((block) => joinAttentionDigestBlock(block))
    .join("\n\n");
}

export function getTrainingPeaksCoachChatIds(): string[] {
  const value = process.env.TELEGRAM_COACH_CHAT_IDS?.trim();

  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((chatId) => chatId.trim())
    .filter(Boolean);
}
