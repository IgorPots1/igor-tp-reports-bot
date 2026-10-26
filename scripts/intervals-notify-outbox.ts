/**
 * Раннер очереди уведомлений ученицам (intervals_notify_outbox). Раз в 5 минут.
 *
 * Тренер ставит строку в базе (plan_ready / week_updated / coach_reply) — раннер
 * отправляет её ТЕМИ ЖЕ функциями, что кнопки админки, с теми же заслонами.
 *
 *   · выключено по умолчанию: без INTERVALS_NOTIFY_OUTBOX_ENABLED=true очередь
 *     не трогается вовсе, строки лежат pending;
 *   · не больше 5 отправок одной ученице за скользящие сутки, сверх — ждёт;
 *   · --dry-run печатает, что лежит в очереди, и не пишет в базу вообще.
 */
import process from "node:process";

import { listPendingForDryRun } from "@/features/intervals/notify-outbox/dry-run";
import { realOutboxDeps } from "@/features/intervals/notify-outbox/deliver";
import { processOutbox } from "@/features/intervals/notify-outbox/process";

const DRY_RUN = process.argv.includes("--dry-run");

async function main(): Promise<void> {
  const started = new Date();
  if (DRY_RUN) {
    const rows = await listPendingForDryRun();
    console.log(`[outbox] dry-run: в очереди pending ${rows.length}`);
    for (const r of rows) console.log(`  · ${r.id} ${r.kind} ${r.planWeekId ?? r.coachMessageId} — поставил ${r.requestedBy} ${r.requestedAt}`);
    return;
  }
  const summary = await processOutbox(realOutboxDeps({ now: started, log: (line) => console.log(`  · ${line}`) }));
  console.log(
    `[outbox] ${started.toISOString()} флаг=${summary.enabled ? "вкл" : "выкл"} pending=${summary.pending} ` +
      `sent=${summary.sent} skipped=${summary.skipped} failed=${summary.failed} ждут_лимита=${summary.waitingLimit}`,
  );
}

main().catch((error) => {
  console.error("[outbox] упал:", error instanceof Error ? error.message : error);
  process.exit(1);
});
