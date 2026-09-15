/**
 * Заведение ученика: что получается в базе и что после этого видит ученица.
 *
 * ПРОВЕРЯЕМ ТРИ ВЕЩИ, каждая из которых ломается молча:
 *
 *   1. ПРЕДЗАПОЛНЕНИЕ РАБОТАЕТ ОДИНАКОВО из бота и из скрипта. Требование
 *      тренера дословно; цена расхождения — ученица видит в анкете вопрос, на
 *      который за неё уже ответили, и отвечает иначе.
 *
 *   2. ИСТОЧНИК-ЗАГОТОВКА НЕ АКТИВЕН. Иначе раннер каждые полчаса бьётся об
 *      Intervals с ключом-пустышкой, а гард приложения считает подключение
 *      состоявшимся и не показывает экран «подключим часы».
 *
 *   3. OAUTH ЗАБИРАЕТ ЗАГОТОВКУ, А НЕ ЗАВОДИТ ВТОРУЮ СТРОКУ. Если заведёт —
 *      предзаполнение останется на брошенной строке, и ответы тренера
 *      пропадут ровно в тот момент, когда ученица подключилась.
 *
 * Прогон заводит свою карточку и убирает её за собой.
 */

import { createIntervalsStudent, buildStudentKey, PENDING_ATHLETE_PREFIX } from "@/features/intervals/enrollment";
import { getPrefill } from "@/features/intervals/loop/repository";
import { visibleFormFields } from "@/features/intervals/loop/prefill";
import { connectOauthSource } from "@/features/intervals/repository";
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

const TELEGRAM_ID = 999000111;
const ATHLETE_ID = "i-check-enroll";

/**
 * Уборка УДАЛЯЕТ, а не гасит.
 *
 * Раньше здесь стоял is_active=false, потому что права на удаление карточек не
 * было. От каждого прогона оставалась погашенная карточка, и за неделю их
 * накопилась горсть. Теперь есть функция delete_intervals_student, и проверка
 * обязана убирать за собой полностью: тест, оставляющий мусор в боевой базе,
 * ничем не лучше мусора.
 */
async function cleanup(studentKey: string): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { data: card } = await supabase
    .from("trainingpeaks_students")
    .select("id")
    .eq("student_id", studentKey)
    .maybeSingle();
  if (!card) return;
  const cardId = String((card as { id: string }).id);
  const { error } = await supabase.rpc("delete_intervals_student", {
    p_student_uuid: cardId,
    p_deleted_by: "check:enrollment",
  });
  if (error) {
    // Не роняем проверку из-за уборки, но и не молчим.
    console.log(`  ⚠ уборка не удалась (${studentKey}): ${error.message}`);
  }
}

