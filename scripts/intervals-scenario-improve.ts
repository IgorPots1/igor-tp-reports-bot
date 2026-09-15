/**
 * ЖИВОЙ ПРОГОН ВТОРОЙ ВЕТКИ: человек уже бегает, истории много, цель improve.
 *
 * ЗАЧЕМ ОТДЕЛЬНО ОТ intervals-live-run. Тот прогоняет ветку новичка: истории
 * нет, план строит лестница шаг-бега. Валентина — другой случай и другой код:
 * стартовая точка считается ИЗ ИСТОРИИ, цикл разворачивает forecast(), неделю
 * собирает buildWeek() с конвертом объёма. Эту ветку на живых данных не гонял
 * никто, а первая настоящая ученица придёт именно в неё.
 *
 * ── ОТКУДА БЕРЁТСЯ ИСТОРИЯ ──────────────────────────────────────────────────
 *
 * Копией из настоящего источника (по умолчанию i38500, аккаунт тренера).
 * Причина: в базе стоит уникальность (provider, external_athlete_id), второй
 * источник на тот же аккаунт завести нельзя, а генерировать план ПРЯМО на
 * источник тренера значит писать боевые строки туда, где их никто не ждёт.
 *
 * Копируются НАСТОЯЩИЕ тренировки, ничего не выдумывается: те же минуты, те же
 * даты, те же пульсы. Меняется один столбец — source_id.
 *
 * ── ЧТО ДЕЛАЕТ ──────────────────────────────────────────────────────────────
 *   1. заводит карточку «Валентина (сценарий improve)» и тестовый источник;
 *   2. копирует в него последние N недель тренировок из источника истории;
 *   3. кладёт анкету: цель improve, дни, потолок времени;
 *   4. генерирует план настоящим генератором и печатает недели;
 *   5. публикует и показывает экран ученицы.
 *
 * Запуск:   npm run intervals:scenario-improve
 * Уборка:   npm run intervals:scenario-improve -- --cleanup --yes-delete-live-rows
 */

import { spawnSync } from "node:child_process";
import process from "node:process";

import { todayIsoInZone } from "@/features/intervals/loop/clock";
import { getLatestCycle, getPublishedCycle, listSessionsInRange, publishCycle } from "@/features/intervals/loop/repository";
import { loadStudentView } from "@/features/intervals/loop/service";
import { createSupabaseServerClient } from "@/features/supabase/server";

const CLEANUP = process.argv.includes("--cleanup");
const CONFIRM = process.argv.includes("--yes-delete-live-rows");

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : null;
}

const HISTORY_FROM = arg("history-from") ?? "i38500";
/**
 * ОКНО ИСТОРИИ И СДВИГ — САМОЕ ЧЕСТНОЕ МЕСТО В ЭТОМ СКРИПТЕ.
 *
 * У аккаунта тренера за последние месяцы бега почти нет: 4 пробежки за 16
 * недель. Стартовая точка считается по МЕДИАНЕ наблюдённых недель, медиана
 * такой истории равна нулю, и ветка improve честно отказывается собирать план.
 * Это верное поведение, но на нём ничего не проверишь.
 *
 * Поэтому берём окно, когда человек реально бегал (январь–май 2025: 15–18
 * пробежек в месяц), и СДВИГАЕМ его вперёд на целое число НЕДЕЛЬ, чтобы оно
 * заканчивалось сегодня. Целое число недель важно: вторник остаётся вторником,
 * и распределение по дням, на которое смотрит планировщик, не врёт.
 *
 * ЧТО ЭТО ЗНАЧИТ ЧЕСТНО: тренировки настоящие, минуты и пульсы настоящие,
 * выдуман только календарь. Это сценарий для проверки кода, а не данные
 * ученика, и в отчёте про сдвиг сказано прямо.
 */
const HISTORY_SINCE = arg("history-since") ?? "2025-01-01";
const HISTORY_UNTIL = arg("history-until") ?? "2025-05-31";
const NO_SHIFT = process.argv.includes("--no-shift");
const DAYS = Number(arg("days") ?? 4);
const STUDENT_ID = "valentina-scenario";
const ATHLETE_ID = "valentina-scenario";
const NAME = "Валентина (сценарий improve)";

function head(title: string): void {
  console.log("");
  console.log(`── ${title} ${"─".repeat(Math.max(0, 58 - title.length))}`);
}

