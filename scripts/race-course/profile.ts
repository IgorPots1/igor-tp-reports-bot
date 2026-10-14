/* Профиль высот: сглаживание, набор и сброс всего и по километрам, участки подъёмов и спусков.
 * Чистые функции без сети, их стережёт scripts/check-race-course.ts. */

import { bearing, type LatLon } from "./geo";

/** Скользящее среднее по ДИСТАНЦИИ: окно windowM метров с центром в точке.
 *  По дистанции, а не по числу точек: шаг на концах трека бывает короче. */
export function smoothByDistance(distM: number[], elev: number[], windowM: number): number[] {
  const half = windowM / 2;
  const out: number[] = [];
  let lo = 0, hi = 0, sum = 0;
  for (let i = 0; i < elev.length; i++) {
    while (hi < elev.length && distM[hi] <= distM[i] + half) sum += elev[hi++];
    while (distM[lo] < distM[i] - half) sum -= elev[lo++];
    out.push(sum / (hi - lo));
  }
  return out;
}

/** Набор и сброс: сумма положительных и отрицательных разниц соседних точек. */
export function gainLoss(elev: number[]): { gain: number; loss: number } {
  let gain = 0, loss = 0;
  for (let i = 1; i < elev.length; i++) {
    const d = elev[i] - elev[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  return { gain, loss };
}

export type KmStat = { km: number; gain: number; loss: number; bearing: number };

/** По каждому километру: набор, сброс и азимут участка (от точки начала км к точке конца).
 *  km — номер километра с 1; последний может быть неполным. Разница между точками,
 *  лежащими по разные стороны границы км, относится к километру, где лежит правая точка. */
export function perKm(distM: number[], elev: number[], points: LatLon[]): KmStat[] {
  const out: KmStat[] = [];
  if (distM.length < 2) return out;
  const total = distM[distM.length - 1];
  const kms = Math.ceil(total / 1000 - 1e-9);
  for (let k = 0; k < kms; k++) {
    const from = k * 1000, to = Math.min(total, (k + 1) * 1000);
    let gain = 0, loss = 0, first = -1, last = -1;
    for (let i = 0; i < distM.length; i++) {
      if (distM[i] < from || distM[i] > to) continue;
      if (first < 0) first = i;
      last = i;
      if (i > 0 && distM[i] > from) {
        const d = elev[i] - elev[i - 1];
        if (d > 0) gain += d;
        else loss -= d;
      }
    }
    const a = points[Math.max(0, first)], b = points[Math.max(0, last)];
    out.push({ km: k + 1, gain, loss, bearing: first >= 0 && last > first ? Math.round(bearing(a, b)) : 0 });
  }
  return out;
}

export type Segment = { kind: "up" | "down"; fromM: number; toM: number; delta: number };

/** Участки подъёма и спуска с гистерезисом: направление меняется, только когда откат от
 *  экстремума превысил hysteresisM метров. Так рябь DEM не дробит длинный подъём на куски. */
export function segments(distM: number[], elev: number[], hysteresisM = 3): Segment[] {
  const out: Segment[] = [];
  if (elev.length < 2) return out;
  let dir: "up" | "down" | null = null;
  let startI = 0, extI = 0;
  for (let i = 1; i < elev.length; i++) {
    if (dir === null) {
      if (elev[i] - elev[startI] >= hysteresisM) { dir = "up"; extI = i; }
      else if (elev[startI] - elev[i] >= hysteresisM) { dir = "down"; extI = i; }
      else if (Math.abs(elev[i] - elev[startI]) < 1e-9) startI = i;
      continue;
    }
    if (dir === "up") {
      if (elev[i] >= elev[extI]) extI = i;
      else if (elev[extI] - elev[i] >= hysteresisM) {
        out.push({ kind: "up", fromM: distM[startI], toM: distM[extI], delta: elev[extI] - elev[startI] });
        dir = "down"; startI = extI; extI = i;
      }
    } else {
      if (elev[i] <= elev[extI]) extI = i;
      else if (elev[i] - elev[extI] >= hysteresisM) {
        out.push({ kind: "down", fromM: distM[startI], toM: distM[extI], delta: elev[startI] - elev[extI] });
        dir = "up"; startI = extI; extI = i;
      }
    }
  }
  if (dir) out.push({ kind: dir, fromM: distM[startI], toM: distM[extI], delta: Math.abs(elev[extI] - elev[startI]) });
  return out;
}

/** Профиль для публикации: [км, высота м] каждые stepM метров (по ближайшей точке ряда). */
export function profileSeries(distM: number[], elev: number[], stepM = 100): [number, number][] {
  const out: [number, number][] = [];
  const total = distM[distM.length - 1] ?? 0;
  let j = 0;
  for (let d = 0; d <= total + 1e-6; d += stepM) {
    while (j < distM.length - 1 && Math.abs(distM[j + 1] - d) <= Math.abs(distM[j] - d)) j++;
    out.push([Math.round(d / 10) / 100, Math.round(elev[j] * 10) / 10]);
  }
  if (out.length && out[out.length - 1][0] < Math.round(total / 10) / 100) {
    out.push([Math.round(total / 10) / 100, Math.round(elev[elev.length - 1] * 10) / 10]);
  }
  return out;
}
