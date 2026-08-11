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
import { buildWeek, shownBands, DAY_RU, type Week } from "./lib/autoplanner-week.ts";
import { loadCatalog } from "./lib/autoplanner-catalog.ts";
import { checkShownBands, MIN_EASY_TO_QUALITY_RATIO } from "./lib/band-collision.ts";

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
  const rejected: Array<{ aid: number; src: string; ratio: number; why: string }> = [];
  const colStats = new Map<string, number>();
  const refusedByCeiling: Array<{ aid: number; why: string; week: Week }> = [];
  for (const c of ctx.values()) {
    if (!c.easy) { skipped.push({ aid: c.athleteId, why: "нет якоря лёгкого и фолбэка" }); continue; }
    if (c.envelope.weeksObserved === 0) { skipped.push({ aid: c.athleteId, why: "нет наблюдённых недель" }); continue; }
    const w = buildWeek(c, c.envelope, cat, weekStart, c.hasActiveIllness, c.tierNote);
    // ОТКАЗ ПО НЕВМЕСТИМОСТИ: потолок объёма неприкосновенен. Если даже минимальная неделя в
    // него не влезает, неделю НЕ выдаём — случай уходит тренеру.
    if (w.refused) { refusedByCeiling.push({ aid: c.athleteId, why: w.refused, week: w }); continue; }
    // ПРОВЕРКА НА СЛИПАНИЕ — ПОСЛЕ сборки и по ПОКАЗАННЫМ полосам: сравнивать надо то, что
    // ученик увидит в тексте. Где темп не показывается (лёгкий по ощущениям, качества нет),
    // слипаться нечему. При срабатывании неделю не выдаём и полосу молча не подкручиваем —
    // подкрутка спрятала бы негодный источник вместо того, чтобы его показать.
    const shown = shownBands(w);
    const col = checkShownBands(shown.easy, shown.quality, c.quality != null);
    colStats.set(col.status, (colStats.get(col.status) ?? 0) + 1);
    if (col.status === "collision") {
      rejected.push({ aid: c.athleteId, src: c.easy.source, ratio: col.ratio, why: col.message });
      continue;
    }
    weeks.push(w);
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
  out.push(`ОТКАЗАНО по невместимости в потолок объёма: ${refusedByCeiling.length}`);
  for (const r of refusedByCeiling) out.push(`- ${r.aid}: ${r.why}${r.week.notes.length ? ` · ${r.week.notes.join("; ")}` : ""}`);
  out.push(`ОТКЛОНЕНО по слипанию лёгкого с качеством: ${rejected.length}`);
  for (const r of rejected) out.push(`- ${r.aid} [${r.src}] отношение ${r.ratio.toFixed(3)} — лёгкий не подтверждён`);
  out.push(`проверка на слипание, статусы: ${[...colStats.entries()].map(([k, v]) => `${k} ${v}`).join(" · ")}`
    + ` (граница ${MIN_EASY_TO_QUALITY_RATIO})`);
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

  // ДЛИТЕЛЬНАЯ ОБЯЗАНА БЫТЬ САМОЙ ДЛИННОЙ СЕССИЕЙ НЕДЕЛИ (правило Игоря 11.08).
  const withLong = weeks.filter((w) => w.sessions.some((s2) => s2.role === "long" && !s2.deferred));
  const notLongest = withLong.filter((w) => {
    const long = w.sessions.find((s2) => s2.role === "long" && !s2.deferred)!;
    return w.sessions.some((s2) => !s2.deferred && s2.role !== "long" && s2.minutes >= long.minutes);
  });
  const noteHist = new Map<string, number>();
  for (const w of weeks) for (const nt of w.notes) {
    const key = nt.replace(/\(\d+ мин\)/, "(…)").replace(/на \d+ мин/, "на … мин");
    noteHist.set(key, (noteHist.get(key) ?? 0) + 1);
  }
  out.push(`\n## лестница сокращения — что срабатывало`);
  [...noteHist.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => out.push(`- ${k}: ${v}`));

  const tierDowngraded = [...ctx.values()].filter((c) => c.tierNote);
  out.push(`\n## тир понижен (падение объёма / health-сигнал): ${tierDowngraded.length}`);
  const byTierReason = new Map<string, number>();
  for (const c of tierDowngraded) byTierReason.set(c.tierNote!.includes("health") ? "health-сигнал" : "падение объёма",
    (byTierReason.get(c.tierNote!.includes("health") ? "health-сигнал" : "падение объёма") ?? 0) + 1);
  [...byTierReason.entries()].forEach(([k, v]) => out.push(`- ${k}: ${v}`));

  const confHist = new Map<string, number>();
  for (const c of ctx.values()) if (c.quality) confHist.set(c.quality.confidence, (confHist.get(c.quality.confidence) ?? 0) + 1);
  out.push(`\n## доверие якоря качества (по атлетам со своим якорем)`);
  [...confHist.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => out.push(`- ${k}: ${v}`));
  const thinShown = all.filter((s) => !s.deferred && s.warnings.some((x) => x.includes("якорь качества тонкий"))).length;
  out.push(`- сессий с явной пометкой «якорь тонкий»: ${thinShown}`);

  const overCap = weeks.filter((w) => w.plannedMinutes > w.weeklyCap);
  out.push(`\n## потолок объёма`);
  out.push(`- недель выше потолка: ${overCap.length} (должно быть 0)`);
  for (const w of overCap.slice(0, 10)) out.push(`  - ${w.athleteId}: ${w.plannedMinutes} мин при потолке ${w.weeklyCap}`);
  const warmupCollapsed = weeks.filter((w) => w.notes.some((nt) => nt.includes("разминка свёрнута"))).length;
  out.push(`- разминка свёрнута до простой: ${warmupCollapsed} (должно быть 0)`);

  out.push(`\n## длительная — самая длинная сессия недели`);
  out.push(`- недель с длительной: ${withLong.length}`);
  out.push(`- НЕ самая длинная: ${notLongest.length}`);
  for (const w of notLongest.slice(0, 12)) {
    const long = w.sessions.find((s2) => s2.role === "long" && !s2.deferred)!;
    const worst = w.sessions.filter((s2) => !s2.deferred && s2.role !== "long").sort((x, y) => y.minutes - x.minutes)[0];
    out.push(`  - ${w.athleteId}: длительная ${long.minutes} мин против ${worst.role} ${worst.minutes} мин [${worst.presetCode}]`);
  }

  // три недели наряда — именно эти атлеты, не «похожие»
  const SHOW: Array<[number, string]> = [[5733231, "СВОЙ ЯКОРЬ + КАЧЕСТВО"], [5673496, "ЗОНА 2 (был отклонён старой границей)"], [5847207, "T1 · ПО ОЩУЩЕНИЯМ (был отклонён старой границей)"]];
  const printed: string[] = [];
  for (const [aid, label] of SHOW) {
    const w = weeks.find((x) => x.athleteId === aid);
    if (w) { printed.push(...printWeek(w, label)); continue; }
    const r = rejected.find((x) => x.aid === aid);
    const rc = refusedByCeiling.find((x) => x.aid === aid);
    printed.push(`\n${"─".repeat(78)}`, `${label} · атлет ${aid}`, "─".repeat(78),
      rc ? `НЕДЕЛЯ НЕ ВЫДАНА (не помещается): ${rc.why}${rc.week.notes.length ? `\n   ${rc.week.notes.join("; ")}` : ""}`
        : r ? `НЕДЕЛИ НЕТ: ${r.why}` : `НЕДЕЛИ НЕТ: ${skipped.find((x) => x.aid === aid)?.why ?? "атлет не в выборке"}`);
  }
  // Одна отказная неделя целиком — как выглядит отказ.
  if (refusedByCeiling.length > 0) {
    const ex = refusedByCeiling.find((x) => !SHOW.some(([aid]) => aid === x.aid)) ?? refusedByCeiling[0];
    printed.push(`\n${"─".repeat(78)}`, `ОБРАЗЕЦ ОТКАЗА · атлет ${ex.aid}`, "─".repeat(78),
      `причина: ${ex.why}`, `заметки сборщика: ${ex.week.notes.join("; ") || "нет"}`,
      `сессий не выдано ни одной — случай уходит тренеру`);
  }
  out.push("\n## Три недели целиком"); out.push(...printed);

  const dir = path.join(path.resolve(toolRoot, "..", ".."), "reports", "autoplanner-week", `${weekStart.replace(/-/g, "")}-${Date.now().toString().slice(-4)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "week.md"), out.join("\n") + "\n");
  writeFileSync(path.join(dir, "weeks.json"), JSON.stringify({ weekStart, weeks, skipped, rejected }, null, 2) + "\n");

  console.log(out.join("\n"));
  console.log(`\n[week] отчёт → ${dir}`);
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
