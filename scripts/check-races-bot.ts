/**
 * Бот «Забеги России»: экраны и плановые сообщения на тестовых датах, без сети и без
 * настоящего Telegram. Хранилище — в памяти, Telegram — запись исходящих вызовов.
 *
 * ЧТО СТЕРЕЖЁТ:
 *   — deep link: код старта безопасный ([A-Za-z0-9_-], до 64), r_/c_/src_ разбираются,
 *     id с «:» в параметр не попадает; город в ссылке — латиница;
 *   — онбординг: город, типы и дистанции переключаются, «Показать забеги» даёт до 5 карточек
 *     и вопрос про понедельники;
 *   — «Сохранил» + консультация не чаще раза в 30 дней; «Записаться» шлёт тренеру заявку
 *     (имя, @username, город, забеги, источник), человеку — ссылку на тренера;
 *   — плановые: 12 недель (только длинные и сохранённые раньше), неделя, накануне с погодой,
 *     после финиша по снимку, отмена; тихие часы 22-9, пауза, блокировка (403), без повторов;
 *   — дайджест по понедельникам с 10:00, нет новых — ничего;
 *   — /delete удаляет всё; мини-апп принимает только подписанный initData.
 *
 *   npm run check:races-bot
 */

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { toRace, type RaceRow } from "@/app/races/races-logic";
import { validateTelegramInitDataWithToken } from "@/features/telegram/validate-init-data";
import { BotBlockedError, createBot, type BotFollow, type BotStore, type BotUser } from "@/features/races-bot/bot";
import {
  type ExpectedItem,
  START_PARAM_RE,
  citySlug,
  parseGo,
  inCity,
  parseSearch,
  parseStart,
  raceCode,
  type BotRace,
} from "@/features/races-bot/core";
import { computeBotStats, type StatEvent } from "@/features/races-bot/stats";
import * as T from "@/features/races-bot/texts";

// ── данные ───────────────────────────────────────────────────────────────────

function race(id: string, name: string, ds: string, city: string, type: string, km: number[], firstSeen = "2026-01-01T00:00:00Z"): BotRace {
  const row: RaceRow = {
    id, source: "probeg", source_url: `https://probeg.org/event/${id}/`, name, date_start: ds, date_end: ds,
    city, region: city === "Москва" ? "Москва" : "", distances: km.map((k) => `${k} км`), dist_km: km,
    race_type: type, tags: km.some((k) => Math.abs(k - 21.1) < 0.2) ? ["half"] : [], site_url: "https://example.org/race",
    reg_url: "https://reg.example.org/r", vk_url: null, sources: ["probeg"], link_ok: true, alt_dates: [], checked_note: null,
  };
  return { ...toRace(row), firstSeen };
}

const HALF = race("probeg:1001", "Полумарафон «Покровское-Стрешнево»", "2027-03-14", "Москва", "road", [21.1, 10]);
const TRAIL = race("probeg:1002", "Трейл «Краски осени»", "2026-10-18", "Москва", "trail", [21.1, 10, 5]);
const KAZAN = race("manual:kazan-trail-2027", "Казанский трейл", "2027-05-20", "Казань", "trail", [15]);
const SHORT = race("probeg:1003", "Пробег «Grom 10k»", "2026-10-24", "Москва", "road", [10, 5]);
const EXTRA = Array.from({ length: 6 }, (_, i) =>
  race(`probeg:20${i}`, `Забег номер ${i}`, `2026-11-${String(10 + i).padStart(2, "0")}`, "Москва", "road", [10]),
);

let RACES: BotRace[] = [HALF, TRAIL, KAZAN, SHORT, ...EXTRA];

// Ожидаемые: прошлогодние без даты. ANNOUNCED — какие уже объявили дату (id ожидаемого → race_id).
const EXP_NIGHT: ExpectedItem = { id: "probeg:2", name: "Ночной забег", city: "Москва", region: "Москва", type: "road", distances: ["10 км"], km: [10], lastMonth: 6, lastDate: "2026-06-20", lastUrl: "https://probeg.org/event/2/", site: "" };
const EXP_KAZAN: ExpectedItem = { id: "probeg:7", name: "Казанский ночной забег", city: "Казань", region: "Татарстан", type: "road", distances: ["10 км"], km: [10], lastMonth: 7, lastDate: "2026-07-11", lastUrl: "https://probeg.org/event/7/", site: "" };
const EXPECTED: ExpectedItem[] = [EXP_NIGHT, EXP_KAZAN];
const ANNOUNCED = new Map<string, string>();

