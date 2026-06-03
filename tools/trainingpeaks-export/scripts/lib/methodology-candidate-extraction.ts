import type { TrainingPeaksWorkoutCacheRow } from "../../../../src/features/trainingpeaks/repository.ts";

export type MethodologyFamily =
  | "easy"
  | "recovery"
  | "long_run"
  | "threshold"
  | "tempo"
  | "vo2_mapk"
  | "intervals"
  | "hills"
  | "strides"
  | "fartlek"
  | "race_pace"
  | "strength"
  | "mobility"
  | "stretching"
  | "roll"
  | "other_unknown";

export type ConsistencyStatus =
  | "consistent"
  | "title_description_mismatch"
  | "title_structure_mismatch"
  | "description_structure_mismatch"
  | "insufficient_evidence";

export type ConfidenceLabel = "high" | "medium" | "low" | "insufficient";

export type EvidenceSource = "title" | "description" | "structure" | "duration" | "tss_if";

export type DurationBucket = "0-30" | "30-45" | "45-60" | "60-75" | "75-90" | "90+";

export type MethodologyCluster = {
  key: string;
  family: MethodologyFamily;
  normalizedTitle: string;
  titleExamples: string[];
  sportOrTypeCode: string | null;
  workoutTypeValueId: number | null;
  durationBucket: DurationBucket;
  count: number;
  athleteCount: number;
  dateRange: { from: string; to: string };
  descriptionExamples: string[];
  structureSummary: string | null;
  tssIfSummary: string | null;
  plannedDurationMedianMinutes: number | null;
  completedDurationMedianMinutes: number | null;
  plannedDistanceMedianKm: number | null;
  completedDistanceMedianKm: number | null;
  complianceMedian: number | null;
  evidenceSources: EvidenceSource[];
  consistencyStatus: ConsistencyStatus;
  confidence: ConfidenceLabel;
  mismatchReasons: string[];
};

export type DataGapSummary = {
  dbFields: string[];
  availableInSnapshot: string[];
  availableInParsed: string[];
  missingEverywhere: string[];
  descriptionsLikelyViaPeriodScan: boolean;
  shouldExpandCompactSnapshot: boolean;
};

type FamilyEvidence = {
  family: MethodologyFamily;
  weight: number;
};

const TITLE_KEYWORDS: Array<{ family: MethodologyFamily; pattern: RegExp }> = [
  { family: "recovery", pattern: /\b(восстанов|recovery)\b/i },
  { family: "easy", pattern: /\b(легк|л[eё]гк|easy|аэробн)\b/i },
  { family: "long_run", pattern: /\b(длительн|long run|long)\b/i },
  { family: "threshold", pattern: /\b(пано|панно|порог|threshold)\b/i },
  { family: "tempo", pattern: /\b(темпов|tempo)\b/i },
  { family: "vo2_mapk", pattern: /\b(мпк|vo2|max)\b/i },
  { family: "intervals", pattern: /\b(интервал|interval|[456789]x[2345])\b/i },
  { family: "hills", pattern: /\b(горк|hill|uphill)\b/i },
  { family: "strides", pattern: /\b(ускорен|strides|рывк)\b/i },
  { family: "fartlek", pattern: /\b(fartlek|фартлек)\b/i },
  { family: "race_pace", pattern: /\b(соревнов|race pace|5k|10k|hm pace|marathon pace)\b/i },
  { family: "strength", pattern: /\b(силов|strength|офп|сбу)\b/i },
  { family: "mobility", pattern: /\b(mobility|мобил)\b/i },
  { family: "stretching", pattern: /\b(растяж|stretch)\b/i },
  { family: "roll", pattern: /\b(ролл|мфр|roll)\b/i },
];

