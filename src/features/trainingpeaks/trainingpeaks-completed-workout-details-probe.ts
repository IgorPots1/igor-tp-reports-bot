import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  listTrainingPeaksStudents,
  listTrainingPeaksWorkoutCacheForDateRange,
  listTrainingPeaksWorkoutCacheForStudentDateRange,
  type TrainingPeaksStudent,
  type TrainingPeaksWorkoutCacheRow,
} from "@/features/trainingpeaks/repository";
import { classifyTrainingPeaksWorkoutActivity } from "@/features/trainingpeaks/workout-activity-classification";
import {
  extractTrainingPeaksCompletedWorkoutDetails,
  mergeExtractedMetrics,
  redactSensitiveForReport,
  type TrainingPeaksCompletedWorkoutDetailsAvailability,
  type TrainingPeaksCompletedWorkoutDetailsMetrics,
} from "@/features/trainingpeaks/trainingpeaks-completed-workout-details-extractor";

type ProbeSourceMode = "cache_only" | "tp_get_endpoint" | "tp_page_probe" | "unknown";

type EndpointAttempt = {
  method: "GET";
  label: string;
  urlTemplate: string;
  status?: number;
  ok: boolean;
  skippedReason?: string;
  shapeSummary: string[];
  error?: string;
  dataAvailability?: {
    hasDuration: boolean;
    hasDistance: boolean;
    hasAveragePace: boolean;
    hasAverageHeartRate: boolean;
    hasLaps: boolean;
    hasSplits: boolean;
    hasIntervalActuals: boolean;
    hasSamples: boolean;
    hasPlannedStructure: boolean;
    hasTargetPaceOrHr: boolean;
    hasCoachComments: boolean;
  };
  extractedMetricsPreview?: {
    durationSeconds?: number;
    distanceMeters?: number;
    averagePaceSecPerKm?: number;
    averageHeartRateBpm?: number;
    lapCount?: number;
    splitCount?: number;
    intervalCount?: number;
    sampleCount?: number;
  };
};

export type TrainingPeaksCompletedWorkoutDetailsProbe = {
  target: {
    studentId?: string;
    athleteId?: string;
    date: string;
    cacheWorkoutId?: string;
    trainingPeaksWorkoutId?: string;
  };
  source: {
    mode: ProbeSourceMode;
    endpointsTried: EndpointAttempt[];
  };
  dataAvailability: TrainingPeaksCompletedWorkoutDetailsAvailability;
  extractedMetrics: TrainingPeaksCompletedWorkoutDetailsMetrics;
  warnings: string[];
  recommendation: string;
};

export type ProbeCliInput = {
  studentId?: string;
  athleteId?: string;
  date: string;
  workoutId?: string;
  discoverPerWorkoutEndpoints?: boolean;
  help?: boolean;
};

type ProbeRunResult = {
  reportDir: string;
  probe: TrainingPeaksCompletedWorkoutDetailsProbe;
  candidateCacheWorkouts: Array<Record<string, unknown>>;
  endpointShapes: Array<Record<string, unknown>>;
  outputFiles: {
    summaryPath: string;
    detailsPath: string;
    endpointShapesPath: string;
    candidatesPath: string;
  };
};

type TargetResolution = {
  studentId: string;
  athleteId: number;
  trainingPeaksAthleteUrl: string;
  resolvedBy: "student_id" | "athlete_id";
};

type OptionalGetEndpointResult = {
  label: string;
  urlTemplate: string;
  endpoint: string;
  status: number;
  ok: boolean;
  payload: unknown;
  shapeSummary: string[];
};

type PerWorkoutEndpointDiscoveryRecommendation =
  | "date_range_endpoint_only"
  | "date_range_plus_per_workout_endpoint"
  | "per_workout_endpoint_only"
  | "needs_more_discovery"
  | "cache_only_fallback";

type TrainingPeaksPerWorkoutEndpointDiscoveryResult = {
  target: {
    athleteId: string;
    date: string;
    workoutId: string;
    studentId?: string;
  };
  endpointResults: EndpointAttempt[];
  bestEndpointRecommendation: PerWorkoutEndpointDiscoveryRecommendation;
  warnings: string[];
};

const REPORT_ROOT = "reports/trainingpeaks-completed-workout-details-probe";
const PER_WORKOUT_REPORT_ROOT = "reports/trainingpeaks-per-workout-endpoint-discovery";
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ATHLETE_URL_PATTERN = /\/athletes\/(\d+)(?:\D|$)/i;

