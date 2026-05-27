import process from "node:process";

import { createSupabaseServerClient } from "@/features/supabase/server";

const LOG_PREFIX = "[check-trainingpeaks-reply-draft-feedback]";

function getEnvValue(name: "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

async function run(): Promise<void> {
  const supabaseUrl = getEnvValue("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = getEnvValue("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.log(`${LOG_PREFIX} SKIP: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY`);
    return;
  }

  if (!process.env.SUPABASE_URL) {
    process.env.SUPABASE_URL = supabaseUrl;
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_reply_drafts")
    .select("id, student_id, outcome, source, ai_model, draft_preview, created_at")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    throw new Error(`${LOG_PREFIX} FAIL: ${error.message}`);
  }

  const rows =
    (data as Array<{
      id: string;
      student_id: string;
      outcome: string;
      source: string;
      ai_model: string;
      draft_preview: string | null;
      created_at: string;
    }>) ?? [];

  console.log(`${LOG_PREFIX} rows=${rows.length}`);
  for (const row of rows) {
    console.log(
      `${LOG_PREFIX} id=${row.id.slice(0, 8)} student_id=${row.student_id.slice(0, 8)} outcome=${row.outcome} source=${row.source} ai_model=${JSON.stringify(row.ai_model)} draft_preview=${JSON.stringify(row.draft_preview)} created_at=${row.created_at}`
    );
  }
}

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.startsWith(`${LOG_PREFIX} FAIL:`) ? message : `${LOG_PREFIX} FAIL: ${message}`);
  process.exit(1);
});
