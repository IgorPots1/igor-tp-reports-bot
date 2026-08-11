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
 *   --write [--commit]                Build the write plan: EXACT → club_records (official_protocol/
 *                                     verified), PROBABLE → club_protocol_pending queue, both → remembered
 *                                     spelling. WITHOUT --commit it is a DRY-RUN (prints the plan, writes
 *                                     nothing). Idempotent: coach_confirmed never overwritten, already-
 *                                     linked/queued rows skipped. Reads confirmed spellings from the DB.
 *
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=/Users/igor/igor-tp-reports-bot/.env.local scripts/probeg-people-probe.ts --write
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { nameSearchSpecs, studentNameVariantSets } from "@/features/club/name-translit";
import { distanceKeyOf, distanceMatch, extractFinishes, fmtHms, isForeignRace, matchRace, normalizeFinisherName, normalizeKm, type MatchResult, type ProbegFinish } from "@/features/club/probeg-parse";
import { createSupabaseServerClient } from "@/features/supabase/server";

const MODE_CANDIDATES = process.argv.includes("--candidates");
const MODE_CHECK = process.argv.includes("--check");
const MODE_CHECK_ALL = process.argv.includes("--check-all");
const MODE_WRITE = process.argv.includes("--write");
const COMMIT = process.argv.includes("--commit"); // без него --write делает ТОЛЬКО dry-run, ничего не пишет
// Block D — opt-in name-match FALLBACK. OFF by default so the weekly plist sync (--write) is UNCHANGED:
// the primary time-anchored matching is never weakened. When --name-fallback is passed, races that the
// time match missed BUT that have a coach-CONFIRMED spelling on the same date are queued (never
// auto-linked). Hard volume gate: if the fallback would add more than NAME_FALLBACK_MAX cards, it writes
// NOTHING and prints the count + a by-year breakdown, so the queue can never be flooded into uselessness.
const MODE_NAME_FALLBACK = process.argv.includes("--name-fallback");
const NAME_FALLBACK_MAX = Number(process.argv.find((a) => a.startsWith("--name-fallback-max="))?.slice("--name-fallback-max=".length)) || 40;
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
// Cache freshness (fix: a permanent cache froze pages and never saw protocols published after first fetch).
const NO_CACHE = process.argv.includes("--no-cache"); // принудительный рефетч ВСЕХ страниц (ручной прогон)
const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 дней: «осевшего» ученика (без свежей непривязанной гонки) перечитываем не чаще раза в 2 недели
const RECENT_UNBOUND_DAYS = 90; // ученик с непривязанной гонкой за столько дней → рефетч ВСЕГДА (кэш игнорируется)

/** Student ids that have a race in the last RECENT_UNBOUND_DAYS with NO official result yet (bound within
 *  ±1 day). Their probeg page is always re-fetched so a newly-published protocol is actually seen.
 *  Memoized: one pair of reads per process. */
let _recentUnbound: Set<string> | null = null;
async function recentUnboundStudentIds(): Promise<Set<string>> {
  if (_recentUnbound) return _recentUnbound;
  const supabase = createSupabaseServerClient();
  const since = new Date(Date.now() - RECENT_UNBOUND_DAYS * 864e5).toISOString().slice(0, 10);
  const [{ data: evs }, { data: offs }] = await Promise.all([
    supabase.from("trainingpeaks_race_events").select("student_id, event_date").gte("event_date", since).lte("event_date", TODAY_ISO),
    supabase.from("club_official_results").select("student_id, race_date").gte("race_date", since),
  ]);
  const bound = new Set<string>();
  for (const o of (offs as Array<{ student_id: string; race_date: string | null }> | null) ?? []) {
    const d = (o.race_date ?? "").slice(0, 10);
    if (!d) continue;
    const t = new Date(`${d}T00:00:00Z`).getTime();
    for (const dd of [-1, 0, 1]) bound.add(`${o.student_id}|${new Date(t + dd * 864e5).toISOString().slice(0, 10)}`);
  }
  const out = new Set<string>();
  for (const e of (evs as Array<{ student_id: string; event_date: string | null }> | null) ?? []) {
    const d = (e.event_date ?? "").slice(0, 10);
    if (d && !bound.has(`${e.student_id}|${d}`)) out.add(e.student_id);
  }
  _recentUnbound = out;
  return out;
}

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

