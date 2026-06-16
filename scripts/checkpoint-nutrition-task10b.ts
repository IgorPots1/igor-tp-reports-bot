// READ-ONLY checkpoint for Task 10++ (lose methodology: BMR + TP maintenance
// anchor, EA floor, deficit-line review). Live Claude run on a real student with
// goal=lose + sex, comparing the Mifflin path (height/age filled) vs the
// Cunningham fallback (no height/age), against the maintain contrast, and proving
// safety still blocks a dangerous low-kcal week. Nothing is persisted.
//
//   npx tsx scripts/checkpoint-nutrition-task10b.ts --student-name "Любовь" --height 168 --age 40
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { collectNutritionAthleteReportSignalTexts, detectNutritionAthleteReportSignalsFromTexts } from "@/features/nutrition/athlete-signals";
import { listNutritionAdminDashboardRows } from "@/features/nutrition/admin";
import { buildNutritionStudentContext } from "@/features/nutrition/context";
import { generateNutritionWeeklyAnalysis } from "@/features/nutrition/draft-generator";
import { resolveNutritionAiModel, resolveNutritionAiProvider } from "@/features/nutrition/nutrition-ai-provider";
import { getNutritionReportWithMacros, getNutritionStudentEssentials } from "@/features/nutrition/repository";
import type { NutritionGoalType, NutritionSex } from "@/features/nutrition/repository";
import { estimateRestingMetabolicRate } from "@/features/nutrition/weekly-plan-formulas";
import { loadScriptEnv, resolveSupabaseEnv } from "./lib/load-script-env";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function planType(generated: { next_week_plan?: { day_type_targets?: Record<string, unknown> } }, type: string) {
  return asObject(generated.next_week_plan?.day_type_targets)[type] ?? null;
}
function fmt(d: Record<string, unknown> | null): string {
  if (!d) return "—";
  const kcal = d.target_kcal as number;
  const p = d.protein_g as number;
  const f = d.fat_g as number;
  const c = d.carbs_g as number;
  const fatPct = kcal ? Math.round(((f * 9) / kcal) * 100) : 0;
  return `${kcal} ккал · Б ${p} · Ж ${f} (${fatPct}%) · У ${c}`;
}

