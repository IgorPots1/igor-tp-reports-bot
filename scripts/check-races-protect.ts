/**
 * Защита календаря забегов от выкачивания (наряд 20.10.2026). Без сети и базы: счётчик частоты
 * подменён на память с той же логикой, что race_guard_hit.
 *
 *   npm run check:races-protect
 *
 * Что держит:
 *  - поисковики и превью (Googlebot, YandexBot, bingbot, TelegramBot, facebookexternalhit, Twitterbot)
 *    не получают 429 и не закрыты в robots.txt;
 *  - скрипт на 200 запросов в минуту с одного IP получает 429 начиная с 61-го;
 *  - адреса мини-приложения без подписи, с чужой или суточной давности подписью — 401;
 *  - в HTML /races нет ссылок на страницы-источники, прошлые проведения, «Важного»;
 *  - публичный ключ Supabase нигде в коде не используется;
 *  - миграция отзыва прав закрывает все race_* и обе функции.
 */

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { NextRequest } from "next/server";

import robots from "@/app/robots";
import { publicRace, toRace, type RaceRow } from "@/app/races/races-logic";
import { publicExpected, expectedDate, expectedDateMd, type ExpectedItem } from "@/features/races-bot/core";
import { AI_ASSISTANT_BOTS, AI_TRAINING_BOTS } from "@/features/race-guard/ai-bots";
import { COPYRIGHT_HEADERS, COPYRIGHT_TEXT, LIMITS, clientIp, decide, goodBot, maskIp } from "@/features/race-guard/guard";
import { checkInitData, requireMiniapp } from "@/features/race-guard/miniapp-auth";
import { copyLines, guardSummary, isOwnUrl, subnetOf } from "@/features/race-guard/weekly";
import phrases from "@/features/race-guard/copy-phrases.json";
import { middleware } from "@/middleware";

const UA = {
  googlebot: "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.175 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  yandex: "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)",
  bing: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36",
  telegram: "TelegramBot (like TwitterBot)",
  facebook: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  twitter: "Twitterbot/1.0",
  chrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  python: "python-requests/2.32.3",
  gptbot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)",
};

let failures = 0;
function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`ok   ${name}`))
    .catch((e) => {
      failures++;
      console.error(`FAIL ${name}\n     ${e instanceof Error ? e.message : String(e)}`);
    });
}

/* Счётчик в памяти вместо Supabase: та же схема, что race_guard_hit (минута и час по ключу). */
const counters = new Map<string, number>();
const logged: { p_kind: string; p_ip_masked: string; p_ua: string; p_path: string }[] = [];
const realFetch = globalThis.fetch;
function installFakeDb() {
  process.env.SUPABASE_URL = "https://db.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (url.endsWith("/rpc/race_guard_hit")) {
      const m = `${body.p_bucket}|m`;
      const h = `${body.p_bucket}|h`;
      counters.set(m, (counters.get(m) ?? 0) + 1);
      counters.set(h, (counters.get(h) ?? 0) + 1);
      return Response.json([{ n_min: counters.get(m), n_hour: counters.get(h) }]);
    }
    if (url.endsWith("/rpc/race_guard_log_add")) {
      logged.push(body);
      return new Response(null, { status: 204 });
    }
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;
}

const waitUntil: Promise<unknown>[] = [];
const event = { waitUntil: (p: Promise<unknown>) => waitUntil.push(p) } as unknown as Parameters<typeof middleware>[1];

async function hitPage(pathname: string, ip: string, ua: string, headers: Record<string, string> = {}): Promise<number> {
  const req = new NextRequest(`https://igorp.run${pathname}`, { headers: { "x-forwarded-for": `${ip}, 10.0.0.1`, "user-agent": ua, ...headers } });
  const res = await middleware(req, event);
  return res.status;
}

