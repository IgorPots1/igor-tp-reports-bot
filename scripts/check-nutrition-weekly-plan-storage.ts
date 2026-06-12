import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const autosendOnly = args.has("--no-autosend");
const tpMutationOnly = args.has("--no-tp-mutation");
const runStorageChecks = !autosendOnly && !tpMutationOnly;
const runNoAutosendChecks = autosendOnly || (!autosendOnly && !tpMutationOnly);
const runNoTpMutationChecks = tpMutationOnly || (!autosendOnly && !tpMutationOnly);

const migrationDir = join(root, "supabase/migrations");
const migrationFile = readdirSync(migrationDir)
  .filter((name) => name.endsWith("_create_nutrition_weekly_plans.sql"))
  .sort()
  .at(-1);

assert.ok(migrationFile, "nutrition_weekly_plans migration file must exist");
const migrationPath = join(migrationDir, migrationFile);
const sql = readFileSync(migrationPath, "utf8");
const repositoryPath = join(root, "src/features/nutrition/repository.ts");
const repositorySource = readFileSync(repositoryPath, "utf8");

if (runStorageChecks) {
  assert.match(sql, /create table if not exists public\.nutrition_weekly_plans/i, "migration must create nutrition_weekly_plans");

  const requiredColumns = [
    "id",
    "student_id",
    "source_report_id",
    "source_analysis_id",
    "plan_week_from",
    "plan_week_to",
    "status",
    "generation_mode",
    "prompt_version",
    "ai_model",
    "coach_summary",
    "athlete_message_draft",
    "coach_edited_draft",
    "approved_at",
    "plan_summary",
    "training_context_snapshot",
    "nutrition_context_snapshot",
    "safety_flags",
    "superseded_by_plan_id",
    "created_at",
    "updated_at",
  ];
  for (const column of requiredColumns) {
    assert.match(
      sql,
      new RegExp(`\\b${column}\\b`, "i"),
      `nutrition_weekly_plans migration must include column ${column}`
    );
  }

  const requiredStatuses = [
    "draft_generated",
    "blocked_safety",
    "needs_review",
    "approved_for_copy",
    "archived",
    "superseded",
  ];
  for (const status of requiredStatuses) {
    assert.match(sql, new RegExp(`'${status}'`), `status check must include ${status}`);
  }

  for (const mode of ["ai", "fallback"]) {
    assert.match(sql, new RegExp(`'${mode}'`), `generation_mode check must include ${mode}`);
  }

  const requiredIndexes = [
    "nutrition_weekly_plans_student_plan_week_idx",
    "nutrition_weekly_plans_source_analysis_idx",
    "nutrition_weekly_plans_status_plan_week_idx",
    "nutrition_weekly_plans_student_created_idx",
  ];
  for (const indexName of requiredIndexes) {
    assert.match(sql, new RegExp(indexName, "i"), `migration must create index ${indexName}`);
  }

  assert.doesNotMatch(
    sql,
    /unique[\s\S]*\(student_id,\s*plan_week_from,\s*plan_week_to\)/i,
    "nutrition_weekly_plans must not enforce unique(student_id, plan_week_from, plan_week_to)"
  );
  assert.doesNotMatch(
    sql,
    /nutrition_weekly_plans_student_plan_week_uidx/i,
    "nutrition_weekly_plans must not add a student/week unique index"
  );

  assert.match(
    sql,
    /student_id uuid not null references public\.trainingpeaks_students\(id\)/i,
    "nutrition_weekly_plans must reference trainingpeaks_students(id)"
  );
  assert.match(sql, /set_nutrition_updated_at/i, "migration must reuse set_nutrition_updated_at trigger function");
  assert.match(
    sql,
    /set_nutrition_weekly_plans_updated_at[\s\S]*execute function public\.set_nutrition_updated_at\(\)/i,
    "nutrition_weekly_plans must have updated_at trigger"
  );
  assert.match(
    sql,
    /revoke all on table public\.nutrition_weekly_plans from anon, authenticated, public/i,
    "nutrition_weekly_plans must revoke anon/authenticated/public access"
  );
  assert.match(
    sql,
    /grant select, insert, update, delete on table public\.nutrition_weekly_plans to service_role/i,
    "nutrition_weekly_plans must grant service_role access"
  );
  assert.match(
    sql,
    /alter table public\.nutrition_weekly_plans enable row level security/i,
    "nutrition_weekly_plans must enable row level security"
  );

  const requiredExports = [
    "createNutritionWeeklyPlan",
    "getNutritionWeeklyPlanById",
    "listNutritionWeeklyPlansForStudentWeek",
    "getLatestNutritionWeeklyPlanForStudentWeek",
    "markNutritionWeeklyPlansSuperseded",
  ];
  for (const exportName of requiredExports) {
    assert.match(
      repositorySource,
      new RegExp(`export async function ${exportName}\\(`),
      `repository must export ${exportName}`
    );
  }

  assert.match(
    repositorySource,
    /\.from\("nutrition_weekly_plans"\)/,
    "repository must query nutrition_weekly_plans table"
  );
  assert.match(
    repositorySource,
    /status:\s*"superseded"/,
    "markNutritionWeeklyPlansSuperseded must set status superseded"
  );
  assert.match(
    repositorySource,
    /superseded_by_plan_id:\s*params\.supersededByPlanId/,
    "markNutritionWeeklyPlansSuperseded must set superseded_by_plan_id"
  );
}

const planStorageFiles = [
  repositoryPath,
  join(root, "scripts/audit-nutrition-interpretation-shadow.ts"),
  join(root, "scripts/diagnose-nutrition-interpretation-shadow-case.ts"),
  join(root, "src/features/nutrition/interpretation-audit.ts"),
];

const telegramForbiddenPatterns = [
  /sendTrainingPeaksWeeklyReportToStudent/,
  /sendTrainingPeaksReplyDraftToStudent/,
  /sendTrainingPeaksAdminStudentTelegramTestMessage/,
  /telegram\.send/i,
  /bot\.send/i,
  /sendTelegram/i,
  /sendMessageToStudent/i,
];

const tpMutationForbiddenPatterns = [
  /executeTrainingPeaks/i,
  /mutateTrainingPeaks/i,
  /writeTrainingPeaks/i,
  /createTrainingPeaksWorkout/i,
  /updateTrainingPeaksWorkout/i,
  /deleteTrainingPeaksWorkout/i,
  /moveTrainingPeaksWorkout/i,
  /applyTrainingPeaks/i,
  /trainingpeaks-export\/scripts\/lib\/strength-workout-field-writer/,
  /from\("trainingpeaks_workouts"\)\.(insert|update|upsert|delete)/i,
];

if (runNoAutosendChecks) {
  for (const file of planStorageFiles) {
    const body = readFileSync(file, "utf8");
    for (const forbidden of telegramForbiddenPatterns) {
      assert.doesNotMatch(body, forbidden, `${file} must not introduce Telegram autosend paths`);
    }
  }
}

if (runNoTpMutationChecks) {
  for (const file of planStorageFiles) {
    const body = readFileSync(file, "utf8");
    for (const forbidden of tpMutationForbiddenPatterns) {
      assert.doesNotMatch(body, forbidden, `${file} must not introduce TrainingPeaks mutation paths`);
    }
  }
}

if (autosendOnly) {
  console.log("PASS check-nutrition-weekly-plan-no-autosend");
} else if (tpMutationOnly) {
  console.log("PASS check-nutrition-weekly-plan-no-tp-mutation");
} else {
  console.log("PASS check-nutrition-weekly-plan-storage");
}
