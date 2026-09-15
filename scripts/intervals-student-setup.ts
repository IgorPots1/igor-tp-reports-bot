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
 * --pre-max-session-min=60     потолок длительности одной тренировки
 * --pre-timezone=Europe/Moscow часовой пояс; иначе определится сам из приложения
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
import { createIntervalsStudent, intervalsMarkerUrl } from "@/features/intervals/enrollment";
import { fieldLabelRu } from "@/features/intervals/loop/prefill";
import { collectPrefillArgs } from "@/features/intervals/prefill-args";

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : null;
}

const COMMIT = process.argv.includes("--commit");

const SOURCE_KINDS = new Set(["student", "self", "test"]);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
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

  const prefill = collectPrefillArgs();
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

  // ОДИН ПУТЬ ЗАВЕДЕНИЯ НА ТЕРМИНАЛ И НА БОТА [15.09.2026].
  //
  // Раньше карточку, источник и предзаполнение писал этот скрипт сам. Когда
  // рядом появилось заведение из бота, две реализации означали бы расхождение
  // на первой же правке — а расхождение здесь обнаруживается на живом человеке:
  // ученица видит в анкете вопрос, на который тренер уже ответил за неё.
  // Поэтому обе двери ведут в createIntervalsStudent.
  const created = await createIntervalsStudent({
    studentKey: studentId,
    name,
    telegramUserId: telegramUserId ? Number(telegramUserId) : null,
    telegramChatId: telegramChatId ?? null,
    athleteId,
    credential,
    kind,
    timezone: (prefill.values.timezone as string | undefined) ?? null,
    prefill:
      prefill.setFields.length > 0
        ? {
            setFields: prefill.setFields,
            values: prefill.values,
            note: arg("pre-note"),
            setBy: "coach",
          }
        : null,
  });
  console.log(`Карточка ${created.cardCreated ? "заведена" : "обновлена"}: ${created.studentUuid}`);
  console.log(`Источник Intervals ${created.athleteId} готов, kind=${kind} (ключ из ${keyEnv}, в вывод не попадает).`);
  if (kind === "test") {
    console.log("  kind=test — регулярный опрос это подключение НЕ трогает.");
  }

  if (prefill.setFields.length > 0) {
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
