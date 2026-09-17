import type { NextRequest } from "next/server";

import { isValidTimeZone } from "@/features/intervals/loop/clock";
import {
  isRunAppEnabled,
  jsonResponse,
  rememberDetectedZone,
  resolveRunAppStudent,
} from "@/features/intervals/loop/miniapp-guard";
import { fieldLabelRu, mergeAnswers } from "@/features/intervals/loop/prefill";
import { getPrefill, saveOnboardingAnswers } from "@/features/intervals/loop/repository";
import {
  conflictingDays,
  dayNameRu,
  deriveDaysPerWeek,
  sessionCapByCode,
  SURFACE_OPTIONS,
  type TimeOfDay,
  type WeekStability,
} from "@/features/intervals/loop/schedule";
import { sendTelegramMessage } from "@/features/telegram/telegram-client";
import { getTrainingPeaksCoachChatIds } from "@/features/trainingpeaks/attention-telegram";

export const runtime = "nodejs";

const GOALS = new Set(["race", "regular", "improve", "start_running"]);
const SURFACES = new Set<string>(SURFACE_OPTIONS);

function toInt(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isInteger(n) ? n : null;
}

function toDays(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.map(toInt).filter((d): d is number => d !== null && d >= 0 && d <= 6))];
}

// Отказ базы человеческим текстом. Правила стоят констрейнтами и здесь НЕ
// продублированы: вторая копия разошлась бы с первой.
function humaniseConstraint(message: string, coachSet: Set<string>): string {
  if (message.includes("beginner_days_cap")) {
    return coachSet.has("daysPerWeek")
      ? "Здесь не сходится: при программе новичка стоит больше трёх беговых дней. Это ставил тренер, напишите ему."
      : "Больше трёх беговых дней в неделю на старте мы не ставим. Отметьте меньше свободных дней или напишите тренеру.";
  }
  if (message.includes("beginner_needs_continuity")) {
    return "Тренер ещё не отметил, можете ли вы бежать без остановки. Напишите ему, он допишет.";
  }
  if (message.includes("race_needs_details")) {
    return "Для старта нужны дата и дистанция. Заполните оба поля или уберите цель.";
  }
  return "Не получилось сохранить. Проверьте ответы и попробуйте ещё раз.";
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!isRunAppEnabled()) {
    return jsonResponse(503, { ok: false, error: "Приложение пока не включено." });
  }

  let body: { initData?: unknown; answers?: Record<string, unknown>; timeZone?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse(400, { ok: false, error: "Неверный запрос." });
  }

  const auth = await resolveRunAppStudent(body.initData);
  if (!auth.ok) {
    return jsonResponse(auth.httpStatus, { ok: false, error: auth.error, code: auth.code });
  }

  if (!auth.sourceId) {
    return jsonResponse(409, {
      ok: false,
      code: "needs_connection",
      error: "Сначала подключите часы: без данных план не собрать.",
    });
  }
  const sourceId = auth.sourceId;

  const raw = body.answers ?? {};
  const prefill = await getPrefill(sourceId);

  // Зона: сначала определённая браузером, потом выбранная человеком из списка
  // (запасной путь, когда определить не удалось).
  const picked = typeof raw.timezone === "string" && isValidTimeZone(raw.timezone) ? raw.timezone : null;
  await rememberDetectedZone({
    studentUuid: auth.studentUuid,
    stored: auth.timezone,
    detected: picked ?? body.timeZone,
  });

  const stability =
    raw.weekStability === "stable" || raw.weekStability === "varies"
      ? (raw.weekStability as WeekStability)
      : null;
  const timeOfDay =
    raw.timeOfDay === "morning" || raw.timeOfDay === "evening" || raw.timeOfDay === "varies"
      ? (raw.timeOfDay as TimeOfDay)
      : null;
  const surfaces = Array.isArray(raw.runSurfaces)
    ? [...new Set(raw.runSurfaces.filter((v): v is string => typeof v === "string" && SURFACES.has(v)))]
    : null;
  // Три варианта из формы, а не только их сжатая до boolean версия
  // (canRunContinuously ниже). Не через mergeAnswers: это не префилл-поле,
  // тренер не отвечает на него за ученика — mergeAnswers его бы и не увидел,
  // он идёт строго по PREFILLABLE_FIELDS.
  const runStyle =
    raw.runStyle === "continuous" || raw.runStyle === "walk_breaks" || raw.runStyle === "mostly_walk"
      ? raw.runStyle
      : null;
  const capCode = typeof raw.maxSessionCap === "string" ? raw.maxSessionCap : "";
  const capMinutes = sessionCapByCode(capCode);
  const longDay = toInt(raw.preferredLongWeekday);
  const qualityDay = toInt(raw.preferredQualityWeekday);

  // Сведение: заданное тренером побеждает всегда. Не по старшинству, а потому
  // что этих полей человек в форме не видел, и присланное по ним значение не
  // может быть его осознанным ответом.
  const merged = mergeAnswers(prefill, {
    goalKind: (typeof raw.goalKind === "string" && GOALS.has(raw.goalKind)
      ? raw.goalKind
      : null) as "race" | "regular" | "improve" | "start_running" | null,
    raceDate: typeof raw.raceDate === "string" && raw.raceDate ? raw.raceDate : null,
    raceDistanceKm:
      raw.raceDistanceKm === null || raw.raceDistanceKm === undefined || raw.raceDistanceKm === ""
        ? null
        : Number(raw.raceDistanceKm),
    daysPerWeek: null,
    selfReportedWeeklyMinutes: null,
    // Как проходит обычная пробежка. Спрашиваем про ФАКТ, а не «можете ли вы»:
    // человек отвечает про свой вчерашний день, а не сдаёт норматив. Два
    // варианта из трёх означают «пока с перерывами», и это не хуже: от этого
    // зависит только первая тренировка.
    canRunContinuously:
      raw.runStyle === "continuous" ? true : raw.runStyle === "walk_breaks" || raw.runStyle === "mostly_walk" ? false : null,
    healthLimits: null,
    experienceNote: null,
    weekStability: stability,
    availableWeekdays: toDays(raw.availableWeekdays),
    unavailableWeekdays: toDays(raw.unavailableWeekdays),
    preferredLongWeekday: longDay !== null && longDay >= 0 && longDay <= 6 ? longDay : null,
    preferredQualityWeekday:
      qualityDay !== null && qualityDay >= 0 && qualityDay <= 6 ? qualityDay : null,
    timeOfDay,
    runSurfaces: surfaces,
    weekBreakers: typeof raw.weekBreakers === "string" ? raw.weekBreakers.trim().slice(0, 4000) : null,
    // undefined — вариант не прислан; null — прислан «больше 90 минут», то есть
    // потолка нет. Разница существенная: первое значит «не спрашивали».
    maxSessionMinutes: capMinutes === undefined ? null : capMinutes,
    timezone: picked,
  });

  if (merged.ignoredFromStudent.length > 0) {
    console.warn("[m.run.onboarding] клиент прислал поля, заданные тренером", {
      sourceId: auth.sourceId,
      fields: merged.ignoredFromStudent,
    });
  }

  const values = merged.values;
  const coachSet = new Set<string>(merged.coachSetFields);

  const available = values.availableWeekdays ?? [];
  const unavailable = values.unavailableWeekdays ?? [];

  // День не может быть одновременно свободным и занятым. Форма такого не
  // допускает, но запрос приходит от клиента, и верить ему нельзя.
  const clash = conflictingDays(available, unavailable);
  if (clash.length > 0) {
    return jsonResponse(400, {
      ok: false,
      error: `Один и тот же день отмечен и свободным, и занятым: ${clash.map(dayNameRu).join(", ")}.`,
    });
  }

  if (values.weekStability === null) {
    return jsonResponse(400, { ok: false, error: "Ответьте, одинаковая у вас неделя или нет." });
  }

  // ЦЕЛЬ НЕОБЯЗАТЕЛЬНА. Пустая читается как «просто бегать», но хранится как
  // NULL: разница между «выбрал регулярный бег» и «не ответил» нужна тренеру.
  const isBeginner = values.goalKind === "start_running";

  const days = deriveDaysPerWeek({
    coachSetDays: coachSet.has("daysPerWeek") ? values.daysPerWeek : null,
    weekStability: values.weekStability,
    availableWeekdays: available,
    isBeginner,
  });
  if (!days.ok) {
    return jsonResponse(400, { ok: false, error: days.messageRu });
  }

  if (7 - unavailable.length < days.daysPerWeek) {
    return jsonResponse(400, {
      ok: false,
      error: `Свободных дней остаётся ${7 - unavailable.length}, а тренировок в неделе ${days.daysPerWeek}. Снимите один запрет или напишите тренеру.`,
    });
  }

  const saved = await saveOnboardingAnswers({
    sourceId,
    goalKind: values.goalKind,
    raceDate: values.raceDate,
    raceDistanceKm: values.raceDistanceKm,
    daysPerWeek: days.daysPerWeek,
    selfReportedWeeklyMinutes: values.selfReportedWeeklyMinutes,
    unavailableWeekdays: unavailable,
    preferredLongWeekday: values.preferredLongWeekday,
    canRunContinuously: values.canRunContinuously,
    runStyle,
    coachNote: null,
    weekStability: values.weekStability,
    availableWeekdays: available,
    preferredQualityWeekday: values.preferredQualityWeekday,
    timeOfDay: values.timeOfDay,
    runSurfaces: values.runSurfaces ?? [],
    weekBreakers: values.weekBreakers,
    maxSessionMinutes: values.maxSessionMinutes,
    daysPerWeekSource: days.source,
    coachSetFields: merged.coachSetFields,
  });

  if (!saved.ok) {
    return jsonResponse(400, { ok: false, error: humaniseConstraint(saved.message, coachSet) });
  }

  // Уведомление тренеру — best-effort, не блокирует ответ ученику: сама анкета
  // уже сохранена выше независимо от того, дойдёт ли сообщение в Telegram.
  const coachChatIds = getTrainingPeaksCoachChatIds();
  const noticeText = `${auth.studentName} заполнила анкету. Можно собирать план.`;
  await Promise.allSettled(
    coachChatIds.map((chatId) =>
      sendTelegramMessage(chatId, noticeText).catch((err) => {
        console.warn("[m.run.onboarding] coach notify failed", { chatId, error: String(err) });
      })
    )
  );

  // ПЛАН ЗДЕСЬ НЕ СОБИРАЕТСЯ. Анкета сохранена, дальше тренер запускает
  // генерацию и подтверждает план. Пока он этого не сделал, человек видит
  // «план готовится», а не пустоту и не черновик.
  return jsonResponse(200, {
    ok: true,
    answersId: saved.id,
    noteRu: "Спасибо. Тренер соберёт план и покажет его здесь.",
    daysPerWeek: days.daysPerWeek,
    daysReasonRu: days.reasonRu,
    coachSetFields: merged.coachSetFields.map(fieldLabelRu),
  });
}
