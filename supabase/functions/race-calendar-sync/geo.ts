// Регион для строки без региона: субъект РФ из race_geo (наряд 12.10.2026, «города и области»).
// Чистый модуль без Deno и Node API: его зовут edge-функция (сбор и ожидаемые) и шлюз
// scripts/races-manual.ts. Исходный city не меняется никогда, region заполняется только пустой.

export type GeoSubjectRow = { key: string; city: string; subject: string | null };

const n = (s: string | null | undefined) => (s || "").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();

/** Ключ race_geo — как geoKey в src/features/races-bot/core.ts: «город, регион». */
export function geoKey(city: string | null | undefined, region: string | null | undefined): string {
  return `${n(city)}, ${n(region)}`;
}

/**
 * Субъект для пары «город, регион»: точная запись race_geo, иначе — у записей того же города, если у
 * всех у них один субъект (Москва, Тверь). Разные субъекты у одноимённых городов (Кировск в двух
 * областях) — null: регион не угадываем.
 */
export function subjectFor(rows: GeoSubjectRow[], city: string | null | undefined, region: string | null | undefined): string | null {
  const exact = rows.find((g) => g.key === geoKey(city, region));
  if (exact?.subject) return exact.subject;
  const c = n(city);
  if (!c) return null;
  const subj = new Set(rows.filter((g) => n(g.city) === c && g.subject).map((g) => g.subject as string));
  return subj.size === 1 ? [...subj][0] : null;
}

/** Заполнить пустой region субъектом; непустой и city не трогаются. */
export function fillRegion<T extends { city: string | null; region: string | null }>(row: T, rows: GeoSubjectRow[]): T {
  if (row.region && row.region.trim()) return row;
  const s = subjectFor(rows, row.city, row.region);
  return s ? { ...row, region: s } : row;
}
