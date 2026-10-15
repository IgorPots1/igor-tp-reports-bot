/* Внешние источники разбора трассы: GPX с диска, Open-Meteo (высоты, архив ветра, прогноз).
 * Open-Meteo по их правилам: высоты до 100 точек за запрос, пауза между запросами не меньше 1 с.
 * Бесплатный лимит считается по точкам (600 в минуту), поэтому пачки высот идут раз в 11 с,
 * на 429 ждём минуту. Высоты кэшируются на диске вне репозитория: перезапуск не тратит лимит. */

import { existsSync, readFileSync, writeFileSync } from "node:fs";

import type { LatLon } from "./geo";
import type { WindObs } from "./wind";

const PAUSE_MS = 1100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Точки трека из GPX: trkpt, иначе rtept. Высоты из GPX не берём, рельеф считаем по одному DEM. */
export function readGpx(path: string): LatLon[] {
  const xml = readFileSync(path, "utf8");
  const pick = (tag: string) =>
    [...xml.matchAll(new RegExp(`<${tag}\\b[^>]*>`, "g"))].map((m) => {
      const lat = /lat="([-\d.]+)"/.exec(m[0]);
      const lon = /lon="([-\d.]+)"/.exec(m[0]);
      return lat && lon ? ([Number(lat[1]), Number(lon[1])] as LatLon) : null;
    }).filter((p): p is LatLon => p != null);
  const trk = pick("trkpt");
  return trk.length ? trk : pick("rtept");
}

/** Высоты из GPX (<ele> внутри <trkpt>/<rtept>); точки без высоты пропускаются. Для эталона набора,
 *  когда организатор цифры не пишет, а его трек несёт высоты. */
export function readGpxEle(path: string): { points: LatLon[]; ele: number[] } {
  const xml = readFileSync(path, "utf8");
  const points: LatLon[] = [], ele: number[] = [];
  for (const m of xml.matchAll(/<(?:trkpt|rtept)\b([^>]*)>([\s\S]*?)<\/(?:trkpt|rtept)>/g)) {
    const lat = /lat="([-\d.]+)"/.exec(m[1]), lon = /lon="([-\d.]+)"/.exec(m[1]), e = /<ele>([-\d.]+)<\/ele>/.exec(m[2]);
    if (lat && lon && e) { points.push([Number(lat[1]), Number(lon[1])]); ele.push(Number(e[1])); }
  }
  return { points, ele };
}

async function getJson(url: string): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { headers: { "User-Agent": "igorp.run race-course pilot (+https://igorp.run)" } });
    } catch (e) {
      if (attempt >= 3) throw new Error(`сеть: ${(e as Error).message} ${url.slice(0, 120)}`);
      await sleep(PAUSE_MS * attempt * 5);
      continue;
    }
    if (res.ok) return res.json();
    if (attempt >= 3 || (res.status !== 429 && res.status < 500)) {
      throw new Error(`HTTP ${res.status} ${url.slice(0, 120)}: ${(await res.text()).slice(0, 200)}`);
    }
    await sleep(res.status === 429 ? 65000 : PAUSE_MS * attempt * 5);
  }
}

const ELEV_CACHE = "/Users/igor/ops-log/races/elevation-cache.json";
const ELEV_PAUSE_MS = 11000;
const key = (p: LatLon) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;

