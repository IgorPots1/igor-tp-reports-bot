// Export-failure monitor — так тихие «никогда не качаются» становятся видны.
// Читает вывод fit-ingest (--log=<path>), выделяет учеников со status=failed, ведёт счётчик
// ПОДРЯД-провалов в app_runtime_flags (key fit_ingest_failure_streaks, JSON {name: count}).
// Когда ученик впервые достигает порога N подряд (default 3) — шлёт Игорю Telegram-список.
// Успешный прогон обнуляет счётчик ученика. Алерт только на ПЕРЕСЕЧЕНИИ порога (== N), не
// каждый раз после — чтобы не спамить по стабильному 403.
//
// Никогда не роняет вызывающего (обёртку): все ошибки глотаются, exit 0.

import { readFileSync } from "node:fs";

import { loadLocalEnv } from "./lib/local-env.ts";

loadLocalEnv();

import { getRuntimeFlag, setRuntimeFlag } from "../../../src/features/trainingpeaks/feedback/app-runtime-flags.ts";

const FLAG_KEY = "fit_ingest_failure_streaks";
const ALERT_STREAK = Number(process.env.FIT_INGEST_FAIL_STREAK ?? "3");

function parseLogPath(): string | null {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--log=")) return arg.slice("--log=".length);
  }
  return null;
}

function failedStudents(logText: string): string[] {
  const names = new Set<string>();
  for (const line of logText.split(/\r?\n/)) {
    const m = line.match(/^- (.+?): status=failed/u);
    if (m) names.add(m[1]!.trim());
  }
  return [...names];
}

async function sendAlert(message: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = (process.env.TELEGRAM_COACH_CHAT_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!token || chatIds.length === 0) {
    console.error("[tp-export-failure-monitor] no TELEGRAM_BOT_TOKEN/COACH_CHAT_IDS — cannot alert:", message);
    return;
  }
  for (const chatId of chatIds) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: message }),
      });
      if (!res.ok) console.error(`[tp-export-failure-monitor] alert to ${chatId} failed: HTTP ${res.status}`);
    } catch (error) {
      console.error(`[tp-export-failure-monitor] alert error:`, error instanceof Error ? error.message : String(error));
    }
  }
}

async function main(): Promise<void> {
  const logPath = parseLogPath();
  if (!logPath) return;
  let logText = "";
  try {
    logText = readFileSync(logPath, "utf8");
  } catch {
    return;
  }
  const failedNow = new Set(failedStudents(logText));

  // Load prior streaks.
  let streaks: Record<string, number> = {};
  try {
    const raw = await getRuntimeFlag(FLAG_KEY);
    if (raw) streaks = JSON.parse(raw) as Record<string, number>;
  } catch {
    streaks = {};
  }

  // A run that produced NO per-student lines at all (e.g. a total early crash) — don't
  // reset everyone to 0 on a blank log, that would hide a real outage. Only update when
  // we actually saw student outcomes.
  const sawOutcomes = /status=(ok|failed)/u.test(logText);
  if (!sawOutcomes) return;

  const next: Record<string, number> = {};
  const justCrossed: string[] = [];
  for (const name of failedNow) {
    const n = (streaks[name] ?? 0) + 1;
    next[name] = n;
    if (n === ALERT_STREAK) justCrossed.push(name); // alert once, on crossing
  }
  // Students not in failedNow implicitly reset (dropped from the map).

  try {
    await setRuntimeFlag({ key: FLAG_KEY, value: JSON.stringify(next), actorChatId: "system:fit-ingest-monitor" });
  } catch {
    /* persistence best-effort */
  }

  if (justCrossed.length > 0) {
    await sendAlert(
      `🚫 Стабильно НЕ качаются (${ALERT_STREAK}+ прогонов подряд): ${justCrossed.join(", ")}.\n` +
        `Проверь экспорт в TrainingPeaks (частая причина — HTTP 403, доступ к экспорту закрыт).`
    );
  }
}

main().catch(() => {}).finally(() => process.exit(0));
