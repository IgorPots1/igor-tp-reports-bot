/**
 * READ-ONLY. Dump the fastest race records currently in club_record_snapshots so a
 * human can eyeball them for bogus entries: broken-GPS impossibly fast paces, or
 * "races" that are actually walks / hikes (e.g. race_events had rows like
 * «Пешком / Прогулка 33 км»). No writes.
 *
 * Sorted by pace ascending (fastest first). Event name is resolved by joining the
 * snapshot's (student_id, record_date) to trainingpeaks_race_events.title, falling
 * back to club_calendar_entries.race_name (declared). Rows flagged SUSPECT when the
 * pace is implausibly fast (< 150 s/km ≈ 2:30/km) or the event distance is 0/absent.
 *
 * RUN (from repo root):
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=.env.local scripts/audit-club-race-snapshots-fastest.ts [--limit=20]
 */
import process from "node:process";

import { createSupabaseServerClient } from "@/features/supabase/server";

const PAGE = 1000;
const SUSPECT_PACE_SEC_PER_KM = 150; // ~2:30/km — faster than a human road PR => broken GPS
const KM_BY_KEY: Record<string, number> = { "5k": 5, "10k": 10, "21k": 21.097, "42k": 42.195 };
type SupabaseClient = ReturnType<typeof createSupabaseServerClient>;

/** raw distance string; >1000 => meters. */
function parseKm(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const n = Number(String(raw).replace(",", ".").match(/-?\d+(?:\.\d+)?/)?.[0] ?? "");
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1000 ? n / 1000 : n;
}

function argLimit(): number {
  const a = process.argv.slice(2).find((x) => x.startsWith("--limit="));
  const n = a ? Number(a.slice("--limit=".length)) : 20;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 20;
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
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
    : `${m}:${String(ss).padStart(2, "0")}`;
}

