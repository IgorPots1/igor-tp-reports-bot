/**
 * Protocols people-probe (Фаза 10.3, step 0b): measure REAL coverage — for a handful of students
 * whose probeg athlete id Igor found by hand, read their PUBLIC probeg profile (/user/<id>/) and
 * check how many of OUR races (trainingpeaks_race_events) show up there by date (and time).
 *
 * No login, no cookies: the profile page is public. Igor finds the ids in a browser and passes a
 * mapping; the script only reads public /user/<id>/ pages. POLITE by contract: sequential (no
 * parallelism), a delay between requests, and a disk cache so a re-run hits zero network. On the
 * first fetched profile it SELF-DIAGNOSES (prints status, html size, and the date/time pairs it
 * extracted) so the extraction is calibrated on a live page, not blind.
 *
 * TWO MODES:
 *   --candidates
 *       List our students who finished the seed events (Белые ночи 04.07.2026, Казанский 03.05.2026,
 *       Московский полумарафон 26.04.2026) with their date/distance/OUR time — the list to eyeball,
 *       pick 5-7, and look up on probeg. READ-ONLY DB, no network.
 *   --check --ids=<path.json>
 *       ids.json = [{ "studentId": "<uuid>", "probegUserId": 9511 }, ...]. Reads each public profile,
 *       extracts its finishes (date + time), and reports for each student how many of our races match
 *       by date, and by date+time (±tolerance). Ends with the overall coverage fraction.
 *
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=.env.local scripts/probeg-people-probe.ts --candidates
 *   node ... scripts/probeg-people-probe.ts --check --ids=./probeg-ids.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createSupabaseServerClient } from "@/features/supabase/server";

const MODE_CANDIDATES = process.argv.includes("--candidates");
const MODE_CHECK = process.argv.includes("--check");
const IDS_PATH = process.argv.find((a) => a.startsWith("--ids="))?.slice("--ids=".length).trim() || "";

// Seed events (date + a title fragment) whose finishers we know are on probeg — for --candidates.
const SEED_EVENTS = [
  { date: "2026-07-04", label: "Белые ночи" },
  { date: "2026-05-03", label: "Казанский марафон" },
  { date: "2026-04-26", label: "Московский полумарафон" },
];

const CACHE_DIR = path.resolve("probeg-cache");
const REQUEST_DELAY_MS = 3000; // polite: ≥3s between live probeg fetches
const TIME_TOLERANCE_S = 180; // chip/gun + GPS vs official → ±3 min counts as the same finish
const USER_AGENT = "igor-tp-reports-bot/probeg-recon (contact: coach; polite, cached, sequential)";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/** completed_time_raw is HOURS (see rawHoursToSeconds in service.ts) → seconds. */
function rawHoursToSeconds(v: number | string | null | undefined): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n * 3600) : null;
}

