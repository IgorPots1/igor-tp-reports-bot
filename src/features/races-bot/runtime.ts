/* Боевые зависимости бота «Забеги России»: Bot API, хранилище в Supabase, старты из view
 * race_calendar, погода Open-Meteo и геокодер. Всё серверное: токен бота и ключ сервисной
 * роли сюда приходят из окружения Vercel и наружу не уходят. */

import { createHmac } from "node:crypto";

import { prepare, type RaceRow } from "@/app/races/races-logic";
import { createSupabaseServerClient } from "@/features/supabase/server";

import { BotBlockedError, createBot, type BotFollow, type BotStats, type BotStore, type BotTg, type BotUser } from "./bot";
import { localParts, type BotRace } from "./core";
import type { Weather } from "./texts";

export function botToken(): string {
  const t = process.env.RACES_BOT_TOKEN?.trim();
  if (!t) throw new Error("RACES_BOT_TOKEN не задан");
  return t;
}

export function botUsername(): string {
  return (process.env.RACES_BOT_USERNAME || "ruruns_bot").trim().replace(/^@/, "");
}

export function coachUsername(): string {
  return (process.env.COACH_TG_USERNAME || "IgorPotseluev").trim().replace(/^@/, "");
}

/** secret_token для setWebhook и проверки входящих: выводится из токена, отдельной переменной не нужно. */
export function webhookSecret(token = botToken()): string {
  return createHmac("sha256", token).update("races-bot-webhook").digest("base64url").slice(0, 48);
}

/** Ключ почасового тика (pg_cron → /api/races-bot/cron): тоже из токена; копия лежит в race_bot_config. */
export function cronKey(token = botToken()): string {
  return createHmac("sha256", token).update("races-bot-cron").digest("base64url").slice(0, 48);
}

// ── Bot API ──────────────────────────────────────────────────────────────────

