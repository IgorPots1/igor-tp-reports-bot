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
      username: typeof u.username === "string" ? u.username : null,
    };
  } catch {
    return null;
  }
}

/**
 * Student-link signature for mini-app auto-binding.
 *
 * The "Open form" button Igor sends carries the target studentId in the URL.
 * To stop a student from opening the form with someone else's studentId, the
 * studentId is HMAC-signed with the bot token (which only the server knows).
 * The mini app echoes sid+sig back; the server re-derives the signature and
 * compares before auto-linking the student's Telegram user.id.
 */
const STUDENT_LINK_SIG_PREFIX = "miniapp-link:";
const STUDENT_LINK_SIG_LENGTH = 32;

export function signStudentLinkWithToken(studentId: string, botToken: string): string {
  return createHmac("sha256", botToken)
    .update(STUDENT_LINK_SIG_PREFIX + studentId)
    .digest("hex")
    .slice(0, STUDENT_LINK_SIG_LENGTH);
}

export function verifyStudentLinkSigWithToken(
  studentId: string,
  sig: string,
  botToken: string
): boolean {
  if (!studentId || !sig) return false;
  const expected = signStudentLinkWithToken(studentId, botToken);
  return safeTimingEqual(sig, expected);
}

export function signStudentLink(studentId: string): string {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  return signStudentLinkWithToken(studentId, token);
}

export function verifyStudentLinkSig(studentId: string, sig: string): boolean {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return false;
  return verifyStudentLinkSigWithToken(studentId, sig, token);
}