function timestampForPath(date = new Date()): string {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function parseAthleteIdFromUrl(url: string): number | null {
  const match = url.match(ATHLETE_URL_PATTERN);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function parseProbeCliArgs(argv: string[]): ProbeCliInput {
  const parsed: ProbeCliInput = {
    date: "",
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg.startsWith("--student-id=")) {
      parsed.studentId = arg.slice("--student-id=".length).trim();
      continue;
    }
    if (arg.startsWith("--athlete-id=")) {
      parsed.athleteId = arg.slice("--athlete-id=".length).trim();
      continue;
    }
    if (arg.startsWith("--date=")) {
      parsed.date = arg.slice("--date=".length).trim();
      continue;
    }
    if (arg.startsWith("--workout-id=")) {
      parsed.workoutId = arg.slice("--workout-id=".length).trim();
      continue;
    }
    if (arg === "--discover-per-workout-endpoints") {
      parsed.discoverPerWorkoutEndpoints = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (parsed.help) {
    return parsed;
  }

  const hasStudent = Boolean(parsed.studentId);
  const hasAthlete = Boolean(parsed.athleteId);
  if ((hasStudent ? 1 : 0) + (hasAthlete ? 1 : 0) !== 1) {
    throw new Error("Provide exactly one target path: --student-id or --athlete-id.");
  }
  if (!ISO_DATE_PATTERN.test(parsed.date)) {
    throw new Error(`Invalid --date value "${parsed.date}". Expected YYYY-MM-DD.`);
  }
  if (parsed.athleteId && (!/^\d+$/u.test(parsed.athleteId) || Number(parsed.athleteId) <= 0)) {
    throw new Error(`Invalid --athlete-id value "${parsed.athleteId}".`);
  }
  if (parsed.workoutId && !/^\d+$/u.test(parsed.workoutId)) {
    throw new Error(`Invalid --workout-id value "${parsed.workoutId}".`);
  }

  return parsed;
}

async function resolveTarget(input: ProbeCliInput): Promise<TargetResolution> {
  if (input.studentId) {
    const students = await listTrainingPeaksStudents();
    const student = students.find((entry) => entry.id === input.studentId);
    if (!student) {
      throw new Error(`No active student found for --student-id ${input.studentId}.`);
    }
    const athleteId = parseAthleteIdFromUrl(student.trainingPeaksAthleteUrl);
    if (!athleteId) {
      throw new Error(`Student ${student.id} has no parseable athlete id in trainingPeaksAthleteUrl.`);
    }
    return {
      studentId: student.id,
      athleteId,
      trainingPeaksAthleteUrl: student.trainingPeaksAthleteUrl,
      resolvedBy: "student_id",
    };
  }

  const requestedAthleteId = Number(input.athleteId);
  const students = await listTrainingPeaksStudents();
  const matches = students.filter((entry) => parseAthleteIdFromUrl(entry.trainingPeaksAthleteUrl) === requestedAthleteId);
  if (matches.length === 0) {
    throw new Error(`No active student found for --athlete-id ${requestedAthleteId}.`);
  }
  if (matches.length > 1) {
    throw new Error(`Ambiguous --athlete-id ${requestedAthleteId}: multiple active students matched.`);
  }
  const student = matches[0] as TrainingPeaksStudent;
  return {
    studentId: student.id,
    athleteId: requestedAthleteId,
    trainingPeaksAthleteUrl: student.trainingPeaksAthleteUrl,
    resolvedBy: "athlete_id",
  };
}

function summarizeCandidate(row: TrainingPeaksWorkoutCacheRow): Record<string, unknown> {
  return {
    id: row.id,
    trainingPeaksWorkoutId: row.trainingPeaksWorkoutId,
    workoutDate: row.workoutDate,
    title: row.title,
    isCompleted: row.isCompleted,
    isPlanned: row.isPlanned,
    completedTimeRaw: row.completedTimeRaw,
    completedDistanceRaw: row.completedDistanceRaw,
    sportOrTypeCode: row.sportOrTypeCode,
    workoutTypeValueId: row.workoutTypeValueId,
    workoutSubTypeId: row.workoutSubTypeId,
  };
}

function collectCandidates(input: {
  rows: TrainingPeaksWorkoutCacheRow[];
  date: string;
}): TrainingPeaksWorkoutCacheRow[] {
  return input.rows
    .filter((row) => row.workoutDate === input.date && row.isCompleted)
    .filter((row) =>
      classifyTrainingPeaksWorkoutActivity({
        title: row.title,
        sportOrTypeCode: row.sportOrTypeCode,
        workoutTypeValueId: row.workoutTypeValueId,
        workoutSubTypeId: row.workoutSubTypeId,
        sourceSnapshot: row.sourceSnapshot,
      }).isRunning
    )
    .sort((a, b) => Number(a.orderOnDay ?? 0) - Number(b.orderOnDay ?? 0));
}

export function enforceGetOnlyMethod(method: string): "GET" {
  if (method.toUpperCase() !== "GET") {
    throw new Error(`Probe method guard rejected non-GET method: ${method}`);
  }
  return "GET";
}

async function maybeFetchLiveWorkoutDetailsGet(input: {
  athleteId: number;
  from: string;
  to: string;
  token: string;
}): Promise<OptionalGetEndpointResult | null> {
  enforceGetOnlyMethod("GET");
  const endpoint = `https://tpapi.trainingpeaks.com/fitness/v6/athletes/${input.athleteId}/workouts/${input.from}/${input.to}`;
  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${input.token}`,
      "x-requested-with": "XMLHttpRequest",
    },
  });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const shapeSummary = (() => {
    if (Array.isArray(payload)) {
      const first = payload[0];
      if (first && typeof first === "object" && !Array.isArray(first)) {
        return Object.keys(first as Record<string, unknown>).slice(0, 25);
      }
      return ["array"];
    }
    if (payload && typeof payload === "object") {
      return Object.keys(payload as Record<string, unknown>).slice(0, 25);
    }
    return [typeof payload];
  })();
  return {
    label: "date_range",
    urlTemplate: "/fitness/v6/athletes/{athleteId}/workouts/{from}/{to}",
    endpoint,
    status: response.status,
    ok: response.ok,
    payload,
    shapeSummary,
  };
}

async function runGetEndpointAttempt(input: {
  label: string;
  urlTemplate: string;
  endpoint: string;
  token: string;
}): Promise<OptionalGetEndpointResult> {
  enforceGetOnlyMethod("GET");
  const response = await fetch(input.endpoint, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${input.token}`,
      "x-requested-with": "XMLHttpRequest",
    },
  });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const shapeSummary = (() => {
    if (Array.isArray(payload)) {
      const first = payload[0];
      if (first && typeof first === "object" && !Array.isArray(first)) {
        return Object.keys(first as Record<string, unknown>).slice(0, 25);
      }
      return ["array"];
    }
    if (payload && typeof payload === "object") {
      return Object.keys(payload as Record<string, unknown>).slice(0, 25);
    }
    return [typeof payload];
  })();
  return {
    label: input.label,
    urlTemplate: input.urlTemplate,
    endpoint: input.endpoint,
    status: response.status,
    ok: response.ok,
    payload,
    shapeSummary,
  };
}

