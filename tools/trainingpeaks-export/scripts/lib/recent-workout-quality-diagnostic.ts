import type { TrainingPeaksWorkoutCacheRow } from "../../../../src/features/trainingpeaks/repository.ts";
import {
  classifyWorkout,
  intervalPatternFromText,
  toFiniteNumber,
  type TrainingFamily,
} from "./athlete-training-baseline.ts";

export type EstimatedQualityType =
  | "vo2max_intervals"
  | "short_intervals"
  | "controlled_sub_threshold"
  | "threshold_tempo"
  | "race_specific"
  | "long_easy"
  | "easy"
  | "unknown";

export type DiagnosticConfidence = "high" | "medium" | "low" | "insufficient";

export type ParsedIntervalStructure = {
  repeat_count: number | null;
  work_duration: string | null;
  recovery_duration: string | null;
  quality_family: "short_intervals" | "vo2max_intervals" | "controlled_sub_threshold" | "threshold_tempo" | null;
  raw_pattern: string | null;
};

export type WorkoutDiagnosticRow = {
  date: string;
  title: string;
  duration_minutes: number | null;
  distance_km: number | null;
  status: "planned_and_completed" | "completed" | "planned" | "other";
  workout_type: string | null;
  is_planned: boolean;
  is_completed: boolean;
  source_flags: {
    paired_planned_and_completed: boolean;
    completed_only: boolean;
    planned_only: boolean;
  };
  notes_excerpt: string | null;
  estimated_quality_type: EstimatedQualityType;
  estimated_structure: string | null;
  confidence: DiagnosticConfidence;
  flags: string[];
  training_family: TrainingFamily;
  quality_like: boolean;
  interval_structure: ParsedIntervalStructure | null;
  trainingpeaks_workout_id: number;
};

export type TwentyByOneCandidate = {
  found: boolean;
  date: string | null;
  title: string | null;
  repeat_count: number | null;
  work_duration: string | null;
  recovery_duration: string | null;
  quality_family: "short_intervals" | "vo2max_intervals" | null;
  confidence: DiagnosticConfidence;
  notes: string[];
};

export type RecentWorkoutDiagnosticSummary = {
  generated_at: string;
  mode: "read-only";
  no_db_writes: true;
  no_trainingpeaks_mutations: true;
  no_telegram_sends: true;
  athlete: {
    name: string | null;
    athlete_id: number;
    student_id: string;
  };
  window: {
    from: string;
    to: string;
    target_draft_week_start: string | null;
    target_draft_week_end: string | null;
  };
  cache: {
    rows_total: number;
    rows_matching_completed_running: number;
    latest_scanned_at: string | null;
  };
  recent_completed_running_count: number;
  recent_quality_like_count: number;
  last_quality_session_date: string | null;
  last_quality_session_title: string | null;
  last_quality_session_estimated_type: EstimatedQualityType | null;
  last_quality_session_estimated_structure: string | null;
  found_20x1min_candidate: boolean;
  twenty_by_one_candidate: TwentyByOneCandidate;
  quality_progression_hint: string;
  recommended_next_quality_intent_candidates: EstimatedQualityType[];
};

const INTERVAL_PATTERN =
  /(\d{1,2})\s*[xх×*]\s*(\d{1,4}(?:[.,]\d+)?)\s*(мин|min|км|km|сек|sec|м|m)?/i;
const RECOVERY_PATTERN =
  /(?:восстановлен(?:ие|ия)|recovery|rest|отдых)[^\d]{0,20}(\d{1,3}(?:[.,]\d+)?)\s*(сек|sec|мин|min|м|m)?/i;
const RECOVERY_AFTER_INTERVAL_PATTERN =
  /(\d{1,2})\s*[xх×*]\s*(\d{1,4}(?:[.,]\d+)?)\s*(?:мин|min)[^\d]{0,40}(\d{1,3}(?:[.,]\d+)?)\s*(сек|sec|мин|min|м|m)?/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeExcerpt(value: unknown, limit = 160): string | null {
  if (typeof value !== "string") return null;
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  return compact.length <= limit ? compact : `${compact.slice(0, limit)}…`;
}

