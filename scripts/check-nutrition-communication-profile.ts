import assert from "node:assert/strict";

import { buildNutritionStudentContext } from "@/features/nutrition/context";
import { resolveStudentCommunicationProfile } from "@/features/trainingpeaks/communication-profile";
import type { TrainingPeaksStudentMemoryItem } from "@/features/trainingpeaks/repository";

function buildCommunicationStyleMemory(structured: Record<string, unknown>): TrainingPeaksStudentMemoryItem {
  return {
    id: "memory-communication",
    studentId: "student-1",
    memoryType: "communication_style",
    summaryText: "Communication style memory",
    structured,
    source: "system",
    confidence: 0.9,
    validFrom: null,
    validUntil: null,
    isActive: true,
    supersededBy: null,
    sourceObservationId: null,
    sourceMessagePreview: null,
    firstSeenAt: "2026-06-01T00:00:00.000Z",
    lastSeenAt: "2026-06-01T00:00:00.000Z",
    metadata: {},
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  };
}

async function run(): Promise<void> {
  const resolved = resolveStudentCommunicationProfile({
    telegramFormality: "vy",
    activeMemoryItems: [buildCommunicationStyleMemory({ formality: "ty", tone: "warm" })],
    telegramContextNotes: "Manual context note.",
  });
  assert.equal(resolved.formality, "vy");
  assert.equal(resolved.formalitySource, "manual");
  assert.ok(resolved.conflictFlags.includes("formality_mismatch_manual_vs_memory"));

  const studentId = process.env.NUTRITION_CHECK_STUDENT_ID?.trim();
  if (!studentId) {
    console.log("PASS check-nutrition-communication-profile (resolver assertions only; set NUTRITION_CHECK_STUDENT_ID for integration path)");
    return;
  }

  const context = await buildNutritionStudentContext({
    studentId,
    weekFrom: "2026-06-01",
    weekTo: "2026-06-07",
    manualRows: [],
  });
  assert.equal(typeof context.resolvedCommunicationProfile.formality, "string");
  assert.ok(Array.isArray(context.communicationProfilePromptLines));
  console.log("PASS check-nutrition-communication-profile");
}

void run();
