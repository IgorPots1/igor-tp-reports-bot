/**
 * BLOCK 1.3/1.4 — output parity + timing for read windows (read-only).
 * Runs the REAL planner (assemblePlannerInputsForWorkouts → buildFeedbackContextPacket)
 * for recent sweep targets with FULL history vs several windows, and diffs the
 * draft-facing output (comparisonBlock, comparisonBaseline, observations, blocked).
 * A window is safe only if output is identical to full. Also prints row volume and
 * wall-clock per config.
 *
 * Run: node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *        --env-file=.env.local scripts/measure-window-parity.ts
 */
import { createSupabaseServerClient } from "@/features/supabase/server";
import { assemblePlannerInputsForWorkouts } from "@/features/trainingpeaks/feedback/feedback-enqueue";
import { buildFeedbackContextPacket } from "@/features/trainingpeaks/feedback/context-packet";
import { fetchAllRows } from "@/features/supabase/paginate";

type Cfg = { name: string; historyWindowDays: number | null; healthWindowDays: number | null };

function outKey(cacheId: string, built: ReturnType<typeof buildFeedbackContextPacket>): string {
  if (built.blocked) return `BLOCKED:${built.reason}`;
  const p = built.packet;
  return JSON.stringify({ cb: p.comparisonBlock, bl: p.comparisonBaseline, obs: p.observations });
}

async function main() {
  const supabase = createSupabaseServerClient();
  const today = new Date().toISOString().slice(0, 10);
  const floor = new Date(Date.now() - 4 * 86_400_000).toISOString().slice(0, 10);
  const targets = await fetchAllRows<Record<string, unknown>>(
    (f, t) => supabase.from("trainingpeaks_workout_derived_metrics").select("*").eq("workout_type", "run").gte("workout_date", floor).lte("workout_date", today).order("id").range(f, t),
    { label: "targets" }
  );
  // Parity sample: the FULL assemble is ~70s over all recent targets, so test a
  // representative slice to compare outputs without statement timeouts.
  const sample = targets.slice(0, 6);
  console.log(`recent run targets: ${targets.length}; PARITY SAMPLE: ${sample.length}, students: ${new Set(sample.map((r) => r.student_id)).size}\n`);

  const configs: Cfg[] = [
    { name: "FULL", historyWindowDays: null, healthWindowDays: null },
    { name: "hist365/health60", historyWindowDays: 365, healthWindowDays: 60 },
    
    { name: "hist120/health60", historyWindowDays: 120, healthWindowDays: 60 },
    
  ];

  const outByCfg = new Map<string, Map<string, string>>();
  for (const cfg of configs) {
    const t0 = process.hrtime.bigint();
    const packets = await assemblePlannerInputsForWorkouts(supabase, sample, { historyWindowDays: cfg.historyWindowDays, healthWindowDays: cfg.healthWindowDays });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const outs = new Map<string, string>();
    for (const [cacheId, packetInput] of packets) outs.set(cacheId, outKey(cacheId, buildFeedbackContextPacket(packetInput)));
    outByCfg.set(cfg.name, outs);
    console.log(`${cfg.name.padEnd(18)} assemble+build: ${ms.toFixed(0)} ms, packets: ${packets.size}`);
  }

  const full = outByCfg.get("FULL")!;
  console.log(`\n# parity vs FULL (${full.size} target packets)`);
  for (const cfg of configs.slice(1)) {
    const o = outByCfg.get(cfg.name)!;
    let diffs = 0; const examples: string[] = [];
    for (const [cacheId, v] of full) {
      if (o.get(cacheId) !== v) { diffs++; if (examples.length < 3) examples.push(cacheId.slice(0, 8)); }
    }
    console.log(`  ${cfg.name.padEnd(18)} diffs: ${diffs}/${full.size}${diffs ? " — e.g. " + examples.join(",") : " ✅ identical"}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
