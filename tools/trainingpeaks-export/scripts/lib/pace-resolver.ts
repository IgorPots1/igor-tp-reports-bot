/**
 * pace-resolver — ЕДИНСТВЕННОЕ место, где намерение превращается в числа (спека §2).
 *
 * Каталог НЕ мигрируется и интенсивность НЕ хранит: пресет даёт структуру, режим контроля
 * по умолчанию и RPE-рамку, а конкретные темпы приходят отсюда — из якорей атлета.
 *
 * Чистый модуль: ни БД, ни сети. Контекст атлета (якоря + тир) собирает autoplanner-context.ts.
 */

export type IntensityIntent =
  | "easy" | "recovery" | "long"          // → якорь лёгкого
  | "steady_tempo"                         // → порог, вниз (§2.3)
  | "threshold" | "controlled_threshold"   // → порог, z4
  | "vo2";                                 // → порог, z5/z6

export type Phase = "maintenance"; // v1: только поддерживающий цикл (анти-скоуп)

export type AnchorSource =
  | "applied_threshold_coach" | "applied_threshold_bulk_only"
  | "easy_description" | "tp_zone2" | "cohort_ratio" | "cs_calibrated"
  | "quality_description";

export type Confidence = "high" | "medium" | "medium_low" | "low";
export type Tier = "T1" | "T2" | "T3";

/** §2.5 — реюз range_spread из e-predictor-constants.json. Ниже доверие → ШИРЕ полоса. */
export const RANGE_SPREAD: Record<Confidence, { conservative_pct: number; optimistic_pct: number }> = {
  high: { conservative_pct: 0.025, optimistic_pct: 0.015 },
  medium: { conservative_pct: 0.055, optimistic_pct: 0.025 },
  medium_low: { conservative_pct: 0.09, optimistic_pct: 0.04 },
  low: { conservative_pct: 0.14, optimistic_pct: 0.06 },
};

/**
 * §2.4 — база для КАЧЕСТВА: TP-зоны от порога (tp-zone-formulas.ts, speed method 2).
 * Границы там заданы как доли СКОРОСТИ от порога: [0.775, 0.878, 0.944, 1.0, 1.033, 1.114].
 * Темп = порог / доля_скорости, поэтому быстрый край берётся из БОЛЬШЕЙ доли.
 * Для лёгкого множители НЕ применяются вообще — берётся якорь лёгкого напрямую (§2.2/§2.6).
 */
const SPEED_FRACTION = { z3_max: 0.944, z4_max: 1.0, z5_max: 1.033, z6_max: 1.114 } as const;

/** Фолбэк качества от порога: верх ровно на пороге, низ чуть медленнее, ширина ≤ параметра. */
export const QUALITY_FALLBACK_FAST_MULT = 1.0;
export const QUALITY_FALLBACK_SLOW_MULT = 1.04;
export const QUALITY_FALLBACK_MAX_BAND_S = 12;

/** §2.3 — steady считается ОТ ПОРОГА ВНИЗ, в темпе: порог × [1.02 … 1.08]. */
const STEADY_PACE_MULT = { fast: 1.02, slow: 1.08 } as const;

export type EasyAnchor = {
  fastSec: number;            // быстрый край — ЖЁСТКИЙ предел (§2.6)
  slowSec: number;            // медленный край — мягкий, только предупреждение
  source: Extract<AnchorSource, "easy_description" | "tp_zone2" | "cohort_ratio">;
  confidence: Confidence;
  effectiveN?: number;        // только для easy_description — градация доверия внутри источника
};

export type ThresholdAnchor = {
  paceSec: number;
  source: Extract<AnchorSource, "applied_threshold_coach" | "applied_threshold_bulk_only" | "cs_calibrated">;
  confidence: Confidence;
};

/** Якорь качества из описаний — приоритетнее процентов от порога (см. quality-anchor.ts). */
export type QualityAnchor = {
  fastSec: number; slowSec: number;
  confidence: Confidence; effectiveN?: number;
};

export type AthleteAnchors = {
  athleteId: number;
  tier: Tier;
  easy: EasyAnchor | null;
  threshold: ThresholdAnchor | null;
  /** null → полоса качества считается от порога узким фолбэком */
  quality?: QualityAnchor | null;
};

