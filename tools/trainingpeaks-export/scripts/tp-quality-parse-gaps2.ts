/** Уточнение: сколько НЕПРОЧИТАННЫХ описаний вообще содержат темп в РАБОЧЕЙ части. READ-ONLY. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { toolRoot } from "./lib/paths.ts";
import { extractQualitySample } from "./lib/quality-anchor.ts";
import { ranges } from "./lib/tp-recompute.ts";
function loadEnv(p: string): void { if (!existsSync(p)) return; for (const l of readFileSync(p, "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const e = t.indexOf("="); if (e < 0) continue; const k = t.slice(0, e).trim(); if (!k || process.env[k] !== undefined) continue; let v = t.slice(e + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); process.env[k] = v; } }
function sbc(): SupabaseClient { const root = path.resolve(toolRoot, "..", ".."); for (const p of [path.join(root, ".env.local"), "/Users/igor/igor-tp-reports-bot/.env.local"]) loadEnv(p); return createClient(process.env.SUPABASE_URL!.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), { auth: { persistSession: false } }); }
const sb = sbc();
const since = new Date(Date.now() - 200 * 86400000).toISOString().slice(0, 10);
type R = { title: string | null; description: string | null };
const rows: R[] = [];
for (let f = 0; ; f += 1000) { const { data } = await sb.from("trainingpeaks_workout_cache").select("title, description:source_snapshot->>description").eq("workout_type_value_id", 3).gte("workout_date", since).range(f, f + 999); if (!data || !data.length) break; rows.push(...(data as unknown as R[])); if (data.length < 1000) break; }
let unparsed = 0, byFeelWork = 0, walkRun = 0, hrOnly = 0, singlePaceOkolo = 0, multiRange = 0, treadmill = 0;
for (const r of rows) {
  if (!r.title || !/[0-9]{1,2}\s*[xх×]\s*[0-9]/.test(r.title)) continue;
  if (extractQualitySample(r.title, r.description ?? "")) continue;
  unparsed++;
  const d = (r.description ?? "").replace(/\s+/g, " ");
  if (/по ощущени|в высоком темпе по|выше средней по/i.test(d)) byFeelWork++;
  if (/шаг|ходьб/i.test(d)) walkRun++;
  if (/пульс\s*\d{2,3}/i.test(d) && !/\d{1,2}:\d{2}\s*[-–—]\s*\d{1,2}:\d{2}/.test(d)) hrOnly++;
  if (/темп\s*(около|примерно|~)\s*\d{1,2}:\d{2}/i.test(d)) singlePaceOkolo++;
  if (/скорост[ьи]\s*\d/i.test(d)) treadmill++;
  if (ranges(d).length >= 2) multiRange++;
}
console.log(`НЕ распарсено: ${unparsed}`);
console.log(`  работа задана ПО ОЩУЩЕНИЯМ:        ${byFeelWork}`);
console.log(`  бег/ходьба (run-walk):             ${walkRun}`);
console.log(`  только пульс, без диапазона темпа: ${hrOnly}`);
console.log(`  скорость на дорожке (км/ч):        ${treadmill}`);
console.log(`  «темп около X» (одиночный темп):   ${singlePaceOkolo}  ← реальный пробел парсера`);
console.log(`  содержат >=2 диапазона темпа:      ${multiRange}  ← потенциально извлекаемые`);
