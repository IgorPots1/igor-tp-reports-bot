import type {
  ExecuteMoveWorkoutResult,
  PrepareMoveWorkoutResult,
  RecommendedNextDriver,
  TrainingPeaksAutomationDriver,
  TrainingPeaksMoveStatus,
  ValidateMoveWorkoutResult,
} from "./trainingpeaks-driver.ts";

/** Exact message contract for Phase 3D — execute remains unwired until prepare validates ready_to_save. */
export const TRAININGPEAKS_EXECUTE_PREPARED_MOVE_BLOCKED_MESSAGE =
  "Real move execution remains blocked until prepareMoveWorkout has stable ready_to_save validation.";

/** Minimal probe shape from tp-actions-once UiCapabilityProbe (structural typing; no circular import). */
export type ProbeLike = {
  errors: string[];
  warnings: string[];
  detail: {
    dateHeaderText: string | null;
    currentDateValue: string | null;
    datePickerOpened: boolean;
    saveButtonFound: boolean;
    saveAndCloseButtonFound: boolean;
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
    datepickerDomDebugPath: string | null;
    datepickerDomDebugTopCandidates: string[];
    datepickerDomDebugError: string | null;
    opened: boolean;
    closeSucceeded: boolean;
    datePickerCloseAttempted: boolean;
    datePickerCloseSucceeded: boolean;
    datePickerCloseError: string | null;
  };
  screenshots: Record<string, string | null>;
  progress: {
    stepHistory: string[];
  };
};

export type IdentityMatchLike =
  | "athlete_id"
  | "trainingpeaks_name"
  | "inconclusive"
  | "mismatch";

export type PlaywrightOnlyTrainingPeaksDriverDeps = {
  expectedActionId: string;
  sourceDateIso: string | null;
  targetDateIso: string | null;
  athleteIdentityMatchedBy: IdentityMatchLike;
  candidateFingerprintMatches: boolean;
  runProbe: () => Promise<ProbeLike>;
};

const MONTH_LONG = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

function stripLeadingZero(segment: string): string {
  if (segment.startsWith("0") && segment.length === 2) {
    return segment.slice(1);
  }
  return segment;
}

/**
 * Loose check: modal/header text visibly references the ISO target calendar day
 * (we never mutate the date in Phase 3D prepare; modal usually shows the source workout date).
 */
function naturalLanguageTextsReferenceTargetIso(
  iso: string,
  fragments: readonly (string | null | undefined)[]
): boolean {
  const m = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) {
    return false;
  }
  const year = m[1];
  const mm = Number(m[2]);
  const day = stripLeadingZero(m[3]);
  if (!Number.isFinite(mm) || mm < 1 || mm > 12) {
    return false;
  }
  const monthName = MONTH_LONG[mm - 1];
  const lowerParts = fragments
    .map((fragment) => (fragment ? fragment.toLowerCase().replace(/\s+/g, " ").trim() : ""))
    .filter(Boolean);

  for (const text of lowerParts) {
    if (text.includes(iso)) {
      return true;
    }
    if (text.includes(year) && (text.includes(monthName) || text.includes(monthName.slice(0, 3)))) {
      const dayWord = `(^|[^0-9])${day}([^0-9]|$)`;
      if (new RegExp(dayWord, "i").test(text)) {
        return true;
      }
    }
  }

  return false;
}

