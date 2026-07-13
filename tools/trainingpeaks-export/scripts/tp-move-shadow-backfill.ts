import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createSupabaseServerClient } from "../../../src/features/supabase/server.ts";
import {
  listMoveShadowComparisons,
  recordMoveShadowComparison,
  type MoveShadowComparisonMatchKind,
} from "../../../src/features/trainingpeaks/repository.ts";
import { classifyMatchKind } from "../../../src/features/trainingpeaks/move-shadow-comparator.ts";
import { resolveMoveWorkoutId } from "../../../src/features/trainingpeaks/move-workout-resolver-context.ts";
import {
  buildDomCompatibleFingerprint,
  type LiveWorkoutCandidate,
  type MoveWorkoutDomCandidate,
} from "../../../src/features/trainingpeaks/move-workout-resolver.ts";
import { computeMoveShadowReport, formatMoveShadowReportText } from "../../../src/features/trainingpeaks/move-shadow-report.ts";
import { getWorkoutDetail, getWorkoutsByDateRange, isWorkoutGone, TpApiHttpError } from "../../../src/features/trainingpeaks/tp-api-client.ts";
import { classifyTrainingPeaksWorkoutActivity } from "../../../src/features/trainingpeaks/workout-activity-classification.ts";

/**
 * M3.5 (move-http-shadow plan) -- backfill runs the M1 resolver against
 * PAST, already-completed real moves, to accumulate resolver statistics
 * faster than live move volume allows. STRICTLY READ-ONLY against
 * TrainingPeaks (only GETs). Writes ONLY to
 * trainingpeaks_move_shadow_comparisons, with origin='backfill' -- never to
 * trainingpeaks_actions/trainingpeaks_action_runs (no proposals, no
 * mutations, nothing that looks like a real coach action).
 *
 * Two tasks:
 *   1. Historical replay -- every completed move_workout action gets its
 *      resolver answer checked against the ground-truth workoutId that
 *      really moved. Reproducibility is checked FIRST (the calendar has
 *      drifted since): a workout that's since been deleted is excluded
 *      entirely (not counted success or failure); a workout whose title has
 *      clearly changed since is also excluded (the descriptor we'd be
 *      testing against is stale, not a fair test of the resolver). A
 *      workout that has since moved AGAIN (to neither the recorded source
 *      nor target date) is still testable -- see the design note below.
 *   2. Multi-workout-same-day targeted probe -- the single riskiest
 *      scenario (this is exactly what the real compareTitles() bug, found
 *      in M1's live testing, was about). Finds real live days with 2+
 *      workouts for the athletes seen in task 1, then: (a) for each
 *      workout on such a day, feeds the resolver ITS OWN descriptor and
 *      checks it finds itself; (b) feeds a deliberately GENERIC descriptor
 *      and requires the resolver to ABSTAIN (ambiguous) -- any confident
 *      guess on a generic query is a red flag. Task 2's probes have no real
 *      action/run behind them (nobody proposed these moves), so they are
 *      NEVER written to trainingpeaks_move_shadow_comparisons (that table's
 *      action_id/run_id are real FKs to real actions) -- results are
 *      reported directly, not persisted.
 *
 * DESIGN NOTE on "moved further since" (task 1): rather than only testing
 * against the originally-recorded target date (which naryad's own wording
 * anticipated as one flavor of "unreproducible"), this script queries
 * wherever the ground-truth workoutId CURRENTLY lives (read via a direct GET
 * on that id) and tests the resolver against THAT day. This yields a
 * genuinely valid test (the resolver either finds the right workout among
 * whatever's on that day, or it doesn't) rather than discarding the case --
 * more usable historical signal from the same 61 real moves. The only
 * genuinely excluded cases are "deleted" and "title changed beyond
 * recognition" (diagnostics.driftedDateSinceMove records whether the
 * current date differs from the original target date, for transparency).
 */

