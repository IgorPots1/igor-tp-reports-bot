/**
 * Разбор --pre-* флагов в предзаполнение анкеты.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ ФАЙЛ. Раньше жил только внутри intervals-student-setup.ts.
 * Второму скрипту (intervals-prefill-update) он нужен без остального —
 * заведения карточки, ключа доступа, --commit к source — и скрипты нельзя
 * импортировать друг в друга: оба запускаются целиком при импорте.
 */

import process from "node:process";

import { isValidTimeZone } from "@/features/intervals/loop/clock";
import type { PrefillableField } from "@/features/intervals/loop/prefill";

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : null;
}

export function collectPrefillArgs(): {
  setFields: PrefillableField[];
  values: Record<string, unknown>;
  errors: string[];
} {
  const setFields: PrefillableField[] = [];
  const values: Record<string, unknown> = {};
  const errors: string[] = [];

  const goal = arg("pre-goal");
  if (goal !== null) {
    // Список обязан совпадать с формой, с констрейнтом в базе и с читателем
    // предзаполнения. Цель improve уже забывали в двух местах из трёх.
    if (!["race", "regular", "improve", "start_running"].includes(goal)) {
      errors.push("--pre-goal принимает race, regular, improve или start_running");
    }
    setFields.push("goalKind");
    values.goalKind = goal;
  }

  const days = arg("pre-days");
  if (days !== null) {
    const n = Number(days);
    if (!Number.isInteger(n) || n < 2 || n > 7) errors.push("--pre-days — целое от 2 до 7");
    setFields.push("daysPerWeek");
    values.daysPerWeek = n;
  }

  const skip = arg("pre-skip-days");
  if (skip !== null) {
    // Пустая строка — ОСМЫСЛЕННЫЙ ответ «запретов нет», а не «не задано».
    const parsed = skip.split(",").map((v) => v.trim()).filter(Boolean).map(Number);
    if (parsed.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      errors.push("--pre-skip-days — дни 0..6 через запятую (0=Пн)");
    }
    setFields.push("unavailableWeekdays");
    values.unavailableWeekdays = [...new Set(parsed)];
  }

  const longDay = arg("pre-long-day");
  if (longDay !== null) {
    if (longDay === "none") {
      values.preferredLongWeekday = null;
    } else {
      const n = Number(longDay);
      if (!Number.isInteger(n) || n < 0 || n > 6) errors.push("--pre-long-day — 0..6 или none");
      values.preferredLongWeekday = n;
    }
    setFields.push("preferredLongWeekday");
  }

  const canRun = arg("pre-can-run-continuously");
  if (canRun !== null) {
    if (canRun !== "true" && canRun !== "false") {
      errors.push("--pre-can-run-continuously принимает true или false");
    }
    setFields.push("canRunContinuously");
    values.canRunContinuously = canRun === "true";
  }

  const raceDate = arg("pre-race-date");
  if (raceDate !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raceDate)) errors.push("--pre-race-date — YYYY-MM-DD");
    setFields.push("raceDate");
    values.raceDate = raceDate;
  }

  const raceKm = arg("pre-race-km");
  if (raceKm !== null) {
    const n = Number(raceKm);
    if (!Number.isFinite(n) || n <= 0) errors.push("--pre-race-km — положительное число");
    setFields.push("raceDistanceKm");
    values.raceDistanceKm = n;
  }

  const stability = arg("pre-week-stability");
  if (stability !== null) {
    if (stability !== "stable" && stability !== "varies") {
      errors.push("--pre-week-stability принимает stable или varies");
    }
    setFields.push("weekStability");
    values.weekStability = stability;
  }

  const freeDays = arg("pre-free-days");
  if (freeDays !== null) {
    const parsed = freeDays.split(",").map((v) => v.trim()).filter(Boolean).map(Number);
    if (parsed.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      errors.push("--pre-free-days — дни 0..6 через запятую (0=Пн)");
    }
    setFields.push("availableWeekdays");
    values.availableWeekdays = [...new Set(parsed)];
  }

  const qualityDay = arg("pre-quality-day");
  if (qualityDay !== null) {
    if (qualityDay === "none") {
      values.preferredQualityWeekday = null;
    } else {
      const n = Number(qualityDay);
      if (!Number.isInteger(n) || n < 0 || n > 6) errors.push("--pre-quality-day — 0..6 или none");
      values.preferredQualityWeekday = n;
    }
    setFields.push("preferredQualityWeekday");
  }

  const timeOfDay = arg("pre-time-of-day");
  if (timeOfDay !== null) {
    if (!["morning", "evening", "varies"].includes(timeOfDay)) {
      errors.push("--pre-time-of-day принимает morning, evening или varies");
    }
    setFields.push("timeOfDay");
    values.timeOfDay = timeOfDay;
  }

  const surfaces = arg("pre-surfaces");
  if (surfaces !== null) {
    setFields.push("runSurfaces");
    values.runSurfaces = surfaces.split(",").map((v) => v.trim()).filter(Boolean);
  }

  const breakers = arg("pre-week-breakers");
  if (breakers !== null) {
    setFields.push("weekBreakers");
    values.weekBreakers = breakers;
  }

  // ЧУВСТВИТЕЛЬНОЕ. Вывод тренера об ограничениях, а не копия медицинских
  // ответов анкеты. Наружу не отдаётся: ни ученику, ни в Telegram, ни в логи.
  const health = arg("pre-health-limits");
  if (health !== null) {
    setFields.push("healthLimits");
    values.healthLimits = health;
  }

  const experience = arg("pre-experience");
  if (experience !== null) {
    setFields.push("experienceNote");
    values.experienceNote = experience;
  }

  const cap = arg("pre-max-session-min");
  if (cap !== null) {
    const n = Number(cap);
    if (!Number.isInteger(n) || n < 20 || n > 300) errors.push("--pre-max-session-min — целое 20..300");
    setFields.push("maxSessionMinutes");
    values.maxSessionMinutes = n;
  }

  const tz = arg("pre-timezone");
  if (tz !== null) {
    if (!isValidTimeZone(tz)) errors.push(`--pre-timezone — имя зоны IANA, например Europe/Moscow (получено «${tz}»)`);
    setFields.push("timezone");
    values.timezone = tz;
  }

  const weekly = arg("pre-weekly-minutes");
  if (weekly !== null) {
    const n = Number(weekly);
    if (!Number.isInteger(n) || n < 0 || n > 1200) errors.push("--pre-weekly-minutes — целое 0..1200");
    setFields.push("selfReportedWeeklyMinutes");
    values.selfReportedWeeklyMinutes = n;
  }

  return { setFields, values, errors };
}
