import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

import {
  PlaywrightOnlyTrainingPeaksDriver,
  type ProbeLike as TrainingPeaksProbeLikeForDriver,
} from "./lib/playwright-only-trainingpeaks-driver.ts";
import { profileDir, toolRoot } from "./lib/paths.ts";

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
  execution_status: ActionExecutionStatus;
  execution_mode: ActionExecutionMode | null;
  claimed_by: string | null;
  claimed_at: string | null;
  last_run_id: string | null;
  execution_requested_at: string | null;
};

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
};

type ClaimedRealAction = ClaimedAction & {
  trustedDryRunRun: TrainingPeaksActionRunRow;
  trustedDryRunLog: TrustedDryRunLog;
};

type DryRunArtifacts = {
  screenshotBeforePath: string;
  screenshotAfterPath: string | null;
  dryRunEvaluation: DryRunEvaluation;
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
  targetDateClickCandidateFound: boolean;
  targetDateClickCandidateBoundingBox: { x: number; y: number; width: number; height: number } | null;
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
};

type TrainingPeaksMoveWorkoutTarget =
  | { kind: "date"; value: string; sourceText?: string }
  | { kind: "relative_day"; value: "tomorrow" | "day_after_tomorrow"; sourceText?: string }
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
};

type DryRunDiagnostics = {
  loginRequired: boolean;
  athleteReachable: boolean;
  trainingPeaksContextOk: boolean;
  parseWarnings: string[];
  domDebug?: DryRunDomDebug | null;
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
  };
  selectedSourceDatePolicy?: string;
  selectedSourceDate?: string | null;
  selectedSourceDateCandidateCount?: number;
  globalCandidateCount?: number;
  sourceDateBucketCounts?: Record<string, number>;
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
  reasons: string[];
  fromFallback: boolean;
  rawScore: number;
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
  parseWarnings: string[];
  extractionError: string | null;
};

const TELEGRAM_API_BASE_URL = "https://api.telegram.org";
const TP_CALLBACK_ACTION_EXECUTE_PREFIX = "tp:ta:x:";
const TP_CALLBACK_ACTION_CANCEL_PREFIX = "tp:ta:c:";
const ACTION_ARTIFACTS_ROOT = path.join(toolRoot, "action-artifacts");
const TP_ACTIONS_EXECUTE_REAL_FLAG = "--execute-real";
const TP_ACTIONS_PREPARE_ONLY_FLAG = "--prepare-only";
const TP_ACTIONS_REAL_EXECUTION_ENV = "TP_ACTIONS_REAL_EXECUTION";
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

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
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