// ── хранилище в памяти и запись Telegram ─────────────────────────────────────

function memStore(): BotStore & { users: Map<number, BotUser>; follows: BotFollow[]; sends: { tg_id: number; kind: string; race_id: string | null }[]; config: Map<string, string>; events: StatEvent[] } {
  const events: StatEvent[] = [];
  const watches: { id: number; tg_id: number; expected_id: string; notified_at: string | null }[] = [];
  const users = new Map<number, BotUser>();
  const follows: BotFollow[] = [];
  const sends: { tg_id: number; kind: string; race_id: string | null }[] = [];
  const config = new Map<string, string>();
  const blank = (tg_id: number): BotUser => ({
    tg_id, first_name: null, username: null, city: null, types: [], distances: [], digest_on: false, digest_every_weeks: 1,
    digest_last_at: null, paused_until: null, tz: "Europe/Moscow", source: null, state: null, consult_offered_at: null,
    consult_requested_at: null, blocked: false, created_at: "2026-10-01T00:00:00Z",
  });
  return {
    users, follows, sends, config, events,
    async getUser(id) { return users.get(id) ?? null; },
    async saveUser(p) { const u = { ...(users.get(p.tg_id) ?? blank(p.tg_id)), ...p }; users.set(p.tg_id, u); return u; },
    async deleteUser(id) {
      users.delete(id);
      for (let i = follows.length - 1; i >= 0; i--) if (follows[i].tg_id === id) follows.splice(i, 1);
      for (let i = sends.length - 1; i >= 0; i--) if (sends[i].tg_id === id) sends.splice(i, 1);
      for (let i = events.length - 1; i >= 0; i--) if (events[i].tg_id === id) events.splice(i, 1);
    },
    async listFollows(id) { return follows.filter((f) => f.tg_id === id); },
    async addFollow(id, r) {
      if (!follows.some((f) => f.tg_id === id && f.race_id === r.id)) {
        follows.push({ tg_id: id, race_id: r.id, race_name: r.name, race_date: r.ds, race_end: r.de, race_city: r.city, created_at: NOW.toISOString() });
      }
    },
    async removeFollow(id, rid) { const i = follows.findIndex((f) => f.tg_id === id && f.race_id === rid); if (i >= 0) follows.splice(i, 1); },
    async removeAllFollows(id) { for (let i = follows.length - 1; i >= 0; i--) if (follows[i].tg_id === id) follows.splice(i, 1); },
    async getConfig(k) { return config.get(k) ?? null; },
    async setConfig(k, v) { config.set(k, v); },
    async claimSend(id, kind, rid) {
      if (rid !== null && sends.some((s) => s.tg_id === id && s.kind === kind && s.race_id === rid)) return false;
      sends.push({ tg_id: id, kind, race_id: rid });
      return true;
    },
    async releaseSend(id, kind, rid) { const i = sends.findIndex((s) => s.tg_id === id && s.kind === kind && s.race_id === rid); if (i >= 0) sends.splice(i, 1); },
    async listActiveUsers() { return [...users.values()].filter((u) => !u.blocked); },
    async listAllFollows() { return [...follows]; },
    async listSentKeys() {
      const m = new Map<number, Set<string>>();
      for (const s of sends) if (s.race_id) { if (!m.has(s.tg_id)) m.set(s.tg_id, new Set()); m.get(s.tg_id)!.add(`${s.kind}:${s.race_id}`); }
      return m;
    },
    async logEvent(tg, event, opts) {
      events.push({ tg_id: tg, event, race_id: opts?.raceId ?? null, source: opts?.source ?? null, meta: opts?.meta ?? {}, created_at: NOW.toISOString() });
    },
    async addExpectedWatch(tg, eid) { if (!watches.some((w) => w.tg_id === tg && w.expected_id === eid)) watches.push({ id: watches.length + 1, tg_id: tg, expected_id: eid, notified_at: null }); },
    async listExpectedWatches(tg) { return watches.filter((w) => w.tg_id === tg && !w.notified_at).map((w) => w.expected_id); },
    async listDueAnnouncements() {
      return watches.filter((w) => !w.notified_at && ANNOUNCED.has(w.expected_id)).map((w) => ({ id: w.id, tg_id: w.tg_id, expected_id: w.expected_id, race_id: ANNOUNCED.get(w.expected_id)! }));
    },
    async markWatchNotified(id) { const w = watches.find((x) => x.id === id); if (w) w.notified_at = NOW.toISOString(); },
    async loadStats(period, now) {
      return computeBotStats({
        users: [...users.values()].map((u) => ({ tg_id: u.tg_id, first_name: u.first_name, username: u.username, city: u.city, source: u.source, created_at: u.created_at, blocked: u.blocked })),
        events, follows: follows.map((f) => ({ tg_id: f.tg_id, race_id: f.race_id, race_name: f.race_name, race_city: f.race_city, created_at: f.created_at })), now, period,
      });
    },
  };
}

