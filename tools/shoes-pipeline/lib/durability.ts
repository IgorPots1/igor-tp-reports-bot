/**
 * Износостойкость подошвы 1–10 из абразивного теста.
 *
 * Схема просит шкалу 1–10 «из абразивного теста, где есть». Тест есть: RunRepeat
 * стачивает подошву и меряет ГЛУБИНУ ВЫРАБОТКИ в миллиметрах. Направление
 * обратное привычному — меньше миллиметров значит выносливее, — поэтому шкала
 * переворачивается, а не переносится.
 *
 * Границы берутся из реального распределения (5-й и 95-й перцентили), а не
 * назначаются круглыми числами: круглый порог выглядит опрятно и загоняет
 * половину базы в один балл. Крайние 5 % с каждой стороны упираются в 10 и 1 —
 * это и есть смысл краёв шкалы.
 */

export type WearBounds = { p5: number; p95: number };

export function wearBounds(wearMm: number[]): WearBounds {
  const s = [...wearMm].filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  const q = (p: number) => {
    const i = (s.length - 1) * p;
    const b = Math.floor(i);
    return s[b + 1] !== undefined ? s[b] + (i - b) * (s[b + 1] - s[b]) : s[b];
  };
  return { p5: q(0.05), p95: q(0.95) };
}

/** Меньше выработка — выше балл. 1 знак после запятой, как у softness. */
export function durabilityFromWear(wearMm: number, b: WearBounds): number {
  const span = b.p95 - b.p5;
  if (!(span > 0)) return 5;
  const raw = 10 - (9 * (wearMm - b.p5)) / span;
  return Math.min(10, Math.max(1, Math.round(raw * 10) / 10));
}