function toEndpointAttempt(result: OptionalGetEndpointResult): EndpointAttempt {
  const extracted = extractTrainingPeaksCompletedWorkoutDetails(result.payload);
  return {
    method: "GET",
    label: result.label,
    urlTemplate: result.urlTemplate,
    status: result.status,
    ok: result.ok,
    shapeSummary: result.shapeSummary,
    error: result.ok ? undefined : "Non-OK status from TP endpoint.",
    dataAvailability: {
      hasDuration: extracted.dataAvailability.hasCompletedDuration,
      hasDistance: extracted.dataAvailability.hasCompletedDistance,
      hasAveragePace: extracted.dataAvailability.hasAveragePace,
      hasAverageHeartRate: extracted.dataAvailability.hasAverageHeartRate,
      hasLaps: extracted.dataAvailability.hasLaps,
      hasSplits: extracted.dataAvailability.hasSplits,
      hasIntervalActuals: extracted.dataAvailability.hasIntervalActuals,
      hasSamples: extracted.dataAvailability.hasSamples,
      hasPlannedStructure: extracted.dataAvailability.hasPlannedStructure,
      hasTargetPaceOrHr: extracted.dataAvailability.hasTargetPaceOrHr,
      hasCoachComments: extracted.dataAvailability.hasCoachComments,
    },
    extractedMetricsPreview: {
      durationSeconds: extracted.extractedMetrics.durationSeconds,
      distanceMeters: extracted.extractedMetrics.distanceMeters,
      averagePaceSecPerKm: extracted.extractedMetrics.averagePaceSecPerKm,
      averageHeartRateBpm: extracted.extractedMetrics.averageHeartRateBpm,
      lapCount: extracted.extractedMetrics.lapCount,
      splitCount: extracted.extractedMetrics.splitCount,
      intervalCount: extracted.extractedMetrics.intervalCount,
      sampleCount: extracted.extractedMetrics.sampleCount,
    },
  };
}