export function derivePrepareMoveWorkoutResultFromProbe(
  probe: ProbeLike,
  input: Pick<
    PlaywrightOnlyTrainingPeaksDriverDeps,
    "athleteIdentityMatchedBy" | "candidateFingerprintMatches" | "targetDateIso" | "sourceDateIso"
  >
): Omit<PrepareMoveWorkoutResult, "screenshots" | "stepHistory"> &
  Pick<PrepareMoveWorkoutResult, "screenshots" | "stepHistory"> {
  const athleteIdentityOk =
    input.athleteIdentityMatchedBy !== "inconclusive" && input.athleteIdentityMatchedBy !== "mismatch";
  const candidateFingerprintOk = input.candidateFingerprintMatches;

  const dateHeaderText = probe.detail.dateHeaderText;
  const saveButtonVisible =
    probe.detail.saveButtonFound || probe.detail.saveAndCloseButtonFound;

  const targetIso = input.targetDateIso;
  const datePickerOpened = probe.detail.datePickerOpened;
  const targetDateSelectionConfirmed = probe.detail.targetDateSelectionConfirmed;
  const targetDateVisible =
    targetIso !== null
      ? probe.detail.targetDayVisible ||
        targetDateSelectionConfirmed ||
        naturalLanguageTextsReferenceTargetIso(targetIso, [dateHeaderText, probe.detail.currentDateValue])
      : false;

  const instabilityHints = [
    "Date header clicked, but datepicker was not detected",
    'timeout at step "detect datepicker"',
    "UI capability probe timeout",
  ];

  let recommendedNextDriver: RecommendedNextDriver = "playwright";
  const combinedErrors = [...probe.errors, ...probe.warnings.filter((warning) =>
    instabilityHints.some((hint) => warning.includes(hint))
  )];
  let failureReason: string | null =
    probe.errors.length > 0 ? probe.errors[probe.errors.length - 1] : null;

  let status: TrainingPeaksMoveStatus;

  const loginOrReachability = probe.errors.some(
    (line) =>
      /login required|session expired|not safely reachable/i.test(line) ||
      line.includes("Probe aborted: athlete TrainingPeaks page")
  );

  const unsafeStructure = probe.errors.some(
    (line) =>
      line.includes("could not confirm a safe close") ||
      line.includes("opened the card menu but could not confirm")
  );

  if (loginOrReachability || unsafeStructure) {
    status = "unsafe";
    recommendedNextDriver = "manual";
  } else if (combinedErrors.some((line) => instabilityHints.some((hint) => line.includes(hint)))) {
    status = "needs_manual";
    recommendedNextDriver = "manual";
    failureReason = failureReason ?? "Datepicker probing was unstable under Playwright selectors.";
  } else if (datePickerOpened && targetDateVisible && !probe.detail.targetDateClickCandidateFound) {
    status = "needs_manual";
    recommendedNextDriver = "manual";
    failureReason =
      "Datepicker detected and target date visible, but no unambiguous target day click candidate was found.";
  } else if (
    probe.detail.opened &&
    datePickerOpened &&
    probe.detail.targetDateSelectionAttempted &&
    !targetDateSelectionConfirmed &&
    probe.errors.length === 0
  ) {
    status = "needs_manual";
    recommendedNextDriver = "manual";
    failureReason = "Target date click was attempted, but selection could not be confirmed.";
  } else if (probe.detail.opened && datePickerOpened && !targetDateSelectionConfirmed && probe.errors.length === 0) {
    status = "needs_manual";
    recommendedNextDriver = "manual";
    failureReason = failureReason ?? "Datepicker opened but target date could not be safely confirmed as selected.";
  } else if (!targetDateVisible) {
    status = "needs_manual";
    recommendedNextDriver = "manual";
    failureReason = failureReason ?? "Target selection could not be verified safely.";
  } else if (datePickerOpened && targetDateSelectionConfirmed) {
    status = "ready_to_save";
    recommendedNextDriver = "playwright";
    failureReason = null;
  } else {
    status = "needs_manual";
    recommendedNextDriver = "playwright";
    failureReason = failureReason ?? "Target date visibility was inferred but selected state could not be confirmed.";
  }

  return {
    status,
    athleteIdentityOk,
    candidateFingerprintOk,
    sourceDate: input.sourceDateIso,
    targetDate: input.targetDateIso,
    dateHeaderText,
    datePickerOpened,
    targetDateVisible,
    datePickerDetectionStrategy: probe.detail.datePickerDetectionStrategy,
    datePickerBoundingBox: probe.detail.datePickerBoundingBox,
    visibleMonth: probe.detail.visibleMonth,
    visibleYear: probe.detail.visibleYear,
    visibleDayCandidates: [...probe.detail.visibleDayCandidates],
    targetDayVisible: probe.detail.targetDayVisible,
    selectedSourceDayVisible: probe.detail.selectedSourceDayVisible,
    targetDateSelectionAttempted: probe.detail.targetDateSelectionAttempted,
    targetDateSelectionConfirmed,
    targetDateClickCandidateFound: probe.detail.targetDateClickCandidateFound,
    targetDateClickCandidateBoundingBox: probe.detail.targetDateClickCandidateBoundingBox,
    datepickerDomDebugPath: probe.detail.datepickerDomDebugPath,
    datepickerDomDebugTopCandidates: [...probe.detail.datepickerDomDebugTopCandidates],
    datepickerDomDebugError: probe.detail.datepickerDomDebugError,
    mutationOccurred: false,
    saveButtonVisible,
    screenshots: { ...probe.screenshots },
    stepHistory: [...probe.progress.stepHistory],
    failureReason,
    recommendedNextDriver,
  };
}

