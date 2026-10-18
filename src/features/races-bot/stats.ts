/* Статистика бота «Забеги России»: чистый подсчёт из пользователей, событий и сохранений.
 * Один и тот же расчёт показывают /stats в боте (только тренеру) и раздел «Бот забегов» в
 * админке; его держит npm run check:races-bot.
 *
 * Единица — человек (tg_id), не событие (наряд 12.10.2026). «Новый» = race_bot_users.created_at
 * в периоде; повторные /start, переходы по другим ссылкам и возвраты новыми не считаются никогда.
 * Нажатия /start (сырые) — отдельной строкой. Тренер и фейковые тестовые tg_id не считаются. */

import { parseStart, startSource } from "./core";
import { computeDaily, dailyLines, retentionLines, topLines, type DailyReport } from "./daily";

export type StatPeriod = 7 | 30 | "all";

export type StatUser = {
  tg_id: number;
  first_name: string | null;
  username: string | null;
  city: string | null;
  source: string | null;
  created_at: string;
  blocked: boolean;
};

export type StatEvent = {
  tg_id: number | null;
  event: string;
  race_id: string | null;
  source: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
};

export type StatFollow = { tg_id: number; race_id: string; race_name: string | null; race_city: string | null; created_at: string };

/** pct — от предыдущего шага; null, когда на предыдущем шаге никого (делить не на что, «0%» врал бы). */
export type FunnelStep = { key: string; label: string; people: number; pct: number | null };

export type BotStatsReport = {
  period: StatPeriod;
  /** Люди (уникальные tg_id). newPeriod — новые за выбранный период. */
  people: { newDay: number; newWeek: number; newPeriod: number; newAll: number; active: number; returning: number; startPresses: number };
  /** Пришли снова через другую метку, чем первый приход: люди по метке. */
  returnedVia: { source: string; people: number }[];
  /** Календарь (Mini App): уникальные люди за период и откуда открыли; ветка воронки новых. */
  calendar: { people: number; byFrom: { from: string; people: number }[]; cohort: number; cohortPct: number | null };
  /** Напоминание через 30 минут: сколько ушло за период и сколько из получивших потом что-то нажали. */
  nudge: { sent: number; acted: number };
  /** «Текстовая версия» вместо rich (18.10.2026): люди за период; по кнопке, в настройках, старый клиент. */
  richOff: { people: number; button: number; settings: number; version: number };
  /** Сбои (18.10.2026): меню пришло новым сообщением (почему, на каких экранах) и ошибки Telegram, после которых бот выкрутился. */
  glitches: { resend: number; editFailed: number; oldMessage: number; expired: number; tgErrors: number; top: string[] };
  users: { total: number; new7: number; new30: number; active7: number; blocked: number; unsubscribed: number };
  funnel: FunnelStep[];
  /** Ветка воронки (15.10.2026): из увидевших список — открыли «Всё о старте»; % от увидевших список. */
  details: { people: number; pct: number | null };
  sources: { source: string; users: number; follow: number; consult: number }[];
  clicks: Record<"registration" | "site" | "calendar", { d7: number; d30: number }>;
  topRaces: { name: string; n: number }[];
  topCities: { city: string; n: number }[];
  consults: { name: string; username: string | null; city: string | null; race: string | null; date: string }[];
  newByDay: { day: string; n: number }[];
  /** По дням (7 дней, Москва), топ действий, удержание — наряд 13.10.2026. */
  daily: DailyReport;
  /** За 7 дней: какие старты открывали (карточки) и сохраняли (⭐). */
  topViewed: { name: string; n: number }[];
  topSaved: { name: string; n: number }[];
};

/** Воронка по людям, пришедшим в периоде; процент — от предыдущего шага. */
export const FUNNEL: [string, string][] = [
  ["came", "Пришёл"],
  ["city", "Выбрал город"],
  ["list_shown", "Увидел список"],
  ["follow", "Нажал ⭐"],
  ["click", "Регистрация или сайт"],
  ["consult_click", "Запросил консультацию"],
];

