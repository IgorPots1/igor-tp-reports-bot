/**
 * Перегенерация остатка цикла после того, как у ученика появился порог.
 *
 * ── ЗАЧЕМ ───────────────────────────────────────────────────────────────────
 *
 * Порог меняет только СЛЕДУЮЩИЙ сгенерированный план. Уже выданный продолжает
 * идти по усилию, и цикл, ради которого тест и делали, проходит мимо своей
 * цели. Эта команда собирает остаток заново с новым порогом и показывает
 * тренеру, что именно изменится.
 *
 * ── ЧТО ЗДЕСЬ ГЛАВНОЕ ───────────────────────────────────────────────────────
 *
 * МОЛЧА НИЧЕГО НЕ ПЕРЕПИСЫВАЕТСЯ. Команда кладёт ЧЕРНОВИК рядом. Публикует
 * тренер, тем же «Показать ученице», что и всегда. Человек уже посмотрел, что у
 * него в пятницу; менять это у него под руками нельзя.
 *
 * ПРОШЛОЕ И ТЕКУЩАЯ НЕДЕЛЯ НЕ ТРОГАЮТСЯ. Пересобираются только недели,
 * начинающиеся со следующего понедельника. Прошлые переносятся в новый цикл как
 * есть, вместе с переносами, которые человек сделал руками.
 *
 * МЕНЯЕТСЯ РОВНО ОДНО. Форма цикла (роли недель, целевые объёмы, длина, дни)
 * берётся из СОХРАНЁННОГО прогноза старого цикла, а не считается заново.
 * Стартовая точка тоже берётся сохранённая. Иначе в разнице перемешались бы два
 * изменения: новый порог и новая история, и понять, что сделал порог, стало бы
 * нельзя.
 *
 *   npm run intervals:regenerate -- --athlete=i123456
 *   npm run intervals:regenerate -- --athlete=i123456 --commit
 */

import process from "node:process";

import { createSupabaseServerClient } from "@/features/supabase/server";

import { loadCatalog } from "./lib/autoplanner-catalog.ts";
import { buildWeek, DAY_RU, type CycleWeekTarget, type Session, type Week } from "./lib/autoplanner-week.ts";
import {
  buildAnchors,
  buildEnvelope,
  preferencesFromAnswers,
  type StoredThreshold,
} from "./lib/intervals-plan-adapter.ts";
import { placeDiagnosticTest } from "./lib/intervals-diagnostic-test.ts";
import { nextMonday, parseTargetFromDescription, workBand } from "./lib/intervals-session-target.ts";

const COMMIT = process.argv.includes("--commit");

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : null;
}

function fail(message: string): never {
  console.error(`⛔ ${message}`);
  process.exit(1);
}

const addDays = (iso: string, days: number): string =>
  new Date(`${iso}T00:00:00Z`).getTime() + days * 86_400_000 > 0
    ? new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10)
    : iso;

