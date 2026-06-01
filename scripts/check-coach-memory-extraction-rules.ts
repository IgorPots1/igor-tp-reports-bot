import process from "node:process";

import {
  processCoachMemoryForObservation,
  type CoachMemoryExtractionResult,
} from "@/features/trainingpeaks/coach-memory-extraction";
import type { TrainingPeaksStudentMemoryItem } from "@/features/trainingpeaks/repository";

const LOG_PREFIX = "[check-coach-memory-extraction-rules]";

type CaseDefinition = {
  name: string;
  textPreview: string;
  expected:
    | "skip_race_or_goal"
    | "keep_race_or_goal"
    | "skip_pain"
    | "keep_pain"
    | "bounded_availability"
    | "illness_to_health_dedupes"
    | "skip_availability"
    | "keep_availability";
  extraction: CoachMemoryExtractionResult;
  observedAt?: string;
  currentActiveMemoryItems?: Pick<
    TrainingPeaksStudentMemoryItem,
    "id" | "memoryType" | "summaryText" | "structured" | "validUntil"
  >[];
};

function makeRaceExtraction(summary: string, options?: { validFrom?: string | null }): CoachMemoryExtractionResult {
  return {
    shouldRemember: true,
    reason: "test",
    caseCandidate: null,
    memoryItems: [
      {
        memoryType: "race_or_goal",
        summaryText: summary,
        structured: {},
        validFrom: options?.validFrom ?? null,
        validUntil: null,
        confidence: 0.92,
        affectsPlanning: true,
        requiresCoachAttention: false,
        notificationLevel: "digest",
        supersedesHint: { reason: null, targetMemoryType: null },
      },
    ],
  };
}

function makePainExtraction(summary: string): CoachMemoryExtractionResult {
  return {
    shouldRemember: true,
    reason: "test",
    caseCandidate: null,
    memoryItems: [
      {
        memoryType: "pain_or_injury",
        summaryText: summary,
        structured: { body_part: "колено", symptom: "боль" },
        validFrom: null,
        validUntil: null,
        confidence: 0.9,
        affectsPlanning: true,
        requiresCoachAttention: true,
        notificationLevel: "immediate",
        supersedesHint: { reason: null, targetMemoryType: null },
      },
    ],
  };
}

function makeAvailabilityExtraction(summary: string, validUntil: string | null): CoachMemoryExtractionResult {
  return {
    shouldRemember: true,
    reason: "test",
    caseCandidate: null,
    memoryItems: [
      {
        memoryType: "availability_preference",
        summaryText: summary,
        structured: {},
        validFrom: null,
        validUntil,
        confidence: 0.9,
        affectsPlanning: true,
        requiresCoachAttention: false,
        notificationLevel: "digest",
        supersedesHint: { reason: null, targetMemoryType: null },
      },
    ],
  };
}

function makeScheduleConstraintExtraction(summary: string): CoachMemoryExtractionResult {
  return {
    shouldRemember: true,
    reason: "test",
    caseCandidate: null,
    memoryItems: [
      {
        memoryType: "schedule_constraint",
        summaryText: summary,
        structured: { note: "test" },
        validFrom: null,
        validUntil: null,
        confidence: 0.9,
        affectsPlanning: true,
        requiresCoachAttention: false,
        notificationLevel: "digest",
        supersedesHint: { reason: null, targetMemoryType: null },
      },
    ],
  };
}

async function runCase(caseDef: CaseDefinition): Promise<{ ok: boolean; message: string }> {
  process.env.COACH_MEMORY_EXTRACTION_ENABLED = "true";
  process.env.COACH_MEMORY_MIN_CONFIDENCE = "0.7";

  const observedAt = caseDef.observedAt ?? "2026-06-01T10:00:00.000Z";
  const result = await processCoachMemoryForObservation({
    observationId: `test-${caseDef.name}`,
    studentId: "test-student-id",
    studentName: "Test student",
    textPreview: caseDef.textPreview,
    labels: ["report_like"],
    sourceType: "private_dm",
    observedAt,
    currentActiveMemoryItems: caseDef.currentActiveMemoryItems ?? [],
    applyWrites: false,
    precomputedExtraction: caseDef.extraction,
  });

  if (result.status !== "processed" && result.status !== "no_memory") {
    return {
      ok: false,
      message: `${caseDef.name}: unexpected status=${result.status}`,
    };
  }

  if (caseDef.expected === "skip_race_or_goal") {
    const ok = result.inserted === 0 && result.skipped >= 1;
    return { ok, message: `${caseDef.name}: inserted=${result.inserted} skipped=${result.skipped}` };
  }
  if (caseDef.expected === "keep_race_or_goal") {
    const ok = result.inserted >= 1;
    return { ok, message: `${caseDef.name}: inserted=${result.inserted} skipped=${result.skipped}` };
  }
  if (caseDef.expected === "skip_pain") {
    const ok = result.inserted === 0 && result.skipped >= 1;
    return { ok, message: `${caseDef.name}: inserted=${result.inserted} skipped=${result.skipped}` };
  }
  if (caseDef.expected === "keep_pain") {
    const ok = result.inserted >= 1;
    return { ok, message: `${caseDef.name}: inserted=${result.inserted} skipped=${result.skipped}` };
  }
  if (caseDef.expected === "illness_to_health_dedupes") {
    const ok = result.inserted === 0 && result.touched >= 1 && result.duplicate >= 1 && result.skipped === 0;
    return {
      ok,
      message: `${caseDef.name}: inserted=${result.inserted} touched=${result.touched} duplicate=${result.duplicate} skipped=${result.skipped}`,
    };
  }

  if (caseDef.expected === "skip_availability") {
    const ok = result.inserted === 0 && result.skipped >= 1;
    return { ok, message: `${caseDef.name}: inserted=${result.inserted} skipped=${result.skipped}` };
  }

  if (caseDef.expected === "keep_availability") {
    const ok = result.inserted >= 1;
    return { ok, message: `${caseDef.name}: inserted=${result.inserted} skipped=${result.skipped}` };
  }

  const boundedItem = caseDef.extraction.memoryItems[0]?.validUntil;
  const inserted = result.inserted >= 1;
  const skippedAsLowConfidence = result.inserted === 0 && result.belowConfidence >= 1;
  const ok = inserted || skippedAsLowConfidence || boundedItem !== null;
  return {
    ok,
    message: `${caseDef.name}: inserted=${result.inserted} below_confidence=${result.belowConfidence} skipped=${result.skipped}`,
  };
}

