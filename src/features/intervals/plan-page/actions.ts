/**
 * Действия со страницы плана. Тонкий слой над тем же, чем пользуется /m/run:
 * второго пути записи отчёта, переноса или анкеты нет и не должно быть.
 *
 * Чужое не трогаем: каждая операция сверяет, что тренировка из ЕЁ
 * опубликованного цикла и из отданной недели. Роль и ученица берутся только
 * из токена, никогда из тела запроса.
 */
import { createSupabaseServerClient, describeSupabaseError } from "@/features/supabase/server";
import { submitManualEntry, validateManualEntry } from "@/features/intervals/manual-entry";

import { getOnboardingAnswers, getPublishedCycle, getSessionById, listPlanWeeks, saveOnboardingAnswers } from "../loop/repository";
import { effortByCode, painByCode } from "../loop/effort-scale";
import { moveStudentSession, submitCheckin } from "../loop/service";

import { alertCoachMessage, alertCoachPain } from "./coach-alerts";
import type { Surface } from "./core";
import type { PlanLinkAccess } from "./links";
import { reportDayFor } from "./report-day";
import { CHECKIN_FILE_BUCKET } from "./view";

export class PlanPageInputError extends Error {}

const DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_FILES = 2;

async function ownReleasedSession(access: PlanLinkAccess, sessionId: string) {
  const session = await getSessionById(sessionId);
  const cycle = await getPublishedCycle(access.sourceId);
  if (!session || !cycle || session.cycleId !== cycle.id) throw new PlanPageInputError("Тренировка не найдена.");
  const week = (await listPlanWeeks(cycle.id)).find((w) => w.weekStart === session.weekStart);
  if (week?.status !== "released") throw new PlanPageInputError("Тренировка не найдена.");
  return session;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(",", "."));
  if (!Number.isFinite(n)) throw new PlanPageInputError("Одно из чисел не распозналось.");
  return n;
}

export type ReportInput = {
  sessionId: string;
  surface: Surface;
  effortCode: string;
  painCode: string;
  minutes: number | null;
  distanceKm: number | null;
  speedKmh: number | null;
  recoverySpeedKmh: number | null;
  comment: string | null;
  keepPaths: string[];
  newFiles: string[];
};

export function parseReportInput(body: Record<string, unknown>): ReportInput {
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  if (!/^[0-9a-f-]{36}$/.test(sessionId)) throw new PlanPageInputError("Тренировка не найдена.");
  const surface = body.surface === "street" ? "street" : body.surface === "treadmill" ? "treadmill" : null;
  if (!surface) throw new PlanPageInputError("Отметьте, где бегали.");
  const keepPaths = Array.isArray(body.keepPaths) ? body.keepPaths.filter((p): p is string => typeof p === "string") : [];
  const newFiles = Array.isArray(body.newFiles) ? body.newFiles.filter((p): p is string => typeof p === "string") : [];
  if (keepPaths.length + newFiles.length > MAX_FILES) throw new PlanPageInputError(`Не больше ${MAX_FILES} скриншотов.`);
  const comment = typeof body.comment === "string" ? body.comment.trim().slice(0, 4000) : "";
  return {
    sessionId,
    surface,
    effortCode: String(body.effort ?? ""),
    painCode: String(body.pain ?? ""),
    minutes: num(body.minutes),
    // Признак тренировки решает, какое число мы ВООБЩЕ принимаем: на улице
    // скорость с панели взяться неоткуда, на дорожке дистанцию считаем сами.
    distanceKm: surface === "street" ? num(body.distanceKm) : null,
    speedKmh: surface === "treadmill" ? num(body.speedKmh) : null,
    recoverySpeedKmh: surface === "treadmill" ? num(body.recoverySpeedKmh) : null,
    comment: comment || null,
    keepPaths,
    newFiles,
  };
}

async function storeFile(sourceId: string, sessionId: string, dataUrl: string): Promise<string> {
  const m = DATA_URL_RE.exec(dataUrl);
  if (!m) throw new PlanPageInputError("Скриншот должен быть JPG, PNG или WEBP.");
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length > MAX_FILE_BYTES) throw new PlanPageInputError("Скриншот слишком большой.");
  const ext = m[1] === "image/png" ? "png" : m[1] === "image/webp" ? "webp" : "jpg";
  const path = `${sourceId}/${sessionId}/${crypto.randomUUID()}.${ext}`;
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.storage.from(CHECKIN_FILE_BUCKET).upload(path, bytes, { contentType: m[1], upsert: false });
  if (error) throw new Error(`file upload: ${describeSupabaseError(error)}`);
  return path;
}

