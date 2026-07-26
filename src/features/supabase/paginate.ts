// Shared pagination for Supabase reads.
//
// PostgREST enforces a HARD server cap of 1000 rows per response (db-max-rows=1000
// on this project — verified empirically: `.limit(6000)` returns 1000, and
// `.range(1000,2999)` returns 1000). Therefore:
//   • `.limit(N)` with N>1000 is NOT a cap raise — it silently truncates at 1000.
//   • a pagination PAGE must be exactly 1000 rows (`.range(from, from+999)`); a
//     larger page returns 1000 < pageSize and a naive loop would stop after page 1.
//   • the read MUST carry a stable total `.order()` (e.g. by `id`) or pages overlap.
//
// `fetchAllRows` loops `.range()` to completion. `fetchAllInChunks` additionally
// chunks a big `.in()` list (URL-length) AND paginates each chunk's result (row-cap)
// — the disguised bug where a chunked `.in()` is not paged and masquerades as
// network flakiness. `warnIfAtCap` is the loud guard for reads not yet migrated.

export const SUPABASE_MAX_ROWS = 1000;

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

/**
 * Read every row by paging `.range(from, from+pageSize-1)` until a short page proves
 * the end. `page(from, to)` MUST build a fresh query each call with a stable
 * `.order()` (pages overlap otherwise). pageSize is clamped to the 1000 server cap.
 */
export async function fetchAllRows<T>(
  page: (from: number, to: number) => Promise<PageResult<T>>,
  opts: { label: string; pageSize?: number }
): Promise<T[]> {
  const pageSize = Math.min(opts.pageSize ?? SUPABASE_MAX_ROWS, SUPABASE_MAX_ROWS);
  const out: T[] = [];
  let from = 0;
  const MAX_PAGES = 100_000; // ~100M rows — a backstop against a runaway loop
  for (let p = 0; p < MAX_PAGES; p += 1) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) {
      throw new Error(`fetchAllRows[${opts.label}] failed at offset ${from}: ${error.message}`);
    }
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) {
      return out;
    }
    from += pageSize;
  }
  throw new Error(`fetchAllRows[${opts.label}] exceeded ${MAX_PAGES} pages — aborting`);
}

/** Split a large id list into chunks (URL-length guard for `.in()`). */
export function chunkIds<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Chunk a big `.in()` id list AND paginate each chunk's result. `pageForChunk`
 * builds a fresh query for one chunk at a given range, with a stable `.order()`.
 */
export async function fetchAllInChunks<T>(
  ids: string[],
  chunkSize: number,
  pageForChunk: (chunkIds: string[], from: number, to: number) => Promise<PageResult<T>>,
  opts: { label: string }
): Promise<T[]> {
  const out: T[] = [];
  for (const c of chunkIds(ids, chunkSize)) {
    if (c.length === 0) continue;
    const rows = await fetchAllRows<T>((from, to) => pageForChunk(c, from, to), opts);
    out.push(...rows);
  }
  return out;
}

/**
 * Loud guard for a read that is NOT (yet) paginated: warn when the row count comes
 * back exactly at the cap — the signature of silent truncation. Use at call sites
 * that still issue a single-shot `.limit()`/select until they are migrated.
 */
export function warnIfAtCap(rowCount: number, label: string, cap: number = SUPABASE_MAX_ROWS): void {
  if (rowCount >= cap) {
    console.warn(
      `[pagination] ${label}: returned exactly ${rowCount} rows (== ${cap} cap) — SUSPECT SILENT TRUNCATION; this read must paginate`
    );
  }
}
