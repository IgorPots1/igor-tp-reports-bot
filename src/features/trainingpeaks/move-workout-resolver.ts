import { createHash } from "node:crypto";

import { classifyTrainingPeaksWorkoutActivity } from "./workout-activity-classification.ts";

/**
 * M1 (move-http-shadow plan) -- pure candidate matcher for resolving a move's
 * concrete numeric workoutId from the LIVE TrainingPeaks API, instead of the
 * old path's DOM card scrape. Live-API primary, per Igor's decision --
 * trainingpeaks_workout_cache is populated only by a manual, cron-less
 * Mac-runner scan and has a documented staleness failure mode (the 17-vs-18
 * discrepancy, PR2 ops-log). The cache is used elsewhere (M2) as a
 * cross-check only, never here as a resolution source.
 *
 * Split pure/impure exactly like batch-preview.ts / batch-preview-context.ts:
 * this file has zero DB/network dependency, so its unit tests run under plain
 * `node --experimental-strip-types` with hand-built fixtures. The impure half
 * (the live getWorkoutsByDateRange call + athleteId->studentId resolution)
 * lives in the sibling file move-workout-resolver-context.ts.
 *
 * SAFETY CONTRACT (M1 scope): this module is READ-ONLY and is not wired into
 * any execution path. It never mutates anything, never calls a write
 * endpoint. Correctness is judged by WORKOUT ID EQUALITY against the old
 * path's DOM-scraped ground truth (checked one layer up, in M2's shadow
 * comparator) -- NOT by byte-exact fingerprint match. API vs DOM field
 * formatting WILL differ (units, title truncation, time format); those
 * differences are recorded as per-field diagnostics, never treated as a
 * matching failure on their own.
 *
 * ABSTAIN IS A FIRST-CLASS RESULT, NOT AN ERROR. When the resolver is not
 * confident, it returns resolvedWorkoutId: null with a matchKind explaining
 * why (not_found / ambiguous) -- it never guesses. A silent guess is worse
 * than a refusal: a wrong guess is invisible in the log until it moves the
 * wrong athlete's workout; an honest abstention is visible immediately and,
 * in M4's design, falls back to the proven DOM path.
 */

// ─── DOM-side fingerprint (duplicated verbatim from tp-actions-once.ts's
// buildCandidateFingerprint -- NOT imported, since src/ cannot depend on the
// tools/ Playwright-adjacent script and this exact algorithm is the contract
// a byte-exact match must reproduce; see tp-actions-once.ts:2507-2526) ──────

export function buildDomCompatibleFingerprint(input: {
  studentId: string | null;
  dateIso: string | null;
  title: string | null;
  type: string | null;
  startTimeLocal: string | null;
  plannedDurationSec: number | null;
  plannedDistanceKm: number | null;
}): string {
  const stable = [
    input.studentId ?? "na",
    input.dateIso ?? "na",
    (input.title ?? "untitled").trim().toLowerCase(),
    (input.type ?? "na").trim().toLowerCase(),
    input.startTimeLocal ?? "na",
    input.plannedDurationSec === null ? "na" : String(input.plannedDurationSec),
    input.plannedDistanceKm === null ? "na" : String(input.plannedDistanceKm),
  ].join("|");
  return createHash("sha1").update(stable).digest("hex");
}

// ─── types ──────────────────────────────────────────────────────────────────────

/**
 * The DOM dry-run's candidate, as already captured in trainingpeaks_action_runs
 * .log_json.candidate (tp-actions-once.ts:6722-6740, :9297-9325). plannedDistanceKm
 * matches DOM's own unit convention (tp-actions-once.ts's parseDistance() converts
 * everything to km, despite the field being informally called "plannedDistance"
 * there -- named explicitly here to avoid re-introducing that ambiguity).
 * domScrapedWorkoutId is the DOM path's own opportunistic scrape
 * (extractWorkoutIdFromCard) -- it is the GROUND TRUTH the shadow comparator
 * (M2) checks the resolver's answer against, one layer up. The resolver itself
 * never reads or trusts this field -- it must reach its answer independently,
 * from live data alone, or the comparison would be circular.
 */
export type MoveWorkoutDomCandidate = {
  fingerprint: string;
  title: string | null;
  type: string | null; // DOM vocabulary: "run" | "bike" | "swim" | "strength" | null
  startTimeLocal: string | null;
  plannedDurationSec: number | null;
  plannedDistanceKm: number | null;
};

/** A workout as read from the live TrainingPeaks API for one athlete/day. */
export type LiveWorkoutCandidate = {
  workoutId: number;
  title: string | null;
  workoutTypeValueId: number | null;
  /** TP's own convention (confirmed via running-workout-renderer.ts: totalTimePlanned = seconds/3600). */
  totalTimePlannedHours: number | null;
  /**
   * ASSUMED to be meters (TP's typical convention for this field; matches
   * this codebase's own CreateWorkoutPayload usage in PR3/PR4). NOT verified
   * against a live response with a non-null value in this repo as of M1 --
   * flagged here deliberately rather than silently assumed. If M3's shadow
   * data shows "distance" never agreeing, this is the first thing to check.
   */
  distancePlannedMeters: number | null;
  startTimePlanned: string | null;
};

