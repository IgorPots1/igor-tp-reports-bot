/* Боевые зависимости бота «Забеги России»: Bot API, хранилище в Supabase, старты из view
 * race_calendar, погода Open-Meteo и геокодер. Всё серверное: токен бота и ключ сервисной
 * роли сюда приходят из окружения Vercel и наружу не уходят. */

import { after } from "next/server";
import { createHmac } from "node:crypto";

import { prepare, type RaceRow } from "@/app/races/races-logic";
import { createSupabaseServerClient } from "@/features/supabase/server";

import { BotBlockedError, createBot, type BotFollow, type BotStore, type BotTg, type BotUser } from "./bot";
import { localParts, raceCode, type BotRace, type ExpectedItem, type GoCode } from "./core";
import { loadGeoRows, toExpected, withGeo } from "@/app/races/expected";
import type { FullRow } from "@/features/race-details/full";
import { computeBotStats, type StatEvent, type StatFollow, type StatPeriod, type StatUser } from "./stats";
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

/** Подпись ссылки /go/: клик засчитывается тому tg_id, для кого ссылка выдана. */
function goSig(kind: string, code: string, uid36: string, token = botToken()): string {
  return createHmac("sha256", token).update(`go:${kind}${code}-${uid36}`).digest("hex").slice(0, 10);
}

export function goLink(tgId: number, r: BotRace, kind: "r" | "s"): string {
  const code = raceCode(r.id);
  const uid36 = Math.abs(tgId).toString(36);
  return `https://igorp.run/go/${kind}${code}-${uid36}-${goSig(kind, code, uid36)}`;
}

/** tg_id из ссылки, если подпись верна; иначе клик анонимный (переход всё равно делаем). */
export function goUser(g: GoCode): number | null {
  if (g.uid === null || !g.sig) return null;
  return goSig(g.kind, g.code, g.uid.toString(36)) === g.sig ? g.uid : null;
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
  "id,source,source_url,name,date_start,date_end,city,region,distances,dist_km,race_type,tags,site_url,reg_url,vk_url,sources,link_ok,alt_dates,checked_note,first_seen,subject,lat,lon";

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
  // Точка и субъект города — из самого race_calendar (race_geo_point), как у сайта.
  const races = prepare(rows, localParts(new Date(), "Europe/Moscow").date).map((r) => ({ ...r, firstSeen: firstSeen.get(r.id) ?? null }));
  racesCache = { at: Date.now(), races };
  return races;
}

// ── выжимка по стартам ─────────────────────────────────────────────────────────

const detailsCache = new Map<string, { at: number; rows: FullRow[] }>();
let detailsBroken = false;

/** Выжимка по старту из race_details (блок «Важное»). Кэш 10 минут на инстанс. Таблицы ещё нет или
 *  чтение упало — пусто и одна строка в лог: карточка показывается без блока. */
export async function loadRaceDetails(raceId: string): Promise<FullRow[]> {
  const hit = detailsCache.get(raceId);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.rows;
  const { data, error } = await createSupabaseServerClient().from("race_details").select("distance,field,value,source_url,checked_at").eq("race_id", raceId);
  if (error) {
    if (!detailsBroken) console.error(`[races-bot] race_details: ${error.message}`);
    detailsBroken = true;
    return [];
  }
  const rows = ((data ?? []) as { distance: number | string | null; field: string; value: string; source_url: string | null; checked_at: string | null }[]).map((r) => ({ ...r, distance: r.distance == null ? null : Number(r.distance) }));
  detailsCache.set(raceId, { at: Date.now(), rows });
  return rows;
}

let cancelledCache: { at: number; ids: Set<string> } | null = null;

/** Отменённые вручную старты (race_overrides.status = cancelled): в «Моих стартах» с пометкой «отменён».
 *  Кэш 10 минут. Чтение упало — пусто и строка в лог (как до 15.10.2026: старт пропадает). */
