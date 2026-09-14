/**
 * Что увидит Валентина.
 *
 * Выпускница интенсива, бегает непрерывно. Тренер знает про неё всё, кроме
 * расписания. Прогон показывает ДВЕ вещи: какие вопросы останутся в форме и
 * какой план выйдет из её ответов.
 *
 * Песочница: карточка check-valentina и источник kind='test'. Настоящих людей
 * не трогает, наружу ничего не шлёт.
 *
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=.env.local scripts/check-valentina-form.ts
 */
import process from "node:process";

import { createSupabaseServerClient } from "@/features/supabase/server";
import {
  fieldLabelRu,
  mergeAnswers,
  NEVER_IN_APP_FORM,
  PREFILLABLE_FIELDS,
  visibleFormFields,
} from "@/features/intervals/loop/prefill";
import { getPrefill, savePrefill } from "@/features/intervals/loop/repository";
import {
  dayNameRu,
  deriveDaysPerWeek,
  sessionCapByCode,
  sessionCapPreferences,
} from "@/features/intervals/loop/schedule";
import { dayOffsetFromCoach, isValidTimeZone, todayIsoInZone } from "@/features/intervals/loop/clock";

const SLUG = "check-valentina";
const ATHLETE = "iCHECKVALENTINA";

let failures = 0;
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
    throw new Error(`ОТКАЗ: источник ${ATHLETE} не тестовый`);
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
        student_name: "Валентина (проверка формы)",
        trainingpeaks_athlete_url: `intervals://athlete/${ATHLETE}`,
        coaching_platform: "intervals",
        is_active: true,
        weekly_report_enabled: false,
        telegram_delivery_enabled: false,
      })
      .select("id")
      .single();
    if (error) throw new Error(`карточка: ${error.message}`);
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
        credential: "check-valentina-not-a-real-key",
        kind: "test",
        is_active: true,
      },
      { onConflict: "provider,external_athlete_id" }
    )
    .select("id")
    .single();
  if (sourceError) throw new Error(`источник: ${sourceError.message}`);
  return String(source.id);
}