const DESCRIPTION_KEYWORDS: Array<{ family: MethodologyFamily; pattern: RegExp }> = [
  { family: "easy", pattern: /\b(легк|easy|aerobic|аэробн)\b/i },
  { family: "recovery", pattern: /\b(восстанов|recovery)\b/i },
  { family: "threshold", pattern: /\b(пано|панно|порог|threshold)\b/i },
  { family: "tempo", pattern: /\b(темп|tempo)\b/i },
  { family: "vo2_mapk", pattern: /\b(мпк|vo2|vo2max)\b/i },
  { family: "intervals", pattern: /\b(интервал|interval|[456789]x[2345])\b/i },
  { family: "long_run", pattern: /\b(длительн|long run)\b/i },
  { family: "hills", pattern: /\b(горк|hill)\b/i },
  { family: "strides", pattern: /\b(ускорен|strides)\b/i },
  { family: "fartlek", pattern: /\b(фартлек|fartlek)\b/i },
  { family: "strength", pattern: /\b(силов|strength|офп|сбу)\b/i },
  { family: "mobility", pattern: /\b(мобил|mobility)\b/i },
  { family: "stretching", pattern: /\b(растяж|stretch)\b/i },
  { family: "roll", pattern: /\b(мфр|ролл|roll)\b/i },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function sanitizeDescription(value: unknown, limit = 180): string | null {
  if (typeof value !== "string") return null;
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  return compact.length <= limit ? compact : `${compact.slice(0, limit)}…`;
}

function normalizeTitle(title: string | null): string {
  const lower = (title ?? "").toLowerCase().trim();
  if (!lower) return "untitled";
  return lower
    .replace(/\b\d{1,2}[xх]\d{1,2}\b/g, " __setrep__ ")
    .replace(/\b\d+\s*(мин|минут|min|km|км)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function minutesFromRaw(raw: unknown): number | null {
  const value = toFiniteNumber(raw);
  if (value === null || value <= 0) return null;
  return value / 60;
}

function distanceKm(raw: unknown): number | null {
  const value = toFiniteNumber(raw);
  if (value === null || value <= 0) return null;
  return value / 1000;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return Number(sorted[mid]!.toFixed(2));
  return Number(((sorted[mid - 1]! + sorted[mid]!) / 2).toFixed(2));
}

function durationBucketFromMinutes(value: number | null): DurationBucket {
  if (value === null || value <= 30) return "0-30";
  if (value <= 45) return "30-45";
  if (value <= 60) return "45-60";
  if (value <= 75) return "60-75";
  if (value <= 90) return "75-90";
  return "90+";
}

function pickFamilyByKeywords(input: {
  text: string;
  patterns: Array<{ family: MethodologyFamily; pattern: RegExp }>;
  baseWeight: number;
}): FamilyEvidence[] {
  const out: FamilyEvidence[] = [];
  for (const candidate of input.patterns) {
    if (candidate.pattern.test(input.text)) {
      out.push({ family: candidate.family, weight: input.baseWeight });
    }
  }
  return out;
}

function extractStructureEvidence(structure: unknown): FamilyEvidence[] {
  const text = JSON.stringify(structure ?? {}).toLowerCase();
  if (!text || text === "{}") return [];
  const out: FamilyEvidence[] = [];
  if (/\b(repetition|repeat|interval)\b/.test(text)) out.push({ family: "intervals", weight: 4 });
  if (/\b(vo2|v[oо]2|мпк)\b/.test(text)) out.push({ family: "vo2_mapk", weight: 4 });
  if (/\b(tempo|threshold|порог|пано)\b/.test(text)) out.push({ family: "threshold", weight: 3 });
  if (/\b(hr|heart|чсс|pulse)\b/.test(text)) out.push({ family: "easy", weight: 1 });
  return out;
}

function resolveFamily(evidences: FamilyEvidence[]): MethodologyFamily {
  if (evidences.length === 0) return "other_unknown";
  const totals = new Map<MethodologyFamily, number>();
  for (const evidence of evidences) {
    totals.set(evidence.family, (totals.get(evidence.family) ?? 0) + evidence.weight);
  }
  const best = [...totals.entries()].sort((a, b) => b[1] - a[1])[0];
  return best?.[0] ?? "other_unknown";
}

function getSnapshot(row: TrainingPeaksWorkoutCacheRow): Record<string, unknown> {
  return isRecord(row.sourceSnapshot) ? row.sourceSnapshot : {};
}

function buildStructureSummary(rows: TrainingPeaksWorkoutCacheRow[]): string | null {
  const samples = rows
    .map((row) => getSnapshot(row).structure)
    .filter((entry) => entry !== null && entry !== undefined);
  if (samples.length === 0) return null;
  const text = JSON.stringify(samples[0]);
  if (text.length <= 260) return text;
  return `${text.slice(0, 260)}…`;
}

function buildTssIfSummary(rows: TrainingPeaksWorkoutCacheRow[]): string | null {
  const tssPlanned = rows
    .map((row) => toFiniteNumber(getSnapshot(row).tssPlanned))
    .filter((value): value is number => value !== null);
  const tssActual = rows
    .map((row) => toFiniteNumber(getSnapshot(row).tssActual))
    .filter((value): value is number => value !== null);
  const ifPlanned = rows
    .map((row) => toFiniteNumber(getSnapshot(row).ifPlanned))
    .filter((value): value is number => value !== null);
  const ifActual = rows
    .map((row) => toFiniteNumber(getSnapshot(row).ifActual))
    .filter((value): value is number => value !== null);

  if (tssPlanned.length + tssActual.length + ifPlanned.length + ifActual.length === 0) return null;
  const parts: string[] = [];
  if (tssPlanned.length > 0) parts.push(`TSS planned median=${median(tssPlanned)}`);
  if (tssActual.length > 0) parts.push(`TSS actual median=${median(tssActual)}`);
  if (ifPlanned.length > 0) parts.push(`IF planned median=${median(ifPlanned)}`);
  if (ifActual.length > 0) parts.push(`IF actual median=${median(ifActual)}`);
  return parts.join("; ");
}

function extractFamilyEvidenceForRow(row: TrainingPeaksWorkoutCacheRow): {
  familyByTitle: MethodologyFamily | null;
  familyByDescription: MethodologyFamily | null;
  familyByStructure: MethodologyFamily | null;
  evidenceSources: Set<EvidenceSource>;
} {
  const snapshot = getSnapshot(row);
  const title = (row.title ?? "").toLowerCase();
  const description = sanitizeDescription(snapshot.description)?.toLowerCase() ?? "";
  const structure = snapshot.structure;

  const titleEvidences = pickFamilyByKeywords({
    text: title,
    patterns: TITLE_KEYWORDS,
    baseWeight: 4,
  });
  const descriptionEvidences = pickFamilyByKeywords({
    text: description,
    patterns: DESCRIPTION_KEYWORDS,
    baseWeight: 2,
  });
  const structureEvidences = extractStructureEvidence(structure);

  const evidenceSources = new Set<EvidenceSource>();
  if (titleEvidences.length > 0) evidenceSources.add("title");
  if (descriptionEvidences.length > 0) evidenceSources.add("description");
  if (structureEvidences.length > 0) evidenceSources.add("structure");
  if (minutesFromRaw(row.plannedTimeRaw) !== null || minutesFromRaw(row.completedTimeRaw) !== null) {
    evidenceSources.add("duration");
  }
  if (
    toFiniteNumber(snapshot.tssActual) !== null ||
    toFiniteNumber(snapshot.tssPlanned) !== null ||
    toFiniteNumber(snapshot.ifActual) !== null ||
    toFiniteNumber(snapshot.ifPlanned) !== null
  ) {
    evidenceSources.add("tss_if");
  }

  return {
    familyByTitle: titleEvidences.length ? resolveFamily(titleEvidences) : null,
    familyByDescription: descriptionEvidences.length ? resolveFamily(descriptionEvidences) : null,
    familyByStructure: structureEvidences.length ? resolveFamily(structureEvidences) : null,
    evidenceSources,
  };
}

function resolveConsistency(input: {
  titleFamily: MethodologyFamily | null;
  descriptionFamily: MethodologyFamily | null;
  structureFamily: MethodologyFamily | null;
  evidenceSources: Set<EvidenceSource>;
}): { status: ConsistencyStatus; reasons: string[] } {
  const reasons: string[] = [];
  const { titleFamily, descriptionFamily, structureFamily, evidenceSources } = input;
  if (evidenceSources.size < 2) {
    return { status: "insufficient_evidence", reasons: ["only one evidence source"] };
  }
  if (titleFamily && descriptionFamily && titleFamily !== descriptionFamily) {
    reasons.push(`title=${titleFamily} vs description=${descriptionFamily}`);
  }
  if (titleFamily && structureFamily && titleFamily !== structureFamily) {
    reasons.push(`title=${titleFamily} vs structure=${structureFamily}`);
  }
  if (descriptionFamily && structureFamily && descriptionFamily !== structureFamily) {
    reasons.push(`description=${descriptionFamily} vs structure=${structureFamily}`);
  }
  if (reasons.length === 0) {
    return { status: "consistent", reasons: [] };
  }
  if (reasons.some((reason) => reason.startsWith("title=") && reason.includes("description="))) {
    return { status: "title_description_mismatch", reasons };
  }
  if (reasons.some((reason) => reason.startsWith("title=") && reason.includes("structure="))) {
    return { status: "title_structure_mismatch", reasons };
  }
  if (reasons.some((reason) => reason.startsWith("description=") && reason.includes("structure="))) {
    return { status: "description_structure_mismatch", reasons };
  }
  return { status: "insufficient_evidence", reasons };
}

function resolveConfidence(input: {
  count: number;
  athleteCount: number;
  evidenceSources: Set<EvidenceSource>;
  consistencyStatus: ConsistencyStatus;
}): ConfidenceLabel {
  if (input.evidenceSources.size < 2 || input.count < 3) return "insufficient";
  if (input.consistencyStatus === "consistent" && input.count >= 8 && input.athleteCount >= 3) return "high";
  if (input.count >= 5 && input.athleteCount >= 2) return "medium";
  return "low";
}

function familyDisplay(family: MethodologyFamily): string {
  switch (family) {
    case "vo2_mapk":
      return "VO2/MAPK";
    case "other_unknown":
      return "other/unknown";
    default:
      return family.replaceAll("_", " ");
  }
}

export function extractMethodologyClusters(rows: TrainingPeaksWorkoutCacheRow[]): MethodologyCluster[] {
  const clusters = new Map<string, TrainingPeaksWorkoutCacheRow[]>();
  for (const row of rows) {
    const normalizedTitle = normalizeTitle(row.title);
    const durationBucket = durationBucketFromMinutes(minutesFromRaw(row.plannedTimeRaw) ?? minutesFromRaw(row.completedTimeRaw));
    const key = `${normalizedTitle}|${row.sportOrTypeCode ?? "null"}|${row.workoutTypeValueId ?? "null"}|${durationBucket}`;
    const current = clusters.get(key) ?? [];
    current.push(row);
    clusters.set(key, current);
  }

  const output: MethodologyCluster[] = [];
  for (const [key, groupRows] of clusters.entries()) {
    const first = groupRows[0]!;
    const titleExamples = [...new Set(groupRows.map((row) => row.title?.trim()).filter((value): value is string => Boolean(value)))].slice(0, 6);
    const descriptionExamples = [
      ...new Set(
        groupRows
          .map((row) => sanitizeDescription(getSnapshot(row).description))
          .filter((value): value is string => Boolean(value)),
      ),
    ].slice(0, 6);

    const allEvidences: FamilyEvidence[] = [];
    const evidenceSources = new Set<EvidenceSource>();
    const titleFamilies: MethodologyFamily[] = [];
    const descriptionFamilies: MethodologyFamily[] = [];
    const structureFamilies: MethodologyFamily[] = [];

    for (const row of groupRows) {
      const perRow = extractFamilyEvidenceForRow(row);
      for (const source of perRow.evidenceSources) evidenceSources.add(source);
      if (perRow.familyByTitle) titleFamilies.push(perRow.familyByTitle);
      if (perRow.familyByDescription) descriptionFamilies.push(perRow.familyByDescription);
      if (perRow.familyByStructure) structureFamilies.push(perRow.familyByStructure);

      if (perRow.familyByTitle) allEvidences.push({ family: perRow.familyByTitle, weight: 4 });
      if (perRow.familyByDescription) allEvidences.push({ family: perRow.familyByDescription, weight: 2 });
      if (perRow.familyByStructure) allEvidences.push({ family: perRow.familyByStructure, weight: 5 });
    }

    const family = resolveFamily(allEvidences);
    const titleFamily = titleFamilies[0] ?? null;
    const descriptionFamily = descriptionFamilies[0] ?? null;
    const structureFamily = structureFamilies[0] ?? null;
    const consistency = resolveConsistency({
      titleFamily,
      descriptionFamily,
      structureFamily,
      evidenceSources,
    });
    const athleteIds = [...new Set(groupRows.map((row) => row.trainingPeaksAthleteId))];
    const plannedDurations = groupRows.map((row) => minutesFromRaw(row.plannedTimeRaw)).filter((value): value is number => value !== null);
    const completedDurations = groupRows
      .map((row) => minutesFromRaw(row.completedTimeRaw))
      .filter((value): value is number => value !== null);
    const plannedDistances = groupRows.map((row) => distanceKm(row.plannedDistanceRaw)).filter((value): value is number => value !== null);
    const completedDistances = groupRows
      .map((row) => distanceKm(row.completedDistanceRaw))
      .filter((value): value is number => value !== null);
    const compliance = groupRows
      .map((row) => toFiniteNumber(row.complianceDurationPercent) ?? toFiniteNumber(row.complianceDistancePercent))
      .filter((value): value is number => value !== null);
    const dates = groupRows.map((row) => row.workoutDate).sort();

    output.push({
      key,
      family,
      normalizedTitle: normalizeTitle(first.title),
      titleExamples,
      sportOrTypeCode: first.sportOrTypeCode,
      workoutTypeValueId: first.workoutTypeValueId,
      durationBucket: durationBucketFromMinutes(median(plannedDurations) ?? median(completedDurations)),
      count: groupRows.length,
      athleteCount: athleteIds.length,
      dateRange: { from: dates[0]!, to: dates[dates.length - 1]! },
      descriptionExamples,
      structureSummary: buildStructureSummary(groupRows),
      tssIfSummary: buildTssIfSummary(groupRows),
      plannedDurationMedianMinutes: median(plannedDurations),
      completedDurationMedianMinutes: median(completedDurations),
      plannedDistanceMedianKm: median(plannedDistances),
      completedDistanceMedianKm: median(completedDistances),
      complianceMedian: median(compliance),
      evidenceSources: [...evidenceSources].sort(),
      consistencyStatus: consistency.status,
      confidence: resolveConfidence({
        count: groupRows.length,
        athleteCount: athleteIds.length,
        evidenceSources,
        consistencyStatus: consistency.status,
      }),
      mismatchReasons: consistency.reasons,
    });
  }

  return output.sort((a, b) => b.count - a.count || a.normalizedTitle.localeCompare(b.normalizedTitle));
}

export function buildFamilySummaryMarkdown(clusters: MethodologyCluster[]): string {
  const byFamily = new Map<MethodologyFamily, MethodologyCluster[]>();
  for (const cluster of clusters) {
    const current = byFamily.get(cluster.family) ?? [];
    current.push(cluster);
    byFamily.set(cluster.family, current);
  }
  const lines: string[] = ["# Family Summary", ""];
  const families = [...byFamily.keys()].sort((a, b) => familyDisplay(a).localeCompare(familyDisplay(b)));
  for (const family of families) {
    const items = byFamily.get(family) ?? [];
    const high = items.filter((item) => item.confidence === "high").length;
    const medium = items.filter((item) => item.confidence === "medium").length;
    const mismatch = items.filter((item) => item.consistencyStatus !== "consistent").length;
    lines.push(`## ${familyDisplay(family)}`);
    lines.push(`- clusters: ${items.length}`);
    lines.push(`- high_confidence: ${high}`);
    lines.push(`- medium_confidence: ${medium}`);
    lines.push(`- mismatch_clusters: ${mismatch}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export function buildMismatchReportMarkdown(clusters: MethodologyCluster[]): string {
  const mismatches = clusters.filter(
    (cluster) => cluster.consistencyStatus !== "consistent" || cluster.confidence === "low" || cluster.confidence === "insufficient",
  );
  const lines: string[] = ["# Description / Structure Mismatch Report", ""];
  if (mismatches.length === 0) {
    lines.push("- no mismatch clusters found");
    return `${lines.join("\n")}\n`;
  }
  for (const cluster of mismatches) {
    lines.push(`## ${familyDisplay(cluster.family)} — ${cluster.normalizedTitle} — ${cluster.durationBucket} min`);
    lines.push(`- count: ${cluster.count}`);
    lines.push(`- athlete_count: ${cluster.athleteCount}`);
    lines.push(`- confidence: ${cluster.confidence}`);
    lines.push(`- consistency: ${cluster.consistencyStatus}`);
    lines.push(`- evidence: ${cluster.evidenceSources.join(", ") || "none"}`);
    lines.push(`- reasons: ${cluster.mismatchReasons.join("; ") || "n/a"}`);
    lines.push(`- title examples: ${cluster.titleExamples.join(" | ") || "n/a"}`);
    lines.push(`- description snippets: ${cluster.descriptionExamples.join(" | ") || "n/a"}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export function buildCandidatesMarkdown(clusters: MethodologyCluster[]): string {
  const lines: string[] = ["# Methodology Candidates", ""];
  const grouped = new Map<MethodologyFamily, MethodologyCluster[]>();
  for (const cluster of clusters) {
    const current = grouped.get(cluster.family) ?? [];
    current.push(cluster);
    grouped.set(cluster.family, current);
  }
  const families = [...grouped.keys()].sort((a, b) => familyDisplay(a).localeCompare(familyDisplay(b)));
  for (const family of families) {
    lines.push(`## ${familyDisplay(family)}`);
    lines.push("");
    for (const cluster of grouped.get(family) ?? []) {
      lines.push(`### ${familyDisplay(cluster.family)} — ${cluster.normalizedTitle} — ${cluster.durationBucket} min`);
      lines.push(`- count: ${cluster.count}`);
      lines.push(`- athlete_count: ${cluster.athleteCount}`);
      lines.push(`- confidence: ${cluster.confidence}`);
      lines.push(`- consistency: ${cluster.consistencyStatus}`);
      lines.push(`- evidence: ${cluster.evidenceSources.join(", ") || "none"}`);
      lines.push(`- title examples: ${cluster.titleExamples.join(" | ") || "n/a"}`);
      lines.push(`- description snippets: ${cluster.descriptionExamples.join(" | ") || "n/a"}`);
      lines.push(`- structure summary: ${cluster.structureSummary ?? "n/a"}`);
      lines.push(`- duration/TSS summary: ${cluster.tssIfSummary ?? "n/a"}`);
      lines.push(`- suggested template candidate: ${cluster.normalizedTitle}`);
      lines.push(`- needs Igor review: ${cluster.consistencyStatus !== "consistent" ? "yes" : "recommended"}`);
      lines.push("");
    }
  }
  return `${lines.join("\n")}\n`;
}

export function buildTemplateLibraryV0Markdown(clusters: MethodologyCluster[]): string {
  const sections: Array<{ title: string; families: MethodologyFamily[] }> = [
    { title: "Easy / aerobic", families: ["easy"] },
    { title: "Recovery", families: ["recovery"] },
    { title: "Long run", families: ["long_run"] },
    { title: "Threshold / tempo", families: ["threshold", "tempo"] },
    { title: "VO2 / MAPK", families: ["vo2_mapk", "intervals"] },
    { title: "Hills", families: ["hills"] },
    { title: "Strides", families: ["strides"] },
    { title: "Fartlek", families: ["fartlek"] },
    { title: "Race-specific", families: ["race_pace"] },
    { title: "Strength", families: ["strength"] },
    { title: "Mobility / stretching / roll", families: ["mobility", "stretching", "roll"] },
  ];

  const lines: string[] = ["# Recommended Template Library v0 (Draft)", ""];
  for (const section of sections) {
    const sectionClusters = clusters.filter((cluster) => section.families.includes(cluster.family));
    const top = sectionClusters.slice(0, 4);
    lines.push(`## ${section.title}`);
    lines.push(`- observed patterns: ${top.map((cluster) => cluster.normalizedTitle).join(" | ") || "insufficient evidence"}`);
    lines.push(`- candidate template names: ${top.map((cluster) => cluster.titleExamples[0] ?? cluster.normalizedTitle).join(" | ") || "define manually"}`);
    lines.push("- recommended variants: HR / Pace / RPE where applicable");
    lines.push(`- enough evidence: ${sectionClusters.some((cluster) => cluster.confidence === "high" || cluster.confidence === "medium") ? "yes" : "no"}`);
    lines.push(
      `- what Igor should define manually: ${sectionClusters.some((cluster) => cluster.consistencyStatus !== "consistent") ? "resolve mismatch clusters and lock canonical wording" : "confirm canonical wording and guardrails"}`,
    );
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export function buildDataGapsMarkdown(input: {
  clusters: MethodologyCluster[];
  dataGapSummary: DataGapSummary;
}): string {
  const mismatchCount = input.clusters.filter((item) => item.consistencyStatus !== "consistent").length;
  const lines: string[] = ["# Data Gaps", ""];
  lines.push(`- db fields in trainingpeaks_workout_cache: ${input.dataGapSummary.dbFields.join(", ")}`);
  lines.push(`- fields available in source_snapshot: ${input.dataGapSummary.availableInSnapshot.join(", ") || "none"}`);
  lines.push(`- fields available in parsed artifacts: ${input.dataGapSummary.availableInParsed.join(", ") || "none"}`);
  lines.push(`- fields missing entirely: ${input.dataGapSummary.missingEverywhere.join(", ") || "none"}`);
  lines.push(
    `- descriptions likely via period scan: ${input.dataGapSummary.descriptionsLikelyViaPeriodScan ? "yes" : "unknown"}`,
  );
  lines.push(
    `- should expand buildCompactSourceSnapshot(): ${input.dataGapSummary.shouldExpandCompactSnapshot ? "yes" : "no"}`,
  );
  lines.push(`- mismatch clusters detected: ${mismatchCount}`);
  lines.push("");
  lines.push("Recommendation: use description as secondary evidence and mismatch detector; keep title/structure as primary payload compatibility signals.");
  return `${lines.join("\n")}\n`;
}
