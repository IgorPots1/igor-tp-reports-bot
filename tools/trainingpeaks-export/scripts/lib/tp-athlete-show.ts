/**
 * `tp-athlete show <name|id>` — READ-ONLY. Prints the athlete's current thresholds
 * (pace in min/km, HR in bpm), the calculationMethod per zone type and whether a
 * verified formula covers it, races in the last 12 months, and the last few key
 * workouts. No writes of any kind.
 */

import { getAthleteSettings } from "../../../../src/features/trainingpeaks/tp-api-client.ts";
import {
  findWt0Set,
  formatMpsAsPace,
  getSupabase,
  isRecord,
  type RosterMatch,
} from "./tp-athlete-helpers.ts";
import { getCoveredScheme } from "./tp-zone-formulas.ts";

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function describeSet(type: "speed" | "heartRate", set: Record<string, unknown> | null): string[] {
  if (!set) return [`  (no workoutTypeId=0 ${type} set found)`];
  const threshold = typeof set.threshold === "number" ? set.threshold : null;
  const method = typeof set.calculationMethod === "number" ? set.calculationMethod : null;
  const zoneCount = Array.isArray(set.zones) ? set.zones.length : null;
  const covered = method !== null ? getCoveredScheme(type, method) : null;
  const lines: string[] = [];
  if (type === "speed") {
    lines.push(`  threshold pace:  ${formatMpsAsPace(threshold)}${threshold !== null ? `  (${threshold.toFixed(4)} m/s)` : ""}`);
  } else {
    lines.push(`  threshold HR:    ${threshold !== null ? `${Math.round(threshold)} bpm` : "—"}`);
  }
  lines.push(
    `  calcMethod:      ${method ?? "?"} · zones: ${zoneCount ?? "?"} · formula: ` +
      `${covered ? "✅ covered (writable)" : "❌ NOT covered (set-threshold will refuse)"}`,
  );
  return lines;
}

export async function runShow(match: RosterMatch): Promise<void> {
  const { athleteId, displayName } = match;
  console.log(`\n=== ${displayName}  (athlete_id ${athleteId}) ===\n`);

  // 1) live thresholds + zone methods
  const settings = await getAthleteSettings(athleteId);
  const speedWt0 = findWt0Set(settings.speedZones);
  const hrWt0 = findWt0Set(settings.heartRateZones);

  console.log("Пороговый темп (speed zones):");
  for (const l of describeSet("speed", speedWt0)) console.log(l);
  console.log("\nПороговый пульс (heart-rate zones):");
  for (const l of describeSet("heartRate", hrWt0)) console.log(l);

  // 2) Supabase-backed history (read-only)
  const supabase = getSupabase();
  const from12mo = isoDaysAgo(365);
  const today = todayIso();

  // races (completed, i.e. date <= today) in the last 12 months
  const { data: raceRows } = await supabase
    .from("trainingpeaks_race_events")
    .select("event_date, distance_km, distance_raw")
    .eq("trainingpeaks_athlete_id", athleteId)
    .gte("event_date", from12mo)
    .lte("event_date", today)
    .order("event_date", { ascending: false });

  const raceDates = (raceRows ?? []).map((r) => r.event_date as string);
  // matching run workouts on those dates → cache ids → laps for time/pace
  const dmByDate = new Map<string, { cacheId: string; avgHr: number | null }>();
  if (raceDates.length > 0) {
    const { data: dm } = await supabase
      .from("trainingpeaks_workout_derived_metrics")
      .select("workout_date, workout_cache_id, avg_hr, has_fit")
      .eq("trainingpeaks_athlete_id", athleteId)
      .eq("workout_type", "run")
      .in("workout_date", raceDates);
    for (const row of dm ?? []) {
      // keep the longest/first run per date; races are single events
      if (!dmByDate.has(row.workout_date as string)) {
        dmByDate.set(row.workout_date as string, { cacheId: row.workout_cache_id as string, avgHr: (row.avg_hr as number) ?? null });
      }
    }
  }
  const cacheIds = [...dmByDate.values()].map((v) => v.cacheId);
  const timePaceByCache = new Map<string, { totalTimeS: number; distanceM: number }>();
  if (cacheIds.length > 0) {
    const { data: laps } = await supabase
      .from("trainingpeaks_workout_laps")
      .select("workout_cache_id, distance_m, timer_time_s")
      .in("workout_cache_id", cacheIds);
    for (const lap of laps ?? []) {
      const key = lap.workout_cache_id as string;
      const acc = timePaceByCache.get(key) ?? { totalTimeS: 0, distanceM: 0 };
      acc.totalTimeS += (lap.timer_time_s as number) ?? 0;
      acc.distanceM += (lap.distance_m as number) ?? 0;
      timePaceByCache.set(key, acc);
    }
  }

  console.log("\nЗабеги за последние 12 мес:");
  if ((raceRows ?? []).length === 0) {
    console.log("  (нет)");
  } else {
    for (const r of raceRows ?? []) {
      const date = r.event_date as string;
      const dist = typeof r.distance_km === "number" ? `${r.distance_km} км` : (r.distance_raw as string) ?? "?";
      const dm = dmByDate.get(date);
      const tp = dm ? timePaceByCache.get(dm.cacheId) : undefined;
      let timeStr = "—";
      let paceStr = "—";
      if (tp && tp.distanceM > 0 && tp.totalTimeS > 0) {
        const mins = Math.floor(tp.totalTimeS / 60);
        const secs = Math.round(tp.totalTimeS % 60);
        timeStr = `${mins}:${secs.toString().padStart(2, "0")}`;
        const secPerKm = tp.totalTimeS / (tp.distanceM / 1000);
        paceStr = formatMpsAsPace(1000 / secPerKm);
      }
      console.log(`  ${date} · ${dist} · время ${timeStr} · темп ${paceStr}`);
    }
  }

  // 3) last 5 key workouts (races / intervals / long steady)
  const { data: recent } = await supabase
    .from("trainingpeaks_workout_derived_metrics")
    .select("workout_date, reps_detected_count, steady_duration_s, avg_hr, hr_trusted")
    .eq("trainingpeaks_athlete_id", athleteId)
    .eq("workout_type", "run")
    .gte("workout_date", from12mo)
    .order("workout_date", { ascending: false })
    .limit(60);

  const key = (recent ?? [])
    .filter((w) => (w.reps_detected_count as number) > 0 || (w.steady_duration_s as number) >= 1200 || raceDates.includes(w.workout_date as string))
    .slice(0, 5);

  console.log("\nПоследние ключевые тренировки:");
  if (key.length === 0) {
    console.log("  (нет интервальных/темповых/забегов в окне)");
  } else {
    for (const w of key) {
      const reps = w.reps_detected_count as number;
      const steady = w.steady_duration_s as number;
      const kind = raceDates.includes(w.workout_date as string)
        ? "забег"
        : reps > 0
          ? `интервалы ×${reps}`
          : steady >= 1200
            ? `непрерывный ${Math.round(steady / 60)} мин`
            : "бег";
      const hr = w.hr_trusted && typeof w.avg_hr === "number" ? `${Math.round(w.avg_hr)} bpm` : "—";
      console.log(`  ${w.workout_date} · ${kind} · ср.пульс ${hr}`);
    }
  }
  console.log("");
}

export { isRecord }; // (re-export convenience; some callers assert settings shape)
