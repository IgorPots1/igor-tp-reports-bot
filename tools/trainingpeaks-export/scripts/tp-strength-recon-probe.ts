/**
 * Strength recon, step 1 — READ-ONLY probe of the TP structured-strength service
 * (api.peakswaresb.com/rx/activity) and the coach's workout libraries.
 *
 * Every request goes through getTpApiJsonRaw(), which has NO method parameter and is
 * GET-only by construction. Nothing here can create, change, hide or delete anything
 * in TrainingPeaks. No Supabase, no Telegram.
 *
 * Endpoints come from the TP web client bundle (release-20261016, modules-23bb80da.js,
 * the "activity" data source: _v1BaseUrl = "v1/" under ACTIVITY_ROOT =
 * https://api.peakswaresb.com/rx/activity) — see docs/tp-strength-api-recon.md.
 *
 * Run from anywhere (deps resolve from the canonical checkout):
 *   /Users/igor/igor-tp-reports-bot/tools/trainingpeaks-export/node_modules/.bin/tsx \
 *     tools/trainingpeaks-export/scripts/tp-strength-recon-probe.ts [--athlete=3102415]
 *
 * Raw responses (may contain athlete names/ids) go to
 * /Users/igor/igor-tp-reports-bot/reports/strength/probe/ (gitignored). Stdout prints
 * shapes and counts only.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const CANON = "/Users/igor/igor-tp-reports-bot";
const OUT_DIR = path.join(CANON, "reports", "strength", "probe");
const PAUSE_MS = 600;

type Raw = { status: number; body: unknown };

const client = (await import(`${CANON}/src/features/trainingpeaks/tp-api-client.ts`)) as {
  getTpApiJsonRaw: (host: "tpapi" | "strength", apiPath: string) => Promise<Raw>;
};
const snapshotMod = (await import(`${CANON}/src/features/trainingpeaks/tp-session-snapshot.ts`)) as {
  readSessionSnapshot: () => Promise<{ cookieExpiresAtMs: number | null; capturedAtMs: number }>;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function shape(value: unknown, depth = 0): unknown {
  if (depth > 3) return "…";
  if (Array.isArray(value)) return value.length === 0 ? [] : [`len=${value.length}`, shape(value[0], depth + 1)];
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = shape(v, depth + 1);
    return out;
  }
  return value === null ? null : typeof value;
}

async function get(host: "tpapi" | "strength", apiPath: string, saveAs: string): Promise<Raw> {
  await sleep(PAUSE_MS);
  const res = await client.getTpApiJsonRaw(host, apiPath);
  await writeFile(path.join(OUT_DIR, `${saveAs}.json`), `${JSON.stringify({ host, apiPath, ...res }, null, 2)}\n`);
  console.log(`GET ${host} ${apiPath.replace(/\d{6,}/g, "<id>")} -> ${res.status}`);
  return res;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const athleteArg = process.argv.find((a) => a.startsWith("--athlete="));
  const athleteId = Number(athleteArg?.split("=")[1] ?? 3102415);
  await mkdir(OUT_DIR, { recursive: true });

  const snap = await snapshotMod.readSessionSnapshot();
  console.log(
    `snapshot: capturedAt=${new Date(snap.capturedAtMs).toISOString()} cookieExpiresAt=${
      snap.cookieExpiresAtMs ? new Date(snap.cookieExpiresAtMs).toISOString() : "null"
    }`,
  );

  const today = new Date();
  const from = new Date(today.getTime() - 60 * 86400_000);
  const to = new Date(today.getTime() + 14 * 86400_000);

  const cal = await get("strength", `/rx/activity/v1/workouts/calendar/${athleteId}/${iso(from)}/${iso(to)}`, "calendar");
  console.log("calendar shape:", JSON.stringify(shape(cal.body)).slice(0, 1500));

  const lib = await get("strength", "/rx/activity/v1/libraryContent", "libraryContent");
  console.log("libraryContent shape:", JSON.stringify(shape(lib.body)).slice(0, 1500));

  const pEx = await get("strength", "/rx/activity/v1/parameters/exercise", "parameters-exercise");
  console.log("parameters/exercise shape:", JSON.stringify(shape(pEx.body)).slice(0, 800));
  const pBl = await get("strength", "/rx/activity/v1/parameters/block", "parameters-block");
  console.log("parameters/block shape:", JSON.stringify(shape(pBl.body)).slice(0, 800));

  const libs = await get("tpapi", "/exerciselibrary/v2/libraries", "tpapi-libraries");
  console.log("tpapi libraries shape:", JSON.stringify(shape(libs.body)).slice(0, 800));
  if (Array.isArray(libs.body)) {
    for (const entry of libs.body as Array<Record<string, unknown>>) {
      const id = entry.exerciseLibraryId ?? entry.libraryId ?? entry.id;
      if (id === undefined) continue;
      const items = await get("strength", `/rx/activity/v1/libraryContent/workoutLibrary/${id}`, `workoutLibrary-${id}`);
      const arr = Array.isArray(items.body) ? (items.body as Array<Record<string, unknown>>) : [];
      const byType = new Map<string, number>();
      for (const it of arr) {
        const t = String(it.workoutLibraryItemType ?? it.itemType ?? "?");
        byType.set(t, (byType.get(t) ?? 0) + 1);
      }
      console.log(`  library <id> items=${arr.length} byType=${JSON.stringify(Object.fromEntries(byType))}`);
      if (arr[0]) console.log("  item shape:", JSON.stringify(shape(arr[0])).slice(0, 1200));
    }
  }
}

await main();
