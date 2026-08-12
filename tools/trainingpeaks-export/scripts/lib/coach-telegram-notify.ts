// Shared coach-Telegram sender for the Mac pipeline scripts (ops alerts, feedback safety-net
// digest). Direct Bot API call, TELEGRAM_BOT_TOKEN → TELEGRAM_COACH_CHAT_IDS. Never throws — a
// message that can't send must not break the caller's exit code. Expects env already loaded
// (loadLocalEnv) by the caller.

function coachChatIds(): string[] {
  const value = process.env.TELEGRAM_COACH_CHAT_IDS?.trim();
  if (!value) return [];
  return value.split(",").map((id) => id.trim()).filter(Boolean);
}

export async function sendCoachTelegramMessage(message: string): Promise<void> {
  const text = message.trim();
  if (!text) {
    console.error("[coach-telegram-notify] no message given");
    return;
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = coachChatIds();
  if (!token) {
    console.error("[coach-telegram-notify] TELEGRAM_BOT_TOKEN not set — cannot send:", text);
    return;
  }
  if (chatIds.length === 0) {
    console.error("[coach-telegram-notify] TELEGRAM_COACH_CHAT_IDS not set — cannot send:", text);
    return;
  }
  // ОТПРАВКА С ПОВТОРАМИ. Тревога — единственный след того, что поток встал; потерять её значит
  // вернуться к «нашли случайно». 01.08 две отправки легли на «fetch failed» (сетевой сбой),
  // повтора не было, сообщения пропали, а `|| true` в обёртке скрыл это от кода возврата —
  // в логе остались две строки, которых никто не читал.
  // Три попытки с нарастающей паузой: сетевой всплеск переживаем, при настоящей поломке
  // (неверный токен, чужой chat_id) Telegram отвечает 4xx, и повторять смысла нет — выходим сразу.
  const RETRIES = 3;
  for (const chatId of chatIds) {
    for (let attempt = 1; attempt <= RETRIES; attempt++) {
      try {
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text }),
        });
        if (res.ok) break;
        const permanent = res.status >= 400 && res.status < 500;
        console.error(`[coach-telegram-notify] send to ${chatId} failed: HTTP ${res.status}`
          + (permanent ? " — постоянная ошибка, повтор не поможет" : ` — попытка ${attempt} из ${RETRIES}`));
        if (permanent || attempt === RETRIES) break;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[coach-telegram-notify] send to ${chatId} error (попытка ${attempt} из ${RETRIES}):`, msg);
        if (attempt === RETRIES) {
          console.error(`[coach-telegram-notify] ТРЕВОГА НЕ ДОСТАВЛЕНА после ${RETRIES} попыток: ${text.slice(0, 200)}`);
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}
