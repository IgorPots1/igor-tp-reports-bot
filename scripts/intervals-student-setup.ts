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
 * --kind=student|self|test   вид источника. student (по умолчанию) — боевой,
 *   его опрашивает раннер каждые 30 минут. test — техническое подключение,
 *   раннер его НЕ трогает: заглушка-ключ не будет каждые полчаса биться об
 *   Intervals.
 *
 * ПРЕДЗАДАННЫЕ ОТВЕТЫ АНКЕТЫ (--pre-*). Что задано тренером, ученик в форме НЕ
 * ВИДИТ вообще. Смысл: выпускника интенсива тренер видел в деле и знает ответ
 * лучше него самого; спрашивать о том, что знаешь, — плохой онбординг.
 *
 * --pre-goal=race|regular|start_running
 * --pre-days=3                 дней в неделю
 * --pre-skip-days=0,6          недоступные дни (0=Пн … 6=Вс); пусто = «запретов нет»
 * --pre-long-day=5             день длительной; none = «всё равно»
 * --pre-can-run-continuously=true|false
 * --pre-race-date=YYYY-MM-DD   --pre-race-km=21.1   --pre-weekly-minutes=120
 * --pre-week-stability=stable|varies
 * --pre-free-days=1,3,5        дни, когда точно свободен
 * --pre-quality-day=3          день тяжёлой тренировки; none = «всё равно»
 * --pre-time-of-day=morning|evening|varies
 * --pre-surfaces="Стадион,Улица / парк"
 * --pre-week-breakers="сменный график 2/2"
 * --pre-health-limits="берёг ахилл, без быстрых спусков"   ЧУВСТВИТЕЛЬНОЕ
 * --pre-experience="интенсив 2026-08, непрерывно 30 мин, 5 км за 31:00"
 * --pre-note="почему так решил"  основание; для корпуса оно ценнее значения
 *
 * В ПРИЛОЖЕНИИ НЕ СПРАШИВАЮТСЯ НИКОГДА, даже если тренер их не задал:
 * объём со слов, «может ли бежать непрерывно», ограничения по здоровью,
 * беговой опыт. Их место — развёрнутая анкета до приложения.
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
import { savePrefill } from "@/features/intervals/loop/repository";
import { fieldLabelRu, type PrefillableField } from "@/features/intervals/loop/prefill";

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : null;
}

const COMMIT = process.argv.includes("--commit");

const SOURCE_KINDS = new Set(["student", "self", "test"]);

/**
 * Разбор --pre-* в набор заданных полей.
 *
 * ЗАДАНО ЛИ ПОЛЕ — определяется НАЛИЧИЕМ ФЛАГА, а не значением. У половины
 * полей NULL сам по себе законный ответ («день длительной не важен»), и по
 * значению «задано» от «не задано» не отличить.
 */
