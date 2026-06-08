import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const migrationsDir = join(process.cwd(), "supabase/migrations");
const repositoryPath = join(process.cwd(), "src/features/nutrition/repository.ts");

const nutritionMigrationSql = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql") && name.includes("nutrition"))
  .sort()
  .map((name) => readFileSync(join(migrationsDir, name), "utf8"))
  .join("\n");

const repositorySource = readFileSync(repositoryPath, "utf8");

const onConflictMatch = repositorySource.match(
  /\.from\("nutrition_daily_macros"\)[\s\S]*?\.upsert\([^,]+,\s*\{\s*onConflict:\s*"([^"]+)"\s*\}\)/
);
assert.ok(onConflictMatch, "insertNutritionDailyMacros must upsert nutrition_daily_macros with onConflict");
const onConflict = onConflictMatch[1];
assert.equal(onConflict, "report_id,day", "daily macros upsert must conflict on report_id,day scope");

assert.doesNotMatch(
  repositorySource,
  /\.from\("nutrition_daily_macros"\)[\s\S]*?onConflict:\s*"student_id,day"/,
  "daily macros must not upsert on student_id,day (reports are versioned per report_id)"
);

assert.match(
  nutritionMigrationSql,
  /create unique index if not exists nutrition_daily_macros_report_day_uidx\s+on public\.nutrition_daily_macros \(report_id, day\)/,
  "nutrition migrations must define unique index on (report_id, day) for upsert"
);

assert.match(
  nutritionMigrationSql,
  /drop index if exists public\.nutrition_daily_macros_report_day_uidx/,
  "fix migration must replace partial index with full unique index"
);

const fullIndexCount = (
  nutritionMigrationSql.match(
    /create unique index if not exists nutrition_daily_macros_report_day_uidx\s+on public\.nutrition_daily_macros \(report_id, day\);/g
  ) ?? []
).length;
assert.ok(fullIndexCount >= 1, "expected at least one full unique index definition after migrations apply");

const partialIndexCount = (
  nutritionMigrationSql.match(
    /nutrition_daily_macros_report_day_uidx[\s\S]*?where report_id is not null/gi
  ) ?? []
).length;
const dropIndexCount = (
  nutritionMigrationSql.match(/drop index if exists public\.nutrition_daily_macros_report_day_uidx/g) ?? []
).length;
assert.ok(
  dropIndexCount >= partialIndexCount,
  "partial nutrition_daily_macros_report_day_uidx must be dropped before upsert-safe index is used"
);

assert.match(
  nutritionMigrationSql,
  /create table if not exists public\.nutrition_daily_macros[\s\S]*report_id uuid references public\.nutrition_reports\(id\)/,
  "nutrition_daily_macros must scope rows to nutrition_reports via report_id"
);

assert.match(
  nutritionMigrationSql,
  /create table if not exists public\.nutrition_daily_macros[\s\S]*\bday date not null/,
  "nutrition_daily_macros day column must exist for report-scoped uniqueness"
);

assert.doesNotMatch(
  nutritionMigrationSql,
  /unique\s*\(\s*student_id\s*,\s*day\s*\)/i,
  "must not add student_id+day uniqueness (same student may have multiple reports for the same week)"
);

console.log("PASS check-nutrition-daily-macros-upsert");
