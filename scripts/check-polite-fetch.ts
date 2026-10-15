/**
 * Сеть скриптов календаря стартов только через scripts/lib/polite-fetch.ts (решение 15.10.2026).
 *
 * ЧТО СТЕРЕЖЁТ:
 *   — закрытый robots.txt сайт (myrace.info: «User-agent: * / Disallow: /») не запрашивается вовсе:
 *     отказ RobotsBlockedError, к самой странице ни одного запроса;
 *   — разбор robots: группа нашего агента важнее «*», самое длинное правило, Allow при равенстве,
 *     «*» и «$»; 404 — правил нет (можно), 5xx/сеть — нельзя;
 *   — официальные API без robots, хост скачивания Яндекс Диска — только по ссылке из API;
 *   — пауза между запросами к одному хосту, Crawl-delay сайта сверху;
 *   — ОБХОД: в скриптах календаря нет голого fetch( и page.goto( мимо модуля.
 *
 *   npm run check:polite-fetch
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { API_HOSTS, createPoliteFetch, parseRobots, robotsAllows, RobotsBlockedError } from "./lib/polite-fetch";

let n = 0;
const ok = async (name: string, fn: () => Promise<void> | void) => {
  await fn();
  n++;
  console.log(`ok  ${name}`);
};

/** Поддельная сеть: robots.txt по хосту, учёт всех запросов, часы под контролем теста. */
function fakeNet(robots: Record<string, { status: number; body?: string } | "throw">) {
  const calls: string[] = [];
  let t = 0;
  const slept: number[] = [];
  const pf = createPoliteFetch({
    fetch: async (url) => {
      calls.push(url);
      const u = new URL(url);
      if (u.pathname === "/robots.txt") {
        const r = robots[u.hostname] ?? { status: 404 };
        if (r === "throw") throw new Error("ECONNRESET");
        return new Response(r.body ?? "", { status: r.status });
      }
      return new Response("ok", { status: 200 });
    },
    sleep: async (ms) => { slept.push(ms); t += ms; },
    now: () => t,
  });
  return { ...pf, calls, slept, tick: (ms: number) => { t += ms; } };
}

await ok("myrace.info (Disallow: / для всех) — отказ, к странице ни одного запроса", async () => {
  const net = fakeNet({ "myrace.info": { status: 200, body: "User-Agent: *\nDisallow: /\n" } });
  await assert.rejects(net.politeFetch("https://myrace.info/events/1907"), RobotsBlockedError);
  assert.deepEqual(net.calls, ["https://myrace.info/robots.txt"], "запрошен только robots.txt");
  await assert.rejects(net.assertRobotsAllowed("https://myrace.info/events"), /Disallow/);
});

await ok("разбор robots: своя группа важнее «*», длинное правило, Allow при равенстве, * и $", () => {
  const r = parseRobots("User-agent: *\nDisallow: /\n\nUser-agent: igorp.run\nDisallow: /private\nAllow: /private/public\nDisallow: /*.pdf$\n");
  assert.equal(robotsAllows(r, "/events/1"), true, "наша группа открывает то, что «*» закрыл");
  assert.equal(robotsAllows(r, "/private/x"), false);
  assert.equal(robotsAllows(r, "/private/public/x"), true, "длинное Allow побеждает");
  assert.equal(robotsAllows(r, "/files/a.pdf"), false);
  assert.equal(robotsAllows(r, "/files/a.pdf?x=1"), true, "«$» — конец пути");
  const tilda = parseRobots("User-Agent: *\nDisallow: /tilda/form*\nDisallow: /page52973245.html\nDisallow:\n");
  assert.equal(robotsAllows(tilda, "/arena2026"), true, "пустой Disallow ничего не закрывает");
  assert.equal(robotsAllows(tilda, "/tilda/form1"), false);
  assert.equal(robotsAllows(parseRobots("User-agent: Googlebot\nDisallow: /\n"), "/x"), true, "чужая группа нас не касается");
});

await ok("robots.txt: 404 — можно; 5xx и сеть — нельзя", async () => {
  const net = fakeNet({ "a.ru": { status: 404 }, "b.ru": { status: 503 }, "c.ru": "throw" });
  assert.equal((await net.politeFetch("https://a.ru/x")).status, 200);
  await assert.rejects(net.politeFetch("https://b.ru/x"), /недоступен/);
  await assert.rejects(net.politeFetch("https://c.ru/x"), /недоступен/);
});

await ok("официальные API без robots; Яндекс Диск — скачивание только по ссылке из API", async () => {
  const net = fakeNet({ "api.open-meteo.com": { status: 200, body: "User-agent: *\nDisallow: /\n" } });
  assert.ok(API_HOSTS.has("cloud-api.yandex.net"));
  await net.politeFetch("https://api.open-meteo.com/v1/elevation?latitude=1&longitude=2");
  assert.ok(!net.calls.some((c) => c.endsWith("/robots.txt")), "у API robots не читаем");
  await assert.rejects(net.politeFetch("https://downloader.disk.yandex.ru/disk/abc"), /только по ссылке из официального API/);
  assert.equal((await net.politeFetch("https://downloader.disk.yandex.ru/disk/abc", {}, { yandexDiskApiHref: true })).status, 200);
});

await ok("пауза между запросами к хосту и Crawl-delay сайта", async () => {
  const net = fakeNet({ "slow.ru": { status: 200, body: "User-agent: *\nCrawl-delay: 3\n" } });
  await net.politeFetch("https://slow.ru/a");
  await net.politeFetch("https://slow.ru/b");
  assert.deepEqual(net.slept, [3000], "второй запрос ждёт Crawl-delay 3 с");
  await net.politeFetch("https://fast.ru/a");
  await net.politeFetch("https://fast.ru/b");
  assert.equal(net.slept.at(-1), 1100, "без Crawl-delay — не чаще раза в 1,1 с");
});

await ok("обхода нет: в скриптах календаря нет голого fetch( и page.goto( мимо polite-fetch", () => {
  const files = [
    ...readdirSync("scripts/race-course").filter((f) => f.endsWith(".ts")).map((f) => path.join("scripts/race-course", f)),
    ...readdirSync("scripts").filter((f) => /^(races?-)[\w-]+\.ts$/.test(f) && !f.startsWith("races-bot")).map((f) => path.join("scripts", f)),
  ];
  const offenders: string[] = [];
  for (const f of files) {
    readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;
      if (/(?<![\w.])fetch\(/.test(line) && !/politeFetch\(/.test(line)) offenders.push(`${f}:${i + 1} голый fetch(`);
      if (/\.goto\(/.test(line)) {
        const prev = readFileSync(f, "utf8").split("\n").slice(Math.max(0, i - 3), i).join("\n");
        if (!/assertRobotsAllowed\(/.test(prev)) offenders.push(`${f}:${i + 1} page.goto без assertRobotsAllowed`);
      }
    });
  }
  assert.deepEqual(offenders, [], offenders.join("\n"));
});

console.log(`\ncheck:polite-fetch: ${n} ok`);
