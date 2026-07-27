/**
 * Phase 1.4 parity harness (naryad point 3). Proves the aggregate path returns the
 * SAME numbers as the raw path for challenge / statistics / tops / profile-rank, on
 * REAL production data — BEFORE anyone flips CLUB_AGGREGATES_ENABLED.
 *
 * Method (trustworthy — exercises the ACTUAL consumer code, not a re-implementation):
 *   OLD = call the consumer with the flag OFF  → raw whole-club window + JS aggregation.
 *   NEW = call the consumer with the flag ON, with loadDailyAggregates overridden to
 *         computeDailyAggregates(loadClubWorkoutRows(sameWindow)) — i.e. the aggregate
 *         reducers fed from the SAME rows the raw path reads. If the reducer algebra is
 *         equivalent, every number matches exactly.
 *
 * Writes docs/club-aggregates-parity.md (metric / old / new / diff). Read-only (no DB writes).
 *
 * Run:
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=/Users/igor/igor-tp-reports-bot/.env.local \
 *     scripts/check-club-aggregates-parity.ts
 */
import { writeFileSync } from "node:fs";

import {
  getClubStatistics,
  getClubChallenge,
  getClubExtendedTops,
  getClubProfileDetail,
  loadClubWorkoutRows,
  computeDailyAggregates,
  loadStudentsTouchedSince,
  __setDailyAggregatesSourceForTest,
} from "@/features/club/service";
import { createSupabaseServerClient } from "@/features/supabase/server";

function setFlag(on: boolean): void {
  if (on) process.env.CLUB_AGGREGATES_ENABLED = "true";
  else delete process.env.CLUB_AGGREGATES_ENABLED;
}

// NEW path source: aggregates built from the SAME rows the raw path reads, then sorted
// the way the DB read returns them — (day asc, student_id asc) — so the harness mirrors
// the PRODUCTION iteration order (catches any tie-break divergence, not just algebra).
async function aggFromSameRows(input: { from: string; to: string; studentIds?: string[] }) {
  const rows = await loadClubWorkoutRows(input);
  return computeDailyAggregates(rows).sort((a, b) => (a.day !== b.day ? (a.day < b.day ? -1 : 1) : a.studentId < b.studentId ? -1 : a.studentId > b.studentId ? 1 : 0));
}

async function withNew<T>(fn: () => Promise<T>): Promise<T> {
  setFlag(true);
  __setDailyAggregatesSourceForTest(aggFromSameRows);
  try {
    return await fn();
  } finally {
    __setDailyAggregatesSourceForTest(null);
    setFlag(false);
  }
}

async function pickStudent(): Promise<{ id: string; name: string }> {
  const touched = await loadStudentsTouchedSince(new Date(Date.now() - 90 * 864e5).toISOString()).catch(() => []);
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("trainingpeaks_students")
    .select("id, student_name, is_active, is_service_account")
    .eq("is_active", true)
    .order("student_name", { ascending: true });
  const rows = (data as Array<{ id: string; student_name: string; is_service_account: boolean | null }> | null) ?? [];
  const active = rows.filter((r) => r.is_service_account !== true);
  const chosen = active.find((r) => touched.includes(r.id)) ?? active[0];
  if (!chosen) throw new Error("no active student");
  return { id: chosen.id, name: chosen.student_name };
}

type Line = { metric: string; old: string; neu: string; diff: string };
const lines: Line[] = [];
let mismatches = 0;
function cmp(metric: string, oldV: unknown, newV: unknown): void {
  const o = typeof oldV === "string" ? oldV : JSON.stringify(oldV);
  const n = typeof newV === "string" ? newV : JSON.stringify(newV);
  const same = o === n;
  if (!same) mismatches += 1;
  lines.push({ metric, old: o, neu: n, diff: same ? "0" : "≠ РАСХОЖДЕНИЕ" });
}

