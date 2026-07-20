// Backfill trainingpeaks_workout_derived_metrics.comparison_key for rows that
// predate the column, computing the key from the plan structure with the SAME
// function the ingest now uses (comparison/comparison-key.ts). Run AFTER the
// migration 20260720000000_add_comparison_key_to_derived_metrics.sql is applied.
//
// Read-only by default (--dry-run): prints the key distribution and how many
// rows would change, writes nothing. Only --apply performs the UPDATEs, grouped
// by key value (one .update().in(ids) per distinct non-null key). Igor runs
// --apply; this script does not self-apply.
//
//   npx tsx tools/trainingpeaks-export/scripts/tp-comparison-key-backfill.ts            # dry-run
//   npx tsx tools/trainingpeaks-export/scripts/tp-comparison-key-backfill.ts --apply    # writes

import process from "node:process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import * as supabaseServerModule from "../../../src/features/supabase/server.ts";
import * as comparisonKeyModule from "../../../src/features/trainingpeaks/comparison/comparison-key.ts";

type NamespaceWithOptionalDefault<T> = T & { default?: T };
const supabaseServer = supabaseServerModule as NamespaceWithOptionalDefault<typeof supabaseServerModule>;
const createSupabaseServerClient =
  supabaseServer.createSupabaseServerClient ?? supabaseServer.default?.createSupabaseServerClient;
const comparisonKey = comparisonKeyModule as NamespaceWithOptionalDefault<typeof comparisonKeyModule>;
const computeComparisonKey = comparisonKey.computeComparisonKey ?? comparisonKey.default?.computeComparisonKey;

if (typeof createSupabaseServerClient !== "function") throw new Error("createSupabaseServerClient unavailable");
if (typeof computeComparisonKey !== "function") throw new Error("computeComparisonKey unavailable");

// Secrets live in the PRIMARY checkout's .env.local; a worktree has none.
function loadEnv(): void {
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(import.meta.dirname, "..", "..", "..", ".env.local"),
    "/Users/igor/igor-tp-reports-bot/.env.local",
  ];
  for (const dotEnvPath of candidates) {
    if (!existsSync(dotEnvPath)) continue;
    for (const line of readFileSync(dotEnvPath, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const sep = trimmed.indexOf("=");
      if (sep < 0) continue;
      const key = trimmed.slice(0, sep).trim();
      if (!key || process.env[key] !== undefined) continue;
      let value = trimmed.slice(sep + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

// Deliberately does NOT read the existing comparison_key column: the dry-run
// must work BEFORE the migration is applied (the column doesn't exist yet), and
// the write is idempotent (it sets the freshly computed key regardless).
type DerivedIdRow = { id: string; workout_cache_id: string };
type CacheStructureRow = { id: string; structure: unknown };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function withRetry<T>(fn: () => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const res = await fn();
      if (res.error) throw new Error(res.error.message);
      return res;
    } catch (error) {
      lastError = error;
      await sleep(300 * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const pageSize = 1000;
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const { data } = await withRetry<T>(() => build(from, from + pageSize - 1));
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function main(): Promise<void> {
  loadEnv();
  const apply = process.argv.includes("--apply");
  const supabase = createSupabaseServerClient();

  const derivedRows = await fetchAll<DerivedIdRow>((from, to) =>
    supabase
      .from("trainingpeaks_workout_derived_metrics")
      .select("id, workout_cache_id")
      .order("id", { ascending: true })
      .range(from, to)
  );
  console.log(`derived rows: ${derivedRows.length}`);

  const cacheIds = [...new Set(derivedRows.map((r) => r.workout_cache_id))];
  const structureByCacheId = new Map<string, unknown>();
  for (const ids of chunk(cacheIds, 150)) {
    const rows = await fetchAll<CacheStructureRow>((from, to) =>
      supabase
        .from("trainingpeaks_workout_cache")
        .select("id, structure:source_snapshot->structure")
        .in("id", ids)
        .order("id", { ascending: true })
        .range(from, to)
    );
    for (const row of rows) structureByCacheId.set(row.id, row.structure);
  }

  // Compute the key for every derived row; only non-null keys are written
  // (null is the column default, so a null-keyed row needs no UPDATE).
  const idsByNewKey = new Map<string, string[]>();
  let nullKey = 0;
  for (const row of derivedRows) {
    const newKey = computeComparisonKey(structureByCacheId.get(row.workout_cache_id) ?? null);
    if (newKey === null) {
      nullKey += 1;
      continue;
    }
    const list = idsByNewKey.get(newKey) ?? [];
    list.push(row.id);
    idsByNewKey.set(newKey, list);
  }

  const distinctKeys = [...idsByNewKey.keys()].sort();
  const rowsToSet = [...idsByNewKey.values()].reduce((n, l) => n + l.length, 0);
  console.log(`\n=== key distribution (rows that would get a non-null key) ===`);
  for (const key of distinctKeys) {
    console.log(`  ${idsByNewKey.get(key)!.length.toString().padStart(5)}  ${key}`);
  }
  console.log(`\ndistinct keys: ${distinctKeys.length}`);
  console.log(`rows -> non-null key: ${rowsToSet}`);
  console.log(`rows staying null (non-interval / unkeyable): ${nullKey}`);

  if (!apply) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply to write (Igor's hand).`);
    return;
  }

  let written = 0;
  for (const key of distinctKeys) {
    const ids = idsByNewKey.get(key)!;
    for (const idChunk of chunk(ids, 500)) {
      const { error } = await supabase
        .from("trainingpeaks_workout_derived_metrics")
        .update({ comparison_key: key })
        .in("id", idChunk);
      if (error) throw new Error(`update failed for key ${key}: ${error.message}`);
      written += idChunk.length;
    }
  }
  console.log(`\nAPPLIED — ${written} rows updated.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
