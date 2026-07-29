/**
 * Read-only audit: how many workouts actually have a saved GPS track since
 * CLUB_TRACKS_ENABLED, and the coverage over completed running workouts. Answers Igor's
 * "fact first": count, period, distinct students, share of new completed runs with a track.
 *
 * Code finding this confirms: the regular fit-ingest runner (run-fit-ingest-scan.sh / its
 * plist) does NOT set CLUB_TRACKS_ENABLED - only the one-off run-fit-tracks-backfill-60d.sh
 * does - so the hourly ingest saves no tracks. If this prints ~0 (or only backfill-era rows),
 * that is why. No writes, no PII (counts + dates only).
 *
 * Run:  npm run audit-club-track-coverage
 */
import { createSupabaseServerClient } from "@/features/supabase/server";
import { loadClubWorkoutRows } from "@/features/club/service";

type TrackRow = { student_id: string; workout_cache_id: string; workout_date: string | null; scanned_at: string | null };

async function main() {
  const supabase = createSupabaseServerClient();

  const { data, error } = await supabase
    .from("trainingpeaks_workout_tracks")
    .select("student_id, workout_cache_id, workout_date, scanned_at");
  if (error) throw new Error(`tracks read failed: ${error.message}`);
  const tracks = (data as TrackRow[] | null) ?? [];

  const total = tracks.length;
  const students = new Set(tracks.map((t) => t.student_id)).size;
  const dates = tracks.map((t) => (t.workout_date ?? "").slice(0, 10)).filter(Boolean).sort();
  const scans = tracks.map((t) => (t.scanned_at ?? "").slice(0, 10)).filter(Boolean).sort();
  const trackIds = new Set(tracks.map((t) => t.workout_cache_id));

  // Coverage over completed running workouts in the track period (or last 90d if empty).
  const today = new Date().toISOString().slice(0, 10);
  const from = dates[0] || new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const rows = await loadClubWorkoutRows({ from, to: today });
  const running = rows.filter((r) => r.isCompleted && r.isRunning);
  const runningWithTrack = running.filter((r) => trackIds.has(r.id)).length;

  const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "n/a");
  console.log(
    JSON.stringify(
      {
        tracks_total: total,
        distinct_students: students,
        workout_date_range: total ? `${dates[0]} .. ${dates[dates.length - 1]}` : "нет треков",
        scanned_at_range: total ? `${scans[0]} .. ${scans[scans.length - 1]}` : "нет треков",
        coverage_window: `${from} .. ${today}`,
        completed_running_in_window: running.length,
        completed_running_with_track: `${runningWithTrack} (${pct(runningWithTrack, running.length)})`,
        verdict:
          total === 0
            ? "0 треков - координаты не сохраняются (флаг на раннере не задан). Чинить до карт/города."
            : runningWithTrack / Math.max(1, running.length) < 0.15
              ? "мало (<15%) - вероятно только разовый бэкфилл; регулярный раннер не пишет. Включить флаг."
              : "треки идут - можно строить город и карту",
      },
      null,
      2
    )
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(String((e as { message?: string })?.message ?? e));
    process.exit(1);
  });
