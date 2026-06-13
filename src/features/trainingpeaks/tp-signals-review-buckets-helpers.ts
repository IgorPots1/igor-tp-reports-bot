import {
  classifyCoachOperationalSignal,
  hasAthleteCoIllnessCue,
  hasFamilyMemberIllnessCue,
  hasScheduleContextCue,
  isCompletedRunReflectionNotScheduleConstraint,
  isFamilyMemberIllnessOnlyContext,
  isNonTrainingAdministrativeIntentText,
  isWeatherOrTemperatureSoftContextText,
} from "@/features/trainingpeaks/coach-operational-signals";
import {
  buildObservationLikeFromContextObservation,
  inferFalsePositiveSuppressionReason,
} from "@/features/trainingpeaks/operational-signal-false-positive-suppression";
import {
  simulateObservationPersistenceOutcome,
  type ObservationPersistenceSimulation,
} from "@/features/trainingpeaks/operational-signals-inline";
import { getSignalMetadataString } from "@/features/trainingpeaks/operational-schedule-display";
import { hasPartialStaleScheduleDates } from "@/features/trainingpeaks/tp-signals-persisted-cleanup";
import {
  buildTpSignalExplainRecord,
  type TpSignalExplainRecord,
} from "@/features/trainingpeaks/tp-signals-explain-helpers";
import type {
  TrainingPeaksStudentOperationalSignal,
  TrainingPeaksTelegramContextObservation,
} from "@/features/trainingpeaks/repository";
import type {
  TrainingPeaksOperationalSignalDisplayEvidence,
  TrainingPeaksOperationalSignalsItem,
} from "@/features/trainingpeaks/service";

export type ReviewBucketName =
  | "obvious_auto_record"
  | "review_required"
  | "close_candidate_review"
  | "silent_skip_with_cues";

export type OperationalCueFamily =
  | "illness"
  | "pain"
  | "schedule"
  | "resume"
  | "plan_constraint"
  | "pause"
  | "move"
  | "other";

export type ActiveSignalReviewBucketItem = {
  bucket: Exclude<ReviewBucketName, "silent_skip_with_cues">;
  studentName: string;
  studentId: string;
  signalId: string;
  signalType: string;
  category: string;
  state: string;
  reason: string;
  sourceObservationId: string | null;
  preview: string;
  classifierConfidence: string | null;
  visible: boolean;
  suspectedBugClass: string | null;
  explainRecord: TpSignalExplainRecord;
};

export type SilentSkipReviewBucketItem = {
  bucket: "silent_skip_with_cues";
  studentName: string;
  studentId: string;
  observationId: string;
  observedAt: string;
  candidateFamily: OperationalCueFamily;
  skipReason: string;
  cueEvidence: string[];
  rawPreview: string;
  diagnosticNote: string;
  simulation: ObservationPersistenceSimulation;
};

export type SilentSkipDiagnosticSubBucket =
  | "review_candidate_health"
  | "review_candidate_schedule_or_move"
  | "review_candidate_mixed_health_schedule"
  | "ambiguous_review_candidate"
  | "soft_context_ok_to_skip"
  | "negated_symptom_ok_to_skip"
  | "coach_question_ok_to_skip"
  | "figurative_or_non_training_ok_to_skip"
  | "non_training_operational_ok_to_skip";

export type SilentSkipSuppressionReason = Exclude<
  SilentSkipDiagnosticSubBucket,
  | "review_candidate_health"
  | "review_candidate_schedule_or_move"
  | "review_candidate_mixed_health_schedule"
  | "ambiguous_review_candidate"
>;

export type ClassifiedSilentSkipReviewBucketItem = SilentSkipReviewBucketItem & {
  diagnosticSubBucket: SilentSkipDiagnosticSubBucket;
  suppressFromCandidateSurfacing: boolean;
  classificationNote: string;
};

export type SilentSkipClassificationSummary = {
  rawWithCuesCount: number;
  retainedCandidateCount: number;
  suppressedNoiseCount: number;
  suppressedByReason: Record<SilentSkipSuppressionReason, number>;
  retainedCandidates: ClassifiedSilentSkipReviewBucketItem[];
  suppressedRows: ClassifiedSilentSkipReviewBucketItem[];
};

const ILLNESS_TEXT_CUES = [
  "болею",
  "заболел",
  "заболела",
  "простуд",
  "орви",
  "температур",
  "кашель",
  "голова круж",
  "сон клонит",
  "недомога",
] as const;

const RESUME_TEXT_CUES = [
  "возобновляю тренировки",
  "возвращаюсь к тренировкам",
  "возвращаюсь к бегу",
  "начинаются тренировки",
  "готов к тренировкам",
  "готова к тренировкам",
  "я в строю",
  "в строю",
] as const;

const PAIN_TEXT_CUES = [
  "болит",
  "боль ",
  "болью",
  "травм",
  "ушиб",
  "надкостниц",
  "голен",
  "колен",
  "ахилл",
  "спин",
] as const;

const SCHEDULE_RESTRICTION_CUES = [
  "не побегу",
  "не смогу побегать",
  "не могу побегать",
  "не успеваю",
  "не может",
  "не буду бегать",
  "беру паузу",
] as const;

