import process from "node:process";

import { simplifyAthleteWording } from "@/features/nutrition/telegram-renderer";

// Regression guard for the athlete-wording rewriter pairs that mangled grammar when
// substituting a fixed phrase into an inflected structure (simplifyAthleteWording):
//   1) «крупян…»: rewrite only the SUBSTANTIVAL «что-то/чего-то крупяное», never the
//      ADJECTIVE «крупяной основы / крупяного гарнира» (broke the case).
//   2) «более щедр…»: must not duplicate the noun («…порцию побольше порция каши»).
//   3) «макро-вывод…»: strip only the «макро-» prefix, keep number/case («выводы такие»).
//   4) «карбов…» / «карбы» / «жировая точка зрения»: professional carb-jargon rewritten
//      to plain Russian without breaking case/number (prose-language-quality наряд).
// Each: the broken output must never appear AND the original intent still normalizes.

const LOG_PREFIX = "[check-nutrition-athlete-wording-rewriters]";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type Case = { input: string; expect: string; note: string };

const CASES: Case[] = [
  // Adjective + noun → LEFT UNTOUCHED (the reported bug).
  { input: "без крупяной основы", expect: "без крупяной основы", note: "reported bug — adjective, keep" },
  { input: "без крупяного гарнира", expect: "без крупяного гарнира", note: "adjective masc gen, keep" },
  { input: "тарелка с крупяной кашей", expect: "тарелка с крупяной кашей", note: "adjective fem, keep" },
  { input: "крупяные хлопья на завтрак", expect: "крупяные хлопья на завтрак", note: "adjective plural, keep" },
  // Substantival roundabout → STILL normalized (the original intent).
  { input: "добавь что-то крупяное", expect: "добавь какую-нибудь крупу", note: "intent — substantival, rewrite" },
  { input: "хочется чего-то крупяного", expect: "хочется какую-нибудь крупу", note: "intent — genitive substantival, rewrite" },
  {
    input: "в основе что-то крупяное или бобовое",
    expect: "в основе какую-нибудь крупу или бобовое",
    note: "intent — substantival mid-sentence, rewrite",
  },
  // Fix 2 — «более щедр…»: absorb the trailing «порци…», no duplicated noun.
  { input: "более щедрая порция каши", expect: "порцию побольше каши", note: "no «порцию побольше порция» dup" },
  { input: "более щедрую порцию овощей", expect: "порцию побольше овощей", note: "acc «порцию» absorbed too" },
  { input: "более щедрая порция", expect: "порцию побольше", note: "bare — still normalized" },
  // Fix 3 — «макро-вывод…»: strip only «макро-», keep number/case.
  { input: "макро-выводы такие", expect: "выводы такие", note: "plural preserved (not «вывод такие»)" },
  { input: "макро-вывода нет", expect: "вывода нет", note: "genitive preserved" },
  { input: "макро-вывод один", expect: "вывод один", note: "singular unchanged" },
  // Fix 4 — carb-slang «карбов…» adjective forms: strip only «карбов», keep the
  // (shared hard-stem) ending, so case/number survive exactly.
  { input: "карбовый день", expect: "углеводный день", note: "adjective masc nom" },
  { input: "карбовые дни", expect: "углеводные дни", note: "adjective plural nom" },
  { input: "карбовых дней не хватает", expect: "углеводных дней не хватает", note: "adjective plural gen" },
  { input: "карбовая загрузка", expect: "углеводная загрузка", note: "adjective fem nom" },
  { input: "с карбовой точки зрения", expect: "с углеводной точки зрения", note: "adjective fem gen/instr, generic construction" },
  // Fix 4 — bare noun forms («carbs» as a noun, not adjective).
  { input: "ешь карбы после тренировки", expect: "ешь углеводы после тренировки", note: "noun plural nom/acc" },
  { input: "недостаток карбов в этот день", expect: "недостаток углеводов в этот день", note: "noun plural gen" },
  // Fix 4 — jargon construction «с жировой точки зрения» → plain «по жирам».
  {
    input: "с жировой точки зрения день не очень",
    expect: "по жирам день не очень",
    note: "jargon construction rewritten",
  },
];

function run(): void {
  const rows: string[] = [];
  for (const testCase of CASES) {
    const got = simplifyAthleteWording(testCase.input);
    assert(
      got === testCase.expect,
      `${testCase.note}: ${JSON.stringify(testCase.input)} → expected ${JSON.stringify(testCase.expect)}, got ${JSON.stringify(got)}`
    );
    rows.push(`  ✓ ${JSON.stringify(testCase.input)} → ${JSON.stringify(got)}  (${testCase.note})`);
  }
  // Belt-and-suspenders: the exact broken fragments must never be produced.
  assert(
    !simplifyAthleteWording("без крупяной основы").includes("какую-нибудь крупу основы"),
    "must never emit the broken «какую-нибудь крупу основы»"
  );
  assert(
    !simplifyAthleteWording("более щедрая порция каши").includes("побольше порция"),
    "must never emit the duplicated «порцию побольше порция»"
  );
  assert(
    !simplifyAthleteWording("макро-выводы такие").includes("вывод такие"),
    "must never emit the number-mismatched «вывод такие»"
  );
  assert(
    !/карб/i.test(simplifyAthleteWording("карбовые дни и карбы после тренировки")),
    "must never leave any «карб-» jargon fragment in the output"
  );
  process.stdout.write(`${LOG_PREFIX} cases:\n${rows.join("\n")}\n`);
  process.stdout.write(`${LOG_PREFIX} PASS (${CASES.length} cases)\n`);
}

try {
  run();
} catch (error) {
  process.stderr.write(`${LOG_PREFIX} FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
