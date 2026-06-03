import type { TrainingPeaksWorkoutCacheRow } from "../../../../src/features/trainingpeaks/repository.ts";

export type MethodologyFamily =
  | "easy"
  | "recovery"
  | "long_run"
  | "threshold_tempo"
  | "vo2_mapk"
  | "hills"
  | "strides"
  | "fartlek"
  | "race_specific"
  | "strength"
  | "mobility"
  | "other_unknown";

export type StructureType = "continuous" | "intervals" | "strides" | "mixed" | "strength" | "mobility" | "unknown";

export type ConsistencyStatus =
  | "consistent"
  | "title_description_mismatch"
  | "title_structure_mismatch"
  | "description_structure_mismatch"
  | "duration_mismatch"
  | "insufficient_evidence";

export type ConfidenceLabel = "high" | "medium" | "low" | "insufficient";

export type EvidenceSource =
  | "title"
  | "description"
  | "structure"
  | "duration"
  | "description_duration"
  | "completed_duration"
  | "tss_if";

export type DurationBucket = "0-30 min" | "30-45 min" | "45-60 min" | "60-75 min" | "75-90 min" | "90+ min";

export type MethodologyCluster = {
  key: string;
  family: MethodologyFamily;
  structureType: StructureType;
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
  durationEvidence: "snapshot_totalTimePlanned" | "planned_time_raw" | "structure_total" | "description_duration" | "completed_time_raw" | "none";
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

const EASY_KEYWORDS = /(легк|л[eё]гк|easy|аэробн|по ощущениям|комфорт|спокойн|свободн)/i;
const RECOVERY_KEYWORDS = /(восстанов|recovery|очень легко|после тяжел|после старта|восстановление)/i;
const LONG_RUN_KEYWORDS = /(длительн|long run|\blong\b)/i;
const THRESHOLD_KEYWORDS = /(пано|панно|порог|threshold|tempo|темпов)/i;
const VO2_KEYWORDS = /(мпк|vo2|max|максимальное потребление)/i;
const HILLS_KEYWORDS = /(горк|по горкам|hill|uphill|подъем|подъём)/i;
const STRIDES_KEYWORDS = /(\bstrides?\b|ускорения|короткие ускорения|рывки)/i;
const FARTLEK_KEYWORDS = /(фартлек|fartlek|переменный бег|переменный)/i;
const RACE_SPECIFIC_KEYWORDS = /(соревнов|race pace|целевой темп|темп старта|марафонский темп|полумарафонский темп|10к темп|5к темп)/i;
const STRENGTH_KEYWORDS = /(силов|офп|сбу|\bstrength\b|\bcore\b)/i;
const MOBILITY_KEYWORDS = /(растяж|stretch|stretching|mobility|ролл|roll|мфр|foam roller)/i;
const EASY_PACE_MARKERS = /(легк\w*\s+бег\s+по\s+темпу|легк\w*\s+по\s+темпу|comfortable|easy pace)/i;
const TEMPO_RUN_KEYWORDS = /(бег по темпу|темповый бег|tempo run)/i;
const INTERVAL_PATTERN = /(\d{1,2})\s*[xх*]\s*(\d{1,2}(?:[.,]\d+)?)/i;
const HARD_REPEAT_MARKER = /\b([4-9]|1\d|2\d)\s*[xх*]\s*([1-5](?:[.,]\d+)?)\b/i;

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

function parseClockDuration(raw: string): number | null {
  const value = raw.trim();
  const hms = value.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (hms) {
    const hours = Number(hms[1]);
    const minutes = Number(hms[2]);
    const seconds = Number(hms[3]);
    return hours * 60 + minutes + seconds / 60;
  }
  const hm = value.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) {
    const hours = Number(hm[1]);
    const minutes = Number(hm[2]);
    return hours * 60 + minutes;
  }
  return null;
}

