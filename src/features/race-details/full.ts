/* «Всё о старте» (вариант Б, наряд 15.10.2026): полная выжимка race_details по разделам. Один
 * построитель для бота (экран «Всё о старте») и сайта (блок «Что важно знать» на /races/<id>), чтобы
 * они не разошлись. Разделы по порядку, пустые не показываются, «нет данных» нигде не выводится:
 *   Старт — время по дистанциям столбиком, детские одной строкой ниже;
 *   Где — место старта, финиш, если отличается;
 *   Номера — выдача;
 *   Лимиты — по дистанциям и закрытие трассы;
 *   Трасса — что известно (кнопка «Разбор трассы» — у вызывающего, если разбор есть);
 *   На месте — питание, раздевалки, камера хранения;
 *   Регистрация — статус с датой проверки, ближайшее повышение цены.
 * Внизу источник (самая частая ссылка) и дата проверки. Чистые функции, их стережёт check:race-details. */

import { MONTHS_GEN } from "@/app/races/races-logic";
import type { DetailRow } from "./important";

export type FullRow = DetailRow & { source_url?: string | null };

export type SectionKey = "start" | "where" | "pickup" | "cutoff" | "track" | "onsite" | "registration";
export type Section = {
  key: SectionKey;
  title: string;
  /** Строки текста раздела (уже готовые предложения). */
  lines: string[];
  /** Только у «Старт»: время по дистанциям столбиком. */
  times?: { label: string; time: string }[];
};
export type FullDetails = { sections: Section[]; source: { url: string; checked: string } | null };

/** Кнопка «Всё о старте» — только если данных хотя бы по стольким полям. */
export const MIN_FIELDS = 3;

const NO_DATA = /^нет данных/i;
const real = (rows: FullRow[]) => rows.filter((r) => r.value?.trim() && !NO_DATA.test(r.value.trim()));
const of = (rows: FullRow[], field: string) => real(rows).filter((r) => r.field === field);

/** Сколько разных полей заполнено (без «нет данных»): от MIN_FIELDS — кнопка «Всё о старте». */
export function fieldCount(rows: FullRow[]): number {
  return new Set(real(rows).map((r) => r.field)).size;
}

/** «42,2 км», «21,1 км», «3,5 км»; некруглое короче 5 км — в метрах: 2.027 → «2027 м». */
export function distLabel(d: number): string {
  if (d < 5 && Math.abs(d * 10 - Math.round(d * 10)) > 1e-6) return `${Math.round(d * 1000)} м`;
  return `${String(Math.round(d * 10) / 10).replace(".", ",")} км`;
}

/** Убрать наши пометки и координаты: «(видимо, опечатка…)», «(44.169284, 43.118247)»; « — » → «: ». */
export function clean(v: string): string {
  return v
    .replace(/\s*\([^)]*(видимо|вероятно|опечатк|не указан[оаы]? на russiarunning)[^)]*\)/gi, "")
    .replace(/\s*\(\s*-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}\s*\)/g, "")
    .replace(/\s+[—–]\s+/g, ": ")
    .replace(/\s+/g, " ")
    .trim();
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Текст организатора как предложения: «;» — граница, каждое с заглавной, точка в конце. */
export function sentences(v: string): string {
  return clean(v)
    .split(/;\s*/)
    .map((x) => cap(x.trim().replace(/[.,:]+$/, "")))
    .filter(Boolean)
    .join(". ") + ".";
}

const TIME = /\b([01]?\d|2[0-3]):[0-5]\d\b/;
const isKids = (r: FullRow) => (r.distance != null && r.distance < 2) || /детск/i.test(r.value);

function startSection(rows: FullRow[], raceDate: string): Section | null {
  const own = of(rows, "start_time");
  if (!own.length) return null;
  const adult = own.filter((r) => r.distance != null && !isKids(r));
  // День старта — по взрослым дистанциям, если у всех одна дата «06.12» (у фестиваля первым днём бывают
  // детские: «Бегущая Вологда» 5–6 декабря, основной старт 6-го); иначе — дата старта в календаре.
  const days = new Set(adult.map((r) => r.value.match(/\b(\d{2})\.(\d{2})\b/)?.[0]).filter(Boolean));
  const y = Number(raceDate.slice(0, 4));
  const own1 = days.size === 1 ? [...days][0]!.split(".").map(Number) : null;
  const d = own1 ? new Date(Date.UTC(y, own1[1] - 1, own1[0])) : new Date(`${raceDate}T00:00:00Z`);
  const title = `Старт ${d.getUTCDate()} ${MONTHS_GEN[d.getUTCMonth()]}`;
  const kids = own.filter((r) => isKids(r) && r.distance != null);
  const whole = own.filter((r) => r.distance == null);
  const lines: string[] = [];
  let times: Section["times"];
  if (adult.length) {
    // время — из основной части (без скобок): «12:00 (ZT12, проверка снаряжения 11:45)» → 12:00
    times = adult
      .map((r) => {
        const t = r.value.replace(/\([^)]*\)/g, "").match(TIME)?.[0] ?? null;
        return { km: r.distance!, label: distLabel(r.distance!), time: t ?? "время уточняется" };
      })
      // по времени старта, при одном времени — длинная дистанция выше
      .sort((a, b) => toMin(a.time) - toMin(b.time) || b.km - a.km)
      .map(({ label, time }) => ({ label, time }));
  } else if (whole.length) {
    lines.push(sentences(whole[0].value));
  }
  if (kids.length) lines.push(`Детские: ${sentences(kids.map((r) => r.value).join("; "))}`);
  return { key: "start", title, lines, times };
}

