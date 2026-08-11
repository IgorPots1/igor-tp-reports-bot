/**
 * tp-quality-volume-check — покрытие разбора качественного объёма и доли аэробного/качественного.
 * READ-ONLY: ничего не пишет ни в БД, ни в TP.
 *
 * ЗАЧЕМ. Доля качества — база для всех целей тренировочного цикла. До 11.08 она считалась
 * по заголовкам формы «N x M мин» и была занижена дважды: составные формы («6 х 4 / 2»,
 * «8 х 800 м», «30 x 40 сек») не разбирались вовсе, а 360 сессий «(темп выше)» наоборот
 * шли в качество целиком, хотя это непрерывный аэробный бег.
 *
 * Запуск: npx tsx tools/trainingpeaks-export/scripts/tp-quality-volume-check.ts
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { toolRoot } from "./lib/paths.ts";
import { mondayOf } from "./lib/autoplanner-context.ts";
import { loadRoster, rosterSummary } from "./lib/autoplanner-roster.ts";
import { splitSessionVolume, type VolumeKind } from "./lib/quality-volume.ts";

function loadEnv(p: string): void { if (!existsSync(p)) return; for (const l of readFileSync(p, "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const e = t.indexOf("="); if (e < 0) continue; const k = t.slice(0, e).trim(); if (!k || process.env[k] !== undefined) continue; let v = t.slice(e + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); process.env[k] = v; } }
function sbc(): SupabaseClient {
  const root = path.resolve(toolRoot, "..", "..");
  for (const p of [path.join(root, ".env.local"), "/Users/igor/igor-tp-reports-bot/.env.local"]) loadEnv(p);
  return createClient(process.env.SUPABASE_URL!.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), { auth: { persistSession: false } });
}

/** Группа 12 из наряда 11.08 — сравниваем её с ростером. */
const GROUP = new Set([5733446, 5475652, 5476215, 6009851, 5931798, 5905779, 5748681, 5475750, 5475968, 5461678, 5807145, 6290336]);
const WEEKS_BACK = 26;

const srt = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);
function pct(s: number[], p: number): number {
  if (!s.length) return NaN;
  const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
}
const med = (xs: number[]): number => pct(srt(xs), 0.5);

type Row = { trainingpeaks_athlete_id: number; workout_date: string; title: string | null; planned_time_raw: number | null };

