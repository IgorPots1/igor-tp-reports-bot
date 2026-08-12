/**
 * tp-cycle-aim-compare — ТОЧКА ПРИЦЕЛИВАНИЯ ЦИКЛА: три варианта рядом. READ-ONLY.
 *
 * ЗАЧЕМ. База цикла — взвешенная медиана плановых недель атлета, поэтому цель садится в
 * середину его собственного распределения и оказывается ниже его p75 у 9 из 12. Это
 * последнее необъяснённое расхождение с практикой: пол лёгкой, длительная и объём закрыты.
 *
 * ЭТО ЗАМЕР, А НЕ ПРАВКА. Скрипт ничего не меняет: он показывает, какой получилась бы неделя,
 * если целиться в медиану (как сейчас), в середину между медианой и p75, или в p75. Выбор
 * за тренером — это решение про нагрузку, а не про арифметику.
 *
 * Считается на РЕАЛЬНОМ сборщике: цель подставляется в buildWeek, дальше работают все те же
 * полы, потолки и защиты. Поэтому «объём» в таблице — это собранное, а не запрошенное.
 *
 * Запуск: npx tsx tools/trainingpeaks-export/scripts/tp-cycle-aim-compare.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { toolRoot } from "./lib/paths.ts";
import { loadAthleteContexts, mondayOf } from "./lib/autoplanner-context.ts";
import { loadCatalog } from "./lib/autoplanner-catalog.ts";
import { buildWeek, type CycleWeekTarget } from "./lib/autoplanner-week.ts";
import { buildDrafts } from "./lib/cycle-drafts.ts";
import { forecast } from "./lib/training-cycle.ts";

function loadEnv(p: string): void { if (!existsSync(p)) return; for (const l of readFileSync(p, "utf8").split(/\r?\n/)) { const t = l.trim(); if (!t || t.startsWith("#")) continue; const e = t.indexOf("="); if (e < 0) continue; const k = t.slice(0, e).trim(); if (!k || process.env[k] !== undefined) continue; let v = t.slice(e + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); process.env[k] = v; } }
function sbc(): SupabaseClient {
  const root = path.resolve(toolRoot, "..", "..");
  for (const p of [path.join(root, ".env.local"), "/Users/igor/igor-tp-reports-bot/.env.local"]) loadEnv(p);
  return createClient(process.env.SUPABASE_URL!.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), { auth: { persistSession: false } });
}

const GROUP = [5733446, 5475652, 5476215, 6009851, 5931798, 5905779, 5748681, 5475750, 5475968, 5461678, 5807145, 6290336];
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const addDays = (s: string, n: number): string => iso(Date.parse(s) + n * 86400000);
const QUALITY_RE = /([0-9]+\s*[xх×]\s*[0-9]|интерв|отрезк|повтор|порог|фартлек|vo\s?2|мпк)/i;

type Variant = { key: "median" | "mid" | "p75"; label: string };
const VARIANTS: Variant[] = [
  { key: "median", label: "медиана (сейчас)" },
  { key: "mid", label: "середина мед..p75" },
  { key: "p75", label: "p75" },
];

async function main(): Promise<void> {
  const sb = sbc();
  const ctx = await loadAthleteContexts(sb);
  const cat = await loadCatalog(sb);
  const today = iso(Date.now());
  const weekStart = addDays(mondayOf(today), 7);
  const drafts = await buildDrafts(sb, ctx, today);

  const { data: st } = await sb.from("trainingpeaks_students").select("student_name, trainingpeaks_athlete_url");
  const names = new Map<number, string>();
  for (const r of (st ?? []) as Array<Record<string, unknown>>) {
    const hit = /athletes?\/(\d+)/.exec(String(r.trainingpeaks_athlete_url ?? ""));
    if (hit && r.student_name) names.set(Number(hit[1]), String(r.student_name));
  }

  const out: string[] = [];
  out.push(`# ТОЧКА ПРИЦЕЛИВАНИЯ ЦИКЛА · три варианта · неделя с ${weekStart}`);
  out.push(`\nЗАМЕР, НЕ ПРАВКА. Сегодня цель = взвешенная медиана плановых недель атлета.`);
  out.push(`Считано настоящим сборщиком: полы, потолки и защиты работают, поэтому «собрано» —`);
  out.push(`это то, что реально выйдет, а не запрошенное число.`);
  out.push(`\nНЕДЕЛИ, ПОНИЖЕННЫЕ health-сигналом, помечены: у них объём считается ОТ ФАКТА,`);
  out.push(`и точка прицеливания на них не влияет вообще — сравнивать их бессмысленно.`);

  const hdr = `${"атлет".padEnd(20)}${"вариант".padEnd(20)}${"цель".padStart(6)}${"собрано".padStart(9)}${"длит".padStart(6)}${"кратч".padStart(7)}${"дней".padStart(6)}`;
  out.push(`\n\`\`\`\n${hdr}\n${"-".repeat(hdr.length)}`);

  const totals = new Map<string, { got: number; want: number }>();
  for (const v of VARIANTS) totals.set(v.key, { got: 0, want: 0 });

  for (const aid of GROUP) {
    const c = ctx.get(aid); const d = drafts.get(aid);
    if (!c || !d) continue;
    const nm = names.get(aid) ?? String(aid);

    // распределение его собственных ПЛАНОВЫХ беговых недель за 26 нед
    const since = addDays(today, -182);
    const { data: rows } = await sb.from("trainingpeaks_workout_cache")
      .select("workout_date, planned_time_raw, title")
      .eq("trainingpeaks_athlete_id", aid).eq("workout_type_value_id", 3).eq("is_planned", true)
      .gte("workout_date", since).lt("workout_date", mondayOf(today)).limit(600);
    const byWk = new Map<string, number>();
    for (const r of (rows ?? []) as Array<Record<string, unknown>>) {
      const m = Math.round(Number(r.planned_time_raw ?? 0) * 60);
      if (m <= 0) continue;
      const k = mondayOf(String(r.workout_date));
      byWk.set(k, (byWk.get(k) ?? 0) + m);
    }
    const weeks = [...byWk.values()].filter((x) => x > 0).sort((a, b) => a - b);
    if (weeks.length < 6) { out.push(`${nm.slice(0, 19).padEnd(20)}недель мало (${weeks.length}) — вариантов не считаем`); continue; }
    const at = (p: number): number => weeks[Math.min(weeks.length - 1, Math.floor(p * (weeks.length - 1)))];
    const med = at(0.5), p75 = at(0.75);
    const aims: Record<Variant["key"], number> = { median: med, mid: Math.round((med + p75) / 2), p75 };

    const w2r = d.targetDate ? Math.round((Date.parse(d.targetDate) - Date.parse(weekStart)) / (7 * 86400000)) + 1 : 8;
    const fc = forecast(d, weekStart, Math.max(1, w2r));
    const f = fc[0];
    if (!f) continue;
    const baseWant = f.aerobicMin + f.qualityMin;
    const share = baseWant > 0 ? f.qualityMin / baseWant : 0.1;

    for (const v of VARIANTS) {
      // цель варианта раскладывается в аэробное+работу по СОБСТВЕННОЙ доле атлета
      const want = aims[v.key];
      const q = Math.round(want * share / 5) * 5;
      const t: CycleWeekTarget = {
        weekIndex: 1, totalWeeks: fc.length, role: f.role,
        aerobicMin: want - q, qualityMin: q, days: f.days,
        baseWeekMin: d.baseAerobicMin + d.baseQualityMin, hasTargetRace: d.targetDate != null, intent: d.intent,
      };
      const w = buildWeek(c, c.envelope, cat, weekStart, c.hasActiveIllness, c.tierNote, t);
      const ss = w.sessions.filter((s) => !s.deferred);
      const long = ss.filter((s) => s.role === "long").reduce((m, s) => Math.max(m, s.minutes), 0);
      const shortest = ss.length ? Math.min(...ss.map((s) => s.minutes)) : 0;
      const down = w.notes.some((n) => n.includes("РОЛЬ НЕДЕЛИ ПОНИЖЕНА"));
      const acc = totals.get(v.key)!;
      if (!down) { acc.got += w.plannedMinutes; acc.want += want; }
      out.push(`${(v.key === "median" ? nm.slice(0, 19) : "").padEnd(20)}${(v.label + (down ? " ⚑пониж" : "")).padEnd(20)}`
        + `${String(want).padStart(6)}${String(w.plannedMinutes).padStart(9)}${String(long).padStart(6)}${String(shortest).padStart(7)}${String(ss.length).padStart(6)}`);
    }
    out.push("");
  }
  out.push("```");

  out.push(`\n## Итог по группе (только недели с ПЛАНОВОЙ ролью)`);
  out.push("```");
  for (const v of VARIANTS) {
    const a = totals.get(v.key)!;
    out.push(`${v.label.padEnd(22)} запрошено ${String(a.want).padStart(5)} · собрано ${String(a.got).padStart(5)} · разница к «медиане» ${a.got - totals.get("median")!.got >= 0 ? "+" : ""}${a.got - totals.get("median")!.got} мин`);
  }
  out.push("```");

  // ── как разошлись бы 8 недель цикла ──
  out.push(`\n## Восемь недель цикла: куда уводит каждый вариант`);
  out.push(`\nПрогноз считает от БАЗЫ, поэтому вариант меняет не только первую неделю, а весь ряд.`);
  out.push(`Показан суммарный аэробный объём за 8 недель и пик.`);
  out.push("```");
  out.push(`${"атлет".padEnd(20)}${"вариант".padEnd(20)}${"сумма 8 нед".padStart(12)}${"пик недели".padStart(12)}`);
  out.push("-".repeat(64));
  for (const aid of GROUP) {
    const c = ctx.get(aid); const d = drafts.get(aid);
    if (!c || !d) continue;
    const nm = names.get(aid) ?? String(aid);
    const since = addDays(today, -182);
    const { data: rows } = await sb.from("trainingpeaks_workout_cache")
      .select("workout_date, planned_time_raw").eq("trainingpeaks_athlete_id", aid)
      .eq("workout_type_value_id", 3).eq("is_planned", true).gte("workout_date", since).lt("workout_date", mondayOf(today)).limit(600);
    const byWk = new Map<string, number>();
    for (const r of (rows ?? []) as Array<Record<string, unknown>>) {
      const m = Math.round(Number(r.planned_time_raw ?? 0) * 60);
      if (m <= 0) continue;
      const k = mondayOf(String(r.workout_date));
      byWk.set(k, (byWk.get(k) ?? 0) + m);
    }
    const weeks = [...byWk.values()].filter((x) => x > 0).sort((a, b) => a - b);
    if (weeks.length < 6) continue;
    const at = (p: number): number => weeks[Math.min(weeks.length - 1, Math.floor(p * (weeks.length - 1)))];
    const med = at(0.5), p75 = at(0.75);
    const aims: Record<Variant["key"], number> = { median: med, mid: Math.round((med + p75) / 2), p75 };
    const share = (d.baseAerobicMin + d.baseQualityMin) > 0 ? d.baseQualityMin / (d.baseAerobicMin + d.baseQualityMin) : 0.1;
    for (const v of VARIANTS) {
      const want = aims[v.key];
      const q = Math.round(want * share);
      const alt = { ...d, baseAerobicMin: want - q, baseQualityMin: q };
      const series = forecast(alt, weekStart, 8);
      const sum = series.reduce((s, x) => s + x.aerobicMin + x.qualityMin, 0);
      const peak = series.reduce((m, x) => Math.max(m, x.aerobicMin + x.qualityMin), 0);
      out.push(`${(v.key === "median" ? nm.slice(0, 19) : "").padEnd(20)}${v.label.padEnd(20)}${String(sum).padStart(12)}${String(peak).padStart(12)}`);
    }
    out.push("");
  }
  out.push("```");

  const dir = path.join(path.resolve(toolRoot, "..", ".."), "reports", "autoplanner-acceptance");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `cycle-aim-compare-${weekStart}.md`), out.join("\n") + "\n");
  console.log(out.join("\n"));
  console.log(`\n[aim] → ${dir}/cycle-aim-compare-${weekStart}.md`);
  void QUALITY_RE;
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
