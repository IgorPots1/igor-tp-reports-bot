/**
 * READ-ONLY. No writes. Answers "is this race record a real standalone result, or a
 * shorter SEGMENT extracted from a longer race that day?" and attaches the event to
 * the record by NEAREST distance (not just date), because a single day can hold
 * several race events of different distances (e.g. «Белые ночи» 5/10/21k).
 *
 * Modes:
 *   (default) AGGREGATE — across all race best-records: for each, find the day's
 *     events and the day's MAIN (largest) event distance. Flag records whose own
 *     distance is clearly shorter than the day's main event => a within-race segment.
 *     Headline: how many athletes have a 5k record sitting on a bigger-race day.
 *
 *   --student="<name substring>" --date=YYYY-MM-DD — DETAIL for one athlete+date:
 *     every race record that day, the SOURCE workout it came from (total distance +
 *     title + calc_method: best_split=segment, whole_workout=standalone-ish), and ALL
 *     race_events on that date. This is how you tell "10k standalone" from "10k split
 *     of a marathon" by fact.
 *
 * RUN (from repo root):
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=.env.local scripts/audit-club-race-record-provenance.ts \
 *     [--student="Назаров"] [--date=2026-07-04]
 */
import process from "node:process";

import { createSupabaseServerClient } from "@/features/supabase/server";

const PAGE = 1000;
type SupabaseClient = ReturnType<typeof createSupabaseServerClient>;

const KM_BY_KEY: Record<string, number> = { "5k": 5, "10k": 10, "21k": 21.097, "42k": 42.195 };

function arg(name: string): string | null {
  const a = process.argv.slice(2).find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(`--${name}=`.length).trim() : null;
}

