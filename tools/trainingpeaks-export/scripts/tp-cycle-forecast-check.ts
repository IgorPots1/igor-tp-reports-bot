/**
 * tp-cycle-forecast-check — проверки НА САМИ ЧИСЛА прогноза цикла. READ-ONLY.
 *
 * ЗАЧЕМ. Правка «возврат после плановой разгрузки» в наряде 11.08 молча НЕ ПРИМЕНИЛАСЬ:
 * скриптовая замена не нашла место в уже изменённом файле, тайпчек и линт этого не видят
 * (код остался синтаксически верным, просто старым), и поймала ошибку только сверка
 * одного числа в прогнозе глазами. Перед подключением цикла к сборщику так нельзя.
 *
 * Эти проверки падают, если правка не применилась. Они смотрят не на типы, а на числа:
 *   1. возврат после плановой разгрузки равен уровню последней недели роста;
 *   2. плановая разгрузка режет ровно на заявленные доли от ПОКАЗАННОЙ прошлой недели;
 *   3. отклонение доли качества от личной обычной не выше MAX_SHARE_DEVIATION_PP;
 *   4. подводка не глубже своего профиля и считается от пика (или от базы, если пика нет);
 *   5. ни одна неделя роста не превышает предел одного перехода;
 *   6. ни одна неделя не выходит за личные потолки.
 *
 * ЧЕГО ЭТИ ПРОВЕРКИ НЕ ЛОВЯТ (проверено мутациями): изменение самих КОНСТАНТ. Проверка №2
 * читает deload_quality_factor из того же модуля, что и проверяемый код, поэтому смена
 * 0.80 на 0.70 её не роняет — она сверяет ФОРМУЛУ (режем от показанной недели на заданную
 * долю), а не ЗНАЧЕНИЕ. Это сознательно: значения — параметры тренера, и прибивать их
 * в тесте значило бы ронять его на каждой настройке. Значения сверяются глазами по отчёту.
 *
 * Прогоняется на СИНТЕТИЧЕСКИХ черновиках — без БД, чтобы проверка не зависела от того,
 * что сегодня в данных, и падала именно на логике.
 *
 * Запуск: npx tsx tools/trainingpeaks-export/scripts/tp-cycle-forecast-check.ts
 */
import process from "node:process";

import { buildWeek, LONG_CEIL, type CycleWeekTarget } from "./lib/autoplanner-week.ts";
import { stubAnchors, stubCatalog, stubEnvelope } from "./lib/cycle-check-stubs.ts";
import { loadActiveCycles } from "./lib/cycle-reader.ts";
import {
  DELOAD_AEROBIC_FACTOR, DELOAD_EVERY_N, DELOAD_QUALITY_FACTOR, MAX_SHARE_DEVIATION_PP,
  MAX_SINGLE_STEP, STEP_AEROBIC, STEP_QUALITY, TAPER_PROFILE, TAPER_NO_PEAK_FACTOR,
  forecast, type CycleDraft, type CycleIntent,
} from "./lib/training-cycle.ts";

let failures = 0;
function check(name: string, ok: boolean, detail: string): void {
  if (ok) { console.log(`  ok    ${name}`); return; }
  failures++;
  console.log(`  ПАДЕНИЕ ${name}\n          ${detail}`);
}

function draft(over: Partial<CycleDraft> = {}): CycleDraft {
  const baseAerobicMin = over.baseAerobicMin ?? 300;
  const baseQualityMin = over.baseQualityMin ?? 30;
  return {
    athleteId: 1, intent: "marathon" as CycleIntent, targetRaceId: null, targetDate: null,
    lengthWeeks: 12, baseAerobicMin, baseQualityMin,
    stepAerobic: STEP_AEROBIC, stepQuality: STEP_QUALITY,
    deloadEveryN: DELOAD_EVERY_N, deloadDepthAerobic: DELOAD_AEROBIC_FACTOR,
    deloadQualityFactor: DELOAD_QUALITY_FACTOR,
    taperProfile: TAPER_PROFILE.marathon, days: 5,
    peakCapAerobicMin: 400, historicMaxAerobicMin: 380,
    peakCapQualityMin: 60, historicMaxQualityMin: 70, aerobicIfFromMax: 418,
    base8Aerobic: baseAerobicMin, base8Quality: baseQualityMin, illWeeks: 0,
    halfLifeDays: 42, base42Aerobic: baseAerobicMin, slopeMinPerWeek: 0,
    baseAerobicManual: null, baseQualityManual: null, baseManualReason: null,
    baseAerobicComputed: baseAerobicMin, baseQualityComputed: baseQualityMin,
    ownSharePct: 100 * baseQualityMin / (baseAerobicMin + baseQualityMin),
    gaps: [],
    ...over,
  };
}

