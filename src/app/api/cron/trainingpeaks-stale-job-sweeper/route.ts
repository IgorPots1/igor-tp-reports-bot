import { timingSafeEqual } from "node:crypto";

import {
  TRAININGPEAKS_STALE_JOB_SWEEPER_CRON_JOB_NAME,
  createTrainingPeaksCronRunLog,
  finishTrainingPeaksCronRunLog,
} from "@/features/trainingpeaks/repository";
import {
  recoverStaleTrainingPeaksJobs,
  recoverStaleTrainingPeaksRaceScanJobs,
} from "@/features/trainingpeaks/service";

export const runtime = "nodejs";

const jsonHeaders = {
  "Content-Type": "application/json",
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders,
  });
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function getBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.split(/\s+/, 2);
  if (scheme !== "Bearer" || !token?.trim()) {
    return null;
  }

  return token.trim();
}

function getCronSecret(): string {
  return process.env.CRON_SECRET?.trim() ?? "";
}

function detectCronSource(request: Request): "vercel_cron" | "manual" {
  const userAgent = request.headers.get("user-agent") ?? "";
  if (userAgent.toLowerCase().includes("vercel-cron")) {
    return "vercel_cron";
  }

  return "manual";
}

async function finishCronRunLogSafely(
  runLogId: string,
  input: Parameters<typeof finishTrainingPeaksCronRunLog>[1] & { startedAtMs: number }
): Promise<void> {
  const { startedAtMs, ...finishInput } = input;
  try {
    await finishTrainingPeaksCronRunLog(runLogId, {
      ...finishInput,
      durationMs: Date.now() - startedAtMs,
    });
  } catch (error) {
    console.error("TrainingPeaks stale-job sweeper failed to persist cron run log", {
      runLogId,
      error,
    });
  }
}

async function handleTrainingPeaksStaleJobSweeper(request: Request) {
  const startedAtMs = Date.now();
  const httpMethod = request.method;
  const userAgent = request.headers.get("user-agent");
  const requestPath = new URL(request.url).pathname;

  const cronSecret = getCronSecret();
  if (!cronSecret) {
    console.error("TrainingPeaks stale-job sweeper is not configured correctly");
    return jsonResponse(500, {
      ok: false,
      error: "Internal server error",
    });
  }

  const providedSecret = getBearerToken(request);
  if (!providedSecret || !safeEqual(providedSecret, cronSecret)) {
    return jsonResponse(401, {
      ok: false,
      error: "Unauthorized",
    });
  }

  let runLogId: string | null = null;
  try {
    const runLog = await createTrainingPeaksCronRunLog({
      jobName: TRAININGPEAKS_STALE_JOB_SWEEPER_CRON_JOB_NAME,
      source: detectCronSource(request),
      status: "started",
      httpMethod,
      userAgent,
      requestPath,
    });
    runLogId = runLog.id;
  } catch (error) {
    console.error("TrainingPeaks stale-job sweeper failed to create cron run log", error);
  }

  try {
    const [recoveredWeeklyReports, recoveredRaceScans] = await Promise.all([
      recoverStaleTrainingPeaksJobs(360),
      recoverStaleTrainingPeaksRaceScanJobs(360),
    ]);
    const counts = {
      recoveredWeeklyReports,
      recoveredRaceScans,
      recoveredTotal: recoveredWeeklyReports + recoveredRaceScans,
    };

    if (runLogId) {
      await finishCronRunLogSafely(runLogId, {
        startedAtMs,
        status: "sent",
        responseStatus: 200,
        counts,
      });
    }

    return jsonResponse(200, {
      ok: true,
      counts,
    });
  } catch (error) {
    console.error("TrainingPeaks stale-job sweeper failed", error);
    if (runLogId) {
      await finishCronRunLogSafely(runLogId, {
        startedAtMs,
        status: "failed",
        responseStatus: 500,
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      });
    }
    return jsonResponse(500, {
      ok: false,
      error: "Internal server error",
    });
  }
}

export async function GET(request: Request) {
  return handleTrainingPeaksStaleJobSweeper(request);
}

export async function POST(request: Request) {
  return handleTrainingPeaksStaleJobSweeper(request);
}
