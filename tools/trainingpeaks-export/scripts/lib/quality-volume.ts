/**
 * quality-volume — разложение плановой сессии на АЭРОБНЫЕ и КАЧЕСТВЕННЫЕ минуты.
 *
 * ПРАВИЛО ИГОРЯ (наряд 11.08): качественный объём — это ТОЛЬКО рабочие отрезки.
 * Разминка, трусца между отрезками и заминка идут в аэробный. Считать иначе — завысить
 * качество вдвое: у thr_4x12 работы 48 мин, а сессия с канонической разминкой — 96.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ, А НЕ ПРАВКА INTERVAL_TITLE_RE.
 * INTERVAL_TITLE_RE из easy-anchor.ts решает другую задачу — какие тренировки НЕ кормят
 * якорь лёгкого. Она стоит на живом пути: правка там немедленно меняет предписанные темпы
 * реальным ученикам. Здесь считается ОБЪЁМ для замеров и целей цикла. Задачи разные,
 * и смешивать их нельзя, поэтому классификация объёма живёт отдельно.
 *
 * ЕДИНИЦЫ: на вход плановые минуты (planned_time_raw в БД — ЧАСЫ, умножать до вызова).
 */

/** Заголовок вообще похож на качественную работу. Та же форма, что в easy-anchor. */
const QUALITY_TITLE_RE = /([0-9]+\s*[xх×]\s*[0-9]|интерв|отрезк|повтор|порог|фартлек|vo\s?2|мпк|темп выше)/i;

/**
 * «(темп выше)» — НЕ качество. Замер 11.08 по 290 сессиям с прописанным диапазоном:
 * самый быстрый кусок описания идёт на 76% от порога (p10 71%, p90 80%), тогда как обычный
 * лёгкий и длительный — на 83% (n=825), а настоящие отрезки — на 99% (n=1083).
 * То есть «темп выше» бежится МЕДЛЕННЕЕ обычного лёгкого. В описаниях прямым текстом
 * «лёгкий, устойчивый темп», «Zone 2», «быстрее 06:45 не бегите».
 *
 * Это пометка интерфейса о том, где показан темп, а не указание бежать быстро.
 * Темпового блока внутри нет, поэтому по правилу Игоря вся сессия — аэробная.
 */
const TEMPO_MARKER_RE = /темп выше/i;

/** «6 x 4 мин», «12 x 2,5 мин», «7 x 4 min» — работа N × M минут. */
const SHAPE_MIN = /([0-9]{1,2})\s*[xх×]\s*([0-9]{1,2}(?:[.,][0-9])?)\s*(?:мин|min)/i;
/** «3 x 3 км» — то же, что метры, только в километрах. */
const SHAPE_KM = /([0-9]{1,2})\s*[xх×]\s*([0-9]{1,2}(?:[.,][0-9])?)\s*км/i;
/**
 * «9 x 800», «4 х 10 (бегите побыстрее)» — единица не написана вовсе.
 * Разводим по величине: 100 и больше — это метры («9 x 800»), 30 и меньше — минуты
 * («3 x 14» в 63-минутной сессии даёт 42 мин работы, что сходится с разминкой и заминкой).
 * Промежуток 31–99 неоднозначен и остаётся неразобранным — гадать там нечего.
 */
const SHAPE_BARE = /([0-9]{1,2})\s*[xх×]\s*([0-9]{1,4})(?!\s*(?:мин|min|сек|м|км|:))/i;
/**
 * «6 х 4 / 2» и «6 х 4 + 2» — то же N × M, а хвост это ОТДЫХ, не работа.
 * Подтверждено описанием: «6 серий: 4 мин бег: темп выше чем на прошлых тренировках
 * + 2 мин спокойно шагом». Хвост в работу не идёт.
 */
const SHAPE_SETS = /([0-9]{1,2})\s*[xх×]\s*([0-9]{1,2}(?:[.,][0-9])?)\s*(?:мин\s*)?[/+]\s*([0-9]{1,2}(?:[.,][0-9])?)/i;
/** «30 x 40 сек» — работа N × M секунд. */
const SHAPE_SEC = /([0-9]{1,3})\s*[xх×]\s*([0-9]{1,3})\s*сек/i;
/** «8 х 800 м», «15 x 400 м» — работа в МЕТРАХ, минуты считаются через темп. */
const SHAPE_METERS = /([0-9]{1,3})\s*[xх×]\s*([0-9]{2,5})\s*м(?![a-zа-яё])/i;