type Call = { method: string; params: Record<string, unknown> };
const calls: Call[] = [];
const blockedChats = new Set<number>();
const tg = {
  async call(method: string, params: Record<string, unknown>) {
    if (method === "sendMessage" && blockedChats.has(Number(params.chat_id))) throw new BotBlockedError("Forbidden: bot was blocked by the user");
    calls.push({ method, params });
    return { message_id: calls.length };
  },
};
const sent = (chat: number) => calls.filter((c) => c.method === "sendMessage" && c.params.chat_id === chat);
const texts = (chat: number) => sent(chat).map((c) => String(c.params.text));
const buttons = (c: Call) =>
  ((c.params.reply_markup as { inline_keyboard?: { text: string; callback_data?: string; url?: string; web_app?: unknown }[][] } | undefined)?.inline_keyboard ?? []).flat();
const reset = () => calls.splice(0, calls.length);

let NOW = new Date("2026-10-12T10:00:00Z"); // 13:00 по Москве, понедельник
const store = memStore();
const bot = createBot({
  store,
  tg,
  races: async () => RACES,
  expected: async () => EXPECTED.filter((e) => !ANNOUNCED.has(e.id)),
  now: () => NOW,
  coachUsername: "IgorPotseluev",
  reverseGeocode: async () => "Казань",
  weather: async () => ({ tMax: 14.4, tMin: 6.2, rainProb: 30, windMax: 4.1 }),
  goLink: (tg, r, kind) => `https://igorp.run/go/${kind}${raceCode(r.id)}-${tg.toString(36)}-0123456789`,
});

const USER = { id: 501, first_name: "Анна", username: "anna_runs" };
const COACH = { id: 900, first_name: "Игорь", username: "IgorPotseluev" };
let mid = 1;
const msg = (from: typeof USER, text: string) => ({ message: { message_id: mid++, chat: { id: from.id, type: "private" }, from, text } });
const cb = (from: typeof USER, data: string) => ({
  callback_query: { id: String(mid++), from, data, message: { message_id: mid, chat: { id: from.id, type: "private" } } },
});

