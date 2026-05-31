import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  parseTrainingPeaksMoveWorkoutRequest,
  passesTrainingPeaksStrictMoveWorkoutIntentGate,
  type ParseTrainingPeaksMoveWorkoutResult,
  type TrainingPeaksMoveWorkoutDescriptor,
} from "@/features/trainingpeaks/service";

type PhraseCase = {
  id: string;
  category: string;
  input: string;
  baseDate: string;
  expectedIntentGatePass: boolean;
  expectedParseOk: boolean;
  expectedSourceDate: string | null;
  expectedTargetDate: string | null;
  expectedWorkoutKind: TrainingPeaksMoveWorkoutDescriptor["type"] | null;
  knownCurrentFailure?: boolean;
  notes?: string;
};

type CaseOutcome = "PASS" | "KNOWN FAIL" | "FAIL";

type CaseEvaluation = {
  id: string;
  category: string;
  outcome: CaseOutcome;
  reasons: string[];
};

function readCasesFromFixture(): PhraseCase[] {
  const repoRoot = process.cwd();
  const fixturePath = path.join(repoRoot, "fixtures", "trainingpeaks", "move-phrases.ru.json");
  const raw = fs.readFileSync(fixturePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error("Fixture must contain an array");
  }

  return parsed as PhraseCase[];
}

function getActualSourceDate(result: ParseTrainingPeaksMoveWorkoutResult): string | null {
  if (!result.ok) {
    return null;
  }
  const source = result.payload.source;
  if (!source) {
    return null;
  }
  return source.kind === "date" ? source.value : null;
}

function getActualTargetDate(result: ParseTrainingPeaksMoveWorkoutResult): string | null {
  if (!result.ok) {
    return null;
  }
  const target = result.payload.target;
  return target.kind === "date" ? target.value : null;
}

function getActualWorkoutKind(result: ParseTrainingPeaksMoveWorkoutResult): TrainingPeaksMoveWorkoutDescriptor["type"] | null {
  if (!result.ok) {
    return null;
  }
  return result.payload.workoutDescriptor?.type ?? null;
}

function evaluateCase(testCase: PhraseCase, gatePass: boolean, parseResult: ParseTrainingPeaksMoveWorkoutResult): CaseEvaluation {
  const reasons: string[] = [];

  const parseOk = parseResult.ok;
  const sourceDate = getActualSourceDate(parseResult);
  const targetDate = getActualTargetDate(parseResult);
  const workoutKind = getActualWorkoutKind(parseResult);

  if (gatePass !== testCase.expectedIntentGatePass) {
    reasons.push(`intentGate expected=${String(testCase.expectedIntentGatePass)} actual=${String(gatePass)}`);
  }
  if (parseOk !== testCase.expectedParseOk) {
    reasons.push(`parseOk expected=${String(testCase.expectedParseOk)} actual=${String(parseOk)}`);
  }
  if (sourceDate !== testCase.expectedSourceDate) {
    reasons.push(`sourceDate expected=${String(testCase.expectedSourceDate)} actual=${String(sourceDate)}`);
  }
  if (targetDate !== testCase.expectedTargetDate) {
    reasons.push(`targetDate expected=${String(testCase.expectedTargetDate)} actual=${String(targetDate)}`);
  }
  if (workoutKind !== testCase.expectedWorkoutKind) {
    reasons.push(`workoutKind expected=${String(testCase.expectedWorkoutKind)} actual=${String(workoutKind)}`);
  }

  if (reasons.length === 0) {
    return {
      id: testCase.id,
      category: testCase.category,
      outcome: "PASS",
      reasons,
    };
  }

  if (testCase.knownCurrentFailure) {
    return {
      id: testCase.id,
      category: testCase.category,
      outcome: "KNOWN FAIL",
      reasons,
    };
  }

  return {
    id: testCase.id,
    category: testCase.category,
    outcome: "FAIL",
    reasons,
  };
}

async function run(): Promise<void> {
  const cases = readCasesFromFixture();
  const previousBaseDate = process.env.TP_MOVE_DATE_BASE_DATE;
  const previousOpenAiKey = process.env.OPENAI_API_KEY;

  let passed = 0;
  let knownFailures = 0;
  let failed = 0;

  process.env.OPENAI_API_KEY = "";

  try {
    for (const testCase of cases) {
      process.env.TP_MOVE_DATE_BASE_DATE = testCase.baseDate;

      const gatePass = passesTrainingPeaksStrictMoveWorkoutIntentGate(testCase.input);
      const parseResult = await parseTrainingPeaksMoveWorkoutRequest(testCase.input);
      const evaluation = evaluateCase(testCase, gatePass, parseResult);

      if (evaluation.outcome === "PASS") {
        passed += 1;
        console.log(`PASS [${testCase.id}] (${testCase.category})`);
        continue;
      }

      if (evaluation.outcome === "KNOWN FAIL") {
        knownFailures += 1;
        console.log(`KNOWN FAIL [${testCase.id}] (${testCase.category}) - ${evaluation.reasons.join("; ")}`);
        continue;
      }

      failed += 1;
      console.log(`FAIL [${testCase.id}] (${testCase.category}) - ${evaluation.reasons.join("; ")}`);
    }
  } finally {
    if (previousBaseDate === undefined) {
      delete process.env.TP_MOVE_DATE_BASE_DATE;
    } else {
      process.env.TP_MOVE_DATE_BASE_DATE = previousBaseDate;
    }

    if (previousOpenAiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = previousOpenAiKey;
    }
  }

  const total = cases.length;
  console.log("\nSummary:");
  console.log(`total: ${total}`);
  console.log(`passed: ${passed}`);
  console.log(`knownFailures: ${knownFailures}`);
  console.log(`failed: ${failed}`);

  process.exit(failed > 0 ? 1 : 0);
}

void run();