/**
 * Звонить ли тренеру про боль. Отчёт без боли не звонит НИКОГДА [решение Игоря,
 * 21.10.2026: отчёт виден в админке], правка того же отчёта второй раз — тоже.
 */
export function shouldAlertPain(painCode: string, alreadyNotifiedAt: string | null): boolean {
  return painCode === "pain" && !alreadyNotifiedAt;
}

export async function submitPageReport(
  access: PlanLinkAccess,
  input: ReportInput,
  isManualEntry: boolean,
  todayIso: string,
): Promise<void> {
  const session = await ownReleasedSession(access, input.sessionId);

  // Отметила будущую тренировку этой недели — пробежка была сегодня: отчёт
  // сегодняшним днём, тренировка переезжает на сегодня (report-day.ts).
  const day = reportDayFor({ sessionDate: session.sessionDate, weekStart: session.weekStart, todayIso });
  if (!day.ok) throw new PlanPageInputError(day.reason);

  const entry = {
    sourceId: access.sourceId,
    date: day.reportDate,
    durationMinutes: input.minutes ?? NaN,
    distanceKm: input.distanceKm,
    averageHeartrate: null,
    averagePaceSecPerKm: null,
    speedKmh: input.speedKmh,
    recoverySpeedKmh: session.role === "quality" ? input.recoverySpeedKmh : null,
    planSessionId: session.id,
    effortCode: input.effortCode,
    painCode: input.painCode,
    commentText: input.comment,
  };

  /**
   * ПЕРЕНОС ТОЛЬКО ПОД ОТЧЁТ, КОТОРЫЙ ЗАПИШЕТСЯ. Всё, что может отбить запись
   * (минуты, числа, варианты ответа), проверяется ДО переноса: иначе неверное
   * число в форме оставило бы тренировку переехавшей на сегодня без отчёта.
   */
  if (isManualEntry && input.minutes === null) throw new PlanPageInputError("Укажите минуты.");
  const problem = isManualEntry ? validateManualEntry(entry, todayIso) : null;
  if (problem) throw new PlanPageInputError(problem);
  if (!effortByCode(input.effortCode) || !painByCode(input.painCode)) {
    throw new PlanPageInputError("Отметьте, как далась и болело ли.");
  }

  if (day.moveToToday) {
    const moved = await moveStudentSession({
      sourceId: access.sourceId,
      sessionId: session.id,
      toDate: todayIso,
      todayIso,
      movedBy: "student:page",
      ignoreUnavailableWeekdays: true,
    });
    if (!moved.ok) throw new PlanPageInputError(moved.messageRu);
  }

  let checkinId: string;
  if (isManualEntry) {
    const result = await submitManualEntry(entry);
    if (!result.ok) throw new PlanPageInputError(result.messageRu);
    checkinId = result.checkin.checkinId;
  } else {
    const result = await submitCheckin({
      sourceId: access.sourceId,
      planSessionId: session.id,
      sessionDate: day.reportDate,
      effortCode: input.effortCode,
      painCode: input.painCode,
      commentText: input.comment,
      voiceFileId: null,
    });
    if (!result.ok) throw new PlanPageInputError(result.messageRu);
    checkinId = result.checkinId;
  }

  const supabase = createSupabaseServerClient();
  const { data: prevRow } = await supabase.from("intervals_checkins").select("file_paths, pain_coach_notified_at").eq("id", checkinId).maybeSingle();
  const prev = ((prevRow as { file_paths?: string[] } | null)?.file_paths ?? []) as string[];
  const keep = input.keepPaths.filter((p) => prev.includes(p));
  const added: string[] = [];
  for (const f of input.newFiles) added.push(await storeFile(access.sourceId, session.id, f));

  const { error } = await supabase
    .from("intervals_checkins")
    .update({ surface: input.surface, file_paths: [...keep, ...added] })
    .eq("id", checkinId);
  if (error) throw new Error(`intervals_checkins surface/files: ${describeSupabaseError(error)}`);
  const removed = prev.filter((p) => !keep.includes(p));
  if (removed.length) await supabase.storage.from(CHECKIN_FILE_BUCKET).remove(removed);

  // Тревога о боли — один раз на отчёт: правка того же отчёта второй раз не звонит.
  const alreadyNotified = (prevRow as { pain_coach_notified_at?: string | null } | null)?.pain_coach_notified_at;
  if (shouldAlertPain(input.painCode, alreadyNotified ?? null)) {
    await alertCoachPain({
      sourceId: access.sourceId,
      studentUuid: access.studentUuid,
      studentName: access.studentName,
      checkinId,
      sessionDate: day.reportDate,
      sessionTitle: session.title,
      comment: input.comment,
    });
  }
}

