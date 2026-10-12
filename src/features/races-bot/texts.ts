/* Тексты и клавиатуры бота «Забеги России». Формулировки — из макета (канвас «Бот «Забеги
 * России»», 12.10.2026); «старты» в кнопках заменены на «забеги» по наряду. Без раскладок,
 * прогнозов и результатов: только сам старт, напоминания и консультация. */

import { MONTHS_GEN, TYPE_LABEL, distPills, plural, type Race } from "@/app/races/races-logic";
import { SITE_URL } from "@/lib/site";

import {
  DIST_BUTTONS,
  TYPE_BUTTONS,
  citySlug,
  countdown,
  daysBetween,
  inCity,
  raceCode,
  usuallyIn,
  type BotRace,
  type ExpectedItem,
  type PlanFollow,
} from "./core";

export type Button = { text: string; callback_data?: string; url?: string; web_app?: { url: string } };
export type Keyboard = { inline_keyboard: Button[][] };
export type Msg = { text: string; reply_markup?: Keyboard | Record<string, unknown> };

export const CALENDAR_URL = `${SITE_URL}/races`;

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const MON_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function d(iso: string): Date {
  const [y, m, dd] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd));
}

/** «18 окт, вс» или «1-3 мая». */
export function shortDate(r: { ds: string; de: string }): string {
  const a = d(r.ds);
  const b = d(r.de);
  if (r.de !== r.ds) {
    return a.getUTCMonth() === b.getUTCMonth()
      ? `${a.getUTCDate()}-${b.getUTCDate()} ${MON_SHORT[b.getUTCMonth()]}`
      : `${a.getUTCDate()} ${MON_SHORT[a.getUTCMonth()]} - ${b.getUTCDate()} ${MON_SHORT[b.getUTCMonth()]}`;
  }
  return `${a.getUTCDate()} ${MON_SHORT[a.getUTCMonth()]}, ${WD[a.getUTCDay()]}`;
}

/** «18 октября, вс». */
export function longDate(iso: string): string {
  const a = d(iso);
  return `${a.getUTCDate()} ${MONTHS_GEN[a.getUTCMonth()]}, ${WD[a.getUTCDay()]}`;
}

export function raceMeta(r: Race): string {
  const parts = [r.city || "место уточняется"];
  if (TYPE_LABEL[r.type]) parts.push(TYPE_LABEL[r.type].toLowerCase());
  const dist = distPills(r).join(" / ");
  if (dist) parts.push(dist);
  return parts.join(" · ");
}

export function raceUrl(r: Race): string {
  return r.reg || r.site || r.vk || r.src || CALENDAR_URL;
}

/** Откуда открыт календарь: для статистики («первое сообщение», «под списком», «меню»…). */
export type CalendarFrom = "first" | "list" | "menu" | "my" | "reminder";

/** Кнопка Mini App. q — город или запрос: календарь сразу открывается отфильтрованным по нему. */
export function calendarButton(text: string, q?: string, from?: CalendarFrom): Button {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (from) p.set("from", from);
  const qs = p.toString();
  return { text, web_app: { url: qs ? `${CALENDAR_URL}?${qs}` : CALENDAR_URL } };
}

export const CALENDAR_LABEL = "📅 Весь календарь";

// ── онбординг ────────────────────────────────────────────────────────────────

export const TOP_CITIES = ["Москва", "Санкт-Петербург", "Казань", "Екатеринбург"];

/** «470+»: вниз до десятка, чтобы число не устаревало каждый день. */
function racesCount(n: number): string {
  return n >= 20 ? `${Math.floor(n / 10) * 10}+` : String(n);
}

/** Первое сообщение нового человека: два явных пути, город и весь календарь. Кнопки городов — после «Выбрать город». */
export function greeting(nRaces: number): Msg {
  return {
    text:
      `Привет! Я собираю все беговые старты России: ${racesCount(nRaces)} забегов до конца 2027. ` +
      "Выбери свой город, и я покажу старты рядом. Или открой весь календарь и посмотри сам.",
    reply_markup: {
      inline_keyboard: [
        [{ text: "📍 Выбрать город", callback_data: "pick" }],
        [calendarButton("📅 Открыть весь календарь", undefined, "first")],
      ],
    },
  };
}

