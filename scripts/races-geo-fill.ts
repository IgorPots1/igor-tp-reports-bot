/**
 * Координаты городов стартов для «Рядом» в боте: кэш race_geo по «город, регион».
 *
 * Один раз для всех городов race_calendar (до конца 2027) и race_expected, дальше — только новые.
 * Геокодер — Nominatim (OpenStreetMap) по его правилам: один запрос не чаще раза в 1,1 с, свой
 * User-Agent, без параллельных запросов. Город, который не удалось уверенно узнать (нет результата
 * или регион не совпал), пишется с source 'none' и lat/lon null — в отчёт списком, повторно не
 * спрашиваем; поправить можно руками (source 'manual').
 *
 *   npx tsx --env-file=<.env.local> scripts/races-geo-fill.ts            — пробно: что спросил бы, без записи
 *   npx tsx --env-file=<.env.local> scripts/races-geo-fill.ts --apply    — спросить и записать в race_geo
 *   npx tsx --env-file=<.env.local> scripts/races-geo-fill.ts --report   — итог: узнано / не узнано
 *   npx tsx --env-file=<.env.local> scripts/races-geo-fill.ts --sample   — «Рядом» для Твери, Магнитогорска, Владикавказа
 */

import { geoKey, nearbyRaces, NEARBY_KM } from "@/features/races-bot/core";
import { createSupabaseServerClient } from "@/features/supabase/server";

const UA = "igorp.run races calendar geo-fill (+https://igorp.run/races)";
const PAUSE_MS = 1100;
const APPLY = process.argv.includes("--apply");
const LIMIT = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? Infinity);

type Pair = { city: string; region: string };
type Place = { lat: string; lon: string; display_name: string; addresstype?: string; category?: string; address?: Record<string, string> };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lower = (s: string) => s.toLowerCase().replace(/ё/g, "е");

// Значимые слова региона: «Республика Северная Осетия — Алания» → «северная», «осетия», «алания».
const GENERIC = new Set(["область", "край", "республика", "автономный", "округ", "автономная", "город", "федерального", "значения", "—", "-", "югра", "кузбасс"]);
function regionWords(s: string): string[] {
  return lower(s).split(/[\s,()–—-]+/).filter((w) => w.length >= 4 && !GENERIC.has(w)).map((w) => w.slice(0, 5));
}
function regionMatches(region: string, p: Place): boolean {
  if (!region) return true;
  const want = regionWords(region);
  if (!want.length) return true;
  const a = p.address ?? {};
  const have = lower([a.state, a.region, a.city, a.county, p.display_name].filter(Boolean).join(" "));
  return want.some((w) => have.includes(w));
}
const SETTLEMENT = new Set(["city", "town", "village", "hamlet", "municipality", "suburb", "city_district", "isolated_dwelling", "locality", "state", "region"]);

async function nominatim(q: string): Promise<Place[]> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=8&countrycodes=ru&accept-language=ru&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ru" } });
  await sleep(PAUSE_MS);
  if (res.status === 429 || res.status === 403) throw new Error(`Nominatim ${res.status}: стоп, лимит`);
  if (!res.ok) return [];
  return (await res.json()) as Place[];
}

async function geocode({ city, region }: Pair): Promise<{ lat: number | null; lon: number | null; display: string | null; note: string | null }> {
  const tries = region && lower(region) !== lower(city) ? [`${city}, ${region}`, city] : [city];
  let seen: string | null = null;
  for (const q of tries) {
    const found = await nominatim(q);
    const ok = found.filter((p) => SETTLEMENT.has(p.addresstype ?? "") && regionMatches(region, p));
    // Не населённый пункт (курорт, урочище, парк), но регион совпал: место старта, берём с пометкой.
    const place = ok[0] ?? (region ? found.find((p) => regionMatches(region, p)) : undefined);
    if (place) {
      const notes = [
        !ok.length ? `не населённый пункт: ${place.addresstype ?? place.category ?? "?"}` : null,
        q === city && tries.length > 1 ? "найден без региона в запросе, регион совпал" : null,
        !region ? "регион не указан: одноимённые места бывают в разных областях, проверить" : null,
      ].filter(Boolean);
      return { lat: Number(place.lat), lon: Number(place.lon), display: place.display_name, note: notes.length ? notes.join("; ") : null };
    }
    seen ??= found[0]?.display_name ?? null;
  }
  return { lat: null, lon: null, display: seen, note: seen ? "регион не совпал или не населённый пункт" : "нет результата" };
}

