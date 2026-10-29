/* ChatPlace → /api/en-week/{today,checkin,status}: header x-en-week-key, compared with
 * EN_WEEK_API_KEY in constant time. No key configured → every call is refused. */

import { createHash, timingSafeEqual } from "node:crypto";

export const KEY_HEADER = "x-en-week-key";

/** Hashing first makes both sides 32 bytes, so the comparison is constant-time regardless of length. */
export function keyMatches(given: string | null | undefined, expected: string | null | undefined): boolean {
  const g = (given ?? "").trim();
  const e = (expected ?? "").trim();
  if (!g || !e) return false;
  const a = createHash("sha256").update(g).digest();
  const b = createHash("sha256").update(e).digest();
  return timingSafeEqual(a, b);
}

export function isAuthorizedEnWeek(request: Request, env: Record<string, string | undefined> = process.env): boolean {
  return keyMatches(request.headers.get(KEY_HEADER), env.EN_WEEK_API_KEY);
}
