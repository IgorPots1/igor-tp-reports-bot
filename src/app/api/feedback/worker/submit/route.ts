// Cowork worker — submit one generated draft. Routes THROUGH submitFeedbackDraft
// (the shared seam: fact-check → write), so a Cowork draft can never bypass the
// fact-check. Bearer FEEDBACK_WORKER_SECRET. backend is hard-coded "cowork" for
// traceability across the FEEDBACK_GENERATOR switch.

import { submitFeedbackDraft } from "@/features/trainingpeaks/feedback/feedback-queue";
import { verifyFeedbackWorkerRequest } from "@/features/trainingpeaks/feedback/feedback-worker";
import { PreviewEnvironmentBlockedError, assertNotPreviewEnvironment } from "@/lib/environment-guard";

export const runtime = "nodejs";

const MAX_DRAFT_LEN = 4000;

const jsonHeaders = { "Content-Type": "application/json" };
function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

export async function POST(request: Request): Promise<Response> {
  const auth = verifyFeedbackWorkerRequest(request);
  if (!auth.ok) return jsonResponse(auth.status, { ok: false, error: auth.error });

  // A stale Preview deploy shares the real DB env — never let it write a draft.
  try {
    assertNotPreviewEnvironment("feedback worker submit");
  } catch (error) {
    if (error instanceof PreviewEnvironmentBlockedError) return jsonResponse(403, { ok: false, error: error.message });
    throw error;
  }

  let jobId = "";
  let draftText = "";
  try {
    const body = (await request.json()) as { jobId?: unknown; draftText?: unknown };
    jobId = typeof body.jobId === "string" ? body.jobId : "";
    draftText = typeof body.draftText === "string" ? body.draftText : "";
  } catch {
    return jsonResponse(400, { ok: false, error: "invalid body" });
  }

  const trimmed = draftText.trim();
  if (!jobId || !trimmed) return jsonResponse(400, { ok: false, error: "jobId и draftText обязательны" });
  if (trimmed.length > MAX_DRAFT_LEN) return jsonResponse(400, { ok: false, error: "draft too long" });

  try {
    // The fact-check lives inside submitFeedbackDraft — a number not in the packet or a
    // wrong-gender verb → status 'failed', NOT written as a sendable draft.
    const result = await submitFeedbackDraft({ jobId, draftText: trimmed, backend: "cowork" });
    return jsonResponse(200, { ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // "job not found" is a client-side id error → 404; everything else is a 500.
    const status = /not found/i.test(message) ? 404 : 500;
    console.error("[feedback.worker.submit] failed", { jobId, error: message });
    return jsonResponse(status, { ok: false, error: status === 404 ? "job not found" : "submit failed" });
  }
}
