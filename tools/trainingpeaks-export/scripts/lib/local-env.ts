// Load .env.local / .env into process.env for standalone runner scripts (launchd
// context has no Next.js env injection). Mirrors the inline loader in
// tp-workouts-cache-scan.ts; kept as a tiny shared lib so the feedback-enqueue and
// ops-notify runners don't each re-implement it. Existing process.env wins (never
// overwrites a value already set by the shell / plist).

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { toolRoot } from "./paths.ts";

function readTextFileSyncSafe(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function loadDotEnvFile(dotEnvPath: string): void {
  if (!existsSync(dotEnvPath)) return;
  const content = readTextFileSyncSafe(dotEnvPath);
  if (content === null) return;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) continue;
    let value = trimmed.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

export function loadLocalEnv(): void {
  const repoRoot = path.resolve(toolRoot, "..", "..");
  for (const envPath of [path.join(repoRoot, ".env.local"), path.join(repoRoot, ".env"), path.join(toolRoot, ".env")]) {
    loadDotEnvFile(envPath);
  }
}
