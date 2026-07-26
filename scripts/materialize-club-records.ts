/**
 * Recompute materialized club records into club_record_snapshots.
 *
 * Called after workout-cache-scan AND after fit-ingest-scan (FIT laps arrive after
 * the summary and only lift best-split trust once present). Incremental by default:
 * recomputes only students whose workout_cache OR workout_laps changed in the last
 * --since-hours window — decoupled from the scan's internals, and it catches FIT
 * because workout_laps.updated_at moves when laps land.
 *
 * Modes:
 *   (default)          incremental: students touched in the last --since-hours (24)
 *   --all              full club recompute
 *   --students=a,b,c   explicit student ids
 *   --since-hours=N    override the incremental lookback (default 24)
 *   --dry-run          compute + print counts, write nothing
 *
 * Run:
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=.env.local scripts/materialize-club-records.ts [flags]
 *
 * Writes ONLY club_record_snapshots (scoped DELETE+INSERT per affected student).
 * Never touches club_records (coach overrides). Requires the migration applied.
 */

import { materializeClubRecords, loadStudentsTouchedSince } from "@/features/club/service";

function argValue(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3600_000).toISOString();
}

async function main(): Promise<void> {
  const dryRun = hasFlag("dry-run");
  const all = hasFlag("all");
  const explicit = argValue("students");
  const sinceHours = Number(argValue("since-hours") ?? "24");

  let studentIds: string[] | null;
  let mode: string;
  if (all) {
    studentIds = null;
    mode = "all (full club)";
  } else if (explicit) {
    studentIds = explicit.split(",").map((s) => s.trim()).filter(Boolean);
    mode = `explicit (${studentIds.length} ids)`;
  } else {
    const since = isoHoursAgo(sinceHours);
    studentIds = await loadStudentsTouchedSince(since);
    mode = `incremental: touched since ${since} (${studentIds.length} students)`;
    if (studentIds.length === 0) {
      console.log(`[materialize] nothing touched in last ${sinceHours}h — nothing to recompute.`);
      return;
    }
  }

  console.log(`[materialize] mode=${mode} dryRun=${dryRun}`);
  const result = await materializeClubRecords({ studentIds, dryRun });
  console.log(
    `[materialize] ${dryRun ? "DRY-RUN " : ""}studentsProcessed=${result.studentsProcessed} rowsWritten=${result.rowsWritten}`
  );
}

main().catch((err) => {
  console.error("[materialize] FAILED", err);
  process.exit(1);
});
