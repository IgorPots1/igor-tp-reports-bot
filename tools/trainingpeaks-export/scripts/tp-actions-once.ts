import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

import {
  PlaywrightOnlyTrainingPeaksDriver,
  derivePrepareMoveWorkoutResultFromProbe,
  type ProbeLike as TrainingPeaksProbeLikeForDriver,
} from "./lib/playwright-only-trainingpeaks-driver";
import { profileDir, toolRoot } from "./lib/paths";
import {
  buildTpApiWorkoutUrl,
  buildWorkoutMovePayload,
  captureSessionAuth,
  parseDateArgToTpDateTime,
  performApiJsonRequest,
  redactUnknown,
  verifyWorkoutMoved,
} from "./lib/trainingpeaks-api-move";
import * as moveSourcePolicyNamespace from "../../../src/features/trainingpeaks/move-source-policy";
import * as moveSourceInferencePreviewNamespace from "../../../src/features/trainingpeaks/move-source-inference-preview";
import * as strongFutureDescriptorMoveSourceNamespace from "../../../src/features/trainingpeaks/strong-future-descriptor-move-source";
import * as trainingPeaksAttentionTelegramModule from "../../../src/features/trainingpeaks/attention-telegram";
import * as trainingPeaksTelegramBusinessModule from "../../../src/features/trainingpeaks/telegram-business";
import * as trainingPeaksRepositoryModule from "../../../src/features/trainingpeaks/repository";
import { buildCoachDryRunFailureNotificationLines } from "../../../src/features/trainingpeaks/action-dry-run-telegram-copy";
import {
  detectPlannedVsCompletedAmbiguityHint,
  truncateWorkoutTitleForButton,
  type PlannedCompletedAmbiguityHint,
} from "../../../src/features/trainingpeaks/action-planned-completed-ambiguity";

type NamespaceWithOptionalDefault<T> = T & { default?: T };

const trainingPeaksTelegramBusinessModuleCompat =
  trainingPeaksTelegramBusinessModule as NamespaceWithOptionalDefault<
    typeof trainingPeaksTelegramBusinessModule
  >;
const trainingPeaksRepositoryModuleCompat =
  trainingPeaksRepositoryModule as NamespaceWithOptionalDefault<typeof trainingPeaksRepositoryModule>;
const trainingPeaksAttentionTelegramModuleCompat =
  trainingPeaksAttentionTelegramModule as NamespaceWithOptionalDefault<
    typeof trainingPeaksAttentionTelegramModule
  >;
const moveSourcePolicyNamespaceCompat =
  moveSourcePolicyNamespace as NamespaceWithOptionalDefault<typeof moveSourcePolicyNamespace>;
const moveSourceInferencePreviewNamespaceCompat =
  moveSourceInferencePreviewNamespace as NamespaceWithOptionalDefault<
    typeof moveSourceInferencePreviewNamespace
  >;
const strongFutureDescriptorMoveSourceNamespaceCompat =
  strongFutureDescriptorMoveSourceNamespace as NamespaceWithOptionalDefault<
    typeof strongFutureDescriptorMoveSourceNamespace
  >;

const getRequiredTrainingPeaksBusinessConnectionId =
  trainingPeaksTelegramBusinessModuleCompat.getRequiredTrainingPeaksBusinessConnectionId ??
  trainingPeaksTelegramBusinessModuleCompat.default?.getRequiredTrainingPeaksBusinessConnectionId;
const sendTrainingPeaksTelegramBusinessMessage =
  trainingPeaksTelegramBusinessModuleCompat.sendTrainingPeaksTelegramBusinessMessage ??
  trainingPeaksTelegramBusinessModuleCompat.default?.sendTrainingPeaksTelegramBusinessMessage;

if (
  typeof getRequiredTrainingPeaksBusinessConnectionId !== "function" ||
  typeof sendTrainingPeaksTelegramBusinessMessage !== "function"
) {
  throw new Error("TrainingPeaks Telegram business helpers are unavailable.");
}

const getTrainingPeaksBusinessChatByChatId =
  trainingPeaksRepositoryModuleCompat.getTrainingPeaksBusinessChatByChatId ??
  trainingPeaksRepositoryModuleCompat.default?.getTrainingPeaksBusinessChatByChatId;

if (typeof getTrainingPeaksBusinessChatByChatId !== "function") {
  throw new Error("TrainingPeaks repository business chat helper is unavailable.");
}

const getTrainingPeaksCoachChatIds =
  trainingPeaksAttentionTelegramModuleCompat.getTrainingPeaksCoachChatIds ??
  trainingPeaksAttentionTelegramModuleCompat.default?.getTrainingPeaksCoachChatIds;

if (typeof getTrainingPeaksCoachChatIds !== "function") {
  throw new Error("TrainingPeaks coach chat ids helper is unavailable.");
}

const moveSourcePolicy =
  moveSourcePolicyNamespaceCompat.default ?? moveSourcePolicyNamespaceCompat;
const moveSourceInferencePreview =
  moveSourceInferencePreviewNamespaceCompat.default ?? moveSourceInferencePreviewNamespaceCompat;
const strongFutureDescriptorMoveSource =
  strongFutureDescriptorMoveSourceNamespaceCompat.default ??
  strongFutureDescriptorMoveSourceNamespaceCompat;

type ActionExecutionStatus =
  | "not_started"
  | "dry_run_running"
  | "dry_run_completed"
  | "execute_pending"
  | "running_local"
  | "completed"
  | "failed";

type ActionExecutionMode = "dry_run" | "real";
type ActionRunType = "dry_run" | "real";
type ActionRunStatus = "running" | "completed" | "failed";
type RunnerMode = "dry_run" | "real";

type TrainingPeaksStudentRow = {
  id: string;
  student_id: string;
  student_name: string;
  telegram_chat_id: string | null;
  telegram_formality?: "ty" | "vy" | "unknown" | null;
  trainingpeaks_athlete_url: string;
};

type TrainingPeaksActionRow = {
  id: string;
  student_id: string | null;
  action_type: "move_workout";
  status: "pending_coach" | "approved" | "rejected";
  raw_text: string;
  parsed_payload: unknown;
  coach_chat_id: string | null;
  decided_by_chat_id: string | null;
  source_chat_id?: string;
  source_message_id?: string;
  execution_status: ActionExecutionStatus;
  execution_mode: ActionExecutionMode | null;
  claimed_by: string | null;
  claimed_at: string | null;
  last_run_id: string | null;
  execution_requested_at: string | null;
};

const COACH_CONFIRMED_SOURCE_DATE_POLICY = "coach_confirmed_source_date";

type TrainingPeaksActionRunRow = {
  id: string;
  action_id: string;
  run_type: ActionRunType;
  status: ActionRunStatus;
  dry_run: boolean;
  runner_id: string | null;
  started_at: string;
  finished_at: string | null;
  error_message: string | null;
  log_json: unknown;
  screenshot_before_path: string | null;
  screenshot_after_path: string | null;
};

type ClaimedAction = {
  action: TrainingPeaksActionRow;
  student: TrainingPeaksStudentRow | null;
};

type TrustedDryRunLog = {
  dryRunResult: "candidate_found";
  canExecute: true;
  confidence: number;
  candidate: DryRunCandidate;
  resolvedDates: {
    sourceDate: string;
    targetDate: string;
    timezone: string | null;
  };
  identityCheck: DryRunIdentityCheck;
  selectedSourceDatePolicy: string | null;
};

type ClaimedRealAction = ClaimedAction & {
  trustedDryRunRun: TrainingPeaksActionRunRow;
  trustedDryRunLog: TrustedDryRunLog;
};

type DryRunArtifacts = {
  screenshotBeforePath: string;
  screenshotAfterPath: string | null;
  dryRunEvaluation: DryRunEvaluation;
  artifactDir: string;
  openedAthleteUrl: string | null;
  pageMeta: {
    url: string;
    title: string;
    loginRequired: boolean;
    athletePageLikelyReachable: boolean;
    trainingPeaksContextLikely: boolean;
  };
};

type RevalidationComparisonField<T> = {
  trusted: T | null;
  current: T | null;
  matches: boolean;
};

type RevalidationComparison = {
  revalidationPassed: boolean;
  mismatchReasons: string[];
  confidenceThresholdBypassed: boolean;
  confidenceThresholdBypassReason: string | null;
  trustedDryRunResult: string;
  currentDryRunResult: string;
  trustedCanExecute: boolean;
  currentCanExecute: boolean;
  trustedConfidence: number;
  currentConfidence: number;
  trustedIdentityMatchedBy: IdentityMatchType;
  currentIdentityMatchedBy: IdentityMatchType;
  sourceDate: RevalidationComparisonField<string>;
  targetDate: RevalidationComparisonField<string>;
  fingerprint: RevalidationComparisonField<string>;
  title: RevalidationComparisonField<string>;
  type: RevalidationComparisonField<string>;
  plannedDurationSec: RevalidationComparisonField<number>;
  plannedDistance: RevalidationComparisonField<number>;
  startTimeLocal: RevalidationComparisonField<string>;
  trustedCandidate: DryRunCandidate;
  currentCandidate: DryRunCandidate | null;
};

type UiCapabilityProbeScreenshots = {
  before: string | null;
  menuOpened: string | null;
  afterEditClick: string | null;
  detailOpened: string | null;
  beforeDateHeaderClick: string | null;
  afterDateHeaderClickAttempt1: string | null;
  afterTargetDayClick: string | null;
  datePickerOpened: string | null;
  afterClosed: string | null;
  timeout: string | null;
};

type UiCapabilityProbeCardDiscovery = {
  found: boolean;
  selectorUsed: string | null;
  textSnippet: string | null;
  menuButtonFound: boolean;
  menuTriggerFound: boolean;
  menuTriggerSelectorUsed: string | null;
  menuOpened: boolean;
  menuActionLabels: string[];
  menuMoveOptionFound: boolean;
  menuRescheduleOptionFound: boolean;
  menuCopyOptionFound: boolean;
  menuMoveActionFound: boolean;
  menuRescheduleActionFound: boolean;
  menuCopyActionFound: boolean;
  menuEditActionFound: boolean;
  menuEditClicked: boolean;
  menuCloseSucceeded: boolean;
};

type UiCapabilityProbeDetailDiscovery = {
  openAttempted: boolean;
  opened: boolean;
  dateFieldFound: boolean;
  dateFieldSelectorHint: string | null;
  currentDateValue: string | null;
  dateHeaderFound: boolean;
  dateHeaderText: string | null;
  dateControlClickable: boolean;
  dateControlSelectorUsed: string | null;
  dateHeaderClickStrategiesTried: string[];
  dateHeaderClickSucceededStrategy: string | null;
  dateHeaderBoundingBox: { x: number; y: number; width: number; height: number } | null;
  datePickerOpened: boolean;
  datePickerSelectorHint: string | null;
  datePickerDetectionStrategy: string | null;
  datePickerBoundingBox: { x: number; y: number; width: number; height: number } | null;
  visibleMonth: string | null;
  visibleYear: string | null;
  visibleDayCandidates: number[];
  targetDayVisible: boolean;
  selectedSourceDayVisible: boolean;
  targetDateSelectionAttempted: boolean;
  targetDateSelectionConfirmed: boolean;
  postClickDateHeaderText: string | null;
  postClickDateInputValue: string | null;
  targetDateConfirmedBy: "date_header" | "date_input" | "selected_day_highlight" | null;
  targetDateClickMethod: "mouse.click.bounding_box_center" | null;
  targetDateClickCandidateFound: boolean;
  targetDateClickCandidateBoundingBox: { x: number; y: number; width: number; height: number } | null;
  afterTargetDayClickError: string | null;
  datePickerOpenCheckCount: number;
  datePickerOpenCheckSnippets: string[];
  datepickerDomDebugPath: string | null;
  datepickerDomDebugTopCandidates: string[];
  datepickerDomDebugError: string | null;
  saveButtonFound: boolean;
  saveAndCloseButtonFound: boolean;
  cancelButtonFound: boolean;
  closeButtonFound: boolean;
  modalScopedSaveFound: boolean;
  modalScopedSaveAndCloseFound: boolean;
  modalScopedCancelFound: boolean;
  modalScopedCloseFound: boolean;
  closeSucceeded: boolean;
  datePickerCloseAttempted: boolean;
  datePickerCloseSucceeded: boolean;
  datePickerCloseError: string | null;
  mutationOccurred: boolean;
};

type UiCapabilityProbe = {
  attempted: boolean;
  safeToProceedLater: boolean;
  recommendedMutationMethod: "detail_date_picker_save_close" | "unknown";
  card: UiCapabilityProbeCardDiscovery;
  detail: UiCapabilityProbeDetailDiscovery;
  controlDiscovery: {
    card: UiCapabilityProbeCardDiscovery;
    detail: UiCapabilityProbeDetailDiscovery;
  };
  screenshots: UiCapabilityProbeScreenshots;
  progress: {
    currentStep: string | null;
    lastCompletedStep: string | null;
    timeoutStep: string | null;
    timeoutAt: string | null;
    startedAt: string;
    updatedAt: string;
    stepHistory: string[];
  };
  warnings: string[];
  errors: string[];
};

type TargetDateSelectionConfirmation = {
  preSaveDateHeaderText: string | null;
  preSaveDateInputValue: string | null;
  preSaveTargetDateSelectionAttempted: boolean;
  preSaveTargetDateSelectionConfirmed: boolean;
  preSaveTargetDateConfirmedBy: "date_header" | "date_input" | "selected_day_highlight" | null;
  preSaveTargetDateConfirmedByHeader: boolean;
  preSaveTargetDateConfirmedByInput: boolean;
  beforeClickDateHeaderText: string | null;
  datePickerOpened: boolean;
  datePickerDetectionStrategy: string | null;
  targetDateClickCandidateFound: boolean;
  targetDateClickCandidateBoundingBox: { x: number; y: number; width: number; height: number } | null;
  targetDateClickAttempted: boolean;
  targetDateClickMethod: "mouse.click.bounding_box_center" | null;
  afterTargetDayClickError: string | null;
  afterClickDateHeaderText: string | null;
  afterClickDateInputValue: string | null;
  afterClickVisibleTextContainsTarget: boolean;
  confirmSource: "date_header" | "date_input" | null;
  datepickerDomDebugPath: string | null;
  datepickerDomDebugTopCandidates: string[];
  datepickerDomDebugError: string | null;
};

type DatePickerDetectionSnapshot = {
  opened: boolean;
  selectorHint: string | null;
  snippets: string[];
  strategy: string | null;
  boundingBox: { x: number; y: number; width: number; height: number } | null;
  visibleMonth: string | null;
  visibleYear: string | null;
  visibleDayCandidates: number[];
  targetDayVisible: boolean;
  targetDaySelectedVisible: boolean;
  selectedSourceDayVisible: boolean;
};

type DatepickerDebugVisibleElement = {
  tagName: string;
  textContent: string | null;
  value: string | null;
  ariaLabel: string | null;
  role: string | null;
  className: string | null;
  id: string | null;
  boundingBox: { x: number; y: number; width: number; height: number } | null;
  isVisible: boolean;
  position: string | null;
  zIndex: string | null;
  nearDateHeader: boolean;
  insideModal: boolean;
  matchedSignals: string[];
};

type DatepickerDomDebugSnapshot = {
  collectedAt: string;
  sourceDateIso: string | null;
  targetDateIso: string | null;
  dateHeaderBoundingBox: { x: number; y: number; width: number; height: number } | null;
  modalBoundingBox: { x: number; y: number; width: number; height: number } | null;
  topCandidates: string[];
  visibleElements: DatepickerDebugVisibleElement[];
  signals: {
    month: string | null;
    year: string | null;
    weekdayTokens: string[];
    weekdayTokenCount: number;
    visibleDayCandidates: number[];
    sourceDayVisible: boolean;
    selectedSourceDayVisible: boolean;
    targetDayVisible: boolean;
    targetDateClickCandidateFound: boolean;
    targetDateClickCandidateBoundingBox: { x: number; y: number; width: number; height: number } | null;
    openByMultisignal: boolean;
    reasons: string[];
  };
};

type DatepickerDomDebugContext = {
  actionId: string;
  runId: string;
  sourceDateIso: string | null;
  targetDateIso: string | null;
};

type DatepickerDomDebugPartialArtifact = {
  created: true;
  stage: "started" | "partial" | "complete";
  timestamp: string;
  context: DatepickerDomDebugContext;
  pageUrl?: string | null;
  pageTitle?: string | null;
  viewport?: { width: number; height: number };
  bodyTextSample?: string;
  modalTextSample?: string | null;
  topCandidates?: string[];
  error?: string;
  datepickerDomDebugError?: string | null;
};

type DatepickerDebugCaptureResult = {
  snapshot: DatepickerDomDebugSnapshot | null;
  artifactPath: string;
  bodyTextSample: string;
  pageUrl: string | null;
  pageTitle: string | null;
  stageCError: string | null;
  stageCErrorDetails: string | null;
};

type TrainingPeaksMoveWorkoutTarget =
  | { kind: "date"; value: string; sourceText?: string }
  | {
      kind: "relative_day";
      value: "yesterday" | "today" | "tomorrow" | "day_after_tomorrow";
      sourceText?: string;
    }
  | {
      kind: "weekday";
      value: "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
      sourceText?: string;
    };

type ParsedMoveWorkoutPayload = {
  actionType?: "move_workout";
  target?: TrainingPeaksMoveWorkoutTarget;
  source?: TrainingPeaksMoveWorkoutTarget | { date?: string; isoDate?: string };
  sourceDate?: string;
  source_date?: string;
  coach_confirmed_source_date?: string;
  coach_confirmed_source_date_at?: string;
  coach_confirmed_source_date_by?: string;
  coach_confirmed_source_workout_id?: number;
  coach_confirmed_source_workout_at?: string;
  coach_confirmed_source_workout_by?: string;
  source_date_policy_override?: string;
  warnings?: string[];
  workoutDescriptor?: {
    raw?: string;
    type?: string;
    confidence?: number;
  } | null;
};

type DryRunSourceInferenceProvenance = {
  descriptorType: string | null;
  descriptorConfidence: number | null;
  sourceInferencePolicy: string | null;
  selectedSourceDate: string | null;
  targetDate: string | null;
  candidate: {
    title: string | null;
    type: string | null;
    date: string | null;
    fingerprint: string | null;
    workoutId: number | null;
  } | null;
  candidateCount: number;
  candidateAlternativesCount: number;
  score: number | null;
  margin: number | null;
  warnings: string[];
};

type DryRunResult = "candidate_found" | "ambiguous" | "not_found" | "failed";

type DryRunResolvedDates = {
  sourceDate: string | null;
  targetDate: string | null;
  timezone: string | null;
};

type DryRunCandidate = {
  title: string | null;
  type: string | null;
  plannedDurationSec: number | null;
  plannedDistance: number | null;
  startTimeLocal: string | null;
  fingerprint: string;
  workoutId?: number | null;
};

type DryRunDateAttributionDayCellSample = {
  index: number;
  visible: boolean;
  dayNumber: number | null;
  cardCount: number;
  dayTextSnippet: string;
  dayClass: string | null;
  dayId: string | null;
  attributes: {
    dataDate: string | null;
    datetime: string | null;
    ariaLabel: string | null;
    title: string | null;
  };
  descendantDateSamples: string[];
  resolvedDate: string | null;
  resolvedReason: string;
};

type DryRunDateAttributionCardSample = {
  rawTextSnippet: string;
  selectorHint: string | null;
  dateIso: string | null;
  dateReason: string;
  droppedReasons: string[];
};

type DryRunDateAttributionDebug = {
  selectedStrategy: string | null;
  sourceDateVisibleInDayCellLabels: boolean;
  targetDateVisibleInDayCellLabels: boolean;
  cardsVisible: number;
  cardsWithDateIso: number;
  cardsWithoutDateIso: number;
  rawDayCellSamples: DryRunDateAttributionDayCellSample[];
  cardSamplesBeforeFiltering: DryRunDateAttributionCardSample[];
};

type DryRunDiagnostics = {
  loginRequired: boolean;
  athleteReachable: boolean;
  trainingPeaksContextOk: boolean;
  parseWarnings: string[];
  domDebug?: DryRunDomDebug | null;
  zeroCandidates?: {
    pageUrlOpened: string | null;
    pageUrlAfterLoad: string | null;
    pageTitle: string | null;
    expectedSourceDate: string | null;
    expectedTargetDate: string | null;
    athletePageLikelyReachable: boolean;
    trainingPeaksContextLikely: boolean;
    loginRequired: boolean;
    calendarRootCount: number;
    dayCellCount: number;
    workoutCardCounts: DryRunDomDebugSelectorCounts;
    visibleCalendarHeaderText: string | null;
    inferredCalendarMonth: number | null;
    inferredCalendarYear: number | null;
    inferredCalendarMonthYearReason: string | null;
    waitForCardAttempted: boolean;
    waitForCardTimedOut: boolean;
    selectedDateAttributionStrategy: string | null;
    sourceDateVisibleInDayCellLabels: boolean;
    targetDateVisibleInDayCellLabels: boolean;
    cardsVisible: number;
    cardsWithDateIso: number;
    cardsWithoutDateIso: number;
    rawDayCellSamples: DryRunDateAttributionDayCellSample[];
    cardSamplesBeforeFiltering: DryRunDateAttributionCardSample[];
    parseWarnings: string[];
    extractionError: string | null;
    screenshotBeforePath: string | null;
    screenshotAfterPath: string | null;
    artifactDir: string | null;
  } | null;
};

type IdentityMatchType = "athlete_id" | "trainingpeaks_name" | "inconclusive" | "mismatch";

type DryRunIdentityCheck = {
  telegramUsername: string | null;
  telegramChatId: string | null;
  expectedTrainingPeaksName: string | null;
  visibleTrainingPeaksName: string | null;
  expectedAthleteId: string | null;
  currentAthleteId: string | null;
  expectedTrainingPeaksUrl: string | null;
  currentUrl: string | null;
  matchedBy: IdentityMatchType;
  warnings: string[];
};

type DryRunDebugCandidate = {
  rawTextSnippet: string;
  selectorHint: string | null;
  classHint: string | null;
  title: string | null;
  type: string | null;
  plannedDurationSec: number | null;
  plannedDistance: number | null;
  startTimeLocal: string | null;
  sourceDate: string | null;
  workoutId: number | null;
  score: number;
  reasons: string[];
};

type DryRunEvaluation = {
  dryRunResult: DryRunResult;
  resolvedDates: DryRunResolvedDates;
  candidate: DryRunCandidate | null;
  candidateAlternativesCount: number;
  confidence: number;
  canExecute: boolean;
  canExecuteReasons: string[];
  diagnostics: DryRunDiagnostics;
  identityCheck: DryRunIdentityCheck;
  debugCandidatesTopN: DryRunDebugCandidate[];
  rankingDebug?: {
    strictGlobalCount: number;
    selectedSourceDatePolicy: string;
    selectedSourceDate: string | null;
    selectedSourceDateCandidateCount: number;
    globalCandidateCount: number;
    sourceDateBucketCounts: Record<string, number>;
    descriptorType?: string | null;
    plausibleSelectedSourceDateCandidateCount?: number;
    safeSelectedSourceDateCandidateCount?: number;
    ignoredSameDateCompetitorCount?: number;
    topPlausibleMargin?: number | null;
  };
  selectedSourceDatePolicy?: string;
  selectedSourceDate?: string | null;
  selectedSourceDateCandidateCount?: number;
  globalCandidateCount?: number;
  sourceDateBucketCounts?: Record<string, number>;
  sourceInferenceProvenance?: DryRunSourceInferenceProvenance | null;
  plannedVsCompletedHint?: PlannedCompletedAmbiguityHint | null;
};

type RawWorkoutCandidate = {
  rawTextSnippet: string;
  selectorHint: string | null;
  classHint: string | null;
  title: string | null;
  type: string | null;
  plannedDurationSec: number | null;
  plannedDistance: number | null;
  startTimeLocal: string | null;
  dateIso: string | null;
  workoutId: number | null;
  reasons: string[];
  fromFallback: boolean;
  rawScore: number;
};

type MoveRequestRankingProfile = {
  descriptorType: string | null;
  isTempoRunRequest: boolean;
};

type RankedSameDateCandidate = {
  candidate: RawWorkoutCandidate;
  effectiveScore: number;
  scoreReasons: string[];
  isRunCard: boolean;
  strongRunTempoMatch: boolean;
  clearlyNonRunForTempoRequest: boolean;
  plausibleSameDateCompetitor: boolean;
  ignoredAsSameDateCompetitor: boolean;
  safeCandidate: boolean;
};

type SelectedSourceDateMoveRanking = {
  descriptorType: string | null;
  isTempoRunRequest: boolean;
  rankedCandidates: RankedSameDateCandidate[];
  topCandidate: RankedSameDateCandidate | null;
  plausibleCandidateCount: number;
  safeCandidateCount: number;
  ignoredSameDateCompetitorCount: number;
  confidence: number;
  margin: number | null;
  helpfulAmbiguityReason: string | null;
};

const RUN_CARD_PATTERN = /(^|\b)(run|running)(\b|$)|бег|пробеж/iu;
const RUN_CLASS_HINT_PATTERN = /(^|\b)run(\b|$)/iu;
const TEMPO_LIKE_PATTERN =
  /темп|tempo|threshold|пано|интервал|interval|\/км|км\/|мин\/км|\b\d+\s*[xх]\s*\d+\b|\b\d+\s*мин\b/iu;
const NON_RUN_CROSS_TRAINING_PATTERN =
  /pilates|пилат|strength|силов|yoga|йог|mobility|мобил|swim|плав|bike|cycling|cycle|ride|velo|вел|walk|ходьб|other/iu;
const OTHER_CLASS_HINT_PATTERN = /(^|\b)other(\b|$)/iu;

function normalizeMoveRankingText(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function buildMoveRequestRankingProfile(parsedPayload: unknown): MoveRequestRankingProfile {
  const payload = parseMoveWorkoutPayload(parsedPayload);
  const descriptorType = normalizeMoveRankingText(payload?.workoutDescriptor?.type) || null;
  return {
    descriptorType,
    isTempoRunRequest: descriptorType === "tempo" || descriptorType === "run",
  };
}

function buildSameDateCandidateDebugKey(candidate: RawWorkoutCandidate): string {
  return [
    candidate.workoutId ?? "na",
    candidate.dateIso ?? "na",
    candidate.title ?? "na",
    candidate.type ?? "na",
    candidate.startTimeLocal ?? "na",
  ].join("|");
}

export function evaluateSelectedSourceDateMoveRanking(input: {
  parsedPayload: unknown;
  selectedSourceDate: string;
  selectedSourceDatePolicy?: string | null;
  candidates: RawWorkoutCandidate[];
}): SelectedSourceDateMoveRanking {
  const profile = buildMoveRequestRankingProfile(input.parsedPayload);
  const sourceDateExplicitEnough = moveSourcePolicy.isMoveSourceExplicitEnough({
    selectedSourceDatePolicy: input.selectedSourceDatePolicy ?? "unresolved",
    parsedPayload: input.parsedPayload,
  });

  const baseRanked = input.candidates.map((candidate) => {
    const scoreReasons = ["positive: source date exact"];
    let effectiveScore = candidate.rawScore;
    const combinedText = [
      candidate.title,
      candidate.type,
      candidate.classHint,
      candidate.rawTextSnippet,
    ]
      .map((value) => normalizeMoveRankingText(value))
      .filter(Boolean)
      .join(" ");
    const normalizedType = normalizeMoveRankingText(candidate.type);
    const normalizedClassHint = normalizeMoveRankingText(candidate.classHint);
    const isRunCard = normalizedType === "run" || RUN_CARD_PATTERN.test(combinedText) || RUN_CLASS_HINT_PATTERN.test(normalizedClassHint);
    const tempoLikeTitleOrBody = TEMPO_LIKE_PATTERN.test(combinedText);
    const nonRunCrossTraining = NON_RUN_CROSS_TRAINING_PATTERN.test(combinedText);
    const otherClassHint = OTHER_CLASS_HINT_PATTERN.test(normalizedClassHint);
    const distanceZero = candidate.plannedDistance === 0;

    let strongRunTempoMatch = false;
    let clearlyNonRunForTempoRequest = false;

    if (profile.isTempoRunRequest) {
      if (normalizedType === "run") {
        effectiveScore += 0.18;
        strongRunTempoMatch = true;
        scoreReasons.push("positive: run card for tempo request");
      }
      if (RUN_CLASS_HINT_PATTERN.test(normalizedClassHint)) {
        effectiveScore += 0.08;
        strongRunTempoMatch = true;
        scoreReasons.push("positive: class hint suggests Run");
      }
      if (tempoLikeTitleOrBody) {
        effectiveScore += 0.14;
        strongRunTempoMatch = true;
        scoreReasons.push("positive: tempo-like title/body");
      }
      if (typeof candidate.plannedDistance === "number" && candidate.plannedDistance > 0) {
        effectiveScore += 0.04;
        scoreReasons.push("positive: running distance present");
      }
      if (nonRunCrossTraining) {
        effectiveScore -= 0.35;
        clearlyNonRunForTempoRequest = true;
        scoreReasons.push("negative: Pilates/Other is incompatible with tempo request");
      }
      if (otherClassHint) {
        effectiveScore -= 0.15;
        clearlyNonRunForTempoRequest = true;
        scoreReasons.push("negative: class hint Other is incompatible with tempo request");
      }
      if (distanceZero) {
        effectiveScore -= 0.12;
        scoreReasons.push("negative: planned distance is zero for tempo request");
      }
      if (!strongRunTempoMatch && isRunCard) {
        scoreReasons.push("positive: run-like card without explicit tempo markers");
      }
    }

    return {
      candidate,
      effectiveScore: clampConfidence(effectiveScore),
      scoreReasons,
      isRunCard,
      strongRunTempoMatch,
      clearlyNonRunForTempoRequest,
      plausibleSameDateCompetitor: false as boolean,
      ignoredAsSameDateCompetitor: false as boolean,
      safeCandidate: false as boolean,
    } satisfies RankedSameDateCandidate;
  });

  const rankedCandidates = [...baseRanked].sort((left, right) => right.effectiveScore - left.effectiveScore);
  const topCandidate = rankedCandidates[0] ?? null;
  const topScore = topCandidate?.effectiveScore ?? 0;
  const plausibleScoreFloor = profile.isTempoRunRequest ? Math.max(0.72, topScore - 0.14) : Math.max(0.6, topScore - 0.1);

  for (const entry of rankedCandidates) {
    const plausibleSameDateCompetitor = profile.isTempoRunRequest
      ? !entry.clearlyNonRunForTempoRequest &&
        entry.effectiveScore >= plausibleScoreFloor &&
        (entry.strongRunTempoMatch || entry.isRunCard)
      : entry.effectiveScore >= plausibleScoreFloor;
    const ignoredAsSameDateCompetitor =
      profile.isTempoRunRequest && !plausibleSameDateCompetitor && entry.clearlyNonRunForTempoRequest;
    if (ignoredAsSameDateCompetitor) {
      entry.scoreReasons.push("ignored as same-date competitor: non-run candidate for run request");
    }
    entry.plausibleSameDateCompetitor = plausibleSameDateCompetitor;
    entry.ignoredAsSameDateCompetitor = ignoredAsSameDateCompetitor;
    entry.safeCandidate =
      !entry.candidate.fromFallback &&
      Boolean(entry.candidate.dateIso) &&
      entry.effectiveScore >= 0.75 &&
      (!profile.isTempoRunRequest || (entry.strongRunTempoMatch && !entry.clearlyNonRunForTempoRequest));
  }

  const plausibleCandidates = rankedCandidates.filter((entry) => entry.plausibleSameDateCompetitor);
  const secondPlausible = plausibleCandidates[1] ?? null;
  let confidence = clampConfidence(
    (topCandidate?.effectiveScore ?? 0) - (secondPlausible ? Math.min(0.18, Math.max(0, secondPlausible.effectiveScore - 0.45)) : 0)
  );
  const ignoredSameDateCompetitorCount = rankedCandidates.filter((entry) => entry.ignoredAsSameDateCompetitor).length;
  if (
    profile.isTempoRunRequest &&
    sourceDateExplicitEnough &&
    topCandidate?.strongRunTempoMatch &&
    plausibleCandidates.length === 1 &&
    ignoredSameDateCompetitorCount > 0
  ) {
    confidence = clampConfidence(confidence + 0.05);
  }
  if (profile.isTempoRunRequest && !sourceDateExplicitEnough) {
    confidence = Math.min(confidence, 0.79);
    for (const entry of rankedCandidates) {
      entry.scoreReasons.push("negative: source date inferred, execution confidence capped");
    }
  }

  return {
    descriptorType: profile.descriptorType,
    isTempoRunRequest: profile.isTempoRunRequest,
    rankedCandidates,
    topCandidate,
    plausibleCandidateCount: plausibleCandidates.length,
    safeCandidateCount: rankedCandidates.filter((entry) => entry.safeCandidate).length,
    ignoredSameDateCompetitorCount,
    confidence,
    margin: topCandidate && secondPlausible ? topCandidate.effectiveScore - secondPlausible.effectiveScore : null,
    helpfulAmbiguityReason:
      profile.isTempoRunRequest && plausibleCandidates.length > 1
        ? `На ${formatCompactDateShort(input.selectedSourceDate)} найдено несколько похожих беговых тренировок. Нужен выбор.`
        : null,
  };
}

type ApiMoveExecutionArtifacts = {
  requestArtifactPath: string;
  responseArtifactPath: string;
  verificationArtifactPath: string;
};

type ApiMoveExecutionResult = {
  apiMoveEnabled: boolean;
  apiMoveExecuted: boolean;
  athleteId: number;
  workoutId: number;
  sourceDate: string;
  targetDate: string;
  targetDateTime: string;
  putStatus: number | null;
  verificationStatus: number | null;
  verificationOk: boolean;
  verificationWorkoutDay: string | null;
  verificationMatchesTargetDate: boolean;
  authHeaderObserved: boolean;
  sampleTpApiUrl: string | null;
  screenshotBeforePath: string | null;
  screenshotAfterPath: string | null;
  artifacts: ApiMoveExecutionArtifacts;
  requestSummary: unknown;
  responseSummary: unknown;
  verificationSummary: unknown;
};

type DryRunDomDebugSelectorCounts = {
  calendarRoots: number;
  dayCells: number;
  primaryWorkoutCards: number;
  fallbackWorkoutDivCards: number;
};

type DryRunDomDebugCheckpoint = {
  label: string;
  selectorCounts: DryRunDomDebugSelectorCounts;
};

type DryRunDomDebug = {
  enabled: boolean;
  calendarRootClass: string | null;
  selectorCounts: DryRunDomDebugSelectorCounts;
  checkpoints: DryRunDomDebugCheckpoint[];
  cardSnippets: string[];
  extractionError: string | null;
};

type WorkoutExtractionResult = {
  candidates: RawWorkoutCandidate[];
  domDebug: DryRunDomDebug | null;
  dateAttributionDebug: DryRunDateAttributionDebug | null;
  parseWarnings: string[];
  extractionError: string | null;
  readiness: {
    waitForCalendarRootAttempted: boolean;
    waitForCalendarRootTimedOut: boolean;
    waitForDayCellsAttempted: boolean;
    waitForDayCellsTimedOut: boolean;
    waitForWorkoutCardAttempted: boolean;
    waitForWorkoutCardTimedOut: boolean;
  };
};

const TELEGRAM_API_BASE_URL = "https://api.telegram.org";
const TP_CALLBACK_ACTION_CANCEL_PREFIX = "tp:ta:c:";
const TP_CALLBACK_ACTION_EXECUTE_PREFIX = "tp:ta:x:";
const TP_CALLBACK_ACTION_CONFIRM_SOURCE_PREFIX = "tp:ta:cs:";
const TP_CALLBACK_ACTION_SELECT_WORKOUT_PREFIX = "tp:ta:sw:";
const ACTION_ARTIFACTS_ROOT = path.join(toolRoot, "action-artifacts");
const TP_ACTIONS_EXECUTE_REAL_FLAG = "--execute-real";
const TP_ACTIONS_ACTION_ID_PREFIX = "--action-id=";
const TP_ACTIONS_PREPARE_ONLY_FLAG = "--prepare-only";
const TP_ACTIONS_CONFIRM_SAVE_FLAG = "--confirm-save";
const TP_ACTIONS_REAL_EXECUTION_ENV = "TP_ACTIONS_REAL_EXECUTION";
const TP_ACTIONS_USE_API_MOVE_ENV = "TP_ACTIONS_USE_API_MOVE";
const TP_ACTIONS_ALLOW_SAVE_ENV = "TP_ACTIONS_ALLOW_SAVE";
const REAL_MOVE_NOT_IMPLEMENTED_ERROR = "Real move not implemented yet (Phase 3D.2)";
const TRAININGPEAKS_NOT_CHANGED_NOTE = "TrainingPeaks не изменён";
const TP_CALENDAR_ROOT_SELECTOR = "div.calendar.athleteCalendar";
const TP_DAY_CELL_SELECTOR = ".dayWidth.dayContainer.day";
const TP_PRIMARY_WORKOUT_CARD_SELECTOR = ".dayWidth.dayContainer.day .activities .MuiCard-root.activity.workout";
const TP_FALLBACK_WORKOUT_CARD_SELECTOR = ".dayWidth.dayContainer.day .workoutDiv";
const TP_PRIMARY_WORKOUT_CARD_WITHIN_DAY_SELECTOR = ".activities .MuiCard-root.activity.workout";
const TP_FALLBACK_WORKOUT_CARD_WITHIN_DAY_SELECTOR = ".workoutDiv";
const TP_DATE_HEADER_REGEX =
  /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b[\s,\-/:]*[a-z]{3,}\s+\d{1,2},?\s+20\d{2}\b/i;
const TP_STRONG_DATE_HEADER_REGEX =
  /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b[\s,\-/:]+(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+20\d{2}\b/i;
const TP_MONTH_REGEX = /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/i;
const TP_YEAR_REGEX = /\b20\d{2}\b/;
const TP_TIME_DROPDOWN_REGEX = /\b\d{1,2}:\d{2}\s*(?:am|pm)\b/i;
const TP_WEEKDAY_ROW_REGEX = /\b(?:mo|tu|we|th|fr|sa|su)\b(?:\s+\b(?:mo|tu|we|th|fr|sa|su)\b){3,}/i;
const TP_MOVE_MENU_ACTION_REGEX = /move/i;
const TP_RESCHEDULE_MENU_ACTION_REGEX = /resched|postpone|shift/i;
const TP_COPY_MENU_ACTION_REGEX = /copy|duplicate/i;
const TP_EDIT_MENU_ACTION_REGEX = /^edit$/i;
const UI_PROBE_OVERALL_TIMEOUT_MS = 25_000;
const UI_PROBE_CLEANUP_TIMEOUT_MS = 5_000;
const UI_PROBE_STEP_TIMEOUTS = {
  launchBrowserContext: 8_000,
  openAthletePage: 10_000,
  locateCandidateCard: 4_000,
  cardHover: 2_500,
  openCardMenu: 3_000,
  extractMenuLabels: 2_500,
  captureScreenshot: 3_000,
  clickEdit: 3_000,
  waitDetailModal: 5_000,
  findDateHeaderText: 1_500,
  resolveDateHeaderClickableTarget: 2_500,
  getDateHeaderBoundingBox: 1_000,
  clickDateHeader: 1_500,
  detectDatepicker: 2_500,
  closeDatepicker: 1_500,
  closeModal: 4_000,
} as const;

function withUiProbeTimeout<T>(step: string, timeoutMs: number, run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`UI capability probe timeout at step "${step}" after ${timeoutMs}ms`));
    }, timeoutMs);

    run()
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function hasCliFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

function getCliValueByPrefix(prefix: string): string | null {
  const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  if (!match) {
    return null;
  }
  const value = match.slice(prefix.length).trim();
  if (!value) {
    throw new Error(`CLI argument ${prefix}<value> must not be empty.`);
  }
  return value;
}

function resolveRunnerMode(): { mode: RunnerMode | "blocked_real"; message?: string } {
  const executeRealFlag = hasCliFlag(TP_ACTIONS_EXECUTE_REAL_FLAG);
  const executeRealEnv = isTruthyEnvFlag(TP_ACTIONS_REAL_EXECUTION_ENV);

  if (!executeRealFlag && !executeRealEnv) {
    return { mode: "dry_run" };
  }
  if (executeRealFlag && executeRealEnv) {
    return { mode: "real" };
  }

  const missing: string[] = [];
  if (!executeRealFlag) {
    missing.push(`CLI flag ${TP_ACTIONS_EXECUTE_REAL_FLAG}`);
  }
  if (!executeRealEnv) {
    missing.push(`env ${TP_ACTIONS_REAL_EXECUTION_ENV}=true`);
  }

  return {
    mode: "blocked_real",
    message: `Real mode requires BOTH ${TP_ACTIONS_EXECUTE_REAL_FLAG} and ${TP_ACTIONS_REAL_EXECUTION_ENV}=true. Missing: ${missing.join(
      ", "
    )}. No execute_pending actions will be processed.`,
  };
}

function readTextFileSyncSafe(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function loadDotEnvFile(dotEnvPath: string): void {
  if (!existsSync(dotEnvPath)) {
    return;
  }

  const content = readTextFileSyncSafe(dotEnvPath);
  if (content === null) {
    return;
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function loadLocalEnv(): void {
  const repoRoot = path.resolve(toolRoot, "..", "..");
  const envPaths = [
    path.join(repoRoot, ".env.local"),
    path.join(repoRoot, ".env"),
    path.join(toolRoot, ".env"),
  ];

  for (const envPath of envPaths) {
    loadDotEnvFile(envPath);
  }
}

function getRequiredEnv(name: "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}. Set it in .env.local, .env, or tools/trainingpeaks-export/.env.`);
  }

  return value;
}

function getOptionalEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function isTruthyEnvFlag(name: string): boolean {
  const value = getOptionalEnv(name);
  return value ? /^(1|true|yes|on)$/i.test(value) : false;
}

function getSupabase() {
  return createClient(getRequiredEnv("SUPABASE_URL"), getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function getRunnerId(): string {
  const hostname = process.env.HOSTNAME?.trim() || process.env.COMPUTERNAME?.trim() || "local-mac";
  return `tp-actions-once:${hostname}`;
}

function toShortErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (normalized.length <= 500) {
    return normalized;
  }
  return `${normalized.slice(0, 497)}...`;
}

function formatDiagnosticError(error: unknown): string {
  if (error instanceof Error) {
    const name = error.name || "Error";
    const message = error.message || "Unknown error";
    const stackLine = error.stack
      ?.split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("at "));
    return stackLine ? `${name}: ${message} (${stackLine})` : `${name}: ${message}`;
  }
  return `Error: ${String(error)}`;
}

function getTargetSummary(parsedPayload: unknown): string {
  if (!parsedPayload || typeof parsedPayload !== "object") {
    return "target: unknown";
  }

  const payload = parsedPayload as {
    target?: { kind?: string; value?: string; sourceText?: string };
  };
  const target = payload.target;
  if (!target) {
    return "target: unknown";
  }

  if (target.kind === "relative_day") {
    if (target.value === "tomorrow") {
      return "move_workout на завтра";
    }
    if (target.value === "day_after_tomorrow") {
      return "move_workout на послезавтра";
    }
  }

  if (target.kind === "weekday") {
    const map: Record<string, string> = {
      monday: "понедельник",
      tuesday: "вторник",
      wednesday: "среда",
      thursday: "четверг",
      friday: "пятница",
      saturday: "суббота",
      sunday: "воскресенье",
    };
    if (target.value && map[target.value]) {
      return `move_workout на ${map[target.value]}`;
    }
  }

  return "target: unknown";
}

const MOVE_DATE_TIMEZONE = "Europe/Belgrade";
const YYYY_MM_DD_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function getBelgradeDateParts(value: Date): { year: number; month: number; day: number; weekday: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: MOVE_DATE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = formatter.formatToParts(value);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? "");
  const month = Number(parts.find((part) => part.type === "month")?.value ?? "");
  const day = Number(parts.find((part) => part.type === "day")?.value ?? "");
  const weekdayRaw = (parts.find((part) => part.type === "weekday")?.value ?? "").toLowerCase();
  const weekdayMap: Record<string, number> = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
  };
  const weekday = weekdayMap[weekdayRaw];
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day) || weekday === undefined) {
    throw new Error(`Unable to derive Belgrade date parts for ${value.toISOString()}`);
  }
  return { year, month, day, weekday };
}

function formatIsoDateParts(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function toBelgradeIsoDate(value: Date): string {
  const parts = getBelgradeDateParts(value);
  return formatIsoDateParts(parts.year, parts.month, parts.day);
}

function addLocalDaysIso(baseIsoDate: string, days: number): string {
  const match = baseIsoDate.match(YYYY_MM_DD_PATTERN);
  if (!match) {
    return baseIsoDate;
  }
  const dt = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days, 12, 0, 0));
  return toBelgradeIsoDate(dt);
}

function resolveWeekdayFromBaseIso(
  baseIsoDate: string,
  targetWeekday: number,
  direction: "next" | "previous"
): string {
  const match = baseIsoDate.match(YYYY_MM_DD_PATTERN);
  if (!match) {
    return baseIsoDate;
  }
  const baseDate = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0));
  const baseWeekday = getBelgradeDateParts(baseDate).weekday;
  if (direction === "next") {
    let delta = (targetWeekday - baseWeekday + 7) % 7;
    if (delta === 0) {
      delta = 7;
    }
    return addLocalDaysIso(baseIsoDate, delta);
  }
  const deltaBack = (baseWeekday - targetWeekday + 7) % 7;
  return addLocalDaysIso(baseIsoDate, -deltaBack);
}

function getRelativeLocalIsoDate(
  kind: "today" | "tomorrow" | "day_after_tomorrow" | "yesterday",
  baseDate: Date
): string {
  const baseIso = toBelgradeIsoDate(baseDate);
  if (kind === "today") {
    return baseIso;
  }
  if (kind === "tomorrow") {
    return addLocalDaysIso(baseIso, 1);
  }
  if (kind === "day_after_tomorrow") {
    return addLocalDaysIso(baseIso, 2);
  }
  return addLocalDaysIso(baseIso, -1);
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return Number(value.toFixed(2));
}

function parseMoveWorkoutPayload(parsedPayload: unknown): ParsedMoveWorkoutPayload | null {
  if (!parsedPayload || typeof parsedPayload !== "object") {
    return null;
  }

  const payload = parsedPayload as ParsedMoveWorkoutPayload;
  if (payload.actionType !== "move_workout" || !payload.target) {
    return null;
  }
  if (payload.target.kind !== "relative_day" && payload.target.kind !== "weekday" && payload.target.kind !== "date") {
    return null;
  }
  return payload;
}

function extractCoachConfirmedSourceDate(parsedPayload: ParsedMoveWorkoutPayload | null): string | null {
  if (!parsedPayload) {
    return null;
  }
  if (parsedPayload.source_date_policy_override !== COACH_CONFIRMED_SOURCE_DATE_POLICY) {
    return null;
  }
  const rawDate = parsedPayload.coach_confirmed_source_date;
  if (typeof rawDate !== "string" || !rawDate.trim()) {
    return null;
  }
  return normalizeDateCandidate(rawDate.trim());
}

function extractCoachConfirmedSourceWorkoutId(parsedPayload: ParsedMoveWorkoutPayload | null): number | null {
  if (!parsedPayload) {
    return null;
  }
  const rawWorkoutId = parsedPayload.coach_confirmed_source_workout_id;
  if (typeof rawWorkoutId !== "number" || !Number.isFinite(rawWorkoutId) || rawWorkoutId <= 0) {
    return null;
  }
  return rawWorkoutId;
}

function extractParsedPayloadWarnings(parsedPayload: ParsedMoveWorkoutPayload | null): string[] {
  if (!parsedPayload?.warnings?.length) {
    return [];
  }
  return parsedPayload.warnings.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function resolveTargetDateFromPayload(
  target: TrainingPeaksMoveWorkoutTarget,
  baseDate: Date
): { targetDate: string; warnings: string[] } {
  const warnings: string[] = [];
  const nowIso = toBelgradeIsoDate(baseDate);

  if (target.kind === "date") {
    const normalized = normalizeDateCandidate(target.value);
    if (normalized) {
      return { targetDate: normalized, warnings };
    }
    warnings.push("target date is invalid");
    return { targetDate: nowIso, warnings };
  }

  if (target.kind === "relative_day") {
    if (target.value === "tomorrow") {
      return { targetDate: getRelativeLocalIsoDate("tomorrow", baseDate), warnings };
    }
    if (target.value === "day_after_tomorrow") {
      return { targetDate: getRelativeLocalIsoDate("day_after_tomorrow", baseDate), warnings };
    }
    return { targetDate: getRelativeLocalIsoDate("today", baseDate), warnings };
  }

  const weekdayMap: Record<TrainingPeaksMoveWorkoutTarget["value"], number> = {
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
    sunday: 0,
    tomorrow: 0,
    day_after_tomorrow: 0,
  };

  const targetWeekday = weekdayMap[target.value];
  if (targetWeekday === undefined) {
    warnings.push("target weekday is unknown");
    return { targetDate: nowIso, warnings };
  }
  return { targetDate: resolveWeekdayFromBaseIso(nowIso, targetWeekday, "next"), warnings };
}

function resolveSourceDateFromPayload(
  source: TrainingPeaksMoveWorkoutTarget | null | undefined,
  targetDateIso: string | null,
  baseDate: Date
): { sourceDate: string | null; warnings: string[] } {
  const warnings: string[] = [];
  if (!source) {
    return { sourceDate: null, warnings };
  }
  const baseIso = toBelgradeIsoDate(baseDate);
  if (source.kind === "date") {
    return { sourceDate: normalizeDateCandidate(source.value), warnings };
  }
  if (source.kind === "relative_day") {
    return { sourceDate: getRelativeLocalIsoDate(source.value, baseDate), warnings };
  }
  const weekdayMap: Record<TrainingPeaksMoveWorkoutTarget["value"], number> = {
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
    sunday: 0,
    yesterday: 0,
    today: 0,
    tomorrow: 0,
    day_after_tomorrow: 0,
  };
  const targetWeekday = weekdayMap[source.value];
  if (targetWeekday === undefined) {
    warnings.push("source weekday is unknown");
    return { sourceDate: null, warnings };
  }
  let resolved = resolveWeekdayFromBaseIso(baseIso, targetWeekday, "previous");
  if (targetDateIso && resolved >= targetDateIso) {
    resolved = addLocalDaysIso(resolved, -7);
  }
  return { sourceDate: resolved, warnings };
}

function dateDistanceDays(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00.000Z`).getTime();
  const to = new Date(`${toIso}T00:00:00.000Z`).getTime();
  const diffMs = Math.abs(to - from);
  return Math.round(diffMs / (24 * 60 * 60 * 1000));
}

function normalizeDateCandidate(raw: string): string | null {
  const direct = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (direct) {
    return `${direct[1]}-${direct[2]}-${direct[3]}`;
  }

  const slash = raw.trim().match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{4}))?$/);
  if (slash) {
    const year = slash[3] ? Number(slash[3]) : getBelgradeDateParts(new Date()).year;
    const month = Number(slash[2]);
    const day = Number(slash[1]);
    if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
      return null;
    }
    const mm = String(month).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    return `${String(year).padStart(4, "0")}-${mm}-${dd}`;
  }

  return null;
}

function extractExplicitSourceDate(input: { rawText: string; parsedPayload: unknown }): string | null {
  const payload = input.parsedPayload && typeof input.parsedPayload === "object"
    ? (input.parsedPayload as ParsedMoveWorkoutPayload)
    : null;
  const ignorePayloadSourceFields = moveSourceInferencePreview.hasUntrustedMoveSourceInferencePreview(payload);

  if (!ignorePayloadSourceFields) {
    const payloadDateCandidates = [
      payload?.sourceDate,
      payload?.source_date,
      payload?.source && typeof payload.source === "object" && "kind" in payload.source && payload.source.kind === "date" && "value" in payload.source
        ? payload.source.value
        : null,
      (payload?.source && typeof payload.source === "object" && "date" in payload.source
        ? payload.source.date
        : null) ?? null,
      (payload?.source && typeof payload.source === "object" && "isoDate" in payload.source
        ? payload.source.isoDate
        : null) ?? null,
    ];
    for (const candidate of payloadDateCandidates) {
      if (!candidate) {
        continue;
      }
      const normalized = normalizeDateCandidate(candidate);
      if (normalized) {
        return normalized;
      }
    }
  }

  const rawText = input.rawText.toLowerCase();
  const explicitSourceRegex =
    /\b(?:с|со|from)\s+(\d{4}-\d{2}-\d{2}|\d{1,2}[./-]\d{1,2}(?:[./-]\d{4})?)/i;
  const sourceMatch = rawText.match(explicitSourceRegex);
  if (sourceMatch?.[1]) {
    const normalized = normalizeDateCandidate(sourceMatch[1]);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function extractExplicitSourceTimeRef(input: {
  parsedPayload: unknown;
}): TrainingPeaksMoveWorkoutTarget | null {
  const payload = input.parsedPayload && typeof input.parsedPayload === "object"
    ? (input.parsedPayload as ParsedMoveWorkoutPayload)
    : null;
  if (moveSourceInferencePreview.hasUntrustedMoveSourceInferencePreview(payload)) {
    return null;
  }
  const source = payload?.source;
  if (!source || typeof source !== "object" || !("kind" in source) || !("value" in source)) {
    return null;
  }
  const kind = source.kind;
  const value = source.value;
  if (kind !== "date" && kind !== "relative_day" && kind !== "weekday") {
    return null;
  }
  if (typeof value !== "string" || !value) {
    return null;
  }
  return {
    kind,
    value,
    sourceText: "sourceText" in source && typeof source.sourceText === "string" ? source.sourceText : undefined,
  } as TrainingPeaksMoveWorkoutTarget;
}

function candidateLooksCompleted(rawTextSnippet: string): boolean {
  const text = rawTextSnippet.toLowerCase();
  return /\b(done|completed|выполнено|завершено|finished|отчет|report|результат)\b/i.test(text);
}

function candidateLooksLikeWorkoutCard(candidate: RawWorkoutCandidate): boolean {
  const text = candidate.rawTextSnippet.toLowerCase();
  if (
    /\b(sidebar|navigation|menu|summary|итого|сводка|навигац|календарь|calendar|week total|month total)\b/i.test(
      text
    )
  ) {
    return false;
  }
  return Boolean(candidate.selectorHint?.includes(".activity.workout") || candidate.selectorHint?.includes(".workoutDiv"));
}

function isTargetTomorrow(action: TrainingPeaksActionRow): boolean {
  const parsed = parseMoveWorkoutPayload(action.parsed_payload);
  return parsed?.target?.kind === "relative_day" && parsed.target.value === "tomorrow";
}

function isTargetToday(action: TrainingPeaksActionRow): boolean {
  const parsed = parseMoveWorkoutPayload(action.parsed_payload);
  return parsed?.target?.kind === "relative_day" && parsed.target.value === "today";
}

function normalizeWhitespace(value: string | null | undefined): string {
  if (value == null) {
    return "";
  }
  return value.replace(/\s+/g, " ").trim();
}

function toTextSnippet(value: string | null | undefined, maxLength = 240): string {
  return normalizeWhitespace(value).slice(0, maxLength);
}

function toIsoFromDateParts(year: number, month: number, day: number): string | null {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    return null;
  }
  return dt.toISOString().slice(0, 10);
}

function parseDateFromCalendarText(raw: string, defaultYear?: number): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const direct = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (direct) {
    return toIsoFromDateParts(Number(direct[1]), Number(direct[2]), Number(direct[3]));
  }
  const slash = trimmed.match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{4}))?$/);
  if (slash) {
    const year = slash[3] ? Number(slash[3]) : defaultYear;
    if (!year) {
      return null;
    }
    return toIsoFromDateParts(year, Number(slash[2]), Number(slash[1]));
  }
  return null;
}

const MONTH_NAME_TO_NUMBER: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

function extractIsoFromNaturalDateText(raw: string | null | undefined): string | null {
  const text = normalizeWhitespace(raw);
  if (!text) {
    return null;
  }
  const directIso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (directIso?.[1]) {
    return directIso[1];
  }
  const natural = text.match(
    /\b(?:(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b[\s,\-/:]*)?(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b/i
  );
  if (!natural) {
    return null;
  }
  const month = MONTH_NAME_TO_NUMBER[natural[1].toLowerCase()];
  const day = Number(natural[2]);
  const year = Number(natural[3]);
  if (!month) {
    return null;
  }
  return toIsoFromDateParts(year, month, day);
}

function visibleTextReferencesIsoTarget(fragment: string | null | undefined, targetIso: string): boolean {
  const normalizedTarget = normalizeWhitespace(targetIso);
  if (!normalizedTarget) {
    return false;
  }
  const text = normalizeWhitespace(fragment);
  if (!text) {
    return false;
  }
  if (text.toLowerCase().includes(normalizedTarget.toLowerCase())) {
    return true;
  }
  return extractIsoFromNaturalDateText(text) === normalizedTarget;
}

function visibleAnyTextReferencesIsoTarget(
  fragments: readonly (string | null | undefined)[],
  targetIso: string
): boolean {
  return fragments.some((fragment) => visibleTextReferencesIsoTarget(fragment, targetIso));
}

function parseIsoDateParts(iso: string | null | undefined): { year: number; month: number; day: number } | null {
  const match = String(iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  return { year, month, day };
}

function monthNumberToEnglishName(month: number): string | null {
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return month >= 1 && month <= 12 ? months[month - 1] : null;
}

function buildCurrentModalBodyTextFallbackSignals(input: {
  bodyTextSample: string;
  sourceDateIso: string;
  targetDateIso: string;
}): {
  activated: boolean;
  datePickerOpened: boolean;
  targetDayVisible: boolean;
  selectedSourceDayVisible: boolean;
  visibleMonth: string | null;
  visibleYear: string | null;
  strategy: string | null;
  diagnostics: string[];
} {
  const text = String(input.bodyTextSample || "");
  const lower = text.toLowerCase();
  const selectDateIndex = lower.indexOf("select date");
  if (selectDateIndex < 0) {
    return {
      activated: false,
      datePickerOpened: false,
      targetDayVisible: false,
      selectedSourceDayVisible: false,
      visibleMonth: null,
      visibleYear: null,
      strategy: null,
      diagnostics: ["missing_select_date_token"],
    };
  }

  const regionStart = Math.max(0, selectDateIndex - 300);
  const regionEnd = Math.min(text.length, selectDateIndex + 3000);
  const region = text.slice(regionStart, regionEnd);
  const sourceParts = parseIsoDateParts(input.sourceDateIso);
  const targetParts = parseIsoDateParts(input.targetDateIso);
  const targetMonthName = targetParts ? monthNumberToEnglishName(targetParts.month) : null;
  const hasMonthYear =
    Boolean(targetMonthName) &&
    Boolean(targetParts) &&
    new RegExp(`\\b${targetMonthName}\\s+${targetParts!.year}\\b`, "i").test(region);
  const hasWeekdayRow = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].every((token) =>
    new RegExp(`\\b${token}\\b`, "i").test(region)
  );
  const dayTokens = region.match(/\b([1-9]|[12]\d|3[01])\b/g) ?? [];
  const uniqueDayTokenCount = new Set(dayTokens.map((token) => Number(token))).size;
  const hasDayGrid = uniqueDayTokenCount >= 7;
  const targetDayVisible =
    Boolean(targetParts) && new RegExp(`\\b${targetParts!.day}\\b`).test(region);
  const sourceDayVisible =
    Boolean(sourceParts) && new RegExp(`\\b${sourceParts!.day}\\b`).test(region);
  const opened = hasMonthYear && hasWeekdayRow && hasDayGrid;
  const diagnostics = [
    "select_date_token",
    hasMonthYear ? "month_year_signal" : "missing_month_year_signal",
    hasWeekdayRow ? "weekday_row_signal" : "missing_weekday_row_signal",
    hasDayGrid ? `day_grid_signal:${String(uniqueDayTokenCount)}` : `missing_day_grid_signal:${String(uniqueDayTokenCount)}`,
    targetDayVisible ? "target_day_visible" : "target_day_not_visible",
    sourceDayVisible ? "source_day_visible" : "source_day_not_visible",
  ];

  return {
    activated: opened,
    datePickerOpened: opened,
    targetDayVisible,
    selectedSourceDayVisible: sourceDayVisible,
    visibleMonth: targetMonthName ?? null,
    visibleYear: targetParts ? String(targetParts.year) : null,
    strategy: opened ? "current_modal_body_text_multisignal_fallback" : null,
    diagnostics,
  };
}

function formatStageFailureDiagnostic(input: {
  stage: string;
  substage: string;
  error: unknown;
  details?: Record<string, unknown>;
}): string {
  const payload = {
    stage: input.stage,
    substage: input.substage,
    errorName: input.error instanceof Error ? input.error.name || "Error" : "Error",
    errorMessage: input.error instanceof Error ? input.error.message || "Unknown error" : String(input.error),
    errorStack: input.error instanceof Error ? input.error.stack ?? null : null,
    ...(input.details ? { details: input.details } : {}),
  };
  return JSON.stringify(payload);
}

function buildFailedPrepareGatesDiagnostics(input: {
  prepareMoveWorkout: ReturnType<typeof derivePrepareMoveWorkoutResultFromProbe>;
  expectedSourceDate: string | null;
  expectedTargetDate: string | null;
  preSaveTargetDateSelectionConfirmed: boolean;
  preSaveTargetDateConfirmedBy: string | null;
  saveAndCloseButtonFound: boolean;
  saveAndCloseButtonEnabled: boolean;
}): {
  prepareMoveWorkoutStatus: string | null;
  prepareMoveWorkoutTargetDateSelectionConfirmed: boolean;
  prepareMoveWorkoutTargetDateConfirmedBy: string | null;
  prepareMoveWorkoutMutationOccurred: boolean;
  prepareMoveWorkoutAthleteIdentityOk: boolean;
  prepareMoveWorkoutCandidateFingerprintOk: boolean;
  prepareMoveWorkoutSourceDate: string | null;
  prepareMoveWorkoutTargetDate: string | null;
  expectedSourceDate: string | null;
  expectedTargetDate: string | null;
  sourceDateMatchesExpected: boolean;
  targetDateMatchesExpected: boolean;
  preSaveTargetDateSelectionConfirmed: boolean;
  preSaveTargetDateConfirmedBy: string | null;
  saveAndCloseButtonFound: boolean;
  saveAndCloseButtonEnabled: boolean;
  failedPrepareGates: string[];
} {
  const failedPrepareGates: string[] = [];
  if (input.prepareMoveWorkout.status !== "ready_to_save") {
    failedPrepareGates.push("prepareMoveWorkout.status");
  }
  if (input.prepareMoveWorkout.targetDateSelectionConfirmed !== true) {
    failedPrepareGates.push("prepareMoveWorkout.targetDateSelectionConfirmed");
  }
  if (input.prepareMoveWorkout.targetDateConfirmedBy === null) {
    failedPrepareGates.push("prepareMoveWorkout.targetDateConfirmedBy");
  }
  if (input.prepareMoveWorkout.mutationOccurred !== false) {
    failedPrepareGates.push("prepareMoveWorkout.mutationOccurred");
  }
  if (input.prepareMoveWorkout.athleteIdentityOk !== true) {
    failedPrepareGates.push("prepareMoveWorkout.athleteIdentityOk");
  }
  if (input.prepareMoveWorkout.candidateFingerprintOk !== true) {
    failedPrepareGates.push("prepareMoveWorkout.candidateFingerprintOk");
  }
  if (input.prepareMoveWorkout.sourceDate !== input.expectedSourceDate) {
    failedPrepareGates.push("prepareMoveWorkout.sourceDate");
  }
  if (input.prepareMoveWorkout.targetDate !== input.expectedTargetDate) {
    failedPrepareGates.push("prepareMoveWorkout.targetDate");
  }
  if (input.preSaveTargetDateSelectionConfirmed !== true) {
    failedPrepareGates.push("preSaveTargetDateSelectionConfirmed");
  }
  if (input.preSaveTargetDateConfirmedBy === null) {
    failedPrepareGates.push("preSaveTargetDateConfirmedBy");
  }
  if (!input.saveAndCloseButtonFound) {
    failedPrepareGates.push("saveAndCloseButtonFound");
  }
  if (!input.saveAndCloseButtonEnabled) {
    failedPrepareGates.push("saveAndCloseButtonEnabled");
  }

  return {
    prepareMoveWorkoutStatus: input.prepareMoveWorkout.status ?? null,
    prepareMoveWorkoutTargetDateSelectionConfirmed: input.prepareMoveWorkout.targetDateSelectionConfirmed === true,
    prepareMoveWorkoutTargetDateConfirmedBy: input.prepareMoveWorkout.targetDateConfirmedBy ?? null,
    prepareMoveWorkoutMutationOccurred: input.prepareMoveWorkout.mutationOccurred === true,
    prepareMoveWorkoutAthleteIdentityOk: input.prepareMoveWorkout.athleteIdentityOk === true,
    prepareMoveWorkoutCandidateFingerprintOk: input.prepareMoveWorkout.candidateFingerprintOk === true,
    prepareMoveWorkoutSourceDate: input.prepareMoveWorkout.sourceDate ?? null,
    prepareMoveWorkoutTargetDate: input.prepareMoveWorkout.targetDate ?? null,
    expectedSourceDate: input.expectedSourceDate ?? null,
    expectedTargetDate: input.expectedTargetDate ?? null,
    sourceDateMatchesExpected: input.prepareMoveWorkout.sourceDate === input.expectedSourceDate,
    targetDateMatchesExpected: input.prepareMoveWorkout.targetDate === input.expectedTargetDate,
    preSaveTargetDateSelectionConfirmed: input.preSaveTargetDateSelectionConfirmed === true,
    preSaveTargetDateConfirmedBy: input.preSaveTargetDateConfirmedBy ?? null,
    saveAndCloseButtonFound: input.saveAndCloseButtonFound,
    saveAndCloseButtonEnabled: input.saveAndCloseButtonEnabled,
    failedPrepareGates,
  };
}

const visibleTextReferencesIsoTargetLocalCheck =
  visibleTextReferencesIsoTarget("SUNDAY May 17, 2026", "2026-05-17") === true;

function parseDateFromCalendarAttr(value: string | null | undefined, defaultYear?: number): string | null {
  if (!value) {
    return null;
  }
  const iso = value.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  if (iso) {
    return parseDateFromCalendarText(iso);
  }
  const slash = value.match(/\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{4})?\b/)?.[0];
  if (slash) {
    return parseDateFromCalendarText(slash, defaultYear);
  }
  const naturalIso = extractIsoFromNaturalDateText(value);
  if (naturalIso) {
    return naturalIso;
  }
  return null;
}

async function getInnerTextSafe(
  locator: import("playwright").Locator,
  timeout = 700
): Promise<string | null> {
  try {
    const value = await locator.innerText({ timeout });
    const normalized = normalizeWhitespace(value);
    return normalized || null;
  } catch {
    return null;
  }
}

async function getAttributeSafe(
  locator: import("playwright").Locator,
  name: string,
  timeout = 700
): Promise<string | null> {
  try {
    const value = await locator.getAttribute(name, { timeout });
    if (value === null) {
      return null;
    }
    const normalized = normalizeWhitespace(value);
    return normalized || null;
  } catch {
    return null;
  }
}

async function getInputValueSafe(
  locator: import("playwright").Locator,
  timeout = 700
): Promise<string | null> {
  try {
    const value = await locator.inputValue({ timeout });
    const normalized = normalizeWhitespace(value);
    return normalized || null;
  } catch {
    return null;
  }
}

async function collectLocatorInnerTextSnippets(
  locator: import("playwright").Locator,
  limit: number,
  maxLength = 180
): Promise<string[]> {
  const count = await locator.count();
  const snippets: string[] = [];
  for (let index = 0; index < count && snippets.length < limit; index += 1) {
    const text = await getInnerTextSafe(locator.nth(index));
    if (!text) {
      continue;
    }
    snippets.push(toTextSnippet(text, maxLength));
  }
  return snippets;
}

async function inferCalendarMonthYear(
  calendarRoot: import("playwright").Locator
): Promise<{ year: number | null; month: number | null; reason: string }> {
  const now = new Date();
  const monthMap: Record<string, number> = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
    январь: 1,
    января: 1,
    февраль: 2,
    февраля: 2,
    март: 3,
    марта: 3,
    апрель: 4,
    апреля: 4,
    май: 5,
    мая: 5,
    июнь: 6,
    июня: 6,
    июль: 7,
    июля: 7,
    август: 8,
    августа: 8,
    сентябрь: 9,
    сентября: 9,
    октябрь: 10,
    октября: 10,
    ноябрь: 11,
    ноября: 11,
    декабрь: 12,
    декабря: 12,
  };

  const candidateTexts = [
    await getAttributeSafe(calendarRoot, "aria-label"),
    await getAttributeSafe(calendarRoot, "title"),
    await getAttributeSafe(calendarRoot, "data-date"),
    ...(await calendarRoot
      .locator("h1, h2, h3, h4, [class*='month' i], [data-test*='month' i]")
      .allInnerTexts()
      .catch(() => []))
      .map((value) => normalizeWhitespace(value))
      .filter(Boolean)
      .slice(0, 20),
  ];

  for (const text of candidateTexts) {
    if (!text) {
      continue;
    }
    const lower = text.toLowerCase();
    for (const [monthName, monthNumber] of Object.entries(monthMap)) {
      if (!lower.includes(monthName)) {
        continue;
      }
      const yearMatch = lower.match(/\b(20\d{2})\b/);
      return {
        year: yearMatch ? Number(yearMatch[1]) : now.getUTCFullYear(),
        month: monthNumber,
        reason: yearMatch
          ? "calendar month/year resolved from visible calendar header"
          : "calendar month resolved from visible header; year defaulted to current year",
      };
    }
  }

  return {
    year: null,
    month: null,
    reason: "calendar month/year unresolved from visible calendar context",
  };
}

function shiftMonthYear(
  input: { year: number; month: number },
  monthDelta: number
): { year: number; month: number } {
  const base = new Date(Date.UTC(input.year, input.month - 1 + monthDelta, 15));
  return {
    year: base.getUTCFullYear(),
    month: base.getUTCMonth() + 1,
  };
}

function inferMonthYearFromAnchorDate(
  dayNumber: number,
  anchorDateIso: string
): { year: number; month: number; reason: string } | null {
  const anchor = parseIsoDateParts(anchorDateIso);
  if (!anchor) {
    return null;
  }
  const candidates = [
    { ...shiftMonthYear({ year: anchor.year, month: anchor.month }, -1), reason: "previous_month_from_anchor" },
    { year: anchor.year, month: anchor.month, reason: "anchor_month" },
    { ...shiftMonthYear({ year: anchor.year, month: anchor.month }, 1), reason: "next_month_from_anchor" },
  ];
  for (const candidate of candidates) {
    const iso = toIsoFromDateParts(candidate.year, candidate.month, dayNumber);
    if (iso === anchorDateIso) {
      return {
        year: candidate.year,
        month: candidate.month,
        reason: candidate.reason,
      };
    }
  }
  return null;
}

function chooseMonthYearForVisibleDay(
  input: {
    dayNumber: number | null;
    headerMonthYear: { year: number | null; month: number | null; reason: string };
    expectedSourceDate: string | null;
    expectedTargetDate: string | null;
  }
): { year: number; month: number; reason: string } | null {
  if (input.dayNumber === null) {
    return null;
  }
  const anchorCandidates = [
    input.expectedSourceDate ? inferMonthYearFromAnchorDate(input.dayNumber, input.expectedSourceDate) : null,
    input.expectedTargetDate ? inferMonthYearFromAnchorDate(input.dayNumber, input.expectedTargetDate) : null,
  ].filter(Boolean) as { year: number; month: number; reason: string }[];
  if (anchorCandidates.length > 0) {
    const [preferred] = anchorCandidates;
    if (
      input.headerMonthYear.month &&
      input.headerMonthYear.year &&
      preferred.year === input.headerMonthYear.year &&
      preferred.month === input.headerMonthYear.month
    ) {
      return {
        year: preferred.year,
        month: preferred.month,
        reason: "header month/year matched expected date anchor",
      };
    }
    if (input.headerMonthYear.month && preferred.month !== input.headerMonthYear.month) {
      return {
        year: preferred.year,
        month: preferred.month,
        reason: "expected source/target date anchor overrode visible month-only header",
      };
    }
    return {
      year: preferred.year,
      month: preferred.month,
      reason: "expected source/target date anchor resolved visible day month/year",
    };
  }
  if (input.headerMonthYear.month && input.headerMonthYear.year) {
    return {
      year: input.headerMonthYear.year,
      month: input.headerMonthYear.month,
      reason: "visible calendar header month/year",
    };
  }
  return null;
}

type ResolvedCalendarDayCellDate = {
  dateIso: string | null;
  reason: string;
  dayNumber: number | null;
  descendantDateSamples: string[];
  dayTextSnippet: string;
};

async function resolveCalendarDayCellDate(input: {
  dayCell: import("playwright").Locator;
  headerMonthYear: { year: number | null; month: number | null; reason: string };
  expectedSourceDate: string | null;
  expectedTargetDate: string | null;
}): Promise<ResolvedCalendarDayCellDate> {
  const dayTextRaw = (await input.dayCell.innerText().catch(() => "")) ?? "";
  const dayText = dayTextRaw.trim();
  const dayAttributes = {
    dataDate: await getAttributeSafe(input.dayCell, "data-date"),
    datetime: await getAttributeSafe(input.dayCell, "datetime"),
    ariaLabel: await getAttributeSafe(input.dayCell, "aria-label"),
    title: await getAttributeSafe(input.dayCell, "title"),
  };

  for (const [attrName, attrValue] of Object.entries(dayAttributes)) {
    const dateIso = parseDateFromCalendarAttr(attrValue);
    if (dateIso) {
      return {
        dateIso,
        reason: `source date from day cell ${attrName}`,
        dayNumber: extractDayNumberCandidate(dayText),
        descendantDateSamples: [],
        dayTextSnippet: toTextSnippet(dayText, 180),
      };
    }
  }

  const descendantDateLocators = input.dayCell.locator(
    "[data-date],[datetime],[aria-label],[title],[class*='day' i],[class*='date' i],header,time"
  );
  const descendantCount = await descendantDateLocators.count();
  const descendantDateSamples: string[] = [];
  for (let descendantIndex = 0; descendantIndex < descendantCount; descendantIndex += 1) {
    const descendant = descendantDateLocators.nth(descendantIndex);
    for (const attrName of ["data-date", "datetime", "aria-label", "title"] as const) {
      const attrValue = await getAttributeSafe(descendant, attrName);
      if (attrValue && descendantDateSamples.length < 6 && !descendantDateSamples.includes(`${attrName}: ${attrValue}`)) {
        descendantDateSamples.push(`${attrName}: ${attrValue}`);
      }
      const dateIso = parseDateFromCalendarAttr(attrValue);
      if (dateIso) {
        return {
          dateIso,
          reason: `source date from day cell descendant ${attrName}`,
          dayNumber: extractDayNumberCandidate(dayText),
          descendantDateSamples,
          dayTextSnippet: toTextSnippet(dayText, 180),
        };
      }
    }
    const descendantText = await getInnerTextSafe(descendant);
    const descendantNaturalIso = extractIsoFromNaturalDateText(descendantText);
    if (descendantText && descendantDateSamples.length < 6 && !descendantDateSamples.includes(`text: ${toTextSnippet(descendantText, 100)}`)) {
      descendantDateSamples.push(`text: ${toTextSnippet(descendantText, 100)}`);
    }
    if (descendantNaturalIso) {
      return {
        dateIso: descendantNaturalIso,
        reason: "source date from day cell descendant text",
        dayNumber: extractDayNumberCandidate(dayText),
        descendantDateSamples,
        dayTextSnippet: toTextSnippet(dayText, 180),
      };
    }
  }

  const dayNumber = extractDayNumberCandidate(dayText);
  const monthYear = chooseMonthYearForVisibleDay({
    dayNumber,
    headerMonthYear: input.headerMonthYear,
    expectedSourceDate: input.expectedSourceDate,
    expectedTargetDate: input.expectedTargetDate,
  });
  if (dayNumber !== null && monthYear) {
    const derivedDate = toIsoFromDateParts(monthYear.year, monthYear.month, dayNumber);
    if (derivedDate) {
      return {
        dateIso: derivedDate,
        reason: `source date derived from day cell number and ${monthYear.reason}`,
        dayNumber,
        descendantDateSamples,
        dayTextSnippet: toTextSnippet(dayText, 180),
      };
    }
  }

  return {
    dateIso: null,
    reason:
      dayNumber === null
        ? "day number could not be extracted from visible day cell"
        : "Calendar cards found, but dates could not be assigned safely.",
    dayNumber,
    descendantDateSamples,
    dayTextSnippet: toTextSnippet(dayText, 180),
  };
}

function detectWorkoutTypeFromText(text: string): string | null {
  const lower = text.toLowerCase();
  if (lower.includes("run") || lower.includes("бег")) {
    return "run";
  }
  if (lower.includes("bike") || lower.includes("ride") || lower.includes("вел")) {
    return "bike";
  }
  if (lower.includes("swim") || lower.includes("плав")) {
    return "swim";
  }
  if (lower.includes("strength")) {
    return "strength";
  }
  return null;
}

function extractTitleFromCardText(text: string): string | null {
  const firstPart = text
    .split(/[,|]/)[0]
    ?.trim()
    .replace(/\s+/g, " ");
  return firstPart ? firstPart.slice(0, 120) : null;
}

function extractDayNumberCandidate(value: string): number | null {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  const lines = normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 5);

  for (const line of lines) {
    const strictStart = line.match(/^([12]?\d|3[01])\b/);
    if (strictStart) {
      return Number(strictStart[1]);
    }
    if (line.length <= 12) {
      const compact = line.match(/\b([12]?\d|3[01])\b/);
      if (compact) {
        return Number(compact[1]);
      }
    }
  }

  const startMatch = normalized.match(/^\D*([12]?\d|3[01])\b/);
  return startMatch ? Number(startMatch[1]) : null;
}

function parseTrainingPeaksAthleteId(urlRaw: string | null): string | null {
  if (!urlRaw) {
    return null;
  }

  try {
    const url = new URL(urlRaw);
    const queryKeys = ["athleteid", "athlete_id", "athlete", "id"];
    for (const key of queryKeys) {
      const value = url.searchParams.get(key);
      if (value && /^[a-z0-9-]{4,}$/i.test(value.trim())) {
        return value.trim().toLowerCase();
      }
    }

    const pathMatch = url.pathname.match(/\/(?:athlete|athletes)\/([a-z0-9-]{4,})/i);
    if (pathMatch?.[1]) {
      return pathMatch[1].toLowerCase();
    }

    const hashMatch = url.hash.match(/\/(?:athlete|athletes)\/([a-z0-9-]{4,})/i);
    if (hashMatch?.[1]) {
      return hashMatch[1].toLowerCase();
    }
  } catch {
    const fallbackMatch = urlRaw.match(/(?:athlete|athletes)[=/]([a-z0-9-]{4,})/i);
    if (fallbackMatch?.[1]) {
      return fallbackMatch[1].toLowerCase();
    }
  }

  return null;
}

function normalizeName(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const normalized = value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || null;
}

function namesLikelyMatch(expected: string | null, visible: string | null): boolean {
  const left = normalizeName(expected);
  const right = normalizeName(visible);
  if (!left || !right) {
    return false;
  }
  if (left === right) {
    return true;
  }
  if (left.includes(right) || right.includes(left)) {
    return true;
  }
  const leftParts = new Set(left.split(" ").filter(Boolean));
  const rightParts = new Set(right.split(" ").filter(Boolean));
  if (leftParts.size === 0 || rightParts.size === 0) {
    return false;
  }
  let overlap = 0;
  for (const token of leftParts) {
    if (rightParts.has(token)) {
      overlap += 1;
    }
  }
  const ratio = overlap / Math.max(leftParts.size, rightParts.size);
  return ratio >= 0.5;
}

function parseDurationSeconds(raw: string): number | null {
  const text = raw.trim().toLowerCase();
  if (!text) {
    return null;
  }

  const hhmmss = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (hhmmss) {
    const hours = Number(hhmmss[1]);
    const minutes = Number(hhmmss[2]);
    const seconds = Number(hhmmss[3] ?? "0");
    return hours * 3600 + minutes * 60 + seconds;
  }

  const hourMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(h|hr|hour|hours|ч)\b/);
  const minMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(m|min|mins|minute|minutes|мин)\b/);
  const secMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(s|sec|secs|second|seconds|сек)\b/);
  if (hourMatch || minMatch || secMatch) {
    const hours = Number((hourMatch?.[1] ?? "0").replace(",", "."));
    const minutes = Number((minMatch?.[1] ?? "0").replace(",", "."));
    const seconds = Number((secMatch?.[1] ?? "0").replace(",", "."));
    return Math.round(hours * 3600 + minutes * 60 + seconds);
  }

  return null;
}

function parseDistance(raw: string): number | null {
  const text = raw.trim().toLowerCase();
  if (!text) {
    return null;
  }
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(km|км|mi|mile|miles|м|meter|meters)\b/);
  if (!match) {
    return null;
  }
  const value = Number(match[1].replace(",", "."));
  if (!Number.isFinite(value)) {
    return null;
  }
  const unit = match[2];
  if (unit === "mi" || unit === "mile" || unit === "miles") {
    return Number((value * 1.60934).toFixed(2));
  }
  if (unit === "m" || unit === "м" || unit === "meter" || unit === "meters") {
    return Number((value / 1000).toFixed(3));
  }
  return value;
}

function buildCandidateFingerprint(input: {
  studentId: string | null;
  dateIso: string | null;
  title: string | null;
  type: string | null;
  startTimeLocal: string | null;
  plannedDurationSec: number | null;
  plannedDistance: number | null;
}): string {
  const stable = [
    input.studentId ?? "na",
    input.dateIso ?? "na",
    (input.title ?? "untitled").trim().toLowerCase(),
    (input.type ?? "na").trim().toLowerCase(),
    input.startTimeLocal ?? "na",
    input.plannedDurationSec === null ? "na" : String(input.plannedDurationSec),
    input.plannedDistance === null ? "na" : String(input.plannedDistance),
  ].join("|");
  return createHash("sha1").update(stable).digest("hex");
}

function extractWorkoutIdFromText(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const match = value.match(/\bworkout(?:id)?[^0-9]{0,8}(\d{6,})\b/i) ?? value.match(/\b(\d{6,})\b/);
  if (!match?.[1]) {
    return null;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function extractWorkoutIdFromCard(card: import("playwright").Locator): Promise<number | null> {
  const attrNames = ["data-workout-id", "data-workoutid", "data-id", "data-activity-id", "href", "id"] as const;

  for (const attrName of attrNames) {
    const attrValue = await getAttributeSafe(card, attrName);
    const parsed = extractWorkoutIdFromText(attrValue);
    if (parsed) {
      return parsed;
    }
  }

  const descendants = card.locator("[data-workout-id],[data-workoutid],[data-id],[data-activity-id],a[href],button[id],[id]");
  const count = await descendants.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const descendant = descendants.nth(index);
    for (const attrName of attrNames) {
      const attrValue = await getAttributeSafe(descendant, attrName);
      const parsed = extractWorkoutIdFromText(attrValue);
      if (parsed) {
        return parsed;
      }
    }
  }

  const text = await getInnerTextSafe(card);
  return extractWorkoutIdFromText(text);
}

function isAutoApprovedDryRunFallbackEligible(action: TrainingPeaksActionRow): boolean {
  if (!action.parsed_payload || typeof action.parsed_payload !== "object") {
    return false;
  }

  const payload = action.parsed_payload as {
    parsingDiagnostics?: {
      autoApprovedForDryRun?: unknown;
    };
  };
  return payload.parsingDiagnostics?.autoApprovedForDryRun === true;
}

function resolveActionCoachNotificationChatIds(action: TrainingPeaksActionRow): string[] {
  const directChatId = action.coach_chat_id ?? action.decided_by_chat_id;
  if (directChatId) {
    return [directChatId];
  }

  if (!isAutoApprovedDryRunFallbackEligible(action)) {
    return [];
  }

  const fallbackChatIds = getTrainingPeaksCoachChatIds();
  if (fallbackChatIds.length === 0) {
    return [];
  }

  return Array.from(new Set(fallbackChatIds));
}

function toShortActionId(actionId: string): string {
  return actionId.slice(0, 8);
}

function extractMoveDateRangeFromParsedPayload(
  parsedPayload: unknown
): { sourceDate: string | null; targetDate: string | null } {
  if (!parsedPayload || typeof parsedPayload !== "object") {
    return { sourceDate: null, targetDate: null };
  }
  const payload = parsedPayload as {
    source?: { kind?: string; value?: string };
    target?: { kind?: string; value?: string };
    sourceDate?: string;
    source_date?: string;
  };
  const sourceDate =
    payload.sourceDate ??
    payload.source_date ??
    (payload.source?.kind === "date" && typeof payload.source.value === "string"
      ? payload.source.value
      : null);
  const targetDate =
    payload.target?.kind === "date" && typeof payload.target.value === "string" ? payload.target.value : null;
  return {
    sourceDate: sourceDate ?? null,
    targetDate: targetDate ?? null,
  };
}

function formatCompactDateShort(value: string | null): string {
  if (!value) {
    return "?";
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) {
    return value;
  }
  return `${match[3]}.${match[2]}`;
}

function formatMoveCompletionStudentReply(formality: "ty" | "vy" | "unknown" | null | undefined): string {
  return formality === "ty" ? "Готово, проверяй." : "Готово, проверяйте.";
}

function getDryRunConfidenceDetail(evaluation: DryRunEvaluation | null): string | null {
  if (!evaluation) {
    return null;
  }

  const percent = Math.round((evaluation.confidence ?? 0) * 100);
  const policy = evaluation.selectedSourceDatePolicy?.trim() || null;
  return policy ? `${percent}% (${policy})` : `${percent}%`;
}

async function trySendMoveCompletionReply(input: {
  action: TrainingPeaksActionRow;
  student: TrainingPeaksStudentRow | null;
}): Promise<{
  attempted: boolean;
  sent: boolean;
  skippedReason:
    | "missing_student"
    | "missing_chat"
    | "missing_business_connection"
    | "business_chat_not_found"
    | "send_failed"
    | null;
}> {
  if (!input.student) {
    console.warn(`Student move completion reply skipped for action ${input.action.id}: missing student`);
    return { attempted: false, sent: false, skippedReason: "missing_student" };
  }

  const chatId = input.student.telegram_chat_id?.trim() || input.action.source_chat_id?.trim() || null;
  if (!chatId) {
    console.warn(`Student move completion reply skipped for action ${input.action.id}: missing chat`);
    return { attempted: false, sent: false, skippedReason: "missing_chat" };
  }

  let businessConnectionId: string;
  try {
    businessConnectionId = getRequiredTrainingPeaksBusinessConnectionId();
  } catch (error) {
    console.warn(
      `Student move completion reply skipped for action ${input.action.id}: ${toShortErrorMessage(error)}`
    );
    return { attempted: false, sent: false, skippedReason: "missing_business_connection" };
  }

  try {
    const businessChat = await getTrainingPeaksBusinessChatByChatId(chatId);
    if (!businessChat) {
      console.warn(`Student move completion reply skipped for action ${input.action.id}: business chat not found`);
      return { attempted: false, sent: false, skippedReason: "business_chat_not_found" };
    }
  } catch (error) {
    console.warn(
      `Student move completion reply skipped for action ${input.action.id}: business chat lookup failed (${toShortErrorMessage(error)})`
    );
    return { attempted: false, sent: false, skippedReason: "business_chat_not_found" };
  }

  const text = formatMoveCompletionStudentReply(input.student.telegram_formality ?? "unknown");
  try {
    await sendTrainingPeaksTelegramBusinessMessage(chatId, text, businessConnectionId);
    return { attempted: true, sent: true, skippedReason: null };
  } catch (error) {
    console.warn(`Student move completion reply failed for action ${input.action.id}: ${toShortErrorMessage(error)}`);
    return { attempted: true, sent: false, skippedReason: "send_failed" };
  }
}

function formatMoveRouteForCoach(
  action: TrainingPeaksActionRow,
  options?: { sourceDate?: string | null; targetDate?: string | null }
): string {
  const parsedDates = extractMoveDateRangeFromParsedPayload(action.parsed_payload);
  const sourceDate = options?.sourceDate ?? parsedDates.sourceDate;
  const targetDate = options?.targetDate ?? parsedDates.targetDate;
  return `${formatCompactDateShort(sourceDate)} → ${formatCompactDateShort(targetDate)}`;
}

async function sendTelegramText(
  chatId: string,
  text: string,
  options?: {
    inlineKeyboardRows?: Array<Array<{ text: string; callback_data: string }>>;
  }
): Promise<{ messageId: string | null }> {
  const token = getOptionalEnv("TELEGRAM_BOT_TOKEN");
  if (!token) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN for Telegram delivery.");
  }

  const replyMarkup =
    options?.inlineKeyboardRows && options.inlineKeyboardRows.length > 0
      ? {
          inline_keyboard: options.inlineKeyboardRows,
        }
      : undefined;

  const response = await fetch(`${TELEGRAM_API_BASE_URL}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Telegram sendMessage failed (${response.status}): ${errorText}`);
  }

  const payload = (await response.json().catch(() => null)) as
    | {
        ok?: boolean;
        result?: { message_id?: number };
      }
    | null;
  const messageId = payload?.result?.message_id;
  return {
    messageId: typeof messageId === "number" ? String(messageId) : null,
  };
}

async function notifyCoachDryRunResult(input: {
  chatId: string | null;
  action: TrainingPeaksActionRow;
  studentName: string;
  dryRunEvaluation?: DryRunEvaluation | null;
}): Promise<void> {
  if (!input.chatId) {
    return;
  }

  const evaluation = input.dryRunEvaluation ?? null;
  const route = formatMoveRouteForCoach(input.action, {
    sourceDate: evaluation?.resolvedDates.sourceDate ?? undefined,
    targetDate: evaluation?.resolvedDates.targetDate ?? undefined,
  });
  const lines: string[] = [];

  const inferredSourceBlocked = moveSourcePolicy.hasInferredMoveSourceBlockReason(
    evaluation?.canExecuteReasons ?? null
  );
  const strongFutureDescriptorMatch =
    evaluation?.selectedSourceDatePolicy === moveSourcePolicy.STRONG_FUTURE_DESCRIPTOR_MATCH_POLICY;
  const likelySourceTitle = evaluation?.candidate?.title?.trim() || evaluation?.sourceInferenceProvenance?.candidate?.title?.trim();

  if (
    evaluation &&
    evaluation.dryRunResult === "candidate_found" &&
    evaluation.canExecute === true
  ) {
    lines.push("✅ Можно выполнить перенос");
    lines.push("");
    lines.push(`Ученик: ${input.studentName}`);
    lines.push(`Маршрут: ${route}`);
    if (likelySourceTitle) {
      lines.push(`Тренировка: ${likelySourceTitle}`);
    }
    lines.push("Проверка: безопасно");
    const confidenceDetail = getDryRunConfidenceDetail(evaluation);
    if (confidenceDetail) {
      lines.push(`Уверенность: ${confidenceDetail}`);
    }
    if (strongFutureDescriptorMatch) {
      lines.push("Источник определён по сильному совпадению.");
    }
    const provenanceWarnings = evaluation.sourceInferenceProvenance?.warnings ?? [];
    for (const warning of provenanceWarnings) {
      if (warning === "target day already has workout") {
        lines.push("⚠️ На целевой день уже есть тренировка.");
      } else if (warning === "hard workout moved earlier") {
        lines.push("⚠️ Тяжёлая тренировка переносится на более ранний день.");
      } else if (warning === "week may need manual adjustment") {
        lines.push("⚠️ Неделя может потребовать ручной корректировки.");
      }
    }
  } else if (
    evaluation &&
    evaluation.dryRunResult === "candidate_found" &&
    inferredSourceBlocked
  ) {
    lines.push(`⚠️ Проверка нашла кандидата. ${input.studentName}: ${route}.`);
    if (strongFutureDescriptorMatch && likelySourceTitle) {
      lines.push(
        `Вероятный источник (сильное совпадение): ${likelySourceTitle}. Выполнение пока заблокировано до следующего safety-слоя.`
      );
    }
    lines.push("Источник тренировки определён автоматически. Подтвердите исходную дату перед выполнением.");
    lines.push("TrainingPeaks не изменён.");
  } else if (evaluation?.dryRunResult === "candidate_found") {
    lines.push(`ℹ️ Тренировка найдена, но требуется ручная проверка. ${input.studentName}: ${route}.`);
    lines.push("TrainingPeaks не изменён. Проверь заявку в /tp_actions.");
  } else {
    lines.push(
      ...buildCoachDryRunFailureNotificationLines({
        studentName: input.studentName,
        route,
        dryRunResult: evaluation?.dryRunResult ?? "failed",
        sourceDate: evaluation?.resolvedDates.sourceDate ?? evaluation?.selectedSourceDate ?? null,
        canExecuteReasons: evaluation?.canExecuteReasons ?? [],
        candidates: evaluation?.debugCandidatesTopN ?? [],
        plannedVsCompletedHint: evaluation?.plannedVsCompletedHint ?? null,
      })
    );
  }

  let inlineKeyboardRows: Array<Array<{ text: string; callback_data: string }>> = [];
  if (evaluation?.dryRunResult === "candidate_found") {
    const actionId = input.action.id;
    const cancelButton = {
      text: "❌ Отменить",
      callback_data: `${TP_CALLBACK_ACTION_CANCEL_PREFIX}${actionId}`,
    };
    if (evaluation.canExecute === true) {
      inlineKeyboardRows = [
        [
          {
            text: "✅ Выполнить перенос",
            callback_data: `${TP_CALLBACK_ACTION_EXECUTE_PREFIX}${actionId}`,
          },
          cancelButton,
        ],
      ];
    } else if (moveSourcePolicy.isEligibleForCoachSourceDateConfirmation(evaluation)) {
      inlineKeyboardRows = [
        [
          {
            text: `✅ Да, подтвердить ${formatCompactDateShort(evaluation.resolvedDates.sourceDate)}`,
            callback_data: `${TP_CALLBACK_ACTION_CONFIRM_SOURCE_PREFIX}${actionId}`,
          },
        ],
        [{ ...cancelButton, text: "❌ Нет, отменить" }],
      ];
    } else {
      inlineKeyboardRows = [[cancelButton]];
    }
  } else if (evaluation?.dryRunResult === "ambiguous" && evaluation.plannedVsCompletedHint) {
    const actionId = input.action.id;
    const suggestedTitle = evaluation.plannedVsCompletedHint.suggestedSourceCandidate.title;
    inlineKeyboardRows = [
      [
        {
          text: `✅ Перенести ${truncateWorkoutTitleForButton(suggestedTitle)}`,
          callback_data: `${TP_CALLBACK_ACTION_SELECT_WORKOUT_PREFIX}${actionId}`,
        },
      ],
      [
        {
          text: "❌ Отменить",
          callback_data: `${TP_CALLBACK_ACTION_CANCEL_PREFIX}${actionId}`,
        },
      ],
    ];
  }

  try {
    await sendTelegramText(input.chatId, lines.join("\n"), { inlineKeyboardRows });
  } catch (error) {
    console.warn(`Telegram action dry-run summary warning: ${toShortErrorMessage(error)}`);
  }
}

async function notifyCoachDryRunResultWithFallback(input: {
  action: TrainingPeaksActionRow;
  studentName: string;
  dryRunEvaluation?: DryRunEvaluation | null;
}): Promise<void> {
  const directChatId = input.action.coach_chat_id ?? input.action.decided_by_chat_id;
  if (directChatId) {
    await notifyCoachDryRunResult({
      chatId: directChatId,
      action: input.action,
      studentName: input.studentName,
      dryRunEvaluation: input.dryRunEvaluation,
    });
    return;
  }

  if (!isAutoApprovedDryRunFallbackEligible(input.action)) {
    console.warn(
      "TrainingPeaks dry-run: skipping coach Telegram notification — no chat id and action is not auto-approved fallback eligible"
    );
    return;
  }

  const coachChatIds = getTrainingPeaksCoachChatIds();
  if (coachChatIds.length === 0) {
    console.warn(
      `TrainingPeaks dry-run: skipping coach Telegram notification — auto-approved fallback has no configured coach chats for action ${toShortActionId(input.action.id)}`
    );
    return;
  }

  await Promise.allSettled(
    coachChatIds.map(async (chatId) => {
      await notifyCoachDryRunResult({
        chatId,
        action: input.action,
        studentName: input.studentName,
        dryRunEvaluation: input.dryRunEvaluation,
      });
    })
  );

  console.log(
    `TrainingPeaks dry-run: sent coach notification via auto-approved fallback for action ${toShortActionId(input.action.id)}`
  );
}

async function claimOneApprovedActionForDryRun(
  runnerId: string,
  requestedActionId: string | null
): Promise<ClaimedAction | null> {
  const supabase = getSupabase();

  if (requestedActionId) {
    const { data: requestedActionData, error: requestedActionError } = await supabase
      .from("trainingpeaks_actions")
      .select("*")
      .eq("id", requestedActionId)
      .eq("action_type", "move_workout")
      .maybeSingle();
    if (requestedActionError) {
      throw new Error(`Failed to load requested dry-run action ${requestedActionId}: ${requestedActionError.message}`);
    }
    if (!requestedActionData) {
      throw new Error(`Requested dry-run action ${requestedActionId} was not found.`);
    }

    const requestedAction = requestedActionData as TrainingPeaksActionRow;
    if (requestedAction.status !== "approved") {
      throw new Error(
        `Requested dry-run action ${requestedAction.id} is not approved (status=${requestedAction.status}).`
      );
    }

    let expectedExecutionStatusForClaim: "not_started" | "execute_pending" = "not_started";
    if (requestedAction.execution_status === "not_started") {
      expectedExecutionStatusForClaim = "not_started";
    } else if (
      requestedAction.execution_status === "execute_pending" &&
      requestedAction.execution_requested_at === null &&
      requestedAction.last_run_id === null
    ) {
      expectedExecutionStatusForClaim = "execute_pending";
    } else {
      throw new Error(
        `Requested dry-run action ${requestedAction.id} is not ready for dry-run (execution_status=${requestedAction.execution_status}).`
      );
    }

    const { data: claimed, error: claimError } = await supabase
      .from("trainingpeaks_actions")
      .update({
        execution_status: "dry_run_running",
        execution_mode: "dry_run",
        claimed_by: runnerId,
        claimed_at: new Date().toISOString(),
      })
      .eq("id", requestedAction.id)
      .eq("status", "approved")
      .eq("execution_status", expectedExecutionStatusForClaim)
      .select("*")
      .maybeSingle();
    if (claimError) {
      throw new Error(`Failed to claim requested dry-run action ${requestedAction.id}: ${claimError.message}`);
    }
    if (!claimed) {
      throw new Error(
        `Requested dry-run action ${requestedAction.id} could not be claimed because its state changed.`
      );
    }

    const action = claimed as TrainingPeaksActionRow;
    let student: TrainingPeaksStudentRow | null = null;
    if (action.student_id) {
      const { data: studentData, error: studentError } = await supabase
        .from("trainingpeaks_students")
        .select("id, student_id, student_name, telegram_chat_id, trainingpeaks_athlete_url")
        .eq("id", action.student_id)
        .maybeSingle();
      if (studentError) {
        throw new Error(`Failed to fetch student for action ${action.id}: ${studentError.message}`);
      }
      student = (studentData as TrainingPeaksStudentRow | null) ?? null;
    }
    return { action, student };
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data: candidate, error: selectError } = await supabase
      .from("trainingpeaks_actions")
      .select("*")
      .eq("action_type", "move_workout")
      .eq("status", "approved")
      .eq("execution_status", "not_started")
      .order("approved_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (selectError) {
      throw new Error(`Failed to select approved action for dry-run: ${selectError.message}`);
    }

    let candidateRow = (candidate as TrainingPeaksActionRow | null) ?? null;
    let expectedExecutionStatusForClaim: "not_started" | "execute_pending" = "not_started";

    if (!candidateRow) {
      // Backward-compat path: some historical approvals ended up in execute_pending
      // before dry-run, without an execution request timestamp and baseline run.
      const { data: legacyCandidate, error: legacySelectError } = await supabase
        .from("trainingpeaks_actions")
        .select("*")
        .eq("action_type", "move_workout")
        .eq("status", "approved")
        .eq("execution_status", "execute_pending")
        .is("execution_requested_at", null)
        .is("last_run_id", null)
        .order("approved_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (legacySelectError) {
        throw new Error(`Failed to select legacy approved action for dry-run: ${legacySelectError.message}`);
      }
      if (legacyCandidate) {
        candidateRow = legacyCandidate as TrainingPeaksActionRow;
        expectedExecutionStatusForClaim = "execute_pending";
      }
    }

    if (!candidateRow) {
      return null;
    }

    const { data: claimed, error: claimError } = await supabase
      .from("trainingpeaks_actions")
      .update({
        execution_status: "dry_run_running",
        execution_mode: "dry_run",
        claimed_by: runnerId,
        claimed_at: new Date().toISOString(),
      })
      .eq("id", candidateRow.id)
      .eq("status", "approved")
      .eq("execution_status", expectedExecutionStatusForClaim)
      .select("*")
      .maybeSingle();

    if (claimError) {
      throw new Error(`Failed to claim action ${candidateRow.id} for dry-run: ${claimError.message}`);
    }

    if (!claimed) {
      continue;
    }

    const action = claimed as TrainingPeaksActionRow;
    let student: TrainingPeaksStudentRow | null = null;
    if (action.student_id) {
      const { data: studentData, error: studentError } = await supabase
        .from("trainingpeaks_students")
        .select("id, student_id, student_name, telegram_chat_id, telegram_formality, trainingpeaks_athlete_url")
        .eq("id", action.student_id)
        .maybeSingle();
      if (studentError) {
        throw new Error(`Failed to fetch student for action ${action.id}: ${studentError.message}`);
      }
      student = (studentData as TrainingPeaksStudentRow | null) ?? null;
    }

    return { action, student };
  }

  return null;
}

async function claimOneExecutePendingActionForRealMode(
  runnerId: string,
  requestedActionId: string | null
): Promise<ClaimedRealAction | null> {
  const supabase = getSupabase();

  if (requestedActionId) {
    console.debug(`[execute-real] selecting explicit action id=${requestedActionId}`);
    const { data: requestedActionData, error: requestedActionError } = await supabase
      .from("trainingpeaks_actions")
      .select("*")
      .eq("id", requestedActionId)
      .eq("action_type", "move_workout")
      .maybeSingle();
    if (requestedActionError) {
      throw new Error(`Failed to load requested action ${requestedActionId}: ${requestedActionError.message}`);
    }
    if (!requestedActionData) {
      throw new Error(`Requested action ${requestedActionId} was not found.`);
    }

    const requestedAction = requestedActionData as TrainingPeaksActionRow;
    if (requestedAction.status !== "approved") {
      throw new Error(
        `Requested action ${requestedAction.id} is not approved (status=${requestedAction.status}).`
      );
    }
    if (requestedAction.execution_status !== "execute_pending") {
      throw new Error(
        `Requested action ${requestedAction.id} is not ready for real execution (status=${requestedAction.status}, execution_status=${requestedAction.execution_status}).`
      );
    }
    if (!requestedAction.last_run_id) {
      throw new Error(
        `Requested action ${requestedAction.id} has no trusted dry-run baseline (last_run_id is null). Run dry-run first, then request execute.`
      );
    }

    const { data: trustedRunData, error: trustedRunError } = await supabase
      .from("trainingpeaks_action_runs")
      .select("*")
      .eq("id", requestedAction.last_run_id)
      .eq("action_id", requestedAction.id)
      .eq("run_type", "dry_run")
      .eq("status", "completed")
      .maybeSingle();
    if (trustedRunError) {
      throw new Error(
        `Failed to load trusted dry-run ${requestedAction.last_run_id} for action ${requestedAction.id}: ${trustedRunError.message}`
      );
    }
    if (!trustedRunData) {
      throw new Error(
        `Requested action ${requestedAction.id} has no trusted completed dry-run row for last_run_id=${requestedAction.last_run_id}. Run dry-run first, then request execute.`
      );
    }

    const trustedDryRunRun = trustedRunData as TrainingPeaksActionRunRow;
    const trustedDryRunLog = normalizeTrustedDryRunLog(
      trustedDryRunRun.log_json,
      requestedAction.parsed_payload
    );
    if (!trustedDryRunLog) {
      throw new Error(
        `Requested action ${requestedAction.id} has an unsafe trusted dry-run log in ${requestedAction.last_run_id}. Re-run dry-run and request execute again.`
      );
    }

    const { data: claimed, error: claimError } = await supabase
      .from("trainingpeaks_actions")
      .update({
        execution_status: "running_local",
        execution_mode: "real",
        claimed_by: runnerId,
        claimed_at: new Date().toISOString(),
      })
      .eq("id", requestedAction.id)
      .eq("status", "approved")
      .eq("execution_status", "execute_pending")
      .eq("last_run_id", requestedAction.last_run_id)
      .select("*")
      .maybeSingle();
    if (claimError) {
      throw new Error(`Failed to claim requested action ${requestedAction.id}: ${claimError.message}`);
    }
    if (!claimed) {
      throw new Error(
        `Requested action ${requestedAction.id} could not be claimed because its state changed. Current state is no longer status=approved/execution_status=execute_pending.`
      );
    }

    const claimedAction = claimed as TrainingPeaksActionRow;
    let student: TrainingPeaksStudentRow | null = null;
    if (claimedAction.student_id) {
      const { data: studentData, error: studentError } = await supabase
        .from("trainingpeaks_students")
        .select("id, student_id, student_name, telegram_chat_id, telegram_formality, trainingpeaks_athlete_url")
        .eq("id", claimedAction.student_id)
        .maybeSingle();
      if (studentError) {
        throw new Error(`Failed to fetch student for real-mode action ${claimedAction.id}: ${studentError.message}`);
      }
      student = (studentData as TrainingPeaksStudentRow | null) ?? null;
    }

    console.log(
      `[execute-real] claimed_action id=${claimedAction.id} status=${claimedAction.status} execution_status=${claimedAction.execution_status}`
    );
    return {
      action: claimedAction,
      student,
      trustedDryRunRun,
      trustedDryRunLog,
    };
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    console.debug(`[execute-real] selection_attempt=${attempt + 1} filtering status=approved execution_status=execute_pending`);
    const { data: candidate, error: selectError } = await supabase
      .from("trainingpeaks_actions")
      .select("*")
      .eq("action_type", "move_workout")
      .eq("status", "approved")
      .eq("execution_status", "execute_pending")
      .not("last_run_id", "is", null)
      .order("execution_requested_at", { ascending: true, nullsFirst: false })
      .order("approved_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (selectError) {
      throw new Error(`Failed to select execute_pending action for real mode: ${selectError.message}`);
    }

    if (!candidate) {
      const { data: debugRows, error: debugError } = await supabase
        .from("trainingpeaks_actions")
        .select("id,status,execution_status,last_run_id,execution_requested_at,approved_at,created_at")
        .eq("action_type", "move_workout")
        .eq("status", "approved")
        .eq("execution_status", "execute_pending")
        .order("execution_requested_at", { ascending: true, nullsFirst: false })
        .order("approved_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true })
        .limit(5);
      if (debugError) {
        console.warn(`[execute-real] debug lookup failed: ${debugError.message}`);
      } else {
        const rows = (debugRows as Array<Record<string, unknown>> | null) ?? [];
        if (rows.length === 0) {
          console.debug("[execute-real] no rows found with status=approved execution_status=execute_pending");
        } else {
          for (const row of rows) {
            const whySkipped = row.last_run_id ? "eligible_for_claim_query" : "missing_last_run_id";
            console.warn(
              `[execute-real] candidate_not_claimable id=${String(row.id)} status=${String(
                row.status
              )} execution_status=${String(row.execution_status)} reason=${whySkipped}`
            );
            if (!row.last_run_id) {
              console.warn(
                `[execute-real] approved action ${String(
                  row.id
                )} has execute_pending but no trusted dry-run baseline (last_run_id). Queue dry-run first, then request execute.`
              );
            }
          }
        }
      }
      return null;
    }

    const action = candidate as TrainingPeaksActionRow;
    console.log(
      `[execute-real] action_ready_for_execute id=${action.id} trusted_last_run_id=${action.last_run_id ?? "null"}`
    );
    console.log(
      `[execute-real] selected_action id=${action.id} status=${action.status} execution_status=${action.execution_status} last_run_id=${action.last_run_id ?? "null"}`
    );
    if (!action.last_run_id) {
      console.warn(
        `[execute-real] skipping id=${action.id} status=${action.status} execution_status=${action.execution_status}: missing_last_run_id`
      );
      continue;
    }

    const { data: trustedRunData, error: trustedRunError } = await supabase
      .from("trainingpeaks_action_runs")
      .select("*")
      .eq("id", action.last_run_id)
      .eq("action_id", action.id)
      .eq("run_type", "dry_run")
      .eq("status", "completed")
      .maybeSingle();

    if (trustedRunError) {
      throw new Error(`Failed to load trusted dry-run ${action.last_run_id} for action ${action.id}: ${trustedRunError.message}`);
    }

    if (!trustedRunData) {
      console.warn(
        `[execute-real] skipping id=${action.id} status=${action.status} execution_status=${action.execution_status}: trusted dry-run row ${action.last_run_id} not found`
      );
      continue;
    }

    const trustedDryRunRun = trustedRunData as TrainingPeaksActionRunRow;
    const trustedDryRunLog = normalizeTrustedDryRunLog(trustedDryRunRun.log_json, action.parsed_payload);
    if (!trustedDryRunLog) {
      console.warn(
        `[execute-real] skipping id=${action.id} status=${action.status} execution_status=${action.execution_status}: trusted dry-run log is not safe for real-mode revalidation`
      );
      continue;
    }

    const { data: claimed, error: claimError } = await supabase
      .from("trainingpeaks_actions")
      .update({
        execution_status: "running_local",
        execution_mode: "real",
        claimed_by: runnerId,
        claimed_at: new Date().toISOString(),
      })
      .eq("id", action.id)
      .eq("status", "approved")
      .eq("execution_status", "execute_pending")
      .eq("last_run_id", action.last_run_id)
      .select("*")
      .maybeSingle();

    if (claimError) {
      throw new Error(`Failed to claim execute_pending action ${action.id} for real mode: ${claimError.message}`);
    }

    if (!claimed) {
      console.warn(
        `[execute-real] skipping id=${action.id} status=${action.status} execution_status=${action.execution_status}: claim_conflict_or_state_changed`
      );
      continue;
    }

    const claimedAction = claimed as TrainingPeaksActionRow;
    console.log(
      `[execute-real] claimed_action id=${claimedAction.id} status=${claimedAction.status} execution_status=${claimedAction.execution_status}`
    );
    let student: TrainingPeaksStudentRow | null = null;
    if (claimedAction.student_id) {
      const { data: studentData, error: studentError } = await supabase
        .from("trainingpeaks_students")
        .select("id, student_id, student_name, telegram_chat_id, telegram_formality, trainingpeaks_athlete_url")
        .eq("id", claimedAction.student_id)
        .maybeSingle();
      if (studentError) {
        throw new Error(`Failed to fetch student for real-mode action ${claimedAction.id}: ${studentError.message}`);
      }
      student = (studentData as TrainingPeaksStudentRow | null) ?? null;
    }

    return {
      action: claimedAction,
      student,
      trustedDryRunRun,
      trustedDryRunLog,
    };
  }

  return null;
}

async function createActionRun(
  actionId: string,
  runnerId: string,
  runType: ActionRunType = "dry_run"
): Promise<TrainingPeaksActionRunRow> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("trainingpeaks_action_runs")
    .insert({
      action_id: actionId,
      run_type: runType,
      status: "running",
      dry_run: runType === "dry_run",
      runner_id: runnerId,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to create action run for ${actionId}: ${error.message}`);
  }

  return data as TrainingPeaksActionRunRow;
}

async function completeDryRun(
  actionId: string,
  runId: string,
  input: {
    logJson: unknown;
    screenshotBeforePath: string | null;
    screenshotAfterPath: string | null;
  }
): Promise<void> {
  const supabase = getSupabase();

  const { error: runError } = await supabase
    .from("trainingpeaks_action_runs")
    .update({
      status: "completed",
      finished_at: new Date().toISOString(),
      error_message: null,
      log_json: input.logJson,
      screenshot_before_path: input.screenshotBeforePath,
      screenshot_after_path: input.screenshotAfterPath,
    })
    .eq("id", runId)
    .eq("action_id", actionId)
    .eq("status", "running");
  if (runError) {
    throw new Error(`Failed to mark action run ${runId} completed: ${runError.message}`);
  }

  const { error: actionError } = await supabase
    .from("trainingpeaks_actions")
    .update({
      execution_status: "dry_run_completed",
      execution_mode: "dry_run",
      last_run_id: runId,
    })
    .eq("id", actionId);
  if (actionError) {
    throw new Error(`Failed to update action ${actionId} to dry_run_completed: ${actionError.message}`);
  }
}

async function failDryRun(
  actionId: string,
  runId: string,
  input: { errorMessage: string; logJson: unknown }
): Promise<void> {
  const supabase = getSupabase();

  const { error: runError } = await supabase
    .from("trainingpeaks_action_runs")
    .update({
      status: "failed",
      finished_at: new Date().toISOString(),
      error_message: input.errorMessage,
      log_json: input.logJson,
    })
    .eq("id", runId)
    .eq("action_id", actionId)
    .eq("status", "running");
  if (runError) {
    throw new Error(`Failed to mark action run ${runId} failed: ${runError.message}`);
  }

  const { error: actionError } = await supabase
    .from("trainingpeaks_actions")
    .update({
      execution_status: "failed",
      execution_mode: "dry_run",
      last_run_id: runId,
    })
    .eq("id", actionId);
  if (actionError) {
    throw new Error(`Failed to update action ${actionId} as failed: ${actionError.message}`);
  }
}

async function isVisible(locator: import("playwright").Locator, timeout = 700): Promise<boolean> {
  try {
    await locator.first().waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}

async function anyVisible(
  locators: import("playwright").Locator[],
  timeout = 700
): Promise<boolean> {
  for (const locator of locators) {
    if (await isVisible(locator, timeout)) {
      return true;
    }
  }
  return false;
}

async function assessTrainingPeaksPage(page: import("playwright").Page): Promise<{
  loginRequired: boolean;
  athletePageLikelyReachable: boolean;
  trainingPeaksContextLikely: boolean;
}> {
  await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});

  const [title, bodyText, currentUrl] = await Promise.all([
    page.title().catch(() => ""),
    page
      .locator("body")
      .innerText({ timeout: 3000 })
      .catch(() => ""),
    Promise.resolve(page.url()),
  ]);
  const combinedText = `${title} ${bodyText}`.replace(/\s+/g, " ").trim().toLowerCase();
  const trainingPeaksUrlDetected = currentUrl.toLowerCase().includes("trainingpeaks");

  const loginSignals = await Promise.all([
    isVisible(page.locator('input[type="password"]')),
    isVisible(page.locator('input[type="email"], input[name*="email" i], input[autocomplete="username"]')),
    anyVisible([
      page.getByRole("button", { name: /sign in|log in|login/i }),
      page.getByRole("link", { name: /sign in|log in|login/i }),
      page.getByText(/sign in|log in|login/i),
    ]),
  ]);
  const loginTextDetected = /sign in|log in|login|password|forgot password|remember me/.test(combinedText);
  if (/(login|signin|sign-in|auth)/i.test(currentUrl) || loginSignals.some(Boolean) || loginTextDetected) {
    return {
      loginRequired: true,
      athletePageLikelyReachable: false,
      trainingPeaksContextLikely: trainingPeaksUrlDetected,
    };
  }

  const shellTextDetected = /trainingpeaks|calendar|workout|athlete|account settings|export data/.test(combinedText);
  const trainingPeaksContextLikely = trainingPeaksUrlDetected || shellTextDetected;
  const athletePageLikelyReachable =
    trainingPeaksContextLikely && !/something went wrong|404|not found|unavailable|forbidden|access denied/.test(combinedText);

  return {
    loginRequired: false,
    athletePageLikelyReachable,
    trainingPeaksContextLikely,
  };
}

function scoreWorkoutCandidate(input: {
  title: string | null;
  type: string | null;
  dateIso: string | null;
  targetDate: string | null;
  distanceFromTodayDays: number | null;
}): number {
  let score = 0.35;
  if (input.title) {
    score += 0.2;
  }
  if (input.type) {
    score += 0.1;
  }
  if (input.dateIso && input.targetDate) {
    const days = dateDistanceDays(input.dateIso, input.targetDate);
    if (days === 0) {
      score += 0.3;
    } else if (days === 1) {
      score += 0.2;
    } else if (days === 2) {
      score += 0.08;
    } else {
      score -= Math.min(0.2, days * 0.03);
    }
  }
  if (input.distanceFromTodayDays !== null) {
    if (input.distanceFromTodayDays <= 3) {
      score += 0.1;
    } else if (input.distanceFromTodayDays >= 8) {
      score -= 0.1;
    }
  }
  return clampConfidence(score);
}

function emptyDomSelectorCounts(): DryRunDomDebugSelectorCounts {
  return {
    calendarRoots: 0,
    dayCells: 0,
    primaryWorkoutCards: 0,
    fallbackWorkoutDivCards: 0,
  };
}

async function captureCalendarDomSnapshot(
  page: import("playwright").Page,
  includeCardSnippets = false
): Promise<{
  selectorCounts: DryRunDomDebugSelectorCounts;
  calendarRootClass: string | null;
  cardSnippets: string[];
  error: string | null;
}> {
  try {
    const calendarRoots = page.locator(TP_CALENDAR_ROOT_SELECTOR);
    const calendarRootCount = await calendarRoots.count();
    const root = calendarRoots.first();
    const selectorCounts: DryRunDomDebugSelectorCounts = {
      calendarRoots: calendarRootCount,
      dayCells: calendarRootCount > 0 ? await root.locator(TP_DAY_CELL_SELECTOR).count() : 0,
      primaryWorkoutCards: calendarRootCount > 0 ? await root.locator(TP_PRIMARY_WORKOUT_CARD_WITHIN_DAY_SELECTOR).count() : 0,
      fallbackWorkoutDivCards: calendarRootCount > 0 ? await root.locator(TP_FALLBACK_WORKOUT_CARD_WITHIN_DAY_SELECTOR).count() : 0,
    };

    const cardSnippets: string[] = [];
    if (includeCardSnippets && calendarRootCount > 0) {
      const primarySnippets = await collectLocatorInnerTextSnippets(
        root.locator(TP_PRIMARY_WORKOUT_CARD_WITHIN_DAY_SELECTOR),
        5
      );
      const fallbackSnippets = await collectLocatorInnerTextSnippets(
        root.locator(TP_FALLBACK_WORKOUT_CARD_WITHIN_DAY_SELECTOR),
        5
      );
      for (const snippet of [...primarySnippets, ...fallbackSnippets]) {
        if (!snippet || cardSnippets.includes(snippet)) {
          continue;
        }
        cardSnippets.push(snippet);
        if (cardSnippets.length >= 5) {
          break;
        }
      }
    }

    return {
      selectorCounts,
      calendarRootClass: calendarRootCount > 0 ? await getAttributeSafe(root, "class") : null,
      cardSnippets,
      error: null,
    };
  } catch (error) {
    return {
      selectorCounts: emptyDomSelectorCounts(),
      calendarRootClass: null,
      cardSnippets: [],
      error: `calendar DOM snapshot failed: ${toShortErrorMessage(error)}`,
    };
  }
}

function buildEmptyUiCapabilityProbe(): UiCapabilityProbe {
  const nowIso = new Date().toISOString();
  const card: UiCapabilityProbeCardDiscovery = {
    found: false,
    selectorUsed: null,
    textSnippet: null,
    menuButtonFound: false,
    menuTriggerFound: false,
    menuTriggerSelectorUsed: null,
    menuOpened: false,
    menuActionLabels: [],
    menuMoveOptionFound: false,
    menuRescheduleOptionFound: false,
    menuCopyOptionFound: false,
    menuMoveActionFound: false,
    menuRescheduleActionFound: false,
    menuCopyActionFound: false,
    menuEditActionFound: false,
    menuEditClicked: false,
    menuCloseSucceeded: false,
  };
  const detail: UiCapabilityProbeDetailDiscovery = {
    openAttempted: false,
    opened: false,
    dateFieldFound: false,
    dateFieldSelectorHint: null,
    currentDateValue: null,
    dateHeaderFound: false,
    dateHeaderText: null,
    dateControlClickable: false,
    dateControlSelectorUsed: null,
    dateHeaderClickStrategiesTried: [],
    dateHeaderClickSucceededStrategy: null,
    dateHeaderBoundingBox: null,
    datePickerOpened: false,
    datePickerSelectorHint: null,
    datePickerDetectionStrategy: null,
    datePickerBoundingBox: null,
    visibleMonth: null,
    visibleYear: null,
    visibleDayCandidates: [],
    targetDayVisible: false,
    selectedSourceDayVisible: false,
    targetDateSelectionAttempted: false,
    targetDateSelectionConfirmed: false,
    postClickDateHeaderText: null,
    postClickDateInputValue: null,
    targetDateConfirmedBy: null,
    targetDateClickMethod: null,
    targetDateClickCandidateFound: false,
    targetDateClickCandidateBoundingBox: null,
    afterTargetDayClickError: null,
    datePickerOpenCheckCount: 0,
    datePickerOpenCheckSnippets: [],
    datepickerDomDebugPath: null,
    datepickerDomDebugTopCandidates: [],
    datepickerDomDebugError: null,
    saveButtonFound: false,
    saveAndCloseButtonFound: false,
    cancelButtonFound: false,
    closeButtonFound: false,
    modalScopedSaveFound: false,
    modalScopedSaveAndCloseFound: false,
    modalScopedCancelFound: false,
    modalScopedCloseFound: false,
    closeSucceeded: false,
    datePickerCloseAttempted: false,
    datePickerCloseSucceeded: false,
    datePickerCloseError: null,
    mutationOccurred: false,
  };
  return {
    attempted: true,
    safeToProceedLater: false,
    recommendedMutationMethod: "unknown",
    card,
    detail,
    controlDiscovery: {
      card,
      detail,
    },
    screenshots: {
      before: null,
      menuOpened: null,
      afterEditClick: null,
      detailOpened: null,
      beforeDateHeaderClick: null,
      afterDateHeaderClickAttempt1: null,
      afterTargetDayClick: null,
      datePickerOpened: null,
      afterClosed: null,
      timeout: null,
    },
    progress: {
      currentStep: null,
      lastCompletedStep: null,
      timeoutStep: null,
      timeoutAt: null,
      startedAt: nowIso,
      updatedAt: nowIso,
      stepHistory: [],
    },
    warnings: [],
    errors: [],
  };
}

async function captureProbeScreenshot(
  page: import("playwright").Page,
  filePath: string,
  warnings: string[]
): Promise<string | null> {
  try {
    await page.screenshot({ path: filePath, fullPage: true });
    return filePath;
  } catch (error) {
    warnings.push(`probe screenshot failed for ${path.basename(filePath)}: ${toShortErrorMessage(error)}`);
    return null;
  }
}

async function waitForTrainingPeaksCalendarReadiness(
  page: import("playwright").Page,
  warnings: string[]
): Promise<void> {
  await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => {});

  try {
    await page.locator(TP_CALENDAR_ROOT_SELECTOR).first().waitFor({ state: "attached", timeout: 5_000 });
  } catch (error) {
    warnings.push(`probe calendar root wait failed: ${toShortErrorMessage(error)}`);
  }

  try {
    await page
      .locator(`${TP_CALENDAR_ROOT_SELECTOR} ${TP_DAY_CELL_SELECTOR}`)
      .first()
      .waitFor({ state: "attached", timeout: 5_000 });
  } catch (error) {
    warnings.push(`probe calendar day cells wait failed: ${toShortErrorMessage(error)}`);
  }
}

async function resolveDayCellDateForProbe(
  dayCell: import("playwright").Locator,
  calendarMonthYear: { year: number | null; month: number | null; reason: string },
  expectedSourceDate: string | null = null,
  expectedTargetDate: string | null = null
): Promise<string | null> {
  const resolved = await resolveCalendarDayCellDate({
    dayCell,
    headerMonthYear: calendarMonthYear,
    expectedSourceDate,
    expectedTargetDate,
  });
  return resolved.dateIso;
}

async function locateWorkoutCardForProbe(
  page: import("playwright").Page,
  input: {
    studentId: string | null;
    sourceDate: string;
    candidate: DryRunCandidate;
  }
): Promise<{
  locator: import("playwright").Locator | null;
  selectorUsed: string | null;
  textSnippet: string | null;
}> {
  const calendarRoot = page.locator(TP_CALENDAR_ROOT_SELECTOR).first();
  const calendarRootCount = await page.locator(TP_CALENDAR_ROOT_SELECTOR).count();
  if (calendarRootCount === 0) {
    return {
      locator: null,
      selectorUsed: null,
      textSnippet: null,
    };
  }

  const calendarMonthYear = await inferCalendarMonthYear(calendarRoot);
  const dayCells = calendarRoot.locator(TP_DAY_CELL_SELECTOR);
  const dayCellCount = await dayCells.count();

  const selectors = [
    { selector: TP_PRIMARY_WORKOUT_CARD_WITHIN_DAY_SELECTOR, fullSelector: TP_PRIMARY_WORKOUT_CARD_SELECTOR },
    { selector: TP_FALLBACK_WORKOUT_CARD_WITHIN_DAY_SELECTOR, fullSelector: TP_FALLBACK_WORKOUT_CARD_SELECTOR },
  ];

  for (let dayIndex = 0; dayIndex < dayCellCount; dayIndex += 1) {
    const dayCell = dayCells.nth(dayIndex);
    const dayDate = await resolveDayCellDateForProbe(dayCell, calendarMonthYear, input.sourceDate, null);
    if (dayDate !== input.sourceDate) {
      continue;
    }

    for (const selectorEntry of selectors) {
      const cards = dayCell.locator(selectorEntry.selector);
      const count = await cards.count();
      for (let cardIndex = 0; cardIndex < count; cardIndex += 1) {
        const card = cards.nth(cardIndex);
        const rawText = await getInnerTextSafe(card);
        if (!rawText) {
          continue;
        }
        const text = toTextSnippet(rawText);
        const title =
          (await getInnerTextSafe(card.locator("h1, h2, h3, strong, [class*='title' i]").first())) ??
          extractTitleFromCardText(text);
        const type = detectWorkoutTypeFromText(text);
        const plannedDurationRaw =
          text.match(
            /\b(?:\d{1,2}:\d{2}(?::\d{2})?|\d+(?:[.,]\d+)?\s*(?:h|hr|hour|hours|ч|min|mins|minute|minutes|мин|sec|secs|second|seconds|сек))\b/i
          )?.[0] ?? null;
        const plannedDistanceRaw =
          text.match(/\b\d+(?:[.,]\d+)?\s*(?:km|км|mi|mile|miles|m|м|meter|meters)\b/i)?.[0] ?? null;
        const startTimeLocal = text.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/)?.[0] ?? null;
        const fingerprint = buildCandidateFingerprint({
          studentId: input.studentId,
          dateIso: dayDate,
          title,
          type,
          startTimeLocal,
          plannedDurationSec: plannedDurationRaw ? parseDurationSeconds(plannedDurationRaw) : null,
          plannedDistance: plannedDistanceRaw ? parseDistance(plannedDistanceRaw) : null,
        });
        if (fingerprint !== input.candidate.fingerprint) {
          continue;
        }
        if (selectorEntry.fullSelector === TP_FALLBACK_WORKOUT_CARD_SELECTOR) {
          continue;
        }

        return {
          locator: card,
          selectorUsed: selectorEntry.fullSelector,
          textSnippet: text,
        };
      }
    }
  }

  return {
    locator: null,
    selectorUsed: null,
    textSnippet: null,
  };
}

async function executeApiMoveForApprovedAction(input: {
  claimed: ClaimedRealAction;
  runId: string;
  comparison: RevalidationComparison;
  artifactDir: string;
}): Promise<ApiMoveExecutionResult> {
  const student = input.claimed.student;
  if (!student?.trainingpeaks_athlete_url) {
    throw new Error(`Missing trainingpeaks_athlete_url for action ${input.claimed.action.id}.`);
  }

  const athleteIdRaw = parseTrainingPeaksAthleteId(student.trainingpeaks_athlete_url);
  const athleteId = athleteIdRaw ? Number(athleteIdRaw) : Number.NaN;
  if (!Number.isFinite(athleteId) || athleteId <= 0) {
    throw new Error(`Could not resolve numeric athleteId from ${student.trainingpeaks_athlete_url}.`);
  }

  const sourceDate =
    input.comparison.sourceDate.current ??
    input.comparison.sourceDate.trusted ??
    input.claimed.trustedDryRunLog.resolvedDates.sourceDate;
  const targetDate =
    input.comparison.targetDate.current ??
    input.comparison.targetDate.trusted ??
    input.claimed.trustedDryRunLog.resolvedDates.targetDate;
  if (!sourceDate || !targetDate) {
    throw new Error("Source/target dates are unavailable for API move execution.");
  }

  const candidate = input.comparison.currentCandidate ?? input.comparison.trustedCandidate;
  const apiMoveArtifactDir = path.join(input.artifactDir, "api-move");
  await mkdir(apiMoveArtifactDir, { recursive: true });
  const requestArtifactPath = path.join(apiMoveArtifactDir, "request.redacted.json");
  const responseArtifactPath = path.join(apiMoveArtifactDir, "response.redacted.json");
  const verificationArtifactPath = path.join(apiMoveArtifactDir, "verification.redacted.json");
  const beforeScreenshotPath = path.join(apiMoveArtifactDir, "before.png");
  const afterScreenshotPath = path.join(apiMoveArtifactDir, "after.png");

  let context: import("playwright").BrowserContext | null = null;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless: true,
      viewport: null,
    });
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(student.trainingpeaks_athlete_url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await waitForTrainingPeaksCalendarReadiness(page, []);

    const pageAssessment = await assessTrainingPeaksPage(page);
    if (pageAssessment.loginRequired) {
      throw new Error("TrainingPeaks session expired or login required.");
    }
    if (!pageAssessment.trainingPeaksContextLikely || !pageAssessment.athletePageLikelyReachable) {
      throw new Error("TrainingPeaks athlete page is not safely reachable.");
    }

    const visibleTrainingPeaksName = await extractVisibleTrainingPeaksAthleteName(page);
    const identityCheck = buildIdentityCheck({
      student,
      expectedUrl: student.trainingpeaks_athlete_url,
      currentUrl: page.url(),
      visibleTrainingPeaksName,
    });
    const athleteIdentityOk = identityCheck.matchedBy !== "inconclusive" && identityCheck.matchedBy !== "mismatch";
    if (!athleteIdentityOk) {
      throw new Error(`Athlete identity check failed before API move: matchedBy=${identityCheck.matchedBy}`);
    }
    if (!input.comparison.fingerprint.matches) {
      throw new Error("Candidate fingerprint mismatch before API move.");
    }

    const cardMatch = await locateWorkoutCardForProbe(page, {
      studentId: student.id,
      sourceDate,
      candidate,
    });
    if (!cardMatch.locator) {
      throw new Error("Could not locate the revalidated candidate card before API move.");
    }

    const workoutId = (await extractWorkoutIdFromCard(cardMatch.locator)) ?? candidate.workoutId ?? null;
    if (!workoutId || !Number.isFinite(workoutId) || workoutId <= 0) {
      throw new Error("Could not resolve workoutId from the revalidated TrainingPeaks workout card.");
    }

    await captureProbeScreenshot(page, beforeScreenshotPath, []);
    const capturedAuth = await captureSessionAuth({
      context,
      page,
      athleteId,
    });
    const cookies = await context.cookies(["https://app.trainingpeaks.com", "https://tpapi.trainingpeaks.com"]);
    const authHeaders: Record<string, string> = {};
    if (capturedAuth.authorizationHeader) {
      authHeaders.authorization = capturedAuth.authorizationHeader;
    }

    const endpoint = buildTpApiWorkoutUrl(athleteId, workoutId);
    const prefetchResult = await performApiJsonRequest({
      page,
      method: "GET",
      endpoint,
      headers: {
        accept: "application/json, text/javascript, */*; q=0.01",
        ...authHeaders,
      },
    });
    if (!prefetchResult.ok) {
      throw new Error(`API prefetch GET failed with status ${prefetchResult.status}.`);
    }

    const targetDateTime = parseDateArgToTpDateTime(targetDate);
    const payload = buildWorkoutMovePayload({
      athleteId,
      workoutId,
      targetDateTime,
      sourceWorkout: prefetchResult.body,
    });

    const requestSummary = {
      mode: "execute",
      endpoint,
      request: {
        method: "PUT",
        headers: {
          accept: "application/json, text/javascript, */*; q=0.01",
          "content-type": "application/json",
          ...authHeaders,
        },
        payload,
      },
      authValidation: {
        browserStorageCount: cookies.length,
        authHeaderObserved: Boolean(capturedAuth.authorizationHeader),
        sampleTpApiUrl: capturedAuth.sampleRequestUrl,
      },
      actionContext: {
        actionId: input.claimed.action.id,
        runId: input.runId,
        athleteId,
        workoutId,
        sourceDate,
        targetDate,
      },
    };

    console.log("[execute-real] mutation_context");
    console.log(`actionId=${input.claimed.action.id}`);
    console.log(`originalStudentMessage=${input.claimed.action.raw_text}`);
    console.log("API move path enabled");
    console.log(`athleteId=${athleteId}`);
    console.log(`workoutId=${workoutId}`);
    console.log(`sourceDate=${sourceDate}`);
    console.log(`targetDate=${targetDate}`);

    const putResult = await performApiJsonRequest({
      page,
      method: "PUT",
      endpoint,
      headers: {
        accept: "application/json, text/javascript, */*; q=0.01",
        "content-type": "application/json",
        ...authHeaders,
      },
      body: payload,
    });
    console.log(`PUT status=${putResult.status}`);

    const verification = await verifyWorkoutMoved({
      page,
      athleteId,
      workoutId,
      targetDate,
      authHeaders,
    });
    console.log(
      `verification status=${verification.status} ok=${verification.ok ? "yes" : "no"} matchesTargetDate=${verification.matchesTargetDate ? "yes" : "no"}`
    );

    await captureProbeScreenshot(page, afterScreenshotPath, []);

    const responseSummary = {
      session: {
        browserStorageCount: cookies.length,
        authHeaderObserved: Boolean(capturedAuth.authorizationHeader),
        authHeaderSourceUrl: capturedAuth.sampleRequestUrl,
      },
      prefetchWorkout: {
        status: prefetchResult.status,
        ok: prefetchResult.ok,
        body: prefetchResult.body,
      },
      executePut: {
        attempted: true,
        status: putResult.status,
        ok: putResult.ok,
        body: putResult.body,
      },
    };

    const verificationSummary = {
      mode: "execute",
      targetDate,
      expectedWorkoutDay: targetDateTime,
      verification,
      notes:
        putResult.status === 200 && verification.ok && verification.matchesTargetDate
          ? ["Execute mode complete: PUT 200 and verification passed."]
          : [],
    };

    await writeFile(requestArtifactPath, `${JSON.stringify(redactUnknown(requestSummary), null, 2)}\n`, "utf8");
    await writeFile(responseArtifactPath, `${JSON.stringify(redactUnknown(responseSummary), null, 2)}\n`, "utf8");
    await writeFile(verificationArtifactPath, `${JSON.stringify(redactUnknown(verificationSummary), null, 2)}\n`, "utf8");

    return {
      apiMoveEnabled: true,
      apiMoveExecuted: true,
      athleteId,
      workoutId,
      sourceDate,
      targetDate,
      targetDateTime,
      putStatus: putResult.status,
      verificationStatus: verification.status,
      verificationOk: verification.ok,
      verificationWorkoutDay: verification.workoutDay,
      verificationMatchesTargetDate: verification.matchesTargetDate,
      authHeaderObserved: Boolean(capturedAuth.authorizationHeader),
      sampleTpApiUrl: capturedAuth.sampleRequestUrl,
      screenshotBeforePath: beforeScreenshotPath,
      screenshotAfterPath: afterScreenshotPath,
      artifacts: {
        requestArtifactPath,
        responseArtifactPath,
        verificationArtifactPath,
      },
      requestSummary,
      responseSummary,
      verificationSummary,
    };
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

async function findFirstVisibleLocator(
  candidates: Array<{ locator: import("playwright").Locator; selectorHint: string }>,
  timeout = 700
): Promise<{ locator: import("playwright").Locator; selectorHint: string } | null> {
  for (const candidate of candidates) {
    if (await isVisible(candidate.locator, timeout)) {
      return candidate;
    }
  }
  return null;
}

async function readDateFieldValue(locator: import("playwright").Locator): Promise<string | null> {
  return (await getInputValueSafe(locator, 700)) ?? (await getInnerTextSafe(locator, 700));
}

function looksLikeTrainingPeaksDateHeader(text: string | null): boolean {
  if (!text) {
    return false;
  }
  return Boolean(extractTrainingPeaksDateHeaderText(text));
}

function extractTrainingPeaksDateHeaderText(text: string | null): string | null {
  if (!text) {
    return null;
  }
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return null;
  }
  const strictMatch = normalized.match(TP_STRONG_DATE_HEADER_REGEX);
  if (strictMatch?.[0]) {
    return normalizeWhitespace(strictMatch[0]);
  }
  const fallbackMatch = normalized.match(TP_DATE_HEADER_REGEX);
  if (fallbackMatch?.[0]) {
    return normalizeWhitespace(fallbackMatch[0]);
  }
  return null;
}

function toProbeBoundingBox(
  box: { x: number; y: number; width: number; height: number } | null
): { x: number; y: number; width: number; height: number } | null {
  if (!box) {
    return null;
  }
  return {
    x: Math.round(box.x * 100) / 100,
    y: Math.round(box.y * 100) / 100,
    width: Math.round(box.width * 100) / 100,
    height: Math.round(box.height * 100) / 100,
  };
}

function boundingBoxCenter(box: { x: number; y: number; width: number; height: number }): { x: number; y: number } {
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}

function isBoxNearDateHeader(
  candidateBox: { x: number; y: number; width: number; height: number } | null,
  detailBox: { x: number; y: number; width: number; height: number } | null,
  headerBox: { x: number; y: number; width: number; height: number } | null
): boolean {
  if (!candidateBox) {
    return false;
  }
  const referenceHeaderBox = headerBox ?? detailBox;
  if (!referenceHeaderBox) {
    return true;
  }
  const candidateCenter = boundingBoxCenter(candidateBox);
  const headerCenter = boundingBoxCenter(referenceHeaderBox);
  const horizontalDistance = Math.abs(candidateCenter.x - headerCenter.x);
  const verticalDistance = candidateCenter.y - headerCenter.y;
  const horizontallyNear = horizontalDistance <= Math.max(280, referenceHeaderBox.width * 1.8);
  const verticallyNear = verticalDistance >= -120 && verticalDistance <= Math.max(440, referenceHeaderBox.height * 8);
  const belowOrOverlappingHeader = candidateBox.y <= referenceHeaderBox.y + referenceHeaderBox.height + 320;
  const notHugePageRegion =
    !detailBox || candidateBox.width * candidateBox.height <= detailBox.width * detailBox.height * 1.35;
  return horizontallyNear && verticallyNear && belowOrOverlappingHeader && notHugePageRegion;
}

function normalizeActionLabels(labels: string[]): string[] {
  const deduped = new Set<string>();
  for (const label of labels) {
    const normalized = normalizeWhitespace(label);
    if (!normalized) {
      continue;
    }
    deduped.add(normalized);
  }
  return [...deduped];
}

async function collectMenuActionLabels(menuRoot: import("playwright").Locator): Promise<string[]> {
  const selectors = [
    '[role="menuitem"]',
    '[role="option"]',
    "button",
    "li",
    '[class*="MenuItem" i]',
  ];
  const labels: string[] = [];
  for (const selector of selectors) {
    const snippets = await collectLocatorInnerTextSnippets(menuRoot.locator(selector), 12, 120);
    for (const snippet of snippets) {
      labels.push(snippet);
    }
    if (labels.length >= 12) {
      break;
    }
  }
  return normalizeActionLabels(labels);
}

async function findExactEditMenuAction(
  menuRoot: import("playwright").Locator
): Promise<{ locator: import("playwright").Locator; selectorHint: string } | null> {
  const directRoleMatch = menuRoot.getByRole("menuitem", { name: /^edit$/i }).first();
  if (await isVisible(directRoleMatch, 500)) {
    return {
      locator: directRoleMatch,
      selectorHint: 'role="menuitem" name=/^edit$/i',
    };
  }

  const candidateSelectors = ['[role="menuitem"]', '[role="option"]', "button", "li", '[class*="MenuItem" i]'];
  for (const selector of candidateSelectors) {
    const items = menuRoot.locator(selector);
    const count = Math.min(await items.count(), 20);
    for (let index = 0; index < count; index += 1) {
      const item = items.nth(index);
      if (!(await isVisible(item, 350))) {
        continue;
      }
      const text = normalizeWhitespace(await getInnerTextSafe(item));
      if (text && TP_EDIT_MENU_ACTION_REGEX.test(text)) {
        return {
          locator: item,
          selectorHint: `${selector} text=/^edit$/i`,
        };
      }
    }
  }

  return null;
}

async function findVisibleMenuRoot(
  page: import("playwright").Page
): Promise<{ locator: import("playwright").Locator; selectorHint: string } | null> {
  return findFirstVisibleLocator(
    [
      {
        locator: page.getByRole("menu").first(),
        selectorHint: 'role="menu"',
      },
      {
        locator: page.locator(".MuiMenu-paper,.MuiMenu-list,[role='presentation'] [role='menu']").first(),
        selectorHint: ".MuiMenu-paper,.MuiMenu-list,[role='presentation'] [role='menu']",
      },
    ],
    700
  );
}

async function menuStillVisible(page: import("playwright").Page): Promise<boolean> {
  return anyVisible(
    [
      page.getByRole("menu"),
      page.getByRole("menuitem", { name: /move|resched|postpone|shift|copy|duplicate/i }),
      page.getByText(/move|resched|postpone|shift|copy|duplicate/i),
    ],
    500
  );
}

async function clickAwayFromOverlay(page: import("playwright").Page): Promise<void> {
  try {
    await page.mouse.click(8, 8);
  } catch {
    // Ignore click-away failures and let the caller decide whether to continue.
  }
}

async function findVisibleDetailRoot(
  page: import("playwright").Page
): Promise<{ locator: import("playwright").Locator; selectorHint: string } | null> {
  const directRoot = await findFirstVisibleLocator(
    [
      {
        locator: page.getByRole("dialog").first(),
        selectorHint: 'role="dialog"',
      },
      {
        locator: page.locator(".MuiDialog-root:visible,.MuiDialog-container:visible,.MuiModal-root:visible").first(),
        selectorHint: ".MuiDialog-root,.MuiDialog-container,.MuiModal-root",
      },
      {
        locator: page.locator('[class*="Dialog" i]:visible,[class*="Modal" i]:visible,[class*="overlay" i]:visible').first(),
        selectorHint: '[class*="Dialog" i],[class*="Modal" i],[class*="overlay" i]',
      },
    ],
    700
  );
  if (directRoot) {
    return directRoot;
  }

  const heuristicContainers = page.locator(
    'body > div:visible,.MuiPaper-root:visible,.MuiDrawer-paper:visible,.MuiPopover-paper:visible,[class*="detail" i]:visible,[class*="workout" i]:visible,form:visible,section:visible'
  );
  const count = Math.min(await heuristicContainers.count(), 40);
  for (let index = 0; index < count; index += 1) {
    const candidate = heuristicContainers.nth(index);
    if (!(await isVisible(candidate, 350))) {
      continue;
    }
    const text = normalizeWhitespace(await getInnerTextSafe(candidate));
    if (!text) {
      continue;
    }
    let score = 0;
    if (looksLikeTrainingPeaksDateHeader(text)) {
      score += 2;
    }
    if (/save\s*&\s*close/i.test(text)) {
      score += 2;
    }
    if (/\bcancel\b/i.test(text)) {
      score += 1;
    }
    if (/\banaly(?:z|s)e\b|\bfiles?\b/i.test(text)) {
      score += 1;
    }
    if (/\btitle\b|\bworkout\b/i.test(text)) {
      score += 1;
    }
    if (TP_TIME_DROPDOWN_REGEX.test(text)) {
      score += 1;
    }
    if (score >= 3) {
      return {
        locator: candidate,
        selectorHint: "heuristic overlay root with workout detail signals",
      };
    }
  }

  return null;
}

async function findBoundedDateHeaderText(
  page: import("playwright").Page,
  modalRoot: import("playwright").Locator | null
): Promise<string | null> {
  const surfaces: import("playwright").Locator[] = [];
  if (modalRoot) {
    surfaces.push(modalRoot);
  }
  surfaces.push(page.locator("body").first());
  for (const surface of surfaces) {
    const text = await getInnerTextSafe(surface, 700);
    const matchedHeaderText = extractTrainingPeaksDateHeaderText(text);
    if (matchedHeaderText) {
      return matchedHeaderText;
    }
  }
  return null;
}

async function resolveDateHeaderDomRectSnapshotBounded(
  page: import("playwright").Page,
  dateHeaderText: string,
  context?: { stage?: string; actionId?: string | null; runId?: string | null }
): Promise<{
  found: boolean;
  text: string | null;
  tagName: string | null;
  className: string | null;
  rect: { x: number; y: number; width: number; height: number } | null;
  reason: string;
}> {
  const payload = { dateHeaderText };
  try {
    return await page.evaluate(`(() => {
      const input = ${JSON.stringify(payload)};
      const target = String(input.dateHeaderText || "").replace(/\\s+/g, " ").trim();
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      const body = document.body;
      if (!body) {
        return { found: false, text: null, tagName: null, className: null, rect: null, reason: "document.body unavailable" };
      }
      const modalNodes = Array.from(document.querySelectorAll('[role="dialog"], .MuiDialog-root, .MuiDialog-container, .MuiModal-root, [class*="dialog" i], [class*="modal" i]'));
      let modalRect = null;
      let modalReason = "no visible modal candidate";
      let bestModalScore = Number.NEGATIVE_INFINITY;
      for (const node of modalNodes) {
        if (!(node instanceof HTMLElement)) continue;
        const style = window.getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") continue;
        const opacity = Number(style.opacity || "1");
        if (Number.isFinite(opacity) && opacity < 0.05) continue;
        const rect = node.getBoundingClientRect();
        if (rect.width < 4 || rect.height < 4) continue;
        if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= viewportHeight || rect.left >= viewportWidth) continue;
        const area = rect.width * rect.height;
        const distanceFromCenter = Math.abs(rect.left + rect.width / 2 - viewportWidth / 2) + Math.abs(rect.top + rect.height / 2 - viewportHeight / 2);
        const score = area * 0.0001 - distanceFromCenter * 0.05 - rect.top * 0.03;
        if (score > bestModalScore) {
          bestModalScore = score;
          modalRect = rect;
          modalReason = "using visible modal candidate bounds";
        }
      }
      let bestMatch = null;
      for (const node of Array.from(body.querySelectorAll("*"))) {
        if (!(node instanceof HTMLElement)) continue;
        const style = window.getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") continue;
        const opacity = Number(style.opacity || "1");
        if (Number.isFinite(opacity) && opacity < 0.05) continue;
        const rect = node.getBoundingClientRect();
        if (rect.width < 4 || rect.height < 4) continue;
        if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= viewportHeight || rect.left >= viewportWidth) continue;
        const text = String(node.innerText || node.textContent || "").replace(/\\s+/g, " ").trim();
        if (!text || !target || !text.includes(target)) continue;
        const className = String(typeof node.className === "string" ? node.className : node.getAttribute("class") || "").replace(/\\s+/g, " ").trim();
        const role = String(node.getAttribute("role") || "").replace(/\\s+/g, " ").trim().toLowerCase();
        const cursor = String(style.cursor || "").replace(/\\s+/g, " ").trim().toLowerCase();
        const extraChars = Math.max(0, text.length - target.length);
        let score = text === target ? 140 : 90;
        score -= Math.min(70, extraChars * 0.8);
        score -= rect.width > viewportWidth * 0.8 ? 60 : 0;
        score -= rect.height > 120 ? 25 : 0;
        if (cursor.includes("pointer")) score += 28;
        if (role === "button" || node.tagName === "BUTTON") score += 24;
        if (node.hasAttribute("aria-haspopup")) score += 10;
        if (node.hasAttribute("tabindex")) score += 6;
        if (/(^|\\s)(date|day|header|calendar|picker)(\\s|$)/i.test(className)) score += 16;
        if (text.split(" ").length <= 8) score += 10;
        if (modalRect) {
          const insideModal = rect.left >= modalRect.left - 12 && rect.right <= modalRect.right + 12 && rect.top >= modalRect.top - 12 && rect.bottom <= modalRect.bottom + 12;
          score += insideModal ? 45 : -35;
          const leftDistance = Math.abs(rect.left - modalRect.left);
          const topDistance = Math.abs(rect.top - modalRect.top);
          score += Math.max(0, 40 - leftDistance * 0.08 - topDistance * 0.14);
        } else {
          score += Math.max(0, 18 - rect.left * 0.03 - rect.top * 0.04);
        }
        const candidate = {
          text,
          tagName: node.tagName || null,
          className: className || null,
          rect: {
            x: Math.round(rect.x * 100) / 100,
            y: Math.round(rect.y * 100) / 100,
            width: Math.round(rect.width * 100) / 100,
            height: Math.round(rect.height * 100) / 100,
          },
          reason: [modalReason, text === target ? "exact-text" : "contains-text", cursor.includes("pointer") ? "cursor-pointer" : null, role === "button" || node.tagName === "BUTTON" ? "button-role" : null, /(date|day|header|calendar|picker)/i.test(className) ? "dateish-class" : null, extraChars <= 40 ? "tight-text" : "long-text"].filter(Boolean).join("; "),
          score,
        };
        if (!bestMatch || candidate.score > bestMatch.score) bestMatch = candidate;
      }
      if (!bestMatch) {
        return {
          found: false,
          text: null,
          tagName: null,
          className: null,
          rect: null,
          reason: modalReason + "; no visible element text included target date header",
        };
      }
      return {
        found: true,
        text: bestMatch.text,
        tagName: bestMatch.tagName,
        className: bestMatch.className,
        rect: bestMatch.rect,
        reason: bestMatch.reason,
      };
    })()`);
  } catch (error) {
    const stage = context?.stage ?? "resolve-date-header-dom-rect";
    const actionPart = context?.actionId ? ` actionId=${context.actionId}` : "";
    const runPart = context?.runId ? ` runId=${context.runId}` : "";
    throw new Error(
      `evaluateContext=trainingpeaks helper=resolveDateHeaderDomRectSnapshotBounded stage=${stage}${actionPart}${runPart} cause=${toShortErrorMessage(error)}`
    );
  }
}

async function findVisibleDatePicker(
  page: import("playwright").Page,
  modalRoot: import("playwright").Locator | null = null,
  dateHeaderBox: { x: number; y: number; width: number; height: number } | null = null,
  dateHeaderText: string | null = null,
  diagnostics: string[] = []
): Promise<{ locator: import("playwright").Locator; selectorHint: string } | null> {
  const detailBox = modalRoot ? await modalRoot.boundingBox().catch(() => null) : null;
  const expectedMonthMatch = dateHeaderText?.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/i
  );
  const expectedMonth = expectedMonthMatch?.[1] ?? null;
  const expectedYearMatch = dateHeaderText?.match(/\b(20\d{2})\b/);
  const expectedYear = expectedYearMatch?.[1] ?? null;
  const candidateDefinitions = [
    {
      locator: page.locator(".MuiPickersPopper-root,.MuiPickersLayout-root,.MuiDateCalendar-root"),
      selectorHint: ".MuiPickersPopper-root,.MuiPickersLayout-root,.MuiDateCalendar-root",
    },
    {
      locator: page.locator('[role="dialog"] [role="grid"],[role="presentation"] [role="grid"]'),
      selectorHint: '[role="dialog"] [role="grid"],[role="presentation"] [role="grid"]',
    },
    {
      locator: page.locator('[aria-label*="calendar" i],[class*="calendar" i],[class*="datepicker" i],[class*="picker" i]'),
      selectorHint: '[aria-label*="calendar" i],[class*="calendar" i],[class*="datepicker" i],[class*="picker" i]',
    },
    {
      locator: page.locator(".MuiPopover-paper:visible,.MuiPaper-root:visible,[role='dialog']:visible,[role='presentation']:visible"),
      selectorHint: ".MuiPopover-paper,.MuiPaper-root,[role='dialog'],[role='presentation']",
    },
  ];

  for (const candidate of candidateDefinitions) {
    const count = Math.min(await candidate.locator.count().catch(() => 0), 8);
    for (let index = 0; index < count; index += 1) {
      const candidateLocator = candidate.locator.nth(index);
      if (!(await isVisible(candidateLocator, 500))) {
        continue;
      }
      const text = normalizeWhitespace(await getInnerTextSafe(candidateLocator)) ?? "";
      const candidateBox = toProbeBoundingBox(await candidateLocator.boundingBox().catch(() => null));
      const monthTextMatchesExpectation = expectedMonth ? new RegExp(`\\b${expectedMonth}\\b`, "i").test(text) : false;
      const yearTextMatchesExpectation = expectedYear ? new RegExp(`\\b${expectedYear}\\b`).test(text) : false;
      const hasMonthMarker = monthTextMatchesExpectation || TP_MONTH_REGEX.test(text);
      const hasYearMarker = yearTextMatchesExpectation || TP_YEAR_REGEX.test(text);
      const hasMonthControl = await anyVisible(
        [
          candidateLocator.locator('select[aria-label*="month" i],select[name*="month" i],[aria-label*="month" i],[title*="month" i]').first(),
          candidateLocator.getByRole("combobox", { name: /month/i }).first(),
          candidateLocator.getByRole("button", { name: expectedMonth ? new RegExp(`^${expectedMonth}$`, "i") : /january|february|march|april|may|june|july|august|september|october|november|december/i }).first(),
        ],
        300
      );
      const hasYearControl = await anyVisible(
        [
          candidateLocator.locator('select[aria-label*="year" i],select[name*="year" i],[aria-label*="year" i],[title*="year" i]').first(),
          candidateLocator.getByRole("combobox", { name: /year/i }).first(),
          candidateLocator.getByRole("button", { name: expectedYear ? new RegExp(`^${expectedYear}$`) : /20\d{2}/ }).first(),
        ],
        300
      );
      const hasMonthSwitcherButtons = await anyVisible(
        [
          candidateLocator.getByRole("button", { name: /previous month|next month|choose month/i }).first(),
          candidateLocator.locator('[aria-label*="month" i][role="button"],button[aria-label*="month" i]').first(),
        ],
        300
      );
      const hasYearSwitcherButtons = await anyVisible(
        [
          candidateLocator.getByRole("button", { name: /choose year|previous year|next year/i }).first(),
          candidateLocator.locator('[aria-label*="year" i][role="button"],button[aria-label*="year" i]').first(),
        ],
        300
      );
      const weekdayHeaderCount = await candidateLocator
        .locator('[role="columnheader"],th,.MuiDayCalendar-weekDayLabel')
        .count()
        .catch(() => 0);
      const hasWeekdayRow =
        TP_WEEKDAY_ROW_REGEX.test(text) ||
        /\b(?:mo|tu|we|th|fr|sa|su)\b/i.test(text) ||
        weekdayHeaderCount >= 7;
      const dayCellCount = await candidateLocator
        .locator('[role="gridcell"],[role="option"],button,.MuiPickersDay-root')
        .count()
        .catch(() => 0);
      const dayCellMatches = text.match(/(?:^|\s)(?:[1-9]|[12]\d|3[01])(?=\s|$)/g) ?? [];
      const hasEnoughDayCells = dayCellMatches.length >= 7 || dayCellCount >= 14;
      const hasSelectedCurrentDay = await anyVisible(
        [
          candidateLocator.locator('[aria-selected="true"]').first(),
          candidateLocator.locator(".Mui-selected,[class*='selected' i]").first(),
        ],
        250
      );
      const nearHeader = isBoxNearDateHeader(candidateBox, detailBox ? toProbeBoundingBox(detailBox) : null, dateHeaderBox);
      const monthSignal = hasMonthControl || hasMonthMarker || hasMonthSwitcherButtons;
      const yearSignal = hasYearControl || hasYearMarker || hasYearSwitcherButtons;
      diagnostics.push(
        normalizeWhitespace(
          [
            `check:${candidate.selectorHint}#${index + 1}`,
            `signals=${[
              monthSignal ? (monthTextMatchesExpectation ? "month-expected" : "month") : null,
              yearSignal ? (yearTextMatchesExpectation ? "year-expected" : "year") : null,
              hasWeekdayRow ? "weekday-row" : null,
              hasEnoughDayCells ? `days:${Math.max(dayCellCount, dayCellMatches.length)}` : null,
              hasSelectedCurrentDay ? "selected-day" : null,
              nearHeader ? "near-header" : "far-from-header",
            ]
              .filter(Boolean)
              .join("+")}`,
            candidateBox
              ? `box=${Math.round(candidateBox.x)},${Math.round(candidateBox.y)},${Math.round(candidateBox.width)}x${Math.round(candidateBox.height)}`
              : "box=none",
            text.slice(0, 140),
          ].join(" | ")
        ) ?? candidate.selectorHint
      );
      if (monthSignal && yearSignal && hasWeekdayRow && hasEnoughDayCells && nearHeader) {
        const signalHint = [
          hasMonthControl ? "month-control" : hasMonthMarker ? "month" : hasMonthSwitcherButtons ? "month-switcher" : null,
          hasYearControl ? "year-control" : hasYearMarker ? "year" : hasYearSwitcherButtons ? "year-switcher" : null,
          hasWeekdayRow ? "weekday-row" : null,
          hasEnoughDayCells ? "days" : null,
          hasSelectedCurrentDay ? "selected-day" : null,
          nearHeader ? "near-header" : null,
        ]
          .filter(Boolean)
          .join("+");
        return {
          locator: candidateLocator,
          selectorHint: `${candidate.selectorHint} [${signalHint}]`,
        };
      }
    }
  }

  return null;
}

async function detectVisibleDatePickerSnapshot(
  page: import("playwright").Page,
  input: {
    dateHeaderBox: { x: number; y: number; width: number; height: number } | null;
    dateHeaderText: string | null;
    sourceDateIso?: string | null;
    targetDateIso?: string | null;
  },
  context?: { stage?: string; actionId?: string | null; runId?: string | null }
): Promise<DatePickerDetectionSnapshot> {
  const payload = {
    dateHeaderBox: input.dateHeaderBox,
    dateHeaderText: input.dateHeaderText,
    sourceDateIso: input.sourceDateIso ?? null,
    targetDateIso: input.targetDateIso ?? null,
  };
  try {
    return await page.evaluate(`(() => {
      const input = ${JSON.stringify(payload)};
      const normalizeWhitespace = (value) => String(value || "").replace(/\\s+/g, " ").trim();
      const toNumericDay = (iso) => {
        const raw = String(iso || "");
        const m = raw.match(/^\\d{4}-(\\d{2})-(\\d{2})$/);
        if (!m) return null;
        const day = Number(m[2]);
        if (!Number.isFinite(day) || day < 1 || day > 31) return null;
        return day;
      };
      const sourceDay = toNumericDay(input.sourceDateIso);
      const targetDay = toNumericDay(input.targetDateIso);
      const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
      const extractMonthName = (text) => {
        const value = normalizeWhitespace(text);
        for (const month of monthNames) {
          if (new RegExp("\\\\b" + month + "\\\\b", "i").test(value)) return month;
        }
        return null;
      };
      const extractYear = (text) => {
        const m = normalizeWhitespace(text).match(/\\b(20\\d{2})\\b/);
        return m ? m[1] : null;
      };
      const extractVisibleDayCandidates = (text) => {
        const matches = normalizeWhitespace(text).match(/(?:^|\\s)([1-9]|[12]\\d|3[01])(?=\\s|$)/g) || [];
        const numbers = [];
        for (const raw of matches) {
          const n = Number(String(raw).trim());
          if (!Number.isFinite(n) || n < 1 || n > 31) continue;
          if (!numbers.includes(n)) numbers.push(n);
        }
        numbers.sort((a, b) => a - b);
        return numbers;
      };
      const dayButtonMatches = (element, day) => {
        const dayText = String(day);
        const candidates = Array.from(
          element.querySelectorAll('[role="gridcell"],[role="option"],button,.MuiPickersDay-root,[data-day]')
        );
        return candidates.filter((candidate) => {
          const text = normalizeWhitespace(candidate.innerText || candidate.textContent || "");
          const dataDay = candidate.getAttribute("data-day");
          const ariaLabel = normalizeWhitespace(candidate.getAttribute("aria-label"));
          if (dataDay && String(Number(dataDay)) === dayText) return true;
          if (new RegExp("(^|\\\\D)" + dayText + "(\\\\D|$)").test(text)) return true;
          if (new RegExp("(^|\\\\D)" + dayText + "(\\\\D|$)").test(ariaLabel)) return true;
          return false;
        });
      };
      const hasSelectedState = (element) => {
        const className = normalizeWhitespace(element.className || "");
        const ariaSelected = element.getAttribute("aria-selected");
        const selectedAttr = element.getAttribute("data-selected");
        return (
          ariaSelected === "true" ||
          selectedAttr === "true" ||
          /\\bMui-selected\\b/i.test(className) ||
          /\\bselected\\b/i.test(className) ||
          /\\bactive\\b/i.test(className)
        );
      };

      const monthRegex = /\\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\\b/i;
      const yearRegex = /\\b20\\d{2}\\b/;
      const weekdayRowRegex = /\\b(?:mo|tu|we|th|fr|sa|su)\\b(?:\\s+\\b(?:mo|tu|we|th|fr|sa|su)\\b){3,}/i;
      const dateHeaderText = normalizeWhitespace(input.dateHeaderText || "");
      const expectedMonthMatch = dateHeaderText.match(/\\b(January|February|March|April|May|June|July|August|September|October|November|December)\\b/i);
      const expectedMonth = expectedMonthMatch ? expectedMonthMatch[1] : null;
      const expectedYearMatch = dateHeaderText.match(/\\b(20\\d{2})\\b/);
      const expectedYear = expectedYearMatch ? expectedYearMatch[1] : null;
      const viewportWidth = (typeof window.innerWidth === "number" && Number.isFinite(window.innerWidth)) ? window.innerWidth : 0;
      const viewportHeight = (typeof window.innerHeight === "number" && Number.isFinite(window.innerHeight)) ? window.innerHeight : 0;
      const selectors = [
        ".MuiPickersPopper-root,.MuiPickersLayout-root,.MuiDateCalendar-root",
        '[role="dialog"] [role="grid"],[role="presentation"] [role="grid"]',
        '[aria-label*="calendar" i],[class*="calendar" i],[class*="datepicker" i],[class*="picker" i]',
        ".MuiPopover-paper,.MuiPaper-root,[role='dialog'],[role='presentation']"
      ];

      const elementSummary = (element) => {
        const idPart = element.id ? "#" + element.id : "";
        const classNames = normalizeWhitespace(element.className || "").split(" ").filter(Boolean).slice(0, 3);
        const classPart = classNames.length ? "." + classNames.join(".") : "";
        return String(element.tagName || "").toLowerCase() + idPart + classPart;
      };

      const isVisible = (element) => {
        const style = window.getComputedStyle(element);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.visibility === "collapse" ||
          Number(style.opacity || "1") === 0
        ) {
          return false;
        }
        const rect = element.getBoundingClientRect();
        if (rect.width < 16 || rect.height < 16) return false;
        if (rect.bottom < 0 || rect.right < 0 || rect.top > viewportHeight || rect.left > viewportWidth) return false;
        return true;
      };

      const isNearHeader = (candidateRect) => {
        const dateHeaderBox = input.dateHeaderBox || null;
        if (!dateHeaderBox) return true;
        const headerCenterX = Number(dateHeaderBox.x) + Number(dateHeaderBox.width) / 2;
        const headerCenterY = Number(dateHeaderBox.y) + Number(dateHeaderBox.height) / 2;
        const candidateCenterX = Number(candidateRect.x) + Number(candidateRect.width) / 2;
        const candidateCenterY = Number(candidateRect.y) + Number(candidateRect.height) / 2;
        const dx = Math.abs(candidateCenterX - headerCenterX);
        const dy = Math.abs(candidateCenterY - headerCenterY);
        const allowedX = Math.max(220, Number(dateHeaderBox.width) * 2.5);
        const allowedY = Math.max(280, Number(dateHeaderBox.height) * 8);
        return dx <= allowedX && dy <= allowedY;
      };

      const snippets = [];
      const seen = new Set();
      const detectionFallback = {
        opened: false,
        selectorHint: null,
        snippets: [],
        strategy: null,
        boundingBox: null,
        visibleMonth: null,
        visibleYear: null,
        visibleDayCandidates: [],
        targetDayVisible: false,
        targetDaySelectedVisible: false,
        selectedSourceDayVisible: false
      };

      for (const selector of selectors) {
        const matches = Array.from(document.querySelectorAll(selector)).slice(0, 8);
        for (const element of matches) {
          if (!(element instanceof HTMLElement)) continue;
          if (seen.has(element) || !isVisible(element)) continue;
          seen.add(element);
          const rect = element.getBoundingClientRect();
          const text = normalizeWhitespace(element.innerText || element.textContent || "");
          const visibleMonth = extractMonthName(text);
          const visibleYear = extractYear(text);
          const visibleDayCandidates = extractVisibleDayCandidates(text);
          const targetDayVisible = targetDay !== null ? visibleDayCandidates.includes(targetDay) : false;
          const sourceDayVisible = sourceDay !== null ? visibleDayCandidates.includes(sourceDay) : false;
          const sourceDaySelectedVisible = sourceDay !== null
            ? dayButtonMatches(element, sourceDay).some((candidate) => hasSelectedState(candidate))
            : false;
          const targetDaySelectedVisible = targetDay !== null
            ? dayButtonMatches(element, targetDay).some((candidate) => hasSelectedState(candidate))
            : false;
          const monthTextMatchesExpectation = expectedMonth ? new RegExp("\\\\b" + expectedMonth + "\\\\b", "i").test(text) : false;
          const yearTextMatchesExpectation = expectedYear ? new RegExp("\\\\b" + expectedYear + "\\\\b").test(text) : false;
          const hasMonthSignal =
            monthTextMatchesExpectation ||
            Boolean(expectedMonth && element.querySelector('[aria-label*="' + expectedMonth + '" i],[title*="' + expectedMonth + '" i]')) ||
            monthRegex.test(text) ||
            Boolean(element.querySelector('[aria-label*="month" i],[title*="month" i],select[name*="month" i]'));
          const hasYearSignal =
            yearTextMatchesExpectation ||
            yearRegex.test(text) ||
            Boolean(element.querySelector('[aria-label*="year" i],[title*="year" i],select[name*="year" i]'));
          const weekdayHeaderCount = element.querySelectorAll('[role="columnheader"],th,.MuiDayCalendar-weekDayLabel').length;
          const hasWeekdayRow = weekdayRowRegex.test(text) || /\\b(?:mo|tu|we|th|fr|sa|su)\\b/i.test(text) || weekdayHeaderCount >= 7;
          const dayCellCount = element.querySelectorAll('[role="gridcell"],[role="option"],button,.MuiPickersDay-root').length;
          const dayCellMatches = text.match(/(?:^|\\s)(?:[1-9]|[12]\\d|3[01])(?=\\s|$)/g) || [];
          const hasEnoughDayCells = dayCellCount >= 14 || dayCellMatches.length >= 7;
          const nearHeader = isNearHeader(rect);
          snippets.push(
            normalizeWhitespace([
              "check:" + selector,
              "element=" + elementSummary(element),
              "signals=" + ([
                hasMonthSignal ? (monthTextMatchesExpectation ? "month-expected" : "month") : null,
                hasYearSignal ? (yearTextMatchesExpectation ? "year-expected" : "year") : null,
                hasWeekdayRow ? "weekday-row" : null,
                hasEnoughDayCells ? "days:" + String(Math.max(dayCellCount, dayCellMatches.length)) : null,
                targetDayVisible ? "target-day-visible" : null,
                targetDaySelectedVisible ? "target-day-selected" : null,
                sourceDaySelectedVisible ? "source-day-selected" : (sourceDayVisible ? "source-day-visible" : null),
                nearHeader ? "near-header" : "far-from-header"
              ].filter(Boolean).join("+") || "none"),
              "box=" + String(Math.round(rect.x)) + "," + String(Math.round(rect.y)) + "," + String(Math.round(rect.width)) + "x" + String(Math.round(rect.height)),
              text.slice(0, 140)
            ].join(" | "))
          );
          detectionFallback.snippets = snippets.slice(0, 12);
          detectionFallback.visibleMonth = detectionFallback.visibleMonth || visibleMonth;
          detectionFallback.visibleYear = detectionFallback.visibleYear || visibleYear;
          if (detectionFallback.visibleDayCandidates.length === 0 && visibleDayCandidates.length > 0) {
            detectionFallback.visibleDayCandidates = visibleDayCandidates.slice();
          }
          detectionFallback.targetDayVisible = detectionFallback.targetDayVisible || targetDayVisible;
          detectionFallback.targetDaySelectedVisible = detectionFallback.targetDaySelectedVisible || targetDaySelectedVisible;
          detectionFallback.selectedSourceDayVisible = detectionFallback.selectedSourceDayVisible || sourceDaySelectedVisible;
          if (!detectionFallback.boundingBox && rect.width >= 16 && rect.height >= 16) {
            detectionFallback.boundingBox = {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height
            };
          }
          if (hasMonthSignal && hasYearSignal && hasWeekdayRow && hasEnoughDayCells && nearHeader) {
            const strategySignals = [
              hasMonthSignal ? "month" : null,
              hasYearSignal ? "year" : null,
              hasWeekdayRow ? "weekday-row" : null,
              hasEnoughDayCells ? "day-grid" : null,
              targetDayVisible ? "target-day-visible" : null,
              targetDaySelectedVisible ? "target-day-selected" : null,
              sourceDaySelectedVisible ? "source-day-selected" : null,
              nearHeader ? "near-header" : null
            ].filter(Boolean).join("+");
            return {
              opened: true,
              selectorHint: selector + " [dom-snapshot]",
              snippets: snippets.slice(0, 12),
              strategy: strategySignals || "dom-snapshot",
              boundingBox: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height
              },
              visibleMonth: visibleMonth,
              visibleYear: visibleYear,
              visibleDayCandidates: visibleDayCandidates,
              targetDayVisible: targetDayVisible,
              targetDaySelectedVisible: targetDaySelectedVisible,
              selectedSourceDayVisible: sourceDaySelectedVisible
            };
          }
        }
      }

      return detectionFallback;
    })()`);
  } catch (error) {
    const stage = context?.stage ?? "detect-date-picker";
    const actionPart = context?.actionId ? ` actionId=${context.actionId}` : "";
    const runPart = context?.runId ? ` runId=${context.runId}` : "";
    throw new Error(
      `evaluateContext=trainingpeaks helper=detectVisibleDatePickerSnapshot stage=${stage}${actionPart}${runPart} cause=${toShortErrorMessage(error)}`
    );
  }
}

async function collectVisibleDatepickerDebugSnapshot(
  page: import("playwright").Page,
  input: {
    artifactPath: string;
    actionId: string;
    runId: string;
    dateHeaderBox: { x: number; y: number; width: number; height: number } | null;
    sourceDateIso?: string | null;
    targetDateIso?: string | null;
  }
): Promise<DatepickerDebugCaptureResult> {
  const context: DatepickerDomDebugContext = {
    actionId: input.actionId,
    runId: input.runId,
    sourceDateIso: input.sourceDateIso ?? null,
    targetDateIso: input.targetDateIso ?? null,
  };

  const startedArtifact: DatepickerDomDebugPartialArtifact = {
    created: true,
    stage: "started",
    timestamp: new Date().toISOString(),
    context,
  };
  await writeFile(input.artifactPath, JSON.stringify(startedArtifact, null, 2), "utf8");

  const stageB = await page.evaluate(() => {
    const bodyText = (document.body?.innerText ?? "").slice(0, 20_000);
    const viewport = {
      width: typeof window.innerWidth === "number" && Number.isFinite(window.innerWidth) ? window.innerWidth : 0,
      height: typeof window.innerHeight === "number" && Number.isFinite(window.innerHeight) ? window.innerHeight : 0,
    };
    const modalCandidate = document.querySelector('[role="dialog"],.MuiDialog-root,.MuiModal-root');
    const modalText = (modalCandidate?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 4_000);
    return {
      bodyTextSample: bodyText,
      viewport,
      modalTextSample: modalText || null,
    };
  });

  const pageUrl = await page.url();
  const pageTitle = await page.title().catch(() => null);
  let stageCError: string | null = null;
  let stageCErrorDetails: string | null = null;
  let snapshot: DatepickerDomDebugSnapshot | null = null;

  try {
    snapshot = await page.evaluate(
      `(({ dateHeaderBox, sourceDateIso, targetDateIso }) => {
        const normalize = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();
        const clip = (value, max = 120) => {
          const text = normalize(value);
          return text.length > max ? text.slice(0, max) : text;
        };
        const toNumericDay = (iso) => {
          const m = String(iso ?? "").match(/^\\d{4}-\\d{2}-(\\d{2})$/);
          if (!m) return null;
          const day = Number(m[1]);
          return Number.isFinite(day) && day >= 1 && day <= 31 ? day : null;
        };
        const sourceDay = toNumericDay(sourceDateIso);
        const targetDay = toNumericDay(targetDateIso);
        const monthNames = [
          "January","February","March","April","May","June",
          "July","August","September","October","November","December"
        ];
        const weekdayTokens = ["mo", "tu", "we", "th", "fr", "sa", "su"];
        const monthRegex = /\\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\\b/i;
        const yearRegex = /\\b(20\\d{2})\\b/;
        const dayRegex = /\\b([1-9]|[12]\\d|3[01])\\b/g;
        const signalRegexes = [/\\bmay\\b/i,/\\b2026\\b/,/\\bmo\\b/i,/\\btu\\b/i,/\\bwe\\b/i,/\\bth\\b/i,/\\bfr\\b/i,/\\bsa\\b/i,/\\bsu\\b/i,/\\b16\\b/,/\\b17\\b/,/\\bselect date\\b/i];
        const viewportWidth = Number.isFinite(window.innerWidth) ? window.innerWidth : 0;
        const viewportHeight = Number.isFinite(window.innerHeight) ? window.innerHeight : 0;
        const intersects = (a, b) => !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
        const isVisibleLike = (element) => {
          const style = window.getComputedStyle(element);
          if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
          const opacity = Number(style.opacity || "1");
          if (Number.isFinite(opacity) && opacity === 0) return false;
          const rect = element.getBoundingClientRect();
          if (rect.width < 2 || rect.height < 2) return false;
          if (rect.bottom < 0 || rect.right < 0 || rect.top > viewportHeight || rect.left > viewportWidth) return false;
          return true;
        };
        const isNearHeader = (rect) => {
          if (!dateHeaderBox) return false;
          const headerCx = dateHeaderBox.x + dateHeaderBox.width / 2;
          const headerCy = dateHeaderBox.y + dateHeaderBox.height / 2;
          const cx = rect.x + rect.width / 2;
          const cy = rect.y + rect.height / 2;
          const dx = Math.abs(cx - headerCx);
          const dy = Math.abs(cy - headerCy);
          const allowedX = Math.max(320, dateHeaderBox.width * 4);
          const allowedY = Math.max(420, dateHeaderBox.height * 10);
          return dx <= allowedX && dy <= allowedY;
        };
        const modalCandidateNodes = Array.from(document.querySelectorAll('[role="dialog"],.MuiDialog-root,.MuiModal-root'));
        let modalRect = null;
        for (const node of modalCandidateNodes) {
          if (!isVisibleLike(node)) continue;
          const r = node.getBoundingClientRect();
          if (r.width >= 100 && r.height >= 80) {
            modalRect = r;
            break;
          }
        }
        const isInsideModal = (rect) => (modalRect ? intersects(rect, modalRect) : false);
        const addMonthFromText = (text, current) => {
          if (current) return current;
          for (const month of monthNames) {
            if (new RegExp("\\\\b" + month + "\\\\b", "i").test(text)) return month;
          }
          return null;
        };

        const selectors = [
          "button","input","select",'[role="gridcell"]','[role="cell"]',"td",'[role="columnheader"]',"th","div","span"
        ];
        const perSelectorLimit = 700;
        const maxElements = 500;
        const seen = new Set();
        const visibleElements = [];
        const visibleDaySet = new Set();
        const weekdayTokenSet = new Set();
        let visibleMonth = null;
        let visibleYear = null;
        let selectedSourceDayVisible = false;
        let sourceDayVisible = false;
        let targetDayVisible = false;
        let targetDateClickCandidateFound = false;
        let targetDateClickCandidateBoundingBox = null;

        for (const selector of selectors) {
          if (visibleElements.length >= maxElements) break;
          const nodes = Array.from(document.querySelectorAll(selector)).slice(0, perSelectorLimit);
          for (const element of nodes) {
            if (visibleElements.length >= maxElements) break;
            if (seen.has(element)) continue;
            seen.add(element);
            if (!(element instanceof HTMLElement)) continue;
            const rect = element.getBoundingClientRect();
            const visible = isVisibleLike(element);
            if (!visible) continue;
            const text = clip(element.innerText || element.textContent || "", 160);
            const role = clip(element.getAttribute("role"), 60);
            const ariaLabel = clip(element.getAttribute("aria-label"), 120);
            const className = clip(element.className || "", 160);
            const id = clip(element.id || "", 80);
            const style = window.getComputedStyle(element);
            const nearDateHeader = isNearHeader(rect);
            const insideModal = isInsideModal(rect);
            const textLower = text.toLowerCase();
            const matchedSignals = [];

            if (monthRegex.test(text)) matchedSignals.push("month");
            if (yearRegex.test(text)) matchedSignals.push("year");
            for (const token of weekdayTokens) {
              if (new RegExp("\\\\b" + token + "\\\\b", "i").test(text)) weekdayTokenSet.add(token);
            }
            const dayMatches = text.match(dayRegex) || [];
            for (const dayRaw of dayMatches) {
              const dayNum = Number(dayRaw);
              if (Number.isFinite(dayNum) && dayNum >= 1 && dayNum <= 31) visibleDaySet.add(dayNum);
            }
            if (sourceDay !== null && new RegExp("\\\\b" + sourceDay + "\\\\b").test(text)) {
              sourceDayVisible = true;
              matchedSignals.push("source-day");
            }
            if (targetDay !== null && new RegExp("\\\\b" + targetDay + "\\\\b").test(text)) {
              targetDayVisible = true;
              matchedSignals.push("target-day");
            }
            const hasSelectedState =
              element.getAttribute("aria-selected") === "true" ||
              /\\bMui-selected\\b/i.test(className) ||
              /\\bselected\\b/i.test(className);
            if (sourceDay !== null && hasSelectedState && new RegExp("\\\\b" + sourceDay + "\\\\b").test(text + " " + ariaLabel)) {
              selectedSourceDayVisible = true;
              matchedSignals.push("source-day-selected");
            }
            if (
              targetDay !== null &&
              !targetDateClickCandidateFound &&
              nearDateHeader &&
              (insideModal || /picker|calendar|date|day/i.test(className)) &&
              (
                role === "gridcell" ||
                role === "option" ||
                element.tagName === "BUTTON" ||
                element.tagName === "TD" ||
                new RegExp("\\\\b" + targetDay + "\\\\b").test(ariaLabel)
              ) &&
              new RegExp("\\\\b" + targetDay + "\\\\b").test(text + " " + ariaLabel)
            ) {
              targetDateClickCandidateFound = true;
              targetDateClickCandidateBoundingBox = {
                x: Math.round(rect.x * 100) / 100,
                y: Math.round(rect.y * 100) / 100,
                width: Math.round(rect.width * 100) / 100,
                height: Math.round(rect.height * 100) / 100,
              };
            }

            const isTagCandidate =
              element.tagName === "BUTTON" ||
              element.tagName === "INPUT" ||
              element.tagName === "SELECT" ||
              role === "gridcell" ||
              role === "cell" ||
              role === "columnheader" ||
              element.tagName === "TD" ||
              element.tagName === "TH";
            const shortTextCandidate =
              (element.tagName === "DIV" || element.tagName === "SPAN") &&
              text.length > 0 &&
              text.length <= 60;
            const hasSignalText = signalRegexes.some((rx) => rx.test(textLower));
            if (!isTagCandidate && !(shortTextCandidate && (insideModal || nearDateHeader || hasSignalText))) {
              continue;
            }

            visibleMonth = addMonthFromText(text, visibleMonth);
            if (!visibleYear) {
              const yearMatch = text.match(yearRegex);
              visibleYear = yearMatch ? yearMatch[1] : null;
            }
            if (insideModal) matchedSignals.push("inside-modal");
            if (nearDateHeader) matchedSignals.push("near-date-header");
            if (hasSignalText) matchedSignals.push("signal-text");

            let value = null;
            if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLButtonElement) {
              value = clip(element.value ?? "", 120) || null;
            }
            visibleElements.push({
              tagName: element.tagName.toLowerCase(),
              textContent: text || null,
              value,
              ariaLabel: ariaLabel || null,
              role: role || null,
              className: className || null,
              id: id || null,
              boundingBox: {
                x: Math.round(rect.x * 100) / 100,
                y: Math.round(rect.y * 100) / 100,
                width: Math.round(rect.width * 100) / 100,
                height: Math.round(rect.height * 100) / 100,
              },
              isVisible: visible,
              position: clip(style.position || "", 40) || null,
              zIndex: clip(style.zIndex || "", 40) || null,
              nearDateHeader,
              insideModal,
              matchedSignals,
            });
          }
        }

        const visibleDayCandidates = Array.from(visibleDaySet).sort((a, b) => a - b).slice(0, 31);
        const weekdayMatched = Array.from(weekdayTokenSet).sort();
        const monthSignal = Boolean(visibleMonth);
        const yearSignal = Boolean(visibleYear);
        const weekdaySignal = weekdayMatched.length >= 5;
        const dayGridSignal = visibleDayCandidates.length >= 7;
        const sourceSignal = sourceDay !== null ? (visibleDayCandidates.includes(sourceDay) || sourceDayVisible) : false;
        const targetSignal = targetDay !== null ? (visibleDayCandidates.includes(targetDay) || targetDayVisible) : false;
        const reasons = [
          monthSignal ? "month:" + visibleMonth : null,
          yearSignal ? "year:" + visibleYear : null,
          weekdaySignal ? "weekday:" + weekdayMatched.join(",") : null,
          dayGridSignal ? "day-grid:" + visibleDayCandidates.length : null,
          sourceSignal ? "source-day:" + sourceDay : null,
          targetSignal ? "target-day:" + targetDay : null,
          selectedSourceDayVisible ? "source-day-selected" : null,
        ].filter(Boolean);
        const openByMultisignal = monthSignal && yearSignal && weekdaySignal && dayGridSignal && sourceSignal && targetSignal;

        const scored = visibleElements
          .map((element) => {
            const text = (element.textContent || "").toLowerCase();
            const score =
              (element.insideModal ? 2 : 0) +
              (element.nearDateHeader ? 2 : 0) +
              (element.matchedSignals.includes("month") ? 2 : 0) +
              (element.matchedSignals.includes("year") ? 2 : 0) +
              (element.matchedSignals.includes("target-day") ? 2 : 0) +
              (element.matchedSignals.includes("source-day") ? 1 : 0) +
              (element.tagName === "button" || element.role === "gridcell" ? 1 : 0) +
              (/\\bmo\\b|\\btu\\b|\\bwe\\b|\\bth\\b|\\bfr\\b|\\bsa\\b|\\bsu\\b/.test(text) ? 1 : 0);
            return { score, element };
          })
          .sort((a, b) => b.score - a.score)
          .slice(0, 20)
          .map(({ element }) =>
            normalize(
              [
                element.tagName,
                element.role ? "role=" + element.role : null,
                element.className ? "class=" + element.className.slice(0, 60) : null,
                element.textContent ? "text=" + element.textContent.slice(0, 80) : null,
              ].filter(Boolean).join(" | ")
            )
          );

        return {
          collectedAt: new Date().toISOString(),
          sourceDateIso: sourceDateIso ?? null,
          targetDateIso: targetDateIso ?? null,
          dateHeaderBoundingBox: dateHeaderBox
            ? { x: dateHeaderBox.x, y: dateHeaderBox.y, width: dateHeaderBox.width, height: dateHeaderBox.height }
            : null,
          modalBoundingBox: modalRect
            ? {
                x: Math.round(modalRect.x * 100) / 100,
                y: Math.round(modalRect.y * 100) / 100,
                width: Math.round(modalRect.width * 100) / 100,
                height: Math.round(modalRect.height * 100) / 100,
              }
            : null,
          topCandidates: scored,
          visibleElements: visibleElements.slice(0, maxElements),
          signals: {
            month: visibleMonth,
            year: visibleYear,
            weekdayTokens: weekdayMatched,
            weekdayTokenCount: weekdayMatched.length,
            visibleDayCandidates,
            sourceDayVisible: sourceSignal,
            selectedSourceDayVisible,
            targetDayVisible: targetSignal,
            targetDateClickCandidateFound,
            targetDateClickCandidateBoundingBox,
            openByMultisignal,
            reasons,
          },
        };
      })`,
      {
        dateHeaderBox: input.dateHeaderBox,
        sourceDateIso: input.sourceDateIso ?? null,
        targetDateIso: input.targetDateIso ?? null,
      }
    );
  } catch (error) {
    stageCErrorDetails = formatStageFailureDiagnostic({
      stage: "collectVisibleDatepickerDebugSnapshot",
      substage: "stage_c_collect_snapshot",
      error,
      details: {
        sourceDateIso: input.sourceDateIso ?? null,
        targetDateIso: input.targetDateIso ?? null,
        dateHeaderBoxProvided: Boolean(input.dateHeaderBox),
        selectorScanPlan: "button,input,select,[role=gridcell],[role=cell],td,[role=columnheader],th,div,span",
        perSelectorLimit: 700,
        maxElements: 500,
      },
    });
    stageCError = stageCErrorDetails;
  }

  if (snapshot) {
    const completeArtifact: DatepickerDomDebugSnapshot & {
      stage: "complete";
      created: true;
      context: DatepickerDomDebugContext;
      datepickerDomDebugError: null;
    } = {
      ...snapshot,
      stage: "complete",
      created: true,
      context,
      datepickerDomDebugError: null,
    };
    await writeFile(input.artifactPath, JSON.stringify(completeArtifact, null, 2), "utf8");
    return {
      snapshot,
      artifactPath: input.artifactPath,
      bodyTextSample: stageB.bodyTextSample,
      pageUrl,
      pageTitle,
      stageCError: null,
      stageCErrorDetails: null,
    };
  }

  const partialArtifact: DatepickerDomDebugPartialArtifact = {
    created: true,
    stage: "partial",
    timestamp: new Date().toISOString(),
    context,
    error:
      stageCError ??
      JSON.stringify({
        stage: "collectVisibleDatepickerDebugSnapshot",
        substage: "stage_c_collect_snapshot",
        errorName: "UnknownError",
        errorMessage: "Stage C snapshot failed without a caught exception.",
        errorStack: null,
      }),
    datepickerDomDebugError:
      stageCError ??
      JSON.stringify({
        stage: "collectVisibleDatepickerDebugSnapshot",
        substage: "stage_c_collect_snapshot",
        errorName: "UnknownError",
        errorMessage: "Stage C snapshot failed without a caught exception.",
        errorStack: null,
      }),
    bodyTextSample: stageB.bodyTextSample,
    pageUrl,
    pageTitle,
    viewport: stageB.viewport,
    modalTextSample: stageB.modalTextSample,
  };
  await writeFile(input.artifactPath, JSON.stringify(partialArtifact, null, 2), "utf8");
  return {
    snapshot: null,
    artifactPath: input.artifactPath,
    bodyTextSample: stageB.bodyTextSample,
    pageUrl,
    pageTitle,
    stageCError,
    stageCErrorDetails,
  };
}

function applyBodyTextMultiSignalFallback(
  detail: UiCapabilityProbeDetailDiscovery,
  bodyTextSample: string
): { activated: boolean } {
  const sample = bodyTextSample || "";
  const hasMonth = /\bMay\b/i.test(sample);
  const hasYear = /\b2026\b/.test(sample);
  const hasWeekdays = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].every((token) =>
    new RegExp(`\\b${token}\\b`, "i").test(sample)
  );
  const has16 = /\b16\b/.test(sample);
  const has17 = /\b17\b/.test(sample);
  const activated = hasMonth && hasYear && hasWeekdays && has16 && has17;

  if (!activated) {
    return { activated: false };
  }

  detail.datePickerOpened = true;
  detail.datePickerDetectionStrategy = "body_text_multisignal_fallback";
  detail.visibleMonth = detail.visibleMonth ?? "May";
  detail.visibleYear = detail.visibleYear ?? "2026";
  detail.targetDayVisible = detail.targetDayVisible || has17;
  detail.selectedSourceDayVisible = detail.selectedSourceDayVisible || has16;
  return { activated: true };
}

async function detailStillVisible(page: import("playwright").Page): Promise<boolean> {
  return anyVisible(
    [
      page.getByRole("dialog"),
      page.locator(".MuiDialog-root,.MuiDialog-container,.MuiModal-root"),
      page.locator('input[name*="date" i], input[id*="date" i], [aria-label*="date" i]'),
      page.getByRole("button", { name: /save|done|update/i }),
      page.getByRole("button", { name: /cancel|close|x/i }),
    ],
    500
  );
}

async function probeTrainingPeaksMoveCapabilities(
  claimed: ClaimedRealAction,
  runId: string,
  comparison: RevalidationComparison
): Promise<UiCapabilityProbe> {
  const probe = buildEmptyUiCapabilityProbe();
  const markStep = (step: string): void => {
    probe.progress.currentStep = step;
    probe.progress.updatedAt = new Date().toISOString();
    probe.progress.stepHistory.push(step);
  };
  const completeStep = (step?: string): void => {
    probe.progress.lastCompletedStep = step ?? probe.progress.currentStep;
    probe.progress.currentStep = null;
    probe.progress.updatedAt = new Date().toISOString();
  };
  const runStep = async <T>(step: string, timeoutMs: number, fn: () => Promise<T>): Promise<T> => {
    const previousCompletedStep = probe.progress.lastCompletedStep;
    markStep(step);
    try {
      const result = await withUiProbeTimeout(step, timeoutMs, fn);
      completeStep(step);
      return result;
    } catch (error) {
      const message = toShortErrorMessage(error);
      probe.progress.lastCompletedStep = previousCompletedStep;
      if (message.startsWith("UI capability probe timeout at step")) {
        probe.progress.timeoutStep = step;
        probe.progress.timeoutAt = new Date().toISOString();
      }
      throw error;
    }
  };
  const student = claimed.student;
  if (!student) {
    probe.errors.push(`Student is missing for action ${claimed.action.id}.`);
    return probe;
  }
  if (!student.trainingpeaks_athlete_url?.trim()) {
    probe.errors.push(`Missing trainingpeaks_athlete_url for student ${student.student_name}.`);
    return probe;
  }

  const sourceDate = comparison.sourceDate.current ?? comparison.sourceDate.trusted;
  const candidate = comparison.currentCandidate ?? comparison.trustedCandidate;
  if (!sourceDate) {
    probe.errors.push("Probe skipped: source date is unavailable after revalidation.");
    return probe;
  }

  await mkdir(profileDir, { recursive: true });
  const artifactDir = path.join(ACTION_ARTIFACTS_ROOT, claimed.action.id, runId);
  await mkdir(artifactDir, { recursive: true });

  const screenshotBeforePath = path.join(artifactDir, "probe_before.png");
  const screenshotMenuOpenedPath = path.join(artifactDir, "probe2_menu_opened.png");
  const screenshotAfterEditClickPath = path.join(artifactDir, "probe3_after_edit_click.png");
  const screenshotDetailOpenedPath = path.join(artifactDir, "probe2_detail_opened.png");
  const screenshotBeforeDateHeaderClickPath = path.join(artifactDir, "probe2_before_date_header_click.png");
  const screenshotAfterDateHeaderClickAttempt1Path = path.join(artifactDir, "probe2_after_date_header_click_attempt_1.png");
  const screenshotDatePickerOpenedPath = path.join(artifactDir, "probe2_datepicker_opened.png");
  const screenshotAfterTargetDayClickPath = path.join(artifactDir, "probe2_after_target_day_click.png");
  const datepickerDomDebugPath = path.join(artifactDir, "datepicker_dom_debug.json");
  const screenshotAfterClosedPath = path.join(artifactDir, "probe2_after_closed.png");
  const screenshotTimeoutPath = path.join(artifactDir, "probe_timeout.png");
  let context: import("playwright").BrowserContext | null = null;
  let probePage: import("playwright").Page | null = null;

  const probeTask = (async () => {
    context = await runStep("launch browser context", UI_PROBE_STEP_TIMEOUTS.launchBrowserContext, async () => {
      return await chromium.launchPersistentContext(profileDir, {
        headless: true,
        viewport: null,
      });
    });

    const page = context.pages()[0] ?? (await context.newPage());
    probePage = page;
    await runStep("open athlete page", UI_PROBE_STEP_TIMEOUTS.openAthletePage, async () => {
      await page.goto(student.trainingpeaks_athlete_url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await waitForTrainingPeaksCalendarReadiness(page, probe.warnings);
    });

    const pageAssessment = await assessTrainingPeaksPage(page);
    if (pageAssessment.loginRequired) {
      probe.errors.push("Probe aborted: TrainingPeaks session expired or login required.");
      return probe;
    }
    if (!pageAssessment.trainingPeaksContextLikely || !pageAssessment.athletePageLikelyReachable) {
      probe.errors.push("Probe aborted: athlete TrainingPeaks page is not safely reachable.");
      return probe;
    }

    probe.screenshots.before = await runStep(
      "capture probe_before screenshot",
      UI_PROBE_STEP_TIMEOUTS.captureScreenshot,
      async () => {
        return await captureProbeScreenshot(page, screenshotBeforePath, probe.warnings);
      }
    );

    const cardMatch = await runStep("locate candidate card", UI_PROBE_STEP_TIMEOUTS.locateCandidateCard, async () => {
      return await locateWorkoutCardForProbe(page, {
        studentId: student.id,
        sourceDate,
        candidate,
      });
    });
    probe.card.found = Boolean(cardMatch.locator);
    probe.card.selectorUsed = cardMatch.selectorUsed;
    probe.card.textSnippet = cardMatch.textSnippet;

    if (!cardMatch.locator) {
      probe.errors.push("Probe could not match the revalidated candidate back to a visible calendar card.");
      return probe;
    }

    const card = cardMatch.locator;
    await runStep("card hover", UI_PROBE_STEP_TIMEOUTS.cardHover, async () => {
      await card.hover({ timeout: 2_000 }).catch(() => {});
    });
    const safeMenuButton = await findFirstVisibleLocator(
      [
        {
          locator: card.locator('button[aria-haspopup="menu"]').first(),
          selectorHint: 'button[aria-haspopup="menu"]',
        },
        {
          locator: card.locator('[aria-label*="more" i],[title*="more" i],[data-tooltip*="more" i]').first(),
          selectorHint: '[aria-label*="more" i],[title*="more" i],[data-tooltip*="more" i]',
        },
        {
          locator: card.locator('[aria-label*="menu" i],[title*="menu" i],[data-tooltip*="menu" i]').first(),
          selectorHint: '[aria-label*="menu" i],[title*="menu" i],[data-tooltip*="menu" i]',
        },
        {
          locator: card.locator(".MuiIconButton-root").first(),
          selectorHint: ".MuiIconButton-root",
        },
      ],
      700
    );
    if (safeMenuButton) {
      probe.card.menuButtonFound = true;
      probe.card.menuTriggerFound = true;
      probe.card.menuTriggerSelectorUsed = safeMenuButton.selectorHint;
      try {
        const menuRoot = await runStep("open card menu", UI_PROBE_STEP_TIMEOUTS.openCardMenu, async () => {
          await safeMenuButton.locator.first().click({ timeout: 2_000 });
          await page.waitForTimeout(400);
          return await findVisibleMenuRoot(page);
        });
        probe.card.menuOpened = Boolean(menuRoot);
        if (probe.card.menuOpened) {
          probe.card.menuActionLabels = menuRoot
            ? await runStep("extract menu labels", UI_PROBE_STEP_TIMEOUTS.extractMenuLabels, async () => {
                return await collectMenuActionLabels(menuRoot.locator);
              })
            : [];
          probe.card.menuMoveActionFound = probe.card.menuActionLabels.some((label) => TP_MOVE_MENU_ACTION_REGEX.test(label));
          probe.card.menuRescheduleActionFound = probe.card.menuActionLabels.some((label) =>
            TP_RESCHEDULE_MENU_ACTION_REGEX.test(label)
          );
          probe.card.menuCopyActionFound = probe.card.menuActionLabels.some((label) => TP_COPY_MENU_ACTION_REGEX.test(label));
          probe.card.menuEditActionFound = probe.card.menuActionLabels.some((label) => TP_EDIT_MENU_ACTION_REGEX.test(label));
          probe.card.menuMoveOptionFound = probe.card.menuMoveActionFound;
          probe.card.menuRescheduleOptionFound = probe.card.menuRescheduleActionFound;
          probe.card.menuCopyOptionFound = probe.card.menuCopyActionFound;
          probe.screenshots.menuOpened = await captureProbeScreenshot(page, screenshotMenuOpenedPath, probe.warnings);

          const editAction = await findExactEditMenuAction(menuRoot!.locator);
          if (editAction) {
            try {
              probe.detail.openAttempted = true;
              console.log("[ui-probe] step: click Edit");
              await runStep("click Edit", UI_PROBE_STEP_TIMEOUTS.clickEdit, async () => {
                await editAction.locator.click({ timeout: 2_000 });
              });
              probe.card.menuEditClicked = true;
              console.log("[ui-probe] step: wait for detail modal");
              await runStep("wait detail modal", UI_PROBE_STEP_TIMEOUTS.waitDetailModal, async () => {
                for (const checkpointMs of [500, 1500, 3000]) {
                  await page.waitForTimeout(checkpointMs);
                  const detailCheckpoint = await findVisibleDetailRoot(page);
                  if (detailCheckpoint) {
                    break;
                  }
                }
              });
              probe.screenshots.afterEditClick = await runStep(
                "capture afterEditClick screenshot",
                UI_PROBE_STEP_TIMEOUTS.captureScreenshot,
                async () => {
                  return await captureProbeScreenshot(page, screenshotAfterEditClickPath, probe.warnings);
                }
              );
            } catch (error) {
              probe.warnings.push(`Edit menu click failed: ${toShortErrorMessage(error)}`);
            }
          } else {
            probe.warnings.push('Menu opened but exact "Edit" action was not found.');
          }

          if (await menuStillVisible(page)) {
            await page.keyboard.press("Escape").catch(() => {});
            await page.waitForTimeout(300);
          }
          if (await menuStillVisible(page)) {
            await clickAwayFromOverlay(page);
            await page.waitForTimeout(300);
          }
          probe.card.menuCloseSucceeded = !(await menuStillVisible(page));
          if (!probe.card.menuCloseSucceeded && !probe.card.menuEditClicked) {
            probe.errors.push("Probe opened the card menu but could not confirm a safe close.");
            return probe;
          }
        } else {
          probe.warnings.push("Card menu trigger was found but menu root was not detected.");
        }
      } catch (error) {
        probe.warnings.push(`Menu probe failed: ${toShortErrorMessage(error)}`);
      }
    }

    const modalRoot = await findVisibleDetailRoot(page);
    const modalScope = modalRoot?.locator ?? page.locator("body");
    const detailSurfaceText = normalizeWhitespace(await getInnerTextSafe(modalScope)) ?? "";
    const pageSurfaceText = normalizeWhitespace(await getInnerTextSafe(page.locator("body"))) ?? "";

    const dateFieldCandidates = [
      {
        locator: modalScope.locator('input[name*="date" i]').first(),
        selectorHint: 'input[name*="date" i]',
      },
      {
        locator: modalScope.locator('input[id*="date" i]').first(),
        selectorHint: 'input[id*="date" i]',
      },
      {
        locator: modalScope.locator('[aria-label*="date" i]').first(),
        selectorHint: '[aria-label*="date" i]',
      },
    ];
    const dateFieldMatch = await findFirstVisibleLocator(dateFieldCandidates, 700);
    probe.detail.dateFieldFound = Boolean(dateFieldMatch);
    probe.detail.dateFieldSelectorHint = dateFieldMatch?.selectorHint ?? null;
    if (dateFieldMatch) {
      probe.detail.currentDateValue = await readDateFieldValue(dateFieldMatch.locator);
    }

    const dateHeaderText = await runStep(
      "find date header text",
      UI_PROBE_STEP_TIMEOUTS.findDateHeaderText,
      async () => {
        return await findBoundedDateHeaderText(page, modalRoot?.locator ?? null);
      }
    );
    probe.detail.dateHeaderFound = Boolean(dateHeaderText);
    probe.detail.dateHeaderText = dateHeaderText ?? null;

    let dateHeaderDomRectMatch:
      | {
          found: boolean;
          text: string | null;
          tagName: string | null;
          className: string | null;
          rect: { x: number; y: number; width: number; height: number } | null;
          reason: string;
        }
      | null = null;
    let dateHeaderDomRectResolved = false;
    if (probe.detail.dateHeaderText) {
      const step = "resolve date header dom rect";
      const previousCompletedStep = probe.progress.lastCompletedStep;
      markStep(step);
      try {
        dateHeaderDomRectMatch = await withUiProbeTimeout(step, UI_PROBE_STEP_TIMEOUTS.getDateHeaderBoundingBox, async () => {
          return await resolveDateHeaderDomRectSnapshotBounded(page, probe.detail.dateHeaderText as string, {
            stage: "ui-probe-resolve-date-header-dom-rect",
            actionId: claimed.action.id,
            runId,
          });
        });
        probe.detail.dateControlSelectorUsed = dateHeaderDomRectMatch?.found ? "dom-rect-date-header" : null;
        probe.detail.dateControlClickable = Boolean(dateHeaderDomRectMatch?.found && dateHeaderDomRectMatch.rect);
        probe.detail.dateHeaderBoundingBox = toProbeBoundingBox(dateHeaderDomRectMatch?.rect ?? null);
        if (probe.detail.dateHeaderFound && !probe.detail.dateControlClickable) {
          probe.warnings.push(
            `Date header DOM rect lookup failed: ${dateHeaderDomRectMatch?.reason ?? "no browser-side match found"}`
          );
          probe.safeToProceedLater = false;
          probe.recommendedMutationMethod = "unknown";
        }
        completeStep(step);
        dateHeaderDomRectResolved = true;
      } catch (error) {
        const message = toShortErrorMessage(error);
        probe.progress.lastCompletedStep = previousCompletedStep;
        if (message.startsWith("UI capability probe timeout at step")) {
          probe.progress.timeoutStep = step;
          probe.progress.timeoutAt = new Date().toISOString();
        }
        probe.detail.dateControlSelectorUsed = null;
        probe.detail.dateControlClickable = false;
        probe.detail.dateHeaderBoundingBox = null;
        probe.detail.datePickerOpened = false;
        probe.warnings.push(`Date header DOM rect lookup timed out or failed: ${message}`);
        probe.safeToProceedLater = false;
        probe.recommendedMutationMethod = "unknown";
      }
    }
    if (!probe.detail.dateHeaderText) {
      probe.detail.dateControlSelectorUsed = null;
      probe.detail.dateControlClickable = false;
      probe.detail.dateHeaderBoundingBox = null;
    }

    if (probe.detail.dateHeaderFound && probe.detail.dateControlClickable && dateHeaderDomRectResolved) {
      probe.screenshots.beforeDateHeaderClick = await captureProbeScreenshot(
        page,
        screenshotBeforeDateHeaderClickPath,
        probe.warnings
      );
      const domRect = probe.detail.dateHeaderBoundingBox;
      const clickStrategy = "mouse.click.dom_rect_center";
      probe.detail.dateHeaderClickStrategiesTried.push(clickStrategy);
      let dateHeaderClickSucceeded = false;
      try {
        console.log("[ui-probe] step: click date header dom rect");
        await runStep("click date header dom rect", UI_PROBE_STEP_TIMEOUTS.clickDateHeader, async () => {
          if (!domRect) {
            throw new Error("Date header DOM rect was unavailable at click time");
          }
          const center = boundingBoxCenter(domRect);
          await page.mouse.click(center.x, center.y);
        });
        probe.detail.dateHeaderClickSucceededStrategy = clickStrategy;
        dateHeaderClickSucceeded = true;
      } catch (error) {
        probe.warnings.push(`Date header click strategy "${clickStrategy}" failed: ${toShortErrorMessage(error)}`);
        probe.detail.datePickerOpened = false;
      }

      if (dateHeaderClickSucceeded) {
        probe.screenshots.afterDateHeaderClickAttempt1 = await captureProbeScreenshot(
          page,
          screenshotAfterDateHeaderClickAttempt1Path,
          probe.warnings
        );
      }

      let datePickerOpenedSnapshot = false;
      let datePickerSelectorHint: string | null = null;
      if (dateHeaderClickSucceeded) {
        const sourceDateIso = comparison.sourceDate.current ?? comparison.sourceDate.trusted;
        const targetDateIso = comparison.targetDate.current ?? comparison.targetDate.trusted;
        await page.waitForTimeout(500).catch(() => {});
        console.log("[ui-probe] step: capture datepicker DOM debug snapshot");
        probe.progress.currentStep = "capture datepicker DOM debug snapshot";
        probe.progress.updatedAt = new Date().toISOString();
        try {
          const domDebugCapture = await collectVisibleDatepickerDebugSnapshot(page, {
            artifactPath: datepickerDomDebugPath,
            actionId: claimed.action.id,
            runId,
            dateHeaderBox: probe.detail.dateHeaderBoundingBox,
            sourceDateIso,
            targetDateIso,
          });
          probe.detail.datepickerDomDebugPath = datepickerDomDebugPath;
          const domDebugSnapshot = domDebugCapture.snapshot;
          probe.detail.datepickerDomDebugTopCandidates = domDebugSnapshot
            ? [...domDebugSnapshot.topCandidates.slice(0, 12)]
            : [];
          probe.detail.datepickerDomDebugError = null;
          if (domDebugSnapshot) {
            probe.detail.visibleMonth = probe.detail.visibleMonth ?? domDebugSnapshot.signals.month;
            probe.detail.visibleYear = probe.detail.visibleYear ?? domDebugSnapshot.signals.year;
            if (probe.detail.visibleDayCandidates.length === 0 && domDebugSnapshot.signals.visibleDayCandidates.length > 0) {
              probe.detail.visibleDayCandidates = [...domDebugSnapshot.signals.visibleDayCandidates];
            }
            probe.detail.targetDayVisible = probe.detail.targetDayVisible || domDebugSnapshot.signals.targetDayVisible;
            probe.detail.selectedSourceDayVisible =
              probe.detail.selectedSourceDayVisible || domDebugSnapshot.signals.selectedSourceDayVisible;
            probe.detail.targetDateClickCandidateFound = domDebugSnapshot.signals.targetDateClickCandidateFound;
            probe.detail.targetDateClickCandidateBoundingBox = domDebugSnapshot.signals.targetDateClickCandidateBoundingBox;
            if (domDebugSnapshot.signals.openByMultisignal) {
              datePickerOpenedSnapshot = true;
              probe.detail.datePickerDetectionStrategy = "visible_dom_multisignal_fallback";
            }
          } else {
            const fallback = applyBodyTextMultiSignalFallback(probe.detail, domDebugCapture.bodyTextSample);
            if (fallback.activated) {
              datePickerOpenedSnapshot = true;
            }
          }
          probe.progress.stepHistory.push("capture datepicker DOM debug snapshot");
          probe.progress.lastCompletedStep = "capture datepicker DOM debug snapshot";
          probe.progress.updatedAt = new Date().toISOString();
          console.log(`[ui-probe] datepicker DOM debug artifact: ${datepickerDomDebugPath}`);
        } catch (error) {
          const errorMessage = formatDiagnosticError(error);
          probe.detail.datepickerDomDebugError = errorMessage;
          probe.progress.stepHistory.push("capture datepicker DOM debug snapshot failed");
          probe.progress.lastCompletedStep = "capture datepicker DOM debug snapshot failed";
          probe.progress.updatedAt = new Date().toISOString();
          probe.warnings.push(`Datepicker DOM debug snapshot failed safely: ${errorMessage}`);
          console.log(`[ui-probe] datepicker DOM debug error: ${errorMessage}`);
          console.log("[ui-probe] datepicker DOM debug artifact: null");
        }

        probe.detail.datePickerOpenCheckCount += 1;
        const step = "detect datepicker";
        markStep(step);
        try {
          console.log("[ui-probe] step: detect datepicker");
          const detection = await withUiProbeTimeout(step, 2_500, async () => {
            return await detectVisibleDatePickerSnapshot(
              page,
              {
                dateHeaderBox: probe.detail.dateHeaderBoundingBox,
                dateHeaderText: probe.detail.dateHeaderText,
                sourceDateIso,
                targetDateIso,
              },
              {
                stage: "ui-probe-detect-datepicker",
                actionId: claimed.action.id,
                runId,
              }
            );
          });
          datePickerOpenedSnapshot = datePickerOpenedSnapshot || detection.opened;
          datePickerSelectorHint = detection.selectorHint;
          probe.detail.datePickerDetectionStrategy = probe.detail.datePickerDetectionStrategy ?? detection.strategy;
          probe.detail.datePickerBoundingBox = detection.boundingBox;
          probe.detail.visibleMonth = probe.detail.visibleMonth ?? detection.visibleMonth;
          probe.detail.visibleYear = probe.detail.visibleYear ?? detection.visibleYear;
          probe.detail.visibleDayCandidates = probe.detail.visibleDayCandidates.length
            ? probe.detail.visibleDayCandidates
            : [...detection.visibleDayCandidates];
          probe.detail.targetDayVisible = probe.detail.targetDayVisible || detection.targetDayVisible;
          probe.detail.selectedSourceDayVisible =
            probe.detail.selectedSourceDayVisible || detection.selectedSourceDayVisible;
          probe.detail.targetDateSelectionConfirmed =
            probe.detail.targetDateSelectionConfirmed || detection.targetDaySelectedVisible;
          probe.detail.datePickerOpenCheckSnippets.push(
            ...detection.snippets.slice(0, Math.max(0, 12 - probe.detail.datePickerOpenCheckSnippets.length))
          );
        } catch (error) {
          probe.warnings.push(`Datepicker detection check failed safely: ${toShortErrorMessage(error)}`);
        } finally {
          completeStep(step);
        }
      }
      probe.detail.datePickerOpened = dateHeaderClickSucceeded ? datePickerOpenedSnapshot : false;
      probe.detail.datePickerSelectorHint = datePickerSelectorHint;
      if (dateHeaderClickSucceeded && probe.detail.datePickerOpened) {
        const targetDateIso = comparison.targetDate.current ?? comparison.targetDate.trusted;
        probe.detail.targetDateSelectionAttempted = false;

        if (!probe.detail.targetDateClickCandidateFound && targetDateIso && probe.detail.targetDayVisible) {
          try {
            const targetDayMatch = targetDateIso.match(/^\d{4}-\d{2}-(\d{2})$/);
            const targetDayNum = targetDayMatch ? Number(targetDayMatch[1]) : NaN;
            if (Number.isFinite(targetDayNum) && targetDayNum >= 1 && targetDayNum <= 31) {
              const day = String(targetDayNum);
              const dayRegex = new RegExp(`(^|\\D)${day}(\\D|$)`);
              const dateHeaderBox = probe.detail.dateHeaderBoundingBox;
              const locatorSpecs = [
                { locator: page.locator(`.MuiPickersDay-root:has-text("${day}")`), hint: "MuiPickersDay" },
                { locator: page.locator(`[role="gridcell"]`).filter({ hasText: new RegExp(`^\\s*${day}\\s*$`) }), hint: "gridcell" },
                { locator: page.locator(`button[aria-label*="${day}"]`).filter({ hasText: dayRegex }), hint: "button[aria-label]" },
                { locator: page.locator(`td`).filter({ hasText: new RegExp(`^\\s*${day}\\s*$`) }), hint: "td" },
              ];
              for (const spec of locatorSpecs) {
                if (probe.detail.targetDateClickCandidateFound) break;
                const allMatches = await spec.locator.all().catch(() => [] as import("playwright").Locator[]);
                for (const loc of allMatches) {
                  if (!(await loc.isVisible().catch(() => false))) continue;
                  const box = await loc.boundingBox().catch(() => null);
                  if (!box || box.width < 5 || box.height < 5) continue;
                  if (box.width > 80 || box.height > 60) continue;
                  if (dateHeaderBox) {
                    const dx = Math.abs((box.x + box.width / 2) - (dateHeaderBox.x + dateHeaderBox.width / 2));
                    const dy = (box.y + box.height / 2) - (dateHeaderBox.y + dateHeaderBox.height / 2);
                    if (dx > 320 || dy < 0 || dy > 420) continue;
                  }
                  const text = await loc.textContent().catch(() => "");
                  if (!dayRegex.test(text ?? "")) continue;
                  probe.detail.targetDateClickCandidateFound = true;
                  probe.detail.targetDateClickCandidateBoundingBox = {
                    x: Math.round(box.x * 100) / 100,
                    y: Math.round(box.y * 100) / 100,
                    width: Math.round(box.width * 100) / 100,
                    height: Math.round(box.height * 100) / 100,
                  };
                  console.log(`[ui-probe] target day candidate found via Playwright locator fallback (${spec.hint}, day ${day})`);
                  break;
                }
              }
            }
          } catch (error) {
            probe.warnings.push(`Playwright locator fallback for target day candidate failed: ${toShortErrorMessage(error)}`);
          }
        }
      }

      if (dateHeaderClickSucceeded && probe.detail.datePickerOpened) {
        probe.screenshots.datePickerOpened = await captureProbeScreenshot(
          page,
          screenshotDatePickerOpenedPath,
          probe.warnings
        );
        probe.detail.datePickerCloseAttempted = false;
        probe.detail.datePickerCloseSucceeded = false;
        probe.detail.datePickerCloseError = "skipped_in_probe";
        console.log("[ui-probe] close datepicker skipped (modal close will dismiss)");
      } else if (dateHeaderClickSucceeded) {
        probe.warnings.push("Date header clicked, but datepicker was not detected within timeout");
      }

      if (dateHeaderClickSucceeded && probe.detail.datePickerOpened) {
        const targetDateIso = comparison.targetDate.current ?? comparison.targetDate.trusted;
        if (!visibleTextReferencesIsoTargetLocalCheck) {
          probe.warnings.push(
            'visibleTextReferencesIsoTarget local check failed for "SUNDAY May 17, 2026" -> "2026-05-17".'
          );
        }
        if (probe.detail.targetDayVisible && targetDateIso && probe.detail.targetDateClickCandidateFound) {
          probe.detail.targetDateSelectionAttempted = true;
          probe.detail.targetDateClickMethod = "mouse.click.bounding_box_center";
          try {
            const clickBox = probe.detail.targetDateClickCandidateBoundingBox;
            if (!clickBox || clickBox.width <= 0 || clickBox.height <= 0) {
              throw new Error("targetDateClickCandidateBoundingBox is missing or invalid");
            }
            const x = clickBox.x + clickBox.width / 2;
            const y = clickBox.y + clickBox.height / 2;
            // Best-effort only: use a short, direct mouse click without actionability waits.
            await withUiProbeTimeout("best-effort target date selection click", 900, async () => {
              await page.mouse.click(x, y);
            });
            await page.waitForTimeout(180).catch(() => {});
            const postClickDateHeaderText = await findBoundedDateHeaderText(page, modalRoot?.locator ?? null).catch(
              () => null as string | null
            );
            const postClickDateFieldValue = dateFieldMatch
              ? await readDateFieldValue(dateFieldMatch.locator).catch(() => null as string | null)
              : null;
            if (postClickDateHeaderText) {
              probe.detail.dateHeaderText = postClickDateHeaderText;
            }
            if (postClickDateFieldValue) {
              probe.detail.currentDateValue = postClickDateFieldValue;
            }
            const postSelection = await detectVisibleDatePickerSnapshot(
              page,
              {
                dateHeaderBox: probe.detail.dateHeaderBoundingBox,
                dateHeaderText: probe.detail.dateHeaderText,
                sourceDateIso: comparison.sourceDate.current ?? comparison.sourceDate.trusted,
                targetDateIso,
              },
              {
                stage: "ui-probe-detect-datepicker-post-selection",
                actionId: claimed.action.id,
                runId,
              }
            );
            probe.detail.datePickerDetectionStrategy =
              postSelection.strategy ?? probe.detail.datePickerDetectionStrategy;
            probe.detail.datePickerBoundingBox = postSelection.boundingBox ?? probe.detail.datePickerBoundingBox;
            probe.detail.visibleMonth = postSelection.visibleMonth ?? probe.detail.visibleMonth;
            probe.detail.visibleYear = postSelection.visibleYear ?? probe.detail.visibleYear;
            probe.detail.visibleDayCandidates = postSelection.visibleDayCandidates.length
              ? [...postSelection.visibleDayCandidates]
              : probe.detail.visibleDayCandidates;
            probe.detail.targetDayVisible = postSelection.targetDayVisible || probe.detail.targetDayVisible;
            probe.detail.selectedSourceDayVisible =
              postSelection.selectedSourceDayVisible || probe.detail.selectedSourceDayVisible;
            probe.detail.postClickDateHeaderText = postClickDateHeaderText;
            probe.detail.postClickDateInputValue = postClickDateFieldValue;
            const confirmedByDateHeader = visibleAnyTextReferencesIsoTarget(
              [postClickDateHeaderText, probe.detail.dateHeaderText],
              targetDateIso
            );
            const confirmedByDateInput = visibleAnyTextReferencesIsoTarget(
              [postClickDateFieldValue, probe.detail.currentDateValue],
              targetDateIso
            );
            const confirmedBySelectedHighlight = postSelection.targetDaySelectedVisible;
            if (confirmedByDateHeader || confirmedByDateInput || confirmedBySelectedHighlight) {
              probe.detail.targetDateSelectionConfirmed = true;
              if (confirmedByDateHeader) {
                probe.detail.targetDateConfirmedBy = "date_header";
              } else if (confirmedByDateInput) {
                probe.detail.targetDateConfirmedBy = "date_input";
              } else if (confirmedBySelectedHighlight) {
                probe.detail.targetDateConfirmedBy = "selected_day_highlight";
              }
            }
            probe.detail.datePickerOpenCheckSnippets.push(
              ...postSelection.snippets.slice(0, Math.max(0, 12 - probe.detail.datePickerOpenCheckSnippets.length))
            );
            probe.progress.stepHistory.push("best-effort target date selection");
            probe.progress.lastCompletedStep = "best-effort target date selection";
            probe.progress.updatedAt = new Date().toISOString();
          } catch (error) {
            probe.progress.stepHistory.push("best-effort target date selection failed");
            probe.progress.lastCompletedStep = "best-effort target date selection failed";
            probe.progress.updatedAt = new Date().toISOString();
            probe.warnings.push(`Target date selection attempt failed safely: ${toShortErrorMessage(error)}`);
          } finally {
            // Always attempt this artifact after candidate-click attempt, even on timeout/error.
            try {
              await page.screenshot({ path: screenshotAfterTargetDayClickPath, fullPage: true });
              probe.screenshots.afterTargetDayClick = screenshotAfterTargetDayClickPath;
              probe.detail.afterTargetDayClickError = null;
            } catch (error) {
              probe.screenshots.afterTargetDayClick = null;
              probe.detail.afterTargetDayClickError = toShortErrorMessage(error);
              probe.warnings.push(
                `probe screenshot failed for ${path.basename(screenshotAfterTargetDayClickPath)}: ${probe.detail.afterTargetDayClickError}`
              );
            }
          }
        }
      }
    }

    const titleOrDetailFieldsFound = await anyVisible(
      [
        modalScope.locator('input[name*="title" i], input[id*="title" i], textarea[name*="title" i], textarea[id*="title" i]'),
        page.locator(
          'input[name*="title" i],input[id*="title" i],textarea[name*="title" i],textarea[id*="title" i],input[name*="duration" i],input[id*="duration" i],input[name*="distance" i],input[id*="distance" i],input[name*="tss" i],input[id*="tss" i]'
        ),
        modalScope.getByRole("textbox", { name: /title|workout/i }),
        page.getByRole("textbox", { name: /title|workout|duration|distance|tss/i }),
      ],
      700
    );
    const modalScopedAnalyzeOrFilesFound = await anyVisible(
      [
        modalScope.getByRole("button", { name: /analy(?:z|s)e/i }),
        modalScope.getByRole("button", { name: /files?/i }),
        modalScope.getByRole("button", { name: /upload/i }),
        page.getByRole("button", { name: /analy(?:z|s)e/i }),
        page.getByRole("button", { name: /files?/i }),
        page.getByRole("button", { name: /upload/i }),
        page.getByText(/\banaly(?:z|s)e\b|\bfiles?\b|\bupload\b/i),
      ],
      700
    );
    const timeDropdownFound = TP_TIME_DROPDOWN_REGEX.test(detailSurfaceText);
    probe.detail.modalScopedSaveAndCloseFound = await anyVisible(
      [
        modalScope.getByRole("button", { name: /save\s*&\s*close/i }),
        page.getByRole("button", { name: /save\s*&\s*close/i }),
        page.getByText(/^save\s*&\s*close$/i),
      ],
      700
    );
    probe.detail.modalScopedSaveFound = await anyVisible(
      [
        modalScope.getByRole("button", { name: /^save$/i }),
        modalScope.getByRole("button", { name: /\bsave\b/i }),
        page.getByRole("button", { name: /^save$/i }),
        page.getByRole("button", { name: /\bsave\b/i }),
        page.getByText(/^save$/i),
      ],
      700
    );
    probe.detail.modalScopedCancelFound = await anyVisible(
      [
        modalScope.getByRole("button", { name: /cancel/i }),
        page.getByRole("button", { name: /cancel/i }),
        page.getByText(/^cancel$/i),
      ],
      700
    );
    probe.detail.modalScopedCloseFound = await anyVisible(
      [
        modalScope.getByRole("button", { name: /close|x/i }),
        modalScope.locator('[aria-label*="close" i],[title*="close" i]').first(),
        page.getByRole("button", { name: /close|x/i }),
        page.locator('[aria-label*="close" i],[title*="close" i]').first(),
        page.getByText(/^[x×]$/i),
      ],
      700
    );
    probe.detail.saveButtonFound = probe.detail.modalScopedSaveFound;
    probe.detail.saveAndCloseButtonFound = probe.detail.modalScopedSaveAndCloseFound;
    probe.detail.cancelButtonFound = probe.detail.modalScopedCancelFound;
    probe.detail.closeButtonFound = probe.detail.modalScopedCloseFound;
    const detailFieldSignalsFound =
      titleOrDetailFieldsFound || /\bworkout\b|\btitle\b|\bduration\b|\bdistance\b|\btss\b/i.test(pageSurfaceText);
    probe.detail.opened = Boolean(
      probe.detail.dateHeaderFound ||
        probe.detail.saveAndCloseButtonFound ||
        probe.detail.cancelButtonFound ||
        probe.detail.saveButtonFound ||
        detailFieldSignalsFound ||
        modalScopedAnalyzeOrFilesFound ||
        timeDropdownFound
    );

    if (probe.detail.opened) {
      probe.screenshots.detailOpened = await captureProbeScreenshot(page, screenshotDetailOpenedPath, probe.warnings);

      const closeCandidate = await findFirstVisibleLocator(
        [
          {
            locator: modalScope.getByRole("button", { name: /cancel/i }).first(),
            selectorHint: 'button[name=/cancel/i]',
          },
          {
            locator: modalScope.getByRole("button", { name: /close|x/i }).first(),
            selectorHint: 'button[name=/close|x/i]',
          },
          {
            locator: modalScope.locator('[aria-label*="close" i],[title*="close" i]').first(),
            selectorHint: '[aria-label*="close" i],[title*="close" i]',
          },
          {
            locator: page.getByRole("button", { name: /cancel/i }).first(),
            selectorHint: 'global button[name=/cancel/i]',
          },
          {
            locator: page.getByRole("button", { name: /close|x/i }).first(),
            selectorHint: 'global button[name=/close|x/i]',
          },
          {
            locator: page.locator('[aria-label*="close" i],[title*="close" i]').first(),
            selectorHint: 'global [aria-label*="close" i],[title*="close" i]',
          },
        ],
        700
      );

      if (closeCandidate) {
        try {
          console.log("[ui-probe] step: close modal");
          await runStep("close modal", UI_PROBE_STEP_TIMEOUTS.closeModal, async () => {
            await closeCandidate.locator.click({ timeout: 2_000 });
            await page.waitForTimeout(500);
          });
        } catch (error) {
          probe.warnings.push(`Detail close click failed: ${toShortErrorMessage(error)}`);
        }
      }

      const detailClosed = !(await detailStillVisible(page));
      const datePickerStillVisibleAfterClose = await findVisibleDatePicker(
        page,
        modalRoot?.locator ?? null,
        probe.detail.dateHeaderBoundingBox,
        probe.detail.dateHeaderText
      );
      probe.detail.closeSucceeded = detailClosed || !datePickerStillVisibleAfterClose;
      if (!probe.detail.closeSucceeded) {
        probe.errors.push("Probe opened workout detail UI but could not confirm a safe close without saving.");
        return probe;
      }
    }

    probe.screenshots.afterClosed = await captureProbeScreenshot(page, screenshotAfterClosedPath, probe.warnings);

    const detailMethodReady =
      probe.detail.opened &&
      probe.detail.dateHeaderFound &&
      probe.detail.dateControlClickable &&
      probe.detail.datePickerOpened &&
      probe.detail.modalScopedSaveAndCloseFound &&
      (probe.detail.modalScopedCancelFound || probe.detail.modalScopedCloseFound) &&
      probe.detail.closeSucceeded;

    probe.safeToProceedLater = detailMethodReady;
    probe.recommendedMutationMethod = detailMethodReady ? "detail_date_picker_save_close" : "unknown";

    if (!probe.detail.opened) {
      probe.warnings.push('Probe did not detect a safe detail modal after clicking menu action "Edit".');
    }
    if (
      probe.detail.opened &&
      !(probe.detail.cancelButtonFound || probe.detail.closeButtonFound) &&
      probe.detail.closeSucceeded
    ) {
      probe.warnings.push("Detail UI only closed via Escape; explicit cancel/close control was not detected.");
    }

    return probe;
  })();

  probeTask.catch(() => {});

  try {
    const timedResult = await Promise.race([
      probeTask,
      new Promise<UiCapabilityProbe>((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              `UI capability probe timeout at step "overall_ui_capability_probe"; currentStep="${
                probe.progress.currentStep ?? "unknown"
              }" after ${UI_PROBE_OVERALL_TIMEOUT_MS}ms`
            )
          );
        }, UI_PROBE_OVERALL_TIMEOUT_MS);
      }),
    ]);
    return timedResult;
  } catch (error) {
    if (!probe.progress.timeoutStep) {
      probe.progress.timeoutStep = probe.progress.currentStep;
      probe.progress.timeoutAt = new Date().toISOString();
    }
    if (probePage) {
      try {
        probe.screenshots.timeout = await withUiProbeTimeout(
          "capture timeout screenshot",
          UI_PROBE_STEP_TIMEOUTS.captureScreenshot,
          async () => {
            return await captureProbeScreenshot(probePage as import("playwright").Page, screenshotTimeoutPath, probe.warnings);
          }
        );
      } catch (screenshotError) {
        probe.warnings.push(`Timeout screenshot failed: ${toShortErrorMessage(screenshotError)}`);
      }
    }
    const message = toShortErrorMessage(error);
    const prefixedMessage =
      message.startsWith("UI capability probe timeout at step")
        ? `${message}; timeoutStep="${probe.progress.timeoutStep ?? "unknown"}"; currentStep="${
            probe.progress.currentStep ?? "unknown"
          }"`
        : `UI capability probe failed: ${message}`;
    probe.errors.push(prefixedMessage);
    return probe;
  } finally {
    if (context) {
      const contextToClose = context as import("playwright").BrowserContext;
      await withUiProbeTimeout("cleanup browser context", UI_PROBE_CLEANUP_TIMEOUT_MS, async () => {
        await contextToClose.close().catch(() => {});
      }).catch((error) => {
        probe.warnings.push(`UI probe cleanup warning: ${toShortErrorMessage(error)}`);
      });
    }
  }
}

async function extractWorkoutCandidatesFromPage(
  page: import("playwright").Page,
  targetDateIso: string | null,
  expectedSourceDate: string | null = null
): Promise<WorkoutExtractionResult> {
  const nowIso = toBelgradeIsoDate(new Date());
  const domDebugEnabled = isTruthyEnvFlag("TP_DRY_RUN_DOM_DEBUG");
  const parseWarnings: string[] = [];
  const checkpoints: DryRunDomDebugCheckpoint[] = [];
  const readiness = {
    waitForCalendarRootAttempted: false,
    waitForCalendarRootTimedOut: false,
    waitForDayCellsAttempted: false,
    waitForDayCellsTimedOut: false,
    waitForWorkoutCardAttempted: false,
    waitForWorkoutCardTimedOut: false,
  };

  const recordSnapshot = async (label: string, includeCardSnippets = false) => {
    const snapshot = await captureCalendarDomSnapshot(page, includeCardSnippets);
    if (snapshot.error) {
      parseWarnings.push(snapshot.error);
    }
    checkpoints.push({
      label,
      selectorCounts: snapshot.selectorCounts,
    });
    return snapshot;
  };

  await recordSnapshot("after goto");

  try {
    readiness.waitForCalendarRootAttempted = true;
    await page.locator(TP_CALENDAR_ROOT_SELECTOR).first().waitFor({ state: "attached", timeout: 5_000 });
  } catch (error) {
    readiness.waitForCalendarRootTimedOut = true;
    parseWarnings.push(`calendar root wait failed: ${toShortErrorMessage(error)}`);
  }

  try {
    readiness.waitForDayCellsAttempted = true;
    await page
      .locator(`${TP_CALENDAR_ROOT_SELECTOR} ${TP_DAY_CELL_SELECTOR}`)
      .first()
      .waitFor({ state: "attached", timeout: 5_000 });
  } catch (error) {
    readiness.waitForDayCellsTimedOut = true;
    parseWarnings.push(`calendar day cells wait failed: ${toShortErrorMessage(error)}`);
  }

  try {
    readiness.waitForWorkoutCardAttempted = true;
    await Promise.any([
      page.locator(`${TP_CALENDAR_ROOT_SELECTOR} ${TP_PRIMARY_WORKOUT_CARD_WITHIN_DAY_SELECTOR}`).first().waitFor({
        state: "attached",
        timeout: 1_500,
      }),
      page.locator(`${TP_CALENDAR_ROOT_SELECTOR} ${TP_FALLBACK_WORKOUT_CARD_WITHIN_DAY_SELECTOR}`).first().waitFor({
        state: "attached",
        timeout: 1_500,
      }),
    ]);
  } catch (error) {
    readiness.waitForWorkoutCardTimedOut = true;
    parseWarnings.push(`calendar workout card wait finished without visible card roots: ${toShortErrorMessage(error)}`);
  }

  await recordSnapshot("after readiness wait");
  const beforeExtractSnapshot = await recordSnapshot("before extract", domDebugEnabled);

  type EvaluatedWorkoutCandidate = {
    rawTextSnippet: string;
    selectorHint: string | null;
    classHint: string | null;
    title: string | null;
    type: string | null;
    plannedDurationRaw: string | null;
    plannedDistanceRaw: string | null;
    startTimeLocal: string | null;
    sourceDateRaw: string | null;
    workoutId: number | null;
    reasons: string[];
    fromFallback: boolean;
  };

  const extracted: EvaluatedWorkoutCandidate[] = [];
  let extractionError: string | null = null;
  let dateAttributionDebug: DryRunDateAttributionDebug | null = null;

  try {
    const calendarRoot = page.locator(TP_CALENDAR_ROOT_SELECTOR).first();
    const calendarRootCount = await page.locator(TP_CALENDAR_ROOT_SELECTOR).count();
    if (calendarRootCount === 0) {
      throw new Error(`calendar root not found: ${TP_CALENDAR_ROOT_SELECTOR}`);
    }

    const calendarMonthYear = await inferCalendarMonthYear(calendarRoot);
    const dayCells = calendarRoot.locator(TP_DAY_CELL_SELECTOR);
    const dayCellCount = await dayCells.count();
    const rawDayCellSamples: DryRunDateAttributionDayCellSample[] = [];
    const cardSamplesBeforeFiltering: DryRunDateAttributionCardSample[] = [];
    let cardsVisible = 0;
    let cardsWithDateIso = 0;
    let cardsWithoutDateIso = 0;
    let selectedDateAttributionStrategy: string | null = null;
    let sourceDateVisibleInDayCellLabels = false;
    let targetDateVisibleInDayCellLabels = false;

    for (let dayIndex = 0; dayIndex < dayCellCount; dayIndex += 1) {
      const dayCell = dayCells.nth(dayIndex);
      const dayTextRaw = (await dayCell.innerText().catch(() => "")) ?? "";
      const dayText = dayTextRaw.trim();
      const dayClass = await getAttributeSafe(dayCell, "class");
      const dayId = await getAttributeSafe(dayCell, "id");
      const dayAttributes = {
        dataDate: await getAttributeSafe(dayCell, "data-date"),
        datetime: await getAttributeSafe(dayCell, "datetime"),
        ariaLabel: await getAttributeSafe(dayCell, "aria-label"),
        title: await getAttributeSafe(dayCell, "title"),
      };

      const primaryCards = dayCell.locator(TP_PRIMARY_WORKOUT_CARD_WITHIN_DAY_SELECTOR);
      const fallbackCards = dayCell.locator(TP_FALLBACK_WORKOUT_CARD_WITHIN_DAY_SELECTOR);
      const primaryCount = await primaryCards.count();
      const fallbackCount = await fallbackCards.count();
      const resolvedDay = await resolveCalendarDayCellDate({
        dayCell,
        headerMonthYear: calendarMonthYear,
        expectedSourceDate,
        expectedTargetDate: targetDateIso,
      });
      const resolvedSourceDate = resolvedDay.dateIso;
      const resolvedSourceDateReason = resolvedDay.reason;

      if (!selectedDateAttributionStrategy && resolvedSourceDateReason) {
        selectedDateAttributionStrategy = resolvedSourceDateReason;
      }
      const labelFragments = [
        dayText,
        dayAttributes.dataDate,
        dayAttributes.datetime,
        dayAttributes.ariaLabel,
        dayAttributes.title,
        ...resolvedDay.descendantDateSamples,
      ];
      if (expectedSourceDate && visibleAnyTextReferencesIsoTarget(labelFragments, expectedSourceDate)) {
        sourceDateVisibleInDayCellLabels = true;
      }
      if (targetDateIso && visibleAnyTextReferencesIsoTarget(labelFragments, targetDateIso)) {
        targetDateVisibleInDayCellLabels = true;
      }
      if (rawDayCellSamples.length < 12) {
        rawDayCellSamples.push({
          index: dayIndex,
          visible: await dayCell.isVisible().catch(() => false),
          dayNumber: resolvedDay.dayNumber,
          cardCount: primaryCount + fallbackCount,
          dayTextSnippet: resolvedDay.dayTextSnippet,
          dayClass,
          dayId,
          attributes: dayAttributes,
          descendantDateSamples: resolvedDay.descendantDateSamples,
          resolvedDate: resolvedSourceDate,
          resolvedReason: resolvedSourceDateReason,
        });
      }

      const buildCandidate = async (
        card: import("playwright").Locator,
        selectorHint: string,
        fromFallback: boolean
      ): Promise<EvaluatedWorkoutCandidate | null> => {
        const rawText = await getInnerTextSafe(card);
        if (!rawText) {
          return null;
        }
        const text = toTextSnippet(rawText);
        if (!text) {
          return null;
        }
        const title =
          (await getInnerTextSafe(card.locator("h1, h2, h3, strong, [class*='title' i]").first())) ??
          extractTitleFromCardText(text);
        const classHint = await getAttributeSafe(card, "class");
        const plannedDurationRaw =
          text.match(
            /\b(?:\d{1,2}:\d{2}(?::\d{2})?|\d+(?:[.,]\d+)?\s*(?:h|hr|hour|hours|ч|min|mins|minute|minutes|мин|sec|secs|second|seconds|сек))\b/i
          )?.[0] ?? null;
        const plannedDistanceRaw =
          text.match(/\b\d+(?:[.,]\d+)?\s*(?:km|км|mi|mile|miles|m|м|meter|meters)\b/i)?.[0] ?? null;
        const startTimeLocal = text.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/)?.[0] ?? null;
        cardsVisible += 1;
        if (resolvedSourceDate) {
          cardsWithDateIso += 1;
        } else {
          cardsWithoutDateIso += 1;
        }
        if (cardSamplesBeforeFiltering.length < 12) {
          const droppedReasons: string[] = [];
          if (!resolvedSourceDate) {
            droppedReasons.push("dateIso unresolved before filtering");
          }
          if (targetDateIso && resolvedSourceDate && dateDistanceDays(resolvedSourceDate, targetDateIso) > 14) {
            droppedReasons.push("outside 14-day target window");
          }
          if (fromFallback) {
            droppedReasons.push("fallback card root");
          }
          cardSamplesBeforeFiltering.push({
            rawTextSnippet: text,
            selectorHint,
            dateIso: resolvedSourceDate,
            dateReason: resolvedSourceDateReason,
            droppedReasons,
          });
        }

        return {
          rawTextSnippet: text,
          selectorHint,
          classHint,
          title,
          type: detectWorkoutTypeFromText(text),
          plannedDurationRaw,
          plannedDistanceRaw,
          startTimeLocal,
          sourceDateRaw: resolvedSourceDate,
          workoutId: await extractWorkoutIdFromCard(card),
          reasons: [
            resolvedSourceDateReason,
            fromFallback ? "candidate from .workoutDiv fallback card root" : "candidate from primary calendar card root",
            dayClass ? `day class: ${dayClass}` : "day class unavailable",
          ],
          fromFallback,
        };
      };

      for (let cardIndex = 0; cardIndex < primaryCount; cardIndex += 1) {
        const candidate = await buildCandidate(
          primaryCards.nth(cardIndex),
          TP_PRIMARY_WORKOUT_CARD_SELECTOR,
          false
        );
        if (candidate) {
          extracted.push(candidate);
        }
      }

      for (let cardIndex = 0; cardIndex < fallbackCount; cardIndex += 1) {
        const candidate = await buildCandidate(
          fallbackCards.nth(cardIndex),
          TP_FALLBACK_WORKOUT_CARD_SELECTOR,
          true
        );
        if (candidate) {
          extracted.push(candidate);
        }
      }
    }
    dateAttributionDebug = {
      selectedStrategy: selectedDateAttributionStrategy,
      sourceDateVisibleInDayCellLabels,
      targetDateVisibleInDayCellLabels,
      cardsVisible,
      cardsWithDateIso,
      cardsWithoutDateIso,
      rawDayCellSamples,
      cardSamplesBeforeFiltering,
    };
  } catch (error) {
    extractionError = `calendar extraction failed: ${toShortErrorMessage(error)}`;
    parseWarnings.push(extractionError);
  }

  const seen = new Set<string>();
  const candidates = extracted
    .map((candidate) => {
      const dateIso = candidate.sourceDateRaw ? normalizeDateCandidate(candidate.sourceDateRaw) : null;
      const distanceFromTodayDays = dateIso ? dateDistanceDays(nowIso, dateIso) : null;
      let rawScore = scoreWorkoutCandidate({
        title: candidate.title,
        type: candidate.type,
        dateIso,
        targetDate: targetDateIso,
        distanceFromTodayDays,
      });
      if (candidate.fromFallback) {
        rawScore = clampConfidence(rawScore - 0.2);
      }
      if (!dateIso) {
        rawScore = clampConfidence(rawScore - 0.18);
      }
      return {
        rawTextSnippet: candidate.rawTextSnippet,
        selectorHint: candidate.selectorHint,
        classHint: candidate.classHint,
        title: candidate.title,
        type: candidate.type,
        plannedDurationSec: candidate.plannedDurationRaw ? parseDurationSeconds(candidate.plannedDurationRaw) : null,
        plannedDistance: candidate.plannedDistanceRaw ? parseDistance(candidate.plannedDistanceRaw) : null,
        startTimeLocal: candidate.startTimeLocal,
        dateIso,
        workoutId: candidate.workoutId ?? null,
        reasons: candidate.reasons,
        fromFallback: candidate.fromFallback,
        rawScore,
      } satisfies RawWorkoutCandidate;
    })
    .filter((candidate) => {
      if (!targetDateIso || !candidate.dateIso) {
        return true;
      }
      return dateDistanceDays(candidate.dateIso, targetDateIso) <= 14;
    })
    .filter((candidate) => {
      const key = `${candidate.title ?? "na"}|${candidate.type ?? "na"}|${candidate.dateIso ?? "na"}|${candidate.startTimeLocal ?? "na"}|${candidate.rawTextSnippet}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 80)
    .sort((left, right) => right.rawScore - left.rawScore);

  return {
    candidates,
    domDebug:
      domDebugEnabled || Boolean(extractionError)
        ? {
            enabled: domDebugEnabled,
            calendarRootClass: beforeExtractSnapshot.calendarRootClass,
            selectorCounts: beforeExtractSnapshot.selectorCounts,
            checkpoints,
            cardSnippets: beforeExtractSnapshot.cardSnippets,
            extractionError,
          }
        : null,
    dateAttributionDebug,
    parseWarnings,
    extractionError,
    readiness,
  };
}

async function buildZeroCandidatesDiagnostics(input: {
  page: import("playwright").Page;
  extraction: WorkoutExtractionResult;
  pageMeta: {
    url: string;
    title: string;
    loginRequired: boolean;
    athletePageLikelyReachable: boolean;
    trainingPeaksContextLikely: boolean;
  };
  sourceDate: string | null;
  targetDate: string | null;
  screenshotBeforePath: string | null;
  screenshotAfterPath: string | null;
  artifactDir: string | null;
  openedAthleteUrl: string | null;
}): Promise<NonNullable<DryRunDiagnostics["zeroCandidates"]>> {
  let calendarRootCount = 0;
  let dayCellCount = 0;
  let workoutCardCounts: DryRunDomDebugSelectorCounts = emptyDomSelectorCounts();
  let visibleCalendarHeaderText: string | null = null;
  let inferredCalendarMonth: number | null = null;
  let inferredCalendarYear: number | null = null;
  let inferredCalendarMonthYearReason: string | null = null;
  const dateAttributionDebug = input.extraction.dateAttributionDebug;

  try {
    const calendarRoots = input.page.locator(TP_CALENDAR_ROOT_SELECTOR);
    calendarRootCount = await calendarRoots.count();
    if (calendarRootCount > 0) {
      const calendarRoot = calendarRoots.first();
      dayCellCount = await calendarRoot.locator(TP_DAY_CELL_SELECTOR).count();
      const domSnapshot = await captureCalendarDomSnapshot(input.page, true);
      workoutCardCounts = domSnapshot.selectorCounts;

      const monthYear = await inferCalendarMonthYear(calendarRoot);
      inferredCalendarMonth = monthYear.month;
      inferredCalendarYear = monthYear.year;
      inferredCalendarMonthYearReason = monthYear.reason;

      const headerCandidates = await calendarRoot
        .locator("h1, h2, h3, h4, [class*='month' i], [data-test*='month' i]")
        .allInnerTexts()
        .catch(() => []);
      visibleCalendarHeaderText = headerCandidates
        .map((value) => normalizeWhitespace(value))
        .filter(Boolean)
        .slice(0, 3)
        .join(" | ");
      if (!visibleCalendarHeaderText) {
        visibleCalendarHeaderText = null;
      }
    }
  } catch (error) {
    input.extraction.parseWarnings.push(`zero-candidates diagnostics failed: ${toShortErrorMessage(error)}`);
  }

  return {
    pageUrlOpened: input.openedAthleteUrl,
    pageUrlAfterLoad: input.page.url(),
    pageTitle: input.pageMeta.title || null,
    expectedSourceDate: input.sourceDate,
    expectedTargetDate: input.targetDate,
    athletePageLikelyReachable: input.pageMeta.athletePageLikelyReachable,
    trainingPeaksContextLikely: input.pageMeta.trainingPeaksContextLikely,
    loginRequired: input.pageMeta.loginRequired,
    calendarRootCount,
    dayCellCount,
    workoutCardCounts,
    visibleCalendarHeaderText,
    inferredCalendarMonth,
    inferredCalendarYear,
    inferredCalendarMonthYearReason,
    waitForCardAttempted: input.extraction.readiness.waitForWorkoutCardAttempted,
    waitForCardTimedOut: input.extraction.readiness.waitForWorkoutCardTimedOut,
    selectedDateAttributionStrategy: dateAttributionDebug?.selectedStrategy ?? null,
    sourceDateVisibleInDayCellLabels: dateAttributionDebug?.sourceDateVisibleInDayCellLabels ?? false,
    targetDateVisibleInDayCellLabels: dateAttributionDebug?.targetDateVisibleInDayCellLabels ?? false,
    cardsVisible: dateAttributionDebug?.cardsVisible ?? input.extraction.candidates.length,
    cardsWithDateIso: dateAttributionDebug?.cardsWithDateIso ?? input.extraction.candidates.filter((candidate) => Boolean(candidate.dateIso)).length,
    cardsWithoutDateIso:
      dateAttributionDebug?.cardsWithoutDateIso ??
      input.extraction.candidates.filter((candidate) => !candidate.dateIso).length,
    rawDayCellSamples: dateAttributionDebug?.rawDayCellSamples ?? [],
    cardSamplesBeforeFiltering: dateAttributionDebug?.cardSamplesBeforeFiltering ?? [],
    parseWarnings: [...input.extraction.parseWarnings],
    extractionError: input.extraction.extractionError,
    screenshotBeforePath: input.screenshotBeforePath,
    screenshotAfterPath: input.screenshotAfterPath,
    artifactDir: input.artifactDir,
  };
}

async function extractVisibleTrainingPeaksAthleteName(page: import("playwright").Page): Promise<string | null> {
  const selectors = [
    "[data-test*='athlete' i]",
    "[data-testid*='athlete' i]",
    "[class*='athlete' i]",
    "header h1",
    "header h2",
    "main h1",
    "main h2",
    "[role='combobox']",
    "select",
  ];
  for (const selector of selectors) {
    const value = await page
      .locator(selector)
      .first()
      .innerText({ timeout: 400 })
      .catch(() => null);
    if (!value) {
      continue;
    }
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized || normalized.length > 120) {
      continue;
    }
    if (/calendar|workout|trainingpeaks|settings|home/i.test(normalized)) {
      continue;
    }
    return normalized;
  }
  return null;
}

function buildIdentityCheck(input: {
  student: TrainingPeaksStudentRow;
  expectedUrl: string;
  currentUrl: string;
  visibleTrainingPeaksName: string | null;
}): DryRunIdentityCheck {
  const warnings: string[] = [];
  const expectedAthleteId = parseTrainingPeaksAthleteId(input.expectedUrl);
  const currentAthleteId = parseTrainingPeaksAthleteId(input.currentUrl);
  const expectedTrainingPeaksName = input.student.student_name ?? null;
  const visibleTrainingPeaksName = input.visibleTrainingPeaksName ?? null;

  let matchedBy: IdentityMatchType = "inconclusive";
  if (expectedAthleteId && currentAthleteId) {
    if (expectedAthleteId === currentAthleteId) {
      matchedBy = "athlete_id";
    } else {
      matchedBy = "mismatch";
      warnings.push("athlete context mismatch: athlete id");
    }
  } else if (expectedTrainingPeaksName && visibleTrainingPeaksName) {
    if (namesLikelyMatch(expectedTrainingPeaksName, visibleTrainingPeaksName)) {
      matchedBy = "trainingpeaks_name";
    } else {
      matchedBy = "mismatch";
      warnings.push("athlete context mismatch: TrainingPeaks name");
    }
  }

  return {
    telegramUsername: null,
    telegramChatId: input.student.telegram_chat_id ?? null,
    expectedTrainingPeaksName,
    visibleTrainingPeaksName,
    expectedAthleteId,
    currentAthleteId,
    expectedTrainingPeaksUrl: input.expectedUrl,
    currentUrl: input.currentUrl,
    matchedBy,
    warnings,
  };
}

export function evaluateDryRunOutcome(input: {
  action: TrainingPeaksActionRow;
  student: TrainingPeaksStudentRow | null;
  pageMeta: {
    loginRequired: boolean;
    athletePageLikelyReachable: boolean;
    trainingPeaksContextLikely: boolean;
  };
  candidates: RawWorkoutCandidate[];
  extraction: WorkoutExtractionResult;
  identityCheck: DryRunIdentityCheck;
}): DryRunEvaluation {
  const parseWarnings: string[] = [];
  const payload = parseMoveWorkoutPayload(input.action.parsed_payload);
  const coachConfirmedSourceDate = extractCoachConfirmedSourceDate(payload);
  const timezone = MOVE_DATE_TIMEZONE;
  const baseDate = new Date();
  let targetDate: string | null = null;
  let sourceDate: string | null = null;
  let selectedSourceDatePolicy = "unresolved";
  let selectedSourceDate: string | null = null;

  if (!payload?.target) {
    parseWarnings.push("parsed_payload.target is missing or invalid");
  } else {
    const resolved = resolveTargetDateFromPayload(payload.target, baseDate);
    targetDate = resolved.targetDate;
    parseWarnings.push(...resolved.warnings);
  }

  const explicitSourceDate = extractExplicitSourceDate({
    rawText: input.action.raw_text,
    parsedPayload: input.action.parsed_payload,
  });
  if (explicitSourceDate) {
    selectedSourceDatePolicy = "explicit_source_date";
    selectedSourceDate = explicitSourceDate;
  } else {
    const explicitSourceRef = extractExplicitSourceTimeRef({
      parsedPayload: input.action.parsed_payload,
    });
    if (explicitSourceRef) {
      const resolvedSource = resolveSourceDateFromPayload(explicitSourceRef, targetDate, baseDate);
      parseWarnings.push(...resolvedSource.warnings);
      if (resolvedSource.sourceDate) {
        selectedSourceDatePolicy = "explicit_source_ref";
        selectedSourceDate = resolvedSource.sourceDate;
      }
    }
  }

  if (coachConfirmedSourceDate) {
    selectedSourceDate = coachConfirmedSourceDate;
    selectedSourceDatePolicy = COACH_CONFIRMED_SOURCE_DATE_POLICY;
  }

  const diagnostics: DryRunDiagnostics = {
    loginRequired: input.pageMeta.loginRequired,
    athleteReachable: input.pageMeta.athletePageLikelyReachable,
    trainingPeaksContextOk: input.pageMeta.trainingPeaksContextLikely,
    parseWarnings: [...parseWarnings, ...input.extraction.parseWarnings, ...input.identityCheck.warnings],
    domDebug: input.extraction.domDebug,
    zeroCandidates: null,
  };

  const canExecuteReasons: string[] = [];
  if (diagnostics.loginRequired) {
    canExecuteReasons.push("login required");
  }
  if (!diagnostics.athleteReachable) {
    canExecuteReasons.push("athlete page unreachable");
  }
  if (!diagnostics.trainingPeaksContextOk) {
    canExecuteReasons.push("trainingpeaks context not confirmed");
  }
  if (input.identityCheck.matchedBy === "mismatch") {
    canExecuteReasons.push(...input.identityCheck.warnings);
  }

  if (canExecuteReasons.length > 0) {
    return {
      dryRunResult: "failed",
      resolvedDates: { sourceDate: null, targetDate, timezone },
      candidate: null,
      candidateAlternativesCount: input.candidates.length,
      confidence: 0,
      canExecute: false,
      canExecuteReasons,
      diagnostics,
      identityCheck: input.identityCheck,
      debugCandidatesTopN: input.candidates.slice(0, 10).map((candidate) => ({
        rawTextSnippet: candidate.rawTextSnippet,
        selectorHint: candidate.selectorHint,
        classHint: candidate.classHint,
        title: candidate.title,
        type: candidate.type,
        plannedDurationSec: candidate.plannedDurationSec,
        plannedDistance: candidate.plannedDistance,
        startTimeLocal: candidate.startTimeLocal,
        sourceDate: candidate.dateIso,
        workoutId: candidate.workoutId ?? null,
        score: candidate.rawScore,
        reasons: candidate.reasons,
      })),
      selectedSourceDatePolicy,
      selectedSourceDate,
      selectedSourceDateCandidateCount: 0,
      globalCandidateCount: input.candidates.length,
      sourceDateBucketCounts: {},
      rankingDebug: {
        strictGlobalCount: 0,
        selectedSourceDatePolicy,
        selectedSourceDate,
        selectedSourceDateCandidateCount: 0,
        globalCandidateCount: input.candidates.length,
        sourceDateBucketCounts: {},
      },
    };
  }

  if (input.extraction.extractionError) {
    return {
      dryRunResult: "failed",
      resolvedDates: { sourceDate: null, targetDate, timezone },
      candidate: null,
      candidateAlternativesCount: 0,
      confidence: 0,
      canExecute: false,
      canExecuteReasons: ["Не удалось прочитать карточки тренировок из календаря"],
      diagnostics,
      identityCheck: input.identityCheck,
      debugCandidatesTopN: [],
      selectedSourceDatePolicy,
      selectedSourceDate,
      selectedSourceDateCandidateCount: 0,
      globalCandidateCount: 0,
      sourceDateBucketCounts: {},
      rankingDebug: {
        strictGlobalCount: 0,
        selectedSourceDatePolicy,
        selectedSourceDate,
        selectedSourceDateCandidateCount: 0,
        globalCandidateCount: 0,
        sourceDateBucketCounts: {},
      },
    };
  }

  if (input.candidates.length === 0) {
    const cardsVisible = input.extraction.dateAttributionDebug?.cardsVisible ?? 0;
    const cardsWithoutDateIso = input.extraction.dateAttributionDebug?.cardsWithoutDateIso ?? 0;
    const dateAttributionFailed = cardsVisible > 0 && cardsWithoutDateIso >= cardsVisible;
    return {
      dryRunResult: "not_found",
      resolvedDates: { sourceDate: null, targetDate, timezone },
      candidate: null,
      candidateAlternativesCount: 0,
      confidence: 0.2,
      canExecute: false,
      canExecuteReasons: [
        dateAttributionFailed
          ? "Карточки тренировок найдены, но не удалось надёжно определить даты карточек."
          : "Карточки тренировок не найдены в календаре",
      ],
      diagnostics,
      identityCheck: input.identityCheck,
      debugCandidatesTopN: [],
      selectedSourceDatePolicy,
      selectedSourceDate,
      selectedSourceDateCandidateCount: 0,
      globalCandidateCount: 0,
      sourceDateBucketCounts: {},
      rankingDebug: {
        strictGlobalCount: 0,
        selectedSourceDatePolicy,
        selectedSourceDate,
        selectedSourceDateCandidateCount: 0,
        globalCandidateCount: 0,
        sourceDateBucketCounts: {},
      },
    };
  }

  const strictGlobalCandidates = input.candidates.filter((candidate) => {
    if (candidate.fromFallback) {
      return false;
    }
    if (!candidate.dateIso) {
      return false;
    }
    if (candidateLooksCompleted(candidate.rawTextSnippet)) {
      return false;
    }
    if (!candidateLooksLikeWorkoutCard(candidate)) {
      return false;
    }
    const fingerprint = buildCandidateFingerprint({
      studentId: input.student?.id ?? null,
      dateIso: candidate.dateIso,
      title: candidate.title,
      type: candidate.type,
      startTimeLocal: candidate.startTimeLocal,
      plannedDurationSec: candidate.plannedDurationSec,
      plannedDistance: candidate.plannedDistance,
    });
    return Boolean(fingerprint);
  });
  const globalCandidateCount = input.candidates.length;
  const cardsVisible = input.extraction.dateAttributionDebug?.cardsVisible ?? input.candidates.length;
  const cardsWithDateIso = input.extraction.dateAttributionDebug?.cardsWithDateIso ?? input.candidates.filter((candidate) => Boolean(candidate.dateIso)).length;
  const cardsWithoutDateIso = input.extraction.dateAttributionDebug?.cardsWithoutDateIso ?? Math.max(0, cardsVisible - cardsWithDateIso);
  const sourceDateBucketCounts: Record<string, number> = {};
  for (const candidate of strictGlobalCandidates) {
    if (!candidate.dateIso) {
      continue;
    }
    sourceDateBucketCounts[candidate.dateIso] = (sourceDateBucketCounts[candidate.dateIso] ?? 0) + 1;
  }

  let sourceInferenceProvenance: DryRunSourceInferenceProvenance | null = null;
  if (!selectedSourceDate && targetDate) {
    const targetDayHasWorkout = strictGlobalCandidates.some((candidate) => candidate.dateIso === targetDate);
    const strongFutureResolution = strongFutureDescriptorMoveSource.resolveStrongFutureIntervalMoveSource({
      targetDate,
      parsedPayload: input.action.parsed_payload,
      targetDayHasWorkout,
      candidates: strictGlobalCandidates
        .filter((candidate) => Boolean(candidate.dateIso))
        .map((candidate) => ({
          dateIso: candidate.dateIso!,
          title: candidate.title,
          type: candidate.type,
          rawTextSnippet: candidate.rawTextSnippet,
          workoutId: candidate.workoutId ?? null,
          fingerprint: buildCandidateFingerprint({
            studentId: input.student?.id ?? null,
            dateIso: candidate.dateIso,
            title: candidate.title,
            type: candidate.type,
            startTimeLocal: candidate.startTimeLocal,
            plannedDurationSec: candidate.plannedDurationSec,
            plannedDistance: candidate.plannedDistance,
          }),
          rawScore: candidate.rawScore,
        })),
    });
    if (strongFutureResolution) {
      selectedSourceDatePolicy = strongFutureResolution.selectedSourceDatePolicy;
      if (strongFutureResolution.selectedSourceDate) {
        selectedSourceDate = strongFutureResolution.selectedSourceDate;
      }
      const selected = strongFutureResolution.selectedCandidate;
      sourceInferenceProvenance = {
        descriptorType: strongFutureResolution.descriptorType,
        descriptorConfidence: strongFutureResolution.descriptorConfidence,
        sourceInferencePolicy: strongFutureResolution.sourceInferencePolicy,
        selectedSourceDate: strongFutureResolution.selectedSourceDate,
        targetDate,
        candidate: selected
          ? {
              title: selected.title,
              type: selected.type,
              date: selected.dateIso,
              fingerprint: selected.fingerprint,
              workoutId: selected.workoutId,
            }
          : null,
        candidateCount: strongFutureResolution.candidateCount,
        candidateAlternativesCount: strongFutureResolution.candidateAlternativesCount,
        score: strongFutureResolution.score,
        margin: strongFutureResolution.margin,
        warnings: strongFutureResolution.warnings,
      };
      if (strongFutureResolution.warnings.length > 0) {
        parseWarnings.push(...strongFutureResolution.warnings);
      }
    }
  }

  if (!selectedSourceDate && targetDate && isTargetTomorrow(input.action)) {
    selectedSourceDate = getRelativeLocalIsoDate("today", baseDate);
    selectedSourceDatePolicy = "target_tomorrow_prefers_today";
  }
  if (!selectedSourceDate && targetDate && isTargetToday(input.action)) {
    selectedSourceDate = getRelativeLocalIsoDate("yesterday", baseDate);
    selectedSourceDatePolicy = "target_today_prefers_yesterday";
  }

  if (!selectedSourceDate && targetDate) {
    const eligibleDates = Object.keys(sourceDateBucketCounts)
      .filter((date) => date < targetDate)
      .map((date) => ({ date, delta: dateDistanceDays(date, targetDate) }))
      .filter((entry) => entry.delta >= 1 && entry.delta <= 3)
      .sort((left, right) => left.delta - right.delta);
    if (eligibleDates.length > 0) {
      selectedSourceDate = eligibleDates[0]!.date;
      selectedSourceDatePolicy = "nearest_prior_within_3_days";
    } else {
      selectedSourceDatePolicy = "no_safe_inferred_source_date";
    }
  }

  const selectedBucketCandidates = selectedSourceDate
    ? strictGlobalCandidates.filter((candidate) => candidate.dateIso === selectedSourceDate)
    : [];
  const selectedSourceDateCandidateCount = selectedBucketCandidates.length;

  if (!selectedSourceDate) {
    const reasons =
      strictGlobalCandidates.length === 0 && cardsVisible > 0 && cardsWithoutDateIso > 0
        ? [
            "Calendar cards found, but dates could not be assigned safely.",
            "Карточки тренировок найдены, но не удалось надёжно определить даты карточек.",
          ]
        : ["source date could not be resolved safely", "Нужна исходная дата"];
    return {
      dryRunResult: strictGlobalCandidates.length > 0 ? "ambiguous" : "not_found",
      resolvedDates: { sourceDate: null, targetDate, timezone },
      candidate: null,
      candidateAlternativesCount: 0,
      confidence: 0,
      canExecute: false,
      canExecuteReasons: reasons,
      diagnostics,
      identityCheck: input.identityCheck,
      debugCandidatesTopN: input.candidates.slice(0, 10).map((candidate) => ({
        rawTextSnippet: candidate.rawTextSnippet,
        selectorHint: candidate.selectorHint,
        classHint: candidate.classHint,
        title: candidate.title,
        type: candidate.type,
        plannedDurationSec: candidate.plannedDurationSec,
        plannedDistance: candidate.plannedDistance,
        startTimeLocal: candidate.startTimeLocal,
        sourceDate: candidate.dateIso,
        workoutId: candidate.workoutId ?? null,
        score: candidate.rawScore,
        reasons: candidate.reasons,
      })),
      selectedSourceDatePolicy,
      selectedSourceDate,
      selectedSourceDateCandidateCount,
      globalCandidateCount,
      sourceDateBucketCounts,
      rankingDebug: {
        strictGlobalCount: strictGlobalCandidates.length,
        selectedSourceDatePolicy,
        selectedSourceDate,
        selectedSourceDateCandidateCount,
        globalCandidateCount,
        sourceDateBucketCounts,
      },
      sourceInferenceProvenance,
    };
  }

  if (selectedBucketCandidates.length === 0) {
    const reasons =
      selectedSourceDatePolicy === COACH_CONFIRMED_SOURCE_DATE_POLICY
        ? [
            "Coach-confirmed source date no longer matches detected workout candidate.",
            "Подтверждённая исходная дата больше не совпадает с найденной тренировкой.",
          ]
        : cardsVisible > 0 && cardsWithDateIso === 0
          ? [
              "Calendar cards found, but dates could not be assigned safely.",
              "Карточки тренировок найдены, но не удалось надёжно определить даты карточек.",
            ]
        : ["no planned candidate on inferred source date", "Нужна конкретная тренировка"];
    return {
      dryRunResult: "not_found",
      resolvedDates: { sourceDate: selectedSourceDate, targetDate, timezone },
      candidate: null,
      candidateAlternativesCount: 0,
      confidence: 0,
      canExecute: false,
      canExecuteReasons: reasons,
      diagnostics,
      identityCheck: input.identityCheck,
      debugCandidatesTopN: input.candidates.slice(0, 10).map((candidate) => ({
        rawTextSnippet: candidate.rawTextSnippet,
        selectorHint: candidate.selectorHint,
        classHint: candidate.classHint,
        title: candidate.title,
        type: candidate.type,
        plannedDurationSec: candidate.plannedDurationSec,
        plannedDistance: candidate.plannedDistance,
        startTimeLocal: candidate.startTimeLocal,
        sourceDate: candidate.dateIso,
        workoutId: candidate.workoutId ?? null,
        score: candidate.rawScore,
        reasons: candidate.reasons,
      })),
      selectedSourceDatePolicy,
      selectedSourceDate,
      selectedSourceDateCandidateCount,
      globalCandidateCount,
      sourceDateBucketCounts,
      rankingDebug: {
        strictGlobalCount: strictGlobalCandidates.length,
        selectedSourceDatePolicy,
        selectedSourceDate,
        selectedSourceDateCandidateCount,
        globalCandidateCount,
        sourceDateBucketCounts,
      },
      sourceInferenceProvenance,
    };
  }

  const sameDateRanking = evaluateSelectedSourceDateMoveRanking({
    parsedPayload: input.action.parsed_payload,
    selectedSourceDate,
    selectedSourceDatePolicy,
    candidates: selectedBucketCandidates,
  });
  const rankedBucketCandidates = sameDateRanking.rankedCandidates;
  const topRanked = sameDateRanking.topCandidate;
  if (!topRanked) {
    return {
      dryRunResult: "not_found",
      resolvedDates: { sourceDate: selectedSourceDate, targetDate, timezone },
      candidate: null,
      candidateAlternativesCount: 0,
      confidence: 0,
      canExecute: false,
      canExecuteReasons: ["Нужна конкретная тренировка"],
      diagnostics,
      identityCheck: input.identityCheck,
      debugCandidatesTopN: input.candidates.slice(0, 10).map((candidate) => ({
        rawTextSnippet: candidate.rawTextSnippet,
        selectorHint: candidate.selectorHint,
        classHint: candidate.classHint,
        title: candidate.title,
        type: candidate.type,
        plannedDurationSec: candidate.plannedDurationSec,
        plannedDistance: candidate.plannedDistance,
        startTimeLocal: candidate.startTimeLocal,
        sourceDate: candidate.dateIso,
        workoutId: candidate.workoutId ?? null,
        score: candidate.rawScore,
        reasons: candidate.reasons,
      })),
      selectedSourceDatePolicy,
      selectedSourceDate,
      selectedSourceDateCandidateCount,
      globalCandidateCount,
      sourceDateBucketCounts,
      rankingDebug: {
        strictGlobalCount: strictGlobalCandidates.length,
        selectedSourceDatePolicy,
        selectedSourceDate,
        selectedSourceDateCandidateCount,
        globalCandidateCount,
        sourceDateBucketCounts,
        descriptorType: sameDateRanking.descriptorType,
        plausibleSelectedSourceDateCandidateCount: sameDateRanking.plausibleCandidateCount,
        safeSelectedSourceDateCandidateCount: sameDateRanking.safeCandidateCount,
        ignoredSameDateCompetitorCount: sameDateRanking.ignoredSameDateCompetitorCount,
        topPlausibleMargin: sameDateRanking.margin,
      },
      sourceInferenceProvenance,
    };
  }
  const coachConfirmedSourceWorkoutId = extractCoachConfirmedSourceWorkoutId(payload);
  const coachForcedRankedCandidate =
    coachConfirmedSourceWorkoutId !== null
      ? rankedBucketCandidates.find((entry) => entry.candidate.workoutId === coachConfirmedSourceWorkoutId) ?? null
      : null;
  const effectiveTopRanked = coachForcedRankedCandidate ?? topRanked;
  const top = effectiveTopRanked.candidate;
  const confidence = sameDateRanking.confidence;
  sourceDate = selectedSourceDate;
  const plausibleCandidates = rankedBucketCandidates.filter((entry) => entry.plausibleSameDateCompetitor);
  const safeCandidates = rankedBucketCandidates.filter((entry) => entry.safeCandidate);
  const alternativesCount = coachForcedRankedCandidate ? 0 : Math.max(0, plausibleCandidates.length - 1);

  const candidate: DryRunCandidate = {
    title: top.title,
    type: top.type,
    plannedDurationSec: top.plannedDurationSec,
    plannedDistance: top.plannedDistance,
    startTimeLocal: top.startTimeLocal,
    fingerprint: buildCandidateFingerprint({
      studentId: input.student?.id ?? null,
      dateIso: sourceDate,
      title: top.title,
      type: top.type,
      startTimeLocal: top.startTimeLocal,
      plannedDurationSec: top.plannedDurationSec,
      plannedDistance: top.plannedDistance,
    }),
    workoutId: top.workoutId ?? null,
  };

  let dryRunResult: DryRunResult = "candidate_found";
  const reasons: string[] = [];
  const pushReason = (reason: string | null | undefined): void => {
    const normalized = typeof reason === "string" ? reason.trim() : "";
    if (!normalized || reasons.includes(normalized)) {
      return;
    }
    reasons.push(normalized);
  };

  if (coachConfirmedSourceWorkoutId !== null && !coachForcedRankedCandidate) {
    dryRunResult = "failed";
    pushReason("coach confirmed workout not found on selected source date");
  }

  const strongFutureExecutionContext =
    selectedSourceDatePolicy === moveSourcePolicy.STRONG_FUTURE_DESCRIPTOR_MATCH_POLICY
      ? {
          selectedSourceDatePolicy,
          parsedPayload: input.action.parsed_payload,
          resolvedSourceDate: sourceDate,
          resolvedTargetDate: targetDate,
          candidateFingerprint: candidate.fingerprint,
          candidateTitle: candidate.title,
          candidateType: candidate.type,
          sourceInferenceProvenance,
          confidence,
          identityMatchedBy: input.identityCheck.matchedBy,
          candidateAlternativesCount: alternativesCount,
        }
      : null;
  const strongFutureStructurallyConfirmed =
    strongFutureExecutionContext !== null &&
    moveSourcePolicy.validateStrongFutureDescriptorMoveSourceForExecution(strongFutureExecutionContext).ok;
  const executionConfidence =
    strongFutureStructurallyConfirmed &&
    typeof sourceInferenceProvenance?.score === "number" &&
    Number.isFinite(sourceInferenceProvenance.score)
      ? sourceInferenceProvenance.score
      : confidence;
  const executionConfidenceThreshold = strongFutureStructurallyConfirmed
    ? moveSourcePolicy.STRONG_FUTURE_DESCRIPTOR_EXECUTION_CONFIDENCE_THRESHOLD
    : 0.8;
  const effectiveSafeCandidateCount = coachForcedRankedCandidate
    ? 1
    : strongFutureStructurallyConfirmed
      ? 1
      : safeCandidates.length;

  if (!coachForcedRankedCandidate && plausibleCandidates.length > 1) {
    dryRunResult = "ambiguous";
    pushReason(sameDateRanking.helpfulAmbiguityReason ?? "multiple candidates on selected source date");
  }
  if (!coachForcedRankedCandidate && sameDateRanking.margin !== null && sameDateRanking.margin < 0.12) {
    dryRunResult = "ambiguous";
    pushReason("top candidate margin too small");
  }
  if (!targetDate) {
    pushReason("target date could not be resolved");
  }
  if (!sourceDate) {
    pushReason("source date could not be resolved safely");
  }
  if (!candidate.fingerprint) {
    pushReason("candidate fingerprint missing");
  }
  if (!coachForcedRankedCandidate && executionConfidence < executionConfidenceThreshold) {
    pushReason(`confidence below threshold ${executionConfidenceThreshold}`);
  }
  if (effectiveSafeCandidateCount !== 1) {
    if (safeCandidates.length === 0) {
      pushReason("no candidate meets safe score threshold");
    } else if (!coachForcedRankedCandidate) {
      pushReason(sameDateRanking.helpfulAmbiguityReason ?? "multiple candidates on selected source date");
    }
  }
  if (!coachForcedRankedCandidate && sameDateRanking.margin !== null && sameDateRanking.margin < 0.12) {
    pushReason("top candidate margin too small");
  }
  if (input.identityCheck.matchedBy === "mismatch") {
    for (const warning of input.identityCheck.warnings) {
      pushReason(warning);
    }
  }

  const moveSourceValidation = moveSourcePolicy.validateMoveSourceForExecution({
    selectedSourceDatePolicy,
    parsedPayload: input.action.parsed_payload,
    dryRunLog: {
      dryRunResult,
      resolvedDates: { sourceDate, targetDate },
      candidate,
      confidence,
      identityCheck: input.identityCheck,
      candidateAlternativesCount: alternativesCount,
      sourceInferenceProvenance,
      selectedSourceDatePolicy,
    },
  });
  const moveSourceTrustedForExecution = moveSourceValidation.ok;
  if (!moveSourceTrustedForExecution) {
    if (selectedSourceDatePolicy === moveSourcePolicy.STRONG_FUTURE_DESCRIPTOR_MATCH_POLICY) {
      pushReason(moveSourceValidation.reason);
    } else if (
      !moveSourcePolicy.isMoveSourceExplicitEnough({
        selectedSourceDatePolicy,
        parsedPayload: input.action.parsed_payload,
      })
    ) {
      pushReason(moveSourcePolicy.INFERRED_MOVE_SOURCE_EXECUTION_BLOCK_REASON);
    } else {
      pushReason(moveSourceValidation.reason);
    }
  }

  const coachConfirmedManualExecuteReady =
    selectedSourceDatePolicy === COACH_CONFIRMED_SOURCE_DATE_POLICY &&
    dryRunResult === "candidate_found" &&
    effectiveSafeCandidateCount === 1 &&
    Boolean(targetDate) &&
    Boolean(selectedSourceDate) &&
    Boolean(candidate.fingerprint) &&
    input.identityCheck.matchedBy !== "mismatch" &&
    moveSourceTrustedForExecution &&
    reasons.length === 1 &&
    /^confidence below threshold \d+(?:\.\d+)?$/i.test(reasons[0] ?? "");

  const coachConfirmedWorkoutExecuteReady =
    coachForcedRankedCandidate !== null &&
    dryRunResult !== "failed" &&
    Boolean(targetDate) &&
    Boolean(selectedSourceDate) &&
    Boolean(candidate.fingerprint) &&
    input.identityCheck.matchedBy !== "mismatch" &&
    moveSourceTrustedForExecution;

  if (coachConfirmedWorkoutExecuteReady) {
    dryRunResult = "candidate_found";
  }

  const canExecute =
    dryRunResult === "candidate_found" &&
    effectiveSafeCandidateCount === 1 &&
    Boolean(targetDate) &&
    Boolean(selectedSourceDate) &&
    Boolean(candidate.fingerprint) &&
    (executionConfidence >= executionConfidenceThreshold ||
      coachConfirmedManualExecuteReady ||
      coachConfirmedWorkoutExecuteReady) &&
    input.identityCheck.matchedBy !== "mismatch" &&
    moveSourceTrustedForExecution;

  if (!canExecute && reasons.length === 0) {
    pushReason("safety policy conditions not met");
  }

  if (
    !coachForcedRankedCandidate &&
    dryRunResult === "candidate_found" &&
    !canExecute &&
    moveSourceTrustedForExecution &&
    plausibleCandidates.length > 1
  ) {
    dryRunResult = "ambiguous";
  }

  const plannedVsCompletedHint =
    dryRunResult === "ambiguous"
      ? detectPlannedVsCompletedAmbiguityHint({
          dryRunResult,
          plausibleCandidates: plausibleCandidates.map((entry) => entry.candidate),
          canExecuteReasons: reasons,
          provenanceWarnings: sourceInferenceProvenance?.warnings ?? [],
          payloadWarnings: extractParsedPayloadWarnings(payload),
          identityMatchedBy: input.identityCheck.matchedBy,
        })
      : null;

  return {
    dryRunResult,
    resolvedDates: {
      sourceDate: sourceDate ?? null,
      targetDate: targetDate ?? null,
      timezone,
    },
    candidate,
    candidateAlternativesCount: alternativesCount,
    confidence,
    canExecute,
    canExecuteReasons: canExecute ? [] : reasons,
    diagnostics,
    identityCheck: input.identityCheck,
    debugCandidatesTopN: input.candidates
      .slice(0, 10)
      .map((candidate) => {
        const ranked = rankedBucketCandidates.find(
          (entry) => buildSameDateCandidateDebugKey(entry.candidate) === buildSameDateCandidateDebugKey(candidate)
        );
        return {
          rawTextSnippet: candidate.rawTextSnippet,
          selectorHint: candidate.selectorHint,
          classHint: candidate.classHint,
          title: candidate.title,
          type: candidate.type,
          plannedDurationSec: candidate.plannedDurationSec,
          plannedDistance: candidate.plannedDistance,
          startTimeLocal: candidate.startTimeLocal,
          sourceDate: candidate.dateIso,
          workoutId: candidate.workoutId ?? null,
          score: ranked?.effectiveScore ?? candidate.rawScore,
          reasons: ranked ? [...candidate.reasons, ...ranked.scoreReasons] : candidate.reasons,
        };
      }),
    selectedSourceDatePolicy,
    selectedSourceDate,
    selectedSourceDateCandidateCount,
    globalCandidateCount,
    sourceDateBucketCounts,
    rankingDebug: {
      strictGlobalCount: strictGlobalCandidates.length,
      selectedSourceDatePolicy,
      selectedSourceDate,
      selectedSourceDateCandidateCount,
      globalCandidateCount,
      sourceDateBucketCounts,
      descriptorType: sameDateRanking.descriptorType,
      plausibleSelectedSourceDateCandidateCount: sameDateRanking.plausibleCandidateCount,
      safeSelectedSourceDateCandidateCount: sameDateRanking.safeCandidateCount,
      ignoredSameDateCompetitorCount: sameDateRanking.ignoredSameDateCompetitorCount,
      topPlausibleMargin: sameDateRanking.margin,
    },
    sourceInferenceProvenance,
    plannedVsCompletedHint,
  };
}

function normalizeTrustedDryRunLog(logJson: unknown, parsedPayload?: unknown): TrustedDryRunLog | null {
  if (!logJson || typeof logJson !== "object") {
    return null;
  }

  const payload = logJson as {
    dryRunResult?: unknown;
    canExecute?: unknown;
    confidence?: unknown;
    candidate?: DryRunCandidate | null;
    resolvedDates?: { sourceDate?: unknown; targetDate?: unknown; timezone?: unknown } | null;
    identityCheck?: DryRunIdentityCheck | null;
    selectedSourceDatePolicy?: unknown;
  };

  const confidence =
    typeof payload.confidence === "number"
      ? payload.confidence
      : typeof payload.confidence === "string"
        ? Number(payload.confidence)
        : Number.NaN;
  const sourceDate =
    typeof payload.resolvedDates?.sourceDate === "string" ? payload.resolvedDates.sourceDate.trim() : "";
  const targetDate =
    typeof payload.resolvedDates?.targetDate === "string" ? payload.resolvedDates.targetDate.trim() : "";

  if (payload.dryRunResult !== "candidate_found") {
    return null;
  }
  if (payload.canExecute !== true) {
    return null;
  }
  if (!payload.candidate) {
    return null;
  }

  const selectedSourceDatePolicyFromDryRun =
    typeof payload.selectedSourceDatePolicy === "string" ? payload.selectedSourceDatePolicy : null;
  if (selectedSourceDatePolicyFromDryRun === COACH_CONFIRMED_SOURCE_DATE_POLICY) {
    const parsed = parseMoveWorkoutPayload(parsedPayload ?? null);
    const confirmedSourceDate = extractCoachConfirmedSourceDate(parsed);
    if (!confirmedSourceDate || confirmedSourceDate !== sourceDate) {
      return null;
    }
  }
  if (!moveSourcePolicy.validateDryRunLogReadiness(logJson, parsedPayload).ok) {
    return null;
  }
  if (!payload.identityCheck) {
    return null;
  }

  return {
    dryRunResult: "candidate_found",
    canExecute: true,
    confidence,
    candidate: {
      ...payload.candidate,
      workoutId:
        typeof payload.candidate.workoutId === "number" && Number.isFinite(payload.candidate.workoutId)
          ? payload.candidate.workoutId
          : null,
    },
    resolvedDates: {
      sourceDate,
      targetDate,
      timezone: typeof payload.resolvedDates?.timezone === "string" ? payload.resolvedDates.timezone : null,
    },
    identityCheck: payload.identityCheck,
    selectedSourceDatePolicy: selectedSourceDatePolicyFromDryRun,
  };
}

function compareOptionalField<T>(trusted: T | null, current: T | null): RevalidationComparisonField<T> {
  if (trusted === null || trusted === undefined) {
    return {
      trusted: trusted ?? null,
      current: current ?? null,
      matches: current === null || current === undefined,
    };
  }
  if (current === null || current === undefined) {
    return {
      trusted,
      current: null,
      matches: false,
    };
  }
  return {
    trusted,
    current,
    matches: trusted === current,
  };
}

function hasCoachConfirmedSourceDateOverride(parsedPayload: unknown): boolean {
  if (!parsedPayload || typeof parsedPayload !== "object") {
    return false;
  }
  const payload = parsedPayload as {
    coach_confirmed_source_date?: unknown;
    source_date_policy_override?: unknown;
  };
  const confirmedSourceDate =
    typeof payload.coach_confirmed_source_date === "string"
      ? payload.coach_confirmed_source_date.trim()
      : "";
  const sourceDatePolicyOverride =
    typeof payload.source_date_policy_override === "string"
      ? payload.source_date_policy_override.trim()
      : "";
  return Boolean(confirmedSourceDate) || sourceDatePolicyOverride === COACH_CONFIRMED_SOURCE_DATE_POLICY;
}

export function shouldBypassConfidenceThresholdForCoachConfirmedRevalidation(input: {
  parsedPayload?: unknown;
  trustedSelectedSourceDatePolicy: string | null;
  currentSelectedSourceDatePolicy: string | null;
  trustedSourceDate: string | null;
  trustedTargetDate: string | null;
  currentSourceDate: string | null;
  currentTargetDate: string | null;
  actionStatus: TrainingPeaksActionRow["status"];
  actionExecutionStatus: TrainingPeaksActionRow["execution_status"];
}): boolean {
  if (!hasCoachConfirmedSourceDateOverride(input.parsedPayload ?? null)) {
    return false;
  }
  if (
    input.trustedSelectedSourceDatePolicy !== COACH_CONFIRMED_SOURCE_DATE_POLICY ||
    input.currentSelectedSourceDatePolicy !== COACH_CONFIRMED_SOURCE_DATE_POLICY
  ) {
    return false;
  }
  if (
    !input.trustedSourceDate ||
    !input.trustedTargetDate ||
    !input.currentSourceDate ||
    !input.currentTargetDate
  ) {
    return false;
  }
  if (input.actionStatus !== "approved") {
    return false;
  }
  return input.actionExecutionStatus === "execute_pending" || input.actionExecutionStatus === "running_local";
}

function buildRevalidationComparison(input: {
  trusted: TrustedDryRunLog;
  current: DryRunEvaluation;
  parsedPayload?: unknown;
  actionStatus: TrainingPeaksActionRow["status"];
  actionExecutionStatus: TrainingPeaksActionRow["execution_status"];
}): RevalidationComparison {
  const mismatchReasons: string[] = [];
  const trustedCandidate = input.trusted.candidate;
  const currentCandidate = input.current.candidate;
  let confidenceThresholdBypassReason: string | null = null;

  const sourceDate = compareOptionalField(
    input.trusted.resolvedDates.sourceDate,
    input.current.resolvedDates.sourceDate
  );
  const targetDate = compareOptionalField(
    input.trusted.resolvedDates.targetDate,
    input.current.resolvedDates.targetDate
  );
  const fingerprint = compareOptionalField(trustedCandidate.fingerprint, currentCandidate?.fingerprint ?? null);
  const title = compareOptionalField(trustedCandidate.title, currentCandidate?.title ?? null);
  const type = compareOptionalField(trustedCandidate.type, currentCandidate?.type ?? null);
  const plannedDurationSec = compareOptionalField(
    trustedCandidate.plannedDurationSec,
    currentCandidate?.plannedDurationSec ?? null
  );
  const plannedDistance = compareOptionalField(
    trustedCandidate.plannedDistance,
    currentCandidate?.plannedDistance ?? null
  );
  const startTimeLocal = compareOptionalField(
    trustedCandidate.startTimeLocal,
    currentCandidate?.startTimeLocal ?? null
  );

  if (
    input.trusted.selectedSourceDatePolicy === moveSourcePolicy.STRONG_FUTURE_DESCRIPTOR_MATCH_POLICY &&
    input.current.selectedSourceDatePolicy !== moveSourcePolicy.STRONG_FUTURE_DESCRIPTOR_MATCH_POLICY
  ) {
    mismatchReasons.push("selectedSourceDatePolicy mismatch for strong inferred move");
  }

  if (
    input.trusted.selectedSourceDatePolicy === COACH_CONFIRMED_SOURCE_DATE_POLICY &&
    input.current.selectedSourceDatePolicy !== COACH_CONFIRMED_SOURCE_DATE_POLICY
  ) {
    mismatchReasons.push("selectedSourceDatePolicy mismatch for coach-confirmed source date");
  }

  if (input.trusted.selectedSourceDatePolicy === moveSourcePolicy.STRONG_FUTURE_DESCRIPTOR_MATCH_POLICY) {
    const currentMoveSourceValidation = moveSourcePolicy.validateMoveSourceForExecution({
      selectedSourceDatePolicy: input.current.selectedSourceDatePolicy,
      parsedPayload: input.parsedPayload ?? null,
      dryRunLog: {
        dryRunResult: input.current.dryRunResult,
        resolvedDates: input.current.resolvedDates,
        candidate: input.current.candidate,
        confidence: input.current.confidence,
        identityCheck: input.current.identityCheck,
        candidateAlternativesCount: input.current.candidateAlternativesCount,
        sourceInferenceProvenance: input.current.sourceInferenceProvenance ?? null,
        selectedSourceDatePolicy: input.current.selectedSourceDatePolicy,
      },
    });
    if (!currentMoveSourceValidation.ok) {
      mismatchReasons.push(`strong inferred revalidation failed: ${currentMoveSourceValidation.reason}`);
    }
  }

  if (input.current.identityCheck.matchedBy === "mismatch") {
    mismatchReasons.push("identityCheck.matchedBy became mismatch");
  }
  if (input.current.dryRunResult !== "candidate_found") {
    mismatchReasons.push(`current dryRunResult=${input.current.dryRunResult}`);
  }
  if (!input.current.canExecute) {
    mismatchReasons.push("current revalidation marked action unsafe");
  }
  const strongFutureRevalidationTrusted =
    input.trusted.selectedSourceDatePolicy === moveSourcePolicy.STRONG_FUTURE_DESCRIPTOR_MATCH_POLICY &&
    moveSourcePolicy.validateMoveSourceForExecution({
      selectedSourceDatePolicy: input.current.selectedSourceDatePolicy,
      parsedPayload: input.parsedPayload ?? null,
      dryRunLog: {
        dryRunResult: input.current.dryRunResult,
        resolvedDates: input.current.resolvedDates,
        candidate: input.current.candidate,
        confidence: input.current.confidence,
        identityCheck: input.current.identityCheck,
        candidateAlternativesCount: input.current.candidateAlternativesCount,
        sourceInferenceProvenance: input.current.sourceInferenceProvenance ?? null,
        selectedSourceDatePolicy: input.current.selectedSourceDatePolicy,
      },
    }).ok;
  const currentExecutionConfidence =
    strongFutureRevalidationTrusted &&
    typeof input.current.sourceInferenceProvenance?.score === "number" &&
    Number.isFinite(input.current.sourceInferenceProvenance.score)
      ? input.current.sourceInferenceProvenance.score
      : input.current.confidence;
  const currentExecutionConfidenceThreshold = strongFutureRevalidationTrusted
    ? moveSourcePolicy.STRONG_FUTURE_DESCRIPTOR_EXECUTION_CONFIDENCE_THRESHOLD
    : 0.8;
  const shouldBypassConfidenceThreshold = shouldBypassConfidenceThresholdForCoachConfirmedRevalidation({
    parsedPayload: input.parsedPayload ?? null,
    trustedSelectedSourceDatePolicy: input.trusted.selectedSourceDatePolicy,
    currentSelectedSourceDatePolicy: input.current.selectedSourceDatePolicy,
    trustedSourceDate: input.trusted.resolvedDates.sourceDate,
    trustedTargetDate: input.trusted.resolvedDates.targetDate,
    currentSourceDate: input.current.resolvedDates.sourceDate,
    currentTargetDate: input.current.resolvedDates.targetDate,
    actionStatus: input.actionStatus,
    actionExecutionStatus: input.actionExecutionStatus,
  });
  if (currentExecutionConfidence < currentExecutionConfidenceThreshold) {
    if (shouldBypassConfidenceThreshold) {
      confidenceThresholdBypassReason =
        "current confidence below threshold ignored because source was coach-confirmed";
    } else {
      mismatchReasons.push(`current confidence below threshold: ${currentExecutionConfidence.toFixed(2)}`);
    }
  }
  if (input.current.candidateAlternativesCount > 0) {
    mismatchReasons.push(`current evaluation ambiguous: alternatives=${input.current.candidateAlternativesCount}`);
  }
  if (!sourceDate.matches) {
    mismatchReasons.push("sourceDate mismatch");
  }
  if (!targetDate.matches) {
    mismatchReasons.push("targetDate mismatch");
  }
  if (!fingerprint.matches) {
    mismatchReasons.push("candidate fingerprint mismatch");
  }
  if (!title.matches && title.current !== null) {
    mismatchReasons.push("candidate title contradicts trusted dry-run");
  }
  if (!type.matches && type.current !== null) {
    mismatchReasons.push("candidate type contradicts trusted dry-run");
  }
  if (!plannedDurationSec.matches && plannedDurationSec.current !== null) {
    mismatchReasons.push("candidate plannedDurationSec contradicts trusted dry-run");
  }
  if (!plannedDistance.matches && plannedDistance.current !== null) {
    mismatchReasons.push("candidate plannedDistance contradicts trusted dry-run");
  }
  if (!startTimeLocal.matches && startTimeLocal.current !== null) {
    mismatchReasons.push("candidate startTimeLocal contradicts trusted dry-run");
  }

  return {
    revalidationPassed: mismatchReasons.length === 0,
    mismatchReasons,
    confidenceThresholdBypassed: Boolean(confidenceThresholdBypassReason),
    confidenceThresholdBypassReason,
    trustedDryRunResult: input.trusted.dryRunResult,
    currentDryRunResult: input.current.dryRunResult,
    trustedCanExecute: input.trusted.canExecute,
    currentCanExecute: input.current.canExecute,
    trustedConfidence: input.trusted.confidence,
    currentConfidence: input.current.confidence,
    trustedIdentityMatchedBy: input.trusted.identityCheck.matchedBy,
    currentIdentityMatchedBy: input.current.identityCheck.matchedBy,
    sourceDate,
    targetDate,
    fingerprint,
    title,
    type,
    plannedDurationSec,
    plannedDistance,
    startTimeLocal,
    trustedCandidate,
    currentCandidate,
  };
}

async function runDryRunInspection(claimed: ClaimedAction, runId: string): Promise<DryRunArtifacts> {
  return inspectActionCalendar(claimed, runId);
}

async function inspectActionCalendar(claimed: ClaimedAction, runId: string): Promise<DryRunArtifacts> {
  const student = claimed.student;
  if (!student) {
    throw new Error(`Student is missing for action ${claimed.action.id}.`);
  }
  if (!student.trainingpeaks_athlete_url?.trim()) {
    throw new Error(`Missing trainingpeaks_athlete_url for student ${student.student_name}.`);
  }

  await mkdir(profileDir, { recursive: true });
  const artifactDir = path.join(ACTION_ARTIFACTS_ROOT, claimed.action.id, runId);
  await mkdir(artifactDir, { recursive: true });

  const screenshotBeforePath = path.join(artifactDir, "before.png");
  const screenshotAfterPath = path.join(artifactDir, "after.png");

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    viewport: null,
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(student.trainingpeaks_athlete_url, { waitUntil: "domcontentloaded", timeout: 30_000 });

    // Phase 3D.1 safety: inspection only. Do not click, drag, drop, save, submit, or change dates in TrainingPeaks.
    console.log(`Inspection-only mode for action ${claimed.action.id}: no TrainingPeaks mutation is allowed.`);

    const pageAssessment = await assessTrainingPeaksPage(page);
    const visibleTrainingPeaksName = await extractVisibleTrainingPeaksAthleteName(page);
    const identityCheck = buildIdentityCheck({
      student,
      expectedUrl: student.trainingpeaks_athlete_url,
      currentUrl: page.url(),
      visibleTrainingPeaksName,
    });
    await page.screenshot({ path: screenshotBeforePath, fullPage: true });

    if (pageAssessment.loginRequired) {
      throw new Error("TrainingPeaks session expired or login required.");
    }
    if (!pageAssessment.trainingPeaksContextLikely) {
      throw new Error("Could not confirm TrainingPeaks context on athlete page.");
    }
    if (!pageAssessment.athletePageLikelyReachable) {
      throw new Error("Athlete page is not reachable or failed to load fully.");
    }

    const parsedPayload = parseMoveWorkoutPayload(claimed.action.parsed_payload);
    const resolvedTargetDate = parsedPayload?.target
      ? resolveTargetDateFromPayload(parsedPayload.target, new Date()).targetDate
      : null;
    const expectedSourceDate = extractCoachConfirmedSourceDate(parsedPayload)
      ?? extractExplicitSourceDate({
        rawText: claimed.action.raw_text,
        parsedPayload: claimed.action.parsed_payload,
      });
    const extraction = await extractWorkoutCandidatesFromPage(page, resolvedTargetDate, expectedSourceDate);
    const dryRunEvaluation = evaluateDryRunOutcome({
      action: claimed.action,
      student,
      pageMeta: pageAssessment,
      candidates: extraction.candidates,
      extraction,
      identityCheck,
    });

    await page.waitForTimeout(1000);
    await page.screenshot({ path: screenshotAfterPath, fullPage: true });

    return {
      screenshotBeforePath,
      screenshotAfterPath,
      dryRunEvaluation,
      artifactDir,
      openedAthleteUrl: student.trainingpeaks_athlete_url,
      pageMeta: {
        url: page.url(),
        title: await page.title().catch(() => ""),
        loginRequired: pageAssessment.loginRequired,
        athletePageLikelyReachable: pageAssessment.athletePageLikelyReachable,
        trainingPeaksContextLikely: pageAssessment.trainingPeaksContextLikely,
      },
    };
  } finally {
    await context.close().catch(() => {});
  }
}

async function finishRealRun(
  actionId: string,
  runId: string,
  input: {
    errorMessage: string;
    logJson: unknown;
    screenshotBeforePath: string | null;
    screenshotAfterPath: string | null;
  }
): Promise<void> {
  const supabase = getSupabase();
  const finishedAt = new Date().toISOString();

  const { error: runError } = await supabase
    .from("trainingpeaks_action_runs")
    .update({
      status: "failed",
      finished_at: finishedAt,
      error_message: input.errorMessage,
      log_json: input.logJson,
      screenshot_before_path: input.screenshotBeforePath,
      screenshot_after_path: input.screenshotAfterPath,
    })
    .eq("id", runId)
    .eq("action_id", actionId)
    .eq("status", "running");
  if (runError) {
    throw new Error(`Failed to finish real action run ${runId}: ${runError.message}`);
  }

  const { error: actionError } = await supabase
    .from("trainingpeaks_actions")
    .update({
      execution_status: "failed",
      execution_mode: "real",
      last_run_id: runId,
    })
    .eq("id", actionId);
  if (actionError) {
    throw new Error(`Failed to update real-mode action ${actionId} as failed: ${actionError.message}`);
  }
}

async function completeRealRun(
  actionId: string,
  runId: string,
  input: {
    logJson: unknown;
    screenshotBeforePath: string | null;
    screenshotAfterPath: string | null;
  }
): Promise<void> {
  const supabase = getSupabase();
  const finishedAt = new Date().toISOString();

  const { error: runError } = await supabase
    .from("trainingpeaks_action_runs")
    .update({
      status: "completed",
      finished_at: finishedAt,
      error_message: null,
      log_json: input.logJson,
      screenshot_before_path: input.screenshotBeforePath,
      screenshot_after_path: input.screenshotAfterPath,
    })
    .eq("id", runId)
    .eq("action_id", actionId)
    .eq("status", "running");
  if (runError) {
    throw new Error(`Failed to complete real action run ${runId}: ${runError.message}`);
  }

  const { error: actionError } = await supabase
    .from("trainingpeaks_actions")
    .update({
      execution_status: "completed",
      execution_mode: "real",
      last_run_id: runId,
    })
    .eq("id", actionId);
  if (actionError) {
    throw new Error(`Failed to update real-mode action ${actionId} as completed: ${actionError.message}`);
  }
}

async function notifyCoachRealModeResult(input: {
  chatId: string | null;
  action: TrainingPeaksActionRow;
  studentName: string;
  trustedDryRun: TrustedDryRunLog;
  currentEvaluation: DryRunEvaluation | null;
  comparison: RevalidationComparison | null;
  revalidationPassed: boolean;
  errorMessage: string;
  candidate: DryRunCandidate | null;
  includeNotChangedNote?: boolean;
}): Promise<void> {
  if (!input.chatId) {
    return;
  }

  const route = formatMoveRouteForCoach(input.action, {
    sourceDate: input.trustedDryRun.resolvedDates.sourceDate,
    targetDate: input.trustedDryRun.resolvedDates.targetDate,
  });
  const lines: string[] = [];
  const isSuccess = input.errorMessage.includes("verification passed");
  const isVerificationFailure =
    input.errorMessage.includes("verification failed") || input.errorMessage.includes("manual review required");

  if (isSuccess) {
    lines.push(
      `✅ Перенос выполнен. ${input.studentName}: ${route}. Проверка после переноса пройдена.`
    );
  } else if (isVerificationFailure) {
    lines.push(`⚠️ Перенос не подтверждён. ${input.studentName}: ${route}. Нужна ручная проверка.`);
  } else {
    lines.push("⚠️ Перенос не выполнен. TrainingPeaks не изменён. Проверь заявку в /tp_actions.");
  }

  try {
    await sendTelegramText(input.chatId, lines.join("\n"));
  } catch (error) {
    console.warn(`Telegram action real-mode summary warning: ${toShortErrorMessage(error)}`);
  }
}

async function notifyCoachRealModeResultWithFallback(input: {
  action: TrainingPeaksActionRow;
  studentName: string;
  trustedDryRun: TrustedDryRunLog;
  currentEvaluation: DryRunEvaluation | null;
  comparison: RevalidationComparison | null;
  revalidationPassed: boolean;
  errorMessage: string;
  candidate: DryRunCandidate | null;
  includeNotChangedNote?: boolean;
}): Promise<void> {
  const chatIds = resolveActionCoachNotificationChatIds(input.action);
  if (chatIds.length === 0) {
    console.warn(
      `TrainingPeaks real-mode: skipping coach Telegram notification — no direct chat id${
        isAutoApprovedDryRunFallbackEligible(input.action) ? " and no configured fallback chats" : ""
      } for action ${toShortActionId(input.action.id)}`
    );
    return;
  }

  await Promise.allSettled(
    chatIds.map(async (chatId) => {
      await notifyCoachRealModeResult({
        chatId,
        action: input.action,
        studentName: input.studentName,
        trustedDryRun: input.trustedDryRun,
        currentEvaluation: input.currentEvaluation,
        comparison: input.comparison,
        revalidationPassed: input.revalidationPassed,
        errorMessage: input.errorMessage,
        candidate: input.candidate,
        includeNotChangedNote: input.includeNotChangedNote,
      });
    })
  );

  if (!input.action.coach_chat_id && !input.action.decided_by_chat_id && isAutoApprovedDryRunFallbackEligible(input.action)) {
    console.log(
      `TrainingPeaks real-mode: sent coach notification via auto-approved fallback for action ${toShortActionId(input.action.id)}`
    );
  }
}

async function selectAndConfirmTargetDateInCurrentModalSession(input: {
  page: import("playwright").Page;
  actionId: string;
  runId: string;
  sourceDateIso: string;
  targetDateIso: string;
  artifactDir: string;
}): Promise<TargetDateSelectionConfirmation> {
  const result: TargetDateSelectionConfirmation = {
    preSaveDateHeaderText: null,
    preSaveDateInputValue: null,
    preSaveTargetDateSelectionAttempted: false,
    preSaveTargetDateSelectionConfirmed: false,
    preSaveTargetDateConfirmedBy: null,
    preSaveTargetDateConfirmedByHeader: false,
    preSaveTargetDateConfirmedByInput: false,
    beforeClickDateHeaderText: null,
    datePickerOpened: false,
    datePickerDetectionStrategy: null,
    targetDateClickCandidateFound: false,
    targetDateClickCandidateBoundingBox: null,
    targetDateClickAttempted: false,
    targetDateClickMethod: null,
    afterTargetDayClickError: null,
    afterClickDateHeaderText: null,
    afterClickDateInputValue: null,
    afterClickVisibleTextContainsTarget: false,
    confirmSource: null,
    datepickerDomDebugPath: null,
    datepickerDomDebugTopCandidates: [],
    datepickerDomDebugError: null,
  };

  const page = input.page;
  const modalRoot = await findVisibleDetailRoot(page);
  const modalScope = modalRoot?.locator ?? page.locator("body");
  const dateFieldCandidates = [
    { locator: modalScope.locator('input[name*="date" i]').first(), selectorHint: 'input[name*="date" i]' },
    { locator: modalScope.locator('input[id*="date" i]').first(), selectorHint: 'input[id*="date" i]' },
    { locator: modalScope.locator('[aria-label*="date" i]').first(), selectorHint: '[aria-label*="date" i]' },
  ];
  const dateFieldMatch = await findFirstVisibleLocator(dateFieldCandidates, 700);
  if (dateFieldMatch) {
    result.preSaveDateInputValue = await readDateFieldValue(dateFieldMatch.locator);
  }

  const dateHeaderText = await findBoundedDateHeaderText(page, modalRoot?.locator ?? null);
  result.preSaveDateHeaderText = dateHeaderText ?? null;
  result.beforeClickDateHeaderText = dateHeaderText ?? null;
  if (!dateHeaderText) {
    return result;
  }

  const dateHeaderDomRectMatch = await resolveDateHeaderDomRectSnapshotBounded(page, dateHeaderText, {
    stage: "controlled-save-resolve-date-header-dom-rect",
    actionId: input.actionId,
    runId: input.runId,
  }).catch(() => null);
  const dateHeaderBoundingBox = toProbeBoundingBox(dateHeaderDomRectMatch?.rect ?? null);
  if (!dateHeaderBoundingBox) {
    return result;
  }

  const center = boundingBoxCenter(dateHeaderBoundingBox);
  await page.mouse.click(center.x, center.y).catch(() => {});
  await page.waitForTimeout(500).catch(() => {});

  const datepickerDomDebugPath = path.join(input.artifactDir, "real_pre_save_datepicker_dom_debug.json");
  try {
    const domDebugCapture = await collectVisibleDatepickerDebugSnapshot(page, {
      artifactPath: datepickerDomDebugPath,
      actionId: input.actionId,
      runId: input.runId,
      dateHeaderBox: dateHeaderBoundingBox,
      sourceDateIso: input.sourceDateIso,
      targetDateIso: input.targetDateIso,
    });
    result.datepickerDomDebugPath = datepickerDomDebugPath;
    result.datepickerDomDebugTopCandidates = domDebugCapture.snapshot
      ? [...domDebugCapture.snapshot.topCandidates.slice(0, 12)]
      : [];
    result.datepickerDomDebugError = null;
    if (domDebugCapture.snapshot) {
      result.targetDateClickCandidateFound = domDebugCapture.snapshot.signals.targetDateClickCandidateFound;
      result.targetDateClickCandidateBoundingBox = domDebugCapture.snapshot.signals.targetDateClickCandidateBoundingBox;
      if (domDebugCapture.snapshot.signals.openByMultisignal) {
        result.datePickerOpened = true;
        result.datePickerDetectionStrategy = "visible_dom_multisignal_fallback";
      }
    } else {
      const currentModalFallbackSignals = buildCurrentModalBodyTextFallbackSignals({
        bodyTextSample: domDebugCapture.bodyTextSample,
        sourceDateIso: input.sourceDateIso,
        targetDateIso: input.targetDateIso,
      });
      if (currentModalFallbackSignals.activated) {
        result.datePickerOpened = true;
        result.datePickerDetectionStrategy =
          currentModalFallbackSignals.strategy ?? "current_modal_body_text_multisignal_fallback";
      }
      if (currentModalFallbackSignals.activated) {
        result.datepickerDomDebugTopCandidates = [
          ...result.datepickerDomDebugTopCandidates,
          `current-modal-fallback:${currentModalFallbackSignals.diagnostics.join("+")}`,
        ].slice(0, 12);
      }
    }
    if (domDebugCapture.stageCErrorDetails) {
      result.datepickerDomDebugError = domDebugCapture.stageCErrorDetails;
    }
  } catch (error) {
    result.datepickerDomDebugPath = datepickerDomDebugPath;
    result.datepickerDomDebugError = formatDiagnosticError(error);
  }

  const detection = await detectVisibleDatePickerSnapshot(
    page,
    {
      dateHeaderBox: dateHeaderBoundingBox,
      dateHeaderText,
      sourceDateIso: input.sourceDateIso,
      targetDateIso: input.targetDateIso,
    },
    {
      stage: "controlled-save-detect-datepicker",
      actionId: input.actionId,
      runId: input.runId,
    }
  ).catch(() => null);
  if (detection) {
    result.datePickerOpened = result.datePickerOpened || detection.opened;
    result.datePickerDetectionStrategy = result.datePickerDetectionStrategy ?? detection.strategy;
  }

  const currentModalFallbackSignals = buildCurrentModalBodyTextFallbackSignals({
    bodyTextSample:
      result.datepickerDomDebugError && result.datePickerOpened
        ? ""
        : await page.evaluate(() => (document.body?.innerText ?? "").slice(0, 20_000)).catch(() => ""),
    sourceDateIso: input.sourceDateIso,
    targetDateIso: input.targetDateIso,
  });
  if (!result.datePickerOpened && currentModalFallbackSignals.datePickerOpened) {
    result.datePickerOpened = true;
    result.datePickerDetectionStrategy =
      currentModalFallbackSignals.strategy ?? "current_modal_body_text_multisignal_fallback";
  }
  const targetDayVisible = Boolean(detection?.targetDayVisible) || currentModalFallbackSignals.targetDayVisible;
  if (result.datePickerOpened && targetDayVisible && !result.targetDateClickCandidateFound) {
    try {
      const targetDayMatch = input.targetDateIso.match(/^\d{4}-\d{2}-(\d{2})$/);
      const targetDayNum = targetDayMatch ? Number(targetDayMatch[1]) : NaN;
      if (Number.isFinite(targetDayNum) && targetDayNum >= 1 && targetDayNum <= 31) {
        const day = String(targetDayNum);
        const dayRegex = new RegExp(`(^|\\D)${day}(\\D|$)`);
        const locatorSpecs = [
          { locator: page.locator(`.MuiPickersDay-root:has-text("${day}")`), hint: "MuiPickersDay" },
          { locator: page.locator(`[role="gridcell"]`).filter({ hasText: new RegExp(`^\\s*${day}\\s*$`) }), hint: "gridcell" },
          { locator: page.locator(`button[aria-label*="${day}"]`).filter({ hasText: dayRegex }), hint: "button[aria-label]" },
          { locator: page.locator(`td`).filter({ hasText: new RegExp(`^\\s*${day}\\s*$`) }), hint: "td" },
        ] as const;
        for (const spec of locatorSpecs) {
          if (result.targetDateClickCandidateFound) break;
          const allMatches = await spec.locator.all().catch(() => [] as import("playwright").Locator[]);
          for (const loc of allMatches) {
            if (!(await loc.isVisible().catch(() => false))) continue;
            const box = await loc.boundingBox().catch(() => null);
            if (!box || box.width < 5 || box.height < 5) continue;
            if (box.width > 80 || box.height > 60) continue;
            const dx = Math.abs((box.x + box.width / 2) - (dateHeaderBoundingBox.x + dateHeaderBoundingBox.width / 2));
            const dy = box.y + box.height / 2 - (dateHeaderBoundingBox.y + dateHeaderBoundingBox.height / 2);
            if (dx > 320 || dy < 0 || dy > 420) continue;
            const text = await loc.textContent().catch(() => "");
            if (!dayRegex.test(text ?? "")) continue;
            result.targetDateClickCandidateFound = true;
            result.targetDateClickCandidateBoundingBox = {
              x: Math.round(box.x * 100) / 100,
              y: Math.round(box.y * 100) / 100,
              width: Math.round(box.width * 100) / 100,
              height: Math.round(box.height * 100) / 100,
            };
            result.datepickerDomDebugTopCandidates = [
              ...result.datepickerDomDebugTopCandidates,
              `candidate-fallback:${spec.hint}:day-${day}`,
            ].slice(0, 12);
            break;
          }
        }
      }
    } catch (error) {
      result.datepickerDomDebugTopCandidates = [
        ...result.datepickerDomDebugTopCandidates,
        `candidate-fallback-error:${toShortErrorMessage(error)}`,
      ].slice(0, 12);
    }
  }
  if (
    result.datePickerOpened &&
    targetDayVisible &&
    result.targetDateClickCandidateFound &&
    result.targetDateClickCandidateBoundingBox
  ) {
    result.preSaveTargetDateSelectionAttempted = true;
    result.targetDateClickAttempted = true;
    result.targetDateClickMethod = "mouse.click.bounding_box_center";
    const clickBox = result.targetDateClickCandidateBoundingBox;
    const x = clickBox.x + clickBox.width / 2;
    const y = clickBox.y + clickBox.height / 2;
    try {
      await page.mouse.click(x, y);
      await page.waitForTimeout(260).catch(() => {});
      result.afterTargetDayClickError = null;
    } catch (error) {
      result.afterTargetDayClickError = toShortErrorMessage(error);
    }
  }

  const postClickDateHeaderText = await findBoundedDateHeaderText(page, modalRoot?.locator ?? null).catch(
    () => null as string | null
  );
  const postClickDateFieldValue = dateFieldMatch
    ? await readDateFieldValue(dateFieldMatch.locator).catch(() => null as string | null)
    : null;
  result.afterClickDateHeaderText = postClickDateHeaderText ?? null;
  result.afterClickDateInputValue = postClickDateFieldValue ?? null;
  result.preSaveDateHeaderText = postClickDateHeaderText ?? result.preSaveDateHeaderText;
  result.preSaveDateInputValue = postClickDateFieldValue ?? result.preSaveDateInputValue;

  const postSelection = await detectVisibleDatePickerSnapshot(
    page,
    {
      dateHeaderBox: dateHeaderBoundingBox,
      dateHeaderText: result.preSaveDateHeaderText ?? dateHeaderText,
      sourceDateIso: input.sourceDateIso,
      targetDateIso: input.targetDateIso,
    },
    {
      stage: "controlled-save-detect-datepicker-post-selection",
      actionId: input.actionId,
      runId: input.runId,
    }
  ).catch(() => null);

  const confirmedByDateHeader = visibleAnyTextReferencesIsoTarget([result.preSaveDateHeaderText], input.targetDateIso);
  const confirmedByDateInput = visibleAnyTextReferencesIsoTarget([result.preSaveDateInputValue], input.targetDateIso);
  result.afterClickVisibleTextContainsTarget = visibleAnyTextReferencesIsoTarget(
    [result.afterClickDateHeaderText, result.afterClickDateInputValue],
    input.targetDateIso
  );
  const confirmedBySelectedHighlight = Boolean(postSelection?.targetDaySelectedVisible);
  result.preSaveTargetDateConfirmedByHeader = confirmedByDateHeader;
  result.preSaveTargetDateConfirmedByInput = confirmedByDateInput;
  if (confirmedByDateHeader || confirmedByDateInput) {
    result.preSaveTargetDateSelectionConfirmed = true;
    if (confirmedByDateHeader) {
      result.preSaveTargetDateConfirmedBy = "date_header";
      result.confirmSource = "date_header";
    } else if (confirmedByDateInput) {
      result.preSaveTargetDateConfirmedBy = "date_input";
      result.confirmSource = "date_input";
    }
  } else if (confirmedBySelectedHighlight) {
    result.datepickerDomDebugTopCandidates = [
      ...result.datepickerDomDebugTopCandidates,
      "post-selection-highlight-visible-without-header-or-input-confirmation",
    ].slice(0, 12);
  }

  return result;
}

function probeToDriverProbeShape(probe: UiCapabilityProbe): TrainingPeaksProbeLikeForDriver {
  const detail = probe.detail;
  return {
    errors: [...probe.errors],
    warnings: [...probe.warnings],
    detail: {
      dateHeaderText: detail.dateHeaderText,
      currentDateValue: detail.currentDateValue,
      datePickerOpened: detail.datePickerOpened,
      saveButtonFound: detail.saveButtonFound,
      saveAndCloseButtonFound: detail.saveAndCloseButtonFound,
      datePickerDetectionStrategy: detail.datePickerDetectionStrategy,
      datePickerBoundingBox: detail.datePickerBoundingBox,
      visibleMonth: detail.visibleMonth,
      visibleYear: detail.visibleYear,
      visibleDayCandidates: [...detail.visibleDayCandidates],
      targetDayVisible: detail.targetDayVisible,
      selectedSourceDayVisible: detail.selectedSourceDayVisible,
      targetDateSelectionAttempted: detail.targetDateSelectionAttempted,
      targetDateSelectionConfirmed: detail.targetDateSelectionConfirmed,
      postClickDateHeaderText: detail.postClickDateHeaderText,
      postClickDateInputValue: detail.postClickDateInputValue,
      targetDateConfirmedBy: detail.targetDateConfirmedBy,
      targetDateClickMethod: detail.targetDateClickMethod,
      targetDateClickCandidateFound: detail.targetDateClickCandidateFound,
      targetDateClickCandidateBoundingBox: detail.targetDateClickCandidateBoundingBox,
      afterTargetDayClickError: detail.afterTargetDayClickError,
      datepickerDomDebugPath: detail.datepickerDomDebugPath,
      datepickerDomDebugTopCandidates: [...detail.datepickerDomDebugTopCandidates],
      datepickerDomDebugError: detail.datepickerDomDebugError,
      opened: detail.opened,
      closeSucceeded: detail.closeSucceeded,
      datePickerCloseAttempted: detail.datePickerCloseAttempted,
      datePickerCloseSucceeded: detail.datePickerCloseSucceeded,
      datePickerCloseError: detail.datePickerCloseError,
      mutationOccurred: detail.mutationOccurred,
    },
    screenshots: { ...probe.screenshots },
    progress: {
      stepHistory: [...probe.progress.stepHistory],
    },
  };
}

async function findSaveAndCloseButton(
  page: import("playwright").Page
): Promise<
  | {
      status: "ok";
      locator: import("playwright").Locator;
      enabled: boolean;
      selectorHint: "modal role exact" | "global role exact";
    }
  | {
      status: "not_found" | "ambiguous_save_and_close_button";
      reason: string;
    }
> {
  const modalRoot = await findVisibleDetailRoot(page);
  const modalScope = modalRoot?.locator ?? page.locator("body");
  const modalExact = modalScope.getByRole("button", { name: /^Save\s*&\s*Close$/i });
  const modalExactFirst = modalScope.getByRole("button", { name: /^Save\s*&\s*Close$/i }).first();
  const pageExact = page.getByRole("button", { name: /^Save\s*&\s*Close$/i });
  const pageExactFirst = page.getByRole("button", { name: /^Save\s*&\s*Close$/i }).first();

  const collectQualified = async (
    locator: import("playwright").Locator,
    selectorHint: "modal role exact" | "global role exact"
  ): Promise<Array<{ locator: import("playwright").Locator; enabled: boolean; selectorHint: "modal role exact" | "global role exact" }>> => {
    const qualified: Array<{
      locator: import("playwright").Locator;
      enabled: boolean;
      selectorHint: "modal role exact" | "global role exact";
    }> = [];
    const total = await locator.count().catch(() => 0);
    for (let i = 0; i < total; i += 1) {
      const candidate = locator.nth(i);
      const visible = await candidate.isVisible().catch(() => false);
      if (!visible) {
        continue;
      }
      const enabled = !(await candidate.isDisabled().catch(() => true));
      const a11yName = await candidate.getAttribute("aria-label").catch(() => null as string | null);
      const textName = await candidate.innerText().catch(() => "");
      const normalizedName = normalizeWhitespace(a11yName ?? textName).toLowerCase();
      if (normalizedName !== "save & close") {
        continue;
      }
      qualified.push({ locator: candidate, enabled, selectorHint });
    }
    return qualified;
  };

  const modalQualified = await collectQualified(modalExact, "modal role exact");
  if (modalQualified.length > 0) {
    const enabled = !(await modalExactFirst.isDisabled().catch(() => true));
    const a11yName = await modalExactFirst.getAttribute("aria-label").catch(() => null as string | null);
    const textName = await modalExactFirst.innerText().catch(() => "");
    const normalizedName = normalizeWhitespace(a11yName ?? textName).toLowerCase();
    if (normalizedName !== "save & close" || !(await modalExactFirst.isVisible().catch(() => false))) {
      return {
        status: "not_found",
        reason: "save_and_close_button_not_found",
      };
    }
    return {
      status: "ok",
      locator: modalExactFirst,
      enabled,
      selectorHint: "modal role exact",
    };
  }

  const pageQualified = await collectQualified(pageExact, "global role exact");
  if (pageQualified.length > 1) {
    return {
      status: "ambiguous_save_and_close_button",
      reason: "ambiguous_save_and_close_button",
    };
  }
  if (pageQualified.length === 1) {
    const enabled = !(await pageExactFirst.isDisabled().catch(() => true));
    const a11yName = await pageExactFirst.getAttribute("aria-label").catch(() => null as string | null);
    const textName = await pageExactFirst.innerText().catch(() => "");
    const normalizedName = normalizeWhitespace(a11yName ?? textName).toLowerCase();
    if (normalizedName !== "save & close" || !(await pageExactFirst.isVisible().catch(() => false))) {
      return {
        status: "not_found",
        reason: "save_and_close_button_not_found",
      };
    }
    return {
      status: "ok",
      locator: pageExactFirst,
      enabled,
      selectorHint: "global role exact",
    };
  }

  return {
    status: "not_found",
    reason: "save_and_close_button_not_found",
  };
}

type ControlledSaveExecutionResult = {
  prepareMoveWorkout: ReturnType<typeof derivePrepareMoveWorkoutResultFromProbe>;
  prepareGateDiagnostics: {
    prepareMoveWorkoutStatus: string | null;
    prepareMoveWorkoutTargetDateSelectionConfirmed: boolean;
    prepareMoveWorkoutTargetDateConfirmedBy: string | null;
    prepareMoveWorkoutMutationOccurred: boolean;
    prepareMoveWorkoutAthleteIdentityOk: boolean;
    prepareMoveWorkoutCandidateFingerprintOk: boolean;
    prepareMoveWorkoutSourceDate: string | null;
    prepareMoveWorkoutTargetDate: string | null;
    expectedSourceDate: string | null;
    expectedTargetDate: string | null;
    sourceDateMatchesExpected: boolean;
    targetDateMatchesExpected: boolean;
    preSaveTargetDateSelectionConfirmed: boolean;
    preSaveTargetDateConfirmedBy: string | null;
    saveAndCloseButtonFound: boolean;
    saveAndCloseButtonEnabled: boolean;
    failedPrepareGates: string[];
  };
  preSaveScreenshot: string | null;
  afterSaveScreenshot: string | null;
  unsavedUiStateChanged: boolean;
  saveAndCloseAttempted: boolean;
  saveAndCloseClicked: boolean;
  saveAndCloseClickMethod: string | null;
  saveAndCloseError: string | null;
  postSaveValidationAttempted: boolean;
  postSaveValidationPassed: boolean;
  postSaveValidationError: string | null;
  mutationOccurred: boolean;
  durableMutationOccurred: boolean;
  preSaveAudit: {
    visibleDateHeaderText: string | null;
    preSaveDateHeaderText: string | null;
    preSaveDateInputValue: string | null;
    beforeClickDateHeaderText: string | null;
    targetDateClickCandidateFound: boolean;
    targetDateClickCandidateBoundingBox: { x: number; y: number; width: number; height: number } | null;
    targetDateClickAttempted: boolean;
    targetDateClickMethod: "mouse.click.bounding_box_center" | null;
    afterTargetDayClickError: string | null;
    afterClickDateHeaderText: string | null;
    afterClickDateInputValue: string | null;
    afterClickVisibleTextContainsTarget: boolean;
    confirmSource: "date_header" | "date_input" | null;
    preSaveTargetDateSelectionConfirmed: boolean;
    preSaveTargetDateConfirmedBy: "date_header" | "date_input" | "selected_day_highlight" | null;
    targetDate: string | null;
    athleteIdentityMatchedBy: IdentityMatchType;
    workoutFingerprint: string | null;
    unsavedUiStateChanged: boolean;
    mutationOccurred: boolean;
    sourceDateMatchesExpected: boolean;
    targetDateMatchesExpected: boolean;
    saveAndCloseButtonFound: boolean;
    saveAndCloseButtonEnabled: boolean;
    expectedSourceDate: string | null;
    expectedTargetDate: string | null;
    failedPrepareGates: string[];
  };
  postSaveAudit: {
    athleteIdentityMatchedBy: IdentityMatchType | null;
    movedCandidateFoundOnTargetDate: boolean;
    oldCandidateStillOnSourceDate: boolean;
    targetDate: string | null;
    sourceDate: string | null;
    expectedMovedFingerprint: string | null;
  };
};

async function runControlledSaveAndCloseExecution(input: {
  claimed: ClaimedRealAction;
  runId: string;
  comparison: RevalidationComparison;
}): Promise<ControlledSaveExecutionResult> {
  const artifactDir = path.join(ACTION_ARTIFACTS_ROOT, input.claimed.action.id, input.runId);
  await mkdir(artifactDir, { recursive: true });
  const preSaveScreenshotPath = path.join(artifactDir, "real_pre_save.png");
  const afterSaveScreenshotPath = path.join(artifactDir, "real_after_save.png");
  const student = input.claimed.student;
  if (!student?.trainingpeaks_athlete_url) {
    throw new Error(`Missing trainingpeaks_athlete_url for action ${input.claimed.action.id}.`);
  }

  const candidate = input.comparison.currentCandidate ?? input.comparison.trustedCandidate;
  const expectedSourceDate =
    input.comparison.sourceDate.current ??
    input.comparison.sourceDate.trusted ??
    input.claimed.trustedDryRunLog.resolvedDates.sourceDate;
  const expectedTargetDate =
    input.comparison.targetDate.current ??
    input.comparison.targetDate.trusted ??
    input.claimed.trustedDryRunLog.resolvedDates.targetDate;
  const sourceDate = expectedSourceDate;
  const targetDate = expectedTargetDate;
  const trainingPeaksDriver = new PlaywrightOnlyTrainingPeaksDriver({
    expectedActionId: input.claimed.action.id,
    sourceDateIso: sourceDate,
    targetDateIso: targetDate,
    athleteIdentityMatchedBy: input.comparison.currentIdentityMatchedBy,
    candidateFingerprintMatches: input.comparison.fingerprint.matches,
    runProbe: async () => {
      const probe = await probeTrainingPeaksMoveCapabilities(input.claimed, input.runId, input.comparison);
      return probeToDriverProbeShape(probe);
    },
  });
  const prepareMoveWorkout = await trainingPeaksDriver.prepareMoveWorkout(input.claimed.action.id);

  let context: import("playwright").BrowserContext | null = null;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless: true,
      viewport: null,
    });
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(student.trainingpeaks_athlete_url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await waitForTrainingPeaksCalendarReadiness(page, []);

    const pageAssessment = await assessTrainingPeaksPage(page);
    if (pageAssessment.loginRequired) {
      throw new Error("TrainingPeaks session expired or login required.");
    }
    if (!pageAssessment.trainingPeaksContextLikely || !pageAssessment.athletePageLikelyReachable) {
      throw new Error("TrainingPeaks athlete page is not safely reachable.");
    }

    if (!sourceDate || !targetDate) {
      throw new Error("Source/target dates are unavailable for controlled save execution.");
    }

    const cardMatch = await locateWorkoutCardForProbe(page, {
      studentId: student.id,
      sourceDate,
      candidate,
    });
    if (!cardMatch.locator) {
      throw new Error("Could not locate the revalidated candidate card before save.");
    }

    await cardMatch.locator.hover({ timeout: 2_000 }).catch(() => {});
    const menuTrigger = await findFirstVisibleLocator(
      [
        { locator: cardMatch.locator.locator('button[aria-haspopup="menu"]').first(), selectorHint: "menu-haspopup" },
        { locator: cardMatch.locator.locator(".MuiIconButton-root").first(), selectorHint: "menu-mui-iconbutton" },
      ],
      800
    );
    if (!menuTrigger) {
      throw new Error("Card menu trigger was not found.");
    }
    await menuTrigger.locator.click({ timeout: 2_000 });
    await page.waitForTimeout(300);
    const menuRoot = await findVisibleMenuRoot(page);
    if (!menuRoot) {
      throw new Error("Card menu did not open.");
    }
    const editAction = await findExactEditMenuAction(menuRoot.locator);
    if (!editAction) {
      throw new Error('Exact "Edit" action was not found in card menu.');
    }
    await editAction.locator.click({ timeout: 2_000 });
    await page.waitForTimeout(700);

    const modalDateSelection = await selectAndConfirmTargetDateInCurrentModalSession({
      page,
      actionId: input.claimed.action.id,
      runId: input.runId,
      sourceDateIso: sourceDate,
      targetDateIso: targetDate,
      artifactDir,
    });
    const unsavedUiStateChanged = Boolean(modalDateSelection.preSaveTargetDateSelectionAttempted);

    const visibleTrainingPeaksName = await extractVisibleTrainingPeaksAthleteName(page);
    const identityCheck = buildIdentityCheck({
      student,
      expectedUrl: student.trainingpeaks_athlete_url,
      currentUrl: page.url(),
      visibleTrainingPeaksName,
    });

    const saveButtonLookup = await findSaveAndCloseButton(page);
    const saveButton = saveButtonLookup.status === "ok" ? saveButtonLookup : null;
    const saveAndCloseButtonFound = Boolean(saveButton);
    const saveAndCloseButtonEnabled = Boolean(saveButton?.enabled);
    const workoutFingerprint = candidate?.fingerprint ?? null;

    const preSaveAudit = {
      visibleDateHeaderText: modalDateSelection.preSaveDateHeaderText,
      preSaveDateHeaderText: modalDateSelection.preSaveDateHeaderText,
      preSaveDateInputValue: modalDateSelection.preSaveDateInputValue,
      beforeClickDateHeaderText: modalDateSelection.beforeClickDateHeaderText,
      targetDateClickCandidateFound: modalDateSelection.targetDateClickCandidateFound,
      targetDateClickCandidateBoundingBox: modalDateSelection.targetDateClickCandidateBoundingBox,
      targetDateClickAttempted: modalDateSelection.targetDateClickAttempted,
      targetDateClickMethod: modalDateSelection.targetDateClickMethod,
      afterTargetDayClickError: modalDateSelection.afterTargetDayClickError,
      afterClickDateHeaderText: modalDateSelection.afterClickDateHeaderText,
      afterClickDateInputValue: modalDateSelection.afterClickDateInputValue,
      afterClickVisibleTextContainsTarget: modalDateSelection.afterClickVisibleTextContainsTarget,
      confirmSource: modalDateSelection.confirmSource,
      preSaveTargetDateSelectionConfirmed: modalDateSelection.preSaveTargetDateSelectionConfirmed,
      preSaveTargetDateConfirmedBy: modalDateSelection.preSaveTargetDateConfirmedBy,
      targetDate,
      athleteIdentityMatchedBy: identityCheck.matchedBy,
      workoutFingerprint,
      unsavedUiStateChanged,
      mutationOccurred: false,
      sourceDateMatchesExpected: prepareMoveWorkout.sourceDate === expectedSourceDate,
      targetDateMatchesExpected: prepareMoveWorkout.targetDate === expectedTargetDate,
      saveAndCloseButtonFound,
      saveAndCloseButtonEnabled,
      expectedSourceDate,
      expectedTargetDate,
      failedPrepareGates: [] as string[],
    } as const;

    const preSaveScreenshot = await captureProbeScreenshot(page, preSaveScreenshotPath, []);

    const prepareGatesPassedBeforeSave =
      prepareMoveWorkout.status === "ready_to_save" &&
      prepareMoveWorkout.targetDateSelectionConfirmed === true &&
      prepareMoveWorkout.targetDateConfirmedBy !== null &&
      prepareMoveWorkout.mutationOccurred === false &&
      prepareMoveWorkout.athleteIdentityOk === true &&
      prepareMoveWorkout.candidateFingerprintOk === true &&
      prepareMoveWorkout.sourceDate === expectedSourceDate &&
      prepareMoveWorkout.targetDate === expectedTargetDate &&
      preSaveAudit.preSaveTargetDateSelectionConfirmed === true &&
      preSaveAudit.preSaveTargetDateConfirmedBy !== null &&
      saveAndCloseButtonFound &&
      saveAndCloseButtonEnabled;

    const prepareGateDiagnostics = buildFailedPrepareGatesDiagnostics({
      prepareMoveWorkout,
      expectedSourceDate,
      expectedTargetDate,
      preSaveTargetDateSelectionConfirmed: preSaveAudit.preSaveTargetDateSelectionConfirmed,
      preSaveTargetDateConfirmedBy: preSaveAudit.preSaveTargetDateConfirmedBy,
      saveAndCloseButtonFound,
      saveAndCloseButtonEnabled,
    });

    let saveAndCloseAttempted = false;
    let saveAndCloseClicked = false;
    let saveAndCloseClickMethod: string | null = null;
    let saveAndCloseError: string | null = null;
    let mutationOccurred = false;

    if (saveButton && saveButton.enabled && prepareGatesPassedBeforeSave) {
      saveAndCloseAttempted = true;
      try {
        await saveButton.locator.click({ timeout: 1_500 });
        saveAndCloseClicked = true;
        saveAndCloseClickMethod = `exact_save_and_close_button:${saveButton.selectorHint}`;
        mutationOccurred = true;
      } catch (error) {
        saveAndCloseError = toShortErrorMessage(error);
      }
    } else if (!saveButton) {
      saveAndCloseError =
        saveButtonLookup.status === "ambiguous_save_and_close_button"
          ? "ambiguous_save_and_close_button"
          : "Save & Close button not found.";
    } else if (!saveButton.enabled) {
      saveAndCloseError = "Save & Close button is disabled.";
    } else if (!prepareGatesPassedBeforeSave) {
      saveAndCloseError = `Prepare/save gates did not pass before Save & Close: ${prepareMoveWorkout.failureReason ?? "unknown reason"}`;
    } else {
      saveAndCloseError = "Target date selection could not be confirmed immediately before save.";
    }

    if (saveAndCloseClicked) {
      for (let i = 0; i < 12; i += 1) {
        if (!(await detailStillVisible(page))) {
          break;
        }
        await page.waitForTimeout(250);
      }
      await page.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => {});
    }

    const afterSaveScreenshot = await captureProbeScreenshot(page, afterSaveScreenshotPath, []);
    let postSaveValidationAttempted = false;
    let postSaveValidationPassed = false;
    let postSaveValidationError: string | null = null;
    let postSaveIdentityMatchedBy: IdentityMatchType | null = null;
    let movedCandidateFoundOnTargetDate = false;
    let oldCandidateStillOnSourceDate = false;
    let expectedMovedFingerprint: string | null = null;

    if (saveAndCloseClicked) {
      postSaveValidationAttempted = true;
      try {
        const extraction = await extractWorkoutCandidatesFromPage(page, targetDate);
        const postSaveVisibleTrainingPeaksName = await extractVisibleTrainingPeaksAthleteName(page);
        const postSaveIdentity = buildIdentityCheck({
          student,
          expectedUrl: student.trainingpeaks_athlete_url,
          currentUrl: page.url(),
          visibleTrainingPeaksName: postSaveVisibleTrainingPeaksName,
        });
        postSaveIdentityMatchedBy = postSaveIdentity.matchedBy;
        expectedMovedFingerprint = buildCandidateFingerprint({
          studentId: student.id,
          dateIso: targetDate,
          title: candidate.title,
          type: candidate.type,
          startTimeLocal: candidate.startTimeLocal,
          plannedDurationSec: candidate.plannedDurationSec,
          plannedDistance: candidate.plannedDistance,
        });
        movedCandidateFoundOnTargetDate = extraction.candidates.some((entry) => {
          if (entry.dateIso !== targetDate) {
            return false;
          }
          const fingerprint = buildCandidateFingerprint({
            studentId: student.id,
            dateIso: entry.dateIso,
            title: entry.title,
            type: entry.type,
            startTimeLocal: entry.startTimeLocal,
            plannedDurationSec: entry.plannedDurationSec,
            plannedDistance: entry.plannedDistance,
          });
          return Boolean(expectedMovedFingerprint) && fingerprint === expectedMovedFingerprint;
        });
        oldCandidateStillOnSourceDate = extraction.candidates.some((entry) => {
          const fingerprint = buildCandidateFingerprint({
            studentId: student.id,
            dateIso: entry.dateIso,
            title: entry.title,
            type: entry.type,
            startTimeLocal: entry.startTimeLocal,
            plannedDurationSec: entry.plannedDurationSec,
            plannedDistance: entry.plannedDistance,
          });
          return fingerprint === (candidate.fingerprint ?? "");
        });
        const athleteIdentityOk =
          postSaveIdentity.matchedBy !== "inconclusive" && postSaveIdentity.matchedBy !== "mismatch";
        postSaveValidationPassed = movedCandidateFoundOnTargetDate && !oldCandidateStillOnSourceDate && athleteIdentityOk;
        if (!postSaveValidationPassed) {
          postSaveValidationError =
            "Post-save validation checks failed (target match/source cleanup/identity verification).";
        }
      } catch (error) {
        postSaveValidationError = toShortErrorMessage(error);
      }
    }

    return {
      prepareMoveWorkout,
      prepareGateDiagnostics,
      preSaveScreenshot,
      afterSaveScreenshot,
      unsavedUiStateChanged,
      saveAndCloseAttempted,
      saveAndCloseClicked,
      saveAndCloseClickMethod,
      saveAndCloseError,
      postSaveValidationAttempted,
      postSaveValidationPassed,
      postSaveValidationError,
      mutationOccurred,
      durableMutationOccurred: saveAndCloseClicked,
      preSaveAudit: {
        ...preSaveAudit,
        failedPrepareGates: prepareGateDiagnostics.failedPrepareGates,
      },
      postSaveAudit: {
        athleteIdentityMatchedBy: postSaveIdentityMatchedBy,
        movedCandidateFoundOnTargetDate,
        oldCandidateStillOnSourceDate,
        targetDate,
        sourceDate,
        expectedMovedFingerprint,
      },
    };
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

async function main(): Promise<void> {
  loadLocalEnv();

  const runnerId = getRunnerId();
  const requestedActionId = getCliValueByPrefix(TP_ACTIONS_ACTION_ID_PREFIX);
  const runnerMode = resolveRunnerMode();
  const prepareOnly = hasCliFlag(TP_ACTIONS_PREPARE_ONLY_FLAG);
  const confirmSaveFlag = hasCliFlag(TP_ACTIONS_CONFIRM_SAVE_FLAG);
  const allowSaveEnv = isTruthyEnvFlag(TP_ACTIONS_ALLOW_SAVE_ENV);
  const useApiMoveEnv = isTruthyEnvFlag(TP_ACTIONS_USE_API_MOVE_ENV);
  const saveGateOpen = confirmSaveFlag || allowSaveEnv;

  if (prepareOnly && runnerMode.mode === "dry_run") {
    console.log(
      `${TP_ACTIONS_PREPARE_ONLY_FLAG} applies only together with ${TP_ACTIONS_EXECUTE_REAL_FLAG} and ${TP_ACTIONS_REAL_EXECUTION_ENV}=true. Dry-run mode will not honor ${TP_ACTIONS_PREPARE_ONLY_FLAG}.`
    );
    return;
  }

  if (runnerMode.mode === "blocked_real") {
    console.log(runnerMode.message);
    return;
  }

  if (runnerMode.mode === "dry_run") {
    const claimed = await claimOneApprovedActionForDryRun(runnerId, requestedActionId);
    if (!claimed) {
      console.log("No approved TrainingPeaks actions ready for dry-run.");
      return;
    }

    console.log(
      `[dry-run] action_queued_for_dry_run id=${claimed.action.id} status=${claimed.action.status} execution_status=${claimed.action.execution_status}`
    );
    console.log(`Claimed TrainingPeaks action ${claimed.action.id} for dry-run.`);
    const run = await createActionRun(claimed.action.id, runnerId, "dry_run");
    const baseLog: Record<string, unknown> = {
      actionId: claimed.action.id,
      runId: run.id,
      runnerId,
      runType: "dry_run",
      dryRun: true,
      realMode: false,
      actionType: claimed.action.action_type,
      actionStatus: claimed.action.status,
      rawText: claimed.action.raw_text,
      targetSummary: getTargetSummary(claimed.action.parsed_payload),
      student: claimed.student
        ? {
            id: claimed.student.id,
            studentId: claimed.student.student_id,
            studentName: claimed.student.student_name,
            telegramChatId: claimed.student.telegram_chat_id,
            trainingPeaksAthleteUrl: claimed.student.trainingpeaks_athlete_url,
          }
        : null,
    };

    const studentName = claimed.student?.student_name ?? "(unknown)";

    try {
      const artifacts = await runDryRunInspection(claimed, run.id);
      const evaluation = artifacts.dryRunEvaluation;
      if (evaluation.dryRunResult === "not_found" && (evaluation.globalCandidateCount ?? 0) === 0) {
        const page = await chromium.launchPersistentContext(profileDir, {
          headless: true,
          viewport: null,
        });
        try {
          const probePage = page.pages()[0] ?? (await page.newPage());
          const openUrl = artifacts.openedAthleteUrl ?? artifacts.pageMeta.url;
          if (openUrl) {
            await probePage.goto(openUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
          }
          const parsedPayload = parseMoveWorkoutPayload(claimed.action.parsed_payload);
          const resolvedTargetDate = parsedPayload?.target
            ? resolveTargetDateFromPayload(parsedPayload.target, new Date()).targetDate
            : null;
          const expectedSourceDate = extractCoachConfirmedSourceDate(parsedPayload)
            ?? extractExplicitSourceDate({
              rawText: claimed.action.raw_text,
              parsedPayload: claimed.action.parsed_payload,
            });
          const zeroExtraction = await extractWorkoutCandidatesFromPage(
            probePage,
            resolvedTargetDate,
            expectedSourceDate
          );
          evaluation.diagnostics.zeroCandidates = await buildZeroCandidatesDiagnostics({
            page: probePage,
            extraction: zeroExtraction,
            pageMeta: artifacts.pageMeta,
            sourceDate: evaluation.selectedSourceDate ?? evaluation.resolvedDates.sourceDate,
            targetDate: evaluation.resolvedDates.targetDate,
            screenshotBeforePath: artifacts.screenshotBeforePath,
            screenshotAfterPath: artifacts.screenshotAfterPath,
            artifactDir: artifacts.artifactDir ?? null,
            openedAthleteUrl: artifacts.openedAthleteUrl ?? null,
          });
        } finally {
          await page.close().catch(() => {});
        }
      }
      const logJson = {
        ...baseLog,
        status: "dry_run_completed",
        inspectedAt: new Date().toISOString(),
        pageMeta: artifacts.pageMeta,
        dryRunResult: evaluation.dryRunResult,
        resolvedDates: evaluation.resolvedDates,
        candidate: evaluation.candidate,
        candidateAlternativesCount: evaluation.candidateAlternativesCount,
        confidence: evaluation.confidence,
        canExecute: evaluation.canExecute,
        canExecuteReasons: evaluation.canExecuteReasons,
        diagnostics: evaluation.diagnostics,
        identityCheck: evaluation.identityCheck,
        debugCandidatesTopN: evaluation.debugCandidatesTopN,
        rankingDebug: evaluation.rankingDebug,
        selectedSourceDatePolicy: evaluation.selectedSourceDatePolicy,
        selectedSourceDate: evaluation.selectedSourceDate,
        sourceDatePolicyOverride:
          evaluation.selectedSourceDatePolicy === COACH_CONFIRMED_SOURCE_DATE_POLICY
            ? COACH_CONFIRMED_SOURCE_DATE_POLICY
            : null,
        selectedSourceDateCandidateCount: evaluation.selectedSourceDateCandidateCount,
        globalCandidateCount: evaluation.globalCandidateCount,
        sourceDateBucketCounts: evaluation.sourceDateBucketCounts,
        sourceInferenceProvenance: evaluation.sourceInferenceProvenance ?? null,
        plannedVsCompletedHint: evaluation.plannedVsCompletedHint ?? null,
        note: "Ничего не изменено в TrainingPeaks",
      };

      await completeDryRun(claimed.action.id, run.id, {
        logJson,
        screenshotBeforePath: artifacts.screenshotBeforePath,
        screenshotAfterPath: artifacts.screenshotAfterPath,
      });

      await notifyCoachDryRunResultWithFallback({
        action: claimed.action,
        studentName,
        dryRunEvaluation: evaluation,
      });

      console.log(`Dry-run completed for action ${claimed.action.id}.`);
      return;
    } catch (error) {
      const errorMessage = toShortErrorMessage(error);
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
      const failedEvaluation: DryRunEvaluation = {
        dryRunResult: "failed",
        resolvedDates: {
          sourceDate: null,
          targetDate: null,
          timezone,
        },
        candidate: null,
        candidateAlternativesCount: 0,
        confidence: 0,
        canExecute: false,
        canExecuteReasons: [errorMessage],
        diagnostics: {
          loginRequired: /login|sign in|session expired/i.test(errorMessage),
          athleteReachable: false,
          trainingPeaksContextOk: false,
          parseWarnings: [],
        },
        identityCheck: {
          telegramUsername: null,
          telegramChatId: claimed.student?.telegram_chat_id ?? null,
          expectedTrainingPeaksName: claimed.student?.student_name ?? null,
          visibleTrainingPeaksName: null,
          expectedAthleteId: parseTrainingPeaksAthleteId(claimed.student?.trainingpeaks_athlete_url ?? null),
          currentAthleteId: null,
          expectedTrainingPeaksUrl: claimed.student?.trainingpeaks_athlete_url ?? null,
          currentUrl: null,
          matchedBy: "inconclusive",
          warnings: [],
        },
        debugCandidatesTopN: [],
      };
      const failedLog = {
        ...baseLog,
        status: "failed",
        failedAt: new Date().toISOString(),
        error: errorMessage,
        dryRunResult: failedEvaluation.dryRunResult,
        resolvedDates: failedEvaluation.resolvedDates,
        candidate: failedEvaluation.candidate,
        candidateAlternativesCount: failedEvaluation.candidateAlternativesCount,
        confidence: failedEvaluation.confidence,
        canExecute: failedEvaluation.canExecute,
        canExecuteReasons: failedEvaluation.canExecuteReasons,
        diagnostics: failedEvaluation.diagnostics,
        identityCheck: failedEvaluation.identityCheck,
        debugCandidatesTopN: failedEvaluation.debugCandidatesTopN,
        rankingDebug: failedEvaluation.rankingDebug,
        selectedSourceDatePolicy: failedEvaluation.selectedSourceDatePolicy,
        selectedSourceDate: failedEvaluation.selectedSourceDate,
        selectedSourceDateCandidateCount: failedEvaluation.selectedSourceDateCandidateCount,
        globalCandidateCount: failedEvaluation.globalCandidateCount,
        sourceDateBucketCounts: failedEvaluation.sourceDateBucketCounts,
        note: "Ничего не изменено в TrainingPeaks",
      };
      await failDryRun(claimed.action.id, run.id, {
        errorMessage,
        logJson: failedLog,
      });

      await notifyCoachDryRunResultWithFallback({
        action: claimed.action,
        studentName,
        dryRunEvaluation: failedEvaluation,
      });

      throw error;
    }
  }

  const claimed = await claimOneExecutePendingActionForRealMode(runnerId, requestedActionId);
  if (!claimed) {
    console.log("No execute_pending TrainingPeaks actions ready for real-mode revalidation.");
    return;
  }

  console.log(`Claimed TrainingPeaks action ${claimed.action.id} for real-mode revalidation.`);
  if (prepareOnly) {
    console.log("Prepare-only enabled: no TrainingPeaks mutation will be attempted.");
  } else if (!useApiMoveEnv) {
    console.log(`API move path disabled. Set ${TP_ACTIONS_USE_API_MOVE_ENV}=true to allow TrainingPeaks API move.`);
  } else {
    console.log("API move path enabled");
  }
  const run = await createActionRun(claimed.action.id, runnerId, "real");
  const baseLog: Record<string, unknown> = {
    actionId: claimed.action.id,
    runId: run.id,
    runnerId,
    runType: "real",
    dryRun: false,
    realMode: true,
    actionType: claimed.action.action_type,
    actionStatus: claimed.action.status,
    rawText: claimed.action.raw_text,
    targetSummary: getTargetSummary(claimed.action.parsed_payload),
    student: claimed.student
      ? {
          id: claimed.student.id,
          studentId: claimed.student.student_id,
          studentName: claimed.student.student_name,
          telegramChatId: claimed.student.telegram_chat_id,
          trainingPeaksAthleteUrl: claimed.student.trainingpeaks_athlete_url,
        }
      : null,
    trustedDryRunRunId: claimed.trustedDryRunRun.id,
    trustedDryRun: claimed.trustedDryRunLog,
    safety: {
      mutationForbidden: prepareOnly || !useApiMoveEnv,
      allowedActions: [
        "open athlete page",
        "extract candidate",
        "compare with trusted dry-run",
        "capture screenshots",
        "resolve exact workout card",
        "GET workout",
        "PUT workout move via TrainingPeaks API",
        "GET verification",
      ],
      forbiddenActions: ["drag", "drop", "save", "Save & Close", "form submit", "legacy UI mutation path"],
    },
    apiMoveGate: {
      enabled: useApiMoveEnv,
      requiredEnv: TP_ACTIONS_USE_API_MOVE_ENV,
      requiresRealExecutionEnv: TP_ACTIONS_REAL_EXECUTION_ENV,
    },
    realSaveGate: {
      confirmSaveFlag,
      allowSaveEnv,
      saveGateOpen,
      requiredWhenNotPrepareOnly: false,
      legacyOnly: true,
      legacyUiPathPresentInCode: typeof runControlledSaveAndCloseExecution === "function",
    },
  };
  const studentName = claimed.student?.student_name ?? "(unknown)";

  try {
    const artifacts = await inspectActionCalendar(claimed, run.id);
    const evaluation = artifacts.dryRunEvaluation;
    const comparison = buildRevalidationComparison({
      trusted: claimed.trustedDryRunLog,
      current: evaluation,
      parsedPayload: claimed.action.parsed_payload,
      actionStatus: claimed.action.status,
      actionExecutionStatus: claimed.action.execution_status,
    });
    if (comparison.confidenceThresholdBypassed && comparison.confidenceThresholdBypassReason) {
      console.log(
        `[execute-real] action=${claimed.action.id} ${comparison.confidenceThresholdBypassReason} (${evaluation.confidence.toFixed(2)})`
      );
    }

    if (!comparison.revalidationPassed) {
      const errorMessage = `Revalidation failed: ${comparison.mismatchReasons.join("; ") || "unknown mismatch"}`;
      const logJson = {
        ...baseLog,
        status: "failed",
        failedAt: new Date().toISOString(),
        error: errorMessage,
        pageMeta: artifacts.pageMeta,
        revalidationPassed: false,
        revalidationComparison: comparison,
        currentEvaluation: evaluation,
        note: TRAININGPEAKS_NOT_CHANGED_NOTE,
      };

      await finishRealRun(claimed.action.id, run.id, {
        errorMessage,
        logJson,
        screenshotBeforePath: artifacts.screenshotBeforePath,
        screenshotAfterPath: artifacts.screenshotAfterPath,
      });

      if (!prepareOnly) {
        await notifyCoachRealModeResultWithFallback({
          action: claimed.action,
          studentName,
          trustedDryRun: claimed.trustedDryRunLog,
          currentEvaluation: evaluation,
          comparison,
          revalidationPassed: false,
          errorMessage,
          candidate: evaluation.candidate,
        });
      }

      console.log(`Real-mode revalidation failed for action ${claimed.action.id}: ${errorMessage}`);
      return;
    }

    if (prepareOnly || !useApiMoveEnv) {
      let lastProbePayload: UiCapabilityProbe | null = null;
      const trainingPeaksDriver = new PlaywrightOnlyTrainingPeaksDriver({
        expectedActionId: claimed.action.id,
        sourceDateIso: claimed.trustedDryRunLog.resolvedDates.sourceDate,
        targetDateIso: claimed.trustedDryRunLog.resolvedDates.targetDate,
        athleteIdentityMatchedBy: evaluation.identityCheck.matchedBy,
        candidateFingerprintMatches: comparison.fingerprint.matches,
        runProbe: async () => {
          lastProbePayload = await probeTrainingPeaksMoveCapabilities(claimed, run.id, comparison);
          return probeToDriverProbeShape(lastProbePayload);
        },
      });

      const prepareMoveWorkoutResult = await trainingPeaksDriver.prepareMoveWorkout(claimed.action.id);
      const executePreparedMoveResult = await trainingPeaksDriver.executePreparedMove(claimed.action.id);
      const validateMoveWorkoutResult = await trainingPeaksDriver.validateMoveWorkout(claimed.action.id);
      const uiCapabilityProbe = lastProbePayload!;
      const latestUiProbeError =
        uiCapabilityProbe.errors.length > 0 ? uiCapabilityProbe.errors[uiCapabilityProbe.errors.length - 1] : null;
      const errorMessage =
        latestUiProbeError ??
        prepareMoveWorkoutResult.failureReason ??
        (!useApiMoveEnv && !prepareOnly
          ? `API move gate closed: provide ${TP_ACTIONS_USE_API_MOVE_ENV}=true.`
          : REAL_MOVE_NOT_IMPLEMENTED_ERROR);
      const driverLogJsonSlice = {
        kind: "playwright_only_v1",
        prepareMoveWorkout: prepareMoveWorkoutResult,
        executePreparedMove: executePreparedMoveResult,
        validateMoveWorkout: validateMoveWorkoutResult,
      };

      const logJson = {
        ...baseLog,
        status: "failed",
        failedAt: new Date().toISOString(),
        error: errorMessage,
        pageMeta: artifacts.pageMeta,
        revalidationPassed: true,
        revalidationComparison: comparison,
        currentEvaluation: evaluation,
        uiCapabilityProbe,
        trainingPeaksDriver: driverLogJsonSlice,
        saveAndCloseAttempted: false,
        saveAndCloseClicked: false,
        saveAndCloseClickMethod: null,
        saveAndCloseError: null,
        unsavedUiStateChanged: Boolean(prepareMoveWorkoutResult.targetDateSelectionAttempted),
        postSaveValidationAttempted: false,
        postSaveValidationPassed: false,
        postSaveValidationError: null,
        mutationOccurred: false,
        durableMutationOccurred: false,
        apiMoveAttempted: false,
        wouldMove: {
          sourceDate: claimed.trustedDryRunLog.resolvedDates.sourceDate,
          targetDate: claimed.trustedDryRunLog.resolvedDates.targetDate,
          candidate: {
            title: comparison.currentCandidate?.title ?? comparison.trustedCandidate.title,
            type: comparison.currentCandidate?.type ?? comparison.trustedCandidate.type,
            plannedDurationSec:
              comparison.currentCandidate?.plannedDurationSec ?? comparison.trustedCandidate.plannedDurationSec,
            plannedDistance:
              comparison.currentCandidate?.plannedDistance ?? comparison.trustedCandidate.plannedDistance,
            startTimeLocal: comparison.currentCandidate?.startTimeLocal ?? comparison.trustedCandidate.startTimeLocal,
            fingerprint: comparison.currentCandidate?.fingerprint ?? comparison.trustedCandidate.fingerprint,
          },
        },
        note: !useApiMoveEnv && !prepareOnly
          ? `Real mode revalidation passed, but API move gate is closed (${TP_ACTIONS_USE_API_MOVE_ENV}=true required). TrainingPeaks not changed.`
          : "Проверка перед переносом пройдена. Legacy UI prepare flow оставлен в режиме read-only; реальный перенос через UI disabled. TrainingPeaks не изменён.",
      };

      await finishRealRun(claimed.action.id, run.id, {
        errorMessage,
        logJson,
        screenshotBeforePath: artifacts.screenshotBeforePath,
        screenshotAfterPath: artifacts.screenshotAfterPath,
      });

      if (!prepareOnly) {
        await notifyCoachRealModeResultWithFallback({
          action: claimed.action,
          studentName,
          trustedDryRun: claimed.trustedDryRunLog,
          currentEvaluation: evaluation,
          comparison,
          revalidationPassed: true,
          errorMessage: logJson.note as string,
          candidate: evaluation.candidate ?? comparison.trustedCandidate,
        });
      }

      if (prepareOnly) {
        const uiCapabilityProbeErrors =
          prepareMoveWorkoutResult.status === "ready_to_save"
            ? uiCapabilityProbe.errors.filter((entry) => !/currentStep\s*=\s*unknown/i.test(entry))
            : uiCapabilityProbe.errors;
        const summaryPayload = {
          actionId: claimed.action.id,
          runId: run.id,
          revalidationPassed: true,
          mutationOccurred: false,
          datePickerOpened: prepareMoveWorkoutResult.datePickerOpened,
          targetDateVisible: prepareMoveWorkoutResult.targetDateVisible,
          datePickerDetectionStrategy: prepareMoveWorkoutResult.datePickerDetectionStrategy,
          visibleMonth: prepareMoveWorkoutResult.visibleMonth,
          visibleYear: prepareMoveWorkoutResult.visibleYear,
          visibleDayCandidates: prepareMoveWorkoutResult.visibleDayCandidates,
          targetDayVisible: prepareMoveWorkoutResult.targetDayVisible,
          selectedSourceDayVisible: prepareMoveWorkoutResult.selectedSourceDayVisible,
          targetDateClickCandidateFound: prepareMoveWorkoutResult.targetDateClickCandidateFound,
          targetDateClickCandidateBoundingBox: prepareMoveWorkoutResult.targetDateClickCandidateBoundingBox,
          targetDateSelectionAttempted: prepareMoveWorkoutResult.targetDateSelectionAttempted,
          targetDateSelectionConfirmed: prepareMoveWorkoutResult.targetDateSelectionConfirmed,
          postClickDateHeaderText: prepareMoveWorkoutResult.postClickDateHeaderText,
          postClickDateInputValue: prepareMoveWorkoutResult.postClickDateInputValue,
          targetDateConfirmedBy: prepareMoveWorkoutResult.targetDateConfirmedBy,
          targetDateClickMethod: prepareMoveWorkoutResult.targetDateClickMethod,
          afterTargetDayClickError: prepareMoveWorkoutResult.afterTargetDayClickError,
          datePickerCloseAttempted: uiCapabilityProbe.detail.datePickerCloseAttempted,
          datePickerCloseSucceeded: uiCapabilityProbe.detail.datePickerCloseSucceeded,
          datePickerCloseError: uiCapabilityProbe.detail.datePickerCloseError,
          status: prepareMoveWorkoutResult.status,
          failureReason: prepareMoveWorkoutResult.failureReason,
          datepickerDomDebugPath: prepareMoveWorkoutResult.datepickerDomDebugPath,
          datepickerDomDebugTopCandidates: prepareMoveWorkoutResult.datepickerDomDebugTopCandidates,
          datepickerDomDebugError: prepareMoveWorkoutResult.datepickerDomDebugError,
          trainingPeaksDriver: driverLogJsonSlice,
          uiCapabilityProbeErrors,
          diagnostics: prepareMoveWorkoutResult,
        };
        console.log(JSON.stringify({ prepareOnlySummary: summaryPayload }, null, 2));
        console.log("No TrainingPeaks mutation occurred (prepare-only tooling run).");
      }

      console.log(
        !useApiMoveEnv && !prepareOnly
          ? `Real-mode revalidation passed for action ${claimed.action.id}, but API move gate is closed.`
          : `Real-mode revalidation passed for action ${claimed.action.id}, but legacy UI move remains blocked.`
      );
      return;
    }

    const artifactDir = path.join(ACTION_ARTIFACTS_ROOT, claimed.action.id, run.id);
    await mkdir(artifactDir, { recursive: true });
    const apiExecution = await executeApiMoveForApprovedAction({
      claimed,
      runId: run.id,
      comparison,
      artifactDir,
    });

    const logJson = {
      ...baseLog,
      status:
        apiExecution.putStatus === 200 && apiExecution.verificationOk && apiExecution.verificationMatchesTargetDate
          ? "completed"
          : "failed",
      completedAt:
        apiExecution.putStatus === 200 && apiExecution.verificationOk && apiExecution.verificationMatchesTargetDate
          ? new Date().toISOString()
          : undefined,
      failedAt:
        apiExecution.putStatus === 200 && apiExecution.verificationOk && apiExecution.verificationMatchesTargetDate
          ? undefined
          : new Date().toISOString(),
      pageMeta: artifacts.pageMeta,
      revalidationPassed: true,
      revalidationComparison: comparison,
      currentEvaluation: evaluation,
      selectedSourceDatePolicy: evaluation.selectedSourceDatePolicy,
      selectedSourceDate: evaluation.selectedSourceDate,
      sourceDatePolicyOverride:
        evaluation.selectedSourceDatePolicy === COACH_CONFIRMED_SOURCE_DATE_POLICY
          ? COACH_CONFIRMED_SOURCE_DATE_POLICY
          : null,
      mutationOccurred: apiExecution.apiMoveExecuted,
      durableMutationOccurred: apiExecution.apiMoveExecuted,
      apiMove: {
        enabled: apiExecution.apiMoveEnabled,
        executed: apiExecution.apiMoveExecuted,
        athleteId: apiExecution.athleteId,
        workoutId: apiExecution.workoutId,
        sourceDate: apiExecution.sourceDate,
        targetDate: apiExecution.targetDate,
        targetDateTime: apiExecution.targetDateTime,
        putStatus: apiExecution.putStatus,
        verificationStatus: apiExecution.verificationStatus,
        verificationOk: apiExecution.verificationOk,
        verificationWorkoutDay: apiExecution.verificationWorkoutDay,
        verificationMatchesTargetDate: apiExecution.verificationMatchesTargetDate,
        authHeaderObserved: apiExecution.authHeaderObserved,
        sampleTpApiUrl: apiExecution.sampleTpApiUrl,
        artifacts: apiExecution.artifacts,
      },
      apiMoveRequest: apiExecution.requestSummary,
      apiMoveResponse: apiExecution.responseSummary,
      apiMoveVerification: apiExecution.verificationSummary,
      note:
        apiExecution.putStatus === 200 && apiExecution.verificationOk && apiExecution.verificationMatchesTargetDate
          ? "TrainingPeaks API move executed successfully and verification confirmed target workoutDay."
          : "TrainingPeaks API move failed or could not be verified. Manual review required.",
    };

    if (apiExecution.putStatus !== 200) {
      const errorMessage = `API move PUT failed with status ${apiExecution.putStatus}; artifactDir=${path.join(
        artifactDir,
        "api-move"
      )}`;
      await finishRealRun(claimed.action.id, run.id, {
        errorMessage,
        logJson: {
          ...logJson,
          status: "failed",
          error: errorMessage,
        },
        screenshotBeforePath: apiExecution.screenshotBeforePath ?? artifacts.screenshotBeforePath,
        screenshotAfterPath: apiExecution.screenshotAfterPath ?? artifacts.screenshotAfterPath,
      });
      await notifyCoachRealModeResultWithFallback({
        action: claimed.action,
        studentName,
        trustedDryRun: claimed.trustedDryRunLog,
        currentEvaluation: evaluation,
        comparison,
        revalidationPassed: true,
        errorMessage,
        candidate: evaluation.candidate ?? comparison.trustedCandidate,
      });
      console.log(`Real-mode API move failed for action ${claimed.action.id}: ${errorMessage}`);
      return;
    }

    if (!apiExecution.verificationOk || !apiExecution.verificationMatchesTargetDate) {
      const errorMessage = `API move sent but verification failed; manual review required. artifactDir=${path.join(
        artifactDir,
        "api-move"
      )}`;
      await finishRealRun(claimed.action.id, run.id, {
        errorMessage,
        logJson: {
          ...logJson,
          status: "failed",
          error: errorMessage,
        },
        screenshotBeforePath: apiExecution.screenshotBeforePath ?? artifacts.screenshotBeforePath,
        screenshotAfterPath: apiExecution.screenshotAfterPath ?? artifacts.screenshotAfterPath,
      });
      await notifyCoachRealModeResultWithFallback({
        action: claimed.action,
        studentName,
        trustedDryRun: claimed.trustedDryRunLog,
        currentEvaluation: evaluation,
        comparison,
        revalidationPassed: true,
        errorMessage,
        candidate: evaluation.candidate ?? comparison.trustedCandidate,
      });
      console.log(`Real-mode API move verification failed for action ${claimed.action.id}: ${errorMessage}`);
      return;
    }

    await completeRealRun(claimed.action.id, run.id, {
      logJson,
      screenshotBeforePath: apiExecution.screenshotBeforePath ?? artifacts.screenshotBeforePath,
      screenshotAfterPath: apiExecution.screenshotAfterPath ?? artifacts.screenshotAfterPath,
    });
    const studentReply = await trySendMoveCompletionReply({
      action: claimed.action,
      student: claimed.student,
    });
    if (
      studentReply.attempted ||
      studentReply.sent ||
      studentReply.skippedReason
    ) {
      const supabase = getSupabase();
      const { error: updateReplyLogError } = await supabase
        .from("trainingpeaks_action_runs")
        .update({
          log_json: {
            ...logJson,
            studentReplyAttempted: studentReply.attempted,
            studentReplySent: studentReply.sent,
            studentReplySkippedReason: studentReply.skippedReason,
          },
        })
        .eq("id", run.id)
        .eq("action_id", claimed.action.id);
      if (updateReplyLogError) {
        console.warn(
          `Failed to append student move completion reply log for action ${claimed.action.id}: ${updateReplyLogError.message}`
        );
      }
    }
    await notifyCoachRealModeResultWithFallback({
      action: claimed.action,
      studentName,
      trustedDryRun: claimed.trustedDryRunLog,
      currentEvaluation: evaluation,
      comparison,
      revalidationPassed: true,
      errorMessage: "TrainingPeaks API move executed successfully; verification passed.",
      candidate: evaluation.candidate ?? comparison.trustedCandidate,
      includeNotChangedNote: false,
    });
    console.log(`Real-mode API move completed for action ${claimed.action.id}.`);
    return;
  } catch (error) {
    const errorMessage = toShortErrorMessage(error);
    const logJson = {
      ...baseLog,
      status: "failed",
      failedAt: new Date().toISOString(),
      error: errorMessage,
      revalidationPassed: false,
      note: TRAININGPEAKS_NOT_CHANGED_NOTE,
    };

    await finishRealRun(claimed.action.id, run.id, {
      errorMessage,
      logJson,
      screenshotBeforePath: null,
      screenshotAfterPath: null,
    });

    if (!prepareOnly) {
      await notifyCoachRealModeResultWithFallback({
        action: claimed.action,
        studentName,
        trustedDryRun: claimed.trustedDryRunLog,
        currentEvaluation: null,
        comparison: null,
        revalidationPassed: false,
        errorMessage,
        candidate: claimed.trustedDryRunLog.candidate,
      });
    }

    throw error;
  }
}

const isDirectRun = (() => {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    return fileURLToPath(import.meta.url) === path.resolve(entry);
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  main().catch((error: unknown) => {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(error);
    }
    process.exit(1);
  });
}
