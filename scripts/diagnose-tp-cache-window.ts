// READ-ONLY: what TrainingPeaks workouts are cached for a student/week, and how
// fresh the cache is. Explains why a nutrition review saw a training day as rest.
//
//   npx tsx scripts/diagnose-tp-cache-window.ts --student-name "Имя" --week-from 2026-06-01 --week-to 2026-06-07
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { loadScriptEnv, resolveSupabaseEnv } from "./lib/load-script-env";

function arg(n: string): string | undefined {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const STALE_MS = 48 * 60 * 60 * 1000;

async function main() {
  loadScriptEnv();
  const env = resolveSupabaseEnv();
  if (!env) {
    console.error("Нет SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (.env.local).");
    process.exit(1);
  }
  const sb = createClient(env.supabaseUrl, env.serviceRoleKey, { auth: { persistSession: false } });

  let studentId = arg("student-id") ?? null;
  const name = arg("student-name");
  if (!studentId && name) {
    const { data } = await sb
      .from("trainingpeaks_students")
      .select("id,student_name")
      .ilike("student_name", `%${name}%`)
      .limit(5);
    console.table(data ?? []);
    studentId = (data ?? [])[0]?.id ?? null;
  }
  if (!studentId) {
    console.error("Укажи --student-id <uuid> или --student-name <имя>.");
    process.exit(1);
  }
  const weekFrom = arg("week-from") ?? "2026-06-01";
  const weekTo = arg("week-to") ?? "2026-06-07";

  const { data: rows, error } = await sb
    .from("trainingpeaks_workout_cache")
    .select("workout_date,title,is_planned,is_completed,scanned_at,source_updated_at")
    .eq("student_id", studentId)
    .gte("workout_date", weekFrom)
    .lte("workout_date", weekTo)
    .order("workout_date");
  if (error) {
    console.error("DB error:", error.message);
    process.exit(1);
  }

  console.log(`\n=== Кэш тренировок ${weekFrom}..${weekTo} === строк: ${(rows ?? []).length}`);
  let latestScan = 0;
  for (const r of rows ?? []) {
    const scanMs = r.scanned_at ? Date.parse(r.scanned_at) : 0;
    if (scanMs > latestScan) latestScan = scanMs;
    console.log(`${r.workout_date} | planned:${r.is_planned} completed:${r.is_completed} | scanned:${r.scanned_at} | "${r.title}"`);
  }

  // Per-day coverage Mon..Sun of the window
  console.log("\n=== Покрытие по дням окна ===");
  const start = new Date(`${weekFrom}T00:00:00Z`);
  for (let i = 0; i < 7; i++) {
    const d = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
    if (d > weekTo) break;
    const has = (rows ?? []).some((r) => r.workout_date === d);
    console.log(`${d}: ${has ? "есть тренировка в кэше" : "ПУСТО (анализ увидит как отдых)"}`);
  }

  // Freshness verdict (mirrors nutrition resolveCacheStatus)
  console.log("\n=== Свежесть кэша ===");
  if ((rows ?? []).length === 0) {
    console.log("EMPTY — кэша за окно нет вовсе.");
  } else if (!latestScan) {
    console.log("STALE — нет меток scanned_at.");
  } else {
    const ageH = ((Date.now() - latestScan) / 3600000).toFixed(1);
    const verdict = Date.now() - latestScan > STALE_MS ? "STALE (>48ч)" : "OK (<48ч)";
    console.log(`последний scanned_at: ${new Date(latestScan).toISOString()} | возраст ~${ageH}ч | ${verdict}`);
  }

  // When was this student last scanned at all
  const { data: latest } = await sb
    .from("trainingpeaks_workout_cache")
    .select("scanned_at")
    .eq("student_id", studentId)
    .order("scanned_at", { ascending: false })
    .limit(1);
  console.log("последний scan по ученику вообще:", latest?.[0]?.scanned_at ?? "(нет)", "| сейчас:", new Date().toISOString());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
