import process from "node:process";

import {
  classifySilentSkipDiagnosticSubBucket,
  type SilentSkipDiagnosticSubBucket,
} from "@/features/trainingpeaks/tp-signals-review-buckets-helpers";

const LOG_PREFIX = "[check:tp-signals-review-buckets]";

type CheckCase = {
  name: string;
  text: string;
  metadata?: Record<string, unknown>;
  expectRetained: boolean;
  expectSubBucket?: SilentSkipDiagnosticSubBucket;
};

const CASES: CheckCase[] = [
  {
    name: "Sorokin-style illness onset + move request",
    text: "заболевать начала, горло болит, интервалы перенесу на завтра",
    expectRetained: true,
    expectSubBucket: "review_candidate_mixed_health_schedule",
  },
  {
    name: "Rizatdinova soft context okay",
    text: "В сон клонит , а так норм )",
    expectRetained: false,
    expectSubBucket: "soft_context_ok_to_skip",
  },
  {
    name: "negated symptom — nothing hurts",
    text: "ничего не болит, тренировку сделала",
    expectRetained: false,
    expectSubBucket: "negated_symptom_ok_to_skip",
  },
  {
    name: "negated symptom — no pain",
    text: "боли нет, все хорошо",
    expectRetained: false,
    expectSubBucket: "negated_symptom_ok_to_skip",
  },
  {
    name: "negated symptom — throat not hurting",
    text: "горло не болит",
    expectRetained: false,
    expectSubBucket: "negated_symptom_ok_to_skip",
  },
  {
    name: "positive throat pain + reschedule retained",
    text: "горло болит, тренировку перенесу",
    expectRetained: true,
    expectSubBucket: "review_candidate_mixed_health_schedule",
  },
  {
    name: "coach question text pattern",
    text: "как горло?",
    expectRetained: false,
    expectSubBucket: "coach_question_ok_to_skip",
  },
  {
    name: "coach-authored metadata",
    text: "болит колено",
    metadata: { senderRole: "coach" },
    expectRetained: false,
    expectSubBucket: "coach_question_ok_to_skip",
  },
  {
    name: "ambiguous operational cue stays candidate",
    text: "может на этой неделе не получится с бегом, пока не уверена",
    expectRetained: true,
    expectSubBucket: "ambiguous_review_candidate",
  },
];

function run(): void {
  const failures: string[] = [];

  for (const testCase of CASES) {
    const result = classifySilentSkipDiagnosticSubBucket({
      text: testCase.text,
      metadata: testCase.metadata ?? null,
    });
    const retained = !result.suppressFromCandidateSurfacing;

    if (retained !== testCase.expectRetained) {
      failures.push(
        `${testCase.name}: expected retained=${String(testCase.expectRetained)} got ${String(retained)} (${result.diagnosticSubBucket})`
      );
      continue;
    }
    if (testCase.expectSubBucket && result.diagnosticSubBucket !== testCase.expectSubBucket) {
      failures.push(
        `${testCase.name}: expected sub-bucket ${testCase.expectSubBucket} got ${result.diagnosticSubBucket}`
      );
    }
  }

  console.log(`${LOG_PREFIX} cases=${CASES.length}`);
  for (const testCase of CASES) {
    const result = classifySilentSkipDiagnosticSubBucket({
      text: testCase.text,
      metadata: testCase.metadata ?? null,
    });
    console.log(
      `- ${testCase.name}: ${result.diagnosticSubBucket} retained=${String(!result.suppressFromCandidateSurfacing)}`
    );
  }

  if (failures.length > 0) {
    console.error(`${LOG_PREFIX} FAIL`);
    for (const failure of failures) {
      console.error(`  • ${failure}`);
    }
    process.exit(1);
  }

  console.log(`${LOG_PREFIX} PASS (${CASES.length}/${CASES.length})`);
}

run();
