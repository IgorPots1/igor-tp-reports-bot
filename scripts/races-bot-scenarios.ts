/**
 * Бот «Забеги России» (@ruruns_bot): полный прогон сценариев на фейковых tg_id, таблица PASS/FAIL.
 *
 *   npx tsx scripts/races-bot-scenarios.ts          — в памяти: хранилище memStore, старты-фикстуры.
 *   npx tsx --env-file=<.env.local> scripts/races-bot-scenarios.ts --live
 *                                                    — через обработчик webhook (POST route.ts) локально,
 *     настоящая база и настоящие старты, фейковые tg_id 990000101+. Telegram перехвачен: ни одного
 *     сообщения наружу (в том числе уведомление тренеру о консультации). Геокодер перехвачен («Казань»).
 *     Плановый тик (дайджест) в live НЕ запускается: он прошёл бы по живым людям и записал им
 *     race_bot_sends. После прогона данные фейковых tg_id удаляются; сами id остаются в
 *     race_bot_config.stats_exclude.
 */

import assert from "node:assert/strict";

import { toRace, type RaceRow } from "@/app/races/races-logic";
import { BotBlockedError, createBot, type BotStore, type TgUpdate } from "@/features/races-bot/bot";
import { raceCode, type BotRace, type ExpectedItem } from "@/features/races-bot/core";
import { computeBotStats, type StatEvent } from "@/features/races-bot/stats";

import { memStore } from "./lib/races-bot-memstore";

const LIVE = process.argv.includes("--live");

// ── запись исходящих вызовов Telegram (общая для обоих режимов) ──────────────

type Call = { method: string; params: Record<string, unknown> };
const calls: Call[] = [];
const blockedChats = new Set<number>();
type Btn = { text: string; callback_data?: string; url?: string; web_app?: unknown };
const buttons = (c: Call) => ((c.params.reply_markup as { inline_keyboard?: Btn[][] } | undefined)?.inline_keyboard ?? []).flat();
const sentTo = (id: number, from = 0) => calls.slice(from).filter((c) => c.method === "sendMessage" && Number(c.params.chat_id) === id);
const textsTo = (id: number, from = 0) => sentTo(id, from).map((c) => String(c.params.text));
const allText = (id: number, from = 0) => textsTo(id, from).join("\n");
const btnsTo = (id: number, from = 0) => sentTo(id, from).flatMap(buttons);

// ── фикстуры для режима в памяти ────────────────────────────────────────────

function race(id: string, name: string, ds: string, city: string, region: string, type: string, km: number[]): BotRace {
  const row: RaceRow = {
    id, source: "probeg", source_url: `https://probeg.org/event/${id}/`, name, date_start: ds, date_end: ds,
    city, region, distances: km.map((k) => `${k} км`), dist_km: km, race_type: type, tags: [], site_url: "https://example.org/race",
    reg_url: "https://reg.example.org/r", vk_url: null, sources: ["probeg"], link_ok: true, alt_dates: [], checked_note: null,
  };
  return { ...toRace(row), firstSeen: "2026-10-08T00:00:00Z" };
}
const day = (i: number) => new Date(Date.parse("2026-10-20") + i * 864e5).toISOString().slice(0, 10);
const MEM_RACES: BotRace[] = [
  ...Array.from({ length: 30 }, (_, i) => race(`probeg:m${i}`, `Московский забег ${i + 1}`, day(i * 3), "Москва", "Москва", i % 4 === 0 ? "trail" : "road", [10, 21.1])),
  race("probeg:s1", "Белые ночи", "2027-06-27", "Санкт-Петербург", "Санкт-Петербург", "road", [42.2]),
  race("probeg:s2", "Пушкинский полумарафон", "2027-05-10", "Санкт-Петербург", "Санкт-Петербург", "road", [21.1]),
  race("probeg:s3", "Невский трейл", "2027-04-10", "Санкт-Петербург", "Санкт-Петербург", "trail", [15]),
  race("probeg:e1", "Ural Marathon", "2027-08-01", "Екатеринбург", "Свердловская область", "road", [42.2]),
  race("probeg:e2", "Екатеринбургский ночной", "2027-07-01", "Екатеринбург", "Свердловская область", "road", [10]),
  race("probeg:e3", "Уральский трейл", "2027-06-01", "Екатеринбург", "Свердловская область", "trail", [20]),
  race("probeg:k1", "Казанский марафон", "2027-05-01", "Казань", "Татарстан", "road", [42.2]),
  race("probeg:k2", "Казанский трейл", "2027-05-20", "Казань", "Татарстан", "trail", [15]),
  race("probeg:k3", "Казань 10", "2027-06-20", "Казань", "Татарстан", "road", [10]),
  race("probeg:n1", "Нижегородский полумарафон", "2027-05-15", "Нижний Новгород", "Нижегородская область", "road", [21.1]),
  race("probeg:n2", "Волжский забег", "2027-06-15", "Нижний Новгород", "Нижегородская область", "road", [10]),
  race("probeg:n3", "Кремлёвский трейл", "2027-07-15", "Нижний Новгород", "Нижегородская область", "trail", [12]),
  race("probeg:t1", "Тверской забег", "2027-05-09", "Тверь", "Тверская область", "road", [10]),
  race("probeg:t2", "Ржевский полумарафон", "2027-06-09", "Ржев", "Тверская область", "road", [21.1]),
];
const MEM_EXPECTED: ExpectedItem[] = [
  { id: "probeg:x1", name: "Тверской марафон", city: "Тверь", region: "Тверская область", type: "road", distances: ["42 км"], km: [42.2], lastMonth: 9, lastDate: "2026-09-20", lastUrl: "https://probeg.org/event/x1/", site: "" },
];

