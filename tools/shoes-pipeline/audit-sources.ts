/**
 * Гейт источников — три проверки, все обязательны (наряд 14.10.2026).
 *
 * Источник разрешён, только если ОДНОВРЕМЕННО:
 *   1. robots.txt не закрывает нужные пути — ни нашему агенту, ни именованным
 *      ИИ-ботам (GPTBot, ClaudeBot, CCBot, Google-Extended и т. д.): сайт,
 *      закрывшийся от ИИ, сказал своё про использование ИИ, даже если наш
 *      агент назван иначе;
 *   2. живая страница отдаёт содержимое — без капчи, 403 и пустого каркаса;
 *   3. условия использования прочитаны (lib/terms.ts) и не запрещают
 *      автоматический доступ, хранение и производные работы.
 * Не нашлись или не читаются условия — «вручную», не «открыто».
 *
 * До 14.10 гейт делал только первые две проверки, и Doctors of Running с
 * Believe in the Run прошли как открытые при прямом запрете в условиях.
 *
 *   npx tsx tools/shoes-pipeline/audit-sources.ts            — сеть + решение
 *   npx tsx tools/shoes-pipeline/audit-sources.ts --offline  — только решение
 *        по сохранённым доказательствам (после записи прочтённых условий)
 *   npx tsx tools/shoes-pipeline/audit-sources.ts --only id1,id2 [--skip-done]
 *
 * Вежливо: по хосту не чаще раза в HOST_DELAY_MS, хосты по очереди. Источник,
 * который условия уже запретили, сеть не трогает вовсе.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { isAllowed, parseRobots, type Robots } from "./lib/robots";
import { HOST_DELAY_MS, SOURCES, USER_AGENT, type Source, type TermsStatus } from "./lib/sources";
import { TERMS, TERMS_MAX_AGE_DAYS } from "./lib/terms";
import { plainText } from "./lib/verdict-extract";

const args = process.argv.slice(2);
const OFFLINE = args.includes("--offline");
const onlyArg = args.indexOf("--only");
const ONLY = onlyArg > -1 ? new Set(args[onlyArg + 1].split(",")) : null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Каталог отчётов в git не идёт, в свежем клоне его нет — создаём заранее.
const REPORTS_DIR = resolve("tools/shoes-pipeline/reports");
const TERMS_DIR = resolve("tools/shoes-pipeline/.cache/terms");
mkdirSync(REPORTS_DIR, { recursive: true });
mkdirSync(TERMS_DIR, { recursive: true });
const EVIDENCE_PATH = resolve(REPORTS_DIR, "gate-evidence.json");
const OUT_PATH = resolve(REPORTS_DIR, "source-terms.json");

/**
 * ИИ-боты, по которым сайт может закрыться отдельно от остальных. Закрыт хоть
 * для одного из них на нужном пути — проверка не пройдена: наш конвейер читает
 * страницы моделью, и это ровно то использование, от которого сайт закрылся.
 */
const AI_BOTS = [
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "Claude-Web",
  "anthropic-ai",
  "CCBot",
  "Google-Extended",
  "PerplexityBot",
  "Applebot-Extended",
  "meta-externalagent",
  "Bytespider",
  "cohere-ai",
];

/**
 * Признаки защиты от автоматов на живой странице. Сам по себе признак — не
 * заслон: скрипт reCAPTCHA стоит в форме подписки на половине магазинов, и
 * первая версия закрыла Saucony, Merrell, ANTA, Спорткульт и 361° с полной
 * страницей содержимого. Заслон — это признак ПЛЮС отказ или пустая страница.
 */
const CHALLENGE_MAX_TEXT = 3000;
const isChallenge = (l: { http: number; textChars: number; challenge: boolean }) =>
  l.challenge && (l.http !== 200 || l.textChars < CHALLENGE_MAX_TEXT);
const CHALLENGE =
  /captcha|cf-challenge|challenges\.cloudflare|Just a moment\.\.\.|verify you are (a )?human|Access Denied|Attention Required|ddos-guard|Проверка браузера|вы не робот/i;

const TERMS_LINK =
  /terms|conditions|legal|\btos\b|disclaimer|условия|соглашени|оферт|правила (пользования|использования|сайта)|копирайт|copyright/i;
