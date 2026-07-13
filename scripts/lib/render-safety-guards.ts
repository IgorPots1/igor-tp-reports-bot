// Render-path safety patterns for the admin nutrition page checks.
//
// The invariant they protect: the student page must never message the athlete BY ITSELF while it
// renders. A coach-triggered send is fine and is how the page actually works — the sender is bound
// to a form (`<form action={sendNutritionFormAction}>`) and only fires on submit.
//
// So what matters is a CALL, not the word «Telegram». The guards these replaced matched
// /telegram|sendMessage|sendTelegram/i over the page source and went red on the page merely
// READING student.telegramChatId (to badge the business-window state) and rendering a
// <dt>Telegram</dt> label. Both checks sat red on main for it. A safety check that cries wolf is
// worse than no check: it teaches everyone to scroll past red, and then the real one goes unread.
//
// Parens are the whole distinction: `sendX(...)` runs during render, `action={sendX}` does not.
//
// ONE definition on purpose. This guard lives in two check scripts, and two copies of a predicate
// drifting apart is precisely how the amber≠hard bug happened — the fix landed in some copies and
// not others, and the stale ones kept asserting the wrong thing.

/** Any `send…(` invocation — covers sendTelegramMessage, sendNutritionFormButtonToStudent, and whatever gets added next. */
export const SEND_CALL_IN_RENDER = /\bsend[A-Za-z0-9_]*\s*\(/;

/** A raw hit on the Bot API, bypassing the client entirely. */
export const TELEGRAM_BOT_API_HOST = /api\.telegram\.org/i;
