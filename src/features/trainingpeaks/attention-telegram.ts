import type { TrainingPeaksAttentionSnapshot, TrainingPeaksAttentionSignal } from "@/features/trainingpeaks/service";
import {
  escapeTelegramHtml,
  formatAttentionSignalTelegramLine,
} from "@/features/trainingpeaks/telegram-visual-ux";

export const TRAININGPEAKS_ATTENTION_DIGEST_CHUNK_LIMIT = 3500;
export const TELEGRAM_MESSAGE_HARD_LIMIT = 4096;

export const MORNING_DIGEST_SECTION_TITLES = {
  checkToday: "🩺 Проверить сегодня",
  plan: "📅 Учесть в плане",
  pain: "🦵 Травмы / дискомфорт",
  noContact: "📭 Нет контакта",
  missed: "🏃 Нет тренировки / выполнения",
} as const;

/** Per-section visible item caps before an overflow line; long digests split across Telegram messages. */
export const ATTENTION_DIGEST_SECTION_LIMITS = {
  checkToday: 25,
  plan: 25,
  pain: 20,
  noContact: 30,
  missed: 25,
} as const;

type MorningDigestSectionKey = keyof typeof MORNING_DIGEST_SECTION_TITLES;

const CROSS_SECTION_DEDUPE_PRIORITY: MorningDigestSectionKey[] = [
  "pain",
  "checkToday",
  "plan",
  "missed",
  "noContact",
];

const ATTENTION_DIGEST_CONTINUATION_SUFFIX = " — продолжение";

function formatAttentionSignalLine(
  signal: {
    studentName: string | null;
    reason: string;
  },
  options?: { htmlSafe?: boolean }
): string {
  const line = formatAttentionSignalTelegramLine(signal.studentName, signal.reason);
  return options?.htmlSafe ? escapeTelegramHtml(line) : line;
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
    htmlSafe?: boolean;
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
    lines.push(formatAttentionSignalLine(signal, { htmlSafe: options?.htmlSafe }));
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

function attentionSignalDedupeKey(signal: TrainingPeaksAttentionSignal): string {
  const studentKey = signal.studentId?.trim() || signal.studentName?.trim() || "";
  const reasonKey = signal.reason.trim().toLowerCase();
  return `${studentKey}::${reasonKey}`;
}

function dedupeAttentionSignalsAcrossSections(
  sections: Record<MorningDigestSectionKey, TrainingPeaksAttentionSignal[]>
): Record<MorningDigestSectionKey, TrainingPeaksAttentionSignal[]> {
  const seen = new Set<string>();
  const result = {} as Record<MorningDigestSectionKey, TrainingPeaksAttentionSignal[]>;

  for (const key of CROSS_SECTION_DEDUPE_PRIORITY) {
    result[key] = [];
    for (const signal of sections[key]) {
      const dedupeKey = attentionSignalDedupeKey(signal);
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      result[key].push(signal);
    }
  }

  return result;
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

function buildMorningDigestSectionSignals(
  snapshot: TrainingPeaksAttentionSnapshot
): Record<MorningDigestSectionKey, TrainingPeaksAttentionSignal[]> {
  const planSignals = [
    ...snapshot.planConstraintsToday,
    ...snapshot.movesToday,
  ].filter(
    (signal) =>
      !shouldSuppressAttentionLegacyScheduleDuplicate({
        signal,
        allSignals: snapshot.planConstraintsToday,
      })
  );

  return dedupeAttentionSignalsAcrossSections({
    checkToday: [...snapshot.checkTodaySignals, ...snapshot.followUpToday],
    plan: planSignals,
    pain: snapshot.painDiscomfort,
    noContact: snapshot.noContact5Days,
    missed: snapshot.missedWorkouts,
  });
}

function buildAttentionDigestBlocks(
  snapshot: TrainingPeaksAttentionSnapshot,
  title: string,
  options?: { htmlSafe?: boolean }
): string[][] {
  const sections = buildMorningDigestSectionSignals(snapshot);

  const checkToday = buildAttentionSection(MORNING_DIGEST_SECTION_TITLES.checkToday, sections.checkToday, {
    maxItems: ATTENTION_DIGEST_SECTION_LIMITS.checkToday,
    overflowCount: snapshot.followUpOverflowCount,
    htmlSafe: options?.htmlSafe,
  });

  const planConstraints = buildAttentionSection(MORNING_DIGEST_SECTION_TITLES.plan, sections.plan, {
    maxItems: ATTENTION_DIGEST_SECTION_LIMITS.plan,
    overflowCount: snapshot.planConstraintsOverflowCount + snapshot.movesOverflowCount,
    htmlSafe: options?.htmlSafe,
  });

  const pain = buildAttentionSection(MORNING_DIGEST_SECTION_TITLES.pain, sections.pain, {
    maxItems: ATTENTION_DIGEST_SECTION_LIMITS.pain,
    htmlSafe: options?.htmlSafe,
  });

  const noContact = buildAttentionSection(MORNING_DIGEST_SECTION_TITLES.noContact, sections.noContact, {
    maxItems: ATTENTION_DIGEST_SECTION_LIMITS.noContact,
    htmlSafe: options?.htmlSafe,
  });

  const missed = buildAttentionSection(MORNING_DIGEST_SECTION_TITLES.missed, sections.missed, {
    maxItems: ATTENTION_DIGEST_SECTION_LIMITS.missed,
    htmlSafe: options?.htmlSafe,
  });

  return [[title], checkToday, planConstraints, pain, noContact, missed].filter((block) => block.length > 1);
}

function applyAttentionDigestContinuationHeaders(title: string, chunks: string[]): string[] {
  if (chunks.length <= 1) {
    return chunks;
  }

  const continuationTitle = `${title}${ATTENTION_DIGEST_CONTINUATION_SUFFIX}`;
  return chunks.map((chunk, index) => (index === 0 ? chunk : `${continuationTitle}\n\n${chunk}`));
}

export type BuildTrainingPeaksAttentionDigestMessagesOptions = {
  htmlSafe?: boolean;
};

export function buildTrainingPeaksAttentionDigestMessages(
  snapshot: TrainingPeaksAttentionSnapshot,
  title: string,
  chunkLimit = TRAININGPEAKS_ATTENTION_DIGEST_CHUNK_LIMIT,
  options?: BuildTrainingPeaksAttentionDigestMessagesOptions
): string[] {
  const chunks = packAttentionDigestBlocks(
    buildAttentionDigestBlocks(snapshot, title, { htmlSafe: options?.htmlSafe }),
    chunkLimit
  );
  return applyAttentionDigestContinuationHeaders(title, chunks);
}

export function formatTrainingPeaksAttentionSnapshotMessage(
  snapshot: TrainingPeaksAttentionSnapshot,
  title: string,
  options?: BuildTrainingPeaksAttentionDigestMessagesOptions
): string {
  const blocks = buildAttentionDigestBlocks(snapshot, title, { htmlSafe: options?.htmlSafe });
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
