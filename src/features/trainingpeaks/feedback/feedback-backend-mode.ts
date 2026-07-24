// DB-backed resolution of the ACTIVE generator backend (api|cowork). Kept separate from
// feedback-generator.ts so that module stays pure (env-only, unit-testable) — this one
// touches the DB (app_runtime_flags), so it lives where a DB dependency is expected.
//
// Igor flips this from the Mini App toggle without a redeploy: DB flag first, env second.

import { getRuntimeFlag } from "@/features/trainingpeaks/feedback/app-runtime-flags";
import { resolveFeedbackGeneratorBackend, type FeedbackGeneratorBackend } from "@/features/trainingpeaks/feedback/feedback-generator";

/** Runtime-flag key for the DB-backed backend toggle (Mini App, coach-only). */
export const FEEDBACK_BACKEND_FLAG_KEY = "feedback_generator_backend";

/**
 * The ACTIVE backend: DB flag first (Igor's Mini App toggle), env default second. An
 * unset/garbage flag falls back to env. One cheap single-row read — call once per request,
 * not per job. A DB blip degrades to the env default rather than blocking generation.
 */
export async function getActiveFeedbackGeneratorBackend(): Promise<FeedbackGeneratorBackend> {
  let flag: string | null = null;
  try {
    flag = await getRuntimeFlag(FEEDBACK_BACKEND_FLAG_KEY);
  } catch {
    flag = null;
  }
  const normalized = flag?.trim().toLowerCase();
  if (normalized === "api") return "api";
  if (normalized === "cowork") return "cowork";
  return resolveFeedbackGeneratorBackend();
}
