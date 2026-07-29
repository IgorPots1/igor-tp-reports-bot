// Club — outbound FORM broadcasts from the admin (first outbound path of the club).
//
// A BROADCAST is a coach tap that sends N students a short bot DM with a deep link that
// opens the right club section (Старты / Расписание). This module is the engine:
//   - recipients (attached vs unreachable),
//   - the message + deep link (mirrors the nutrition send, but as a BOT message — no
//     business connection — so the target is telegram_user_id),
//   - the send loop: paced, fault-tolerant, every attempt logged to club_form_sends,
//   - dedup (no second send of the same form to the same student the same day),
//   - "remind non-responders" for the schedule form (sent that week but no calendar entry).
//
// NOTHING sends unless CLUB_FORMS_BROADCAST_ENABLED is on AND the coach confirms in the UI.
// There is no scheduled auto-broadcast.

import { createSupabaseServerClient } from "@/features/supabase/server";
import { sendTelegramMessageStrict } from "@/features/telegram/telegram-client";
import { isClubFormsBroadcastEnabled } from "@/features/club/constants";
import { clubMiniAppShortName, resolveClubBotUsername } from "@/features/club/entry-links";

export type ClubFormType = "starts" | "schedule";

/** ?startapp code per form → the section the club opens (page.tsx deep-link routing). */
const FORM_SECTION: Record<ClubFormType, string> = { starts: "starts", schedule: "schedule" };
const FORM_LINK_LABEL: Record<ClubFormType, string> = { starts: "Открыть старты", schedule: "Открыть расписание" };
export const CLUB_FORM_TITLES: Record<ClubFormType, string> = { starts: "Старты", schedule: "Расписание на следующую неделю" };

/** Default coach message (ты-стиль, без тире/эмодзи). Editable before send. */
export const CLUB_FORM_DEFAULT_TEXT: Record<ClubFormType, string> = {
  starts:
    "Привет! Отметь в клубе свои ближайшие старты, чтобы я видел твои цели и мог правильно подвести тебя к ним.",
  schedule:
    "Привет! Отметь на следующую неделю дни, когда не получится тренироваться, и пожелания по типам занятий. Так я соберу тебе более удобный план.",
};

/** Pause between messages so a 110-recipient run does not hit Telegram rate limits. */
const SEND_PAUSE_MS = 90;
const MINIAPP_ENABLED = (): boolean => process.env.MINIAPP_ENABLED === "true";

