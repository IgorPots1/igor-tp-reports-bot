/**
 * Strength programs — READ-ONLY fetch of exercise details (parameters + instructions) for
 * library exercises that the 78 already-read ones (reports/strength/exercises/) don't cover.
 * GET-only by construction (getTpApiJsonRaw). Sequential, 0.7 s pause, skips existing files.
 *
 * Usage: tsx fetch-exercise-details.ts <outDir> <id> [<id> ...]
 * Output: <outDir>/<exerciseId>.json  ({status, body})
 */
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const CANON = "/Users/igor/igor-tp-reports-bot";
type Raw = { status: number; body: unknown };
const client = (await import(`${CANON}/src/features/trainingpeaks/tp-api-client.ts`)) as {
  getTpApiJsonRaw: (host: "tpapi" | "strength", apiPath: string) => Promise<Raw>;
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const exists = (p: string) => access(p).then(() => true, () => false);

const [outDir, ...ids] = process.argv.slice(2);
if (!outDir || ids.length === 0) throw new Error("usage: fetch-exercise-details.ts <outDir> <id>...");
await mkdir(outDir, { recursive: true });
for (const id of ids) {
  if (!/^\d+$/.test(id)) throw new Error(`bad id ${id}`);
  const out = path.join(outDir, `${id}.json`);
  if (await exists(out)) continue;
  const res = await client.getTpApiJsonRaw("strength", `/rx/activity/v1/exercises/${id}`);
  await writeFile(out, JSON.stringify(res, null, 2));
  console.log(id, res.status);
  await sleep(700);
}
