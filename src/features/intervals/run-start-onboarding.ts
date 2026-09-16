/**
 * Вход в приложение для ученика на тарифе с подключением часов.
 *
 * ОДНА КНОПКА. Раньше их было две, и вторая вела на сайт с тем же текстом про
 * подключение, что и внутри приложения. Теперь подключение объясняется только
 * в приложении, а сайт остался про формат работы.
 *
 * ЗАЧЕМ ЭТО СУЩЕСТВУЕТ. До 14.09.2026 войти было НЕКУДА: общая кнопка меню у
 * бота ведёт в клуб, короткое имя Mini App в BotFather не заведено, а /start
 * отвечал ссылкой на инструкцию. Человек читал инструкцию, подключал часы и
 * упирался: приложение есть, а двери в него нет.
 *
 * ДВЕ ДВЕРИ, И ОБЕ НУЖНЫ:
 *   · кнопка в сообщении — войти прямо сейчас, не разбираясь;
 *   · кнопка меню этого чата — вернуться завтра, не листая переписку.
 * Кнопка меню ставится ПЕРСОНАЛЬНО на чат: общая одна на бота и занята клубом,
 * менять её ради одного тарифа значит сломать вход всем остальным.
 *
 * ССЫЛКА НА ИНСТРУКЦИЮ ОСТАЛАСЬ, но теперь она вторая, а не единственная:
 * подробности подключения живут и внутри приложения, а страница нужна тем, кто
 * читает заранее или с компьютера.
 *
 * НИЧЕГО НЕ РАССЫЛАЕТ. Отвечает только на собственное действие человека.
 */

import { SITE_URL } from "@/lib/site";
import { isManualEntryStudent } from "@/features/intervals/manual-entry";
import { listActiveStudentsByTelegramUserId } from "@/features/trainingpeaks/repository";
import {
  sendTelegramMessageStrict,
  sendTelegramWebAppButton,
  setTelegramChatMenuButtonWebApp,
} from "@/features/telegram/telegram-client";

export const RUN_START_PARAM = "run";

/**
 * Ученик ли это того тарифа, где план лежит у нас, а тренировки приходят из
 * Intervals.
 *
 * ПРОВЕРЯЕМ ПО КАРТОЧКЕ, А НЕ ПО ПАРАМЕТРУ ССЫЛКИ. Ссылку с параметром человек
 * нажимает один раз, а /start он жмёт и через месяц, когда ссылка давно
 * потеряна. Карточка — источник правды о том, на каком человек тарифе.
 */
export async function isIntervalsStudent(telegramUserId: number): Promise<boolean> {
  try {
    const cards = await listActiveStudentsByTelegramUserId(telegramUserId);
    return cards.some((card) => card.coachingPlatform === "intervals");
  } catch (error) {
    // Ошибка чтения не должна превращаться в «вы не наш ученик»: в худшем
    // случае человек получит обычный ответ бота, а не отказ.
    console.warn("[run.start] не удалось проверить тариф", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

const GREETING_RU =
  "Привет! Здесь ваш план: что сегодня, как отметиться после тренировки и что ответил тренер.\n\n" +
  "Откройте приложение кнопкой ниже. Если часы ещё не подключены, оно само проведёт по шагам: " +
  "это делается один раз и занимает пару минут.";

/**
 * Для тех, кто ведёт тренировки вручную [16.09.2026]. Текст про часы им не
 * подходит: часов нет и не будет, а «оно само проведёт по шагам» звучало бы
 * так, будто что-то подключать всё же придётся.
 */
const GREETING_MANUAL_RU =
  "Привет! Здесь ваш план: что сегодня, как отметиться после тренировки и что ответил тренер.\n\n" +
  "После тренировки открывайте приложение и вписывайте её сами: сколько длилась, дистанция и " +
  "пульс — если знаете.";

function appUrl(): string {
  return `${SITE_URL.replace(/\/+$/, "")}/m/run`;
}

export async function handleRunStartCommand(input: {
  chatId: string | number;
  from: { id: number } | null;
}): Promise<boolean> {
  if (!input.from?.id) return false;

  // ОДНА ЛИШНЯЯ ПРОВЕРКА РАДИ ТОЧНОГО ТЕКСТА КНОПКИ. Обе двери — что кнопка
  // меню, что кнопка сообщения — ведут в ОДИН И ТОТ ЖЕ /m/run: экран внутри
  // сам знает, показать ли форму подключения часов или форму ручного ввода.
  // Разное здесь — только слова, которые видит человек, а слова решают, придёт
  // ли он вообще: «Открыть приложение» ничего не говорит про то, зачем.
  let manual = false;
  try {
    const cards = await listActiveStudentsByTelegramUserId(input.from.id);
    const card = cards.find((c) => c.coachingPlatform === "intervals");
    if (card) manual = await isManualEntryStudent(card.id);
  } catch (error) {
    console.warn("[run.start] не удалось проверить способ ведения тренировок", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // СНАЧАЛА КНОПКА МЕНЮ, ПОТОМ СООБЩЕНИЕ. Она не зависит от того, примет ли чат
  // inline-кнопку, и остаётся дверью, даже если сообщение уйдёт без неё.
  try {
    await setTelegramChatMenuButtonWebApp({
      chatId: input.chatId,
      text: manual ? "Записать тренировку" : "Мой план",
      url: appUrl(),
    });
  } catch (error) {
    console.warn("[run.start] кнопка меню не поставилась", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const greeting = manual ? GREETING_MANUAL_RU : GREETING_RU;
  const buttonLabel = manual ? "Ввести тренировку вручную" : "Открыть приложение";

  try {
    await sendTelegramWebAppButton({
      chatId: input.chatId,
      text: greeting,
      // ОДНА КНОПКА, А НЕ ДВЕ [решение Игоря, 15.09.2026]. Вторая вела на сайт,
      // где лежал тот же текст про подключение, что и внутри приложения. Выбор
      // между двумя дверями в одну комнату — это не забота, а задержка.
      buttons: [{ label: buttonLabel, webAppUrl: appUrl() }],
    });
    return true;
  } catch (error) {
    // web_app-кнопку не приняли (так ведёт себя бизнес-переписка). Промолчать
    // нельзя: человек нажал /start и ждёт ответа.
    console.warn("[run.start] кнопка приложения не прошла, отправляю текстом", {
      error: error instanceof Error ? error.message : String(error),
    });
    try {
      await sendTelegramMessageStrict(
        input.chatId,
        // БЕЗ ССЫЛКИ НА САЙТ: там больше нет инструкции по подключению, она
        // целиком живёт в приложении. Отправить человека на страницу, где нет
        // ответа, хуже, чем не отправить никуда.
        `${greeting}\n\nПриложение открывается кнопкой меню слева от поля ввода, ` +
          `она называется «${manual ? "Записать тренировку" : "Мой план"}».`
      );
    } catch (fallbackError) {
      console.error("[run.start] не удалось ответить", {
        error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
      });
    }
    return true;
  }
}
