/**
 * SMOKE — feedback boevoy path on ONE student, NO write, NO send.
 * Exercises assemblePlannerInputsForWorkouts + buildFeedbackContextPacket for one
 * recent run — the same reads the sweep makes (incl. the health-metric-profiles read
 * that crashed on a missing `id` order). Read-only: it never enqueues, never sends.
 * Prints PASSED, or FAILED at <step> with the error, and exits non-zero on failure.
 *
 * Add to pre-merge checks alongside tsc/eslint/build — this crash passed all three
 * because they don't execute a query against the real schema.
 *
 * Run: node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *        --env-file=.env.local scripts/smoke-feedback-sweep.ts
 */
import { createSupabaseServerClient } from "@/features/supabase/server";
import { assemblePlannerInputsForWorkouts } from "@/features/trainingpeaks/feedback/feedback-enqueue";
import { buildFeedbackContextPacket } from "@/features/trainingpeaks/feedback/context-packet";
import { fetchAllRows } from "@/features/supabase/paginate";

const DERIVED_SELECT = "*";

async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    console.error(`FAILED at [${name}]: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

async function main() {
  const supabase = createSupabaseServerClient();
  const today = new Date().toISOString().slice(0, 10);
  const floor = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);

  // Pick ONE recent run derived row (a real sweep target).
  const target = await step("pick-target", async () => {
    const rows = await fetchAllRows<Record<string, unknown>>(
      (f, t) => supabase.from("trainingpeaks_workout_derived_metrics").select(DERIVED_SELECT)
        .eq("workout_type", "run").gte("workout_date", floor).lte("workout_date", today)
        .order("id").range(f, t),
      { label: "smoke:targets" }
    );
    if (rows.length === 0) throw new Error("no recent run derived rows to smoke on");
    return rows[0];
  });
  console.log(`smoke target: student ${(target.student_id as string).slice(0, 8)}, workout_date ${target.workout_date}`);

  // assemble (reads history/laps/health/profiles/memory/obs) — the crash path.
  const packets = await step("assemble", () => assemblePlannerInputsForWorkouts(supabase, [target]));

  // build the draft packet (comparison/factcheck) — pure over the assembled input.
  await step("build-packet", async () => {
    const input = packets.get(target.workout_cache_id as string);
    if (!input) {
      // Not an error: the target may be a race (excluded) or blocked — assemble ran clean.
      console.log("note: no packet for target (race/excluded) — assemble path OK");
      return;
    }
    const built = buildFeedbackContextPacket(input);
    console.log(`packet built: ${built.blocked ? `blocked (${built.reason})` : `ok, comparison="${built.packet.comparisonBlock.slice(0, 60)}..."`}`);
  });

  console.log("PASSED — feedback assemble+build ran clean, no write, no send.");
}

main().catch((e) => { console.error(`FAILED (fatal): ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