async function loadPairs(): Promise<Pair[]> {
  const sb = createSupabaseServerClient();
  const out = new Map<string, Pair>();
  for (const [table, filter] of [["race_calendar", true], ["race_expected", false]] as const) {
    for (let from = 0; ; from += 1000) {
      let q = sb.from(table).select("city,region").order("id").range(from, from + 999);
      if (filter) q = q.lte("date_start", "2027-12-31");
      const { data, error } = await q;
      if (error) throw new Error(`${table}: ${error.message}`);
      for (const r of (data ?? []) as { city: string | null; region: string | null }[]) {
        const city = (r.city ?? "").trim();
        if (!city) continue;
        const p = { city, region: (r.region ?? "").trim() };
        out.set(geoKey(p.city, p.region), p);
      }
      if (!data || data.length < 1000) break;
    }
  }
  return [...out.values()];
}

async function fill() {
  const sb = createSupabaseServerClient();
  const pairs = await loadPairs();
  const { data: have, error } = await sb.from("race_geo").select("key");
  if (error) throw new Error(`race_geo: ${error.message}`);
  const known = new Set(((have ?? []) as { key: string }[]).map((g) => g.key));
  const todo = pairs.filter((p) => !known.has(geoKey(p.city, p.region))).slice(0, LIMIT);
  console.log(`пар «город, регион»: ${pairs.length}, уже в race_geo: ${known.size}, спросить: ${todo.length} (~${Math.ceil((todo.length * 2 * PAUSE_MS) / 60000)} мин максимум)`);
  let ok = 0;
  for (const [i, p] of todo.entries()) {
    const g = await geocode(p);
    if (g.lat !== null) ok += 1;
    console.log(`${i + 1}/${todo.length} ${g.lat !== null ? "ok  " : "NONE"} ${p.city}, ${p.region}${g.lat !== null ? ` → ${g.lat.toFixed(3)},${g.lon!.toFixed(3)}` : ` (${g.note}${g.display ? `: ${g.display}` : ""})`}`);
    if (!APPLY) continue;
    const { error: e } = await sb.from("race_geo").upsert({
      key: geoKey(p.city, p.region), city: p.city, region: p.region, lat: g.lat, lon: g.lon,
      source: g.lat !== null ? "nominatim" : "none", display_name: g.display, note: g.note, checked_at: new Date().toISOString(),
    }, { onConflict: "key" });
    if (e) throw new Error(`race_geo upsert: ${e.message}`);
  }
  console.log(`${APPLY ? "записано" : "пробно, без записи"}: узнано ${ok} из ${todo.length}`);
}

async function report() {
  const sb = createSupabaseServerClient();
  const pairs = await loadPairs();
  const { data } = await sb.from("race_geo").select("key,city,region,lat,source,note,display_name").order("city");
  const rows = (data ?? []) as { key: string; city: string; region: string; lat: number | null; source: string; note: string | null; display_name: string | null }[];
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const cal = new Set<string>();
  const { data: calRows } = await sb.from("race_calendar").select("city,region").lte("date_start", "2027-12-31");
  for (const r of (calRows ?? []) as { city: string; region: string }[]) cal.add(geoKey(r.city, r.region));
  const stat = (keys: string[]) => ({ all: keys.length, ok: keys.filter((k) => byKey.get(k)?.lat != null).length, missing: keys.filter((k) => !byKey.has(k)).length });
  const allKeys = pairs.map((p) => geoKey(p.city, p.region));
  console.log("все пары:", stat(allKeys), "· календарь:", stat([...cal]));
  const none = rows.filter((r) => r.lat === null);
  console.log(`\nНе узнаны (${none.length}):`);
  for (const r of none) console.log(`- ${r.city}${r.region ? `, ${r.region}` : ""}${cal.has(r.key) ? " [календарь]" : ""} · ${r.note ?? ""}${r.display_name ? ` · первый ответ: ${r.display_name}` : ""}`);
}

async function sample() {
  const { loadBotRaces } = await import("@/features/races-bot/runtime");
  const races = await loadBotRaces();
  for (const city of ["Тверь", "Магнитогорск", "Владикавказ"]) {
    const own = races.filter((r) => r.city === city);
    const near = nearbyRaces(races, city, [], []);
    console.log(`\n${city}: своих стартов ${own.length}, координаты города ${own[0]?.geo ? `${own[0].geo.lat.toFixed(2)},${own[0].geo.lon.toFixed(2)}` : "нет"}; «Рядом» ${near.radius ? `до ${NEARBY_KM} км` : `регион ${near.region}`}: ${near.races.length}`);
    for (const r of near.races.slice(0, 10)) console.log(`  ${near.km.get(r.id) ?? "?"} км · ${r.ds} · ${r.name} · ${r.city}`);
  }
}

const main = process.argv.includes("--report") ? report : process.argv.includes("--sample") ? sample : fill;
main().catch((e) => {
  console.error("races-geo-fill FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
