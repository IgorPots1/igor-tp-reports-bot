// Pure, alias-free core of the Cowork worker: bearer auth + batch-limit clamp.
// Kept separate from feedback-worker.ts (which does DB I/O via @/ imports) so these
// — the security-relevant bits — are unit-testable under `node --experimental-strip-types`.

import { timingSafeEqual } from "node:crypto";

export const DEFAULT_WORKER_BATCH = 5; // manual x5 run: a handful per pass, well under subscription limits
export const MAX_WORKER_BATCH = 10;
export const STALE_GENERATING_TTL_MS = 15 * 60 * 1000; // a claimed job idle this long is treated as a crashed run

export function clampWorkerLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return DEFAULT_WORKER_BATCH;
  return Math.max(1, Math.min(MAX_WORKER_BATCH, Math.floor(limit)));
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

export type WorkerAuthResult = { ok: true } | { ok: false; status: number; error: string };

// Dedicated bearer secret, kept separate from CRON_SECRET so worker access and cron
// access never share a scope. Mirrors the cron routes' bearer check.
export function verifyFeedbackWorkerRequest(request: Request): WorkerAuthResult {
  const secret = process.env.FEEDBACK_WORKER_SECRET?.trim() ?? "";
  if (!secret) return { ok: false, status: 500, error: "FEEDBACK_WORKER_SECRET not configured" };
  const token = getBearerToken(request);
  if (!token || !safeEqual(token, secret)) return { ok: false, status: 401, error: "unauthorized" };
  return { ok: true };
}