async function fetchHtml(url: string, cacheName: string, diagnose: boolean, forceFresh = false): Promise<string | null> {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  const cachePath = path.join(CACHE_DIR, `${cacheName}.html`);
  // Use the cached copy ONLY when it is not forced fresh, not globally disabled, and not stale.
  // forceFresh (student with a recent unbound race) or --no-cache always re-fetch; otherwise TTL applies.
  if (existsSync(cachePath) && !NO_CACHE && !forceFresh && Date.now() - statSync(cachePath).mtimeMs <= CACHE_TTL_MS) {
    return readFileSync(cachePath, "utf8");
  }
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
async function fetchFinishesForName(rosterName: string, diagnose: boolean, forceFresh = false): Promise<{ finishes: ProbegFinish[]; tried: string[] }> {
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
    const html = await fetchHtml(url, `results-${cacheKey(spec.surname)}-${cacheKey(spec.given)}`, firstDiag, forceFresh);
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
  // One race can sit in race_events twice («Белые ночи» + «Марафон Белые ночи»). Collapse by date+time
  // (same workout → same finish time) so it is checked and queued ONCE. Keep the longest title; a race
  // is foreign if ANY of its duplicate titles is.
  const byKey = new Map<string, OurRace>();
  for (const race of out) {
    const key = `${race.date}|${race.ourSeconds ?? "?"}`;
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, race); continue; }
    byKey.set(key, {
      date: prev.date,
      title: race.title.length > prev.title.length ? race.title : prev.title,
      ourKm: prev.ourKm ?? race.ourKm,
      ourSeconds: prev.ourSeconds,
      foreign: prev.foreign || race.foreign,
    });
  }
  return [...byKey.values()];
}

async function studentName(studentId: string): Promise<string> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase.from("trainingpeaks_students").select("student_name").eq("id", studentId).maybeSingle();
  return (data as { student_name: string | null } | null)?.student_name ?? studentId;
}

type ProbableDetail = { studentName: string; race: OurRace; finish: ProbegFinish; deltaSeconds: number | null; nameUnrecognized: boolean; distanceDoubtful: boolean; weakName: boolean };
type SkipDetail = { studentName: string; race: OurRace };
// comparable = состоявшиеся гонки в России/СНГ с нашим временем — единственный честный знаменатель.
// foreign (зарубеж, протокола нет и не будет) и notime (нет нашего времени, сверять не с чем) — вне него.
type StudentTally = { comparable: number; exact: number; probable: number; notFound: number; foreign: number; notime: number; probables: ProbableDetail[] };

function fmtKm(km: number | null): string {
  return km == null ? "?км" : `${km}км`;
}

