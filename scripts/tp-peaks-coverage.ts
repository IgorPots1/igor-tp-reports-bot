/**
 * A3 — TP mean-max peaks coverage + comparison vs the lap best-split heuristic.
 * READ-ONLY (GET only, never writes to TP; does NOT write club_tp_peaks — that table
 * is not applied yet, so this only reports). Writes docs/tp-peaks-coverage.md.
 *
 * For each visible student it fetches TrainingPeaks workout details for up to
 * MAX_PER_STUDENT of their LONGEST completed runs (longest → most likely to expose
 * 10k/21k/42k peaks), capped at MAX_TOTAL GETs overall, parses
 * meanMaxSpeedsByDistance, and keeps the best peak per target distance. Then it
 * compares, per (student, distance): lap-heuristic best time vs TP peak time.
 *
 * Because it samples only the longest N workouts per student (to bound TP calls),
 * "TP best" here is approximate; a full backfill (after the migration is applied)
 * scans every workout. Coverage numbers are honest for the sampled set.
 *
 * Run: node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *        --env-file=.env.local scripts/tp-peaks-coverage.ts
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createSupabaseServerClient } from "@/features/supabase/server";
import { getWorkoutDetailsRecord } from "@/features/trainingpeaks/tp-api-client";
import { evaluateAllRecordsForValidation } from "@/features/club/service";
import { CLUB_RECORD_DISTANCES } from "@/features/club/constants";
import { tpPeakPlausible, type RecordDistanceKey } from "@/features/club/records";

const MAX_PER_STUDENT = 3;
const MAX_TOTAL = 150;

const LABEL_BY_KEY: Record<RecordDistanceKey, string> = {
  "5k": "MM5Kilometer",
  "10k": "MM10Kilometer",
  "21k": "MMHalfMarathon",
  "42k": "MMMarathon",
};
const METERS_BY_KEY = new Map(CLUB_RECORD_DISTANCES.map((d) => [d.key, d.meters]));
const LABEL_RU = new Map(CLUB_RECORD_DISTANCES.map((d) => [d.key, d.label]));
const KEYS = CLUB_RECORD_DISTANCES.map((d) => d.key) as RecordDistanceKey[];

function fmt(sec: number): string {
  const t = Math.round(sec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
function signed(sec: number): string {
  const s = Math.round(sec);
  return s > 0 ? `+${fmt(Math.abs(s))}` : s < 0 ? `-${fmt(Math.abs(s))}` : "0";
}

type Workout = { studentId: string; athleteId: number; workoutId: number; km: number; date: string };

async function main() {
  const supabase = createSupabaseServerClient();
  const run = await evaluateAllRecordsForValidation();
  const visibleIds = new Set(run.students.map((s) => s.id));

  // Completed running workouts with TP ids, longest first per student.
  const { data, error } = await supabase
    .from("trainingpeaks_workout_cache")
    .select("student_id, trainingpeaks_athlete_id, trainingpeaks_workout_id, completed_distance_raw, workout_date, is_completed")
    .eq("is_completed", true)
    .gt("completed_distance_raw", 3)
    .order("completed_distance_raw", { ascending: false });
  if (error) throw error;

  const byStudent = new Map<string, Workout[]>();
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    const sid = r.student_id as string;
    if (!visibleIds.has(sid)) continue;
    const athleteId = Number(r.trainingpeaks_athlete_id);
    const workoutId = Number(r.trainingpeaks_workout_id);
    if (!athleteId || !workoutId) continue;
    const rawKm = Number(r.completed_distance_raw);
    const km = rawKm > 100 ? rawKm / 1000 : rawKm; // normalizeDistanceKm heuristic
    const list = byStudent.get(sid) ?? [];
    if (list.length < MAX_PER_STUDENT) list.push({ studentId: sid, athleteId, workoutId, km, date: (r.workout_date as string) ?? "" });
    byStudent.set(sid, list);
  }

  // Fetch peaks, bounded. Best speed (m/s) per (student, distance).
  const bestSpeed = new Map<string, { speed: number; date: string }>(); // key studentId|distanceKey
  let fetches = 0;
  let withAnyPeak = 0;
  const studentsFetched = new Set<string>();
  const studentsWithPeak = new Set<string>();

  outer: for (const [sid, workouts] of byStudent) {
    for (const w of workouts) {
      if (fetches >= MAX_TOTAL) break outer;
      fetches += 1;
      studentsFetched.add(sid);
      try {
        const rec = await getWorkoutDetailsRecord(w.athleteId, w.workoutId);
        const mmd = (rec as Record<string, unknown>).meanMaxSpeedsByDistance as
          | { meanMaxes?: Array<{ label: string; value: number | null }> }
          | undefined;
        const arr = mmd?.meanMaxes ?? [];
        let any = false;
        for (const key of KEYS) {
          const hit = arr.find((m) => m.label === LABEL_BY_KEY[key]);
          if (hit && typeof hit.value === "number" && hit.value > 0) {
            // Same plausibility gate the runtime reader applies: reject corrupt GPS
            // spikes (a "5k peak" at 30 m/s) so the stored best is a SANE best.
            const km = (METERS_BY_KEY.get(key) ?? 0) / 1000;
            const impliedTime = (METERS_BY_KEY.get(key) ?? 0) / hit.value;
            if (!tpPeakPlausible(key, km, impliedTime)) continue;
            any = true;
            const cur = bestSpeed.get(`${sid}|${key}`);
            if (!cur || hit.value > cur.speed) bestSpeed.set(`${sid}|${key}`, { speed: hit.value, date: w.date });
          }
        }
        if (any) {
          withAnyPeak += 1;
          studentsWithPeak.add(sid);
        }
      } catch (e) {
        console.warn(`GET failed ${sid.slice(0, 8)} w${w.workoutId}: ${String(e).slice(0, 100)}`);
      }
    }
  }

  // Lap-heuristic best training time per (student, distance).
  function lapTrainingTime(sid: string, key: RecordDistanceKey): number | null {
    const evs = run.byStudent.get(sid)?.get(key)?.evaluated ?? [];
    let best: number | null = null;
    for (const e of evs) {
      if (e.trust === "hidden") continue;
      const t = e.candidate.durationSeconds;
      if (best === null || t < best) best = t;
    }
    return best;
  }

  // Comparison rows.
  const rows: string[] = [];
  const perDistCoverage = new Map<RecordDistanceKey, number>();
  const deltas: number[] = [];
  for (const [sid] of byStudent) {
    for (const key of KEYS) {
      const peak = bestSpeed.get(`${sid}|${key}`);
      const meters = METERS_BY_KEY.get(key)!;
      const tpTime = peak ? meters / peak.speed : null;
      const lapTime = lapTrainingTime(sid, key);
      if (peak) perDistCoverage.set(key, (perDistCoverage.get(key) ?? 0) + 1);
      if (tpTime === null && lapTime === null) continue;
      let deltaCell = "—";
      if (tpTime !== null && lapTime !== null) {
        const d = tpTime - lapTime;
        deltas.push(d);
        deltaCell = signed(d);
      }
      rows.push(`| ${sid.slice(0, 8)} | ${LABEL_RU.get(key)} | ${lapTime !== null ? fmt(lapTime) : "—"} | ${tpTime !== null ? fmt(tpTime) : "—"} | ${deltaCell} |`);
    }
  }

  const avgDelta = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;

  const L: string[] = [];
  L.push("# TP mean-max пики: покрытие и сравнение с лап-эвристикой (A3)");
  L.push("");
  L.push("Сгенерировано `scripts/tp-peaks-coverage.ts` — read-only, GET only. Без ФИО.");
  L.push("");
  L.push("## Метод и границы");
  L.push("");
  L.push(`- Опрошено до **${MAX_PER_STUDENT}** самых длинных бегов на ученика, максимум **${MAX_TOTAL}** запросов всего. Сделано запросов: **${fetches}**.`);
  L.push(`- Метки TP: 5k=\`MM5Kilometer\`, 10k=\`MM10Kilometer\`, 21k=\`MMHalfMarathon\`, 42k=\`MMMarathon\`. Значение — скорость м/с, время = дистанция / скорость.`);
  L.push(`- «Лучшее TP» здесь ПРИБЛИЖЁННОЕ (только по выборке длинных тренировок). Полный бэкфилл (после применения миграции \`club_tp_peaks\`) сканирует все тренировки.`);
  L.push("");
  L.push("## Покрытие (премиальная функция — у части учеников пусто)");
  L.push("");
  L.push(`- Учеников опрошено: **${studentsFetched.size}**; вернули хотя бы один пик: **${studentsWithPeak.size}** (${studentsFetched.size ? Math.round((studentsWithPeak.size / studentsFetched.size) * 100) : 0}%).`);
  L.push(`- Тренировок с пиками: **${withAnyPeak}** из ${fetches} опрошенных.`);
  L.push("");
  L.push("| дистанция | учеников с TP-пиком (в выборке) |");
  L.push("|---|---|");
  for (const key of KEYS) L.push(`| ${LABEL_RU.get(key)} | ${perDistCoverage.get(key) ?? 0} |`);
  L.push("");
  L.push("## Сравнение: лап-эвристика vs TP-пик (время; отриц. дельта = TP быстрее/точнее)");
  L.push("");
  L.push(`Средняя дельта (TP − лап) по парам, где есть оба: **${signed(avgDelta)}** (пар: ${deltas.length}).`);
  L.push("");
  L.push("| student_id | дист | лап-время | TP-время | дельта |");
  L.push("|---|---|---|---|---|");
  L.push(...(rows.length ? rows : ["| _нет_ | | | | |"]));
  L.push("");
  L.push("## Вывод");
  L.push("");
  L.push("TP-пик — device-computed, без шума пауз/границ лапов, ровно по целевой дистанции. Это ТОЧНОСТЬ «лучшего отрезка», НЕ гонка. Фильтр осмысленности (A1) и плавила плотности/VDOT применяются и к TP-результатам. Переключение — только флагом `CLUB_RECORDS_TP_PEAKS` после бэкфилла; молча не включать.");
  L.push("");

  const out = resolve(process.cwd(), "docs/tp-peaks-coverage.md");
  writeFileSync(out, L.join("\n"), "utf8");
  console.log(`Wrote ${out}`);
  console.log(`fetches=${fetches} studentsFetched=${studentsFetched.size} studentsWithPeak=${studentsWithPeak.size} pairs=${deltas.length} avgDelta=${avgDelta.toFixed(1)}s`);
}

main().catch((e) => {
  console.error("tp-peaks-coverage failed:", e);
  process.exit(1);
});
