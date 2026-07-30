// READ-ONLY before/after for the move-intent gate extension (naryad #3). BEFORE = real gate.
// AFTER_A = real gate OR a proposed extension (future-tense/1st-person MOVE verbs + workout ref +
// target). Prints the delta so we can judge whether new candidates are real moves or intent noise.
//
// Run: node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
//        --env-file=.env.local scripts/prove-move-gate-cost.ts
import { createSupabaseServerClient } from "@/features/supabase/server";
import { passesTrainingPeaksStrictMoveWorkoutIntentGate } from "@/features/trainingpeaks/service";
import { hasRecognizedWorkoutReference } from "@/features/trainingpeaks/workout-reference";

const norm = (s: string) => s.toLocaleLowerCase("ru").replace(/ё/g, "е").replace(/\s+/g, " ").trim();
const EXT_MOVE_VERB = /(?:^|[\s,.!?])(?:перенесу|переставлю|передвину|сдвину|перенесем|перенесём|подвину)(?:[\s,.!?]|$)/u;
const TARGET = /(?:завтра|послезавтра|сегодня|понедельник|вторник|сред[ауы]|четверг|пятниц|суббот|воскресен|\d{1,2}[./]\d{1,2}|\d{4}-\d{2}-\d{2})/u;
const INTENT_NOISE = /(?:^|[\s,.!?])(?:побегу|пробегу|сделаю|буду\s+бегать|выйду|планиру)/u;
const proposedExtA = (text: string): boolean => {
  const n = norm(text);
  return EXT_MOVE_VERB.test(n) && hasRecognizedWorkoutReference(text) && TARGET.test(n);
};

type Sb = ReturnType<typeof createSupabaseServerClient>;
async function pageAll<T>(sb: Sb, table: string, cols: string, sinceIso: string): Promise<T[]> {
  const out: T[] = []; let from = 0; const size = 1000;
  for (;;) {
    const { data, error } = await sb.from(table).select(cols).gte("created_at", sinceIso).range(from, from + size - 1);
    if (error) throw new Error(error.message);
    const rows = (data as T[]) ?? []; out.push(...rows);
    if (rows.length < size) break; from += size;
  }
  return out;
}

async function main() {
  const sb = createSupabaseServerClient();
  const since = new Date(Date.now() - 56 * 86400000).toISOString();
  const obs = await pageAll<{ text_preview: string | null; source_type: string; created_at: string }>(
    sb, "trainingpeaks_telegram_context_observations", "text_preview, source_type, created_at", since);
  const group = obs.filter((o) => String(o.source_type).startsWith("group") && o.text_preview);

  let before = 0, afterA = 0, intentNoise = 0;
  const deltaA: string[] = [];
  for (const o of group) {
    const text = o.text_preview!;
    const b = passesTrainingPeaksStrictMoveWorkoutIntentGate(text);
    const a = b || proposedExtA(text);
    if (b) before++;
    if (a) afterA++;
    if (a && !b) deltaA.push(`${o.created_at.slice(0, 10)} «${text.slice(0, 72)}»`);
    if (!b && INTENT_NOISE.test(norm(text)) && TARGET.test(norm(text))) intentNoise++;
  }
  console.log(`Групповых сообщений за 56д: ${group.length}`);
  console.log(`BEFORE (текущий гейт): ${before} move-кандидатов`);
  console.log(`AFTER_A (+будущее время move-глаголов): ${afterA}  (delta +${afterA - before})`);
  console.log(`\nНОВЫЕ кандидаты от A (выигрыш — реальные переносы?):`);
  console.log(deltaA.length ? deltaA.map((d) => "  " + d).join("\n") : "  (нет)");
  console.log(`\nШУМ-риск расширения B («сделаю/побегу»+день, не пойманы текущим): ${intentNoise}`);

  console.log(`\n=== Формы Игоря + контрпримеры ===`);
  const probes: [string, string][] = [
    ["сегодняшнюю сделаю завтра", "перенос (source=сегодняшнюю)"],
    ["завтра перенесу на послезавтра", "перенос (verb=перенесу)"],
    ["Игорь, перенесу завтрашнюю длительную на среду", "перенос, явный object"],
    ["побегу завтра", "НАМЕРЕНИЕ (нет source)"],
    ["завтра сделаю длительную", "НАМЕРЕНИЕ (один день)"],
    ["на выходных сделаю длинную", "НАМЕРЕНИЕ"],
  ];
  for (const [t, label] of probes) {
    const b = passesTrainingPeaksStrictMoveWorkoutIntentGate(t);
    const a = b || proposedExtA(t);
    console.log(`  before=${b ? "✓" : "·"} afterA=${a ? "✓" : "·"}  «${t}»  [${label}]`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
