/**
 * tp-autoplanner-resolve-check — проверка резолвера (шаг 2 наряда, спека §2).
 *
 * READ-ONLY: ни записи в TP, ни записи в БД. Прогоняет резолвер по всей популяции и
 * печатает распределение anchor_source, доверия и число «качество не могу».
 *
 * Запуск: npx tsx tools/trainingpeaks-export/scripts/tp-autoplanner-resolve-check.ts
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { toolRoot } from "./lib/paths.ts";
import { loadAthleteContexts } from "./lib/autoplanner-context.ts";
import { resolvePace, type IntensityIntent } from "./lib/pace-resolver.ts";

function loadEnv(p: string): void { if (!existsSync(p)) return; for (const line of readFileSync(p, "utf8").split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith("#")) continue; const eq = t.indexOf("="); if (eq < 0) continue; const k = t.slice(0, eq).trim(); if (!k || process.env[k] !== undefined) continue; let v = t.slice(eq + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); process.env[k] = v; } }
function getSupabase(): SupabaseClient {
  const root = path.resolve(toolRoot, "..", "..");
  for (const p of [path.join(root, ".env.local"), path.join(root, ".env"), "/Users/igor/igor-tp-reports-bot/.env.local", "/Users/igor/igor-tp-reports-bot/.env"]) loadEnv(p);
  const url = process.env.SUPABASE_URL?.trim(); const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}
const fp = (s: number): string => { const m = Math.floor(s / 60), x = Math.round(s % 60); return x === 60 ? `${m + 1}:00` : `${m}:${String(x).padStart(2, "0")}`; };
const bump = (m: Map<string, number>, k: string): void => { m.set(k, (m.get(k) ?? 0) + 1); };

async function main(): Promise<void> {
  const sb = getSupabase();
  console.log("[resolver] загружаю контексты…");
  const ctx = await loadAthleteContexts(sb);
  console.log(`[resolver] атлетов в кэше: ${ctx.size}`);

  const INTENTS: IntensityIntent[] = ["easy", "long", "recovery", "steady_tempo", "threshold", "vo2"];
  const easySrc = new Map<string, number>(), easyConf = new Map<string, number>();
  const thrSrc = new Map<string, number>(), thrConf = new Map<string, number>();
  const tierMode = new Map<string, number>();
  const noQuality: number[] = [], noEasy: number[] = [], servable: number[] = [];
  let easyOk = 0, qualOk = 0;

  for (const c of ctx.values()) {
    const e = resolvePace(c, "easy", "maintenance", 4);
    const q = resolvePace(c, "threshold", "maintenance", null);
    if (e.ok) {
      easyOk++; servable.push(c.athleteId);
      bump(easySrc, e.anchorSource); bump(easyConf, e.confidence);
      bump(tierMode, `${c.tier}→${e.targetMode}`);
    } else noEasy.push(c.athleteId);
    if (q.ok) { qualOk++; bump(thrSrc, q.anchorSource); bump(thrConf, q.confidence); }
    else if (q.reason === "no_threshold_cannot_do_quality" && e.ok) noQuality.push(c.athleteId);
  }

  const show = (title: string, m: Map<string, number>): void => {
    console.log(`\n${title}`);
    [...m.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k.padEnd(30)} ${v}`));
  };
  console.log(`\n=== ОБСЛУЖИВАЕМОСТЬ ===`);
  console.log(`  лёгкий/длительный можем:      ${easyOk}`);
  console.log(`  качество можем (есть порог):  ${qualOk}`);
  console.log(`  «качество не могу» (якорь есть, порога нет): ${noQuality.length}  → ${noQuality.sort((a, b) => a - b).join(", ")}`);
  console.log(`  не обслуживаем вовсе (нет якоря и фолбэка):  ${noEasy.length}`);
  show("=== anchor_source ЛЁГКОГО ===", easySrc);
  show("=== confidence ЛЁГКОГО ===", easyConf);
  show("=== anchor_source КАЧЕСТВА ===", thrSrc);
  show("=== confidence КАЧЕСТВА ===", thrConf);
  show("=== тир → режим контроля лёгкого (§2.7) ===", tierMode);

  // образец полного контракта
  const sample = [...ctx.values()].find((c) => c.easy?.source === "easy_description" && c.threshold);
  if (sample) {
    console.log(`\n=== ОБРАЗЕЦ КОНТРАКТА (атлет ${sample.athleteId}, тир ${sample.tier}) ===`);
    for (const i of INTENTS) {
      const r = resolvePace(sample, i, "maintenance", 4);
      if (r.ok) console.log(`  ${i.padEnd(16)} ${fp(r.absPaceMinS)}–${fp(r.absPaceMaxS)}  pct ${r.pctMin}–${r.pctMax}  mode=${r.targetMode}  conf=${r.confidence}  src=${r.anchorSource}`);
      else console.log(`  ${i.padEnd(16)} ОТКАЗ: ${r.reason}`);
    }
  }
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
