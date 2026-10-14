/* Профиль высот и карта трека для страницы разбора трассы. Без библиотек: SVG и тайлы
 * OpenStreetMap (подпись «© OpenStreetMap» обязательна по условиям OSM). Рисуется на сервере. */

import type { CourseData, WindSide } from "@/features/race-course/types";

import styles from "./trassa.module.css";

/** Точка трека на километре km (по накопленному расстоянию). */
export function pointAtKm(track: [number, number][], km: number): [number, number] {
  const R = 6371;
  const rad = (x: number) => (x * Math.PI) / 180;
  let acc = 0;
  for (let i = 1; i < track.length; i++) {
    const [a1, o1] = track[i - 1];
    const [a2, o2] = track[i];
    const h = Math.sin(rad(a2 - a1) / 2) ** 2 + Math.cos(rad(a1)) * Math.cos(rad(a2)) * Math.sin(rad(o2 - o1) / 2) ** 2;
    acc += 2 * R * Math.asin(Math.sqrt(h));
    if (acc >= km) return track[i];
  }
  return track[track.length - 1];
}

export function ProfileChart({ c }: { c: CourseData }) {
  const W = 760;
  const H = 220;
  const pad = { l: 44, r: 12, t: 14, b: 28 };
  const xs = c.elevation.map(([k]) => k);
  const ys = c.elevation.map(([, m]) => m);
  const maxK = Math.max(...xs, c.distanceKm);
  let lo = Math.min(...ys);
  let hi = Math.max(...ys);
  // плоская трасса не должна выглядеть горной: шкала не меньше 40 м
  if (hi - lo < 40) {
    const mid = (hi + lo) / 2;
    lo = mid - 20;
    hi = mid + 20;
  }
  const x = (k: number) => pad.l + (k / maxK) * (W - pad.l - pad.r);
  const y = (m: number) => pad.t + (1 - (m - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const line = c.elevation.map(([k, m], i) => `${i ? "L" : "M"}${x(k).toFixed(1)},${y(m).toFixed(1)}`).join(" ");
  const area = `${line} L${x(xs[xs.length - 1]).toFixed(1)},${H - pad.b} L${x(xs[0]).toFixed(1)},${H - pad.b} Z`;
  const step = maxK > 60 ? 10 : maxK > 25 ? 5 : maxK > 10 ? 2 : 1;
  const ticks: number[] = [];
  for (let k = 0; k <= maxK + 1e-9; k += step) ticks.push(k);
  const elevAt = (k: number) => c.elevation.reduce((best, p) => (Math.abs(p[0] - k) < Math.abs(best[0] - k) ? p : best), c.elevation[0])[1];
  return (
    <svg className={styles.chart} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Профиль высот: набор ${c.gain} м, сброс ${c.loss} м`}>
      <path d={area} className={styles.area} />
      <path d={line} className={styles.line} />
      <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} className={styles.axis} />
      {ticks.map((k) => (
        <text key={k} x={x(k)} y={H - 8} className={styles.tick} textAnchor="middle">
          {k}
        </text>
      ))}
      <text x={6} y={y(hi) + 4} className={styles.tick}>
        {Math.round(hi)} м
      </text>
      <text x={6} y={y(lo) + 4} className={styles.tick}>
        {Math.round(lo)} м
      </text>
      {c.keyPoints.map((p, i) => (
        <g key={i}>
          <circle cx={x(p.km)} cy={y(elevAt(p.km))} r={9} className={styles.mark} />
          <text x={x(p.km)} y={y(elevAt(p.km)) + 4} className={styles.markText} textAnchor="middle">
            {i + 1}
          </text>
        </g>
      ))}
    </svg>
  );
}

const TILE = 256;
const lon2x = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z * TILE;
const lat2y = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z * TILE;
};

/** Карта: тайлы OpenStreetMap под трек, трек и номера ключевых точек поверх. */
export function CourseMap({ c }: { c: CourseData }) {
  const W = 760;
  const H = 440;
  const lats = c.track.map((p) => p[0]);
  const lons = c.track.map((p) => p[1]);
  const [minLat, maxLat, minLon, maxLon] = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)];
  let z = 16;
  while (z > 8 && (lon2x(maxLon, z) - lon2x(minLon, z) > W - 60 || lat2y(minLat, z) - lat2y(maxLat, z) > H - 60)) z--;
  const cx = (lon2x(minLon, z) + lon2x(maxLon, z)) / 2;
  const cy = (lat2y(minLat, z) + lat2y(maxLat, z)) / 2;
  const ox = cx - W / 2;
  const oy = cy - H / 2;
  const tiles: { x: number; y: number }[] = [];
  for (let tx = Math.floor(ox / TILE); tx <= Math.floor((ox + W) / TILE); tx++) {
    for (let ty = Math.floor(oy / TILE); ty <= Math.floor((oy + H) / TILE); ty++) tiles.push({ x: tx, y: ty });
  }
  const px = ([lat, lon]: [number, number]) => [lon2x(lon, z) - ox, lat2y(lat, z) - oy] as const;
  const pts = c.track.map((p) => px(p).map((v) => v.toFixed(1)).join(",")).join(" ");
  const [sx, sy] = px(c.track[0]);
  const [fx, fy] = px(c.track[c.track.length - 1]);
  return (
    <div className={styles.map} style={{ aspectRatio: `${W} / ${H}` }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Карта трассы">
        {tiles.map((t) => (
          <image
            key={`${t.x}-${t.y}`}
            href={`https://tile.openstreetmap.org/${z}/${t.x}/${t.y}.png`}
            x={t.x * TILE - ox}
            y={t.y * TILE - oy}
            width={TILE}
            height={TILE}
          />
        ))}
        <polyline points={pts} className={styles.trackHalo} />
        <polyline points={pts} className={styles.track} />
        <circle cx={sx} cy={sy} r={7} className={styles.start} />
        <circle cx={fx} cy={fy} r={7} className={styles.finish} />
        {c.keyPoints.map((p, i) => {
          const [kx, ky] = px(pointAtKm(c.track, p.km));
          return (
            <g key={i}>
              <circle cx={kx} cy={ky} r={10} className={styles.mark} />
              <text x={kx} y={ky + 4} className={styles.markText} textAnchor="middle">
                {i + 1}
              </text>
            </g>
          );
        })}
      </svg>
      <span className={styles.attrib}>
        © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>
      </span>
    </div>
  );
}

const SIDE: Record<WindSide, string> = { head: "встречный", tail: "попутный", cross: "боковой" };

/** Полоса по километрам: встречный, попутный, боковой. */
export function WindStrip({ c }: { c: CourseData }) {
  return (
    <div className={styles.strip} role="img" aria-label="Ветер по километрам">
      {c.perKm.map((k) => (
        <span key={k.km} className={`${styles.cell} ${styles[k.wind]}`} title={`${k.km} км: ${SIDE[k.wind]}`} />
      ))}
    </div>
  );
}