function parseDurationDescriptionMinutes(text: string): number | null {
  const compact = text.toLowerCase();
  const hMin = compact.match(/(\d{1,2})\s*(?:ч|час)\s*(\d{1,2})\s*(?:мин|м)/i);
  if (hMin) return Number(hMin[1]) * 60 + Number(hMin[2]);
  const onlyHours = compact.match(/(\d{1,2}(?:[.,]\d+)?)\s*(?:ч|час)/i);
  if (onlyHours) return Number(onlyHours[1].replace(",", ".")) * 60;
  const minutes = compact.match(/(\d{1,3}(?:[.,]\d+)?)\s*(?:минут|мин|м)\b/i);
  if (minutes) return Number(minutes[1].replace(",", "."));
  return null;
}

function durationMinutesFromValue(raw: unknown, mode: "secondsPreferred" | "flex"): number | null {
  if (typeof raw === "string") {
    const clock = parseClockDuration(raw);
    if (clock !== null && clock > 0) return clock;
    const textDuration = parseDurationDescriptionMinutes(raw);
    if (textDuration !== null && textDuration > 0) return textDuration;
  }
  const numeric = toFiniteNumber(raw);
  if (numeric === null || numeric <= 0) return null;
  if (mode === "secondsPreferred") {
    if (numeric <= 6) return numeric * 60;
    return numeric / 60;
  }
  if (numeric >= 300) return numeric / 60;
  if (numeric <= 6) return numeric * 60;
  return numeric;
}

function extractStructureDurationMinutes(structure: unknown): number | null {
  if (!isRecord(structure)) return null;
  const queue: unknown[] = [structure];
  const candidates: number[] = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (Array.isArray(current)) {
      for (const item of current) queue.push(item);
      continue;
    }
    if (!isRecord(current)) continue;
    for (const [key, value] of Object.entries(current)) {
      if (isRecord(value) || Array.isArray(value)) {
        queue.push(value);
      }
      const lowerKey = key.toLowerCase();
      if (!/(time|duration|min|sec|hour|total)/.test(lowerKey)) continue;
      const number = toFiniteNumber(value);
      if (number === null || number <= 0) continue;
      if (/(sec|second)/.test(lowerKey)) candidates.push(number / 60);
      else if (/(hour|hr)/.test(lowerKey)) candidates.push(number * 60);
      else if (/(min|minute)/.test(lowerKey)) candidates.push(number);
      else if (number >= 300) candidates.push(number / 60);
      else candidates.push(number);
    }
  }
  if (candidates.length === 0) return null;
  return Math.max(...candidates);
}

function pickBestPlannedDuration(row: TrainingPeaksWorkoutCacheRow): {
  minutes: number | null;
  source: MethodologyCluster["durationEvidence"];
} {
  const snapshot = getSnapshot(row);
  const snapshotDuration = durationMinutesFromValue(snapshot.totalTimePlanned, "flex");
  if (snapshotDuration !== null) return { minutes: snapshotDuration, source: "snapshot_totalTimePlanned" };

  const plannedRaw = durationMinutesFromValue(row.plannedTimeRaw, "secondsPreferred");
  if (plannedRaw !== null) return { minutes: plannedRaw, source: "planned_time_raw" };

  const structureDuration = extractStructureDurationMinutes(snapshot.structure);
  if (structureDuration !== null) return { minutes: structureDuration, source: "structure_total" };

  const descriptionText = sanitizeDescription(snapshot.description);
  if (descriptionText) {
    const descriptionDuration = parseDurationDescriptionMinutes(descriptionText);
    if (descriptionDuration !== null) return { minutes: descriptionDuration, source: "description_duration" };
  }

  const completedRaw = durationMinutesFromValue(row.completedTimeRaw, "secondsPreferred");
  if (completedRaw !== null) return { minutes: completedRaw, source: "completed_time_raw" };

  return { minutes: null, source: "none" };
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
  if (value === null || value <= 30) return "0-30 min";
  if (value < 45) return "30-45 min";
  if (value < 60) return "45-60 min";
  if (value < 75) return "60-75 min";
  if (value < 90) return "75-90 min";
  return "90+ min";
}