export const tgApi: BotTg = {
  async call(method, params) {
    const res = await fetch(`https://api.telegram.org/bot${botToken()}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: unknown; error_code?: number; description?: string };
    if (body.ok) return body.result;
    // 403: человек заблокировал бота — дальше ему не пишем (bot.ts помечает blocked).
    if (body.error_code === 403) throw new BotBlockedError(body.description || "blocked");
    throw new Error(`Telegram ${method}: ${body.error_code ?? res.status} ${body.description ?? ""}`.trim());
  },
};

// ── старты ───────────────────────────────────────────────────────────────────

const COLUMNS =
  "id,source,source_url,name,date_start,date_end,city,region,distances,dist_km,race_type,tags,site_url,reg_url,vk_url,sources,link_ok,alt_dates,checked_note,first_seen";

let racesCache: { at: number; races: BotRace[] } | null = null;

/** Предстоящие старты из view race_calendar (как на сайте) плюс first_seen для дайджеста. Кэш 10 минут на инстанс. */
export async function loadBotRaces(): Promise<BotRace[]> {
  if (racesCache && Date.now() - racesCache.at < 10 * 60 * 1000) return racesCache.races;
  const sb = createSupabaseServerClient();
  const rows: (RaceRow & { first_seen: string | null })[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("race_calendar")
      .select(COLUMNS)
      .order("date_start")
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(`race_calendar: ${error.message}`);
    rows.push(...((data as unknown as (RaceRow & { first_seen: string | null })[]) || []));
    if (!data || data.length < 1000) break;
  }
  const firstSeen = new Map(rows.map((r) => [r.id, r.first_seen]));
  const races = prepare(rows, localParts(new Date(), "Europe/Moscow").date).map((r) => ({ ...r, firstSeen: firstSeen.get(r.id) ?? null }));
  racesCache = { at: Date.now(), races };
  return races;
}

// ── хранилище ────────────────────────────────────────────────────────────────

const USER_COLS =
  "tg_id,first_name,username,city,types,distances,digest_on,digest_every_weeks,digest_last_at,paused_until,tz,source,state,consult_offered_at,consult_requested_at,blocked,created_at";
const FOLLOW_COLS = "tg_id,race_id,race_name,race_date,race_end,race_city,created_at";

function fail(what: string, e: { message: string } | null): void {
  if (e) throw new Error(`[races-bot] ${what}: ${e.message}`);
}

export const supabaseStore: BotStore = {
  async getUser(tgId) {
    const { data, error } = await createSupabaseServerClient().from("race_bot_users").select(USER_COLS).eq("tg_id", tgId).maybeSingle();
    fail("getUser", error);
    return (data as unknown as BotUser) ?? null;
  },
  async saveUser(patch) {
    const { data, error } = await createSupabaseServerClient()
      .from("race_bot_users")
      .upsert({ ...patch, updated_at: new Date().toISOString() }, { onConflict: "tg_id" })
      .select(USER_COLS)
      .single();
    fail("saveUser", error);
    return data as unknown as BotUser;
  },
  async deleteUser(tgId) {
    const sb = createSupabaseServerClient();
    fail("deleteUser follows", (await sb.from("race_bot_follows").delete().eq("tg_id", tgId)).error);
    fail("deleteUser sends", (await sb.from("race_bot_sends").delete().eq("tg_id", tgId)).error);
    fail("deleteUser", (await sb.from("race_bot_users").delete().eq("tg_id", tgId)).error);
  },
  async listFollows(tgId) {
    const { data, error } = await createSupabaseServerClient().from("race_bot_follows").select(FOLLOW_COLS).eq("tg_id", tgId).order("race_date");
    fail("listFollows", error);
    return (data as unknown as BotFollow[]) ?? [];
  },
  async addFollow(tgId, r) {
    const { error } = await createSupabaseServerClient()
      .from("race_bot_follows")
      .upsert(
        { tg_id: tgId, race_id: r.id, race_name: r.name, race_date: r.ds, race_end: r.de, race_city: r.city || null },
        { onConflict: "tg_id,race_id", ignoreDuplicates: true },
      );
    fail("addFollow", error);
  },
  async removeFollow(tgId, raceId) {
    fail("removeFollow", (await createSupabaseServerClient().from("race_bot_follows").delete().eq("tg_id", tgId).eq("race_id", raceId)).error);
  },
  async removeAllFollows(tgId) {
    fail("removeAllFollows", (await createSupabaseServerClient().from("race_bot_follows").delete().eq("tg_id", tgId)).error);
  },
  async getConfig(key) {
    const { data, error } = await createSupabaseServerClient().from("race_bot_config").select("value").eq("key", key).maybeSingle();
    fail("getConfig", error);
    return (data as { value: string } | null)?.value ?? null;
  },
  async setConfig(key, value) {
    fail(
      "setConfig",
      (await createSupabaseServerClient().from("race_bot_config").upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" })).error,
    );
  },
  async claimSend(tgId, kind, raceId) {
    const sb = createSupabaseServerClient();
    if (raceId === null) {
      fail("claimSend", (await sb.from("race_bot_sends").insert({ tg_id: tgId, kind, race_id: null })).error);
      return true;
    }
    const { data, error } = await sb
      .from("race_bot_sends")
      .upsert({ tg_id: tgId, kind, race_id: raceId }, { onConflict: "tg_id,kind,race_id", ignoreDuplicates: true })
      .select("id");
    fail("claimSend", error);
    return (data || []).length > 0;
  },
  async releaseSend(tgId, kind, raceId) {
    let q = createSupabaseServerClient().from("race_bot_sends").delete().eq("tg_id", tgId).eq("kind", kind);
    q = raceId === null ? q.is("race_id", null) : q.eq("race_id", raceId);
    fail("releaseSend", (await q).error);
  },
  async listActiveUsers() {
    const { data, error } = await createSupabaseServerClient().from("race_bot_users").select(USER_COLS).eq("blocked", false);
    fail("listActiveUsers", error);
    return (data as unknown as BotUser[]) ?? [];
  },
  async listAllFollows() {
    const { data, error } = await createSupabaseServerClient().from("race_bot_follows").select(FOLLOW_COLS);
    fail("listAllFollows", error);
    return (data as unknown as BotFollow[]) ?? [];
  },
  async listSentKeys() {
    const { data, error } = await createSupabaseServerClient().from("race_bot_sends").select("tg_id,kind,race_id").not("race_id", "is", null);
    fail("listSentKeys", error);
    const out = new Map<number, Set<string>>();
    for (const r of (data as { tg_id: number; kind: string; race_id: string }[]) || []) {
      if (!out.has(r.tg_id)) out.set(r.tg_id, new Set());
      out.get(r.tg_id)!.add(`${r.kind}:${r.race_id}`);
    }
    return out;
  },
  async stats(now) {
    return computeStats(now);
  },
};

export async function computeStats(now: Date): Promise<BotStats> {
  const sb = createSupabaseServerClient();
  const week = new Date(now.getTime() - 7 * 864e5).toISOString();
  const { data: users, error } = await sb.from("race_bot_users").select("created_at,source,blocked,digest_on,consult_requested_at");
  fail("stats users", error);
  const { data: follows, error: e2 } = await sb.from("race_bot_follows").select("created_at");
  fail("stats follows", e2);
  const u = (users as { created_at: string; source: string | null; blocked: boolean; digest_on: boolean; consult_requested_at: string | null }[]) || [];
  const f = (follows as { created_at: string }[]) || [];
  const src = new Map<string, number>();
  for (const x of u) src.set(x.source || "без метки", (src.get(x.source || "без метки") || 0) + 1);
  return {
    users: u.length,
    usersWeek: u.filter((x) => x.created_at >= week).length,
    blocked: u.filter((x) => x.blocked).length,
    digest: u.filter((x) => x.digest_on).length,
    follows: f.length,
    followsWeek: f.filter((x) => x.created_at >= week).length,
    consults: u.filter((x) => x.consult_requested_at).length,
    consultsWeek: u.filter((x) => x.consult_requested_at && x.consult_requested_at >= week).length,
    sources: [...src.entries()].sort((a, b) => b[1] - a[1]),
  };
}

// ── погода и геокодер ────────────────────────────────────────────────────────

/** Open-Meteo без ключа: координаты через их геокодер, дневной прогноз на день старта. */
export async function openMeteoWeather(city: string, dateIso: string): Promise<Weather | null> {
  const g = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=ru&countryCode=RU`,
  ).then((r) => (r.ok ? r.json() : null));
  const place = (g as { results?: { latitude: number; longitude: number }[] } | null)?.results?.[0];
  if (!place) return null;
  const f = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max` +
      `&wind_speed_unit=ms&timezone=auto&start_date=${dateIso}&end_date=${dateIso}`,
  ).then((r) => (r.ok ? r.json() : null));
  const d = (f as { daily?: Record<string, (number | null)[]> } | null)?.daily;
  if (!d || d.temperature_2m_max?.[0] == null || d.temperature_2m_min?.[0] == null) return null;
  return {
    tMax: d.temperature_2m_max[0] as number,
    tMin: d.temperature_2m_min[0] as number,
    rainProb: d.precipitation_probability_max?.[0] ?? null,
    windMax: d.wind_speed_10m_max?.[0] ?? null,
  };
}

/** Город по геолокации: Nominatim (OpenStreetMap), по-русски. Одна точка на нажатие, в духе их правил. */
export async function nominatimCity(lat: number, lon: number): Promise<string | null> {
  const r = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=10&accept-language=ru`,
    { headers: { "User-Agent": "igorp.run races bot (+https://igorp.run/races)" } },
  ).catch(() => null);
  if (!r || !r.ok) return null;
  const a = ((await r.json()) as { address?: Record<string, string> }).address || {};
  return a.city || a.town || a.village || a.municipality || a.state || null;
}

export function productionBot() {
  return createBot({
    store: supabaseStore,
    tg: tgApi,
    races: loadBotRaces,
    coachUsername: coachUsername(),
    reverseGeocode: nominatimCity,
    weather: openMeteoWeather,
  });
}
