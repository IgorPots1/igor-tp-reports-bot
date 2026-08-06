/**
 * quality-select — отбор качественной сессии ПО КАТАЛОГУ вместо заглушки.
 *
 * selectQualityMethodologyV0 имеет ровно одну положительную ветку (found_20x1 → vo2_10x2):
 * одна тренировка на один паттерн, заготовка под одну атлетку. Здесь — отбор среди реальных
 * кандидатов каталога с применением guardrails и coach_review_rules, которые до сих пор
 * не читались вообще.
 *
 * КОНВЕНЦИЯ ТРЕНЕРА (жёстко): 5×4, 6×5, 8×4, 6×6 и подобные — это КОНТРОЛИРУЕМЫЙ ПОРОГ,
 * а не VO2. VO2 в автогенерации не назначается ВООБЩЕ, ни при каких данных. Это же правило
 * лежит в БД как guardrail `threshold_numbers_not_vo2_default` (hard_block) — мы его исполняем,
 * а не дублируем своей логикой.
 *
 * Чистый модуль: ни БД, ни сети.
 */
import type { Guardrail, QualityPreset, ReviewRule } from "./autoplanner-catalog.ts";

export type QualityContext = {
  /** качественных сессий за последние 8 недель (считается на лету из кэша) */
  qualityLast8w: number;
  /** сколько дней бегает в неделю */
  plannedRunCount: number;
  /** суммарный объём работы последней качественной, мин (null — истории нет) */
  lastQualityWorkMinutes: number | null;
  hasActiveIllnessOrInjury: boolean;
  hasRaceContext: boolean;
  contextFlags: string[];           // injury | acute_pain | insufficient_data | returning | …
  rolling4wWeeklyMin: number;
};

/** Пороги потолка качества — параметры, не зашиты в логику (шаг 3 наряда). */
export const QUALITY_CAP_THRESHOLDS = { oneSessionMin: 3, twoSessionsMin: 6, windowWeeks: 8 };

/** Потолок качества на лету: сколько качества в неделю разрешено. baselines не используются. */
export function qualityCapFromHistory(qualityLast8w: number): number {
  if (qualityLast8w >= QUALITY_CAP_THRESHOLDS.twoSessionsMin) return 2;
  if (qualityLast8w >= QUALITY_CAP_THRESHOLDS.oneSessionMin) return 1;
  return 0;
}

export type QualityDecision =
  | { selected: true; preset: QualityPreset; reason: string; coachReview: string[]; warnings: string[] }
  | { selected: false; reason: string; detail: string };

/** Шаг прогрессии по объёму работы: не больше +20% к прошлой качественной. */
const PROGRESSION_STEP_MAX = 1.2;
/** Потолок объёма работы качественной как доля недельного объёма — чтобы не воткнуть 48 мин работы в 150-минутную неделю. */
const WORK_SHARE_OF_WEEKLY_MAX = 0.22;

/**
 * Отбор. Порядок: hard_block guardrails → кандидаты → конвенция (никакого VO2) →
 * прогрессия от прошлой сессии → потолок по недельному объёму → coach_review пометки.
 */