// Compact leaderboard rep: "name:value" in order (composition + order + value).
function topRep(rows: Array<{ studentId: string; value: string }>): string {
  return rows.map((r) => `${r.studentId.slice(0, 8)}=${r.value}`).join(" | ") || "(пусто)";
}
function perfRep(rows: Array<{ studentId: string; completionPct: number; plannedCount: number; completedCount: number }>): string {
  return rows.map((p) => `${p.studentId.slice(0, 8)}:${p.plannedCount}/${p.completedCount}/${Math.round(p.completionPct * 100)}%`).join(" | ") || "(пусто)";
}

async function main(): Promise<void> {
  setFlag(false);
  const student = await pickStudent();

  // --- Statistics ---
  const sOld = await getClubStatistics();
  const sNew = await withNew(() => getClubStatistics());
  cmp("stats.clubKm", sOld.clubKm, sNew.clubKm);
  cmp("stats.activeCount", sOld.activeCount, sNew.activeCount);
  cmp("stats.workoutsCount", sOld.workoutsCount, sNew.workoutsCount);
  cmp("stats.avgCompletionPct", sOld.avgCompletionPct, sNew.avgCompletionPct);
  cmp("stats.prevClubKm", sOld.prevClubKm, sNew.prevClubKm);
  cmp("stats.weekOverWeekPct", sOld.weekOverWeekPct, sNew.weekOverWeekPct);

  // --- Challenge ---
  const cOld = await getClubChallenge({ currentStudentId: student.id });
  const cNew = await withNew(() => getClubChallenge({ currentStudentId: student.id }));
  cmp("challenge.clubKm", cOld.clubKm, cNew.clubKm);
  cmp("challenge.goalKm", cOld.goalKm, cNew.goalKm);
  cmp("challenge.goalMode", cOld.goalMode, cNew.goalMode);
  cmp("challenge.progressPct", cOld.progressPct, cNew.progressPct);
  cmp("challenge.topPerformers", perfRep(cOld.topPerformers), perfRep(cNew.topPerformers));
  cmp("challenge.personal", JSON.stringify(cOld.personal), JSON.stringify(cNew.personal));

  // --- Tops ---
  const tOld = await getClubExtendedTops({ currentStudentId: student.id });
  const tNew = await withNew(() => getClubExtendedTops({ currentStudentId: student.id }));
  cmp("tops.byVolume", topRep(tOld.byVolume), topRep(tNew.byVolume));
  cmp("tops.byCount", topRep(tOld.byCount), topRep(tNew.byCount));
  cmp("tops.byCompletion", topRep(tOld.byCompletion), topRep(tNew.byCompletion));
  cmp("tops.byStreak", topRep(tOld.byStreak), topRep(tNew.byStreak));

  // --- Profile rank ---
  const pOld = await getClubProfileDetail({ currentStudentId: student.id, currentStudentName: student.name });
  const pNew = await withNew(() => getClubProfileDetail({ currentStudentId: student.id, currentStudentName: student.name }));
  cmp("profile.challengeRank", pOld.challengeRank, pNew.challengeRank);
  cmp("profile.challengeParticipants", pOld.challengeParticipants, pNew.challengeParticipants);
  cmp("profile.completionPct", pOld.completionPct, pNew.completionPct);
  cmp("profile.noPlan", pOld.noPlan, pNew.noPlan);

  const md = [
    "# Club aggregates — parity (Phase 1.4)",
    "",
    `Student: ${student.name} (${student.id.slice(0, 8)}). OLD=raw path, NEW=aggregate path (fed from the same rows).`,
    "Ожидаемое расхождение — ноль по всем показателям.",
    "",
    "| Показатель | Старое | Новое | Расхождение |",
    "|---|---|---|---|",
    ...lines.map((l) => `| ${l.metric} | ${l.old} | ${l.neu} | ${l.diff} |`),
    "",
    mismatches === 0 ? "**ИТОГ: 0 расхождений — паритет полный.**" : `**ИТОГ: ${mismatches} расхождений — СМОТРЕТЬ ВЫШЕ.**`,
    "",
  ].join("\n");
  writeFileSync("docs/club-aggregates-parity.md", md);
  console.log(md);
  process.exit(mismatches === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
