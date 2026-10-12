/* Ожидаемые старты для /races: race_expected (status = expected) читается на сервере ключом
 * сервисной роли — таблица закрыта для публичного ключа. Ошибка чтения не роняет страницу:
 * блок просто не показывается. */

import { createSupabaseServerClient } from "@/features/supabase/server";
import { stripStaleYear } from "@/app/races/races-logic";
import { distKm, type ExpectedItem } from "@/features/races-bot/core";

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
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb
        .from("race_expected")
        .select("id,name,city,region,race_type,distances,last_month,last_date,last_url,site_url")
        .eq("status", "expected")
        .order("last_month")
        .order("name")
        .range(from, from + 999);
      if (error) throw error;
      out.push(...((data as Row[]) || []).map(toExpected));
      if (!data || data.length < 1000) return out;
    }
  } catch (e) {
    console.error(`[races] race_expected: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}
