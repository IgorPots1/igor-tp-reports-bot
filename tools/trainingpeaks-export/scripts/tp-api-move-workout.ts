import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { chromium, type BrowserContext, type Page, type Request } from "playwright";

import { profileDir, toolRoot } from "./lib/paths.ts";

type CliArgs = {
  athleteId: number;
  workoutId: number;
  targetDate: string;
  sourceDate: string | null;
  dryRun: boolean;
  execute: boolean;
  headless: boolean;
};

type CapturedAuth = {
  authorizationHeader: string | null;
  sampleRequestUrl: string | null;
  sampleHeaders: Record<string, string>;
};

type WorkoutMovePayload = Record<string, unknown>;

type RequestSummaryArtifact = {
  mode: "dry-run" | "execute";
  warnings: string[];
  endpoint: string;
  request: {
    method: "PUT";
    headers: Record<string, string>;
    payload: WorkoutMovePayload;
  };
  authValidation: {
    browserStorageCount: number;
    authHeaderObserved: boolean;
    sampleTpApiUrl: string | null;
  };
};

type ResponseArtifact = {
  warmupUrl: string;
  warmupTitle: string;
  warmupScreenshotPath: string;
  postScreenshotPath: string | null;
  session: {
    browserStorageCount: number;
    authHeaderObserved: boolean;
    authHeaderSourceUrl: string | null;
  };
  prefetchWorkout: {
    status: number | null;
    ok: boolean;
    body: unknown;
  };
  executePut: {
    attempted: boolean;
    status: number | null;
    ok: boolean;
    body: unknown;
  };
};

type VerificationArtifact = {
  mode: "dry-run" | "execute";
  targetDate: string;
  expectedWorkoutDay: string;
  executeAllowed: boolean;
  verification: {
    attempted: boolean;
    status: number | null;
    ok: boolean;
    workoutDay: string | null;
    matchesTargetDate: boolean;
    body: unknown;
  };
  notes: string[];
};

type VerifyWorkoutMovedResult = {
  attempted: true;
  status: number;
  ok: boolean;
  workoutDay: string | null;
  matchesTargetDate: boolean;
  body: unknown;
};

const API_HOST = "https://tpapi.trainingpeaks.com";
const APP_HOST = "https://app.trainingpeaks.com";
const ACTION_ARTIFACTS_ROOT = path.join(toolRoot, "action-artifacts", "api-move");
const TP_ACTIONS_REAL_EXECUTION_ENV = "TP_ACTIONS_REAL_EXECUTION";

const DEFAULT_HEADLESS = true;

