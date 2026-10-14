/* Картинка трека на подложке OpenStreetMap для тренера (не для сайта): тайлы склеиваются
 * в одну PNG, поверх рисуются линии и подписи. Тайлы кэшируются на диске и качаются по одному
 * с паузой, как требует политика tile.openstreetmap.org. Подпись «© OpenStreetMap» обязательна. */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import type { LatLon } from "./geo";

const TILE = 256;
const UA = "igorp.run race-course check (potseluevigoralexeevich@gmail.com)";
const CACHE = path.join(os.homedir(), ".cache", "igorp-osm-tiles");

const lon2x = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z * TILE;
const lat2y = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z * TILE;
};

async function tile(z: number, x: number, y: number): Promise<Buffer> {
  const f = path.join(CACHE, `${z}-${x}-${y}.png`);
  if (existsSync(f)) return readFileSync(f);
  mkdirSync(CACHE, { recursive: true });
  await new Promise((r) => setTimeout(r, 300));
  const res = await fetch(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`тайл ${z}/${x}/${y}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(f, buf);
  return buf;
}

export type MapLine = { points: LatLon[]; color: string; width?: number; dash?: string; opacity?: number };
export type MapLabel = { at: LatLon; text: string; color?: string };

/** sharp из node_modules рабочего каталога (запуск из корня репозитория). */
function loadSharp() {
  const req = createRequire(path.join(process.cwd(), "package.json"));
  return req("sharp") as typeof import("sharp");
}

/** PNG с подложкой OSM под рамку bbox (или под все линии) шириной не больше maxW. */
export async function renderMap(out: string, opts: { lines: MapLine[]; labels?: MapLabel[]; title?: string; bbox?: [number, number, number, number]; maxW?: number; maxH?: number; zoom?: number }) {
  const all = opts.lines.flatMap((l) => l.points);
  const [minLat, maxLat, minLon, maxLon] = opts.bbox ?? [
    Math.min(...all.map((p) => p[0])), Math.max(...all.map((p) => p[0])),
    Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[1])),
  ];
  const W = opts.maxW ?? 1400, H = opts.maxH ?? 1100, PAD = 40;
  let z = opts.zoom ?? 17;
  if (!opts.zoom) while (z > 8 && (lon2x(maxLon, z) - lon2x(minLon, z) > W - 2 * PAD || lat2y(minLat, z) - lat2y(maxLat, z) > H - 2 * PAD)) z--;
  const ox = (lon2x(minLon, z) + lon2x(maxLon, z)) / 2 - W / 2;
  const oy = (lat2y(minLat, z) + lat2y(maxLat, z)) / 2 - H / 2;
  const sharp = loadSharp();
  const comps: { input: Buffer; left: number; top: number }[] = [];
  for (let tx = Math.floor(ox / TILE); tx <= Math.floor((ox + W) / TILE); tx++) {
    for (let ty = Math.floor(oy / TILE); ty <= Math.floor((oy + H) / TILE); ty++) {
      const left = Math.round(tx * TILE - ox), top = Math.round(ty * TILE - oy);
      let img = sharp(await tile(z, tx, ty));
      // обрезаем тайлы, вылезающие за холст: sharp не кладёт их с отрицательным сдвигом
      const l0 = Math.max(0, -left), t0 = Math.max(0, -top);
      const w = Math.min(TILE - l0, W - Math.max(0, left)), h = Math.min(TILE - t0, H - Math.max(0, top));
      if (w <= 0 || h <= 0) continue;
      img = img.extract({ left: l0, top: t0, width: w, height: h });
      comps.push({ input: await img.png().toBuffer(), left: Math.max(0, left), top: Math.max(0, top) });
    }
  }
  const px = (p: LatLon) => [lon2x(p[1], z) - ox, lat2y(p[0], z) - oy];
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const svg: string[] = [`<rect width="${W}" height="${H}" fill="#fff" fill-opacity="0.25"/>`];
  for (const l of opts.lines) {
    const pts = l.points.map((p) => px(p).map((v) => v.toFixed(1)).join(",")).join(" ");
    svg.push(`<polyline points="${pts}" fill="none" stroke="#fff" stroke-width="${(l.width ?? 4) + 3}" stroke-opacity="${(l.opacity ?? 1) * 0.8}" stroke-linejoin="round"/>`);
    svg.push(`<polyline points="${pts}" fill="none" stroke="${l.color}" stroke-width="${l.width ?? 4}" stroke-opacity="${l.opacity ?? 1}" stroke-linejoin="round" ${l.dash ? `stroke-dasharray="${l.dash}"` : ""}/>`);
  }
  for (const lb of opts.labels ?? []) {
    const [x, y] = px(lb.at);
    svg.push(`<circle cx="${x}" cy="${y}" r="6" fill="${lb.color ?? "#111"}"/>`);
    svg.push(`<text x="${x + 9}" y="${y + 5}" font-family="Helvetica, Arial" font-size="17" font-weight="700" fill="#111" stroke="#fff" stroke-width="3" paint-order="stroke">${esc(lb.text)}</text>`);
  }
  if (opts.title) svg.push(`<rect x="0" y="0" width="${W}" height="44" fill="#fff" fill-opacity="0.9"/><text x="16" y="30" font-family="Helvetica, Arial" font-size="22" font-weight="700" fill="#111">${esc(opts.title)}</text>`);
  svg.push(`<text x="${W - 10}" y="${H - 10}" text-anchor="end" font-family="Helvetica, Arial" font-size="14" fill="#333" stroke="#fff" stroke-width="3" paint-order="stroke">© OpenStreetMap contributors</text>`);
  comps.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${svg.join("")}</svg>`), left: 0, top: 0 });
  await sharp({ create: { width: W, height: H, channels: 4, background: "#ffffff" } }).composite(comps).png().toFile(out);
  return { zoom: z, toPixel: px };
}
