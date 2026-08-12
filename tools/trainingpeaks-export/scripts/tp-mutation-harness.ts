/**
 * tp-mutation-harness — МУТАЦИОННЫЙ ТЕСТ ПРОВЕРОК ЦИКЛА. READ-ONLY по данным.
 *
 * ЗАЧЕМ. За пять нарядов СЕМЬ проверок оказались беззубыми: зелёные на исправном коде и
 * зелёные на сломанном. Все семь нашлись случайно, ни одна — обычным прогоном. Пока это
 * так, «48 из 48» ничего не значит, и заводить первый живой цикл нельзя.
 *
 * КАК РАБОТАЕТ. Берёт каталог мутаций (точечная порча одной величины в исходнике), для
 * каждой: применяет → прогоняет check:cycle-forecast → записывает, КАКИЕ проверки упали →
 * возвращает файл как был. На выходе матрица «проверка → каким мутациям она сопротивляется».
 *
 * ПРОВЕРКА, КОТОРУЮ НЕ УБИЛА НИ ОДНА МУТАЦИЯ, — ПОДОЗРИТЕЛЬНАЯ. Это не доказательство, что
 * она беззубая (может, в каталоге нет подходящей порчи), но это единственный список, по
 * которому вообще есть смысл смотреть глазами.
 *
 * ЧЕСТНОЕ ОГРАНИЧЕНИЕ: мутации написаны РУКАМИ и покрывают то, что я счёл существенным.
 * Полного покрытия тут нет и быть не может — это не формальное доказательство, а сито.
 *
 * Восстановление файлов идёт в finally, поэтому падение посреди прогона не оставляет
 * репозиторий испорченным. Всё равно после прогона стоит глянуть `git status`.
 *
 * Запуск: npx tsx tools/trainingpeaks-export/scripts/tp-mutation-harness.ts
 *         --only=<подстрока>   прогнать часть каталога
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { toolRoot } from "./lib/paths.ts";

const LIB = path.join(toolRoot, "scripts", "lib");
const W = path.join(LIB, "autoplanner-week.ts");
const C = path.join(LIB, "training-cycle.ts");
const X = path.join(LIB, "autoplanner-context.ts");
const R = path.join(LIB, "cycle-reader.ts");
const Q = path.join(LIB, "quality-select.ts");
const P = path.join(LIB, "practice-signals.ts");
const LIBCAT = path.join(LIB, "autoplanner-catalog.ts");
const V = path.join(LIB, "quality-volume.ts");

type Mutation = { id: string; file: string; find: string; replace: string; what: string };

/**
 * КАТАЛОГ. Каждая мутация ломает РОВНО ОДНУ величину и описывает, что именно сломано.
 * Порядок — по модулям, чтобы читать матрицу было проще.
 */
