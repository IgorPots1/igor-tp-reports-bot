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
export function validateTelegramInitDataWithToken(initData: string, botToken: string): boolean {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return false;
    params.delete("hash");

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

export type TelegramInitDataUser = {
  id: number;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
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