const PLAN_CONSTRAINT_CUES = ["не успеваю", "конфликт", "работ", "командиров"] as const;

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").toLocaleLowerCase("ru").replace(/ё/gu, "е").replace(/\s+/gu, " ").trim();
}

function hasAnyCue(text: string, cues: readonly string[]): boolean {
  const normalized = normalizeText(text);
  return cues.some((cue) => normalized.includes(cue));
}

function hasExplicitScheduleRestriction(text: string): boolean {
  const normalized = normalizeText(text);
  return hasAnyCue(normalized, SCHEDULE_RESTRICTION_CUES);
}

export function mapSignalTypeToCueFamily(signalType: string | null | undefined): OperationalCueFamily {
  switch (signalType) {
    case "health_issue_started":
    case "health_issue_improving":
    case "health_issue_resolved":
    case "pause_training":
      return "illness";
    case "pain_injury":
      return "pain";
    case "schedule_unavailability_window":
    case "schedule_availability_window":
      return "schedule";
    case "resume_training":
      return "resume";
    case "plan_generation_constraint":
      return "plan_constraint";
    case "move_workout_candidate":
      return "move";
    default:
      return "other";
  }
}

export function detectOperationalCueFamilies(text: string | null): {
  families: OperationalCueFamily[];
  evidence: string[];
} {
  const normalized = normalizeText(text);
  if (!normalized) {
    return { families: [], evidence: [] };
  }

  const families = new Set<OperationalCueFamily>();
  const evidence: string[] = [];

  if (hasAthleteCoIllnessCue(normalized) || hasAnyCue(normalized, ILLNESS_TEXT_CUES) || (hasFamilyMemberIllnessCue(normalized) && !isFamilyMemberIllnessOnlyContext(normalized))) {
    families.add("illness");
    evidence.push("illness/health cue in text");
  }
  if (hasAnyCue(normalized, PAIN_TEXT_CUES)) {
    families.add("pain");
    evidence.push("pain/injury cue in text");
  }
  if (hasExplicitScheduleRestriction(normalized) || (hasScheduleContextCue(normalized) && hasAnyCue(normalized, SCHEDULE_RESTRICTION_CUES))) {
    families.add("schedule");
    evidence.push("schedule/unavailability cue in text");
  }
  if (hasAnyCue(normalized, RESUME_TEXT_CUES)) {
    families.add("resume");
    evidence.push("resume/return cue in text");
  }
  if (hasAnyCue(normalized, PLAN_CONSTRAINT_CUES) && (hasScheduleContextCue(normalized) || hasExplicitScheduleRestriction(normalized))) {
    families.add("plan_constraint");
    evidence.push("plan-impact cue with schedule context");
  }

  return { families: [...families], evidence };
}

function shouldExcludeSilentSkipText(text: string | null): { exclude: boolean; reason: string | null } {
  const normalized = normalizeText(text);
  if (!normalized) {
    return { exclude: true, reason: "empty_text" };
  }
  if (isNonTrainingAdministrativeIntentText(normalized)) {
    const cues = detectOperationalCueFamilies(normalized);
    if (cues.families.length === 0) {
      return { exclude: true, reason: "admin_or_billing_only" };
    }
  }
  if (isWeatherOrTemperatureSoftContextText(normalized) && !hasExplicitScheduleRestriction(normalized)) {
    return { exclude: true, reason: "weather_or_free_time_soft_context" };
  }
  if (isFamilyMemberIllnessOnlyContext(normalized)) {
    return { exclude: true, reason: "family_member_illness_only" };
  }
  if (isCompletedRunReflectionNotScheduleConstraint(normalized)) {
    return { exclude: true, reason: "completed_run_reflection_not_schedule" };
  }
  return { exclude: false, reason: null };
}

function collectCueEvidenceFromSimulation(simulation: ObservationPersistenceSimulation, text: string | null): {
  families: OperationalCueFamily[];
  evidence: string[];
} {
  const families = new Set<OperationalCueFamily>();
  const evidence: string[] = [];

  for (const candidate of [...simulation.allCandidates, ...simulation.discardedCandidates.map((item) => item.classification)]) {
    if (candidate.signal_type) {
      families.add(mapSignalTypeToCueFamily(candidate.signal_type));
      evidence.push(`classifier: ${candidate.signal_type} (${candidate.primary_bucket}) — ${candidate.reason}`);
    }
  }

  const textCues = detectOperationalCueFamilies(text);
  for (const family of textCues.families) {
    families.add(family);
  }
  evidence.push(...textCues.evidence);

  if (families.size === 0) {
    const primary = classifyCoachOperationalSignal(
      buildObservationLikeFromContextObservation({
        id: "diagnostic",
        studentId: "diagnostic",
        sourceType: "private_dm",
        chatId: "0",
        messageThreadId: null,
        messageId: null,
        observedAt: new Date().toISOString(),
        labels: [],
        textSha256: null,
        textPreview: text,
        metadata: {},
        createdAt: new Date().toISOString(),
      })
    );
    if (primary.signal_type) {
      families.add(mapSignalTypeToCueFamily(primary.signal_type));
      evidence.push(`primary_classifier: ${primary.signal_type} (${primary.primary_bucket})`);
    }
  }

  return { families: [...families], evidence: [...new Set(evidence)] };
}

