import type { TelegramInlineKeyboardMarkup } from "@/features/telegram/types";

export const TP_GWR_CALLBACK_SEND_PREFIX = "tp:gwr:s:";
export const TP_GWR_CALLBACK_EDIT_PREFIX = "tp:gwr:e:";
export const TP_GWR_CALLBACK_REGENERATE_PREFIX = "tp:gwr:r:";
export const TP_GWR_CALLBACK_SKIP_PREFIX = "tp:gwr:k:";

const TELEGRAM_MESSAGE_SOFT_LIMIT = 3900;

export type ParsedGroupWorkoutReportReviewCallback =
  | { kind: "send"; draftIdPrefix: string }
  | { kind: "edit"; draftIdPrefix: string }
  | { kind: "regenerate"; draftIdPrefix: string }
  | { kind: "skip"; draftIdPrefix: string };

export type GroupWorkoutReportReviewCardAnalysis = {
  planActualBullets: string[];
  summaryForCoach: string;
  riskFlags: string[];
  allowedClaims: string[];
  forbiddenClaims: string[];
};

export type FormatGroupWorkoutReportReviewCardInput = {
  studentName: string;
  workoutTitle?: string | null;
  workoutDate: string;
  workoutType: string;
  matchStatus: string;
  matchConfidence: string;
  draftText: string | null;
  draftShortId: string;
  analysis: GroupWorkoutReportReviewCardAnalysis;
  blockedReason?: string | null;
  generationWarnings?: string[];
};

const ALLOWED_CLAIM_LABELS: Record<string, string> = {
  duration: "длительность",
  distance: "дистанцию",
  "average pace": "средний темп",
  "average HR": "средний пульс",
  "max HR": "макс. пульс",
  "planned structure present": "плановую структуру",
  "target pace/HR present": "целевой темп/пульс",
  "coach comments present": "комментарии тренера",
};

const FORBIDDEN_CLAIM_LABELS: Record<string, string> = {
  laps: "laps",
  splits: "splits",
  "interval actuals": "фактические отрезки",
  "per-repeat pace": "темп по повторам",
  "per-repeat HR": "пульс по повторам",
  "repeat execution quality": "качество каждого повтора",
  "отрезки ровные": "«отрезки ровные»",
  "каждый повтор по плану": "«каждый повтор по плану»",
  "interval repeat-level execution claims": "утверждения по каждому повтору",
};

const RISK_FLAG_LABELS: Record<string, string> = {
  pain_or_health_signal_in_report: "сигнал боли/самочувствия в отчёте",
  duration_over_plan: "длительность выше плана",
  workout_significantly_short: "тренировка заметно короче плана",
  workout_match_ambiguous: "неоднозначное сопоставление тренировки",
};

function labelAllowedClaim(claim: string): string {
  return ALLOWED_CLAIM_LABELS[claim] ?? claim;
}

function labelForbiddenClaim(claim: string): string {
  return FORBIDDEN_CLAIM_LABELS[claim] ?? claim;
}

function labelRiskFlag(flag: string): string {
  return RISK_FLAG_LABELS[flag] ?? flag;
}

function pickPlanBullet(bullets: string[]): string {
  const planned = bullets.find((bullet) => /planned/i.test(bullet));
  return planned ?? bullets[0] ?? "нет данных";
}

function pickFactBullet(bullets: string[]): string {
  const completed = bullets.find((bullet) => /completed/i.test(bullet));
  return completed ?? bullets[1] ?? bullets[0] ?? "нет данных";
}

