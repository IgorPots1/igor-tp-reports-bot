import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { chromium } from "playwright";

import { profileDir, toolRoot } from "./lib/paths.ts";
import { captureSessionAuth } from "./lib/trainingpeaks-api-move.ts";

type CliArgs = {
  athleteId: number;
  write: boolean;
  headed: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  let athleteId = 5652949;
  let write = false;
  let headed = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--write") {
      write = true;
      continue;
    }
    if (arg === "--headed") {
      headed = true;
      continue;
    }
    if (arg === "--athlete-id") {
      const raw = argv[index + 1];
      if (!raw) {
        throw new Error("--athlete-id requires a numeric value.");
      }
      athleteId = Number(raw);
      if (!Number.isFinite(athleteId) || athleteId <= 0) {
        throw new Error(`Invalid --athlete-id value: ${raw}`);
      }
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "Usage: npm --prefix tools/trainingpeaks-export run capture-trainingpeaks-api-bearer -- [--athlete-id 5652949] [--headed] [--write]",
          "",
          "Observes Authorization header from authenticated TrainingPeaks browser session.",
          "Never prints token value. Use --write to store TRAININGPEAKS_API_BEARER in repo .env.local.",
        ].join("\n")
      );
      process.exit(0);
    }
  }

  return { athleteId, write, headed };
}

function upsertEnvLocalBearer(repoRoot: string, bearerToken: string): void {
  const envPath = path.join(repoRoot, ".env.local");
  const line = `TRAININGPEAKS_API_BEARER=${bearerToken}`;
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";

  const updated = /^TRAININGPEAKS_API_BEARER=/m.test(existing)
    ? existing.replace(/^TRAININGPEAKS_API_BEARER=.*$/m, line)
    : `${existing}${existing.length > 0 && !existing.endsWith("\n") ? "\n" : ""}${line}\n`;

  fs.writeFileSync(envPath, updated, "utf8");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(toolRoot, "../..");

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: !args.headed,
    viewport: null,
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const auth = await captureSessionAuth({
      context,
      page,
      athleteId: args.athleteId,
    });

    const authorizationHeader = auth.authorizationHeader?.trim() ?? "";
    const bearerMatch = authorizationHeader.match(/^Bearer\s+(.+)$/i);
    const bearerToken = bearerMatch?.[1]?.trim() ?? "";

    if (!bearerToken) {
      console.log({
        TRAININGPEAKS_API_BEARER: false,
        authorizationObserved: Boolean(authorizationHeader),
        sampleRequestObserved: Boolean(auth.sampleRequestUrl),
        storedInEnvLocal: false,
      });
      process.exitCode = 1;
      return;
    }

    if (args.write) {
      upsertEnvLocalBearer(repoRoot, bearerToken);
    }

    console.log({
      TRAININGPEAKS_API_BEARER: true,
      authorizationObserved: true,
      sampleRequestObserved: Boolean(auth.sampleRequestUrl),
      storedInEnvLocal: args.write,
    });
  } finally {
    await context.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[capture-trainingpeaks-api-bearer] ERROR: ${message}`);
  process.exit(1);
});