// ── окружение прогона ────────────────────────────────────────────────────────

type Env = {
  store: BotStore;
  races: BotRace[];
  update(u: TgUpdate): Promise<void>;
  events(id: number): Promise<StatEvent[]>;
  click(id: number, r: BotRace, kind: "r" | "s"): Promise<string>;
  miniapp(id: number): Promise<void>;
  tick: null | (() => Promise<Record<string, number>>);
  pause(): Promise<void>;
  cleanup(ids: number[]): Promise<void>;
};

const NOW = new Date("2026-10-12T10:00:00Z"); // понедельник, 13:00 по Москве: окно дайджеста
let CLICK = Date.parse("2026-10-12T10:00:00Z");

function memEnv(): Env {
  const store = memStore({ now: () => NOW, announced: new Map(), clock: () => CLICK });
  store.config.set("coach_chat_id", "900");
  const bot = createBot({
    store,
    tg: {
      async call(method, params) {
        if (method === "sendMessage" && blockedChats.has(Number(params.chat_id))) throw new BotBlockedError("Forbidden: bot was blocked by the user");
        calls.push({ method, params });
        return { message_id: calls.length };
      },
    },
    races: async () => MEM_RACES,
    expected: async () => MEM_EXPECTED,
    now: () => NOW,
    coachUsername: "IgorPotseluev",
    reverseGeocode: async () => "Казань",
    weather: async () => null,
    goLink: (tg, r, kind) => `https://igorp.run/go/${kind}${raceCode(r.id)}-${tg.toString(36)}-0123456789`,
  });
  return {
    store,
    races: MEM_RACES,
    update: (u) => bot.handleUpdate(u),
    events: async (id) => store.events.filter((e) => e.tg_id === id),
    click: (id, r, kind) => bot.click(id, r, kind),
    miniapp: async (id) => void (await bot.miniapp({ id, first_name: "Тест" }, "list")),
    tick: () => bot.runTick(),
    pause: async () => void (CLICK += 5000),
    cleanup: async () => undefined,
  };
}

