const TELEGRAM_CARD_INDENT = "  ";

export function compactIsoDatesInCoachText(text: string): string {
  return text.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_match, _year, month, day) => `${day}.${month}`);
}

export function splitCoachFacingDenseText(text: string): string[] {
  const normalized = compactIsoDatesInCoachText(text.trim());
  if (!normalized) {
    return [];
  }

  if (normalized.includes("\n")) {
    return normalized
      .split(/\n/u)
      .map((line) => line.trimEnd())
      .filter((line) => line.trim().length > 0);
  }

  const moveMatch = normalized.match(/^кандидат переноса\s+(.+?)\s*→\s*(.+)$/iu);
  if (moveMatch) {
    return ["кандидат переноса", `${moveMatch[1].trim()} → ${moveMatch[2].trim()}`];
  }

  const pauseParenMatch = normalized.match(/^пауза\s*\(([^)]+)\)$/iu);
  if (pauseParenMatch) {
    const range = pauseParenMatch[1].replace(/\s*—\s*/g, "—").trim();
    return [`пауза: ${range}`];
  }

  if (normalized.includes("; ")) {
    return normalized.split("; ").map((part) => part.trim()).filter(Boolean);
  }

  if (normalized.includes(" — ")) {
    return normalized
      .split(" — ")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part, index) => (index === 0 ? capitalizeCoachSentence(part) : part));
  }

  return [normalized];
}

export function capitalizeCoachSentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}

export function expandCoachRunSummaryForDetail(summary: string): string[] {
  const normalized = summary.trim();
  if (!normalized) {
    return ["—"];
  }

  if (normalized.includes(" — ")) {
    return normalized
      .split(" — ")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part, index) => (index === 0 ? capitalizeCoachSentence(part) : part));
  }

  return [capitalizeCoachSentence(normalized)];
}

export function formatTelegramLabeledBlock(label: string, value: string): string[] {
  const valueLines = expandCoachRunSummaryForDetail(value);
  return [`${label}`, ...valueLines, ""];
}

export function formatTelegramBulletCard(name: string, detailLines: string[]): string {
  const details = detailLines
    .filter((line) => line.trim().length > 0)
    .map((line) => `${TELEGRAM_CARD_INDENT}${line}`)
    .join("\n");
  return details.length > 0 ? `• ${name}\n${details}` : `• ${name}`;
}

export function formatTelegramNumberedCard(index: number, name: string, detailLines: string[]): string {
  const details = detailLines
    .filter((line) => line.trim().length > 0)
    .map((line) => `${TELEGRAM_CARD_INDENT}${line}`)
    .join("\n");
  return details.length > 0 ? `${index + 1}. ${name}\n${details}` : `${index + 1}. ${name}`;
}

export function joinTelegramSections(sections: string[]): string {
  const normalized = sections.map((section) => section.trim()).filter(Boolean);
  return normalized.join("\n\n");
}

export function formatOperationalSignalTelegramLine(
  studentName: string,
  signalText: string
): string {
  return formatTelegramBulletCard(studentName, splitCoachFacingDenseText(signalText));
}

export function formatAttentionSignalTelegramLine(studentName: string | null, reason: string): string {
  const name = studentName?.trim();
  const reasonLines = splitCoachFacingDenseText(reason);
  if (name && reasonLines.length > 0) {
    return formatTelegramBulletCard(name, reasonLines);
  }
  if (name) {
    return `• ${name}`;
  }
  return `• ${reasonLines.join("\n  ") || "—"}`;
}