function fail(message: string): never {
  console.error(`⛔ ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const supabase = createSupabaseServerClient();
  console.log("СЦЕНАРИЙ: УЖЕ БЕГАЕТ, ЦЕЛЬ «УЛУЧШАТЬ РЕЗУЛЬТАТЫ»");

  // ── карточка ──
  const { data: existingCard } = await supabase
    .from("trainingpeaks_students")
    .select("id, is_active")
    .eq("student_id", STUDENT_ID)
    .maybeSingle();

  if (CLEANUP) {
    head("УБОРКА");
    if (!existingCard) {
      console.log("Карточки сценария нет, убирать нечего.");
      return;
    }
    const cardId = String((existingCard as { id: string }).id);
    const { data: src } = await supabase
      .from("student_data_sources")
      .select("id")
      .eq("student_id", cardId)
      .maybeSingle();
    const sourceId = src ? String((src as { id: string }).id) : null;
    console.log(`Карточка ${cardId}${sourceId ? `, источник ${sourceId}` : ""}`);
    if (!CONFIRM) {
      console.log("Ничего не удалено. Нужен второй флаг: --yes-delete-live-rows");
      return;
    }
    if (sourceId) {
      // Активности сносим явно: полагаться на каскад, не проверив его, значит
      // оставить сотни строк-призраков с чужими идентификаторами.
      await supabase.from("intervals_activities").delete().eq("source_id", sourceId);
      await supabase.from("student_data_sources").delete().eq("id", sourceId);
    }
    // Карточку гасим, а не удаляем: DELETE на trainingpeaks_students у
    // service_role нет, и это правильно.
    await supabase.from("trainingpeaks_students").update({ is_active: false }).eq("id", cardId);
    console.log("Убрано: источник удалён, карточка погашена.");
    return;
  }

  let cardId: string;
  if (existingCard) {
    cardId = String((existingCard as { id: string }).id);
    await supabase.from("trainingpeaks_students").update({ is_active: true }).eq("id", cardId);
    console.log(`Карточка уже есть: ${cardId}`);
  } else {
    const { data, error } = await supabase
      .from("trainingpeaks_students")
      .insert({
        student_id: STUDENT_ID,
        student_name: NAME,
        is_active: true,
        coaching_platform: "intervals",
        // Маркерный URL: колонка NOT NULL, а живого адреса в TrainingPeaks у
        // этого человека нет и быть не должно.
        trainingpeaks_athlete_url: `intervals:${ATHLETE_ID}`,
        timezone: "Europe/Moscow",
      })
      .select("id")
      .single();
    if (error) fail(`карточка не завелась: ${error.message}`);
    cardId = String((data as { id: string }).id);
    console.log(`Карточка заведена: ${cardId}`);
  }

  // ── источник ──
  const { data: existingSource } = await supabase
    .from("student_data_sources")
    .select("id")
    .eq("provider", "intervals")
    .eq("external_athlete_id", ATHLETE_ID)
    .maybeSingle();
  let sourceId: string;
  if (existingSource) {
    sourceId = String((existingSource as { id: string }).id);
    console.log(`Источник уже есть: ${sourceId}`);
  } else {
    const { data, error } = await supabase
      .from("student_data_sources")
      .insert({
        student_id: cardId,
        provider: "intervals",
        external_athlete_id: ATHLETE_ID,
        auth_method: "api_key",
        credential: "scenario-placeholder",
        // kind=test: раннер синхронизации такие источники не трогает, и
        // заглушка-ключ не будет каждые полчаса биться об Intervals.
        kind: "test",
        is_active: true,
      })
      .select("id")
      .single();
    if (error) fail(`источник не завёлся: ${error.message}`);
    sourceId = String((data as { id: string }).id);
    console.log(`Источник заведён: ${sourceId}`);
  }

  // ── история ──
  head("ИСТОРИЯ");
  const { data: donor } = await supabase
    .from("student_data_sources")
    .select("id")
    .eq("provider", "intervals")
    .eq("external_athlete_id", HISTORY_FROM)
    .maybeSingle();
  if (!donor) fail(`источник истории ${HISTORY_FROM} не найден`);
  const donorId = String((donor as { id: string }).id);

  const { data: rows, error: readError } = await supabase
    .from("intervals_activities")
    .select(
      "activity_id, name, activity_type, start_date, start_date_local, timezone, moving_time_s, elapsed_time_s, distance_m, total_elevation_gain_m, average_heartrate, max_heartrate, average_speed_mps, calories, data_level, has_heartrate, has_pace, hr_coverage_pct"
    )
    .eq("source_id", donorId)
    .gte("start_date_local", `${HISTORY_SINCE}T00:00:00`)
    .lte("start_date_local", `${HISTORY_UNTIL}T23:59:59`)
    .order("start_date_local", { ascending: true })
    .limit(500);
  if (readError) fail(`история не читается: ${readError.message}`);

  // Сдвиг на целое число недель: последний день окна становится сегодняшним.
  const lastDay = (rows ?? []).length > 0
    ? String((rows as Array<Record<string, unknown>>)[rows!.length - 1].start_date_local).slice(0, 10)
    : HISTORY_UNTIL;
  const rawShiftDays = Math.round(
    (Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`) - Date.parse(`${lastDay}T00:00:00Z`)) /
      86_400_000
  );
  const shiftDays = NO_SHIFT ? 0 : Math.floor(rawShiftDays / 7) * 7;
  const shiftIsoDate = (value: unknown): string | null => {
    if (!value) return null;
    const parsed = Date.parse(String(value).length <= 10 ? `${String(value)}T00:00:00Z` : `${String(value)}Z`);
    if (Number.isNaN(parsed)) return null;
    return new Date(parsed + shiftDays * 86_400_000).toISOString().replace("Z", "");
  };

  // activity_id уникален ГЛОБАЛЬНО, а не в пределах источника (проверено по
  // pg_indexes: intervals_activities_activity_id_key). Поэтому копия получает
  // свой префикс: данные те же самые, настоящие, а идентификатор новый.
  const copies = (rows ?? []).map((raw) => {
    const row = raw as Record<string, unknown>;
    return {
      ...row,
      activity_id: `sc-${String(row.activity_id)}`,
      source_id: sourceId,
      student_id: cardId,
      start_date_local: shiftIsoDate(row.start_date_local) ?? row.start_date_local,
      start_date: row.start_date
        ? new Date(Date.parse(String(row.start_date)) + shiftDays * 86_400_000).toISOString()
        : null,
    };
  });
  if (copies.length === 0) fail(`у ${HISTORY_FROM} нет тренировок за последние ${WEEKS} недель`);

  const { error: copyError } = await supabase
    .from("intervals_activities")
    .upsert(copies, { onConflict: "activity_id" });
  if (copyError) fail(`история не скопировалась: ${copyError.message}`);
  console.log(
    `Скопировано тренировок: ${copies.length} (из ${HISTORY_FROM}, окно ${HISTORY_SINCE} … ${HISTORY_UNTIL})`
  );
  console.log(
    shiftDays === 0
      ? "  даты НЕ сдвигались"
      : `  ДАТЫ СДВИНУТЫ вперёд на ${shiftDays} дней (${shiftDays / 7} недель), чтобы окно заканчивалось сегодня; дни недели сохранены`
  );
  const runs = copies.filter((row) => String(row.activity_type ?? "").includes("Run")).length;
  console.log(`  из них беговых: ${runs}`);

  // ── план ──
  head("ГЕНЕРАЦИЯ ПЛАНА (ЦЕЛЬ IMPROVE)");
  const existingCycle = await getLatestCycle(sourceId);
  if (existingCycle) {
    console.log(`Цикл уже есть: ${existingCycle.id.slice(0, 8)} · ${existingCycle.status}`);
  } else {
    const result = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--loader",
        "./scripts/_alias-loader.mjs",
        "tools/trainingpeaks-export/scripts/intervals-onboarding-plan.ts",
        `--athlete=${ATHLETE_ID}`,
        "--goal=improve",
        `--days=${DAYS}`,
        "--weeks=8",
        "--commit",
      ],
      { encoding: "utf8", cwd: process.cwd() }
    );
    const out = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    for (const line of out.split("\n")) {
      if (
        /Стартовая точка|источник:|уровень данных|наблюдённых|медиана|тип:|база:|потолок|тир:|якорь|порог|Неделя \d|Записано|Отказ|⛔|✖/u.test(
          line
        )
      ) {
        console.log(`  ${line.trim()}`);
      }
    }
    if (result.status !== 0) fail(`генератор отказался (код ${result.status}), причина выше`);
  }

  const cycle = await getLatestCycle(sourceId);
  if (!cycle) fail("цикла нет даже после генерации");

  const sessions = await listSessionsInRange(cycle.id, "2000-01-01", "2100-01-01");
  console.log(`Тренировок в плане: ${sessions.length}`);

  // ── публикация и экран ученицы ──
  head("ПУБЛИКАЦИЯ И ЭКРАН УЧЕНИЦЫ");
  if (cycle.status !== "published") {
    await publishCycle(cycle.id, sourceId, "coach:scenario");
    console.log("  опубликовано");
  }
  const published = await getPublishedCycle(sourceId);
  console.log(`  опубликованный цикл: ${published ? published.id.slice(0, 8) : "нет"}`);

  const today = todayIsoInZone("Europe/Moscow");
  const view = await loadStudentView(sourceId, today);
  if (view.state !== "ready") fail(`экран ученицы: ${view.state}`);
  console.log(`  сегодня (${today}): ${view.today ? `${view.today.title} · ${view.today.minutes} мин` : "отдых"}`);
  for (const card of view.upcoming.slice(0, 5)) {
    console.log(`  дальше: ${card.weekdayLabel} ${card.dateLabel} · ${card.title} · ${card.minutes} мин`);
  }
  console.log(`  ступень: ${view.ladder ? `${view.ladder.step} из ${view.ladder.totalSteps}` : "нет (и не должно быть: это не новичок)"}`);

  head("НЕДЕЛИ ПЛАНА");
  const byWeek = new Map<string, { count: number; minutes: number }>();
  for (const session of sessions) {
    const monday = new Date(Date.parse(`${session.sessionDate}T00:00:00Z`));
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    const key = monday.toISOString().slice(0, 10);
    const cell = byWeek.get(key) ?? { count: 0, minutes: 0 };
    cell.count += 1;
    cell.minutes += session.minutes;
    byWeek.set(key, cell);
  }
  for (const [week, cell] of [...byWeek.entries()].sort()) {
    console.log(`  ${week}: ${cell.count} тренировок, ${cell.minutes} мин`);
  }

  console.log("");
  console.log("Убрать: npm run intervals:scenario-improve -- --cleanup --yes-delete-live-rows");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
