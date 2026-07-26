// Club Mini App — one-time binding tokens. Server-side (service_role). The club
// entry link carries an opaque token (not the student row id); it resolves to a
// student, is confirmed by name, and BURNS on successful bind or expiry. See
// migration 20260728000000_club_link_tokens.sql. Nothing here sends to students.

import { randomBytes } from "node:crypto";

import { createSupabaseServerClient } from "@/features/supabase/server";

/** Token TTL in days (config, default 7). */
export function clubLinkTokenTtlDays(): number {
  const raw = Number(process.env.CLUB_LINK_TOKEN_TTL_DAYS ?? "7");
  return Number.isFinite(raw) && raw > 0 ? raw : 7;
}

/** 32 hex chars — startapp-safe ([0-9a-f]), unguessable. */
function generateToken(): string {
  return randomBytes(16).toString("hex");
}

export type ClubTokenResolution =
  | { ok: true; studentId: string; displayName: string }
  | { ok: false; reason: "not_found" | "used" | "expired" | "revoked" };

/**
 * Resolve a token to its student WITHOUT burning it (used by the non-binding peek).
 * Invalid tokens return a reason so the client can show «ссылка недействительна».
 * Never exposes anything but the student's name.
 */
export async function resolveClubLinkToken(token: string): Promise<ClubTokenResolution> {
  const clean = (token ?? "").trim();
  if (!clean) return { ok: false, reason: "not_found" };
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("club_link_tokens")
    .select("student_id, expires_at, used_at, revoked_at")
    .eq("token", clean)
    .maybeSingle();
  if (error || !data) return { ok: false, reason: "not_found" };
  const row = data as { student_id: string; expires_at: string; used_at: string | null; revoked_at: string | null };
  if (row.revoked_at) return { ok: false, reason: "revoked" };
  if (row.used_at) return { ok: false, reason: "used" };
  if (new Date(row.expires_at).getTime() <= Date.now()) return { ok: false, reason: "expired" };

  let displayName = "Участник клуба";
  const { data: student } = await supabase
    .from("trainingpeaks_students")
    .select("student_name")
    .eq("id", row.student_id)
    .maybeSingle();
  const name = (student as { student_name: string } | null)?.student_name;
  if (name && name.trim()) displayName = name.replace(/\s+/gu, " ").trim();
  return { ok: true, studentId: row.student_id, displayName };
}

/**
 * Burn a token on successful bind — compare-and-swap: only flips a token that is
 * STILL valid (unused, unrevoked, unexpired). Returns true if this call burned it.
 */
export async function burnClubLinkToken(token: string, telegramUserId: number | null): Promise<boolean> {
  const clean = (token ?? "").trim();
  if (!clean) return false;
  const supabase = createSupabaseServerClient();
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("club_link_tokens")
    .update({ used_at: nowIso, used_by_telegram_user_id: telegramUserId })
    .eq("token", clean)
    .is("used_at", null)
    .is("revoked_at", null)
    .gt("expires_at", nowIso)
    .select("id");
  if (error) return false;
  return Array.isArray(data) && data.length > 0;
}

export type CreatedClubToken = { token: string; expiresAt: string };

/** Generate a fresh one-time token for a student. */
export async function createClubLinkToken(studentId: string, createdBy: string): Promise<CreatedClubToken> {
  const supabase = createSupabaseServerClient();
  const token = generateToken();
  const expiresAt = new Date(Date.now() + clubLinkTokenTtlDays() * 86_400_000).toISOString();
  const { error } = await supabase.from("club_link_tokens").insert({
    token,
    student_id: studentId,
    expires_at: expiresAt,
    created_by: createdBy,
  });
  if (error) throw new Error(`club: create link token: ${error.message}`);
  return { token, expiresAt };
}

/** Coach revoke — kill a token so its link stops working. */
export async function revokeClubLinkToken(tokenId: string): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("club_link_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", tokenId)
    .is("used_at", null)
    .is("revoked_at", null);
  if (error) throw new Error(`club: revoke link token: ${error.message}`);
}

export type ActiveTokenRow = { id: string; token: string; expiresAt: string };

/** Active (unused, unrevoked, unexpired) tokens for a student — newest first. */
export async function listActiveClubLinkTokens(studentId: string): Promise<ActiveTokenRow[]> {
  const supabase = createSupabaseServerClient();
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("club_link_tokens")
    .select("id, token, expires_at")
    .eq("student_id", studentId)
    .is("used_at", null)
    .is("revoked_at", null)
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false });
  if (error) return [];
  return ((data as Array<{ id: string; token: string; expires_at: string }>) ?? []).map((r) => ({
    id: r.id,
    token: r.token,
    expiresAt: r.expires_at,
  }));
}

/** All active tokens grouped by student — one query for the admin list. */
export async function listAllActiveClubLinkTokens(): Promise<Map<string, ActiveTokenRow[]>> {
  const out = new Map<string, ActiveTokenRow[]>();
  const supabase = createSupabaseServerClient();
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("club_link_tokens")
    .select("id, token, expires_at, student_id")
    .is("used_at", null)
    .is("revoked_at", null)
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false });
  if (error) return out;
  for (const r of (data as Array<{ id: string; token: string; expires_at: string; student_id: string }>) ?? []) {
    const list = out.get(r.student_id) ?? [];
    list.push({ id: r.id, token: r.token, expiresAt: r.expires_at });
    out.set(r.student_id, list);
  }
  return out;
}