export class PlaywrightOnlyTrainingPeaksDriver implements TrainingPeaksAutomationDriver {
  constructor(private readonly deps: PlaywrightOnlyTrainingPeaksDriverDeps) {}

  async prepareMoveWorkout(actionId: string): Promise<PrepareMoveWorkoutResult> {
    const failed = (failureReason: string): PrepareMoveWorkoutResult => ({
      status: "failed",
      athleteIdentityOk:
        this.deps.athleteIdentityMatchedBy !== "inconclusive" &&
        this.deps.athleteIdentityMatchedBy !== "mismatch",
      candidateFingerprintOk: this.deps.candidateFingerprintMatches,
      sourceDate: this.deps.sourceDateIso,
      targetDate: this.deps.targetDateIso,
      dateHeaderText: null,
      datePickerOpened: false,
      targetDateVisible: false,
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
      datepickerDomDebugPath: null,
      datepickerDomDebugTopCandidates: [],
      datepickerDomDebugError: null,
      mutationOccurred: false,
      saveButtonVisible: false,
      screenshots: {},
      stepHistory: [],
      failureReason,
      recommendedNextDriver: "manual",
    });

    if (actionId !== this.deps.expectedActionId) {
      return failed(`prepareMoveWorkout actionId mismatch (expected ${this.deps.expectedActionId}, got ${actionId}).`);
    }

    try {
      const probe = await this.deps.runProbe();
      return derivePrepareMoveWorkoutResultFromProbe(probe, {
        athleteIdentityMatchedBy: this.deps.athleteIdentityMatchedBy,
        candidateFingerprintMatches: this.deps.candidateFingerprintMatches,
        sourceDateIso: this.deps.sourceDateIso,
        targetDateIso: this.deps.targetDateIso,
      });
    } catch (error: unknown) {
      const failureReason =
        typeof error === "object" && error !== null && "message" in error
          ? String((error as { message: unknown }).message)
          : String(error);

      const base = derivePrepareMoveWorkoutResultFromProbe(
        {
          errors: [failureReason],
          warnings: [],
          detail: {
            dateHeaderText: null,
            currentDateValue: null,
            datePickerOpened: false,
            saveButtonFound: false,
            saveAndCloseButtonFound: false,
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
            datepickerDomDebugPath: null,
            datepickerDomDebugTopCandidates: [],
            datepickerDomDebugError: null,
            opened: false,
            closeSucceeded: false,
            datePickerCloseAttempted: false,
            datePickerCloseSucceeded: false,
            datePickerCloseError: null,
          },
          screenshots: {},
          progress: { stepHistory: [] },
        },
        {
          athleteIdentityMatchedBy: this.deps.athleteIdentityMatchedBy,
          candidateFingerprintMatches: this.deps.candidateFingerprintMatches,
          sourceDateIso: this.deps.sourceDateIso,
          targetDateIso: this.deps.targetDateIso,
        }
      );

      return { ...base, status: "failed", failureReason, recommendedNextDriver: "manual" };
    }
  }

  async executePreparedMove(_actionId: string): Promise<ExecuteMoveWorkoutResult> {
    void _actionId;
    return {
      status: "failed",
      blocked: true,
      message: TRAININGPEAKS_EXECUTE_PREPARED_MOVE_BLOCKED_MESSAGE,
      failureReason: TRAININGPEAKS_EXECUTE_PREPARED_MOVE_BLOCKED_MESSAGE,
      recommendedNextDriver: "manual",
    };
  }

  async validateMoveWorkout(actionId: string): Promise<ValidateMoveWorkoutResult> {
    if (actionId !== this.deps.expectedActionId) {
      return {
        status: "failed",
        failureReason: `validateMoveWorkout actionId mismatch (expected ${this.deps.expectedActionId}, got ${actionId}).`,
        recommendedNextDriver: "manual",
      };
    }

    return {
      status: "needs_manual",
      failureReason:
        "Playwright-only boundary: validateMoveWorkout is deferred until automated execute path exists.",
      recommendedNextDriver: "manual",
    };
  }
}