const SAFE_TITLE_SIMILARITY_MIN_CHARS = 3; // guards against comparing two near-empty strings and calling them "similar"

function loadDotEnvFile(dotEnvPath: string): void {
  if (!existsSync(dotEnvPath)) return;
  const content = readFileSync(dotEnvPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) continue;
    let value = trimmed.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
function loadLocalEnv(): void {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const toolRoot = path.resolve(scriptDir, "..");
  const repoRoot = path.resolve(toolRoot, "..", "..");
  for (const envPath of [path.join(repoRoot, ".env.local"), path.join(repoRoot, ".env"), path.join(toolRoot, ".env")]) {
    loadDotEnvFile(envPath);
  }
}

// ─── task 1: historical replay ───────────────────────────────────────────────

type CompletedMoveActionRow = {
  id: string;
  student_id: string | null;
  parsed_payload: unknown;
};

type DryRunCandidateInfo = {
  candidate: MoveWorkoutDomCandidate;
  sourceDate: string | null;
};

type GroundTruthInfo = {
  runId: string;
  workoutId: number;
  athleteId: number;
  originalTargetDate: string | null;
};

async function fetchCompletedMoveActions(): Promise<CompletedMoveActionRow[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_actions")
    .select("id, student_id, parsed_payload")
    .eq("action_type", "move_workout")
    .eq("status", "approved")
    .eq("execution_status", "completed")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Failed to fetch completed move actions: ${error.message}`);
  return (data ?? []) as CompletedMoveActionRow[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function fetchDryRunCandidate(actionId: string): Promise<DryRunCandidateInfo | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_action_runs")
    .select("log_json")
    .eq("action_id", actionId)
    .eq("run_type", "dry_run")
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Failed to fetch dry-run run for action ${actionId}: ${error.message}`);
  const logJson = asRecord(data?.log_json);
  const candidateRaw = asRecord(logJson?.candidate);
  if (!candidateRaw) return null;
  const fingerprint = asString(candidateRaw.fingerprint);
  if (!fingerprint) return null;
  const candidate: MoveWorkoutDomCandidate = {
    fingerprint,
    title: asString(candidateRaw.title),
    type: asString(candidateRaw.type),
    startTimeLocal: asString(candidateRaw.startTimeLocal),
    plannedDurationSec: asNumber(candidateRaw.plannedDurationSec),
    plannedDistanceKm: asNumber(candidateRaw.plannedDistance),
  };
  const resolvedDates = asRecord(logJson?.resolvedDates);
  return { candidate, sourceDate: asString(resolvedDates?.sourceDate) };
}

