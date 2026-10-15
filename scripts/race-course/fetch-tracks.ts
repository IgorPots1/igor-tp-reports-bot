/**
 * Скачать треки организаторов из выжимки по стартам (наряд 15.10.2026).
 *
 *   npx tsx scripts/race-course/fetch-tracks.ts <jobs.json> <out-dir>
 *
 * jobs.json: [{ race, kind: "nakarte" | "ydisk" | "gpx", url, distance }]. Пишет <out-dir>/<race>__<n>.gpx
 * и manifest.json (что откуда, или почему нет). Сеть — только politeFetch (robots.txt соблюдается).
 *   — nakarte: tracks.nakarte.me/track/<id>, каждый трек ссылки отдельным файлом;
 *   — Яндекс Диск: официальный публичный API и ТОЛЬКО ссылка на один файл, которую организатор
 *     опубликовал сам; папка не обходится — «в список для браузера» (решение Игоря 15.10.2026);
 *   — gpx / zip с gpx по прямой ссылке организатора;
 *   — Google Диск и прочее — не качаем (хост файлов закрыт robots.txt), в список для браузера.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { politeFetch, RobotsBlockedError } from "../lib/polite-fetch";
import { parseNktk } from "./nakarte";

type Job = { race: string; kind: string; url: string; distance: number | null };
type Entry = { race: string; file: string; name: string; source: string; note?: string };

const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "_");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
export const gpxOf = (name: string, segs: [number, number][][]) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="igorp.run" xmlns="http://www.topografix.com/GPX/1/1">\n<trk><name>${esc(name)}</name>\n${segs
    .map((s) => `<trkseg>\n${s.map(([a, o]) => `<trkpt lat="${a.toFixed(6)}" lon="${o.toFixed(6)}"/>`).join("\n")}\n</trkseg>`)
    .join("\n")}\n</trk>\n</gpx>\n`;

/** Какие ссылки качаем и почему нет: решение по виду ссылки, до любой сети. */
export function jobDecision(j: Job): { fetch: true } | { fetch: false; reason: string } {
  if (j.kind === "nakarte" && /nktl=[A-Za-z0-9_-]+|\/track\/[A-Za-z0-9_-]+/.test(j.url)) return { fetch: true };
  if (j.kind === "ydisk" && /^https:\/\/disk\.yandex\.(ru|com)\/(d|i)\//.test(j.url)) return { fetch: true };
  if (j.kind === "gpx" && /^https?:\/\/.+\.(gpx|zip)(\?.*)?$/i.test(j.url)) return { fetch: true };
  if (j.kind === "gdrive") return { fetch: false, reason: "Google Диск: хост файлов закрыт robots.txt — в список для браузера" };
  return { fetch: false, reason: `вид «${j.kind}» не качаем — в список для браузера` };
}

async function main() {
  const [jobsPath, out] = process.argv.slice(2);
  if (!jobsPath || !out) throw new Error("fetch-tracks.ts <jobs.json> <out-dir>");
  const jobs = JSON.parse(readFileSync(jobsPath, "utf8")) as Job[];
  mkdirSync(out, { recursive: true });
  const manifest: Entry[] = [];
  const counter = new Map<string, number>();
  const save = (race: string, name: string, body: string, source: string) => {
    const n = (counter.get(race) ?? 0) + 1;
    counter.set(race, n);
    const file = path.join(out, `${safe(race)}__${n}.gpx`);
    writeFileSync(file, body);
    manifest.push({ race, file, name, source });
  };
  const unzipGpx = (race: string, buf: Buffer, source: string) => {
    const tmp = path.join(out, "tmp.zip");
    writeFileSync(tmp, buf);
    for (const g of execFileSync("unzip", ["-Z1", tmp]).toString().split("\n").filter((x) => /\.gpx$/i.test(x))) {
      save(race, g, execFileSync("unzip", ["-p", tmp, g]).toString(), source);
    }
    rmSync(tmp, { force: true });
  };
  for (const j of jobs) {
    const d = jobDecision(j);
    if (!d.fetch) { manifest.push({ race: j.race, file: "", name: "", source: j.url, note: d.reason }); continue; }
    try {
      if (j.kind === "nakarte") {
        const id = (j.url.match(/nktl=([A-Za-z0-9_-]+)/) || j.url.match(/\/track\/([A-Za-z0-9_-]+)/))![1];
        const res = await politeFetch(`https://tracks.nakarte.me/track/${id}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        for (const t of parseNktk(await res.text())) if (t.segments.length) save(j.race, t.name || id, gpxOf(t.name || id, t.segments), j.url);
      } else if (j.kind === "ydisk") {
        const api = "https://cloud-api.yandex.net/v1/disk/public/resources";
        const meta = (await (await politeFetch(`${api}?public_key=${encodeURIComponent(j.url)}`)).json()) as { type?: string; name?: string };
        if (meta.type !== "file") throw new Error("ссылка на папку: папки не обходим — в список для браузера");
        const dl = (await (await politeFetch(`${api}/download?public_key=${encodeURIComponent(j.url)}`)).json()) as { href?: string };
        if (!dl.href) throw new Error("API не дал ссылку на файл");
        const res = await politeFetch(dl.href, {}, { yandexDiskApiHref: true });
        const buf = Buffer.from(await res.arrayBuffer());
        if (!res.ok || /file IO failure/.test(buf.subarray(0, 200).toString())) throw new Error("сбой хранилища Яндекса");
        if (/\.zip$/i.test(meta.name ?? "")) unzipGpx(j.race, buf, j.url);
        else save(j.race, meta.name ?? "track.gpx", buf.toString("utf8"), j.url);
      } else {
        const res = await politeFetch(j.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (/\.zip(\?.*)?$/i.test(j.url)) unzipGpx(j.race, buf, j.url);
        else save(j.race, j.url.split("/").pop()!, buf.toString("utf8"), j.url);
      }
      console.log("ok", j.race, j.kind);
    } catch (e) {
      const why = e instanceof RobotsBlockedError ? `robots: ${e.reason}` : (e as Error).message;
      console.log("НЕТ", j.race, j.kind, j.url, why);
      manifest.push({ race: j.race, file: "", name: "", source: j.url, note: why });
    }
  }
  writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 1));
}

if (process.argv[1]?.endsWith("fetch-tracks.ts")) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
