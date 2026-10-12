// race-calendar-sync: collects Russian running races from several public calendars,
// merges duplicates, marks races that disappeared, checks official-site links.
// Runs weekly (pg_cron). Protected by x-sync-key header.
import { createClient } from "npm:@supabase/supabase-js@2";
import { DOMParser, Element } from "https://deno.land/x/deno_dom@v0.1.45/deno-dom-wasm.ts";
import { buildExpected, findNextEdition, parsePastProbeg, probegPastUrl, weekWindows, type FutureRow, type PastRace } from "./expected.ts";
import { findMatch } from "./match.ts";

const UA = "igorp.run race calendar (+https://igorp.run)";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

type Race = {
  id: string; source: string; source_id: string; source_url: string; name: string;
  date_start: string; date_end: string; date_text: string; city: string; region: string; location: string;
  distances: string[]; dist_km: number[]; race_type: string; tags: string[];
  site_url: string | null; reg_url: string | null; vk_url: string | null;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function get(url: string): Promise<string> {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ru" } });
      if (r.ok) return await r.text();
      if (r.status === 429) { await sleep(8000 * (i + 1)); continue; }
      if (r.status < 500) throw new Error(`${r.status} ${url}`);
    } catch (e) { if (i === 2) throw e; }
    await sleep(1500 * (i + 1));
  }
  throw new Error("unreachable");
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const clean = (s: string | null | undefined) => (s || "").replace(/\s+/g, " ").trim();
const decode = (s: string) => s.replace(/&laquo;/g, "«").replace(/&raquo;/g, "»").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&#39;/g, "'");

// ---------- normalisation helpers ----------
const MONTHS: Record<string, number> = { "январ": 1, "феврал": 2, "март": 3, "апрел": 4, "ма": 5, "июн": 6, "июл": 7, "август": 8, "сентябр": 9, "октябр": 10, "ноябр": 11, "декабр": 12 };
function monthNum(w: string): number {
  w = w.toLowerCase();
  for (const k of Object.keys(MONTHS).sort((a, b) => b.length - a.length)) if (w.startsWith(k)) return MONTHS[k];
  return 0;
}
// "17 октября", "22 - 24 октября", "31 октября — 1 ноября" (no year) -> [start,end]
function parseRuDateNoYear(t: string, today: Date): [string, string] | null {
  const parts = t.split(/\s*[—–-]\s*/).map((p) => p.trim()).filter(Boolean);
  const m2 = parts[parts.length - 1].match(/(\d{1,2})\s+([а-яё]+)(?:\s+(\d{4}))?/i);
  if (!m2) return null;
  const endM = monthNum(m2[2]);
  const endD = +m2[1];
  const m1 = parts[0].match(/(\d{1,2})(?:\s+([а-яё]+))?/i);
  const startD = m1 ? +m1[1] : endD;
  const startM = m1 && m1[2] ? monthNum(m1[2]) : endM;
  if (!endM || !startM) return null;
  let year = m2[3] ? +m2[3] : today.getFullYear();
  const cand = new Date(Date.UTC(year, endM - 1, endD));
  if (!m2[3] && cand.getTime() < today.getTime() - 14 * 864e5) year += 1;
  const sYear = startM > endM ? year - 1 : year;
  return [iso(new Date(Date.UTC(sYear, startM - 1, startD))), iso(new Date(Date.UTC(year, endM - 1, endD)))];
}
// probeg: "31.10–01.11.2026" | "10–11.10.2026" | "01.11.2026"
function parseProbegDate(t: string): [string, string] | null {
  const m = t.match(/^(\d{2})(?:\.(\d{2}))?(?:\.(\d{4}))?\s*[–-]\s*(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) {
    const [, d1, mo1, y1, d2, mo2, y2] = m;
    return [`${y1 || y2}-${mo1 || mo2}-${d1}`, `${y2}-${mo2}-${d2}`];
  }
  const s = t.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return s ? [`${s[3]}-${s[2]}-${s[1]}`, `${s[3]}-${s[2]}-${s[1]}`] : null;
}
const FEDERAL = ["Москва", "Санкт-Петербург", "Севастополь"];
function splitLocation(loc: string): { city: string; region: string } {
  const segs = loc.split(",").map((s) => s.replace(/^(г\.|город)\s*/i, "").trim()).filter(Boolean);
  const fed = FEDERAL.find((f) => segs[0] === f);
  if (fed) return { city: fed, region: fed };
  const strip = (s: string) => s.replace(/^(д\.|с\.|c\.|п\.г\.т\.|пгт|пос\.|п\.|р\.п\.|ст\.|х\.|квартал|аул|станица|деревня|село|посёлок|поселок)\s*/i, "").trim();
  const settlements = segs.slice(1).filter((s) => !/(район|округ|г\.о\.|улус|м\.о\.|муниципальный)/i.test(s));
  const city = strip(settlements.length ? settlements[settlements.length - 1] : segs[0]);
  return { city, region: segs[0] };
}
function distToKm(d: string): number | null {
  const s = d.toLowerCase();
  if (/^марафон/.test(s)) return 42.195;
  if (/^полумарафон/.test(s)) return 21.0975;
  let m = s.match(/^(\d+(?:[.,]\d+)?)\s*км/); if (m) return +m[1].replace(",", ".");
  m = s.match(/^(\d+(?:[.,]\d+)?)\s*м(?![а-я])/); if (m) return +m[1].replace(",", ".") / 1000;
  m = s.match(/^(\d+(?:[.,]\d+)?)\s*мил/); if (m) return +m[1].replace(",", ".") * 1.609;
  return null;
}
function classify(name: string, dists: string[], extra: string, probegTrail: boolean): { race_type: string; tags: string[] } {
  const text = `${name} ${dists.join(" ")} ${extra}`.toLowerCase();
  let race_type = "road";
  if (/триатлон|дуатлон|акватлон|ironstar|iron star|swimrun|свимран|ironman|\btri\b/.test(text)) race_type = "tri";
  else if (probegTrail || /трейл|trail|кросс|cross|горн|скай|sky|вертикал|vertical|ультратрейл|скайсноу|пересеч[её]нн/.test(text)) race_type = "trail";
  else if (/шоссе/.test(text)) race_type = "road";
  else if (/манеж|в помещении|стадион|лёгкой атлетике|легкой атлетике|территория бега|скорость/.test(text) && !/марафон|полумарафон/.test(text)) race_type = "track";
  const kms = dists.map(distToKm).filter((x): x is number => x !== null);
  const tags: string[] = [];
  if (kms.some((k) => k > 42.3) || /\d+\s*час|backyard|сутк|ультра|ultra/.test(text)) tags.push("ultra");
  if (/ночн|night|полуночн/.test(text)) tags.push("night");
  if (/фестивал|fest|фест\b/.test(text)) tags.push("fest");
  if (kms.some((k) => Math.abs(k - 42.195) < 0.3)) tags.push("marathon");
  if (kms.some((k) => Math.abs(k - 21.1) < 0.3)) tags.push("half");
  return { race_type, tags };
}

// ---------- shared filters ----------
const FOREIGN = /ереван|дилижан|енокаван|гюмри|цахкадзор|армени|грузи|тбилиси|батуми|кыргыз|киргиз|бишкек|каджи-сай|бостери|чолпон|иссык|issyk|kyrgyz|казахстан|алматы|астана|шымкент|минск|беларус|брест|гомель|гродн|могил[её]в|витебск|ташкент|узбекистан|самарканд|баку|азербайджан|душанбе|париж|египет|шарм|хургад|дубай|оаэ|турци|анталь|стамбул|сербия|белград|таиланд|пхукет|вьетнам|китай|абхаз|сухум|гагр|пицунд|черногор|кипр|мальдив|шри-ланк|бали|монголи|улан-батор|dilijan|yerevan|egypt|armenia|georgia/i;
const JUNK = /абонемент|экскурс|fashion|рейв|стояни[ея] в воде|онлайн|online|виртуал|челлендж|тренировк|лагер[ья]|\bcamp\b|кемп|сборы|мастер-класс|трансфер|кубок акватлона.*дети|велогонк/i;
const okRace = (name: string, city: string) => !FOREIGN.test(`${name} ${city}`) && !JUNK.test(name);

// ---------- source: probeg.org (primary, richest) ----------
async function probeg(from: Date, to: Date): Promise<Race[]> {
  let trailIds = new Set<string>(), triIds = new Set<string>();
  for (const [k, set] of [["trails", trailIds], ["triathlon", triIds]] as const) {
    try {
      const html = await get(`https://probeg.org/calendar/${k}/`);
      for (const m of html.matchAll(/href="\/event\/(\d+)\//g)) (set as Set<string>).add(m[1]);
    } catch (_) { /* optional */ }
  }
  const out = new Map<string, Race>();
  const cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  while (cur <= to) {
    const mEnd = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 0));
    // two half-month windows keep each page small and safely under any page cap
    for (const [a, b] of [[1, 15], [16, mEnd.getUTCDate()]]) {
      const f = iso(new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth(), a)));
      const t = iso(new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth(), b)));
      const html = await get(`https://probeg.org/races/?date_region=0&country=RU&date_from=${f}&date_to=${t}&hide_parkruns=on&btnSearchSubmit=1`);
      const doc = new DOMParser().parseFromString(html, "text/html")!;
      for (const tr of doc.querySelectorAll("table tr")) {
        const tds = (tr as Element).querySelectorAll("td");
        if (tds.length < 6) continue;
        const a1 = (tds[1] as Element).querySelector('a[href^="/event/"]');
        if (!a1) continue;
        const sid = (a1.getAttribute("href")!.match(/\d+/) || [""])[0];
        const dt = parseProbegDate(clean(tds[1].textContent));
        if (!dt) continue;
        const name = clean((tds[2] as Element).querySelector("a")?.textContent);
        const location = clean(tds[3].textContent);
        // distances are plain <span>s, or <a href="/race/N/"> once results are published
        const dists = [...(tds[4] as Element).children].filter((c) =>
          (c.tagName === "SPAN" && !(c as Element).classList.contains("label")) ||
          (c.tagName === "A" && ((c as Element).getAttribute("href") || "").startsWith("/race/"))).map((c) => clean(c.textContent)).filter(Boolean);
        // races with results get an extra column, so links always live in the LAST cell
        const links = [...(tds[tds.length - 1] as Element).querySelectorAll("a")] as Element[];
        const href = (pred: (a: Element) => boolean) => { const l = links.find(pred); const h = l?.getAttribute("href"); return h && h.length < 400 ? h : null; };
        const site = href((a) => clean(a.textContent) === "Сайт");
        const reg = href((a) => clean(a.textContent) === "Регистрация");
        const vk = href((a) => /vk\.(com|ru)/.test(a.getAttribute("href") || ""));
        const { city, region } = splitLocation(location);
        const cls = classify(name, dists, "", trailIds.has(sid));
        if (triIds.has(sid)) cls.race_type = "tri";
        out.set(sid, {
          id: `probeg:${sid}`, source: "probeg", source_id: sid, source_url: `https://probeg.org/event/${sid}/`, name,
          date_start: dt[0], date_end: dt[1], date_text: clean(tds[1].textContent), city, region, location,
          distances: dists, dist_km: dists.map(distToKm).filter((x): x is number => x !== null),
          race_type: cls.race_type, tags: cls.tags, site_url: site, reg_url: reg, vk_url: vk,
        });
      }
      await sleep(1200);
    }
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return [...out.values()];
}

