/** READ-ONLY. Verify that planned pace workouts (today and later) render, under the CURRENT
 *  threshold, within 20s of the DESCRIPTION TEXT. Writes NOTHING.
 *
 *  TEXT-FIRST — this checks structure against the DESCRIPTION, nothing else:
 *   - A step whose description segment gives NO pace number (по ощущениям / очень легко / шагом)
 *     is "not checkable by text" and is SKIPPED. The FIT easy-anchor is an authoring-sanity
 *     heuristic, NOT the text — comparing to it produced false "divergences" and belongs elsewhere.
 *   - An OPEN-FLOOR step (minValue=0 — a deliberate walk / very-easy floor) is checked by its
 *     CEILING only: the midpoint of a 0–X% range is meaningless (it read as ~13–16 min/км garbage).
 *   - Only steps with an EXPLICIT pace in the text are compared (midpoint, or ceiling if open-floor).
 *
 *  Scope: default = restored athletes (tier=restore); pass --roster for the whole coached roster. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { getAthleteSettings, getCoachedAthletesRoster } from "../../../src/features/trainingpeaks/tp-api-client.ts";
import { readSessionSnapshot } from "../../../src/features/trainingpeaks/tp-session-snapshot.ts";
import { findWt0Set, isRecord, TP_API_HOST } from "./lib/tp-athlete-helpers.ts";
import { toolRoot } from "./lib/paths.ts";
import { ranges, flatSteps, parseSegments, matchByDuration, positionalFallback, median, type Rng, type FlatStep } from "./lib/tp-recompute.ts";
import { loadRecomputeExceptions, loadManualAnchors } from "./lib/tp-manual-overrides.ts";
function loadEnv(p: string): void { if (!existsSync(p)) return; for (const line of readFileSync(p, "utf8").split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith("#")) continue; const eq = t.indexOf("="); if (eq < 0) continue; const k = t.slice(0, eq).trim(); if (!k || process.env[k] !== undefined) continue; let v = t.slice(eq + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); process.env[k] = v; } }
const root = path.resolve(toolRoot, "..", ".."); for (const p of [path.join(root, ".env.local"), path.join(root, ".env"), "/Users/igor/igor-tp-reports-bot/.env.local", "/Users/igor/igor-tp-reports-bot/.env"]) loadEnv(p);
const sb = createClient(process.env.SUPABASE_URL!.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), { auth: { persistSession: false } });
const fp = (s: number | null): string => (s && s > 0 && Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : "—");
const todayIso = (): string => new Date().toISOString().slice(0, 10);
async function bearer(): Promise<string> { const s = await readSessionSnapshot(); const r = await fetch(`${TP_API_HOST}/users/v3/token`, { headers: { accept: "application/json", Cookie: `Production_tpAuth=${s.cookieValue}` } }); return ((await r.json()) as { token: { access_token: string } }).token.access_token; }
async function getWk(aid: number, wid: number, b: string): Promise<Record<string, unknown>> { const r = await fetch(`${TP_API_HOST}/fitness/v6/athletes/${aid}/workouts/${wid}`, { headers: { accept: "application/json", authorization: `Bearer ${b}` } }); const o = await r.json(); return isRecord(o) ? o : {}; }
/** Assign the DESCRIPTION pace to each step: segment-by-duration first, positional fallback for
 *  no-duration descriptions. Returns per step a text range, 'anchor'/'keep' (no text pace to check),
 *  or 'defer' if the text can't be mapped. Mirrors tp-threshold-restore.recompute. */
function assignRefs(steps: FlatStep[], desc: string): (Rng | "anchor" | "keep")[] | "defer" {
  // shared lib matchByDuration/positionalFallback return Assign[] ({ref, walk}); verify only needs
  // the ref (its comparison ignores walk). .ref is the identical expression the old local copy pushed.
  let a = matchByDuration(steps, parseSegments(desc));
  if (!a) a = positionalFallback(steps, ranges(desc));
  return a ? a.map((x) => x.ref) : "defer";
}
const daysAgo = (n: number): string => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
/** FIT easy anchor (identical to recompute/restore): median of slower-70% of reps=0 continuous runs
 *  90d, excl ~threshold-pace. n<5 → null. FIX 6 uses it to flag no-pace steps that render faster than easy. */