function signedInitData(token: string, userId: number, authDate: number): string {
  const p = new URLSearchParams({ auth_date: String(authDate), query_id: "AAE", user: JSON.stringify({ id: userId, first_name: "Тест" }) });
  const check = [...p.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  p.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return p.toString();
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

async function main() {
  installFakeDb();

  await check("поисковики и превью узнаются по User-Agent, обычный браузер и GPTBot — нет", () => {
    for (const k of ["googlebot", "yandex", "bing", "telegram", "facebook", "twitter"] as const) assert.ok(goodBot(UA[k]), `${k} должен быть узнан`);
    for (const k of ["chrome", "python", "gptbot"] as const) assert.equal(goodBot(UA[k]), null, `${k} не поисковик`);
  });

  await check("лимит: 60 в минуту и 600 в час на человека, 61-й — отказ", () => {
    assert.equal(decide(60, 60, "human").allowed, true);
    assert.equal(decide(61, 61, "human").allowed, false);
    assert.equal(decide(10, 601, "human").allowed, false, "часовой лимит");
    assert.equal(decide(600, 9000, "bot").allowed, true, "у поисковиков запас");
    assert.deepEqual(LIMITS.human, { perMin: 60, perHour: 600 });
  });

  await check("скрипт на 200 запросов в минуту с одного IP: 60 проходят, 140 получают 429", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 200; i++) codes.push(await hitPage(i % 2 ? "/api/races/details" : "/races/probeg%3A82247", "203.0.113.7", UA.python));
    assert.equal(codes.filter((c) => c === 200).length, 60);
    assert.equal(codes.filter((c) => c === 429).length, 140);
    assert.ok(codes.slice(0, 60).every((c) => c === 200) && codes.slice(60).every((c) => c === 429), "отказы ровно с 61-го");
    await Promise.all(waitUntil);
    assert.equal(logged.filter((l) => l.p_kind === "rate_limit").length, 140, "каждый отказ в журнале");
    assert.equal(logged[0].p_ip_masked, "203.0.113.x", "IP в журнале с маской");
    assert.equal(logged[0].p_ua, UA.python);
  });

  await check("429: Retry-After, запрет сбора в заголовке, не кэшируется", async () => {
    const req = new NextRequest("https://igorp.run/races", { headers: { "x-forwarded-for": "203.0.113.7", "user-agent": UA.python } });
    const res = await middleware(req, event);
    assert.equal(res.status, 429);
    assert.equal(res.headers.get("retry-after"), "60");
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(decodeURIComponent(res.headers.get("x-copyright-ru") ?? ""), COPYRIGHT_TEXT);
  });

  await check("Googlebot, YandexBot, bingbot, TelegramBot, facebookexternalhit, Twitterbot: 200 запросов в минуту без единого 429", async () => {
    for (const [k, ua] of Object.entries({ googlebot: UA.googlebot, yandex: UA.yandex, bing: UA.bing, telegram: UA.telegram, facebook: UA.facebook, twitter: UA.twitter })) {
      for (let i = 0; i < 200; i++) assert.equal(await hitPage("/races", `198.51.100.${Object.keys(UA).indexOf(k) + 1}`, ua), 200, `${k}, запрос ${i + 1}`);
    }
  });

  await check("разные IP считаются отдельно: соседний адрес не страдает от чужого скрейпера", async () => {
    assert.equal(await hitPage("/races", "203.0.113.8", UA.chrome), 200);
  });

  await check("обычный ответ несёт запрет сбора в заголовке (латиницей и по-русски)", async () => {
    const req = new NextRequest("https://igorp.run/api/races/list", { headers: { "x-forwarded-for": "192.0.2.50", "user-agent": UA.chrome } });
    const res = await middleware(req, event);
    assert.equal(res.headers.get("x-copyright"), COPYRIGHT_HEADERS["X-Copyright"]);
    assert.ok(/^[\x20-\x7e]+$/.test(COPYRIGHT_HEADERS["X-Copyright"]) && /^[\x20-\x7e]+$/.test(COPYRIGHT_HEADERS["X-Copyright-Ru"]), "в заголовке только ASCII");
    assert.equal(COPYRIGHT_TEXT, "© igorp.run. Копирование и автоматический сбор данных запрещены.");
  });

  await check("сбой базы счётчика — запрос пропускается, сайт не падает", async () => {
    const saved = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("db down");
    }) as typeof fetch;
    try {
      assert.equal(await hitPage("/races", "203.0.113.7", UA.python), 200, "даже у скрейпера с исчерпанным лимитом");
    } finally {
      globalThis.fetch = saved;
    }
  });

  await check("IP: первый из x-forwarded-for; маска последнего октета и IPv6", () => {
    assert.equal(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" })), "1.2.3.4");
    assert.equal(clientIp(new Headers({ "x-real-ip": "5.6.7.8" })), "5.6.7.8");
    assert.equal(maskIp("1.2.3.4"), "1.2.3.x");
    assert.equal(maskIp("2a02:6b8:a::1234"), "2a02:6b8:a::x");
    assert.equal(maskIp("unknown"), "unknown");
  });

  const TOKEN = "123456:TEST-races-bot-token";
  const now = Math.floor(Date.now() / 1000);

  await check("initData: верная подпись — пользователь; нет, чужая, старше суток — отказ", () => {
    assert.deepEqual(checkInitData(signedInitData(TOKEN, 42, now - 60), TOKEN, now), { ok: true, userId: 42 });
    assert.deepEqual(checkInitData("", TOKEN, now), { ok: false, kind: "no_init_data" });
    assert.deepEqual(checkInitData(signedInitData("999:other", 42, now), TOKEN, now), { ok: false, kind: "bad_init_data" }, "чужой бот");
    assert.deepEqual(checkInitData(signedInitData(TOKEN, 42, now - 24 * 3600 - 5), TOKEN, now), { ok: false, kind: "bad_init_data" }, "старше суток");
    assert.deepEqual(checkInitData(signedInitData(TOKEN, 42, now - 23 * 3600), TOKEN, now).ok, true, "23 часа — ещё можно");
    const forged = signedInitData(TOKEN, 42, now).replace(encodeURIComponent('"id":42'), encodeURIComponent('"id":7'));
    assert.deepEqual(checkInitData(forged, TOKEN, now), { ok: false, kind: "bad_init_data" }, "подменённый пользователь");
  });

  await check("адреса мини-приложения: без initData и с плохой подписью — 401 и журнал; с подписью — пускает", async () => {
    process.env.RACES_BOT_TOKEN = TOKEN;
    const before = logged.length;
    const bare = await requireMiniapp(new Request("https://igorp.run/api/races/details?id=x", { headers: { "x-forwarded-for": "192.0.2.10", "user-agent": UA.python } }));
    assert.ok(bare instanceof Response && bare.status === 401, "без initData — 401");
    const bad = await requireMiniapp(new Request("https://igorp.run/api/races/list", { headers: { "x-forwarded-for": "192.0.2.10", "user-agent": UA.python, "x-telegram-init-data": "user=%7B%22id%22%3A1%7D&hash=deadbeef" } }));
    assert.ok(bad instanceof Response && bad.status === 401, "плохая подпись — 401");
    assert.deepEqual(logged.slice(before).map((l) => [l.p_kind, l.p_ip_masked, l.p_path]), [
      ["no_init_data", "192.0.2.x", "/api/races/details"],
      ["bad_init_data", "192.0.2.x", "/api/races/list"],
    ]);
    const ok = await requireMiniapp(new Request("https://igorp.run/api/races/list", { headers: { "x-forwarded-for": "192.0.2.11", "x-telegram-init-data": signedInitData(TOKEN, 42, now) } }));
    assert.deepEqual(ok, { userId: 42 });
  });

  await check("подделанный заголовок initData не обходит лимит IP: 401 считаются в счётчик", async () => {
    let last: Response | { userId: number } = { userId: 0 };
    for (let i = 0; i < 70; i++) {
      last = await requireMiniapp(new Request("https://igorp.run/api/races/details?id=x", { headers: { "x-forwarded-for": "192.0.2.99", "user-agent": UA.python, "x-telegram-init-data": "hash=00" } }));
    }
    assert.ok(last instanceof Response && last.status === 429, "после 60 отказов — 429");
  });

  await check("мини-приложение с подписью: лимит по пользователю Telegram, честная прокрутка (200 в минуту) проходит", async () => {
    const init = signedInitData(TOKEN, 77, now);
    for (let i = 0; i < 200; i++) {
      const r = await requireMiniapp(new Request("https://igorp.run/api/races/details?id=x", { headers: { "x-forwarded-for": "192.0.2.12", "x-telegram-init-data": init } }));
      assert.deepEqual(r, { userId: 77 }, `запрос ${i + 1}`);
    }
    assert.equal(await hitPage("/api/races/details", "192.0.2.12", UA.chrome, { "x-telegram-init-data": init }), 200, "middleware пропускает к проверке подписи");
  });

  await check("robots.txt: ИИ-сборщики закрыты, поисковики и превью — нет", () => {
    const r = robots();
    const rules = Array.isArray(r.rules) ? r.rules : [r.rules];
    const all = rules.find((x) => x.userAgent === "*")!;
    assert.equal(all.allow, "/");
    assert.ok(!([] as string[]).concat(all.disallow ?? []).some((d) => d.startsWith("/races")), "календарь открыт поисковикам");
    const training = rules.find((x) => Array.isArray(x.userAgent) && x.userAgent.includes("GPTBot"))!;
    assert.equal(training.disallow, "/");
    for (const b of ["GPTBot", "CCBot", "ClaudeBot", "anthropic-ai", "Google-Extended", "PerplexityBot", "Bytespider", "Amazonbot", "Diffbot"]) {
      assert.ok(AI_TRAINING_BOTS.includes(b), `${b} в списке из наряда`);
    }
    const listed = [...AI_TRAINING_BOTS, ...AI_ASSISTANT_BOTS].map((x) => x.toLowerCase());
    for (const good of ["googlebot", "yandexbot", "bingbot", "telegrambot", "facebookexternalhit", "twitterbot", "yandex", "google"]) {
      assert.ok(!listed.includes(good), `${good} не должен попасть в запрет`);
    }
    for (const ua of [UA.googlebot, UA.yandex, UA.bing, UA.telegram, UA.facebook, UA.twitter]) {
      // robots сопоставляет токен как подстроку User-Agent: ни один токен ИИ не должен входить в UA поисковика.
      assert.ok(!listed.some((t) => ua.toLowerCase().includes(t)), `токен ИИ задел ${ua}`);
    }
    const assistant = rules.find((x) => Array.isArray(x.userAgent) && x.userAgent.includes("ChatGPT-User"))!;
    assert.ok(([] as string[]).concat(assistant.disallow ?? []).includes("/races"));
  });

  await check("HTML /races: без ссылки на источник, «Важного», прошлого проведения", () => {
    const row: RaceRow = {
      id: "probeg:1", source: "probeg", source_url: "https://probeg.org/event/1/", name: "Забег", date_start: "2099-05-01", date_end: null,
      city: "Тверь", region: "Тверская область", distances: ["10 км"], dist_km: [10], race_type: "road", tags: [], site_url: "https://x.ru",
      reg_url: null, vk_url: null, sources: ["probeg", "marathonec"], link_ok: true, alt_dates: [], checked_note: null, subject: null, lat: null, lon: null,
    } as RaceRow;
    const pub = publicRace({ ...toRace(row), important: "Важное: старт 9:00", detailsN: 5 });
    for (const k of ["src", "srcName", "important", "detailsN"]) assert.ok(!(k in pub), `${k} не должен уехать в HTML`);
    assert.equal(pub.nSources, 2, "видимое («Подтверждён · 2 источника») остаётся");
    assert.ok(!JSON.stringify(pub).includes("probeg.org"), "адреса источника нет нигде");
    const e: ExpectedItem = { id: "probeg:2", name: "Ночной", city: "Москва", region: "Москва", type: "road", distances: [], km: [], lastMonth: 6, lastDate: "2025-06-20", lastUrl: "https://probeg.org/event/2/", site: "" };
    const pe = publicExpected(e);
    assert.ok(!("lastUrl" in pe) && !("lastDate" in pe));
    assert.equal(pe.md, "-06-20");
    assert.equal(expectedDateMd(pe.md, "2026-10-20"), expectedDate(e, "2026-10-20"), "дата ожидаемого та же, что по полной дате");
    assert.equal(expectedDateMd("-11-15", "2026-10-20"), "2026-11-15");
    const page = readFileSync("src/app/races/page.tsx", "utf8");
    assert.match(page, /publicRace\(r\)/);
    assert.match(page, /expected\.map\(publicExpected\)/);
    assert.doesNotMatch(page, /loadDetailsIndex|loadListExtras/, "выжимка списка в HTML не грузится");
    const cal = readFileSync("src/app/races/RacesCalendar.tsx", "utf8");
    assert.doesNotMatch(cal, /lastUrl|r\.src\b|srcName/, "календарь не показывает источник и прошлый старт");
  });

  await check("публичный ключ Supabase не используется нигде в src/ и scripts/", () => {
    const files = [...walk("src"), ...walk("scripts")].filter((f) => /\.(ts|tsx|mjs)$/.test(f) && !f.endsWith("check-races-protect.ts"));
    const hits = files.filter((f) => readFileSync(f, "utf8").includes("NEXT_PUBLIC_SUPABASE_ANON_KEY"));
    assert.deepEqual(hits, []);
  });

  await check("адреса мини-приложения: проверка подписи и без кэша CDN", () => {
    for (const f of ["src/app/api/races/details/route.ts", "src/app/api/races/list/route.ts"]) {
      const s = readFileSync(f, "utf8");
      assert.match(s, /requireMiniapp\(request\)/, `${f}: проверка initData`);
      assert.match(s, /"private, no-store"/, `${f}: не кэшируется`);
      assert.doesNotMatch(s, /s-maxage/, `${f}: закэшированный ответ достался бы запросу без подписи`);
    }
    assert.match(readFileSync("src/app/races/RacesCalendar.tsx", "utf8"), /"X-Telegram-Init-Data": initData/);
  });

  await check("миграция отзыва прав: все race_*, обе функции, строгий префикс", () => {
    const sql = readFileSync("supabase/migrations/20261020120100_race_public_revoke.sql", "utf8");
    assert.match(sql, /like 'race\\_%'/, "префикс с экранированным _: trainingpeaks_race_events не задет");
    assert.match(sql, /revoke all on public\.%I from anon, authenticated/);
    assert.match(sql, /revoke execute on function public\.race_geo_point\(text, text\) from public, anon, authenticated/);
    assert.match(sql, /revoke execute on function public\.race_calendar_row\(public\.race_events\) from public, anon, authenticated/);
    assert.match(sql, /grant execute on function public\.race_geo_point\(text, text\) to service_role/);
  });

  await check("подвал с запретом на /races, странице старта и разборе трассы", () => {
    for (const f of ["src/app/races/page.tsx", "src/app/races/[id]/page.tsx", "src/app/races/[id]/trassa/page.tsx"]) {
      assert.match(readFileSync(f, "utf8"), /<RacesFooter \/>/, f);
    }
  });

  await check("итог недели: строка «Защита» и предложение подсети, «Возможная копия» без своих адресов", () => {
    assert.equal(guardSummary([]), "Защита: отказов 0 за неделю, блокировать некого.");
    const rows = [
      ...Array.from({ length: 12 }, (_, i) => ({ kind: "rate_limit", ip_masked: "203.0.113.x", ua: UA.python, path: "/races", n: 20, minute: `2026-10-20T10:${String(i).padStart(2, "0")}:00Z` })),
      { kind: "no_init_data", ip_masked: "192.0.2.x", ua: "curl/8.7.1", path: "/api/races/details", n: 3, minute: "2026-10-20T11:00:00Z" },
    ];
    const s = guardSummary(rows);
    assert.match(s, /^Защита: отказов 243 \(429 240, без initData 3\), топ-5 источников: 203\.0\.113\.x \(python-requests\/2\.32\.3\) — 240; 192\.0\.2\.x \(curl\/8\.7\.1\) — 3; предложить заблокировать: 203\.0\.113\.0\/24\.$/);
    assert.equal(subnetOf("2a02:6b8:a::x"), "2a02:6b8:a::/48");
    assert.ok(isOwnUrl("https://www.igorp.run/races/x", phrases.own));
    assert.ok(isOwnUrl("https://t.me/ruruns_bot?start=1", phrases.own));
    assert.ok(!isOwnUrl("https://t.me/some_channel/12", phrases.own), "чужой канал в Telegram — не свой");
    assert.deepEqual(copyLines([{ url: "https://igorp.run/races/x", phrase: "a" }, { url: "https://copy.example/p", phrase: "Финиш в горку: оставь силы на последний подъём" }, { url: "https://copy.example/p", phrase: "Финиш в горку: оставь силы на последний подъём" }], phrases.own), [
      "Возможная копия: https://copy.example/p, «Финиш в горку: оставь силы на последний подъём»",
    ]);
    assert.deepEqual(copyLines(null, phrases.own), ["Поиск копий: не выполнен (нет итога поиска за неделю)."]);
    assert.equal(phrases.phrases.length, 20);
  });

  globalThis.fetch = realFetch;
  if (failures) {
    console.error(`\n${failures} проверок упало`);
    process.exit(1);
  }
  console.log("\ncheck:races-protect — всё зелёное");
}

void main();
