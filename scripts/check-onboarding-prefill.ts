/**
 * Предзаполнение анкеты тренером: что ученица видит, что уходит в базу и кто
 * на что отвечал.
 *
 * Песочница та же, что у прогона контура: карточка check-loop-student и
 * источник kind='test'. Настоящих людей не трогает, наружу ничего не шлёт.
 *
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=.env.local scripts/check-onboarding-prefill.ts
 */
import process from "node:process";

import { createSupabaseServerClient } from "@/features/supabase/server";
import {
  mergeAnswers,
  visibleFormFields,
  type Prefill,
} from "@/features/intervals/loop/prefill";
import {
  getOnboardingAnswers,
  getPrefill,
  saveOnboardingAnswers,
  savePrefill,
} from "@/features/intervals/loop/repository";

const SLUG = "check-prefill-student";
const ATHLETE = "iCHECKPREFILL";

let failures = 0;
function step(title: string): void {
  console.log("");
  console.log(`── ${title} ${"─".repeat(Math.max(0, 58 - title.length))}`);
}
function expect(condition: boolean, message: string): void {
  console.log(`  ${condition ? "✓" : "✗"} ${message}`);
  if (!condition) failures += 1;
}

const supabase = createSupabaseServerClient();

async function dropSandbox(): Promise<void> {
  const { data, error } = await supabase
    .from("student_data_sources")
    .select("id, kind")
    .eq("provider", "intervals")
    .eq("external_athlete_id", ATHLETE)
    .maybeSingle();
  if (error) throw new Error(`песочница: ${error.message}`);
  if (!data) return;
  if ((data as { kind: string }).kind !== "test") {
    throw new Error(`ОТКАЗ: источник ${ATHLETE} не тестовый — не трогаю`);
  }
  const { error: delError } = await supabase
    .from("student_data_sources")
    .delete()
    .eq("id", String((data as { id: string }).id));
  if (delError) throw new Error(`песочница, удаление: ${delError.message}`);
}

