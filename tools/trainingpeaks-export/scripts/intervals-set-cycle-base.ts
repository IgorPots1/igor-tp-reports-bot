/**
 * Заполнить заготовку цикла честными числами: черновик и прогноз недель.
 *
 * ── ЗАЧЕМ [27.09.2026] ──────────────────────────────────────────────────────
 *
 * У Валентины строка цикла оказалась ЗАГОТОВКОЙ: `draft` пустой объект,
 * `week_forecast` из одной недели с работой 0, `start_point` без истории.
 * Двенадцать недель сессий в базе написал разовый скрипт напрямую, минуя эти
 * поля. Следствие: ни один боевой путь перегенерации её план не пересобирал, и
 * каждая правка была ручной работой.
 *
 * Этот скрипт закрывает дыру: считает черновик и прогноз ТЕМИ ЖЕ функциями, что
 * работают в бою (buildDraftFromOnboarding + forecast), и записывает их в цикл.
 * Числа не сочинённые: они выведены из анкеты и из того, что человек уже делает.
 *
 * ── ПОЧЕМУ БАЗУ РАБОТЫ ПРИХОДИТСЯ ЗАДАВАТЬ РУКОЙ ────────────────────────────
 *
 * Анкета даёт по цели `regular` намерение `maintenance`, а у него база работы
 * равна нулю. Это и был корень восьминедельного лёгкого бега: цикл считал, что
 * работы нет, и не назначал её вовсе. Тренер тем временем дал рукой 7 × 4, то
 * есть 28 минут работы в неделю, и человек это делает.
 *
 * Ноль в базе спорит с фактом. Поэтому база работы передаётся явно, числом, и
 * это ЗНАНИЕ ТРЕНЕРА, а не вывод из анкеты. Тем же приёмом раньше поправили
 * объём со слов (intervals-set-reported-volume.ts): значение и его
 * происхождение пишутся вместе.
 *
 * ПО УМОЛЧАНИЮ НИЧЕГО НЕ ПИШЕТ.
 *
 *   npx tsx tools/trainingpeaks-export/scripts/intervals-set-cycle-base.ts \
 *     --athlete=manual-<uuid> --quality-base=28
 *   … и тот же вызов с --commit, чтобы записать.
 */

import process from "node:process";

import { createSupabaseServerClient } from "@/features/supabase/server";
import { getOnboardingAnswers } from "@/features/intervals/loop/repository";
import { startingPointFromAnswers } from "@/features/intervals/onboarding/starting-point";

import { buildDraftFromOnboarding } from "./lib/intervals-plan-adapter.ts";
import { forecast } from "./lib/training-cycle.ts";

const COMMIT = process.argv.includes("--commit");

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : null;
}

