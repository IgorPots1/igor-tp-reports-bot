/** tp-band-collision-check — кто не проходит проверку на слипание лёгкого с качеством. READ-ONLY. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { toolRoot } from "./lib/paths.ts";
import { loadAthleteContexts } from "./lib/autoplanner-context.ts";
import { checkEasyAgainstQuality, MIN_EASY_TO_QUALITY_RATIO } from "./lib/band-collision.ts";
function loadEnv(p: string): void { if (!existsSync(p)) return; for (const l of readFileSync(p, "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const e = t.indexOf("="); if (e < 0) continue; const k = t.slice(0, e).trim(); if (!k || process.env[k] !== undefined) continue; let v = t.slice(e + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); process.env[k] = v; } }
function sbc(): SupabaseClient { const root = path.resolve(toolRoot, "..", ".."); for (const p of [path.join(root, ".env.local"), "/Users/igor/igor-tp-reports-bot/.env.local"]) loadEnv(p); return createClient(process.env.SUPABASE_URL!.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), { auth: { persistSession: false } }); }
const fp = (s: number): string => { const m = Math.floor(s / 60), x = Math.round(s % 60); return `${m}:${String(x).padStart(2, "0")}`; };

const ctx = await loadAthleteContexts(sbc());
let ok = 0, unver = 0; const bad: Array<{ aid: number; src: string; ratio: number; easy: string; qual: string }> = [];
for (const c of ctx.values()) {
  if (!c.easy) continue;
  const v = checkEasyAgainstQuality(c.easy.fastSec, c.easy.slowSec,
    c.quality ? { fastSec: c.quality.fastSec, slowSec: c.quality.slowSec, isOwnAnchor: true } : null);
  if (v.status === "ok") ok++;
  else if (v.status === "unverifiable" || v.status === "not_applicable") unver++;
  else bad.push({ aid: c.athleteId, src: c.easy.source, ratio: v.ratio,
    easy: `${fp(c.easy.fastSec)}–${fp(c.easy.slowSec)}`, qual: `${fp(c.quality!.fastSec)}–${fp(c.quality!.slowSec)}` });
}
bad.sort((a, b) => a.ratio - b.ratio);
const onZone = bad.filter((b) => b.src === "tp_zone2").length;
const onOwn = bad.filter((b) => b.src === "easy_description").length;
console.log(`порог проверки: отношение лёгкий/качество >= ${MIN_EASY_TO_QUALITY_RATIO}\n`);
console.log(`прошли: ${ok}`);
console.log(`НЕ прошли (лёгкий не подтверждён): ${bad.length}`);
console.log(`  из них лёгкий из зоны 2:      ${onZone}`);
console.log(`  из них лёгкий свой:           ${onOwn}`);
console.log(`нечем проверить (нет своего якоря качества): ${unver}`);
const zoneTot = [...ctx.values()].filter((c) => c.easy?.source === "tp_zone2" && c.quality).length;
const ownTot = [...ctx.values()].filter((c) => c.easy?.source === "easy_description" && c.quality).length;
console.log(`\nдоля отвалов: зона2 ${onZone}/${zoneTot} (${zoneTot ? (100 * onZone / zoneTot).toFixed(0) : 0}%) · свой якорь ${onOwn}/${ownTot} (${ownTot ? (100 * onOwn / ownTot).toFixed(0) : 0}%)`);
console.log(`\nкто именно (по возрастанию отношения):`);
for (const b of bad) console.log(`  ${b.aid} [${b.src}] ratio ${b.ratio.toFixed(3)} · лёгкий ${b.easy} · работа ${b.qual}`);
