/** READ-ONLY. For every restored athlete, every planned pace workout (today+later), compare the
 *  CURRENT live %-targets against what the (current, positionalAll-aware) recompute would produce
 *  under the athlete's current threshold. Any step that differs, or any workout that DEFERS
 *  (can't be verified), is a problem — an un-recomputed / mis-mapped workout. Writes NOTHING. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { getAthleteSettings } from "../../../src/features/trainingpeaks/tp-api-client.ts";
import { readSessionSnapshot } from "../../../src/features/trainingpeaks/tp-session-snapshot.ts";
import { findWt0Set, isRecord, TP_API_HOST } from "./lib/tp-athlete-helpers.ts";
import { toolRoot } from "./lib/paths.ts";
function loadEnv(p: string): void { if (!existsSync(p)) return; for (const line of readFileSync(p, "utf8").split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith("#")) continue; const eq = t.indexOf("="); if (eq < 0) continue; const k = t.slice(0, eq).trim(); if (!k || process.env[k] !== undefined) continue; let v = t.slice(eq + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); process.env[k] = v; } }
const root = path.resolve(toolRoot, "..", ".."); loadEnv(path.join(root, ".env.local")); loadEnv(path.join(root, ".env"));
const sb = createClient(process.env.SUPABASE_URL!.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), { auth: { persistSession: false } });
const S = (mm: string): number => { const [a, b] = mm.split(":"); return Number(a) * 60 + Number(b); };
const fp = (s: number | null): string => (s && s > 0 && Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : "—");
const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const daysAgo = (n: number): string => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const todayIso = (): string => new Date().toISOString().slice(0, 10);
async function bearer(): Promise<string> { const s = await readSessionSnapshot(); const r = await fetch(`${TP_API_HOST}/users/v3/token`, { headers: { accept: "application/json", Cookie: `Production_tpAuth=${s.cookieValue}` } }); return ((await r.json()) as { token: { access_token: string } }).token.access_token; }
async function getWk(aid: number, wid: number, b: string): Promise<Record<string, unknown>> { const r = await fetch(`${TP_API_HOST}/fitness/v6/athletes/${aid}/workouts/${wid}`, { headers: { accept: "application/json", authorization: `Bearer ${b}` } }); const o = await r.json(); return isRecord(o) ? o : {}; }
async function anchorFor(id: number): Promise<number | null> { const dm: string[] = []; for (let f = 0; ; f += 1000) { const { data } = await sb.from("trainingpeaks_workout_derived_metrics").select("workout_cache_id").eq("trainingpeaks_athlete_id", id).eq("workout_type", "run").eq("has_fit", true).eq("reps_detected_count", 0).gte("workout_date", daysAgo(90)).lte("workout_date", todayIso()).range(f, f + 999); if (!data || !data.length) break; for (const r of data) dm.push(r.workout_cache_id as string); if (data.length < 1000) break; } const ps: number[] = []; for (let i = 0; i < dm.length; i += 300) { const { data } = await sb.from("trainingpeaks_workout_cache").select("completed_distance_raw, completed_time_raw").in("id", dm.slice(i, i + 300)); for (const w of data ?? []) { const mm = typeof w.completed_distance_raw === "number" ? w.completed_distance_raw : 0; const h = typeof w.completed_time_raw === "number" ? w.completed_time_raw : 0; if (mm < 3000 || h <= 0) continue; const pc = (h * 3600) / (mm / 1000); if (pc > 240 && pc < 540) ps.push(pc); } } const srt = [...ps].sort((a, b) => a - b); return srt.length >= 3 ? median(srt.slice(Math.floor(srt.length * 0.3))) : null; }
type Rng = { fast: number; slow: number; idx: number };
function ranges(desc: string): Rng[] { const out: Rng[] = []; const re = /(\d{1,2}:\d{2})\s*(?:[-–—−]|@|до)\s*(\d{1,2}:\d{2})/gi; let m: RegExpExecArray | null; while ((m = re.exec(desc)) !== null) { const fast = Math.min(S(m[1]), S(m[2])), slow = Math.max(S(m[1]), S(m[2])); if (fast < 150 || slow > 600) continue; out.push({ fast, slow, idx: m.index }); } return out; }
type Role = "разминка" | "заминка" | "отдых" | "работа";
type Flat = { role: Role; min: number; max: number; block: number; step: number; durSec: number };
function flatSteps(structObj: unknown): Flat[] | null { if (!isRecord(structObj) || !Array.isArray(structObj.structure)) return null; const steps: Flat[] = []; structObj.structure.forEach((block, bi) => { if (!isRecord(block) || !Array.isArray(block.steps)) return; block.steps.forEach((st, si) => { if (!isRecord(st)) return; const tg = Array.isArray(st.targets) && st.targets.length && isRecord(st.targets[0]) ? st.targets[0] : null; const cls = String(st.intensityClass ?? ""); const nm = String(st.name ?? ""); const role: Role = /warm|размин/i.test(nm) || cls === "warmUp" ? "разминка" : /cool|замин/i.test(nm) || cls === "coolDown" ? "заминка" : cls === "rest" ? "отдых" : "работа"; const len = isRecord(st.length) ? st.length : null; const durSec = len && String(len.unit ?? "") === "second" && typeof len.value === "number" ? len.value : 0; steps.push({ role, min: tg && typeof tg.minValue === "number" ? tg.minValue : NaN, max: tg && typeof tg.maxValue === "number" ? tg.maxValue : NaN, block: bi, step: si, durSec }); }); }); return steps; }
type Seg = { durSec: number; range: Rng | null };
function parseSegments(desc: string): Seg[] { const durRe = /(\d+(?:[.,]\d+)?)\s*(секунд|сек|минут|мин)/gi; const durs: { pos: number; sec: number }[] = []; let m: RegExpExecArray | null; while ((m = durRe.exec(desc)) !== null) { const n = parseFloat(m[1].replace(",", ".")); if (!Number.isFinite(n) || n <= 0) continue; const sec = /сек/i.test(m[2]) ? n : n * 60; durs.push({ pos: m.index, sec }); } const rs = ranges(desc); const segs: Seg[] = []; for (let i = 0; i < durs.length; i++) { const start = durs[i].pos; const end = i + 1 < durs.length ? durs[i + 1].pos : desc.length; const r = rs.find((x) => x.idx >= start && x.idx < end); segs.push({ durSec: durs[i].sec, range: r ?? null }); } return segs; }
function matchByDuration(steps: Flat[], segs: Seg[]): (Rng | "anchor" | "keep")[] | null { const out: (Rng | "anchor" | "keep")[] = []; let ptr = 0; for (const st of steps) { if (st.durSec <= 0) return null; const tol = Math.max(10, st.durSec * 0.08); let found = -1; for (let j = ptr; j < segs.length; j++) { if (Math.abs(segs[j].durSec - st.durSec) <= tol) { found = j; break; } } if (found < 0) return null; const seg = segs[found]; ptr = found + 1; out.push(seg.range ? seg.range : st.role === "работа" ? "keep" : "anchor"); } return out; }
function positionalFallback(steps: Flat[], rs: Rng[]): (Rng | "anchor")[] | null { const nonRest = steps.filter((s) => s.role !== "отдых"); let mode: "positional" | "positionalAll" | "anchorAll"; if (rs.length === 0) { if (nonRest.length > 1) return null; mode = "anchorAll"; } else if (rs.length === steps.length) mode = "positionalAll"; else if (rs.length === nonRest.length) mode = "positional"; else return null; const out: (Rng | "anchor")[] = []; let pos = 0; for (const st of steps) { if (mode === "anchorAll") out.push("anchor"); else if (mode === "positionalAll") { out.push(rs[pos]); pos++; } else if (st.role === "отдых") out.push("anchor"); else { out.push(rs[pos]); pos++; } } return out; }
/** Assign the DESCRIPTION pace to each step: segment-by-duration first, positional fallback for
 *  no-duration descriptions. Returns per step a text range, 'anchor', 'keep' (RPE work — no text
 *  pace to compare), or 'defer' if the text can't be mapped. Mirrors tp-threshold-restore.recompute. */
