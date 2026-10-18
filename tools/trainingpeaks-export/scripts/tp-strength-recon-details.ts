/**
 * Strength recon, step 2b — READ-ONLY detail fetch. The calendar list
 * (workouts/calendar/...) returns summaries only (sequenceSummary = exercise titles,
 * set/block counts, no reps/weights), so each workout is read once via
 * GET /rx/activity/v1/workouts/{id}. Sequential, paused, resumable (skips files that
 * already exist). GET-only by construction (getTpApiJsonRaw).
 *
 * Input:  reports/strength/raw/<athleteId>.json (from tp-strength-recon-fetch.ts)
 * Output: reports/strength/detail/<workoutId>.json (gitignored, canonical checkout)
 */
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const CANON = "/Users/igor/igor-tp-reports-bot";
const RAW_DIR = path.join(CANON, "reports", "strength", "raw");
const OUT_DIR = path.join(CANON, "reports", "strength", "detail");
const PAUSE_MS = 700;

type Raw = { status: number; body: unknown };
const client = (await import(`${CANON}/src/features/trainingpeaks/tp-api-client.ts`)) as {
  getTpApiJsonRaw: (host: "tpapi" | "strength", apiPath: string) => Promise<Raw>;
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const exists = (p: string) => access(p).then(() => true, () => false);

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const ids: string[] = [];
  for (const file of await readdir(RAW_DIR)) {
    if (!/^\d+\.json$/.test(file)) continue;
    const data = JSON.parse(await readFile(path.join(RAW_DIR, file), "utf8")) as { workouts: Array<{ id: string }> };
    for (const w of data.workouts) ids.push(String(w.id));
  }
  console.log(`workouts to read: ${ids.length}`);
  let done = 0;
  let failed = 0;
  for (const id of ids) {
    const out = path.join(OUT_DIR, `${id}.json`);
    if (await exists(out)) {
      done += 1;
      continue;
    }
    await sleep(PAUSE_MS);
    const res = await client.getTpApiJsonRaw("strength", `/rx/activity/v1/workouts/${id}`);
    if (res.status !== 200) {
      failed += 1;
      console.log(`  <id> -> ${res.status}`);
    }
    await writeFile(out, `${JSON.stringify(res)}\n`);
    done += 1;
    if (done % 50 === 0) console.log(`  ${done}/${ids.length} (failed ${failed})`);
  }
  console.log(`done ${done}, failed ${failed}`);
}

await main();
