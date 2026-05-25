import {
  parseTrainingPeaksMoveWorkoutRequest,
  passesTrainingPeaksStrictMoveWorkoutIntentGate,
} from "@/features/trainingpeaks/service";
import { normalizeWorkoutReference } from "@/features/trainingpeaks/workout-reference";

type MoveIntentCase = {
  text: string;
  expectMoveIntent: boolean;
  expectedWorkoutKind?: "long_run" | "workout" | "intervals" | "tempo" | "unknown";
  expectedTarget?: "tomorrow";
  expectedTargetIso?: string;
  messageDateUnix?: number;
};

const cases: MoveIntentCase[] = [
  {
    text: "Привет, давай Лонг перенесем на завтра",
    expectMoveIntent: true,
    expectedWorkoutKind: "long_run",
    expectedTarget: "tomorrow",
  },
  {
    text: "Лонг давай завтра",
    expectMoveIntent: true,
    expectedWorkoutKind: "long_run",
    expectedTarget: "tomorrow",
  },
  {
    text: "перенеси длительную на завтра",
    expectMoveIntent: true,
    expectedWorkoutKind: "long_run",
    expectedTarget: "tomorrow",
  },
  {
    text: "лонг был тяжелый",
    expectMoveIntent: false,
  },
  {
    text: "завтра побегу легко",
    expectMoveIntent: false,
  },
  {
    text: "Интервалы на завтра поставьте пожалуйста",
    expectMoveIntent: true,
    expectedWorkoutKind: "intervals",
    expectedTarget: "tomorrow",
    messageDateUnix: Math.floor(Date.parse("2026-05-25T09:00:00+02:00") / 1000),
  },
  {
    text: "Поставьте интервалы на завтра",
    expectMoveIntent: true,
    expectedWorkoutKind: "intervals",
    expectedTarget: "tomorrow",
    messageDateUnix: Math.floor(Date.parse("2026-05-25T09:00:00+02:00") / 1000),
  },
  {
    text: "Можно интервалы завтра?",
    expectMoveIntent: true,
    expectedWorkoutKind: "intervals",
    expectedTarget: "tomorrow",
    messageDateUnix: Math.floor(Date.parse("2026-05-25T09:00:00+02:00") / 1000),
  },
  {
    text: "Давайте интервалы завтра",
    expectMoveIntent: true,
    expectedWorkoutKind: "intervals",
    expectedTarget: "tomorrow",
    messageDateUnix: Math.floor(Date.parse("2026-05-25T09:00:00+02:00") / 1000),
  },
  {
    text: "Отработаю интервалы завтра",
    expectMoveIntent: true,
    expectedWorkoutKind: "intervals",
    expectedTarget: "tomorrow",
    messageDateUnix: Math.floor(Date.parse("2026-05-25T09:00:00+02:00") / 1000),
  },
  {
    text: "Лучше сделаю интервалы заранее",
    expectMoveIntent: true,
    expectedWorkoutKind: "intervals",
    messageDateUnix: Math.floor(Date.parse("2026-05-25T09:00:00+02:00") / 1000),
  },
  {
    text: "Перенесите интервалы на завтра",
    expectMoveIntent: true,
    expectedWorkoutKind: "intervals",
    expectedTarget: "tomorrow",
    messageDateUnix: Math.floor(Date.parse("2026-05-25T09:00:00+02:00") / 1000),
  },
  {
    text: "Интервальную на завтра",
    expectMoveIntent: true,
    expectedWorkoutKind: "intervals",
    expectedTarget: "tomorrow",
    messageDateUnix: Math.floor(Date.parse("2026-05-25T09:00:00+02:00") / 1000),
  },
  {
    text: "6 по 6 на завтра",
    expectMoveIntent: true,
    expectedWorkoutKind: "intervals",
    expectedTarget: "tomorrow",
    messageDateUnix: Math.floor(Date.parse("2026-05-25T09:00:00+02:00") / 1000),
  },
  {
    text: "6×6 на завтра",
    expectMoveIntent: true,
    expectedWorkoutKind: "intervals",
    expectedTarget: "tomorrow",
    messageDateUnix: Math.floor(Date.parse("2026-05-25T09:00:00+02:00") / 1000),
  },
  {
    text: "Интервалы на завтра поставьте пожалуйста 🙏 Эта неделя у меня какая-то не понятная. Возможно в середине недели уеду в деревню. Лучше отработаю заранее.",
    expectMoveIntent: true,
    expectedWorkoutKind: "intervals",
    expectedTarget: "tomorrow",
    messageDateUnix: Math.floor(Date.parse("2026-05-25T09:00:00+02:00") / 1000),
  },
];

