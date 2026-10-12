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

import { loadBotStats } from "@/features/races-bot/runtime";

import { loadScriptEnv, resolveSupabaseEnv } from "./lib/load-script-env";

async function main() {
  loadScriptEnv();
  if (!resolveSupabaseEnv()) throw new Error("нет SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  const now = new Date();
  const s = await loadBotStats(7, now);
  const m = await loadBotStats(30, now);
  const stamp = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Belgrade", dateStyle: "short", timeStyle: "short" }).format(now);
  const funnel = m.funnel.map((f) => `${f.label} ${f.people} (${f.pct}%)`).join(" → ");
  const lines = [
    `Дата: ${stamp}`,
    "Задача: еженедельная сводка бота «Забеги России» (@ruruns_bot), те же цифры, что /stats",
    `Пользователи: ${s.users.total}, новые 7 дн ${s.users.new7}, 30 дн ${s.users.new30}; активные 7 дн ${s.users.active7}; заблокировали ${s.users.blocked}; отписались за 7 дн ${s.users.unsubscribed}`,
    `Воронка 30 дн: ${funnel}`,
    `Источники 30 дн (пришли/«Следить»/заявка): ${m.sources.length ? m.sources.map((x) => `${x.source} ${x.users}/${x.follow}/${x.consult}`).join(", ") : "нет"}`,
    `Клики 7/30 дн: регистрация ${s.clicks.registration.d7}/${s.clicks.registration.d30}, сайт ${s.clicks.site.d7}/${s.clicks.site.d30}, календарь ${s.clicks.calendar.d7}/${s.clicks.calendar.d30}; заявок за всё время ${m.consults.length >= 10 ? "10+" : m.consults.length}`,
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
