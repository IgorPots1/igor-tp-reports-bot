/**
 * Авто-назначение плана новому ученику Intervals.
 *
 * ГЕНЕРАТОР НЕ НОВЫЙ. Цикл разворачивает forecast() из training-cycle.ts, неделю
 * раскладывает buildWeek() из autoplanner-week.ts — тот же код, что работает на
 * ростере TrainingPeaks. Здесь только вход для них и печать результата.
 *
 * По умолчанию НИЧЕГО НЕ ПИШЕТ: показывает план и объясняет, откуда взялась
 * стартовая точка. Запись — по --commit.
 *
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=.env.local tools/trainingpeaks-export/scripts/intervals-onboarding-plan.ts \
 *     --athlete=i38500 --goal=race --race-date=2026-11-22 --race-km=21.1 --days=4 [--commit]
 *
 * Анкета: если переданы флаги цели — она сохраняется (upsert по источнику);
 * если нет — берётся уже сохранённая.
 */
import process from "node:process";

import { createSupabaseServerClient } from "@/features/supabase/server";
import {
  computeStartingPointFromHistory,
  hasUsableHistory,
  loadActivitiesForSource,
  mondayOf,
  runSurfacesIncludeTreadmill,
  startingPointFromAnswers,
} from "@/features/intervals/onboarding/starting-point";
import type { OnboardingAnswers, StartingPoint } from "@/features/intervals/onboarding/types";

import {
  BEGINNER_MAX_RUNS_PER_WEEK, BEGINNER_METHODOLOGY_ID, BEGINNER_METHODOLOGY_VERSION,
  BEGINNER_RPE_CAP, BEGINNER_RPE_TARGET, decideNextStep, diagnosticSession,
  stepByIndex, stepDescriptionRu, weeklyRunningMinutes, type SessionFeedback,
} from "@/features/methodology/beginner";

import { loadCatalog } from "./lib/autoplanner-catalog.ts";
import type { BeginnerWeekInput } from "./lib/beginner-week.ts";
import { buildWeek, DAY_RU, type CycleWeekTarget, type Week } from "./lib/autoplanner-week.ts";
import { forecast } from "./lib/training-cycle.ts";
import { placeDiagnosticTest } from "./lib/intervals-diagnostic-test.ts";
import { parseTargetFromDescription, workBand } from "./lib/intervals-session-target.ts";
import {
  buildAnchors, buildDraftFromOnboarding, buildEnvelope, type StoredThreshold,
  preferencesFromAnswers,
} from "./lib/intervals-plan-adapter.ts";

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : null;
}

