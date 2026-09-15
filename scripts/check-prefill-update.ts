/**
 * Дописывание предзаполнения: сливается со старым, подключение не трогает.
 *
 * ЖИВОЙ ПРОГОН, А НЕ МОК: обе опасности этой команды — «стёрли поле, про
 * которое сегодня не сказали» и «стёрли OAuth-токен» — это ошибки СЛИЯНИЯ и
 * ЗАПИСИ, их не увидеть на разобранной по кусочкам функции. Прогоняем сам
 * скрипт дважды подряд, как это сделает Игорь: сначала одно поле, потом
 * другое, и смотрим на реальную строку в базе после каждого шага.
 */

import { spawnSync } from "node:child_process";
import process from "node:process";

import { createIntervalsStudent } from "@/features/intervals/enrollment";
import { getPrefill } from "@/features/intervals/loop/repository";
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

const KEY = "check-prefill-update-student";
const ATHLETE = "check-prefill-update-athlete";
const FAKE_OAUTH_TOKEN = "real-looking-oauth-token-do-not-touch-me";

function runPrefillCli(args: string[]): { stdout: string; status: number | null } {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--loader",
      "./scripts/_alias-loader.mjs",
      "scripts/intervals-prefill-update.ts",
      `--athlete=${ATHLETE}`,
      ...args,
      "--commit",
    ],
    { encoding: "utf8", cwd: process.cwd() }
  );
  return { stdout: `${result.stdout ?? ""}${result.stderr ?? ""}`, status: result.status };
}

async function main(): Promise<void> {
  console.log("ДОПИСЫВАНИЕ ПРЕДЗАПОЛНЕНИЯ");
  const supabase = createSupabaseServerClient();

  step("ГОТОВИМ ЖИВУЮ КАРТОЧКУ, КАК ПОСЛЕ БОТА + OAuth");
  // kind="test": раннер её не опрашивает, боевую площадку не трогаем.
  const created = await createIntervalsStudent({
    studentKey: KEY,
    name: "Проверка допредзаполнения",
    telegramUserId: 999000444,
    telegramChatId: "999000444",
    athleteId: ATHLETE,
    credential: FAKE_OAUTH_TOKEN,
    kind: "test",
    prefill: null,
  });
  await supabase
    .from("student_data_sources")
    .update({ auth_method: "oauth", is_active: true, connected_at: "2026-09-01T10:00:00Z" })
    .eq("id", created.sourceId);
  const { data: before } = await supabase
    .from("student_data_sources")
    .select("credential, auth_method, is_active, connected_at")
    .eq("id", created.sourceId)
    .single();
  console.log(`  источник ${created.sourceId.slice(0, 8)} создан, credential = «${(before as { credential: string }).credential}»`);

  step("ШАГ 1: ЗАДАЁМ ОБЪЁМ СО СЛОВ");
  const step1 = runPrefillCli(["--pre-weekly-minutes=120"]);
  expect(step1.status === 0, `команда прошла (код ${step1.status})`);
  expect(step1.stdout.includes("Записано"), "сказано «Записано»");

  const afterStep1 = await getPrefill(created.sourceId);
  expect(
    afterStep1?.values.selfReportedWeeklyMinutes === 120,
    `объём записан: ${afterStep1?.values.selfReportedWeeklyMinutes}`
  );

  step("ШАГ 2: ЗАДАЁМ ЦЕЛЬ, ОБЪЁМ НЕ ПОВТОРЯЕМ");
  const step2 = runPrefillCli(["--pre-goal=improve"]);
  expect(step2.status === 0, `команда прошла (код ${step2.status})`);

  const afterStep2 = await getPrefill(created.sourceId);
  expect(
    afterStep2?.values.selfReportedWeeklyMinutes === 120,
    `объём СО ШАГА 1 УЦЕЛЕЛ: ${afterStep2?.values.selfReportedWeeklyMinutes} (главная опасность: наивная запись стёрла бы его в null)`
  );
  expect(afterStep2?.values.goalKind === "improve", `и цель добавилась: ${afterStep2?.values.goalKind}`);
  expect(
    (afterStep2?.setFields.length ?? 0) === 2,
    `в списке заданных полей оба, не один: ${afterStep2?.setFields.join(", ")}`
  );

  step("ПОДКЛЮЧЕНИЕ НЕ ТРОНУТО НИ РАЗУ");
  const { data: after } = await supabase
    .from("student_data_sources")
    .select("credential, auth_method, is_active, connected_at")
    .eq("id", created.sourceId)
    .single();
  const b = before as { credential: string; auth_method: string; is_active: boolean; connected_at: string };
  const a = after as typeof b;
  expect(a.credential === b.credential, `credential не изменился: «${a.credential}»`);
  expect(a.auth_method === b.auth_method, `auth_method не изменился: ${a.auth_method}`);
  expect(a.is_active === b.is_active, `is_active не изменился: ${a.is_active}`);
  expect(a.connected_at === b.connected_at, `connected_at не изменился: ${a.connected_at}`);

  step("--show НИЧЕГО НЕ ПИШЕТ");
  const before3 = await getPrefill(created.sourceId);
  const showRun = runPrefillCli([]).stdout; // без --pre-*, но с --show ниже
  void showRun;
  const shown = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--loader", "./scripts/_alias-loader.mjs", "scripts/intervals-prefill-update.ts", `--athlete=${ATHLETE}`, "--show"],
    { encoding: "utf8", cwd: process.cwd() }
  );
  const after3 = await getPrefill(created.sourceId);
  expect(shown.status === 0, "--show прошёл без ошибки");
  expect(
    JSON.stringify(before3?.values) === JSON.stringify(after3?.values),
    "--show не изменил ни одного значения"
  );

  step("НЕИЗВЕСТНЫЙ ИСТОЧНИК — ЧЕСТНЫЙ ОТКАЗ, А НЕ ТИХОЕ СОЗДАНИЕ");
  const missing = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--loader",
      "./scripts/_alias-loader.mjs",
      "scripts/intervals-prefill-update.ts",
      "--athlete=совсем-не-заведённый-99999",
      "--pre-weekly-minutes=90",
      "--commit",
    ],
    { encoding: "utf8", cwd: process.cwd() }
  );
  expect(missing.status !== 0, "команда отказала, а не создала источник тайком");
  expect(
    (missing.stderr ?? "").includes("не найден"),
    "причина названа словами"
  );

  step("УБОРКА");
  await supabase.rpc("delete_intervals_student", {
    p_student_uuid: created.studentUuid,
    p_deleted_by: "check:prefill-update",
  });
  await supabase.from("deleted_students_archive").delete().eq("student_uuid", created.studentUuid);
  const { data: gone } = await supabase
    .from("trainingpeaks_students")
    .select("id")
    .eq("student_id", KEY)
    .maybeSingle();
  expect(gone === null, "данные прогона удалены");

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
