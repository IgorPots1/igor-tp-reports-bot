import type { TrainingPeaksAttentionSnapshot } from "@/features/trainingpeaks/service";

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
  }>,
  limit: number
): string[] {
  const lines = [title];
  if (signals.length === 0) {
    lines.push("• Нет");
    return lines;
  }

  const visible = signals.slice(0, limit);
  for (const signal of visible) {
    lines.push(formatAttentionSignalLine(signal));
  }

  if (signals.length > visible.length) {
    lines.push(`• Ещё ${signals.length - visible.length}`);
  }

  return lines;
}

export function formatTrainingPeaksAttentionSnapshotMessage(
  snapshot: TrainingPeaksAttentionSnapshot,
  title: string,
  sectionLimit = 4
): string {
  const urgent = buildAttentionSection("Срочно", snapshot.urgent, sectionLimit);
  const today = buildAttentionSection("Сегодня", snapshot.today, sectionLimit);
  const observe = buildAttentionSection("Наблюдать", snapshot.observe, sectionLimit);

  const hasSignals = snapshot.urgent.length > 0 || snapshot.today.length > 0 || snapshot.observe.length > 0;
  const fyiLines = buildAttentionSection("FYI", snapshot.fyi, sectionLimit);
  if (snapshot.fyi.length === 0 && !hasSignals) {
    fyiLines.splice(1, fyiLines.length - 1, "• Активных сигналов больше нет");
  }

  return [title, "", ...urgent, "", ...today, "", ...observe, "", ...fyiLines].join("\n");
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
