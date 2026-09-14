/**
 * Завести ученика, которого ведут в Intervals, а не в TrainingPeaks.
 *
 * Делает ровно три вещи: карточку человека, источник данных и (по флагу)
 * привязку Telegram. Ничего не генерирует и никому не пишет.
 *
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=.env.local scripts/intervals-student-setup.ts \
 *     --student-id=anna-ivanova --name="Анна Иванова" --athlete=i123456 \
 *     --key-env=INTERVALS_ANNA_API_KEY [--telegram-user-id=123] [--telegram-chat-id=123] [--commit]
 *
 * КЛЮЧ НЕ ПРИНИМАЕТСЯ АРГУМЕНТОМ. Только имя переменной окружения: аргументы
 * командной строки видны в истории shell и в списке процессов, и секрет туда
 * попадать не должен.
 *
 * МАРКЕР ВМЕСТО ССЫЛКИ НА TP. Колонка trainingpeaks_athlete_url обязательна —
 * два десятка читателей разбирают её как строку и падают на null. Ученик не из
 * TP получает intervals://athlete/<id>: это строка, она не подходит под
 * /athletes/<цифры>, и человеком читается как «это не TrainingPeaks».
 */
import process from "node:process";

import { createSupabaseServerClient } from "@/features/supabase/server";

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : null;
}

const COMMIT = process.argv.includes("--commit");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

export function intervalsMarkerUrl(externalAthleteId: string): string {
  return `intervals://athlete/${externalAthleteId}`;
}

async function main(): Promise<void> {
  const studentId = arg("student-id");
  const name = arg("name");
  const athleteId = arg("athlete");
  const keyEnv = arg("key-env");
  if (!studentId || !name || !athleteId) {
    fail("Нужны --student-id=<slug> --name=\"Имя Фамилия\" --athlete=<i123456>");
  }
  if (!keyEnv) fail("Нужен --key-env=ИМЯ_ПЕРЕМЕННОЙ с ключом Intervals ученика");
  const credential = process.env[keyEnv];
  if (!credential) fail(`Переменная ${keyEnv} пуста — положите в неё личный ключ ученика`);

  const telegramUserId = arg("telegram-user-id");
  const telegramChatId = arg("telegram-chat-id");

  const supabase = createSupabaseServerClient();

  const { data: existingStudent } = await supabase
    .from("trainingpeaks_students")
    .select("id, student_name, coaching_platform")
    .eq("student_id", studentId)
    .maybeSingle();

  const { data: existingSource } = await supabase
    .from("student_data_sources")
    .select("id, student_id")
    .eq("provider", "intervals")
    .eq("external_athlete_id", athleteId)
    .maybeSingle();

  console.log("── Что уже есть ─────────────────────────────");
  console.log(`карточка ${studentId}:  ${existingStudent ? `есть (${existingStudent.coaching_platform})` : "нет"}`);
  console.log(`источник ${athleteId}:  ${existingSource ? "есть" : "нет"}`);
  console.log("");

  if (!COMMIT) {
    console.log("Будет сделано:");
    if (!existingStudent) {
      console.log(`  · карточка «${name}» (${studentId}), площадка intervals, ссылка ${intervalsMarkerUrl(athleteId)}`);
    } else if (existingStudent.coaching_platform !== "intervals") {
      console.log(`  · у карточки «${existingStudent.student_name}» площадка сменится на intervals`);
    }
    if (!existingSource) console.log(`  · источник Intervals ${athleteId} с ключом из ${keyEnv}`);
    if (telegramUserId) console.log(`  · привязка Telegram user ${telegramUserId}`);
    console.log("");
    console.log("Ничего не записано (запуск без --commit).");
    return;
  }

  let studentUuid = existingStudent?.id as string | undefined;
  if (!studentUuid) {
    const { data, error } = await supabase
      .from("trainingpeaks_students")
      .insert({
        student_id: studentId,
        student_name: name,
        trainingpeaks_athlete_url: intervalsMarkerUrl(athleteId),
        coaching_platform: "intervals",
        is_active: true,
        // Недельные отчёты TP этому ученику не положены: они собираются из
        // кэша TrainingPeaks, которого у неё нет.
        weekly_report_enabled: false,
        telegram_user_id: telegramUserId ? Number(telegramUserId) : null,
        telegram_chat_id: telegramChatId ?? null,
        // Доставка выключена по умолчанию — включается сознательно, когда
        // тренер готов писать.
        telegram_delivery_enabled: false,
      })
      .select("id")
      .single();
    if (error) fail(`Не удалось завести карточку: ${error.message}`);
    studentUuid = String(data.id);
    console.log(`Карточка заведена: ${studentUuid}`);
  } else {
    const patch: Record<string, unknown> = { coaching_platform: "intervals" };
    if (telegramUserId) patch.telegram_user_id = Number(telegramUserId);
    if (telegramChatId) patch.telegram_chat_id = telegramChatId;
    const { error } = await supabase.from("trainingpeaks_students").update(patch).eq("id", studentUuid);
    if (error) fail(`Не удалось обновить карточку: ${error.message}`);
    console.log(`Карточка обновлена: ${studentUuid}`);
  }

  const { error: sourceError } = await supabase.from("student_data_sources").upsert(
    {
      student_id: studentUuid,
      provider: "intervals",
      external_athlete_id: athleteId,
      auth_method: "api_key",
      credential,
      kind: "student",
      is_active: true,
    },
    // Апсерт по athlete_id, а не по (student_id, provider): для строк с NULL
    // владельцем второй индекс не работает, и это единственный надёжный ключ.
    { onConflict: "provider,external_athlete_id" }
  );
  if (sourceError) fail(`Не удалось завести источник: ${sourceError.message}`);
  console.log(`Источник Intervals ${athleteId} готов (ключ из ${keyEnv}, в вывод не попадает).`);

  console.log("");
  console.log("Дальше: анкету заполняет ученица в мини-приложении, план собирает");
  console.log("intervals-onboarding-plan.ts --commit, показывает ученице — админка.");
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