export type Resolved = {
  ok: true;
  intent: IntensityIntent;
  pctMin: number | null;      // % от порога для шагов TP (null, если порога нет)
  pctMax: number | null;
  absPaceMinS: number;        // быстрый край, сек/км
  absPaceMaxS: number;        // медленный край, сек/км
  targetMode: "pace" | "rpe" | "hr";
  rpe: number | null;
  confidence: Confidence;
  anchorSource: AnchorSource;
  /** быстрый край лёгкого — жёсткий потолок; выход за медленный край — только предупреждение */
  hardFastCapS: number | null;
  warnings: string[];
};

export type Unresolved = {
  ok: false;
  intent: IntensityIntent;
  reason: "no_threshold_cannot_do_quality" | "no_easy_anchor_and_no_fallback" | "intent_out_of_scope_v1";
  detail: string;
};

export type ResolveResult = Resolved | Unresolved;

const EASY_INTENTS: IntensityIntent[] = ["easy", "recovery", "long"];
const QUALITY_INTENTS: IntensityIntent[] = ["steady_tempo", "threshold", "controlled_threshold", "vo2"];

/** §2.7 — режим контроля лёгкого как функция ТИРА (правило живёт здесь, не в каталоге). */
export function easyTargetModeForTier(tier: Tier): "pace" | "rpe" {
  return tier === "T1" ? "rpe" : "pace";
}

/** Расширение полосы по доверию (§2.5): медленный край — conservative, быстрый — optimistic. */
function widen(fastSec: number, slowSec: number, confidence: Confidence): { fast: number; slow: number } {
  const s = RANGE_SPREAD[confidence];
  return { fast: fastSec * (1 - s.optimistic_pct), slow: slowSec * (1 + s.conservative_pct) };
}

const pct = (thresholdSec: number, paceSec: number): number => Math.round((thresholdSec / paceSec) * 100);

/**
 * (athlete, intent, phase) → числа. Единственная точка «намерение → темп».
 * `rpeFromPreset` приходит из каталога (пресет несёт RPE-рамку, но не интенсивность).
 */
