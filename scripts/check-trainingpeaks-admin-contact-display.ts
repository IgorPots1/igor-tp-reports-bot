import process from "node:process";

import { buildTrainingPeaksContactDisplay } from "@/features/trainingpeaks/contact-display";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function run(): Promise<void> {
  const todayDisplay = buildTrainingPeaksContactDisplay({
    lastCoachTouchAt: new Date().toISOString(),
  });
  assert(todayDisplay.daysWithoutContact === 0, "Today contact should produce daysWithoutContact=0.");
  assert(todayDisplay.hasNoContactAlert === false, "Today contact should not trigger no-contact alert.");

  const oldDisplay = buildTrainingPeaksContactDisplay({
    lastCoachTouchAt: daysAgo(5),
  });
  assert(oldDisplay.daysWithoutContact === 5, "5-day old contact should produce daysWithoutContact=5.");
  assert(oldDisplay.hasNoContactAlert === true, "5-day old contact should trigger no-contact alert.");

  const noHistoryDisplay = buildTrainingPeaksContactDisplay({
    lastCoachTouchAt: null,
  });
  assert(noHistoryDisplay.lastContactAt === null, "No history should keep lastContactAt null.");
  assert(noHistoryDisplay.daysWithoutContact === null, "No history should keep daysWithoutContact null.");
  assert(noHistoryDisplay.hasNoContactAlert === false, "No history should not trigger no-contact alert.");

  console.log("[check-trainingpeaks-admin-contact-display] PASS");
}

run().catch((error) => {
  console.error("[check-trainingpeaks-admin-contact-display] FAIL");
  console.error((error as Error).message);
  process.exit(1);
});