function hasHardRepeatPattern(text: string): boolean {
  return HARD_REPEAT_MARKER.test(text.replaceAll(",", "."));
}

function extractIntervalShape(text: string): { reps: number; workMinutes: number } | null {
  const match = text.match(INTERVAL_PATTERN);
  if (!match) return null;
  const reps = Number(match[1]);
  const workMinutes = Number(match[2].replace(",", "."));
  if (!Number.isFinite(reps) || !Number.isFinite(workMinutes)) return null;
  return { reps, workMinutes };
}

function classifyStructureType(input: {
  title: string;
  description: string;
  structure: unknown;
  family: MethodologyFamily;
}): StructureType {
  if (input.family === "strength") return "strength";
  if (input.family === "mobility") return "mobility";
  if (input.family === "strides") return "strides";
  if (input.family === "fartlek") return "mixed";
  const structureText = JSON.stringify(input.structure ?? {}).toLowerCase();
  const combined = `${input.title} ${input.description}`.toLowerCase();
  const repeatedBlocksInStructure = /"repetitionvalue"\s*:\s*(?:[4-9]|[1-9]\d)/i.test(structureText);
  if (
    /\b(interval|интервал)\w*\b/.test(structureText) ||
    /\b(interval|интервал)\w*\b/.test(combined) ||
    hasHardRepeatPattern(combined) ||
    repeatedBlocksInStructure ||
    /\bинтервал/i.test(combined)
  ) {
    return "intervals";
  }
  if (/\b(переменный|fartlek|фартлек)\b/i.test(combined)) return "mixed";
  return "continuous";
}

function inferFamilyFromText(text: string): MethodologyFamily | null {
  const lower = text.toLowerCase();
  if (!lower.trim()) return null;
  if (STRENGTH_KEYWORDS.test(lower)) return "strength";
  if (MOBILITY_KEYWORDS.test(lower)) return "mobility";
  if (HILLS_KEYWORDS.test(lower)) return "hills";
  if (STRIDES_KEYWORDS.test(lower)) return "strides";
  if (FARTLEK_KEYWORDS.test(lower)) return "fartlek";
  if (RACE_SPECIFIC_KEYWORDS.test(lower)) return "race_specific";
  if (RECOVERY_KEYWORDS.test(lower)) return "recovery";
  if (LONG_RUN_KEYWORDS.test(lower)) return "long_run";
  if (VO2_KEYWORDS.test(lower)) return "vo2_mapk";
  if (THRESHOLD_KEYWORDS.test(lower)) {
    if (EASY_PACE_MARKERS.test(lower)) return "easy";
    return "threshold_tempo";
  }
  if (EASY_KEYWORDS.test(lower)) return "easy";
  return null;
}