async function fetchGroundTruth(actionId: string): Promise<GroundTruthInfo | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_action_runs")
    .select("id, log_json")
    .eq("action_id", actionId)
    .eq("run_type", "real")
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Failed to fetch real run for action ${actionId}: ${error.message}`);
  const logJson = asRecord(data?.log_json);
  const apiMove = asRecord(logJson?.apiMove);
  const workoutId = asNumber(apiMove?.workoutId);
  const athleteId = asNumber(apiMove?.athleteId);
  const runId = asString(data?.id);
  if (!workoutId || !athleteId || !runId) return null;
  return {
    runId,
    workoutId,
    athleteId,
    originalTargetDate: asString(apiMove?.targetDate),
  };
}

/** Loose, bidirectional similarity check -- comparing the SAME workout's
 * title at two different points in TIME (not two different candidates), so
 * bidirectional containment is appropriate here (unlike the resolver's own
 * one-directional compareTitles, which compares a truncated DOM scrape
 * against a fuller live title -- a different scenario entirely). */
function titlesStillResemble(originalTitle: string | null, currentTitle: string | null): boolean {
  if (!originalTitle || !currentTitle) return true; // insufficient data to call it "edited" -- don't false-flag
  const a = originalTitle.trim().toLowerCase();
  const b = currentTitle.trim().toLowerCase();
  if (a.length < SAFE_TITLE_SIMILARITY_MIN_CHARS || b.length < SAFE_TITLE_SIMILARITY_MIN_CHARS) return true;
  return a === b || a.includes(b) || b.includes(a);
}

type ReproducibilityResult =
  | { reproducible: true; currentDateIso: string; currentTitle: string | null }
  | { reproducible: false; reason: "deleted" | "title_changed"; detail: string };

async function checkReproducibility(athleteId: number, workoutId: number, originalCandidate: MoveWorkoutDomCandidate): Promise<ReproducibilityResult> {
  let workout: Record<string, unknown>;
  try {
    workout = await getWorkoutDetail(athleteId, workoutId);
  } catch (error) {
    if (error instanceof TpApiHttpError && isWorkoutGone(error.status, error.body)) {
      return { reproducible: false, reason: "deleted", detail: `GET ${workoutId} -> ${error.status} (gone)` };
    }
    if (error instanceof TpApiHttpError) {
      return { reproducible: false, reason: "deleted", detail: `GET ${workoutId} -> unexpected HTTP ${error.status}, treating as unreproducible` };
    }
    throw error;
  }

  const currentTitle = asString(workout.title);
  const currentDateRaw = asString(workout.workoutDay);
  if (!currentDateRaw) {
    return { reproducible: false, reason: "deleted", detail: "workout found but has no workoutDay -- treating as unreproducible" };
  }
  if (!titlesStillResemble(originalCandidate.title, currentTitle)) {
    return {
      reproducible: false,
      reason: "title_changed",
      detail: `original="${originalCandidate.title}" current="${currentTitle}"`,
    };
  }
  return { reproducible: true, currentDateIso: currentDateRaw.slice(0, 10), currentTitle };
}

type BackfillTask1Outcome = {
  actionId: string;
  athleteId: number;
  studentId: string | null;
  groundTruthWorkoutId: number;
  status: "tested" | "unreproducible";
  matchKind?: MoveShadowComparisonMatchKind;
  resolvedWorkoutId?: number | null;
  unreproducibleReason?: string;
  driftedDateSinceMove?: boolean;
  /** Kept in-memory (not just in the DB row) so the final report can name
   * every mismatch/abstention with a full field-diff even if persistence to
   * trainingpeaks_move_shadow_comparisons is currently blocked by the
   * unapplied origin migration -- see recordMoveShadowComparisonSafe. */
  reportDetail?: {
    testedDate: string;
    domCandidateTitle: string | null;
    resolverMatchKind: string | null;
    candidatesOnDate: number;
    evaluations?: unknown;
    abstainReason?: string | null;
  };
};

async function runBackfillForAction(action: CompletedMoveActionRow): Promise<BackfillTask1Outcome | null> {
  const dryRun = await fetchDryRunCandidate(action.id);
  const groundTruth = await fetchGroundTruth(action.id);
  if (!dryRun || !groundTruth) {
    console.log(`[backfill] action ${action.id}: missing dry-run candidate or ground truth -- skipping (data integrity, not a resolver test)`);
    return null;
  }

  const repro = await checkReproducibility(groundTruth.athleteId, groundTruth.workoutId, dryRun.candidate);
  if (!repro.reproducible) {
    console.log(`[backfill] action ${action.id}: unreproducible (${repro.reason}) -- ${repro.detail}`);
    return {
      actionId: action.id,
      athleteId: groundTruth.athleteId,
      studentId: action.student_id,
      groundTruthWorkoutId: groundTruth.workoutId,
      status: "unreproducible",
      unreproducibleReason: `${repro.reason}: ${repro.detail}`,
    };
  }

  const driftedDateSinceMove = Boolean(groundTruth.originalTargetDate) && repro.currentDateIso !== groundTruth.originalTargetDate;

  const resolution = await resolveMoveWorkoutId({
    athleteId: groundTruth.athleteId,
    sourceDateIso: repro.currentDateIso,
    domCandidate: dryRun.candidate,
  });

  if (!resolution.ok) {
    console.log(`[backfill] action ${action.id}: resolver_error (${resolution.reason})`);
    await recordMoveShadowComparisonSafe({
      actionId: action.id,
      runId: groundTruth.runId,
      athleteId: groundTruth.athleteId,
      studentId: action.student_id,
      sourceDate: repro.currentDateIso,
      targetDate: groundTruth.originalTargetDate ?? repro.currentDateIso,
      domWorkoutId: groundTruth.workoutId,
      resolvedWorkoutId: null,
      matchKind: "resolver_error",
      resolverMatchKind: null,
      candidatesOnDate: 0,
      domFingerprint: dryRun.candidate.fingerprint,
      recomputedFingerprint: null,
      fingerprintMatch: null,
      sourcePolicy: null,
      sourceKind: extractSourceKindFromPayload(action.parsed_payload),
      origin: "backfill",
      diagnostics: { reason: resolution.reason, driftedDateSinceMove },
      cacheCrossCheck: {},
    });
    return {
      actionId: action.id,
      athleteId: groundTruth.athleteId,
      studentId: action.student_id,
      groundTruthWorkoutId: groundTruth.workoutId,
      status: "tested",
      matchKind: "resolver_error",
      driftedDateSinceMove,
      reportDetail: { testedDate: repro.currentDateIso, domCandidateTitle: dryRun.candidate.title, resolverMatchKind: null, candidatesOnDate: 0 },
    };
  }

  const { resolution: r, studentId: resolvedStudentId } = resolution;
  const matchKind = classifyMatchKind(r.resolvedWorkoutId, r.matchKind, groundTruth.workoutId);
  const winningEvaluation = r.evaluations.find((e) => e.workoutId === r.resolvedWorkoutId) ?? null;

  await recordMoveShadowComparisonSafe({
    actionId: action.id,
    runId: groundTruth.runId,
    athleteId: groundTruth.athleteId,
    studentId: resolvedStudentId ?? action.student_id,
    sourceDate: repro.currentDateIso,
    targetDate: groundTruth.originalTargetDate ?? repro.currentDateIso,
    domWorkoutId: groundTruth.workoutId,
    resolvedWorkoutId: r.resolvedWorkoutId,
    matchKind,
    resolverMatchKind: r.matchKind,
    candidatesOnDate: r.candidatesOnDate,
    domFingerprint: dryRun.candidate.fingerprint,
    recomputedFingerprint: winningEvaluation?.recomputedFingerprint ?? null,
    fingerprintMatch: winningEvaluation?.fingerprintMatches ?? null,
    sourcePolicy: null,
    sourceKind: extractSourceKindFromPayload(action.parsed_payload),
    origin: "backfill",
    diagnostics: { evaluations: r.evaluations, abstainReason: r.abstainReason, driftedDateSinceMove, originalTargetDate: groundTruth.originalTargetDate, testedDate: repro.currentDateIso },
    cacheCrossCheck: {},
  });

  console.log(`[backfill] action ${action.id}: ${matchKind} (ground truth ${groundTruth.workoutId}, resolver said ${r.resolvedWorkoutId ?? "null"})`);

  return {
    actionId: action.id,
    athleteId: groundTruth.athleteId,
    studentId: action.student_id,
    groundTruthWorkoutId: groundTruth.workoutId,
    status: "tested",
    matchKind,
    resolvedWorkoutId: r.resolvedWorkoutId,
    driftedDateSinceMove,
    reportDetail: {
      testedDate: repro.currentDateIso,
      domCandidateTitle: dryRun.candidate.title,
      resolverMatchKind: r.matchKind,
      candidatesOnDate: r.candidatesOnDate,
      evaluations: r.evaluations,
      abstainReason: r.abstainReason,
    },
  };
}

/**
 * Migration 20260713120000 (adds the `origin` column) is prepared but, per
 * the naryad's explicit boundary, NOT applied here -- only Igor applies
 * production migrations. If it isn't applied yet, every persistence attempt
 * fails identically; rather than aborting the whole read-only run (and
 * losing the TP reads already made), skip persistence and keep going so
 * Task 1's classification stats still make it into the report. Persistence
 * resumes automatically once Igor applies the migration and this script is
 * re-run.
 */
let originColumnMissingWarned = false;
async function recordMoveShadowComparisonSafe(input: Parameters<typeof recordMoveShadowComparison>[0]): Promise<void> {
  try {
    await recordMoveShadowComparison(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/column .*origin.* does not exist|could not find the 'origin' column/i.test(message)) {
      if (!originColumnMissingWarned) {
        originColumnMissingWarned = true;
        console.log("[backfill] ПРЕДУПРЕЖДЕНИЕ: колонка origin отсутствует (миграция 20260713120000 не применена) -- backfill-строки НЕ persist'ятся, только считаются в отчёте.");
      }
      return;
    }
    throw error;
  }
}

function extractSourceKindFromPayload(parsedPayload: unknown): string | null {
  const source = asRecord(asRecord(parsedPayload)?.source);
  const kind = source?.kind;
  return typeof kind === "string" ? kind : null;
}

// ─── task 2: multi-workout-same-day targeted probe (NOT written to DB) ────────

type MultiWorkoutDayProbeResult = {
  athleteId: number;
  date: string;
  workoutIds: number[];
  selfFindResults: Array<{ workoutId: number; title: string | null; resolvedCorrectly: boolean; matchKind: string; resolvedWorkoutId: number | null }>;
  genericAbstained: boolean;
  genericResolvedWorkoutId: number | null;
  genericMatchKind: string;
};

function liveFamily(live: LiveWorkoutCandidate): string | null {
  const classification = classifyTrainingPeaksWorkoutActivity({ title: live.title, workoutTypeValueId: live.workoutTypeValueId });
  const { family } = classification;
  return family === "run" || family === "bike" || family === "swim" || family === "strength" ? family : null;
}

async function findMultiWorkoutDays(athleteIds: number[], from: string, to: string, maxDays: number): Promise<Array<{ athleteId: number; date: string; workoutIds: number[] }>> {
  const found: Array<{ athleteId: number; date: string; workoutIds: number[] }> = [];
  for (const athleteId of athleteIds) {
    if (found.length >= maxDays) break;
    let summaries;
    try {
      summaries = await getWorkoutsByDateRange(athleteId, from, to);
    } catch (error) {
      console.log(`[backfill/task2] failed to read calendar for athlete ${athleteId}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const byDate = new Map<string, number[]>();
    for (const summary of summaries) {
      const date = summary.workoutDay.slice(0, 10);
      byDate.set(date, [...(byDate.get(date) ?? []), summary.workoutId]);
    }
    for (const [date, workoutIds] of byDate) {
      if (workoutIds.length > 1) {
        found.push({ athleteId, date, workoutIds });
        if (found.length >= maxDays) break;
      }
    }
  }
  return found;
}

