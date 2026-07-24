/**
 * `tp-athlete add-race <name|id> --date <YYYY-MM-DD> --distance <10k|21.1k|5000m> [--name ...]`
 *
 * Creates a race/event on the athlete's TP calendar.
 *   POST /fitness/v6/athletes/{id}/event   (SINGULAR /event; field is personId, not athleteId)
 * Body shape from the verified UI capture — see docs/tp-write-payloads.md §2.
 *
 * Same safety model as set-threshold: DRY-RUN by default (build + print body, stop);
 * APPLY needs `--apply` + env `TP_ATHLETE_REAL_WRITE=1` + `--confirm "APPLY RACE <id>"`.
 * One POST, no retry, then verify by reading the day's events back.
 */

import { getEvents } from "../../../../src/features/trainingpeaks/tp-api-client.ts";
import { authedWriteOnce, isRecord, type RosterMatch } from "./tp-athlete-helpers.ts";

export type AddRaceArgs = {
  date?: string;
  distance?: string;
  name?: string;
  apply: boolean;
  confirm?: string;
};

/** "10k" | "21.1k" | "10km" | "5000m" | "5000" → meters. */
export function parseDistanceToMeters(input: string): number {
  const s = input.trim().toLowerCase();
  let m = s.match(/^(\d+(?:\.\d+)?)\s*km?$/); // 10k, 21.1k, 10km
  if (m) return Math.round(Number(m[1]) * 1000);
  m = s.match(/^(\d+(?:\.\d+)?)\s*m$/); // 5000m
  if (m) return Math.round(Number(m[1]));
  m = s.match(/^(\d+(?:\.\d+)?)$/); // bare number → meters
  if (m) return Math.round(Number(m[1]));
  throw new Error(`bad --distance "${input}" — use 10k / 21.1k / 5000m`);
}

function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function defaultName(distanceMeters: number): string {
  const km = distanceMeters / 1000;
  if (Math.abs(km - 21.1) < 0.15) return "Полумарафон";
  if (Math.abs(km - 42.2) < 0.2) return "Марафон";
  return Number.isInteger(km) ? `${km} км` : `${km} км`;
}

export async function runAddRace(match: RosterMatch, args: AddRaceArgs): Promise<void> {
  const { athleteId, displayName } = match;
  if (!args.date || !args.distance) {
    console.error("add-race needs --date <YYYY-MM-DD> and --distance <10k|21.1k|5000m>.");
    process.exitCode = 2;
    return;
  }
  if (!isValidDate(args.date)) {
    console.error(`bad --date "${args.date}" — expected YYYY-MM-DD.`);
    process.exitCode = 2;
    return;
  }
  let distanceMeters: number;
  try {
    distanceMeters = parseDistanceToMeters(args.distance);
  } catch (e) {
    console.error(`${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 2;
    return;
  }

  const name = args.name?.trim() || defaultName(distanceMeters);
  // Body from the captured working request (docs/tp-write-payloads.md §2). personId
  // is the ATHLETE id (not a field named athleteId); nulls/empties as observed.
  const body = {
    name,
    eventType: "RunningRoad",
    eventDate: args.date,
    personId: athleteId,
    distance: distanceMeters,
    distanceUnits: "meters",
    atpPriority: null,
    raceTypeDuration: null,
    description: null,
    goals: {},
    legs: [],
    workouts: [],
    results: [{ resultType: "Division" }, { resultType: "Gender" }, { resultType: "Overall" }],
  };

  console.log(`\n=== add-race — ${displayName} (athlete_id ${athleteId}) ===`);
  console.log(`POST /fitness/v6/athletes/${athleteId}/event  (singular /event; personId=${athleteId})`);
  console.log(`Тело запроса:`);
  console.log(JSON.stringify(body, null, 2));

  if (!args.apply) {
    console.log(
      `\nDRY-RUN. Ничего не отправлено. Чтобы создать после подтверждения Игоря:\n` +
        `  TP_ATHLETE_REAL_WRITE=1 tp-athlete add-race ${athleteId} --date ${args.date} --distance ${args.distance}` +
        `${args.name ? ` --name "${args.name}"` : ""} --apply --confirm "APPLY RACE ${athleteId}"`,
    );
    return;
  }

  const expected = `APPLY RACE ${athleteId}`;
  if (process.env.TP_ATHLETE_REAL_WRITE !== "1" || args.confirm !== expected) {
    console.error(
      `\nREFUSED apply: need BOTH env TP_ATHLETE_REAL_WRITE=1 AND --confirm "${expected}". ` +
        `Got confirm="${args.confirm ?? ""}", env=${process.env.TP_ATHLETE_REAL_WRITE ?? "unset"}. Not writing.`,
    );
    process.exitCode = 3;
    return;
  }

  console.log(`\nОтправка (ОДИН POST, без ретрая)...`);
  const res = await authedWriteOnce("POST", `/fitness/v6/athletes/${athleteId}/event`, body);
  console.log(`  status: ${res.status}${res.bodyText ? ` · body: ${res.bodyText.slice(0, 300)}` : ""}`);
  if (res.status !== 200) {
    console.error(`  Ожидали 200 — СТОП. Не ретраю.`);
    process.exitCode = 2;
    return;
  }
  let createdId: number | null = null;
  try {
    const parsed: unknown = JSON.parse(res.bodyText);
    if (isRecord(parsed) && typeof parsed.id === "number") createdId = parsed.id;
  } catch {
    /* ignore */
  }

  // verify: read that day's events back and look for our event
  const events = await getEvents(athleteId, args.date, args.date);
  const found = events.find(
    (e) => isRecord(e) && (createdId !== null ? e.id === createdId : e.name === name),
  );
  console.log(
    `  ВЕРИФИКАЦИЯ: событие ${found ? `✅ найдено на ${args.date}${createdId !== null ? ` (id ${createdId})` : ""}` : "❌ не найдено при чтении дня"}.`,
  );
  if (!found) {
    console.error(`  Не подтвердилось чтением — проверь календарь атлета в TP вручную.`);
    process.exitCode = 2;
  }
}
