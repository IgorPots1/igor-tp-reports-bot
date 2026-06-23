import type { NextRequest } from "next/server";

import { validateTelegramInitData } from "@/features/telegram/validate-init-data";
import { resolveMiniAppStudent } from "@/features/telegram/miniapp-student-resolver";
import { buildDerivedNutritionCombinedMessage, getNutritionReviewDayCards } from "@/features/nutrition/combined-message";
import { formatNutritionWorkoutLabelForAthlete } from "@/features/nutrition/narrative-composer";
import { resolveMiniTableDays } from "@/features/nutrition/telegram-renderer";
import { getNutritionAdminLocalDate } from "@/features/nutrition/plan-week-policy";
import type { NutritionNextWeekPlan } from "@/features/nutrition/weekly-plan-formulas";
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
  // The review is already approved_for_copy (filtered above). Ship its athlete text
  // whenever there's rendered content — a SOFT needs_review (coach-review notes)
  // still ships by design (combined-message keeps the text). Withhold only on a hard
  // clinical block (blocked_safety) or no rendered parts (which also covers a hard
  // render failure, since that yields empty parts).
  const shippable =
    (combined.status === "ready" || combined.status === "needs_review") &&
    combined.athleteMessageDraftParts.length > 0;
  if (!shippable) {
    return jsonResponse(200, { ok: true, status: "not_ready" });
  }

  // Athlete-facing focus statement (whitelisted single string).
  const focus = asStringOrNull(asObject(asObject(review.nutritionSummary).one_focus).statement_ru);

  // Her own daily macros for the review week (whitelisted numeric fields only)
  // + a soft color marker per day (no clinical wording — see softDayMarker)
  // + validated per-day prose & athlete-safe day flags (for the mini-app cards).
  const metaByDate = buildDayMetaByDate(asObject(review.nutritionSummary).daily_analysis);
  const reviewCardByDate = new Map(getNutritionReviewDayCards(review).map((c) => [c.date ?? "", c]));
  const macroSource = review.reportId ? await getNutritionReportWithMacros(review.reportId).catch(() => null) : null;
  const dailyMacros = (macroSource?.macros ?? [])
    .filter((m) => !m.day.startsWith("unresolved:"))
    .map((m) => {
      const meta = metaByDate.get(m.day);
      const card = reviewCardByDate.get(m.day);
      return {
        day: m.day,
        kcal: m.kcal,
        proteinG: m.proteinG,
        fatG: m.fatG,
        carbsG: m.carbsG,
        marker: meta?.marker ?? "unknown",
        trainingLabel: meta?.trainingLabel ?? null,
        prose: card?.prose ?? null,
        isRest: card?.isRest ?? false,
        isRun: card?.isRun ?? false,
        isKey: card?.isKey ?? false,
        isRace: card?.isRace ?? false,
        isRecovery: card?.isRecovery ?? false,
      };
    });

  // Next-week plan day targets (whitelisted). Day-type flags are athlete-safe —
  // the day type is already visible in the plan — and only forward what code already
  // knows (key role / race / recovery from prior нарядов); no coach-only fields.
  // Past days of the CURRENT week are dropped using the SAME cutoff as the coach
  // mini-table (resolveMiniTableDays, athlete_remaining_only); a future week shows all.
  const nextWeekPlanObj = asObject(asObject(plan?.planSummary).next_week_plan);
  const todayLocal = getNutritionAdminLocalDate();
  const planWeekMode: "current_week" | "next_week" =
    planWeekFrom && planWeekTo && todayLocal >= planWeekFrom && todayLocal <= planWeekTo ? "current_week" : "next_week";
  const planDayObjects = Array.isArray(nextWeekPlanObj.days)
    ? resolveMiniTableDays({
        nextWeekPlan: nextWeekPlanObj as unknown as NutritionNextWeekPlan,
        planWeekMode,
        todayLocalDate: todayLocal,
        mode: "athlete_remaining_only",
      })
    : [];
  const planDays = planDayObjects.map((d) => {
    const f = d.flags ?? ({} as NutritionNextWeekPlan["days"][number]["flags"]);
    const isRest = f.rest === true;
    const isRace = f.race === true;
    const isRecovery = f.recovery === true;
    const isTraining =
      f.easy === true ||
      f.hard === true ||
      f.long_run === true ||
      f.strength === true ||
      f.cross_training === true ||
      f.key_workout === true;
    return {
      date: d.date ?? null,
      weekdayRu: d.weekday_ru ?? null,
      trainingLabel: d.training_label ?? null,
      targetKcal: d.target_kcal ?? null,
      proteinG: d.protein_g ?? null,
      fatG: d.fat_g ?? null,
      carbsG: d.carbs_g ?? null,
      isRest,
      isRun: !isRest && !isRace && !isRecovery && isTraining,
      isKey: f.key_workout === true,
      isRace,
      isRecovery,
    };
  });

  // Plan prose split into athlete-safe sections for the card layout (same text the
  // plan already produces; the text mini-table is dropped — cards replace it).
  const planSections = combined.renderResult.planSections;

  return jsonResponse(200, {
    ok: true,
    status: "ready",
    week: { from: review.weekFrom, to: review.weekTo },
    studentName: student.studentName,
    focus,
    parts: combined.athleteMessageDraftParts,
    reviewIntroText: combined.renderResult.reviewSections.intro,
    weekSummaryText: combined.renderResult.reviewSections.weekSummary,
    dailyMacros,
    planDays,
    planFocusText: planSections.focus,
    planRaceDayText: planSections.raceDay,
    planKeyTrainingText: planSections.keyTraining,
    planNoteText: planSections.note,
  });
}
