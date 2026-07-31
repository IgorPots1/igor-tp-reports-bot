/**
 * Protocols people-probe (Фаза 10.3, step 0b): measure REAL coverage against probeg's PUBLIC
 * results-by-name page — no login, no cookies, no stored athlete id.
 *
 * probeg exposes /results/<Фамилия>/<Имя>/ publicly: each finish row directly (date, event, city,
 * time, place, age group, age, club). The search is by PREFIX and MIXES namesakes (e.g. «Антон Малык»
 * returns Малыкцев, Малык, Малыков in one table), so a name can NEVER be the link. A finish counts
 * ONLY when its DATE and TIME match one of our race_events within a minute — that, not the name, is
 * the disambiguation. Name/city are shown for the human, not used to decide.
 *
 * POLITE by contract: sequential, a delay before every LIVE fetch, and a disk cache so a re-run hits
 * zero network. Self-diagnoses on the first fetch (prints the URL, status, and extracted finishes) so
 * the extraction is calibrated on a live page. Latin roster names → Cyrillic via name-translit.ts.
 *
 * MODES:
 *   --candidates
 *       List our finishers of the seed events (Белые ночи 04.07, Казанский 03.05, Моск. полумарафон
 *       26.04) with date/distance/OUR time + studentId — pick the sample, build students.json.
 *   --check --students=<path.json>
 *       students.json = ["<studentId>", ...]. For each: transliterate the name, fetch the public
 *       results page (both surname/given orders; given-only fallback), match our races by date+time,
 *       report per-student + overall coverage.
 *
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=/Users/igor/igor-tp-reports-bot/.env.local scripts/probeg-people-probe.ts --candidates
 *   node ... scripts/probeg-people-probe.ts --check --students=./students.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { nameSearchSpecs } from "@/features/club/name-translit";
import { createSupabaseServerClient } from "@/features/supabase/server";

const MODE_CANDIDATES = process.argv.includes("--candidates");
const MODE_CHECK = process.argv.includes("--check");
const STUDENTS_PATH = process.argv.find((a) => a.startsWith("--students="))?.slice("--students=".length).trim() || "";

const SEED_EVENTS = [
  { date: "2026-07-04", label: "Белые ночи" },
  { date: "2026-05-03", label: "Казанский марафон" },
  { date: "2026-04-26", label: "Московский полумарафон" },
];

const CACHE_DIR = path.resolve("probeg-cache");
const REQUEST_DELAY_MS = 3000; // polite: ≥3s before every LIVE fetch
const EXACT_TOLERANCE_S = 60; // ≤1 мин → точное совпадение (авто-привязываемо)
const PROBABLE_TOLERANCE_S = 900; // ≤15 мин на той же дате → вероятное (gun vs chip); ТОЛЬКО на подтверждение
const TODAY_ISO = new Date().toISOString().slice(0, 10); // future races have no protocol yet — excluded
const USER_AGENT = "igor-tp-reports-bot/probeg-recon (polite, cached, sequential)";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function rawHoursToSeconds(v: number | string | null | undefined): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n * 3600) : null;
}

function fmtHms(sec: number | null): string {
  if (sec == null) return "?";
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

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
 * Extract (isoDate, seconds) finish pairs from a results page. Layout-agnostic: each date token is
 * paired with the FIRST time token in the next ~300 chars (same row). Robust to markup — needs only a
 * date and a time near each other, which every finish row has. Unique pairs. PURE.
 */
