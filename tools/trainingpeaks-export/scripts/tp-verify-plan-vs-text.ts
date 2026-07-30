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
function loadEnv(p: string): void { if (!existsSync(p)) return; for (const line of readFileSync(p, "utf8").split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith("#")) continue; const eq = t.indexOf("="); if (eq < 0) continue; const k = t.slice(0, eq).trim(); if (!k || process.env[k] !== undefined) continue; let v = t.slice(eq + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); process.env[k] = v; } }
const root = path.resolve(toolRoot, "..", ".."); loadEnv(path.join(root, ".env.local")); loadEnv(path.join(root, ".env"));
const sb = createClient(process.env.SUPABASE_URL!.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), { auth: { persistSession: false } });
const S = (mm: string): number => { const [a, b] = mm.split(":"); return Number(a) * 60 + Number(b); };
const fp = (s: number | null): string => (s && s > 0 && Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : "—");
const todayIso = (): string => new Date().toISOString().slice(0, 10);
async function bearer(): Promise<string> { const s = await readSessionSnapshot(); const r = await fetch(`${TP_API_HOST}/users/v3/token`, { headers: { accept: "application/json", Cookie: `Production_tpAuth=${s.cookieValue}` } }); return ((await r.json()) as { token: { access_token: string } }).token.access_token; }
async function getWk(aid: number, wid: number, b: string): Promise<Record<string, unknown>> { const r = await fetch(`${TP_API_HOST}/fitness/v6/athletes/${aid}/workouts/${wid}`, { headers: { accept: "application/json", authorization: `Bearer ${b}` } }); const o = await r.json(); return isRecord(o) ? o : {}; }
type Rng = { fast: number; slow: number; idx: number };
/** Pace ranges from the description, in appearance order. Catches (1) explicit "X–Y" dash ranges,
 *  (2) one-sided prose ceilings "6:23 и медленнее" (point range fast=slow), and (3) a narrative
 *  easy-run range "…ближе к 7:04 … ближе к 7:29" when nothing structured was found. */
