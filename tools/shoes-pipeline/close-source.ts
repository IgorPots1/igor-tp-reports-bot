/**
 * Закрыть источник и удалить всё, что с него получено (наряд 14.10.2026, п.6).
 *
 *   npx tsx tools/shoes-pipeline/close-source.ts <id> "причина" ["цитата запрета"]
 *
 * Когда: источник прислал возражение или в его условиях (в том числе на самой
 * странице обзора — terms-notices.json) появился запрет. Тогда:
 *   1. в реестре условий источник становится «запрещён» с причиной и датой —
 *      загрузчик его больше не пустит;
 *   2. удаляются сохранённые страницы, тексты для читателя, ответы читателей и
 *      смысловые проверки моделей, где он участвовал (проверка смешанная —
 *      её проще пересделать, чем вычищать);
 *   3. его ссылки убираются из покрытия, чтобы очередь их больше не выдала.
 * Черновики пересобираются следующим settle уже без него.
 *
 * Хост, общий с другим разрешённым источником (магазин и его блог), целиком не
 * удаляется — только страницы этого источника.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { SOURCES } from "./lib/sources";
import type { TermsEntry } from "./lib/terms";

const [id, reason, quote] = process.argv.slice(2);
if (!id || !reason) {
  console.error('Использование: close-source.ts <id> "причина" ["цитата запрета"]');
  process.exit(1);
}
const source = SOURCES.find((s) => s.id === id);
if (!source) throw new Error(`Неизвестный источник: ${id}`);

const ROOT = resolve("tools/shoes-pipeline");
const CACHE = resolve(ROOT, ".cache");
const READ = resolve(CACHE, "read-allowed");
const READINGS = resolve(ROOT, "lib/terms-readings.json");
const COVERAGE = resolve(ROOT, "reports/coverage-allowed.json");
const today = new Date().toISOString().slice(0, 10);
let removed = 0;
const rm = (p: string) => {
  if (!existsSync(p)) return;
  rmSync(p, { recursive: true, force: true });
  removed++;
};

// 1. Реестр: «запрещён», с причиной.
const readings: Record<string, TermsEntry> = JSON.parse(readFileSync(READINGS, "utf8"));
readings[id] = { reading: "forbids", url: readings[id]?.url ?? null, quote: quote ?? null, readAt: today, note: `закрыт ${today}: ${reason}` };
writeFileSync(READINGS, JSON.stringify(readings, null, 2) + "\n");

// 2. Страницы в кэше загрузчика.
const host = new URL(source.origin).host.replace(/[^a-z0-9.-]/gi, "_");
const sharedHost = SOURCES.some((s) => s.id !== id && new URL(s.origin).host === new URL(source.origin).host);
const coverage = existsSync(COVERAGE) ? JSON.parse(readFileSync(COVERAGE, "utf8")) : { models: {} };
const urls: string[] = Object.values(coverage.models as Record<string, { source: string; url: string }[]>)
  .flat()
  .filter((h) => h.source === id)
  .map((h) => h.url);
if (!sharedHost) rm(resolve(CACHE, host));
else for (const u of urls) rm(resolve(CACHE, host, `${createHash("sha1").update(u).digest("hex").slice(0, 16)}.html`));

// Тексты условий тоже с этого сайта: решение записано в реестре, копия не нужна.
rm(resolve(CACHE, "terms", `${id}.txt`));

// 3. Тексты для читателя, ответы, смысловые проверки.
if (existsSync(READ)) {
  for (const dir of readdirSync(READ, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    const d = resolve(READ, dir.name);
    const had = existsSync(resolve(d, `${id}.txt`)) || existsSync(resolve(d, `${id}.answer.json`));
    rm(resolve(d, `${id}.txt`));
    rm(resolve(d, `${id}.answer.json`));
    if (had) {
      rm(resolve(d, "verify-request.json"));
      rm(resolve(d, "verify.json"));
    }
  }
}

// 4. Покрытие: ссылки источника больше не выдаются очереди.
if (existsSync(COVERAGE)) {
  for (const k of Object.keys(coverage.models)) {
    coverage.models[k] = coverage.models[k].filter((h: { source: string }) => h.source !== id);
    if (coverage.models[k].length === 0) delete coverage.models[k];
  }
  writeFileSync(COVERAGE, JSON.stringify(coverage, null, 2) + "\n");
}

console.log(`Источник ${id} закрыт: ${reason}. Удалено объектов: ${removed}.`);
console.log("Дальше: npx tsx tools/shoes-pipeline/audit-sources.ts --offline && npx tsx tools/shoes-pipeline/read-verdicts.ts settle");
