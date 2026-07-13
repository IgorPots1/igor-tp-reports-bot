import {
  listTrainingPeaksWorkoutCacheForStudentDateRange,
  recordMoveShadowComparison,
  type MoveShadowComparisonMatchKind,
} from "@/features/trainingpeaks/repository";
import { resolveMoveWorkoutId } from "@/features/trainingpeaks/move-workout-resolver-context";
import type { MoveWorkoutDomCandidate } from "@/features/trainingpeaks/move-workout-resolver";

/**
 * M2 (move-http-shadow plan) -- the ONE function tp-actions-once.ts's shadow
 * hook calls. Everything the hook needs (resolve via the M1 resolver, cross-
 * check the cache, classify the comparator verdict, record the row) lives
 * here, so the hook itself stays a single call.
 *
 * SAFETY CONTRACT: runMoveShadowComparisonSafely NEVER throws and NEVER
 * blocks longer than timeoutMs. It is read-only against TrainingPeaks (only
 * calls the resolver, which only does live GETs) and its only write is the
 * one shadow-comparison INSERT -- to a table nothing else in the app reads.
 * A failure anywhere in this module (resolver error, cache read error,
 * timeout, even the INSERT itself failing) is caught and, at worst, results
 * in a best-effort resolver_error row or a swallowed console.error. The real
 * move this measures is NEVER affected, under any failure mode.
 */

const DEFAULT_SHADOW_TIMEOUT_MS = 15_000;

export type RunMoveShadowComparisonInput = {
  actionId: string;
  runId: string;
  athleteId: number;
  sourceDateIso: string;
  targetDateIso: string;
  /** The old DOM path's own authoritative, freshly re-scraped workoutId
   * (tp-actions-once.ts:4208) -- ground truth this comparison checks against. */
  domWorkoutId: number;
  domCandidate: MoveWorkoutDomCandidate;
  sourcePolicy: string | null;
  /** The action row's raw parsed_payload (unknown, defensively parsed here) --
   * only source.kind ("date"/"weekday"/"relative_day") is extracted from it,
   * for the M3 report's diversity-gate buckets. */
  parsedPayload: unknown;
};

/** Defensive extraction -- never throws on an unexpected payload shape. */
function extractSourceKind(parsedPayload: unknown): string | null {
  if (!parsedPayload || typeof parsedPayload !== "object") return null;
  const source = (parsedPayload as { source?: unknown }).source;
  if (!source || typeof source !== "object") return null;
  const kind = (source as { kind?: unknown }).kind;
  return typeof kind === "string" ? kind : null;
}

/**
 * Exported so the M3.5 backfill script (tp-move-shadow-backfill.ts) can
 * classify its own resolver results with the EXACT same rule the live hook
 * uses -- no drift between how a live comparison and a backfill comparison
 * get judged.
 */
export function classifyMatchKind(resolvedWorkoutId: number | null, resolverMatchKind: string, domWorkoutId: number): MoveShadowComparisonMatchKind {
  if (resolvedWorkoutId === null) {
    return resolverMatchKind === "not_found" ? "abstained_not_found" : "abstained_ambiguous";
  }
  return resolvedWorkoutId === domWorkoutId ? "exact_id" : "id_mismatch";
}

