/**
 * Загрузка черновиков в таблицу shoe_coach_drafts — для страницы проверки
 * /admin/shoes-review.
 *
 *   npx tsx --env-file=/Users/igor/igor-tp-reports-bot/.env.local \
 *     tools/shoes-pipeline/drafts-upload.ts [--dry]
 *
 * Пачки по 25 моделей; основные линейки первыми, внутри — по числу
 * заполненных полей. Решения Игоря НЕ затираются: при повторной загрузке
 * обновляются только поля в статусе draft, подтверждённые и «не знаю»
 * остаются как есть. Пачка 0 — пустые карточки китайских брендов: в открытых
 * источниках их почти нет, заполняет Игорь.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";

import type { CoachDraft, DraftField, DraftFieldKey } from "../../src/features/shoes/coach-drafts";
import { isPriorityLine, loadAllowedModels, newerGeneration } from "./lib/allowed-models";
import type { VerdictRecord } from "./lib/verdict-types";

const DRY = process.argv.includes("--dry");
const BATCH_SIZE = 25;
const TABLE = "shoe_coach_drafts";

/**
 * Китайские бренды: актуальные модели ИЗ ОБЩИХ ЗНАНИЙ, не из источников —
 * поэтому каждая помечена «проверь название». Название на странице правится.
 */
const CHINESE_MANUAL: { brand: string; models: string[] }[] = [
  { brand: "Li-Ning", models: ["Feidian 5 Elite", "Feidian 5 Challenger", "Chitu 8 Pro", "Red Rabbit 8 Pro", "Yueying 3"] },
  { brand: "ANTA", models: ["C202 6 GT", "C10 Pro 3", "Mach 5", "PG7"] },
  { brand: "Xtep", models: ["160X 7.0 Pro", "160X 6.0", "360X 2.0", "2000KM 2.0"] },
  { brand: "361 Degrees", models: ["Furious Future 3", "Flame 5", "Spire 6"] },
  { brand: "Bmai", models: ["модель уточнить"] },
];

const FIELD_KEYS: DraftFieldKey[] = [
  "purpose",
  "feel",
  "firmness",
  "width",
  "durability",
  "heel_hold",
  "winter_grip",
  "best_for",
  "not_for",
  "year",
];

function fieldsOf(r: VerdictRecord): CoachDraft["fields"] {
  const out: CoachDraft["fields"] = {};
  for (const key of FIELD_KEYS) {
    const value =
      key === "year" ? r.year : (r.verdicts as unknown as Record<string, unknown>)[key] ?? null;
    const evidence = r.evidence
      .filter((e) => e.field === key)
      .map((e) => ({ source_title: e.source_title ?? e.source, url: e.url, quote: e.quote ?? "" }));
    out[key] = { value, draft_value: value, status: "draft", evidence };
  }
  return out;
}

const filled = (r: VerdictRecord) =>
  Object.values(r.verdicts).filter((v) => v !== null && !(Array.isArray(v) && v.length === 0)).length;

const records: VerdictRecord[] = JSON.parse(
  readFileSync(resolve("tools/shoes-pipeline/reports/coach-drafts.json"), "utf8")
);
const ordered = [...records].sort(
  (a, b) => Number(isPriorityLine(b.model)) - Number(isPriorityLine(a.model)) || filled(b) - filled(a)
);

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY (--env-file=…/.env.local)");
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: existingRows, error: readErr } = await supabase.from(TABLE).select("id,batch,position,fields");
if (readErr) throw new Error(`чтение ${TABLE}: ${readErr.message}`);
/**
 * Сопоставление по ОЧИЩЕННОМУ имени. 14.10.2026 имя стало сводиться без
 * технологических приставок («Adizero Evo SL» = «Evo SL»), и id части уже
 * загруженных моделей изменились бы. Без этого загрузка создала бы дубли рядом
 * со строками, где Игорь уже принимает решения. Есть строка с тем же
 * очищенным именем — берётся её прежний id.
 */
const bareId = (id: string) => {
  const [brand, ...rest] = id.split("-");
  return `${brand}-${rest
    .join("-")
    .replace(/^(gel|fresh-foam-x|fresh-foam|fuelcell|air-zoom|zoom|adizero)-/, "")
    .replace(/^supercomp-elite/, "sc-elite")}`;
};
const existingRaw = new Map((existingRows ?? []).map((r) => [r.id as string, r]));
const byBare = new Map([...existingRaw.keys()].map((id) => [bareId(id), id]));
for (const r of records) {
  const legacy = byBare.get(bareId(r.id));
  if (legacy && legacy !== r.id) r.id = legacy;
}
const existing = existingRaw;
/** Поля, по которым Игорь уже решил, остаются его — обновляются только draft. */
function merge(old: CoachDraft["fields"] | undefined, fresh: CoachDraft["fields"]): CoachDraft["fields"] {
  if (!old) return fresh;
  const out: CoachDraft["fields"] = { ...fresh };
  for (const k of FIELD_KEYS) {
    const prev = old[k] as DraftField | undefined;
    if (prev && prev.status !== "draft") out[k] = prev;
  }
  return out;
}

/**
 * Поколение: если в индексе есть более новая версия той же линейки, это
 * видно в заметке модели — Игорь решает кнопкой «Убрать», устарела ли она.
 */
const index = loadAllowedModels();
const slug = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
function newerNote(r: VerdictRecord): string | null {
  const brandId = r.id.split("-")[0];
  const newer = newerGeneration({ key: r.id, brandId, brand: r.brand, model: slug(r.model), links: [] }, index);
  return newer ? `в индексе есть новее: ${newer.slice(brandId.length + 1)}` : null;
}

