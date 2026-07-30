/**
 * `tp-athlete set-threshold <name|id> [--pace 4:45] [--hr 168]`
 *
 * SAFETY MODEL (this is a zone WRITE path — treat with care):
 *  - DRY-RUN BY DEFAULT. With no `--apply`, it reads, computes the new zones, prints
 *    a full before→after diff, and STOPS. Nothing is written.
 *  - APPLY requires ALL of: `--apply` + env `TP_ATHLETE_REAL_WRITE=1` + the exact
 *    `--confirm "APPLY THRESHOLD <athleteId>"` phrase. Missing any → refuse (never
 *    silently write).
 *  - Snapshot precondition (Zone-write policy): a tp_zone_snapshots row must exist
 *    for the athlete; if missing at apply time we capture one first (read-only).
 *  - calculationMethod must be covered by a verified formula (tp-zone-formulas.ts),
 *    else refuse — never substitute another method's ratios.
 *  - Read-modify-write the WHOLE zones array (a partial PUT deletes the other sets —
 *    proven by experiment). BOTH wt=0 (default) AND wt=3 (RUN) are set to the new threshold —
 *    TP renders RUN workout cards against wt=3, so leaving it stale shows wrong paces (proven,
 *    the run-zone bug). wt=1 passes through. An uncovered wt=3 method REFUSES (never guess).
 *  - One PUT per zone type, NO retry. Verify by GET afterwards.
 */

import { getAthleteSettings } from "../../../../src/features/trainingpeaks/tp-api-client.ts";
import { pickWhitelistedSettings } from "./tp-settings-whitelist.ts";
import {
  authedWriteOnce,
  COACH_ID_SETUP_HINT,
  findWt0Set,
  formatMpsAsPace,
  getSupabase,
  isRecord,
  loadCoachUserId,
  parsePaceToSecPerKm,
  secPerKmToMps,
  settingsKeyFor,
  type RosterMatch,
} from "./tp-athlete-helpers.ts";
import {
  describeUncovered,
  getCoveredScheme,
  recomputeZones,
  ZoneShapeMismatchError,
  type ZoneBoundary,
  type ZoneType,
} from "./tp-zone-formulas.ts";

export type SetThresholdArgs = {
  paceInput?: string; // "4:45"
  hrInput?: string; // "168"
  apply: boolean;
  confirm?: string;
  evidence?: string; // logged to tp_threshold_applications.evidence
  tier?: string; // logged to tp_threshold_applications.tier
};

export type PlannedChange = {
  type: ZoneType;
  putPath: string;
  newThresholdNative: number;
  oldSet: Record<string, unknown>;
  newFullArray: unknown[];
  oldZones: ZoneBoundary[];
  newZones: ZoneBoundary[];
  oldThresholdNative: number | null;
  runSetAligned: number | null; // wt=3 (RUN) old threshold that is ALSO being set to newThreshold, or null if no wt=3 set
};

function asZoneArray(v: unknown): ZoneBoundary[] {
  if (!Array.isArray(v)) return [];
  return v.map((z) => {
    const r = isRecord(z) ? z : {};
    return {
      label: typeof r.label === "string" ? r.label : undefined,
      minimum: typeof r.minimum === "number" ? r.minimum : 0,
      maximum: typeof r.maximum === "number" ? r.maximum : 0,
    };
  });
}

/** Rebuild one zone set (any workoutTypeId) for a new threshold, recomputing its zones by its OWN
 *  covered scheme. Throws (fail-closed) if the set's method is uncovered — never guess ratios. */
function recomputeSet(type: ZoneType, set: Record<string, unknown>, newThreshold: number, coachUserId: number | null): Record<string, unknown> {
  const method = typeof set.calculationMethod === "number" ? set.calculationMethod : NaN;
  const scheme = getCoveredScheme(type, method);
  if (!scheme) throw new Error(`${type} wt=${String(set.workoutTypeId)}: ${describeUncovered(type, method)}`);
  let rec;
  try { rec = recomputeZones(scheme, asZoneArray(set.zones), newThreshold); }
  catch (e) { if (e instanceof ZoneShapeMismatchError) throw new Error(`${type} wt=${String(set.workoutTypeId)}: ${e.message}`); throw e; }
  return { ...set, threshold: newThreshold, zones: rec.zones, ...(coachUserId !== null ? { currentUserId: coachUserId } : {}) };
}

/** Build the RMW payload for one zone type, or throw a refusal Error with a clear message.
 *  Exported so the batch rollback tool reuses the EXACT same RMW/covered-scheme logic. */
