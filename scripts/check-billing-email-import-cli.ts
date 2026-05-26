import process from "node:process";

import { parseArgs } from "@/../scripts/billing-email-import";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertThrows(argv: string[], expectedMessagePart: string): void {
  let thrownMessage: string | null = null;
  try {
    parseArgs(argv);
  } catch (error) {
    thrownMessage = error instanceof Error ? error.message : String(error);
  }

  assert(
    Boolean(thrownMessage && thrownMessage.includes(expectedMessagePart)),
    `Expected "${expectedMessagePart}" for argv "${argv.join(" ")}", got "${thrownMessage ?? "no error"}".`
  );
}

function run(): void {
  const parsed = parseArgs([
    "--from-email",
    "oplata@tbank.ru",
    "--subject-contains",
    "Реестр платежей",
    "--since",
    "2026-05-02",
    "--until",
    "2026-05-27",
    "--max-messages",
    "1000",
  ]);
  assert(parsed.apply === false, "Expected dry-run by default.");
  assert(parsed.fromEmail === "oplata@tbank.ru", "Expected --from-email parsed.");
  assert(parsed.subjectContains === "Реестр платежей", "Expected --subject-contains parsed.");
  assert(parsed.since === "2026-05-02", "Expected --since parsed.");
  assert(parsed.until === "2026-05-27", "Expected --until parsed.");
  assert(parsed.maxMessages === 1000, "Expected --max-messages parsed.");

  assertThrows(["--since", "2026-13-02"], "--since must be a valid calendar date");
  assertThrows(["--until", "2026-02-30"], "--until must be a valid calendar date");
  assertThrows(["--since", "2026-05-28", "--until", "2026-05-27"], "--since cannot be later than --until");
  assertThrows(["--max-messages", "0"], "--max-messages must be a positive integer");
  assertThrows(["--max-messages", "-5"], "--max-messages must be a positive integer");
  assertThrows(["--lookback-days", "-1"], "--lookback-days must be a non-negative integer");
  assertThrows(["--unknown-flag"], "Unknown flag");

  console.log("[check-billing-email-import-cli] PASS");
}

try {
  run();
} catch (error) {
  console.error("[check-billing-email-import-cli] FAIL");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
