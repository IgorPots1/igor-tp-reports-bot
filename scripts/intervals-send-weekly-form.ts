/**
 * Разовая отправка недельной формы одному ученику, вне расписания.
 *
 * ЗАЧЕМ ОТДЕЛЬНО ОТ РАННЕРА. Раннер ходит по окну (вс, 10–12 по местному) и по
 * своим условиям. Бывает, что окно прошло, а неделю ставить надо сегодня —
 * тогда тренер отправляет форму рукой. Править ради этого расписание значило бы
 * менять правило ради одного случая.
 *
 * ЧТО ЗДЕСЬ СОХРАНЕНО ОТ РАННЕРА:
 *   · текст тот же самый, из decideReminder — двух разных формулировок одной
 *     просьбы быть не должно;
 *   · след в intervals_reminders пишется так же, тем же ключом
 *     (source_id, kind, local_date). Поэтому раннер, проснувшись в окно, второй
 *     раз то же самое не пошлёт;
 *   · флаг доставки у карточки (telegram_delivery_enabled) уважается: он про
 *     человека, а не про расписание.
 *
 * ЧЕМ ОТЛИЧАЕТСЯ СОЗНАТЕЛЬНО: INTERVALS_REMINDERS_ENABLED здесь НЕ проверяется.
 * Этот флаг выключает АВТОМАТИЧЕСКУЮ рассылку; ручная отправка по прямой
 * команде — ровно тот случай, ради которого флаг и оставляет дверь.
 *
 * По умолчанию НИЧЕГО НЕ ОТПРАВЛЯЕТ.
 *
 *   npx tsx scripts/intervals-send-weekly-form.ts --chat=780530798
 *   npx tsx scripts/intervals-send-weekly-form.ts --chat=780530798 --commit
 */

import process from "node:process";

import { todayIsoInZone } from "@/features/intervals/loop/clock";
import { createSupabaseServerClient } from "@/features/supabase/server";
import { sendTelegramMessageStrict } from "@/features/telegram/telegram-client";

const COMMIT = process.argv.includes("--commit");

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : null;
}

function fail(message: string): never {
  console.error(`⛔ ${message}`);
  process.exit(1);
}

/** Тот же текст, что шлёт раннер. Держим одной константой, а не двумя копиями. */
const WEEKLY_FORM_TEXT =
  "Неделя заканчивается. Расскажите, как она прошла: три коротких вопроса, минута времени.\n\n" +
  "Это то, чего я не вижу по отдельным тренировкам — успели ли вы по графику и не " +
  "накопилась ли усталость. От вашего ответа зависит, какой я соберу следующую неделю.";

async function main(): Promise<void> {
  const chatArg = arg("chat");
  if (!chatArg) fail("Нужен --chat=<telegram chat id>");

  const supabase = createSupabaseServerClient();
  const { data: card, error: cardError } = await supabase
    .from("trainingpeaks_students")
    .select("id, student_name, telegram_chat_id, telegram_delivery_enabled, timezone, coaching_platform, is_active")
    .eq("telegram_chat_id", chatArg)
    .maybeSingle();
  if (cardError) fail(`карточка не читается: ${cardError.message}`);
  if (!card) fail(`Карточки с chat_id ${chatArg} нет`);
  const row = card as Record<string, unknown>;

  const { data: source } = await supabase
    .from("student_data_sources")
    .select("id")
    .eq("student_id", String(row.id))
    .eq("provider", "intervals")
    .maybeSingle();
  if (!source) fail(`У «${row.student_name}» нет источника Intervals`);
  const sourceId = String((source as Record<string, unknown>).id);

  const localDate = todayIsoInZone((row.timezone as string | null) ?? null);

  console.log(`Ученик:     ${row.student_name}`);
  console.log(`Чат:        ${row.telegram_chat_id} · доставка ${row.telegram_delivery_enabled}`);
  console.log(`Дата у неё: ${localDate} (зона ${row.timezone ?? "не задана"})`);

  const { data: already } = await supabase
    .from("intervals_reminders")
    .select("status, created_at")
    .eq("source_id", sourceId)
    .eq("kind", "weekly_form")
    .eq("local_date", localDate)
    .maybeSingle();
  if (already) {
    const a = already as Record<string, unknown>;
    fail(
      `Форма за ${localDate} уже уходила (${a.status}, ${String(a.created_at).slice(0, 16)}). ` +
        "Второй раз в тот же день не шлём — это правило раннера, и ручная отправка его не отменяет."
    );
  }

  if (row.telegram_delivery_enabled !== true) {
    fail("У карточки выключена доставка (telegram_delivery_enabled). Это про человека, не про расписание — не обхожу.");
  }

  console.log("");
  console.log("Будет отправлено:");
  console.log("  " + WEEKLY_FORM_TEXT.split("\n")[0]);

  if (!COMMIT) {
    console.log("\nНичего не отправлено (запуск без --commit).");
    return;
  }

  let status: "sent" | "failed" = "sent";
  let detail: string | null = null;
  try {
    await sendTelegramMessageStrict(String(row.telegram_chat_id), WEEKLY_FORM_TEXT);
  } catch (error) {
    status = "failed";
    detail = error instanceof Error ? error.message : String(error);
  }

  const { error: writeError } = await supabase.from("intervals_reminders").insert({
    source_id: sourceId,
    kind: "weekly_form",
    local_date: localDate,
    status,
    detail: detail ?? "отправлено рукой, вне окна",
    chat_id: status === "sent" ? String(row.telegram_chat_id) : null,
    telegram_message_id: null,
  });
  if (writeError) console.log(`⚠ след не записан: ${writeError.message}`);

  console.log(`\nИтог: ${status}${detail ? ` (${detail})` : ""}`);
  if (status === "failed") process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