async function probeMultiWorkoutDay(athleteId: number, date: string, workoutIds: number[]): Promise<MultiWorkoutDayProbeResult> {
  const selfFindResults: MultiWorkoutDayProbeResult["selfFindResults"] = [];

  for (const workoutId of workoutIds) {
    const workout = await getWorkoutDetail(athleteId, workoutId);
    const live: LiveWorkoutCandidate = {
      workoutId,
      title: asString(workout.title),
      workoutTypeValueId: asNumber(workout.workoutTypeValueId),
      totalTimePlannedHours: asNumber(workout.totalTimePlanned),
      distancePlannedMeters: asNumber(workout.distancePlanned),
      startTimePlanned: asString(workout.startTimePlanned),
    };
    const family = liveFamily(live);
    const distanceKm = live.distancePlannedMeters === null ? null : Number((live.distancePlannedMeters / 1000).toFixed(3));
    const durationSec = live.totalTimePlannedHours === null ? null : Math.round(live.totalTimePlannedHours * 3600);
    const selfDescribedCandidate: MoveWorkoutDomCandidate = {
      fingerprint: buildDomCompatibleFingerprint({ studentId: null, dateIso: date, title: live.title, type: family, startTimeLocal: live.startTimePlanned, plannedDurationSec: durationSec, plannedDistanceKm: distanceKm }),
      title: live.title,
      type: family,
      startTimeLocal: live.startTimePlanned,
      plannedDurationSec: durationSec,
      plannedDistanceKm: distanceKm,
    };
    const resolution = await resolveMoveWorkoutId({ athleteId, sourceDateIso: date, domCandidate: selfDescribedCandidate });
    if (!resolution.ok) {
      selfFindResults.push({ workoutId, title: live.title, resolvedCorrectly: false, matchKind: "resolver_error", resolvedWorkoutId: null });
      continue;
    }
    selfFindResults.push({
      workoutId,
      title: live.title,
      resolvedCorrectly: resolution.resolution.resolvedWorkoutId === workoutId,
      matchKind: resolution.resolution.matchKind,
      resolvedWorkoutId: resolution.resolution.resolvedWorkoutId,
    });
  }

  // Generic descriptor -- deliberately vague, must NOT confidently resolve.
  const genericCandidate: MoveWorkoutDomCandidate = {
    fingerprint: "generic-probe-irrelevant",
    title: "Тренировка",
    type: null,
    startTimeLocal: null,
    plannedDurationSec: null,
    plannedDistanceKm: null,
  };
  const genericResolution = await resolveMoveWorkoutId({ athleteId, sourceDateIso: date, domCandidate: genericCandidate });
  const genericMatchKind = genericResolution.ok ? genericResolution.resolution.matchKind : "resolver_error";
  const genericResolvedWorkoutId = genericResolution.ok ? genericResolution.resolution.resolvedWorkoutId : null;

  return {
    athleteId,
    date,
    workoutIds,
    selfFindResults,
    genericAbstained: genericResolvedWorkoutId === null,
    genericResolvedWorkoutId,
    genericMatchKind,
  };
}

