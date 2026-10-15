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
 *   npx tsx --env-file=<.env.local> scripts/races-geo-fill.ts --subjects [--apply] — субъект РФ (race_geo.subject)
 *     из сохранённого ответа геокодера; у пар без ответа — у той же записи с регионом, иначе обратный геокодер.
 */

import { areaRaces, geoKey, NEARBY_KM } from "@/features/races-bot/core";
import { canonicalSubject, subjectFromDisplay } from "@/app/races/subjects";
import { createSupabaseServerClient } from "@/features/supabase/server";
import { politeFetch } from "./lib/polite-fetch";

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
// Регион целиком (state/region) — НЕ место старта: точка в центре области дала бы ложные «52 км».
const SETTLEMENT = new Set(["city", "town", "village", "hamlet", "municipality", "suburb", "city_district", "isolated_dwelling", "locality"]);
const NOT_A_POINT = new Set(["state", "region", "country"]);

// В OpenStreetMap эти регионы вне countrycodes=ru: ищем в ru,ua, регион всё равно сверяется.
const OSM_UA = /крым|севастопол|херсон|запорож|донецк|луганск/i;

/** «г.т. Исеть», «рп. Сузун», «ст-ца Тацинская», «. Коктебель» → название без приставки. */
function cleanName(s: string): string {
  return s.replace(/^[\s.]*(г\.?\s*т\.|г\.?\s*п\.|рп\.|пгт\.?|п\.|пос\.|с\.|д\.|ст-ца|станица|г\.)\s*/i, "").replace(/^[\s.]+/, "").trim();
}

async function nominatim(q: string, ua = false): Promise<Place[]> {
  const cc = ua ? "ru,ua" : "ru";
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=8&countrycodes=${cc}&accept-language=ru&q=${encodeURIComponent(q)}`;
  const res = await politeFetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ru" } });
  await sleep(PAUSE_MS);
  if (res.status === 429 || res.status === 403) throw new Error(`Nominatim ${res.status}: стоп, лимит`);
  if (!res.ok) return [];
  return (await res.json()) as Place[];
}

/** Пары без региона: точка у той же записи с регионом (Симферополь без региона нашёлся на Алтае). */
let TWINS = new Map<string, { lat: number; lon: number; region: string }>();

async function geocode({ city: rawCity, region }: Pair): Promise<{ lat: number | null; lon: number | null; display: string | null; note: string | null }> {
  const city = cleanName(rawCity);
  if (!region) {
    const twin = TWINS.get(lower(city));
    if (twin) return { lat: twin.lat, lon: twin.lon, display: null, note: `регион не указан: точка взята у «${city}, ${twin.region}»` };
  }
  const tries = region && lower(region) !== lower(city) ? [`${city}, ${region}`, city] : [city];
  const ua = OSM_UA.test(region) || OSM_UA.test(city);
  let seen: string | null = null;
  for (const q of tries) {
    const found = (await nominatim(q, ua)).filter((p) => !NOT_A_POINT.has(p.addresstype ?? ""));
    const ok = found.filter((p) => SETTLEMENT.has(p.addresstype ?? "") && regionMatches(region, p));
    // Без региона и одноимённые места в разных областях (Байкал, Донецк): точку не угадываем.
    // Сёла с тем же именем не в счёт: «Брянск» — город, а не село в Бурятии. Неоднозначно — когда
    // одноимённых ГОРОДОВ несколько в разных областях (Донецк) или городов нет вовсе (Байкал).
    if (!region && ok.length) {
      const same = ok.filter((p) => lower(p.display_name).split(",")[0].trim() === lower(city));
      const towns = same.filter((p) => p.addresstype === "city" || p.addresstype === "town");
      const states = new Set((towns.length ? towns : same).map((p) => p.address?.state ?? p.address?.region ?? ""));
      if (states.size > 1) return { lat: null, lon: null, display: ok[0].display_name, note: `неоднозначно без региона: ${[...states].join(" / ")}` };
      if (towns.length) ok.splice(0, ok.length, ...towns);
    }
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

async function reverseSubject(lat: number, lon: number): Promise<string | null> {
  const res = await politeFetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=5&accept-language=ru&lat=${lat}&lon=${lon}`, { headers: { "User-Agent": UA } });
  await sleep(PAUSE_MS);
  if (!res.ok) return null;
  const j = (await res.json()) as { display_name?: string; address?: Record<string, string> };
  return subjectFromDisplay(j.display_name) ?? canonicalSubject(j.address?.state);
}

