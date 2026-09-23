/**
 * Сигнал недели: что чек-ины говорят тренеру про следующую неделю.
 *
 * ЗАЧЕМ ВООБЩЕ. Обратной связи по самочувствию в генерации не было нигде — ни
 * у ростера TrainingPeaks, ни у цикла Intervals. Объём следующей недели
 * считается из истории и конверта, а как человеку далось то, что он уже
 * пробежал, не спрашивает никто. Лестница новичка читает RPE, но только чтобы
 * двигать ступень, и только у тех, кто на лестнице.
 *
 * ДВА РАЗНЫХ СИГНАЛА, А НЕ ОДИН.
 *
 * 1. БОЛЬ — это не «срежь объём», это «поговори с человеком». Никакого
 *    множителя, никаких процентов: боль означает разговор, а решение про
 *    нагрузку принимается ПОСЛЕ него и тренером, а не формулой. Поэтому здесь
 *    боль не участвует в расчёте полосы вообще и живёт отдельным списком.
 *
 *    КОГДА ЭТОТ СИГНАЛ ГАСНЕТ [23.09.2026]. Не от ответа тренера. Раньше было
 *    именно так, и получалось, что система считает вопрос закрытым потому, что
 *    тренер что-то написал. Живой случай: 23.09 у ученицы заныла пятка, тренер
 *    отправил ей три вопроса — и сигнал пропал ровно в тот момент, когда
 *    ожидание ответа только началось.
 *
 *    Теперь ответ меняет ВИД сигнала («ответил, жду её»), а гасят его два
 *    события: тренер нажал «разобрался» (решение человека, лежит в базе) или
 *    пришёл следующий чек-ин БЕЗ боли (факт от ученицы, считается на лету).
 *    Следующий чек-ин С болью не гасит ничего: боль дважды подряд — это ровно
 *    то, что нельзя потерять.
 *
 * 2. ОБЪЁМ — по худшему RPE ЗАВЕРШЁННОЙ недели. Не текущей: пока неделя идёт,
 *    оценка неполная, а решать надо про следующую.
 *
 * ПОЧЕМУ ПОЛОСЫ СПЛОШНЫЕ (≤3 / 4–5 / ≥6), А НЕ ТОЧНЫЕ ЗНАЧЕНИЯ. Шкал две:
 * лестничная даёт RPE 2, 3, 4, 5, 7, лёгкая — 3, 5, 7. Точные сравнения
 * (=5, =7) оставляли RPE 4 «Заметно, но нормально» без полосы вообще. Границы
 * подобраны так, что каждое реальное значение обеих шкал попадает ровно в одну.
 *
 * ПОЧЕМУ ЭТО ТОЛЬКО СИГНАЛ. Ничего не пишется и не пересобирается: план
 * остаётся тем, что тренер опубликовал. Сигнал показывается на карточке, а
 * решение принимает человек — как и с гейтом качества, снятым циклом.
 */

export type CheckinForSignal = {
  id: string;
  sessionDate: string;
  effortRpe: number | null;
  effortLabel: string | null;
  pain: boolean;
  painNote: string | null;
  /**
   * Общий комментарий к тренировке.
   *
   * ЗАЧЕМ ОН СИГНАЛУ БОЛИ [23.09.2026]. Поле «что именно беспокоило» люди
   * пропускают, а пишут всё в комментарий: Валентина отметила боль галочкой,
   * поле оставила пустым и написала «после бега вечером правая пятка немного
   * ныла» в общем тексте. Сигнал при этом утверждал, что она ничего не
   * написала, — прямая неправда, и ровно про тот единственный факт, ради
   * которого блок существует.
   */
  commentText?: string | null;
  /** Когда тренер нажал «разобрался». null — не нажимал. */
  painResolvedAt?: string | null;
};

/**
 * Состояние разговора про боль.
 *
 * `waiting_answer` — тренер ещё ничего не написал по этому чек-ину.
 * `answered_waiting` — написал и ждёт ответа человека. Вопрос НЕ закрыт.
 *
 * Третьего состояния нет намеренно: «разобрались» — это не вид флага, а его
 * отсутствие в списке.
 */
export type PainFlagState = "waiting_answer" | "answered_waiting";