function resolveFamily(input: {
  row: TrainingPeaksWorkoutCacheRow;
  title: string;
  description: string;
  plannedDurationMinutes: number | null;
  structure: unknown;
}): { family: MethodologyFamily; evidences: FamilyEvidence[] } {
  const { row, title, description, plannedDurationMinutes, structure } = input;
  const sport = (row.sportOrTypeCode ?? "").toLowerCase();
  const combinedText = `${title} ${description}`.toLowerCase();
  const evidences: FamilyEvidence[] = [];

  const titleFamily = inferFamilyFromText(title);
  const descriptionFamily = inferFamilyFromText(description);
  if (titleFamily) evidences.push({ family: titleFamily, weight: 6 });
  if (descriptionFamily) evidences.push({ family: descriptionFamily, weight: 3 });

  if (STRENGTH_KEYWORDS.test(combinedText) || sport.includes("strength") || sport.includes("gym")) {
    evidences.push({ family: "strength", weight: 7 });
  }
  if (MOBILITY_KEYWORDS.test(combinedText)) {
    evidences.push({ family: "mobility", weight: 7 });
  }
  if (HILLS_KEYWORDS.test(combinedText)) evidences.push({ family: "hills", weight: 8 });
  if (STRIDES_KEYWORDS.test(combinedText)) evidences.push({ family: "strides", weight: 8 });
  if (FARTLEK_KEYWORDS.test(combinedText)) evidences.push({ family: "fartlek", weight: 8 });
  if (RACE_SPECIFIC_KEYWORDS.test(combinedText)) evidences.push({ family: "race_specific", weight: 8 });
  if (RECOVERY_KEYWORDS.test(combinedText)) evidences.push({ family: "recovery", weight: 8 });

  const intervalShape = extractIntervalShape(combinedText);
  const hasVO2Signal = VO2_KEYWORDS.test(combinedText);
  const hasHardRepeats = hasHardRepeatPattern(combinedText);
  if (hasVO2Signal) {
    evidences.push({ family: "vo2_mapk", weight: 9 });
  } else if (intervalShape && intervalShape.reps >= 4 && intervalShape.workMinutes >= 1 && intervalShape.workMinutes <= 5) {
    evidences.push({ family: "vo2_mapk", weight: 9 });
  }

  if (THRESHOLD_KEYWORDS.test(combinedText)) {
    if (EASY_PACE_MARKERS.test(combinedText) || /легк/i.test(combinedText)) {
      evidences.push({ family: "easy", weight: 7 });
    } else {
      evidences.push({ family: "threshold_tempo", weight: 7 });
    }
  } else if (TEMPO_RUN_KEYWORDS.test(combinedText)) {
    evidences.push({ family: "threshold_tempo", weight: 6 });
  }

  if (EASY_KEYWORDS.test(combinedText) && !hasVO2Signal && !hasHardRepeats && !HILLS_KEYWORDS.test(combinedText)) {
    evidences.push({ family: "easy", weight: 7 });
  }

  if (
    (LONG_RUN_KEYWORDS.test(combinedText) || durationBucketFromMinutes(plannedDurationMinutes) === "75-90 min" || durationBucketFromMinutes(plannedDurationMinutes) === "90+ min") &&
    !hasVO2Signal &&
    !hasHardRepeats &&
    !/\b(порог|threshold|vo2|мпк)\b/i.test(combinedText)
  ) {
    evidences.push({ family: "long_run", weight: 7 });
  }

  const structureText = JSON.stringify(structure ?? {}).toLowerCase();
  if (/\b(vo2|v[oо]2|мпк)\b/.test(structureText)) evidences.push({ family: "vo2_mapk", weight: 4 });
  if (/\b(tempo|threshold|порог|пано)\b/.test(structureText)) evidences.push({ family: "threshold_tempo", weight: 3 });
  if (/\b(hr|heart|чсс|pulse)\b/.test(structureText) && !hasHardRepeats) evidences.push({ family: "easy", weight: 2 });

  if (evidences.length === 0) return { family: "other_unknown", evidences: [] };
  const totals = new Map<MethodologyFamily, number>();
  for (const evidence of evidences) {
    totals.set(evidence.family, (totals.get(evidence.family) ?? 0) + evidence.weight);
  }
  const best = [...totals.entries()].sort((a, b) => b[1] - a[1])[0];
  return { family: best?.[0] ?? "other_unknown", evidences };
}

