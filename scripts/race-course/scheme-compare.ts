/**
 * Сверка трассы, восстановленной по схеме, с эталонным треком (проверка метода, 14.10.2026).
 *
 *   npx tsx scripts/race-course/scheme-compare.ts <ours.gpx> [<reference.gpx>] --scheme <organizer.png> --out <dir> --name <slug> [--title "..."]
 *
 * Считает: длину обоих, расхождение линий в метрах (от каждой точки одного трека до ближайшего
 * отрезка другого, в обе стороны: максимум, 95-й процентиль, доля точек ближе 50 м), набор
 * высоты по одному DEM (Open-Meteo, Copernicus 90 м) для обоих, чтобы разница была в линии,
 * а не в источнике высот. Рисует <slug>-map.png (наш трек и эталон на OSM) и <slug>-side.png
 * (схема организатора слева, наш трек справа). Без эталона только длина, набор и картинки.
 * Сеть только на чтение; файлы вне репозитория.
 */

import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { cumulative, resample, type LatLon } from "./geo";
import { renderMap } from "./osm-map";
import { gainLoss, smoothByDistance } from "./profile";
import { fetchElevations, readGpx } from "./sources";

const STEP_M = 50;
const SMOOTH_M = 250;
const NEAR_M = 50;

const argv = process.argv.slice(2);
const opt = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const files = argv.filter((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));

/** Расстояние от точки до ближайшего отрезка линии, метры (локальная плоская проекция). */
export function distToLine(p: LatLon, line: LatLon[]): number {
  const k = Math.cos((p[0] * Math.PI) / 180) * 111320;
  const m = 110540;
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const ax = (line[i - 1][1] - p[1]) * k, ay = (line[i - 1][0] - p[0]) * m;
    const bx = (line[i][1] - p[1]) * k, by = (line[i][0] - p[0]) * m;
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best) best = d;
  }
  return best;
}

export function deviation(a: LatLon[], b: LatLon[]) {
  const ra = resample(a, 25).points, rb = resample(b, 25).points;
  const ds = [...ra.map((p) => distToLine(p, b)), ...rb.map((p) => distToLine(p, a))].sort((x, y) => x - y);
  return {
    max: ds[ds.length - 1],
    p95: ds[Math.floor(ds.length * 0.95)],
    median: ds[Math.floor(ds.length / 2)],
    nearShare: ds.filter((d) => d < NEAR_M).length / ds.length,
    worst: [...ra.map((p) => ({ p, d: distToLine(p, b) }))].sort((x, y) => y.d - x.d)[0],
  };
}

async function demGain(line: LatLon[]) {
  const r = resample(line, STEP_M);
  const elev = await fetchElevations(r.points);
  return gainLoss(smoothByDistance(r.distM, elev, SMOOTH_M));
}

async function main() {
  const [oursPath, refPath] = files;
  const out = opt("out")!, name = opt("name")!, scheme = opt("scheme");
  const ours = readGpx(oursPath);
  const ref = refPath ? readGpx(refPath) : null;
  const km = (l: LatLon[]) => cumulative(l)[l.length - 1] / 1000;
  const report: Record<string, unknown> = { ours: { km: +km(ours).toFixed(3) } };
  const g = await demGain(ours);
  (report.ours as Record<string, unknown>).gainDem = Math.round(g.gain);
  if (ref) {
    const gr = await demGain(ref);
    const dev = deviation(ours, ref);
    report.reference = { km: +km(ref).toFixed(3), gainDem: Math.round(gr.gain) };
    report.lengthDiffPct = +(((km(ours) - km(ref)) / km(ref)) * 100).toFixed(2);
    report.deviation = { maxM: Math.round(dev.max), p95M: Math.round(dev.p95), medianM: Math.round(dev.median), nearShare: +dev.nearShare.toFixed(3), worstAt: dev.worst.p.map((v) => +v.toFixed(5)) };
    report.verdict = Math.abs(report.lengthDiffPct as number) <= 3 && dev.nearShare >= 0.95 ? "годится" : "не годится";
  }
  writeFileSync(path.join(out, `${name}-compare.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  const lines = [{ points: ours, color: "#d62828", width: 5 }];
  if (ref) lines.unshift({ points: ref, color: "#1d4ed8", width: 9, opacity: 0.45 } as never);
  const mapPng = path.join(out, `${name}-map.png`);
  await renderMap(mapPng, {
    lines,
    labels: [{ at: ours[0], text: "старт", color: "#111" }],
    title: opt("title") ?? (ref ? "красный: по схеме, синий: трек организатора" : "трек по схеме"),
    maxW: 1200, maxH: 1200,
  });
  if (scheme) {
    const sharp = createRequire(path.join(process.cwd(), "package.json"))("sharp") as typeof import("sharp");
    const H = 1200;
    const left = await sharp(scheme).resize({ height: H, width: 1200, fit: "inside", background: "#fff" }).png().toBuffer();
    const lm = await sharp(left).metadata();
    await sharp({ create: { width: (lm.width ?? 1200) + 1200 + 20, height: H, channels: 4, background: "#ffffff" } })
      .composite([{ input: left, left: 0, top: Math.round((H - (lm.height ?? H)) / 2) }, { input: mapPng, left: (lm.width ?? 1200) + 20, top: 0 }])
      .png().toFile(path.join(out, `${name}-side.png`));
  }
}

if (process.argv[1]?.endsWith("scheme-compare.ts")) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