export type PainFlag = {
  checkinId: string;
  sessionDate: string;
  effortLabel: string | null;
  painNote: string | null;
  /** Комментарий к той же тренировке — запасной источник её слов. */
  commentText: string | null;
  state: PainFlagState;
};

export type VolumeBand = "calm" | "hold" | "cut";

export type WeekVolumeSignal = {
  weekStart: string;
  weekEnd: string;
  checkinCount: number;
  worstRpe: number;
  worstLabel: string | null;
  worstDate: string;
  band: VolumeBand;
  headlineRu: string;
  adviceRu: string;
};

export type WeeklyReportForSignal = {
  weekStart: string;
  scheduleCode: string;
  wellbeingCode: string;
  commentText: string | null;
};

export type WeeklyVoice = {
  scheduleCode: string;
  wellbeingCode: string;
  commentText: string | null;
  /** Одной строкой: что из ответа следует для тренера. */
  headlineRu: string;
  /** Неделя не состоялась: объём обсуждать рано, сначала разговор. */
  needsTalk: boolean;
};

export type WeekSignal = {
  /** Неотвеченные чек-ины с болью. Ведут к разговору, не к числу. */
  painFlags: PainFlag[];
  /** Итог завершённой недели. null — чек-инов за неё не было, говорить нечего. */
  volume: WeekVolumeSignal | null;
  /** Что человек сам сказал про неделю. null — форму не заполнил. */
  weekly: WeeklyVoice | null;
};

const DAY_MS = 86_400_000;

function mondayOf(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  const weekday = (date.getUTCDay() + 6) % 7; // 0 = понедельник
  return new Date(date.getTime() - weekday * DAY_MS).toISOString().slice(0, 10);
}

