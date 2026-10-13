/**
 * Переносит решения читателя условий в lib/terms-readings.json.
 *
 *   npx tsx tools/shoes-pipeline/terms-merge.ts <answers.json> [...]
 *
 * Читатель — модель, и её решению код не верит на слово: цитата обязана стоять
 * в сохранённом тексте условий точной подстрокой, иначе запись ложится как
 * «unread» с пометкой, а не как разрешение или запрет. Адрес условий берётся из
 * доказательств гейта, а не из ответа: что читали, то и записываем.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { TermsEntry, TermsReading } from "./lib/terms";

const READINGS = resolve("tools/shoes-pipeline/lib/terms-readings.json");
const EVIDENCE = resolve("tools/shoes-pipeline/reports/gate-evidence.json");
const TERMS_DIR = resolve("tools/shoes-pipeline/.cache/terms");

const norm = (s: string) =>
  s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

type Answer = { id: string; reading: TermsReading | "none"; quote: string | null; why?: string };

const out: Record<string, TermsEntry> = JSON.parse(readFileSync(READINGS, "utf8"));
const evidence = JSON.parse(readFileSync(EVIDENCE, "utf8")) as Record<string, { terms: { url: string | null } | null }>;
const today = new Date().toISOString().slice(0, 10);

for (const file of process.argv.slice(2)) {
  for (const a of JSON.parse(readFileSync(file, "utf8")) as Answer[]) {
    const url = evidence[a.id]?.terms?.url ?? null;
    const textPath = resolve(TERMS_DIR, `${a.id}.txt`);
    const text = existsSync(textPath) ? norm(readFileSync(textPath, "utf8")) : "";
    // «Условий нет после поиска» — разрешение даёт Игорь (наряд 14.10.2026),
    // и запись говорит об этом прямо, а не выдаёт себя за прочтённое разрешение.
    if (a.reading === "none") {
      out[a.id] = { reading: "permits", url, quote: null, readAt: today, decided_by: "igor", decidedAt: today, note: `условий нет после поиска: ${a.why ?? ""}` };
      console.log(`${a.id.padEnd(22)} none → решение Игоря`);
      continue;
    }
    let entry: TermsEntry = { reading: a.reading, url, quote: a.quote, readAt: today, note: a.why };
    if (a.reading !== "unread" && (!a.quote || !text.includes(norm(a.quote)))) {
      entry = { reading: "unread", url, quote: null, readAt: today, note: `цитата читателя не найдена в тексте условий — перечитать (${a.why ?? ""})` };
    }
    out[a.id] = entry;
    console.log(`${a.id.padEnd(22)} ${entry.reading.padEnd(8)} ${entry.note?.slice(0, 80) ?? ""}`);
  }
}
writeFileSync(READINGS, JSON.stringify(out, null, 2) + "\n");
