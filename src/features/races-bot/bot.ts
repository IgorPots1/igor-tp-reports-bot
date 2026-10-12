/* Бот «Забеги России»: обработка сообщений, почасовой тик и действия мини-аппа.
 *
 * Хранилище, Telegram, погода и геокодер приходят снаружи (deps): в бою это Supabase и
 * Bot API (store-supabase.ts, tg-api.ts), в чеке — память и запись исходящих вызовов
 * (scripts/check-races-bot.ts). Поэтому все экраны и плановые сообщения проверяются на
 * тестовых датах без сети и без настоящего Telegram. */

import { norm } from "@/app/races/races-logic";

import {
  consultAllowed,
  findCityBySlug,
  findRaceByCode,
  inCity,
  inUserCity,
  knownCities,
  localParts,
  matchCity,
  matchUser,
  parseSearch,
  parseStart,
  planUser,
  raceCode,
  searchRaces,
  type BotRace,
  type PlanFollow,
  type PlanUser,
} from "./core";
import * as T from "./texts";

export type BotUser = PlanUser & {
  first_name: string | null;
  username: string | null;
  source: string | null;
  state: string | null;
  consult_offered_at: string | null;
  consult_requested_at: string | null;
};

export type BotFollow = PlanFollow & { tg_id: number };

export type BotStats = Parameters<typeof T.stats>[0];

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
  stats(now: Date): Promise<BotStats>;
}

export class BotBlockedError extends Error {}

export interface BotTg {
  call(method: string, params: Record<string, unknown>): Promise<unknown>;
}

export type BotDeps = {
  store: BotStore;
  tg: BotTg;
  races: () => Promise<BotRace[]>;
  now?: () => Date;
  coachUsername: string;
  reverseGeocode?: (lat: number, lon: number) => Promise<string | null>;
  weather?: (city: string, dateIso: string) => Promise<T.Weather | null>;
};

type TgUser = { id: number; first_name?: string; username?: string };
type TgMessage = {
  message_id: number;
  chat: { id: number; type: string };
  from?: TgUser;
  text?: string;
  location?: { latitude: number; longitude: number };
};
export type TgUpdate = {
  update_id?: number;
  message?: TgMessage;
  callback_query?: { id: string; from: TgUser; data?: string; message?: TgMessage };
};

