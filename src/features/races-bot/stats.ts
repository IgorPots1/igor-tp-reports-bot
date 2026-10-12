/* Статистика бота «Забеги России»: чистый подсчёт из пользователей, событий и сохранений.
 * Один и тот же расчёт показывают /stats в боте (только тренеру) и раздел «Бот забегов» в
 * админке; его держит npm run check:races-bot. */

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

export type FunnelStep = { key: string; label: string; people: number; pct: number };

export type BotStatsReport = {
  period: StatPeriod;
  users: { total: number; new7: number; new30: number; active7: number; blocked: number; unsubscribed: number };
  funnel: FunnelStep[];
  sources: { source: string; users: number; follow: number; consult: number }[];
  clicks: Record<"registration" | "site" | "calendar", { d7: number; d30: number }>;
  topRaces: { name: string; n: number }[];
  topCities: { city: string; n: number }[];
  consults: { name: string; username: string | null; city: string | null; race: string | null; date: string }[];
  newByDay: { day: string; n: number }[];
};

export const FUNNEL: [string, string][] = [
  ["start", "Старт"],
  ["city_chosen", "Выбрал город"],
  ["list_shown", "Увидел список"],
  ["follow", "Нажал «Следить»"],
  ["consult_click", "Нажал «Записаться»"],
];

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
}): BotStatsReport {
  const { users, events, follows, now, period } = input;
  const from = period === "all" ? 0 : since(now, period);
  const d7 = since(now, 7);
  const d30 = since(now, 30);
  const win = events.filter((e) => inWindow(e.created_at, from));

  const peopleWith = (ev: string, list: StatEvent[] = win) => new Set(list.filter((e) => e.event === ev && e.tg_id !== null).map((e) => e.tg_id as number));

  // Воронка: в людях, считая от тех, кто нажал старт в этом периоде.
  const starters = peopleWith("start");
  const funnel = FUNNEL.map(([key, label]) => {
    const did = key === "start" ? starters : new Set([...peopleWith(key)].filter((id) => starters.has(id)));
    return { key, label, people: did.size, pct: starters.size ? Math.round((did.size / starters.size) * 100) : 0 };
  });

  // Источники: кто пришёл в периоде, и сколько из них дошли до «Следить» и до заявки (за всё время).
  const followers = peopleWith("follow", events);
  const consulters = peopleWith("consult_click", events);
  const bySource = new Map<string, { users: number; follow: number; consult: number }>();
  for (const u of users.filter((x) => inWindow(x.created_at, from))) {
    const k = u.source || "без метки";
    const s = bySource.get(k) ?? { users: 0, follow: 0, consult: 0 };
    s.users += 1;
    if (followers.has(u.tg_id)) s.follow += 1;
    if (consulters.has(u.tg_id)) s.consult += 1;
    bySource.set(k, s);
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

  return {
    period,
    users: {
      total: users.length,
      new7: users.filter((u) => inWindow(u.created_at, d7)).length,
      new30: users.filter((u) => inWindow(u.created_at, d30)).length,
      active7: active7.size,
      blocked: users.filter((u) => u.blocked).length,
      unsubscribed: peopleWith("unsubscribe").size,
    },
    funnel,
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
  const lines = [
    `<b>Забеги России · ${p}</b>`,
    "",
    `<b>Пользователи:</b> ${u.total}, новые 7 дн ${u.new7}, 30 дн ${u.new30}; активные 7 дн ${u.active7}; заблокировали ${u.blocked}; отписались ${u.unsubscribed}`,
    "",
    `<b>Воронка (${p}):</b>`,
    ...s.funnel.map((f) => `${f.label}: ${f.people} (${f.pct}%)`),
    "",
    "<b>Источники</b> (пришли / «Следить» / заявка):",
    ...(s.sources.length ? s.sources.map((x) => `${esc(x.source)}: ${x.users} / ${x.follow} / ${x.consult}`) : ["нет"]),
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
  return { text: lines.join("\n"), reply_markup: { inline_keyboard: [[btn("7 дней", "7"), btn("30 дней", "30"), btn("Всё время", "all")]] } };
}