// ---------- source: myrace.info ----------
// list is grouped under "<span class="mr-3">YEAR</span> <span class="text-muted">Month</span>" headings
const MYRACE_OK = /бег|трейл|триатлон|акватлон|дуатлон|скай|горн|кросс|swimrun|ультра/i;
async function myrace(today: Date, horizon: Date): Promise<Race[]> {
  const out: Race[] = [];
  const seen = new Set<string>();
  let year = today.getUTCFullYear();
  for (let page = 1; page <= 60; page++) {
    const html = await get(`https://myrace.info/events${page > 1 ? `?page=${page}` : ""}`);
    const re = /<span class="mr-3">(\d{4})<\/span>|<a href="\/events\/(\d+)" class="events-list__item[\s\S]*?<div class="date">([^<]*)<\/div>\s*<div class="flag">([^<]*)<\/div>[\s\S]*?<h2>\s*([\s\S]*?)(?:<div class="registration-status">[\s\S]*?<\/div>)?\s*<\/h2>[\s\S]*?<div class="type">([^<]*)<\/div>/g;
    let fresh = 0, beyond = 0, total = 0, past = 0;
    for (const m of html.matchAll(re)) {
      if (m[1]) { year = +m[1]; continue; }
      const [, , sid, dateT, cityRaw, nameRaw, type] = m;
      total++;
      if (seen.has(sid)) continue;
      seen.add(sid); fresh++;
      // heading year applies to the END date ("17 декабря - 1 ноября 2025" style ranges carry their own year)
      const dt = parseRuDateWithYear(clean(dateT), year);
      if (!dt) continue;
      if (dt[0] > iso(horizon)) { beyond++; continue; }
      if (dt[1] < iso(today)) { past++; continue; }
      if (!MYRACE_OK.test(type)) continue;
      const city = clean(decode(cityRaw)) === "-" ? "" : clean(decode(cityRaw));
      const name = clean(decode(nameRaw.replace(/<[^>]+>/g, "")));
      if (!okRace(name, city)) continue;
      if (dt[1] < iso(today)) continue;
      if (Date.parse(dt[1]) - Date.parse(dt[0]) > 10 * 864e5) continue; // multi-week "events" are passes/series, not races
      const cls = classify(name, [], type, /трейл|скай|горн|кросс/i.test(type));
      out.push({
        id: `myrace:${sid}`, source: "myrace", source_id: sid, source_url: `https://myrace.info/events/${sid}`, name,
        date_start: dt[0], date_end: dt[1], date_text: clean(dateT), city, region: "", location: city,
        distances: [], dist_km: [], race_type: cls.race_type, tags: cls.tags,
        site_url: null, reg_url: `https://myrace.info/events/${sid}`, vk_url: null,
      });
    }
    if (!fresh || (total && (beyond === total || past === total)) || !html.includes(`/events?page=${page + 1}`)) break;
    await sleep(500);
  }
  return out;
}
function parseRuDateWithYear(t: string, headingYear: number): [string, string] | null {
  const parts = t.split(/\s*[—–-]\s*/).map((p) => p.trim()).filter(Boolean);
  const m2 = parts[parts.length - 1].match(/(\d{1,2})\s+([а-яё]+)(?:\s+(\d{4}))?/i);
  if (!m2) return null;
  const endM = monthNum(m2[2]), endD = +m2[1];
  const m1 = parts[0].match(/(\d{1,2})(?:\s+([а-яё]+))?(?:\s+(\d{4}))?/i);
  const startD = m1 ? +m1[1] : endD;
  const startM = m1 && m1[2] ? monthNum(m1[2]) : endM;
  if (!endM || !startM) return null;
  const sY = m1 && m1[3] ? +m1[3] : headingYear;
  const eY = m2[3] ? +m2[3] : (endM < startM ? sY + 1 : sY);
  return [iso(new Date(Date.UTC(sY, startM - 1, startD))), iso(new Date(Date.UTC(eY, endM - 1, endD)))];
}

// ---------- source: marathonec.ru (road + trail tables, dates with year) ----------
async function marathonec(today: Date, horizon: Date): Promise<Race[]> {
  const out = new Map<string, Race>();
  for (const page of ["calendar-beg", "kalendar-trejlovyx-zabegov-rossii"]) {
    let html = "";
    try { html = await get(`https://marathonec.ru/${page}/`); } catch (_) { continue; }
    for (const m of html.matchAll(/<tr id="post-row-(\d+)"[^>]*>([\s\S]*?)<\/tr>/g)) {
      const [, sid, row] = m;
      const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((x) => x[1]);
      if (tds.length < 4) continue;
      const d = clean(tds[0].replace(/<[^>]+>/g, "")).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (!d) continue;
      const date = `${d[3]}-${d[2]}-${d[1]}`;
      if (date < iso(today) || date > iso(horizon)) continue;
      const link = (tds[1].match(/href="([^"]+)"/) || [])[1]?.replace(/#new_tab$/, "") || "";
      const name = clean(decode(tds[1].replace(/<[^>]+>/g, "")));
      const dists = [...tds[2].matchAll(/<span[^>]*>([^<]*)<\/span>/g)].map((x) => clean(x[1]));
      const city = clean(decode(tds[3].replace(/<[^>]+>/g, "")));
      const kind = clean(tds[8] || "");
      if (!okRace(name, city) || /вся россия/i.test(city)) continue;
      const cls = classify(name, dists, kind === "trejl" ? "трейл" : "", kind === "trejl");
      const own = link.startsWith("https://marathonec.ru/");
      out.set(sid, {
        id: `marathonec:${sid}`, source: "marathonec", source_id: sid, source_url: link || `https://marathonec.ru/${page}/`, name,
        date_start: date, date_end: date, date_text: `${d[1]}.${d[2]}.${d[3]}`, city, region: "", location: city,
        distances: dists, dist_km: dists.map(distToKm).filter((x): x is number => x !== null),
        race_type: cls.race_type, tags: cls.tags,
        site_url: own ? null : (/russiarunning|toplist|myrace|reg\.|orgeo|o-time|topliga/.test(link) ? null : link || null),
        reg_url: own ? null : (/russiarunning|toplist|myrace|reg\.|orgeo|o-time|topliga/.test(link) ? link : null), vk_url: null,
      });
    }
    await sleep(800);
  }
  return [...out.values()];
}

