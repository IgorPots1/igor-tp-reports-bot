/**
 * autoplanner-context — сбор контекста атлета для резолвера и сборщика недели.
 *
 * Единственный модуль с I/O в автопланировщике v1. Читает ТОЛЬКО: workout_cache,
 * tp_threshold_applications, tp_zone_snapshots, athlete_training_baselines,
 * operational_signals. Ничего не пишет — ни в БД, ни в TP.
 *
 * Даёт: якоря (лёгкий + порог с фолбэками), объёмный конверт (катящийся 4-нед, §4.1),
 * наблюдаемое распределение дней недели (§4.2).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { buildAnchor, extractEasySample, tierOf, type EasySample, type DateWindow } from "./easy-anchor.ts";
import { buildQualityAnchor, extractQualitySample, type QualitySample } from "./quality-anchor.ts";
import { anchorConfidence } from "./easy-anchor.ts";
import { loadRoster } from "./autoplanner-roster.ts";
import {
  MIN_RUNS_FOR_PERSONAL_FLOOR, countsForEasyFloor, countsForLongFallback,
  easyFloorPersonal, easyMaxPersonal, easyTargetPersonal, isQualityForPractice,
  isTempoForPractice, longDayOfWeek, longRunPractice,
} from "./practice-signals.ts";
import type { AthleteAnchors, Confidence, EasyAnchor, ThresholdAnchor, Tier } from "./pace-resolver.ts";

const ILLNESS_TYPES = ["health_issue_started", "health_issue_improving", "pain_injury", "pause_training"];

/**
 * ХВОСТ ПОСЛЕ ЗАКРЫТИЯ СИГНАЛА. Было 14 дней — данными не подтверждается.
 *
 * Замер (247 закрытых сигналов, отношение недельного объёма к среднему ДО сигнала):
 * первая неделя после закрытия 0.99, вторая 1.04, третья 1.24. То есть провала после закрытия
 * НЕТ ВООБЩЕ — человек возвращается к прежнему объёму сразу. Двухнедельный хвост держал
 * половину ростера (48 из 107) на урезанном потолке без всякого основания в данных.
 *
 * Оставляем 3 дня — не «на всякий случай», а под конкретный край: сигнал может быть закрыт
 * задним числом в день, когда тренировка уже пропущена. Данные допускают и 0.
 */
const ILLNESS_TAIL_DAYS = 3;

/**
 * Сколько длится сигнал, у которого не проставлено окончание. Было 21 день.
 * Замер по типам (медиана): недомогание 5, улучшение 3, боль/травма 9.5, пауза 3; максимум 25.
 * Незакрытых сигналов почти нет (199 из 200 «недомоганий» закрыты), так что дефолт срабатывает
 * редко — но 21 день был втрое выше реальной медианы.
 */
const ILLNESS_DEFAULT_DAYS = 7;
/** §1.6: аварийный путь, когда нет ни своего якоря, ни зоны 2. Ground truth n=53. */
export const K_COHORT = 1.231;
/** Полоса вокруг когортной середины, чтобы получить пару краёв (узкая — доверие и так low). */
const COHORT_BAND = { fast: 0.97, slow: 1.03 };

const iso = (d: number): string => new Date(d).toISOString().slice(0, 10);
const todayIso = (): string => iso(Date.now());
const addDays = (s: string, n: number): string => iso(Date.parse(s) + n * 86400000);
export function mondayOf(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  return iso(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000);
}