function hasClassifierOperationalCue(simulation: ObservationPersistenceSimulation): boolean {
  const candidates = [
    ...simulation.allCandidates,
    ...simulation.discardedCandidates.map((item) => item.classification),
  ];
  return candidates.some(
    (candidate) => candidate.signal_type && mapSignalTypeToCueFamily(candidate.signal_type) !== "other"
  );
}

function hasStrongTextOperationalCue(text: string | null): boolean {
  const cues = detectOperationalCueFamilies(text);
  return cues.families.some((family) => family !== "other");
}

function resolvePrimaryCueFamily(families: OperationalCueFamily[]): OperationalCueFamily {
  const priority: OperationalCueFamily[] = ["pain", "illness", "schedule", "plan_constraint", "resume", "pause", "move", "other"];
  for (const family of priority) {
    if (families.includes(family)) {
      return family;
    }
  }
  return families[0] ?? "other";
}

function resolveSkipReason(simulation: ObservationPersistenceSimulation): string {
  if (simulation.skipReason) {
    return simulation.skipReason;
  }
  if (simulation.discardedCandidates.length > 0) {
    const reasons = simulation.discardedCandidates.map(
      (item) => `${item.classification.signal_type ?? "unknown"}:${item.discardReason}`
    );
    return reasons.join("; ");
  }
  return "unknown_skip";
}

const POSITIVE_ILLNESS_ONSET_CUES = [
  "заболева",
  "заболел",
  "заболела",
  "простыл",
  "простыла",
  "насморк",
  "кашел",
  "орви",
  "болею",
  "недомога",
  "температур",
] as const;

const MOVE_RESCHEDULE_CUES = [
  "перенест",
  "перенес",
  "сдвин",
  "поменя",
  "сделаю завтра",
  "интервал",
] as const;

const INABILITY_PAUSE_CUES = [
  "не побегу",
  "не смогу",
  "пропущу",
  "пауза",
  "перерыв",
  "не буду бегать",
  "беру паузу",
  "не могу побегать",
  "не смогу побегать",
] as const;

const BODY_PAIN_PARTS = ["колен", "стоп", "ахилл", "надкостниц", "таз", "голен", "горло", "плеч", "бедр", "спин"] as const;

const NEGATED_SYMPTOM_PATTERNS = [
  /(?:^|[^\p{L}])не\s+бол(?:ит|ел(?:а|о|и)?)(?:\s|$|[^\p{L}])/iu,
  /(?:^|[^\p{L}])ничего\s+не\s+бол(?:ит|ел(?:а|о|и)?)(?:\s|$|[^\p{L}])/iu,
  /(?:^|[^\p{L}])боли\s+нет(?:\s|$|[^\p{L}])/iu,
  /(?:^|[^\p{L}])боль\s+нет(?:\s|$|[^\p{L}])/iu,
  /(?:^|[^\p{L}])не\s+(?:заболел(?:а|и|о)?|простыл(?:а|и|о)?)(?:\s|$|[^\p{L}])/iu,
  /(?:^|[^\p{L}])температур(?:а|ы)?\s+нет(?:\s|$|[^\p{L}])/iu,
  /(?:^|[^\p{L}])(?:горло|колен(?:о|е)?|спин(?:а|е|у|ы)?)\s+не\s+бол(?:ит|ит)(?:\s|$|[^\p{L}])/iu,
] as const;

const COACH_QUESTION_PATTERNS = [
  /^как\s+(?:горло|самочувствие)\??$/iu,
  /^болит\?$/iu,
  /^температура\s+есть\?$/iu,
  /^как\s+самочувствие\?$/iu,
  /^сможешь\s+побегать\?$/iu,
] as const;

const FIGURATIVE_DIAGNOSTIC_PHRASES = [
  "душа болит",
  "душа не болит",
  "душа просит",
  "минутка слабости",
  "момент слабости",
  "боль и соузы",
] as const;

function isLocalNegatedBefore(text: string, cueIndex: number): boolean {
  const windowStart = Math.max(0, cueIndex - 35);
  const before = text.slice(windowStart, cueIndex);
  if (/(?:^|[^\p{L}])не\s+(?:\S+\s+){0,3}$/iu.test(before)) {
    return true;
  }
  if (/\bничего\s+не\s+(?:\S+\s+){0,2}$/iu.test(before)) {
    return true;
  }
  if (/\b(?:горло|колен(?:о|е)?|спин(?:а|е|у|ы)?)\s+не\s+$/iu.test(before)) {
    return true;
  }
  return false;
}

function hasActiveLocalCue(text: string, cue: string): boolean {
  let searchFrom = 0;
  while (searchFrom < text.length) {
    const index = text.indexOf(cue, searchFrom);
    if (index === -1) {
      return false;
    }
    if (!isLocalNegatedBefore(text, index)) {
      return true;
    }
    searchFrom = index + 1;
  }
  return false;
}

function stripFigurativeForDiagnostic(text: string): string {
  let result = text;
  for (const phrase of FIGURATIVE_DIAGNOSTIC_PHRASES) {
    result = result.split(phrase).join(" ");
  }
  return result.replace(/\s+/gu, " ").trim();
}

