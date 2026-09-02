/**
 * Сведение двух лабораторий: RTINGS и RunRepeat.
 *
 * Только здесь правило наряда «числовое поле подтверждается двумя независимыми
 * источниками» становится выполнимым: обе лаборатории меряют стек, дроп и вес
 * сами, независимо друг от друга. Всё, что они говорят по-разному больше чем на
 * 10 %, уходит человеку и не усредняется.
 *
 *   npx tsx tools/shoes-pipeline/merge-sources.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { modelKey, normalizeBrand } from "./lib/match";
import { reconcileNumber, type Observation } from "./lib/reconcile";
import type { ParsedSpec } from "./lib/parsers/rtings";

const REPORTS = resolve("tools/shoes-pipeline/reports");
const read = <T>(name: string): T | null => {
  const p = resolve(REPORTS, name);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null;
};

type RtingsRaw = { parsed: { brandSlug: string; modelSlug: string; url: string; specs: Record<string, ParsedSpec> }[] };
type RrRaw = { parsed: { slug: string; url: string; specs: Record<string, ParsedSpec> }[] };

const rt = read<RtingsRaw>("raw-rtings.json");
const rr = read<RrRaw>("raw-runrepeat.json");
if (!rt || !rr) {
  console.error("Нужны оба сбора: collect.ts (RTINGS) и collect-runrepeat.ts");
  process.exit(1);
}

const rtByKey = new Map(rt.parsed.map((s) => [modelKey(normalizeBrand(s.brandSlug), s.modelSlug), s]));
const rrByKey = new Map(rr.parsed.map((s) => [modelKey("", s.slug), s]));

const keys = [...new Set([...rtByKey.keys(), ...rrByKey.keys()])].sort();
const both = keys.filter((k) => rtByKey.has(k) && rrByKey.has(k));

console.log(`RTINGS:    ${rt.parsed.length} моделей`);
console.log(`RunRepeat: ${rr.parsed.length} моделей`);
console.log(`Сопоставлено в обоих: ${both.length}`);
console.log(`Только RTINGS: ${keys.length - both.length - (rrByKey.size - both.length)}, только RunRepeat: ${rrByKey.size - both.length}\n`);

/**
 * Поля, где обе лаборатории меряют ОДНО И ТО ЖЕ.
 *
 * Ширина платформы взята с оговоркой: RTINGS даёт ширину ПОДОШВЫ, RunRepeat —
 * ширину МЕЖПОДОШВЫ в том же месте. Это близкие, но не тождественные величины;
 * сводим их вместе осознанно, потому что правило десяти процентов как раз и
 * поймает случаи, где разница перестала быть несущественной. Источник у каждого
 * числа подписан, так что разночтение видно глазами, а не спрятано.
 */
const COMPARABLE: { field: string; rtings: string; runrepeat: string; note?: string }[] = [
  { field: "weight_g", rtings: "weight_g", runrepeat: "weight_men_g" },
  { field: "stack_heel_mm", rtings: "stack_heel_mm", runrepeat: "stack_heel_mm" },
  { field: "stack_fore_mm", rtings: "stack_fore_mm", runrepeat: "stack_fore_mm" },
  { field: "drop_mm", rtings: "drop_mm", runrepeat: "drop_mm" },
  {
    field: "platform_width_heel_mm",
    rtings: "platform_width_heel_mm",
    runrepeat: "platform_width_heel_mm",
    note: "RTINGS меряет подошву, RunRepeat межподошву — величины близкие, но не одна и та же",
  },
  {
    field: "platform_width_fore_mm",
    rtings: "platform_width_fore_mm",
    runrepeat: "platform_width_fore_mm",
    note: "то же различие подошва/межподошва",
  },
];

type FieldOutcome = { key: string; field: string; status: string; detail: string };
const outcomes: FieldOutcome[] = [];

for (const key of both) {
  const a = rtByKey.get(key)!;
  const b = rrByKey.get(key)!;

  for (const c of COMPARABLE) {
    const obs: Observation[] = [];
    const sa = a.specs[c.rtings];
    const sb = b.specs[c.runrepeat];
    if (sa && typeof sa.value === "number") {
      obs.push({ source: "rtings", value: sa.value, kind: sa.kind, evidence: sa.evidence });
    }
    if (sb && typeof sb.value === "number") {
      obs.push({ source: "runrepeat", value: sb.value, kind: sb.kind, evidence: sb.evidence });
    }
    const r = reconcileNumber(c.field, obs);
    outcomes.push({
      key,
      field: c.field,
      status: r.status,
      detail: r.status === "ok" ? `${r.value} (${r.sources.join(" + ")})` : "note" in r ? r.note : "",
    });
  }
}

/* --------------------------------- Итог ------------------------------------ */

const byStatus = (s: string) => outcomes.filter((o) => o.status === s);
console.log(`Полей сведено: ${outcomes.length}`);
console.log(`  подтверждено двумя источниками: ${byStatus("ok").length}`);
console.log(`  расходятся больше чем на 10 %:  ${byStatus("divergent").length}`);
console.log(`  только один источник:           ${byStatus("single_source").length}`);
console.log(`  нет источника:                  ${byStatus("no_source").length}`);

const byField = new Map<string, { ok: number; div: number }>();
for (const o of outcomes) {
  const e = byField.get(o.field) ?? { ok: 0, div: 0 };
  if (o.status === "ok") e.ok += 1;
  if (o.status === "divergent") e.div += 1;
  byField.set(o.field, e);
}
console.log(`\nПо полям (подтверждено / разошлось):`);
for (const [f, e] of byField) {
  const total = e.ok + e.div;
  const pct = total > 0 ? Math.round((e.div / total) * 100) : 0;
  console.log(`  ${f.padEnd(26)} ${String(e.ok).padStart(3)} / ${String(e.div).padStart(3)}  (расхождений ${pct} %)`);
}

const divergent = byStatus("divergent");
console.log(`\nПримеры расхождений между лабораториями:`);
for (const d of divergent.slice(0, 10)) console.log(`  ${d.key} · ${d.detail}`);

writeFileSync(
  resolve(REPORTS, "merge-outcomes.json"),
  JSON.stringify({ matched: both.length, outcomes }, null, 2) + "\n"
);
console.log(`\nОтчёт: ${resolve(REPORTS, "merge-outcomes.json")}`);
