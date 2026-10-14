/* Ветер на старте: роза по 8 румбам, медиана и p75, и сторона ветра на каждом километре.
 * Чистые функции без сети, их стережёт scripts/check-race-course.ts. */

import { RUMBS, rumbIndex } from "./geo";

export type WindSide = "head" | "tail" | "cross";
export type WindObs = { speed: number; dir: number; gust: number | null };

/** Перцентиль p (0..1) с линейной интерполяцией. */
export function percentile(values: number[], p: number): number {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * p;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** Преобладающее направление: румб, откуда ветер дует чаще всего (по числу часов).
 *  При равенстве побеждает румб с большей суммой скоростей. Штиль (< 0.5 м/с) в розу не идёт. */
export function prevailing(obs: WindObs[]): { dir: number; dirLabel: string; rose: number[] } {
  const count = new Array(8).fill(0);
  const sum = new Array(8).fill(0);
  for (const o of obs) {
    if (!(o.speed >= 0.5)) continue;
    const i = rumbIndex(o.dir);
    count[i]++;
    sum[i] += o.speed;
  }
  let best = 0;
  for (let i = 1; i < 8; i++) {
    if (count[i] > count[best] || (count[i] === count[best] && sum[i] > sum[best])) best = i;
  }
  return { dir: best * 45, dirLabel: RUMBS[best], rose: count };
}

export function windStats(obs: WindObs[], years: number) {
  const p = prevailing(obs);
  const gusts = obs.map((o) => o.gust).filter((g): g is number => g != null && Number.isFinite(g));
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return {
    dir: p.dir,
    dirLabel: p.dirLabel,
    medianMs: r1(percentile(obs.map((o) => o.speed), 0.5)),
    p75Ms: r1(percentile(obs.map((o) => o.speed), 0.75)),
    gustP75Ms: gusts.length ? r1(percentile(gusts, 0.75)) : 0,
    years,
    sample: obs.length,
  };
}

/** Угол между двумя направлениями, 0..180. */
export function angleBetween(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/** Сторона ветра для бегущего по азимуту runBearing при ветре, ДУЮЩЕМ ОТКУДА windFrom
 *  (метеорологическая конвенция). Бежим навстречу тому, откуда дует, значит ветер встречный:
 *  угол ≤ 45° встречный, ≥ 135° попутный, иначе боковой. */
export function windSide(runBearing: number, windFrom: number): WindSide {
  const a = angleBetween(runBearing, windFrom);
  if (a <= 45) return "head";
  if (a >= 135) return "tail";
  return "cross";
}
