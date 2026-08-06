/**
 * tp-autoplanner-week — первая сгенерированная неделя (шаг 5 наряда).
 *
 * READ-ONLY. Ни записи в TP, ни записи в БД. Генерирует неделю по всей обслуживаемой
 * популяции, пишет отчёт в reports/ и печатает три недели целиком (T1 / T2 со своим
 * якорем / фолбэк tp_zone2) — так, как их увидел бы ученик.
 *
 * Запуск: npx tsx tools/trainingpeaks-export/scripts/tp-autoplanner-week.ts
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { toolRoot } from "./lib/paths.ts";
import { loadAthleteContexts, mondayOf } from "./lib/autoplanner-context.ts";
import { buildWeek, DAY_RU, type Week } from "./lib/autoplanner-week.ts";
import { loadCatalog } from "./lib/autoplanner-catalog.ts";

function loadEnv(p: string): void { if (!existsSync(p)) return; for (const line of readFileSync(p, "utf8").split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith("#")) continue; const eq = t.indexOf("="); if (eq < 0) continue; const k = t.slice(0, eq).trim(); if (!k || process.env[k] !== undefined) continue; let v = t.slice(eq + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); process.env[k] = v; } }
function getSupabase(): SupabaseClient {
  const root = path.resolve(toolRoot, "..", "..");
  for (const p of [path.join(root, ".env.local"), path.join(root, ".env"), "/Users/igor/igor-tp-reports-bot/.env.local", "/Users/igor/igor-tp-reports-bot/.env"]) loadEnv(p);
  const url = process.env.SUPABASE_URL?.trim(); const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}
const iso = (d: number): string => new Date(d).toISOString().slice(0, 10);
const addDays = (s: string, n: number): string => iso(Date.parse(s) + n * 86400000);

function printWeek(w: Week, label: string): string[] {
  const L: string[] = [];
  L.push(`\n${"─".repeat(78)}`);
  L.push(`${label} · атлет ${w.athleteId} · тир ${w.tier} · неделя с ${w.weekStart}`);
  L.push("─".repeat(78));
  if (w.notes.length) L.push(`заметки сборщика: ${w.notes.join("; ")}`);
  L.push(`решение по качеству: ${w.qualityDecision}`);
  for (const s of w.sessions) {
    L.push(`\n  ${DAY_RU[s.dayIdx]} ${addDays(w.weekStart, s.dayIdx)} — ${s.title} (${s.minutes} мин) [${s.presetCode}]`);
    if (s.deferred) { L.push(`     ⚑ DEFER: ${s.deferReason}`); continue; }
    L.push(`     ${s.description}`);
    const pctTxt = s.pctMin != null ? ` · ${s.pctMin}–${s.pctMax}% от порога` : " · % не считаем (порога нет)";
    L.push(`     [источник: ${s.anchorSource} · доверие: ${s.confidence} · режим: ${s.targetMode}${pctTxt}]`);
    if (s.warnings.length) L.push(`     ⚠ ${s.warnings.join(" | ")}`);
    if (s.coachReview.length) L.push(`     ✋ на проверку тренеру: ${s.coachReview.join(" | ")}`);
  }
  return L;
}

async function main(): Promise<void> {
  const sb = getSupabase();
  console.log("[week] загружаю контексты…");
  const ctx = await loadAthleteContexts(sb);
  const cat = await loadCatalog(sb);
  console.log(`[week] каталог: аэробных пресетов ${cat.aerobic.size}, кандидатов качества ${cat.quality.length}, guardrails ${cat.guardrails.length}, review-rules ${cat.reviewRules.length}`);
  const weekStart = addDays(mondayOf(iso(Date.now())), 7); // следующая неделя
  console.log(`[week] атлетов ${ctx.size}, неделя с ${weekStart}`);

  const weeks: Week[] = []; const skipped: Array<{ aid: number; why: string }> = [];
  for (const c of ctx.values()) {
    if (!c.easy) { skipped.push({ aid: c.athleteId, why: "нет якоря лёгкого и фолбэка" }); continue; }
    if (c.envelope.weeksObserved === 0) { skipped.push({ aid: c.athleteId, why: "нет наблюдённых недель" }); continue; }
    weeks.push(buildWeek(c, c.envelope, cat, weekStart, c.hasActiveIllness));
  }

  const all = weeks.flatMap((w) => w.sessions);
  const deferred = all.filter((s) => s.deferred);
  const bySrc = new Map<string, number>();
  for (const s of all) if (!s.deferred) bySrc.set(s.anchorSource, (bySrc.get(s.anchorSource) ?? 0) + 1);
  const deferReasons = new Map<string, number>();
  for (const s of deferred) deferReasons.set(s.deferReason ?? "?", (deferReasons.get(s.deferReason ?? "?") ?? 0) + 1);

  const out: string[] = [];
  out.push(`# Первая сгенерированная неделя — ${weekStart}`);
  out.push(`\nатлетов с неделей: ${weeks.length} · сессий: ${all.length} · в defer: ${deferred.length}`);
  out.push(`пропущено атлетов: ${skipped.length}`);
  out.push(`\n## anchor_source по сессиям`);
  [...bySrc.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => out.push(`- ${k}: ${v}`));
  const qPresets = new Map<string, number>();
  for (const w of weeks) for (const s2 of w.sessions) if (s2.role === "quality" && !s2.deferred) qPresets.set(s2.presetCode, (qPresets.get(s2.presetCode) ?? 0) + 1);
  out.push(`\n## недель с качеством: ${weeks.filter((w) => w.sessions.some((s2) => s2.role === "quality" && !s2.deferred)).length} из ${weeks.length}`);
  out.push(`## выбранные пресеты качества (${qPresets.size} разных)`);
  [...qPresets.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => out.push(`- ${k}: ${v}`));
  out.push(`\n## defer по причинам`);
  if (deferReasons.size === 0) out.push("- нет");
  [...deferReasons.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => out.push(`- ${k}: ${v}`));

  // три показательные недели
  const withQ = weeks.find((w) => w.athleteId !== 5673496 && w.sessions.some((s) => s.role === "quality" && !s.deferred) && w.sessions.some((s) => s.anchorSource === "easy_description"));
  const fallback = weeks.find((w) => w.athleteId === 5673496);
  const t1 = weeks.find((w) => w.tier === "T1" && w.sessions.some((s) => s.targetMode === "rpe" && !s.deferred));
  const picks: Array<[Week | undefined, string]> = [[withQ, "С КАЧЕСТВОМ"], [fallback, "ФОЛБЭК zone2 · атлет 5673496 (для сравнения)"], [t1, "T1 · лёгкий по ощущениям"]];
  const printed: string[] = [];
  for (const [w, label] of picks) if (w) printed.push(...printWeek(w, label));
  out.push("\n## Три недели целиком"); out.push(...printed);

  const dir = path.join(path.resolve(toolRoot, "..", ".."), "reports", "autoplanner-week", `${weekStart.replace(/-/g, "")}-${Date.now().toString().slice(-4)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "week.md"), out.join("\n") + "\n");
  writeFileSync(path.join(dir, "weeks.json"), JSON.stringify({ weekStart, weeks, skipped }, null, 2) + "\n");

  console.log(out.join("\n"));
  console.log(`\n[week] отчёт → ${dir}`);
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
