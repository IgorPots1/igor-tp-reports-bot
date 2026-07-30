import { createHmac, timingSafeEqual } from "node:crypto";

import { isClubAvatarsEnabled } from "@/features/club/constants";
import { createSupabaseServerClient } from "@/features/supabase/server";
import { downloadTelegramFile, getTelegramUserProfilePhotoFileId } from "@/features/telegram/telegram-client";

// Club member avatars from Telegram. Same shape as the route maps (track-maps.ts): the SHORT-LIVED
// Telegram URL is never stored — we download the image bytes into a PRIVATE bucket and serve them
// through our own auth-gated route. The <img> tag only ever hits our proxy with an HMAC-signed URL;
// the bot token and the Telegram CDN never reach the browser. A per-student opt-out
// (club_avatar_visible) removes the image; a weekly re-check (club_avatar_checked_at) picks up a
// changed photo without hammering the Bot API.

const CLUB_AVATARS_BUCKET = "club-avatars";
const SIGNATURE_BUCKET_SECONDS = 3600; // hour-bucketed so the signed URL is stable within the hour
const SIGNATURE_VALID_SECONDS = 90000; // ~25h validity → the browser can cache the image
const REFRESH_MS = 7 * 24 * 60 * 60 * 1000; // re-check Telegram at most once a week
const IMAGE_CONTENT_TYPE = "image/jpeg"; // Telegram profile photos are JPEG

function signingSecret(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
}

/** Stable-per-hour signed proxy URL for a student's avatar. No content hash (one photo per student);
 *  the hour-bucketed expiry keeps the URL identical within the hour so the browser caches the image. */
export function signAvatarPath(studentId: string): string {
  const hourStart = Math.floor(Date.now() / 1000 / SIGNATURE_BUCKET_SECONDS) * SIGNATURE_BUCKET_SECONDS;
  const exp = hourStart + SIGNATURE_VALID_SECONDS;
  const sig = createHmac("sha256", signingSecret()).update(`${studentId}:${exp}`).digest("hex").slice(0, 32);
  return `/api/m/club/avatar/${encodeURIComponent(studentId)}?e=${exp}&s=${sig}`;
}

export function verifyAvatarSignature(studentId: string, exp: string | null, sig: string | null): boolean {
  if (!exp || !sig) return false;
  const expNum = Number(exp);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(expNum) || expNum < now || expNum > now + SIGNATURE_VALID_SECONDS + SIGNATURE_BUCKET_SECONDS) {
    return false;
  }
  const expected = createHmac("sha256", signingSecret()).update(`${studentId}:${expNum}`).digest("hex").slice(0, 32);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The Telegram user id linked to a club student, or null. The link lives on
 *  trainingpeaks_students.telegram_user_id (set by auto-linking) — NOT on club_access_requests,
 *  whose student_id is often null after auto-link. Querying the wrong one returned null for everyone,
 *  so avatars silently never resolved. */
