export type PlannedCompletedAmbiguityCandidate = {
  workoutId: string | null;
  title: string;
  status: "planned" | "completed" | "unknown";
  durationText?: string;
  distanceText?: string;
  tssText?: string;
};

export type PlannedCompletedAmbiguityHint = {
  suggestedSourceCandidate: PlannedCompletedAmbiguityCandidate & {
    reason: "single_planned_vs_completed_candidates";
  };
  otherSourceCandidates: PlannedCompletedAmbiguityCandidate[];
};

export type MoveCandidateStatusInput = {
  title?: string | null;
  type?: string | null;
  plannedDurationSec?: number | null;
  plannedDistance?: number | null;
  startTimeLocal?: string | null;
  rawTextSnippet?: string | null;
  classHint?: string | null;
  selectorHint?: string | null;
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

export function isGenericActivityTitle(title: string | null | undefined): boolean {
  const normalized = (title ?? "").trim().toLowerCase();
  return normalized === "other" || normalized === "activity" || normalized === "workout";
}

export function isNormalWorkoutTitle(title: string | null | undefined): boolean {
  const normalized = (title ?? "").trim();
  if (!normalized || isGenericActivityTitle(normalized)) {
    return false;
  }
  return normalized.length >= 3;
}

export function inferMoveCandidateWorkoutStatus(candidate: MoveCandidateStatusInput): "planned" | "completed" {
  const text = (candidate.rawTextSnippet ?? "").toLowerCase();
  const classHint = (candidate.classHint ?? "").toLowerCase();
  const selectorHint = (candidate.selectorHint ?? "").toLowerCase();

  if (/\b(done|completed|выполнено|завершено|finished|отчет|report|результат)\b/i.test(text)) {
    return "completed";
  }
  if (classHint.includes("completed") || selectorHint.includes(".activity.workout")) {
    return "completed";
  }
  if (/\bhr\s*tss\b/i.test(text)) {
    return "completed";
  }
  if (typeof candidate.plannedDistance === "number" && candidate.plannedDistance > 0) {
    return "completed";
  }
  return "planned";
}

export function buildPlannedCompletedAmbiguityCandidate(input: {
  workoutId?: number | string | null;
  title?: string | null;
  plannedDurationSec?: number | null;
  plannedDistance?: number | null;
  startTimeLocal?: string | null;
  rawTextSnippet?: string | null;
  classHint?: string | null;
  selectorHint?: string | null;
}): PlannedCompletedAmbiguityCandidate {
  const status = inferMoveCandidateWorkoutStatus(input);
  return {
    workoutId:
      input.workoutId === null || input.workoutId === undefined
        ? null
        : String(input.workoutId),
    title: input.title?.trim() || "Без названия",
    status,
    durationText:
      formatDurationSecForCoach(input.plannedDurationSec) ??
      (input.startTimeLocal?.trim() ? input.startTimeLocal.trim() : undefined),
    distanceText: formatDistanceKmForCoach(input.plannedDistance) ?? undefined,
    tssText: extractTssLabelFromText(input.rawTextSnippet) ?? undefined,
  };
}

function formatPlannedCompletedCandidateLine(candidate: PlannedCompletedAmbiguityCandidate): string {
  const details: string[] = [candidate.status];
  if (candidate.durationText) {
    details.push(candidate.durationText);
  }
  if (candidate.distanceText) {
    details.push(candidate.distanceText);
  }
  if (candidate.tssText) {
    details.push(candidate.tssText);
  }
  return `${candidate.title} — ${details.join(", ")}`;
}

function hasTargetConflictReason(canExecuteReasons: string[] | undefined, provenanceWarnings: string[] | undefined): boolean {
  if (canExecuteReasons?.some((reason) => /target day already has workout|target.?conflict|конфликт/i.test(reason))) {
    return true;
  }
  return Boolean(provenanceWarnings?.some((warning) => /target day already has workout/i.test(warning)));
}

function hasBlockingSafetyWarnings(warnings: string[] | undefined): boolean {
  if (!warnings?.length) {
    return false;
  }
  return warnings.some((warning) => /pain|injury|боль|травм/i.test(warning));
}

function isCompletedLikeCandidate(candidate: MoveCandidateStatusInput): boolean {
  if (inferMoveCandidateWorkoutStatus(candidate) !== "completed") {
    return false;
  }
  if (isGenericActivityTitle(candidate.title)) {
    return true;
  }
  const text = (candidate.rawTextSnippet ?? "").toLowerCase();
  return (
    (candidate.selectorHint ?? "").includes(".activity.workout") ||
    typeof candidate.plannedDistance === "number" ||
    /\bhr\s*tss\b/i.test(text)
  );
}

export function detectPlannedVsCompletedAmbiguityHint(input: {
  dryRunResult: string;
  plausibleCandidates: MoveCandidateStatusInput[];
  canExecuteReasons?: string[];
  provenanceWarnings?: string[];
  payloadWarnings?: string[];
  identityMatchedBy?: string | null;
}): PlannedCompletedAmbiguityHint | null {
  if (input.dryRunResult !== "ambiguous") {
    return null;
  }
  if (input.identityMatchedBy === "mismatch") {
    return null;
  }
  if (hasTargetConflictReason(input.canExecuteReasons, input.provenanceWarnings)) {
    return null;
  }
  if (hasBlockingSafetyWarnings(input.payloadWarnings)) {
    return null;
  }
  if (input.plausibleCandidates.length < 2) {
    return null;
  }

  const plannedCandidates = input.plausibleCandidates.filter(
    (candidate) =>
      inferMoveCandidateWorkoutStatus(candidate) === "planned" && isNormalWorkoutTitle(candidate.title)
  );
  const completedCandidates = input.plausibleCandidates.filter((candidate) => isCompletedLikeCandidate(candidate));

  if (plannedCandidates.length !== 1 || completedCandidates.length < 1) {
    return null;
  }

  const planned = plannedCandidates[0]!;
  const suggested = buildPlannedCompletedAmbiguityCandidate(planned);
  const others = completedCandidates.map((candidate) => buildPlannedCompletedAmbiguityCandidate(candidate));

  return {
    suggestedSourceCandidate: {
      ...suggested,
      reason: "single_planned_vs_completed_candidates",
    },
    otherSourceCandidates: others,
  };
}

export function extractPlannedVsCompletedHintFromLogJson(logJson: unknown): PlannedCompletedAmbiguityHint | null {
  if (!logJson || typeof logJson !== "object") {
    return null;
  }
  const payload = logJson as {
    plannedVsCompletedHint?: PlannedCompletedAmbiguityHint | null;
  };
  const hint = payload.plannedVsCompletedHint;
  if (!hint?.suggestedSourceCandidate?.workoutId) {
    return null;
  }
  return hint;
}

export function isEligibleForCoachSourceWorkoutConfirmation(logJson: unknown): boolean {
  const hint = extractPlannedVsCompletedHintFromLogJson(logJson);
  if (!hint) {
    return false;
  }
  if (!logJson || typeof logJson !== "object") {
    return false;
  }
  const payload = logJson as {
    dryRunResult?: unknown;
    canExecute?: unknown;
    identityCheck?: { matchedBy?: unknown } | null;
  };
  if (payload.dryRunResult !== "ambiguous") {
    return false;
  }
  if (payload.canExecute === true) {
    return false;
  }
  const identityMatchedBy =
    typeof payload.identityCheck?.matchedBy === "string" ? payload.identityCheck.matchedBy : null;
  return identityMatchedBy !== "mismatch";
}

export function formatPlannedCompletedAmbiguityTelegramLines(hint: PlannedCompletedAmbiguityHint): string[] {
  const lines: string[] = [];
  lines.push("");
  lines.push("Похоже, нужно перенести:");
  lines.push(formatPlannedCompletedCandidateLine(hint.suggestedSourceCandidate));
  if (hint.otherSourceCandidates.length > 0) {
    lines.push("");
    lines.push("Также найдено:");
    for (const candidate of hint.otherSourceCandidates.slice(0, 2)) {
      lines.push(formatPlannedCompletedCandidateLine(candidate));
    }
  }
  return lines;
}

export function formatPlannedCompletedAmbiguityActionDetailLines(hint: PlannedCompletedAmbiguityHint): string[] {
  const suggested = hint.suggestedSourceCandidate;
  const details: string[] = [];
  if (suggested.durationText) {
    details.push(suggested.durationText);
  }
  if (suggested.tssText) {
    details.push(suggested.tssText);
  }
  const detailSuffix = details.length > 0 ? ` — ${details.join(", ")}` : "";
  return [
    "Рекомендация:",
    `Похоже, нужно перенести planned тренировку:`,
    `${suggested.title}${detailSuffix}`,
    "",
    "Почему:",
    "на этот день также есть completed Other, поэтому без подтверждения TP не меняем.",
  ];
}

export function truncateWorkoutTitleForButton(title: string, maxLength = 24): string {
  const normalized = title.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}
