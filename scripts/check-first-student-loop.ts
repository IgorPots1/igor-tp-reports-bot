/**
 * Прогон ВСЕГО пути на тестовом подключении:
 * форма → план → карточка → чек-ин → сдвиг ступени → перенос → текст тренера.
 *
 * Работает на живой базе, но в собственной песочнице: карточка со слагом
 * check-loop-student и источник kind='test'. Настоящих людей не трогает,
 * наружу не пишет ни одного сообщения.
 *
 * УБОРКА СТРОГО ПО СВОИМ СТРОКАМ и с предохранителем: если под слагом вдруг
 * окажется чужая карточка (боевая, kind='student'), скрипт откажется удалять и
 * скажет об этом. Тестовый прогон не имеет права снести ничьи данные.
 *
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=.env.local scripts/check-first-student-loop.ts [--keep]
 */
import process from "node:process";

import { createSupabaseServerClient } from "@/features/supabase/server";
import { stepByIndex } from "@/features/methodology/beginner";
import { buildCoachMessageContext, deliverCoachMessage, isCoachSendEnabled } from "@/features/intervals/loop/coach-message";
import { decideMove } from "@/features/intervals/loop/move";
import {
  getProgression,
  getPublishedCycle,
  listCheckins,
  listCoachMessages,
  listSessionsInRange,
  markCoachMessageDelivered,
  publishCycle,
  setPlanWeekStatus,
  saveCoachMessage,
  saveOnboardingAnswers,
} from "@/features/intervals/loop/repository";
import { loadCabinetView, loadStudentView, moveStudentSession, submitCheckin } from "@/features/intervals/loop/service";

const KEEP = process.argv.includes("--keep");

const SLUG = "check-loop-student";
const ATHLETE = "iCHECKLOOP";
const MARKER_URL = `intervals://athlete/${ATHLETE}`;

let failures = 0;
function step(title: string): void {
  console.log("");
  console.log(`── ${title} ${"─".repeat(Math.max(0, 60 - title.length))}`);
}
function ok(message: string): void {
  console.log(`  ✓ ${message}`);
}
function bad(message: string): void {
  console.log(`  ✗ ${message}`);
  failures += 1;
}
function expect(condition: boolean, message: string): void {
  if (condition) ok(message);
  else bad(message);
}

const supabase = createSupabaseServerClient();