function buildBestEndpointRecommendation(input: {
  hasToken: boolean;
  endpointResults: EndpointAttempt[];
}): PerWorkoutEndpointDiscoveryRecommendation {
  if (!input.hasToken) {
    return "cache_only_fallback";
  }
  const okResults = input.endpointResults.filter((entry) => entry.ok);
  if (okResults.length === 0) {
    return "needs_more_discovery";
  }
  const dateRange = okResults.find((entry) => entry.label === "date_range");
  const perWorkout = okResults.find((entry) => entry.label !== "date_range");
  const perWorkoutHasExtraActuals = Boolean(
    perWorkout?.dataAvailability &&
      (perWorkout.dataAvailability.hasLaps ||
        perWorkout.dataAvailability.hasSplits ||
        perWorkout.dataAvailability.hasIntervalActuals ||
        perWorkout.dataAvailability.hasSamples)
  );
  const dateRangeHasCore = Boolean(
    dateRange?.dataAvailability &&
      dateRange.dataAvailability.hasDuration &&
      dateRange.dataAvailability.hasDistance &&
      dateRange.dataAvailability.hasAverageHeartRate
  );
  if (dateRangeHasCore && perWorkoutHasExtraActuals) {
    return "date_range_plus_per_workout_endpoint";
  }
  if (dateRangeHasCore && !perWorkoutHasExtraActuals) {
    return "date_range_endpoint_only";
  }
  if (!dateRange && perWorkout) {
    return "per_workout_endpoint_only";
  }
  return "needs_more_discovery";
}

async function discoverPerWorkoutEndpoints(input: {
  athleteId: number;
  date: string;
  workoutId: string;
  token: string;
}): Promise<{
  endpointResults: EndpointAttempt[];
  endpointShapes: Array<Record<string, unknown>>;
}> {
  const candidates = buildPerWorkoutDiscoveryCandidates(input);
  const endpointResults: EndpointAttempt[] = [];
  const endpointShapes: Array<Record<string, unknown>> = [];
  for (const candidate of candidates) {
    const result = await runGetEndpointAttempt({
      label: candidate.label,
      urlTemplate: candidate.urlTemplate,
      endpoint: candidate.endpoint,
      token: input.token,
    });
    const attempt = toEndpointAttempt(result);
    endpointResults.push(attempt);
    endpointShapes.push({
      label: result.label,
      urlTemplate: result.urlTemplate,
      endpoint: result.endpoint,
      method: "GET",
      status: result.status,
      ok: result.ok,
      shapeSummary: result.shapeSummary,
      payloadSample: redactSensitiveForReport(result.payload),
    });
  }
  return {
    endpointResults,
    endpointShapes,
  };
}

function buildPerWorkoutDiscoveryCandidates(input: {
  athleteId: number;
  date: string;
  workoutId: string;
}): Array<{ label: string; urlTemplate: string; endpoint: string }> {
  return [
    {
      label: "date_range",
      urlTemplate: "/fitness/v6/athletes/{athleteId}/workouts/{from}/{to}",
      endpoint: `https://tpapi.trainingpeaks.com/fitness/v6/athletes/${input.athleteId}/workouts/${input.date}/${input.date}`,
    },
    {
      label: "athlete_workout_by_id",
      urlTemplate: "/fitness/v6/athletes/{athleteId}/workouts/{workoutId}",
      endpoint: `https://tpapi.trainingpeaks.com/fitness/v6/athletes/${input.athleteId}/workouts/${input.workoutId}`,
    },
    {
      label: "athlete_workout_details",
      urlTemplate: "/fitness/v6/athletes/{athleteId}/workouts/{workoutId}/details",
      endpoint: `https://tpapi.trainingpeaks.com/fitness/v6/athletes/${input.athleteId}/workouts/${input.workoutId}/details`,
    },
    {
      label: "athlete_workout_laps",
      urlTemplate: "/fitness/v6/athletes/{athleteId}/workouts/{workoutId}/laps",
      endpoint: `https://tpapi.trainingpeaks.com/fitness/v6/athletes/${input.athleteId}/workouts/${input.workoutId}/laps`,
    },
    {
      label: "athlete_workout_samples",
      urlTemplate: "/fitness/v6/athletes/{athleteId}/workouts/{workoutId}/samples",
      endpoint: `https://tpapi.trainingpeaks.com/fitness/v6/athletes/${input.athleteId}/workouts/${input.workoutId}/samples`,
    },
    {
      label: "athlete_workout_events",
      urlTemplate: "/fitness/v6/athletes/{athleteId}/workouts/{workoutId}/events",
      endpoint: `https://tpapi.trainingpeaks.com/fitness/v6/athletes/${input.athleteId}/workouts/${input.workoutId}/events`,
    },
  ];
}

