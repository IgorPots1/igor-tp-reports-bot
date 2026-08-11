"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  ADMIN_ACCESS_COOKIE_NAME,
  hasValidAdminAccessCookie,
  isAdminAccessBypassedForLocalDev,
  normalizeAdminRedirectPath,
} from "@/lib/admin-auth";
import type { RecordDistanceKey } from "@/features/club/records";

// Coach identity: admin is a shared token, so all coach ops are attributed to "coach".
const COACH = "coach";

function req(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing form field: ${key}`);
  return value;
}
function opt(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  if (typeof value !== "string") return null;
  return value.trim() || null;
}
function withNotice(pathname: string, key: "notice" | "error", value: string): string {
  const [path, rawQuery = ""] = pathname.split("?");
  const params = new URLSearchParams(rawQuery);
  params.set(key, value);
  return `${path}?${params.toString()}`;
}
async function ensureAdminAccess(redirectTarget: string): Promise<void> {
  if (isAdminAccessBypassedForLocalDev()) return;
  const cookieStore = await cookies();
  if (hasValidAdminAccessCookie(cookieStore.get(ADMIN_ACCESS_COOKIE_NAME)?.value)) return;
  redirect(`/admin/login?next=${encodeURIComponent(normalizeAdminRedirectPath(redirectTarget))}`);
}
function revalidateClub() {
  revalidatePath("/admin/club");
  revalidatePath("/admin/club/results");
  revalidatePath("/admin/club/queue");
  revalidatePath("/admin/club/links");
  revalidatePath("/admin/club/manage");
  revalidatePath("/admin/club/forms");
}

/** hh:mm:ss | mm:ss | ss → seconds. */
function parseHms(v: string): number | null {
  const parts = v.trim().split(":").map((x) => Number(x));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
}

// ── 1. Records revision ──────────────────────────────────────────────────────

export async function applyRaceFillRecoveryAction(formData: FormData): Promise<void> {
  const redirectTo = req(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const { applyRaceFillRecovery } = await import("@/features/club-admin/repository");
  let res = { written: 0, skipped: 0 };
  try {
    res = await applyRaceFillRecovery(COACH);
  } catch (e) {
    revalidateClub();
    redirect(withNotice(redirectTo, "error", e instanceof Error ? e.message : "Ошибка."));
  }
  revalidateClub();
  redirect(withNotice(redirectTo, "notice", `Восстановлено гонок: ${res.written} (пропущено уже существующих: ${res.skipped}). Откат в «Ревизии результатов».`));
}

export async function confirmRaceResultAction(formData: FormData): Promise<void> {
  const redirectTo = req(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const studentId = req(formData, "studentId");
  const distanceKey = req(formData, "distanceKey") as RecordDistanceKey;
  const timeRaw = req(formData, "time");
  const durationSeconds = parseHms(timeRaw);
  if (!durationSeconds || durationSeconds <= 0) {
    redirect(withNotice(redirectTo, "error", "Неверное время (чч:мм:сс)."));
  }
  const recordDate = opt(formData, "date");
  const raceName = opt(formData, "raceName");
  const { upsertCoachConfirmedResult } = await import("@/features/club-admin/repository");
  try {
    await upsertCoachConfirmedResult({ studentId, distanceKey, durationSeconds: durationSeconds!, recordDate, raceName, enteredBy: COACH });
  } catch (e) {
    revalidateClub();
    redirect(withNotice(redirectTo, "error", e instanceof Error ? e.message : "Ошибка сохранения."));
  }
  revalidateClub();
  redirect(withNotice(redirectTo, "notice", "Гонка подтверждена."));
}

export async function hideRecordAction(formData: FormData): Promise<void> {
  const redirectTo = req(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const studentId = req(formData, "studentId");
  const distanceKey = req(formData, "distanceKey") as RecordDistanceKey;
  const { hideStudentRecord } = await import("@/features/club-admin/repository");
  try {
    await hideStudentRecord({ studentId, distanceKey, enteredBy: COACH });
  } catch (e) {
    revalidateClub();
    redirect(withNotice(redirectTo, "error", e instanceof Error ? e.message : "Ошибка."));
  }
  revalidateClub();
  redirect(withNotice(redirectTo, "notice", "Результат скрыт."));
}

export async function clearRecordOverrideAction(formData: FormData): Promise<void> {
  const redirectTo = req(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const studentId = req(formData, "studentId");
  const distanceKey = req(formData, "distanceKey") as RecordDistanceKey;
  const { clearCoachRecord } = await import("@/features/club-admin/repository");
  try {
    await clearCoachRecord({ studentId, distanceKey });
  } catch (e) {
    revalidateClub();
    redirect(withNotice(redirectTo, "error", e instanceof Error ? e.message : "Ошибка."));
  }
  revalidateClub();
  redirect(withNotice(redirectTo, "notice", "Сброшено к реконструкции."));
}

// ── 2. Request queue ─────────────────────────────────────────────────────────

export async function setRequestStatusAction(formData: FormData): Promise<void> {
  const redirectTo = req(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const kind = req(formData, "kind");
  const id = req(formData, "id");
  const status = req(formData, "status") as "approved" | "rejected";
  const repo = await import("@/features/club-admin/repository");
  try {
    if (kind === "race") await repo.setRaceStatus(id, status, COACH);
    else if (kind === "dayoff") await repo.setDayoffStatus(id, status, COACH);
  } catch (e) {
    revalidateClub();
    redirect(withNotice(redirectTo, "error", e instanceof Error ? e.message : "Ошибка."));
  }
  revalidateClub();
  redirect(withNotice(redirectTo, "notice", status === "approved" ? "Подтверждено." : "Отклонено."));
}

export async function deleteClubRaceAction(formData: FormData): Promise<void> {
  const redirectTo = req(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const id = req(formData, "id");
  const repo = await import("@/features/club-admin/repository");
  const res = await repo.deleteClubRace(id);
  revalidateClub();
  const okMsg = res.pending ? "Снятие из TP запланировано (уйдёт ближайшим прогоном раннера)." : "Старт удалён.";
  redirect(withNotice(redirectTo, res.ok ? "notice" : "error", res.ok ? okMsg : (res.error ?? "Ошибка.")));
}

/** Batch-approve checked race requests. Checkbox name: "raceIds". */
export async function batchApproveRacesAction(formData: FormData): Promise<void> {
  const redirectTo = req(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const ids = formData.getAll("raceIds").filter((v): v is string => typeof v === "string");
  const { setRaceStatus } = await import("@/features/club-admin/repository");
  let n = 0;
  for (const id of ids) {
    try {
      await setRaceStatus(id, "approved", COACH);
      n += 1;
    } catch {
      /* skip failures, continue batch */
    }
  }
  revalidateClub();
  redirect(withNotice(redirectTo, "notice", `Подтверждено стартов: ${n}.`));
}

// ── 3. Telegram links ────────────────────────────────────────────────────────

export async function unbindStudentAction(formData: FormData): Promise<void> {
  const redirectTo = req(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const studentId = req(formData, "studentId");
  const { unbindStudent } = await import("@/features/club-admin/repository");
  try {
    await unbindStudent(studentId);
  } catch (e) {
    revalidateClub();
    redirect(withNotice(redirectTo, "error", e instanceof Error ? e.message : "Ошибка."));
  }
  revalidateClub();
  redirect(withNotice(redirectTo, "notice", "Отвязано."));
}

export async function relinkStudentAction(formData: FormData): Promise<void> {
  const redirectTo = req(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const studentId = req(formData, "studentId");
  const tgId = Number(req(formData, "telegramUserId"));
  if (!Number.isFinite(tgId) || tgId <= 0) {
    redirect(withNotice(redirectTo, "error", "Неверный Telegram user id."));
  }
  const { relinkStudent } = await import("@/features/club-admin/repository");
  try {
    await relinkStudent(studentId, tgId);
  } catch (e) {
    revalidateClub();
    redirect(withNotice(redirectTo, "error", e instanceof Error ? e.message : "Ошибка."));
  }
  revalidateClub();
  redirect(withNotice(redirectTo, "notice", "Привязано."));
}

export async function setCalendarEntryStatusAction(formData: FormData): Promise<void> {
  const redirectTo = req(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const id = req(formData, "entryId");
  const status = req(formData, "status") === "rejected" ? "rejected" : "approved";
  const { setCalendarEntryStatus } = await import("@/features/club-admin/repository");
  try {
    await setCalendarEntryStatus(id, status);
  } catch (e) {
    revalidateClub();
    redirect(withNotice(redirectTo, "error", e instanceof Error ? e.message : "Ошибка."));
  }
  revalidateClub();
  redirect(withNotice(redirectTo, "notice", status === "approved" ? "Подтверждено." : "Отклонено."));
}

export async function confirmProtocolMatchAction(formData: FormData): Promise<void> {
  const redirectTo = req(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const pendingId = req(formData, "pendingId");
  const { confirmProtocolMatch } = await import("@/features/club-admin/repository");
  const res = await confirmProtocolMatch(pendingId, COACH);
  revalidateClub();
  redirect(withNotice(redirectTo, res.ok ? "notice" : "error", res.ok ? "Привязано: рекорд + журнал + написание запомнено." : res.error ?? "Ошибка."));
}

export async function rejectProtocolMatchAction(formData: FormData): Promise<void> {
  const redirectTo = req(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const pendingId = req(formData, "pendingId");
  const { rejectProtocolMatch } = await import("@/features/club-admin/repository");
  const res = await rejectProtocolMatch(pendingId, COACH);
  revalidateClub();
  redirect(withNotice(redirectTo, res.ok ? "notice" : "error", res.ok ? "Отклонено, больше не предлагается." : res.error ?? "Ошибка."));
}

/** D1 — for a doubtful distance the right answer is usually NOT «reject» (that would delete a valid
 *  result) but «fix the distance»: the coach picks the correct standard distance, the result stays,
 *  the bucket is corrected, and the queue row closes. */
export async function fixProtocolMatchDistanceAction(formData: FormData): Promise<void> {
  const redirectTo = req(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const pendingId = req(formData, "pendingId");
  const distanceKey = req(formData, "distanceKey") as RecordDistanceKey;
  if (!(["5k", "10k", "21k", "42k"] as string[]).includes(distanceKey)) {
    redirect(withNotice(redirectTo, "error", "Неверная дистанция."));
  }
  const { confirmProtocolMatch } = await import("@/features/club-admin/repository");
  const res = await confirmProtocolMatch(pendingId, COACH, { distanceKey });
  revalidateClub();
  redirect(withNotice(redirectTo, res.ok ? "notice" : "error", res.ok ? `Привязано с дистанцией ${distanceKey}: рекорд + журнал.` : res.error ?? "Ошибка."));
}

/** D2 — cancel a rejection: delete the tombstone so the next probeg-sync can re-bind this result. */
export async function unrejectProtocolMatchAction(formData: FormData): Promise<void> {
  const redirectTo = req(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const studentId = req(formData, "studentId");
  const raceDate = req(formData, "raceDate");
  const protocolUrl = opt(formData, "protocolUrl");
  const { unrejectProtocolMatch } = await import("@/features/club-admin/repository");
  const res = await unrejectProtocolMatch(studentId, raceDate, protocolUrl);
  revalidateClub();
  redirect(withNotice(redirectTo, res.ok ? "notice" : "error", res.ok ? "Возвращено: следующий синк сможет привязать снова." : res.error ?? "Ошибка."));
}

/** Batch-confirm every pending match in one race group (event+date) at once — the coach reviews the
 *  race's finishers together, then binds them all. Idempotent per row (already-confirmed rows skip). */
export async function confirmProtocolGroupAction(formData: FormData): Promise<void> {
  const redirectTo = req(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const ids = req(formData, "pendingIds").split(",").map((s) => s.trim()).filter(Boolean);
  const { confirmProtocolMatch } = await import("@/features/club-admin/repository");
  let ok = 0;
  let fail = 0;
  let firstErr: string | null = null;
  for (const id of ids) {
    const res = await confirmProtocolMatch(id, COACH);
    if (res.ok) ok += 1;
    else {
      fail += 1;
      if (!firstErr) firstErr = res.error ?? null;
    }
  }
  revalidateClub();
  redirect(withNotice(redirectTo, fail === 0 ? "notice" : "error", fail === 0 ? `Привязано ${ok} результатов по гонке.` : `Привязано ${ok}, ошибок ${fail}${firstErr ? ": " + firstErr : ""}.`));
}

export async function approveAllPendingCalendarAction(formData: FormData): Promise<void> {
  const redirectTo = req(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const { approveAllPendingCalendar } = await import("@/features/club-admin/repository");
  let count = 0;
  try {
    count = await approveAllPendingCalendar();
  } catch (e) {
    revalidateClub();
    redirect(withNotice(redirectTo, "error", e instanceof Error ? e.message : "Ошибка."));
  }
  revalidateClub();
  redirect(withNotice(redirectTo, "notice", `Подтверждено записей: ${count}.`));
}

export async function createClubChallengeAction(formData: FormData): Promise<void> {
  const redirectTo = req(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const goalType = req(formData, "goalType") === "workouts" ? "workouts" : "km";
  const goalValue = Number(req(formData, "goalValue").replace(",", "."));
  const scope = req(formData, "participantScope") === "selected" ? "selected" : "all";
  const idsRaw = opt(formData, "participantIds") ?? "";
  const participantIds = idsRaw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  const { createClubChallenge } = await import("@/features/club-admin/repository");
  try {
    await createClubChallenge({
      title: opt(formData, "title") ?? "",
      goalType,
      goalValue,
      startsAt: req(formData, "startsAt"),
      endsAt: req(formData, "endsAt"),
      participantScope: scope,
      participantIds,
      coach: COACH,
    });
  } catch (e) {
    revalidateClub();
    redirect(withNotice(redirectTo, "error", e instanceof Error ? e.message : "Ошибка."));
  }
  revalidateClub();
  redirect(withNotice(redirectTo, "notice", "Челлендж создан."));
}

export async function setClubChallengeStatusAction(formData: FormData): Promise<void> {
  const redirectTo = req(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const id = req(formData, "challengeId");
  const status = req(formData, "status");
  const next = status === "completed" ? "completed" : status === "archived" ? "archived" : "active";
  const { setClubChallengeStatus } = await import("@/features/club-admin/repository");
  try {
    await setClubChallengeStatus(id, next);
  } catch (e) {
    revalidateClub();
    redirect(withNotice(redirectTo, "error", e instanceof Error ? e.message : "Ошибка."));
  }
  revalidateClub();
  redirect(withNotice(redirectTo, "notice", next === "completed" ? "Завершён." : next === "archived" ? "В архив." : "Активен."));
}

export async function deleteClubCommentAction(formData: FormData): Promise<void> {
  const redirectTo = req(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const id = req(formData, "commentId");
  const { deleteClubCommentAdmin } = await import("@/features/club-admin/repository");
  try {
    await deleteClubCommentAdmin(id);
  } catch (e) {
    revalidateClub();
    redirect(withNotice(redirectTo, "error", e instanceof Error ? e.message : "Ошибка."));
  }
  revalidateClub();
  redirect(withNotice(redirectTo, "notice", "Комментарий удалён."));
}

// ── Phase E: prediction visibility + billing claims/reminders ────────────────

export async function setClubPredictionVisibleAction(formData: FormData): Promise<void> {
  const redirectTo = req(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const studentId = req(formData, "studentId");
  const visible = req(formData, "visible") === "true";
  const { setClubPredictionVisible } = await import("@/features/club-admin/repository");
  try {
    await setClubPredictionVisible(studentId, visible);
  } catch (e) {
    revalidateClub();
    redirect(withNotice(redirectTo, "error", e instanceof Error ? e.message : "Ошибка."));
  }
  revalidateClub();
  redirect(withNotice(redirectTo, "notice", visible ? "Прогноз показан." : "Прогноз скрыт."));
}

export async function reviewPaymentClaimAction(formData: FormData): Promise<void> {
  const redirectTo = req(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const id = req(formData, "claimId");
  const { reviewClubPaymentClaim } = await import("@/features/club-admin/repository");
  try {
    await reviewClubPaymentClaim(id, COACH);
  } catch (e) {
    revalidateClub();
    redirect(withNotice(redirectTo, "error", e instanceof Error ? e.message : "Ошибка."));
  }
  revalidateClub();
  redirect(withNotice(redirectTo, "notice", "Заявка обработана."));
}

export async function createReminderDraftsAction(formData: FormData): Promise<void> {
  const redirectTo = req(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const { createReminderDrafts } = await import("@/features/club-admin/repository");
  let n = 0;
  try {
    n = await createReminderDrafts(COACH);
  } catch (e) {
    revalidateClub();
    redirect(withNotice(redirectTo, "error", e instanceof Error ? e.message : "Ошибка."));
  }
  revalidateClub();
  redirect(withNotice(redirectTo, "notice", `Черновиков создано: ${n}. Ничего не отправлено.`));
}

export async function confirmRemindersAction(formData: FormData): Promise<void> {
  const redirectTo = req(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const ids = formData.getAll("reminderIds").filter((v): v is string => typeof v === "string");
  const { confirmReminderDrafts } = await import("@/features/club-admin/repository");
  let n = 0;
  try {
    n = await confirmReminderDrafts(ids, COACH);
  } catch (e) {
    revalidateClub();
    redirect(withNotice(redirectTo, "error", e instanceof Error ? e.message : "Ошибка."));
  }
  revalidateClub();
  redirect(withNotice(redirectTo, "notice", `Подтверждено: ${n}. Автоотправка выключена - ничего не ушло.`));
}

export async function setClubDisplayNameAction(formData: FormData): Promise<void> {
  const redirectTo = req(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const studentId = req(formData, "studentId");
  const displayName = opt(formData, "displayName");
  const { setClubDisplayName } = await import("@/features/club-admin/repository");
  try {
    await setClubDisplayName(studentId, displayName);
  } catch (e) {
    revalidateClub();
    redirect(withNotice(redirectTo, "error", e instanceof Error ? e.message : "Ошибка."));
  }
  revalidateClub();
  redirect(withNotice(redirectTo, "notice", displayName ? "Имя обновлено." : "Имя сброшено."));
}

// ── Entry links (one-time binding tokens) ──────────────────────────────────

export async function generateClubLinkAction(formData: FormData): Promise<void> {
  const redirectTo = req(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const studentId = req(formData, "studentId");
  const { createClubLinkToken } = await import("@/features/club/link-tokens");
  try {
    await createClubLinkToken(studentId, COACH);
  } catch (e) {
    revalidateClub();
    redirect(withNotice(redirectTo, "error", e instanceof Error ? e.message : "Ошибка."));
  }
  revalidateClub();
  redirect(withNotice(redirectTo, "notice", "Ссылка сгенерирована."));
}

export async function generateAllUnboundLinksAction(formData: FormData): Promise<void> {
  const redirectTo = req(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const { generateClubLinksForUnbound } = await import("@/features/club-admin/repository");
  let count = 0;
  try {
    const rows = await generateClubLinksForUnbound(COACH);
    count = rows.length;
  } catch (e) {
    revalidateClub();
    redirect(withNotice(redirectTo, "error", e instanceof Error ? e.message : "Ошибка."));
  }
  revalidateClub();
  redirect(withNotice(redirectTo, "notice", `Сгенерировано ссылок: ${count}.`));
}

export async function revokeClubLinkAction(formData: FormData): Promise<void> {
  const redirectTo = req(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const tokenId = req(formData, "tokenId");
  const { revokeClubLinkToken } = await import("@/features/club/link-tokens");
  try {
    await revokeClubLinkToken(tokenId);
  } catch (e) {
    revalidateClub();
    redirect(withNotice(redirectTo, "error", e instanceof Error ? e.message : "Ошибка."));
  }
  revalidateClub();
  redirect(withNotice(redirectTo, "notice", "Токен отозван."));
}

// ── Access requests (coach-approved entry) ─────────────────────────────────

export async function approveClubAccessRequestAction(formData: FormData): Promise<void> {
  const redirectTo = req(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const requestId = req(formData, "requestId");
  const studentId = req(formData, "studentId");
  const tgId = Number(req(formData, "telegramUserId"));
  if (!Number.isFinite(tgId) || tgId <= 0) {
    redirect(withNotice(redirectTo, "error", "Неверный Telegram id заявки."));
  }
  const { linkTelegramUserIdToStudent } = await import("@/features/trainingpeaks/repository");
  const { markClubAccessRequestApproved } = await import("@/features/club/access-requests");
  const { getBoundStudentSummary } = await import("@/features/club-admin/repository");
  const { logClubLinkEvent } = await import("@/features/club/service");
  try {
    const res = await linkTelegramUserIdToStudent(studentId, tgId);
    if (res.status !== "linked" && res.status !== "already_linked_same") {
      // One Telegram = one student: collision or wrong target — blocked, logged, visible.
      await logClubLinkEvent({ telegramUserId: tgId, telegramUsername: null, studentId, result: "conflict", reason: res.status });
      revalidateClub();
      redirect(withNotice(redirectTo, "error", `Привязка заблокирована: ${res.status} (этот Telegram или ученик уже заняты).`));
    }
    await markClubAccessRequestApproved(requestId, studentId, COACH);
    await logClubLinkEvent({ telegramUserId: tgId, telegramUsername: null, studentId, result: "confirmed", reason: "access_request_approved" });
    const sum = await getBoundStudentSummary(studentId);
    revalidateClub();
    redirect(withNotice(redirectTo, "notice", `Привязано: ${sum.name}. Последняя тренировка: ${sum.lastWorkoutDate ?? "нет"}, за 7 дней: ${sum.count7d}.${sum.count7d === 0 ? " ⚠ пусто - проверь, та ли строка." : ""}`));
  } catch (e) {
    revalidateClub();
    redirect(withNotice(redirectTo, "error", e instanceof Error ? e.message : "Ошибка."));
  }
}

export async function rejectClubAccessRequestAction(formData: FormData): Promise<void> {
  const redirectTo = req(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const requestId = req(formData, "requestId");
  const tgId = Number(opt(formData, "telegramUserId") ?? "0");
  const { markClubAccessRequestRejected } = await import("@/features/club/access-requests");
  const { logClubLinkEvent } = await import("@/features/club/service");
  try {
    await markClubAccessRequestRejected(requestId, COACH);
    await logClubLinkEvent({ telegramUserId: tgId || null, telegramUsername: null, studentId: null, result: "rejected", reason: "access_request_rejected" });
  } catch (e) {
    revalidateClub();
    redirect(withNotice(redirectTo, "error", e instanceof Error ? e.message : "Ошибка."));
  }
  revalidateClub();
  redirect(withNotice(redirectTo, "notice", "Заявка отклонена."));
}

// ── Club form broadcasts (first outbound path; every send is this explicit coach tap) ──

export async function sendClubFormsBroadcastAction(formData: FormData): Promise<void> {
  const redirectTo = req(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const formType = req(formData, "formType");
  const messageText = req(formData, "messageText");
  const studentIds = formData.getAll("studentIds").filter((v): v is string => typeof v === "string" && v.length > 0);
  const isReminder = opt(formData, "isReminder") === "1";
  let notice = "";
  let errorMsg: string | null = null;
  if (formType !== "starts" && formType !== "schedule") {
    errorMsg = "Неизвестный тип формы.";
  } else {
    const { broadcastClubForm } = await import("@/features/club-admin/forms-broadcast");
    try {
      const r = await broadcastClubForm({ formType, studentIds, messageText, isReminder, createdBy: COACH });
      if (!r.ok) {
        errorMsg = r.disabledReason ?? "Не отправлено.";
      } else {
        const parts = [`Отправлено ${r.sent}`];
        if (r.skippedDuplicate.length) parts.push(`пропущено дублей ${r.skippedDuplicate.length}`);
        if (r.failed.length) parts.push(`ошибок ${r.failed.length}: ${r.failed.slice(0, 5).map((f) => f.name).join(", ")}${r.failed.length > 5 ? "…" : ""}`);
        notice = parts.join(" · ");
      }
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : "Ошибка отправки.";
    }
  }
  revalidateClub();
  if (errorMsg) redirect(withNotice(redirectTo, "error", errorMsg));
  redirect(withNotice(redirectTo, "notice", notice));
}

export async function remindClubScheduleNonRespondersAction(formData: FormData): Promise<void> {
  const redirectTo = req(formData, "redirectTo");
  await ensureAdminAccess(redirectTo);
  const messageText = req(formData, "messageText");
  const { computeScheduleNonResponders, broadcastClubForm } = await import("@/features/club-admin/forms-broadcast");
  let notice = "";
  let errorMsg: string | null = null;
  try {
    const nr = await computeScheduleNonResponders();
    if (nr.students.length === 0) {
      notice = "Напоминать некому: все получатели уже заполнили расписание (или рассылки ещё не было).";
    } else {
      const r = await broadcastClubForm({
        formType: "schedule",
        studentIds: nr.students.map((s) => s.studentId),
        messageText,
        isReminder: true,
        createdBy: COACH,
      });
      if (!r.ok) {
        errorMsg = r.disabledReason ?? "Не отправлено.";
      } else {
        const parts = [`Напоминание отправлено ${r.sent}`];
        if (r.skippedDuplicate.length) parts.push(`пропущено дублей ${r.skippedDuplicate.length}`);
        if (r.failed.length) parts.push(`ошибок ${r.failed.length}`);
        notice = parts.join(" · ");
      }
    }
  } catch (e) {
    errorMsg = e instanceof Error ? e.message : "Ошибка.";
  }
  revalidateClub();
  if (errorMsg) redirect(withNotice(redirectTo, "error", errorMsg));
  redirect(withNotice(redirectTo, "notice", notice));
}