const COMMIT = process.argv.includes("--commit");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const addDays = (iso: string, days: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const paceText = (seconds: number | null): string => {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}/км`;
};

/** "7:22" → 442 (сек/км). Формат совпадает с тем, что показывает paceText. */
function parsePaceArg(value: string): number | null {
  const match = value.match(/^(\d+):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Анкета → пожелания, которые понимает сборщик.
 *
 * Своего механизма ограничений не заводим: day_unavailable, role_day и
 * max_days_per_week уже есть и уже проверены на ростере. Анкета ложится на них
 * без остатка — это и был признак, что состав полей выбран правильно.
 */
function printStartingPoint(start: StartingPoint): void {
  console.log("── Стартовая точка ──────────────────────────");
  console.log(`источник:            ${start.source === "history" ? "история Intervals" : "анкета (истории нет)"}`);
  if (start.source === "history") {
    console.log(`окно:                ${start.windowFrom} … ${start.windowTo} (${start.weeksObserved} нед)`);
    console.log(`пробежек в окне:     ${start.runsTotal} (с пульсом ${start.runsWithHeartrate})`);
    console.log(`частота:             ${start.runsPerWeek} пробежки в неделю (недель с бегом ${start.weeksWithRuns} из ${start.weeksObserved})`);
    console.log(`недельные минуты:    ${start.weekly.map((w) => w.minutes).join(" · ")}`);
    console.log(`медиана недели:      ${start.medianWeeklyMinutes} мин  ← база цикла`);
    console.log(`катящиеся 4 нед:     ${start.rolling4wWeeklyMinutes} мин`);
    console.log(`обычная пробежка:    ${start.typicalRunMinutes} мин (p10 ${start.runMinutesP10}, p90 ${start.runMinutesP90})`);
    console.log(`длительная:          медиана ${start.longRunMedianMinutes} мин, максимум ${start.longestRunMinutes} мин`);
    console.log(`темп лёгкого:        ${paceText(start.easyPaceSec)} (медиана медленной половины, n=${start.easyPaceSampleSize})`);
    console.log(`дни (Пн…Вс):         ${start.dayHistogram.join(" ")}`);
    console.log(`дни длительной:      ${start.dayHistogramLong.join(" ")}`);
  }
  console.log(`уровень данных:      ${start.dataLevel}`);
  console.log(`дорожка:             ${start.runsOnTreadmill ? "да — качественная формулируется по ощущению" : "нет"}`);
  for (const note of start.notes) console.log(`  · ${note}`);
}

function printWeek(week: Week, weekIndex: number, target: CycleWeekTarget): void {
  console.log("");
  console.log(
    `Неделя ${weekIndex}/${target.totalWeeks} · ${week.weekStart} · ${target.role} · ` +
      `цель ${target.aerobicMin} мин аэробного + ${target.qualityMin} мин работы · ${target.days} дн`
  );
  if (week.notes.length) console.log(`  заметки сборщика: ${week.notes.join("; ")}`);
  // Неделя без сессий обязана объяснить себя. Молчащая пустая неделя выглядит
  // как сбой генератора, хотя это его осознанный отказ с названной причиной.
  if (week.refused) {
    console.log(`  ✖ неделя не собрана (${week.refusedKind}): ${week.refused}`);
  } else if (week.sessions.length === 0) {
    console.log("  ✖ неделя пуста, причина не названа — это уже повод разбираться");
  }
  for (const session of week.sessions) {
    const date = addDays(week.weekStart, session.dayIdx);
    console.log(`  ${DAY_RU[session.dayIdx]} ${date} — ${session.title}, ${session.minutes} мин`);
    if (session.deferred) {
      console.log(`     ⚑ не назначена: ${session.deferReason}`);
      continue;
    }
    console.log(`     ${session.description}`);
    console.log(`     [цель: ${session.targetMode} · якорь: ${session.anchorSource} · доверие: ${session.confidence}]`);
    if (session.warnings.length) console.log(`     ⚠ ${session.warnings.join(" | ")}`);
    if (session.coachReview.length) console.log(`     ✋ тренеру: ${session.coachReview.join(" | ")}`);
  }
}

async function main(): Promise<void> {
  const athleteId = arg("athlete");
  if (!athleteId) fail("Нужен --athlete=<i38500>");

  const supabase = createSupabaseServerClient();

  // Берём только идентификатор и вид источника: ключ доступа здесь не нужен, а
  // тянуть секрет в память ради генерации плана незачем.
  const { data: source, error: sourceError } = await supabase
    .from("student_data_sources")
    .select("id, kind, student_id, threshold_pace_sec_per_km, threshold_source, threshold_set_at")
    .eq("provider", "intervals")
    .eq("external_athlete_id", athleteId)
    .maybeSingle();
  if (sourceError) fail(`Не удалось прочитать источник: ${sourceError.message}`);
  if (!source) fail(`Источник для athlete ${athleteId} не заведён`);

  // ── Параметры генерации (из флагов) ──
  //
  // ФЛАГИ — ЭТО НЕ АНКЕТА [решение Игоря, 17.09.2026]. Раньше --commit писал
  // --goal/--days/--weekly-minutes/... ПРЯМО В intervals_onboarding_answers,
  // поверх того, что человек реально ответил в форме — план для Валентины
  // (--goal=improve, объём/дни от тренера) стёр её настоящие regular/3/70,
  // а бейдж «ответила сама» продолжал показывать это как её слова. Параметры
  // ПЛАНА и ОТВЕТЫ УЧЕНИКА — разные вещи с разной судьбой: план можно
  // пересобрать хоть каждую неделю, а её ответ — это то, что она сказала
  // один раз, и трогать его должна только её собственная форма (или явная,
  // отдельная команда тренера на подмену конкретного поля — такой команды
  // здесь нет и не должно быть).
  //
  // Флаги ниже живут только в памяти этого прогона и решают, каким цикл
  // ПОСЧИТАТЬ; в intervals_onboarding_answers ничего не пишут. Настоящие
  // параметры генерации остаются в самом цикле (intervals_plan_cycles),
  // это его законное поле.
  const goalArg = arg("goal");
  let answersFromFlags: OnboardingAnswers | null = null;
  if (goalArg) {
    if (goalArg !== "race" && goalArg !== "regular" && goalArg !== "improve" && goalArg !== "start_running") {
      fail("--goal принимает race, improve, regular или start_running");
    }
    const raceDate = arg("race-date");
    const raceKm = arg("race-km");
    if (goalArg === "race" && (!raceDate || !raceKm)) {
      fail("для --goal=race нужны --race-date=YYYY-MM-DD и --race-km=21.1");
    }
    const longDayArg = arg("long-day");
    answersFromFlags = {
      sourceId: source.id as string,
      goalKind: goalArg,
      raceDate: goalArg === "race" ? raceDate : null,
      raceDistanceKm: goalArg === "race" ? Number(raceKm) : null,
      daysPerWeek: Number(arg("days") ?? 4),
      selfReportedWeeklyMinutes: arg("weekly-minutes") ? Number(arg("weekly-minutes")) : null,
      unavailableWeekdays: (arg("skip-days") ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .map(Number),
      preferredLongWeekday: longDayArg === null ? null : Number(longDayArg),
      canRunContinuously:
        arg("can-run-continuously") === null ? null : arg("can-run-continuously") === "true",
      maxSessionMinutes: arg("max-session-min") ? Number(arg("max-session-min")) : null,
      preferredQualityWeekday: arg("quality-day") === null ? null : Number(arg("quality-day")),
    };
  }

  // Сохранённая анкета читается ВСЕГДА, даже когда флаги переданы: покрытия,
  // стабильность недели, что срывает неделю и прочие поля, которых во флагах
  // нет вообще, должны дойти до старта (см. runsOnTreadmill) и до отчёта
  // тренеру, а не потеряться потому, что кто-то передал --goal.
  let answers: OnboardingAnswers | null = answersFromFlags;
  let answersRowId: string | null = null;
  {
    const { data: answersRow } = await supabase
      .from("intervals_onboarding_answers")
      .select("*")
      .eq("source_id", source.id)
      .maybeSingle();
    if (answersRow) {
      answersRowId = answersRow.id as string;
      if (!answers) {
        answers = {
          sourceId: source.id as string,
          // ЦЕЛЬ ТЕПЕРЬ НЕОБЯЗАТЕЛЬНА. NULL в базе означает «не спрашивали и
          // тренер не задал»; для планирования это читается как «просто
          // бегать». Подменяем ЗДЕСЬ, а не в базе: в базе разница между
          // «выбрал регулярный бег» и «не ответил» должна сохраниться.
          goalKind: answersRow.goal_kind ?? "regular",
          raceDate: answersRow.race_date,
          raceDistanceKm: answersRow.race_distance_km === null ? null : Number(answersRow.race_distance_km),
          daysPerWeek: answersRow.days_per_week,
          selfReportedWeeklyMinutes: answersRow.self_reported_weekly_minutes,
          unavailableWeekdays: (answersRow.unavailable_weekdays ?? []) as number[],
          preferredLongWeekday: answersRow.preferred_long_weekday,
          canRunContinuously: answersRow.can_run_continuously ?? null,
          maxSessionMinutes: answersRow.max_session_minutes ?? null,
          preferredQualityWeekday: answersRow.preferred_quality_weekday ?? null,
          runSurfaces: (answersRow.run_surfaces ?? null) as string[] | null,
        };
      } else {
        // ПОКРЫТИЯ — ФАКТ АНКЕТЫ, НЕ ФЛАГ ПРОГОНА. Даже когда цель/объём/дни
        // пришли флагами (--goal=…), покрытия остаются тем, что человек
        // реально отметил, а не тем, что передано в этом вызове.
        answers.runSurfaces = (answersRow.run_surfaces ?? null) as string[] | null;
      }
    }
  }
  if (!answers) fail("Анкеты нет. Передайте --goal=… и остальные поля.");

  console.log("── Анкета ───────────────────────────────────");
  const goalText =
    answers.goalKind === "race"
      ? `старт ${answers.raceDate}, ${answers.raceDistanceKm} км`
      : answers.goalKind === "start_running"
        ? "начать бегать (методика новичка)"
        : "бегать регулярно";
  console.log(`цель:                ${goalText}`);
  console.log(`дней в неделю:       ${answers.daysPerWeek}`);
  console.log(`недоступные дни:     ${answers.unavailableWeekdays.length ? answers.unavailableWeekdays.map((d) => DAY_RU[d]).join(", ") : "нет"}`);
  console.log(`день длительной:     ${answers.preferredLongWeekday === null ? "не задан" : DAY_RU[answers.preferredLongWeekday]}`);
  console.log("");

  // ── Стартовая точка ──
  // --as-of сдвигает окно наблюдения назад. Нужен не для отладки: тренер
  // смотрит, каким был бы план на дату, когда человек ещё бегал, и это же
  // единственный способ проверить ветку истории на архивных данных.
  const today = arg("as-of") ?? new Date().toISOString().slice(0, 10);
  const activities = await loadActivitiesForSource(source.id as string);
  const fromHistory = computeStartingPointFromHistory(activities, today);
  // ВЕТКА, А НЕ КОСТЫЛЬ: когда истории на окне не набирается, план строится по
  // анкете, и это другое обещание тренеру — оно так и подписано в
  // start_point_source. Молча подставлять нули вместо базы нельзя: получился бы
  // «план из данных», построенный ни на чём.
  const usable = hasUsableHistory(fromHistory);
  // ТЕМП ЛЁГКОГО ОТ ТРЕНЕРА — ТОЛЬКО НА ВЕТКЕ АНКЕТЫ. У истории он уже
  // измерен по пробежкам; --easy-pace существует для случая, когда истории не
  // будет никогда (нет подключаемых часов) и объём/темп целиком со слов
  // человека, который тренер знает лично.
  const easyPaceArg = arg("easy-pace");
  const manualEasyPaceSec = easyPaceArg ? parsePaceArg(easyPaceArg) : null;
  if (easyPaceArg && manualEasyPaceSec === null) {
    fail("--easy-pace принимает формат M:SS, например 7:22");
  }
  const start: StartingPoint = usable
    ? fromHistory
    : startingPointFromAnswers(answers, manualEasyPaceSec !== null ? { manualEasyPaceSec } : {});
  // ПОКРЫТИЯ — НЕЗАВИСИМО ОТ ВЕТКИ ОБЪЁМА (история/анкета): человек может иметь
  // измеренную историю и всё равно бегать в основном на дорожке. Ставится
  // ПОСЛЕ выбора ветки и живёт в start_point, поэтому переживает перегенерацию
  // (intervals-regenerate.ts читает start_point как есть, без пересчёта).
  start.runsOnTreadmill = runSurfacesIncludeTreadmill(answers.runSurfaces);
  if (!usable && fromHistory.runsTotal > 0) {
    console.log(
      `Истории на окне недостаточно: пробежек ${fromHistory.runsTotal} в ${fromHistory.weeksWithRuns} нед. ` +
        "Строим по анкете."
    );
    for (const note of fromHistory.notes) console.log(`  · ${note}`);
    console.log("");
  }
  printStartingPoint(start);
  console.log("");

  // ── Ветка начинающего ──
  //
  // Отдельная дорога, а не режим общей: у новичка методика назначает конкретную
  // сессию по лестнице, и считать конверт объёма не из чего и незачем.
  if (answers.goalKind === "start_running") {
    await runBeginnerBranch(supabase, source.id as string, answers, answersRowId, start);
    return;
  }

  // ── Цикл ──
  const firstWeekStart = arg("first-week") ?? mondayOf(addDays(today, 7));
  // ПОРОГ ИЗ ИСТОЧНИКА. Пока его нет, работа назначается по усилию; как только
  // тренер или диагностика его поставят, те же сессии получат темпы, и ничего
  // больше менять не нужно.
  const storedThreshold: StoredThreshold | null =
    source.threshold_pace_sec_per_km !== null && source.threshold_pace_sec_per_km !== undefined
      ? {
          paceSecPerKm: Number(source.threshold_pace_sec_per_km),
          source: String(source.threshold_source) as StoredThreshold["source"],
          setAt: String(source.threshold_set_at),
        }
      : null;
  // ОТКАЗ ОТ ТЕСТА читается ОТДЕЛЬНЫМ запросом, и ошибка чтения не роняет
  // генерацию: колонка появляется миграцией 20261015000000, а планы должны
  // собираться и до её применения. После применения ветка перестаёт срабатывать
  // сама, и её можно будет свернуть в общий select.
  let testDeclined = false;
  {
    const { data: declineRow, error: declineError } = await supabase
      .from("student_data_sources")
      .select("diagnostic_test_declined_at")
      .eq("id", source.id as string)
      .maybeSingle();
    if (declineError) {
      console.log(`  (отказ от теста не прочитан: ${declineError.message})`);
    } else {
      testDeclined = Boolean((declineRow as { diagnostic_test_declined_at?: string | null } | null)?.diagnostic_test_declined_at);
    }
  }
  // --defer-diagnostic — ПРЕДПРОСМОТР ОТКАЗА, БЕЗ ЗАПИСИ В КОЛОНКУ. Тренер
  // решил не ставить тест сейчас (например, дорожка не откалибрована, а на
  // улицу пока рано) — это то же самое поле diagnostic_test_declined_at, но
  // холостой прогон должен показать план, который получится, ДО того, как
  // решение записано на источник.
  if (process.argv.includes("--defer-diagnostic")) testDeclined = true;

  const anchors = buildAnchors(start, storedThreshold);
  const envelope = buildEnvelope(start);
  const { draft, intent, lengthWeeks, notes, blockers } = buildDraftFromOnboarding(
    answers,
    start,
    firstWeekStart
  );

  console.log("── Цикл ─────────────────────────────────────");
  console.log(`тип:                 ${intent}`);
  console.log(`первая неделя:       ${firstWeekStart}`);
  console.log(`длина:               ${lengthWeeks} нед`);
  console.log(`база:                ${draft.baseAerobicMin} мин аэробного + ${draft.baseQualityMin} мин работы`);
  console.log(`потолок роста:       ${draft.peakCapAerobicMin} мин (исторический максимум ${draft.historicMaxAerobicMin})`);
  console.log(`тир:                 ${anchors.tier}`);
  console.log(`якорь лёгкого:       ${anchors.easy ? `${paceText(anchors.easy.fastSec)}–${paceText(anchors.easy.slowSec)} (${anchors.easy.source}, ${anchors.easy.confidence})` : "нет"}`);
  console.log(
    `порог:               ${
      anchors.threshold
        ? paceText(anchors.threshold.paceSec)
        : anchors.qualityByEffort
          ? "нет — работа назначается по усилию, без темпов"
          : "нет — качество назначено не будет"
    }`
  );
  for (const note of notes) console.log(`  · ${note}`);
  for (const gap of draft.gaps) console.log(`  · пробел: ${gap}`);

  // ПОДДЕРЖАНИЕ ПРИ ОБЪЁМЕ, КОТОРОГО НЕТ. Печатаем ВСЕГДА, ещё до недель: в
  // холостом прогоне тренер должен увидеть и тревогу, и тот самый план из
  // восьми одинаковых недель, чтобы решать со знанием, а не по описанию.
  // Запись при этом закрыта, пока он не скажет явно (см. ниже, перед --commit).
  for (const blocker of blockers) {
    console.log("");
    console.log("⚠️  ВНИМАНИЕ ТРЕНЕРА");
    console.log(`  ${blocker.messageRu}`);
    console.log(
      "  Человек выбрал «сохранить нынешнюю форму, ничего не меняя», но сохранять нечего:\n" +
        "  при таком объёме поддержание — это восемь недель с шагом ×1.00, где ничего не\n" +
        "  происходит. Скорее всего он хотел «бегать больше и лучше» (--goal=improve),\n" +
        "  либо он действительно новичок и его ведёт лестница (--goal=start_running)."
    );
  }

  const weeks = forecast(draft, firstWeekStart, lengthWeeks);
  const catalog = await loadCatalog(supabase);
  const prefs = preferencesFromAnswers(answers);

  const built: { week: Week; target: CycleWeekTarget }[] = [];
  for (const [index, forecastWeek] of weeks.entries()) {
    const target: CycleWeekTarget = {
      weekIndex: index + 1,
      totalWeeks: weeks.length,
      role: forecastWeek.role,
      aerobicMin: forecastWeek.aerobicMin,
      qualityMin: forecastWeek.qualityMin,
      days: forecastWeek.days,
      baseWeekMin: draft.baseAerobicMin + draft.baseQualityMin,
      hasTargetRace: Boolean(draft.targetDate),
      intent: draft.intent,
    };
    const week = buildWeek(anchors, envelope, catalog, forecastWeek.weekStart, false, null, target, prefs);
    built.push({ week, target });
  }

  // ── Диагностический тест ────────────────────────────────────────────────
  //
  // Вставляется ПОСЛЕ сборки недель и ДО печати: иначе тренер увидел бы в
  // выводе сессию, которой в записанном плане не будет. Решение о месте и
  // условиях целиком в lib/intervals-diagnostic-test.
  const placement = placeDiagnosticTest({
    built,
    anchors,
    intent: draft.intent,
    hasThreshold: storedThreshold !== null,
    declined: testDeclined,
    maxSessionMinutes: answers.maxSessionMinutes,
  });
  console.log("");
  console.log(`── Диагностический тест ─────────────────────`);
  console.log(`  ${placement.note}`);

  built.forEach((item, index) => printWeek(item.week, index + 1, item.target));

  const totalSessions = built.reduce((sum, item) => sum + item.week.sessions.length, 0);
  const deferred = built.reduce(
    (sum, item) => sum + item.week.sessions.filter((session) => session.deferred).length,
    0
  );
  console.log("");
  console.log("── Итог ─────────────────────────────────────");
  console.log(`недель:              ${built.length}`);
  console.log(`сессий:              ${totalSessions}`);
  console.log(`из них не назначено: ${deferred}`);

  // ПУСТОЙ ПЛАН НЕ ЗАПИСЫВАЕТСЯ НИКОГДА [14.09.2026, поймано живым прогоном].
  //
  // Было так: у человека без истории в Intervals конверт объёма считать не из
  // чего (нужно 4 наблюдённых недели), buildWeek отказывался неделя за неделей,
  // а цикл всё равно ложился в базу — с нулём тренировок. Тренер видел
  // «опубликован», ученица видела «сегодня отдых» и «ближайших тренировок нет».
  // Молчаливая пустота хуже отказа: отказ виден сразу, а пустой план
  // обнаруживается через неделю вопросом «а где тренировки».
  if (totalSessions === 0) {
    const why = built
      .map(({ week, target }) =>
        week.sessions.length === 0
          ? `  · неделя ${target.weekIndex} (${week.weekStart}): ${week.refused ?? "сессий не собрано"}`
          : null
      )
      .filter((line): line is string => line !== null)
      .slice(0, 3);
    fail(
      "Отказ: план вышел пустым, ни одной тренировки. В базу ничего не записано.\n" +
        why.join("\n") +
        (why.length > 0 ? "\n" : "") +
        `Стартовая точка: ${start.source}, уровень данных ${start.dataLevel}, ` +
        `наблюдённых недель ${start.weeksObserved}.\n` +
        "Что с этим делать:\n" +
        "  · если история должна быть — проверьте, что раннер синхронизации её забрал " +
        "(галочка скачивания тренировок в Intervals, npm run intervals:sync);\n" +
        "  · если человек начинает с нуля — его ведёт лестница новичка, а не цикл по " +
        "объёму: --goal=start_running --can-run-continuously=true|false;\n" +
        "  · выдумывать объём за человека нельзя: план, собранный из ничего, " +
        "не безопаснее отсутствия плана."
    );
  }

  if (!COMMIT) {
    console.log("");
    console.log("Ничего не записано (запуск без --commit).");
    return;
  }

  // ОТКАЗ, А НЕ ПОМЕТКА В ЦИКЛЕ. Пометку внутри записанного плана тренер
  // увидит, когда план уже у ученицы; смысл предохранителя в том, чтобы
  // решение было принято ДО записи. Обойти можно одной явной строкой — это
  // не запрет, а требование сказать «да» вслух.
  if (blockers.length > 0 && !process.argv.includes("--maintenance-anyway")) {
    fail(
      "Отказ: поддержание при объёме ниже минимального. В базу ничего не записано.\n" +
        blockers.map((blocker) => `  · ${blocker.messageRu}`).join("\n") +
        "\nЧто с этим делать:\n" +
        "  · человек хотел развития — перегенерировать с --goal=improve;\n" +
        "  · человек начинает с нуля — его ведёт лестница: --goal=start_running;\n" +
        "  · поддержание выбрано осознанно и вы согласны — добавьте --maintenance-anyway."
    );
  }

  // --defer-diagnostic ПРИ --commit ЗАКРЕПЛЯЕТ решение на источнике, а не
  // только на этом прогоне: без записи следующая перегенерация снова
  // поставила бы тест — colonne diagnostic_test_declined_at читается заново
  // каждый раз (см. выше), и без строки здесь флаг работал бы только один
  // раз, что тренер не ожидает от «дадим позже».
  if (process.argv.includes("--defer-diagnostic")) {
    const { error: deferError } = await supabase
      .from("student_data_sources")
      .update({ diagnostic_test_declined_at: new Date().toISOString() })
      .eq("id", source.id as string);
    if (deferError) fail(`Не удалось отложить диагностический тест: ${deferError.message}`);
    console.log("Диагностический тест отложен (diagnostic_test_declined_at проставлен).");
  }

  const { data: cycleRow, error: cycleError } = await supabase
    .from("intervals_plan_cycles")
    .insert({
      source_id: source.id,
      answers_id: answersRowId,
      intent,
      target_date: draft.targetDate,
      first_week_start: firstWeekStart,
      length_weeks: lengthWeeks,
      days: answers.daysPerWeek,
      base_aerobic_min: draft.baseAerobicMin,
      base_quality_min: draft.baseQualityMin,
      start_point_source: start.source,
      data_level: start.dataLevel,
      start_point: start,
      draft,
      week_forecast: weeks,
    })
    .select("id")
    .single();
  if (cycleError) fail(`Не удалось сохранить цикл: ${cycleError.message}`);

  const rows = built.flatMap(({ week, target }) =>
    week.sessions.map((session) => ({
      cycle_id: cycleRow.id,
      week_index: target.weekIndex,
      week_start: week.weekStart,
      session_date: addDays(week.weekStart, session.dayIdx),
      day_idx: session.dayIdx,
      role: session.role,
      title: session.title,
      minutes: session.minutes,
      preset_code: session.presetCode,
      description: session.description,
      // СТРУКТУРА ОТДЕЛЬНОЙ КОЛОНКОЙ, А НЕ ТОЛЬКО В ТЕКСТЕ. Разминка/работа/
      // заминка уже посчитаны здесь (session.segments) и раньше терялись при
      // сплющивании в description — мини-приложение показывало один абзац
      // вместо структуры, видной с одного взгляда.
      segments: session.segments,
      target_mode: session.targetMode === "pace" || session.targetMode === "rpe" ? session.targetMode : null,
      // ЧИСЛА В КОЛОНКИ, А НЕ ТОЛЬКО В ТЕКСТ. Колонки pace_fast_s/pace_slow_s/rpe
      // существовали с первой миграции и всё это время оставались пустыми: темпы
      // жили внутри описания. Из-за этого сравнить два плана можно было только
      // разбором текста. Пишем полосу ОСНОВНОЙ части, не разминки.
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

  const { error: sessionsError } = await supabase
    .from("intervals_plan_sessions")
    .upsert(rows, { onConflict: "cycle_id,week_index,day_idx" });
  if (sessionsError) fail(`Не удалось сохранить сессии: ${sessionsError.message}`);

  console.log("");
  console.log(`Записано: цикл ${cycleRow.id}, сессий ${rows.length}.`);
}

/**
 * Ветка начинающего: лестница шаг-бега вместо цикла по объёму.
 *
 * Прогрессия управляется обратной связью, а не календарём, поэтому показанные
 * недели — ПРОЕКЦИЯ: «если каждая тренировка даётся на RPE 2–3 без боли». Она
 * считается тем же правилом decideNextStep, что работает в бою, — чтобы
 * обещание в плане и поведение системы не разошлись.
 */
async function runBeginnerBranch(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  sourceId: string,
  answers: OnboardingAnswers,
  answersRowId: string | null,
  start: StartingPoint
): Promise<void> {
  // ПОТОЛОК ЖЁСТКИЙ. Просьбу о четырёх днях отклоняем с объяснением, а не
  // урезаем молча: человек должен знать, что его услышали и почему ответили нет.
  if (answers.daysPerWeek > BEGINNER_MAX_RUNS_PER_WEEK) {
    fail(
      `Отказ: методика новичка (${BEGINNER_METHODOLOGY_ID} ${BEGINNER_METHODOLOGY_VERSION}) ` +
        `ограничивает первые 12 недель ${BEGINNER_MAX_RUNS_PER_WEEK} беговыми днями в неделю. ` +
        `В анкете запрошено ${answers.daysPerWeek}.\n` +
        "Причина: у начинающего восстановление медленнее нагрузки, и четвёртый беговой день " +
        "забирает день отдыха, за счёт которого происходит адаптация.\n" +
        "Исправьте анкету (--days=3) — или снимите сегмент новичка, если человек не новичок."
    );
  }
  if (answers.canRunContinuously === null) {
    fail(
      "Отказ: не заполнено, может ли человек бежать непрерывно (--can-run-continuously=true|false). " +
        "От этого зависит первая, диагностическая тренировка, и угадывать её нельзя."
    );
  }

  const weeks = Number(arg("weeks") ?? 4);

  // Состояние прогрессии: где человек сейчас. Нет строки — начинаем с первой
  // ступени; это первый план.
  const { data: stateRow } = await supabase
    .from("intervals_beginner_progression")
    .select("current_step, sessions_at_step, recent_sessions, methodology_version")
    .eq("source_id", sourceId)
    .maybeSingle();

  let step = stateRow ? Number(stateRow.current_step) : 1;
  let sessionsAtStep = stateRow ? Number(stateRow.sessions_at_step) : 0;
  // Состояние НА МОМЕНТ ГЕНЕРАЦИИ. Проекция ниже двигает step/sessionsAtStep как
  // «если всё пройдёт идеально» — записывать в базу можно только вот это,
  // настоящее. Иначе план сам себе поставил бы ступень, которую человек ещё не
  // отработал.
  const realStepAtGeneration = step;
  const realSessionsAtStep = sessionsAtStep;
  const recent: SessionFeedback[] = stateRow ? ((stateRow.recent_sessions ?? []) as SessionFeedback[]) : [];
  const isFirstPlan = !stateRow;

  console.log("── Методика ─────────────────────────────────");
  console.log(`источник:            ${BEGINNER_METHODOLOGY_ID} ${BEGINNER_METHODOLOGY_VERSION}`);
  console.log(`потолок дней:        ${BEGINNER_MAX_RUNS_PER_WEEK} в неделю (жёсткий)`);
  console.log(`может непрерывно:    ${answers.canRunContinuously ? "да" : "нет"}`);
  console.log(`ступень на старте:   ${step} (сессий на ступени ${sessionsAtStep})`);
  console.log(`RPE сессии:          ${BEGINNER_RPE_TARGET}–${BEGINNER_RPE_CAP}`);
  console.log("");
  console.log("Показанные недели — ПРОЕКЦИЯ при условии RPE 2–3 без боли.");
  console.log("Реальная ступень определяется обратной связью после каждой тренировки.");

  const catalog = await loadCatalog(supabase);
  const prefs = preferencesFromAnswers(answers);
  const firstWeekStart = arg("first-week") ?? mondayOf(addDays(new Date().toISOString().slice(0, 10), 7));

  // Якоря и конверт ветке не нужны — она возвращается из buildWeek до них.
  // Передаём пустые осознанно, а не выдуманные: подставить сюда правдоподобные
  // числа значило бы сделать вид, что они на что-то влияют.
  const anchors = { athleteId: 0, tier: "T1" as const, easy: null, threshold: null, quality: null };
  const envelope = buildEnvelope(startingPointFromAnswers(answers));

  const projection: { weekStart: string; step: number; sessions: number; note: string }[] = [];
  const simulated: SessionFeedback[] = [...recent];
  const built: { week: Week; weekIndex: number; step: number }[] = [];

  for (let index = 0; index < weeks; index += 1) {
    const weekStart = addDays(firstWeekStart, index * 7);
    const isDiagnostic = isFirstPlan && index === 0;

    if (!isDiagnostic) {
      const decision = decideNextStep({ currentStep: step, sessionsAtStep, recent: simulated });
      if (decision.action === "progress") {
        step = decision.nextStep;
        sessionsAtStep = 0;
      }
      projection.push({ weekStart, step, sessions: answers.daysPerWeek, note: decision.reason });
    } else {
      projection.push({ weekStart, step, sessions: 1, note: "первый план: диагностическая тренировка" });
    }

    const current = stepByIndex(step);
    const diagnostic = isDiagnostic ? diagnosticSession(answers.canRunContinuously === true) : null;

    const input: BeginnerWeekInput = {
      step: diagnostic && answers.canRunContinuously
        ? { ...stepByIndex(6), presetCode: diagnostic.presetCode, totalMinutes: diagnostic.totalMinutes, runningMinutes: diagnostic.runningMinutes }
        : current,
      title: diagnostic ? diagnostic.titleRu : `Бег/шаг · ступень ${current.index}`,
      description: diagnostic ? diagnostic.descriptionRu : stepDescriptionRu(current),
      isDiagnostic,
      runsThisWeek: answers.daysPerWeek,
      rpeTarget: BEGINNER_RPE_TARGET,
      rpeCap: BEGINNER_RPE_CAP,
      progressionNote: projection[projection.length - 1].note,
      maxSessionMinutes: answers.maxSessionMinutes,
    };

    const week = buildWeek(anchors, envelope, catalog, weekStart, false, null, null, prefs, input);
    built.push({ week, weekIndex: index + 1, step });
    const runsThisWeek = week.sessions.length;

    console.log("");
    console.log(
      `Неделя ${index + 1} · ${weekStart} · ступень ${step} · ` +
        `${runsThisWeek} ${runsThisWeek === 1 ? "тренировка" : "тренировки"} · ` +
        `беговых минут ${weeklyRunningMinutes(current, runsThisWeek)}`
    );
    if (week.notes.length) console.log(`  ${week.notes.join("; ")}`);
    for (const session of week.sessions) {
      console.log(`  ${DAY_RU[session.dayIdx]} ${addDays(weekStart, session.dayIdx)} — ${session.title}, ${session.minutes} мин`);
      console.log(`     ${session.description}`);
      console.log(`     [цель: ${session.targetMode} ${BEGINNER_RPE_TARGET}–${BEGINNER_RPE_CAP} · якорь: ${session.anchorSource}]`);
      if (session.warnings.length) console.log(`     ⚠ ${session.warnings.join(" | ")}`);
      if (session.coachReview.length) console.log(`     ✋ тренеру: ${session.coachReview.join(" | ")}`);
    }

    // Проекция: считаем, что все сессии недели прошли на RPE 2-3 без боли.
    for (let session = 0; session < runsThisWeek; session += 1) {
      simulated.unshift({ date: weekStart, rpe: 2, pain: false });
      sessionsAtStep += 1;
    }
  }

  console.log("");
  console.log("── Проекция по ступеням ─────────────────────");
  for (const [index, row] of projection.entries()) {
    console.log(`  неделя ${index + 1} (${row.weekStart}): ступень ${row.step} · ${row.note}`);
  }
  const finalStep = stepByIndex(projection[projection.length - 1].step);
  console.log("");
  console.log(`К концу ${projection.length}-й недели: ступень ${finalStep.index} — ${finalStep.labelRu}`);
  console.log(`Это при идеальном прохождении. Любое RPE 4+ или боль добавят повтор ступени.`);

  if (!COMMIT) {
    console.log("");
    console.log("Ничего не записано (запуск без --commit).");
    return;
  }

  // ── Запись ────────────────────────────────────────────────────────────────
  //
  // Цикл ложится СО СТАТУСОМ draft. Ученице он не виден, пока тренер не нажал
  // «Показать»: первые недели тренер хочет видеть каждый план раньше неё, и это
  // состояние принадлежит плану, а не общему рубильнику.
  const weeklyMinutes = weeklyRunningMinutes(stepByIndex(realStepAtGeneration), answers.daysPerWeek);
  const { data: cycleRow, error: cycleError } = await supabase
    .from("intervals_plan_cycles")
    .insert({
      source_id: sourceId,
      answers_id: answersRowId,
      // У новичка нет ни дистанции, ни подводки: цикл поддерживающий по форме,
      // а содержание задаёт лестница, а не объём.
      intent: "maintenance",
      target_date: null,
      first_week_start: firstWeekStart,
      length_weeks: weeks,
      days: answers.daysPerWeek,
      base_aerobic_min: weeklyMinutes,
      base_quality_min: 0,
      start_point_source: start.source,
      data_level: start.dataLevel,
      start_point: start,
      // Черновика цикла у ветки новичка нет — вместо него методика и ступень на
      // момент генерации. Пустой объект соврал бы, что цикл посчитан обычным
      // путём.
      draft: {
        kind: "beginner_ladder",
        methodologyId: BEGINNER_METHODOLOGY_ID,
        methodologyVersion: BEGINNER_METHODOLOGY_VERSION,
        stepAtGeneration: realStepAtGeneration,
        sessionsAtStepAtGeneration: realSessionsAtStep,
        maxRunsPerWeek: BEGINNER_MAX_RUNS_PER_WEEK,
        rpeTarget: BEGINNER_RPE_TARGET,
        rpeCap: BEGINNER_RPE_CAP,
        canRunContinuously: answers.canRunContinuously,
      },
      week_forecast: projection,
      // ОБЪЯСНЕНИЕ ПРО ОТДЫХ — ОДИН РАЗ ЗДЕСЬ, А НЕ НА КАЖДЫЙ ДЕНЬ БЕЗ
      // ТРЕНИРОВКИ [решение Игоря, 17.09.2026]. Раньше это же предложение
      // повторялось в restNoteRu на каждый такой день и читалось как «отдых —
      // тоже задание». Экран дня без тренировки теперь говорит только факт
      // (когда следующая), а объяснение — здесь, наверху, один раз на весь цикл.
      week_notes: [
        {
          title: null,
          body: "Дни без тренировки — часть плана, не пропуск: тело растёт между тренировками, а не на них.",
        },
      ],
      status: "draft",
    })
    .select("id")
    .single();
  if (cycleError) fail(`Не удалось сохранить цикл: ${cycleError.message}`);

  const rows = built.flatMap(({ week, weekIndex }) =>
    week.sessions.map((session) => ({
      cycle_id: cycleRow.id,
      week_index: weekIndex,
      week_start: week.weekStart,
      session_date: addDays(week.weekStart, session.dayIdx),
      day_idx: session.dayIdx,
      role: session.role,
      title: session.title,
      minutes: session.minutes,
      preset_code: session.presetCode,
      description: session.description,
      segments: session.segments,
      target_mode: session.targetMode === "pace" || session.targetMode === "rpe" ? session.targetMode : null,
      rpe: session.targetMode === "rpe" ? BEGINNER_RPE_TARGET : null,
      anchor_source: session.anchorSource,
      confidence: session.confidence,
      deferred: session.deferred,
      defer_reason: session.deferReason,
      warnings: session.warnings,
      coach_review: session.coachReview,
    }))
  );

  const { error: sessionsError } = await supabase
    .from("intervals_plan_sessions")
    .upsert(rows, { onConflict: "cycle_id,week_index,day_idx" });
  if (sessionsError) fail(`Не удалось сохранить сессии: ${sessionsError.message}`);

  // ── Состояние прогрессии ──
  //
  // ТОЛЬКО ЕСЛИ СТРОКИ ЕЩЁ НЕТ. Перегенерация плана НЕ ИМЕЕТ ПРАВА сбрасывать
  // ступень: состояние двигают чек-ины, а не генератор. Апсертом здесь можно
  // было бы одним прогоном отправить человека с пятой ступени на первую.
  if (!stateRow) {
    const { error: progressionError } = await supabase
      .from("intervals_beginner_progression")
      .insert({
        source_id: sourceId,
        methodology_id: BEGINNER_METHODOLOGY_ID,
        methodology_version: BEGINNER_METHODOLOGY_VERSION,
        current_step: realStepAtGeneration,
        sessions_at_step: realSessionsAtStep,
        recent_sessions: [],
        can_run_continuously: answers.canRunContinuously,
      });
    if (progressionError) fail(`Не удалось завести состояние прогрессии: ${progressionError.message}`);
    console.log("");
    console.log(`Состояние прогрессии заведено: ступень ${realStepAtGeneration}.`);
  } else {
    console.log("");
    console.log(`Состояние прогрессии не тронуто: ступень ${realStepAtGeneration} — её двигают чек-ины, а не генерация.`);
  }

  console.log(`Записано: цикл ${cycleRow.id} (статус draft), сессий ${rows.length}.`);
  console.log("Ученице план пока НЕ виден — подтвердите его в админке.");
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