const TERMS_BEST =
  /terms of (use|service)|terms and conditions|terms-of-(use|service)|terms-and-conditions|пользовательское соглашение|условия использования|правила пользования/i;

/** Ключевые слова пунктов, которые решают: доступ автоматом, хранение, производные, лицензия. */
const CLAUSE =
  /automat|robot|spider|scrap|crawl|data mining|extract|harvest|artificial intelligence|machine learning|\bAI\b|non-?commercial|personal use|derivative|compilation|reproduc|creative commons|licen[cs]e|автоматическ|робот|парс|скрап|сбор (данных|информации)|извлеч|копирова|воспроизвед|некоммерческ|личн[а-яё]+ использ|производн|переработ|искусственн|нейросет|машинн[а-яё]+ обучени|лицензи/gi;

type Evidence = {
  id: string;
  robots: {
    outcome: "parsed" | "absent" | "denied" | "unreachable";
    http: number;
    blockedPaths: string[];
    aiBlocked: string[];
    crawlDelaySec: number | null;
  };
  live: { path: string; http: number; textChars: number; challenge: boolean } | null;
  terms: { url: string | null; textChars: number; candidates: string[]; clauses: string[] } | null;
  checkedAt: string;
};

async function get(url: string): Promise<{ http: number; finalUrl: string; body: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,text/plain;q=0.9,*/*;q=0.5" },
      signal: AbortSignal.timeout(20000),
      redirect: "follow",
    });
    return { http: res.status, finalUrl: res.url, body: await res.text() };
  } catch {
    return null;
  }
}

/** Закрыт ли путь для бота ИМЕННО его собственной группой, а не общей «*». */
function aiBlocked(robots: Robots, paths: string[]): string[] {
  const out: string[] = [];
  for (const bot of AI_BOTS) {
    const named = robots.groups.some((g) => g.agents.some((a) => a.toLowerCase() === bot.toLowerCase()));
    if (!named) continue;
    if (paths.some((p) => !isAllowed(robots, p, bot).allowed)) out.push(bot);
  }
  return out;
}

function termsLinks(html: string, origin: string): string[] {
  const out: { url: string; score: number }[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    const href = m[1];
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const both = `${href} ${text}`;
    if (!TERMS_LINK.test(both) || /privacy|cookie|конфиденциальн|персональн/i.test(both)) continue;
    let url: string;
    try {
      url = new URL(href, origin).toString();
    } catch {
      continue;
    }
    if (new URL(url).host.replace(/^www\./, "") !== new URL(origin).host.replace(/^www\./, "")) continue;
    out.push({ url, score: TERMS_BEST.test(both) ? 2 : 1 });
  }
  const seen = new Set<string>();
  return out
    .sort((a, b) => b.score - a.score)
    .map((x) => x.url)
    .filter((u) => (seen.has(u) ? false : (seen.add(u), true)))
    .slice(0, 3);
}

function clausesOf(text: string): string[] {
  const out: string[] = [];
  let last = -1000;
  for (const m of text.matchAll(CLAUSE)) {
    if (m.index === undefined || m.index - last < 300) continue;
    last = m.index;
    out.push(text.slice(Math.max(0, m.index - 300), m.index + 300));
    if (out.length >= 25) break;
  }
  return out;
}

async function probe(source: Source): Promise<Evidence> {
  const ev: Evidence = {
    id: source.id,
    robots: { outcome: "unreachable", http: 0, blockedPaths: [], aiBlocked: [], crawlDelaySec: null },
    live: null,
    terms: null,
    checkedAt: new Date().toISOString(),
  };

  // 1. robots.txt. Переход должен привести на robots.txt, а не на главную.
  const r = await get(`${source.origin}/robots.txt`);
  let robots: Robots = parseRobots("", true);
  if (r) {
    ev.robots.http = r.http;
    if (!new URL(r.finalUrl).pathname.endsWith("/robots.txt")) ev.robots.outcome = "unreachable";
    else if (r.http >= 200 && r.http < 300) {
      ev.robots.outcome = "parsed";
      robots = parseRobots(r.body, false);
    } else if (r.http === 404 || r.http === 410) ev.robots.outcome = "absent";
    else if (r.http === 401 || r.http === 403) ev.robots.outcome = "denied";
  }
  if (ev.robots.outcome === "denied" || ev.robots.outcome === "unreachable") return ev;
  ev.robots.blockedPaths = source.probePaths.filter((p) => !isAllowed(robots, p, USER_AGENT).allowed);
  ev.robots.aiBlocked = aiBlocked(robots, source.probePaths);
  ev.robots.crawlDelaySec = robots.crawlDelaySec;
  if (ev.robots.blockedPaths.length > 0) return ev;
  await sleep(HOST_DELAY_MS);

  // 2. Живая страница: последний путь проверки — реальная страница с
  // содержимым (обзор, карточка), а не карта сайта.
  const livePath = source.probePaths.filter((p) => !p.endsWith(".xml")).pop() ?? "/";
  const page = await get(`${source.origin}${livePath}`);
  if (page) {
    ev.live = {
      path: livePath,
      http: page.http,
      textChars: plainText(page.body).length,
      challenge: CHALLENGE.test(page.body.slice(0, 20000)),
    };
  }
  if (!page || page.http !== 200 || (ev.live && isChallenge(ev.live))) return ev;

  // 3. Условия: ссылки из подвала главной.
  let homeHtml = page.body;
  if (livePath !== "/") {
    await sleep(HOST_DELAY_MS);
    homeHtml = (await get(`${source.origin}/`))?.body ?? page.body;
  }
  // Адрес из реестра важнее прочитанного раньше: его ставят, когда прежняя
  // страница оказалась не той (меню вместо условий, условия продажи).
  const known = source.termsUrl ?? TERMS[source.id]?.url;
  const candidates = [...new Set([...(known ? [known] : []), ...termsLinks(homeHtml, source.origin)])].slice(0, 3);
  let best: { url: string; text: string; hits: number } | null = null;
  for (const url of candidates) {
    await sleep(HOST_DELAY_MS);
    const t = await get(url);
    if (!t || t.http !== 200) continue;
    const text = plainText(t.body);
    const hits = [...text.matchAll(CLAUSE)].length;
    if (!best || hits > best.hits) best = { url, text, hits };
  }
  ev.terms = {
    url: best?.url ?? null,
    textChars: best?.text.length ?? 0,
    candidates,
    clauses: best ? clausesOf(best.text) : [],
  };
  if (best) writeFileSync(resolve(TERMS_DIR, `${source.id}.txt`), best.text);
  return ev;
}

/* --------------------------------- Решение --------------------------------- */

const norm = (s: string) =>
  s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

function decide(source: Source, ev: Evidence | undefined): { status: TermsStatus; note: string } {
  const t = TERMS[source.id];
  // Условия запретили — остальное не важно, и сеть такой источник не трогает.
  if (t?.reading === "forbids") {
    return {
      status: "forbidden",
      note: t.quote
        ? `запрещено условиями: «${t.quote}» (${t.url})`
        : t.decided_by === "igor"
          ? `исключён решением Игоря ${t.decidedAt}: ${t.note ?? ""}`
          : `закрыт: ${t.note ?? ""}`,
    };
  }
  if (!ev) return { status: "manual", note: "проверки не проводились" };

  const r = ev.robots;
  if (r.outcome === "denied") return { status: "forbidden", note: `robots.txt отдаёт ${r.http} — сайт закрыт для автоматов` };
  if (r.outcome === "unreachable") return { status: "manual", note: "robots.txt недоступен или переход увёл с него" };
  if (r.blockedPaths.length) return { status: "forbidden", note: `robots.txt закрывает: ${r.blockedPaths.join(", ")}` };
  if (r.aiBlocked.length) return { status: "forbidden", note: `robots.txt закрыт для ИИ-ботов: ${r.aiBlocked.join(", ")}` };

  if (!ev.live) return { status: "manual", note: "живая страница не ответила" };
  if (ev.live.http === 401 || ev.live.http === 403) return { status: "forbidden", note: `живая страница: ${ev.live.http}` };
  if (isChallenge(ev.live)) return { status: "forbidden", note: "живая страница: капча или защита от автоматов" };
  if (ev.live.http !== 200 || ev.live.textChars < 500) {
    return { status: "manual", note: `живая страница: ${ev.live.http}, текста ${ev.live.textChars} знаков` };
  }

  if (!t) {
    return {
      status: "manual",
      note: ev.terms?.url
        ? `условия найдены (${ev.terms.url}, ${ev.terms.textChars} знаков), но ещё не прочитаны`
        : "страница условий не найдена",
    };
  }
  if (t.reading === "unread") return { status: "manual", note: `условия не читаются: ${t.note ?? t.url}` };
  const age = (Date.now() - new Date(t.readAt).getTime()) / 86400000;
  if (age > TERMS_MAX_AGE_DAYS) return { status: "manual", note: `условия прочитаны ${Math.round(age)} дн. назад — перечитать` };
  // Условий на сайте нет после честного поиска — разрешение даёт Игорь, и это
  // видно в статусе: не «условия разрешают», а «решение Игоря».
  if (t.reading === "permits" && t.decided_by === "igor" && !t.quote) {
    return { status: "allowed", note: `условий нет после поиска — разрешён решением Игоря ${t.decidedAt}` };
  }
  // Цитата обязана стоять в сохранённом тексте условий: пересказ не проходит.
  const file = resolve(TERMS_DIR, `${source.id}.txt`);
  if (!t.quote || !existsSync(file) || !norm(readFileSync(file, "utf8")).includes(norm(t.quote))) {
    return { status: "manual", note: "цитата из условий не найдена в сохранённом тексте — перечитать" };
  }
  return { status: "allowed", note: `условия разрешают: «${t.quote}»` };
}

/* ---------------------------------- Прогон --------------------------------- */

const saved: Record<string, Evidence> = existsSync(EVIDENCE_PATH)
  ? JSON.parse(readFileSync(EVIDENCE_PATH, "utf8"))
  : {};

/**
 * Хосты проверяются пулом по POOL одновременно: у разных источников разные
 * хосты, и пауза HOST_DELAY_MS держится внутри probe() на каждый хост. Прежний
 * последовательный проход шёл полтора часа на 66 кандидатов.
 */
const POOL = 6;
const SKIP_DONE = args.includes("--skip-done");
const today = new Date().toISOString().slice(0, 10);
const todo = SOURCES.filter(
  (s) =>
    !OFFLINE &&
    (!ONLY || ONLY.has(s.id)) &&
    TERMS[s.id]?.reading !== "forbids" &&
    !(SKIP_DONE && saved[s.id]?.checkedAt.startsWith(today))
);
let cursor = 0;
await Promise.all(
  Array.from({ length: POOL }, async () => {
    while (cursor < todo.length) {
      const source = todo[cursor++];
      saved[source.id] = await probe(source);
      const e = saved[source.id];
      console.log(
        `  ${source.id.padEnd(22)} robots=${e.robots.outcome}` +
          `${e.robots.aiBlocked.length ? `, ИИ закрыт: ${e.robots.aiBlocked.length}` : ""}` +
          ` live=${e.live ? `${e.live.http}${e.live.challenge ? " капча" : ""}` : "—"} условия=${e.terms?.url ?? "—"}`
      );
      // Один процесс, одна запись: потоки пула пишут общий объект целиком.
      writeFileSync(EVIDENCE_PATH, JSON.stringify(saved, null, 2) + "\n");
    }
  })
);

const results = SOURCES.map((s) => ({
  id: s.id,
  title: s.title,
  kind: s.kind,
  origin: s.origin,
  ...decide(s, saved[s.id]),
  // Crawl-delay из robots.txt читает загрузчик: если он больше нашей паузы — ждём его.
  crawlDelaySec: saved[s.id]?.robots.crawlDelaySec ?? null,
  checkedAt: saved[s.id]?.checkedAt ?? new Date().toISOString(),
}));
writeFileSync(
  OUT_PATH,
  JSON.stringify({ userAgent: USER_AGENT, checkedAt: new Date().toISOString(), sources: results }, null, 2) + "\n"
);

const by = (st: TermsStatus) => results.filter((r) => r.status === st);
console.log(`\n${"─".repeat(70)}`);
for (const st of ["allowed", "forbidden", "manual"] as TermsStatus[]) {
  console.log(`${st.padEnd(10)} ${by(st).length}: ${by(st).map((r) => r.id).join(", ") || "—"}`);
}
console.log(`\nДоказательства: ${EVIDENCE_PATH}\nРешение: ${OUT_PATH}`);
console.log("Загрузчик берёт страницы ТОЛЬКО у источников со статусом allowed.");
