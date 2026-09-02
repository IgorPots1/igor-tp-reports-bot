import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { isAllowed, parseRobots, type Robots } from "./robots";
import { HOST_DELAY_MS, USER_AGENT, sourceById, type SourceId } from "./sources";

/**
 * Вежливый загрузчик страниц.
 *
 * Три вещи, ради которых он вообще существует:
 *
 * 1. ГЕЙТ. Перед запросом спрашивает отчёт аудита (reports/source-terms.json).
 *    Источник без статуса "allowed" не скачивается — не «скачаем и решим
 *    потом», а именно не скачивается. Правило наряда про запрещающие источники
 *    иначе держалось бы на дисциплине, а дисциплина забывается.
 *
 * 2. КЭШ НА ДИСКЕ. Каждая страница качается ОДИН раз и остаётся файлом. Разбор
 *    переписывается десятки раз, и без кэша каждая правка парсера означала бы
 *    новый обход чужого сайта. Заодно кэш — это доказательство: цифра в базе
 *    всегда прослеживается до сохранённой страницы, а не до «я так помню».
 *
 * 3. ПАУЗЫ. Не быстрее одного запроса в HOST_DELAY_MS на хост, и Crawl-delay
 *    из robots.txt уважается, если он больше нашего.
 */

const CACHE_DIR = resolve("tools/shoes-pipeline/.cache");
const TERMS_PATH = resolve("tools/shoes-pipeline/reports/source-terms.json");

type TermsReport = {
  sources: { id: string; status: string; note: string; crawlDelaySec: number | null }[];
};

let terms: TermsReport | null = null;
function loadTerms(): TermsReport {
  if (terms) return terms;
  if (!existsSync(TERMS_PATH)) {
    throw new Error(
      "Нет отчёта об условиях источников. Сначала: npx tsx tools/shoes-pipeline/audit-sources.ts"
    );
  }
  terms = JSON.parse(readFileSync(TERMS_PATH, "utf8")) as TermsReport;
  return terms;
}

const lastHit = new Map<string, number>();
const robotsCache = new Map<string, Robots>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function cachePath(url: string): string {
  const hash = createHash("sha1").update(url).digest("hex").slice(0, 16);
  const host = new URL(url).host.replace(/[^a-z0-9.-]/gi, "_");
  return resolve(CACHE_DIR, host, `${hash}.html`);
}

async function politeDelay(host: string, extraSec: number | null) {
  const need = Math.max(HOST_DELAY_MS, (extraSec ?? 0) * 1000);
  const last = lastHit.get(host);
  if (last !== undefined) {
    const wait = need - (Date.now() - last);
    if (wait > 0) await sleep(wait);
  }
  lastHit.set(host, Date.now());
}

async function robotsFor(origin: string): Promise<Robots> {
  const cached = robotsCache.get(origin);
  if (cached) return cached;
  let text = "";
  let missing = true;
  try {
    await politeDelay(new URL(origin).host, null);
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      text = await res.text();
      missing = false;
    }
  } catch {
    // Нет robots — ниже это станет отказом, а не разрешением.
  }
  const parsed = parseRobots(text, missing);
  robotsCache.set(origin, parsed);
  return parsed;
}

export type FetchResult =
  | { ok: true; body: string; fromCache: boolean; url: string }
  | { ok: false; reason: string; url: string };

/**
 * Скачивает страницу источника. Отказ — обычный результат, а не исключение:
 * конвейер должен доехать до отчёта и показать, чего он не смог взять.
 */
export async function fetchPage(sourceId: SourceId, url: string): Promise<FetchResult> {
  const source = sourceById(sourceId);
  const entry = loadTerms().sources.find((s) => s.id === sourceId);

  if (!entry || entry.status !== "allowed") {
    return {
      ok: false,
      url,
      reason: `источник ${source.title}: статус «${entry?.status ?? "не проверен"}» — обход не разрешён (${entry?.note ?? ""})`,
    };
  }

  const file = cachePath(url);
  if (existsSync(file)) {
    return { ok: true, body: readFileSync(file, "utf8"), fromCache: true, url };
  }

  // Проверка robots ещё раз, на КОНКРЕТНОМ пути: аудит проверял образцы, а
  // обход трогает и другие адреса того же хоста.
  const origin = new URL(url).origin;
  const robots = await robotsFor(origin);
  const decision = isAllowed(robots, new URL(url).pathname, USER_AGENT);
  if (!decision.allowed) {
    return { ok: false, url, reason: `robots.txt запрещает: ${decision.reason}` };
  }

  await politeDelay(new URL(url).host, robots.crawlDelaySec ?? entry.crawlDelaySec);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(30000),
      redirect: "follow",
    });
    if (!res.ok) return { ok: false, url, reason: `HTTP ${res.status}` };
    const body = await res.text();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body);
    return { ok: true, body, fromCache: false, url };
  } catch (err) {
    return { ok: false, url, reason: (err as Error).message };
  }
}
