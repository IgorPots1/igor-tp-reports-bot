// READ-ONLY diagnostic for schedule-expiry hardening. No writes. Lives under reports/.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createSupabaseServerClient } from "@/features/supabase/server";

function loadLocalEnvFiles(): void {
  const repoRoot = path.resolve(process.cwd());
  for (const envPath of [path.join(repoRoot, ".env.local"), path.join(repoRoot, ".env")]) {
    if (!fs.existsSync(envPath)) continue;
    for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const i = line.indexOf("=");
      if (i <= 0) continue;
      const key = line.slice(0, i).trim();
      if (!key || process.env[key] !== undefined) continue;
      let v = line.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[key] = v;
    }
  }
}

type SignalRow = {
  id: string;
  signal_type: string;
  status: string;
  valid_from: string | null;
  valid_until: string | null;
  source_observation_id: string | null;
  structured_payload: Record<string, unknown> | null;
  created_at: string;
};

const SIGNAL_IDS = [
  "2e9db013-d317-4d90-9ec1-f21284bd2ec6", // Lavrentyev "в среду"
  "85256508-e4ae-4b3a-887d-e41fdd0c54a6", // Denisova "вт/чт"
];

async function run(): Promise<void> {
  loadLocalEnvFiles();
  if (!process.env.SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_URL) {
    process.env.SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  }
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_student_operational_signals")
    .select("id, signal_type, status, valid_from, valid_until, source_observation_id, structured_payload, created_at")
    .in("id", SIGNAL_IDS);
  if (error) throw new Error(error.message);
  const rows = (data as SignalRow[] | null) ?? [];
  for (const row of rows) {
    console.log("=".repeat(70));
    console.log(`${row.id} | ${row.signal_type} | status=${row.status}`);
    console.log(`  valid_from=${row.valid_from} valid_until=${row.valid_until} created=${row.created_at}`);
    console.log(`  source_observation_id=${row.source_observation_id}`);
    console.log(`  structured_payload=${JSON.stringify(row.structured_payload, null, 2)}`);
    if (row.source_observation_id) {
      const obs = await supabase
        .from("trainingpeaks_telegram_context_observations")
        .select("text_preview, observed_at")
        .eq("id", row.source_observation_id)
        .maybeSingle();
      const o = obs.data as { text_preview: string | null; observed_at: string | null } | null;
      console.log(`  source_observed_at=${o?.observed_at ?? "?"}`);
      console.log(`  source_text=${o?.text_preview ?? "(none)"}`);
    }
  }
}
run().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