function truncateForTelegram(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function formatGroupWorkoutReportReviewCardText(
  input: FormatGroupWorkoutReportReviewCardInput
): string {
  const workoutLabel = [input.workoutTitle?.trim(), input.workoutDate, input.workoutType]
    .filter((part) => Boolean(part && String(part).trim()))
    .join(" / ");

  const lines: string[] = [
    "📋 Черновик ответа на отчёт",
    "",
    `Ученик: ${input.studentName}`,
    "Источник: общий чат",
    `Тренировка: ${workoutLabel || "не определена"}`,
    `Match: ${input.matchStatus}/${input.matchConfidence}`,
    "",
  ];

  if (input.blockedReason) {
    lines.push(`Автогенерация: заблокирована (${input.blockedReason})`, "");
  }

  if (input.draftText?.trim()) {
    lines.push("Черновик:", input.draftText.trim(), "");
  } else {
    lines.push("Черновик:", "— нет текста для отправки —", "");
  }

  const hasHealthRisk = input.analysis.riskFlags.includes("pain_or_health_signal_in_report");
  if (hasHealthRisk) {
    lines.push("⚠️ Осторожно: в отчёте есть сигнал по самочувствию/боли.", "");
  }

  lines.push(
    "Короткий анализ:",
    `• План: ${pickPlanBullet(input.analysis.planActualBullets)}`,
    `• Факт: ${pickFactBullet(input.analysis.planActualBullets)}`,
    `• Вывод: ${input.analysis.summaryForCoach}`
  );

  if (input.analysis.riskFlags.length > 0) {
    lines.push(`• Риски: ${input.analysis.riskFlags.map(labelRiskFlag).join("; ")}`);
  } else {
    lines.push("• Риски: нет явных флагов");
  }

  lines.push("");
  lines.push("Можно упоминать:");
  if (input.analysis.allowedClaims.length > 0) {
    for (const claim of input.analysis.allowedClaims) {
      lines.push(`• ${labelAllowedClaim(claim)}`);
    }
  } else {
    lines.push("• только общий контекст");
  }

  lines.push("");
  lines.push("Нельзя упоминать:");
  const forbidden = input.analysis.forbiddenClaims.length
    ? input.analysis.forbiddenClaims
    : ["фактические отрезки", "splits/laps", "«каждый повтор по плану»"];
  for (const claim of forbidden.slice(0, 6)) {
    lines.push(`• ${labelForbiddenClaim(claim)}`);
  }

  if (input.generationWarnings && input.generationWarnings.length > 0) {
    lines.push("");
    lines.push("Предупреждения:");
    for (const warning of input.generationWarnings.slice(0, 3)) {
      lines.push(`• ${warning}`);
    }
  }

  lines.push("");
  lines.push(`#${input.draftShortId}`);

  const fullText = lines.join("\n");
  if (fullText.length <= TELEGRAM_MESSAGE_SOFT_LIMIT) {
    return fullText;
  }

  const draftSection = input.draftText?.trim()
    ? ["Черновик:", input.draftText.trim(), ""].join("\n")
    : "Черновик:\n— нет текста для отправки —\n\n";

  const compactTail = [
    "Короткий анализ:",
    `• Вывод: ${truncateForTelegram(input.analysis.summaryForCoach, 240)}`,
    input.analysis.riskFlags.length > 0
      ? `• Риски: ${input.analysis.riskFlags.map(labelRiskFlag).join("; ")}`
      : "• Риски: нет явных флагов",
    "",
    `Можно: ${input.analysis.allowedClaims.map(labelAllowedClaim).join(", ") || "общий контекст"}`,
    `Нельзя: ${forbidden.slice(0, 3).map(labelForbiddenClaim).join(", ")}`,
    "",
    `#${input.draftShortId}`,
  ].join("\n");

  const head = lines.slice(0, 8).join("\n");
  const reserved = head.length + draftSection.length + compactTail.length + 16;
  const analysisBudget = Math.max(120, TELEGRAM_MESSAGE_SOFT_LIMIT - reserved);
  const compactAnalysis = truncateForTelegram(
    [
      `План: ${pickPlanBullet(input.analysis.planActualBullets)}`,
      `Факт: ${pickFactBullet(input.analysis.planActualBullets)}`,
    ].join(" | "),
    analysisBudget
  );

  return [head, draftSection, compactAnalysis, "", compactTail].join("\n");
}

type InlineButton = { text: string; callback_data: string };

function createInlineKeyboardMarkup(rows: InlineButton[][]): TelegramInlineKeyboardMarkup {
  return { inline_keyboard: rows };
}

export function getGroupWorkoutReportReviewCardMarkup(
  draftIdShort: string,
  options?: { includeSend?: boolean }
): TelegramInlineKeyboardMarkup {
  const rows: InlineButton[][] = [];
  if (options?.includeSend !== false) {
    rows.push([
      { text: "✅ Отправить", callback_data: `${TP_GWR_CALLBACK_SEND_PREFIX}${draftIdShort}` },
    ]);
  }
  rows.push([
    { text: "✏️ Редактировать", callback_data: `${TP_GWR_CALLBACK_EDIT_PREFIX}${draftIdShort}` },
    { text: "🔁 Пересобрать", callback_data: `${TP_GWR_CALLBACK_REGENERATE_PREFIX}${draftIdShort}` },
  ]);
  rows.push([{ text: "🙈 Пропустить", callback_data: `${TP_GWR_CALLBACK_SKIP_PREFIX}${draftIdShort}` }]);
  return createInlineKeyboardMarkup(rows);
}

export function parseGroupWorkoutReportReviewCallback(
  data: string | null
): ParsedGroupWorkoutReportReviewCallback | null {
  if (!data) {
    return null;
  }

  if (data.startsWith(TP_GWR_CALLBACK_SEND_PREFIX)) {
    const draftIdPrefix = data.slice(TP_GWR_CALLBACK_SEND_PREFIX.length).trim();
    return draftIdPrefix ? { kind: "send", draftIdPrefix } : null;
  }
  if (data.startsWith(TP_GWR_CALLBACK_EDIT_PREFIX)) {
    const draftIdPrefix = data.slice(TP_GWR_CALLBACK_EDIT_PREFIX.length).trim();
    return draftIdPrefix ? { kind: "edit", draftIdPrefix } : null;
  }
  if (data.startsWith(TP_GWR_CALLBACK_REGENERATE_PREFIX)) {
    const draftIdPrefix = data.slice(TP_GWR_CALLBACK_REGENERATE_PREFIX.length).trim();
    return draftIdPrefix ? { kind: "regenerate", draftIdPrefix } : null;
  }
  if (data.startsWith(TP_GWR_CALLBACK_SKIP_PREFIX)) {
    const draftIdPrefix = data.slice(TP_GWR_CALLBACK_SKIP_PREFIX.length).trim();
    return draftIdPrefix ? { kind: "skip", draftIdPrefix } : null;
  }

  return null;
}

export function extractGroupWorkoutReportDraftShortIdFromCoachText(text: string): string | null {
  const match = text.match(/#([0-9a-f]{8})\b/i);
  if (!match?.[1]) {
    return null;
  }
  return match[1].toLowerCase();
}
