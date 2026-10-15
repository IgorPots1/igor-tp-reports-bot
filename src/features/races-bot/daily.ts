/* Статистика бота по дням (наряд 13.10.2026): ежедневная активность, а не только новые.
 *
 * Единица — человек (tg_id) и нажатие. Дни — по московскому времени (UTC+3, без перевода часов).
 * «Новый в день X» — race_bot_users.created_at в этот день. «Вернувшийся в день X» — пришёл раньше
 * этого дня и что-то нажал в этот день. Тренер и тестовые id отсекаются до этого модуля (exclude).
 *
 * Нажатие — то, что человек сделал сам: кнопка (tap), /start, ссылка «Регистрация»/«Сайт» (/go),
 * открытие календаря и действия в нём (miniapp). Системные события (дайджест ушёл, напоминание,
 * консультацию предложили, заблокировал) нажатиями не считаются. */

import type { StatEvent, StatUser } from "./stats";

/** События-нажатия. follow/search/city_chosen — следствия нажатий (tap), второй раз не считаем. */
export const PRESS_EVENTS = new Set(["tap", "start", "open_calendar", "click_registration", "click_site", "miniapp"]);

/** День по Москве: YYYY-MM-DD. */
export function mskDay(iso: string): string {
  return new Date(Date.parse(iso) + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
}

export type DayRow = { day: string; presses: number; active: number; fresh: number; returning: number; returningPresses: number };

/** Категории для «топа действий»: что жали. */
export function actionCategory(e: StatEvent): string | null {
  const k = String((e.meta as { k?: unknown } | null)?.k ?? "");
  const a = String((e.meta as { a?: unknown } | null)?.a ?? "");
  switch (e.event) {
    case "click_registration":
      return "Регистрация";
    case "click_site":
      return "Сайт";
    case "open_calendar":
      return "Календарь";
    case "miniapp":
      return a === "follow" ? "⭐ Следить" : a === "reg" ? "Регистрация" : a === "site" ? "Сайт" : "Календарь";
    case "start":
      return "/start";
    case "tap":
      if (["sz", "sn", "show", "dlist"].includes(k)) return "Сезоны";
      if (["so", "oc"].includes(k)) return "Карточки";
      if (["tc", "tv", "tb"].includes(k)) return "Разбор трассы";
      if (k === "ds") return "Всё о старте";
      if (["f", "sf"].includes(k)) return "⭐ Следить";
      if (k === "consult") return "Консультация";
      if (["city", "cityg", "pick", "city_other", "geo", "restart"].includes(k)) return "Город";
      if (["t", "d", "flt", "nf"].includes(k)) return "Фильтры";
      if (["my", "myp", "u", "su"].includes(k)) return "Мои старты";
      if (k === "text") return "Текст";
      if (k === "s" || k === "dg" || k === "menu") return "Настройки и меню";
      return "Прочее";
    default:
      return null;
  }
}

export type ActionRow = { action: string; people: number; presses: number };

export function topActions(events: StatEvent[]): ActionRow[] {
  const by = new Map<string, { people: Set<number>; presses: number }>();
  for (const e of events) {
    if (e.tg_id === null) continue;
    const c = actionCategory(e);
    if (!c) continue;
    const x = by.get(c) ?? { people: new Set<number>(), presses: 0 };
    x.people.add(e.tg_id);
    x.presses += 1;
    by.set(c, x);
  }
  return [...by.entries()]
    .map(([action, x]) => ({ action, people: x.people.size, presses: x.presses }))
    .sort((a, b) => b.people - a.people || b.presses - a.presses || a.action.localeCompare(b.action, "ru"));
}

export type DailyReport = {
  days: DayRow[];
  /** Итог за 7 дней: нажатия, уникальные активные, новые, вернувшиеся (уникальные), нажатия вернувшихся. */
  week: Omit<DayRow, "day">;
  /** За всё время: вернувшийся — был активен в день после дня прихода. */
  all: Omit<DayRow, "day">;
  /** Топ действий за сегодня и за 7 дней. */
  topToday: ActionRow[];
  topWeek: ActionRow[];
  /** Удержание: по дате прихода — сколько пришло и сколько из них вернулись в следующие 7 дней. */
  retention: { day: string; arrived: number; returned: number }[];
};

/**
 * Активность по дням. users и events уже без тренера и тестовых. today — день «сейчас» по Москве.
 */
export function computeDaily(users: StatUser[], events: StatEvent[], now: Date, days = 7): DailyReport {
  const today = mskDay(now.toISOString());
  const arrived = new Map(users.map((u) => [u.tg_id, mskDay(u.created_at)]));
  const presses = events.filter((e) => e.tg_id !== null && PRESS_EVENTS.has(e.event) && arrived.has(e.tg_id));
  const dayOf = new Map<StatEvent, string>(presses.map((e) => [e, mskDay(e.created_at)]));

  const row = (from: string, to: string): Omit<DayRow, "day"> => {
    const xs = presses.filter((e) => dayOf.get(e)! >= from && dayOf.get(e)! <= to);
    const active = new Set(xs.map((e) => e.tg_id as number));
    // вернувшийся в окне: пришёл раньше дня нажатия
    const ret = xs.filter((e) => arrived.get(e.tg_id as number)! < dayOf.get(e)!);
    return {
      presses: xs.length,
      active: active.size,
      fresh: users.filter((u) => arrived.get(u.tg_id)! >= from && arrived.get(u.tg_id)! <= to).length,
      returning: new Set(ret.map((e) => e.tg_id as number)).size,
      returningPresses: ret.length,
    };
  };

  const list: DayRow[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(today, -i);
    list.push({ day: d, ...row(d, d) });
  }
  const weekFrom = addDays(today, -(days - 1));
  const first = [...arrived.values()].sort()[0] ?? today;

  const inDay = (d: string) => presses.filter((e) => dayOf.get(e) === d);
  const inWeek = presses.filter((e) => dayOf.get(e)! >= weekFrom);

  // Удержание: пришедшие в день X, нажавшие что-то в X+1..X+7.
  const retention: DailyReport["retention"] = [];
  const arrivalDays = [...new Set(arrived.values())].sort();
  for (const d of arrivalDays.slice(-14)) {
    const cohort = users.filter((u) => arrived.get(u.tg_id) === d).map((u) => u.tg_id);
    const back = cohort.filter((id) => presses.some((e) => e.tg_id === id && dayOf.get(e)! > d && dayOf.get(e)! <= addDays(d, 7)));
    retention.push({ day: d, arrived: cohort.length, returned: back.length });
  }

  return {
    days: list,
    week: row(weekFrom, today),
    all: row(first, today),
    topToday: topActions(inDay(today)),
    topWeek: topActions(inWeek),
    retention,
  };
}

const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const MON = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
function dayLabel(d: string): string {
  const a = new Date(`${d}T00:00:00Z`);
  return `${WD[a.getUTCDay()]} ${a.getUTCDate()} ${MON[a.getUTCMonth()]}`;
}

/** Строки блока «По дням» (HTML для Telegram, моноширинной таблицей). */
export function dailyLines(r: DailyReport): string[] {
  const pad = (s: string | number, n: number) => String(s).padStart(n);
  const head = `${"день".padEnd(9)} ${pad("нажат", 5)} ${pad("актив", 5)} ${pad("нов", 3)} ${pad("верн", 4)} ${pad("наж.в", 5)}`;
  const line = (label: string, x: Omit<DayRow, "day">) =>
    `${label.padEnd(9)} ${pad(x.presses, 5)} ${pad(x.active, 5)} ${pad(x.fresh, 3)} ${pad(x.returning, 4)} ${pad(x.returningPresses, 5)}`;
  return [
    "<pre>",
    head,
    ...r.days.map((d) => line(dayLabel(d.day), d)),
    line("7 дней", r.week),
    line("всё", r.all),
    "</pre>",
  ];
}

/** Топ действий строками: «Сезоны: 5 чел., 23 нажатия». */
export function topLines(rows: ActionRow[], n = 8): string[] {
  return rows.length ? rows.slice(0, n).map((x) => `${x.action}: ${x.people} чел., ${x.presses} наж.`) : ["нет"];
}

export function retentionLines(r: DailyReport): string[] {
  return r.retention.length
    ? r.retention.map((x) => `${dayLabel(x.day)}: пришли ${x.arrived}, вернулись за 7 дней ${x.returned}${x.arrived ? ` (${Math.round((x.returned / x.arrived) * 100)}%)` : ""}`)
    : ["нет"];
}
