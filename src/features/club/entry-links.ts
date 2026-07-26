// Club Mini App — entry-link builder. Mirrors nutrition's buildMiniAppDeepLink but
// carries a one-time TOKEN (not the student row id) and NEVER sends anything: it only
// returns strings for the admin to copy. BotFather short name for the club app is
// `club` → configured as CLUB_MINIAPP_SHORT_NAME (env). The BotFather step itself is
// out of scope (coach-configured); this only builds the t.me links.

import { getTelegramBotUsername } from "@/features/telegram/telegram-client";

export function clubMiniAppShortName(): string | null {
  return process.env.CLUB_MINIAPP_SHORT_NAME?.trim() || null;
}

/** Pure builders (given a resolved bot username + short name) — avoid N getMe calls. */
export function clubTokenLinkStr(username: string, shortName: string, token: string): string {
  return `https://t.me/${username}/${shortName}?startapp=${encodeURIComponent(token)}`;
}
export function clubGeneralLinkStr(username: string, shortName: string): string {
  return `https://t.me/${username}/${shortName}`;
}

function requireShortName(): string {
  const s = clubMiniAppShortName();
  if (!s) {
    throw new Error("CLUB_MINIAPP_SHORT_NAME is not set (BotFather /newapp short name for the club app, e.g. `club`).");
  }
  return s;
}

/** Personal one-time link: t.me/<bot>/<club>?startapp=<token>. For an UNBOUND student. */
export async function buildClubTokenLink(token: string): Promise<string> {
  return clubTokenLinkStr(await getTelegramBotUsername(), requireShortName(), token);
}

/** General link, no parameter: t.me/<bot>/<club>. For an ALREADY-BOUND student. */
export async function buildClubGeneralLink(): Promise<string> {
  return clubGeneralLinkStr(await getTelegramBotUsername(), requireShortName());
}
