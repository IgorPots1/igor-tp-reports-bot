import * as supabaseServerModule from "@/features/supabase/server";

// CJS/ESM boundary workaround: a plain named import of this file can
// intermittently lose named exports when first reached via a named import
// from Node's native TS stripping (order-dependent — see
// tools/trainingpeaks-export/scripts/tp-actions-once.ts for the established
// namespace + .default fallback pattern this mirrors).
type NamespaceWithOptionalDefault<T> = T & { default?: T };
const supabaseServerModuleCompat = supabaseServerModule as NamespaceWithOptionalDefault<typeof supabaseServerModule>;
const createSupabaseServerClient =
  supabaseServerModuleCompat.createSupabaseServerClient ?? supabaseServerModuleCompat.default?.createSupabaseServerClient;

if (typeof createSupabaseServerClient !== "function") {
  throw new Error("supabase/server.createSupabaseServerClient is unavailable.");
}

export type AiCallSite = "memory" | "intent" | "parser" | "feedback_factor";

export type AiCallLogInput = {
  callSite: AiCallSite;
  model: string;
  labels?: string[];
  shouldRemember?: boolean | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  telegramUpdateId?: number | null;
  messageId?: string | null;
  studentRef?: string | null;
};

/**
 * Fire-and-forget write to ai_call_logs. Never throws; errors go to console.warn only.
 * Call without await to avoid adding latency to the webhook path.
 */
export function logAiCall(input: AiCallLogInput): void {
  const supabase = createSupabaseServerClient();
  void Promise.resolve(
    supabase.from("ai_call_logs").insert({
      call_site: input.callSite,
      model: input.model,
      labels: input.labels ?? [],
      should_remember: input.shouldRemember ?? null,
      input_tokens: input.inputTokens ?? null,
      output_tokens: input.outputTokens ?? null,
      telegram_update_id: input.telegramUpdateId ?? null,
      message_id: input.messageId ?? null,
      student_ref: input.studentRef ?? null,
    })
  ).then(({ error }) => {
    if (error) {
      console.warn("ai_call_log insert failed", {
        event: "ai_call_log_insert_failed",
        call_site: input.callSite,
        error: error.message,
      });
    }
  }).catch((err: unknown) => {
    console.warn("ai_call_log unexpected error", {
      event: "ai_call_log_unexpected_error",
      call_site: input.callSite,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}