function shift(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
function mondayOf(iso: string): string {
  const date = new Date(Date.parse(`${iso}T00:00:00Z`));
  const offset = (date.getUTCDay() + 6) % 7;
  return shift(iso, -offset);
}

async function ensureSandbox(): Promise<{ studentUuid: string; sourceId: string }> {
  // ЧИСТЫЙ ЛИСТ КАЖДЫЙ РАЗ. Прогон, унаследовавший песочницу от прошлого раза,
  // проверяет не то, что думает: опубликованный в прошлый раз цикл остаётся
  // видимым ученице, пока тренер не подтвердит новый, и шаг «до подтверждения
  // плана нет» ложно проваливается. Поймано прогоном, а не рассуждением.
  await dropSandboxData();

  // КАРТОЧКА ПЕРЕИСПОЛЬЗУЕТСЯ, А НЕ ПЕРЕСОЗДАЁТСЯ. У service_role НЕТ права
  // DELETE на trainingpeaks_students — это осознанная защита таблицы людей
  // (проверено: INSERT/UPDATE/SELECT есть, DELETE нет). Удалять её из скрипта
  // нельзя, да и не нужно: всё состояние прогона висит на ИСТОЧНИКЕ, а он
  // снимается каскадом.
  const { data: existing } = await supabase
    .from("trainingpeaks_students")
    .select("id")
    .eq("student_id", SLUG)
    .maybeSingle();

  let studentUuid: string;
  if (existing) {
    studentUuid = String(existing.id);
    const { error } = await supabase
      .from("trainingpeaks_students")
      .update({ is_active: true, coaching_platform: "intervals" })
      .eq("id", studentUuid);
    if (error) throw new Error(`карточка песочницы: ${error.message}`);
  } else {
    const { data, error } = await supabase
      .from("trainingpeaks_students")
      .insert({
        student_id: SLUG,
        student_name: "Проверка контура",
        trainingpeaks_athlete_url: MARKER_URL,
        coaching_platform: "intervals",
        is_active: true,
        weekly_report_enabled: false,
        telegram_delivery_enabled: false,
      })
      .select("id")
      .single();
    if (error) throw new Error(`карточка песочницы: ${error.message}`);
    studentUuid = String(data.id);
  }

  const { data: source, error: sourceError } = await supabase
    .from("student_data_sources")
    .upsert(
      {
        student_id: studentUuid,
        provider: "intervals",
        external_athlete_id: ATHLETE,
        auth_method: "api_key",
        // Ключ заведомо нерабочий: путь не ходит в сеть, а если однажды пойдёт —
        // упрётся в отказ авторизации, а не утащит чужие данные.
        credential: "check-loop-not-a-real-key",
        kind: "test",
        is_active: true,
        // Реальные источники получают connected_at через manual-entry.ts /
        // connectOauthSource — без него кабинет не смог бы посчитать «недель
        // вместе», а песочница тогда проверяла бы нереалистичное состояние.
        connected_at: new Date().toISOString(),
      },
      { onConflict: "provider,external_athlete_id" }
    )
    .select("id")
    .single();
  if (sourceError) throw new Error(`источник песочницы: ${sourceError.message}`);

  return { studentUuid, sourceId: String(source.id) };
}

/**
 * Снять ВСЁ состояние прогона: источник песочницы и всё, что за ним каскадом
 * (анкета, циклы, сессии, чек-ины, сообщения, прогрессия).
 *
 * Предохранитель: удаляется строго источник с нашим athlete_id и только если он
 * помечен kind='test'. Тестовый прогон не имеет права снести ничьи данные, и
 * молча не снести — тоже не имеет: ошибка удаления поднимается наружу.
 */
async function dropSandboxData(): Promise<void> {
  const { data, error } = await supabase
    .from("student_data_sources")
    .select("id, kind")
    .eq("provider", "intervals")
    .eq("external_athlete_id", ATHLETE)
    .maybeSingle();
  if (error) throw new Error(`песочница, чтение источника: ${error.message}`);
  if (!data) return;
  if ((data as { kind: string }).kind !== "test") {
    throw new Error(`ОТКАЗ: источник ${ATHLETE} не тестовый (kind=${(data as { kind: string }).kind}) — не трогаю`);
  }
  const { error: deleteError } = await supabase
    .from("student_data_sources")
    .delete()
    .eq("id", String((data as { id: string }).id));
  if (deleteError) throw new Error(`песочница, удаление источника: ${deleteError.message}`);
}

async function main(): Promise<void> {
  console.log("ПРОГОН КОНТУРА ПЕРВОЙ УЧЕНИЦЫ — тестовое подключение, наружу ничего не уходит.");
  console.log(`отправка тренера: ${isCoachSendEnabled() ? "ВКЛЮЧЕНА" : "выключена (prepare-only)"}`);

  const { studentUuid, sourceId } = await ensureSandbox();
  console.log(`песочница: карточка ${studentUuid.slice(0, 8)}, источник ${sourceId.slice(0, 8)}`);

  // ── 1. Анкета ──
  step("1. ФОРМА");

  const tooManyDays = await saveOnboardingAnswers({
    sourceId,
    goalKind: "start_running",
    raceDate: null,
    raceDistanceKm: null,
    daysPerWeek: 4,
    selfReportedWeeklyMinutes: null,
    unavailableWeekdays: [],
    preferredLongWeekday: null,
    canRunContinuously: false,
    coachNote: null,
    weekStability: "stable",
    availableWeekdays: [1, 3, 5],
    preferredQualityWeekday: null,
    timeOfDay: "morning",
    runSurfaces: [],
    weekBreakers: null,
    maxSessionMinutes: null,
    daysPerWeekSource: "derived",
  });
  expect(
    !tooManyDays.ok && tooManyDays.message.includes("beginner_days_cap"),
    "четыре беговых дня новичку ОТКЛОНЕНЫ базой (потолок методики жёсткий)"
  );

  const noContinuity = await saveOnboardingAnswers({
    sourceId,
    goalKind: "start_running",
    raceDate: null,
    raceDistanceKm: null,
    daysPerWeek: 3,
    selfReportedWeeklyMinutes: null,
    unavailableWeekdays: [],
    preferredLongWeekday: null,
    canRunContinuously: null,
    coachNote: null,
    weekStability: "stable",
    availableWeekdays: [1, 3, 5],
    preferredQualityWeekday: null,
    timeOfDay: "morning",
    runSurfaces: [],
    weekBreakers: null,
    maxSessionMinutes: null,
    daysPerWeekSource: "derived",
  });
  expect(
    !noContinuity.ok && noContinuity.message.includes("beginner_needs_continuity"),
    "анкета без ответа про непрерывный бег ОТКЛОНЕНА (от неё зависит первая тренировка)"
  );

  const saved = await saveOnboardingAnswers({
    sourceId,
    goalKind: "start_running",
    raceDate: null,
    raceDistanceKm: null,
    daysPerWeek: 3,
    selfReportedWeeklyMinutes: 60,
    // Понедельник и воскресенье закрыты — проверим, что перенос их не предложит.
    unavailableWeekdays: [0, 6],
    preferredLongWeekday: 5,
    canRunContinuously: false,
    coachNote: "Год назад было воспаление ахилла, сейчас не болит. Бегаю только утром.",
    weekStability: "stable",
    availableWeekdays: [1, 3, 5],
    preferredQualityWeekday: null,
    timeOfDay: "morning",
    runSurfaces: [],
    weekBreakers: null,
    maxSessionMinutes: null,
    daysPerWeekSource: "derived",
  });
  expect(saved.ok, "анкета новичка сохранена: 3 дня, Пн и Вс закрыты, «не может непрерывно»");
  const { data: answersCheck } = await supabase
    .from("intervals_onboarding_answers")
    .select("coach_note")
    .eq("source_id", sourceId)
    .maybeSingle();
  expect(
    typeof (answersCheck as { coach_note?: string } | null)?.coach_note === "string",
    "свободное «что важно знать тренеру» сохранено и доступно тренеру"
  );

  // ── 2. План ──
  step("2. ПЛАН — генерация и запись");

  const { spawnSync } = await import("node:child_process");
  const generated = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--loader",
      "./scripts/_alias-loader.mjs",
      "tools/trainingpeaks-export/scripts/intervals-onboarding-plan.ts",
      `--athlete=${ATHLETE}`,
      "--weeks=4",
      "--commit",
    ],
    // Окружение НАСЛЕДУЕТСЯ, а не читается из .env.local по месту: проверка
    // должна запускаться из любого worktree, а .env.local лежит только в
    // каноническом каталоге.
    { encoding: "utf8", cwd: process.cwd(), env: process.env }
  );
  if (generated.status !== 0) {
    bad(`генератор вернул код ${generated.status}`);
    console.log(generated.stdout?.slice(-2000) ?? "");
    console.log(generated.stderr?.slice(-2000) ?? "");
  } else {
    ok("генератор отработал (тот же buildWeek, что у ростера TP)");
  }

  const { data: cycleRow } = await supabase
    .from("intervals_plan_cycles")
    .select("id, status, length_weeks, days, start_point_source, data_level")
    .eq("source_id", sourceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  expect(cycleRow !== null, "цикл записан в intervals_plan_cycles");
  expect(
    (cycleRow as { status?: string } | null)?.status === "draft",
    "цикл лёг СО СТАТУСОМ draft — ученица его пока не видит"
  );
  expect(
    (cycleRow as { start_point_source?: string } | null)?.start_point_source === "questionnaire",
    "стартовая точка честно помечена как «из анкеты» (истории нет)"
  );

  const cycleId = String((cycleRow as { id: string }).id);
  const { data: sessionRows } = await supabase
    .from("intervals_plan_sessions")
    .select("id, session_date, day_idx, title, minutes, week_index, segments")
    .eq("cycle_id", cycleId)
    .order("session_date", { ascending: true });
  const sessions = (sessionRows ?? []) as Array<Record<string, unknown>>;
  expect(sessions.length > 0, `сессии разложены по дням: ${sessions.length} шт`);
  expect(
    sessions.every((s) => Number(s.day_idx) !== 0 && Number(s.day_idx) !== 6),
    "ни одна сессия не попала в закрытые анкетой дни (Пн, Вс)"
  );
  // СТРУКТУРА (разминка/работа/заминка) ПЕРЕЖИВАЕТ ЗАПИСЬ, А НЕ ТОЛЬКО ТЕКСТ.
  // До 20261020000000 генератор считал Session.segments и тут же терял их при
  // сплющивании в description — колонка была NULL у каждой сессии.
  expect(
    sessions.every((s) => Array.isArray(s.segments) && (s.segments as unknown[]).length > 0),
    "у каждой сессии есть сохранённая структура (segments), не только текст"
  );

  const progressionAfterPlan = await getProgression(sourceId);
  expect(
    progressionAfterPlan?.currentStep === 1 && progressionAfterPlan?.sessionsAtStep === 0,
    "состояние прогрессии заведено на ступени 1, 0 отработанных сессий"
  );

  // ── 3. Карточка ученицы ──
  step("3. КАРТОЧКА — что видит ученица");

  const firstSessionDate = String(sessions[0].session_date);

  const beforePublish = await loadStudentView(sourceId, firstSessionDate);
  expect(
    beforePublish.state === "no_plan",
    "ДО подтверждения тренером ученица видит «план готовится», а не черновик"
  );

  await publishCycle(cycleId, sourceId, "check-loop");
  const published = await getPublishedCycle(sourceId);
  expect(published?.id === cycleId, "тренер подтвердил план — цикл стал published");

  /**
   * ПУБЛИКАЦИИ ЦИКЛА МАЛО [20.09.2026, чек догнал это 23.09.2026].
   *
   * Единицей выдачи стала НЕДЕЛЯ: опубликованный цикл сам по себе ученице
   * ничего не показывает, пока тренер не отдал конкретную неделю отдельным
   * нажатием (loadStudentView отбрасывает всё, кроме released).
   *
   * Чек три дня стоял красный именно здесь: он публиковал цикл и ждал, что
   * экран наполнится, как раньше. Это была не поломка, а незамеченная смена
   * правила — и пока чек был красный, он не сторожил вообще ничего.
   *
   * Поэтому теперь сначала ПРОВЕРЯЕМ ЗАСЛОН (неделя не отдана — экран пуст),
   * и только потом отдаём неделю. Заслон важнее самого показа: он охраняет
   * недоделанную правку будущей недели от мгновенной доставки человеку.
   */
  const notReleased = await loadStudentView(sourceId, firstSessionDate);
  expect(
    notReleased.state === "no_plan" ||
      (notReleased.state === "ready" && notReleased.today === null),
    "цикл опубликован, но НЕОТДАННАЯ неделя ученице не видна"
  );

  /**
   * Недели берём ИЗ САМИХ СЕССИЙ, а не из intervals_plan_weeks: у свежего
   * цикла строк состояния может не быть вовсе, и «недель ноль» тогда значило
   * бы «отдавать нечего», а не «экран пуст».
   */
  const weekStarts = [...new Set(sessions.map((s) => mondayOf(String(s.session_date))))].sort();
  expect(weekStarts.length > 0, `недель с тренировками: ${weekStarts.length}`);
  for (const weekStart of weekStarts) {
    const released = await setPlanWeekStatus({ cycleId, weekStart, status: "released" });
    expect(released.ok, `неделя ${weekStart} отдана ученице`);
  }

  const view = await loadStudentView(sourceId, firstSessionDate);
  if (view.state !== "ready") {
    bad("после публикации экран всё ещё без плана");
    return finish(studentUuid);
  }
  expect(view.today !== null, `карточка на сегодня: ${view.today?.title ?? "—"}`);
  expect(view.upcoming.length > 0, `ближайшие дни показаны: ${view.upcoming.length} тренировок`);
  expect(
    Array.isArray(view.today?.segments) && (view.today?.segments?.length ?? 0) > 0,
    `structure дошла до карточки ученицы: ${view.today?.segments?.length ?? 0} сегментов`
  );
  expect(
    view.ladder !== null && view.ladder.step === 1,
    `ступень показана: ${view.ladder?.step} из ${view.ladder?.totalSteps} — ${view.ladder?.labelRu}`
  );
  console.log(`     «что дальше»: ${view.ladder?.progressNoteRu}`);
  console.log(`     тренировка: ${view.today?.title}, ${view.today?.minutes} мин`);
  console.log(`     описание: ${view.today?.description ?? "—"}`);

  const restDay = await loadStudentView(sourceId, shift(firstSessionDate, 1));
  if (restDay.state === "ready") {
    expect(
      restDay.today === null && restDay.restNoteRu !== null,
      "день без тренировки ОБЪЯСНЁН, а не показан пустым экраном"
    );
  }

  // ── 4. Чек-ин ──
  step("4. ЧЕК-ИН — ответ ученицы двигает ступень");

  const sessionIds = sessions.map((s) => String(s.id));
  const dates = sessions.map((s) => String(s.session_date));

  const first = await submitCheckin({
    sourceId,
    planSessionId: sessionIds[0],
    sessionDate: dates[0],
    effortCode: "very_easy",
    painCode: "no_pain",
    commentText: "Было легко, даже понравилось",
    voiceFileId: null,
  });
  if (!first.ok) {
    bad(`первый чек-ин отклонён: ${first.messageRu}`);
    return finish(studentUuid);
  }
  ok(`«Совсем легко» → ступень ${first.stepBefore} → ${first.stepAfter} · ${first.action}`);
  console.log(`     причина: ${first.reason}`);
  console.log(`     ученице: ${first.replyRu}`);
  expect(
    first.action === "repeat" && first.stepAfter === 1,
    "одной лёгкой сессии НЕ хватило для перехода — методика требует двух"
  );

  const repeat = await submitCheckin({
    sourceId,
    planSessionId: sessionIds[0],
    sessionDate: dates[0],
    effortCode: "very_easy",
    painCode: "no_pain",
    commentText: null,
    voiceFileId: null,
  });
  const afterRepeat = await getProgression(sourceId);
  expect(
    repeat.ok && afterRepeat?.sessionsAtStep === 1,
    "повторный ответ по ТОЙ ЖЕ тренировке не засчитался второй сессией (двойной тап не двигает ступень)"
  );

  const second = await submitCheckin({
    sourceId,
    planSessionId: sessionIds[1],
    sessionDate: dates[1],
    effortCode: "easy",
    painCode: "no_pain",
    commentText: null,
    voiceFileId: null,
  });
  if (second.ok) {
    ok(`вторая лёгкая сессия → ступень ${second.stepBefore} → ${second.stepAfter} · ${second.action}`);
    expect(second.action === "progress" && second.stepAfter === 2, "переход на ступень 2 состоялся");
    console.log(`     ученице: ${second.replyRu}`);
  } else {
    bad(`второй чек-ин отклонён: ${second.messageRu}`);
  }

  const painCheckin = await submitCheckin({
    sourceId,
    planSessionId: sessionIds[2],
    sessionDate: dates[2],
    effortCode: "easy",
    painCode: "pain",
    commentText: "Потягивало сзади под коленом",
    voiceFileId: null,
  });
  if (painCheckin.ok) {
    ok(`лёгкая сессия, НО с болью → ${painCheckin.action}, ступень осталась ${painCheckin.stepAfter}`);
    expect(
      painCheckin.action === "hold_for_coach",
      "боль заблокировала прогрессию, несмотря на лёгкое усилие"
    );
    console.log(`     ученице: ${painCheckin.replyRu}`);
  } else {
    bad(`чек-ин с болью отклонён: ${painCheckin.messageRu}`);
  }

  const unplannedDay = shift(dates[dates.length - 1], 2);
  const unplanned = await submitCheckin({
    sourceId,
    planSessionId: null,
    sessionDate: unplannedDay,
    effortCode: "noticeable",
    painCode: "no_pain",
    commentText: "Пробежала сама, часы не включила",
    voiceFileId: null,
  });
  expect(
    unplanned.ok,
    "чек-ин БЕЗ плановой сессии и БЕЗ тренировки в Intervals принят — и тоже посчитан сессией"
  );

  const checkins = await listCheckins(sourceId, 20);
  expect(
    checkins.every((item) => item.activityId === null),
    "у всех чек-инов activity_id пуст — приход активности не был условием"
  );

  // ── 5. Перенос ──
  step("5. ПЕРЕНОС — ученица двигает тренировку сама");

  const planSessions = await listSessionsInRange(cycleId, dates[0], shift(dates[0], 60));
  const target = planSessions.find((s) => s.sessionDate === dates[3]) ?? planSessions[3];
  if (!target) {
    bad("не нашлось тренировки для переноса");
  } else {
    const weekStart = target.weekStart;
    const mondayInWeek = mondayOf(target.sessionDate);
    expect(weekStart === mondayInWeek, "неделя сессии определена верно");

    const toBanned = decideMove({
      session: { id: target.id, sessionDate: target.sessionDate, dayIdx: target.dayIdx, weekStart },
      toDate: weekStart,
      // «Сегодня» — понедельник той же недели: иначе первым срабатывает отказ
      // «на прошедший день», и проверка запрета по анкете ничего не проверяет.
      todayIso: weekStart,
      unavailableWeekdays: [0, 6],
      siblingSessions: planSessions.map((s) => ({
        id: s.id,
        sessionDate: s.sessionDate,
        dayIdx: s.dayIdx,
        weekStart: s.weekStart,
      })),
      hasCheckin: false,
    });
    expect(
      !toBanned.ok && toBanned.code === "unavailable_weekday",
      "перенос на закрытый анкетой понедельник ОТКЛОНЁН с объяснением"
    );
    if (!toBanned.ok) console.log(`     отказ: ${toBanned.messageRu}`);

    const toNextWeek = decideMove({
      session: { id: target.id, sessionDate: target.sessionDate, dayIdx: target.dayIdx, weekStart },
      toDate: shift(weekStart, 8),
      todayIso: shift(target.sessionDate, -2),
      unavailableWeekdays: [0, 6],
      siblingSessions: [],
      hasCheckin: false,
    });
    expect(
      !toNextWeek.ok && toNextWeek.code === "outside_week",
      "перенос в соседнюю неделю ОТКЛОНЁН — неделя это доза нагрузки"
    );

    const freeDay = [1, 2, 3, 4, 5]
      .map((idx) => shift(weekStart, idx))
      .find(
        (date) =>
          date !== target.sessionDate &&
          !planSessions.some((s) => s.sessionDate === date)
      );
    if (freeDay) {
      const moved = await moveStudentSession({
        sourceId,
        sessionId: target.id,
        toDate: freeDay,
        todayIso: shift(weekStart, 0),
        movedBy: "check-loop",
      });
      expect(moved.ok, `перенос ${target.sessionDate} → ${freeDay} принят`);
      const { data: movedRow } = await supabase
        .from("intervals_plan_sessions")
        .select("session_date, original_session_date, moved_at")
        .eq("id", target.id)
        .maybeSingle();
      const row = movedRow as Record<string, unknown> | null;
      expect(
        String(row?.session_date) === freeDay && String(row?.original_session_date) === target.sessionDate,
        "исходный день запомнен — видно, что тренировка перенесена, и откуда"
      );
    } else {
      console.log("     свободного дня в неделе не нашлось — перенос не проверен");
    }
  }

  // ── 6. Текст тренера ──
  step("6. ТЕКСТ ТРЕНЕРА — ответ ученице и пара для корпуса");

  const latestCheckin = (await listCheckins(sourceId, 1))[0];
  const progression = await getProgression(sourceId);
  const context = buildCoachMessageContext({
    progression,
    session: null,
    checkin: latestCheckin ?? null,
    activity: null,
  });
  const message = await saveCoachMessage({
    sourceId,
    planSessionId: null,
    checkinId: latestCheckin?.id ?? null,
    activityId: null,
    body: "Отлично, что отметилась. Под коленом потягивает — давай следующую спокойнее и в мягких кроссовках.",
    context: context as unknown as Record<string, unknown>,
  });
  ok("текст тренера сохранён");

  const delivery = await deliverCoachMessage({
    body: message.body,
    chatId: null,
    telegramDeliveryEnabled: false,
  });
  expect(
    delivery.kind === "refused" && delivery.code === "no_chat",
    "без привязанного чата доставка ОТКАЗАНА явно, а не провалилась молча"
  );
  await markCoachMessageDelivered({
    messageId: message.id,
    status: "prepared",
    chatId: null,
    telegramMessageId: null,
  });

  const stored = (await listCoachMessages(sourceId, 5))[0];
  const storedContext = stored.context as Record<string, unknown>;
  expect(stored.status === "prepared", "статус prepared: текст готов, наружу НЕ ушёл");
  expect(
    storedContext.checkin !== null && storedContext.step !== null,
    "снимок контекста лежит рядом с текстом — пара «контекст → ответ» пригодна для корпуса"
  );
  console.log(`     в снимке: ступень ${JSON.stringify(storedContext.step)}`);
  console.log(`     в снимке чек-ин: ${JSON.stringify(storedContext.checkin).slice(0, 200)}…`);

  // ── 7. Кабинет ──
  step("7. КАБИНЕТ — то же самое, глазами ученицы");

  // ГЛАВНАЯ ПРОВЕРКА ЭТОГО НАРЯДА: минуты — факт, а не план. Кладём РЕАЛЬНУЮ
  // активность только на ОДНУ из дат чек-инов, БЕЗ привязки через
  // checkin.activityId (его сознательно не трогаем — именно это поле раньше
  // молчаливо не заполнялось, если активность приезжала после чек-ина).
  const measuredDate = dates[0];
  const { error: activityError } = await supabase.from("intervals_activities").insert({
    source_id: sourceId,
    student_id: studentUuid,
    activity_id: `check-loop-activity-${sourceId}`,
    name: "Проверочная активность",
    activity_type: "Run",
    start_date_local: `${measuredDate}T07:00:00`,
    moving_time_s: 1500, // 25 минут — заведомо не совпадает с плановыми минутами сессии
    data_level: "pace_only",
  });
  if (activityError) bad(`тестовая активность не легла: ${activityError.message}`);

  const cabinet = await loadCabinetView(sourceId, dates[dates.length - 1]);
  expect(cabinet.weeksTogether !== null && cabinet.weeksTogether >= 1, `недель вместе: ${cabinet.weeksTogether}`);
  expect(
    cabinet.cycleProgress !== null && cabinet.cycleProgress.totalWeeks > 0,
    `неделя цикла: ${cabinet.cycleProgress?.currentWeek} из ${cabinet.cycleProgress?.totalWeeks}`
  );
  expect(
    cabinet.totals !== null && cabinet.totals.sessionsCompleted === checkins.length,
    `итоги совпадают с реальными чек-инами: ${cabinet.totals?.sessionsCompleted} тренировок`
  );
  expect(
    cabinet.totals?.minutesAccumulated === 25,
    `минуты — РОВНО факт одной измеренной тренировки (25), не сумма планов всех четырёх: ${cabinet.totals?.minutesAccumulated}`
  );
  expect(
    cabinet.totals?.sessionsWithoutMeasuredMinutes === checkins.length - 1,
    `остальные ${cabinet.totals?.sessionsWithoutMeasuredMinutes} без измеренной длительности честно названы, а не выброшены`
  );
  const measuredEntry = cabinet.history?.find((h) => h.date === measuredDate);
  expect(
    measuredEntry?.minutesActual === 25,
    `в истории именно у этой тренировки факт: ${measuredEntry?.minutesActual} мин`
  );
  // Ищем именно ПЛАНОВУЮ тренировку без факта — незапланированный чек-ин тоже
  // без факта, но у него и плана нет, это не та проверка.
  const unmeasuredPlannedEntry = cabinet.history?.find(
    (h) => h.date !== measuredDate && h.minutesPlanned !== null
  );
  expect(
    unmeasuredPlannedEntry !== undefined &&
      unmeasuredPlannedEntry.minutesActual === null &&
      unmeasuredPlannedEntry.minutesPlanned !== null,
    "у тренировки без факта минут нет, но план подписан отдельно, а не выдан за факт"
  );
  expect(
    cabinet.history !== null && cabinet.history.length === checkins.length,
    "история показывает ровно те же тренировки, что и реальные чек-ины"
  );
  expect(
    cabinet.ladder !== null && cabinet.ladder.path.length >= 2,
    `путь по ступеням отражает реальный переход 1→2: ${cabinet.ladder?.path.map((p) => p.step).join("→")}`
  );

  // ── Итог ──
  step("ИТОГ");
  const finalProgression = await getProgression(sourceId);
  console.log(
    `  ступень в конце: ${finalProgression?.currentStep} (${finalProgression ? stepByIndex(finalProgression.currentStep).labelRu : "—"}), ` +
      `сессий на ступени ${finalProgression?.sessionsAtStep}`
  );
  console.log(`  чек-инов: ${(await listCheckins(sourceId, 50)).length}`);
  console.log(`  сообщений тренера: ${(await listCoachMessages(sourceId, 50)).length} (отправлено наружу: 0)`);

  await finish(studentUuid);
}

async function finish(studentUuid: string): Promise<void> {
  step("УБОРКА");
  if (KEEP) {
    console.log("  · песочница оставлена (--keep)");
  } else {
    await dropSandboxData();
    // Карточку удалить нельзя (нет права DELETE), поэтому гасим её: неактивная
    // не попадает ни в список тренера, ни в ростер TP. Говорим об этом вслух —
    // молча оставленная строка потом читается как боевая.
    const { error } = await supabase
      .from("trainingpeaks_students")
      .update({ is_active: false })
      .eq("id", studentUuid);
    console.log(
      error
        ? `  ✗ карточку песочницы погасить не удалось: ${error.message}`
        : "  ✓ данные прогона удалены; карточка песочницы погашена (is_active=false — удалить её service_role не вправе)"
    );
  }
  console.log("");
  if (failures === 0) {
    console.log("ВСЁ ПРОШЛО. Провалов: 0.");
    process.exit(0);
  }
  console.log(`ПРОВАЛОВ: ${failures}.`);
  process.exit(1);
}

main().catch(async (error) => {
  console.error(String(error));
  process.exit(1);
});
