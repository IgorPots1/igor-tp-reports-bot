import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  detectNutritionRepeatingPatterns,
  buildNutritionLoadCarbsTrend,
  type NutritionWeekDaily,
} from "@/features/nutrition/pattern-detection";

// Task 7: per-student review memory — repeating patterns proposed for coach
// approval (draft->approve), approved history fed compactly into the prompt and
// voiced kindly ("повторяется N-ю неделю"); improvements noted positively;
// history numbers stay out of the per-day validator.

const root = process.cwd();
const draftSrc = readFileSync(join(root, "src/features/nutrition/draft-generator.ts"), "utf8");
const adminSrc = readFileSync(join(root, "src/features/nutrition/admin.ts"), "utf8");
const repoSrc = readFileSync(join(root, "src/features/nutrition/repository.ts"), "utf8");
const pageSrc = readFileSync(join(root, "src/app/admin/coach-os/nutrition/[studentId]/page.tsx"), "utf8");
const actionsSrc = readFileSync(join(root, "src/app/admin/coach-os/nutrition/actions.ts"), "utf8");
const packageJson = readFileSync(join(root, "package.json"), "utf8");

function week(weekFrom: string, findingsByDay: Array<{ type?: string; carbsG?: number; findings?: string[] }>): NutritionWeekDaily {
  return {
    weekFrom,
    days: findingsByDay.map((d, i) => ({
      date: `${weekFrom.slice(0, 8)}${String(Number(weekFrom.slice(8)) + i).padStart(2, "0")}`,
      training_type: d.type ?? "rest",
      flags: { hard: d.type === "intervals" || d.type === "tempo", longRun: d.type === "long_run" },
      actual: { carbsG: d.carbsG ?? null },
      findings: d.findings ?? [],
    })),
  };
}

// --- 1. Repeating finding across weeks becomes a candidate --------------------
const current = week("2026-06-15", [
  { type: "intervals", carbsG: 215, findings: ["low_carbs_for_load_type"] },
  { type: "long_run", carbsG: 180, findings: ["low_carbs_before_long_run"] },
]);
const prior = [
  week("2026-06-08", [{ type: "intervals", carbsG: 210, findings: ["low_carbs_for_load_type"] }]),
  week("2026-06-01", [{ type: "intervals", carbsG: 200, findings: ["low_carbs_for_load_type"] }]),
];
const candidates = detectNutritionRepeatingPatterns({ current, prior });
const lowCarb = candidates.find((c) => c.code === "low_carbs_for_load_type");
assert.ok(lowCarb, "repeating low-carb finding must be proposed");
assert.equal(lowCarb?.weeks_observed, 3, "weeks_observed counts current + prior");
assert.equal(lowCarb?.since_week, "2026-06-01", "since_week is the earliest observed week");
assert.match(lowCarb?.text ?? "", /углевод/i, "candidate text is athlete-meaningful");
// A finding only in the current week (not prior) is NOT yet a pattern.
assert.ok(
  !candidates.some((c) => c.code === "low_carbs_before_long_run"),
  "a finding seen only this week must not be proposed"
);

// --- 2. Already-approved patterns are not re-proposed -------------------------
const suppressed = detectNutritionRepeatingPatterns({
  current,
  prior,
  alreadyApprovedTexts: [lowCarb!.text],
});
assert.ok(
  !suppressed.some((c) => c.code === "low_carbs_for_load_type"),
  "approved pattern must not be re-proposed"
);

// --- 3. Non-curated / noise findings are ignored ------------------------------
const noise = detectNutritionRepeatingPatterns({
  current: week("2026-06-15", [{ type: "rest", findings: ["limited_training_context", "suspect_macro_values"] }]),
  prior: [week("2026-06-08", [{ type: "rest", findings: ["limited_training_context"] }])],
});
assert.equal(noise.length, 0, "non-curated findings must not become patterns");

