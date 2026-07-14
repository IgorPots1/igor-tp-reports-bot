/**
 * Silent-partial guard: a message asking for TWO moves must never produce ONE action quietly.
 *
 * Fixtures are real student messages pulled from trainingpeaks_telegram_context_observations
 * (2026-06-20 … 2026-07-14). The false-positive half matters as much as the true-positive half:
 * a single move must NOT be flagged, or the warning becomes noise and the coach stops reading it.
 */
import {
  detectUnparsedMoveRemainder,
  type MoveRemainderDetection,
} from "@/features/trainingpeaks/move-multi-intent";

type Fixture = {
  name: string;
  rawText: string;
  /** What the (single-move) parser captured, as stored in parsed_payload. */
  parsed?: {
    source?: { sourceText?: string | null } | null;
    target?: { sourceText?: string | null } | null;
  } | null;
  expectSuspected: boolean;
};

const fixtures: Fixture[] = [
  // ── MUST be flagged: the request carries more than one move ──────────────────────────────────
  {
    // The case that shipped half: action 7a12538b moved the easy run 14→15 and dropped the intervals.
    name: "Nadezhda Semeshina 2026-07-14 — two moves, one action created",
    rawText:
      "Игорь,добрый вечер!Перенесите,пожалуйста,легкую тренировку сегодня на завтра,а интервальную на четверг🙏",
    parsed: { source: { sourceText: "сегодня" }, target: { sourceText: "завтра" } },
    expectSuspected: true,
  },
  {
    // Action 771a52f7 took "2 июля" (the DEPARTURE date) as the target and dropped the rest.
    name: "Maria Zueva 2026-06-28 — «с 30 на 29 и с 2 на 1»",
    rawText:
      "Привет , а можно мне перенести тренировки ? \nя просто уеду 2 июля и чтобы не пропускать, с 30 на 29 и с 2 на 1? 🥹",
    parsed: { source: null, target: { sourceText: "2 июля" } },
    expectSuspected: true,
  },
  {
    name: "two spelled-out instructions, two verbs",
    rawText: "перенеси лёгкую на завтра, а интервальную переставь на четверг",
    parsed: { source: null, target: { sourceText: "завтра" } },
    expectSuspected: true,
  },
  {
    // No workout noun in the tail at all — the «на <day>» shape alone must carry it.
    name: "«а вторую на пятницу» — second instruction without a workout noun",
    rawText: "перенесите первую тренировку на четверг, а вторую на пятницу",
    parsed: { source: null, target: { sourceText: "четверг" } },
    expectSuspected: true,
  },
  {
    name: "explicit «а ещё» second instruction",
    rawText: "перенесите тренировку с понедельника на вторник, а ещё длительную на воскресенье",
    parsed: { source: { sourceText: "понедельника" }, target: { sourceText: "вторник" } },
    expectSuspected: true,
  },

  // ── MUST NOT be flagged: one move, fully parsed. A false warning here is noise. ───────────────
  {
    // Demian's move that DID work (action 99caa0fd, executed for real 2026-06-20).
    name: "Demian Diachenko 2026-06-20 — single move that worked",
    rawText: "Здравствуйте Игорь.  Перенесите пожалуйста на завтра тренировку",
    parsed: { source: null, target: { sourceText: "завтра" } },
    expectSuspected: false,
  },
  {
    // Demian 2026-07-14 — the message that was rejected outright (task 3 fixes the gate for it).
    // It is a SINGLE move: once the gate lets it through, it must not also get a partial warning.
    name: "Demian Diachenko 2026-07-14 — single move, verb-only object",
    rawText: "Здравствуйте Игорь точка сегодня Не побегу точка переставьте на завтра пожалуйста",
    parsed: { source: { sourceText: "сегодня" }, target: { sourceText: "завтра" } },
    expectSuspected: false,
  },
  {
    name: "plain single move",
    rawText: "перенеси интервальную на завтра",
    parsed: { source: null, target: { sourceText: "завтра" } },
    expectSuspected: false,
  },
  {
    name: "single move with a source day",
    rawText: "перенесите тренировку с понедельника на вторник",
    parsed: { source: { sourceText: "понедельника" }, target: { sourceText: "вторник" } },
    expectSuspected: false,
  },
  {
    name: "single move by day numbers — «с 30 на 29» alone is ONE move",
    rawText: "перенесите пожалуйста с 30 на 29",
    parsed: { source: { sourceText: "30" }, target: { sourceText: "29" } },
    expectSuspected: false,
  },
  {
    // «а то» is not a second instruction — the tail carries neither a day nor a workout.
    name: "trailing «а то …» excuse, not a second move",
    rawText: "перенесите тренировку на завтра, а то я сегодня совсем не успеваю",
    parsed: { source: null, target: { sourceText: "завтра" } },
    expectSuspected: false,
  },
  {
    // Two workout words for ONE workout — must not read as two objects.
    name: "one workout named twice («длительную тренировку»)",
    rawText: "перенеси длительную тренировку на завтра",
    parsed: { source: null, target: { sourceText: "завтра" } },
    expectSuspected: false,
  },
];

function describe(result: MoveRemainderDetection): string {
  return result.suspected
    ? `suspected (${result.reason}) → «${result.remainderPreview ?? ""}»`
    : "not suspected";
}

async function run(): Promise<void> {
  let failed = 0;

  for (const fixture of fixtures) {
    const result = detectUnparsedMoveRemainder({
      rawText: fixture.rawText,
      parsed: fixture.parsed ?? null,
    });

    if (result.suspected !== fixture.expectSuspected) {
      failed += 1;
      console.log(
        `FAIL: ${fixture.name}\n  expected: ${fixture.expectSuspected ? "suspected" : "not suspected"}\n  actual:   ${describe(result)}\n  text:     «${fixture.rawText.replace(/\s+/g, " ").trim()}»`
      );
      continue;
    }

    console.log(`ok: ${fixture.name} → ${describe(result)}`);
  }

  if (failed > 0) {
    console.log(`\n${failed} check(s) failed.`);
    process.exit(1);
  }

  console.log(`\nAll ${fixtures.length} multi-move detector checks passed.`);
}

void run();
