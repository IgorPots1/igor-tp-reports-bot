/**
 * TP Peak Performances probe (naryad B#2) — READ-ONLY, GET only, never writes.
 *
 * Checks whether TrainingPeaks exposes peak pace / peaks-by-distance in the
 * workout-detail response, and whether a separate peaks endpoint answers. Uses the
 * existing tp-api-client (same snapshot→bearer→retry plumbing). Prints status +
 * whether any "peak" key appears; does NOT dump full payloads to stdout.
 *
 * Run: node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *        --env-file=.env.local scripts/tp-peaks-probe.ts <athleteId> <workoutId>
 */

import { getWorkoutDetail, getWorkoutDetailsRecord, getTpApiJsonRaw } from "@/features/trainingpeaks/tp-api-client";

const athleteId = Number(process.argv[2] ?? 5905779);
const workoutId = Number(process.argv[3] ?? 3865839948);

function keysOf(obj: unknown): string[] {
  return obj && typeof obj === "object" ? Object.keys(obj as Record<string, unknown>) : [];
}
function findPeak(obj: unknown, path = "", hits: string[] = [], depth = 0): string[] {
  if (depth > 4 || !obj || typeof obj !== "object") return hits;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (/peak/i.test(k)) hits.push(`${path}${k}`);
    if (v && typeof v === "object") findPeak(v, `${path}${k}.`, hits, depth + 1);
  }
  return hits;
}

async function tryRaw(label: string, path: string) {
  try {
    const { status, body } = await getTpApiJsonRaw("tpapi", path);
    const peaks = findPeak(body);
    console.log(`[${label}] ${path} → status ${status}; peak-keys: ${peaks.length ? peaks.slice(0, 8).join(", ") : "нет"}`);
  } catch (e) {
    console.log(`[${label}] ${path} → ОШИБКА: ${String(e).slice(0, 160)}`);
  }
}

async function main() {
  console.log(`# TP peaks probe — athlete ${athleteId}, workout ${workoutId}\n`);

  try {
    const detail = await getWorkoutDetail(athleteId, workoutId);
    const peaks = findPeak(detail);
    console.log(`[workout-detail] top keys: ${keysOf(detail).join(", ")}`);
    console.log(`[workout-detail] peak-keys: ${peaks.length ? peaks.join(", ") : "НЕТ"}`);
  } catch (e) {
    console.log(`[workout-detail] ОШИБКА: ${String(e).slice(0, 200)}`);
  }

  try {
    const rec = await getWorkoutDetailsRecord(athleteId, workoutId);
    console.log(`[workout-details-record] top keys: ${keysOf(rec).join(", ")}`);
    const mmd = (rec as Record<string, unknown>).meanMaxSpeedsByDistance;
    const mms = (rec as Record<string, unknown>).meanMaxSpeeds;
    console.log(`[meanMaxSpeedsByDistance] sample: ${JSON.stringify(mmd).slice(0, 500)}`);
    console.log(`[meanMaxSpeeds] sample: ${JSON.stringify(mms).slice(0, 300)}`);
  } catch (e) {
    console.log(`[workout-details-record] ОШИБКА: ${String(e).slice(0, 200)}`);
  }

  // Candidate peaks endpoints (unknown paths — report status so 404/405 is a finding).
  await tryRaw("peaks-a", `/fitness/v6/athletes/${athleteId}/workouts/${workoutId}/peaks`);
  await tryRaw("peaks-b", `/fitness/v6/athletes/${athleteId}/peaks`);
  await tryRaw("peaks-c", `/fitness/v1/athletes/${athleteId}/peaks`);
  await tryRaw("peaks-d", `/fitness/v6/athletes/${athleteId}/reporting/peaks`);
  await tryRaw("peaks-e", `/fitness/v3/athletes/${athleteId}/peaks/recent`);
}

main().catch((e) => {
  console.error("tp-peaks-probe failed:", e);
  process.exit(1);
});