function buildRecommendation(input: {
  availability: TrainingPeaksCompletedWorkoutDetailsAvailability;
  liveEndpointUsed: boolean;
  ambiguousCandidates: boolean;
  bestEndpointRecommendation?: PerWorkoutEndpointDiscoveryRecommendation;
}): string {
  const parts: string[] = [];
  if (!input.liveEndpointUsed) {
    parts.push("Live GET endpoint was not used in this run; validate with TP auth before production reader wiring.");
  }
  if (input.ambiguousCandidates) {
    parts.push("Require --workout-id for ambiguous same-day completed workouts.");
  }
  if (!input.availability.hasAveragePace || !input.availability.hasAverageHeartRate) {
    parts.push("Keep pace/HR claims disabled unless TP details endpoint consistently exposes these fields.");
  }
  if (!input.availability.hasLaps && !input.availability.hasIntervalActuals) {
    parts.push("Keep interval-quality claims disabled until laps/interval actuals are confirmed.");
  }
  if (input.bestEndpointRecommendation) {
    parts.push(`Endpoint strategy: ${input.bestEndpointRecommendation}.`);
  }
  if (parts.length === 0) {
    return "Data availability is sufficient to start a guarded reader integration behind existing intake safety gates.";
  }
  return parts.join(" ");
}

