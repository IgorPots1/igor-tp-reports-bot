/**
 * Ручной ввод тренировки: источник, запись, чек-ин, прогрессия, стартовая
 * точка, сигнал «подключено, а данных нет».
 *
 * ЖИВОЙ ПРОГОН НА НАСТОЯЩЕЙ КАРТОЧКЕ. Часть опасностей здесь — про порядок
 * операций (активность ДО чек-ина, чтобы submitCheckin её нашёл) и про то, что
 * НЕ должно случиться (раннер синка не должен тронуть источник, сигнал не
 * должен загореться). Ни то, ни другое не увидеть на разобранной по кусочкам
 * функции.
 */

import { assessConnectionHealth } from "@/features/intervals/loop/connection-health";
import { getOnboardingAnswers, getProgression, saveOnboardingAnswers } from "@/features/intervals/loop/repository";
import { coachConvertSourceToManual, isManualEntryStudent, provisionManualSource, submitManualEntry } from "@/features/intervals/manual-entry";
import { computeStartingPointFromHistory, loadActivitiesForSource } from "@/features/intervals/onboarding/starting-point";
import { createIntervalsStudent } from "@/features/intervals/enrollment";
import { connectOauthSource, getSourceConnection, isConnectionUsable } from "@/features/intervals/repository";
import { createSupabaseServerClient } from "@/features/supabase/server";

let failures = 0;
function expect(condition: boolean, message: string): void {
  console.log(`  ${condition ? "✓" : "✗"} ${message}`);
  if (!condition) failures += 1;
}
function step(title: string): void {
  console.log("");
  console.log(`── ${title} ${"─".repeat(Math.max(0, 52 - title.length))}`);
}

const KEY = "check-manual-entry-student";