function fmtHms(sec: number | null): string {
  if (sec == null) return "?";
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** DD.MM.YYYY | YYYY-MM-DD → YYYY-MM-DD, else null. */
function toIsoDate(s: string): string | null {
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

function hmsToSeconds(hms: string): number | null {
  const p = hms.split(":").map((x) => Number(x));
  if (p.some((n) => !Number.isFinite(n))) return null;
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  if (p.length === 2) return p[0] * 60 + p[1];
  return null;
}

/**
 * Extract (isoDate, seconds) finish pairs from a profile's HTML. Layout-agnostic: find each date
 * token and pair it with the FIRST time token within the next ~300 chars (same table row). Robust to
 * markup changes — needs only that a finish shows a date and a time near each other. Returns unique
 * pairs. PURE.
 */
export function extractFinishes(html: string): Array<{ date: string; seconds: number }> {
  const out: Array<{ date: string; seconds: number }> = [];
  const seen = new Set<string>();
  const dateRe = /(\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2})/g;
  let m: RegExpExecArray | null;
  while ((m = dateRe.exec(html)) !== null) {
    const iso = toIsoDate(m[1]);
    if (!iso) continue;
    const window = html.slice(m.index, m.index + 300);
    const t = window.match(/(\d{1,2}:\d{2}:\d{2})/);
    if (!t) continue;
    const sec = hmsToSeconds(t[1]);
    if (sec == null || sec <= 0) continue;
    const key = `${iso}|${sec}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ date: iso, seconds: sec });
  }
  return out;
}

async function fetchProfileHtml(userId: number, diagnose: boolean): Promise<string | null> {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  const cachePath = path.join(CACHE_DIR, `user-${userId}.html`);
  if (existsSync(cachePath)) {
    return readFileSync(cachePath, "utf8");
  }
  await sleep(REQUEST_DELAY_MS); // polite pause before every LIVE fetch
  const url = `https://probeg.org/user/${userId}/`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const resp = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: ctrl.signal });
    const html = await resp.text();
    if (diagnose) {
      const pairs = extractFinishes(html);
      console.log(`  [self-diagnose] ${url} status=${resp.status} htmlLen=${html.length} extractedFinishes=${pairs.length}`);
      console.log(`  [self-diagnose] первые 3: ${pairs.slice(0, 3).map((p) => `${p.date} ${fmtHms(p.seconds)}`).join(" | ") || "(ничего — парсер калибруем: см. probeg-cache/user-" + userId + ".html)"}`);
    }
    if (resp.status >= 200 && resp.status < 300 && html.length > 0) {
      writeFileSync(cachePath, html, "utf8");
      return html;
    }
    console.log(`  ошибка загрузки ${url}: status=${resp.status}`);
    return null;
  } catch (e) {
    console.log(`  ошибка загрузки ${url}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

type OurRace = { date: string; title: string; distanceRaw: string | null; ourSeconds: number | null };

/** All our races for a student (from race_events) + our time that day (from the workout cache). */
async function loadOurRaces(studentId: string): Promise<OurRace[]> {
  const supabase = createSupabaseServerClient();
  const { data: races } = await supabase
    .from("trainingpeaks_race_events")
    .select("event_date, title, distance_raw")
    .eq("student_id", studentId)
    .order("event_date", { ascending: true });
  const rows = (races as Array<{ event_date: string | null; title: string | null; distance_raw: string | null }> | null) ?? [];
  const out: OurRace[] = [];
  for (const r of rows) {
    const date = (r.event_date ?? "").slice(0, 10);
    if (!date) continue;
    const { data: wk } = await supabase
      .from("trainingpeaks_workout_cache")
      .select("completed_time_raw, completed_distance_raw")
      .eq("student_id", studentId)
      .eq("workout_date", date)
      .order("completed_distance_raw", { ascending: false })
      .limit(1);
    const w = (wk as Array<{ completed_time_raw: number | string | null }> | null)?.[0] ?? null;
    out.push({ date, title: (r.title ?? "").trim(), distanceRaw: r.distance_raw, ourSeconds: rawHoursToSeconds(w?.completed_time_raw) });
  }
  return out;
}

async function runCandidates(): Promise<void> {
  const supabase = createSupabaseServerClient();
  console.log("=== КАНДИДАТЫ ДЛЯ ПРОБЫ (наши финиши на seed-событиях) ===");
  console.log("Выбери 5-7, найди их профили на probeg по ФИО, собери probeg-ids.json.");
  for (const ev of SEED_EVENTS) {
    const { data } = await supabase
      .from("trainingpeaks_race_events")
      .select("student_id, event_date, title, distance_raw, trainingpeaks_students(student_name)")
      .eq("event_date", ev.date);
    const rows = (data as Array<{ student_id: string; title: string | null; distance_raw: string | null; trainingpeaks_students: { student_name: string | null } | Array<{ student_name: string | null }> | null }> | null) ?? [];
    console.log(`\n--- ${ev.label} · ${ev.date} · учеников: ${rows.length} ---`);
    for (const r of rows) {
      const st = Array.isArray(r.trainingpeaks_students) ? r.trainingpeaks_students[0] : r.trainingpeaks_students;
      const name = st?.student_name ?? r.student_id;
      const { data: wk } = await supabase
        .from("trainingpeaks_workout_cache")
        .select("completed_time_raw, completed_distance_raw")
        .eq("student_id", r.student_id)
        .eq("workout_date", ev.date)
        .order("completed_distance_raw", { ascending: false })
        .limit(1);
      const w = (wk as Array<{ completed_time_raw: number | string | null }> | null)?.[0] ?? null;
      console.log(`  ${name} · ${r.distance_raw ?? "?"} · наше время ${fmtHms(rawHoursToSeconds(w?.completed_time_raw))} · studentId=${r.student_id}`);
    }
  }
  console.log("\nФормат probeg-ids.json: [{ \"studentId\": \"<uuid>\", \"probegUserId\": 9511 }, ...]");
  process.exit(0);
}

async function runCheck(): Promise<void> {
  if (!IDS_PATH || !existsSync(IDS_PATH)) {
    console.error(`--ids=<path.json> не найден: ${IDS_PATH || "(не задан)"}`);
    process.exit(1);
  }
  const mapping = JSON.parse(readFileSync(IDS_PATH, "utf8")) as Array<{ studentId: string; probegUserId: number; name?: string }>;
  const supabase = createSupabaseServerClient();

  let totalRaces = 0, dateHits = 0, dateTimeHits = 0;
  let first = true;
  for (const { studentId, probegUserId, name } of mapping) {
    const nm = name ?? (await supabase.from("trainingpeaks_students").select("student_name").eq("id", studentId).maybeSingle()).data?.student_name ?? studentId.slice(0, 8);
    console.log(`\n=== ${nm} · probeg/user/${probegUserId}/ ===`);
    const html = await fetchProfileHtml(probegUserId, first);
    first = false;
    if (!html) { console.log("  профиль не загрузился — пропуск"); continue; }
    const profileFinishes = extractFinishes(html);
    const ourRaces = await loadOurRaces(studentId);
    for (const race of ourRaces) {
      totalRaces += 1;
      const sameDate = profileFinishes.filter((f) => f.date === race.date);
      const byDate = sameDate.length > 0;
      const byTime = race.ourSeconds != null && sameDate.some((f) => Math.abs(f.seconds - (race.ourSeconds as number)) <= TIME_TOLERANCE_S);
      if (byDate) dateHits += 1;
      if (byTime) dateTimeHits += 1;
      const mark = byTime ? "OK дата+время" : byDate ? "~ только дата" : "нет";
      const probegTimes = sameDate.map((f) => fmtHms(f.seconds)).join(",") || "-";
      console.log(`  ${race.date} · ${race.title || race.distanceRaw || ""} · наше ${fmtHms(race.ourSeconds)} · probeg[${probegTimes}] → ${mark}`);
    }
  }

  console.log("\n=== ИТОГ ПОКРЫТИЯ ===");
  console.log(`Наших гонок проверено: ${totalRaces}`);
  console.log(`Нашлись в профиле по дате: ${dateHits} (${totalRaces ? Math.round((dateHits / totalRaces) * 100) : 0}%)`);
  console.log(`Из них подтверждены датой+временем (±${TIME_TOLERANCE_S}с): ${dateTimeHits} (${totalRaces ? Math.round((dateTimeHits / totalRaces) * 100) : 0}%)`);
  process.exit(0);
}

async function main(): Promise<void> {
  if (MODE_CANDIDATES) return runCandidates();
  if (MODE_CHECK) return runCheck();
  console.error("Укажи режим: --candidates  или  --check --ids=<path.json>");
  process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
