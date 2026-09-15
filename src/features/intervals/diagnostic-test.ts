/**
 * Диагностический тест на 30 минут: задание человеку и разбор того, что он прибежал.
 *
 * ── ЗАЧЕМ ───────────────────────────────────────────────────────────────────
 *
 * Без порога качественная работа назначается по усилию. Это работает, но грубо:
 * «усилие 7 из 10» у разных людей означает разный темп, и сравнить неделю с
 * неделей нельзя. Тест даёт ИЗМЕРЕННОЕ число вместо оценки.
 *
 * ── ПРОТОКОЛ (тренер, 15.09.2026) ───────────────────────────────────────────
 *
 * Час, около 8,5 км:
 *   10 мин лёгкий бег по измеренному якорю лёгкого
 *    2 мин бодрее, примерно на 40 секунд быстрее лёгкого
 *    3 мин спокойный бег
 *    5 мин отдых
 *   30 мин ТЕСТ, максимально ровно
 *   10 мин заминка
 *
 * Темпы разминки НЕ ЗАШИТЫ ЧИСЛАМИ: они считаются от якоря лёгкого конкретного
 * человека. Зашитые числа означали бы, что задание одинаково для всех, а якорь
 * тогда не нужен.
 *
 * РЕЗУЛЬТАТ: средний темп за ПОСЛЕДНИЕ 20 МИНУТ теста. Не за все тридцать:
 * первые десять минут почти всегда быстрее, чем человек способен держать, и
 * средняя по тридцати завышает порог у того, кто разогнался.
 *
 * ── ЗАПИСЬ ОТДЕЛЬНОЙ ТРЕНИРОВКОЙ (тренер, 15.09.2026) ───────────────────────
 *
 * Человек останавливает запись после разминки и пишет тест ОТДЕЛЬНО. Поэтому
 * распознавание ищет отдельную запись примерно на полчаса, а не отрезок внутри
 * часовой пробежки. Если всё-таки пришла одна длинная запись, отрезок ищется
 * внутри неё, но такой результат помечается менее надёжным и уходит тренеру,
 * а не пишется сам.
 */

/** Код, по которому тест узнаётся в плане. Один на всю систему. */
export const DIAGNOSTIC_TEST_PRESET = "diagnostic_test_30";

/** Длина зачётного отрезка: последние 20 минут теста. */
export const SCORING_WINDOW_S = 20 * 60;

/** Сам тест, минут. */
export const TEST_BLOCK_MIN = 30;

/** Вся тренировка целиком, минут. */
export const TEST_TOTAL_MIN = 60;

/** На сколько второй шаг разминки бодрее лёгкого, секунд на километр. */
const BRISK_FASTER_THAN_EASY_S = 40;

/* ────────────────────────── ЗАДАНИЕ ЧЕЛОВЕКУ ────────────────────────── */

export type TestSegment = {
  minutes: number;
  label: string;
  fastSec: number | null;
  slowSec: number | null;
  noPaceText?: string;
};

export type TestPlan = {
  title: string;
  minutes: number;
  description: string;
  segments: TestSegment[];
  /** Темпы, которые получились из якоря: для отчёта тренеру. */
  easyFastSec: number;
  easySlowSec: number;
  briskSec: number;
};