async function main(): Promise<void> {
  console.log("ВАЛЕНТИНА: выпускница интенсива, бегает непрерывно.");
  const sourceId = await ensureSandbox();

  // ── Что задаёт тренер ──
  console.log("");
  console.log("── ТРЕНЕР ЗАКРЫВАЕТ ТО, ЧТО ЗНАЕТ ──────────────────────────");
  const saved = await savePrefill({
    sourceId,
    setFields: [
      "goalKind",
      "canRunContinuously",
      "daysPerWeek",
      "healthLimits",
      "experienceNote",
      "selfReportedWeeklyMinutes",
    ],
    values: {
      goalKind: "start_running",
      canRunContinuously: true,
      daysPerWeek: 3,
      healthLimits: "Жалоб нет. На интенсиве берегли колено, сейчас чисто.",
      experienceNote: "Интенсив, поток 28. Непрерывно 25 минут спокойно, объём около 60 минут в неделю.",
      selfReportedWeeklyMinutes: 60,
    },
    note: "Видел её тренировки на интенсиве восемь недель. Про график не знаю ничего.",
    setBy: "coach",
  });
  expect(saved.ok, "предзаполнение сохранено");

  const prefill = await getPrefill(sourceId);
  for (const field of prefill?.setFields ?? []) {
    console.log(`     ${fieldLabelRu(field)}: задано тренером`);
  }

  // ── Что увидит она ──
  console.log("");
  console.log("── ЧТО УВИДИТ ВАЛЕНТИНА В ФОРМЕ ────────────────────────────");
  const visible = visibleFormFields(prefill);
  for (const field of visible) console.log(`     • ${fieldLabelRu(field)}`);

  const schedule = new Set([
    "weekStability",
    "availableWeekdays",
    "unavailableWeekdays",
    "preferredLongWeekday",
    "preferredQualityWeekday",
    "timeOfDay",
    "runSurfaces",
    "weekBreakers",
    "maxSessionMinutes",
    "goalKind",
    "raceDate",
    "raceDistanceKm",
  ]);
  expect(
    visible.every((field) => schedule.has(field)),
    "в форме остались ТОЛЬКО вопросы про график"
  );
  expect(!visible.includes("canRunContinuously"), "про непрерывный бег её не спрашивают");
  expect(!visible.includes("goalKind"), "про цель не спрашивают: её задал тренер");
  expect(
    !visible.some((field) => NEVER_IN_APP_FORM.includes(field)),
    "опыта, травм, объёма и числа дней в форме нет вовсе"
  );

  const hidden = PREFILLABLE_FIELDS.filter((f) => !visible.includes(f));
  console.log("");
  console.log(`     скрыто полей: ${hidden.length} из ${PREFILLABLE_FIELDS.length}`);

  // ── Она отвечает ──
  console.log("");
  console.log("── ОНА ОТВЕЧАЕТ ────────────────────────────────────────────");
  const merged = mergeAnswers(prefill, {
    weekStability: "stable",
    availableWeekdays: [1, 3, 5],
    unavailableWeekdays: [0, 6],
    preferredLongWeekday: 5,
    preferredQualityWeekday: 2,
    timeOfDay: "morning",
    runSurfaces: ["Набережная", "Стадион"],
    weekBreakers: "Раз в месяц командировка на три дня, обычно в середине недели.",
  });
  console.log(`     неделя: ${merged.values.weekStability}`);
  console.log(`     свободна: ${(merged.values.availableWeekdays ?? []).map(dayNameRu).join(", ")}`);
  console.log(`     занята: ${(merged.values.unavailableWeekdays ?? []).map(dayNameRu).join(", ")}`);
  console.log(`     длинная: ${dayNameRu(merged.values.preferredLongWeekday ?? -1)}`);
  console.log(`     тяжёлая: ${dayNameRu(merged.values.preferredQualityWeekday ?? -1)}`);
  console.log(`     время: ${merged.values.timeOfDay}`);
  console.log(`     где: ${(merged.values.runSurfaces ?? []).join(", ")}`);
  console.log(`     срывает неделю: ${merged.values.weekBreakers}`);

  expect(merged.values.canRunContinuously === true, "непрерывный бег пришёл от тренера, а не от неё");
  expect(merged.values.goalKind === "start_running", "цель пришла от тренера");

  const days = deriveDaysPerWeek({
    coachSetDays: merged.values.daysPerWeek,
    weekStability: "stable",
    availableWeekdays: merged.values.availableWeekdays ?? [],
    isBeginner: true,
  });
  expect(days.ok, "число беговых дней определено");
  if (days.ok) {
    console.log("");
    console.log(`     дней в неделю: ${days.daysPerWeek} (${days.reasonRu})`);
    expect(days.source === "coach", "число дней взято у тренера, а не выведено");
  }

  // ── Проверка ветки «плавающая неделя» ──
  console.log("");
  console.log("── ЕСЛИ БЫ НЕДЕЛЯ БЫЛА ПЛАВАЮЩЕЙ ───────────────────────────");
  const floating = deriveDaysPerWeek({
    coachSetDays: null,
    weekStability: "varies",
    availableWeekdays: [],
    isBeginner: true,
  });
  expect(
    floating.ok && floating.daysPerWeek === 3,
    floating.ok ? `${floating.daysPerWeek} тренировки: ${floating.reasonRu}` : "не определилось"
  );
  const oneDay = deriveDaysPerWeek({
    coachSetDays: null,
    weekStability: "stable",
    availableWeekdays: [3],
    isBeginner: true,
  });
  expect(!oneDay.ok, "один свободный день ОТКЛОНЁН с объяснением, а не достроен до двух");
  if (!oneDay.ok) console.log(`     отказ: ${oneDay.messageRu}`);

  // ── Потолок длительности ──
  console.log("");
  console.log("── ПОТОЛОК ДЛИТЕЛЬНОСТИ ТРЕНИРОВКИ ─────────────────────────");
  expect(sessionCapByCode("u45") === 45, "«30–45 минут» это потолок 45 минут, числом");
  expect(sessionCapByCode("free") === null, "«больше 90 минут» это отсутствие потолка, а не число");
  expect(sessionCapByCode("нет такого") === undefined, "неизвестный вариант отличим от «потолка нет»");

  const caps = sessionCapPreferences(45);
  expect(caps.length === 7, "потолок раскладывается в пожелания на все семь дней");
  expect(
    caps.every((c) => c.kind === "day_max_minutes" && c.maxMinutes === 45),
    "используется штатный day_max_minutes, а не свой механизм резки"
  );
  expect(sessionCapPreferences(null).length === 0, "без потолка пожеланий не добавляется");

  // ── Часовой пояс ──
  console.log("");
  console.log("── ЧАСОВОЙ ПОЯС ────────────────────────────────────────────");
  expect(isValidTimeZone("Europe/Moscow"), "настоящая зона принимается");
  expect(!isValidTimeZone("Москва"), "выдуманная зона отклоняется");
  expect(!isValidTimeZone("UTC+3"), "смещение вместо зоны отклоняется: оно не переживёт перевод часов");

  // Момент, когда в Москве уже завтра, а в Белграде ещё сегодня.
  // Окно узкое: Белград летом UTC+2, Москва UTC+3, значит расходятся они
  // ровно между 21:00 и 22:00 UTC. В 22:30 полночь уже прошла в обоих, и
  // проверка проверяла бы совпадение вместо расхождения.
  const lateNight = new Date("2026-09-14T21:30:00Z");
  const belgrade = todayIsoInZone("Europe/Belgrade", lateNight);
  const moscow = todayIsoInZone("Europe/Moscow", lateNight);
  console.log(`     21:30 UTC → Белград ${belgrade}, Москва ${moscow}`);
  expect(belgrade !== moscow, "день ученика и день тренера в этот момент РАЗНЫЕ");
  expect(
    dayOffsetFromCoach("Europe/Moscow", lateNight) === 1,
    "смещение названо: у неё уже завтра"
  );
  expect(
    todayIsoInZone(null, lateNight) === belgrade,
    "без зоны падаем на зону тренера, а не на UTC"
  );

  console.log("");
  console.log("── УБОРКА ──────────────────────────────────────────────────");
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