async function liveEnv(): Promise<Env> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://api.telegram.org/")) {
      const method = url.split("/").at(-1)!;
      const params = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      if (method === "sendMessage" && blockedChats.has(Number(params.chat_id))) {
        return new Response(JSON.stringify({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }));
      }
      calls.push({ method, params });
      return new Response(JSON.stringify({ ok: true, result: { message_id: calls.length } }));
    }
    if (url.startsWith("https://nominatim.openstreetmap.org/")) return new Response(JSON.stringify({ address: { city: "Казань" } }));
    return realFetch(input as RequestInfo, init);
  }) as typeof fetch;

  const rt = await import("@/features/races-bot/runtime");
  const { POST } = await import("@/app/api/races-bot/webhook/route");
  const { createSupabaseServerClient } = await import("@/features/supabase/server");
  const sb = createSupabaseServerClient();
  const secret = rt.webhookSecret();
  const races = await rt.loadBotRaces();
  return {
    store: rt.supabaseStore,
    races,
    async update(u) {
      const res = await POST(new Request("http://localhost/api/races-bot/webhook", {
        method: "POST",
        headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
        body: JSON.stringify(u),
      }));
      assert.equal(res.status, 200, "webhook ответил 200");
    },
    async events(id) {
      const { data, error } = await sb.from("race_bot_events").select("tg_id,event,race_id,source,meta,created_at").eq("tg_id", id).order("created_at");
      if (error) throw new Error(error.message);
      return (data ?? []) as StatEvent[];
    },
    click: (id, r, kind) => rt.productionBot().click(id, r, kind),
    miniapp: async (id) => void (await rt.productionBot().miniapp({ id, first_name: "Тест" }, "list")),
    tick: null,
    // Окно двойного клика — 3 секунды по часам базы: «второе нажатие позже» ждёт по-настоящему.
    pause: () => new Promise((r) => setTimeout(r, 3500)),
    async cleanup(ids) {
      for (const id of ids) {
        await rt.supabaseStore.deleteUser(id);
        await sb.from("race_bot_expected_watch").delete().eq("tg_id", id);
        await sb.from("race_bot_seen").delete().like("key", `cb:${id}:%`);
      }
      await sb.from("race_bot_seen").delete().like("key", `u:${UPDATE_BASE.toString().slice(0, 4)}%`);
    },
  };
}

// ── обновления ──────────────────────────────────────────────────────────────

const UPDATE_BASE = 9_900_000_000 + Math.floor(Date.now() / 1000) % 1_000_000 * 100;
let upd = UPDATE_BASE;
let mid = 1;
const BASE_ID = 990000100;
const usedIds: number[] = [];
let nextId = BASE_ID;
const person = (name: string) => {
  const id = ++nextId;
  usedIds.push(id);
  return { id, first_name: name, username: `fake_${id}` };
};
type P = ReturnType<typeof person>;
const msg = (p: P, text: string): TgUpdate => ({ update_id: ++upd, message: { message_id: mid++, chat: { id: p.id, type: "private" }, from: p, text } });
const other = (p: P, field: "sticker" | "photo" | "voice"): TgUpdate =>
  ({ update_id: ++upd, message: { message_id: mid++, chat: { id: p.id, type: "private" }, from: p, [field]: field === "photo" ? [{ file_id: "x" }] : { file_id: "x" } } }) as unknown as TgUpdate;
const loc = (p: P): TgUpdate => ({ update_id: ++upd, message: { message_id: mid++, chat: { id: p.id, type: "private" }, from: p, location: { latitude: 55.79, longitude: 49.12 } } });
const cbu = (p: P, data: string): TgUpdate => ({ update_id: ++upd, callback_query: { id: String(mid++), from: p, data, message: { message_id: mid, chat: { id: p.id, type: "private" } } } });

// ── сценарии ────────────────────────────────────────────────────────────────

type Row = { name: string; ok: boolean | null; note: string };
const rows: Row[] = [];

