import { timingSafeEqual } from "node:crypto";

import { runTrainingPeaksAttentionDigest } from "@/features/trainingpeaks/attention-digest-run";
import {
  createTrainingPeaksCronRunLog,
  expireTrainingPeaksOperationalSignals,
  expireTrainingPeaksStudentMemoryItems,
  finishTrainingPeaksCronRunLog,
  TRAININGPEAKS_ATTENTION_DIGEST_CRON_JOB_NAME,
} from "@/features/trainingpeaks/repository";

export const runtime = "nodejs";
export const maxDuration = 60;

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
    console.error("TrainingPeaks attention digest failed to persist cron run log", {
      runLogId,
      error,
    });
  }
}

async function persistVercelCronPreAuthRunLog(input: {
  startedAtMs: number;
  httpMethod: string;
  userAgent: string | null;
  requestPath: string;
  status: "unauthorized" | "failed";
  responseStatus: number;
  errorMessage: string;
}): Promise<void> {
  try {
    const runLog = await createTrainingPeaksCronRunLog({
      jobName: TRAININGPEAKS_ATTENTION_DIGEST_CRON_JOB_NAME,
      source: "vercel_cron",
      status: "started",
      httpMethod: input.httpMethod,
      userAgent: input.userAgent,
      requestPath: input.requestPath,
    });
    await finishCronRunLogSafely(runLog.id, {
      startedAtMs: input.startedAtMs,
      status: input.status,
      responseStatus: input.responseStatus,
      errorMessage: input.errorMessage,
    });
  } catch (error) {
    console.error("TrainingPeaks attention digest failed to persist pre-auth cron run log", {
      error,
    });
  }
}

async function handleTrainingPeaksAttentionDigest(request: Request) {
  const startedAtMs = Date.now();
  const httpMethod = request.method;
  const userAgent = request.headers.get("user-agent");
  const requestPath = new URL(request.url).pathname;
  const source = detectCronSource(request);

  const cronSecret = getCronSecret();
  const isVercelCron = source === "vercel_cron";
  if (!cronSecret || !process.env.TELEGRAM_BOT_TOKEN?.trim()) {
    console.error("TrainingPeaks attention digest is not configured correctly");
    if (isVercelCron) {
      await persistVercelCronPreAuthRunLog({
        startedAtMs,
        httpMethod,
        userAgent,
        requestPath,
        status: "failed",
        responseStatus: 500,
        errorMessage: "missing_cron_config",
      });
    }
    return jsonResponse(500, {
      ok: false,
      error: "Internal server error",
    });
  }

  const providedSecret = getBearerToken(request);
  if (!providedSecret || !safeEqual(providedSecret, cronSecret)) {
    if (isVercelCron) {
      await persistVercelCronPreAuthRunLog({
        startedAtMs,
        httpMethod,
        userAgent,
        requestPath,
        status: "unauthorized",
        responseStatus: 401,
        errorMessage: "unauthorized_vercel_cron",
      });
    }
    return jsonResponse(401, {
      ok: false,
      error: "Unauthorized",
    });
  }

  let memoryExpiredCount = 0;
  let signalsExpiredCount = 0;
  try {
    [memoryExpiredCount, signalsExpiredCount] = await Promise.all([
      expireTrainingPeaksStudentMemoryItems(),
      expireTrainingPeaksOperationalSignals(),
    ]);
    console.info("trainingpeaks_attention_digest_lifecycle_cleanup_completed", {
      memoryExpiredCount,
      signalsExpiredCount,
    });
  } catch (error) {
    console.error("trainingpeaks_attention_digest_lifecycle_cleanup_failed", {
      error,
    });
  }

  const result = await runTrainingPeaksAttentionDigest({
    source,
    httpMethod,
    userAgent,
    requestPath,
  });

  return jsonResponse(result.ok ? 200 : 500, {
    ok: result.ok,
    status: result.status,
    counts: result.counts,
  });
}

export async function GET(request: Request) {
  return handleTrainingPeaksAttentionDigest(request);
}

export async function POST(request: Request) {
  return handleTrainingPeaksAttentionDigest(request);
}
