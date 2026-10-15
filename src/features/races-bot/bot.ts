/* Бот «Забеги России»: обработка сообщений, почасовой тик и действия мини-аппа.
 *
 * Хранилище, Telegram, погода и геокодер приходят снаружи (deps): в бою это Supabase и
 * Bot API (store-supabase.ts, tg-api.ts), в чеке — память и запись исходящих вызовов
 * (scripts/check-races-bot.ts). Поэтому все экраны и плановые сообщения проверяются на
 * тестовых датах без сети и без настоящего Telegram. */

import { norm } from "@/app/races/races-logic";
import { courseList } from "@/features/race-course";
import { importantLine, type DetailRow } from "@/features/race-details/important";

import {
  consultAllowed,
  findExpectedByCode,
  findCityBySlug,
  findRaceByCode,
  inCity,
  inUserCity,
  knownCities,
  knownRegions,
  localParts,
  matchCity,
  matchUser,
  browseItems,
  expectedDate,
  seasonCounts,
  seasons,
  seasonSlice,
  type SeasonItem,
  nearestCities,
  nextDigestDate,
  PAUSE_DAYS,
  parseSearch,
  parseStart,
  resolveCity,
  startSource,
  planUser,
  raceCode,
  searchRaces,
  type BotRace,
  type ExpectedItem,
  type PlanFollow,
  type PlanUser,
} from "./core";
import { dailyMessage, statsMessage, weeklyMessage, type BotStatsReport, type StatPeriod } from "./stats";
import * as T from "./texts";

export type BotUser = PlanUser & {
  first_name: string | null;
  username: string | null;
  source: string | null;
  state: string | null;
  consult_offered_at: string | null;
  consult_requested_at: string | null;
  star_hint_at?: string | null;
  /** Живое меню: сообщение, которое бот правит на месте; старше 48 часов не правим. */
  menu_message_id?: number | null;
  menu_message_at?: string | null;
  /** Что листает человек по сезонам: «город|типы|дистанции» или «q:запрос»; null — свой город. */
  browse_ctx?: string | null;
  /** Точка из геолокации: «Рядом» считается от неё. Сбрасывается при выборе города кнопкой или текстом. */
  geo_lat?: number | null;
  geo_lon?: number | null;
};

export type BotFollow = PlanFollow & { tg_id: number };

export type BotEvent =
  | "start" | "city_chosen" | "filters_done" | "list_shown" | "search" | "follow" | "unfollow" | "open_calendar"
  | "click_registration" | "click_site" | "consult_offer_shown" | "consult_click" | "digest_sent"
  | "digest_opened_list" | "settings_less" | "pause" | "unsubscribe" | "delete" | "blocked"
  | "expected_watch" | "expected_announced" | "pick_city" | "nudge_sent"
  | "tap" | "card_open" | "miniapp";

/** Действия в календаре Mini App, которые пишем в статистику (наряд 13.10.2026). */
export const MINIAPP_ACTIONS = ["season", "filter", "open", "reg", "site"] as const;
export type MiniappAction = (typeof MINIAPP_ACTIONS)[number];

export type EventOpts = { raceId?: string | null; source?: string | null; meta?: Record<string, unknown> };

export interface BotStore {
  getUser(tgId: number): Promise<BotUser | null>;
  saveUser(patch: Partial<BotUser> & { tg_id: number }): Promise<BotUser>;
  deleteUser(tgId: number): Promise<void>;
  listFollows(tgId: number): Promise<BotFollow[]>;
  addFollow(tgId: number, r: BotRace): Promise<void>;
  removeFollow(tgId: number, raceId: string): Promise<void>;
  removeAllFollows(tgId: number): Promise<void>;
  getConfig(key: string): Promise<string | null>;
  setConfig(key: string, value: string): Promise<void>;
  /** true — записали (ещё не отправляли); false — уже было. */
  claimSend(tgId: number, kind: string, raceId: string | null): Promise<boolean>;
  releaseSend(tgId: number, kind: string, raceId: string | null): Promise<void>;
  listActiveUsers(): Promise<BotUser[]>;
  listAllFollows(): Promise<BotFollow[]>;
  listSentKeys(): Promise<Map<number, Set<string>>>;
  logEvent(tgId: number | null, event: BotEvent, opts?: EventOpts): Promise<void>;
  addExpectedWatch(tgId: number, expectedId: string): Promise<void>;
  listExpectedWatches(tgId: number): Promise<string[]>;
  /** Подписки «сообщить, когда объявят», у которых старт уже announced и сообщение ещё не ушло. */
  listDueAnnouncements(): Promise<{ id: number; tg_id: number; expected_id: string; race_id: string }[]>;
  markWatchNotified(id: number): Promise<void>;
  loadStats(period: StatPeriod, now: Date): Promise<BotStatsReport>;
  /**
   * Защита от повторов: true — ключ новый (или старше окна), обрабатываем; false — уже был.
   * «u:<update_id>» — Telegram повторил обновление; «cb:<tg_id>:<data>» — двойное нажатие.
   */
  seenOnce(key: string, windowSec: number): Promise<boolean>;
  /** Уборка старых ключей защиты от повторов (тик). */
  pruneSeen(): Promise<void>;
  /** Кандидаты на напоминание: пришли в [from, to], не заблокировали, без города и без событий кроме start. */
  listNudgeCandidates(fromIso: string, toIso: string): Promise<BotUser[]>;
}

export class BotBlockedError extends Error {}

export interface BotTg {
  call(method: string, params: Record<string, unknown>): Promise<unknown>;
}

export type BotDeps = {
  store: BotStore;
  tg: BotTg;
  races: () => Promise<BotRace[]>;
  /** Ожидаемые старты (race_expected, status = expected). */
  expected?: () => Promise<ExpectedItem[]>;
  now?: () => Date;
  coachUsername: string;
  reverseGeocode?: (lat: number, lon: number) => Promise<string | null>;
  weather?: (city: string, dateIso: string) => Promise<T.Weather | null>;
  /** Ссылка через igorp.run/go/<код>: клик записывается и сразу 302 на сайт или регистрацию. */
  goLink?: (tgId: number, r: BotRace, kind: "r" | "s") => string;
  /** Выжимка по старту (race_details): строка «Важное» в карточке. Нет — блока нет. */
  details?: (raceId: string) => Promise<DetailRow[]>;
};

type TgUser = { id: number; first_name?: string; username?: string };
type TgMessage = {
  message_id: number;
  chat: { id: number; type: string };
  from?: TgUser;
  text?: string;
  location?: { latitude: number; longitude: number };
  // стикер, фото, голосовое и прочее: бот отвечает подсказкой и меню
  [other: string]: unknown;
};
export type TgUpdate = {
  update_id?: number;
  message?: TgMessage;
  callback_query?: { id: string; from: TgUser; data?: string; message?: TgMessage };
  /** Человек заблокировал бота (kicked) или разблокировал (member). */
  my_chat_member?: { chat: { id: number; type: string }; from: TgUser; new_chat_member: { status: string } };
};