export type MoveWorkoutMatchKind = "fingerprint_exact" | "fields_unique" | "ambiguous" | "not_found";

export type MoveWorkoutFieldName = "type" | "title" | "duration" | "distance";
export type MoveWorkoutFieldVerdict = "agree" | "contradict" | "not_comparable";

export type MoveWorkoutFieldComparison = {
  field: MoveWorkoutFieldName;
  domValue: string | null;
  liveValue: string | null;
  verdict: MoveWorkoutFieldVerdict;
};

export type MoveWorkoutCandidateEvaluation = {
  workoutId: number;
  recomputedFingerprint: string;
  fingerprintMatches: boolean;
  comparisons: MoveWorkoutFieldComparison[];
  agreementCount: number;
  contradictionCount: number;
  /** contradictionCount === 0 && agreementCount >= 1 -- at least one concrete
   * signal agrees and NOTHING concrete disagrees. A single contradicting
   * field (e.g. type=run vs type=swim) disqualifies a candidate outright. */
  isPlausibleMatch: boolean;
};

export type MoveWorkoutResolution = {
  resolvedWorkoutId: number | null;
  matchKind: MoveWorkoutMatchKind;
  candidatesOnDate: number;
  /** null exactly when resolvedWorkoutId is non-null. */
  abstainReason: string | null;
  /** Every live candidate considered on this date, full transparency for the shadow log. */
  evaluations: MoveWorkoutCandidateEvaluation[];
};

// ─── field-level comparison (tolerant, format-aware) ───────────────────────────

const DURATION_TOLERANCE_SEC = 5 * 60; // 5 minutes -- absorbs DOM text-scrape rounding
const DISTANCE_TOLERANCE_KM_FLOOR = 0.5; // half a km, or 10% relative, whichever is larger

