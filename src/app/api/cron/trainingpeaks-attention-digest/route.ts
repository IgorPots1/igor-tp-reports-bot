import { timingSafeEqual } from "node:crypto";

import { formatTrainingPeaksAttentionSnapshotMessage, getTrainingPeaksCoachChatIds } from "@/features/trainingpeaks/attention-telegram";
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

async function handleTrainingPeaksAttentionDigest(request: Request) {
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
    return jsonResponse(401, {
      ok: false,
      error: "Unauthorized",
    });
  }

  const coachChatIds = getTrainingPeaksCoachChatIds();
  if (coachChatIds.length === 0) {
    console.error("TrainingPeaks attention digest is not configured correctly");
    return jsonResponse(500, {
      ok: false,
      error: "Internal server error",
    });
  }

  try {
    const snapshot = await getTrainingPeaksAttentionSnapshot();
    const text = formatTrainingPeaksAttentionSnapshotMessage(snapshot, "Утренний обзор TrainingPeaks");

    const results = await Promise.allSettled(
      coachChatIds.map(async (chatId) => {
        await sendTelegramMessageStrict(chatId, text);
      })
    );

    const sentCount = results.filter((result) => result.status === "fulfilled").length;
    const failedCount = results.length - sentCount;
    const ok = failedCount === 0;

    if (!ok) {
      console.error("TrainingPeaks attention digest failed for some coach chats", {
        sentCount,
        failedCount,
      });
    }

    return jsonResponse(ok ? 200 : 500, {
      ok,
      status: ok ? "sent" : "partial_failure",
      counts: {
        coachChats: coachChatIds.length,
        sent: sentCount,
        failed: failedCount,
        urgent: snapshot.urgent.length,
        today: snapshot.today.length,
        observe: snapshot.observe.length,
        fyi: snapshot.fyi.length,
      },
    });
  } catch (error) {
    console.error("TrainingPeaks attention digest failed", error);
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