// --- 4. Load-carbs trend string (compact, rounded) ----------------------------
const trend = buildNutritionLoadCarbsTrend({ current, prior });
assert.match(trend ?? "", /углеводы в нагрузочные дни: ~\d+(?:\/\d+)+ г за \d+ нед/, "trend must be compact oldest->newest");

// --- 5. Prompt: history fed + kind "N-я неделя" callout + numbers out of day_prose
assert.match(draftSrc, /history:\s*\{[\s\S]*approved_patterns/, "facts payload must include compact student history");
assert.match(draftSrc, /hasApprovedHistory/, "prompt must branch on whether approved history exists");
assert.match(draftSrc, /повторяется N-ю неделю[\s\S]*давай разберёмся/i, "kind repeating-pattern callout must be present");
assert.match(draftSrc, /НЕ\s+«опять не доела»/i, "callout must avoid moralizing phrasing");
assert.match(draftSrc, /в этот раз[\s\S]*подтянулось/i, "improvement must be noted positively");
assert.match(draftSrc, /key_trends[\s\S]*НЕ в подневную day_prose/i, "history numbers must be routed away from per-day validator");
assert.match(draftSrc, /previous_weeks_context:\s*\n?\s*\(context\.studentMemory\?\.approved_patterns/, "approved history must flip previous_weeks_context on");
// The callout must be routed into prose the COMBINED message renders (day_prose /
// plan prose), not only the raw athlete_message_draft — otherwise it never ships.
assert.match(draftSrc, /ГДЕ озвучивать паттерн истории[\s\S]*next_week_plan_text[\s\S]*day_prose[\s\S]*athlete_message_draft в него не попадает/i, "callout must be routed into day_prose / plan prose so it reaches the combined message");

// --- 6. Detection + memory roll-forward wired in the review (not on safety block)
assert.match(adminSrc, /detectNutritionRepeatingPatterns/, "review must run pattern detection");
assert.match(adminSrc, /pattern_candidates: patternCandidates/, "candidates must be persisted on the analysis");
assert.match(adminSrc, /if \(!generated\.safety_flags\.blocked\) \{\s*\n\s*patternCandidates = detectNutritionRepeatingPatterns/, "no proposals on a safety-blocked week");
assert.match(adminSrc, /updateNutritionMemoryAfterReview/, "review must roll last_focus/key_trends forward");

// --- 7. Repository: recent analyses + approve/dismiss plumbing ----------------
assert.match(repoSrc, /export async function listRecentNutritionWeeklyAnalysesForStudent/, "must expose recent-analyses query");
assert.match(repoSrc, /export async function addNutritionApprovedPattern/, "must expose approve-pattern (draft->approve)");
assert.match(repoSrc, /export async function removeNutritionAnalysisPatternCandidate/, "must expose candidate removal after decision");
assert.match(repoSrc, /item\.text\.toLowerCase\(\) === text\.toLowerCase\(\)/, "approved patterns deduped");

// --- 8. UI + actions: approve/reject (draft->approve) -------------------------
assert.match(actionsSrc, /export async function approveNutritionPatternAction/, "approve action exists");
assert.match(actionsSrc, /export async function dismissNutritionPatternAction/, "reject action exists");
assert.match(actionsSrc, /addNutritionApprovedPattern/, "approve persists to memory");
assert.doesNotMatch(
  actionsSrc.slice(actionsSrc.indexOf("dismissNutritionPatternAction")),
  /addNutritionApprovedPattern/,
  "reject must NOT store to memory"
);
assert.match(pageSrc, /Память ученика — предложенные паттерны/, "UI shows pattern proposals");
assert.match(pageSrc, /approveNutritionPatternAction/, "UI wires approve");
assert.match(pageSrc, /dismissNutritionPatternAction/, "UI wires reject");
assert.match(packageJson, /check:nutrition-review-memory/, "package.json must register this check");

console.log("PASS check-nutrition-review-memory");
