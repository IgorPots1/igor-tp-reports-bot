/**
 * Калибровка подборщика кроссовок на РЕАЛЬНЫХ ответах.
 *
 * Показывает пару «ответы → что выдали» в читаемом виде: Игорь просматривает
 * первые 10–15 выдач и отмечает те, где рекомендация расходится с тем, что он
 * посоветовал бы сам. Веса правятся по этим расхождениям — и только по ним:
 * до первой калибровки числа в src/features/shoes/weights.ts не трогаются.
 *
 * Калибровка на выдуманных профилях отменена намеренно. Придуманный профиль
 * проверяет догадку о том, кто придёт, а не то, кто пришёл.
 *
 * Разошлось — случай заводится профилем с expect в scripts/check-shoes-picker.ts,
 * чтобы следующая правка весов не сломала уже разобранное. Ключ `--profile`
 * печатает готовый блок для вставки туда.
 *
 *   npm run shoes:calibration-review            — последние 15 выдач
 *   npm run shoes:calibration-review -- 40      — последние 40
 *   npm run shoes:calibration-review -- 15 --profile
 *
 * Только чтение: ничего не пишет и не отправляет.
 */
import { createSupabaseServerClient } from "../src/features/supabase/server";
import { describeAnswers } from "../src/features/shoes/labels";
import { SHOE_INDEX } from "../src/features/shoes/search";

const args = process.argv.slice(2);
const limit = Number(args.find((a) => /^\d+$/.test(a)) ?? 15);
const withProfile = args.includes("--profile");

const NAME = new Map(SHOE_INDEX.map((e) => [e.id, `${e.brand} ${e.model}`]));
const SLOT_TITLES: Record<string, string> = {
  daily: "Ежедневные",
  tempo: "Темповые",
  race: "Стартовые",
  trail: "Трейловые",
  trail_light: "Грунт и лес",
  winter: "Зима и мокрая погода",
};

type Row = {
  id: string;
  created_at: string;
  answers: Record<string, unknown>;
  picks: { slot: string; shoeIds: string[] }[] | null;
};

// Понятный отказ вместо стектрейса: скрипт запускают из каталога, где лежит
// .env.local, и первая же ошибка должна говорить об этом словами.
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "Нет доступа к базе: не заданы SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Запускай из каталога с .env.local (/Users/igor/igor-tp-reports-bot)."
  );
  process.exit(1);
}

const supabase = createSupabaseServerClient();
const { data, error } = await supabase
  .from("shoe_picker_answers")
  .select("id, created_at, answers, picks")
  .order("created_at", { ascending: false })
  .limit(limit);

if (error) {
  console.error("Не смог прочитать shoe_picker_answers:", error.message);
  process.exit(1);
}

const rows = (data ?? []) as Row[];
if (rows.length === 0) {
  console.log(
    "Ответов пока нет. Таблица shoe_picker_answers пуста — либо страница ещё не\n" +
      "запущена, либо все прошедшие сняли галочку сохранения."
  );
  process.exit(0);
}

console.log(`Выдач: ${rows.length} (новые сверху)\n`);

rows.forEach((row, i) => {
  const when = new Date(row.created_at).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
  console.log(`${"─".repeat(64)}`);
  console.log(`#${i + 1}  ${when} МСК`);
  console.log("");
  for (const line of describeAnswers(row.answers)) console.log(`  ${line}`);
  console.log("");
  for (const p of row.picks ?? []) {
    const names = p.shoeIds.map((id) => NAME.get(id) ?? id);
    console.log(`  ${SLOT_TITLES[p.slot] ?? p.slot}: ${names.join(" · ") || "пусто"}`);
  }
  console.log("");
  console.log("  Согласен с выдачей? Если нет — что бы посоветовал сам:");
  console.log("  ______________________________________________");

  if (withProfile) {
    const a = row.answers;
    console.log("\n  Готовый профиль для scripts/check-shoes-picker.ts:\n");
    console.log("  {");
    console.log(`    name: "реальный случай ${when}",`);
    console.log(`    answers: ${JSON.stringify(a)},`);
    console.log(`    expectSlots: [${(row.picks ?? []).map((p) => `"${p.slot}"`).join(", ")}],`);
    console.log("  },");
  }
  console.log("");
});

console.log(`${"─".repeat(64)}`);
console.log(
  "Разошлось — заводи случай профилем в scripts/check-shoes-picker.ts и правь\n" +
    "веса в src/features/shoes/weights.ts. Разобранные случаи после этого держит\n" +
    "npm run check:shoes-picker."
);
