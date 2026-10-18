/**
 * Обход всех экранов бота «Забеги России» в двух режимах — rich и обычный текст (наряд 18.10.2026):
 * обработчик вызывается локально, Telegram подменён записью вызовов, никому ничего не уходит.
 *
 * ЧТО СТЕРЕЖЁТ (по каждому ответу бота на каждом экране):
 *   — лимиты Telegram: текст ≤ 4096; rich ≤ 32 768 знаков текста, ≤ 500 блоков (строка таблицы и
 *     вложенные блоки считаются), ≤ 20 колонок; кнопок ≤ 100, в ряду ≤ 8, callback_data ≤ 64 байт;
 *   — нигде нет «нет данных»; нет пустых таблиц (только шапка); у ячеек есть align/valign; нет пустых
 *     частей RichText;
 *   — у каждого экрана, кроме главного, есть «🏠 Меню»;
 *   — нет кнопок в никуда: ключ каждого callback_data есть в обработчике бота;
 *   — переносы (18.10.2026): текст, rich и кнопки — неподвижная точка nbsp (неразрывные пробелы в «21 км»,
 *     «25 окт, вс», «№ 5», перед «·»); ни одна строка не начинается с «·» или с единицы измерения.
 *
 *   npm run check:races-bot-screens
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { toRace, type RaceRow } from "@/app/races/races-logic";
import { createBot } from "@/features/races-bot/bot";
import { raceCode, type BotRace, type ExpectedItem } from "@/features/races-bot/core";
import type { FullRow } from "@/features/race-details/full";

import { memStore } from "./lib/races-bot-memstore";
import { nbsp, nbspDeep, nbspHtml } from "@/lib/typography";

type Call = { method: string; params: Record<string, unknown> };
type Btn = { text: string; callback_data?: string; url?: string; web_app?: { url: string } };

// ── обработчики callback: ключи из switch в bot.ts (и «rt|» перед ним) ─────────────────────
const botSrc = readFileSync("src/features/races-bot/bot.ts", "utf8");
const cbBody = botSrc.slice(botSrc.indexOf("async function onCallback("), botSrc.indexOf("\n  }\n", botSrc.indexOf("switch (key)", botSrc.indexOf("async function onCallback("))));
const HANDLED = new Set([...cbBody.matchAll(/case "([^"]+)":/g)].map((m) => m[1]));
const keyOf = (data: string) => (data.startsWith("rt|") ? keyOf(data.slice(3)) : data.split(":")[0]);

// ── данные ──────────────────────────────────────────────────────────────────────────
function race(id: string, name: string, ds: string, city: string, type: string, km: number[], geo: { lat: number; lon: number } | null = null, subject = ""): BotRace {
  const row: RaceRow = {
    id, source: "probeg", source_url: `https://probeg.org/event/${id}/`, name, date_start: ds, date_end: ds,
    city, region: subject, distances: km.map((k) => `${k} км`), dist_km: km, race_type: type, tags: [],
    site_url: "https://example.org/race", reg_url: "https://reg.example.org/r", vk_url: null, sources: ["probeg"],
    link_ok: true, alt_dates: [], checked_note: null,
  };
  return { ...toRace(row), geo, subject, firstSeen: "2026-01-01T00:00:00Z" };
}
const TVER = { lat: 56.859, lon: 35.912 };
const TO = "Тверская область";
const LONG = "Чемпионат и Первенство Тверской области по лёгкой атлетике в беге на шоссе среди всех возрастов";
const RACES: BotRace[] = [
  // Тверь: 6 стартов осенью (2 страницы), длинное название, + Змейка (есть разбор трассы в index.json)
  ...Array.from({ length: 6 }, (_, i) => race(`probeg:t${i}`, i === 0 ? LONG : `Тверской забег ${i + 1}`, `2026-10-${String(20 + i).padStart(2, "0")}`, "Тверь", i % 2 ? "trail" : "road", [21.1, 10, 5], TVER, TO)),
  race("probeg:74251", "Забег «Змейка Трейл»", "2026-11-07", "Тверь", "trail", [12, 7], TVER, TO),
  // область и рядом
  race("probeg:a1", "Старицкий пробег", "2026-10-25", "Старица", "road", [10], { lat: 56.514, lon: 34.934 }, TO),
  race("probeg:a2", "Конаковский трейл", "2026-11-01", "Конаково", "trail", [15], { lat: 56.708, lon: 36.761 }, TO),
  // Пермь: ровно один старт
  race("probeg:p1", "Парк кросс", "2026-10-25", "Пермь", "trail", [8, 3, 1], { lat: 58.01, lon: 56.25 }, "Пермский край"),
  // 10 стартов для «Мои забеги»
  ...Array.from({ length: 10 }, (_, i) => race(`probeg:m${i}`, `Московский старт ${i + 1}`, `2026-11-${String(10 + i).padStart(2, "0")}`, "Москва", "road", [10], { lat: 55.75, lon: 37.62 }, "Москва")),
];
const EXPECTED: ExpectedItem[] = [
  { id: "probeg:e1", name: "Тверской ночной забег", city: "Тверь", region: TO, type: "road", distances: ["10 км"], km: [10], lastMonth: 11, lastDate: "2025-11-15", lastUrl: "https://probeg.org/event/e1/", site: "", subject: TO, geo: TVER } as ExpectedItem,
];
const row = (distance: number | null, field: string, value: string): FullRow => ({ distance, field, value, source_url: "https://org.example/r", checked_at: "2026-10-15" });
const DETAILS = new Map<string, FullRow[]>([
  ["probeg:t1", [row(21.1, "start_time", "10:00"), row(10, "start_time", "10:30"), row(null, "packet_pickup", "сб 12:00–20:00"), row(null, "registration_status", "открыта"), row(null, "cutoff", "21,1 км — 3 ч; закрытие трассы 13:30"), row(null, "baggage", "нет данных"), row(null, "track", "нет данных")]],
  ["probeg:74251", [row(12, "start_time", "12:00"), row(7, "start_time", "12:00"), row(null, "packet_pickup", "07.11 8:00–11:00"), row(null, "track", "GPX на Яндекс Диске")]],
]);
const CANCELLED = new Set<string>();

// ── бот и запись вызовов ─────────────────────────────────────────────────────────────
const calls: Call[] = [];
const tg = { async call(method: string, params: Record<string, unknown>) { calls.push({ method, params }); return { message_id: calls.length }; } };
let NOW = new Date("2026-10-18T09:00:00Z");
const store = memStore({ now: () => NOW, announced: new Map(), clock: () => NOW.getTime() });
let races = RACES;
const bot = createBot({
  store, tg, races: async () => races, expected: async () => EXPECTED, now: () => NOW, coachUsername: "IgorPotseluev",
  details: async (id) => DETAILS.get(id) ?? [], cancelled: async () => CANCELLED,
});
let mid = 1;
const who = { id: 6001, first_name: "Обход", username: "screens6001" };
const msg = (text: string) => ({ message: { message_id: mid++, chat: { id: who.id, type: "private" }, from: who, text } });
let click = 0;
const cbm = (data: string) => {
  NOW = new Date(NOW.getTime() + 5000 + click++); // мимо защиты от двойного клика
  const u = store.users.get(who.id);
  return { callback_query: { id: String(mid++), from: who, data, message: { message_id: u?.menu_message_id ?? mid, chat: { id: who.id, type: "private" } } } };
};

// ── проверки одного ответа ───────────────────────────────────────────────────────────
const problems: string[] = [];
let checkedScreens = 0;
const NO_DATA = /нет данных/i;
const isMain = (c: Call) => {
  const t = typeof c.params.text === "string" ? c.params.text : JSON.stringify(c.params.rich_message ?? "");
  return /С возвращением!|Привет! Я собираю|Если удобно, выбери свой город/.test(t);
};
function richStats(blocks: { type: string; [k: string]: unknown }[]): { blocks: number; chars: number; issues: string[] } {
  let n = 0, chars = 0;
  const issues: string[] = [];
  const text = (x: unknown): void => {
    if (typeof x === "string") { chars += x.length; return; }
    if (Array.isArray(x)) { if (x.some((p) => p === "")) issues.push("пустая часть RichText"); x.forEach(text); return; }
    if (x && typeof x === "object") { const o = x as Record<string, unknown>; text(o.text); if (typeof o.alternative_text === "string") chars += o.alternative_text.length; }
  };
  const walk = (bs: { type: string; [k: string]: unknown }[]) => {
    for (const b of bs) {
      n++;
      if (b.type === "table") {
        const cells = b.cells as { text?: unknown; align?: string; valign?: string; is_header?: boolean }[][];
        n += cells.length;
        if (!cells.some((r) => !r.every((c) => c.is_header))) issues.push("пустая таблица (только шапка)");
        if (cells.some((r) => r.length > 20)) issues.push("больше 20 колонок");
        if (cells.flat().some((c) => !c.align || !c.valign)) issues.push("ячейка без align/valign");
        cells.flat().forEach((c) => text(c.text));
      } else if (b.type === "details") {
        text(b.summary);
        walk(b.blocks as { type: string }[]);
      } else text(b.text);
    }
  };
  walk(blocks);
  return { blocks: n, chars, issues };
}
/** Где две строки расходятся — кусок вокруг первого отличия. */
function diffSnippet(a: string, b: string): string {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return a.slice(Math.max(0, i - 15), i + 15);
}
function check(c: Call, screen: string, mode: string) {
  const where = `[${mode}] ${screen}`;
  const kb = ((c.params.reply_markup as { inline_keyboard?: Btn[][] } | undefined)?.inline_keyboard ?? []) as Btn[][];
  if (typeof c.params.text === "string") {
    if (c.params.text.length > 4096) problems.push(`${where}: текст ${c.params.text.length} > 4096`);
    if (NO_DATA.test(c.params.text)) problems.push(`${where}: «нет данных» в тексте`);
  }
  if (c.params.rich_message) {
    const rm = c.params.rich_message as { blocks: { type: string }[] };
    const s = richStats(rm.blocks);
    if (s.blocks > 500) problems.push(`${where}: ${s.blocks} блоков > 500`);
    if (s.chars > 32768) problems.push(`${where}: ${s.chars} знаков > 32768`);
    for (const i of new Set(s.issues)) problems.push(`${where}: ${i}`);
    if (NO_DATA.test(JSON.stringify(rm))) problems.push(`${where}: «нет данных» в rich`);
  }
  const flat = kb.flat();
  if (flat.length > 100) problems.push(`${where}: ${flat.length} кнопок > 100`);
  if (kb.some((r) => r.length > 8)) problems.push(`${where}: больше 8 кнопок в ряду`);
  for (const b of flat) {
    if (b.callback_data !== undefined) {
      if (Buffer.byteLength(b.callback_data) > 64) problems.push(`${where}: callback_data > 64 байт «${b.callback_data}»`);
      if (!HANDLED.has(keyOf(b.callback_data))) problems.push(`${where}: кнопка «${b.text}» → «${b.callback_data}»: нет обработчика`);
    }
    if (b.url && !/^(https?|tg):\/\//.test(b.url)) problems.push(`${where}: кнопка «${b.text}»: url «${b.url}»`);
    if (!b.callback_data && !b.url && !b.web_app) problems.push(`${where}: кнопка «${b.text}» без действия`);
  }
  // клавиатура главного меню (её бот ставит под сообщение без своих кнопок) — тоже путь домой
  const mainKb = flat.some((b) => b.callback_data === "my") && flat.some((b) => b.callback_data === "s:menu");
  if (kb.length && !isMain(c) && !mainKb && !flat.some((b) => b.callback_data === "menu")) problems.push(`${where}: нет «🏠 Меню»`);
  // переносы: всё уже прошло через nbsp, и ни одна строка не начинается с «·» или с единицы
  const UNIT_START = /^\s*(·|км|м|мин|ч|час|дн|дней|дня|день|лет|года?)(?![А-Яа-яЁё])/m;
  if (typeof c.params.text === "string") {
    const t = c.params.text;
    if (nbspHtml(t) !== t) problems.push(`${where}: обычный пробел там, где нужен неразрывный: «${diffSnippet(t, nbspHtml(t))}»`);
    const plain = t.replace(/<[^>]+>/g, "");
    if (UNIT_START.test(plain)) problems.push(`${where}: строка начинается с «·» или единицы: «${plain.match(UNIT_START)![0].trim()}»`);
  }
  if (c.params.rich_message && JSON.stringify(nbspDeep(c.params.rich_message)) !== JSON.stringify(c.params.rich_message)) {
    problems.push(`${where}: в rich обычный пробел там, где нужен неразрывный: «${diffSnippet(JSON.stringify(c.params.rich_message), JSON.stringify(nbspDeep(c.params.rich_message)))}»`);
  }
  for (const b of flat) if (nbsp(b.text) !== b.text) problems.push(`${where}: кнопка «${b.text}» без неразрывного пробела`);
  if (!kb.length && c.method !== "editMessageReplyMarkup") problems.push(`${where}: экран без кнопок`);
  checkedScreens++;
}
/** Выполнить шаг и проверить все ответы бота человеку; вернуть последний экран. */
async function step(screen: string, mode: string, update: unknown): Promise<Call | undefined> {
  const from = calls.length;
  await bot.handleUpdate(update as never);
  const out = calls.slice(from).filter((c) => c.params.chat_id === who.id && /^(sendMessage|editMessageText|sendRichMessage)$/.test(c.method));
  if (!out.length) problems.push(`[${mode}] ${screen}: бот ничего не показал`);
  out.forEach((c) => check(c, screen, mode));
  return out.at(-1);
}
const btnsOf = (c?: Call) => (((c?.params.reply_markup as { inline_keyboard?: Btn[][] } | undefined)?.inline_keyboard ?? []) as Btn[][]).flat();

async function run(mode: "rich" | "text") {
  store.config.set("rich_for", mode === "rich" ? "all" : "off");
  store.users.delete(who.id);
  for (let i = store.follows.length - 1; i >= 0; i--) if (store.follows[i].tg_id === who.id) store.follows.splice(i, 1);
  // время только вперёд: защита от двойного клика помнит прошлые нажатия
  // онбординг: приветствие, выбор города, город текстом, фильтры
  await step("приветствие (/start нового)", mode, msg("/start"));
  await step("выбор города", mode, cbm("pick"));
  await step("другой город", mode, cbm("city_other"));
  await step("город текстом", mode, msg("Тверь"));
  await step("главный", mode, msg("/start"));
  const fork = await step("сезоны", mode, cbm("sz"));
  // все сезоны из развилки, с листанием
  for (const b of btnsOf(fork).filter((x) => x.callback_data?.startsWith("sn:"))) {
    const lst = await step(`список ${b.text}`, mode, cbm(b.callback_data!));
    const next = btnsOf(lst).find((x) => x.text === "▶");
    if (next) await step(`список ${b.text}, стр. 2`, mode, cbm(next.callback_data!));
  }
  // карточки: все номера на всех страницах «Все старты подряд» (там и ожидаемый старт)
  const pages: Btn[] = [];
  for (let p = 0, more = true; more && p < 5; p++) {
    const all = await step(`список все, стр. ${p + 1}`, mode, cbm(`sn:all:${p}`));
    pages.push(...btnsOf(all).filter((x) => x.callback_data?.startsWith("so:")));
    more = btnsOf(all).some((x) => x.text === "▶");
  }
  for (const b of pages) {
    const card = await step(`карточка №${b.text}`, mode, cbm(b.callback_data!));
    // «Всё о старте» (текст) и разбор трассы, если есть
    const ds = btnsOf(card).find((x) => x.callback_data?.startsWith("ds:"));
    if (ds) await step(`всё о старте №${b.text}`, mode, cbm(ds.callback_data!));
    const tc = btnsOf(card).find((x) => x.callback_data?.startsWith("tc:"));
    if (tc) {
      const ch = await step(`разбор трассы №${b.text}`, mode, cbm(tc.callback_data!));
      const tv = btnsOf(ch).find((x) => x.callback_data?.startsWith("tv:"));
      if (tv) await step(`разбор, дистанция №${b.text}`, mode, cbm(tv.callback_data!));
    }
  }
  // карточка Змейки напрямую (выжимка + разбор трассы)
  await step("карточка с выжимкой и разбором", mode, cbm(`oc:${raceCode("probeg:74251")}`));
  // следить и убрать
  const c1 = await step("карточка t1", mode, cbm(`oc:${raceCode("probeg:t1")}`));
  const sf = btnsOf(c1).find((x) => x.callback_data?.startsWith("sf:"));
  if (sf) {
    const after = await step("после ⭐ Следить", mode, cbm(sf.callback_data!));
    const su = btnsOf(after).find((x) => x.callback_data?.startsWith("su:"));
    if (su) await step("после «убрать»", mode, cbm(su.callback_data!));
  }
  // Мои забеги: пусто, 1, 10 (+ отменённый)
  for (let i = store.follows.length - 1; i >= 0; i--) if (store.follows[i].tg_id === who.id) store.follows.splice(i, 1);
  await step("мои забеги: пусто", mode, cbm("my"));
  await bot.handleUpdate(cbm(`f:${raceCode("probeg:t2")}`) as never);
  const my1 = await step("мои забеги: 1", mode, cbm("my"));
  const mo = btnsOf(my1).find((x) => x.callback_data?.startsWith("mo:"));
  if (mo) await step("карточка из моих забегов", mode, cbm(mo.callback_data!));
  for (let i = 0; i < 10; i++) await bot.handleUpdate(cbm(`f:${raceCode(`probeg:m${i}`)}`) as never);
  const my10 = await step("мои забеги: 11", mode, cbm("my"));
  const more = btnsOf(my10).find((x) => x.callback_data?.startsWith("myp:"));
  if (more) await step("мои забеги: стр. 2", mode, cbm(more.callback_data!));
  // отменённый: старт пропал из календаря и помечен отменённым
  CANCELLED.add("probeg:t2");
  races = RACES.filter((r) => r.id !== "probeg:t2");
  await step("мои забеги с отменённым", mode, cbm("my"));
  races = RACES;
  CANCELLED.clear();
  // ожидаемый старт — карточка из списка сезона, где он есть
  await step("настройки", mode, msg("/settings"));
  await step("фильтры", mode, cbm("flt"));
  await step("мой город", mode, msg("/city"));
  await step("календарь", mode, msg("/calendar"));
  await step("поиск без результата", mode, msg("абырвалг забег"));
  await step("поиск Пермь (1 старт)", mode, msg("Пермь"));
  await step("меню кнопкой", mode, cbm("menu"));
  await step("непонятное", mode, msg("/непонятно"));
}

async function main() {
  for (const mode of ["rich", "text"] as const) await run(mode);
  // ожидаемые попали хотя бы в один экран (иначе проверка ожидаемых ничего не проверила)
  assert.ok(calls.some((c) => JSON.stringify(c.params).includes("Тверской ночной забег")), "ожидаемый старт показан");
  assert.ok(calls.some((c) => /Сообщить, когда объявят/.test(JSON.stringify(c.params.reply_markup ?? ""))), "карточка ожидаемого старта открыта");
  if (problems.length) {
    console.log([...new Set(problems)].join("\n"));
    console.log(`\ncheck:races-bot-screens: ${new Set(problems).size} проблем на ${checkedScreens} ответах`);
    process.exit(1);
  }
  console.log(`check:races-bot-screens: ${checkedScreens} ответов бота, проблем нет`);
}
main().catch((e) => { console.error(e); process.exit(1); });
