/**
 * training-cycle — черновик цикла из данных и разворачивание его в недели.
 *
 * ЧИСТЫЕ ФУНКЦИИ, БЕЗ I/O И БЕЗ ВЛИЯНИЯ НА ГЕНЕРАЦИЮ. Сборщик недель этот модуль не
 * импортирует и не должен: цикл пока только хранится и показывается (наряд 11.08, п.5).
 *
 * Спецификация: ops-log/2026-08-11-training-cycle-model.md, части C1 и C2.
 *
 * ПОМЕТКИ ИСТОЧНИКА: [практика] — замерено по данным Игоря; [решение Игоря] — принято
 * тренером и практикой НЕ подтверждается; [выведено] — ни то ни другое.
 */

export type CycleIntent = "5k" | "10k" | "half" | "marathon" | "maintenance";
export type WeekRole = "рост" | "плановая разгрузка" | "подводка" | "старт" | "поддержание";

/** Длина цикла по типу, недель. [литература] — см. часть B спеки; 5k и marathon по аналогии. */
export const LENGTH_WEEKS: Record<CycleIntent, number> = {
  "5k": 11, "10k": 14, half: 16, marathon: 18, maintenance: 8,
};

/** Шаг роста. [практика]: аэробный p90 от нормальной базы n=1715; качество медиана n=488. */
export const STEP_AEROBIC = 1.22;
export const STEP_QUALITY = 1.17;

/** Период плановой разгрузки. [практика] — медианный период между спадами 4.0 нед, n=16. */
export const DELOAD_EVERY_N = 4;

/**
 * ПЛАНОВАЯ разгрузка [решение Игоря]. НОВОЕ ПОВЕДЕНИЕ: в практике такой недели нет.
 * Аэробный −20%, минуты работы −30%, день НЕ убирается, качество НЕ снимается.
 * Не путать с РЕАКТИВНОЙ (health-сигнал / провал): та снимает качество в ноль,
 * режет аэробный на 36% и убирает день [практика, n=16 атлетов / 90 недель].
 */
export const DELOAD_AEROBIC_FACTOR = 0.80;
export const DELOAD_QUALITY_FACTOR = 0.70;

/**
 * ПОДВОДКА — профиль по неделям от предстартового ПИКА. Все числа [решение Игоря],
 * практикой НЕ подтверждаются и глубже неё.
 *
 * Форма ЭКСПОНЕНЦИАЛЬНАЯ: срез нарастает к старту. Неизменно на всех дистанциях —
 * интенсивность сохраняется (темпы те же, режется число минут работы), число беговых
 * дней не уменьшается, объём режется за счёт лёгких и длительной.
 *
 * ФАКТ ПРАКТИКИ ДЛЯ СВЕРКИ [практика], главные старты, неделя −1 от пика:
 *   42.2 −32% (n=12) · 21.1 −15% (n=36) · 10 км +3%, подводки нет (n=13) · 5 км n=2, нечем.
 */
export type TaperWeek = { weeksOut: number; aerobicFactor: number; qualityMinutesFactor: number };
export const TAPER_PROFILE: Record<CycleIntent, TaperWeek[]> = {
  // 5–7 дней: одна неделя, почти весь срез в последние 3 дня
  "5k": [{ weeksOut: 1, aerobicFactor: 0.80, qualityMinutesFactor: 0.75 }],
  // 7–10 дней: одна неделя с более глубоким срезом, основное в последние 4 дня
  "10k": [{ weeksOut: 1, aerobicFactor: 0.75, qualityMinutesFactor: 0.70 }],
  // 10–14 дней: две недели, −20% затем −35%
  half: [
    { weeksOut: 2, aerobicFactor: 0.80, qualityMinutesFactor: 0.85 },
    { weeksOut: 1, aerobicFactor: 0.65, qualityMinutesFactor: 0.65 },
  ],
  // 14–17 дней: три недели, −15% / −35% / −50%
  marathon: [
    { weeksOut: 3, aerobicFactor: 0.85, qualityMinutesFactor: 0.90 },
    { weeksOut: 2, aerobicFactor: 0.65, qualityMinutesFactor: 0.75 },
    { weeksOut: 1, aerobicFactor: 0.50, qualityMinutesFactor: 0.55 },
  ],
  maintenance: [],
};