/**
 * Темп рабочих отрезков как доля порога. ЗАМЕРЕНО 11.08 (n=1083 сессии с разобранной
 * формой и прописанным диапазоном): самый быстрый кусок описания — медиана 99% порога,
 * p10 92%, p90 106%. Берём 1.0 — работа идёт примерно НА пороге.
 * Нужно только для форм в метрах: минуты = метры / скорость.
 */
export const WORK_PACE_AS_THRESHOLD_SHARE = 1.0;

export type VolumeKind =
  | "aerobic"            // не качество вовсе
  | "tempo_marker"       // «(темп выше)» — по замеру аэробное, см. выше
  | "interval_minutes"   // форма разобрана в минутах
  | "interval_seconds"   // форма разобрана в секундах
  | "interval_meters"    // форма в метрах, минуты ОЦЕНЕНЫ через порог
  | "interval_unparsed"; // качество на вид, но форма не читается

export type VolumeSplit = {
  kind: VolumeKind;
  /** минуты рабочих отрезков */
  qualityMin: number;
  /** всё остальное время сессии */
  aerobicMin: number;
  /** true, если qualityMin получен оценкой, а не прочитан напрямую */
  estimated: boolean;
};

const num = (s: string): number => Number(s.replace(",", "."));

/**
 * Разложить сессию. thresholdSecPerKm нужен только для форм в метрах;
 * без него такая сессия честно уходит в interval_unparsed, а не оценивается наугад.
 */
export function splitSessionVolume(
  title: string | null,
  plannedMinutes: number,
  thresholdSecPerKm?: number | null,
): VolumeSplit {
  const t = title ?? "";
  const total = plannedMinutes > 0 ? plannedMinutes : 0;
  const all = (kind: VolumeKind): VolumeSplit => ({ kind, qualityMin: 0, aerobicMin: total, estimated: false });

  if (!QUALITY_TITLE_RE.test(t)) return all("aerobic");
  if (TEMPO_MARKER_RE.test(t)) return all("tempo_marker");

  const clamp = (work: number, kind: VolumeKind, estimated: boolean): VolumeSplit => {
    // Работа не может занимать больше самой сессии — иначе заголовок врёт о длительности.
    const q = Math.max(0, Math.min(total, Math.round(work)));
    return { kind, qualityMin: q, aerobicMin: total - q, estimated };
  };

  // ПОРЯДОК ВАЖЕН: «6 х 4 / 2» и «6 х 4 + 2» должны разобраться как множества ДО того,
  // как SHAPE_MIN подхватит из них «6 х 4 мин» (в «6 х 4 + 2 мин» «мин» относится к отдыху).
  const sets = SHAPE_SETS.exec(t);
  if (sets) {
    const reps = num(sets[1]), work = num(sets[2]);
    if (reps >= 2 && reps <= 40 && work > 0 && work <= 30) return clamp(reps * work, "interval_minutes", false);
  }
  const min = SHAPE_MIN.exec(t);
  if (min) {
    const reps = num(min[1]), work = num(min[2]);
    if (reps >= 2 && reps <= 40 && work > 0 && work <= 30) return clamp(reps * work, "interval_minutes", false);
  }
  const sec = SHAPE_SEC.exec(t);
  if (sec) {
    const reps = num(sec[1]), work = num(sec[2]);
    if (reps >= 2 && reps <= 60 && work > 0 && work <= 600) return clamp(reps * work / 60, "interval_seconds", false);
  }
  const fromMeters = (reps: number, meters: number): VolumeSplit | null => {
    if (!(reps >= 2 && reps <= 60 && meters >= 100 && meters <= 5000)) return null;
    if (!(thresholdSecPerKm && thresholdSecPerKm > 0)) return all("interval_unparsed");
    // минуты = повторы × (метры / 1000) × темп_работы(сек/км) / 60
    const paceSec = thresholdSecPerKm / WORK_PACE_AS_THRESHOLD_SHARE;
    return clamp(reps * (meters / 1000) * paceSec / 60, "interval_meters", true);
  };
  const met = SHAPE_METERS.exec(t);
  if (met) { const r = fromMeters(num(met[1]), num(met[2])); if (r) return r; }
  const km = SHAPE_KM.exec(t);
  if (km) { const r = fromMeters(num(km[1]), num(km[2]) * 1000); if (r) return r; }
  const bare = SHAPE_BARE.exec(t);
  if (bare) {
    const reps = num(bare[1]), v = num(bare[2]);
    if (reps >= 2 && reps <= 40 && v > 0 && v <= 30) return clamp(reps * v, "interval_minutes", false);
    if (reps >= 2 && reps <= 60 && v >= 100) { const r = fromMeters(reps, v); if (r) return r; }
  }
  return all("interval_unparsed");
}