// ─── report ─────────────────────────────────────────────────────────────────────

function formatTask2Report(probes: MultiWorkoutDayProbeResult[]): string {
  const lines: string[] = [];
  lines.push("=== Задача 2: прицельный прогон по дням с несколькими тренировками ===");
  lines.push("(результаты НЕ записаны в БД -- за ними нет реальных action/run)");
  lines.push("");
  if (probes.length === 0) {
    lines.push("Дней с 2+ тренировками у наблюдённых атлетов не найдено в просканированном окне.");
    return lines.join("\n");
  }
  lines.push(`Найдено дней с несколькими тренировками: ${probes.length}`);
  lines.push("");

  let selfFindTotal = 0;
  let selfFindCorrect = 0;
  let genericRedFlags = 0;

  for (const probe of probes) {
    lines.push(`--- Атлет ${probe.athleteId}, дата ${probe.date} (${probe.workoutIds.length} тренировки) ---`);
    for (const r of probe.selfFindResults) {
      selfFindTotal += 1;
      if (r.resolvedCorrectly) selfFindCorrect += 1;
      const verdict = r.resolvedCorrectly ? "✅" : "❌ НЕ НАШЁЛ СЕБЯ";
      lines.push(`  workoutId=${r.workoutId} title="${r.title}" -> ${verdict} (matchKind=${r.matchKind}, resolved=${r.resolvedWorkoutId})`);
    }
    const genericVerdict = probe.genericAbstained ? "✅ воздержался" : "❌ КРАСНЫЙ ФЛАГ -- уверенно выбрал без оснований";
    if (!probe.genericAbstained) genericRedFlags += 1;
    lines.push(`  generic-запрос ("Тренировка") -> ${genericVerdict} (matchKind=${probe.genericMatchKind}, resolved=${probe.genericResolvedWorkoutId})`);
    lines.push("");
  }

  lines.push(`Итого self-find: ${selfFindCorrect}/${selfFindTotal} правильно нашли себя.`);
  lines.push(`Красных флагов (уверенная догадка на generic-запросе): ${genericRedFlags}/${probes.length}.`);
  if (genericRedFlags > 0) {
    lines.push("⚠️ Есть случаи уверенной догадки на generic-запросе -- разобрать вручную, это именно тот класс ошибки, что уже был найден и исправлен в M1.");
  }

  return lines.join("\n");
}