function normalizeTitle(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

/**
 * DOM card text is truncated to ~120 chars (extractTitleFromCardText,
 * tp-actions-once.ts) -- the DOM title is a PREFIX/substring of the fuller
 * live title, one direction only. The reverse does NOT hold: a live title
 * that happens to be a substring of a MORE SPECIFIC dom title is evidence of
 * a DIFFERENT workout, not truncation (e.g. dom "Treadmill Running" must NOT
 * agree with a live "Running" -- that was a real bug caught against live
 * data on 3102415, where a generic "Running" candidate on a 4-workout day
 * falsely matched every "Running"-titled workout via bidirectional
 * containment; symmetric substring matching is deliberately NOT used).
 */
function compareTitles(domTitle: string | null, liveTitle: string | null): MoveWorkoutFieldVerdict {
  const dom = normalizeTitle(domTitle);
  const live = normalizeTitle(liveTitle);
  if (!dom || !live) return "not_comparable";
  if (dom === live || live.includes(dom)) return "agree";
  return "contradict";
}

/** Maps a live workout's classification onto the DOM's narrow 4-word vocabulary; anything else is "not comparable". */
function liveFamilyInDomVocabulary(live: LiveWorkoutCandidate): string | null {
  const classification = classifyTrainingPeaksWorkoutActivity({
    title: live.title,
    workoutTypeValueId: live.workoutTypeValueId,
  });
  const { family } = classification;
  return family === "run" || family === "bike" || family === "swim" || family === "strength" ? family : null;
}

function compareTypes(domType: string | null, liveFamily: string | null): MoveWorkoutFieldVerdict {
  if (!domType || !liveFamily) return "not_comparable";
  return domType === liveFamily ? "agree" : "contradict";
}

function compareDuration(domSec: number | null, liveHours: number | null): MoveWorkoutFieldVerdict {
  if (domSec === null || liveHours === null) return "not_comparable";
  const liveSec = liveHours * 3600;
  return Math.abs(domSec - liveSec) <= DURATION_TOLERANCE_SEC ? "agree" : "contradict";
}

function compareDistance(domKm: number | null, liveKm: number | null): MoveWorkoutFieldVerdict {
  if (domKm === null || liveKm === null) return "not_comparable";
  const tolerance = Math.max(DISTANCE_TOLERANCE_KM_FLOOR, domKm * 0.1);
  return Math.abs(domKm - liveKm) <= tolerance ? "agree" : "contradict";
}

// ─── per-candidate evaluation ───────────────────────────────────────────────────

export function evaluateMoveWorkoutCandidate(
  domCandidate: MoveWorkoutDomCandidate,
  studentId: string | null,
  dateIso: string,
  live: LiveWorkoutCandidate,
): MoveWorkoutCandidateEvaluation {
  const liveFamily = liveFamilyInDomVocabulary(live);
  const liveDistanceKm = live.distancePlannedMeters === null ? null : Number((live.distancePlannedMeters / 1000).toFixed(3));
  const liveDurationSec = live.totalTimePlannedHours === null ? null : Math.round(live.totalTimePlannedHours * 3600);

  const recomputedFingerprint = buildDomCompatibleFingerprint({
    studentId,
    dateIso,
    title: live.title,
    type: liveFamily,
    startTimeLocal: live.startTimePlanned, // API format likely differs from DOM's HH:MM scrape -- diagnostic only, not scored
    plannedDurationSec: liveDurationSec,
    plannedDistanceKm: liveDistanceKm,
  });

  const comparisons: MoveWorkoutFieldComparison[] = [
    {
      field: "type",
      domValue: domCandidate.type,
      liveValue: liveFamily,
      verdict: compareTypes(domCandidate.type, liveFamily),
    },
    {
      field: "title",
      domValue: domCandidate.title,
      liveValue: live.title,
      verdict: compareTitles(domCandidate.title, live.title),
    },
    {
      field: "duration",
      domValue: domCandidate.plannedDurationSec === null ? null : String(domCandidate.plannedDurationSec),
      liveValue: liveDurationSec === null ? null : String(liveDurationSec),
      verdict: compareDuration(domCandidate.plannedDurationSec, live.totalTimePlannedHours),
    },
    {
      field: "distance",
      domValue: domCandidate.plannedDistanceKm === null ? null : String(domCandidate.plannedDistanceKm),
      liveValue: liveDistanceKm === null ? null : String(liveDistanceKm),
      verdict: compareDistance(domCandidate.plannedDistanceKm, liveDistanceKm),
    },
  ];

  const agreementCount = comparisons.filter((c) => c.verdict === "agree").length;
  const contradictionCount = comparisons.filter((c) => c.verdict === "contradict").length;

  return {
    workoutId: live.workoutId,
    recomputedFingerprint,
    fingerprintMatches: recomputedFingerprint === domCandidate.fingerprint,
    comparisons,
    agreementCount,
    contradictionCount,
    isPlausibleMatch: contradictionCount === 0 && agreementCount >= 1,
  };
}

// ─── top-level match ────────────────────────────────────────────────────────────

/**
 * Resolves a move's workoutId from a set of live-API candidates on the
 * already-resolved source date. Never throws on malformed/sparse input data
 * -- returns not_found/ambiguous instead. Decision order:
 *   1. Zero live candidates on the date -> not_found (abstain).
 *   2. Exactly one candidate with a byte-exact recomputed fingerprint ->
 *      fingerprint_exact (strongest possible signal).
 *   3. More than one exact-fingerprint match -> ambiguous (abstain; should be
 *      near-impossible given the fingerprint's specificity, but ties are
 *      never broken by guessing).
 *   4. Exactly one "plausible" candidate (no contradicting field, >=1
 *      agreeing field) -> fields_unique.
 *   5. More than one plausible candidate -> ambiguous (abstain).
 *   6. Zero plausible candidates despite >=1 live candidate existing ->
 *      not_found (abstain; nothing on the day resembles what the dry-run saw).
 */
export function matchMoveWorkoutCandidate(
  domCandidate: MoveWorkoutDomCandidate,
  studentId: string | null,
  dateIso: string,
  liveCandidates: LiveWorkoutCandidate[],
): MoveWorkoutResolution {
  if (liveCandidates.length === 0) {
    return {
      resolvedWorkoutId: null,
      matchKind: "not_found",
      candidatesOnDate: 0,
      abstainReason: "No workouts found on the resolved source date via the live API.",
      evaluations: [],
    };
  }

  const evaluations = liveCandidates.map((live) => evaluateMoveWorkoutCandidate(domCandidate, studentId, dateIso, live));

  const fingerprintMatches = evaluations.filter((e) => e.fingerprintMatches);
  if (fingerprintMatches.length === 1) {
    return {
      resolvedWorkoutId: fingerprintMatches[0].workoutId,
      matchKind: "fingerprint_exact",
      candidatesOnDate: liveCandidates.length,
      abstainReason: null,
      evaluations,
    };
  }
  if (fingerprintMatches.length > 1) {
    return {
      resolvedWorkoutId: null,
      matchKind: "ambiguous",
      candidatesOnDate: liveCandidates.length,
      abstainReason: `${fingerprintMatches.length} candidates share an identical recomputed fingerprint.`,
      evaluations,
    };
  }

  const plausible = evaluations.filter((e) => e.isPlausibleMatch);
  if (plausible.length === 1) {
    return {
      resolvedWorkoutId: plausible[0].workoutId,
      matchKind: "fields_unique",
      candidatesOnDate: liveCandidates.length,
      abstainReason: null,
      evaluations,
    };
  }
  if (plausible.length > 1) {
    return {
      resolvedWorkoutId: null,
      matchKind: "ambiguous",
      candidatesOnDate: liveCandidates.length,
      abstainReason: `${plausible.length} candidates on this date are all plausible matches (no contradicting field, >=1 agreeing field); refusing to guess.`,
      evaluations,
    };
  }

  return {
    resolvedWorkoutId: null,
    matchKind: "not_found",
    candidatesOnDate: liveCandidates.length,
    abstainReason: "No candidate on this date has an agreeing field without a contradicting one.",
    evaluations,
  };
}