/** Окно, в котором второе нажатие той же кнопки тем же человеком считается двойным кликом. */
export const DOUBLE_CLICK_SEC = 3;

/** Живое меню правим не дольше 48 часов, потом шлём новое. */
export const MENU_TTL_MS = 48 * 3600 * 1000;

/** Напоминание после /start без действий: не раньше 30 минут и не позже 3 часов. */
export const NUDGE_AFTER_MIN = 30;
export const NUDGE_MAX_MIN = 180;

export function createBot(deps: BotDeps) {
  const { store, tg } = deps;
  const now = deps.now ?? (() => new Date());
  const coach = deps.coachUsername.replace(/^@/, "").toLowerCase();

  /** Событие для статистики. Сбой записи никогда не мешает ответу человеку. */
  async function track(tgId: number | null, event: BotEvent, opts?: EventOpts): Promise<void> {
    try {
      await store.logEvent(tgId, event, opts);
    } catch (e) {
      console.error(`[races-bot] событие ${event}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function regLink(u: { tg_id: number }, r: BotRace): string | null {
    if (!(r.reg || r.site)) return null;
    return deps.goLink ? deps.goLink(u.tg_id, r, "r") : r.reg || r.site;
  }

  function siteLink(u: { tg_id: number }, r: BotRace): string {
    return deps.goLink ? deps.goLink(u.tg_id, r, "s") : T.raceUrl(r);
  }

  /** Предпросмотр ссылок выключен везде, кроме сообщений с картинкой (мини-профиль трассы над текстом). */
  function previewOf(msg: T.Msg): Record<string, unknown> {
    return msg.preview ? { url: msg.preview, prefer_large_media: true, show_above_text: true } : { is_disabled: true };
  }

  /** Сообщение как есть, без правила меню: уведомление тренеру, /stats. */
  async function sendRaw(chatId: number, msg: T.Msg): Promise<number | null> {
    const res = (await tg.call("sendMessage", {
      chat_id: chatId,
      text: msg.text,
      parse_mode: "HTML",
      link_preview_options: previewOf(msg),
      ...(msg.reply_markup ? { reply_markup: msg.reply_markup } : {}),
    })) as { message_id?: number } | null;
    return typeof res?.message_id === "number" ? res.message_id : null;
  }

  /**
   * «Меню всегда последнее» (наряд 13.10.2026): у человека одно живое сообщение с кнопками. Новое
   * сообщение бота сначала снимает кнопки со старого, а само становится меню: свои кнопки или,
   * если их нет, главное меню. Сообщение с reply-клавиатурой (снять её) меню не становится.
   */
  async function send(chatId: number, msg: T.Msg): Promise<void> {
    const rm = msg.reply_markup as { inline_keyboard?: unknown[]; remove_keyboard?: boolean } | undefined;
    if (rm && !rm.inline_keyboard) {
      await sendRaw(chatId, msg);
      return;
    }
    const u = await store.getUser(chatId);
    if (!u) {
      await sendRaw(chatId, msg);
      return;
    }
    await dropMenu(u);
    const markup = rm?.inline_keyboard?.length ? msg.reply_markup : T.menuKeyboard(u.city);
    const id = await sendRaw(chatId, { text: msg.text, reply_markup: markup, ...(msg.preview ? { preview: msg.preview } : {}) });
    if (id !== null) await store.saveUser({ tg_id: chatId, menu_message_id: id, menu_message_at: now().toISOString() });
  }

  /** Снять кнопки со старого меню (оно могло быть уже снято или удалено — не важно). */
  async function dropMenu(u: BotUser): Promise<void> {
    if (!u.menu_message_id) return;
    await tg.call("editMessageReplyMarkup", { chat_id: u.tg_id, message_id: u.menu_message_id, reply_markup: { inline_keyboard: [] } }).catch(() => undefined);
  }

  /**
   * Экран на месте: нажатие в живом меню правит его (editMessageText). Не то сообщение, старше
   * 48 часов или Telegram не дал изменить — новое меню внизу.
   */
  async function screen(u: BotUser, msg: T.Msg, origin?: TgMessage): Promise<void> {
    const cur = await store.getUser(u.tg_id);
    const age = cur?.menu_message_at ? now().getTime() - Date.parse(cur.menu_message_at) : Infinity;
    if (origin && cur?.menu_message_id === origin.message_id && age < MENU_TTL_MS) {
      try {
        await tg.call("editMessageText", {
          chat_id: u.tg_id,
          message_id: origin.message_id,
          text: msg.text,
          parse_mode: "HTML",
          link_preview_options: previewOf(msg),
          reply_markup: msg.reply_markup ?? T.menuKeyboard(cur.city),
        });
        return;
      } catch (e) {
        if (/message is not modified/i.test(e instanceof Error ? e.message : String(e))) return;
        if (e instanceof BotBlockedError) throw e;
      }
    }
    await send(u.tg_id, msg);
  }

  /** Пользователь создан в этом обновлении (первый приход): ему источник пишется при /start.
   *  Привязка к объекту, а не к tg_id: инстанс на Vercel живёт между запросами. */
  const fresh = new WeakSet<BotUser>();

  async function ensureUser(from: TgUser): Promise<BotUser> {
    const u = await store.getUser(from.id);
    if (from.username && from.username.toLowerCase() === coach) {
      await store.setConfig("coach_chat_id", String(from.id));
    }
    if (!u) {
      const created = await store.saveUser({ tg_id: from.id, first_name: from.first_name ?? null, username: from.username ?? null });
      fresh.add(created);
      return created;
    }
    if (u.first_name !== (from.first_name ?? null) || u.username !== (from.username ?? null) || u.blocked) {
      return store.saveUser({ tg_id: from.id, first_name: from.first_name ?? null, username: from.username ?? null, blocked: false });
    }
    return u;
  }

  function today(u: BotUser | null): string {
    return localParts(now(), u?.tz || "Europe/Moscow").date;
  }

  async function followingSet(tgId: number): Promise<Set<string>> {
    return new Set((await store.listFollows(tgId)).map((f) => f.race_id));
  }

  async function greet(chatId: number) {
    const races = await deps.races();
    await send(chatId, T.greeting(races.length));
  }

  /** Выбор города (после «📍 Выбрать город», «Сменить город», /city). */
  async function pickCity(chatId: number) {
    await send(chatId, T.cityPicker());
  }


  async function expectedFor(filter: (e: ExpectedItem) => boolean): Promise<ExpectedItem[]> {
    if (!deps.expected) return [];
    try {
      return (await deps.expected()).filter(filter);
    } catch (e) {
      console.error(`[races-bot] ожидаемые: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  }

  async function watchExpected(u: BotUser, code: string) {
    const e = deps.expected ? findExpectedByCode(await deps.expected(), code) : null;
    if (!e) return send(u.tg_id, { text: "Этот старт уже объявил дату или пропал из списка ожидаемых. Посмотри календарь." });
    await store.addExpectedWatch(u.tg_id, e.id);
    await track(u.tg_id, "expected_watch", { raceId: e.id, meta: { race_name: e.name } });
    return send(u.tg_id, T.expectedWatching(e));
  }



  async function showCityList(u: BotUser, origin?: TgMessage) {
    if (!u.city) return pickCity(u.tg_id);
    if (u.browse_ctx) u = await store.saveUser({ tg_id: u.tg_id, browse_ctx: null });
    return showFork(u, origin);
  }

  /** Точка «Рядом»: своя геолокация (только для своего города), иначе город. */
  function userPoint(u: BotUser, city: string): { lat: number; lon: number } | null {
    return norm(city) === norm(u.city) && u.geo_lat != null && u.geo_lon != null ? { lat: u.geo_lat, lon: u.geo_lon } : null;
  }

  type Browse = { city: string; types: string[]; dists: string[]; q: string | null };

  /** Что листаем: свой город и фильтры, или город из поиска («трейл Казань»), или запрос без города. */
  function browseOf(u: BotUser): Browse | null {
    const c = u.browse_ctx;
    if (c?.startsWith("q:")) return { city: "", types: [], dists: [], q: c.slice(2) };
    if (c) {
      const [city, t, d] = c.split("|");
      return { city, types: t ? t.split(",") : [], dists: d ? d.split(",") : [], q: null };
    }
    return u.city ? { city: u.city, types: u.types, dists: u.distances, q: null } : null;
  }

  /** Старты и ожидаемые для сезонов: город плюс область и 150 км (или запрос без города). */
  async function itemsOf(u: BotUser, b: Browse): Promise<SeasonItem[]> {
    const all = await deps.races();
    const exp = await expectedFor(() => true);
    const t = today(u);
    if (b.q !== null) {
      const s = parseSearch(b.q);
      const words = s.q.split(/\s+/).filter(Boolean);
      return [
        ...searchRaces(all, s).filter((r) => r.de >= t).map((race) => ({ kind: "race" as const, race, km: null, date: race.ds < t ? t : race.ds, near: false })),
        ...exp
          .filter((e) => words.length && words.every((w) => norm(`${e.name} ${e.city} ${e.region}`).includes(w)) && matchUser({ type: e.type, km: e.km, tags: [] } as unknown as BotRace, s.types, s.dists))
          .map((e) => ({ kind: "exp" as const, e, km: null, date: expectedDate(e, t), near: false })),
      ];
    }
    return browseItems(all, exp, b.city, b.types, b.dists, userPoint(u, b.city), t);
  }

  function browseTitle(b: Browse): string {
    return b.q !== null ? `«${b.q}»` : b.city;
  }

  function filtersOf(b: Browse): string | null {
    const f = T.filtersText(b.types, b.dists);
    return f || null;
  }

  /** Развилка «На какой сезон ищешь старт?» в живом меню. */
  async function showFork(u: BotUser, origin?: TgMessage) {
    const b = browseOf(u);
    if (!b) return pickCity(u.tg_id);
    const items = await itemsOf(u, b);
    const rows = seasons(today(u)).map((s) => ({ s, ...seasonCounts(items, s) }));
    await screen(u, T.seasonFork(browseTitle(b), rows, filtersOf(b)), origin);
    await track(u.tg_id, "list_shown", { meta: { city: b.city || null, q: b.q, fork: true, n: items.length } });
  }

  function seasonByKey(u: BotUser, key: string) {
    return seasons(today(u)).find((s) => s.key === key) ?? null;
  }

  /** Список сезона, 5 на странице. Подсказка про ⭐ — один раз, строкой в том же сообщении. */
  async function showSeason(u: BotUser, key: string, page: number, origin?: TgMessage) {
    const b = browseOf(u);
    const s = seasonByKey(u, key);
    if (!b || !s) return showFork(u, origin);
    const items = seasonSlice(await itemsOf(u, b), s);
    if (!items.length) return showFork(u, origin);
    const following = await followingSet(u.tg_id);
    const msg = T.seasonList(browseTitle(b), s, items, page, following, (r) => !!regLink(u, r));
    if (!u.star_hint_at) {
      msg.text += `\n\n${T.STAR_HINT_LIST}`;
      await store.saveUser({ tg_id: u.tg_id, star_hint_at: now().toISOString() });
    }
    await screen(u, msg, origin);
  }

  /** Карточка в том же сообщении; back — «sn:<сезон>:<страница>» или «sz» (к развилке). */
  async function showItem(u: BotUser, x: SeasonItem, back: string, origin?: TgMessage, consult = false) {
    // «Какие старты смотрели» в еженедельном итоге
    await track(u.tg_id, "card_open", x.kind === "race" ? { raceId: x.race.id, meta: { race_name: x.race.name } } : { raceId: x.e.id, meta: { race_name: x.e.name, expected: true } });
    if (x.kind === "race") {
      const following = (await followingSet(u.tg_id)).has(x.race.id);
      const place = x.near ? T.placeLine(x.race, x.km) : x.race.city || T.placeLine(x.race, null);
      // «Важное» из выжимки: сбой чтения не мешает карточке, просто без блока.
      const important = deps.details ? importantLine(await deps.details(x.race.id).catch(() => [])) : null;
      return screen(u, T.raceScreen(x.race, place, following, regLink(u, x.race), siteLink(u, x.race), back, consult, important), origin);
    }
    const watching = new Set(await store.listExpectedWatches(u.tg_id)).has(x.e.id);
    const place = x.e.city ? `${x.e.city}${x.km === null ? "" : `, ${x.km} км`}` : x.e.subject || "место уточняется";
    return screen(u, T.expectedScreen(x.e, place, x.date, watching, back), origin);
  }

  /** Найти пункт сезона по коду старта (для ⭐ в карточке): контекст тот же, что у списка. */
  async function itemByCode(u: BotUser, code: string): Promise<SeasonItem | null> {
    const b = browseOf(u);
    if (b) {
      const hit = (await itemsOf(u, b)).find((x) => raceCode(x.kind === "race" ? x.race.id : x.e.id) === code);
      if (hit) return hit;
    }
    const r = findRaceByCode(await deps.races(), code);
    return r ? { kind: "race", race: r, km: null, date: r.ds, near: false } : null;
  }

  /** «sn:ve27:2» из хвоста кнопки карточки «ve27:2»; «sz» — к развилке. */
  function backOf(tail: string[]): string {
    return tail[0] === "sz" || !tail[0] ? "sz" : `sn:${tail[0]}:${Number(tail[1]) || 0}`;
  }

  /** Поиск текстом: город узнан — развилка по сезонам этого города с фильтрами запроса; иначе — все найденные подряд. */
  async function showSearch(u: BotUser, text: string) {
    const all = await deps.races();
    const s = parseSearch(text);
    const city = s.q ? matchCity(knownCities(all), s.q) : null;
    const found = city ? all.filter((r) => inUserCity(r, city)) : searchRaces(all, s);
    await track(u.tg_id, "search", { meta: { q: text.trim().slice(0, 80), n: found.length } });
    if (city) {
      const own = norm(city) === norm(u.city) && !s.types.length && !s.dists.length;
      u = await store.saveUser({ tg_id: u.tg_id, browse_ctx: own ? null : `${city}|${s.types.join(",")}|${s.dists.join(",")}` });
      return showFork(u);
    }
    if (!found.length) return send(u.tg_id, T.nothingFound(`по запросу «${T.esc(text.trim())}»`, s.q || undefined));
    u = await store.saveUser({ tg_id: u.tg_id, browse_ctx: `q:${text.trim().slice(0, 80)}` });
    return showSeason(u, "all", 0);
  }

  async function follow(u: BotUser, r: BotRace, via = "bot") {
    // Второй ⭐ на тот же старт: ответить, но не сохранять и не писать событие ещё раз.
    if ((await followingSet(u.tg_id)).has(r.id)) return send(u.tg_id, T.alreadyFollowing(r));
    await store.addFollow(u.tg_id, r);
    await track(u.tg_id, "follow", { raceId: r.id, meta: { race_name: r.name, city: r.city, via } });
    const offer = consultAllowed(u.consult_offered_at, now());
    if (offer) {
      await send(u.tg_id, T.saved(r));
      await send(u.tg_id, T.consultOffer(raceCode(r.id)));
      await store.saveUser({ tg_id: u.tg_id, consult_offered_at: now().toISOString() });
      await track(u.tg_id, "consult_offer_shown", { raceId: r.id, meta: { after: "follow" } });
    } else {
      await send(u.tg_id, { ...T.saved(r), reply_markup: T.NAV });
    }
  }

  async function showMy(u: BotUser, page = 0, origin?: TgMessage) {
    const races = await deps.races();
    const byId = new Map(races.map((r) => [r.id, r]));
    const items = (await store.listFollows(u.tg_id))
      .map((f) => byId.get(f.race_id))
      .filter((r): r is BotRace => !!r)
      .sort((a, b) => a.ds.localeCompare(b.ds))
      .map((race) => ({ race, code: raceCode(race.id), site: siteLink(u, race) }));
    const pages = Math.max(1, Math.ceil(items.length / T.MY_PAGE));
    await screen(u, T.myRaces(items, today(u), Math.min(Math.max(page, 0), pages - 1), u.city), origin);
  }

  async function savedRaces(u: BotUser): Promise<{ race: BotRace }[]> {
    const byId = new Map((await deps.races()).map((r) => [r.id, r]));
    return (await store.listFollows(u.tg_id))
      .map((f) => byId.get(f.race_id))
      .filter((r): r is BotRace => !!r)
      .sort((a, b) => a.ds.localeCompare(b.ds))
      .map((race) => ({ race }));
  }

  /** Сводка и главное меню вместо повторного онбординга. */
  async function welcomeBack(u: BotUser, head?: string) {
    return send(u.tg_id, T.welcomeBack(u, await savedRaces(u), today(u), head));
  }

  async function consult(u: BotUser, code: string) {
    const races = await deps.races();
    const follows = await store.listFollows(u.tg_id);
    const byId = new Map(races.map((r) => [r.id, r]));
    const raceName = (code && code !== "-" ? findRaceByCode(races, code)?.name : null) ?? null;
    const names = follows.map((f) => byId.get(f.race_id)?.name ?? f.race_name).filter((x): x is string => !!x);
    const coachChat = await store.getConfig("coach_chat_id");
    if (coachChat) {
      await sendRaw(Number(coachChat), { text: T.coachNotice(u, names) });
    } else {
      console.error("[races-bot] заявка на консультацию, но chat_id тренера ещё не известен (он не писал боту /start)");
    }
    await send(u.tg_id, T.consultReply(deps.coachUsername.replace(/^@/, ""), raceName ?? names[0] ?? null));
    await store.saveUser({ tg_id: u.tg_id, consult_requested_at: now().toISOString() });
    await track(u.tg_id, "consult_click", { meta: { race_name: raceName ?? names[0] ?? null } });
  }

  async function onStart(u: BotUser, param: string | undefined) {
    const p = parseStart(param);
    // Источник как в ссылке: ig_channel, src_ig_story; старты — r_*, ожидаемые — e_*, город — c_<город>.
    const source = startSource(p);
    const isNew = fresh.has(u);
    await track(u.tg_id, "start", { source, meta: { param: param ?? null, first: isNew } });
    // Источник пишется один раз, при первом приходе (без метки — «direct»). Повторный приход с
    // другой меткой его не меняет: он виден в событии start как «вернулся через».
    if (isNew && !u.source) u = await store.saveUser({ tg_id: u.tg_id, source: source ?? "direct" });
    if (p.kind === "race") {
      const r = findRaceByCode(await deps.races(), p.code);
      if (r) return follow(u, r);
      await send(u.tg_id, { text: "Этот забег уже прошёл или убран из календаря." });
      return u.city ? welcomeBack(u) : greet(u.tg_id);
    }
    if (p.kind === "expected") return watchExpected(u, p.code);
    // Город уже выбран: «С возвращением!» и меню, а не онбординг заново (было: любой /start
    // запускал выбор города с нуля). Заново — только кнопками «Сменить город» и «Начать заново».
    if (u.city) return welcomeBack(u);
    if (p.kind === "city") {
      const races = await deps.races();
      const city = findCityBySlug(knownCities(races), p.slug);
      if (city) {
        u = await store.saveUser({ tg_id: u.tg_id, city, digest_on: true, state: null, source: u.source ?? `c_${p.slug}` });
        await track(u.tg_id, "city_chosen", { meta: { city, via: "deeplink" } });
        return send(
          u.tg_id,
          T.prefs(u.types, u.distances, `Подписал на новые забеги ${inCity(city)}: одно сообщение в неделю, по понедельникам.`),
        );
      }
      return pickCity(u.tg_id);
    }
    return greet(u.tg_id);
  }

  /** point — геолокация человека (только из onLocation); город кнопкой или текстом её сбрасывает. */
  async function setCity(u: BotUser, city: string, lead?: string, point?: { lat: number; lon: number }) {
    u = await store.saveUser({ tg_id: u.tg_id, city, state: null, geo_lat: point?.lat ?? null, geo_lon: point?.lon ?? null });
    await track(u.tg_id, "city_chosen", { meta: { city } });
    await send(u.tg_id, T.prefs(u.types, u.distances, lead));
  }

  async function onText(u: BotUser, text: string) {
    const t = text.trim();
    const cmd = t.match(/^\/(\w+)(?:@\w+)?(?:\s+(.+))?$/);
    if (cmd) {
      const [, name, arg] = cmd;
      if (name === "start") return onStart(u, arg);
      if (name === "races") return showMy(u);
      if (name === "calendar") {
        return send(u.tg_id, {
          text: "Весь календарь забегов: поиск по городу, фильтры, кнопка «Следить».",
          reply_markup: { inline_keyboard: [[T.calendarButton(T.CALENDAR_LABEL, u.city ?? undefined, "menu")]] },
        });
      }
      if (name === "city") return pickCity(u.tg_id);
      if (name === "settings") return send(u.tg_id, T.settings(u, now()));
      if (name === "delete") return send(u.tg_id, T.DELETE_CONFIRM);
      if (name === "stats") {
        const coachChat = await store.getConfig("coach_chat_id");
        if (coachChat && Number(coachChat) === u.tg_id) return send(u.tg_id, statsMessage(await store.loadStats(30, now())));
        return send(u.tg_id, T.unknownCommand(u.city));
      }
      if (name === "menu") return welcomeBack(u, "Меню");
      return send(u.tg_id, T.unknownCommand(u.city));
    }
    if (u.state === "await_city") {
      // Сокращения («спб», «екб»), опечатки, область. Не узнал — варианты кнопками, состояние
      // остаётся: город можно написать ещё раз (было: любой текст становился городом).
      const { city, suggestions } = resolveCity(await deps.races(), t);
      if (city) return setCity(u, city);
      return send(u.tg_id, T.cityNotFound(t, suggestions));
    }
    // Города ещё нет, а человек написал город сразу, не нажав «Другой город»: это выбор города.
    if (!u.city) {
      const s = parseSearch(t);
      if (!s.types.length && !s.dists.length && !s.month) {
        const { city } = resolveCity(await deps.races(), t);
        if (city) return setCity(u, city);
      }
    }
    return showSearch(u, t);
  }

  async function onLocation(u: BotUser, lat: number, lon: number) {
    const races = await deps.races();
    const point = { lat, lon };
    // Ближайшие города со стартами по координатам: подсказки, если сам город не узнан.
    const nearest = nearestCities(races, point);
    const name = deps.reverseGeocode ? await deps.reverseGeocode(lat, lon) : null;
    const { city, suggestions } = name ? resolveCity(races, name) : { city: null, suggestions: [] as string[] };
    if (!city) {
      await send(u.tg_id, { text: name ? `По геолокации: ${T.esc(name)}.` : "Не получилось определить город по геолокации.", reply_markup: { remove_keyboard: true } });
      await store.saveUser({ tg_id: u.tg_id, state: "await_city", geo_lat: lat, geo_lon: lon });
      if (nearest.length) return send(u.tg_id, T.nearestCitiesMsg(nearest));
      return send(u.tg_id, name ? T.cityNotFound(name, suggestions) : T.ASK_CITY);
    }
    await send(u.tg_id, { text: `Город: ${T.esc(city)}`, reply_markup: { remove_keyboard: true } });
    return setCity(u, city, undefined, point);
  }

  async function onCallback(u: BotUser, data: string, msg: TgMessage | undefined) {
    const i = data.indexOf(":");
    const key = i < 0 ? data : data.slice(0, i);
    const arg = i < 0 ? "" : data.slice(i + 1);
    switch (key) {
      case "cityg": {
        // Город из ближайших к геолокации: точку сохраняем, «Рядом» — от неё.
        const city = findCityBySlug(knownCities(await deps.races()), arg);
        if (!city) return pickCity(u.tg_id);
        const point = u.geo_lat != null && u.geo_lon != null ? { lat: u.geo_lat, lon: u.geo_lon } : undefined;
        return setCity(u, city, undefined, point);
      }
      case "city": {
        const races = await deps.races();
        const city = findCityBySlug([...T.TOP_CITIES, ...knownCities(races), ...knownRegions(races)], arg);
        return city ? setCity(u, city) : pickCity(u.tg_id);
      }
      case "pick":
        await track(u.tg_id, "pick_city");
        return pickCity(u.tg_id);
      case "menu":
        return welcomeBack(u, "Меню");
      case "restart":
        // «Начать заново»: город и фильтры с нуля, сохранённые забеги остаются.
        await store.saveUser({ tg_id: u.tg_id, city: null, types: [], distances: [], state: null });
        return greet(u.tg_id);
      case "nf":
        u = await store.saveUser({ tg_id: u.tg_id, types: [], distances: [], browse_ctx: null });
        return showCityList(u, msg);
      case "more":
      case "area":
        // кнопки прежних списков (до сезонов): ведут на развилку
        return showCityList(u, msg);
      case "sz":
        return showFork(u, msg);
      case "sn": {
        const [key, page] = arg.split(":");
        return showSeason(u, key, Math.max(0, Number(page) || 0), msg);
      }
      case "so": {
        const [key, page, idx] = arg.split(":");
        const b = browseOf(u);
        const s = seasonByKey(u, key);
        if (!b || !s) return showFork(u, msg);
        const p = Math.max(0, Number(page) || 0);
        const x = seasonSlice(await itemsOf(u, b), s)[p * T.SEASON_PAGE + (Number(idx) || 0)];
        return x ? showItem(u, x, `sn:${key}:${p}`, msg) : showSeason(u, key, p, msg);
      }
      case "oc": {
        const x = await itemByCode(u, arg);
        return x ? showItem(u, x, "sz", msg) : showFork(u, msg);
      }
      case "sf":
      case "su":
      case "sw": {
        const [code, ...tail] = arg.split(":");
        const back = backOf(tail);
        const x = await itemByCode(u, code);
        if (!x) return showFork(u, msg);
        let consultNow = false;
        if (key === "sf" && x.kind === "race") {
          if (!(await followingSet(u.tg_id)).has(x.race.id)) {
            await store.addFollow(u.tg_id, x.race);
            await track(u.tg_id, "follow", { raceId: x.race.id, meta: { race_name: x.race.name, city: x.race.city, via: "season" } });
            if (consultAllowed(u.consult_offered_at, now())) {
              consultNow = true;
              await store.saveUser({ tg_id: u.tg_id, consult_offered_at: now().toISOString() });
              await track(u.tg_id, "consult_offer_shown", { raceId: x.race.id, meta: { after: "follow" } });
            }
          }
        } else if (key === "su" && x.kind === "race") {
          if ((await followingSet(u.tg_id)).has(x.race.id)) {
            await store.removeFollow(u.tg_id, x.race.id);
            await track(u.tg_id, "unfollow", { raceId: x.race.id, meta: { race_name: x.race.name, via: "season" } });
          }
        } else if (key === "sw" && x.kind === "exp") {
          if (!new Set(await store.listExpectedWatches(u.tg_id)).has(x.e.id)) {
            await store.addExpectedWatch(u.tg_id, x.e.id);
            await track(u.tg_id, "expected_watch", { raceId: x.e.id, meta: { race_name: x.e.name, via: "season" } });
          }
        }
        return showItem(u, x, back, msg, consultNow);
      }
      case "tc":
      case "tv":
      case "tb": {
        // Разбор трассы: tc — выбор дистанции (одна — сразу короткий разбор), tv — короткий разбор
        // дистанции по номеру, tb — назад к карточке. Хвост — как у карточки (сезон и страница).
        const [code, ...rest] = arg.split(":");
        const x = await itemByCode(u, code);
        if (!x || x.kind !== "race") return showFork(u, msg);
        const courses = courseList(x.race.id);
        if (key === "tb" || !courses.length) return showItem(u, x, backOf(key === "tv" ? rest.slice(1) : rest), msg);
        const idx = key === "tv" ? Math.max(0, Number(rest[0]) || 0) : 0;
        const tail = (key === "tv" ? rest.slice(1) : rest).join(":") || "sz";
        if (key === "tc" && courses.length > 1) return screen(u, T.courseChoice(x.race, courses, code, tail), msg);
        const c = courses[Math.min(idx, courses.length - 1)];
        const following = (await followingSet(u.tg_id)).has(x.race.id);
        return screen(u, T.courseShort(x.race, c, courses.length > 1, following, code, tail), msg);
      }
      case "flt":
        return screen(u, T.prefs(u.types, u.distances, "Отметь, что интересно, и нажми «Показать забеги»."), msg);
      case "myp":
        return showMy(u, Math.max(0, Number(arg) || 0), msg);
      case "city_other":
        await store.saveUser({ tg_id: u.tg_id, state: "await_city" });
        return send(u.tg_id, T.ASK_CITY);
      case "geo":
        return send(u.tg_id, T.ASK_GEO);
      case "t":
      case "d": {
        const field = key === "t" ? "types" : "distances";
        const cur = new Set(u[field]);
        if (cur.has(arg)) cur.delete(arg);
        else cur.add(arg);
        u = await store.saveUser({ tg_id: u.tg_id, [field]: [...cur] });
        if (msg) {
          await tg.call("editMessageReplyMarkup", {
            chat_id: u.tg_id,
            message_id: msg.message_id,
            reply_markup: T.prefs(u.types, u.distances).reply_markup,
          });
        }
        return;
      }
      case "show":
        // «Показать забеги» после фильтров: свой город и свои фильтры
        if (u.browse_ctx) u = await store.saveUser({ tg_id: u.tg_id, browse_ctx: null });
        await track(u.tg_id, "filters_done", { meta: { types: u.types, distances: u.distances } });
        return showCityList(u, msg);
      case "ew":
        return watchExpected(u, arg);
      case "noop":
        return;
      case "dlist":
        await track(u.tg_id, "digest_opened_list");
        return showCityList(u, msg);
      case "st": {
        const coachChat = await store.getConfig("coach_chat_id");
        if (!coachChat || Number(coachChat) !== u.tg_id) return;
        const period: StatPeriod = arg === "7" ? 7 : arg === "all" ? "all" : 30;
        const m = arg === "days" ? dailyMessage(await store.loadStats(7, now())) : statsMessage(await store.loadStats(period, now()));
        if (msg) {
          await tg.call("editMessageText", { chat_id: u.tg_id, message_id: msg.message_id, text: m.text, parse_mode: "HTML", reply_markup: m.reply_markup });
          return;
        }
        return send(u.tg_id, m);
      }
      case "dg": {
        const on = arg === "on";
        // Уже в этом состоянии (повторное нажатие): ответить, но событие не писать.
        if (u.digest_on !== on) {
          await store.saveUser({ tg_id: u.tg_id, digest_on: on });
          if (!on) await track(u.tg_id, "unsubscribe", { meta: { from: "digest_offer" } });
        }
        return send(u.tg_id, on ? T.DIGEST_ON : T.DIGEST_OFF);
      }
      case "f": {
        const r = findRaceByCode(await deps.races(), arg);
        if (!r) return send(u.tg_id, { text: "Этот забег уже прошёл или убран из календаря." });
        return follow(u, r);
      }
      case "u": {
        const f = (await store.listFollows(u.tg_id)).find((x) => raceCode(x.race_id) === arg);
        if (f) {
          await store.removeFollow(u.tg_id, f.race_id);
          await track(u.tg_id, "unfollow", { raceId: f.race_id, meta: { race_name: f.race_name } });
        }
        return showMy(u, 0, msg);
      }
      case "my":
        return showMy(u, 0, msg);
      case "consult":
        return consult(u, arg);
      case "noconsult":
        return send(u.tg_id, T.NO_CONSULT);
      case "s": {
        if (arg.startsWith("dg:")) return setDigestMode(u, arg.slice(3), msg);
        if (arg === "rarer" || arg === "pause") {
          // Старые кнопки-переключатели из прежних сообщений: ничего не меняют (было непонятно,
          // что они переключили), показывают новый экран, где всё видно.
          await send(u.tg_id, { text: T.SETTINGS_OUTDATED });
          return send(u.tg_id, T.settings(u, now()));
        }
        if (arg === "prefs") return send(u.tg_id, T.prefs(u.types, u.distances, "Отметь, что интересно, и нажми «Показать забеги»."));
        if (arg === "city") {
          await store.saveUser({ tg_id: u.tg_id, state: null });
          return pickCity(u.tg_id);
        } else if (arg === "unsub") {
          if (!u.digest_on && !(await store.listFollows(u.tg_id)).length) return send(u.tg_id, T.ALREADY_UNSUBSCRIBED);
          await store.removeAllFollows(u.tg_id);
          await store.saveUser({ tg_id: u.tg_id, digest_on: false });
          await track(u.tg_id, "unsubscribe", { meta: { from: "settings" } });
          return send(u.tg_id, T.UNSUBSCRIBED);
        }
        return send(u.tg_id, T.settings(u, now()));
      }
      case "del":
        if (arg === "yes") {
          await store.deleteUser(u.tg_id);
          // Данные человека стёрты целиком, вместе с его событиями: само удаление пишем без tg_id.
          await track(null, "delete");
          return send(u.tg_id, T.DELETED);
        }
        return send(u.tg_id, T.DELETE_CANCELLED);
      default:
        return;
    }
  }

  /**
   * Режим дайджеста из настроек: ровно одна вещь — режим (неделя / 2 недели / месяц / пауза / выкл).
   * Выбор частоты снимает паузу и включает дайджест; «Не присылать» выключает и снимает паузу
   * (напоминания о сохранённых снова идут). Экран правится на месте, ниже — что изменилось.
   */
  async function setDigestMode(u: BotUser, want: string, msg: TgMessage | undefined) {
    const modes: T.DigestMode[] = ["w1", "w2", "w4", "pause", "off"];
    if (!modes.includes(want as T.DigestMode)) return send(u.tg_id, T.settings(u, now()));
    const mode = want as T.DigestMode;
    const same = T.digestMode(u, now()) === mode;
    if (!same) {
      const weeks = { w1: 1, w2: 2, w4: 4 } as Record<string, number>;
      if (mode === "pause") {
        u = await store.saveUser({ tg_id: u.tg_id, paused_until: new Date(now().getTime() + PAUSE_DAYS * 864e5).toISOString() });
        await track(u.tg_id, "pause");
      } else if (mode === "off") {
        u = await store.saveUser({ tg_id: u.tg_id, digest_on: false, paused_until: null });
        await track(u.tg_id, "unsubscribe", { meta: { from: "settings_digest" } });
      } else {
        u = await store.saveUser({ tg_id: u.tg_id, digest_on: true, digest_every_weeks: weeks[mode], paused_until: null });
        if (weeks[mode] > 1) await track(u.tg_id, "settings_less", { meta: { weeks: weeks[mode] } });
      }
    }
    const screen = T.settings(u, now());
    if (msg && !same) {
      await tg
        .call("editMessageText", { chat_id: u.tg_id, message_id: msg.message_id, text: screen.text, parse_mode: "HTML", reply_markup: screen.reply_markup })
        .catch(() => undefined);
    }
    return send(u.tg_id, T.settingsDone(u, now(), mode, nextDigestDate(u, now()), same));
  }

  async function guarded(tgId: number, fn: () => Promise<void>) {
    try {
      await fn();
    } catch (e) {
      if (e instanceof BotBlockedError) {
        await store.saveUser({ tg_id: tgId, blocked: true }).catch(() => undefined);
        await track(tgId, "blocked");
        return;
      }
      throw e;
    }
  }

  /** Одно обновление от Telegram. Группы и каналы игнорируются: бот только для личных чатов. */
  /** Сбой защиты от повторов не должен ронять бота: тогда обрабатываем как новое. */
  async function firstTime(key: string, windowSec: number): Promise<boolean> {
    try {
      return await store.seenOnce(key, windowSec);
    } catch (e) {
      console.error(`[races-bot] seenOnce ${key}: ${e instanceof Error ? e.message : String(e)}`);
      return true;
    }
  }

  async function handleUpdate(update: TgUpdate): Promise<void> {
    // Telegram повторил то же обновление (таймаут, 5xx): второй раз не обрабатываем.
    if (update.update_id !== undefined && !(await firstTime(`u:${update.update_id}`, 2 * 86400))) return;
    if (update.my_chat_member) {
      const m = update.my_chat_member;
      if (m.chat.type !== "private") return;
      const blocked = m.new_chat_member.status === "kicked";
      if (blocked || m.new_chat_member.status === "member") {
        const was = await store.getUser(m.from.id);
        if (was && was.blocked !== blocked) {
          await store.saveUser({ tg_id: m.from.id, blocked });
          if (blocked) await track(m.from.id, "blocked", { meta: { via: "my_chat_member" } });
        }
      }
      return;
    }
    if (update.callback_query) {
      const q = update.callback_query;
      await tg.call("answerCallbackQuery", { callback_query_id: q.id }).catch(() => undefined);
      if (q.message && q.message.chat.type !== "private") return;
      // Двойной клик: та же кнопка тем же человеком за 3 секунды — второй раз ничего не делаем
      // (было: unsubscribe дважды за секунду).
      if (!(await firstTime(`cb:${q.from.id}:${q.data || ""}`, DOUBLE_CLICK_SEC))) return;
      const u = await ensureUser(q.from);
      // Нажатие для статистики по дням: что именно (часть до «:»), без самих данных.
      const k = (q.data || "").split(":")[0];
      if (k && k !== "noop") await track(u.tg_id, "tap", { meta: { k } });
      return guarded(u.tg_id, () => onCallback(u, q.data || "", q.message));
    }
    const m = update.message;
    if (!m || m.chat.type !== "private" || !m.from) return;
    const u = await ensureUser(m.from);
    // Нажатие для статистики по дням: /start пишется своим событием start, остальное — tap.
    const cmd = typeof m.text === "string" ? m.text.trim().match(/^\/(\w+)/)?.[1] : null;
    if (cmd !== "start") await track(u.tg_id, "tap", { meta: { k: cmd ? `/${cmd}` : m.location ? "geo" : typeof m.text === "string" ? "text" : "other" } });
    if (m.location) return guarded(u.tg_id, () => onLocation(u, m.location!.latitude, m.location!.longitude));
    if (typeof m.text === "string") return guarded(u.tg_id, () => onText(u, m.text as string));
    // Стикер, фото, голосовое, документ: вежливо и с меню, без падения.
    return guarded(u.tg_id, () => send(u.tg_id, T.unknownInput(u.city)));
  }

  /** Почасовой тик: что пора, тому и шлём. Повторов нет: claimSend до отправки, releaseSend при сбое. */
  async function runTick(): Promise<Record<string, number>> {
    const t = now();
    const [users, follows, sentByUser, races] = await Promise.all([
      store.listActiveUsers(),
      store.listAllFollows(),
      store.listSentKeys(),
      deps.races(),
    ]);
    const racesById = new Map(races.map((r) => [r.id, r]));
    const byUser = new Map<number, BotFollow[]>();
    for (const f of follows) {
      if (!byUser.has(f.tg_id)) byUser.set(f.tg_id, []);
      byUser.get(f.tg_id)!.push(f);
    }
    const counts: Record<string, number> = { users: users.length, sent: 0, blocked: 0, errors: 0, announced: 0 };
    await store.pruneSeen().catch((e) => console.error(`[races-bot] pruneSeen: ${e instanceof Error ? e.message : String(e)}`));
    counts.weekly = await sendWeekly(t).catch((e) => {
      counts.errors += 1;
      console.error(`[races-bot] weekly: ${e instanceof Error ? e.message : String(e)}`);
      return 0;
    });
    counts.nudged = await runNudge().catch((e) => {
      counts.errors += 1;
      console.error(`[races-bot] nudge: ${e instanceof Error ? e.message : String(e)}`);
      return 0;
    });
    // «Объявили дату»: одно сообщение подписавшимся, старт сразу в «Мои забеги». Тихие часы уважаем.
    try {
      const userById = new Map(users.map((x) => [x.tg_id, x]));
      for (const w of await store.listDueAnnouncements()) {
        const u = userById.get(w.tg_id);
        const r = racesById.get(w.race_id);
        if (!u || !r) continue;
        const { hour } = localParts(t, u.tz || "Europe/Moscow");
        if (hour < 9 || hour >= 22) continue;
        try {
          await send(u.tg_id, T.announced(r));
          await store.addFollow(u.tg_id, r);
          await store.markWatchNotified(w.id);
          await track(u.tg_id, "expected_announced", { raceId: r.id, meta: { race_name: r.name, expected_id: w.expected_id } });
          counts.announced += 1;
        } catch (e) {
          if (e instanceof BotBlockedError) {
            await store.saveUser({ tg_id: u.tg_id, blocked: true });
            await track(u.tg_id, "blocked");
            await store.markWatchNotified(w.id);
          } else throw e;
        }
      }
    } catch (e) {
      counts.errors += 1;
      console.error(`[races-bot] объявленные даты: ${e instanceof Error ? e.message : String(e)}`);
    }
    for (const u of users) {
      const mine = byUser.get(u.tg_id) ?? [];
      const actions = planUser({ now: t, user: u, follows: mine, racesById, races, sent: sentByUser.get(u.tg_id) ?? new Set() });
      for (const a of actions) {
        try {
          if (a.kind === "drop") {
            await store.removeFollow(u.tg_id, a.follow.race_id);
            continue;
          }
          if (a.kind === "digest") {
            if (!(await store.claimSend(u.tg_id, "digest", null))) continue;
            // Одно сообщение (оно же новое меню): кнопки 1–N открывают старт в нём же.
            await send(u.tg_id, T.digestScreen(u.city!, a.races, a.area, a.subject));
            await store.saveUser({ tg_id: u.tg_id, digest_last_at: t.toISOString() });
            await track(u.tg_id, "digest_sent", { meta: { n: a.races.length, area: a.area.length } });
            counts.sent += 1;
            continue;
          }
          const raceId = "race" in a ? a.race.id : a.follow.race_id;
          if (!(await store.claimSend(u.tg_id, a.kind, raceId))) continue;
          try {
            if (a.kind === "w12") {
              const withConsult = consultAllowed(u.consult_offered_at, t);
              await send(u.tg_id, T.weeks12(a.race, withConsult));
              if (withConsult) {
                await store.saveUser({ tg_id: u.tg_id, consult_offered_at: t.toISOString() });
                await track(u.tg_id, "consult_offer_shown", { raceId: a.race.id, meta: { after: "w12" } });
              }
            } else if (a.kind === "d7") {
              await send(u.tg_id, T.week1(a.race, siteLink(u, a.race)));
            } else if (a.kind === "d1") {
              const w = deps.weather && a.race.city ? await deps.weather(a.race.city, a.race.ds).catch(() => null) : null;
              await send(u.tg_id, T.dayBefore(a.race, w, siteLink(u, a.race)));
            } else if (a.kind === "after") {
              await send(u.tg_id, T.afterFinish(a.follow));
              await store.removeFollow(u.tg_id, a.follow.race_id);
            } else if (a.kind === "cancelled") {
              await send(u.tg_id, T.cancelled(a.follow));
              await store.removeFollow(u.tg_id, a.follow.race_id);
            }
            counts.sent += 1;
          } catch (e) {
            if (!(e instanceof BotBlockedError)) await store.releaseSend(u.tg_id, a.kind, raceId);
            throw e;
          }
        } catch (e) {
          if (e instanceof BotBlockedError) {
            await store.saveUser({ tg_id: u.tg_id, blocked: true });
            await track(u.tg_id, "blocked");
            counts.blocked += 1;
            break;
          }
          counts.errors += 1;
          console.error(`[races-bot] tick ${u.tg_id} ${a.kind}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    return counts;
  }

  /** Мини-апп внутри Telegram: список сохранённых и звёздочка «Следить / Не следить». */
  async function miniapp(
    from: TgUser,
    action: "list" | "follow" | "unfollow" | "event",
    raceId?: string,
    opened?: string | null,
    ev?: { a: MiniappAction; v?: string | null },
  ): Promise<string[]> {
    const u = await ensureUser(from);
    // opened — откуда открыт календарь (from в ссылке web_app): first, list, menu, my, reminder.
    if (action === "list") await track(u.tg_id, "open_calendar", { meta: { from: opened ?? null } });
    // Что делают внутри календаря: сезон/вкладка, фильтр, открыл старт, «Регистрация», «Сайт».
    if (action === "event" && ev && (MINIAPP_ACTIONS as readonly string[]).includes(ev.a)) {
      await track(u.tg_id, "miniapp", { raceId: raceId ?? null, meta: { a: ev.a, v: ev.v ? String(ev.v).slice(0, 60) : null } });
      return (await store.listFollows(u.tg_id)).map((f) => f.race_id);
    }
    if ((action === "follow" || action === "unfollow") && raceId) await track(u.tg_id, "miniapp", { raceId, meta: { a: action } });
    if (action !== "list" && raceId) {
      if (action === "follow") {
        const r = (await deps.races()).find((x) => x.id === raceId);
        if (r) {
          await store.addFollow(u.tg_id, r);
          await track(u.tg_id, "follow", { raceId: r.id, meta: { race_name: r.name, city: r.city, via: "miniapp" } });
        }
      } else {
        await store.removeFollow(u.tg_id, raceId);
        await track(u.tg_id, "unfollow", { raceId, meta: { via: "miniapp" } });
      }
    }
    return (await store.listFollows(u.tg_id)).map((f) => f.race_id);
  }

  /** Клик по igorp.run/go/<код>: записать и вернуть адрес для 302. */
  async function click(tgId: number | null, r: BotRace, kind: "r" | "s"): Promise<string> {
    await track(tgId, kind === "r" ? "click_registration" : "click_site", { raceId: r.id, meta: { race_name: r.name } });
    return kind === "r" ? r.reg || r.site || T.raceUrl(r) : r.site || T.raceUrl(r);
  }

  /**
   * Еженедельный итог тренеру (наряд 13.10.2026): понедельник с 10:00 по Москве, один раз за неделю
   * (claimSend по дате понедельника), за прошедшие пн–вс. Включается race_bot_config.weekly_stats = '1'.
   */
  async function sendWeekly(t: Date): Promise<number> {
    if ((await store.getConfig("weekly_stats")) !== "1") return 0;
    const coachChat = await store.getConfig("coach_chat_id");
    if (!coachChat) return 0;
    const { date, hour, weekday } = localParts(t, "Europe/Moscow");
    if (weekday !== 1 || hour < 10) return 0;
    if (!(await store.claimSend(Number(coachChat), "weekly_stats", date))) return 0;
    // конец воскресенья по Москве: понедельник 00:00 МСК минус миллисекунда
    const sundayEnd = new Date(Date.parse(`${date}T00:00:00+03:00`) - 1);
    try {
      await sendRaw(Number(coachChat), { text: weeklyMessage(await store.loadStats(7, sundayEnd)) });
    } catch (e) {
      await store.releaseSend(Number(coachChat), "weekly_stats", date);
      throw e;
    }
    return 1;
  }

  /**
   * Одно мягкое напоминание тем, кто пришёл 30 минут — 3 часа назад и после /start ничего не нажал.
   * Один раз навсегда: claimSend по ключу (nudge, start). Ночью (22–9) не шлём и потом не догоняем:
   * напоминание через 10 часов уже не «через 30 минут». Зовётся тиком раз в 10 минут и почасовым.
   */
  async function runNudge(): Promise<number> {
    const t = now();
    const from = new Date(t.getTime() - NUDGE_MAX_MIN * 60000).toISOString();
    const to = new Date(t.getTime() - NUDGE_AFTER_MIN * 60000).toISOString();
    let n = 0;
    for (const u of await store.listNudgeCandidates(from, to)) {
      const { hour } = localParts(t, u.tz || "Europe/Moscow");
      if (hour < 9 || hour >= 22) continue;
      if (!(await store.claimSend(u.tg_id, "nudge", "start"))) continue;
      try {
        await send(u.tg_id, T.nudge());
        await track(u.tg_id, "nudge_sent");
        n += 1;
      } catch (e) {
        if (e instanceof BotBlockedError) {
          await store.saveUser({ tg_id: u.tg_id, blocked: true });
          await track(u.tg_id, "blocked");
        } else {
          // Сбой сети — не «отправлено»: снять отметку, следующий тик попробует (пока в окне).
          await store.releaseSend(u.tg_id, "nudge", "start");
          console.error(`[races-bot] nudge ${u.tg_id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    return n;
  }

  return { handleUpdate, runTick, runNudge, miniapp, click };
}
