import { createSupabaseServerClient } from "@/features/supabase/server";

export type AiCallSite = "memory" | "intent" | "parser";

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