export function selectQualityFromCatalog(
  candidates: QualityPreset[],
  guardrails: Guardrail[],
  reviewRules: ReviewRule[],
  ctx: QualityContext,
): QualityDecision {
  const cap = qualityCapFromHistory(ctx.qualityLast8w);
  if (cap < 1) {
    return { selected: false, reason: "no_quality_slot_available",
      detail: `качественных за ${QUALITY_CAP_THRESHOLDS.windowWeeks} нед: ${ctx.qualityLast8w} (< ${QUALITY_CAP_THRESHOLDS.oneSessionMin})` };
  }
  if (ctx.plannedRunCount < 3) {
    return { selected: false, reason: "no_quality_slot_available", detail: `беговых дней ${ctx.plannedRunCount} (< 3)` };
  }

  // ── HARD BLOCK guardrails из БД ──
  for (const g of guardrails) {
    if (g.severity !== "hard_block") continue;
    const blockedFlags = (g.condition.blocked_context_flags as string[] | undefined) ?? [];
    if (blockedFlags.length && blockedFlags.some((f) => ctx.contextFlags.includes(f))) {
      return { selected: false, reason: g.ruleCode, detail: g.messageRu };
    }
  }
  if (ctx.hasActiveIllnessOrInjury || ctx.hasRaceContext) {
    return { selected: false, reason: "quality_selection_blocked_by_context",
      detail: ctx.hasActiveIllnessOrInjury ? "активная болезнь/травма" : "гоночный контекст" };
  }

  // ── КОНВЕНЦИЯ: VO2 в автогенерации не ставим НИКОГДА ──
  // (guardrail threshold_numbers_not_vo2_default: интервалы по умолчанию controlled_threshold
  //  и становятся VO2 только явным выбором тренера, которого в автогенерации нет)
  let pool = candidates.filter((p) => p.intensityIntent !== "vo2" && !p.requiresExplicitVo2);
  if (pool.length === 0) return { selected: false, reason: "no_candidates", detail: "после отсева VO2 кандидатов не осталось" };

  // ── потолок объёма работы по недельному объёму ──
  const weekly = ctx.rolling4wWeeklyMin || 150;
  const workCeil = Math.max(12, weekly * WORK_SHARE_OF_WEEKLY_MAX);
  const withinWeekly = pool.filter((p) => p.totalWorkMinutes <= workCeil);
  const warnings: string[] = [];
  if (withinWeekly.length === 0) {
    warnings.push(`все кандидаты выше потолка объёма (${Math.round(workCeil)} мин), взят самый лёгкий`);
    pool = [pool[0]];
  } else pool = withinWeekly;

  // ── прогрессия от прошлой качественной ──
  let chosen: QualityPreset; let reason: string;
  if (ctx.lastQualityWorkMinutes == null) {
    chosen = pool[0]; // истории нет — начинаем с самого лёгкого доступного
    reason = "истории качества нет — стартовый объём";
  } else {
    const target = ctx.lastQualityWorkMinutes * PROGRESSION_STEP_MAX;
    const ahead = pool.filter((p) => p.totalWorkMinutes > ctx.lastQualityWorkMinutes && p.totalWorkMinutes <= target);
    if (ahead.length > 0) { chosen = ahead[ahead.length - 1]; reason = `прогрессия от ${ctx.lastQualityWorkMinutes} мин работы (+до 20%)`; }
    else {
      // шага вперёд нет — держим ближайший к прошлому объёму
      chosen = pool.reduce((a, b) => Math.abs(b.totalWorkMinutes - ctx.lastQualityWorkMinutes!) < Math.abs(a.totalWorkMinutes - ctx.lastQualityWorkMinutes!) ? b : a);
      reason = `удержание объёма ${ctx.lastQualityWorkMinutes} мин (шага вперёд нет в пределах потолка)`;
    }
  }

  // ── coach_review: из пресета и из правил каталога ──
  const coachReview: string[] = [];
  if (chosen.coachReviewRequired) coachReview.push("пресет помечен coach_review_required");
  for (const g of guardrails) {
    if (g.severity !== "coach_review") continue;
    if (g.condition.all_quality_sessions === true) coachReview.push(g.messageRu);
    const flags = (g.condition.review_context_flags as string[] | undefined) ?? [];
    if (flags.length && flags.some((f) => ctx.contextFlags.includes(f))) coachReview.push(g.messageRu);
  }
  for (const r of reviewRules) {
    if (r.triggerType === "always" && r.intents.length && r.intents.includes(chosen.intensityIntent)) coachReview.push(r.messageRu);
  }
  if (chosen.avoidAcidosis) warnings.push("контролируемо, без закисления (avoid_acidosis)");

  return { selected: true, preset: chosen, reason, coachReview: [...new Set(coachReview)], warnings };
}
