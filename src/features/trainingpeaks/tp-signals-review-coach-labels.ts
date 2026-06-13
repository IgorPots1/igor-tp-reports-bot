import type { TpSignalReviewQueueBucket } from "@/features/trainingpeaks/tp-signals-review-queue-helpers";

const TP_SIGNAL_CATEGORY_LABELS: Record<string, string> = {
  health_pause: "болезнь / пауза",
  pain_injury: "боль / травма",
  plan_constraints: "учесть в плане",
  plan_generation_constraint: "учесть в плане",
  schedule_pause: "перенос / недоступность",
  resume_training: "возврат к тренировкам",
  moves: "перенос",
  health: "болезнь / пауза",
  other: "другое",
};

const TP_SIGNAL_STATE_LABELS: Record<string, string> = {
  active_problem: "Активный вопрос",
  needs_review: "Требует проверки",
  close_candidate: "Кандидат на закрытие",
  monitoring_after_return: "Наблюдение после возвращения",
  stale_needs_review: "Устаревший сигнал, нужна проверка",
};

function capitalizeFirstLetter(text: string): string {
  if (!text) {
    return text;
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function ensureSentenceEnding(text: string): string {
  if (/[.!?…]$/u.test(text.trim())) {
    return text.trim();
  }
  return `${text.trim()}.`;
}

function parseReviewReasonTokens(reason: string): Set<string> {
  const tokens = new Set<string>();
  for (const part of reason.split(";").map((entry) => entry.trim()).filter(Boolean)) {
    tokens.add(part);
    if (part.startsWith("suspected_bug=")) {
      tokens.add("suspected_bug");
    }
    if (part.startsWith("hidden=")) {
      tokens.add("hidden");
    }
    if (part.startsWith("lifecycle_display=")) {
      tokens.add(part);
    }
  }
  return tokens;
}

function isMessyClosePreview(preview: string): boolean {
  return /свежий ответ:|закрыть после проверки|\.{3}/iu.test(preview);
}

export function isTpSignalReviewQueueShowDebugId(): boolean {
  return process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_SHOW_DEBUG_ID?.trim() === "true";
}

export function formatTpSignalCategoryLabel(category: string): string {
  const normalized = category.trim().toLowerCase();
  return TP_SIGNAL_CATEGORY_LABELS[normalized] ?? "другой сигнал";
}

export function formatTpSignalReviewStateLabel(
  state: string | null | undefined,
  bucket: TpSignalReviewQueueBucket
): string {
  const normalized = (state ?? "").trim().toLowerCase();
  if (bucket === "close_candidate_review") {
    return TP_SIGNAL_STATE_LABELS.close_candidate;
  }
  return TP_SIGNAL_STATE_LABELS[normalized] ?? "Требует проверки";
}

export function formatTpSignalReviewWhatHappened(input: {
  bucket: TpSignalReviewQueueBucket;
  category: string;
  sourcePreview?: string | null;
}): string | null {
  const preview = input.sourcePreview?.replace(/\s+/gu, " ").trim();
  if (!preview) {
    if (input.bucket === "close_candidate_review") {
      return "Похоже, проблема уходит / спортсмен возвращается к тренировкам.";
    }
    return null;
  }

  if (input.bucket === "close_candidate_review" && isMessyClosePreview(preview)) {
    if (input.category === "pain_injury" || input.category === "health_pause") {
      return "Похоже, проблема уходит / спортсмен возвращается к тренировкам.";
    }
    return "Похоже, вопрос можно закрыть после быстрой проверки.";
  }

  const colonIndex = preview.indexOf(": ");
  if (colonIndex > 0 && colonIndex < 80) {
    const prefix = preview.slice(0, colonIndex).trim();
    let suffix = preview.slice(colonIndex + 2).trim();
    suffix = suffix.replace(/^(\p{L}+)\s+(\d{2}\.\d{2})\s+была/u, "была $1 $2");
    suffix = suffix.replace(/(?:^|\s—\s)проверить/u, (match) =>
      match.startsWith(" — ") ? " — нужно проверить" : "нужно проверить"
    );
    return ensureSentenceEnding(`${capitalizeFirstLetter(prefix)} ${suffix}`.replace(/\s+/gu, " "));
  }

  return ensureSentenceEnding(capitalizeFirstLetter(preview));
}

export function formatTpSignalReviewQueueReason(input: {
  bucket: TpSignalReviewQueueBucket;
  category: string;
  reason: string;
  lifecycleReason?: string | null;
}): string {
  if (input.bucket === "close_candidate_review") {
    if (input.category === "pain_injury") {
      return "Перед закрытием нужно быстро проверить, что боль не мешает бегу.";
    }
    if (input.category === "health_pause") {
      return "Перед закрытием нужно убедиться, что самочувствие стабильное.";
    }
    return "Похоже, что можно закрыть после проверки.";
  }

  const tokens = parseReviewReasonTokens(input.reason);
  const hasNegativeEvidence = tokens.has("latest_negative_evidence");
  const needsReview =
    tokens.has("recommended_state=needs_review") || tokens.has("recommended_state=stale_needs_review");
  const lowConfidence =
    tokens.has("classifier_confidence=medium") || tokens.has("classifier_confidence=low");
  const ambiguous = tokens.has("ambiguous_or_non_high_confidence_active_signal");

  if (hasNegativeEvidence && needsReview) {
    return "Есть жалоба или неясное самочувствие, нужно решение тренера.";
  }
  if (hasNegativeEvidence) {
    return "Есть жалоба или неясное самочувствие.";
  }
  if (needsReview && lowConfidence) {
    return "Сигнал не до конца однозначный, нужно решение тренера.";
  }
  if (needsReview) {
    return "Нужно решение тренера.";
  }
  if (lowConfidence || ambiguous) {
    return "Сигнал не до конца однозначный, лучше проверить вручную.";
  }
  if (tokens.has("monitoring_after_return")) {
    return "Спортсмен возвращается к тренировкам — стоит проверить самочувствие.";
  }
  if (tokens.has("partial_or_stale_schedule_payload")) {
    return "В расписании есть неясные или устаревшие даты — стоит проверить.";
  }
  if (tokens.has("lifecycle_display=stale_needs_review") || tokens.has("recommended_state=stale_needs_review")) {
    return "Сигнал давно не обновлялся — стоит проверить вручную.";
  }
  if (tokens.has("suspected_bug")) {
    return "Есть нюанс, который лучше проверить вручную.";
  }
  if (/ready_for_coach_close|eligible for coach close/iu.test(input.reason)) {
    return "Похоже, что можно закрыть после проверки.";
  }

  return "Стоит быстро проверить вручную.";
}

export function formatTpSignalReviewDebugIdLine(signalShortId: string): string | null {
  if (!isTpSignalReviewQueueShowDebugId()) {
    return null;
  }
  return `ID: ${signalShortId}`;
}
