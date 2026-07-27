import type { NextRequest } from "next/server";

import { saveNutritionFileReport } from "@/features/nutrition/admin";
import {
  addNutritionWeightLog,
  getNutritionWeightLogs,
  upsertNutritionCheckin,
} from "@/features/nutrition/repository";
import { validateTelegramInitData } from "@/features/telegram/validate-init-data";
import { resolveMiniAppStudent } from "@/features/telegram/miniapp-student-resolver";
import { sendTelegramMessage } from "@/features/telegram/telegram-client";
import { getTrainingPeaksCoachChatIds } from "@/features/trainingpeaks/attention-telegram";
import { formatNutritionCompactWeekRange } from "@/features/nutrition/report-date-coverage";

export const runtime = "nodejs";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Athlete weight is always auto-accepted, but a jump this large vs the previous
// logged weight is more likely a typo than reality (normal week-to-week swing is
// 1-2 kg) — flag it to the coach to sanity-check. Does NOT block the save.
const WEIGHT_ALERT_THRESHOLD_KG = 4;

// Optional check-in scale: integer 1-10, else null (field is skippable).
function parseScale(raw: FormDataEntryValue | null): number | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n < 1 || n > 10) return null;
  return n;
}

// Optional self-reported weight: positive, within a sane human range, else null.
function parseWeightKg(raw: FormDataEntryValue | null): number | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const n = Number(raw.trim().replace(",", "."));
  if (!Number.isFinite(n) || n < 30 || n > 300) return null;
  return Number(n.toFixed(1));
}