/** Метка прихода из события start: колонка source, иначе разбор параметра (старые записи до 12.10). */
function startLabel(e: StatEvent): string | null {
  if (e.source) return e.source;
  const param = (e.meta as { param?: string | null } | null)?.param ?? null;
  return startSource(parseStart(param));
}

const DAY = 864e5;

function since(now: Date, days: number): number {
  return now.getTime() - days * DAY;
}

function inWindow(iso: string, from: number): boolean {
  return Date.parse(iso) >= from;
}

function top<T extends string>(items: T[], n: number): { key: T; n: number }[] {
  const m = new Map<T, number>();
  for (const x of items) m.set(x, (m.get(x) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru")).slice(0, n).map(([key, c]) => ({ key, n: c }));
}

export function computeBotStats(input: {
  users: StatUser[];
  events: StatEvent[];
  follows: StatFollow[];
  now: Date;
  period: StatPeriod;
  /** tg_id, которых не считать: тренер и фейковые тестовые. */
  exclude?: Set<number>;
}): BotStatsReport {
  const ex = input.exclude ?? new Set<number>();
  const users = input.users.filter((u) => !ex.has(u.tg_id));
  const events = input.events.filter((e) => e.tg_id === null || !ex.has(e.tg_id));
  const follows = input.follows.filter((f) => !ex.has(f.tg_id));
  const { now, period } = input;
  const from = period === "all" ? 0 : since(now, period);
  const d7 = since(now, 7);
  const d30 = since(now, 30);
  const win = events.filter((e) => inWindow(e.created_at, from));

  const peopleWith = (ev: string, list: StatEvent[] = win) => new Set(list.filter((e) => e.event === ev && e.tg_id !== null).map((e) => e.tg_id as number));

  // Первый приход человека: его самое раннее событие start. Источник — users.source, а у
  // записей до 12.10 (source не писался) — метка этого первого start.
  const startsByUser = new Map<number, StatEvent[]>();
  for (const e of [...events].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (e.event !== "start" || e.tg_id === null) continue;
    if (!startsByUser.has(e.tg_id)) startsByUser.set(e.tg_id, []);
    startsByUser.get(e.tg_id)!.push(e);
  }
  const firstSource = (u: StatUser): string => {
    if (u.source) return u.source;
    const first = startsByUser.get(u.tg_id)?.[0];
    return first ? startLabel(first) ?? "direct" : "без метки";
  };

  // Люди.
  const isNew = (u: StatUser) => inWindow(u.created_at, from);
  const cohort = users.filter(isNew);
  const activeIds = new Set(win.filter((e) => e.tg_id !== null).map((e) => e.tg_id as number));
  const created = new Map(users.map((u) => [u.tg_id, Date.parse(u.created_at)]));
  // Вернувшиеся: были раньше периода и что-то сделали в нём. За «всё время» — активны не в день прихода.
  const returning = [...activeIds].filter((id) => {
    const c = created.get(id);
    if (c === undefined) return false;
    if (period !== "all") return c < from;
    return win.some((e) => e.tg_id === id && Date.parse(e.created_at) - c >= DAY);
  });
  const people = {
    newDay: users.filter((u) => inWindow(u.created_at, since(now, 1))).length,
    newWeek: users.filter((u) => inWindow(u.created_at, d7)).length,
    newPeriod: cohort.length,
    newAll: users.length,
    active: [...activeIds].filter((id) => created.has(id)).length,
    returning: returning.length,
    startPresses: win.filter((e) => e.event === "start" && e.tg_id !== null).length,
  };

  // Воронка: люди, пришедшие в периоде; шаги — за всё их время в боте; % от предыдущего шага.
  const did = (ev: string[]) => new Set(events.filter((e) => e.tg_id !== null && ev.includes(e.event)).map((e) => e.tg_id as number));
  const stepSets: Record<string, Set<number>> = {
    came: new Set(cohort.map((u) => u.tg_id)),
    city: new Set([...did(["city_chosen"]), ...users.filter((u) => u.city).map((u) => u.tg_id)]),
    list_shown: did(["list_shown"]),
    follow: new Set([...did(["follow"]), ...follows.map((f) => f.tg_id)]),
    click: did(["click_registration", "click_site"]),
    consult_click: did(["consult_click"]),
  };
  // Ветка, а не шаг цепочки: ⭐ жмут и без выжимки, процент ⭐ от неё был бы неверным.
  const listSeen = cohort.filter((u) => stepSets.list_shown.has(u.tg_id)).length;
  const detailsOpen = did(["details_open"]);
  const detailsPeople = cohort.filter((u) => stepSets.list_shown.has(u.tg_id) && detailsOpen.has(u.tg_id)).length;
  const details = { people: detailsPeople, pct: listSeen ? Math.round((detailsPeople / listSeen) * 100) : null };
  let prev = cohort.length;
  const funnel = FUNNEL.map(([key, label]) => {
    const n = cohort.filter((u) => stepSets[key].has(u.tg_id)).length;
    const pct = key === "came" ? 100 : prev ? Math.round((n / prev) * 100) : null;
    prev = n;
    return { key, label, people: n, pct };
  });

  // Источники по первому приходу: новые за период, сколько дошли до ⭐ и до заявки.
  const followers = stepSets.follow;
  const consulters = stepSets.consult_click;
  const bySource = new Map<string, { users: number; follow: number; consult: number }>();
  for (const u of cohort) {
    const k = firstSource(u);
    const s = bySource.get(k) ?? { users: 0, follow: 0, consult: 0 };
    s.users += 1;
    if (followers.has(u.tg_id)) s.follow += 1;
    if (consulters.has(u.tg_id)) s.consult += 1;
    bySource.set(k, s);
  }

  // «Вернулся через»: start в периоде с меткой, отличной от первого прихода (не сам первый start).
  const via = new Map<string, Set<number>>();
  for (const [id, starts] of startsByUser) {
    const u = users.find((x) => x.tg_id === id);
    if (!u) continue;
    const first = firstSource(u);
    for (const e of starts.slice(1)) {
      if (!inWindow(e.created_at, from)) continue;
      const label = startLabel(e);
      if (!label || label === first) continue;
      if (!via.has(label)) via.set(label, new Set());
      via.get(label)!.add(id);
    }
  }

  const count = (ev: string, fromMs: number) => events.filter((e) => e.event === ev && inWindow(e.created_at, fromMs)).length;
  const active7 = new Set(events.filter((e) => e.tg_id !== null && inWindow(e.created_at, d7)).map((e) => e.tg_id as number));

  const followNames = win
    .filter((e) => e.event === "follow")
    .map((e) => String((e.meta as { race_name?: string } | null)?.race_name || e.race_id || "?"));
  const userById = new Map(users.map((u) => [u.tg_id, u]));
  const consults = events
    .filter((e) => e.event === "consult_click")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 10)
    .map((e) => {
      const u = e.tg_id !== null ? userById.get(e.tg_id) : undefined;
      return {
        name: u?.first_name || "без имени",
        username: u?.username ?? null,
        city: u?.city ?? null,
        race: ((e.meta as { race_name?: string } | null)?.race_name as string | undefined) ?? null,
        date: e.created_at,
      };
    });

  // Новые по дням: за период, но не меньше 30 дней — график с одной точкой бессмыслен.
  const days = period === "all" ? Math.max(30, Math.ceil((now.getTime() - Math.min(...users.map((u) => Date.parse(u.created_at)), now.getTime())) / DAY) + 1) : Math.max(period, 30);
  const newByDay: { day: string; n: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(now.getTime() - i * DAY).toISOString().slice(0, 10);
    newByDay.push({ day, n: users.filter((u) => u.created_at.slice(0, 10) === day).length });
  }

  // Календарь: уникальные люди за период, по месту открытия (метка from в ссылке web_app).
  const opens = win.filter((e) => e.event === "open_calendar" && e.tg_id !== null);
  const byFrom = new Map<string, Set<number>>();
  for (const e of opens) {
    const f = String((e.meta as { from?: unknown } | null)?.from ?? "") || "other";
    if (!byFrom.has(f)) byFrom.set(f, new Set());
    byFrom.get(f)!.add(e.tg_id as number);
  }
  const openedEver = did(["open_calendar"]);
  const cohortOpened = cohort.filter((u) => openedEver.has(u.tg_id)).length;
  const calendar = {
    people: new Set(opens.map((e) => e.tg_id as number)).size,
    byFrom: [...byFrom.entries()].map(([from, ids]) => ({ from, people: ids.size })).sort((a, b) => b.people - a.people),
    cohort: cohortOpened,
    cohortPct: cohort.length ? Math.round((cohortOpened / cohort.length) * 100) : null,
  };
  const nudged = win.filter((e) => e.event === "nudge_sent" && e.tg_id !== null);
  const nudge = {
    sent: nudged.length,
    acted: nudged.filter((n) => events.some((e) => e.tg_id === n.tg_id && e.event !== "start" && e.event !== "nudge_sent" && e.created_at > n.created_at)).length,
  };

  const ro = win.filter((e) => e.event === "rich_off" && e.tg_id !== null);
  const roVia = (v: string) => new Set(ro.filter((e) => (e.meta as { via?: string } | null)?.via === v).map((e) => e.tg_id)).size;
  const richOff = { people: new Set(ro.map((e) => e.tg_id)).size, button: roVia("button"), settings: roVia("settings"), version: roVia("webapp_version") };

  const rs = win.filter((e) => e.event === "menu_resend");
  const te = win.filter((e) => e.event === "tg_error");
  const whyOf = (e: StatEvent) => (e.meta as { why?: string } | null)?.why;
  const keyOf = (e: StatEvent) => String((e.meta as { k?: string | null; method?: string } | null)?.k ?? "?");
  const glitches = {
    resend: rs.length,
    editFailed: rs.filter((e) => whyOf(e) === "edit_failed").length,
    oldMessage: rs.filter((e) => whyOf(e) === "old_message").length,
    expired: rs.filter((e) => whyOf(e) === "expired").length,
    tgErrors: te.length,
    top: top([...rs.filter((e) => whyOf(e) === "edit_failed"), ...te].map(keyOf), 4).map(({ key, n }) => `${key} ${n}`),
  };

  const week = events.filter((e) => inWindow(e.created_at, d7));
  const nameOf = (e: StatEvent) => String((e.meta as { race_name?: unknown } | null)?.race_name ?? e.race_id ?? "?");
  const topViewed = top(week.filter((e) => e.event === "card_open").map(nameOf), 5).map(({ key, n }) => ({ name: key, n }));
  const topSaved = top(week.filter((e) => e.event === "follow").map(nameOf), 5).map(({ key, n }) => ({ name: key, n }));

  return {
    period,
    people,
    daily: computeDaily(users, events, now),
    topViewed,
    topSaved,
    calendar,
    nudge,
    richOff,
    glitches,
    returnedVia: [...via.entries()].map(([source, ids]) => ({ source, people: ids.size })).sort((a, b) => b.people - a.people),
    users: {
      total: users.length,
      new7: users.filter((u) => inWindow(u.created_at, d7)).length,
      new30: users.filter((u) => inWindow(u.created_at, d30)).length,
      active7: active7.size,
      blocked: users.filter((u) => u.blocked).length,
      unsubscribed: peopleWith("unsubscribe").size,
    },
    funnel,
    details,
    sources: [...bySource.entries()].sort((a, b) => b[1].users - a[1].users).map(([source, s]) => ({ source, ...s })),
    clicks: {
      registration: { d7: count("click_registration", d7), d30: count("click_registration", d30) },
      site: { d7: count("click_site", d7), d30: count("click_site", d30) },
      calendar: { d7: count("open_calendar", d7), d30: count("open_calendar", d30) },
    },
    topRaces: top(followNames.length ? followNames : follows.map((f) => f.race_name || f.race_id), 5).map(({ key, n }) => ({ name: key, n })),
    topCities: top(users.map((u) => u.city).filter((c): c is string => !!c), 5).map(({ key, n }) => ({ city: key, n })),
    consults,
    newByDay,
  };
}

const CAL_FROM: Record<string, string> = {
  first: "первое сообщение", list: "под списком", menu: "меню", my: "Мои забеги", reminder: "напоминание", other: "без метки",
};

const PERIOD_LABEL: Record<string, string> = { "7": "7 дней", "30": "30 дней", all: "всё время" };

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function shortDate(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "Europe/Moscow" }).format(new Date(iso));
}

