/**
 * Читалка истории анкетных полей: кто, когда, с какого значения на какое и откуда.
 *
 * Провенанс, который нельзя прочитать глазами, равен отсутствующему: вчерашний
 * разбор «кто поставил потолок 80» занял полчаса не потому, что данных не было,
 * а потому, что их негде было посмотреть. Это самый дешёвый способ смотреть —
 * без пересборки админки.
 *
 *   npm run anketa:history -- <sourceId>
 *   npm run anketa:history -- 40986bda-db39-43b8-aae3-86bce1b1f505
 */
import process from "node:process";

import { originLabelRu, type FieldOrigin } from "@/features/intervals/loop/onboarding-history";
import { createSupabaseServerClient } from "@/features/supabase/server";

const sourceId = process.argv[2];
if (!sourceId) {
  console.error("Нужен sourceId: npm run anketa:history -- <uuid>");
  process.exit(1);
}

const supabase = createSupabaseServerClient();

const { data, error } = await supabase
  .from("intervals_onboarding_field_history")
  .select("field, value_before, value_after, changed_by, origin, note, changed_at")
  .eq("source_id", sourceId)
  .order("changed_at", { ascending: true });
if (error) throw new Error(`история анкеты: ${error.message}`);

const rows = (data ?? []) as unknown as {
  field: string;
  value_before: string | null;
  value_after: string | null;
  changed_by: string;
  origin: FieldOrigin | null;
  note: string | null;
  changed_at: string;
}[];

if (rows.length === 0) {
  console.log("Истории по этому подключению нет.");
  console.log("Это не значит, что анкету не правили: история ведётся с 12.10.2026.");
  process.exit(0);
}

console.log(`ИСТОРИЯ АНКЕТЫ — ${rows.length} записей`);
for (const row of rows) {
  const when = row.changed_at.slice(0, 16).replace("T", " ");
  const from = row.value_before ?? "—";
  const to = row.value_after ?? "—";
  console.log("");
  console.log(`${when}  ${row.field}: ${from} → ${to}`);
  console.log(`  кто: ${row.changed_by}   откуда: ${originLabelRu(row.origin)}`);
  if (row.note) console.log(`  ${row.note}`);
}