const MUTATIONS: Mutation[] = [
  // ── прогноз цикла ──
  { id: "step-aerobic", file: C, find: "export const STEP_AEROBIC = 1.06;", replace: "export const STEP_AEROBIC = 1.30;", what: "шаг роста аэробного 1.06 → 1.30" },
  // ── ФОРМУЛЫ, А НЕ КОНСТАНТЫ ──
  // Проверки читают те же константы, что и код (это задокументировано в шапке проверок:
  // сверяется ФОРМУЛА, значения — глазами по отчёту). Поэтому подмена константы для них
  // невидима ПО ЗАМЫСЛУ, и мутация значения ничего не доказывает. Ломаем применение.
  { id: "deload-depth-formula", file: C, find: "      const a = round5(fromA * draft.deloadDepthAerobic);", replace: "      const a = round5(fromA * 0.95);", what: "разгрузка аэробного применяет 0.95 вместо заданной доли" },
  { id: "deload-quality-formula", file: C, find: "      const qRawD = round5(fromQ * draft.deloadQualityFactor);", replace: "      const qRawD = round5(fromQ * 1.0);", what: "разгрузка работы не режет вовсе" },
  { id: "deload-base", file: C, find: "      const a = round5(fromA * draft.deloadDepthAerobic);", replace: "      const a = round5(draft.baseAerobicMin * draft.deloadDepthAerobic);", what: "разгрузка считается от БАЗЫ, а не от показанной прошлой недели" },
  { id: "taper-formula", file: C, find: "        const aF = noPeak ? TAPER_NO_PEAK_FACTOR : tw.aerobicFactor;", replace: "        const aF = noPeak ? TAPER_NO_PEAK_FACTOR : tw.aerobicFactor * 0.7;", what: "подводка режет глубже своего профиля" },
  { id: "taper-nopeak-formula", file: C, find: "        const aF = noPeak ? TAPER_NO_PEAK_FACTOR : tw.aerobicFactor;", replace: "        const aF = noPeak ? 0.5 : tw.aerobicFactor;", what: "подводка без пика режет вдвое вместо −10%" },
  { id: "share-clamp-off", file: C, find: "        const cl = clampShare(a, qRaw, draft.ownSharePct, draft.peakCapQualityMin);", replace: "        const cl = { aerobicMin: a, qualityMin: qRaw };", what: "зажим доли качества не применяется в подводке" },

  // ── точка прицеливания ──
  { id: "aim-median", file: C, find: "  return Math.round((med + p75) / 2);", replace: "  void p75; return Math.round(med);", what: "прицел вернулся на медиану" },
  { id: "aim-p75", file: C, find: "  return Math.round((med + p75) / 2);", replace: "  void med; return Math.round(p75);", what: "прицел уехал на p75 целиком" },

  // ── выбор целевого старта ──  // ── выбор целевого старта ──
  { id: "race-min-weeks", file: C, find: "x.w >= TARGET_RACE_MIN_WEEKS && ", replace: "x.w >= 0 && ", what: "порог «ближе 2 недель не цель» снят" },
  { id: "race-horizon", file: C, find: " && x.w <= LENGTH_WEEKS[intentFromDistance(x.r.distance_km)])", replace: ")", what: "горизонт выбора цели снят" },
  { id: "race-longest", file: C, find: "    (b.r.distance_km ?? 0) - (a.r.distance_km ?? 0) || a.r.event_date.localeCompare(b.r.event_date));", replace: "    a.r.event_date.localeCompare(b.r.event_date));", what: "«длинная бьёт короткую» → просто ближайший" },
  { id: "race-nodist", file: C, find: "    .filter((r) => r.distance_km != null)", replace: "    .filter(() => true)", what: "старты без дистанции проходят в цель" },

  // ── сборщик недели: объём ──
  { id: "topup-envelope", file: W, find: "  const targetWeekly = cycle\n    ? weekly\n    : Math.min(weekly, env.rolling4wPlannedMin > 0 ? env.rolling4wPlannedMin : weekly);", replace: "  const targetWeekly = Math.min(weekly, env.rolling4wPlannedMin > 0 ? env.rolling4wPlannedMin : weekly);", what: "конверт истории вернулся в добор объёма" },
  { id: "cycle-weekly", file: W, find: "    weekly = Math.max(0, cycle.aerobicMin + cycle.qualityMin);", replace: "    weekly = Math.min(env.rolling4wPlannedMin || 0, cycle.aerobicMin + cycle.qualityMin);", what: "потолок недели снова ограничен конвертом" },
  { id: "cycle-days", file: W, find: "    nWant = clamp(cycle.days, 1, 7);", replace: "    nWant = clamp(Math.round(env.rolling4wFrequency || 3), 1, 7);", what: "число дней берётся из истории, а не из цикла" },

  // ── сборщик недели: длительная ──
  { id: "long-ceil", file: W, find: "export const LONG_CEIL = 200;", replace: "export const LONG_CEIL = 180;", what: "жёсткий предел длительной 200 → 180" },
  { id: "long-zero-baseline", file: W, find: "  const baselineLong = (env.capLongRunMin ?? 0) > 0 ? (env.capLongRunMin as number) : null;", replace: "  const baselineLong = env.capLongRunMin ?? null;", what: "нулевой baseline снова работает потолком" },
  { id: "long-practice-first", file: W, find: "  const longCapSource = cycle ? (practiceLong ?? baselineLong) : (baselineLong ?? practiceLong);", replace: "  const longCapSource = baselineLong ?? practiceLong;", what: "цикл снова берёт замороженный baseline" },
  { id: "long-floor-scale", file: W, find: "  let floorScale = Math.min(1, cycleWeekTarget / cycleBaseWeek);", replace: "  let floorScale = 1;", what: "пол практики не едет со сниженной целью" },
  { id: "long-floor-signal", file: W, find: "  if (notTraining) floorScale = cycle?.hasTargetRace ? floorScale * Math.min(1, weekly / cycleWeekTarget) : 0;", replace: "  if (notTraining) floorScale = 0;", what: "целевой старт больше не защищает длительную" },
  { id: "long-grow", file: W, find: "  const floorBase = cycle && distTarget && distStep && cycle.hasTargetRace", replace: "  const floorBase = false && cycle && distTarget && distStep && cycle.hasTargetRace", what: "рост длительной под дистанцию снят" },
  { id: "long-grow-target", file: W, find: "    ? Math.min(distTarget, env.longRunPracticeMedianMin * Math.pow(distStep, Math.max(0, (cycle.weekIndex ?? 1) - 1)))", replace: "    ? env.longRunPracticeMedianMin * Math.pow(distStep, Math.max(0, (cycle.weekIndex ?? 1) - 1))", what: "рост перелетает цель дистанции" },
  { id: "long-share-guard", file: W, find: "    ? Math.min(Math.max(practiceFloor, Math.min(grownFloor, weekly * 0.45)), LONG_CEIL) : 0;", replace: "    ? Math.min(Math.max(practiceFloor, grownFloor), LONG_CEIL) : 0;", what: "рост пола обходит защиту доли x0.45" },
  { id: "long-not-zero", file: W, find: "      const weekIsReduced = notTraining\n        || (cycle != null && cycle.baseWeekMin != null && weekly < cycle.baseWeekMin);", replace: "      const weekIsReduced = notTraining;", what: "подводка снова обнуляет длительную" },
  { id: "long-not-zero-2", file: W, find: "      const isReallyLong = weekIsReduced\n        ? longMin >= LONG_FLOOR && longMin > longestEasyThisWeek\n        : (env.typicalEasyMinutes <= 0 || longMin > env.typicalEasyMinutes);", replace: "      const isReallyLong = env.typicalEasyMinutes <= 0 || longMin > env.typicalEasyMinutes;", what: "правило именования длительной откачено целиком" },
  { id: "dist-step", file: W, find: 'export const LONG_CAP_STEP_BY_INTENT: Record<string, number> = { marathon: 1.116, half: 1.187 };', replace: 'export const LONG_CAP_STEP_BY_INTENT: Record<string, number> = { marathon: 1.0, half: 1.0 };', what: "шаг роста длительной обнулён" },
  { id: "dist-any-intent", file: W, find: "  const floorBase = cycle && distTarget && distStep && cycle.hasTargetRace", replace: "  const floorBase = cycle && (distTarget ?? 180) && (distStep ?? 1.116)", what: "рост длительной применяется к ЛЮБОМУ циклу, без старта и без дистанции" },

  { id: "easy-target-median", file: P, find: "export function easyTargetPersonal(samples: number[]): number {\n  if (samples.length < MIN_RUNS_FOR_PERSONAL_FLOOR) return 0;\n  return median(samples);", replace: "export function easyTargetPersonal(samples: number[]): number {\n  if (samples.length < MIN_RUNS_FOR_PERSONAL_FLOOR) return 0;\n  return Math.min(...samples);", what: "личная цель лёгкой берётся как min вместо медианы" },

  // ── сборщик недели: пол лёгкой ──
  { id: "easy-floor-personal", file: W, find: "  if (easyFloorPersonal > 0) {", replace: "  if (false && easyFloorPersonal > 0) {", what: "личный пол лёгкой не подставляется" },
  { id: "easy-floor-scale", file: W, find: "    const scaled = cycle ? easyFloorPersonal * (floorScale > 0 ? floorScale : 1) : easyFloorPersonal;", replace: "    const scaled = easyFloorPersonal;", what: "личный пол не масштабируется на урезанной неделе" },
  { id: "easy-floor-cohort", file: W, find: "  const easyFloorPersonal = env.easyFloorPersonalMin > 0 ? env.easyFloorPersonalMin : 0;", replace: "  const easyFloorPersonal = env.easyFloorPersonalMin > 0 ? env.easyFloorPersonalMin : 50;", what: "фолбэк на когортный пол сломан" },
  { id: "easy-floor-min", file: W, find: "export const EASY_FLOOR_MIN = 25;", replace: "export const EASY_FLOOR_MIN = 5;", what: "когортный пол 25 → 5" },

  // ── качество ──
  { id: "quality-denom", file: Q, find: "  const weekly = ctx.cycleWeeklyMin ?? (ctx.rolling4wWeeklyMin || 150);", replace: "  const weekly = ctx.rolling4wWeeklyMin || 150;", what: "потолок доли работы снова от исторического факта" },
  { id: "quality-target", file: Q, find: "  if (ctx.targetWorkMinutes != null && ctx.targetWorkMinutes > 0) {", replace: "  if (false && ctx.targetWorkMinutes != null && ctx.targetWorkMinutes > 0) {", what: "цель работы от цикла игнорируется" },

  // ── читатель цикла ──
  { id: "reader-startweek", file: R, find: "    const idx = Math.max(0, weeksBetween(start, weekStart));", replace: "    const idx = 0;", what: "позиция недели всегда первая" },
  { id: "reader-days", file: R, find: "    const days = raw.days ?? fallbackDays?.get(aid) ?? wk.days;", replace: "    const days = wk.days;", what: "дни тренера игнорируются" },
  { id: "reader-manual-base", file: R, find: "  const baseAerobic = r.base_aerobic_min_manual ?? r.base_aerobic_min;", replace: "  const baseAerobic = r.base_aerobic_min;", what: "ручная база игнорируется" },

  // ── ПОД 8 ПОДОЗРИТЕЛЬНЫХ (наряд п.2): что именно у них сломать ──
  // ЛИЧНЫЙ ПОТОЛОК ПРИМЕНЯЕТСЯ В ТРЁХ МЕСТАХ (выдача недели, накопление, гейт aerRoom),
  // и порча ОДНОГО маскируется остальными — по отдельности ни одна не ловится. Ломаем разом:
  // если и это не роняет проверку, значит она бессодержательна.
  { id: "cap-aerobic-off", file: C, find: "draft.peakCapAerobicMin", replace: "Infinity", what: "личный потолок аэробного снят ВЕЗДЕ" },
  { id: "cap-quality-off", file: C, find: "draft.peakCapQualityMin", replace: "Infinity", what: "личный потолок работы снят ВЕЗДЕ" },
  { id: "step-ceil-off", file: C, find: "    const ceilStep = returningFromDeload || prevShownAer <= 0 ? Infinity : prevShownAer * MAX_SINGLE_STEP;", replace: "    const ceilStep = Infinity;", what: "предел одного перехода не применяется вовсе" },
  { id: "deload-return-off", file: C, find: "    preDeloadAer = a; preDeloadQual = q;", replace: "    preDeloadAer = 0; preDeloadQual = 0;", what: "уровень до разгрузки не запоминается — возврат сломан" },
  { id: "target-race-tiebreak", file: C, find: "|| a.r.event_date.localeCompare(b.r.event_date));", replace: "|| b.r.event_date.localeCompare(a.r.event_date));", what: "при равной дистанции берётся более ПОЗДНИЙ старт" },

  // ── ОТРИЦАТЕЛЬНЫЕ ПРОВЕРКИ  // ── ОТРИЦАТЕЛЬНЫЕ ПРОВЕРКИ: ломаем то, чего они запрещают ──
  // Проверки вида «без цикла НЕ должно», «пол НЕ применяется», «роль понижена» утверждают
  // отсутствие поведения. Обычная порча их не задевает — нужна порча, которая это поведение
  // ВКЛЮЧАЕТ. Без таких мутаций они выглядят беззубыми, хотя могут быть в порядке.
  { id: "neg-reactivity", file: W, find: "  const notTraining = hasActiveIllness || env.notRunningWeeks >= NOT_RUNNING_WEEKS;", replace: "  const notTraining = false;", what: "реактивность выключена: сигнал больше не понижает неделю" },
  { id: "neg-role-note", file: W, find: "    notes.push(`цикл: неделя ${cycle.weekIndex} из ${cycle.totalWeeks}, роль «${cycle.role}»`);", replace: "    void cycle.role;", what: "роль недели не пишется в заметки" },
  { id: "neg-nocycle-note", file: W, find: "  const notes: string[] = [];", replace: "  const notes: string[] = [\"цикл: подмешано безусловно\"];", what: "заметка про цикл появляется даже без цикла" },
  { id: "neg-floor-nocycle", file: W, find: "  const longPracticeFloor = cycle && env.longRunPracticeMedianMin > 0 && floorScale > 0", replace: "  const longPracticeFloor = env.longRunPracticeMedianMin > 0 && floorScale >= 0", what: "пол практики применяется и без цикла, и на понижённой неделе" },
  // КОНТРОЛЬ КАТАЛОГА: заведомо безвредная правка. Если её кто-то «поймает» — врут не
  // проверки, а сам харнесс (нестабильный прогон, мусор в разборе вывода).
  { id: "neg-growth-cap", file: C, find: "export const MAX_SINGLE_STEP = 1.22;", replace: "export const MAX_SINGLE_STEP = 1.22;\n// контроль: безвредный комментарий", what: "КОНТРОЛЬ: безвредная правка, замечать нечего" },

  // ── остаток подозрительных: последняя попытка подобрать порчу ──
  { id: "long-fallback-decile", file: P, find: "  return median(desc.slice(0, Math.max(1, Math.ceil(desc.length * LONG_FALLBACK_DECILE))));", replace: "  return median(desc);", what: "запасной детектор берёт медиану ВСЕХ, а не верхней децили" },
  { id: "keep-grow-anyway", file: W, find: "  const floorBase = cycle && distTarget && distStep && cycle.hasTargetRace", replace: "  const floorBase = cycle && (distTarget ?? 180) && (distStep ?? 1.116) && (cycle.hasTargetRace || true)", what: "рост длительной включается и на поддержании без старта" },
  { id: "nocycle-uses-cycle-cap", file: W, find: "    weekly = Math.min(env.rolling4wPlannedMin || 0, env.capWeeklyMin ?? Infinity) || 150;", replace: "    weekly = 250;", what: "без цикла потолок берётся не из конверта" },
  { id: "downgraded-over-cap", file: W, find: "  const easyVariants = [easyBase, Math.max(EASY_FLOOR, easyBase - ROUND_TO_MIN)]; // лёгкие не одинаковые", replace: "  const easyVariants = [easyBase + 40, Math.max(EASY_FLOOR, easyBase + 35)]; // мутация: неделя раздута сверх потолка", what: "собранная неделя раздувается сверх потолка" },

  // ── контекст ──
  // Переехали в practice-signals вместе с логикой. Харнесс честно сообщал «ЯКОРЬ НЕ НАЙДЕН»,
  // пока я их не перенацелил, — это и есть его польза: молча зелёными они не стали.
  { id: "ctx-warmup", file: P, find: "  if (WARMUP_TITLE_RE.test(title)) return false;", replace: "  void WARMUP_TITLE_RE;", what: "разминки попадают в личный пол" },
  { id: "ctx-min-runs", file: P, find: "  if (samples.length < MIN_RUNS_FOR_PERSONAL_FLOOR) return 0;", replace: "  if (samples.length < 0) return 0;", what: "порог достаточности данных снят" },
  { id: "ps-p10-to-min", file: P, find: "  return s[Math.floor(LONG_FALLBACK_DECILE * (s.length - 1))];", replace: "  return s[0];", what: "личный пол берётся как min вместо p10" },
  { id: "ps-racepace", file: P, find: "  if (RACE_PACE_BLOCK_RE.test(title)) return false;", replace: "  void RACE_PACE_BLOCK_RE;", what: "марафонские блоки идут в детектор длительных" },
  { id: "ps-tempo-quality", file: P, find: "  if (AEROBIC_DESPITE_QUALITY_RE.test(title)) return false;", replace: "  void AEROBIC_DESPITE_QUALITY_RE;", what: "«темп выше» снова считается качественной" },
  { id: "ps-fallback-always", file: P, find: "  if (titledSamples.length > 0) {", replace: "  if (false) {", what: "запасной детектор вытесняет заголовки" },

  // ── ВТОРАЯ КАЧЕСТВЕННАЯ И ТЕМПОВЫЙ (наряд 12.08) ──
  { id: "roles-day-gate", file: W, find: "  return { quality: Math.max(0, Math.min(cap, want, n - 1)), long: 1 };", replace: "  void want;\n  if (n <= 5) return { quality: Math.min(cap, 1), long: 1 };\n  return { quality: Math.min(cap, 2), long: 1 };", what: "вернулся порог «две качественные только с шести дней»" },
  { id: "roles-want-ignored", file: W, find: "Math.max(0, Math.min(cap, want, n - 1))", replace: "Math.max(0, Math.min(cap, 1, n - 1))", what: "просьба практики игнорируется, всегда одна" },
  // ПОТОЛОК ГЕЙТА ПРИМЕНЯЕТСЯ ДВАЖДЫ (в qualityCountWanted и в rolesForDayCount), поэтому
  // порча одного места маскируется вторым — как это уже было с личными потолками. Ломаем оба.
  { id: "gate-cap-off", file: W, find: "Math.max(0, Math.min(cap, want, n - 1))", replace: "Math.max(0, Math.min(want, n - 1))", what: "гейт по истории 8 недель не ограничивает число качественных" },
  // День длительной при двух беговых днях защищает ГЕЙТ ОТБОРА «меньше трёх дней», а не
  // арифметика скелета: она срабатывает позже и потому мутацией не изолируется (см. коммент
  // у rolesForDayCount). Ломаем то, что реально держит.
  { id: "quality-min-days-off", file: Q, find: "  if (ctx.plannedRunCount < 3) {", replace: "  if (ctx.plannedRunCount < 0) {", what: "качество назначается и при двух беговых днях — длительная теряет день" },
  { id: "want-no-floor", file: P, find: "  return Math.max(1, lastWeekQualityCount);", replace: "  return lastWeekQualityCount;", what: "пустая прошлая неделя обнуляет качество" },
  { id: "want-always-two", file: P, find: "  return Math.max(1, lastWeekQualityCount);", replace: "  void lastWeekQualityCount; return 2;", what: "две качественные назначаются всем подряд" },
  { id: "slot-types-off", file: W, find: "  if (!hasIntervals && !hasTempo) return Array.from({ length: count }, () => null);", replace: "  return Array.from({ length: count }, () => null);", what: "тип сессии не выбирается — обе качественные одинаковые" },
  { id: "slot-order-swapped", file: W, find: "  return Array.from({ length: count }, (_, i) => (i === 0 ? first : second));", replace: "  return Array.from({ length: count }, (_, i) => (i === 0 ? second : first));", what: "темповый идёт первым, отрезки вторыми" },
  { id: "slot-tempo-forced", file: W, find: "  const second: \"intervals\" | \"tempo\" = hasTempo ? \"tempo\" : \"intervals\";", replace: "  const second: \"intervals\" | \"tempo\" = \"tempo\";", what: "темповый навязывается тем, у кого его нет в практике" },
  { id: "slot-narrow-off", file: Q, find: "  if (ctx.slotType) {", replace: "  if (false && ctx.slotType) {", what: "пул не сужается по типу — вторая копирует первую" },
  { id: "work-share-no-split", file: Q, find: "  const workCeil = Math.max(12, weekly * WORK_SHARE_OF_WEEKLY_MAX / slots);", replace: "  const workCeil = Math.max(12, weekly * WORK_SHARE_OF_WEEKLY_MAX);", what: "потолок доли работы не делится между сессиями (две по 20% = 40%)" },
  { id: "cycle-work-no-split", file: W, find: "        targetWorkMinutes: cycle ? Math.round(cycle.qualityMin / Math.max(1, counts.quality)) : null,", replace: "        targetWorkMinutes: cycle ? cycle.qualityMin : null,", what: "цель цикла по работе не делится — каждая сессия целится в недельное число" },
  { id: "tempo-ladder-empty", file: LIBCAT, find: "  if (!(hi >= lo && lo > 0)) return [];", replace: "  if (true) return [];", what: "лестница темпового пуста — темповый не участвует в отборе" },
  { id: "tempo-ladder-fixed", file: LIBCAT, find: "  const lo = p.advisoryMinMinutes ?? TEMPO_ADVISORY_FALLBACK.min;\n  const hi = p.advisoryMaxMinutes ?? TEMPO_ADVISORY_FALLBACK.max;", replace: "  const lo = 30; const hi = 30; void p;", what: "лестница темпового не берёт диапазон из каталога" },
  { id: "tempo-intent-threshold", file: W, find: "  const isTempo = p.intensityIntent === \"steady_tempo\";", replace: "  const isTempo = false && p.intensityIntent === \"steady_tempo\";", what: "темповый считается пороговым: полоса на пороге и метки «Отрезок»" },
  { id: "practice-tempo-blind", file: P, find: "  return qualityRe.test(title) || TEMPO_TITLE_RE.test(title);", replace: "  return qualityRe.test(title);", what: "классификатор снова не видит темповый" },
  { id: "practice-tempo-mode", file: P, find: "export const TEMPO_TITLE_RE = /(темпов[а-яё]*\\s+бег|^\\s*[0-9]{1,3}\\s*(?:мин|минут|км)\\s+темп|порогов[а-яё]*)/i;", replace: "export const TEMPO_TITLE_RE = /темп/i;", what: "«Бег по темпу» (режим контроля) считается качественной работой" },
  { id: "volume-tempo-blind", file: V, find: "  if (tempoLike) {", replace: "  if (false) {", what: "минуты работы темпового не читаются — база качества цикла занижена" },
  { id: "volume-tempo-mode", file: V, find: "const TEMPO_TITLE_RE = /(темпов[а-яё]*\\s+бег|^\\s*[0-9]{1,3}\\s*(?:мин|минут|км)\\s+темп|порогов[а-яё]*)/i;", replace: "const TEMPO_TITLE_RE = /темп/i;", what: "«Бег по темпу» разбирается как работа в объёме цикла" },
  { id: "volume-tempo-whole", file: V, find: "    if (w > 0 && w <= 90) return clamp(w, \"tempo_continuous\", false);", replace: "    return clamp(total, \"tempo_continuous\", false);", what: "у темпового вся сессия считается работой, включая разминку" },
];