const TOKEN_PATTERN_REPLACERS: Array<[RegExp, string]> = [
  [/(authorization\s*[:=]\s*)([^\s",;]+)/gi, "$1[REDACTED]"],
  [/(access_token\s*[:=]\s*)([^\s",;]+)/gi, "$1[REDACTED]"],
  [/(refresh_token\s*[:=]\s*)([^\s",;]+)/gi, "$1[REDACTED]"],
  [/(api[_\s-]?key\s*[:=]\s*)([^\s",;]+)/gi, "$1[REDACTED]"],
  [/("?(?:token|session|signature|sig)"?\s*[:=]\s*"?)([^"\s,;]+)("?)/gi, "$1[REDACTED]$3"],
];

function timestampForFileSystem(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

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

function redactUnknown(inputValue: unknown, parentKey = ""): unknown {
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

function parseDateArgToTpDateTime(dateStr: string): string {
  const normalized = dateStr.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`Invalid date "${dateStr}". Expected format YYYY-MM-DD.`);
  }
  return `${normalized}T00:00:00`;
}

function isTruthyEnvFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: Partial<CliArgs> = {
    dryRun: false,
    execute: false,
    headless: DEFAULT_HEADLESS,
    sourceDate: null,
  };

  for (const arg of argv) {
    if (arg.startsWith("--athlete-id=")) {
      parsed.athleteId = Number(arg.slice("--athlete-id=".length));
      continue;
    }
    if (arg.startsWith("--workout-id=")) {
      parsed.workoutId = Number(arg.slice("--workout-id=".length));
      continue;
    }
    if (arg.startsWith("--target-date=")) {
      parsed.targetDate = arg.slice("--target-date=".length).trim();
      continue;
    }
    if (arg.startsWith("--source-date=")) {
      const value = arg.slice("--source-date=".length).trim();
      parsed.sourceDate = value || null;
      continue;
    }
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (arg === "--execute") {
      parsed.execute = true;
      continue;
    }
    if (arg === "--headed") {
      parsed.headless = false;
      continue;
    }
    if (arg === "--headless") {
      parsed.headless = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isFinite(parsed.athleteId) || (parsed.athleteId ?? 0) <= 0) {
    throw new Error("Missing or invalid required arg --athlete-id=<number>.");
  }
  if (!Number.isFinite(parsed.workoutId) || (parsed.workoutId ?? 0) <= 0) {
    throw new Error("Missing or invalid required arg --workout-id=<number>.");
  }
  if (!parsed.targetDate) {
    throw new Error("Missing required arg --target-date=YYYY-MM-DD.");
  }

  parseDateArgToTpDateTime(parsed.targetDate);
  if (parsed.sourceDate) {
    parseDateArgToTpDateTime(parsed.sourceDate);
  }

  // Safe default: if neither --dry-run nor --execute is passed, stay dry-run.
  if (!parsed.dryRun && !parsed.execute) {
    parsed.dryRun = true;
  }

  if (parsed.dryRun && parsed.execute) {
    throw new Error("Choose only one mode: pass either --dry-run or --execute.");
  }

  return parsed as CliArgs;
}

function buildTpApiWorkoutUrl(athleteId: number, workoutId: number): string {
  return `${API_HOST}/fitness/v6/athletes/${athleteId}/workouts/${workoutId}`;
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

function buildWorkoutMovePayload(input: {
  athleteId: number;
  workoutId: number;
  targetDateTime: string;
  sourceWorkout: unknown;
}): WorkoutMovePayload {
  const source = pickRecord(input.sourceWorkout);

  // Keep a broad payload shape close to the captured request and fill from source workout when available.
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

function extractAuthFromRequest(request: Request): CapturedAuth {
  const headers = request.headers();
  return {
    authorizationHeader: headers.authorization ?? null,
    sampleRequestUrl: request.url(),
    sampleHeaders: headers,
  };
}

async function captureSessionAuth(input: {
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

async function performApiJsonRequest(input: {
  page: Page;
  method: "GET" | "PUT";
  endpoint: string;
  headers: Record<string, string>;
  body?: unknown;
}): Promise<{ status: number; ok: boolean; body: unknown }> {
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

async function verifyWorkoutMoved(input: {
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const mode: "dry-run" | "execute" = args.execute ? "execute" : "dry-run";
  const targetDateTime = parseDateArgToTpDateTime(args.targetDate);

  const executeAllowed = args.execute && isTruthyEnvFlag(process.env[TP_ACTIONS_REAL_EXECUTION_ENV]);
  if (args.execute && !executeAllowed) {
    throw new Error(
      `Execute mode is blocked. It requires BOTH --execute and ${TP_ACTIONS_REAL_EXECUTION_ENV}=true.`,
    );
  }

  const now = new Date();
  const timestamp = timestampForFileSystem(now);
  const artifactDir = path.join(ACTION_ARTIFACTS_ROOT, timestamp);
  await mkdir(profileDir, { recursive: true });
  await mkdir(artifactDir, { recursive: true });

  const requestArtifactPath = path.join(artifactDir, "request.redacted.json");
  const responseArtifactPath = path.join(artifactDir, "response.redacted.json");
  const verificationArtifactPath = path.join(artifactDir, "verification.redacted.json");
  const beforeScreenshotPath = path.join(artifactDir, "before.png");
  const afterScreenshotPath = path.join(artifactDir, "after.png");

  console.log("WARNING: API replay prototype only.");
  console.log("WARNING: Not yet production-integrated.");
  console.log(`Mode: ${mode}`);
  console.log(`Profile dir: ${profileDir}`);
  console.log(`Artifact dir: ${artifactDir}`);
  console.log("");

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: args.headless,
    viewport: null,
  });

  let postScreenshotPath: string | null = null;
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.bringToFront();

    const capturedAuth = await captureSessionAuth({
      context,
      page,
      athleteId: args.athleteId,
    });
    await page.screenshot({ path: beforeScreenshotPath, fullPage: true });

    const cookies = await context.cookies([APP_HOST, API_HOST]);
    const endpoint = buildTpApiWorkoutUrl(args.athleteId, args.workoutId);
    const authHeaders: Record<string, string> = {};
    if (capturedAuth.authorizationHeader) {
      authHeaders.authorization = capturedAuth.authorizationHeader;
    }

    const prefetchResult = await performApiJsonRequest({
      page,
      method: "GET",
      endpoint,
      headers: {
        accept: "application/json, text/javascript, */*; q=0.01",
        ...authHeaders,
      },
    });

    const payload = buildWorkoutMovePayload({
      athleteId: args.athleteId,
      workoutId: args.workoutId,
      targetDateTime,
      sourceWorkout: prefetchResult.body,
    });

    const requestSummary: RequestSummaryArtifact = {
      mode,
      warnings: [
        "API replay prototype only.",
        "Not yet production-integrated.",
        "Dry-run does not send mutation.",
      ],
      endpoint,
      request: {
        method: "PUT",
        headers: {
          accept: "application/json, text/javascript, */*; q=0.01",
          "content-type": "application/json",
          ...authHeaders,
        },
        payload,
      },
      authValidation: {
        browserStorageCount: cookies.length,
        authHeaderObserved: Boolean(capturedAuth.authorizationHeader),
        sampleTpApiUrl: capturedAuth.sampleRequestUrl,
      },
    };

    const responseArtifact: ResponseArtifact = {
      warmupUrl: page.url(),
      warmupTitle: await page.title(),
      warmupScreenshotPath: beforeScreenshotPath,
      postScreenshotPath,
      session: {
        browserStorageCount: cookies.length,
        authHeaderObserved: Boolean(capturedAuth.authorizationHeader),
        authHeaderSourceUrl: capturedAuth.sampleRequestUrl,
      },
      prefetchWorkout: {
        status: prefetchResult.status,
        ok: prefetchResult.ok,
        body: prefetchResult.body,
      },
      executePut: {
        attempted: false,
        status: null,
        ok: false,
        body: null,
      },
    };

    const verificationArtifact: VerificationArtifact = {
      mode,
      targetDate: args.targetDate,
      expectedWorkoutDay: targetDateTime,
      executeAllowed,
      verification: {
        attempted: false,
        status: null,
        ok: false,
        workoutDay: null,
        matchesTargetDate: false,
        body: null,
      },
      notes: [],
    };

    if (!cookies.length) {
      verificationArtifact.notes.push("No cookies were found in persistent profile context.");
    }
    if (!capturedAuth.authorizationHeader) {
      verificationArtifact.notes.push("Authorization header was not observed from TP API requests.");
    }
    if (!prefetchResult.ok) {
      verificationArtifact.notes.push("Prefetch workout GET failed; payload may be incomplete.");
    }
    if (!args.execute) {
      verificationArtifact.notes.push("Dry-run mode active: mutation request was not sent.");
    }

    if (args.execute) {
      const putResult = await performApiJsonRequest({
        page,
        method: "PUT",
        endpoint,
        headers: {
          accept: "application/json, text/javascript, */*; q=0.01",
          "content-type": "application/json",
          ...authHeaders,
        },
        body: payload,
      });

      responseArtifact.executePut = {
        attempted: true,
        status: putResult.status,
        ok: putResult.ok,
        body: putResult.body,
      };

      if (putResult.status !== 200) {
        throw new Error(`Execute PUT failed with status ${putResult.status}; expected 200.`);
      }

      const verification = await verifyWorkoutMoved({
        page,
        athleteId: args.athleteId,
        workoutId: args.workoutId,
        targetDate: args.targetDate,
        authHeaders,
      });
      verificationArtifact.verification = verification;

      if (!verification.ok) {
        throw new Error(`Verification GET failed with status ${verification.status}.`);
      }
      if (!verification.matchesTargetDate) {
        throw new Error(
          `Verification failed: workoutDay=${verification.workoutDay ?? "null"} does not match target date ${args.targetDate}.`,
        );
      }

      verificationArtifact.notes.push("Execute mode complete: PUT 200 and verification passed.");
      await page.waitForTimeout(1_000);
      await page.screenshot({ path: afterScreenshotPath, fullPage: true });
      postScreenshotPath = afterScreenshotPath;
      responseArtifact.postScreenshotPath = postScreenshotPath;
    }

    await writeFile(requestArtifactPath, `${JSON.stringify(redactUnknown(requestSummary), null, 2)}\n`, "utf8");
    await writeFile(responseArtifactPath, `${JSON.stringify(redactUnknown(responseArtifact), null, 2)}\n`, "utf8");
    await writeFile(
      verificationArtifactPath,
      `${JSON.stringify(redactUnknown(verificationArtifact), null, 2)}\n`,
      "utf8",
    );

    console.log(`Saved request artifact: ${requestArtifactPath}`);
    console.log(`Saved response artifact: ${responseArtifactPath}`);
    console.log(`Saved verification artifact: ${verificationArtifactPath}`);
    console.log("");
    console.log("Auth/session validation:");
    console.log(`- cookies count: ${cookies.length}`);
    console.log(`- authorization observed: ${capturedAuth.authorizationHeader ? "yes" : "no"}`);
    if (capturedAuth.sampleRequestUrl) {
      console.log(`- sample TP API request: ${capturedAuth.sampleRequestUrl}`);
    }

    if (!args.execute) {
      console.log("");
      console.log("Dry-run finished safely. No mutation request was sent.");
      return;
    }

    console.log("");
    console.log("Execute finished: mutation succeeded and verification confirmed target workoutDay.");
  } finally {
    await context.close().catch(() => {});
  }
}

main().catch((error: unknown) => {
  console.error("tp-api-move-workout failed.");
  console.error(error);
  process.exit(1);
});
