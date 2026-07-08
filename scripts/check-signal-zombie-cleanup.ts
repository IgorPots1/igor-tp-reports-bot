import process from "node:process";

import {
  decideSignalZombieCleanup,
  readSignalZombieCleanupMode,
  ZOMBIE_MIN_AGE_DAYS,
} from "@/features/trainingpeaks/signal-zombie-cleanup";

const LOG_PREFIX = "[check-signal-zombie-cleanup]";
const AS_OF = "2026-07-08";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type Fixture = {
  name: string;
  signalType: string;
  status: string;
  createdAt: string;
  validUntil: string | null;
  hasActiveConfirmingMemory: boolean;
};

// Mirrors the live active-signal set from the 2026-07-08 revision + edge cases.
const FIXTURES: Fixture[] = [
  { name: "Sofia Vlasova", signalType: "schedule_unavailability_window", status: "active", createdAt: "2026-06-01T09:00:00.000Z", validUntil: null, hasActiveConfirmingMemory: false },
  { name: "ILYA BOGDANOV", signalType: "move_workout_candidate", status: "active", createdAt: "2026-06-01T09:00:00.000Z", validUntil: null, hasActiveConfirmingMemory: false },
  { name: "Nastya Bunyakina", signalType: "pain_injury", status: "active", createdAt: "2026-06-29T09:00:00.000Z", validUntil: null, hasActiveConfirmingMemory: false },
  { name: "Health other", signalType: "health_issue_started", status: "active", createdAt: "2026-05-01T09:00:00.000Z", validUntil: null, hasActiveConfirmingMemory: false },
  { name: "Fresh move w/ TTL", signalType: "move_workout_candidate", status: "active", createdAt: "2026-06-01T09:00:00.000Z", validUntil: "2026-07-09", hasActiveConfirmingMemory: false },
  { name: "Old NULL active-mem", signalType: "schedule_availability_window", status: "active", createdAt: "2026-05-01T09:00:00.000Z", validUntil: null, hasActiveConfirmingMemory: true },
  { name: "Recent NULL", signalType: "plan_generation_constraint", status: "active", createdAt: "2026-07-08T00:00:00.000Z", validUntil: null, hasActiveConfirmingMemory: false },
  { name: "Already expired", signalType: "move_workout_candidate", status: "expired", createdAt: "2026-06-01T09:00:00.000Z", validUntil: null, hasActiveConfirmingMemory: false },
];

function decide(f: Fixture) {
  return decideSignalZombieCleanup({
    status: f.status,
    signalType: f.signalType,
    validUntil: f.validUntil,
    createdAt: f.createdAt,
    asOfDate: AS_OF,
    hasActiveConfirmingMemory: f.hasActiveConfirmingMemory,
  });
}

function run(): void {
  assert(readSignalZombieCleanupMode({} as NodeJS.ProcessEnv) === "off", "flag default off");
  assert(readSignalZombieCleanupMode({ COACH_SIGNAL_ZOMBIE_CLEANUP_MODE: "on" } as NodeJS.ProcessEnv) === "on", "flag on parsed");
  assert(readSignalZombieCleanupMode({ COACH_SIGNAL_ZOMBIE_CLEANUP_MODE: "dry_run" } as NodeJS.ProcessEnv) === "dry_run", "flag dry_run parsed");
  assert(readSignalZombieCleanupMode({ COACH_SIGNAL_ZOMBIE_CLEANUP_MODE: "garbage" } as NodeJS.ProcessEnv) === "off", "unknown → off (fail-closed)");

  const decided = FIXTURES.map((f) => ({ f, d: decide(f) }));

  console.log(`${LOG_PREFIX} dry-run over ${FIXTURES.length} signals (as of ${AS_OF}, N=${ZOMBIE_MIN_AGE_DAYS}d):`);
  console.log("ученик | тип | created | valid_until | mem-active | зомби | причина");
  for (const { f, d } of decided) {
    const verdict = d.eligible ? "ДА" : "нет";
    const why = d.eligible ? d.reason : d.blockedReason;
    console.log(`${f.name} | ${f.signalType} | ${f.createdAt.slice(0, 10)} | ${f.validUntil ?? "NULL"} | ${f.hasActiveConfirmingMemory ? "да" : "нет"} | ${verdict} | ${why}`);
  }

  const isEligible = (name: string) => decided.find((x) => x.f.name === name)?.d.eligible === true;

  assert(isEligible("Sofia Vlasova"), "Sofia (unavailability) must be a zombie");
  assert(isEligible("ILYA BOGDANOV"), "ILYA (move) must be a zombie");
  assert(!isEligible("Nastya Bunyakina"), "Nastya (pain_injury) must be excluded");
  assert(!isEligible("Health other"), "health_issue_started must be excluded");
  assert(!isEligible("Fresh move w/ TTL"), "signal with valid_until must be excluded");
  assert(!isEligible("Old NULL active-mem"), "active confirming memory must be excluded");
  assert(!isEligible("Recent NULL"), "signal within grace window must be excluded");
  assert(!isEligible("Already expired"), "already-expired must not be eligible (idempotent)");

  const expiredDecision = decided.find((x) => x.f.name === "Already expired")?.d;
  assert(expiredDecision !== undefined && !expiredDecision.eligible && expiredDecision.blockedReason === "not_active", "expired → blocked not_active");

  const swept = decided.filter((x) => x.d.eligible).map((x) => x.f.name).sort();
  assert(swept.length === 2, `exactly 2 zombies, got ${swept.length}: ${swept.join(", ")}`);
  assert(swept[0] === "ILYA BOGDANOV" && swept[1] === "Sofia Vlasova", `swept set = ILYA+Sofia, got ${swept.join(", ")}`);

  assert(decided.filter((x) => x.f.signalType === "pain_injury").every((x) => !x.d.eligible), "all pain_injury excluded");

  console.log(`${LOG_PREFIX} PASS`);
}

try {
  run();
} catch (error) {
  console.error(`${LOG_PREFIX} FAIL`, error instanceof Error ? error.message : error);
  process.exit(1);
}