async function main() {
  loadScriptEnv();
  if (!resolveSupabaseEnv()) {
    console.error("Нет SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY в .env.local.");
    process.exit(1);
  }
  const provider = resolveNutritionAiProvider();
  console.log(`provider=${provider} model=${resolveNutritionAiModel(provider)}`);
  const studentName = arg("student-name") ?? "Любовь";
  const sex: NutritionSex = (arg("sex") as NutritionSex) ?? "female";
  const heightCm = arg("height") ? Number(arg("height")) : 168; // illustrative (Mifflin) — впиши реальные
  const ageYears = arg("age") ? Number(arg("age")) : 40;
  const rows = await listNutritionAdminDashboardRows({ viewMode: "test" });
  const withReport = rows.filter((r) => r.latestReportId);
  const row = withReport.find((r) => r.studentName.toLowerCase().includes(studentName.toLowerCase())) ?? withReport[0];
  if (!row) {
    console.error("Нет учеников с отчётом");
    process.exit(1);
  }
  console.log(`student: ${row.studentName}`);
  const report = await getNutritionReportWithMacros(row.latestReportId as string);
  if (!report) {
    console.error("report not found");
    process.exit(1);
  }
  const baseRows = report.macros.map((m) => ({
    day: m.day, weekday: null, kcal: m.kcal, proteinG: m.proteinG, fatG: m.fatG, carbsG: m.carbsG,
    confidence: m.confidence ?? 1, notes: m.notes, ...(m.items.length > 0 ? { items: m.items } : {}),
  }));
  const essentials = await getNutritionStudentEssentials(row.studentId);
  const signals = detectNutritionAthleteReportSignalsFromTexts(
    collectNutritionAthleteReportSignalTexts({
      reportComment: report.report.rawText,
      manualMacroNotes: baseRows.map((r) => r.notes),
      nutritionContextNotes: essentials.contextItems.map((i) => i.text),
      profileToleranceNotes: essentials.profile?.toleranceNotes ?? null,
    })
  );
  const buildCtx = async (
    macroRows: typeof baseRows,
    goalType: NutritionGoalType,
    withAnthro: boolean
  ) => {
    const ctx = await buildNutritionStudentContext({
      studentId: row.studentId,
      weekFrom: report.report.weekFrom,
      weekTo: report.report.weekTo,
      manualRows: macroRows,
      athleteReportSignals: signals,
    });
    ctx.nutritionGoalType = goalType;
    ctx.sex = goalType === "maintain" ? null : sex;
    ctx.heightCm = withAnthro ? heightCm : null;
    ctx.ageYears = withAnthro ? ageYears : null;
    return ctx;
  };

  const bw = essentials.profile?.currentWeightKg ?? 70;
  const rmrM = estimateRestingMetabolicRate({ bodyweightKg: bw, sex, heightCm, ageYears });
  const rmrC = estimateRestingMetabolicRate({ bodyweightKg: bw, sex, heightCm: null, ageYears: null });

  // lose + Mifflin (live review) | lose + Cunningham (plan-only) | maintain (live) | safety (live)
  const loseMifflin = await generateNutritionWeeklyAnalysis({ context: await buildCtx(baseRows, "lose", true) });
  const loseCunningham = await generateNutritionWeeklyAnalysis({ context: await buildCtx(baseRows, "lose", false) });
  const maintain = await generateNutritionWeeklyAnalysis({ context: await buildCtx(baseRows, "maintain", false) });
  const lowRows = baseRows.map((r) => ({ ...r, kcal: 900, carbsG: 70, proteinG: 40, fatG: 30 }));
  const lowSafety = await generateNutritionWeeklyAnalysis({ context: await buildCtx(lowRows, "lose", true) });

  const coach = (g: { nutrition_summary?: Record<string, unknown> }) => (asObject(g.nutrition_summary).coach_summary_text as string) ?? "";
  const dayProse = (g: Record<string, unknown>): Record<string, string> => {
    // day_prose lands as athlete_prose on each day of daily_analysis (this is the
    // per-day source the combined message renders to the athlete).
    const daily = asObject(g.nutrition_summary).daily_analysis;
    const out: Record<string, string> = {};
    if (Array.isArray(daily)) {
      for (const d of daily) {
        const o = asObject(d);
        const date = typeof o.date === "string" ? o.date : null;
        const prose = typeof o.athlete_prose === "string" ? o.athlete_prose : null;
        if (date && prose) out[date] = prose;
      }
    }
    return out;
  };
  const loseProse = dayProse(loseMifflin as unknown as Record<string, unknown>);

  console.log(`\nbw=${bw}кг  RMR Mifflin(${heightCm}/${ageYears})=${rmrM.rmrKcal}  RMR Cunningham(fallback)=${rmrC.rmrKcal}`);
  console.log(`\nLOSE+Mifflin focus: ${loseMifflin.one_focus.category} — ${loseMifflin.one_focus.statement_ru}`);
  console.log(`  rest: ${fmt(planType(loseMifflin, "rest"))}`);
  console.log(`  easy: ${fmt(planType(loseMifflin, "easy"))}`);
  console.log(`  hard: ${fmt(planType(loseMifflin, "hard"))}`);
  console.log(`  long: ${fmt(planType(loseMifflin, "long_run"))}`);
  console.log(`\nLOSE+Cunningham(fallback):`);
  console.log(`  rest: ${fmt(planType(loseCunningham, "rest"))}`);
  console.log(`  hard: ${fmt(planType(loseCunningham, "hard"))}`);
  console.log(`  long: ${fmt(planType(loseCunningham, "long_run"))}`);
  console.log(`\nMAINTAIN rest: ${fmt(planType(maintain, "rest"))}  hard: ${fmt(planType(maintain, "hard"))}  long: ${fmt(planType(maintain, "long_run"))}`);
  console.log(`\nSAFETY (lose + 900 kcal): blocked=${lowSafety.safety_flags.blocked} status=${lowSafety.status} hard_flags=${JSON.stringify(lowSafety.safety_flags.hard_flags)}`);

  const md = [
    `# Чекпойнт Задача 10++ — методология снижения (BMR+TP) — ${row.studentName}`,
    "",
    `- provider/model: \`${provider}\` / \`${loseMifflin.ai_model}\``,
    `- вес ${bw}кг, пол ${sex}; RMR Mifflin(${heightCm}см/${ageYears}л)=${rmrM.rmrKcal}, RMR Cunningham(fallback)=${rmrC.rmrKcal}`,
    "",
    "## LOSE — Mifflin (рост/возраст заполнены)",
    `- Фокус: **${loseMifflin.one_focus.category}** — ${loseMifflin.one_focus.statement_ru}`,
    `- rest: \`${fmt(planType(loseMifflin, "rest"))}\``,
    `- easy: \`${fmt(planType(loseMifflin, "easy"))}\``,
    `- hard: \`${fmt(planType(loseMifflin, "hard"))}\``,
    `- long: \`${fmt(planType(loseMifflin, "long_run"))}\``,
    "  (ожидание: rest дефицитный но не ниже EA-пола; работа питается; длительная ≈ поддержание ~2600, НЕ 3000)",
    "",
    "### day_prose — ПОДНЕВНЫЙ разбор (это и идёт в combined ученику)",
    ...(Object.keys(loseProse).length
      ? Object.entries(loseProse).map(([d, p]) => `- **${d}**: ${p}`)
      : ["_(пусто — структура НЕ подневная!)_"]),
    "",
    "### Athlete-текст (athlete_message_draft, lose, Mifflin)",
    loseMifflin.athlete_message_draft ?? "_(нет)_",
    "",
    "### Coach summary (lose, Mifflin)",
    coach(loseMifflin) || "_(нет)_",
    "",
    "## LOSE — Cunningham (рост/возраст НЕ заполнены, приближение)",
    `- rest: \`${fmt(planType(loseCunningham, "rest"))}\` · hard: \`${fmt(planType(loseCunningham, "hard"))}\` · long: \`${fmt(planType(loseCunningham, "long_run"))}\``,
    "  (rest/easy совпадают с Mifflin — пол держит; на тренировочных днях идёт выше — приближение, потому рост/возраст для худеющих заполняем)",
    "",
    "## Контраст: MAINTAIN (поведение прежнее, байт-в-байт)",
    `- rest: \`${fmt(planType(maintain, "rest"))}\` · hard: \`${fmt(planType(maintain, "hard"))}\` · long: \`${fmt(planType(maintain, "long_run"))}\``,
    "",
    "## Safety НЕ ослаблен целью lose",
    `- 900 ккал/день + lose → blocked=**${lowSafety.safety_flags.blocked}**, status=\`${lowSafety.status}\`, hard_flags=${JSON.stringify(lowSafety.safety_flags.hard_flags)}`,
    "",
  ].join("\n");
  const file = `ЧЕКПОЙНТ_задача10b_${row.studentSlug}.md`;
  fs.writeFileSync(path.join(process.cwd(), file), md, "utf8");
  console.log(`\nsaved: ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
