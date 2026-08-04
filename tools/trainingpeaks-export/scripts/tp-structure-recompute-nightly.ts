// Continuous structure-recompute — nightly job (Mode A: ATTENDED, READ-ONLY to TrainingPeaks).
//
// Detects planned workouts whose stored %-targets no longer match the athlete's current
// threshold/description, logs them to tp_structure_recompute_run/_log, and prints a morning summary
// with an apply command. It NEVER writes to TrainingPeaks — the coach reviews and applies via
// tp-threshold-restore.ts. Uses the SHARED lib/tp-recompute.ts (not a private copy) so the parser
// can never drift from the write tool.
//
// Flags:
//   --dry            compute + print summary, do NOT write the log tables (use before the migration
//                    is applied, or to preview).
//   --ids=1,2,3      scope to specific athletes (default: whole coached roster).
//   --full           ignore the incremental cursor, re-examine every workout.
//   --since=YYYY-MM-DD  lower date bound (default today-14).
//
// Incremental: skips a workout when its TP lastModifiedDate (UTC-6 → +6h → UTC) AND the athlete's
// threshold are both unchanged since the last time we logged it — the main lever to keep nightly
// runs cheap. A threshold change re-examines all the athlete's workouts (it doesn't touch lastMod).
// (Anchor drift from new easy runs is not tracked in v1 — it moves slowly; noted follow-up.)
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { getCoachedAthletesRoster, getWorkoutsByDateRange, getWorkoutDetail, getAthleteSettings } from "../../../src/features/trainingpeaks/tp-api-client.ts";
import { findWt0Set, isRecord } from "./lib/tp-athlete-helpers.ts";
import { toolRoot } from "./lib/paths.ts";
import { recompute, median, type Plan } from "./lib/tp-recompute.ts";

function loadEnv(p: string): void { if (!existsSync(p)) return; for (const line of readFileSync(p, "utf8").split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith("#")) continue; const eq = t.indexOf("="); if (eq < 0) continue; const k = t.slice(0, eq).trim(); if (!k || process.env[k] !== undefined) continue; let v = t.slice(eq + 1).trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); process.env[k] = v; } }
const root = path.resolve(toolRoot, "..", ".."); for (const p of [path.join(root, ".env.local"), path.join(root, ".env"), "/Users/igor/igor-tp-reports-bot/.env.local", "/Users/igor/igor-tp-reports-bot/.env"]) loadEnv(p);
const sb: SupabaseClient = createClient(process.env.SUPABASE_URL!.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), { auth: { persistSession: false } });

const DRY = process.argv.includes("--dry");
const FULL = process.argv.includes("--full");
const idsArg = process.argv.find((a) => a.startsWith("--ids="));
const sinceArg = process.argv.find((a) => a.startsWith("--since="));
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const todayIso = () => new Date().toISOString().slice(0, 10);
const fromDate = sinceArg ? sinceArg.slice("--since=".length) : daysAgo(14);
const toDate = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);

/** easy anchor: median of the slower-70% of reps=0 continuous runs (90d), excluding ~threshold-pace
 *  runs (pc > thrSec+30). n<5 → null. MUST match tp-threshold-restore.ts (follow-up: extract shared). */
async function easyAnchor(id: number, thrSec: number): Promise<number | null> {
  const dm: { workout_cache_id: string }[] = [];
  for (let f = 0; ; f += 1000) { const { data } = await sb.from("trainingpeaks_workout_derived_metrics").select("workout_cache_id").eq("trainingpeaks_athlete_id", id).eq("workout_type", "run").eq("has_fit", true).eq("reps_detected_count", 0).gte("workout_date", daysAgo(90)).lte("workout_date", todayIso()).range(f, f + 999); if (!data || !data.length) break; dm.push(...(data as { workout_cache_id: string }[])); if (data.length < 1000) break; }
  const cids = dm.map((r) => r.workout_cache_id); const ps: number[] = [];
  for (let i = 0; i < cids.length; i += 300) { const { data } = await sb.from("trainingpeaks_workout_cache").select("completed_distance_raw, completed_time_raw").in("id", cids.slice(i, i + 300)); for (const w of data ?? []) { const mm = typeof w.completed_distance_raw === "number" ? w.completed_distance_raw : 0; const h = typeof w.completed_time_raw === "number" ? w.completed_time_raw : 0; if (mm < 3000 || h <= 0) continue; const pc = (h * 3600) / (mm / 1000); if (pc > thrSec + 30 && pc < 540) ps.push(pc); } }
  const srt = [...ps].sort((a, b) => a - b);
  return srt.length >= 5 ? median(srt.slice(Math.floor(srt.length * 0.3))) : null;
}