async function main(): Promise<void> {
  console.log("ЗАВЕДЕНИЕ УЧЕНИКА");
  const supabase = createSupabaseServerClient();
  const studentKey = buildStudentKey("Валентина Проверка", TELEGRAM_ID);
  await cleanup(studentKey);

  step("КЛЮЧ КАРТОЧКИ");
  expect(/^[a-z0-9-]+$/u.test(studentKey), `ключ латиницей: ${studentKey}`);
  expect(studentKey.endsWith("0111"), "в хвосте ключа telegram id: тёзки не столкнутся");

  step("ЗАВЕДЕНИЕ ИЗ БОТА: БЕЗ ПРЕДЗАПОЛНЕНИЯ");
  // Бот заводит в одно нажатие и НИ О ЧЁМ не спрашивает: всё, что важно,
  // человек ответит сам за полминуты. Проверяем именно это: после заведения из
  // бота анкета должна быть полной, включая вопрос про непрерывный бег.
  const fromBot = await createIntervalsStudent({
    studentKey: `${studentKey}-bot`,
    name: "Из бота",
    telegramUserId: TELEGRAM_ID + 1,
    telegramChatId: String(TELEGRAM_ID + 1),
    athleteId: null,
    prefill: null,
  });
  const botPrefill = await getPrefill(fromBot.sourceId);
  expect(botPrefill === null, "предзаполнения из бота нет вовсе");
  const botVisible = visibleFormFields(botPrefill);
  expect(
    botVisible.includes("canRunContinuously"),
    "вопрос про непрерывный бег вернулся в анкету: за человека на него не отвечают"
  );
  expect(botVisible.includes("goalKind"), "цель спрашиваем у неё же");
  await cleanup(`${studentKey}-bot`);

  step("ЗАВЕДЕНИЕ ИЗ СКРИПТА: ПРЕДЗАПОЛНЕНИЕ ЖИВО");
  const created = await createIntervalsStudent({
    studentKey,
    name: "Валентина Проверка",
    telegramUserId: TELEGRAM_ID,
    telegramChatId: String(TELEGRAM_ID),
    athleteId: null,
    prefill: {
      setFields: ["goalKind", "daysPerWeek", "canRunContinuously", "healthLimits"],
      values: {
        goalKind: "improve",
        daysPerWeek: 4,
        canRunContinuously: true,
        healthLimits: "берегла ахилл весной",
      },
      note: "заведено через бота",
      setBy: "coach:bot:test",
    },
  });
  // НЕ «создана», а «есть и активна»: DELETE на карточках у service_role нет,
  // уборка их гасит, и повторный прогон обязан поднимать ту же карточку, а не
  // заводить вторую. Проверяем именно это.
  expect(created.studentUuid.length > 0, "карточка есть");
  expect(
    created.athleteId.startsWith(PENDING_ATHLETE_PREFIX),
    `источник-заготовка: ${created.athleteId}`
  );

  const { data: cardRow } = await supabase
    .from("trainingpeaks_students")
    .select("coaching_platform, telegram_user_id, telegram_delivery_enabled, weekly_report_enabled, is_active")
    .eq("id", created.studentUuid)
    .maybeSingle();
  const card = cardRow as Record<string, unknown> | null;
  expect(card?.coaching_platform === "intervals", "площадка intervals: в ростер TP не попадёт");
  expect(Number(card?.telegram_user_id) === TELEGRAM_ID, "telegram id записан");
  expect(card?.telegram_delivery_enabled === false, "доставка ВЫКЛЮЧЕНА: канал наружу открывает тренер");
  expect(card?.weekly_report_enabled === false, "недельные отчёты TP выключены: кэша TP у неё нет");
  expect(card?.is_active === true, "карточка активна (повторный прогон поднимает ту же)");

  const { data: sourceRow } = await supabase
    .from("student_data_sources")
    .select("is_active, kind, auth_method")
    .eq("id", created.sourceId)
    .maybeSingle();
  const source = sourceRow as Record<string, unknown> | null;
  expect(source?.is_active === false, "заготовка НЕ активна: раннер её не трогает");
  expect(source?.kind === "student", "вид источника боевой");

  step("ЧТО УВИДИТ ОНА В АНКЕТЕ");
  const prefill = await getPrefill(created.sourceId);
  expect(prefill !== null, "предзаполнение сохранено");
  expect(prefill?.values.goalKind === "improve", "цель задана тренером");
  const visible = visibleFormFields(prefill);
  for (const hidden of ["goalKind", "daysPerWeek", "canRunContinuously", "healthLimits"] as const) {
    expect(!visible.includes(hidden), `${hidden}: вопроса в анкете НЕ БУДЕТ`);
  }
  // Механизм предзаполнения остался ровно тем же: убрали его ИЗ БОТА, а не из
  // системы. Тренер, который действительно знает человека, задаёт поля скриптом.
  expect(visible.length > 0, `остальные вопросы на месте: ${visible.length}`);

  step("ОНА ПОДКЛЮЧИЛА ЧАСЫ");
  const connected = await connectOauthSource({
    studentUuid: created.studentUuid,
    externalAthleteId: ATHLETE_ID,
    accessToken: "token-for-check",
    scope: "ACTIVITY,CALENDAR,WELLNESS",
  });
  expect(connected.ok, `подключение прошло: ${connected.ok ? connected.sourceId : connected.reason}`);
  if (connected.ok) {
    expect(
      connected.sourceId === created.sourceId,
      "источник ТОТ ЖЕ: заготовка забрана, а не брошена"
    );
    const afterPrefill = await getPrefill(connected.sourceId);
    expect(
      afterPrefill?.values.goalKind === "improve",
      "предзаполнение пережило подключение"
    );
    const { data: all } = await supabase
      .from("student_data_sources")
      .select("id")
      .eq("student_id", created.studentUuid);
    expect((all ?? []).length === 1, `у ученицы ровно один источник (${(all ?? []).length})`);
    const { data: nowRow } = await supabase
      .from("student_data_sources")
      .select("is_active, auth_method, external_athlete_id")
      .eq("id", connected.sourceId)
      .maybeSingle();
    const now = nowRow as Record<string, unknown> | null;
    expect(now?.is_active === true, "после подключения источник активен");
    expect(now?.auth_method === "oauth", "способ доступа стал oauth");
    expect(now?.external_athlete_id === ATHLETE_ID, "адрес заменён на настоящий");
  }

  step("УБОРКА");
  await cleanup(studentKey);
  const { data: leftovers } = await supabase
    .from("student_data_sources")
    .select("id")
    .eq("external_athlete_id", ATHLETE_ID);
  expect((leftovers ?? []).length === 0, "данные прогона удалены");

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