/** Одно мягкое напоминание через 30 минут, если после /start ничего не нажато. Никогда повторно. */
export function nudge(): Msg {
  return {
    text: "Если удобно, выбери свой город, и я покажу старты рядом. Или открой весь календарь и посмотри сам.",
    reply_markup: {
      inline_keyboard: [
        [{ text: "📍 Выбрать город", callback_data: "pick" }],
        [calendarButton("📅 Открыть весь календарь", undefined, "reminder")],
      ],
    },
  };
}

/** Выбор города: топ-города, геолокация, «Другой город». */
export function cityPicker(): Msg {
  return {
    text: "Где ты бегаешь?",
    reply_markup: {
      inline_keyboard: [
        [{ text: "Москва", callback_data: `city:${citySlug("Москва")}` }, { text: "Санкт-Петербург", callback_data: `city:${citySlug("Санкт-Петербург")}` }],
        [{ text: "Казань", callback_data: `city:${citySlug("Казань")}` }, { text: "Екатеринбург", callback_data: `city:${citySlug("Екатеринбург")}` }],
        [{ text: "Отправить геолокацию", callback_data: "geo" }, { text: "Другой город", callback_data: "city_other" }],
      ],
    },
  };
}

export const ASK_CITY: Msg = { text: "Напиши название города, например: Новосибирск" };