function hasPositiveIllnessOnset(text: string): boolean {
  const normalized = stripFigurativeForDiagnostic(normalizeText(text));
  if (POSITIVE_ILLNESS_ONSET_CUES.some((cue) => hasActiveLocalCue(normalized, cue))) {
    return true;
  }
  for (const part of BODY_PAIN_PARTS) {
    const partIndex = normalized.indexOf(part);
    if (partIndex === -1) {
      continue;
    }
    const slice = normalized.slice(partIndex, partIndex + 30);
    if (/бол(?:ит|и|ела|ело|ел)/u.test(slice) && !new RegExp(`${part}\\S*\\s+не\\s+бол`, "u").test(normalized)) {
      if (!new RegExp(`не\\s+\\S{0,8}${part}`, "u").test(normalized.slice(Math.max(0, partIndex - 12), partIndex + 30))) {
        return true;
      }
    }
  }
  return false;
}

function hasPositivePainAffectingRunning(text: string): boolean {
  const normalized = stripFigurativeForDiagnostic(normalizeText(text));
  for (const part of ["колен", "стоп", "ахилл", "надкостниц", "таз", "голен", "спин", "плеч", "бедр"] as const) {
    const partIndex = normalized.indexOf(part);
    if (partIndex === -1) {
      continue;
    }
    const slice = normalized.slice(partIndex, partIndex + 30);
    if (/бол(?:ит|и|ела|ело|ел)/u.test(slice)) {
      const local = normalized.slice(Math.max(0, partIndex - 8), partIndex + 30);
      if (!/\bне\s+(?:\S+\s+){0,2}бол/u.test(local) && !new RegExp(`${part}\\S*\\s+не\\s+бол`, "u").test(local)) {
        return true;
      }
    }
  }
  return hasActiveLocalCue(normalized, "болит") || hasActiveLocalCue(normalized, "боль");
}

function hasMoveRescheduleRequest(text: string): boolean {
  const normalized = normalizeText(text);
  return MOVE_RESCHEDULE_CUES.some((cue) => normalized.includes(cue));
}

function hasExplicitInabilityOrPause(text: string): boolean {
  const normalized = normalizeText(text);
  return INABILITY_PAUSE_CUES.some((cue) => normalized.includes(cue));
}

function hasNegatedSymptomPattern(text: string): boolean {
  const normalized = normalizeText(text);
  return NEGATED_SYMPTOM_PATTERNS.some((pattern) => pattern.test(normalized));
}

function hasSoftContextWithOkayOutcome(text: string): boolean {
  const normalized = normalizeText(text);
  const softOutcome =
    /(?:,\s*)?а\s+так\s+норм|(?:в\s+целом\s+)?(?:вс[её]\s+)?(?:ок|норм(?:ально)?)|ничего\s+критичного/u.test(
      normalized
    );
  const mildSymptom = /(?:сон\s+клонит|устал(?:а|ость)?)/u.test(normalized);
  return softOutcome && (mildSymptom || /,\s*а\s+так\s+норм/u.test(normalized));
}

function isCoachAuthoredObservation(metadata: Record<string, unknown> | null | undefined): boolean {
  if (!metadata) {
    return false;
  }
  const senderRole = typeof metadata.senderRole === "string" ? metadata.senderRole.toLowerCase() : "";
  if (["coach", "admin", "bot"].some((role) => senderRole.includes(role))) {
    return true;
  }
  const direction = typeof metadata.direction === "string" ? metadata.direction.toLowerCase() : "";
  if (direction.startsWith("coach_outgoing")) {
    return true;
  }
  return false;
}

function looksLikeCoachQuestionText(text: string): boolean {
  const normalized = normalizeText(text);
  if (COACH_QUESTION_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }
  if (!normalized.endsWith("?")) {
    return false;
  }
  const hasAthleteNarrative = /\b(?:я|меня|мне|мою|моя|буду|смогу|не\s+смогу|перенесу|заболел)\b/u.test(normalized);
  return !hasAthleteNarrative && normalized.length <= 80;
}

function resolveReviewCandidateSubBucket(input: {
  hasHealth: boolean;
  hasSchedule: boolean;
}): Exclude<
  SilentSkipDiagnosticSubBucket,
  SilentSkipSuppressionReason
> {
  if (input.hasHealth && input.hasSchedule) {
    return "review_candidate_mixed_health_schedule";
  }
  if (input.hasHealth) {
    return "review_candidate_health";
  }
  if (input.hasSchedule) {
    return "review_candidate_schedule_or_move";
  }
  return "ambiguous_review_candidate";
}

