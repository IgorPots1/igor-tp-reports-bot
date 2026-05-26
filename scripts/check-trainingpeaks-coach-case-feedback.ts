import process from "node:process";

import { createSupabaseServerClient } from "@/features/supabase/server";
import type { TrainingPeaksCoachCaseStatus } from "@/features/trainingpeaks/repository";

const LOG_PREFIX = "[check-trainingpeaks-coach-case-feedback]";
const ACTIVE_STATUSES: readonly TrainingPeaksCoachCaseStatus[] = ["logged", "open", "needs_review"];

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
    .from("trainingpeaks_coach_cases")
    .select("id, case_kind, status, created_at, trainingpeaks_students(student_name)")
    .in("status", [...ACTIVE_STATUSES])
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    throw new Error(`${LOG_PREFIX} FAIL: ${error.message}`);
  }

  const rows =
    (data as Array<{
      id: string;
      case_kind: string;
      status: string;
      created_at: string;
      trainingpeaks_students?: { student_name?: string | null } | Array<{ student_name?: string | null }> | null;
    }>) ?? [];

  if (rows.length === 0) {
    console.log(`${LOG_PREFIX} OK: no active cases`);
    return;
  }

  console.log(`${LOG_PREFIX} recent_active_cases=${rows.length}`);
  for (const row of rows) {
    const joinedStudent = Array.isArray(row.trainingpeaks_students)
      ? row.trainingpeaks_students[0]
      : row.trainingpeaks_students;
    console.log(
      `${LOG_PREFIX} case=${row.id.slice(0, 8)} student=${JSON.stringify(
        joinedStudent?.student_name?.trim() || "—"
      )} kind=${row.case_kind} status=${row.status} created_at=${row.created_at}`
    );
  }
}

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.startsWith(`${LOG_PREFIX} FAIL:`) ? message : `${LOG_PREFIX} FAIL: ${message}`);
  process.exit(1);
});
