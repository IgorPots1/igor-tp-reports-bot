/**
 * Генерация плана не должна переписывать анкету параметрами --commit.
 *
 * ЖИВОЙ ПРОГОН НАСТОЯЩИМ ГЕНЕРАТОРОМ, А НЕ ЮНИТ-ТЕСТ. Баг жил в
 * intervals-onboarding-plan.ts: --goal/--days/--weekly-minutes/... при
 * --commit писались ПРЯМО в intervals_onboarding_answers, поверх того, что
 * человек реально ответил в форме. Пойман живьём на Валентине: тренер собрал
 * ей план с --goal=improve --weekly-minutes=90, и её анкета молча стала
 * «improve, 90» вместо настоящих «regular, 70» — бейдж «ответила сама»
 * продолжал показывать это как её слова. Юнит-тест на функции ничего не
 * докажет: упавший код был инлайном в main(), а не отдельной функцией.
 * Единственная честная проверка — прогнать НАСТОЯЩИЙ CLI с флагами,
 * отличными от анкеты, и прочитать анкету обратно.
 *
 *   npm run check:onboarding-answers-not-overwritten
 */

import { spawnSync } from "node:child_process";
import process from "node:process";

import { createIntervalsStudent } from "@/features/intervals/enrollment";
import { getOnboardingAnswers, saveOnboardingAnswers } from "@/features/intervals/loop/repository";
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

const KEY = "check-onboarding-answers-not-overwritten";
const ATHLETE_ID = "i900700"; // произвольный, не пересекается с живыми аккаунтами

async function main(): Promise<void> {
  console.log("АНКЕТА НЕ ПЕРЕЗАПИСЫВАЕТСЯ ГЕНЕРАЦИЕЙ");
  const supabase = createSupabaseServerClient();

  step("АНКЕТА КАК ПОСЛЕ РЕАЛЬНОЙ ФОРМЫ /m/run");
  const created = await createIntervalsStudent({
    studentKey: KEY,
    name: "Проверка: анкета не перезаписывается",
    telegramUserId: 999000700,
    telegramChatId: "999000700",
    athleteId: ATHLETE_ID,
    prefill: null,
  });
  const sourceId = created.sourceId;

  // ЭТО — ТО, ЧТО ЧЕЛОВЕК РЕАЛЬНО ОТВЕТИЛ. Ниже сгенерируем план ДРУГИМИ
  // флагами (improve/4 дня/200 мин) — ровно так тренер и напоролся на баг
  // на Валентине, задав план не тем, что она ответила.
  const saved = await saveOnboardingAnswers({
    sourceId,
    goalKind: "regular",
    raceDate: null,
    raceDistanceKm: null,
    daysPerWeek: 3,
    selfReportedWeeklyMinutes: 70,
    unavailableWeekdays: [],
    preferredLongWeekday: null,
    canRunContinuously: true,
    runStyle: "continuous",
    coachNote: null,
    weekStability: "varies",
    availableWeekdays: [],
    preferredQualityWeekday: null,
    timeOfDay: "evening",
    runSurfaces: ["Улица / парк", "Дорожка"],
    weekBreakers: null,
    maxSessionMinutes: 60,
    daysPerWeekSource: "answer",
    coachSetFields: [],
  });
  expect(saved.ok, `анкета сохранена${saved.ok ? "" : `: ${(saved as { message: string }).message}`}`);

  step("ГЕНЕРАЦИЯ ПЛАНА ДРУГИМИ ПАРАМЕТРАМИ (--commit)");
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--loader",
      "./scripts/_alias-loader.mjs",
      "tools/trainingpeaks-export/scripts/intervals-onboarding-plan.ts",
      `--athlete=${ATHLETE_ID}`,
      "--goal=improve",
      "--days=4",
      "--weekly-minutes=200",
      "--can-run-continuously=true",
      "--easy-pace=5:30",
      "--defer-diagnostic",
      "--commit",
    ],
    { encoding: "utf8", cwd: process.cwd() }
  );
  expect(result.status === 0, `генератор завершился без ошибки (код ${result.status})`);
  const generatorOutput = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  expect(generatorOutput.includes("Записано: цикл"), "цикл реально записался (генерация не отказала)");

  step("АНКЕТА ПОСЛЕ ГЕНЕРАЦИИ — ДОЛЖНА ОСТАТЬСЯ ЕЁ, А НЕ ФЛАГАМИ");
  const answersAfter = await getOnboardingAnswers(sourceId);
  expect(answersAfter?.goalKind === "regular", `goal_kind остался её: ${answersAfter?.goalKind} (флаг генерации был improve)`);
  expect(answersAfter?.daysPerWeek === 3, `days_per_week остался её: ${answersAfter?.daysPerWeek} (флаг генерации был 4)`);
  expect(
    answersAfter?.selfReportedWeeklyMinutes === 70,
    `self_reported_weekly_minutes остался её: ${answersAfter?.selfReportedWeeklyMinutes} (флаг генерации был 200)`
  );
  expect(answersAfter?.canRunContinuously === true, "can_run_continuously не тронут (совпадает с флагом — но не потому, что флаг его переписал)");
  expect(answersAfter?.runStyle === "continuous", "run_style — новое поле, генератор его не знает вовсе, тоже должен остаться её");
  expect(answersAfter?.timeOfDay === "evening", "поля, которых во флагах нет вообще (время суток), не пострадали заодно");

  step("ЦИКЛ ПРИ ЭТОМ ПОСТРОЕН ИМЕННО ПО ФЛАГАМ ГЕНЕРАЦИИ, НЕ ПО АНКЕТЕ");
  const { data: cycleRow } = await supabase
    .from("intervals_plan_cycles")
    .select("days, base_aerobic_min")
    .eq("source_id", sourceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  expect((cycleRow as { days?: number } | null)?.days === 4, `цикл собран на 4 дня, как просил флаг: ${(cycleRow as { days?: number } | null)?.days}`);

  step("УБОРКА");
  const { error: deleteError } = await supabase.rpc("delete_intervals_student", {
    p_student_uuid: created.studentUuid,
    p_deleted_by: "check:onboarding-answers-not-overwritten",
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
