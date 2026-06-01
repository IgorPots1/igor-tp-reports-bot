export const TP_API_HOST = "https://tpapi.trainingpeaks.com";

export const EXERCISE_DB_LIKE_KEY_MARKERS = [
  "exercise",
  "movement",
  "activity",
  "strength",
  "library",
  "equipment",
  "muscle",
  "bodypart",
  "instructions",
  "video",
  "media",
  "thumbnail",
] as const;

export const EXERCISE_NAME_FIELD_KEYS = [
  "name",
  "title",
  "itemname",
  "exercisename",
  "displayname",
  "label",
] as const;

export const EXERCISE_KEYWORD_GROUPS = {
  glute_bridge: ["glute", "bridge"],
  calf_raise: ["calf", "raise"],
  step_up: ["step up", "step"],
  plank: ["side plank", "plank"],
  clam_shell: ["clam", "shell"],
  squat: ["split squat", "squat"],
  deadlift: ["romanian", "deadlift"],
  band: ["band"],
  knee: ["knee"],
  lunge: ["lunge"],
} as const;

export const WORKOUT_TEMPLATE_LIBRARY_PATTERN = /\/exerciselibrary\/v2\b/i;

export const STATIC_ASSET_URL_PATTERN = /\.(?:js|css|map|woff2?|ttf|eot|svg|png|jpe?g|gif|ico|webp)(?:\?|$)/i;

export const API_HOST_MARKERS = ["tpapi.trainingpeaks.com", "api.trainingpeaks.com"] as const;

export type CapturedCallLike = {
  id: number;
  method: string;
  endpointPattern: string;
  status: number | null;
  tags: string[];
  request: {
    queryKeys: string[];
    bodyShape: unknown;
    bodyTopLevelKeys: string[];
  };
  response: {
    topLevelKeys: string[];
    bodyShape: unknown;
    bodyParseNote: string | null;
    hasExerciseLike: boolean;
    sampleSanitizedNames?: string[];
  };
};

export type ExerciseDbCandidate = {
  callId: number;
  endpointPattern: string;
  method: string;
  status: number | null;
  classification: "exercise-db-like" | "workout-template-library" | "exercise-search-like" | "unknown-strength";
  matchedKeyMarkers: string[];
  queryKeys: string[];
  requestTopLevelKeys: string[];
  responseTopLevelKeys: string[];
  responseArrayLength: number | null;
  sampleItemKeys: string[];
  sampleSanitizedNames: string[];
  stableIdFieldsVisible: boolean;
  instructionFieldsVisible: boolean;
  equipmentFieldsVisible: boolean;
  muscleOrBodyPartFieldsVisible: boolean;
  mediaFieldsVisible: boolean;
  keywordHits: Record<string, string[]>;
  looksLikeWorkoutTemplate: boolean;
};

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isTrainingPeaksApiUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.endsWith(".trainingpeaks.com") || host === "trainingpeaks.com";
  } catch {
    return false;
  }
}

export function isTpApiUrl(url: string): boolean {
  return url.startsWith(`${TP_API_HOST}/`);
}

export function containsAnyTextMatch(value: unknown, pattern: RegExp): boolean {
  const stack: unknown[] = [value];
  const seen = new Set<unknown>();
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || current === undefined) continue;
    if (typeof current === "string") {
      if (pattern.test(current)) return true;
      continue;
    }
    if (typeof current === "number" || typeof current === "boolean") continue;
    if (seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }
    if (isRecord(current)) {
      for (const [key, nested] of Object.entries(current)) {
        if (pattern.test(key)) return true;
        stack.push(nested);
      }
    }
  }
  return false;
}

export function findMatchedKeyMarkers(value: unknown): string[] {
  const found = new Set<string>();
  for (const marker of EXERCISE_DB_LIKE_KEY_MARKERS) {
    if (containsAnyTextMatch(value, new RegExp(`\\b${marker}\\b`, "i"))) {
      found.add(marker);
    }
  }
  return [...found];
}