/** Округляем СНАЧАЛА, потом делим: иначе 359,7 с даёт «5:60» вместо «6:00». */
const paceOf = (sec: number): string => {
  const total = Math.round(sec);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

const round5 = (sec: number): number => Math.round(sec / 5) * 5;

/**
 * Задание на тест, посчитанное от якоря лёгкого.
 *
 * ТЕКСТ НА «ВЫ», БЕЗ ТИРЕ: так написаны все задания ученику, и проверка
 * check:diagnostic-test следит, чтобы сюда не просочилось ни одного.
 */
export function buildTestPlan(easyFastSec: number, easySlowSec: number): TestPlan {
  const easyFast = round5(easyFastSec);
  const easySlow = round5(easySlowSec);
  const brisk = round5((easyFast + easySlow) / 2 - BRISK_FASTER_THAN_EASY_S);

  const segments: TestSegment[] = [
    { minutes: 10, label: "лёгкий бег", fastSec: easyFast, slowSec: easySlow },
    { minutes: 2, label: "бодрее", fastSec: brisk - 5, slowSec: brisk + 5 },
    { minutes: 3, label: "спокойный бег", fastSec: easyFast, slowSec: easySlow },
    { minutes: 5, label: "отдых", fastSec: null, slowSec: null, noPaceText: "стоя или шагом" },
    {
      minutes: TEST_BLOCK_MIN,
      label: "тест",
      fastSec: null,
      slowSec: null,
      noPaceText: "настолько сильно, насколько удержите ровно все тридцать минут",
    },
    { minutes: 10, label: "заминка", fastSec: easyFast, slowSec: easySlow },
  ];

  const description = [
    "ВАЖНО ПРО ЗАПИСЬ. Тест записывается отдельной тренировкой.",
    "Остановите запись после разминки и начните новую на тест. После теста снова остановите",
    "и запишите заминку третьей. Если всё попадёт в одну запись, результат я посчитаю,",
    "но точность будет хуже, и мне придётся смотреть глазами.",
    "",
    "По шагам:",
    `1. 10 минут лёгкий бег, ваш обычный лёгкий темп, от ${paceOf(easyFast)} до ${paceOf(easySlow)} на километр.`,
    `2. 2 минуты бодрее, около ${paceOf(brisk)} на километр. Это настройка на работу, а не сама работа.`,
    "3. 3 минуты спокойный бег, обратно в ровный ритм.",
    "4. 5 минут отдых: попить, отдышаться, настроиться. Здесь остановите запись.",
    "5. 30 минут тест. Начните новую запись.",
    "   Бежите настолько сильно, насколько сможете удержать ровно все тридцать минут.",
    "   Не разгоняйтесь в первые пять минут, это главная ошибка в таком тесте.",
    "   К концу должно быть тяжело, но добежать вы обязаны без перехода на шаг.",
    "6. 10 минут заминка лёгким бегом, уже третьей записью.",
    "",
    "Где бежать: ровный отрезок без светофоров и длинных подъёмов. Парк или набережная подойдут.",
    "На пульс во время теста не смотрите. Он тут ничего не решает, а держать ровно мешает.",
    "Всего около часа и около 8,5 км.",
    "",
    "Если сегодня не тот день, просто пробегите час спокойно. Тест не обязателен,",
    "и без него мы продолжим работать по ощущениям.",
  ].join("\n");

  return {
    title: "Диагностический тест, 30 минут",
    minutes: TEST_TOTAL_MIN,
    description,
    segments,
    easyFastSec: easyFast,
    easySlowSec: easySlow,
    briskSec: brisk,
  };
}

/* ────────────────────────── РАЗБОР РЕЗУЛЬТАТА ────────────────────────── */

/**
 * ГРАНИЦЫ РОВНОСТИ. Откуда взяты числа (замер 15.09.2026 на 80 живых записях
 * 25–45 минут из intervals_activity_streams, по последним 20 минутам каждой):
 *
 *   разброс поминутного темпа (CV):  p10 3,0 %  медиана 9,9 %  p90 27 %
 *   просадка второй десятки:         медиана −1,4 %  p90 +17 %
 *   стоял (скорость ниже 1 м/с):     медиана 0,3 %  p95 1,4 %
 *
 * Десять самых ровных живых окон лежат в CV 2,1…3,4 % при просадке в пределах
 * ±3 %. Это и есть «человек СТАРАЛСЯ держать ровно», в том числе на быстрых
 * 4:06 и 4:55 на километр. Порог 5 % даёт этому полуторный запас, а всё, что
 * выше 8 %, в живых данных означает рваный бег: светофоры, горки, интервалы.
 *
 * ПОЧЕМУ ДВА ЧИСЛА, А НЕ ОДНО. Они ловят разное и по отдельности слепы:
 * рваная пробежка с остановками даёт большой CV при нулевой просадке, а
 * «улетела и развалилась» даёт просадку +26 % при CV 16 %, то есть по разбросу
 * выглядит почти прилично. Пример каждого есть в тех же 80 записях.
 */
export const STEADY_CV_PCT = 5;
export const DOUBTFUL_CV_PCT = 8;
export const STEADY_FADE_PCT = 4;
export const DOUBTFUL_FADE_PCT = 8;
/**
 * Отрицательная просадка (вторая половина БЫСТРЕЕ) порог занижает, а не
 * завышает: работа по такому порогу выйдет легче, чем надо. Это безопасная
 * сторона ошибки, поэтому граница здесь мягче, и «разбежалась к концу» уходит
 * в «сомнительно», а не в отказ.
 */
export const STEADY_NEGATIVE_FADE_PCT = -8;
export const DOUBTFUL_NEGATIVE_FADE_PCT = -15;
export const STEADY_STILL_PCT = 1;
export const DOUBTFUL_STILL_PCT = 3;

/** Запись короче этого зачётное окно не покрывает. */
export const MIN_TEST_RECORD_S = 25 * 60;
/** Запись длиннее этого выглядит как «записал всё подряд», а не как тест. */
export const MAX_TEST_RECORD_S = 45 * 60;

/**
 * Тест обязан быть заметно быстрее лёгкого. Иначе это лёгкий бег, а не тест, и
 * записанный с него «порог» сделает всю дальнейшую работу бессмысленно лёгкой.
 */
export const MIN_FASTER_THAN_EASY_PCT = 5;

export type TestVerdict = "ровно" | "сомнительно" | "невалидно";

export type TestMetrics = {
  /** Разброс поминутного темпа внутри зачётных 20 минут, проценты. */
  cvPct: number;
  /** Вторая десятка против первой внутри зачётных 20 минут, проценты. Плюс = замедлилась. */
  fadePct: number;
  /** Доля времени окна почти без движения, проценты. */
  stillPct: number;
  /** Средний темп зачётных 20 минут, с/км. Это и есть кандидат в порог. */
  thresholdSecPerKm: number;
  /** Поминутные темпы окна: чтобы тренер мог посмотреть глазами. */
  minutePaces: Array<number | null>;
};

export type TestEvaluation = {
  verdict: TestVerdict;
  metrics: TestMetrics | null;
  /** Почему такой вердикт. Пусто у чистого теста. */
  reasons: string[];
  /** Отрезок искали внутри длинной записи, а не брали запись целиком. */
  fromLongRecord: boolean;
  /** Смещение начала зачётного окна от старта записи, секунд. */
  windowStartOffsetS: number;
};

/** Темп (с/км) каждой минуты окна. null = за минуту почти не сдвинулся. */
function minutePaces(
  timeS: number[],
  velocity: Array<number | null>,
  fromS: number,
  lengthS: number
): Array<number | null> {
  const out: Array<number | null> = [];
  for (let m = 0; m * 60 < lengthS; m += 1) {
    const a = fromS + m * 60;
    const b = Math.min(fromS + (m + 1) * 60, fromS + lengthS);
    let metres = 0;
    for (let i = 1; i < timeS.length; i += 1) {
      if (timeS[i] <= a || timeS[i - 1] >= b) continue;
      const dt = Math.min(timeS[i], b) - Math.max(timeS[i - 1], a);
      if (dt <= 0) continue;
      const va = Math.max(velocity[i - 1] ?? 0, 0);
      const vb = Math.max(velocity[i] ?? 0, 0);
      metres += ((va + vb) / 2) * dt;
    }
    out.push(metres > 5 ? ((b - a) / metres) * 1000 : null);
  }
  return out;
}

function stillShare(
  timeS: number[],
  velocity: Array<number | null>,
  fromS: number,
  lengthS: number
): number {
  let still = 0;
  let span = 0;
  for (let i = 1; i < timeS.length; i += 1) {
    if (timeS[i] <= fromS || timeS[i - 1] >= fromS + lengthS) continue;
    const dt = Math.min(timeS[i], fromS + lengthS) - Math.max(timeS[i - 1], fromS);
    if (dt <= 0) continue;
    span += dt;
    if (((velocity[i - 1] ?? 0) + (velocity[i] ?? 0)) / 2 < 1) still += dt;
  }
  return span > 0 ? (still / span) * 100 : 0;
}

/**
 * Разбор зачётного окна: числа и вердикт.
 *
 * ПУСТАЯ МИНУТА НЕ ВЫБРАСЫВАЕТСЯ, а заменяется тройной медианой окна: минута,
 * которую человек простоял, обязана портить оценку ровности, а не исчезать из
 * неё. Заодно и потолок: одна сорвавшаяся точка GPS не должна одна решать
 * судьбу теста.
 */
function judgeWindow(
  timeS: number[],
  velocity: Array<number | null>,
  fromS: number,
  lengthS: number
): { metrics: TestMetrics; reasons: string[]; verdict: TestVerdict } | null {
  const mins = minutePaces(timeS, velocity, fromS, lengthS);
  const alive = mins.filter((x): x is number => x !== null);
  if (mins.length < 10 || alive.length < mins.length / 2) return null;

  const sorted = [...alive].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const filled = mins.map((x) => (x === null ? median * 3 : Math.min(x, median * 3)));

  const mean = filled.reduce((s, x) => s + x, 0) / filled.length;
  const sd = Math.sqrt(filled.reduce((s, x) => s + (x - mean) ** 2, 0) / filled.length);
  const half = Math.floor(filled.length / 2);
  const firstHalf = filled.slice(0, half).reduce((s, x) => s + x, 0) / half;
  const secondHalf = filled.slice(-half).reduce((s, x) => s + x, 0) / half;

  // Темп окна считаем по РАССТОЯНИЮ И ВРЕМЕНИ, а не как среднее поминутных
  // темпов: среднее обратных величин смещено, и на рваном беге смещено заметно.
  let metres = 0;
  for (let i = 1; i < timeS.length; i += 1) {
    if (timeS[i] <= fromS || timeS[i - 1] >= fromS + lengthS) continue;
    const dt = Math.min(timeS[i], fromS + lengthS) - Math.max(timeS[i - 1], fromS);
    if (dt <= 0) continue;
    const va = Math.max(velocity[i - 1] ?? 0, 0);
    const vb = Math.max(velocity[i] ?? 0, 0);
    metres += ((va + vb) / 2) * dt;
  }
  if (!(metres > 0)) return null;

  const metrics: TestMetrics = {
    cvPct: (sd / mean) * 100,
    fadePct: ((secondHalf - firstHalf) / firstHalf) * 100,
    stillPct: stillShare(timeS, velocity, fromS, lengthS),
    thresholdSecPerKm: (lengthS / metres) * 1000,
    minutePaces: mins,
  };

  const reasons: string[] = [];
  if (metrics.cvPct > STEADY_CV_PCT) {
    reasons.push(
      `темп гулял: разброс поминутного темпа ${metrics.cvPct.toFixed(1)} % при пределе ровного ${STEADY_CV_PCT} %`
    );
  }
  if (metrics.fadePct > STEADY_FADE_PCT) {
    reasons.push(
      `вторая половина медленнее первой на ${metrics.fadePct.toFixed(1)} % при пределе ${STEADY_FADE_PCT} %: похоже на слишком быстрое начало`
    );
  }
  if (metrics.fadePct < STEADY_NEGATIVE_FADE_PCT) {
    reasons.push(
      `вторая половина быстрее первой на ${Math.abs(metrics.fadePct).toFixed(1)} %: начало было вполсилы, порог выйдет заниженным`
    );
  }
  if (metrics.stillPct > STEADY_STILL_PCT) {
    reasons.push(`остановки внутри зачётных минут: ${metrics.stillPct.toFixed(1)} % времени почти без движения`);
  }

  const steady =
    metrics.cvPct <= STEADY_CV_PCT &&
    metrics.fadePct <= STEADY_FADE_PCT &&
    metrics.fadePct >= STEADY_NEGATIVE_FADE_PCT &&
    metrics.stillPct <= STEADY_STILL_PCT;
  const doubtful =
    metrics.cvPct <= DOUBTFUL_CV_PCT &&
    metrics.fadePct <= DOUBTFUL_FADE_PCT &&
    metrics.fadePct >= DOUBTFUL_NEGATIVE_FADE_PCT &&
    metrics.stillPct <= DOUBTFUL_STILL_PCT;

  return { metrics, reasons, verdict: steady ? "ровно" : doubtful ? "сомнительно" : "невалидно" };
}

export type EvaluateInput = {
  timeS: number[];
  velocity: Array<number | null>;
  /** Тест лежит внутри длинной записи: окно ищется, а результат помечается. */
  fromLongRecord?: boolean;
  /** Якорь лёгкого, с/км. Нужен, чтобы отличить тест от лёгкой пробежки. */
  easyPaceSec?: number | null;
};

/**
 * Разбор пришедшей записи.
 *
 * ОБЫЧНЫЙ СЛУЧАЙ: запись и есть тест, берём её последние 20 минут.
 * ЗАПАСНОЙ: запись длинная (человек писал всё подряд). Тогда ищем внутри лучшее
 * получасовое окно и берём его последние 20 минут, но помечаем fromLongRecord.
 */
export function evaluateTest(input: EvaluateInput): TestEvaluation {
  const { timeS, velocity } = input;
  const n = Math.min(timeS.length, velocity.length);
  if (n < 60) {
    return {
      verdict: "невалидно",
      metrics: null,
      reasons: ["в записи почти нет точек: посчитать нечего"],
      fromLongRecord: Boolean(input.fromLongRecord),
      windowStartOffsetS: 0,
    };
  }

  const total = timeS[n - 1] - timeS[0];
  if (total < MIN_TEST_RECORD_S) {
    return {
      verdict: "невалидно",
      metrics: null,
      reasons: [
        `запись длиной ${Math.round(total / 60)} мин: на зачётные 20 минут теста её не хватает`,
      ],
      fromLongRecord: Boolean(input.fromLongRecord),
      windowStartOffsetS: 0,
    };
  }

  // Начало зачётного окна. В отдельной записи это просто её конец минус 20
  // минут. В длинной записи сперва ищем получасовой кусок теста.
  let windowStart = timeS[n - 1] - SCORING_WINDOW_S;
  const fromLong = Boolean(input.fromLongRecord);
  if (fromLong) {
    const block = bestBlockStart(timeS, velocity, TEST_BLOCK_MIN * 60);
    if (block === null) {
      return {
        verdict: "невалидно",
        metrics: null,
        reasons: ["внутри длинной записи не нашлось непрерывных тридцати минут"],
        fromLongRecord: true,
        windowStartOffsetS: 0,
      };
    }
    windowStart = block + TEST_BLOCK_MIN * 60 - SCORING_WINDOW_S;
  }

  const judged = judgeWindow(timeS, velocity, windowStart, SCORING_WINDOW_S);
  if (!judged) {
    return {
      verdict: "невалидно",
      metrics: null,
      reasons: ["в зачётных двадцати минутах слишком мало движения, чтобы считать темп"],
      fromLongRecord: fromLong,
      windowStartOffsetS: Math.round(windowStart - timeS[0]),
    };
  }

  const reasons = [...judged.reasons];
  let verdict = judged.verdict;

  const easy = input.easyPaceSec ?? null;
  if (easy !== null && easy > 0) {
    const gainPct = ((easy - judged.metrics.thresholdSecPerKm) / easy) * 100;
    if (gainPct < MIN_FASTER_THAN_EASY_PCT) {
      reasons.push(
        `темп ${paceOf(judged.metrics.thresholdSecPerKm)} быстрее лёгкого всего на ${gainPct.toFixed(1)} %: ` +
          "это похоже на лёгкую пробежку, а не на тест"
      );
      verdict = "невалидно";
    }
  }

  if (fromLong && verdict === "ровно") {
    // Ровное окно внутри длинной записи ровным быть МОЖЕТ, но где кончилась
    // разминка и начался тест, мы не знаем. Число даём, доверие понижаем.
    verdict = "сомнительно";
    reasons.push(
      "тест не был записан отдельно: границу теста внутри длинной записи выбрал алгоритм, а не человек"
    );
  }

  return {
    verdict,
    metrics: judged.metrics,
    reasons,
    fromLongRecord: fromLong,
    windowStartOffsetS: Math.round(windowStart - timeS[0]),
  };
}

/**
 * Начало самого быстрого непрерывного блока заданной длины.
 *
 * Та же идея, что в best-efforts, но нужен не темп, а СМЕЩЕНИЕ: где внутри
 * длинной записи лежал тест.
 */
function bestBlockStart(
  timeS: number[],
  velocity: Array<number | null>,
  blockS: number
): number | null {
  const n = Math.min(timeS.length, velocity.length);
  if (n < 2 || timeS[n - 1] - timeS[0] < blockS) return null;

  const dist = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i += 1) {
    const dt = timeS[i] - timeS[i - 1];
    if (!Number.isFinite(dt) || dt <= 0) {
      dist[i] = dist[i - 1];
      continue;
    }
    const va = Math.max(velocity[i - 1] ?? 0, 0);
    const vb = Math.max(velocity[i] ?? 0, 0);
    dist[i] = dist[i - 1] + ((va + vb) / 2) * dt;
  }

  let bestPace = Number.POSITIVE_INFINITY;
  let bestStart: number | null = null;
  let left = 0;
  for (let right = 1; right < n; right += 1) {
    while (left + 1 < right && timeS[right] - timeS[left + 1] >= blockS) left += 1;
    const span = timeS[right] - timeS[left];
    if (span < blockS) continue;
    const metres = dist[right] - dist[left];
    if (!(metres > 0)) continue;
    const pace = (span / metres) * 1000;
    if (pace < bestPace) {
      bestPace = pace;
      bestStart = timeS[left];
    }
  }
  return bestStart;
}

