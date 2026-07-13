/**
 * M3 (move-http-shadow plan) -- pure aggregation over accumulated
 * trainingpeaks_move_shadow_comparisons rows, answering the plan's switch
 * criterion directly: >=30 moves, >=21 days spanned, ZERO id_mismatch ever
 * (any single mismatch fails the gate), <10% abstention rate, and at least
 * one clean exact_id match in every "hard bucket" that has been observed
 * (multi-workout-same-day, each source.kind, each source_policy).
 *
 * Pure: takes rows already fetched from the DB, no network/DB dependency of
 * its own -- unit-testable under plain node with hand-built fixtures. The
 * impure fetch lives in the CLI script tools/trainingpeaks-export/scripts/
 * tp-move-shadow-report.ts.
 *
 * Per naryad: abstentions must be visible BY NAME for Igor to review by
 * hand -- the report never just gives a rate, it always returns the full
 * row list for idMismatches and abstentions.
 */

export type MoveShadowComparisonMatchKind = "exact_id" | "id_mismatch" | "abstained_not_found" | "abstained_ambiguous" | "resolver_error";

/** M3.5: 'live' = M2 hook, real move, ground truth observed at the exact moment. 'backfill' = M3.5 script, replaying a past move against the current (possibly drifted) calendar. Never mixed in the switch-criterion count. */
export type MoveShadowComparisonOrigin = "live" | "backfill";

export type MoveShadowComparisonRow = {
  id: string;
  actionId: string;
  athleteId: number;
  studentId: string | null;
  sourceDate: string;
  targetDate: string;
  domWorkoutId: number;
  resolvedWorkoutId: number | null;
  matchKind: MoveShadowComparisonMatchKind;
  resolverMatchKind: string | null;
  candidatesOnDate: number;
  domFingerprint: string | null;
  recomputedFingerprint: string | null;
  fingerprintMatch: boolean | null;
  sourcePolicy: string | null;
  sourceKind: string | null;
  origin: MoveShadowComparisonOrigin;
  diagnostics: unknown;
  cacheCrossCheck: unknown;
  createdAt: string;
};

export type MoveShadowBucketStats = {
  key: string;
  total: number;
  exactId: number;
  idMismatch: number;
  abstained: number;
  resolverError: number;
  /** exactId >= 1 -- this bucket has at least one clean, ground-truth-matching resolution. */
  hasCleanMatch: boolean;
};

export type MoveShadowSwitchCriterion = {
  minMoves: number;
  minDays: number;
  maxAbstentionRate: number;
  volumeMet: boolean;
  durationMet: boolean;
  zeroMismatchMet: boolean;
  abstentionRateMet: boolean;
  diversityMet: boolean;
  overallReady: boolean;
  /** Human-readable, specific reasons the gate is not yet met -- empty iff overallReady. */
  blockers: string[];
};

export type MoveShadowReport = {
  totalComparisons: number;
  earliestDate: string | null;
  latestDate: string | null;
  daysSpanned: number;
  byMatchKind: Record<string, number>;
  matchRate: number;
  abstentionRate: number;
  /** Timestamp of the most recent id_mismatch, or the earliest comparison's timestamp if there has never been one. */
  cleanStreakSince: string | null;
  daysSinceLastMismatch: number | null;
  /** Full detail, never just a count -- every mismatch needs root-causing. */
  idMismatches: MoveShadowComparisonRow[];
  /** Full detail, by name, for Igor's manual per-item review. */
  abstentions: MoveShadowComparisonRow[];
  multiWorkoutDayBucket: MoveShadowBucketStats;
  bySourceKind: MoveShadowBucketStats[];
  bySourcePolicy: MoveShadowBucketStats[];
  /** Fraction of comparisons where the (never-trusted-for-resolution) cache agreed with the DOM ground truth, or null if no rows carried a usable cross-check. */
  cacheAgreementRate: number | null;
  switchCriterion: MoveShadowSwitchCriterion;
};

const MIN_MOVES = 30;
const MIN_DAYS = 21; // 3 weeks -- the low end of the plan's "3-4 weeks"
const MAX_ABSTENTION_RATE = 0.1;

