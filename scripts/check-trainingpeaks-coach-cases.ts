import process from "node:process";

import { createSupabaseServerClient } from "@/features/supabase/server";

const RAW_TEXT_LIKE_FIELDS = new Set([
  "raw_text",
  "message_text",
  "text",
  "body",
  "content",
  "prompt",
  "raw_payload",
]);

type CoachCaseSampleRow = {
  id: string;
  case_kind: string;
  status: string;
  created_at: string;
};

type SnapshotSampleRow = {
  id: string;
  student_id: string | null;
  cache_status: string;
  created_at: string;
};

function getEnvValue(name: "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function assertNoRawTextLikeFields(rows: Array<Record<string, unknown>>): void {
  const selectedKeys = new Set<string>([
    "id",
    "case_kind",
    "status",
    "created_at",
    "student_id",
    "cache_status",
  ]);

  for (const row of rows) {
    for (const key of Object.keys(row)) {
      selectedKeys.add(key);
    }
  }

  for (const key of selectedKeys) {
    if (RAW_TEXT_LIKE_FIELDS.has(key)) {
      throw new Error(`[check-coach-cases] FAIL: raw text-like field selected: ${key}`);
    }
  }
}

function printCoachCaseSample(rows: CoachCaseSampleRow[]): void {
  for (const row of rows) {
    console.log(
      `[check-coach-cases] case_sample=${JSON.stringify({
        id: row.id,
        case_kind: row.case_kind,
        status: row.status,
        created_at: row.created_at,
      })}`
    );
  }
}

function printSnapshotSample(rows: SnapshotSampleRow[]): void {
  for (const row of rows) {
    console.log(
      `[check-coach-cases] snapshot_sample=${JSON.stringify({
        id: row.id,
        cache_status: row.cache_status,
        created_at: row.created_at,
      })}`
    );
  }
}

async function run(): Promise<void> {
  const supabaseUrl = getEnvValue("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = getEnvValue("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    console.log("[check-coach-cases] SKIP: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return;
  }

  if (process.env.SUPABASE_URL == null) {
    process.env.SUPABASE_URL = supabaseUrl;
  }

  const supabase = createSupabaseServerClient();

  const [
    coachCasesSampleResult,
    snapshotsSampleResult,
    coachCasesCountResult,
    snapshotsCountResult,
  ] = await Promise.all([
    supabase
      .from("trainingpeaks_coach_cases")
      .select("id, case_kind, status, created_at")
      .limit(5),
    supabase
      .from("trainingpeaks_student_context_snapshots")
      .select("id, student_id, cache_status, created_at")
      .limit(5),
    supabase
      .from("trainingpeaks_coach_cases")
      .select("*", { count: "exact", head: true }),
    supabase
      .from("trainingpeaks_student_context_snapshots")
      .select("*", { count: "exact", head: true }),
  ]);

  if (coachCasesSampleResult.error) {
    throw new Error(coachCasesSampleResult.error.message);
  }
  if (snapshotsSampleResult.error) {
    throw new Error(snapshotsSampleResult.error.message);
  }
  if (coachCasesCountResult.error) {
    throw new Error(coachCasesCountResult.error.message);
  }
  if (snapshotsCountResult.error) {
    throw new Error(snapshotsCountResult.error.message);
  }

  const coachCasesSample = (coachCasesSampleResult.data ?? []) as CoachCaseSampleRow[];
  const snapshotsSample = (snapshotsSampleResult.data ?? []) as SnapshotSampleRow[];

  assertNoRawTextLikeFields(coachCasesSample as Array<Record<string, unknown>>);
  assertNoRawTextLikeFields(snapshotsSample as Array<Record<string, unknown>>);

  console.log(`[check-coach-cases] cases_total=${coachCasesCountResult.count ?? 0}`);
  console.log(`[check-coach-cases] snapshots_total=${snapshotsCountResult.count ?? 0}`);

  if (coachCasesSample.length > 0) {
    printCoachCaseSample(coachCasesSample);
  }

  if (snapshotsSample.length > 0) {
    printSnapshotSample(snapshotsSample);
  }

  console.log("[check-coach-cases] PASS");
}

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(message === "[check-coach-cases] FAIL" ? message : "[check-coach-cases] FAIL");
  if (message !== "[check-coach-cases] FAIL") {
    console.error(message);
  }
  process.exit(1);
});