/* ────────────────────────── ВЫБОР ЗАПИСИ ────────────────────────── */

export type DayRecord = {
  activityId: string;
  name: string | null;
  movingTimeS: number;
  /** Средний темп всей записи, с/км. null = считать не из чего. */
  paceSecPerKm: number | null;
};

export type RecordPick = {
  record: DayRecord | null;
  fromLongRecord: boolean;
  note: string;
};

/**
 * Какая из записей дня и есть тест.
 *
 * ГЛАВНЫЙ ПУТЬ: человек записал тест отдельно, значит среди записей дня есть
 * одна на 25–45 минут. Если таких несколько (например, тест и длинная разминка
 * одинаковой длины), берём самую быструю: тест быстрее всего остального в этот
 * день по определению.
 *
 * ЗАПАСНОЙ: отдельной записи нет, а есть одна длинная. Значит человек писал всё
 * подряд. Отказывать нельзя, но и доверять как отдельной записи тоже.
 */
export function pickTestRecord(records: DayRecord[]): RecordPick {
  const runs = records.filter((r) => r.movingTimeS > 0);
  if (runs.length === 0) return { record: null, fromLongRecord: false, note: "в этот день записей нет" };

  const candidates = runs.filter(
    (r) => r.movingTimeS >= MIN_TEST_RECORD_S && r.movingTimeS <= MAX_TEST_RECORD_S
  );
  if (candidates.length > 0) {
    const sorted = [...candidates].sort(
      (a, b) => (a.paceSecPerKm ?? Number.POSITIVE_INFINITY) - (b.paceSecPerKm ?? Number.POSITIVE_INFINITY)
    );
    return {
      record: sorted[0],
      fromLongRecord: false,
      note:
        candidates.length === 1
          ? "отдельная запись теста найдена"
          : `подходящих записей ${candidates.length}, взята самая быстрая`,
    };
  }

  const long = [...runs].sort((a, b) => b.movingTimeS - a.movingTimeS)[0];
  if (long.movingTimeS > MAX_TEST_RECORD_S) {
    return {
      record: long,
      fromLongRecord: true,
      note: `отдельной записи нет, есть одна длинная на ${Math.round(long.movingTimeS / 60)} мин: похоже, писалось всё подряд`,
    };
  }

  return {
    record: null,
    fromLongRecord: false,
    note: `самая длинная запись дня ${Math.round(long.movingTimeS / 60)} мин, на тест не похоже`,
  };
}

/** «275» → «4:35». */
export const testPaceText = (secPerKm: number): string => paceOf(secPerKm);