function formatSummaryMarkdown(input: {
  probe: TrainingPeaksCompletedWorkoutDetailsProbe;
  targetResolution: TargetResolution;
  candidateRows: TrainingPeaksWorkoutCacheRow[];
  selected: TrainingPeaksWorkoutCacheRow | null;
  outputFiles: ProbeRunResult["outputFiles"];
}): string {
  const { probe } = input;
  const lines: string[] = [];
  const perWorkoutDiscovery = input.outputFiles.detailsPath.endsWith("endpoint-discovery.json");
  lines.push(
    perWorkoutDiscovery
      ? "# TrainingPeaks Per-Workout Endpoint Discovery"
      : "# TrainingPeaks Completed Workout Details Probe"
  );
  lines.push("");
  lines.push("## Target");
  lines.push(`- student_id: ${input.targetResolution.studentId}`);
  lines.push(`- athlete_id: ${input.targetResolution.athleteId}`);
  lines.push(`- date: ${probe.target.date}`);
  lines.push(`- selected_trainingpeaks_workout_id: ${probe.target.trainingPeaksWorkoutId ?? "none"}`);
  lines.push(`- selected_cache_workout_id: ${probe.target.cacheWorkoutId ?? "none"}`);
  lines.push("");
  lines.push("## Candidate workouts from cache");
  if (input.candidateRows.length === 0) {
    lines.push("- none");
  } else {
    for (const row of input.candidateRows) {
      lines.push(`- ${row.trainingPeaksWorkoutId} | ${row.title ?? "(no title)"} | completed=${row.isCompleted}`);
    }
  }
  lines.push("");
  lines.push("## Endpoints tried");
  if (probe.source.endpointsTried.length === 0) {
    lines.push("- none (cache-only)");
  } else {
    for (const endpoint of probe.source.endpointsTried) {
      lines.push(
        `- ${endpoint.label}: template=${endpoint.urlTemplate} method=${endpoint.method} ok=${endpoint.ok} status=${endpoint.status ?? "n/a"} shape=${endpoint.shapeSummary.join(", ")}`
      );
    }
  }
  lines.push("");
  lines.push("## Data availability by endpoint");
  if (probe.source.endpointsTried.length === 0) {
    lines.push("- none");
  } else {
    for (const endpoint of probe.source.endpointsTried) {
      if (!endpoint.dataAvailability) {
        lines.push(`- ${endpoint.label}: unavailable (${endpoint.skippedReason ?? "no_data"})`);
        continue;
      }
      lines.push(
        `- ${endpoint.label}: duration=${endpoint.dataAvailability.hasDuration} distance=${endpoint.dataAvailability.hasDistance} avg_pace=${endpoint.dataAvailability.hasAveragePace} avg_hr=${endpoint.dataAvailability.hasAverageHeartRate} laps=${endpoint.dataAvailability.hasLaps} splits=${endpoint.dataAvailability.hasSplits} interval_actuals=${endpoint.dataAvailability.hasIntervalActuals} samples=${endpoint.dataAvailability.hasSamples}`
      );
    }
  }
  lines.push("");
  lines.push("## Data availability");
  lines.push(`- duration: ${probe.dataAvailability.hasCompletedDuration ? "yes" : "no"}`);
  lines.push(`- distance: ${probe.dataAvailability.hasCompletedDistance ? "yes" : "no"}`);
  lines.push(`- avg pace: ${probe.dataAvailability.hasAveragePace ? "yes" : "no"}`);
  lines.push(`- avg HR: ${probe.dataAvailability.hasAverageHeartRate ? "yes" : "no"}`);
  lines.push(`- max HR: ${probe.dataAvailability.hasMaxHeartRate ? "yes" : "no"}`);
  lines.push(`- laps: ${probe.dataAvailability.hasLaps ? "yes" : "no"}`);
  lines.push(`- splits: ${probe.dataAvailability.hasSplits ? "yes" : "no"}`);
  lines.push(`- interval actuals: ${probe.dataAvailability.hasIntervalActuals ? "yes" : "no"}`);
  lines.push(`- samples: ${probe.dataAvailability.hasSamples ? "yes" : "no"}`);
  lines.push(`- planned structure: ${probe.dataAvailability.hasPlannedStructure ? "yes" : "no"}`);
  lines.push(`- target pace/HR: ${probe.dataAvailability.hasTargetPaceOrHr ? "yes" : "no"}`);
  lines.push(`- coach comments: ${probe.dataAvailability.hasCoachComments ? "yes" : "no"}`);
  lines.push("");
  lines.push("## Extracted sample");
  lines.push(`- durationSeconds: ${probe.extractedMetrics.durationSeconds ?? "n/a"}`);
  lines.push(`- distanceMeters: ${probe.extractedMetrics.distanceMeters ?? "n/a"}`);
  lines.push(`- averagePaceSecPerKm: ${probe.extractedMetrics.averagePaceSecPerKm ?? "n/a"}`);
  lines.push(`- averageHeartRateBpm: ${probe.extractedMetrics.averageHeartRateBpm ?? "n/a"}`);
  lines.push(`- maxHeartRateBpm: ${probe.extractedMetrics.maxHeartRateBpm ?? "n/a"}`);
  lines.push(`- lapCount: ${probe.extractedMetrics.lapCount ?? "n/a"}`);
  lines.push(`- splitCount: ${probe.extractedMetrics.splitCount ?? "n/a"}`);
  lines.push(`- intervalCount: ${probe.extractedMetrics.intervalCount ?? "n/a"}`);
  lines.push(`- sampleCount: ${probe.extractedMetrics.sampleCount ?? "n/a"}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("- GET-only: yes");
  lines.push("- TP mutations: no");
  lines.push("- Telegram sends: no");
  lines.push("- DB writes: no");
  lines.push("");
  lines.push("## Report files");
  lines.push(
    `- ${perWorkoutDiscovery ? "endpoint-discovery.json" : "details-probe.json"}: ${input.outputFiles.detailsPath}`
  );
  lines.push(`- endpoint-shapes.json: ${input.outputFiles.endpointShapesPath}`);
  lines.push(
    `- ${perWorkoutDiscovery ? "sanitized-samples.json" : "candidate-cache-workouts.json"}: ${input.outputFiles.candidatesPath}`
  );
  lines.push("");
  lines.push("## Best endpoint recommendation");
  const recommendationMatch = probe.recommendation.match(/Endpoint strategy: ([a-z_]+)\./);
  if (recommendationMatch) {
    lines.push(`- ${recommendationMatch[1]}`);
  } else {
    lines.push("- needs_more_discovery");
  }
  lines.push("");
  lines.push("## Can future reply drafts claim laps/intervals?");
  lines.push(
    probe.dataAvailability.hasLaps || probe.dataAvailability.hasIntervalActuals
      ? "- yes, when endpoint response contains actual lap/interval fields in the extracted payload."
      : "- no, not until a GET endpoint returns lap/split/interval actuals."
  );
  lines.push("");
  lines.push("## Recommendation");
  lines.push(`- ${probe.recommendation}`);
  if (input.selected === null) {
    lines.push("- No completed workout candidate selected from cache.");
  }
  return `${lines.join("\n")}\n`;
}

export async function runTrainingPeaksCompletedWorkoutDetailsProbe(
  cliInput: ProbeCliInput
): Promise<ProbeRunResult> {
  const target = await resolveTarget(cliInput);
  const rows = await listTrainingPeaksWorkoutCacheForStudentDateRange({
    studentId: target.studentId,
    from: cliInput.date,
    to: cliInput.date,
  });
  const candidates = collectCandidates({ rows, date: cliInput.date });

  let selected: TrainingPeaksWorkoutCacheRow | null = null;
  const warnings: string[] = [];
  if (cliInput.workoutId) {
    selected = candidates.find((row) => String(row.trainingPeaksWorkoutId) === cliInput.workoutId) ?? null;
    if (!selected) {
      warnings.push(`--workout-id ${cliInput.workoutId} was not found in same-day completed run candidates.`);
    }
  } else if (candidates.length === 1) {
    selected = candidates[0] ?? null;
  } else if (candidates.length > 1) {
    warnings.push("Multiple completed run candidates found; pass --workout-id to select explicitly.");
  } else {
    warnings.push("No completed run candidates found in trainingpeaks_workout_cache for target date.");
  }

  const cacheExtraction = extractTrainingPeaksCompletedWorkoutDetails(selected?.sourceSnapshot ?? {});
  const endpointAttempts: EndpointAttempt[] = [];
  const endpointShapes: Array<Record<string, unknown>> = [];
  let mode: ProbeSourceMode = "cache_only";
  let mergedExtraction = cacheExtraction;
  const token = process.env.TRAININGPEAKS_API_BEARER?.trim();
  let liveGet: OptionalGetEndpointResult | null = null;
  let bestEndpointRecommendation: PerWorkoutEndpointDiscoveryRecommendation | undefined;
  if (token) {
    liveGet = await maybeFetchLiveWorkoutDetailsGet({
      athleteId: target.athleteId,
      from: cliInput.date,
      to: cliInput.date,
      token,
    });
    if (liveGet) {
      mode = "tp_get_endpoint";
      endpointAttempts.push(toEndpointAttempt(liveGet));
      endpointShapes.push({
        label: liveGet.label,
        urlTemplate: liveGet.urlTemplate,
        endpoint: liveGet.endpoint,
        method: "GET",
        status: liveGet.status,
        ok: liveGet.ok,
        shapeSummary: liveGet.shapeSummary,
        payloadSample: redactSensitiveForReport(liveGet.payload),
      });
      const liveExtraction = extractTrainingPeaksCompletedWorkoutDetails(liveGet.payload);
      mergedExtraction = mergeExtractedMetrics(liveExtraction, cacheExtraction);
    }
  } else {
    warnings.push("TRAININGPEAKS_API_BEARER is missing; live endpoint discovery skipped.");
    endpointAttempts.push({
      method: "GET",
      label: "date_range",
      urlTemplate: "/fitness/v6/athletes/{athleteId}/workouts/{from}/{to}",
      ok: false,
      skippedReason: "missing_bearer",
      shapeSummary: [],
    });
  }

  if (cliInput.discoverPerWorkoutEndpoints) {
    if (!cliInput.workoutId) {
      warnings.push("--discover-per-workout-endpoints requested without --workout-id; discovery skipped.");
    } else if (!token) {
      warnings.push("Per-workout endpoint discovery requested but TRAININGPEAKS_API_BEARER is missing.");
      endpointAttempts.length = 0;
      for (const candidate of buildPerWorkoutDiscoveryCandidates({
        athleteId: target.athleteId,
        date: cliInput.date,
        workoutId: cliInput.workoutId,
      })) {
        endpointAttempts.push({
          method: "GET",
          label: candidate.label,
          urlTemplate: candidate.urlTemplate,
          ok: false,
          skippedReason: "missing_bearer",
          shapeSummary: [],
        });
      }
    } else {
      mode = "tp_get_endpoint";
      const discovery = await discoverPerWorkoutEndpoints({
        athleteId: target.athleteId,
        date: cliInput.date,
        workoutId: cliInput.workoutId,
        token,
      });
      endpointAttempts.length = 0;
      endpointAttempts.push(...discovery.endpointResults);
      endpointShapes.length = 0;
      endpointShapes.push(...discovery.endpointShapes);
      bestEndpointRecommendation = buildBestEndpointRecommendation({
        hasToken: true,
        endpointResults: discovery.endpointResults,
      });
      const dateRangeAttempt = discovery.endpointResults.find((entry) => entry.label === "date_range");
      if (dateRangeAttempt?.extractedMetricsPreview) {
        mergedExtraction = mergeExtractedMetrics(
          {
            dataAvailability: {
              hasCompletedDuration: Boolean(dateRangeAttempt.dataAvailability?.hasDuration),
              hasCompletedDistance: Boolean(dateRangeAttempt.dataAvailability?.hasDistance),
              hasAveragePace: Boolean(dateRangeAttempt.dataAvailability?.hasAveragePace),
              hasAverageHeartRate: Boolean(dateRangeAttempt.dataAvailability?.hasAverageHeartRate),
              hasMaxHeartRate: false,
              hasLaps: Boolean(dateRangeAttempt.dataAvailability?.hasLaps),
              hasSplits: Boolean(dateRangeAttempt.dataAvailability?.hasSplits),
              hasIntervalActuals: Boolean(dateRangeAttempt.dataAvailability?.hasIntervalActuals),
              hasSamples: Boolean(dateRangeAttempt.dataAvailability?.hasSamples),
              hasPlannedStructure: Boolean(dateRangeAttempt.dataAvailability?.hasPlannedStructure),
              hasTargetPaceOrHr: Boolean(dateRangeAttempt.dataAvailability?.hasTargetPaceOrHr),
              hasCoachComments: Boolean(dateRangeAttempt.dataAvailability?.hasCoachComments),
            },
            extractedMetrics: {
              durationSeconds: dateRangeAttempt.extractedMetricsPreview.durationSeconds,
              distanceMeters: dateRangeAttempt.extractedMetricsPreview.distanceMeters,
              averagePaceSecPerKm: dateRangeAttempt.extractedMetricsPreview.averagePaceSecPerKm,
              averageHeartRateBpm: dateRangeAttempt.extractedMetricsPreview.averageHeartRateBpm,
              lapCount: dateRangeAttempt.extractedMetricsPreview.lapCount,
              splitCount: dateRangeAttempt.extractedMetricsPreview.splitCount,
              intervalCount: dateRangeAttempt.extractedMetricsPreview.intervalCount,
              sampleCount: dateRangeAttempt.extractedMetricsPreview.sampleCount,
            },
          },
          mergedExtraction
        );
      }
    }
  }

  if (!bestEndpointRecommendation) {
    bestEndpointRecommendation = buildBestEndpointRecommendation({
      hasToken: Boolean(token),
      endpointResults: endpointAttempts,
    });
  }

  const probe: TrainingPeaksCompletedWorkoutDetailsProbe = {
    target: {
      studentId: target.studentId,
      athleteId: String(target.athleteId),
      date: cliInput.date,
      cacheWorkoutId: selected?.id,
      trainingPeaksWorkoutId: selected ? String(selected.trainingPeaksWorkoutId) : undefined,
    },
    source: {
      mode,
      endpointsTried: endpointAttempts,
    },
    dataAvailability: mergedExtraction.dataAvailability,
    extractedMetrics: mergedExtraction.extractedMetrics,
    warnings,
    recommendation: buildRecommendation({
      availability: mergedExtraction.dataAvailability,
      liveEndpointUsed: Boolean(liveGet),
      ambiguousCandidates: candidates.length > 1 && !cliInput.workoutId,
      bestEndpointRecommendation,
    }),
  };

  const actor = cliInput.studentId ? `student-${target.studentId}` : `athlete-${target.athleteId}`;
  const reportDir = cliInput.discoverPerWorkoutEndpoints
    ? path.join(
        process.cwd(),
        PER_WORKOUT_REPORT_ROOT,
        `athlete-${target.athleteId}-workout-${cliInput.workoutId ?? "unknown"}`,
        timestampForPath()
      )
    : path.join(process.cwd(), REPORT_ROOT, actor, timestampForPath());
  await mkdir(reportDir, { recursive: true });

  const detailsPath = path.join(
    reportDir,
    cliInput.discoverPerWorkoutEndpoints ? "endpoint-discovery.json" : "details-probe.json"
  );
  const endpointShapesPath = path.join(reportDir, "endpoint-shapes.json");
  const candidatesPath = path.join(
    reportDir,
    cliInput.discoverPerWorkoutEndpoints ? "sanitized-samples.json" : "candidate-cache-workouts.json"
  );
  const summaryPath = path.join(reportDir, "SUMMARY.md");

  const candidateSummaries = candidates.map(summarizeCandidate);

  const reportPayload = cliInput.discoverPerWorkoutEndpoints
    ? ({
        target: {
          athleteId: String(target.athleteId),
          date: cliInput.date,
          workoutId: cliInput.workoutId ?? "unknown",
          studentId: target.studentId,
        },
        endpointResults: endpointAttempts,
        bestEndpointRecommendation,
        warnings,
      } as TrainingPeaksPerWorkoutEndpointDiscoveryResult)
    : probe;

  await writeFile(detailsPath, `${JSON.stringify(reportPayload, null, 2)}\n`, "utf8");
  await writeFile(endpointShapesPath, `${JSON.stringify(endpointShapes, null, 2)}\n`, "utf8");
  await writeFile(
    candidatesPath,
    `${JSON.stringify(
      cliInput.discoverPerWorkoutEndpoints
        ? endpointShapes.map((entry) => ({
            label: entry.label,
            endpoint: entry.endpoint,
            payloadSample: entry.payloadSample,
          }))
        : candidateSummaries,
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    summaryPath,
    formatSummaryMarkdown({
      probe,
      targetResolution: target,
      candidateRows: candidates,
      selected,
      outputFiles: { summaryPath, detailsPath, endpointShapesPath, candidatesPath },
    }),
    "utf8"
  );

  return {
    reportDir,
    probe,
    candidateCacheWorkouts: candidateSummaries,
    endpointShapes,
    outputFiles: { summaryPath, detailsPath, endpointShapesPath, candidatesPath },
  };
}

export async function cacheCandidatesForAthleteDate(input: {
  athleteId: number;
  date: string;
}): Promise<TrainingPeaksWorkoutCacheRow[]> {
  const allRows = await listTrainingPeaksWorkoutCacheForDateRange({
    from: input.date,
    to: input.date,
  });
  return allRows.filter((row) => row.trainingPeaksAthleteId === input.athleteId);
}
