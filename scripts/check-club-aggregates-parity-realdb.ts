/**
 * Phase 1.4 END-TO-END parity — the AUTHORITATIVE post-materialize check.
 *
 * Unlike check-club-aggregates-parity.ts (which feeds in-memory aggregates and proves
 * only the reducer ALGEBRA), this reads the ACTUAL materialized club_daily_aggregates
 * table (flag ON, no override) and compares to the raw path (flag OFF). It therefore
 * also catches materialize-side bugs — e.g. a too-narrow write window that under-counts
 * PLANNED workouts (that exact bug slipped past the in-memory check and was caught here).
 *
 * Run AFTER `materialize-club-records --all`. Must print 0 before flipping the flag.
 *
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=/Users/igor/igor-tp-reports-bot/.env.local \
 *     scripts/check-club-aggregates-parity-realdb.ts
 */
import {
  getClubStatistics,
  getClubChallenge,
  getClubExtendedTops,
  getClubProfileDetail,
  loadStudentsTouchedSince,
} from "@/features/club/service";
import { createSupabaseServerClient } from "@/features/supabase/server";

const sb = createSupabaseServerClient();
const off = () => {
  delete process.env.CLUB_AGGREGATES_ENABLED;
};
const on = () => {
  process.env.CLUB_AGGREGATES_ENABLED = "true";
};

let bad = 0;
function c(metric: string, a: unknown, b: unknown): void {
  const x = JSON.stringify(a);
  const y = JSON.stringify(b);
  if (x !== y) {
    bad++;
    console.log(`≠ ${metric}\n  old=${x}\n  new=${y}`);
  } else {
    console.log(`✓ ${metric}`);
  }
}

async function main(): Promise<void> {
  const { count } = await sb.from("club_daily_aggregates").select("*", { count: "exact", head: true });
  console.log(`club_daily_aggregates в БД: ${count} строк\n`);

  const touched = await loadStudentsTouchedSince(new Date(Date.now() - 90 * 864e5).toISOString()).catch(() => []);
  const { data } = await sb
    .from("trainingpeaks_students")
    .select("id, student_name, is_service_account")
    .eq("is_active", true)
    .order("student_name");
  const rows = ((data as Array<{ id: string; student_name: string; is_service_account: boolean | null }> | null) ?? []).filter(
    (r) => r.is_service_account !== true
  );
  const s = rows.find((r) => touched.includes(r.id)) ?? rows[0];

  off();
  const s1 = await getClubStatistics();
  on();
  const s2 = await getClubStatistics();
  c("stats", { k: s1.clubKm, a: s1.activeCount, w: s1.workoutsCount, avg: s1.avgCompletionPct, p: s1.prevClubKm, ww: s1.weekOverWeekPct }, { k: s2.clubKm, a: s2.activeCount, w: s2.workoutsCount, avg: s2.avgCompletionPct, p: s2.prevClubKm, ww: s2.weekOverWeekPct });

  off();
  const c1 = await getClubChallenge({ currentStudentId: s.id });
  on();
  const c2 = await getClubChallenge({ currentStudentId: s.id });
  c("challenge", { k: c1.clubKm, g: c1.goalKm, m: c1.goalMode, pp: c1.progressPct, tp: c1.topPerformers.map((p) => `${p.studentId}:${p.plannedCount}/${p.completedCount}`), per: c1.personal }, { k: c2.clubKm, g: c2.goalKm, m: c2.goalMode, pp: c2.progressPct, tp: c2.topPerformers.map((p) => `${p.studentId}:${p.plannedCount}/${p.completedCount}`), per: c2.personal });

  off();
  const t1 = await getClubExtendedTops({ currentStudentId: s.id });
  on();
  const t2 = await getClubExtendedTops({ currentStudentId: s.id });
  c("tops", { v: t1.byVolume.map((r) => r.studentId + r.value), n: t1.byCount.map((r) => r.studentId + r.value), cm: t1.byCompletion.map((r) => r.studentId + r.value), st: t1.byStreak.map((r) => r.studentId + r.value) }, { v: t2.byVolume.map((r) => r.studentId + r.value), n: t2.byCount.map((r) => r.studentId + r.value), cm: t2.byCompletion.map((r) => r.studentId + r.value), st: t2.byStreak.map((r) => r.studentId + r.value) });

  off();
  const p1 = await getClubProfileDetail({ currentStudentId: s.id, currentStudentName: s.student_name });
  on();
  const p2 = await getClubProfileDetail({ currentStudentId: s.id, currentStudentName: s.student_name });
  c("profile.rank", { r: p1.challengeRank, pt: p1.challengeParticipants, cp: p1.completionPct, np: p1.noPlan }, { r: p2.challengeRank, pt: p2.challengeParticipants, cp: p2.completionPct, np: p2.noPlan });

  console.log(bad === 0 ? "\nРЕАЛЬНАЯ БД: 0 расхождений — end-to-end паритет ✓" : `\n${bad} расхождений — НЕ включать флаг`);
  process.exit(bad === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