// ---------- source: iron-star.com (triathlon series; one card per distance -> grouped per weekend+city) ----------
async function ironstar(today: Date, horizon: Date): Promise<Race[]> {
  const html = await get("https://iron-star.com/event/");
  const groups = new Map<string, { date: string; place: string; titles: string[]; slugs: string[] }>();
  for (const m of html.matchAll(/<a href="\/event\/([^"]+)" title="([^"]+)" class="event-item"/g)) {
    const [, slug, title] = m;
    const t = decode(title).match(/^(.*?) - (\d{2})\.(\d{2})\.(\d{4}) - (.*)$/);
    if (!t) continue;
    const date = `${t[4]}-${t[3]}-${t[2]}`;
    const place = clean(t[5]);
    if (date < iso(today) || date > iso(horizon) || FOREIGN.test(place) || /египет|egypt|шарм/i.test(t[1])) continue;
    const key = `${place}|${date}`;
    if (!groups.has(key)) groups.set(key, { date, place, titles: [], slugs: [] });
    const g = groups.get(key)!; g.titles.push(clean(t[1])); g.slugs.push(slug);
  }
  // a weekend festival spans consecutive days in one city: merge groups within 2 days
  const list = [...groups.values()].sort((a, b) => (a.place + a.date).localeCompare(b.place + b.date));
  const merged: { start: string; end: string; place: string; titles: string[]; slugs: string[] }[] = [];
  for (const g of list) {
    const last = merged[merged.length - 1];
    if (last && last.place === g.place && (Date.parse(g.date) - Date.parse(last.end)) <= 2 * 864e5) {
      last.end = g.date; last.titles.push(...g.titles); last.slugs.push(...g.slugs);
    } else merged.push({ start: g.date, end: g.date, place: g.place, titles: [...g.titles], slugs: [...g.slugs] });
  }
  return merged.map((g) => {
    const id = `${g.place}-${g.start}`.toLowerCase().replace(/\s+/g, "-");
    const dists = [...new Set(g.titles.map((x) => x.replace(/\s*(ВОРОНЕЖ|КАЗАНЬ|СОЧИ|ЗАВИДОВО|\d{4}).*$/i, "").trim()))];
    return {
      id: `ironstar:${id}`, source: "ironstar", source_id: id, source_url: `https://iron-star.com/event/${g.slugs[0]}`,
      name: `IRONSTAR ${g.place}`, date_start: g.start, date_end: g.end, date_text: g.start === g.end ? g.start : `${g.start}–${g.end}`,
      city: g.place, region: "", location: g.place, distances: dists, dist_km: [], race_type: "tri", tags: [],
      site_url: "https://iron-star.com/event/", reg_url: `https://iron-star.com/event/${g.slugs[0]}`, vk_url: null,
    };
  });
}


// ---------- source: orgeo.ru (official triathlon federation calendar + running/trail/athletics) ----------
const ORGEO_SKIP = /детск|младш|юнош|дюсш|школьн|ориентир|рогейн|лыж|велос|ходьб[аы] ?$/i;
function parseDottedRange(t: string): [string, string] | null {
  // "16-18.10.2026" | "17.10.2026" | "30.10-01.11.2026" | "31.12.2026-02.01.2027"
  let m = t.match(/^(\d{2})\.(\d{2})\.(\d{4})\s*[-–]\s*(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) return [`${m[3]}-${m[2]}-${m[1]}`, `${m[6]}-${m[5]}-${m[4]}`];
  m = t.match(/^(\d{2})\.(\d{2})\s*[-–]\s*(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) return [`${m[5]}-${m[2]}-${m[1]}`, `${m[5]}-${m[4]}-${m[3]}`];
  m = t.match(/^(\d{2})\s*[-–]\s*(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) return [`${m[4]}-${m[3]}-${m[1]}`, `${m[4]}-${m[3]}-${m[2]}`];
  m = t.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return m ? [`${m[3]}-${m[2]}-${m[1]}`, `${m[3]}-${m[2]}-${m[1]}`] : null;
}
// orgeo place line: "Region » District-or-city » Settlement, venue"; region is a bare adjective ("Тверская")
function orgeoPlace(segs: string[]): { city: string; region: string } {
  const r0 = segs[0] || "";
  if (FEDERAL.includes(r0)) return { city: r0, region: r0 };
  const region = r0 === "Еврейская" ? "Еврейская автономная область" : /(ская|цкая)$/i.test(r0) ? `${r0} область` : /(ский|цкий)$/i.test(r0) ? `${r0} край` : r0;
  let city = (segs[1] || r0).split(",")[0].trim();
  // second level is often a district ("Ковровский", "Зеленодольский"): find the settlement below it,
  // and fall back to "<district> район" when the third level is only a venue ("АНО ЦСП ...", "Стадион ...")
  if (/(ский|цкий|ской|ный)$/i.test(city) && segs[2]) {
    const third = segs[2].split(",")[0].trim();
    // the LAST marked settlement wins: "п. Лозовый дер. Ворошиловка" -> Ворошиловка
    const marks = [...third.matchAll(/(?:^|\s)(?:г\.|д\.|дер\.|с\.|п\.|пос\.|пгт|п\.г\.т\.|р\.п\.|ст\.|х\.|[Сс]таница|[Дд]еревня|[Сс]ело|[Пп]осёлок|[Пп]оселок)\s*([А-ЯЁ][А-Яа-яЁё-]+(?: [А-ЯЁ][а-яё-]+)?)/g)];
    const marked = marks.length ? marks[marks.length - 1] : null;
    const plain = /^[А-ЯЁ][а-яё-]+(?: [А-ЯЁа-яё][а-яё-]+)?$/.test(third) && !/стадион|парк|карьер|комплекс|ферма|база|лагер|озер/i.test(third);
    city = marked ? marked[1].trim() : plain ? third : `${city} район`;
  }
  return { city, region: region !== city ? region : "" };
}
async function orgeo(today: Date, horizon: Date): Promise<Race[]> {
  const out = new Map<string, Race>();
  const lists: [string, string][] = [["triathlon", "https://orgeo.ru/event/type/triathlon"], ["athletics", "https://orgeo.ru/event/type/athletics"]];
  for (const [kind, first] of lists) {
    for (let page = 1; page <= 8; page++) {
      const url = page === 1 ? first : `https://orgeo.ru/event/index/type/${kind}/EventView_page/${page}`;
      let html = "";
      try { html = (await get(url)).replace(/\s+/g, " "); } catch (_) { break; }
      const re = /<a href="\/event\/([^"\/]+)">(?:<div class="pull-left">.*?<\/div>)?<b class="visible-xs-inline" >([^<]+)<\/b><span class="visible-xs-inline" > - <\/span><span style="" >([^<]+)<\/span><\/a><div class="event-place">([^<]*)<\/div>(?:<span class="hint" >([^<]*)<\/span>)?/g;
      let n = 0;
      for (const m of html.matchAll(re)) {
        n++;
        const [, sid, dateT, nameRaw, placeRaw, hint] = m;
        const dt = parseDottedRange(clean(dateT));
        if (!dt || dt[1] < iso(today) || dt[0] > iso(horizon)) continue;
        const name = clean(decode(nameRaw));
        const segs = clean(decode(placeRaw)).split("»").map((x) => x.trim()).filter(Boolean);
        const { city, region } = orgeoPlace(segs);
        const text = `${name} ${hint || ""}`;
        if (!okRace(name, segs.join(" ")) || ORGEO_SKIP.test(name)) continue;
        if (kind === "athletics" && !/бег|забег|пробег|трейл|trail|кросс|марафон|ультра|скай|sky|горн|вертикал|run|миля/i.test(text)) continue;
        if (Date.parse(dt[1]) - Date.parse(dt[0]) > 10 * 864e5) continue;
        const cls = classify(name, [], `${kind === "triathlon" ? "триатлон " : ""}${hint || ""}`, false);
        if (kind === "triathlon") cls.race_type = "tri";
        out.set(sid, {
          id: `orgeo:${sid}`, source: "orgeo", source_id: sid, source_url: `https://orgeo.ru/event/${sid}`, name,
          date_start: dt[0], date_end: dt[1], date_text: clean(dateT), city, region, location: segs.join(", "),
          distances: [], dist_km: [], race_type: cls.race_type, tags: cls.tags,
          site_url: null, reg_url: `https://orgeo.ru/event/${sid}`, vk_url: null,
        });
      }
      if (!n || !html.includes(`EventView_page/${page + 1}`)) break;
      await sleep(900);
    }
  }
  return [...out.values()];
}

// ---------- source: where2run.ru (category pages with full dates; flags mark the country) ----------
async function where2run(today: Date, horizon: Date): Promise<Race[]> {
  const out = new Map<string, Race>();
  for (const cat of ["trail", "marathon", "half-marathon", "10km", "5km", "ultra"]) {
    let html = "";
    try { html = (await get(`https://where2run.ru/${cat}/`)).replace(/\s+/g, " "); } catch (_) { continue; }
    for (const card of html.split('<article class="race-card">').slice(1)) {
      const sid = (card.match(/href="\/race\/(\d+)"/) || [])[1];
      if (!sid || out.has(sid)) continue;
      if (!card.includes("🇷🇺")) continue;
      if (/Прош[её]л/.test(card)) continue;
      const name = clean(decode((card.match(/class="card-title"><a href="\/race\/\d+">([^<]+)<\/a>/) || [])[1] || ""));
      const dateT = clean((card.match(/class="tag date">[^<\d]*([^<]+)<\/span>/) || [])[1] || "");
      const cityT = clean(decode((card.match(/class="tag city">[^<А-ЯA-Z]*([^<]+)<\/span>/) || [])[1] || ""));
      const dists = [...card.matchAll(/class="tag dist">([^<]+)<\/span>/g)].map((x) => clean(x[1]));
      const reg = (card.match(/href="(https?:\/\/[^"]+)"[^>]*class="btn btn-secondary"/) || [])[1] || null;
      const dt = parseRuDateNoYear(dateT, today);
      if (!name || !dt || dt[1] < iso(today) || dt[0] > iso(horizon)) continue;
      const [city, region = ""] = cityT.split(",").map((x) => x.trim());
      if (!okRace(name, cityT)) continue;
      const cls = classify(name, dists, cat === "trail" ? "трейл" : "", cat === "trail");
      out.set(sid, {
        id: `where2run:${sid}`, source: "where2run", source_id: sid, source_url: `https://where2run.ru/race/${sid}`, name,
        date_start: dt[0], date_end: dt[1], date_text: dateT, city, region, location: cityT,
        distances: dists, dist_km: dists.map(distToKm).filter((x): x is number => x !== null),
        race_type: cls.race_type, tags: cls.tags,
        site_url: null, reg_url: reg && reg.replace(/\/$/, "").split("/").length > 3 ? reg : null, vk_url: null,
      });
    }
    await sleep(800);
  }
  return [...out.values()];
}

// ---------- source: sportsauce.ru (Siberian organisers; ISO dates) ----------
async function sportsauce(today: Date, horizon: Date): Promise<Race[]> {
  const html = (await get("https://sportsauce.ru/starts")).replace(/\s+/g, " ");
  const out: Race[] = [];
  for (const card of html.split('<article class="start-card').slice(1)) {
    const dtIso = (card.match(/<time class="start-card__date" datetime="([^"]+)"/) || [])[1];
    const sport = clean((card.match(/class="start-card__sport"[^>]*>([^<]+)</) || [])[1] || "");
    const m = card.match(/href="\/starts\/([^"]+)" class="start-card__link"[^>]*>([^<]+)<\/a>/);
    const place = clean(decode((card.match(/class="start-card__place"[^>]*>([^<]+)</) || [])[1] || ""));
    if (!m || !dtIso) continue;
    const [, slug, nameRaw] = m;
    const name = clean(decode(nameRaw));
    // datetime is UTC; the organisers are in Novosibirsk (UTC+7), so shift before taking the calendar date
    const ds = iso(new Date(Date.parse(dtIso) + 7 * 3600e3));
    if (ds < iso(today) || ds > iso(horizon)) continue;
    if (!/бег|трейл|триатлон|дуатлон|акватлон|swimrun|кросс/i.test(`${sport} ${name}`) || !okRace(name, place)) continue;
    const cls = classify(name, [], sport, /трейл|кросс/i.test(sport));
    out.push({
      id: `sportsauce:${slug}`, source: "sportsauce", source_id: slug, source_url: `https://sportsauce.ru/starts/${slug}`, name,
      date_start: ds, date_end: ds, date_text: ds, city: place, region: "", location: place,
      distances: [], dist_km: [], race_type: cls.race_type, tags: cls.tags,
      site_url: null, reg_url: `https://sportsauce.ru/starts/${slug}`, vk_url: null,
    });
  }
  return out;
}

