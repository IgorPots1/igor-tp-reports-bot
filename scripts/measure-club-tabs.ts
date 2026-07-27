/**
 * Phase 1.1 — measure REAL per-tab latency of the club mini-app on production data.
 * READ-ONLY: only calls the read view-builders (never materialize, which writes).
 *
 * Picks one real active+visible student that has recent workouts, then times each of
 * the six server builders behind the 5 tabs (median of 3 runs; first run reported as
 * cold). Prints a table: tab / builder / cold ms / median ms.
 *
 * Run (env path is absolute, so this works from any worktree):
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=/Users/igor/igor-tp-reports-bot/.env.local \
 *     scripts/measure-club-tabs.ts
 */
import {
  getClubFeed,
  getClubChallenge,
  getClubRecords,
  getClubStatistics,
  getClubExtendedTops,
  getClubProfileDetail,
  loadStudentsTouchedSince,
} from "@/features/club/service";
import { createSupabaseServerClient } from "@/features/supabase/server";

function ms(n: number): string {
  return `${Math.round(n)}`;
}

async function timeIt<T>(fn: () => Promise<T>, runs = 3): Promise<{ cold: number; median: number }> {
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = Date.now();
    await fn();
    samples.push(Date.now() - t);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return { cold: samples[0], median: sorted[Math.floor(sorted.length / 2)] };
}

async function pickStudent(): Promise<{ id: string; name: string }> {
  // Prefer a student with recent activity so the profile/feed paths are realistic.
  const touched = await loadStudentsTouchedSince(new Date(Date.now() - 90 * 864e5).toISOString()).catch(() => []);
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("trainingpeaks_students")
    .select("id, student_name, is_active, is_service_account")
    .eq("is_active", true)
    .order("student_name", { ascending: true });
  const rows = (data as Array<{ id: string; student_name: string; is_service_account: boolean | null }> | null) ?? [];
  // Phase G #35: honor the coach-participant allowlist (matches app isVisible).
  const inc = new Set((process.env.CLUB_INCLUDE_SERVICE_STUDENT_IDS ?? "").split(",").map((x) => x.trim()).filter(Boolean));
  const active = rows.filter((r) => r.is_service_account !== true || inc.has(r.id));
  const chosen = active.find((r) => touched.includes(r.id)) ?? active[0];
  if (!chosen) throw new Error("no active student found");
  return { id: chosen.id, name: chosen.student_name };
}

async function main(): Promise<void> {
  const student = await pickStudent();
  console.log(`Measuring on student: ${student.name} (${student.id})\n`);

  const results: Array<{ tab: string; builder: string; cold: number; median: number }> = [];

  const feed = await timeIt(() => getClubFeed({ currentStudentId: student.id }));
  results.push({ tab: "Лента", builder: "getClubFeed", ...feed });

  const challenge = await timeIt(() => getClubChallenge({ currentStudentId: student.id }));
  results.push({ tab: "Челлендж", builder: "getClubChallenge", ...challenge });

  const records = await timeIt(() => getClubRecords({ currentStudentId: student.id }));
  results.push({ tab: "Результаты", builder: "getClubRecords (материализ.)", ...records });

  const stats = await timeIt(() => getClubStatistics());
  const tops = await timeIt(() => getClubExtendedTops({ currentStudentId: student.id }));
  results.push({ tab: "Клуб (stats)", builder: "getClubStatistics", ...stats });
  results.push({ tab: "Клуб (tops)", builder: "getClubExtendedTops", ...tops });

  const profile = await timeIt(() => getClubProfileDetail({ currentStudentId: student.id, currentStudentName: student.name }));
  results.push({ tab: "Профиль", builder: "getClubProfileDetail", ...profile });

  console.log("| Вкладка | Builder | cold, ms | median, ms |");
  console.log("|---|---|---:|---:|");
  for (const r of results) {
    console.log(`| ${r.tab} | ${r.builder} | ${ms(r.cold)} | ${ms(r.median)} |`);
  }

  // "Клуб" tab loads statistics + tops together (Promise.all) → its wall time ≈ max.
  const clubTab = Math.max(stats.median, tops.median);
  console.log(`\nВкладка «Клуб» (stats+tops параллельно) ≈ ${ms(clubTab)} ms median`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
