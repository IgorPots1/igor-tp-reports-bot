/**
 * Неделя начинающего: лестница шаг-бега, разложенная по дням.
 *
 * ЭТО НЕ ВТОРОЙ ГЕНЕРАТОР. У взрослого атлета неделя СЧИТАЕТСЯ: конверт объёма,
 * потолки роста, отбор качества, расстановка по гистограммам практики. У
 * новичка считать нечего — методика назначает конкретную сессию (ступень
 * лестницы), и вся работа сводится к тому, чтобы разложить её по свободным
 * дням. Поэтому здесь нет ни арифметики объёма, ни якорей, ни отбора: их
 * отсутствие — не упрощение, а точное следование методике.
 *
 * Вход в сборщик один — buildWeek: ветка новичка стоит там ранним возвратом,
 * чтобы у обеих дорог была общая дверь. Ростер TrainingPeaks в эту ветку не
 * попадает никогда: она включается только явно переданным входом, которого
 * вызовы ростера не передают.
 */

import type { AthletePreference } from "./athlete-preferences.ts";
import { resolvePreferences } from "./athlete-preferences.ts";
import type { Catalog } from "./autoplanner-catalog.ts";
import type { Segment, Session, Week } from "./autoplanner-week.ts";
import type { Tier } from "./pace-resolver.ts";

/** Ступень лестницы в том виде, в каком её отдаёт методика. */
export type BeginnerStepInput = {
  index: number;
  presetCode: string;
  kind: "run_walk" | "continuous";
  reps: number | null;
  repsMin: number | null;
  runMin: number | null;
  walkMin: number | null;
  continuousMin: number | null;
  labelRu: string;
  totalMinutes: number;
  runningMinutes: number;
};

export type BeginnerWeekInput = {
  step: BeginnerStepInput;
  title: string;
  description: string;
  /** Первая неделя — диагностическая: одна тренировка, а не полная неделя. */
  isDiagnostic: boolean;
  runsThisWeek: number;
  rpeTarget: number;
  rpeCap: number;
  /** Что решило правило перехода перед этой неделей. */
  progressionNote: string | null;
  /**
   * Потолок длительности одной тренировки из анкеты. null — потолка нет.
   *
   * Ступень НЕ РЕЖЕТСЯ под него. Её длительность — это методика: укоротив
   * «5 x 5 мин бег / 1 мин шаг» до тридцати минут, мы выдадим сессию, которой
   * в лестнице нет, и следующая ступень встанет на несделанную работу.
   * Поэтому конфликт поднимается ТРЕНЕРУ: человеку столько времени не хватает,
   * и решать это ему, а не генератору.
   */
  maxSessionMinutes?: number | null;
};

/**
 * РАССТАНОВКА ПО ДНЯМ. Гистограммы практики у новичка нет — её неоткуда взять,
 * поэтому дни задаются шаблоном, а не подбором.
 *
 * Между беговыми днями всегда минимум один день отдыха: у человека, который
 * начинает бегать, восстановление медленнее нагрузки, и две пробежки подряд —
 * первая причина, по которой начинающие бросают. Вт/Чт/Сб оставляет свободными
 * и воскресенье, и понедельник — два дня, которые чаще всего заняты у людей с
 * обычной жизнью.
 */
const DAY_PATTERN: Record<number, number[]> = {
  1: [2],
  2: [1, 4],
  3: [1, 3, 5],
};

function placeDays(runsThisWeek: number, blocked: Set<number>): { days: number[]; warnings: string[] } {
  const warnings: string[] = [];
  const wanted = DAY_PATTERN[runsThisWeek] ?? DAY_PATTERN[3];
  const used = new Set<number>();
  const days: number[] = [];

  for (const day of wanted) {
    if (!blocked.has(day) && !used.has(day)) {
      days.push(day);
      used.add(day);
      continue;
    }
    // День занят — ищем ближайший свободный, сначала вперёд, потом назад.
    let placed = false;
    for (let shift = 1; shift <= 6 && !placed; shift += 1) {
      for (const candidate of [day + shift, day - shift]) {
        if (candidate < 0 || candidate > 6) continue;
        if (blocked.has(candidate) || used.has(candidate)) continue;
        days.push(candidate);
        used.add(candidate);
        placed = true;
        warnings.push(`день сдвинут: ${day} занят, поставили ${candidate}`);
        break;
      }
    }
    if (!placed) {
      warnings.push("свободных дней меньше, чем беговых тренировок — часть не поставлена");
    }
  }

  days.sort((a, b) => a - b);
  // Соседние дни у новичка недопустимы: если после сдвигов они всё же
  // получились, тренер обязан это увидеть, а не обнаружить в плане.
  for (let i = 1; i < days.length; i += 1) {
    if (days[i] - days[i - 1] === 1) {
      warnings.push("две пробежки в соседние дни — проверьте недоступные дни в анкете");
      break;
    }
  }
  return { days, warnings };
}