export async function movePageSession(access: PlanLinkAccess, sessionId: string, toDate: string, todayIso: string): Promise<void> {
  await ownReleasedSession(access, sessionId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(toDate)) throw new PlanPageInputError("Не тот день.");
  const result = await moveStudentSession({
    sourceId: access.sourceId,
    sessionId,
    toDate,
    todayIso,
    // «student:» — по этому признаку карточка тренера пишет «перенесла САМА».
    movedBy: "student:page",
  });
  if (!result.ok) throw new PlanPageInputError(result.messageRu);
}

/**
 * «Мои дни», режим «каждую неделю». Пишется в анкету с провенансом, отданную
 * неделю НЕ перестраивает: генератор возьмёт дни для следующих недель, а
 * тренер увидит в карточке, что дни поменялись (история полей).
 */
export async function saveMyDays(input: {
  sourceId: string;
  available: number[];
  long: number | null;
  changedBy: string;
  origin: "student_answer" | "coach_words";
}): Promise<void> {
  const available = [...new Set(input.available.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  if (available.length === 0) throw new PlanPageInputError("Отметьте хотя бы один день.");
  const long = input.long !== null && available.includes(input.long) ? input.long : null;
  const answers = await getOnboardingAnswers(input.sourceId);
  if (!answers) throw new PlanPageInputError("Анкеты пока нет — сначала её заполняют.");

  const saved = await saveOnboardingAnswers({
    sourceId: input.sourceId,
    changedBy: input.changedBy,
    origin: input.origin,
    originNote: "Мои дни",
    goalKind: answers.goalKind as never,
    raceDate: answers.raceDate,
    raceDistanceKm: answers.raceDistanceKm,
    daysPerWeek: answers.daysPerWeek,
    selfReportedWeeklyMinutes: answers.selfReportedWeeklyMinutes,
    // Генератор читает только «не могу» и день длительной: остальные дни
    // недели, не отмеченные как «могу», и есть «не могу».
    unavailableWeekdays: [0, 1, 2, 3, 4, 5, 6].filter((d) => !available.includes(d)),
    preferredLongWeekday: long,
    canRunContinuously: answers.canRunContinuously,
    runStyle: answers.runStyle,
    coachNote: answers.coachNote,
    weekStability: answers.weekStability as never,
    availableWeekdays: available,
    preferredQualityWeekday: answers.preferredQualityWeekday,
    timeOfDay: answers.timeOfDay as never,
    runSurfaces: answers.runSurfaces,
    weekBreakers: answers.weekBreakers,
    maxSessionMinutes: answers.maxSessionMinutes,
    daysPerWeekSource: answers.daysPerWeekSource as never,
    coachSetFields: answers.coachSetFields,
  });
  if (!saved.ok) throw new Error(`анкета: ${saved.message}`);
}

export async function sendStudentMessage(access: Pick<PlanLinkAccess, "sourceId" | "studentUuid" | "studentName">, body: string, origin: "page" | "bot", telegramMessageId: string | null = null): Promise<void> {
  const text = body.trim().slice(0, 4000);
  if (!text) throw new PlanPageInputError("Пустое сообщение.");
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("intervals_student_messages")
    .insert({ source_id: access.sourceId, body: text, origin, telegram_message_id: telegramMessageId })
    .select("id")
    .single();
  if (error) throw new Error(`intervals_student_messages: ${describeSupabaseError(error)}`);
  await alertCoachMessage({
    sourceId: access.sourceId,
    studentUuid: access.studentUuid,
    studentName: access.studentName,
    messageId: String((data as { id: string }).id),
    body: text,
    origin,
  });
}

export async function markRepliesSeen(access: PlanLinkAccess, ids: string[]): Promise<void> {
  const clean = ids.filter((id) => /^[0-9a-f-]{36}$/.test(id)).slice(0, 50);
  if (!clean.length) return;
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("intervals_coach_messages")
    .update({ seen_by_student_at: new Date().toISOString() })
    .eq("source_id", access.sourceId)
    .in("id", clean)
    .is("seen_by_student_at", null);
  if (error) throw new Error(`seen: ${describeSupabaseError(error)}`);
}
