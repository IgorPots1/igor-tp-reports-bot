import { formatCompactCoachDateShort } from "@/features/trainingpeaks/action-execute-telegram-copy";
import {
  detectPlannedVsCompletedAmbiguityHint,
  formatPlannedCompletedAmbiguityTelegramLines,
  inferMoveCandidateWorkoutStatus,
  type PlannedCompletedAmbiguityHint,
} from "@/features/trainingpeaks/action-planned-completed-ambiguity";
import { translateCoachActionTechnicalReason } from "@/features/trainingpeaks/action-list-telegram-copy";

export type CoachDryRunNotificationCandidate = {
  title: string | null;
  type?: string | null;
  plannedDurationSec?: number | null;
  plannedDistance?: number | null;
  startTimeLocal?: string | null;
  rawTextSnippet?: string | null;
  classHint?: string | null;
  selectorHint?: string | null;
  sourceDate?: string | null;
  score?: number | null;
};

export type CoachDryRunFailureNotificationInput = {
  studentName: string;
  route: string;
  dryRunResult: string;
  sourceDate?: string | null;
  canExecuteReasons?: string[];
  candidates?: CoachDryRunNotificationCandidate[];
  plannedVsCompletedHint?: PlannedCompletedAmbiguityHint | null;
};

function formatDurationSecForCoach(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return null;
  }
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function formatDistanceKmForCoach(km: number | null | undefined): string | null {
  if (km === null || km === undefined || !Number.isFinite(km) || km <= 0) {
    return null;
  }
  return `${km.toFixed(2)} km`;
}

function extractTssLabelFromText(text: string | null | undefined): string | null {
  if (!text) {
    return null;
  }
  const hrTss = text.match(/(\d+(?:[.,]\d+)?)\s*hr\s*tss\b/i);
  if (hrTss) {
    return `${hrTss[1].replace(",", ".")} hrTSS`;
  }
  const tss = text.match(/(\d+(?:[.,]\d+)?)\s*tss\b/i);
  if (tss) {
    return `${tss[1].replace(",", ".")} TSS`;
  }
  return null;
}

export function formatCoachDryRunCandidateLine(candidate: CoachDryRunNotificationCandidate): string {
  const title = candidate.title?.trim() || "Без названия";
  const status = inferMoveCandidateWorkoutStatus(candidate);
  const details: string[] = [status];

  const duration =
    formatDurationSecForCoach(candidate.plannedDurationSec) ??
    (candidate.startTimeLocal?.trim() ? candidate.startTimeLocal.trim() : null);
  if (duration) {
    details.push(duration);
  }

  const distance = formatDistanceKmForCoach(candidate.plannedDistance);
  if (distance) {
    details.push(distance);
  }

  const tss = extractTssLabelFromText(candidate.rawTextSnippet);
  if (tss) {
    details.push(tss);
  }

  return `${title} — ${details.join(", ")}`;
}

export function selectCoachDryRunNotificationCandidates(
  candidates: CoachDryRunNotificationCandidate[] | undefined,
  sourceDate: string | null | undefined,
  limit = 2
): CoachDryRunNotificationCandidate[] {
  if (!candidates?.length) {
    return [];
  }

  const filtered = sourceDate ? candidates.filter((candidate) => candidate.sourceDate === sourceDate) : candidates;
  const pool = filtered.length > 0 ? filtered : candidates;

  return [...pool].sort((left, right) => (right.score ?? 0) - (left.score ?? 0)).slice(0, limit);
}

function formatAmbiguousReason(sourceDate: string | null | undefined): string {
  const sourceDateLabel = formatCompactCoachDateShort(sourceDate ?? null);
  if (sourceDateLabel !== "?") {
    return `на ${sourceDateLabel} найдено несколько вариантов.`;
  }
  return "найдено несколько вариантов на исходную дату.";
}

function formatNotFoundReason(sourceDate: string | null | undefined): string {
  const sourceDateLabel = formatCompactCoachDateShort(sourceDate ?? null);
  if (sourceDateLabel !== "?") {
    return `не нашёл подходящую тренировку на ${sourceDateLabel}.`;
  }
  return "не нашёл подходящую тренировку на исходную дату.";
}

function formatTargetConflictReason(targetDate: string | null | undefined): string {
  const targetDateLabel = formatCompactCoachDateShort(targetDate ?? null);
  if (targetDateLabel !== "?") {
    return `на ${targetDateLabel} уже есть тренировка/конфликт.`;
  }
  return "на целевой день уже есть тренировка/конфликт.";
}