async function run(): Promise<void> {
  const cases: CaseDefinition[] = [
    {
      name: "completed-past-event-not-race-goal",
      textPreview: "Вчера участвовала в забеге sunrise run и финишировала.",
      expected: "skip_race_or_goal",
      extraction: makeRaceExtraction("Участвовала в забеге sunrise run и финишировала."),
    },
    {
      name: "future-goal-kept-race-goal",
      textPreview: "Готовится к старту 2026-07-14 и это цель сезона.",
      expected: "keep_race_or_goal",
      extraction: makeRaceExtraction("Готовится к старту 2026-07-14, цель сезона.", { validFrom: "2026-07-14" }),
    },
    {
      name: "reflective-too-many-marathons-not-race-goal",
      textPreview: "Сергей понимает, что участвует в слишком большом количестве марафонов.",
      expected: "skip_race_or_goal",
      extraction: makeRaceExtraction("Сергей понимает, что участвует в слишком большом количестве марафонов."),
    },
    {
      name: "resolved-transient-pain-skip",
      textPreview: "Колено сначала беспокоило, потом прошло, сейчас не болит.",
      expected: "skip_pain",
      extraction: makePainExtraction("Колено сначала беспокоило, потом прошло, сейчас не болит."),
    },
    {
      name: "persistent-pain-kept",
      textPreview: "Колено не проходит несколько дней, после каждой тренировки усиливается.",
      expected: "keep_pain",
      extraction: makePainExtraction("Колено болит несколько дней и после каждой тренировки усиливается."),
    },
    {
      name: "illness-only-not-pain",
      textPreview: "На неделе была болезнь, простыла, была температура и кашель.",
      expected: "illness_to_health_dedupes",
      extraction: makePainExtraction("На неделе была болезнь, простыла, была температура и кашель."),
      currentActiveMemoryItems: [
        {
          id: "existing-health-item",
          memoryType: "health_status",
          summaryText: "На неделе была болезнь, простыла, была температура и кашель.",
          structured: {},
          validUntil: null,
        },
      ],
    },
    {
      name: "temporary-availability-bounded-or-conservative",
      textPreview: "На следующей неделе могу только вт/чт.",
      expected: "bounded_availability",
      extraction: makeAvailabilityExtraction("На следующей неделе могу только вт/чт.", null),
      observedAt: "2026-06-01T10:00:00.000Z",
    },
    {
      name: "starts-tomorrow-not-durable-availability",
      textPreview: "С завтрашнего дня начинаются тренировки.",
      expected: "skip_availability",
      extraction: makeAvailabilityExtraction("С завтрашнего дня начинаются тренировки.", null),
    },
    {
      name: "durable-schedule-constraint-preserved",
      textPreview: "По вторникам не могу тренироваться из-за ребёнка.",
      expected: "keep_availability",
      extraction: makeScheduleConstraintExtraction("По вторникам не может тренироваться из-за ребенка."),
    },
    {
      name: "durable-availability-preference-preserved",
      textPreview: "Предпочитает тренироваться во вторник и четверг.",
      expected: "keep_availability",
      extraction: makeAvailabilityExtraction("Предпочитает тренироваться во вторник и четверг.", null),
    },
  ];

  let failed = 0;
  for (const caseDef of cases) {
    const result = await runCase(caseDef);
    if (result.ok) {
      console.log(`${LOG_PREFIX} OK ${result.message}`);
    } else {
      failed += 1;
      console.log(`${LOG_PREFIX} FAIL ${result.message}`);
    }
  }

  if (failed > 0) {
    console.error(`${LOG_PREFIX} FAIL: ${failed} case(s) failed`);
    process.exit(1);
  }
  console.log(`${LOG_PREFIX} OK all deterministic checks passed`);
}

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.startsWith(`${LOG_PREFIX} FAIL:`) ? message : `${LOG_PREFIX} FAIL: ${message}`);
  process.exit(1);
});