// ---------- source: racetime.online (timing company; upcoming list) ----------
const unhex = (s: string) => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
async function racetime(today: Date, horizon: Date): Promise<Race[]> {
  const html = unhex((await get("https://racetime.online/races/List/Upcoming")).replace(/\s+/g, " "));
  const out: Race[] = [];
  for (const m of html.matchAll(/<a class="race-card" href="([^"]+)"[\s\S]*?<div class="name">\s*<span[^>]*>([^<]+)<\/span>[\s\S]*?<span class="date">([^<]+)<\/span>\s*<span>[^<]*<\/span>\s*<span>([^<]*)<\/span>/g)) {
    const [, path, nameRaw, dateT, cityRaw] = m;
    const dt = parseRuDateNoYear(clean(dateT), today);
    const name = clean(decode(nameRaw)), city = clean(decode(cityRaw));
    if (!dt || dt[1] < iso(today) || dt[0] > iso(horizon) || !okRace(name, city)) continue;
    const sid = path.replace(/^\//, "").replace(/\//g, "~");
    const cls = classify(name, [], "", false);
    out.push({
      id: `racetime:${sid}`, source: "racetime", source_id: sid, source_url: `https://racetime.online${path}`, name,
      date_start: dt[0], date_end: dt[1], date_text: clean(dateT), city, region: "", location: city,
      distances: [], dist_km: [], race_type: cls.race_type, tags: cls.tags,
      site_url: null, reg_url: `https://racetime.online${path}`, vk_url: null,
    });
  }
  return out;
}