const paceText = (seconds: number | null): string => {
  if (seconds === null) return "—";
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/** Одна строка «что человек увидит»: цель и полоса. */
function targetLine(input: {
  targetMode: string | null;
  paceFast: number | null;
  paceSlow: number | null;
  rpe: number | null;
}): string {
  if (input.targetMode === "pace" && input.paceFast !== null) {
    return `темп ${paceText(input.paceFast)}${input.paceSlow !== null ? `–${paceText(input.paceSlow)}` : ""}`;
  }
  if (input.targetMode === "rpe") {
    return input.rpe === null ? "по ощущению, без чисел" : `усилие ${input.rpe} из 10, темпов нет`;
  }
  return "цели нет";
}

function sessionTarget(session: Session): { targetMode: string; paceFast: number | null; paceSlow: number | null } {
  const band = workBand(session.segments);
  return { targetMode: session.targetMode, paceFast: band.fastSec, paceSlow: band.slowSec };
}

async function main(): Promise<void> {
  const athleteId = arg("athlete");
  if (!athleteId) fail("Нужен --athlete=<id атлета в Intervals>");

  const supabase = createSupabaseServerClient();
  const { data: sourceRow, error: sourceError } = await supabase
    .from("student_data_sources")
    .select("id, student_id, threshold_pace_sec_per_km, threshold_source, threshold_set_at, diagnostic_test_declined_at")
    .eq("provider", "intervals")
    .eq("external_athlete_id", athleteId)
    .maybeSingle();
  if (sourceError) fail(`источник не читается: ${sourceError.message}`);
  if (!sourceRow) fail(`Источник для athlete ${athleteId} не заведён`);
  const source = sourceRow as Record<string, unknown>;

  const { data: cardRow } = await supabase
    .from("trainingpeaks_students")
    .select("student_name")
    .eq("id", String(source.student_id))
    .maybeSingle();
  console.log(`Ученик: ${(cardRow as { student_name?: string } | null)?.student_name ?? "?"} (${athleteId})`);

  const stored: StoredThreshold | null =
    source.threshold_pace_sec_per_km !== null && source.threshold_pace_sec_per_km !== undefined
      ? {
          paceSecPerKm: Number(source.threshold_pace_sec_per_km),
          source: String(source.threshold_source) as StoredThreshold["source"],
          setAt: String(source.threshold_set_at),
        }
      : null;
  console.log(
    `Порог: ${stored ? `${paceText(stored.paceSecPerKm)}/км · ${stored.source} · ${stored.setAt.slice(0, 10)}` : "нет"}`
  );
  if (!stored) {
    fail(
      "Перегенерировать нечего: порога нет, и новый план вышел бы таким же, как старый.\n" +
        "Порог ставится тестом (npm run intervals:test) или руками (npm run intervals:set-threshold)."
    );
  }

  // ── Цикл, который сейчас у человека ──
  const { data: cycleRows, error: cycleError } = await supabase
    .from("intervals_plan_cycles")
    .select("id, status, answers_id, intent, target_date, first_week_start, length_weeks, days, base_aerobic_min, base_quality_min, start_point_source, data_level, start_point, draft, week_forecast, created_at")
    .eq("source_id", String(source.id))
    .in("status", ["published", "draft"])
    .order("created_at", { ascending: false })
    .limit(1);
  if (cycleError) fail(`цикл не читается: ${cycleError.message}`);
  const cycle = (cycleRows ?? [])[0] as Record<string, unknown> | undefined;
  if (!cycle) fail("Плана нет: перегенерировать нечего. Сначала сгенерируйте цикл.");
  console.log(`Цикл: ${String(cycle.id).slice(0, 8)} · ${cycle.status} · с ${cycle.first_week_start}, ${cycle.length_weeks} нед`);

  // ── Анкета ──
  const { data: answersRow } = await supabase
    .from("intervals_onboarding_answers")
    .select("*")
    .eq("id", String(cycle.answers_id))
    .maybeSingle();
  if (!answersRow) fail("Анкета цикла не найдена: пересобрать недели по тем же правилам нельзя.");
  const a = answersRow as Record<string, unknown>;
  const prefs = preferencesFromAnswers({
    unavailableWeekdays: (a.unavailable_weekdays ?? []) as number[],
    preferredLongWeekday: (a.preferred_long_weekday ?? null) as number | null,
    preferredQualityWeekday: (a.preferred_quality_weekday ?? null) as number | null,
    daysPerWeek: Number(a.days_per_week),
    maxSessionMinutes: (a.max_session_minutes ?? null) as number | null,
  });

  // ── Старые сессии ──
  const { data: oldRows, error: oldError } = await supabase
    .from("intervals_plan_sessions")
    .select("*")
    .eq("cycle_id", String(cycle.id))
    .order("session_date", { ascending: true });
  if (oldError) fail(`сессии не читаются: ${oldError.message}`);
  const oldSessions = (oldRows ?? []) as Array<Record<string, unknown>>;
  console.log(`Сессий в плане: ${oldSessions.length}`);

  // ── Пересборка ──
  const start = cycle.start_point as Record<string, unknown>;
  const draft = cycle.draft as Record<string, unknown>;
  const weekForecast = cycle.week_forecast as Array<Record<string, unknown>>;
  const anchors = buildAnchors(start as never, stored);
  const envelope = buildEnvelope(start as never);
  const catalog = await loadCatalog(supabase);

  const today = new Date().toISOString().slice(0, 10);
  const cutoff = nextMonday(today);
  console.log(`Сегодня ${today}. Пересобираем недели, начиная с ${cutoff}; всё, что раньше, переносим как есть.`);
  console.log(
    `Якорь лёгкого: ${anchors.easy ? `${paceText(anchors.easy.fastSec)}–${paceText(anchors.easy.slowSec)}` : "нет"} · ` +
      `порог в якоре: ${anchors.threshold ? `${paceText(anchors.threshold.paceSec)} (${anchors.threshold.confidence})` : "нет"}`
  );

  const rebuilt: Array<{ week: Week; target: CycleWeekTarget }> = [];
  const kept: Array<Record<string, unknown>> = [];
  for (const [index, forecastWeek] of weekForecast.entries()) {
    const weekStart = String(forecastWeek.weekStart);
    if (weekStart < cutoff) {
      for (const row of oldSessions) {
        if (String(row.week_start) === weekStart) kept.push(row);
      }
      continue;
    }
    const target: CycleWeekTarget = {
      weekIndex: index + 1,
      totalWeeks: weekForecast.length,
      role: forecastWeek.role as CycleWeekTarget["role"],
      aerobicMin: Number(forecastWeek.aerobicMin),
      qualityMin: Number(forecastWeek.qualityMin),
      days: Number(forecastWeek.days),
      baseWeekMin: Number(draft.baseAerobicMin) + Number(draft.baseQualityMin),
      hasTargetRace: Boolean(draft.targetDate),
      intent: draft.intent as CycleWeekTarget["intent"],
    };
    rebuilt.push({ week: buildWeek(anchors, envelope, catalog, weekStart, false, null, target, prefs), target });
  }

  if (rebuilt.length === 0) {
    fail("Пересобирать нечего: впереди не осталось ни одной недели цикла. Нужен новый цикл, а не перегенерация.");
  }

  // Порог есть — теста в новом плане быть не должно. Вызываем ту же функцию, а
  // не пропускаем шаг: пусть отказ будет назван вслух и в этом выводе тоже.
  const placement = placeDiagnosticTest({
    built: rebuilt,
    anchors,
    intent: draft.intent as never,
    hasThreshold: true,
    declined: Boolean(source.diagnostic_test_declined_at),
    maxSessionMinutes: (a.max_session_minutes ?? null) as number | null,
  });
  console.log(`Диагностический тест: ${placement.note}`);

  /* ────────────────────────── ЧТО ИЗМЕНИТСЯ ────────────────────────── */

  console.log("");
  console.log("══ ЧТО ИЗМЕНИТСЯ ═══════════════════════════════════════");
  const oldByDate = new Map<string, Record<string, unknown>>();
  for (const row of oldSessions) oldByDate.set(String(row.session_date), row);

  let changed = 0;
  let gainedPaces = 0;
  let appeared = 0;
  let disappeared = 0;
  const newDates = new Set<string>();

  for (const { week, target } of rebuilt) {
    const lines: string[] = [];
    for (const session of week.sessions) {
      const date = addDays(week.weekStart, session.dayIdx);
      newDates.add(date);
      const old = oldByDate.get(date);
      const now = sessionTarget(session);
      const nowLine = session.deferred
        ? `не назначена: ${session.deferReason}`
        : `${session.title}, ${session.minutes} мин · ${targetLine({ targetMode: now.targetMode, paceFast: now.paceFast, paceSlow: now.paceSlow, rpe: null })}`;

      if (!old) {
        appeared += 1;
        lines.push(`  ${DAY_RU[session.dayIdx]} ${date}  ПОЯВИЛАСЬ`);
        lines.push(`     стало: ${nowLine}`);
        continue;
      }
      const stored = {
        fastSec: old.pace_fast_s === null || old.pace_fast_s === undefined ? null : Number(old.pace_fast_s),
        slowSec: old.pace_slow_s === null || old.pace_slow_s === undefined ? null : Number(old.pace_slow_s),
        rpe: old.rpe === null || old.rpe === undefined ? null : Number(old.rpe),
      };
      const fromText =
        stored.fastSec === null && stored.rpe === null
          ? parseTargetFromDescription(String(old.description ?? ""))
          : stored;
      const oldLine = old.deferred === true
        ? `не назначена: ${old.defer_reason}`
        : `${old.title}, ${old.minutes} мин · ${targetLine({
            targetMode: (old.target_mode as string | null) ?? null,
            paceFast: fromText.fastSec,
            paceSlow: fromText.slowSec,
            rpe: fromText.rpe,
          })}`;
      if (oldLine === nowLine) continue;
      changed += 1;
      if (old.target_mode === "rpe" && now.targetMode === "pace") gainedPaces += 1;
      lines.push(`  ${DAY_RU[session.dayIdx]} ${date}`);
      lines.push(`     было:  ${oldLine}`);
      lines.push(`     стало: ${nowLine}`);
    }
    if (lines.length === 0) continue;
    console.log("");
    console.log(`── Неделя ${target.weekIndex} · ${week.weekStart} · ${target.role} ──`);
    for (const line of lines) console.log(line);
  }

  for (const row of oldSessions) {
    const date = String(row.session_date);
    if (date < cutoff) continue;
    if (!newDates.has(date)) {
      disappeared += 1;
      console.log("");
      console.log(`  ${date}  ИСЧЕЗЛА: ${row.title}`);
    }
  }

  console.log("");
  console.log("── Итог ─────────────────────────────────────");
  console.log(`недель переносим как есть:  ${new Set(kept.map((r) => String(r.week_start))).size} (${kept.length} тренировок)`);
  console.log(`недель пересобрано:         ${rebuilt.length}`);
  console.log(`тренировок изменилось:      ${changed}`);
  console.log(`из них получили темпы:      ${gainedPaces} (были по усилию)`);
  if (appeared > 0) console.log(`появилось новых:            ${appeared}`);
  if (disappeared > 0) console.log(`исчезло:                    ${disappeared}`);

  if (changed === 0 && appeared === 0 && disappeared === 0) {
    console.log("");
    console.log("Ничего не меняется: новый порог на эти недели не повлиял. Черновик не нужен.");
    return;
  }

  console.log("");
  console.log(
    "Будет сделано: рядом ляжет ЧЕРНОВИК нового цикла. Ученица его не увидит, пока вы не нажмёте\n" +
      "«Показать ученице» в карточке. Старый план до этого момента продолжает работать."
  );

  if (!COMMIT) {
    console.log("\nНичего не записано (запуск без --commit).");
    return;
  }

  const { data: newCycle, error: insertError } = await supabase
    .from("intervals_plan_cycles")
    .insert({
      source_id: String(source.id),
      answers_id: cycle.answers_id,
      intent: cycle.intent,
      target_date: cycle.target_date,
      first_week_start: cycle.first_week_start,
      length_weeks: cycle.length_weeks,
      days: cycle.days,
      base_aerobic_min: cycle.base_aerobic_min,
      base_quality_min: cycle.base_quality_min,
      start_point_source: cycle.start_point_source,
      data_level: cycle.data_level,
      start_point: cycle.start_point,
      draft: cycle.draft,
      week_forecast: cycle.week_forecast,
      status: "draft",
    })
    .select("id")
    .single();
  if (insertError) fail(`черновик не записан: ${insertError.message}`);
  const newCycleId = String((newCycle as { id: string }).id);

  // Прошлые недели переносим со всеми правками человека: перенос тренировки,
  // который он сделал руками, обязан пережить перегенерацию.
  const carried = kept.map((row) => {
    const copy: Record<string, unknown> = { ...row };
    delete copy.id;
    delete copy.created_at;
    copy.cycle_id = newCycleId;
    return copy;
  });

  const fresh = rebuilt.flatMap(({ week, target }) =>
    week.sessions.map((session) => ({
      cycle_id: newCycleId,
      week_index: target.weekIndex,
      week_start: week.weekStart,
      session_date: addDays(week.weekStart, session.dayIdx),
      day_idx: session.dayIdx,
      role: session.role,
      title: session.title,
      minutes: session.minutes,
      preset_code: session.presetCode,
      description: session.description,
      // Структура (разминка/работа/заминка) отдельной колонкой — та же причина,
      // что и у intervals-onboarding-plan.ts: без неё мини-приложение видит
      // только сплющенный текст.
      segments: session.segments,
      target_mode: session.targetMode === "pace" || session.targetMode === "rpe" ? session.targetMode : null,
      // Числа в колонки, а не только в текст описания: без них следующая
      // перегенерация не сможет показать разницу и будет разбирать текст.
      pace_fast_s: workBand(session.segments).fastSec,
      pace_slow_s: workBand(session.segments).slowSec,
      rpe: parseTargetFromDescription(session.description).rpe,
      anchor_source: session.anchorSource,
      confidence: session.confidence,
      deferred: session.deferred,
      defer_reason: session.deferReason,
      warnings: session.warnings,
      coach_review: session.coachReview,
    }))
  );

  const { error: rowsError } = await supabase
    .from("intervals_plan_sessions")
    .upsert([...carried, ...fresh], { onConflict: "cycle_id,week_index,day_idx" });
  if (rowsError) fail(`сессии черновика не записаны: ${rowsError.message}`);

  // ПЕРЕНЕСЁННЫЕ НЕДЕЛИ СОХРАНЯЮТ СВОЁ СОСТОЯНИЕ, ПЕРЕСОБРАННЫЕ — ЧЕРНОВИКИ.
  // Прошлое человек уже видел, и прятать его перегенерацией нельзя. А недели,
  // собранные заново, он не видел ни разу: они ждут нажатия тренера.
  const carriedWeeks = [...new Set(carried.map((row) => String(row.week_start)))];
  const freshWeeks = [...new Set(fresh.map((row) => String(row.week_start)))];
  const { data: oldWeekRows } = await supabase
    .from("intervals_plan_weeks")
    .select("week_start, status")
    .eq("cycle_id", String(cycle.id));
  const releasedBefore = new Set(
    (oldWeekRows ?? [])
      .filter((row) => String((row as Record<string, unknown>).status) === "released")
      .map((row) => String((row as Record<string, unknown>).week_start))
  );
  const { error: weeksError } = await supabase.from("intervals_plan_weeks").upsert(
    [...carriedWeeks, ...freshWeeks].map((weekStart) => ({
      cycle_id: newCycleId,
      week_start: weekStart,
      // Перенесённая неделя сохраняет released: прошлое человек уже видел, и
      // прятать его перегенерацией нельзя. Пересобранная — черновик.
      status: carriedWeeks.includes(weekStart) && releasedBefore.has(weekStart) ? "released" : "generated",
    })),
    { onConflict: "cycle_id,week_start" }
  );
  if (weeksError) fail(`недели черновика не заведены: ${weeksError.message}`);

  console.log("");
  console.log(`Записано: черновик ${newCycleId.slice(0, 8)}, тренировок ${carried.length + fresh.length}.`);
  console.log("Ученица его НЕ видит. Откройте карточку и нажмите «Показать ученице», когда согласитесь.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