/** sanity-retry live enumeration (same guard as tp-threshold-restore): enumerate 2× independently,
 *  compare workoutId sets, retry ≤3×, throw on instability. A silent under-fetch is never acceptable. */
async function enumeratePlanned(id: number): Promise<unknown[]> {
  const key = (l: unknown[]) => [...new Set((l ?? []).map((w) => Number((w as Record<string, unknown>).workoutId ?? (w as Record<string, unknown>).id)).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b).join(",");
  for (let attempt = 1; attempt <= 3; attempt++) {
    const a = (await getWorkoutsByDateRange(id, fromDate, toDate)) ?? [];
    const b = (await getWorkoutsByDateRange(id, fromDate, toDate)) ?? [];
    if (key(a) === key(b)) return a;
  }
  throw new Error(`перечисление athlete ${id} не стабилизировалось за 3 попытки`);
}

const renderPace = (thrSec: number, pct: number) => (pct > 0 ? (thrSec * 100) / pct : NaN);
function stepShift(thrSec: number, p: Plan): number {
  const oF = renderPace(thrSec, p.oldMax), nF = renderPace(thrSec, p.newMax);
  const oS = p.oldMin > 0 ? renderPace(thrSec, p.oldMin) : NaN, nS = p.newMin > 0 ? renderPace(thrSec, p.newMin) : NaN;
  return Math.max(Number.isFinite(oF) && Number.isFinite(nF) ? Math.abs(oF - nF) : 0, Number.isFinite(oS) && Number.isFinite(nS) ? Math.abs(oS - nS) : 0);
}

type LogRow = { run_id: string; trainingpeaks_athlete_id: number; athlete_name: string | null; trainingpeaks_workout_id: number; workout_date: string | null; title: string | null; tp_last_modified: string | null; threshold_sec: number; anchor_sec: number | null; decision: string; steps_total: number; steps_changed: number; max_shift_sec: number; anchor_steps: number; defer_reason: string | null; detail: unknown };

async function main(): Promise<void> {
  const now = new Date();
  // 1) run row
  let runId = "dry-run";
  if (!DRY) { const { data, error } = await sb.from("tp_structure_recompute_run").insert({ mode: "A" }).select("run_id").single(); if (error || !data) { console.error("✗ не создать run:", error?.message); process.exit(1); } runId = data.run_id as string; }

  // 2) scope
  let ids: number[];
  if (idsArg) ids = [...new Set(idsArg.slice("--ids=".length).split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0))];
  else { const r = await getCoachedAthletesRoster(); ids = [...new Set(r.filter((a) => Number.isInteger(a.athleteId) && a.athleteId > 0).map((a) => a.athleteId))]; }

  // 3) incremental cursor: latest logged {lastMod, threshold, decision} per workout, over this scope
  const cursor = new Map<number, { lastMod: string | null; thr: number | null; decision: string }>();
  if (!FULL) {
    for (let i = 0; i < ids.length; i += 50) { const { data } = await sb.from("tp_structure_recompute_log").select("trainingpeaks_workout_id, tp_last_modified, threshold_sec, decision, detected_at").in("trainingpeaks_athlete_id", ids.slice(i, i + 50)).order("detected_at", { ascending: false }).limit(4000); for (const r of data ?? []) { const wid = Number(r.trainingpeaks_workout_id); if (!cursor.has(wid)) cursor.set(wid, { lastMod: r.tp_last_modified as string | null, thr: r.threshold_sec as number | null, decision: r.decision as string }); } }
  }

  const logs: LogRow[] = [];
  let scanned = 0, clean = 0, drift = 0, defer = 0, verifyFail = 0, skipped = 0, athScanned = 0;
  let b2040 = 0, b4060 = 0, b60 = 0;
  const driftByAthlete = new Map<number, { name: string; items: { wk: string; date: string; changed: number; shift: number }[]; maxShift: number }>();
  const deferByAthlete = new Map<number, { name: string; reasons: string[] }>();

  for (const id of ids) {
    let thrSec: number | null = null;
    try { const s = await getAthleteSettings(id); const w0 = findWt0Set(s.speedZones); const mps = w0 && typeof w0.threshold === "number" ? w0.threshold : NaN; thrSec = mps ? 1000 / mps : null; } catch { /* skip */ }
    if (!thrSec) continue;
    athScanned++;
    const { data: nm } = await sb.from("trainingpeaks_workout_cache").select("student_name").eq("trainingpeaks_athlete_id", id).not("student_name", "is", null).limit(1);
    const name = (nm?.[0]?.student_name as string) ?? String(id);
    const anchor = await easyAnchor(id, thrSec);

    let list: unknown[]; try { list = await enumeratePlanned(id); } catch (e) { console.error(`⚠ ${name} (${id}): ${(e as Error).message} — пропущен`); continue; }
    const planned = list.filter((w) => isRecord(w) && (w.workoutTypeValueId === 3 || w.workoutTypeId === 3) && w.completed !== true);
    for (const sm of planned) {
      const wid = Number((sm as Record<string, unknown>).workoutId ?? (sm as Record<string, unknown>).id); if (!Number.isInteger(wid) || wid <= 0) continue;
      let det: Record<string, unknown>; try { det = await getWorkoutDetail(id, wid); } catch { continue; }
      if (det.completed === true) continue;
      const lmUtc = det.lastModifiedDate ? new Date(new Date(String(det.lastModifiedDate)).getTime() + 6 * 3600000).toISOString() : null; // TP UTC-6 → UTC
      const prev = cursor.get(wid);
      if (prev && prev.lastMod && prev.lastMod === lmUtc && prev.thr === Math.round(thrSec) && prev.decision === "clean") { skipped++; clean++; continue; } // incremental skip
      scanned++;
      const rc = recompute(det.structure, typeof det.description === "string" ? det.description : "", typeof det.title === "string" ? det.title : "", thrSec, anchor);
      if (!rc) continue; // not a pace workout
      const base = { run_id: runId, trainingpeaks_athlete_id: id, athlete_name: name, trainingpeaks_workout_id: wid, workout_date: String(det.workoutDay ?? "").slice(0, 10) || null, title: typeof det.title === "string" ? det.title : null, tp_last_modified: lmUtc, threshold_sec: Math.round(thrSec), anchor_sec: anchor ? Math.round(anchor) : null };
      if (rc.defer) { defer++; logs.push({ ...base, decision: "defer", steps_total: 0, steps_changed: 0, max_shift_sec: 0, anchor_steps: 0, defer_reason: rc.defer, detail: null }); const e = deferByAthlete.get(id) ?? { name, reasons: [] }; if (e.reasons.length < 3) e.reasons.push(`${base.workout_date} «${base.title}»: ${rc.defer}`); deferByAthlete.set(id, e); continue; }
      const changed = rc.plans.filter((p) => p.oldMin !== p.newMin || p.oldMax !== p.newMax);
      const bandFail = rc.plans.some((p) => !p.ok);
      const anchorSteps = rc.plans.filter((p) => /якорь|восстановление: открытый пол/.test(p.src)).length;
      let maxShift = 0; const detail = changed.map((p) => { const sh = Math.round(stepShift(thrSec!, p)); if (sh > maxShift) maxShift = sh; if (sh >= 60) b60++; else if (sh >= 40) b4060++; else if (sh >= 20) b2040++; return { block: p.block, step: p.step, role: p.role, oldMin: p.oldMin, oldMax: p.oldMax, newMin: p.newMin, newMax: p.newMax, src: p.src, shiftSec: sh }; });
      const decision = bandFail ? "verify_fail" : changed.length ? "drift" : "clean";
      if (decision === "verify_fail") verifyFail++; else if (decision === "drift") drift++; else clean++;
      logs.push({ ...base, decision, steps_total: rc.plans.length, steps_changed: changed.length, max_shift_sec: maxShift, anchor_steps: anchorSteps, defer_reason: null, detail });
      if (decision === "drift") { const e = driftByAthlete.get(id) ?? { name, items: [], maxShift: 0 }; e.items.push({ wk: `${base.workout_date} «${base.title}»`, date: base.workout_date ?? "", changed: changed.length, shift: maxShift }); e.maxShift = Math.max(e.maxShift, maxShift); driftByAthlete.set(id, e); }
    }
  }

  // anomaly-stop: drift proportion > 50% of examined
  const anomaly = scanned > 0 && drift / scanned > 0.5;

  // 4) persist
  if (!DRY) {
    for (let i = 0; i < logs.length; i += 200) { const { error } = await sb.from("tp_structure_recompute_log").insert(logs.slice(i, i + 200)); if (error) console.error("⚠ insert log:", error.message); }
    await sb.from("tp_structure_recompute_run").update({ finished_at: now.toISOString(), athletes_scanned: athScanned, workouts_scanned: scanned, drift_count: drift, clean_count: clean, defer_count: defer, verify_fail_count: verifyFail, shift_20_40_count: b2040, shift_40_60_count: b4060, shift_over_60_count: b60, anomaly_stopped: anomaly, anomaly_reason: anomaly ? `доля drift ${Math.round((drift / scanned) * 100)}% > 50%` : null }).eq("run_id", runId);
  }

  // 5) morning summary (Mode A)
  console.log(`\n═══ Непрерывный пересчёт — прогон ${now.toISOString().slice(0, 16)} ${DRY ? "(DRY, лог не писан)" : `run ${runId.slice(0, 8)}`} ═══`);
  console.log(`атлетов ${athScanned} · осмотрено тренировок ${scanned} (пропущено без изменений ${skipped}) · drift ${drift} · clean ${clean} · defer ${defer} · verify_fail ${verifyFail}`);
  console.log(`сдвиги: 20-40с ×${b2040} · 40-60с ×${b4060} · >60с ×${b60}`);
  if (anomaly) { console.log(`\n⚠ АНОМАЛИЯ: доля drift ${Math.round((drift / scanned) * 100)}% > 50% — ОСТАНОВЛЕНО, проверь глазами (не применяю списком).`); return; }
  if (deferByAthlete.size) { console.log(`\n▸ РУЧНОЕ (defer — не привязать, ${deferByAthlete.size} атл.):`); for (const [id, e] of deferByAthlete) console.log(`   ${e.name} (${id}): ${e.reasons[0]}`); }
  if (!driftByAthlete.size) { console.log(`\n✅ дрейфа нет — применять нечего.`); return; }
  // ДЕТЕКТ ШИРОКИЙ, ПРИМЕНЕНИЕ УЗКОЕ. Применяем на today-2 и позже: тренировку, не пробежанную
  // вчера, сегодня ещё могут открыть. От позавчера и раньше — день прошёл, переписывать бессмысленно
  // (её не побегут, история верна под тем порогом, что стоял тогда). Команда идёт с --since=<today-2>.
  const applyFrom = daysAgo(2);
  const apply = [...driftByAthlete.entries()].filter(([, e]) => e.items.some((x) => x.date >= applyFrom)).sort((a, b) => b[1].maxShift - a[1].maxShift);
  const pastOnly = [...driftByAthlete.entries()].filter(([, e]) => !e.items.some((x) => x.date >= applyFrom));
  if (apply.length) {
    console.log(`\n═══ ПРИМЕНЯЕМ — дрейф на ${applyFrom} и позже ═══`);
    for (const [id, e] of apply) { const fut = e.items.filter((x) => x.date >= applyFrom); console.log(`   ${e.name} (${id}) — ${fut.length} трен., макс сдвиг ${e.maxShift}с${fut.length <= 3 ? " · " + fut.map((x) => x.wk).join(" · ") : ""}`); }
    console.log(`   КОМАНДА (по одному, гейты; --since=${applyFrom} рвёт только ${applyFrom}+):`);
    console.log(`     for aid in ${apply.map(([id]) => id).join(" ")}; do TP_ATHLETE_REAL_WRITE=1 npx tsx tools/trainingpeaks-export/scripts/tp-threshold-restore.ts --athlete=$aid --since=${applyFrom} --apply --confirm "RESTORE $aid"; done`);
    const big = apply.flatMap(([, e]) => e.items.filter((x) => x.date >= applyFrom && x.shift > 40).map((x) => `${e.name}: ${x.wk} Δ${x.shift}с`));
    if (big.length) { console.log(`   сдвиги >40с (это ошибка, не округление):`); for (const s of big) console.log(`     ${s}`); }
  } else console.log(`\n═══ ПРИМЕНЯЕМ ═══\n   (на ${applyFrom}+ дрейфа нет — применять нечего)`);
  if (pastOnly.length) console.log(`\n═══ ТОЛЬКО ИНФОРМАЦИЯ — день прошёл, НЕ применяем ═══\n   ${pastOnly.map(([, e]) => `${e.name} (${e.items.length} трен.)`).join(" · ")}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