// ---------- source: reg.place ----------
const REGPLACE_OK = /^(бег|трейл|триатлон|акватлон|дуатлон|скайраннинг|горный бег|кросс|ультра|swimrun|свимран)/i;
async function regplace(today: Date): Promise<Race[]> {
  const out: Race[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= 15; page++) {
    const html = await get(`https://reg.place/events?q%5Bscope%5D=future&page=${page}`);
    const cards = html.split('<article class="b-event-card').slice(1);
    if (!cards.length) break;
    let fresh = 0;
    for (const c of cards) {
      const slug = (c.match(/href="\/events\/([^"?\/]+)/) || [])[1];
      if (!slug || seen.has(slug)) continue;
      seen.add(slug); fresh++;
      const name = clean(decode((c.match(/b-event-card__title-link"[^>]*>([\s\S]*?)<\/a>/) || [])[1] || ""));
      const meta = (c.match(/b-event-card__meta">([\s\S]*?)<\/p>/) || [])[1] || "";
      const dateT = clean((meta.match(/<strong>([\s\S]*?)<\/strong>/) || [])[1]);
      const rest = meta.replace(/<strong>[\s\S]*?<\/strong>/, "").split(/<span class="px-2">•<\/span>/).map((s) => clean(decode(s.replace(/<[^>]+>/g, "")))).filter(Boolean);
      const sport = rest[rest.length - 1] || "";
      const city = rest.length > 1 ? rest[0] : "";
      const tags = [...c.matchAll(/b-event-card__tag"[^>]*>([^<]*)</g)].map((m) => clean(decode(m[1])));
      if (!REGPLACE_OK.test(sport) && !tags.some((t) => REGPLACE_OK.test(t))) continue;
      if (!okRace(name, city)) continue;
      const dt = parseRuDateNoYear(dateT, today);
      if (!dt) continue;
      const cls = classify(name, [], `${sport} ${tags.join(" ")}`, /трейл|скай|горн|кросс/i.test(sport));
      out.push({
        id: `regplace:${slug}`, source: "regplace", source_id: slug, source_url: `https://reg.place/events/${slug}`, name,
        date_start: dt[0], date_end: dt[1], date_text: dateT, city, region: "", location: city,
        distances: [], dist_km: [], race_type: cls.race_type, tags: cls.tags,
        site_url: null, reg_url: `https://reg.place/events/${slug}`, vk_url: null,
      });
    }
    if (!fresh) break;
    await sleep(700);
  }
  return out;
}

// ---------- source: reg.o-time.ru (Северо-Запад, все виды спорта; берём только бег: sport/2) ----------
const EN_MON: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const RU_MON_H2: Record<string, number> = { "январ": 1, "феврал": 2, "март": 3, "апрел": 4, "май": 5, "июн": 6, "июл": 7, "август": 8, "сентябр": 9, "октябр": 10, "ноябр": 11, "декабр": 12 };
function otimeRegion(r: string): string {
  r = clean(r);
  if (/^р\.\s*/i.test(r)) return "Республика " + r.replace(/^р\.\s*/i, "");
  return r.replace(/\s*обл\.?$/i, " область").replace(/\s*кр\.?$/i, " край");
}
function otimeCity(region: string, place: string): string {
  if (FEDERAL.includes(region)) return region;
  const m = place.match(/(?:^|[\s,])(?:г\.|д\.|дер\.|с\.|п\.|пос\.|пгт|р\.п\.|ст\.)\s*([А-ЯЁ][А-Яа-яЁё-]+(?: [А-ЯЁ][а-яё-]+)?)/);
  if (m) return m[1];
  return region.replace(/^Республика /, "");
}
async function otime(today: Date): Promise<Race[]> {
  let html = "";
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch("https://reg.o-time.ru/calendar", { headers: { "User-Agent": UA, "Accept-Language": "ru" } });
      if (r.ok) { html = new TextDecoder("windows-1251").decode(new Uint8Array(await r.arrayBuffer())); break; }
    } catch (e) { if (i === 2) throw e; }
    await sleep(1500 * (i + 1));
  }
  if (!html) throw new Error("o-time: empty");
  const out: Race[] = [];
  const seen = new Set<string>();
  let h2Year = 0, h2Month = 0;
  for (const sec of html.split(/<H2>/i).slice(1)) {
    const title = clean(sec.slice(0, sec.search(/<\/H2>/i)).replace(/<[^>]+>/g, " "));
    const ym = title.match(/([А-Яа-яЁё]+)\s+(\d{4})/);
    if (ym) { h2Year = +ym[2]; h2Month = Object.entries(RU_MON_H2).find(([k]) => ym[1].toLowerCase().startsWith(k))?.[1] || 0; }
    for (const day of sec.split('<div class="all">').slice(1)) {
      const dm = day.match(/<article class="alldate"><b><font[^>]*>(\d{1,2})<br><font[^>]*>([A-Za-z]{3})/);
      if (!dm) continue;
      const d = +dm[1], mo = EN_MON[dm[2].toLowerCase()];
      if (!mo) continue;
      let year = ym && h2Month === mo ? h2Year : today.getUTCFullYear();
      if (!(ym && h2Month === mo) && Date.UTC(year, mo - 1, d) < today.getTime() - 14 * 864e5) year++;
      const date = iso(new Date(Date.UTC(year, mo - 1, d)));
      if (date < iso(today)) continue;
      for (const row of day.split(/<div class="allinner\d*">/).slice(1)) {
        if (!/img\/sport\/2\.png/.test(row)) continue;
        const nm = row.match(/<article class="allname">[\s\S]*?<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
        if (!nm) continue;
        const href = decode(nm[1]);
        let name = clean(decode(nm[2].replace(/<[^>]+>/g, "")));
        if (/отмен/i.test(name)) continue;
        name = name.replace(/^\[[^\]]*\]\s*/, "").trim();
        let dateEnd = date;
        const span = name.match(/\s*\((\d{2})\.(\d{2})\s*-\s*(\d{2})\.(\d{2})\)\s*$/);
        if (span) {
          name = name.slice(0, span.index).trim();
          const ey = +span[4] < mo ? year + 1 : year;
          dateEnd = `${ey}-${span[4]}-${span[3]}`;
        }
        const pm = row.match(/<article class="allplace"><b>([\s\S]*?)<\/b>([\s\S]*?)<\/article>/);
        const region = otimeRegion(decode((pm?.[1] || "").replace(/<[^>]+>/g, "")));
        const place = clean(decode((pm?.[2] || "").replace(/<[^>]+>/g, "")));
        const city = otimeCity(region, place);
        if (!name || ORGEO_SKIP.test(name.replace(/\s+и\s+детск[\s\S]*$/i, "")) || !okRace(name, city)) continue;
        const raceId = (href.match(/reg\.o-time\.ru\/race\/(\d+)/) || [])[1];
        const sid = raceId || `${date}-${name.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, "-").slice(0, 60)}`;
        if (seen.has(sid)) continue;
        seen.add(sid);
        const icons = row.match(/<article class="allicons">([\s\S]*?)<\/article>/)?.[1] || "";
        const vk = (icons.match(/href="(https?:\/\/vk\.(?:com|ru)\/[^"]+)"/) || [])[1] || (/vk\.(com|ru)\//.test(href) ? href : null);
        const site = (icons.match(/href="(https?:\/\/[^"]+)"[^>]*><img[^>]*site\.gif/) || [])[1] || (!raceId && !/vk\.(com|ru)\//.test(href) ? href : null);
        const cls = classify(name, [], place, false);
        out.push({
          id: `otime:${sid}`, source: "otime", source_id: sid,
          source_url: raceId ? `https://reg.o-time.ru/race/${raceId}` : "https://reg.o-time.ru/calendar", name,
          date_start: date, date_end: dateEnd, date_text: dateEnd === date ? date : `${date} - ${dateEnd}`, city, region, location: [region, place].filter(Boolean).join(", "),
          distances: [], dist_km: [], race_type: cls.race_type, tags: cls.tags,
          site_url: site, reg_url: raceId ? `https://reg.o-time.ru/race/${raceId}` : null, vk_url: vk,
        });
      }
    }
  }
  return out;
}

// ---------- source: heroleague.ru (Лига Героев: Забег.РФ, «Дорога жизни»; только бег) ----------
// Открытый JSON сайта (robots.txt разрешает всё). start_time приходит в UTC без «Z»: дату старта
// считаем в timezone самой записи, иначе дальневосточные старты съедут на день назад.
// Гонка Героев, Зима, Urban, MudRun - забеги с препятствиями (OCR): отсеиваем по типу и описанию,
// и вдобавок оставляем только записи с беговыми дистанциями (у OCR их в форматах нет).
const HERO_OCR = /гонк[аи] геро|препятств|испытани|ocr|mud|urban|gonka|zima/i;
// Серии Лиги, которые всегда бег: у них старт берём и без дистанций (Воронеж Забег.РФ регистрирует на RussiaRunning).
const HERO_RUN = new Set(["zabeg", "doroga"]);
function heroLocalDate(utc: string, tz: string): string {
  const d = new Date(/Z|[+-]\d\d:?\d\d$/.test(utc) ? utc : `${utc}Z`);
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "Europe/Moscow" }).format(d); }
  catch (_) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(d); }
}
function heroPlace(address: string): { city: string; region: string; location: string } {
  const segs = clean(address).split(",").map((s) => s.trim()).filter(Boolean);
  if (!segs.length) return { city: "", region: "", location: "" };
  if (FEDERAL.includes(segs[0])) return { city: segs[0], region: segs[0], location: segs.join(", ") };
  if (/(область|край|республика|округ)/i.test(segs[0])) return { city: segs[1] || segs[0], region: segs[0], location: segs.join(", ") };
  return { city: segs[0], region: "", location: segs.join(", ") };
}
async function heroleague(today: Date, horizon: Date): Promise<Race[]> {
  const headers = { "User-Agent": UA, "Accept-Language": "ru", "Content-Type": "application/json" };
  const body = JSON.stringify({ city: { id: 0 }, date_from: `${iso(today)}T00:00:00.000Z`, date_to: `${iso(horizon)}T23:59:59.000Z` });
  let list: any[] = [];
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch("https://heroleague.ru/api/event_city/filtered", { method: "POST", headers, body });
      if (r.ok) { list = ((await r.json()) as { values?: any[] }).values || []; break; }
      if (r.status < 500) throw new Error(`heroleague: ${r.status}`);
    } catch (e) { if (i === 2) throw e; }
    await sleep(1500 * (i + 1));
  }
  const out: Race[] = [];
  for (const x of list) {
    const et = x.event_type || {};
    const ev = x.event || {};
    const text = `${et.public_id || ""} ${et.title || ""} ${et.description || ""} ${ev.title || ""} ${ev.title_above || ""} ${ev.description || ""}`;
    if (!x.public_id || !x.start_time || x.public === false || HERO_OCR.test(text)) continue;
    const date = heroLocalDate(x.start_time, x.timezone);
    if (date < iso(today) || date > iso(horizon)) continue;
    // «XI Всероссийский полумарафон «Забег.РФ»», а не голое «Забег.РФ»: в голом нет ни одного слова, по
    // которому склейка узнаёт probeg-строку того же города, и в больших городах старт задвоился бы.
    const above = clean(ev.title_above || "");
    const title = clean(ev.title || et.title || "");
    const name = above && above.length <= 40 && /марафон|забег|пробег/i.test(above) ? `${above} «${title}»` : title;
    const { city, region, location } = heroPlace(x.address || "");
    if (!name || !okRace(name, city)) continue;
    await sleep(700);
    let formats: any[] = [];
    try { formats = ((JSON.parse(await get(`https://heroleague.ru/api/event_format/event/${encodeURIComponent(x.public_id)}`)) as { values?: any[] }).values) || []; }
    catch (_) { formats = []; }
    // Дистанция в метрах, а если поле пустое («Дорога жизни») - из названия формата «42,2 км».
    const meters = [...new Set(formats.filter((f) => f.enabled !== false).flatMap((f) => {
      const m = (f.distances || []).map((d: { distance?: number }) => Number(d.distance) || 0).filter((v: number) => v > 0);
      const t = String(f.title || "").match(/(\d+(?:[.,]\d+)?)\s*км/i);
      return m.length ? m : t ? [Math.round(Number(t[1].replace(",", ".")) * 1000)] : [];
    }))].sort((a, b) => b - a);
    if (!meters.length && !HERO_RUN.has(et.public_id)) continue; // без беговой дистанции: OCR или формат без бега
    const dist_km = meters.map((m) => Math.round(m / 10) / 100);
    const distances = dist_km.map((k) => `${String(k).replace(".", ",")} км`);
    const page = x.external_url || (et.public_id === "zabeg" && city ? `https://xn--80acghh.xn--p1ai/${encodeURIComponent(city)}` : (et.project?.link || ev.external_url || "https://heroleague.ru"));
    const cls = classify(name, distances, `${ev.title_above || ""}`, false);
    out.push({
      id: `heroleague:${x.public_id}`, source: "heroleague", source_id: x.public_id, source_url: page, name,
      date_start: date, date_end: date, date_text: date, city, region, location,
      distances, dist_km, race_type: cls.race_type, tags: cls.tags,
      site_url: et.project?.link || null, reg_url: page, vk_url: null,
    });
  }
  return out;
}

