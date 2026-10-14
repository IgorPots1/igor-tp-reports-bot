/**
 * Трасса по схеме или описанию организатора (проверка метода, 14.10.2026).
 *
 *   npx tsx scripts/race-course/scheme-route.ts <spec.json> <out.gpx>
 *
 * spec.json: опорные точки, снятые человеком со схемы и привязанные к OSM (перекрёстки
 * улиц, развороты), и официальная длина дистанции:
 *   { "name": "...", "targetKm": 10,
 *     "waypoints": [[lat, lon], ...],
 *     "slide": { "index": 7, "from": [lat, lon], "to": [lat, lon] } }
 * Маршрут между точками прокладывает пешеходный OSRM (routing.openstreetmap.de, сервер
 * FOSSGIS: не чаще запроса в секунду, с User-Agent). Если задан slide, точка waypoints[index] (или несколько: тот же разворот на каждом круге)
 * (разворот, которого на схеме нет в метрах) двигается по отрезку from–to, пока длина
 * маршрута не совпадёт с targetKm: схема даёт форму, сертифицированная длина даёт разворот.
 * Повторы точки (туда и обратно по той же улице) задаются в waypoints явно.
 * Сеть только на чтение; пишет GPX и печатает длину.
 */

import { writeFileSync, readFileSync } from "node:fs";

import { cumulative, type LatLon } from "./geo";

const OSRM = "https://routing.openstreetmap.de/routed-foot/route/v1/foot";
const UA = "igorp.run race-course check (potseluevigoralexeevich@gmail.com)";

export type SchemeSpec = {
  name: string;
  targetKm?: number;
  waypoints: LatLon[];
  slide?: { index: number | number[]; from: LatLon; to: LatLon };
};

let last = 0;
/** Один запрос к OSRM: линия маршрута через все точки по порядку. */
export async function routeFoot(waypoints: LatLon[]): Promise<LatLon[]> {
  const wait = last + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  const coords = waypoints.map(([la, lo]) => `${lo.toFixed(6)},${la.toFixed(6)}`).join(";");
  // continue_straight=false: на развороте посреди улицы разрешаем развернуться, а не обходить квартал
  const url = `${OSRM}/${coords}?overview=full&geometries=geojson&continue_straight=false`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`OSRM: HTTP ${res.status}`);
  const j = (await res.json()) as { code: string; routes?: { geometry: { coordinates: [number, number][] } }[] };
  if (j.code !== "Ok" || !j.routes?.length) throw new Error(`OSRM: ${j.code}`);
  return j.routes[0].geometry.coordinates.map(([lo, la]) => [la, lo] as LatLon);
}

export const lengthKm = (line: LatLon[]) => cumulative(line)[line.length - 1] / 1000;

/** Разрыв в данных OSM: короткий участок, который маршрутизатор объезжает втрое дольше прямой
 *  (и больше чем на 400 м), — две дорожки на местности сходятся, а в OSM не соединены.
 *  Такой участок заменяем прямой и сообщаем о каждой вставке: её надо проверить глазами. */
const GAP_RATIO = 3;
const GAP_EXTRA_M = 400;
const legCache = new Map<string, LatLon[]>();
export const gaps: string[] = [];

async function routeLeg(a: LatLon, b: LatLon): Promise<LatLon[]> {
  const key = `${a.join(",")};${b.join(",")}`;
  const hit = legCache.get(key);
  if (hit) return hit;
  const line = await routeFoot([a, b]);
  const routed = lengthKm(line) * 1000;
  const straight = cumulative([a, b])[1];
  let out = line;
  if (routed > GAP_RATIO * straight && routed - straight > GAP_EXTRA_M) {
    out = [a, b];
    gaps.push(`прямая вставка ${a.map((v) => v.toFixed(5)).join(",")} → ${b.map((v) => v.toFixed(5)).join(",")}: ${Math.round(straight)} м вместо ${Math.round(routed)} м по OSM`);
  }
  legCache.set(key, out);
  return out;
}

/** Маршрут по участкам между соседними точками (участки кэшируются; повтор точки пропускается). */
export async function routeLegs(waypoints: LatLon[]): Promise<LatLon[]> {
  const out: LatLon[] = [waypoints[0]];
  for (let i = 1; i < waypoints.length; i++) {
    const a = waypoints[i - 1], b = waypoints[i];
    if (a[0] === b[0] && a[1] === b[1]) continue;
    out.push(...(await routeLeg(a, b)).slice(1));
  }
  return out;
}

/** Маршрут по спецификации; со slide подбирает разворот под targetKm (бисекция по положению разворота). */
export async function buildScheme(spec: SchemeSpec): Promise<{ line: LatLon[]; km: number; t?: number }> {
  if (!spec.slide || !spec.targetKm) {
    const line = await routeLegs(spec.waypoints);
    return { line, km: lengthKm(line) };
  }
  const { index, from, to } = spec.slide;
  const at = (t: number): LatLon => [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
  const run = async (t: number) => {
    const idx = Array.isArray(index) ? index : [index];
    const wp = spec.waypoints.map((p, i) => (idx.includes(i) ? at(t) : p));
    const line = await routeLegs(wp);
    return { line, km: lengthKm(line), t };
  };
  let lo = 0, hi = 1;
  let a = await run(lo), b = await run(hi);
  if (a.km > spec.targetKm || b.km < spec.targetKm) {
    throw new Error(`разворот вне отрезка: от ${a.km.toFixed(3)} до ${b.km.toFixed(3)} км при цели ${spec.targetKm}`);
  }
  let best = Math.abs(a.km - spec.targetKm) < Math.abs(b.km - spec.targetKm) ? a : b;
  for (let i = 0; i < 12 && Math.abs(best.km - spec.targetKm) > 0.005; i++) {
    const m = await run((lo + hi) / 2);
    if (Math.abs(m.km - spec.targetKm) < Math.abs(best.km - spec.targetKm)) best = m;
    if (m.km < spec.targetKm) { lo = m.t; a = m; } else { hi = m.t; b = m; }
  }
  return best;
}

export function toGpx(name: string, line: LatLon[]): string {
  const pts = line.map(([la, lo]) => `<trkpt lat="${la.toFixed(6)}" lon="${lo.toFixed(6)}"/>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="igorp.run scheme-route" xmlns="http://www.topografix.com/GPX/1/1">\n<trk><name>${name.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</name><trkseg>\n${pts}\n</trkseg></trk>\n</gpx>\n`;
}

async function main() {
  const [specPath, out] = process.argv.slice(2);
  if (!specPath || !out) throw new Error("scheme-route.ts <spec.json> <out.gpx>");
  const spec = JSON.parse(readFileSync(specPath, "utf8")) as SchemeSpec;
  const r = await buildScheme(spec);
  writeFileSync(out, toGpx(spec.name, r.line));
  console.log(`${spec.name}: ${r.km.toFixed(3)} км, ${r.line.length} точек${r.t != null ? `, разворот t=${r.t.toFixed(3)}` : ""} → ${out}`);
  for (const g of new Set(gaps)) console.log(`  ${g}`);
}

if (process.argv[1]?.endsWith("scheme-route.ts")) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