/** Один экран /stats: текст (HTML) и кнопки периода. */
export function statsMessage(s: BotStatsReport): { text: string; reply_markup: { inline_keyboard: { text: string; callback_data: string }[][] } } {
  const p = PERIOD_LABEL[String(s.period)];
  const u = s.users;
  const pp = s.people;
  const lines = [
    `<b>Забеги России · ${p}</b>`,
    "",
    "<b>Люди</b> (уникальные, без тренера и тестовых):",
    `Новые: за день ${pp.newDay}, за неделю ${pp.newWeek}, за всё время ${pp.newAll}`,
    `Новые за период: ${pp.newPeriod}`,
    `Активные за период: ${pp.active}, из них вернувшиеся: ${pp.returning}`,
    `Нажатия /start за период: ${pp.startPresses} (сырые, с повторами)`,
    `Сегодня: нажатий ${s.daily.days.at(-1)?.presses ?? 0}, активных ${s.daily.days.at(-1)?.active ?? 0}, из них вернувшихся ${s.daily.days.at(-1)?.returning ?? 0} (подробно: «По дням»)`,
    `Заблокировали: ${u.blocked}; отписались за период: ${u.unsubscribed}`,
    "",
    `<b>Воронка новых за период</b> (люди, % от предыдущего шага):`,
    ...s.funnel.map((f) => (f.key === "came" || f.pct === null ? `${f.label}: ${f.people}` : `${f.label}: ${f.people} (${f.pct}%)`)),
    `Ветка: увидел список → открыл «Всё о старте»: ${s.details.people}${s.details.pct === null ? "" : ` (${s.details.pct}%)`}`,
    `Ветка: пришёл → открыл календарь: ${s.calendar.cohort}${s.calendar.cohortPct === null ? "" : ` (${s.calendar.cohortPct}%)`}`,
    "",
    `<b>Открыли календарь:</b> ${s.calendar.people} чел.${s.calendar.byFrom.length ? ` (${s.calendar.byFrom.map((x) => `${CAL_FROM[x.from] ?? esc(x.from)} ${x.people}`).join(", ")})` : ""}`,
    `Напоминание через 30 минут: ушло ${s.nudge.sent}, после него что-то нажали ${s.nudge.acted}`,
    `«Текстовая версия» вместо красивого оформления: ${s.richOff.people} чел. (кнопкой ${s.richOff.button}, в настройках ${s.richOff.settings}, старый Telegram ${s.richOff.version})`,
    `Сбои: меню новым сообщением ${s.glitches.resend} (правка не удалась ${s.glitches.editFailed}, нажали в старом ${s.glitches.oldMessage}, старше 48 ч ${s.glitches.expired}), ошибок Telegram ${s.glitches.tgErrors}${s.glitches.top.length ? ` · экраны: ${esc(s.glitches.top.join(", "))}` : ""}`,
    "",
    "<b>Источники по первому приходу</b> (новые / ⭐ / заявка):",
    ...(s.sources.length ? s.sources.map((x) => `${esc(x.source)}: ${x.users} / ${x.follow} / ${x.consult}`) : ["нет"]),
    `<b>Вернулись через:</b> ${s.returnedVia.length ? s.returnedVia.map((x) => `${esc(x.source)} ${x.people}`).join(", ") : "нет"}`,
    "",
    `<b>Клики</b> 7 дн / 30 дн: Регистрация ${s.clicks.registration.d7}/${s.clicks.registration.d30}, Сайт ${s.clicks.site.d7}/${s.clicks.site.d30}, Календарь ${s.clicks.calendar.d7}/${s.clicks.calendar.d30}`,
    `<b>Топ забегов:</b> ${s.topRaces.length ? s.topRaces.map((r) => `${esc(r.name)} (${r.n})`).join("; ") : "нет"}`,
    `<b>Топ городов:</b> ${s.topCities.length ? s.topCities.map((c) => `${esc(c.city)} (${c.n})`).join(", ") : "нет"}`,
    "",
    "<b>Заявки на консультацию</b> (последние 10):",
    ...(s.consults.length
      ? s.consults.map((c) => `${shortDate(c.date)} · ${esc(c.name)}${c.username ? ` @${esc(c.username)}` : ""} · ${esc(c.city || "город ?")} · ${esc(c.race || "забег не указан")}`)
      : ["пока нет"]),
  ];
  const btn = (label: string, v: string) => ({ text: String(s.period) === v ? `• ${label}` : label, callback_data: `st:${v}` });
  return { text: lines.join("\n"), reply_markup: { inline_keyboard: [[btn("7 дней", "7"), btn("30 дней", "30"), btn("Всё время", "all")], [{ text: "По дням", callback_data: "st:days" }]] } };
}

