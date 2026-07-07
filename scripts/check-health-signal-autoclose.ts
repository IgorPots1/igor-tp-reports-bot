import process from "node:process";

import {
  evaluateHealthSignalMemoryDoubt,
  type HealthSignalMemoryReconcileMemoryItem,
  type HealthSignalMemoryReconcileSignal,
} from "@/features/trainingpeaks/health-signal-memory-reconcile";
import {
  decideHealthSignalAutoClose,
  readHealthSignalAutoCloseMode,
} from "@/features/trainingpeaks/health-signal-autoclose";

// Deterministic (no DB). Proves Step-2 auto-close eligibility: ONLY a strong `already_resolved` doubt
// on a health_issue_started signal is eligible; every other pattern/tier is blocked. Runs the SAME
// classifier cases as Step 1 through the decision so the two layers can't drift. Also checks the
// default-OFF flag reader (unset → off; only exact "on"/"dry_run" activate).

const LOG_PREFIX = "[check-health-signal-autoclose]";

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
    id: overrides.id ?? `mem-${overrides.sourceObservationId}`,
    confidence: overrides.confidence ?? null,
    ...overrides,
  };
}

type Case = {
  name: string;
  signal: HealthSignalMemoryReconcileSignal;
  memoryItems: HealthSignalMemoryReconcileMemoryItem[];
  expectEligible: boolean;
  // When blocked, the reason substring we require (guards against silently eligible-by-accident).
  expectBlockedContains?: string;
};