async function buildCacheCrossCheck(studentId: string | null, athleteId: number, sourceDateIso: string, domWorkoutId: number, resolvedWorkoutId: number | null): Promise<unknown> {
  if (!studentId) {
    return { skipped: "no studentId resolved" };
  }
  try {
    const rows = await listTrainingPeaksWorkoutCacheForStudentDateRange({ studentId, from: sourceDateIso, to: sourceDateIso });
    const cacheWorkoutIds = rows.map((row) => row.trainingPeaksWorkoutId);
    const mostRecentScannedAt = rows.reduce<string | null>((latest, row) => {
      if (!row.scannedAt) return latest;
      return !latest || row.scannedAt > latest ? row.scannedAt : latest;
    }, null);
    return {
      athleteId,
      cacheWorkoutIdsOnDate: cacheWorkoutIds,
      cacheRowCount: rows.length,
      cacheAgreesWithDomGroundTruth: cacheWorkoutIds.includes(domWorkoutId),
      cacheAgreesWithResolved: resolvedWorkoutId !== null && cacheWorkoutIds.includes(resolvedWorkoutId),
      mostRecentScannedAt,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function runMoveShadowComparison(input: RunMoveShadowComparisonInput): Promise<void> {
  const sourceKind = extractSourceKind(input.parsedPayload);
  const resolution = await resolveMoveWorkoutId({
    athleteId: input.athleteId,
    sourceDateIso: input.sourceDateIso,
    domCandidate: input.domCandidate,
  });

  if (!resolution.ok) {
    await recordMoveShadowComparison({
      actionId: input.actionId,
      runId: input.runId,
      athleteId: input.athleteId,
      studentId: null,
      sourceDate: input.sourceDateIso,
      targetDate: input.targetDateIso,
      domWorkoutId: input.domWorkoutId,
      resolvedWorkoutId: null,
      matchKind: "resolver_error",
      resolverMatchKind: null,
      candidatesOnDate: 0,
      domFingerprint: input.domCandidate.fingerprint,
      recomputedFingerprint: null,
      fingerprintMatch: null,
      sourcePolicy: input.sourcePolicy,
      origin: "live",
      sourceKind,
      diagnostics: { reason: resolution.reason, error: resolution.reason === "live_read_failed" ? resolution.error : undefined },
      cacheCrossCheck: {},
    });
    return;
  }

  const { resolution: r, studentId } = resolution;
  const matchKind = classifyMatchKind(r.resolvedWorkoutId, r.matchKind, input.domWorkoutId);
  const winningEvaluation = r.evaluations.find((evaluation) => evaluation.workoutId === r.resolvedWorkoutId) ?? null;
  const cacheCrossCheck = await buildCacheCrossCheck(studentId, input.athleteId, input.sourceDateIso, input.domWorkoutId, r.resolvedWorkoutId);

  await recordMoveShadowComparison({
    actionId: input.actionId,
    runId: input.runId,
    athleteId: input.athleteId,
    studentId,
    sourceDate: input.sourceDateIso,
    targetDate: input.targetDateIso,
    domWorkoutId: input.domWorkoutId,
    resolvedWorkoutId: r.resolvedWorkoutId,
    matchKind,
    resolverMatchKind: r.matchKind,
    candidatesOnDate: r.candidatesOnDate,
    domFingerprint: input.domCandidate.fingerprint,
    recomputedFingerprint: winningEvaluation?.recomputedFingerprint ?? null,
    fingerprintMatch: winningEvaluation?.fingerprintMatches ?? null,
    sourcePolicy: input.sourcePolicy,
    origin: "live",
    sourceKind,
    diagnostics: { evaluations: r.evaluations, abstainReason: r.abstainReason },
    cacheCrossCheck,
  });
}

/**
 * The hook's single entry point. Applies a hard timeout and catches
 * everything -- see the module-level safety contract above. Call this and
 * nothing else from tp-actions-once.ts.
 */
export async function runMoveShadowComparisonSafely(input: RunMoveShadowComparisonInput, timeoutMs: number = DEFAULT_SHADOW_TIMEOUT_MS): Promise<void> {
  try {
    await Promise.race([
      runMoveShadowComparison(input),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Shadow comparison timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[move-shadow] comparison failed (never affects the real move): ${message}`);
    try {
      await recordMoveShadowComparison({
        actionId: input.actionId,
        runId: input.runId,
        athleteId: input.athleteId,
        studentId: null,
        sourceDate: input.sourceDateIso,
        targetDate: input.targetDateIso,
        domWorkoutId: input.domWorkoutId,
        resolvedWorkoutId: null,
        matchKind: "resolver_error",
        resolverMatchKind: null,
        candidatesOnDate: 0,
        domFingerprint: input.domCandidate.fingerprint,
        recomputedFingerprint: null,
        fingerprintMatch: null,
        sourcePolicy: input.sourcePolicy,
        origin: "live",
        sourceKind: extractSourceKind(input.parsedPayload),
        diagnostics: { error: message },
        cacheCrossCheck: {},
      });
    } catch (recordError) {
      console.error("[move-shadow] failed to even record a resolver_error row -- swallowing, real move must not be affected.", recordError);
    }
  }
}