/** Экран «По дням»: таблица за 7 дней, топ действий за сегодня и за неделю, удержание. */
export function dailyMessage(s: BotStatsReport): { text: string; reply_markup: { inline_keyboard: { text: string; callback_data: string }[][] } } {
  const lines = [
    "<b>Забеги России · по дням</b> (Москва, без тренера и тестовых)",
    "нажат — нажатий всего, актив — людей, нов — новых, верн — вернувшихся, наж.в — нажатий от вернувшихся",
    ...dailyLines(s.daily),
    "<b>Что жали сегодня</b> (люди, нажатия):",
    ...topLines(s.daily.topToday),
    "",
    "<b>Что жали за 7 дней:</b>",
    ...topLines(s.daily.topWeek),
    "",
    "<b>Удержание</b> (по дню прихода):",
    ...retentionLines(s.daily),
  ];
  return { text: lines.join("\n"), reply_markup: { inline_keyboard: [[{ text: "← Общая статистика", callback_data: "st:30" }]] } };
}

/** Еженедельный итог тренеру по понедельникам: «По дням» за неделю, воронка, что смотрели и сохраняли. */
export function weeklyMessage(s: BotStatsReport): string {
  return [
    "<b>Забеги России · итог недели</b>",
    ...dailyLines(s.daily),
    "<b>Воронка новых за неделю</b> (люди, % от предыдущего шага):",
    ...s.funnel.map((f) => (f.key === "came" || f.pct === null ? `${f.label}: ${f.people}` : `${f.label}: ${f.people} (${f.pct}%)`)),
    `Ветка: увидел список → открыл «Всё о старте»: ${s.details.people}${s.details.pct === null ? "" : ` (${s.details.pct}%)`}`,
    "",
    `<b>Смотрели</b> (карточки): ${s.topViewed.length ? s.topViewed.map((r) => `${esc(r.name)} (${r.n})`).join("; ") : "нет"}`,
    `<b>Сохраняли</b> (⭐): ${s.topSaved.length ? s.topSaved.map((r) => `${esc(r.name)} (${r.n})`).join("; ") : "нет"}`,
    "",
    "<b>Что жали за неделю:</b>",
    ...topLines(s.daily.topWeek),
  ].join("\n");
}