export async function loadCancelledRaceIds(): Promise<Set<string>> {
  if (cancelledCache && Date.now() - cancelledCache.at < 10 * 60 * 1000) return cancelledCache.ids;
  const { data, error } = await createSupabaseServerClient().from("race_overrides").select("id").eq("status", "cancelled");
  if (error) {
    console.error(`[races-bot] race_overrides cancelled: ${error.message}`);
    return new Set();
  }
  const ids = new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
  cancelledCache = { at: Date.now(), ids };
  return ids;
}

// ── хранилище ────────────────────────────────────────────────────────────────

const USER_COLS =
  "tg_id,first_name,username,city,types,distances,digest_on,digest_every_weeks,digest_last_at,paused_until,tz,source,state,consult_offered_at,consult_requested_at,blocked,created_at,star_hint_at,geo_lat,geo_lon,menu_message_id,menu_message_at,browse_ctx,rich_off,webapp_version";
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
    fail("deleteUser events", (await sb.from("race_bot_events").delete().eq("tg_id", tgId)).error);
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
    // Обычная вставка: уникальный индекс частичный (where race_id is not null), и ON CONFLICT
    // через PostgREST его не выводит. Конфликт 23505 = уже отправляли.
    const { error } = await sb.from("race_bot_sends").insert({ tg_id: tgId, kind, race_id: raceId });
    if (error && (error as { code?: string }).code === "23505") return false;
    fail("claimSend", error);
    return true;
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
  async logEvent(tgId, event, opts) {
    const { error } = await createSupabaseServerClient()
      .from("race_bot_events")
      .insert({ tg_id: tgId, event, race_id: opts?.raceId ?? null, source: opts?.source ?? null, meta: opts?.meta ?? {} });
    fail("logEvent", error);
  },
  async loadStats(period, now) {
    return loadBotStats(period, now);
  },
  async seenOnce(key, windowSec) {
    const { data, error } = await createSupabaseServerClient().rpc("race_bot_seen_once", { p_key: key, p_window_sec: windowSec });
    fail("seenOnce", error);
    return data === true;
  },
  async listNudgeCandidates(fromIso, toIso) {
    const sb = createSupabaseServerClient();
    const { data, error } = await sb
      .from("race_bot_users")
      .select(USER_COLS)
      .gte("created_at", fromIso)
      .lte("created_at", toIso)
      .is("city", null)
      .eq("blocked", false);
    fail("listNudgeCandidates", error);
    const users = (data ?? []) as unknown as BotUser[];
    if (!users.length) return [];
    // Что-то нажал (город, календарь, «Выбрать город», ⭐, поиск…) — любое событие кроме start.
    const ev = await sb.from("race_bot_events").select("tg_id").in("tg_id", users.map((u) => u.tg_id)).neq("event", "start");
    fail("listNudgeCandidates events", ev.error);
    const acted = new Set(((ev.data ?? []) as { tg_id: number }[]).map((e) => Number(e.tg_id)));
    return users.filter((u) => !acted.has(Number(u.tg_id)));
  },
  async pruneSeen() {
    const old = new Date(Date.now() - 3 * 864e5).toISOString();
    fail("pruneSeen", (await createSupabaseServerClient().from("race_bot_seen").delete().lt("at", old)).error);
  },
  async addExpectedWatch(tgId, expectedId) {
    const { error } = await createSupabaseServerClient()
      .from("race_bot_expected_watch")
      .upsert({ tg_id: tgId, expected_id: expectedId }, { onConflict: "tg_id,expected_id", ignoreDuplicates: true });
    fail("addExpectedWatch", error);
  },
  async listExpectedWatches(tgId) {
    const { data, error } = await createSupabaseServerClient().from("race_bot_expected_watch").select("expected_id").eq("tg_id", tgId).is("notified_at", null);
    fail("listExpectedWatches", error);
    return ((data as { expected_id: string }[]) || []).map((r) => r.expected_id);
  },
  async listDueAnnouncements() {
    const { data, error } = await createSupabaseServerClient()
      .from("race_bot_expected_watch")
      .select("id,tg_id,expected_id,race_expected!inner(status,race_id)")
      .is("notified_at", null)
      .eq("race_expected.status", "announced");
    fail("listDueAnnouncements", error);
    return ((data as unknown as { id: number; tg_id: number; expected_id: string; race_expected: { race_id: string | null } }[]) || [])
      .filter((r) => r.race_expected?.race_id)
      .map((r) => ({ id: r.id, tg_id: r.tg_id, expected_id: r.expected_id, race_id: r.race_expected.race_id as string }));
  },
  async markWatchNotified(id) {
    fail("markWatchNotified", (await createSupabaseServerClient().from("race_bot_expected_watch").update({ notified_at: new Date().toISOString() }).eq("id", id)).error);
  },
};