async function fetchAll<T>(
  supabase: SupabaseClient,
  table: string,
  select: string,
  refine?: (q: ReturnType<ReturnType<SupabaseClient["from"]>["select"]>) => unknown,
  notes?: string[]
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    let q = supabase.from(table).select(select).range(from, from + PAGE - 1);
    if (refine) q = refine(q as never) as typeof q;
    const { data, error } = (await q) as { data: T[] | null; error: { message: string } | null };
    if (error) {
      notes?.push(`${table}: read stopped (${error.message})`);
      break;
    }
    const batch = data ?? [];
    out.push(...batch);
    if (batch.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${m}:${String(ss).padStart(2, "0")}`;
}
function fmtPace(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec) || sec <= 0) return "n/a";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}/км`;
}
/** completed_distance_raw / distance_raw are raw strings; >1000 => meters. */
function parseKm(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const n = Number(String(raw).replace(",", ".").match(/-?\d+(?:\.\d+)?/)?.[0] ?? "");
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1000 ? n / 1000 : n;
}

type Snap = {
  student_id: string;
  distance_key: string;
  record_date: string | null;
  duration_seconds: number;
  pace_sec_per_km: number | null;
  distance_km: number | null;
  calc_method: string;
  slot: string;
  source: string | null;
  source_workout_cache_id: string | null;
};
type Ev = { title: string | null; km: number | null; raw: string | null };

async function main(): Promise<void> {
  const supabase = createSupabaseServerClient();
  const wantStudent = arg("student");
  const wantDate = arg("date");
  const notes: string[] = [];

  const students = await fetchAll<{ id: string; student_name: string | null }>(
    supabase, "trainingpeaks_students", "id, student_name", undefined, notes
  );
  const nameById = new Map<string, string>();
  for (const s of students) nameById.set(s.id, s.student_name ?? s.id);

  const snaps = await fetchAll<Snap>(
    supabase, "club_record_snapshots",
    "student_id, distance_key, record_date, duration_seconds, pace_sec_per_km, distance_km, calc_method, slot, source, source_workout_cache_id",
    (q) => (q as { eq: (c: string, v: string) => unknown }).eq("record_type", "race"), notes
  );

  const events = await fetchAll<{ student_id: string; event_date: string | null; title: string | null; distance_km: number | null; distance_raw: string | null }>(
    supabase, "trainingpeaks_race_events", "student_id, event_date, title, distance_km, distance_raw", undefined, notes
  );
  const evByKey = new Map<string, Ev[]>();
  for (const e of events) {
    const d = (e.event_date ?? "").slice(0, 10);
    if (!e.student_id || !d) continue;
    const km = e.distance_km ?? parseKm(e.distance_raw);
    const arr = evByKey.get(`${e.student_id}|${d}`) ?? [];
    arr.push({ title: e.title, km, raw: e.distance_raw });
    evByKey.set(`${e.student_id}|${d}`, arr);
  }

  // Attach the day's event to a record by NEAREST distance to the record distance.
  const attach = (sid: string, date: string, recordKm: number | null) => {
    const arr = evByKey.get(`${sid}|${date}`) ?? [];
    const withKm = arr.filter((e) => e.km != null);
    const distinctKms = new Set(withKm.map((e) => e.km));
    const mainKm = withKm.length ? Math.max(...withKm.map((e) => e.km as number)) : null;
    let chosen: Ev | null = null;
    if (recordKm != null && withKm.length) {
      chosen = withKm.reduce((best, e) => (Math.abs((e.km as number) - recordKm) < Math.abs((best.km as number) - recordKm) ? e : best));
    } else {
      chosen = arr[0] ?? null;
    }
    return { chosen, mainKm, multi: distinctKms.size > 1, eventsOnDay: arr };
  };

  // ---------------- DETAIL mode ----------------
  if (wantStudent && wantDate) {
    const wl = wantStudent.toLowerCase();
    const ids = students.filter((s) => (s.student_name ?? "").toLowerCase().includes(wl)).map((s) => s.id);
    if (ids.length === 0) {
      console.log(`Не нашёл ученика по «${wantStudent}».`);
      process.exit(0);
    }
    const dayRecs = snaps.filter((s) => ids.includes(s.student_id) && (s.record_date ?? "").slice(0, 10) === wantDate);
    const sourceIds = [...new Set(dayRecs.map((r) => r.source_workout_cache_id).filter(Boolean))] as string[];
    const workouts = sourceIds.length
      ? await fetchAll<{ id: string; completed_distance_raw: string | null; title: string | null; workout_date: string | null; sport_or_type_code: string | null }>(
          supabase, "trainingpeaks_workout_cache", "id, completed_distance_raw, title, workout_date, sport_or_type_code",
          (q) => (q as { in: (c: string, v: string[]) => unknown }).in("id", sourceIds), notes
        )
      : [];
    const wkById = new Map(workouts.map((w) => [w.id, w]));

    console.log("=".repeat(92));
    console.log(`ДЕТАЛЬ: ${wantStudent} · ${wantDate} — read-only`);
    console.log("=".repeat(92));
    if (!dayRecs.length) console.log("Race-рекордов в снапшотах на эту дату нет.");
    for (const r of dayRecs) {
      const recKm = KM_BY_KEY[r.distance_key] ?? r.distance_km ?? null;
      const wk = r.source_workout_cache_id ? wkById.get(r.source_workout_cache_id) : undefined;
      const wkKm = wk ? parseKm(wk.completed_distance_raw) : null;
      const seg = r.calc_method === "best_split" && wkKm != null && recKm != null && wkKm > recKm * 1.3;
      console.log("");
      console.log(`• ${r.distance_key} ${fmtDuration(r.duration_seconds)} (${fmtPace(r.pace_sec_per_km)}), slot=${r.slot}, source=${r.source}`);
      console.log(`  calc_method=${r.calc_method}  ${r.calc_method === "best_split" ? "(ОТРЕЗОК внутри тренировки)" : "(целая тренировка)"}`);
      console.log(`  исходная тренировка: ${wk ? `total=${wkKm ?? "?"} км, «${wk.title ?? "—"}», ${wk.workout_date ?? "?"}, type=${wk.sport_or_type_code ?? "?"}` : "не найдена (source_workout_cache_id пуст?)"}`);
      console.log(`  ВЕРДИКТ: ${seg ? `ОТРЕЗОК — ${r.distance_key} вырезан из тренировки ~${wkKm} км, это НЕ самостоятельный старт на ${r.distance_key}` : "похоже на самостоятельный результат (или тренировка ≈ дистанции рекорда)"}`);
    }
    const ev = evByKey.get(`${ids[0]}|${wantDate}`) ?? [];
    console.log("");
    console.log(`СОБЫТИЯ В race_events на ${wantDate} (${ev.length}):`);
    for (const e of ev) console.log(`  - «${e.title ?? "—"}» distance=${e.km ?? "?"} км (raw=${e.raw ?? "—"})`);
    if (notes.length) { console.log(""); console.log("ПРЕДУПРЕЖДЕНИЯ:"); for (const n of notes) console.log(`  - ${n}`); }
    process.exit(0);
  }

  // ---------------- AGGREGATE mode (#3) ----------------
  const best = snaps.filter((s) => s.slot === "best");
  type Flagged = { student: string; distance_key: string; date: string; recordKm: number; mainKm: number; event: string; sameDistEventExists: boolean; time: string; pace: string };
  const segments: Flagged[] = [];
  const perKey: Record<string, { total: number; segment: number }> = {};
  for (const r of best) {
    const date = (r.record_date ?? "").slice(0, 10);
    const recordKm = KM_BY_KEY[r.distance_key] ?? null;
    if (!date || recordKm == null) continue;
    perKey[r.distance_key] = perKey[r.distance_key] ?? { total: 0, segment: 0 };
    perKey[r.distance_key].total += 1;
    const { chosen, mainKm, eventsOnDay } = attach(r.student_id, date, recordKm);
    if (mainKm != null && mainKm > recordKm * 1.15) {
      perKey[r.distance_key].segment += 1;
      const sameDist = eventsOnDay.some((e) => e.km != null && Math.abs((e.km as number) - recordKm) <= recordKm * 0.05);
      segments.push({
        student: nameById.get(r.student_id) ?? r.student_id,
        distance_key: r.distance_key,
        date,
        recordKm,
        mainKm,
        event: chosen?.title ?? "(нет названия)",
        sameDistEventExists: sameDist,
        time: fmtDuration(r.duration_seconds),
        pace: fmtPace(r.pace_sec_per_km),
      });
    }
  }
  const fiveKseg = segments.filter((s) => s.distance_key === "5k");
  const fiveKathletes = new Set(fiveKseg.map((s) => s.student)).size;

  console.log("=".repeat(92));
  console.log("АГРЕГАТ: рекорды-ОТРЕЗКИ внутри более длинной гонки того же дня — read-only");
  console.log("Критерий: главная (наибольшая) дистанция события в этот день > дистанции рекорда на 15%+.");
  console.log("=".repeat(92));
  console.log("");
  console.log(`#3 — 5k-рекорд на дне более длинной гонки: атлетов ${fiveKathletes}, записей ${fiveKseg.length}.`);
  for (const s of fiveKseg.sort((a, b) => (a.pace > b.pace ? 1 : -1))) {
    console.log(`  - ${s.student} | 5k ${s.time} (${s.pace}) | ${s.date} | главное событие ~${s.mainKm} км «${s.event}»` + (s.sameDistEventExists ? " | NB: в этот день есть и ~5k событие (может быть настоящей пятёркой)" : ""));
  }
  console.log("");
  console.log("По всем дистанциям (best-race, сколько из них — отрезок более длинной гонки дня):");
  for (const k of ["5k", "10k", "21k", "42k"]) {
    const p = perKey[k];
    if (p) console.log(`  ${k}: ${p.segment} из ${p.total}`);
  }
  if (notes.length) { console.log(""); console.log("ПРЕДУПРЕЖДЕНИЯ:"); for (const n of notes) console.log(`  - ${n}`); }
  console.log("");
  console.log("JSON:");
  console.log(JSON.stringify({ fiveK_athletes: fiveKathletes, fiveK_records: fiveKseg.length, segments, perKey }, null, 2));
}

main().then(() => process.exit(0)).catch((e: unknown) => {
  console.error(String((e as { message?: string })?.message ?? e));
  process.exit(1);
});
