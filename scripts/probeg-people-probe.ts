/**
 * Protocols people-probe / report-mode matcher (Фаза 10.3). Measures REAL coverage against probeg's
 * PUBLIC results-by-name page — no login, no cookies, no stored athlete id — and prints, WITHOUT
 * WRITING ANYTHING, how many of our races match a protocol EXACTLY (auto-linkable) vs PROBABLY (need
 * coach confirmation). The number decides whether auto-linking gets switched on.
 *
 * probeg exposes /results/<Фамилия>/<Имя>/ publicly: each finish row directly (date, event+distance,
 * city, time, place, age, NAME, club). The search is by surname PREFIX and MIXES namesakes, so a name
 * can NEVER be the link. A finish is tied to one of our races ONLY by DATE + DISTANCE + TIME. The
 * distance gate is essential: a surname-only pool (e.g. фамилия=Антон) yields dozens of same-date
 * finishers across every distance; a 5-hour marathon must not look like a candidate for a 46-min 10k.
 * Parsing + matching live in src/features/club/probeg-parse.ts (pure, unit-tested).
 *
 * POLITE by contract: sequential, a delay before every LIVE fetch, a disk cache so a re-run hits zero
 * network. Self-diagnoses on the first fetch. Latin roster names → Cyrillic via name-translit.ts.
 *
 * MODES:
 *   --candidates                      List our finishers of the seed events (pick a sample).
 *   --check --students=<path.json>    students.json = ["<studentId>", ...]; report per-student + total.
 *   --check-all                       Whole club (every student with a past race), report-only.
 *   --confirmed=<path.json>           Optional. {"<studentId>": ["Хади Муртазалиева", ...]} — confirmed
 *                                     spellings (previews club_probeg_athlete_links): such a name counts
 *                                     as EXACT, so a shortened name auto-links instead of re-queuing.
 *
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=/Users/igor/igor-tp-reports-bot/.env.local scripts/probeg-people-probe.ts --check-all
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { nameSearchSpecs, studentNameVariantSets } from "@/features/club/name-translit";
import { extractFinishes, fmtHms, isForeignRace, matchRace, normalizeKm, type MatchResult, type ProbegFinish } from "@/features/club/probeg-parse";
import { createSupabaseServerClient } from "@/features/supabase/server";

const MODE_CANDIDATES = process.argv.includes("--candidates");
const MODE_CHECK = process.argv.includes("--check");
const MODE_CHECK_ALL = process.argv.includes("--check-all");
const STUDENTS_PATH = process.argv.find((a) => a.startsWith("--students="))?.slice("--students=".length).trim() || "";
const CONFIRMED_PATH = process.argv.find((a) => a.startsWith("--confirmed="))?.slice("--confirmed=".length).trim() || "";

/** { "<studentId>": ["Хади Муртазалиева", ...] } — confirmed spellings memory (previews the DB table). */
function loadConfirmedSpellings(): Record<string, string[]> {
  if (!CONFIRMED_PATH || !existsSync(CONFIRMED_PATH)) return {};
  try {
    const raw = JSON.parse(readFileSync(CONFIRMED_PATH, "utf8")) as Record<string, unknown>;
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(raw)) if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === "string");
    return out;
  } catch {
    console.error(`--confirmed=${CONFIRMED_PATH} не читается (ждём {"studentId":["написание",...]})`);
    return {};
  }
}

const SEED_EVENTS = [
  { date: "2026-07-04", label: "Белые ночи" },
  { date: "2026-05-03", label: "Казанский марафон" },
  { date: "2026-04-26", label: "Московский полумарафон" },
];

const CACHE_DIR = path.resolve("probeg-cache");
const REQUEST_DELAY_MS = 3000; // polite: ≥3s before every LIVE fetch
const EXACT_TOLERANCE_S = 60; // ≤1 мин → точное совпадение (авто-привязываемо)
const PROBABLE_TOLERANCE_S = 900; // ≤15 мин на той же дате И той же дистанции → вероятное; на подтверждение
const TODAY_ISO = new Date().toISOString().slice(0, 10); // future races have no protocol yet — excluded
const USER_AGENT = "igor-tp-reports-bot/probeg-recon (polite, cached, sequential)";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/** Cache time is decimal hours. */
function rawHoursToSeconds(v: number | string | null | undefined): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n * 3600) : null;
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
      console.log(`  [self-diagnose] первые 3: ${pairs.slice(0, 3).map((p) => `${p.date} ${fmtHms(p.seconds)} ${p.distanceKm ?? "?"}км`).join(" | ") || `(0 — калибровка: см. ${cachePath})`}`);
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
async function fetchFinishesForName(rosterName: string, diagnose: boolean): Promise<{ finishes: ProbegFinish[]; tried: string[] }> {
  const specs = nameSearchSpecs(rosterName);
  const finishes: ProbegFinish[] = [];
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
      const k = `${f.date}|${f.seconds}|${f.distanceKm ?? ""}`;
      if (!seen.has(k)) { seen.add(k); finishes.push(f); }
    }
  }
  return { finishes, tried };
}

