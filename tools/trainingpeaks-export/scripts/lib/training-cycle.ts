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

/**
 * ЧТО ЦИКЛ НА САМОМ ДЕЛЕ ДЕЛАЕТ. У пяти из двенадцати недель роста в горизонте нет
 * вовсе — старт близко, расти некогда. Такой цикл не «подготовка», а «подвести к старту
 * в текущей форме», и называть его надо честно, чтобы тренер видел разницу.
 */
export type CycleMode = "подготовка" | "подвод к старту в текущей форме" | "поддержание";

/** Длина цикла по типу, недель. [литература] — см. часть B спеки; 5k и marathon по аналогии. */
export const LENGTH_WEEKS: Record<CycleIntent, number> = {
  "5k": 11, "10k": 14, half: 16, marathon: 18, maintenance: 8,
};

/**
 * ШАГ РОСТА НЕДЕЛИ — ПЛАВНЫЙ, НЕ ПРЕДЕЛЬНЫЙ.
 *
 * 1.22 — это p90 ОДНОГО перехода [практика, n=1715], то есть «максимум, который бывает»,
 * а не темп, который держат неделя за неделей: медиана перехода 0.99. Когда 1.22 работало
 * темпом, аэробный упирался в потолок (база ×1.25) на ПЕРВОЙ же неделе, и рычага «рост
 * объёмом» не оказалось ни у кого из двенадцати — вместо двух рычагов получилось полтора.
 *
 * Теперь шаг +6% [решение Игоря, середина названного диапазона 5-7%], и цикл доходит
 * до своего потолка за несколько недель, а не прыжком.
 */
export const STEP_AEROBIC = 1.06;
export const STEP_QUALITY = 1.06;

/**
 * ПРЕДЕЛ ОДНОГО ПЕРЕХОДА. Ни один шаг цикла — включая возврат после разгрузки и добор
 * до потолка — не может превысить эту величину [практика, p90 от нормальной базы, n=1715].
 * Это страховка, а не темп: рабочий темп задаётся STEP_* выше.
 */
export const MAX_SINGLE_STEP = 1.22;

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

/**
 * ПОСЛЕДНЯЯ ЗАЩИТА, НЕ РАБОЧИЙ ПРЕДЕЛ. Доля работы в неделе не выше 0.20
 * [практика, p90 по ростеру, n=1132]. Это КОГОРТНОЕ число: оно годится, чтобы
 * поймать выброс, но не годится как личный потолок. Рабочий предел качества —
 * личный (peakCapQualityMin).
 */
export const WORK_SHARE_MAX = 0.20;

/**
 * НАСКОЛЬКО ЦИКЛУ ПОЗВОЛЕНО ВЫЙТИ ЗА СОБСТВЕННЫЙ ИСТОРИЧЕСКИЙ МАКСИМУМ.
 * Оба числа [решение Игоря]; берётся МЕНЬШЕЕ из двух.
 *
 * ЗАЧЕМ ДВА. Жёсткий исторический максимум запрещал прогрессию структурно: у Богачева
 * максимум 376 при базе 349, то есть цикл мог дать ему +8% и упирался. Но и один
 * множитель к максимуму опасен: у того, кто когда-то сделал одну огромную неделю,
 * максимум сильно оторван от базы, и ×1.10 к нему увёл бы далеко от его нынешней формы.
 * Поэтому второй ограничитель — от БАЗЫ, то есть от того, чем человек живёт сейчас.
 */
export const PEAK_OVER_HISTORIC_MAX = 1.10;
export const PEAK_OVER_BASE_MAX = 1.25;

/**
 * ПОТОЛОК ОТ НОРМЫ ДО МАКСИМУМА: норма + половина расстояния до максимума
 * [решение Игоря].
 *
 * ЗАЧЕМ. Исторический максимум оказался слишком щедрым пределом: у Пономаревой максимум
 * работы 60 мин при норме 20, и цикл уводил её долю качества с 9.1% до 15.3% — прежний
 * когортный перекос вернулся в личной обёртке. Максимум — это ОДНА, возможно случайная
 * неделя; норма — то, что человек несёт постоянно. Половина расстояния между ними —
 * компромисс: у Пономаревой 20 -> 40, а не 20 -> 60.
 */
export const CAP_BETWEEN_BASE_AND_MAX = 0.5;
export const capBetween = (base: number, max: number): number =>
  Math.round((base + (Math.max(max, base) - base) * CAP_BETWEEN_BASE_AND_MAX) / 5) * 5;

/**
 * ПОДВОДКА БЕЗ ПИКА. Если в цикле не было ни одной недели роста, пика нет: усталость
 * не копилась, и сбрасывать нечего. Полный профиль (-25% и глубже) в таком случае просто
 * отнимает форму. Символический срез [решение Игоря].
 */
export const TAPER_NO_PEAK_FACTOR = 0.90;