function fail(message: string): never {
  console.error(`⛔ ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const athleteId = arg("athlete");
  if (!athleteId) fail("Нужен --athlete=<external_athlete_id>");

  const qualityBaseArg = arg("quality-base");
  if (!qualityBaseArg) {
    fail(
      "Нужен --quality-base=<минуты работы в неделю>. Это знание тренера, а не вывод из анкеты:\n" +
        "у цели «бегать регулярно» база работы по анкете равна нулю, и цикл не назначит работу вовсе."
    );
  }
  const qualityBase = Number(qualityBaseArg);
  // Границы человеческие: меньше пяти минут работы в неделю — это не работа,
  // больше сотни у сегмента без часов — опечатка на порядок.
  if (!Number.isFinite(qualityBase) || qualityBase < 5 || qualityBase > 100) {
    fail(`База работы ${qualityBaseArg} вне разумного (5–100 мин/нед). Похоже на опечатку.`);
  }

  const supabase = createSupabaseServerClient();
  const { data: sourceRow } = await supabase
    .from("student_data_sources")
    .select("id, student_id")
    .eq("provider", "intervals")
    .eq("external_athlete_id", athleteId)
    .maybeSingle();
  if (!sourceRow) fail(`Источника с external_athlete_id ${athleteId} нет`);
  const sourceId = String((sourceRow as { id: string }).id);

  const { data: cardRow } = await supabase
    .from("trainingpeaks_students")
    .select("student_name")
    .eq("id", String((sourceRow as { student_id: string }).student_id))
    .maybeSingle();
  console.log(`Ученик: ${(cardRow as { student_name?: string } | null)?.student_name ?? "?"}`);

  const { data: cycleRow } = await supabase
    .from("intervals_plan_cycles")
    .select("id, status, first_week_start, length_weeks, draft, week_forecast, start_point")
    .eq("source_id", sourceId)
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!cycleRow) fail("Опубликованного цикла нет — заполнять нечего");
  const cycle = cycleRow as Record<string, unknown>;

  const answers = await getOnboardingAnswers(sourceId);
  if (!answers) fail("Анкета не заполнена");

  const oldDraft = (cycle.draft ?? {}) as Record<string, unknown>;
  const oldForecast = (cycle.week_forecast ?? []) as unknown[];
  console.log(
    `Цикл ${String(cycle.id).slice(0, 8)} · с ${cycle.first_week_start} · ${cycle.length_weeks} нед\n` +
      `Было: черновик ${Object.keys(oldDraft).length === 0 ? "ПУСТ" : `${Object.keys(oldDraft).length} полей`}` +
      ` · прогноз ${oldForecast.length} нед` +
      ` · стартовая точка ${(cycle.start_point as Record<string, unknown> | null)?.weekly ? "с историей" : "без истории"}`
  );

  const start = startingPointFromAnswers(answers);
  const built = buildDraftFromOnboarding(answers, start);
  for (const note of built.notes) console.log(`  · ${note}`);
  for (const blocker of built.blockers) console.log(`  ✋ ${blocker}`);

  /**
   * БАЗА РАБОТЫ ЗАМЕНЯЕТСЯ, ПОТОЛКИ ПЕРЕСЧИТЫВАЮТСЯ ОТ НЕЁ.
   *
   * peakCapQualityMin и historicMaxQualityMin выведены из базы внутри
   * buildDraftFromOnboarding. Подменить базу и оставить потолки от нуля значило
   * бы отдать forecast противоречивый черновик: база просит работу, потолок её
   * режет в ноль, и наружу опять выйдет лёгкий бег.
   */
  /**
   * НАМЕРЕНИЕ ТОЖЕ ПРИХОДИТСЯ НАЗЫВАТЬ [27.09.2026].
   *
   * У `maintenance` работа режется собственной долей практики (ownSharePct), а у
   * человека без истории эта доля равна нулю — значит работа выходит нулевой,
   * сколько бы ни стояло в базе. Плюс у maintenance нет ни роста, ни разгрузок:
   * прогноз получается плоским.
   *
   * Это и есть корень восьминедельного лёгкого бега во всей полноте: дело не
   * только в нулевой базе, а в том, что цель «бегать регулярно» отправляет
   * человека в намерение, которое не умеет назначать работу тому, у кого нет
   * измеренной истории.
   *
   * Поэтому намерение задаётся явно. По умолчанию берём то, что дала анкета:
   * молча переводить человека в другой цикл нельзя.
   */
  const intentArg = arg("intent");
  if (intentArg && intentArg !== "develop" && intentArg !== "maintenance" && intentArg !== "race") {
    fail(`--intent=${intentArg} не бывает. Ждём develop, maintenance или race.`);
  }
  const intent = (intentArg ?? built.draft.intent) as typeof built.draft.intent;

  /**
   * ДОЛЯ РАБОТЫ ТОЖЕ ВЫВОДИТСЯ ИЗ НАЗВАННОЙ БАЗЫ, ИНАЧЕ РАБОТА ОКРУГЛЯЕТСЯ В НОЛЬ.
   *
   * clampShare режет минуты работы по собственной доле практики (ownSharePct), а
   * у цели «бегать регулярно» она ставится нулём: wantsQuality = false. При нуле
   * допуск даёт около двух процентов недели, округление к пяти минутам съедает
   * остаток, и наружу выходит ноль — сколько бы ни стояло в базе работы.
   *
   * Считаем долю ОТ ТОЙ ЖЕ базы, которую назвал тренер: 28 из 185 + 28 это 13%.
   * Не выдуманное число и не константа: та же работа, выраженная в процентах.
   */
  /**
   * АЭРОБНАЯ БАЗА ТОЖЕ МОЖЕТ БЫТЬ НАЗВАНА РУКОЙ [27.09.2026].
   *
   * Анкета берёт её из self_reported_weekly_minutes. У Валентины там 185 —
   * число, которое тренер поставил сам, глядя на её рукописные карточки. Оно
   * описывает, что человек МОЖЕТ, а цикл считает от него то, что человек БУДЕТ
   * делать, и добавляет работу сверху: выходило 240 мин на неделю при фактически
   * отбеганных 112.
   *
   * «Со слов» и «по факту» — два разных числа, и цикл должен считать от второго.
   */
  const aerobicArg = arg("aerobic-base");
  let baseAerobicMin = built.draft.baseAerobicMin;
  if (aerobicArg) {
    const value = Number(aerobicArg);
    if (!Number.isFinite(value) || value < 30 || value > 800) {
      fail(`Аэробная база ${aerobicArg} вне разумного (30–800 мин/нед). Похоже на опечатку.`);
    }
    baseAerobicMin = value;
  }

  const ownSharePct = Math.round((100 * qualityBase) / (baseAerobicMin + qualityBase));

  const draft = {
    ...built.draft,
    intent,
    baseAerobicMin,
    baseQualityMin: qualityBase,
    peakCapQualityMin: Math.round(qualityBase * 1.5),
    historicMaxQualityMin: qualityBase,
    ownSharePct,
  };
  if (built.draft.baseAerobicMin !== baseAerobicMin) {
    console.log(
      `  ✋ аэробная база задана рукой: анкета дала ${built.draft.baseAerobicMin} (со слов), тренер назвал ${baseAerobicMin} (по факту)`
    );
  }
  if (built.draft.ownSharePct !== ownSharePct) {
    console.log(
      `  ✋ доля работы выведена из базы: анкета дала ${built.draft.ownSharePct}%, стало ${ownSharePct}%` +
        ` (${qualityBase} из ${baseAerobicMin + qualityBase} мин)`
    );
  }
  if (intent !== built.draft.intent) {
    console.log(`  ✋ намерение задано рукой: анкета дала ${built.draft.intent}, тренер назвал ${intent}`);
  }

  const firstWeekStart = String(cycle.first_week_start);
  const lengthWeeks = Number(cycle.length_weeks);
  const weeks = forecast(draft, firstWeekStart, lengthWeeks);

  console.log(
    `\nСтанет: аэробная база ${draft.baseAerobicMin} + работа ${draft.baseQualityMin} мин/нед · ` +
      `дней ${draft.days} · потолок аэробного ${draft.peakCapAerobicMin} · потолок работы ${draft.peakCapQualityMin}`
  );
  if (built.draft.baseQualityMin !== qualityBase) {
    console.log(
      `  ✋ база работы задана рукой: анкета дала ${built.draft.baseQualityMin}, тренер назвал ${qualityBase}`
    );
  }
  console.log(`\nПрогноз недель (${weeks.length}):`);
  for (const w of weeks) {
    console.log(
      `  ${w.weekStart} · ${String(w.role).padEnd(20)} аэробн ${String(w.aerobicMin).padStart(3)} + работа ${String(w.qualityMin).padStart(2)} = ${w.aerobicMin + w.qualityMin} мин · дней ${w.days}`
    );
  }

  if (!COMMIT) {
    console.log("\nНичего не записано (запуск без --commit).");
    return;
  }

  const { error } = await supabase
    .from("intervals_plan_cycles")
    .update({ draft, week_forecast: weeks })
    .eq("id", String(cycle.id));
  if (error) fail(`не записали: ${error.message}`);
  console.log("\nЗаписано: черновик и прогноз недель. Сессии НЕ тронуты — их пересобирает intervals:regenerate.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
