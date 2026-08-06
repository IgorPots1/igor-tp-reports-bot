/** tp-quality-anchor-probe — покрытие якоря качества из описаний. READ-ONLY. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { toolRoot } from "./lib/paths.ts";
import { extractQualitySample, buildQualityAnchor, qualityBandFromThreshold, type QualitySample } from "./lib/quality-anchor.ts";

function loadEnv(p: string): void { if (!existsSync(p)) return; for (const l of readFileSync(p, "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const e = t.indexOf("="); if (e < 0) continue; const k = t.slice(0, e).trim(); if (!k || process.env[k] !== undefined) continue; let v = t.slice(e + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); process.env[k] = v; } }
function sbc(): SupabaseClient { const root = path.resolve(toolRoot, "..", ".."); for (const p of [path.join(root, ".env.local"), "/Users/igor/igor-tp-reports-bot/.env.local"]) loadEnv(p); return createClient(process.env.SUPABASE_URL!.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), { auth: { persistSession: false } }); }
const fp = (s: number): string => { const m = Math.floor(s / 60), x = Math.round(s % 60); return `${m}:${String(x).padStart(2, "0")}`; };

const sb = sbc();
const since = new Date(Date.now() - 200 * 86400000).toISOString().slice(0, 10);
type R = { trainingpeaks_athlete_id: number; workout_date: string; title: string | null; description: string | null };
const rows: R[] = [];
for (let f = 0; ; f += 1000) {
  const { data } = await sb.from("trainingpeaks_workout_cache").select("trainingpeaks_athlete_id, workout_date, title, description:source_snapshot->>description").eq("workout_type_value_id", 3).gte("workout_date", since).range(f, f + 999);
  if (!data || !data.length) break; rows.push(...(data as unknown as R[])); if (data.length < 1000) break;
}
const byAth = new Map<number, QualitySample[]>(); let titles = 0, parsed = 0;
for (const r of rows) {
  if (!r.title || !/[0-9]{1,2}\s*[xх×]\s*[0-9]/.test(r.title)) continue; titles++;
  const s = extractQualitySample(r.title, r.description ?? ""); if (!s) continue; parsed++;
  (byAth.get(r.trainingpeaks_athlete_id) ?? byAth.set(r.trainingpeaks_athlete_id, []).get(r.trainingpeaks_athlete_id)!)
    .push({ date: r.workout_date, fast: s.fast, slow: s.slow, workMinutes: s.workMinutes, reps: s.reps });
}
const asOf = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
let withAnchor = 0; const widths: number[] = [];
for (const [, ss] of byAth) { const a = buildQualityAnchor(ss, asOf, { halfLifeDays: 21 }); if (a) { withAnchor++; widths.push(a.slow - a.fast); } }
widths.sort((a, b) => a - b);
console.log(`интервальных заголовков за 200 дней: ${titles}`);
console.log(`распарсено рабочих полос: ${parsed} (${titles ? (100 * parsed / titles).toFixed(0) : 0}%)`);
console.log(`атлетов хоть с одним сэмплом: ${byAth.size}`);
console.log(`атлетов со СВОИМ якорем качества (>=4): ${withAnchor}`);
console.log(`медиана ширины СВОЕЙ полосы качества: ${widths.length ? widths[Math.floor(widths.length / 2)] : "—"} с/км`);
const ex = qualityBandFromThreshold(300);
console.log(`фолбэк от порога 5:00 → ${fp(ex.fast)}–${fp(ex.slow)} (ширина ${ex.slow - ex.fast} с/км)`);
