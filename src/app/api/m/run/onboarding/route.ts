import type { NextRequest } from "next/server";

import { isRunAppEnabled, jsonResponse, resolveRunAppStudent } from "@/features/intervals/loop/miniapp-guard";
import { fieldLabelRu, mergeAnswers } from "@/features/intervals/loop/prefill";
import { getPrefill, saveOnboardingAnswers } from "@/features/intervals/loop/repository";

export const runtime = "nodejs";

const GOALS = new Set(["race", "regular", "start_running"]);

function toInt(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isInteger(n) ? n : null;
}

// Отказ базы — человеческим текстом. Правила (потолок трёх дней у новичка,
// обязательная развилка про непрерывный бег, дата и дистанция у старта) стоят
// констрейнтами и здесь НЕ продублированы: вторая копия разошлась бы с первой.
function humaniseConstraint(message: string, coachSet: Set<string>): string {
  if (message.includes("beginner_days_cap")) {
    // Число дней мог задать тренер. Тогда объяснять его ученице как её выбор —
    // значит спорить с человеком о решении, которого он не принимал.
    return coachSet.has("daysPerWeek")
      ? "Здесь не сходится: при программе новичка стоит больше трёх беговых дней. Это ставил тренер — напиши ему, поправит."
      : "Больше трёх беговых дней в неделю на старте мы не ставим — и это не про дисциплину. " +
          "У начинающего тело перестраивается в дни отдыха, а не на пробежке: четвёртый день " +
          "забирает именно тот день, за счёт которого идёт прогресс. Поставь 2 или 3.";
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
  const prefill = await getPrefill(auth.sourceId);

  const goalFromStudent =
    typeof raw.goalKind === "string" && GOALS.has(raw.goalKind) ? raw.goalKind : null;
  const daysFromStudent = toInt(raw.daysPerWeek);
  const unavailableFromStudent = Array.isArray(raw.unavailableWeekdays)
    ? [
        ...new Set(
          raw.unavailableWeekdays
            .map(toInt)
            .filter((d): d is number => d !== null && d >= 0 && d <= 6)
        ),
      ]
    : null;
  const longFromStudent = toInt(raw.preferredLongWeekday);

  // Сведение: заданное тренером побеждает всегда. Не потому, что он главный, а
  // потому, что этих полей ученица в форме не видела — значение по ним не может
  // быть её осознанным ответом.
  const merged = mergeAnswers(prefill, {
    goalKind: goalFromStudent as "race" | "regular" | "start_running" | null,
    raceDate: typeof raw.raceDate === "string" && raw.raceDate ? raw.raceDate : null,
    raceDistanceKm:
      raw.raceDistanceKm === null || raw.raceDistanceKm === undefined || raw.raceDistanceKm === ""
        ? null
        : Number(raw.raceDistanceKm),
    daysPerWeek: daysFromStudent,
    selfReportedWeeklyMinutes: toInt(raw.selfReportedWeeklyMinutes),
    unavailableWeekdays: unavailableFromStudent,
    preferredLongWeekday:
      longFromStudent !== null && longFromStudent >= 0 && longFromStudent <= 6 ? longFromStudent : null,
    canRunContinuously:
      raw.canRunContinuously === true ? true : raw.canRunContinuously === false ? false : null,
    coachNote: typeof raw.coachNote === "string" ? raw.coachNote.trim().slice(0, 4000) : null,
  });

  // Значение по полю, которого в форме не было, — признак старой версии формы
  // или подделанного запроса. Не падаем (ответ ученицы важнее), но в лог это
  // обязано попасть: молча разойтись с тем, что человек видел, нельзя.
  if (merged.ignoredFromStudent.length > 0) {
    console.warn("[m.run.onboarding] клиент прислал поля, заданные тренером", {
      sourceId: auth.sourceId,
      fields: merged.ignoredFromStudent,
    });
  }

  const values = merged.values;
  const coachSet = new Set<string>(merged.coachSetFields);

  if (!values.goalKind || !GOALS.has(values.goalKind)) {
    return jsonResponse(400, {
      ok: false,
      error: coachSet.has("goalKind")
        ? "Тренер не задал цель. Напиши ему."
        : "Не выбрана цель.",
    });
  }
  if (values.daysPerWeek === null || values.daysPerWeek < 2 || values.daysPerWeek > 7) {
    return jsonResponse(400, {
      ok: false,
      error: coachSet.has("daysPerWeek")
        ? "Тренер не задал, сколько дней в неделю бегать. Напиши ему."
        : "Сколько дней в неделю готова бегать — от 2 до 7.",
    });
  }

  const unavailable = values.unavailableWeekdays ?? [];
  if (7 - unavailable.length < values.daysPerWeek) {
    // Формулировка зависит от того, чей это выбор: ученице, которой число дней
    // поставил тренер, нельзя говорить «бегать ты хочешь N раза».
    return jsonResponse(400, {
      ok: false,
      error:
        coachSet.has("daysPerWeek") || coachSet.has("unavailableWeekdays")
          ? `Свободных дней остаётся ${7 - unavailable.length}, а тренировок в неделе ${values.daysPerWeek}. Убери один запрет или напиши тренеру.`
          : `Свободных дней осталось ${7 - unavailable.length}, а бегать ты хочешь ${values.daysPerWeek} раза в неделю. Убери один запрет или поставь меньше дней.`,
    });
  }

  const saved = await saveOnboardingAnswers({
    sourceId: auth.sourceId,
    goalKind: values.goalKind,
    raceDate: values.raceDate,
    raceDistanceKm: values.raceDistanceKm,
    daysPerWeek: values.daysPerWeek,
    selfReportedWeeklyMinutes: values.selfReportedWeeklyMinutes,
    unavailableWeekdays: unavailable,
    preferredLongWeekday: values.preferredLongWeekday,
    canRunContinuously: values.canRunContinuously,
    coachNote: merged.coachNote && merged.coachNote.length > 0 ? merged.coachNote : null,
    coachSetFields: merged.coachSetFields,
  });

  if (!saved.ok) {
    return jsonResponse(400, { ok: false, error: humaniseConstraint(saved.message, coachSet) });
  }

  // ПЛАН ЗДЕСЬ НЕ ГЕНЕРИТСЯ. Анкета сохранена — дальше тренер запускает
  // генерацию и подтверждает план. Пока он этого не сделал, ученица видит
  // «план готовится», а не пустоту и не черновик.
  return jsonResponse(200, {
    ok: true,
    answersId: saved.id,
    noteRu: "Спасибо. Тренер соберёт план и покажет его здесь.",
    coachSetFields: merged.coachSetFields.map(fieldLabelRu),
  });
}