export function classifySilentSkipDiagnosticSubBucket(input: {
  text: string | null;
  metadata?: Record<string, unknown> | null;
}): {
  diagnosticSubBucket: SilentSkipDiagnosticSubBucket;
  suppressFromCandidateSurfacing: boolean;
  classificationNote: string;
} {
  const text = input.text ?? "";

  if (isCoachAuthoredObservation(input.metadata)) {
    return {
      diagnosticSubBucket: "coach_question_ok_to_skip",
      suppressFromCandidateSurfacing: true,
      classificationNote: "coach-authored observation metadata",
    };
  }

  const hasHealth = hasPositiveIllnessOnset(text) || hasPositivePainAffectingRunning(text);
  const hasSchedule = hasMoveRescheduleRequest(text) || hasExplicitInabilityOrPause(text);

  if (hasHealth || hasSchedule) {
    const subBucket = resolveReviewCandidateSubBucket({ hasHealth, hasSchedule });
    return {
      diagnosticSubBucket: subBucket,
      suppressFromCandidateSurfacing: false,
      classificationNote: "positive operational retention rule matched",
    };
  }

  if (hasNegatedSymptomPattern(text)) {
    return {
      diagnosticSubBucket: "negated_symptom_ok_to_skip",
      suppressFromCandidateSurfacing: true,
      classificationNote: "negated symptom pattern without separate positive operational cue",
    };
  }

  if (hasSoftContextWithOkayOutcome(text)) {
    return {
      diagnosticSubBucket: "soft_context_ok_to_skip",
      suppressFromCandidateSurfacing: true,
      classificationNote: "soft okay/normal outcome without operational restriction",
    };
  }

  const falsePositiveReason = inferFalsePositiveSuppressionReason(text);
  if (falsePositiveReason === "figurative_idiom" || falsePositiveReason === "quoted_idiom") {
    return {
      diagnosticSubBucket: "figurative_or_non_training_ok_to_skip",
      suppressFromCandidateSurfacing: true,
      classificationNote: `figurative/non-literal health cue (${falsePositiveReason})`,
    };
  }

  if (isNonTrainingAdministrativeIntentText(normalizeText(text))) {
    return {
      diagnosticSubBucket: "non_training_operational_ok_to_skip",
      suppressFromCandidateSurfacing: true,
      classificationNote: "non-training administrative intent",
    };
  }

  if (looksLikeCoachQuestionText(text)) {
    return {
      diagnosticSubBucket: "coach_question_ok_to_skip",
      suppressFromCandidateSurfacing: true,
      classificationNote: "conservative coach-question text pattern",
    };
  }

  return {
    diagnosticSubBucket: "ambiguous_review_candidate",
    suppressFromCandidateSurfacing: false,
    classificationNote: "operational cues present but classification uncertain; retain for review",
  };
}

function emptySuppressedByReason(): Record<SilentSkipSuppressionReason, number> {
  return {
    soft_context_ok_to_skip: 0,
    negated_symptom_ok_to_skip: 0,
    coach_question_ok_to_skip: 0,
    figurative_or_non_training_ok_to_skip: 0,
    non_training_operational_ok_to_skip: 0,
  };
}

export function classifySilentSkipReviewBucketItems(
  items: Array<{
    item: SilentSkipReviewBucketItem;
    metadata?: Record<string, unknown> | null;
  }>
): SilentSkipClassificationSummary {
  const suppressedByReason = emptySuppressedByReason();
  const retainedCandidates: ClassifiedSilentSkipReviewBucketItem[] = [];
  const suppressedRows: ClassifiedSilentSkipReviewBucketItem[] = [];

  for (const entry of items) {
    const classification = classifySilentSkipDiagnosticSubBucket({
      text: entry.item.rawPreview,
      metadata: entry.metadata ?? null,
    });
    const classified: ClassifiedSilentSkipReviewBucketItem = {
      ...entry.item,
      ...classification,
    };
    if (classification.suppressFromCandidateSurfacing) {
      suppressedRows.push(classified);
      if (classification.diagnosticSubBucket in suppressedByReason) {
        suppressedByReason[classification.diagnosticSubBucket as SilentSkipSuppressionReason] += 1;
      }
    } else {
      retainedCandidates.push(classified);
    }
  }

  return {
    rawWithCuesCount: items.length,
    retainedCandidateCount: retainedCandidates.length,
    suppressedNoiseCount: suppressedRows.length,
    suppressedByReason,
    retainedCandidates,
    suppressedRows,
  };
}

export function buildReviewBucketCounts(input: {
  activeItems: ActiveSignalReviewBucketItem[];
  silentSkipClassification: SilentSkipClassificationSummary;
}): Record<ReviewBucketName, number> & {
  silent_skip_raw_with_cues: number;
  silent_skip_suppressed_noise: number;
} {
  return {
    obvious_auto_record: input.activeItems.filter((item) => item.bucket === "obvious_auto_record").length,
    review_required: input.activeItems.filter((item) => item.bucket === "review_required").length,
    close_candidate_review: input.activeItems.filter((item) => item.bucket === "close_candidate_review").length,
    silent_skip_with_cues: input.silentSkipClassification.retainedCandidateCount,
    silent_skip_raw_with_cues: input.silentSkipClassification.rawWithCuesCount,
    silent_skip_suppressed_noise: input.silentSkipClassification.suppressedNoiseCount,
  };
}