function fmtPace(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec) || sec <= 0) return "n/a";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}/км`;
}

async function main(): Promise<void> {
  const supabase = createSupabaseServerClient();
  const limit = argLimit();
  const notes: string[] = [];

  const students = await fetchAll<{ id: string; student_name: string | null }>(
    supabase,
    "trainingpeaks_students",
    "id, student_name",
    undefined,
    notes
  );
  const nameById = new Map<string, string>();
  for (const s of students) nameById.set(s.id, s.student_name ?? s.id);

  const snaps = await fetchAll<{
    student_id: string;
    distance_key: string;
    record_type: string;
    record_date: string | null;
    duration_seconds: number;
    pace_sec_per_km: number | null;
    distance_km: number | null;
    slot: string;
    source: string | null;
  }>(
    supabase,
    "club_record_snapshots",
    "student_id, distance_key, record_type, record_date, duration_seconds, pace_sec_per_km, distance_km, slot, source",
    (q) => (q as { eq: (c: string, v: string) => unknown }).eq("record_type", "race"),
    notes
  );

  // events by (student, date): keep ALL of the day's events with their distances so we
  // can attach the one NEAREST to the record distance (a day can hold 5/10/21k at once).
  const raceEvents = await fetchAll<{ student_id: string; event_date: string | null; title: string | null; distance_km: number | null; distance_raw: string | null }>(
    supabase,
    "trainingpeaks_race_events",
    "student_id, event_date, title, distance_km, distance_raw",
    undefined,
    notes
  );
  const eventsByKey = new Map<string, Array<{ title: string | null; km: number | null }>>();
  for (const r of raceEvents) {
    const d = (r.event_date ?? "").slice(0, 10);
    if (!r.student_id || !d) continue;
    const arr = eventsByKey.get(`${r.student_id}|${d}`) ?? [];
    arr.push({ title: r.title, km: r.distance_km ?? parseKm(r.distance_raw) });
    eventsByKey.set(`${r.student_id}|${d}`, arr);
  }
  const calendar = await fetchAll<{ student_id: string; entry_date: string | null; race_name: string | null }>(
    supabase,
    "club_calendar_entries",
    "student_id, entry_date, race_name",
    (q) => (q as { eq: (c: string, v: string) => unknown }).eq("kind", "race"),
    notes
  );
  const declaredByKey = new Map<string, string>();
  for (const r of calendar) {
    const d = (r.entry_date ?? "").slice(0, 10);
    if (r.student_id && d && r.race_name) declaredByKey.set(`${r.student_id}|${d}`, r.race_name);
  }

  // dedupe identical (student|distance|date|duration) across slots (best vs best_verified)
  const seen = new Set<string>();
  const rows = snaps
    .filter((s) => {
      const k = `${s.student_id}|${s.distance_key}|${s.record_date}|${s.duration_seconds}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((s) => {
      const d = (s.record_date ?? "").slice(0, 10);
      const key = `${s.student_id}|${d}`;
      // Attach the day's event by NEAREST distance to the record distance; a day with
      // several distances is flagged multi_event (name/km may be from another distance).
      const recordKm = KM_BY_KEY[s.distance_key] ?? s.distance_km ?? null;
      const dayEvents = eventsByKey.get(key) ?? [];
      const withKm = dayEvents.filter((e) => e.km != null);
      const multiEvent = new Set(withKm.map((e) => e.km)).size > 1;
      let chosen: { title: string | null; km: number | null } | null = null;
      if (recordKm != null && withKm.length) {
        chosen = withKm.reduce((best, e) => (Math.abs((e.km as number) - recordKm) < Math.abs((best.km as number) - recordKm) ? e : best));
      } else {
        chosen = dayEvents[0] ?? null;
      }
      const event = chosen?.title ?? declaredByKey.get(key) ?? "(нет названия)";
      const eventKm = chosen?.km ?? null;
      const suspect =
        (s.pace_sec_per_km !== null && s.pace_sec_per_km > 0 && s.pace_sec_per_km < SUSPECT_PACE_SEC_PER_KM) ||
        s.distance_km === null ||
        s.distance_km === 0;
      return {
        student: nameById.get(s.student_id) ?? s.student_id,
        distance_key: s.distance_key,
        time: fmtDuration(s.duration_seconds),
        pace: fmtPace(s.pace_sec_per_km),
        pace_sec: s.pace_sec_per_km,
        date: d || "n/a",
        event,
        event_km: eventKm,
        multi_event: multiEvent,
        distance_km: s.distance_km,
        slot: s.slot,
        source: s.source ?? "",
        suspect,
      };
    })
    .sort((a, b) => {
      const pa = a.pace_sec ?? Number.POSITIVE_INFINITY;
      const pb = b.pace_sec ?? Number.POSITIVE_INFINITY;
      return pa - pb;
    })
    .slice(0, limit);

  console.log("=".repeat(96));
  console.log(`САМЫЕ БЫСТРЫЕ RACE-СНАПШОТЫ (топ ${limit} по темпу, быстрейшие сверху) — read-only`);
  console.log("SUSPECT = темп < 2:30/км (битый GPS) ИЛИ дистанция события 0/нет.");
  console.log("=".repeat(96));
  console.log(
    ["#", "ученик", "дист", "время", "темп", "дата", "событие", "соб.км", "src", "флаг"].join(" | ")
  );
  rows.forEach((r, i) => {
    const flags = [r.suspect ? "SUSPECT" : "", r.multi_event ? "MULTI-DIST-DAY" : ""].filter(Boolean).join(",");
    console.log(
      [
        String(i + 1).padStart(2),
        r.student,
        r.distance_key,
        r.time,
        r.pace,
        r.date,
        r.event,
        r.event_km ?? "—",
        r.source,
        flags,
      ].join(" | ")
    );
  });
  if (notes.length) {
    console.log("");
    console.log("ПРЕДУПРЕЖДЕНИЯ ЧТЕНИЯ:");
    for (const n of notes) console.log(`  - ${n}`);
  }
  console.log("");
  console.log("JSON:");
  console.log(JSON.stringify(rows, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    console.error(String((e as { message?: string })?.message ?? e));
    process.exit(1);
  });