function ranges(desc: string): Rng[] {
  const out: Rng[] = [];
  const push = (a: number, b: number, idx: number): void => { const fast = Math.min(a, b), slow = Math.max(a, b); if (fast < 150 || slow > 600) return; out.push({ fast, slow, idx }); };
  let m: RegExpExecArray | null;
  const dash = /(\d{1,2}:\d{2})\s*(?:[-–—−]|@|до)\s*(\d{1,2}:\d{2})/gi;
  while ((m = dash.exec(desc)) !== null) push(S(m[1]), S(m[2]), m.index);
  const slower = /(\d{1,2}:\d{2})\s*(?:и|или)\s+(?:медленн|тише|легче|спокойн)/gi; // Cyrillic stems (no \w/\b)
  while ((m = slower.exec(desc)) !== null) { const t = S(m[1]); if (t >= 150 && t <= 600) out.push({ fast: t, slow: t, idx: m.index }); }
  if (out.length === 0) {
    const near = /ближе\s+к\s+(\d{1,2}:\d{2})/gi; const ts: { t: number; idx: number }[] = [];
    while ((m = near.exec(desc)) !== null) { const t = S(m[1]); if (t >= 150 && t <= 600) ts.push({ t, idx: m.index }); }
    if (ts.length >= 2) { const lo = ts.reduce((a, b) => (b.t < a.t ? b : a)); const hi = ts.reduce((a, b) => (b.t > a.t ? b : a)); push(lo.t, hi.t, Math.min(lo.idx, hi.idx)); }
  }
  out.sort((a, b) => a.idx - b.idx);
  return out;
}
type Role = "разминка" | "заминка" | "отдых" | "работа";
type Flat = { role: Role; min: number; max: number; block: number; step: number; durSec: number };
function flatSteps(structObj: unknown): Flat[] | null { if (!isRecord(structObj) || !Array.isArray(structObj.structure)) return null; const steps: Flat[] = []; structObj.structure.forEach((block, bi) => { if (!isRecord(block) || !Array.isArray(block.steps)) return; block.steps.forEach((st, si) => { if (!isRecord(st)) return; const tg = Array.isArray(st.targets) && st.targets.length && isRecord(st.targets[0]) ? st.targets[0] : null; const cls = String(st.intensityClass ?? ""); const nm = String(st.name ?? ""); const role: Role = /warm|размин/i.test(nm) || cls === "warmUp" ? "разминка" : /cool|замин/i.test(nm) || cls === "coolDown" ? "заминка" : cls === "rest" ? "отдых" : "работа"; const len = isRecord(st.length) ? st.length : null; const durSec = len && String(len.unit ?? "") === "second" && typeof len.value === "number" ? len.value : 0; steps.push({ role, min: tg && typeof tg.minValue === "number" ? tg.minValue : NaN, max: tg && typeof tg.maxValue === "number" ? tg.maxValue : NaN, block: bi, step: si, durSec }); }); }); return steps; }
type Seg = { durSec: number; range: Rng | null };
function parseSegments(desc: string): Seg[] { const durRe = /(\d+(?:[.,]\d+)?)\s*(секунд|сек|минут|мин)/gi; const durs: { pos: number; sec: number }[] = []; let m: RegExpExecArray | null; while ((m = durRe.exec(desc)) !== null) { const n = parseFloat(m[1].replace(",", ".")); if (!Number.isFinite(n) || n <= 0) continue; const sec = /сек/i.test(m[2]) ? n : n * 60; durs.push({ pos: m.index, sec }); } const rs = ranges(desc); const segs: Seg[] = []; for (let i = 0; i < durs.length; i++) { const start = durs[i].pos; const end = i + 1 < durs.length ? durs[i + 1].pos : desc.length; const r = rs.find((x) => x.idx >= start && x.idx < end); segs.push({ durSec: durs[i].sec, range: r ?? null }); } return segs; }
function matchByDuration(steps: Flat[], segs: Seg[]): (Rng | "anchor" | "keep")[] | null { const out: (Rng | "anchor" | "keep")[] = []; let ptr = 0; for (const st of steps) { if (st.durSec <= 0) return null; const tol = Math.max(10, st.durSec * 0.08); let found = -1; for (let j = ptr; j < segs.length; j++) { if (Math.abs(segs[j].durSec - st.durSec) <= tol) { found = j; break; } } if (found < 0) return null; const seg = segs[found]; ptr = found + 1; out.push(seg.range ? seg.range : st.role === "работа" ? "keep" : "anchor"); } return out; }
function positionalFallback(steps: Flat[], rs: Rng[]): (Rng | "anchor")[] | null { const nonRest = steps.filter((s) => s.role !== "отдых"); let mode: "positional" | "positionalAll" | "anchorAll"; if (rs.length === 0) { if (nonRest.length > 1) return null; mode = "anchorAll"; } else if (rs.length === steps.length) mode = "positionalAll"; else if (rs.length === nonRest.length) mode = "positional"; else return null; const out: (Rng | "anchor")[] = []; let pos = 0; for (const st of steps) { if (mode === "anchorAll") out.push("anchor"); else if (mode === "positionalAll") { out.push(rs[pos]); pos++; } else if (st.role === "отдых") out.push("anchor"); else { out.push(rs[pos]); pos++; } } return out; }
/** Assign the DESCRIPTION pace to each step: segment-by-duration first, positional fallback for
 *  no-duration descriptions. Returns per step a text range, 'anchor'/'keep' (no text pace to check),
 *  or 'defer' if the text can't be mapped. Mirrors tp-threshold-restore.recompute. */
