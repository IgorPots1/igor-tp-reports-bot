/* Боевые зависимости пробной недели: Bot API ОСНОВНОГО бота (TELEGRAM_BOT_TOKEN), хранилище
 * в Supabase (таблицы trial_bot_*), библиотека тренировок. Всё серверное. */

import { createHmac, timingSafeEqual } from "node:crypto";

import { getTrainingPeaksCoachChatIds } from "@/features/trainingpeaks/attention-telegram";
import { fetchAllRows } from "@/features/supabase/paginate";
import { createSupabaseServerClient, describeSupabaseError } from "@/features/supabase/server";
import { assertNotPreviewEnvironment } from "@/lib/environment-guard";

import { createTrialBot, TrialBlockedError, type TrialSession, type TrialStore, type TrialTg, type TrialUser } from "./bot";
import { isTrialEnabled } from "./logic";
import type { Keyboard } from "./texts";
import { loadLibrary } from "./workouts";

function botToken(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN не задан");
  return t;
}

/** Ключ тика (pg_cron → /api/trial-bot/cron, заголовок x-cron-key): выводится из токена бота; копия в trial_bot_config. */
export function trialCronKey(token = botToken()): string {
  return createHmac("sha256", token).update("trial-bot-cron").digest("base64url").slice(0, 48);
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Пускаем тик с x-cron-key (pg_cron) или с Authorization: Bearer CRON_SECRET (как billing-email-import). */
export function isAuthorizedTrialCron(request: Request): boolean {
  const key = request.headers.get("x-cron-key")?.trim();
  if (key) {
    try {
      return safeEqual(key, trialCronKey());
    } catch {
      return false;
    }
  }
  const secret = process.env.CRON_SECRET?.trim();
  const auth = request.headers.get("authorization")?.trim() ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  return Boolean(secret && bearer && safeEqual(bearer, secret));
}

// ── Telegram ─────────────────────────────────────────────────────────────────

function markup(kb?: Keyboard) {
  if (!kb || kb.length === 0) return undefined;
  return {
    inline_keyboard: kb.map((row) =>
      row.map((b) => ("url" in b ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.data })),
    ),
  };
}

