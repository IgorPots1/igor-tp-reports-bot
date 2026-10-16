/**
 * Урезанные разборы из уже собранных (наряд 15.10.2026): разбор, у которого единственная причина
 * отказа — «нет эталона набора», становится урезанным (lite.ts: без профиля и цифры набора, точки по
 * поворотам, покрытию и ветру). Не прошедшие сверку, без трека и по схемам не трогаются.
 *
 *   npx tsx --env-file=<.env.local> scripts/race-course/relite.ts [--data-dir <dir>] [--apply]
 *
 * Без --apply — холостой прогон: печатает, что выйдет, ничего не пишет. Сеть — Overpass через
 * politeFetch (кэш ~/ops-log/races/osm-surface-cache) и тип старта из race_events (публичное чтение).
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { CourseData } from "@/features/race-course/types";
import { politeFetch } from "../lib/polite-fetch";
import { updateIndex } from "./course-index";
import { fetchSurface, liteEligible, litePublishable, liteShortPoints, liteThinReason, makeLite } from "./lite";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };

async function raceType(id: string): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("нет NEXT_PUBLIC_SUPABASE_URL / ANON_KEY (--env-file)");
  const res = await politeFetch(`${url}/rest/v1/race_events?select=race_type&id=eq.${encodeURIComponent(id)}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  const rows = (await res.json()) as { race_type: string | null }[];
  return rows[0]?.race_type ?? null;
}

async function main() {
  const dir = arg("data-dir") ?? path.join(process.cwd(), "src", "data", "race-courses");
  const apply = process.argv.includes("--apply");
  const out: string[] = [];
  const thin: string[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json") && x !== "index.json").sort()) {
    const c = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as CourseData;
    if (!liteEligible(c)) continue;
    const trail = (await raceType(c.raceId)) === "trail";
    const lite = makeLite(c, await fetchSurface(c.track), trail);
    const short = liteShortPoints(lite.keyPoints).map((p, i) => ({ n: i + 1, km: p.km, text: p.text }));
    if (!litePublishable(lite)) {
      // бедный — не публикуем; файл как был (полный, неопубликованный), в index его нет
      thin.push(`${f}: ${liteThinReason(lite)}`);
      continue;
    }
    out.push(`${f}: ${lite.summary || "—"} · покрытие определено на ${lite.surface.known}% · точек ${lite.keyPoints.length}`);
    if (apply) {
      writeFileSync(path.join(dir, f), JSON.stringify(lite, null, 1) + "\n");
      const label = c.name.includes(", ") ? c.name.split(", ").at(-1)! : null;
      updateIndex(dir, c.raceId, f.replace(/\.json$/, ""), true, { km: c.distanceKm, label, gain: null, loss: null, summary: lite.summary ?? "", points: short, lite: true });
    }
  }
  console.log(out.join("\n"));
  if (thin.length) console.log(`\nНЕ публикуем (бедные):\n${thin.join("\n")}`);
  console.log(`${out.length} урезанных разборов${apply ? " записано" : " (холостой прогон, --apply для записи)"}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
