/**
 * READ-ONLY. Estimate the impact of backfilling past races into
 * `trainingpeaks_race_events` BEFORE it is done. No writes, safe anytime.
 *
 * Two independent surfaces are touched when past race dates are added:
 *
 *   (1) CLUB RECORDS. materializeClubRecords() re-splits each distance into
 *       race vs training_split by matching the record date against the student's
 *       race dates (classifyRecordType -> loadRaceDatesWithSource, which unions
 *       trainingpeaks_race_events + club_calendar_entries kind='race'). Adding a
 *       past race_events row -> any CURRENT training_split whose (student, date)
 *       becomes a race date moves OUT of the training pool INTO the race pool on
 *       the next materialize. It is a RE-SPLIT, not a relabel: the training 'best'
 *       for that distance recomputes to the next non-race split (or disappears).
 *
 *   (2) FEEDBACK / COMPARISON. fetchRaceKeys() (feedback-enqueue) drops workouts
 *       whose (student, date) is a race date, within the last 400 days, from the
 *       comparison base and personal easy-run baselines, so a max-effort start does
 *       not inflate the norm. Adding a past race_events row -> the run on that date
 *       stops feeding the norm.
 *
 * The record surface is bounded and small (a student has ~one best per distance;
 * only a best that happens to sit exactly on a race day flips). The feedback
 * surface scales with the number of new past dates (roughly one run per race).
 *
 * OUTPUT: a JSON blob plus a plain-language RU summary that a reader can act on
 * without any extra context. Answers, on CURRENT data:
 *   - baseline counts (race_events, snapshots by type, coverage),
 *   - a scan-INDEPENDENT HARD CEILING on record flips (cannot be exceeded no
 *     matter how many hundreds of dates are added),
 *   - if a scan races.json is supplied: the EXACT flips / exclusions for that
 *     candidate set, plus ratios to extrapolate to a full-roster scan.
 *
 * RUN (from repo root):
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=.env.local scripts/audit-club-race-reclassification.ts \
 *     [--scan=tools/trainingpeaks-export/reports/races-scan/<ts>/races.json]
 *
 * If --scan is omitted, the newest races-scan/<ts>/races.json is used (if present).
 * For a FULL-roster estimate, first produce a complete report-only scan (it writes
 * races.json and does NOT touch the DB):
 *   cd tools/trainingpeaks-export
 *   npm run tp-scan-events -- --from=<past YYYY-MM-DD> --to=<today> --limit=10000
 * then point --scan at the fresh races.json.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { createSupabaseServerClient } from "@/features/supabase/server";

const SCAN_ROOT = path.join(process.cwd(), "tools", "trainingpeaks-export", "reports", "races-scan");
const FEEDBACK_EXCLUSION_WINDOW_DAYS = 400; // fetchRaceKeys window in feedback-enqueue.ts
const PAGE = 1000;

type SupabaseClient = ReturnType<typeof createSupabaseServerClient>;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function dayFloorIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

function parseAthleteId(url: string | null | undefined): number | null {
  if (!url) return null;
  const m = url.match(/\/athletes\/(\d+)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Read every row of a table (minimal columns) via range pagination. Tolerant: a
 *  missing table / permission error returns [] with a logged note, never throws. */
