import process from "node:process";

import {
  evaluateHealthSignalMemoryDoubt,
  type HealthSignalMemoryDoubtPattern,
  type HealthSignalMemoryReconcileMemoryItem,
  type HealthSignalMemoryReconcileSignal,
} from "@/features/trainingpeaks/health-signal-memory-reconcile";

// Fixtures are the REAL live rows behind the 2026-07-06 audit (5 case students), captured read-only
// via Supabase MCP. Deterministic — runs with no DB. Proves the memory→signal doubt marking matches
// hand-verified truth, and that Sofia Vlasova (legit, improving) is never flagged.

const LOG_PREFIX = "[check-health-signal-memory-reconcile]";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function mem(
  overrides: Partial<HealthSignalMemoryReconcileMemoryItem> &
    Pick<HealthSignalMemoryReconcileMemoryItem, "memoryType" | "summaryText" | "sourceObservationId">
): HealthSignalMemoryReconcileMemoryItem {
  return {
    id: overrides.id ?? `mem-${Math.abs(hashLite(overrides.summaryText))}`,
    confidence: overrides.confidence ?? null,
    ...overrides,
  };
}

function hashLite(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) {
    h = (h * 31 + text.charCodeAt(i)) | 0;
  }
  return h;
}

type Case = {
  name: string;
  signal: HealthSignalMemoryReconcileSignal;
  memoryItems: HealthSignalMemoryReconcileMemoryItem[];
  expectPattern: HealthSignalMemoryDoubtPattern | null;
  expectTier?: "weak" | "medium" | "strong";
};

