/**
 * Сборка каталога-кандидата и прогон через валидатор ПРИЛОЖЕНИЯ (раздел 5).
 *
 * Валидатор импортируется из приложения, а не копируется: разойтись они не
 * смогут по построению. Каталог-кандидат пишется РЯДОМ с боевым — подстановка
 * (раздел 8) остаётся отдельным шагом человека и только после чистой валидации.
 *
 * ВОПРОС К ПРАВИЛУ ДВУХ ИСТОЧНИКОВ. Наряд требует подтверждать числовое поле
 * двумя независимыми источниками. Для стека, дропа и веса это выполнимо: меряют
 * обе лаборатории. Но твёрдость межподошвы, жёсткость задника, износ и толщину
 * подошвы в мире публикует РОВНО ОДНА лаборатория. Буквальное правило означает,
 * что эти поля не попадут в базу никогда, — то есть подборщик не получит того,
 * ради чего затевался.
 *
 * Поэтому здесь сделано так: поле от единственного в мире источника принимается,
 * но помечается `single_source` в происхождении, и сборка отдельной строкой
 * говорит, сколько таких полей. Не спрятано, а поднято на поверхность —
 * послабление правила должен утвердить человек, а не заметить случайно.
 *
 *   npx tsx tools/shoes-pipeline/build-catalog.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { validateCatalog } from "../../src/features/shoes/schema";
import { mergeSources, RUNREPEAT_ONLY, type RtingsModel, type RunRepeatModel } from "./lib/merge";

const REPORTS = resolve("tools/shoes-pipeline/reports");
const read = <T>(name: string): T | null => {
  const p = resolve(REPORTS, name);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null;
};

const rt = read<{ parsed: RtingsModel[] }>("raw-rtings.json");
const rr = read<{ parsed: RunRepeatModel[] }>("raw-runrepeat.json");
if (!rt || !rr) {
  console.error("Нужны оба сбора: collect.ts и collect-runrepeat.ts");
  process.exit(1);
}

const { models, matched } = mergeSources(rt.parsed, rr.parsed);

/** Происхождение по полям — сайдкар, схема приложения не расширяется. */
type FieldProvenance = { sources: string[]; kind: string; evidence: string; single_source?: true };
const provenance: Record<string, Record<string, FieldProvenance>> = {};

const divergences: string[] = [];
let singleWorldwide = 0;
let singleAvoidable = 0;

const titleFromKey = (key: string) =>
  key.split("-").map((w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(" ");

const records = models.map((m) => {
  const fields: Record<string, FieldProvenance> = {};
  const value: Record<string, number | null> = {};

  for (const [field, r] of Object.entries(m.reconciled)) {
    if (r.status === "ok") {
      fields[field] = { sources: r.sources, kind: r.kind, evidence: `сведено из ${r.sources.join(" + ")}` };
      value[field] = r.value;
    } else if (r.status === "divergent") {
      divergences.push(`${m.key}.${field}: ${r.note}`);
      value[field] = null;
    } else {
      // Второй источник в природе есть, просто у нас его нет — это чинится
      // добором источников, а не послаблением правила.
      if (r.status === "single_source") singleAvoidable += 1;
      value[field] = null;
    }
  }

  // Поля единственной в мире лаборатории — принимаем с пометкой.
  for (const [field, spec] of Object.entries(m.single)) {
    if (!RUNREPEAT_ONLY.includes(field)) continue;
    fields[field] = { sources: [spec.source], kind: spec.kind, evidence: spec.evidence, single_source: true };
    singleWorldwide += 1;
  }

  provenance[m.key] = fields;

  return {
    id: m.key,
    brand: titleFromKey(m.key.split("-")[0]),
    model: titleFromKey(m.key.split("-").slice(1).join("-")),
    // Поля ниже разрешённые источники пока не закрывают — пишем null, а не
    // правдоподобное: пустое честно отбракуется, выдуманное доехало бы до людей.
    year: null,
    categories: [],
    surface: null,
    weight_g: value.weight_g ?? null,
    stack_heel_mm: value.stack_heel_mm ?? null,
    stack_fore_mm: value.stack_fore_mm ?? null,
    drop_mm: value.drop_mm ?? null,
    // Твёрдость в Asker C, а поле схемы — под Shore HA. Не подменяем шкалу.
    midsole_durometer_ha: null,
    softness: null,
    foam_type: null,
    plate: null,
    stability: null,
    last_width: null,
    platform_width_heel_mm: value.platform_width_heel_mm ?? null,
    platform_width_fore_mm: value.platform_width_fore_mm ?? null,
    outsole_durability: null,
    outsole_thickness_mm:
      typeof m.single.outsole_thickness_mm?.value === "number" ? m.single.outsole_thickness_mm.value : null,
    membrane: null,
    winter_grip: null,
    lug_depth_mm: null,
    heel_counter_stiffness:
      typeof m.single.heel_counter_stiffness?.value === "number" ? m.single.heel_counter_stiffness.value : null,
    variant_of: null,
    price: null,
    available: [],
    tier: null,
    genders: null,
    image: null,
    sources: m.sources,
    verified_at: null,
  };
});

const candidate = { catalog_kind: "production", shoes: records };
writeFileSync(resolve(REPORTS, "catalog.candidate.json"), JSON.stringify(candidate, null, 2) + "\n");
writeFileSync(resolve(REPORTS, "catalog.provenance.json"), JSON.stringify(provenance, null, 2) + "\n");
writeFileSync(resolve(REPORTS, "divergences.json"), JSON.stringify({ divergences }, null, 2) + "\n");

const result = validateCatalog(candidate);

console.log(`Моделей-кандидатов: ${records.length} (в двух источниках: ${matched})`);
console.log(`Прошли валидацию:   ${result.shoes.length}`);
console.log(`Отбраковано:        ${result.rejected.length}`);
console.log(`\nПолей принято от единственной в мире лаборатории: ${singleWorldwide}`);
console.log(`Полей ждут второго источника (добирается источниками): ${singleAvoidable}`);
console.log(`Расхождений между лабораториями (решает человек): ${divergences.length}`);

const problems = new Map<string, number>();
for (const r of result.rejected) {
  for (const p of r.problems) {
    const key = p.split(":")[0].trim();
    problems.set(key, (problems.get(key) ?? 0) + 1);
  }
}
console.log(`\nПочему отбраковано (поле → записей):`);
for (const [f, n] of [...problems].sort((a, b) => b[1] - a[1]).slice(0, 14)) {
  console.log(`  ${f.padEnd(34)} ${n}`);
}

console.log(
  `\n${"═".repeat(72)}\n` +
    (result.shoes.length === 0
      ? "БАЗУ ПОДСТАВЛЯТЬ НЕЛЬЗЯ: валидацию не прошла ни одна запись."
      : `Прошедших записей: ${result.shoes.length}. Подстановка — отдельным шагом человека.`)
);