export function buildSilentSkipReviewBucketItem(input: {
  observation: TrainingPeaksTelegramContextObservation;
  studentName: string;
  studentId: string;
}): SilentSkipReviewBucketItem | null {
  if (!input.observation.studentId || !input.observation.textPreview?.trim()) {
    return null;
  }

  const exclusion = shouldExcludeSilentSkipText(input.observation.textPreview);
  const simulation = simulateObservationPersistenceOutcome({
    studentId: input.observation.studentId,
    sourceType: input.observation.sourceType,
    textPreview: input.observation.textPreview,
    labels: input.observation.labels,
    metadata: input.observation.metadata,
    observedAt: input.observation.observedAt,
  });

  if (simulation.status === "would_persist") {
    return null;
  }

  const cueInfo = collectCueEvidenceFromSimulation(simulation, input.observation.textPreview);
  const hasClassifierCue = hasClassifierOperationalCue(simulation);
  const hasTextCue = hasStrongTextOperationalCue(input.observation.textPreview);
  if ((cueInfo.families.length === 0 && !hasClassifierCue) || exclusion.exclude || (!hasClassifierCue && !hasTextCue)) {
    return null;
  }

  return {
    bucket: "silent_skip_with_cues",
    studentName: input.studentName,
    studentId: input.studentId,
    observationId: input.observation.id,
    observedAt: input.observation.observedAt,
    candidateFamily: resolvePrimaryCueFamily(cueInfo.families),
    skipReason: resolveSkipReason(simulation),
    cueEvidence: cueInfo.evidence,
    rawPreview: input.observation.textPreview.replace(/\s+/gu, " ").slice(0, 240),
    diagnosticNote: "not persisted; gates remain authoritative",
    simulation,
  };
}

function getClassifierConfidence(signal: TrainingPeaksStudentOperationalSignal): string | null {
  return getSignalMetadataString(signal.metadata, "classifier_confidence");
}

function buildReviewRequiredReasons(input: {
  explainRecord: TpSignalExplainRecord;
  signal: TrainingPeaksStudentOperationalSignal;
  item: TrainingPeaksOperationalSignalsItem;
  asOfDate: string;
}): string[] {
  const reasons: string[] = [];
  if (input.explainRecord.suspected_bug_class) {
    reasons.push(`suspected_bug=${input.explainRecord.suspected_bug_class}`);
  }
  if (input.explainRecord.recommended_state === "needs_review" || input.explainRecord.recommended_state === "stale_needs_review") {
    reasons.push(`recommended_state=${input.explainRecord.recommended_state}`);
  }
  if (input.item.hiddenReason) {
    reasons.push(`hidden=${input.item.hiddenReason}`);
  }
  if (input.explainRecord.latest_negative_evidence.length > 0) {
    reasons.push("latest_negative_evidence");
  }
  const confidence = getClassifierConfidence(input.signal);
  if (confidence === "low" || confidence === "medium") {
    reasons.push(`classifier_confidence=${confidence}`);
  }
  if (hasPartialStaleScheduleDates(input.signal.structuredPayload, input.asOfDate)) {
    reasons.push("partial_or_stale_schedule_payload");
  }
  if (input.item.lifecycleDisplayState === "stale_needs_review") {
    reasons.push("lifecycle_display=stale_needs_review");
  }
  if (!input.item.hiddenReason && input.explainRecord.recommended_state === "monitoring_after_return") {
    reasons.push("monitoring_after_return");
  }
  return reasons;
}

function isCloseCandidateReview(input: {
  explainRecord: TpSignalExplainRecord;
  signal: TrainingPeaksStudentOperationalSignal;
  item: TrainingPeaksOperationalSignalsItem;
}): boolean {
  return (
    input.item.lifecycleDisplayState === "ready_for_coach_close" ||
    input.explainRecord.recommended_state === "close_candidate" ||
    input.signal.requiresCoachClose === true
  );
}

export function assignActiveSignalReviewBucket(input: {
  studentName: string;
  signal: TrainingPeaksStudentOperationalSignal;
  item: TrainingPeaksOperationalSignalsItem;
  evidence: TrainingPeaksOperationalSignalDisplayEvidence | null;
  asOfDate: string;
}): ActiveSignalReviewBucketItem {
  const explainRecord = buildTpSignalExplainRecord({
    studentName: input.studentName,
    signal: input.signal,
    item: input.item,
    evidence: input.evidence,
    asOfDate: input.asOfDate,
  });

  let bucket: Exclude<ReviewBucketName, "silent_skip_with_cues">;
  let reason: string;

  if (isCloseCandidateReview({ explainRecord, signal: input.signal, item: input.item })) {
    bucket = "close_candidate_review";
    reason = explainRecord.why_not_closed || "ready_for_coach_close";
  } else {
    const reviewReasons = buildReviewRequiredReasons({
      explainRecord,
      signal: input.signal,
      item: input.item,
      asOfDate: input.asOfDate,
    });
    const confidence = getClassifierConfidence(input.signal);
    const visible = !input.item.hiddenReason;
    const highConfidenceAuto =
      visible &&
      confidence === "high" &&
      !explainRecord.suspected_bug_class &&
      reviewReasons.length === 0 &&
      explainRecord.recommended_state !== "needs_review";

    if (highConfidenceAuto) {
      bucket = "obvious_auto_record";
      reason = `high_confidence_visible_signal; type=${input.signal.signalType}`;
    } else {
      bucket = "review_required";
      reason = reviewReasons.length > 0 ? reviewReasons.join("; ") : "ambiguous_or_non_high_confidence_active_signal";
    }
  }

  return {
    bucket,
    studentName: input.studentName,
    studentId: input.signal.studentId,
    signalId: input.signal.id,
    signalType: input.signal.signalType,
    category: explainRecord.category,
    state: explainRecord.recommended_state,
    reason,
    sourceObservationId: input.signal.sourceObservationId,
    preview: (input.item.text || explainRecord.visible_output).replace(/\s+/gu, " ").slice(0, 240),
    classifierConfidence: getClassifierConfidence(input.signal),
    visible: !input.item.hiddenReason,
    suspectedBugClass: explainRecord.suspected_bug_class,
    explainRecord,
  };
}

