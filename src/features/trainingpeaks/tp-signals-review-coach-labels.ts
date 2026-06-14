import type { TpSignalExplainRecord } from "@/features/trainingpeaks/tp-signals-explain-helpers";
import type { TpSignalReviewQueueBucket } from "@/features/trainingpeaks/tp-signals-review-queue-helpers";

const TP_SIGNAL_CATEGORY_LABELS: Record<string, string> = {
  health_pause: "болезнь / пауза",
  pain_injury: "боль / травма",
  plan_constraints: "учесть в плане",
  plan_generation_constraint: "учесть в плане",
  schedule_pause: "перенос / недоступность",
  schedule: "перенос / недоступность",
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

const WEAK_DISPLAY_SUMMARY_PATTERNS = [
  /^учесть в плане$/iu,
  /^контекст: полный текст недоступен/iu,
  /^стоит быстро проверить/iu,
  /^требует проверки$/iu,
  /^активный вопрос$/iu,
  /^кандидат переноса\s*—\s*→\s*—/iu,
] as const;

const TECHNICAL_LABEL_PATTERN =
  /health_pause|pain_injury|plan_generation_constraint|classifier_confidence|recommended_state|latest_negative_evidence|active_problem|needs_review|hidden=/iu;

export type TpSignalReviewContextSource =
  | "display_summary"
  | "payload"
  | "source_observation"
  | "fallback_missing";

export type TpSignalReviewCardContext = {
  text: string;
  source: TpSignalReviewContextSource;
  hasContext: boolean;
};

export const TP_SIGNAL_REVIEW_CONTEXT_FALLBACK =
  "Не удалось восстановить детали сигнала — лучше проверить источник вручную.";

const CONTEXT_PREVIEW_MAX_LENGTH = 220;

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

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function cleanObservationPreview(text: string): string {
  const cleaned = normalizeWhitespace(text)
    .replace(/@[\w]+/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (cleaned.length <= CONTEXT_PREVIEW_MAX_LENGTH) {
    return cleaned;
  }
  return `${cleaned.slice(0, CONTEXT_PREVIEW_MAX_LENGTH - 1)}…`;
}

function formatIsoDateShort(value: string | null | undefined): string | null {
  if (!value?.trim()) {
    return null;
  }
  const trimmed = value.trim();
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/u);
  if (isoMatch) {
    return `${isoMatch[3]}.${isoMatch[2]}`;
  }
  const dottedMatch = trimmed.match(/^(\d{2})\.(\d{2})/u);
  if (dottedMatch) {
    return `${dottedMatch[1]}.${dottedMatch[2]}`;
  }
  return trimmed;
}

function isWeakDisplaySummary(text: string | null | undefined): boolean {
  const normalized = normalizeWhitespace(text ?? "");
  if (!normalized) {
    return true;
  }
  if (TECHNICAL_LABEL_PATTERN.test(normalized)) {
    return true;
  }
  for (const pattern of WEAK_DISPLAY_SUMMARY_PATTERNS) {
    if (pattern.test(normalized)) {
      return true;
    }
  }
  return normalized.length < 8;
}

function formatDisplaySummaryContext(preview: string): string {
  const normalized = normalizeWhitespace(preview);
  if (isMessyClosePreview(normalized)) {
    return normalized;
  }

  const colonIndex = normalized.indexOf(": ");
  if (colonIndex > 0 && colonIndex < 80) {
    const prefix = normalized.slice(0, colonIndex).trim();
    let suffix = normalized.slice(colonIndex + 2).trim();
    suffix = suffix.replace(/^(\p{L}+)\s+(\d{2}\.\d{2})\s+была/u, "была $1 $2");
    suffix = suffix.replace(/(?:^|\s—\s)проверить/u, (match) =>
      match.startsWith(" — ") ? " — нужно проверить" : "нужно проверить"
    );
    return ensureSentenceEnding(`${capitalizeFirstLetter(prefix)} ${suffix}`.replace(/\s+/gu, " "));
  }

  return ensureSentenceEnding(capitalizeFirstLetter(normalized));
}

function resolveSourceObservationSnippet(
  explainRecord: Pick<TpSignalExplainRecord, "source_snippets"> | null | undefined
): string | null {
  for (const snippet of explainRecord?.source_snippets ?? []) {
    const cleaned = cleanObservationPreview(snippet);
    if (!cleaned || isWeakDisplaySummary(cleaned)) {
      continue;
    }
    return cleaned;
  }
  return null;
}

function buildCloseCandidateContext(input: {
  category: string;
  preview: string | null;
  explainRecord:
    | Pick<
        TpSignalExplainRecord,
        "latest_positive_evidence" | "latest_negative_evidence" | "source_snippets"
      >
    | null
    | undefined;
}): TpSignalReviewCardContext | null {
  const positiveEvidence = input.explainRecord?.latest_positive_evidence?.find(
    (entry) => entry && !isWeakDisplaySummary(entry)
  );
  const hasNoNewComplaints =
    /новых жалоб нет|самочувствие нормализ|всё ок|все ок|лёгкий выход|легкий выход|чистая пробежка|чистый выход/iu.test(
      [positiveEvidence, input.preview, input.explainRecord?.source_snippets.join(" ")].filter(Boolean).join(" ")
    );

  if (hasNoNewComplaints) {
    if (/после болезни|после орви|после простуды/iu.test(positiveEvidence ?? input.preview ?? "")) {
      return {
        text: "После болезни был лёгкий выход, новых жалоб нет — можно закрыть после проверки.",
        source: positiveEvidence ? "display_summary" : "source_observation",
        hasContext: true,
      };
    }
    return {
      text: "После болезни был лёгкий выход, новых жалоб нет — можно закрыть после проверки.",
      source: "display_summary",
      hasContext: true,
    };
  }

  if (input.preview && !isWeakDisplaySummary(input.preview) && !isMessyClosePreview(input.preview)) {
    return {
      text: formatDisplaySummaryContext(input.preview),
      source: "display_summary",
      hasContext: true,
    };
  }

  const sourceObservation = resolveSourceObservationSnippet(input.explainRecord);
  if (sourceObservation) {
    return {
      text: `Исходное сообщение: «${sourceObservation}».`,
      source: "source_observation",
      hasContext: true,
    };
  }

  if (input.category === "pain_injury" || input.category === "health_pause" || input.category === "health") {
    return {
      text: "Похоже, проблема уходит / спортсмен возвращается к тренировкам.",
      source: "display_summary",
      hasContext: true,
    };
  }

  return {
    text: "Похоже, вопрос можно закрыть после быстрой проверки.",
    source: "display_summary",
    hasContext: true,
  };
}

function buildMoveContext(input: {
  preview: string | null;
  explainRecord: Pick<TpSignalExplainRecord, "normalized_dates"> | null | undefined;
}): TpSignalReviewCardContext | null {
  const { source_date: sourceDate, target_date: targetDate } = input.explainRecord?.normalized_dates ?? {
    source_date: null,
    target_date: null,
  };
  const sourceShort = formatIsoDateShort(sourceDate);
  const targetShort = formatIsoDateShort(targetDate);

  if (sourceShort && targetShort) {
    return {
      text: `Кандидат переноса: ${sourceShort} → ${targetShort}.`,
      source: "payload",
      hasContext: true,
    };
  }

  if (input.preview && /кандидат переноса/iu.test(input.preview) && !/—\s*→\s*—/u.test(input.preview)) {
    return {
      text: formatDisplaySummaryContext(input.preview),
      source: "display_summary",
      hasContext: true,
    };
  }

  if (/—\s*→\s*—/u.test(input.preview ?? "")) {
    return {
      text: "Кандидат переноса без понятных дат — нужно проверить источник.",
      source: "display_summary",
      hasContext: true,
    };
  }

  return null;
}

function buildPlanOrScheduleContext(input: {
  preview: string | null;
  explainRecord: Pick<TpSignalExplainRecord, "normalized_dates"> | null | undefined;
}): TpSignalReviewCardContext | null {
  const unavailableDates = input.explainRecord?.normalized_dates.unavailable_dates ?? [];
  if (unavailableDates.length === 1) {
    return {
      text: `Ограничение по плану: недоступна ${unavailableDates[0]}.`,
      source: "payload",
      hasContext: true,
    };
  }

  const validUntil = input.explainRecord?.normalized_dates.valid_until;
  if (validUntil && isWeakDisplaySummary(input.preview)) {
    return {
      text: `Ограничение по плану: недоступна ${validUntil}.`,
      source: "payload",
      hasContext: true,
    };
  }

  if (input.preview && !isWeakDisplaySummary(input.preview)) {
    const formatted = formatDisplaySummaryContext(input.preview);
    if (/не может|недоступ|занят|уезжает|перенос|альтернатив/iu.test(formatted)) {
      return {
        text: formatted,
        source: "display_summary",
        hasContext: true,
      };
    }
    return {
      text: formatted,
      source: "display_summary",
      hasContext: true,
    };
  }

  return null;
}

function buildHealthOrPainContext(input: {
  category: string;
  preview: string | null;
  explainRecord:
    | Pick<TpSignalExplainRecord, "source_snippets" | "latest_negative_evidence">
    | null
    | undefined;
}): TpSignalReviewCardContext | null {
  if (input.preview && !isWeakDisplaySummary(input.preview)) {
    const formatted = formatDisplaySummaryContext(input.preview);
    if (input.category === "pain_injury" && /уточнить/iu.test(formatted) && !/мешает/iu.test(formatted)) {
      return {
        text: ensureSentenceEnding(formatted.replace(/уточнить/iu, "уточнить, болит ли сейчас и мешает ли тренировкам")),
        source: "display_summary",
        hasContext: true,
      };
    }
    if (/болеет|кашель|горло|простуд|орви/iu.test(formatted)) {
      const withClarification = /уточнить/iu.test(formatted)
        ? formatted
        : `${formatted} — уточнить текущее самочувствие`;
      return {
        text: ensureSentenceEnding(capitalizeFirstLetter(withClarification)),
        source: "display_summary",
        hasContext: true,
      };
    }
    return {
      text: formatted,
      source: "display_summary",
      hasContext: true,
    };
  }

  const negativeEvidence = input.explainRecord?.latest_negative_evidence?.find(
    (entry) => entry && !isWeakDisplaySummary(entry)
  );
  if (negativeEvidence) {
    return {
      text: formatDisplaySummaryContext(negativeEvidence),
      source: "source_observation",
      hasContext: true,
    };
  }

  const sourceObservation = resolveSourceObservationSnippet(input.explainRecord);
  if (sourceObservation) {
    return {
      text: `Исходное сообщение: «${sourceObservation}».`,
      source: "source_observation",
      hasContext: true,
    };
  }

  return null;
}

export function isTpSignalReviewQueueShowDebugId(): boolean {
  return process.env.TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_SHOW_DEBUG_ID?.trim() === "true";
}

export function formatTpSignalCategoryLabel(category: string): string {
  const normalized = category.trim().toLowerCase();
  return TP_SIGNAL_CATEGORY_LABELS[normalized] ?? "другое";
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

export function resolveTpSignalReviewCardContext(input: {
  bucket: TpSignalReviewQueueBucket;
  category: string;
  signalType: string;
  preview?: string | null;
  explainRecord?: Pick<
    TpSignalExplainRecord,
    | "normalized_dates"
    | "source_snippets"
    | "latest_positive_evidence"
    | "latest_negative_evidence"
    | "visible_output"
  > | null;
}): TpSignalReviewCardContext {
  const preview = normalizeWhitespace(input.preview ?? input.explainRecord?.visible_output ?? "");

  if (input.bucket === "close_candidate_review") {
    const closeContext = buildCloseCandidateContext({
      category: input.category,
      preview: preview || null,
      explainRecord: input.explainRecord,
    });
    if (closeContext) {
      return closeContext;
    }
  }

  if (input.signalType === "move_workout_candidate" || input.category === "moves") {
    const moveContext = buildMoveContext({
      preview: preview || null,
      explainRecord: input.explainRecord,
    });
    if (moveContext) {
      return moveContext;
    }
  }

  const isPlanOrSchedule =
    input.signalType === "plan_generation_constraint" ||
    input.signalType === "schedule_unavailability_window" ||
    input.signalType === "schedule_availability_window" ||
    input.category === "plan_constraints" ||
    input.category === "schedule" ||
    input.category === "schedule_pause";

  if (isPlanOrSchedule) {
    const planContext = buildPlanOrScheduleContext({
      preview: preview || null,
      explainRecord: input.explainRecord,
    });
    if (planContext) {
      return planContext;
    }
  }

  const isHealthOrPain =
    input.category === "health_pause" ||
    input.category === "health" ||
    input.category === "pain_injury" ||
    input.signalType === "health_issue_started" ||
    input.signalType === "health_issue_improving" ||
    input.signalType === "pause_training" ||
    input.signalType === "pain_injury";

  if (isHealthOrPain) {
    const healthContext = buildHealthOrPainContext({
      category: input.category,
      preview: preview || null,
      explainRecord: input.explainRecord,
    });
    if (healthContext) {
      return healthContext;
    }
  }

  if (preview && !isWeakDisplaySummary(preview)) {
    return {
      text: formatDisplaySummaryContext(preview),
      source: "display_summary",
      hasContext: true,
    };
  }

  const sourceObservation = resolveSourceObservationSnippet(input.explainRecord);
  if (sourceObservation) {
    return {
      text: `Исходное сообщение: «${sourceObservation}».`,
      source: "source_observation",
      hasContext: true,
    };
  }

  return {
    text: TP_SIGNAL_REVIEW_CONTEXT_FALLBACK,
    source: "fallback_missing",
    hasContext: false,
  };
}

export function formatTpSignalReviewWhatHappened(input: {
  bucket: TpSignalReviewQueueBucket;
  category: string;
  signalType?: string;
  sourcePreview?: string | null;
  explainRecord?: Pick<
    TpSignalExplainRecord,
    | "normalized_dates"
    | "source_snippets"
    | "latest_positive_evidence"
    | "latest_negative_evidence"
    | "visible_output"
  > | null;
}): string {
  return resolveTpSignalReviewCardContext({
    bucket: input.bucket,
    category: input.category,
    signalType: input.signalType ?? input.category,
    preview: input.sourcePreview,
    explainRecord: input.explainRecord,
  }).text;
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