async function main() {
  // ── коды и разбор ─────────────────────────────────────────────────────────
  for (const r of RACES) {
    const code = raceCode(r.id);
    assert.match(code, /^[0-9a-z]{11}$/);
    assert.ok(START_PARAM_RE.test(`r_${code}`), "start=r_<код> проходит в Telegram");
  }
  assert.equal(raceCode("ironstar:казань-2027-05-01"), raceCode("ironstar:казань-2027-05-01"), "код стабилен");
  assert.notEqual(raceCode("probeg:1001"), raceCode("probeg:1002"));
  assert.deepEqual(parseStart(`r_${raceCode(HALF.id)}`), { kind: "race", code: raceCode(HALF.id) });
  assert.deepEqual(parseStart("c_sankt-peterburg"), { kind: "city", slug: "sankt-peterburg" });
  assert.deepEqual(parseStart("src_ig_story"), { kind: "src", label: "ig_story" });
  assert.deepEqual(parseStart("r_probeg:1001"), { kind: "none" }, "id с двоеточием параметром не принимается");
  assert.deepEqual(parseStart("x".repeat(65)), { kind: "none" }, "длиннее 64 — нет");
  assert.equal(citySlug("Санкт-Петербург"), "sankt-peterburg");
  assert.equal(citySlug("Москва"), "moskva");
  assert.equal(inCity("Москва"), "в Москве");
  assert.equal(inCity("Казань"), "в Казани");
  assert.equal(inCity("Екатеринбург"), "в Екатеринбурге");
  assert.deepEqual(parseSearch("трейл Казань"), { q: "казань", types: ["trail"], dists: [], month: null });
  assert.deepEqual(parseSearch("марафон май"), { q: "", types: [], dists: ["marathon"], month: 5 });

  // ── тренер пишет /start: бот запоминает его chat_id ─────────────────────────
  await bot.handleUpdate(msg(COACH, "/start"));
  assert.equal(store.config.get("coach_chat_id"), "900", "chat_id тренера по совпадению username");

  // ── онбординг ─────────────────────────────────────────────────────────────
  reset();
  await bot.handleUpdate(msg(USER, "/start src_ig_story"));
  // Было «ig_story»: метка без префикса. Теперь источник хранится как в ссылке — src_<метка>, r_*,
  // c_<город>, — чтобы в /stats метки разных видов не смешивались (наряд статистики 12.10).
  assert.equal(store.users.get(501)?.source, "src_ig_story", "источник из start=src_ с префиксом");
  const greet = sent(501)[0];
  assert.match(String(greet.params.text), /Где ты бегаешь\?/);
  assert.deepEqual(buttons(greet).map((b) => b.text), ["Москва", "Санкт-Петербург", "Казань", "Екатеринбург", "Отправить геолокацию", "Другой город"]);
  await bot.handleUpdate(cb(USER, `city:${citySlug("Москва")}`));
  assert.equal(store.users.get(501)?.city, "Москва");
  assert.match(texts(501).at(-1)!, /Что тебе интересно\? Можно выбрать несколько\./);
  await bot.handleUpdate(cb(USER, "t:trail"));
  await bot.handleUpdate(cb(USER, "t:road"));
  await bot.handleUpdate(cb(USER, "d:half"));
  assert.deepEqual(store.users.get(501)?.types, ["trail", "road"]);
  const edit = calls.filter((c) => c.method === "editMessageReplyMarkup").at(-1)!;
  assert.ok(buttons(edit).some((b) => b.text === "✓ Полумарафон"), "выбранное отмечено галочкой");
  reset();
  await bot.handleUpdate(cb(USER, "show"));
  const shown = sent(501);
  assert.match(String(shown[0].params.text), /^Ближайшие забеги в Москве: шоссе и трейл, есть полумарафон\. Нажми/);
  const cards = shown.filter((c) => buttons(c).some((b) => b.text === "Следить"));
  assert.ok(cards.length >= 1 && cards.length <= 5, `до 5 карточек, было ${cards.length}`);
  // Было: «Регистрация» вела прямо на сайт организатора. Теперь — через igorp.run/go/<код>, чтобы
  // записать клик (наряд статистики 12.10): ссылка подписана и привязана к этому человеку.
  const regBtn = buttons(cards[0]).find((b) => b.text === "Регистрация");
  assert.ok(regBtn?.url?.startsWith("https://igorp.run/go/r"), `«Регистрация» через /go/: ${regBtn?.url}`);
  const parsedGo = parseGo(regBtn!.url!.split("/go/")[1]);
  assert.ok(parsedGo && parsedGo.kind === "r" && parsedGo.uid === 501, "в ссылке код старта и tg_id");
  const footer = shown.at(-1)!;
  assert.ok(buttons(footer).some((b) => b.text === "Да, по понедельникам"));
  await bot.handleUpdate(cb(USER, "dg:on"));
  assert.equal(store.users.get(501)?.digest_on, true);

  // ── другой город и геолокация ──────────────────────────────────────────────
  await bot.handleUpdate(cb(USER, "city_other"));
  await bot.handleUpdate(msg(USER, "казань"));
  assert.equal(store.users.get(501)?.city, "Казань", "город словами");
  await bot.handleUpdate({ message: { message_id: mid++, chat: { id: 501, type: "private" }, from: USER, location: { latitude: 55.79, longitude: 49.12 } } });
  assert.equal(store.users.get(501)?.city, "Казань", "город по геолокации");
  await bot.handleUpdate(cb(USER, `city:${citySlug("Москва")}`));

  // ── поиск текстом ─────────────────────────────────────────────────────────
  reset();
  await bot.handleUpdate(msg(USER, "трейл Казань"));
  assert.match(texts(501)[0], /Ближайшие забеги в Казани: трейл/);
  assert.ok(texts(501).some((t) => t.includes("Казанский трейл")));

  // ── сохранение по deep link с сайта и консультация ─────────────────────────
  reset();
  await bot.handleUpdate(msg(USER, `/start r_${raceCode(HALF.id)}`));
  assert.ok(store.follows.some((f) => f.tg_id === 501 && f.race_id === HALF.id), "старт сохранён по deep link");
  const savedText = texts(501)[0];
  assert.match(savedText, /Сохранил/);
  assert.match(savedText, /14 марта, вс · Москва/);
  assert.match(savedText, /за неделю: короткий чек-лист старта/);
  assert.match(savedText, /накануне: погоду на трассе/);
  const offer = sent(501)[1];
  assert.match(String(offer.params.text), /Запишись на бесплатную консультацию: тренер разберёт твою ситуацию и даст конкретное решение под этот старт\./);
  assert.deepEqual(buttons(offer).slice(0, 2).map((b) => b.text), ["Записаться", "Пока не нужно"]);
  // второе сохранение в те же 30 дней — без предложения консультации
  reset();
  await bot.handleUpdate(cb(USER, `f:${raceCode(TRAIL.id)}`));
  assert.equal(sent(501).length, 1, "консультация не чаще раза в 30 дней");
  assert.ok(!texts(501)[0].includes("консультац"));
  // «Записаться»
  reset();
  await bot.handleUpdate(cb(USER, `consult:${raceCode(HALF.id)}`));
  const toCoach = sent(900)[0];
  assert.ok(toCoach, "тренеру ушло уведомление");
  const notice = String(toCoach.params.text);
  for (const part of ["Заявка на консультацию", "Анна", "@anna_runs", "Москва", "Полумарафон «Покровское-Стрешнево»", "Источник: src_ig_story"]) {
    assert.ok(notice.includes(part.replace(/«|»/g, (m) => m)), `в заявке есть «${part}»: ${notice}`);
  }
  const reply = sent(501)[0];
  assert.match(String(reply.params.text), /^Отлично! Напиши тренеру в личку, он ответит:/);
  const link = buttons(reply)[0].url!;
  assert.ok(link.startsWith("https://t.me/IgorPotseluev?text="), link);
  assert.match(decodeURIComponent(link.split("text=")[1]), /Хочу консультацию по подготовке к Полумарафон/);
  assert.ok(store.users.get(501)?.consult_requested_at, "отмечено consult_requested_at");

  // ── мои забеги, убрать старт ───────────────────────────────────────────────
  reset();
  await bot.handleUpdate(msg(USER, "/races"));
  const my = sent(501)[0];
  assert.match(String(my.params.text), /Твои забеги/);
  assert.match(String(my.params.text), /Трейл «Краски осени»<\/b> · 6 дней/);
  assert.ok(buttons(my).some((b) => b.text.startsWith("Сайт старта") && b.url));
  await bot.handleUpdate(cb(USER, `u:${raceCode(TRAIL.id)}`));
  assert.ok(!store.follows.some((f) => f.race_id === TRAIL.id), "старт убран");

  // ── настройки ─────────────────────────────────────────────────────────────
  reset();
  await bot.handleUpdate(msg(USER, "/settings"));
  assert.match(texts(501)[0], /Тихие часы: <b>22:00-9:00<\/b>/);
  await bot.handleUpdate(cb(USER, "s:rarer"));
  assert.equal(store.users.get(501)?.digest_every_weeks, 2, "«Реже» — раз в две недели");
  await bot.handleUpdate(cb(USER, "s:rarer"));
  await bot.handleUpdate(cb(USER, "s:pause"));
  assert.ok(Date.parse(store.users.get(501)!.paused_until!) > NOW.getTime() + 29 * 864e5, "пауза на месяц");
  await bot.handleUpdate(cb(USER, "s:pause"));
  assert.equal(store.users.get(501)?.paused_until, null, "пауза снимается");

  // ── /stats только тренеру ──────────────────────────────────────────────────
  // Было: одна строка счётчиков «Забеги России: статистика». Теперь один экран с воронкой,
  // источниками, кликами и заявками и кнопками периода — и всё это видит только тренер.
  reset();
  await bot.handleUpdate(msg(USER, "/stats"));
  assert.ok(!texts(501).some((t) => /Воронка|Пользователи:/.test(t)), "чужому — ни одной цифры");
  await bot.handleUpdate(cb(USER, "st:7"));
  assert.ok(!calls.some((c) => c.method === "editMessageText"), "чужой клик по периоду — ничего");
  await bot.handleUpdate(msg(COACH, "/stats"));
  const st = texts(900).at(-1)!;
  assert.match(st, /Забеги России · 30 дней/);
  assert.match(st, /Старт: 2 \(100%\)/, "старт тренера тоже старт");
  assert.match(st, /Нажал «Следить»: 1 \(50%\)/);
  assert.match(st, /Нажал «Записаться»: 1 \(50%\)/);
  assert.match(st, /src_ig_story: 1 \/ 1 \/ 1/, "источник дошёл до «Следить» и заявки");
  assert.match(st, /Анна @anna_runs · Москва · Полумарафон/, "заявка в списке");
  assert.deepEqual(buttons(sent(900).at(-1)!).map((b) => b.text), ["7 дней", "• 30 дней", "Всё время"]);
  await bot.handleUpdate(cb(COACH, "st:7"));
  const edited = calls.filter((c) => c.method === "editMessageText").at(-1)!;
  assert.match(String(edited.params.text), /Забеги России · 7 дней/, "период переключается");

  // ── плановые сообщения на тестовых датах ───────────────────────────────────
  // HALF 14.03.2027 сохранён 12.10.2026 (раньше чем за 12 недель).
  const consultBefore = store.users.get(501)!.consult_offered_at;
  store.users.get(501)!.consult_offered_at = "2026-01-01T00:00:00Z"; // давно — консультацию можно снова
  reset();
  NOW = new Date("2026-12-20T07:30:00Z"); // 10:30 МСК, за 84 дня
  await bot.runTick();
  const w12 = texts(501).find((t) => t.includes("12 недель"));
  assert.ok(w12, "за 12 недель");
  assert.match(w12!, /Пора начинать подготовку к полумарафону/);
  assert.ok(w12!.includes("бесплатную консультацию"), "с консультацией (лимит 30 дней прошёл)");
  reset();
  await bot.runTick();
  assert.equal(texts(501).length, 0, "повтор того же часа — ничего");
  void consultBefore;

  reset();
  NOW = new Date("2027-03-07T20:00:00Z"); // 23:00 МСК за 7 дней — тихие часы
  await bot.runTick();
  assert.equal(texts(501).length, 0, "тихие часы");
  NOW = new Date("2027-03-07T08:00:00Z"); // 11:00 МСК
  await bot.runTick();
  assert.ok(texts(501).some((t) => t.includes("Через неделю старт")), "за неделю");
  assert.ok(!texts(501).join(" ").match(/забрать стартовый пакет: \d/), "без выдуманных дат пакетов");

  reset();
  NOW = new Date("2027-03-13T10:00:00Z"); // 13:00 МСК накануне
  await bot.runTick();
  const d1 = texts(501).find((t) => t.includes("Завтра старт"));
  assert.ok(d1 && d1.includes("до 14°") && d1.includes("ночью 6°") && d1.includes("осадков 30%"), `накануне с погодой: ${d1}`);

  // день после: старта уже нет во view — «С финишем!» по снимку, отслеживание снято
  reset();
  RACES = RACES.filter((r) => r.id !== HALF.id);
  NOW = new Date("2027-03-15T08:00:00Z");
  await bot.runTick();
  const after = sent(501).find((c) => String(c.params.text).startsWith("С финишем"));
  assert.ok(after, "после финиша");
  assert.deepEqual(buttons(after!).map((b) => b.text), ["Консультация", "Следующий старт"]);
  assert.ok(!store.follows.some((f) => f.race_id === HALF.id), "после финиша снят");
  RACES = [HALF, ...RACES];

  // отмена: сохранённый будущий старт пропал из календаря
  NOW = new Date("2026-10-12T10:00:00Z");
  await bot.handleUpdate(cb(USER, `f:${raceCode(KAZAN.id)}`));
  RACES = RACES.filter((r) => r.id !== KAZAN.id);
  reset();
  await bot.runTick();
  assert.ok(texts(501).some((t) => t.includes("пропал из календаря")), "отмена");
  assert.ok(!store.follows.some((f) => f.race_id === KAZAN.id), "снят с отслеживания");
  reset();
  await bot.runTick();
  assert.ok(!texts(501).some((t) => t.includes("пропал из календаря")), "об отмене один раз");
  RACES = [...RACES, KAZAN];

  // пауза глушит всё
  await bot.handleUpdate(cb(USER, `f:${raceCode(SHORT.id)}`));
  await bot.handleUpdate(cb(USER, "s:pause"));
  reset();
  NOW = new Date("2026-10-18T08:00:00Z"); // за 6 дней до SHORT
  await bot.runTick();
  assert.equal(texts(501).length, 0, "на паузе — ничего");
  await bot.handleUpdate(cb(USER, "s:pause"));

  // дайджест: понедельник 10:30, новые за неделю в городе и по фильтрам
  store.users.get(501)!.types = [];
  store.users.get(501)!.distances = [];
  store.users.get(501)!.digest_last_at = null;
  RACES = [...RACES, race("probeg:3001", "Новый осенний забег", "2026-11-29", "Москва", "road", [10], "2026-10-15T00:00:00Z")];
  reset();
  NOW = new Date("2026-10-19T07:30:00Z"); // пн 10:30 МСК
  await bot.runTick();
  assert.ok(texts(501).some((t) => t.startsWith("Новые забеги в Москве за неделю: 1")), "дайджест");
  await bot.handleUpdate(cb(USER, "dlist"));
  reset();
  NOW = new Date("2026-10-26T07:30:00Z"); // следующий понедельник, новых нет
  await bot.runTick();
  assert.ok(!texts(501).some((t) => t.startsWith("Новые забеги")), "нет новых — ничего");

  // 403: бот заблокирован — пометить и больше не слать
  blockedChats.add(501);
  store.users.get(501)!.digest_last_at = null;
  RACES = [...RACES, race("probeg:3002", "Ещё один новый", "2026-12-06", "Москва", "road", [10], "2026-10-30T00:00:00Z")];
  NOW = new Date("2026-11-02T07:30:00Z");
  await bot.runTick();
  assert.equal(store.users.get(501)?.blocked, true, "403 — blocked");
  blockedChats.delete(501);

  // ── события для статистики (до /delete: он стирает и их) ───────────────────
  await bot.handleUpdate(cb(USER, "dg:off"));
  await bot.click(501, TRAIL, "r");
  await bot.click(501, TRAIL, "s");
  const mine = new Set(store.events.filter((e) => e.tg_id === 501).map((e) => e.event));
  for (const ev of ["start", "city_chosen", "filters_done", "list_shown", "search", "follow", "unfollow", "consult_offer_shown",
    "consult_click", "digest_sent", "digest_opened_list", "settings_less", "pause", "unsubscribe", "blocked", "click_registration", "click_site"]) {
    assert.ok(mine.has(ev), `событие ${ev} пишется`);
  }
  assert.equal(store.events.find((e) => e.event === "start" && e.tg_id === 501)?.source, "src_ig_story", "старт с источником");

  // ── ожидаемые старты: «Сообщить, когда объявят дату» ───────────────────────
  {
    const OLEG = { id: 811, first_name: "Олег", username: "oleg811" };
    NOW = new Date("2026-10-12T10:00:00Z");
    reset();
    await bot.handleUpdate(msg(OLEG, "трейл Москва"));
    await bot.handleUpdate(msg(OLEG, "забег Москва"));
    const block = sent(811).find((c) => String(c.params.text).startsWith("Ожидаются, дата 2027 пока не объявлена"));
    assert.ok(block, "под списком — ожидаемые города");
    assert.match(String(block!.params.text), /Ночной забег<\/b>, Москва, обычно в июне/);
    const watchBtn = buttons(block!).find((b) => b.callback_data?.startsWith("ew:"));
    assert.ok(watchBtn, "кнопка «Сообщить, когда объявят»");
    await bot.handleUpdate(cb(OLEG, watchBtn!.callback_data!));
    assert.match(texts(811).at(-1)!, /сообщу, как только объявят дату «Ночной забег»/);
    // с сайта: start=e_<код>
    await bot.handleUpdate(msg(OLEG, `/start e_${raceCode(EXP_KAZAN.id)}`));
    assert.match(texts(811).at(-1)!, /Казанский ночной забег/);
    assert.equal(store.users.get(811)?.source, "e_*", "источник e_*");
    // дата объявлена: в календаре появился старт, тик шлёт одно сообщение и добавляет в «Мои забеги»
    const NIGHT27 = race("probeg:4001", "Ночной забег", "2027-06-19", "Москва", "road", [10]);
    RACES = [...RACES, NIGHT27];
    ANNOUNCED.set(EXP_NIGHT.id, NIGHT27.id);
    reset();
    NOW = new Date("2026-10-12T20:30:00Z"); // 23:30 МСК — тихие часы
    await bot.runTick();
    assert.ok(!texts(811).some((t) => t.startsWith("<b>Объявили дату")), "в тихие часы — ждём");
    NOW = new Date("2026-10-13T08:00:00Z");
    await bot.runTick();
    const ann = texts(811).filter((t) => t.startsWith("<b>Объявили дату:</b> Ночной забег, 19 июня, сб"));
    assert.equal(ann.length, 1, "«Объявили дату» одно сообщение");
    assert.ok(store.follows.some((f) => f.tg_id === 811 && f.race_id === NIGHT27.id), "сразу в «Мои забеги»");
    reset();
    await bot.runTick();
    assert.ok(!texts(811).some((t) => t.startsWith("<b>Объявили дату")), "повторно — нет");
    assert.ok(store.events.some((e) => e.event === "expected_watch" && e.tg_id === 811));
    assert.ok(store.events.some((e) => e.event === "expected_announced" && e.tg_id === 811));
  }

  // ── /delete ───────────────────────────────────────────────────────────────
  await bot.handleUpdate(msg(USER, "/delete"));
  await bot.handleUpdate(cb(USER, "del:yes"));
  assert.ok(!store.users.has(501) && !store.follows.some((f) => f.tg_id === 501) && !store.sends.some((s) => s.tg_id === 501), "всё удалено");
  assert.ok(!store.events.some((e) => e.tg_id === 501), "и события человека");
  assert.ok(store.events.some((e) => e.event === "delete" && e.tg_id === null), "удаление записано без tg_id");
  assert.match(texts(501).at(-1)!, /все твои данные удалены/);

  // ── deep link на город: подписка + онбординг с городом ─────────────────────
  reset();
  await bot.handleUpdate(msg({ id: 777, first_name: "Олег", username: "oleg" }, "/start c_kazan"));
  assert.equal(store.users.get(777)?.city, "Казань");
  assert.equal(store.users.get(777)?.digest_on, true);
  assert.match(texts(777)[0], /Подписал на новые забеги в Казани/);

  // ── мини-апп: только подписанный initData ──────────────────────────────────
  const token = "123456:TEST-token";
  const user = JSON.stringify({ id: 4242, first_name: "Мила", username: "mila" });
  const fields = { auth_date: String(Math.floor(Date.now() / 1000)), query_id: "AAE", user };
  const check = Object.entries(fields).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secret).update(check).digest("hex");
  const initData = new URLSearchParams({ ...fields, hash }).toString();
  assert.ok(validateTelegramInitDataWithToken(initData, token), "подписанный initData принят");
  assert.ok(!validateTelegramInitDataWithToken(initData.replace("4242", "4243"), token), "подменённый id — нет");
  assert.ok(!validateTelegramInitDataWithToken(initData, "999:other"), "чужой токен — нет");
  await bot.miniapp({ id: 4242, first_name: "Мила" }, "list");
  assert.ok(store.events.some((e) => e.event === "open_calendar" && e.tg_id === 4242), "open_calendar из мини-аппа");
  const follows = await bot.miniapp({ id: 4242, first_name: "Мила" }, "follow", TRAIL.id);
  assert.deepEqual(follows, [TRAIL.id], "звёздочка сохраняет");
  assert.deepEqual(await bot.miniapp({ id: 4242 }, "unfollow", TRAIL.id), [], "и снимает");

  // ── подпись ссылок /go/ ────────────────────────────────────────────────────
  process.env.RACES_BOT_TOKEN = "123456:TEST-token";
  const { goLink, goUser } = await import("@/features/races-bot/runtime");
  const signed = goLink(4242, TRAIL, "s");
  assert.match(signed, /^https:\/\/igorp\.run\/go\/s[0-9a-z]{11}-[0-9a-z]+-[0-9a-f]{10}$/);
  const g = parseGo(signed.split("/go/")[1])!;
  assert.equal(goUser(g), 4242, "подпись верна — клик засчитан этому человеку");
  assert.equal(goUser({ ...g, uid: 4243 }), null, "чужой id с той же подписью — анонимный клик");
  assert.deepEqual(parseGo(`r${raceCode(TRAIL.id)}`), { kind: "r", code: raceCode(TRAIL.id), uid: null, sig: null }, "анонимная ссылка");
  assert.equal(parseGo("x/../evil"), null);

  // ── тексты: имя проекта, без раскладок и прогнозов ─────────────────────────
  const allBotText = JSON.stringify(T);
  assert.ok(!/Старты России/.test(allBotText));
  for (const t of [T.week1(HALF).text, T.weeks12(HALF, true).text, T.afterFinish({ race_id: "x", created_at: "", race_name: "X", race_date: null, race_end: null, race_city: null }).text]) {
    assert.ok(!/раскладк|прогноз (на )?результат|прогноз времени|темп \d/i.test(t), `без раскладок и прогнозов: ${t}`);
  }

  console.log("check:races-bot ok");
}

main().catch((e) => {
  console.error("check:races-bot FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
