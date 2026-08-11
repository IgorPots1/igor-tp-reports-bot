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

import { buildWeek, type CycleWeekTarget } from "./lib/autoplanner-week.ts";
import { stubAnchors, stubCatalog, stubEnvelope } from "./lib/cycle-check-stubs.ts";
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

function main(): void {
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

    // без цикла поведение прежнее: потолок берётся из конверта, а не из цели
    const wNo = buildWeek(anchors, env, cat, MON, false, null);
    check("без цикла: потолок из конверта, а не из цели цикла",
      wNo.weeklyCap !== target.aerobicMin + target.qualityMin && wNo.weeklyCap > 0,
      `потолок ${wNo.weeklyCap}`);
    check("без цикла: в заметках нет упоминания цикла",
      !wNo.notes.some((n) => n.startsWith("цикл")), `заметки: ${wNo.notes.join(" | ")}`);
  }

  console.log(`\nИТОГ: ${failures === 0 ? "все проверки прошли" : `ПАДЕНИЙ ${failures}`}`);
  if (failures > 0) process.exit(1);
}

main();
