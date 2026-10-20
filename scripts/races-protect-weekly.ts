/**
 * Недельный итог защиты /races (наряд 20.10.2026): отказы из журнала race_guard_log за 7 дней
 * («Защита: отказов N, топ-5 источников, предложить заблокировать: …») и найденные копии наших
 * формулировок («Возможная копия: адрес, фраза»). Зовёт его понедельничный раннер
 * run-races-weekly.sh после поиска копий. Ничего не блокирует и никуда не отправляет:
 * блокировки — только по «да» Игоря, правилом в Vercel Firewall.
 *
 *   npx tsx scripts/races-protect-weekly.ts [--copies <copies.json>]            — напечатать
 *   npx tsx scripts/races-protect-weekly.ts [--copies <copies.json>] --ops-log  — и записать новый файл в ~/ops-log/igor-tp-reports-bot/
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { createSupabaseServerClient } from "@/features/supabase/server";
import { copyLines, guardSummary, type CopyHit, type GuardLogRow } from "@/features/race-guard/weekly";
import phrases from "@/features/race-guard/copy-phrases.json";

import { loadScriptEnv, resolveSupabaseEnv } from "./lib/load-script-env";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

async function loadLog(since: Date): Promise<GuardLogRow[]> {
  const sb = createSupabaseServerClient();
  const out: GuardLogRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("race_guard_log")
      .select("minute,kind,ip_masked,ua,path,n")
      .gte("minute", since.toISOString())
      .order("minute")
      .order("ip_masked")
      .range(from, from + 999);
    if (error) throw new Error(`race_guard_log: ${error.message}`);
    out.push(...((data as GuardLogRow[]) || []));
    if (!data || data.length < 1000) return out;
  }
}

/** Итог поиска копий: файл агента [{url, phrase}]. Нет файла или он битый — null («не выполнен»). */
function loadCopies(file: string | undefined): CopyHit[] | null {
  if (!file || !existsSync(file)) return null;
  try {
    const j = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (!Array.isArray(j)) return null;
    return j.filter((x): x is CopyHit => !!x && typeof x.url === "string" && typeof x.phrase === "string");
  } catch {
    return null;
  }
}

async function main() {
  loadScriptEnv();
  if (!resolveSupabaseEnv()) throw new Error("нет SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  const now = new Date();
  const stamp = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Belgrade", dateStyle: "short", timeStyle: "short" }).format(now);
  let guard: string;
  try {
    guard = guardSummary(await loadLog(new Date(now.getTime() - 7 * 86400_000)));
  } catch (e) {
    guard = `Защита: журнал не прочитан (${e instanceof Error ? e.message : String(e)}).`;
  }
  const lines = [
    `Дата: ${stamp}`,
    "Задача: еженедельный итог защиты календаря забегов (/races) от выкачивания",
    guard,
    ...copyLines(loadCopies(arg("copies")), phrases.own),
    "Блокировки — только по «да» Игоря (Vercel → Firewall → правило Deny по IP/подсети).",
    "Ветка: нет (сводка из базы)",
  ];
  console.log(lines.join("\n"));
  if (process.argv.includes("--ops-log")) {
    const dir = path.join(os.homedir(), "ops-log", "igor-tp-reports-bot");
    mkdirSync(dir, { recursive: true });
    let file = path.join(dir, `${stamp.replace(" ", "-").replace(":", "")}-races-protect.md`);
    for (let i = 2; existsSync(file); i++) file = file.replace(/(-\d+)?\.md$/, `-${i}.md`);
    writeFileSync(file, `${lines.join("\n")}\n`);
    console.log(`ops-log: ${file}`);
  }
}

main().catch((e) => {
  console.error(`[races-protect-weekly] ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