async function checkStudent(studentId: string, name: string, diagnose: boolean, probablesOut: ProbableDetail[], confirmed: string[], skips: { foreign: SkipDetail[]; notime: SkipDetail[] }): Promise<StudentTally> {
  const { finishes, tried } = await fetchFinishesForName(name, diagnose, (await recentUnboundStudentIds()).has(studentId));
  const variants = studentNameVariantSets(name); // имя должно СОВПАСТЬ (фамилия), иначе не матч
  const ourRaces = await loadOurRaces(studentId); // прошедшие гонки
  const tally: StudentTally = { comparable: 0, exact: 0, probable: 0, notFound: 0, foreign: 0, notime: 0, probables: [] };
  const conf = confirmed.length ? ` · подтв. написаний: ${confirmed.length}` : "";
  console.log(`\n=== ${name} · probeg попытки [${tried.join(" ; ")}] · строк финишей: ${finishes.length} · наших гонок: ${ourRaces.length}${conf} ===`);
  for (const race of ourRaces) {
    const ours = `наше ${race.date} ${fmtKm(race.ourKm)} ${fmtHms(race.ourSeconds)}`;
    if (race.ourSeconds == null) { // нет нашего времени — сверять не с чем, вне знаменателя
      if (race.foreign) { tally.foreign += 1; skips.foreign.push({ studentName: name, race }); }
      else { tally.notime += 1; skips.notime.push({ studentName: name, race }); }
      console.log(`  ${race.foreign ? "зарубеж " : "без врем"} ${race.title || fmtKm(race.ourKm)} · ${ours} → вне знаменателя`);
      continue;
    }
    const res: MatchResult = matchRace({ date: race.date, ourSeconds: race.ourSeconds, ourKm: race.ourKm }, finishes, variants, { exact: EXACT_TOLERANCE_S, probable: PROBABLE_TOLERANCE_S }, confirmed);
    if (res.verdict === "exact" && res.finish) {
      tally.comparable += 1;
      tally.exact += 1;
      const via = res.byConfirmedName ? " [по подтверждённому имени]" : "";
      console.log(`  ТОЧНО   ${race.title || fmtKm(race.ourKm)} · ${ours} ↔ probeg ${res.finish.name} ${fmtKm(res.finish.distanceKm)} ${fmtHms(res.finish.seconds)} (Δ${res.deltaSeconds}с)${via}`);
    } else if (res.verdict === "probable" && res.finish) {
      tally.comparable += 1;
      tally.probable += 1;
      const detail: ProbableDetail = { studentName: name, race, finish: res.finish, deltaSeconds: res.deltaSeconds, nameUnrecognized: res.nameUnrecognized, distanceDoubtful: res.distanceDoubtful, weakName: res.weakName };
      tally.probables.push(detail);
      probablesOut.push(detail);
      const who = res.nameUnrecognized ? "имя не распозналось" : res.finish.name;
      const note = `${res.distanceDoubtful ? " — наша дистанция сомнительна" : ""}${res.weakName ? " — ученик без фамилии" : ""}`;
      console.log(`  ВЕРОЯТНО ${race.title || fmtKm(race.ourKm)} · ${ours} ↔ probeg ${who} «${res.finish.event}» ${fmtKm(res.finish.distanceKm)} ${fmtHms(res.finish.seconds)} место ${res.finish.place ?? "?"} ${res.finish.city ?? ""} (Δ${res.deltaSeconds}с)${note} — на подтверждение`);
    } else if (race.foreign) { // не нашлось И название зарубежное → вне знаменателя (не промах)
      tally.foreign += 1;
      skips.foreign.push({ studentName: name, race });
      console.log(`  зарубеж  ${race.title || fmtKm(race.ourKm)} · ${ours} → вне знаменателя (не Россия/СНГ)`);
    } else {
      tally.comparable += 1;
      tally.notFound += 1;
      const why = res.nameRejected
        ? ` (дата+время совпали, но имя «${res.nameRejected.name}» ≠ ученик → отброшено по фамилии)`
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
      const note = `${p.distanceDoubtful ? " [наша дистанция сомнительна]" : ""}${p.nameUnrecognized ? " [имя не распозналось]" : ""}${p.weakName ? " [ученик без фамилии]" : ""}`;
      console.log(`  ${p.studentName}: наше ${p.race.date} ${fmtKm(p.race.ourKm)} ${fmtHms(p.race.ourSeconds)}  ↔  probeg ${who} «${p.finish.event}» ${fmtKm(p.finish.distanceKm)} ${fmtHms(p.finish.seconds)} место ${p.finish.place ?? "?"} ${p.finish.city ?? ""}${note}`);
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

const KM_OF_KEY: Record<string, number> = { "5k": 5, "10k": 10, "21k": 21.0975, "42k": 42.195 };

/** Read-only SELECT that tolerates a not-yet-applied table (returns null so the caller treats it empty). */
async function selectSafe<T>(table: string, columns: string): Promise<T[] | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.from(table).select(columns);
  if (error) { console.log(`  (таблица ${table} недоступна — считаю пустой; применить миграцию перед --commit): ${error.message}`); return null; }
  return (data as T[] | null) ?? [];
}

type ExactCand = { studentId: string; studentName: string; dkey: string; finish: ProbegFinish; date: string; ourSeconds: number | null; byConfirmedName: boolean; byShortenedName: boolean; distanceDoubtful: boolean };
type OfficialPlan = { studentId: string; studentName: string; date: string; finish: ProbegFinish; distanceDoubtful: boolean }; // журнал: ЛЮБАЯ дистанция
type RecPlan = { studentId: string; studentName: string; dkey: string; finish: ProbegFinish; date: string; action: "insert" | "upgrade"; ourSeconds: number | null };
type LinkPlan = { studentId: string; studentName: string; name: string; norm: string };
type PendPlan = { studentId: string; studentName: string; race: OurRace; res: MatchResult; matchKind?: "time" | "name_fallback"; ambiguous?: boolean; anchorNote?: string };

/**
 * Build the write plan (EXACT → club_records official_protocol; PROBABLE → confirmation queue; both →
 * remembered spelling) and either PRINT it (dry-run, default) or COMMIT it. Idempotent: coach_confirmed
 * rows are never touched, an already-linked protocol is skipped, an already-queued probable is skipped.
 */
async function runWrite(): Promise<void> {
  const supabase = createSupabaseServerClient();
  const students = await loadClubStudents();
  console.log(`=== WRITE ${COMMIT ? "(COMMIT — ПИШЕМ в БД)" : "(DRY-RUN — ничего не пишется)"} · учеников: ${students.length} ===`);

  const recs = await selectSafe<{ student_id: string; distance_key: string; source: string; protocol_url: string | null; duration_seconds: number | null }>("club_records", "student_id, distance_key, source, protocol_url, duration_seconds");
  const recMap = new Map<string, { source: string; url: string | null; seconds: number | null }>();
  for (const r of recs ?? []) recMap.set(`${r.student_id}|${r.distance_key}`, { source: r.source, url: r.protocol_url, seconds: r.duration_seconds });
  const links = await selectSafe<{ student_id: string; confirmed_name_normalized: string }>("club_probeg_athlete_links", "student_id, confirmed_name_normalized");
  const linkSet = new Set((links ?? []).map((l) => `${l.student_id}|${l.confirmed_name_normalized}`));
  const confirmedByStudent = new Map<string, string[]>();
  for (const l of links ?? []) { const a = confirmedByStudent.get(l.student_id) ?? []; a.push(l.confirmed_name_normalized); confirmedByStudent.set(l.student_id, a); }
  const pend = await selectSafe<{ student_id: string; race_date: string; protocol_seconds: number | null }>("club_protocol_pending", "student_id, race_date, protocol_seconds");
  const pendSet = new Set((pend ?? []).map((p) => `${p.student_id}|${p.race_date}|${p.protocol_seconds}`));

  // Отклонённые тренером привязки (tombstone club_protocol_rejections): синк НЕ пишет их снова.
  // Ключ (student_id, race_date, protocol_url) совпадает с onConflict-ключом журнала. selectSafe вернёт
  // null, если миграция не применена → набор пуст → старое поведение, без 500.
  const rej = await selectSafe<{ student_id: string; race_date: string; protocol_url: string | null }>("club_protocol_rejections", "student_id, race_date, protocol_url");
  const rejectedSet = new Set((rej ?? []).map((x) => `${x.student_id}|${(x.race_date ?? "").slice(0, 10)}|${x.protocol_url ?? ""}`));

  const exactCands: ExactCand[] = [];
  const officialPlans: OfficialPlan[] = [];
  const recordPlans: RecPlan[] = [];
  const linkPlans: LinkPlan[] = [];
  const pendPlans: PendPlan[] = [];
  const skips: string[] = [];

  let first = true;
  for (const s of students) {
    const { finishes } = await fetchFinishesForName(s.name, first, (await recentUnboundStudentIds()).has(s.id)); first = false;
    const variants = studentNameVariantSets(s.name);
    const confirmed = confirmedByStudent.get(s.id) ?? [];
    for (const race of await loadOurRaces(s.id)) {
      // Foreign races are never on probeg → foreign backlog, never name-matched. A missing time is
      // still passed to matchRace (it returns 'none' + sameDate), so the name-fallback below can see
      // the same-date finishers; it does NOT feed the ordinary time-matched write path.
      if (race.foreign) continue;
      if (race.ourSeconds == null && !MODE_NAME_FALLBACK) continue; // вне знаменателя — не пишем (обычный проход)
      const res = matchRace({ date: race.date, ourSeconds: race.ourSeconds, ourKm: race.ourKm }, finishes, variants, { exact: EXACT_TOLERANCE_S, probable: PROBABLE_TOLERANCE_S }, confirmed);
      // Отклонённое тренером (tombstone) — молча пропускаем ДО любой записи: ни журнал, ни рекорд, ни очередь.
      if (res.finish && rejectedSet.has(`${s.id}|${race.date}|${res.finish.protocolUrl ?? ""}`)) {
        skips.push(`${s.name}: ${race.date} отклонено тренером → пропуск (tombstone)`);
        continue;
      }
      if (res.verdict === "exact" && res.finish) {
        const dkey = distanceKeyOf(res.finish.distanceKm);
        // Наряд: СОМНИТЕЛЬНАЯ ДИСТАНЦИЯ никогда не привязывается автоматом. Даже при идеальном имени+времени
        // расхождение дистанции (наша vs протокол) уходит в очередь подтверждения, а НЕ в верифицированный
        // журнал/рекорд. Уже привязанное официально тем же протоколом — не перезапрашиваем (нет дубля в очереди).
        if (res.distanceDoubtful) {
          const ex = dkey ? recMap.get(`${s.id}|${dkey}`) : undefined;
          const alreadyBound = ex?.source === "official_protocol" && ex.url === (res.finish.protocolUrl ?? null);
          const pkey = `${s.id}|${race.date}|${res.finish.seconds}`;
          if (alreadyBound || pendSet.has(pkey)) { skips.push(`${s.name}: ТОЧНО(дист.сомнит.) ${race.date} → уже привязано/в очереди`); continue; }
          pendSet.add(pkey);
          pendPlans.push({ studentId: s.id, studentName: s.name, race, res });
          continue;
        }
        // Full journal: EVERY official (protocol-verified) result, any distance → club_official_results.
        officialPlans.push({ studentId: s.id, studentName: s.name, date: race.date, finish: res.finish, distanceDoubtful: res.distanceDoubtful });
        // club_records is the best-4 showcase; only the standard buckets go there (collapsed to best below).
        if (!dkey) { skips.push(`${s.name}: ТОЧНО ${race.date} дистанция ${res.finish.distanceKm}км нестандартная → только в журнал club_official_results`); continue; }
        exactCands.push({ studentId: s.id, studentName: s.name, dkey, finish: res.finish, date: race.date, ourSeconds: race.ourSeconds, byConfirmedName: res.byConfirmedName, byShortenedName: res.byShortenedName, distanceDoubtful: res.distanceDoubtful });
      } else if (res.verdict === "probable" && res.finish) {
        const pkey = `${s.id}|${race.date}|${res.finish.seconds}`;
        if (pendSet.has(pkey)) { skips.push(`${s.name}: ВЕРОЯТНОЕ ${race.date} уже в очереди → без изменений`); continue; }
        pendSet.add(pkey);
        pendPlans.push({ studentId: s.id, studentName: s.name, race, res });
      } else if (MODE_NAME_FALLBACK && confirmed.length > 0) {
        // NAME-FALLBACK. Fires ONLY here — after the time match produced NO exact/probable, i.e. the time
        // anchor is unreliable (no workout time, or the time is farther than the probable tolerance from
        // the finish). Safeguards: matches ONLY a coach-CONFIRMED spelling (club_probeg_athlete_links);
        // groups same-date hits by distance and marks NAMESAKES (>1 at one distance) ambiguous — the coach
        // picks, the code never chooses; honours the tombstone + queue-dedup; NEVER auto-links (queue only).
        const confSet = new Set(confirmed.map(normalizeFinisherName).filter((x) => x.length > 0));
        const hits = res.sameDate.filter((f) => f.name && confSet.has(normalizeFinisherName(f.name)));
        if (hits.length === 0) continue;
        const byDist = new Map<string, ProbegFinish[]>();
        for (const f of hits) { const k = f.distanceKm == null ? "?" : String(Math.round(f.distanceKm * 10)); const g = byDist.get(k); if (g) g.push(f); else byDist.set(k, [f]); }
        for (const [, group] of byDist) {
          const ambiguous = group.length > 1; // >1 confirmed-name finisher at one date+distance = namesakes
          for (const f of group) {
            if (rejectedSet.has(`${s.id}|${race.date}|${f.protocolUrl ?? ""}`)) continue;
            const pkey = `${s.id}|${race.date}|${f.seconds}`;
            if (pendSet.has(pkey)) continue;
            pendSet.add(pkey);
            const anchorNote = race.ourSeconds == null
              ? "нет времени тренировки в этот день"
              : `наше ${fmtHms(race.ourSeconds)} vs протокол ${fmtHms(f.seconds)} — мимо допуска по времени`;
            const distanceDoubtful = race.ourKm != null && f.distanceKm != null && !distanceMatch(race.ourKm, f.distanceKm);
            pendPlans.push({ studentId: s.id, studentName: s.name, race, res: { ...res, finish: f, distanceDoubtful }, matchKind: "name_fallback", ambiguous, anchorNote });
          }
        }
      }
    }
  }

  // Hard VOLUME GATE (safeguard 3): the name-fallback must never flood the queue into uselessness.
  // Count the fallback cards BEFORE any write; over the threshold → write NOTHING, print the count and a
  // by-year breakdown so the coach can narrow the set (e.g. one year at a time) and re-run.
  if (MODE_NAME_FALLBACK) {
    const fb = pendPlans.filter((p) => p.matchKind === "name_fallback");
    if (fb.length > NAME_FALLBACK_MAX) {
      const byYear = new Map<string, number>();
      for (const p of fb) { const y = (p.race.date ?? "").slice(0, 4) || "?"; byYear.set(y, (byYear.get(y) ?? 0) + 1); }
      console.log(`\n⛔ ГЕЙТ ОБЪЁМА: имя-фолбэк добавил бы ${fb.length} карточек (порог ${NAME_FALLBACK_MAX}). НИЧЕГО не записано.`);
      console.log(`   По годам: ${[...byYear.entries()].sort().map(([y, n]) => `${y}:${n}`).join("  ")}`);
      console.log(`   Сузь набор (--name-fallback-max=N или отдельным прогоном по годам) и запусти снова.`);
      process.exit(0);
    }
    if (fb.length > 0) console.log(`\nИмя-фолбэк: ${fb.length} карточек в очередь (порог ${NAME_FALLBACK_MAX}); авто-привязок нет.`);
  }

  // club_records is UNIQUE(student, distance_key): a student with several protocols on one distance must
  // collapse to ONE row. Keep the FASTEST (best) — deterministic, never last-processed. Show each collision.
  const collisions: string[] = [];
  const slowerThanOurs: string[] = [];
  const coachVsProtocol: string[] = []; // где твоё coach_confirmed расходится с официальным протоколом
  const groups = new Map<string, ExactCand[]>();
  for (const c of exactCands) { const k = `${c.studentId}|${c.dkey}`; const g = groups.get(k); if (g) g.push(c); else groups.set(k, [c]); }
  for (const [k, group] of groups) {
    const { studentName, dkey, studentId } = group[0];
    const ex = recMap.get(k);
    const winner = group.reduce((a, b) => (b.finish.seconds < a.finish.seconds ? b : a)); // best = fastest official
    if (group.length > 1) {
      collisions.push(`${studentName} [${dkey}]: ${group.length} результата (${group.map((c) => fmtHms(c.finish.seconds)).join(", ")}) → берём ЛУЧШИЙ ${fmtHms(winner.finish.seconds)} (${winner.date}, ${winner.finish.protocolUrl ?? "url?"})`);
    }
    const url = winner.finish.protocolUrl ?? null;
    if (ex?.source === "coach_confirmed") {
      // Правило верное (не перезаписываем), но показываем расхождение: если ты вносил по памяти и ошибся,
      // протокол точнее — решишь точечно.
      const cs = ex.seconds;
      if (cs != null) {
        const d = winner.finish.seconds - cs;
        const rel = d === 0 ? "совпадает" : d > 0 ? `протокол медленнее на ${d}с` : `протокол БЫСТРЕЕ на ${-d}с`;
        coachVsProtocol.push(`${studentName} [${dkey}]: твоё ${fmtHms(cs)} vs протокол ${fmtHms(winner.finish.seconds)} — ${rel}  ${winner.finish.protocolUrl ?? ""}`);
      } else {
        coachVsProtocol.push(`${studentName} [${dkey}]: твоё coach_confirmed без времени vs протокол ${fmtHms(winner.finish.seconds)}  ${winner.finish.protocolUrl ?? ""}`);
      }
      skips.push(`${studentName}: ${dkey} уже coach_confirmed → не трогаю (${group.length} проток. пропущено)`);
      continue;
    }
    if (ex?.source === "official_protocol") {
      if (ex.url === url) { skips.push(`${studentName}: ${dkey} уже привязан к тому же протоколу → без изменений`); continue; }
      if (ex.seconds != null && ex.seconds <= winner.finish.seconds) { skips.push(`${studentName}: ${dkey} уже official ${fmtHms(ex.seconds)} не хуже ${fmtHms(winner.finish.seconds)} → оставляю`); continue; }
    }
    recordPlans.push({ studentId, studentName, dkey, finish: winner.finish, date: winner.date, action: ex ? "upgrade" : "insert", ourSeconds: winner.ourSeconds });
    // Official slower than OUR best time at this distance: our GPS said faster. Rule — official wins
    // (verified fact; a faster reconstructed value is likely GPS garbage), but surface it for the coach.
    const bestOur = group.reduce<number | null>((m, c) => (c.ourSeconds != null && (m == null || c.ourSeconds < m) ? c.ourSeconds : m), null);
    if (bestOur != null && winner.finish.seconds > bestOur) {
      slowerThanOurs.push(`${studentName} [${dkey}]: наше лучшее ${fmtHms(bestOur)} vs официальное ${fmtHms(winner.finish.seconds)} (медленнее на ${winner.finish.seconds - bestOur}с) → пишем ОФИЦИАЛЬНОЕ`);
    }
    const norm = normalizeFinisherName(winner.finish.name);
    if (norm && !linkSet.has(`${studentId}|${norm}`)) { linkSet.add(`${studentId}|${norm}`); linkPlans.push({ studentId, studentName, name: winner.finish.name, norm }); }
  }

  console.log(`\n--- КОЛЛИЗИИ (несколько результатов на одну дистанцию → берётся ЛУЧШИЙ): ${collisions.length} ---`);
  for (const l of collisions) console.log(`  ${l}`);
  console.log(`\n--- ОФИЦИАЛЬНЫЙ МЕДЛЕННЕЕ НАШЕГО (правило: пишем официальный — он проверенный факт): ${slowerThanOurs.length} ---`);
  for (const l of slowerThanOurs) console.log(`  ${l}`);
  console.log(`\n--- COACH_CONFIRMED vs ПРОТОКОЛ (${coachVsProtocol.length}) — твоё подтверждённое НЕ трогаем; смотри расхождения, если вносил по памяти ---`);
  for (const l of coachVsProtocol) console.log(`  ${l}`);
  console.log(`\n--- АВТО-ПРИВЯЗКИ → club_records (official_protocol/verified), по одному лучшему на (ученик,дистанция): ${recordPlans.length} ---`);
  for (const p of recordPlans) console.log(`  ${p.studentName}: [${p.dkey}] ${p.action} → ${fmtHms(p.finish.seconds)}${p.ourSeconds != null && p.finish.seconds > p.ourSeconds ? ` (наше ${fmtHms(p.ourSeconds)})` : ""} ${p.finish.protocolUrl ?? "(url?)"} (гонка ${p.date}, ${p.finish.event})`);
  console.log(`\n--- ЖУРНАЛ → club_official_results (ВСЕ официальные результаты, любая дистанция): ${officialPlans.length} ---`);
  for (const p of officialPlans) console.log(`  ${p.studentName}: ${p.date} ${fmtKm(p.finish.distanceKm)} ${fmtHms(p.finish.seconds)} место ${p.finish.place ?? "?"} ${p.finish.city ?? ""} ${p.finish.protocolUrl ?? ""}${p.distanceDoubtful ? " [дист.сомнит.]" : ""}`);
  console.log(`\n--- ПАМЯТЬ НАПИСАНИЙ → club_probeg_athlete_links: ${linkPlans.length} ---`);
  for (const p of linkPlans) console.log(`  ${p.studentName}: «${p.name}»`);
  console.log(`\n--- В ОЧЕРЕДЬ ПОДТВЕРЖДЕНИЯ → club_protocol_pending: ${pendPlans.length} ---`);
  for (const p of pendPlans) {
    const flags = [p.res.distanceDoubtful ? "дист.сомнит." : "", p.res.nameUnrecognized ? "имя?" : "", p.res.weakName ? "без фамилии" : ""].filter(Boolean).join(",");
    console.log(`  ${p.studentName}: ${p.race.date} наше ${fmtKm(p.race.ourKm)} ${fmtHms(p.race.ourSeconds)} ↔ ${p.res.finish?.name} ${fmtKm(p.res.finish?.distanceKm ?? null)} ${fmtHms(p.res.finish?.seconds ?? null)} место ${p.res.finish?.place ?? "?"}${flags ? ` [${flags}]` : ""}`);
  }
  console.log(`\n--- ПРОПУЩЕНО (coach_confirmed / уже привязано / нестанд. дистанция / уже в очереди): ${skips.length} ---`);
  for (const l of skips) console.log(`  ${l}`);
  // Разбивка по причинам — что уходит в АВТО, что в очередь на подтверждение.
  const winners = [...new Map(exactCands.map((c) => [`${c.studentId}|${c.dkey}`, c])).values()]; // по одному лучшему на (ученик,дистанция)
  const autoConfirmed = winners.filter((c) => c.byConfirmedName).length;
  const autoShortened = winners.filter((c) => !c.byConfirmedName && c.byShortenedName).length; // сокращённое имя, фамилия точная
  const autoStrict = winners.length - autoConfirmed - autoShortened; // имя+дистанция+время строго (сомнит.дист. больше НЕ авто)
  const qDoubt = pendPlans.filter((p) => p.res.distanceDoubtful).length; // сомнительная дистанция → всегда очередь
  const qWeak = pendPlans.filter((p) => !p.res.distanceDoubtful && p.res.weakName).length; // ученик без фамилии → на подтверждение
  const qUnrec = pendPlans.filter((p) => !p.res.distanceDoubtful && !p.res.weakName && p.res.nameUnrecognized).length; // имя не распозналось
  const qWide = pendPlans.length - qDoubt - qWeak - qUnrec; // широкое время / fuzzy-фамилия / прочее → на подтверждение
  console.log(`\n=== РАЗБИВКА ПО ПРИЧИНАМ ===`);
  console.log(`АВТО-ПРИВЯЗКА (${winners.length}):`);
  console.log(`  строгое совпадение (имя+дистанция+время): ${autoStrict}`);
  console.log(`  сокращённое имя, фамилия точная, время в секунды: ${autoShortened}`);
  console.log(`  по ранее подтверждённому написанию: ${autoConfirmed}`);
  console.log(`НА ПОДТВЕРЖДЕНИЕ (${pendPlans.length}):`);
  console.log(`  сомнительная дистанция (наша vs протокол): ${qDoubt}`);
  console.log(`  ученик без фамилии: ${qWeak}`);
  console.log(`  имя не распозналось: ${qUnrec}`);
  console.log(`  широкое время / неточная фамилия / прочее: ${qWide}`);
  console.log(`\n=== К ЗАПИСИ: ${recordPlans.length} рекордов + ${officialPlans.length} в журнал + ${linkPlans.length} написаний + ${pendPlans.length} в очередь ===`);

  if (!COMMIT) {
    console.log("\nDRY-RUN: ничего не записано. Проверь список глазами, примени миграции 20260823/20260824/20260825, затем повтори с --commit.");
    process.exit(0);
  }

  const nowIso = new Date().toISOString();
  let ok = 0, failed = 0;
  const run = async (label: string, fn: () => Promise<{ error: { message: string } | null }>): Promise<void> => {
    const { error } = await fn();
    if (error) { failed += 1; console.log(`  FAIL ${label}: ${error.message}`); } else { ok += 1; }
  };
  for (const p of recordPlans) {
    const km = KM_OF_KEY[p.dkey];
    await run(`club_records ${p.studentName}/${p.dkey}`, () => supabase.from("club_records").upsert({
      student_id: p.studentId, distance_key: p.dkey, duration_seconds: p.finish.seconds,
      pace_sec_per_km: km ? Math.round(p.finish.seconds / km) : null, record_date: p.date,
      trust: "verified", source: "official_protocol", protocol_url: p.finish.protocolUrl ?? null,
      protocol_result_time_seconds: p.finish.seconds, verified_at: nowIso, race_name: p.finish.event,
    }, { onConflict: "student_id,distance_key" }));
  }
  for (const p of linkPlans) {
    await run(`link ${p.studentName}`, () => supabase.from("club_probeg_athlete_links").upsert({
      student_id: p.studentId, confirmed_name: p.name, confirmed_name_normalized: p.norm, confirmed_by: "probeg-writer",
    }, { onConflict: "student_id,confirmed_name_normalized" }));
  }
  for (const p of pendPlans) {
    const f = p.res.finish!;
    await run(`pending ${p.studentName}`, () => supabase.from("club_protocol_pending").upsert({
      student_id: p.studentId, race_date: p.race.date, our_seconds: p.race.ourSeconds, our_distance_km: p.race.ourKm, our_title: p.race.title,
      protocol_url: f.protocolUrl ?? null, protocol_name: f.name, protocol_event: f.event, protocol_city: f.city, protocol_place: f.place,
      protocol_seconds: f.seconds, protocol_distance_km: f.distanceKm,
      distance_doubtful: p.res.distanceDoubtful, name_unrecognized: p.res.nameUnrecognized, weak_name: p.res.weakName,
      match_kind: p.matchKind ?? "time", ambiguous: p.ambiguous ?? false, anchor_note: p.anchorNote ?? null,
    }, { onConflict: "student_id,race_date,protocol_seconds" }));
  }
  for (const p of officialPlans) {
    const f = p.finish;
    await run(`journal ${p.studentName}`, () => supabase.from("club_official_results").upsert({
      student_id: p.studentId, race_date: p.date, distance_km: f.distanceKm, distance_label: f.distanceKm != null ? `${f.distanceKm} км` : null,
      result_seconds: f.seconds, protocol_url: f.protocolUrl ?? null, protocol_name: f.name, place: f.place, city: f.city, event: f.event,
      source: "official_protocol", trust: "verified", distance_doubtful: p.distanceDoubtful, confirmed_by: "probeg-writer", updated_at: nowIso,
    }, { onConflict: "student_id,race_date,protocol_url" }));
  }
  console.log(`\n=== COMMIT завершён: ${ok} записано, ${failed} ошибок ===`);
  process.exit(failed ? 1 : 0);
}

async function main(): Promise<void> {
  if (MODE_CANDIDATES) return runCandidates();
  if (MODE_WRITE) return runWrite();
  if (MODE_CHECK_ALL) return runCheckAll();
  if (MODE_CHECK) return runCheck();
  console.error("Режим: --candidates | --check --students=<path.json> | --check-all | --write [--commit]");
  process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
