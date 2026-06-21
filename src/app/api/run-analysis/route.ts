import {
  ADMIN_ACCESS_COOKIE_NAME,
  hasValidAdminAccessCookie,
} from "@/lib/admin-auth";
import { generateRunAnalysis } from "@/features/run-analysis/llm/adapter";
import type { RunAnalysisApiPayload } from "@/features/run-analysis/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BODY_BYTES = 64 * 1024; // 64 KB — metrics JSON only, never video

function getAdminCookieFromRequest(request: Request): string | undefined {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return undefined;
  const match = cookieHeader
    .split(";")
    .find((c) => c.trim().startsWith(`${ADMIN_ACCESS_COOKIE_NAME}=`));
  return match?.split("=").slice(1).join("=").trim();
}

// Auth bypass is allowed ONLY in local development. Vercel sets
// NODE_ENV=production for BOTH preview and production deployments, so a valid
// admin cookie is always required there — independent of whether a token is set.
function isLocalDevBypass(): boolean {
  return process.env.NODE_ENV === "development";
}

function isAdminRequest(request: Request): boolean {
  if (isLocalDevBypass()) return true;
  return hasValidAdminAccessCookie(getAdminCookieFromRequest(request));
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isValidPayload(v: unknown): v is RunAnalysisApiPayload {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  if (!p.runner_profile || typeof p.runner_profile !== "object") return false;
  if (!p.computed_metrics || typeof p.computed_metrics !== "object") return false;
  return true;
}

export async function POST(request: Request): Promise<Response> {
  if (!isAdminRequest(request)) {
    return jsonResponse(401, { error: "unauthorized" });
  }

  // Basic size guard — no video should ever reach this endpoint
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) {
    return jsonResponse(413, { error: "payload_too_large" });
  }

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      return jsonResponse(413, { error: "payload_too_large" });
    }
    body = JSON.parse(text);
  } catch {
    return jsonResponse(400, { error: "invalid_json" });
  }

  if (!isValidPayload(body)) {
    return jsonResponse(400, { error: "invalid_payload" });
  }

  const result = await generateRunAnalysis(body);

  if (!result.ok) {
    return jsonResponse(502, { error: "llm_failed", detail: result.error });
  }

  return jsonResponse(200, {
    report: result.report,
    provider: result.provider,
    model: result.model,
  });
}