let expectedCache: { at: number; items: ExpectedItem[] } | null = null;

/** Ожидаемые старты для бота (status = expected). Кэш 10 минут на инстанс. */
export async function loadBotExpected(): Promise<ExpectedItem[]> {
  if (expectedCache && Date.now() - expectedCache.at < 10 * 60 * 1000) return expectedCache.items;
  const sb = createSupabaseServerClient();
  const items: ExpectedItem[] = [];
  // Область и точка для «Ожидаются» по области и радиусу; сбой чтения — без них, как раньше.
  const geo = await loadGeoRows().catch(() => new Map());
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("race_expected")
      .select("id,name,city,region,race_type,distances,last_month,last_date,last_url,site_url")
      .eq("status", "expected")
      .range(from, from + 999);
    fail("race_expected", error);
    items.push(...((data as Parameters<typeof toExpected>[0][]) || []).map((r) => withGeo(toExpected(r), geo)));
    if (!data || data.length < 1000) break;
  }
  expectedCache = { at: Date.now(), items };
  return items;
}

async function selectAll<T>(table: string, cols: string): Promise<T[]> {
  const sb = createSupabaseServerClient();
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(cols).order("created_at").range(from, from + 999);
    fail(`stats ${table}`, error);
    out.push(...((data as unknown as T[]) || []));
    if (!data || data.length < 1000) return out;
  }
}

/** Статистика бота за период: /stats, админка и еженедельная сводка — одним расчётом (stats.ts). */
export async function loadBotStats(period: StatPeriod, now = new Date()) {
  const [users, events, follows, exclude] = await Promise.all([
    selectAll<StatUser>("race_bot_users", "tg_id,first_name,username,city,source,created_at,blocked"),
    selectAll<StatEvent>("race_bot_events", "tg_id,event,race_id,source,meta,created_at"),
    selectAll<StatFollow>("race_bot_follows", "tg_id,race_id,race_name,race_city,created_at"),
    statsExclude(),
  ]);
  return computeBotStats({ users, events, follows, now, period, exclude });
}

/** Кого не считать: тренер (coach_chat_id) всегда, плюс race_bot_config.stats_exclude (фейковые тестовые tg_id). */
export async function statsExclude(): Promise<Set<number>> {
  const out = new Set<number>();
  for (const key of ["coach_chat_id", "stats_exclude"]) {
    const v = await supabaseStore.getConfig(key);
    for (const x of (v || "").split(/[\s,;]+/)) if (/^-?\d+$/.test(x)) out.add(Number(x));
  }
  return out;
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
    details: loadRaceDetails,
    cancelled: loadCancelledRaceIds,
    expected: loadBotExpected,
    coachUsername: coachUsername(),
    reverseGeocode: nominatimCity,
    weather: openMeteoWeather,
    goLink,
    // события статистики — после ответа человеку (after из next/server); вне запроса — сразу
    defer: (fn) => {
      try {
        after(fn);
      } catch {
        void fn();
      }
    },
    measure: true,
    configTtlMs: 30_000,
  });
}
