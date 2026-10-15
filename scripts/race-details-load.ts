/**
 * Выжимка по стартам → public.race_details (наряд 15.10.2026).
 *
 *   npx tsx --env-file=<.env.local> scripts/race-details-load.ts <dir> [--apply]
 *
 * Читает <dir>/batch-*.out.json (собраны по ~/ops-log/races/details/INSTRUCTIONS.md) и пишет поля
 * в race_details upsert'ом по (race_id, distance, field). По умолчанию холостой прогон: печатает,
 * сколько строк и по каким полям записал бы, и что отбросил (неизвестное поле, пустое значение,
 * старта нет в календаре). Пишет только в race_details; календарь и треки не трогает.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { createSupabaseServerClient } from "@/features/supabase/server";

export const DETAIL_FIELDS = [
  "start_time", "waves", "start_place", "finish_place", "packet_pickup", "cutoff",
  "aid_stations", "baggage", "changing_rooms", "registration_status", "next_price_increase", "track",
] as const;
type Field = (typeof DETAIL_FIELDS)[number];

type OutRace = {
  race_id: string;
  checked_at: string;
  fields: { distance: number | null; field: string; value: string; source_url: string | null }[];
};

export type DetailRow = { race_id: string; distance: number | null; field: Field; value: string; source_url: string | null; checked_at: string };

/** Строки для записи и отказы: только известные поля, непустое значение до 400 знаков, дата ISO. */
export function toRows(races: OutRace[], known: Set<string>): { rows: DetailRow[]; rejected: string[] } {
  const rows = new Map<string, DetailRow>();
  const rejected: string[] = [];
  for (const r of races) {
    if (!known.has(r.race_id)) { rejected.push(`${r.race_id}: старта нет в календаре`); continue; }
    const checked = /^\d{4}-\d{2}-\d{2}$/.test(r.checked_at) ? r.checked_at : null;
    if (!checked) { rejected.push(`${r.race_id}: дата проверки «${r.checked_at}»`); continue; }
    for (const f of r.fields ?? []) {
      if (!(DETAIL_FIELDS as readonly string[]).includes(f.field)) { rejected.push(`${r.race_id}: поле «${f.field}»`); continue; }
      const value = String(f.value ?? "").replace(/\s+/g, " ").trim();
      if (!value) { rejected.push(`${r.race_id}/${f.field}: пустое значение`); continue; }
      const distance = f.distance == null || !Number.isFinite(Number(f.distance)) ? null : Number(f.distance);
      const key = `${r.race_id}|${distance ?? ""}|${f.field}`;
      // одно значение на поле и дистанцию: повтор склеиваем через «; »
      const prev = rows.get(key);
      const merged = prev && !prev.value.includes(value) ? `${prev.value}; ${value}` : prev?.value ?? value;
      rows.set(key, { race_id: r.race_id, distance, field: f.field as Field, value: merged.slice(0, 400), source_url: f.source_url ?? prev?.source_url ?? null, checked_at: checked });
    }
  }
  return { rows: [...rows.values()], rejected };
}

async function main() {
  const dir = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!dir) throw new Error("race-details-load.ts <dir> [--apply]");
  const races = readdirSync(dir)
    .filter((f) => /^batch-\d+\.out\.json$/.test(f))
    .flatMap((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as OutRace[]);
  const db = createSupabaseServerClient();
  const known = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("race_calendar").select("id").order("id").range(from, from + 999);
    if (error) throw new Error(`race_calendar: ${error.message}`);
    for (const x of data ?? []) known.add(x.id as string);
    if (!data || data.length < 1000) break;
  }
  const { rows, rejected } = toRows(races, known);
  const byField = new Map<string, number>();
  for (const r of rows) byField.set(r.field, (byField.get(r.field) ?? 0) + 1);
  console.log(`стартов в файлах ${races.length}, строк ${rows.length}`);
  console.log([...byField].map(([f, n]) => `  ${f}: ${n}`).join("\n"));
  if (rejected.length) console.log(`отброшено ${rejected.length}:\n  ${rejected.slice(0, 30).join("\n  ")}`);
  if (!apply) return console.log("холостой прогон: в базу ничего не записано (--apply для записи)");
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map((r) => ({ ...r, updated_at: new Date().toISOString() }));
    const { error } = await db.from("race_details").upsert(chunk, { onConflict: "race_id,distance,field" });
    if (error) throw new Error(`race_details: ${error.message}`);
  }
  console.log(`записано ${rows.length}`);
}

if (process.argv[1]?.endsWith("race-details-load.ts")) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