async function main() {
  const env = LIVE ? await liveEnv() : memEnv();
  const { store } = env;
  if (LIVE) {
    // Фейковые id — в исключения статистики до первого обновления (наряд 12.10, п.5).
    const ids = Array.from({ length: 40 }, (_, i) => BASE_ID + 1 + i);
    const cur = ((await store.getConfig("stats_exclude")) || "").split(/[\s,;]+/).filter(Boolean);
    const merged = [...new Set([...cur, ...ids.map(String)])].join(",");
    if (merged !== cur.join(",")) await store.setConfig("stats_exclude", merged);
  }
  const cb = async (p: P, data: string) => {
    await env.pause();
    await env.update(cbu(p, data));
  };
  const cityCount = new Map<string, number>();
  for (const r of env.races) cityCount.set(r.city, (cityCount.get(r.city) ?? 0) + 1);
  const bigCity = "Москва";
  const bigRaces = env.races.filter((r) => r.city === bigCity);

  async function scenario(name: string, fn: () => Promise<string | void>, memOnly = false) {
    if (memOnly && LIVE) {
      rows.push({ name, ok: null, note: "только в памяти (в live прошёл бы по живым людям)" });
      return;
    }
    try {
      const note = await fn();
      rows.push({ name, ok: true, note: note || "" });
    } catch (e) {
      rows.push({ name, ok: false, note: e instanceof Error ? e.message.split("\n")[0] : String(e) });
    }
  }
  const lastFrom = (p: P, from: number) => textsTo(p.id, from).at(-1) ?? "";

  // 1. Новый человек: /start → город кнопкой → фильтры → список → ⭐ → «Мои старты».
  await scenario("Новый: /start → город кнопкой → фильтры → список → ⭐ → Мои забеги", async () => {
    const p = person("Новый");
    let c = calls.length;
    await env.update(msg(p, "/start"));
    assert.match(allText(p.id, c), /Где ты бегаешь\?/, "приветствие с выбором города");
    await cb(p, "city:moskva");
    assert.equal((await store.getUser(p.id))?.city, "Москва");
    await cb(p, "t:road");
    c = calls.length;
    await cb(p, "show");
    const cards = sentTo(p.id, c).filter((m) => buttons(m).some((b) => b.text === "⭐ Следить"));
    assert.ok(cards.length >= 1 && cards.length <= 5, `карточек ${cards.length}`);
    assert.ok(textsTo(p.id, c).some((t) => t.includes("Нажми ⭐, и я напомню, когда пора начинать готовиться")), "подсказка про ⭐");
    const star = buttons(cards[0]).find((b) => b.text === "⭐ Следить")!.callback_data!;
    await cb(p, star);
    assert.equal((await store.listFollows(p.id)).length, 1);
    c = calls.length;
    await cb(p, "my");
    assert.ok(allText(p.id, c).length > 0, "«Мои забеги» ответил");
    const u = await store.getUser(p.id);
    assert.equal(u?.source, "direct", "первый приход без метки — direct");
    c = calls.length;
    await cb(p, "show");
    assert.ok(!textsTo(p.id, c).some((t) => t.includes("Нажми ⭐, и я напомню")), "подсказка только один раз");
    return `карточек ${cards.length}, source=direct`;
  });

  // 2. Город текстом, 5+ написаний, неизвестный город, текст без «Другой город».
  const spellings: [string, string][] = [["спб", "Санкт-Петербург"], ["питер", "Санкт-Петербург"], ["мск", "Москва"], ["екб", "Екатеринбург"], ["нижний", "Нижний Новгород"], ["Екатеренбург", "Екатеринбург"], ["казнь", "Казань"]];
  await scenario(`Город текстом: ${spellings.map(([s]) => s).join(", ")}`, async () => {
    const got: string[] = [];
    for (const [s, want] of spellings) {
      const p = person("Город");
      await env.update(msg(p, "/start"));
      await cb(p, "city_other");
      await env.update(msg(p, s));
      const city = (await store.getUser(p.id))?.city ?? null;
      got.push(`${s}→${city}`);
      assert.equal(city, want, `«${s}»`);
    }
    return got.join("; ");
  });
  await scenario("Город текстом сразу, без кнопки «Другой город» (мск)", async () => {
    const p = person("Сразу");
    await env.update(msg(p, "/start"));
    await env.update(msg(p, "мск"));
    assert.equal((await store.getUser(p.id))?.city, "Москва");
  });
  await scenario("Неизвестный город: варианты кнопками, не молчание, состояние сохранено", async () => {
    const p = person("Незнайка");
    await env.update(msg(p, "/start"));
    await cb(p, "city_other");
    const c = calls.length;
    await env.update(msg(p, "Тверьгор"));
    const last = sentTo(p.id, c).at(-1);
    assert.ok(last, "ответ есть");
    assert.match(String(last!.params.text), /Не нашёл город/);
    assert.ok(buttons(last!).length >= 2, "есть кнопки");
    const variants = buttons(last!).filter((b) => b.callback_data?.startsWith("city:")).map((b) => b.text);
    assert.equal((await store.getUser(p.id))?.state, "await_city", "можно написать ещё раз");
    await env.update(msg(p, "Абырвалгск"));
    assert.match(lastFrom(p, c), /Не нашёл город «Абырвалгск»/);
    assert.ok(buttons(sentTo(p.id, c).at(-1)!).length >= 2, "и без вариантов есть кнопки");
    await env.update(msg(p, "Твер"));
    assert.equal((await store.getUser(p.id))?.city, "Тверь", "опечатка «Твер» после неудачи");
    return `«Тверьгор» → варианты: ${variants.join(", ") || "нет"}`;
  });
  await scenario("Геолокация", async () => {
    const p = person("Гео");
    await env.update(msg(p, "/start"));
    await cb(p, "geo");
    await env.update(loc(p));
    assert.equal((await store.getUser(p.id))?.city, "Казань");
  });

  // 3. /start с параметром старта с сайта.
  const someRace = bigRaces[3] ?? env.races[0];
  const otherRace = bigRaces[4] ?? env.races[1];
  await scenario("/start r_<код> с сайта: новый человек", async () => {
    const p = person("Сайт");
    const c = calls.length;
    await env.update(msg(p, `/start r_${raceCode(someRace.id)}`));
    assert.deepEqual((await store.listFollows(p.id)).map((f) => f.race_id), [someRace.id], "старт сохранён");
    assert.ok(!allText(p.id, c).includes("Где ты бегаешь"), "без онбординга");
    assert.equal((await store.getUser(p.id))?.source, "r_*");
  });
  const existing = person("Старожил");
  await scenario("/start r_<код> с сайта: существующий человек", async () => {
    await env.update(msg(existing, "/start src_ig_story"));
    await cb(existing, "city:moskva");
    await env.update(msg(existing, `/start r_${raceCode(otherRace.id)}`));
    assert.ok((await store.listFollows(existing.id)).some((f) => f.race_id === otherRace.id));
    assert.equal((await store.getUser(existing.id))?.source, "src_ig_story", "source не перезаписан");
  });

  // 4. Повторный /start и /start ig_channel у существующего.
  await scenario("Повторный /start: «С возвращением!», сводка, меню", async () => {
    const c = calls.length;
    await env.update(msg(existing, "/start"));
    const last = sentTo(existing.id, c).at(-1)!;
    assert.match(String(last.params.text), /С возвращением!/);
    assert.match(String(last.params.text), /Город: <b>Москва<\/b>/);
    assert.match(String(last.params.text), /Сохранено: 1/);
    const bs = buttons(last).map((b) => b.text);
    for (const b of ["Мои забеги", "Сменить город", "Начать заново"]) assert.ok(bs.includes(b), `кнопка ${b}`);
    assert.ok(!allText(existing.id, c).includes("Где ты бегаешь"), "без онбординга");
  });
  await scenario("/start ig_channel у существующего: source прежний, метка в событии", async () => {
    await env.update(msg(existing, "/start ig_channel"));
    assert.equal((await store.getUser(existing.id))?.source, "src_ig_story");
    const ev = (await env.events(existing.id)).filter((e) => e.event === "start").at(-1);
    assert.equal(ev?.source, "ig_channel");
  });
  await scenario("5× /start с разными метками → 1 новый, 5 нажатий, source = первая", async () => {
    const p = person("Пятикратный");
    for (const l of ["ig_channel", "src_tt", "ig_story", "", "vk_post"]) await env.update(msg(p, l ? `/start ${l}` : "/start"));
    const u = (await store.getUser(p.id))!;
    assert.equal(u.source, "ig_channel");
    const s = computeBotStats({ users: [{ ...u, created_at: u.created_at }], events: await env.events(p.id), follows: [], now: LIVE ? new Date() : NOW, period: 30 });
    assert.equal(s.people.newPeriod, 1);
    assert.equal(s.people.startPresses, 5);
    assert.deepEqual(s.sources.map((x) => [x.source, x.users]), [["ig_channel", 1]], "источник по первому приходу");
    return `new=${s.people.newPeriod}, presses=${s.people.startPresses}, source=${u.source}, вернулся через: ${s.returnedVia.map((x) => x.source).join(", ")}`;
  });
  await scenario("«Начать заново» и «Сменить город» запускают выбор города", async () => {
    let c = calls.length;
    await cb(existing, "s:city");
    assert.match(allText(existing.id, c), /Где ты бегаешь/);
    await cb(existing, "city:moskva");
    c = calls.length;
    await cb(existing, "restart");
    assert.match(allText(existing.id, c), /Где ты бегаешь/);
    assert.equal((await store.getUser(existing.id))?.city, null);
    assert.equal((await store.listFollows(existing.id)).length, 1, "сохранённое остаётся");
    await cb(existing, "city:moskva");
  });

  // 5. Фильтры.
  await scenario("Фильтры: никаких, все, изменены потом, «Снять фильтры»", async () => {
    const p = person("Фильтры");
    await env.update(msg(p, "/start"));
    await cb(p, "city:moskva");
    let c = calls.length;
    await cb(p, "show");
    const none = sentTo(p.id, c).filter((m) => buttons(m).some((b) => b.text === "⭐ Следить")).length;
    assert.ok(none > 0, "без фильтров есть забеги");
    for (const t of ["road", "trail"]) await cb(p, `t:${t}`);
    c = calls.length;
    await cb(p, "show");
    assert.ok(sentTo(p.id, c).length > 0, "все типы: ответ есть");
    await cb(p, "t:road");
    assert.deepEqual((await store.getUser(p.id))?.types, ["trail"], "изменены потом");
    c = calls.length;
    await cb(p, "show");
    assert.ok(sentTo(p.id, c).length > 0);
    await cb(p, "nf");
    const u = await store.getUser(p.id);
    assert.deepEqual([u?.types, u?.distances], [[], []], "«Снять фильтры» снял");
  });

  // 6. Короткий список.
  const shortCity = [...cityCount.entries()].find(([city, n]) => n === 1 && env.races.some((r) => r.city === city && r.region && env.races.some((x) => x.region === r.region && x.city !== city)))?.[0];
  await scenario(`Короткий список (${shortCity ?? "нет города"}): «Рядом», «Ожидаются», кнопки`, async () => {
    assert.ok(shortCity, "нашёлся город с одним стартом");
    const p = person("Мало");
    await env.update(msg(p, "/start"));
    await cb(p, "city_other");
    await env.update(msg(p, shortCity!));
    assert.equal((await store.getUser(p.id))?.city, shortCity);
    let c = calls.length;
    await cb(p, "show");
    let all = allText(p.id, c);
    assert.match(all, /Вот что ещё можно посмотреть/);
    assert.match(all, /<b>Рядом<\/b>/);
    const expectedNote = /Ожидаются/.test(all);
    // с фильтром: «Снять фильтры» обязательно, голого «ничего» нет
    await cb(p, "d:ultra");
    c = calls.length;
    await cb(p, "show");
    all = allText(p.id, c);
    assert.match(all, /Вот что ещё можно посмотреть/);
    const bs = btnsTo(p.id, c).map((b) => b.text);
    assert.ok(bs.includes("Снять фильтры") && bs.includes("Сменить город"), "кнопки");
    assert.ok(!/ничего не найдено/i.test(all));
    return expectedNote ? "с блоком «Ожидаются»" : "ожидаемых в регионе нет";
  });

  // 7. ⭐: дважды, двойной клик, снять, прошедший.
  await scenario("⭐ дважды (через 5 с), двойной клик, снять ⭐, прошедший старт", async () => {
    const p = person("Звезда");
    await env.update(msg(p, "/start"));
    await cb(p, "city:moskva");
    const code = raceCode(someRace.id);
    await cb(p, `f:${code}`);
    let c = calls.length;
    await cb(p, `f:${code}`);
    assert.match(allText(p.id, c), /Уже слежу/);
    // двойной клик: то же нажатие без паузы — второй раз ничего
    await env.update(cbu(p, `f:${code}`));
    c = calls.length;
    await env.update(cbu(p, `f:${code}`));
    assert.equal(sentTo(p.id, c).length, 0, "второй клик подряд проигнорирован");
    assert.equal((await store.listFollows(p.id)).length, 1);
    assert.equal((await env.events(p.id)).filter((e) => e.event === "follow").length, 1, "событие follow одно");
    await cb(p, `u:${code}`);
    assert.equal((await store.listFollows(p.id)).length, 0, "снято");
    c = calls.length;
    await cb(p, "f:zzzzzzzzzzz");
    assert.match(allText(p.id, c), /уже прошёл/);
  });
  await scenario("Повтор того же update_id обрабатывается один раз", async () => {
    const p = person("Повтор");
    const u = msg(p, "/start");
    await env.update(u);
    const c = calls.length;
    await env.update(u);
    assert.equal(sentTo(p.id, c).length, 0);
    assert.equal((await env.events(p.id)).filter((e) => e.event === "start").length, 1);
  });

  // 8. Календарь, Регистрация, Сайт.
  await scenario("«Весь календарь» (Mini App), /go Регистрация и Сайт", async () => {
    const p = person("Клики");
    await env.update(msg(p, "/start"));
    const c = calls.length;
    await env.update(msg(p, "/calendar"));
    assert.ok(btnsTo(p.id, c).some((b) => b.web_app), "кнопка web_app");
    await env.miniapp(p.id);
    const r1 = await env.click(p.id, someRace, "r");
    const r2 = await env.click(p.id, someRace, "s");
    assert.ok(/^https?:\/\//.test(r1) && /^https?:\/\//.test(r2));
    const ev = (await env.events(p.id)).map((e) => e.event);
    for (const e of ["open_calendar", "click_registration", "click_site"]) assert.ok(ev.includes(e), e);
  });

  // 9. Консультация.
  await scenario("Консультация: ссылка в личку Игоря, событие, тренеру не уходит наружу", async () => {
    const p = person("Консульт");
    await env.update(msg(p, "/start"));
    const c = calls.length;
    await cb(p, `consult:${raceCode(someRace.id)}`);
    assert.ok(btnsTo(p.id, c).some((b) => b.url?.startsWith("https://t.me/IgorPotseluev")), "ссылка на тренера");
    assert.ok((await env.events(p.id)).some((e) => e.event === "consult_click"));
    return LIVE ? "уведомление тренеру перехвачено, не отправлено" : "";
  });

  // 10. Дайджест.
  await scenario("Дайджест: вкл, выкл, пауза, отписка, повторы и двойной клик", async () => {
    const p = person("Дайджест");
    await env.update(msg(p, "/start"));
    await cb(p, "city:moskva");
    await cb(p, "dg:off");
    await cb(p, "dg:off");
    await env.update(cbu(p, "dg:on"));
    await env.update(cbu(p, "dg:on"));
    assert.equal((await store.getUser(p.id))?.digest_on, true);
    await cb(p, "dg:off");
    assert.equal((await store.getUser(p.id))?.digest_on, false);
    await cb(p, "dg:on");
    await cb(p, "s:pause");
    await env.update(cbu(p, "s:pause"));
    assert.ok((await store.getUser(p.id))?.paused_until, "пауза включена и двойной клик её не снял");
    await cb(p, "s:pause");
    assert.equal((await store.getUser(p.id))?.paused_until, null, "пауза снята");
    await cb(p, "s:unsub");
    const c = calls.length;
    await cb(p, "s:unsub");
    assert.match(allText(p.id, c), /уже отписан/);
    const unsub = (await env.events(p.id)).filter((e) => e.event === "unsubscribe").length;
    assert.equal(unsub, 2, "dg:off один раз + s:unsub один раз");
  });
  await scenario("Дайджест по понедельникам: включённому уходит, на паузе и заблокированному нет", async () => {
    const on = person("Вкл"), paused = person("Пауза"), blocked = person("Блок");
    for (const p of [on, paused, blocked]) {
      await env.update(msg(p, "/start"));
      await cb(p, "city:moskva");
      await cb(p, "dg:on");
    }
    await cb(paused, "s:pause");
    await env.update({ update_id: ++upd, my_chat_member: { chat: { id: blocked.id, type: "private" }, from: blocked, new_chat_member: { status: "kicked" } } });
    const c = calls.length;
    await env.tick!();
    assert.ok(sentTo(on.id, c).length > 0, "включённому ушло");
    assert.equal(sentTo(paused.id, c).length, 0, "на паузе нет");
    assert.equal(sentTo(blocked.id, c).length, 0, "заблокированному нет");
  }, true);

  // 11. Команды меню BotFather.
  await scenario("Команды меню: /start /races /calendar /city /settings /delete /menu", async () => {
    const p = person("Команды");
    for (const cmd of ["/start", "/races", "/calendar", "/city", "/settings", "/delete", "/menu", "/nonsense"]) {
      const c = calls.length;
      await env.update(msg(p, cmd));
      assert.ok(sentTo(p.id, c).length > 0, `${cmd} ответил`);
    }
    await cb(p, "del:no");
  });

  // 12. Непонятное.
  await scenario("Непонятный текст, стикер, фото, голосовое: вежливо и с меню", async () => {
    const p = person("Стикер");
    await env.update(msg(p, "/start"));
    await cb(p, "city:moskva");
    for (const u of [msg(p, "абырвалг"), other(p, "sticker"), other(p, "photo"), other(p, "voice")]) {
      const c = calls.length;
      await env.update(u);
      assert.ok(sentTo(p.id, c).length > 0, "ответ есть");
    }
    const c = calls.length;
    await env.update(other(p, "sticker"));
    assert.ok(btnsTo(p.id, c).some((b) => b.text === "Мои забеги"), "меню");
  });

  // 13. Блокировка.
  await scenario("Заблокировал бота: blocked=true, в рассылку не попадает", async () => {
    const p = person("Ушёл");
    await env.update(msg(p, "/start"));
    await cb(p, "city:moskva");
    await cb(p, "dg:on");
    await env.update({ update_id: ++upd, my_chat_member: { chat: { id: p.id, type: "private" }, from: p, new_chat_member: { status: "kicked" } } });
    assert.equal((await store.getUser(p.id))?.blocked, true);
    assert.ok((await env.events(p.id)).some((e) => e.event === "blocked"));
    if (!LIVE) assert.ok(!(await store.listActiveUsers()).some((u) => u.tg_id === p.id), "не в списке активных");
    // отправка, упавшая на 403, тоже ставит blocked
    const q = person("403");
    await env.update(msg(q, "/start"));
    blockedChats.add(q.id);
    await env.update(msg(q, "/races"));
    blockedChats.delete(q.id);
    assert.equal((await store.getUser(q.id))?.blocked, true, "403 → blocked");
  });

  // 14. Длинные списки.
  await scenario("Длинные списки: «Показать ещё», «Мои забеги» страницами, 4096 и 100 кнопок", async () => {
    const p = person("Много");
    await env.update(msg(p, "/start"));
    await cb(p, "city:moskva");
    let c = calls.length;
    await cb(p, "show");
    const more = btnsTo(p.id, c).find((b) => b.callback_data?.startsWith("more:"));
    assert.ok(more, "кнопка «Показать ещё»");
    c = calls.length;
    await cb(p, more!.callback_data!);
    assert.ok(sentTo(p.id, c).some((m) => buttons(m).some((b) => b.text === "⭐ Следить")), "следующая страница");
    for (const r of bigRaces.slice(0, 25)) await env.update(cbu(p, `f:${raceCode(r.id)}`));
    c = calls.length;
    await cb(p, "my");
    const my = sentTo(p.id, c).at(-1)!;
    assert.ok(buttons(my).some((b) => b.callback_data?.startsWith("myp:")), "страницы «Мои забеги»");
    c = calls.length;
    await cb(p, "myp:2");
    assert.ok(sentTo(p.id, c).length === 1);
    return `сохранено ${(await store.listFollows(p.id)).length}`;
  });

  // Сквозные: длина, кнопки, длинное тире.
  await scenario("Все ответы: ≤4096 символов, ≤100 кнопок, без «—»", async () => {
    const msgs = calls.filter((c) => c.method === "sendMessage" || c.method === "editMessageText");
    for (const m of msgs) {
      const t = String(m.params.text ?? "");
      assert.ok(t.length <= 4096, `длина ${t.length}`);
      assert.ok(buttons(m).length <= 100, `кнопок ${buttons(m).length}`);
      assert.ok(!t.includes("—") && !buttons(m).some((b) => b.text.includes("—")), `длинное тире: ${t.slice(0, 80)}`);
    }
    return `проверено сообщений: ${msgs.length}`;
  });

  if (LIVE) await env.cleanup(usedIds);

  const pass = rows.filter((r) => r.ok === true).length;
  const fail = rows.filter((r) => r.ok === false).length;
  console.log(`\n| # | Сценарий | Итог | Заметка |\n|---|---|---|---|`);
  rows.forEach((r, i) => console.log(`| ${i + 1} | ${r.name} | ${r.ok === null ? "SKIP" : r.ok ? "PASS" : "FAIL"} | ${r.note.replace(/\|/g, "/")} |`));
  console.log(`\n${LIVE ? "live" : "в памяти"}: PASS ${pass}, FAIL ${fail}, фейковых tg_id ${usedIds.length}${LIVE ? " (данные удалены)" : ""}; наружу в Telegram не ушло ничего.`);
  if (fail) process.exit(1);
}

main().catch((e) => {
  console.error("races-bot-scenarios FAILED:", e instanceof Error ? e.stack : e);
  process.exit(1);
});
