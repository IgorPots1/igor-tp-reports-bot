import type { NextRequest } from "next/server";

import { validateTelegramInitData } from "@/features/telegram/validate-init-data";
import { resolveMiniAppStudent } from "@/features/telegram/miniapp-student-resolver";
import { buildDerivedNutritionCombinedMessage } from "@/features/nutrition/combined-message";
import { formatNutritionWorkoutLabelForAthlete } from "@/features/nutrition/narrative-composer";
import {
  getLatestNutritionWeeklyPlanForStudentWeek,
  getNutritionReportWithMacros,
  listRecentNutritionWeeklyAnalysesForStudent,
} from "@/features/nutrition/repository";

export const runtime = "nodejs";

function isMiniAppEnabled(): boolean {
  return process.env.MINIAPP_ENABLED === "true";
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Soft, athlete-safe marker for the day's color dot — NEVER the raw internal
 * status. The raw enum carries clinically-adjacent terms (below_energy_availability,
 * below_energy_floor, suspect, RED-S-adjacent); those must not reach the client.
 * We collapse to a neutral 3-bucket category: "ok" (green) / "low_energy" (amber)
 * / "unknown" (grey) — color intent only, no medical wording.
 */
function softDayMarker(rawStatus: string | null): "ok" | "low_energy" | "unknown" {
  if (!rawStatus) return "unknown";
  if (["adequate", "ample", "rest_ok", "ok"].includes(rawStatus)) return "ok";
  if (["missing", "suspect"].includes(rawStatus)) return "unknown";
  // Everything else (low_for_load, below_energy_*, low_for_strength, …) → amber.
  return "low_energy";
}

type DayMeta = { marker: "ok" | "low_energy" | "unknown"; trainingLabel: string | null };

/**
 * Map date → { soft marker, athlete-safe training label } from the review's
 * daily_analysis. The label is humanized via the SAME athlete-facing helper used
 * in the review text (formatNutritionWorkoutLabelForAthlete) — e.g. "лёгкий бег",
 * "длительная", "день отдыха" — never the raw training_type enum/code.
 */
function buildDayMetaByDate(dailyAnalysis: unknown): Map<string, DayMeta> {
  const map = new Map<string, DayMeta>();
  if (!Array.isArray(dailyAnalysis)) return map;
  for (const entry of dailyAnalysis as Array<Record<string, unknown>>) {
    const canonical = asObject(entry.canonicalDailyAnalysis ?? entry.canonical_daily_analysis);
    const date = asStringOrNull(entry.date) ?? asStringOrNull(canonical.date);
    if (!date) continue;
    const rawStatus = asStringOrNull(entry.nutrition_status) ?? asStringOrNull(canonical.nutritionStatus);
    const trainingType =
      asStringOrNull(entry.training_type) ?? asStringOrNull(canonical.trainingType) ?? "";
    const trainingLabelRaw =
      asStringOrNull(entry.training_label) ?? asStringOrNull(canonical.trainingLabel) ?? "";
    const trainingLabel =
      trainingType || trainingLabelRaw
        ? formatNutritionWorkoutLabelForAthlete({ trainingLabel: trainingLabelRaw, trainingType }) || null
        : null;
    map.set(date, { marker: softDayMarker(rawStatus), trainingLabel });
  }
  return map;
}

/**
 * Returns the student's OWN latest approved nutrition review, athlete-facing only.
 *
 * SECURITY: the student is resolved from signed initData (her telegram_user_id);
 * all data is keyed by that resolved student.id — never by a client-supplied id,
 * so one student can't read another's review. Only `approved_for_copy` reviews
 * are exposed, and the payload is a strict whitelist: no coach-only fields
 * (internalSummary, coach_summary_text, safety_flags, do_not_send_reasons,
 * athlete_report_signals) ever leave the server.
 */
export async function POST(request: NextRequest): Promise<Response> {
  if (!isMiniAppEnabled()) {
    return jsonResponse(503, { ok: false, error: "Mini app not yet active." });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonResponse(400, { ok: false, error: "Неверный запрос." });
  }

  const initData = (formData.get("initData") as string | null)?.trim() ?? "";
  if (!initData || !validateTelegramInitData(initData)) {
    return jsonResponse(401, { ok: false, error: "Не авторизован." });
  }

  const resolved = await resolveMiniAppStudent({ initData });
  if (!resolved.ok) {
    return jsonResponse(resolved.httpStatus, { ok: false, error: resolved.message });
  }
  const student = resolved.student;

  // Latest APPROVED review for this student (ordered by week desc).
  const recent = await listRecentNutritionWeeklyAnalysesForStudent(student.id, { limit: 12 }).catch(() => []);
  const review = recent.find((a) => a.status === "approved_for_copy") ?? null;
  if (!review) {
    return jsonResponse(200, { ok: true, status: "not_ready" });
  }

  // Pair with the plan for the review's plan-week, then derive the athlete text.
  const planWeek = asObject(asObject(review.nutritionSummary).plan_week);
  const planWeekFrom = asStringOrNull(planWeek.from);
  const planWeekTo = asStringOrNull(planWeek.to);
  const plan =
    planWeekFrom && planWeekTo
      ? await getLatestNutritionWeeklyPlanForStudentWeek({
          studentId: student.id,
          planWeekFrom,
          planWeekTo,
        }).catch(() => null)
      : null;

  const combined = buildDerivedNutritionCombinedMessage({
    review,
    plan,
    formality: student.telegramFormality,
    studentName: student.studentName,
  });
  if (combined.status !== "ready" || combined.athleteMessageDraftParts.length === 0) {
    return jsonResponse(200, { ok: true, status: "not_ready" });
  }

  // Athlete-facing focus statement (whitelisted single string).
  const focus = asStringOrNull(asObject(asObject(review.nutritionSummary).one_focus).statement_ru);

  // Her own daily macros for the review week (whitelisted numeric fields only)
  // + a soft color marker per day (no clinical wording — see softDayMarker).
  const metaByDate = buildDayMetaByDate(asObject(review.nutritionSummary).daily_analysis);
  const macroSource = review.reportId ? await getNutritionReportWithMacros(review.reportId).catch(() => null) : null;
  const dailyMacros = (macroSource?.macros ?? [])
    .filter((m) => !m.day.startsWith("unresolved:"))
    .map((m) => {
      const meta = metaByDate.get(m.day);
      return {
        day: m.day,
        kcal: m.kcal,
        proteinG: m.proteinG,
        fatG: m.fatG,
        carbsG: m.carbsG,
        marker: meta?.marker ?? "unknown",
        trainingLabel: meta?.trainingLabel ?? null,
      };
    });

  // Next-week plan day targets (whitelisted: no coach notes/flags raw dump).
  const nextWeekPlan = asObject(asObject(plan?.planSummary).next_week_plan);
  const planDaysRaw = Array.isArray(nextWeekPlan.days) ? (nextWeekPlan.days as Array<Record<string, unknown>>) : [];
  const planDays = planDaysRaw.map((d) => ({
    date: asStringOrNull(d.date),
    weekdayRu: asStringOrNull(d.weekday_ru),
    trainingLabel: asStringOrNull(d.training_label),
    targetKcal: asNumberOrNull(d.target_kcal),
    proteinG: asNumberOrNull(d.protein_g),
    fatG: asNumberOrNull(d.fat_g),
    carbsG: asNumberOrNull(d.carbs_g),
  }));

  return jsonResponse(200, {
    ok: true,
    status: "ready",
    week: { from: review.weekFrom, to: review.weekTo },
    studentName: student.studentName,
    focus,
    parts: combined.athleteMessageDraftParts,
    dailyMacros,
    planDays,
  });
}