async function subjects() {
  const sb = createSupabaseServerClient();
  const { data, error } = await sb.from("race_geo").select("key,city,region,lat,lon,display_name,subject").not("lat", "is", null);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { key: string; city: string; region: string; lat: number; lon: number; display_name: string | null; subject: string | null }[];
  const byCity = new Map<string, string>();
  const out = new Map<string, string | null>();
  for (const r of rows) {
    const s0 = subjectFromDisplay(r.display_name);
    out.set(r.key, s0);
    if (s0 && r.region) byCity.set(lower(r.city), s0);
  }
  let rev = 0;
  for (const r of rows) {
    if (out.get(r.key)) continue;
    let s1 = byCity.get(lower(r.city)) ?? null;
    if (!s1) { s1 = await reverseSubject(r.lat, r.lon); rev += 1; }
    out.set(r.key, s1);
  }
  const changed = rows.filter((r) => (out.get(r.key) ?? null) !== (r.subject ?? null));
  const none = rows.filter((r) => !out.get(r.key));
  console.log(`строк с точкой ${rows.length}, субъект определён ${rows.length - none.length}, обратный геокодер ${rev}, к записи ${changed.length}`);
  for (const r of none) console.log(`  без субъекта: ${r.city}, ${r.region} · ${r.display_name ?? ""}`);
  const counts = new Map<string, number>();
  for (const v of out.values()) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  console.log(`субъектов ${counts.size}; пример: ${[...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k} ${n}`).join(", ")}`);
  if (!APPLY) return;
  for (const r of changed) {
    const { error: e } = await sb.from("race_geo").update({ subject: out.get(r.key) ?? null }).eq("key", r.key);
    if (e) throw new Error(e.message);
  }
  console.log(`записано ${changed.length}`);
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
  const { data: tw } = await sb.from("race_geo").select("city,region,lat,lon").neq("region", "").not("lat", "is", null).order("checked_at");
  TWINS = new Map();
  for (const g of (tw ?? []) as { city: string; region: string; lat: number; lon: number }[]) if (!TWINS.has(lower(cleanName(g.city)))) TWINS.set(lower(cleanName(g.city)), g);
  // --redo: заново те, что не узнаны, и те, где в поле города стоит регион (раньше брали центр области).
  const redo = process.argv.includes("--redo")
    ? new Set(((await sb.from("race_geo").select("key,city,lat,note").neq("source", "manual")).data ?? [])
        .filter((g: { city: string; lat: number | null; note?: string | null }) => g.lat === null || (g.note ?? "").includes("регион не указан") || /област|край|республик|автономн|округ/i.test(g.city) || /^\s*[.]|^(г\.?\s*т\.|г\.?\s*п\.|рп\.|п\.|ст-ца)/i.test(g.city))
        .map((g: { key: string }) => g.key))
    : new Set<string>();
  const todo = pairs.filter((p) => !known.has(geoKey(p.city, p.region)) || redo.has(geoKey(p.city, p.region))).slice(0, LIMIT);
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
      subject: g.lat !== null ? subjectFromDisplay(g.display) : null,
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
  for (const city of (process.argv.find((a) => a.startsWith("--cities="))?.split("=")[1] || "Тверь,Магнитогорск,Владикавказ").split(",")) {
    const own = races.filter((r) => r.city === city);
    const area = areaRaces(races, city, [], []);
    console.log(`\n${city}: в городе ${own.length}; «${area.subject || "?"} и рядом» (до ${NEARBY_KM} км): ${area.items.length}`);
    for (const { race, km } of area.items.slice(0, 12)) console.log(`  ${race.city || `${race.subject}, город не указан`}${km === null ? "" : `, ${km} км`} · ${race.ds} · ${race.name}`);
  }
}

const main = process.argv.includes("--report") ? report : process.argv.includes("--sample") ? sample : process.argv.includes("--subjects") ? subjects : fill;
main().catch((e) => {
  console.error("races-geo-fill FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