export function extractFinishes(html: string): Array<{ date: string; seconds: number }> {
  const out: Array<{ date: string; seconds: number }> = [];
  const seen = new Set<string>();
  const dateRe = /(\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2})/g;
  let m: RegExpExecArray | null;
  while ((m = dateRe.exec(html)) !== null) {
    const iso = toIsoDate(m[1]);
    if (!iso) continue;
    const t = html.slice(m.index, m.index + 300).match(/\b(\d{1,2}:\d{2}:\d{2})\b/);
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

function cacheKey(name: string): string {
  return name.replace(/[^0-9a-zа-яё]/gi, "_");
}

async function fetchHtml(url: string, cacheName: string, diagnose: boolean): Promise<string | null> {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  const cachePath = path.join(CACHE_DIR, `${cacheName}.html`);
  if (existsSync(cachePath)) return readFileSync(cachePath, "utf8");
  await sleep(REQUEST_DELAY_MS);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const resp = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: ctrl.signal });
    const html = await resp.text();
    if (diagnose) {
      const pairs = extractFinishes(html);
      console.log(`  [self-diagnose] ${url} status=${resp.status} htmlLen=${html.length} extractedFinishes=${pairs.length}`);
      console.log(`  [self-diagnose] первые 3: ${pairs.slice(0, 3).map((p) => `${p.date} ${fmtHms(p.seconds)}`).join(" | ") || `(0 — калибровка: см. ${cachePath})`}`);
    }
    if (resp.status >= 200 && resp.status < 300 && html.length > 0) {
      writeFileSync(cachePath, html, "utf8");
      return html;
    }
    return null;
  } catch (e) {
    console.log(`  ошибка загрузки ${url}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const enc = (s: string) => encodeURIComponent(s);

/**
 * Fetch the public results-by-name page across ALL name specs (both orders, translit variants, and
 * surname-only) and UNION their finishes — our person may sit under a variant spelling or only be
 * reachable by surname alone (given mismatch). Bounded (≤6 URLs/student). Cached + polite.
 */
async function fetchFinishesForName(rosterName: string, diagnose: boolean): Promise<{ finishes: Array<{ date: string; seconds: number }>; tried: string[] }> {
  const specs = nameSearchSpecs(rosterName);
  const finishes: Array<{ date: string; seconds: number }> = [];
  const seen = new Set<string>();
  const tried: string[] = [];
  let firstDiag = diagnose;
  for (const spec of specs) {
    const url = spec.given
      ? `https://probeg.org/results/${enc(spec.surname)}/${enc(spec.given)}/`
      : `https://probeg.org/results/${enc(spec.surname)}/`;
    tried.push(spec.given ? `${spec.surname}/${spec.given}` : `${spec.surname}/*`);
    const html = await fetchHtml(url, `results-${cacheKey(spec.surname)}-${cacheKey(spec.given)}`, firstDiag);
    firstDiag = false;
    if (!html) continue;
    for (const f of extractFinishes(html)) {
      const k = `${f.date}|${f.seconds}`;
      if (!seen.has(k)) { seen.add(k); finishes.push(f); }
    }
  }
  return { finishes, tried };
}

type OurRace = { date: string; title: string; distanceRaw: string | null; ourSeconds: number | null };

async function loadOurRaces(studentId: string): Promise<OurRace[]> {
  const supabase = createSupabaseServerClient();
  const { data: races } = await supabase
    .from("trainingpeaks_race_events")
    .select("event_date, title, distance_raw")
    .eq("student_id", studentId)
    .lte("event_date", TODAY_ISO) // future races have no protocol yet — never counted
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

async function studentName(studentId: string): Promise<string> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase.from("trainingpeaks_students").select("student_name").eq("id", studentId).maybeSingle();
  return (data as { student_name: string | null } | null)?.student_name ?? studentId;
}

