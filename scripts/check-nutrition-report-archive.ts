import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Task 2: reversible (soft) archive for reports + weekly analyses. Active reads
// exclude archived; the history screen includes them; regeneration revives;
// approved patterns (nutrition_memory) are never touched by archiving.

const root = process.cwd();
const repo = readFileSync(join(root, "src/features/nutrition/repository.ts"), "utf8");
const actions = readFileSync(join(root, "src/app/admin/coach-os/nutrition/actions.ts"), "utf8");
const page = readFileSync(join(root, "src/app/admin/coach-os/nutrition/[studentId]/page.tsx"), "utf8");
const migration = readFileSync(join(root, "supabase/migrations/20260616120000_add_nutrition_archived_at.sql"), "utf8");
const packageJson = readFileSync(join(root, "package.json"), "utf8");

// --- 1. Migration adds archived_at to both tables -----------------------------
assert.match(migration, /nutrition_reports[\s\S]*add column if not exists archived_at timestamptz/, "migration adds reports.archived_at");
assert.match(migration, /nutrition_weekly_analyses[\s\S]*add column if not exists archived_at timestamptz/, "migration adds analyses.archived_at");

// --- 2. Active reads exclude archived -----------------------------------------
// getLatestReportsByStudent + getLatestAnalysesByStudent + getForWeek + recent
const filterCount = (repo.match(/\.is\("archived_at", null\)/g) ?? []).length;
assert.ok(filterCount >= 4, `active read queries must filter archived (found ${filterCount} archived_at filters, expected >= 4)`);
assert.match(repo, /getNutritionWeeklyAnalysisForWeek[\s\S]*\.is\("archived_at", null\)[\s\S]*maybeSingle/, "getForWeek excludes archived");
assert.match(repo, /listRecentNutritionWeeklyAnalysesForStudent[\s\S]*\.is\("archived_at", null\)/, "memory/previous-week list excludes archived");

// --- 3. History list opts INTO archived; regeneration revives -----------------
assert.match(repo, /includeArchived/, "listNutritionReportsForStudent must support includeArchived");
assert.match(repo, /export async function listNutritionWeeklyAnalysesForStudentHistory/, "history list for analyses exists");
assert.match(repo, /onConflict: "student_id,week_from,week_to"[\s\S]*/, "analysis upsert keyed by week");
assert.match(repo, /archived_at: null,[\s\S]*onConflict: "student_id,week_from,week_to"/, "regeneration revives (archived_at: null on upsert)");

// --- 4. Archive/restore functions exist and are reversible --------------------
assert.match(repo, /export async function setNutritionReportArchived\(reportId: string, archived: boolean\)/, "report archive fn");
assert.match(repo, /export async function setNutritionWeeklyAnalysisArchived\(analysisId: string, archived: boolean\)/, "analysis archive fn");
assert.match(repo, /archived_at: archived \? new Date\(\)\.toISOString\(\) : null/, "archive toggles archived_at (reversible)");

// --- 5. Archive must NOT touch approved patterns (memory safety) --------------
const reportArchiveFn = repo.slice(repo.indexOf("export async function setNutritionReportArchived"), repo.indexOf("export async function setNutritionReportArchived") + 500);
const analysisArchiveFn = repo.slice(repo.indexOf("export async function setNutritionWeeklyAnalysisArchived"), repo.indexOf("export async function setNutritionWeeklyAnalysisArchived") + 500);
assert.doesNotMatch(reportArchiveFn, /nutrition_memory|approved_pattern/, "report archive must not touch memory");
assert.doesNotMatch(analysisArchiveFn, /nutrition_memory|approved_pattern/, "analysis archive must not touch memory");
// No hard delete in v1.
assert.doesNotMatch(reportArchiveFn + analysisArchiveFn, /\.delete\(\)/, "v1 archive must not hard-delete");

// --- 6. Actions + UI wired -----------------------------------------------------
assert.match(actions, /export async function archiveNutritionReportAction/, "report archive action");
assert.match(actions, /export async function archiveNutritionAnalysisAction/, "analysis archive action");
assert.match(page, /История отчётов и разборов/, "history section present on the student page");
assert.match(page, /ConfirmSubmitButton/, "archive uses a confirmation button");
assert.match(page, /includeArchived: true/, "history section loads archived rows too");

assert.match(packageJson, /check:nutrition-report-archive/, "package.json registers this check");

console.log("PASS check-nutrition-report-archive");