function hasTargetConflictReason(reasons: string[] | undefined): boolean {
  if (!reasons?.length) {
    return false;
  }
  return reasons.some((reason) => /target day already has workout|target.?conflict|конфликт/i.test(reason));
}

function formatFailedReason(reasons: string[] | undefined): string | null {
  const firstReason = reasons?.find((reason) => reason.trim())?.trim();
  if (!firstReason) {
    return null;
  }
  const translated = translateCoachActionTechnicalReason(firstReason);
  if (translated !== "нужна ручная проверка") {
    return translated;
  }
  return firstReason;
}

function resolvePlannedVsCompletedHint(input: CoachDryRunFailureNotificationInput): PlannedCompletedAmbiguityHint | null {
  if (input.plannedVsCompletedHint) {
    return input.plannedVsCompletedHint;
  }
  const sourceDate = input.sourceDate ?? null;
  const sourceCandidates = selectCoachDryRunNotificationCandidates(input.candidates, sourceDate, 6);
  return detectPlannedVsCompletedAmbiguityHint({
    dryRunResult: input.dryRunResult,
    plausibleCandidates: sourceCandidates,
    canExecuteReasons: input.canExecuteReasons,
    identityMatchedBy: null,
  });
}

export function buildCoachDryRunFailureNotificationLines(input: CoachDryRunFailureNotificationInput): string[] {
  const lines: string[] = [];
  const sourceDate = input.sourceDate ?? null;

  if (input.dryRunResult === "ambiguous") {
    const plannedVsCompletedHint = resolvePlannedVsCompletedHint(input);
    if (plannedVsCompletedHint) {
      lines.push(`⚠️ Перенос требует выбора. ${input.studentName}: ${input.route}.`);
      lines.push("");
      lines.push(formatAmbiguousReason(sourceDate));
      lines.push(...formatPlannedCompletedAmbiguityTelegramLines(plannedVsCompletedHint));
      lines.push("");
      lines.push("TrainingPeaks не изменён. Открой /tp_actions и подтверди planned тренировку.");
      return lines;
    }

    lines.push(`⚠️ Перенос не выполнен. ${input.studentName}: ${input.route}.`);
    lines.push(`Причина: ${formatAmbiguousReason(sourceDate)} — нужен выбор тренера.`);

    const topCandidates = selectCoachDryRunNotificationCandidates(input.candidates, sourceDate, 2);
    if (topCandidates.length > 0) {
      lines.push("");
      lines.push("Варианты:");
      topCandidates.forEach((candidate, index) => {
        lines.push(`${index + 1}) ${formatCoachDryRunCandidateLine(candidate)}`);
      });
    }

    lines.push("");
    lines.push("TrainingPeaks не изменён. Открой /tp_actions и выбери, что переносить.");
    return lines;
  }

  if (input.dryRunResult === "not_found") {
    lines.push(`⚠️ Перенос не выполнен. ${input.studentName}: ${input.route}.`);
    lines.push(`Причина: ${formatNotFoundReason(sourceDate)}`);
    lines.push("");
    lines.push("TrainingPeaks не изменён. Открой /tp_actions и проверь заявку.");
    return lines;
  }

  if (input.dryRunResult === "failed") {
    lines.push(`⚠️ Перенос не выполнен. ${input.studentName}: ${input.route}.`);
    const failedReason = formatFailedReason(input.canExecuteReasons);
    if (failedReason) {
      lines.push(`Причина: ${failedReason}`);
    }
    lines.push("");
    lines.push("TrainingPeaks не изменён. Проверь заявку в /tp_actions.");
    return lines;
  }

  if (hasTargetConflictReason(input.canExecuteReasons)) {
    lines.push(`⚠️ Перенос не выполнен. ${input.studentName}: ${input.route}.`);
    const targetDate = input.route.includes("→") ? input.route.split("→")[1]?.trim() : null;
    lines.push(`Причина: ${formatTargetConflictReason(targetDate)}`);
    lines.push("");
    lines.push("TrainingPeaks не изменён. Открой /tp_actions и проверь заявку.");
    return lines;
  }

  lines.push(`⚠️ Проверка не пройдена. ${input.studentName}: ${input.route}. Перенос не выполнен.`);
  lines.push("TrainingPeaks не изменён. Проверь заявку в /tp_actions.");
  return lines;
}
