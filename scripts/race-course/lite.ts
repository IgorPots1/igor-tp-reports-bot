/* Урезанный разбор трассы без эталона набора (наряд 15.10.2026, решение Игоря).
 *
 * Эталона нет — ни цифры организатора, ни высот в его GPX, ни трека ученика: набор по DEM нечем
 * проверить, поэтому профиль высот и цифру набора НЕ показываем, вместо них «набор высоты
 * уточняется». Остаётся то, что от высот не зависит: карта, длина, ключевые точки по поворотам и
 * покрытию, ветер по участкам.
 *
 * Не публикуем вовсе: разборы, не прошедшие сверку (набор разошёлся с эталоном больше 30%, длина
 * трека не та), без трека и восстановленные по схемам. Урезанный — только когда единственная
 * причина отказа «нет эталона набора».
 *
 * Чистые функции без сети (их стережёт check:race-course); сеть — только fetchSurface (Overpass,
 * через politeFetch, с кэшем на диске). */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { windFrom, type CourseData, type CourseKeyPoint } from "@/features/race-course/types";
import { politeFetch } from "../lib/polite-fetch";
import { MIN_HEAD_RUN_KM, MIN_TAIL_RUN_KM, WIND_WORTH_MS } from "./key-points";

export const NO_REF_REASON = "нет эталона набора: ни цифры организатора, ни высот в его GPX, ни трека ученика";
export const LITE_GAIN_TEXT = "набор высоты уточняется";
export const SCHEME_REASON = "трасса восстановлена по схеме: не публикуем";

type LatLon = [number, number];

/** Можно ли публиковать урезанным: трек есть, не по схеме, и единственная причина отказа — нет эталона. */
export function liteEligible(c: Pick<CourseData, "track" | "source" | "checks">): boolean {
  return c.track.length >= 2 && !isScheme(c.source.kind) && !c.checks.publish && c.checks.reason === NO_REF_REASON;
}

/** Трасса, восстановленная по схеме организатора, — не публикуется ни полным, ни урезанным разбором. */
export function isScheme(kind: string): boolean {
  return /scheme|схем/i.test(kind);
}

// ── геометрия ─────────────────────────────────────────────────────────────────

