import process from "node:process";

import { countTrainingPeaksSilentStudents, listTrainingPeaksStudentContactStatus } from "@/features/trainingpeaks/repository";

async function run(): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.log("[check-trainingpeaks-contact-status] SKIP");
    console.log("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    console.log("Apply the new migration, then rerun with service-role env loaded.");
    return;
  }

  const rows = await listTrainingPeaksStudentContactStatus();
  const silentFivePlus = await countTrainingPeaksSilentStudents({
    minimumSilenceDays: 5,
  });

  console.log("[check-trainingpeaks-contact-status] OK");
  console.log(`status_rows=${rows.length}`);
  console.log(`silent_5_plus=${silentFivePlus}`);
  if (rows[0]) {
    console.log(
      JSON.stringify(
        {
          sample_student_id: rows[0].studentId,
          sample_silence_days: rows[0].silenceDays,
          sample_last_coach_touch_at: rows[0].lastCoachTouchAt,
          sample_unanswered_seconds: rows[0].unansweredSeconds,
        },
        null,
        2
      )
    );
  }
}

void run().catch((error) => {
  console.error("[check-trainingpeaks-contact-status] FAIL");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
