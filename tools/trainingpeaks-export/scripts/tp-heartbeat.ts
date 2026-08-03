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
import { describeSupabaseError } from "../../../src/features/supabase/server.ts";

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
    // НЕ "(ignored)". Раннер свою работу сделал — упала только отметка о ней, и это ровно тот
    // случай, когда молчание опаснее сбоя: 2026-08-03 отсутствие строк в trainingpeaks_cron_run_logs
    // читалось как «раннер не отработал», хотя он отработал и не смог отметиться. Строка ниже
    // говорит обе вещи прямо и печатает полный текст ошибки (было «undefined» вместо кода PostgREST).
    //
    // Код выхода по-прежнему 0: работа важнее отметки, и провал хартбита не должен ронять раннер.
    console.error(
      `[tp-heartbeat] РАБОТА ВЫПОЛНЕНА (${job} = ${status}), НО ОТМЕТКА НЕ ЗАПИСАНА — ` +
        `в trainingpeaks_cron_run_logs строки не будет, не считать это простоем раннера. ` +
        `Причина: ${describeSupabaseError(error)}`
    );
  }
}

main().then(() => process.exit(0)).catch(() => process.exit(0));
