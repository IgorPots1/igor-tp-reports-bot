/**
 * Read-only audit: coverage of trainingpeaks_race_events. Answers "за какой период реально
 * собраны записи, сколько прошлых и сколько будущих, есть ли провал в истории" - the code
 * finding is that the scanner is forward-only (enqueue window = today..+120d), so this shows
 * how little past history exists. No writes, no PII beyond counts + dates.
 *
 * Run:  npm run audit-club-race-events-coverage
 */
import { createSupabaseServerClient } from "@/features/supabase/server";

type Row = { student_id: string; event_date: string | null };

async function main() {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.from("trainingpeaks_race_events").select("student_id, event_date");
  if (error) throw new Error(`race_events read failed: ${error.message}`);
  const rows = (data as Row[] | null) ?? [];

  const today = new Date().toISOString().slice(0, 10);
  const dated = rows.map((r) => (r.event_date ?? "").slice(0, 10)).filter(Boolean).sort();
  const past = dated.filter((d) => d < today).length;
  const future = dated.filter((d) => d >= today).length;
  const students = new Set(rows.map((r) => r.student_id)).size;

  // Per-year histogram to surface the history gap.
  const byYear = new Map<string, number>();
  for (const d of dated) byYear.set(d.slice(0, 4), (byYear.get(d.slice(0, 4)) ?? 0) + 1);

  console.log(
    JSON.stringify(
      {
        total: rows.length,
        distinct_students: students,
        date_range: dated.length ? `${dated[0]} .. ${dated[dated.length - 1]}` : "нет записей",
        past_vs_today: past,
        future_from_today: future,
        by_year: Object.fromEntries([...byYear.entries()].sort()),
        verdict:
          past === 0
            ? "0 прошлых гонок - сканер forward-only, история пуста. Добор прошлого окна даст гонки."
            : past < future
              ? "прошлого сильно меньше будущего - история почти не собрана; стоит добрать прошлое окно."
              : "история есть - оцени провалы по by_year",
      },
      null,
      2
    )
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(String((e as { message?: string })?.message ?? e));
    process.exit(1);
  });
