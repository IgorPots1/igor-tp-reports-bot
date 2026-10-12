/**
 * Провенанс анкетных полей: кто, когда, с какого значения на какое и ОТКУДА.
 *
 * ЧТО СТЕРЕЖЁТ. 12.10.2026 не удалось ответить на простой вопрос о собственных
 * данных: «потолок одной тренировки 80 — кто его поставил?» Пометка
 * coach_set_fields говорила «задал тренер», а кто, когда и из чего — нигде.
 * Ответ вывели косвенно, через потолок аэробного в цикле от 17.09, и он дал
 * вероятность, а не факт.
 *
 * ГЛАВНОЕ УТВЕРЖДЕНИЕ ЗДЕСЬ ЖИВОЕ: коачская правка БЕЗ источника отбивается
 * БАЗОЙ, а не договорённостью. Правило, живущее только в коде, обходится первым
 * же скриптом, который пишет напрямую, — а именно так я и правил её анкету.
 *
 * Песочница своя: карточка check-history-student, источник kind='test'.
 * Настоящих людей не трогает, наружу ничего не шлёт.
 *
 *   npm run check:onboarding-history
 */
import process from "node:process";

import {
  asText,
  onboardingFieldChanges,
  originLabelRu,
  originRequired,
} from "@/features/intervals/loop/onboarding-history";
import {
  saveOnboardingAnswers,
  type OnboardingAnswersInput,
} from "@/features/intervals/loop/repository";
import { createSupabaseServerClient } from "@/features/supabase/server";

const SLUG = "check-history-student";
const ATHLETE = "iCHECKHISTORY";

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

/* ── ПЕСОЧНИЦА ─────────────────────────────────────────────────────────────── */

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
    studentUuid = String((existing as { id: string }).id);
  } else {
    const { data, error } = await supabase
      .from("trainingpeaks_students")
      .insert({
        student_id: SLUG,
        student_name: "Проверка истории анкеты",
        trainingpeaks_athlete_url: `intervals://athlete/${ATHLETE}`,
        coaching_platform: "intervals",
        is_active: true,
        weekly_report_enabled: false,
        telegram_delivery_enabled: false,
      })
      .select("id")
      .single();
    if (error) throw new Error(`карточка песочницы: ${error.message}`);
    studentUuid = String((data as { id: string }).id);
  }
  const { data: source, error: sourceError } = await supabase
    .from("student_data_sources")
    .upsert(
      {
        student_id: studentUuid,
        provider: "intervals",
        external_athlete_id: ATHLETE,
        auth_method: "api_key",
        credential: "check-history-not-a-real-key",
        kind: "test",
        is_active: true,
      },
      { onConflict: "provider,external_athlete_id" }
    )
    .select("id")
    .single();
  if (sourceError) throw new Error(`источник песочницы: ${sourceError.message}`);
  return String((source as { id: string }).id);
}

type HistoryRow = {
  field: string;
  value_before: string | null;
  value_after: string | null;
  changed_by: string;
  origin: string | null;
  note: string | null;
};

async function history(sourceId: string): Promise<HistoryRow[]> {
  const { data, error } = await supabase
    .from("intervals_onboarding_field_history")
    .select("field, value_before, value_after, changed_by, origin, note")
    .eq("source_id", sourceId)
    .order("changed_at", { ascending: true });
  if (error) throw new Error(`история: ${error.message}`);
  return (data ?? []) as unknown as HistoryRow[];
}

/** Анкета целиком: писателю нужны все поля, меняем в проверках по одному. */
function answers(sourceId: string, over: Partial<OnboardingAnswersInput>): OnboardingAnswersInput {
  return {
    sourceId,
    changedBy: "script:check-onboarding-history",
    goalKind: "start_running",
    raceDate: null,
    raceDistanceKm: null,
    daysPerWeek: 3,
    selfReportedWeeklyMinutes: 120,
    unavailableWeekdays: [],
    preferredLongWeekday: 0,
    canRunContinuously: true,
    runStyle: "continuous",
    coachNote: null,
    weekStability: "stable",
    availableWeekdays: [2, 4, 0],
    preferredQualityWeekday: 2,
    timeOfDay: "morning",
    runSurfaces: ["Улица / парк", "Дорожка"],
    weekBreakers: null,
    maxSessionMinutes: 60,
    daysPerWeekSource: "answer",
    coachSetFields: [],
    ...over,
  };
}