export function createBot(deps: BotDeps) {
  const { store, tg } = deps;
  const now = deps.now ?? (() => new Date());
  const coach = deps.coachUsername.replace(/^@/, "").toLowerCase();

  async function send(chatId: number, msg: T.Msg): Promise<void> {
    await tg.call("sendMessage", {
      chat_id: chatId,
      text: msg.text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...(msg.reply_markup ? { reply_markup: msg.reply_markup } : {}),
    });
  }

  async function ensureUser(from: TgUser): Promise<BotUser> {
    const u = await store.getUser(from.id);
    if (from.username && from.username.toLowerCase() === coach) {
      await store.setConfig("coach_chat_id", String(from.id));
    }
    if (!u) return store.saveUser({ tg_id: from.id, first_name: from.first_name ?? null, username: from.username ?? null });
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
    await send(chatId, T.greeting(races.length, knownCities(races).length));
  }

  async function showCityList(u: BotUser) {
    if (!u.city) return greet(u.tg_id);
    const races = (await deps.races()).filter((r) => inUserCity(r, u.city) && matchUser(r, u.types, u.distances));
    const where = inCity(u.city);
    if (!races.length) return send(u.tg_id, T.nothingFound(where, u.city));
    const following = await followingSet(u.tg_id);
    await send(u.tg_id, T.listHeader(where, u.types, u.distances));
    for (const r of races.slice(0, 5)) await send(u.tg_id, T.card(r, following.has(r.id)));
    await send(u.tg_id, T.listFooter(races.length - 5, u.city, u.digest_on));
  }

  async function showSearch(u: BotUser, text: string) {
    const all = await deps.races();
    const s = parseSearch(text);
    const city = s.q ? matchCity(knownCities(all), s.q) : null;
    const found = city
      ? all.filter((r) => inUserCity(r, city) && matchUser(r, s.types, s.dists) && (!s.month || Number(r.ds.slice(5, 7)) === s.month))
      : searchRaces(all, s);
    const where = city ? inCity(city) : `по запросу «${T.esc(text.trim())}»`;
    if (!found.length) return send(u.tg_id, T.nothingFound(where, s.q || undefined));
    const following = await followingSet(u.tg_id);
    await send(u.tg_id, T.listHeader(where, s.types, s.dists));
    for (const r of found.slice(0, 5)) await send(u.tg_id, T.card(r, following.has(r.id)));
    const digestOffer = city && norm(city) === norm(u.city) ? city : null;
    await send(u.tg_id, T.listFooter(found.length - 5, digestOffer, u.digest_on, s.q || undefined));
  }

  async function follow(u: BotUser, r: BotRace) {
    await store.addFollow(u.tg_id, r);
    const offer = consultAllowed(u.consult_offered_at, now());
    if (offer) {
      await send(u.tg_id, T.saved(r));
      await send(u.tg_id, T.consultOffer(raceCode(r.id)));
      await store.saveUser({ tg_id: u.tg_id, consult_offered_at: now().toISOString() });
    } else {
      await send(u.tg_id, { ...T.saved(r), reply_markup: T.NAV });
    }
  }

  async function showMy(u: BotUser) {
    const races = await deps.races();
    const byId = new Map(races.map((r) => [r.id, r]));
    const items = (await store.listFollows(u.tg_id))
      .map((f) => byId.get(f.race_id))
      .filter((r): r is BotRace => !!r)
      .sort((a, b) => a.ds.localeCompare(b.ds))
      .map((race) => ({ race, code: raceCode(race.id) }));
    await send(u.tg_id, T.myRaces(items, today(u)));
  }

  async function consult(u: BotUser, code: string) {
    const races = await deps.races();
    const follows = await store.listFollows(u.tg_id);
    const byId = new Map(races.map((r) => [r.id, r]));
    const raceName = (code && code !== "-" ? findRaceByCode(races, code)?.name : null) ?? null;
    const names = follows.map((f) => byId.get(f.race_id)?.name ?? f.race_name).filter((x): x is string => !!x);
    const coachChat = await store.getConfig("coach_chat_id");
    if (coachChat) {
      await send(Number(coachChat), { text: T.coachNotice(u, names) });
    } else {
      console.error("[races-bot] заявка на консультацию, но chat_id тренера ещё не известен (он не писал боту /start)");
    }
    await send(u.tg_id, T.consultReply(deps.coachUsername.replace(/^@/, ""), raceName ?? names[0] ?? null));
    await store.saveUser({ tg_id: u.tg_id, consult_requested_at: now().toISOString() });
  }

  async function onStart(u: BotUser, param: string | undefined) {
    const p = parseStart(param);
    if (p.kind === "race") {
      if (!u.source) u = await store.saveUser({ tg_id: u.tg_id, source: "site_race" });
      const r = findRaceByCode(await deps.races(), p.code);
      if (r) return follow(u, r);
      await send(u.tg_id, { text: "Этот забег уже прошёл или убран из календаря." });
      return greet(u.tg_id);
    }
    if (p.kind === "city") {
      const races = await deps.races();
      const city = findCityBySlug(knownCities(races), p.slug);
      if (city) {
        u = await store.saveUser({ tg_id: u.tg_id, city, digest_on: true, state: null, source: u.source ?? "site_city" });
        return send(
          u.tg_id,
          T.prefs(u.types, u.distances, `Подписал на новые забеги ${inCity(city)}: одно сообщение в неделю, по понедельникам.`),
        );
      }
      return greet(u.tg_id);
    }
    if (p.kind === "src" && !u.source) await store.saveUser({ tg_id: u.tg_id, source: p.label });
    return greet(u.tg_id);
  }

  async function setCity(u: BotUser, city: string, lead?: string) {
    u = await store.saveUser({ tg_id: u.tg_id, city, state: null });
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
          reply_markup: { inline_keyboard: [[{ text: "Открыть календарь", web_app: { url: T.CALENDAR_URL } }]] },
        });
      }
      if (name === "city") return greet(u.tg_id);
      if (name === "settings") return send(u.tg_id, T.settings(u, now()));
      if (name === "delete") return send(u.tg_id, T.DELETE_CONFIRM);
      if (name === "stats") {
        const coachChat = await store.getConfig("coach_chat_id");
        if (coachChat && Number(coachChat) === u.tg_id) return send(u.tg_id, { text: T.stats(await store.stats(now())) });
        return send(u.tg_id, { text: "Такой команды нет. Напиши город или, например, «трейл Казань»." });
      }
      return send(u.tg_id, { text: "Такой команды нет. Напиши город или, например, «трейл Казань»." });
    }
    if (u.state === "await_city") {
      const city = matchCity(knownCities(await deps.races()), t) ?? t.slice(0, 60);
      return setCity(u, city);
    }
    return showSearch(u, t);
  }

  async function onLocation(u: BotUser, lat: number, lon: number) {
    const name = deps.reverseGeocode ? await deps.reverseGeocode(lat, lon) : null;
    if (!name) {
      await send(u.tg_id, { text: "Не получилось определить город по геолокации. Напиши его словами.", reply_markup: { remove_keyboard: true } });
      await store.saveUser({ tg_id: u.tg_id, state: "await_city" });
      return;
    }
    const city = matchCity(knownCities(await deps.races()), name) ?? name;
    await send(u.tg_id, { text: `Город: ${T.esc(city)}`, reply_markup: { remove_keyboard: true } });
    return setCity(u, city);
  }

  async function onCallback(u: BotUser, data: string, msg: TgMessage | undefined) {
    const i = data.indexOf(":");
    const key = i < 0 ? data : data.slice(0, i);
    const arg = i < 0 ? "" : data.slice(i + 1);
    switch (key) {
      case "city": {
        const races = await deps.races();
        const city = findCityBySlug([...T.TOP_CITIES, ...knownCities(races)], arg);
        return city ? setCity(u, city) : greet(u.tg_id);
      }
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
        return showCityList(u);
      case "dg":
        await store.saveUser({ tg_id: u.tg_id, digest_on: arg === "on" });
        return send(u.tg_id, arg === "on" ? T.DIGEST_ON : T.DIGEST_OFF);
      case "f": {
        const r = findRaceByCode(await deps.races(), arg);
        if (!r) return send(u.tg_id, { text: "Этот забег уже прошёл или убран из календаря." });
        return follow(u, r);
      }
      case "u": {
        const f = (await store.listFollows(u.tg_id)).find((x) => raceCode(x.race_id) === arg);
        if (f) await store.removeFollow(u.tg_id, f.race_id);
        return showMy(u);
      }
      case "my":
        return showMy(u);
      case "consult":
        return consult(u, arg);
      case "noconsult":
        return send(u.tg_id, T.NO_CONSULT);
      case "s": {
        if (arg === "rarer") {
          u = await store.saveUser({ tg_id: u.tg_id, digest_every_weeks: u.digest_every_weeks === 2 ? 1 : 2 });
        } else if (arg === "pause") {
          const paused = u.paused_until && Date.parse(u.paused_until) > now().getTime();
          u = await store.saveUser({
            tg_id: u.tg_id,
            paused_until: paused ? null : new Date(now().getTime() + 30 * 864e5).toISOString(),
          });
        } else if (arg === "city") {
          return greet(u.tg_id);
        } else if (arg === "unsub") {
          await store.removeAllFollows(u.tg_id);
          await store.saveUser({ tg_id: u.tg_id, digest_on: false });
          return send(u.tg_id, T.UNSUBSCRIBED);
        }
        return send(u.tg_id, T.settings(u, now()));
      }
      case "del":
        if (arg === "yes") {
          await store.deleteUser(u.tg_id);
          return send(u.tg_id, T.DELETED);
        }
        return send(u.tg_id, T.DELETE_CANCELLED);
      default:
        return;
    }
  }

  async function guarded(tgId: number, fn: () => Promise<void>) {
    try {
      await fn();
    } catch (e) {
      if (e instanceof BotBlockedError) {
        await store.saveUser({ tg_id: tgId, blocked: true }).catch(() => undefined);
        return;
      }
      throw e;
    }
  }

  /** Одно обновление от Telegram. Группы и каналы игнорируются: бот только для личных чатов. */
  async function handleUpdate(update: TgUpdate): Promise<void> {
    if (update.callback_query) {
      const q = update.callback_query;
      await tg.call("answerCallbackQuery", { callback_query_id: q.id }).catch(() => undefined);
      if (q.message && q.message.chat.type !== "private") return;
      const u = await ensureUser(q.from);
      return guarded(u.tg_id, () => onCallback(u, q.data || "", q.message));
    }
    const m = update.message;
    if (!m || m.chat.type !== "private" || !m.from) return;
    const u = await ensureUser(m.from);
    if (m.location) return guarded(u.tg_id, () => onLocation(u, m.location!.latitude, m.location!.longitude));
    if (m.text) return guarded(u.tg_id, () => onText(u, m.text!));
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
    const counts: Record<string, number> = { users: users.length, sent: 0, blocked: 0, errors: 0 };
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
            const following = new Set(mine.map((f) => f.race_id));
            for (const m of T.digest(u.city!, a.races, following)) await send(u.tg_id, m);
            await store.saveUser({ tg_id: u.tg_id, digest_last_at: t.toISOString() });
            counts.sent += 1;
            continue;
          }
          const raceId = "race" in a ? a.race.id : a.follow.race_id;
          if (!(await store.claimSend(u.tg_id, a.kind, raceId))) continue;
          try {
            if (a.kind === "w12") {
              const withConsult = consultAllowed(u.consult_offered_at, t);
              await send(u.tg_id, T.weeks12(a.race, withConsult));
              if (withConsult) await store.saveUser({ tg_id: u.tg_id, consult_offered_at: t.toISOString() });
            } else if (a.kind === "d7") {
              await send(u.tg_id, T.week1(a.race));
            } else if (a.kind === "d1") {
              const w = deps.weather && a.race.city ? await deps.weather(a.race.city, a.race.ds).catch(() => null) : null;
              await send(u.tg_id, T.dayBefore(a.race, w));
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
  async function miniapp(from: TgUser, action: "list" | "follow" | "unfollow", raceId?: string): Promise<string[]> {
    const u = await ensureUser(from);
    if (action !== "list" && raceId) {
      if (action === "follow") {
        const r = (await deps.races()).find((x) => x.id === raceId);
        if (r) await store.addFollow(u.tg_id, r);
      } else {
        await store.removeFollow(u.tg_id, raceId);
      }
    }
    return (await store.listFollows(u.tg_id)).map((f) => f.race_id);
  }

  return { handleUpdate, runTick, miniapp };
}