export async function resolveStudentTelegramUserId(studentId: string): Promise<number | null> {
  try {
    const supabase = createSupabaseServerClient();
    const { data } = await supabase
      .from("trainingpeaks_students")
      .select("telegram_user_id")
      .eq("id", studentId)
      .maybeSingle();
    const id = Number((data as { telegram_user_id: number | null } | null)?.telegram_user_id ?? 0);
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

export type AvatarImageResult =
  | { kind: "ok"; bytes: ArrayBuffer }
  | { kind: "forbidden" }
  | { kind: "none" };

function bufferToArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/** Download the largest Telegram profile photo for a user and cache it in the bucket. Returns the
 *  bytes on success, or null (no photo / API error / not started the bot). Never throws. */
async function fetchAndCacheFromTelegram(studentId: string, userId: number): Promise<ArrayBuffer | null> {
  try {
    const fileId = await getTelegramUserProfilePhotoFileId(userId);
    if (!fileId) return null;
    // downloadTelegramFile takes a file_id and resolves the (short-lived) file_path itself.
    const buf = await downloadTelegramFile(fileId);
    if (!buf || buf.byteLength === 0) return null;
    const bytes = bufferToArrayBuffer(buf);
    const supabase = createSupabaseServerClient();
    await supabase.storage.from(CLUB_AVATARS_BUCKET).upload(`${studentId}.jpg`, bytes, { upsert: true, contentType: IMAGE_CONTENT_TYPE });
    await supabase
      .from("trainingpeaks_students")
      .update({ club_avatar_path: `${studentId}.jpg`, club_avatar_checked_at: new Date().toISOString() })
      .eq("id", studentId);
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Serve (and lazily fetch + cache) a student's Telegram avatar. forbidden if the student opted out;
 * none if there is no photo / feature off. Cached in the private bucket at `<studentId>.jpg`;
 * re-checked against Telegram at most once a week (club_avatar_checked_at).
 */
export async function getAvatarImage(studentId: string): Promise<AvatarImageResult> {
  if (!isClubAvatarsEnabled()) return { kind: "none" };
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .select("club_avatar_visible, club_avatar_path, club_avatar_checked_at")
    .eq("id", studentId)
    .maybeSingle();
  if (error || !data) return { kind: "none" };
  const row = data as { club_avatar_visible: boolean | null; club_avatar_path: string | null; club_avatar_checked_at: string | null };
  if (row.club_avatar_visible === false) return { kind: "forbidden" };

  const checkedAt = row.club_avatar_checked_at ? Date.parse(row.club_avatar_checked_at) : NaN;
  const fresh = Number.isFinite(checkedAt) && Date.now() - checkedAt < REFRESH_MS;

  // Fresh cache hit → serve the stored bytes without touching Telegram.
  if (row.club_avatar_path && fresh) {
    const dl = await supabase.storage.from(CLUB_AVATARS_BUCKET).download(row.club_avatar_path);
    if (!dl.error && dl.data) return { kind: "ok", bytes: await dl.data.arrayBuffer() };
    // marker set but object missing (purged) → fall through and refetch
  }

  // Stale or missing → re-check Telegram (weekly throttle). On success, serve the fresh bytes.
  const userId = await resolveStudentTelegramUserId(studentId);
  if (userId) {
    const fetched = await fetchAndCacheFromTelegram(studentId, userId);
    if (fetched) return { kind: "ok", bytes: fetched };
  }
  // No new photo. Throttle the next re-check regardless, and keep serving an old cached image if any.
  await supabase.from("trainingpeaks_students").update({ club_avatar_checked_at: new Date().toISOString() }).eq("id", studentId);
  if (row.club_avatar_path) {
    const dl = await supabase.storage.from(CLUB_AVATARS_BUCKET).download(row.club_avatar_path);
    if (!dl.error && dl.data) return { kind: "ok", bytes: await dl.data.arrayBuffer() };
  }
  return { kind: "none" };
}

/** True only for a Telegram-hosted https photo URL (t.me / *.telesco.pe / *.telegram.org). The
 *  initData is already HMAC-validated by the caller, so photo_url is trustworthy; this is a
 *  belt-and-braces SSRF guard so we never fetch an arbitrary host. */
function isTelegramPhotoUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    return u.hostname === "t.me" || /(^|\.)(telesco\.pe|telegram\.org|cdn-telegram\.org)$/i.test(u.hostname);
  } catch {
    return false;
  }
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * SECOND avatar source (naryad §1): the current student's photo_url from initData, captured on
 * mini-app open. Unlike getUserProfilePhotos (Bot API — only for those who started the bot), initData
 * carries photo_url regardless, so it fills the gap for the ~half who have no Bot-API photo. Downloads
 * into the SAME private bucket, honours the SAME opt-out, and re-checks at most weekly. Fires only for
 * the caller's OWN student id (initData holds only their photo). Best-effort — never throws.
 */
export async function captureAvatarFromInitData(studentId: string, photoUrl: string | null): Promise<void> {
  if (!isClubAvatarsEnabled() || !studentId || !photoUrl || !isTelegramPhotoUrl(photoUrl)) return;
  try {
    const supabase = createSupabaseServerClient();
    const { data } = await supabase
      .from("trainingpeaks_students")
      .select("club_avatar_visible, club_avatar_path, club_avatar_checked_at")
      .eq("id", studentId)
      .maybeSingle();
    const row = data as { club_avatar_visible: boolean | null; club_avatar_path: string | null; club_avatar_checked_at: string | null } | null;
    if (!row || row.club_avatar_visible === false) return;
    const checkedAt = row.club_avatar_checked_at ? Date.parse(row.club_avatar_checked_at) : NaN;
    const fresh = Number.isFinite(checkedAt) && Date.now() - checkedAt < REFRESH_MS;
    // Have a cached image AND it is fresh → nothing to do (the weekly re-check keeps it current).
    // Otherwise (no image yet — the Bot-API gap — or stale) capture from initData.
    if (row.club_avatar_path && fresh) return;
    const resp = await fetchWithTimeout(photoUrl, 8000);
    if (!resp.ok) return;
    const bytes = await resp.arrayBuffer();
    if (bytes.byteLength === 0) return;
    await supabase.storage.from(CLUB_AVATARS_BUCKET).upload(`${studentId}.jpg`, bytes, { upsert: true, contentType: IMAGE_CONTENT_TYPE });
    await supabase
      .from("trainingpeaks_students")
      .update({ club_avatar_path: `${studentId}.jpg`, club_avatar_checked_at: new Date().toISOString() })
      .eq("id", studentId);
  } catch {
    /* transient (network / storage) — try again on the next open */
  }
}

/** Opt-out cleanup: delete the cached avatar image and clear the pointer (mirrors purgeStudentRouteImages). */
export async function purgeStudentAvatar(studentId: string): Promise<void> {
  const supabase = createSupabaseServerClient();
  try {
    await supabase.storage.from(CLUB_AVATARS_BUCKET).remove([`${studentId}.jpg`]);
  } catch {
    /* best-effort: the live club_avatar_visible=false already blocks the route */
  }
  await supabase.from("trainingpeaks_students").update({ club_avatar_path: null, club_avatar_checked_at: null }).eq("id", studentId);
}
