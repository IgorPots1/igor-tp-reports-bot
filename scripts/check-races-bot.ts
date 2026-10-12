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
import { BotBlockedError, createBot } from "@/features/races-bot/bot";
import {
  type ExpectedItem,
  START_PARAM_RE,
  citySlug,
  parseGo,
  inCity,
  parseSearch,
  parseStart,
  raceCode,
  resolveCity,
  startSource,
  geoKey,
  kmBetween,
  nearbyRaces,
  nearestCities,
  nextDigestDate,
  type BotRace,
} from "@/features/races-bot/core";
import { computeBotStats, statsMessage, type StatEvent } from "@/features/races-bot/stats";

import { memStore } from "./lib/races-bot-memstore";
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

// ── хранилище в памяти (scripts/lib/races-bot-memstore.ts) и запись Telegram ──────

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
// Часы защиты от двойного клика: каждое нажатие cb() — через 5 секунд после прошлого;
// двойной клик в тесте собирается вручную, без сдвига.
let CLICK = Date.parse("2026-10-12T10:00:00Z");
const store = memStore({ now: () => NOW, announced: ANNOUNCED, clock: () => CLICK });
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
const cb = (from: typeof USER, data: string) => (CLICK += 5000, {
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
  assert.deepEqual(parseStart("src_ig_story"), { kind: "src", label: "ig_story", raw: "src_ig_story" });
  // Было: метка без префикса src_ давала kind none, и приход из Instagram (start=ig_channel) терял
  // источник — у 7 первых людей source был пуст (12.10.2026). Теперь любая метка — источник как есть.
  assert.deepEqual(parseStart("ig_channel"), { kind: "src", label: "ig_channel", raw: "ig_channel" });
  assert.equal(startSource(parseStart("ig_channel")), "ig_channel");
  assert.equal(startSource(parseStart(`r_${raceCode(HALF.id)}`)), "r_*");
  assert.equal(startSource(parseStart("")), null);
  assert.deepEqual(parseStart("r_probeg:1001"), { kind: "none" }, "id с двоеточием параметром не принимается");
  assert.deepEqual(parseStart("x".repeat(65)), { kind: "none" }, "длиннее 64 — нет");
  assert.equal(citySlug("Санкт-Петербург"), "sankt-peterburg");
  assert.equal(citySlug("Москва"), "moskva");
  assert.equal(inCity("Москва"), "в Москве");
  assert.equal(inCity("Казань"), "в Казани");
  assert.equal(inCity("Екатеринбург"), "в Екатеринбурге");
  assert.deepEqual(parseSearch("трейл Казань"), { q: "казань", types: ["trail"], dists: [], month: null });
  // Город текстом (наряд 12.10.2026): сокращения, опечатки; не узнан — варианты, а не тишина.
  assert.equal(resolveCity(RACES, "мск").city, "Москва");
  assert.equal(resolveCity(RACES, "Казнь").city, "Казань");
  assert.equal(resolveCity(RACES, "Мсоква").city, "Москва");
  assert.deepEqual(resolveCity(RACES, "Казаньград"), { city: null, suggestions: ["Казань"] });
  assert.equal(resolveCity(RACES, "Абырвалгск").city, null);
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
  // Было: первое сообщение сразу с кнопками городов («Где ты бегаешь?»). Отменено нарядом 12.10:
  // два явных пути — «📍 Выбрать город» и «📅 Открыть весь календарь» (Mini App), и НИ ОДНОЙ кнопки
  // города, пока человек не нажал «Выбрать город».
  const greet = sent(501)[0];
  assert.match(String(greet.params.text), /^Привет! Я собираю все беговые старты России: \d+\+? забегов до конца 2027\. Выбери свой город, и я покажу старты рядом\. Или открой весь календарь и посмотри сам\.$/);
  assert.deepEqual(buttons(greet).map((b) => b.text), ["📍 Выбрать город", "📅 Открыть весь календарь"], "ровно два пути, без городов");
  assert.equal(buttons(greet)[0].callback_data, "pick");
  assert.match(String((buttons(greet)[1].web_app as { url: string }).url), /\/races\?from=first$/, "календарь из первого сообщения помечен");
  assert.ok(!/Где ты бегаешь/.test(String(greet.params.text)));
  await bot.handleUpdate(cb(USER, "pick"));
  const picker = sent(501).at(-1)!;
  assert.match(String(picker.params.text), /Где ты бегаешь\?/);
  assert.deepEqual(buttons(picker).map((b) => b.text), ["Москва", "Санкт-Петербург", "Казань", "Екатеринбург", "Отправить геолокацию", "Другой город"]);
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
  // Было «Следить» без значка; теперь заметная «⭐ Следить» (наряд 12.10: 3 списка — 0 сохранений).
  const cards = shown.filter((c) => buttons(c).some((b) => b.text === "⭐ Следить"));
  assert.ok(cards.length >= 1 && cards.length <= 5, `до 5 карточек, было ${cards.length}`);
  // Было: «Регистрация» вела прямо на сайт организатора. Теперь — через igorp.run/go/<код>, чтобы
  // записать клик (наряд статистики 12.10): ссылка подписана и привязана к этому человеку.
  const regBtn = buttons(cards[0]).find((b) => b.text === "Регистрация");
  assert.ok(regBtn?.url?.startsWith("https://igorp.run/go/r"), `«Регистрация» через /go/: ${regBtn?.url}`);
  const parsedGo = parseGo(regBtn!.url!.split("/go/")[1]);
  assert.ok(parsedGo && parsedGo.kind === "r" && parsedGo.uid === 501, "в ссылке код старта и tg_id");
  // Стартов меньше 3 (2 по фильтрам): вместо голого списка — «Рядом», «Ожидаются», «Снять фильтры»
  // и то же предложение рассылки; после первого списка — подсказка про ⭐, один раз.
  const footer = shown.find((c) => buttons(c).some((b) => b.callback_data === "dg:on"))!;
  assert.ok(footer, "предложение рассылки есть и под коротким списком");
  assert.ok(buttons(footer).some((b) => b.callback_data === "nf"), "кнопка «Снять фильтры»");
  assert.match(String(shown.at(-1)!.params.text), /Нажми ⭐, и я напомню, когда пора начинать готовиться/);
  reset();
  await bot.handleUpdate(cb(USER, "show"));
  assert.ok(!texts(501).some((t) => t.includes("Нажми ⭐, и я напомню")), "подсказка про ⭐ один раз");
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
  // Было: «Реже/Чаще» и «Пауза на месяц/Снять паузу» — переключатели; чек держал «Реже» = 2 недели
  // и паузу на 30 дней. Отменено нарядом 12.10.2026: человек не понимал, что они переключили.
  // Стало и стережётся: вверху состояние одной фразой, совпадающее с базой; режим дайджеста —
  // один из пяти вариантов, ✓ ровно у текущего; каждое нажатие меняет ТОЛЬКО режим и говорит,
  // что изменилось и когда следующий дайджест; старые кнопки ничего не меняют.
  {
    reset();
    await bot.handleUpdate(cb(USER, "s:dg:w1"));
    reset();
    await bot.handleUpdate(msg(USER, "/settings"));
    const me = () => store.users.get(501)!;
    const screen0 = sent(501).at(-1)!;
    assert.ok(String(screen0.params.text).includes(T.esc(T.settingsState(me(), NOW))), "состояние вверху = база");
    assert.match(T.settingsState(me(), NOW), /^Дайджест: раз в неделю, по понедельникам\. Город: Москва\. Типы и дистанции: .+\.$/);
    assert.deepEqual(buttons(screen0).filter((b) => b.text.startsWith("✓ ")).map((b) => b.text), ["✓ Присылать раз в неделю"], "✓ ровно у текущего");
    for (const label of ["Раз в 2 недели", "Раз в месяц", "Поставить на паузу на 2 недели", "Не присылать дайджест", "Сменить город", "Сменить типы и дистанции", "Мои забеги"]) {
      assert.ok(buttons(screen0).some((b) => b.text === label), `кнопка «${label}»`);
    }
    const MODE_FIELDS = new Set(["digest_on", "digest_every_weeks", "paused_until"]);
    const press = async (data: string) => {
      const before = { ...me() } as Record<string, unknown>;
      const c = calls.length;
      const evBefore = store.events.length;
      await bot.handleUpdate({ callback_query: { id: String(mid++), from: USER, data, message: { message_id: 4242, chat: { id: 501, type: "private" } } } });
      CLICK += 5000;
      const after = me() as unknown as Record<string, unknown>;
      const changed = Object.keys({ ...before, ...after }).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
      assert.ok(changed.every((k) => MODE_FIELDS.has(k)), `${data}: задело не только режим (${changed.join(",")})`);
      const out = calls.slice(c);
      return { changed, out, done: String(out.filter((x) => x.method === "sendMessage").at(-1)?.params.text ?? ""), edit: out.find((x) => x.method === "editMessageText"), events: store.events.slice(evBefore) };
    };
    const checkEdit = (r: Awaited<ReturnType<typeof press>>, mark: string) => {
      assert.ok(r.edit, "экран правится на месте");
      assert.ok(String(r.edit!.params.text).includes(T.esc(T.settingsState(me(), NOW))), "после нажатия состояние = база");
      assert.deepEqual(buttons(r.edit!).filter((b) => b.text.startsWith("✓ ")).map((b) => b.text), [mark]);
    };
    let r = await press("s:dg:w2");
    assert.deepEqual(r.changed, ["digest_every_weeks"], "меняется только частота");
    assert.equal(me().digest_every_weeks, 2);
    // понедельник 13:00 по Москве, дайджестов ещё не было: следующий — сегодня
    assert.equal(r.done, "Готово: дайджест раз в 2 недели. Следующий придёт сегодня, если появятся новые забеги.");
    checkEdit(r, "✓ Раз в 2 недели");
    r = await press("s:dg:w2");
    assert.deepEqual(r.changed, [], "повтор того же варианта ничего не меняет");
    assert.match(r.done, /^Так уже стоит: дайджест раз в 2 недели/);
    assert.equal(r.edit, undefined);
    assert.equal(r.events.length, 0, "и не пишет событие");
    r = await press("s:dg:w4");
    assert.deepEqual(r.changed, ["digest_every_weeks"]);
    assert.equal(me().digest_every_weeks, 4, "раз в месяц = 4 недели");
    checkEdit(r, "✓ Раз в месяц");
    r = await press("s:dg:pause");
    assert.deepEqual(r.changed, ["paused_until"], "пауза меняет только паузу");
    assert.equal(Date.parse(me().paused_until!), NOW.getTime() + 14 * 864e5, "пауза ровно 2 недели");
    assert.match(r.done, /^Готово: пауза до 26 октября\. До этого ничего не пришлю: ни дайджест, ни напоминания\. Потом дайджест раз в месяц, первый \d+ [а-я]+\.$/);
    checkEdit(r, "✓ На паузе до 26 октября");
    assert.match(T.settingsState(me(), NOW), /^Дайджест: на паузе до 26 октября, потом раз в месяц\./);
    r = await press("s:dg:w1");
    assert.deepEqual(r.changed.sort(), ["digest_every_weeks", "paused_until"], "частота снимает паузу");
    assert.equal(me().paused_until, null);
    assert.equal(nextDigestDate(me(), NOW), "2026-10-12");
    assert.match(r.done, /Следующий придёт сегодня,/, "дата следующего = расчёт");
    // дайджест сегодня уже был: следующий через неделю, датой
    const lastWas = me().digest_last_at;
    me().digest_last_at = "2026-10-12T07:30:00Z";
    assert.equal(T.settingsDone(me(), NOW, "w1", nextDigestDate(me(), NOW), false).text, "Готово: дайджест раз в неделю. Следующий придёт 19 октября, если появятся новые забеги.");
    me().digest_last_at = lastWas;
    checkEdit(r, "✓ Присылать раз в неделю");
    r = await press("s:dg:off");
    assert.deepEqual(r.changed, ["digest_on"]);
    assert.equal(r.done, "Готово: дайджест не присылаю. Напоминания о сохранённых забегах остаются.");
    checkEdit(r, "✓ Не присылать дайджест");
    assert.equal(nextDigestDate(me(), NOW), null);
    r = await press("s:dg:w1");
    assert.deepEqual(r.changed, ["digest_on"]);
    // старые кнопки в прежних сообщениях: ничего не меняют
    for (const old of ["s:rarer", "s:pause"]) {
      r = await press(old);
      assert.deepEqual(r.changed, [], `${old} больше ничего не переключает`);
      assert.ok(r.out.some((x) => String(x.params.text).startsWith("Эта кнопка из старой версии настроек")));
    }
    r = await press("s:prefs");
    assert.deepEqual(r.changed, []);
    assert.ok(r.out.some((x) => buttons(x).some((b) => b.callback_data === "show")), "типы и дистанции с «Показать забеги»");
    // nextDigestDate: понедельник 10:00 по времени человека, после паузы и не раньше периода
    assert.equal(nextDigestDate({ digest_on: true, digest_every_weeks: 1, digest_last_at: null, paused_until: null }, new Date("2026-10-12T10:00:00Z")), "2026-10-12");
    assert.equal(nextDigestDate({ digest_on: true, digest_every_weeks: 1, digest_last_at: "2026-10-12T07:00:00Z", paused_until: null }, new Date("2026-10-12T10:00:00Z")), "2026-10-19");
    assert.equal(nextDigestDate({ digest_on: true, digest_every_weeks: 4, digest_last_at: "2026-10-12T07:00:00Z", paused_until: null }, new Date("2026-10-12T10:00:00Z")), "2026-11-09");
    assert.equal(nextDigestDate({ digest_on: true, digest_every_weeks: 1, digest_last_at: null, paused_until: "2026-10-26T10:00:00Z" }, new Date("2026-10-12T10:00:00Z")), "2026-10-26");
  }

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
  // Было: воронка по событиям, и «старт тренера тоже старт» (2 из 2). Отменено нарядом 12.10:
  // единица — человек, тренер и тестовые не считаются, процент — от предыдущего шага.
  assert.match(st, /Новые за период: 1\n/, "тренер не считается");
  assert.match(st, /Пришёл: 1\n/);
  assert.match(st, /Выбрал город: 1 \(100%\)/);
  assert.match(st, /Нажал ⭐: 1 \(100%\)/);
  assert.match(st, /Запросил консультацию: 1\n/, "на шаге до — 0 человек: без процента");
  assert.ok(!/Пришёл: 2/.test(st), "тренер в воронку не попал");
  assert.match(st, /src_ig_story: 1 \/ 1 \/ 1/, "источник по первому приходу дошёл до ⭐ и заявки");
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
  // Было «s:pause» (пауза на месяц, переключатель); теперь пауза — вариант режима, 2 недели.
  await bot.handleUpdate(cb(USER, "s:dg:pause"));
  reset();
  NOW = new Date("2026-10-18T08:00:00Z"); // за 6 дней до SHORT
  await bot.runTick();
  assert.equal(texts(501).length, 0, "на паузе — ничего");
  await bot.handleUpdate(cb(USER, "s:dg:w1"));
  assert.equal(store.users.get(501)?.paused_until, null, "выбор частоты снимает паузу");

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
    // Было: source перезаписывался меткой каждого /start (ожидали "e_*"). Отменено нарядом 12.10:
    // source — только первый приход; Олег пришёл текстом, повторный /start с меткой уходит в событие.
    assert.equal(store.users.get(811)?.source, null, "повторный приход source не меняет");
    const olegStart = store.events.filter((e) => e.tg_id === 811 && e.event === "start").at(-1);
    assert.equal(olegStart?.source, "e_*", "метка повторного прихода — в событии");
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

  // ── статистика по людям (наряд 12.10.2026): один tg_id, 5 раз /start с разными метками ──
  {
    const T0 = "2026-10-12T09:00:00Z";
    const at = (m: number) => new Date(Date.parse(T0) + m * 60000).toISOString();
    const users = [
      { tg_id: 777, first_name: "Пять", username: null, city: "Москва", source: null, created_at: T0, blocked: false },
      { tg_id: 900, first_name: "Тренер", username: null, city: "Москва", source: "site_race", created_at: T0, blocked: false },
    ];
    const ev = (tg: number, event: string, m: number, param: string | null = null): StatEvent =>
      ({ tg_id: tg, event, race_id: null, source: null, meta: param === null ? {} : { param }, created_at: at(m) });
    const events = [
      ev(777, "start", 1, "ig_channel"), ev(777, "start", 2, "src_tt"), ev(777, "start", 3, "ig_story"), ev(777, "start", 4, ""),
      ev(777, "start", 5, "vk_post"), ev(777, "city_chosen", 6), ev(777, "click_registration", 7),
      ev(900, "start", 1, "site_race"), ev(900, "follow", 2),
    ];
    const s = computeBotStats({ users, events, follows: [], now: new Date("2026-10-12T12:00:00Z"), period: 30, exclude: new Set([900]) });
    assert.equal(s.people.newPeriod, 1, "новых людей 1, повторы новыми не считаются");
    assert.equal(s.people.startPresses, 5, "нажатий /start 5, тренер исключён");
    assert.deepEqual(s.sources.map((x) => [x.source, x.users]), [["ig_channel", 1]], "source = первая метка (source в строке пуст, как у первых 7)");
    assert.deepEqual(s.returnedVia.map((x) => x.source).sort(), ["ig_story", "src_tt", "vk_post"], "остальные метки — «вернулся через»");
    const step = (k: string) => s.funnel.find((f) => f.key === k)!;
    assert.equal(step("follow").people, 0);
    assert.equal(step("click").people, 1);
    assert.equal(step("click").pct, null, "на шаге до — никого: процента нет, а не «0%»");
    assert.match(statsMessage(s).text, /Регистрация или сайт: 1\n/);
  }

  // ── первый экран: календарь сразу, город, молчание 30 минут (наряд 12.10.2026) ──
  {
    const CAL = { id: 6101, first_name: "Календарь", username: "cal6101" };
    const CITY = { id: 6102, first_name: "Город", username: "city6102" };
    const QUIET = { id: 6103, first_name: "Молчун", username: "quiet6103" };
    const startAt = NOW;
    for (const p of [CAL, CITY, QUIET]) await bot.handleUpdate(msg(p, "/start ig_channel"));
    // календарь сразу: Mini App с меткой first
    await bot.miniapp({ id: CAL.id, first_name: CAL.first_name }, "list", undefined, "first");
    assert.deepEqual(store.events.filter((e) => e.tg_id === CAL.id && e.event === "open_calendar").map((e) => e.meta), [{ from: "first" }]);
    // город: «Выбрать город» → Москва
    await bot.handleUpdate(cb(CITY, "pick"));
    await bot.handleUpdate(cb(CITY, `city:${citySlug("Москва")}`));
    assert.equal(store.users.get(CITY.id)?.city, "Москва");
    // 20 минут: рано
    NOW = new Date(startAt.getTime() + 20 * 60000);
    assert.equal(await bot.runNudge(), 0, "до 30 минут не напоминаем");
    // 35 минут: одно напоминание молчуну, тем, кто нажал, ничего
    NOW = new Date(startAt.getTime() + 35 * 60000);
    const before = calls.length;
    assert.equal(await bot.runNudge(), 1);
    const nudges = calls.slice(before).filter((c) => c.method === "sendMessage");
    assert.deepEqual(nudges.map((c) => c.params.chat_id), [QUIET.id], "только тому, кто ничего не нажал");
    assert.deepEqual(buttons(nudges[0]).map((b) => b.text), ["📍 Выбрать город", "📅 Открыть весь календарь"], "те же два пути");
    assert.match(String((buttons(nudges[0])[1].web_app as { url: string }).url), /from=reminder/);
    // второго нет: ни через 10 минут, ни почасовым тиком
    NOW = new Date(startAt.getTime() + 45 * 60000);
    assert.equal(await bot.runNudge(), 0, "второго напоминания нет");
    await bot.runTick();
    assert.equal(calls.slice(before).filter((c) => c.method === "sendMessage" && c.params.chat_id === QUIET.id && String(c.params.text).startsWith("Если удобно")).length, 1);
    assert.equal(store.events.filter((e) => e.tg_id === QUIET.id && e.event === "nudge_sent").length, 1);
    // поздно (больше 3 часов) — не догоняем
    const LATE = { id: 6104, first_name: "Поздно", username: "late6104" };
    NOW = startAt;
    await bot.handleUpdate(msg(LATE, "/start"));
    NOW = new Date(startAt.getTime() + 4 * 3600000);
    assert.equal(await bot.runNudge(), 0, "через 4 часа уже не напоминаем");
    NOW = startAt;
    // статистика: календарь по людям и откуда, ветка воронки
    const s = computeBotStats({
      users: [...store.users.values()].filter((u) => [CAL.id, CITY.id, QUIET.id].includes(u.tg_id)),
      events: store.events.filter((e) => e.tg_id !== null && [CAL.id, CITY.id, QUIET.id].includes(e.tg_id)),
      follows: [], now: new Date(startAt.getTime() + 3600000), period: 30,
    });
    assert.equal(s.calendar.people, 1);
    assert.deepEqual(s.calendar.byFrom, [{ from: "first", people: 1 }]);
    assert.equal(s.calendar.cohort, 1);
    assert.equal(s.calendar.cohortPct, 33);
    assert.deepEqual(s.nudge, { sent: 1, acted: 0 });
    const sm = statsMessage(s).text;
    assert.match(sm, /Ветка: пришёл → открыл календарь: 1 \(33%\)/);
    assert.match(sm, /Открыли календарь:<\/b> 1 чел\. \(первое сообщение 1\)/);
  }

  // ── 📅 Весь календарь: под списком, в «С возвращением!», в «Мои забеги», в ответе на непонятное ──
  {
    const K = { id: 6201, first_name: "Кира", username: "kira6201" };
    await bot.handleUpdate(msg(K, "/start"));
    await bot.handleUpdate(cb(K, `city:${citySlug("Москва")}`));
    const calBtn = (from: number) => calls.slice(from).filter((c) => c.method === "sendMessage" && c.params.chat_id === K.id).flatMap(buttons).find((b) => b.text === "📅 Весь календарь");
    const places: [string, () => Promise<void>, string][] = [
      ["под списком", () => bot.handleUpdate(cb(K, "show")), "list"],
      ["С возвращением", () => bot.handleUpdate(msg(K, "/start")), "menu"],
      ["Мои забеги", () => bot.handleUpdate(cb(K, "my")), "my"],
      ["непонятный текст", () => bot.handleUpdate({ message: { message_id: mid++, chat: { id: K.id, type: "private" }, from: K, sticker: { file_id: "x" } } } as never), "menu"],
    ];
    for (const [where, act, from] of places) {
      const c = calls.length;
      await act();
      const b = calBtn(c);
      assert.ok(b?.web_app, `📅 Весь календарь: ${where}`);
      const url = (b!.web_app as { url: string }).url;
      assert.match(url, new RegExp(`from=${from}`), `метка ${from}: ${where}`);
      assert.match(url, /q=%D0%9C%D0%BE%D1%81%D0%BA%D0%B2%D0%B0|q=Москва/, `календарь сразу с городом: ${where}`);
    }
  }

  // ── «Рядом» по координатам (наряд 12.10.2026): радиус 150 км, ближайшие первыми, км ──
  {
    const TVER = { lat: 56.859, lon: 35.912 };
    const at = (r: BotRace, g: { lat: number; lon: number } | null): BotRace => ({ ...r, geo: g });
    const tver = at(race("probeg:g1", "Тверской забег", "2027-05-09", "Тверь", "road", [10]), TVER);
    const torzhok = at(race("probeg:g2", "Торжокский полумарафон", "2027-06-01", "Торжок", "road", [21.1]), { lat: 57.041, lon: 34.96 }); // ~60 км
    const klin = at(race("probeg:g3", "Клинский забег", "2027-05-20", "Клин", "road", [10]), { lat: 56.331, lon: 36.729 }); // ~80 км
    const rzhev = at(race("probeg:g4", "Ржевский забег", "2027-07-01", "Ржев", "road", [10]), { lat: 56.262, lon: 34.329 }); // ~115 км
    const spb = at(race("probeg:g5", "Белые ночи", "2027-06-27", "Санкт-Петербург", "road", [42.2]), { lat: 59.939, lon: 30.316 }); // ~480 км
    const nogeo = at(race("probeg:g6", "Без координат", "2027-06-01", "Неизвестно", "road", [10]), null);
    const pool = [tver, torzhok, klin, rzhev, spb, nogeo];
    assert.equal(geoKey("Тверь ", "Тверская  область"), "тверь, тверская область");
    assert.ok(Math.abs(kmBetween(TVER, { lat: 59.939, lon: 30.316 }) - 480) < 15, "Тверь — Петербург ~480 км");
    const n = nearbyRaces(pool, "Тверь", [], []);
    assert.equal(n.radius, true);
    assert.deepEqual(n.races.map((r) => r.city), ["Торжок", "Клин", "Ржев"], "ближайшие первыми, дальше 150 км и без координат — нет");
    assert.ok(n.km.get(torzhok.id)! < n.km.get(klin.id)! && n.km.get(rzhev.id)! <= 150);
    // от геолокации человека: точка у Клина — Клин ближе Торжка
    const fromKlin = nearbyRaces(pool, "Тверь", [], [], { lat: 56.4, lon: 36.6 });
    assert.equal(fromKlin.races[0].city, "Клин");
    // у города нет координат — прежнее «тот же регион»
    assert.equal(nearbyRaces(RACES, "Казань", [], []).radius, false);
    // карточка «Рядом»: расстояние отдельной строкой, не в дистанциях
    assert.match(T.card(torzhok, false, null, 61).text, /\n📍 61 км по прямой$/);
    assert.match(T.nearbyRadiusHeader(150, true).text, /до 150 км от тебя, ближайшие первыми/);
    assert.deepEqual(nearestCities(pool, { lat: 56.95, lon: 35.4 }), ["Торжок", "Тверь", "Ржев"].sort((a, b) =>
      kmBetween({ lat: 56.95, lon: 35.4 }, pool.find((r) => r.city === a)!.geo!) - kmBetween({ lat: 56.95, lon: 35.4 }, pool.find((r) => r.city === b)!.geo!)));

    // бот: короткий список в Твери — «Рядом» по радиусу; геолокация сохраняет точку, город кнопкой её сбрасывает
    const savedRaces = RACES;
    RACES = pool;
    const G = { id: 6301, first_name: "Гео", username: "geo6301" };
    await bot.handleUpdate(msg(G, "/start"));
    await bot.handleUpdate(cb(G, "pick"));
    await bot.handleUpdate(cb(G, "city_other"));
    await bot.handleUpdate(msg(G, "Тверь"));
    let c = calls.length;
    await bot.handleUpdate(cb(G, "show"));
    const out = calls.slice(c).filter((x) => x.method === "sendMessage").map((x) => String(x.params.text));
    const hi = out.findIndex((t) => t.includes("<b>Рядом</b>, до 150 км от города"));
    assert.ok(hi >= 0, "заголовок «Рядом» по радиусу");
    assert.match(out[hi + 1], /Торжокский[\s\S]*📍 \d+ км по прямой/, "первым ближайший, с км");
    const GEO = { id: 6302, first_name: "Точка", username: "pt6302" };
    await bot.handleUpdate(msg(GEO, "/start"));
    await bot.handleUpdate({ message: { message_id: mid++, chat: { id: GEO.id, type: "private" }, from: GEO, location: { latitude: 56.85, longitude: 35.9 } } } as never);
    // reverseGeocode в чеке отвечает «Казань» — её нет в pool: ближайшие города кнопками cityg:
    const near = sent(GEO.id).at(-1)!;
    assert.match(String(near.params.text), /Ближайшие города со стартами/);
    assert.equal(buttons(near)[0].text, "Тверь");
    await bot.handleUpdate(cb(GEO, buttons(near)[0].callback_data!));
    assert.deepEqual([store.users.get(GEO.id)?.city, store.users.get(GEO.id)?.geo_lat], ["Тверь", 56.85], "город из ближайших — точка остаётся");
    c = calls.length;
    await bot.handleUpdate(cb(GEO, "show"));
    assert.ok(calls.slice(c).some((x) => String(x.params.text).includes("до 150 км от тебя")), "«Рядом» от геолокации");
    await bot.handleUpdate(cb(GEO, "s:city"));
    await bot.handleUpdate(cb(GEO, `city:${citySlug("Тверь")}`));
    assert.equal(store.users.get(GEO.id)?.geo_lat, null, "город кнопкой сбрасывает точку");
    RACES = savedRaces;
  }

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
