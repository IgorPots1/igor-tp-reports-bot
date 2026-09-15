/**
 * Заведение ученика Intervals: ОДИН путь для терминала и для бота.
 *
 * ПОЧЕМУ ОБЩИЙ МОДУЛЬ, А НЕ ДВЕ РЕАЛИЗАЦИИ. Требование тренера звучит так:
 * «предзаполнение из бота должно работать так же, как из скрипта». Две
 * реализации выполняют это ровно до первой правки, дальше расходятся молча, и
 * расхождение обнаруживается на живом человеке: ученица видит в анкете вопрос,
 * на который тренер уже ответил за неё.
 *
 * ── ИСТОЧНИК-ЗАГОТОВКА ──────────────────────────────────────────────────────
 *
 * Предзаполнение в базе висит на ИСТОЧНИКЕ (source_id — первичный ключ), а при
 * заведении из бота источника ещё нет: аккаунт Intervals она подключит сама,
 * через OAuth, и её athlete id мы узнаем только тогда.
 *
 * Поэтому заводим источник-заготовку с адресом вида pending-XXXX и ВЫКЛЮЧЕННЫМ
 * is_active. Выключенный он по двум причинам сразу:
 *   · раннер синхронизации берёт только активные, и заготовка не будет каждые
 *     полчаса биться об Intervals с ключом-пустышкой;
 *   · гард мини-приложения считает подключение непригодным и показывает ей
 *     экран «подключим часы», а не пустой план.
 *
 * Когда она подключается, OAuth ЗАБИРАЕТ эту строку себе (claimPendingSource):
 * тот же source_id, настоящий athlete id, реальный токен. Предзаполнение
 * остаётся на месте, потому что ключ не поменялся.
 */

import { savePrefill } from "@/features/intervals/loop/repository";
import { PENDING_ATHLETE_PREFIX as PREFIX } from "./repository";
import type { Prefill, PrefillableField } from "@/features/intervals/loop/prefill";
import { createSupabaseServerClient, describeSupabaseError } from "@/features/supabase/server";

// Префикс определён там же, где OAuth его читает: одно место, одна правда.
export { PENDING_ATHLETE_PREFIX } from "./repository";

/**
 * Адрес-маркер вместо ссылки на TrainingPeaks: колонка NOT NULL, а аккаунта в
 * TrainingPeaks у этого ученика нет и не будет.
 *
 * СХЕМА intervals://, А НЕ https://, И ЭТО НЕ КОСМЕТИКА. Колонку
 * trainingpeaks_athlete_url читают около двадцати боевых раннеров, и часть из
 * них выкусывает оттуда идентификатор атлета регулярным выражением. Обычная
 * ссылка вида https://… имеет шанс быть разобранной как настоящий адрес
 * TrainingPeaks; несуществующая схема не разбирается никем и сразу видна
 * глазами. Формат уже принят живыми карточками, менять его нельзя.
 */
export function intervalsMarkerUrl(athleteId: string): string {
  return `intervals://athlete/${athleteId}`;
}

/**
 * Человекочитаемый ключ карточки.
 *
 * Латиницей и с telegram id в хвосте: два Ивана Петрова — обычное дело, а ключ
 * обязан быть уникальным. Кириллица в ключе однажды приедет в URL и сломается.
 */
export function buildStudentKey(name: string, telegramUserId: number | null): string {
  const translit: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
    й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
    у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "",
    э: "e", ю: "yu", я: "ya",
  };
  const slug = [...name.toLowerCase()]
    .map((char) => translit[char] ?? char)
    .join("")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 32);
  const tail = telegramUserId ? String(telegramUserId).slice(-4) : String(Date.now()).slice(-4);
  return `${slug || "student"}-${tail}`;
}

export type EnrollmentPrefill = {
  setFields: PrefillableField[];
  values: Partial<Prefill["values"]>;
  note: string | null;
  setBy: string;
};

