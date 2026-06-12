import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildNutritionInterpretationValidationFacts,
  countForbiddenInterpretationTerms,
  countMacroNumberWarnings,
  validateNutritionWeeklyInterpretation,
  type NutritionWeeklyInterpretation,
} from "@/features/nutrition/interpretation-contract";

function buildFacts(input?: {
  dates?: string[];
  hasPreviousWeeksContext?: boolean;
  macros?: Record<string, { kcal?: number; proteinG?: number; fatG?: number; carbsG?: number }>;
}) {
  const dates = input?.dates ?? ["2026-06-01", "2026-06-02"];
  const dailyAnalysis = dates.map((date) => ({
    date,
    actual: input?.macros?.[date] ?? { kcal: 2000, proteinG: 100, fatG: 60, carbsG: 250 },
  }));
  return buildNutritionInterpretationValidationFacts({
    dailyAnalysis,
    hasPreviousWeeksContext: input?.hasPreviousWeeksContext ?? false,
  });
}

function buildValidInterpretation(dates: string[]): NutritionWeeklyInterpretation {
  return {
    daily_blocks: dates.map((date) => ({
      date,
      comment_ru: "Питание выглядит ровно относительно нагрузки дня, можно поддержать текущий ритм.",
    })),
    week_summary_ru: "По неделе в целом питание выглядит рабочим, но в ключевые дни энергию лучше поддержать точечно.",
    one_focus_statement_ru: "Держим ровную энергию вокруг ключевых тренировок без резких шагов.",
    week_comparison_line_ru: null,
  };
}

