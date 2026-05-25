export type TrainingPeaksMoveSourceInferencePreviewCandidate = {
  workoutId: number;
  workoutDate: string;
  title: string | null;
  score: number;
};

export type TrainingPeaksMoveSourceInferencePreview = {
  trusted: false;
  source: "trainingpeaks_workout_cache";
  strategy: "future_workout_cache_preview";
  candidateCount: number;
  selectedCandidate?: TrainingPeaksMoveSourceInferencePreviewCandidate;
  candidates?: TrainingPeaksMoveSourceInferencePreviewCandidate[];
  reason?: string | null;
  warnings?: string[];
};

export function hasUntrustedMoveSourceInferencePreview(parsedPayload: unknown): boolean {
  if (!parsedPayload || typeof parsedPayload !== "object") {
    return false;
  }

  const preview = (parsedPayload as { sourceInferencePreview?: unknown }).sourceInferencePreview;
  if (!preview || typeof preview !== "object") {
    return false;
  }

  return (preview as { trusted?: unknown }).trusted === false;
}

export function buildMoveSourceInferencePreviewFromCacheCandidates(input: {
  candidates: TrainingPeaksMoveSourceInferencePreviewCandidate[];
}): TrainingPeaksMoveSourceInferencePreview {
  const { candidates } = input;

  if (candidates.length === 0) {
    return {
      trusted: false,
      source: "trainingpeaks_workout_cache",
      strategy: "future_workout_cache_preview",
      candidateCount: 0,
      reason: "unresolved_workout",
      warnings: ["Не удалось подобрать исходную тренировку по кэшу."],
    };
  }

  if (candidates.length === 1) {
    const selectedCandidate = candidates[0]!;
    return {
      trusted: false,
      source: "trainingpeaks_workout_cache",
      strategy: "future_workout_cache_preview",
      candidateCount: 1,
      selectedCandidate,
      candidates: [selectedCandidate],
    };
  }

  return {
    trusted: false,
    source: "trainingpeaks_workout_cache",
    strategy: "future_workout_cache_preview",
    candidateCount: candidates.length,
    candidates: candidates.slice(0, 5),
    reason: "multiple source workout candidates",
    warnings: ["Найдено несколько возможных исходных тренировок — нужна ручная проверка."],
  };
}

function formatPreviewDateRu(isoDate: string): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return isoDate;
  }
  return `${match[3]}.${match[2]}`;
}

export function formatMoveSourceInferencePreviewRu(
  preview: TrainingPeaksMoveSourceInferencePreview | null | undefined
): string | null {
  if (!preview || preview.trusted !== false) {
    return null;
  }

  const selected = preview.selectedCandidate ?? preview.candidates?.[0];
  if (!selected) {
    return null;
  }

  const dateLabel = formatPreviewDateRu(selected.workoutDate);
  const title = selected.title?.trim();
  if (title) {
    return `Вероятный источник: ${dateLabel} — ${title}`;
  }

  return `Вероятный источник: ${dateLabel}`;
}