/** Потолок доли работы в неделе. [практика] p90 = 0.20, n=1132. Держим и в цикле. */
export const WORK_SHARE_MAX = 0.20;

export type CycleDraft = {
  athleteId: number;
  intent: CycleIntent;
  targetRaceId: string | null;
  targetDate: string | null;
  lengthWeeks: number;
  baseAerobicMin: number;
  baseQualityMin: number;
  stepAerobic: number;
  stepQuality: number;
  deloadEveryN: number;
  deloadDepthAerobic: number;
  deloadQualityFactor: number;
  taperProfile: TaperWeek[];
  days: number;
  /**
   * ПОТОЛОК АЭРОБНОГО ОБЪЁМА, мин/нед. Собственный исторический максимум атлета
   * за окно наблюдения [практика].
   *
   * ЗАЧЕМ. Шаг ×1.22 — это ПОТОЛОК ОДНОГО перехода [практика, p90, n=1715], а не темп,
   * который держат неделя за неделей: медиана перехода 0.99, а рост за 26 недель
   * вообще ×1.01 [практика, n=93]. Если применять 1.22 каждую неделю, за пять недель
   * выходит ×2.2 — первый прогон черновика дал атлету 775 мин/нед вместо 350, то есть
   * 13 часов бега. Выход за собственный исторический максимум — это решение тренера,
   * а не следствие арифметики, поэтому цикл сам туда не идёт.
   */
  peakCapAerobicMin: number;
  /** чего не хватило, чтобы черновик был полным */
  gaps: string[];
};

/** Дистанция старта → тип цикла. [выведено] — границы те же, что в замерах подводки. */
export function intentFromDistance(km: number | null): CycleIntent {
  if (km == null) return "maintenance";
  if (km < 7) return "5k";
  if (km < 15) return "10k";
  if (km < 30) return "half";
  return "marathon";
}

export type WeekForecast = {
  index: number;
  weekStart: string;
  role: WeekRole;
  aerobicMin: number;
  qualityMin: number;
  days: number;
  /** какой формат качества закрывает эти минуты работы — подсказка, не предписание */
  qualityHint: string;
  note: string;
};

const round5 = (x: number): number => Math.round(x / 5) * 5;
const addDays = (s: string, n: number): string => new Date(Date.parse(s) + n * 86400000).toISOString().slice(0, 10);

/**
 * Подобрать формат отрезков под минуты работы. Только ПОДСКАЗКА для прогноза:
 * настоящий выбор делает каталог при сборке недели, с гейтами и уровнем пресета.
 * Коды взяты из реального каталога workout_template_presets [практика].
 */
export function qualityFormatHint(workMin: number): string {
  if (workMin <= 0) return "—";
  const catalog: Array<[number, string]> = [
    [20, "4x5"], [20, "5x4"], [24, "3x8"], [24, "6x4"], [30, "5x6"], [30, "6x5"],
    [32, "4x8"], [32, "8x4"], [35, "5x7"], [36, "4x9"], [36, "6x6"], [40, "4x10"],
    [36, "3x12"], [42, "3x14"], [48, "3x16"], [48, "4x12"], [40, "2x20"], [48, "2x24"],
  ];
  let best = catalog[0];
  for (const c of catalog) if (Math.abs(c[0] - workMin) < Math.abs(best[0] - workMin)) best = c;
  return `${best[1]} (${best[0]} мин работы)`;
}

/**
 * Развернуть цикл в недели — ДЛЯ ОТОБРАЖЕНИЯ. Ни к чему не обязывает и в TP не пишется:
 * роль недели пересчитывается при сборке с учётом того, как прошла предыдущая (C2),
 * а реактивная разгрузка может понизить любую неделю в любой момент.
 */