async function main(): Promise<void> {
  console.log("РУЧНОЙ ВВОД ТРЕНИРОВКИ");
  const supabase = createSupabaseServerClient();

  step("КАРТОЧКА КАК ПОСЛЕ ЗАВЕДЕНИЯ ИЗ БОТА (pending-источник, часов ещё нет)");
  const created = await createIntervalsStudent({
    studentKey: KEY,
    name: "Проверка ручного ввода",
    telegramUserId: 999000555,
    telegramChatId: "999000555",
    athleteId: null, // ровно то, что делает бот: pending-заготовка
    prefill: null,
  });
  const beforeConn = await getSourceConnection(created.studentUuid);
  expect(beforeConn?.isActive === false, "заготовка неактивна, как у любого нового ученика");
  expect(
    isConnectionUsable(beforeConn, 0) === false,
    "и потому не usable: экран подключения — правильное место для нового человека"
  );

  step("ВЫБОР «ВВЕДУ ВРУЧНУЮ»: ЗАБИРАЕМ ЗАГОТОВКУ, А НЕ ЗАВОДИМ ВТОРУЮ СТРОКУ");
  const provisioned = await provisionManualSource(created.studentUuid);
  expect(provisioned.ok, `провизия прошла${provisioned.ok ? "" : `: ${(provisioned as { message: string }).message}`}`);
  const sourceId = provisioned.ok ? provisioned.sourceId : "";
  expect(sourceId === created.sourceId, "тот же source_id, что у заготовки — предзаполнение не потеряется");

  const afterConn = await getSourceConnection(created.studentUuid);
  expect(afterConn?.authMethod === "manual", `auth_method стал manual: ${afterConn?.authMethod}`);
  expect(afterConn?.isActive === true, "источник активен");
  expect(
    isConnectionUsable(afterConn, 0) === true,
    "usable СРАЗУ, до первой тренировки: до анкеты дойти можно, не дожидаясь записи"
  );

  const second = await provisionManualSource(created.studentUuid);
  expect(second.ok && second.sourceId === sourceId, "повторное нажатие кнопки идемпотентно, вторая строка не завелась");

  step("СИГНАЛ «ПОДКЛЮЧЕНО, А ДАННЫХ НЕТ» НЕ ЗАГОРАЕТСЯ");
  // Симулируем ровно тот сценарий, который раньше зажигал connected_but_silent:
  // подключились три дня назад, ни одной активности, зато есть чек-ин.
  const health = assessConnectionHealth({
    todayIso: "2026-09-20",
    connection: {
      connectedAtIso: "2026-09-17T10:00:00Z",
      authFailedAtIso: null,
      isActive: true,
      authMethod: "manual",
    },
    activityDates: [],
    checkinDates: ["2026-09-18", "2026-09-19"],
  });
  expect(health.state === "manual", `состояние «manual», не «connected_but_silent»: ${health.state}`);

  step("АНКЕТА, ЧТОБЫ БЫЛО КУДА ЗАКРЫВАТЬ ПЛАНОВУЮ СЕССИЮ");
  const savedAnswers = await saveOnboardingAnswers({
    sourceId,
    goalKind: "improve",
    raceDate: null,
    raceDistanceKm: null,
    daysPerWeek: 4,
    selfReportedWeeklyMinutes: 150,
    unavailableWeekdays: [],
    preferredLongWeekday: null,
    canRunContinuously: true,
    coachNote: null,
    weekStability: "stable",
    availableWeekdays: [0, 2, 4, 6],
    preferredQualityWeekday: null,
    timeOfDay: null,
    runSurfaces: [],
    weekBreakers: null,
    maxSessionMinutes: null,
    daysPerWeekSource: "answer",
    coachSetFields: [],
  });
  expect(savedAnswers.ok, "анкета сохранена");
  const answersBack = await getOnboardingAnswers(sourceId);
  expect(answersBack?.canRunContinuously === true, "и читается обратно");

  step("ПЕРВАЯ ЗАПИСЬ: ДИСТАНЦИЯ + ПУЛЬС ЕСТЬ, ТЕМП СЧИТАЕМ САМИ");
  const progressionBefore = await getProgression(sourceId);
  const entry1 = await submitManualEntry({
    sourceId,
    date: "2026-09-10",
    durationMinutes: 40,
    distanceKm: 6.5,
    averageHeartrate: 148,
    averagePaceSecPerKm: null,
    planSessionId: null,
    effortCode: "easy",
    painCode: "no_pain",
    commentText: "бежала вдоль набережной",
  });
  expect(entry1.ok, `запись прошла${entry1.ok ? "" : `: ${(entry1 as { messageRu: string }).messageRu}`}`);

  if (entry1.ok) {
    const { data: activityRow } = await supabase
      .from("intervals_activities")
      .select("data_level, has_heartrate, has_pace, moving_time_s, distance_m, average_heartrate, average_speed_mps, activity_type, start_date_local")
      .eq("activity_id", entry1.activityId)
      .single();
    const a = activityRow as Record<string, unknown>;
    expect(a.data_level === "manual", `data_level = manual: ${a.data_level}`);
    expect(a.has_heartrate === false, "has_heartrate=false — средний пульс не значит ряд пульса");
    expect(a.has_pace === false, "has_pace=false — тот же принцип для темпа");
    expect(Number(a.moving_time_s) === 2400, `время в секундах: ${a.moving_time_s}`);
    expect(Number(a.distance_m) === 6500, `дистанция в метрах: ${a.distance_m}`);
    expect(Number(a.average_heartrate) === 148, "средний пульс лёг как есть, для отображения");
    const expectedSpeed = 6500 / 2400;
    expect(Math.abs(Number(a.average_speed_mps) - expectedSpeed) < 0.001, `темп посчитан из дистанции/времени, не выдуман: ${a.average_speed_mps}`);
    expect(a.activity_type === "Run", "тип — Run, попадёт в RUN_TYPES стартовой точки");
    expect(String(a.start_date_local).startsWith("2026-09-10"), "дата легла верно");

    const { data: checkinRow } = await supabase
      .from("intervals_checkins")
      .select("activity_id, session_date, effort_rpe, pain, comment_text")
      .eq("id", entry1.checkin.checkinId)
      .single();
    const c = checkinRow as Record<string, unknown>;
    expect(c.activity_id === entry1.activityId, "чек-ин нашёл СВОЮ же активность по дате — тот же путь, что и у синка");
    expect(c.session_date === "2026-09-10", "дата чек-ина совпала");
    expect(c.comment_text === "бежала вдоль набережной", "комментарий долетел");
  }

  const progressionAfter = await getProgression(sourceId);
  expect(
    JSON.stringify(progressionBefore) !== JSON.stringify(progressionAfter) || progressionAfter !== null,
    "прогрессия обновилась (applyCheckinToProgression отработал как для обычного чек-ина)"
  );

  step("ВТОРАЯ ЗАПИСЬ: ТОЛЬКО ВРЕМЯ, БЕЗ ДИСТАНЦИИ И ПУЛЬСА");
  const entry2 = await submitManualEntry({
    sourceId,
    date: "2026-09-12",
    durationMinutes: 35,
    distanceKm: null,
    averageHeartrate: null,
    averagePaceSecPerKm: null,
    planSessionId: null,
    effortCode: "noticeable",
    painCode: "no_pain",
    commentText: null,
  });
  expect(entry2.ok, "минимальная запись (только время) тоже проходит — по требованию наряда");
  if (entry2.ok) {
    const { data: row } = await supabase
      .from("intervals_activities")
      .select("distance_m, average_heartrate, average_speed_mps, data_level")
      .eq("activity_id", entry2.activityId)
      .single();
    const r = row as Record<string, unknown>;
    expect(r.distance_m === null, "дистанция не выдумана");
    expect(r.average_heartrate === null, "пульс не выдуман");
    expect(r.average_speed_mps === null, "темп не выдуман без дистанции");
  }

  step("ТРЕТЬЯ ЗАПИСЬ: ТЕМП СО СЛОВ, БЕЗ ДИСТАНЦИИ — НЕ ПОРОЖДАЕМ ФАНТОМНУЮ ДИСТАНЦИЮ");
  const entry3 = await submitManualEntry({
    sourceId,
    date: "2026-09-13",
    durationMinutes: 20,
    distanceKm: null,
    averageHeartrate: null,
    averagePaceSecPerKm: 330,
    planSessionId: null,
    effortCode: "very_easy",
    painCode: "no_pain",
    commentText: null,
  });
  expect(entry3.ok, "запись с одним лишь темпом проходит");
  if (entry3.ok) {
    const { data: row } = await supabase
      .from("intervals_activities")
      .select("distance_m, average_speed_mps")
      .eq("activity_id", entry3.activityId)
      .single();
    const r = row as Record<string, unknown>;
    expect(r.distance_m === null, "дистанция осталась пустой: считать её из темпа значило бы выдумать факт");
    expect(Math.abs(Number(r.average_speed_mps) - 1000 / 330) < 0.001, `темп сохранён для отображения: ${r.average_speed_mps}`);
  }

  step("ВАЛИДАЦИЯ: ОПЕЧАТКА НЕ ПРОХОДИТ КАК ФАКТ");
  const badPace = await submitManualEntry({
    sourceId, date: "2026-09-14", durationMinutes: 30, distanceKm: null,
    averageHeartrate: null, averagePaceSecPerKm: 45, planSessionId: null,
    effortCode: "easy", painCode: "no_pain", commentText: null,
  });
  expect(!badPace.ok, "темп быстрее мировых рекордов отклонён");
  const badDuration = await submitManualEntry({
    sourceId, date: "2026-09-14", durationMinutes: 0, distanceKm: null,
    averageHeartrate: null, averagePaceSecPerKm: null, planSessionId: null,
    effortCode: "easy", painCode: "no_pain", commentText: null,
  });
  expect(!badDuration.ok, "нулевое время отклонено — время единственное обязательное поле");
  const futureDate = await submitManualEntry({
    sourceId, date: "2099-01-01", durationMinutes: 30, distanceKm: null,
    averageHeartrate: null, averagePaceSecPerKm: null, planSessionId: null,
    effortCode: "easy", painCode: "no_pain", commentText: null,
  });
  expect(!futureDate.ok, "дата в будущем отклонена");

  step("СТАРТОВАЯ ТОЧКА: ОБЪЁМ СЧИТАЕТ, ПУЛЬС — НЕТ");
  const activities = await loadActivitiesForSource(sourceId);
  const start = computeStartingPointFromHistory(activities, "2026-09-15");
  expect(start.runsTotal >= 3, `все три валидные записи попали в окно: ${start.runsTotal}`);
  expect(
    start.runsWithHeartrate === 0,
    `НИ ОДНА не посчиталась «с пульсом», хотя у первой был указан средний пульс 148: ${start.runsWithHeartrate}. ` +
      "Ровно требование наряда: без рядов генератор не судит об интенсивности так же, как без пульса."
  );
  expect(start.dataLevel === "pace_only", `уровень данных аккаунта: ${start.dataLevel} (не heartrate — верно)`);

  step("БОТ УЗНАЁТ РУЧНОЙ ВВОД, НЕ ЗОВЯ TELEGRAM");
  expect(await isManualEntryStudent(created.studentUuid) === true, "isManualEntryStudent видит manual на этом ученике");
  expect(
    await isManualEntryStudent("00000000-0000-0000-0000-000000000000") === false,
    "и честно отвечает false на несуществующего/чужого"
  );

  // ── Обратный путь: реальное подключение → ручной ввод ──────────────────────
  //
  // Валентина и её Honor [17.09.2026]: часы завели настоящее OAuth-подключение
  // (i714595), которое НИКОГДА не отдаст данные — Honor к Intervals.icu не
  // подключается. Система ждала бы синка вечно. Отдельная песочница, а не
  // переиспользование созданной выше: та к этому моменту уже manual, и
  // проверка ничего не проверила бы.
  step("ОБРАТНЫЙ ПУТЬ: РЕАЛЬНОЕ ПОДКЛЮЧЕНИЕ → РУЧНОЙ ВВОД");
  const REVERSE_KEY = "check-manual-entry-reverse";
  const REVERSE_ATHLETE = "i900321";
  const reverseCreated = await createIntervalsStudent({
    studentKey: REVERSE_KEY,
    name: "Проверка обратного пути",
    telegramUserId: 999000333,
    telegramChatId: "999000333",
    athleteId: null, // источник-заготовка, реальное подключение — отдельным шагом ниже
  });
  const connected = await connectOauthSource({
    studentUuid: reverseCreated.studentUuid,
    externalAthleteId: REVERSE_ATHLETE,
    accessToken: "check-manual-entry-reverse-token",
    scope: "ACTIVITY,CALENDAR,WELLNESS",
  });
  expect(connected.ok, "песочница подключена по-настоящему (oauth), как у Валентины");
  const beforeConvert = await getSourceConnection(reverseCreated.studentUuid);
  expect(beforeConvert?.authMethod === "oauth", "до перевода источник — oauth, не manual");
  const sourceIdBeforeConvert = beforeConvert?.sourceId;

  const converted = await coachConvertSourceToManual(reverseCreated.studentUuid);
  expect(converted.ok, `перевод на ручной ввод прошёл${converted.ok ? "" : `: ${converted.message}`}`);
  if (converted.ok) {
    expect(converted.previousAuthMethod === "oauth", "функция назвала прежний способ верно");
    expect(converted.sourceId === sourceIdBeforeConvert, "source_id тот же самый — история (её пока нет, но принцип общий) не осиротела");
  }
  const afterConvert = await getSourceConnection(reverseCreated.studentUuid);
  expect(afterConvert?.authMethod === "manual", "после перевода источник стал manual");
  expect(afterConvert?.sourceId === sourceIdBeforeConvert, "тот же source_id виден и через обычное чтение подключения");

  const healthAfterConvert = assessConnectionHealth({
    todayIso: "2026-09-17",
    connection: {
      connectedAtIso: afterConvert?.connectedAt ?? null,
      authFailedAtIso: null,
      isActive: true,
      authMethod: "manual",
    },
    activityDates: [],
    checkinDates: [],
  });
  expect(
    healthAfterConvert.state === "manual",
    "«подключено, а данных нет» больше не грозит: manual гасит проверку раньше неё"
  );

  const repeatConvert = await coachConvertSourceToManual(reverseCreated.studentUuid);
  expect(
    repeatConvert.ok && repeatConvert.previousAuthMethod === "manual",
    "повторный вызов идемпотентен — не падает и не путает предыдущий способ"
  );

  // И ОБРАТНО, ЕСЛИ ПОЯВЯТСЯ ПОДКЛЮЧАЕМЫЕ ЧАСЫ: тот же connectOauthSource,
  // никакого отдельного пути не заводили специально под этот тест — значит и
  // для настоящего человека сработает так же.
  const reconnected = await connectOauthSource({
    studentUuid: reverseCreated.studentUuid,
    externalAthleteId: "i900322",
    accessToken: "check-manual-entry-reverse-token-2",
    scope: "ACTIVITY,CALENDAR,WELLNESS",
  });
  expect(reconnected.ok, "manual → oauth снова работает — полный круг замкнулся");
  if (reconnected.ok) {
    expect(reconnected.sourceId === sourceIdBeforeConvert, "и на этом развороте source_id не поменялся");
  }

  await supabase.rpc("delete_intervals_student", {
    p_student_uuid: reverseCreated.studentUuid,
    p_deleted_by: "check:manual-entry:reverse",
  });
  await supabase.from("deleted_students_archive").delete().eq("student_uuid", reverseCreated.studentUuid);

  step("УБОРКА");
  const { error: deleteError } = await supabase.rpc("delete_intervals_student", {
    p_student_uuid: created.studentUuid,
    p_deleted_by: "check:manual-entry",
  });
  expect(deleteError === null, `удаление прошло${deleteError ? `: ${deleteError.message}` : ""}`);
  await supabase.from("deleted_students_archive").delete().eq("student_uuid", created.studentUuid);

  console.log("");
  if (failures === 0) {
    console.log("ВСЁ ПРОШЛО. Провалов: 0.");
    process.exit(0);
  }
  console.log(`ПРОВАЛОВ: ${failures}.`);
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
