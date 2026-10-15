/* Блок «Важное» в карточке старта (бот и сайт, наряд 15.10.2026): одна короткая строка из выжимки
 * race_details, как «Важное: старт 9:00, волны по 15 минут, номера сб 12:00–20:00, лимит 3 ч».
 *   — старт: одно время или промежуток «9:30–11:00 по дистанциям»;
 *   — волны: короткая фраза организатора или «старт волнами»;
 *   — номера: когда и где, коротко;
 *   — лимит: только самой длинной дистанции и только если это длительность («4,5 ч», «2:30»);
 *   — регистрация: только «регистрация закрыта» / «мест нет», и всегда с датой проверки: «мест нет (на 15.10)».
 *     Статус регистрации меняется, а еженедельного обновления этих полей пока нет (условие Игоря 15.10.2026):
 *     без даты он выглядел бы как сегодняшний факт. Нет даты проверки — статус не показываем вовсе.
 * Пояснения после « — », скобки и хвосты после «;» отбрасываются; длинное тире в строку не попадает.
 * Строка длиннее MAX_LINE — части отбрасываются с конца. Чистая функция, её стережёт check:race-details. */

export type DetailRow = { distance: number | null; field: string; value: string; checked_at?: string | null };

const NO_DATA = /^нет данных/i;
const MAX_PART = 48;
export const MAX_LINE = 140;

/** Значение коротко: до « — », без скобок, до первого «;», не длиннее max. */
export function shortValue(v: string, max = MAX_PART): string {
  let s = v.split(/\s+[—–]\s+/)[0].replace(/\s*\([^)]*\)/g, "").split(/;\s*/)[0].replace(/\s+/g, " ").trim();
  if (s.length > max) {
    // режем по последней запятой до лимита (адрес, название), иначе по слову
    const cut = s.slice(0, max);
    const comma = cut.lastIndexOf(", ");
    s = comma > max / 2 ? cut.slice(0, comma) : `${cut.replace(/[\s,.:–-]+\S*$/, "")}…`;
  }
  return s.replace(/[.,;:]+$/, "");
}

const kmText = (x: number) => String(Math.round(x * 100) / 100).replace(".", ",");
const has = (rows: DetailRow[], field: string) => rows.filter((r) => r.field === field && !NO_DATA.test(r.value.trim()));
const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const hhmm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;

function startPart(rows: DetailRow[]): string | null {
  const own = has(rows, "start_time");
  if (!own.length) return null;
  // Время берём из основной части значения (до « — » и скобок): «09:00 (регистрация 08:00)» → 9:00.
  const times = new Set<number>();
  for (const r of own) for (const t of shortValue(r.value, 200).match(/\b([01]?\d|2[0-3]):[0-5]\d\b/g) ?? []) times.add(toMin(t));
  if (!times.size) return `старт ${shortValue(own[0].value, 30)}`;
  const sorted = [...times].sort((a, b) => a - b);
  return sorted.length === 1 ? `старт ${hhmm(sorted[0])}` : `старт ${hhmm(sorted[0])}–${hhmm(sorted.at(-1)!)} по дистанциям`;
}

function wavesPart(rows: DetailRow[]): string | null {
  const v = has(rows, "waves")[0]?.value;
  if (!v || /^нет\b|без волн|общий старт/i.test(v)) return null;
  const s = shortValue(v, 36);
  return /^(волн|кластер|поток|старт волн)/i.test(s) ? s : "старт волнами";
}

function pickupPart(rows: DetailRow[]): string | null {
  const v = has(rows, "packet_pickup")[0]?.value;
  return v ? `номера ${shortValue(v)}` : null;
}

/** Длительность: «4,5 ч», «6 ч», «2 ч 30 мин», «2:30», «1 час 15 минут». */
const DURATION = /^(\d+(?:[,.]\d+)?\s*ч(?:ас(?:а|ов)?)?(?:\s*\d+\s*мин(?:ут[ы]?)?)?|\d{1,2}:\d{2})$/i;

function cutoffPart(rows: DetailRow[]): string | null {
  const own = has(rows, "cutoff");
  if (!own.length) return null;
  const longest = [...own].sort((a, b) => (b.distance ?? -1) - (a.distance ?? -1))[0];
  const v = shortValue(longest.value, 30);
  if (!DURATION.test(v)) return null;
  const many = own.filter((r) => r.distance != null).length > 1;
  return `лимит ${v}${many && longest.distance != null ? ` на ${kmText(longest.distance)} км` : ""}`;
}

const REG = /^(мест нет|регистрация закрыта) \(на \d{2}\.\d{2}\)$/;

function registrationPart(rows: DetailRow[]): string | null {
  const own = has(rows, "registration_status");
  const v = own.map((r) => r.value).join(" ");
  // Дата проверки: самая поздняя из строк статуса. Нет её — не показываем (см. шапку).
  const checked = own.map((r) => r.checked_at ?? "").filter((x) => /^\d{4}-\d{2}-\d{2}/.test(x)).sort().at(-1);
  if (!checked) return null;
  const on = ` (на ${checked.slice(8, 10)}.${checked.slice(5, 7)})`;
  if (/исчерпан|нет мест|sold ?out|мест не осталось/i.test(v)) return `мест нет${on}`;
  if (/^закрыт|регистрация закрыта|онлайн-регистрация закрыта/i.test(v)) return `регистрация закрыта${on}`;
  return null;
}

/** Части блока по порядку: старт, волны, номера, лимит, регистрация. */
export function importantParts(rows: DetailRow[]): string[] {
  return [startPart(rows), wavesPart(rows), pickupPart(rows), cutoffPart(rows), registrationPart(rows)].filter((x): x is string => !!x);
}

/** «Важное: старт 9:00, номера сб 12:00–20:00, лимит 3 ч, мест нет (на 15.10)» или null. Длиннее MAX_LINE — части с конца
 *  отбрасываются, но «регистрация закрыта / мест нет» остаётся всегда: это главное. */
export function importantLine(rows: DetailRow[]): string | null {
  const parts = importantParts(rows);
  if (!parts.length) return null;
  const reg = parts.find((p) => REG.test(p));
  const rest = parts.filter((p) => p !== reg);
  const build = (xs: string[]) => `Важное: ${[...xs, ...(reg ? [reg] : [])].join(", ")}`;
  while (rest.length > 1 && build(rest).length > MAX_LINE) rest.pop();
  return build(rest);
}