function isSafeSampleName(value: string): boolean {
  if (!value.trim()) return false;
  if (value.startsWith("[REDACTED")) return false;
  if (value.startsWith("<") && value.endsWith(">")) return false;
  if (/^\d+$/.test(value.trim())) return false;
  if (value.length < 2 || value.length > 120) return false;
  if (/[{}();=>]/.test(value)) return false;
  if (/\bfunction\b|\bthis\.|emit\(|\.prototype\b/i.test(value)) return false;
  if (/\\"/.test(value)) return false;
  return true;
}

export function isStaticAssetUrl(url: string): boolean {
  try {
    return STATIC_ASSET_URL_PATTERN.test(new URL(url).pathname);
  } catch {
    return STATIC_ASSET_URL_PATTERN.test(url);
  }
}

export function isApiEndpointPattern(endpointPattern: string): boolean {
  return API_HOST_MARKERS.some((marker) => endpointPattern.includes(marker));
}

export function isPlausibleExerciseName(name: string): boolean {
  return isSafeSampleName(name);
}

export function extractSanitizedNameSamples(value: unknown, limit = 30): string[] {
  const out = new Set<string>();
  const stack: unknown[] = [value];
  const seen = new Set<unknown>();

  while (stack.length > 0 && out.size < limit) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (seen.has(current)) continue;
    seen.add(current);

    if (Array.isArray(current)) {
      for (const item of current.slice(0, 40)) stack.push(item);
      continue;
    }

    for (const [key, nested] of Object.entries(current)) {
      const normalizedKey = normalizeKey(key);
      if (typeof nested === "string" && EXERCISE_NAME_FIELD_KEYS.some((token) => normalizedKey.includes(token))) {
        if (isSafeSampleName(nested)) out.add(nested);
      }
      stack.push(nested);
    }
  }

  return [...out].slice(0, limit);
}

export function extractSampleItemKeys(value: unknown): string[] {
  if (isRecord(value) && isRecord(value.fields)) {
    const fields = value.fields as Record<string, unknown>;
    if (isRecord(fields.itemShape) && Array.isArray((fields.itemShape as Record<string, unknown>).keys)) {
      return ((fields.itemShape as Record<string, unknown>).keys as string[]).slice(0, 40);
    }
  }

  if (isRecord(value) && value.type === "array" && isRecord(value.itemShape)) {
    const itemShape = value.itemShape as Record<string, unknown>;
    if (Array.isArray(itemShape.keys)) {
      return itemShape.keys.slice(0, 40);
    }
  }

  return [];
}

export function extractResponseArrayLength(bodyShape: unknown): number | null {
  if (isRecord(bodyShape) && bodyShape.type === "array" && typeof bodyShape.length === "number") {
    return bodyShape.length;
  }
  return null;
}

export function findKeywordHits(value: unknown): Record<string, string[]> {
  const names = extractSanitizedNameSamples(value, 200);
  const out: Record<string, string[]> = {};

  for (const [group, terms] of Object.entries(EXERCISE_KEYWORD_GROUPS)) {
    const hits = names.filter((name) => {
      const lower = name.toLowerCase();
      return terms.some((term) => lower.includes(term.toLowerCase()));
    });
    if (hits.length > 0) {
      out[group] = [...new Set(hits)].slice(0, 20);
    }
  }

  return out;
}

function looksLikeWorkoutTemplateNames(names: string[]): boolean {
  if (names.length === 0) return false;
  const workoutish = names.filter((name) =>
    /\b(reps?|mins?|minutes|tempo|aerobic|ride|run|swim|tt|sets?)\b/i.test(name),
  );
  return workoutish.length >= Math.max(2, Math.floor(names.length * 0.3));
}

export function classifyExerciseDbCandidate(input: {
  endpointPattern: string;
  method: string;
  tags: string[];
  requestBodyShape: unknown;
  responseBodyShape: unknown;
  sampleSanitizedNames: string[];
}): ExerciseDbCandidate["classification"] {
  if (WORKOUT_TEMPLATE_LIBRARY_PATTERN.test(input.endpointPattern)) {
    return "workout-template-library";
  }

  const haystack = `${input.method} ${input.endpointPattern}`.toLowerCase();
  const markers = findMatchedKeyMarkers(input.responseBodyShape);
  const requestMarkers = findMatchedKeyMarkers(input.requestBodyShape);
  const allMarkers = [...new Set([...markers, ...requestMarkers])];

  if (input.tags.includes("search") || /search|query|filter/i.test(haystack)) {
    if (allMarkers.includes("exercise") || allMarkers.includes("movement")) {
      return "exercise-search-like";
    }
  }

  const hasExerciseMarkers =
    allMarkers.includes("exercise") ||
    allMarkers.includes("movement") ||
    allMarkers.includes("equipment") ||
    allMarkers.includes("muscle") ||
    allMarkers.includes("bodypart");

  if (hasExerciseMarkers && !looksLikeWorkoutTemplateNames(input.sampleSanitizedNames)) {
    return "exercise-db-like";
  }

  if (input.tags.includes("strength") || haystack.includes("strength")) {
    return "unknown-strength";
  }

  if (hasExerciseMarkers) {
    return "exercise-db-like";
  }

  return "unknown-strength";
}

export function buildExerciseDbCandidate(call: CapturedCallLike): ExerciseDbCandidate {
  const matchedKeyMarkers = findMatchedKeyMarkers(call.response.bodyShape);
  const requestMarkers = findMatchedKeyMarkers(call.request.bodyShape);
  const allMarkers = [...new Set([...matchedKeyMarkers, ...requestMarkers])];
  const sampleSanitizedNames =
    call.response.sampleSanitizedNames && call.response.sampleSanitizedNames.length > 0
      ? call.response.sampleSanitizedNames
      : extractSanitizedNameSamples(call.response.bodyShape);
  const classification = classifyExerciseDbCandidate({
    endpointPattern: call.endpointPattern,
    method: call.method,
    tags: call.tags,
    requestBodyShape: call.request.bodyShape,
    responseBodyShape: call.response.bodyShape,
    sampleSanitizedNames,
  });

  const keywordSource = sampleSanitizedNames.length > 0 ? { names: sampleSanitizedNames } : call.response.bodyShape;
  const keywordHits =
    sampleSanitizedNames.length > 0
      ? Object.fromEntries(
          Object.entries(EXERCISE_KEYWORD_GROUPS)
            .map(([group, terms]) => {
              const hits = sampleSanitizedNames.filter((name) => {
                const lower = name.toLowerCase();
                return terms.some((term) => lower.includes(term.toLowerCase()));
              });
              return hits.length > 0 ? [group, [...new Set(hits)].slice(0, 20)] : null;
            })
            .filter((entry): entry is [string, string[]] => entry !== null),
        )
      : findKeywordHits(keywordSource);

  return {
    callId: call.id,
    endpointPattern: call.endpointPattern,
    method: call.method,
    status: call.status,
    classification,
    matchedKeyMarkers: allMarkers,
    queryKeys: call.request.queryKeys,
    requestTopLevelKeys: call.request.bodyTopLevelKeys,
    responseTopLevelKeys: call.response.topLevelKeys,
    responseArrayLength: extractResponseArrayLength(call.response.bodyShape),
    sampleItemKeys: extractSampleItemKeys(call.response.bodyShape),
    sampleSanitizedNames,
    stableIdFieldsVisible: containsAnyTextMatch(call.response.bodyShape, /\b(exerciseid|movementid|libraryitemid|itemid)\b/i),
    instructionFieldsVisible: containsAnyTextMatch(call.response.bodyShape, /\b(instruction|cue|description|tips)\b/i),
    equipmentFieldsVisible: containsAnyTextMatch(call.response.bodyShape, /\b(equipment|gear|implement)\b/i),
    muscleOrBodyPartFieldsVisible: containsAnyTextMatch(call.response.bodyShape, /\b(muscle|bodypart|bodyarea|target)\b/i),
    mediaFieldsVisible: containsAnyTextMatch(call.response.bodyShape, /\b(video|youtube|thumbnail|media|imageurl)\b/i),
    keywordHits,
    looksLikeWorkoutTemplate:
      classification === "workout-template-library" || looksLikeWorkoutTemplateNames(sampleSanitizedNames),
  };
}

export function buildExerciseDbCandidates(calls: CapturedCallLike[]): ExerciseDbCandidate[] {
  return calls
    .filter((call) => {
      if (isStaticAssetUrl(call.endpointPattern)) {
        return false;
      }
      const markers = findMatchedKeyMarkers(call.response.bodyShape);
      const requestMarkers = findMatchedKeyMarkers(call.request.bodyShape);
      const tags = new Set(call.tags);
      return (
        markers.length > 0 ||
        requestMarkers.length > 0 ||
        tags.has("exercise") ||
        tags.has("search") ||
        tags.has("strength") ||
        WORKOUT_TEMPLATE_LIBRARY_PATTERN.test(call.endpointPattern)
      );
    })
    .map(buildExerciseDbCandidate)
    .slice(0, 80);
}

export function buildExerciseSearchCandidates(candidates: ExerciseDbCandidate[]): ExerciseDbCandidate[] {
  return candidates.filter((candidate) => candidate.classification === "exercise-search-like").slice(0, 40);
}

export function buildUnknownStrengthCalls(candidates: ExerciseDbCandidate[]): ExerciseDbCandidate[] {
  return candidates.filter((candidate) => candidate.classification === "unknown-strength").slice(0, 40);
}

export function buildExerciseDbKeywordHits(candidates: ExerciseDbCandidate[]): Record<string, { endpoints: string[]; sampleNames: string[] }> {
  const out: Record<string, { endpoints: Set<string>; sampleNames: Set<string> }> = {};

  for (const candidate of candidates) {
    for (const [group, names] of Object.entries(candidate.keywordHits)) {
      if (!out[group]) {
        out[group] = { endpoints: new Set(), sampleNames: new Set() };
      }
      out[group].endpoints.add(candidate.endpointPattern);
      for (const name of names) out[group].sampleNames.add(name);
    }
  }

  const serialized: Record<string, { endpoints: string[]; sampleNames: string[] }> = {};
  for (const [group, value] of Object.entries(out)) {
    serialized[group] = {
      endpoints: [...value.endpoints].slice(0, 20),
      sampleNames: [...value.sampleNames].slice(0, 30),
    };
  }
  return serialized;
}

export function summarizeExerciseDbFindings(candidates: ExerciseDbCandidate[]): {
  realExerciseDbFound: boolean;
  exerciseSearchEndpointFound: boolean;
  workoutTemplateLibraryConfirmed: boolean;
  exerciseDbLikeEndpoints: string[];
  exerciseSearchEndpoints: string[];
  workoutTemplateEndpoints: string[];
  unknownStrengthEndpoints: string[];
  totalKeywordHitGroups: number;
} {
  const exerciseDbLike = candidates.filter((c) => c.classification === "exercise-db-like");
  const exerciseSearch = candidates.filter((c) => c.classification === "exercise-search-like");
  const workoutTemplate = candidates.filter((c) => c.classification === "workout-template-library");
  const unknownStrength = candidates.filter((c) => c.classification === "unknown-strength");

  const realExerciseDbFound = exerciseDbLike.some(
    (candidate) =>
      isApiEndpointPattern(candidate.endpointPattern) &&
      !candidate.looksLikeWorkoutTemplate &&
      candidate.sampleSanitizedNames.some(isPlausibleExerciseName),
  );

  return {
    realExerciseDbFound,
    exerciseSearchEndpointFound: exerciseSearch.length > 0,
    workoutTemplateLibraryConfirmed: workoutTemplate.length > 0,
    exerciseDbLikeEndpoints: [...new Set(exerciseDbLike.map((c) => c.endpointPattern))],
    exerciseSearchEndpoints: [...new Set(exerciseSearch.map((c) => c.endpointPattern))],
    workoutTemplateEndpoints: [...new Set(workoutTemplate.map((c) => c.endpointPattern))],
    unknownStrengthEndpoints: [...new Set(unknownStrength.map((c) => c.endpointPattern))],
    totalKeywordHitGroups: Object.keys(buildExerciseDbKeywordHits(candidates)).length,
  };
}

export function buildExerciseDbSummarySection(input: {
  totalObservedTpApi: number;
  totalObservedOtherTpHosts: number;
  totalIncluded: number;
  findings: ReturnType<typeof summarizeExerciseDbFindings>;
  keywordHits: Record<string, { endpoints: string[]; sampleNames: string[] }>;
}): string {
  const lines: string[] = [];
  lines.push("## Exercise DB audit");
  lines.push(`- Total observed tpapi requests: **${input.totalObservedTpApi}**`);
  lines.push(`- Total observed other TrainingPeaks API hosts: **${input.totalObservedOtherTpHosts}**`);
  lines.push(`- Included sanitized calls: **${input.totalIncluded}**`);
  lines.push(`- Real New Strength Builder exercise DB found: **${input.findings.realExerciseDbFound ? "yes" : "no"}**`);
  lines.push(`- Exercise search endpoint found: **${input.findings.exerciseSearchEndpointFound ? "yes" : "no"}**`);
  lines.push(
    `- /exerciselibrary/v2 confirmed as workout-template library: **${input.findings.workoutTemplateLibraryConfirmed ? "yes" : "no"}**`,
  );
  lines.push(`- Keyword hit groups: **${input.findings.totalKeywordHitGroups}**`);
  lines.push("");
  lines.push("### Endpoint patterns");
  if (input.findings.exerciseDbLikeEndpoints.length > 0) {
    lines.push("- Exercise-db-like:");
    for (const endpoint of input.findings.exerciseDbLikeEndpoints) lines.push(`  - \`${endpoint}\``);
  } else {
    lines.push("- Exercise-db-like: none");
  }
  if (input.findings.exerciseSearchEndpoints.length > 0) {
    lines.push("- Exercise-search-like:");
    for (const endpoint of input.findings.exerciseSearchEndpoints) lines.push(`  - \`${endpoint}\``);
  }
  if (input.findings.workoutTemplateEndpoints.length > 0) {
    lines.push("- Workout-template-library (not exercise picker DB):");
    for (const endpoint of input.findings.workoutTemplateEndpoints) lines.push(`  - \`${endpoint}\``);
  }
  if (input.findings.unknownStrengthEndpoints.length > 0) {
    lines.push("- Unknown strength-related:");
    for (const endpoint of input.findings.unknownStrengthEndpoints.slice(0, 15)) lines.push(`  - \`${endpoint}\``);
  }
  lines.push("");
  lines.push("### Keyword hits (sanitized sample names)");
  const groups = Object.entries(input.keywordHits);
  if (groups.length === 0) {
    lines.push("- none");
  } else {
    for (const [group, value] of groups) {
      lines.push(`- ${group}: ${value.sampleNames.slice(0, 8).join(", ") || "none"}`);
    }
  }
  return lines.join("\n");
}
