/**
 * Ожидаемые старты: разовый подсчёт без записи в базу. Обходит probeg.org по неделям за
 * период, сравнивает с календарём (view race_calendar) и печатает итог; полный список — в JSON.
 * Та же логика, что в стадии ?stage=expected edge-функции race-calendar-sync (общий модуль).
 *
 *   npx tsx --env-file=<.env.local> scripts/races-expected-preview.ts [from=2025-10-01] [out.json]
 */

import { writeFileSync } from "node:fs";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import {
  buildExpected,
  parsePastProbeg,
  probegPastUrl,
  weekWindows,
  type FutureRow,
  type PastRace,
} from "../supabase/functions/race-calendar-sync/expected";
import { politeFetch } from "./lib/polite-fetch";

const UA = "igorp.run race calendar (+https://igorp.run)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchWindow(from: string, to: string): Promise<PastRace[]> {
  for (let i = 0; i < 3; i++) {
    const r = await politeFetch(probegPastUrl(from, to), { headers: { "User-Agent": UA, "Accept-Language": "ru" } });
    if (r.ok) return parsePastProbeg(await r.text());
    await sleep(3000 * (i + 1));
  }
  throw new Error(`probeg ${from}..${to}: не ответил`);
}

async function main() {
  const from = process.argv[2] || "2025-10-01";
  const out = process.argv[3];
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const past: PastRace[] = [];
  let capped = 0;
  for (const [a, b] of weekWindows(from, yesterday)) {
    let rows = await fetchWindow(a, b);
    if (rows.length >= 100) {
      // Неделя упёрлась в 100 строк: дробим по дням.
      capped++;
      rows = [];
      for (const [d] of weekWindows(a, b).flatMap(([x, y]) => {
        const days: [string, string][] = [];
        for (let t = Date.parse(x); t <= Date.parse(y); t += 864e5) { const s = new Date(t).toISOString().slice(0, 10); days.push([s, s]); }
        return days;
      })) {
        rows.push(...(await fetchWindow(d, d)));
        await sleep(1200);
      }
    }
    past.push(...rows);
    await sleep(1200);
  }
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const sb = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const future: FutureRow[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from("race_calendar").select("id,name,date_start,city,region").gte("date_start", today).range(f, f + 999);
    if (error) throw error;
    future.push(...((data as FutureRow[]) || []));
    if (!data || data.length < 1000) break;
  }
  const uniq = new Map(past.map((p) => [p.sid, p]));
  const { expected, announced } = buildExpected([...uniq.values()], future);
  const byMonth: Record<number, number> = {};
  for (const e of expected) byMonth[e.last_month] = (byMonth[e.last_month] || 0) + 1;
  console.log(JSON.stringify({ windows_capped: capped, past_events: uniq.size, future_in_calendar: future.length, expected: expected.length, already_announced: announced.length, expected_with_100plus_finishers: expected.filter((e) => (e.last_finishers ?? 0) >= 100).length, by_month: byMonth }));
  if (out) writeFileSync(out, JSON.stringify({ expected, announced }, null, 1));
}

main().catch((e) => { console.error(e); process.exit(1); });