function toBelgradeIsoDate(value: Date): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  return `${year}-${month}-${day}`;
}

function resolveTomorrowFromUnix(messageDateUnix: number): string {
  const base = new Date(messageDateUnix * 1000);
  const baseIso = toBelgradeIsoDate(base);
  const [year, month, day] = baseIso.split("-").map((value) => Number(value));
  const shifted = new Date(Date.UTC(year, month - 1, day + 1, 12, 0, 0));
  return toBelgradeIsoDate(shifted);
}

async function run(): Promise<void> {
  let failed = 0;
  const previousTimezone = process.env.TZ;
  const previousBaseDate = process.env.TP_MOVE_DATE_BASE_DATE;
  process.env.TZ = "Europe/Belgrade";
  process.env.TP_MOVE_DATE_BASE_DATE = "2026-05-17";

  for (const testCase of cases) {
    const gate = passesTrainingPeaksStrictMoveWorkoutIntentGate(testCase.text);
    const workout = normalizeWorkoutReference(testCase.text);
    const parsed = testCase.expectMoveIntent
      ? await parseTrainingPeaksMoveWorkoutRequest(testCase.text, {
          messageDateUnix: testCase.messageDateUnix ?? null,
        })
      : null;

    const gateOk = gate === testCase.expectMoveIntent;
    const workoutOk =
      !testCase.expectedWorkoutKind || workout.kind === testCase.expectedWorkoutKind;

    let targetOk = true;
    if (testCase.expectMoveIntent && testCase.expectedTarget === "tomorrow") {
      const expectedFromMessageDate =
        typeof testCase.messageDateUnix === "number"
          ? resolveTomorrowFromUnix(testCase.messageDateUnix)
          : null;
      targetOk =
        parsed?.ok === true &&
        (parsed.payload.target.value === "tomorrow" ||
          parsed.payload.target.value === "2026-05-18" ||
          (expectedFromMessageDate !== null && parsed.payload.target.value === expectedFromMessageDate));
    }
    if (testCase.expectMoveIntent && testCase.expectedTargetIso) {
      targetOk = parsed?.ok === true && parsed.payload.target.kind === "date" && parsed.payload.target.value === testCase.expectedTargetIso;
    }

    const parseOk = !testCase.expectMoveIntent || parsed?.ok === true;
    const ok = gateOk && workoutOk && targetOk && parseOk;

    if (!ok) {
      failed += 1;
    }

    console.log(
      `${ok ? "PASS" : "FAIL"}: "${testCase.text}" -> ${JSON.stringify(
        {
          gate,
          workoutKind: workout.kind,
          matchedAlias: workout.matchedAlias,
          parsed: parsed
            ? parsed.ok
              ? {
                  target: parsed.payload.target,
                  workoutType: parsed.payload.workoutDescriptor?.type ?? null,
                  confidence: parsed.payload.confidence,
                }
              : { reason: parsed.reason }
            : null,
        },
        null,
        2
      )}`
    );
  }

  if (previousTimezone === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = previousTimezone;
  }
  if (previousBaseDate === undefined) {
    delete process.env.TP_MOVE_DATE_BASE_DATE;
  } else {
    process.env.TP_MOVE_DATE_BASE_DATE = previousBaseDate;
  }

  if (failed > 0) {
    process.exitCode = 1;
    console.error(`\n[check-trainingpeaks-move-intent] ${failed} check(s) failed.`);
    return;
  }

  console.log("\n[check-trainingpeaks-move-intent] PASS");
}

void run();