function shift(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function bandOf(worstRpe: number): VolumeBand {
  if (worstRpe >= 6) return "cut";
  if (worstRpe >= 4) return "hold";
  return "calm";
}

/**
 * Последняя ЗАВЕРШЁННАЯ неделя относительно сегодня: та, что кончилась в
 * воскресенье перед текущим понедельником.
 */
export function lastCompletedWeek(todayIso: string): { start: string; end: string } {
  const currentMonday = mondayOf(todayIso);
  return { start: shift(currentMonday, -7), end: shift(currentMonday, -1) };
}

/**
 * Голос человека про неделю. Сюда приходит форма за ТУ ЖЕ завершённую неделю,
 * что считает полоса объёма, — иначе тренер увидел бы слова про одну неделю
 * рядом с числами про другую.
 */
function weeklyVoiceOf(report: WeeklyReportForSignal | null): WeeklyVoice | null {
  if (!report) return null;
  const needsTalk = report.scheduleCode === "almost_none";
  const headlineRu = needsTalk
    ? "Неделя не состоялась: человек сам сказал, что почти ничего не получилось"
    : report.wellbeingCode === "tired"
      ? report.scheduleCode === "all_done"
        ? "График выполнен полностью, но человек говорит про накопленную усталость"
        : "Часть тренировок пропущена, и человек говорит про накопленную усталость"
      : report.scheduleCode === "some_missed"
        ? "Часть тренировок пропущена, самочувствие при этом обычное"
        : report.wellbeingCode === "fresh"
          ? "Неделя выполнена, сил к концу не меньше, чем в начале"
          : "Неделя выполнена, самочувствие обычное";
  return {
    scheduleCode: report.scheduleCode,
    wellbeingCode: report.wellbeingCode,
    commentText: report.commentText,
    headlineRu,
    needsTalk,
  };
}

export function buildWeekSignal(input: {
  checkins: CheckinForSignal[];
  unansweredCheckinIds: Set<string>;
  todayIso: string;
  /** Формы за последние недели. Берётся та, что за завершённую неделю. */
  weeklyReports?: WeeklyReportForSignal[];
}): WeekSignal {
  /**
   * Дата последнего чек-ина БЕЗ боли. Всё, что с болью и раньше неё, человек
   * уже опроверг своим же следующим отчётом — держать такой сигнал значит
   * спорить с фактом.
   *
   * Сравнение по session_date, а не по времени записи: «какого числа была
   * тренировка» — это единица, в которой тренер и ученица думают об отчётах.
   */
  const lastPainFreeDate = input.checkins
    .filter((checkin) => !checkin.pain)
    .reduce<string | null>(
      (latest, checkin) => (latest === null || checkin.sessionDate > latest ? checkin.sessionDate : latest),
      null
    );

  const painFlags: PainFlag[] = input.checkins
    .filter((checkin) => {
      if (!checkin.pain) return false;
      // Тренер сказал, что разобрался: решение человека, сильнее всего прочего.
      if (checkin.painResolvedAt) return false;
      // Следующий отчёт пришёл без боли.
      if (lastPainFreeDate !== null && lastPainFreeDate > checkin.sessionDate) return false;
      return true;
    })
    .sort((a, b) => (a.sessionDate < b.sessionDate ? 1 : -1))
    .map((checkin) => ({
      checkinId: checkin.id,
      sessionDate: checkin.sessionDate,
      effortLabel: checkin.effortLabel,
      painNote: checkin.painNote,
      commentText: checkin.commentText ?? null,
      state: input.unansweredCheckinIds.has(checkin.id)
        ? ("waiting_answer" as const)
        : ("answered_waiting" as const),
    }));

  const week = lastCompletedWeek(input.todayIso);
  const inWeek = input.checkins.filter(
    (checkin) =>
      checkin.sessionDate >= week.start &&
      checkin.sessionDate <= week.end &&
      checkin.effortRpe !== null
  );

  const weekly = weeklyVoiceOf(
    (input.weeklyReports ?? []).find((report) => report.weekStart === week.start) ?? null
  );

  if (inWeek.length === 0) {
    return { painFlags, volume: null, weekly };
  }

  // Худший, а не средний: одна по-настоящему тяжёлая тренировка — это факт про
  // неделю, и усреднение его прячет.
  const worst = inWeek.reduce((acc, checkin) =>
    (checkin.effortRpe ?? 0) > (acc.effortRpe ?? 0) ? checkin : acc
  );
  const worstRpe = worst.effortRpe ?? 0;
  /**
   * СЛОВО ЧЕЛОВЕКА ПОДНИМАЕТ ПОЛОСУ, НО НИКОГДА НЕ ОПУСКАЕТ.
   *
   * «Усталость» за неделю — это то, чего в отметках по тренировкам не видно:
   * каждая по отдельности могла даться нормально, а к воскресенью человек всё
   * равно выжат. Поэтому tired двигает полосу минимум в «держим».
   *
   * Обратное не делаем НИКОГДА: «свежесть» при RPE 7 не означает, что тяжёлой
   * недели не было. Человек оценивает самочувствие, а не нагрузку, и снимать
   * по его бодрости уже увиденную тяжесть значит спорить с фактом.
   */
  const rpeBand = bandOf(worstRpe);
  const band: VolumeBand =
    weekly?.wellbeingCode === "tired" && rpeBand === "calm" ? "hold" : rpeBand;
  const raisedByVoice = band !== rpeBand;

  const headlineRu = raisedByVoice
    ? "Неделя по отметкам спокойная, но человек говорит про усталость"
    : band === "cut"
      ? "Неделя была тяжёлой"
      : band === "hold"
        ? "Неделя далась тяжелее обычного"
        : "Неделя прошла спокойно";

  // НЕДЕЛЯ НЕ СОСТОЯЛАСЬ — СОВЕТА ПРО ОБЪЁМ НЕ ДАЁМ ВООБЩЕ. Считать «срезать
  // или держать» по двум отметкам из шести запланированных дней значит выдать
  // арифметику за понимание. Тут сначала разговор, как и с болью.
  const adviceRu = weekly?.needsTalk
    ? "Про объём следующей недели советовать нечего: человек сам сказал, что неделя не сложилась. Сначала разговор, потом план."
    : band === "cut"
      ? "Предлагаем срезать объём следующей недели примерно на 10–20% против обычного расчёта — дать восстановиться, прежде чем продолжать расти."
      : band === "hold"
        ? "Предлагаем на следующей неделе не увеличивать объём — держать примерно на уровне этой недели, дать втянуться."
        : "Без ограничений на рост объёма — решает обычный расчёт цикла.";

  return {
    painFlags,
    weekly,
    volume: {
      weekStart: week.start,
      weekEnd: week.end,
      checkinCount: inWeek.length,
      worstRpe,
      worstLabel: worst.effortLabel,
      worstDate: worst.sessionDate,
      band,
      headlineRu,
      adviceRu,
    },
  };
}
