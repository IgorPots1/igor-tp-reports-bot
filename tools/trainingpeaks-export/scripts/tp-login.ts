import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const toolRoot = path.resolve(__dirname, "..");
const profileDir = path.join(toolRoot, ".playwright-profile", "trainingpeaks");

async function waitForEnter(message: string): Promise<void> {
  const rl = createInterface({ input, output });
  try {
    await rl.question(`${message}\n`);
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  await mkdir(profileDir, { recursive: true });

  console.log(`Using persistent browser profile: ${profileDir}`);
  console.log("Opening TrainingPeaks in a headed Chromium window...");

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: null
  });

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto("https://app.trainingpeaks.com/", {
    waitUntil: "domcontentloaded"
  });
  await page.bringToFront();

  console.log("Log in manually in the opened browser window.");
  await waitForEnter("Press Enter here when you are done and want to close the browser.");

  await context.close();
  console.log("Browser closed.");
}

main().catch((error: unknown) => {
  console.error("tp-login failed.");
  console.error(error);
  process.exit(1);
});
