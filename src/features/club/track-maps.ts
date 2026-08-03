import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { CLUB_TRACK_MAPS_BUCKET, clubMapboxToken } from "@/features/club/constants";
import { createSupabaseServerClient } from "@/features/supabase/server";

// Club maps (Phase 4b). The stored track polyline (already privacy-cropped) is rendered on a
// Mapbox STATIC image and reverse-geocoded to a city. Both are fetched ONCE per track and
// cached (image in a PRIVATE Storage bucket, city on the row); the cache key is the polyline
// hash so a recompute (re-ingest / radius change) rebuilds instead of serving a stale route.
// The Mapbox token is server-side only — the browser sees our proxy path, never Mapbox or the
// token. The image route is authorised by a short-lived HMAC signature minted by the authed
// feed (an <img> GET cannot carry Telegram initData), plus a live club_routes_visible check.

const MAPBOX_STYLE = "mapbox/light-v11";
const MAPBOX_IMAGE_SIZE = "600x300@2x";
const MAPBOX_ROUTE_STYLE = "path-5+2563eb-0.9"; // width 5, colour #2563eb, opacity 0.9 (Run Club)
const GEOCODE_TIMEOUT_MS = 3000;
const IMAGE_TIMEOUT_MS = 8000;
// Signature bucketed to the DAY so every mint within the day yields the SAME URL (the browser
// caches it across feed re-opens). Was hourly until 2026-08-03: with a 1h bucket and a 1h browser
// max-age the same PNG was re-downloaded from Storage once per user per hour, which is what blew
// the Supabase egress quota. Daily is safe here because the URL is CONTENT-ADDRESSED
// (?h=<polylineHash>): a re-ingest or a privacy-radius change alters the hash, hence the URL, so a
// rebuilt track invalidates instantly regardless of the time bucket.
//
// Validity must outlive bucket + browser max-age, so a URL minted at the start of a bucket is
// still valid on its last cached use — otherwise tiles break near the boundary.
const SIGNATURE_BUCKET_SECONDS = 86400;
const SIGNATURE_VALID_SECONDS = 172800;

type LatLng = [number, number];

function asPolyline(value: unknown): LatLng[] | null {
  if (!Array.isArray(value)) return null;
  const out: LatLng[] = [];
  for (const p of value) {
    if (Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])) {
      out.push([Number(p[0]), Number(p[1])]);
    }
  }
  return out.length >= 2 ? out : null;
}

/** Cache key: a recompute of the same track (re-ingest / new privacy radius) changes the
 *  polyline, hence the hash, forcing city + image to rebuild rather than serving the old route. */
export function polylineHash(polyline: LatLng[]): string {
  return createHash("sha256").update(JSON.stringify(polyline)).digest("hex").slice(0, 16);
}

/** Google polyline encode, precision 5 — the format a Mapbox `path(...)` overlay accepts. */
export function encodePolyline(points: LatLng[]): string {
  let lastLat = 0;
  let lastLng = 0;
  let out = "";
  const enc = (value: number): string => {
    let s = value < 0 ? ~(value << 1) : value << 1;
    let r = "";
    while (s >= 0x20) {
      r += String.fromCharCode((0x20 | (s & 0x1f)) + 63);
      s >>= 5;
    }
    r += String.fromCharCode(s + 63);
    return r;
  };
  for (const [lat, lng] of points) {
    const iLat = Math.round(lat * 1e5);
    const iLng = Math.round(lng * 1e5);
    out += enc(iLat - lastLat) + enc(iLng - lastLng);
    lastLat = iLat;
    lastLng = iLng;
  }
  return out;
}

