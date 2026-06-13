import { isExpiredScheduleOperationalSignal } from "@/features/trainingpeaks/service";

/**
 * Deterministic coverage for schedule-expiry hardening (Phase 2).
 *
 * Focus: a generous default `valid_until` must NOT keep a stale constraint visible
 * once its concrete one-off unavailability dates have all passed; while availability
 * windows and mixed past+future rows must stay visible.
 */

const AS_OF = "2026-06-13";
const LOG_PREFIX = "[check:tp-signals-schedule-expiry]";

let passed = 0;
let failed = 0;

function assert(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`OK ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function expired(input: {
  signalType?: string;
  validUntil?: string | null;
  payload: Record<string, unknown>;
  referenceObservedAt?: string;
}): boolean {
  return isExpiredScheduleOperationalSignal(
    {
      signalType: input.signalType ?? "plan_generation_constraint",
      validUntil: input.validUntil ?? null,
      structuredPayload: input.payload,
    },
    AS_OF,
    { referenceObservedAt: input.referenceObservedAt ?? "2026-06-08T08:00:00.000Z" }
  );
}

function run(): void {
  // 1. Lavrentyev-like: single past weekday, valid_until already at the weekday.
  assert(
    "Lavrentyev 'в среду' (unavailable 06-10, vu 06-10) → expired",
    expired({ validUntil: "2026-06-10", payload: { unavailable_dates: ["2026-06-10"] } })
  );

  // 1b. The core bug: past unavailable date but GENEROUS default valid_until still future.
  assert(
    "past unavailable 06-10 with generous vu 06-14 → expired (actionable date wins)",
    expired({ validUntil: "2026-06-14", payload: { unavailable_dates: ["2026-06-10"] } })
  );

  // 2. Denisova-like: next-week vt materialized 06-09, generous window vu 06-14.
  assert(
    "Denisova 'вт next week' (unavailable 06-09, vu 06-14) → expired",
    expired({ validUntil: "2026-06-14", payload: { unavailable_dates: ["2026-06-09"] } })
  );

  // 3. Future weekday availability still visible.
  assert(
    "future availability window (resolved 06-16/06-18, vu 06-21) → NOT expired",
    !expired({
      signalType: "schedule_availability_window",
      validUntil: "2026-06-21",
      payload: { resolved_available_dates: ["2026-06-16", "2026-06-18"] },
    })
  );

  // 4. Mixed past + future unavailable → NOT expired (future remains actionable).
  assert(
    "mixed unavailable 06-09 + 06-15 (vu 06-15) → NOT expired (future kept)",
    !expired({ validUntil: "2026-06-15", payload: { unavailable_dates: ["2026-06-09", "2026-06-15"] } })
  );

  // 5. Naida control: availability days passed but NO one-off unavailable dates → NOT over-hidden.
  assert(
    "Naida availability (resolved 06-09/06-11 past, vu 06-14, no unavailable_dates) → NOT expired",
    !expired({
      signalType: "plan_generation_constraint",
      validUntil: "2026-06-14",
      payload: { resolved_available_dates: ["2026-06-09", "2026-06-11"], available_days: ["Tuesday", "Thursday"] },
    })
  );

  // 6. Levan control: availability window including today (06-13) → NOT expired (same-day convention).
  assert(
    "Levan availability (resolved 06-10/06-13, vu 06-13 today) → NOT expired",
    !expired({
      signalType: "schedule_availability_window",
      validUntil: "2026-06-13",
      payload: { resolved_available_dates: ["2026-06-10", "2026-06-13"] },
    })
  );

  // 7. Polyakova case-8 control: past unavailable + FUTURE planned → NOT expired.
  assert(
    "Polyakova mixed (unavailable 06-10 past, planned 06-15 future) → NOT expired",
    !expired({
      validUntil: null,
      payload: { unavailable_dates: ["2026-06-10"], planned_training_dates: ["2026-06-15"] },
    })
  );

  // 8. Empty-payload legacy row (no materialized dates) → governed by valid_until only.
  assert(
    "empty-payload row with future vu 06-14 → NOT expired (cannot infer; keep)",
    !expired({ validUntil: "2026-06-14", payload: {} })
  );
  assert(
    "empty-payload row with past vu 06-12 → expired (valid_until governs)",
    expired({ validUntil: "2026-06-12", payload: {} })
  );

  console.log(`${LOG_PREFIX} pass=${passed} fail=${failed}`);
  if (failed > 0) {
    process.exit(1);
  }
  console.log(`${LOG_PREFIX} PASS (${passed}/${passed})`);
}

run();