type OurRace = { date: string; title: string; ourKm: number | null; ourSeconds: number | null; foreign: boolean };

async function loadOurRaces(studentId: string): Promise<OurRace[]> {
  const supabase = createSupabaseServerClient();
  const { data: races } = await supabase
    .from("trainingpeaks_race_events")
    .select("event_date, title, distance_raw")
    .eq("student_id", studentId)
    .lte("event_date", TODAY_ISO) // future races have no protocol yet — never counted
    .order("event_date", { ascending: true });
  const rows = (races as Array<{ event_date: string | null; title: string | null; distance_raw: number | string | null }> | null) ?? [];
  const out: OurRace[] = [];
  for (const r of rows) {
    const date = (r.event_date ?? "").slice(0, 10);
    if (!date) continue;
    // The race workout = the longest completed run that day. Its GPS distance/time is what a protocol row mirrors.
    const { data: wk } = await supabase
      .from("trainingpeaks_workout_cache")
      .select("completed_time_raw, completed_distance_raw")
      .eq("student_id", studentId)
      .eq("workout_date", date)
      .order("completed_distance_raw", { ascending: false })
      .limit(1);
    const w = (wk as Array<{ completed_time_raw: number | string | null; completed_distance_raw: number | string | null }> | null)?.[0] ?? null;
    const ourKm = normalizeKm(w?.completed_distance_raw) ?? normalizeKm(r.distance_raw); // actual GPS first, planned distance fallback
    const title = (r.title ?? "").trim();
    out.push({ date, title, ourKm, ourSeconds: rawHoursToSeconds(w?.completed_time_raw), foreign: isForeignRace(title) });
  }
  return out;
}

async function studentName(studentId: string): Promise<string> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase.from("trainingpeaks_students").select("student_name").eq("id", studentId).maybeSingle();
  return (data as { student_name: string | null } | null)?.student_name ?? studentId;
}

type ProbableDetail = { studentName: string; race: OurRace; finish: ProbegFinish; deltaSeconds: number | null; nameUnrecognized: boolean };
type SkipDetail = { studentName: string; race: OurRace };
// comparable = состоявшиеся гонки в России/СНГ с нашим временем — единственный честный знаменатель.
// foreign (зарубеж, протокола нет и не будет) и notime (нет нашего времени, сверять не с чем) — вне него.
type StudentTally = { comparable: number; exact: number; probable: number; notFound: number; foreign: number; notime: number; probables: ProbableDetail[] };

function fmtKm(km: number | null): string {
  return km == null ? "?км" : `${km}км`;
}

