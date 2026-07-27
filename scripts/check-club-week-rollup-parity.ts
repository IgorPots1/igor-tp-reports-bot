/**
 * Phase 1.4 follow-up parity — WEEKLY ROLLUP path vs raw path, on REAL data, in-memory.
 *
 * Proves the rollup reducers + streak match the raw whole-club computation BEFORE the
 * rollup tables exist in prod (migration not applied yet). Mirrors production: builds the
 * master rollup/streak in-memory via computeWeekRollups/computeStudentStreaks (the same
 * functions materialize writes), sorted (week_start, student_id) like the DB read, and
 * feeds them into the REAL consumer code through the loadWeekRollups/loadStudentStreaks
 * test overrides. Streak anchor = club "today" (matches the raw path).
 *
 * OLD = consumer flag OFF (raw). NEW = CLUB_AGGREGATES_ENABLED + CLUB_WEEK_ROLLUP_ENABLED
 * with overrides. Expect 0 diffs. (End-to-end DB check after materialize:
 * check-club-aggregates-parity-realdb with CLUB_WEEK_ROLLUP_ENABLED=true.)
 *
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=/Users/igor/igor-tp-reports-bot/.env.local scripts/check-club-week-rollup-parity.ts
 */
import {
  getClubStatistics,
  getClubChallenge,
  getClubExtendedTops,
  getClubProfileDetail,
  loadClubWorkoutRows,
  computeWeekRollups,
  computeStudentStreaks,
  loadStudentsTouchedSince,
  __setWeekRollupSourcesForTest,
  __clubTodayIsoForTest,
  type WeekRollup,
  type StudentStreak,
} from "@/features/club/service";
import { createSupabaseServerClient } from "@/features/supabase/server";

function isoBack(days: number): string {
  return new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
}
function isoFwd(days: number): string {
  return new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  // Master rollup/streak from a WIDE window (superset of the materialize window) — each
  // week's rollup is independent, so a superset yields identical per-week rollups.
  const rows = await loadClubWorkoutRows({ from: isoBack(400), to: isoFwd(30) });
  const today = __clubTodayIsoForTest();
  const masterWeek = computeWeekRollups(rows);
  const masterStreak = computeStudentStreaks(rows, today);

  const weekSource = async (input: { fromWeek: string; toWeek: string; studentIds?: string[] }): Promise<WeekRollup[]> => {
    const ids = input.studentIds ? new Set(input.studentIds) : null;
    return masterWeek
      .filter((r) => r.weekStart >= input.fromWeek && r.weekStart <= input.toWeek && (!ids || ids.has(r.studentId)))
      .sort((a, b) => (a.weekStart !== b.weekStart ? (a.weekStart < b.weekStart ? -1 : 1) : a.studentId < b.studentId ? -1 : a.studentId > b.studentId ? 1 : 0));
  };
  const streakSource = async (studentIds?: string[]): Promise<StudentStreak[]> => {
    const ids = studentIds ? new Set(studentIds) : null;
    return masterStreak.filter((s) => !ids || ids.has(s.studentId)).sort((a, b) => (a.studentId < b.studentId ? -1 : a.studentId > b.studentId ? 1 : 0));
  };

  const off = () => {
    delete process.env.CLUB_AGGREGATES_ENABLED;
    delete process.env.CLUB_WEEK_ROLLUP_ENABLED;
    __setWeekRollupSourcesForTest(null, null);
  };
  const on = () => {
    process.env.CLUB_AGGREGATES_ENABLED = "true";
    process.env.CLUB_WEEK_ROLLUP_ENABLED = "true";
    __setWeekRollupSourcesForTest(weekSource, streakSource);
  };

  const touched = await loadStudentsTouchedSince(new Date(Date.now() - 90 * 864e5).toISOString()).catch(() => []);
  const sb = createSupabaseServerClient();
  const { data } = await sb.from("trainingpeaks_students").select("id, student_name, is_service_account").eq("is_active", true).order("student_name");
  const cand = ((data as Array<{ id: string; student_name: string; is_service_account: boolean | null }> | null) ?? []).filter((r) => r.is_service_account !== true);
  const s = cand.find((r) => touched.includes(r.id)) ?? cand[0];

  let bad = 0;
  const c = (m: string, a: unknown, b: unknown) => {
    const x = JSON.stringify(a);
    const y = JSON.stringify(b);
    if (x !== y) {
      bad++;
      console.log(`≠ ${m}\n  old=${x}\n  new=${y}`);
    } else console.log(`✓ ${m}`);
  };

  off();
  const s1 = await getClubStatistics();
  on();
  const s2 = await getClubStatistics();
  off();
  c("stats", { k: s1.clubKm, a: s1.activeCount, w: s1.workoutsCount, avg: s1.avgCompletionPct, p: s1.prevClubKm, ww: s1.weekOverWeekPct }, { k: s2.clubKm, a: s2.activeCount, w: s2.workoutsCount, avg: s2.avgCompletionPct, p: s2.prevClubKm, ww: s2.weekOverWeekPct });

  const h1 = await getClubChallenge({ currentStudentId: s.id });
  on();
  const h2 = await getClubChallenge({ currentStudentId: s.id });
  off();
  c("challenge", { k: h1.clubKm, g: h1.goalKm, m: h1.goalMode, pp: h1.progressPct, tp: h1.topPerformers.map((p) => `${p.studentId}:${p.plannedCount}/${p.completedCount}`), per: h1.personal }, { k: h2.clubKm, g: h2.goalKm, m: h2.goalMode, pp: h2.progressPct, tp: h2.topPerformers.map((p) => `${p.studentId}:${p.plannedCount}/${p.completedCount}`), per: h2.personal });

  const t1 = await getClubExtendedTops({ currentStudentId: s.id });
  on();
  const t2 = await getClubExtendedTops({ currentStudentId: s.id });
  off();
  c("tops", { v: t1.byVolume.map((r) => r.studentId + r.value), n: t1.byCount.map((r) => r.studentId + r.value), cm: t1.byCompletion.map((r) => r.studentId + r.value), st: t1.byStreak.map((r) => r.studentId + r.value) }, { v: t2.byVolume.map((r) => r.studentId + r.value), n: t2.byCount.map((r) => r.studentId + r.value), cm: t2.byCompletion.map((r) => r.studentId + r.value), st: t2.byStreak.map((r) => r.studentId + r.value) });

  const p1 = await getClubProfileDetail({ currentStudentId: s.id, currentStudentName: s.student_name });
  on();
  const p2 = await getClubProfileDetail({ currentStudentId: s.id, currentStudentName: s.student_name });
  off();
  c("profile.rank", { r: p1.challengeRank, pt: p1.challengeParticipants, cp: p1.completionPct, np: p1.noPlan }, { r: p2.challengeRank, pt: p2.challengeParticipants, cp: p2.completionPct, np: p2.noPlan });

  console.log(bad === 0 ? "\nROLLUP (in-memory, зеркало прод): 0 расхождений ✓" : `\n${bad} расхождений`);
  process.exit(bad === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
