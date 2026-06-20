// READ-ONLY diagnostic: why a nutrition review came out in fallback / template mode.
// Inspects the STORED review (no model call, no mutations) and re-runs the per-day
// prose validator on the stored prose to show exactly what is rejected and why.
//
// Run:
//   npx tsx scripts/diagnose-nutrition-generation-mode.ts --student-name "Имя"
//   npx tsx scripts/diagnose-nutrition-generation-mode.ts --student-id <uuid> --week-from 2026-06-01
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { validateNutritionDayProse } from "../src/features/nutrition/telegram-renderer";
import { buildNutritionDayProseFacts } from "../src/features/nutrition/combined-message";
import { loadScriptEnv, resolveSupabaseEnv } from "./lib/load-script-env";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

async function main() {
  loadScriptEnv();
  const env = resolveSupabaseEnv();
  if (!env) {
    console.error("Нет SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY в окружении (.env.local).");
    process.exit(1);
  }
  const supabase = createClient(env.supabaseUrl, env.serviceRoleKey, { auth: { persistSession: false } });

  console.log("=== ENV ===");
  console.log("OPENAI_API_KEY present:", Boolean(process.env.OPENAI_API_KEY?.trim()));
  console.log("OPENAI model:", process.env.OPENAI_NUTRITION_WEEKLY_REVIEW_MODEL?.trim() || "(default gpt-4o-mini)");
  console.log("OPENAI_API_URL:", process.env.OPENAI_API_URL?.trim() || "(default openai)");

  const studentId = arg("student-id");
  const studentName = arg("student-name");
  let resolvedStudentId = studentId ?? null;
  if (!resolvedStudentId && studentName) {
    const { data } = await supabase
      .from("trainingpeaks_students")
      .select("id,student_name")
      .ilike("student_name", `%${studentName}%`)
      .limit(5);
    console.log("\n=== STUDENT MATCH ===");
    console.table(data ?? []);
    resolvedStudentId = (data ?? [])[0]?.id ?? null;
  }
  if (!resolvedStudentId) {
    console.error("Укажи --student-id <uuid> или --student-name <имя>.");
    process.exit(1);
  }

  let q = supabase
    .from("nutrition_weekly_analyses")
    .select("id,week_from,week_to,status,ai_model,internal_summary,nutrition_summary,updated_at")
    .eq("student_id", resolvedStudentId)
    .order("week_from", { ascending: false })
    .limit(1);
  const weekFrom = arg("week-from");
  if (weekFrom) {
    q = supabase
      .from("nutrition_weekly_analyses")
      .select("id,week_from,week_to,status,ai_model,internal_summary,nutrition_summary,updated_at")
      .eq("student_id", resolvedStudentId)
      .eq("week_from", weekFrom)
      .limit(1);
  }
  const { data: rows, error } = await q;
  if (error) {
    console.error("DB error:", error.message);
    process.exit(1);
  }
  const review = (rows ?? [])[0];
  if (!review) {
    console.error("Обзор не найден для этого ученика/недели.");
    process.exit(1);
  }

  const summary = asObject(review.nutrition_summary);
  const internal = asObject(review.internal_summary);
  const notes = Array.isArray(internal.notes) ? internal.notes : [];
  const generationMode = summary.generation_mode ?? "(нет поля)";

  console.log("\n=== REVIEW ===");
  console.log("week:", review.week_from, "->", review.week_to, "| status:", review.status, "| updated:", review.updated_at);
  console.log("generation_mode:", generationMode);
  console.log("ai_model:", review.ai_model ?? summary.ai_model ?? "(нет)");
  console.log("prompt_version:", summary.prompt_version ?? "(нет)");
  console.log("internal_summary.notes:");
  for (const n of notes) console.log("   -", n);

  console.log("\n=== STEP 1: вызывалась ли модель? ===");
  if (generationMode === "ai") {
    console.log("МОДЕЛЬ ВЫЗВАНА и вернула валидный обзор (generation_mode=ai).");
  } else {
    const skipped = notes.includes("methodology_facts_incomplete_for_ai_generation");
    if (skipped) {
      console.log("МОДЕЛЬ НЕ ВЫЗЫВАЛАСЬ: forceNeedsReview=true (methodology_facts_incomplete_for_ai_generation).");
      console.log("Причина — не выполнено одно из условий hasMethodologyFacts:");
      console.log("  resolvedMacroDays>0, dataQuality.parsedDays>0, hasResolvedDates,");
      console.log("  непустой one_focus, и hasUsableTrainingContext (tpPastWeek.workouts>0 и cache ok/stale).");
      if (notes.includes("past_week_tp_context_unavailable_or_stale")) {
        console.log("  >>> ВЕРОЯТНО: past_week_tp_context_unavailable_or_stale — нет тренировок в TP-кэше за неделю.");
      }
    } else {
      console.log("МОДЕЛЬ, СКОРЕЕ ВСЕГО, ВЫЗЫВАЛАСЬ, но вернула null (generation_mode=fallback без methodology-флага).");
      console.log("Это значит: нет ключа в рантайме, либо !response.ok, либо пустой ответ, либо JSON-parse упал,");
      console.log("либо пустые coach_summary_text/day_by_day_analysis_text. Логов нет — путь немой (см. отчёт).");
    }
  }

  const daily = Array.isArray(summary.daily_analysis) ? summary.daily_analysis : [];
  const withProse = daily.filter((d) => typeof asObject(d).athlete_prose === "string" && (asObject(d).athlete_prose as string).trim());
  console.log("\n=== STEP 2: проза по дням ===");
  console.log("дней в daily_analysis:", daily.length, "| с athlete_prose:", withProse.length);
  if (generationMode !== "ai") {
    console.log("(в fallback day_prose пуст по построению — валидировать нечего; причина в STEP 1)");
  }

  let rejected = 0;
  for (const d of daily) {
    const day = asObject(d);
    const prose = typeof day.athlete_prose === "string" ? day.athlete_prose.trim() : "";
    if (!prose) continue;
    // Build facts EXACTLY like production (buildNutritionDayProseFacts) — it pulls
    // item.target → planTargetNumbers (carb band + undershoot) and carbFastFoods, so
    // coaching numbers like "ориентир 180–260" are allowed. Hand-building facts here
    // omitted that and over-rejected (false alarm).
    const facts = buildNutritionDayProseFacts(day);
    const issues = validateNutritionDayProse({ prose, facts });
    if (issues.length === 0) continue;
    rejected += 1;
    console.log(`\n  ❌ ${day.date} (${day.nutrition_status ?? "?"}) зарублено:`);
    for (const is of issues) console.log(`     [${is.rule}] ${is.message}`);
    const proseNumbers = [...prose.matchAll(/(\d+(?:[.,]\d+)?)(\s*%)?/g)].filter((m) => !m[2]).map((m) => m[1]);
    console.log("     числа в прозе:", proseNumbers.join(", ") || "(нет)");
    console.log("     факты дня:", JSON.stringify(facts));
    console.log("     проза:", prose.slice(0, 220));
  }
  console.log("\n=== STEP 3: ИТОГ ===");
  console.log("дней с прозой:", withProse.length, "| зарублено валидатором:", rejected);
  if (withProse.length > 0 && rejected === withProse.length) {
    console.log(">>> Вся проза зарублена — день выходит детерминированным, хотя generation_mode=ai.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