function run(): void {
  const root = process.cwd();
  const generatorSource = readFileSync(join(root, "src/features/nutrition/interpretation-generator.ts"), "utf8");
  const draftGeneratorSource = readFileSync(join(root, "src/features/nutrition/draft-generator.ts"), "utf8");
  const combinedSource = readFileSync(join(root, "src/features/nutrition/combined-message.ts"), "utf8");

  assert.match(generatorSource, /Interpretation-only contract/i, "shadow prompt must mention interpretation-only contract");
  assert.match(generatorSource, /do NOT write final athlete message/i, "shadow prompt must ban final message");
  assert.doesNotMatch(combinedSource, /interpretation_shadow/, "production combined message must ignore shadow metadata");
  assert.doesNotMatch(generatorSource, /sendTelegram|telegram\.send/i, "shadow generator must not send Telegram");
  assert.match(draftGeneratorSource, /interpretation_shadow/, "review generation must persist shadow metadata");

  // Shadow audit harness must read both outputs without switching production render.
  const auditHelperSource = readFileSync(join(root, "src/features/nutrition/interpretation-audit.ts"), "utf8");
  assert.doesNotMatch(auditHelperSource, /buildDerivedNutritionCombinedMessage/, "audit helper must stay composer-agnostic");
  assert.match(auditHelperSource, /compareNutritionOutputs/, "audit helper must expose comparison entrypoint");

  const dates = ["2026-06-01", "2026-06-02", "2026-06-03"];
  const facts = buildFacts({ dates });
  const valid = validateNutritionWeeklyInterpretation(buildValidInterpretation(dates), facts);
  assert.equal(valid.ok, true, "valid interpretation must pass");
  assert.equal(valid.issues.filter((issue) => issue.severity === "error").length, 0);

  const withComparison = validateNutritionWeeklyInterpretation(
    {
      ...buildValidInterpretation(dates),
      week_comparison_line_ru: "По сравнению с прошлой неделей база стала ровнее.",
    },
    buildFacts({ dates, hasPreviousWeeksContext: true })
  );
  assert.equal(withComparison.ok, true, "comparison line allowed with previous context");

  const missingDay = validateNutritionWeeklyInterpretation(
    {
      ...buildValidInterpretation(["2026-06-01", "2026-06-02"]),
      daily_blocks: [{ date: "2026-06-01", comment_ru: "Комментарий." }],
    },
    facts
  );
  assert.equal(missingDay.ok, false, "missing daily block must fail");

  const extraDate = validateNutritionWeeklyInterpretation(
    {
      ...buildValidInterpretation(dates),
      daily_blocks: [
        ...buildValidInterpretation(dates).daily_blocks,
        { date: "2026-06-08", comment_ru: "Лишний день." },
      ],
    },
    facts
  );
  assert.equal(extraDate.ok, false, "extra date must fail");

  const invalidDate = validateNutritionWeeklyInterpretation(
    {
      ...buildValidInterpretation(dates),
      daily_blocks: [{ date: "bad-date", comment_ru: "Комментарий." }],
    },
    facts
  );
  assert.equal(invalidDate.ok, false, "invalid date must fail");

  const emptyComment = validateNutritionWeeklyInterpretation(
    {
      ...buildValidInterpretation(dates),
      daily_blocks: [{ date: "2026-06-01", comment_ru: "" }],
    },
    facts
  );
  assert.equal(emptyComment.ok, false, "empty comment must fail");

  const greeting = validateNutritionWeeklyInterpretation(
    {
      ...buildValidInterpretation(dates),
      daily_blocks: [{ date: "2026-06-01", comment_ru: "Привет, день выглядит ровно." }],
    },
    facts
  );
  assert.equal(greeting.ok, false, "greeting in daily comment must fail");

  const closing = validateNutritionWeeklyInterpretation(
    {
      ...buildValidInterpretation(dates),
      week_summary_ru: "На следующем разборе посмотрим, как это сработало.",
    },
    facts
  );
  assert.equal(closing.ok, false, "closing phrase must fail");

  const miniTable = validateNutritionWeeklyInterpretation(
    {
      ...buildValidInterpretation(dates),
      week_summary_ru: "📋 План на неделю ниже.",
    },
    facts
  );
  assert.equal(miniTable.ok, false, "mini-table marker must fail");

  const markdown = validateNutritionWeeklyInterpretation(
    {
      ...buildValidInterpretation(dates),
      one_focus_statement_ru: "**Главный фокус** на углеводы.",
    },
    facts
  );
  assert.equal(markdown.ok, false, "markdown must fail");

  for (const term of ["RED-S", "LEA", "энергодоступность", "дефицит", "диагноз", "медицинский", "TrainingPeaks"]) {
    const forbidden = validateNutritionWeeklyInterpretation(
      {
        ...buildValidInterpretation(dates),
        daily_blocks: [{ date: "2026-06-01", comment_ru: `Сигнал ${term} не для ученика.` }],
      },
      facts
    );
    assert.equal(forbidden.ok, false, `forbidden term must fail: ${term}`);
  }

  const phantomComparison = validateNutritionWeeklyInterpretation(
    {
      ...buildValidInterpretation(dates),
      week_comparison_line_ru: "По сравнению с прошлой неделей стало ровнее.",
    },
    buildFacts({ dates, hasPreviousWeeksContext: false })
  );
  assert.equal(phantomComparison.ok, false, "phantom comparison must fail without previous context");

  const newMacroTargets = validateNutritionWeeklyInterpretation(
    {
      ...buildValidInterpretation(dates),
      one_focus_statement_ru: "Цель на неделю: 2500 ккал, 90Б, 60Ж, 300У.",
    },
    facts
  );
  assert.equal(newMacroTargets.ok, false, "new macro targets must fail validation");
  assert.ok(
    newMacroTargets.issues.some(
      (issue) => issue.code === "forbidden_plan_numbers" || issue.code === "macro_number_not_in_facts"
    ),
    "plan-like macro numbers must be flagged"
  );

  const macroWarningFacts = buildFacts({
    dates: ["2026-06-01"],
    macros: { "2026-06-01": { kcal: 1800, proteinG: 95, fatG: 55, carbsG: 210 } },
  });
  const macroWarning = validateNutritionWeeklyInterpretation(
    {
      daily_blocks: [{ date: "2026-06-01", comment_ru: "Можно ориентироваться на 2500 ккал в ключевой день." }],
      week_summary_ru: "Неделя в целом ровная.",
      one_focus_statement_ru: "Поддержать энергию вокруг нагрузки.",
      week_comparison_line_ru: null,
    },
    macroWarningFacts
  );
  assert.ok(
    macroWarning.issues.some((issue) => issue.code === "macro_number_not_in_facts"),
    "macro numbers not in facts should warn"
  );

  const forbiddenCounts = countForbiddenInterpretationTerms("RED-S и LEA не пишем.");
  assert.ok(forbiddenCounts["RED-S"] >= 1);
  assert.ok(forbiddenCounts.LEA >= 1);
  const macroWarnings = countMacroNumberWarnings("2500 ккал и 90 г белка", [1800, 95]);
  assert.ok(macroWarnings >= 1);

  console.log("PASS check-nutrition-interpretation-contract");
}

run();