/** Каким рычагом идёт рост на неделе — для прогноза. */
export type GrowthLever = "аэробный" | "качество" | "оба" | "упёрлись";

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
  /**
   * Сырой собственный максимум аэробной недели за окно [практика].
   * Отдельно от peakCapAerobicMin: потолок цикла считается ОТ него, но им не равен —
   * циклу разрешён ограниченный выход выше (PEAK_OVER_HISTORIC_MAX / PEAK_OVER_BASE_MAX).
   * Нужен ещё и для пометки в прогнозе «неделя выше исторического максимума».
   */
  historicMaxAerobicMin: number;
  /**
   * ПОТОЛОК КАЧЕСТВЕННЫХ МИНУТ, мин работы/нед. Собственный исторический максимум
   * атлета за окно наблюдения [практика].
   *
   * ЗАЧЕМ. До 11.08 качество ограничивалось только долей работы ≤20% недели — это p90
   * ПО РОСТЕРУ [практика, n=1132], то есть чужое число в роли личного предела. У Богачева
   * собственная доля 9.4%, а прогноз вёл его к 16% (60 мин работы против базовых 35).
   * Та же ошибка уже была с полосой лёгкого и с длиной сессий: когортное вместо личного.
   * Теперь рабочий предел — личный, а когортные 20% остались ПОСЛЕДНЕЙ защитой.
   */
  peakCapQualityMin: number;
  /** сырой личный максимум минут работы — от него считается потолок, показывается для сверки */
  historicMaxQualityMin: number;
  /** каким был бы аэробный потолок, если брать его просто от максимума — для проверки перекоса */
  aerobicIfFromMax: number;
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
  /** доля работы в неделе, % — Игорь смотрит, не уехала ли она от его обычной */
  qualitySharePct: number;
  /** чем растём на этой неделе; на разгрузке и подводке не заполняется */
  lever: GrowthLever | null;
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
  // ПИК — максимум РЕАЛЬНО НАЗНАЧЕННЫХ недель роста, а не то, куда ушла бы арифметика,
  // если бы рост продолжался: подводка может начаться раньше, чем рост дойдёт до цифры.
  let peakAer = 0;
  // Аэробный объём ПРЕДЫДУЩЕЙ ПОКАЗАННОЙ недели. Нужен, чтобы предел одного перехода
  // работал на том, что видит тренер, а не на внутренней переменной роста: после
  // разгрузки цикл возвращался к дореразгрузочному уровню одним прыжком (330 -> 415,
  // то есть x1.26 при заявленном пределе x1.22 — страховка не срабатывала).
  let prevShownAer = 0;

  const taperLen = draft.taperProfile.length;
  const weeksToRace = draft.targetDate
    ? Math.round((Date.parse(draft.targetDate) - Date.parse(firstWeekStart)) / (7 * 86400000))
    : null;

  // РАЗМЕЩЕНИЕ ПЛАНОВОЙ РАЗГРУЗКИ С УЧЁТОМ ПОДВОДКИ.
  // Раньше разгрузка стояла по остатку от деления (i % deloadEveryN), и при коротком
  // горизонте её либо не было вовсе (у полумарафонца на 5 недель — ни одной), либо она
  // упиралась в подводку. Теперь недели разгрузки считаются заранее: от конца ростовой
  // части назад с шагом deloadEveryN, и между разгрузкой и подводкой оставляется
  // минимум одна полноценная неделя роста.
  const MIN_GROWTH_BETWEEN_DELOAD_AND_TAPER = 1;
  const deloadWeeks = new Set<number>();
  if (draft.intent !== "maintenance") {
    // последняя неделя, на которой ещё может стоять разгрузка
    const lastGrowthIdx = weeksToRace == null
      ? weeks
      : weeksToRace - taperLen;                       // неделя перед началом подводки
    const lastAllowed = lastGrowthIdx - MIN_GROWTH_BETWEEN_DELOAD_AND_TAPER;
    for (let k = lastAllowed; k >= 2; k -= draft.deloadEveryN) {
      if (k <= weeks) deloadWeeks.add(k);
    }
  }

  for (let i = 1; i <= weeks; i++) {
    const weekStart = addDays(firstWeekStart, 7 * (i - 1));
    const out2go = weeksToRace == null ? null : weeksToRace - (i - 1);
    const share = (a: number, q: number): number => (a + q > 0 ? Math.round(1000 * q / (a + q)) / 10 : 0);

    if (out2go === 0) {
      out.push({ index: i, weekStart, role: "старт", aerobicMin: 0, qualityMin: 0, days: draft.days,
        qualityHint: "—", qualitySharePct: 0, lever: null, note: `целевой старт ${draft.targetDate}` });
      continue;
    }
    if (out2go != null && out2go >= 1 && out2go <= taperLen) {
      const tw = draft.taperProfile.find((t) => t.weeksOut === out2go);
      if (tw) {
        // ПОДВОДКА БЕЗ ПИКА. Роста не было — усталость не копилась, сбрасывать нечего.
        // Полный профиль тут просто отнял бы форму, поэтому срез символический.
        const noPeak = peakAer === 0;
        const from = noPeak ? draft.baseAerobicMin : peakAer;
        const aF = noPeak ? TAPER_NO_PEAK_FACTOR : tw.aerobicFactor;
        const qF = noPeak ? TAPER_NO_PEAK_FACTOR : tw.qualityMinutesFactor;
        const a = round5(from * aF);
        const q = round5(qual * qF);
        out.push({ index: i, weekStart, role: "подводка", aerobicMin: a, qualityMin: q, days: draft.days,
          qualityHint: qualityFormatHint(q), qualitySharePct: share(a, q), lever: null,
          note: noPeak
            ? `ПОДВОДКА ОТ БАЗЫ, ПИКА НЕ БЫЛО: ×${aF.toFixed(2)} символически — роста не было, сбрасывать нечего`
            : `от ПИКА ${from} мин: аэробный ×${aF.toFixed(2)}, работа ×${qF.toFixed(2)}`
              + ` · темпы отрезков ТЕ ЖЕ, дней столько же` });
        continue;
      }
    }
    if (deloadWeeks.has(i)) {
      const a = round5(aer * draft.deloadDepthAerobic);
      const q = round5(qual * draft.deloadQualityFactor);
      out.push({ index: i, weekStart, role: "плановая разгрузка", aerobicMin: a, qualityMin: q, days: draft.days,
        qualityHint: qualityFormatHint(q), qualitySharePct: share(a, q), lever: null,
        note: `аэробный ×${draft.deloadDepthAerobic.toFixed(2)}, работа ×${draft.deloadQualityFactor.toFixed(2)}`
          + ` · день НЕ убран, качество НЕ снято, темп на ступень мягче` });
      prevShownAer = a;
      continue;
    }
    if (draft.intent === "maintenance") {
      const a = round5(aer), q = round5(qual);
      out.push({ index: i, weekStart, role: "поддержание", aerobicMin: a, qualityMin: q, days: draft.days,
        qualityHint: qualityFormatHint(q), qualitySharePct: share(a, q), lever: null,
        note: "шаг ×1.00 — поддержание, не прогрессия" });
      continue;
    }

    // ── РОСТ. ДВА РЫЧАГА ──
    // Когда аэробный упёрся в личный потолок, рост НЕ останавливается: дальше растёт
    // качество, пока не упрётся в свой личный потолок. У Богачева это единственный
    // доступный рычаг — самый большой объём в группе при самой низкой доле работы.
    // предел одного перехода считается от ПОКАЗАННОЙ прошлой недели
    const ceilStep = prevShownAer > 0 ? prevShownAer * MAX_SINGLE_STEP : Infinity;
    // когда связывает предел перехода — округляем ВНИЗ, иначе округление к пяти
    // само по себе выводит за предел (330 x1.22 = 402.6, а round5 даёт 405 = x1.227)
    const a = aer > ceilStep ? Math.floor(ceilStep / 5) * 5 : round5(aer);
    const q = round5(qual);
    const aerRoom = a < draft.peakCapAerobicMin;
    const qualRoom = q < draft.peakCapQualityMin && q < (a + q) * WORK_SHARE_MAX;
    const lever: GrowthLever = aerRoom && qualRoom ? "оба" : aerRoom ? "аэробный" : qualRoom ? "качество" : "упёрлись";
    const overHist = a > draft.historicMaxAerobicMin;
    const notes: string[] = [];
    if (lever === "оба") notes.push(`шаг ×${draft.stepAerobic.toFixed(2)} / ×${draft.stepQuality.toFixed(2)}`);
    else if (lever === "аэробный") notes.push(`качество на личном потолке ${draft.peakCapQualityMin} мин — растём объёмом`);
    else if (lever === "качество") notes.push(`аэробный на потолке ${draft.peakCapAerobicMin} мин — растём качеством`);
    else notes.push(`оба на потолке — дальше только решением тренера`);
    if (overHist) notes.push(`ВЫШЕ исторического максимума ${draft.historicMaxAerobicMin} мин`);
    out.push({ index: i, weekStart, role: "рост", aerobicMin: a, qualityMin: q, days: draft.days,
      qualityHint: qualityFormatHint(q), qualitySharePct: share(a, q), lever, note: notes.join(" · ") });

    peakAer = Math.max(peakAer, a);
    // Страховка: ни один переход не превышает предел одного шага [практика, p90, n=1715].
    // Обычный шаг (+6%) её и близко не касается — она ловит добор к потолку после разгрузки.
    if (aerRoom) aer = Math.min(aer * Math.min(draft.stepAerobic, MAX_SINGLE_STEP), draft.peakCapAerobicMin);
    if (qualRoom) qual = Math.min(qual * Math.min(draft.stepQuality, MAX_SINGLE_STEP), draft.peakCapQualityMin);
  }
  return out;
}