async function runCandidates(): Promise<void> {
  const supabase = createSupabaseServerClient();
  console.log("=== КАНДИДАТЫ (наши финиши seed-событий) — выбери 5-7, собери students.json ===");
  for (const ev of SEED_EVENTS) {
    const { data } = await supabase
      .from("trainingpeaks_race_events")
      .select("student_id, distance_raw, trainingpeaks_students(student_name)")
      .eq("event_date", ev.date);
    const rows = (data as Array<{ student_id: string; distance_raw: string | null; trainingpeaks_students: { student_name: string | null } | Array<{ student_name: string | null }> | null }> | null) ?? [];
    console.log(`\n--- ${ev.label} · ${ev.date} · учеников: ${rows.length} ---`);
    for (const r of rows) {
      const st = Array.isArray(r.trainingpeaks_students) ? r.trainingpeaks_students[0] : r.trainingpeaks_students;
      const { data: wk } = await supabase
        .from("trainingpeaks_workout_cache").select("completed_time_raw, completed_distance_raw")
        .eq("student_id", r.student_id).eq("workout_date", ev.date).order("completed_distance_raw", { ascending: false }).limit(1);
      const w = (wk as Array<{ completed_time_raw: number | string | null }> | null)?.[0] ?? null;
      console.log(`  ${st?.student_name ?? r.student_id} · ${r.distance_raw ?? "?"} · наше ${fmtHms(rawHoursToSeconds(w?.completed_time_raw))} · studentId=${r.student_id}`);
    }
  }
  console.log("\nФормат students.json: [\"<studentId>\", \"<studentId>\", ...]");
  process.exit(0);
}

async function runCheck(): Promise<void> {
  if (!STUDENTS_PATH || !existsSync(STUDENTS_PATH)) {
    console.error(`--students=<path.json> не найден: ${STUDENTS_PATH || "(не задан)"}`);
    process.exit(1);
  }
  const ids = JSON.parse(readFileSync(STUDENTS_PATH, "utf8")) as string[];
  let totalRaces = 0, exactHits = 0, probableHits = 0, notFound = 0;
  let first = true;
  for (const studentId of ids) {
    const name = await studentName(studentId);
    const { finishes, tried } = await fetchFinishesForName(name, first);
    first = false;
    console.log(`\n=== ${name} · probeg попытки [${tried.join(" ; ")}] · строк финишей: ${finishes.length} ===`);
    const ourRaces = await loadOurRaces(studentId); // прошедшие гонки
    for (const race of ourRaces) {
      totalRaces += 1;
      const sameDate = finishes.filter((f) => f.date === race.date);
      const delta = (f: { seconds: number }) => (race.ourSeconds != null ? Math.abs(f.seconds - race.ourSeconds) : Infinity);
      const exact = sameDate.some((f) => delta(f) <= EXACT_TOLERANCE_S);
      const probable = !exact && sameDate.some((f) => delta(f) <= PROBABLE_TOLERANCE_S);
      if (exact) exactHits += 1;
      else if (probable) probableHits += 1;
      else notFound += 1;
      const probegTimes = sameDate.map((f) => fmtHms(f.seconds)).join(",");
      const mark = exact
        ? "ТОЧНО (дата+время ≤1мин)"
        : probable
          ? `ВЕРОЯТНО (та же дата, Δ≤15мин, probeg: ${probegTimes}) — только на подтверждение`
          : sameDate.length
            ? `дата есть, но время далеко (probeg: ${probegTimes}) → не матч`
            : "не найдено";
      console.log(`  ${race.date} · ${race.title || race.distanceRaw || ""} · наше ${fmtHms(race.ourSeconds)} → ${mark}`);
    }
  }
  console.log(`\n=== ИТОГ ПОКРЫТИЯ (только СОСТОЯВШИЕСЯ гонки, до ${TODAY_ISO}) ===`);
  const pct = (n: number) => (totalRaces ? Math.round((n / totalRaces) * 100) : 0);
  console.log(`Наших гонок проверено (прошедших): ${totalRaces}`);
  console.log(`ТОЧНО (дата+время ≤1мин, авто-привязываемо): ${exactHits} (${pct(exactHits)}%)`);
  console.log(`ВЕРОЯТНО (та же дата, Δ≤15мин, на подтверждение): ${probableHits} (${pct(probableHits)}%)`);
  console.log(`Не найдено: ${notFound} (${pct(notFound)}%)`);
  process.exit(0);
}

async function main(): Promise<void> {
  if (MODE_CANDIDATES) return runCandidates();
  if (MODE_CHECK) return runCheck();
  console.error("Режим: --candidates  или  --check --students=<path.json>");
  process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
