import assert from "node:assert/strict";

type ParsedPayload = {
  parsingDiagnostics?: {
    autoApprovedForDryRun?: boolean;
  };
};

function isMoveActionAutoApprovedForDryRun(parsedPayload: unknown): boolean {
  if (!parsedPayload || typeof parsedPayload !== "object") {
    return false;
  }
  const payload = parsedPayload as ParsedPayload;
  return payload.parsingDiagnostics?.autoApprovedForDryRun === true;
}

function formatMoveCompletionStudentReply(formality: "ty" | "vy" | "unknown" | null | undefined): string {
  return formality === "ty" ? "Готово, проверяй." : "Готово, проверяйте.";
}

function run(): void {
  assert.equal(
    isMoveActionAutoApprovedForDryRun({
      parsingDiagnostics: {
        autoApprovedForDryRun: true,
      },
    }),
    true
  );
  assert.equal(isMoveActionAutoApprovedForDryRun({ parsingDiagnostics: {} }), false);
  assert.equal(isMoveActionAutoApprovedForDryRun(null), false);

  assert.equal(formatMoveCompletionStudentReply("ty"), "Готово, проверяй.");
  assert.equal(formatMoveCompletionStudentReply("vy"), "Готово, проверяйте.");
  assert.equal(formatMoveCompletionStudentReply("unknown"), "Готово, проверяйте.");
  assert.equal(formatMoveCompletionStudentReply(undefined), "Готово, проверяйте.");

  console.log("PASS check-trainingpeaks-move-confirmation-flow");
}

run();