const toMin = (t: string) => {
  const m = t.match(TIME);
  if (!m) return 24 * 60;
  const [h, mm] = m[0].split(":").map(Number);
  return h * 60 + mm;
};

function whereSection(rows: FullRow[]): Section | null {
  const start = of(rows, "start_place")[0]?.value;
  const finish = of(rows, "finish_place")[0]?.value;
  const lines: string[] = [];
  if (start) lines.push(sentences(start));
  if (finish) {
    const f = clean(finish).split(/;\s*/)[0].trim();
    if (/^там же/i.test(f)) lines.push("Финиш там же.");
    else lines.push(`Финиш: ${f.replace(/[.,]+$/, "")}.`);
  }
  return lines.length ? { key: "where", title: "Где", lines } : null;
}

function simple(rows: FullRow[], field: string, key: SectionKey, title: string): Section | null {
  const v = of(rows, field)[0]?.value;
  return v ? { key, title, lines: [sentences(v)] } : null;
}

function cutoffSection(rows: FullRow[]): Section | null {
  const own = of(rows, "cutoff");
  if (!own.length) return null;
  const DIST_PART = /^\d[\d,.]*\s*(км|м)(?=\s|$)/i;
  const dist: string[] = [];
  const other: string[] = [];
  for (const r of own.filter((x) => x.distance == null)) {
    for (const part of clean(r.value).split(/;\s*/)) {
      const p = part.trim().replace(/[.,]+$/, "").replace(/^(\d[\d,.]*\s*(?:км|м)):\s*/i, "$1 ");
      if (DIST_PART.test(p)) dist.push(p);
      else if (p) other.push(cap(p));
    }
  }
  if (!dist.length) {
    // по дистанциям: взрослые «12 км 4 ч», у детских берём только закрытие трассы
    for (const r of own.filter((x) => x.distance != null).sort((a, b) => b.distance! - a.distance!)) {
      const parts = clean(r.value).split(/;\s*/);
      if (!isKids(r)) dist.push(`${distLabel(r.distance!)} ${parts[0].replace(/\s*\([^)]*\)/g, "").trim()}`);
      for (const p of parts.slice(isKids(r) ? 0 : 1)) if (/закрыт/i.test(p)) other.push(cap(p.trim()));
    }
  }
  const lines = [dist.length ? `${dist.join(", ")}.` : "", ...[...new Set(other)].map((x) => `${x.replace(/[.,]+$/, "")}.`)].filter(Boolean);
  return lines.length ? { key: "cutoff", title: "Лимиты", lines } : null;
}

function onsiteSection(rows: FullRow[]): Section | null {
  const lines: string[] = [];
  const add = (field: string, kw: RegExp, label: string) => {
    const v = of(rows, field)[0]?.value;
    if (!v) return;
    const s = sentences(v);
    // подпись нужна, если текст сам не начинается с неё: «10 км: 4 и 7 км…» → «Питание: 10 км: …»
    lines.push(kw.test(v.trim().slice(0, 24)) ? s : `${label}: ${s[0].toLowerCase()}${s.slice(1)}`);
  };
  add("aid_stations", /питан|пункт|вод[аыу]|чай/i, "Питание");
  add("changing_rooms", /раздевал/i, "Раздевалки");
  add("baggage", /камер|хранен/i, "Камера хранения");
  return lines.length ? { key: "onsite", title: "На месте", lines } : null;
}

const ddmm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

function registrationSection(rows: FullRow[]): Section | null {
  const st = of(rows, "registration_status")[0];
  const price = of(rows, "next_price_increase")[0]?.value;
  const lines: string[] = [];
  // Статус меняется — всегда с датой проверки; без даты не показываем (как в строке «Важное»).
  if (st?.checked_at) lines.push(`${sentences(st.value).replace(/\.$/, "")} (на ${ddmm(st.checked_at)}).`);
  if (price) lines.push(`Повышение цены: ${clean(price).replace(/[.;]+$/, "")}.`);
  return lines.length ? { key: "registration", title: "Регистрация", lines } : null;
}

/** Самая частая ссылка источника и самая поздняя дата проверки. */
function sourceOf(rows: FullRow[]): FullDetails["source"] {
  const r = real(rows);
  const counts = new Map<string, number>();
  for (const x of r) if (x.source_url) counts.set(x.source_url, (counts.get(x.source_url) ?? 0) + 1);
  const url = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const checked = r.map((x) => x.checked_at ?? "").filter(Boolean).sort().at(-1);
  return url && checked ? { url, checked } : null;
}

/** Разделы «Всё о старте» по порядку; hasCourse — у старта есть разбор трассы (раздел «Трасса» есть и без текста). */
export function fullDetails(rows: FullRow[], raceDate: string, hasCourse = false): FullDetails {
  const track = simple(rows, "track", "track", "Трасса") ?? (hasCourse ? { key: "track" as const, title: "Трасса", lines: [] } : null);
  const sections = [
    startSection(rows, raceDate),
    whereSection(rows),
    simple(rows, "packet_pickup", "pickup", "Номера"),
    cutoffSection(rows),
    track,
    onsiteSection(rows),
    registrationSection(rows),
  ].filter((s): s is Section => !!s && (s.lines.length > 0 || !!s.times?.length || s.key === "track"));
  return { sections, source: sourceOf(rows) };
}

/** «Источник: сайт организатора, проверено 15.10». */
export function sourceText(src: NonNullable<FullDetails["source"]>): string {
  return `Источник: сайт организатора, проверено ${ddmm(src.checked)}`;
}
