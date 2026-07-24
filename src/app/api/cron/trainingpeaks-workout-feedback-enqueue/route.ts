// Enqueue cron for the feedback bridge (мост, часть 1). Polls
// derived_metrics.updated_at > the last successful run and enqueues a feedback
// job per new/recomputed workout. Auth + cron-run-log mirror
// trainingpeaks-stale-job-sweeper.
//
// ENQUEUE-ONLY: fills the «Новые» list, never generates (generation is Igor's Mini App
// tap — Вариант Б). NOT scheduled on Vercel anymore: the same logic runs on the Mac right
// after fit-ingest (tools/.../tp-feedback-enqueue-run.ts, driven by run-fit-ingest-scan.sh),
// so there are ZERO Vercel crons for feedback (no Pro needed). This HTTP route is kept as a
// manual/backup trigger (Bearer CRON_SECRET). Needs migration 20260722180000 applied.

import { timingSafeEqual } from "node:crypto";

import { createTrainingPeaksCronRunLog, finishTrainingPeaksCronRunLog, getLatestTrainingPeaksCronRunLog } from "@/features/trainingpeaks/repository";
import { sweepAndEnqueueFeedbackJobs } from "@/features/trainingpeaks/feedback/feedback-enqueue";

export const runtime = "nodejs";

const CRON_JOB_NAME = "workout_feedback_enqueue";
// First-run / no-prior-log window: look back this far so a manual first run has
// something to enqueue instead of an empty scan.
const DEFAULT_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;

const jsonHeaders = { "Content-Type": "application/json" };
function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function safeEqual(left: string, right: string): boolean {
  const l = Buffer.from(left);
  const r = Buffer.from(right);
  if (l.length !== r.length) return false;
  return timingSafeEqual(l, r);
}

function getBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;
  const [scheme, token] = authorization.split(/\s+/, 2);
  if (scheme !== "Bearer" || !token?.trim()) return null;
  return token.trim();
}

function cronSecret(): string {
  return process.env.CRON_SECRET?.trim() ?? "";
}

async function handle(request: Request): Promise<Response> {
  const secret = cronSecret();
  if (!secret) return jsonResponse(500, { ok: false, error: "CRON_SECRET not configured" });
  const token = getBearerToken(request);
  if (!token || !safeEqual(token, secret)) return jsonResponse(401, { ok: false, error: "unauthorized" });

  const startedAtMs = Date.now();
  const runLog = await createTrainingPeaksCronRunLog({
    jobName: CRON_JOB_NAME,
    source: "manual",
    status: "started",
    httpMethod: request.method,
    userAgent: request.headers.get("user-agent") ?? undefined,
    requestPath: new URL(request.url).pathname,
  });

  try {
    const lastOk = await getLatestTrainingPeaksCronRunLog({ jobName: CRON_JOB_NAME, status: "sent" });
    const sinceUpdatedAt = lastOk?.startedAt ?? new Date(startedAtMs - DEFAULT_LOOKBACK_MS).toISOString();

    const summary = await sweepAndEnqueueFeedbackJobs({ sinceUpdatedAt });

    await finishTrainingPeaksCronRunLog(runLog.id, {
      status: "sent",
      durationMs: Date.now() - startedAtMs,
      responseStatus: 200,
      counts: { ...summary, sinceUpdatedAt },
    });
    return jsonResponse(200, { ok: true, ...summary, sinceUpdatedAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishTrainingPeaksCronRunLog(runLog.id, {
      status: "failed",
      durationMs: Date.now() - startedAtMs,
      responseStatus: 500,
      errorMessage: message,
    });
    return jsonResponse(500, { ok: false, error: message });
  }
}

export async function GET(request: Request): Promise<Response> {
  return handle(request);
}

export async function POST(request: Request): Promise<Response> {
  return handle(request);
}