async function call(method: string, body: Record<string, unknown>): Promise<{ message_id?: number } | null> {
  assertNotPreviewEnvironment(`Telegram ${method} (trial-bot)`);
  const res = await fetch(`https://api.telegram.org/bot${botToken()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: { ok?: boolean; description?: string; result?: unknown } = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    // ответ не JSON: решаем по статусу
  }
  if (res.status === 403 || /bot was blocked|user is deactivated|chat not found/i.test(json.description ?? "")) {
    throw new TrialBlockedError(json.description ?? `HTTP ${res.status}`);
  }
  if (!res.ok || json.ok === false) {
    // «message is not modified» при повторном нажатии: не ошибка
    if (/message is not modified/i.test(json.description ?? "")) return null;
    throw new Error(`Telegram ${method} failed (${res.status}): ${json.description ?? text.slice(0, 200)}`);
  }
  return (json.result as { message_id?: number } | undefined) ?? null;
}

export const botApiTg: TrialTg = {
  async send(chatId, text, kb) {
    const r = await call("sendMessage", { chat_id: chatId, text, reply_markup: markup(kb), link_preview_options: { is_disabled: true } });
    return typeof r?.message_id === "number" ? r.message_id : null;
  },
  async edit(chatId, messageId, text, kb) {
    try {
      await call("editMessageText", { chat_id: chatId, message_id: messageId, text, reply_markup: markup(kb) });
    } catch (e) {
      if (e instanceof TrialBlockedError) throw e;
      // Сообщение старше 48 часов или удалено: присылаем заново, чтобы человек не застрял.
      await this.send(chatId, text, kb);
    }
  },
  async sendPhoto(chatId, photoUrl, caption) {
    const r = await call("sendPhoto", { chat_id: chatId, photo: photoUrl, caption });
    return typeof r?.message_id === "number" ? r.message_id : null;
  },
  async answer(callbackQueryId, text) {
    try {
      await call("answerCallbackQuery", { callback_query_id: callbackQueryId, text });
    } catch {
      // ответ на нажатие не важнее самого действия
    }
  },
};

// ── Supabase ─────────────────────────────────────────────────────────────────

const SCHEDULED_STAGES = ["test", "week", "post"];

function check(error: unknown, what: string): void {
  if (error) throw new Error(`[trial-bot] ${what}: ${describeSupabaseError(error)}`);
}

export const supabaseTrialStore: TrialStore = {
  async getUser(id) {
    const { data, error } = await createSupabaseServerClient().from("trial_bot_users").select("*").eq("telegram_user_id", id).maybeSingle();
    check(error, "getUser");
    return (data as TrialUser | null) ?? null;
  },
  async saveUser(patch) {
    const { error } = await createSupabaseServerClient()
      .from("trial_bot_users")
      .upsert({ ...patch, updated_at: new Date().toISOString() }, { onConflict: "telegram_user_id" });
    check(error, "saveUser");
  },
  async listScheduled() {
    const sb = createSupabaseServerClient();
    return fetchAllRows<TrialUser>(
      async (from, to) =>
        (await sb
          .from("trial_bot_users")
          .select("*")
          .in("stage", SCHEDULED_STAGES)
          .is("stopped_at", null)
          .order("telegram_user_id", { ascending: true })
          .range(from, to)) as { data: TrialUser[] | null; error: { message: string } | null },
      { label: "trial_bot_users.scheduled" },
    );
  },
  async getSessions(id) {
    const { data, error } = await createSupabaseServerClient()
      .from("trial_bot_sessions")
      .select("*")
      .eq("telegram_user_id", id)
      .order("idx", { ascending: true });
    check(error, "getSessions");
    return (data ?? []) as TrialSession[];
  },
  async replaceSessions(id, rows) {
    const sb = createSupabaseServerClient();
    const del = await sb.from("trial_bot_sessions").delete().eq("telegram_user_id", id);
    check(del.error, "replaceSessions.delete");
    if (rows.length) {
      const ins = await sb.from("trial_bot_sessions").insert(rows);
      check(ins.error, "replaceSessions.insert");
    }
  },
  async updateSession(id, idx, patch) {
    const { error } = await createSupabaseServerClient()
      .from("trial_bot_sessions")
      .update(patch)
      .eq("telegram_user_id", id)
      .eq("idx", idx);
    check(error, "updateSession");
  },
  async claimSend(id, key) {
    const { error } = await createSupabaseServerClient().from("trial_bot_sends").insert({ telegram_user_id: id, send_key: key });
    if (!error) return true;
    if ((error as { code?: string }).code === "23505") return false; // уже отправлено
    throw new Error(`[trial-bot] claimSend: ${describeSupabaseError(error)}`);
  },
  async releaseSend(id, key) {
    const { error } = await createSupabaseServerClient().from("trial_bot_sends").delete().eq("telegram_user_id", id).eq("send_key", key);
    check(error, "releaseSend");
  },
  async logEvent(id, kind, meta) {
    // Событие воронки не важнее самого действия: ошибка записи только в лог.
    const { error } = await createSupabaseServerClient()
      .from("trial_bot_events")
      .insert({ telegram_user_id: id, kind, meta: meta ?? {} });
    if (error) console.warn(`[trial-bot] logEvent ${kind}: ${describeSupabaseError(error)}`);
  },
};

export function trialLandingUrl(): string | null {
  const v = process.env.TRIAL_BASE_LANDING_URL?.trim();
  return v && /^https:\/\//.test(v) ? v : null;
}

export function productionTrialBot() {
  return createTrialBot({
    store: supabaseTrialStore,
    tg: botApiTg,
    now: () => new Date(),
    library: loadLibrary,
    coachChatId: getTrainingPeaksCoachChatIds()[0] ?? null,
    landingUrl: trialLandingUrl(),
  });
}

export { isTrialEnabled };