function daysBetween(aIso: string, bIso: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((new Date(bIso).getTime() - new Date(aIso).getTime()) / msPerDay);
}

function computeBucketStats(key: string, rows: MoveShadowComparisonRow[]): MoveShadowBucketStats {
  const exactId = rows.filter((r) => r.matchKind === "exact_id").length;
  const idMismatch = rows.filter((r) => r.matchKind === "id_mismatch").length;
  const abstained = rows.filter((r) => r.matchKind === "abstained_not_found" || r.matchKind === "abstained_ambiguous").length;
  const resolverError = rows.filter((r) => r.matchKind === "resolver_error").length;
  return { key, total: rows.length, exactId, idMismatch, abstained, resolverError, hasCleanMatch: exactId >= 1 };
}

function emptyReport(): MoveShadowReport {
  return {
    totalComparisons: 0,
    earliestDate: null,
    latestDate: null,
    daysSpanned: 0,
    byMatchKind: {},
    matchRate: 0,
    abstentionRate: 0,
    cleanStreakSince: null,
    daysSinceLastMismatch: null,
    idMismatches: [],
    abstentions: [],
    multiWorkoutDayBucket: computeBucketStats("multi_workout_day (candidatesOnDate > 1)", []),
    bySourceKind: [],
    bySourcePolicy: [],
    cacheAgreementRate: null,
    switchCriterion: {
      minMoves: MIN_MOVES,
      minDays: MIN_DAYS,
      maxAbstentionRate: MAX_ABSTENTION_RATE,
      volumeMet: false,
      durationMet: false,
      zeroMismatchMet: true,
      abstentionRateMet: false,
      diversityMet: false,
      overallReady: false,
      blockers: ["No shadow comparisons recorded yet."],
    },
  };
}

function extractCacheAgreement(crossCheck: unknown): boolean | null {
  if (!crossCheck || typeof crossCheck !== "object") return null;
  const value = (crossCheck as { cacheAgreesWithDomGroundTruth?: unknown }).cacheAgreesWithDomGroundTruth;
  return typeof value === "boolean" ? value : null;
}

