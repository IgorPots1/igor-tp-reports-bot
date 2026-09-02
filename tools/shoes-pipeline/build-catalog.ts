/**
 * Сборка каталога-кандидата и прогон через валидатор ПРИЛОЖЕНИЯ (раздел 5).
 *
 * Конвейер обязан проходить тот же валидатор, что и приложение, — не свой
 * похожий. Поэтому здесь импортируется ровно тот validateCatalog, который
 * читает базу в проде: разойтись они не смогут по построению.
 *
 * Каталог-кандидат пишется РЯДОМ с боевым, а не вместо него. Подстановка
 * (раздел 8) — отдельный шаг человека и только после чистой валидации.
 *
 *   npx tsx tools/shoes-pipeline/build-catalog.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { validateCatalog } from "../../src/features/shoes/schema";
import { reconcileNumber, type Observation } from "./lib/reconcile";
import type { ParsedSpec, RtingsShoe } from "./lib/parsers/rtings";

const REPORTS = resolve("tools/shoes-pipeline/reports");
const RAW = resolve(REPORTS, "raw-rtings.json");
if (!existsSync(RAW)) {
  console.error("Нет собранных данных. Сначала: npx tsx tools/shoes-pipeline/collect.ts");
  process.exit(1);
}
const { parsed } = JSON.parse(readFileSync(RAW, "utf8")) as { parsed: RtingsShoe[] };

/** Происхождение каждого поля — сайдкар, чтобы не расширять схему приложения. */
type Provenance = Record<string, Record<string, { sources: string[]; kind: string; evidence: string }>>;
const provenance: Provenance = {};

const asObservation = (source: string, spec: ParsedSpec): Observation[] =>
  typeof spec.value === "number"
    ? [{ source, value: spec.value, kind: spec.kind, evidence: spec.evidence }]
    : [];

const slugToTitle = (s: string) =>
  s.split("-").map((w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(" ");

const records: Record<string, unknown>[] = [];
const divergences: string[] = [];
const singleSource: string[] = [];

for (const shoe of parsed) {
  const id = `${shoe.brandSlug}-${shoe.modelSlug}`;
  const fields: Provenance[string] = {};

  const take = (field: string, spec: ParsedSpec | undefined): number | null => {
    if (!spec) return null;
    const r = reconcileNumber(field, asObservation("rtings", spec));
    if (r.status === "divergent") {
      divergences.push(`${id}.${field}: ${r.note}`);
      return null;
    }
    if (r.status === "single_source") {
      // Правило наряда: числовое поле требует двух независимых источников.
      // Один есть — значит поле НЕ заполняем и говорим, чего не хватило.
      singleSource.push(`${id}.${field}: ${r.note}`);
      return null;
    }
    if (r.status === "no_source") return null;
    fields[field] = { sources: r.sources, kind: r.kind, evidence: spec.evidence };
    return r.value;
  };

  const heel = take("stack_heel_mm", shoe.specs.stack_heel_mm);

  // Перепад — единственное поле, где у нас есть ДВА разных по происхождению
  // числа: замер RTINGS и цифра производителя, которую RTINGS перепечатывает.
  // Второе не подтверждает первое (это не независимая проверка), но и молчать
  // о нём нельзя: расходятся они у двух моделей из трёх, иногда вдвое. Пусть
  // сверка сама решит — и отправит расхождение человеку.
  const dropObs: Observation[] = [
    ...asObservation("rtings (замер)", shoe.specs.drop_mm),
    ...asObservation("производитель (через rtings)", shoe.specs.drop_declared_mm),
  ];
  const dropR = reconcileNumber("drop_mm", dropObs);
  let drop: number | null = null;
  if (dropR.status === "divergent") {
    divergences.push(`${id}.drop_mm: ${dropR.note}`);
  } else if (dropR.status === "ok") {
    fields.drop_mm = {
      sources: dropR.sources,
      kind: dropR.kind,
      evidence: shoe.specs.drop_mm.evidence,
    };
    drop = dropR.value;
  } else if (dropR.status === "single_source") {
    singleSource.push(`${id}.drop_mm: ${dropR.note}`);
  }

  records.push({
    id,
    brand: slugToTitle(shoe.brandSlug),
    model: slugToTitle(shoe.modelSlug),
    // Всё, что ниже, разрешённые источники не закрывают. Пишем null, а не
    // правдоподобное: пустое поле честно отбракуется валидатором, выдуманное
    // доехало бы до человека.
    year: null,
    categories: [],
    surface: null,
    weight_g: take("weight_g", shoe.specs.weight_g),
    stack_heel_mm: heel,
    stack_fore_mm: heel !== null && drop !== null ? Number((heel - drop).toFixed(1)) : null,
    drop_mm: drop,
    midsole_durometer_ha: null,
    softness: null,
    foam_type: null,
    plate: typeof shoe.specs.plate?.value === "string" ? shoe.specs.plate.value.toLowerCase() : null,
    stability: null,
    last_width: null,
    platform_width_heel_mm: take("platform_width_heel_mm", shoe.specs.platform_width_heel_mm),
    platform_width_fore_mm: take("platform_width_fore_mm", shoe.specs.platform_width_fore_mm),
    outsole_durability: null,
    outsole_thickness_mm: null,
    membrane: null,
    winter_grip: null,
    lug_depth_mm: null,
    heel_counter_stiffness: null,
    variant_of: null,
    price: null,
    available: [],
    tier: null,
    genders: null,
    image: null,
    sources: Object.keys(fields).length > 0 ? ["rtings"] : [],
    verified_at: null,
  });
  provenance[id] = fields;
}

const candidate = { catalog_kind: "production", shoes: records };
writeFileSync(resolve(REPORTS, "catalog.candidate.json"), JSON.stringify(candidate, null, 2) + "\n");
writeFileSync(resolve(REPORTS, "catalog.provenance.json"), JSON.stringify(provenance, null, 2) + "\n");

/* --------------------- Валидация валидатором приложения -------------------- */

const result = validateCatalog(candidate);

console.log(`Записей-кандидатов: ${records.length}`);
console.log(`Прошли валидацию:   ${result.shoes.length}`);
console.log(`Отбраковано:        ${result.rejected.length}`);

const problemCount = new Map<string, number>();
for (const r of result.rejected) {
  for (const p of r.problems) {
    const key = p.split(":")[0].trim();
    problemCount.set(key, (problemCount.get(key) ?? 0) + 1);
  }
}
console.log(`\nПочему отбраковано (поле → сколько записей):`);
for (const [field, n] of [...problemCount].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`  ${field.padEnd(30)} ${n}`);
}

console.log(`\nПолей не хватило источников (нужен второй): ${singleSource.length}`);
console.log(`Расхождений между источниками:              ${divergences.length}`);
writeFileSync(
  resolve(REPORTS, "divergences.json"),
  JSON.stringify({ divergent: divergences, singleSource }, null, 2) + "\n"
);

console.log(
  `\n${"═".repeat(72)}\n` +
    (result.shoes.length === 0
      ? "БАЗУ ПОДСТАВЛЯТЬ НЕЛЬЗЯ: ни одна запись не прошла валидацию.\n" +
        "Это не поломка конвейера, а его работа: разрешённые источники не\n" +
        "закрывают обязательные поля схемы, и придумывать их он не станет."
      : `Прошедших записей: ${result.shoes.length}. Подстановка — отдельным шагом человека.`)
);
