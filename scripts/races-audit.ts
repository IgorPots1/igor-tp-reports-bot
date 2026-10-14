/**
 * Проверка стартов календаря /races на несостыковки (наряд 14.10.2026). ТОЛЬКО ЧТЕНИЕ.
 *
 *   npx tsx --env-file=<.env.local> scripts/races-audit.ts <out-dir>
 *
 * Читает race_calendar (то, что видят сайт и бот), race_events (сырые строки), race_expected,
 * race_geo; страницы организаторов — только для конфликтов дат (несколько штук). Пишет
 * <out-dir>/races-audit-YYYY-MM-DD.json и .md: по каждому пункту число, до 10 примеров и вид
 * правки (auto — безопасна пакетом, decide — решает человек). В базу не пишет ничего.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { canonicalSubject } from "@/app/races/subjects";
import { createSupabaseServerClient } from "@/features/supabase/server";

import { keyTokens } from "../supabase/functions/race-calendar-sync/expected";
import { geoKey } from "../supabase/functions/race-calendar-sync/geo";

type Row = {
  id: string; source: string; name: string; date_start: string; date_end: string; city: string | null; region: string | null;
  race_type: string; site_url: string | null; reg_url: string | null; link_ok: boolean | null; alt_dates: string[] | null;
  sources: string[] | null; subject: string | null; lat: number | null; lon: number | null; distances: string[] | null; dist_km: number[] | null;
};
type Item = { id: string; name: string; date: string; city: string | null; detail: string; fix?: string };
type Check = { key: string; title: string; count: number; kind: "auto" | "decide" | "mixed" | "none"; howToFix: string; items: Item[] };

const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10);
const km = (a: Row, b: Row) => (a.lat == null || b.lat == null || a.lon == null || b.lon == null ? null
  : 111.32 * Math.hypot(a.lat - b.lat, (a.lon - b.lon) * Math.cos((a.lat * Math.PI) / 180)));
const it = (r: Row, detail: string, fix?: string): Item => ({ id: r.id, name: r.name, date: r.date_start, city: r.city, detail, ...(fix ? { fix } : {}) });

function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const w of a) if ([...b].some((x) => x === w || (w.length > 4 && x.length > 4 && (x.startsWith(w.slice(0, 5)) || w.startsWith(x.slice(0, 5)))))) n++;
  return n / Math.min(a.size, b.size);
}

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
/** Есть ли на странице организатора дата в виде «24 октября» или «24.10». */
async function siteHasDate(url: string, iso: string): Promise<boolean | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "igorp.run races-audit (+https://igorp.run)" }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const t = (await res.text()).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
    const [, m, d] = iso.split("-").map(Number);
    return new RegExp(`(^|\\D)0?${d}\\s+${MONTHS[m - 1]}|(^|\\D)0?${d}\\.${String(m).padStart(2, "0")}(\\D|$)`, "i").test(t);
  } catch {
    return null;
  }
}

