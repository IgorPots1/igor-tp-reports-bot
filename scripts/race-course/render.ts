/* Картинка профиля высот для тренера (не для сайта): SVG, затем PNG через sharp,
 * который уже стоит в зависимостях проекта. Пишется вне репозитория. */

import { writeFileSync } from "node:fs";

import type { KeyPoint } from "./key-points";
import type { WindSide } from "./wind";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function profileSvg(input: {
  title: string;
  subtitle: string;
  elevation: [number, number][];
  perKm: { km: number; wind: WindSide }[];
  keyPoints: KeyPoint[];
}): string {
  const W = 1400, H = 560, L = 70, Rm = 30, T = 80, B = 120;
  const pw = W - L - Rm, ph = H - T - B;
  const el = input.elevation;
  const maxKm = el.length ? el[el.length - 1][0] : 1;
  const ys = el.map((e) => e[1]);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  const span = Math.max(30, hi - lo);
  lo = Math.floor((lo - span * 0.15) / 10) * 10;
  hi = Math.ceil((hi + span * 0.15) / 10) * 10;
  const x = (km: number) => L + (km / maxKm) * pw;
  const y = (m: number) => T + ph - ((m - lo) / (hi - lo)) * ph;

  const line = el.map((e, i) => `${i ? "L" : "M"}${x(e[0]).toFixed(1)},${y(e[1]).toFixed(1)}`).join("");
  const area = `${line}L${x(maxKm).toFixed(1)},${T + ph}L${L},${T + ph}Z`;

  const parts: string[] = [];
  parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  parts.push(`<text x="${L}" y="34" font-family="Helvetica, Arial, sans-serif" font-size="24" font-weight="700" fill="#111">${esc(input.title)}</text>`);
  parts.push(`<text x="${L}" y="60" font-family="Helvetica, Arial, sans-serif" font-size="16" fill="#444">${esc(input.subtitle)}</text>`);

  const stepY = (hi - lo) / 5 >= 20 ? Math.ceil((hi - lo) / 5 / 10) * 10 : Math.max(2, Math.ceil((hi - lo) / 5));
  for (let m = Math.ceil(lo / stepY) * stepY; m <= hi; m += stepY) {
    parts.push(`<line x1="${L}" x2="${L + pw}" y1="${y(m)}" y2="${y(m)}" stroke="#e5e5e5"/>`);
    parts.push(`<text x="${L - 8}" y="${y(m) + 5}" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="13" fill="#666">${m}</text>`);
  }
  const kmStep = maxKm > 60 ? 10 : maxKm > 25 ? 5 : 1;
  for (let k = 0; k <= maxKm; k += kmStep) {
    parts.push(`<line x1="${x(k)}" x2="${x(k)}" y1="${T}" y2="${T + ph}" stroke="#f0f0f0"/>`);
    parts.push(`<text x="${x(k)}" y="${T + ph + 18}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="13" fill="#666">${k}</text>`);
  }
  parts.push(`<path d="${area}" fill="#cfe3f5"/>`);
  parts.push(`<path d="${line}" fill="none" stroke="#1f5f99" stroke-width="2"/>`);

  // Полоса ветра: по каждому км встречный / попутный / боковой.
  const color: Record<WindSide, string> = { head: "#d9534f", tail: "#4caf50", cross: "#c8c8c8" };
  const wy = T + ph + 30;
  for (const k of input.perKm) {
    const x0 = x(k.km - 1), x1 = x(Math.min(maxKm, k.km));
    parts.push(`<rect x="${x0.toFixed(1)}" y="${wy}" width="${Math.max(0, x1 - x0 - 1).toFixed(1)}" height="12" fill="${color[k.wind]}"/>`);
  }
  parts.push(`<text x="${L - 8}" y="${wy + 11}" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="12" fill="#666">ветер</text>`);
  parts.push(`<text x="${L}" y="${wy + 32}" font-family="Helvetica, Arial, sans-serif" font-size="12" fill="#666">красный: встречный, зелёный: попутный, серый: боковой (относительно преобладающего ветра)</text>`);

  // Ключевые точки: маркер и номер.
  input.keyPoints.forEach((p, i) => {
    const px = x(Math.min(maxKm, p.km));
    const near = el.reduce((best, e) => (Math.abs(e[0] - p.km) < Math.abs(best[0] - p.km) ? e : best), el[0] ?? [0, lo]);
    const py = y(near[1]);
    const fill = p.type === "climb" ? "#d9534f" : p.type === "descent" ? "#4caf50" : p.type === "wind" ? "#f0ad4e" : "#555";
    parts.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="11" fill="${fill}"/>`);
    parts.push(`<text x="${px.toFixed(1)}" y="${(py + 5).toFixed(1)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="13" font-weight="700" fill="#fff">${i + 1}</text>`);
  });
  const legend = input.keyPoints.map((p, i) => `${i + 1}) ${p.km} км`).join("   ");
  parts.push(`<text x="${L}" y="${H - 22}" font-family="Helvetica, Arial, sans-serif" font-size="13" fill="#333">${esc(legend)}</text>`);
  parts.push(`<text x="${W - Rm}" y="${T - 8}" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="13" fill="#666">км</text>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join("")}</svg>`;
}

/** SVG в PNG через sharp; если sharp не загрузился, кладём SVG рядом и говорим об этом. */
export async function writeProfileImage(svg: string, pngPath: string): Promise<string> {
  try {
    const sharp = (await import("sharp")).default;
    await sharp(Buffer.from(svg)).png().toFile(pngPath);
    return pngPath;
  } catch (e) {
    const svgPath = pngPath.replace(/\.png$/, ".svg");
    writeFileSync(svgPath, svg);
    console.warn(`PNG не получился (${(e as Error).message}), сохранил SVG: ${svgPath}`);
    return svgPath;
  }
}