async function ensureSandbox(): Promise<string> {
  await dropSandbox();
  const { data: existing } = await supabase
    .from("trainingpeaks_students")
    .select("id")
    .eq("student_id", SLUG)
    .maybeSingle();
  let studentUuid: string;
  if (existing) {
    studentUuid = String(existing.id);
    await supabase.from("trainingpeaks_students").update({ is_active: true }).eq("id", studentUuid);
  } else {
    const { data, error } = await supabase
      .from("trainingpeaks_students")
      .insert({
        student_id: SLUG,
        student_name: "Проверка предзаполнения",
        trainingpeaks_athlete_url: `intervals://athlete/${ATHLETE}`,
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
        credential: "check-prefill-not-a-real-key",
        kind: "test",
        is_active: true,
      },
      { onConflict: "provider,external_athlete_id" }
    )
    .select("id")
    .single();
  if (sourceError) throw new Error(`источник песочницы: ${sourceError.message}`);
  return String(source.id);
}

async function main(): Promise<void> {
  console.log("ПРЕДЗАПОЛНЕНИЕ АНКЕТЫ ТРЕНЕРОМ — тестовое подключение.");
  const sourceId = await ensureSandbox();

  // ── Случай наряда: женщина после интенсива, бегает непрерывно ──
  step("ТРЕНЕР ЗАДАЁТ ОТВЕТЫ");
  const saved = await savePrefill({
    sourceId,
    setFields: ["goalKind", "canRunContinuously", "daysPerWeek"],
    values: { goalKind: "start_running", canRunContinuously: true, daysPerWeek: 3 },
    note: "Выпускница интенсива, видел её тренировки — бегает непрерывно 25+ минут.",
    setBy: "coach",
  });
  expect(saved.ok, "предзаполнение сохранено");

  const prefill = await getPrefill(sourceId);
  expect(prefill !== null && prefill.setFields.length === 3, "три поля отмечены как заданные тренером");
  expect(prefill?.values.canRunContinuously === true, "«бегает непрерывно» = да");
  expect(prefill?.note !== null, "основание решения сохранено — для корпуса оно ценнее значения");

  // ── Что увидит ученица ──
  step("ЧТО УВИДИТ УЧЕНИЦА");
  const visible = visibleFormFields(prefill);
  expect(
    !visible.includes("canRunContinuously"),
    "вопроса про непрерывный бег в форме НЕТ — не «заполнено», а отсутствует"
  );
  expect(!visible.includes("goalKind"), "вопроса про цель нет");
  expect(!visible.includes("daysPerWeek"), "вопроса про число дней нет");
  expect(
    visible.includes("unavailableWeekdays") && visible.includes("preferredLongWeekday"),
    `остальные вопросы остались: ${visible.join(", ")}`
  );

  // ── Сведение ответов ──
  step("СВЕДЕНИЕ");
  const merged = mergeAnswers(prefill, {
    // Ученица отвечает только на то, что видела.
    unavailableWeekdays: [2],
    preferredLongWeekday: 5,
    coachNote: "По утрам бегать удобнее",
    weekStability: "stable",
    availableWeekdays: [1, 3, 5],
    preferredQualityWeekday: null,
    timeOfDay: "morning",
    runSurfaces: [],
    weekBreakers: null,
    maxSessionMinutes: null,
    daysPerWeekSource: "derived",
  });
  expect(merged.values.canRunContinuously === true, "непрерывный бег взят у тренера");
  expect(merged.values.daysPerWeek === 3, "число дней взято у тренера");
  expect(
    JSON.stringify(merged.values.unavailableWeekdays) === "[2]",
    "недоступные дни взяты у ученицы"
  );
  expect(merged.coachSetFields.length === 3, "снимок происхождения собран");
  expect(merged.ignoredFromStudent.length === 0, "ученица не прислала ничего лишнего");

  const forged = mergeAnswers(prefill, {
    // Подделанный запрос (или старая версия формы): присылает поле, которого
    // в форме не было.
    canRunContinuously: false,
    daysPerWeek: 6,
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
    forged.values.canRunContinuously === true && forged.values.daysPerWeek === 3,
    "присланное по заданным полям ПРОИГНОРИРОВАНО — победил тренер"
  );
  expect(
    forged.ignoredFromStudent.length === 2,
    `попытка переопределить замечена и названа: ${forged.ignoredFromStudent.join(", ")}`
  );

  // ── Запись и происхождение ──
  step("ЗАПИСЬ И ПРОИСХОЖДЕНИЕ");
  const written = await saveOnboardingAnswers({
    sourceId,
    goalKind: merged.values.goalKind as "start_running",
    raceDate: null,
    raceDistanceKm: null,
    daysPerWeek: merged.values.daysPerWeek as number,
    selfReportedWeeklyMinutes: null,
    unavailableWeekdays: merged.values.unavailableWeekdays ?? [],
    preferredLongWeekday: merged.values.preferredLongWeekday,
    canRunContinuously: merged.values.canRunContinuously,
    coachNote: merged.coachNote,
    weekStability: "stable",
    availableWeekdays: [1, 3, 5],
    preferredQualityWeekday: null,
    timeOfDay: "morning",
    runSurfaces: [],
    weekBreakers: null,
    maxSessionMinutes: null,
    daysPerWeekSource: "derived",
    coachSetFields: merged.coachSetFields,
  });
  expect(written.ok, "анкета сохранена");

  const answers = await getOnboardingAnswers(sourceId);
  expect(answers?.canRunContinuously === true, "в анкете «может непрерывно» — со слов тренера");
  expect(
    answers?.coachSetFields.includes("canRunContinuously") === true,
    "в анкете видно, что это поле задал тренер"
  );
  expect(
    answers?.coachSetFields.includes("preferredLongWeekday") === false,
    "день длительной помечен как её ответ"
  );

  // ── Ошибка тренера ловится у тренера ──
  step("ОШИБКА ТРЕНЕРА ЛОВИТСЯ НА ЕГО ВХОДЕ");
  const badCap = await savePrefill({
    sourceId,
    setFields: ["goalKind", "daysPerWeek"],
    values: { goalKind: "start_running", daysPerWeek: 5 },
    note: null,
    setBy: "coach",
  });
  expect(
    !badCap.ok && badCap.message.includes("beginner_days_cap"),
    "пять беговых дней новичку ОТКЛОНЕНЫ у тренера — отказ не долетит до ученицы"
  );

  // ── Пустое предзаполнение = его отсутствие ──
  step("БЕЗ ПРЕДЗАПОЛНЕНИЯ — КАК БЫЛО");
  const noPrefill = visibleFormFields(null);
  expect(
    !noPrefill.includes("canRunContinuously") &&
      !noPrefill.includes("selfReportedWeeklyMinutes") &&
      !noPrefill.includes("healthLimits") &&
      !noPrefill.includes("experienceNote"),
    "даже без предзаполнения в приложении НЕТ вопросов про опыт, травмы, объём и непрерывный бег"
  );
  expect(
    noPrefill.includes("weekStability") && noPrefill.includes("runSurfaces"),
    `остались только вопросы про график: ${noPrefill.join(", ")}`
  );
  const plain = mergeAnswers(null, {
    goalKind: "regular",
    daysPerWeek: 4,
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
    plain.values.daysPerWeek === 4 && plain.coachSetFields.length === 0,
    "ответы целиком её, снимок происхождения пуст"
  );

  step("УБОРКА");
  await dropSandbox();
  const { data: card } = await supabase
    .from("trainingpeaks_students")
    .select("id")
    .eq("student_id", SLUG)
    .maybeSingle();
  if (card) {
    await supabase.from("trainingpeaks_students").update({ is_active: false }).eq("id", String(card.id));
  }
  console.log("  ✓ данные прогона удалены, карточка погашена");

  console.log("");
  if (failures === 0) {
    console.log("ВСЁ ПРОШЛО. Провалов: 0.");
    process.exit(0);
  }
  console.log(`ПРОВАЛОВ: ${failures}.`);
  process.exit(1);
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