async function fitAnchor(id: number, thrSec: number): Promise<number | null> {
  const dm: { workout_cache_id: string }[] = [];
  for (let f = 0; ; f += 1000) { const { data } = await sb.from("trainingpeaks_workout_derived_metrics").select("workout_cache_id").eq("trainingpeaks_athlete_id", id).eq("workout_type", "run").eq("has_fit", true).eq("reps_detected_count", 0).gte("workout_date", daysAgo(90)).lte("workout_date", todayIso()).range(f, f + 999); if (!data || !data.length) break; dm.push(...(data as { workout_cache_id: string }[])); if (data.length < 1000) break; }
  const cids = dm.map((r) => r.workout_cache_id); const ps: number[] = [];
  for (let i = 0; i < cids.length; i += 300) { const { data } = await sb.from("trainingpeaks_workout_cache").select("completed_distance_raw, completed_time_raw").in("id", cids.slice(i, i + 300)); for (const w of data ?? []) { const mm = typeof w.completed_distance_raw === "number" ? w.completed_distance_raw : 0; const h = typeof w.completed_time_raw === "number" ? w.completed_time_raw : 0; if (mm < 3000 || h <= 0) continue; const pc = (h * 3600) / (mm / 1000); if (pc > thrSec + 30 && pc < 540) ps.push(pc); } }
  const srt = [...ps].sort((a, b) => a - b); return srt.length >= 5 ? median(srt.slice(Math.floor(srt.length * 0.3))) : null;
}

