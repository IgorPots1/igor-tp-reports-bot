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
  localParts,
  raceCode,
  usuallyIn,
  type BotRace,
  type ExpectedItem,
  type PlanFollow,
  type Season,
  type SeasonItem,
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

/** Нижней reply-клавиатуры нет совсем (наряд 13.10.2026): геолокация — через скрепку. */
export const ASK_GEO: Msg = {
  text: "Пришли геолокацию: скрепка 📎 внизу, потом «Геопозиция». Найду города со стартами рядом. Или напиши город словами.",
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

/**
 * Второй блок: «Тверская область и рядом» (та же область плюс 150 км). fromYou — радиус от геолокации.
 * Было (до 12.10.2026): «Рядом, <регион>» или «Рядом, до 150 км от города» и только при коротком списке.
 */
export function areaHeader(subject: string, km: number, fromYou: boolean): Msg {
  const what = subject ? `${esc(subject)} и рядом` : "Рядом";
  return { text: `<b>${what}</b>: до ${km} км ${fromYou ? "от тебя" : "от города"}, ближайшие первыми.` };
}

/** «Ещё в области и рядом»: следующая страница второго блока. */
export function areaMore(n: number, nextOffset: number): Msg {
  return {
    text: `И ещё ${n} ${plural(n, "забег", "забега", "забегов")} в области и рядом.`,
    reply_markup: { inline_keyboard: [[{ text: `Показать ещё ${Math.min(n, 5)}`, callback_data: `area:${nextOffset}` }]] },
  };
}

/** Где старт второго блока: «Старица, 71 км»; город не указан — «Тверская область, город не указан». */
export function placeLine(r: Race, km: number | null): string {
  const place = r.city || (r.subject ? `${r.subject}, город не указан` : "город не указан");
  return km === null ? place : `${place}, ${km} км`;
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
/** place — для блока «область и рядом»: «Старица, 71 км» отдельной строкой (не путать с дистанциями забега). */
export function card(r: Race, following: boolean, regUrl: string | null = r.reg || r.site || null, place?: string): Msg {
  const row: Button[] = [following ? { text: "✓ Слежу", callback_data: `my` } : { text: "⭐ Следить", callback_data: `f:${raceCode(r.id)}` }];
  const url = regUrl;
  if (url) row.push({ text: "Регистрация", url });
  const away = place === undefined ? "" : `\n📍 ${esc(place)}`;
  return { text: `<b>${shortDate(r)}</b> · ${esc(r.name)}\n${esc(raceMeta(r))}${away}`, reply_markup: { inline_keyboard: [row] } };
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

/** Первый блок длиннее страницы: «Ещё N в Твери» с кнопкой, до второго блока. */
export function cityMore(more: number, where: string, nextOffset?: number, q?: string): Msg {
  const rows: Button[][] = nextOffset !== undefined ? [[{ text: `Показать ещё ${Math.min(more, 5)} ${where}`, callback_data: `more:${nextOffset}` }]] : [[calendarButton(CALENDAR_LABEL, q, "list")]];
  return { text: `Ещё ${more} ${plural(more, "забег", "забега", "забегов")} ${where}.`, reply_markup: { inline_keyboard: rows } };
}

/** Конец списка из двух блоков: предложить дайджест (свой город, если не подписан) и весь календарь. */
export function listEnd(city: string | null, digestOn: boolean, q?: string): Msg {
  const rows: Button[][] = [];
  let text = "Весь календарь со всеми фильтрами:";
  if (city && !digestOn) {
    text = "Присылать новые забеги раз в неделю, по понедельникам?";
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
      ...(city ? [[{ text: `Старты: ${city} и рядом`, callback_data: "sz" }]] : []),
      [{ text: "Мои забеги", callback_data: "my" }, calendarButton(CALENDAR_LABEL, city ?? undefined, "menu")],
      [{ text: "Настройки", callback_data: "s:menu" }, { text: "Сменить город", callback_data: "s:city" }],
      [{ text: "Начать заново", callback_data: "restart" }],
    ],
  };
}

/** Фильтры словами для развилки; пусто — фильтров нет. */
export function filtersText(types: string[], dists: string[]): string {
  return types.length || dists.length ? filtersLine(types, dists) : "";
}

/** Подсказка про ⭐ строкой в списке сезона (одна, в том же сообщении). */
export const STAR_HINT_LIST = "Открой старт кнопкой с номером и нажми ⭐, и я напомню, когда пора начинать готовиться.";

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

/** Геолокация в месте без своих стартов: ближайшие города со стартами (до 150 км) кнопками. */
export function nearestCitiesMsg(cities: string[]): Msg {
  return {
    text: "Своих стартов там пока нет. Ближайшие города со стартами:",
    // cityg: — город выбран, но «Рядом» по-прежнему считается от присланной точки.
    reply_markup: { inline_keyboard: [...cities.map((c) => [{ text: c, callback_data: `cityg:${citySlug(c)}` }]), [calendarButton(CALENDAR_LABEL)]] },
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

// ── настройки ────────────────────────────────────────────────────────────────
//
// Было (до 12.10.2026): «Реже/Чаще» и «Пауза на месяц/Снять паузу» — переключатели, у которых
// не видно ни текущего состояния, ни результата. Стало: состояние одной фразой вверху, режим
// дайджеста выбирается из пяти вариантов (текущий с ✓), после нажатия — что именно изменилось.

type SettingsUser = {
  city: string | null; types: string[]; distances: string[]; digest_on: boolean; digest_every_weeks: number;
  digest_last_at: string | null; paused_until: string | null; tz?: string | null;
};

export type DigestMode = "w1" | "w2" | "w4" | "pause" | "off";

export function digestMode(u: SettingsUser, now: Date): DigestMode {
  if (u.paused_until && Date.parse(u.paused_until) > now.getTime()) return "pause";
  if (!u.digest_on) return "off";
  return u.digest_every_weeks === 4 ? "w4" : u.digest_every_weeks === 2 ? "w2" : "w1";
}

const FREQ: Record<number, string> = { 1: "раз в неделю", 2: "раз в 2 недели", 4: "раз в месяц" };
const freqText = (weeks: number) => FREQ[weeks] ?? FREQ[1];

/** «26 октября» из YYYY-MM-DD. */
function dayMonth(iso: string): string {
  const a = d(iso);
  return `${a.getUTCDate()} ${MONTHS_GEN[a.getUTCMonth()]}`;
}

/** Одна фраза: что сейчас включено. Совпадает с базой поле в поле. */
export function settingsState(u: SettingsUser, now: Date): string {
  const mode = digestMode(u, now);
  const digest =
    mode === "off" ? "не присылаю"
    : mode === "pause" ? `на паузе до ${dayMonth(u.paused_until!.slice(0, 10))}${u.digest_on ? `, потом ${freqText(u.digest_every_weeks)}` : ""}`
    : `${freqText(u.digest_every_weeks)}, по понедельникам`;
  return `Дайджест: ${digest}. Город: ${u.city || "не выбран"}. Типы и дистанции: ${filtersLine(u.types, u.distances)}.`;
}

export function settings(u: SettingsUser, now: Date): Msg {
  const mode = digestMode(u, now);
  const opt = (m: DigestMode, label: string): Button[] => [{ text: mode === m ? `✓ ${label}` : label, callback_data: `s:dg:${m}` }];
  return {
    text:
      `<b>Настройки</b>\n\n${esc(settingsState(u, now))}\n\n` +
      "Дайджест: новые забеги в твоём городе, одним сообщением по понедельникам. " +
      "Напоминания о сохранённых забегах приходят всегда, кроме паузы. Ночью (22:00-9:00) не пишу.",
    reply_markup: {
      inline_keyboard: [
        opt("w1", "Присылать раз в неделю"),
        opt("w2", "Раз в 2 недели"),
        opt("w4", "Раз в месяц"),
        opt("pause", mode === "pause" ? `На паузе до ${dayMonth(u.paused_until!.slice(0, 10))}` : "Поставить на паузу на 2 недели"),
        opt("off", "Не присылать дайджест"),
        [{ text: "Сменить город", callback_data: "s:city" }, { text: "Сменить типы и дистанции", callback_data: "s:prefs" }],
        [{ text: "Мои забеги", callback_data: "my" }, { text: "Отписаться от всего", callback_data: "s:unsub" }],
      ],
    },
  };
}

/** Подтверждение после выбора режима: что изменилось и когда ждать следующего. */
export function settingsDone(u: SettingsUser, now: Date, mode: DigestMode, next: string | null, same: boolean): Msg {
  const pre = same ? "Так уже стоит" : "Готово";
  const today = localParts(now, u.tz || "Europe/Moscow").date;
  const when = (iso: string) => (iso === today ? "сегодня" : daysBetween(today, iso) === 1 ? "завтра" : dayMonth(iso));
  if (mode === "off") return { text: `${pre}: дайджест не присылаю. Напоминания о сохранённых забегах остаются.` };
  if (mode === "pause") {
    return {
      text:
        `${pre}: пауза до ${dayMonth(u.paused_until!.slice(0, 10))}. До этого ничего не пришлю: ни дайджест, ни напоминания.` +
        (next ? ` Потом дайджест ${freqText(u.digest_every_weeks)}, первый ${when(next)}.` : ""),
    };
  }
  return { text: `${pre}: дайджест ${freqText(u.digest_every_weeks)}. Следующий придёт ${next ? when(next) : "в ближайший понедельник"}, если появятся новые забеги.` };
}

/** Старые кнопки «Реже»/«Пауза на месяц» в прежних сообщениях: ничего не меняют, показывают новый экран. */
export const SETTINGS_OUTDATED = "Эта кнопка из старой версии настроек. Вот новые: всё видно сразу.";

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

/**
 * Дайджест — два блока, как список: новые «в Твери» и новые «Тверская область и рядом» («Старица, 71 км»).
 * Было (до 12.10.2026): только город.
 */
export function digest(
  city: string,
  races: BotRace[],
  following: Set<string>,
  regUrl: (r: BotRace) => string | null = (r) => r.reg || r.site || null,
  area: { race: BotRace; km: number | null }[] = [],
  subject = "",
): Msg[] {
  const head: Msg = {
    text: `Новые забеги за неделю: ${inCity(city)} ${races.length}${area.length ? `, в области и рядом ${area.length}` : ""}.`,
    reply_markup: { inline_keyboard: [[{ text: `Все забеги ${inCity(city)}`, callback_data: "dlist" }]] },
  };
  const out: Msg[] = [head];
  if (races.length) {
    out.push(...races.slice(0, 5).map((r) => card(r, following.has(r.id), regUrl(r))));
    if (races.length > 5) out.push({ text: `И ещё ${races.length - 5} ${inCity(city)} в календаре.`, reply_markup: { inline_keyboard: [[calendarButton(CALENDAR_LABEL, city)]] } });
  }
  if (area.length) {
    out.push({ text: `<b>${subject ? `${esc(subject)} и рядом` : "Рядом"}</b>, ближайшие первыми:` });
    out.push(...area.slice(0, 3).map(({ race, km }) => card(race, following.has(race.id), regUrl(race), placeLine(race, km))));
    if (area.length > 3) out.push({ text: `И ещё ${area.length - 3} в области и рядом.`, reply_markup: { inline_keyboard: [[{ text: "Все забеги в области и рядом", callback_data: "dlist" }]] } });
  }
  return out;
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

// ── навигация по сезонам: одно живое сообщение (наряд 13.10.2026) ────────────
//
// Развилка «На какой сезон ищешь старт?» → список сезона по 5 (с датой и ожидаемые одним списком)
// → карточка старта в том же сообщении, «← К списку» на ту же страницу. Нижний ряд везде:
// Фильтры, Мои старты, Календарь.

export const SEASON_PAGE = 5;

function dayMon(iso: string): string {
  const a = d(iso);
  return `${a.getUTCDate()} ${MON_SHORT[a.getUTCMonth()]}`;
}

/** Дата карточки: «18 октября 2026, вс»; многодневный — «3-4 октября 2026», «31 октября - 1 ноября 2026». */
export function cardDate(r: { ds: string; de: string }): string {
  const a = d(r.ds);
  const b = d(r.de);
  const y = b.getUTCFullYear();
  if (r.de !== r.ds) {
    return a.getUTCMonth() === b.getUTCMonth()
      ? `${a.getUTCDate()}-${b.getUTCDate()} ${MONTHS_GEN[b.getUTCMonth()]} ${y}`
      : `${a.getUTCDate()} ${MONTHS_GEN[a.getUTCMonth()]} - ${b.getUTCDate()} ${MONTHS_GEN[b.getUTCMonth()]} ${y}`;
  }
  return `${a.getUTCDate()} ${MONTHS_GEN[a.getUTCMonth()]} ${y}, ${WD[a.getUTCDay()]}`;
}

/** Нижний ряд экранов навигации. */
export function navRow(city: string | null): Button[] {
  return [{ text: "Фильтры", callback_data: "flt" }, { text: "Мои старты", callback_data: "my" }, calendarButton("📅 Календарь", city ?? undefined, "list")];
}

/** Развилка: сезоны с ненулевым счётчиком, под каждой кнопкой «N с датой, M ожидаются». */
export function seasonFork(
  city: string,
  rows: { s: Season; dated: number; expected: number }[],
  filters: string | null,
): Msg {
  const shown = rows.filter((r) => r.dated + r.expected > 0);
  const head = `<b>${esc(city)} и рядом.</b> На какой сезон ищешь старт?${filters ? `\nФильтры: ${esc(filters)}.` : ""}`;
  if (!shown.length) {
    return {
      text: `${head}\n\nПока ни одного старта${filters ? " по этим фильтрам" : ""}: ни с датой, ни ожидаемого.`,
      reply_markup: { inline_keyboard: [[{ text: "Снять фильтры", callback_data: "nf" }, { text: "Сменить город", callback_data: "s:city" }], navRow(city)] },
    };
  }
  const lines = shown.map((r) => `${r.s.label}: ${r.dated} с датой, ${r.expected} ${plural(r.expected, "ожидается", "ожидаются", "ожидаются")}`);
  return {
    text: `${head}\n\n${lines.join("\n")}`,
    reply_markup: {
      inline_keyboard: [...shown.map((r) => [{ text: `${r.s.label} · ${r.dated + r.expected}`, callback_data: `sn:${r.s.key}:0` }]), navRow(city)],
    },
  };
}

function itemPlace(x: SeasonItem): string {
  if (x.kind === "race") return x.near ? placeLine(x.race, x.km) : x.race.city || placeLine(x.race, null);
  const place = x.e.city || x.e.subject || "место уточняется";
  return x.km === null ? place : `${place}, ${x.km} км`;
}

/** «дата ожидается, в 2026 было 5 апреля». */
export function expectedNote(e: ExpectedItem): string {
  const a = d(e.lastDate);
  return `дата ожидается, в ${a.getUTCFullYear()} было ${a.getUTCDate()} ${MONTHS_GEN[a.getUTCMonth()]}`;
}

/** Список сезона: 5 на странице; кнопки 1–5 открывают старт, ◀ ▶ листают, «Другой сезон». */
export function seasonList(
  city: string,
  s: Season,
  items: SeasonItem[],
  page: number,
  following: Set<string>,
  hasReg: (r: BotRace) => boolean,
): Msg {
  const pages = Math.max(1, Math.ceil(items.length / SEASON_PAGE));
  const p = Math.min(Math.max(page, 0), pages - 1);
  const slice = items.slice(p * SEASON_PAGE, (p + 1) * SEASON_PAGE);
  const lines: string[] = [];
  slice.forEach((x, i) => {
    const prev = i > 0 ? slice[i - 1] : p > 0 ? items[p * SEASON_PAGE - 1] : null;
    if (x.near && (!prev || !prev.near)) lines.push("<i>Область и рядом:</i>");
    if (x.kind === "race") {
      const star = following.has(x.race.id) ? "⭐ " : "";
      const dist = distPills(x.race).join(" / ");
      lines.push(`${i + 1}. ${star}<b>${shortDate(x.race)}</b> · ${esc(x.race.name)}\n    ${esc(itemPlace(x))}${dist ? ` · ${esc(dist)}` : ""}${hasReg(x.race) ? " · регистрация открыта" : ""}`);
    } else {
      lines.push(`${i + 1}. <b>~${dayMon(x.date)}</b> · ${esc(x.e.name)}\n    ${esc(itemPlace(x))} · ${expectedNote(x.e)}`);
    }
  });
  const from = p * SEASON_PAGE + 1;
  const to = p * SEASON_PAGE + slice.length;
  const nav: Button[] = [];
  if (p > 0) nav.push({ text: "◀", callback_data: `sn:${s.key}:${p - 1}` });
  if (p < pages - 1) nav.push({ text: "▶", callback_data: `sn:${s.key}:${p + 1}` });
  return {
    text: `<b>${esc(city)} и рядом · ${esc(s.label)}</b>\n${from}-${to} из ${items.length}\n\n${lines.join("\n")}`,
    reply_markup: {
      inline_keyboard: [
        slice.map((_, i) => ({ text: String(i + 1), callback_data: `so:${s.key}:${p}:${i}` })),
        ...(nav.length ? [nav] : []),
        [{ text: "Другой сезон", callback_data: "sz" }],
        navRow(city),
      ],
    },
  };
}

/** Карточка старта в том же сообщении. back — «sn:<сезон>:<страница>» или «sz». */
export function raceScreen(
  r: BotRace,
  place: string,
  following: boolean,
  regUrl: string | null,
  siteUrl: string | null,
  back: string,
  consult: boolean,
): Msg {
  const dist = distPills(r).join(" / ");
  const code = raceCode(r.id);
  const tail = back.replace(/^sn:/, "");
  const rows: Button[][] = [
    [following ? { text: "✓ Слежу · убрать", callback_data: `su:${code}:${tail}` } : { text: "⭐ Следить", callback_data: `sf:${code}:${tail}` }],
  ];
  const links: Button[] = [];
  if (regUrl) links.push({ text: "Регистрация", url: regUrl });
  if (siteUrl) links.push({ text: "Сайт", url: siteUrl });
  if (links.length) rows.push(links);
  if (consult) rows.push([{ text: "Бесплатная консультация", callback_data: `consult:${code}` }]);
  rows.push([{ text: "← К списку", callback_data: back }]);
  return {
    text:
      `<b>${esc(r.name)}</b>\n${cardDate(r)}\n📍 ${esc(place)}` +
      `${TYPE_LABEL[r.type] ? `\n${TYPE_LABEL[r.type]}` : ""}${dist ? ` · ${esc(dist)}` : ""}` +
      (following ? "\n\n⭐ Слежу: напомню за 12 недель, за неделю и накануне." : ""),
    reply_markup: { inline_keyboard: rows },
  };
}

/** Карточка ожидаемого: вместо ⭐ «Сообщить, когда объявят». */
export function expectedScreen(e: ExpectedItem, place: string, date: string, watching: boolean, back: string): Msg {
  const code = raceCode(e.id);
  const tail = back.replace(/^sn:/, "");
  const rows: Button[][] = [
    [watching ? { text: "✓ Сообщу, когда объявят", callback_data: "noop" } : { text: "Сообщить, когда объявят", callback_data: `sw:${code}:${tail}` }],
    [{ text: "Прошлый старт", url: e.lastUrl }, ...(e.site ? [{ text: "Организатор", url: e.site }] : [])],
    [{ text: "← К списку", callback_data: back }],
  ];
  return {
    text:
      `<b>${esc(e.name)}</b>\n~${cardDate({ ds: date, de: date })}: ${expectedNote(e)}\n📍 ${esc(place)}` +
      `${e.distances.length ? `\n${esc(e.distances.slice(0, 5).join(" / "))}` : ""}` +
      (watching ? "\n\n✓ Сообщу, как только объявят дату." : ""),
    reply_markup: { inline_keyboard: rows },
  };
}

/** Дайджест одним сообщением: новые в городе и в области, кнопки 1–N открывают старт. */
export function digestScreen(city: string, races: BotRace[], area: { race: BotRace; km: number | null }[], subject: string): Msg {
  const items: { race: BotRace; place: string }[] = [
    ...races.slice(0, 5).map((race) => ({ race, place: race.city })),
    ...area.slice(0, 3).map(({ race, km }) => ({ race, place: placeLine(race, km) })),
  ];
  const lines = items.map((x, i) => `${i + 1}. <b>${shortDate(x.race)}</b> · ${esc(x.race.name)}\n    ${esc(x.place)}`);
  const cityPart = `${inCity(city)} ${races.length}`;
  const areaPart = area.length ? `, ${subject ? `${esc(subject)} и рядом` : "рядом"} ${area.length}` : "";
  return {
    text: `<b>Новые забеги за неделю:</b> ${cityPart}${areaPart}.\n\n${lines.join("\n")}`,
    reply_markup: {
      inline_keyboard: [
        ...[items.slice(0, 4), items.slice(4, 8)].filter((g) => g.length).map((g, gi) => g.map((x, i) => ({ text: String(gi * 4 + i + 1), callback_data: `oc:${raceCode(x.race.id)}` }))),
        [{ text: "Все старты по сезонам", callback_data: "sz" }],
        navRow(city),
      ],
    },
  };
}
