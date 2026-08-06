/** tp-anchor-vs-zone2 — замер расхождения своего якоря лёгкого и суженной зоны 2. READ-ONLY. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { toolRoot } from "./lib/paths.ts";
import { loadAthleteContexts } from "./lib/autoplanner-context.ts";
function loadEnv(p: string): void { if (!existsSync(p)) return; for (const l of readFileSync(p, "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const e = t.indexOf("="); if (e < 0) continue; const k = t.slice(0, e).trim(); if (!k || process.env[k] !== undefined) continue; let v = t.slice(e + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); process.env[k] = v; } }
function sbc(): SupabaseClient { const root = path.resolve(toolRoot, "..", ".."); for (const p of [path.join(root, ".env.local"), "/Users/igor/igor-tp-reports-bot/.env.local"]) loadEnv(p); return createClient(process.env.SUPABASE_URL!.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), { auth: { persistSession: false } }); }
const fp = (s: number): string => { const m = Math.floor(s / 60), x = Math.round(s % 60); return `${m}:${String(x).padStart(2, "0")}`; };
const sb = sbc();
const { data: zs } = await sb.from("tp_zone_snapshots").select("trainingpeaks_athlete_id, zones, captured_at").order("captured_at", { ascending: false });
const z2 = new Map<number, { fast: number; slow: number }>();
type ZoneRow = { trainingpeaks_athlete_id: number; zones: { speedZones?: Array<{ workoutTypeId?: number; zones?: Array<{ minimum?: number; maximum?: number }> }> } | null };
for (const r of (zs ?? []) as unknown as ZoneRow[]) {
  if (z2.has(r.trainingpeaks_athlete_id)) continue;
  const set0 = r.zones?.speedZones?.find((s) => Number(s.workoutTypeId) === 0);
  const z = set0?.zones?.[1]; if (!z?.minimum || !z?.maximum) continue;
  z2.set(r.trainingpeaks_athlete_id, { fast: Math.round(1000 / z.maximum), slow: Math.round(1000 / z.minimum) });
}
const ctx = await loadAthleteContexts(sb);
const rows: Array<{ aid: number; own: string; zone: string; dMid: number }> = [];
for (const c of ctx.values()) {
  if (!c.easy || c.easy.source !== "easy_description") continue;
  const z = z2.get(c.athleteId); if (!z) continue;
  const ownMid = (c.easy.fastSec + c.easy.slowSec) / 2, zMid = (z.fast + z.slow) / 2;
  rows.push({ aid: c.athleteId, own: `${fp(c.easy.fastSec)}–${fp(c.easy.slowSec)}`, zone: `${fp(z.fast)}–${fp(z.slow)}`, dMid: Math.round(zMid - ownMid) });
}
rows.sort((a, b) => Math.abs(b.dMid) - Math.abs(a.dMid));
const ds = rows.map((r) => r.dMid).sort((a, b) => a - b);
const med = ds.length ? ds[Math.floor(ds.length / 2)] : 0;
console.log(`атлетов с обоими: ${rows.length}`);
console.log(`медиана (зона2 − свой якорь) по середине: ${med >= 0 ? "+" : ""}${med} с/км  (плюс = зона 2 МЕДЛЕННЕЕ)`);
console.log(`p25 ${ds[Math.floor(ds.length*0.25)]} · p75 ${ds[Math.floor(ds.length*0.75)]} · min ${ds[0]} · max ${ds[ds.length-1]}`);
console.log(`расхождение > 15 с/км: ${rows.filter((r) => Math.abs(r.dMid) > 15).length} атлетов`);
console.log(`\nкто именно (|Δ| > 15, топ-12):`);
for (const r of rows.filter((x) => Math.abs(x.dMid) > 15).slice(0, 12)) console.log(`  ${r.aid}: свой ${r.own} · зона2 ${r.zone} · Δсередины ${r.dMid >= 0 ? "+" : ""}${r.dMid} с/км`);
