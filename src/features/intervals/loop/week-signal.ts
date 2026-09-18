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
};

export type PainFlag = {
  checkinId: string;
  sessionDate: string;
  effortLabel: string | null;
  painNote: string | null;
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

export type WeekSignal = {
  /** Неотвеченные чек-ины с болью. Ведут к разговору, не к числу. */
  painFlags: PainFlag[];
  /** Итог завершённой недели. null — чек-инов за неё не было, говорить нечего. */
  volume: WeekVolumeSignal | null;
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

export function buildWeekSignal(input: {
  checkins: CheckinForSignal[];
  unansweredCheckinIds: Set<string>;
  todayIso: string;
}): WeekSignal {
  const painFlags: PainFlag[] = input.checkins
    .filter((checkin) => checkin.pain && input.unansweredCheckinIds.has(checkin.id))
    .sort((a, b) => (a.sessionDate < b.sessionDate ? 1 : -1))
    .map((checkin) => ({
      checkinId: checkin.id,
      sessionDate: checkin.sessionDate,
      effortLabel: checkin.effortLabel,
      painNote: checkin.painNote,
    }));

  const week = lastCompletedWeek(input.todayIso);
  const inWeek = input.checkins.filter(
    (checkin) =>
      checkin.sessionDate >= week.start &&
      checkin.sessionDate <= week.end &&
      checkin.effortRpe !== null
  );

  if (inWeek.length === 0) {
    return { painFlags, volume: null };
  }

  // Худший, а не средний: одна по-настоящему тяжёлая тренировка — это факт про
  // неделю, и усреднение его прячет.
  const worst = inWeek.reduce((acc, checkin) =>
    (checkin.effortRpe ?? 0) > (acc.effortRpe ?? 0) ? checkin : acc
  );
  const worstRpe = worst.effortRpe ?? 0;
  const band = bandOf(worstRpe);

  const headlineRu =
    band === "cut"
      ? "Неделя была тяжёлой"
      : band === "hold"
        ? "Неделя далась тяжелее обычного"
        : "Неделя прошла спокойно";

  const adviceRu =
    band === "cut"
      ? "Предлагаем срезать объём следующей недели примерно на 10–20% против обычного расчёта — дать восстановиться, прежде чем продолжать расти."
      : band === "hold"
        ? "Предлагаем на следующей неделе не увеличивать объём — держать примерно на уровне этой недели, дать втянуться."
        : "Без ограничений на рост объёма — решает обычный расчёт цикла.";

  return {
    painFlags,
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
