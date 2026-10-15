/**
 * Выгрузка корпуса для прецедентного генератора. READ-ONLY: только select.
 * Пишет в DATA_DIR (вне git): corpus.json — все плановые строки кэша с описанием и структурой;
 * aux.json — старты, сигналы, ученики, действующий ростер.
 *
 * Запуск: npx tsx tools/trainingpeaks-export/scripts/precedent/dump-corpus.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadRoster } from "../lib/autoplanner-roster.ts";
import { DATA_DIR } from "./load.ts";

export function sbc(): SupabaseClient {
  for (const l of readFileSync("/Users/igor/igor-tp-reports-bot/.env.local", "utf8").split(/\r?\n/)) {
    const t = l.trim(); if (!t || t.startsWith("#")) continue; const e = t.indexOf("="); if (e < 0) continue;
    const k = t.slice(0, e).trim(); let v = t.slice(e + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
  return createClient(process.env.SUPABASE_URL!.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), { auth: { persistSession: false } });
}

const PAGE = 300; // 1000 упирается в statement timeout на выборке JSON-полей (15.10)
async function all(sb: SupabaseClient, t: string, sel: string, order: string, f?: (q: any) => any): Promise<any[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const out: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (let i = 0; ; i += PAGE) {
    let q = sb.from(t).select(sel).order(order).range(i, i + PAGE - 1);
    if (f) q = f(q);
    const { data, error } = await q; if (error) throw error;
    out.push(...(data ?? [])); if (!data || data.length < PAGE) break;
  }
  return out;
}

async function main(): Promise<void> {
  const sb = sbc();
  mkdirSync(DATA_DIR, { recursive: true });
  const rows = await all(sb, "trainingpeaks_workout_cache",
    "trainingpeaks_athlete_id,trainingpeaks_workout_id,student_name,workout_date,title,workout_type_value_id,planned_time_raw,planned_distance_raw,is_completed,completed_time_raw,order_on_day,src:source_snapshot->>description,struct:source_snapshot->structure,cc:source_snapshot->>coachComments",
    "trainingpeaks_workout_id", (q) => q.eq("is_planned", true));
  writeFileSync(path.join(DATA_DIR, "corpus.json"), JSON.stringify(rows));
  const races = await all(sb, "trainingpeaks_race_events", "trainingpeaks_athlete_id,event_date,distance_km,distance_raw", "id");
  const sig = await all(sb, "trainingpeaks_student_operational_signals", "student_id,signal_type,valid_from,valid_until,source_date,target_date,created_at,resolved_at", "id");
  const st = await all(sb, "trainingpeaks_students", "id,student_name,trainingpeaks_athlete_url", "id");
  const roster = await loadRoster(sb);
  writeFileSync(path.join(DATA_DIR, "aux.json"), JSON.stringify({ races, sig, st, rosterActive: [...roster.active] }));
  console.log(`rows ${rows.length} · races ${races.length} · signals ${sig.length} · students ${st.length} · roster ${roster.active.size} → ${DATA_DIR}`);
}

if (process.argv[1]?.endsWith("dump-corpus.ts")) main().catch((e: unknown) => { console.error(e); process.exit(1); });
