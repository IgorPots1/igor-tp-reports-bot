/* Rich-сообщения бота (Bot API 10.1+, наряд 18.10.2026): список стартов таблицей и карточка старта
 * блоками Details. Это только разметка InputRichMessage — какой вариант уходит человеку (rich или
 * обычный HTML), решает bot.ts (флаг rich_for в race_bot_config и rich_off у пользователя).
 * Ограничения Telegram: до 32 768 знаков, до 500 блоков (строка таблицы — блок), до 20 колонок;
 * у ячейки таблицы align и valign обязательны. */

import { distPills, MONTHS_GEN } from "@/app/races/races-logic";
import type { FullDetails } from "@/features/race-details/full";

import type { BotRace, ExpectedItem } from "./core";

/** Минимальная версия Bot API в приложении (WebApp.version), с которой есть rich-сообщения. */
export const RICH_MIN_VERSION = "10.1";

/** «10.0» < «10.1» < «10.12»: сравнение версий по числам. */
export function versionBelow(v: string, min = RICH_MIN_VERSION): boolean {
  const a = v.split(".").map((x) => Number(x) || 0);
  const b = min.split(".").map((x) => Number(x) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  }
  return false;
}

type RichText = string | { type: string; [k: string]: unknown } | RichText[];
export type RichBlock = { type: string; [k: string]: unknown };
export type RichMessage = { blocks: RichBlock[] };

/** Массив частей без пустых: «""» внутри RichText Telegram может не принять. Одна часть — сама часть. */
export function parts(...xs: (RichText | false | null | undefined)[]): RichText {
  const ok = xs.filter((x): x is RichText => x !== "" && x !== false && x !== null && x !== undefined);
  return ok.length === 1 ? ok[0] : ok;
}
const bold = (text: RichText): RichText => ({ type: "bold", text });
const italic = (text: RichText): RichText => ({ type: "italic", text });
const link = (text: RichText, url: string): RichText => ({ type: "url", text, url });
const cell = (text: RichText, opt: Record<string, unknown> = {}) => ({ text, align: "left", valign: "top", ...opt });
const head = (text: string, opt: Record<string, unknown> = {}) => cell(bold(text), { is_header: true, ...opt });

const MON = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const WD = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
/** «1 ноя, вс» или «5–6 дек». */
export function tableDate(ds: string, de = ds): string {
  const a = new Date(`${ds}T00:00:00Z`);
  const b = new Date(`${de}T00:00:00Z`);
  if (de !== ds) {
    return a.getUTCMonth() === b.getUTCMonth()
      ? `${a.getUTCDate()}–${b.getUTCDate()} ${MON[b.getUTCMonth()]}`
      : `${a.getUTCDate()} ${MON[a.getUTCMonth()]} – ${b.getUTCDate()} ${MON[b.getUTCMonth()]}`;
  }
  return `${a.getUTCDate()} ${MON[a.getUTCMonth()]}, ${WD[a.getUTCDay()]}`;
}

/** Строка списка: старт с датой или ожидаемый (дата с «~» и пометкой «дата не объявлена»). */
export type ListRow =
  | { n: number; kind: "race"; race: BotRace; star: boolean; place: string; regOpen: boolean }
  | { n: number; kind: "exp"; e: ExpectedItem; date: string; place: string };

function rowCells(x: ListRow, withPlace: boolean) {
  const n = cell(String(x.n), { align: "right" });
  if (x.kind === "race") {
    const km = distPills(x.race).join(" / ");
    const name = parts(x.star && "⭐ ", shortName(x.race.name), x.regOpen && italic(" · регистрация открыта"));
    return [n, cell(tableDate(x.race.ds, x.race.de)), cell(name), ...(withPlace ? [cell(x.place)] : []), cell(km || "—")];
  }
  const km = x.e.distances.slice(0, 4).join(" / ");
  const d = new Date(`${x.date}T00:00:00Z`);
  return [
    n,
    cell(`~${d.getUTCDate()} ${MON[d.getUTCMonth()]}`),
    cell(parts(shortName(x.e.name), italic(" · дата не объявлена"))),
    ...(withPlace ? [cell(x.place)] : []),
    cell(km || "—"),
  ];
}

function table(rows: ListRow[], withPlace: boolean): RichBlock {
  return {
    type: "table",
    is_compact: true,
    is_striped: true,
    cells: [
      [head("№", { align: "right" }), head("дата"), head("старт"), ...(withPlace ? [head("где")] : []), head("км")],
      ...rows.map((x) => rowCells(x, withPlace)),
    ],
  };
}

/** Список сезона: «Забеги в Перми», таблица «№ · дата · старт · км», блок «Область и рядом» с колонкой
 *  «где» (город и км от города), подвал с периодом. Кнопки — у вызывающего (они те же, что у текста). */
export function listRich(title: string, own: ListRow[], near: ListRow[], footer: string): RichMessage {
  const blocks: RichBlock[] = [{ type: "heading", size: 2, text: title }];
  if (own.length) blocks.push(table(own, false));
  if (near.length) {
    blocks.push({ type: "heading", size: 4, text: "Область и рядом" });
    blocks.push(table(near, true));
  }
  blocks.push({ type: "footer", text: footer });
  return { blocks };
}

/** Карточка старта: заголовок, дата и место, «Важное», «Всё о старте» блоками Details (пустые разделы
 *  fullDetails уже не отдаёт), источник и сайт в подвале. */