/**
 * Fallback for when persistence to trainingpeaks_move_shadow_comparisons is
 * blocked (origin column not yet migrated) -- rebuilds the same kind of
 * summary computeMoveShadowReport/formatMoveShadowReportText would have
 * produced, straight from the in-memory outcomes this run already computed.
 * Named mismatches/abstentions with full field-diff, per the naryad.
 */
function formatTask1InMemorySummary(tested: BackfillTask1Outcome[]): string {
  const lines: string[] = [];
  const byMatchKind = new Map<string, number>();
  for (const o of tested) {
    const key = o.matchKind ?? "unknown";
    byMatchKind.set(key, (byMatchKind.get(key) ?? 0) + 1);
  }
  lines.push(`Всего протестировано: ${tested.length}`);
  for (const [kind, count] of byMatchKind) {
    lines.push(`  ${kind}: ${count}`);
  }

  const mismatches = tested.filter((o) => o.matchKind === "id_mismatch");
  lines.push(`\nMismatch-и (${mismatches.length}):`);
  if (mismatches.length === 0) lines.push("  (нет)");
  for (const m of mismatches) {
    lines.push(`  action=${m.actionId} athlete=${m.athleteId} groundTruth=${m.groundTruthWorkoutId} resolved=${m.resolvedWorkoutId} testedDate=${m.reportDetail?.testedDate} domTitle="${m.reportDetail?.domCandidateTitle}" resolverMatchKind=${m.reportDetail?.resolverMatchKind} candidatesOnDate=${m.reportDetail?.candidatesOnDate}`);
    if (m.reportDetail?.evaluations) {
      lines.push(`    evaluations: ${JSON.stringify(m.reportDetail.evaluations)}`);
    }
  }

  const abstentions = tested.filter((o) => o.matchKind === "abstained_not_found" || o.matchKind === "abstained_ambiguous");
  lines.push(`\nAbstention-ы (${abstentions.length}):`);
  if (abstentions.length === 0) lines.push("  (нет)");
  for (const a of abstentions) {
    lines.push(`  action=${a.actionId} athlete=${a.athleteId} groundTruth=${a.groundTruthWorkoutId} matchKind=${a.matchKind} testedDate=${a.reportDetail?.testedDate} domTitle="${a.reportDetail?.domCandidateTitle}" candidatesOnDate=${a.reportDetail?.candidatesOnDate} abstainReason=${a.reportDetail?.abstainReason}`);
  }

  const resolverErrors = tested.filter((o) => o.matchKind === "resolver_error");
  if (resolverErrors.length > 0) {
    lines.push(`\nResolver-error (${resolverErrors.length}):`);
    for (const e of resolverErrors) {
      lines.push(`  action=${e.actionId} athlete=${e.athleteId} groundTruth=${e.groundTruthWorkoutId} testedDate=${e.reportDetail?.testedDate}`);
    }
  }

  const exactCount = byMatchKind.get("exact_id") ?? 0;
  const abstainCount = abstentions.length;
  lines.push(`\nmatchRate (exact_id / всего): ${tested.length ? (exactCount / tested.length).toFixed(3) : "n/a"}`);
  lines.push(`abstentionRate: ${tested.length ? (abstainCount / tested.length).toFixed(3) : "n/a"}`);

  return lines.join("\n");
}

