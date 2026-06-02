import process from "node:process";

import { safeAttentionSource } from "@/features/trainingpeaks/service";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function run(): Promise<void> {
  const fallbackList = await safeAttentionSource("resilience-list", async () => {
    throw new Error("list source failed");
  }, [] as string[]);
  assert(Array.isArray(fallbackList), "Fallback list must be an array.");
  assert(fallbackList.length === 0, "Fallback list must be empty.");

  const fallbackCount = await safeAttentionSource("resilience-count", async () => {
    throw new Error("count source failed");
  }, 0);
  assert(fallbackCount === 0, "Fallback count must be zero.");

  const fallbackObject = await safeAttentionSource("resilience-object", async () => {
    throw new Error("object source failed");
  }, null as { id: string } | null);
  assert(fallbackObject === null, "Fallback object must be null.");

  const successValue = await safeAttentionSource("resilience-success", async () => "ok", "fallback");
  assert(successValue === "ok", "Successful source must keep original value.");

  console.log("[check-trainingpeaks-attention-resilience] PASS");
}

run().catch((error) => {
  console.error("[check-trainingpeaks-attention-resilience] FAIL");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