export type Envelope = {
  /** катящийся 4-нед: средние минуты бега в неделю (считается на лету, §4.1) */
  rolling4wWeeklyMin: number;
  rolling4wFrequency: number;
  rolling4wQuality: number;
  /** качественных сессий за 8 недель — потолок качества считается ОТСЮДА, не из baselines */
  qualityLast8w: number;
  /**
   * КАЧЕСТВЕННЫХ В ПОСЛЕДНЕЙ ПОЛНОЙ ПЛАНОВОЙ НЕДЕЛЕ. Отсюда скелет берёт, сколько их ставить
   * (см. qualityCountWanted): по бэктесту прошлая неделя предсказывает лучше среднего,
   * медианы и p75 сразу по всем осям.
   */
  lastWeekQualityCount: number;
  /**
   * ЕСТЬ ЛИ У АТЛЕТА В ПРАКТИКЕ ТЕМПОВЫЙ и ОТРЕЗКИ (за 26 недель). Проверка НАЛИЧИЯ, а не
   * доли: тем же способом решается, брать ли заголовки длительных или запасной детектор.
   * Нужны, чтобы вторая качественная была того типа, который человек реально делает.
   */
  hasTempoPractice: boolean;
  hasIntervalPractice: boolean;
  /** объём последней ФАКТИЧЕСКОЙ недели, мин — используется для сигналов, НЕ для потолка */
  lastWeekMinutes: number;
  /** катящийся 4-нед ПЛАНОВЫЙ объём, мин — та же валюта, что у полов сессий */
  rolling4wPlannedMin: number;
  /** плановый объём последней недели, мин — ОТ НЕГО считается потолок прироста */
  lastWeekPlannedMinutes: number;
  /** медиана планового объёма недели за всё окно, мин — «обычная» неделя атлета (0 — планов нет) */
  typicalPlannedWeekMin: number;
  /** выполнено/запланировано за окно, null — планов не было */
  complianceRatio: number | null;
  /** сколько последних недель подряд выполнение ниже порога */
  lowComplianceWeeks: number;
  /** сколько последних недель подряд выполнение ниже порога «не бегает» */
  notRunningWeeks: number;
  /** медиана длительности ОБЫЧНОЙ лёгкой пробежки этого атлета, мин (0 — таких нет) */
  typicalEasyMinutes: number;
  /** объём работы последней качественной (reps × мин), null — истории нет */
  lastQualityWorkMinutes: number | null;
  /** потолки из baselines — ТОЛЬКО как потолки, не как цель */
  capWeeklyMin: number | null;
  capLongRunMin: number | null;
  capQuality: number | null;
  capFrequency: number | null;
  /**
   * ПРАКТИКА ДЛИТЕЛЬНЫХ этого атлета за 26 недель, плановые минуты (0 — таких сессий нет).
   *
   * Зачем отдельно от capLongRunMin: baseline заморожен на окне 11.03–03.06 и с тех пор ни разу
   * не пересчитывался, а у двоих из двенадцати он равен НУЛЮ — и это не решение тренера, а
   * артефакт классификатора: все их сессии в том окне разложились в семейство beginner_run_walk,
   * в семействе long_run оказалось 0 сессий, и потолок записался нулём (проверено по
   * raw_stats_jsonb: max_long_run_duration_minutes = null у 5461678 и 6009851). При этом по
   * заголовкам у обеих в практике есть длительные на 90 мин. Замороженный нуль превращался в
   * потолок 30 мин, сессия переставала быть длиннее обычной лёгкой и переименовывалась в лёгкую —
   * то есть длительной у человека не выдавалось вовсе.
   */
  longRunPracticeMaxMin: number;
  longRunPracticeMedianMin: number;
  /**
   * ЛИЧНЫЙ ПОЛ ЛЁГКОЙ, мин: p10 длительности НЕ-качественных плановых пробежек за 26 недель.
   * 0 — данных мало (меньше MIN_RUNS_FOR_PERSONAL_FLOOR), брать когортный.
   *
   * ЗАЧЕМ. Когортный пол 25 мин — это минимум ПО ВСЕМУ РОСТЕРУ, и он пускал в неделю сессии
   * 35-40 мин тем, кому тренер короче 60 не ставит: у 5476215 в его собственной неделе нет
   * ничего короче 60, а сборщик выдавал 35 и 40. Объём при этом совпадал — рваным был СОСТАВ.
   * Пятая правка одной природы: когортное число в роли личного предела.
   */
  easyFloorPersonalMin: number;
  /** ЛИЧНАЯ ЦЕЛЬ лёгкой: медиана той же выборки. 0 — данных мало, берётся цель тира. */
  easyTargetPersonalMin: number;
  /** ЛИЧНЫЙ ПОТОЛОК лёгкой: p90 той же выборки. 0 — данных мало, берётся когортный EASY_MAX. */
  easyMaxPersonalMin: number;
  /** наблюдаемое распределение дней недели: 0=Пн … 6=Вс → сколько пробежек */
  dayHistogram: number[];
  /**
   * РАСПРЕДЕЛЕНИЕ ДНЕЙ ОТДЕЛЬНО ПО РОЛЯМ.
   *
   * ЗАЧЕМ. Раньше день длительной брался как argmax ОБЩЕЙ гистограммы, то есть из дня,
   * в который человек просто чаще всего бегает. Замер 12.08: argmax общей гистограммы
   * совпадает с настоящим днём длительной лишь у 27 атлетов из 99. Общая гистограмма
   * заполнена лёгкими днями и про длительную не говорит ничего — тренер видел это как
   * «длительная во вторник».
   */
  dayHistogramLong: number[];
  dayHistogramQuality: number[];
  dayHistogramEasy: number[];
  weeksObserved: number;
};

export type AthleteContext = AthleteAnchors & {
  envelope: Envelope;
  illness: DateWindow[];
  hasActiveIllness: boolean;
  /** null — тир по объёму не понижался. Иначе почему понижен (видно в отчёте и в сессии). */
  tierNote: string | null;
};

/**
 * Фактический объём последней недели ниже этой доли от скользящего среднего = «резко ниже».
 *
 * ЗАМЕРЕНО 16.08 ПО РЕАКЦИИ ТРЕНЕРА, не угадано. Прямых меток тира в данных нет, поэтому мерили
 * поведение: после недели с провалом факта — насколько Игорь режет ПЛАН следующей недели.
 *   факт/среднее <0.3    → план следующей недели ×0.82 (p25 0.47), урезка >20% в 47% случаев
 *   факт/среднее 0.3–0.5 → ×0.96, урезка в 36%
 *   факт/среднее 0.5–0.7 → ×1.00, урезка в 25%   ← НЕОТЛИЧИМО от нормы
 *   факт/среднее >=0.9   → ×1.03, урезка в 22%
 * То есть на провале до 60% тренер не реагирует ВООБЩЕ, а прежний порог 0.6 понижал тир.
 * Практика ломается на 0.3 — туда порог и ставится.
 */
export const TIER_DROP_VOLUME_RATIO = 0.3;

/**
 * Выполнение ниже этой доли считается низким. Параметр, не зашит в логику.
 *
 * ЗАМЕР 16.08 ОСТАВИЛ ВОПРОС ТРЕНЕРУ. Выполнение факт/план по неделям (n=2487): медиана 0.98;
 * среди недель с ненулевым фактом p25 0.69, p10 0.42. Ровно нулевой факт у 12% недель.
 * Гейт срабатывает по ТРЁМ неделям подряд, поэтому мерили серии:
 *   порог 0.80 → задет 67 атлет из 123      порог 0.70 → 56      порог 0.60 → 46
 *   порог 0.50 → 30                          порог 0.40 → 26
 * При нынешних 0.70 пометку хоть раз получает почти половина ростера — для «обрати внимание»
 * это много. Но это ПОМЕТКА ТРЕНЕРУ, а не урезка объёма (объём режет только NOT_RUNNING_RATIO),
 * и насколько чувствительным должен быть личный сигнал — решает Игорь, а не распределение.
 * ОСТАВЛЕНО 0.70 до явного решения.
 */
