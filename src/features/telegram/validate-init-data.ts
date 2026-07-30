import { createHmac, timingSafeEqual } from "node:crypto";

function safeTimingEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Validates Telegram WebApp initData using HMAC-SHA256.
 * Per Telegram docs: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * secret_key = HMAC_SHA256(bot_token, "WebAppData")
 * check_string = sorted(key=value pairs, except hash) joined by "\n"
 * expected_hash = HMAC_SHA256(check_string, secret_key).hex
 */
export function validateTelegramInitDataWithToken(
  initData: string,
  botToken: string,
  opts?: { dropSignature?: boolean }
): boolean {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return false;
    params.delete("hash");
    // `signature` (Ed25519, for third-party validation) is dropped ONLY when the caller
    // opts in. DEFAULT is false = the exact behaviour that /m/desk and /m/n shipped with
    // and that worked in production — do NOT change the proven coach/student path. The
    // club opts in (validateClubInitData) because its investigation is still open.
    if (opts?.dropSignature) {
      params.delete("signature");
    }

    const checkString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");

    const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
    const expectedHash = createHmac("sha256", secretKey).update(checkString).digest("hex");

    return safeTimingEqual(hash, expectedHash);
  } catch {
    return false;
  }
}

export function validateTelegramInitData(initData: string): boolean {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return false;
  return validateTelegramInitDataWithToken(initData, token);
}

/**
 * The bot token that signs the CLUB mini app's initData. The club app is registered
 * in BotFather under its OWN bot (igor_agent_hub_bot), which is DIFFERENT from the
 * one /m/n uses (TELEGRAM_BOT_TOKEN = igorp_coach_bot). So the club must validate
 * with CLUB_TELEGRAM_BOT_TOKEN; TELEGRAM_BOT_TOKEN is only a fallback (wrong bot →
 * bad_signature). varName is returned for diagnostic logging.
 */
export function clubInitDataTokenInfo(): { token: string | undefined; varName: "CLUB_TELEGRAM_BOT_TOKEN" | "TELEGRAM_BOT_TOKEN" } {
  const club = process.env.CLUB_TELEGRAM_BOT_TOKEN?.trim();
  if (club) return { token: club, varName: "CLUB_TELEGRAM_BOT_TOKEN" };
  return { token: process.env.TELEGRAM_BOT_TOKEN?.trim(), varName: "TELEGRAM_BOT_TOKEN" };
}

/**
 * initData validation for the CLUB surface. Tries BOTH data-check-string variants and
 * reports which one matched — no hypothesis about the client baked in:
 *  - "with_signature"    : signature INCLUDED in the hash (dropSignature:false) — the
 *                          same, proven behaviour as /m/desk and /m/n. Tried FIRST.
 *  - "without_signature" : signature EXCLUDED (dropSignature:true) — fallback for
 *                          clients where Telegram omits it from the HMAC.
 * botId is the club token's public bot id (compare with @igorp_coach_bot on failure).
 */
export function validateClubInitDataVerbose(initData: string): {
  ok: boolean;
  variant: "with_signature" | "without_signature" | null;
  botId: number | null;
} {
  const token = clubInitDataTokenInfo().token;
  const botId = botIdFromToken(token);
  if (!token) return { ok: false, variant: null, botId };
  if (validateTelegramInitDataWithToken(initData, token, { dropSignature: false })) {
    return { ok: true, variant: "with_signature", botId };
  }
  if (validateTelegramInitDataWithToken(initData, token, { dropSignature: true })) {
    return { ok: true, variant: "without_signature", botId };
  }
  return { ok: false, variant: null, botId };
}

/** Boolean club validation (both variants). Kept for confirm-link / reject-link routes. */
export function validateClubInitData(initData: string): boolean {
  return validateClubInitDataVerbose(initData).ok;
}

/** Diagnostic-only: keys present in initData + hash length (no secret values). */
export function initDataDiag(initData: string): { keys: string[]; hashLen: number } {
  try {
    const params = new URLSearchParams(initData);
    return { keys: [...params.keys()].sort(), hashLen: (params.get("hash") ?? "").length };
  } catch {
    return { keys: [], hashLen: 0 };
  }
}

/**
 * The numeric bot id — the part BEFORE the ":" in a bot token. This is NOT a secret
 * (it is the bot's public @-account id, visible via getMe / t.me). Logging it lets us
 * confirm WHICH bot the deployed TELEGRAM_BOT_TOKEN belongs to, without exposing the
 * secret half. Returns null if the token is missing/malformed.
 */