export const ASK_GEO: Msg = {
  text: "Нажми кнопку внизу, и я найду забеги рядом.",
  reply_markup: {
    keyboard: [[{ text: "Отправить геолокацию", request_location: true }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  },
};

const mark = (on: boolean, label: string) => (on ? `✓ ${label}` : label);

export function prefs(types: string[], dists: string[], lead?: string): Msg {
  return {
    text: `${lead ? `${lead}\n\n` : ""}Что тебе интересно? Можно выбрать несколько.`,
    reply_markup: {
      inline_keyboard: [
        TYPE_BUTTONS.map(([id, label]) => ({ text: mark(types.includes(id), label), callback_data: `t:${id}` })),
        DIST_BUTTONS.slice(0, 2).map(([id, label]) => ({ text: mark(dists.includes(id), label), callback_data: `d:${id}` })),
        DIST_BUTTONS.slice(2).map(([id, label]) => ({ text: mark(dists.includes(id), label), callback_data: `d:${id}` })),
        [{ text: "Показать забеги", callback_data: "show" }],
      ],
    },
  };
}

// ── список ───────────────────────────────────────────────────────────────────

function filtersPhrase(types: string[], dists: string[]): string {
  const t = TYPE_BUTTONS.filter(([id]) => types.includes(id)).map(([, l]) => l.toLowerCase());
  const ds = DIST_BUTTONS.filter(([id]) => dists.includes(id)).map(([, l]) => l.toLowerCase());
  const parts: string[] = [];
  if (t.length) parts.push(t.join(" и "));
  if (ds.length) parts.push(`есть ${ds.join(", ")}`);
  return parts.length ? `: ${parts.join(", ")}` : "";
}

export function listHeader(where: string, types: string[], dists: string[]): Msg {
  return { text: `Ближайшие забеги ${where}${filtersPhrase(types, dists)}. Нажми <b>⭐ Следить</b>, и я напомню о главном.` };
}

/** Один раз, после первого показанного списка (наряд 12.10.2026: 3 списка, 0 сохранений). */
export const STAR_HINT: Msg = { text: "Нажми ⭐, и я напомню, когда пора начинать готовиться." };

export function hasFilters(types: string[], dists: string[]): boolean {
  return types.length > 0 || dists.length > 0;
}

/** Мало или нет стартов: что сказать перед блоками «Рядом» и «Ожидаются». */
export function shortListNote(where: string, n: number, filtered: boolean): Msg {
  const head = n === 0
    ? `${where[0].toUpperCase()}${where.slice(1)} по ${filtered ? "этим фильтрам" : "этому запросу"} пока ни одного забега.`
    : `${where[0].toUpperCase()}${where.slice(1)} пока ${n} ${plural(n, "забег", "забега", "забегов")}${filtered ? " по этим фильтрам" : ""}.`;
  return { text: `${head} Вот что ещё можно посмотреть:` };
}

export function nearbyHeader(region: string): Msg {
  return { text: `<b>Рядом</b>, ${esc(region)}:` };
}

/** Кнопки под коротким списком: снять фильтры, сменить город, весь календарь. */
export function shortListActions(filtered: boolean, q?: string, digestOffer = false): Msg {
  const rows: Button[][] = [];
  if (digestOffer) rows.push([{ text: "Присылать новые по понедельникам", callback_data: "dg:on" }, { text: "Не надо", callback_data: "dg:off" }]);
  if (filtered) rows.push([{ text: "Снять фильтры", callback_data: "nf" }]);
  rows.push([{ text: "Сменить город", callback_data: "s:city" }, calendarButton(CALENDAR_LABEL, q, "list")]);
  const base = filtered ? "Можно снять фильтры, сменить город или открыть весь календарь." : "Можно сменить город или открыть весь календарь.";
  return { text: digestOffer ? `Новые забеги появляются каждую неделю: присылать их раз в неделю? ${base}` : base, reply_markup: { inline_keyboard: rows } };
}

/** regUrl — ссылка «Регистрация» (через igorp.run/go/, чтобы записать клик); null — кнопки нет. */
export function card(r: Race, following: boolean, regUrl: string | null = r.reg || r.site || null): Msg {
  const row: Button[] = [following ? { text: "✓ Слежу", callback_data: `my` } : { text: "⭐ Следить", callback_data: `f:${raceCode(r.id)}` }];
  const url = regUrl;
  if (url) row.push({ text: "Регистрация", url });
  return { text: `<b>${shortDate(r)}</b> · ${esc(r.name)}\n${esc(raceMeta(r))}`, reply_markup: { inline_keyboard: [row] } };
}

export function listFooter(more: number, city: string | null, digestOn: boolean, q?: string, nextOffset?: number): Msg {
  const rows: Button[][] = [];
  let text: string;
  if (more > 0) text = `Ещё ${more} ${plural(more, "забег", "забега", "забегов")}${city ? ` ${inCity(city)}` : ""} до конца года.`;
  else text = "Это все забеги по этому запросу.";
  if (more > 0 && nextOffset !== undefined) rows.push([{ text: `Показать ещё ${Math.min(more, 5)}`, callback_data: `more:${nextOffset}` }]);
  if (city && !digestOn) {
    text += " Присылать новые раз в неделю?";
    rows.push([{ text: "Да, по понедельникам", callback_data: "dg:on" }, { text: "Не надо", callback_data: "dg:off" }]);
  }
  rows.push([calendarButton(CALENDAR_LABEL, q ?? city ?? undefined, "list")]);
  return { text, reply_markup: { inline_keyboard: rows } };
}

export function nothingFound(where: string, q?: string): Msg {
  return {
    text: `Пока не нашёл забегов ${where}. Попробуй написать город (например, «Казань») или вид и город («трейл Казань»).`,
    reply_markup: { inline_keyboard: [[calendarButton(CALENDAR_LABEL, q, "list")], [{ text: "Меню", callback_data: "menu" }]] },
  };
}

// ── возврат, главное меню, город не найден, не текст ─────────────────────────

/** Главное меню: город, мои забеги, календарь, настройки, смена города, начать заново. */
export function menuKeyboard(city: string | null): Keyboard {
  return {
    inline_keyboard: [
      ...(city ? [[{ text: `Забеги ${inCity(city)}`, callback_data: "show" }]] : []),
      [{ text: "Мои забеги", callback_data: "my" }, calendarButton(CALENDAR_LABEL, city ?? undefined, "menu")],
      [{ text: "Настройки", callback_data: "s:menu" }, { text: "Сменить город", callback_data: "s:city" }],
      [{ text: "Начать заново", callback_data: "restart" }],
    ],
  };
}

function filtersLine(types: string[], dists: string[]): string {
  const t = TYPE_BUTTONS.filter(([id]) => types.includes(id)).map(([, l]) => l.toLowerCase());
  const ds = DIST_BUTTONS.filter(([id]) => dists.includes(id)).map(([, l]) => l.toLowerCase());
  return [...t, ...ds].join(", ") || "все забеги";
}

/** Повторный /start у человека, который уже выбрал город: сводка и меню, без онбординга. */
export function welcomeBack(
  u: { first_name: string | null; city: string | null; types: string[]; distances: string[] },
  saved: { race: Race }[],
  today: string,
  head = "С возвращением!",
): Msg {
  const next = saved[0];
  const lines = [
    `<b>${head}</b>`,
    `Город: <b>${esc(u.city || "не выбран")}</b>`,
    `Фильтры: ${esc(filtersLine(u.types, u.distances))}`,
    saved.length
      ? `Сохранено: ${saved.length} ${plural(saved.length, "забег", "забега", "забегов")}, ближайший: ${esc(next.race.name)} (${countdown(daysBetween(today, next.race.ds))})`
      : "Сохранённых забегов пока нет: нажми ⭐ под забегом.",
  ];
  return { text: lines.join("\n"), reply_markup: menuKeyboard(u.city) };
}

export function cityNotFound(text: string, suggestions: string[]): Msg {
  const rows: Button[][] = suggestions.map((c) => [{ text: c, callback_data: `city:${citySlug(c)}` }]);
  rows.push([{ text: "Отправить геолокацию", callback_data: "geo" }, calendarButton("Весь календарь")]);
  return {
    text: suggestions.length
      ? `Не нашёл город «${esc(text.slice(0, 60))}». Может быть, один из этих?`
      : `Не нашёл город «${esc(text.slice(0, 60))}» среди городов с забегами. Попробуй написать иначе (например, «Нижний Новгород») или отправь геолокацию.`,
    reply_markup: { inline_keyboard: rows },
  };
}

export function unknownInput(city: string | null): Msg {
  return {
    text: "Я понимаю текст и кнопки. Напиши город или, например, «трейл Казань», или выбери в меню.",
    reply_markup: menuKeyboard(city),
  };
}

export function unknownCommand(city: string | null): Msg {
  return { text: "Такой команды нет. Напиши город или, например, «трейл Казань».", reply_markup: menuKeyboard(city) };
}

export function alreadyFollowing(r: Race): Msg {
  return { text: `Уже слежу за «${esc(r.name)}». Напомню, когда пора готовиться.`, reply_markup: NAV };
}

export const ALREADY_UNSUBSCRIBED: Msg = { text: "Ты уже отписан от всего. Вернуться можно командой /start." };

export const DIGEST_ON: Msg = { text: "Договорились: новые забеги буду присылать по понедельникам, одно сообщение в неделю." };
export const DIGEST_OFF: Msg = { text: "Хорошо, без рассылки. Найти забеги можно в любой момент: напиши, например, «трейл Казань»." };

// ── «Сохранил» и консультация ────────────────────────────────────────────────

export function saved(r: Race): Msg {
  return {
    text:
      `✓ <b>Сохранил</b>\n<b>${esc(r.name)}</b>\n${longDate(r.ds)} · ${esc(r.city || "место уточняется")}\n\n` +
      "Что пришлю по этому забегу:\n· за неделю: короткий чек-лист старта\n· накануне: погоду на трассе",
  };
}

export const NAV: Keyboard = {
  inline_keyboard: [[{ text: "Мои забеги", callback_data: "my" }, calendarButton("Найти ещё")]],
};

export function consultOffer(code: string): Msg {
  return {
    text:
      "Нужна помощь с подготовкой?\nЗапишись на бесплатную консультацию: тренер разберёт твою ситуацию " +
      "и даст конкретное решение под этот старт.",
    reply_markup: {
      inline_keyboard: [
        [{ text: "Записаться", callback_data: `consult:${code}` }, { text: "Пока не нужно", callback_data: "noconsult" }],
        NAV.inline_keyboard[0],
      ],
    },
  };
}

export function consultReply(coachUsername: string, raceName: string | null): Msg {
  const pre = raceName ? `Привет! Хочу консультацию по подготовке к ${raceName}` : "Привет! Хочу консультацию по подготовке";
  return {
    text: "Отлично! Напиши тренеру в личку, он ответит:",
    reply_markup: {
      inline_keyboard: [[{ text: "Написать тренеру", url: `https://t.me/${coachUsername}?text=${encodeURIComponent(pre)}` }]],
    },
  };
}

export function coachNotice(u: { first_name: string | null; username: string | null; city: string | null; source: string | null }, races: string[]): string {
  return [
    "Заявка на консультацию:",
    `${esc(u.first_name || "без имени")}, ${u.username ? `@${esc(u.username)}` : "без username"}, ${esc(u.city || "город не указан")}`,
    `Сохранённые забеги: ${races.length ? races.map(esc).join("; ") : "нет"}`,
    `Источник: ${esc(u.source || "не указан")}`,
  ].join("\n");
}

export const NO_CONSULT: Msg = { text: "Хорошо. Если понадобится, кнопка консультации будет в сообщениях перед стартом." };

// ── мои забеги, настройки, удаление ──────────────────────────────────────────

export const MY_PAGE = 10;

export function myRaces(all: { race: Race; code: string; site?: string }[], today: string, page = 0, city?: string | null): Msg {
  const items = all.slice(page * MY_PAGE, (page + 1) * MY_PAGE);
  if (!all.length) {
    return {
      text: "Ты пока не следишь ни за одним забегом. Найди свой в календаре или в списке и нажми ⭐.",
      reply_markup: { inline_keyboard: [[calendarButton(CALENDAR_LABEL, city ?? undefined, "my")]] },
    };
  }
  const lines = items.map(({ race }) => {
    const left = daysBetween(today, race.ds);
    return `<b>${esc(race.name)}</b> · ${countdown(left)}\n${shortDate(race)} · ${esc(raceMeta(race))}`;
  });
  // Страницы по 10: текст укладывается в 4096 знаков, кнопок не больше 100 (лимиты Telegram).
  const pages = Math.ceil(all.length / MY_PAGE);
  const nav: Button[] = [];
  if (page > 0) nav.push({ text: "Назад", callback_data: `myp:${page - 1}` });
  if (page < pages - 1) nav.push({ text: `Ещё (${all.length - (page + 1) * MY_PAGE})`, callback_data: `myp:${page + 1}` });
  const head = pages > 1 ? `Твои забеги (${page + 1}/${pages})` : "Твои забеги";
  return {
    text: `${head}\n\n${lines.join("\n\n")}`.slice(0, 4000),
    reply_markup: {
      inline_keyboard: [
        ...items.map(({ race, code, site }) => [
          { text: `Сайт старта · ${race.name.slice(0, 24)}`, url: site ?? raceUrl(race) },
          { text: "Убрать старт", callback_data: `u:${code}` },
        ]),
        ...(nav.length ? [nav] : []),
        [calendarButton(CALENDAR_LABEL, city ?? undefined, "my")],
      ],
    },
  };
}

export function settings(u: { city: string | null; digest_on: boolean; digest_every_weeks: number; paused_until: string | null }, now: Date): Msg {
  const paused = u.paused_until && Date.parse(u.paused_until) > now.getTime();
  const sub = !u.digest_on
    ? "выключены"
    : `${u.city || "город не выбран"}, ${u.digest_every_weeks === 2 ? "раз в две недели" : "по понедельникам"}`;
  const lines = [
    `Город: <b>${esc(u.city || "не выбран")}</b>`,
    `Новые забеги: <b>${sub}</b>`,
    "Тихие часы: <b>22:00-9:00</b>",
    `Сообщений в неделю: <b>${u.digest_every_weeks === 2 ? "не больше 1 в две недели" : "не больше 1"}</b>`,
  ];
  if (paused) lines.push(`Пауза до <b>${longDate(u.paused_until!.slice(0, 10))}</b>`);
  return {
    text: `Настройки\n\n${lines.join("\n")}`,
    reply_markup: {
      inline_keyboard: [
        [
          { text: u.digest_every_weeks === 2 ? "Чаще" : "Реже", callback_data: "s:rarer" },
          { text: paused ? "Снять паузу" : "Пауза на месяц", callback_data: "s:pause" },
        ],
        [{ text: "Сменить город", callback_data: "s:city" }, { text: "Отписаться от всего", callback_data: "s:unsub" }],
      ],
    },
  };
}

export const UNSUBSCRIBED: Msg = {
  text: "Отписал от всего: ни дайджеста, ни напоминаний. Сохранённые забеги я снял. Вернуться можно командой /start.",
};

export const DELETE_CONFIRM: Msg = {
  text: "Удалить все мои данные о тебе: город, фильтры и сохранённые забеги? Это нельзя отменить.",
  reply_markup: { inline_keyboard: [[{ text: "Удалить всё", callback_data: "del:yes" }, { text: "Отмена", callback_data: "del:no" }]] },
};
export const DELETED: Msg = { text: "Готово: все твои данные удалены. Если захочешь вернуться, просто напиши /start." };
export const DELETE_CANCELLED: Msg = { text: "Ничего не удалил." };

// ── плановые сообщения ───────────────────────────────────────────────────────

const CONSULT_ROW = (code: string, no = "Не сейчас"): Button[] => [
  { text: "Бесплатная консультация", callback_data: `consult:${code}` },
  { text: no, callback_data: "noconsult" },
];

function distWord(r: Race): string {
  if (r.type === "tri") return "триатлону";
  if (r.tags.includes("ultra") || r.km.some((x) => x > 42.5)) return "ультре";
  if (r.tags.includes("marathon") || r.km.some((x) => Math.abs(x - 42.195) < 0.4)) return "марафону";
  return "полумарафону";
}

export function weeks12(r: Race, withConsult: boolean): Msg {
  const text =
    `<b>До старта «${esc(r.name)}» 12 недель.</b> Пора начинать подготовку к ${distWord(r)}. Как обычно выглядят эти недели:\n` +
    "1-4 · база и объём\n5-9 · темповая работа\n10-12 · подводка к старту" +
    (withConsult ? "\n\nЕсли нужна помощь с подготовкой, запишись на бесплатную консультацию: тренер разберёт твою ситуацию и даст конкретное решение." : "");
  return { text, reply_markup: withConsult ? { inline_keyboard: [CONSULT_ROW(raceCode(r.id))] } : undefined };
}

export function week1(r: Race, siteUrl: string = raceUrl(r)): Msg {
  return {
    text:
      `<b>Через неделю старт: ${esc(r.name)}.</b> Короткий чек-лист:\n` +
      "· время старта и выдачу стартовых пакетов проверь на сайте забега\n" +
      "· проверенные кроссовки и форма, ничего нового в день старта\n" +
      "· последняя тяжёлая тренировка позади, дальше легко\n" +
      "· побольше сна в последние ночи\n\n" +
      "Погоду на трассе пришлю накануне.",
    reply_markup: { inline_keyboard: [[{ text: "Сайт старта", url: siteUrl }]] },
  };
}

export type Weather = { tMax: number; tMin: number; rainProb: number | null; windMax: number | null };

export function dayBefore(r: Race, w: Weather | null, siteUrl: string = raceUrl(r)): Msg {
  const head = `<b>Завтра старт: ${esc(r.name)}</b>, ${esc(r.city || "")}.`;
  const body = w
    ? `\nПогода на завтра: днём до ${Math.round(w.tMax)}°, ночью ${Math.round(w.tMin)}°` +
      (w.rainProb !== null ? `, вероятность осадков ${Math.round(w.rainProb)}%` : "") +
      (w.windMax !== null ? `, ветер до ${Math.round(w.windMax)} м/с` : "") +
      ".\nОденься по погоде на старте, а не на разминке. Удачи!"
    : "\nПрогноз погоды получить не удалось: проверь его перед выходом. Удачи!";
  return { text: head + body, reply_markup: { inline_keyboard: [[{ text: "Сайт старта", url: siteUrl }]] } };
}

export function afterFinish(f: PlanFollow): Msg {
  return {
    text:
      `С финишем${f.race_name ? ` на «${esc(f.race_name)}»` : ""}! Если хочешь подготовиться к следующему старту лучше, ` +
      "тренер бесплатно разберёт твою ситуацию на консультации. А ещё могу подобрать следующий старт.",
    reply_markup: {
      inline_keyboard: [[{ text: "Консультация", callback_data: "consult:-" }, { text: "Следующий старт", callback_data: "show" }]],
    },
  };
}

export function cancelled(f: PlanFollow): Msg {
  return {
    text:
      `Забег «${esc(f.race_name || "без названия")}»${f.race_date ? ` (${longDate(f.race_date)})` : ""} пропал из календаря: ` +
      "похоже, его отменили или перенесли. Я снял его с отслеживания. Проверь новости на сайте организатора.",
    reply_markup: { inline_keyboard: [[calendarButton("Найти другой забег", f.race_city || undefined)]] },
  };
}

export function digest(
  city: string,
  races: BotRace[],
  following: Set<string>,
  regUrl: (r: BotRace) => string | null = (r) => r.reg || r.site || null,
): Msg[] {
  const head: Msg = {
    text: `Новые забеги ${inCity(city)} за неделю: ${races.length}.`,
    reply_markup: { inline_keyboard: [[{ text: `Все забеги ${inCity(city).replace(/^в /, "в ")}`, callback_data: "dlist" }]] },
  };
  const cards = races.slice(0, 5).map((r) => card(r, following.has(r.id), regUrl(r)));
  const tail: Msg[] =
    races.length > 5
      ? [{ text: `И ещё ${races.length - 5} в календаре.`, reply_markup: { inline_keyboard: [[calendarButton("Открыть календарь", city)]] } }]
      : [];
  return [head, ...cards, ...tail];
}

// ── ожидаемые старты ─────────────────────────────────────────────────────────

/** Блок под списком: ожидаемые старты без даты и кнопка «Сообщить, когда объявят дату». */
export function expectedBlock(items: ExpectedItem[], watching: Set<string>): Msg {
  const lines = items.map((e) => `· <b>${esc(e.name)}</b>, ${esc(e.city || "место уточняется")}, ${usuallyIn(e.lastMonth)}`);
  return {
    text: `Ожидаются, дата 2027 пока не объявлена:\n${lines.join("\n")}`,
    reply_markup: {
      inline_keyboard: items.map((e) =>
        watching.has(e.id)
          ? [{ text: `✓ Сообщу: ${e.name.slice(0, 28)}`, callback_data: "noop" }]
          : [{ text: `Сообщить, когда объявят: ${e.name.slice(0, 22)}`, callback_data: `ew:${raceCode(e.id)}` }],
      ),
    },
  };
}

export function expectedWatching(e: ExpectedItem): Msg {
  return {
    text: `Хорошо: сообщу, как только объявят дату «${esc(e.name)}» (${esc(e.city || "")}, ${usuallyIn(e.lastMonth)}). Сразу добавлю его в «Мои забеги».`,
    reply_markup: { inline_keyboard: [[{ text: "Прошлый старт", url: e.lastUrl }]] },
  };
}

export function announced(r: Race): Msg {
  return {
    text: `<b>Объявили дату:</b> ${esc(r.name)}, ${longDate(r.ds)} · ${esc(r.city || "")}.\nДобавил его в «Мои забеги»: напомню, когда пора готовиться, и про погоду накануне.`,
    reply_markup: NAV,
  };
}