export const LOW_COMPLIANCE_RATIO = 0.7;
/** Столько недель подряд низкого выполнения — и неделя получает пометку тренеру. */
export const LOW_COMPLIANCE_WEEKS = 3;

/**
 * «НЕ БЕГАЕТ» — это не то же, что «недобегает». Обычное недовыполнение (около 80% плана) объём
 * НЕ режет: план и так пишется с запасом. А вот выполнение НИЖЕ 40% несколько недель подряд
 * означает, что человек фактически не тренируется, и планировать ему от плана здорового
 * периода — значит выдать недоступный объём. Пороги параметрами, не зашиты в логику.
 */
export const NOT_RUNNING_RATIO = 0.4;
export const NOT_RUNNING_WEEKS = 3;



const TIER_DOWN: Record<Tier, Tier> = { T3: "T2", T2: "T1", T1: "T1" };

/**
 * Понижение тира: активный health-сигнал — сразу в T1 (контроль по ощущениям), резкое падение
 * фактического объёма — на ступень вниз. Скользящее среднее за 4 недели инерционно и держит
 * тир высоким, когда человек уже не бегает.
 */
export function downgradeTier(
  base: Tier,
  ctx: { hasActiveIllness: boolean; lastWeekMinutes: number; rolling4wWeeklyMin: number },
): { tier: Tier; tierNote: string | null } {
  if (ctx.hasActiveIllness) {
    return base === "T1" ? { tier: "T1", tierNote: null }
      : { tier: "T1", tierNote: `тир ${base} → T1: активный health-сигнал, контроль по ощущениям` };
  }
  const drop = ctx.rolling4wWeeklyMin > 0 && ctx.lastWeekMinutes > 0
    && ctx.lastWeekMinutes < ctx.rolling4wWeeklyMin * TIER_DROP_VOLUME_RATIO;
  if (drop && base !== "T1") {
    return { tier: TIER_DOWN[base],
      tierNote: `тир ${base} → ${TIER_DOWN[base]}: прошлая неделя ${ctx.lastWeekMinutes} мин против средних ${ctx.rolling4wWeeklyMin}` };
  }
  return { tier: base, tierNote: null };
}

type Row = {
  trainingpeaks_athlete_id: number; student_id: string | null; workout_date: string;
  title: string | null; is_completed: boolean | null; completed_time_raw: number | null;
  completed_distance_raw: number | null; description: string | null;
  is_planned: boolean | null; planned_time_raw: number | null;
};

