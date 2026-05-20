import { timingSafeEqual } from "node:crypto";

import {
  buildTrainingPeaksAttentionDigestMessages,
  getTrainingPeaksCoachChatIds,
} from "@/features/trainingpeaks/attention-telegram";
import {
  createTrainingPeaksCronRunLog,
  finishTrainingPeaksCronRunLog,
  TRAININGPEAKS_ATTENTION_DIGEST_CRON_JOB_NAME,
} from "@/features/trainingpeaks/repository";
import { getTrainingPeaksAttentionSnapshot } from "@/features/trainingpeaks/service";
import { sendTelegramMessageStrict } from "@/features/telegram/telegram-client";

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
    console.error("TrainingPeaks attention digest failed to persist cron run log", {
      runLogId,
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
  if (!cronSecret || !process.env.TELEGRAM_BOT_TOKEN?.trim()) {
    console.error("TrainingPeaks attention digest is not configured correctly");
    return jsonResponse(500, {
      ok: false,
      error: "Internal server error",
    });
  }

  const providedSecret = getBearerToken(request);
  if (!providedSecret || !safeEqual(providedSecret, cronSecret)) {
    // Unauthorized requests are not persisted: avoids storing scanner traffic and never logs secrets.
    return jsonResponse(401, {
      ok: false,
      error: "Unauthorized",
    });
  }

  let runLogId: string | null = null;
  try {
    const runLog = await createTrainingPeaksCronRunLog({
      jobName: TRAININGPEAKS_ATTENTION_DIGEST_CRON_JOB_NAME,
      source,
      status: "started",
      httpMethod,
      userAgent,
      requestPath,
    });
    runLogId = runLog.id;
  } catch (error) {
    console.error("TrainingPeaks attention digest failed to create cron run log", error);
  }

  const coachChatIds = getTrainingPeaksCoachChatIds();
  if (coachChatIds.length === 0) {
    console.error("TrainingPeaks attention digest is not configured correctly");
    if (runLogId) {
      await finishCronRunLogSafely(runLogId, {
        startedAtMs,
        status: "failed",
        responseStatus: 500,
        errorMessage: "No coach chat IDs configured",
      });
    }
    return jsonResponse(500, {
      ok: false,
      error: "Internal server error",
    });
  }

  try {
    const snapshot = await getTrainingPeaksAttentionSnapshot();
    const messages = buildTrainingPeaksAttentionDigestMessages(
      snapshot,
      "Утренний обзор TrainingPeaks"
    );

    const results = await Promise.allSettled(
      coachChatIds.map(async (chatId) => {
        for (const message of messages) {
          await sendTelegramMessageStrict(chatId, message);
        }
      })
    );

    const sentCount = results.filter((result) => result.status === "fulfilled").length;
    const failedCount = results.length - sentCount;
    const ok = failedCount === 0;
    const counts = {
      coachChats: coachChatIds.length,
      sent: sentCount,
      failed: failedCount,
      urgent: snapshot.urgent.length,
      today: snapshot.today.length,
      observe: snapshot.observe.length,
      fyi: snapshot.fyi.length,
    };

    if (!ok) {
      console.error("TrainingPeaks attention digest failed for some coach chats", {
        sentCount,
        failedCount,
      });
    }

    if (runLogId) {
      await finishCronRunLogSafely(runLogId, {
        startedAtMs,
        status: ok ? "sent" : "failed",
        responseStatus: ok ? 200 : 500,
        counts,
        errorMessage: ok ? null : `partial_failure: sent=${sentCount}, failed=${failedCount}`,
      });
    }

    return jsonResponse(ok ? 200 : 500, {
      ok,
      status: ok ? "sent" : "partial_failure",
      counts,
    });
  } catch (error) {
    console.error("TrainingPeaks attention digest failed", error);
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
  return handleTrainingPeaksAttentionDigest(request);
}

export async function POST(request: Request) {
  return handleTrainingPeaksAttentionDigest(request);
}