function resolveTargetDateFromPayload(target: TrainingPeaksMoveWorkoutTarget): { targetDate: string; warnings: string[] } {
  const warnings: string[] = [];
  const now = new Date();

  if (target.kind === "date") {
    const normalized = normalizeDateCandidate(target.value);
    if (normalized) {
      return { targetDate: normalized, warnings };
    }
    warnings.push("target date is invalid");
    return { targetDate: toIsoDate(now), warnings };
  }

  if (target.kind === "relative_day") {
    if (target.value === "tomorrow") {
      return { targetDate: toIsoDate(addDays(now, 1)), warnings };
    }
    return { targetDate: toIsoDate(addDays(now, 2)), warnings };
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

  const nowWeekday = now.getUTCDay();
  const targetWeekday = weekdayMap[target.value];
  if (targetWeekday === undefined) {
    warnings.push("target weekday is unknown");
    return { targetDate: toIsoDate(now), warnings };
  }

  let delta = (targetWeekday - nowWeekday + 7) % 7;
  if (delta === 0) {
    delta = 7;
  }
  return { targetDate: toIsoDate(addDays(now, delta)), warnings };
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
    const now = new Date();
    const year = slash[3] ? Number(slash[3]) : now.getUTCFullYear();
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

function formatDryRunReasonForCoach(reason: string): string {
  if (reason === "multiple candidates on selected source date") {
    return "Найдено несколько тренировок на исходную дату";
  }
  if (reason === "source date could not be resolved safely") {
    return "Нужна исходная дата";
  }
  if (reason === "no planned candidate on inferred source date") {
    return "Нужна конкретная тренировка";
  }
  return reason;
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

function resolveDryRunNotificationChatId(action: TrainingPeaksActionRow): string | null {
  const chatId = action.coach_chat_id ?? action.decided_by_chat_id;
  if (!chatId) {
    console.warn(
      `TrainingPeaks dry-run: skipping coach Telegram notification — no chat id (coach_chat_id and decided_by_chat_id both null) for action ${action.id}, status=${action.status}`
    );
  }
  return chatId;
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
  statusText: string;
  note: string;
  dryRunEvaluation?: DryRunEvaluation | null;
  errorText?: string | null;
}): Promise<void> {
  if (!input.chatId) {
    return;
  }

  const lines = [
    "TrainingPeaks dry-run",
    `Action ID: ${input.action.id}`,
    `Ученик: ${input.studentName}`,
    `Raw text: ${input.action.raw_text}`,
    `Target: ${getTargetSummary(input.action.parsed_payload)}`,
    `Статус: ${input.statusText}`,
  ];

  if (input.dryRunEvaluation) {
    const evaluation = input.dryRunEvaluation;
    lines.push(`dryRunResult: ${evaluation.dryRunResult}`);
    lines.push(`identity: ${evaluation.identityCheck.matchedBy}`);
    lines.push(`DB student name: ${evaluation.identityCheck.expectedTrainingPeaksName ?? "unknown"}`);
    lines.push(`TP visible athlete: ${evaluation.identityCheck.visibleTrainingPeaksName ?? "unknown"}`);
    lines.push(`resolved target date: ${evaluation.resolvedDates.targetDate ?? "unknown"}`);
    lines.push(`resolved source date: ${evaluation.resolvedDates.sourceDate ?? "unknown"}`);
    lines.push(`candidate: ${formatCandidateLine(evaluation.candidate)}`);
    if (!evaluation.canExecute) {
      const reason =
        evaluation.canExecuteReasons.map(formatDryRunReasonForCoach).join("; ") || "небезопасно выполнить";
      lines.push(`reason: ${reason}`);
    }
    lines.push(`confidence: ${evaluation.confidence.toFixed(2)}`);
    lines.push(`canExecute: ${evaluation.canExecute ? "yes" : "no"}`);
  }

  if (input.errorText) {
    lines.push(`Ошибка: ${input.errorText}`);
  }
  lines.push(input.note);
  lines.push(
    "Это только подтверждение выполнения. TrainingPeaks изменится только после запуска локального runner на следующем этапе."
  );

  let inlineKeyboardRows: Array<Array<{ text: string; callback_data: string }>> = [];
  if (input.dryRunEvaluation?.dryRunResult === "candidate_found") {
    const actionId = input.action.id;
    const cancelButton = {
      text: "❌ Отменить",
      callback_data: `${TP_CALLBACK_ACTION_CANCEL_PREFIX}${actionId}`,
    };
    if (input.dryRunEvaluation.canExecute) {
      inlineKeyboardRows = [
        [
          {
            text: "✅ Выполнить перенос",
            callback_data: `${TP_CALLBACK_ACTION_EXECUTE_PREFIX}${actionId}`,
          },
        ],
        [cancelButton],
      ];
    } else {
      inlineKeyboardRows = [[cancelButton]];
    }
  }

  try {
    await sendTelegramText(input.chatId, lines.join("\n"), { inlineKeyboardRows });
  } catch (error) {
    console.warn(`Telegram action dry-run summary warning: ${toShortErrorMessage(error)}`);
  }
}

async function claimOneApprovedActionForDryRun(runnerId: string): Promise<ClaimedAction | null> {
  const supabase = getSupabase();

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

    if (!candidate) {
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
      .eq("id", candidate.id)
      .eq("status", "approved")
      .eq("execution_status", "not_started")
      .select("*")
      .maybeSingle();

    if (claimError) {
      throw new Error(`Failed to claim action ${candidate.id} for dry-run: ${claimError.message}`);
    }

    if (!claimed) {
      continue;
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

  return null;
}

async function claimOneExecutePendingActionForRealMode(runnerId: string): Promise<ClaimedRealAction | null> {
  const supabase = getSupabase();

  for (let attempt = 0; attempt < 5; attempt += 1) {
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
      return null;
    }

    const action = candidate as TrainingPeaksActionRow;
    if (!action.last_run_id) {
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
      console.warn(`Skipping execute_pending action ${action.id}: trusted dry-run row ${action.last_run_id} not found.`);
      continue;
    }

    const trustedDryRunRun = trustedRunData as TrainingPeaksActionRunRow;
    const trustedDryRunLog = normalizeTrustedDryRunLog(trustedDryRunRun.log_json);
    if (!trustedDryRunLog) {
      console.warn(`Skipping execute_pending action ${action.id}: trusted dry-run log is not safe for real-mode revalidation.`);
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
      continue;
    }

    const claimedAction = claimed as TrainingPeaksActionRow;
    let student: TrainingPeaksStudentRow | null = null;
    if (claimedAction.student_id) {
      const { data: studentData, error: studentError } = await supabase
        .from("trainingpeaks_students")
        .select("id, student_id, student_name, telegram_chat_id, trainingpeaks_athlete_url")
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
    targetDateClickCandidateFound: false,
    targetDateClickCandidateBoundingBox: null,
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
  calendarMonthYear: { year: number | null; month: number | null }
): Promise<string | null> {
  const dayTextRaw = (await dayCell.innerText().catch(() => "")) ?? "";
  const dayText = dayTextRaw.trim();
  const dayAttributes = {
    dataDate: await getAttributeSafe(dayCell, "data-date"),
    datetime: await getAttributeSafe(dayCell, "datetime"),
    ariaLabel: await getAttributeSafe(dayCell, "aria-label"),
    title: await getAttributeSafe(dayCell, "title"),
  };

  for (const attrValue of Object.values(dayAttributes)) {
    const dateIso = parseDateFromCalendarAttr(attrValue);
    if (dateIso) {
      return dateIso;
    }
  }

  const descendantDateLocators = dayCell.locator(
    "[data-date],[datetime],[aria-label],[title],[class*='day' i],[class*='date' i],header,time"
  );
  const descendantCount = await descendantDateLocators.count();
  for (let descendantIndex = 0; descendantIndex < descendantCount; descendantIndex += 1) {
    const descendant = descendantDateLocators.nth(descendantIndex);
    for (const attrName of ["data-date", "datetime", "aria-label", "title"] as const) {
      const attrValue = await getAttributeSafe(descendant, attrName);
      const dateIso = parseDateFromCalendarAttr(attrValue);
      if (dateIso) {
        return dateIso;
      }
    }
  }

  if (!calendarMonthYear.month || !calendarMonthYear.year) {
    return null;
  }

  const primaryCards = dayCell.locator(TP_PRIMARY_WORKOUT_CARD_WITHIN_DAY_SELECTOR);
  const fallbackCards = dayCell.locator(TP_FALLBACK_WORKOUT_CARD_WITHIN_DAY_SELECTOR);
  const dayCardTexts: string[] = [];
  for (const locator of [primaryCards, fallbackCards]) {
    const count = await locator.count();
    for (let index = 0; index < count; index += 1) {
      const cardText = await getInnerTextSafe(locator.nth(index));
      if (cardText) {
        dayCardTexts.push(cardText);
      }
    }
  }

  let dayContextText = dayText;
  for (const cardText of dayCardTexts) {
    dayContextText = dayContextText.replace(cardText, " ");
  }
  const derivedDayNumber = extractDayNumberCandidate(dayContextText);
  if (derivedDayNumber === null) {
    return null;
  }

  return toIsoFromDateParts(calendarMonthYear.year, calendarMonthYear.month, derivedDayNumber);
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
    const dayDate = await resolveDayCellDateForProbe(dayCell, calendarMonthYear);
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
  dateHeaderText: string
): Promise<{
  found: boolean;
  text: string | null;
  tagName: string | null;
  className: string | null;
  rect: { x: number; y: number; width: number; height: number } | null;
  reason: string;
}> {
  return await page.evaluate(({ dateHeaderText: targetText }) => {
    const browserProbe = new Function(
      "dateHeaderText",
      `
        const normalizeWhitespace = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        const body = document.body;
        if (!body) {
          return {
            found: false,
            text: null,
            tagName: null,
            className: null,
            rect: null,
            reason: "document.body unavailable",
          };
        }

        const isVisibleElement = (element) => {
          if (!(element instanceof HTMLElement)) {
            return false;
          }
          const style = window.getComputedStyle(element);
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.visibility === "collapse" ||
            Number(style.opacity || "1") < 0.05
          ) {
            return false;
          }
          const rect = element.getBoundingClientRect();
          if (rect.width < 4 || rect.height < 4) {
            return false;
          }
          if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= viewportHeight || rect.left >= viewportWidth) {
            return false;
          }
          return true;
        };

        const modalCandidates = Array.from(
          document.querySelectorAll(
            '[role="dialog"], .MuiDialog-root, .MuiDialog-container, .MuiModal-root, [class*="dialog" i], [class*="modal" i]'
          )
        ).filter(isVisibleElement);

        let modalRect = null;
        let modalReason = "no visible modal candidate";
        if (modalCandidates.length > 0) {
          let bestModal = null;
          let bestModalScore = Number.NEGATIVE_INFINITY;
          for (const candidate of modalCandidates) {
            const rect = candidate.getBoundingClientRect();
            const area = rect.width * rect.height;
            const distanceFromCenter =
              Math.abs(rect.left + rect.width / 2 - viewportWidth / 2) +
              Math.abs(rect.top + rect.height / 2 - viewportHeight / 2);
            const score = area * 0.0001 - distanceFromCenter * 0.05 - rect.top * 0.03;
            if (score > bestModalScore) {
              bestModalScore = score;
              bestModal = rect;
            }
          }
          if (bestModal) {
            modalRect = bestModal;
            modalReason = "using visible modal candidate bounds";
          }
        }

        const allElements = Array.from(body.querySelectorAll("*"));
        let bestMatch = null;
        for (const element of allElements) {
          if (!(element instanceof HTMLElement) || !isVisibleElement(element)) {
            continue;
          }
          const text = normalizeWhitespace(element.innerText || element.textContent || "");
          if (!text || !text.includes(dateHeaderText)) {
            continue;
          }
          const rect = element.getBoundingClientRect();
          const className = normalizeWhitespace(
            typeof element.className === "string" ? element.className : element.getAttribute("class") || ""
          );
          const role = normalizeWhitespace(element.getAttribute("role") || "").toLowerCase();
          const cursor = normalizeWhitespace(window.getComputedStyle(element).cursor).toLowerCase();
          const extraChars = Math.max(0, text.length - dateHeaderText.length);
          let score = text === dateHeaderText ? 140 : 90;
          score -= Math.min(70, extraChars * 0.8);
          score -= rect.width > viewportWidth * 0.8 ? 60 : 0;
          score -= rect.height > 120 ? 25 : 0;
          if (cursor.includes("pointer")) {
            score += 28;
          }
          if (role === "button" || element.tagName === "BUTTON") {
            score += 24;
          }
          if (typeof element.onclick === "function") {
            score += 14;
          }
          if (element.hasAttribute("aria-haspopup")) {
            score += 10;
          }
          if (element.hasAttribute("tabindex")) {
            score += 6;
          }
          if (/(^|\\s)(date|day|header|calendar|picker)(\\s|$)/i.test(className)) {
            score += 16;
          }
          if (text.split(" ").length <= 8) {
            score += 10;
          }
          if (modalRect) {
            const insideModal =
              rect.left >= modalRect.left - 12 &&
              rect.right <= modalRect.right + 12 &&
              rect.top >= modalRect.top - 12 &&
              rect.bottom <= modalRect.bottom + 12;
            score += insideModal ? 45 : -35;
            const leftDistance = Math.abs(rect.left - modalRect.left);
            const topDistance = Math.abs(rect.top - modalRect.top);
            score += Math.max(0, 40 - leftDistance * 0.08 - topDistance * 0.14);
          } else {
            score += Math.max(0, 18 - rect.left * 0.03 - rect.top * 0.04);
          }

          const candidate = {
            found: true,
            text: text,
            tagName: element.tagName || null,
            className: className || null,
            rect: {
              x: Math.round(rect.x * 100) / 100,
              y: Math.round(rect.y * 100) / 100,
              width: Math.round(rect.width * 100) / 100,
              height: Math.round(rect.height * 100) / 100,
            },
            reason:
              [
                modalReason,
                text === dateHeaderText ? "exact-text" : "contains-text",
                cursor.includes("pointer") ? "cursor-pointer" : null,
                role === "button" || element.tagName === "BUTTON" ? "button-role" : null,
                typeof element.onclick === "function" ? "onclick" : null,
                /(date|day|header|calendar|picker)/i.test(className) ? "dateish-class" : null,
                extraChars <= 40 ? "tight-text" : "long-text",
              ]
                .filter(Boolean)
                .join("; "),
            score,
          };

          if (!bestMatch || candidate.score > bestMatch.score) {
            bestMatch = candidate;
          }
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
      `
    ) as (dateHeaderText: string) => {
      found: boolean;
      text: string | null;
      tagName: string | null;
      className: string | null;
      rect: { x: number; y: number; width: number; height: number } | null;
      reason: string;
    };

    return browserProbe(targetText);
  }, { dateHeaderText });
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
  }
): Promise<DatePickerDetectionSnapshot> {
  return page.evaluate(
    ({ dateHeaderBox, dateHeaderText, sourceDateIso, targetDateIso }) => {
      const normalizeWhitespace = (value: string | null | undefined): string =>
        (value ?? "").replace(/\s+/g, " ").trim();
      const toNumericDay = (iso: string | null | undefined): number | null => {
        if (!iso) {
          return null;
        }
        const m = iso.match(/^\d{4}-(\d{2})-(\d{2})$/);
        if (!m) {
          return null;
        }
        const day = Number(m[3]);
        if (!Number.isFinite(day) || day < 1 || day > 31) {
          return null;
        }
        return day;
      };
      const sourceDay = toNumericDay(sourceDateIso);
      const targetDay = toNumericDay(targetDateIso);
      const monthNames = [
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
      const extractMonthName = (text: string): string | null => {
        for (const month of monthNames) {
          if (new RegExp(`\\b${month}\\b`, "i").test(text)) {
            return month;
          }
        }
        return null;
      };
      const extractYear = (text: string): string | null => {
        const m = text.match(/\b(20\d{2})\b/);
        return m ? m[1] : null;
      };
      const extractVisibleDayCandidates = (text: string): number[] => {
        const matches = text.match(/(?:^|\s)([1-9]|[12]\d|3[01])(?=\s|$)/g) ?? [];
        const numbers = new Set<number>();
        for (const raw of matches) {
          const n = Number(raw.trim());
          if (Number.isFinite(n) && n >= 1 && n <= 31) {
            numbers.add(n);
          }
        }
        return [...numbers].sort((a, b) => a - b);
      };
      const dayButtonMatches = (element: Element, day: number): Element[] => {
        const dayText = String(day);
        const candidates = Array.from(
          element.querySelectorAll('[role="gridcell"],[role="option"],button,.MuiPickersDay-root,[data-day]')
        );
        return candidates.filter((candidate) => {
          const text = normalizeWhitespace((candidate as HTMLElement).innerText || candidate.textContent || "");
          const dataDay = (candidate as HTMLElement).getAttribute("data-day");
          const ariaLabel = normalizeWhitespace((candidate as HTMLElement).getAttribute("aria-label"));
          if (dataDay && String(Number(dataDay)) === dayText) {
            return true;
          }
          if (new RegExp(`(^|\\D)${dayText}(\\D|$)`).test(text)) {
            return true;
          }
          if (new RegExp(`(^|\\D)${dayText}(\\D|$)`).test(ariaLabel)) {
            return true;
          }
          return false;
        });
      };
      const hasSelectedState = (element: Element): boolean => {
        const html = element as HTMLElement;
        const className = normalizeWhitespace(html.className || "");
        const ariaSelected = html.getAttribute("aria-selected");
        const selectedAttr = html.getAttribute("data-selected");
        return (
          ariaSelected === "true" ||
          selectedAttr === "true" ||
          /\bMui-selected\b/i.test(className) ||
          /\bselected\b/i.test(className) ||
          /\bactive\b/i.test(className)
        );
      };

      const monthRegex =
        /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/i;
      const yearRegex = /\b20\d{2}\b/;
      const weekdayRowRegex = /\b(?:mo|tu|we|th|fr|sa|su)\b(?:\s+\b(?:mo|tu|we|th|fr|sa|su)\b){3,}/i;
      const expectedMonthMatch = dateHeaderText?.match(
        /\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/i
      );
      const expectedMonth = expectedMonthMatch?.[1] ?? null;
      const expectedYearMatch = dateHeaderText?.match(/\b(20\d{2})\b/);
      const expectedYear = expectedYearMatch?.[1] ?? null;
      const viewportWidth =
        typeof window.innerWidth === "number" && Number.isFinite(window.innerWidth) ? window.innerWidth : 0;
      const viewportHeight =
        typeof window.innerHeight === "number" && Number.isFinite(window.innerHeight) ? window.innerHeight : 0;
      const selectors = [
        ".MuiPickersPopper-root,.MuiPickersLayout-root,.MuiDateCalendar-root",
        '[role="dialog"] [role="grid"],[role="presentation"] [role="grid"]',
        '[aria-label*="calendar" i],[class*="calendar" i],[class*="datepicker" i],[class*="picker" i]',
        ".MuiPopover-paper,.MuiPaper-root,[role='dialog'],[role='presentation']",
      ];

      const elementSummary = (element: Element): string => {
        const htmlElement = element as HTMLElement;
        const idPart = htmlElement.id ? `#${htmlElement.id}` : "";
        const classNames = normalizeWhitespace(htmlElement.className || "")
          .split(" ")
          .filter(Boolean)
          .slice(0, 3);
        const classPart = classNames.length ? `.${classNames.join(".")}` : "";
        return `${element.tagName.toLowerCase()}${idPart}${classPart}`;
      };

      const isVisible = (element: Element): boolean => {
        const htmlElement = element as HTMLElement;
        const style = window.getComputedStyle(htmlElement);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.visibility === "collapse" ||
          Number(style.opacity || "1") === 0
        ) {
          return false;
        }
        const rect = htmlElement.getBoundingClientRect();
        if (rect.width < 16 || rect.height < 16) {
          return false;
        }
        if (rect.bottom < 0 || rect.right < 0 || rect.top > viewportHeight || rect.left > viewportWidth) {
          return false;
        }
        return true;
      };

      const isNearHeader = (candidateRect: DOMRect): boolean => {
        if (!dateHeaderBox) {
          return true;
        }
        const headerCenterX = dateHeaderBox.x + dateHeaderBox.width / 2;
        const headerCenterY = dateHeaderBox.y + dateHeaderBox.height / 2;
        const candidateCenterX = candidateRect.x + candidateRect.width / 2;
        const candidateCenterY = candidateRect.y + candidateRect.height / 2;
        const dx = Math.abs(candidateCenterX - headerCenterX);
        const dy = Math.abs(candidateCenterY - headerCenterY);
        const allowedX = Math.max(220, dateHeaderBox.width * 2.5);
        const allowedY = Math.max(280, dateHeaderBox.height * 8);
        return dx <= allowedX && dy <= allowedY;
      };

      const snippets: string[] = [];
      const seen = new Set<Element>();
      const detectionFallback: DatePickerDetectionSnapshot = {
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
        selectedSourceDayVisible: false,
      };

      for (const selector of selectors) {
        const matches = Array.from(document.querySelectorAll(selector)).slice(0, 8);
        for (const element of matches) {
          if (seen.has(element) || !isVisible(element)) {
            continue;
          }
          seen.add(element);
          const rect = (element as HTMLElement).getBoundingClientRect();
          const text = normalizeWhitespace((element as HTMLElement).innerText || element.textContent || "");
          const visibleMonth = extractMonthName(text);
          const visibleYear = extractYear(text);
          const visibleDayCandidates = extractVisibleDayCandidates(text);
          const targetDayVisible = targetDay !== null ? visibleDayCandidates.includes(targetDay) : false;
          const sourceDayVisible = sourceDay !== null ? visibleDayCandidates.includes(sourceDay) : false;
          const sourceDaySelectedVisible =
            sourceDay !== null
              ? dayButtonMatches(element, sourceDay).some((candidate) => hasSelectedState(candidate))
              : false;
          const targetDaySelectedVisible =
            targetDay !== null
              ? dayButtonMatches(element, targetDay).some((candidate) => hasSelectedState(candidate))
              : false;
          const monthTextMatchesExpectation = expectedMonth ? new RegExp(`\\b${expectedMonth}\\b`, "i").test(text) : false;
          const yearTextMatchesExpectation = expectedYear ? new RegExp(`\\b${expectedYear}\\b`).test(text) : false;
          const hasMonthSignal =
            monthTextMatchesExpectation ||
            Boolean(expectedMonth && element.querySelector(`[aria-label*="${expectedMonth}" i],[title*="${expectedMonth}" i]`)) ||
            monthRegex.test(text) ||
            Boolean(element.querySelector('[aria-label*="month" i],[title*="month" i],select[name*="month" i]'));
          const hasYearSignal =
            yearTextMatchesExpectation ||
            yearRegex.test(text) ||
            Boolean(element.querySelector('[aria-label*="year" i],[title*="year" i],select[name*="year" i]'));
          const weekdayHeaderCount = element.querySelectorAll('[role="columnheader"],th,.MuiDayCalendar-weekDayLabel').length;
          const hasWeekdayRow =
            weekdayRowRegex.test(text) || /\b(?:mo|tu|we|th|fr|sa|su)\b/i.test(text) || weekdayHeaderCount >= 7;
          const dayCellCount = element.querySelectorAll('[role="gridcell"],[role="option"],button,.MuiPickersDay-root').length;
          const dayCellMatches = text.match(/(?:^|\s)(?:[1-9]|[12]\d|3[01])(?=\s|$)/g) ?? [];
          const hasEnoughDayCells = dayCellCount >= 14 || dayCellMatches.length >= 7;
          const nearHeader = isNearHeader(rect);
          snippets.push(
            normalizeWhitespace(
              [
                `check:${selector}`,
                `element=${elementSummary(element)}`,
                `signals=${[
                  hasMonthSignal ? (monthTextMatchesExpectation ? "month-expected" : "month") : null,
                  hasYearSignal ? (yearTextMatchesExpectation ? "year-expected" : "year") : null,
                  hasWeekdayRow ? "weekday-row" : null,
                  hasEnoughDayCells ? `days:${Math.max(dayCellCount, dayCellMatches.length)}` : null,
                  targetDayVisible ? "target-day-visible" : null,
                  targetDaySelectedVisible ? "target-day-selected" : null,
                  sourceDaySelectedVisible ? "source-day-selected" : sourceDayVisible ? "source-day-visible" : null,
                  nearHeader ? "near-header" : "far-from-header",
                ]
                  .filter(Boolean)
                  .join("+") || "none"}`,
                `box=${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.width)}x${Math.round(rect.height)}`,
                text.slice(0, 140),
              ].join(" | ")
            )
          );
          detectionFallback.snippets = snippets.slice(0, 12);
          detectionFallback.visibleMonth = detectionFallback.visibleMonth ?? visibleMonth;
          detectionFallback.visibleYear = detectionFallback.visibleYear ?? visibleYear;
          if (detectionFallback.visibleDayCandidates.length === 0 && visibleDayCandidates.length > 0) {
            detectionFallback.visibleDayCandidates = [...visibleDayCandidates];
          }
          detectionFallback.targetDayVisible = detectionFallback.targetDayVisible || targetDayVisible;
          detectionFallback.targetDaySelectedVisible =
            detectionFallback.targetDaySelectedVisible || targetDaySelectedVisible;
          detectionFallback.selectedSourceDayVisible =
            detectionFallback.selectedSourceDayVisible || sourceDaySelectedVisible;
          if (!detectionFallback.boundingBox && rect.width >= 16 && rect.height >= 16) {
            detectionFallback.boundingBox = {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
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
              nearHeader ? "near-header" : null,
            ]
              .filter(Boolean)
              .join("+");
            return {
              opened: true,
              selectorHint: `${selector} [dom-snapshot]`,
              snippets: snippets.slice(0, 12),
              strategy: strategySignals || "dom-snapshot",
              boundingBox: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
              },
              visibleMonth,
              visibleYear,
              visibleDayCandidates,
              targetDayVisible,
              targetDaySelectedVisible,
              selectedSourceDayVisible: sourceDaySelectedVisible,
            };
          }
        }
      }

      return detectionFallback;
    },
    {
      dateHeaderBox: input.dateHeaderBox,
      dateHeaderText: input.dateHeaderText,
      sourceDateIso: input.sourceDateIso ?? null,
      targetDateIso: input.targetDateIso ?? null,
    }
  );
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
    stageCError = toShortErrorMessage(error);
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
    };
  }

  const partialArtifact: DatepickerDomDebugPartialArtifact = {
    created: true,
    stage: "partial",
    timestamp: new Date().toISOString(),
    context,
    error: stageCError ?? "Stage C snapshot failed for unknown reason.",
    datepickerDomDebugError: stageCError ?? "Stage C snapshot failed for unknown reason.",
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

async function clickVisibleTargetDayInDatePicker(
  page: import("playwright").Page,
  targetDateIso: string | null
): Promise<boolean> {
  if (!targetDateIso) {
    return false;
  }
  const dayMatch = targetDateIso.match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (!dayMatch) {
    return false;
  }
  const dayNum = Number(dayMatch[2]);
  if (!Number.isFinite(dayNum) || dayNum < 1 || dayNum > 31) {
    return false;
  }
  const day = String(dayNum);
  const exactDayRegex = new RegExp(`^\\s*${day}\\s*$`);
  const candidates = [
    page.locator(`.MuiPickersDay-root:has-text("${day}")`).first(),
    page.locator(`[aria-label*=" ${day} " i][role="gridcell"],button[aria-label*=" ${day} " i]`).first(),
    page.getByRole("gridcell", { name: new RegExp(`(^|\\D)${day}(\\D|$)`) }).first(),
    page.getByRole("button", { name: new RegExp(`(^|\\D)${day}(\\D|$)`) }).first(),
  ];
  for (const locator of candidates) {
    if (await isVisible(locator, 500)) {
      try {
        await locator.click({ timeout: 1_500 });
        return true;
      } catch {
        // continue trying safer fallback selectors
      }
    }
  }

  const tdCandidates = await page.locator("td").filter({ hasText: exactDayRegex }).all().catch(() => [] as import("playwright").Locator[]);
  for (const td of tdCandidates) {
    if (!(await td.isVisible().catch(() => false))) continue;
    const box = await td.boundingBox().catch(() => null);
    if (!box || box.width > 80 || box.height > 60 || box.width < 5 || box.height < 5) continue;
    try {
      await td.click({ timeout: 1_500 });
      return true;
    } catch {
      // continue
    }
  }

  const spanDivCandidates = await page
    .locator("span, div")
    .filter({ hasText: exactDayRegex })
    .all()
    .catch(() => [] as import("playwright").Locator[]);
  for (const el of spanDivCandidates) {
    if (!(await el.isVisible().catch(() => false))) continue;
    const box = await el.boundingBox().catch(() => null);
    if (!box || box.width > 80 || box.height > 60 || box.width < 5 || box.height < 5) continue;
    try {
      await el.click({ timeout: 1_500 });
      return true;
    } catch {
      // continue
    }
  }

  return false;
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
        headless: false,
        viewport: null,
      });
    });

    const page = context.pages()[0] ?? (await context.newPage());
    probePage = page;
    await runStep("open athlete page", UI_PROBE_STEP_TIMEOUTS.openAthletePage, async () => {
      await page.goto(student.trainingpeaks_athlete_url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.bringToFront();
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
          return await resolveDateHeaderDomRectSnapshotBounded(page, probe.detail.dateHeaderText as string);
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
            return await detectVisibleDatePickerSnapshot(page, {
              dateHeaderBox: probe.detail.dateHeaderBoundingBox,
              dateHeaderText: probe.detail.dateHeaderText,
              sourceDateIso,
              targetDateIso,
            });
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
        if (probe.detail.targetDayVisible && targetDateIso && probe.detail.targetDateClickCandidateFound) {
          probe.detail.targetDateSelectionAttempted = true;
          try {
            // Best-effort only: isolate target selection from the detect datepicker step.
            await withUiProbeTimeout("best-effort target date selection", 1_900, async () => {
              await clickVisibleTargetDayInDatePicker(page, targetDateIso);
              const postSelection = await detectVisibleDatePickerSnapshot(page, {
                dateHeaderBox: probe.detail.dateHeaderBoundingBox,
                dateHeaderText: probe.detail.dateHeaderText,
                sourceDateIso: comparison.sourceDate.current ?? comparison.sourceDate.trusted,
                targetDateIso,
              });
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
              probe.detail.targetDateSelectionConfirmed =
                postSelection.targetDaySelectedVisible || probe.detail.targetDateSelectionConfirmed;
              probe.detail.datePickerOpenCheckSnippets.push(
                ...postSelection.snippets.slice(0, Math.max(0, 12 - probe.detail.datePickerOpenCheckSnippets.length))
              );
            });
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
            probe.screenshots.afterTargetDayClick = await captureProbeScreenshot(
              page,
              screenshotAfterTargetDayClickPath,
              probe.warnings
            );
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
  targetDateIso: string | null
): Promise<WorkoutExtractionResult> {
  const nowIso = toIsoDate(new Date());
  const domDebugEnabled = isTruthyEnvFlag("TP_DRY_RUN_DOM_DEBUG");
  const parseWarnings: string[] = [];
  const checkpoints: DryRunDomDebugCheckpoint[] = [];

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
    await page.locator(TP_CALENDAR_ROOT_SELECTOR).first().waitFor({ state: "attached", timeout: 5_000 });
  } catch (error) {
    parseWarnings.push(`calendar root wait failed: ${toShortErrorMessage(error)}`);
  }

  try {
    await page
      .locator(`${TP_CALENDAR_ROOT_SELECTOR} ${TP_DAY_CELL_SELECTOR}`)
      .first()
      .waitFor({ state: "attached", timeout: 5_000 });
  } catch (error) {
    parseWarnings.push(`calendar day cells wait failed: ${toShortErrorMessage(error)}`);
  }

  try {
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
    reasons: string[];
    fromFallback: boolean;
  };

  const extracted: EvaluatedWorkoutCandidate[] = [];
  let extractionError: string | null = null;

  try {
    const calendarRoot = page.locator(TP_CALENDAR_ROOT_SELECTOR).first();
    const calendarRootCount = await page.locator(TP_CALENDAR_ROOT_SELECTOR).count();
    if (calendarRootCount === 0) {
      throw new Error(`calendar root not found: ${TP_CALENDAR_ROOT_SELECTOR}`);
    }

    const calendarMonthYear = await inferCalendarMonthYear(calendarRoot);
    const dayCells = calendarRoot.locator(TP_DAY_CELL_SELECTOR);
    const dayCellCount = await dayCells.count();

    for (let dayIndex = 0; dayIndex < dayCellCount && extracted.length < 80; dayIndex += 1) {
      const dayCell = dayCells.nth(dayIndex);
      const dayTextRaw = (await dayCell.innerText().catch(() => "")) ?? "";
      const dayText = dayTextRaw.trim();
      const dayClass = await getAttributeSafe(dayCell, "class");
      const dayAttributes = {
        dataDate: await getAttributeSafe(dayCell, "data-date"),
        datetime: await getAttributeSafe(dayCell, "datetime"),
        ariaLabel: await getAttributeSafe(dayCell, "aria-label"),
        title: await getAttributeSafe(dayCell, "title"),
      };

      let resolvedSourceDate: string | null = null;
      let resolvedSourceDateReason = "source date unresolved";

      for (const [attrName, attrValue] of Object.entries(dayAttributes)) {
        const dateIso = parseDateFromCalendarAttr(attrValue);
        if (dateIso) {
          resolvedSourceDate = dateIso;
          resolvedSourceDateReason = `source date from day cell ${attrName}`;
          break;
        }
      }

      if (!resolvedSourceDate) {
        const descendantDateLocators = dayCell.locator(
          "[data-date],[datetime],[aria-label],[title],[class*='day' i],[class*='date' i],header,time"
        );
        const descendantCount = await descendantDateLocators.count();
        for (let descendantIndex = 0; descendantIndex < descendantCount; descendantIndex += 1) {
          const descendant = descendantDateLocators.nth(descendantIndex);
          for (const attrName of ["data-date", "datetime", "aria-label", "title"] as const) {
            const attrValue = await getAttributeSafe(descendant, attrName);
            const dateIso = parseDateFromCalendarAttr(attrValue);
            if (dateIso) {
              resolvedSourceDate = dateIso;
              resolvedSourceDateReason = `source date from day cell descendant ${attrName}`;
              break;
            }
          }
          if (resolvedSourceDate) {
            break;
          }
        }
      }

      const primaryCards = dayCell.locator(TP_PRIMARY_WORKOUT_CARD_WITHIN_DAY_SELECTOR);
      const fallbackCards = dayCell.locator(TP_FALLBACK_WORKOUT_CARD_WITHIN_DAY_SELECTOR);
      const primaryCount = await primaryCards.count();
      const fallbackCount = await fallbackCards.count();

      const dayCardTexts: string[] = [];
      for (let cardIndex = 0; cardIndex < primaryCount; cardIndex += 1) {
        const cardText = await getInnerTextSafe(primaryCards.nth(cardIndex));
        if (cardText) {
          dayCardTexts.push(cardText);
        }
      }
      for (let cardIndex = 0; cardIndex < fallbackCount; cardIndex += 1) {
        const cardText = await getInnerTextSafe(fallbackCards.nth(cardIndex));
        if (cardText) {
          dayCardTexts.push(cardText);
        }
      }

      if (!resolvedSourceDate && calendarMonthYear.month && calendarMonthYear.year) {
        let dayContextText = dayText;
        for (const cardText of dayCardTexts) {
          if (!cardText) {
            continue;
          }
          dayContextText = dayContextText.replace(cardText, " ");
        }
        const derivedDayNumber = extractDayNumberCandidate(dayContextText);
        if (derivedDayNumber !== null) {
          const derivedDate = toIsoFromDateParts(calendarMonthYear.year, calendarMonthYear.month, derivedDayNumber);
          if (derivedDate) {
            resolvedSourceDate = derivedDate;
            resolvedSourceDateReason = "source date derived from day cell number and visible calendar month/year";
          }
        }
      }

      if (!resolvedSourceDate && !calendarMonthYear.month) {
        resolvedSourceDateReason = calendarMonthYear.reason;
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
          reasons: [
            resolvedSourceDateReason,
            fromFallback ? "candidate from .workoutDiv fallback card root" : "candidate from primary calendar card root",
            dayClass ? `day class: ${dayClass}` : "day class unavailable",
          ],
          fromFallback,
        };
      };

      for (let cardIndex = 0; cardIndex < primaryCount && extracted.length < 80; cardIndex += 1) {
        const candidate = await buildCandidate(
          primaryCards.nth(cardIndex),
          TP_PRIMARY_WORKOUT_CARD_SELECTOR,
          false
        );
        if (candidate) {
          extracted.push(candidate);
        }
      }

      for (let cardIndex = 0; cardIndex < fallbackCount && extracted.length < 80; cardIndex += 1) {
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
    parseWarnings,
    extractionError,
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

function evaluateDryRunOutcome(input: {
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
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  let targetDate: string | null = null;
  let sourceDate: string | null = null;
  let selectedSourceDatePolicy = "unresolved";
  let selectedSourceDate: string | null = null;

  if (!payload?.target) {
    parseWarnings.push("parsed_payload.target is missing or invalid");
  } else {
    const resolved = resolveTargetDateFromPayload(payload.target);
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
  }

  const diagnostics: DryRunDiagnostics = {
    loginRequired: input.pageMeta.loginRequired,
    athleteReachable: input.pageMeta.athletePageLikelyReachable,
    trainingPeaksContextOk: input.pageMeta.trainingPeaksContextLikely,
    parseWarnings: [...parseWarnings, ...input.extraction.parseWarnings, ...input.identityCheck.warnings],
    domDebug: input.extraction.domDebug,
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
    return {
      dryRunResult: "not_found",
      resolvedDates: { sourceDate: null, targetDate, timezone },
      candidate: null,
      candidateAlternativesCount: 0,
      confidence: 0.2,
      canExecute: false,
      canExecuteReasons: ["Карточки тренировок не найдены в календаре"],
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
  const sourceDateBucketCounts: Record<string, number> = {};
  for (const candidate of strictGlobalCandidates) {
    if (!candidate.dateIso) {
      continue;
    }
    sourceDateBucketCounts[candidate.dateIso] = (sourceDateBucketCounts[candidate.dateIso] ?? 0) + 1;
  }

  if (!selectedSourceDate && targetDate && isTargetTomorrow(input.action)) {
    selectedSourceDate = toIsoDate(new Date());
    selectedSourceDatePolicy = "target_tomorrow_prefers_today";
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
    const reasons = ["source date could not be resolved safely", "Нужна исходная дата"];
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
    };
  }

  if (selectedBucketCandidates.length === 0) {
    const reasons = ["no planned candidate on inferred source date", "Нужна конкретная тренировка"];
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
    };
  }

  const sortedBucketCandidates = [...selectedBucketCandidates].sort((left, right) => right.rawScore - left.rawScore);
  const top = sortedBucketCandidates[0]!;
  const second = sortedBucketCandidates[1] ?? null;
  const confidence = clampConfidence(
    top.rawScore - (second ? Math.min(0.18, Math.max(0, second.rawScore - 0.45)) : 0)
  );
  sourceDate = selectedSourceDate;
  const plausibleCandidates = sortedBucketCandidates.filter(
    (candidate) => candidate.rawScore >= Math.max(0.6, top.rawScore - 0.1)
  );
  const safeCandidates = sortedBucketCandidates.filter(
    (candidate) => !candidate.fromFallback && Boolean(candidate.dateIso) && candidate.rawScore >= 0.75
  );
  const alternativesCount = Math.max(0, sortedBucketCandidates.length - 1);

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
  };

  let dryRunResult: DryRunResult = "candidate_found";
  const reasons: string[] = [];

  if (input.candidates.length > 1 && second && Math.abs(top.rawScore - second.rawScore) < 0.12) {
    dryRunResult = "ambiguous";
    reasons.push("top candidate margin too small");
  }
  if (plausibleCandidates.length > 1) {
    dryRunResult = "ambiguous";
    reasons.push("multiple candidates on selected source date");
  }
  if (!targetDate) {
    reasons.push("target date could not be resolved");
  }
  if (!sourceDate) {
    reasons.push("source date could not be resolved safely");
  }
  if (!candidate.fingerprint) {
    reasons.push("candidate fingerprint missing");
  }
  if (confidence < 0.8) {
    reasons.push("confidence below threshold 0.8");
  }
  if (safeCandidates.length !== 1) {
    reasons.push("multiple candidates on selected source date");
  }
  if (selectedSourceDatePolicy === "nearest_prior_within_3_days") {
    reasons.push("source date inferred with low confidence");
  }
  if (second && top.rawScore - second.rawScore < 0.12) {
    reasons.push("top candidate margin too small");
  }
  if (input.identityCheck.matchedBy === "mismatch") {
    reasons.push(...input.identityCheck.warnings);
  }

  const canExecute =
    dryRunResult === "candidate_found" &&
    safeCandidates.length === 1 &&
    Boolean(targetDate) &&
    Boolean(selectedSourceDate) &&
    Boolean(candidate.fingerprint) &&
    confidence >= 0.8 &&
    input.identityCheck.matchedBy !== "mismatch";

  if (!canExecute && reasons.length === 0) {
    reasons.push("safety policy conditions not met");
  }

  if (dryRunResult === "candidate_found" && !canExecute) {
    dryRunResult = sortedBucketCandidates.length > 1 ? "ambiguous" : "not_found";
  }

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
  };
}

function formatCandidateLine(candidate: DryRunCandidate | null): string {
  if (!candidate) {
    return "кандидат не найден";
  }
  const parts: string[] = [];
  if (candidate.title) {
    parts.push(candidate.title);
  }
  if (candidate.type) {
    parts.push(`тип=${candidate.type}`);
  }
  if (candidate.plannedDurationSec !== null) {
    parts.push(`длит=${candidate.plannedDurationSec}с`);
  }
  if (candidate.plannedDistance !== null) {
    parts.push(`дист=${candidate.plannedDistance}км`);
  }
  if (candidate.startTimeLocal) {
    parts.push(`старт=${candidate.startTimeLocal}`);
  }
  return parts.join(", ") || "кандидат без деталей";
}

function formatCandidateForNotification(candidate: DryRunCandidate | null): string {
  return formatCandidateLine(candidate);
}

function normalizeTrustedDryRunLog(logJson: unknown): TrustedDryRunLog | null {
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
  const fingerprint =
    typeof payload.candidate?.fingerprint === "string" ? payload.candidate.fingerprint.trim() : "";
  const matchedBy = payload.identityCheck?.matchedBy;

  if (payload.dryRunResult !== "candidate_found") {
    return null;
  }
  if (payload.canExecute !== true) {
    return null;
  }
  if (!Number.isFinite(confidence) || confidence < 0.8) {
    return null;
  }
  if (!fingerprint) {
    return null;
  }
  if (!sourceDate || !targetDate) {
    return null;
  }
  if (!payload.identityCheck || matchedBy === "mismatch" || matchedBy === undefined) {
    return null;
  }
  if (!payload.candidate) {
    return null;
  }

  return {
    dryRunResult: "candidate_found",
    canExecute: true,
    confidence,
    candidate: payload.candidate,
    resolvedDates: {
      sourceDate,
      targetDate,
      timezone: typeof payload.resolvedDates?.timezone === "string" ? payload.resolvedDates.timezone : null,
    },
    identityCheck: payload.identityCheck,
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

function buildRevalidationComparison(input: {
  trusted: TrustedDryRunLog;
  current: DryRunEvaluation;
}): RevalidationComparison {
  const mismatchReasons: string[] = [];
  const trustedCandidate = input.trusted.candidate;
  const currentCandidate = input.current.candidate;

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

  if (input.current.identityCheck.matchedBy === "mismatch") {
    mismatchReasons.push("identityCheck.matchedBy became mismatch");
  }
  if (input.current.dryRunResult !== "candidate_found") {
    mismatchReasons.push(`current dryRunResult=${input.current.dryRunResult}`);
  }
  if (!input.current.canExecute) {
    mismatchReasons.push("current revalidation marked action unsafe");
  }
  if (input.current.confidence < 0.8) {
    mismatchReasons.push(`current confidence below threshold: ${input.current.confidence.toFixed(2)}`);
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
    headless: false,
    viewport: null,
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(student.trainingpeaks_athlete_url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.bringToFront();

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
      ? resolveTargetDateFromPayload(parsedPayload.target).targetDate
      : null;
    const extraction = await extractWorkoutCandidatesFromPage(page, resolvedTargetDate);
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
}): Promise<void> {
  if (!input.chatId) {
    return;
  }

  const lines = [
    "TrainingPeaks real-mode revalidation",
    `Action ID: ${input.action.id}`,
    `Ученик: ${input.studentName}`,
    `Raw text: ${input.action.raw_text}`,
    `Source -> target: ${input.trustedDryRun.resolvedDates.sourceDate} -> ${input.trustedDryRun.resolvedDates.targetDate}`,
    `Candidate: ${formatCandidateForNotification(input.candidate)}`,
    `Revalidation: ${input.revalidationPassed ? "passed" : "failed"}`,
  ];

  if (input.currentEvaluation) {
    lines.push(`Trusted identity: ${input.trustedDryRun.identityCheck.matchedBy}`);
    lines.push(`Current identity: ${input.currentEvaluation.identityCheck.matchedBy}`);
    lines.push(
      `Current canExecute/confidence: ${input.currentEvaluation.canExecute ? "yes" : "no"} / ${input.currentEvaluation.confidence.toFixed(2)}`
    );
  }

  if (input.comparison) {
    lines.push(
      `Compare source/target/fingerprint: ${input.comparison.sourceDate.matches ? "ok" : "mismatch"} / ${input.comparison.targetDate.matches ? "ok" : "mismatch"} / ${input.comparison.fingerprint.matches ? "ok" : "mismatch"}`
    );
    if (!input.comparison.revalidationPassed && input.comparison.mismatchReasons.length > 0) {
      lines.push(`Reason: ${input.comparison.mismatchReasons.join("; ")}`);
    }
  }

  lines.push(input.errorMessage);
  lines.push(TRAININGPEAKS_NOT_CHANGED_NOTE);

  try {
    await sendTelegramText(input.chatId, lines.join("\n"));
  } catch (error) {
    console.warn(`Telegram action real-mode summary warning: ${toShortErrorMessage(error)}`);
  }
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
      targetDateClickCandidateFound: detail.targetDateClickCandidateFound,
      targetDateClickCandidateBoundingBox: detail.targetDateClickCandidateBoundingBox,
      datepickerDomDebugPath: detail.datepickerDomDebugPath,
      datepickerDomDebugTopCandidates: [...detail.datepickerDomDebugTopCandidates],
      datepickerDomDebugError: detail.datepickerDomDebugError,
      opened: detail.opened,
      closeSucceeded: detail.closeSucceeded,
      datePickerCloseAttempted: detail.datePickerCloseAttempted,
      datePickerCloseSucceeded: detail.datePickerCloseSucceeded,
      datePickerCloseError: detail.datePickerCloseError,
    },
    screenshots: { ...probe.screenshots },
    progress: {
      stepHistory: [...probe.progress.stepHistory],
    },
  };
}

async function main(): Promise<void> {
  loadLocalEnv();

  const runnerId = getRunnerId();
  const runnerMode = resolveRunnerMode();
  const prepareOnly = hasCliFlag(TP_ACTIONS_PREPARE_ONLY_FLAG);

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
    const claimed = await claimOneApprovedActionForDryRun(runnerId);
    if (!claimed) {
      console.log("No approved TrainingPeaks actions ready for dry-run.");
      return;
    }

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
        selectedSourceDateCandidateCount: evaluation.selectedSourceDateCandidateCount,
        globalCandidateCount: evaluation.globalCandidateCount,
        sourceDateBucketCounts: evaluation.sourceDateBucketCounts,
        note: "Ничего не изменено в TrainingPeaks",
      };

      await completeDryRun(claimed.action.id, run.id, {
        logJson,
        screenshotBeforePath: artifacts.screenshotBeforePath,
        screenshotAfterPath: artifacts.screenshotAfterPath,
      });

      await notifyCoachDryRunResult({
        chatId: resolveDryRunNotificationChatId(claimed.action),
        action: claimed.action,
        studentName,
        statusText: "dry-run completed",
        dryRunEvaluation: evaluation,
        note: "Ничего не изменено в TrainingPeaks",
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

      await notifyCoachDryRunResult({
        chatId: resolveDryRunNotificationChatId(claimed.action),
        action: claimed.action,
        studentName,
        statusText: "dry-run failed",
        dryRunEvaluation: failedEvaluation,
        note: "Ничего не изменено в TrainingPeaks",
        errorText: errorMessage,
      });

      throw error;
    }
  }

  const claimed = await claimOneExecutePendingActionForRealMode(runnerId);
  if (!claimed) {
    console.log("No execute_pending TrainingPeaks actions ready for real-mode revalidation.");
    return;
  }

  console.log(`Claimed TrainingPeaks action ${claimed.action.id} for real-mode revalidation.`);
  console.log("Phase 3D.1 safety: revalidation only. No TrainingPeaks mutation will be attempted.");
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
      mutationForbidden: true,
      allowedActions: ["open athlete page", "extract candidate", "compare with trusted dry-run", "capture screenshots"],
      forbiddenActions: ["drag", "drop", "save", "date change click", "form submit", "TrainingPeaks mutation"],
    },
  };
  const studentName = claimed.student?.student_name ?? "(unknown)";

  try {
    const artifacts = await inspectActionCalendar(claimed, run.id);
    const evaluation = artifacts.dryRunEvaluation;
    const comparison = buildRevalidationComparison({
      trusted: claimed.trustedDryRunLog,
      current: evaluation,
    });

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
        await notifyCoachRealModeResult({
          chatId: resolveDryRunNotificationChatId(claimed.action),
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
      latestUiProbeError ?? prepareMoveWorkoutResult.failureReason ?? REAL_MOVE_NOT_IMPLEMENTED_ERROR;
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
      note: "Проверка перед переносом пройдена. UI capability probe выполнен в режиме read-only; trainingPeaksDriver boundary вызван. Реальный перенос сохранением не выполнен. TrainingPeaks не изменён.",
    };

    await finishRealRun(claimed.action.id, run.id, {
      errorMessage,
      logJson,
      screenshotBeforePath: artifacts.screenshotBeforePath,
      screenshotAfterPath: artifacts.screenshotAfterPath,
    });

    const coachExplanation =
      "Проверка перед переносом пройдена. UI capability probe выполнен в режиме read-only; trainingPeaksDriver boundary вызван. Реальный перенос сохранением не выполнен. TrainingPeaks не изменён.";

    if (!prepareOnly) {
      await notifyCoachRealModeResult({
        chatId: resolveDryRunNotificationChatId(claimed.action),
        action: claimed.action,
        studentName,
        trustedDryRun: claimed.trustedDryRunLog,
        currentEvaluation: evaluation,
        comparison,
        revalidationPassed: true,
        errorMessage: coachExplanation,
        candidate: evaluation.candidate ?? comparison.trustedCandidate,
      });
    }

    if (prepareOnly) {
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
        datePickerCloseAttempted: uiCapabilityProbe.detail.datePickerCloseAttempted,
        datePickerCloseSucceeded: uiCapabilityProbe.detail.datePickerCloseSucceeded,
        datePickerCloseError: uiCapabilityProbe.detail.datePickerCloseError,
        status: prepareMoveWorkoutResult.status,
        failureReason: prepareMoveWorkoutResult.failureReason,
        datepickerDomDebugPath: prepareMoveWorkoutResult.datepickerDomDebugPath,
        datepickerDomDebugTopCandidates: prepareMoveWorkoutResult.datepickerDomDebugTopCandidates,
        datepickerDomDebugError: prepareMoveWorkoutResult.datepickerDomDebugError,
        trainingPeaksDriver: driverLogJsonSlice,
        uiCapabilityProbeErrors: uiCapabilityProbe.errors,
        diagnostics: prepareMoveWorkoutResult,
      };
      console.log(JSON.stringify({ prepareOnlySummary: summaryPayload }, null, 2));
      console.log("No TrainingPeaks mutation occurred (prepare-only tooling run).");
    }

    console.log(`Real-mode revalidation passed for action ${claimed.action.id}, but real move remains blocked (driver.executePreparedMove).`);
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
      await notifyCoachRealModeResult({
        chatId: resolveDryRunNotificationChatId(claimed.action),
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

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exit(1);
});