// ─── main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadLocalEnv();

  console.log("=== M3.5 backfill: задача 1 -- исторический прогон ===\n");
  const actions = await fetchCompletedMoveActions();
  console.log(`Найдено завершённых переносов: ${actions.length}\n`);

  const outcomes: BackfillTask1Outcome[] = [];
  const athleteIdsSeen = new Set<number>();
  for (const action of actions) {
    const outcome = await runBackfillForAction(action);
    if (outcome) {
      outcomes.push(outcome);
      athleteIdsSeen.add(outcome.athleteId);
    }
  }

  const tested = outcomes.filter((o) => o.status === "tested");
  const unreproducible = outcomes.filter((o) => o.status === "unreproducible");
  console.log(`\nВоспроизведено: ${tested.length}. Не воспроизведено: ${unreproducible.length}.`);

  console.log("\n=== Отчёт по backfill-данным (origin=backfill, НЕ входит в критерий переключения M3) ===\n");
  try {
    const backfillRows = await listMoveShadowComparisons({ origin: "backfill" });
    const backfillReport = computeMoveShadowReport(backfillRows);
    console.log(formatMoveShadowReportText(backfillReport));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/column .*origin.* does not exist|could not find the 'origin' column/i.test(message)) {
      console.log("Колонка origin не применена -- строки НЕ persist'ились в БД. Отчёт ниже собран ИЗ ПАМЯТИ этого прогона (не переживёт перезапуск, но полностью достоверен для этого прогона):\n");
      console.log(formatTask1InMemorySummary(tested));
    } else {
      throw error;
    }
  }

  console.log("\n=== Невоспроизводимые кейсы (не засчитаны ни в успех, ни в провал) ===\n");
  if (unreproducible.length === 0) {
    console.log("(нет)");
  } else {
    for (const u of unreproducible) {
      console.log(`  action=${u.actionId} athlete=${u.athleteId} groundTruthWorkoutId=${u.groundTruthWorkoutId} -- ${u.unreproducibleReason}`);
    }
  }

  console.log("\n\n=== M3.5 backfill: задача 2 -- прицельный прогон по multi-workout-day ===\n");
  const athleteIds = Array.from(athleteIdsSeen);
  console.log(`Атлетов из задачи 1 для прицельного сканирования: ${athleteIds.length}`);
  const today = new Date();
  const from = new Date(today.getTime() - 150 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const to = new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  console.log(`Окно сканирования: ${from} .. ${to}`);
  const multiWorkoutDays = await findMultiWorkoutDays(athleteIds, from, to, 15);
  console.log(`Найдено дней с 2+ тренировками: ${multiWorkoutDays.length}\n`);

  const probes: MultiWorkoutDayProbeResult[] = [];
  for (const day of multiWorkoutDays) {
    const probe = await probeMultiWorkoutDay(day.athleteId, day.date, day.workoutIds);
    probes.push(probe);
  }

  console.log(formatTask2Report(probes));

  console.log("\n\n=== ИТОГОВЫЙ ВЕРДИКТ ===");
  console.log(`Задача 1: ${tested.length} воспроизведённых сравнений добавлено с origin='backfill'.`);
  console.log("Эти строки НЕ учитываются в официальном критерии переключения M3 (tp-move-shadow-report.ts фильтрует origin='live').");
  console.log("Они дают качественную картину (есть ли mismatch, где слаб резолвер) и ускоряют накопление данных для разбора, но НЕ заменяют живой shadow-поток по объёму/длительности критерия.");
  console.log(`Задача 2: ${probes.length} дней с несколькими тренировками прощупано целенаправленно. Красных флагов: ${probes.filter((p) => !p.genericAbstained).length}.`);
}

main().catch((error: unknown) => {
  console.error("tp-move-shadow-backfill failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
