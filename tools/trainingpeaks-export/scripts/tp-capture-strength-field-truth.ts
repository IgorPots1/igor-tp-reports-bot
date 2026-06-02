import process from "node:process";

import { chromium } from "playwright";

import {
  REQUIRED_SAVE_CONFIRMATION,
  attachNetworkCapture,
  buildCheckpointPlan,
  buildHelpText,
  buildRunSummaryMarkdown,
  captureDomArtifact,
  deriveVerdict,
  ensureRunArtifacts,
  getRepoRelativePath,
  parseTruthCaptureArgs,
  profileDir,
  saveCheckpointScreenshot,
  saveDomArtifact,
  saveJson,
  saveText,
  sanitizeAthleteUrl,
  waitForCheckpointEnter,
  waitForTypedConfirmation,
  type DomCaptureArtifact,
  type TruthCaptureLog,
} from "./lib/strength-field-truth-capture.ts";

async function main(): Promise<void> {
  const args = parseTruthCaptureArgs(process.argv.slice(2));
  if (args.help) {
    console.log(buildHelpText());
    return;
  }

  const artifacts = await ensureRunArtifacts();
  const deadlineAtMs = Date.now() + args.durationSeconds * 1000;
  const networkState = {
    currentCheckpoint: "startup",
    events: [] as TruthCaptureLog["networkEvents"],
  };
  const checkpointRecords: TruthCaptureLog["checkpoints"] = [];
  const domArtifacts: DomCaptureArtifact[] = [];
  const notes: string[] = [];
  const errors: string[] = [];

  console.log("[tp-capture-strength-field-truth] mode: diagnostic-only truth capture");
  console.log(`[tp-capture-strength-field-truth] athlete: ${sanitizeAthleteUrl(args.athleteUrl)}`);
  console.log(`[tp-capture-strength-field-truth] date: ${args.date}`);
  console.log(`[tp-capture-strength-field-truth] run dir: ${artifacts.runDir}`);
  console.log("[tp-capture-strength-field-truth] no field writing and no Save click will be performed by automation.");
  console.log("");

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: args.headless,
    viewport: null,
  });
  attachNetworkCapture(context, networkState);

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(args.athleteUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.bringToFront();
    await page.waitForTimeout(1500);

    const checkpoints = buildCheckpointPlan(args.allowSaveCapture);
    for (const checkpoint of checkpoints) {
      networkState.currentCheckpoint = checkpoint.id;
      const record = {
        id: checkpoint.id,
        prompt: checkpoint.prompt,
        startedAt: new Date().toISOString(),
      };
      checkpointRecords.push(record);

      if (checkpoint.id === "checkpoint-07-after-save") {
        console.log("");
        console.log("[tp-capture-strength-field-truth] save-capture phase requested.");
        await waitForTypedConfirmation(
          `Type exactly "${REQUIRED_SAVE_CONFIRMATION}" to confirm that you want to capture a manual Save phase.`,
          REQUIRED_SAVE_CONFIRMATION,
          deadlineAtMs
        );
      }

      await waitForCheckpointEnter(checkpoint.prompt, deadlineAtMs);
      await page.waitForTimeout(600);

      const screenshotAbsolute = await saveCheckpointScreenshot(page, artifacts.screenshotsDir, checkpoint.screenshotName);
      const domArtifact = await captureDomArtifact(page, checkpoint.id);
      const domAbsolute = await saveDomArtifact(artifacts.domDir, checkpoint.domFileName, domArtifact);

      domArtifacts.push(domArtifact);
      record.completedAt = new Date().toISOString();
      record.screenshotPath = getRepoRelativePath(screenshotAbsolute);
      record.domPath = getRepoRelativePath(domAbsolute);

      if (!domArtifact.dialogFound) {
        notes.push(`${checkpoint.id}: visible [role="dialog"] was not detected at capture time.`);
      }
      if (domArtifact.focusedControl?.value) {
        notes.push(`${checkpoint.id}: focused control value="${domArtifact.focusedControl.value}".`);
      }
    }

    await page.waitForTimeout(1000);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    await context.close().catch(() => {});
  }

  await saveJson(artifacts.networkEventsPath, {
    runAt: new Date().toISOString(),
    redactedHeaders: true,
    events: networkState.events,
  });

  const initialLog: TruthCaptureLog = {
    runAt: new Date().toISOString(),
    runDir: getRepoRelativePath(artifacts.runDir),
    athleteUrlRedacted: sanitizeAthleteUrl(args.athleteUrl),
    date: args.date,
    manual: args.manual,
    allowSaveCapture: args.allowSaveCapture,
    liveCaptureRan: checkpointRecords.length > 0,
    checkpoints: checkpointRecords,
    screenshots: checkpointRecords
      .map((record) => record.screenshotPath)
      .filter((entry): entry is string => Boolean(entry)),
    domArtifacts: checkpointRecords
      .map((record) => record.domPath)
      .filter((entry): entry is string => Boolean(entry)),
    networkEventsPath: getRepoRelativePath(artifacts.networkEventsPath),
    networkEventCount: networkState.events.length,
    networkEvents: networkState.events,
    verdict: "pause_field_automation_do_catalog_enrichment",
    notes,
    errors,
  };

  const verdict = deriveVerdict(initialLog, domArtifacts);
  const finalLog: TruthCaptureLog = { ...initialLog, verdict };
  const summaryMarkdown = buildRunSummaryMarkdown(finalLog, domArtifacts);

  await saveText(artifacts.summaryPath, summaryMarkdown);
  await saveJson(artifacts.logPath, finalLog);

  console.log("");
  console.log("[tp-capture-strength-field-truth] complete.");
  console.log(`- summary: ${getRepoRelativePath(artifacts.summaryPath)}`);
  console.log(`- log: ${getRepoRelativePath(artifacts.logPath)}`);
  console.log(`- screenshots: ${getRepoRelativePath(artifacts.screenshotsDir)}`);
  console.log(`- dom: ${getRepoRelativePath(artifacts.domDir)}`);
  console.log(`- network: ${getRepoRelativePath(artifacts.networkEventsPath)}`);
  console.log(`- verdict: ${verdict}`);
}

main().catch((error: unknown) => {
  console.error("tp-capture-strength-field-truth failed.");
  console.error(error);
  process.exit(1);
});
