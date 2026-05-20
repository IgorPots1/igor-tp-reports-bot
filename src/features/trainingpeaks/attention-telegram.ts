import type { TrainingPeaksAttentionSnapshot } from "@/features/trainingpeaks/service";

export const TRAININGPEAKS_ATTENTION_DIGEST_CHUNK_LIMIT = 3500;

function formatAttentionSignalLine(signal: {
  studentName: string | null;
  reason: string;
}): string {
  if (signal.studentName) {
    return `• ${signal.studentName} — ${signal.reason}`;
  }

  return `• ${signal.reason}`;
}

function buildAttentionSection(
  title: string,
  signals: Array<{
    studentName: string | null;
    reason: string;
  }>
): string[] {
  const lines = [title];
  if (signals.length === 0) {
    lines.push("• Нет");
    return lines;
  }

  for (const signal of signals) {
    lines.push(formatAttentionSignalLine(signal));
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
  const urgent = buildAttentionSection("Срочно", snapshot.urgent);
  const today = buildAttentionSection("Сегодня", snapshot.today);
  const observe = buildAttentionSection("Наблюдать", snapshot.observe);

  const hasSignals = snapshot.urgent.length > 0 || snapshot.today.length > 0 || snapshot.observe.length > 0;
  const fyi = buildAttentionSection("FYI", snapshot.fyi);
  if (snapshot.fyi.length === 0 && !hasSignals) {
    fyi.splice(1, fyi.length - 1, "• Активных сигналов больше нет");
  }

  return [[title], urgent, today, observe, fyi];
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
