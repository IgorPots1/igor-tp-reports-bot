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
import { decideLadderStep, rungByCode, rungByWorkMinutes } from "./lib/interval-ladder.ts";
import { runSurfacesIncludeTreadmill, startingPointFromAnswers } from "@/features/intervals/onboarding/starting-point";
import { releasedWorkFloor, sessionWorkMinutes } from "@/features/intervals/loop/released-work-volume";
import { buildWeekSignal } from "@/features/intervals/loop/week-signal";
import {
  getOnboardingAnswers,
  listActivitiesInRange,
  listCheckins,
  listPauses,
  listPlanWeeks,
  listSessionsInRange,
} from "@/features/intervals/loop/repository";
import { pauseCovering, pauseLabelRu } from "@/features/intervals/loop/pause";
import {
  actualWeeklyMedian,
  missedPlannedStreak,
  weekCompliance,
  type WeekFact,
} from "@/features/intervals/loop/training-gaps";

const COMMIT = process.argv.includes("--commit");

/** День плюс-минус столько суток, ГГГГ-ММ-ДД. */
function shiftIso(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

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
    .select("id, student_id, threshold_pace_sec_per_km, threshold_source, threshold_set_at, diagnostic_test_declined_at, easy_pace_sec_per_km")
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
  /**
   * БЕЗ ПОРОГА ПЕРЕСБОРКА ТЕПЕРЬ ИМЕЕТ СМЫСЛ [27.09.2026].
   *
   * Заслон стоял с обоснованием «новый план вышел бы таким же, как старый»: без
   * порога числа брать неоткуда. Обоснование перестало быть верным, когда
   * появились пол от последней отданной недели и шаг по лестнице коротких
   * форматов: у ученицы без порога план меняется именно ими, и запрет пересборки
   * стал запретом прогрессии. Ученица без порога — не исключение, а весь
   * сегмент без часов.
   *
   * Заслон не снят, а переписан в предупреждение: темпов в плане не появится, и
   * это надо сказать вслух.
   */
  if (!stored) {
    console.log("Порога нет: темпов не будет, работа пойдёт по усилию. Ставится тестом или руками.");
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
  /**
   * СТАРТОВАЯ ТОЧКА ИЗ АНКЕТЫ, КОГДА В ЦИКЛЕ ЕЁ НЕТ [27.09.2026].
   *
   * У сегмента без часов start_point в цикле пустой: истории в Intervals нет, и
   * измерять было нечего. Скрипт падал на `start.weekly.map` — то есть боевой
   * путь пересборки для всего этого сегмента не работал вовсе, и каждая правка
   * делалась разовым скриптом мимо базы.
   *
   * Берём анкету — тот же источник, из которого её план и собрали изначально.
   */
  const answersForStart = await getOnboardingAnswers(String(source.id));
  const hasHistory = Array.isArray((start as { weekly?: unknown[] }).weekly);
  if (!hasHistory && !answersForStart) {
    fail("В цикле нет стартовой точки, а анкеты тоже нет — собирать не из чего.");
  }
  /**
   * ЯКОРЬ ЛЁГКОГО ИЗ БАЗЫ — ОБЯЗАТЕЛЬНО [18.09.2026, повторено здесь 27.09].
   *
   * Без него весь цикл уходит в отказ no_easy_anchor_and_no_fallback: у
   * Валентины так отказались все 36 сессий. Число живёт в student_data_sources
   * рядом с порогом; стартовая точка из анкеты сама его не знает.
   */
  const storedEasyPaceSec =
    source.easy_pace_sec_per_km === null || source.easy_pace_sec_per_km === undefined
      ? null
      : Number(source.easy_pace_sec_per_km);
  const startPoint = hasHistory
    ? (start as never)
    : (startingPointFromAnswers(
        answersForStart!,
        storedEasyPaceSec !== null ? { manualEasyPaceSec: storedEasyPaceSec } : {}
      ) as never);
  /**
   * ДОРОЖКА СТАВИТСЯ ОТДЕЛЬНОЙ СТРОКОЙ, КАК В БОЕВОМ ПУТИ [27.09.2026].
   *
   * startingPointFromAnswers сама этот признак не выводит: онбординг ставит его
   * следующей строкой (intervals-onboarding-plan.ts:328). Без него
   * runsOnTreadmill = false, и тогда не срабатывает сужение формата до отрезков:
   * скелет выдаёт слот «темповый», в пуле не остаётся ни одного формата с шагом,
   * и лестница не находит НИ ОДНОЙ своей ступени. На неделе 28.09 из-за этого
   * вставал непрерывный «Темповый бег 30 минут» — та самая подмена, которую
   * тренер отверг 22.09. Один пропущенный признак, а выглядит как отказ лестницы.
   */
  (startPoint as unknown as { runsOnTreadmill: boolean }).runsOnTreadmill = hasHistory
    ? (start as { runsOnTreadmill?: boolean }).runsOnTreadmill === true
    : runSurfacesIncludeTreadmill(answersForStart!.runSurfaces);

  if (!hasHistory) {
    console.log(
      `Стартовой точки в цикле нет (истории не было) — берём её из анкеты.` +
        ` Якорь лёгкого из базы: ${storedEasyPaceSec === null ? "НЕТ" : paceText(storedEasyPaceSec)}` +
        ` · дорожка: ${(startPoint as unknown as { runsOnTreadmill: boolean }).runsOnTreadmill ? "да" : "нет"}`
    );
  }

  const anchors = buildAnchors(startPoint, stored);

  /**
   * ФАКТЫ ПРО ВЫПОЛНЕНИЕ — ИЗ БАЗЫ, А НЕ НУЛЯМИ [наряд Игоря, 06.10.2026].
   *
   * Адаптер отдавал конверту `notRunningWeeks: 0`, `complianceRatio: null` и
   * прочие нули с объяснением «плановых величин нет вообще». С 20.09.2026 это
   * неправда: у сегмента есть отданные недели. Пока нули стояли, путь «человек
   * фактически не тренируется» не мог сработать ни разу, и перерыв в беге был
   * генератору невидим.
   *
   * ПЛАН БЕРЁМ ТОЛЬКО ПО ОТДАННЫМ НЕДЕЛЯМ. Неделя, которую человек не видел,
   * не могла быть им не выполнена: считать её провалом значит обвинить
   * человека в том, чего ему не показывали.
   */
  const allCycleSessions = await listSessionsInRange(String(cycle.id), "2000-01-01", "2100-01-01");
  const releasedStarts = new Set(
    (await listPlanWeeks(String(cycle.id))).filter((w) => w.status === "released").map((w) => w.weekStart)
  );
  const activitiesForFacts = await listActivitiesInRange(String(source.id), "2000-01-01", today);
  const runDates = activitiesForFacts
    .map((activity) => activity.startDateLocal?.slice(0, 10) ?? "")
    .filter((date) => date.length > 0);
  const weekFacts: WeekFact[] = [...releasedStarts].sort().map((weekStart) => {
    const weekEnd = shiftIso(weekStart, 6);
    const sessionsOfWeek = allCycleSessions.filter((session) => session.weekStart === weekStart);
    const runsOfWeek = activitiesForFacts.filter((activity) => {
      const date = activity.startDateLocal?.slice(0, 10) ?? "";
      return date >= weekStart && date <= weekEnd;
    });
    return {
      weekStart,
      plannedMin: sessionsOfWeek.reduce((sum, session) => sum + session.minutes, 0),
      actualMin: runsOfWeek.reduce((sum, activity) => sum + Math.round((activity.movingTimeS ?? 0) / 60), 0),
      runs: runsOfWeek.length,
    };
  });
  // ТОЛЬКО ЗАВЕРШЁННЫЕ НЕДЕЛИ: текущая ещё идёт, и её недобор не факт, а время.
  const completedFacts = weekFacts.filter((week) => shiftIso(week.weekStart, 6) < today);
  const compliance = weekCompliance(completedFacts);
  const actualWeekly = actualWeeklyMedian(completedFacts);
  const envelope = buildEnvelope(startPoint, {
    ...compliance,
    lowComplianceWeeks: 0, // пометка тренеру, объём не режет; считаем отдельно, когда понадобится
    actualWeeklyMin: actualWeekly,
  });
  const catalog = await loadCatalog(supabase);

  if (completedFacts.length > 0) {
    console.log(
      `ФАКТ ПРОТИВ ПЛАНА по отданным неделям: ` +
        completedFacts.map((w) => `${w.weekStart.slice(5)} ${w.actualMin}/${w.plannedMin}`).join(" · ")
    );
    console.log(
      `  выполнение ${compliance.complianceRatio === null ? "нечем считать" : `${Math.round(compliance.complianceRatio * 100)}%`}` +
        ` · недель «не бегает» подряд: ${compliance.notRunningWeeks}` +
        ` · медиана факта ${actualWeekly ?? "нет"} мин/нед` +
        ` (в анкете ${startPoint.rolling4wWeeklyMinutes} — ${actualWeekly !== null && actualWeekly !== startPoint.rolling4wWeeklyMinutes ? "берём факт" : "совпало"})`
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const cutoff = nextMonday(today);
  console.log(`Сегодня ${today}. Пересобираем недели, начиная с ${cutoff}; всё, что раньше, переносим как есть.`);
  console.log(
    `Якорь лёгкого: ${anchors.easy ? `${paceText(anchors.easy.fastSec)}–${paceText(anchors.easy.slowSec)}` : "нет"} · ` +
      `порог в якоре: ${anchors.threshold ? `${paceText(anchors.threshold.paceSec)} (${anchors.threshold.confidence})` : "нет"}`
  );

  /**
   * ОТКУДА ШАГАТЬ И НЕ НАДО ЛИ ПОСТОЯТЬ [27.09.2026].
   *
   * Пол «не ниже последней отданной недели» не давал ходить назад, но и вперёд
   * не вёл. Пол отвечает на «не хуже, чем было», лестница — на «а куда дальше».
   *
   * Ступень узнаём двумя путями: по коду пресета у машинной недели и по минутам
   * работы у рукописной, где preset_code равен coach_hand_authored. Для сегмента
   * без часов второй путь основной.
   *
   * Причина постоять берётся из УЖЕ СЧИТАЕМОГО: боль и полоса RPE приходят из
   * того же buildWeekSignal, который показывает их тренеру на карточке.
   */
  const planWeeks = await listPlanWeeks(String(cycle.id));
  const releasedWeekStarts = new Set(
    planWeeks.filter((w) => w.status === "released").map((w) => w.weekStart)
  );
  const pastSessions = await listSessionsInRange(String(cycle.id), "2000-01-01", cutoff);
  const floor = releasedWorkFloor({ sessions: pastSessions, releasedWeekStarts });
  const floorPresetCode = floor
    ? (pastSessions
        .filter((session) => session.weekStart === floor.weekStart)
        .map((session) => ({ code: session.presetCode, work: sessionWorkMinutes(session) }))
        .filter((x) => x.work > 0)
        .sort((a, b) => b.work - a.work)[0]?.code ?? null)
    : null;
  const pastCheckins = await listCheckins(String(source.id), 40);
  const signal = buildWeekSignal({
    checkins: pastCheckins,
    unansweredCheckinIds: new Set<string>(),
    todayIso: today,
    // Плановые дни и пробежки — чтобы пустая завершённая неделя была видна
    // пустой, а не как «данных нет» (week-signal.ts, emptyWeek).
    plannedDates: allCycleSessions
      .filter((session) => releasedStarts.has(session.weekStart))
      .map((session) => session.sessionDate),
    runDates,
  });
  if (signal.emptyWeek) {
    console.log(`ПУСТАЯ НЕДЕЛЯ: ${signal.emptyWeek.headlineRu} (${signal.emptyWeek.weekStart}, в плане было ${signal.emptyWeek.plannedSessions})`);
  }
  const hasPain = signal.painFlags.length > 0;
  const rpeBand = signal.volume?.band ?? null;

  /**
   * ПАУЗЫ И ПЕРЕРЫВ — ТЕПЕРЬ ГЕНЕРАТОРУ ВИДНЫ [наряд Игоря, 06.10.2026].
   *
   * Таблицу intervals_pauses читали только напоминания, её экран и карточка
   * тренера. Генератор о паузе не знал ничего, поэтому четыре дня болезни были
   * для него неотличимы от четырёх дней тренировок.
   *
   * ИЗМЕРЯЕМ ПРОПУСКИ В ПЛАНОВЫХ ТРЕНИРОВКАХ, А НЕ В ДНЯХ: у Валентины
   * настоящие промежутки между пробежками 3, 3 и 4 дня, и порог «четыре дня»
   * сработал бы на её обычном ритме. Разбор — в шапке missedPlannedStreak.
   */
  const pauses = await listPauses(String(source.id));
  const missedStreak = missedPlannedStreak({
    plannedDates: allCycleSessions
      .filter((session) => releasedStarts.has(session.weekStart))
      .map((session) => session.sessionDate),
    runDates,
    checkinDates: pastCheckins.map((checkin) => checkin.sessionDate),
    asOfIso: today,
  });
  const pauseNow = pauseCovering(today, pauses);
  const recentPause = pauses.find(
    (pause) => (pause.endedOn ?? today) >= shiftIso(today, -14)
  ) ?? null;
  console.log(
    `ПЕРЕРЫВ: пропущено плановых подряд ${missedStreak}` +
      ` · пауза ${pauseNow ? "ОТКРЫТА" : recentPause ? `была (${pauseLabelRu(recentPause, today)})` : "нет"}`
  );
  let rung = rungByCode(floorPresetCode) ?? rungByWorkMinutes(floor?.workMinutes ?? null);
  let firstQualityWeek = true;
  console.log(
    `ПОЛ: ${floor ? `${floor.workMinutes} мин работы (неделя ${floor.weekStart}, отдана)` : "отданных недель нет"}` +
      ` · формат ${floorPresetCode ?? "рукой"}` +
      ` · ступень ${rung === null ? "НЕ ОПРЕДЕЛИЛАСЬ" : rung}` +
      ` · боль ${hasPain ? "ЕСТЬ" : "нет"} · полоса RPE ${rpeBand ?? "нет"}`
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
    /**
     * ПРИЧИНА ДЕЙСТВУЕТ ОДИН РАЗ, НА ПЕРВОЙ КАЧЕСТВЕННОЙ НЕДЕЛЕ. Боль и тяжёлая
     * полоса — факты про ПРОШЛУЮ неделю; применять их к пятой неделе вперёд
     * значило бы утверждать, что человек будет болеть весь цикл.
     */
    const isDeload = String(forecastWeek.role).includes("разгруз");
    const step = decideLadderStep({
      fromRung: rung,
      isDeload,
      hasPain: firstQualityWeek && hasPain,
      rpeBand: firstQualityWeek ? rpeBand : "calm",
    });
    target.preferQualityPreset = step.code;
    target.preferQualityPresets = step.codesPreferred;
    target.ladderNoteRu = step.noteRu;
    target.minQualityWorkMin = floor?.workMinutes ?? null;
    if (!isDeload) firstQualityWeek = false;

    /**
     * БОЛЕЗНЬ БОЛЬШЕ НЕ ЗАХАРДКОЖЕНА ЛОЖЬЮ [наряд Игоря, 06.10.2026].
     *
     * Здесь стояло `false` для всего сегмента. Механика при этом была готова и
     * работала в ростере: hasActiveIllness ронял тир до T1, срезал неделю по
     * факту и обнулял масштаб полов. У сегмента без часов она просто никогда не
     * включалась.
     *
     * ПРИЗНАК СТАВИТСЯ ПО ДНЮ ЭТОЙ НЕДЕЛИ, а не «болел ли человек когда-нибудь»:
     * собираем мы и будущие недели, и объявлять их все больными значит заморозить
     * план навсегда. Открытая пауза закрывает все будущие даты и потому режет
     * только то, что собирается, пока она открыта.
     */
    const weekUnderPause = pauseCovering(weekStart, pauses) !== null;
    const week = buildWeek(anchors, envelope, catalog, weekStart, weekUnderPause, null, target, prefs);

    /**
     * СТУПЕНЬ ДВИГАЕТСЯ ПО ФАКТУ ЗАПИСАННОГО, А НЕ ПО ЗАДУМАННОМУ [27.09.2026].
     *
     * Сначала было `rung = step.toRung` сразу после решения, и вышел тихий
     * пропуск: 8 × 4 не влез в бюджет недели 3, но ступень всё равно съехала на
     * пятую, и неделя 4 запросила уже 6 × 5. Человек не сделал 8 × 4 никогда, а
     * план считал, что сделал.
     *
     * Теперь ступень берётся из того формата, который РЕАЛЬНО встал в неделю.
     */
    const plannedCode =
      week.sessions
        .map((session) => (session as unknown as { presetCode?: string | null }).presetCode ?? null)
        .map((code) => ({ code, rung: rungByCode(code) }))
        .filter((x) => x.rung !== null)
        .sort((a, b) => (b.rung ?? 0) - (a.rung ?? 0))[0] ?? null;
    /**
     * РАЗГРУЗКА НЕ ДВИГАЕТ СТУПЕНЬ НИ В ЗАПРОСЕ, НИ В УЧЁТЕ [28.09.2026].
     *
     * Запрос я сразу сделал правильным, а учёт — нет, и вышло хуже, чем было.
     * На разгрузке неделя маленькая, формат честно падает по бюджету до 5 × 3,
     * ступень шла ЗА ФАКТОМ и съезжала на вторую. После каждой разгрузки
     * лестница начиналась почти с нуля: 7 × 4, потом 5 × 3, потом снова вверх.
     *
     * Разгрузка существует, чтобы дать переварить уже сделанное. Ступень стоит
     * там, куда её поставила последняя неделя РОСТА.
     */
    if (!isDeload && plannedCode?.rung !== null && plannedCode?.rung !== undefined) {
      rung = plannedCode.rung;
    }

    rebuilt.push({ week, target });
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