async function main(): Promise<void> {
  const b = await bearer(); const today = todayIso();
  const roster = process.argv.includes("--roster");
  // --ids=5475679,5476215,... — verify a POINTED list (e.g. a batch about to be applied), not the
  // whole roster. Takes precedence over --roster.
  const idsArg = process.argv.find((a) => a.startsWith("--ids="));
  let ids: number[]; let scopeErr = 0; let scopeLabel: string;
  if (idsArg) {
    ids = [...new Set(idsArg.slice("--ids=".length).split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0))];
    scopeLabel = `список (${ids.length})`;
  } else if (roster) {
    const r = await getCoachedAthletesRoster();
    ids = [...new Set(r.filter((a) => Number.isInteger(a.athleteId) && a.athleteId > 0).map((a) => a.athleteId))];
    scopeLabel = "ВЕСЬ РОСТЕР";
  } else {
    const { data: rb } = await sb.from("tp_threshold_applications").select("trainingpeaks_athlete_id").eq("kind", "pace").eq("tier", "restore");
    ids = [...new Set((rb ?? []).map((r) => Number(r.trainingpeaks_athlete_id)))];
    scopeLabel = "restore";
  }
  const exceptions = await loadRecomputeExceptions(sb); const manualAnchors = await loadManualAnchors(sb); let excluded = 0, holodnaya = 0; // намеренно не чиним; класс Холодной (нет числа, быстрее якоря)
  const bad: { date: string; line: string }[] = []; let ok = 0, wk = 0, skippedSteps = 0, deferWk = 0;
  for (const id of ids) {
    if (exceptions.has(id)) { excluded++; continue; }
    let s; try { s = await getAthleteSettings(id); } catch { scopeErr++; continue; }
    const w0 = findWt0Set(s.speedZones); const thrMps = w0 && typeof w0.threshold === "number" ? w0.threshold : NaN; if (!thrMps) continue; const thrSec = 1000 / thrMps;
    const anchor = manualAnchors.get(id) ?? await fitAnchor(id, thrSec);
    const { data: nm } = await sb.from("trainingpeaks_workout_cache").select("student_name").eq("trainingpeaks_athlete_id", id).not("student_name", "is", null).limit(1); const name = (nm?.[0]?.student_name as string) ?? String(id);
    const { data: fut } = await sb.from("trainingpeaks_workout_cache").select("title,trainingpeaks_workout_id,is_planned,completed_time_raw,workout_type_value_id,description:source_snapshot->>description,workout_date").eq("trainingpeaks_athlete_id", id).gte("workout_date", today);
    const planned = (fut ?? []).filter((r) => r.is_planned === true && (r.completed_time_raw == null || r.completed_time_raw === 0) && r.workout_type_value_id === 3);
    for (const w of planned) {
      const live = await getWk(id, Number(w.trainingpeaks_workout_id), b); const st = live.structure; if (!isRecord(st) || !/pace/i.test(String(st.primaryIntensityMetric ?? ""))) continue;
      const fx = flatSteps(st); if (!fx) continue; const steps = fx.steps; wk++;
      const isEasy = !fx.isRep && /лёгк|легк|длительн|восстанов|свободн/i.test(String(w.title ?? ""));
      const refs = assignRefs(steps, typeof w.description === "string" ? w.description : "");
      if (refs === "defer") { deferWk++; bad.push({ date: w.workout_date as string, line: `${w.workout_date} · ${name} «${w.title}» — ⚠ДЕФЕР (описание не привязать к шагам — НЕ ПРОВЕРИТЬ)` }); continue; }
      const diffs: string[] = [];
      steps.forEach((step, i) => {
        const r = refs[i];
        // no explicit pace in the text for this step → nothing to verify against the DESCRIPTION TEXT.
        if (r === "keep" || r === "anchor") {
          // FIX 6 (класс Холодной): раньше молча пропускали — это и была слепота. Если шаг ДОЛЖЕН быть
          // лёгким (isEasy-работа / разминка / заминка) и рендерит быстрее ЯКОРЯ на >30с — лёгкий стал
          // темповым (пересчёт ещё не застал). Флагим. Интервальные RPE-репы (не isEasy работа) НЕ трогаем
          // — они и должны быть быстрее лёгкого; открытый пол (min=0) тоже не сюда.
          const easyImplied = step.role === "разминка" || step.role === "заминка" || (isEasy && step.role === "работа");
          if (easyImplied && anchor && step.min > 0 && Number.isFinite(step.min) && Number.isFinite(step.max)) {
            const rendered = thrSec * 100 / ((step.min + step.max) / 2); const d = anchor - rendered;
            if (d > 30) { diffs.push(`[b${step.block}s${step.step}] ${step.role} @${fp(rendered)} (${step.min}-${step.max}%, НЕТ числа в описании) быстрее якоря ${fp(anchor)} на ${Math.round(d)}с`); holodnaya++; return; }
          }
          skippedSteps++; return;
        }
        if (step.min === 0) {
          // open floor (walk / very-easy) — compare the CEILING only; midpoint of 0–X% is garbage.
          const structCeil = Number.isFinite(step.max) && step.max > 0 ? thrSec * 100 / step.max : null;
          if (structCeil == null) { skippedSteps++; return; }
          const textCeil = Math.min(r.fast, r.slow);
          const d = Math.abs(structCeil - textCeil);
          if (d > 20) diffs.push(`[b${step.block}s${step.step}] ${step.role} потолок @${fp(structCeil)} (0-${step.max}%) ≠ ТЕКСТ ≤${fp(textCeil)} — Δ${Math.round(d)}с`);
          return;
        }
        const mid = (step.min + step.max) / 2; const livePace = Number.isFinite(mid) && mid > 0 ? thrSec * 100 / mid : null;
        if (livePace == null) { skippedSteps++; return; }
        const refPace = (r.fast + r.slow) / 2;
        const d = Math.abs(livePace - refPace);
        if (d > 20) diffs.push(`[b${step.block}s${step.step}] ${step.role} факт @${fp(livePace)} (${step.min}-${step.max}%) ≠ ОПИСАНИЕ ${fp(r.slow)}–${fp(r.fast)} — Δ${Math.round(d)}с`);
      });
      if (diffs.length) bad.push({ date: w.workout_date as string, line: `${w.workout_date} · ${name} «${w.title}» · порог ${fp(thrSec)}\n     ${diffs.join("\n     ")}` }); else ok++;
    }
  }
  bad.sort((a, b2) => a.date.localeCompare(b2.date));
  console.log(`scope: ${scopeLabel} · атлетов ${ids.length}${scopeErr ? ` (ошибок GET настроек: ${scopeErr})` : ""} · темповых плановых ${wk} (>= ${today})`);
  console.log(`пропущено как непроверяемые по тексту: ${skippedSteps} шаг(ов) (нет числа в описании / открытый пол без потолка)`);
  console.log(`\n======== РАСХОЖДЕНИЯ СТРУКТУРЫ И ТЕКСТА — ${bad.length} тренировок ========`);
  if (!bad.length) console.log("  (нет — все шаги с явным темпом совпадают с описанием)");
  for (const x of bad) console.log(`  ${x.date === today ? "🔴СЕГОДНЯ " : ""}${x.line}`);
  console.log(`\nчисто: ${ok} тренировок · дефер: ${deferWk}${excluded ? ` · намеренно не чиним (пропущено атлетов): ${excluded}` : ""}${holodnaya ? ` · класс Холодной (нет числа, быстрее якоря >30с): ${holodnaya}` : ""}`);
}
main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
