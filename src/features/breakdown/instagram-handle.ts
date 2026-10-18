/**
 * Instagram handle passed by the ChatPlace button (?u={{ username }}), without "@".
 * Instagram allows 1-30 letters, digits, dots and underscores. Anything else is null,
 * including a placeholder ChatPlace failed to fill in ("{{ username }}").
 */
export function instagramHandle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const handle = value.trim().replace(/^@/u, "").toLowerCase();
  return /^[a-z0-9._]{1,30}$/u.test(handle) ? handle : null;
}
