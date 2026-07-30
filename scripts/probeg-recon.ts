/**
 * Protocols recon (Фаза 10.3, step 0): size the work BEFORE building the matcher. Reads the club's
 * scanned races (trainingpeaks_race_events), collapses the 300+ per-athlete rows into UNIQUE events
 * (same date + same normalized title = one event, entered on many athletes' calendars), and reports
 * how many unique events there are, by year, with athlete counts.
 *
 * This is the DENOMINATOR for "how many of our races are on probeg.org". The probeg NUMERATOR (a
 * polite, cached lookup per unique event) is added once the exact probeg event-search URL is
 * confirmed — see the PROBEG section at the bottom. READ-ONLY: queries the roster/races, writes
 * NOTHING, hits no external site yet.
 *
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=.env.local scripts/probeg-recon.ts [--list]
 */
import { createSupabaseServerClient } from "@/features/supabase/server";

const SHOW_LIST = process.argv.includes("--list");

type RaceRow = { student_id: string; event_date: string | null; title: string | null; distance_raw: string | null };

/**
 * Normalize an event title for dedup + (later) matching: lowercase, ё→е, drop quotes/punctuation,
 * strip the generic filler ("марафон", "полумарафон", "забег", "эстафета", "трейл", "км") and bare
 * numbers, collapse whitespace. Same idea as the coach-desk radar's groupKey — over-stripping only
 * MERGES near-identical names, it never wrongly splits. Pure.
 */
export function normalizeEventTitle(raw: string): string {
  const norm = raw
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/[«»"'().,\-–—/]/gu, " ")
    .replace(/(полумарафон|марафон|забег|эстафета|трейл|ультра|пробег|км)/gu, " ")
    .replace(/\d+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return norm || raw.toLowerCase().trim();
}

async function loadAllRaceRows(): Promise<RaceRow[]> {
  const supabase = createSupabaseServerClient();
  const out: RaceRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("trainingpeaks_race_events")
      .select("student_id, event_date, title, distance_raw")
      .order("event_date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`load race_events failed: ${error.message}`);
    const rows = (data as RaceRow[] | null) ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break; // last page — avoids the silent 1000-row cap
  }
  return out;
}

type UniqueEvent = { date: string; normTitle: string; displayTitle: string; students: Set<string>; distances: Set<string> };

async function main(): Promise<void> {
  const rows = await loadAllRaceRows();
  const events = new Map<string, UniqueEvent>();
  let skipped = 0;
  for (const r of rows) {
    const date = (r.event_date ?? "").slice(0, 10);
    const title = (r.title ?? "").trim();
    if (!date || !title) {
      skipped += 1;
      continue;
    }
    const norm = normalizeEventTitle(title);
    const key = `${date}|${norm}`;
    const ev = events.get(key) ?? { date, normTitle: norm, displayTitle: title, students: new Set<string>(), distances: new Set<string>() };
    ev.students.add(r.student_id);
    if (r.distance_raw && r.distance_raw.trim()) ev.distances.add(r.distance_raw.trim());
    events.set(key, ev);
  }

  const uniq = [...events.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const byYear = new Map<string, number>();
  for (const e of uniq) {
    const y = e.date.slice(0, 4);
    byYear.set(y, (byYear.get(y) ?? 0) + 1);
  }

  console.log("=== ПРОТОКОЛЫ: разведка (денумератор) ===");
  console.log(`Строк в trainingpeaks_race_events: ${rows.length} (пропущено без даты/названия: ${skipped})`);
  console.log(`УНИКАЛЬНЫХ событий (дата + нормализованное название): ${uniq.length}`);
  console.log("");
  console.log("По годам:");
  for (const [y, n] of [...byYear.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    console.log(`  ${y}: ${n}`);
  }
  console.log("");
  const topByAthletes = [...uniq].sort((a, b) => b.students.size - a.students.size).slice(0, 15);
  console.log("Топ-15 событий по числу учеников (самые «клубные» старты):");
  for (const e of topByAthletes) {
    console.log(`  ${e.date} · ${e.displayTitle} · учеников ${e.students.size}${e.distances.size ? ` · ${[...e.distances].join(", ")}` : ""}`);
  }

  if (SHOW_LIST) {
    console.log("");
    console.log("=== ВСЕ уникальные события (дата · название · учеников) ===");
    for (const e of uniq) {
      console.log(`${e.date} · ${e.displayTitle} · ${e.students.size}`);
    }
  }

  console.log("");
  console.log("--- Следующий шаг (probeg-числитель) ---");
  console.log("Для каждого уникального события — вежливый поиск на probeg.org (задержка + кэш на диск),");
  console.log("сверка названия+даты с каталогом событий probeg → сколько из них там есть. Нужен точный");
  console.log("URL поиска событий probeg (форма «Название забега или часть названия»): открой probeg.org,");
  console.log("поищи любой старт по названию, пришли получившийся URL — допишу поиск корректно (не гадаю).");
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
