/* Агрегаты для /admin/tools-stats: таблица по path (сегодня / 7 / 30 дней), график по дням,
 * источники за 7 дней. Чистый расчёт по строкам page_views + чтение из базы постранично.
 *
 * Дни — московские (как в остальной админке). Москва без перехода на летнее время с 2014,
 * смещение постоянное: UTC+3. */

import { SITE_URL } from "@/lib/site";
import { createSupabaseServerClient, describeSupabaseError } from "@/features/supabase/server";

export type PageViewStatRow = {
  created_at: string;
  path: string;
  visitor_id: string | null;
  referrer: string | null;
  utm_source: string | null;
};

export type Count = { views: number; visitors: number };
export type PathStat = { path: string; today: Count; d7: Count; d30: Count };
export type DayPoint = { day: string; n: number };
export type SourceCount = { label: string; n: number };

export type PageViewStats = {
  paths: PathStat[];
  days: string[];
  byDay: Record<string, DayPoint[]>;
  referrers7: SourceCount[];
  utmSources7: SourceCount[];
  total30: number;
  truncated: boolean;
};

export const ALL_PATHS = "__all__";
export const DIRECT_LABEL = "прямой заход";

const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function moscowDay(at: Date): string {
  return new Date(at.getTime() + MOSCOW_OFFSET_MS).toISOString().slice(0, 10);
}

/** 30 московских дней по возрастанию, последний — сегодня. */
export function last30Days(now: Date): string[] {
  const today = Date.parse(`${moscowDay(now)}T00:00:00Z`);
  return Array.from({ length: 30 }, (_, i) => new Date(today - (29 - i) * DAY_MS).toISOString().slice(0, 10));
}

/** Начало окна в UTC: московская полночь 29 дней назад. */
export function windowStart(now: Date): Date {
  return new Date(Date.parse(`${last30Days(now)[0]}T00:00:00Z`) - MOSCOW_OFFSET_MS);
}

const siteHost = (() => {
  try {
    return new URL(SITE_URL).hostname.replace(/^www\./u, "");
  } catch {
    return "igorp.run";
  }
})();

/** Домен источника; null — переход внутри сайта (свой домен, превью Vercel, localhost). */
export function referrerDomain(referrer: string | null): string | null {
  if (!referrer) return DIRECT_LABEL;
  let host: string;
  try {
    host = new URL(referrer).hostname.replace(/^www\./u, "").toLowerCase();
  } catch {
    return DIRECT_LABEL;
  }
  if (!host) return DIRECT_LABEL;
  if (host === siteHost || host.endsWith(".vercel.app") || host === "localhost" || host === "127.0.0.1") return null;
  return host;
}

function countOf(rows: PageViewStatRow[]): Count {
  return { views: rows.length, visitors: new Set(rows.map((r) => r.visitor_id).filter(Boolean)).size };
}

function topCounts(values: string[]): SourceCount[] {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
}

export function computePageViewStats(rows: PageViewStatRow[], now: Date, truncated = false): PageViewStats {
  const days = last30Days(now);
  const today = days[29];
  const from7 = days[23];
  const withDay = rows.map((r) => ({ r, day: moscowDay(new Date(r.created_at)) })).filter((x) => x.day >= days[0] && x.day <= today);

  const byPath = new Map<string, { r: PageViewStatRow; day: string }[]>();
  for (const x of withDay) {
    const list = byPath.get(x.r.path) ?? [];
    list.push(x);
    byPath.set(x.r.path, list);
  }

  const paths: PathStat[] = [...byPath.entries()]
    .map(([path, list]) => ({
      path,
      today: countOf(list.filter((x) => x.day === today).map((x) => x.r)),
      d7: countOf(list.filter((x) => x.day >= from7).map((x) => x.r)),
      d30: countOf(list.map((x) => x.r)),
    }))
    .sort((a, b) => b.d7.views - a.d7.views || b.d30.views - a.d30.views || a.path.localeCompare(b.path));

  const series = (list: { day: string }[]): DayPoint[] => {
    const m = new Map<string, number>();
    for (const x of list) m.set(x.day, (m.get(x.day) ?? 0) + 1);
    return days.map((day) => ({ day, n: m.get(day) ?? 0 }));
  };
  const byDay: Record<string, DayPoint[]> = { [ALL_PATHS]: series(withDay) };
  for (const [path, list] of byPath) byDay[path] = series(list);

  const last7 = withDay.filter((x) => x.day >= from7).map((x) => x.r);
  const referrers7 = topCounts(last7.map((r) => referrerDomain(r.referrer)).filter((d): d is string => d !== null));
  const utmSources7 = topCounts(last7.map((r) => r.utm_source).filter((s): s is string => Boolean(s)));

  return { paths, days, byDay, referrers7, utmSources7, total30: withDay.length, truncated };
}

const PAGE_SIZE = 1000;
const MAX_ROWS = 200_000;

/** Все строки за 30 дней постранично (PostgREST отдаёт не больше 1000 за раз). */
export async function loadPageViewStats(now = new Date()): Promise<PageViewStats> {
  const supabase = createSupabaseServerClient();
  const since = windowStart(now).toISOString();
  const rows: PageViewStatRow[] = [];
  let truncated = false;
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("page_views")
      .select("created_at, path, visitor_id, referrer, utm_source")
      .gte("created_at", since)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`page_views: ${describeSupabaseError(error)}`);
    rows.push(...((data ?? []) as PageViewStatRow[]));
    if (!data || data.length < PAGE_SIZE) break;
    if (rows.length >= MAX_ROWS) {
      truncated = true;
      break;
    }
  }
  return computePageViewStats(rows, now, truncated);
}
