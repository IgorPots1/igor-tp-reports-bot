/* Supabase store of the free week (tables en_week_*, service role). */

import { createSupabaseServerClient, describeSupabaseError } from "@/features/supabase/server";

import { CHECKIN_FILE_BUCKET } from "@/features/intervals/plan-page/view";

import type { EnWeekSession, EnWeekUser } from "./model";
import { SIGNED_URL_TTL_SECONDS, screenshotPath, type Screenshot } from "./screenshots";
import type { EnWeekStore, NewUser } from "./service";

const USERS = "en_week_users";
const SESSIONS = "en_week_sessions";
const EVENTS = "en_week_events";
const SHOTS = "en_week_screenshots";

const SESSION_COLUMNS = "idx, date, kind, preset_code, rung, title, body_en, minutes, checkin, checkin_at";

function fail(where: string, error: unknown): never {
  throw new Error(`[en-week] ${where}: ${describeSupabaseError(error)}`);
}

function toSession(r: Record<string, unknown>): EnWeekSession {
  return {
    idx: Number(r.idx),
    date: String(r.date),
    kind: r.kind as EnWeekSession["kind"],
    preset_code: String(r.preset_code),
    rung: r.rung === null || r.rung === undefined ? null : Number(r.rung),
    title: String(r.title),
    body_en: String(r.body_en),
    minutes: Number(r.minutes),
    checkin: (r.checkin as EnWeekSession["checkin"]) ?? null,
    checkin_at: (r.checkin_at as string | null) ?? null,
  };
}

export function supabaseEnWeekStore(): EnWeekStore {
  const db = createSupabaseServerClient();
  return {
    async findByClient(clientId) {
      const { data, error } = await db
        .from(USERS)
        .select("*")
        .eq("chatplace_client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) fail("findByClient", error);
      return (data as EnWeekUser | null) ?? null;
    },
    async findByToken(token) {
      const { data, error } = await db.from(USERS).select("*").eq("token", token).maybeSingle();
      if (error) fail("findByToken", error);
      return (data as EnWeekUser | null) ?? null;
    },
    async insertUser(row: NewUser) {
      const { data, error } = await db.from(USERS).insert(row).select("*").single();
      if (error) fail("insertUser", error);
      return data as EnWeekUser;
    },
    async updateUser(id, patch) {
      const { error } = await db.from(USERS).update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) fail("updateUser", error);
    },
    async getSessions(userId) {
      const { data, error } = await db.from(SESSIONS).select(SESSION_COLUMNS).eq("user_id", userId).order("idx");
      if (error) fail("getSessions", error);
      return ((data ?? []) as Record<string, unknown>[]).map(toSession);
    },
    async saveSessions(userId, rows) {
      const now = new Date().toISOString();
      const { error } = await db
        .from(SESSIONS)
        .upsert(rows.map((s) => ({ ...s, user_id: userId, updated_at: now })), { onConflict: "user_id,idx" });
      if (error) fail("saveSessions", error);
    },
    async claimKey(userId, key, kind, meta) {
      const { error } = await db.from(EVENTS).insert({ user_id: userId, kind, dedupe_key: key, meta: meta ?? {} });
      if (!error) return true;
      if ((error as { code?: string }).code === "23505") return false;
      fail("claimKey", error);
    },
    async addScreenshot(userId, idx, image) {
      const id = crypto.randomUUID();
      const path = screenshotPath(userId, idx, image.ext, id);
      const up = await db.storage.from(CHECKIN_FILE_BUCKET).upload(path, image.bytes, { contentType: image.mime, upsert: false });
      if (up.error) fail("screenshot upload", up.error);
      const { error } = await db.from(SHOTS).insert({ id, user_id: userId, session_idx: idx, path, bytes: image.bytes.length });
      if (error) {
        await db.storage.from(CHECKIN_FILE_BUCKET).remove([path]);
        fail("screenshot row", error);
      }
      return { id, idx, path };
    },
    async listScreenshots(userId) {
      const { data, error } = await db.from(SHOTS).select("id, session_idx, path").eq("user_id", userId).order("created_at");
      if (error) fail("listScreenshots", error);
      return ((data ?? []) as Array<{ id: string; session_idx: number; path: string }>).map((r): Screenshot => ({ id: r.id, idx: r.session_idx, path: r.path }));
    },
    async deleteScreenshot(userId, id) {
      const { data, error } = await db.from(SHOTS).delete().eq("user_id", userId).eq("id", id).select("path");
      if (error) fail("deleteScreenshot", error);
      const paths = ((data ?? []) as Array<{ path: string }>).map((r) => r.path);
      if (paths.length) await db.storage.from(CHECKIN_FILE_BUCKET).remove(paths);
      return paths.length > 0;
    },
    async signScreenshotUrls(paths) {
      if (!paths.length) return {};
      const { data, error } = await db.storage.from(CHECKIN_FILE_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
      if (error) {
        console.error(`[en-week] sign: ${describeSupabaseError(error)}`);
        return {};
      }
      const out: Record<string, string> = {};
      for (const r of data ?? []) if (r.path && r.signedUrl) out[r.path] = r.signedUrl;
      return out;
    },
    async logEvent(userId, kind, meta) {
      const { error } = await db.from(EVENTS).insert({ user_id: userId, kind, meta: meta ?? {} });
      // Funnel events never break the person's flow.
      if (error) console.error(`[en-week] event ${kind}: ${describeSupabaseError(error)}`);
    },
  };
}