export function forecast(draft: CycleDraft, firstWeekStart: string, weeks: number): WeekForecast[] {
  const out: WeekForecast[] = [];
  let aer = draft.baseAerobicMin;
  let qual = draft.baseQualityMin;
  // ПИК — это максимум РЕАЛЬНО НАЗНАЧЕННЫХ недель роста, а не то, куда ушла бы
  // арифметика, если бы рост продолжался. Первый прогон считал подводку «от пика 775»,
  // хотя 775 не назначались ни разу: подводка началась раньше.
  let peakAer = 0;

  // сколько недель до старта — от этого зависит, где начинается подводка
  const taperLen = draft.taperProfile.length;
  const weeksToRace = draft.targetDate
    ? Math.round((Date.parse(draft.targetDate) - Date.parse(firstWeekStart)) / (7 * 86400000))
    : null;

  for (let i = 1; i <= weeks; i++) {
    const weekStart = addDays(firstWeekStart, 7 * (i - 1));
    const out2go = weeksToRace == null ? null : weeksToRace - (i - 1);

    // старт на этой неделе
    if (out2go === 0) {
      out.push({ index: i, weekStart, role: "старт", aerobicMin: 0, qualityMin: 0, days: draft.days,
        qualityHint: "—", note: `целевой старт ${draft.targetDate}` });
      continue;
    }
    // подводка: последние taperLen недель перед стартом
    if (out2go != null && out2go >= 1 && out2go <= taperLen) {
      const tw = draft.taperProfile.find((t) => t.weeksOut === out2go);
      if (tw) {
        const a = round5(peakAer * tw.aerobicFactor);
        const q = round5(qual * tw.qualityMinutesFactor);
        out.push({ index: i, weekStart, role: "подводка", aerobicMin: a, qualityMin: q, days: draft.days,
          qualityHint: qualityFormatHint(q),
          note: `от ПИКА ${peakAer} мин: аэробный ×${tw.aerobicFactor.toFixed(2)}, работа ×${tw.qualityMinutesFactor.toFixed(2)}`
            + ` · темпы отрезков ТЕ ЖЕ, дней столько же` });
        continue;
      }
    }
    // плановая разгрузка
    if (draft.intent !== "maintenance" && i % draft.deloadEveryN === 0) {
      const a = round5(aer * draft.deloadDepthAerobic);
      const q = round5(qual * draft.deloadQualityFactor);
      out.push({ index: i, weekStart, role: "плановая разгрузка", aerobicMin: a, qualityMin: q, days: draft.days,
        qualityHint: qualityFormatHint(q),
        note: `аэробный ×${draft.deloadDepthAerobic.toFixed(2)}, работа ×${draft.deloadQualityFactor.toFixed(2)}`
          + ` · день НЕ убран, качество НЕ снято, темп на ступень мягче` });
      continue;
    }
    // поддержание (цикл без старта) или рост
    if (draft.intent === "maintenance") {
      out.push({ index: i, weekStart, role: "поддержание", aerobicMin: round5(aer), qualityMin: round5(qual),
        days: draft.days, qualityHint: qualityFormatHint(round5(qual)), note: "шаг ×1.00 — поддержание, не прогрессия" });
      continue;
    }
    const atCap = round5(aer) >= draft.peakCapAerobicMin;
    out.push({ index: i, weekStart, role: "рост", aerobicMin: round5(aer), qualityMin: round5(qual), days: draft.days,
      qualityHint: qualityFormatHint(round5(qual)),
      note: atCap
        ? `упёрлись в собственный максимум ${draft.peakCapAerobicMin} мин — выше цикл сам не идёт, это решение тренера`
        : `шаг ×${draft.stepAerobic.toFixed(2)} / ×${draft.stepQuality.toFixed(2)}` });
    peakAer = Math.max(peakAer, round5(aer));
    // следующая неделя растёт от этой, но не выше собственного исторического максимума
    aer = Math.min(aer * draft.stepAerobic, draft.peakCapAerobicMin);
    qual = Math.min(qual * draft.stepQuality, aer * WORK_SHARE_MAX / (1 - WORK_SHARE_MAX));
  }
  return out;
}
