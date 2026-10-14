/* Геометрия трека для разбора трассы: расстояния, азимуты, передискретизация, упрощение.
 * Чистые функции без сети, их стережёт scripts/check-race-course.ts. */

export type LatLon = [number, number];

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Расстояние по большому кругу, метры. */
export function haversine(a: LatLon, b: LatLon): number {
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Начальный азимут от a к b, градусы 0..360 (0 = север, 90 = восток). */
export function bearing(a: LatLon, b: LatLon): number {
  const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
  const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Накопленная дистанция по точкам трека, метры; первый элемент 0. */
export function cumulative(points: LatLon[]): number[] {
  const out = [0];
  for (let i = 1; i < points.length; i++) out.push(out[i - 1] + haversine(points[i - 1], points[i]));
  return out;
}

/** Точки трека с равным шагом по дистанции (линейная интерполяция внутри отрезков).
 *  Последняя точка трека сохраняется, поэтому последний шаг может быть короче. */
export function resample(points: LatLon[], stepM: number): { points: LatLon[]; distM: number[] } {
  if (points.length < 2) return { points: [...points], distM: points.map(() => 0) };
  const cum = cumulative(points);
  const total = cum[cum.length - 1];
  const outP: LatLon[] = [];
  const outD: number[] = [];
  let j = 0;
  for (let d = 0; d < total; d += stepM) {
    while (j < cum.length - 2 && cum[j + 1] < d) j++;
    const seg = cum[j + 1] - cum[j];
    const t = seg > 0 ? (d - cum[j]) / seg : 0;
    outP.push([points[j][0] + (points[j + 1][0] - points[j][0]) * t, points[j][1] + (points[j + 1][1] - points[j][1]) * t]);
    outD.push(d);
  }
  outP.push(points[points.length - 1]);
  outD.push(total);
  return { points: outP, distM: outD };
}

/** Перпендикулярное отклонение точки p от отрезка a–b в метрах (локальная плоская проекция). */
function offsetM(p: LatLon, a: LatLon, b: LatLon): number {
  const k = Math.cos(rad(a[0]));
  const ax = 0, ay = 0;
  const bx = (b[1] - a[1]) * k, by = b[0] - a[0];
  const px = (p[1] - a[1]) * k, py = p[0] - a[0];
  const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
  const t = len2 > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
  const dx = px - t * bx, dy = py - t * by;
  return Math.sqrt(dx * dx + dy * dy) * 111320;
}

/** Дуглас–Пекер с допуском в метрах (итеративно, без рекурсии). */
export function simplify(points: LatLon[], toleranceM: number): LatLon[] {
  if (points.length <= 2) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let best = -1, bestD = 0;
    for (let i = s + 1; i < e; i++) {
      const d = offsetM(points[i], points[s], points[e]);
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best > 0 && bestD > toleranceM) {
      keep[best] = 1;
      stack.push([s, best], [best, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Упростить трек до не более чем maxPoints точек: допуск растёт, пока точек больше нужного. */
export function simplifyTo(points: LatLon[], maxPoints: number): LatLon[] {
  let tol = 2;
  let out = simplify(points, tol);
  while (out.length > maxPoints) {
    tol *= 1.5;
    out = simplify(points, tol);
  }
  return out;
}

/** Направление по 8 румбам: 0 → «С», 45 → «СВ» и т.д. */
export const RUMBS = ["С", "СВ", "В", "ЮВ", "Ю", "ЮЗ", "З", "СЗ"] as const;
export function rumbIndex(dirDeg: number): number {
  return Math.round((((dirDeg % 360) + 360) % 360) / 45) % 8;
}
