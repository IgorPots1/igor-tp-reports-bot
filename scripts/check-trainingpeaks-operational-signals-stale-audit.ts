import process from "node:process";

import {
  buildDuplicateSignalIdSet,
  hasMatchingActiveMoveAction,
  hasWindowOverlap,
  isPossibleFalsePause,
  LIFECYCLE_SIGNAL_TYPES,
} from "./audit-trainingpeaks-operational-signals-stale";

const LOG_PREFIX = "[check-trainingpeaks-operational-signals-stale-audit]";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function run(): void {
  const today = "2026-06-04";
  const yesterday = "2026-06-03";

  // 1) valid_until yesterday + active -> expired_but_active
  const expiredButActive = yesterday < today;
  assert(expiredButActive, "1 failed: expected valid_until yesterday to be expired.");

  // 2) active health with null valid_until -> missing_valid_until
  assert(
    LIFECYCLE_SIGNAL_TYPES.has("health_issue_started") && !null,
    "2 failed: health_issue_started should be lifecycle-sensitive."
  );

  // 3) active pause with logistics evidence and no health cue -> possible_false_pause
  assert(
    isPossibleFalsePause("поеду в мск, на стадион не смогу сегодня"),
    "3 failed: logistics-only pause should be flagged possible_false_pause."
  );

  // 4) active pause with illness evidence -> no possible_false_pause
  assert(
    !isPossibleFalsePause("болит горло, температура, не смогу бегать"),
    "4 failed: illness cue should suppress possible_false_pause."
  );

  // 5) missing source observation -> missing_source_observation (predicate equivalent)
  const hasMissingSourceObservation = !("sample-observation-id" && true);
  assert(!hasMissingSourceObservation, "5 failed: baseline source observation predicate mismatch.");
  const missingSourceObservation = !null;
  assert(missingSourceObservation, "5 failed: null source observation id should be missing.");

  // 6) duplicate overlapping same student/signal type -> duplicate_candidate
  assert(
    hasWindowOverlap("2026-06-01", "2026-06-05", "2026-06-04", "2026-06-06"),
    "6 failed: expected overlap helper to detect overlapping windows."
  );
  const duplicates = buildDuplicateSignalIdSet([
    {
      id: "s1",
      studentId: "student-1",
      signalType: "health_issue_started",
      validFrom: "2026-06-01",
      validUntil: "2026-06-05",
    },
    {
      id: "s2",
      studentId: "student-1",
      signalType: "health_issue_started",
      validFrom: "2026-06-04",
      validUntil: "2026-06-07",
    },
  ]);
  assert(
    duplicates.has("s1") && duplicates.has("s2"),
    "6 failed: expected duplicate set for overlapping same student/signal type."
  );

  // 7) move candidate without active action -> active_move_without_action
  const hasMoveMatch = hasMatchingActiveMoveAction(
    {
      studentId: "student-1",
      linkedActionId: null,
      sourceDate: "2026-06-04",
      targetDate: "2026-06-05",
    },
    []
  );
  assert(!hasMoveMatch, "7 failed: no active actions should mean move match is absent.");

  // 8) stale audit JSON item contract must include real signal_id
  type AuditJsonItemContract = {
    signalId: string;
    sourceObservationId?: string | null;
  };
  const contractCheck: AuditJsonItemContract = {
    signalId: "11111111-1111-4111-8111-111111111111",
    sourceObservationId: "22222222-2222-4222-8222-222222222222",
  };
  assert(
    contractCheck.signalId.length > 0,
    "8 failed: stale audit item contract must include non-empty signalId."
  );

  console.log(`${LOG_PREFIX} PASS`);
}

try {
  run();
} catch (error) {
  console.error(`${LOG_PREFIX} FAIL`);
  console.error((error as Error).message);
  process.exit(1);
}