const R = 6371000;
const rad = (x: number) => (x * Math.PI) / 180;
export function dist(a: LatLon, b: LatLon): number {
  const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function bearing(a: LatLon, b: LatLon): number {
  const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
  const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
const angleDiff = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/** Точки через каждые step м вдоль трека (линейная интерполяция) и их дистанция от старта. */
export function resampleLine(track: LatLon[], step: number): { points: LatLon[]; distM: number[] } {
  const points: LatLon[] = [track[0]], distM = [0];
  let acc = 0, next = step;
  for (let i = 1; i < track.length; i++) {
    const seg = dist(track[i - 1], track[i]);
    while (seg > 0 && acc + seg >= next) {
      const t = (next - acc) / seg;
      points.push([track[i - 1][0] + (track[i][0] - track[i - 1][0]) * t, track[i - 1][1] + (track[i][1] - track[i - 1][1]) * t]);
      distM.push(next);
      next += step;
    }
    acc += seg;
  }
  if (acc - distM[distM.length - 1] > 1) { points.push(track[track.length - 1]); distM.push(acc); }
  return { points, distM };
}

// ── повороты ──────────────────────────────────────────────────────────────────

/** Крутой поворот — от стольких градусов (направление за 60 м до и 60 м после точки). */
export const SHARP_DEG = 100;
/** Разворот — от стольких градусов: бег туда-обратно, разворот вокруг конуса. */
export const UTURN_DEG = 150;
/** Серпантин: столько крутых поворотов подряд на отрезке не длиннее SERP_SPAN_M. */
export const SERP_MIN = 3;
export const SERP_SPAN_M = 600;

export type Turn = { m: number; deg: number };

/** Крутые повороты по треку: пик угла, повороты ближе 150 м сливаются, старт/финиш (200 м) не в счёт. */
export function findTurns(track: LatLon[]): Turn[] {
  if (track.length < 3) return [];
  const STEP = 20, ARM = 3; // 60 м до и после
  const { points, distM } = resampleLine(track, STEP);
  const total = distM[distM.length - 1];
  const raw: Turn[] = [];
  for (let i = ARM; i < points.length - ARM; i++) {
    const deg = angleDiff(bearing(points[i - ARM], points[i]), bearing(points[i], points[i + ARM]));
    if (deg >= SHARP_DEG && distM[i] > 200 && distM[i] < total - 200) raw.push({ m: distM[i], deg });
  }
  const out: Turn[] = [];
  for (const t of raw) {
    const last = out[out.length - 1];
    if (last && t.m - last.m < 150) { if (t.deg > last.deg) out[out.length - 1] = t; } else out.push(t);
  }
  return out.map((t) => ({ m: Math.round(t.m), deg: Math.round(t.deg) }));
}

// ── покрытие ──────────────────────────────────────────────────────────────────

export type Surface = "асфальт" | "грунт" | "тропа";
export type OsmWay = { tags: Record<string, string>; geometry: { lat: number; lon: number }[] };

const PAVED = /^(asphalt|paved|concrete(:.*)?|paving_stones|sett|chipseal|metal|wood|unhewn_cobblestone|cobblestone)$/;
const UNPAVED = /^(unpaved|gravel|fine_gravel|compacted|dirt|earth|ground|grass|sand|mud|pebblestone|rock|woodchips|grass_paver)$/;

/** Класс покрытия по тегам OSM: surface, а без него — по типу дороги. null — не понять. */
export function surfaceOf(tags: Record<string, string>): Surface | null {
  const s = tags.surface;
  const hw = tags.highway ?? "";
  if (s && PAVED.test(s)) return "асфальт";
  if (s && UNPAVED.test(s)) return hw === "path" || hw === "footway" || hw === "bridleway" ? (/(dirt|earth|ground|grass|mud|rock|sand)/.test(s) ? "тропа" : "грунт") : "грунт";
  if (hw === "track") return "грунт";
  if (hw === "path" || hw === "bridleway") return "тропа";
  if (/^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street|pedestrian|cycleway)(_link)?$/.test(hw)) return "асфальт";
  return null; // footway, steps и прочее без surface — не гадаем
}

/** Расстояние от точки до отрезка, м (локальная плоская проекция — на десятках метров хватает). */
function pointSegM(p: LatLon, a: LatLon, b: LatLon): number {
  const k = Math.cos(rad(p[0])) * 111320, kLat = 110540;
  const ax = (a[1] - p[1]) * k, ay = (a[0] - p[0]) * kLat, bx = (b[1] - p[1]) * k, by = (b[0] - p[0]) * kLat;
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/** Покрытие в точках трека через каждые 100 м: ближайшая дорога OSM не дальше 25 м. */
export function surfaceSamples(track: LatLon[], ways: OsmWay[], step = 100): { m: number; s: Surface | null }[] {
  const { points, distM } = resampleLine(track, step);
  const segs = ways.flatMap((w) => {
    const s = surfaceOf(w.tags);
    const g = w.geometry.map((p) => [p.lat, p.lon] as LatLon);
    return g.slice(1).map((b, i) => ({ a: g[i], b, s, minLat: Math.min(g[i][0], b[0]), maxLat: Math.max(g[i][0], b[0]), minLon: Math.min(g[i][1], b[1]), maxLon: Math.max(g[i][1], b[1]) }));
  });
  const PAD = 0.0004; // ~40 м
  return points.map((p, i) => {
    let best: { d: number; s: Surface | null } | null = null;
    for (const g of segs) {
      if (p[0] < g.minLat - PAD || p[0] > g.maxLat + PAD || p[1] < g.minLon - PAD || p[1] > g.maxLon + PAD) continue;
      const d = pointSegM(p, g.a, g.b);
      // при равной близости известное покрытие важнее неизвестного
      if (d <= 25 && (!best || d < best.d - 3 || (Math.abs(d - best.d) <= 3 && !best.s && g.s))) best = { d, s: g.s };
    }
    return { m: Math.round(distM[i]), s: best?.s ?? null };
  });
}

export type SurfaceRun = { from: number; to: number; s: Surface };

/** Участки одного покрытия от 500 м: неизвестные точки и короткие вставки поглощаются соседями. */
export function surfaceRuns(samples: { m: number; s: Surface | null }[], minM = 500): SurfaceRun[] {
  if (!samples.length) return [];
  const step = samples.length > 1 ? samples[1].m - samples[0].m : 100;
  let runs: (SurfaceRun & { s: Surface | null })[] = [];
  for (const x of samples) {
    const last = runs[runs.length - 1];
    if (last && last.s === x.s) last.to = x.m + step; else runs.push({ from: x.m, to: x.m + step, s: x.s });
  }
  // короткие и неизвестные куски сливаем с более длинным соседом, пока такие есть
  for (;;) {
    const i = runs.findIndex((r) => r.s === null || r.to - r.from < minM);
    if (i < 0 || runs.length === 1) break;
    const prev = runs[i - 1], next = runs[i + 1];
    const into = !prev ? next : !next ? prev : prev.s === null ? next : next.s === null ? prev : prev.to - prev.from >= next.to - next.from ? prev : next;
    if (into === prev) prev.to = runs[i].to; else { next.from = runs[i].from; }
    runs.splice(i, 1);
    // соседи одного покрытия — один участок
    runs = runs.reduce<typeof runs>((acc, r) => { const l = acc[acc.length - 1]; if (l && l.s === r.s) l.to = r.to; else acc.push(r); return acc; }, []);
  }
  return runs.filter((r): r is SurfaceRun => r.s !== null);
}

/** Доли покрытий по точкам, %, только известные; known — какая доля трассы вообще определена. */
export function surfaceShare(samples: { s: Surface | null }[]): { share: Partial<Record<Surface, number>>; known: number } {
  const known = samples.filter((x) => x.s);
  const share: Partial<Record<Surface, number>> = {};
  for (const x of known) share[x.s!] = (share[x.s!] ?? 0) + 1;
  for (const k of Object.keys(share) as Surface[]) share[k] = Math.round((share[k]! / known.length) * 100);
  return { share, known: samples.length ? Math.round((known.length / samples.length) * 100) : 0 };
}

// ── ключевые точки ────────────────────────────────────────────────────────────

type Cand = CourseKeyPoint & { prio: number };
const kmOf = (m: number) => Math.max(0.1, Math.round(m / 100) / 10);
const ruKm = (x: number) => String(x).replace(".", ",");

/** Шкала сложности покрытия (решение Игоря 16.10.2026): асфальт → грунт → тропа. */
const HARDNESS: Record<Surface, number> = { асфальт: 0, грунт: 1, тропа: 2 };

/** Подсказка на смене покрытия по НАПРАВЛЕНИЮ: стало тяжелее — «шаг короче, смотри под ноги»,
 *  стало легче — «можно вернуться в свой темп, без рывка». Было (до 16.10.2026): текст зависел только
 *  от того, КУДА сменилось, и «тропа → грунт» у Borisovo читалось как усложнение. */
export function surfaceText(from: Surface, to: Surface, trail: boolean): string {
  if (HARDNESS[to] > HARDNESS[from]) return `дальше ${to}: шаг короче, ${trail ? "смотри" : "смотрите"} под ноги.`;
  return `дальше ${to}: можно вернуться в свой темп, без рывка.`;
}

/**
 * Ключевые точки урезанного разбора: повороты, смена покрытия и ветер. От высот не зависит ничего.
 * В выдаче до 6 точек, не ближе 0,5 км друг к другу, по порядку км.
 */
export function keyPointsLite(input: {
  totalM: number;
  trail: boolean;
  turns: Turn[];
  runs: SurfaceRun[];
  perKm: { km: number; wind: "head" | "tail" | "cross" }[];
  wind: { dirLabel: string; medianMs: number } | null;
}): CourseKeyPoint[] {
  const { trail, turns, runs, perKm, wind } = input;
  const c: Cand[] = [];

  // Развороты: сброс темпа до и разгон после — на шоссе самое заметное место трассы.
  for (const t of turns.filter((x) => x.deg >= UTURN_DEG)) {
    c.push({
      km: kmOf(t.m), type: "turn", prio: 70,
      text: trail ? "Разворот: сбрось темп заранее, на выходе не рви." : "Разворот: сбросьте скорость за 30–50 м, проходите по внутренней стороне и спокойно разгоняйтесь после.",
    });
  }
  // Серпантин: несколько крутых поворотов подряд.
  const sharp = turns.filter((x) => x.deg < UTURN_DEG);
  for (let i = 0; i < sharp.length; ) {
    let j = i;
    while (j + 1 < sharp.length && sharp[j + 1].m - sharp[i].m <= SERP_SPAN_M) j++;
    const n = j - i + 1;
    if (n >= SERP_MIN) {
      c.push({
        km: kmOf(sharp[i].m), type: "turn", prio: 55 + n,
        text: trail
          ? `С ${ruKm(kmOf(sharp[i].m))} по ${ruKm(kmOf(sharp[j].m))} км серпантин, ${n} крутых поворотов: шаг короче, в повороте не тормози резко.`
          : `С ${ruKm(kmOf(sharp[i].m))} по ${ruKm(kmOf(sharp[j].m))} км ${n} крутых поворота подряд: бегите по внутренней стороне, это короче, темп на выходе не теряйте.`,
      });
      i = j + 1;
    } else {
      c.push({
        km: kmOf(sharp[i].m), type: "turn", prio: 35,
        text: trail ? "Крутой поворот: смотри под ноги на выходе." : "Крутой поворот: бегите по внутренней стороне, это короче.",
      });
      i++;
    }
  }

  // Покрытие: старт (если трасса смешанная) и смены покрытия, самые длинные участки важнее.
  if (runs.length > 1) {
    c.push({ km: 0.1, type: "surface", prio: 50, text: `Старт по ${runs[0].s === "асфальт" ? "асфальту" : runs[0].s === "грунт" ? "грунту" : "тропе"}.` });
    runs.slice(1).forEach((r, k) => {
      c.push({
        km: kmOf(r.from), type: "surface", prio: 60 + Math.min(10, (r.to - r.from) / 1000),
        text: `С ${ruKm(kmOf(r.from))} км ${runs[k].s} кончается, ${surfaceText(runs[k].s, r.s, trail)}`,
      });
    });
  }

  // Ветер: самый длинный подряд встречный отрезок, иначе длинный попутный (как в полном разборе).
  if (wind && wind.medianMs >= WIND_WORTH_MS) {
    const longest = (side: "head" | "tail") => {
      let best: [number, number] | null = null, s = -1;
      perKm.forEach((k, i) => { if (k.wind !== side) { s = -1; return; } if (s < 0) s = i; if (!best || i - s > best[1] - best[0]) best = [s, i]; });
      return best as [number, number] | null;
    };
    const head = longest("head"), tail = longest("tail");
    const from = windFrom(wind.dirLabel);
    if (head && head[1] - head[0] + 1 >= MIN_HEAD_RUN_KM) {
      const a = perKm[head[0]].km, z = perKm[head[1]].km;
      c.push({ km: Math.max(0.1, a - 0.5), type: "wind", prio: 65, text: trail
        ? `С ${a}-го по ${z}-й км ветер чаще всего в лицо (обычно дует ${from}): держись за кем-нибудь, не выходи вперёд.`
        : `С ${a}-го по ${z}-й км ветер чаще всего в лицо (обычно дует ${from}): держитесь в группе за спинами, не выходите вперёд.` });
    } else if (tail && tail[1] - tail[0] + 1 >= MIN_TAIL_RUN_KM) {
      const a = perKm[tail[0]].km, z = perKm[tail[1]].km;
      c.push({ km: Math.max(0.1, a - 0.5), type: "wind", prio: 45, text: trail
        ? `С ${a}-го по ${z}-й км ветер чаще всего в спину (обычно дует ${from}): бежится легче, не разгоняйся сверх плана.`
        : `С ${a}-го по ${z}-й км ветер чаще всего в спину (обычно дует ${from}): бежится легче, чем кажется, не разгоняйтесь сверх плана.` });
    }
  }

  const picked: Cand[] = [];
  for (const x of [...c].sort((a, b) => b.prio - a.prio)) {
    if (picked.length >= 6) break;
    if (picked.some((p) => Math.abs(p.km - x.km) < 0.5)) continue;
    picked.push(x);
  }
  return picked.sort((a, b) => a.km - b.km).map(({ km, type, text }) => ({ km, type, text }));
}

/** Суть урезанного разбора одной строкой: покрытие и повороты. Высот здесь нет и быть не должно. */
export function liteSummary(share: Partial<Record<Surface, number>>, known: number, turns: Turn[]): string {
  const parts: string[] = [];
  const order: Surface[] = ["асфальт", "грунт", "тропа"];
  const s = order.filter((k) => (share[k] ?? 0) >= 5).sort((a, b) => (share[b] ?? 0) - (share[a] ?? 0));
  if (known >= 50 && s.length) parts.push(s.length === 1 ? `весь ${s[0] === "тропа" ? "по тропе" : `по ${s[0] === "асфальт" ? "асфальту" : "грунту"}`}` : s.map((k) => `${k} ${share[k]}%`).join(", "));
  const u = turns.filter((t) => t.deg >= UTURN_DEG).length;
  if (u) parts.push(`${u} ${u === 1 ? "разворот" : u < 5 ? "разворота" : "разворотов"}`);
  return parts.join(", ");
}

/** Урезанный выходит, только если покрытие известно хотя бы на половине трассы и точек не меньше 3
 *  (решение Игоря 16.10.2026: Archeda ×4 и «Осеннее обострение» 20 км были пустыми — карта и ветер). */
export const LITE_MIN_KNOWN = 50;
export const LITE_MIN_POINTS = 3;
export function litePublishable(l: { keyPoints: unknown[]; surface: { known: number } }): boolean {
  return l.surface.known >= LITE_MIN_KNOWN && l.keyPoints.length >= LITE_MIN_POINTS;
}
export const liteThinReason = (l: { keyPoints: unknown[]; surface: { known: number } }) =>
  `урезанный разбор беден: покрытие по карте известно на ${l.surface.known}%, ключевых точек ${l.keyPoints.length} (нужно от ${LITE_MIN_KNOWN}% и от ${LITE_MIN_POINTS})`;

/** До 4 точек короткого разбора в боте: развороты, смены покрытия, серпантин, ветер. */
export function liteShortPoints(points: CourseKeyPoint[], max = 4): CourseKeyPoint[] {
  const rank = (p: CourseKeyPoint) => (/^Разворот/.test(p.text) ? 3 : p.type === "surface" && !/^Старт/.test(p.text) ? 2.5 : p.type === "turn" && /серпантин|подряд/.test(p.text) ? 2.4 : p.type === "wind" ? 1 : p.type === "turn" ? 0.5 : 0);
  return [...points].filter((p) => rank(p) > 0).sort((a, b) => rank(b) - rank(a)).slice(0, max).sort((a, b) => a.km - b.km);
}

/** Урезанный разбор из полного: профиль, набор и сброс убраны (и по км тоже), точки — без высот. */
export function makeLite(c: CourseData, ways: OsmWay[] | null, trail: boolean): CourseData & { surface: { share: Partial<Record<Surface, number>>; known: number } } {
  const turns = findTurns(c.track);
  const samples = ways ? surfaceSamples(c.track, ways) : [];
  const runs = surfaceRuns(samples);
  const { share, known } = surfaceShare(samples);
  const totalM = resampleLine(c.track, 100).distM.at(-1)!;
  const keyPoints = keyPointsLite({ totalM, trail, turns, runs: known >= 50 ? runs : [], perKm: c.perKm, wind: c.wind });
  return {
    ...c,
    summary: liteSummary(share, known, turns),
    elevation: [],
    gain: 0,
    loss: 0,
    perKm: c.perKm.map((k) => ({ ...k, gain: 0, loss: 0 })),
    checks: { ...c.checks, ours: 0, publish: true, lite: true, reason: NO_REF_REASON },
    keyPoints,
    surface: { share, known },
  };
}

// ── сеть: дороги OSM вдоль трека ─────────────────────────────────────────────

const CACHE = path.join(os.homedir(), "ops-log", "races", "osm-surface-cache");

/** Дороги и тропы OSM в 30 м от трека (Overpass, один запрос по ломаной трека, кэш на диске). */
export async function fetchSurface(track: LatLon[]): Promise<OsmWay[]> {
  // ломаная для запроса: точка не чаще чем через 150 м, иначе запрос слишком длинный
  const line = resampleLine(track, 150).points;
  const key = createHash("sha1").update(JSON.stringify(line.map((p) => [p[0].toFixed(5), p[1].toFixed(5)]))).digest("hex").slice(0, 16);
  const file = path.join(CACHE, `${key}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as OsmWay[];
  // кусками по 100 точек (~15 км): длинный запрос Overpass режет; 429/5xx — повтор с паузой
  const ways = new Map<string, OsmWay>();
  for (let i = 0; i < line.length - 1; i += 99) {
    const part = line.slice(i, i + 100);
    const around = part.map((p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`).join(",");
    const q = `[out:json][timeout:120];way[highway](around:30,${around});out tags geom;`;
    for (let attempt = 1; ; attempt++) {
      const res = await politeFetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(q)}`,
      });
      if (res.ok) {
        const json = (await res.json()) as { elements: { id: number; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] }[] };
        for (const e of json.elements) if (e.geometry?.length) ways.set(String(e.id), { tags: e.tags ?? {}, geometry: e.geometry });
        break;
      }
      if (attempt >= 5 || !(res.status === 429 || res.status >= 500)) throw new Error(`Overpass: HTTP ${res.status}`);
      await new Promise((r) => setTimeout(r, 20000 * attempt));
    }
  }
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(file, JSON.stringify([...ways.values()]));
  return [...ways.values()];
}
