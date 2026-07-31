import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { TrainingPeaksStudentMemoryItem } from "./repository.ts";
import {
  MEMORY_FRESHNESS_WINDOW_DAYS,
  daysBetweenIso,
  isMemoryItemFresh,
} from "./memory-freshness.ts";

const AS_OF = "2026-07-31";

function item(
  overrides: Pick<TrainingPeaksStudentMemoryItem, "memoryType"> &
    Partial<Pick<TrainingPeaksStudentMemoryItem, "lastSeenAt" | "validUntil">>
): Pick<TrainingPeaksStudentMemoryItem, "memoryType" | "lastSeenAt" | "validUntil"> {
  return {
    memoryType: overrides.memoryType,
    lastSeenAt: overrides.lastSeenAt ?? `${AS_OF}T09:00:00Z`,
    validUntil: overrides.validUntil ?? null,
  };
}

describe("daysBetweenIso", () => {
  test("counts whole days regardless of order or time part", () => {
    assert.equal(daysBetweenIso("2026-07-01", "2026-07-31"), 30);
    assert.equal(daysBetweenIso("2026-07-31T23:00:00Z", "2026-07-01T00:00:00Z"), 30);
    assert.equal(daysBetweenIso("2026-07-31", "2026-07-31"), 0);
  });
  test("garbage → 0 (never throws)", () => {
    assert.equal(daysBetweenIso("nonsense", "2026-07-31"), 0);
  });
});

describe("isMemoryItemFresh", () => {
  test("health note last seen 10 days ago → fresh (window 14)", () => {
    assert.equal(isMemoryItemFresh(item({ memoryType: "health_status", lastSeenAt: "2026-07-21" }), AS_OF), true);
  });
  test("health note last seen 40 days ago → stale (window 14)", () => {
    assert.equal(isMemoryItemFresh(item({ memoryType: "health_status", lastSeenAt: "2026-06-21" }), AS_OF), false);
  });
  test("emotional note last seen 20 days ago → stale (window 14)", () => {
    assert.equal(isMemoryItemFresh(item({ memoryType: "emotional_state", lastSeenAt: "2026-07-11" }), AS_OF), false);
  });
  test("injury last seen 25 days ago → fresh (window 30)", () => {
    assert.equal(isMemoryItemFresh(item({ memoryType: "pain_or_injury", lastSeenAt: "2026-07-06" }), AS_OF), true);
  });
  test("travel last seen 25 days ago → stale (window 21)", () => {
    assert.equal(isMemoryItemFresh(item({ memoryType: "travel_or_life_event", lastSeenAt: "2026-07-06" }), AS_OF), false);
  });
  test("race goal last seen 100 days ago → fresh (window 120)", () => {
    assert.equal(isMemoryItemFresh(item({ memoryType: "race_or_goal", lastSeenAt: "2026-04-22" }), AS_OF), true);
  });
  test("communication style last seen 300 days ago → fresh (window 365)", () => {
    assert.equal(isMemoryItemFresh(item({ memoryType: "communication_style", lastSeenAt: "2025-10-04" }), AS_OF), true);
  });
  test("boundary: exactly at window → still fresh (<=)", () => {
    assert.equal(isMemoryItemFresh(item({ memoryType: "health_status", lastSeenAt: "2026-07-17" }), AS_OF), true); // 14d
  });
  test("explicit valid_until bypasses the freshness window (coach intent wins)", () => {
    // Stale by last_seen_at but coach set an explicit expiry → trusted, kept.
    assert.equal(
      isMemoryItemFresh(item({ memoryType: "health_status", lastSeenAt: "2026-01-01", validUntil: "2027-01-01" }), AS_OF),
      true
    );
  });
  test("every memory type has a window", () => {
    const types: Array<TrainingPeaksStudentMemoryItem["memoryType"]> = [
      "communication_style", "schedule_constraint", "availability_preference", "pain_or_injury",
      "health_status", "emotional_state", "load_tolerance", "planning_preference", "race_or_goal",
      "travel_or_life_event", "equipment_or_device_note",
    ];
    for (const t of types) assert.equal(typeof MEMORY_FRESHNESS_WINDOW_DAYS[t], "number", t);
  });
});
