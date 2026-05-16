import { parseTrainingPeaksMoveWorkoutRequest } from "@/features/trainingpeaks/service";

type Case = {
  text: string;
  expectOk: boolean;
};

const cases: Case[] = [
  { text: "перенеси тренировку с 15 мая на 16 мая", expectOk: true },
  { text: "перенеси бег с четверга на пятницу", expectOk: true },
  { text: "переставь легкую на субботу", expectOk: true },
  { text: "завтрашнюю интервальную перенеси на воскресенье", expectOk: true },
  { text: "перенеси тренировку", expectOk: false },
  { text: "завтра или в пятницу", expectOk: false },
  { text: "сегодня не успеваю, можно завтра?", expectOk: true },
];

async function run(): Promise<void> {
  let failed = 0;

  for (const testCase of cases) {
    const result = await parseTrainingPeaksMoveWorkoutRequest(testCase.text);
    const ok = result.ok === testCase.expectOk;
    if (!ok) {
      failed += 1;
    }

    const badge = ok ? "PASS" : "FAIL";
    const details = result.ok
      ? JSON.stringify(
          {
            source: result.payload.source,
            target: result.payload.target,
            workoutDescriptor: result.payload.workoutDescriptor,
            confidence: result.payload.confidence,
            needsClarification: result.payload.needsClarification,
            parser: result.payload.parser,
          },
          null,
          2
        )
      : JSON.stringify({ reason: result.reason });
    console.log(`${badge}: "${testCase.text}" -> ${details}`);
  }

  if (failed > 0) {
    process.exitCode = 1;
    console.error(`\n${failed} parser checks failed.`);
    return;
  }

  console.log("\nAll parser checks passed.");
}

void run();
