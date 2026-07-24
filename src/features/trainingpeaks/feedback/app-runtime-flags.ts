// Tiny key/value store for runtime flags Igor flips WITHOUT a redeploy. Today it holds
// one key — the feedback generator backend (api|cowork) — so he can switch between the
// paid API and the Cowork subscription from the Mini App the moment a balance runs out,
// instead of editing a Vercel env and waiting for a redeploy.
//
// Deliberately NARROW. The dangerous switch — FEEDBACK_SEND_ENABLED (real Telegram
// delivery) — stays in env ON PURPOSE, so flipping "who writes the draft" (harmless:
// it never sends, never bills a student) is easy, while flipping "actually deliver to
// students" stays hard and auditable via a deploy. Do NOT move send/kill-switch here.
//
// service_role table (RLS, no anon/authenticated) — server-only, like the job queue.

import { createSupabaseServerClient, withSupabaseNetworkRetry } from "@/features/supabase/server";

const TABLE = "app_runtime_flags";

export async function getRuntimeFlag(key: string): Promise<string | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await withSupabaseNetworkRetry(() =>
    supabase.from(TABLE).select("value").eq("key", key).maybeSingle()
  );
  if (error) throw new Error(`get runtime flag ${key} failed: ${error.message}`);
  return (data as { value?: string } | null)?.value ?? null;
}

export async function setRuntimeFlag(input: { key: string; value: string; actorChatId: string }): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { error } = await withSupabaseNetworkRetry(() =>
    supabase
      .from(TABLE)
      .upsert({ key: input.key, value: input.value, updated_at: new Date().toISOString(), updated_by: input.actorChatId }, { onConflict: "key" })
  );
  if (error) throw new Error(`set runtime flag ${input.key} failed: ${error.message}`);
}