async function main(): Promise<void> {
  const sb = sbc();
  const roster = await loadRoster(sb);
  console.log(rosterSummary(roster));

  const since = new Date(Date.now() - WEEKS_BACK * 7 * 86400000).toISOString().slice(0, 10);
  const rows: Row[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from("trainingpeaks_workout_cache")
      .select("trainingpeaks_athlete_id, workout_date, title, planned_time_raw")
      .eq("workout_type_value_id", 3).eq("is_planned", true).gte("workout_date", since).order("workout_date").range(f, f + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < 1000) break;
  }
  const runs = rows.filter((r) => roster.active.has(r.trainingpeaks_athlete_id));

  // Пороги нужны только для форм в метрах. value_after в БД — СКОРОСТЬ м/с, не сек/км.
  const thr = new Map<number, number>();
  {
    const { data } = await sb.from("tp_threshold_applications")
      .select("trainingpeaks_athlete_id, applied_at, value_after, created_at").order("created_at");
    for (const x of (data ?? []) as Array<Record<string, unknown>>) {
      const v = Number(x.value_after);
      if (Number.isFinite(v) && v > 0) thr.set(Number(x.trainingpeaks_athlete_id), 1000 / v);
    }
  }

  // ── покрытие ──
  const kinds = new Map<VolumeKind, number>();
  const unreadable: Row[] = [];
  type Wk = { aer: number; qual: number; est: boolean };
  const byAth = new Map<number, Map<string, Wk>>();
  for (const r of runs) {
    const minutes = Math.round((r.planned_time_raw ?? 0) * 60);
    if (minutes <= 0 || minutes > 300) continue;
    const s = splitSessionVolume(r.title, minutes, thr.get(r.trainingpeaks_athlete_id) ?? null);
    kinds.set(s.kind, (kinds.get(s.kind) ?? 0) + 1);
    if (s.kind === "interval_unparsed") unreadable.push(r);
    const wk = mondayOf(r.workout_date);
    const M = byAth.get(r.trainingpeaks_athlete_id) ?? byAth.set(r.trainingpeaks_athlete_id, new Map()).get(r.trainingpeaks_athlete_id)!;
    const w = M.get(wk) ?? M.set(wk, { aer: 0, qual: 0, est: false }).get(wk)!;
    w.aer += s.aerobicMin; w.qual += s.qualityMin; if (s.estimated) w.est = true;
  }

  console.log(`\n═══ ПОКРЫТИЕ РАЗБОРА (плановых беговых у действующих: ${runs.length}) ═══`);
  const order: VolumeKind[] = ["aerobic", "tempo_marker", "interval_minutes", "interval_seconds", "interval_meters", "interval_unparsed"];
  const nameOf: Record<VolumeKind, string> = {
    aerobic: "аэробная (не качество)",
    tempo_marker: "«темп выше» → аэробная (замер: 76% порога)",
    interval_minutes: "отрезки, форма в минутах",
    interval_seconds: "отрезки, форма в секундах",
    interval_meters: "отрезки в метрах (минуты ОЦЕНЕНЫ через порог)",
    interval_unparsed: "качество на вид, форма НЕ читается",
  };
  for (const k of order) console.log(`  ${nameOf[k].padEnd(48)} ${String(kinds.get(k) ?? 0).padStart(5)}`);
  const qTotal = (kinds.get("interval_minutes") ?? 0) + (kinds.get("interval_seconds") ?? 0) + (kinds.get("interval_meters") ?? 0);
  const qAll = qTotal + (kinds.get("interval_unparsed") ?? 0);
  console.log(`  ─ качественных всего ${qAll}, из них разобрано ${qTotal} (${Math.round(100 * qTotal / Math.max(qAll, 1))}%)`);

  console.log(`\n  10 примеров того, что осталось нечитаемым:`);
  const seen = new Set<string>();
  for (const r of unreadable) {
    const k = (r.title ?? "").replace(/[0-9]+([.,][0-9]+)?/g, "#").trim();
    if (seen.has(k)) continue;
    seen.add(k);
    if (seen.size > 10) break;
    console.log(`    «${r.title ?? ""}» · ${Math.round((r.planned_time_raw ?? 0) * 60)} мин`);
  }

  // ── доли ──
  console.log(`\n═══ ДОЛЯ КАЧЕСТВА В НЕДЕЛЬНОМ ОБЪЁМЕ ═══`);
  const report = (label: string, keep: (aid: number) => boolean): void => {
    const shares: number[] = [], vols: number[] = [], quals: number[] = [];
    let n = 0, estWeeks = 0, allWeeks = 0;
    for (const [aid, M] of byAth) {
      if (!keep(aid)) continue;
      n++;
      const ws = [...M.values()].filter((w) => w.aer + w.qual > 0);
      for (const w of ws) {
        allWeeks++; if (w.est) estWeeks++;
        const tot = w.aer + w.qual;
        shares.push(w.qual / tot); vols.push(tot); quals.push(w.qual);
      }
    }
    console.log(`  ${label.padEnd(18)} атлетов ${String(n).padStart(3)} · недель ${String(allWeeks).padStart(4)}`
      + ` · объём недели ${Math.round(med(vols))} мин`
      + ` · КАЧЕСТВО ${(100 * med(shares)).toFixed(1)}%`
      + ` · минут работы ${Math.round(med(quals))}`
      + ` · недель с оценкой по метрам ${estWeeks}`);
  };
  report("все действующие", () => true);
  report("группа 12", (a) => GROUP.has(a));

  // ── рост отдельно по аэробному и качественному ──
  console.log(`\n═══ РОСТ ЗА ${WEEKS_BACK} НЕДЕЛЬ, ОТДЕЛЬНО ПО ОСЯМ (медиана последних 6 непустых недель к первым 6) ═══`);
  const growth = (label: string, keep: (aid: number) => boolean): void => {
    const ga: number[] = [], gq: number[] = [];
    for (const [aid, M] of byAth) {
      if (!keep(aid)) continue;
      const ks = [...M.keys()].sort();
      const aer = ks.map((k) => M.get(k)!.aer).filter((x) => x > 0);
      const qual = ks.map((k) => M.get(k)!.qual).filter((x) => x > 0);
      if (aer.length >= 12) { const a = med(aer.slice(0, 6)), b = med(aer.slice(-6)); if (a > 0) ga.push(b / a); }
      if (qual.length >= 12) { const a = med(qual.slice(0, 6)), b = med(qual.slice(-6)); if (a > 0) gq.push(b / a); }
    }
    const line = (nm: string, xs: number[]): string => {
      const s = srt(xs);
      return `${nm.padEnd(12)} n=${String(s.length).padStart(3)} медиана ×${med(s).toFixed(2)}`
        + ` · выросли >15% ${Math.round(100 * s.filter((x) => x > 1.15).length / Math.max(s.length, 1))}%`
        + ` · упали >15% ${Math.round(100 * s.filter((x) => x < 0.85).length / Math.max(s.length, 1))}%`;
    };
    console.log(`  ${label}`);
    console.log(`    ${line("аэробный", ga)}`);
    console.log(`    ${line("качество", gq)}`);
  };
  growth("все действующие", () => true);
  growth("группа 12", (a) => GROUP.has(a));
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