function assignRefs(steps: Flat[], desc: string): (Rng | "anchor" | "keep")[] | "defer" {
  let a: (Rng | "anchor" | "keep")[] | null = matchByDuration(steps, parseSegments(desc));
  if (!a) a = positionalFallback(steps, ranges(desc));
  return a ?? "defer";
}

async function main(): Promise<void> {
  const b = await bearer(); const today = todayIso();
  const roster = process.argv.includes("--roster");
  let ids: number[]; let scopeErr = 0;
  if (roster) {
    const r = await getCoachedAthletesRoster();
    ids = [...new Set(r.filter((a) => Number.isInteger(a.athleteId) && a.athleteId > 0).map((a) => a.athleteId))];
  } else {
    const { data: rb } = await sb.from("tp_threshold_applications").select("trainingpeaks_athlete_id").eq("kind", "pace").eq("tier", "restore");
    ids = [...new Set((rb ?? []).map((r) => Number(r.trainingpeaks_athlete_id)))];
  }
  const bad: { date: string; line: string }[] = []; let ok = 0, wk = 0, skippedSteps = 0, deferWk = 0;
  for (const id of ids) {
    let s; try { s = await getAthleteSettings(id); } catch { scopeErr++; continue; }
    const w0 = findWt0Set(s.speedZones); const thrMps = w0 && typeof w0.threshold === "number" ? w0.threshold : NaN; if (!thrMps) continue; const thrSec = 1000 / thrMps;
    const { data: nm } = await sb.from("trainingpeaks_workout_cache").select("student_name").eq("trainingpeaks_athlete_id", id).not("student_name", "is", null).limit(1); const name = (nm?.[0]?.student_name as string) ?? String(id);
    const { data: fut } = await sb.from("trainingpeaks_workout_cache").select("title,trainingpeaks_workout_id,is_planned,completed_time_raw,workout_type_value_id,description:source_snapshot->>description,workout_date").eq("trainingpeaks_athlete_id", id).gte("workout_date", today);
    const planned = (fut ?? []).filter((r) => r.is_planned === true && (r.completed_time_raw == null || r.completed_time_raw === 0) && r.workout_type_value_id === 3);
    for (const w of planned) {
      const live = await getWk(id, Number(w.trainingpeaks_workout_id), b); const st = live.structure; if (!isRecord(st) || !/pace/i.test(String(st.primaryIntensityMetric ?? ""))) continue;
      const steps = flatSteps(st); if (!steps) continue; wk++;
      const refs = assignRefs(steps, typeof w.description === "string" ? w.description : "");
      if (refs === "defer") { deferWk++; bad.push({ date: w.workout_date as string, line: `${w.workout_date} · ${name} «${w.title}» — ⚠ДЕФЕР (описание не привязать к шагам — НЕ ПРОВЕРИТЬ)` }); continue; }
      const diffs: string[] = [];
      steps.forEach((step, i) => {
        const r = refs[i];
        // no explicit pace in the text for this step → nothing to verify against the DESCRIPTION.
        if (r === "keep" || r === "anchor") { skippedSteps++; return; }
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
  console.log(`scope: ${roster ? "ВЕСЬ РОСТЕР" : "restore"} · атлетов ${ids.length}${scopeErr ? ` (ошибок GET настроек: ${scopeErr})` : ""} · темповых плановых ${wk} (>= ${today})`);
  console.log(`пропущено как непроверяемые по тексту: ${skippedSteps} шаг(ов) (нет числа в описании / открытый пол без потолка)`);
  console.log(`\n======== РАСХОЖДЕНИЯ СТРУКТУРЫ И ТЕКСТА — ${bad.length} тренировок ========`);
  if (!bad.length) console.log("  (нет — все шаги с явным темпом совпадают с описанием)");
  for (const x of bad) console.log(`  ${x.date === today ? "🔴СЕГОДНЯ " : ""}${x.line}`);
  console.log(`\nчисто: ${ok} тренировок · дефер: ${deferWk}`);
}
main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
