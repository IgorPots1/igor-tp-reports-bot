/**
 * Настройка бота «Забеги России» (@ruruns_bot) одной командой на шаг. Секреты не печатает:
 * токен бота берётся из окружения (tsx --env-file=<.env.local>), в вывод идут только имена
 * переменных и статусы ответов.
 *
 *   npx tsx --env-file=../igor-tp-reports-bot/.env.local scripts/races-bot-setup.ts <команда>
 *
 * Команды:
 *   vercel-env   RACES_BOT_TOKEN, RACES_BOT_USERNAME, COACH_TG_USERNAME → Vercel (production, preview);
 *                проверяет, что SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY там уже есть
 *   cron-key     ключ почасового тика → public.race_bot_config (его читает public.race_bot_tick)
 *   telegram     setMyCommands (ru и по умолчанию), setChatMenuButton «Календарь», setWebhook
 *   info         getWebhookInfo и getMe — без секретов
 */

import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { botToken, botUsername, coachUsername, cronKey, webhookSecret } from "@/features/races-bot/runtime";
import { CALENDAR_URL } from "@/features/races-bot/texts";

const WEBHOOK_URL = "https://igorp.run/api/races-bot/webhook";

const COMMANDS = [
  { command: "start", description: "Начать" },
  { command: "races", description: "Мои забеги" },
  { command: "calendar", description: "Календарь" },
  { command: "city", description: "Мой город" },
  { command: "settings", description: "Настройки" },
  { command: "delete", description: "Удалить мои данные" },
];

async function tg(method: string, params: Record<string, unknown> = {}) {
  const res = await fetch(`https://api.telegram.org/bot${botToken()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const body = (await res.json()) as { ok: boolean; result?: unknown; description?: string };
  console.log(`${method}: ${body.ok ? "ok" : `ОШИБКА ${body.description}`}`);
  if (!body.ok) process.exitCode = 1;
  return body.result;
}

async function cmdTelegram() {
  await tg("setMyCommands", { commands: COMMANDS });
  await tg("setMyCommands", { commands: COMMANDS, language_code: "ru" });
  await tg("setChatMenuButton", { menu_button: { type: "web_app", text: "Календарь", web_app: { url: CALENDAR_URL } } });
  await tg("setWebhook", {
    url: WEBHOOK_URL,
    secret_token: webhookSecret(),
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
  });
}

async function cmdInfo() {
  const me = (await tg("getMe")) as { username?: string } | undefined;
  console.log(`бот: @${me?.username ?? "?"} (ожидается @${botUsername()})`);
  const info = (await tg("getWebhookInfo")) as { url?: string; pending_update_count?: number; last_error_message?: string } | undefined;
  console.log(`webhook: ${info?.url || "не задан"}, в очереди ${info?.pending_update_count ?? 0}${info?.last_error_message ? `, последняя ошибка: ${info.last_error_message}` : ""}`);
  const menu = (await tg("getChatMenuButton")) as { type?: string; text?: string } | undefined;
  console.log(`кнопка меню: ${menu?.type} «${menu?.text ?? ""}»`);
}

async function cmdCronKey() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("нет SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY в окружении");
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await sb.from("race_bot_config").upsert({ key: "cron_key", value: cronKey(), updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(`race_bot_config: ${error.message}`);
  console.log("cron_key записан в race_bot_config");
}

function vercelAuth(): { token: string; projectId: string; teamId: string } {
  const auth = JSON.parse(readFileSync(path.join(os.homedir(), "Library/Application Support/com.vercel.cli/auth.json"), "utf8")) as { token: string };
  const proj = JSON.parse(readFileSync(path.join(process.env.HOME || os.homedir(), "igor-tp-reports-bot/.vercel/project.json"), "utf8")) as {
    projectId: string;
    orgId: string;
  };
  return { token: auth.token, projectId: proj.projectId, teamId: proj.orgId };
}

async function cmdVercelEnv() {
  const v = vercelAuth();
  const base = `https://api.vercel.com`;
  const h = { Authorization: `Bearer ${v.token}`, "Content-Type": "application/json" };
  const want: [string, string][] = [
    ["RACES_BOT_TOKEN", botToken()],
    ["RACES_BOT_USERNAME", botUsername()],
    ["COACH_TG_USERNAME", coachUsername()],
  ];
  for (const [key, value] of want) {
    const res = await fetch(`${base}/v10/projects/${v.projectId}/env?upsert=true&teamId=${v.teamId}`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ key, value, type: "encrypted", target: ["production", "preview"] }),
    });
    console.log(`Vercel ${key}: ${res.ok ? "записан (production, preview)" : `ОШИБКА HTTP ${res.status}`}`);
    if (!res.ok) process.exitCode = 1;
  }
  const list = await fetch(`${base}/v9/projects/${v.projectId}/env?teamId=${v.teamId}`, { headers: h }).then((r) => r.json());
  const names = new Map<string, string[]>();
  for (const e of (list as { envs?: { key: string; target?: string[] }[] }).envs || []) names.set(e.key, e.target || []);
  for (const need of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", ...want.map(([k]) => k)]) {
    const t = names.get(need);
    console.log(`  ${need}: ${t ? t.join(", ") : "НЕТ"}`);
    if (!t?.includes("production")) process.exitCode = 1;
  }
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === "telegram") return cmdTelegram();
  if (cmd === "info") return cmdInfo();
  if (cmd === "cron-key") return cmdCronKey();
  if (cmd === "vercel-env") return cmdVercelEnv();
  console.error("команды: vercel-env | cron-key | telegram | info");
  process.exitCode = 2;
}

main().catch((e) => {
  console.error(`[races-bot-setup] ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
