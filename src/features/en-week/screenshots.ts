/* Workout screenshots from the plan page (Garmin, Strava, Apple Fitness...): pure checks.
 *
 * REUSED from the Russian Intervals plan page, not rebuilt:
 *   - the same private bucket, intervals-checkin-files (migration 20261111000000_intervals_plan_page.sql:
 *     public = false, 5 MB, image/jpeg|png|webp only), under its own prefix en-week/<user id>/...;
 *   - the same transport: the browser shrinks the image to max 1600 px JPEG 0.85 and sends a
 *     data URL (src/app/plan/[slug]/[token]/PlanView.tsx shrinkToDataUrl);
 *   - the same server checks: DATA_URL_RE and MAX_FILE_BYTES of
 *     src/features/intervals/plan-page/actions.ts (check:en-week compares them);
 *   - signed URLs only, 6 hours (view.ts SIGNED_URL_TTL_SECONDS).
 * Differences: up to 3 images per workout (Igor, 28.10.2026), and the person can only attach to
 * their own sessions (token-scoped, see service.ts). No coach notification for uploads. */

export const SCREENSHOT_PREFIX = "en-week";
export const MAX_SCREENSHOTS_PER_SESSION = 3;
export const DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const SIGNED_URL_TTL_SECONDS = 60 * 60 * 6;

export type ParsedImage = { mime: "image/jpeg" | "image/png" | "image/webp"; ext: "jpg" | "png" | "webp"; bytes: Buffer };

export type ImageCheck = { ok: true; image: ParsedImage } | { ok: false; error: "type" | "size" };

export function parseImageDataUrl(dataUrl: unknown): ImageCheck {
  const m = typeof dataUrl === "string" ? DATA_URL_RE.exec(dataUrl) : null;
  if (!m) return { ok: false, error: "type" };
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length === 0) return { ok: false, error: "type" };
  if (bytes.length > MAX_FILE_BYTES) return { ok: false, error: "size" };
  const mime = m[1] as ParsedImage["mime"];
  return { ok: true, image: { mime, ext: mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg", bytes } };
}

/** Storage path: always under the owner's id and the session, a random file name. */
export function screenshotPath(userId: string, idx: number, ext: string, id: string): string {
  return `${SCREENSHOT_PREFIX}/${userId}/${idx}/${id}.${ext}`;
}

export type Screenshot = { id: string; idx: number; path: string };
export type ScreenshotView = { id: string; url: string };
