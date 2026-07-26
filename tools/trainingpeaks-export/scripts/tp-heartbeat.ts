// Pipeline heartbeat — a Mac scan wrapper calls this AFTER its work to record a SUCCESS (or
// failure) in trainingpeaks_cron_run_logs, so the daily pipeline monitor can tell a live flow from
// a silently-stalled one. A heartbeat means "the run finished" with the given status — status=sent
// only when the underlying scan actually succeeded, so a flow that fails every time never looks
// alive. Never throws: a heartbeat write must not change the caller's exit code.
//
// Usage: tsx tp-heartbeat.ts --job=<name> --status=sent|failed [--note="..."]

import { loadLocalEnv } from "./lib/local-env.ts";
loadLocalEnv();

import { createTrainingPeaksCronRunLog } from "../../../src/features/trainingpeaks/repository.ts";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

async function main(): Promise<void> {
  const job = arg("job");
  const status = arg("status") === "failed" ? "failed" : "sent";
  if (!job) {
    console.error("[tp-heartbeat] --job=<name> required");
    return;
  }
  try {
    await createTrainingPeaksCronRunLog({
      // 'manual' is the source the local Mac runners already use (the cron_run_logs check
      // constraint allows only manual / vercel_cron); requestPath tags it as a heartbeat row.
      jobName: job,
      source: "manual",
      status,
      requestPath: "launchd:heartbeat",
      counts: { heartbeat: true, note: arg("note") ?? null },
    });
    console.log(`[tp-heartbeat] ${job} = ${status}`);
  } catch (error) {
    console.error(`[tp-heartbeat] write failed (ignored): ${error instanceof Error ? error.message : String(error)}`);
  }
}

main().then(() => process.exit(0)).catch(() => process.exit(0));