export function computeMoveShadowReport(rows: MoveShadowComparisonRow[]): MoveShadowReport {
  if (rows.length === 0) {
    return emptyReport();
  }

  const sorted = [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const earliestDate = sorted[0].createdAt;
  const latestDate = sorted[sorted.length - 1].createdAt;
  const daysSpanned = daysBetween(earliestDate, latestDate);

  const byMatchKind: Record<string, number> = {};
  for (const row of rows) {
    byMatchKind[row.matchKind] = (byMatchKind[row.matchKind] ?? 0) + 1;
  }

  const exactIdCount = byMatchKind.exact_id ?? 0;
  const idMismatchCount = byMatchKind.id_mismatch ?? 0;
  const abstainedCount = (byMatchKind.abstained_not_found ?? 0) + (byMatchKind.abstained_ambiguous ?? 0);

  const matchRate = exactIdCount / rows.length;
  const abstentionRate = abstainedCount / rows.length;

  const idMismatches = rows.filter((r) => r.matchKind === "id_mismatch");
  const abstentions = rows.filter((r) => r.matchKind === "abstained_not_found" || r.matchKind === "abstained_ambiguous");

  const mismatchesByRecency = [...idMismatches].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const cleanStreakSince = mismatchesByRecency.length > 0 ? mismatchesByRecency[0].createdAt : earliestDate;
  const daysSinceLastMismatch = mismatchesByRecency.length > 0 ? daysBetween(mismatchesByRecency[0].createdAt, latestDate) : daysSpanned;

  const multiWorkoutDayRows = rows.filter((r) => r.candidatesOnDate > 1);
  const multiWorkoutDayBucket = computeBucketStats("multi_workout_day (candidatesOnDate > 1)", multiWorkoutDayRows);

  const sourceKinds = Array.from(new Set(rows.map((r) => r.sourceKind).filter((k): k is string => Boolean(k))));
  const bySourceKind = sourceKinds.map((kind) => computeBucketStats(`source_kind=${kind}`, rows.filter((r) => r.sourceKind === kind)));

  const sourcePolicies = Array.from(new Set(rows.map((r) => r.sourcePolicy).filter((p): p is string => Boolean(p))));
  const bySourcePolicy = sourcePolicies.map((policy) => computeBucketStats(`source_policy=${policy}`, rows.filter((r) => r.sourcePolicy === policy)));

  const cacheAgreements = rows.map((r) => extractCacheAgreement(r.cacheCrossCheck)).filter((v): v is boolean => v !== null);
  const cacheAgreementRate = cacheAgreements.length > 0 ? cacheAgreements.filter(Boolean).length / cacheAgreements.length : null;

  const volumeMet = rows.length >= MIN_MOVES;
  const durationMet = daysSpanned >= MIN_DAYS;
  const zeroMismatchMet = idMismatchCount === 0;
  const abstentionRateMet = abstentionRate < MAX_ABSTENTION_RATE;

  const hardBuckets = [multiWorkoutDayBucket, ...bySourceKind, ...bySourcePolicy].filter((b) => b.total > 0);
  const diversityMet = hardBuckets.length > 0 && hardBuckets.every((b) => b.hasCleanMatch);

  const blockers: string[] = [];
  if (!volumeMet) blockers.push(`Volume: ${rows.length}/${MIN_MOVES} minimum real moves observed.`);
  if (!durationMet) blockers.push(`Duration: ${daysSpanned}/${MIN_DAYS} minimum days spanned.`);
  if (!zeroMismatchMet) {
    blockers.push(`ZERO-MISMATCH VIOLATED: ${idMismatchCount} id_mismatch row(s) recorded -- see idMismatches for full detail. Streak reset.`);
  }
  if (!abstentionRateMet) {
    blockers.push(`Abstention rate ${(abstentionRate * 100).toFixed(1)}% exceeds the ${(MAX_ABSTENTION_RATE * 100).toFixed(0)}% threshold.`);
  }
  if (!diversityMet) {
    if (hardBuckets.length === 0) {
      blockers.push("Diversity gate: no hard-bucket data observed yet (no multi-workout-day, source_kind, or source_policy variety).");
    } else {
      const missing = hardBuckets.filter((b) => !b.hasCleanMatch).map((b) => b.key);
      blockers.push(`Diversity gate: no clean exact_id match yet in bucket(s): ${missing.join(", ")}.`);
    }
  }

  const overallReady = volumeMet && durationMet && zeroMismatchMet && abstentionRateMet && diversityMet;

  return {
    totalComparisons: rows.length,
    earliestDate,
    latestDate,
    daysSpanned,
    byMatchKind,
    matchRate,
    abstentionRate,
    cleanStreakSince,
    daysSinceLastMismatch,
    idMismatches,
    abstentions,
    multiWorkoutDayBucket,
    bySourceKind,
    bySourcePolicy,
    cacheAgreementRate,
    switchCriterion: {
      minMoves: MIN_MOVES,
      minDays: MIN_DAYS,
      maxAbstentionRate: MAX_ABSTENTION_RATE,
      volumeMet,
      durationMet,
      zeroMismatchMet,
      abstentionRateMet,
      diversityMet,
      overallReady,
      blockers,
    },
  };
}

function formatBucketLine(bucket: MoveShadowBucketStats): string {
  const status = bucket.total === 0 ? "нет данных" : bucket.hasCleanMatch ? "✅ есть чистое совпадение" : "⚠️ ЧИСТОГО СОВПАДЕНИЯ ЕЩЁ НЕТ";
  return `  ${bucket.key}: всего=${bucket.total}, exact_id=${bucket.exactId}, id_mismatch=${bucket.idMismatch}, abstained=${bucket.abstained}, resolver_error=${bucket.resolverError} -- ${status}`;
}

/** Human-readable report text for Igor -- Russian, matching his own naryad's language. */
export function formatMoveShadowReportText(report: MoveShadowReport): string {
  const lines: string[] = [];
  lines.push("=== Move HTTP shadow — отчёт (M3) ===");
  lines.push("");

  if (report.totalComparisons === 0) {
    lines.push("Сравнений пока нет. TP_MOVE_SHADOW_ENABLED должен быть true на реальных переносах, чтобы начали копиться данные.");
    return lines.join("\n");
  }

  lines.push(`Всего сравнений: ${report.totalComparisons}`);
  lines.push(`Период: ${report.earliestDate} .. ${report.latestDate} (${report.daysSpanned} дн.)`);
  lines.push("");
  lines.push("По вердикту:");
  for (const [kind, count] of Object.entries(report.byMatchKind)) {
    lines.push(`  ${kind}: ${count}`);
  }
  lines.push(`  match rate (exact_id / всего): ${(report.matchRate * 100).toFixed(1)}%`);
  lines.push(`  abstention rate: ${(report.abstentionRate * 100).toFixed(1)}%`);
  if (report.cacheAgreementRate !== null) {
    lines.push(`  cache agreement rate (кэш согласен с DOM ground truth): ${(report.cacheAgreementRate * 100).toFixed(1)}%`);
  }
  lines.push("");

  lines.push(`Чистая серия без id_mismatch: с ${report.cleanStreakSince} (${report.daysSinceLastMismatch} дн.)`);
  lines.push("");

  lines.push(`id_mismatch (${report.idMismatches.length}) -- КАЖДЫЙ требует разбора:`);
  if (report.idMismatches.length === 0) {
    lines.push("  (нет)");
  } else {
    for (const row of report.idMismatches) {
      lines.push(`  [${row.createdAt}] action=${row.actionId} athlete=${row.athleteId} source=${row.sourceDate} target=${row.targetDate} domWorkoutId=${row.domWorkoutId} resolvedWorkoutId=${row.resolvedWorkoutId} resolverMatchKind=${row.resolverMatchKind}`);
    }
  }
  lines.push("");

  lines.push(`Воздержания (${report.abstentions.length}) -- поимённо, для ручного разбора:`);
  if (report.abstentions.length === 0) {
    lines.push("  (нет)");
  } else {
    for (const row of report.abstentions) {
      lines.push(`  [${row.createdAt}] action=${row.actionId} athlete=${row.athleteId} source=${row.sourceDate} kind=${row.matchKind} candidatesOnDate=${row.candidatesOnDate} sourceKind=${row.sourceKind ?? "?"} sourcePolicy=${row.sourcePolicy ?? "?"}`);
    }
  }
  lines.push("");

  lines.push("Разбивка по бакетам (diversity gate -- нужно >=1 чистое совпадение в каждом наблюдённом бакете):");
  lines.push(formatBucketLine(report.multiWorkoutDayBucket));
  for (const bucket of report.bySourceKind) lines.push(formatBucketLine(bucket));
  for (const bucket of report.bySourcePolicy) lines.push(formatBucketLine(bucket));
  lines.push("");

  const c = report.switchCriterion;
  lines.push("=== Критерий переключения ===");
  lines.push(`  Объём: ${report.totalComparisons}/${c.minMoves} -- ${c.volumeMet ? "✅" : "❌"}`);
  lines.push(`  Длительность: ${report.daysSpanned}/${c.minDays} дн. -- ${c.durationMet ? "✅" : "❌"}`);
  lines.push(`  Ноль id_mismatch: ${c.zeroMismatchMet ? "✅" : "❌ ЕСТЬ MISMATCH"}`);
  lines.push(`  Воздержания < ${(c.maxAbstentionRate * 100).toFixed(0)}%: ${c.abstentionRateMet ? "✅" : "❌"}`);
  lines.push(`  Разнообразие бакетов: ${c.diversityMet ? "✅" : "❌"}`);
  lines.push("");
  lines.push(c.overallReady ? "✅✅✅ ВСЕ УСЛОВИЯ ВЫПОЛНЕНЫ -- можно рассматривать M4." : "❌ ЕЩЁ НЕ ГОТОВО. Блокеры:");
  for (const blocker of c.blockers) {
    lines.push(`  - ${blocker}`);
  }
  lines.push("");
  lines.push("M4 не начинать без отдельного решения Игоря по итогам этого отчёта.");

  return lines.join("\n");
}
