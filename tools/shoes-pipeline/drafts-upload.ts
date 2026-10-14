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
import { isPriorityLine } from "./lib/allowed-models";
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
const existing = new Map((existingRows ?? []).map((r) => [r.id as string, r]));
let nextPos = Math.max(-1, ...[...existing.values()].filter((r) => r.batch > 0).map((r) => (r.batch - 1) * BATCH_SIZE + r.position)) + 1;

/** Поля, по которым Игорь уже решил, остаются его — обновляются только draft. */
function merge(old: CoachDraft["fields"] | undefined, fresh: CoachDraft["fields"]): CoachDraft["fields"] {
  const out: CoachDraft["fields"] = { ...fresh };
  for (const k of FIELD_KEYS) {
    const prev = old?.[k] as DraftField | undefined;
    if (prev && prev.status !== "draft") out[k] = prev;
  }
  return out;
}

const rows: Record<string, unknown>[] = [];
for (const r of ordered) {
  const prev = existing.get(r.id);
  const pos = prev ? (prev.batch - 1) * BATCH_SIZE + prev.position : nextPos++;
  const fields = merge(prev?.fields, fieldsOf(r));
  rows.push({
    id: r.id,
    brand: r.brand,
    model: r.model,
    kind: "reviewed",
    batch: Math.floor(pos / BATCH_SIZE) + 1,
    position: pos % BATCH_SIZE,
    confidence: r.confidence,
    note: r.confidence === "low" ? "один источник" : null,
    fields: prev ? fields : fieldsOf(r),
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
      // Набор полей у всех строк пакетной загрузки одинаковый: недостающее
      // PostgREST заполняет null, и not null на updated_at ронял всю загрузку.
      updated_at: new Date().toISOString(),
      fields: Object.fromEntries(FIELD_KEYS.map((k) => [k, { value: null, draft_value: null, status: "draft", evidence: [] }])),
    });
  }
}

const byBatch = rows.reduce<Record<number, number>>((m, r) => ((m[r.batch as number] = (m[r.batch as number] ?? 0) + 1), m), {});
console.log(`К загрузке: ${rows.length} (по пачкам: ${JSON.stringify(byBatch)}); уже в базе: ${existing.size}`);
if (DRY) process.exit(0);

const { error } = await supabase.from(TABLE).upsert(rows, { onConflict: "id" });
if (error) throw new Error(`загрузка ${TABLE}: ${error.message}`);
console.log("Загружено. Страница: /admin/shoes-review");
