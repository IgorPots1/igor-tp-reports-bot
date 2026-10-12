/**
 * Еженедельная сводка бота «Забеги России» в ops-log: те же цифры, что /stats у тренера.
 * Зовёт его еженедельный раннер стартов (run-races-weekly.sh); сам бот от Мака не зависит.
 *
 *   npx tsx scripts/races-bot-stats.ts            — напечатать
 *   npx tsx scripts/races-bot-stats.ts --ops-log  — и записать новый файл в ~/ops-log/igor-tp-reports-bot/
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { computeStats } from "@/features/races-bot/runtime";

import { loadScriptEnv, resolveSupabaseEnv } from "./lib/load-script-env";

async function main() {
  loadScriptEnv();
  if (!resolveSupabaseEnv()) throw new Error("нет SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  const now = new Date();
  const s = await computeStats(now);
  const stamp = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Belgrade", dateStyle: "short", timeStyle: "short" }).format(now);
  const lines = [
    `Дата: ${stamp}`,
    "Задача: еженедельная сводка бота «Забеги России» (@ruruns_bot)",
    `Пользователи: ${s.users} (за неделю +${s.usersWeek}), заблокировали ${s.blocked}, дайджест ${s.digest}`,
    `Сохранения: ${s.follows} (за неделю +${s.followsWeek}); заявки на консультацию: ${s.consults} (за неделю ${s.consultsWeek})`,
    `Источники: ${s.sources.length ? s.sources.map(([k, n]) => `${k} ${n}`).join(", ") : "нет"}`,
    "Ветка: нет (сводка из базы)",
  ];
  console.log(lines.join("\n"));
  if (process.argv.includes("--ops-log")) {
    const dir = path.join(os.homedir(), "ops-log", "igor-tp-reports-bot");
    mkdirSync(dir, { recursive: true });
    let file = path.join(dir, `${stamp.replace(" ", "-").replace(":", "")}-races-bot-weekly.md`);
    for (let i = 2; existsSync(file); i++) file = file.replace(/(-\d+)?\.md$/, `-${i}.md`);
    writeFileSync(file, `${lines.join("\n")}\n`);
    console.log(`ops-log: ${file}`);
  }
}

main().catch((e) => {
  console.error(`[races-bot-stats] ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