async function main() {
  const outDir = process.argv[2];
  if (!outDir) throw new Error("races-audit.ts <out-dir>");
  const db = createSupabaseServerClient();
  const all = async <T>(table: string, cols: string, orderBy = "id"): Promise<T[]> => {
    const out: T[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from(table).select(cols).order(orderBy).range(from, from + 999);
      if (error) throw new Error(`${table}: ${error.message}`);
      out.push(...((data ?? []) as T[]));
      if (!data || data.length < 1000) return out;
    }
  };
  const cal = await all<Row>("race_calendar", "id,source,name,date_start,date_end,city,region,race_type,site_url,reg_url,link_ok,alt_dates,sources,subject,lat,lon,distances,dist_km");
  const geo = await all<{ key: string; city: string; display_name: string | null; subject: string | null }>("race_geo", "key,city,display_name,subject", "key");
  const exp = await all<{ id: string; name: string; city: string | null; region: string | null; last_date: string | null; status: string; race_id: string | null; race_type: string | null }>("race_expected", "id,name,city,region,last_date,status,race_id,race_type");
  const checks: Check[] = [];

  // 1. Конфликты дат между источниками.
  {
    const items: Item[] = [];
    for (const r of cal.filter((x) => x.alt_dates?.length)) {
      const votes = new Map<string, string[]>();
      const altSrc = new Set(r.alt_dates!.map((a) => a.split(":")[0]));
      votes.set(r.date_start, (r.sources ?? [r.source]).filter((s) => !altSrc.has(s)));
      for (const a of r.alt_dates!) {
        const [src, d] = a.split(":");
        votes.set(d, [...(votes.get(d) ?? []), src]);
      }
      const ranked = [...votes].sort((a, b) => b[1].length - a[1].length);
      const site: Record<string, boolean | null> = {};
      if (r.site_url) for (const d of votes.keys()) site[d] = await siteHasDate(r.site_url, d);
      const onSite = Object.entries(site).filter(([, v]) => v).map(([d]) => d);
      const verdict = onSite.length === 1 ? onSite[0] : ranked[0][1].length > (ranked[1]?.[1].length ?? 0) ? ranked[0][0] : null;
      items.push(it(r, `${ranked.map(([d, s]) => `${d}: ${s.join(", ")}`).join("; ")}; на сайте: ${r.site_url ? (onSite.join(", ") || "не нашли ни одной") : "сайта нет"}`,
        verdict && verdict !== r.date_start ? `дата → ${verdict}` : verdict === r.date_start ? "наша дата верна, alt_dates оставить" : "решить вручную"));
    }
    checks.push({ key: "dates", title: "Конфликты дат между источниками", count: items.length, kind: "decide", howToFix: "правка даты в строке источника; следующий сбор перезапишет её из источника, если источник сам не исправился — тогда нужна запись в race_overrides (поля даты там пока нет)", items });
  }

  // 2. Дубли после склейки: тот же день, тот же город или ≤30 км, похожие названия.
  {
    const items: Item[] = [];
    const toks = new Map(cal.map((r) => [r.id, keyTokens(r.name)]));
    for (let i = 0; i < cal.length; i++) for (let j = i + 1; j < cal.length; j++) {
      const a = cal[i], b = cal[j];
      if (a.date_start !== b.date_start) continue;
      const d = km(a, b);
      if (!((a.city && a.city === b.city) || (d != null && d <= 30))) continue;
      const o = overlap(toks.get(a.id)!, toks.get(b.id)!);
      if (o < 0.67) continue;
      items.push(it(a, `≈ ${b.id} «${b.name}» (${b.city}), сходство названий ${Math.round(o * 100)}%${d != null ? `, ${d.toFixed(0)} км` : ""}`, "склеить (merged_into) после проверки глазами"));
    }
    checks.push({ key: "dupes", title: "Дубли после склейки", count: items.length, kind: "decide", howToFix: "merged_into на младшую строку; правило склейки в match.ts менять только с прогоном по живым данным", items });
  }

  // 3. Прошедшие, но видимые (представление фильтрует date_end >= CURRENT_DATE по UTC).
  {
    const items = cal.filter((r) => r.date_end < today).map((r) => it(r, `закончился ${r.date_end}`));
    checks.push({ key: "past", title: "Прошедшие старты, которые всё ещё видны", count: items.length, kind: "none", howToFix: "представление race_calendar отсекает date_end < CURRENT_DATE; в первые 3 часа суток по МСК вчерашние ещё видны (CURRENT_DATE по UTC)", items });
  }

  // 4. Город или регион пустой; регион точки не совпадает с заявленным.
  {
    const items: Item[] = [];
    for (const r of cal) {
      if (!r.city?.trim()) { items.push(it(r, "город пустой")); continue; }
      const claimed = canonicalSubject(r.region);
      if (!r.region?.trim() && !r.subject) { items.push(it(r, "нет ни региона, ни точки", "дописать регион в race_geo (ручная точка)")); continue; }
      if (r.lat == null) { items.push(it(r, `нет точки для «${r.city}» (${r.region})`, "добавить точку в race_geo")); continue; }
      if (claimed && r.subject && claimed.toLowerCase() !== r.subject.toLowerCase()) items.push(it(r, `заявлен «${claimed}», точка в «${r.subject}» (${r.lat.toFixed(3)}, ${r.lon!.toFixed(3)})`, "поправить точку в race_geo"));
    }
    checks.push({ key: "geo", title: "Город или регион пустой, точка не в заявленном регионе", count: items.length, kind: "mixed", howToFix: "точки race_geo (справочник, не строки стартов): ручная правка ключа с note; city/region стартов не трогаем", items });
  }

  // 5. Год в названии не совпадает с датой (кроме новогодних забегов 31.12 с годом наступающего).
  {
    const items: Item[] = [];
    for (const r of cal) {
      const y = /(?:^|\D)(20\d\d)(?:\D|$)/.exec(r.name)?.[1];
      if (!y) continue;
      const yr = Number(r.date_start.slice(0, 4));
      if (Number(y) === yr) continue;
      if (Number(y) === yr + 1 && r.date_start.slice(5) >= "12-25") continue;
      items.push(it(r, `в названии ${y}, дата ${r.date_start}`, `при показе уже без «${y}»`));
    }
    checks.push({ key: "year", title: "Год в названии не совпадает с датой", count: items.length, kind: "none", howToFix: "уже чистится при показе: stripStaleYear в toRace (сайт и бот), база не меняется", items });
  }

  // 6. Многодневные > 10 дней, date_end < date_start.
  {
    const items = cal.filter((r) => r.date_end < r.date_start || (Date.parse(r.date_end) - Date.parse(r.date_start)) / 864e5 > 10)
      .map((r) => it(r, `${r.date_start} – ${r.date_end}`));
    checks.push({ key: "span", title: "Многодневные больше 10 дней, конец раньше начала", count: items.length, kind: "decide", howToFix: "—", items });
  }

  // 7. Зарубежные, детские, фан-старты.
  {
    const items: Item[] = [];
    const geoByCity = new Map(geo.map((g) => [g.key, g]));
    const KIDS = /детск|для детей|дети |kids|малыш|школьник|юных|юношеск/i;
    const FUN = /\bфан\b|fun ?run|color|красок|пижам|костюмир|в платьях|хвостат|собак|с собак|каникросс|канирос|бег с колясками|колясок/i;
    for (const r of cal) {
      const g = geoByCity.get(geoKey(r.city, r.region));
      const disp = g?.display_name ?? "";
      const crimea = /Крым|Севастопол/i.test(disp) || /Крым|Севастопол/i.test(r.region ?? "");
      if (disp && !/Россия|Russia/i.test(disp) && !crimea) {
        const claimedRu = !!canonicalSubject(r.region);
        items.push(it(r, `точка за пределами России: ${disp.slice(-70)}`, claimedRu ? `регион старта «${r.region}» — ошибка точки, поправить race_geo` : "убрать (status=removed) после проверки"));
      }
      else if (KIDS.test(r.name)) items.push(it(r, "детский старт по названию", "решить: скрыть или оставить"));
      else if (FUN.test(r.name)) items.push(it(r, "фан-старт по названию", "решить: скрыть или оставить"));
    }
    checks.push({ key: "filters", title: "Зарубежные, детские и фан-старты", count: items.length, kind: "decide", howToFix: "скрыть через race_overrides.hidden (обратимо) или поправить фильтр сборщика", items });
  }

  // 8. Тип старта явно неверный.
  {
    const items: Item[] = [];
    const TRI = /триатл|дуатл|акватл|swimrun|свимран|ironstar|iron star|ironman|x-?terra|aquathlon|duathlon|triathlon/i;
    const TRAIL = /трейл|trail|скайраннинг|sky|горн|кросс|ультра|ultra/i;
    const TRACK = /стадион|манеж|легкоатлетическ|лёгкой атлетик|легкой атлетик|эстафет|track/i;
    for (const r of cal) {
      const n = r.name;
      if (TRI.test(n) && r.race_type !== "tri") items.push(it(r, `тип ${r.race_type}, в названии триатлон/дуатлон`, "тип → tri"));
      else if (r.race_type === "tri" && !TRI.test(n) && !/(swim|плав|заплыв|вело)/i.test(n)) items.push(it(r, "тип tri, в названии нет мультиспорта", "проверить"));
      else if (r.race_type === "road" && /трейл|trail|скайраннинг/i.test(n)) items.push(it(r, "тип road, в названии трейл", "тип → trail"));
      else if (r.race_type === "trail" && TRACK.test(n) && !TRAIL.test(n)) items.push(it(r, "тип trail, в названии стадион/лёгкая атлетика", "тип → track"));
      else if (r.race_type === "track" && TRAIL.test(n)) items.push(it(r, "тип track, в названии трейл/кросс", "проверить"));
    }
    checks.push({ key: "type", title: "Тип старта явно неверный", count: items.length, kind: "mixed", howToFix: "тип пишет сборщик по источнику; правка строки перезапишется следующим сбором — нужен справочник исключений", items });
  }

  // 9. Мёртвые ссылки у стартов ближайших 60 дней.
  {
    const items = cal.filter((r) => r.link_ok === false && r.date_start <= addDays(today, 60))
      .map((r) => it(r, `сайт ${r.site_url ?? "—"}; регистрация ${r.reg_url ?? "—"}`, "найти живую ссылку или скрыть кнопку"));
    checks.push({ key: "links", title: "Мёртвые ссылки (ближайшие 60 дней)", count: items.length, kind: "decide", howToFix: "кнопка с мёртвой ссылкой уже не показывается? проверить в боте; живую ссылку ищет человек", items });
  }

  // 10. Ожидаемые, чьё следующее проведение уже в календаре.
  {
    const items: Item[] = [];
    const toks = cal.map((r) => ({ r, t: keyTokens(r.name), c: (r.city ?? "").toLowerCase() }));
    for (const e of exp.filter((x) => x.status === "expected")) {
      const t = keyTokens(e.name), c = (e.city ?? "").toLowerCase();
      if (!e.last_date || !t.size) continue;
      const near = (d: string) => {
        const gap = (Date.parse(d) - Date.parse(e.last_date!)) / 864e5;
        return Math.abs(gap - 365) <= 60 || Math.abs(gap - 730) <= 60;
      };
      const strict = (a: Set<string>, b: Set<string>) => overlap(a, b) * Math.min(a.size, b.size) / Math.max(a.size, b.size);
      const hit = toks.find((x) => x.c === c && (!e.race_type || e.race_type === x.r.race_type) && near(x.r.date_start) && strict(t, x.t) >= 0.75);
      if (hit) items.push({ id: e.id, name: e.name, date: e.last_date ?? "", city: e.city, detail: `в календаре: ${hit.r.id} «${hit.r.name}» ${hit.r.date_start}`, fix: `status → announced, race_id = ${hit.r.id}` });
    }
    checks.push({ key: "expected", title: "Ожидаемые, уже объявленные в календаре", count: items.length, kind: "auto", howToFix: "race_expected: status=announced, race_id, announced_at (обратимо)", items });
  }

  mkdirSync(outDir, { recursive: true });
  const base = path.join(outDir, `races-audit-${today}`);
  writeFileSync(`${base}.json`, JSON.stringify({ today, total: cal.length, checks }, null, 1));
  const md = [`# Проверка стартов ${today} (${cal.length} в календаре)`, ""];
  for (const c of checks) {
    md.push(`## ${c.title}: ${c.count} (${c.kind})`, "", `Как править: ${c.howToFix}`, "");
    for (const i of c.items.slice(0, 10)) md.push(`- ${i.date} · ${i.name} (${i.city ?? "—"}) · \`${i.id}\` — ${i.detail}${i.fix ? ` → ${i.fix}` : ""}`);
    if (c.items.length > 10) md.push(`- …и ещё ${c.items.length - 10}`);
    md.push("");
  }
  writeFileSync(`${base}.md`, md.join("\n"));
  console.log(checks.map((c) => `${c.key}: ${c.count}`).join("\n"));
  console.log(`→ ${base}.md`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
