// Cowork worker — claim a batch. The skill calls this, generates a draft per job
// from the returned prompt (on the subscription), then posts each back to /submit.
// Bearer FEEDBACK_WORKER_SECRET. Returns voice-only prompts (no student PII).

import { claimFeedbackWorkerBatch, verifyFeedbackWorkerRequest } from "@/features/trainingpeaks/feedback/feedback-worker";
import { PreviewEnvironmentBlockedError, assertNotPreviewEnvironment } from "@/lib/environment-guard";

export const runtime = "nodejs";

const jsonHeaders = { "Content-Type": "application/json" };
function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

export async function POST(request: Request): Promise<Response> {
  const auth = verifyFeedbackWorkerRequest(request);
  if (!auth.ok) return jsonResponse(auth.status, { ok: false, error: auth.error });

  // A stale Preview deploy shares the real DB env — never let it claim/mutate the queue.
  try {
    assertNotPreviewEnvironment("feedback worker claim");
  } catch (error) {
    if (error instanceof PreviewEnvironmentBlockedError) return jsonResponse(403, { ok: false, error: error.message });
    throw error;
  }

  let limit: number | undefined;
  try {
    const body = (await request.json().catch(() => ({}))) as { limit?: unknown };
    if (typeof body.limit === "number") limit = body.limit;
  } catch {
    return jsonResponse(400, { ok: false, error: "invalid body" });
  }

  try {
    const result = await claimFeedbackWorkerBatch({ limit });
    return jsonResponse(200, { ok: true, ...result });
  } catch (error) {
    console.error("[feedback.worker.claim] failed", { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse(500, { ok: false, error: "claim failed" });
  }
}
