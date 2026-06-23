// Расчёт тренировочных темпов из результата забега.
// VDOT считаем по формулам Дэниелса (vdotFromRace), но темповые зоны строим
// по модели Фрила: якорь FTPa = темп на VDOT×0.913, дальше зоны как множители
// от FTPa. Множители из наряда — НЕ менять без сверки.
// Проверочный пример (10 км за 40:00, FTPa = 4:00/км):
//   лёгкий 4:34–5:10 · темповый 4:14–4:34 ·
//   длинные интервалы 4:00–4:14 · короткие 3:43–3:52.

// 1) VDOT из результата забега
export function vdotFromRace(meters: number, seconds: number): number {
  const min = seconds / 60;
  const v = meters / min; // м/мин
  const vo2 = -4.6 + 0.182258 * v + 0.000104 * v * v;
  const pct =
    0.8 +
    0.1894393 * Math.exp(-0.012778 * min) +
    0.2989558 * Math.exp(-0.1932605 * min);
  return vo2 / pct;
}

// 2) Скорость (м/мин) для заданного % от VDOT
export function velAt(vdot: number, pct: number): number {
  const vo2 = pct * vdot;
  const a = 0.000104;
  const b = 0.182258;
  const c = -4.6 - vo2;
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}

// 3) Темп (сек/км) из скорости (м/мин)
export function paceSecPerKm(v: number): number {
  return (60 * 1000) / v;
}

// 4) FTPa — пороговый темп-якорь (сек/км). FTPa ≈ соревновательный темп
// на 10 км / часовой порог. На нём держатся все зоны Фрила.
const FTPA_PCT = 0.913;

export function ftpaSecPerKm(vdot: number): number {
  return paceSecPerKm(velAt(vdot, FTPA_PCT));
}

// 5) Диапазон темпа из множителей FTPa — [быстрее, медленнее] в сек/км.
// Меньше множитель = быстрее.
export function zonePaceRange(
  ftpa: number,
  multFast: number,
  multSlow: number,
): [number, number] {
  const fast = ftpa * multFast;
  const slow = ftpa * multSlow;
  return [Math.min(fast, slow), Math.max(fast, slow)];
}

// Форматирование темпа: M:SS с ведущим нулём секунд.
export function formatPace(secPerKm: number): string {
  const total = Math.round(secPerKm);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Диапазон темпа строкой: "быстрый–медленный /км".
export function formatPaceRange(range: [number, number]): string {
  return `${formatPace(range[0])}–${formatPace(range[1])} /км`;
}

// ===== Зоны Фрила как множители от FTPa: [быстрый край, медленный край] =====
// Меньше множитель = быстрее темп.
export const FRIEL_ZONES = {
  easy: { fast: 1.142, slow: 1.292 }, // Зона 2
  tempo: { fast: 1.058, slow: 1.142 }, // Зона 3
  longIntervals: { fast: 1.0, slow: 1.058 }, // Зона 4 (порог)
  shortIntervals: { fast: 0.929, slow: 0.967 }, // Зона 5b (МПК, низ поджат до 0.929)
} as const;

export type RaceDistance = 5000 | 10000;

export type WorkoutCard = {
  id: "easy" | "tempo" | "long_intervals" | "short_intervals";
  title: string;
  paceRange: string;
  format: string;
  workVolume?: string; // «Объём работы»
  description: string;
};

// Считает 4 карточки тренировок из результата на 5 или 10 км.
export function buildWorkoutCards(
  meters: RaceDistance,
  seconds: number,
): WorkoutCard[] {
  const vdot = vdotFromRace(meters, seconds);
  const ftpa = ftpaSecPerKm(vdot);

  const easyPace = formatPaceRange(
    zonePaceRange(ftpa, FRIEL_ZONES.easy.fast, FRIEL_ZONES.easy.slow),
  );
  const tempoPace = formatPaceRange(
    zonePaceRange(ftpa, FRIEL_ZONES.tempo.fast, FRIEL_ZONES.tempo.slow),
  );
  const longIntervalsPace = formatPaceRange(
    zonePaceRange(
      ftpa,
      FRIEL_ZONES.longIntervals.fast,
      FRIEL_ZONES.longIntervals.slow,
    ),
  );
  const shortIntervalsPace = formatPaceRange(
    zonePaceRange(
      ftpa,
      FRIEL_ZONES.shortIntervals.fast,
      FRIEL_ZONES.shortIntervals.slow,
    ),
  );

  return [
    {
      id: "easy",
      title: "Лёгкий бег",
      paceRange: easyPace,
      format: "Непрерывно 30–60 мин, разговорный темп.",
      description:
        "Разговорный темп, можешь говорить полными предложениями. Основа объёма недели.",
    },
    {
      id: "tempo",
      title: "Темповый бег",
      paceRange: tempoPace,
      format: "Один кусок 15–30 мин без остановок.",
      workVolume: "15–30 мин",
      description:
        "Ровный непрерывный бег одним куском, тяжело, но под контролем.",
    },
    {
      id: "long_intervals",
      title: "Длинные интервалы",
      paceRange: longIntervalsPace,
      format: "Отрезки 4–12 мин, отдых трусцой 1–1.5 мин.",
      workVolume: "30–40 мин",
      description:
        "Пороговый темп отрезками, чуть быстрее непрерывного темпового.",
    },
    {
      id: "short_intervals",
      title: "Короткие интервалы",
      paceRange: shortIntervalsPace,
      format:
        "Отрезки 1–4 мин, отдых трусцой примерно равен длине отрезка.",
      workVolume: "12–18 мин",
      description:
        "Быстро и тяжело, почти на максимуме, где дышать уже тяжело. Учат тело потреблять больше кислорода.",
    },
  ];
}
