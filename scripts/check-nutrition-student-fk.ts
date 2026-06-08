import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260608141000_create_nutrition_admin_phase1_tables.sql"
);
const sql = readFileSync(migrationPath, "utf8");

const requiredTables = [
  "nutrition_student_profiles",
  "nutrition_weight_logs",
  "nutrition_context_items",
  "nutrition_reports",
  "nutrition_daily_macros",
  "nutrition_weekly_analyses",
];

for (const table of requiredTables) {
  assert.match(
    sql,
    new RegExp(`create table if not exists public\\.${table}[\\s\\S]*student_id uuid[^\\n]*references public\\.trainingpeaks_students\\(id\\)`, "i"),
    `${table} must reference trainingpeaks_students(id)`
  );
}

assert.doesNotMatch(
  sql,
  /references public\.trainingpeaks_students\(student_id\)/i,
  "nutrition tables must not FK to trainingpeaks_students.student_id slug"
);

assert.doesNotMatch(
  sql,
  /trainingpeaks_athlete_id\s+uuid\s+references/i,
  "nutrition tables must not use trainingpeaks_athlete_id as canonical FK"
);

console.log("PASS check-nutrition-student-fk");