function collectWorkoutText(row: TrainingPeaksWorkoutCacheRow): string {
  const description =
    isRecord(row.sourceSnapshot) && typeof row.sourceSnapshot.description === "string"
      ? row.sourceSnapshot.description
      : "";
  return `${row.title ?? ""} ${description}`.replace(/\s+/g, " ").trim();
}

function distanceKmFromRaw(raw: number | string | null): number | null {
  const value = toFiniteNumber(raw);
  if (value === null || value <= 0) return null;
  if (value >= 100) return Number((value / 1000).toFixed(2));
  return Number(value.toFixed(2));
}

function resolveWorkoutStatus(
  row: TrainingPeaksWorkoutCacheRow,
): WorkoutDiagnosticRow["status"] {
  if (row.isPlanned && row.isCompleted) return "planned_and_completed";
  if (row.isCompleted) return "completed";
  if (row.isPlanned) return "planned";
  return "other";
}

function formatDurationToken(value: number, unit: string | undefined): string {
  const normalizedUnit = (unit ?? "").toLowerCase();
  if (/сек|sec/.test(normalizedUnit)) return `${value} sec`;
  if (/мин|min/.test(normalizedUnit)) return `${value} min`;
  if (/км|km/.test(normalizedUnit)) return `${value} km`;
  if (/^м$|^m$/.test(normalizedUnit)) return `${value} m`;
  if (value >= 50) return `${value} m`;
  return `${value} min`;
}

export function parseIntervalStructure(text: string): ParsedIntervalStructure | null {
  const match = text.match(INTERVAL_PATTERN);
  if (!match) return null;

  const repeatCount = Number(match[1]);
  const workValue = Number(match[2].replace(",", "."));
  if (!Number.isFinite(repeatCount) || !Number.isFinite(workValue)) return null;

  const rawPattern = intervalPatternFromText(text);
  const workDuration = formatDurationToken(workValue, match[3]);

  let recoveryDuration: string | null = null;
  const recoveryAfterInterval = text.match(RECOVERY_AFTER_INTERVAL_PATTERN);
  if (recoveryAfterInterval) {
    const recoveryValue = Number(recoveryAfterInterval[3].replace(",", "."));
    if (Number.isFinite(recoveryValue)) {
      recoveryDuration = formatDurationToken(recoveryValue, recoveryAfterInterval[4]);
    }
  } else {
    const recoveryMatch = text.match(RECOVERY_PATTERN);
    if (recoveryMatch) {
      const recoveryValue = Number(recoveryMatch[1].replace(",", "."));
      if (Number.isFinite(recoveryValue)) {
        recoveryDuration = formatDurationToken(recoveryValue, recoveryMatch[2]);
      }
    }
  }

  const qualityFamily = inferIntervalQualityFamily(repeatCount, workValue, match[3], text);

  return {
    repeat_count: repeatCount,
    work_duration: workDuration,
    recovery_duration: recoveryDuration,
    quality_family: qualityFamily,
    raw_pattern: rawPattern,
  };
}