function collectPrefill(): {
  setFields: PrefillableField[];
  values: Record<string, unknown>;
  errors: string[];
} {
  const setFields: PrefillableField[] = [];
  const values: Record<string, unknown> = {};
  const errors: string[] = [];

  const goal = arg("pre-goal");
  if (goal !== null) {
    if (!["race", "regular", "start_running"].includes(goal)) {
      errors.push("--pre-goal принимает race, regular или start_running");
    }
    setFields.push("goalKind");
    values.goalKind = goal;
  }

  const days = arg("pre-days");
  if (days !== null) {
    const n = Number(days);
    if (!Number.isInteger(n) || n < 2 || n > 7) errors.push("--pre-days — целое от 2 до 7");
    setFields.push("daysPerWeek");
    values.daysPerWeek = n;
  }

  const skip = arg("pre-skip-days");
  if (skip !== null) {
    // Пустая строка — ОСМЫСЛЕННЫЙ ответ «запретов нет», а не «не задано».
    const parsed = skip.split(",").map((v) => v.trim()).filter(Boolean).map(Number);
    if (parsed.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      errors.push("--pre-skip-days — дни 0..6 через запятую (0=Пн)");
    }
    setFields.push("unavailableWeekdays");
    values.unavailableWeekdays = [...new Set(parsed)];
  }

  const longDay = arg("pre-long-day");
  if (longDay !== null) {
    if (longDay === "none") {
      values.preferredLongWeekday = null;
    } else {
      const n = Number(longDay);
      if (!Number.isInteger(n) || n < 0 || n > 6) errors.push("--pre-long-day — 0..6 или none");
      values.preferredLongWeekday = n;
    }
    setFields.push("preferredLongWeekday");
  }

  const canRun = arg("pre-can-run-continuously");
  if (canRun !== null) {
    if (canRun !== "true" && canRun !== "false") {
      errors.push("--pre-can-run-continuously принимает true или false");
    }
    setFields.push("canRunContinuously");
    values.canRunContinuously = canRun === "true";
  }

  const raceDate = arg("pre-race-date");
  if (raceDate !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raceDate)) errors.push("--pre-race-date — YYYY-MM-DD");
    setFields.push("raceDate");
    values.raceDate = raceDate;
  }

  const raceKm = arg("pre-race-km");
  if (raceKm !== null) {
    const n = Number(raceKm);
    if (!Number.isFinite(n) || n <= 0) errors.push("--pre-race-km — положительное число");
    setFields.push("raceDistanceKm");
    values.raceDistanceKm = n;
  }

  const stability = arg("pre-week-stability");
  if (stability !== null) {
    if (stability !== "stable" && stability !== "varies") {
      errors.push("--pre-week-stability принимает stable или varies");
    }
    setFields.push("weekStability");
    values.weekStability = stability;
  }

  const freeDays = arg("pre-free-days");
  if (freeDays !== null) {
    const parsed = freeDays.split(",").map((v) => v.trim()).filter(Boolean).map(Number);
    if (parsed.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      errors.push("--pre-free-days — дни 0..6 через запятую (0=Пн)");
    }
    setFields.push("availableWeekdays");
    values.availableWeekdays = [...new Set(parsed)];
  }

  const qualityDay = arg("pre-quality-day");
  if (qualityDay !== null) {
    if (qualityDay === "none") {
      values.preferredQualityWeekday = null;
    } else {
      const n = Number(qualityDay);
      if (!Number.isInteger(n) || n < 0 || n > 6) errors.push("--pre-quality-day — 0..6 или none");
      values.preferredQualityWeekday = n;
    }
    setFields.push("preferredQualityWeekday");
  }

  const timeOfDay = arg("pre-time-of-day");
  if (timeOfDay !== null) {
    if (!["morning", "evening", "varies"].includes(timeOfDay)) {
      errors.push("--pre-time-of-day принимает morning, evening или varies");
    }
    setFields.push("timeOfDay");
    values.timeOfDay = timeOfDay;
  }

  const surfaces = arg("pre-surfaces");
  if (surfaces !== null) {
    setFields.push("runSurfaces");
    values.runSurfaces = surfaces.split(",").map((v) => v.trim()).filter(Boolean);
  }

  const breakers = arg("pre-week-breakers");
  if (breakers !== null) {
    setFields.push("weekBreakers");
    values.weekBreakers = breakers;
  }

  // ЧУВСТВИТЕЛЬНОЕ. Вывод тренера об ограничениях, а не копия медицинских
  // ответов анкеты. Наружу не отдаётся: ни ученику, ни в Telegram, ни в логи.
  const health = arg("pre-health-limits");
  if (health !== null) {
    setFields.push("healthLimits");
    values.healthLimits = health;
  }

  const experience = arg("pre-experience");
  if (experience !== null) {
    setFields.push("experienceNote");
    values.experienceNote = experience;
  }

  const weekly = arg("pre-weekly-minutes");
  if (weekly !== null) {
    const n = Number(weekly);
    if (!Number.isInteger(n) || n < 0 || n > 1200) errors.push("--pre-weekly-minutes — целое 0..1200");
    setFields.push("selfReportedWeeklyMinutes");
    values.selfReportedWeeklyMinutes = n;
  }

  return { setFields, values, errors };
}

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

  const kind = arg("kind") ?? "student";
  if (!SOURCE_KINDS.has(kind)) fail("--kind принимает student, self или test");

  const prefill = collectPrefill();
  if (prefill.errors.length > 0) fail(prefill.errors.map((e) => `Отказ: ${e}`).join("\n"));
  // Потолок методики проверяем на входе тренера, а не у ученицы: иначе отказ
  // прилетел бы ей за решение, которого она не принимала.
  if (prefill.values.goalKind === "start_running" && Number(prefill.values.daysPerWeek) > 3) {
    fail(
      "Отказ: методика новичка ограничивает первые 12 недель тремя беговыми днями, " +
        `а --pre-days=${prefill.values.daysPerWeek}. Поставьте 2 или 3.`
    );
  }

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
    if (!existingSource) console.log(`  · источник Intervals ${athleteId} (kind=${kind}) с ключом из ${keyEnv}`);
    if (telegramUserId) console.log(`  · привязка Telegram user ${telegramUserId}`);
    if (prefill.setFields.length > 0) {
      console.log(`  · предзаданные тренером поля (ученица их НЕ УВИДИТ):`);
      for (const field of prefill.setFields) {
        console.log(`      ${fieldLabelRu(field)} = ${JSON.stringify(prefill.values[field] ?? null)}`);
      }
    }
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
      kind,
      is_active: true,
    },
    // Апсерт по athlete_id, а не по (student_id, provider): для строк с NULL
    // владельцем второй индекс не работает, и это единственный надёжный ключ.
    { onConflict: "provider,external_athlete_id" }
  );
  if (sourceError) fail(`Не удалось завести источник: ${sourceError.message}`);
  console.log(`Источник Intervals ${athleteId} готов, kind=${kind} (ключ из ${keyEnv}, в вывод не попадает).`);
  if (kind === "test") {
    console.log("  kind=test — регулярный опрос это подключение НЕ трогает.");
  }

  if (prefill.setFields.length > 0) {
    const { data: sourceRow } = await supabase
      .from("student_data_sources")
      .select("id")
      .eq("provider", "intervals")
      .eq("external_athlete_id", athleteId)
      .maybeSingle();
    if (!sourceRow) fail("Источник не найден после записи — предзаполнение не сохранено");
    const saved = await savePrefill({
      sourceId: String(sourceRow.id),
      setFields: prefill.setFields,
      values: prefill.values,
      note: arg("pre-note"),
      setBy: "coach",
    });
    if (!saved.ok) fail(`Не удалось сохранить предзаполнение: ${saved.message}`);
    console.log("");
    console.log("Предзадано тренером — в анкете этих вопросов НЕ БУДЕТ:");
    for (const field of prefill.setFields) {
      console.log(`  ${fieldLabelRu(field)} = ${JSON.stringify(prefill.values[field] ?? null)}`);
    }
  }

  console.log("");
  console.log("Дальше: анкету заполняет ученица в мини-приложении, план собирает");
  console.log("intervals-onboarding-plan.ts --commit, показывает ученице — админка.");
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
