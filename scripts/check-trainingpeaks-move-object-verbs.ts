/**
 * The strict move gate demands verb AND workout-object AND target-day, all three. Students who
 * dictate their messages speak in verbs and never say the noun — so a real request was rejected
 * ("сегодня не побегу, переставьте на завтра", Demian, 2026-07-14) while the same student's request
 * a month earlier, which happened to contain the word «тренировку», executed fine.
 *
 * Verb forms are now accepted as the object. This file exists to prove that widening did NOT turn
 * training reports into move requests — the false-positive fixtures are the point, and they are real
 * messages from the same student's chat.
 *
 * Offline: pure functions, no DB, no network, no AI.
 */
import { passesTrainingPeaksStrictMoveWorkoutIntentGate } from "@/features/trainingpeaks/service";
import {
  hasRecognizedWorkoutReference,
  normalizeWorkoutReference,
} from "@/features/trainingpeaks/workout-reference";
import { hasTrainingPeaksMessageIntentLoggingRelevance } from "@/features/trainingpeaks/message-intent-log";

type GateFixture = {
  name: string;
  text: string;
  expectPasses: boolean;
};

const gateFixtures: GateFixture[] = [
  // ── MUST now pass: a genuine reschedule request whose object is a verb ───────────────────────
  {
    // The message this whole change exists for. Rejected as `no_move_intent` on 2026-07-14.
    name: "Demian 2026-07-14 — «сегодня Не побегу … переставьте на завтра»",
    text: "Здравствуйте Игорь точка сегодня Не побегу точка переставьте на завтра пожалуйста",
    expectPasses: true,
  },
  {
    name: "verb object, infinitive — «перенесите, завтра не смогу побегать»",
    text: "перенесите пожалуйста на среду, завтра не смогу побегать",
    expectPasses: true,
  },

  // ── MUST still pass: unchanged behaviour on noun-shaped requests ─────────────────────────────
  {
    // Demian's request that DID work (action 99caa0fd, executed for real).
    name: "Demian 2026-06-20 — «Перенесите пожалуйста на завтра тренировку»",
    text: "Здравствуйте Игорь.  Перенесите пожалуйста на завтра тренировку",
    expectPasses: true,
  },
  {
    name: "Nadezhda 2026-07-14 — «Перенесите … легкую тренировку сегодня на завтра …»",
    text: "Игорь,добрый вечер!Перенесите,пожалуйста,легкую тренировку сегодня на завтра,а интервальную на четверг🙏",
    expectPasses: true,
  },

  // ── MUST NOT pass: reports and chatter. These are the fixtures that matter. ──────────────────
  {
    // Real message, Demian 2026-07-09. Contains «бегать» AND «побегу» AND «сегодня» — everything
    // except a reschedule verb. If the gate ever opens on this, every training report becomes a move.
    name: "Demian 2026-07-09 report — «Сегодня буду бегать. Но я интервалы Не побегу…»",
    text: "Здравствуйте Игорь. Сегодня буду бегать. Но я интервалы Не побегу а сбегаю через налегке чтобы войти в колею",
    expectPasses: false,
  },
  {
    // Real message, Demian 2026-07-09.
    name: "Demian 2026-07-09 report — «Пробежал Игорь 45 минут»",
    text: "Пробежал Игорь 45 минут. Больше не бегал. В принципе нормально.",
    expectPasses: false,
  },
  {
    // Real message, Demian 2026-07-07 — a heads-up, not a request. No reschedule verb.
    name: "Demian 2026-07-07 — «Сегодня не смогу побежать. Возможно завтра, но не точно»",
    text: "Здравствуйте Игорь. Сегодня не смогу побежать. Возможно завтра, но не точно",
    expectPasses: false,
  },
  {
    name: "casual blocklist — «я сегодня не бегу»",
    text: "я сегодня не бегу",
    expectPasses: false,
  },
  {
    name: "casual blocklist — «завтра пробегу»",
    text: "завтра пробегу",
    expectPasses: false,
  },
  {
    name: "no target day — «перенесите пожалуйста, не побегу»",
    text: "перенесите пожалуйста, не побегу",
    expectPasses: false,
  },
];

let failed = 0;

console.log("── strict move gate ──");
for (const fixture of gateFixtures) {
  const passes = passesTrainingPeaksStrictMoveWorkoutIntentGate(fixture.text);
  if (passes !== fixture.expectPasses) {
    failed += 1;
    console.log(
      `FAIL: ${fixture.name}\n  expected gate: ${fixture.expectPasses ? "PASS" : "REJECT"}\n  actual gate:   ${passes ? "PASS" : "REJECT"}`
    );
    continue;
  }
  console.log(`ok: ${fixture.name} → ${passes ? "PASS" : "REJECT"}`);
}

console.log("\n── verb forms recognised as an object, at LOW confidence ──");
for (const verb of ["побегу", "пробегу", "побегать", "бежать", "сбегаю"]) {
  const reference = normalizeWorkoutReference(`сегодня не ${verb}`);
  if (!hasRecognizedWorkoutReference(`сегодня не ${verb}`) || reference.confidence !== "low") {
    failed += 1;
    console.log(`FAIL: «${verb}» must be a recognised object at low confidence, got ${JSON.stringify(reference)}`);
    continue;
  }
  console.log(`ok: «${verb}» → kind=${reference.kind}, confidence=${reference.confidence}`);
}

console.log("\n── past tense is NOT an object (reports must stay reports) ──");
for (const verb of ["пробежал", "побегал", "бегал", "пробежала"]) {
  if (hasRecognizedWorkoutReference(`вчера ${verb} 45 минут`)) {
    failed += 1;
    console.log(`FAIL: past tense «${verb}» must NOT be recognised as a workout object`);
    continue;
  }
  console.log(`ok: «${verb}» → not an object`);
}

console.log("\n── log-triage relevance must be unchanged by verb forms ──");
// Relevance demands confidence !== "low", so verb-only messages must not start flooding triage.
const verbOnlyRelevance = hasTrainingPeaksMessageIntentLoggingRelevance("сегодня не побегу", []);
if (verbOnlyRelevance) {
  failed += 1;
  console.log("FAIL: a verb-only message must not gain log-triage relevance (it would flood the queue)");
} else {
  console.log("ok: verb-only message does not gain log-triage relevance");
}

if (failed > 0) {
  console.log(`\n${failed} check(s) failed.`);
  process.exit(1);
}

console.log(`\nAll move-object verb-form checks passed.`);