function isMiniAppEnabled(): boolean {
  return process.env.MINIAPP_ENABLED === "true";
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!isMiniAppEnabled()) {
    return jsonResponse(503, { ok: false, error: "Mini app not yet active." });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonResponse(400, { ok: false, error: "Неверный запрос." });
  }

  const initData = (formData.get("initData") as string | null)?.trim() ?? "";
  if (!initData || !validateTelegramInitData(initData)) {
    return jsonResponse(401, { ok: false, error: "Не авторизован." });
  }

  const resolved = await resolveMiniAppStudent({ initData });
  if (!resolved.ok) {
    return jsonResponse(resolved.httpStatus, { ok: false, error: resolved.message });
  }
  const student = resolved.student;

  const weekFrom = (formData.get("weekFrom") as string | null)?.trim() ?? "";
  const weekTo = (formData.get("weekTo") as string | null)?.trim() ?? "";
  if (!ISO_DATE.test(weekFrom) || !ISO_DATE.test(weekTo) || weekFrom > weekTo) {
    return jsonResponse(400, { ok: false, error: "Неверный диапазон дат." });
  }

  // FatSecret may split a week across several PDFs — accept all of them.
  const fileEntries = formData
    .getAll("file")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);
  if (fileEntries.length === 0) {
    return jsonResponse(400, { ok: false, error: "Файл не прикреплён." });
  }

  // Optional weekly check-in (step 4) — every field is skippable.
  const energy = parseScale(formData.get("energy"));
  const wellbeing = parseScale(formData.get("wellbeing"));
  const eatingComfort = parseScale(formData.get("eatingComfort"));
  const weightKg = parseWeightKg(formData.get("weightKg"));
  const studentNote = (formData.get("studentNotes") as string | null)?.trim() || null;

  // Start reading prior weight early (doesn't depend on save result) so the DB
  // round-trip overlaps with the PDF parsing in saveNutritionFileReport.
  const priorWeightPromise = weightKg !== null
    ? getNutritionWeightLogs(student.id).catch((err) => {
        console.warn("[miniapp.confirm] prior weight read failed", {
          studentId: student.id,
          error: err instanceof Error ? err.message : String(err),
        });
        return [] as { weightKg: number }[];
      })
    : Promise.resolve([] as { weightKg: number }[]);

  let result: Awaited<ReturnType<typeof saveNutritionFileReport>>;
  try {
    result = await saveNutritionFileReport({
      // The nutrition pipeline keys on the student ROW id (UUID), not the slug.
      studentId: student.id,
      weekFrom,
      weekTo,
      // Athlete's own words → raw_text (the existing channel that reaches generation).
      studentNotes: studentNote,
      files: fileEntries,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Не удалось сохранить отчёт.";
    console.warn("[miniapp.confirm] save failed", { studentId: student.id, message });
    return jsonResponse(422, { ok: false, error: message });
  }

  // Weight + check-in scales are best-effort: the report is already saved above, so a
  // failure here (e.g. table missing) must NOT fail the whole upload — log and move on.
  const priorLogs = await priorWeightPromise;
  const previousWeightKg: number | null = priorLogs[0]?.weightKg ?? null;

  // Run weight write + check-in upsert concurrently — neither depends on the other.
  await Promise.allSettled([
    weightKg !== null
      ? addNutritionWeightLog({
          studentId: student.id,
          weightKg,
          // Athlete-reported → auto-accepted but NOT coach-confirmed (coach reviews; an
          // anomaly alert fires separately). Coach decision (наряд «вес из лога»): the
          // resolver takes the NEWEST log regardless of confirmed_by_coach, so this row
          // is what the review will actually compute on — see weight-resolution.ts.
          source: "athlete_report",
          confirmedByCoach: false,
        }).catch((err) => {
          console.warn("[miniapp.confirm] weight log failed", {
            studentId: student.id,
            error: err instanceof Error ? err.message : String(err),
          });
        })
      : Promise.resolve(),
    energy !== null || wellbeing !== null || eatingComfort !== null
      ? upsertNutritionCheckin({
          studentId: student.id,
          weekFrom: result.effectiveWeekFrom,
          weekTo: result.effectiveWeekTo,
          reportId: result.report.id,
          energy,
          wellbeing,
          eatingComfort,
          source: "athlete_miniapp",
        }).catch((err) => {
          console.warn("[miniapp.confirm] check-in upsert failed", {
            studentId: student.id,
            error: err instanceof Error ? err.message : String(err),
          });
        })
      : Promise.resolve(),
  ]);

  // Anomaly alert — fires after weight is written; best-effort, non-blocking.
  if (weightKg !== null && previousWeightKg !== null && Math.abs(weightKg - previousWeightKg) >= WEIGHT_ALERT_THRESHOLD_KG) {
    const delta = Number((weightKg - previousWeightKg).toFixed(1));
    const sign = delta > 0 ? "+" : "";
    const alertText =
      `⚠️ ${student.studentName}: вес ${weightKg} кг, было ${previousWeightKg} кг,` +
      ` разница ${sign}${delta} кг — проверь.`;
    const coachChatIds = getTrainingPeaksCoachChatIds();
    await Promise.allSettled(
      coachChatIds.map((chatId) =>
        sendTelegramMessage(chatId, alertText).catch((err) => {
          console.warn("[miniapp.confirm] weight alert failed", { chatId, error: String(err) });
        })
      )
    );
  }

  console.info("[miniapp.confirm] saved", {
    studentId: student.id,
    reportId: result.report.id,
    effectiveWeekFrom: result.effectiveWeekFrom,
    effectiveWeekTo: result.effectiveWeekTo,
    macrosSaved: result.macros.length,
  });

  // Notify Igor only on a CONTENTFUL save (at least one parsed day). An empty
  // 0-day save still creates the report row (visible in admin) — but a "(0 дн.)"
  // notification is noise, so it is suppressed. Notification ≠ persistence: the
  // report is already saved above regardless of this guard.
  if (result.macros.length > 0) {
    const coachChatIds = getTrainingPeaksCoachChatIds();
    const weekRange = formatNutritionCompactWeekRange(result.effectiveWeekFrom, result.effectiveWeekTo);
    const noticeText =
      `${student.studentName} загрузила отчёт о питании за ${weekRange}` +
      ` (${result.macros.length} дн., через Telegram).`;

    await Promise.allSettled(
      coachChatIds.map((chatId) =>
        sendTelegramMessage(chatId, noticeText).catch((err) => {
          console.warn("[miniapp.confirm] coach notify failed", { chatId, error: String(err) });
        })
      )
    );
  } else {
    console.info("[miniapp.confirm] coach notify skipped — 0 parsed days", {
      studentId: student.id,
      reportId: result.report.id,
    });
  }

  return jsonResponse(200, { ok: true, reportId: result.report.id });
}