export function cardRich(a: {
  race: BotRace;
  dateLine: string;
  place: string;
  important: string | null;
  details: FullDetails | null;
  siteUrl: string | null;
  following: boolean;
  hasCourse: boolean;
}): RichMessage {
  const r = a.race;
  const dist = distPills(r).join(" / ");
  const blocks: RichBlock[] = [
    { type: "heading", size: 2, text: r.name },
    { type: "paragraph", text: parts(bold(a.dateLine), ` · ${a.place}`, dist && ` · ${dist}`) },
  ];
  if (a.important) blocks.push({ type: "paragraph", text: parts(bold("Важное:"), a.important.replace(/^Важное:/, "")) });
  const secs = a.details?.sections ?? [];
  if (secs.length) {
    blocks.push({ type: "heading", size: 4, text: "Всё о старте" });
    for (const s of secs) {
      const inner: RichBlock[] = [];
      if (s.times?.length) {
        inner.push({ type: "table", is_compact: true, cells: s.times.map((t) => [cell(t.label), cell(t.time, { align: "right" })]) });
      }
      for (const l of s.lines) inner.push({ type: "paragraph", text: l });
      if (s.key === "track" && !s.lines.length && a.hasCourse) inner.push({ type: "paragraph", text: "Есть разбор трассы: кнопка ниже." });
      if (inner.length) blocks.push({ type: "details", summary: bold(s.title), blocks: inner });
    }
  }
  if (a.following) blocks.push({ type: "paragraph", text: italic("⭐ Слежу: напомню за 12 недель, за неделю и накануне.") });
  const foot: RichText[] = [];
  if (a.details?.source) {
    const c = a.details.source.checked;
    foot.push(link("Источник: сайт организатора", a.details.source.url), `, проверено ${c.slice(8, 10)}.${c.slice(5, 7)}`);
  }
  if (a.siteUrl) foot.push(...(foot.length ? [" · "] : []), link("Сайт старта", a.siteUrl));
  if (foot.length) blocks.push({ type: "footer", text: parts(...foot) });
  return { blocks };
}

/** «с 1 сентября по 30 ноября». */
export function periodText(from: string, to: string): string {
  const f = new Date(`${from}T00:00:00Z`);
  const t = new Date(`${to}T00:00:00Z`);
  return `с ${f.getUTCDate()} ${MONTHS_GEN[f.getUTCMonth()]} по ${t.getUTCDate()} ${MONTHS_GEN[t.getUTCMonth()]}`;
}

/** Длинное название в списках и на главном экране — до 45 знаков с «…» (18.10.2026); полное — только в карточке. */
export const NAME_MAX = 45;
export function shortName(name: string, max = NAME_MAX): string {
  if (name.length <= max) return name;
  const cut = name.slice(0, max - 1);
  // по границе слова, если она недалеко (не обрываем «края п…»)
  const sp = cut.lastIndexOf(" ");
  return `${(sp >= max - 16 ? cut.slice(0, sp) : cut).replace(/[\s,.:;—–-]+$/, "")}…`;
}

/** Главный экран (18.10.2026): «С возвращением!», «Город: Тверь», «Фильтры: шоссе, трейл», ближайший
 *  сохранённый старт отдельной строкой с датой. notice — строка сверху («✓ Сохранил …» после ссылки). */
export function menuRich(a: { head: string; notice: string | null; city: string | null; filters: string; next: { race: BotRace; left: string } | null; savedTotal: number }): RichMessage {
  const blocks: RichBlock[] = [];
  if (a.notice) blocks.push({ type: "paragraph", text: bold(a.notice) });
  blocks.push({ type: "heading", size: 2, text: a.head });
  blocks.push({ type: "paragraph", text: parts("Город: ", bold(a.city || "не выбран")) });
  blocks.push({ type: "paragraph", text: `Фильтры: ${a.filters}` });
  blocks.push({
    type: "paragraph",
    text: a.next
      ? parts("Ближайший: ", bold(tableDate(a.next.race.ds, a.next.race.de)), ` · ${shortName(a.next.race.name)} (${a.next.left})`, a.savedTotal > 1 && italic(` · всего сохранено ${a.savedTotal}`))
      : "Сохранённых забегов пока нет: открой старт и нажми ⭐.",
  });
  return { blocks };
}

/** Мои забеги (18.10.2026): таблица «№ · дата · старт · город · до старта»; номер открывает карточку. */
export type MyRow = { n: number; name: string; city: string; ds: string | null; de: string | null; left: string; cancelled: boolean };
export function myRich(rows: MyRow[], title: string): RichMessage {
  return {
    blocks: [
      { type: "heading", size: 2, text: title },
      {
        type: "table",
        is_compact: true,
        is_striped: true,
        cells: [
          [head("№", { align: "right" }), head("дата"), head("старт"), head("город"), head("до старта", { align: "right" })],
          ...rows.map((r) => [
            cell(String(r.n), { align: "right" }),
            cell(r.ds ? tableDate(r.ds, r.de ?? r.ds) : "—"),
            cell(r.cancelled ? parts(shortName(r.name), italic(" · отменён")) : shortName(r.name)),
            cell(r.city || "—"),
            cell(r.cancelled ? "—" : r.left, { align: "right" }),
          ]),
        ],
      },
      { type: "footer", text: "Номер открывает карточку старта: там «Убрать» и сайт." },
    ],
  };
}
