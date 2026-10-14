/**
 * Счётчик просмотров igorp.run: что пишем в page_views и как считаем админку. Без сети и базы.
 *
 * ЧТО СТЕРЕЖЁТ:
 *   — служебные зоны (/admin, /m, /api) не попадают ни в Vercel Analytics, ни в page_views;
 *     сравнение по сегментам: /media и /marathon — не /m;
 *   — пишем только /tools, /races, /camp, /club, /start и ровно «/»;
 *   — боты по user agent (TelegramBot, facebookexternalhit, превью, vercel) и пустой UA — не пишем;
 *   — path ≤ 200, referrer ≤ 500, query/hash отрезаны, лишние ключи тела в строку не попадают,
 *     country только двухбуквенный;
 *   — агрегаты: сегодня/7/30 по московским дням, уникальные по visitor_id, сортировка по 7 дням,
 *     переходы внутри сайта не считаются источником.
 *
 *   npm run check:page-views
 */

import assert from "node:assert/strict";

import { isBotUserAgent, isExcludedPath, isTrackedPath } from "@/features/page-views/paths";
import { buildPageViewRow } from "@/features/page-views/record";
import { ALL_PATHS, computePageViewStats, DIRECT_LABEL, last30Days, moscowDay, referrerDomain } from "@/features/page-views/stats";

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
const meta = { userAgent: UA, country: "ru" };

// пути
for (const p of ["/admin", "/admin/tools-stats", "/m", "/m/desk", "/api", "/api/pv"]) assert.ok(isExcludedPath(p), p);
// /wish/<token>: в адресе секрет виш-листа, ни один счётчик не должен его записать.
for (const p of ["/wish", "/wish/0123456789abcdef0123456789abcdef"]) {
  assert.ok(isExcludedPath(p), p);
  assert.ok(!isTrackedPath(p), p);
}
assert.ok(!isExcludedPath("/wishes"), "/wishes");
for (const p of ["/media", "/marathon", "/tools", "/apiary", "/"]) assert.ok(!isExcludedPath(p), p);
for (const p of ["/", "/tools", "/tools/dress", "/races", "/races/x", "/camp", "/club/a", "/start"]) assert.ok(isTrackedPath(p), p);
for (const p of ["/privacy", "/toolsx", "/startup", "/connect", "/go/r1", "/admin"]) assert.ok(!isTrackedPath(p), p);

// боты
for (const ua of ["TelegramBot (like TwitterBot)", "facebookexternalhit/1.1", "Googlebot/2.1", "vercel-screenshot/1.0", "Slack link preview", "", null]) {
  assert.ok(isBotUserAgent(ua), String(ua));
}
assert.ok(!isBotUserAgent(UA));

// строка
const row = buildPageViewRow(
  {
    path: `/tools/dress?utm_source=x#top`,
    referrer: `https://t.me/${"a".repeat(600)}`,
    utm_source: "tg",
    utm_medium: "",
    visitor_id: "v1",
    session_id: "s1",
    is_admin: true,
    id: 99,
  },
  meta,
);
assert.ok(row);
assert.equal(row.path, "/tools/dress");
assert.equal(row.referrer?.length, 500);
assert.equal(row.utm_source, "tg");
assert.equal(row.utm_medium, null);
assert.equal(row.country, "RU");
assert.deepEqual(Object.keys(row).sort(), [
  "country", "path", "referrer", "session_id", "user_agent", "utm_campaign", "utm_content", "utm_medium", "utm_source", "visitor_id",
]);
assert.equal(buildPageViewRow({ path: `/tools/${"x".repeat(300)}` }, meta)?.path.length, 200);
assert.equal(buildPageViewRow({ path: "/tools" }, { userAgent: UA, country: "Moscow" })?.country, null);
assert.equal(buildPageViewRow({ path: "/admin" }, meta), null);
assert.equal(buildPageViewRow({ path: "/m/desk" }, meta), null);
assert.equal(buildPageViewRow({ path: "/privacy" }, meta), null);
assert.equal(buildPageViewRow({ path: "tools" }, meta), null);
assert.equal(buildPageViewRow({ path: "/tools" }, { userAgent: "TelegramBot (like TwitterBot)", country: null }), null);
assert.equal(buildPageViewRow([{ path: "/tools" }], meta), null);
assert.equal(buildPageViewRow(null, meta), null);

// дни: 21:30 UTC 12.10 — уже 13.10 по Москве
const now = new Date("2026-10-12T21:30:00Z");
assert.equal(moscowDay(now), "2026-10-13");
const days = last30Days(now);
assert.equal(days.length, 30);
assert.equal(days[29], "2026-10-13");
assert.equal(days[0], "2026-09-14");

// источники
assert.equal(referrerDomain(null), DIRECT_LABEL);
assert.equal(referrerDomain("https://www.igorp.run/tools"), null);
assert.equal(referrerDomain("https://x-y.vercel.app/"), null);
assert.equal(referrerDomain("https://www.google.com/search?q=1"), "google.com");

// агрегаты
const r = (created_at: string, path: string, visitor_id: string | null, referrer: string | null = null, utm_source: string | null = null) => ({
  created_at, path, visitor_id, referrer, utm_source,
});
const s = computePageViewStats(
  [
    r("2026-10-12T22:00:00Z", "/tools/dress", "a", "https://t.me/run", "tg"), // сегодня (13.10 МСК)
    r("2026-10-12T23:00:00Z", "/tools/dress", "a", "https://igorp.run/tools"), // сегодня, внутренний
    r("2026-10-10T10:00:00Z", "/tools/dress", "b"), // 7 дней
    r("2026-10-09T10:00:00Z", "/tools/nutrition", "c"), // 7 дней
    r("2026-10-09T11:00:00Z", "/tools/nutrition", "d"),
    r("2026-10-09T12:00:00Z", "/tools/nutrition", null),
    r("2026-10-09T13:00:00Z", "/tools/nutrition", "d"),
    r("2026-09-20T10:00:00Z", "/tools/dress", "e"), // только 30 дней
    r("2026-09-01T10:00:00Z", "/tools/dress", "f"), // за окном
  ],
  now,
);
// nutrition 4 за 7 дней против 3 у dress, хотя за 30 дней у dress столько же (4): решают 7 дней.
assert.deepEqual(s.paths.map((p) => p.path), ["/tools/nutrition", "/tools/dress"]);
const dress = s.paths.find((p) => p.path === "/tools/dress")!;
assert.deepEqual(dress.today, { views: 2, visitors: 1 });
assert.deepEqual(dress.d7, { views: 3, visitors: 2 });
assert.deepEqual(dress.d30, { views: 4, visitors: 3 });
const nutrition = s.paths.find((p) => p.path === "/tools/nutrition")!;
assert.deepEqual(nutrition.d7, { views: 4, visitors: 2 });
assert.equal(s.total30, 8);
assert.equal(s.byDay[ALL_PATHS].length, 30);
assert.equal(s.byDay[ALL_PATHS].reduce((a, d) => a + d.n, 0), 8);
assert.equal(s.byDay["/tools/dress"].find((d) => d.day === "2026-10-13")?.n, 2);
assert.deepEqual(s.referrers7, [
  { label: DIRECT_LABEL, n: 5 },
  { label: "t.me", n: 1 },
]);
assert.deepEqual(s.utmSources7, [{ label: "tg", n: 1 }]);

console.log("check:page-views OK");
