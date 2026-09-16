/**
 * Удаление ученика: что оно удаляет и, главное, чего удалить НЕ МОЖЕТ.
 *
 * ГЛАВНАЯ ПРОВЕРКА ЗДЕСЬ — ВТОРАЯ. Первая (удаляется ли ученик Intervals)
 * ломается заметно: тренер нажмёт и увидит, что ничего не произошло. Вторая
 * (не удаляется ли карточка ростера TrainingPeaks) ломается ТИХО и ровно один
 * раз: человек с тремя годами истории исчезает вместе с ней.
 *
 * Поэтому карточка ростера подставляется под функцию НАМЕРЕННО, и проверка
 * требует отказа. Подставляется при этом не живой ученик, а собственная
 * песочная карточка, которой на время меняется площадка: ошибка в этом файле не
 * должна стоить никому истории.
 */

import { previewStudentDeletion, deleteIntervalsStudentCompletely } from "@/features/intervals/delete-student";
import { createIntervalsStudent } from "@/features/intervals/enrollment";
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

const KEY = "check-delete-student";
const NAME = "Проверка удаления";

async function main(): Promise<void> {
  console.log("УДАЛЕНИЕ УЧЕНИКА");
  const supabase = createSupabaseServerClient();

  const created = await createIntervalsStudent({
    studentKey: KEY,
    name: NAME,
    telegramUserId: 999000222,
    telegramChatId: "999000222",
    athleteId: null,
    prefill: null,
  });

  step("ЧТО БУДЕТ УДАЛЕНО");
  const preview = await previewStudentDeletion(created.studentUuid);
  expect(preview !== null, "предпросмотр собирается");
  expect(preview?.rows.some((row) => row.table === "trainingpeaks_students"), "карточка посчитана");
  expect(preview?.rows.some((row) => row.table === "student_data_sources" && row.count === 1), "источник посчитан");
  expect(preview?.looksLikeRealStudent === false, "свежая карточка не выглядит живым человеком");

  step("ИМЯ НАБИРАЕТСЯ БУКВА В БУКВУ");
  const wrongName = await deleteIntervalsStudentCompletely({
    studentUuid: created.studentUuid,
    typedName: "проверка удаления",
  });
  expect(!wrongName.ok, "имя в другом регистре не подходит");
  const stillHere = await previewStudentDeletion(created.studentUuid);
  expect(stillHere !== null, "после отказа карточка на месте");

  step("РОСТЕР TRAININGPEAKS НЕДОСТИЖИМ");
  // Меняем площадку у СВОЕЙ песочной карточки: живого ученика под удаление не
  // подставляем даже ради проверки.
  await supabase
    .from("trainingpeaks_students")
    .update({ coaching_platform: "trainingpeaks" })
    .eq("id", created.studentUuid);

  const asTp = await deleteIntervalsStudentCompletely({
    studentUuid: created.studentUuid,
    typedName: NAME,
  });
  expect(!asTp.ok, `карточка площадки trainingpeaks НЕ удаляется: ${asTp.ok ? "" : asTp.reason}`);

  // И напрямую через функцию, минуя проверки в коде: заслон должен стоять в базе.
  const { error: rpcError } = await supabase.rpc("delete_intervals_student", {
    p_student_uuid: created.studentUuid,
    p_deleted_by: "check:delete-student",
  });
  expect(rpcError !== null, "функция в базе сама отказывает, даже без проверок в коде");
  const survived = await previewStudentDeletion(created.studentUuid);
  expect(survived !== null, "карточка ростера пережила обе попытки");

  await supabase
    .from("trainingpeaks_students")
    .update({ coaching_platform: "intervals" })
    .eq("id", created.studentUuid);

  step("СЛЕД «ПОСТУЧАЛСЯ В БОТА» ЗАВОДИТСЯ ДО УДАЛЕНИЯ");
  // Воспроизводим ровно то состояние, которое ловит настоящий баг: человек уже
  // писал боту раньше (notified_at стоит, status=enrolled), и без явной чистки
  // это состояние переживает удаление карточки — noticeUnknownVisitor молчит
  // НАВСЕГДА при следующем сообщении того же telegram_user_id.
  const TELEGRAM_USER_ID = 999000222;
  await supabase.from("intervals_bot_visitors").upsert({
    telegram_user_id: TELEGRAM_USER_ID,
    chat_id: String(TELEGRAM_USER_ID),
    first_name: NAME,
    username: null,
    notified_at: new Date().toISOString(),
    status: "enrolled",
  });
  await supabase.from("intervals_enrollment_drafts").insert({
    coach_chat_id: "check-delete-student-coach",
    telegram_user_id: TELEGRAM_USER_ID,
    telegram_username: null,
    suggested_name: NAME,
    student_name: NAME,
    step: "done",
    created_student_uuid: created.studentUuid,
  });
  const preDeleteVisitor = await previewStudentDeletion(created.studentUuid);
  expect(
    preDeleteVisitor?.rows.some((row) => row.table === "intervals_bot_visitors" && row.count === 1),
    "предпросмотр видит след «постучался в бота»"
  );
  expect(
    preDeleteVisitor?.rows.some((row) => row.table === "intervals_enrollment_drafts" && row.count === 1),
    "предпросмотр видит диалог заведения"
  );

  step("УДАЛЕНИЕ РАБОТАЕТ И ПИШЕТ АРХИВ");
  const done = await deleteIntervalsStudentCompletely({
    studentUuid: created.studentUuid,
    typedName: NAME,
  });
  expect(done.ok, `ученик Intervals удаляется: ${done.ok ? "да" : done.reason}`);
  const gone = await previewStudentDeletion(created.studentUuid);
  expect(gone === null, "карточки больше нет");

  const { count: sourcesLeft } = await supabase
    .from("student_data_sources")
    .select("*", { count: "exact", head: true })
    .eq("student_id", created.studentUuid);
  expect((sourcesLeft ?? 0) === 0, "источник ушёл каскадом, а не остался сиротой");

  // ГЛАВНАЯ ПРОВЕРКА ЭТОГО НАРЯДА: обе таблицы ключуются telegram_user_id, а
  // не student_id, FK-каскад их не видит — без явного удаления в самой функции
  // они бы пережили карточку молча.
  const { count: visitorLeft } = await supabase
    .from("intervals_bot_visitors")
    .select("*", { count: "exact", head: true })
    .eq("telegram_user_id", TELEGRAM_USER_ID);
  expect((visitorLeft ?? 0) === 0, "след «постучался в бота» снят — человек снова «незнакомый»");

  const { count: draftLeft } = await supabase
    .from("intervals_enrollment_drafts")
    .select("*", { count: "exact", head: true })
    .eq("telegram_user_id", TELEGRAM_USER_ID);
  expect((draftLeft ?? 0) === 0, "диалог заведения снят, а не остался висеть с null created_student_uuid");

  // АРХИВ — ЕДИНСТВЕННОЕ, ЧТО ДЕЛАЕТ УДАЛЕНИЕ ОБРАТИМЫМ. Пишется в той же
  // транзакции: архив без удаления или удаление без архива одинаково плохи.
  const { data: archived } = await supabase
    .from("deleted_students_archive")
    .select("student_key, student_name, deleted_by, expires_at, payload")
    .eq("student_uuid", created.studentUuid)
    .maybeSingle();
  const row = archived as Record<string, unknown> | null;
  expect(row !== null, "снимок удалённого ученика сохранён");
  if (row) {
    const payload = row.payload as Record<string, unknown>;
    expect(row.student_name === NAME, "в архиве то же имя");
    expect(payload.card !== null && payload.card !== undefined, "карточка в снимке есть");
    expect(Array.isArray(payload.sources), "источники в снимке есть");
    expect(
      typeof (payload.activities_summary as Record<string, unknown>)?.count === "number",
      "про привезённые тренировки записано, сколько их было"
    );
    expect(
      (payload.bot_visitor as Record<string, unknown> | null)?.status === "enrolled",
      "снимок следа «постучался в бота» сохранён в архиве до удаления"
    );
    expect(
      Array.isArray(payload.enrollment_drafts) && (payload.enrollment_drafts as unknown[]).length === 1,
      "снимок диалога заведения сохранён в архиве до удаления"
    );
    const months = (Date.parse(String(row.expires_at)) - Date.now()) / (30 * 24 * 3600 * 1000);
    expect(months > 5 && months < 7, `срок хранения около полугода (${months.toFixed(1)} мес)`);
    // Уборка за собой: проверка не оставляет мусора и в архиве.
    await supabase.from("deleted_students_archive").delete().eq("student_uuid", created.studentUuid);
  }

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