function run(): { failed: string[]; crashed: boolean } {
  try {
    execFileSync("npx", ["tsx", path.join(toolRoot, "scripts", "tp-cycle-forecast-check.ts")],
      { cwd: path.resolve(toolRoot, "..", ".."), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { failed: [], crashed: false };
  } catch (e: unknown) {
    const out = String((e as { stdout?: string }).stdout ?? "") + String((e as { stderr?: string }).stderr ?? "");
    const failed = [...out.matchAll(/^ {2}ПАДЕНИЕ (.+)$/gm)].map((m) => m[1].trim());
    // упало, но ни одной строки ПАДЕНИЕ — значит скрипт рухнул (тайпчек, исключение)
    return { failed, crashed: failed.length === 0 };
  }
}

function main(): void {
  const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7) ?? null;
  const list = only ? MUTATIONS.filter((m) => m.id.includes(only) || m.what.includes(only)) : MUTATIONS;

  const base = run();
  if (base.failed.length > 0 || base.crashed) {
    console.error(`[мутации] БАЗА НЕ ЗЕЛЁНАЯ — сначала почини: ${base.crashed ? "скрипт падает" : base.failed.join(", ")}`);
    process.exit(1);
  }
  const allChecks = allCheckNames();
  console.log(`[мутации] проверок ${allChecks.length}, мутаций ${list.length}\n`);

  const killedBy = new Map<string, string[]>();
  for (const c of allChecks) killedBy.set(c, []);
  const useless: Mutation[] = [];

  for (const m of list) {
    const before = readFileSync(m.file, "utf8");
    if (!before.includes(m.find)) {
      console.log(`  ⚠ ${m.id.padEnd(22)} ЯКОРЬ НЕ НАЙДЕН — мутация не применена`);
      continue;
    }
    try {
      // replaceAll: часть мутаций (снятие потолка) должна задеть ВСЕ места применения,
      // иначе оставшиеся копии маскируют порчу и проверка выглядит беззубой ложно.
      writeFileSync(m.file, before.split(m.find).join(m.replace));
      const res = run();
      if (res.crashed) console.log(`  ␥ ${m.id.padEnd(22)} код не компилируется/падает — как сигнал не считается`);
      else if (res.failed.length === 0) { useless.push(m); console.log(`  ✗ ${m.id.padEnd(22)} НИКТО НЕ ЗАМЕТИЛ · ${m.what}`); }
      else {
        console.log(`  ✓ ${m.id.padEnd(22)} уронила ${res.failed.length} · ${m.what}`);
        for (const f of res.failed) killedBy.get(f)?.push(m.id);
      }
    } finally {
      writeFileSync(m.file, before);
    }
  }

  console.log(`\n${"=".repeat(96)}\nПРОВЕРКА → КАКИЕ МУТАЦИИ ЕЁ РОНЯЮТ\n${"=".repeat(96)}`);
  const naked: string[] = [];
  for (const c of allChecks) {
    const by = killedBy.get(c) ?? [];
    if (by.length === 0) naked.push(c);
    console.log(`  ${by.length > 0 ? "✓" : "✗"} ${c}`);
    if (by.length > 0) console.log(`       роняют: ${by.join(", ")}`);
  }
  console.log(`\nПОДОЗРИТЕЛЬНЫХ (не упали ни на одной мутации): ${naked.length} из ${allChecks.length}`);
  for (const c of naked) console.log(`  ✗ ${c}`);
  if (useless.length) {
    console.log(`\nМУТАЦИИ, КОТОРЫХ НИКТО НЕ ЗАМЕТИЛ: ${useless.length}`);
    for (const m of useless) console.log(`  ${m.id} — ${m.what}`);
  }
}

function allCheckNames(): string[] {
  const out = execFileSync("npx", ["tsx", path.join(toolRoot, "scripts", "tp-cycle-forecast-check.ts")],
    { cwd: path.resolve(toolRoot, "..", ".."), encoding: "utf8" });
  return [...out.matchAll(/^ {2}ok {4}(.+)$/gm)].map((m) => m[1].trim());
}

main();