async function pullRuns(sb: SupabaseClient, sinceDays: number): Promise<Row[]> {
  const since = addDays(todayIso(), -sinceDays);
  const out: Row[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from("trainingpeaks_workout_cache")
      .select("trainingpeaks_athlete_id, student_id, workout_date, title, is_completed, completed_time_raw, completed_distance_raw, is_planned, planned_time_raw, description:source_snapshot->>description")
      .eq("workout_type_value_id", 3).gte("workout_date", since).order("workout_date").range(f, f + 999);
    if (error) throw error;
    out.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Порог: последнее применённое значение + классификация источника по истории тиров. */
async function pullThresholds(sb: SupabaseClient): Promise<Map<number, ThresholdAnchor>> {
  const { data, error } = await sb.from("tp_threshold_applications")
    .select("trainingpeaks_athlete_id, value_after, applied_at, kind, tier")
    .eq("kind", "pace").neq("tier", "rollback").order("applied_at", { ascending: false });
  if (error) throw error;
  const latest = new Map<number, number>();
  const tiers = new Map<number, Set<string>>();
  for (const r of (data ?? []) as Array<{ trainingpeaks_athlete_id: number; value_after: number; tier: string | null }>) {
    const id = r.trainingpeaks_athlete_id;
    if (!latest.has(id) && r.value_after) latest.set(id, 1000 / r.value_after); // m/s → сек/км
    (tiers.get(id) ?? tiers.set(id, new Set()).get(id)!).add(r.tier ?? "");
  }
  const RACE_TIERS = new Set(["10к забег", "полумарафон", "5к забег", "марафон"]);
  const out = new Map<number, ThresholdAnchor>();
  for (const [id, paceSec] of latest) {
    const t = tiers.get(id) ?? new Set<string>();
    const hasRestore = t.has("restore");
    const hasRace = [...t].some((x) => RACE_TIERS.has(x));
    const hasCandidate = t.has("candidate");
    // restore / подтверждение забегом = решение тренера → high.
    // ТОЛЬКО candidate = смешанное качество (часть — согласие со сканом) → medium, не high.
    // Ни того ни другого (историческая массовая простановка) → bulk_only, medium_low.
    let source: ThresholdAnchor["source"]; let confidence: Confidence;
    if (hasRestore || hasRace) { source = "applied_threshold_coach"; confidence = "high"; }
    else if (hasCandidate) { source = "applied_threshold_coach"; confidence = "medium"; }
    else { source = "applied_threshold_bulk_only"; confidence = "medium_low"; }
    out.set(id, { paceSec, source, confidence });
  }
  return out;
}

/** Зона 2 (Endurance Run) из последнего снапшота TP: вторая зона набора workoutTypeId=0. */
async function pullZone2(sb: SupabaseClient): Promise<Map<number, { fastSec: number; slowSec: number }>> {
  const { data, error } = await sb.from("tp_zone_snapshots")
    .select("trainingpeaks_athlete_id, zones, captured_at").order("captured_at", { ascending: false });
  if (error) throw error;
  const out = new Map<number, { fastSec: number; slowSec: number }>();
  for (const r of (data ?? []) as Array<{ trainingpeaks_athlete_id: number; zones: unknown }>) {
    const id = r.trainingpeaks_athlete_id;
    if (out.has(id)) continue; // самый свежий снапшот
    const z = r.zones as { speedZones?: Array<{ workoutTypeId?: number; zones?: Array<{ minimum?: number; maximum?: number }> }> } | null;
    const set0 = z?.speedZones?.find((s) => Number(s.workoutTypeId) === 0);
    const z2 = set0?.zones?.[1]; // индекс 1 = вторая зона = Endurance Run
    if (!z2 || !z2.minimum || !z2.maximum) continue;
    out.set(id, { fastSec: Math.round(1000 / z2.maximum), slowSec: Math.round(1000 / z2.minimum) });
  }
  return out;
}

async function pullBaselines(sb: SupabaseClient): Promise<Map<number, { wk: number | null; long: number | null; q: number | null; freq: number | null }>> {
  const { data, error } = await sb.from("athlete_training_baselines")
    .select("trainingpeaks_athlete_id, weekly_minutes_cap, long_run_cap_min, quality_count_cap, frequency_cap, is_current")
    .eq("is_current", true);
  if (error) throw error;
  const m = new Map<number, { wk: number | null; long: number | null; q: number | null; freq: number | null }>();
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    const id = Number(r.trainingpeaks_athlete_id); if (!Number.isFinite(id)) continue;
    m.set(id, { wk: r.weekly_minutes_cap as number | null, long: r.long_run_cap_min as number | null,
      q: r.quality_count_cap as number | null, freq: r.frequency_cap as number | null });
  }
  return m;
}

async function pullIllness(sb: SupabaseClient): Promise<Map<string, DateWindow[]>> {
  const { data, error } = await sb.from("trainingpeaks_student_operational_signals")
    .select("student_id, signal_type, valid_from, valid_until, source_date, target_date, created_at, resolved_at")
    .in("signal_type", ILLNESS_TYPES);
  if (error) throw error;
  const m = new Map<string, DateWindow[]>();
  for (const s of (data ?? []) as Array<Record<string, unknown>>) {
    const sid = s.student_id as string | null; if (!sid) continue;
    const from = (s.valid_from ?? s.source_date ?? s.target_date ?? (typeof s.created_at === "string" ? (s.created_at as string).slice(0, 10) : null)) as string | null;
    if (!from) continue;
    let to = (s.valid_until ?? (typeof s.resolved_at === "string" ? (s.resolved_at as string).slice(0, 10) : null)) as string | null;
    if (!to || to < from) to = addDays(from, ILLNESS_DEFAULT_DAYS);
    to = addDays(to, ILLNESS_TAIL_DAYS);
    (m.get(sid) ?? m.set(sid, []).get(sid)!).push({ from, to });
  }
  return m;
}

const QUALITY_TITLE_RE = /([0-9]+\s*[xх×]\s*[0-9]|интерв|отрезк|повтор|порог|фартлек|vo\s?2|мпк|темп выше)/i;
/** Так тренер называет длительные. Нужен, чтобы отделить их от обычных лёгких. */
const LONG_TITLE_RE = /длительн|длинн/i;



/**
 * Собрать контекст по всем ДЕЙСТВУЮЩИМ атлетам. asOf = дата, «на которую» считаем.
 *
 * ФИЛЬТР АКТИВНОСТИ ЖИВЁТ ЗДЕСЬ НАМЕРЕННО. Отсюда кормятся и генератор недель, и пакет на
 * приёмку, и теневое сравнение — значит фильтр применится ко всем трём сам, и его нельзя
 * забыть подключить в новом вызывающем месте. До 16.08 ростером было «все, у кого есть
 * пробежки в кэше», и недели уходили архивным, ушедшим и служебному аккаунту тренера.
 */
export async function loadAthleteContexts(sb: SupabaseClient, asOf: string = todayIso()): Promise<Map<number, AthleteContext>> {
  const [rows, thresholds, zone2, baselines, illnessByStudent, roster] = await Promise.all([
    pullRuns(sb, 200), pullThresholds(sb), pullZone2(sb), pullBaselines(sb), pullIllness(sb), loadRoster(sb),
  ]);

  const byAth = new Map<number, Row[]>();
  for (const r of rows) {
    // Не в списке действующих — контекста не строим вообще: ни в план, ни в замер, ни в метрику.
    if (!roster.active.has(r.trainingpeaks_athlete_id)) continue;
    (byAth.get(r.trainingpeaks_athlete_id) ?? byAth.set(r.trainingpeaks_athlete_id, []).get(r.trainingpeaks_athlete_id)!).push(r);
  }

  const out = new Map<number, AthleteContext>();
  const win4wStart = addDays(asOf, -28);
  const win8wStart = addDays(asOf, -56);
  // 26 недель — окно практики длительных. pullRuns тянет 200 дней, так что окно помещается целиком.
  const win26wStart = addDays(asOf, -182);

  for (const [aid, rs] of byAth) {
    let sid: string | null = null;
    const samples: EasySample[] = []; const seen = new Set<string>();
    const dayHistogram = [0, 0, 0, 0, 0, 0, 0];
    const weekMin = new Map<string, number>(); const weekFreq = new Map<string, number>(); const weekQual = new Map<string, number>();
    const weekPlanned = new Map<string, number>();
    const easyPlannedMinutes: number[] = []; const longPlannedMinutes: number[] = [];
    const easyFloorSamples: number[] = [];
    const nonQualPlanned26w: number[] = [];
    const qualityDates: string[] = []; let lastQ: { date: string; work: number } | null = null;
    const qSamples: QualitySample[] = [];
    let hasTempoPractice = false; let hasIntervalPractice = false;
    // Плановые сессии по неделям — нужны, чтобы разложить дни ПО РОЛЯМ (см. dayHistogramLong).
    // Роль «длительная» определяется по заголовку, а при его отсутствии — самой длинной
    // не-качественной сессией недели: тем же запасным правилом, что и длительность.
    const weekSess = new Map<string, Array<{ day: number; min: number; quality: boolean; longTitled: boolean }>>();

    // СТРОГО ДО asOf. buildAnchor фильтрует свои сэмплы по дате сам, а конверт объёма,
    // гистограмма дней и история качества — НЕТ: они собирались по всем строкам подряд.
    // Для живого прогона это почти незаметно (asOf = сегодня), но для теневого сравнения
    // это обучение НА БУДУЩЕМ, то есть тест ни о чём. Фильтруем один раз на входе.
    for (const r of rs) {
      if (r.workout_date >= asOf) continue;
      if (r.student_id) sid = r.student_id;
      const qs = r.title ? extractQualitySample(r.title, r.description ?? "") : null;
      if (qs) qSamples.push({ date: r.workout_date, fast: qs.fast, slow: qs.slow, workMinutes: qs.workMinutes, reps: qs.reps });
      const s = r.title ? extractEasySample(r.title, r.description ?? "") : null;
      if (s) {
        const k = `${r.workout_date}|${s.fast}|${s.slow}`;
        if (!seen.has(k)) { seen.add(k); samples.push({ date: r.workout_date, fast: s.fast, slow: s.slow, ceilingOnly: s.ceilingOnly }); }
      }
      // ПЛАНОВЫЙ объём копим отдельно: потолок недели считается в ТОЙ ЖЕ валюте, что и полы
      // сессий (полы измерены по планам тренера). Смешение с фактом сжимало неделю каждый прогон.
      // ── ПЛАНОВАЯ ВАЛЮТА: объём, ЧАСТОТА, дни недели и история качества ──
      // Всё, что задаёт ФОРМУ будущей недели, берётся из планов тренера — той же валютой,
      // что потолок и полы сессий. Раньше форму задавали ЗАВЕРШЁННЫЕ пробежки: частота была
      // медианой того, что человек добежал, и малообъёмные получали на день-полтора меньше,
      // а вместе с днём терялось качество (замер 13.08: T1 объём ×0.57, качество 3 против 258
      // у тренера; T3, который добегает почти всё, — ×0.97 и 32 против 28).
      if (r.is_planned && (r.planned_time_raw ?? 0) > 0) {
        const wkp = mondayOf(r.workout_date);
        weekPlanned.set(wkp, (weekPlanned.get(wkp) ?? 0) + (r.planned_time_raw as number) * 60);
        weekFreq.set(wkp, (weekFreq.get(wkp) ?? 0) + 1);
        const d = new Date(r.workout_date + "T00:00:00Z");
        const dayIdx = (d.getUTCDay() + 6) % 7;
        dayHistogram[dayIdx] += 1;
        {
          const ttl = r.title ?? "";
          (weekSess.get(wkp) ?? weekSess.set(wkp, []).get(wkp)!).push({
            day: dayIdx, min: Math.round((r.planned_time_raw as number) * 60),
            quality: isQualityForPractice(ttl, QUALITY_TITLE_RE), longTitled: LONG_TITLE_RE.test(ttl),
          });
        }
        // СЧЁТЧИК КАЧЕСТВА — ПО ПОЧИНЕННОМУ КЛАССИФИКАТОРУ (правка 12.08).
        // Прежде здесь стояла голая QUALITY_TITLE_RE, и она ошибалась в ОБЕ стороны:
        // считала работой «Легкий бег по темпу (темп выше)» (по замеру это обычная лёгкая,
        // разница темпа с ней 0 с/км) и НЕ ВИДЕЛА «Темповый бег 30 минут» — а это ровно та
        // вторая качественная, которую Игорь ставит Паниной, Кругловой и Хофман.
        // Пороги гейта (3 и 6 за 8 недель) перемерены на починенном классификаторе и держатся:
        // у недели с одной качественной p10 истории по-прежнему 3, у недели с двумя p25 = 6.
        const t = r.title ?? "";
        if (t && isQualityForPractice(t, QUALITY_TITLE_RE)) {
          weekQual.set(wkp, (weekQual.get(wkp) ?? 0) + 1);
          if (r.workout_date >= win26wStart) {
            if (isTempoForPractice(t, QUALITY_TITLE_RE)) hasTempoPractice = true;
            else hasIntervalPractice = true;
          }
          if (r.workout_date >= win8wStart) {
            qualityDates.push(r.workout_date);
            const m = /([0-9]{1,2})\s*[xх×]\s*([0-9]{1,2}(?:[.,][0-9])?)\s*(мин|min)/i.exec(t);
            if (m) { const w = Number(m[1]) * Number(m[2].replace(",", ".")); if (Number.isFinite(w) && w > 0 && w <= 90) lastQ = { date: r.workout_date, work: w }; }
          }
        }
        // «Обычная лёгкая» этого атлета: нужна, чтобы не называть длительной сессию, которая
        // на самом деле обычная лёгкая (у T1 длительных в практике нет вовсе).
        // «Обычная лёгкая» — тоже по починенному классификатору: «Темповый бег 30 минут»
        // длится 59 мин и, попадая сюда, задирал медиану обычной лёгкой, от которой зависит
        // именование длительной.
        if (t && !isQualityForPractice(t, QUALITY_TITLE_RE) && !LONG_TITLE_RE.test(t)) {
          const m = Math.round((r.planned_time_raw as number) * 60);
          if (m > 0 && m <= 300) easyPlannedMinutes.push(m);
        }
        // ПРАКТИКА ДЛИТЕЛЬНЫХ за 26 недель — источник потолка длительной вместо мёртвого baseline.
        if (t && LONG_TITLE_RE.test(t) && r.workout_date >= win26wStart) {
          const m = Math.round((r.planned_time_raw as number) * 60);
          if (m > 0 && m <= 400) longPlannedMinutes.push(m);
        }
        // ЛИЧНЫЙ ПОЛ ЛЁГКОЙ: не-качественные и не-разминки за 26 недель.
        // «Темп выше» здесь АЭРОБНЫЙ — по замеру (76% от порога против 83% у обычной лёгкой),
        // как и в детекторе длительных. Без этой поправки у 5748681 в выборку не попадало
        // почти ничего (её лёгкие названы «Лёгкий бег (темп выше)»), личного пола не
        // получалось вовсе, и она оставалась на когортных 25 с сессией в 35 мин.
        {
          const m = Math.round((r.planned_time_raw as number) * 60);
          if (r.workout_date >= win26wStart && countsForEasyFloor(t, m, QUALITY_TITLE_RE)) easyFloorSamples.push(m);
        }
        // ЗАПАСНОЙ ДЕТЕКТОР: все НЕ-качественные за 26 недель. Нужен там, где тренер вообще
        // не пишет в заголовке «длительная» — см. longRunPracticeMedianMin ниже.
        // «ТЕМП ВЫШЕ» ЗДЕСЬ СЧИТАЕТСЯ АЭРОБНЫМ — по ЗАМЕРУ, а не по регулярке.
        // QUALITY_TITLE_RE держит «темп выше» качественной, но отдельным нарядом было измерено,
        // что это 76% от порога против 83% у обычной лёгкой, то есть аэробный бег (см.
        // lib/quality-volume.ts, TEMPO_MARKER_RE). Для детектора ДЛИТЕЛЬНЫХ это принципиально:
        // у 5748681 пять сессий по 100 мин названы «Лёгкий бег (темп выше)», и по регулярке
        // её медиана длительных падала со 100 до 60. Саму QUALITY_TITLE_RE не трогаем — она
        // кормит счётчики качества по всему автопланировщику, её правка отдельный наряд.
        {
          const m = Math.round((r.planned_time_raw as number) * 60);
          if (r.workout_date >= win26wStart && countsForLongFallback(t, m, QUALITY_TITLE_RE)) nonQualPlanned26w.push(m);
        }
      }
      // ── ФАКТИЧЕСКАЯ ВАЛЮТА: только там, где вопрос именно «что человек СДЕЛАЛ» ──
      // потолок при травме, понижение тира, выполнение плана. Форму недели факт не задаёт.
      if (r.is_completed && (r.completed_time_raw ?? 0) > 0) {
        const wk = mondayOf(r.workout_date);
        weekMin.set(wk, (weekMin.get(wk) ?? 0) + (r.completed_time_raw as number) * 60);
      }
    }

    // НЕДЕЛЯ, В КОТОРУЮ ПОПАЛ asOf, — НЕПОЛНАЯ ПО ПОСТРОЕНИЮ и в конверт не идёт.
    // Фильтр «строго до asOf» (нужный теневому тесту) обрезает её на середине: замер 14.08,
    // вторник — видно 23 плановых пробежки из 285. Из-за этого lastWeekPlannedMinutes падал
    // в разы, а член «+10% к плану прошлой недели» схлопывал потолок у 39 атлетов
    // (медиана потолок/плановый rolling4w = 0.78 при p10 0.32).
    const cutoffWeek = mondayOf(asOf);
    const completeWeek = (w: string): boolean => w < cutoffWeek;

    // катящийся 4-нед (§4.1): считаем на лету, персистированное не читаем
    const recentWeeks = [...weekMin.keys()].filter((w) => w >= win4wStart && completeWeek(w)).sort();
    const rolling4wWeeklyMin = recentWeeks.length
      ? Math.round(recentWeeks.reduce((a, w) => a + (weekMin.get(w) ?? 0), 0) / recentWeeks.length) : 0;
    const recentPlannedWeeks = [...weekPlanned.keys()].filter((w) => w >= win4wStart && completeWeek(w)).sort();
    // Частота и качество усредняются по ПЛАНОВЫМ неделям: они и накоплены в плановой валюте,
    // а деление на число ФАКТИЧЕСКИХ недель дало бы бессмысленную смесь.
    const avgPlanned = (m: Map<string, number>): number =>
      recentPlannedWeeks.length ? recentPlannedWeeks.reduce((a, w) => a + (m.get(w) ?? 0), 0) / recentPlannedWeeks.length : 0;
    const rolling4wPlannedMin = recentPlannedWeeks.length
      ? Math.round(recentPlannedWeeks.reduce((a, w) => a + (weekPlanned.get(w) ?? 0), 0) / recentPlannedWeeks.length) : 0;
    const lastWeekPlannedMinutes = (() => {
      const ks = [...weekPlanned.keys()].filter(completeWeek).sort();
      return ks.length ? Math.round(weekPlanned.get(ks[ks.length - 1]) ?? 0) : 0;
    })();
    // КАЧЕСТВЕННЫХ В ПОСЛЕДНЕЙ ПОЛНОЙ ПЛАНОВОЙ НЕДЕЛЕ — та же неделя, что и lastWeekPlannedMinutes,
    // то есть та же валюта и то же окно. Неполная текущая неделя сюда не попадает: иначе в
    // понедельник счётчик читался бы как «качества не было» и вторая сессия молча пропадала.
    const lastWeekQualityCount = (() => {
      const ks = [...weekPlanned.keys()].filter(completeWeek).sort();
      return ks.length ? (weekQual.get(ks[ks.length - 1]) ?? 0) : 0;
    })();
    // ОБЫЧНАЯ неделя атлета — медиана планового объёма за ВСЁ окно, а не за 4 недели.
    // Нужна, чтобы отличить «прошлая неделя была нормальной» от «прошлая неделя была провалом»:
    // потолок прироста меряется от нормы, а провал нормой не является (замер 16.08: рост от
    // нормальной базы p90 = 1.22, а возврат из провала — медиана 1.65, p90 = 3.00).
    const typicalPlannedWeekMin = (() => {
      const xs = [...weekPlanned.keys()].filter(completeWeek).map((w) => weekPlanned.get(w) ?? 0)
        .filter((x) => x > 0).sort((a, b) => a - b);
      if (xs.length === 0) return 0;
      const i = (xs.length - 1) / 2;
      return Math.round(Number.isInteger(i) ? xs[i] : (xs[Math.floor(i)] + xs[Math.ceil(i)]) / 2);
    })();

    // ВЫПОЛНЕНИЕ НЕ ВЫБРАСЫВАЕМ, но объём им НЕ режем: низкое выполнение — повод показать
    // тренеру, а не молча ужать план (замер 12.08: медиана выполнено/запланировано 0.83,
    // у 41 атлета из 119 ниже 70% — на факте потолок сжимался каждый прогон).
    const plannedTotal = recentPlannedWeeks.reduce((a, w) => a + (weekPlanned.get(w) ?? 0), 0);
    const doneTotal = recentPlannedWeeks.reduce((a, w) => a + (weekMin.get(w) ?? 0), 0);
    const complianceRatio = plannedTotal > 0 ? Math.round((doneTotal / plannedTotal) * 100) / 100 : null;
    let lowComplianceWeeks = 0;
    for (const w of [...weekPlanned.keys()].sort().reverse()) {
      const pl = weekPlanned.get(w) ?? 0; if (pl <= 0) continue;
      if ((weekMin.get(w) ?? 0) / pl < LOW_COMPLIANCE_RATIO) lowComplianceWeeks++; else break;
    }
    let notRunningWeeks = 0;
    for (const w of [...weekPlanned.keys()].sort().reverse()) {
      const pl = weekPlanned.get(w) ?? 0; if (pl <= 0) continue;
      if ((weekMin.get(w) ?? 0) / pl < NOT_RUNNING_RATIO) notRunningWeeks++; else break;
    }

    const sortedEasy = easyPlannedMinutes.sort((x, y) => x - y);
    const typicalEasyMinutes = sortedEasy.length
      ? (sortedEasy.length % 2 ? sortedEasy[(sortedEasy.length - 1) / 2]
        : Math.round((sortedEasy[sortedEasy.length / 2 - 1] + sortedEasy[sortedEasy.length / 2]) / 2))
      : 0;

    const medOf = (arr: number[]): number => {
      if (!arr.length) return 0;
      const s2 = [...arr].sort((x, y) => x - y);
      return s2.length % 2 ? s2[(s2.length - 1) / 2]
        : Math.round((s2[s2.length / 2 - 1] + s2[s2.length / 2]) / 2);
    };
    // ЗАПАСНОЙ ДЕТЕКТОР ДЛИТЕЛЬНЫХ — когда по заголовку не нашлось НИ ОДНОЙ.
    //
    // Замер 12.08: у 5748681 из 100 плановых пробежек за 26 недель заголовку «длительн|длинн»
    // не отвечает НИ ОДНА, при этом пять её сессий по 100 мин называются «Лёгкий бег (темп
    // выше)». То есть «длительных нет» — это дыра ДЕТЕКТОРА, а не факт о человеке: тренер
    // просто не пишет это слово в заголовке.
    //
    // Приближение: медиана верхней децили НЕ-качественных сессий. Проверено против эталона
    // там, где заголовки есть (n=11): точное совпадение у 5 из 11, средняя |ошибка| 9.5 мин,
    // и НИ РАЗУ не ниже эталона — для ПОЛА это правильная сторона ошибки.
    //
    // Включается ТОЛЬКО при полном отсутствии заголовков. Порог «мало заголовков» (например
    // меньше трёх) сюда сознательно НЕ введён: у 5475652 он поднял бы медиану 90 -> 126, и это
    // решение тренера, а не моё. Сегодня ветка срабатывает ровно у одного человека.
    // Все три величины считает чистый practice-signals — там же они и проверяются.
    const easyFloorPersonalMin = easyFloorPersonal(easyFloorSamples);
    const easyTargetPersonalMin = easyTargetPersonal(easyFloorSamples);
    const easyMaxPersonalMin = easyMaxPersonal(easyFloorSamples);
    const longPractice = longRunPractice(longPlannedMinutes, nonQualPlanned26w);
    const longRunPracticeMaxMin = longPractice.maxMin;
    const longRunPracticeMedianMin = longPractice.medianMin;

    // ── ДНИ ПО РОЛЯМ ──
    // Считаем по НЕДЕЛЯМ, а не по строкам: роль «длительная» без заголовка определяется только
    // в контексте своей недели (самая длинная не-качественная). Роль «качество» — по заголовку.
    // Всё остальное — лёгкие.
    const dayHistogramLong = [0, 0, 0, 0, 0, 0, 0];
    const dayHistogramQuality = [0, 0, 0, 0, 0, 0, 0];
    const dayHistogramEasy = [0, 0, 0, 0, 0, 0, 0];
    for (const [, ss] of weekSess) {
      // Выбор дня — в чистой longDayOfWeek: там же он и проверяется. Ничья по минутам
      // наблюдением НЕ СЧИТАЕТСЯ (см. её шапку) — раньше такие недели давали 20% ряда
      // и день брался порядком строк в базе.
      const longDay = longDayOfWeek(ss);
      for (const s of ss) {
        if (s.quality) dayHistogramQuality[s.day] += 1;
        else if (longDay != null && s.day === longDay) dayHistogramLong[s.day] += 1;
        else dayHistogramEasy[s.day] += 1;
      }
    }

    const b = baselines.get(aid);

    // ТИР — ТОЖЕ ОТ ПЛАНА. Полы сессий по тирам измерены на ПЛАНОВЫХ неделях (tp-week-shape-measure
    // тирует по медианному плановому объёму). Считать тир по факту — значит выдавать атлету полы
    // чужого тира: выполнение систематически ниже (медиана 0.83). Это та же ошибка валюты, что
    // и с потолком. Факт остаётся входом ПОНИЖЕНИЯ тира ниже — там ему и место.
    const tierByVolume: Tier = tierOf(rolling4wPlannedMin > 0 ? rolling4wPlannedMin
      : (rolling4wWeeklyMin > 0 ? rolling4wWeeklyMin
        : ([...weekMin.values()].reduce((a, x) => a + x, 0) / Math.max([...weekMin.size ? weekMin.keys() : []].length, 1) || 0)));

    const illness = sid ? illnessByStudent.get(sid) ?? [] : [];
    const hasActiveIllness = illness.some((w) => asOf >= w.from && asOf <= w.to);

    // ТИР ПОСЛЕ ПАДЕНИЯ ОБЪЁМА (правило Игоря 11.08). Скользящее среднее за 4 недели держит
    // тир высоким ещё долго после того, как человек фактически перестал бегать: 5847207 имел
    // тир T2 и получал темп ЦИФРАМИ, при фактической прошлой неделе 25 мин и активной травме.
    // Тир — не заслуга, а описание текущей формы, поэтому он понижается, а контроль уходит
    // на ощущения.
    const lastWeekMin = (() => { const ks = [...weekMin.keys()].filter(completeWeek).sort(); return ks.length ? Math.round(weekMin.get(ks[ks.length - 1]) ?? 0) : 0; })();
    const { tier, tierNote } = downgradeTier(tierByVolume, {
      hasActiveIllness, lastWeekMinutes: lastWeekMin, rolling4wWeeklyMin,
    });

    // ЯКОРЬ ЛЁГКОГО: свой → зона 2 → когортное отношение (§1.6)
    const own = buildAnchor(samples, addDays(asOf, 1), { halfLifeDays: 21, illness });
    let easy: EasyAnchor | null = null;
    if (own) {
      easy = { fastSec: own.fast, slowSec: own.slow, source: "easy_description",
        confidence: anchorConfidence(own.effectiveN) as Confidence, effectiveN: own.effectiveN };
    } else {
      const z2 = zone2.get(aid);
      const thr = thresholds.get(aid);
      if (z2) easy = { fastSec: z2.fastSec, slowSec: z2.slowSec, source: "tp_zone2", confidence: "medium" };
      else if (thr) {
        const mid = thr.paceSec * K_COHORT;
        easy = { fastSec: Math.round(mid * COHORT_BAND.fast), slowSec: Math.round(mid * COHORT_BAND.slow),
          source: "cohort_ratio", confidence: "low" };
      }
    }

    const qAnchor = buildQualityAnchor(qSamples, addDays(asOf, 1), { halfLifeDays: 21, illness });

    out.set(aid, {
      athleteId: aid, tier, easy, threshold: thresholds.get(aid) ?? null,
      quality: qAnchor ? { fastSec: qAnchor.fast, slowSec: qAnchor.slow, confidence: anchorConfidence(qAnchor.effectiveN) as Confidence, effectiveN: qAnchor.effectiveN } : null,
      illness, hasActiveIllness, tierNote,
      envelope: {
        rolling4wWeeklyMin, rolling4wFrequency: Math.round(avgPlanned(weekFreq) * 10) / 10,
        rolling4wQuality: Math.round(avgPlanned(weekQual) * 10) / 10,
        capWeeklyMin: b?.wk ?? null, capLongRunMin: b?.long ?? null,
        capQuality: b?.q ?? null, capFrequency: b?.freq ?? null,
        longRunPracticeMaxMin, longRunPracticeMedianMin, easyFloorPersonalMin,
        easyTargetPersonalMin, easyMaxPersonalMin,
        lastWeekMinutes: lastWeekMin,
        rolling4wPlannedMin, lastWeekPlannedMinutes, typicalPlannedWeekMin, complianceRatio, lowComplianceWeeks, notRunningWeeks, typicalEasyMinutes,
        qualityLast8w: qualityDates.length,
        lastWeekQualityCount, hasTempoPractice, hasIntervalPractice,
        lastQualityWorkMinutes: lastQ ? lastQ.work : null,
        // weeksObserved — про то, есть ли из чего считать КОНВЕРТ, а конверт плановый.
        dayHistogram, dayHistogramLong, dayHistogramQuality, dayHistogramEasy,
        weeksObserved: [...weekPlanned.keys()].filter(completeWeek).length,
      },
    });
  }
  return out;
}