function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Monday STRICTLY after `from` (UTC) as YYYY-MM-DD — the "next week" anchor. */
export function nextMondayIso(from: Date = new Date()): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const add = ((8 - dow) % 7) || 7; // never today; the coming Monday
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString().slice(0, 10);
}
function addDaysIso(iso: string, days: number): string {
  const [y, m, dd] = iso.split("-").map((n) => Number.parseInt(n, 10));
  const d = new Date(Date.UTC(y, m - 1, dd));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function buildDeepLink(section: string): Promise<string> {
  // MUST be the CLUB app short name (XOclub) under the CLUB bot — NOT TELEGRAM_MINIAPP_SHORT_NAME
  // (that is the nutrition/Report app). Reuses the club entry-link resolvers so every club link
  // is built the same way. See src/features/club/entry-links.ts.
  const shortName = clubMiniAppShortName();
  if (!shortName) throw new Error("CLUB_MINIAPP_SHORT_NAME не задан (короткое имя клубного мини-аппа, напр. XOclub).");
  const username = await resolveClubBotUsername();
  return `https://t.me/${username}/${shortName}?startapp=${section}`;
}

/** Message body (coach text) + the deep link as an HTML <a> (link preview off). No emoji. */
function buildMessage(bodyText: string, deepLink: string, formType: ClubFormType): string {
  const link = `<a href="${escapeHtml(deepLink)}">${escapeHtml(FORM_LINK_LABEL[formType])}</a>`;
  return `${escapeHtml(bodyText.trim())}\n${link}`;
}

// ── recipients ────────────────────────────────────────────────────────────────

export type BroadcastRecipient = { studentId: string; name: string; telegramUserId: number };
export type UnreachableStudent = { studentId: string; name: string; reason: string };
export type BroadcastRecipientsView = { attached: BroadcastRecipient[]; unreachable: UnreachableStudent[] };

/**
 * Active, non-service students split into: attached (have telegram_user_id → the bot can DM)
 * and unreachable (no telegram_user_id → shown as a list, never silently dropped).
 */
export async function listBroadcastRecipients(): Promise<BroadcastRecipientsView> {
  const s = createSupabaseServerClient();
  const { data } = await s
    .from("trainingpeaks_students")
    .select("id, student_name, telegram_user_id")
    .eq("is_active", true)
    .eq("is_service_account", false)
    .is("archived_at", null)
    .order("student_name", { ascending: true });
  const rows = (data as Array<Record<string, unknown>>) ?? [];
  const attached: BroadcastRecipient[] = [];
  const unreachable: UnreachableStudent[] = [];
  for (const r of rows) {
    const uid = r.telegram_user_id as number | null;
    const name = (r.student_name as string | null) ?? (r.id as string).slice(0, 8);
    if (uid != null) attached.push({ studentId: r.id as string, name, telegramUserId: Number(uid) });
    else unreachable.push({ studentId: r.id as string, name, reason: "нет telegram_user_id (не открывал бота/клуб)" });
  }
  return { attached, unreachable };
}

// ── send ────────────────────────────────────────────────────────────────────

export type BroadcastResult = {
  ok: boolean;
  disabledReason?: string;
  formType: ClubFormType;
  targetWeek: string | null;
  isReminder: boolean;
  requested: number;
  sent: number;
  skippedDuplicate: Array<{ studentId: string; name: string }>;
  failed: Array<{ studentId: string; name: string; error: string }>;
};

/**
 * Send `formType` to the given student ids. Paced, fault-tolerant (one failure never stops
 * the run), every attempt logged. Dedup: a student already sent THIS form TODAY is skipped
 * (guards against an accidental double tap). Returns a full success/skip/failure breakdown.
 */
export async function broadcastClubForm(input: {
  formType: ClubFormType;
  studentIds: string[];
  messageText: string;
  isReminder?: boolean;
  createdBy?: string;
}): Promise<BroadcastResult> {
  const { formType, studentIds } = input;
  const isReminder = input.isReminder ?? false;
  const targetWeek = formType === "schedule" ? nextMondayIso() : null;
  const base: Omit<BroadcastResult, "ok"> = { formType, targetWeek, isReminder, requested: studentIds.length, sent: 0, skippedDuplicate: [], failed: [] };

  if (!isClubFormsBroadcastEnabled()) return { ...base, ok: false, disabledReason: "CLUB_FORMS_BROADCAST_ENABLED выключен." };
  if (!MINIAPP_ENABLED()) return { ...base, ok: false, disabledReason: "MINIAPP_ENABLED выключен." };
  if (studentIds.length === 0) return { ...base, ok: false, disabledReason: "Не выбрано ни одного получателя." };

  const s = createSupabaseServerClient();

  // Resolve names + telegram ids for the selected ids (and drop any without a user id).
  const { data: studRows } = await s
    .from("trainingpeaks_students")
    .select("id, student_name, telegram_user_id")
    .in("id", studentIds);
  const byId = new Map<string, { name: string; uid: number | null }>();
  for (const r of (studRows as Array<Record<string, unknown>>) ?? []) {
    byId.set(r.id as string, { name: (r.student_name as string | null) ?? (r.id as string).slice(0, 8), uid: (r.telegram_user_id as number | null) });
  }

  // Dedup: student ids already sent THIS form TODAY (status=sent).
  const dayStart = `${todayIso()}T00:00:00.000Z`;
  const { data: todaySends } = await s
    .from("club_form_sends")
    .select("student_id")
    .eq("form_type", formType)
    .eq("status", "sent")
    .gte("sent_at", dayStart);
  const sentTodayIds = new Set(((todaySends as Array<{ student_id: string }>) ?? []).map((r) => r.student_id));

  let deepLink: string;
  try {
    deepLink = await buildDeepLink(FORM_SECTION[formType]);
  } catch (err) {
    return { ...base, ok: false, disabledReason: err instanceof Error ? err.message : "Не настроена ссылка mini app." };
  }
  const message = buildMessage(input.messageText, deepLink, formType);

  const result: BroadcastResult = { ...base, ok: true };
  for (const studentId of studentIds) {
    const info = byId.get(studentId);
    const name = info?.name ?? studentId.slice(0, 8);
    if (!info?.uid) {
      result.failed.push({ studentId, name, error: "нет telegram_user_id" });
      continue;
    }
    if (sentTodayIds.has(studentId)) {
      result.skippedDuplicate.push({ studentId, name });
      continue;
    }
    let status: "sent" | "failed" = "sent";
    let error: string | null = null;
    try {
      await sendTelegramMessageStrict(String(info.uid), message, { parseMode: "HTML", disableLinkPreview: true });
    } catch (err) {
      status = "failed";
      error = err instanceof Error ? err.message : "Ошибка отправки.";
      result.failed.push({ studentId, name, error });
    }
    if (status === "sent") result.sent += 1;
    // Log every attempt (best-effort — a logging failure must not abort the run).
    try {
      await s.from("club_form_sends").insert({
        form_type: formType,
        student_id: studentId,
        telegram_user_id: info.uid,
        target_week: targetWeek,
        is_reminder: isReminder,
        status,
        error,
        message_text: input.messageText.trim(),
        created_by: input.createdBy ?? "coach",
      });
    } catch {
      /* logging is best-effort */
    }
    await delay(SEND_PAUSE_MS);
  }
  return result;
}

// ── remind non-responders (schedule form) ──────────────────────────────────────

export type NonResponderView = { targetWeek: string | null; students: BroadcastRecipient[] };

/**
 * Students who were SENT the schedule form for the latest target week but created NO calendar
 * entry for that week. `targetWeek` comes from the most recent schedule send (stable across a
 * Sat→Sun remind). Returns [] when nothing was sent yet.
 */
export async function computeScheduleNonResponders(): Promise<NonResponderView> {
  const s = createSupabaseServerClient();
  // latest schedule target_week actually sent
  const { data: latest } = await s
    .from("club_form_sends")
    .select("target_week")
    .eq("form_type", "schedule")
    .eq("status", "sent")
    .not("target_week", "is", null)
    .order("target_week", { ascending: false })
    .limit(1);
  const targetWeek = ((latest as Array<{ target_week: string }>) ?? [])[0]?.target_week ?? null;
  if (!targetWeek) return { targetWeek: null, students: [] };

  // who was sent that week
  const { data: sends } = await s
    .from("club_form_sends")
    .select("student_id")
    .eq("form_type", "schedule")
    .eq("status", "sent")
    .eq("target_week", targetWeek);
  const sentIds = [...new Set(((sends as Array<{ student_id: string }>) ?? []).map((r) => r.student_id))];
  if (sentIds.length === 0) return { targetWeek, students: [] };

  // who already created a calendar entry inside that week
  const weekEnd = addDaysIso(targetWeek, 6);
  const { data: entries } = await s
    .from("club_calendar_entries")
    .select("student_id")
    .in("student_id", sentIds)
    .gte("entry_date", targetWeek)
    .lte("entry_date", weekEnd);
  const responded = new Set(((entries as Array<{ student_id: string }>) ?? []).map((r) => r.student_id));
  const nonResponderIds = sentIds.filter((id) => !responded.has(id));
  if (nonResponderIds.length === 0) return { targetWeek, students: [] };

  const { data: studs } = await s
    .from("trainingpeaks_students")
    .select("id, student_name, telegram_user_id")
    .in("id", nonResponderIds)
    .not("telegram_user_id", "is", null)
    .order("student_name", { ascending: true });
  const students = ((studs as Array<Record<string, unknown>>) ?? []).map((r) => ({
    studentId: r.id as string,
    name: (r.student_name as string | null) ?? (r.id as string).slice(0, 8),
    telegramUserId: Number(r.telegram_user_id),
  }));
  return { targetWeek, students };
}