function botIdFromToken(token: string | undefined): number | null {
  if (!token) return null;
  const head = token.split(":")[0];
  const n = Number(head);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Numeric id of the bot whose token the CLUB surface validates against. Not a secret. */
export function clubBotId(): number | null {
  return botIdFromToken(clubInitDataTokenInfo().token);
}

/** Numeric id of the MAIN bot (TELEGRAM_BOT_TOKEN) used by /m/desk and /m/n. Not a secret. */
export function mainBotId(): number | null {
  return botIdFromToken(process.env.TELEGRAM_BOT_TOKEN?.trim());
}

// --- 4-way signature probe (diagnostic) --------------------------------------
// Reimplementation A — mirrors the production path (timing-safe compare).
function probeHmacA(initData: string, token: string, dropSignature: boolean): boolean {
  try {
    const p = new URLSearchParams(initData);
    const hash = p.get("hash");
    if (!hash) return false;
    p.delete("hash");
    if (dropSignature) p.delete("signature");
    const cs = [...p.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");
    const secretKey = createHmac("sha256", "WebAppData").update(token).digest();
    const expected = createHmac("sha256", secretKey).update(cs).digest("hex");
    return safeTimingEqual(hash, expected);
  } catch {
    return false;
  }
}

// Reimplementation B — independent reference built fresh from the Telegram docs,
// plain === compare and default lexical sort (rules out a bug in the prod helpers).
function probeHmacB(initData: string, token: string, dropSignature: boolean): boolean {
  try {
    const p = new URLSearchParams(initData);
    const given = p.get("hash");
    if (!given) return false;
    const pairs: string[] = [];
    for (const [k, v] of p.entries()) {
      if (k === "hash") continue;
      if (dropSignature && k === "signature") continue;
      pairs.push(`${k}=${v}`);
    }
    pairs.sort();
    const secret = createHmac("sha256", "WebAppData").update(token).digest();
    const expected = createHmac("sha256", secret).update(pairs.join("\n")).digest("hex");
    return given === expected;
  } catch {
    return false;
  }
}

/**
 * Runs one real initData through FOUR validation variants against the CLUB token,
 * reporting which (if any) matched. Diagnostic-only — no secrets in the result.
 *  - current           : the exact production path (drops hash + signature, timing-safe)
 *  - currentWithSig     : production algo but signature KEPT in the check-string
 *  - refDropHashSig     : independent reference, drops hash + signature
 *  - refDropHashOnly    : independent reference, drops hash only
 * If `current` is false but `refDropHashSig` is true → bug in the production helper.
 * If a *WithSig / *HashOnly variant is the only match → signature must NOT be dropped.
 * If all four are false → the token is the wrong bot (compare botId) or data is stale.
 */
export function clubSignatureProbe(initData: string): {
  botId: number | null;
  current: boolean;
  currentWithSig: boolean;
  refDropHashSig: boolean;
  refDropHashOnly: boolean;
} {
  const token = clubInitDataTokenInfo().token;
  const botId = botIdFromToken(token);
  if (!token) {
    return { botId, current: false, currentWithSig: false, refDropHashSig: false, refDropHashOnly: false };
  }
  return {
    botId,
    // literal production club path (drops signature)
    current: validateTelegramInitDataWithToken(initData, token, { dropSignature: true }),
    currentWithSig: probeHmacA(initData, token, false),
    refDropHashSig: probeHmacB(initData, token, true),
    refDropHashOnly: probeHmacB(initData, token, false),
  };
}

export type TelegramInitDataUser = {
  id: number;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  /** Telegram-hosted avatar URL from initData (short-lived). Present regardless of whether the user
   *  started the bot — the club avatar capture downloads it as a fallback to getUserProfilePhotos. */
  photoUrl: string | null;
};

export function parseTelegramInitDataUser(initData: string): TelegramInitDataUser | null {
  try {
    const params = new URLSearchParams(initData);
    const userRaw = params.get("user");
    if (!userRaw) return null;
    const user = JSON.parse(userRaw) as unknown;
    if (typeof user !== "object" || user === null) return null;
    const u = user as Record<string, unknown>;
    if (typeof u.id !== "number") return null;
    return {
      id: u.id,
      firstName: typeof u.first_name === "string" ? u.first_name : null,
      lastName: typeof u.last_name === "string" ? u.last_name : null,
      username: typeof u.username === "string" ? u.username : null,
      photoUrl: typeof u.photo_url === "string" ? u.photo_url : null,
    };
  } catch {
    return null;
  }
}

/**
 * Extracts the `start_param` from initData (the Mini App direct-link payload,
 * i.e. the `?startapp=<value>` from the t.me deep link).
 *
 * SECURITY: pass only a string that has ALREADY passed validateTelegramInitData.
 * `start_param` is part of the HMAC-signed initData (it is included in the hash
 * check), so once the hash verifies, start_param is tamper-proof — no extra
 * signature is needed. Never read it from `initDataUnsafe` on the client.
 */
export function parseTelegramInitDataStartParam(initData: string): string | null {
  try {
    const params = new URLSearchParams(initData);
    const value = params.get("start_param");
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}
