import type { BrowserContext, Page, Request } from "playwright";

export type CapturedAuth = {
  authorizationHeader: string | null;
  sampleRequestUrl: string | null;
  sampleHeaders: Record<string, string>;
};

export type WorkoutMovePayload = Record<string, unknown>;

export type ApiJsonResponse = {
  status: number;
  ok: boolean;
  body: unknown;
};

export type VerifyWorkoutMovedResult = {
  attempted: true;
  status: number;
  ok: boolean;
  workoutDay: string | null;
  matchesTargetDate: boolean;
  body: unknown;
};

const API_HOST = "https://tpapi.trainingpeaks.com";
const APP_HOST = "https://app.trainingpeaks.com";

const TOKEN_PATTERN_REPLACERS: Array<[RegExp, string]> = [
  [/(authorization\s*[:=]\s*)([^\s",;]+)/gi, "$1[REDACTED]"],
  [/(access_token\s*[:=]\s*)([^\s",;]+)/gi, "$1[REDACTED]"],
  [/(refresh_token\s*[:=]\s*)([^\s",;]+)/gi, "$1[REDACTED]"],
  [/(api[_\s-]?key\s*[:=]\s*)([^\s",;]+)/gi, "$1[REDACTED]"],
  [/("?(?:token|session|signature|sig)"?\s*[:=]\s*"?)([^"\s,;]+)("?)/gi, "$1[REDACTED]$3"],
];

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function shouldRedactByKey(key: string): boolean {
  const normalized = normalizeKey(key);
  if (!normalized) return false;
  const markers = [
    "authorization",
    "cookie",
    "setcookie",
    "token",
    "accesstoken",
    "refreshtoken",
    "session",
    "signature",
    "sig",
    "apikey",
  ];
  return markers.some((marker) => normalized.includes(marker));
}

function pickRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  return input as Record<string, unknown>;
}

function pickValue(input: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(input, key) ? input[key] : null;
}

function extractAuthFromRequest(request: Request): CapturedAuth {
  const headers = request.headers();
  return {
    authorizationHeader: headers.authorization ?? null,
    sampleRequestUrl: request.url(),
    sampleHeaders: headers,
  };
}

export function buildTpApiWorkoutUrl(athleteId: number, workoutId: number): string {
  return `${API_HOST}/fitness/v6/athletes/${athleteId}/workouts/${workoutId}`;
}

export function parseDateArgToTpDateTime(dateStr: string): string {
  const normalized = dateStr.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`Invalid date "${dateStr}". Expected format YYYY-MM-DD.`);
  }
  return `${normalized}T00:00:00`;
}

export function redactUnknown(inputValue: unknown, parentKey = ""): unknown {
  if (parentKey && shouldRedactByKey(parentKey)) {
    return "[REDACTED]";
  }

  if (Array.isArray(inputValue)) {
    return inputValue.map((item) => redactUnknown(item, parentKey));
  }

  if (inputValue && typeof inputValue === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(inputValue)) {
      out[key] = redactUnknown(value, key);
    }
    return out;
  }

  if (typeof inputValue !== "string") {
    return inputValue;
  }

  let text = inputValue;
  for (const [pattern, replacement] of TOKEN_PATTERN_REPLACERS) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

export function buildWorkoutMovePayload(input: {
  athleteId: number;
  workoutId: number;
  targetDateTime: string;
  sourceWorkout: unknown;
}): WorkoutMovePayload {
  const source = pickRecord(input.sourceWorkout);

  return {
    elevationAverage: pickValue(source, "elevationAverage"),
    velocityAverage: pickValue(source, "velocityAverage"),
    elevationLoss: pickValue(source, "elevationLoss"),
    tssActual: pickValue(source, "tssActual"),
    elevationMaximum: pickValue(source, "elevationMaximum"),
    velocityMaximum: pickValue(source, "velocityMaximum"),
    userTags: pickValue(source, "userTags"),
    isItAnOr: pickValue(source, "isItAnOr"),
    calories: pickValue(source, "calories"),
    rpe: pickValue(source, "rpe"),
    ifPlanned: pickValue(source, "ifPlanned"),
    velocityPlanned: pickValue(source, "velocityPlanned"),
    energy: pickValue(source, "energy"),
    elevationGainPlanned: pickValue(source, "elevationGainPlanned"),
    heartRateMinimum: pickValue(source, "heartRateMinimum"),
    equipmentBikeId: pickValue(source, "equipmentBikeId"),
    publicSettingValue: pickValue(source, "publicSettingValue"),
    sharedWorkoutInformationKey: pickValue(source, "sharedWorkoutInformationKey"),
    completed: pickValue(source, "completed"),
    cadenceAverage: pickValue(source, "cadenceAverage"),
    complianceTssPercent: pickValue(source, "complianceTssPercent"),
    sharedWorkoutInformationExpireKey: pickValue(source, "sharedWorkoutInformationExpireKey"),
    code: pickValue(source, "code"),
    lastModifiedDate: pickValue(source, "lastModifiedDate"),
    coachComments: pickValue(source, "coachComments"),
    workoutDeviceSource: pickValue(source, "workoutDeviceSource"),
    hasPrivateWorkoutNoteForCaller: pickValue(source, "hasPrivateWorkoutNoteForCaller"),
    distancePlanned: pickValue(source, "distancePlanned"),
    cadenceMaximum: pickValue(source, "cadenceMaximum"),
    startTime: pickValue(source, "startTime"),
    orderOnDay: pickValue(source, "orderOnDay"),
    tssSource: pickValue(source, "tssSource"),
    tempMax: pickValue(source, "tempMax"),
    tssPlanned: pickValue(source, "tssPlanned"),
    totalTime: pickValue(source, "totalTime"),
    elevationMinimum: pickValue(source, "elevationMinimum"),
    workoutComments: pickValue(source, "workoutComments"),
    poolLengthOptionId: pickValue(source, "poolLengthOptionId"),
    totalTimePlanned: pickValue(source, "totalTimePlanned"),
    torqueAverage: pickValue(source, "torqueAverage"),
    structure: pickValue(source, "structure"),
    equipmentShoeId: pickValue(source, "equipmentShoeId"),
    isLocked: pickValue(source, "isLocked"),
    isHidden: pickValue(source, "isHidden"),
    startTimePlanned: pickValue(source, "startTimePlanned"),
    syncedTo: pickValue(source, "syncedTo"),
    complianceDistancePercent: pickValue(source, "complianceDistancePercent"),
    workoutTypeValueId: pickValue(source, "workoutTypeValueId"),
    distance: pickValue(source, "distance"),
    torqueMaximum: pickValue(source, "torqueMaximum"),
    distanceCustomized: pickValue(source, "distanceCustomized"),
    complianceDurationPercent: pickValue(source, "complianceDurationPercent"),
    heartRateAverage: pickValue(source, "heartRateAverage"),
    workoutId: input.workoutId,
    powerAverage: pickValue(source, "powerAverage"),
    workoutSubTypeId: pickValue(source, "workoutSubTypeId"),
    title: pickValue(source, "title"),
    heartRateMaximum: pickValue(source, "heartRateMaximum"),
    athleteId: input.athleteId,
    distanceUnitsCustomized: pickValue(source, "distanceUnitsCustomized"),
    powerMaximum: pickValue(source, "powerMaximum"),
    feeling: pickValue(source, "feeling"),
    energyPlanned: pickValue(source, "energyPlanned"),
    elevationGain: pickValue(source, "elevationGain"),
    normalizedPowerActual: pickValue(source, "normalizedPowerActual"),
    description: pickValue(source, "description"),
    if: pickValue(source, "if"),
    personalRecordCount: pickValue(source, "personalRecordCount"),
    normalizedSpeedActual: pickValue(source, "normalizedSpeedActual"),
    tempMin: pickValue(source, "tempMin"),
    tempAvg: pickValue(source, "tempAvg"),
    caloriesPlanned: pickValue(source, "caloriesPlanned"),
    newComment: pickValue(source, "newComment"),
    workoutDay: input.targetDateTime,
  };
}

export async function captureSessionAuth(input: {
  context: BrowserContext;
  page: Page;
  athleteId: number;
}): Promise<CapturedAuth> {
  let latestAuth: CapturedAuth = {
    authorizationHeader: null,
    sampleRequestUrl: null,
    sampleHeaders: {},
  };

  const onRequest = (request: Request): void => {
    if (!request.url().startsWith(`${API_HOST}/`)) return;
    const found = extractAuthFromRequest(request);
    if (!latestAuth.authorizationHeader && found.authorizationHeader) {
      latestAuth = found;
      return;
    }
    if (!latestAuth.sampleRequestUrl) {
      latestAuth = found;
    }
  };

  input.context.on("request", onRequest);
  try {
    const warmupUrl = `${APP_HOST}/#calendar/athletes/${input.athleteId}`;
    await input.page.goto(warmupUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await input.page.waitForTimeout(3_000);
  } finally {
    input.context.off("request", onRequest);
  }

  return latestAuth;
}

export async function performApiJsonRequest(input: {
  page: Page;
  method: "GET" | "PUT" | "POST" | "DELETE";
  endpoint: string;
  headers: Record<string, string>;
  body?: unknown;
}): Promise<ApiJsonResponse> {
  const response = await input.page.request.fetch(input.endpoint, {
    method: input.method,
    headers: input.headers,
    data: input.body,
    failOnStatusCode: false,
  });

  let parsedBody: unknown;
  try {
    parsedBody = await response.json();
  } catch {
    parsedBody = await response.text();
  }

  return {
    status: response.status(),
    ok: response.ok(),
    body: parsedBody,
  };
}

export async function verifyWorkoutMoved(input: {
  page: Page;
  athleteId: number;
  workoutId: number;
  targetDate: string;
  authHeaders: Record<string, string>;
}): Promise<VerifyWorkoutMovedResult> {
  const endpoint = buildTpApiWorkoutUrl(input.athleteId, input.workoutId);
  const getResult = await performApiJsonRequest({
    page: input.page,
    method: "GET",
    endpoint,
    headers: {
      accept: "application/json, text/javascript, */*; q=0.01",
      ...input.authHeaders,
    },
  });

  const bodyRecord = pickRecord(getResult.body);
  const workoutDayRaw = bodyRecord.workoutDay;
  const workoutDay = typeof workoutDayRaw === "string" ? workoutDayRaw : null;
  const matchesTargetDate = Boolean(workoutDay && workoutDay.startsWith(input.targetDate));

  return {
    attempted: true,
    status: getResult.status,
    ok: getResult.ok,
    workoutDay,
    matchesTargetDate,
    body: getResult.body,
  };
}
