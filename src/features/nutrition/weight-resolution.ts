/**
 * ПРАВИЛО (не менять без Игоря; оно неочевидно и его легко потерять):
 * вес для расчётов = новейший лог nutrition_weight_logs с logged_at <= week_to разбора;
 * НЕ сегодняшний новейший; профиль (current_weight_kg) — только если логов нет.
 *
 * Второе предложение — не придирка: без привязки к week_to перегенерация старой недели
 * пересчитает её по СЕГОДНЯШНЕМУ весу, и сохранённые числа поедут задним числом.
 * Замечено на живых данных: разбор Пономарёвой за неделю до 26.07 стоял на логе от 27.07.
 *
 * СИНХРОНИЗАЦИЯ: то же правило продублировано в Cowork-скилле nutrition-weekly-report
 * (SKILL.md A5, references/formulas.md «Coherence & bodyweight»). На 2026-07-28 скилл
 * берёт `ORDER BY logged_at DESC LIMIT 1` БЕЗ фильтра по week_to — то есть сегодняшний
 * вес, и на перегенерации старой недели разойдётся с этим кодом. Правишь здесь —
 * поправь и там.
 *
 * Единая точка резолва «актуального веса ученицы».
 *
 * Решение тренера (Игорь, наряд «вес из лога»): актуальный вес — НОВЕЙШАЯ запись
 * nutrition_weight_logs, даже если confirmed_by_coach = false. Профиль
 * (nutrition_student_profiles.current_weight_kg) — ЗАПАСНОЙ вариант, когда лога нет
 * или лог не прошёл саните-гард. Раньше было наоборот (профиль первый), причём в трёх
 * разных вариантах порядка в четырёх местах — отсюда требование «единый хелпер».
 *
 * ВЕС НА ДАТУ, А НЕ НА СЕГОДНЯ: резолв принимает asOfDate (обычно week_to разбора) и
 * берёт новейший лог с logged_at <= этой даты. Иначе перегенерация старой недели
 * посчитала бы её по сегодняшнему весу и числа стали бы плавающими во времени.
 *
 * Модуль намеренно НЕ импортирует repository (иначе цикл repository → weight-resolution
 * → repository): вход описан структурно.
 */

/** Достаточная часть NutritionWeightLog — структурно, без импорта repository. */
export type NutritionWeightLogInput = {
  weightKg: number;
  loggedAt: string;
  confirmedByCoach?: boolean;
};

export type NutritionWeightSource = "log" | "profile" | "none";

export type NutritionWeightNoteCode =
  /** Лог вне правдоподобного диапазона — взят профиль. */
  | "weight_log_out_of_range"
  /** Лог скакнул относительно предыдущего сильнее допустимого — взят профиль. */
  | "weight_log_jump_rejected"
  /** Лог принят, но заметно расходится с профилем (профиль устарел — обновить/подтвердить). */
  | "weight_log_differs_from_profile"
  /** Веса нет нигде: ни лога, ни профиля. */
  | "weight_missing_everywhere";

export type NutritionWeightNote = {
  code: NutritionWeightNoteCode;
  /** Значение из лога, о котором пометка (может быть отвергнутым). */
  logWeightKg: number | null;
  /** Значение из профиля на тот же момент. */
  profileWeightKg: number | null;
  /** Готовый русский текст для карточки тренера — оба числа видны сразу. */
  textRu: string;
};

export type NutritionResolvedWeight = {
  /** Число, которое идёт во ВСЕ расчёты и во все показы. */
  weightKg: number | null;
  source: NutritionWeightSource;
  /** Лог, который выбрали (или отвергли гардом) — для пометки и диагностики. */
  logWeightKg: number | null;
  logLoggedAt: string | null;
  logConfirmedByCoach: boolean | null;
  profileWeightKg: number | null;
  /** Дата, на которую резолвили (null = «сейчас», берём новейший вообще). */
  asOfDate: string | null;
  notes: NutritionWeightNote[];
};

/**
 * Пороги откалиброваны по РЕАЛЬНЫМ данным (read-only замер 2026-07-27, 37 логов,
 * 13 учениц), а не по интуиции:
 *   - значения в базе: 48–92 кг, мусора нет вообще (ни одной записи вне 35–150);
 *   - интервал между взвешиваниями: медиана 7.0 дн (недельный ритм), p95 8.9 дн,
 *     встречаются два лога в один день (0.0 дн);
 *   - фактический шаг между соседними логами: p50 0.55 %/нед, p95 1.46, максимум 2.62.
 *
 * Диапазон 35–150 кг: с запасом накрывает наблюдаемое (48–92) и ловит грубые опечатки
 * (5.6 вместо 56, 566 вместо 56, рост 165 вместо веса).
 *
 * Скачок считаем допуском, растущим со временем: base + rate × недели.
 *   base 3 % — суточный шум (гидратация, утро/вечер): при 60 кг это 1.8 кг, поэтому
 *     два взвешивания в один день не дают ложного срабатывания.
 *   rate 5 %/нед — троекратный запас над наблюдаемым максимумом 2.62 %/нед, при этом
 *     явная ошибка ввода ловится: 60→66 за неделю = 10 % > 8 % допуска; ввод в фунтах
 *     (59 кг → 130) = 120 % — тем более.
 * Выборка мала (24 шага у 13 учениц), поэтому запас намеренно широкий: цель гарда —
 * отсечь мусор, а не судить о физиологии.
 */