/** Высоты Copernicus DEM (90 м) из Open-Meteo Elevation, пачками по 100 точек. */
export async function fetchElevations(points: LatLon[]): Promise<number[]> {
  const cache: Record<string, number> = existsSync(ELEV_CACHE) ? JSON.parse(readFileSync(ELEV_CACHE, "utf8")) : {};
  const missing = [...new Set(points.map(key))].filter((k) => cache[k] == null);
  for (let i = 0; i < missing.length; i += 100) {
    if (i > 0) await sleep(ELEV_PAUSE_MS);
    const chunk = missing.slice(i, i + 100).map((k) => k.split(",").map(Number) as LatLon);
    const lat = chunk.map((p) => p[0].toFixed(5)).join(",");
    const lon = chunk.map((p) => p[1].toFixed(5)).join(",");
    const data = (await getJson(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`)) as { elevation: number[] };
    if (!Array.isArray(data.elevation) || data.elevation.length !== chunk.length) throw new Error("Open-Meteo Elevation: число высот не совпало с числом точек");
    chunk.forEach((p, j) => (cache[key(p)] = data.elevation[j]));
    writeFileSync(ELEV_CACHE, JSON.stringify(cache));
  }
  return points.map((p) => cache[key(p)]);
}

const HOURLY = "wind_speed_10m,wind_direction_10m,wind_gusts_10m";
/** Архив ERA5 не меняется: ответы кэшируем по URL, пересборка разбора не тратит часовой лимит Open-Meteo. */
const WIND_CACHE = "/Users/igor/ops-log/races/wind-archive-cache.json";
type Hourly = { utc_offset_seconds?: number; hourly: { time: string[]; wind_speed_10m: (number | null)[]; wind_direction_10m: (number | null)[]; wind_gusts_10m: (number | null)[] } };

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Архив ERA5 (Open-Meteo Archive): по каждому году fromYear..toYear дата старта ±spreadDays,
 *  только час старта по местному времени. Один запрос на год. */
export async function fetchWindHistory(p: LatLon, raceDate: string, hour: number, fromYear: number, toYear: number, spreadDays = 3): Promise<{ obs: WindObs[]; years: number; utcOffsetMin: number | null }> {
  const obs: WindObs[] = [];
  let years = 0;
  // Смещение часового пояса точки (timezone=auto): по нему восход и закат для подсказки «фонарь».
  let utcOffsetMin: number | null = null;
  const mmdd = raceDate.slice(5);
  for (let y = fromYear; y <= toYear; y++) {
    const center = `${y}-${mmdd}`;
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${p[0].toFixed(4)}&longitude=${p[1].toFixed(4)}`
      + `&start_date=${shiftDate(center, -spreadDays)}&end_date=${shiftDate(center, spreadDays)}`
      + `&hourly=${HOURLY}&wind_speed_unit=ms&timezone=auto`;
    const cache: Record<string, Hourly> = existsSync(WIND_CACHE) ? JSON.parse(readFileSync(WIND_CACHE, "utf8")) : {};
    let data = cache[url];
    if (!data) {
      if (y > fromYear) await sleep(PAUSE_MS);
      data = (await getJson(url)) as Hourly;
      cache[url] = data;
      writeFileSync(WIND_CACHE, JSON.stringify(cache));
    }
    if (data.utc_offset_seconds != null) utcOffsetMin = data.utc_offset_seconds / 60;
    let got = 0;
    data.hourly.time.forEach((t, i) => {
      if (Number(t.slice(11, 13)) !== hour) return;
      const speed = data.hourly.wind_speed_10m[i], dir = data.hourly.wind_direction_10m[i];
      if (speed == null || dir == null) return;
      obs.push({ speed, dir, gust: data.hourly.wind_gusts_10m[i] });
      got++;
    });
    if (got) years++;
  }
  return { obs, years, utcOffsetMin };
}

/** Прогноз Open-Meteo на час старта (только если до старта не больше 7 дней, решает вызывающий). */
export async function fetchForecast(p: LatLon, raceDate: string, hour: number): Promise<WindObs | null> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${p[0].toFixed(4)}&longitude=${p[1].toFixed(4)}`
    + `&start_date=${raceDate}&end_date=${raceDate}&hourly=${HOURLY}&wind_speed_unit=ms&timezone=auto`;
  const data = (await getJson(url)) as Hourly;
  const i = data.hourly.time.findIndex((t) => Number(t.slice(11, 13)) === hour);
  if (i < 0) return null;
  const speed = data.hourly.wind_speed_10m[i], dir = data.hourly.wind_direction_10m[i];
  return speed == null || dir == null ? null : { speed, dir, gust: data.hourly.wind_gusts_10m[i] };
}