function assignRefs(steps: Flat[], desc: string): (Rng | "anchor" | "keep")[] | "defer" {
  let a: (Rng | "anchor" | "keep")[] | null = matchByDuration(steps, parseSegments(desc));
  if (!a) a = positionalFallback(steps, ranges(desc));
  return a ?? "defer";
}

async function main(): Promise<void> {
  const b = await bearer(); const today = todayIso();
  const { data: rb } = await sb.from("tp_threshold_applications").select("trainingpeaks_athlete_id").eq("kind", "pace").eq("tier", "restore");
  const ids = [...new Set((rb ?? []).map((r) => Number(r.trainingpeaks_athlete_id)))];
  const bad: { date: string; line: string }[] = []; let ok = 0, wk = 0;
  for (const id of ids) {
    const s = await getAthleteSettings(id); const w0 = findWt0Set(s.speedZones); const thrMps = w0 && typeof w0.threshold === "number" ? w0.threshold : NaN; if (!thrMps) continue; const thrSec = 1000 / thrMps;
    const anchor = await anchorFor(id);
    const { data: nm } = await sb.from("trainingpeaks_workout_cache").select("student_name").eq("trainingpeaks_athlete_id", id).not("student_name", "is", null).limit(1); const name = (nm?.[0]?.student_name as string) ?? String(id);
    const { data: fut } = await sb.from("trainingpeaks_workout_cache").select("title,trainingpeaks_workout_id,is_planned,completed_time_raw,workout_type_value_id,description:source_snapshot->>description,workout_date").eq("trainingpeaks_athlete_id", id).gte("workout_date", today);
    const planned = (fut ?? []).filter((r) => r.is_planned === true && (r.completed_time_raw == null || r.completed_time_raw === 0) && r.workout_type_value_id === 3);
    for (const w of planned) {
      const live = await getWk(id, Number(w.trainingpeaks_workout_id), b); const st = live.structure; if (!isRecord(st) || !/pace/i.test(String(st.primaryIntensityMetric ?? ""))) continue;
      const steps = flatSteps(st); if (!steps) continue; wk++;
      const refs = assignRefs(steps, typeof w.description === "string" ? w.description : "");
      if (refs === "defer") { bad.push({ date: w.workout_date as string, line: `${w.workout_date} · ${name} «${w.title}» — ⚠ДЕФЕР (описание не привязать к шагам — НЕ ПРОВЕРИТЬ)` }); continue; }
      const diffs: string[] = [];
      steps.forEach((step, i) => {
        const mid = (step.min + step.max) / 2; const livePace = Number.isFinite(mid) ? thrSec * 100 / mid : null;
        const r = refs[i]; if (r === "keep") return; // RPE/by-feel work step — no text pace to compare
        const refPace = r === "anchor" ? anchor : (r.fast + r.slow) / 2;
        if (livePace == null || refPace == null) return; // anchor step with no FIT anchor → can't compare
        const d = Math.abs(livePace - refPace);
        if (d > 20) diffs.push(`[b${step.block}s${step.step}] ${step.role} факт @${fp(livePace)} (${step.min}-${step.max}%) ≠ ОПИСАНИЕ ${r === "anchor" ? `якорь ${fp(anchor)}` : `${fp((r as Rng).slow)}–${fp((r as Rng).fast)}`} — Δ${Math.round(d)}с`);
      });
      if (diffs.length) bad.push({ date: w.workout_date as string, line: `${w.workout_date} · ${name} «${w.title}» · порог ${fp(thrSec)}\n     ${diffs.join("\n     ")}` }); else ok++;
    }
  }
  bad.sort((a, b2) => a.date.localeCompare(b2.date));
  console.log(`проверено ${ids.length} атлетов, ${wk} темповых плановых (>= ${today}).`);
  console.log(`\n======== ПРОБЛЕМНЫЕ (факт ≠ правильный пересчёт, или дефер) — ${bad.length} ========`);
  if (!bad.length) console.log("  (нет — у всех факт совпадает с правильным пересчётом)");
  for (const x of bad) console.log(`  ${x.date === today ? "🔴СЕГОДНЯ " : ""}${x.line}`);
  console.log(`\nчисто: ${ok} тренировок`);
}
main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
