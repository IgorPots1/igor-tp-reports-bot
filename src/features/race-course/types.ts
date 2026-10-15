/* Разбор трассы (пилот 14.10.2026): публичные данные одного старта. Собирает
 * scripts/race-course/build.ts в src/data/race-courses/<safe_id>.json. Персональных данных
 * учеников здесь нет: трек ученика использован только для сверки формы и набора высоты. */

export type WindSide = "head" | "tail" | "cross";

export type CourseKeyPoint = { km: number; type: "climb" | "descent" | "wind" | "other"; text: string };

export type CourseData = {
  raceId: string;
  name: string;
  date: string;
  distanceKm: number;
  /** year — какого года трек (метка свежести на странице); нет, значит не знаем. */
  source: { kind: string; url: string | null; note: string | null; year?: number | null };
  /** Суть одной строкой для выбора дистанции в боте: «2 подъёма до 200 м, спуск 325 м». */
  summary?: string;
  /** [lat, lon], упрощённый трек. */
  track: [number, number][];
  /** [км, высота м], шаг ~100 м, сглажено. */
  elevation: [number, number][];
  gain: number;
  loss: number;
  perKm: { km: number; gain: number; loss: number; bearing: number; wind: WindSide }[];
  checks: { ours: number; organizer: number | null; student: number | null; publish: boolean; reason: string | null };
  wind: { dir: number; dirLabel: string; medianMs: number; p75Ms: number; gustP75Ms: number; years: number; sample: number } | null;
  forecast: { speedMs: number; dir: number; dirLabel: string; gustMs?: number | null } | null;
  keyPoints: CourseKeyPoint[];
};

const FROM: Record<string, string> = {
  С: "с севера", СВ: "с северо-востока", В: "с востока", ЮВ: "с юго-востока",
  Ю: "с юга", ЮЗ: "с юго-запада", З: "с запада", СЗ: "с северо-запада",
};

/** Метка свежести трека: трек этого года от организатора или старый, который надо сверить со схемой. */
export function trackFreshness(c: Pick<CourseData, "date" | "source">): string | null {
  const y = c.source.year;
  if (!y) return null;
  const own = c.source.kind === "gpx_organizer" ? "трек организатора" : "трек";
  return y >= Number(c.date.slice(0, 4)) ? `Трасса ${y}, ${own}` : `По треку ${y}, сверьте со схемой`;
}

/** «З» → «с запада»: откуда дует ветер, человеческими словами. */
export function windFrom(dirLabel: string): string {
  return FROM[dirLabel] ?? `с направления ${dirLabel}`;
}

/** Число по-русски: 3.7 → «3,7». */
export function ru(n: number): string {
  return String(n).replace(".", ",");
}