function inferIntervalQualityFamily(
  repeatCount: number,
  workValue: number,
  unitRaw: string | undefined,
  text: string,
): ParsedIntervalStructure["quality_family"] {
  const unit = (unitRaw ?? "").toLowerCase();
  const unitExplicit = /км|km/.test(unit)
    ? "km"
    : /сек|sec/.test(unit)
      ? "sec"
      : /мин|min/.test(unit)
        ? "min"
        : null;
  const unitResolved = unitExplicit ?? (workValue >= 50 ? "m" : "min");

  if (/(vo2|vo₂|мпк|mapk)/i.test(text)) return "vo2max_intervals";
  if (unitResolved === "sec" && workValue <= 90) return "vo2max_intervals";
  if (unitResolved === "m" && workValue <= 600 && repeatCount >= 4) return "vo2max_intervals";
  if (unitResolved === "min" && workValue <= 3 && repeatCount >= 4) {
    return repeatCount >= 12 ? "vo2max_intervals" : "short_intervals";
  }
  if (unitResolved === "km" && workValue <= 1 && repeatCount >= 4) return "short_intervals";
  if ((unitResolved === "min" && workValue >= 4) || (unitResolved === "km" && workValue >= 1.5)) {
    return workValue >= 8 ? "threshold_tempo" : "controlled_sub_threshold";
  }
  return null;
}

export function mapTrainingFamilyToQualityType(
  family: TrainingFamily,
  intervalStructure: ParsedIntervalStructure | null,
): EstimatedQualityType {
  if (intervalStructure?.quality_family === "vo2max_intervals") return "vo2max_intervals";
  if (intervalStructure?.quality_family === "short_intervals") return "short_intervals";
  if (intervalStructure?.quality_family === "controlled_sub_threshold") return "controlled_sub_threshold";
  if (intervalStructure?.quality_family === "threshold_tempo") return "threshold_tempo";

  switch (family) {
    case "vo2_short_candidate":
      return "vo2max_intervals";
    case "threshold_subthreshold_intervals":
      return "controlled_sub_threshold";
    case "tempo_continuous":
      return "threshold_tempo";
    case "race_specific":
    case "race_week_sharpening":
    case "pre_race_activation":
      return "race_specific";
    case "long_run":
      return "long_easy";
    case "easy":
    case "easy_with_strides":
      return "easy";
    default:
      return "unknown";
  }
}

function estimateConfidence(input: {
  qualityLike: boolean;
  intervalStructure: ParsedIntervalStructure | null;
  text: string;
  family: TrainingFamily;
}): DiagnosticConfidence {
  if (!input.qualityLike) {
    return input.family === "easy" || input.family === "long_run" ? "medium" : "low";
  }
  if (input.intervalStructure?.raw_pattern) {
    return input.intervalStructure.recovery_duration ? "high" : "medium";
  }
  if (/(tempo|threshold|порог|темпов)/i.test(input.text)) return "medium";
  if (input.family === "other_unknown") return "insufficient";
  return "medium";
}

function buildEstimatedStructure(
  intervalStructure: ParsedIntervalStructure | null,
  classifiedPattern: string | null,
): string | null {
  if (intervalStructure?.repeat_count && intervalStructure.work_duration) {
    const recovery =
      intervalStructure.recovery_duration ?? "recovery unknown";
    return `${intervalStructure.repeat_count} x ${intervalStructure.work_duration} / ${recovery}`;
  }
  return classifiedPattern;
}

export function diagnoseWorkoutRow(row: TrainingPeaksWorkoutCacheRow): WorkoutDiagnosticRow {
  const classified = classifyWorkout(row);
  const text = collectWorkoutText(row);
  const intervalStructure = parseIntervalStructure(text);
  const estimatedQualityType = mapTrainingFamilyToQualityType(classified.family, intervalStructure);
  const notesExcerpt = sanitizeExcerpt(
    isRecord(row.sourceSnapshot) ? row.sourceSnapshot.description : null,
  );
  const flags: string[] = [];
  if (classified.quality) flags.push("quality_like");
  if (intervalStructure?.raw_pattern) flags.push("interval_pattern_detected");
  if (intervalStructure?.recovery_duration === null && intervalStructure?.repeat_count) {
    flags.push("recovery_unknown");
  }
  if (row.normalizationWarnings.length > 0) flags.push("normalization_warnings_present");

  return {
    date: row.workoutDate,
    title: row.title?.trim() || "Untitled",
    duration_minutes: classified.durationMinutes,
    distance_km:
      distanceKmFromRaw(row.completedDistanceRaw) ?? distanceKmFromRaw(row.plannedDistanceRaw),
    status: resolveWorkoutStatus(row),
    workout_type: row.sportOrTypeCode,
    is_planned: row.isPlanned,
    is_completed: row.isCompleted,
    source_flags: {
      paired_planned_and_completed: row.isPlanned && row.isCompleted,
      completed_only: row.isCompleted && !row.isPlanned,
      planned_only: row.isPlanned && !row.isCompleted,
    },
    notes_excerpt: notesExcerpt,
    estimated_quality_type: estimatedQualityType,
    estimated_structure: buildEstimatedStructure(intervalStructure, classified.intervalPattern),
    confidence: estimateConfidence({
      qualityLike: classified.quality,
      intervalStructure,
      text,
      family: classified.family,
    }),
    flags,
    training_family: classified.family,
    quality_like: classified.quality,
    interval_structure: intervalStructure,
    trainingpeaks_workout_id: row.trainingPeaksWorkoutId,
  };
}

