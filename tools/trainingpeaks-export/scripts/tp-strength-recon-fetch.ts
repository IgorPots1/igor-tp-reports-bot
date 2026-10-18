/**
 * Strength recon, step 2a — READ-ONLY fetch of every coached athlete's structured
 * strength workouts from api.peakswaresb.com (GET workouts/calendar/{athleteId}/{from}/{to}).
 *
 * GET-only by construction (getTpApiJsonRaw has no method parameter). Sequential, one
 * request at a time with a pause between requests — no parallel hammering of TP.
 * 403 «Caller cannot edit person» and other non-2xx are recorded, never worked around.
 *
 * Output (contains names/ids → gitignored reports/ in the canonical checkout):
 *   /Users/igor/igor-tp-reports-bot/reports/strength/raw/<athleteId>.json
 *   /Users/igor/igor-tp-reports-bot/reports/strength/raw/_fetch-log.json
 *
 *   tsx tools/trainingpeaks-export/scripts/tp-strength-recon-fetch.ts [--from=2025-10-18] [--to=2026-11-08]
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const CANON = "/Users/igor/igor-tp-reports-bot";
const OUT_DIR = path.join(CANON, "reports", "strength", "raw");
const PAUSE_MS = 700;
const CHUNK_DAYS = 90;

type Raw = { status: number; body: unknown };
const client = (await import(`${CANON}/src/features/trainingpeaks/tp-api-client.ts`)) as {
  getTpApiJsonRaw: (host: "tpapi" | "strength", apiPath: string) => Promise<Raw>;
  getCoachedAthletesRoster: () => Promise<Array<{ athleteId: number; displayName: string }>>;
  chunkDateRangeInclusive: (a: string, b: string, max?: number) => Array<{ start: string; end: string }>;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const arg = (name: string, fallback: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;

async function main(): Promise<void> {
  const from = arg("from", "2025-10-18");
  const to = arg("to", "2026-11-08");
  await mkdir(OUT_DIR, { recursive: true });

  const roster = await client.getCoachedAthletesRoster();
  console.log(`roster: ${roster.length} athletes; range ${from}..${to}`);
  const chunks = client.chunkDateRangeInclusive(from, to, CHUNK_DAYS);
  const log: Array<Record<string, unknown>> = [];

  for (const [index, athlete] of roster.entries()) {
    const workouts: unknown[] = [];
    const statuses: Array<{ chunk: string; status: number; error?: unknown }> = [];
    for (const chunk of chunks) {
      await sleep(PAUSE_MS);
      let res: Raw;
      try {
        res = await client.getTpApiJsonRaw(
          "strength",
          `/rx/activity/v1/workouts/calendar/${athlete.athleteId}/${chunk.start}/${chunk.end}`,
        );
      } catch (error) {
        statuses.push({ chunk: `${chunk.start}..${chunk.end}`, status: -1, error: String(error) });
        continue;
      }
      if (res.status >= 200 && res.status < 300 && Array.isArray(res.body)) {
        workouts.push(...res.body);
        statuses.push({ chunk: `${chunk.start}..${chunk.end}`, status: res.status });
      } else {
        statuses.push({ chunk: `${chunk.start}..${chunk.end}`, status: res.status, error: res.body });
        if (res.status === 403) break; // permission, not transient: don't keep asking for the same person
      }
    }
    const ok = statuses.every((s) => s.status >= 200 && s.status < 300);
    await writeFile(
      path.join(OUT_DIR, `${athlete.athleteId}.json`),
      `${JSON.stringify({ athleteId: athlete.athleteId, displayName: athlete.displayName, from, to, statuses, workouts }, null, 2)}\n`,
    );
    log.push({ athleteId: athlete.athleteId, displayName: athlete.displayName, ok, count: workouts.length, statuses });
    console.log(`[${index + 1}/${roster.length}] <athlete> ok=${ok} strength=${workouts.length}${ok ? "" : ` statuses=${statuses.map((s) => s.status).join(",")}`}`);
  }
  await writeFile(path.join(OUT_DIR, "_fetch-log.json"), `${JSON.stringify({ from, to, fetchedAt: new Date().toISOString(), log }, null, 2)}\n`);
}

await main();
