import type { NextRequest } from "next/server";

import { isRunAppEnabled, jsonResponse, resolveRunAppStudent } from "@/features/intervals/loop/miniapp-guard";
import { saveOnboardingAnswers } from "@/features/intervals/loop/repository";

export const runtime = "nodejs";

const GOALS = new Set(["race", "regular", "start_running"]);

function toInt(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isInteger(n) ? n : null;
}

// Отказ базы — человеческим текстом. Правила (потолок трёх дней у новичка,
// обязательная развилка про непрерывный бег, дата и дистанция у старта) стоят
// констрейнтами и здесь НЕ продублированы: вторая копия разошлась бы с первой.
function humaniseConstraint(message: string): string {
  if (message.includes("beginner_days_cap")) {
    return (
      "Больше трёх беговых дней в неделю на старте мы не ставим — и это не про дисциплину. " +
      "У начинающего тело перестраивается в дни отдыха, а не на пробежке: четвёртый день " +
      "забирает именно тот день, за счёт которого идёт прогресс. Поставь 2 или 3."
    );
  }
  if (message.includes("beginner_needs_continuity")) {
    return "Ответь, пожалуйста, можешь ли сейчас бежать без остановки — от этого зависит первая тренировка.";
  }
  if (message.includes("race_needs_details")) {
    return "Для старта нужны дата и дистанция — без них план не к чему привязать.";
  }
  return "Не удалось сохранить анкету. Проверь ответы и попробуй ещё раз.";
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!isRunAppEnabled()) {
    return jsonResponse(503, { ok: false, error: "Приложение пока не включено." });
  }

  let body: { initData?: unknown; answers?: Record<string, unknown> } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse(400, { ok: false, error: "Неверный запрос." });
  }

  const auth = await resolveRunAppStudent(body.initData);
  if (!auth.ok) {
    return jsonResponse(auth.httpStatus, { ok: false, error: auth.error, code: auth.code });
  }

  const raw = body.answers ?? {};
  const goalKind = String(raw.goalKind ?? "");
  if (!GOALS.has(goalKind)) {
    return jsonResponse(400, { ok: false, error: "Не выбрана цель." });
  }
  const daysPerWeek = toInt(raw.daysPerWeek);
  if (daysPerWeek === null || daysPerWeek < 2 || daysPerWeek > 7) {
    return jsonResponse(400, { ok: false, error: "Сколько дней в неделю готова бегать — от 2 до 7." });
  }

  const unavailable = Array.isArray(raw.unavailableWeekdays)
    ? [...new Set(raw.unavailableWeekdays.map(toInt).filter((d): d is number => d !== null && d >= 0 && d <= 6))]
    : [];

  // Запретов не может быть столько, чтобы бегать стало негде: молча урезать
  // просьбу нельзя, а построить план на нуле доступных дней — тем более.
  if (7 - unavailable.length < daysPerWeek) {
    return jsonResponse(400, {
      ok: false,
      error: `Свободных дней осталось ${7 - unavailable.length}, а бегать ты хочешь ${daysPerWeek} раза в неделю. Убери один запрет или поставь меньше дней.`,
    });
  }

  const preferredLong = toInt(raw.preferredLongWeekday);
  const coachNote = typeof raw.coachNote === "string" ? raw.coachNote.trim().slice(0, 4000) : "";

  const saved = await saveOnboardingAnswers({
    sourceId: auth.sourceId,
    goalKind: goalKind as "race" | "regular" | "start_running",
    raceDate: typeof raw.raceDate === "string" && raw.raceDate ? raw.raceDate : null,
    raceDistanceKm: raw.raceDistanceKm === null || raw.raceDistanceKm === undefined || raw.raceDistanceKm === ""
      ? null
      : Number(raw.raceDistanceKm),
    daysPerWeek,
    selfReportedWeeklyMinutes: toInt(raw.selfReportedWeeklyMinutes),
    unavailableWeekdays: unavailable,
    preferredLongWeekday: preferredLong !== null && preferredLong >= 0 && preferredLong <= 6 ? preferredLong : null,
    canRunContinuously:
      raw.canRunContinuously === true ? true : raw.canRunContinuously === false ? false : null,
    coachNote: coachNote.length > 0 ? coachNote : null,
  });

  if (!saved.ok) {
    return jsonResponse(400, { ok: false, error: humaniseConstraint(saved.message) });
  }

  // ПЛАН ЗДЕСЬ НЕ ГЕНЕРИТСЯ. Анкета сохранена — дальше тренер запускает
  // генерацию и подтверждает план. Пока он этого не сделал, ученица видит
  // «план готовится», а не пустоту и не черновик.
  return jsonResponse(200, {
    ok: true,
    answersId: saved.id,
    noteRu: "Спасибо. Тренер соберёт план и покажет его здесь.",
  });
}