async function checkStudent(studentId: string, name: string, diagnose: boolean, probablesOut: ProbableDetail[], confirmed: string[], skips: { foreign: SkipDetail[]; notime: SkipDetail[] }): Promise<StudentTally> {
  const { finishes, tried } = await fetchFinishesForName(name, diagnose);
  const variants = studentNameVariantSets(name); // имя должно СОВПАСТЬ (фамилия), иначе не матч
  const ourRaces = await loadOurRaces(studentId); // прошедшие гонки
  const tally: StudentTally = { comparable: 0, exact: 0, probable: 0, notFound: 0, foreign: 0, notime: 0, probables: [] };
  const conf = confirmed.length ? ` · подтв. написаний: ${confirmed.length}` : "";
  console.log(`\n=== ${name} · probeg попытки [${tried.join(" ; ")}] · строк финишей: ${finishes.length} · наших гонок: ${ourRaces.length}${conf} ===`);
  for (const race of ourRaces) {
    const ours = `наше ${race.date} ${fmtKm(race.ourKm)} ${fmtHms(race.ourSeconds)}`;
    if (race.foreign) { // зарубеж — protokola на probeg не будет, вне знаменателя
      tally.foreign += 1;
      skips.foreign.push({ studentName: name, race });
      console.log(`  зарубеж  ${race.title || fmtKm(race.ourKm)} · ${ours} → вне знаменателя (не Россия/СНГ)`);
      continue;
    }
    if (race.ourSeconds == null) { // нет нашего времени — сверять не с чем, вне знаменателя
      tally.notime += 1;
      skips.notime.push({ studentName: name, race });
      console.log(`  без врем ${race.title || fmtKm(race.ourKm)} · ${ours} → вне знаменателя (нет нашего времени)`);
      continue;
    }
    tally.comparable += 1;
    const res: MatchResult = matchRace({ date: race.date, ourSeconds: race.ourSeconds, ourKm: race.ourKm }, finishes, variants, { exact: EXACT_TOLERANCE_S, probable: PROBABLE_TOLERANCE_S }, confirmed);
    if (res.verdict === "exact" && res.finish) {
      tally.exact += 1;
      const via = res.byConfirmedName ? " [по подтверждённому имени]" : "";
      console.log(`  ТОЧНО   ${race.title || fmtKm(race.ourKm)} · ${ours} ↔ probeg ${res.finish.name} ${fmtKm(res.finish.distanceKm)} ${fmtHms(res.finish.seconds)} (Δ${res.deltaSeconds}с)${via}`);
    } else if (res.verdict === "probable" && res.finish) {
      tally.probable += 1;
      const detail: ProbableDetail = { studentName: name, race, finish: res.finish, deltaSeconds: res.deltaSeconds, nameUnrecognized: res.nameUnrecognized };
      tally.probables.push(detail);
      probablesOut.push(detail);
      const who = res.nameUnrecognized ? "имя не распозналось" : res.finish.name;
      console.log(`  ВЕРОЯТНО ${race.title || fmtKm(race.ourKm)} · ${ours} ↔ probeg ${who} «${res.finish.event}» ${fmtKm(res.finish.distanceKm)} ${fmtHms(res.finish.seconds)} место ${res.finish.place ?? "?"} ${res.finish.city ?? ""} (Δ${res.deltaSeconds}с) — на подтверждение`);
    } else {
      tally.notFound += 1;
      const why = res.nameRejected
        ? ` (совпали дата+дистанция+время, но имя «${res.nameRejected.name}» ≠ ученик → отброшено по фамилии)`
        : res.sameDate.length
          ? ` (в тот день у однофамильцев: ${res.sameDate.map((f) => `${f.name} ${fmtKm(f.distanceKm)}/${fmtHms(f.seconds)}`).slice(0, 3).join(", ")})`
          : "";
      console.log(`  нет      ${race.title || fmtKm(race.ourKm)} · ${ours}${why}`);
    }
  }
  return tally;
}

function printSummary(totals: StudentTally, students: number, probables: ProbableDetail[], skips: { foreign: SkipDetail[]; notime: SkipDetail[] }): void {
  const denom = totals.comparable;
  const pct = (n: number) => (denom ? Math.round((n / denom) * 100) : 0);
  const past = denom + totals.foreign + totals.notime;
  console.log(`\n=== ИТОГ ПОКРЫТИЯ (состоявшиеся гонки до ${TODAY_ISO}; учеников: ${students}) ===`);
  console.log(`Прошедших гонок всего: ${past}  =  сверяемых ${denom} + зарубеж ${totals.foreign} + без времени ${totals.notime}`);
  console.log(`\nЗнаменатель = СВЕРЯЕМЫЕ (Россия/СНГ, есть наше время): ${denom}`);
  console.log(`  ТОЧНЫЕ   (дата+дистанция+имя+время ≤1мин, авто-привязка): ${totals.exact} (${pct(totals.exact)}%)`);
  console.log(`  ВЕРОЯТНЫЕ (та же дата+дистанция, Δ≤15мин, на подтверждение): ${totals.probable} (${pct(totals.probable)}%)`);
  console.log(`  РЕАЛЬНЫЕ ПРОМАХИ (нет на probeg под этим человеком): ${totals.notFound} (${pct(totals.notFound)}%)`);
  console.log(`\nВне знаменателя: зарубеж ${totals.foreign} (probeg = РФ/СНГ), без нашего времени ${totals.notime} (сверять не с чем)`);
  if (skips.foreign.length) {
    console.log(`\n--- ЗАРУБЕЖНЫЕ (${skips.foreign.length}) — проверь классификацию по названию ---`);
    for (const s of skips.foreign) console.log(`  ${s.studentName}: ${s.race.date} ${fmtKm(s.race.ourKm)} · ${s.race.title}`);
  }
  if (probables.length) {
    console.log(`\n--- СПИСОК ВЕРОЯТНЫХ (${probables.length}) — очередь на подтверждение тренером ---`);
    for (const p of probables) {
      const who = p.nameUnrecognized ? "имя не распозналось" : p.finish.name;
      console.log(`  ${p.studentName}: наше ${p.race.date} ${fmtKm(p.race.ourKm)} ${fmtHms(p.race.ourSeconds)}  ↔  probeg ${who} «${p.finish.event}» ${fmtKm(p.finish.distanceKm)} ${fmtHms(p.finish.seconds)} место ${p.finish.place ?? "?"} ${p.finish.city ?? ""}`);
    }
  }
}

