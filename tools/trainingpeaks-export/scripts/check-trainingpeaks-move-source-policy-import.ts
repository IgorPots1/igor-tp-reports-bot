import * as moveSourcePolicyNamespace from "../../../src/features/trainingpeaks/move-source-policy.ts";

const moveSourcePolicy = moveSourcePolicyNamespace.default ?? moveSourcePolicyNamespace;

if (!moveSourcePolicy.INFERRED_MOVE_SOURCE_EXECUTION_BLOCK_MESSAGE_RU?.trim()) {
  throw new Error("INFERRED_MOVE_SOURCE_EXECUTION_BLOCK_MESSAGE_RU must not be empty.");
}
if (typeof moveSourcePolicy.validateMoveSourceForExecution !== "function") {
  throw new Error("validateMoveSourceForExecution must be a function.");
}
if (typeof moveSourcePolicy.isMoveSourceExplicitEnough !== "function") {
  throw new Error("isMoveSourceExplicitEnough must be a function.");
}
if (typeof moveSourcePolicy.getSelectedSourceDatePolicyFromDryRunLog !== "function") {
  throw new Error("getSelectedSourceDatePolicyFromDryRunLog must be a function.");
}

console.log("check-trainingpeaks-move-source-policy-import: ok");
