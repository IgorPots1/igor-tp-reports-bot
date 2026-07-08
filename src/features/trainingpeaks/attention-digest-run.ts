import {
  buildTrainingPeaksAttentionDigestMessages,
  getTrainingPeaksCoachChatIds,
} from "@/features/trainingpeaks/attention-telegram";
import {
  createTrainingPeaksCronRunLog,
  finishTrainingPeaksCronRunLog,
  getLatestTrainingPeaksCronRunLog,
  TRAININGPEAKS_ATTENTION_DIGEST_CRON_JOB_NAME,
  type TrainingPeaksCronRunLogSource,
} from "@/features/trainingpeaks/repository";
import { getTrainingPeaksAttentionSnapshot } from "@/features/trainingpeaks/service";
import { sendTelegramMessageStrict } from "@/features/telegram/telegram-client";

export const TRAININGPEAKS_ATTENTION_DIGEST_TITLE = "Утренний обзор TrainingPeaks";
const BELGRADE_TIMEZONE = "Europe/Belgrade";

function getBelgradeIsoDate(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BELGRADE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

export function getTrainingPeaksAttentionDigestBelgradeTodayIso(now = new Date()): string {
  return getBelgradeIsoDate(now);
}

export function getTrainingPeaksAttentionDigestBelgradeIsoDateFromTimestamp(
  timestamp: string
): string | null {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return getBelgradeIsoDate(date);
}

export async function hasTrainingPeaksAttentionDigestSentForBelgradeDate(
  belgradeDateIso: string
): Promise<boolean> {
  const lastSent = await getLatestTrainingPeaksCronRunLog({
    jobName: TRAININGPEAKS_ATTENTION_DIGEST_CRON_JOB_NAME,
    status: "sent",
  });
  if (!lastSent) {
    return false;
  }

  const sentDate = getTrainingPeaksAttentionDigestBelgradeIsoDateFromTimestamp(lastSent.startedAt);
  return sentDate === belgradeDateIso;
}

export type RunTrainingPeaksAttentionDigestInput = {
  source: TrainingPeaksCronRunLogSource;
  httpMethod?: string | null;
  userAgent?: string | null;
  requestPath?: string | null;
};

export type RunTrainingPeaksAttentionDigestResult = {
  ok: boolean;
  status: "sent" | "partial_failure" | "failed" | "skipped_already_sent";
  counts: {
    coachChats: number;
    sent: number;
    failed: number;
    urgent: number;
    today: number;
    observe: number;
    fyi: number;
  };
  errorMessage?: string;
};

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

export async function runTrainingPeaksAttentionDigest(
  input: RunTrainingPeaksAttentionDigestInput
): Promise<RunTrainingPeaksAttentionDigestResult> {
  // Dedup guard for the cron path: if today's Belgrade digest was already sent,
  // skip. Makes the endpoint safe to trigger from several schedulers at once
  // (GitHub Actions dual schedule + Vercel cron) without duplicate sends. The
  // manual command already guards separately before calling this. ok:true so a
  // duplicate trigger gets 200 (no retry storm), not a 500.
  const todayIso = getTrainingPeaksAttentionDigestBelgradeTodayIso();
  if (await hasTrainingPeaksAttentionDigestSentForBelgradeDate(todayIso)) {
    console.info("TrainingPeaks attention digest skipped: already sent for", todayIso);
    return {
      ok: true,
      status: "skipped_already_sent",
      counts: {
        coachChats: 0,
        sent: 0,
        failed: 0,
        urgent: 0,
        today: 0,
        observe: 0,
        fyi: 0,
      },
    };
  }

  const startedAtMs = Date.now();
  let runLogId: string | null = null;

  try {
    const runLog = await createTrainingPeaksCronRunLog({
      jobName: TRAININGPEAKS_ATTENTION_DIGEST_CRON_JOB_NAME,
      source: input.source,
      status: "started",
      httpMethod: input.httpMethod ?? null,
      userAgent: input.userAgent ?? null,
      requestPath: input.requestPath ?? null,
    });
    runLogId = runLog.id;
  } catch (error) {
    console.error("TrainingPeaks attention digest failed to create cron run log", error);
  }

  const coachChatIds = getTrainingPeaksCoachChatIds();
  if (coachChatIds.length === 0) {
    const errorMessage = "No coach chat IDs configured";
    console.error("TrainingPeaks attention digest is not configured correctly");
    if (runLogId) {
      await finishCronRunLogSafely(runLogId, {
        startedAtMs,
        status: "failed",
        responseStatus: 500,
        errorMessage,
      });
    }

    return {
      ok: false,
      status: "failed",
      counts: {
        coachChats: 0,
        sent: 0,
        failed: 0,
        urgent: 0,
        today: 0,
        observe: 0,
        fyi: 0,
      },
      errorMessage,
    };
  }

  try {
    const snapshotStartedAtMs = Date.now();
    const snapshot = await getTrainingPeaksAttentionSnapshot();
    const snapshotDurationMs = Date.now() - snapshotStartedAtMs;

    const formatStartedAtMs = Date.now();
    const messages = buildTrainingPeaksAttentionDigestMessages(
      snapshot,
      TRAININGPEAKS_ATTENTION_DIGEST_TITLE
    );
    const formatDurationMs = Date.now() - formatStartedAtMs;

    const sendStartedAtMs = Date.now();
    const results = await Promise.allSettled(
      coachChatIds.map(async (chatId) => {
        for (const [chunkIndex, message] of messages.entries()) {
          try {
            await sendTelegramMessageStrict(chatId, message);
          } catch (error) {
            console.error("TrainingPeaks attention digest chunk send failed", {
              chatId,
              chunkIndex,
              chunkCount: messages.length,
              chunkLength: message.length,
              error: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        }
      })
    );
    const sendDurationMs = Date.now() - sendStartedAtMs;
    const totalDurationMs = Date.now() - startedAtMs;

    console.info("TrainingPeaks attention digest timing", {
      snapshotDurationMs,
      formatDurationMs,
      sendDurationMs,
      totalDurationMs,
      chunkCount: messages.length,
      coachChatCount: coachChatIds.length,
      timeoutRiskLikely: totalDurationMs >= 50_000,
    });

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

    return {
      ok,
      status: ok ? "sent" : "partial_failure",
      counts,
      errorMessage: ok ? undefined : `partial_failure: sent=${sentCount}, failed=${failedCount}`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("TrainingPeaks attention digest failed", error);
    if (runLogId) {
      await finishCronRunLogSafely(runLogId, {
        startedAtMs,
        status: "failed",
        responseStatus: 500,
        errorMessage,
      });
    }

    return {
      ok: false,
      status: "failed",
      counts: {
        coachChats: coachChatIds.length,
        sent: 0,
        failed: coachChatIds.length,
        urgent: 0,
        today: 0,
        observe: 0,
        fyi: 0,
      },
      errorMessage,
    };
  }
}
