/**
 * Visible status for the feedback sweep (part 2). Reads the latest run from
 * trainingpeaks_cron_run_logs and prints OK / INFO / ALERT. Exits non-zero on ALERT
 * (failed / stuck / stale / no runs) so it can gate a check or a monitor. Read-only,
 * no notifications. The same `loadFeedbackSweepHealth()` renders an admin indicator.
 *
 * Run: node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *        --env-file=.env.local scripts/check-feedback-sweep-health.ts
 */
import { loadFeedbackSweepHealth } from "@/features/trainingpeaks/feedback/sweep-health";

async function main() {
  const h = await loadFeedbackSweepHealth();
  const tag = h.level === "alert" ? "ALERT" : h.level === "info" ? "INFO" : "OK";
  console.log(`[${tag}] ${h.message}`);
  if (h.lastRun) {
    console.log(`  status=${h.lastRun.status} source=${h.lastRun.source} counts=${JSON.stringify(h.lastRun.counts)}`);
  }
  if (h.level === "alert") process.exit(1);
}

main().catch((e) => { console.error(`check-feedback-sweep-health failed: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