function buildMapboxStaticUrl(polyline: LatLng[], token: string): string | null {
  if (polyline.length < 2) return null;
  const overlay = encodeURIComponent(encodePolyline(polyline));
  return (
    `https://api.mapbox.com/styles/v1/${MAPBOX_STYLE}/static/${MAPBOX_ROUTE_STYLE}(${overlay})` +
    `/auto/${MAPBOX_IMAGE_SIZE}?padding=80&logo=false&attribution=false&access_token=${token}`
  );
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── signed image URLs ────────────────────────────────────────────────────────
// Minted only server-side (in the authed feed/detail). The secret is the service-role key,
// which never leaves the server, so a URL cannot be forged. The route also re-checks
// club_routes_visible live, so revoking visibility takes effect immediately.

function signingSecret(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
}

/** Stable-per-day, content-addressed signed path. The polyline hash in the URL cache-busts a
 *  recompute; the day-bucketed expiry keeps the URL identical within the day so the browser
 *  caches the image instead of re-fetching on every feed open. */
export function signTrackImagePath(workoutCacheId: string, polyline: LatLng[]): string {
  const hash = polylineHash(polyline);
  const bucketStart = Math.floor(Date.now() / 1000 / SIGNATURE_BUCKET_SECONDS) * SIGNATURE_BUCKET_SECONDS;
  const exp = bucketStart + SIGNATURE_VALID_SECONDS;
  const sig = createHmac("sha256", signingSecret()).update(`${workoutCacheId}:${hash}:${exp}`).digest("hex").slice(0, 32);
  return `/api/m/club/track-image/${encodeURIComponent(workoutCacheId)}?h=${hash}&e=${exp}&s=${sig}`;
}

export function verifyTrackImageSignature(
  workoutCacheId: string,
  hash: string | null,
  exp: string | null,
  sig: string | null
): boolean {
  if (!hash || !exp || !sig) return false;
  const expNum = Number(exp);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(expNum) || expNum < now || expNum > now + SIGNATURE_VALID_SECONDS + SIGNATURE_BUCKET_SECONDS) {
    return false;
  }
  const expected = createHmac("sha256", signingSecret()).update(`${workoutCacheId}:${hash}:${expNum}`).digest("hex").slice(0, 32);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type TrackImageResult =
  | { kind: "ok"; bytes: ArrayBuffer }
  | { kind: "forbidden" }
  | { kind: "none" };

/**
 * Serve (and lazily render + cache) the Mapbox static image for one workout's route.
 * 403 (forbidden) if the owner turned routes off; none if no token/track/render. Cached in the
 * private bucket at `<workout_cache_id>.png`, keyed by polyline hash (map_hash) for invalidation.
 */
export async function getTrackImage(workoutCacheId: string): Promise<TrackImageResult> {
  const token = clubMapboxToken();
  if (!token) return { kind: "none" };
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trainingpeaks_workout_tracks")
    .select("student_id, polyline, map_hash, city, city_hash, trainingpeaks_students(club_routes_visible)")
    .eq("workout_cache_id", workoutCacheId)
    .maybeSingle();
  if (error || !data) return { kind: "none" };
  const row = data as unknown as {
    polyline: unknown;
    map_hash: string | null;
    city: string | null;
    city_hash: string | null;
    // PostgREST types an embedded to-one as an array; normalise below.
    trainingpeaks_students:
      | { club_routes_visible: boolean | null }
      | Array<{ club_routes_visible: boolean | null }>
      | null;
  };
  const owner = Array.isArray(row.trainingpeaks_students)
    ? row.trainingpeaks_students[0]
    : row.trainingpeaks_students;
  if (owner?.club_routes_visible === false) return { kind: "forbidden" };
  const polyline = asPolyline(row.polyline);
  if (!polyline) return { kind: "none" };
  const hash = polylineHash(polyline);
  const path = `${workoutCacheId}.png`;

  if (row.map_hash === hash) {
    const dl = await supabase.storage.from(CLUB_TRACK_MAPS_BUCKET).download(path);
    if (!dl.error && dl.data) return { kind: "ok", bytes: await dl.data.arrayBuffer() };
    // marker set but object missing (purged / never uploaded) → fall through and rebuild
  }

  const url = buildMapboxStaticUrl(polyline, token);
  if (!url) return { kind: "none" };
  let resp: Response;
  try {
    resp = await fetchWithTimeout(url, IMAGE_TIMEOUT_MS);
  } catch {
    return { kind: "none" };
  }
  if (!resp.ok) return { kind: "none" };
  const bytes = await resp.arrayBuffer();
  await supabase.storage.from(CLUB_TRACK_MAPS_BUCKET).upload(path, bytes, { upsert: true, contentType: "image/png" });
  await supabase.from("trainingpeaks_workout_tracks").update({ map_hash: hash }).eq("workout_cache_id", workoutCacheId);
  // Piggyback the city on the one-time image generation (no extra call once cached); the feed
  // then reads the cached city from the row on the next load.
  await resolveTrackCity({ workoutCacheId, polyline, city: row.city, cityHash: row.city_hash });
  return { kind: "ok", bytes };
}

/** Reverse-geocode the route's city, cached on the row (keyed by polyline hash). Samples a
 *  mid-route point — home is already cropped, so the city is unchanged but no address leaks. */
export async function resolveTrackCity(input: {
  workoutCacheId: string;
  polyline: LatLng[];
  city: string | null;
  cityHash: string | null;
}): Promise<string | null> {
  const hash = polylineHash(input.polyline);
  if (input.city && input.cityHash === hash) return input.city;
  const token = clubMapboxToken();
  if (!token || input.polyline.length === 0) return input.city ?? null;
  const mid = input.polyline[Math.floor(input.polyline.length / 2)]!;
  const [lat, lng] = mid;
  let city: string | null = null;
  try {
    const url =
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json` +
      `?types=place&limit=1&language=ru&access_token=${token}`;
    const resp = await fetchWithTimeout(url, GEOCODE_TIMEOUT_MS);
    if (resp.ok) {
      const body = (await resp.json()) as { features?: Array<{ text?: string }> };
      city = body.features?.[0]?.text ?? null;
    }
  } catch {
    /* transient → keep whatever we had */
  }
  if (city) {
    const supabase = createSupabaseServerClient();
    await supabase
      .from("trainingpeaks_workout_tracks")
      .update({ city, city_hash: hash })
      .eq("workout_cache_id", input.workoutCacheId);
  }
  return city ?? input.city ?? null;
}

/**
 * Opt-out = REMOVED, not hidden: delete a student's cached route images from Storage and clear
 * map_hash. The cropped polyline row is kept (gated) so re-enabling can regenerate. Called when
 * club_routes_visible flips to false.
 */
export async function purgeStudentRouteImages(studentId: string): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("trainingpeaks_workout_tracks")
    .select("workout_cache_id")
    .eq("student_id", studentId);
  const ids = ((data as Array<{ workout_cache_id: string }> | null) ?? []).map((r) => r.workout_cache_id);
  if (ids.length === 0) return;
  const paths = ids.map((id) => `${id}.png`);
  for (let i = 0; i < paths.length; i += 100) {
    await supabase.storage.from(CLUB_TRACK_MAPS_BUCKET).remove(paths.slice(i, i + 100));
  }
  await supabase.from("trainingpeaks_workout_tracks").update({ map_hash: null }).eq("student_id", studentId);
}
