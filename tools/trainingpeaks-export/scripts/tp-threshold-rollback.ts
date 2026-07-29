/**
 * tp-threshold-rollback — safely revert this session's 26 PACE-threshold applies back to
 * each athlete's PRE-apply value, keeping the real (applied) values for a later restore.
 *
 * WHY: the applied (correct, faster) thresholds re-scaled the %-of-threshold targets in
 * already-planned workouts, so athletes' watches show paces that no longer match the
 * written descriptions. Rolling the threshold back makes the planned steps resolve to the
 * old paces again (matching the descriptions) until the workout structures are fixed.
 *
 * SAFE BY CONSTRUCTION — mirrors tp-athlete set-threshold:
 *  - DRY-RUN by default: reads live settings, prints per-athlete real→old diff, writes NOTHING.
 *  - APPLY needs ALL of: --apply + env TP_ATHLETE_REAL_WRITE=1 + --confirm "ROLLBACK THRESHOLDS".
 *  - Reuses planType(): covered-scheme check, whole-array RMW (wt=1/wt=3 preserved), currentUserId.
 *  - One PUT per athlete, NO retry; verify by GET (threshold match + set-count unchanged); stop on any failure.
 *  - Logs each rollback to tp_threshold_applications (append-only) — the ORIGINAL rows keep the
 *    real value_after, so restore later = re-apply that value. Never mutates history.
 *  - Target = the EARLIEST value_before per athlete (the true pre-session threshold). Flags any
 *    athlete whose live threshold no longer equals the applied value (hand-edited since).
 *
 * Restore later: TP_ATHLETE_REAL_WRITE=1 tp-athlete set-threshold <id> --pace <real> --apply ...
 * (real value is value_after in the athlete's original tp_threshold_applications row).
 *
 * Usage:
 *   npx tsx tools/trainingpeaks-export/scripts/tp-threshold-rollback.ts            # dry-run, all 26
 *   ... --athlete=<id>                                                             # limit to one
 *   TP_ATHLETE_REAL_WRITE=1 ... --apply --confirm "ROLLBACK THRESHOLDS"            # real writes
 */
import process from "node:process";

import { getAthleteSettings } from "../../../src/features/trainingpeaks/tp-api-client.ts";
import {
  authedWriteOnce,
  COACH_ID_SETUP_HINT,
  findWt0Set,
  formatMpsAsPace,
  getSupabase,
  loadCoachUserId,
  loadLocalEnv,
} from "./lib/tp-athlete-helpers.ts";
import { planType } from "./lib/tp-athlete-set-threshold.ts";

const CONFIRM_PHRASE = "ROLLBACK THRESHOLDS";

function getFlag(name: string): string | undefined {
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < process.argv.length && !process.argv[idx + 1].startsWith("--")) return process.argv[idx + 1];
  return undefined;
}
const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

type Target = { athleteId: number; name: string; targetMps: number; realMps: number | null };

