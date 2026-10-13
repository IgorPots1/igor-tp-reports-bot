/* Ожидаемые старты для /races: race_expected (status = expected) читается на сервере ключом
 * сервисной роли — таблица закрыта для публичного ключа. Ошибка чтения не роняет страницу:
 * блок просто не показывается. */

import { createSupabaseServerClient } from "@/features/supabase/server";
import { stripStaleYear } from "@/app/races/races-logic";
import { distKm, geoKey, type ExpectedItem } from "@/features/races-bot/core";
import { canonicalSubject } from "@/app/races/subjects";

type GeoRow = { key: string; lat: number | null; lon: number | null; subject: string | null };

/** Точка и субъект ожидаемых стартов из race_geo (на сервере, сервисной ролью: таблица закрыта). */
export async function loadGeoRows(): Promise<Map<string, GeoRow>> {
  const sb = createSupabaseServerClient();
  const out = new Map<string, GeoRow>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("race_geo").select("key,lat,lon,subject").order("key").range(from, from + 999);
    if (error) throw error;
    for (const g of (data as GeoRow[]) || []) out.set(g.key, g);
    if (!data || data.length < 1000) return out;
  }
}

/** Субъект и точка ожидаемого: из race_geo по «город, регион»; нет — субъект из написания региона. */
export function withGeo(e: ExpectedItem, geo: Map<string, GeoRow>): ExpectedItem {
  const g = geo.get(geoKey(e.city, e.region));
  return {
    ...e,
    subject: g?.subject || canonicalSubject(e.region) || canonicalSubject(e.city) || "",
    geo: g && g.lat !== null && g.lon !== null ? { lat: g.lat, lon: g.lon } : null,
  };
}

type Row = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  race_type: string | null;
  distances: string[] | null;
  last_month: number;
  last_date: string;
  last_url: string;
  site_url: string | null;
};

export function toExpected(r: Row): ExpectedItem {
  const dist = r.distances || [];
  return {
    id: r.id,
    // Ждём следующее проведение: год прошлого («… 2025») при выводе не показываем.
    name: stripStaleYear(r.name, `${Number(r.last_date.slice(0, 4)) + 1}-01-01`),
    city: r.city || "",
    region: r.region || "",
    type: r.race_type || "",
    distances: dist,
    km: dist.map(distKm).filter((x): x is number => x !== null),
    lastMonth: r.last_month,
    lastDate: r.last_date,
    lastUrl: r.last_url,
    site: /^https?:\/\//i.test(r.site_url || "") ? (r.site_url as string) : "",
  };
}

export async function loadExpected(): Promise<ExpectedItem[]> {
  try {
    const sb = createSupabaseServerClient();
    const out: ExpectedItem[] = [];
    // точки не прочитались — ожидаемые всё равно показываем, без области и радиуса
    const geo = await loadGeoRows().catch(() => new Map<string, GeoRow>());
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb
        .from("race_expected")
        .select("id,name,city,region,race_type,distances,last_month,last_date,last_url,site_url")
        .eq("status", "expected")
        .order("last_month")
        .order("name")
        .range(from, from + 999);
      if (error) throw error;
      out.push(...((data as Row[]) || []).map((r) => withGeo(toExpected(r), geo)));
      if (!data || data.length < 1000) return out;
    }
  } catch (e) {
    console.error(`[races] race_expected: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}