export function formatReviewBucketsSummaryMarkdown(input: {
  generatedAt: string;
  windowLabel: string;
  names: string[];
  matchedStudents: Array<{ id: string; name: string | null }>;
  observationsScanned: number;
  activeSignalsScanned: number;
  visibleDiagnosticRows: number;
  bucketCounts: Record<ReviewBucketName, number> & {
    silent_skip_raw_with_cues?: number;
    silent_skip_suppressed_noise?: number;
  };
  activeItems: ActiveSignalReviewBucketItem[];
  silentSkipItems: ClassifiedSilentSkipReviewBucketItem[];
  silentSkipClassification: SilentSkipClassificationSummary;
  reportDir: string | null;
  noWrite: boolean;
  scopeLabel?: string;
}): string {
  const visibleOrCandidateRows = input.visibleDiagnosticRows + input.bucketCounts.silent_skip_with_cues;
  const silentSkipPct =
    input.observationsScanned > 0
      ? ((input.bucketCounts.silent_skip_with_cues / input.observationsScanned) * 100).toFixed(1)
      : "0.0";
  const rawSilentSkipPct =
    input.observationsScanned > 0 && input.bucketCounts.silent_skip_raw_with_cues !== undefined
      ? ((input.bucketCounts.silent_skip_raw_with_cues / input.observationsScanned) * 100).toFixed(1)
      : silentSkipPct;
  const reviewRequiredPct =
    visibleOrCandidateRows > 0
      ? ((input.bucketCounts.review_required / visibleOrCandidateRows) * 100).toFixed(1)
      : "0.0";
  const closeCandidatePct =
    visibleOrCandidateRows > 0
      ? ((input.bucketCounts.close_candidate_review / visibleOrCandidateRows) * 100).toFixed(1)
      : "0.0";

  const lines: string[] = [
    "# TP Signals Review Buckets Diagnostic",
    "",
    `- generated_at: ${input.generatedAt}`,
    `- window: ${input.windowLabel}`,
    `- scope: ${input.scopeLabel ?? input.names.join(", ")}`,
    `- matched_students: ${input.matchedStudents.length}`,
    `- observations_scanned: ${input.observationsScanned}`,
    `- active_signals_scanned: ${input.activeSignalsScanned}`,
    `- visible_diagnostic_rows: ${input.visibleDiagnosticRows}`,
    `- no_write: ${String(input.noWrite)}`,
    input.reportDir ? `- report_dir: ${input.reportDir}` : "- report_dir: (not written)",
    "",
    "## Bucket summary",
    "",
    "| Metric | Value |",
    "|---|---:|",
    `| Active students scanned | ${input.matchedStudents.length} |`,
    `| Observations replayed | ${input.observationsScanned} |`,
    `| Active signals scanned | ${input.activeSignalsScanned} |`,
    `| Visible diagnostic rows | ${input.visibleDiagnosticRows} |`,
    `| obvious_auto_record | ${input.bucketCounts.obvious_auto_record} |`,
    `| review_required | ${input.bucketCounts.review_required} |`,
    `| close_candidate_review | ${input.bucketCounts.close_candidate_review} |`,
    `| silent_skip_raw_with_cues | ${input.bucketCounts.silent_skip_raw_with_cues ?? input.silentSkipClassification.rawWithCuesCount} |`,
    `| silent_skip_with_cues (strict retained) | ${input.bucketCounts.silent_skip_with_cues} |`,
    `| silent_skip_suppressed_noise | ${input.bucketCounts.silent_skip_suppressed_noise ?? input.silentSkipClassification.suppressedNoiseCount} |`,
    "",
    "## Percentages",
    "",
    `- silent_skip_raw_with_cues / observations_replayed: ${rawSilentSkipPct}%`,
    `- silent_skip_with_cues (strict) / observations_replayed: ${silentSkipPct}%`,
    `- review_required / visible_or_candidate_rows: ${reviewRequiredPct}%`,
    `- close_candidate_review / visible_or_candidate_rows: ${closeCandidatePct}%`,
    "",
    "## Silent-skip noise suppression",
    "",
    "| Reason | Count |",
    "|---|---:|",
  ];

  for (const [reason, count] of Object.entries(input.silentSkipClassification.suppressedByReason)) {
    if (count > 0) {
      lines.push(`| ${reason} | ${count} |`);
    }
  }
  if (input.silentSkipClassification.suppressedNoiseCount === 0) {
    lines.push("| (none) | 0 |");
  }
  lines.push(
    "",
    "## Bucket meanings",
    "",
    "- `obvious_auto_record`: high-confidence visible active signal with no suspected bug class; likely safe auto-record surface in a future review queue.",
    "- `review_required`: active signal that is ambiguous, low/medium confidence, partially stale, hidden, or has review blockers.",
    "- `close_candidate_review`: lifecycle/display already marks the row as coach-close candidate (`ready_for_coach_close` / `requiresCoachClose`). Pain/injury and illness close paths stay coach-review only.",
    "- `silent_skip_raw_with_cues`: all cue-bearing skipped observations before diagnostic noise filtering.",
    "- `silent_skip_with_cues`: strict retained review candidates after diagnostic noise filtering. Gates remain authoritative.",
    "- `silent_skip_suppressed_noise`: cue-bearing skips suppressed from candidate surfacing with explicit reason.",
    ""
  );

  for (const bucket of ["close_candidate_review", "review_required", "obvious_auto_record"] as const) {
    const items = input.activeItems.filter((item) => item.bucket === bucket);
    lines.push(`## ${bucket}`);
    lines.push("");
    if (items.length === 0) {
      lines.push("- none");
      lines.push("");
      continue;
    }
    for (const item of items) {
      lines.push(`### ${item.studentName}`);
      lines.push(`- category: ${item.category}`);
      lines.push(`- signal_type: ${item.signalType}`);
      lines.push(`- state: ${item.state}`);
      lines.push(`- reason: ${item.reason}`);
      lines.push(`- source: ${item.sourceObservationId ?? item.signalId}`);
      lines.push(`- classifier_confidence: ${item.classifierConfidence ?? "unknown"}`);
      lines.push(`- visible: ${String(item.visible)}`);
      lines.push(`- preview: "${item.preview}"`);
      lines.push("");
    }
  }

  lines.push("## silent_skip_with_cues (strict retained candidates)");
  lines.push("");
  if (input.silentSkipItems.length === 0) {
    lines.push("- none");
    lines.push("");
  } else {
    for (const skipItem of input.silentSkipItems) {
      lines.push(`### ${skipItem.studentName}`);
      lines.push(`- diagnostic_sub_bucket: ${skipItem.diagnosticSubBucket}`);
      lines.push(`- candidate_family: ${skipItem.candidateFamily}`);
      lines.push(`- skip_reason: ${skipItem.skipReason}`);
      lines.push(`- classification_note: ${skipItem.classificationNote}`);
      lines.push(`- cue_evidence: ${skipItem.cueEvidence.join(" | ")}`);
      lines.push(`- source_observation_id: ${skipItem.observationId}`);
      lines.push(`- raw_preview: "${skipItem.rawPreview}"`);
      lines.push("");
    }
  }

  lines.push("## silent_skip_suppressed_noise");
  lines.push("");
  if (input.silentSkipClassification.suppressedRows.length === 0) {
    lines.push("- none");
    lines.push("");
  } else {
    for (const skipItem of input.silentSkipClassification.suppressedRows) {
      lines.push(`### ${skipItem.studentName}`);
      lines.push(`- suppression_reason: ${skipItem.diagnosticSubBucket}`);
      lines.push(`- classification_note: ${skipItem.classificationNote}`);
      lines.push(`- candidate_family: ${skipItem.candidateFamily}`);
      lines.push(`- source_observation_id: ${skipItem.observationId}`);
      lines.push(`- raw_preview: "${skipItem.rawPreview}"`);
      lines.push("");
    }
  }

  const exampleCandidates = input.silentSkipItems.slice(0, 8);
  lines.push("## Retained candidate examples");
  lines.push("");
  if (exampleCandidates.length === 0) {
    lines.push("- none");
  } else {
    for (const skipItem of exampleCandidates) {
      lines.push(`- **${skipItem.studentName}** (${skipItem.diagnosticSubBucket}): "${skipItem.rawPreview}"`);
    }
  }
  lines.push(
    "",
    "## Future implementation input",
    "",
    "- Use strict `silent_skip_with_cues` counts to size review-queue buckets before adding Telegram review cards.",
    "- Treat suppressed silent-skip rows as audit-only context, not as rows to auto-promote.",
    "- Keep pain/injury and illness close paths coach-review only.",
    ""
  );

  return `${lines.join("\n")}\n`;
}