async function main(): Promise<void> {
  loadLocalEnv();
  const supabase = getSupabase();
  const apply = hasFlag("apply");
  const onlyId = getFlag("athlete") ? Number(getFlag("athlete")) : null;

  // Load pace applications, oldest first, per athlete: earliest value_before = pre-session
  // threshold (rollback target); latest value_after = the real applied value (kept for restore).
  const { data, error } = await supabase
    .from("tp_threshold_applications")
    .select("trainingpeaks_athlete_id, value_before, value_after, applied_at, applied_by, kind")
    .eq("kind", "pace")
    .order("applied_at", { ascending: true });
  if (error) throw new Error(`read tp_threshold_applications: ${error.message}`);

  const firstBefore = new Map<number, number>();
  const lastAfter = new Map<number, number>();
  for (const r of data ?? []) {
    const id = Number(r.trainingpeaks_athlete_id);
    if (!Number.isInteger(id)) continue;
    // ignore prior rollback rows so re-running does not target a rollback's own value
    if (typeof r.applied_by === "string" && r.applied_by.includes("rollback")) continue;
    if (!firstBefore.has(id) && typeof r.value_before === "number") firstBefore.set(id, r.value_before);
    if (typeof r.value_after === "number") lastAfter.set(id, r.value_after);
  }

  // names
  const ids = [...firstBefore.keys()];
  const name = new Map<number, string>();
  {
    const { data: nm } = await supabase.from("trainingpeaks_workout_cache").select("trainingpeaks_athlete_id, student_name").in("trainingpeaks_athlete_id", ids).not("student_name", "is", null);
    for (const r of nm ?? []) { const id = Number(r.trainingpeaks_athlete_id); if (!name.has(id) && typeof r.student_name === "string") name.set(id, r.student_name); }
  }

  let targets: Target[] = ids.map((id) => ({ athleteId: id, name: name.get(id) ?? `id ${id}`, targetMps: firstBefore.get(id)!, realMps: lastAfter.get(id) ?? null }));
  if (onlyId) targets = targets.filter((t) => t.athleteId === onlyId);
  targets.sort((a, b) => a.name.localeCompare(b.name));

  const coachUserId = loadCoachUserId();
  console.log(`\n=== tp-threshold-rollback — ${targets.length} атлет(ов), режим: ${apply ? "APPLY" : "DRY-RUN"} ===`);
  console.log(`currentUserId для PUT: ${coachUserId ?? "<НЕ ЗАДАН>"}\n`);

  const skipped: string[] = [];
  const applied: { name: string; from: string; to: string }[] = [];
  let planned = 0;

  for (const t of targets) {
    const oldPace = formatMpsAsPace(t.targetMps);
    let settings;
    try {
      settings = await getAthleteSettings(t.athleteId);
    } catch (e) {
      skipped.push(`${t.name}: чтение настроек не удалось (${e instanceof Error ? e.message : String(e)})`);
      continue;
    }
    const liveWt0 = findWt0Set(settings.speedZones);
    const liveMps = liveWt0 && typeof liveWt0.threshold === "number" ? liveWt0.threshold : null;
    const livePace = liveMps !== null ? formatMpsAsPace(liveMps) : "—";
    // hand-edit guard: live should equal the applied real value; if not, someone changed it in TP.
    const drift = t.realMps !== null && liveMps !== null && Math.abs(liveMps - t.realMps) > 1e-4;

    let plan;
    try {
      plan = planType("speed", settings.speedZones, t.targetMps, coachUserId);
    } catch (e) {
      skipped.push(`${t.name}: план не построен (${e instanceof Error ? e.message : String(e)})`);
      continue;
    }
    planned += 1;
    const flag = liveMps !== null && Math.abs(liveMps - t.targetMps) < 1e-6 ? "  (уже на старом — no-op)" : drift ? "  ⚑ живой порог ≠ применённого (ручная правка в TP — проверь!)" : "";
    console.log(`${t.name} (id ${t.athleteId}): ${livePace} → ${oldPace}${flag}`);

    if (!apply) continue;

    // ── real write (gate already validated below before the loop for apply mode) ──
    const putPath = `/fitness/v2/athletes/${t.athleteId}/speedzones`;
    const beforeCount = Array.isArray(settings.speedZones) ? (settings.speedZones as unknown[]).length : 0;
    const res = await authedWriteOnce("PUT", putPath, plan.newFullArray);
    if (res.status !== 204) {
      console.error(`  ❌ ${t.name}: PUT вернул ${res.status} (не 204) — СТОП, дальше не пишу.`);
      process.exitCode = 2;
      return;
    }
    const after = await getAthleteSettings(t.athleteId);
    const afterWt0 = findWt0Set(after.speedZones);
    const afterMps = afterWt0 && typeof afterWt0.threshold === "number" ? afterWt0.threshold : null;
    const afterCount = Array.isArray(after.speedZones) ? (after.speedZones as unknown[]).length : 0;
    const ok = afterMps !== null && Math.abs(afterMps - t.targetMps) < 1e-6 && afterCount === beforeCount;
    if (!ok) {
      console.error(`  ❌ ${t.name}: верификация не прошла (порог ${afterMps}, ждали ${t.targetMps}; наборов ${beforeCount}→${afterCount}) — СТОП.`);
      process.exitCode = 2;
      return;
    }
    console.log(`  ✅ ${t.name}: откат применён и верифицирован (${livePace} → ${oldPace}).`);
    const { error: logErr } = await supabase.from("tp_threshold_applications").insert({
      trainingpeaks_athlete_id: t.athleteId,
      kind: "pace",
      value_before: liveMps,
      value_after: t.targetMps,
      value_after_display: oldPace,
      evidence: "rollback to pre-session threshold (planned-workout pace fix); real value kept in original row",
      tier: "rollback",
      applied_by: "tp-threshold-rollback",
    });
    if (logErr) console.warn(`  ⚠ лог отката не записан: ${logErr.message}`);
    applied.push({ name: t.name, from: livePace, to: oldPace });
  }

  if (skipped.length) { console.log(`\nПропущено (${skipped.length}):`); for (const s of skipped) console.log(`  - ${s}`); }

  if (!apply) {
    console.log(`\nDRY-RUN. Ничего не записано. Кандидатов к откату: ${planned}.`);
    console.log(`Применить (после подтверждения):\n  TP_ATHLETE_REAL_WRITE=1 npx tsx tools/trainingpeaks-export/scripts/tp-threshold-rollback.ts --apply --confirm "${CONFIRM_PHRASE}"`);
    console.log(`Реальные (применённые) значения сохранены в tp_threshold_applications.value_after исходных строк — restore = переприменить их.`);
    return;
  }
  console.log(`\nГотово. Откатов применено: ${applied.length}. Реальные значения сохранены (value_after исходных строк) для restore.`);
}

// Apply-mode gate: refuse before doing anything if env/confirm are missing.
function checkGate(): boolean {
  if (!process.argv.includes("--apply")) return true; // dry-run always allowed
  const confirm = (() => { const eq = process.argv.find((a) => a.startsWith("--confirm=")); if (eq) return eq.slice("--confirm=".length); const i = process.argv.indexOf("--confirm"); return i >= 0 ? process.argv[i + 1] : undefined; })();
  if (process.env.TP_ATHLETE_REAL_WRITE !== "1" || confirm !== CONFIRM_PHRASE) {
    console.error(`REFUSED apply: need env TP_ATHLETE_REAL_WRITE=1 AND --confirm "${CONFIRM_PHRASE}". Not writing.`);
    return false;
  }
  if (loadCoachUserId() === null) { console.error(`REFUSED apply: ${COACH_ID_SETUP_HINT}`); return false; }
  return true;
}

loadLocalEnv(); // ensure env (coach id, supabase) is present for the gate + run
if (!checkGate()) process.exit(3);
main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