/** Структура сессии по сегментам. Без темпов — у новичка их нет по методике. */
function buildSegments(step: BeginnerStepInput): Segment[] {
  if (step.kind === "continuous") {
    return [
      { minutes: step.continuousMin ?? step.totalMinutes, fastSec: null, slowSec: null, label: "непрерывный лёгкий бег", noPaceText: "по ощущениям" },
    ];
  }
  const segments: Segment[] = [];
  const reps = step.reps ?? 5;
  for (let index = 0; index < reps; index += 1) {
    segments.push({ minutes: step.runMin ?? 0, fastSec: null, slowSec: null, label: `бег ${index + 1}`, noPaceText: "по ощущениям" });
    segments.push({ minutes: step.walkMin ?? 0, fastSec: null, slowSec: null, label: `шаг ${index + 1}`, noPaceText: "спокойный шаг" });
  }
  return segments;
}

export function composeBeginnerWeek(
  athleteId: number,
  tier: Tier,
  weekStart: string,
  input: BeginnerWeekInput,
  cat: Catalog,
  prefs: AthletePreference[] | null
): Week {
  const notes: string[] = [];
  const coachReview: string[] = [];
  const warnings: string[] = [];

  const effect = prefs && prefs.length ? resolvePreferences(prefs, weekStart) : null;
  if (effect) notes.push(...effect.notes);
  const blocked = new Set<number>(effect ? [...effect.blockedDays] : []);

  const runs = input.isDiagnostic ? 1 : input.runsThisWeek;
  if (input.isDiagnostic) {
    notes.push("первая неделя диагностическая: одна тренировка, чтобы увидеть, как человек её перенёс");
  }
  if (input.progressionNote) notes.push(input.progressionNote);

  const { days, warnings: dayWarnings } = placeDays(runs, blocked);
  warnings.push(...dayWarnings);

  // СВЕРКА С КАТАЛОГОМ. Числа берутся из методики, но каталог — то, что видит и
  // правит тренер. Разошлись — значит, кто-то поправил одно и забыл другое, и
  // это должен увидеть человек, а не тихо проглотить генератор.
  const catalogPreset = cat.beginner.get(input.step.presetCode);
  if (!catalogPreset) {
    coachReview.push(
      `пресета ${input.step.presetCode} нет в каталоге — план собран по методике, каталог отстал`
    );
  } else {
    const mismatches: string[] = [];
    if (input.step.kind === "run_walk") {
      if (catalogPreset.runMinutes !== input.step.runMin) mismatches.push(`бег ${catalogPreset.runMinutes} против ${input.step.runMin}`);
      if (catalogPreset.walkMinutes !== input.step.walkMin) mismatches.push(`шаг ${catalogPreset.walkMinutes} против ${input.step.walkMin}`);
      if (catalogPreset.reps !== input.step.reps) mismatches.push(`повторов ${catalogPreset.reps} против ${input.step.reps}`);
    } else if (catalogPreset.continuousMinutes !== input.step.continuousMin) {
      mismatches.push(`непрерывный ${catalogPreset.continuousMinutes} против ${input.step.continuousMin}`);
    }
    if (catalogPreset.rpeCap !== null && catalogPreset.rpeCap !== input.rpeCap) {
      mismatches.push(`потолок RPE ${catalogPreset.rpeCap} против ${input.rpeCap}`);
    }
    if (mismatches.length) {
      coachReview.push(`каталог разошёлся с методикой: ${mismatches.join("; ")}`);
    }
  }

  // ПОТОЛОК ВРЕМЕНИ ИЗ АНКЕТЫ. Не режем, а показываем: расхождение между тем,
  // сколько у человека есть, и тем, сколько требует ступень, — это разговор
  // тренера с человеком, а не арифметика.
  const cap = input.maxSessionMinutes ?? null;
  if (cap !== null && input.step.totalMinutes > cap) {
    coachReview.push(
      `ступень занимает ${input.step.totalMinutes} мин, а человек назвал потолок ${cap} мин: ` +
        "программа не влезает во время, которое у него есть"
    );
  }

  const segments = buildSegments(input.step);
  const sessions: Session[] = days.map((dayIdx) => ({
    dayIdx,
    role: "easy",
    presetCode: input.step.presetCode,
    title: input.title,
    minutes: Math.round(input.step.totalMinutes),
    description: input.description,
    segments,
    // Якоря нет и не должно быть: методика новичка прямо требует управления по
    // ощущению, без темпа и пульса.
    anchorSource: "методика новичка",
    confidence: "—",
    targetMode: "rpe",
    pctMin: null,
    pctMax: null,
    roundTrip: { ok: true, expected: 0, parsedRanges: 0, parsedSegments: segments.length, problems: [] },
    deferred: false,
    deferReason: null,
    warnings,
    coachReview,
  }));

  notes.push(
    `ступень ${input.step.index}: ${input.step.labelRu}; ` +
      `беговых минут в сессии ${input.step.runningMinutes} из ${input.step.totalMinutes}`
  );

  return {
    athleteId,
    tier,
    weekStart,
    days,
    sessions,
    notes,
    refused: sessions.length === 0 ? "не осталось свободных дней под беговые тренировки" : null,
    refusedKind: sessions.length === 0 ? "does_not_fit" : null,
    qualityDecision: "не выдана: методика новичка не назначает качественную работу",
    weeklyCap: input.step.runningMinutes * runs,
    plannedMinutes: sessions.reduce((sum, session) => sum + session.minutes, 0),
  };
}