export function planType(
  type: ZoneType,
  fullArray: unknown,
  newThresholdNative: number,
  coachUserId: number | null,
): PlannedChange {
  if (!Array.isArray(fullArray)) {
    throw new Error(`${type}: settings has no ${settingsKeyFor(type)} array — cannot set a threshold that doesn't exist.`);
  }
  const wt0 = findWt0Set(fullArray);
  if (!wt0) throw new Error(`${type}: no workoutTypeId=0 set found — refuse (nothing to recompute).`);

  const method = typeof wt0.calculationMethod === "number" ? wt0.calculationMethod : NaN;
  const scheme = getCoveredScheme(type, method);
  if (!scheme) throw new Error(describeUncovered(type, method));

  const oldZones = asZoneArray(wt0.zones);
  let recomputed;
  try {
    recomputed = recomputeZones(scheme, oldZones, newThresholdNative);
  } catch (e) {
    if (e instanceof ZoneShapeMismatchError) throw new Error(`${type}: ${e.message}`);
    throw e;
  }

  // Read-modify-write the WHOLE array. Set BOTH the wt=0 (default) AND wt=3 (RUN) sets to the new
  // threshold: TP renders RUN workout cards against wt=3, so setting only wt=0 leaves run cards on
  // a STALE threshold (proven — the run-zone bug). wt=1 passes through. An uncovered wt=3 method
  // REFUSES (recomputeSet throws) rather than guess zones or silently skip. currentUserId (a client
  // write-field a GET omits) is added to every set.
  const newWt0: Record<string, unknown> = {
    ...wt0,
    threshold: newThresholdNative,
    zones: recomputed.zones,
    ...(coachUserId !== null ? { currentUserId: coachUserId } : {}),
  };
  const runSet = fullArray.find((s) => isRecord(s) && s.workoutTypeId === 3);
  const runSetAligned = isRecord(runSet) && typeof runSet.threshold === "number" ? runSet.threshold : null;
  const newFullArray = fullArray.map((s) => {
    if (isRecord(s) && s.workoutTypeId === 0) return newWt0;
    if (isRecord(s) && s.workoutTypeId === 3) return recomputeSet(type, s, newThresholdNative, coachUserId);
    return isRecord(s) && coachUserId !== null ? { ...s, currentUserId: coachUserId } : s;
  });

  return {
    type,
    putPath: `/fitness/v2/athletes/{id}/${type === "speed" ? "speedzones" : "heartratezones"}`,
    newThresholdNative,
    oldSet: wt0,
    newFullArray,
    oldZones,
    newZones: recomputed.zones,
    oldThresholdNative: typeof wt0.threshold === "number" ? wt0.threshold : null,
    runSetAligned,
  };
}

function renderDiff(change: PlannedChange): void {
  const isSpeed = change.type === "speed";
  const fmt = (native: number | null): string =>
    native === null ? "—" : isSpeed ? `${formatMpsAsPace(native)} (${native.toFixed(4)} m/s)` : `${Math.round(native)} bpm`;
  console.log(`\n── ${change.type === "speed" ? "ПОРОГОВЫЙ ТЕМП (speedzones)" : "ПОРОГОВЫЙ ПУЛЬС (heartratezones)"} ──`);
  console.log(`threshold:  ${fmt(change.oldThresholdNative)}  →  ${fmt(change.newThresholdNative)}`);
  if (change.runSetAligned !== null) console.log(`беговой набор wt=3:  ${fmt(change.runSetAligned)}  →  ${fmt(change.newThresholdNative)}  (тоже выравнивается — TP рендерит беговые карточки от него)`);
  console.log(`zones (workoutTypeId=0), min–max:`);
  const n = Math.max(change.oldZones.length, change.newZones.length);
  for (let i = 0; i < n; i += 1) {
    const o = change.oldZones[i];
    const w = change.newZones[i];
    const label = w?.label ?? o?.label ?? `Zone ${i + 1}`;
    const oldStr = o ? `${round4(o.minimum)}–${round4(o.maximum)}` : "—";
    const newStr = w ? `${round4(w.minimum)}–${round4(w.maximum)}` : "—";
    const changed = oldStr !== newStr ? "  *" : "";
    console.log(`  ${label.padEnd(16)} ${oldStr.padEnd(20)} → ${newStr}${changed}`);
  }
}
function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

async function ensureSnapshot(athleteId: number, settings: Record<string, unknown>): Promise<"existed" | "captured"> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("tp_zone_snapshots")
    .select("id")
    .eq("trainingpeaks_athlete_id", athleteId)
    .limit(1);
  if (error) throw new Error(`snapshot precondition check failed: ${error.message}`);
  if ((data ?? []).length > 0) return "existed";
  // capture read-only whitelisted snapshot before any write (policy precondition)
  const zones = pickWhitelistedSettings(settings);
  const { error: insErr } = await supabase.from("tp_zone_snapshots").insert({
    trainingpeaks_athlete_id: athleteId,
    captured_at: new Date().toISOString(),
    zones: Object.keys(zones).length > 0 ? zones : null,
    source: "settings_v1",
  });
  if (insErr) throw new Error(`snapshot capture failed: ${insErr.message}`);
  return "captured";
}

