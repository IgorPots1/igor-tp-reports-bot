/**
 * Пороги уровней — раздел 6 наряда.
 *
 * Пороги из техзадания (125/199 € и 11000/19000 ₽) поставлены на глаз и не
 * проверялись. Считаем их по РЕАЛЬНОМУ распределению собранных цен, чтобы в
 * каждый уровень попадало осмысленное число моделей.
 *
 * Метод — квантили, а не круглые числа: круглый порог выглядит опрятно и
 * ничего не гарантирует, а квантиль по построению даёт заполненные корзины.
 * Берём терцили: нижняя треть — доступные, верхняя — топовые.
 */

export type TierThresholds = { low: number; mid: number };

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  return next !== undefined ? sorted[base] + rest * (next - sorted[base]) : sorted[base];
}

/** Округление вверх до «магазинной» ступени, чтобы порог читался как цена. */
function roundStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

export function thresholdsFromPrices(prices: number[], step: number): TierThresholds {
  const sorted = [...prices].filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
  return {
    low: roundStep(quantile(sorted, 1 / 3), step),
    mid: roundStep(quantile(sorted, 2 / 3), step),
  };
}

export function tierOf(price: number, t: TierThresholds): "low" | "mid" | "top" {
  return price <= t.low ? "low" : price <= t.mid ? "mid" : "top";
}

/** Сколько моделей попало в каждый уровень — проверка, что корзины не пустые. */
export function tierHistogram(prices: number[], t: TierThresholds): Record<string, number> {
  const out = { low: 0, mid: 0, top: 0 };
  for (const p of prices) out[tierOf(p, t)] += 1;
  return out;
}