export function formatReviewBucketsReadme(): string {
  return `# TP Signals Review Buckets Diagnostic

Read-only observability report for future TP Signals review-queue buckets.

## Buckets

1. **obvious_auto_record** — high-confidence visible active signals that already pass current gates.
2. **review_required** — active signals needing manual review (low/medium confidence, bugs, stale/partial schedule, hidden rows).
3. **close_candidate_review** — rows already mapped to coach-close candidates by lifecycle/display logic.
4. **silent_skip_with_cues** — strict retained review candidates from cue-bearing skipped observations after diagnostic noise filtering. Raw cue-bearing skips are reported separately as \`silent_skip_raw_with_cues\`.

## Safety

- No DB writes, Telegram sends, or TrainingPeaks mutations.
- Does not promote skipped candidates into persisted signals.
- Does not change production lifecycle or /tp_signals output.

## Usage

\`\`\`bash
npm run diagnose:tp-signals-review-buckets -- --date=YYYY-MM-DD --names="Name One,Name Two"
npm run diagnose:tp-signals-review-buckets -- --from=YYYY-MM-DD --to=YYYY-MM-DD --all-active
npm run diagnose:tp-signals-review-buckets -- --from=YYYY-MM-DD --to=YYYY-MM-DD --names="Name One" --no-write
\`\`\`

\`--all-active\` scans all Supabase \`is_active=true\` students (not \`config/students.json\`).
\`--no-write\` suppresses report directory creation for the run.
`;
}
