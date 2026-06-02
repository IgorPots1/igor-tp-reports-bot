import type { TrainingPeaksAttentionSnapshot } from "@/features/trainingpeaks/service";
import { formatAttentionSignalTelegramLine } from "@/features/trainingpeaks/telegram-visual-ux";

export const TRAININGPEAKS_ATTENTION_DIGEST_CHUNK_LIMIT = 3500;

/** Per-section visible item caps before an overflow line; long digests split across Telegram messages. */
export const ATTENTION_DIGEST_SECTION_LIMITS = {
  urgent: 20,
  today: 25,
  followUp: 20,
  plan: 20,
  moves: 20,
  observe: 20,
  noContact: 30,
  fyi: 10,
} as const;

const ATTENTION_DIGEST_CONTINUATION_SUFFIX = " — продолжение";

function formatAttentionSignalLine(signal: {
  studentName: string | null;
  reason: string;
}): string {
  return formatAttentionSignalTelegramLine(signal.studentName, signal.reason);
}

function buildAttentionSection(
  title: string,
  signals: Array<{
    studentName: string | null;
    reason: string;
  }>,
  options?: {
    maxItems?: number;
    overflowCount?: number;
  }
): string[] {
  const lines = [title];
  const maxItems = options?.maxItems;
  const explicitOverflow = options?.overflowCount ?? 0;
  const visibleSignals =
    typeof maxItems === "number" && maxItems >= 0 ? signals.slice(0, maxItems) : [...signals];
  const hiddenBySectionLimit =
    typeof maxItems === "number" && maxItems >= 0 ? Math.max(0, signals.length - maxItems) : 0;
  const totalOverflow = explicitOverflow + hiddenBySectionLimit;

  if (visibleSignals.length === 0 && totalOverflow === 0) {
    return lines;
  }

  lines.push("");

  for (const signal of visibleSignals) {
    lines.push(formatAttentionSignalLine(signal));
  }

  if (totalOverflow > 0) {
    lines.push(`• +${totalOverflow} ещё`);
  }

  return lines;
}

function hasRichScheduleDisplayText(text: string): boolean {
  return text.split("; ").some(
    (part) => part.startsWith("доступна:") || part.startsWith("недоступна:") || part.startsWith("учесть в плане:")
  );
}

function shouldSuppressAttentionLegacyScheduleDuplicate(input: {
  signal: {
    studentId?: string | null;
    reason: string;
    signalKind?: string;
  };
  allSignals: Array<{
    studentId?: string | null;
    reason: string;
    signalKind?: string;
  }>;
}): boolean {
  const { signal, allSignals } = input;
  if (signal.signalKind !== "operational_schedule") {
    return false;
  }
  if (signal.reason !== "недоступность") {
    return false;
  }
  return allSignals.some((candidate) => {
    if (candidate === signal) {
      return false;
    }
    if (candidate.signalKind !== "operational_schedule") {
      return false;
    }
    if ((candidate.studentId ?? null) !== (signal.studentId ?? null)) {
      return false;
    }
    return hasRichScheduleDisplayText(candidate.reason);
  });
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
      current = [header, "", item];
      currentLength = header.length + 2 + item.length;
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
  const urgent = buildAttentionSection("🚨 Срочно", snapshot.urgent, {
    maxItems: ATTENTION_DIGEST_SECTION_LIMITS.urgent,
  });
  const today = buildAttentionSection("📌 Сегодня", snapshot.today, {
    maxItems: ATTENTION_DIGEST_SECTION_LIMITS.today,
  });
  const observe = buildAttentionSection("👀 Наблюдать", snapshot.observe, {
    maxItems: ATTENTION_DIGEST_SECTION_LIMITS.observe,
  });

  const hasSignals =
    snapshot.urgent.length > 0 ||
    snapshot.today.length > 0 ||
    snapshot.observe.length > 0 ||
    snapshot.noContact5Days.length > 0;
  const fyi = buildAttentionSection("ℹ️ Справочно", snapshot.fyi, {
    maxItems: ATTENTION_DIGEST_SECTION_LIMITS.fyi,
  });
  if (snapshot.fyi.length === 0 && !hasSignals) {
    fyi.splice(1, fyi.length - 1, "", "• Активных сигналов больше нет");
  }

  const followUps = buildAttentionSection("Проверить сегодня", snapshot.followUpToday, {
    maxItems: ATTENTION_DIGEST_SECTION_LIMITS.followUp,
    overflowCount: snapshot.followUpOverflowCount,
  });

  const planConstraintsSignals = snapshot.planConstraintsToday.filter(
    (signal) =>
      !shouldSuppressAttentionLegacyScheduleDuplicate({
        signal,
        allSignals: snapshot.planConstraintsToday,
      })
  );
  const planConstraints = buildAttentionSection("📅 Учесть в плане", planConstraintsSignals, {
    maxItems: ATTENTION_DIGEST_SECTION_LIMITS.plan,
    overflowCount: snapshot.planConstraintsOverflowCount,
  });

  const moves = buildAttentionSection("🔁 Переносы", snapshot.movesToday, {
    maxItems: ATTENTION_DIGEST_SECTION_LIMITS.moves,
    overflowCount: snapshot.movesOverflowCount,
  });

  const noContact = buildAttentionSection("📭 Нет контакта 5+ дней", snapshot.noContact5Days, {
    maxItems: ATTENTION_DIGEST_SECTION_LIMITS.noContact,
  });

  return [[title], urgent, today, followUps, planConstraints, moves, observe, noContact, fyi].filter(
    (block) => block.length > 1
  );
}

function applyAttentionDigestContinuationHeaders(title: string, chunks: string[]): string[] {
  if (chunks.length <= 1) {
    return chunks;
  }

  const continuationTitle = `${title}${ATTENTION_DIGEST_CONTINUATION_SUFFIX}`;
  return chunks.map((chunk, index) => (index === 0 ? chunk : `${continuationTitle}\n\n${chunk}`));
}

export function buildTrainingPeaksAttentionDigestMessages(
  snapshot: TrainingPeaksAttentionSnapshot,
  title: string,
  chunkLimit = TRAININGPEAKS_ATTENTION_DIGEST_CHUNK_LIMIT
): string[] {
  const chunks = packAttentionDigestBlocks(buildAttentionDigestBlocks(snapshot, title), chunkLimit);
  return applyAttentionDigestContinuationHeaders(title, chunks);
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
