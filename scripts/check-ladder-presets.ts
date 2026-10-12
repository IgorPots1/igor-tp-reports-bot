/**
 * У каждой ступени лестницы есть пресет, и генератор собирает её без руки.
 *
 * ЧТО СТЕРЕЖЁТ. 12.10.2026 ряд ступеней задали явным индексом (6 x 5 → 5 x 6 →
 * 5 x 7 → 4 x 8 → 4 x 10), и лестница стала ЧИТАТЬ положение ученицы верно. Но
 * собрать новые форматы было нечем: в каталоге их не существовало, и каждый шаг
 * вверх требовал ручной правки — 5 x 6 на её неделе 12.10 именно так и стоит.
 * Лестница, просящая то, чего нельзя собрать, хуже лестницы покороче: тренер
 * читает «ступень 5 x 7», а в плане лежит что-то другое.
 *
 * ПОЧЕМУ ЧЕК ЖИВОЙ, А НЕ НА ФИКСТУРАХ. Проверяется именно соответствие КОДА в
 * лестнице и СТРОКИ в каталоге. На выдуманном каталоге это утверждение
 * тавтология: подстановка пройдёт при любом состоянии базы.
 *
 *   npx tsx --env-file=.env.local scripts/check-ladder-presets.ts
 */
import { createSupabaseServerClient } from "@/features/supabase/server";

import { loadCatalog } from "../tools/trainingpeaks-export/scripts/lib/autoplanner-catalog.ts";
import { WALK_INTERVAL_LADDER } from "../tools/trainingpeaks-export/scripts/lib/interval-ladder.ts";
import { buildAnchors, buildEnvelope } from "../tools/trainingpeaks-export/scripts/lib/intervals-plan-adapter.ts";
import { buildWeek, type CycleWeekTarget } from "../tools/trainingpeaks-export/scripts/lib/autoplanner-week.ts";
import { getOnboardingAnswers } from "@/features/intervals/loop/repository";
import { runSurfacesIncludeTreadmill, startingPointFromAnswers } from "@/features/intervals/onboarding/starting-point";

let failures = 0;
function expect(ok: boolean, message: string): void {
  console.log(`  ${ok ? "✓" : "✗"} ${message}`);
  if (!ok) failures += 1;
}

/**
 * Восстановление: 1:30 у всех, кроме 4 x 10 — там 2:00 [решение Игоря].
 * Десятиминутный отрезок требует чуть больше отдыха. Значение задано ЗДЕСЬ
 * списком, а не выведено из кода формата: правило про 2:00 это решение тренера,
 * и вывести его из «длина ≥ 10» значило бы выдумать закономерность по одной
 * точке.
 */
const RECOVERY_BY_CODE: Record<string, number> = {
  int_walk_3x3: 1,
  int_walk_4x3: 1,
  int_walk_5x3: 1,
  int_walk_6x4: 1.5,
  int_walk_7x4: 1.5,
  int_walk_6x5: 1.5,
  int_walk_5x6: 1.5,
  int_walk_5x7: 1.5,
  int_walk_4x10: 2,
  int_walk_4x8: 1.5,
};

/** Доля работы в неделе, выше которой формат не берут (quality-select). */
const WORK_SHARE = 0.2;

const sb = createSupabaseServerClient();
const catalog = await loadCatalog(sb);

console.log("── У КАЖДОЙ СТУПЕНИ ЕСТЬ ПРЕСЕТ ────────────────────────────");
for (const rung of WALK_INTERVAL_LADDER) {
  const preset = catalog.quality.find((q) => q.presetCode === rung.code);
  expect(preset !== undefined, `${rung.labelRu}: пресет ${rung.code} есть в каталоге и включён`);
  if (!preset) continue;
  expect(
    preset.totalWorkMinutes === rung.workMinutes,
    `${rung.labelRu}: работа в каталоге ${preset.totalWorkMinutes} совпадает с лестницей ${rung.workMinutes}`
  );
}

console.log("\n── ВОССТАНОВЛЕНИЕ: 1:30 У ВСЕХ, КРОМЕ 4 x 10 ──────────────");
const { data: params } = await sb
  .from("workout_template_presets")
  .select("preset_code, workout_template_preset_parameters(reps, work_duration_min, recovery_duration_min, recovery_type)")
  .in("preset_code", WALK_INTERVAL_LADDER.map((r) => r.code));
