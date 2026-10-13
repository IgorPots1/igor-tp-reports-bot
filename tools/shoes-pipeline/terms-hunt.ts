/**
 * Поиск условий использования там, где гейт их не нашёл по ссылкам с главной
 * (наряд 14.10.2026, «пробуем источники вручную»).
 *
 * Проверяет стандартные адреса: /terms, /legal, /tos, /privacy, /disclaimer,
 * /about, /impressum и русские варианты, плюс ссылки из подвала главной. Всё
 * найденное складывается в .cache/terms/<id>.txt одним текстом с заголовками
 * «=== адрес ===»: читатель условий видит всё сразу, а аудит сверяет цитату с
 * этим же файлом.
 *
 * Это чтение правил сайта, а не сбор данных: только служебные страницы, с
 * паузой HOST_DELAY_MS на хост и нашим User-Agent. robots.txt соблюдается.
 *
 *   npx tsx tools/shoes-pipeline/terms-hunt.ts id1,id2,...
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { isAllowed, parseRobots } from "./lib/robots";
import { HOST_DELAY_MS, SOURCES, USER_AGENT, type Source } from "./lib/sources";
import { plainText } from "./lib/verdict-extract";

const ids = new Set((process.argv[2] ?? "").split(",").filter(Boolean));
const TERMS_DIR = resolve("tools/shoes-pipeline/.cache/terms");
const REPORT = resolve("tools/shoes-pipeline/reports/terms-hunt.json");
mkdirSync(TERMS_DIR, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PATHS = [
  "/terms",
  "/terms-of-use",
  "/terms-of-service",
  "/terms-and-conditions",
  "/terms-conditions",
  "/legal",
  "/legal-notice",
  "/tos",
  "/disclaimer",
  "/about",
  "/about-us",
  "/impressum",
  "/privacy",
  "/privacy-policy",
  "/agreement",
  "/soglashenie",
  "/polzovatelskoe-soglashenie",
  "/pravila",
  "/terms-of-use/",
  "/privacy-policy/",
];

/** Ссылки подвала, похожие на правила: шире, чем у гейта, — с privacy и about. */
const LINK = /terms|conditions|legal|\btos\b|disclaimer|privacy|about|impressum|copyright|условия|соглашени|правила|правов|конфиденциальн|о (нас|проекте|сайте)|копирайт|авторск/i;

async function get(url: string) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*;q=0.5" },
      signal: AbortSignal.timeout(20000),
      redirect: "follow",
    });
    return { http: res.status, finalUrl: res.url, body: await res.text() };
  } catch {
    return null;
  }
}

type Hunt = { id: string; tried: number; found: { url: string; chars: number }[]; stopped: string | null };

async function hunt(source: Source): Promise<Hunt> {
  const out: Hunt = { id: source.id, tried: 0, found: [], stopped: null };
  const host = new URL(source.origin).host.replace(/^www\./, "");
  const r = await get(`${source.origin}/robots.txt`);
  const robots = parseRobots(r && r.http === 200 ? r.body : "", !(r && r.http === 200));
  await sleep(HOST_DELAY_MS);

  const home = await get(`${source.origin}/`);
  out.tried++;
  // Заслон — стоп для источника, без попыток обойти.
  if (home && [403, 429].includes(home.http)) {
    out.stopped = `главная: ${home.http}`;
    return out;
  }
  const homeText = home ? plainText(home.body) : "";
  const links = new Set<string>();
  for (const m of (home?.body ?? "").matchAll(/<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    if (!LINK.test(`${m[1]} ${text}`)) continue;
    try {
      const u = new URL(m[1], source.origin);
      if (u.host.replace(/^www\./, "") === host) links.add(u.toString());
    } catch {
      /* битая ссылка */
    }
  }
  for (const p of PATHS) links.add(new URL(p, source.origin).toString());

  const pieces: string[] = [];
  // Хвост главной — там копирайт и строки вроде «использование материалов
  // только с разрешения»: это тоже условия, и без них поиск был бы неполным.
  if (homeText) pieces.push(`=== ${source.origin}/ (подвал) ===\n${homeText.slice(-1500)}`);
  const seenBodies = new Set<string>([homeText.slice(0, 2000)]);
  for (const url of [...links].slice(0, 30)) {
    const path = new URL(url).pathname;
    if (!isAllowed(robots, path, USER_AGENT).allowed) continue;
    await sleep(HOST_DELAY_MS);
    const page = await get(url);
    out.tried++;
    if (!page) continue;
    if ([403, 429].includes(page.http)) {
      out.stopped = `${path}: ${page.http}`;
      break;
    }
    if (page.http !== 200 || new URL(page.finalUrl).host.replace(/^www\./, "") !== host) continue;
    const text = plainText(page.body);
    // Несуществующий адрес часто отдаёт главную или каталог с кодом 200.
    if (text.length < 300 || seenBodies.has(text.slice(0, 2000))) continue;
    seenBodies.add(text.slice(0, 2000));
    pieces.push(`=== ${page.finalUrl} ===\n${text}`);
    out.found.push({ url: page.finalUrl, chars: text.length });
  }
  if (pieces.length) writeFileSync(resolve(TERMS_DIR, `${source.id}.txt`), pieces.join("\n\n"));
  return out;
}

const todo = SOURCES.filter((s) => ids.has(s.id));
const results: Hunt[] = [];
let cursor = 0;
// Разные хосты — пулом; внутри хоста пауза держится в hunt().
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (cursor < todo.length) {
      const s = todo[cursor++];
      const h = await hunt(s);
      results.push(h);
      console.log(`  ${s.id.padEnd(22)} страниц правил: ${h.found.length}${h.stopped ? `, СТОП: ${h.stopped}` : ""}`);
      writeFileSync(REPORT, JSON.stringify(results, null, 2) + "\n");
    }
  })
);
