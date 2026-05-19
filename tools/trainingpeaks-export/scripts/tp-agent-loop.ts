import process from "node:process";
import { spawn } from "node:child_process";

type LoopOptions = {
  intervalSeconds: number;
  once: boolean;
  headless: boolean;
};

const DEFAULT_INTERVAL_SECONDS = 60;

function getCliValueByPrefix(prefix: string): string | null {
  const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  if (!match) {
    return null;
  }
  const value = match.slice(prefix.length).trim();
  if (!value) {
    throw new Error(`CLI argument ${prefix}<value> must not be empty.`);
  }
  return value;
}

function hasCliFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

function parseOptions(): LoopOptions {
  const intervalRaw = getCliValueByPrefix("--interval-seconds=");
  const intervalSeconds = intervalRaw ? Number(intervalRaw) : DEFAULT_INTERVAL_SECONDS;
  if (!Number.isFinite(intervalSeconds) || intervalSeconds < 1) {
    throw new Error("--interval-seconds must be a positive number.");
  }

  return {
    intervalSeconds: Math.floor(intervalSeconds),
    once: hasCliFlag("--once"),
    headless: hasCliFlag("--headless"),
  };
}

async function runAgentOnce(headless: boolean): Promise<void> {
  const childArgs = ["run", "tp-agent-once"];
  if (headless) {
    childArgs.push("--", "--headless");
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn("npm", childArgs, {
      stdio: "inherit",
      env: process.env,
      shell: false,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Command failed: npm ${childArgs.join(" ")} (exit ${String(code)})`));
    });
  });
}

async function main(): Promise<void> {
  const options = parseOptions();
  console.log(
    `[tp-agent-loop] started interval=${options.intervalSeconds}s once=${options.once ? "yes" : "no"} headless=${options.headless ? "yes" : "no"}`
  );

  let tickNo = 0;
  let isRunningTick = false;

  const runScheduledTick = async (): Promise<void> => {
    if (isRunningTick) {
      console.log("[tp-agent-loop] previous tick still running, skipping this interval");
      return;
    }

    isRunningTick = true;
    tickNo += 1;
    try {
      console.log(`[tp-agent-loop] tick ${tickNo} started`);
      await runAgentOnce(options.headless);
      console.log(`[tp-agent-loop] tick ${tickNo} finished`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[tp-agent-loop] tick ${tickNo} failed: ${message}`);
    } finally {
      isRunningTick = false;
    }
  };

  if (!options.once) {
    setInterval(() => {
      void runScheduledTick();
    }, options.intervalSeconds * 1000);
  }

  await runScheduledTick();
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[tp-agent-loop] fatal error: ${message}`);
  process.exitCode = 1;
});
