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
  START_PARAM_RE,
  citySlug,
  inCity,
  parseSearch,
  parseStart,
  raceCode,
  type BotRace,
} from "@/features/races-bot/core";
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

// ── хранилище в памяти и запись Telegram ─────────────────────────────────────

function memStore(): BotStore & { users: Map<number, BotUser>; follows: BotFollow[]; sends: { tg_id: number; kind: string; race_id: string | null }[]; config: Map<string, string> } {
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
    users, follows, sends, config,
    async getUser(id) { return users.get(id) ?? null; },
    async saveUser(p) { const u = { ...(users.get(p.tg_id) ?? blank(p.tg_id)), ...p }; users.set(p.tg_id, u); return u; },
    async deleteUser(id) {
      users.delete(id);
      for (let i = follows.length - 1; i >= 0; i--) if (follows[i].tg_id === id) follows.splice(i, 1);
      for (let i = sends.length - 1; i >= 0; i--) if (sends[i].tg_id === id) sends.splice(i, 1);
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
    async stats() { return { users: users.size, usersWeek: users.size, blocked: 0, digest: 0, follows: follows.length, followsWeek: 0, consults: 0, consultsWeek: 0, sources: [] }; },
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
  now: () => NOW,
  coachUsername: "IgorPotseluev",
  reverseGeocode: async () => "Казань",
  weather: async () => ({ tMax: 14.4, tMin: 6.2, rainProb: 30, windMax: 4.1 }),
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
  assert.equal(store.users.get(501)?.source, "ig_story", "источник из start=src_");
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
  assert.ok(buttons(cards[0]).some((b) => b.text === "Регистрация" && b.url), "кнопка регистрации — ссылка");
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
  for (const part of ["Заявка на консультацию", "Анна", "@anna_runs", "Москва", "Полумарафон «Покровское-Стрешнево»", "Источник: ig_story"]) {
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
  reset();
  await bot.handleUpdate(msg(USER, "/stats"));
  assert.ok(!texts(501)[0].includes("статистика"), "чужому — нет");
  await bot.handleUpdate(msg(COACH, "/stats"));
  assert.match(texts(900).at(-1)!, /Забеги России: статистика/);

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

  // ── /delete ───────────────────────────────────────────────────────────────
  await bot.handleUpdate(msg(USER, "/delete"));
  await bot.handleUpdate(cb(USER, "del:yes"));
  assert.ok(!store.users.has(501) && !store.follows.some((f) => f.tg_id === 501) && !store.sends.some((s) => s.tg_id === 501), "всё удалено");
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
  const follows = await bot.miniapp({ id: 4242, first_name: "Мила" }, "follow", TRAIL.id);
  assert.deepEqual(follows, [TRAIL.id], "звёздочка сохраняет");
  assert.deepEqual(await bot.miniapp({ id: 4242 }, "unfollow", TRAIL.id), [], "и снимает");

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