export function isCompletedRunningWorkout(row: TrainingPeaksWorkoutCacheRow): boolean {
  if (!row.isCompleted) return false;
  return classifyWorkout(row).isRunning;
}

export function detectTwentyByOneCandidate(
  workouts: WorkoutDiagnosticRow[],
): TwentyByOneCandidate {
  const candidates = workouts
    .filter((workout) => {
      const structure = workout.interval_structure;
      if (!structure?.repeat_count || !structure.work_duration) return false;
      if (structure.repeat_count !== 20) return false;
      return /^1\s*min$/i.test(structure.work_duration.trim());
    })
    .sort((left, right) => right.date.localeCompare(left.date));

  if (candidates.length === 0) {
    return {
      found: false,
      date: null,
      title: null,
      repeat_count: null,
      work_duration: null,
      recovery_duration: null,
      quality_family: null,
      confidence: "insufficient",
      notes: ["No completed running workout matched repeat_count=20 and work_duration=1 min."],
    };
  }

  const latest = candidates[0]!;
  const qualityFamily =
    latest.estimated_quality_type === "vo2max_intervals"
      ? "vo2max_intervals"
      : "short_intervals";

  return {
    found: true,
    date: latest.date,
    title: latest.title,
    repeat_count: latest.interval_structure?.repeat_count ?? 20,
    work_duration: latest.interval_structure?.work_duration ?? "1 min",
    recovery_duration: latest.interval_structure?.recovery_duration,
    quality_family: qualityFamily,
    confidence: latest.confidence,
    notes: latest.interval_structure?.recovery_duration
      ? ["Matched title/notes interval pattern 20 x 1 min with parsed recovery."]
      : ["Matched title/notes interval pattern 20 x 1 min; recovery duration not visible in safe excerpt."],
  };
}

export function buildQualityProgressionHint(input: {
  lastQuality: WorkoutDiagnosticRow | null;
  twentyByOne: TwentyByOneCandidate;
  qualityLikeCount: number;
}): string {
  if (input.twentyByOne.found && input.twentyByOne.date) {
    const recoveryNote = input.twentyByOne.recovery_duration
      ? ` Recovery parsed as ${input.twentyByOne.recovery_duration}.`
      : " Recovery duration was not visible in cached title/notes.";
    return `Most recent explicit short-interval signal is 20 x 1 min on ${input.twentyByOne.date}.${recoveryNote} A generic 3 x 6 min threshold block would ignore this recent VO2/short-interval stimulus unless coach intentionally changes progression.`;
  }
  if (input.lastQuality) {
    return `Last quality-like session on ${input.lastQuality.date} was "${input.lastQuality.title}" (${input.lastQuality.estimated_quality_type}, ${input.lastQuality.estimated_structure ?? "structure unknown"}).`;
  }
  if (input.qualityLikeCount === 0) {
    return "No quality-like completed running sessions were found in the diagnostic window.";
  }
  return "Quality-like sessions exist, but no strong short-interval 20 x 1 min candidate was detected.";
}

