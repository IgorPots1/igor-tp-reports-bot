import assert from "node:assert/strict";

import {
  buildResolvedCommunicationProfilePromptLines,
  resolveStudentCommunicationProfile,
} from "@/features/trainingpeaks/communication-profile";
import type { TrainingPeaksStudentMemoryItem } from "@/features/trainingpeaks/repository";

function buildCommunicationStyleMemory(structured: Record<string, unknown>): TrainingPeaksStudentMemoryItem {
  return {
    id: "memory-1",
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

function run(): void {
  {
    const resolved = resolveStudentCommunicationProfile({
      telegramFormality: "vy",
      activeMemoryItems: [buildCommunicationStyleMemory({ formality: "ty" })],
    });
    assert.equal(resolved.formality, "vy");
    assert.equal(resolved.formalitySource, "manual");
    assert.ok(resolved.conflictFlags.includes("formality_mismatch_manual_vs_memory"));
  }

  {
    const resolved = resolveStudentCommunicationProfile({
      telegramFormality: "ty",
      activeMemoryItems: [buildCommunicationStyleMemory({ formality: "vy" })],
    });
    assert.equal(resolved.formality, "ty");
    assert.equal(resolved.formalitySource, "manual");
    assert.ok(resolved.conflictFlags.includes("formality_mismatch_manual_vs_memory"));
  }

  {
    const resolved = resolveStudentCommunicationProfile({
      telegramFormality: "unknown",
      activeMemoryItems: [buildCommunicationStyleMemory({ formality: "vy" })],
    });
    assert.equal(resolved.formality, "vy");
    assert.equal(resolved.formalitySource, "communication_style_memory");
  }

  {
    const resolved = resolveStudentCommunicationProfile({
      telegramFormality: "unknown",
      activeMemoryItems: [],
    });
    assert.equal(resolved.formality, "unknown");
    assert.equal(resolved.formalitySource, "unknown");
  }

  {
    const resolved = resolveStudentCommunicationProfile({
      telegramFormality: "unknown",
      telegramContextNotes: "  prefers short replies after evening sessions  ",
      activeMemoryItems: [],
    });
    assert.equal(resolved.notes, "prefers short replies after evening sessions");
    const promptLines = buildResolvedCommunicationProfilePromptLines(resolved);
    assert.ok(promptLines.some((line) => line.includes("notes: prefers short replies after evening sessions")));
  }

  {
    const resolved = resolveStudentCommunicationProfile({
      telegramFormality: "vy",
      activeMemoryItems: [
        buildCommunicationStyleMemory({
          formality: "vy",
          preferred_greeting: "Привет",
          tone: "warm",
        }),
      ],
    });
    assert.equal(resolved.formality, "vy");
    assert.equal(resolved.formalitySource, "manual");
    assert.equal(resolved.preferredGreeting, null);
    assert.ok(resolved.conflictFlags.includes("preferred_greeting_conflicts_with_manual_formality"));
  }

  console.log("PASS check-trainingpeaks-reply-draft-communication-profile");
}

run();