const byCode = new Map<string, { reps: number; work: number; recovery: number; type: string }>();
for (const raw of params ?? []) {
  const row = raw as unknown as Record<string, unknown>;
  // Вложенная выборка приходит то массивом, то объектом — зависит от того,
  // как PostgREST видит связь. Принимаем оба вида: падать на форме ответа,
  // когда данные на месте, значит проверять клиент, а не базу.
  const nested = row.workout_template_preset_parameters;
  const pp = (Array.isArray(nested) ? nested[0] : nested) as Record<string, unknown> | undefined;
  if (!pp) continue;
  byCode.set(String(row.preset_code), {
    reps: Number(pp.reps),
    work: Number(pp.work_duration_min),
    recovery: Number(pp.recovery_duration_min),
    type: String(pp.recovery_type),
  });
}
for (const rung of WALK_INTERVAL_LADDER) {
  const p = byCode.get(rung.code);
  expect(p !== undefined, `${rung.labelRu}: параметры найдены`);
  if (!p) continue;
  expect(
    p.reps * p.work === rung.workMinutes,
    `${rung.labelRu}: ${p.reps} x ${p.work} = ${p.reps * p.work} мин работы`
  );
  expect(
    p.recovery === RECOVERY_BY_CODE[rung.code],
    `${rung.labelRu}: отдых ${p.recovery} мин, ждём ${RECOVERY_BY_CODE[rung.code]}`
  );
  expect(p.type === "walk", `${rung.labelRu}: отдых шагом`);
}
// ОТДЕЛЬНО И ИМЕНЕМ: 4 x 10 берёт 2:00, а не 1:30 по умолчанию соседей.
const tenth = byCode.get("int_walk_4x10");
expect(tenth?.recovery === 2, `4 x 10 берёт 2:00, а не 1:30: ${tenth?.recovery}`);
expect(
  byCode.get("int_walk_5x7")?.recovery === 1.5,
  "и соседняя 5 x 7 при этом осталась на 1:30 — значение не разъехалось по всему ряду"
);

console.log("\n── ГЕНЕРАТОР СОБИРАЕТ КАЖДУЮ СТУПЕНЬ БЕЗ РУКИ ─────────────");
/**
 * НЕДЕЛЯ ДАЁТСЯ ПОД СТУПЕНЬ, А НЕ НАОБОРОТ. Отбор отвергает формат, чья работа
 * выше доли недели (weekly × 0.20): при неделе 190 потолок 38 мин, и 4 x 10 с
 * его сороковкой отсекается ТАМ — не бюджетом сессии и не потолком одной
 * тренировки. Это вопрос объёма цикла, а не каталога, поэтому здесь неделя
 * берётся заведомо достаточной: иначе чек проверял бы не то, что заявлено.
 */
const SOURCE = "40986bda-db39-43b8-aae3-86bce1b1f505";
const answers = await getOnboardingAnswers(SOURCE);
if (!answers) {
  console.log("  ✗ анкета ученицы не найдена — не на чем собирать");
  failures += 1;
} else {
  const { data: src } = await sb
    .from("student_data_sources").select("easy_pace_sec_per_km").eq("id", SOURCE).maybeSingle();
  const startPoint = startingPointFromAnswers(answers, {
    manualEasyPaceSec: Number((src as { easy_pace_sec_per_km: number } | null)?.easy_pace_sec_per_km ?? 0),
  }) as never;
  (startPoint as unknown as { runsOnTreadmill: boolean }).runsOnTreadmill =
    runSurfacesIncludeTreadmill(answers.runSurfaces);
  const anchors = buildAnchors(startPoint, null);
  const env = buildEnvelope(startPoint);

  for (const rung of WALK_INTERVAL_LADDER.slice(5)) {
    /**
     * НЕДЕЛЮ СВЯЗЫВАЮТ ДВА ПОТОЛКА, И БРАТЬ НАДО СТРОГИЙ ИЗ ДВУХ.
     *
     * Первый — доля работы в неделе (weekly × 0.20). Второй — бюджет СЕССИИ:
     * (weekly − округление − пол лёгкой) / (качественных + 1), и у низких
     * ступеней он связывает РАНЬШЕ доли. Первая версия чека брала только долю,
     * и 6 x 5 с 5 x 6 «не собирались» при неделе 150 — но причиной был бюджет
     * сессии, а не каталог. Чек, падающий не по заявленной причине, хуже
     * отсутствующего.
     */
    const p = byCode.get(rung.code)!;
    const sessionMin = 21 + rung.workMinutes + (p.reps - 1) * p.recovery + 5;
    const byShare = rung.workMinutes / WORK_SHARE;
    const byBudget = 2 * sessionMin + 50;
    const weekly = Math.ceil(Math.max(byShare, byBudget) / 5) * 5;
    const target = {
      weekIndex: 6, totalWeeks: 14, role: "рост",
      aerobicMin: weekly - rung.workMinutes, qualityMin: rung.workMinutes, days: 3,
      baseWeekMin: 148, hasTargetRace: false, intent: "maintenance",
      preferQualityPreset: rung.code, preferQualityPresets: [rung.code],
      minQualityWorkMin: null,
    } as unknown as CycleWeekTarget;
    const week = buildWeek(anchors, env, catalog, "2026-10-19", false, null, target, undefined);
    const quality = week.sessions.find((s) => s.role === "quality");
    const code = (quality as unknown as { presetCode?: string } | undefined)?.presetCode ?? null;
    expect(
      code === rung.code,
      `${rung.labelRu}: собрана без руки при неделе ${weekly} мин (взято ${code ?? "ничего"}, ${quality?.minutes ?? "—"} мин)`
    );
  }
}

console.log("");
if (failures === 0) {
  console.log("check:ladder-presets — все проверки пройдены");
  process.exit(0);
}
console.log(`ПРОВАЛОВ: ${failures}.`);
process.exit(1);
