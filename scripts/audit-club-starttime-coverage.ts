/**
 * Read-only audit: what fraction of COMPLETED RUNNING workouts would render a local
 * time-of-day in the club feed (the "07:30" block). Uses the EXACT same predicate the
 * feed uses (`localStartHm` from the club service) so the number matches the UI.
 *
 * Igor asked to verify this on real data (code analysis said cache.start_time is TP-API
 * local, not FIT-UTC; this proves it with the actual fill-rate). No writes, no PII: only
 * counts and structural shapes (exact clock digits are masked to '#').
 *
 * Run:  npm run audit-club-starttime-coverage         (needs SUPABASE_URL/SERVICE_ROLE)
 *       WINDOW_DAYS=365 npm run audit-club-starttime-coverage
 */
import { loadClubWorkoutRows, localStartHm } from "@/features/club/service";

function isoDaysAgo(days: number): string {
  const ms = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`) - days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Structural shape of a start_time string (no exact time leaked). */
function shape(s: string | null): string {
  if (!s) return "null";
  const t = s.trim();
  if (/z$/iu.test(t)) return "UTC(Z)";
  if (/[t ]\d{2}:\d{2}(:\d{2})?[+-]\d{2}:?\d{2}$/iu.test(t)) return "offset";
  if (/^\d{4}-\d{2}-\d{2}[t ]\d{2}:\d{2}/iu.test(t)) return "naive-datetime";
  if (/^\d{4}-\d{2}-\d{2}$/u.test(t)) return "date-only";
  return "other";
}

async function main() {
  const windowDays = Number.parseInt(process.env.WINDOW_DAYS ?? "365", 10);
  const today = new Date().toISOString().slice(0, 10);
  const from = isoDaysAgo(Number.isFinite(windowDays) && windowDays > 0 ? windowDays : 365);

  const rows = await loadClubWorkoutRows({ from, to: today });
  const running = rows.filter((r) => r.isCompleted && r.isRunning);
  const total = running.length;

  const byShape = new Map<string, number>();
  const example = new Map<string, string>();
  let renderable = 0;
  for (const r of running) {
    const sh = shape(r.startTime);
    byShape.set(sh, (byShape.get(sh) ?? 0) + 1);
    if (localStartHm(r.startTime)) renderable += 1;
    if (r.startTime && !example.has(sh)) example.set(sh, r.startTime.replace(/\d/gu, "#"));
  }

  const pct = (n: number) => (total > 0 ? `${((n / total) * 100).toFixed(1)}%` : "n/a");
  const out = {
    window: `${from}..${today} (${windowDays}d)`,
    completed_running: total,
    time_of_day_renderable: `${renderable} (${pct(renderable)})`,
    start_time_shapes: Object.fromEntries([...byShape.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, `${v} (${pct(v)})`])),
    example_shapes: Object.fromEntries(example),
    verdict:
      total === 0
        ? "нет завершённых беговых в окне"
        : renderable / total >= 0.5
          ? "время суток осмысленно (>=50% показуемо)"
          : renderable / total >= 0.15
            ? "частично (15-50%): решить, оставлять ли блок"
            : "мало (<15%): блок почти не рисуется, обсудить (пояс атлета / убрать)",
  };
  console.log(JSON.stringify(out, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(String((e as { message?: string })?.message ?? e));
    process.exit(1);
  });