async function fetchAll<T>(
  supabase: SupabaseClient,
  table: string,
  select: string,
  refine?: (q: ReturnType<ReturnType<SupabaseClient["from"]>["select"]>) => unknown,
  notes?: string[]
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    let q = supabase.from(table).select(select).range(from, from + PAGE - 1);
    if (refine) q = refine(q as never) as typeof q;
    const { data, error } = (await q) as { data: T[] | null; error: { message: string } | null };
    if (error) {
      notes?.push(`${table}: read stopped (${error.message})`);
      break;
    }
    const batch = data ?? [];
    out.push(...batch);
    if (batch.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

function resolveScanPath(): string | null {
  const arg = process.argv.slice(2).find((a) => a.startsWith("--scan="));
  if (arg) {
    const p = arg.slice("--scan=".length).trim();
    return existsSync(p) ? p : null;
  }
  if (!existsSync(SCAN_ROOT)) return null;
  const dirs = readdirSync(SCAN_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => b.localeCompare(a));
  for (const d of dirs) {
    const candidate = path.join(SCAN_ROOT, d, "races.json");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

type ScanRow = { athlete_id?: number | null; event_date?: string | null; student_name?: string | null };

function readScanRows(scanPath: string): ScanRow[] {
  try {
    const parsed = JSON.parse(readFileSync(scanPath, "utf8")) as { rows?: ScanRow[] };
    return Array.isArray(parsed.rows) ? parsed.rows : [];
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const supabase = createSupabaseServerClient();
  const today = todayIso();
  const exclusionFloor = dayFloorIso(FEEDBACK_EXCLUSION_WINDOW_DAYS);
  const notes: string[] = [];

  // --- roster: athlete_id -> student uuid (race_events.student_id === students.id) ---
  const students = await fetchAll<{ id: string; student_name: string | null; trainingpeaks_athlete_url: string | null }>(
    supabase,
    "trainingpeaks_students",
    "id, student_name, trainingpeaks_athlete_url",
    undefined,
    notes
  );
  const athleteToStudent = new Map<number, string>();
  const studentName = new Map<string, string>();
  for (const s of students) {
    studentName.set(s.id, s.student_name ?? s.id);
    const aid = parseAthleteId(s.trainingpeaks_athlete_url);
    if (aid !== null) athleteToStudent.set(aid, s.id);
  }

  // --- baseline: existing race_events per student ---
  const raceEvents = await fetchAll<{ student_id: string; event_date: string | null; source: string | null }>(
    supabase,
    "trainingpeaks_race_events",
    "student_id, event_date, source",
    undefined,
    notes
  );
  const existingByStudent = new Map<string, Set<string>>();
  let rePast = 0;
  let reFuture = 0;
  for (const r of raceEvents) {
    const d = (r.event_date ?? "").slice(0, 10);
    if (!r.student_id || !d) continue;
    const set = existingByStudent.get(r.student_id) ?? new Set<string>();
    set.add(d);
    existingByStudent.set(r.student_id, set);
    if (d < today) rePast += 1;
    else reFuture += 1;
  }

  // --- candidate NEW dates from a scan races.json (not yet persisted) ---
  const scanPath = resolveScanPath();
  const scanRows = scanPath ? readScanRows(scanPath) : [];
  const candidateNewByStudent = new Map<string, Set<string>>();
  let candidateRows = 0;
  let candidateUnresolved = 0;
  let candidateAlreadyKnown = 0;
  for (const row of scanRows) {
    const d = (row.event_date ?? "").slice(0, 10);
    if (!d) continue;
    candidateRows += 1;
    const aid = typeof row.athlete_id === "number" ? row.athlete_id : null;
    const sid = aid !== null ? athleteToStudent.get(aid) : undefined;
    if (!sid) {
      candidateUnresolved += 1;
      continue;
    }
    if (existingByStudent.get(sid)?.has(d)) {
      candidateAlreadyKnown += 1;
      continue;
    }
    const set = candidateNewByStudent.get(sid) ?? new Set<string>();
    set.add(d);
    candidateNewByStudent.set(sid, set);
  }
  const newDatePairs: Array<{ sid: string; date: string }> = [];
  for (const [sid, set] of candidateNewByStudent) for (const d of set) newDatePairs.push({ sid, date: d });
  const nNew = newDatePairs.length;

  // --- surface (1): club record snapshots ---
  const snaps = await fetchAll<{
    student_id: string;
    distance_key: string;
    record_type: string;
    record_date: string | null;
    slot: string;
  }>(supabase, "club_record_snapshots", "student_id, distance_key, record_type, record_date, slot", undefined, notes);

  let snapRaceBest = 0;
  let snapTrainingBest = 0;
  const trainingDatePairs = new Set<string>(); // student|date among training_split (the flip ceiling)
  const hasRaceBest = new Set<string>(); // student|distance that already has a race 'best'
  const trainingBestByStudentDist = new Map<string, { date: string | null }>(); // student|distance -> training best
  for (const s of snaps) {
    const isBest = s.slot === "best";
    if (s.record_type === "race" && isBest) {
      snapRaceBest += 1;
      hasRaceBest.add(`${s.student_id}|${s.distance_key}`);
    }
    if (s.record_type === "training_split" && isBest) {
      snapTrainingBest += 1;
      const d = (s.record_date ?? "").slice(0, 10);
      if (d) trainingDatePairs.add(`${s.student_id}|${d}`);
      trainingBestByStudentDist.set(`${s.student_id}|${s.distance_key}`, { date: d || null });
    }
  }
  const hardCeilingFlips = trainingDatePairs.size; // max training-best flips regardless of #dates added

  // Concrete flips for the candidate scan: a current training_split 'best' whose
  // (student, date) is a NEW candidate race date -> flips to race next materialize.
  const newPairKey = new Set(newDatePairs.map((p) => `${p.sid}|${p.date}`));
  let concreteFlips = 0;
  let coverageGain = 0; // distance-slots that gain a race best they did not have
  const flipsByStudent = new Map<string, number>();
  for (const [key, entry] of trainingBestByStudentDist) {
    const [sid, distanceKey] = key.split("|");
    if (!entry.date) continue;
    if (newPairKey.has(`${sid}|${entry.date}`)) {
      concreteFlips += 1;
      flipsByStudent.set(sid, (flipsByStudent.get(sid) ?? 0) + 1);
      if (!hasRaceBest.has(`${sid}|${distanceKey}`)) coverageGain += 1;
    }
  }

  // --- surface (2): feedback / comparison exclusion (runs within 400d) ---
  const runRows = await fetchAll<{ student_id: string; workout_date: string | null }>(
    supabase,
    "trainingpeaks_workout_derived_metrics",
    "student_id, workout_date",
    (q) => (q as { eq: (c: string, v: string) => { gte: (c: string, v: string) => unknown } }).eq("workout_type", "run").gte("workout_date", exclusionFloor),
    notes
  );
  const runPair = new Set<string>();
  for (const r of runRows) {
    const d = (r.workout_date ?? "").slice(0, 10);
    if (r.student_id && d) runPair.add(`${r.student_id}|${d}`);
  }
  let concreteExclusions = 0;
  const exclByStudent = new Map<string, number>();
  for (const p of newDatePairs) {
    if (p.date < exclusionFloor) continue; // outside the 400d feedback window -> no exclusion effect
    if (runPair.has(`${p.sid}|${p.date}`)) {
      concreteExclusions += 1;
      exclByStudent.set(p.sid, (exclByStudent.get(p.sid) ?? 0) + 1);
    }
  }
  const nNewInWindow = newDatePairs.filter((p) => p.date >= exclusionFloor).length;

  // --- sensitivity: extrapolate to a bigger scan using the observed coincidence ratios ---
  const ratioFlip = nNew > 0 ? concreteFlips / nNew : 0;
  const ratioExcl = nNewInWindow > 0 ? concreteExclusions / nNewInWindow : 0;
  const projection = [100, 250, 500, 1000].map((n) => ({
    new_dates: n,
    projected_record_flips: Math.min(hardCeilingFlips, Math.round(n * ratioFlip)),
    projected_feedback_exclusions: Math.round(n * ratioExcl),
  }));

  const topFlips = [...flipsByStudent.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([sid, n]) => ({ student: studentName.get(sid) ?? sid, flips: n }));
  const topExcl = [...exclByStudent.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([sid, n]) => ({ student: studentName.get(sid) ?? sid, exclusions: n }));

  const report = {
    generated_at: new Date().toISOString(),
    today,
    scan_file: scanPath ?? null,
    feedback_exclusion_window_days: FEEDBACK_EXCLUSION_WINDOW_DAYS,
    baseline: {
      students_in_roster: students.length,
      race_events_total: raceEvents.length,
      race_events_past: rePast,
      race_events_future: reFuture,
      snapshot_rows: snaps.length,
      snapshot_race_best: snapRaceBest,
      snapshot_training_best: snapTrainingBest,
    },
    hard_ceiling: {
      max_record_flips_ever: hardCeilingFlips,
      note: "Upper bound on training_split->race flips no matter how many past dates are added: there are only this many distinct (student, training_split-best date) pairs today.",
    },
    candidate_scan: scanPath
      ? {
          rows_in_scan: candidateRows,
          unresolved_athlete_id: candidateUnresolved,
          already_in_race_events: candidateAlreadyKnown,
          new_dates_resolved: nNew,
          new_dates_within_feedback_window: nNewInWindow,
        }
      : "no scan file found (baseline + hard ceiling only)",
    surface_1_records: {
      concrete_flips: concreteFlips,
      coverage_gain_new_race_slots: coverageGain,
      ratio_flip_per_new_date: Number(ratioFlip.toFixed(4)),
      top_students: topFlips,
    },
    surface_2_feedback: {
      concrete_exclusions: concreteExclusions,
      ratio_exclusion_per_new_date_in_window: Number(ratioExcl.toFixed(4)),
      top_students: topExcl,
    },
    projection_by_new_date_count: projection,
    notes,
  };

  const ru: string[] = [];
  ru.push("=".repeat(72));
  ru.push("ОЦЕНКА ПЕРЕКЛАССИФИКАЦИИ ПРИ ЗАЛИВКЕ ПРОШЛЫХ ГОНОК (read-only, БД не менялась)");
  ru.push("=".repeat(72));
  ru.push(`Дата расчёта: ${today}. Скан-файл кандидатов: ${scanPath ?? "не найден"}`);
  ru.push("");
  ru.push("БАЗА СЕЙЧАС:");
  ru.push(`  race_events всего ${raceEvents.length} (прошлых ${rePast} / будущих ${reFuture}); ростер ${students.length}.`);
  ru.push(`  Снапшоты рекордов: race-best ${snapRaceBest}, training_split-best ${snapTrainingBest} (строк всего ${snaps.length}).`);
  ru.push("");
  ru.push("ПОВЕРХНОСТЬ 1 — РЕКОРДЫ (флип training_split -> race):");
  ru.push(`  ЖЁСТКИЙ ПОТОЛОК: не более ${hardCeilingFlips} флипов КОГДА-ЛИБО — столько различных (ученик, дата)`);
  ru.push(`  среди текущих training_split-best. Сотни новых дат этот потолок НЕ поднимут.`);
  if (scanPath) {
    ru.push(`  По кандидатам скана: ${concreteFlips} флип(ов) сейчас (из ${nNew} новых дат);`);
    ru.push(`  из них ${coverageGain} дистанций-слотов ПОЛУЧАТ race-рекорд, которого не было (рост покрытия).`);
  }
  ru.push("");
  ru.push("ПОВЕРХНОСТЬ 2 — ФИДБЭК/СРАВНЕНИЕ (тренировка на race-дату уходит из базы норм, окно 400 дн):");
  if (scanPath) {
    ru.push(`  По кандидатам: ${concreteExclusions} тренировок(и) исключатся (из ${nNewInWindow} новых дат в окне 400 дн).`);
    ru.push(`  Это ожидаемый эффект: старт перестаёт раздувать «норму». Затрагивает сами дни гонок, не соседние.`);
  } else {
    ru.push(`  Скан-файл не задан — точное число посчитается, когда укажешь --scan.`);
  }
  ru.push("");
  if (scanPath) {
    ru.push("ЭКСТРАПОЛЯЦИЯ на полный ростер (по наблюдённым долям; потолок рекордов = жёсткий кап):");
    for (const p of projection) {
      ru.push(`  ${String(p.new_dates).padStart(4)} новых дат -> флипов рекордов ~${p.projected_record_flips}, исключений из фидбэка ~${p.projected_feedback_exclusions}`);
    }
    ru.push("  (доля флипов = совпадения новых дат с текущими PR-датами; на полном скане будет БОЛЬШЕ дат,");
    ru.push("   но флипы упрутся в потолок выше. Для точных чисел прогони полный report-only скан и укажи --scan.)");
  }
  ru.push("");
  ru.push("ЧТО ЭТО ЗНАЧИТ ДЛЯ ЗАЛИВКИ:");
  ru.push("  1) Рекорды почти не «поедут»: флипы редки (только PR, стоящий ровно на дне гонки) и капнуты потолком.");
  ru.push("  2) После заливки нужна ПЕРЕматериализация (materializeClubRecords) — снапшоты пересчитаются по новым датам.");
  ru.push("  3) Фидбэк: гонки корректно уйдут из базы норм (окно 400 дн). Тренировки вне окна не затронуты.");
  if (notes.length) {
    ru.push("");
    ru.push("ПРЕДУПРЕЖДЕНИЯ ЧТЕНИЯ:");
    for (const n of notes) ru.push(`  - ${n}`);
  }
  ru.push("=".repeat(72));

  console.log(ru.join("\n"));
  console.log("");
  console.log("JSON:");
  console.log(JSON.stringify(report, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    console.error(String((e as { message?: string })?.message ?? e));
    process.exit(1);
  });