export function resolvePace(
  a: AthleteAnchors,
  intent: IntensityIntent,
  _phase: Phase,
  rpeFromPreset: number | null = null,
): ResolveResult {
  const warnings: string[] = [];

  // ── ЛЁГКИЙ КОНТУР: easy / recovery / long → якорь лёгкого, множители НЕ применяются ──
  if (EASY_INTENTS.includes(intent)) {
    if (!a.easy) {
      return { ok: false, intent, reason: "no_easy_anchor_and_no_fallback",
        detail: "нет ни своего якоря лёгкого, ни зоны 2, ни порога для когортного отношения" };
    }
    let fast = a.easy.fastSec;
    let slow = a.easy.slowSec;

    // recovery — только медленный конец лёгкой полосы: восстановительный не бежится по верхнему краю
    if (intent === "recovery") {
      fast = (a.easy.fastSec + a.easy.slowSec) / 2;
      slow = a.easy.slowSec + 15;
      warnings.push("recovery: полоса смещена в медленную половину лёгкого");
    }
    // long — тот же аэробный якорь; на длительной допускаем чуть более медленный низ
    if (intent === "long") slow = a.easy.slowSec + 10;

    // §2.6: быстрый край ЖЁСТКИЙ — никогда не быстрее якоря лёгкого. Полосу не расширяем
    // вверх по скорости даже при низком доверии, иначе теряется вся защита от растянутой зоны 2.
    const hardFastCapS = a.easy.fastSec;
    if (fast < hardFastCapS) fast = hardFastCapS;

    const targetMode = easyTargetModeForTier(a.tier);
    if (a.easy.source === "tp_zone2") warnings.push("лёгкий из зоны 2 TP (формула от порога), не индивидуальный якорь");
    if (a.easy.source === "cohort_ratio") warnings.push("лёгкий из когортного отношения — аварийный путь, доверие низкое");

    return {
      ok: true, intent,
      pctMin: a.threshold ? pct(a.threshold.paceSec, slow) : null,
      pctMax: a.threshold ? pct(a.threshold.paceSec, fast) : null,
      absPaceMinS: Math.round(fast), absPaceMaxS: Math.round(slow),
      targetMode, rpe: rpeFromPreset,
      confidence: a.easy.confidence, anchorSource: a.easy.source,
      hardFastCapS, warnings,
    };
  }

  // ── КАЧЕСТВО: всё от ПОРОГА. Нет порога — честно отказываемся, ничего не выдумываем ──
  if (QUALITY_INTENTS.includes(intent)) {
    if (!a.threshold) {
      return { ok: false, intent, reason: "no_threshold_cannot_do_quality",
        detail: "нет applied-порога: качество не назначаем, лёгкий/длительный — можем" };
    }
    const thr = a.threshold.paceSec;

    // ЯКОРЬ КАЧЕСТВА ИЗ ОПИСАНИЙ — приоритет. Проценты от порога давали полосу 41 с/км,
    // вдвое шире лёгкого, и перешагивали сам порог. Тренер пишет отрезки узко (медиана 13 с/км).
    if (a.quality && (intent === "threshold" || intent === "controlled_threshold")) {
      const q = a.quality;
      // ТОНКИЙ ЯКОРЬ ВИДЕН СЛОВАМИ. Пол существования якоря (effN 0.25) намеренно мягкий, чтобы
      // не терять покрытие, но тогда «доверие: low» в служебной строке мало: тренер должен
      // видеть, что числа держатся на единичных старых назначениях.
      if (q.confidence === "low") {
        warnings.push(`якорь качества тонкий${q.effectiveN != null ? ` (effN ${q.effectiveN.toFixed(2)})` : ""}`
          + ": полоса держится на единичных старых назначениях, доверие низкое");
      }
      return {
        ok: true, intent,
        pctMin: pct(thr, q.slowSec), pctMax: pct(thr, q.fastSec),
        absPaceMinS: q.fastSec, absPaceMaxS: q.slowSec,
        targetMode: "pace", rpe: rpeFromPreset,
        confidence: q.confidence, anchorSource: "quality_description",
        hardFastCapS: null, warnings,
      };
    }

    let fast: number, slow: number;

    let skipWiden = false;
    if (intent === "steady_tempo") {
      fast = thr * STEADY_PACE_MULT.fast; slow = thr * STEADY_PACE_MULT.slow;
    } else if (intent === "threshold" || intent === "controlled_threshold") {
      // Фолбэк без своего якоря: полоса ПОД порогом, верхний край не быстрее порога,
      // ширина ограничена сверху. Расширение по доверию (§2.5) к качеству НЕ применяем —
      // именно оно раздувало полосу до 41 с/км и выносило верх выше порога.
      fast = thr * QUALITY_FALLBACK_FAST_MULT;
      slow = Math.min(thr * QUALITY_FALLBACK_SLOW_MULT, fast + QUALITY_FALLBACK_MAX_BAND_S);
      skipWiden = true;
      warnings.push("полоса качества от порога (своего якоря нет), узкая, под порогом");
    } else { // vo2
      fast = thr / SPEED_FRACTION.z6_max; slow = thr / SPEED_FRACTION.z5_max;
    }

    let w = skipWiden ? { fast, slow } : widen(fast, slow, a.threshold.confidence);

    // ЗАЩИТА ОТ ПЕРЕБРОСА ЧЕРЕЗ ПОРОГ. Расширение полосы по доверию (§2.5) само по себе не знает
    // про смысл зоны и при низком доверии выносит край на другую сторону порога: steady получал
    // быстрый край thr×0.995 (быстрее порога, хотя он СУБ-пороговый), vo2 — медленный край
    // thr×1.021 (медленнее порога, хотя он НАД порогом). Полоса обязана оставаться в своей
    // полуплоскости, иначе «ровный» назначается быстрее «порогового». Спека этого не оговаривает.
    if (intent === "steady_tempo" && w.fast < thr) {
      w = { fast: thr, slow: w.slow };
      warnings.push("steady: быстрый край подрезан до порога (расширение по доверию вынесло его выше порога)");
    }
    if (intent === "vo2" && w.slow > thr) {
      w = { fast: w.fast, slow: thr };
      warnings.push("vo2: медленный край подрезан до порога (расширение по доверию опустило его ниже порога)");
    }
    if (a.threshold.source === "applied_threshold_bulk_only") warnings.push("порог из массовой простановки, не решение тренера");

    return {
      ok: true, intent,
      pctMin: pct(thr, w.slow), pctMax: pct(thr, w.fast),
      absPaceMinS: Math.round(w.fast), absPaceMaxS: Math.round(w.slow),
      targetMode: "pace", // качество всегда по темпу, независимо от тира (§2.7)
      rpe: rpeFromPreset,
      confidence: a.threshold.confidence, anchorSource: a.threshold.source,
      hardFastCapS: null, warnings,
    };
  }

  return { ok: false, intent, reason: "intent_out_of_scope_v1", detail: `intent ${intent} вне скоупа v1` };
}