export function recommendNextQualityIntentCandidates(input: {
  lastQuality: WorkoutDiagnosticRow | null;
  twentyByOne: TwentyByOneCandidate;
}): EstimatedQualityType[] {
  if (input.twentyByOne.found) {
    return ["controlled_sub_threshold", "threshold_tempo", "short_intervals"];
  }
  if (input.lastQuality?.estimated_quality_type === "threshold_tempo") {
    return ["controlled_sub_threshold", "short_intervals", "vo2max_intervals"];
  }
  if (input.lastQuality?.estimated_quality_type === "controlled_sub_threshold") {
    return ["short_intervals", "vo2max_intervals", "threshold_tempo"];
  }
  if (input.lastQuality?.estimated_quality_type === "vo2max_intervals") {
    return ["controlled_sub_threshold", "threshold_tempo", "short_intervals"];
  }
  if (input.lastQuality?.estimated_quality_type === "short_intervals") {
    return ["controlled_sub_threshold", "threshold_tempo", "vo2max_intervals"];
  }
  return ["controlled_sub_threshold", "threshold_tempo", "short_intervals"];
}

export function buildRecentWorkoutDiagnosticSummary(input: {
  athleteId: number;
  studentId: string;
  studentName: string | null;
  from: string;
  to: string;
  targetDraftWeekStart: string | null;
  rowsTotal: number;
  latestScannedAt: string | null;
  workouts: WorkoutDiagnosticRow[];
}): RecentWorkoutDiagnosticSummary {
  const qualityWorkouts = input.workouts.filter((workout) => workout.quality_like);
  const lastQuality = qualityWorkouts.length > 0 ? qualityWorkouts[qualityWorkouts.length - 1]! : null;
  const twentyByOne = detectTwentyByOneCandidate(input.workouts);

  const targetDraftWeekEnd =
    input.targetDraftWeekStart === null
      ? null
      : addDaysIso(input.targetDraftWeekStart, 6);

  return {
    generated_at: new Date().toISOString(),
    mode: "read-only",
    no_db_writes: true,
    no_trainingpeaks_mutations: true,
    no_telegram_sends: true,
    athlete: {
      name: input.studentName,
      athlete_id: input.athleteId,
      student_id: input.studentId,
    },
    window: {
      from: input.from,
      to: input.to,
      target_draft_week_start: input.targetDraftWeekStart,
      target_draft_week_end: targetDraftWeekEnd,
    },
    cache: {
      rows_total: input.rowsTotal,
      rows_matching_completed_running: input.workouts.length,
      latest_scanned_at: input.latestScannedAt,
    },
    recent_completed_running_count: input.workouts.length,
    recent_quality_like_count: qualityWorkouts.length,
    last_quality_session_date: lastQuality?.date ?? null,
    last_quality_session_title: lastQuality?.title ?? null,
    last_quality_session_estimated_type: lastQuality?.estimated_quality_type ?? null,
    last_quality_session_estimated_structure: lastQuality?.estimated_structure ?? null,
    found_20x1min_candidate: twentyByOne.found,
    twenty_by_one_candidate: twentyByOne,
    quality_progression_hint: buildQualityProgressionHint({
      lastQuality,
      twentyByOne,
      qualityLikeCount: qualityWorkouts.length,
    }),
    recommended_next_quality_intent_candidates: recommendNextQualityIntentCandidates({
      lastQuality,
      twentyByOne,
    }),
  };
}

export function addDaysIso(dateIso: string, days: number): string {
  const date = new Date(`${dateIso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function defaultHistoryWindowBeforeWeekStart(weekStart: string): { from: string; to: string } {
  return {
    from: addDaysIso(weekStart, -27),
    to: weekStart,
  };
}