const CASES: Case[] = [
  {
    // THE eligible case: same-message memory says the episode is over → strong already_resolved.
    name: "strong already_resolved → ELIGIBLE",
    signal: {
      id: "resolved-1",
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
    expectEligible: true,
  },
  {
    // Olesya — knee pain mislabelled illness → medium pain_not_illness. Reclassify, never auto-close.
    name: "medium pain_not_illness → blocked",
    signal: {
      id: "pain-1",
      signalType: "health_issue_started",
      structuredPayload: { health_issue_kind: "pain_or_injury", health_state: "sick" },
      sourceObservationId: "9c4b8dfc",
    },
    memoryItems: [
      mem({
        memoryType: "pain_or_injury",
        summaryText: "После интенсивного цикла болело колено; отдохнула 2 дня, сегодня смогла пробежать.",
        sourceObservationId: "9c4b8dfc",
        confidence: 0.95,
      }),
    ],
    expectEligible: false,
    expectBlockedContains: "pain_not_illness",
  },
  {
    // Kuznetsova — self-chosen rest → weak. Never auto-close.
    name: "weak self_chosen_pause → blocked",
    signal: {
      id: "pause-1",
      signalType: "health_issue_started",
      structuredPayload: { health_issue_kind: "illness", health_state: "sick" },
      sourceObservationId: "2a05fae6",
    },
    memoryItems: [
      mem({
        memoryType: "health_status",
        summaryText: "Взяла неделю отдыха из-за женских дел (менструальный цикл).",
        sourceObservationId: "2a05fae6",
        confidence: 0.85,
      }),
    ],
    expectEligible: false,
    expectBlockedContains: "self_chosen_pause",
  },
  {
    // Filip — no health memory on the source message → weak absence tier. Never auto-close.
    name: "weak no_health_corroboration → blocked",
    signal: {
      id: "absence-1",
      signalType: "health_issue_started",
      structuredPayload: { health_issue_kind: "illness" },
      sourceObservationId: "ed466260",
    },
    memoryItems: [
      mem({ memoryType: "load_tolerance", summaryText: "чуть тяжелее обычного", sourceObservationId: "other-2", confidence: 0.7 }),
    ],
    expectEligible: false,
    expectBlockedContains: "no_health_corroboration",
  },
  {
    // Legit acute illness corroborated by memory → no doubt at all → blocked (no_doubt).
    name: "legit illness, no doubt → blocked",
    signal: {
      id: "legit-1",
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
    expectEligible: false,
    expectBlockedContains: "no_doubt",
  },
  {
    // Sofia safety: health_issue_improving is out of scope for the classifier AND the decision.
    name: "improving signal (Sofia) → blocked",
    signal: {
      id: "improving-1",
      signalType: "health_issue_improving",
      structuredPayload: { health_issue_kind: "illness", health_state: "improving" },
      sourceObservationId: "632bb90d",
    },
    memoryItems: [
      mem({
        memoryType: "health_status",
        summaryText: "Кашель остался после болезни, выздоравливает.",
        sourceObservationId: "632bb90d",
        confidence: 0.95,
      }),
    ],
    expectEligible: false,
    expectBlockedContains: "not_health_issue_started",
  },
  {
    // Resolved cue but confidence below the 0.85 gate → classifier casts no strong doubt → blocked.
    name: "resolved cue but confidence 0.8 (< gate) → blocked",
    signal: {
      id: "resolved-lowconf",
      signalType: "health_issue_started",
      structuredPayload: { health_issue_kind: "illness" },
      sourceObservationId: "obs-lc",
    },
    memoryItems: [
      mem({
        memoryType: "health_status",
        summaryText: "Всё прошло, не болит.",
        sourceObservationId: "obs-lc",
        confidence: 0.8,
      }),
    ],
    expectEligible: false,
  },
];

function runDecisionCases(): number {
  let eligibleCount = 0;
  const rows: string[] = [];
  for (const testCase of CASES) {
    const doubt = evaluateHealthSignalMemoryDoubt({
      signal: testCase.signal,
      memoryItems: testCase.memoryItems,
    });
    const decision = decideHealthSignalAutoClose({
      signalType: testCase.signal.signalType,
      doubt,
    });
    assert(
      decision.eligible === testCase.expectEligible,
      `${testCase.name}: expected eligible=${testCase.expectEligible}, got ${decision.eligible}`
    );
    if (!decision.eligible && testCase.expectBlockedContains) {
      assert(
        decision.blockedReason.includes(testCase.expectBlockedContains),
        `${testCase.name}: expected blockedReason to contain "${testCase.expectBlockedContains}", got "${decision.blockedReason}"`
      );
    }
    if (decision.eligible) {
      eligibleCount += 1;
      // The eligible verdict must carry the memory trace forward for the audit record.
      assert(decision.pattern === "already_resolved", `${testCase.name}: eligible pattern must be already_resolved`);
      assert(decision.tier === "strong", `${testCase.name}: eligible tier must be strong`);
    }
    rows.push(
      `  ${decision.eligible ? "🔒 " : "•  "}${testCase.name}\n       → ${
        decision.eligible ? "ELIGIBLE (close)" : `blocked: ${decision.blockedReason}`
      }`
    );
  }
  process.stdout.write(`${LOG_PREFIX} decisions:\n${rows.join("\n")}\n`);
  return eligibleCount;
}

function runFlagCases(): void {
  assert(readHealthSignalAutoCloseMode({}) === "off", "unset env must be off");
  assert(readHealthSignalAutoCloseMode({ COACH_HEALTH_SIGNAL_AUTOCLOSE_MODE: "" }) === "off", "empty must be off");
  assert(
    readHealthSignalAutoCloseMode({ COACH_HEALTH_SIGNAL_AUTOCLOSE_MODE: "yes" }) === "off",
    "arbitrary value must be off (fail-closed)"
  );
  assert(
    readHealthSignalAutoCloseMode({ COACH_HEALTH_SIGNAL_AUTOCLOSE_MODE: " On " }) === "on",
    "trimmed/cased 'On' must be on"
  );
  assert(
    readHealthSignalAutoCloseMode({ COACH_HEALTH_SIGNAL_AUTOCLOSE_MODE: "DRY_RUN" }) === "dry_run",
    "cased 'DRY_RUN' must be dry_run"
  );
}

function run(): void {
  const eligibleCount = runDecisionCases();
  // Exactly ONE case (strong already_resolved) is eligible; the rest are blocked.
  assert(eligibleCount === 1, `expected exactly 1 eligible case, got ${eligibleCount}`);
  runFlagCases();
  process.stdout.write(`${LOG_PREFIX} PASS (${CASES.length} decision cases, 1 eligible; flag reader OK)\n`);
}

try {
  run();
} catch (error) {
  process.stderr.write(`${LOG_PREFIX} FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
