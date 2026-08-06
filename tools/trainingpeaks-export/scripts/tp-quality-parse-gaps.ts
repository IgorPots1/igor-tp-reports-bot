/** tp-quality-parse-gaps — какие интервальные описания не читаются. READ-ONLY, диагностика. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { toolRoot } from "./lib/paths.ts";
import { extractQualitySample } from "./lib/quality-anchor.ts";
import { parseSegments, ranges } from "./lib/tp-recompute.ts";
function loadEnv(p: string): void { if (!existsSync(p)) return; for (const l of readFileSync(p, "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const e = t.indexOf("="); if (e < 0) continue; const k = t.slice(0, e).trim(); if (!k || process.env[k] !== undefined) continue; let v = t.slice(e + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); process.env[k] = v; } }
function sbc(): SupabaseClient { const root = path.resolve(toolRoot, "..", ".."); for (const p of [path.join(root, ".env.local"), "/Users/igor/igor-tp-reports-bot/.env.local"]) loadEnv(p); return createClient(process.env.SUPABASE_URL!.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), { auth: { persistSession: false } }); }
const sb = sbc();
const since = new Date(Date.now() - 200 * 86400000).toISOString().slice(0, 10);
type R = { title: string | null; description: string | null };
const rows: R[] = [];
for (let f = 0; ; f += 1000) {
  const { data } = await sb.from("trainingpeaks_workout_cache").select("title, description:source_snapshot->>description").eq("workout_type_value_id", 3).gte("workout_date", since).range(f, f + 999);
  if (!data || !data.length) break; rows.push(...(data as unknown as R[])); if (data.length < 1000) break;
}
const buckets = new Map<string, string[]>();
let titles = 0, okc = 0;
for (const r of rows) {
  if (!r.title || !/[0-9]{1,2}\s*[xх×]\s*[0-9]/.test(r.title)) continue; titles++;
  if (extractQualitySample(r.title, r.description ?? "")) { okc++; continue; }
  const d = r.description ?? "";
  let why: string;
  if (!d.trim()) why = "описание пустое";
  else if (!/[0-9]{1,2}:[0-9]{2}/.test(d)) why = "в описании нет темпа мм:сс";
  else if (ranges(d).length === 0) why = "темп есть, но ranges() не нашёл диапазон";
  else if (parseSegments(d).length === 0) why = "диапазоны есть, но нет длительностей (parseSegments пуст)";
  else why = "сегменты есть, но ни один не совпал по длительности с N x M из заголовка";
  (buckets.get(why) ?? buckets.set(why, []).get(why)!).push(`«${r.title}» → ${d.replace(/\s+/g, " ").slice(0, 130)}`);
}
console.log(`интервальных заголовков: ${titles} · распарсено: ${okc} (${(100 * okc / titles).toFixed(0)}%) · не читается: ${titles - okc}\n`);
for (const [why, ex] of [...buckets.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`── ${why}: ${ex.length}`);
  for (const e of ex.slice(0, 3)) console.log(`     ${e}`);
}
