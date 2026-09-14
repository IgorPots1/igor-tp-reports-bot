/**
 * Регулярный приём тренировок по всем действующим источникам Intervals.
 *
 * КАК МЫ УЗНАЁМ О НОВОЙ ТРЕНИРОВКЕ [решение 02.10.2026]. Опросом по расписанию.
 *
 * ПОЧЕМУ НЕ ВЕБХУК. Вебхуки Intervals.icu живут в OAuth-приложении, а оно ещё не
 * зарегистрировано. Это не «мы выбрали опрос», это «вебхука сейчас нет вообще».
 * Когда приложение зарегистрируют, вебхук станет возможен — и тогда этот раннер
 * превратится в страховку на случай пропущенного события, а не в основной путь.
 *
 * ПОЧЕМУ НЕ ТЯНЕМ ПРИ ОТКРЫТИИ ЭКРАНА. Ученица открывает приложение, чтобы
 * узнать, что бежать сегодня. Заставлять её ждать чужой API ради данных, нужных
 * тренеру, — это плата не с того человека. Тренер же и так смотрит админку
 * после того, как раннер отработал.
 *
 * ОКНО КОРОТКОЕ И В ЭТОМ ВСЯ ЭКОНОМИЯ. Берём последние 10 дней, а не историю:
 * задача раннера — заметить новое, а не перевезти прошлое. Бэкфилл остаётся
 * отдельной ручной операцией (intervals-ingest-once.ts --all).
 *
 * ЧТО СЛОМАЕТСЯ НА ДВАДЦАТИ ЛЮДЯХ — честно, потому что чинить это сейчас рано:
 *   · источники опрашиваются ПОСЛЕДОВАТЕЛЬНО. На одном это секунды, на двадцати
 *     — минуты, и один медленный ответ задерживает всех, кто за ним;
 *   · своего ограничителя частоты нет: двадцать источников подряд — это всплеск
 *     запросов к чужому API, и первым признаком перебора будет 429, а не
 *     предупреждение;
 *   · повторных попыток нет. Источник, упавший на сетевой ошибке, просто
 *     пропускается до следующего запуска — на одном человеке это полчаса
 *     задержки, на двадцати это уже «у кого-то данные регулярно старые»;
 *   · окно фиксированное, а не от last_synced_at. Человек, не бегавший месяц,
 *     опрашивается так же часто, как ежедневный;
 *   · выборка источников идёт без постраничного чтения — на тысяче строк
 *     упрётся в серверный порог PostgREST (1000) и молча обрежется.
 *
 * Запуск:
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=.env.local scripts/intervals-sync-active.ts [--window=10] [--dry-run]
 */
import process from "node:process";

import { ingestStudentActivities } from "@/features/intervals/ingest";
import { createSupabaseServerClient } from "@/features/supabase/server";

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : null;
}

const DRY_RUN = process.argv.includes("--dry-run");
const WINDOW_DAYS = Number(arg("window") ?? 10);

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const supabase = createSupabaseServerClient();

  // ТОЛЬКО БОЕВЫЕ ИСТОЧНИКИ. kind фильтруется ЯВНО, а не выводится из наличия
  // student_id: аккаунт тренера и тестовые подключения опрашивать по расписанию
  // незачем, и их тренировки не должны попадать в контур ученика.
  const { data, error } = await supabase
    .from("student_data_sources")
    .select("id, student_id, external_athlete_id, last_synced_at")
    .eq("provider", "intervals")
    .eq("kind", "student")
    .eq("is_active", true)
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(200);
  if (error) {
    console.error(`Не удалось прочитать источники: ${error.message}`);
    process.exit(1);
  }

  const sources = (data ?? []) as Array<{
    id: string;
    student_id: string | null;
    external_athlete_id: string;
    last_synced_at: string | null;
  }>;

  const from = isoDaysAgo(WINDOW_DAYS);
  const to = new Date().toISOString().slice(0, 10);

  console.log(`Источников к опросу: ${sources.length} · окно ${from} … ${to}${DRY_RUN ? " · холостой" : ""}`);
  if (sources.length === 0) return;

  let ok = 0;
  let failed = 0;
  for (const source of sources) {
    if (!source.student_id) {
      // Боевой источник без владельца невозможен по констрейнту; если он всё же
      // есть — это дефект данных, и молчать о нём нельзя.
      console.error(`  ✗ ${source.external_athlete_id}: боевой источник без ученика (source ${source.id})`);
      failed += 1;
      continue;
    }
    if (DRY_RUN) {
      console.log(`  · ${source.external_athlete_id}: пропущен (холостой прогон)`);
      continue;
    }
    try {
      const summary = await ingestStudentActivities({
        studentUuid: source.student_id,
        from,
        to,
      });
      console.log(
        `  ✓ ${source.external_athlete_id}: активностей ${summary.activitiesSeen}, ` +
          `записано ${summary.activitiesSaved}, рядов ${summary.streamsSaved}, ошибок ${summary.errors.length}`
      );
      ok += 1;
    } catch (caught) {
      // Падение одного источника НЕ останавливает остальных: иначе один
      // испорченный ключ лишает данных всех.
      console.error(
        `  ✗ ${source.external_athlete_id}: ${caught instanceof Error ? caught.message : String(caught)}`
      );
      failed += 1;
    }
  }

  console.log(`Готово: успешно ${ok}, с ошибкой ${failed}.`);
  // Ненулевой код только когда НИ ОДИН источник не прошёл: частичный успех — это
  // норма распределённой работы, а не повод будить человека.
  if (ok === 0 && failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