export const WEIGHT_PLAUSIBLE_MIN_KG = 35;
export const WEIGHT_PLAUSIBLE_MAX_KG = 150;
export const WEIGHT_JUMP_BASE_PCT = 3;
export const WEIGHT_JUMP_PER_WEEK_PCT = 5;

/**
 * Порог «лог заметно расходится с профилем» → пометка тренеру. 2 % — по калибровке:
 * типичное расхождение 0–1.6 % (шум взвешивания и слегка отставший профиль), а выше
 * 2 % лежат ровно те случаи, где профиль реально устарел (на замере: 4.4 %, 2.9 %,
 * 2.6 %, 2.2 % — 4 ученицы из 10). Пометка тут не про опасность, а про «подтверди».
 */
export const WEIGHT_PROFILE_DIVERGENCE_PCT = 2;

function isPlausibleNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function toDayMs(value: string): number | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** Конец суток asOfDate: лог, записанный в этот день позже 00:00, всё ещё «не позже». */
function asOfCutoffMs(asOfDate: string | null | undefined): number | null {
  if (!asOfDate) {
    return null;
  }
  const dateOnly = asOfDate.slice(0, 10);
  const ms = Date.parse(`${dateOnly}T23:59:59.999Z`);
  return Number.isFinite(ms) ? ms : null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatKg(value: number | null): string {
  return value === null ? "не задан" : `${round1(value)} кг`;
}

/** Допустимое относительное изменение веса между двумя взвешиваниями, в процентах. */
export function allowedWeightChangePct(daysBetween: number): number {
  const days = Number.isFinite(daysBetween) && daysBetween > 0 ? daysBetween : 0;
  return WEIGHT_JUMP_BASE_PCT + WEIGHT_JUMP_PER_WEEK_PCT * (days / 7);
}

/**
 * Резолв веса. Порядок: новейший лог на дату (независимо от confirmed) → профиль → null.
 * Лог принимается, только если он правдоподобен по диапазону и не скакнул относительно
 * предыдущего лога сверх допуска. Не прошёл — берём профиль И ставим пометку тренеру
 * (никакой тихой подмены: профиль больше не страхует, значит подозрительный вес должен
 * быть виден).
 */
export function resolveNutritionWeight(input: {
  weightLogs: NutritionWeightLogInput[];
  profileWeightKg: number | null;
  /** Дата, на которую нужен вес (week_to разбора). null/undefined = «сейчас». */
  asOfDate?: string | null;
}): NutritionResolvedWeight {
  const profileWeightKg = isPlausibleNumber(input.profileWeightKg) ? input.profileWeightKg : null;
  const asOfDate = input.asOfDate ?? null;
  const notes: NutritionWeightNote[] = [];

  const usable = (input.weightLogs ?? [])
    .filter((log) => isPlausibleNumber(log?.weightKg) && typeof log?.loggedAt === "string")
    .map((log) => ({ ...log, ms: toDayMs(log.loggedAt) }))
    .filter((log): log is NutritionWeightLogInput & { ms: number } => log.ms !== null)
    .sort((a, b) => b.ms - a.ms);

  const cutoffMs = asOfCutoffMs(asOfDate);
  // Логи не позже даты разбора. Если таких нет (например, первый лог появился уже
  // после недели) — откатываемся ко всем логам: лучше более поздний реальный вес,
  // чем молча уехать на профиль.
  const inWindow = cutoffMs === null ? usable : usable.filter((log) => log.ms <= cutoffMs);
  const candidates = inWindow.length > 0 ? inWindow : usable;
  const candidate = candidates[0] ?? null;

  const base = {
    logWeightKg: candidate?.weightKg ?? null,
    logLoggedAt: candidate?.loggedAt ?? null,
    logConfirmedByCoach: candidate ? candidate.confirmedByCoach ?? false : null,
    profileWeightKg,
    asOfDate,
  };

  const fallbackToProfile = (note: NutritionWeightNote): NutritionResolvedWeight => {
    notes.push(note);
    if (profileWeightKg === null) {
      notes.push({
        code: "weight_missing_everywhere",
        logWeightKg: base.logWeightKg,
        profileWeightKg: null,
        textRu: "Вес не определён: лог не прошёл проверку, в профиле веса нет. Расчёты в г/кг недоступны.",
      });
      return { ...base, weightKg: null, source: "none", notes };
    }
    return { ...base, weightKg: profileWeightKg, source: "profile", notes };
  };

  if (!candidate) {
    if (profileWeightKg === null) {
      notes.push({
        code: "weight_missing_everywhere",
        logWeightKg: null,
        profileWeightKg: null,
        textRu: "Вес не определён: нет ни одного взвешивания, в профиле веса нет. Расчёты в г/кг недоступны.",
      });
      return { ...base, weightKg: null, source: "none", notes };
    }
    return { ...base, weightKg: profileWeightKg, source: "profile", notes };
  }

  // Гард 1 — диапазон.
  if (candidate.weightKg < WEIGHT_PLAUSIBLE_MIN_KG || candidate.weightKg > WEIGHT_PLAUSIBLE_MAX_KG) {
    return fallbackToProfile({
      code: "weight_log_out_of_range",
      logWeightKg: candidate.weightKg,
      profileWeightKg,
      textRu:
        `Вес из взвешивания ${formatKg(candidate.weightKg)} (${candidate.loggedAt.slice(0, 10)}) вне правдоподобного` +
        ` диапазона ${WEIGHT_PLAUSIBLE_MIN_KG}–${WEIGHT_PLAUSIBLE_MAX_KG} кг — расчёт взял вес из профиля` +
        ` (${formatKg(profileWeightKg)}). Проверь запись.`,
    });
  }

  // Гард 2 — скачок относительно предыдущего ПРАВДОПОДОБНОГО взвешивания, с поправкой на
  // срок. Именно правдоподобного: если сравнивать с ближайшим по времени, одна мусорная
  // запись (ввод в фунтах, опечатка) забраковала бы и следующий за ней нормальный вес.
  const previous =
    candidates.find(
      (log) =>
        log.ms < candidate.ms &&
        log.weightKg >= WEIGHT_PLAUSIBLE_MIN_KG &&
        log.weightKg <= WEIGHT_PLAUSIBLE_MAX_KG
    ) ?? null;
  if (previous && isPlausibleNumber(previous.weightKg)) {
    const daysBetween = (candidate.ms - previous.ms) / 86_400_000;
    const changePct = (Math.abs(candidate.weightKg - previous.weightKg) / previous.weightKg) * 100;
    const allowedPct = allowedWeightChangePct(daysBetween);
    if (changePct > allowedPct) {
      return fallbackToProfile({
        code: "weight_log_jump_rejected",
        logWeightKg: candidate.weightKg,
        profileWeightKg,
        textRu:
          `Вес из взвешивания ${formatKg(candidate.weightKg)} (${candidate.loggedAt.slice(0, 10)}) — скачок` +
          ` с ${formatKg(previous.weightKg)} за ${round1(daysBetween)} дн (${round1(changePct)} % при допустимых` +
          ` ${round1(allowedPct)} %). Расчёт взял вес из профиля (${formatKg(profileWeightKg)}). Проверь запись.`,
      });
    }
  }

  // Лог принят. Пометку про «не подтверждён» НЕ ставим: после этой правки
  // неподтверждённый лог — норма (ученицы шлют вес через мини-апп, coach-confirm
  // ставится редко), пометка стала бы шумом на каждой ученице. Помечаем только
  // расхождение с профилем — там решение тренера действительно требуется.
  if (profileWeightKg !== null) {
    const divergencePct = (Math.abs(candidate.weightKg - profileWeightKg) / profileWeightKg) * 100;
    if (divergencePct >= WEIGHT_PROFILE_DIVERGENCE_PCT) {
      notes.push({
        code: "weight_log_differs_from_profile",
        logWeightKg: candidate.weightKg,
        profileWeightKg,
        textRu:
          `Расчёт на весе из взвешивания ${formatKg(candidate.weightKg)} (${candidate.loggedAt.slice(0, 10)});` +
          ` в профиле ${formatKg(profileWeightKg)} — расхождение ${round1(divergencePct)} %.` +
          ` Профиль стоит обновить.`,
      });
    }
  }

  return { ...base, weightKg: candidate.weightKg, source: "log", notes };
}

/** Тексты пометок для карточки тренера. Пусто = показывать нечего. */
export function formatNutritionWeightNotesRu(resolved: NutritionResolvedWeight | null | undefined): string[] {
  return (resolved?.notes ?? []).map((note) => note.textRu);
}
