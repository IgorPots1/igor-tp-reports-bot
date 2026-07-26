/**
 * Check 2 — race_events 133 → 24 dropoff funnel. READ-ONLY.
 * Categorizes every trainingpeaks_race_events row by why it does / doesn't become a
 * clean club race record, and writes docs/race-events-dropoff.md. No implementation.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createSupabaseServerClient } from "@/features/supabase/server";
import { evaluateAllRecordsForValidation } from "@/features/club/service";
import { fetchAllRows } from "@/features/supabase/paginate";
import { CLUB_RECORD_DISTANCES } from "@/features/club/constants";
import type { RecordDistanceKey } from "@/features/club/records";

function belgradeToday(): string {
  // Approximate Europe/Belgrade day for the future/past split (day-granular data).
  return new Date(Date.now() + 2 * 3600_000).toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const supabase = createSupabaseServerClient();
  const events = await fetchAllRows<{ student_id: string; event_date: string; distance_raw: string | null; distance_km: number | null }>(
    (from, to) => supabase.from("trainingpeaks_race_events").select("student_id, event_date, distance_raw, distance_km").order("id", { ascending: true }).range(from, to),
    { label: "race_events" }
  );
  const run = await evaluateAllRecordsForValidation({ useBestSplit: true });
  const today = belgradeToday();
  const keys = CLUB_RECORD_DISTANCES.map((d) => d.key) as RecordDistanceKey[];

  // Index: completed running workouts per student per date.
  const workoutDays = new Set<string>();
  for (const r of run.rows) {
    if (r.isCompleted && r.isRunning) workoutDays.add(`${r.studentId}|${r.workoutDate}`);
  }
  // Index: does a student have a NON-HIDDEN record candidate on a given date (any distance)?
  const nonHiddenByStudentDate = new Set<string>();
  const anyCandidateByStudentDate = new Set<string>();
  for (const [studentId, perDist] of run.byStudent) {
    for (const key of keys) {
      const res = perDist.get(key);
      if (!res) continue;
      for (const ev of res.evaluated) {
        anyCandidateByStudentDate.add(`${studentId}|${ev.candidate.date}`);
        if (ev.trust !== "hidden") nonHiddenByStudentDate.add(`${studentId}|${ev.candidate.date}`);
      }
    }
  }

  const cat: Record<string, number> = {
    future_no_finish: 0,
    duplicate_same_student_date: 0,
    no_matching_workout: 0,
    distance_unsupported: 0,
    failed_plausibility: 0,
    became_record: 0,
  };
  const seen = new Set<string>();

  for (const e of events) {
    const key = `${e.student_id}|${(e.event_date ?? "").slice(0, 10)}`;
    if ((e.event_date ?? "") > today) { cat.future_no_finish += 1; continue; }
    if (seen.has(key)) { cat.duplicate_same_student_date += 1; continue; }
    seen.add(key);
    if (!workoutDays.has(key)) { cat.no_matching_workout += 1; continue; }
    if (nonHiddenByStudentDate.has(key)) { cat.became_record += 1; continue; }
    if (anyCandidateByStudentDate.has(key)) { cat.failed_plausibility += 1; }
    else { cat.distance_unsupported += 1; }
  }

  const total = events.length;
  const lines: string[] = [];
  lines.push("# race_events 133 → 24 — воронка отсева (Проверка 2)");
  lines.push("");
  lines.push(`Read-only. Всего строк trainingpeaks_race_events: **${total}**. Каждая строка отнесена к ОДНОЙ причине.`);
  lines.push("");
  lines.push("| Причина | Кол-во |");
  lines.push("|---|---|");
  lines.push(`| Нет времени финиша — БУДУЩИЙ старт (event_date > сегодня) | ${cat.future_no_finish} |`);
  lines.push(`| Дубль (тот же ученик+дата, что уже посчитан) | ${cat.duplicate_same_student_date} |`);
  lines.push(`| Не привязалось к тренировке (нет завершённого бега в этот день) | ${cat.no_matching_workout} |`);
  lines.push(`| Дистанция не корзинуется (нет кандидата ни в одной цели 5/10/21.1/42.2) | ${cat.distance_unsupported} |`);
  lines.push(`| Не прошло проверки правдоподобия (кандидаты есть, но все hidden) | ${cat.failed_plausibility} |`);
  lines.push(`| **Стало записью-гонкой** | ${cat.became_record} |`);
  lines.push(`| **ИТОГО** | ${Object.values(cat).reduce((a, b) => a + b, 0)} |`);
  lines.push("");
  lines.push("Примечание: «не привязалось к ученику» = 0 (у всех строк есть student_id, проверено в Фазе 0).");
  lines.push("Здесь «привязка» = совпадение с завершённой пробежкой того дня (иначе неоткуда взять время).");
  lines.push("");
  lines.push("## Сколько можно вытащить и что нужно");
  lines.push("");
  lines.push(`- **Будущие (${cat.future_no_finish})**: не вытащить сейчас — результата ещё нет. Появятся сами после гонки+синка.`);
  lines.push(`- **Нет тренировки в день (${cat.no_matching_workout})**: время брать неоткуда в кэше. Вытащить можно, если (а) добрать FIT/summary на эти даты (глубже скан), либо (б) тренер введёт время вручную (coach_confirmed), либо (в) сверка с протоколом probeg.org по названию+дате.`);
  lines.push(`- **Дистанция не корзинуется (${cat.distance_unsupported})**: гонки на нестандарт (трейл/15k/ультра). Вытащить — только расширив набор дистанций рекордов ИЛИ ручным вводом.`);
  lines.push(`- **Не прошло правдоподобия (${cat.failed_plausibility})**: пауза/битые лапы/интервалы в записи гоночного дня. Часть вытащима: взять чистое время из summary тренировки, а не из лап (best-split), либо coach_confirmed.`);
  lines.push(`- **Дубли (${cat.duplicate_same_student_date})**: не теряются — это та же гонка, учтена один раз.`);
  lines.push("");
  lines.push("Реализацию не делаю — только цифры (по наряду).");

  const out = resolve(process.cwd(), "docs/race-events-dropoff.md");
  writeFileSync(out, lines.join("\n"), "utf8");
  console.log(JSON.stringify(cat));
  console.log(`total=${total} wrote ${out}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