/* ── ПРОГОН ────────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  console.log("ПРОВЕНАНС АНКЕТНЫХ ПОЛЕЙ — тестовое подключение.");

  /* ── СРАВНЕНИЕ СНИМКОВ: ЧИСТАЯ ЧАСТЬ ───────────────────────────────────── */
  step("ЧТО СЧИТАЕТСЯ ПРАВКОЙ");

  expect(
    JSON.stringify(
      onboardingFieldChanges({ max_session_minutes: 60 }, { max_session_minutes: 80 })
    ) === JSON.stringify([{ field: "max_session_minutes", valueBefore: "60", valueAfter: "80" }]),
    "правка потолка видна как 60 → 80 — ровно то, чего 12.10 не хватило"
  );
  expect(
    onboardingFieldChanges({ days_per_week: 3 }, { days_per_week: 3 }).length === 0,
    "не изменилось — в историю не пишем"
  );

  // ПОРЯДОК ГАЛОЧЕК НИЧЕГО НЕ ЗНАЧИТ. Без сортировки массивов история набилась
  // бы правками, которых никто не делал: форма отдаёт поверхности как придётся.
  expect(
    onboardingFieldChanges(
      { run_surfaces: ["Улица / парк", "Дорожка"] },
      { run_surfaces: ["Дорожка", "Улица / парк"] }
    ).length === 0,
    "переставленные поверхности это НЕ правка"
  );
  expect(
    onboardingFieldChanges(
      { run_surfaces: ["Дорожка"] },
      { run_surfaces: ["Дорожка", "Улица / парк"] }
    ).length === 1,
    "а добавленная поверхность — правка"
  );

  // ПРОПУЩЕННЫЙ КЛЮЧ — ЭТО «НЕ ТРОГАЛИ», А НЕ «СТЁРЛИ»: обратная трактовка
  // записала бы в историю потерю, которой не было.
  expect(
    onboardingFieldChanges({ max_session_minutes: 80 }, { max_session_minutes: undefined })
      .length === 0,
    "undefined это не обнуление"
  );
  expect(
    onboardingFieldChanges({ max_session_minutes: 80 }, { max_session_minutes: null }).length === 1,
    "а явный null — обнуление, и оно в истории"
  );
  expect(
    onboardingFieldChanges(null, { days_per_week: 3, max_session_minutes: 80 }).length === 2,
    "первое заполнение анкеты пишется целиком"
  );
  expect(asText(["б", "а"]) === "а, б", "массив приводится к тексту отсортированным");
  expect(asText(0) === "0" && asText(false) === "false", "ноль и false это значения, а не пусто");
  expect(asText(null) === null && asText(undefined) === null, "пусто остаётся пустым");

  step("КОМУ НУЖЕН ИСТОЧНИК");
  expect(originRequired("coach:admin"), "коачской правке источник нужен");
  expect(!originRequired("student"), "ученица и есть источник");
  expect(!originRequired("script:check-manual-entry"), "скрипт не коач");
  expect(
    originLabelRu("coach_words") === "со слов ученицы" &&
      originLabelRu(null) === "источник не указан",
    "подпись источника человеческая"
  );

  const sourceId = await ensureSandbox();

  /* ── ГЛАВНОЕ: ПРАВИЛО ДЕРЖИТ БАЗА ──────────────────────────────────────── */
  step("КОАЧСКАЯ ПРАВКА БЕЗ ИСТОЧНИКА ОТБИВАЕТСЯ БАЗОЙ");

  const noOrigin = await supabase.from("intervals_onboarding_field_history").insert({
    source_id: sourceId,
    field: "max_session_minutes",
    value_before: "60",
    value_after: "80",
    changed_by: "coach:admin",
    origin: null,
  });
  expect(
    noOrigin.error !== null,
    "прямая вставка коачской правки без origin ОТКЛОНЕНА — констрейнтом, а не договорённостью"
  );

  const badOrigin = await supabase.from("intervals_onboarding_field_history").insert({
    source_id: sourceId,
    field: "max_session_minutes",
    value_after: "80",
    changed_by: "coach:admin",
    origin: "из головы",
  });
  expect(badOrigin.error !== null, "выдуманный источник тоже отклонён: список закрытый");

  const studentNoOrigin = await supabase
    .from("intervals_onboarding_field_history")
    .insert({
      source_id: sourceId,
      field: "days_per_week",
      value_before: "2",
      value_after: "3",
      changed_by: "student",
      origin: null,
    })
    .select("id")
    .single();
  expect(
    studentNoOrigin.error === null,
    `правка ученицей без источника проходит: ${studentNoOrigin.error?.message ?? "да"}`
  );

  /* ── ИСТОРИЯ ПИШЕТСЯ НАСТОЯЩИМ ПИСАТЕЛЕМ ───────────────────────────────── */
  step("ПЕРВОЕ ЗАПОЛНЕНИЕ");

  const before = (await history(sourceId)).length;
  const first = await saveOnboardingAnswers(
    answers(sourceId, { changedBy: "student", origin: "student_answer" })
  );
  expect(first.ok, "анкета сохранена");
  const afterFirst = await history(sourceId);
  const firstRows = afterFirst.slice(before);
  expect(firstRows.length > 0, `первое заполнение записано в историю: ${firstRows.length} полей`);
  const cap0 = firstRows.find((r) => r.field === "max_session_minutes");
  expect(
    cap0?.value_before === null && cap0?.value_after === "60",
    `потолок записан как «не было» → 60: ${cap0?.value_before} → ${cap0?.value_after}`
  );
  expect(
    firstRows.every((r) => r.changed_by === "student" && r.origin === "student_answer"),
    "автор и источник у всех строк — ученица"
  );

  step("КОАЧСКАЯ ПРАВКА ПОТОЛКА 60 → 80");

  const n1 = (await history(sourceId)).length;
  const edited = await saveOnboardingAnswers(
    answers(sourceId, {
      changedBy: "coach:check",
      origin: "coach_data",
      originNote: "пересчитал по отданным неделям",
      maxSessionMinutes: 80,
    })
  );
  expect(edited.ok, "правка сохранена");
  const rows = (await history(sourceId)).slice(n1);
  expect(
    rows.length === 1,
    `записано ровно одно изменение, а не вся анкета заново: ${rows.length}`
  );
  const cap = rows[0];
  expect(cap?.field === "max_session_minutes", `поле: ${cap?.field}`);
  expect(
    cap?.value_before === "60" && cap?.value_after === "80",
    `с какого на какое: ${cap?.value_before} → ${cap?.value_after}`
  );
  expect(cap?.changed_by === "coach:check", `кто: ${cap?.changed_by}`);
  expect(
    cap?.origin === "coach_data" && cap?.note === "пересчитал по отданным неделям",
    `откуда: ${originLabelRu((cap?.origin ?? null) as never)} — ${cap?.note}`
  );

  step("ПОВТОРНАЯ ЗАПИСЬ ТОГО ЖЕ");

  const n2 = (await history(sourceId)).length;
  await saveOnboardingAnswers(
    answers(sourceId, {
      changedBy: "coach:check",
      origin: "coach_data",
      maxSessionMinutes: 80,
    })
  );
  const n3 = (await history(sourceId)).length;
  expect(
    n3 === n2,
    `пересохранение без изменений истории не добавляет: было ${n2}, стало ${n3}`
  );

  /* ── ИСТОРИЮ НЕ СТИРАЮТ ────────────────────────────────────────────────── */
  step("ИСТОРИЯ ТОЛЬКО ДОПИСЫВАЕТСЯ");

  // Смысл провенанса в том, что его нельзя подчистить задним числом, поэтому
  // DELETE на таблицу не выдан вообще. Уборка песочницы идёт КАСКАДОМ от
  // источника — его выполняет сама база, а не вызывающий.
  const tryDelete = await supabase
    .from("intervals_onboarding_field_history")
    .delete()
    .eq("source_id", sourceId)
    .select("id");
  expect(
    tryDelete.error !== null || (tryDelete.data ?? []).length === 0,
    `удалить строки истории нельзя: ${tryDelete.error?.message ?? "ни одна строка не удалена"}`
  );
  expect((await history(sourceId)).length === n3, "после попытки удаления история на месте");

  step("УБОРКА ПЕСОЧНИЦЫ");

  await dropSandbox();
  expect(
    (await history(sourceId)).length === 0,
    "каскад от источника забрал историю с собой — проверочных строк не остаётся"
  );

  console.log("");
  if (failures > 0) {
    console.log(`ПРОВАЛЕНО проверок: ${failures}`);
    process.exit(1);
  }
  console.log("Все проверки пройдены.");
}

await main();
