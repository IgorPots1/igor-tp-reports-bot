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

import { buildWeek, EASY_FLOOR_MIN, EASY_MAX, EASY_TARGET_BY_TIER, LONG_CEIL, LONG_FLOOR, LONG_TARGET_BY_INTENT, type CycleWeekTarget } from "./lib/autoplanner-week.ts";
import { stubAnchors, stubCatalog, stubEnvelope } from "./lib/cycle-check-stubs.ts";
import {
  MIN_RUNS_FOR_PERSONAL_FLOOR, countsForEasyFloor, countsForLongFallback,
  easyFloorPersonal, easyTargetPersonal, longRunPractice,
} from "./lib/practice-signals.ts";
import { loadActiveCycles } from "./lib/cycle-reader.ts";
import {
  DELOAD_AEROBIC_FACTOR, DELOAD_EVERY_N, DELOAD_QUALITY_FACTOR, MAX_SHARE_DEVIATION_PP,
  MAX_SINGLE_STEP, STEP_AEROBIC, STEP_QUALITY, TAPER_PROFILE, TAPER_NO_PEAK_FACTOR,
  forecast, pickTargetRace, weightedWeeklyBase, type CycleDraft, type CycleIntent,
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
    // ШАГ ЗАВЕДОМО БОЛЬШЕ ПРЕДЕЛА, иначе проверка бессодержательна: при штатных 1.06 ни один
    // переход и близко не подходит к 1.22, и снятие предела ничего не меняет (проверено
    // мутацией — «предел не применяется» не роняло эту проверку вообще).
    const dBig = draft({ stepAerobic: 1.5, peakCapAerobicMin: 9999, peakCapQualityMin: 9999 });
    const wBig = forecast(dBig, MON, 8);
    let okBig = true, detBig = "", bound = false;
    for (let i = 1; i < wBig.length; i++) {
      const prev = wBig[i - 1], cur = wBig[i];
      if (cur.role !== "рост" || prev.aerobicMin <= 0 || prev.role === "плановая разгрузка") continue;
      const ratio = cur.aerobicMin / prev.aerobicMin;
      if (ratio > MAX_SINGLE_STEP + 0.001) { okBig = false; detBig = `${prev.aerobicMin} -> ${cur.aerobicMin} = ×${ratio.toFixed(3)}`; }
      if (ratio > MAX_SINGLE_STEP - 0.05) bound = true;
    }
    check(`ни один переход роста не выше ×${MAX_SINGLE_STEP} (шаг заявлен 1.5 — предел ОБЯЗАН связать)`,
      ok && okBig && bound, detail || detBig || "предел ни разу не связал — проверка ничего не меряет");
  }

  // ── 6. личные потолки ──
  {
    // БЕЗ targetDate И НА ДЛИННОМ ГОРИЗОНТЕ. С подводкой рост доходил лишь до 375 при потолке
    // 400 — упереться было не во что, и обе проверки не значили НИЧЕГО: снятие потолка во всех
    // трёх местах его применения не роняло ни одну (проверено мутацией). Теперь горизонт такой,
    // что потолок ОБЯЗАН связать, и это проверяется отдельным условием.
    const d = draft();
    const w = forecast(d, MON, 14);
    const overA = w.find((x) => x.aerobicMin > d.peakCapAerobicMin);
    const overQ = w.find((x) => x.qualityMin > d.peakCapQualityMin);
    const hitA = w.some((x) => x.aerobicMin === d.peakCapAerobicMin);
    // ПОТОЛОК РАБОТЫ ПРОВЕРЯЕТСЯ НА ДРУГОМ АТЛЕТЕ. При обычной доле качества (~9%) зажим
    // доли срабатывает раньше потолка, и 60 мин работы недостижимы структурно: чтобы дойти
    // до них при аэробном 400, доля должна быть 13%. То есть на базовой заготовке эта
    // проверка не могла иметь зубов вообще. Берём атлета с высокой долей — там связывает
    // именно потолок.
    const dq = draft({ baseAerobicMin: 200, baseQualityMin: 40, peakCapAerobicMin: 9999 });
    const wq = forecast(dq, MON, 14);
    const overQ2 = wq.find((x) => x.qualityMin > dq.peakCapQualityMin);
    const hitQ = wq.some((x) => x.qualityMin === dq.peakCapQualityMin);
    check("аэробный не выше личного потолка (и потолок реально связывает)",
      !overA && hitA, overA ? `неделя ${overA.index}: ${overA.aerobicMin} > ${d.peakCapAerobicMin}`
        : `потолок ${d.peakCapAerobicMin} ни разу не достигнут — проверка ничего не меряет`);
    check("работа не выше личного потолка (и потолок реально связывает)",
      !overQ && !overQ2 && hitQ, (overQ ?? overQ2)
        ? `неделя ${(overQ ?? overQ2)!.index}: ${(overQ ?? overQ2)!.qualityMin} > потолка`
        : `потолок ${dq.peakCapQualityMin} ни разу не достигнут — проверка ничего не меряет`);
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
    // МЕДИАНА ПРАКТИКИ ЗАДАНА НАМЕРЕННО: без неё пол практики равен нулю при любой правке,
    // и утечка пола в БЕСЦИКЛОВЫЙ путь принципиально невидима — мутационный прогон 13.08
    // показал, что «пол применяется и без цикла» не роняло эту проверку вообще.
    // БЕЗ медианы практики: тогда решает именно longCapSource, и подмена «практика → baseline»
    // видна. С заданной медианой пол перекрывает источник, и мутация перестаёт ловиться —
    // проверено, при усилении соседней заглушки эта проверка молча потеряла зубы.
    const envFrozen = { ...env, capLongRunMin: 65, longRunPracticeMaxMin: 120 };
    const cycTarget: CycleWeekTarget = { weekIndex: 2, totalWeeks: 10, role: "рост", aerobicMin: 250, qualityMin: 30, days: 4 };
    const wFrozenCyc = buildWeek(anchors, envFrozen, cat, MON, false, null, cycTarget);
    // Для БЕСЦИКЛОВОЙ проверки медиана нужна: без неё пол практики равен нулю при любой
    // правке, и утечка пола в бесцикловый путь принципиально невидима.
    const envFrozenMed = { ...envFrozen, longRunPracticeMedianMin: 110 };
    const wFrozenNo = buildWeek(anchors, envFrozenMed, cat, MON, false, null);
    check("цикл: потолок длительной из ПРАКТИКИ, а не из замороженного baseline",
      longestOf(wFrozenCyc) > 65, `с циклом ${longestOf(wFrozenCyc)} мин при baseline 65 и практике 120`);
    check("без цикла: потолок длительной по-прежнему из baseline",
      longestOf(wFrozenNo) > 0 && longestOf(wFrozenNo) <= 65,
      `без цикла ${longestOf(wFrozenNo)} мин при baseline 65, практике 120 и медиане 110`);

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

    // (ж) ДЛИТЕЛЬНАЯ НЕ ОБНУЛЯЕТСЯ НА ПОНИЖЕННОЙ НЕДЕЛЕ.
    // У 5807145 выходил ноль: объём от факта, длительная оседала ровно на её исторической
    // лёгкой и переименовывалась в лёгкую. «Нет длительной» и «короткая длительная» — разное.
    // Медиана 160 подобрана так, чтобы ПОЛ ДЕЙСТВИТЕЛЬНО СВЯЗЫВАЛ: при медиане 90 доля
    // недели x0.45 и так даёт 80, пропорциональный пол выходит 53 и ничего не решает —
    // первая версия этой проверки на такой заглушке падала не по делу.
    const envNoRace = { ...env, capLongRunMin: 180, longRunPracticeMaxMin: 160, longRunPracticeMedianMin: 160, typicalEasyMinutes: 85 };
    const tgtNoRace: CycleWeekTarget = { weekIndex: 2, totalWeeks: 8, role: "поддержание", aerobicMin: 280, qualityMin: 25, days: 3, baseWeekMin: 305, hasTargetRace: false };
    const wIllLong = buildWeek(anchors, envNoRace, cat, MON, true, null, tgtNoRace);
    check("понижённая неделя: длительная НЕ обнуляется",
      wIllLong.refused != null || longestOf(wIllLong) >= LONG_FLOOR,
      `длительная ${longestOf(wIllLong)} мин на понижённой неделе (пол ${LONG_FLOOR})`);

    // (з) ЦЕЛЕВОЙ СТАРТ: длительная режется ПОСЛЕДНЕЙ. У кого старт есть, пол применяется
    // пропорционально понижению; у кого нет — пола нет. Разница обязана быть видна.
    const tgtRace: CycleWeekTarget = { ...tgtNoRace, hasTargetRace: true };
    const wIllRace = buildWeek(anchors, envNoRace, cat, MON, true, null, tgtRace);
    check("понижённая неделя: с целевым стартом длительная длиннее, чем без него",
      longestOf(wIllRace) > longestOf(wIllLong),
      `со стартом ${longestOf(wIllRace)}, без старта ${longestOf(wIllLong)}`);

    // (и) РАЗГРУЗКА: пол применяется к СНИЖЕННОЙ цели, а не к полной медиане практики.
    // Иначе на разгрузочной неделе длительная тянулась бы к медиане и разгрузки бы не было.
    // ЧИСЛО ТОЧНОЕ, А НЕ «МЕНЬШЕ ЧЕМ»: цель разгрузки 240 при базе 300 — это x0.8, значит пол
    // равен 180 x 0.8 = 144 -> 145 после округления к пяти. Заглушка подобрана так, чтобы
    // связывал именно ПОЛ, а не бюджет: при 5 днях длительная упиралась в бюджет на 100 мин,
    // и проверка проходила даже со снятым масштабированием.
    const envDl = { ...env, capLongRunMin: 200, longRunPracticeMaxMin: 180, longRunPracticeMedianMin: 180 };
    const deload: CycleWeekTarget = { weekIndex: 4, totalWeeks: 8, role: "плановая разгрузка", aerobicMin: 220, qualityMin: 20, days: 3, baseWeekMin: 300, hasTargetRace: true };
    const wDl = buildWeek(anchors, envDl, cat, MON, false, null, deload);
    check("разгрузка: пол практики едет вместе со сниженной целью (180 x 0.8 = 145)",
      longestOf(wDl) === 145,
      `длительная ${longestOf(wDl)}, ожидалось 145 при медиане практики 180 и разгрузке x0.8`);

    // (к) ПОТОЛОК И ПОЛ ДЛИТЕЛЬНОЙ РАСТУТ ПОД ДИСТАНЦИЮ.
    // Практический максимум 90 у марафонца — это про прошлое; цель подготовки за его пределами.
    // Неделя 5 обязана дать длительную ДЛИННЕЕ недели 1 при той же цели по объёму.
    const envMar = { ...env, capLongRunMin: 90, longRunPracticeMaxMin: 90, longRunPracticeMedianMin: 90, typicalEasyMinutes: 60 };
    const marW = (idx: number): CycleWeekTarget => ({
      weekIndex: idx, totalWeeks: 12, role: "рост", aerobicMin: 300, qualityMin: 30, days: 4,
      baseWeekMin: 330, hasTargetRace: true, intent: "marathon",
    });
    const wMar1 = buildWeek(anchors, envMar, cat, MON, false, null, marW(1));
    const wMar5 = buildWeek(anchors, envMar, cat, MON, false, null, marW(5));
    // ЧИСЛО ТОЧНОЕ, А НЕ «БОЛЬШЕ ЧЕМ»: 90 x 1.116^4 = 139 -> 140 после округления к пяти.
    // Слабая формулировка «неделя 5 больше недели 1» проходила при снятии ЛЮБОГО из двух
    // механизмов по отдельности — потолок и пол дублируют друг друга, и каждый в одиночку
    // вытягивал длительную выше практики. Точное число ловит оба.
    check("марафон: длительная растёт по замеренному шагу (90 x 1.116^4 = 140)",
      longestOf(wMar1) === 90 && longestOf(wMar5) === 140,
      `неделя 1 ${longestOf(wMar1)} (ждали 90), неделя 5 ${longestOf(wMar5)} (ждали 140)`);

    // (л) РОСТ НЕ ПЕРЕЛЕТАЕТ ЦЕЛЬ ДИСТАНЦИИ. На далёкой неделе шаг^N улетел бы за 180.
    const wMar20 = buildWeek(anchors, envMar, cat, MON, false, null, { ...marW(20), aerobicMin: 500, qualityMin: 40, baseWeekMin: 540 });
    check(`марафон: рост не выше цели дистанции ${LONG_TARGET_BY_INTENT.marathon}`,
      longestOf(wMar20) <= LONG_TARGET_BY_INTENT.marathon,
      `неделя 20 дала ${longestOf(wMar20)}, цель ${LONG_TARGET_BY_INTENT.marathon}`);

    // (м) БЕЗ ЦЕЛЕВОГО СТАРТА РОСТА НЕТ — поддержание не должно уводить за прошлое атлета.
    const wKeep5 = buildWeek(anchors, envMar, cat, MON, false, null,
      { ...marW(5), intent: "maintenance", hasTargetRace: false });
    check("поддержание: потолок длительной НЕ растёт за практику атлета",
      longestOf(wKeep5) <= envMar.longRunPracticeMaxMin,
      `неделя 5 поддержания дала ${longestOf(wKeep5)}, практика максимум ${envMar.longRunPracticeMaxMin}`);

    // (н) ПОДВОДКА НЕ ОБНУЛЯЕТ ДЛИТЕЛЬНУЮ. Прежняя оговорка покрывала только неделю,
    // понижённую сигналом, и на подводке ноль возвращался (у 5807145 на 6-й неделе).
    const wTaper = buildWeek(anchors, envMar, cat, MON, false, null,
      { weekIndex: 11, totalWeeks: 12, role: "подводка", aerobicMin: 135, qualityMin: 20, days: 4, baseWeekMin: 330, hasTargetRace: true, intent: "marathon" });
    check("подводка: длительная НЕ обнуляется",
      wTaper.refused != null || longestOf(wTaper) >= LONG_FLOOR,
      `подводочная неделя дала длительную ${longestOf(wTaper)} (пол ${LONG_FLOOR})`);

    // (о) РОСТ СВЕРХ МЕДИАНЫ ПОДЧИНЯЕТСЯ ДОЛЕ x0.45, САМА МЕДИАНА — НЕТ.
    // Заглушка: медиана практики 90, неделя 200 мин (0.45 x 200 = 90), а выросший пол на
    // 8-й неделе просит 90 x 1.116^7 = 191. Без защиты длительная забрала бы 95% недели.
    const envHole = { ...env, capLongRunMin: 200, longRunPracticeMaxMin: 90, longRunPracticeMedianMin: 90 };
    const wHole = buildWeek(anchors, envHole, cat, MON, false, null,
      { weekIndex: 8, totalWeeks: 12, role: "рост", aerobicMin: 175, qualityMin: 25, days: 3, baseWeekMin: 200, hasTargetRace: true, intent: "marathon" });
    check("рост длительной не обходит защиту доли недели x0.45",
      wHole.refused != null || longestOf(wHole) <= Math.ceil(200 * 0.45) + 2,
      `неделя 200 мин дала длительную ${longestOf(wHole)} (защита ${Math.round(200 * 0.45)})`);

    // (п) ЛИЧНЫЙ ПОЛ ЛЁГКОЙ. Когортные 25 мин пускали в неделю сессии 35-40 тем, кому тренер
    // короче 60 не ставит. Заглушка: личный пол 50 — ни одна сессия недели не должна быть короче.
    // ЧИСЛО ТОЧНОЕ, не «больше 25»: с когортным полом кратчайшая выходит 35, и мягкая
    // формулировка прошла бы при снятой правке.
    // ЗАГЛУШКА ПОДОБРАНА ТАК, ЧТОБЫ ПОЛ ДЕЙСТВИТЕЛЬНО СВЯЗЫВАЛ. При просторной неделе лёгкие
    // и без пола дорастают до цели тира (50), и снятие правки проверку не роняет — первая
    // версия так и прошла мутацию. Здесь неделя тесная и длительная забирает много: без пола
    // кратчайшая сессия выходит 25, с полом — 50.
    const envFloor = { ...env, easyFloorPersonalMin: 50, capLongRunMin: 130, longRunPracticeMaxMin: 130, longRunPracticeMedianMin: 110 };
    const floorTgt: CycleWeekTarget = { weekIndex: 2, totalWeeks: 10, role: "рост", aerobicMin: 200, qualityMin: 30, days: 4, baseWeekMin: 230, hasTargetRace: false, intent: "maintenance" };
    const wFloor = buildWeek(anchors, envFloor, cat, MON, false, null, floorTgt);
    const shortestOf = (w: { sessions: Array<{ minutes: number; deferred?: boolean }> }): number => {
      const mins = w.sessions.filter((s) => !s.deferred).map((s) => s.minutes);
      return mins.length ? Math.min(...mins) : 0;
    };
    check("личный пол лёгкой: ни одна сессия не короче собственного минимума атлета",
      wFloor.refused == null && shortestOf(wFloor) >= 50,
      `личный пол 50, кратчайшая сессия ${shortestOf(wFloor)}, вся неделя ${wFloor.sessions.map((s) => s.minutes).join("/")}`);

    // (р) НА УРЕЗАННОЙ НЕДЕЛЕ ПОЛ МАСШТАБИРУЕТСЯ, как и у длительной: иначе неделю не урезать.
    const wFloorTaper = buildWeek(anchors, envFloor, cat, MON, false, null,
      { ...floorTgt, role: "подводка", aerobicMin: 120, qualityMin: 20, baseWeekMin: 240 });
    check("личный пол лёгкой: на урезанной неделе масштабируется вместе с целью",
      wFloorTaper.refused != null || shortestOf(wFloorTaper) < 50,
      `подводка дала кратчайшую ${shortestOf(wFloorTaper)}, полный личный пол 50`);

    // (с) МАЛО ДАННЫХ — КОГОРТНЫЙ ПОЛ, прежнее поведение.
    const wNoPf = buildWeek(anchors, { ...envFloor, easyFloorPersonalMin: 0 }, cat, MON, false, null, floorTgt);
    check("мало данных: пол остаётся когортным, неделя собирается",
      wNoPf.refused == null && shortestOf(wNoPf) >= EASY_FLOOR_MIN && shortestOf(wNoPf) < 50,
      `без личного пола кратчайшая ${shortestOf(wNoPf)} (когортный ${EASY_FLOOR_MIN})`);

    // без цикла поведение прежнее: потолок берётся из конверта, а не из цели
    const wNo = buildWeek(anchors, env, cat, MON, false, null);
    check("без цикла: потолок из конверта, а не из цели цикла",
      wNo.weeklyCap !== target.aerobicMin + target.qualityMin && wNo.weeklyCap > 0,
      `потолок ${wNo.weeklyCap}`);
    check("без цикла: в заметках нет упоминания цикла",
      !wNo.notes.some((n) => n.startsWith("цикл")), `заметки: ${wNo.notes.join(" | ")}`);
  }

  // ── 6б. ПРАКТИЧЕСКИЕ СИГНАЛЫ: настоящие проверки, а не через заглушку конверта ──
  // До 13.08 этот код не исполнялся проверками ВООБЩЕ: все идут на stubEnvelope, а величины
  // приходят туда уже готовыми. Мутационный прогон это и показал — порча отсева разминок и
  // порога достаточности не роняла ни одной из 49 проверок. Здесь проверяется сама логика.
  {
    const QRE = /([0-9]+\s*[xх×]\s*[0-9]|интерв|отрезк|повтор|порог|фартлек|vo\s?2|мпк|темп выше)/i;

    // (1) ОТСЕВ РАЗМИНОК. Всё короче 40 мин в практике — «Разминка» перед стартом, и без
    // её отсева минимум атлета падает в когортный пол, а личный пол теряет смысл.
    check("практика: разминка не идёт в выборку пола лёгкой",
      !countsForEasyFloor("Разминка", 23, QRE) && !countsForEasyFloor("Активация перед стартом", 20, QRE)
        && countsForEasyFloor("Лёгкий бег", 50, QRE),
      `разминка 23 → ${countsForEasyFloor("Разминка", 23, QRE)}, лёгкий 50 → ${countsForEasyFloor("Лёгкий бег", 50, QRE)}`);

    // (2) «ТЕМП ВЫШЕ» — АЭРОБНЫЙ ПО ЗАМЕРУ, хотя регулярка качества его ловит. Без этого
    // у 5748681 в выборку не попадало почти ничего.
    check("практика: «темп выше» считается аэробным вопреки регулярке качества",
      countsForEasyFloor("Лёгкий бег (темп выше)", 100, QRE) && !countsForEasyFloor("6 x 4 мин", 50, QRE),
      `темп выше → ${countsForEasyFloor("Лёгкий бег (темп выше)", 100, QRE)}, отрезки → ${countsForEasyFloor("6 x 4 мин", 50, QRE)}`);

    // (3) ЛИЧНЫЙ ПОЛ — p10, ЧИСЛОМ. На 21 значении 40..60 десятый перцентиль = 42:
    // индекс floor(0.1 * 20) = 2, то есть третье снизу. min дал бы 40, p25 — 45.
    const ramp = Array.from({ length: 21 }, (_, i) => 40 + i);
    check("практика: личный пол лёгкой — именно p10 (набор 40..60 → 42)",
      easyFloorPersonal(ramp) === 42, `получено ${easyFloorPersonal(ramp)}, ожидалось 42 (min 40, p25 45)`);

    // (3б) ЛИЧНАЯ ЦЕЛЬ ЛЁГКОЙ — МЕДИАНА той же выборки (правило «цели из медианы»).
    // На наборе 40..60 медиана 50, а p10 42 — то есть цель и пол это РАЗНЫЕ величины.
    check("практика: личная цель лёгкой — медиана, и она отличается от пола",
      easyTargetPersonal(ramp) === 50 && easyTargetPersonal(ramp) !== easyFloorPersonal(ramp),
      `цель ${easyTargetPersonal(ramp)} (ждали 50), пол ${easyFloorPersonal(ramp)}`);
    check(`практика: меньше ${MIN_RUNS_FOR_PERSONAL_FLOOR} пробежек — личной цели нет`,
      easyTargetPersonal(ramp.slice(0, MIN_RUNS_FOR_PERSONAL_FLOOR - 1)) === 0,
      `получено ${easyTargetPersonal(ramp.slice(0, MIN_RUNS_FOR_PERSONAL_FLOOR - 1))}`);

    // (4) ПОРОГ ДОСТАТОЧНОСТИ. При n < MIN_RUNS_FOR_PERSONAL_FLOOR личного пола нет вовсе —
    // возвращается 0, и сборщик берёт когортный.
    check(`практика: меньше ${MIN_RUNS_FOR_PERSONAL_FLOOR} пробежек — личного пола нет`,
      easyFloorPersonal(ramp.slice(0, MIN_RUNS_FOR_PERSONAL_FLOOR - 1)) === 0
        && easyFloorPersonal(ramp.slice(0, MIN_RUNS_FOR_PERSONAL_FLOOR)) > 0,
      `n=${MIN_RUNS_FOR_PERSONAL_FLOOR - 1} → ${easyFloorPersonal(ramp.slice(0, MIN_RUNS_FOR_PERSONAL_FLOOR - 1))}, `
      + `n=${MIN_RUNS_FOR_PERSONAL_FLOOR} → ${easyFloorPersonal(ramp.slice(0, MIN_RUNS_FOR_PERSONAL_FLOOR))}`);

    // (5) ПРАКТИКА ДЛИТЕЛЬНЫХ ПО ЗАГОЛОВКАМ, когда они есть.
    const titled = [90, 100, 110, 120];
    const byTitle = longRunPractice(titled, [200, 190, 180]);
    check("практика длительных: по заголовкам, запасной детектор не вмешивается",
      byTitle.maxMin === 120 && byTitle.medianMin === 105 && !byTitle.fromFallback,
      `макс ${byTitle.maxMin}, медиана ${byTitle.medianMin}, запасной ${byTitle.fromFallback}`);

    // (6) ЗАПАСНОЙ ДЕТЕКТОР включается ТОЛЬКО при полном отсутствии заголовков.
    // Набор из 20 значений 60..250: верхняя дециль — два самых длинных (250 и 240), медиана 245.
    const nonQual = [...Array.from({ length: 18 }, (_, i) => 60 + i * 5), 240, 250];
    const fb = longRunPractice([], nonQual);
    check("практика длительных: без заголовков — медиана верхней децили не-качественных",
      fb.fromFallback && fb.maxMin === fb.medianMin && fb.maxMin === 245,
      `получено ${fb.maxMin}, ожидалось 245 (верхняя дециль из 20 = два значения: 250 и 240)`);

    // (7) МАРАФОНСКИЙ БЛОК не считается обычной длительной: у 5475652 «25 км в темпе марафона»
    // на 180 мин задирал медиану длительных со 115 до 134.
    check("практика: блок в темпе марафона не идёт в запасной детектор длительных",
      !countsForLongFallback("25 км в темпе марафона", 180, QRE)
        && countsForLongFallback("Бег по пульсу (с гелями)", 165, QRE),
      `марафонский блок → ${countsForLongFallback("25 км в темпе марафона", 180, QRE)}`);
  }

  // ── 6в. ЦЕЛЬ И ПОТОЛОК ЛЁГКОЙ — ЛИЧНЫЕ ──
  {
    const anchors2 = stubAnchors(); const cat2 = stubCatalog();
    // тир T2: когортная цель 50, когортный потолок 70. Личные заведомо выше.
    // ЦЕЛЬ НИЖЕ ПОТОЛКА И БЮДЖЕТ ПРОСТОРНЫЙ. Если поставить цель 70 при когортном потолке 70,
    // лёгкая упрётся в 70 при любой правке, и снятие ЛИЧНОГО потолка проверку не уронит —
    // так первая версия и прошла мутацию. Здесь цель 60, личный потолок 95, а бюджета хватает,
    // чтобы добор увёл лёгкую ВЫШЕ когортных 70: связать может только личный потолок.
    const envP = { ...stubEnvelope(), easyTargetPersonalMin: 60, easyMaxPersonalMin: 95,
      easyFloorPersonalMin: 45, capLongRunMin: 120, longRunPracticeMaxMin: 110, longRunPracticeMedianMin: 90 };
    // БЮДЖЕТ ТЕСНЫЙ: на просторной неделе добор доводит лёгкие до 65 независимо от цели,
    // и возврат цели на тирную проверку не роняет (проверено мутацией). Здесь цель связывает.
    const tP: CycleWeekTarget = { weekIndex: 2, totalWeeks: 10, role: "рост", aerobicMin: 300, qualityMin: 30, days: 4, baseWeekMin: 330, hasTargetRace: false, intent: "maintenance" };
    const wP = buildWeek(anchors2, envP, cat2, MON, false, null, tP);
    const easies = wP.sessions.filter((x) => !x.deferred && x.role !== "long" && x.role !== "quality");
    const longestEasy = easies.reduce((m, x) => Math.max(m, x.minutes), 0);
// ПРОВЕРКИ «ЛЁГКАЯ ТЯНЕТСЯ К ЛИЧНОЙ ЦЕЛИ» НА УРОВНЕ СБОРЩИКА НЕТ, И ЭТО ЧЕСТНО.
    // Цель лёгкой в сборщике НЕ СВЯЗЫВАЕТ: шаг добора перерастает её при любом бюджете, который
    // я смог подобрать, и возврат цели на тирную не менял ни одного числа на заглушке
    // (проверено мутацией дважды, на тесном и на просторном бюджете). На ЖИВЫХ данных эффект
    // есть — у 5905779 кратчайшая сессия 50 -> 55, у 5931798 объём 203 -> 208, — но воспроизвести
    // его заглушкой не удалось. Поэтому здесь проверяется сама величина (ниже, в блоке практики),
    // а сборщик остаётся непокрытым по этой оси и записан в отчёт как пробел.
// ПРОВЕРКИ НА ЛИЧНЫЙ ПОТОЛОК ЛЁГКОЙ НЕТ: правка не введена, потому что инертна —
    // до потолка лёгкая не доходит, раньше связывает пропорция формы (см. autoplanner-week).

    // мало данных — обе величины 0, поведение прежнее
    const wCoh = buildWeek(anchors2, { ...envP, easyTargetPersonalMin: 0, easyMaxPersonalMin: 0 }, cat2, MON, false, null, tP);
    const easiesC = wCoh.sessions.filter((x) => !x.deferred && x.role !== "long" && x.role !== "quality");
    check("мало данных: цель и потолок лёгкой остаются когортными",
      easiesC.every((x) => x.minutes <= EASY_MAX),
      `лёгкие ${easiesC.map((x) => x.minutes).join("/")} при когортном потолке ${EASY_MAX}`);
  }

  // ── 7а. ТОЧКА ПРИЦЕЛИВАНИЯ  // ── 7а. ТОЧКА ПРИЦЕЛИВАНИЯ  // ── 6в. ЦЕЛЬ И ПОТОЛОК ЛЁГКОЙ — ЛИЧНЫЕ ──
  {
    const anchors2 = stubAnchors(); const cat2 = stubCatalog();
    // тир T2: когортная цель 50, когортный потолок 70. Личные заведомо выше.
    // ЦЕЛЬ НИЖЕ ПОТОЛКА И БЮДЖЕТ ПРОСТОРНЫЙ. Если поставить цель 70 при когортном потолке 70,
    // лёгкая упрётся в 70 при любой правке, и снятие ЛИЧНОГО потолка проверку не уронит —
    // так первая версия и прошла мутацию. Здесь цель 60, личный потолок 95, а бюджета хватает,
    // чтобы добор увёл лёгкую ВЫШЕ когортных 70: связать может только личный потолок.
    const envP = { ...stubEnvelope(), easyTargetPersonalMin: 60, easyMaxPersonalMin: 95,
      easyFloorPersonalMin: 45, capLongRunMin: 120, longRunPracticeMaxMin: 110, longRunPracticeMedianMin: 90 };
    // БЮДЖЕТ ТЕСНЫЙ: на просторной неделе добор доводит лёгкие до 65 независимо от цели,
    // и возврат цели на тирную проверку не роняет (проверено мутацией). Здесь цель связывает.
    const tP: CycleWeekTarget = { weekIndex: 2, totalWeeks: 10, role: "рост", aerobicMin: 300, qualityMin: 30, days: 4, baseWeekMin: 330, hasTargetRace: false, intent: "maintenance" };
    const wP = buildWeek(anchors2, envP, cat2, MON, false, null, tP);
    const easies = wP.sessions.filter((x) => !x.deferred && x.role !== "long" && x.role !== "quality");
    const longestEasy = easies.reduce((m, x) => Math.max(m, x.minutes), 0);
    check(`лёгкая тянется к ЛИЧНОЙ цели, а не к цели тира (T2 = ${EASY_TARGET_BY_TIER.T2}, личная 60)`,
      longestEasy >= 60, `самая длинная лёгкая ${longestEasy}, личная цель 60, цель тира ${EASY_TARGET_BY_TIER.T2}`);
// ПРОВЕРКИ НА ЛИЧНЫЙ ПОТОЛОК ЛЁГКОЙ НЕТ: правка не введена, потому что инертна —
    // до потолка лёгкая не доходит, раньше связывает пропорция формы (см. autoplanner-week).

    // мало данных — обе величины 0, поведение прежнее
    const wCoh = buildWeek(anchors2, { ...envP, easyTargetPersonalMin: 0, easyMaxPersonalMin: 0 }, cat2, MON, false, null, tP);
    const easiesC = wCoh.sessions.filter((x) => !x.deferred && x.role !== "long" && x.role !== "quality");
    check("мало данных: цель и потолок лёгкой остаются когортными",
      easiesC.every((x) => x.minutes <= EASY_MAX),
      `лёгкие ${easiesC.map((x) => x.minutes).join("/")} при когортном потолке ${EASY_MAX}`);
  }

  // ── 7а. ТОЧКА ПРИЦЕЛИВАНИЯ  // ── 7а. ТОЧКА ПРИЦЕЛИВАНИЯ: СЕРЕДИНА МЕЖДУ МЕДИАНОЙ И p75 ──
  // Была медиана — цель садилась в середину собственного распределения атлета, и половина
  // его недель оказывалась больше плановой. Проверяется ЧИСЛОМ на известном наборе: при
  // равных весах медиана = 200, p75 = 300, середина = 250. Формулировка «больше медианы»
  // не годится: её прошло бы и чистое p75, а это другая точка.
  {
    const flat = [100, 200, 300, 400].map((v) => ({ weekStart: "2026-06-01", value: v, hasTraining: true }));
    // одинаковая дата => одинаковый вес, значит перцентили считаются как на невзвешенном наборе
    const got = weightedWeeklyBase(flat, "2026-06-01", [], 42);
    check("точка прицеливания: середина между медианой и p75 (200 и 300 → 250)",
      got === 250, `получено ${got}, ожидалось 250 (медиана 200, p75 300)`);

    // и она обязана быть СТРОГО между: не медианой и не p75
    check("точка прицеливания: не медиана и не p75",
      got > 200 && got < 300, `получено ${got}`);
  }

  // ── 7б. ВЫБОР ЦЕЛЕВОГО СТАРТА  // ── 7б. ВЫБОР ЦЕЛЕВОГО СТАРТА: ГЛАВНЫЙ, А НЕ БЛИЖАЙШИЙ ──
  {
    const MONDAY = "2026-08-17";
    const R = (id: string, d: string, km: number | null) => ({ id, event_date: d, distance_km: km });

    // Ближний старт целью не берётся: под него уже не построить цикл.
    // БЛИЖНИЙ СДЕЛАН САМЫМ ДЛИННЫМ НАМЕРЕННО: иначе его отсекает правило «длинная бьёт
    // короткую», и снятие самого порога проверку не роняет — первая версия так и прошла мутацию.
    const nearBig = [R("near42", "2026-08-19", 42.2), R("far21", "2026-09-14", 21.1)];
    check("целевой старт: ближе 2 недель не берётся даже если он самый длинный",
      pickTargetRace(nearBig, MONDAY)?.id === "far21",
      `выбран ${pickTargetRace(nearBig, MONDAY)?.id ?? "ничего"}`);

    // длинная дистанция бьёт короткую, даже если короткая раньше (случай 5475652)
    check("целевой старт: длинная дистанция бьёт короткую",
      pickTargetRace([R("k10", "2026-09-28", 10), R("mar", "2026-11-02", 42.2)], MONDAY)?.id === "mar",
      `выбран ${pickTargetRace([R("k10", "2026-09-28", 10), R("mar", "2026-11-02", 42.2)], MONDAY)?.id}`);

    // горизонт — типовая длина цикла ПОД ЭТУ дистанцию: десятке 30 недель не готовятся
    check("целевой старт: за горизонтом своего цикла не берётся",
      pickTargetRace([R("far10", "2027-03-15", 10)], MONDAY) === null,
      `выбран ${pickTargetRace([R("far10", "2027-03-15", 10)], MONDAY)?.id ?? "ничего"}`);

    // без дистанции тип цикла не вывести — целью не берётся
    check("целевой старт: без дистанции не берётся",
      pickTargetRace([R("nod", "2026-09-14", null)], MONDAY) === null,
      `выбран ${pickTargetRace([R("nod", "2026-09-14", null)], MONDAY)?.id ?? "ничего"}`);

    // при равной дистанции — более ранний
    check("целевой старт: при равной дистанции берётся более ранний",
      pickTargetRace([R("late", "2026-10-26", 42.2), R("early", "2026-10-19", 42.2)], MONDAY)?.id === "early",
      `выбран ${pickTargetRace([R("late", "2026-10-26", 42.2), R("early", "2026-10-19", 42.2)], MONDAY)?.id}`);
  }

  // ── 8. ЧИТАТЕЛЬ ЦИКЛА  // ── 8. ЧИТАТЕЛЬ ЦИКЛА: СТРОКА В ТАБЛИЦЕ РЕАЛЬНО МЕНЯЕТ НЕДЕЛЮ ──
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

    // РУЧНАЯ БАЗА ТРЕНЕРА ГЛАВНЕЕ РАСЧЁТНОЙ. Мутационный прогон 13.08 показал, что это
    // поведение не покрыто ничем: подмена base_aerobic_min_manual на base_aerobic_min не
    // роняла ни одной из 48 проверок.
    const rowManual = { ...row, base_aerobic_min: 260, base_aerobic_min_manual: 180, base_manual_reason: "новая норма" };
    const fakeManual = { from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [rowManual], error: null }) }) }) } as unknown as Parameters<typeof loadActiveCycles>[0];
    const cyclesManual = await loadActiveCycles(fakeManual, MON);
    const gotManual = cyclesManual.get(1);
    const gotPlain = (await loadActiveCycles(fakeSb, MON)).get(1);
    check("читатель: ручная база тренера главнее расчётной",
      !!gotManual && !!gotPlain && gotManual.target.aerobicMin < gotPlain.target.aerobicMin,
      `с ручной базой 180 → ${gotManual?.target.aerobicMin}, с расчётной 260 → ${gotPlain?.target.aerobicMin}`);

    // Позиция недели считается от start_week, а не «всегда первая».    // Позиция недели считается от start_week, а не «всегда первая».
    const cyclesLater = await loadActiveCycles(fakeSb, "2026-09-28");
    check("читатель: позиция недели считается от start_week",
      cyclesLater.get(1)?.target.weekIndex === 4,
      `ожидали 4-ю неделю от 2026-09-07, получили ${cyclesLater.get(1)?.target.weekIndex}`);
  }

  console.log(`\nИТОГ: ${failures === 0 ? "все проверки прошли" : `ПАДЕНИЙ ${failures}`}`);
  if (failures > 0) process.exit(1);
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
