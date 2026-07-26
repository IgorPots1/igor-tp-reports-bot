/**
 * Club smoke — runs the main read scenarios of the club mini app on ONE real
 * student. READ-ONLY: writes nothing, sends nothing to students. Prints
 * PASSED / FAILED at [scenario]; exit≠0 on any failure or any club-table access
 * error. Use after enabling club flags to confirm the surface actually works.
 *
 * Run:
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=.env.local scripts/smoke-club.ts
 */

import {
  getClubRecords,
  getClubFeed,
  getClubChallenge,
  getClubStatistics,
  getClubExtendedTops,
  getClubProfileDetail,
  getClubPrediction,
} from "@/features/club/service";
import { listActiveStudentsForRevision, probeClubTablesHealth } from "@/features/club-admin/repository";

async function step<T>(name: string, fn: () => Promise<T>, check?: (v: T) => string | null): Promise<boolean> {
  try {
    const v = await fn();
    const problem = check ? check(v) : null;
    if (problem) {
      console.error(`FAILED at [${name}]: ${problem}`);
      return false;
    }
    console.log(`PASSED [${name}]`);
    return true;
  } catch (err) {
    console.error(`FAILED at [${name}]:`, err instanceof Error ? err.message : err);
    return false;
  }
}

async function main(): Promise<void> {
  let ok = true;

  // 0) club-table access must be clean (loud on 42501 / 42P01).
  ok = (await step("club_tables_health", () => probeClubTablesHealth(), (rows) => {
    const bad = rows.filter((r) => !r.ok);
    return bad.length ? `${bad.map((b) => `${b.table}(${b.code})`).join(", ")}` : null;
  })) && ok;

  const students = await listActiveStudentsForRevision();
  if (students.length === 0) {
    console.error("FAILED at [pick_student]: no active students");
    process.exit(1);
  }
  const s = students[0];
  console.log(`test student: ${s.name} (${s.id.slice(0, 8)})`);

  ok = (await step("records", () => getClubRecords({ currentStudentId: s.id }),
    (v) => (Array.isArray(v.personal) && Array.isArray(v.clubTops) ? null : "bad shape"))) && ok;
  ok = (await step("feed", () => getClubFeed({ currentStudentId: s.id }))) && ok;
  ok = (await step("challenge", () => getClubChallenge({ currentStudentId: s.id }))) && ok;
  ok = (await step("statistics", () => getClubStatistics())) && ok;
  ok = (await step("extended_tops", () => getClubExtendedTops({ currentStudentId: s.id }))) && ok;
  ok = (await step("profile_detail", () => getClubProfileDetail({ currentStudentId: s.id, currentStudentName: s.name }))) && ok;
  ok = (await step("prediction", () => getClubPrediction({ currentStudentId: s.id }))) && ok;

  if (!ok) {
    console.error("SMOKE FAILED");
    process.exit(1);
  }
  console.log("SMOKE PASSED — all club scenarios OK (read-only)");
}

main().catch((err) => {
  console.error("SMOKE FAILED (uncaught):", err);
  process.exit(1);
});