async function snapshotExists(athleteId: number): Promise<boolean> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("tp_zone_snapshots")
    .select("id")
    .eq("trainingpeaks_athlete_id", athleteId)
    .limit(1);
  if (error) throw new Error(`snapshot check failed: ${error.message}`);
  return (data ?? []).length > 0;
}

export async function runSetThreshold(match: RosterMatch, args: SetThresholdArgs): Promise<void> {
  const { athleteId, displayName } = match;
  if (!args.paceInput && !args.hrInput) {
    console.error("Nothing to set: pass --pace <mm:ss> and/or --hr <bpm>.");
    process.exitCode = 2;
    return;
  }

  const coachUserId = loadCoachUserId();
  const settings = await getAthleteSettings(athleteId); // live read (payload base for the preview)

  // Each requested type is planned INDEPENDENTLY: an uncovered method refuses only
  // that type, not the whole command (e.g. set pace even when HR method is uncovered).
  const plans: PlannedChange[] = [];
  const refusals: string[] = [];
  if (args.paceInput) {
    try {
      const secPerKm = parsePaceToSecPerKm(args.paceInput);
      plans.push(planType("speed", settings.speedZones, secPerKmToMps(secPerKm), coachUserId));
    } catch (e) {
      refusals.push(`--pace: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (args.hrInput) {
    try {
      const bpm = Number(args.hrInput);
      if (!Number.isInteger(bpm) || bpm < 80 || bpm > 220) throw new Error(`bad --hr "${args.hrInput}" — expected an integer 80–220 bpm`);
      plans.push(planType("heartRate", settings.heartRateZones, bpm, coachUserId));
    } catch (e) {
      refusals.push(`--hr: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(`\n=== set-threshold — ${displayName} (athlete_id ${athleteId}) ===`);
  for (const r of refusals) console.log(`\nОТКАЗ — ${r}`);
  if (plans.length === 0) {
    console.error(`\nНечего применять: ни один запрошенный порог не прошёл проверку. Ничего не записано.`);
    process.exitCode = 3;
    return;
  }
  for (const p of plans) renderDiff(p);

  const snapExists = await snapshotExists(athleteId);
  console.log(`\nSnapshot precondition (tp_zone_snapshots): ${snapExists ? "✅ есть" : "⚠️ нет — будет снят перед записью"}`);
  console.log(
    `currentUserId, который уйдёт в PUT: ${coachUserId ?? "<НЕ ЗАДАН>"}` +
      `  (ОТКРЫТЫЙ ВОПРОС: для зон УЧЕНИКА — id тренера или ученика? Первую правку проверить глазами в TP.)`,
  );
  for (const p of plans) console.log(`PUT ${p.putPath.replace("{id}", String(athleteId))}  (полная замена массива наборов, wt=1/wt=3 сохранены)`);

  // ── apply gate ──────────────────────────────────────────────────────────────
  if (!args.apply) {
    // reapply hint reflects only the types that actually passed (a refused type is
    // not suggested — it would just refuse again).
    const flags = plans
      .map((p) => (p.type === "speed" && args.paceInput ? ` --pace ${args.paceInput}` : p.type === "heartRate" && args.hrInput ? ` --hr ${args.hrInput}` : ""))
      .join("");
    console.log(
      `\nDRY-RUN. Ничего не записано. Чтобы применить после подтверждения Игоря:\n` +
        `  TP_ATHLETE_REAL_WRITE=1 tp-athlete set-threshold ${athleteId}${flags}` +
        ` --apply --confirm "APPLY THRESHOLD ${athleteId}"`,
    );
    return;
  }

  const expected = `APPLY THRESHOLD ${athleteId}`;
  if (process.env.TP_ATHLETE_REAL_WRITE !== "1" || args.confirm !== expected) {
    console.error(
      `\nREFUSED apply: need BOTH env TP_ATHLETE_REAL_WRITE=1 AND --confirm "${expected}". ` +
        `Got confirm="${args.confirm ?? ""}", env=${process.env.TP_ATHLETE_REAL_WRITE ?? "unset"}. Not writing.`,
    );
    process.exitCode = 3;
    return;
  }
  if (coachUserId === null) {
    console.error(`\nREFUSED apply: ${COACH_ID_SETUP_HINT}`);
    process.exitCode = 3;
    return;
  }

  // snapshot precondition (capture if missing)
  const snap = await ensureSnapshot(athleteId, settings);
  console.log(`\nSnapshot: ${snap === "existed" ? "уже был" : "снят сейчас"}.`);

  // payload_before: re-read immediately before writing, and rebuild plans on the
  // FRESH array (guards against drift since the preview read).
  const fresh = await getAthleteSettings(athleteId);
  const applyPlans: PlannedChange[] = [];
  for (const p of plans) {
    const freshArray = p.type === "speed" ? fresh.speedZones : fresh.heartRateZones;
    applyPlans.push(planType(p.type, freshArray, p.newThresholdNative, coachUserId));
  }

  const applied: { type: ZoneType; before: number | null; after: number }[] = [];
  for (const p of applyPlans) {
    const putPath = `/fitness/v2/athletes/${athleteId}/${p.type === "speed" ? "speedzones" : "heartratezones"}`;
    const beforeCount = Array.isArray(p.type === "speed" ? fresh.speedZones : fresh.heartRateZones)
      ? (p.type === "speed" ? (fresh.speedZones as unknown[]) : (fresh.heartRateZones as unknown[])).length
      : 0;
    console.log(`\nЗапись (ОДИН PUT, без ретрая): ${putPath}`);
    const res = await authedWriteOnce("PUT", putPath, p.newFullArray);
    console.log(`  status: ${res.status}${res.bodyText ? ` · body: ${res.bodyText.slice(0, 200)}` : ""}`);
    if (res.status !== 204) {
      console.error(`  НЕ 204 — СТОП. Не ретраю, остальные типы не пишу.`);
      process.exitCode = 2;
      return;
    }
    // verify
    const after = await getAthleteSettings(athleteId);
    const afterArray = p.type === "speed" ? after.speedZones : after.heartRateZones;
    const afterCount = Array.isArray(afterArray) ? afterArray.length : 0;
    const afterWt0 = findWt0Set(afterArray);
    const afterThreshold = afterWt0 && typeof afterWt0.threshold === "number" ? afterWt0.threshold : null;
    const thresholdOk =
      afterThreshold !== null &&
      (p.type === "heartRate" ? Math.round(afterThreshold) === Math.round(p.newThresholdNative) : Math.abs(afterThreshold - p.newThresholdNative) < 1e-6);
    const countOk = afterCount === beforeCount;
    console.log(
      `  ВЕРИФИКАЦИЯ: порог ${thresholdOk ? "✅ применён" : `❌ ожидали ${p.newThresholdNative}, в TP ${afterThreshold}`} · ` +
        `наборов было ${beforeCount}, стало ${afterCount} ${countOk ? "✅" : "❌ ИЗМЕНИЛОСЬ"}`,
    );
    if (!thresholdOk || !countOk) {
      console.error(`  Верификация не прошла — остановка. Проверь атлета в TP вручную.`);
      process.exitCode = 2;
      return;
    }
    applied.push({ type: p.type, before: p.oldThresholdNative, after: p.newThresholdNative });
  }

  // ── audit log + snapshot refresh (append-only) ────────────────────────────
  // Each successful application is logged to tp_threshold_applications so the
  // candidate scan can drop this athlete; and a fresh snapshot is written so a
  // later manual TP change (different from value_after) brings them back.
  const supabase = getSupabase();
  try {
    const afterSettings = await getAthleteSettings(athleteId);
    const zonesW = pickWhitelistedSettings(afterSettings);
    await supabase.from("tp_zone_snapshots").insert({
      trainingpeaks_athlete_id: athleteId,
      captured_at: new Date().toISOString(),
      zones: Object.keys(zonesW).length > 0 ? zonesW : null,
      source: "post_apply",
    });
  } catch (e) {
    console.warn(`  (снапшот после записи не обновился: ${e instanceof Error ? e.message : String(e)})`);
  }
  for (const a of applied) {
    const display = a.type === "speed" ? formatMpsAsPace(a.after) : `${Math.round(a.after)} bpm`;
    const { error } = await supabase.from("tp_threshold_applications").insert({
      trainingpeaks_athlete_id: athleteId,
      kind: a.type === "speed" ? "pace" : "hr",
      value_before: a.before,
      value_after: a.after,
      value_after_display: display,
      evidence: args.evidence ?? null,
      tier: args.tier ?? null,
      applied_by: "tp-athlete-cli",
    });
    if (error) console.warn(`  ⚠ ЛОГ применения НЕ записан (${a.type}): ${error.message} — таблица tp_threshold_applications создана?`);
    else console.log(`  лог применения записан (${a.type} → ${display}).`);
  }
  console.log(`\nГотово. Проверь зоны глазами в TP (особенно currentUserId-вопрос на первой правке ученика).`);
}
