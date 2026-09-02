/**
 * Гейт из раздела 4 наряда: зафиксировать условия использования КАЖДОГО
 * источника ДО сбора. Источник, запрещающий автоматический обход, в конвейер
 * не включается.
 *
 * Скрипт читает robots.txt каждого хоста и проверяет ровно те пути, которые
 * конвейер обходил бы, а не «сайт вообще». Результат ложится в
 * reports/source-terms.json — его читает загрузчик, и без записи «allowed»
 * ни одна страница источника не скачивается.
 *
 *   npx tsx tools/shoes-pipeline/audit-sources.ts
 *
 * Только чтение robots.txt: по одному запросу на хост, с паузой.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { isAllowed, parseRobots } from "./lib/robots";
import { HOST_DELAY_MS, SOURCES, USER_AGENT, type TermsStatus } from "./lib/sources";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type PathVerdict = { path: string; allowed: boolean; reason: string };
type Verdict = {
  id: string;
  title: string;
  origin: string;
  status: TermsStatus;
  note: string;
  robotsFetched: boolean;
  crawlDelaySec: number | null;
  paths: PathVerdict[];
  checkedAt: string;
};

const results: Verdict[] = [];

for (const source of SOURCES) {
  // Ручной статус аудит не трогает: лицензию robots.txt не выдаёт.
  if (source.status === "manual") {
    results.push({
      id: source.id,
      title: source.title,
      origin: source.origin,
      status: "manual",
      note: source.note ?? "решение принимает человек",
      robotsFetched: false,
      crawlDelaySec: null,
      paths: [],
      checkedAt: new Date().toISOString(),
    });
    console.log(`— ${source.title}: решает человек (${source.note ?? ""})`);
    continue;
  }

  let text = "";
  let fetched = false;
  try {
    const res = await fetch(`${source.origin}/robots.txt`, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/plain" },
      signal: AbortSignal.timeout(15000),
      redirect: "follow",
    });
    if (res.ok) {
      text = await res.text();
      fetched = true;
    } else {
      text = "";
    }
  } catch (err) {
    console.log(`  ! ${source.title}: robots.txt не прочитан (${(err as Error).message})`);
  }

  const robots = parseRobots(text, !fetched);
  const paths = source.probePaths.map((p) => {
    const d = isAllowed(robots, p, USER_AGENT);
    return { path: p, allowed: d.allowed, reason: d.reason };
  });

  // Если запрещён хоть один из нужных путей — источник в конвейер не идёт.
  // Не «возьмём то, что разрешено»: наряд говорит про источник целиком, и
  // частичный обход всё равно оставил бы дыры в схеме.
  const allAllowed = paths.every((p) => p.allowed);
  let status: TermsStatus;
  let note: string;
  if (!fetched) {
    // Нет robots.txt — формально можно, но решение оставляем человеку:
    // отсутствие файла не то же самое, что разрешение.
    status = "manual";
    note = "robots.txt не прочитан — решение за человеком, автоматически не берём";
  } else if (allAllowed) {
    status = "allowed";
    note = paths.map((p) => `${p.path} → ${p.reason}`).join("; ");
  } else {
    status = "forbidden";
    note = paths.filter((p) => !p.allowed).map((p) => `${p.path} → ${p.reason}`).join("; ");
  }

  results.push({
    id: source.id,
    title: source.title,
    origin: source.origin,
    status,
    note,
    robotsFetched: fetched,
    crawlDelaySec: robots.crawlDelaySec,
    paths,
    checkedAt: new Date().toISOString(),
  });

  const mark = status === "allowed" ? "ok " : status === "forbidden" ? "ЗАПРЕТ" : "рука";
  console.log(`${mark.padEnd(7)} ${source.title.padEnd(20)} ${note.slice(0, 90)}`);

  await sleep(HOST_DELAY_MS);
}

const out = resolve("tools/shoes-pipeline/reports/source-terms.json");
writeFileSync(out, JSON.stringify({ userAgent: USER_AGENT, checkedAt: new Date().toISOString(), sources: results }, null, 2) + "\n");

const by = (s: TermsStatus) => results.filter((r) => r.status === s);
console.log(`\n${"─".repeat(70)}`);
console.log(`Разрешают обход:      ${by("allowed").length} — ${by("allowed").map((r) => r.title).join(", ") || "нет"}`);
console.log(`Запрещают:            ${by("forbidden").length} — ${by("forbidden").map((r) => r.title).join(", ") || "нет"}`);
console.log(`Решает человек:       ${by("manual").length} — ${by("manual").map((r) => r.title).join(", ") || "нет"}`);
console.log(`\nОтчёт: ${out}`);
console.log("Загрузчик берёт страницы ТОЛЬКО у источников со статусом allowed.");
