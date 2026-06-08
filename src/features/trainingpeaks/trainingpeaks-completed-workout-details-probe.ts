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
  status?: number;
  ok: boolean;
  shapeSummary: string[];
  error?: string;
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
  endpoint: string;
  status: number;
  ok: boolean;
  payload: unknown;
  shapeSummary: string[];
};

const REPORT_ROOT = "reports/trainingpeaks-completed-workout-details-probe";
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
}): Promise<OptionalGetEndpointResult | null> {
  const token = process.env.TRAININGPEAKS_API_BEARER?.trim();
  if (!token) {
    return null;
  }
  enforceGetOnlyMethod("GET");
  const endpoint = `https://tpapi.trainingpeaks.com/fitness/v6/athletes/${input.athleteId}/workouts/${input.from}/${input.to}`;
  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
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
    endpoint,
    status: response.status,
    ok: response.ok,
    payload,
    shapeSummary,
  };
}

function buildRecommendation(input: {
  availability: TrainingPeaksCompletedWorkoutDetailsAvailability;
  liveEndpointUsed: boolean;
  ambiguousCandidates: boolean;
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
  lines.push("# TrainingPeaks Completed Workout Details Probe");
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
        `- ${endpoint.label}: method=${endpoint.method} ok=${endpoint.ok} status=${endpoint.status ?? "n/a"} shape=${endpoint.shapeSummary.join(", ")}`
      );
    }
  }
  lines.push("");
  lines.push("## Data availability");
  lines.push(`- avg pace: ${probe.dataAvailability.hasAveragePace ? "yes" : "no"}`);
  lines.push(`- avg HR: ${probe.dataAvailability.hasAverageHeartRate ? "yes" : "no"}`);
  lines.push(`- laps: ${probe.dataAvailability.hasLaps ? "yes" : "no"}`);
  lines.push(`- interval actuals: ${probe.dataAvailability.hasIntervalActuals ? "yes" : "no"}`);
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
  lines.push(`- intervalCount: ${probe.extractedMetrics.intervalCount ?? "n/a"}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("- GET-only: yes");
  lines.push("- TP mutations: no");
  lines.push("- Telegram sends: no");
  lines.push("- DB writes: no");
  lines.push("");
  lines.push("## Report files");
  lines.push(`- details-probe.json: ${input.outputFiles.detailsPath}`);
  lines.push(`- endpoint-shapes.json: ${input.outputFiles.endpointShapesPath}`);
  lines.push(`- candidate-cache-workouts.json: ${input.outputFiles.candidatesPath}`);
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

  const liveGet = await maybeFetchLiveWorkoutDetailsGet({
    athleteId: target.athleteId,
    from: cliInput.date,
    to: cliInput.date,
  });
  if (liveGet) {
    mode = "tp_get_endpoint";
    endpointAttempts.push({
      method: "GET",
      label: liveGet.endpoint,
      status: liveGet.status,
      ok: liveGet.ok,
      shapeSummary: liveGet.shapeSummary,
      error: liveGet.ok ? undefined : "Non-OK status from TP endpoint.",
    });
    endpointShapes.push({
      endpoint: liveGet.endpoint,
      status: liveGet.status,
      ok: liveGet.ok,
      shapeSummary: liveGet.shapeSummary,
      payloadSample: redactSensitiveForReport(liveGet.payload),
    });
    const liveExtraction = extractTrainingPeaksCompletedWorkoutDetails(liveGet.payload);
    mergedExtraction = mergeExtractedMetrics(liveExtraction, cacheExtraction);
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
    }),
  };

  const actor = cliInput.studentId ? `student-${target.studentId}` : `athlete-${target.athleteId}`;
  const reportDir = path.join(process.cwd(), REPORT_ROOT, actor, timestampForPath());
  await mkdir(reportDir, { recursive: true });

  const detailsPath = path.join(reportDir, "details-probe.json");
  const endpointShapesPath = path.join(reportDir, "endpoint-shapes.json");
  const candidatesPath = path.join(reportDir, "candidate-cache-workouts.json");
  const summaryPath = path.join(reportDir, "SUMMARY.md");

  const candidateSummaries = candidates.map(summarizeCandidate);

  await writeFile(detailsPath, `${JSON.stringify(probe, null, 2)}\n`, "utf8");
  await writeFile(endpointShapesPath, `${JSON.stringify(endpointShapes, null, 2)}\n`, "utf8");
  await writeFile(candidatesPath, `${JSON.stringify(candidateSummaries, null, 2)}\n`, "utf8");
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