// ---------- source: reg.russiarunning.com (RussiaRunning: регистрация на старты по всей России) ----------
// robots.txt reg.russiarunning.com: «Allow: /». russiarunning.com (без reg.) НЕ трогаем: там /events и
// /event/* закрыты. Страница reg.*/event/<code> - пустая оболочка SPA, данные приходят из того же
// POST /api/events/list, что и список: EventsLoaderType 0 = предстоящие (2 = прошедшие, 3 = онлайн).
// Список отдаёт всё нужное разом (название, даты, адрес, дистанции): ~2 запроса на прогон вместо
// ~190 страниц, поэтому кэша по slug нет - постраничных запросов нет вовсе. Сверено 12.10.2026:
// 189 предстоящих + 74 онлайн + 2 текущих = 265 /event/ в sitemap, т.е. список полный.
const RR_RUN = new Set(["run", "trail", "run-relay", "triathlon", "triathlon-relay", "aquathlon", "duathlon", "swimrun"]);
const RR_TRI = new Set(["triathlon", "triathlon-relay", "aquathlon", "duathlon", "swimrun"]);
// страна - из адреса события (адрес в формате ФИАС: «188300, Россия, Ленинградская обл, ..., г Гатчина»)
const RR_ABROAD = /словени|испани|турци|оаэ|эмират|черногори|корея|итали|саудов|кени|серби|египет|австри|катар|япони|швеци|португал|чехи|германи|армени|монголи|венгри|дани|британ|швейцар|франци|латви|литв|эстони|финлянд|польш|кипр|грузи|абхаз|казахстан|беларус|узбекистан|кыргыз|киргиз|таджикистан|азербайджан|таиланд|вьетнам|китай|индонези|мальдив|шри-ланк/i;
const RR_REGION = /(^|\s)(обл|край|респ|АО|Аобл|автономный округ|Автономный округ)(\s|$)|^г (Москва|Санкт-Петербург|Севастополь)$/;
// детские лиги и старты, OCR, туры с проживанием, тренировки - не старт для календаря
const RR_SKIP = /рогейн|ориентир|квест|тренировк|спортпакет|спорт-пакет|(^|[\s«"])тур[- ]|экспедици|детск|юниорск|препятстви/i;
// фан-форматы по мультфильмам и персонажам, пробежки с медалью - не старт для календаря (Игорь 12.10.2026)
const RR_FUN = /пробежк[аи] с медал|^пробежка\b|пробежка\s*[«"]|мульти[\s_-]*сери|кино[\s_-]*сери|мультфильм|дисней|disney|зверополис|zootopia|джуди\s*хопс|ник\s*уайлд|nik\s*wi?l?de|белоснежк|бэмби|бемби|золушк|холодное сердце|щенячий патруль|смешарик|фиксик|маша и медвед|человек[\s-]паук|супергеро|принцесс/i;
const RR_KIDS = /\d+\s*[-–]\s*\d+\s*лет|до \d+ лет|дет|ребен|малыш/i;
function rrRegion(seg: string): string {
  const s = clean(seg);
  const fed = s.match(/^г (Москва|Санкт-Петербург|Севастополь)$/);
  if (fed) return fed[1];
  if (/^респ\s+/i.test(s)) return "Республика " + s.replace(/^респ\s+/i, "");
  return s.replace(/\s+обл$/i, " область").replace(/\s+Аобл$/, " автономная область").replace(/\s+респ$/i, " Республика").replace(/\s+АО$/, " автономный округ");
}
function rrPlace(address: string, place: string): { city: string; region: string; location: string } {
  const segs = clean(address).split(",").map((x) => x.trim()).filter((x) => x && !/^\d{3,6}( \d{2})?$/.test(x) && x !== "Россия");
  const region = segs.length && RR_REGION.test(segs[0]) ? rrRegion(segs[0]) : "";
  let city = "", district = "";
  const kept: string[] = region ? [region] : [];
  for (const seg of segs.slice(region ? 1 : 0)) {
    const m = seg.match(/^(г|пгт|рп|с|д|п|пос|х|ст-ца|аул|м-в|дп|кп|сл|село|деревня|поселок|посёлок)\.?\s+([А-ЯЁA-Z].*)$/);
    if (m) { city = m[2].trim(); kept.push(seg); continue; }
    const r = seg.match(/^(.+?)\s+р-н$/);
    if (r && !city) { district = `${r[1]} район`; kept.push(seg); continue; }
    if (/^(ул|пр-кт|пр-д|пер|ш|наб|б-р|пл|туп|аллея|ал|д|зд|стр|к|кв|влд|тер|мкр|км|парк|р-н)\.?\s/.test(seg)) break;
  }
  // Москва/Петербург/Севастополь: город - сам субъект («г Москва, г Зеленоград» -> Москва), как в splitLocation
  if (FEDERAL.includes(region)) return { city: region, region, location: kept.join(", ") };
  if (!city) {
    // адреса без населённого пункта («Нижегородская обл»): город из свободного поля place, иначе район
    const p = clean(place).split(",")[0].replace(/^(г\.|город)\s*/i, "").trim();
    city = p && !/област|край|респ|округ|россия/i.test(p) && p.length <= 40 ? p : district;
  }
  return { city, region: region !== city ? region : "", location: kept.length ? kept.join(", ") : clean(place) };
}
async function russiarunning(today: Date, horizon: Date, maxRequests = 300): Promise<Race[]> {
  const headers = { "User-Agent": UA, "Accept-Language": "ru", "Content-Type": "application/json" };
  let requests = 0;
  async function page(skip: number): Promise<{ list: any[]; totalCount: number }> {
    for (let i = 0; i < 3; i++) {
      if (requests >= maxRequests) throw new Error(`russiarunning: лимит ${maxRequests} запросов`);
      if (requests > 0) await sleep(1100); // не чаще раза в секунду, включая повторы
      requests++;
      try {
        const r = await fetch("https://reg.russiarunning.com/api/events/list", {
          method: "POST", headers,
          body: JSON.stringify({ Page: { Skip: skip, Take: 100 }, Filter: { EventsLoaderType: 0 }, Language: "ru" }),
        });
        if (r.ok) { const j = await r.json(); return { list: j.list || [], totalCount: Number(j.totalCount) || 0 }; }
        if (r.status === 429) { await sleep(8000 * (i + 1)); continue; }
        if (r.status < 500) throw new Error(`russiarunning: ${r.status}`);
      } catch (e) { if (i === 2) throw e; }
      await sleep(1500 * (i + 1));
    }
    throw new Error("russiarunning: unreachable");
  }
  const events: any[] = [];
  for (let skip = 0; skip < 3000; skip += 100) {
    const { list, totalCount } = await page(skip);
    events.push(...list);
    if (!list.length || events.length >= totalCount) break;
  }
  const out = new Map<string, Race>();
  for (const x of events) {
    const code = clean(x.code);
    if (!code || !x.beginDate) continue;
    const items = (x.raceItems || []).filter((r: any) => !r.isVirtualRace && RR_RUN.has(r.disciplineCode));
    if (!items.length && !RR_RUN.has(x.disciplineCode)) continue; // лыжи, вело, OCR, плавание, сувениры
    // только детские забеги («6-9 лет», «10-13 лет») - не старт для календаря
    if (items.length && items.every((r: any) => RR_KIDS.test(String(r.name || "")))) continue;
    const address = clean(x.address), placeT = clean(x.place);
    if (RR_ABROAD.test(`${address} ${placeT}`) || FOREIGN.test(`${placeT} ${address}`)) continue;
    const { city, region, location } = rrPlace(address, placeT);
    if (!region && !city) continue; // страну не определить - не берём
    const name = clean(decode(String(x.title || "")).replace(/\p{Extended_Pictographic}|️|\^/gu, "")).replace(/\s*\/\s*$/, "");
    if (!name || !okRace(name, `${city} ${placeT}`) || RR_SKIP.test(name) || RR_FUN.test(name) || /online|онлайн/i.test(placeT)) continue;
    // beginDate/endDate - МЕСТНОЕ время с ложным «Z» (Крымский марафон 00:00Z-23:59Z, Челябинский
    // 00:00Z-23:59Z при timeZoneOffset 5): дату берём как есть, сдвиг на пояс увёл бы её на день.
    const date_start = String(x.beginDate).slice(0, 10), date_end = x.endDate ? String(x.endDate).slice(0, 10) : date_start;
    if (date_end < iso(today) || date_start > iso(horizon) || date_end < date_start) continue;
    if (Date.parse(date_end) - Date.parse(date_start) > 10 * 864e5) continue; // абонементы и серии, не старт
    const kms = [...new Set(items.map((r: any) => Math.round(Number(r.distance) * 1000) / 1000).filter((k: number) => k > 0))].sort((a, b) => b - a) as number[];
    const distances = kms.map((k) => `${String(k).replace(".", ",")} км`);
    const runItems = items.filter((r: any) => r.disciplineCode === "run" || r.disciplineCode === "trail");
    const trail = x.disciplineCode === "trail" || (runItems.length > 0 && runItems.filter((r: any) => r.disciplineCode === "trail").length * 2 >= runItems.length);
    const cls = classify(name, distances, String(x.sportSeriesTitle || ""), trail);
    if (RR_TRI.has(x.disciplineCode) || (items.length && items.every((r: any) => RR_TRI.has(r.disciplineCode)))) cls.race_type = "tri";
    const url = `https://reg.russiarunning.com/event/${encodeURIComponent(code)}`;
    out.set(code, {
      id: `russiarunning:${code}`, source: "russiarunning", source_id: code, source_url: url, name,
      date_start, date_end, date_text: date_start === date_end ? date_start : `${date_start} - ${date_end}`, city, region, location,
      distances, dist_km: kms, race_type: cls.race_type, tags: cls.tags,
      site_url: null, reg_url: url, vk_url: null,
    });
  }
  return [...out.values()];
}

// ---------- duplicate detection across sources: см. ./match.ts ----------

// ---------- link checking ----------
async function checkLinks(limit: number) {
  const { data } = await sb.from("race_events").select("id,site_url,reg_url")
    .eq("status", "active").gte("date_end", iso(new Date()))
    .or(`link_checked_at.is.null,link_checked_at.lt.${new Date(Date.now() - 6 * 864e5).toISOString()}`)
    .limit(limit);
  let ok = 0, bad = 0;
  const queue = (data || []).filter((r) => r.site_url || r.reg_url);
  async function one(r: { id: string; site_url: string | null; reg_url: string | null }) {
    const url = r.site_url || r.reg_url!;
    let good = false;
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
      const res = await fetch(url, { method: "GET", redirect: "follow", signal: ctl.signal, headers: { "User-Agent": UA } });
      clearTimeout(t); good = res.status < 400 || res.status === 403 || res.status === 429; // 403/429 = alive, just bot-protected
      try { await res.body?.cancel(); } catch (_) { /* */ }
    } catch (_) { good = false; }
    good ? ok++ : bad++;
    await sb.from("race_events").update({ link_ok: good, link_checked_at: new Date().toISOString() }).eq("id", r.id);
  }
  for (let i = 0; i < queue.length; i += 8) await Promise.all(queue.slice(i, i + 8).map(one));
  return { checked: queue.length, ok, bad };
}

// ---------- main ----------
// The weekly job runs in stages because one edge invocation gets ~2s of CPU:
//   ?stage=scrape&sources=a,b  -> fetch those calendars, upsert their rows, retire rows they no longer list
//   ?stage=merge               -> link duplicates across sources (reads rows from the DB)
//   ?stage=links               -> check that organiser sites answer
//   ?stage=expected            -> last year's races without a next edition yet -> race_expected
// merge order: richer sources first, so a race seen in several places keeps the most detailed row
// russiarunning - последним: новый источник не меняет уже сложившиеся склейки остальных.
// russiarunning в бою с 12.10.2026: cron race-calendar-scrape-russiarunning, воскресенье 22:29 UTC.
const SECONDARY = ["marathonec", "ironstar", "orgeo", "where2run", "myrace", "sportsauce", "racetime", "regplace", "otime", "heroleague", "russiarunning"];
const SCRAPERS: Record<string, (today: Date, horizon: Date) => Promise<Race[]>> = {
  probeg: (t, h) => probeg(t, h), marathonec: (t, h) => marathonec(t, h), ironstar: (t, h) => ironstar(t, h),
  orgeo: (t, h) => orgeo(t, h), where2run: (t, h) => where2run(t, h), myrace: (t, h) => myrace(t, h),
  sportsauce: (t, h) => sportsauce(t, h), racetime: (t, h) => racetime(t, h), regplace: (t) => regplace(t),
  otime: (t) => otime(t), heroleague: (t, h) => heroleague(t, h),
  russiarunning: (t, h) => russiarunning(t, h),
};

async function scrapeStage(sources: string[], today: Date, horizon: Date, stats: Record<string, unknown>) {
  for (const src of sources) {
    const fn = SCRAPERS[src];
    if (!fn) { stats[src] = "unknown source"; continue; }
    const t0 = new Date();
    let rows: Race[];
    try { rows = await fn(today, horizon); }
    catch (e) { stats[src] = `error: ${String(e).slice(0, 200)}`; continue; }
    const now = new Date().toISOString();
    // new rows start unmerged; existing rows keep their merge fields until the merge stage recomputes them
    const { data: existing } = await sb.from("race_events").select("id").eq("source", src);
    const known = new Set((existing || []).map((r) => r.id));
    const fresh = rows.filter((r) => !known.has(r.id)).map((r) => ({ ...r, status: "active", last_seen: now, merged_into: null, confirmed_by: [], alt_dates: [] }));
    const seen = rows.filter((r) => known.has(r.id)).map((r) => ({ ...r, status: "active", last_seen: now }));
    for (const batch of [fresh, seen]) for (let i = 0; i < batch.length; i += 200) {
      const { error } = await sb.from("race_events").upsert(batch.slice(i, i + 200), { onConflict: "id", ignoreDuplicates: false });
      if (error) throw new Error(`upsert ${src}: ${error.message}`);
    }
    // races a source stopped listing are retired (cancelled, moved, deleted); never for an empty scrape
    let removed = 0;
    if (rows.length) {
      let q = sb.from("race_events").update({ status: "removed" }).eq("source", src).eq("status", "active")
        .lt("last_seen", t0.toISOString()).gte("date_start", iso(today));
      if (src === "probeg") q = q.lte("date_start", iso(horizon));
      const { data, error } = await q.select("id");
      if (error) throw new Error(`remove ${src}: ${error.message}`);
      removed = (data || []).length;
    }
    stats[src] = { rows: rows.length, new: fresh.length, removed };
  }
}

async function mergeStage(today: Date, stats: Record<string, unknown>) {
  const all: (Race & { merged_into: string | null; confirmed_by: string[]; alt_dates: string[] })[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("race_events")
      .select("id,source,name,date_start,date_end,city,region,location,race_type,merged_into,confirmed_by,alt_dates")
      .eq("status", "active").gte("date_end", iso(today)).range(from, from + 999);
    if (error) throw new Error(`load: ${error.message}`);
    all.push(...((data || []) as any[]));
    if (!data || data.length < 1000) break;
  }
  const pool: Race[] = all.filter((r) => r.source === "probeg" || r.source === "manual") as any;
  const confirm = new Map<string, Set<string>>();
  const altDates = new Map<string, Set<string>>();
  const mergedInto = new Map<string, string | null>();
  const kept: Race[] = [];
  let merged = 0, conflicts = 0;
  for (const src of SECONDARY) {
    for (const s of all.filter((r) => r.source === src) as any as Race[]) {
      let [p, kind] = findMatch(pool, s);
      if (!p) [p, kind] = findMatch(kept.filter((x) => x.source !== src), s);
      if (p) {
        merged++; if (kind === 2) conflicts++;
        mergedInto.set(s.id, p.id);
        if (!confirm.has(p.id)) confirm.set(p.id, new Set());
        confirm.get(p.id)!.add(src);
        if (kind === 2) { if (!altDates.has(p.id)) altDates.set(p.id, new Set()); altDates.get(p.id)!.add(`${src}:${s.date_start}`); }
      } else { mergedInto.set(s.id, null); kept.push(s); }
    }
  }
  // write only rows whose merge fields actually change
  const changes: { id: string; merged_into: string | null; confirmed_by: string[]; alt_dates: string[] }[] = [];
  for (const r of all) {
    const mi = r.source === "probeg" || r.source === "manual" ? null : (mergedInto.get(r.id) ?? null);
    const cb = [...(confirm.get(r.id) || [])].sort();
    const ad = [...(altDates.get(r.id) || [])].sort();
    if (mi !== r.merged_into || JSON.stringify(cb) !== JSON.stringify([...(r.confirmed_by || [])].sort()) || JSON.stringify(ad) !== JSON.stringify(r.alt_dates || []))
      changes.push({ id: r.id, merged_into: mi, confirmed_by: cb, alt_dates: ad });
  }
  for (let i = 0; i < changes.length; i += 300) {
    const { error } = await sb.rpc("race_apply_merge", { changes: changes.slice(i, i + 300) });
    if (error) throw new Error(`apply: ${error.message}`);
  }
  Object.assign(stats, { rows: all.length, merged, date_conflicts: conflicts, changed: changes.length });
}

// ---------- expected: прошлогодние старты без даты следующего проведения ----------
// Обходит probeg по неделям за последние 380 дней (таблица режется на 100 строках — такую неделю
// дробит по дням), сравнивает с календарём и пишет race_expected. Строки announced/dropped не трогает,
// expected → announced, когда в календаре нашлось следующее проведение; давно прошедшие → dropped.
async function expectedStage(today: Date, stats: Record<string, unknown>) {
  const yesterday = iso(new Date(today.getTime() - 864e5));
  const from = iso(new Date(today.getTime() - 380 * 864e5));
  const past = new Map<string, PastRace>();
  let capped = 0;
  for (const [a, b] of weekWindows(from, yesterday)) {
    let rows = parsePastProbeg(await get(probegPastUrl(a, b)));
    if (rows.length >= 100) {
      capped++;
      rows = [];
      for (let t = Date.parse(a); t <= Date.parse(b); t += 864e5) {
        const d = iso(new Date(t));
        rows.push(...parsePastProbeg(await get(probegPastUrl(d, d))));
        await sleep(800);
      }
    }
    for (const r of rows) past.set(r.sid, r);
    await sleep(800);
  }
  const future: FutureRow[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from("race_calendar").select("id,name,date_start,city,region").gte("date_start", iso(today)).range(f, f + 999);
    if (error) throw new Error(`calendar: ${error.message}`);
    future.push(...((data || []) as FutureRow[]));
    if (!data || data.length < 1000) break;
  }
  const { data: existingRows, error: exErr } = await sb.from("race_expected").select("id,name,city,last_date,status");
  if (exErr) throw new Error(`race_expected: ${exErr.message}`);
  const existing = new Map((existingRows || []).map((r) => [r.id as string, r]));
  const { expected, announced } = buildExpected([...past.values()], future);
  const now = new Date().toISOString();
  // Новые и ещё ожидаемые — обновить; announced/dropped не трогать.
  const upserts = expected
    .filter((e) => !existing.has(e.id) || existing.get(e.id)!.status === "expected")
    .map((e) => ({ ...e, status: "expected", seen_at: now, updated_at: now }));
  for (let i = 0; i < upserts.length; i += 300) {
    const { error } = await sb.from("race_expected").upsert(upserts.slice(i, i + 300), { onConflict: "id" });
    if (error) throw new Error(`upsert expected: ${error.message}`);
  }
  // Объявленные: и из прохода, и среди уже ожидаемых строк, которых в проходе нет.
  const toAnnounce = new Map(announced.filter((a) => existing.get(a.id)?.status === "expected").map((a) => [a.id, a.race_id]));
  for (const r of existingRows || []) {
    if (r.status !== "expected" || toAnnounce.has(r.id as string)) continue;
    const next = findNextEdition({ name: r.name as string, city: (r.city as string) || "", date: r.last_date as string }, future);
    if (next) toAnnounce.set(r.id as string, next.id);
  }
  for (const [id, race_id] of toAnnounce) {
    const { error } = await sb.from("race_expected").update({ status: "announced", race_id, announced_at: now, updated_at: now }).eq("id", id).eq("status", "expected");
    if (error) throw new Error(`announce ${id}: ${error.message}`);
  }
  const dropBefore = iso(new Date(today.getTime() - 400 * 864e5));
  const { data: dropped, error: dErr } = await sb.from("race_expected").update({ status: "dropped", updated_at: now })
    .eq("status", "expected").lt("last_date", dropBefore).select("id");
  if (dErr) throw new Error(`drop: ${dErr.message}`);
  Object.assign(stats, { past: past.size, capped_weeks: capped, expected: expected.length, written: upserts.length, announced: toAnnounce.size, dropped: (dropped || []).length });
}

Deno.serve(async (req) => {
  const { data: cfg } = await sb.from("race_sync_config").select("value").eq("key", "sync_key").single();
  if (!cfg?.value || req.headers.get("x-sync-key") !== cfg.value) return new Response("forbidden", { status: 403 });
  const params = new URL(req.url).searchParams;
  const stage = params.get("stage") || (params.get("links") === "1" ? "links" : "scrape");
  const sources = (params.get("sources") || "").split(",").filter(Boolean);
  const { data: run } = await sb.from("race_sync_runs").insert({ stats: { stage, sources } }).select("id").single();
  const started = new Date();
  const stats: Record<string, unknown> = { stage, sources };
  try {
    const today = new Date(Date.UTC(started.getUTCFullYear(), started.getUTCMonth(), started.getUTCDate()));
    // rolling horizon: today .. end of next calendar year
    const horizon = new Date(Date.UTC(today.getUTCFullYear() + 1, 11, 31));
    if (stage === "scrape") await scrapeStage(sources.length ? sources : ["probeg"], today, horizon, stats);
    else if (stage === "merge") await mergeStage(today, stats);
    else if (stage === "links") stats.links = await checkLinks(Number(params.get("limit") || 150));
    else if (stage === "expected") await expectedStage(today, stats);
    await sb.from("race_sync_runs").update({ finished_at: new Date().toISOString(), stats }).eq("id", run!.id);
    return new Response(JSON.stringify(stats), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    await sb.from("race_sync_runs").update({ finished_at: new Date().toISOString(), stats, error: String(e) }).eq("id", run!.id);
    return new Response(JSON.stringify({ error: String(e), stats }), { status: 500 });
  }
});