export type EnrollmentResult = {
  studentUuid: string;
  sourceId: string;
  studentKey: string;
  athleteId: string;
  cardCreated: boolean;
};

/**
 * Завести (или дозаполнить) ученика.
 *
 * Идемпотентно по studentKey и по athleteId: повторный вызов не плодит вторую
 * карточку и второй источник, а дописывает недостающее.
 */
export async function createIntervalsStudent(input: {
  studentKey: string;
  name: string;
  telegramUserId: number | null;
  telegramChatId: string | null;
  /** Настоящий athlete id, если он уже известен. null — источник-заготовка под OAuth. */
  athleteId: string | null;
  /** Ключ доступа для источника с известным athlete id. */
  credential?: string | null;
  kind?: "student" | "self" | "test";
  timezone?: string | null;
  prefill?: EnrollmentPrefill | null;
}): Promise<EnrollmentResult> {
  const supabase = createSupabaseServerClient();
  const kind = input.kind ?? "student";
  const pending = input.athleteId === null;
  const athleteId = input.athleteId ?? `${PREFIX}${input.studentKey}`;

  const { data: existingCard } = await supabase
    .from("trainingpeaks_students")
    .select("id")
    .eq("student_id", input.studentKey)
    .maybeSingle();

  let studentUuid: string;
  let cardCreated = false;
  if (existingCard) {
    studentUuid = String((existingCard as { id: string }).id);
    const patch: Record<string, unknown> = { coaching_platform: "intervals", is_active: true };
    if (input.timezone) patch.timezone = input.timezone;
    if (input.telegramUserId) patch.telegram_user_id = input.telegramUserId;
    if (input.telegramChatId) patch.telegram_chat_id = input.telegramChatId;
    const { error } = await supabase.from("trainingpeaks_students").update(patch).eq("id", studentUuid);
    if (error) throw new Error(`карточка не обновилась: ${describeSupabaseError(error)}`);
  } else {
    const { data, error } = await supabase
      .from("trainingpeaks_students")
      .insert({
        student_id: input.studentKey,
        student_name: input.name,
        trainingpeaks_athlete_url: intervalsMarkerUrl(athleteId),
        coaching_platform: "intervals",
        is_active: true,
        // Недельные отчёты TP этому ученику не положены: они собираются из кэша
        // TrainingPeaks, которого у него нет.
        weekly_report_enabled: false,
        telegram_user_id: input.telegramUserId,
        telegram_chat_id: input.telegramChatId,
        // Доставка ВЫКЛЮЧЕНА по умолчанию и включается тренером сознательно.
        // Заведение ученика не должно само по себе открывать канал наружу.
        telegram_delivery_enabled: false,
        timezone: input.timezone ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(`карточка не завелась: ${describeSupabaseError(error)}`);
    studentUuid = String((data as { id: string }).id);
    cardCreated = true;
  }

  const { data: sourceRow, error: sourceError } = await supabase
    .from("student_data_sources")
    .upsert(
      {
        student_id: studentUuid,
        provider: "intervals",
        external_athlete_id: athleteId,
        auth_method: "api_key",
        credential: input.credential ?? "pending-oauth",
        kind,
        // Заготовка неактивна: её не опрашивает раннер и не считает годной гард
        // приложения. Активной её сделает OAuth, когда появится живой токен.
        is_active: !pending,
      },
      { onConflict: "provider,external_athlete_id" }
    )
    .select("id")
    .single();
  if (sourceError) throw new Error(`источник не завёлся: ${describeSupabaseError(sourceError)}`);
  const sourceId = String((sourceRow as { id: string }).id);

  if (input.prefill && input.prefill.setFields.length > 0) {
    await savePrefill({
      sourceId,
      setFields: input.prefill.setFields,
      values: input.prefill.values,
      note: input.prefill.note,
      setBy: input.prefill.setBy,
    });
  }

  return { studentUuid, sourceId, studentKey: input.studentKey, athleteId, cardCreated };
}