/**
 * Раскладка по пачкам. Пачка 1 и всё, что Игорь уже подтвердил или убрал, —
 * на своих местах. Остальное раскладывается заново с пачки 2: сначала --front
 * (актуальные версии вместо убранных как устаревшие) и --manual (пустые
 * карточки для версий, которых нет ни в одном источнике), потом остальное по
 * приоритету основных линеек.
 *
 *   --front id1,id2   --manual "Nike|Pegasus 42 Gore-Tex;Brand|Model"
 */
const argOf = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : null;
};
const front = (argOf("--front") ?? "").split(",").filter(Boolean);
const manualFront = (argOf("--manual") ?? "")
  .split(";")
  .filter(Boolean)
  .map((x) => {
    const [brand, model] = x.split("|");
    return { brand, model, id: `manual-${brand}-${model}`.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, "-") };
  });

type Slot = { batch: number; position: number };
const fixed = new Map<string, Slot>();
const { data: statusRows, error: stErr } = await supabase.from(TABLE).select("id,batch,position,status,kind");
if (stErr) throw new Error(`чтение статусов ${TABLE}: ${stErr.message}`);
for (const r of statusRows ?? []) {
  if (r.batch <= 1 || r.status !== "draft") fixed.set(r.id, { batch: r.batch, position: r.position });
}
const taken = new Set([...fixed.values()].map((x) => `${x.batch}:${x.position}`));
const layout = new Map<string, Slot>();
let cursor = 0;
const place = (id: string) => {
  if (fixed.has(id) || layout.has(id)) return;
  while (taken.has(`${Math.floor(cursor / BATCH_SIZE) + 2}:${cursor % BATCH_SIZE}`)) cursor++;
  layout.set(id, { batch: Math.floor(cursor / BATCH_SIZE) + 2, position: cursor % BATCH_SIZE });
  cursor++;
};
const recordIds = new Set(ordered.map((r) => r.id));
for (const id of front) {
  if (!recordIds.has(id)) console.log(`  --front: ${id} нет среди черновиков (не прочитан или убран) — пропускаю`);
  else place(id);
}
for (const m of manualFront) place(m.id);
// Модели, у которых в индексе есть поколение новее, — в конец: место в пачке
// занимают рабочие модели, а устаревшую Игорь уберёт кнопкой там, где она есть.
for (const r of ordered) if (!newerNote(r)) place(r.id);
for (const r of ordered) place(r.id);

const rows: Record<string, unknown>[] = [];
for (const r of ordered) {
  const prev = existing.get(r.id);
  const slot = fixed.get(r.id) ?? layout.get(r.id)!;
  rows.push({
    id: r.id,
    brand: r.brand,
    model: r.model,
    kind: "reviewed",
    batch: slot.batch,
    position: slot.position,
    confidence: r.confidence,
    note: [r.confidence === "low" ? "один источник" : null, newerNote(r)].filter(Boolean).join(" · ") || null,
    fields: merge(prev?.fields, fieldsOf(r)),
    updated_at: new Date().toISOString(),
  });
}
for (const m of manualFront) {
  if (existing.has(m.id)) continue;
  const slot = layout.get(m.id)!;
  rows.push({
    id: m.id,
    brand: m.brand,
    model: m.model,
    kind: "manual",
    batch: slot.batch,
    position: slot.position,
    confidence: null,
    note: "Актуальной версии нет ни в одном разрешённом источнике — пустая карточка, заполни сам.",
    fields: Object.fromEntries(FIELD_KEYS.map((k) => [k, { value: null, draft_value: null, status: "draft", evidence: [] }])),
    updated_at: new Date().toISOString(),
  });
}

let cn = 0;
for (const { brand, models } of CHINESE_MANUAL) {
  for (const model of models) {
    const id = `manual-${brand}-${model}`.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, "-");
    if (existing.has(id)) continue; // пустую карточку не пересоздаём — её заполняет Игорь
    rows.push({
      id,
      brand,
      model,
      kind: "manual",
      batch: 0,
      position: cn++,
      confidence: null,
      note: "Название из общих знаний, не из источника — проверь и поправь. Вердиктов нет: заполни сам.",
      fields: Object.fromEntries(FIELD_KEYS.map((k) => [k, { value: null, draft_value: null, status: "draft", evidence: [] }])),
      // Набор полей у всех строк пакетной загрузки одинаковый: недостающее
      // PostgREST заполняет null, и not null на updated_at ронял всю загрузку.
      updated_at: new Date().toISOString(),
    });
  }
}

const byBatch = rows.reduce<Record<number, number>>((m, r) => ((m[r.batch as number] = (m[r.batch as number] ?? 0) + 1), m), {});
console.log(`К загрузке: ${rows.length} (по пачкам: ${JSON.stringify(byBatch)}); уже в базе: ${existing.size}`);
if (DRY) {
  for (const r of rows.filter((x) => (x.batch as number) >= 2).sort((a, b) => (a.batch as number) * 100 + (a.position as number) - ((b.batch as number) * 100 + (b.position as number)))) {
    console.log(`  ${r.batch}:${r.position} ${r.brand} ${r.model}`);
  }
  process.exit(0);
}

const { error } = await supabase.from(TABLE).upsert(rows, { onConflict: "id" });
if (error) throw new Error(`загрузка ${TABLE}: ${error.message}`);
// Уже заведённые пустые карточки из --manual: переносится только место в
// пачке, содержимое не трогается — его, возможно, уже заполняет Игорь.
for (const m of manualFront) {
  const slot = layout.get(m.id);
  if (!existing.has(m.id) || !slot) continue;
  const { error: mvErr } = await supabase.from(TABLE).update({ batch: slot.batch, position: slot.position }).eq("id", m.id);
  if (mvErr) throw new Error(`место пустой карточки ${m.id}: ${mvErr.message}`);
}
console.log("Загружено. Страница: /admin/shoes-review");