async function loadClubStudents(): Promise<Array<{ id: string; name: string }>> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("trainingpeaks_race_events")
    .select("student_id, event_date, trainingpeaks_students(student_name)")
    .lte("event_date", TODAY_ISO);
  const rows = (data as Array<{ student_id: string; trainingpeaks_students: { student_name: string | null } | Array<{ student_name: string | null }> | null }> | null) ?? [];
  const map = new Map<string, string>();
  for (const r of rows) {
    if (!r.student_id || map.has(r.student_id)) continue;
    const st = Array.isArray(r.trainingpeaks_students) ? r.trainingpeaks_students[0] : r.trainingpeaks_students;
    map.set(r.student_id, st?.student_name ?? r.student_id);
  }
  return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

async function runCandidates(): Promise<void> {
  const supabase = createSupabaseServerClient();
  console.log("=== КАНДИДАТЫ (наши финиши seed-событий) — выбери 5-7, собери students.json ===");
  for (const ev of SEED_EVENTS) {
    const { data } = await supabase
      .from("trainingpeaks_race_events")
      .select("student_id, distance_raw, trainingpeaks_students(student_name)")
      .eq("event_date", ev.date);
    const rows = (data as Array<{ student_id: string; distance_raw: number | string | null; trainingpeaks_students: { student_name: string | null } | Array<{ student_name: string | null }> | null }> | null) ?? [];
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

function foldTally(into: StudentTally, one: StudentTally): void {
  into.comparable += one.comparable; into.exact += one.exact; into.probable += one.probable;
  into.notFound += one.notFound; into.foreign += one.foreign; into.notime += one.notime;
}

async function runCheck(): Promise<void> {
  if (!STUDENTS_PATH || !existsSync(STUDENTS_PATH)) {
    console.error(`--students=<path.json> не найден: ${STUDENTS_PATH || "(не задан)"}`);
    process.exit(1);
  }
  const ids = JSON.parse(readFileSync(STUDENTS_PATH, "utf8")) as string[];
  const confirmedMap = loadConfirmedSpellings();
  const totals: StudentTally = { comparable: 0, exact: 0, probable: 0, notFound: 0, foreign: 0, notime: 0, probables: [] };
  const probables: ProbableDetail[] = [];
  const skips = { foreign: [] as SkipDetail[], notime: [] as SkipDetail[] };
  let first = true;
  for (const studentId of ids) {
    const name = await studentName(studentId);
    foldTally(totals, await checkStudent(studentId, name, first, probables, confirmedMap[studentId] ?? [], skips));
    first = false;
  }
  printSummary(totals, ids.length, probables, skips);
  process.exit(0);
}

async function runCheckAll(): Promise<void> {
  const students = await loadClubStudents();
  const confirmedMap = loadConfirmedSpellings();
  console.log(`=== ПРОГОН ПО ВСЕМУ КЛУБУ · учеников с прошедшими гонками: ${students.length} · до ~${students.length * 6} запросов (кэш переиспользуется) ===`);
  const totals: StudentTally = { comparable: 0, exact: 0, probable: 0, notFound: 0, foreign: 0, notime: 0, probables: [] };
  const probables: ProbableDetail[] = [];
  const skips = { foreign: [] as SkipDetail[], notime: [] as SkipDetail[] };
  let first = true;
  for (const s of students) {
    foldTally(totals, await checkStudent(s.id, s.name, first, probables, confirmedMap[s.id] ?? [], skips));
    first = false;
  }
  printSummary(totals, students.length, probables, skips);
  process.exit(0);
}

async function main(): Promise<void> {
  if (MODE_CANDIDATES) return runCandidates();
  if (MODE_CHECK_ALL) return runCheckAll();
  if (MODE_CHECK) return runCheck();
  console.error("Режим: --candidates | --check --students=<path.json> | --check-all");
  process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