const MON = "2026-09-07";
const shareOf = (a: number, q: number): number => (a + q > 0 ? 100 * q / (a + q) : 0);

async function main(): Promise<void> {
  console.log("ПРОВЕРКИ ЧИСЕЛ ПРОГНОЗА ЦИКЛА\n");

  // ── 1. возврат после плановой разгрузки ──
  {
    const d = draft();
    const w = forecast(d, MON, 10);
    const di = w.findIndex((x) => x.role === "плановая разгрузка");
    const lastGrowthBefore = [...w.slice(0, di)].reverse().find((x) => x.role === "рост");
    const afterDeload = w.slice(di + 1).find((x) => x.role === "рост");
    // РОВНО равен, а не «не меньше»: слабая формулировка проходила и на сломанном коде.
    // Возврат ×1.25 от разгрузки заведомо выше предела перехода ×1.22, поэтому без
    // освобождения от предела число обязано отличаться — на этом проверка и держится.
    check("возврат после разгрузки = уровню последней недели роста",
      di > 0 && !!lastGrowthBefore && !!afterDeload && afterDeload.aerobicMin === lastGrowthBefore.aerobicMin,
      `до разгрузки ${lastGrowthBefore?.aerobicMin}, после ${afterDeload?.aerobicMin} — должны совпадать`);
  }

  // ── 2. разгрузка режет ровно на заявленные доли от ПОКАЗАННОЙ прошлой недели ──
  {
    const d = draft();
    const w = forecast(d, MON, 10);
    const di = w.findIndex((x) => x.role === "плановая разгрузка");
    const prev = w[di - 1], dl = w[di];
    const wantA = Math.round(prev.aerobicMin * d.deloadDepthAerobic / 5) * 5;
    check(`разгрузка аэробного = ×${d.deloadDepthAerobic} от показанной прошлой недели`,
      dl.aerobicMin === wantA, `прошлая ${prev.aerobicMin}, разгрузка ${dl.aerobicMin}, ожидалось ${wantA}`);
    // работа может быть дополнительно прижата зажимом доли — проверяем «не больше»
    const wantQ = Math.round(prev.qualityMin * d.deloadQualityFactor / 5) * 5;
    check(`разгрузка работы не выше ×${d.deloadQualityFactor} от показанной прошлой недели`,
      dl.qualityMin <= wantQ, `прошлая ${prev.qualityMin}, разгрузка ${dl.qualityMin}, потолок ${wantQ}`);
  }

  // ── 3. отклонение доли ──
  {
    const cases: Array<[string, CycleDraft]> = [
      ["марафон", draft({ targetDate: "2026-11-30" })],
      ["полумарафон", draft({ intent: "half", taperProfile: TAPER_PROFILE.half, targetDate: "2026-11-02" })],
      ["высокая доля", draft({ baseAerobicMin: 200, baseQualityMin: 40, targetDate: "2026-11-30" })],
      ["низкая доля", draft({ baseAerobicMin: 400, baseQualityMin: 20, targetDate: "2026-11-30" })],
    ];
    for (const [name, d] of cases) {
      const w = forecast(d, MON, 14).filter((x) => x.role !== "старт");
      const worst = w.reduce((acc, x) => Math.max(acc, Math.abs(shareOf(x.aerobicMin, x.qualityMin) - d.ownSharePct)), 0);
      check(`отклонение доли ≤ ${MAX_SHARE_DEVIATION_PP} п.п. (${name})`,
        worst <= MAX_SHARE_DEVIATION_PP + 0.001, `максимум ${worst.toFixed(2)} п.п. при своей ${d.ownSharePct.toFixed(1)}%`);
    }
  }

  // ── 4. подводка не глубже профиля ──
  {
    const d = draft({ targetDate: "2026-11-30" });
    const w = forecast(d, MON, 14);
    // Пик берётся по неделям роста ДО начала подводки. Первая версия считала его по всем
    // неделям роста в выдаче, включая недели ПОСЛЕ старта (forecast продолжает ряд, если
    // попросить больше недель, чем до забега), и ждала 200 вместо верных 190.
    const firstTaper = w.findIndex((x) => x.role === "подводка");
    const peak = Math.max(...w.slice(0, firstTaper < 0 ? w.length : firstTaper)
      .filter((x) => x.role === "рост").map((x) => x.aerobicMin), 0);
    let ok = true, detail = "";
    for (const x of w.filter((y) => y.role === "подводка")) {
      const wo = Math.round((Date.parse(d.targetDate!) - Date.parse(x.weekStart)) / (7 * 86400000));
      const tw = d.taperProfile.find((t) => t.weeksOut === wo);
      if (!tw) continue;
      const want = Math.round(peak * tw.aerobicFactor / 5) * 5;
      if (x.aerobicMin !== want) { ok = false; detail = `за ${wo} нед: ${x.aerobicMin}, ожидалось ${want} (пик ${peak} × ${tw.aerobicFactor})`; }
    }
    check("подводка = профиль × пик", ok, detail);
  }
  {
    // Подводка без пика: символические −10%, а не полный профиль.
    // Старт РОВНО через неделю — тогда первая же неделя цикла подводочная и роста не было.
    // (При старте через две недели первая неделя ростовая, пик появляется, и это уже
    // обычная подводка по профилю — первая версия теста ошибалась именно здесь.)
    const d = draft({ intent: "10k", taperProfile: TAPER_PROFILE["10k"], targetDate: "2026-09-14" });
    const w = forecast(d, MON, 2);
    const t = w.find((x) => x.role === "подводка");
    const want = Math.round(d.baseAerobicMin * TAPER_NO_PEAK_FACTOR / 5) * 5;
    check("подводка без пика = символические −10% от базы",
      !!t && t.aerobicMin === want, `получили ${t?.aerobicMin}, ожидалось ${want}`);
  }

  // ── 5. предел одного перехода (кроме возврата после разгрузки) ──
  {
    const d = draft();
    const w = forecast(d, MON, 10);
    let ok = true, detail = "";
    for (let i = 1; i < w.length; i++) {
      const prev = w[i - 1], cur = w[i];
      if (cur.role !== "рост" || prev.aerobicMin <= 0) continue;
      if (prev.role === "плановая разгрузка") continue; // возврат разрешён без предела
      const ratio = cur.aerobicMin / prev.aerobicMin;
      if (ratio > MAX_SINGLE_STEP + 0.001) { ok = false; detail = `${prev.aerobicMin} -> ${cur.aerobicMin} = ×${ratio.toFixed(3)}`; }
    }
    check(`ни один переход роста не выше ×${MAX_SINGLE_STEP}`, ok, detail);
  }

  // ── 6. личные потолки ──
  {
    const d = draft({ targetDate: "2026-11-30" });
    const w = forecast(d, MON, 14);
    const overA = w.find((x) => x.aerobicMin > d.peakCapAerobicMin);
    const overQ = w.find((x) => x.qualityMin > d.peakCapQualityMin);
    check("аэробный не выше личного потолка", !overA, `неделя ${overA?.index}: ${overA?.aerobicMin} > ${d.peakCapAerobicMin}`);
    check("работа не выше личного потолка", !overQ, `неделя ${overQ?.index}: ${overQ?.qualityMin} > ${d.peakCapQualityMin}`);
  }

  // ── 7. ПОДКЛЮЧЕНИЕ ЦИКЛА К СБОРЩИКУ ──
  // Проверки на синтетическом сборщике: цель по дням доходит, роль пишется в заметки,
  // при активном сигнале роль понижается, а без цикла ничего не меняется.
  {
    const anchors = stubAnchors();
    const env = stubEnvelope();
    const cat = stubCatalog();
    const target: CycleWeekTarget = { weekIndex: 2, totalWeeks: 10, role: "рост", aerobicMin: 220, qualityMin: 30, days: 4 };

    const wCycle = buildWeek(anchors, env, cat, MON, false, null, target);
    check("цикл: число дней ровно как просил цикл",
      wCycle.sessions.length === target.days, `просил ${target.days}, собрано ${wCycle.sessions.length}`);

    // ── ДВЕ РАЗНЫЕ ПРОВЕРКИ, А НЕ ОДНА ──
    // Прежняя «попадание в ±10%» не различала недели с ПЛАНОВОЙ ролью и недели, где роль
    // ПОНИЖЕНА реактивностью. На живых данных трое из двенадцати роняли бы её ложно: они
    // недобирают 13-28% ПОТОМУ ЧТО так и задумано. Проверка, падающая не там, где надо,
    // хуже отсутствующей — поэтому случаи разделены.
    const downgraded = (w: { notes: string[] }): boolean => w.notes.some((n) => n.includes("РОЛЬ НЕДЕЛИ ПОНИЖЕНА"));

    check("цикл, ПЛАНОВАЯ роль: попадание в целевой объём ±10%",
      !downgraded(wCycle) && wCycle.plannedMinutes > 0
        && Math.abs(wCycle.plannedMinutes / (target.aerobicMin + target.qualityMin) - 1) <= 0.10,
      `роль плановая: ${!downgraded(wCycle)}, цель ${target.aerobicMin + target.qualityMin}, собрано ${wCycle.plannedMinutes}`);
    check("цикл: роль недели попала в заметки",
      wCycle.notes.some((n) => n.includes(`неделя ${target.weekIndex} из ${target.totalWeeks}`)),
      `заметки: ${wCycle.notes.join(" | ")}`);
    check("цикл: конверт истории НЕ ограничивает — потолок равен цели цикла",
      wCycle.weeklyCap === target.aerobicMin + target.qualityMin,
      `потолок ${wCycle.weeklyCap}, цель ${target.aerobicMin + target.qualityMin}`);

    // ── КОНВЕРТ НЕ ВОЗВРАЩАЕТСЯ В ДОБОР ──
    // Проверка выше сторожит только ПОТОЛОК недели, и её было мало: конверт возвращался
    // в шаге (4) через targetWeekly = min(потолок, rolling4wPlannedMin), а потолок при этом
    // оставался правильным. Замер 11.08: эта течь стоила 93 минуты из 129 у 8 атлетов из 12.
    //
    // ЗАГЛУШКА ПОДОБРАНА ТАК, ЧТОБЫ ДОБОР БЫЛ СВЯЗЫВАЮЩИМ ШАГОМ, иначе проверка беззубая.
    // На обычной заглушке течь не ловится вообще: потолки сессий (capLong = недельный × 0.35
    // при пустом baseline) упираются раньше конверта, шаги формы (1)-(3) добирают всё сами,
    // и добор не запускается — проверено мутацией, старая формула проходила её насквозь.
    // Поэтому здесь просторный capLongRunMin (140) и пять дней: место для роста есть,
    // и единственное, что может остановить добор, — вернувшийся конверт.
    // ДОПУСК 3%, А НЕ 10%: разница между течью и починкой на этой заглушке 15 минут
    // (318 против 333 при цели 340), и десятипроцентный допуск накрывает обе.
    const envLowPlan = { ...env, rolling4wPlannedMin: 200, capLongRunMin: 140 };
    const bigTarget: CycleWeekTarget = { weekIndex: 2, totalWeeks: 10, role: "рост", aerobicMin: 300, qualityMin: 40, days: 5 };
    const wBig = buildWeek(anchors, envLowPlan, cat, MON, false, null, bigTarget);
    const bigWant = bigTarget.aerobicMin + bigTarget.qualityMin;
    check("цикл: конверт истории НЕ участвует в ДОБОРЕ объёма (допуск 3%)",
      wBig.plannedMinutes > envLowPlan.rolling4wPlannedMin
        && Math.abs(wBig.plannedMinutes / bigWant - 1) <= 0.03,
      `конверт ${envLowPlan.rolling4wPlannedMin}, цель цикла ${bigWant}, собрано ${wBig.plannedMinutes}`
      + ` (${Math.round(1000 * (wBig.plannedMinutes / bigWant - 1)) / 10}%)`);

    // при активном health-сигнале роль понижается, объём считается от факта
    const wIll = buildWeek(anchors, env, cat, MON, true, null, target);
    check("реактивность: при активном сигнале роль понижена",
      downgraded(wIll), `заметки: ${wIll.notes.join(" | ")}`);

    // Понижённую неделю проверяем НА ПРАВИЛО ПОНИЖЕНИЯ, а не на цель цикла.
    // Правило: потолок берётся ОТ ФАКТА (rolling4w фактических минут, подрезанный
    // пределом перехода от факта прошлой недели) и цели цикла НЕ равен.
    const factCeil = Math.min(
      Math.min(env.rolling4wWeeklyMin || 0, env.capWeeklyMin ?? Infinity) || 30,
      env.lastWeekMinutes > 0 ? Math.round(env.lastWeekMinutes * MAX_SINGLE_STEP) : Infinity,
    );
    check("цикл, ПОНИЖЕННАЯ роль: объём считается от ФАКТА, а не от цели цикла",
      wIll.weeklyCap === factCeil && wIll.weeklyCap !== target.aerobicMin + target.qualityMin,
      `потолок ${wIll.weeklyCap}, ожидался от факта ${factCeil}, цель цикла ${target.aerobicMin + target.qualityMin}`);
    check("цикл, ПОНИЖЕННАЯ роль: собранное не превышает потолок от факта",
      wIll.refused != null || wIll.plannedMinutes <= wIll.weeklyCap,
      `собрано ${wIll.plannedMinutes}, потолок ${wIll.weeklyCap}`);

    // ── ПОТОЛОК ДЛИТЕЛЬНОЙ: ТРИ ПРИЧИНЫ ЗАНИЖЕНИЯ, ТРИ ПРОВЕРКИ ──
    // Замер 11.08: у 7 атлетов из 12 длительная короче той, что тренер ставит сам, у двоих
    // её не выдавалось вовсе. Каждая проверка сторожит СВОЮ причину и падает, если правка снята.
    const longestOf = (w: { sessions: Array<{ role: string; minutes: number }> }): number =>
      w.sessions.filter((s) => s.role === "long").reduce((m, s) => Math.max(m, s.minutes), 0);

    // (а) жёсткий предел: был 180, стал 200. Контрольная длительная тренера — 182 мин.
    const wCeil = buildWeek(anchors, { ...env, capLongRunMin: null, longRunPracticeMaxMin: 200 }, cat, MON, false, null,
      { weekIndex: 2, totalWeeks: 10, role: "рост", aerobicMin: 420, qualityMin: 40, days: 3 });
    check(`длительная может превысить прежний предел 180 (потолок ${LONG_CEIL})`,
      longestOf(wCeil) > 180, `длительная ${longestOf(wCeil)} мин при практике 200 и цели 460`);

    // (б) baseline = 0 — дыра в данных, а не решение тренера: нуль не должен работать потолком.
    // Прежде `capLongRunMin ?? …` пропускал нуль (?? ловит только null), min(0, …) = 0,
    // clamp поднимал до пола 30 — и сессия переставала быть длиннее обычной лёгкой (45 мин),
    // после чего переименовывалась в лёгкую, то есть длительной не выдавалось ВООБЩЕ.
    //
    // БЕЗ ЦИКЛА, И ЭТО СУЩЕСТВЕННО. При активном цикле практика берётся первой в любом случае,
    // поэтому нуль там не проявляется и проверка была бы беззубой — первая версия этой проверки
    // шла с циклом и мутацию `capLongRunMin ?? null` проходила насквозь. Ветка с нулём живёт
    // ровно на бесцикловом пути, там её и сторожим.
    const wZero = buildWeek(anchors, { ...env, capLongRunMin: 0, longRunPracticeMaxMin: 90 }, cat, MON, false, null);
    check("нулевой baseline длительной не работает потолком — берётся практика (без цикла)",
      longestOf(wZero) >= 80, `длительная ${longestOf(wZero)} мин при baseline 0 и практике 90`);

    // (в) при активном цикле практика главнее ЗАМОРОЖЕННОГО baseline (окно 11.03-03.06);
    //     без цикла baseline остаётся главным — прежнее поведение не тронуто.
    const envFrozen = { ...env, capLongRunMin: 65, longRunPracticeMaxMin: 120 };
    const cycTarget: CycleWeekTarget = { weekIndex: 2, totalWeeks: 10, role: "рост", aerobicMin: 250, qualityMin: 30, days: 4 };
    const wFrozenCyc = buildWeek(anchors, envFrozen, cat, MON, false, null, cycTarget);
    const wFrozenNo = buildWeek(anchors, envFrozen, cat, MON, false, null);
    check("цикл: потолок длительной из ПРАКТИКИ, а не из замороженного baseline",
      longestOf(wFrozenCyc) > 65, `с циклом ${longestOf(wFrozenCyc)} мин при baseline 65 и практике 120`);
    check("без цикла: потолок длительной по-прежнему из baseline",
      longestOf(wFrozenNo) > 0 && longestOf(wFrozenNo) <= 65,
      `без цикла ${longestOf(wFrozenNo)} мин при baseline 65 и практике 120`);

    // (г) МЕДИАНА ПРАКТИКИ — ПОЛ ЦЕЛИ, А НЕ ЖЕРТВА ОГРАНИЧИТЕЛЕЙ.
    // Доля недели x0.45 и пропорция длительная/лёгкий — оба числа выведены из практики,
    // но стояли ОГРАНИЧИТЕЛЯМИ и не давали достать медиану. Здесь доля заведомо ниже
    // медианы: недельный объём 180 даёт 0.45 x 180 = 81 при медиане 90. Если доля снова
    // станет рабочим пределом, длительная упадёт на 80 и проверка сядет.
    const envMed = { ...env, capLongRunMin: 0, longRunPracticeMaxMin: 90, longRunPracticeMedianMin: 90 };
    const wMed = buildWeek(anchors, envMed, cat, MON, false, null,
      { weekIndex: 2, totalWeeks: 10, role: "рост", aerobicMin: 155, qualityMin: 25, days: 3 });
    check("цикл: длительная не короче МЕДИАНЫ практики, доля недели не мешает",
      longestOf(wMed) >= 90, `длительная ${longestOf(wMed)} мин при медиане практики 90 и доле 0.45 x 180 = 81`);

    // (д) РЕАКТИВНОСТЬ ГЛАВНЕЕ: на понижённой сигналом неделе пола практики НЕТ.
    // Иначе длительная прыгала бы к медиане ровно тогда, когда человека надо разгрузить.
    const wMedIll = buildWeek(anchors, envMed, cat, MON, true, null,
      { weekIndex: 2, totalWeeks: 10, role: "рост", aerobicMin: 155, qualityMin: 25, days: 3 });
    check("понижённая неделя: пол практики НЕ применяется",
      wMedIll.refused != null || longestOf(wMedIll) < 90,
      `длительная ${longestOf(wMedIll)} мин на неделе с активным сигналом (медиана практики 90)`);

    // (е) ПОТОЛОК ДОЛИ РАБОТЫ СЧИТАЕТСЯ ОТ НЕДЕЛИ ЦИКЛА, А НЕ ОТ ИСТОРИЧЕСКОГО ФАКТА.
    // Заглушка: исторический факт 60 мин/нед (потолок работы 12), цикл просит 300 мин
    // (потолок работы 60). Если знаменателем снова станет история, отбор упрётся в 12 мин
    // и не сможет взять формат под цель цикла 40 мин.
    const envTinyHist = { ...env, rolling4wWeeklyMin: 60, capLongRunMin: 140 };
    const wShare = buildWeek(anchors, envTinyHist, cat, MON, false, null,
      { weekIndex: 2, totalWeeks: 10, role: "рост", aerobicMin: 260, qualityMin: 40, days: 5 });
    // Проверяем ВЫБРАННЫЙ ФОРМАТ, а не факт решения: при старом знаменателе потолок работы
    // выходит 12 мин, ни один формат в него не влезает, пул схлопывается до самого лёгкого
    // (20 мин работы) — но текст решения при этом остаётся тем же «цель цикла … взят
    // ближайший формат». Первая версия этой проверки смотрела на текст и мутацию пропускала.
    check("цикл: потолок доли работы от недели ЦИКЛА, а не от исторического факта",
      wShare.refused == null && wShare.qualityDecision.includes("(40 мин)"),
      `история 60 мин/нед, цель цикла 300, ждали формат на 40 мин работы; решение: ${wShare.qualityDecision}`);

    // без цикла поведение прежнее: потолок берётся из конверта, а не из цели
    const wNo = buildWeek(anchors, env, cat, MON, false, null);
    check("без цикла: потолок из конверта, а не из цели цикла",
      wNo.weeklyCap !== target.aerobicMin + target.qualityMin && wNo.weeklyCap > 0,
      `потолок ${wNo.weeklyCap}`);
    check("без цикла: в заметках нет упоминания цикла",
      !wNo.notes.some((n) => n.startsWith("цикл")), `заметки: ${wNo.notes.join(" | ")}`);
  }

  // ── 8. ЧИТАТЕЛЬ ЦИКЛА: СТРОКА В ТАБЛИЦЕ РЕАЛЬНО МЕНЯЕТ НЕДЕЛЮ ──
  // Без БД: подставляем поддельный клиент, отдающий одну строку training_cycles.
  // Смысл проверки — не «читатель что-то вернул», а «неделя собралась ПО ЦИФРАМ ТРЕНЕРА».
  // Поэтому база в строке заведомо не равна ничему, что можно вывести из заглушки истории.
  {
    const row = {
      id: "11111111-1111-1111-1111-111111111111",
      trainingpeaks_athlete_id: 1,
      intent: "half", target_date: null, target_race_id: null, status: "active",
      length_weeks: 8, base_aerobic_min: 260, base_quality_min: 30,
      base_aerobic_min_manual: null, base_quality_min_manual: null, base_manual_reason: null,
      step_aerobic: 1.06, step_quality: 1.06, peak_aerobic_min: null,
      deload_every_n: 4, deload_depth_aerobic: 0.8, deload_quality_factor: 0.8,
      taper_profile: [], start_week: "2026-09-07", days: 5,
    };
    // Поддельный клиент: отдаёт ровно одну строку training_cycles, БД не нужна.
    const fakeSb = { from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [row], error: null }) }) }) } as unknown as Parameters<typeof loadActiveCycles>[0];
    const cycles = await loadActiveCycles(fakeSb, MON);
    const got = cycles.get(1);
    check("читатель: активный цикл прочитан в цель недели",
      !!got && got.target.days === 5 && got.target.aerobicMin > 0,
      `прочитано: ${got ? JSON.stringify(got.target) : "ничего"}`);

    // Неделя, собранная ПО СТРОКЕ ТРЕНЕРА, обязана отличаться от недели без цикла.
    const anchors2 = stubAnchors(); const env2 = { ...stubEnvelope(), capLongRunMin: 140 };
    const cat2 = stubCatalog();
    const wLive = got ? buildWeek(anchors2, env2, cat2, MON, false, null, got.target) : null;
    const wNone = buildWeek(anchors2, env2, cat2, MON, false, null);
    check("читатель: строка в таблице МЕНЯЕТ собранную неделю",
      !!wLive && wLive.refused == null && wLive.plannedMinutes !== wNone.plannedMinutes
        && wLive.sessions.length === 5,
      `по циклу ${wLive?.plannedMinutes} мин / ${wLive?.sessions.length} дней, без цикла ${wNone.plannedMinutes} мин / ${wNone.sessions.length} дней`);

    // Позиция недели считается от start_week, а не «всегда первая».
    const cyclesLater = await loadActiveCycles(fakeSb, "2026-09-28");
    check("читатель: позиция недели считается от start_week",
      cyclesLater.get(1)?.target.weekIndex === 4,
      `ожидали 4-ю неделю от 2026-09-07, получили ${cyclesLater.get(1)?.target.weekIndex}`);
  }

  console.log(`\nИТОГ: ${failures === 0 ? "все проверки прошли" : `ПАДЕНИЙ ${failures}`}`);
  if (failures > 0) process.exit(1);
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