const CASES: Case[] = [
  {
    // Filip Krasavin — «коллеги из хлеба заболели оба». No memory on the source message at all.
    name: "Filip — colleagues sick, no health memory on message",
    signal: {
      id: "8ae0d51f",
      signalType: "health_issue_started",
      structuredPayload: { health_issue_kind: "illness" },
      sourceObservationId: "ed466260",
    },
    memoryItems: [
      // His actual memory came from OTHER messages, not this one.
      mem({ memoryType: "schedule_constraint", summaryText: "истощён после смены", sourceObservationId: "other-1", confidence: 0.7 }),
      mem({ memoryType: "load_tolerance", summaryText: "чуть тяжелее обычного", sourceObservationId: "other-2", confidence: 0.7 }),
    ],
    expectPattern: "no_health_corroboration",
    expectTier: "weak",
  },
  {
    // Olesya Voronina — knee pain from cycling, already ran. kind=pain_or_injury + pain memory 0.95.
    name: "Olesya — knee pain mislabelled illness",
    signal: {
      id: "2cd274e4",
      signalType: "health_issue_started",
      structuredPayload: { health_issue_kind: "pain_or_injury", health_state: "sick" },
      sourceObservationId: "9c4b8dfc",
    },
    memoryItems: [
      mem({
        id: "b4d9b753",
        memoryType: "pain_or_injury",
        summaryText: "После интенсивного цикла болело колено; отдохнула 2 дня, сегодня смогла пробежать.",
        sourceObservationId: "9c4b8dfc",
        confidence: 0.95,
      }),
    ],
    expectPattern: "pain_not_illness",
    expectTier: "medium",
  },
  {
    // Erik Yashin — terse «болит из-за трассы». kind=pain_unspecified, no same-message memory.
    name: "Erik — pain from course, kind=pain_unspecified",
    signal: {
      id: "30b9836d",
      signalType: "health_issue_started",
      structuredPayload: { health_issue_kind: "pain_unspecified", evidence_level: "ambiguous_malaise" },
      sourceObservationId: "4184a40c",
    },
    memoryItems: [],
    expectPattern: "pain_not_illness",
    expectTier: "medium",
  },
  {
    // Yulia Kuznetsova — «всё хорошо, взяла неделю отдыха, чуть приболела по женски».
    name: "Kuznetsova — self-chosen rest week, по женски",
    signal: {
      id: "75dfb873",
      signalType: "health_issue_started",
      structuredPayload: { health_issue_kind: "illness", health_state: "sick" },
      sourceObservationId: "2a05fae6",
    },
    memoryItems: [
      mem({
        id: "b99f6380",
        memoryType: "health_status",
        summaryText: "Взяла неделю отдыха из-за женских дел (менструальный цикл).",
        sourceObservationId: "2a05fae6",
        confidence: 0.85,
      }),
    ],
    expectPattern: "self_chosen_pause",
    expectTier: "weak",
  },
  {
    // Sofia Vlasova — LEGIT, recovering. signalType is health_issue_improving → never flagged.
    name: "Sofia — improving, must NOT be flagged (safety)",
    signal: {
      id: "6cbee54b",
      signalType: "health_issue_improving",
      structuredPayload: { health_issue_kind: "illness", health_state: "improving", symptoms: ["cough"] },
      sourceObservationId: "632bb90d",
    },
    memoryItems: [
      mem({
        id: "c8655ec8",
        memoryType: "health_status",
        summaryText: "Кашель остался после болезни, выздоравливает.",
        sourceObservationId: "632bb90d",
        confidence: 0.95,
      }),
    ],
    expectPattern: null,
  },
  // ── Synthetic guards ───────────────────────────────────────────────────────────────────────
  {
    // Pattern 3 positive: same-message memory says the problem is over → strong doubt.
    name: "guard — resolved-in-same-message fires strong",
    signal: {
      id: "synthetic-resolved",
      signalType: "health_issue_started",
      structuredPayload: { health_issue_kind: "illness" },
      sourceObservationId: "obs-r",
    },
    memoryItems: [
      mem({
        memoryType: "pain_or_injury",
        summaryText: "Колено не болит; восстановление успешно.",
        sourceObservationId: "obs-r",
        confidence: 0.95,
      }),
    ],
    expectPattern: "already_resolved",
    expectTier: "strong",
  },
  {
    // Sofia-style IMPROVING memory on a health_issue_started must NOT read as resolved.
    name: "guard — improving cue is not 'resolved'",
    signal: {
      id: "synthetic-improving",
      signalType: "health_issue_started",
      structuredPayload: { health_issue_kind: "illness" },
      sourceObservationId: "obs-i",
    },
    memoryItems: [
      mem({
        memoryType: "health_status",
        summaryText: "Кашель остался после болезни, выздоравливает.",
        sourceObservationId: "obs-i",
        confidence: 0.95,
      }),
    ],
    // Not resolved, not pain, not pause, but health memory corroborates → no doubt.
    expectPattern: null,
  },
  {
    // Legit illness with corroborating acute memory → not flagged.
    name: "guard — legit illness with acute memory not flagged",
    signal: {
      id: "synthetic-legit",
      signalType: "health_issue_started",
      structuredPayload: { health_issue_kind: "illness" },
      sourceObservationId: "obs-l",
    },
    memoryItems: [
      mem({
        memoryType: "health_status",
        summaryText: "Заболела, температура, болит горло.",
        sourceObservationId: "obs-l",
        confidence: 0.9,
      }),
    ],
    expectPattern: null,
  },
];

function run(): void {
  let flagged = 0;
  const rows: string[] = [];
  for (const testCase of CASES) {
    const verdict = evaluateHealthSignalMemoryDoubt({
      signal: testCase.signal,
      memoryItems: testCase.memoryItems,
    });
    const gotPattern = verdict?.pattern ?? null;
    assert(
      gotPattern === testCase.expectPattern,
      `${testCase.name}: expected pattern ${String(testCase.expectPattern)}, got ${String(gotPattern)}`
    );
    if (verdict && testCase.expectTier) {
      assert(
        verdict.tier === testCase.expectTier,
        `${testCase.name}: expected tier ${testCase.expectTier}, got ${verdict.tier}`
      );
    }
    if (verdict) {
      flagged += 1;
    }
    rows.push(
      `  ${verdict ? "⚠️ " : "✓  "}${testCase.name}\n       → ${
        verdict ? `${verdict.pattern} [${verdict.tier}] — ${verdict.reason}` : "нет сомнения"
      }`
    );
  }

  // 4 of 5 audit misfires flagged; Sofia (improving) not flagged.
  assert(flagged === 5, `expected 5 doubts (4 misfires + 1 synthetic resolved), got ${flagged}`);

  process.stdout.write(`${LOG_PREFIX} table:\n${rows.join("\n")}\n`);
  process.stdout.write(`${LOG_PREFIX} PASS (${CASES.length} cases, ${flagged} flagged)\n`);
}

try {
  run();
} catch (error) {
  process.stderr.write(`${LOG_PREFIX} FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
