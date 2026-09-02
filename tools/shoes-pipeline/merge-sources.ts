/**
 * Отчёт о сведении двух лабораторий: RTINGS и RunRepeat.
 *
 * Только здесь правило наряда «числовое поле подтверждается двумя независимыми
 * источниками» становится выполнимым: обе лаборатории меряют стек, дроп и вес
 * сами. Всё, что они говорят по-разному больше чем на 10 %, уходит человеку и
 * не усредняется.
 *
 * Правила сведения живут в lib/merge.ts и общие со сборкой каталога — иначе
 * отчёт однажды скажет «сошлось», а в базу поедет другое число.
 *
 *   npx tsx tools/shoes-pipeline/merge-sources.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { COMPARABLE, mergeSources, type RtingsModel, type RunRepeatModel } from "./lib/merge";

const REPORTS = resolve("tools/shoes-pipeline/reports");
const read = <T>(name: string): T | null => {
  const p = resolve(REPORTS, name);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null;
};

const rt = read<{ parsed: RtingsModel[] }>("raw-rtings.json");
const rr = read<{ parsed: RunRepeatModel[] }>("raw-runrepeat.json");
if (!rt || !rr) {
  console.error("Нужны оба сбора: collect.ts (RTINGS) и collect-runrepeat.ts");
  process.exit(1);
}

const { models, matched } = mergeSources(rt.parsed, rr.parsed);

console.log(`RTINGS:    ${rt.parsed.length} моделей`);
console.log(`RunRepeat: ${rr.parsed.length} моделей`);
console.log(`Всего уникальных: ${models.length}, в обоих источниках: ${matched}\n`);

type Counts = { ok: number; divergent: number; single_source: number; no_source: number };
const byField = new Map<string, Counts>();
const divergentExamples: string[] = [];

for (const m of models) {
  for (const [field, r] of Object.entries(m.reconciled)) {
    const c = byField.get(field) ?? { ok: 0, divergent: 0, single_source: 0, no_source: 0 };
    c[r.status] += 1;
    byField.set(field, c);
    if (r.status === "divergent") divergentExamples.push(`${m.key} · ${r.note}`);
  }
}

console.log("Поле                        подтверждено  разошлось  один источник  нет");
for (const c of COMPARABLE) {
  const e = byField.get(c.field) ?? { ok: 0, divergent: 0, single_source: 0, no_source: 0 };
  const confirmed = e.ok + e.divergent;
  const pct = confirmed > 0 ? Math.round((e.divergent / confirmed) * 100) : 0;
  console.log(
    `  ${c.field.padEnd(24)} ${String(e.ok).padStart(6)}  ${String(e.divergent).padStart(9)} (${String(pct).padStart(3)} %) ${String(e.single_source).padStart(9)} ${String(e.no_source).padStart(6)}`
  );
}

const withNote = COMPARABLE.filter((c) => c.note);
if (withNote.length > 0) {
  console.log("\nОговорки к сравнению:");
  for (const c of withNote) console.log(`  ${c.field}: ${c.note}`);
}

console.log(`\nРасхождений между лабораториями: ${divergentExamples.length}`);
for (const d of divergentExamples.slice(0, 8)) console.log(`  ${d}`);

writeFileSync(
  resolve(REPORTS, "merge-outcomes.json"),
  JSON.stringify({ matched, models }, null, 2) + "\n"
);
console.log(`\nОтчёт: ${resolve(REPORTS, "merge-outcomes.json")}`);