function resolveFamilyFromEvidences(evidences: FamilyEvidence[]): MethodologyFamily {
  if (evidences.length === 0) return "other_unknown";
  const totals = new Map<MethodologyFamily, number>();
  for (const evidence of evidences) {
    totals.set(evidence.family, (totals.get(evidence.family) ?? 0) + evidence.weight);
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "other_unknown";
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
  family: MethodologyFamily;
  familyByTitle: MethodologyFamily | null;
  familyByDescription: MethodologyFamily | null;
  structureType: StructureType;
  evidenceSources: Set<EvidenceSource>;
  durationMinutes: number | null;
  durationEvidence: MethodologyCluster["durationEvidence"];
  durationMentionMinutes: number | null;
} {
  const snapshot = getSnapshot(row);
  const title = (row.title ?? "").toLowerCase();
  const description = sanitizeDescription(snapshot.description)?.toLowerCase() ?? "";
  const structure = snapshot.structure;
  const duration = pickBestPlannedDuration(row);
  const durationMentionMinutes = parseDurationDescriptionMinutes(`${row.title ?? ""} ${description}`);

  const familyByTitle = inferFamilyFromText(title);
  const familyByDescription = inferFamilyFromText(description);
  const resolvedFamily = resolveFamily({
    row,
    title,
    description,
    plannedDurationMinutes: duration.minutes,
    structure,
  });
  const structureType = classifyStructureType({
    title,
    description,
    structure,
    family: resolvedFamily.family,
  });

  const evidenceSources = new Set<EvidenceSource>();
  if (familyByTitle !== null) evidenceSources.add("title");
  if (familyByDescription !== null) evidenceSources.add("description");
  if (structureType !== "unknown") evidenceSources.add("structure");
  if (duration.minutes !== null) {
    if (duration.source === "description_duration") evidenceSources.add("description_duration");
    else if (duration.source === "completed_time_raw") evidenceSources.add("completed_duration");
    else evidenceSources.add("duration");
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
    family: resolvedFamily.family,
    familyByTitle,
    familyByDescription,
    structureType,
    evidenceSources,
    durationMinutes: duration.minutes,
    durationEvidence: duration.source,
    durationMentionMinutes,
  };
}

function resolveConsistency(input: {
  titleFamily: MethodologyFamily | null;
  descriptionFamily: MethodologyFamily | null;
  family: MethodologyFamily;
  structureType: StructureType;
  durationMentionMinutes: number | null;
  computedDurationBucket: DurationBucket;
  evidenceSources: Set<EvidenceSource>;
}): { status: ConsistencyStatus; reasons: string[] } {
  const reasons: string[] = [];
  const { titleFamily, descriptionFamily, family, structureType, durationMentionMinutes, computedDurationBucket, evidenceSources } = input;
  if (evidenceSources.size < 2) {
    return { status: "insufficient_evidence", reasons: ["only one evidence source"] };
  }
  if (titleFamily && descriptionFamily && titleFamily !== descriptionFamily) {
    reasons.push(`title=${titleFamily} vs description=${descriptionFamily}`);
  }
  if (titleFamily === "easy" && structureType === "intervals" && family !== "threshold_tempo" && family !== "vo2_mapk") {
    reasons.push(`title=${titleFamily} vs structure=${structureType}`);
  }
  if (descriptionFamily === "easy" && structureType === "intervals" && family !== "threshold_tempo" && family !== "vo2_mapk") {
    reasons.push(`description=${descriptionFamily} vs structure=${structureType}`);
  }
  if (durationMentionMinutes !== null) {
    const mentionedBucket = durationBucketFromMinutes(durationMentionMinutes);
    if (mentionedBucket !== computedDurationBucket) {
      reasons.push(`duration text=${mentionedBucket} vs computed=${computedDurationBucket}`);
      return { status: "duration_mismatch", reasons };
    }
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
    case "threshold_tempo":
      return "threshold / tempo";
    case "vo2_mapk":
      return "VO2/MAPK";
    case "race_specific":
      return "race specific";
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
    const pickedDuration = pickBestPlannedDuration(row);
    const durationBucket = durationBucketFromMinutes(pickedDuration.minutes);
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
    const structureTypes: StructureType[] = [];
    const plannedDurations: number[] = [];
    const completedDurations: number[] = [];
    const descriptionDurationMentions: number[] = [];
    const durationEvidenceByRow: MethodologyCluster["durationEvidence"][] = [];

    for (const row of groupRows) {
      const perRow = extractFamilyEvidenceForRow(row);
      for (const source of perRow.evidenceSources) evidenceSources.add(source);
      if (perRow.familyByTitle) titleFamilies.push(perRow.familyByTitle);
      if (perRow.familyByDescription) descriptionFamilies.push(perRow.familyByDescription);
      structureTypes.push(perRow.structureType);
      durationEvidenceByRow.push(perRow.durationEvidence);
      if (perRow.durationMinutes !== null) plannedDurations.push(perRow.durationMinutes);
      const completedMinutes = durationMinutesFromValue(row.completedTimeRaw, "secondsPreferred");
      if (completedMinutes !== null) completedDurations.push(completedMinutes);
      if (perRow.durationMentionMinutes !== null) descriptionDurationMentions.push(perRow.durationMentionMinutes);

      allEvidences.push({ family: perRow.family, weight: 6 });
      if (perRow.familyByTitle) allEvidences.push({ family: perRow.familyByTitle, weight: 4 });
      if (perRow.familyByDescription) allEvidences.push({ family: perRow.familyByDescription, weight: 2 });
    }

    const family = resolveFamilyFromEvidences(allEvidences);
    const structureType = (() => {
      if (structureTypes.length === 0) return "unknown" as StructureType;
      const counts = new Map<StructureType, number>();
      for (const value of structureTypes) counts.set(value, (counts.get(value) ?? 0) + 1);
      return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";
    })();
    const titleFamily = titleFamilies[0] ?? null;
    const descriptionFamily = descriptionFamilies[0] ?? null;
    const computedDurationBucket = durationBucketFromMinutes(median(plannedDurations) ?? median(completedDurations));
    const consistency = resolveConsistency({
      titleFamily,
      descriptionFamily,
      family,
      structureType,
      durationMentionMinutes: median(descriptionDurationMentions),
      computedDurationBucket,
      evidenceSources,
    });
    const athleteIds = [...new Set(groupRows.map((row) => row.trainingPeaksAthleteId))];
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
      structureType,
      normalizedTitle: normalizeTitle(first.title),
      titleExamples,
      sportOrTypeCode: first.sportOrTypeCode,
      workoutTypeValueId: first.workoutTypeValueId,
      durationBucket: computedDurationBucket,
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
      durationEvidence: (() => {
        const counts = new Map<MethodologyCluster["durationEvidence"], number>();
        for (const source of durationEvidenceByRow) counts.set(source, (counts.get(source) ?? 0) + 1);
        return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "none";
      })(),
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
    const byStructure = new Map<StructureType, number>();
    for (const item of items) byStructure.set(item.structureType, (byStructure.get(item.structureType) ?? 0) + 1);
    const structureLine = [...byStructure.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => `${type}:${count}`)
      .join(", ");
    lines.push(`## ${familyDisplay(family)}`);
    lines.push(`- clusters: ${items.length}`);
    lines.push(`- high_confidence: ${high}`);
    lines.push(`- medium_confidence: ${medium}`);
    lines.push(`- mismatch_clusters: ${mismatch}`);
    lines.push(`- structure_types: ${structureLine || "n/a"}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export function buildMismatchReportMarkdown(clusters: MethodologyCluster[]): string {
  const mismatches = clusters.filter((cluster) => cluster.consistencyStatus !== "consistent");
  const lines: string[] = ["# Description / Structure Mismatch Report", ""];
  if (mismatches.length === 0) {
    lines.push("- no mismatch clusters found");
    return `${lines.join("\n")}\n`;
  }
  for (const cluster of mismatches) {
    lines.push(`## ${familyDisplay(cluster.family)} — ${cluster.normalizedTitle} — ${cluster.durationBucket}`);
    lines.push(`- count: ${cluster.count}`);
    lines.push(`- athlete_count: ${cluster.athleteCount}`);
    lines.push(`- confidence: ${cluster.confidence}`);
    lines.push(`- consistency: ${cluster.consistencyStatus}`);
    lines.push(`- structure_type: ${cluster.structureType}`);
    lines.push(`- evidence: ${cluster.evidenceSources.join(", ") || "none"}`);
    lines.push(`- duration_source: ${cluster.durationEvidence}`);
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
      lines.push(`### ${familyDisplay(cluster.family)} — ${cluster.normalizedTitle} — ${cluster.durationBucket}`);
      lines.push(`- count: ${cluster.count}`);
      lines.push(`- athlete_count: ${cluster.athleteCount}`);
      lines.push(`- confidence: ${cluster.confidence}`);
      lines.push(`- consistency: ${cluster.consistencyStatus}`);
      lines.push(`- structure_type: ${cluster.structureType}`);
      lines.push(`- evidence: ${cluster.evidenceSources.join(", ") || "none"}`);
      lines.push(`- duration_source: ${cluster.durationEvidence}`);
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
    { title: "Threshold / tempo", families: ["threshold_tempo"] },
    { title: "VO2 / MAPK", families: ["vo2_mapk"] },
    { title: "Hills", families: ["hills"] },
    { title: "Strides", families: ["strides"] },
    { title: "Fartlek", families: ["fartlek"] },
    { title: "Race-specific", families: ["race_specific"] },
    { title: "Strength", families: ["strength"] },
    { title: "Mobility / stretching / roll", families: ["mobility"] },
  ];

  const lines: string[] = ["# Recommended Template Library v0 (Draft)", ""];
  for (const section of sections) {
    const sectionClusters = clusters.filter((cluster) => section.families.includes(cluster.family)).sort((a, b) => b.count - a.count);
    const top = sectionClusters.slice(0, 6);
    const confidenceCounts = {
      high: sectionClusters.filter((cluster) => cluster.confidence === "high").length,
      medium: sectionClusters.filter((cluster) => cluster.confidence === "medium").length,
      low: sectionClusters.filter((cluster) => cluster.confidence === "low").length,
      insufficient: sectionClusters.filter((cluster) => cluster.confidence === "insufficient").length,
    };
    const hasHr = top.some((cluster) => /\b(пульс|чсс|hr|heart)\b/i.test(`${cluster.titleExamples.join(" ")} ${cluster.descriptionExamples.join(" ")}`));
    const hasPace = top.some((cluster) => /\b(темп|pace|min\/km|км\/ч)\b/i.test(`${cluster.titleExamples.join(" ")} ${cluster.descriptionExamples.join(" ")}`));
    const hasRpe = top.some((cluster) => /\b(rpe|ощущени|комфорт|по самочувств)\b/i.test(`${cluster.titleExamples.join(" ")} ${cluster.descriptionExamples.join(" ")}`));
    const variants = [hasHr ? "HR" : null, hasPace ? "Pace" : null, hasRpe ? "RPE" : null].filter((item): item is string => item !== null);
    const enoughEvidence: "yes" | "partial" | "no" =
      confidenceCounts.high + confidenceCounts.medium > 0 ? "yes" : sectionClusters.length > 0 ? "partial" : "no";
    const mismatchCount = sectionClusters.filter((cluster) => cluster.consistencyStatus !== "consistent").length;
    const dataIssues = [...new Set(sectionClusters.flatMap((cluster) => cluster.mismatchReasons))].slice(0, 4);

    lines.push(`## ${section.title}`);
    lines.push(`- observed patterns: ${top.map((cluster) => cluster.normalizedTitle).join(" | ") || "insufficient evidence"}`);
    lines.push(
      `- candidate template names: ${[...new Set(top.map((cluster) => cluster.titleExamples[0] ?? cluster.normalizedTitle))].join(" | ") || "define manually"}`,
    );
    lines.push(`- recommended variants: ${variants.join(" / ") || "define by coach"}`);
    lines.push(`- enough evidence: ${enoughEvidence}`);
    lines.push(
      `- confidence summary: high=${confidenceCounts.high}, medium=${confidenceCounts.medium}, low=${confidenceCounts.low}, insufficient=${confidenceCounts.insufficient}`,
    );
    lines.push(
      `- what Igor should define manually: ${mismatchCount > 0 ? "resolve mismatches, then lock canonical wording and guardrails" : "confirm canonical wording and fallback variants"}`,
    );
    lines.push(`- known data issues: ${dataIssues.join(" | ") || "none detected in current clusters"}`);
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
